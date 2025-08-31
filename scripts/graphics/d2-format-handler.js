/**
 * D2FormatHandler - D2 texture format loading, export, and conversion utilities
 * 
 * Extracted from ImageData clas    // Load palette if present
    let palette = null;
    if (isIndexed) {
      console.log(`[D2FormatHandler] Loading palette for indexed format ${baseFormat}`);
      const paletteSize = this.getPaletteSize(baseFormat);
      console.log(`[D2FormatHandler] Expected palette size: ${paletteSize} colors`);
      palette = new Array(paletteSize);
      
      for (let i = 0; i < paletteSize; i++) {
        const r = view.getUint8(offset++);
        const g = view.getUint8(offset++);
        const b = view.getUint8(offset++);
        const a = view.getUint8(offset++);
        palette[i] = {r, g, b, a};
      }
      
      metadata.palette = palette;
      console.log(`[D2FormatHandler] Loaded palette with ${paletteSize} colors`);
      console.log(`[D2FormatHandler] First few palette colors:`, palette.slice(0, Math.min(4, paletteSize)));
    }sed D2 texture format handling
 * with clean separation of concerns for binary format operations.
 */
class D2FormatHandler {
  
  constructor() {
    // Cache for format conversions to improve performance
    this.formatCache = new Map();
  }

  // ===== D2 FORMAT CONSTANTS =====

  /**
   * D2 Texture Format Constants
   */
  static get D2_FORMAT() {
    return {
      ALPHA8: 0b0000,
      RGB565: 0b0001,
      ARGB8888: 0b0010,
      RGB888: 0b0010,
      ARGB4444: 0b0011,
      RGB444: 0b0011,
      ARGB1555: 0b0100,
      RGB555: 0b0100,
      AI44: 0b0101,
      RGBA8888: 0b0110,
      RGBA4444: 0b0111,
      RGBA5551: 0b1000,
      I8: 0b1001,
      I4: 0b1010,
      I2: 0b1011,
      I1: 0b1100,
      ALPHA4: 0b1101,
      ALPHA2: 0b1110,
      ALPHA1: 0b1111
    };
  }

  /**
   * D2 Texture Flags
   */
  static get D2_FLAGS() {
    return {
      WRAPU: 0x01,
      WRAPV: 0x02,
      FILTERU: 0x04,
      FILTERV: 0x08,
      FILTER: 0x0C,
      RLE_COMPRESSED: 0x20,
      INDEXED_COLOR: 0x40
    };
  }

  /**
   * D2 Header Size in bytes
   */
  static get D2_HEADER_SIZE() {
    return 25; // 2 (magic) + 2 (width) + 2 (height) + 1 (prerotation) + 1 (flags) + 1 (format) + 16 (palette name)
  }

  // ===== LOADING METHODS =====

  /**
   * Load from D2 texture format binary data
   * @param {ArrayBuffer} arrayBuffer - D2 binary data
   * @returns {Object} Parsed D2 data with metadata, frames, etc.
   */
  loadFromD2Binary(arrayBuffer) {
    console.log('[D2FormatHandler] Loading D2 texture format');
    
    const view = new DataView(arrayBuffer);
    let offset = 0;
    
    // Check magic identifier "D2"
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1));
    if (magic !== 'D2') {
      throw new Error('Invalid D2 texture format: Missing D2 magic identifier');
    }
    offset += 2;
    
    // Read header
    const width = view.getUint16(offset, true); // little endian
    offset += 2;
    const height = view.getUint16(offset, true);
    offset += 2;
    
    const prerotation = view.getUint8(offset++);
    const flags = view.getUint8(offset++);
    const formatByte = view.getUint8(offset++);
    
    // Read palette name (16 bytes)
    let paletteName = '';
    const paletteNameBytes = new Uint8Array(arrayBuffer, offset, 16);
    for (let i = 0; i < 16; i++) {
      const byte = paletteNameBytes[i];
      if (byte === 0) break; // null terminator
      paletteName += String.fromCharCode(byte);
    }
    offset += 16;
    
    // Decode format byte
    const baseFormat = formatByte & 0x0F;
    const isRLE = (formatByte & 0x20) !== 0;
    const isIndexed = (formatByte & 0x40) !== 0;
    
    // Debug the bitwise operations step by step
    const formatByteBinary = formatByte.toString(2).padStart(8, '0');
    const mask40Binary = (0x40).toString(2).padStart(8, '0');
    const andResult = formatByte & 0x40;
    const andResultBinary = andResult.toString(2).padStart(8, '0');
    
    console.log(`[D2FormatHandler] D2 Header: ${width}x${height}, format: ${baseFormat}, RLE: ${isRLE}, indexed: ${isIndexed}, palette: "${paletteName}"`);
    console.log(`[D2FormatHandler] Debug format parsing: formatByte=0x${formatByte.toString(16)}, baseFormat=${baseFormat}, isIndexed=${isIndexed}, expectedIndexed=${baseFormat >= 9}`);
    console.log(`[D2FormatHandler] Bitwise debug: formatByte=${formatByteBinary} (0x${formatByte.toString(16)}), mask=0x40=${mask40Binary}, AND result=${andResultBinary} (0x${andResult.toString(16)}), !== 0 = ${andResult !== 0}`);
    
    // Store metadata
    const metadata = {
      format: 'd2',
      prerotation,
      flags,
      baseFormat,
      isRLE,
      isIndexed,
      formatByte,
      paletteName
    };
    
    // Read palette data if indexed
    let palette = null;
    if (isIndexed) {
      const paletteSize = this.getD2PaletteSize(baseFormat);
      palette = new Array(paletteSize);
      
      for (let i = 0; i < paletteSize; i++) {
        const r = view.getUint8(offset++);
        const g = view.getUint8(offset++);
        const b = view.getUint8(offset++);
        const a = view.getUint8(offset++);
        palette[i] = {r, g, b, a};
      }
      
      metadata.palette = palette;
      console.log(`[D2FormatHandler] Loaded palette with ${paletteSize} colors`);
    }
    
    // Read pixel data
    const remainingBytes = arrayBuffer.byteLength - offset;
    const pixelData = new Uint8Array(arrayBuffer, offset, remainingBytes);
    
    // Decompress if RLE
    let decompressedData = pixelData;
    if (isRLE) {
      decompressedData = this.decompressRLE(pixelData);
      console.log(`[D2FormatHandler] RLE decompressed ${pixelData.length} -> ${decompressedData.length} bytes`);
    }
    
    // Create frame data with the raw D2 pixel data 
    const frames = [{
      data: decompressedData,  // Raw D2 pixel data
      width: width,
      height: height,
      delay: 0
    }];
    
    console.log(`[D2FormatHandler] Successfully loaded D2 texture: ${width}x${height}`);
    
    return {
      width,
      height,
      frames,
      metadata,
      baseFormat,
      isIndexed,
      palette,
      paletteName,
      format: 'd2'  // This indicates the frames contain raw D2 data
    };
  }

  // ===== EXPORT METHODS =====

  /**
   * Export to D2 texture format binary data
   * @param {Uint8Array} rgbaData - Source RGBA data
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @param {Object} options - Export options
   * @returns {ArrayBuffer} D2 binary data
   */
  exportToD2Binary(rgbaData, width, height, options = {}) {
    const {
      format: rawFormat = D2FormatHandler.D2_FORMAT.RGBA8888,
      useRLE = false,
      flags = 0,
      prerotation = 0,
      palette = null,
      paletteOffset = 0,
      paletteName = '',
      reserveTransparency = false  // New option: whether to reserve index 0 for transparency
    } = options;
    
    // Convert string format to numeric constant if needed
    const format = typeof rawFormat === 'string' 
      ? D2FormatHandler.getD2FormatFromInternal(rawFormat)
      : rawFormat;
    
    // Auto-extract palette name if palette object has one and paletteName wasn't explicitly provided
    let finalPaletteName = paletteName;
    if (!finalPaletteName && palette && palette.name) {
      finalPaletteName = palette.name;
      console.log(`[D2FormatHandler] Auto-extracted palette name from palette object: "${finalPaletteName}"`);
    }
    
    console.log('[D2FormatHandler] Exporting to D2 texture format');
    console.log('[D2FormatHandler] Export options:', options);
    console.log('[D2FormatHandler] Final format being used:', format);
    console.log('[D2FormatHandler] Final palette name being used:', finalPaletteName);
    
    if (!rgbaData || !width || !height) {
      throw new Error('Invalid image data for D2 export');
    }
    
    // Determine if format is indexed
    const isIndexed = [
      D2FormatHandler.D2_FORMAT.I8,
      D2FormatHandler.D2_FORMAT.I4,
      D2FormatHandler.D2_FORMAT.I2,
      D2FormatHandler.D2_FORMAT.I1,
      D2FormatHandler.D2_FORMAT.AI44
    ].includes(format);
    
    // Convert RGBA to target format
    let pixelData, exportPalette;
    if (isIndexed) {
      console.log(`[D2FormatHandler] Converting to indexed format with palette:`, !!palette);
      if (palette) {
        const paletteColors = palette.colors || palette;
        console.log(`[D2FormatHandler] Palette has ${Array.isArray(paletteColors) ? paletteColors.length : 'no'} colors`);
      }
      const result = this.convertRGBAToD2Indexed(rgbaData, format, palette, options.reserveTransparency, paletteOffset);
      pixelData = result.pixelData;
      exportPalette = result.palette;
    } else {
      console.log(`[D2FormatHandler] Converting to direct color format`);
      pixelData = this.convertRGBAToD2Direct(rgbaData, format);
      console.log(`[D2FormatHandler] Direct conversion result: ${pixelData.length} bytes for format ${format}`);
      exportPalette = null;
    }
    
    // Compress if requested
    let finalPixelData = pixelData;
    let finalFlags = flags;
    if (useRLE) {
      finalPixelData = this.compressRLE(pixelData);
      finalFlags |= D2FormatHandler.D2_FLAGS.RLE_COMPRESSED;
      console.log(`[D2FormatHandler] RLE compressed ${pixelData.length} -> ${finalPixelData.length} bytes`);
    }
    
    if (isIndexed) {
      finalFlags |= D2FormatHandler.D2_FLAGS.INDEXED_COLOR;
    }
    
    // Calculate buffer size
    const paletteSize = exportPalette ? exportPalette.length * 4 : 0; // 4 bytes per color (RGBA)
    const totalSize = D2FormatHandler.D2_HEADER_SIZE + paletteSize + finalPixelData.length;
    
    // Create output buffer
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const uint8View = new Uint8Array(buffer);
    let offset = 0;
    
    // Write header
    // Magic identifier "D2"
    view.setUint8(offset++, 'D'.charCodeAt(0));
    view.setUint8(offset++, '2'.charCodeAt(0));
    
    // Dimensions
    view.setUint16(offset, width, true); // little endian
    offset += 2;
    view.setUint16(offset, height, true);
    offset += 2;
    
    // Properties
    view.setUint8(offset++, prerotation);
    view.setUint8(offset++, finalFlags);
    
    // Build format byte with indexed flag for indexed formats
    let formatByte = format;
    if ([D2FormatHandler.D2_FORMAT.I8, D2FormatHandler.D2_FORMAT.I4, 
         D2FormatHandler.D2_FORMAT.I2, D2FormatHandler.D2_FORMAT.I1,
         D2FormatHandler.D2_FORMAT.AI44].includes(format)) {
      formatByte |= 0x40; // Set indexed flag bit
    }
    view.setUint8(offset++, formatByte);
    
    // Palette name (16 bytes, null-terminated)
    const nameBytes = new TextEncoder().encode(finalPaletteName.slice(0, 15));
    for (let i = 0; i < 16; i++) {
      view.setUint8(offset++, i < nameBytes.length ? nameBytes[i] : 0);
    }
    
    // Write palette if indexed
    if (exportPalette) {
      for (const color of exportPalette) {
        view.setUint8(offset++, color.r);
        view.setUint8(offset++, color.g);
        view.setUint8(offset++, color.b);
        view.setUint8(offset++, color.a);
      }
    }
    
    // Write pixel data
    uint8View.set(finalPixelData, offset);
    
    console.log(`[D2FormatHandler] Successfully exported D2 texture: ${width}x${height}, ${totalSize} bytes`);
    return buffer;
  }

  // ===== CONVERSION METHODS =====

  /**
   * Get palette size for a D2 format
   */
  getD2PaletteSize(format) {
    switch (format) {
      case D2FormatHandler.D2_FORMAT.I1: return 2;
      case D2FormatHandler.D2_FORMAT.I2: return 4;
      case D2FormatHandler.D2_FORMAT.I4: return 16;
      case D2FormatHandler.D2_FORMAT.I8: return 256;
      case D2FormatHandler.D2_FORMAT.AI44: return 16; // 4-bit palette
      default: return 0;
    }
  }

  /**
   * Convert D2 pixel data to RGBA
   */
  convertD2ToRGBA(pixelData, format, palette = null) {
    if (!pixelData) {
      throw new Error(`[D2FormatHandler] convertD2ToRGBA: pixelData is ${pixelData} - no fallback allowed`);
    }
    
    if (format === undefined || format === null) {
      throw new Error(`[D2FormatHandler] convertD2ToRGBA: format is ${format} - no fallback allowed`);
    }
    
    console.log(`[D2FormatHandler] Converting D2 format ${format}, input size: ${pixelData.length} bytes, palette: ${palette ? `${palette.length} colors` : 'none'}`);
    
    let pixelCount = 0;
    let rgbaData = null;
    
    switch (format) {
      case D2FormatHandler.D2_FORMAT.ALPHA8:
        pixelCount = pixelData.length;
        rgbaData = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
          const alpha = pixelData[i];
          rgbaData[i * 4] = 255;     // R
          rgbaData[i * 4 + 1] = 255; // G  
          rgbaData[i * 4 + 2] = 255; // B
          rgbaData[i * 4 + 3] = alpha; // A
        }
        break;
        
      case D2FormatHandler.D2_FORMAT.RGB565:
        pixelCount = pixelData.length / 2;
        rgbaData = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
          const pixel = (pixelData[i * 2 + 1] << 8) | pixelData[i * 2];
          const r = ((pixel >> 11) & 0x1F) << 3; // 5 bits to 8 bits
          const g = ((pixel >> 5) & 0x3F) << 2;  // 6 bits to 8 bits  
          const b = (pixel & 0x1F) << 3;         // 5 bits to 8 bits
          rgbaData[i * 4] = r;
          rgbaData[i * 4 + 1] = g;
          rgbaData[i * 4 + 2] = b;
          rgbaData[i * 4 + 3] = 255;
        }
        break;
        
      case D2FormatHandler.D2_FORMAT.RGBA8888:
        // Direct RGBA copy
        rgbaData = new Uint8Array(pixelData);
        break;
        
      case D2FormatHandler.D2_FORMAT.RGBA4444:
        pixelCount = pixelData.length / 2;
        rgbaData = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
          const pixel = (pixelData[i * 2 + 1] << 8) | pixelData[i * 2];
          const r = ((pixel >> 12) & 0x0F) << 4; // 4 bits to 8 bits
          const g = ((pixel >> 8) & 0x0F) << 4;  // 4 bits to 8 bits
          const b = ((pixel >> 4) & 0x0F) << 4;  // 4 bits to 8 bits
          const a = (pixel & 0x0F) << 4;         // 4 bits to 8 bits
          rgbaData[i * 4] = r;
          rgbaData[i * 4 + 1] = g;
          rgbaData[i * 4 + 2] = b;
          rgbaData[i * 4 + 3] = a;
        }
        break;
        
      case D2FormatHandler.D2_FORMAT.I8:
        // 8-bit indexed
        console.log(`[D2FormatHandler] Converting I8 format, palette available: ${!!palette}, palette size: ${palette ? palette.length : 0}`);
        if (palette) {
          console.log(`[D2FormatHandler] First palette color: {r:${palette[0].r}, g:${palette[0].g}, b:${palette[0].b}}`);
        }
        pixelCount = pixelData.length;
        rgbaData = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
          const paletteIndex = pixelData[i];
          if (palette && palette[paletteIndex]) {
            const color = palette[paletteIndex];
            if (paletteIndex === 0) {
              // Index 0 is the color key - should be transparent
              rgbaData[i * 4] = color.r;
              rgbaData[i * 4 + 1] = color.g;
              rgbaData[i * 4 + 2] = color.b;
              rgbaData[i * 4 + 3] = 0; // Fully transparent
            } else {
              // Regular palette color
              rgbaData[i * 4] = color.r;
              rgbaData[i * 4 + 1] = color.g;
              rgbaData[i * 4 + 2] = color.b;
              rgbaData[i * 4 + 3] = 255; // Fully opaque
            }
          } else {
            throw new Error(`[D2FormatHandler] No palette entry for index ${paletteIndex} in I8 format - no fallback allowed`);
          }
        }
        break;
        
      case D2FormatHandler.D2_FORMAT.I4:
        // 4-bit indexed, 2 pixels per byte
        pixelCount = pixelData.length * 2;
        rgbaData = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelData.length; i++) {
          const byte = pixelData[i];
          const pixel1 = (byte >> 4) & 0x0F;
          const pixel2 = byte & 0x0F;
          
          // First pixel
          if (palette && palette[pixel1]) {
            const color1 = palette[pixel1];
            if (pixel1 === 0) {
              // Index 0 is the color key - should be transparent
              rgbaData[i * 8] = color1.r;
              rgbaData[i * 8 + 1] = color1.g;
              rgbaData[i * 8 + 2] = color1.b;
              rgbaData[i * 8 + 3] = 0; // Fully transparent
            } else {
              rgbaData[i * 8] = color1.r;
              rgbaData[i * 8 + 1] = color1.g;
              rgbaData[i * 8 + 2] = color1.b;
              rgbaData[i * 8 + 3] = 255; // Fully opaque
            }
          } else {
            throw new Error(`[D2FormatHandler] No palette entry for index ${pixel1} in I4 format - no fallback allowed`);
          }
          
          // Second pixel
          if (palette && palette[pixel2]) {
            const color2 = palette[pixel2];
            if (pixel2 === 0) {
              // Index 0 is the color key - should be transparent
              rgbaData[i * 8 + 4] = color2.r;
              rgbaData[i * 8 + 5] = color2.g;
              rgbaData[i * 8 + 6] = color2.b;
              rgbaData[i * 8 + 7] = 0; // Fully transparent
            } else {
              rgbaData[i * 8 + 4] = color2.r;
              rgbaData[i * 8 + 5] = color2.g;
              rgbaData[i * 8 + 6] = color2.b;
              rgbaData[i * 8 + 7] = 255; // Fully opaque
            }
          } else {
            throw new Error(`[D2FormatHandler] No palette entry for index ${pixel2} in I4 format - no fallback allowed`);
          }
        }
        break;
        
      case D2FormatHandler.D2_FORMAT.I2:
        // 2-bit indexed, 4 pixels per byte
        pixelCount = pixelData.length * 4;
        rgbaData = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelData.length; i++) {
          const byte = pixelData[i];
          for (let j = 0; j < 4; j++) {
            const shift = (3 - j) * 2;
            const paletteIndex = (byte >> shift) & 0x03;
            const pixelOffset = (i * 4 + j) * 4;
            
            if (palette && palette[paletteIndex]) {
              const color = palette[paletteIndex];
              if (paletteIndex === 0) {
                // Index 0 is the color key - should be transparent
                rgbaData[pixelOffset] = color.r;
                rgbaData[pixelOffset + 1] = color.g;
                rgbaData[pixelOffset + 2] = color.b;
                rgbaData[pixelOffset + 3] = 0; // Fully transparent
              } else {
                rgbaData[pixelOffset] = color.r;
                rgbaData[pixelOffset + 1] = color.g;
                rgbaData[pixelOffset + 2] = color.b;
                rgbaData[pixelOffset + 3] = 255; // Fully opaque
              }
            } else {
              throw new Error(`[D2FormatHandler] No palette entry for index ${paletteIndex} in I2 format - no fallback allowed`);
            }
          }
        }
        break;
        
      case D2FormatHandler.D2_FORMAT.I1:
        // 1-bit indexed, 8 pixels per byte
        pixelCount = pixelData.length * 8;
        rgbaData = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelData.length; i++) {
          const byte = pixelData[i];
          for (let j = 0; j < 8; j++) {
            const paletteIndex = (byte >> (7 - j)) & 0x01;
            const pixelOffset = (i * 8 + j) * 4;
            
            if (palette && palette[paletteIndex]) {
              const color = palette[paletteIndex];
              if (paletteIndex === 0) {
                // Index 0 is the color key - should be transparent
                rgbaData[pixelOffset] = color.r;
                rgbaData[pixelOffset + 1] = color.g;
                rgbaData[pixelOffset + 2] = color.b;
                rgbaData[pixelOffset + 3] = 0; // Fully transparent
              } else {
                rgbaData[pixelOffset] = color.r;
                rgbaData[pixelOffset + 1] = color.g;
                rgbaData[pixelOffset + 2] = color.b;
                rgbaData[pixelOffset + 3] = 255; // Fully opaque
              }
            } else {
              throw new Error(`[D2FormatHandler] No palette entry for index ${paletteIndex} in I1 format - no fallback allowed`);
            }
          }
        }
        break;
        
      case D2FormatHandler.D2_FORMAT.ALPHA4:
        // 4-bit alpha, 2 pixels per byte
        pixelCount = pixelData.length * 2;
        rgbaData = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelData.length; i++) {
          const byte = pixelData[i];
          const alpha1 = ((byte >> 4) & 0x0F) << 4; // 4 bits to 8 bits
          const alpha2 = (byte & 0x0F) << 4;        // 4 bits to 8 bits
          
          // First pixel
          rgbaData[i * 8] = 255;       // R
          rgbaData[i * 8 + 1] = 255;   // G
          rgbaData[i * 8 + 2] = 255;   // B
          rgbaData[i * 8 + 3] = alpha1; // A
          
          // Second pixel
          rgbaData[i * 8 + 4] = 255;     // R
          rgbaData[i * 8 + 5] = 255;     // G
          rgbaData[i * 8 + 6] = 255;     // B
          rgbaData[i * 8 + 7] = alpha2;   // A
        }
        break;
        
      case D2FormatHandler.D2_FORMAT.ALPHA2:
        // 2-bit alpha, 4 pixels per byte
        pixelCount = pixelData.length * 4;
        rgbaData = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelData.length; i++) {
          const byte = pixelData[i];
          for (let j = 0; j < 4; j++) {
            const shift = (3 - j) * 2;
            const alpha = ((byte >> shift) & 0x03) << 6; // 2 bits to 8 bits
            const pixelOffset = (i * 4 + j) * 4;
            
            rgbaData[pixelOffset] = 255;       // R
            rgbaData[pixelOffset + 1] = 255;   // G
            rgbaData[pixelOffset + 2] = 255;   // B
            rgbaData[pixelOffset + 3] = alpha; // A
          }
        }
        break;
        
      case D2FormatHandler.D2_FORMAT.ALPHA1:
        // 1-bit alpha, 8 pixels per byte
        pixelCount = pixelData.length * 8;
        rgbaData = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelData.length; i++) {
          const byte = pixelData[i];
          for (let j = 0; j < 8; j++) {
            const alpha = ((byte >> (7 - j)) & 0x01) ? 255 : 0; // 1 bit to 8 bits
            const pixelOffset = (i * 8 + j) * 4;
            
            rgbaData[pixelOffset] = 255;       // R
            rgbaData[pixelOffset + 1] = 255;   // G
            rgbaData[pixelOffset + 2] = 255;   // B
            rgbaData[pixelOffset + 3] = alpha; // A
          }
        }
        break;
        
      case D2FormatHandler.D2_FORMAT.AI44:
        // 4-bit alpha + 4-bit indexed (alpha channel handles transparency, no color key needed)
        pixelCount = pixelData.length;
        rgbaData = new Uint8Array(pixelCount * 4);
        console.log(`[D2FormatHandler] Converting AI44: pixelData=${pixelData.length} bytes, expected pixels=${288*384}, got pixels=${pixelCount}`);
        
        for (let i = 0; i < pixelData.length; i++) {
          const byte = pixelData[i];
          const alphaIndex = (byte >> 4) & 0x0F;
          const colorIndex = byte & 0x0F;
          
          const alpha = (alphaIndex << 4) | alphaIndex; // 4 bits to 8 bits
          
          if (palette && palette[colorIndex]) {
            const color = palette[colorIndex];
            rgbaData[i * 4] = color.r;
            rgbaData[i * 4 + 1] = color.g;
            rgbaData[i * 4 + 2] = color.b;
            rgbaData[i * 4 + 3] = alpha; // Use AI44 alpha channel directly
          } else {
            throw new Error(`[D2FormatHandler] No palette entry for index ${colorIndex} in AI44 format - no fallback allowed`);
          }
        }
        break;
        
      default:
        throw new Error(`[D2FormatHandler] Unsupported D2 format for conversion: ${format} - no fallback allowed`);
    }
    
    return rgbaData;
  }

  /**
   * Convert RGBA to D2 indexed format
   */
  convertRGBAToD2Indexed(rgbaData, format, palette = null, reserveTransparency = false, paletteOffset = 0) {
    console.log(`[D2FormatHandler] Converting RGBA to indexed format ${format}`);
    console.log(`[D2FormatHandler] Indexed D2_FORMAT constants:`, {
      I8: D2FormatHandler.D2_FORMAT.I8,
      I4: D2FormatHandler.D2_FORMAT.I4,
      I2: D2FormatHandler.D2_FORMAT.I2,
      I1: D2FormatHandler.D2_FORMAT.I1,
      AI44: D2FormatHandler.D2_FORMAT.AI44
    });
    
    if (!palette) {
      const paletteSize = this.getD2PaletteSize(format);
      palette = this.generateDefaultPalette(paletteSize);
    }
    
    const paletteColors = palette.colors || palette;
    
    // Quantize palette to the correct size for this format
    const maxColors = this.getD2PaletteSize(format);
    
    // Create palette - either reserve index 0 for transparency or use palette as-is
    const indexedPalette = new Array(maxColors);
    
    if (reserveTransparency) {
      // Reserve index 0 for transparency (color key)
      const reservedTransparentSlot = 1;
      const availableColorSlots = maxColors - reservedTransparentSlot;
      
      indexedPalette[0] = { r: 255, g: 0, b: 255, a: 0 }; // Magenta transparent (color key)
      
      // Fill remaining slots with quantized colors starting from paletteOffset
      const quantizedColors = paletteColors.slice(paletteOffset, paletteOffset + availableColorSlots);
      for (let i = 0; i < quantizedColors.length; i++) {
        indexedPalette[i + 1] = quantizedColors[i];
      }
      
      // Fill any remaining slots with black
      for (let i = quantizedColors.length + 1; i < maxColors; i++) {
        indexedPalette[i] = { r: 0, g: 0, b: 0, a: 255 };
      }
      
      console.log(`[D2FormatHandler] Created indexed palette: ${maxColors} colors, index 0 = transparent, indices 1-${availableColorSlots} = colors from offset ${paletteOffset}`);
    } else {
      // Use palette starting from paletteOffset, preserving indices
      const quantizedColors = paletteColors.slice(paletteOffset, paletteOffset + maxColors);
      for (let i = 0; i < quantizedColors.length; i++) {
        indexedPalette[i] = quantizedColors[i];
      }
      
      // Fill any remaining slots with black
      for (let i = quantizedColors.length; i < maxColors; i++) {
        indexedPalette[i] = { r: 0, g: 0, b: 0, a: 255 };
      }
      
      console.log(`[D2FormatHandler] Created indexed palette: ${maxColors} colors, using palette from offset ${paletteOffset} (index 0 = ${indexedPalette[0] ? `{r:${indexedPalette[0].r}, g:${indexedPalette[0].g}, b:${indexedPalette[0].b}, a:${indexedPalette[0].a}}` : 'undefined'})`);
    }
    
    let pixelData;
    
    switch (format) {
      case D2FormatHandler.D2_FORMAT.I8:
        // 8-bit indexed, 1 pixel per byte
        pixelData = new Uint8Array(rgbaData.length / 4);
        for (let i = 0; i < rgbaData.length; i += 4) {
          const r = rgbaData[i];
          const g = rgbaData[i + 1];
          const b = rgbaData[i + 2];
          const a = rgbaData[i + 3];
          
          let index;
          if (a < 128) { // Transparent pixel
            index = 0; // Use color key index
          } else {
            // Find closest color in indices 1-255
            const colorPalette = indexedPalette.slice(1);
            index = this.findClosestPaletteIndex(r, g, b, colorPalette) + 1;
          }
          pixelData[i / 4] = index;
        }
        break;
        
      case D2FormatHandler.D2_FORMAT.I4:
        // 4-bit indexed, 2 pixels per byte
        const pixelCount = Math.floor(rgbaData.length / 4);
        pixelData = new Uint8Array(Math.ceil(pixelCount / 2));
        
        for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 2) {
          const byteIndex = Math.floor(pixelIndex / 2);
          
          // First pixel
          const i1 = pixelIndex * 4;
          const r1 = rgbaData[i1];
          const g1 = rgbaData[i1 + 1];
          const b1 = rgbaData[i1 + 2];
          const a1 = rgbaData[i1 + 3];
          
          let index1;
          if (a1 < 128) {
            index1 = 0; // Transparent
          } else {
            const colorPalette = indexedPalette.slice(1);
            index1 = this.findClosestPaletteIndex(r1, g1, b1, colorPalette) + 1;
            index1 = Math.min(index1, 15); // Clamp to 4 bits
          }
          
          // Second pixel (if it exists)
          let index2 = 0;
          if (pixelIndex + 1 < pixelCount) {
            const i2 = (pixelIndex + 1) * 4;
            const r2 = rgbaData[i2];
            const g2 = rgbaData[i2 + 1];
            const b2 = rgbaData[i2 + 2];
            const a2 = rgbaData[i2 + 3];
            
            if (a2 < 128) {
              index2 = 0; // Transparent
            } else {
              const colorPalette = indexedPalette.slice(1);
              index2 = this.findClosestPaletteIndex(r2, g2, b2, colorPalette) + 1;
              index2 = Math.min(index2, 15); // Clamp to 4 bits
            }
          }
          
          pixelData[byteIndex] = (index1 << 4) | index2;
        }
        break;
        
      case D2FormatHandler.D2_FORMAT.I2:
        // 2-bit indexed, 4 pixels per byte
        pixelData = new Uint8Array(Math.ceil((rgbaData.length / 4) / 4));
        for (let i = 0; i < rgbaData.length; i += 16) {
          let byte = 0;
          for (let j = 0; j < 4; j++) {
            const pixelOffset = i + j * 4;
            let index = 0;
            
            if (pixelOffset < rgbaData.length) {
              const r = rgbaData[pixelOffset];
              const g = rgbaData[pixelOffset + 1];
              const b = rgbaData[pixelOffset + 2];
              const a = rgbaData[pixelOffset + 3];
              
              if (a < 128) {
                index = 0; // Transparent
              } else {
                const colorPalette = indexedPalette.slice(1);
                index = this.findClosestPaletteIndex(r, g, b, colorPalette) + 1;
                index = index & 0x03; // Clamp to 2 bits
              }
              byte |= (index << ((3 - j) * 2));
            }
          }
          pixelData[i / 16] = byte;
        }
        break;
        
      case D2FormatHandler.D2_FORMAT.I1:
        // 1-bit indexed, 8 pixels per byte
        pixelData = new Uint8Array(Math.ceil((rgbaData.length / 4) / 8));
        for (let i = 0; i < rgbaData.length; i += 32) {
          let byte = 0;
          for (let j = 0; j < 8; j++) {
            const pixelOffset = i + j * 4;
            let index = 0;
            
            if (pixelOffset < rgbaData.length) {
              const r = rgbaData[pixelOffset];
              const g = rgbaData[pixelOffset + 1];
              const b = rgbaData[pixelOffset + 2];
              const a = rgbaData[pixelOffset + 3];
              
              if (a < 128) {
                index = 0; // Transparent
              } else {
                // For 1-bit, we only have index 0 (transparent) and index 1 (color)
                index = 1;
              }
              byte |= (index << (7 - j));
            }
          }
          pixelData[i / 32] = byte;
        }
        break;
        
      case D2FormatHandler.D2_FORMAT.AI44:
        // 4-bit alpha + 4-bit indexed, 1 pixel per byte (no color key needed - alpha channel handles transparency)
        pixelData = new Uint8Array(rgbaData.length / 4);
        for (let i = 0; i < rgbaData.length; i += 4) {
          const r = rgbaData[i];
          const g = rgbaData[i + 1];
          const b = rgbaData[i + 2];
          const a = rgbaData[i + 3];
          
          // Find closest color in all 16 palette indices (no color key reservation)
          const colorIndex = this.findClosestPaletteIndex(r, g, b, indexedPalette) & 0x0F; // Clamp to 4 bits
          const alphaIndex = (a >> 4) & 0x0F; // 8-bit alpha to 4-bit
          
          pixelData[i / 4] = (alphaIndex << 4) | colorIndex;
        }
        break;
        
      default:
        throw new Error(`[D2FormatHandler] Unsupported indexed format: ${format} - no fallback allowed`);
    }
    
    return {
      pixelData,
      palette: indexedPalette
    };
  }

  /**
   * Convert RGBA to D2 direct format
   */
  convertRGBAToD2Direct(rgbaData, format) {
    console.log(`[D2FormatHandler] convertRGBAToD2Direct called with format ${format}, input size ${rgbaData.length}`);
    console.log(`[D2FormatHandler] D2_FORMAT constants:`, {
      ALPHA8: D2FormatHandler.D2_FORMAT.ALPHA8,
      RGB565: D2FormatHandler.D2_FORMAT.RGB565,
      RGBA8888: D2FormatHandler.D2_FORMAT.RGBA8888,
      RGBA4444: D2FormatHandler.D2_FORMAT.RGBA4444,
      ALPHA4: D2FormatHandler.D2_FORMAT.ALPHA4,
      ALPHA2: D2FormatHandler.D2_FORMAT.ALPHA2,
      ALPHA1: D2FormatHandler.D2_FORMAT.ALPHA1
    });
    switch (format) {
      case D2FormatHandler.D2_FORMAT.ALPHA8:
        // Extract alpha channel only
        console.log(`[D2FormatHandler] Processing ALPHA8 format`);
        const alphaData = new Uint8Array(rgbaData.length / 4);
        for (let i = 0; i < rgbaData.length; i += 4) {
          alphaData[i / 4] = rgbaData[i + 3]; // Alpha channel
        }
        console.log(`[D2FormatHandler] ALPHA8 result: ${alphaData.length} bytes`);
        return alphaData;
        
      case D2FormatHandler.D2_FORMAT.RGB565:
        const rgb565Data = new Uint8Array(rgbaData.length / 2);
        for (let i = 0; i < rgbaData.length; i += 4) {
          let r = rgbaData[i];
          let g = rgbaData[i + 1];
          let b = rgbaData[i + 2];
          const a = rgbaData[i + 3];
          
          // Replace transparent pixels with magenta
          if (a < 128) { // Consider alpha < 50% as transparent
            r = 255; g = 0; b = 255; // Magenta
          }
          
          const r5 = r >> 3;     // 8 bits to 5 bits
          const g6 = g >> 2;     // 8 bits to 6 bits
          const b5 = b >> 3;     // 8 bits to 5 bits
          const pixel = (r5 << 11) | (g6 << 5) | b5;
          rgb565Data[(i / 4) * 2] = pixel & 0xFF;        // Low byte
          rgb565Data[(i / 4) * 2 + 1] = (pixel >> 8) & 0xFF; // High byte
        }
        return rgb565Data;
        
      case D2FormatHandler.D2_FORMAT.RGBA8888:
        return new Uint8Array(rgbaData);
        
      case D2FormatHandler.D2_FORMAT.RGBA4444:
        console.log(`[D2FormatHandler] Processing RGBA4444 format`);
        const rgba4444Data = new Uint8Array(rgbaData.length / 2);
        for (let i = 0; i < rgbaData.length; i += 4) {
          const r = rgbaData[i] >> 4;     // 8 bits to 4 bits
          const g = rgbaData[i + 1] >> 4; // 8 bits to 4 bits
          const b = rgbaData[i + 2] >> 4; // 8 bits to 4 bits
          const a = rgbaData[i + 3] >> 4; // 8 bits to 4 bits
          const pixel = (r << 12) | (g << 8) | (b << 4) | a;
          rgba4444Data[(i / 4) * 2] = pixel & 0xFF;        // Low byte
          rgba4444Data[(i / 4) * 2 + 1] = (pixel >> 8) & 0xFF; // High byte
        }
        console.log(`[D2FormatHandler] RGBA4444 result: ${rgba4444Data.length} bytes`);
        return rgba4444Data;
        
      case D2FormatHandler.D2_FORMAT.ALPHA4:
        // 4-bit alpha, 2 pixels per byte
        console.log(`[D2FormatHandler] Processing ALPHA4 format`);
        const alpha4Data = new Uint8Array(rgbaData.length / 8); // 4 RGBA pixels = 1 byte
        for (let i = 0; i < rgbaData.length; i += 8) {
          const alpha1 = rgbaData[i + 3] >> 4;     // First pixel alpha (8 bits to 4 bits)
          const alpha2 = rgbaData[i + 7] >> 4;     // Second pixel alpha (8 bits to 4 bits)
          alpha4Data[i / 8] = (alpha1 << 4) | alpha2;
        }
        console.log(`[D2FormatHandler] ALPHA4 result: ${alpha4Data.length} bytes`);
        return alpha4Data;
        
      case D2FormatHandler.D2_FORMAT.ALPHA2:
        // 2-bit alpha, 4 pixels per byte
        console.log(`[D2FormatHandler] Processing ALPHA2 format`);
        const alpha2Data = new Uint8Array(rgbaData.length / 16); // 16 RGBA pixels = 1 byte
        for (let i = 0; i < rgbaData.length; i += 16) {
          let byte = 0;
          for (let j = 0; j < 4; j++) {
            const alpha = rgbaData[i + j * 4 + 3] >> 6; // 8 bits to 2 bits
            byte |= alpha << ((3 - j) * 2);
          }
          alpha2Data[i / 16] = byte;
        }
        console.log(`[D2FormatHandler] ALPHA2 result: ${alpha2Data.length} bytes`);
        return alpha2Data;
        
      case D2FormatHandler.D2_FORMAT.ALPHA1:
        // 1-bit alpha, 8 pixels per byte
        console.log(`[D2FormatHandler] Processing ALPHA1 format`);
        const alpha1Data = new Uint8Array(rgbaData.length / 32); // 32 RGBA pixels = 1 byte
        for (let i = 0; i < rgbaData.length; i += 32) {
          let byte = 0;
          for (let j = 0; j < 8; j++) {
            const alpha = rgbaData[i + j * 4 + 3] > 127 ? 1 : 0; // 8 bits to 1 bit (threshold)
            byte |= alpha << (7 - j);
          }
          alpha1Data[i / 32] = byte;
        }
        console.log(`[D2FormatHandler] ALPHA1 result: ${alpha1Data.length} bytes`);
        return alpha1Data;
        
      default:
        throw new Error(`[D2FormatHandler] Unsupported direct format: ${format} - no fallback allowed`);
    }
  }

  // ===== COMPRESSION METHODS =====

  /**
   * RLE compression
   */
  compressRLE(data) {
    const compressed = [];
    let i = 0;
    
    while (i < data.length) {
      const currentByte = data[i];
      let runLength = 1;
      
      // Count consecutive identical bytes
      while (i + runLength < data.length && data[i + runLength] === currentByte && runLength < 255) {
        runLength++;
      }
      
      if (runLength > 1) {
        // RLE run: [length][value]
        compressed.push(runLength);
        compressed.push(currentByte);
      } else {
        // Single byte
        compressed.push(1);
        compressed.push(currentByte);
      }
      
      i += runLength;
    }
    
    return new Uint8Array(compressed);
  }

  /**
   * RLE decompression
   */
  decompressRLE(compressedData) {
    const decompressed = [];
    
    for (let i = 0; i < compressedData.length; i += 2) {
      const runLength = compressedData[i];
      const value = compressedData[i + 1];
      
      for (let j = 0; j < runLength; j++) {
        decompressed.push(value);
      }
    }
    
    return new Uint8Array(decompressed);
  }

  // ===== UTILITY METHODS =====

  /**
   * Find closest palette index for RGB color
   */
  findClosestPaletteIndex(r, g, b, palette) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    
    for (let i = 0; i < palette.length; i++) {
      const color = palette[i];
      
      const dr = r - color.r;
      const dg = g - color.g;
      const db = b - color.b;
      const distance = dr * dr + dg * dg + db * db;
      
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    
    return bestIndex;
  }

  /**
   * Generate default palette for given size
   */
  generateDefaultPalette(size) {
    const palette = [];
    for (let i = 0; i < size; i++) {
      const gray = Math.floor((i / (size - 1)) * 255);
      palette.push({ r: gray, g: gray, b: gray, a: 255 });
    }
    return palette;
  }

  // ===== ROUND-TRIP CONVERSION METHODS =====

  /**
   * Complete round-trip conversion: RGBA -> D2 binary -> RGBA
   * This is what the Image class expects for format testing
   */
  roundTripConversion(rgbaData, width, height, options = {}) {
    try {
      console.log(`[D2FormatHandler] Starting round-trip conversion for format ${options.format}`);
      
      // Step 1: Export RGBA to D2 binary
      const d2Binary = this.exportToD2Binary(rgbaData, width, height, options);
      
      // Step 2: Load D2 binary back to structured data
      const d2Data = this.loadFromD2Binary(d2Binary);
      
      // Step 3: Convert D2 pixel data back to RGBA
      const convertedRgbaData = this.convertD2ToRGBA(
        d2Data.frames[0].data, 
        d2Data.baseFormat, 
        d2Data.palette
      );
      
      console.log(`[D2FormatHandler] Round-trip conversion successful: ${convertedRgbaData.length} bytes RGBA`);
      
      return {
        rgbaData: convertedRgbaData,
        width: d2Data.width,
        height: d2Data.height,
        metadata: d2Data.metadata
      };
      
    } catch (error) {
      console.error(`[D2FormatHandler] Round-trip conversion failed:`, error);
      throw error; // Remove all fallbacks - let it fail loudly
    }
  }

  // ===== STATIC FORMAT CONVERSION METHODS =====

  /**
   * Get D2 format constant from internal format name
   */
  static getD2FormatFromInternal(internalFormat) {
    const formatMap = {
      'd2_mode_alpha8': D2FormatHandler.D2_FORMAT.ALPHA8,
      'd2_mode_rgb565': D2FormatHandler.D2_FORMAT.RGB565,
      'd2_mode_argb8888': D2FormatHandler.D2_FORMAT.ARGB8888,
      'd2_mode_rgb888': D2FormatHandler.D2_FORMAT.RGB888,
      'd2_mode_argb4444': D2FormatHandler.D2_FORMAT.ARGB4444,
      'd2_mode_rgb444': D2FormatHandler.D2_FORMAT.RGB444,
      'd2_mode_argb1555': D2FormatHandler.D2_FORMAT.ARGB1555,
      'd2_mode_rgb555': D2FormatHandler.D2_FORMAT.RGB555,
      'd2_mode_ai44': D2FormatHandler.D2_FORMAT.AI44,
      'd2_mode_rgba8888': D2FormatHandler.D2_FORMAT.RGBA8888,
      'd2_mode_rgba4444': D2FormatHandler.D2_FORMAT.RGBA4444,
      'd2_mode_rgba5551': D2FormatHandler.D2_FORMAT.RGBA5551,
      'd2_mode_i8': D2FormatHandler.D2_FORMAT.I8,
      'd2_mode_i4': D2FormatHandler.D2_FORMAT.I4,
      'd2_mode_i2': D2FormatHandler.D2_FORMAT.I2,
      'd2_mode_i1': D2FormatHandler.D2_FORMAT.I1,
      'd2_mode_alpha4': D2FormatHandler.D2_FORMAT.ALPHA4,
      'd2_mode_alpha2': D2FormatHandler.D2_FORMAT.ALPHA2,
      'd2_mode_alpha1': D2FormatHandler.D2_FORMAT.ALPHA1
    };
    
    return formatMap[internalFormat];
  }

  /**
   * Get internal format name from D2 format constant
   */
  static getInternalFromD2Format(d2Format) {
    const formatMap = {
      [D2FormatHandler.D2_FORMAT.ALPHA8]: 'd2_mode_alpha8',
      [D2FormatHandler.D2_FORMAT.RGB565]: 'd2_mode_rgb565',
      [D2FormatHandler.D2_FORMAT.ARGB8888]: 'd2_mode_argb8888',
      [D2FormatHandler.D2_FORMAT.RGB888]: 'd2_mode_rgb888',
      [D2FormatHandler.D2_FORMAT.ARGB4444]: 'd2_mode_argb4444',
      [D2FormatHandler.D2_FORMAT.RGB444]: 'd2_mode_rgb444',
      [D2FormatHandler.D2_FORMAT.ARGB1555]: 'd2_mode_argb1555',
      [D2FormatHandler.D2_FORMAT.RGB555]: 'd2_mode_rgb555',
      [D2FormatHandler.D2_FORMAT.AI44]: 'd2_mode_ai44',
      [D2FormatHandler.D2_FORMAT.RGBA8888]: 'd2_mode_rgba8888',
      [D2FormatHandler.D2_FORMAT.RGBA4444]: 'd2_mode_rgba4444',
      [D2FormatHandler.D2_FORMAT.RGBA5551]: 'd2_mode_rgba5551',
      [D2FormatHandler.D2_FORMAT.I8]: 'd2_mode_i8',
      [D2FormatHandler.D2_FORMAT.I4]: 'd2_mode_i4',
      [D2FormatHandler.D2_FORMAT.I2]: 'd2_mode_i2',
      [D2FormatHandler.D2_FORMAT.I1]: 'd2_mode_i1',
      [D2FormatHandler.D2_FORMAT.ALPHA4]: 'd2_mode_alpha4',
      [D2FormatHandler.D2_FORMAT.ALPHA2]: 'd2_mode_alpha2',
      [D2FormatHandler.D2_FORMAT.ALPHA1]: 'd2_mode_alpha1'
    };
    
    return formatMap[d2Format] || 'd2_mode_rgba8888';
  }

  /**
   * Test helper: Create a simple test texture with palette name
   */
  static createTestTextureWithPalette(width = 8, height = 8, paletteName = 'test_palette') {
    // Create a simple gradient pattern
    const rgbaData = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        rgbaData[idx] = (x / width) * 255;     // R
        rgbaData[idx + 1] = (y / height) * 255; // G
        rgbaData[idx + 2] = 128;               // B
        rgbaData[idx + 3] = 255;               // A
      }
    }
    
    const handler = new D2FormatHandler();
    const d2Binary = handler.exportToD2Binary(rgbaData, width, height, {
      format: D2FormatHandler.D2_FORMAT.RGBA8888,
      paletteName: paletteName,
      useRLE: false,
      flags: 0
    });
    
    // Test round-trip
    const testData = handler.loadFromD2Binary(d2Binary);
    return testData;
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.D2FormatHandler = D2FormatHandler;
}

// Also support CommonJS exports for Node.js compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = D2FormatHandler;
}
