#!/usr/bin/env python3
"""
A Python conversion of the C# Converter class with optimizations.
This script loads an image (using Pillow) and a palette in Adobe .act format,
rotates the image as specified, and converts it into a custom texture file
with a header beginning "D2" and a pixel format byte that encodes the base
format, an optional RLE bit (only for I8 images), and a palette (CLUT) flag.

Optimizations:
  1. Uses NumPy to process pixels in a vectorized manner.
  2. Uses SciPy’s cKDTree for fast nearest neighbor search in Lab space.
  3. Caches conversion for unique pixel values.

It also supports a preview mode that displays a preview image showing the result
of the color conversion.

Usage example:
    python converter.py --image input.png --palette palette.act --rotation 1 \
         --slot 0 --rle --format I8 --output texture.bin --preview
"""

import argparse, struct, math
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

# Map pixel format names to the 4‐bit “base” code.
FORMAT_ENUM = {
    "ALPHA8":    0x0,
    "RGB565":    0x1,
    "ARGB8888":  0x2,
    "RGB888":    0x40,
    "ARGB4444":  0x3,
    "RGB444":    0x3,
    "ARGB1555":  0x4,
    "RGB555":    0x4,
    "AI44":      0x5,
    "RGBA8888":  0x6,
    "RGBA4444":  0x7,
    "RGBA5551":  0x8,
    "I8":        0x9,
    "I4":        0xA,
    "I2":        0xB,
    "I1":        0xC,
    "ALPHA4":    0xD,
    "ALPHA2":    0xE,
    "ALPHA1":    0xF,
}

# Bits per pixel for each format.
BITS_PER_PIXEL = {
    "ALPHA8":    8,
    "RGB565":    16,
    "ARGB8888":  32,
    "RGB888":    32,
    "ARGB4444":  16,
    "ARGB1555":  16,
    "AI44":      8,
    "RGBA8888":  32,
    "RGBA4444":  16,
    "RGBA5551":  16,
    "I8":        8,
    "I4":        4,
    "I2":        2,
    "I1":        1,
    "ALPHA4":    4,
    "ALPHA2":    2,
    "ALPHA1":    1,
}

# Indexed (CLUT) formats and their palette sizes.
INDEXED_FORMATS = {"I8", "I4", "I2", "I1", "AI44"}
INDEXED_COLOR_COUNT = {
    "I8": 256,
    "I4": 16,
    "I2": 4,
    "I1": 2,
    "AI44": 16,
}

# ----------------------------
# Load an Adobe .act palette file.
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
        r = data[i*3]
        g = data[i*3 + 1]
        b = data[i*3 + 2]
        palette.append((r, g, b, 255))
    return palette

# ----------------------------
# Rotate image (rotation: 0,1,2,3 => 0°, 90°, 180°, 270° clockwise).
def apply_rotation(image, rotation):
    if rotation == 0:
        return image
    elif rotation == 1:
        return image.rotate(-90, expand=True)
    elif rotation == 2:
        return image.rotate(180, expand=True)
    elif rotation == 3:
        return image.rotate(-270, expand=True)
    else:
        raise ValueError("Invalid rotation value: " + str(rotation))

# ----------------------------
# Vectorized sRGB to CIELAB conversion.
def rgb_to_lab_np(rgb):
    """
    Converts an array of RGB values (shape (..., 3)) in [0,255] to Lab.
    """
    rgb = rgb / 255.0
    # Gamma correction.
    mask = rgb <= 0.04045
    linear = np.where(mask, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    # Convert to XYZ using D65.
    M = np.array([[0.4124, 0.3576, 0.1805],
                  [0.2126, 0.7152, 0.0722],
                  [0.0193, 0.1192, 0.9505]])
    orig_shape = linear.shape
    linear_flat = linear.reshape(-1, 3)
    XYZ = np.dot(linear_flat, M.T).reshape(orig_shape)
    X = XYZ[..., 0] / 0.95047
    Y = XYZ[..., 1] / 1.00000
    Z = XYZ[..., 2] / 1.08883
    # Helper function for f(t)
    def f(t):
        return np.where(t > 0.008856, np.cbrt(t), 7.787 * t + 16/116)
    fX = f(X)
    fY = f(Y)
    fZ = f(Z)
    L = 116 * fY - 16
    a = 500 * (fX - fY)
    b = 200 * (fY - fZ)
    lab = np.stack([L, a, b], axis=-1)
    return lab

# ----------------------------
# Compute palette indices for an image using a KD-tree with caching via unique pixels.
def compute_palette_indices_vectorized(image_np, tree):
    """
    Given an image as a NumPy array of shape (H, W, 4) in RGBA,
    returns a (H, W) array of palette indices.
    Pixels with alpha < 128 get index 0.
    This function uses np.unique to cache conversions.
    """
    flat_pixels = image_np.reshape(-1, 4)
    unique_pixels, inverse = np.unique(flat_pixels, axis=0, return_inverse=True)
    unique_indices = np.zeros(unique_pixels.shape[0], dtype=np.uint8)
    mask = unique_pixels[:, 3] >= 128
    if np.any(mask):
        rgb = unique_pixels[mask, :3].astype(np.float32)
        lab = rgb_to_lab_np(rgb)
        # Query the KD-tree built from the subpalette.
        _, nn_indices = tree.query(lab)
        unique_indices[mask] = nn_indices.astype(np.uint8)
    unique_indices[~mask] = 0
    return unique_indices[inverse].reshape(image_np.shape[0], image_np.shape[1])

# ----------------------------
# Helper: Pack a list of values (each fitting in "bits" bits) into a bytearray.
def pack_pixels(values, bits):
    out = bytearray()
    current_byte = 0
    bits_filled = 0
    for val in values:
        current_byte |= (val & ((1 << bits) - 1)) << bits_filled
        bits_filled += bits
        while bits_filled >= 8:
            out.append(current_byte & 0xFF)
            current_byte >>= 8
            bits_filled -= 8
    if bits_filled > 0:
        out.append(current_byte & 0xFF)
    return out

# ----------------------------
# Helper: Convert one pixel (RGBA tuple) to a non-indexed pixel value.
def convert_pixel_non_indexed(pixel, fmt):
    r, g, b, a = pixel
    if fmt == "ALPHA8":
        return struct.pack("B", a)
    elif fmt == "RGB565":
        r5 = r >> 3
        g6 = g >> 2
        b5 = b >> 3
        value = (r5 << 11) | (g6 << 5) | b5
        return struct.pack("<H", value)
    elif fmt == "ARGB8888":
        return struct.pack("4B", b, g, r, a)
    elif fmt == "RGB888":
        return struct.pack("4B", b, g, r, 0)
    elif fmt == "ARGB4444":
        a4 = a >> 4
        r4 = r >> 4
        g4 = g >> 4
        b4 = b >> 4
        value = (a4 << 12) | (r4 << 8) | (g4 << 4) | b4
        return struct.pack("<H", value)
    elif fmt == "ARGB1555":
        a1 = 1 if a >= 128 else 0
        r5 = r >> 3
        g5 = g >> 3
        b5 = b >> 3
        value = (a1 << 15) | (r5 << 10) | (g5 << 5) | b5
        return struct.pack("<H", value)
    elif fmt == "RGBA8888":
        return struct.pack("4B", a, b, g, r)
    elif fmt == "RGBA4444":
        r4 = r >> 4
        g4 = g >> 4
        b4 = b >> 4
        a4 = a >> 4
        value = (r4 << 12) | (g4 << 8) | (b4 << 4) | a4
        return struct.pack("<H", value)
    elif fmt == "RGBA5551":
        r5 = r >> 3
        g5 = g >> 3
        b5 = b >> 3
        a1 = 1 if a >= 128 else 0
        value = (r5 << 11) | (g5 << 6) | (b5 << 1) | a1
        return struct.pack("<H", value)
    else:
        raise ValueError("Unsupported non-indexed format: " + fmt)

# ----------------------------
# Helper: Apply TGA-style RLE compression (only for I8).
def apply_rle_compression_bytes(data, bytes_per_pixel):
    # Split data into chunks of size bytes_per_pixel.
    chunks = [data[i:i+bytes_per_pixel] for i in range(0, len(data), bytes_per_pixel)]
    compressed = bytearray()
    i = 0
    n = len(chunks)
    while i < n:
        run_length = 1
        while i + run_length < n and run_length < 128 and chunks[i] == chunks[i + run_length]:
            run_length += 1
        if run_length > 1:
            header = 0x80 | (run_length - 1)
            compressed.append(header)
            compressed.extend(chunks[i])
            i += run_length
        else:
            raw_chunks = [chunks[i]]
            i += 1
            while i < n and len(raw_chunks) < 128:
                if i + 1 < n and chunks[i] == chunks[i+1]:
                    break
                raw_chunks.append(chunks[i])
                i += 1
            header = (len(raw_chunks) - 1) & 0x7F
            compressed.append(header)
            for ch in raw_chunks:
                compressed.extend(ch)
    return compressed

# ----------------------------
# Generate preview image (vectorized conversion for indexed formats).
def generate_preview(image, palette, slot, pixel_format):
    """
    Returns a Pillow RGBA image showing the result of reducing the image's colors
    using the provided palette. Pixels with alpha < 128 are shown as opaque magenta.
    """
    image = image.convert("RGBA")
    img_np = np.array(image)
    h, w, _ = img_np.shape
    color_count = INDEXED_COLOR_COUNT[pixel_format]
    subpalette = palette[slot * color_count : slot * color_count + color_count]
    # Build a (color_count, 3) array from subpalette (ignore alpha).
    subpalette_rgb = np.array([p[:3] for p in subpalette], dtype=np.float32)
    subpalette_lab = rgb_to_lab_np(subpalette_rgb)
    tree = cKDTree(subpalette_lab)
    # Compute palette indices for the image.
    indices = compute_palette_indices_vectorized(img_np, tree)
    # Build preview image.
    preview = np.zeros((h, w, 4), dtype=np.uint8)
    # For pixels with low alpha, show magenta.
    mask = img_np[..., 3] < 128
    preview[mask] = np.array([255, 0, 255, 255], dtype=np.uint8)
    # For the rest, assign the subpalette color corresponding to the computed index.
    subpalette_arr = np.array(subpalette, dtype=np.uint8)  # shape (color_count, 4)
    non_mask = ~mask
    preview[non_mask] = subpalette_arr[indices[non_mask]]
    return Image.fromarray(preview, "RGBA")

# ----------------------------
# Main conversion function.
def get_data(image, rotation, palette, slot, rle, pixel_format):
    """
    Converts the image (a Pillow Image object) into the custom texture data.
    
    Parameters:
      image        - Pillow Image.
      rotation     - 0,1,2,3 (rotate 0°, 90°, 180°, 270° clockwise).
      palette      - list of (R,G,B,A) tuples (from .act file).
      slot         - Palette slot index (0-indexed).
      rle          - Boolean; apply TGA-style RLE (only for I8 images).
      pixel_format - One of the keys in FORMAT_ENUM.
    
    Returns a bytes object containing the header and pixel data.
    """
    image = image.convert("RGBA")
    image = apply_rotation(image, rotation)
    width, height = image.size

    base_format = FORMAT_ENUM.get(pixel_format)
    if base_format is None:
        raise ValueError("Unknown pixel format: " + pixel_format)
    # RLE is only applied for I8.
    rle_bit = 1 if (rle and pixel_format == "I8") else 0
    clut_bit = 1 if (pixel_format in INDEXED_FORMATS) else 0
    format_byte = (base_format & 0x0F) | (rle_bit << 4) | (clut_bit << 5)
    header = bytearray()
    header.extend(b"D2")
    header.extend(struct.pack("<H", width))
    header.extend(struct.pack("<H", height))
    header.extend(b"\x00\x00")
    header.append(format_byte)
    header.append(rotation)
    header.append(slot)
    header.extend(b"\x00\x00\x00")
    
    pixels = list(image.getdata())
    pixel_data = bytearray()
    bpp = BITS_PER_PIXEL[pixel_format]

    if pixel_format in INDEXED_FORMATS:
        color_count = INDEXED_COLOR_COUNT[pixel_format]
        subpalette = palette[slot * color_count : slot * color_count + color_count]
        subpalette_rgb = np.array([p[:3] for p in subpalette], dtype=np.float32)
        subpalette_lab = rgb_to_lab_np(subpalette_rgb)
        tree = cKDTree(subpalette_lab)
        img_np = np.array(image)  # shape (H, W, 4)
        indices = compute_palette_indices_vectorized(img_np, tree).flatten()
        if pixel_format == "AI44":
            # For AI44: high nibble = alpha >> 4, low nibble = palette index.
            alpha_nibble = (img_np[..., 3].flatten() >> 4) & 0x0F
            values = ((alpha_nibble << 4) | (indices & 0x0F)).astype(np.uint8)
            pixel_data.extend(values.tobytes())
        else:
            if bpp == 8:
                pixel_data.extend(indices.tobytes())
            else:
                pixel_data.extend(pack_pixels(indices.tolist(), bpp))
    else:
        if bpp % 8 == 0:
            chunks = []
            for px in pixels:
                chunks.append(convert_pixel_non_indexed(px, pixel_format))
            pixel_data = bytearray(b"".join(chunks))
        else:
            values = []
            for px in pixels:
                a = px[3]
                if pixel_format == "ALPHA4":
                    val = a >> 4
                elif pixel_format == "ALPHA2":
                    val = a >> 6
                elif pixel_format == "ALPHA1":
                    val = 1 if a >= 128 else 0
                else:
                    raise ValueError("Unsupported sub-byte format: " + pixel_format)
                values.append(val)
            pixel_data.extend(pack_pixels(values, bpp))

    # Apply RLE compression only for I8 images.
    if rle and pixel_format == "I8":
        pixel_data = apply_rle_compression_bytes(pixel_data, 1)
    
    header.extend(pixel_data)
    return bytes(header)

# ----------------------------
# Main entry point.
def main():
    parser = argparse.ArgumentParser(description="Convert an image to a custom texture format.")
    parser.add_argument("--image", required=True, help="Input image file (e.g. PNG)")
    parser.add_argument("--palette", required=True, help="Palette file in .act format")
    parser.add_argument("--rotation", type=int, default=0, choices=[0, 1, 2, 3],
                        help="Rotation: 0 (none), 1 (90° cw), 2 (180°), 3 (270° cw)")
    parser.add_argument("--slot", type=int, default=0, help="Palette slot index (0-indexed)")
    parser.add_argument("--rle", action="store_true", help="Apply TGA-style RLE (only for I8 images)")
    parser.add_argument("--format", required=True, choices=list(FORMAT_ENUM.keys()),
                        help="Pixel format (e.g. I8, I4, RGB565, ARGB8888, etc.)")
    parser.add_argument("--output", required=True, help="Output file name")
    parser.add_argument("--preview", action="store_true", help="Display a preview of the color conversion")
    args = parser.parse_args()

    img = Image.open(args.image)
    pal = load_act_palette(args.palette)

    if args.preview:
        if args.format in INDEXED_FORMATS:
            preview_img = generate_preview(apply_rotation(img, args.rotation), pal, args.slot, args.format)
        else:
            preview_img = apply_rotation(img, args.rotation).convert("RGBA")
        preview_img.show()

    data = get_data(img, args.rotation, pal, args.slot, args.rle, args.format)

    with open(args.output, "wb") as f:
        f.write(data)
    
    print(f"Conversion complete. Wrote {len(data)} bytes to {args.output}.")

if __name__ == "__main__":
    main()
