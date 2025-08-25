# D2 Texture Format Documentation

## Overview

The D2 texture format is a custom binary format designed for efficient storage and rendering of textures in the Dave2D game engine. This format supports various pixel formats, compression options, and rendering flags.

## File Structure

### Header (25 bytes)

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0-1    | 2    | char[2] | Magic identifier "D2" |
| 2-3    | 2    | uint16 | Texture width in pixels |
| 4-5    | 2    | uint16 | Texture height in pixels |
| 6      | 1    | uint8 | Prerotation setting |
| 7      | 1    | uint8 | Flags (see Flags enum) |
| 8      | 1    | uint8 | Texture format (see format encoding below) |
| 9-24   | 16   | char[16] | Palette name (null-terminated, no path/extension) |

### Texture Format Encoding (Byte 8)

The texture format byte encodes multiple pieces of information:

- **Bits 0-3**: Base texture format (see `Dave2dTextureFormat` enum)
- **Bit 4**: Reserved
- **Bit 5**: RLE compression flag (1 = RLE compressed, 0 = uncompressed)
- **Bit 6**: Indexed color flag (1 = indexed/palette-based, 0 = direct color)
- **Bit 7**: Reserved

### Palette Name Field (Bytes 9-24)

The palette name field stores the name of the palette resource to use when rendering indexed color textures. This field has the following characteristics:

- **Length**: 16 bytes (128 bits) maximum
- **Encoding**: ASCII/UTF-8 null-terminated string
- **Content**: Resource name only (no path, no file extension)
- **Uniqueness**: Palette names must be unique within the palette resource group
- **Usage**: Only relevant for indexed color formats (I1, I2, I4, I8)
- **Default**: Empty string (all zeros) indicates no specific palette or default palette

Examples:
- `"game_sprites"` - Use the palette named "game_sprites"
- `"level1_bg"` - Use the palette named "level1_bg"
- `""` (empty) - Use default palette or no palette

**Note**: For non-indexed formats, this field should be set to all zeros but is ignored during rendering.

## Texture Formats

### Dave2dTextureFormat Enum

| Format | Value | Bits per Pixel | Description |
|--------|-------|----------------|-------------|
| ALPHA8 | 0b0000 | 8 | 8-bit alpha channel only |
| RGB565 | 0b0001 | 16 | 16-bit RGB (5:6:5 bit distribution) |
| ARGB8888 | 0b0010 | 32 | 32-bit ARGB (8:8:8:8) |
| RGB888 | 0b0010 | 32 | 24-bit RGB stored as 32-bit (same as ARGB8888) |
| ARGB4444 | 0b0011 | 16 | 16-bit ARGB (4:4:4:4) |
| RGB444 | 0b0011 | 16 | 12-bit RGB stored as 16-bit (same as ARGB4444) |
| ARGB1555 | 0b0100 | 16 | 16-bit ARGB (1:5:5:5) |
| RGB555 | 0b0100 | 16 | 15-bit RGB stored as 16-bit (same as ARGB1555) |
| AI44 | 0b0101 | 8 | 8-bit Alpha + Intensity (4:4) |
| RGBA8888 | 0b0110 | 32 | 32-bit RGBA (8:8:8:8) |
| RGBA4444 | 0b0111 | 16 | 16-bit RGBA (4:4:4:4) |
| RGBA5551 | 0b1000 | 16 | 16-bit RGBA (5:5:5:1) |
| I8 | 0b1001 | 8 | 8-bit indexed color (256 colors) |
| I4 | 0b1010 | 4 | 4-bit indexed color (16 colors) |
| I2 | 0b1011 | 2 | 2-bit indexed color (4 colors) |
| I1 | 0b1100 | 1 | 1-bit indexed color (2 colors) |
| ALPHA4 | 0b1101 | 4 | 4-bit alpha channel |
| ALPHA2 | 0b1110 | 2 | 2-bit alpha channel |
| ALPHA1 | 0b1111 | 1 | 1-bit alpha channel |

### Bits Per Pixel vs Pixels Per Byte

Note the distinction in the comments:
- **bpp** (bits per pixel): How many bits each pixel requires
- **ppb** (pixels per byte): How many pixels fit in one byte

For sub-byte formats:
- 4-bit formats: 2 pixels per byte
- 2-bit formats: 4 pixels per byte  
- 1-bit formats: 8 pixels per byte

## Flags

The flags byte (offset 7) controls texture sampling and wrapping behavior:

| Flag | Value | Description |
|------|-------|-------------|
| wrapu | 0x01 | Enable U-coordinate wrapping |
| wrapv | 0x02 | Enable V-coordinate wrapping |
| filteru | 0x04 | Enable U-coordinate filtering |
| filterv | 0x08 | Enable V-coordinate filtering |
| filter | 0x0C | Enable both U and V filtering (filteru \| filterv) |

## Data Layout

After the 9-byte header, the texture data follows immediately. The data layout depends on the format:

### Direct Color Formats
For non-indexed formats, pixel data is stored sequentially, row by row, left to right.

### Indexed Color Formats
For indexed formats (I8, I4, I2, I1), the data section contains:
1. **Palette data**: Color entries in RGBA8888 format
   - I8: 256 entries (1024 bytes)
   - I4: 16 entries (64 bytes)
   - I2: 4 entries (16 bytes)
   - I1: 2 entries (8 bytes)
2. **Index data**: Pixel indices into the palette

### Compression
When RLE compression is enabled (bit 5 set), the pixel/index data is compressed using Run-Length Encoding.

## Example Usage

```cpp
class Texture
{
    enum class Dave2dTextureFormat
    {
        ALPHA8        = 0b0000, // 8 bpp
        RGB565        = 0b0001, // 16 bpp
        ARGB8888      = 0b0010, // 32 bpp
        RGB888        = 0b0010, // 32 bpp (same as ARGB8888)
        ARGB4444      = 0b0011, // 16 bpp
        RGB444        = 0b0011, // 16 bpp (same as ARGB4444)
        ARGB1555      = 0b0100, // 16 bpp
        RGB555        = 0b0100, // 16 bpp (same as ARGB1555)
        AI44          = 0b0101, // 8 bpp
        RGBA8888      = 0b0110, // 32 bpp
        RGBA4444      = 0b0111, // 16 bpp
        RGBA5551      = 0b1000, // 16 bpp
        I8            = 0b1001, // 8 bpp (8-bit indexed color)
        I4            = 0b1010, // 4 bpp (4-bit indexed color)
        I2            = 0b1011, // 2 bpp (2-bit indexed color)
        I1            = 0b1100, // 1 bpp (1-bit indexed color)
        ALPHA4        = 0b1101, // 4 bpp
        ALPHA2        = 0b1110, // 2 bpp
        ALPHA1        = 0b1111  // 1 bpp
    };

    enum class Flags
    {
        wrapu    = 1u,
        wrapv    = 2u,
        filteru  = 4u,
        filterv  = 8u,
        filter   = 12u,
    };
};
```

## Implementation Notes

- All multi-byte values are stored in little-endian format
- Indexed formats require palette data to be included
- Sub-byte formats pack multiple pixels into single bytes
- RLE compression can be applied to any format
- The prerotation setting allows for optimized texture orientation

## File Size Calculation

For uncompressed textures:
```
File Size = Header (25 bytes) + Palette Size + Pixel Data Size

Where:
- Palette Size = 0 (for direct color) or entries × 4 bytes (for indexed)
- Pixel Data Size = (width × height × bits_per_pixel + 7) / 8
```

For RLE compressed textures, the actual file size will vary based on compression efficiency.

## JavaScript API Usage

### Creating D2 Textures with Palette Names

```javascript
// Create ImageData and load source texture
const imageData = new ImageData();
await imageData.loadFromFile(sourceFile);

// Export as indexed D2 texture with palette name
const d2Binary = imageData.exportToD2Binary({
  format: ImageData.D2_FORMAT.I8,        // 8-bit indexed
  paletteName: 'game_sprites',           // Palette resource name
  useRLE: true,                          // Enable compression
  flags: 0x01 | 0x02                     // WRAPU | WRAPV
});

// Export as direct color D2 texture (no palette name needed)
const d2Binary = imageData.exportToD2Binary({
  format: ImageData.D2_FORMAT.RGBA8888,  // 32-bit direct color
  paletteName: '',                       // Empty for direct color
  useRLE: false,
  flags: 0x0C                           // FILTER
});
```

### Loading D2 Textures

```javascript
// Load D2 texture file
const imageData = new ImageData();
await imageData.loadFromD2Binary(d2FileBuffer);

// Access palette name from metadata
const paletteName = imageData.metadata.paletteName;
console.log(`Texture uses palette: ${paletteName || '(none)'}`);

// Check if texture is indexed and needs palette
if (imageData.metadata.isIndexed && paletteName) {
  // Load the specified palette resource
  const palette = await loadPaletteResource(paletteName);
  // Use palette for rendering
}
```
