// palette.js
// Abstracted palette functionality for loading, saving and manipulating color palettes
// Supports .pal (GIMP/JASC) and .act (Adobe Color Table) formats for LOADING
// 
// IMPORTANT: We ONLY SAVE to .act format for embedded systems compatibility!
// - ACT format is binary and compact (772 bytes fixed size)
// - Perfect for embedded systems with limited storage
// - PAL format support is only for loading legacy files, NOT for saving
//
// Loading: Both .pal and .act formats supported
// Saving: ONLY .act format - more compact and embedded-friendly

console.log('[Palette] Class definition loading');

class Palette {
  constructor() {
    this.colors = [];
    this.maxColors = 256;
    this.name = '';
    this.format = 'act'; // Always default to ACT format for embedded systems
  }

  // Static factory methods
  static async fromFile(fileContent, filename = '') {
    const palette = new Palette();
    await palette.loadFromContent(fileContent, filename);
    return palette;
  }

  static fromColors(colorArray, name = 'Untitled') {
    const palette = new Palette();
    palette.colors = [...colorArray];
    palette.name = name;
    return palette;
  }

  static createDefault(size = 256) {
    const palette = new Palette();
    palette.createDefaultPalette(size);
    palette.name = 'Default';
    return palette;
  }

  // Core palette operations
  async loadFromContent(content, filename = '') {
    this.name = this.getBaseName(filename);
    const extension = this.getFileExtension(filename);
    
    try {
      // Auto-detect format if no extension or unknown extension
      const detectedFormat = this.detectFormat(content, extension);
      
      switch (detectedFormat.toLowerCase()) {
        case 'act':
          this.parseACTFormat(content);
          this.format = 'act';
          break;
        case 'pal':
        default:
          this.parseGIMPPalette(content);
          this.format = 'pal';
          break;
      }
      console.log(`[Palette] Loaded ${this.colors.length} colors from ${detectedFormat} format`);
    } catch (error) {
      console.error('[Palette] Error loading palette:', error);
      this.createDefaultPalette();
    }
  }

  // Auto-detect palette format based on content and filename
  detectFormat(content, extension = '') {
    // First check extension
    if (extension.toLowerCase() === '.act') {
      return 'act';
    }
    if (extension.toLowerCase() === '.pal') {
      return 'pal';
    }

    // If no extension or unknown, analyze content
    if (!content) {
      return 'pal'; // Default fallback
    }

    // Check if content is binary (likely ACT)
    if (content instanceof ArrayBuffer) {
      return 'act';
    }

    // Check if content is base64 string (could be ACT)
    if (typeof content === 'string' && content.length > 0) {
      // Check for GIMP/JASC headers (text format)
      if (content.includes('GIMP') || content.includes('JASC')) {
        return 'pal';
      }

      // Check if it looks like base64 (might be ACT)
      if (/^[A-Za-z0-9+/=\r\n\s]+$/.test(content) && content.length >= 1000) {
        try {
          const decoded = atob(content.replace(/\s/g, ''));
          if (decoded.length >= 768) { // ACT files are at least 768 bytes
            return 'act';
          }
        } catch (e) {
          // Not valid base64, probably text
        }
      }
    }

    // Default to PAL format for text content
    return 'pal';
  }

  parseGIMPPalette(content) {
    // Handle different content types
    if (typeof content !== 'string') {
      if (content instanceof ArrayBuffer) {
        content = new TextDecoder().decode(content);
      } else {
        console.warn(`[Palette] Unexpected content type: ${typeof content}`, content);
        content = '';
      }
    }

    // Handle base64 encoded content
    if (content && !content.startsWith('GIMP') && /^[A-Za-z0-9+/=\r\n]+$/.test(content.substring(0, 120))) {
      try {
        const bin = atob(content.replace(/\s+/g, ''));
        const decoded = new TextDecoder().decode(new Uint8Array([...bin].map(c => c.charCodeAt(0))));
        if (decoded.startsWith('GIMP') || decoded.startsWith('JASC')) {
          content = decoded;
          console.log('[Palette] Detected base64-encoded palette content');
        }
      } catch (_) { /* ignore decode errors */ }
    }

    if (!content) {
      console.log('[Palette] No content to parse, using default palette');
      this.createDefaultPalette();
      return;
    }

    const lines = content.split('\n');
    this.colors = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('GIMP') && !trimmed.startsWith('JASC')) {
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 3) {
          const r = parseInt(parts[0]);
          const g = parseInt(parts[1]);
          const b = parseInt(parts[2]);

          if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
            this.colors.push(this.rgbToHex(r, g, b));
          }
        }
      }
    }

    // Ensure we have colors
    if (this.colors.length === 0) {
      console.log('[Palette] No valid colors found, using default palette');
      this.createDefaultPalette();
    }

    console.log(`[Palette] Parsed ${this.colors.length} colors from GIMP/JASC format`);
  }

  parseACTFormat(content) {
    // Parse Adobe Color Table (.act) format
    let bytes;
    
    if (typeof content === 'string') {
      // Assume base64 encoded binary data
      try {
        const binaryString = atob(content);
        bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
      } catch (error) {
        console.error('[Palette] Error decoding ACT content:', error);
        this.createDefaultPalette();
        return;
      }
    } else if (content instanceof ArrayBuffer) {
      bytes = new Uint8Array(content);
    } else {
      console.error('[Palette] Invalid ACT content format');
      this.createDefaultPalette();
      return;
    }

    this.colors = [];
    
    // ACT files contain 256 RGB triplets (768 bytes minimum)
    const colorCount = Math.min(256, Math.floor(bytes.length / 3));
    
    for (let i = 0; i < colorCount; i++) {
      const offset = i * 3;
      if (offset + 2 < bytes.length) {
        const r = bytes[offset];
        const g = bytes[offset + 1];
        const b = bytes[offset + 2];
        this.colors.push(this.rgbToHex(r, g, b));
      }
    }

    console.log(`[Palette] Parsed ${this.colors.length} colors from ACT format`);
  }

  createDefaultPalette(size = 256) {
    this.colors = [];
    
    // Create a basic 256-color palette
    for (let i = 0; i < size; i++) {
      if (i < 16) {
        // First 16 colors: standard system colors
        const intensity = Math.floor(i / 2) * 85; // 0, 85, 170, 255
        const r = (i & 1) ? intensity : 0;
        const g = (i & 2) ? intensity : 0;
        const b = (i & 4) ? intensity : 0;
        this.colors.push(this.rgbToHex(r, g, b));
      } else {
        // Remaining colors: grayscale gradient
        const gray = Math.floor((i - 16) * 255 / (size - 17));
        this.colors.push(this.rgbToHex(gray, gray, gray));
      }
    }
    
    console.log(`[Palette] Created default palette with ${this.colors.length} colors`);
  }

  // Export methods
  // NOTE: We only save to ACT format for embedded systems compatibility.
  // ACT format is more compact and binary, making it ideal for embedded use.
  // PAL export is kept for compatibility with external tools but should not be used for saving.
  
  exportToPAL() {
    // DEPRECATED: Only use for external tool compatibility, NOT for saving
    // We save exclusively to ACT format for embedded systems
    const lines = [];
    lines.push('JASC-PAL');
    lines.push('0100');
    lines.push(this.colors.length.toString());

    this.colors.forEach(color => {
      const rgb = this.hexToRgb(color);
      lines.push(`${rgb.r} ${rgb.g} ${rgb.b}`);
    });

    return lines.join('\n');
  }

  exportToACT() {
    // PRIMARY SAVE FORMAT: Adobe Color Table format for embedded systems
    // 768 bytes (256 RGB triplets) + 4 metadata bytes = 772 bytes total
    // Compact binary format ideal for embedded systems
    const bytes = new Uint8Array(772);

    // Fill with RGB triplets (256 colors max)
    for (let i = 0; i < 256; i++) {
      let r = 0, g = 0, b = 0;

      if (i < this.colors.length && this.colors[i]) {
        const rgb = this.hexToRgb(this.colors[i]);
        r = rgb.r;
        g = rgb.g;
        b = rgb.b;
      }

      const offset = i * 3;
      bytes[offset] = r;
      bytes[offset + 1] = g;
      bytes[offset + 2] = b;
    }

    // Metadata: number of colors (16-bit big-endian) + transparency index (16-bit big-endian)
    const colorCount = Math.min(this.colors.length, 256);
    bytes[768] = (colorCount >> 8) & 0xFF;
    bytes[769] = colorCount & 0xFF;
    bytes[770] = 0; // No transparency index
    bytes[771] = 0;

    return bytes.buffer;
  }

  exportToFormat(format = null) {
    // IMPORTANT: We always save to ACT format for embedded systems compatibility
    // This method is kept for flexibility but should default to ACT
    const targetFormat = format || 'act'; // Force ACT as default, not this.format
    
    switch (targetFormat.toLowerCase()) {
      case 'pal':
        // DEPRECATED: Only for external tool compatibility
        console.warn('[Palette] PAL export should only be used for external tools, not saving');
        return this.exportToPAL();
      case 'act':
      default:
        // PRIMARY: Always use ACT for actual saving
        return this.exportToACT();
    }
  }

  // Color manipulation methods
  getColor(index) {
    return this.colors[index] || '#000000';
  }

  setColor(index, hexColor) {
    if (index >= 0 && index < this.maxColors && this.isValidHex(hexColor)) {
      // Extend array if necessary
      while (this.colors.length <= index) {
        this.colors.push('#000000');
      }
      this.colors[index] = hexColor;
      return true;
    }
    return false;
  }

  addColor(hexColor) {
    if (this.colors.length < this.maxColors && this.isValidHex(hexColor)) {
      this.colors.push(hexColor);
      return this.colors.length - 1; // Return new index
    }
    return -1;
  }

  removeColor(index) {
    if (index >= 0 && index < this.colors.length) {
      return this.colors.splice(index, 1)[0];
    }
    return null;
  }

  getColors() {
    return [...this.colors]; // Return copy
  }

  setColors(colorArray) {
    this.colors = colorArray.slice(0, this.maxColors).filter(color => this.isValidHex(color));
  }

  getColorCount() {
    return this.colors.length;
  }

  clear() {
    this.colors = [];
  }

  // Advanced manipulation methods
  randomize() {
    for (let i = 0; i < this.maxColors; i++) {
      const r = Math.floor(Math.random() * 256);
      const g = Math.floor(Math.random() * 256);
      const b = Math.floor(Math.random() * 256);
      this.setColor(i, this.rgbToHex(r, g, b));
    }
    console.log(`[Palette] Randomized ${this.colors.length} colors`);
  }

  sortByHue() {
    // Convert colors to HSL, sort by hue, then convert back
    const colorData = this.colors.map((color, index) => ({
      original: color,
      index: index,
      hsl: this.hexToHsl(color)
    }));

    // Sort by hue, then saturation, then lightness
    colorData.sort((a, b) => {
      if (Math.abs(a.hsl.h - b.hsl.h) > 1) {
        return a.hsl.h - b.hsl.h;
      }
      if (Math.abs(a.hsl.s - b.hsl.s) > 1) {
        return b.hsl.s - a.hsl.s; // Higher saturation first
      }
      return a.hsl.l - b.hsl.l; // Lower lightness first
    });

    // Update colors with sorted order
    this.colors = colorData.map(item => item.original);
    console.log(`[Palette] Sorted ${this.colors.length} colors by hue`);
  }

  sortByBrightness() {
    // Sort colors by perceived brightness (luminance)
    const colorData = this.colors.map((color, index) => ({
      original: color,
      index: index,
      brightness: this.getPerceivedBrightness(color)
    }));

    colorData.sort((a, b) => a.brightness - b.brightness);
    this.colors = colorData.map(item => item.original);
    console.log(`[Palette] Sorted ${this.colors.length} colors by brightness`);
  }

  // Helper method for brightness calculation
  getPerceivedBrightness(hexColor) {
    const rgb = this.hexToRgb(hexColor);
    // Use standard luminance formula
    return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  }

  // Convert hex to HSL for sorting
  hexToHsl(hex) {
    const rgb = this.hexToRgb(hex);
    return this.rgbToHsl(rgb.r, rgb.g, rgb.b);
  }

  rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    
    if (max === min) {
      h = s = 0; // achromatic
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  // Color extraction from image data
  static extractColorsFromImageData(imageData, maxColors = 256) {
    const colorMap = new Map();
    const data = imageData.data;

    // Count color frequencies
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const alpha = data[i + 3];

      // Skip transparent pixels
      if (alpha < 128) continue;

      const hex = Palette.prototype.rgbToHex(r, g, b);
      colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
    }

    // Sort by frequency and take top colors
    const sortedColors = Array.from(colorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxColors)
      .map(entry => entry[0]);

    return sortedColors;
  }

  // Utility methods
  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }

  rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  isValidHex(hex) {
    return /^#[0-9A-Fa-f]{6}$/.test(hex);
  }

  getFileExtension(filename) {
    if (!filename || !filename.includes('.')) {
      return '.pal';
    }
    return '.' + filename.split('.').pop().toLowerCase();
  }

  getBaseName(filename) {
    if (!filename) return 'Untitled';
    return filename.split('/').pop().split('.')[0];
  }

  // Clone method
  clone() {
    const newPalette = new Palette();
    newPalette.colors = [...this.colors];
    newPalette.name = this.name;
    newPalette.format = this.format;
    newPalette.maxColors = this.maxColors;
    return newPalette;
  }

  // Validation
  isValid() {
    return this.colors.length > 0 && this.colors.every(color => this.isValidHex(color));
  }

  // String representation
  toString() {
    return `Palette(${this.name}, ${this.colors.length} colors, ${this.format} format)`;
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.Palette = Palette;
}

console.log('[Palette] Class definition loaded');
