import argparse
import subprocess
import os
import struct
from PIL import Image
from convert_texture import get_data  # our D2 texture conversion function

def load_act_palette(filename):
    """
    Loads an Adobe ACT palette file.
    Expects a multiple of 3 bytes (RGB triplets). Returns a list of (R,G,B,A) tuples.
    """
    with open(filename, "rb") as f:
        data = f.read()
    if len(data) < 3:
        raise ValueError("Palette file too short.")
    num_colors = len(data) // 3
    palette = []
    for i in range(num_colors):
        r = data[i * 3]
        g = data[i * 3 + 1]
        b = data[i * 3 + 2]
        palette.append((r, g, b, 255))
    return palette

def set_alpha_from_black(image_path):
    image = Image.open(image_path).convert("RGBA")
    pixels = image.load()
    width, height = image.size
    
    min_x, min_y, max_x, max_y = width, height, 0, 0
    
    for y in range(height):
        for x in range(width):
            r, g, b, _ = pixels[x, y]
            alpha = int((r + g + b) / 3)
            # Uncomment the next line if you wish to adjust pixel alpha:
            # pixels[x, y] = (r, g, b, alpha)
            
            if alpha > 0:
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    
    if min_x < max_x and min_y < max_y:
        cropped_image = image.crop((min_x, min_y, max_x + 1, max_y + 1))
        cropped_image.save(image_path)
        print(f"Optimized bitmap saved as {image_path}")
    else:
        print("No visible pixels found. Skipping optimization.")

def create_bmfc_config(name, font_path, output_dir, font_size, padding, spacing, antialiasing, characters):
    config_path = os.path.join(output_dir, "font_config.bmfc")
    
    char_indices = ",".join(str(ord(c)) for c in characters)
    
    config_string = f"""
# AngelCode Bitmap Font Generator configuration file
fileVersion=1

# font settings
fontName={name}
fontFile={font_path}
charSet=0
fontSize={font_size}
aa={antialiasing}
scaleH=100
useSmoothing=0
isBold=0
isItalic=0
useUnicode=1
disableBoxChars=1
outputInvalidCharGlyph=0
dontIncludeKerningPairs=0
useHinting=1
renderFromOutline=0
useClearType=1
autoFitNumPages=0
autoFitFontSizeMin=0
autoFitFontSizeMax=0

# character alignment
paddingDown={padding}
paddingUp={padding}
paddingRight={padding}
paddingLeft={padding}
spacingHoriz={spacing}
spacingVert={spacing}
useFixedHeight=0
forceZero=0
widthPaddingFactor=0.00

# output file
outWidth=512
outHeight=512
outBitDepth=32
fontDescFormat=2
fourChnlPacked=0
textureFormat=png
textureCompression=0
alphaChnl=1
redChnl=0
greenChnl=0
blueChnl=0
invA=0
invR=0
invG=0
invB=0

# outline
outlineThickness=0

# selected chars
chars={char_indices}

# imported icon images
"""
    with open(config_path, "w") as config_file:      
        config_file.write(config_string)

    return config_path

def generate_font(bmfont_path, config_path, output_dir):
    command = [bmfont_path,  "-c", config_path, "-o", os.path.join(output_dir, "font.fnt")]
    print("Running BMFont command:", command)
    subprocess.run(command, check=True)
    print(f"Bitmap texture and font generated in {output_dir}")

def main():
    parser = argparse.ArgumentParser(description="Generate bitmap font using BMFont tool and append D2 texture data.")
    parser.add_argument("-n", "--name", required=True, help="Name of the font")
    parser.add_argument("-f", "--font", required=True, help="Path to the TrueType font file.")
    parser.add_argument("-o", "--output", required=True, help="Output directory for generated files.")
    parser.add_argument("-s", "--size", type=int, default=32, help="Font size.")
    parser.add_argument("-p", "--padding", type=int, default=0, help="Padding around characters.")
    parser.add_argument("--bmfont", default="bmfont64.exe", help="Path to BMFont executable.")
    parser.add_argument("--aa", type=int, default=0, help="Antialiasing level (supersampling).")
    parser.add_argument("--chars", type=str, default="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789,.!?()[]{}<>:;+-*/=",
                        help="Characters to include in the bitmap font.")
    # New argument: optional texture palette file for D2 conversion.
    parser.add_argument("--pal", type=str, help="Path to texture palette (.act) for D2 texture conversion.")
    # New argument: When no palette is specified, use a default monochrome conversion.
    parser.add_argument("--format", choices=["I1", "I2", "I4", "I8", "A4", "AI44"], default="I1",
                        help="Texture format to use")
   
    args = parser.parse_args()
    os.makedirs(args.output, exist_ok=True)
    config_path = create_bmfc_config(args.name, args.font, args.output, args.size, args.padding, args.padding, args.aa, args.chars)
    generate_font(args.bmfont, config_path, args.output)
    
    # Optimize the generated PNG (typically named "font_0.png" by BMFont)
    output_png = os.path.join(args.output, "font_0.png")
    set_alpha_from_black(output_png)
    
    # Generate the D2 texture data.
    print("Generating D2 texture data from the optimized PNG...")
    texture_img = Image.open(output_png)
    if args.pal:
        # Use provided palette and convert as full-color (I8)
        palette = load_act_palette(args.pal)
        pixel_format = "I8"
    else:
        # Use default palette containing black (index 0) and white (index 1)
        palette = [(0, 0, 0, 255), (255, 255, 255, 255)]
        # Only support I1 or A4 for default (monochrome) conversion.
        pixel_format = args.format
    d2_data = get_data(texture_img, rotation=3, palette=palette, slot=0, rle=False, pixel_format=pixel_format)
    
    # Append a new block (block type 6) to the .fnt file.
    font_tmp = os.path.join(args.output, f"font.fnt")
    font_file = os.path.join(args.output, f"{args.output}.fnt")
    with open(font_tmp, "ab") as f:
        block_type = 6  # our new block type for "bmp data"
        block_size = len(d2_data)
        # Write 1 byte block type, then 4 bytes little-endian block size, then the d2_data.
        f.write(struct.pack("B", block_type))
        f.write(struct.pack("<I", block_size))
        f.write(d2_data)

    if os.path.exists(font_file):
        os.remove(font_file)

    os.rename(font_tmp, font_file)

    print(f"Appended D2 texture block (type 6, size {block_size} bytes) to {font_file}")

    print(f"Font generated successfully in {args.output}")

if __name__ == "__main__":
    main()
