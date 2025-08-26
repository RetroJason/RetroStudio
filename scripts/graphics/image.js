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

class ImageData {
  constructor(textureFile = null) {
    this.frames = [];
    this.currentFrame = 0;
    this.width = 0;
    this.height = 0;
    this.format = 'rgba';
    this.filename = '';
    this.metadata = {};
    
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

    // Export to D2 binary
    return this.exportToD2Binary({
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
      'd2_mode_alpha8': ImageData.D2_FORMAT.ALPHA8,
      'd2_mode_rgb565': ImageData.D2_FORMAT.RGB565,
      'd2_mode_argb8888': ImageData.D2_FORMAT.ARGB8888,
      'd2_mode_rgb888': ImageData.D2_FORMAT.RGB888,
      'd2_mode_argb4444': ImageData.D2_FORMAT.ARGB4444,
      'd2_mode_rgb444': ImageData.D2_FORMAT.RGB444,
      'd2_mode_argb1555': ImageData.D2_FORMAT.ARGB1555,
      'd2_mode_rgb555': ImageData.D2_FORMAT.RGB555,
      'd2_mode_ai44': ImageData.D2_FORMAT.AI44,
      'd2_mode_rgba8888': ImageData.D2_FORMAT.RGBA8888,
      'd2_mode_rgba4444': ImageData.D2_FORMAT.RGBA4444,
      'd2_mode_rgba5551': ImageData.D2_FORMAT.RGBA5551,
      'd2_mode_i8': ImageData.D2_FORMAT.I8,
      'd2_mode_i4': ImageData.D2_FORMAT.I4,
      'd2_mode_i2': ImageData.D2_FORMAT.I2,
      'd2_mode_i1': ImageData.D2_FORMAT.I1,
      'd2_mode_alpha4': ImageData.D2_FORMAT.ALPHA4,
      'd2_mode_alpha2': ImageData.D2_FORMAT.ALPHA2,
      'd2_mode_alpha1': ImageData.D2_FORMAT.ALPHA1
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
        this.loadFromD2Binary(content);
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
   * @returns {Object} Object containing indexed byte array and palette info
   */
  matchToPalette(frameIndex = null, palette, offset = 0, colorCount = null) {
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

    return {
      container: progressContainer,
      statusText: statusText,
      progressFill: progressFill,
      percentText: percentText
    };
  }

  _updateProgress(progressUI, status, percent) {
    if (!progressUI) return;
    
    progressUI.statusText.textContent = status;
    progressUI.progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    progressUI.percentText.textContent = `${Math.round(percent)}%`;
  }

  async _updateProgressAsync(progressUI, status, percent) {
    if (!progressUI) return;
    
    progressUI.statusText.textContent = status;
    progressUI.progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    progressUI.percentText.textContent = `${Math.round(percent)}%`;
    
    // Yield control to browser to update UI
    await new Promise(resolve => setTimeout(resolve, 0));
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
   * @returns {Uint8Array} Binary data in the specified format
   */
  getBinaryData(format, palette = null) {
    // Generate cache key
    const paletteHash = palette ? this.hashArray(palette) : null;
    const sourceHash = this.getSourceDataHash();
    
    // Check if cached binary data is still valid
    if (this.textureCache.binaryData &&
        this.textureCache.binaryDataFormat === format &&
        this.textureCache.binaryDataPaletteHash === paletteHash &&
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
      binaryData = this.generateIndexed4Data(sourceData, palette);
    } else if (format.includes('_i2')) {
      binaryData = this.generateIndexed2Data(sourceData, palette);
    } else if (format.includes('_i1')) {
      binaryData = this.generateIndexed1Data(sourceData, palette);
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
    this.textureCache.sourceDataHash = sourceHash;
    
    console.log(`[Image] Generated ${binaryData.length} bytes for format ${format}`);
    return binaryData;
  }

  /**
   * Get rendered 32-bit RGBA data for display
   * @param {string} format - The texture format
   * @param {Array} palette - Array of color strings
   * @param {number} paletteOffset - Offset into the palette (0-255)
   * @returns {Uint8ClampedArray} 32-bit RGBA data ready for canvas
   */
  getRenderedData(format, palette = null, paletteOffset = 0) {
    // Get binary data first (this handles its own caching)
    const binaryData = this.getBinaryData(format, palette);
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
   * Find closest color in palette
   */
  findClosestPaletteColor(r, g, b, a, palette) {
    if (!palette || palette.length === 0) return 0;
    
    let closestIndex = 0;
    let closestDistance = Infinity;
    
    for (let i = 0; i < palette.length; i++) {
      const paletteColor = this.parseColor(palette[i]);
      if (!paletteColor) continue;
      
      // Calculate color distance (simple RGB distance)
      const dr = r - paletteColor.r;
      const dg = g - paletteColor.g;
      const db = b - paletteColor.b;
      const distance = dr * dr + dg * dg + db * db;
      
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = i;
      }
    }
    
    return closestIndex;
  }

  /**
   * Parse color string to RGB values
   */
  parseColor(colorStr) {
    if (!colorStr) return null;
    
    if (colorStr.startsWith('#')) {
      const hex = colorStr.slice(1);
      if (hex.length === 6) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: 255
        };
      }
    }
    
    return null;
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
    
    for (let i = 0; i < pixelCount; i++) {
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

  // Texture format options - moved from TextureEditor for better organization
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

  static getCompressionOptions() {
    return [
      { value: 'none', label: 'None', description: 'No compression' },
      { value: 'rle', label: 'RLE', description: 'Run-length encoding' },
      { value: 'lz77', label: 'LZ77', description: 'LZ77 compression' }
    ];
  }

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

  // Get the number of colors supported by a texture format
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

  // ===== D2 TEXTURE FORMAT SUPPORT =====

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

  static get D2_HEADER_SIZE() {
    return 25; // 2 (magic) + 2 (width) + 2 (height) + 1 (prerotation) + 1 (flags) + 1 (format) + 16 (palette name)
  }

  /**
   * Load from D2 texture format binary data
   */
  loadFromD2Binary(arrayBuffer) {
    console.log('[ImageData] Loading D2 texture format');
    
    const view = new DataView(arrayBuffer);
    let offset = 0;
    
    // Check magic identifier "D2"
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1));
    if (magic !== 'D2') {
      throw new Error('Invalid D2 texture format: Missing D2 magic identifier');
    }
    offset += 2;
    
    // Read header
    this.width = view.getUint16(offset, true); // little endian
    offset += 2;
    this.height = view.getUint16(offset, true);
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
    
    console.log(`[ImageData] D2 Header: ${this.width}x${this.height}, format: ${baseFormat}, RLE: ${isRLE}, indexed: ${isIndexed}, palette: "${paletteName}"`);
    
    // Store metadata
    this.metadata = {
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
      
      this.metadata.palette = palette;
      console.log(`[ImageData] Loaded palette with ${paletteSize} colors`);
    }
    
    // Read pixel data
    const remainingBytes = arrayBuffer.byteLength - offset;
    const pixelData = new Uint8Array(arrayBuffer, offset, remainingBytes);
    
    // Decompress if RLE
    let decompressedData = pixelData;
    if (isRLE) {
      decompressedData = this.decompressRLE(pixelData);
      console.log(`[ImageData] RLE decompressed ${pixelData.length} -> ${decompressedData.length} bytes`);
    }
    
    // Convert to RGBA based on format
    const rgbaData = this.convertD2ToRGBA(decompressedData, baseFormat, palette);
    
    // Create frame
    this.frames = [{
      data: rgbaData,
      width: this.width,
      height: this.height,
      delay: 0
    }];
    
    this.currentFrame = 0;
    this.format = 'rgba';
    
    // Clear texture cache since we loaded new data
    this.clearTextureCache();
    
    console.log(`[ImageData] Successfully loaded D2 texture: ${this.width}x${this.height}`);
  }

  /**
   * Export to D2 texture format binary data
   */
  exportToD2Binary(options = {}) {
    const {
      format = ImageData.D2_FORMAT.RGBA8888,
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
      console.log(`[ImageData] Auto-extracted palette name from palette object: "${finalPaletteName}"`);
    }
    
    console.log('[ImageData] Exporting to D2 texture format');
    console.log('[ImageData] Export options:', options);
    console.log('[ImageData] Final format being used:', format);
    console.log('[ImageData] Final palette name being used:', finalPaletteName);
    
    if (!this.frames.length) {
      throw new Error('No image data to export');
    }

    const sourceRGBA = this.getSourceRGBAData();
    if (!sourceRGBA) {
      throw new Error('Unable to get source RGBA data for export');
    }    // Determine if format is indexed
    const isIndexed = [
      ImageData.D2_FORMAT.I8,
      ImageData.D2_FORMAT.I4,
      ImageData.D2_FORMAT.I2,
      ImageData.D2_FORMAT.I1
    ].includes(format);
    
    // Convert RGBA to target format
    let pixelData, exportPalette;
    if (isIndexed) {
      console.log(`[ImageData] Converting to indexed format with palette:`, !!palette);
      if (palette) {
        console.log(`[ImageData] Palette has ${palette.colors ? palette.colors.length : 'no'} colors`);
      }
      const result = this.convertRGBAToD2Indexed(sourceRGBA, format, palette);
      pixelData = result.indexData;
      exportPalette = result.palette;
      console.log(`[ImageData] Indexed conversion complete - pixelData.length: ${pixelData ? pixelData.length : 'null'}, palette entries: ${exportPalette ? exportPalette.length : 'none'}`);
      console.log(`[ImageData] exportPalette type:`, typeof exportPalette, 'isArray:', Array.isArray(exportPalette));
    } else {
      pixelData = this.convertRGBAToD2Direct(sourceRGBA, format);
      exportPalette = null;
      console.log(`[ImageData] Using direct conversion - pixelData.length: ${pixelData.length}`);
    }
    
    // Apply RLE compression if requested
    let finalPixelData = pixelData;
    console.log(`[ImageData] Before RLE - pixelData.length: ${pixelData.length}, useRLE: ${useRLE}`);
    if (useRLE) {
      finalPixelData = this.compressRLE(pixelData);
      console.log(`[ImageData] RLE compressed ${pixelData.length} -> ${finalPixelData.length} bytes`);
    }
    console.log(`[ImageData] Final pixel data length: ${finalPixelData.length}`);
    
    // Calculate total size
    const headerSize = ImageData.D2_HEADER_SIZE;
    let paletteLength = 0;
    if (exportPalette) {
      // Handle both Palette objects and arrays
      if (exportPalette.colors && Array.isArray(exportPalette.colors)) {
        paletteLength = exportPalette.colors.length;
      } else if (Array.isArray(exportPalette)) {
        paletteLength = exportPalette.length;
      } else if (typeof exportPalette.length === 'number') {
        paletteLength = exportPalette.length;
      }
    }
    const paletteSize = paletteLength * 4;
    const totalSize = headerSize + paletteSize + finalPixelData.length;
    
    console.log(`[ImageData] D2 export size calculation:`);
    console.log(`  - headerSize: ${headerSize}`);
    console.log(`  - paletteSize: ${paletteSize} (palette length: ${paletteLength})`);
    console.log(`  - finalPixelData.length: ${finalPixelData.length}`);
    console.log(`  - totalSize: ${totalSize}`);
    console.log(`  - this.width: ${this.width}, this.height: ${this.height}`);
    
    // Create binary data
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;
    
    console.log(`[ImageData] Starting D2 header write at offset: ${offset}`);
    
    // Write header
    view.setUint8(offset++, 0x44); // 'D'
    view.setUint8(offset++, 0x32); // '2'
    view.setUint16(offset, this.width, true); offset += 2;
    view.setUint16(offset, this.height, true); offset += 2;
    view.setUint8(offset++, prerotation);
    view.setUint8(offset++, flags);
    
    // Write format byte
    let formatByte = format & 0x0F;
    if (useRLE) formatByte |= 0x20;
    if (isIndexed) formatByte |= 0x40;
    view.setUint8(offset++, formatByte);
    
    // Write palette name (16 bytes)
    const paletteNameTruncated = (finalPaletteName || '').substring(0, 15); // Max 15 chars to leave room for null terminator
    const paletteNameBytes = new Uint8Array(16);
    for (let i = 0; i < paletteNameTruncated.length; i++) {
      paletteNameBytes[i] = paletteNameTruncated.charCodeAt(i);
    }
    console.log(`[ImageData] Writing palette name to D2 header: "${paletteNameTruncated}" (${paletteNameTruncated.length} chars)`);
    // Remaining bytes are already 0 (null terminator)
    const targetBytes = new Uint8Array(buffer, offset, 16);
    targetBytes.set(paletteNameBytes);
    offset += 16;
    
    // Write palette if indexed
    if (exportPalette) {
      let colorsToWrite = [];
      
      // Handle both Palette objects and arrays
      if (exportPalette.colors && Array.isArray(exportPalette.colors)) {
        colorsToWrite = exportPalette.colors;
      } else if (Array.isArray(exportPalette)) {
        colorsToWrite = exportPalette;
      }
      
      for (const colorStr of colorsToWrite) {
        const color = this.parseColor(colorStr) || { r: 0, g: 0, b: 0, a: 255 };
        view.setUint8(offset++, color.r);
        view.setUint8(offset++, color.g);
        view.setUint8(offset++, color.b);
        view.setUint8(offset++, color.a);
      }
    }
    
    // Write pixel data
    const pixelArray = new Uint8Array(buffer, offset);
    pixelArray.set(finalPixelData);
    
    console.log(`[ImageData] Exported D2 texture: ${totalSize} bytes total`);
    return buffer;
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

  /**
   * Get D2 format constant from internal format name
   */
  static getD2FormatFromInternal(internalFormat) {
    const formatMap = {
      'd2_mode_alpha8': ImageData.D2_FORMAT.ALPHA8,
      'd2_mode_rgb565': ImageData.D2_FORMAT.RGB565,
      'd2_mode_argb8888': ImageData.D2_FORMAT.ARGB8888,
      'd2_mode_rgb888': ImageData.D2_FORMAT.RGB888,
      'd2_mode_argb4444': ImageData.D2_FORMAT.ARGB4444,
      'd2_mode_rgb444': ImageData.D2_FORMAT.RGB444,
      'd2_mode_argb1555': ImageData.D2_FORMAT.ARGB1555,
      'd2_mode_rgb555': ImageData.D2_FORMAT.RGB555,
      'd2_mode_ai44': ImageData.D2_FORMAT.AI44,
      'd2_mode_rgba8888': ImageData.D2_FORMAT.RGBA8888,
      'd2_mode_rgba4444': ImageData.D2_FORMAT.RGBA4444,
      'd2_mode_rgba5551': ImageData.D2_FORMAT.RGBA5551,
      'd2_mode_i8': ImageData.D2_FORMAT.I8,
      'd2_mode_i4': ImageData.D2_FORMAT.I4,
      'd2_mode_i2': ImageData.D2_FORMAT.I2,
      'd2_mode_i1': ImageData.D2_FORMAT.I1,
      'd2_mode_alpha4': ImageData.D2_FORMAT.ALPHA4,
      'd2_mode_alpha2': ImageData.D2_FORMAT.ALPHA2,
      'd2_mode_alpha1': ImageData.D2_FORMAT.ALPHA1
    };
    
    return formatMap[internalFormat];
  }

  /**
   * Get internal format name from D2 format constant
   */
  static getInternalFromD2Format(d2Format) {
    const formatMap = {
      [ImageData.D2_FORMAT.ALPHA8]: 'd2_mode_alpha8',
      [ImageData.D2_FORMAT.RGB565]: 'd2_mode_rgb565',
      [ImageData.D2_FORMAT.ARGB8888]: 'd2_mode_argb8888',
      [ImageData.D2_FORMAT.RGB888]: 'd2_mode_rgb888',
      [ImageData.D2_FORMAT.ARGB4444]: 'd2_mode_argb4444',
      [ImageData.D2_FORMAT.RGB444]: 'd2_mode_rgb444',
      [ImageData.D2_FORMAT.ARGB1555]: 'd2_mode_argb1555',
      [ImageData.D2_FORMAT.RGB555]: 'd2_mode_rgb555',
      [ImageData.D2_FORMAT.AI44]: 'd2_mode_ai44',
      [ImageData.D2_FORMAT.RGBA8888]: 'd2_mode_rgba8888',
      [ImageData.D2_FORMAT.RGBA4444]: 'd2_mode_rgba4444',
      [ImageData.D2_FORMAT.RGBA5551]: 'd2_mode_rgba5551',
      [ImageData.D2_FORMAT.I8]: 'd2_mode_i8',
      [ImageData.D2_FORMAT.I4]: 'd2_mode_i4',
      [ImageData.D2_FORMAT.I2]: 'd2_mode_i2',
      [ImageData.D2_FORMAT.I1]: 'd2_mode_i1',
      [ImageData.D2_FORMAT.ALPHA4]: 'd2_mode_alpha4',
      [ImageData.D2_FORMAT.ALPHA2]: 'd2_mode_alpha2',
      [ImageData.D2_FORMAT.ALPHA1]: 'd2_mode_alpha1'
    };
    
    return formatMap[d2Format] || 'd2_mode_rgba8888';
  }

  /**
   * Get D2 format constant from internal format name
   */
  static getD2FormatFromInternal(internalFormat) {
    const formatMap = {
      'd2_mode_alpha8': ImageData.D2_FORMAT.ALPHA8,
      'd2_mode_rgb565': ImageData.D2_FORMAT.RGB565,
      'd2_mode_argb8888': ImageData.D2_FORMAT.ARGB8888,
      'd2_mode_rgb888': ImageData.D2_FORMAT.RGB888,
      'd2_mode_argb4444': ImageData.D2_FORMAT.ARGB4444,
      'd2_mode_rgb444': ImageData.D2_FORMAT.RGB444,
      'd2_mode_argb1555': ImageData.D2_FORMAT.ARGB1555,
      'd2_mode_rgb555': ImageData.D2_FORMAT.RGB555,
      'd2_mode_ai44': ImageData.D2_FORMAT.AI44,
      'd2_mode_rgba8888': ImageData.D2_FORMAT.RGBA8888,
      'd2_mode_rgba4444': ImageData.D2_FORMAT.RGBA4444,
      'd2_mode_rgba5551': ImageData.D2_FORMAT.RGBA5551,
      'd2_mode_i8': ImageData.D2_FORMAT.I8,
      'd2_mode_i4': ImageData.D2_FORMAT.I4,
      'd2_mode_i2': ImageData.D2_FORMAT.I2,
      'd2_mode_i1': ImageData.D2_FORMAT.I1,
      'd2_mode_alpha4': ImageData.D2_FORMAT.ALPHA4,
      'd2_mode_alpha2': ImageData.D2_FORMAT.ALPHA2,
      'd2_mode_alpha1': ImageData.D2_FORMAT.ALPHA1
    };
    
    return formatMap[internalFormat];
  }

  /**
   * Get internal format name from D2 format constant
   */
  static getInternalFromD2Format(d2Format) {
    const formatMap = {
      [ImageData.D2_FORMAT.ALPHA8]: 'd2_mode_alpha8',
      [ImageData.D2_FORMAT.RGB565]: 'd2_mode_rgb565',
      [ImageData.D2_FORMAT.ARGB8888]: 'd2_mode_argb8888',
      [ImageData.D2_FORMAT.RGB888]: 'd2_mode_rgb888',
      [ImageData.D2_FORMAT.ARGB4444]: 'd2_mode_argb4444',
      [ImageData.D2_FORMAT.RGB444]: 'd2_mode_rgb444',
      [ImageData.D2_FORMAT.ARGB1555]: 'd2_mode_argb1555',
      [ImageData.D2_FORMAT.RGB555]: 'd2_mode_rgb555',
      [ImageData.D2_FORMAT.AI44]: 'd2_mode_ai44',
      [ImageData.D2_FORMAT.RGBA8888]: 'd2_mode_rgba8888',
      [ImageData.D2_FORMAT.RGBA4444]: 'd2_mode_rgba4444',
      [ImageData.D2_FORMAT.RGBA5551]: 'd2_mode_rgba5551',
      [ImageData.D2_FORMAT.I8]: 'd2_mode_i8',
      [ImageData.D2_FORMAT.I4]: 'd2_mode_i4',
      [ImageData.D2_FORMAT.I2]: 'd2_mode_i2',
      [ImageData.D2_FORMAT.I1]: 'd2_mode_i1',
      [ImageData.D2_FORMAT.ALPHA4]: 'd2_mode_alpha4',
      [ImageData.D2_FORMAT.ALPHA2]: 'd2_mode_alpha2',
      [ImageData.D2_FORMAT.ALPHA1]: 'd2_mode_alpha1'
    };
    
    return formatMap[d2Format] || 'd2_mode_rgba8888';
  }

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
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.ImageData = ImageData;
}

console.log('[Image] Class definition loaded');
