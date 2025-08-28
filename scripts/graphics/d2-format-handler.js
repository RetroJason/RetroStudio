/**
 * D2FormatHandler - D2 texture format loading, export, and conversion utilities
 * 
 * Extracted from ImageData class to provide focused D2 texture format handling
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
    
    console.log(`[D2FormatHandler] D2 Header: ${width}x${height}, format: ${baseFormat}, RLE: ${isRLE}, indexed: ${isIndexed}, palette: "${paletteName}"`);
    
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
        palette[i] = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
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
    
    // Convert to RGBA based on format
    const rgbaData = this.convertD2ToRGBA(decompressedData, baseFormat, palette);
    
    // Create frame data
    const frames = [{
      data: rgbaData,
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
      format: 'rgba'
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
      format = D2FormatHandler.D2_FORMAT.RGBA8888,
      useRLE = false,
      flags = 0,
      prerotation = 0,
      palette = null,
      paletteName = ''
    } = options;
    
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
      D2FormatHandler.D2_FORMAT.I1
    ].includes(format);
    
    // Convert RGBA to target format
    let pixelData, exportPalette;
    if (isIndexed) {
      console.log(`[D2FormatHandler] Converting to indexed format with palette:`, !!palette);
      if (palette) {
        console.log(`[D2FormatHandler] Palette has ${palette.colors ? palette.colors.length : 'no'} colors`);
      }
      const result = this.convertRGBAToD2Indexed(rgbaData, format, palette);
      pixelData = result.pixelData;
      exportPalette = result.palette;
    } else {
      console.log(`[D2FormatHandler] Converting to direct color format`);
      pixelData = this.convertRGBAToD2Direct(rgbaData, format);
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
    view.setUint8(offset++, format);
    
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
      default: return 0;
    }
  }

  /**
   * Convert D2 pixel data to RGBA
   */
  convertD2ToRGBA(pixelData, format, palette = null) {
    const rgbaData = new Uint8Array(pixelData.length * 4);
    
    switch (format) {
      case D2FormatHandler.D2_FORMAT.I4:
        // 4-bit indexed, 2 pixels per byte
        for (let i = 0; i < pixelData.length; i++) {
          const byte = pixelData[i];
          const pixel1 = (byte >> 4) & 0x0F;
          const pixel2 = byte & 0x0F;
          
          if (palette) {
            const color1 = this.hexToRgb(palette[pixel1] || '#000000');
            const color2 = this.hexToRgb(palette[pixel2] || '#000000');
            
            rgbaData[i * 8] = color1.r;
            rgbaData[i * 8 + 1] = color1.g;
            rgbaData[i * 8 + 2] = color1.b;
            rgbaData[i * 8 + 3] = 255;
            
            rgbaData[i * 8 + 4] = color2.r;
            rgbaData[i * 8 + 5] = color2.g;
            rgbaData[i * 8 + 6] = color2.b;
            rgbaData[i * 8 + 7] = 255;
          }
        }
        break;
        
      case D2FormatHandler.D2_FORMAT.RGBA8888:
        // Direct RGBA copy
        rgbaData.set(pixelData);
        break;
        
      // Add more format conversions as needed
      default:
        console.warn(`[D2FormatHandler] Unsupported D2 format for conversion: ${format}`);
        // Default to direct copy
        rgbaData.set(pixelData.slice(0, rgbaData.length));
    }
    
    return rgbaData;
  }

  /**
   * Convert RGBA to D2 indexed format
   */
  convertRGBAToD2Indexed(rgbaData, format, palette = null) {
    console.log(`[D2FormatHandler] Converting RGBA to indexed format ${format}`);
    
    if (!palette) {
      const paletteSize = this.getD2PaletteSize(format);
      palette = this.generateDefaultPalette(paletteSize);
    }
    
    const paletteColors = palette.colors || palette;
    let pixelData;
    
    switch (format) {
      case D2FormatHandler.D2_FORMAT.I4:
        // 4-bit indexed, 2 pixels per byte
        pixelData = new Uint8Array(Math.ceil((rgbaData.length / 4) / 2));
        for (let i = 0; i < rgbaData.length; i += 8) {
          const r1 = rgbaData[i];
          const g1 = rgbaData[i + 1];
          const b1 = rgbaData[i + 2];
          
          const r2 = rgbaData[i + 4] || 0;
          const g2 = rgbaData[i + 5] || 0;
          const b2 = rgbaData[i + 6] || 0;
          
          const index1 = this.findClosestPaletteIndex(r1, g1, b1, paletteColors);
          const index2 = this.findClosestPaletteIndex(r2, g2, b2, paletteColors);
          
          pixelData[i / 8] = (index1 << 4) | index2;
        }
        break;
        
      default:
        console.warn(`[D2FormatHandler] Unsupported indexed format: ${format}`);
        pixelData = new Uint8Array(rgbaData.length / 4);
    }
    
    return {
      pixelData,
      palette: paletteColors
    };
  }

  /**
   * Convert RGBA to D2 direct format
   */
  convertRGBAToD2Direct(rgbaData, format) {
    switch (format) {
      case D2FormatHandler.D2_FORMAT.RGBA8888:
        return new Uint8Array(rgbaData);
        
      case D2FormatHandler.D2_FORMAT.RGB565:
        const rgb565Data = new Uint8Array(rgbaData.length / 2);
        for (let i = 0; i < rgbaData.length; i += 4) {
          const r = rgbaData[i] >> 3;
          const g = rgbaData[i + 1] >> 2;
          const b = rgbaData[i + 2] >> 3;
          const pixel = (r << 11) | (g << 5) | b;
          rgb565Data[i / 2] = pixel & 0xFF;
          rgb565Data[i / 2 + 1] = (pixel >> 8) & 0xFF;
        }
        return rgb565Data;
        
      default:
        console.warn(`[D2FormatHandler] Unsupported direct format: ${format}`);
        return new Uint8Array(rgbaData);
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
      const paletteRgb = typeof color === 'string' ? this.hexToRgb(color) : color;
      
      const dr = r - paletteRgb.r;
      const dg = g - paletteRgb.g;
      const db = b - paletteRgb.b;
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

  /**
   * Convert hex to RGB
   */
  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
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
