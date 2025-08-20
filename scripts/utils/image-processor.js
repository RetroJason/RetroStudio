/**
 * Image Processing Library
 * Handles image loading, GIF frame extraction, and animation
 */

class ImageProcessor {
  constructor() {
    this.cache = new Map(); // Cache for processed images
  }

  /**
   * Load and process an image from various sources
   * @param {string|ArrayBuffer|Uint8Array} source - Image source
   * @param {string} mimeType - MIME type of the image
   * @returns {Promise<ProcessedImage>}
   */
  async processImage(source, mimeType = 'image/png') {
    console.log('[ImageProcessor] Processing image, type:', mimeType);
    
    // Check cache first
    const cacheKey = this.getCacheKey(source, mimeType);
    if (this.cache.has(cacheKey)) {
      console.log('[ImageProcessor] Returning cached image');
      return this.cache.get(cacheKey);
    }

    let imageData;
    
    if (typeof source === 'string') {
      // Data URL or base64
      imageData = source;
    } else {
      // Binary data - convert to data URL
      const base64 = this.arrayBufferToBase64(source);
      imageData = `data:${mimeType};base64,${base64}`;
    }

    const processedImage = await this.createProcessedImage(imageData, mimeType);
    
    // Cache the result
    this.cache.set(cacheKey, processedImage);
    
    return processedImage;
  }

  /**
   * Create a ProcessedImage object
   */
  async createProcessedImage(dataUrl, mimeType) {
    const isGif = mimeType === 'image/gif';
    
    if (isGif) {
      return await this.processGif(dataUrl);
    } else {
      return await this.processStaticImage(dataUrl);
    }
  }

  /**
   * Process a static image
   */
  async processStaticImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => {
        const frameInfo = {
          image: img,
          delay: 0,
          frameIndex: 0
        };
        
        const processedImage = new ProcessedImage({
          width: img.width,
          height: img.height,
          frames: [frameInfo],
          isAnimated: false,
          frameCount: 1,
          loopCount: 0
        });
        
        resolve(processedImage);
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = dataUrl;
    });
  }

  /**
   * Process an animated GIF and extract frames
   */
  async processGif(dataUrl) {
    try {
      // Convert data URL to ArrayBuffer for GIF parsing
      const response = await fetch(dataUrl);
      const arrayBuffer = await response.arrayBuffer();
      
      // Parse GIF structure
      const gifData = this.parseGifStructure(arrayBuffer);
      
      if (gifData.frames.length <= 1) {
        // Static GIF - treat as regular image
        return await this.processStaticImage(dataUrl);
      }
      
      // Extract actual frame images
      const frameImages = await this.extractGifFrameImages(arrayBuffer, gifData, dataUrl);
      
      return new ProcessedImage({
        width: gifData.width,
        height: gifData.height,
        frames: frameImages,
        isAnimated: true,
        frameCount: frameImages.length,
        loopCount: gifData.loopCount || 0
      });
      
    } catch (error) {
      console.error('[ImageProcessor] Failed to process GIF:', error);
      // Fallback to static image processing
      return await this.processStaticImage(dataUrl);
    }
  }

  /**
   * Parse GIF file structure to get frame information
   */
  parseGifStructure(arrayBuffer) {
    const data = new Uint8Array(arrayBuffer);
    const result = {
      width: 0,
      height: 0,
      frames: [],
      loopCount: 0,
      globalColorTable: null,
      backgroundColorIndex: 0
    };

    // Check GIF signature
    const signature = String.fromCharCode(...data.slice(0, 6));
    if (signature !== 'GIF87a' && signature !== 'GIF89a') {
      throw new Error('Invalid GIF file');
    }

    // Read logical screen descriptor
    result.width = data[6] | (data[7] << 8);
    result.height = data[8] | (data[9] << 8);
    
    const packed = data[10];
    const globalColorTableFlag = (packed & 0x80) !== 0;
    const colorResolution = (packed & 0x70) >> 4;
    const sortFlag = (packed & 0x08) !== 0;
    const globalColorTableSize = 2 << (packed & 0x07);
    
    result.backgroundColorIndex = data[11];
    const pixelAspectRatio = data[12];
    
    let offset = 13;
    
    // Read global color table if present
    if (globalColorTableFlag) {
      result.globalColorTable = [];
      for (let i = 0; i < globalColorTableSize; i++) {
        result.globalColorTable.push({
          r: data[offset + i * 3],
          g: data[offset + i * 3 + 1],
          b: data[offset + i * 3 + 2]
        });
      }
      offset += globalColorTableSize * 3;
    }

    // Parse data stream for frames
    let currentFrame = null;
    
    while (offset < data.length) {
      const separator = data[offset];
      
      if (separator === 0x21) { // Extension
        offset = this.parseGifExtension(data, offset, result, currentFrame);
      } else if (separator === 0x2C) { // Image descriptor
        const frameInfo = this.parseGifImageDescriptor(data, offset);
        if (frameInfo) {
          currentFrame = frameInfo.frame;
          
          // Apply graphic control extension data if available
          if (result.nextFrameDelay !== undefined) {
            currentFrame.delay = result.nextFrameDelay;
            delete result.nextFrameDelay;
          }
          if (result.nextFrameDisposal !== undefined) {
            currentFrame.disposal = result.nextFrameDisposal;
            delete result.nextFrameDisposal;
          }
          if (result.nextFrameTransparent !== undefined) {
            currentFrame.transparentIndex = result.nextFrameTransparent;
            delete result.nextFrameTransparent;
          }
          
          result.frames.push(frameInfo); // Store the complete frameInfo, not just the frame
          offset = frameInfo.nextOffset;
        } else {
          break;
        }
      } else if (separator === 0x3B) { // Trailer
        break;
      } else {
        offset++;
      }
    }

    console.log('[ImageProcessor] Parsed GIF structure:', result.width, 'x', result.height, 'frames:', result.frames.length);
    
    return result;
  }

  /**
   * Parse GIF extension
   */
  parseGifExtension(data, offset, result, currentFrame) {
    const label = data[offset + 1];
    offset += 2;
    
    if (label === 0xF9) { // Graphic Control Extension
      const blockSize = data[offset];
      if (blockSize >= 4) {
        const packed = data[offset + 1];
        const disposalMethod = (packed >> 2) & 0x07;
        const userInputFlag = (packed & 0x02) !== 0;
        const transparentFlag = (packed & 0x01) !== 0;
        const delay = (data[offset + 2] | (data[offset + 3] << 8)) * 10; // Convert to milliseconds
        const transparentIndex = data[offset + 4];
        
        // Store for next frame
        result.nextFrameDelay = Math.max(delay, 20); // Minimum 20ms delay
        result.nextFrameDisposal = disposalMethod;
        result.nextFrameTransparent = transparentFlag ? transparentIndex : -1;
      }
      offset += blockSize + 1;
    } else if (label === 0xFF) { // Application Extension
      const blockSize = data[offset];
      if (blockSize === 11) {
        const appId = String.fromCharCode(...data.slice(offset + 1, offset + 9));
        if (appId === 'NETSCAPE') {
          // Skip to loop count sub-block
          offset += blockSize + 1;
          if (data[offset] === 3 && data[offset + 1] === 1) {
            result.loopCount = data[offset + 2] | (data[offset + 3] << 8);
          }
        }
      }
      offset += blockSize + 1;
    } else {
      // Skip unknown extension
      offset += data[offset] + 1;
    }
    
    // Skip remaining sub-blocks
    while (offset < data.length && data[offset] > 0) {
      offset += data[offset] + 1;
    }
    
    return offset + 1;
  }

  /**
   * Parse GIF image descriptor
   */
  parseGifImageDescriptor(data, offset) {
    if (offset + 9 >= data.length) return null;
    
    const left = data[offset + 1] | (data[offset + 2] << 8);
    const top = data[offset + 3] | (data[offset + 4] << 8);
    const width = data[offset + 5] | (data[offset + 6] << 8);
    const height = data[offset + 7] | (data[offset + 8] << 8);
    const packed = data[offset + 9];
    
    const localColorTableFlag = (packed & 0x80) !== 0;
    const interlaceFlag = (packed & 0x40) !== 0;
    const sortFlag = (packed & 0x20) !== 0;
    const localColorTableSize = localColorTableFlag ? 2 << (packed & 0x07) : 0;
    
    offset += 10;
    
    let localColorTable = null;
    // Parse local color table if present
    if (localColorTableFlag) {
      localColorTable = [];
      for (let i = 0; i < localColorTableSize; i++) {
        localColorTable.push({
          r: data[offset + i * 3],
          g: data[offset + i * 3 + 1],
          b: data[offset + i * 3 + 2]
        });
      }
      offset += localColorTableSize * 3;
    }
    
    // Store the data offset before skipping LZW minimum code size
    const dataOffset = offset;
    
    // Skip LZW minimum code size
    if (offset >= data.length) return null;
    offset++;
    
    // Skip image data sub-blocks
    while (offset < data.length && data[offset] > 0) {
      offset += data[offset] + 1;
    }
    if (offset < data.length) offset++; // Skip block terminator
    
    return {
      frame: {
        left,
        top,
        width,
        height,
        delay: 100, // Will be set by graphic control extension
        disposal: 0,
        transparentIndex: -1,
        interlaced: interlaceFlag
      },
      localColorTable: localColorTable,
      dataOffset: dataOffset,
      nextOffset: offset
    };
  }

  /**
   * Extract actual frame images from GIF
   * This properly decodes each frame from the GIF data
   */
  async extractGifFrameImages(arrayBuffer, gifData, originalDataUrl) {
    const frames = [];
    const data = new Uint8Array(arrayBuffer);
    
    // Set up global canvas for frame composition
    const globalCanvas = document.createElement('canvas');
    globalCanvas.width = gifData.width;
    globalCanvas.height = gifData.height;
    const globalCtx = globalCanvas.getContext('2d');
    
    console.log('[ImageProcessor] Starting frame extraction for', gifData.frames.length, 'frames');
    
    for (let frameIndex = 0; frameIndex < gifData.frames.length; frameIndex++) {
      const frameInfo = gifData.frames[frameIndex];
      
      try {
        // Extract frame image data
        const frameImageData = this.extractFrameImageData(data, frameInfo, gifData);
        
        // Create canvas for this frame
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = frameInfo.frame.width;
        frameCanvas.height = frameInfo.frame.height;
        const frameCtx = frameCanvas.getContext('2d');
        
        // Put the decoded image data onto the frame canvas
        frameCtx.putImageData(frameImageData, 0, 0);
        
        // Handle disposal method and composition
        if (frameIndex === 0 || frameInfo.frame.disposal === 2) {
          // First frame or clear previous - clear global canvas
          globalCtx.clearRect(0, 0, gifData.width, gifData.height);
        }
        
        // Draw this frame onto the global canvas at the correct position
        globalCtx.drawImage(frameCanvas, frameInfo.frame.left, frameInfo.frame.top);
        
        // Create final frame image from global canvas
        const finalFrameCanvas = document.createElement('canvas');
        finalFrameCanvas.width = gifData.width;
        finalFrameCanvas.height = gifData.height;
        const finalCtx = finalFrameCanvas.getContext('2d');
        finalCtx.drawImage(globalCanvas, 0, 0);
        
        // Convert to Image object
        const frameImage = new Image();
        const frameDataUrl = finalFrameCanvas.toDataURL();
        
        await new Promise((resolve, reject) => {
          frameImage.onload = resolve;
          frameImage.onerror = reject;
          frameImage.src = frameDataUrl;
        });
        
        const frameDelay = frameInfo.frame.delay || 100;
        
        frames.push({
          image: frameImage,
          delay: frameDelay,
          frameIndex: frameIndex
        });
        
        console.log('[ImageProcessor] Extracted frame', frameIndex, 'delay:', frameDelay + 'ms');
        
      } catch (error) {
        console.error('[ImageProcessor] Error extracting frame', frameIndex, ':', error);
        // Fall back to previous frame or create a blank frame
        if (frames.length > 0) {
          frames.push({
            image: frames[frames.length - 1].image,
            delay: 100,
            frameIndex: frameIndex
          });
        }
      }
    }
    
    console.log('[ImageProcessor] Extracted', frames.length, 'GIF frames');
    return frames;
  }

  /**
   * Extract image data for a specific frame from GIF data
   */
  extractFrameImageData(data, frameInfo, gifData) {
    const { frame, dataOffset } = frameInfo;
    const { width, height } = frame;
    
    // Get the color table for this frame
    const colorTable = frameInfo.localColorTable || gifData.globalColorTable;
    if (!colorTable) {
      throw new Error('No color table available for frame');
    }
    
    // Decode the LZW compressed image data
    const imageData = this.decodeLZWImageData(data, dataOffset, width, height, colorTable, frame.interlaced);
    
    return imageData;
  }

  /**
   * Decode LZW compressed image data from GIF
   */
  decodeLZWImageData(data, offset, width, height, colorTable, interlaced) {
    // Read LZW minimum code size
    const lzwMinimumCodeSize = data[offset];
    offset++;
    
    // Read the image data sub-blocks
    const compressedData = [];
    while (offset < data.length) {
      const blockSize = data[offset];
      offset++;
      
      if (blockSize === 0) break; // End of data
      
      for (let i = 0; i < blockSize; i++) {
        compressedData.push(data[offset + i]);
      }
      offset += blockSize;
    }
    
    // Decode LZW data
    const indices = this.decodeLZW(compressedData, lzwMinimumCodeSize);
    
    // Convert color indices to RGBA pixels
    const imageData = new ImageData(width, height);
    const pixels = imageData.data;
    
    for (let i = 0; i < indices.length && i < width * height; i++) {
      const colorIndex = indices[i];
      const pixelIndex = i * 4;
      
      if (colorIndex < colorTable.length) {
        const color = colorTable[colorIndex];
        pixels[pixelIndex] = color.r;     // Red
        pixels[pixelIndex + 1] = color.g; // Green
        pixels[pixelIndex + 2] = color.b; // Blue
        pixels[pixelIndex + 3] = 255;     // Alpha (opaque)
      } else {
        // Invalid color index - make it transparent
        pixels[pixelIndex] = 0;
        pixels[pixelIndex + 1] = 0;
        pixels[pixelIndex + 2] = 0;
        pixels[pixelIndex + 3] = 0;
      }
    }
    
    return imageData;
  }

  /**
   * Simple LZW decoder for GIF images
   */
  decodeLZW(compressedData, minimumCodeSize) {
    const clearCode = 1 << minimumCodeSize;
    const endCode = clearCode + 1;
    let codeSize = minimumCodeSize + 1;
    let nextCode = endCode + 1;
    
    const codeTable = [];
    const result = [];
    
    // Initialize code table
    for (let i = 0; i < clearCode; i++) {
      codeTable[i] = [i];
    }
    
    let bitBuffer = 0;
    let bitCount = 0;
    let dataIndex = 0;
    let previousCode = null;
    
    while (dataIndex < compressedData.length) {
      // Read next code
      while (bitCount < codeSize && dataIndex < compressedData.length) {
        bitBuffer |= compressedData[dataIndex] << bitCount;
        bitCount += 8;
        dataIndex++;
      }
      
      if (bitCount < codeSize) break;
      
      const code = bitBuffer & ((1 << codeSize) - 1);
      bitBuffer >>= codeSize;
      bitCount -= codeSize;
      
      if (code === clearCode) {
        // Reset table
        codeTable.length = endCode + 1;
        codeSize = minimumCodeSize + 1;
        nextCode = endCode + 1;
        previousCode = null;
        continue;
      }
      
      if (code === endCode) {
        break;
      }
      
      let sequence;
      if (code < codeTable.length) {
        sequence = codeTable[code].slice();
      } else if (code === nextCode && previousCode !== null) {
        sequence = codeTable[previousCode].slice();
        sequence.push(sequence[0]);
      } else {
        // Invalid code
        break;
      }
      
      // Add sequence to result
      result.push(...sequence);
      
      // Add new entry to code table
      if (previousCode !== null && nextCode < 4096) {
        const newSequence = codeTable[previousCode].slice();
        newSequence.push(sequence[0]);
        codeTable[nextCode] = newSequence;
        nextCode++;
        
        // Increase code size if needed
        if (nextCode >= (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      }
      
      previousCode = code;
    }
    
    return result;
  }

  /**
   * Create an Image object from a data URL
   */
  async createImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image from data URL'));
      img.src = dataUrl;
    });
  }

  /**
   * Utility functions
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  getCacheKey(source, mimeType) {
    if (typeof source === 'string') {
      return `${mimeType}:${source.substring(0, 100)}`;
    }
    return `${mimeType}:${source.byteLength}`;
  }
}

/**
 * ProcessedImage class - represents a processed image with frames
 */
class ProcessedImage {
  constructor(options) {
    this.width = options.width;
    this.height = options.height;
    this.frames = options.frames || [];
    this.isAnimated = options.isAnimated || false;
    this.frameCount = this.frames.length; // Always use actual frame count
    this.loopCount = options.loopCount || 0;
    this.currentFrameIndex = 0;
    this.animationStartTime = 0;
    this.isPlaying = false;
    
    console.log('[ProcessedImage] Created with', this.frameCount, 'frames, animated:', this.isAnimated);
  }

  /**
   * Get the current frame
   */
  getCurrentFrame() {
    if (this.frames.length === 0) return null;
    return this.frames[this.currentFrameIndex] || this.frames[0];
  }

  /**
   * Start animation
   */
  startAnimation() {
    if (!this.isAnimated || this.frames.length <= 1) return;
    
    this.isPlaying = true;
    this.animationStartTime = performance.now();
  }

  /**
   * Stop animation
   */
  stopAnimation() {
    console.log('[ProcessedImage] stopAnimation() called, was playing:', this.isPlaying);
    this.isPlaying = false;
  }

  /**
   * Update animation frame based on time
   */
  updateAnimation(currentTime = performance.now()) {
    if (!this.isPlaying || !this.isAnimated || this.frames.length <= 1) {
      // Check if this is a zombie animation call
      if (!this.isPlaying && this.isAnimated && this.frames.length > 1) {
        console.warn('[ProcessedImage] Animation called on stopped image - this should not happen!');
      }
      return false; // No update needed
    }

    const elapsed = currentTime - this.animationStartTime;
    let totalDelay = 0;
    let targetFrame = 0;

    // Find which frame should be showing
    for (let i = 0; i < this.frames.length; i++) {
      totalDelay += this.frames[i].delay;
      if (elapsed < totalDelay) {
        targetFrame = i;
        break;
      }
    }

    // Handle looping
    if (elapsed >= totalDelay) {
      if (this.loopCount === 0 || this.loopCount > 1) {
        // Reset animation
        this.animationStartTime = currentTime;
        targetFrame = 0;
      } else {
        // Stop at last frame
        targetFrame = this.frames.length - 1;
        this.stopAnimation();
      }
    }

    // Debug logging
    if (targetFrame !== this.currentFrameIndex) {
      console.log('[ProcessedImage] Frame change:', this.currentFrameIndex, '->', targetFrame, 'elapsed:', elapsed, 'totalDelay:', totalDelay);
    }

    // Update frame if changed
    if (targetFrame !== this.currentFrameIndex) {
      this.currentFrameIndex = targetFrame;
      return true; // Frame changed
    }

    return false; // No change
  }

  /**
   * Get frame at specific index
   */
  getFrame(index) {
    if (index < 0 || index >= this.frames.length) return null;
    return this.frames[index];
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ImageProcessor, ProcessedImage };
} else {
  window.ImageProcessor = ImageProcessor;
  window.ProcessedImage = ProcessedImage;
}
