/**
 * PaletteUtils - Shared utilities for palette parsing and conversion
 * Supports .pal, .act, and .aco formats
 */

class PaletteUtils {
  /**
   * Parse a palette file based on its extension
   * @param {string|ArrayBuffer|Uint8Array} content - File content (string, ArrayBuffer, or base64)
   * @param {string} extension - File extension (.pal, .act, .aco)
   * @returns {Array} Array of {r, g, b} color objects
   */
  static parsePalette(content, extension) {
    // Convert content to appropriate format based on extension
    let processedContent = content;
    
    if (extension.toLowerCase() === '.pal') {
      // .pal files are text-based, convert binary to text if needed
      if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
        const bytes = content instanceof ArrayBuffer ? new Uint8Array(content) : content;
        processedContent = new TextDecoder('utf-8').decode(bytes);
      } else if (typeof content === 'string' && content.match(/^[A-Za-z0-9+/=\s]+$/)) {
        // If it looks like base64, decode it first
        try {
          const binaryString = atob(content.replace(/\s+/g, ''));
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          processedContent = new TextDecoder('utf-8').decode(bytes);
        } catch (e) {
          // If decode fails, assume it's already text
          processedContent = content;
        }
      }
    } else {
      // .act and .aco files are binary, convert to base64 if needed
      if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
        const bytes = content instanceof ArrayBuffer ? new Uint8Array(content) : content;
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        processedContent = btoa(binary);
      }
      // If it's already a string, assume it's base64
    }

    switch (extension.toLowerCase()) {
      case '.pal':
        return this.parsePALPalette(processedContent);
      case '.act':
        return this.parseACTPalette(processedContent);
      case '.aco':
        return this.parseACOPalette(processedContent);
      default:
        throw new Error(`Unsupported palette format: ${extension}`);
    }
  }

  /**
   * Parse .pal format (text-based, RGB values per line)
   * @param {string} content - Text content
   * @returns {Array} Array of {r, g, b} color objects
   */
  static parsePALPalette(content) {
    const colors = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        const r = parseInt(parts[0], 10);
        const g = parseInt(parts[1], 10);
        const b = parseInt(parts[2], 10);
        
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          colors.push({ r, g, b });
        }
      }
    }
    
    console.log(`[PaletteUtils] Parsed .pal file: ${colors.length} colors`);
    return colors;
  }

  /**
   * Parse .act format (Adobe Color Table - 768 bytes RGB + optional 4-byte metadata)
   * @param {string} base64Content - Base64 encoded binary content
   * @returns {Array} Array of {r, g, b} color objects
   */
  static parseACTPalette(base64Content) {
    try {
      // Decode base64 to ArrayBuffer
      const binaryString = atob(base64Content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      console.log(`[PaletteUtils] Parsing .act file: ${bytes.length} bytes`);

      if (bytes.length < 768) {
        throw new Error(`Invalid .act file: expected at least 768 bytes, got ${bytes.length}`);
      }

      const colors = [];
      // Calculate actual color count based on file size
      const colorCount = Math.min(256, Math.floor(bytes.length / 3));
      
      for (let i = 0; i < colorCount; i++) {
        const offset = i * 3;
        if (offset + 2 < bytes.length) {
          colors.push({
            r: bytes[offset],
            g: bytes[offset + 1],
            b: bytes[offset + 2]
          });
        }
      }

      console.log(`[PaletteUtils] Parsed .act file: ${colors.length} colors`);
      return colors;
    } catch (error) {
      console.error('[PaletteUtils] Error parsing .act file:', error);
      throw error;
    }
  }

  /**
   * Parse .aco format (Adobe Color - more complex binary format)
   * @param {string} base64Content - Base64 encoded binary content
   * @returns {Array} Array of {r, g, b} color objects
   */
  static parseACOPalette(base64Content) {
    try {
      // Decode base64 to ArrayBuffer
      const binaryString = atob(base64Content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      console.log(`[PaletteUtils] Parsing .aco file: ${bytes.length} bytes`);

      if (bytes.length < 4) {
        throw new Error(`Invalid .aco file: too short`);
      }

      // .aco format: version (2 bytes) + count (2 bytes) + color entries
      const version = (bytes[0] << 8) | bytes[1];
      const count = (bytes[2] << 8) | bytes[3];

      console.log(`[PaletteUtils] .aco version: ${version}, count: ${count}`);

      const colors = [];
      let offset = 4;

      for (let i = 0; i < count && offset + 10 <= bytes.length; i++) {
        // Each color entry: colorSpace (2) + 4 color values (2 bytes each)
        const colorSpace = (bytes[offset] << 8) | bytes[offset + 1];
        
        if (colorSpace === 0) { // RGB color space
          const r = Math.round(((bytes[offset + 2] << 8) | bytes[offset + 3]) / 257); // Convert from 16-bit to 8-bit
          const g = Math.round(((bytes[offset + 4] << 8) | bytes[offset + 5]) / 257);
          const b = Math.round(((bytes[offset + 6] << 8) | bytes[offset + 7]) / 257);
          colors.push({ r, g, b });
        }
        
        offset += 10; // 2 + 4*2 bytes per entry
      }

      console.log(`[PaletteUtils] Parsed .aco file: ${colors.length} colors`);
      return colors;
    } catch (error) {
      console.error('[PaletteUtils] Error parsing .aco file:', error);
      throw error;
    }
  }

  /**
   * Export colors to .act format (Adobe Color Table)
   * @param {Array} colors - Array of {r, g, b} color objects
   * @returns {ArrayBuffer} Binary .act file data
   */
  static exportToACT(colors) {
    // .act format: 768 bytes (256 colors * 3 bytes RGB) + optional 4-byte metadata
    const buffer = new ArrayBuffer(772); // 768 + 4 bytes metadata
    const bytes = new Uint8Array(buffer);

    // Fill with black by default
    bytes.fill(0);

    // Write color data
    const colorCount = Math.min(colors.length, 256);
    for (let i = 0; i < colorCount; i++) {
      const color = colors[i];
      const offset = i * 3;
      bytes[offset] = Math.max(0, Math.min(255, color.r || 0));
      bytes[offset + 1] = Math.max(0, Math.min(255, color.g || 0));
      bytes[offset + 2] = Math.max(0, Math.min(255, color.b || 0));
    }

    // Write metadata (last 4 bytes)
    // Bytes 768-769: Number of colors (big-endian)
    bytes[768] = (colorCount >> 8) & 0xFF;
    bytes[769] = colorCount & 0xFF;
    // Bytes 770-771: Transparency index (0xFFFF = no transparency)
    bytes[770] = 0xFF;
    bytes[771] = 0xFF;

    console.log(`[PaletteUtils] Exported to .act format: ${colorCount} colors, ${buffer.byteLength} bytes`);
    return buffer;
  }

  /**
   * Export colors to .pal format (text-based RGB)
   * @param {Array} colors - Array of {r, g, b} color objects
   * @returns {string} Text content for .pal file
   */
  static exportToPAL(colors) {
    const lines = ['# Palette file'];
    
    for (const color of colors) {
      const r = Math.max(0, Math.min(255, color.r || 0));
      const g = Math.max(0, Math.min(255, color.g || 0));
      const b = Math.max(0, Math.min(255, color.b || 0));
      lines.push(`${r} ${g} ${b}`);
    }
    
    const content = lines.join('\n');
    console.log(`[PaletteUtils] Exported to .pal format: ${colors.length} colors`);
    return content;
  }

  /**
   * Convert ArrayBuffer to base64 string
   * @param {ArrayBuffer} buffer - Binary data
   * @returns {string} Base64 encoded string
   */
  static arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Get supported palette file extensions
   * @returns {Array} Array of supported extensions
   */
  static getSupportedExtensions() {
    return ['.pal', '.act', '.aco'];
  }
}

// Export for use
window.PaletteUtils = PaletteUtils;
console.log('[PaletteUtils] Utility class loaded');
