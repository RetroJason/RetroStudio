// texture-data.js
// Data structures for texture and sprite graphics system

/**
 * Texture Data Structure
 * Represents a processed texture derived from a source image
 */
class TextureData {
  constructor(options = {}) {
    // Source data
    this.sourceImage = options.sourceImage || null; // File path or image data
    this.sourceImageData = options.sourceImageData || null; // Raw ImageData for processing
    
    // Processing settings
    this.colorDepth = options.colorDepth || 32; // 2, 4, 8, 16, 24, 32 bits
    this.compression = options.compression || 'none'; // 'none', 'tga-rle'
    this.rotation = options.rotation || 0; // 0, 90, 180, 270 degrees
    
    // Palette settings (for indexed color modes)
    this.palette = options.palette || null; // Array of RGB colors [r,g,b]
    this.paletteOffset = options.paletteOffset || 0; // Starting index in 256-color palette
    this.paletteSize = options.paletteSize || 256; // Number of colors used (2, 4, 16, 256)
    
    // Output data
    this.processedImageData = null; // Final processed ImageData
    this.textureData = null; // Final texture data for GPU/blitter
    this.width = options.width || 0;
    this.height = options.height || 0;
    
    // Metadata
    this.name = options.name || 'untitled_texture';
    this.createdAt = new Date();
    this.modifiedAt = new Date();
  }

  /**
   * Get color depth options
   */
  static getColorDepthOptions() {
    return [
      { value: 2, label: '2-bit (4 colors)', description: 'Monochrome with transparency' },
      { value: 4, label: '4-bit (16 colors)', description: 'Classic 16-color palette' },
      { value: 8, label: '8-bit (256 colors)', description: 'Standard indexed color' },
      { value: 16, label: '16-bit (65K colors)', description: 'High color RGB565' },
      { value: 24, label: '24-bit (16M colors)', description: 'True color RGB' },
      { value: 32, label: '32-bit (16M colors + alpha)', description: 'True color with transparency' }
    ];
  }

  /**
   * Get compression options
   */
  static getCompressionOptions() {
    return [
      { value: 'none', label: 'None', description: 'Uncompressed raw data' },
      { value: 'tga-rle', label: 'TGA RLE', description: 'Run-length encoding compression' }
    ];
  }

  /**
   * Validate texture settings
   */
  validate() {
    const errors = [];
    
    if (!this.sourceImage) {
      errors.push('Source image is required');
    }
    
    if (![2, 4, 8, 16, 24, 32].includes(this.colorDepth)) {
      errors.push('Invalid color depth');
    }
    
    if (!['none', 'tga-rle'].includes(this.compression)) {
      errors.push('Invalid compression type');
    }
    
    if (![0, 90, 180, 270].includes(this.rotation)) {
      errors.push('Rotation must be 0, 90, 180, or 270 degrees');
    }
    
    if (this.colorDepth <= 8 && !this.palette) {
      errors.push('Palette is required for indexed color modes');
    }
    
    return errors;
  }

  /**
   * Serialize to JSON
   */
  toJSON() {
    return {
      sourceImage: this.sourceImage,
      colorDepth: this.colorDepth,
      compression: this.compression,
      rotation: this.rotation,
      palette: this.palette,
      paletteOffset: this.paletteOffset,
      paletteSize: this.paletteSize,
      width: this.width,
      height: this.height,
      name: this.name,
      createdAt: this.createdAt,
      modifiedAt: this.modifiedAt
    };
  }

  /**
   * Load from JSON
   */
  static fromJSON(data) {
    return new TextureData(data);
  }
}

/**
 * Animation Frame Data Structure
 * Represents a single frame in a sprite animation
 */
class AnimationFrame {
  constructor(options = {}) {
    // Texture reference
    this.textureId = options.textureId || null; // Reference to texture
    
    // UV coordinates in texture (normalized 0-1)
    this.uvX = options.uvX || 0;
    this.uvY = options.uvY || 0;
    this.uvWidth = options.uvWidth || 1;
    this.uvHeight = options.uvHeight || 1;
    
    // Pixel coordinates (alternative to UV)
    this.pixelX = options.pixelX || 0;
    this.pixelY = options.pixelY || 0;
    this.pixelWidth = options.pixelWidth || 0;
    this.pixelHeight = options.pixelHeight || 0;
    
    // Frame timing
    this.duration = options.duration || 100; // milliseconds
    
    // Rendering offsets
    this.offsetX = options.offsetX || 0; // Pixel offset from sprite origin
    this.offsetY = options.offsetY || 0;
    
    // Optional frame properties
    this.flipX = options.flipX || false;
    this.flipY = options.flipY || false;
    this.rotation = options.rotation || 0;
    this.opacity = options.opacity !== undefined ? options.opacity : 1.0;
  }

  /**
   * Convert pixel coordinates to UV coordinates
   */
  pixelsToUV(textureWidth, textureHeight) {
    this.uvX = this.pixelX / textureWidth;
    this.uvY = this.pixelY / textureHeight;
    this.uvWidth = this.pixelWidth / textureWidth;
    this.uvHeight = this.pixelHeight / textureHeight;
  }

  /**
   * Convert UV coordinates to pixel coordinates
   */
  uvToPixels(textureWidth, textureHeight) {
    this.pixelX = Math.round(this.uvX * textureWidth);
    this.pixelY = Math.round(this.uvY * textureHeight);
    this.pixelWidth = Math.round(this.uvWidth * textureWidth);
    this.pixelHeight = Math.round(this.uvHeight * textureHeight);
  }
}

/**
 * Sprite Animation Data Structure
 * Represents a complete sprite with multiple animation sequences
 */
class SpriteData {
  constructor(options = {}) {
    this.name = options.name || 'untitled_sprite';
    this.animations = options.animations || new Map(); // name -> AnimationSequence
    this.defaultAnimation = options.defaultAnimation || null;
    this.textures = options.textures || new Map(); // textureId -> TextureData
    
    // Sprite properties
    this.originX = options.originX || 0; // Default origin point
    this.originY = options.originY || 0;
    this.boundingWidth = options.boundingWidth || 0;
    this.boundingHeight = options.boundingHeight || 0;
    
    // Metadata
    this.createdAt = new Date();
    this.modifiedAt = new Date();
  }

  /**
   * Add an animation sequence
   */
  addAnimation(name, frames = [], looping = true) {
    this.animations.set(name, {
      name,
      frames, // Array of AnimationFrame objects
      looping,
      totalDuration: frames.reduce((sum, frame) => sum + frame.duration, 0)
    });
    
    if (!this.defaultAnimation) {
      this.defaultAnimation = name;
    }
    
    this.modifiedAt = new Date();
  }

  /**
   * Get animation by name
   */
  getAnimation(name) {
    return this.animations.get(name);
  }

  /**
   * Add a texture reference
   */
  addTexture(textureId, textureData) {
    this.textures.set(textureId, textureData);
    this.modifiedAt = new Date();
  }

  /**
   * Serialize to JSON
   */
  toJSON() {
    return {
      name: this.name,
      animations: Array.from(this.animations.entries()),
      defaultAnimation: this.defaultAnimation,
      textures: Array.from(this.textures.entries()),
      originX: this.originX,
      originY: this.originY,
      boundingWidth: this.boundingWidth,
      boundingHeight: this.boundingHeight,
      createdAt: this.createdAt,
      modifiedAt: this.modifiedAt
    };
  }

  /**
   * Load from JSON
   */
  static fromJSON(data) {
    const sprite = new SpriteData(data);
    sprite.animations = new Map(data.animations || []);
    sprite.textures = new Map(data.textures || []);
    return sprite;
  }
}

// Export classes
window.TextureData = TextureData;
window.AnimationFrame = AnimationFrame;
window.SpriteData = SpriteData;

console.log('[TextureData] Graphics data structures loaded');
