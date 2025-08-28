// image.js
// Abstracted image functionality for loading images into color arrays
// Supports multiple frames for animated images and sprite sheets
//
// Features:
// - Load images from various formats (PNG, GIF, etc.)
// - Convert to color arrays for pixel manipulation
// - Support for multiple frames (animation, sprite sheets)
// - Frame management and navigation
// - Color extraction and analysis

console.log('[Image] Class definition loading');

// Import TextureFormatUtils for format-related utilities
// Import PaletteManager for palette-related functionality
// Import D2FormatHandler for D2 texture format operations
// Note: In browser environment, these will be loaded via script tags
// These comments serve as documentation of the dependencies

class ImageData {
  constructor(textureFile = null) {
    this.frames = [];
    this.currentFrame = 0;
    this.width = 0;
    this.height = 0;
    this.format = 'rgba';
    this.filename = '';
    this.metadata = {};
    
    // Initialize palette manager
    this.paletteManager = new PaletteManager();
    
    // Initialize D2 format handler
    this.d2Handler = new D2FormatHandler();
    
    // Color distance method for palette mapping
    this.colorDistanceMethod = 'euclidean'; // Default method
    
    // Texture configuration (from .texture file)
    this.textureConfig = null;
    
    // Texture processing cache
    this.textureCache = {
      // Source data cache (invalidated by source image changes)
      sourceData: null,
      sourceDataHash: null,
      
      // Binary data cache (invalidated by format/palette changes)
      binaryData: null,
      binaryDataFormat: null,
      binaryDataPalette: null,
      binaryDataPaletteHash: null,
      
      // Rendered data cache (invalidated by binary data or palette offset changes)
      renderedData: null,
      renderedDataPaletteOffset: 0,
      renderedDataHash: null
    };
    
    // If texture file is provided, initialize from it
    if (textureFile) {
      // Parse texture configuration immediately (synchronously)
      try {
        this.textureConfig = typeof textureFile === 'string' ? JSON.parse(textureFile) : textureFile;
        console.log('[Image] Texture config loaded in constructor:', this.textureConfig);
      } catch (error) {
        console.error('[Image] Failed to parse texture config:', error);
        throw error;
      }
    }
  }

  // Static factory methods
  static async fromFile(fileContent, filename = '') {
    const image = new ImageData();
    await image.loadFromContent(fileContent, filename);
    return image;
  }

  static fromCanvas(canvas, filename = 'canvas') {
    const image = new ImageData();
    image.loadFromCanvas(canvas, filename);
    return image;
  }

  /**
   * Initialize the image from a texture file configuration
   * @param {Object} textureFile - Texture file content with sourceImage, colorFormat, palette, etc.
   */
  async initializeFromTexture(textureFile) {
    try {
      // If texture config wasn't already loaded, parse it now
      if (!this.textureConfig) {
        this.textureConfig = typeof textureFile === 'string' ? JSON.parse(textureFile) : textureFile;
        console.log('[Image] Texture config loaded in initializeFromTexture:', this.textureConfig);
      }
      
      // Load the source image
      await this.loadSourceImageFromTexture();
      
      console.log('[Image] Initialized from texture file:', this.textureConfig);
    } catch (error) {
      console.error('[Image] Failed to initialize from texture file:', error);
      throw error;
    }
  }

  /**
   * Load the source image specified in the texture configuration
   */
  /**
   * Load texture from a .texture file path
   * @param {string} texturePath - Path to the .texture file
   */
  async loadFromTexturePath(texturePath) {
    // Get file manager for loading
    const fileManager = window.serviceContainer?.get('fileManager');
    if (!fileManager) {
      throw new Error('FileManager not available');
    }

    // Store the texture file path for relative path resolution
    this.textureFilePath = texturePath;

    // Load texture configuration file
    const textureFile = await fileManager.loadFile(texturePath);
    if (!textureFile) {
      throw new Error(`Texture file not found: ${texturePath}`);
    }

    // Parse texture configuration
    try {
      this.textureConfig = typeof textureFile.content === 'string' 
        ? JSON.parse(textureFile.content) 
        : textureFile.content;
      console.log('[ImageData] Loaded texture config from path:', texturePath, this.textureConfig);
    } catch (error) {
      console.error('[ImageData] Failed to parse texture config:', error);
      throw new Error(`Failed to parse texture configuration: ${error.message}`);
    }

    // Load the source image
    await this.loadSourceImageFromTexture();
  }

  async loadSourceImageFromTexture() {
    if (!this.textureConfig?.sourceImage) {
      console.error('[Image] loadSourceImageFromTexture - textureConfig:', this.textureConfig);
      throw new Error('No source image specified in texture configuration');
    }

    console.log('[Image] loadSourceImageFromTexture - sourceImage:', this.textureConfig.sourceImage);

    // Get file manager for loading
    const fileManager = window.serviceContainer?.get('fileManager');
    if (!fileManager) {
      throw new Error('FileManager not available');
    }

    // Resolve source image path relative to texture file
    let sourceImagePath = this.textureConfig.sourceImage;
    
    // If we have a texture file path and the source image is a relative path
    if (this.textureFilePath && !sourceImagePath.includes('/')) {
      // Get the directory of the texture file
      const textureDir = this.textureFilePath.substring(0, this.textureFilePath.lastIndexOf('/'));
      sourceImagePath = `${textureDir}/${sourceImagePath}`;
      console.log('[Image] Resolved source image path:', sourceImagePath);
    }

    // Load source image
    const sourceImageFile = await fileManager.loadFile(sourceImagePath);
    if (!sourceImageFile) {
      console.error('[Image] Failed to load source image file:', sourceImagePath);
      throw new Error(`Source image not found: ${sourceImagePath}`);
    }

    // Load the image content
    await this.loadFromContent(sourceImageFile.content, sourceImageFile.filename);
  }

  /**
   * Get D2 binary data for this texture
   * @returns {ArrayBuffer} D2 binary data
   */
  async getD2() {
    if (!this.textureConfig) {
      throw new Error('No texture configuration available. Initialize with texture file first.');
    }

    // Load palette if specified
    let palette = null;
    if (this.textureConfig.palette) {
      const fileManager = window.serviceContainer?.get('fileManager');
      if (fileManager && window.Palette) {
        try {
          const paletteFile = await fileManager.loadFile(this.textureConfig.palette);
          if (paletteFile) {
            palette = new window.Palette();
            await palette.loadFromContent(paletteFile.content, paletteFile.filename);
          }
        } catch (error) {
          console.warn('[Image] Failed to load palette:', error);
        }
      }
    }

    console.log('[Image] getD2() - texture config:', this.textureConfig);
    console.log('[Image] getD2() - color format:', this.textureConfig.colorFormat);

    // Map color format to D2 format
    const d2Format = this.mapColorFormatToD2(this.textureConfig.colorFormat || 'd2_mode_rgba8888');
    console.log('[Image] getD2() - mapped D2 format:', d2Format, 'from colorFormat:', this.textureConfig.colorFormat);

    // Export to D2 binary using D2FormatHandler
    const sourceRGBA = this.getSourceRGBAData();
    return this.d2Handler.exportToD2Binary(sourceRGBA, this.width, this.height, {
      format: d2Format,
      palette: palette,
      paletteName: this.textureConfig.paletteName || '',
      useRLE: this.textureConfig.RLE || false,
      flags: this.textureConfig.flags || 0,
      prerotation: this.textureConfig.rotation || 0
    });
  }

  /**
   * Map colorFormat string to D2 format constant
   * @param {string} colorFormat - Color format from texture file
   * @returns {number} D2 format constant
   */
  mapColorFormatToD2(colorFormat) {
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

    const format = formatMap[colorFormat];
    if (format === undefined) {
      throw new Error(`Unsupported color format: ${colorFormat}`);
    }
    return format;
  }

  static fromImageElement(imgElement, filename = '') {
    const image = new ImageData();
    image.loadFromImageElement(imgElement, filename);
    return image;
  }

  // Core loading operations
  async loadFromContent(content, filename = '') {
    this.filename = this.getBaseName(filename);
    
    try {
      // Check if this is a D2 texture format
      if (content instanceof ArrayBuffer && this.isD2Format(content)) {
        console.log('[Image] Detected D2 texture format');
        const d2Data = this.d2Handler.loadFromD2Binary(content);
        this.width = d2Data.width;
        this.height = d2Data.height;
        this.frames = d2Data.frames;
        this.metadata = d2Data.metadata;
        this.format = d2Data.format;
        return;
      }
      
      // Convert content to image element
      const imgElement = await this.contentToImageElement(content);
      this.loadFromImageElement(imgElement, filename);
      
      console.log(`[Image] Loaded image: ${this.width}x${this.height}, ${this.frames.length} frame(s)`);
    } catch (error) {
      console.error('[Image] Error loading image:', error);
      throw error;
    }
  }

  /**
   * Check if ArrayBuffer contains D2 texture format
   */
  isD2Format(arrayBuffer) {
    if (arrayBuffer.byteLength < 9) return false;
    
    const view = new DataView(arrayBuffer);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1));
    return magic === 'D2';
  }

  async contentToImageElement(content) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      
      if (typeof content === 'string') {
        // Assume base64 data URL or regular URL
        if (content.startsWith('data:')) {
          img.src = content;
        } else {
          // Base64 string - convert to data URL
          img.src = `data:image/png;base64,${content}`;
        }
      } else if (content instanceof ArrayBuffer) {
        // Binary data - convert to blob URL
        const blob = new Blob([content]);
        const url = URL.createObjectURL(blob);
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img);
        };
        img.src = url;
      } else {
        reject(new Error('Unsupported content type'));
      }
    });
  }

  loadFromCanvas(canvas, filename = 'canvas') {
    this.filename = filename;
    this.width = canvas.width;
    this.height = canvas.height;
    
    // Extract image data from canvas
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Convert to color array
    const frame = this.imageDataToColorArray(imageData);
    this.frames = [frame];
    this.currentFrame = 0;
    
    console.log(`[Image] Loaded from canvas: ${this.width}x${this.height}`);
  }

  loadFromImageElement(imgElement, filename = '') {
    this.filename = filename || this.getBaseName(imgElement.src);
    this.width = imgElement.naturalWidth || imgElement.width;
    this.height = imgElement.naturalHeight || imgElement.height;
    
    // Create canvas to extract pixel data
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d');
    
    // Draw image to canvas
    ctx.drawImage(imgElement, 0, 0);
    
    // Extract image data
    const imageData = ctx.getImageData(0, 0, this.width, this.height);
    
    // Convert to color array
    const frame = this.imageDataToColorArray(imageData);
    this.frames = [frame];
    this.currentFrame = 0;
    
    console.log(`[Image] Loaded from image element: ${this.width}x${this.height}`);
  }

  imageDataToColorArray(imageData) {
    const colors = [];
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      
      // Store as hex color with alpha
      const color = {
        hex: this.rgbToHex(r, g, b),
        alpha: a / 255,
        r: r,
        g: g,
        b: b,
        a: a
      };
      
      colors.push(color);
    }
    
    return {
      width: imageData.width,
      height: imageData.height,
      colors: colors,
      timestamp: Date.now()
    };
  }

  // Frame management
  addFrame(frameData) {
    if (frameData && frameData.colors && frameData.width && frameData.height) {
      this.frames.push({
        ...frameData,
        index: this.frames.length,
        timestamp: Date.now()
      });
      return this.frames.length - 1;
    }
    return -1;
  }

  /**
   * Add all frames from another ImageData instance to this one
   * @param {ImageData} otherImage - The image to add frames from
   * @returns {number} Number of frames added
   */
  addImage(otherImage) {
    if (!otherImage || !otherImage.frames || otherImage.frames.length === 0) {
      console.error('ImageData: Invalid image or no frames to add');
      return 0;
    }

    let framesAdded = 0;
    otherImage.frames.forEach(frame => {
      // Create a copy of the frame data
      const frameCopy = {
        width: frame.width,
        height: frame.height,
        colors: frame.colors.slice(), // Copy the colors array
        timestamp: Date.now(),
        sourceImage: otherImage.filename || 'unknown'
      };
      
      this.addFrame(frameCopy);
      framesAdded++;
    });

    console.log(`ImageData: Added ${framesAdded} frames from ${otherImage.filename || 'image'}`);
    return framesAdded;
  }

  /**
   * Create a new ImageData by combining multiple images
   * @param {ImageData[]} images - Array of ImageData instances to combine
   * @param {string} filename - Name for the combined image
   * @returns {ImageData} New ImageData instance with all frames
   */
  static combine(images, filename = 'combined') {
    const combined = new ImageData();
    combined.filename = filename;
    
    let totalFrames = 0;
    images.forEach((image, index) => {
      if (image && image.frames) {
        const added = combined.addImage(image);
        totalFrames += added;
        console.log(`ImageData: Combined image ${index + 1}: ${added} frames`);
      }
    });
    
    console.log(`ImageData: Created combined image with ${totalFrames} total frames`);
    return combined;
  }

  removeFrame(index) {
    if (index >= 0 && index < this.frames.length && this.frames.length > 1) {
      const removed = this.frames.splice(index, 1)[0];
      
      // Adjust current frame if necessary
      if (this.currentFrame >= this.frames.length) {
        this.currentFrame = this.frames.length - 1;
      }
      
      return removed;
    }
    return null;
  }

  setCurrentFrame(index) {
    if (index >= 0 && index < this.frames.length) {
      this.currentFrame = index;
      return true;
    }
    return false;
  }

  getCurrentFrame() {
    return this.frames[this.currentFrame] || null;
  }

  getFrame(index) {
    return this.frames[index] || null;
  }

  getFrameCount() {
    return this.frames.length;
  }

  // Color extraction and analysis
  extractColors(maxColors = 256, frameIndex = null) {
    const frame = frameIndex !== null ? this.getFrame(frameIndex) : this.getCurrentFrame();
    if (!frame) return [];
    
    const colorMap = new Map();
    
    // Count color frequencies
    frame.colors.forEach(colorObj => {
      // Skip transparent pixels
      if (colorObj.alpha < 0.5) return;
      
      const hex = colorObj.hex;
      colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
    });
    
    // Sort by frequency and return top colors
    return Array.from(colorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxColors)
      .map(entry => entry[0]);
  }

  getUniqueColors(frameIndex = null) {
    const frame = frameIndex !== null ? this.getFrame(frameIndex) : this.getCurrentFrame();
    if (!frame) return [];
    
    const uniqueColors = new Set();
    frame.colors.forEach(colorObj => {
      if (colorObj.alpha >= 0.5) { // Skip transparent pixels
        uniqueColors.add(colorObj.hex);
      }
    });
    
    return Array.from(uniqueColors);
  }

  getColorAt(x, y, frameIndex = null) {
    const frame = frameIndex !== null ? this.getFrame(frameIndex) : this.getCurrentFrame();
    if (!frame || x < 0 || x >= frame.width || y < 0 || y >= frame.height) {
      return null;
    }
    
    const index = y * frame.width + x;
    return frame.colors[index] || null;
  }

  setColorAt(x, y, color, frameIndex = null) {
    const frame = frameIndex !== null ? this.getFrame(frameIndex) : this.getCurrentFrame();
    if (!frame || x < 0 || x >= frame.width || y < 0 || y >= frame.height) {
      return false;
    }
    
    const index = y * frame.width + x;
    if (index < frame.colors.length) {
      // Convert hex color to color object
      if (typeof color === 'string') {
        const rgb = this.hexToRgb(color);
        frame.colors[index] = {
          hex: color,
          alpha: 1,
          r: rgb.r,
          g: rgb.g,
          b: rgb.b,
          a: 255
        };
      } else {
        frame.colors[index] = { ...color };
      }
      return true;
    }
    return false;
  }

  // Export methods
  toCanvas(frameIndex = null) {
    const frame = frameIndex !== null ? this.getFrame(frameIndex) : this.getCurrentFrame();
    if (!frame) {
      return null;
    }
    
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext('2d');
    
    // Create ImageData
    const imageData = ctx.createImageData(frame.width, frame.height);
    const data = imageData.data;
    
    // Handle different frame formats
    if (frame.data && frame.data instanceof Uint8ClampedArray) {
      // D2 format: frame has RGBA data directly
      for (let i = 0; i < frame.data.length; i++) {
        data[i] = frame.data[i];
      }
    } else if (frame.colors && Array.isArray(frame.colors)) {
      // Original format: frame has colors array
      frame.colors.forEach((colorObj, index) => {
        const i = index * 4;
        data[i] = colorObj.r;
        data[i + 1] = colorObj.g;
        data[i + 2] = colorObj.b;
        data[i + 3] = colorObj.a;
      });
    } else {
      return null;
    }
    
    // Put image data to canvas
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  toImageData(frameIndex = null) {
    const frame = frameIndex !== null ? this.getFrame(frameIndex) : this.getCurrentFrame();
    if (!frame) return null;
    
    // Create a temporary canvas to generate ImageData
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext('2d');
    
    const imageData = ctx.createImageData(frame.width, frame.height);
    const data = imageData.data;
    
    frame.colors.forEach((colorObj, index) => {
      const i = index * 4;
      data[i] = colorObj.r;
      data[i + 1] = colorObj.g;
      data[i + 2] = colorObj.b;
      data[i + 3] = colorObj.a;
    });
    
    return imageData;
  }

  /**
   * Render this texture to a browser ImageData object using proper texture processing
   * This handles indexed formats, palettes, and offsets automatically
   * Returns a browser ImageData object ready for canvas.putImageData()
   */
  async render(paletteOffset = 0, palette = null) {
    console.log('[ImageData] Rendering texture with palette offset:', paletteOffset);
    
    // For D2 files, use the already converted RGBA data
    if (this.metadata && this.metadata.format === 'd2') {
      const frame = this.getCurrentFrame();
      if (!frame || !frame.data) {
        throw new Error('No frame data available for D2 file');
      }
      
      console.log('[ImageData] D2 file already converted to RGBA, creating browser ImageData object');
      // Use the global window.ImageData constructor to ensure we get a browser ImageData object
      return new window.ImageData(frame.data, frame.width, frame.height);
    }
    
    // For other formats, extract format and palette information from metadata
    if (!this.metadata) {
      throw new Error('No metadata available for rendering');
    }
    
    const { isIndexed, baseFormat, paletteName } = this.metadata;
    
    if (!isIndexed) {
      throw new Error('Non-indexed textures are not yet supported');
    }
    
    console.log('[ImageData] Rendering indexed texture:', { baseFormat, paletteName });
    
    // Determine color format based on base format using D2_FORMAT constants
    let colorFormat;
    if (baseFormat === ImageData.D2_FORMAT.I1) colorFormat = 'd2_mode_i1';
    else if (baseFormat === ImageData.D2_FORMAT.I2) colorFormat = 'd2_mode_i2';
    else if (baseFormat === ImageData.D2_FORMAT.I4) colorFormat = 'd2_mode_i4';
    else if (baseFormat === ImageData.D2_FORMAT.I8) colorFormat = 'd2_mode_i8';
    else throw new Error(`Unsupported indexed base format: ${baseFormat} (expected I1=${ImageData.D2_FORMAT.I1}, I2=${ImageData.D2_FORMAT.I2}, I4=${ImageData.D2_FORMAT.I4}, or I8=${ImageData.D2_FORMAT.I8})`);
    
    console.log('[ImageData] Using color format:', colorFormat, 'for base format:', baseFormat);
    
    // Use provided palette or try to load the embedded palette
    let paletteColors = palette;
    if (!paletteColors && paletteName) {
      paletteColors = await this.paletteManager.loadPalette(paletteName);
    }
    
    if (!paletteColors) {
      throw new Error(`No palette available for rendering (paletteName: ${paletteName})`);
    }
    
    console.log('[ImageData] Loaded palette with', paletteColors.length, 'colors');
    
    // For indexed textures, we need indexed data - render it directly instead of going through texture processing pipeline
    const frame = this.getCurrentFrame();
    if (!frame || !frame.data) {
      throw new Error('No frame data available');
    }
    
    console.log('[ImageData] Rendering indexed data directly, frame size:', frame.data.length);
    
    // Use the appropriate render method based on format
    let rgbaData;
    if (colorFormat === 'd2_mode_i4') {
      rgbaData = this.renderIndexed8Data(frame.data, paletteColors, paletteOffset);
    } else if (colorFormat === 'd2_mode_i2') {
      rgbaData = this.renderIndexed2Data(frame.data, paletteColors, paletteOffset);
    } else if (colorFormat === 'd2_mode_i1') {
      rgbaData = this.renderIndexed1Data(frame.data, paletteColors, paletteOffset);
    } else {
      throw new Error(`Unsupported indexed color format: ${colorFormat}`);
    }
    
    if (!rgbaData || rgbaData.length === 0) {
      throw new Error('Failed to get rendered RGBA data from texture processing pipeline');
    }
    
    // Create browser ImageData from RGBA data
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(this.width, this.height);
    imageData.data.set(new Uint8ClampedArray(rgbaData));
    
    return imageData;
  }

  // Utility methods
  rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }

  getBaseName(filename) {
    if (!filename) return 'Untitled';
    return filename.split('/').pop().split('.')[0];
  }

  getFileExtension(filename) {
    if (!filename || !filename.includes('.')) {
      return '.png';
    }
    return '.' + filename.split('.').pop().toLowerCase();
  }

  // Clone method
  clone() {
    const newImage = new ImageData();
    newImage.frames = this.frames.map(frame => ({
      ...frame,
      colors: [...frame.colors]
    }));
    newImage.currentFrame = this.currentFrame;
    newImage.width = this.width;
    newImage.height = this.height;
    newImage.format = this.format;
    newImage.filename = this.filename;
    newImage.metadata = { ...this.metadata };
    return newImage;
  }

  // Validation
  isValid() {
    return this.frames.length > 0 && 
           this.width > 0 && 
           this.height > 0 &&
           this.getCurrentFrame() !== null;
  }

  // String representation
  toString() {
    return `Image(${this.filename}, ${this.width}x${this.height}, ${this.frames.length} frame(s))`;
  }

  // Animation helpers (for future expansion)
  nextFrame() {
    if (this.frames.length > 1) {
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
      return this.currentFrame;
    }
    return this.currentFrame;
  }

  previousFrame() {
    if (this.frames.length > 1) {
      this.currentFrame = this.currentFrame > 0 ? this.currentFrame - 1 : this.frames.length - 1;
      return this.currentFrame;
    }
    return this.currentFrame;
  }

  // Color depth reduction methods
  
  /**
   * Reduce image to specified number of colors using median cut algorithm
   * @param {number} frameIndex - Index of the frame to process (default: current frame, null for all frames)
   * @param {number} colorCount - Target number of colors (2-256)
   * @param {Object} options - Options object
   * @param {HTMLElement} options.container - Container element for progress UI
   * @param {string} options.algorithm - Algorithm to use ('median-cut', 'simple-sample', or 'auto')
   * @param {function} options.onProgress - Progress callback function
   * @param {boolean} options.allFrames - Process all frames together (default: false)
   * @returns {Object} Object containing palette array and indexed byte array(s)
   */
  async reduceColors(frameIndex = null, colorCount = 16, options = {}) {
    const { container, algorithm = 'auto', onProgress, allFrames = false } = options;
    
    // Determine which frames to process
    let framesToProcess = [];
    if (allFrames || frameIndex === null) {
      framesToProcess = this.frames;
      if (framesToProcess.length === 0) {
        console.error('ImageData: No frames available for color reduction');
        return null;
      }
    } else {
      const frame = this.getFrame(frameIndex);
      if (!frame) {
        console.error('ImageData: Invalid frame for color reduction');
        return null;
      }
      framesToProcess = [frame];
    }

    if (colorCount < 2 || colorCount > 256) {
      console.error('ImageData: Color count must be between 2 and 256');
      return null;
    }
    
    // Create progress UI if container provided
    let progressUI = null;
    if (container) {
      progressUI = this._createProgressUI(container);
      await this._updateProgressAsync(progressUI, 'Analyzing images...', 5);
    }

    console.log(`ImageData: Reducing ${framesToProcess.length} frame(s) to ${colorCount} colors`);

    // Extract RGB values from all frames, skip transparent pixels
    const colorCounts = new Map();
    let totalPixels = 0;
    
    // Process all frames together to build combined color histogram
    for (let frameIdx = 0; frameIdx < framesToProcess.length; frameIdx++) {
      const frame = framesToProcess[frameIdx];
      
      if (progressUI) {
        const frameProgress = 5 + (frameIdx / framesToProcess.length) * 20;
        await this._updateProgressAsync(progressUI, `Analyzing frame ${frameIdx + 1}/${framesToProcess.length}...`, frameProgress);
      }
      
      for (let pixelIdx = 0; pixelIdx < frame.colors.length; pixelIdx++) {
        const colorObj = frame.colors[pixelIdx];
        if (colorObj.alpha >= 0.5) { // Only include opaque pixels
          const key = `${colorObj.r},${colorObj.g},${colorObj.b}`;
          if (!colorCounts.has(key)) {
            colorCounts.set(key, {
              r: colorObj.r,
              g: colorObj.g,
              b: colorObj.b,
              count: 1
            });
          } else {
            colorCounts.get(key).count++;
          }
          totalPixels++;
        }
        
        // Update progress during preprocessing
        if (progressUI && (pixelIdx % 10000 === 0)) {
          const pixelProgress = 5 + (frameIdx / framesToProcess.length) * 20 + 
                               (pixelIdx / frame.colors.length) * (20 / framesToProcess.length);
          await this._updateProgressAsync(progressUI, 
            `Analyzing frame ${frameIdx + 1}/${framesToProcess.length} (${Math.round(pixelIdx/1000)}k pixels)...`, 
            pixelProgress);
        }
      }
    }
    
    // Convert to array of unique colors
    const uniqueColors = Array.from(colorCounts.values());
    
    if (uniqueColors.length === 0) {
      if (progressUI) this._destroyProgressUI(progressUI);
      console.error('ImageData: No opaque pixels found in frames');
      return null;
    }

    if (progressUI) {
      await this._updateProgressAsync(progressUI, `Found ${uniqueColors.length} unique colors across ${framesToProcess.length} frame(s)`, 30);
    }

    console.log(`ImageData: Found ${uniqueColors.length} unique colors across ${framesToProcess.length} frame(s)`);

    // If we already have fewer unique colors than target, just return them
    if (uniqueColors.length <= colorCount) {
      if (progressUI) {
        await this._updateProgressAsync(progressUI, 'Padding palette with black...', 80);
      }
      
      console.log('ImageData: Images already have fewer colors than target, padding with black');
      const palette = uniqueColors.map(rgb => this._rgbToHex(rgb));
      
      // Pad with black colors to reach the target count
      while (palette.length < colorCount) {
        palette.push('#000000');
      }
      
      if (progressUI) {
        await this._updateProgressAsync(progressUI, 'Creating indexed data...', 90);
      }
      
      // Create indexed arrays for all processed frames
      const indexedFrames = [];
      const colorToIndex = new Map();
      uniqueColors.forEach((color, index) => {
        const key = `${color.r},${color.g},${color.b}`;
        colorToIndex.set(key, index);
      });
      
      for (const frame of framesToProcess) {
        const indexedData = new Uint8Array(frame.colors.length);
        
        for (let i = 0; i < frame.colors.length; i++) {
          const colorObj = frame.colors[i];
          if (colorObj.alpha < 0.5) {
            indexedData[i] = 0;
          } else {
            const key = `${colorObj.r},${colorObj.g},${colorObj.b}`;
            indexedData[i] = colorToIndex.get(key) || 0;
          }
        }
        
        indexedFrames.push({
          indexedData: indexedData,
          width: frame.width,
          height: frame.height
        });
      }
      
      if (progressUI) {
        await this._updateProgressAsync(progressUI, 'Complete!', 100);
        setTimeout(() => this._destroyProgressUI(progressUI), 500);
      }
      
      return {
        palette: palette,
        indexedFrames: indexedFrames,
        frameCount: framesToProcess.length,
        originalColors: uniqueColors.length,
        reducedColors: palette.length
      };
    }

    // Determine which algorithm to use
    let selectedAlgorithm = algorithm;
    if (algorithm === 'auto') {
      // Auto-select based on color count and complexity
      selectedAlgorithm = uniqueColors.length > 10000 ? 'simple-sample' : 'median-cut';
    }

    if (progressUI) {
      await this._updateProgressAsync(progressUI, `Using ${selectedAlgorithm} algorithm on combined color data...`, 40);
    }

    // Use selected algorithm on combined color data
    let palette;
    try {
      if (selectedAlgorithm === 'median-cut') {
        palette = await this._medianCutOptimizedAsync(uniqueColors, colorCount, progressUI);
      } else {
        palette = this._simpleSample(uniqueColors, colorCount);
      }
    } catch (error) {
      console.error('ImageData: Algorithm failed, falling back to simple sampling:', error);
      if (progressUI) {
        await this._updateProgressAsync(progressUI, 'Algorithm failed, using fallback...', 50);
      }
      palette = this._simpleSample(uniqueColors, colorCount);
    }
    
    // Ensure we always have exactly the requested number of colors
    const hexPalette = palette.map(rgb => this._rgbToHex(rgb));
    while (hexPalette.length < colorCount) {
      hexPalette.push('#000000');
    }
    // Trim if we somehow got too many colors
    if (hexPalette.length > colorCount) {
      hexPalette.length = colorCount;
    }
    
    if (progressUI) {
      await this._updateProgressAsync(progressUI, 'Creating indexed data for all frames...', 80);
    }

    // Create indexed arrays for all processed frames using the reduced palette
    const indexedFrames = [];
    const rgbPalette = palette.slice(); // Keep original RGB palette for distance calculations
    
    for (let frameIdx = 0; frameIdx < framesToProcess.length; frameIdx++) {
      const frame = framesToProcess[frameIdx];
      const indexedData = new Uint8Array(frame.colors.length);
      
      if (progressUI && frameIdx % 5 === 0) {
        const progress = 80 + (frameIdx / framesToProcess.length) * 15;
        await this._updateProgressAsync(progressUI, `Indexing frame ${frameIdx + 1}/${framesToProcess.length}...`, progress);
      }
      
      for (let i = 0; i < frame.colors.length; i++) {
        const colorObj = frame.colors[i];
        
        if (colorObj.alpha < 0.5) {
          // Transparent pixel - use index 0
          indexedData[i] = 0;
          continue;
        }
        
        const rgb = { r: colorObj.r, g: colorObj.g, b: colorObj.b };
        let bestMatch = 0;
        let bestDistance = Infinity;
        
        for (let j = 0; j < rgbPalette.length; j++) {
          const distance = this._colorDistance(rgb, rgbPalette[j]);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestMatch = j;
          }
        }
        
        indexedData[i] = bestMatch;
      }
      
      indexedFrames.push({
        indexedData: indexedData,
        width: frame.width,
        height: frame.height
      });
    }

    if (progressUI) {
      await this._updateProgressAsync(progressUI, 'Complete!', 100);
      setTimeout(() => this._destroyProgressUI(progressUI), 500);
    }

    console.log(`ImageData: Successfully reduced ${framesToProcess.length} frame(s) to ${hexPalette.length} colors`);

    return {
      palette: hexPalette,
      indexedFrames: indexedFrames,
      frameCount: framesToProcess.length,
      originalColors: uniqueColors.length,
      reducedColors: hexPalette.length
    };
  }  /**
   * Match image colors to an existing palette
   * @param {number} frameIndex - Index of the frame to process (default: current frame)
   * @param {string[]|Object} palette - Palette object or array of hex colors
   * @param {number} offset - Starting index in palette (default: 0)
   * @param {number} colorCount - Number of colors to use from palette (default: all remaining)
   * @param {Object} options - Options object
   * @param {HTMLElement} options.container - Container element for progress UI
   * @returns {Object} Object containing indexed byte array and palette info
   */
  matchToPalette(frameIndex = null, palette, offset = 0, colorCount = null, options = {}) {
    const { container } = options;
    const frame = frameIndex !== null ? this.getFrame(frameIndex) : this.getCurrentFrame();
    if (!frame) {
      console.error('ImageData: Invalid frame for palette matching');
      return null;
    }

    // Handle palette input (could be Palette object or array)
    let paletteColors;
    if (palette && typeof palette.getColors === 'function') {
      // It's a Palette object
      paletteColors = palette.getColors();
    } else if (Array.isArray(palette)) {
      // It's an array of colors
      paletteColors = palette;
    } else {
      console.error('ImageData: Invalid palette provided');
      return null;
    }

    // Apply offset and color count limits
    const startIndex = Math.max(0, offset);
    const endIndex = colorCount ? Math.min(startIndex + colorCount, paletteColors.length) : paletteColors.length;
    const workingPalette = paletteColors.slice(startIndex, endIndex);

    if (workingPalette.length === 0) {
      console.error('ImageData: No colors available in specified palette range');
      return null;
    }

    console.log(`ImageData: Matching frame to palette (${workingPalette.length} colors, offset: ${offset})`);

    // Create progress UI if container provided
    let progressUI = null;
    if (container) {
      progressUI = this._createProgressUI(container);
      this._updateProgress(progressUI, 'Matching colors to palette...', 5);
    }

    // Convert palette to RGB for distance calculations
    const rgbPalette = workingPalette.map(hex => this._hexToRgb(hex));
    
    // Create indexed array by finding best match for each pixel
    const indexedData = new Uint8Array(frame.colors.length);
    
    for (let i = 0; i < frame.colors.length; i++) {
      const colorObj = frame.colors[i];
      
      if (colorObj.alpha < 0.5) {
        // Transparent pixel - use first palette index or offset
        indexedData[i] = offset;
        continue;
      }
      
      const pixelRgb = { r: colorObj.r, g: colorObj.g, b: colorObj.b };
      let bestMatch = 0;
      let bestDistance = Infinity;
      
      for (let j = 0; j < rgbPalette.length; j++) {
        const distance = this._colorDistance(pixelRgb, rgbPalette[j]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestMatch = j;
        }
      }
      
      // Store the actual palette index (including offset)
      indexedData[i] = bestMatch + offset;

      // Update progress every 1000 pixels
      if (progressUI && (i % 1000 === 0 || i === frame.colors.length - 1)) {
        const progress = 10 + (i / frame.colors.length) * 85;
        const pixelCount = Math.floor(i / 1000) * 1000;
        this._updateProgress(progressUI, `Matching pixel ${pixelCount.toLocaleString()} of ${frame.colors.length.toLocaleString()}...`, progress);
      }
    }

    if (progressUI) {
      this._updateProgress(progressUI, 'Complete!', 100);
      setTimeout(() => this._destroyProgressUI(progressUI), 500);
    }

    return {
      palette: workingPalette,
      indexedFrames: [{
        indexedData: indexedData,
        width: frame.width,
        height: frame.height
      }],
      frameCount: 1,
      paletteOffset: offset,
      colorCount: workingPalette.length,
      originalColors: this.getUniqueColors(frameIndex).length,
      reducedColors: workingPalette.length
    };
  }

  // Color utility methods for reduction algorithms
  
  async _medianCutOptimizedAsync(colors, targetCount, progressUI = null) {
    if (colors.length <= targetCount) {
      return colors.slice(); // Return copy if already small enough
    }
    
    // Allow more iterations for higher target counts, but cap at reasonable limit
    const maxIterations = Math.min(targetCount * 3, 1000);
    let iterations = 0;
    
    // Start with all colors in one bucket
    const buckets = [colors.slice()];
    
    // Keep splitting until we have enough buckets or hit limits
    while (buckets.length < targetCount && iterations < maxIterations) {
      iterations++;
      
      // Update progress and yield control to UI
      if (progressUI) {
        const progress = 50 + (iterations / maxIterations) * 25;
        await this._updateProgressAsync(progressUI, `Median cut iteration ${iterations} (${buckets.length}/${targetCount} colors)...`, progress);
      }
      
      // Find the bucket with the largest range and most colors
      let largestBucket = null;
      let largestScore = -1;
      let largestChannel = null;
      
      for (let i = 0; i < buckets.length; i++) {
        const bucket = buckets[i];
        if (bucket.length <= 1) continue;
        
        // Calculate range for each color channel
        const ranges = this._calculateColorRanges(bucket);
        const maxRange = Math.max(ranges.r, ranges.g, ranges.b);
        
        // Lower the score threshold to allow more splitting
        const score = maxRange * Math.log(bucket.length + 1);
        
        if (score > largestScore) {
          largestScore = score;
          largestBucket = i;
          largestChannel = ranges.r >= ranges.g && ranges.r >= ranges.b ? 'r' :
                         ranges.g >= ranges.b ? 'g' : 'b';
        }
      }
      
      // Lower the threshold for meaningful splits to allow more buckets
      if (largestBucket === null || largestScore < 0.1) {
        console.log(`ImageData: Median cut stopping - no more splittable buckets (score: ${largestScore})`);
        break;
      }
      
      // Split the selected bucket
      const bucket = buckets[largestBucket];
      bucket.sort((a, b) => a[largestChannel] - b[largestChannel]);
      
      const midpoint = Math.floor(bucket.length / 2);
      const bucket1 = bucket.slice(0, midpoint);
      const bucket2 = bucket.slice(midpoint);
      
      buckets[largestBucket] = bucket1;
      buckets.push(bucket2);
      
      // Yield control every few iterations to keep UI responsive
      if (iterations % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    console.log(`ImageData: Median cut completed in ${iterations} iterations, ${buckets.length} buckets (target: ${targetCount})`);
    
    if (progressUI) {
      await this._updateProgressAsync(progressUI, 'Calculating final colors...', 75);
    }
    
    // Calculate weighted average color for each bucket
    const result = buckets.map(bucket => this._weightedAverageColor(bucket));
    
    // If we still don't have enough colors, duplicate some colors to reach target
    while (result.length < targetCount) {
      if (result.length > 0) {
        // Duplicate existing colors if we have some
        const indexToDuplicate = result.length % result.length;
        result.push({ ...result[indexToDuplicate] });
      } else {
        // Fallback to black if something went wrong
        result.push({ r: 0, g: 0, b: 0 });
      }
    }
    
    // Trim if we somehow got too many colors
    if (result.length > targetCount) {
      result.length = targetCount;
    }
    
    console.log(`ImageData: Final result has ${result.length} colors`);
    
    return result;
  }

  _medianCutOptimized(colors, targetCount, progressUI = null) {
    // Legacy sync version - calls async version but blocks
    return this._medianCutOptimizedAsync(colors, targetCount, progressUI);
  }
  
  _simpleSample(colors, targetCount) {
    // Simple fallback: just sample colors evenly
    console.log('ImageData: Using simple sampling fallback');
    
    if (colors.length <= targetCount) {
      // Pad with black if we need more colors
      const result = colors.slice();
      while (result.length < targetCount) {
        result.push({ r: 0, g: 0, b: 0 });
      }
      return result;
    }
    
    const step = colors.length / targetCount;
    const sampled = [];
    
    for (let i = 0; i < targetCount; i++) {
      const index = Math.floor(i * step);
      sampled.push(colors[index]);
    }
    
    return sampled;
  }

  _medianCut(colors, targetCount) {
    // Legacy method - kept for compatibility but calls optimized version
    return this._medianCutOptimized(colors, targetCount);
  }
  
  _calculateColorRanges(colors) {
    if (colors.length === 0) return { r: 0, g: 0, b: 0 };
    
    let minR = colors[0].r, maxR = colors[0].r;
    let minG = colors[0].g, maxG = colors[0].g;
    let minB = colors[0].b, maxB = colors[0].b;
    
    for (let i = 1; i < colors.length; i++) {
      const color = colors[i];
      minR = Math.min(minR, color.r);
      maxR = Math.max(maxR, color.r);
      minG = Math.min(minG, color.g);
      maxG = Math.max(maxG, color.g);
      minB = Math.min(minB, color.b);
      maxB = Math.max(maxB, color.b);
    }
    
    return {
      r: maxR - minR,
      g: maxG - minG,
      b: maxB - minB
    };
  }
  
  _averageColor(colors) {
    if (colors.length === 0) return { r: 0, g: 0, b: 0 };
    
    let totalR = 0, totalG = 0, totalB = 0;
    
    for (const color of colors) {
      totalR += color.r;
      totalG += color.g;
      totalB += color.b;
    }
    
    return {
      r: Math.round(totalR / colors.length),
      g: Math.round(totalG / colors.length),
      b: Math.round(totalB / colors.length)
    };
  }
  
  _weightedAverageColor(colors) {
    if (colors.length === 0) return { r: 0, g: 0, b: 0 };
    
    let totalR = 0, totalG = 0, totalB = 0, totalWeight = 0;
    
    for (const color of colors) {
      const weight = color.count || 1; // Use count if available, otherwise 1
      totalR += color.r * weight;
      totalG += color.g * weight;
      totalB += color.b * weight;
      totalWeight += weight;
    }
    
    if (totalWeight === 0) return { r: 0, g: 0, b: 0 };
    
    return {
      r: Math.round(totalR / totalWeight),
      g: Math.round(totalG / totalWeight),
      b: Math.round(totalB / totalWeight)
    };
  }
  
  _colorDistance(color1, color2) {
    // Euclidean distance in RGB space
    const dr = color1.r - color2.r;
    const dg = color1.g - color2.g;
    const db = color1.b - color2.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }
  
  _hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }
  
  _rgbToHex(rgb) {
    const toHex = (n) => {
      const hex = Math.max(0, Math.min(255, Math.round(n))).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
  }

  // Progress UI utility methods
  
  _createProgressUI(container) {
    console.log('[Image] Creating progress UI in container:', !!container, container?.tagName);
    const progressContainer = document.createElement('div');
    progressContainer.className = 'image-progress-container';
    progressContainer.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 20px;
      border-radius: 8px;
      min-width: 300px;
      text-align: center;
      z-index: 10000;
      font-family: monospace;
    `;

    const title = document.createElement('div');
    title.textContent = 'Processing Image';
    title.style.cssText = `
      font-size: 16px;
      margin-bottom: 15px;
      font-weight: bold;
    `;

    const statusText = document.createElement('div');
    statusText.className = 'progress-status';
    statusText.textContent = 'Initializing...';
    statusText.style.cssText = `
      font-size: 14px;
      margin-bottom: 10px;
      min-height: 20px;
    `;

    const progressBar = document.createElement('div');
    progressBar.style.cssText = `
      width: 100%;
      height: 20px;
      background: #333;
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 10px;
    `;

    const progressFill = document.createElement('div');
    progressFill.className = 'progress-fill';
    progressFill.style.cssText = `
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, #4CAF50, #45a049);
      transition: width 0.3s ease;
      border-radius: 10px;
    `;

    const percentText = document.createElement('div');
    percentText.className = 'progress-percent';
    percentText.textContent = '0%';
    percentText.style.cssText = `
      font-size: 12px;
      color: #ccc;
    `;

    progressBar.appendChild(progressFill);
    progressContainer.appendChild(title);
    progressContainer.appendChild(statusText);
    progressContainer.appendChild(progressBar);
    progressContainer.appendChild(percentText);

    container.appendChild(progressContainer);
    console.log('[Image] Progress UI created and added to container');

    return {
      container: progressContainer,
      statusText: statusText,
      progressFill: progressFill,
      percentText: percentText
    };
  }

  _updateProgress(progressUI, status, percent) {
    if (!progressUI) return;
    
    console.log('[Image] Updating progress (async):', status, percent + '%');
    progressUI.statusText.textContent = status;
    progressUI.progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    progressUI.percentText.textContent = `${Math.round(percent)}%`;
    
    // Force immediate DOM update
    progressUI.container.offsetHeight; // Force reflow
  }

  _updateProgressSync(progressUI, status, percent) {
    if (!progressUI) return;
    
    console.log('[Image] Updating progress:', status, percent + '%');
    progressUI.statusText.textContent = status;
    progressUI.progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    progressUI.percentText.textContent = `${Math.round(percent)}%`;
  }

  async _updateProgressAsync(progressUI, status, percent) {
    this._updateProgressSync(progressUI, status, percent);
    // Use requestAnimationFrame for efficient UI updates
    await new Promise(resolve => requestAnimationFrame(resolve));
  }

  _destroyProgressUI(progressUI) {
    if (progressUI && progressUI.container && progressUI.container.parentNode) {
      progressUI.container.parentNode.removeChild(progressUI.container);
    }
  }

  // Sprite sheet helpers (for future expansion)
  extractSprites(spriteWidth, spriteHeight, startX = 0, startY = 0) {
    const frame = this.getCurrentFrame();
    if (!frame) return [];
    
    const sprites = [];
    const cols = Math.floor((frame.width - startX) / spriteWidth);
    const rows = Math.floor((frame.height - startY) / spriteHeight);
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const sprite = this.extractRegion(
          startX + col * spriteWidth,
          startY + row * spriteHeight,
          spriteWidth,
          spriteHeight
        );
        if (sprite) {
          sprites.push({
            sprite: sprite,
            row: row,
            col: col,
            index: row * cols + col
          });
        }
      }
    }
    
    return sprites;
  }

  extractRegion(x, y, width, height, frameIndex = null) {
    const frame = frameIndex !== null ? this.getFrame(frameIndex) : this.getCurrentFrame();
    if (!frame) return null;
    
    const colors = [];
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const srcX = x + col;
        const srcY = y + row;
        
        if (srcX < frame.width && srcY < frame.height) {
          const index = srcY * frame.width + srcX;
          colors.push(frame.colors[index] || { hex: '#000000', alpha: 0, r: 0, g: 0, b: 0, a: 0 });
        } else {
          colors.push({ hex: '#000000', alpha: 0, r: 0, g: 0, b: 0, a: 0 });
        }
      }
    }
    
    return {
      width: width,
      height: height,
      colors: colors,
      timestamp: Date.now()
    };
  }

  // ===== TEXTURE PROCESSING METHODS =====
  
  /**
   * Get or generate binary data for a specific texture format
   * @param {string} format - The texture format (e.g., 'd2_mode_i8', 'd2_mode_i4')
   * @param {Array} palette - Array of color strings (e.g., ['#FF0000', '#00FF00'])
   * @param {number} paletteOffset - Offset into the palette for indexed formats
   * @param {string} mappingStrategy - Mapping strategy for 4-bit formats ('fmap', 'fit', 'bestfit')
   * @returns {Uint8Array} Binary data in the specified format
   */
  async getBinaryData(format, palette = null, paletteOffset = 0, mappingStrategy = 'bestfit', container = null) {
    console.log('[Image] getBinaryData called with container:', !!container);
    // Generate cache key including new parameters
    const paletteHash = palette ? this.hashArray(palette) : null;
    const sourceHash = this.getSourceDataHash();
    const cacheKey = `${format}_${paletteHash}_${paletteOffset}_${mappingStrategy}`;
    
    // Check if cached binary data is still valid
    if (this.textureCache.binaryData &&
        this.textureCache.binaryDataFormat === format &&
        this.textureCache.binaryDataPaletteHash === paletteHash &&
        this.textureCache.binaryDataCacheKey === cacheKey &&
        this.textureCache.sourceDataHash === sourceHash) {
      console.log(`[Image] Using cached binary data for format ${format}`);
      return this.textureCache.binaryData;
    }
    
    console.log(`[Image] Generating binary data for format ${format}`);
    
    // Get source RGBA data
    const sourceData = this.getSourceRGBAData();
    if (!sourceData) {
      console.error('[Image] No source data available for binary conversion');
      return null;
    }
    
    // Generate binary data based on format
    let binaryData;
    if (format.includes('_i8')) {
      binaryData = this.generateIndexed8Data(sourceData, palette);
    } else if (format.includes('_i4')) {
      // Use the appropriate 4-bit generation strategy
      switch (mappingStrategy) {
        case 'fmap':
          binaryData = this.generateIndexed4Data_FMap(sourceData, palette, paletteOffset);
          break;
        case 'fit':
          binaryData = this.generateIndexed4Data_Fit(sourceData, palette, paletteOffset);
          break;
        case 'bestfit':
          // Best fit automatically finds the best palette offset
          binaryData = await this.generateIndexed4Data_BestFit(sourceData, palette, container);
          break;
        default:
          console.warn(`[Image] Unknown mapping strategy: ${mappingStrategy}, using default`);
          binaryData = this.generateIndexed4Data(sourceData, palette);
      }
    } else if (format.includes('_i2')) {
      // Use the appropriate 2-bit generation strategy
      switch (mappingStrategy) {
        case 'fmap':
          binaryData = this.generateIndexed2Data_FMap(sourceData, palette, paletteOffset);
          break;
        case 'fit':
          binaryData = this.generateIndexed2Data_Fit(sourceData, palette, paletteOffset);
          break;
        case 'bestfit':
          // Best fit automatically finds the best palette offset
          binaryData = this.generateIndexed2Data_BestFit(sourceData, palette, container);
          break;
        default:
          console.warn(`[Image] Unknown mapping strategy: ${mappingStrategy}, using default`);
          binaryData = this.generateIndexed2Data(sourceData, palette);
      }
    } else if (format.includes('_i1')) {
      // Use the appropriate 1-bit generation strategy
      switch (mappingStrategy) {
        case 'fmap':
          binaryData = this.generateIndexed1Data_FMap(sourceData, palette, paletteOffset);
          break;
        case 'fit':
          binaryData = this.generateIndexed1Data_Fit(sourceData, palette, paletteOffset);
          break;
        case 'bestfit':
          // Best fit automatically finds the best palette offset
          binaryData = this.generateIndexed1Data_BestFit(sourceData, palette, container);
          break;
        default:
          console.warn(`[Image] Unknown mapping strategy: ${mappingStrategy}, using default`);
          binaryData = this.generateIndexed1Data(sourceData, palette);
      }
    } else if (format.includes('_rgb565')) {
      binaryData = this.generateRGB565Data(sourceData);
    } else if (format.includes('_argb1555')) {
      binaryData = this.generateARGB1555Data(sourceData);
    } else if (format.includes('_rgba8888')) {
      binaryData = this.generateRGBA8888Data(sourceData);
    } else {
      console.warn(`[Image] Unsupported format: ${format}, using RGBA8888`);
      binaryData = this.generateRGBA8888Data(sourceData);
    }
    
    // Cache the result
    this.textureCache.binaryData = binaryData;
    this.textureCache.binaryDataFormat = format;
    this.textureCache.binaryDataPalette = palette;
    this.textureCache.binaryDataPaletteHash = paletteHash;
    this.textureCache.binaryDataCacheKey = cacheKey;
    this.textureCache.sourceDataHash = sourceHash;
    
    // Store as master binary data for direct mapping (for indexed formats)
    // This preserves the binary data so direct mapping can reuse the same indices
    if (format === 'd2_mode_i4' || format === 'd2_mode_i2' || format === 'd2_mode_i1') {
      this.textureCache.masterBinaryData = binaryData;
      this.textureCache.masterFormat = format;
      console.log(`[Image] Stored master binary data for direct mapping (${binaryData.length} bytes) with strategy: ${mappingStrategy}`);
    }
    
    console.log(`[Image] Generated ${binaryData.length} bytes for format ${format}`);
    return binaryData;
  }

  /**
   * Get rendered 32-bit RGBA data for display
   * @param {string} format - The texture format
   * @param {Array} palette - Array of color strings
   * @param {number} paletteOffset - Offset into the palette (0-255)
   * @param {string} mappingStrategy - Mapping strategy for 4-bit formats ('fmap', 'fit', 'bestfit')
   * @returns {Uint8ClampedArray} 32-bit RGBA data ready for canvas
   */
  async getRenderedData(format, palette = null, paletteOffset = 0, mappingStrategy = 'bestfit', container = null) {
    console.log('[Image] getRenderedData called with container:', !!container);
    // Get binary data first (this handles its own caching)
    const binaryData = await this.getBinaryData(format, palette, paletteOffset, mappingStrategy, container);
    if (!binaryData) return null;
    
    // Generate cache key for rendered data
    const binaryHash = this.hashArray(binaryData);
    
    // Check if cached rendered data is still valid
    if (this.textureCache.renderedData &&
        this.textureCache.renderedDataHash === binaryHash &&
        this.textureCache.renderedDataPaletteOffset === paletteOffset) {
      console.log(`[Image] Using cached rendered data`);
      return this.textureCache.renderedData;
    }
    
    console.log(`[Image] Generating rendered RGBA data from binary format ${format}`);
    
    // Convert binary data back to RGBA based on format
    let rgbaData;
    if (format.includes('_i8')) {
      rgbaData = this.renderIndexed8Data(binaryData, palette, paletteOffset);
    } else if (format.includes('_i4')) {
      rgbaData = this.renderIndexed4Data(binaryData, palette, paletteOffset);
    } else if (format.includes('_i2')) {
      rgbaData = this.renderIndexed2Data(binaryData, palette, paletteOffset);
    } else if (format.includes('_i1')) {
      rgbaData = this.renderIndexed1Data(binaryData, palette, paletteOffset);
    } else if (format.includes('_rgb565')) {
      rgbaData = this.renderRGB565Data(binaryData);
    } else if (format.includes('_argb1555')) {
      rgbaData = this.renderARGB1555Data(binaryData);
    } else if (format.includes('_rgba8888')) {
      rgbaData = new Uint8ClampedArray(binaryData);
    } else {
      // Fallback to source data
      rgbaData = this.getSourceRGBAData();
    }
    
    // Cache the result
    this.textureCache.renderedData = rgbaData;
    this.textureCache.renderedDataHash = binaryHash;
    this.textureCache.renderedDataPaletteOffset = paletteOffset;
    
    console.log(`[Image] Generated ${rgbaData.length} bytes of RGBA data`);
    return rgbaData;
  }

  /**
   * Clear texture cache (call when source image changes)
   */
  clearTextureCache() {
    console.log('[Image] Clearing texture cache');
    this.textureCache.sourceData = null;
    this.textureCache.sourceDataHash = null;
    this.textureCache.binaryData = null;
    this.textureCache.binaryDataFormat = null;
    this.textureCache.binaryDataPalette = null;
    this.textureCache.binaryDataPaletteHash = null;
    this.textureCache.renderedData = null;
    this.textureCache.renderedDataPaletteOffset = 0;
    this.textureCache.renderedDataHash = null;
  }

  /**
   * Get source RGBA data from current frame
   */
  getSourceRGBAData() {
    const sourceHash = this.getSourceDataHash();
    
    // Check cache
    if (this.textureCache.sourceData && this.textureCache.sourceDataHash === sourceHash) {
      return this.textureCache.sourceData;
    }
    
    console.log('[Image] Generating source RGBA data');
    
    const frame = this.getCurrentFrame();
    console.log('[Image] getCurrentFrame() returned:', frame ? 'valid frame' : 'null');
    if (!frame || !frame.colors) {
      console.error('[Image] No frame data available');
      console.error('[Image] Frame:', frame);
      console.error('[Image] Frame colors:', frame ? frame.colors : 'no frame');
      return null;
    }
    
    console.log(`[Image] Frame has ${frame.colors.length} colors`);
    const rgbaData = new Uint8ClampedArray(this.width * this.height * 4);
    
    for (let i = 0; i < frame.colors.length; i++) {
      const color = frame.colors[i];
      const offset = i * 4;
      
      rgbaData[offset] = color.r;     // R
      rgbaData[offset + 1] = color.g; // G
      rgbaData[offset + 2] = color.b; // B
      rgbaData[offset + 3] = color.a; // A
    }
    
    // Cache the result
    this.textureCache.sourceData = rgbaData;
    this.textureCache.sourceDataHash = sourceHash;
    
    return rgbaData;
  }

  /**
   * Generate hash for source data to detect changes
   */
  getSourceDataHash() {
    const frame = this.getCurrentFrame();
    if (!frame || !frame.colors) return null;
    
    // Create a simple hash based on image dimensions and a sampling of pixels
    let hash = `${this.width}x${this.height}`;
    const sampleSize = Math.min(100, frame.colors.length);
    const step = Math.max(1, Math.floor(frame.colors.length / sampleSize));
    
    for (let i = 0; i < frame.colors.length; i += step) {
      const color = frame.colors[i];
      hash += `${color.r},${color.g},${color.b},${color.a};`;
    }
    
    return hash;
  }

  /**
   * Generate hash for an array
   */
  hashArray(arr) {
    if (!arr) return null;
    return arr.join(',');
  }

  // ===== FORMAT-SPECIFIC GENERATION METHODS =====

  /**
   * Generate 8-bit indexed data
   */
  generateIndexed8Data(sourceData, palette) {
    const pixelCount = this.width * this.height;
    const indexData = new Uint8Array(pixelCount);
    
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      const r = sourceData[offset];
      const g = sourceData[offset + 1];
      const b = sourceData[offset + 2];
      const a = sourceData[offset + 3];
      
      // Find closest palette color
      const paletteIndex = this.findClosestPaletteColor(r, g, b, a, palette);
      indexData[i] = paletteIndex;
    }
    
    return indexData;
  }

  /**
   * Generate 4-bit indexed data (packed as nibbles)
   */
  generateIndexed4Data(sourceData, palette) {
    const pixelCount = this.width * this.height;
    const byteCount = Math.ceil(pixelCount / 2);
    const indexData = new Uint8Array(byteCount);
    
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      const r = sourceData[offset];
      const g = sourceData[offset + 1];
      const b = sourceData[offset + 2];
      const a = sourceData[offset + 3];
      
      // Find closest palette color (limited to 16 colors)
      const paletteIndex = this.findClosestPaletteColor(r, g, b, a, palette) & 0x0F;
      
      const byteIndex = Math.floor(i / 2);
      if (i % 2 === 0) {
        // Even pixel (lower nibble)
        indexData[byteIndex] = (indexData[byteIndex] & 0xF0) | paletteIndex;
      } else {
        // Odd pixel (upper nibble)
        indexData[byteIndex] = (indexData[byteIndex] & 0x0F) | (paletteIndex << 4);
      }
    }
    
    return indexData;
  }

  /**
   * Generate 4-bit indexed data using force mapping strategy
   * Uses existing color indices as-is, letting colors map directly
   */
  generateIndexed4Data_FMap(sourceData, palette, paletteOffset = 0) {
    const pixelCount = this.width * this.height;
    const byteCount = Math.ceil(pixelCount / 2);
    const indexData = new Uint8Array(byteCount);
    
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      const r = sourceData[offset];
      const g = sourceData[offset + 1];
      const b = sourceData[offset + 2];
      const a = sourceData[offset + 3];
      
      // Find the closest palette color in the entire palette
      let globalIndex = this.findClosestPaletteColor(r, g, b, a, palette);
      
      // Force map to the selected 16-color chunk by taking modulo and adding offset
      const paletteIndex = (globalIndex % 16) + (paletteOffset & 0xF0);
      const clampedIndex = Math.min(paletteIndex, palette.length - 1) & 0x0F;
      
      const byteIndex = Math.floor(i / 2);
      if (i % 2 === 0) {
        // Even pixel (lower nibble)
        indexData[byteIndex] = (indexData[byteIndex] & 0xF0) | clampedIndex;
      } else {
        // Odd pixel (upper nibble)
        indexData[byteIndex] = (indexData[byteIndex] & 0x0F) | (clampedIndex << 4);
      }
    }
    
    return indexData;
  }

  /**
   * Generate 4-bit indexed data using fit strategy
   * Resamples image to find best color indices within the selected palette chunk
   */
  generateIndexed4Data_Fit(sourceData, palette, paletteOffset = 0) {
    const pixelCount = this.width * this.height;
    const byteCount = Math.ceil(pixelCount / 2);
    const indexData = new Uint8Array(byteCount);
    
    // Extract the 16-color chunk from the palette starting at paletteOffset
    const chunkStart = paletteOffset & 0xF0; // Align to 16-color boundary
    const paletteChunk = palette.slice(chunkStart, chunkStart + 16);
    
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      const r = sourceData[offset];
      const g = sourceData[offset + 1];
      const b = sourceData[offset + 2];
      const a = sourceData[offset + 3];
      
      // Find closest color within the selected 16-color chunk
      const chunkIndex = this.findClosestPaletteColor(r, g, b, a, paletteChunk);
      const paletteIndex = chunkIndex & 0x0F;
      
      const byteIndex = Math.floor(i / 2);
      if (i % 2 === 0) {
        // Even pixel (lower nibble)
        indexData[byteIndex] = (indexData[byteIndex] & 0xF0) | paletteIndex;
      } else {
        // Odd pixel (upper nibble)
        indexData[byteIndex] = (indexData[byteIndex] & 0x0F) | (paletteIndex << 4);
      }
    }
    
    return indexData;
  }

  /**
   * Generate 4-bit indexed data using best fit strategy
   * Tries all available palette chunks and picks the one with the best overall match
   */
  async generateIndexed4Data_BestFit(sourceData, palette, container = null) {
    console.log('[Image] generateIndexed4Data_BestFit called with container:', !!container);
    const pixelCount = this.width * this.height;
    const chunkCount = Math.floor(palette.length / 16);
    let bestChunkOffset = 0;
    let bestTotalError = Infinity;

    // Create progress UI if container provided
    let progressUI = null;
    if (container) {
      progressUI = this._createProgressUI(container);
      await this._updateProgressAsync(progressUI, 'Finding best 16-color palette chunk...', 5);
    }

    // Try each 16-color chunk and find the one with minimum error
    for (let chunk = 0; chunk < chunkCount; chunk++) {
      const chunkOffset = chunk * 16;
      const paletteChunk = palette.slice(chunkOffset, chunkOffset + 16);
      let totalError = 0;

      // Update progress for each chunk
      if (progressUI) {
        const chunkProgress = 10 + (chunk / chunkCount) * 80;
        await this._updateProgressAsync(progressUI, `Testing palette chunk ${chunk + 1}/${chunkCount}...`, chunkProgress);
      }

      // Calculate total error for this chunk
      for (let i = 0; i < pixelCount; i++) {
        const offset = i * 4;
        const r = sourceData[offset];
        const g = sourceData[offset + 1];
        const b = sourceData[offset + 2];
        const a = sourceData[offset + 3];

        // Find closest color in this chunk and calculate error
        let minError = Infinity;
        for (let j = 0; j < paletteChunk.length; j++) {
          const paletteColor = this.parseColor(paletteChunk[j]);
          if (!paletteColor) continue;

          const error = this.calculateColorDistance(
            r, g, b, a,
            paletteColor.r, paletteColor.g, paletteColor.b, paletteColor.a
          );

          if (error < minError) {
            minError = error;
          }
        }
        totalError += minError;
      }

      // Log one summary per chunk with the error
      console.log(`[Image] Palette chunk ${chunk + 1}/${chunkCount} - offset ${chunkOffset} - error: ${totalError}`);

      if (totalError < bestTotalError) {
        bestTotalError = totalError;
        bestChunkOffset = chunkOffset;
      }
    }

    if (progressUI) {
      await this._updateProgressAsync(progressUI, 'Generating indexed data...', 95);
      setTimeout(() => this._destroyProgressUI(progressUI), 1000);
    }

    console.log(`[Image] Best fit found at palette offset ${bestChunkOffset} with error ${bestTotalError}`);

    // Store the best offset for external use
    this._lastBestFitOffset = bestChunkOffset;

    // Generate the indexed data using the best chunk
    return this.generateIndexed4Data_Fit(sourceData, palette, bestChunkOffset);
  }

  /**
   * Find the best palette offset for indexed formats without generating data
   */
  async findBestPaletteOffset(sourceData, palette, bitsPerPixel, container = null) {
    console.log(`[Image] Finding best palette offset for ${bitsPerPixel}-bit format`);
    
    if (bitsPerPixel === 4) {
      return await this._findBest4BitOffset(sourceData, palette, container);
    } else if (bitsPerPixel === 2) {
      return await this._findBest2BitOffset(sourceData, palette, container);
    } else if (bitsPerPixel === 1) {
      return await this._findBest1BitOffset(sourceData, palette, container);
    }
    
    return 0; // Default offset for unsupported formats
  }

  async _findBest4BitOffset(sourceData, palette, container = null) {
    const pixelCount = this.width * this.height;
    const chunkCount = Math.floor(palette.length / 16);
    let bestChunkOffset = 0;
    let bestTotalError = Infinity;

    // Create progress UI if container provided
    let progressUI = null;
    if (container) {
      progressUI = this._createProgressUI(container);
      await this._updateProgressAsync(progressUI, 'Finding best 16-color palette chunk...', 5);
    }

    // Try each 16-color chunk and find the one with minimum error
    for (let chunk = 0; chunk < chunkCount; chunk++) {
      const chunkOffset = chunk * 16;
      const paletteChunk = palette.slice(chunkOffset, chunkOffset + 16);
      let totalError = 0;

      // Update progress for each chunk
      if (progressUI) {
        const chunkProgress = 10 + (chunk / chunkCount) * 80;
        await this._updateProgressAsync(progressUI, `Testing palette chunk ${chunk + 1}/${chunkCount}...`, chunkProgress);
      }

      // Calculate total error for this chunk
      for (let i = 0; i < pixelCount; i++) {
        const offset = i * 4;
        const r = sourceData[offset];
        const g = sourceData[offset + 1];
        const b = sourceData[offset + 2];
        const a = sourceData[offset + 3];

        // Find closest color in this chunk and calculate error
        let minError = Infinity;
        for (let j = 0; j < paletteChunk.length; j++) {
          const paletteColor = this.parseColor(paletteChunk[j]);
          if (!paletteColor) continue;

          const error = this.calculateColorDistance(
            r, g, b, a,
            paletteColor.r, paletteColor.g, paletteColor.b, paletteColor.a
          );

          if (error < minError) {
            minError = error;
          }
        }
        totalError += minError;
      }

      // Log one summary per chunk with the error
      console.log(`[Image] Palette chunk ${chunk + 1}/${chunkCount} - offset ${chunkOffset} - error: ${totalError}`);

      if (totalError < bestTotalError) {
        bestTotalError = totalError;
        bestChunkOffset = chunkOffset;
      }
    }

    if (progressUI) {
      await this._updateProgressAsync(progressUI, 'Best offset found', 100);
      setTimeout(() => this._destroyProgressUI(progressUI), 1000);
    }

    console.log(`[Image] Best fit found at palette offset ${bestChunkOffset} with error ${bestTotalError}`);
    
    // Store the best offset for external use
    this._lastBestFitOffset = bestChunkOffset;
    
    return bestChunkOffset;
  }

  async _findBest2BitOffset(sourceData, palette, container = null) {
    const pixelCount = this.width * this.height;
    const chunkCount = Math.floor(palette.length / 4);
    let bestChunkOffset = 0;
    let bestTotalError = Infinity;

    // Create progress UI if container provided
    let progressUI = null;
    if (container) {
      progressUI = this._createProgressUI(container);
      await this._updateProgressAsync(progressUI, 'Finding best 4-color palette chunk...', 5);
    }

    // Try each 4-color chunk and find the one with minimum error
    for (let chunk = 0; chunk < chunkCount; chunk++) {
      const chunkOffset = chunk * 4;
      const paletteChunk = palette.slice(chunkOffset, chunkOffset + 4);
      let totalError = 0;

      // Update progress for each chunk
      if (progressUI) {
        const chunkProgress = 10 + (chunk / chunkCount) * 80;
        await this._updateProgressAsync(progressUI, `Testing palette chunk ${chunk + 1}/${chunkCount}...`, chunkProgress);
      }

      // Calculate total error for this chunk
      for (let i = 0; i < pixelCount; i++) {
        const offset = i * 4;
        const r = sourceData[offset];
        const g = sourceData[offset + 1];
        const b = sourceData[offset + 2];
        const a = sourceData[offset + 3];

        // Find closest color in this chunk and calculate error
        let minError = Infinity;
        for (let j = 0; j < paletteChunk.length; j++) {
          const paletteColor = this.parseColor(paletteChunk[j]);
          if (!paletteColor) continue;

          const error = this.calculateColorDistance(
            r, g, b, a,
            paletteColor.r, paletteColor.g, paletteColor.b, paletteColor.a
          );

          if (error < minError) {
            minError = error;
          }
        }
        totalError += minError;
      }

      // Log one summary per chunk with the error
      console.log(`[Image] Palette chunk ${chunk + 1}/${chunkCount} - offset ${chunkOffset} - error: ${totalError}`);

      if (totalError < bestTotalError) {
        bestTotalError = totalError;
        bestChunkOffset = chunkOffset;
      }
    }

    if (progressUI) {
      await this._updateProgressAsync(progressUI, 'Best offset found', 100);
      setTimeout(() => this._destroyProgressUI(progressUI), 1000);
    }

    console.log(`[Image] Best fit found at palette offset ${bestChunkOffset} with error ${bestTotalError}`);
    
    // Store the best offset for external use
    this._lastBestFitOffset = bestChunkOffset;
    
    return bestChunkOffset;
  }

  async _findBest1BitOffset(sourceData, palette, container = null) {
    const pixelCount = this.width * this.height;
    const chunkCount = Math.floor(palette.length / 2);
    let bestChunkOffset = 0;
    let bestTotalError = Infinity;

    // Create progress UI if container provided
    let progressUI = null;
    if (container) {
      progressUI = this._createProgressUI(container);
      await this._updateProgressAsync(progressUI, 'Finding best 2-color palette chunk...', 5);
    }

    // Try each 2-color chunk and find the one with minimum error
    for (let chunk = 0; chunk < chunkCount; chunk++) {
      const chunkOffset = chunk * 2;
      const paletteChunk = palette.slice(chunkOffset, chunkOffset + 2);
      let totalError = 0;

      // Update progress for each chunk
      if (progressUI) {
        const chunkProgress = 10 + (chunk / chunkCount) * 80;
        await this._updateProgressAsync(progressUI, `Testing palette chunk ${chunk + 1}/${chunkCount}...`, chunkProgress);
      }

      // Calculate total error for this chunk
      for (let i = 0; i < pixelCount; i++) {
        const offset = i * 4;
        const r = sourceData[offset];
        const g = sourceData[offset + 1];
        const b = sourceData[offset + 2];
        const a = sourceData[offset + 3];

        // Find closest color in this chunk and calculate error
        let minError = Infinity;
        for (let j = 0; j < paletteChunk.length; j++) {
          const paletteColor = this.parseColor(paletteChunk[j]);
          if (!paletteColor) continue;

          const error = this.calculateColorDistance(
            r, g, b, a,
            paletteColor.r, paletteColor.g, paletteColor.b, paletteColor.a
          );

          if (error < minError) {
            minError = error;
          }
        }
        totalError += minError;
      }

      // Log one summary per chunk with the error
      console.log(`[Image] Palette chunk ${chunk + 1}/${chunkCount} - offset ${chunkOffset} - error: ${totalError}`);

      if (totalError < bestTotalError) {
        bestTotalError = totalError;
        bestChunkOffset = chunkOffset;
      }
    }

    if (progressUI) {
      await this._updateProgressAsync(progressUI, 'Best offset found', 100);
      setTimeout(() => this._destroyProgressUI(progressUI), 1000);
    }

    console.log(`[Image] Best fit found at palette offset ${bestChunkOffset} with error ${bestTotalError}`);
    
    // Store the best offset for external use
    this._lastBestFitOffset = bestChunkOffset;
    
    return bestChunkOffset;
  }

  /**
   * Generate 2-bit indexed data
   */
  generateIndexed2Data(sourceData, palette) {
    const pixelCount = this.width * this.height;
    const byteCount = Math.ceil(pixelCount / 4);
    const indexData = new Uint8Array(byteCount);
    
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      const r = sourceData[offset];
      const g = sourceData[offset + 1];
      const b = sourceData[offset + 2];
      const a = sourceData[offset + 3];
      
      // Find closest palette color (limited to 4 colors)
      const paletteIndex = this.findClosestPaletteColor(r, g, b, a, palette) & 0x03;
      
      const byteIndex = Math.floor(i / 4);
      const bitShift = (i % 4) * 2;
      indexData[byteIndex] |= paletteIndex << bitShift;
    }
    
    return indexData;
  }

  /**
   * Generate 2-bit indexed data using force mapping strategy
   * Uses existing color indices as-is, letting colors map directly
   */
  generateIndexed2Data_FMap(sourceData, palette, paletteOffset = 0) {
    const pixelCount = this.width * this.height;
    const byteCount = Math.ceil(pixelCount / 4);
    const indexData = new Uint8Array(byteCount);
    
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      const r = sourceData[offset];
      const g = sourceData[offset + 1];
      const b = sourceData[offset + 2];
      const a = sourceData[offset + 3];
      
      // Find the closest palette color in the entire palette
      let globalIndex = this.findClosestPaletteColor(r, g, b, a, palette);
      
      // Force map to the selected 4-color chunk by taking modulo and adding offset
      const paletteIndex = (globalIndex % 4) + (paletteOffset & 0xFC);
      const clampedIndex = Math.min(paletteIndex, palette.length - 1) & 0x03;
      
      const byteIndex = Math.floor(i / 4);
      const bitShift = (i % 4) * 2;
      indexData[byteIndex] |= clampedIndex << bitShift;
    }
    
    return indexData;
  }

  /**
   * Generate 2-bit indexed data using fit strategy
   * Resamples image to find best color indices within the selected palette chunk
   */
  generateIndexed2Data_Fit(sourceData, palette, paletteOffset = 0) {
    const pixelCount = this.width * this.height;
    const byteCount = Math.ceil(pixelCount / 4);
    const indexData = new Uint8Array(byteCount);
    
    // Extract the 4-color chunk from the palette starting at paletteOffset
    const chunkStart = paletteOffset & 0xFC; // Align to 4-color boundary
    const paletteChunk = palette.slice(chunkStart, chunkStart + 4);
    
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      const r = sourceData[offset];
      const g = sourceData[offset + 1];
      const b = sourceData[offset + 2];
      const a = sourceData[offset + 3];
      
      // Find closest color within the selected 4-color chunk
      const chunkIndex = this.findClosestPaletteColor(r, g, b, a, paletteChunk);
      const paletteIndex = chunkIndex & 0x03;
      
      const byteIndex = Math.floor(i / 4);
      const bitShift = (i % 4) * 2;
      indexData[byteIndex] |= paletteIndex << bitShift;
    }
    
    return indexData;
  }

  /**
   * Generate 2-bit indexed data using best fit strategy
   * Tries all available palette chunks and picks the one with the best overall match
   */
  generateIndexed2Data_BestFit(sourceData, palette, container = null) {
    const pixelCount = this.width * this.height;
    const chunkCount = Math.floor(palette.length / 4);
    let bestChunkOffset = 0;
    let bestTotalError = Infinity;

    // Create progress UI if container provided
    let progressUI = null;
    if (container) {
      progressUI = this._createProgressUI(container);
      this._updateProgress(progressUI, 'Finding best 4-color palette chunk...', 5);
    }

    // Try each 4-color chunk and find the one with minimum error
    for (let chunk = 0; chunk < chunkCount; chunk++) {
      const chunkOffset = chunk * 4;
      const paletteChunk = palette.slice(chunkOffset, chunkOffset + 4);
      let totalError = 0;

      // Update progress for each chunk
      if (progressUI) {
        const chunkProgress = 10 + (chunk / chunkCount) * 80;
        this._updateProgress(progressUI, `Testing palette chunk ${chunk + 1}/${chunkCount}...`, chunkProgress);
      }

      // Calculate total error for this chunk
      for (let i = 0; i < pixelCount; i++) {
        const offset = i * 4;
        const r = sourceData[offset];
        const g = sourceData[offset + 1];
        const b = sourceData[offset + 2];
        const a = sourceData[offset + 3];

        // Find closest color in this chunk and calculate error
        let minError = Infinity;
        for (let j = 0; j < paletteChunk.length; j++) {
          const paletteColor = this.parseColor(paletteChunk[j]);
          if (!paletteColor) continue;

          const error = this.calculateColorDistance(
            r, g, b, a,
            paletteColor.r, paletteColor.g, paletteColor.b, paletteColor.a
          );

          if (error < minError) {
            minError = error;
          }
        }
        totalError += minError;
      }

      // Log one summary per chunk with the error  
      console.log(`[Image] Palette chunk ${chunk + 1}/${chunkCount} - offset ${chunkOffset} - error: ${totalError}`);

      if (totalError < bestTotalError) {
        bestTotalError = totalError;
        bestChunkOffset = chunkOffset;
      }
    }

    if (progressUI) {
      this._updateProgress(progressUI, 'Generating indexed data...', 95);
      setTimeout(() => this._destroyProgressUI(progressUI), 500);
    }

    console.log(`[Image] Best fit found at palette offset ${bestChunkOffset} with error ${bestTotalError}`);

    // Store the best offset for external use
    this._lastBestFitOffset = bestChunkOffset;

    // Generate the indexed data using the best chunk
    return this.generateIndexed2Data_Fit(sourceData, palette, bestChunkOffset);
  }

  /**
   * Generate 1-bit indexed data
   */
  generateIndexed1Data(sourceData, palette) {
    const pixelCount = this.width * this.height;
    const byteCount = Math.ceil(pixelCount / 8);
    const indexData = new Uint8Array(byteCount);
    
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      const r = sourceData[offset];
      const g = sourceData[offset + 1];
      const b = sourceData[offset + 2];
      const a = sourceData[offset + 3];
      
      // Find closest palette color (limited to 2 colors)
      const paletteIndex = this.findClosestPaletteColor(r, g, b, a, palette) & 0x01;
      
      const byteIndex = Math.floor(i / 8);
      const bitShift = i % 8;
      if (paletteIndex) {
        indexData[byteIndex] |= 1 << bitShift;
      }
    }
    
    return indexData;
  }

  /**
   * Generate 1-bit indexed data using force mapping strategy
   * Uses existing color indices as-is, letting colors map directly
   */
  generateIndexed1Data_FMap(sourceData, palette, paletteOffset = 0) {
    const pixelCount = this.width * this.height;
    const byteCount = Math.ceil(pixelCount / 8);
    const indexData = new Uint8Array(byteCount);
    
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      const r = sourceData[offset];
      const g = sourceData[offset + 1];
      const b = sourceData[offset + 2];
      const a = sourceData[offset + 3];
      
      // Find the closest palette color in the entire palette
      let globalIndex = this.findClosestPaletteColor(r, g, b, a, palette);
      
      // Force map to the selected 2-color chunk by taking modulo and adding offset
      const paletteIndex = (globalIndex % 2) + (paletteOffset & 0xFE);
      const clampedIndex = Math.min(paletteIndex, palette.length - 1) & 0x01;
      
      const byteIndex = Math.floor(i / 8);
      const bitShift = i % 8;
      if (clampedIndex) {
        indexData[byteIndex] |= 1 << bitShift;
      }
    }
    
    return indexData;
  }

  /**
   * Generate 1-bit indexed data using fit strategy
   * Resamples image to find best color indices within the selected palette chunk
   */
  generateIndexed1Data_Fit(sourceData, palette, paletteOffset = 0) {
    const pixelCount = this.width * this.height;
    const byteCount = Math.ceil(pixelCount / 8);
    const indexData = new Uint8Array(byteCount);
    
    // Extract the 2-color chunk from the palette starting at paletteOffset
    const chunkStart = paletteOffset & 0xFE; // Align to 2-color boundary
    const paletteChunk = palette.slice(chunkStart, chunkStart + 2);
    
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      const r = sourceData[offset];
      const g = sourceData[offset + 1];
      const b = sourceData[offset + 2];
      const a = sourceData[offset + 3];
      
      // Find closest color within the selected 2-color chunk
      const chunkIndex = this.findClosestPaletteColor(r, g, b, a, paletteChunk);
      const paletteIndex = chunkIndex & 0x01;
      
      const byteIndex = Math.floor(i / 8);
      const bitShift = i % 8;
      if (paletteIndex) {
        indexData[byteIndex] |= 1 << bitShift;
      }
    }
    
    return indexData;
  }

  /**
   * Generate 1-bit indexed data using best fit strategy
   * Tries all available palette chunks and picks the one with the best overall match
   */
  generateIndexed1Data_BestFit(sourceData, palette, container = null) {
    const pixelCount = this.width * this.height;
    const chunkCount = Math.floor(palette.length / 2);
    let bestChunkOffset = 0;
    let bestTotalError = Infinity;

    // Create progress UI if container provided
    let progressUI = null;
    if (container) {
      progressUI = this._createProgressUI(container);
      this._updateProgress(progressUI, 'Finding best 2-color palette chunk...', 5);
    }

    // Try each 2-color chunk and find the one with minimum error
    for (let chunk = 0; chunk < chunkCount; chunk++) {
      const chunkOffset = chunk * 2;
      const paletteChunk = palette.slice(chunkOffset, chunkOffset + 2);
      let totalError = 0;

      // Update progress for each chunk
      if (progressUI) {
        const chunkProgress = 10 + (chunk / chunkCount) * 80;
        this._updateProgress(progressUI, `Testing palette chunk ${chunk + 1}/${chunkCount}...`, chunkProgress);
      }

      // Calculate total error for this chunk
      for (let i = 0; i < pixelCount; i++) {
        const offset = i * 4;
        const r = sourceData[offset];
        const g = sourceData[offset + 1];
        const b = sourceData[offset + 2];
        const a = sourceData[offset + 3];

        // Find closest color in this chunk and calculate error
        let minError = Infinity;
        for (let j = 0; j < paletteChunk.length; j++) {
          const paletteColor = this.parseColor(paletteChunk[j]);
          if (!paletteColor) continue;

          const error = this.calculateColorDistance(
            r, g, b, a,
            paletteColor.r, paletteColor.g, paletteColor.b, paletteColor.a
          );

          if (error < minError) {
            minError = error;
          }
        }
        totalError += minError;
      }

      // Log one summary per chunk with the error
      console.log(`[Image] Palette chunk ${chunk + 1}/${chunkCount} - offset ${chunkOffset} - error: ${totalError}`);

      if (totalError < bestTotalError) {
        bestTotalError = totalError;
        bestChunkOffset = chunkOffset;
      }
    }

    if (progressUI) {
      this._updateProgress(progressUI, 'Generating indexed data...', 95);
      setTimeout(() => this._destroyProgressUI(progressUI), 500);
    }

    console.log(`[Image] Best fit found at palette offset ${bestChunkOffset} with error ${bestTotalError}`);

    // Store the best offset for external use
    this._lastBestFitOffset = bestChunkOffset;

    // Generate the indexed data using the best chunk
    return this.generateIndexed1Data_Fit(sourceData, palette, bestChunkOffset);
  }

  /**
   * Generate RGB565 data (16-bit)
   */
  generateRGB565Data(sourceData) {
    const pixelCount = this.width * this.height;
    const rgb565Data = new Uint16Array(pixelCount);
    
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      const r = sourceData[offset] >> 3;     // 5 bits
      const g = sourceData[offset + 1] >> 2; // 6 bits  
      const b = sourceData[offset + 2] >> 3; // 5 bits
      
      rgb565Data[i] = (r << 11) | (g << 5) | b;
    }
    
    return new Uint8Array(rgb565Data.buffer);
  }

  /**
   * Generate ARGB1555 data (16-bit)
   */
  generateARGB1555Data(sourceData) {
    const pixelCount = this.width * this.height;
    const argb1555Data = new Uint16Array(pixelCount);
    
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      const r = sourceData[offset] >> 3;     // 5 bits
      const g = sourceData[offset + 1] >> 3; // 5 bits
      const b = sourceData[offset + 2] >> 3; // 5 bits
      const a = sourceData[offset + 3] > 127 ? 1 : 0; // 1 bit
      
      argb1555Data[i] = (a << 15) | (r << 10) | (g << 5) | b;
    }
    
    return new Uint8Array(argb1555Data.buffer);
  }

  /**
   * Generate RGBA8888 data (32-bit)
   */
  generateRGBA8888Data(sourceData) {
    return new Uint8Array(sourceData);
  }

  /**
   * Generate ALPHA8 data (8-bit alpha only)
   */
  generateAlpha8Data(sourceData) {
    const pixelCount = this.width * this.height;
    const alpha8Data = new Uint8Array(pixelCount);
    
    for (let i = 0; i < pixelCount; i++) {
      // Extract alpha channel (every 4th byte starting from index 3)
      alpha8Data[i] = sourceData[i * 4 + 3];
    }
    
    return alpha8Data;
  }

  /**
   * Calculate color distance using various methods
   * @param {number} r1, g1, b1, a1 - First color components (0-255)
   * @param {number} r2, g2, b2, a2 - Second color components (0-255)
   * @param {string} method - Distance calculation method
   * @returns {number} Color distance
   */
  calculateColorDistance(r1, g1, b1, a1, r2, g2, b2, a2, method = null) {
    const distanceMethod = method || this.colorDistanceMethod || 'euclidean';
    return Palette.calculateColorDistance(r1, g1, b1, a1, r2, g2, b2, a2, distanceMethod);
  }

  // REMOVED: Individual distance calculation methods
  // Now delegated to Palette class:
  // - euclideanDistance()
  // - weightedRGBDistance() 
  // - perceptualDistance()
  // - manhattanDistance()
  // - deltaEDistance()
  // - rgbToLab()
  // - getColorDistanceMethods()

  /**
   * Find closest color in palette
   * @deprecated Use palette.findClosestColor() directly instead
   */
  findClosestPaletteColor(r, g, b, a, palette) {
    if (!palette || palette.length === 0) return 0;
    
    // Create a temporary palette object if we have an array
    if (Array.isArray(palette)) {
      const tempPalette = { colors: palette };
      return tempPalette.colors.length > 0 ? 
        Palette.prototype.findClosestColor.call(tempPalette, r, g, b, a, this.colorDistanceMethod || 'euclidean') : 0;
    }
    
    // If it's already a palette object, use it directly
    return palette.findClosestColor ? 
      palette.findClosestColor(r, g, b, a, this.colorDistanceMethod || 'euclidean') : 0;
  }

  /**
   * Parse color string to RGB values
   * @deprecated Use Palette.parseColor() instead
   */
  parseColor(colorStr) {
    return Palette.parseColor(colorStr);
  }

  // ===== FORMAT-SPECIFIC RENDERING METHODS =====

  /**
   * Render 8-bit indexed data to RGBA
   */
  renderIndexed8Data(indexData, palette, paletteOffset = 0) {
    const pixelCount = this.width * this.height;
    const rgbaData = new Uint8ClampedArray(pixelCount * 4);
    
    for (let i = 0; i < pixelCount; i++) {
      const paletteIndex = (indexData[i] + paletteOffset) % (palette?.length || 256);
      const color = this.parseColor(palette?.[paletteIndex]) || { r: 0, g: 0, b: 0, a: 255 };
      
      const offset = i * 4;
      rgbaData[offset] = color.r;
      rgbaData[offset + 1] = color.g;
      rgbaData[offset + 2] = color.b;
      rgbaData[offset + 3] = color.a;
    }
    
    return rgbaData;
  }

  /**
   * Render 4-bit indexed data to RGBA
   */
  renderIndexed4Data(indexData, palette, paletteOffset = 0) {
    const pixelCount = this.width * this.height;
    const rgbaData = new Uint8ClampedArray(pixelCount * 4);
    
    console.log('[ImageData] renderIndexed4Data - pixelCount:', pixelCount, 'indexData length:', indexData.length, 'palette length:', palette.length);
    console.log('[ImageData] First few bytes of indexData:', Array.from(indexData.slice(0, 10)));
    console.log('[ImageData] First few palette colors:', palette.slice(0, 4));
    
    for (let i = 0; i < Math.min(pixelCount, 10); i++) {
      const byteIndex = Math.floor(i / 2);
      const isOddPixel = i % 2 === 1;
      
      let paletteIndex;
      if (isOddPixel) {
        paletteIndex = (indexData[byteIndex] >> 4) & 0x0F;
      } else {
        paletteIndex = indexData[byteIndex] & 0x0F;
      }
      
      paletteIndex = (paletteIndex + paletteOffset) % (palette?.length || 16);
      const color = this.parseColor(palette?.[paletteIndex]) || { r: 0, g: 0, b: 0, a: 255 };
      
      if (i < 5) {
        console.log(`[ImageData] Pixel ${i}: byte=${indexData[byteIndex]}, isOdd=${isOddPixel}, palIdx=${paletteIndex - paletteOffset}->${paletteIndex}, color=`, color);
      }
      
      const offset = i * 4;
      rgbaData[offset] = color.r;
      rgbaData[offset + 1] = color.g;
      rgbaData[offset + 2] = color.b;
      rgbaData[offset + 3] = color.a;
    }
    
    // Continue with the rest without logging
    for (let i = 10; i < pixelCount; i++) {
      const byteIndex = Math.floor(i / 2);
      const isOddPixel = i % 2 === 1;
      
      let paletteIndex;
      if (isOddPixel) {
        paletteIndex = (indexData[byteIndex] >> 4) & 0x0F;
      } else {
        paletteIndex = indexData[byteIndex] & 0x0F;
      }
      
      paletteIndex = (paletteIndex + paletteOffset) % (palette?.length || 16);
      const color = this.parseColor(palette?.[paletteIndex]) || { r: 0, g: 0, b: 0, a: 255 };
      
      const offset = i * 4;
      rgbaData[offset] = color.r;
      rgbaData[offset + 1] = color.g;
      rgbaData[offset + 2] = color.b;
      rgbaData[offset + 3] = color.a;
    }
    
    return rgbaData;
  }

  /**
   * Render 2-bit indexed data to RGBA
   */
  renderIndexed2Data(indexData, palette, paletteOffset = 0) {
    const pixelCount = this.width * this.height;
    const rgbaData = new Uint8ClampedArray(pixelCount * 4);
    
    for (let i = 0; i < pixelCount; i++) {
      const byteIndex = Math.floor(i / 4);
      const bitShift = (i % 4) * 2;
      const paletteIndex = (((indexData[byteIndex] >> bitShift) & 0x03) + paletteOffset) % (palette?.length || 4);
      
      const color = this.parseColor(palette?.[paletteIndex]) || { r: 0, g: 0, b: 0, a: 255 };
      
      const offset = i * 4;
      rgbaData[offset] = color.r;
      rgbaData[offset + 1] = color.g;
      rgbaData[offset + 2] = color.b;
      rgbaData[offset + 3] = color.a;
    }
    
    return rgbaData;
  }

  /**
   * Render 1-bit indexed data to RGBA
   */
  renderIndexed1Data(indexData, palette, paletteOffset = 0) {
    const pixelCount = this.width * this.height;
    const rgbaData = new Uint8ClampedArray(pixelCount * 4);
    
    for (let i = 0; i < pixelCount; i++) {
      const byteIndex = Math.floor(i / 8);
      const bitShift = i % 8;
      const paletteIndex = (((indexData[byteIndex] >> bitShift) & 0x01) + paletteOffset) % (palette?.length || 2);
      
      const color = this.parseColor(palette?.[paletteIndex]) || { r: 0, g: 0, b: 0, a: 255 };
      
      const offset = i * 4;
      rgbaData[offset] = color.r;
      rgbaData[offset + 1] = color.g;
      rgbaData[offset + 2] = color.b;
      rgbaData[offset + 3] = color.a;
    }
    
    return rgbaData;
  }

  /**
   * Render RGB565 data to RGBA
   */
  renderRGB565Data(binaryData) {
    const pixelCount = this.width * this.height;
    const rgbaData = new Uint8ClampedArray(pixelCount * 4);
    const rgb565Data = new Uint16Array(binaryData.buffer);
    
    for (let i = 0; i < pixelCount; i++) {
      const rgb565 = rgb565Data[i];
      
      const r = ((rgb565 >> 11) & 0x1F) << 3; // 5 bits to 8 bits
      const g = ((rgb565 >> 5) & 0x3F) << 2;  // 6 bits to 8 bits
      const b = (rgb565 & 0x1F) << 3;         // 5 bits to 8 bits
      
      const offset = i * 4;
      rgbaData[offset] = r;
      rgbaData[offset + 1] = g;
      rgbaData[offset + 2] = b;
      rgbaData[offset + 3] = 255; // Full alpha
    }
    
    return rgbaData;
  }

  /**
   * Render ARGB1555 data to RGBA
   */
  renderARGB1555Data(binaryData) {
    const pixelCount = this.width * this.height;
    const rgbaData = new Uint8ClampedArray(pixelCount * 4);
    const argb1555Data = new Uint16Array(binaryData.buffer);
    
    for (let i = 0; i < pixelCount; i++) {
      const argb1555 = argb1555Data[i];
      
      const a = (argb1555 >> 15) & 0x01 ? 255 : 0; // 1 bit to 8 bits
      const r = ((argb1555 >> 10) & 0x1F) << 3;    // 5 bits to 8 bits
      const g = ((argb1555 >> 5) & 0x1F) << 3;     // 5 bits to 8 bits
      const b = (argb1555 & 0x1F) << 3;            // 5 bits to 8 bits
      
      const offset = i * 4;
      rgbaData[offset] = r;
      rgbaData[offset + 1] = g;
      rgbaData[offset + 2] = b;
      rgbaData[offset + 3] = a;
    }
    
    return rgbaData;
  }

  // ===== D2 TEXTURE FORMAT SUPPORT =====
  // Note: D2 texture format support has been moved to D2FormatHandler class
  // All D2 operations are now delegated to this.d2Handler

  // Backward compatibility - delegate to D2FormatHandler
  static get D2_FORMAT() {
    return D2FormatHandler.D2_FORMAT;
  }

  static get D2_FLAGS() {
    return D2FormatHandler.D2_FLAGS;
  }

  static get D2_HEADER_SIZE() {
    return D2FormatHandler.D2_HEADER_SIZE;
  }

  /**
   * Load from D2 texture format binary data
   * @deprecated Use d2Handler.loadFromD2Binary() instead
   */
  loadFromD2Binary(arrayBuffer) {
    return this.d2Handler.loadFromD2Binary(arrayBuffer);
  }

  /**
   * Export to D2 texture format binary data
   * @deprecated Use d2Handler.exportToD2Binary() instead
   */
  exportToD2Binary(options = {}) {
    const sourceRGBA = this.getSourceRGBAData();
    return this.d2Handler.exportToD2Binary(sourceRGBA, this.width, this.height, options);
  }

  /**
   * Get D2 format constant from internal format name
   * @deprecated Use D2FormatHandler.getD2FormatFromInternal() instead
   */
  static getD2FormatFromInternal(internalFormat) {
    return D2FormatHandler.getD2FormatFromInternal(internalFormat);
  }

  /**
   * Get internal format name from D2 format constant
   * @deprecated Use D2FormatHandler.getInternalFromD2Format() instead
   */
  static getInternalFromD2Format(d2Format) {
    return D2FormatHandler.getInternalFromD2Format(d2Format);
  }

  /**
   * Get palette size for D2 indexed format
   */
  getD2PaletteSize(format) {
    switch (format) {
      case ImageData.D2_FORMAT.I8: return 256;
      case ImageData.D2_FORMAT.I4: return 16;
      case ImageData.D2_FORMAT.I2: return 4;
      case ImageData.D2_FORMAT.I1: return 2;
      default: return 0;
    }
  }

  /**
   * Convert D2 format pixel data to RGBA
   */
  convertD2ToRGBA(pixelData, format, palette = null) {
    const pixelCount = this.width * this.height;
    const rgbaData = new Uint8ClampedArray(pixelCount * 4);
    
    switch (format) {
      case ImageData.D2_FORMAT.I8:
        return this.renderIndexed8Data(pixelData, palette, 0);
      case ImageData.D2_FORMAT.I4:
        return this.renderIndexed4Data(pixelData, palette, 0);
      case ImageData.D2_FORMAT.I2:
        return this.renderIndexed2Data(pixelData, palette, 0);
      case ImageData.D2_FORMAT.I1:
        return this.renderIndexed1Data(pixelData, palette, 0);
      case ImageData.D2_FORMAT.RGB565:
        return this.renderRGB565Data(pixelData);
      case ImageData.D2_FORMAT.ARGB1555:
        return this.renderARGB1555Data(pixelData);
      case ImageData.D2_FORMAT.RGBA8888:
      case ImageData.D2_FORMAT.ARGB8888:
      case ImageData.D2_FORMAT.RGB888:
        // Direct RGBA data
        return new Uint8ClampedArray(pixelData);
      default:
        console.warn(`[ImageData] Unsupported D2 format: ${format}, using raw data`);
        return new Uint8ClampedArray(pixelData);
    }
  }

  /**
   * Convert RGBA to D2 indexed format
   */
  convertRGBAToD2Indexed(rgbaData, format, palette = null) {
    // Use existing palette or generate one
    let usePalette = palette;
    if (!usePalette) {
      const paletteSize = this.getD2PaletteSize(format);
      usePalette = this.generatePalette(rgbaData, paletteSize);
    }
    
    // Generate index data using existing methods
    let indexData;
    switch (format) {
      case ImageData.D2_FORMAT.I8:
        indexData = this.generateIndexed8Data(rgbaData, usePalette.colors || usePalette);
        break;
      case ImageData.D2_FORMAT.I4:
        indexData = this.generateIndexed4Data(rgbaData, usePalette);
        break;
      case ImageData.D2_FORMAT.I2:
        indexData = this.generateIndexed2Data(rgbaData, usePalette);
        break;
      case ImageData.D2_FORMAT.I1:
        indexData = this.generateIndexed1Data(rgbaData, usePalette);
        break;
      default:
        throw new Error(`Unsupported indexed format: ${format}`);
    }
    
    return { indexData, palette: usePalette };
  }

  /**
   * Convert RGBA to D2 direct color format
   */
  convertRGBAToD2Direct(rgbaData, format) {
    switch (format) {
      case ImageData.D2_FORMAT.ALPHA8:
        // Extract alpha channel only (every 4th byte starting from index 3)
        return this.generateAlpha8Data(rgbaData);
      case ImageData.D2_FORMAT.RGB565:
        return this.generateRGB565Data(rgbaData);
      case ImageData.D2_FORMAT.ARGB1555:
        return this.generateARGB1555Data(rgbaData);
      case ImageData.D2_FORMAT.RGBA8888:
      case ImageData.D2_FORMAT.ARGB8888:
      case ImageData.D2_FORMAT.RGB888:
        // Direct RGBA data
        return new Uint8Array(rgbaData);
      default:
        console.warn(`[ImageData] Unsupported direct format: ${format}, using RGBA`);
        return new Uint8Array(rgbaData);
    }
  }

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
      while (i + runLength < data.length && 
             data[i + runLength] === currentByte && 
             runLength < 255) {
        runLength++;
      }
      
      if (runLength > 1) {
        // RLE run: length followed by value
        compressed.push(runLength);
        compressed.push(currentByte);
      } else {
        // Single byte: just the value
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
    let i = 0;
    
    while (i < compressedData.length) {
      const byte = compressedData[i];
      
      // Check if this looks like a run length (followed by another byte)
      if (i + 1 < compressedData.length && byte > 1) {
        const runLength = byte;
        const value = compressedData[i + 1];
        
        // Add run of identical bytes
        for (let j = 0; j < runLength; j++) {
          decompressed.push(value);
        }
        
        i += 2;
      } else {
        // Single byte
        decompressed.push(byte);
        i++;
      }
    }
    
    return new Uint8Array(decompressed);
  }

  /**
   * Generate palette from RGBA data using quantization
   */
  generatePalette(rgbaData, maxColors) {
    const colorMap = new Map();
    const pixelCount = rgbaData.length / 4;
    
    // Count color frequencies
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      const r = rgbaData[offset];
      const g = rgbaData[offset + 1];
      const b = rgbaData[offset + 2];
      const colorKey = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      
      colorMap.set(colorKey, (colorMap.get(colorKey) || 0) + 1);
    }
    
    // Sort by frequency and take top colors
    const sortedColors = Array.from(colorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxColors)
      .map(entry => entry[0]);
    
    // Pad with black if needed
    while (sortedColors.length < maxColors) {
      sortedColors.push('#000000');
    }
    
    return sortedColors;
  }

  // REMOVED: Duplicate getD2FormatFromInternal method (full implementation)

  // REMOVED: Duplicate getInternalFromD2Format method

  // REMOVED: Another duplicate getD2FormatFromInternal method
  // REMOVED: Yet another duplicate getInternalFromD2Format method

  /**
   * Test helper: Create a simple test texture with palette name
   * For testing the D2 format palette name functionality
   */
  static createTestTextureWithPalette(width = 8, height = 8, paletteName = 'test_palette') {
    const imageData = new ImageData();
    imageData.createEmpty(width, height);
    
    // Create a simple gradient pattern
    const frame = imageData.frames[0];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        frame.data[idx] = (x / width) * 255;     // R
        frame.data[idx + 1] = (y / height) * 255; // G
        frame.data[idx + 2] = 128;               // B
        frame.data[idx + 3] = 255;               // A
      }
    }
    
    // Export to D2 with palette name, then reload to test round-trip
    const d2Binary = imageData.exportToD2Binary({
      format: ImageData.D2_FORMAT.RGBA8888,
      paletteName: paletteName,
      useRLE: false,
      flags: 0
    });
    
    // Create new instance and load the binary data
    const testImage = new ImageData();
    testImage.loadFromD2Binary(d2Binary);
    
    return testImage;
  }

  // ===== BACKWARD COMPATIBILITY - DELEGATE TO TextureFormatUtils =====
  
  /**
   * @deprecated Use TextureFormatUtils.getColorDepthOptions() instead
   */
  static getColorDepthOptions() {
    if (typeof TextureFormatUtils !== 'undefined') {
      return TextureFormatUtils.getColorDepthOptions();
    }
    console.warn('TextureFormatUtils not loaded. Please include texture-format-utils.js');
    return [];
  }

  /**
   * Get available color distance methods
   * @deprecated Use Palette.getColorDistanceMethods() instead
   */
  static getColorDistanceMethods() {
    return Palette.getColorDistanceMethods();
  }

  /**
   * @deprecated Use TextureFormatUtils.getCompressionOptions() instead
   */
  static getCompressionOptions() {
    if (typeof TextureFormatUtils !== 'undefined') {
      return TextureFormatUtils.getCompressionOptions();
    }
    console.warn('TextureFormatUtils not loaded. Please include texture-format-utils.js');
    return [];
  }

  /**
   * @deprecated Use TextureFormatUtils.getTextureFormatOptions() instead
   */
  static getTextureFormatOptions() {
    if (typeof TextureFormatUtils !== 'undefined') {
      return TextureFormatUtils.getTextureFormatOptions();
    }
    console.warn('TextureFormatUtils not loaded. Please include texture-format-utils.js');
    return [];
  }

  /**
   * @deprecated Use TextureFormatUtils.getTextureFormatColorCount() instead
   */
  static getTextureFormatColorCount(formatValue) {
    if (typeof TextureFormatUtils !== 'undefined') {
      return TextureFormatUtils.getTextureFormatColorCount(formatValue);
    }
    console.warn('TextureFormatUtils not loaded. Please include texture-format-utils.js');
    return 256;
  }

  // ===== BACKWARD COMPATIBILITY - DELEGATE TO PaletteManager =====
  
  /**
   * @deprecated Use paletteManager.loadPalette() instead
   */
  async loadPalette(paletteName) {
    if (this.paletteManager) {
      return this.paletteManager.loadPalette(paletteName);
    }
    console.warn('PaletteManager not available. Please include palette-manager.js');
    throw new Error('PaletteManager not available');
  }

  /**
   * @deprecated Use paletteManager.parsePaletteContent() instead
   */
  parsePaletteContent(content) {
    if (this.paletteManager) {
      return this.paletteManager.parsePaletteContent(content);
    }
    console.warn('PaletteManager not available. Please include palette-manager.js');
    return null;
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.ImageData = ImageData;
}

console.log('[Image] Class definition loaded');
