/**
 * TextureFormatUtils - Static utilities for texture format operations
 * 
 * Extracted from ImageData class to provide focused texture format utilities
 * without dependencies on other image processing functionality.
 */
class TextureFormatUtils {
  
  /**
   * Get available color depth options for texture formats
   * @returns {Array} Array of color depth option objects
   */
  static getColorDepthOptions() {
    return [
      { value: 1, label: '1-bit (Monochrome)', description: 'Black and white only' },
      { value: 4, label: '4-bit (16 colors)', description: '16 color palette' },
      { value: 8, label: '8-bit (256 colors)', description: '256 color palette' },
      { value: 16, label: '16-bit (High Color)', description: '65,536 colors' },
      { value: 24, label: '24-bit (True Color)', description: '16.7 million colors' },
      { value: 32, label: '32-bit (True Color + Alpha)', description: '16.7 million colors with transparency' }
    ];
  }

  /**
   * Get available compression options for textures
   * @returns {Array} Array of compression option objects
   */
  static getCompressionOptions() {
    return [
      { value: 'none', label: 'None', description: 'No compression' },
      { value: 'rle', label: 'RLE', description: 'Run-length encoding' },
      { value: 'lz77', label: 'LZ77', description: 'LZ77 compression' }
    ];
  }

  /**
   * Get available texture format options with detailed descriptions
   * @returns {Array} Array of texture format option objects
   */
  static getTextureFormatOptions() {
    return [
      // Most Common Formats First
      { 
        value: 'd2_mode_i8', 
        label: 'Indexed 8-bit', 
        description: '8 bits per pixel, 256 colors from palette',
        bitsPerPixel: 8,
        category: 'Common',
        colorCount: '256 colors'
      },
      { 
        value: 'd2_mode_i4', 
        label: 'Indexed 4-bit', 
        description: '4 bits per pixel, 16 colors from palette',
        bitsPerPixel: 4,
        category: 'Common',
        colorCount: '16 colors'
      },
      { 
        value: 'd2_mode_rgb565', 
        label: 'RGB 16-bit (565)', 
        description: '16 bits per pixel, 5R:6G:5B format, 65,536 colors',
        bitsPerPixel: 16,
        category: 'Common',
        colorCount: '65,536 colors'
      },
      { 
        value: 'd2_mode_argb1555', 
        label: 'ARGB 16-bit (1555)', 
        description: '16 bits per pixel, 1A:5R:5G:5B format, 32,768 colors + alpha',
        bitsPerPixel: 16,
        category: 'Common',
        colorCount: '32,768 colors'
      },
      { 
        value: 'd2_mode_ai44', 
        label: 'Alpha+Index 8-bit', 
        description: '8 bits per pixel, 4-bit alpha + 4-bit palette index, 16 colors',
        bitsPerPixel: 8,
        category: 'Common',
        colorCount: '16 colors'
      },

      // True Color formats
      { 
        value: 'd2_mode_argb8888', 
        label: 'ARGB 32-bit', 
        description: '32 bits per pixel, 8A:8R:8G:8B format, 16.7M colors + alpha',
        bitsPerPixel: 32,
        category: 'True Color',
        colorCount: '16.7M colors'
      },
      { 
        value: 'd2_mode_rgba8888', 
        label: 'RGBA 32-bit', 
        description: '32 bits per pixel, 8R:8G:8B:8A format, 16.7M colors + alpha',
        bitsPerPixel: 32,
        category: 'True Color',
        colorCount: '16.7M colors'
      },
      { 
        value: 'd2_mode_rgb888', 
        label: 'RGB 24-bit', 
        description: '24 bits per pixel, 8R:8G:8B format, 16.7M colors',
        bitsPerPixel: 24,
        category: 'True Color',
        colorCount: '16.7M colors'
      },

      // High Color formats
      { 
        value: 'd2_mode_rgba5551', 
        label: 'RGBA 16-bit (5551)', 
        description: '16 bits per pixel, 5R:5G:5B:1A format, 32,768 colors + alpha',
        bitsPerPixel: 16,
        category: 'High Color',
        colorCount: '32,768 colors'
      },
      { 
        value: 'd2_mode_rgb555', 
        label: 'RGB 15-bit (555)', 
        description: '15 bits per pixel, 5R:5G:5B format, 32,768 colors',
        bitsPerPixel: 15,
        category: 'High Color',
        colorCount: '32,768 colors'
      },
      { 
        value: 'd2_mode_argb4444', 
        label: 'ARGB 16-bit (4444)', 
        description: '16 bits per pixel, 4A:4R:4G:4B format, 4,096 colors + alpha',
        bitsPerPixel: 16,
        category: 'High Color',
        colorCount: '4,096 colors'
      },
      { 
        value: 'd2_mode_rgba4444', 
        label: 'RGBA 16-bit (4444)', 
        description: '16 bits per pixel, 4R:4G:4B:4A format, 4,096 colors + alpha',
        bitsPerPixel: 16,
        category: 'High Color',
        colorCount: '4,096 colors'
      },
      { 
        value: 'd2_mode_rgb444', 
        label: 'RGB 12-bit (444)', 
        description: '12 bits per pixel, 4R:4G:4B format, 4,096 colors',
        bitsPerPixel: 12,
        category: 'High Color',
        colorCount: '4,096 colors'
      },

      // Indexed formats (remaining)
      { 
        value: 'd2_mode_i2', 
        label: 'Indexed 2-bit', 
        description: '2 bits per pixel, 4 colors from palette',
        bitsPerPixel: 2,
        category: 'Indexed',
        colorCount: '4 colors'
      },
      { 
        value: 'd2_mode_i1', 
        label: 'Indexed 1-bit', 
        description: '1 bit per pixel, 2 colors from palette',
        bitsPerPixel: 1,
        category: 'Indexed',
        colorCount: '2 colors'
      },

      // Alpha/Monochrome formats
      { 
        value: 'd2_mode_alpha8', 
        label: 'Alpha 8-bit', 
        description: '8 bits per pixel, 256 alpha levels (monochrome)',
        bitsPerPixel: 8,
        category: 'Alpha',
        colorCount: '256 levels'
      },
      { 
        value: 'd2_mode_alpha4', 
        label: 'Alpha 4-bit', 
        description: '4 bits per pixel, 16 alpha levels (monochrome)',
        bitsPerPixel: 4,
        category: 'Alpha',
        colorCount: '16 levels'
      },
      { 
        value: 'd2_mode_alpha2', 
        label: 'Alpha 2-bit', 
        description: '2 bits per pixel, 4 alpha levels (monochrome)',
        bitsPerPixel: 2,
        category: 'Alpha',
        colorCount: '4 levels'
      },
      { 
        value: 'd2_mode_alpha1', 
        label: 'Alpha 1-bit', 
        description: '1 bit per pixel, 2 alpha levels (monochrome)',
        bitsPerPixel: 1,
        category: 'Alpha',
        colorCount: '2 levels'
      }
    ];
  }

  /**
   * Get the number of colors supported by a texture format
   * @param {string} formatValue - The texture format identifier (e.g., 'd2_mode_i4')
   * @returns {number} Number of colors supported by the format
   */
  static getTextureFormatColorCount(formatValue) {
    const formatMap = {
      'd2_mode_i1': 2,
      'd2_mode_i2': 4,
      'd2_mode_i4': 16,
      'd2_mode_i8': 256,
      'd2_mode_ai44': 16,
      'd2_mode_alpha1': 2,
      'd2_mode_alpha2': 4,
      'd2_mode_alpha4': 16,
      'd2_mode_alpha8': 256,
      'd2_mode_rgb444': 4096,
      'd2_mode_rgb555': 32768,
      'd2_mode_rgb565': 65536,
      'd2_mode_argb1555': 32768,
      'd2_mode_rgba5551': 32768,
      'd2_mode_argb4444': 4096,
      'd2_mode_rgba4444': 4096,
      'd2_mode_rgb888': 16777216,
      'd2_mode_rgba8888': 16777216,
      'd2_mode_argb8888': 16777216
    };
    
    return formatMap[formatValue] || 256; // Default to 256 if format not found
  }

  /**
   * Get format category for organizing format options
   * @param {string} formatValue - The texture format identifier
   * @returns {string} Format category ('Common', 'True Color', 'High Color', 'Indexed', 'Alpha')
   */
  static getFormatCategory(formatValue) {
    const formats = this.getTextureFormatOptions();
    const format = formats.find(f => f.value === formatValue);
    return format ? format.category : 'Unknown';
  }

  /**
   * Get bits per pixel for a texture format
   * @param {string} formatValue - The texture format identifier
   * @returns {number} Bits per pixel for the format
   */
  static getFormatBitsPerPixel(formatValue) {
    const formats = this.getTextureFormatOptions();
    const format = formats.find(f => f.value === formatValue);
    return format ? format.bitsPerPixel : 8; // Default to 8 bits
  }

  /**
   * Check if a format is indexed (uses palette)
   * @param {string} formatValue - The texture format identifier
   * @returns {boolean} True if format uses a palette
   */
  static isIndexedFormat(formatValue) {
    const indexedFormats = ['d2_mode_i1', 'd2_mode_i2', 'd2_mode_i4', 'd2_mode_i8', 'd2_mode_ai44'];
    return indexedFormats.includes(formatValue);
  }

  /**
   * Check if a format supports alpha channel
   * @param {string} formatValue - The texture format identifier
   * @returns {boolean} True if format supports alpha
   */
  static hasAlphaChannel(formatValue) {
    const alphaFormats = [
      'd2_mode_argb8888', 'd2_mode_rgba8888', 'd2_mode_argb1555', 'd2_mode_rgba5551',
      'd2_mode_argb4444', 'd2_mode_rgba4444', 'd2_mode_ai44',
      'd2_mode_alpha1', 'd2_mode_alpha2', 'd2_mode_alpha4', 'd2_mode_alpha8'
    ];
    return alphaFormats.includes(formatValue);
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.TextureFormatUtils = TextureFormatUtils;
}

// Also support CommonJS exports for Node.js compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TextureFormatUtils;
}
