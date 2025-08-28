/**
 * PaletteManager - Palette loading, parsing, and management utilities
 * 
 * Extracted from ImageData class to provide focused palette management
 * functionality with clean separation of concerns.
 */
class PaletteManager {
  
  constructor() {
    // Cache for loaded palettes to avoid reloading
    this.paletteCache = new Map();
  }

  /**
   * Load a palette by name from project or build output
   * @param {string} paletteName - Name of the palette to load
   * @returns {Promise<Array>} Array of color objects with r, g, b, a properties
   */
  async loadPalette(paletteName) {
    console.log('[PaletteManager] Loading palette:', paletteName);
    
    // Check cache first
    if (this.paletteCache.has(paletteName)) {
      console.log('[PaletteManager] Using cached palette:', paletteName);
      return this.paletteCache.get(paletteName);
    }
    
    let palette = null;
    
    // Try to load palette using project explorer first
    if (window.ProjectExplorer && window.ProjectExplorer.loadPalette) {
      try {
        palette = await window.ProjectExplorer.loadPalette(paletteName);
        if (palette) {
          console.log('[PaletteManager] Successfully loaded palette via ProjectExplorer');
          this.paletteCache.set(paletteName, palette);
          return palette;
        }
      } catch (error) {
        console.warn('[PaletteManager] ProjectExplorer.loadPalette failed:', error.message);
      }
    }
    
    // Direct file loading: D2 palette names should use .act extension
    // Look in build output directory, not source directory
    const fileManager = this.getFileManager();
    if (!fileManager) {
      throw new Error('No file manager available for palette loading');
    }
    
    // Get build output prefix (e.g., 'build/' or project-specific path)
    const buildPrefix = this.getBuildStoragePrefix();
    const palettePath = `${buildPrefix}Palettes/${paletteName}.act`;
    
    console.log('[PaletteManager] Loading palette from build output:', palettePath);
    
    try {
      const paletteFile = await fileManager.loadFile(palettePath);
      if (!paletteFile || !paletteFile.content) {
        throw new Error(`Palette file not found in build output: ${palettePath}`);
      }
      
      console.log('[PaletteManager] Successfully loaded palette from build output:', palettePath);
      palette = this.parsePaletteContent(paletteFile.content);
      
      if (palette) {
        this.paletteCache.set(paletteName, palette);
      }
      
      return palette;
    } catch (error) {
      console.error('[PaletteManager] Failed to load palette:', error);
      throw error;
    }
  }

  /**
   * Parse palette content from various formats
   * @param {string|ArrayBuffer} content - Palette content to parse
   * @returns {Array|null} Array of color objects or null if parsing failed
   */
  parsePaletteContent(content) {
    try {
      if (typeof content === 'string') {
        const parsed = JSON.parse(content);
        return parsed.colors || parsed;
      } else if (content instanceof ArrayBuffer) {
        // Binary palette format (.act files)
        return this.parseBinaryPalette(content);
      } else if (content instanceof Uint8Array) {
        // Convert Uint8Array to ArrayBuffer
        return this.parseBinaryPalette(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength));
      }
      return null;
    } catch (error) {
      console.error('[PaletteManager] Error parsing palette content:', error);
      return null;
    }
  }

  /**
   * Parse binary palette format (.act files)
   * @param {ArrayBuffer} content - Binary palette data
   * @returns {Array} Array of color objects
   */
  parseBinaryPalette(content) {
    const view = new DataView(content);
    const colors = [];
    
    // Standard .act format: 256 colors, 3 bytes per color (RGB)
    const colorCount = Math.min(256, content.byteLength / 3);
    
    for (let i = 0; i < colorCount; i++) {
      colors.push({
        r: view.getUint8(i * 3),
        g: view.getUint8(i * 3 + 1),
        b: view.getUint8(i * 3 + 2),
        a: 255 // Default full opacity
      });
    }
    
    return colors;
  }

  /**
   * Create a palette from an array of hex color strings
   * @param {Array<string>} hexColors - Array of hex color strings
   * @returns {Array} Array of color objects
   */
  createPaletteFromHex(hexColors) {
    return hexColors.map(hex => {
      const rgb = this.hexToRgb(hex);
      return {
        r: rgb.r,
        g: rgb.g,
        b: rgb.b,
        a: 255
      };
    });
  }

  /**
   * Create a palette from RGBA values
   * @param {Array<Array<number>>} rgbaValues - Array of [r, g, b, a] arrays
   * @returns {Array} Array of color objects
   */
  createPaletteFromRGBA(rgbaValues) {
    return rgbaValues.map(([r, g, b, a = 255]) => ({ r, g, b, a }));
  }

  /**
   * Convert palette to hex strings
   * @param {Array} palette - Array of color objects
   * @returns {Array<string>} Array of hex color strings
   */
  paletteToHex(palette) {
    return palette.map(color => this.rgbToHex(color.r, color.g, color.b));
  }

  /**
   * Convert palette to binary .act format
   * @param {Array} palette - Array of color objects
   * @returns {ArrayBuffer} Binary palette data
   */
  paletteToBinary(palette) {
    const buffer = new ArrayBuffer(768); // 256 colors * 3 bytes
    const view = new DataView(buffer);
    
    for (let i = 0; i < Math.min(256, palette.length); i++) {
      const color = palette[i];
      view.setUint8(i * 3, color.r);
      view.setUint8(i * 3 + 1, color.g);
      view.setUint8(i * 3 + 2, color.b);
    }
    
    return buffer;
  }

  /**
   * Validate palette format and structure
   * @param {Array} palette - Palette to validate
   * @returns {boolean} True if palette is valid
   */
  validatePalette(palette) {
    if (!Array.isArray(palette)) {
      return false;
    }
    
    return palette.every(color => 
      color && 
      typeof color.r === 'number' && color.r >= 0 && color.r <= 255 &&
      typeof color.g === 'number' && color.g >= 0 && color.g <= 255 &&
      typeof color.b === 'number' && color.b >= 0 && color.b <= 255 &&
      (color.a === undefined || (typeof color.a === 'number' && color.a >= 0 && color.a <= 255))
    );
  }

  /**
   * Clear palette cache
   */
  clearCache() {
    this.paletteCache.clear();
    console.log('[PaletteManager] Palette cache cleared');
  }

  /**
   * Get cached palette names
   * @returns {Array<string>} Array of cached palette names
   */
  getCachedPaletteNames() {
    return Array.from(this.paletteCache.keys());
  }

  // ===== UTILITY METHODS =====

  /**
   * Convert RGB values to hex string
   * @param {number} r - Red component (0-255)
   * @param {number} g - Green component (0-255)
   * @param {number} b - Blue component (0-255)
   * @returns {string} Hex color string (e.g., "#ff0000")
   */
  rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /**
   * Convert hex string to RGB object
   * @param {string} hex - Hex color string (e.g., "#ff0000" or "ff0000")
   * @returns {Object} RGB object with r, g, b properties
   */
  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }

  /**
   * Get file manager instance from various sources
   * @returns {Object|null} File manager instance or null
   */
  getFileManager() {
    let fileManager = null;
    
    try { 
      fileManager = window.serviceContainer?.get('fileManager'); 
    } catch (_) { /* not registered yet */ }
    
    fileManager = fileManager || window.FileManager || window.fileManager;
    
    if (!fileManager || typeof fileManager.loadFile !== 'function') {
      return null;
    }
    
    return fileManager;
  }

  /**
   * Get build storage prefix for palette loading
   * @returns {string} Build storage prefix (e.g., 'build/')
   */
  getBuildStoragePrefix() {
    if (window.ProjectPaths && typeof window.ProjectPaths.getBuildStoragePrefix === 'function') {
      return window.ProjectPaths.getBuildStoragePrefix();
    }
    return 'build/';
  }

  // ===== STATIC FACTORY METHODS =====

  /**
   * Create a standard web-safe palette
   * @returns {Array} Web-safe palette
   */
  static createWebSafePalette() {
    const colors = [];
    for (let r = 0; r < 256; r += 51) {
      for (let g = 0; g < 256; g += 51) {
        for (let b = 0; b < 256; b += 51) {
          colors.push({ r, g, b, a: 255 });
        }
      }
    }
    return colors;
  }

  /**
   * Create a grayscale palette
   * @param {number} steps - Number of gray levels (default: 256)
   * @returns {Array} Grayscale palette
   */
  static createGrayscalePalette(steps = 256) {
    const colors = [];
    for (let i = 0; i < steps; i++) {
      const level = Math.floor((i / (steps - 1)) * 255);
      colors.push({ r: level, g: level, b: level, a: 255 });
    }
    return colors;
  }

  /**
   * Create a palette with specified number of equally spaced hues
   * @param {number} hueCount - Number of hues to generate
   * @param {number} saturation - Saturation level (0-100, default: 100)
   * @param {number} lightness - Lightness level (0-100, default: 50)
   * @returns {Array} HSL-based palette
   */
  static createHuePalette(hueCount, saturation = 100, lightness = 50) {
    const colors = [];
    for (let i = 0; i < hueCount; i++) {
      const hue = (i / hueCount) * 360;
      const rgb = PaletteManager.hslToRgb(hue, saturation, lightness);
      colors.push({ r: rgb.r, g: rgb.g, b: rgb.b, a: 255 });
    }
    return colors;
  }

  /**
   * Convert HSL to RGB
   * @param {number} h - Hue (0-360)
   * @param {number} s - Saturation (0-100)
   * @param {number} l - Lightness (0-100)
   * @returns {Object} RGB object
   */
  static hslToRgb(h, s, l) {
    h /= 360;
    s /= 100;
    l /= 100;

    const a = s * Math.min(l, 1 - l);
    const f = n => {
      const k = (n + h / (1/12)) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color);
    };

    return { r: f(0), g: f(8), b: f(4) };
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.PaletteManager = PaletteManager;
}

// Also support CommonJS exports for Node.js compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PaletteManager;
}
