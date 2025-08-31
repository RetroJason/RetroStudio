/**
 * RetroImage - Clean API for retro graphics processing
 * Handles image loading, format conversion, and palette management
 */
class RetroImage {
  constructor(source = null) {
    // Image data
    this.frames = [];
    this.currentFrame = 0;
    this._width = 0;
    this._height = 0;
    this.filename = '';
    this.metadata = {};
    
    // Store original image data for palette fitting
    this._originalFrames = []; // Original RGBA data before any processing
    
    // Configuration state
    this._format = null;           // Target D2 format
    this._currentFormat = null;    // Current format string for chunk size calculation
    this._palette = null;          // Current palette (RGB objects)
    this._paletteOffset = 0;       // Palette offset for indexed formats
    this._paletteName = null;      // Preferred palette name for .texture file
    
    // Render cache state
    this._renderCache = new Map();  // Cache for rendered ImageData
    this._isDirty = false;         // True when D2 data changed and needs re-render
    this._lastRenderOffset = -1;   // Last palette offset used for rendering
    
    // Dependencies (optional for standalone usage)
    try {
      this.paletteManager = new PaletteManager();
    } catch (error) {
      console.warn('[RetroImage] PaletteManager not available - external palette loading disabled');
      this.paletteManager = null;
    }
    
    // Auto-load if source provided
    if (source) {
      this._autoLoad(source);
    }
  }

  // =============================================================================
  // PROPERTIES (READ-ONLY)
  // =============================================================================
  
  get width() { return this._width; }
  get height() { return this._height; }
  get frameCount() { return this.frames.length; }

  // =============================================================================
  // CONSTRUCTOR & LOADING
  // =============================================================================
  
  async _autoLoad(source) {
    if (typeof source === 'string') {
      // Assume it's a file path or data URL
      await this.loadFromFile(source);
    } else if (source instanceof ArrayBuffer) {
      // Check if it's D2 format
      if (this._isD2Format(source)) {
        await this.loadFromD2(source);
      } else {
        throw new Error('Unknown binary format');
      }
    } else if (source instanceof HTMLCanvasElement) {
      this.loadFromCanvas(source);
    } else if (source instanceof HTMLImageElement) {
      this.loadFromImageElement(source);
    } else {
      throw new Error('Unsupported source type');
    }
  }

  static async fromFile(file) {
    const image = new RetroImage();
    await image.loadFromFile(file);
    return image;
  }

  static async fromD2(d2Data) {
    const image = new RetroImage();
    await image.loadFromD2(d2Data);
    return image;
  }

  static async fromTexture(textureData) {
    const image = new RetroImage();
    await image.loadFromTexture(textureData);
    return image;
  }

  static fromCanvas(canvas) {
    const image = new RetroImage();
    image.loadFromCanvas(canvas);
    return image;
  }

  async loadFromFile(file) {
    // Handle both File objects and file paths/URLs
    let content;
    if (typeof file === 'string') {
      // URL or data URL
      content = await this._fetchFile(file);
    } else {
      // File object
      content = await this._readFile(file);
      this.filename = file.name || 'unknown';
    }
    
    await this._loadFromContent(content);
  }

  async loadFromD2(d2Data) {
    if (!this._isD2Format(d2Data)) {
      throw new Error('Invalid D2 format');
    }
    
    // Use D2FormatHandler to parse
    const d2Handler = new D2FormatHandler();
    const result = d2Handler.loadFromD2Binary(d2Data);
    
    this._width = result.width;
    this._height = result.height;
    this._format = result.baseFormat;
    
    // Convert D2 frames back to RGBA color arrays
    this.frames = [];
    this._originalFrames = []; // Initialize original frames
    for (const d2Frame of result.frames) {
      // Convert D2 pixel data back to RGBA
      const rgbaData = d2Handler.convertD2ToRGBA(d2Frame.data, result.baseFormat, result.palette);
      
      // Convert RGBA data to color objects
      const frame = this._rgbaDataToFrame(rgbaData, d2Frame.width, d2Frame.height);
      this.frames.push(frame);
      this._originalFrames.push(JSON.parse(JSON.stringify(frame))); // Deep copy for original data
    }
    
    this.currentFrame = 0;
    
    console.log(`[RetroImage] Loaded D2: ${this.width}x${this.height}, format: ${this._format}`);
  }

  async loadFromTexture(textureData) {
    // Parse .texture file and load referenced image
    const textureConfig = JSON.parse(new TextDecoder().decode(textureData));
    
    if (!textureConfig.sourceImage) {
      throw new Error('Texture file missing sourceImage reference');
    }
    
    // Load the source image
    await this.loadFromFile(textureConfig.sourceImage);
    
    // Apply texture configuration
    if (textureConfig.format) {
      this.setFormat(textureConfig.format);
    }
    if (textureConfig.palette) {
      await this.setPalette(textureConfig.palette);
    }
    if (textureConfig.paletteOffset !== undefined) {
      this.setPaletteOffset(textureConfig.paletteOffset);
    }
    
    this.metadata.textureConfig = textureConfig;
  }

  loadFromCanvas(canvas, filename = 'canvas') {
    this.filename = filename;
    this._width = canvas.width;
    this._height = canvas.height;
    
    // Extract image data
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Analyze the image to suggest optimal format
    this.suggestedFormat = this._analyzeImageFormat(imageData);
    
    // Convert to frame
    const frame = this._imageDataToFrame(imageData);
    this.frames = [frame];
    this._originalFrames = [JSON.parse(JSON.stringify(frame))]; // Deep copy for original data
    this.currentFrame = 0;
    
    console.log(`[RetroImage] Loaded from canvas: ${this.width}x${this.height}, suggested format: ${this.suggestedFormat}`);
  }

  loadFromImageElement(imgElement, filename = '') {
    this.filename = filename || imgElement.src || 'image';
    this._width = imgElement.naturalWidth;
    this._height = imgElement.naturalHeight;
    
    // Draw to canvas to get pixel data
    const canvas = document.createElement('canvas');
    canvas.width = this._width;
    canvas.height = this._height;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgElement, 0, 0);
    
    const imageData = ctx.getImageData(0, 0, this._width, this._height);
    
    // Analyze the image to suggest optimal format
    this.suggestedFormat = this._analyzeImageFormat(imageData);
    
    const frame = this._imageDataToFrame(imageData);
    this.frames = [frame];
    this._originalFrames = [JSON.parse(JSON.stringify(frame))]; // Deep copy for original data
    this.currentFrame = 0;
    
    console.log(`[RetroImage] Loaded from image element: ${this.width}x${this.height}, suggested format: ${this.suggestedFormat}`);
  }

  // =============================================================================
  // FORMAT CONFIGURATION
  // =============================================================================
  
  setFormat(format) {
    this._format = format;
  }

  getFormat() {
    return this._format;
  }

  // =============================================================================
  // PALETTE MANAGEMENT
  // =============================================================================
  
  /**
   * Set the preferred palette for this image
   * Only updates palette name and RGB array, marks render as dirty
   */
  setPalette(palette, paletteName = null) {
    if (typeof palette === 'string') {
      // Palette file path - load it
      return this._loadPaletteFile(palette);
    } else if (palette instanceof ArrayBuffer) {
      // Palette file data
      return this._parsePaletteData(palette);
    } else if (Array.isArray(palette)) {
      // Array of RGB color objects {r, g, b, a}
      this._palette = palette;
      this._paletteName = paletteName;
      this._markDirty();
    } else {
      throw new Error('Invalid palette format');
    }
  }

  getPalette() {
    return this._palette;
  }
  
  getPaletteName() {
    return this._paletteName;
  }

  setPaletteOffset(offset) {
    this._paletteOffset = offset;
  }

  getPaletteOffset() {
    return this._paletteOffset;
  }

  setCurrentFormat(format) {
    this._currentFormat = format;
  }

  getCurrentFormat() {
    return this._currentFormat;
  }

  /**
   * Fit the image to the current palette using best-fit color matching
   * Regenerates D2 indices based on closest color distances
   * @param {number} paletteOffset - Offset in palette to start from
   * @param {string} distanceMethod - 'euclidean' or 'dei' (Delta E)
   * @param {HTMLElement} progressTarget - Element to show progress bar (optional)
   */
  async fitToPalette(paletteOffset = 0, distanceMethod = 'euclidean', progressTarget = null) {
    if (!this._palette) {
      throw new Error('No palette set. Call setPalette() first.');
    }
    
    const originalFrame = this._originalFrames[this.currentFrame];
    if (!originalFrame || !originalFrame.colors) {
      throw new Error('No original frame data available for fitting. Image may need to be reloaded.');
    }
    
    console.log(`[RetroImage] Fitting ${originalFrame.colors.length} pixels to palette (offset: ${paletteOffset}, method: ${distanceMethod})`);
    
    // Create working palette from offset
    const workingPalette = this._palette.slice(paletteOffset);
    if (workingPalette.length === 0) {
      throw new Error('Palette offset is beyond palette length');
    }
    
    console.log(`[RetroImage] Palette has ${this._palette.length} colors, working palette has ${workingPalette.length} colors`);
    console.log(`[RetroImage] First 3 palette colors:`, workingPalette.slice(0, 3));
    
    // Create a new frame by processing the original data
    const newFrame = {
      width: originalFrame.width,
      height: originalFrame.height,
      colors: []
    };
    
    const totalPixels = originalFrame.colors.length;
    let processedPixels = 0;
    let debugCount = 0;
    
    // Process each pixel to find best palette match
    for (let i = 0; i < originalFrame.colors.length; i++) {
      const originalColor = originalFrame.colors[i];
      
      // Skip transparent pixels - keep them as-is
      if (originalColor.a < 128) {
        newFrame.colors.push({ ...originalColor });
        continue;
      }
      
      // Find closest color in working palette
      let bestMatch = 0;
      let bestDistance = Number.MAX_VALUE;
      
      for (let j = 0; j < workingPalette.length; j++) {
        const paletteColor = workingPalette[j];
        const distance = this._calculateColorDistance(originalColor, paletteColor, distanceMethod);
        
        if (distance < bestDistance) {
          bestDistance = distance;
          bestMatch = j;
        }
      }
      
      // Debug first few matches
      if (debugCount < 5) {
        console.log(`[RetroImage] Pixel ${i}: Original rgb(${originalColor.r},${originalColor.g},${originalColor.b}) -> Palette[${bestMatch}] rgb(${workingPalette[bestMatch].r},${workingPalette[bestMatch].g},${workingPalette[bestMatch].b}) distance: ${bestDistance.toFixed(2)}`);
        debugCount++;
      }
      
      // Replace pixel with best match from palette
      newFrame.colors.push({ ...workingPalette[bestMatch] });
      
      // Update progress
      processedPixels++;
      if (progressTarget && processedPixels % 1000 === 0) {
        const progress = (processedPixels / totalPixels) * 100;
        this._updateProgress(progressTarget, progress);
        await this._yieldToEventLoop();
      }
    }
    
    // Replace the current frame with the fitted frame
    this.frames[this.currentFrame] = newFrame;
    
    // Complete progress
    if (progressTarget) {
      this._updateProgress(progressTarget, 100);
    }
    
    this._markDirty();
    console.log(`[RetroImage] Palette fitting complete`);
  }

  /**
   * Find the best palette offset by testing all positions
   * @param {string} distanceMethod - 'euclidean' or 'dei' (Delta E)
   * @param {Function} progressCallback - Callback function for progress updates (optional)
   * @returns {number} Best palette offset found
   */
  async findBestPaletteOffset(distanceMethod = 'euclidean', progressCallback = null) {
    if (!this._palette) {
      throw new Error('No palette set. Call setPalette() first.');
    }
    
    const originalFrame = this._originalFrames[this.currentFrame];
    if (!originalFrame || !originalFrame.colors) {
      throw new Error('No original frame data available for analysis. Image may need to be reloaded.');
    }
    
    // Extract unique colors from the original image
    const imageColors = this._extractUniqueColors(originalFrame);
    console.log(`[RetroImage] Analyzing ${imageColors.length} unique colors against palette`);
    
    // Determine palette chunk size based on current format
    let chunkSize = 256; // Default for I8
    if (this._currentFormat) {
      const format = this._currentFormat.toLowerCase();
      if (format.includes('i4')) chunkSize = 16;
      else if (format.includes('i2')) chunkSize = 4;
      else if (format.includes('i1')) chunkSize = 2;
      else if (format.includes('ai44')) chunkSize = 16;
    }
    
    console.log(`[RetroImage] Testing palette chunks of ${chunkSize} colors`);
    console.log(`[RetroImage] Palette has ${this._palette.length} total colors`);
    console.log(`[RetroImage] Will test ${totalTests} chunks from offset 0 to ${maxOffset}`);
    
    let bestOffset = 0;
    let bestScore = Number.MAX_VALUE;
    const maxOffset = Math.max(0, this._palette.length - chunkSize);
    const totalTests = Math.floor(maxOffset / chunkSize) + 1;
    
    let testCount = 0;
    for (let offset = 0; offset <= maxOffset; offset += chunkSize) {
      const workingPalette = this._palette.slice(offset, offset + chunkSize);
      if (workingPalette.length < chunkSize && offset > 0) break;
      
      console.log(`[RetroImage] Testing chunk ${testCount + 1}/${totalTests}: offset ${offset}-${offset + chunkSize - 1}`);
      
      // Calculate total distance for this offset
      let totalDistance = 0;
      for (const imageColor of imageColors) {
        let minDistance = Number.MAX_VALUE;
        for (const paletteColor of workingPalette) {
          const distance = this._calculateColorDistance(imageColor.color, paletteColor, distanceMethod);
          minDistance = Math.min(minDistance, distance);
        }
        totalDistance += minDistance * imageColor.count; // Weight by frequency
      }
      
      console.log(`[RetroImage] Chunk ${testCount + 1}: offset ${offset}, score ${totalDistance.toFixed(2)}`);
      
      if (totalDistance < bestScore) {
        bestScore = totalDistance;
        bestOffset = offset;
        console.log(`[RetroImage] New best: offset ${bestOffset}, score ${bestScore.toFixed(2)}`);
      }
      
      testCount++;
      
      // Update progress
      if (progressCallback && typeof progressCallback === 'function') {
        const progress = testCount / totalTests;
        progressCallback(progress);
        await this._yieldToEventLoop();
      }
    }
    
    console.log(`[RetroImage] Best palette offset: ${bestOffset} (score: ${bestScore.toFixed(2)})`);
    return bestOffset;
  }

  extractPalette(maxColors = 256, frameIndex = null) {
    // Use original frame data for palette extraction
    const frame = frameIndex !== null ? 
      this._originalFrames[frameIndex] : 
      this._originalFrames[this.currentFrame];
    
    if (!frame) {
      console.warn('[RetroImage] No original frame data available for palette extraction');
      return [];
    }
    
    console.log(`[RetroImage] Extracting palette from frame with ${frame.colors.length} pixels`);
    
    // Collect all non-transparent colors
    const colors = [];
    frame.colors.forEach(colorObj => {
      if (colorObj.a >= 128) { // Skip mostly transparent pixels
        colors.push([colorObj.r, colorObj.g, colorObj.b]);
      }
    });
    
    console.log(`[RetroImage] Processing ${colors.length} opaque pixels for palette extraction`);
    
    // Use median cut algorithm for better color reduction
    const palette = this._medianCutQuantization(colors, maxColors);
    
    const result = palette.map(color => ({
      r: Math.round(color[0]),
      g: Math.round(color[1]), 
      b: Math.round(color[2]),
      a: 255
    }));
    
    console.log(`[RetroImage] Returning ${result.length} colors for palette`);
    console.log(`[RetroImage] Sample palette colors:`, result.slice(0, 5));
    return result;
  }

  _medianCutQuantization(colors, maxColors) {
    if (colors.length === 0) return [];
    if (maxColors <= 1) return [this._averageColor(colors)];
    
    // Start with all colors in one bucket
    let buckets = [colors];
    
    // Keep splitting buckets until we have enough colors
    while (buckets.length < maxColors && buckets.some(bucket => bucket.length > 1)) {
      // Find the bucket with the largest range to split
      let largestBucket = null;
      let largestRange = 0;
      
      for (let bucket of buckets) {
        if (bucket.length <= 1) continue;
        
        const range = this._getColorRange(bucket);
        if (range > largestRange) {
          largestRange = range;
          largestBucket = bucket;
        }
      }
      
      if (!largestBucket) break;
      
      // Split the largest bucket
      const bucketIndex = buckets.indexOf(largestBucket);
      const [bucket1, bucket2] = this._splitBucket(largestBucket);
      buckets.splice(bucketIndex, 1, bucket1, bucket2);
    }
    
    // Convert buckets to representative colors
    return buckets.map(bucket => this._averageColor(bucket));
  }

  _getColorRange(colors) {
    if (colors.length === 0) return 0;
    
    let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    
    for (let color of colors) {
      minR = Math.min(minR, color[0]);
      maxR = Math.max(maxR, color[0]);
      minG = Math.min(minG, color[1]);
      maxG = Math.max(maxG, color[1]);
      minB = Math.min(minB, color[2]);
      maxB = Math.max(maxB, color[2]);
    }
    
    const rRange = maxR - minR;
    const gRange = maxG - minG;
    const bRange = maxB - minB;
    
    return Math.max(rRange, gRange, bRange);
  }

  _splitBucket(colors) {
    if (colors.length <= 1) return [colors, []];
    
    // Find the channel with the largest range
    let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    
    for (let color of colors) {
      minR = Math.min(minR, color[0]);
      maxR = Math.max(maxR, color[0]);
      minG = Math.min(minG, color[1]);
      maxG = Math.max(maxG, color[1]);
      minB = Math.min(minB, color[2]);
      maxB = Math.max(maxB, color[2]);
    }
    
    const rRange = maxR - minR;
    const gRange = maxG - minG;
    const bRange = maxB - minB;
    
    let sortIndex = 0; // Red
    if (gRange >= rRange && gRange >= bRange) sortIndex = 1; // Green
    else if (bRange >= rRange && bRange >= gRange) sortIndex = 2; // Blue
    
    // Sort by the channel with largest range
    colors.sort((a, b) => a[sortIndex] - b[sortIndex]);
    
    // Split at median
    const midpoint = Math.floor(colors.length / 2);
    return [colors.slice(0, midpoint), colors.slice(midpoint)];
  }

  _averageColor(colors) {
    if (colors.length === 0) return [0, 0, 0];
    
    let totalR = 0, totalG = 0, totalB = 0;
    
    for (let color of colors) {
      totalR += color[0];
      totalG += color[1];
      totalB += color[2];
    }
    
    return [
      totalR / colors.length,
      totalG / colors.length,
      totalB / colors.length
    ];
  }

  // =============================================================================
  // EXPORT METHODS
  // =============================================================================
  
  async toD2() {
    if (!this._format) {
      throw new Error('No format specified. Call setFormat() first.');
    }
    
    // Convert frame colors to RGBA data array
    const frame = this.getCurrentFrame();
    if (!frame) {
      throw new Error('No frame data available');
    }
    
    const rgbaData = new Uint8Array(frame.colors.length * 4);
    for (let i = 0; i < frame.colors.length; i++) {
      const color = frame.colors[i];
      const offset = i * 4;
      rgbaData[offset] = color.r;
      rgbaData[offset + 1] = color.g;
      rgbaData[offset + 2] = color.b;
      rgbaData[offset + 3] = color.a;
    }
    
    const d2Handler = new D2FormatHandler();
    return d2Handler.exportToD2Binary(rgbaData, this.width, this.height, {
      format: this._format,
      palette: this._palette,
      paletteOffset: this._paletteOffset,
      reserveTransparency: false  // Preserve user palette as-is
    });
  }

  async toTexture() {
    const textureConfig = {
      sourceImage: this.filename,
      format: this._format,
      width: this.width,
      height: this.height
    };
    
    if (this._palette) {
      textureConfig.palette = 'auto'; // Or palette filename
    }
    
    if (this._paletteOffset > 0) {
      textureConfig.paletteOffset = this._paletteOffset;
    }
    
    // Add any metadata
    Object.assign(textureConfig, this.metadata.textureConfig || {});
    
    return new TextEncoder().encode(JSON.stringify(textureConfig, null, 2));
  }

  /**
   * Get ImageData with proper caching and palette offset support
   * Re-renders if dirty or palette offset changed
   */
  toImageData(paletteOffset = null) {
    const frame = this.getCurrentFrame();
    if (!frame) {
      throw new Error('No frame data available');
    }
    
    // Use provided offset or default
    const renderOffset = paletteOffset !== null ? paletteOffset : this._paletteOffset;
    const cacheKey = `frame_${this.currentFrame}_offset_${renderOffset}`;
    
    // Check if we need to re-render
    const needsRender = this._isDirty || 
                       this._lastRenderOffset !== renderOffset || 
                       !this._renderCache.has(cacheKey);
    
    if (needsRender) {
      console.log(`[RetroImage] Rendering frame ${this.currentFrame} with palette offset ${renderOffset}`);
      
      const data = new Uint8ClampedArray(frame.width * frame.height * 4);
      
      // Apply palette offset if we have a palette
      let effectiveColors = frame.colors;
      if (this._palette && renderOffset > 0) {
        effectiveColors = frame.colors.map(color => {
          // For indexed colors, we could remap here, but since frame.colors 
          // are already RGB, we just use them as-is
          return color;
        });
      }
      
      for (let i = 0; i < effectiveColors.length; i++) {
        const color = effectiveColors[i];
        const offset = i * 4;
        data[offset] = color.r;
        data[offset + 1] = color.g;
        data[offset + 2] = color.b;
        data[offset + 3] = color.a;
      }
      
      const imageData = new ImageData(data, frame.width, frame.height);
      this._renderCache.set(cacheKey, imageData);
      this._isDirty = false;
      this._lastRenderOffset = renderOffset;
      
      return imageData;
    }
    
    // Return cached version
    return this._renderCache.get(cacheKey);
  }

  toCanvas() {
    const imageData = this.toImageData();
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    
    return canvas;
  }

  // =============================================================================
  // FRAME MANAGEMENT
  // =============================================================================
  
  getCurrentFrame() {
    return this.frames[this.currentFrame] || null;
  }

  setCurrentFrame(index) {
    if (index >= 0 && index < this.frames.length) {
      this.currentFrame = index;
      return true;
    }
    return false;
  }

  getFrame(index) {
    return this.frames[index] || null;
  }

  // =============================================================================
  // PRIVATE HELPER METHODS
  // =============================================================================
  
  // Convert an RGBA byte array to a frame object with color array
  _rgbaDataToFrame(rgbaData, width, height) {
    const colors = [];
    for (let i = 0; i < rgbaData.length; i += 4) {
      colors.push({
        r: rgbaData[i],
        g: rgbaData[i + 1], 
        b: rgbaData[i + 2],
        a: rgbaData[i + 3]
      });
    }
    
    return {
      width: width,
      height: height,
      colors: colors
    };
  }
  
  async _fetchFile(url) {
    const response = await fetch(url);
    return await response.arrayBuffer();
  }

  async _readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  async _loadFromContent(content) {
    if (this._isD2Format(content)) {
      await this.loadFromD2(content);
    } else {
      // Assume it's an image file - convert to image element
      const img = await this._contentToImageElement(content);
      this.loadFromImageElement(img);
    }
  }

  async _contentToImageElement(content) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      
      if (content instanceof ArrayBuffer) {
        const blob = new Blob([content]);
        const url = URL.createObjectURL(blob);
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img);
        };
        img.src = url;
      } else if (typeof content === 'string') {
        img.src = content;
      } else {
        reject(new Error('Unsupported content type'));
      }
    });
  }

  _isD2Format(arrayBuffer) {
    if (arrayBuffer.byteLength < 8) return false; // Minimum size for D2 header
    const view = new DataView(arrayBuffer);
    
    // Check for "D2" magic identifier (2 bytes)
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1));
    return magic === 'D2';
  }

  _imageDataToFrame(imageData) {
    const colors = [];
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      colors.push({
        r: data[i],
        g: data[i + 1],
        b: data[i + 2],
        a: data[i + 3],
        alpha: data[i + 3] / 255
      });
    }
    
    return {
      width: imageData.width,
      height: imageData.height,
      colors: colors,
      timestamp: Date.now()
    };
  }

  async _loadPaletteFile(palettePath) {
    const paletteData = await this._fetchFile(palettePath);
    return this._parsePaletteData(paletteData);
  }

  async _parsePaletteData(paletteData) {
    if (this.paletteManager) {
      this._palette = await this.paletteManager.parsePaletteContent(paletteData);
    } else {
      throw new Error('PaletteManager not available');
    }
  }

  // =============================================================================
  // UTILITY
  // =============================================================================
  
  clone() {
    const newImage = new RetroImage();
    newImage.frames = this.frames.map(frame => ({
      ...frame,
      colors: [...frame.colors]
    }));
    newImage.currentFrame = this.currentFrame;
    newImage._width = this._width;
    newImage._height = this._height;
    newImage.filename = this.filename;
    newImage.metadata = { ...this.metadata };
    newImage._format = this._format;
    newImage._palette = this._palette ? [...this._palette] : null;
    newImage._paletteOffset = this._paletteOffset;
    return newImage;
  }

  // =============================================================================
  // FORMAT ANALYSIS
  // =============================================================================
  
  _analyzeImageFormat(imageData) {
    try {
      console.log('[RetroImage] Analyzing image colors...');
      
      const data = imageData.data;
      const colorSet = new Set();
      let hasAlpha = false;
      
      // Sample colors (for performance, sample every 4th pixel for large images)
      const totalPixels = imageData.width * imageData.height;
      const sampleRate = Math.max(1, Math.floor(totalPixels / 10000));
      
      for (let i = 0; i < data.length; i += 4 * sampleRate) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        
        if (a < 255) hasAlpha = true;
        
        // Create color key
        const colorKey = `${r},${g},${b}`;
        colorSet.add(colorKey);
        
        // Stop if we've found too many colors for indexed modes
        if (colorSet.size > 256) break;
      }
      
      const colorCount = colorSet.size;
      console.log('[RetroImage] Image analysis: colors=' + colorCount + ', hasAlpha=' + hasAlpha);
      
      let suggestedFormat;
      
      if (colorCount <= 2) {
        suggestedFormat = 'd2_mode_i1';
      } else if (colorCount <= 4) {
        suggestedFormat = 'd2_mode_i2';
      } else if (colorCount <= 16) {
        suggestedFormat = hasAlpha ? 'd2_mode_ai44' : 'd2_mode_i4';
      } else if (colorCount <= 256) {
        suggestedFormat = 'd2_mode_i8';
      } else {
        // Many colors - use RGB format
        if (hasAlpha) {
          suggestedFormat = 'd2_mode_argb8888';
        } else {
          suggestedFormat = 'd2_mode_rgb565';
        }
      }
      
      console.log('[RetroImage] Suggested format:', suggestedFormat);
      return suggestedFormat;
      
    } catch (error) {
      console.error('[RetroImage] Error analyzing image:', error);
      // Fall back to 32-bit color if analysis fails
      return 'd2_mode_argb8888';
    }
  }

  // =============================================================================
  // PRIVATE HELPER METHODS FOR PALETTE OPERATIONS
  // =============================================================================
  
  _markDirty() {
    this._isDirty = true;
    this._renderCache.clear(); // Clear all cached renders
  }
  
  _calculateColorDistance(color1, color2, method = 'euclidean') {
    if (method === 'dei') {
      // Delta E (CIE76) calculation - simplified version
      const dr = color1.r - color2.r;
      const dg = color1.g - color2.g;
      const db = color1.b - color2.b;
      const distance = Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
      return distance;
    } else if (method === 'weighted') {
      // Weighted RGB distance (human eye perception)
      const dr = color1.r - color2.r;
      const dg = color1.g - color2.g;
      const db = color1.b - color2.b;
      const distance = Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
      return distance;
    } else {
      // Euclidean RGB distance
      const dr = color1.r - color2.r;
      const dg = color1.g - color2.g;
      const db = color1.b - color2.b;
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);
      return distance;
    }
  }
  
  _extractUniqueColors(frame) {
    const colorMap = new Map();
    
    frame.colors.forEach(color => {
      if (color.a >= 128) { // Skip mostly transparent pixels
        const key = `${color.r},${color.g},${color.b}`;
        const existing = colorMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          colorMap.set(key, { 
            color: { r: color.r, g: color.g, b: color.b, a: color.a }, 
            count: 1 
          });
        }
      }
    });
    
    return Array.from(colorMap.values());
  }
  
  _updateProgress(target, percentage) {
    if (target && target.style) {
      target.style.width = Math.round(percentage) + '%';
    }
  }
  
  async _yieldToEventLoop() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  toString() {
    return `RetroImage(${this.filename}, ${this.width}x${this.height}, ${this.frameCount} frame(s), format: ${this._format || 'none'})`;
  }
}

// Export the class
if (typeof window !== 'undefined') {
  window.RetroImage = RetroImage;
}
