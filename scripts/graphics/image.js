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
  constructor() {
    this.frames = [];
    this.currentFrame = 0;
    this.width = 0;
    this.height = 0;
    this.format = 'rgba';
    this.filename = '';
    this.metadata = {};
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

  static fromImageElement(imgElement, filename = '') {
    const image = new ImageData();
    image.loadFromImageElement(imgElement, filename);
    return image;
  }

  // Core loading operations
  async loadFromContent(content, filename = '') {
    this.filename = this.getBaseName(filename);
    
    try {
      // Convert content to image element
      const imgElement = await this.contentToImageElement(content);
      this.loadFromImageElement(imgElement, filename);
      
      console.log(`[Image] Loaded image: ${this.width}x${this.height}, ${this.frames.length} frame(s)`);
    } catch (error) {
      console.error('[Image] Error loading image:', error);
      throw error;
    }
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
    if (!frame) return null;
    
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext('2d');
    
    // Create ImageData
    const imageData = ctx.createImageData(frame.width, frame.height);
    const data = imageData.data;
    
    // Fill with color data
    frame.colors.forEach((colorObj, index) => {
      const i = index * 4;
      data[i] = colorObj.r;
      data[i + 1] = colorObj.g;
      data[i + 2] = colorObj.b;
      data[i + 3] = colorObj.a;
    });
    
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
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.ImageData = ImageData;
}

console.log('[Image] Class definition loaded');
