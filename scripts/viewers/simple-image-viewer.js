/**
 * SimpleImageViewer - Canvas-based image viewer with animation support
 * Uses ImageProcessor library for handling static and animated images
 */

class SimpleImageViewer extends ViewerBase {
  constructor(pathOrFileObj, fullPath = null) {
    // Handle different constructor signatures:
    // 1. SimpleImageViewer(path) - for preview tabs
    // 2. SimpleImageViewer(fileObj, fullPath) - for dedicated tabs from TabManager
    let actualPath;
    let fileData = null;
    
    if (typeof pathOrFileObj === 'string') {
      // Called with just path (preview tabs)
      actualPath = pathOrFileObj;
    } else if (pathOrFileObj && typeof pathOrFileObj === 'object' && fullPath) {
      // Called with fileObj and fullPath (dedicated tabs)
      actualPath = fullPath;
      fileData = pathOrFileObj;
    } else {
      console.error('[SimpleImageViewer] Invalid constructor arguments:', pathOrFileObj, fullPath);
      actualPath = pathOrFileObj; // fallback
    }
    
    super(actualPath);
    
    this.canvas = null;
    this.ctx = null;
    this.processedImage = null;
    this.imageProcessor = new ImageProcessor();
    this.zoom = 1.0;
    this.userManuallySetZoom = false; // Track if user has manually adjusted zoom
    this.animationFrameId = null;
    this.preloadedFileData = fileData; // Store for use in loadImageFromPath
    this.shouldBeAnimating = false; // Track intended animation state regardless of focus
    
    console.log('[SimpleImageViewer] Constructor completed for path:', actualPath, 'with preloaded data:', !!fileData);
  }

  createBody(bodyContainer) {
    console.log('[SimpleImageViewer] createBody() called with container:', bodyContainer);
    
    // Create canvas-based viewer
    bodyContainer.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%; background: #2d2d2d;">
        <!-- Toolbar -->
        <div style="background: #3d3d3d; padding: 8px; border-bottom: 1px solid #555; display: flex; gap: 10px; align-items: center;">
          <label style="color: #fff; font-size: 12px;">Zoom:</label>
          <input type="range" id="zoomSlider" min="0.1" max="8" step="0.1" value="1" style="width: 150px;">
          <span id="zoomDisplay" style="color: #ccc; font-size: 12px; min-width: 50px;">100%</span>
          <button id="fitToWindowBtn" style="padding: 4px 8px; background: #555; color: #fff; border: none; border-radius: 3px; font-size: 11px;">Fit to Window</button>
          
          <!-- Animation Controls -->
          <div id="animationControls" style="display: none; margin-left: 20px; gap: 10px; align-items: center;">
            <button id="playPauseBtn" style="padding: 4px 8px; background: #555; color: #fff; border: none; border-radius: 3px; min-width: 60px;">⏸️ Pause</button>
            <label style="color: #fff; font-size: 12px;">Frame:</label>
            <input type="range" id="frameSlider" min="0" max="0" step="1" value="0" style="width: 200px;">
            <span id="frameDisplay" style="color: #ccc; font-size: 12px; min-width: 60px;">1 / 1</span>
          </div>
          
        </div>
        
        <!-- Canvas Container -->
        <div style="flex: 1; overflow: auto; background: #1a1a1a; position: relative; display: flex; align-items: center; justify-content: center;">
          <canvas id="imageCanvas" style="border: 1px solid #555; background: #fff;"></canvas>
        </div>
        
        <!-- Status Bar -->
        <div style="background: #3d3d3d; padding: 4px 8px; border-top: 1px solid #555; color: #ccc; font-size: 11px;">
          <span id="imageInfo">Loading image...</span>
        </div>
      </div>
    `;

    this.canvas = bodyContainer.querySelector('#imageCanvas');
    this.ctx = this.canvas.getContext('2d');
    
    console.log('[SimpleImageViewer] Canvas setup - Canvas found:', !!this.canvas);
    console.log('[SimpleImageViewer] Canvas setup - Context created:', !!this.ctx);
    console.log('[SimpleImageViewer] Canvas element:', this.canvas);
    
    // Disable all image smoothing/anti-aliasing for pixel-perfect rendering
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.webkitImageSmoothingEnabled = false;
    this.ctx.mozImageSmoothingEnabled = false;
    this.ctx.msImageSmoothingEnabled = false;
    this.ctx.oImageSmoothingEnabled = false;
    
    // Set CSS for crisp pixel rendering
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.style.imageRendering = '-moz-crisp-edges';
    this.canvas.style.imageRendering = '-webkit-crisp-edges';
    this.canvas.style.imageRendering = 'crisp-edges';
    
    this.setupEventListeners(bodyContainer);
    
    // Load the image immediately since we have the path
    this.loadImageFromPath();
  }

  setupEventListeners(container) {
    const zoomSlider = container.querySelector('#zoomSlider');
    const fitToWindowBtn = container.querySelector('#fitToWindowBtn');
    const playPauseBtn = container.querySelector('#playPauseBtn');
    const frameSlider = container.querySelector('#frameSlider');
    
    zoomSlider.addEventListener('input', (e) => {
      this.setZoom(parseFloat(e.target.value));
    });

    fitToWindowBtn.addEventListener('click', () => {
      this.fitToContainer();
      this.redrawCanvas();
    });

    playPauseBtn.addEventListener('click', () => {
      if (!playPauseBtn.disabled) {
        this.toggleAnimation();
      }
    });

    frameSlider.addEventListener('input', (e) => {
      if (!frameSlider.disabled) {
        this.setCurrentFrame(parseInt(e.target.value));
      }
    });

    // Add trackpad/mouse wheel support for zoom and scroll
    const canvasContainer = container.querySelector('#imageCanvas').parentElement;
    
    canvasContainer.addEventListener('wheel', (e) => {
      e.preventDefault(); // Prevent default scroll behavior
      
      if (e.ctrlKey || e.metaKey) {
        // Pinch-to-zoom (Ctrl+scroll or Cmd+scroll on Mac)
        const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
        const newZoom = this.zoom + zoomDelta;
        this.setZoom(newZoom);
      } else {
        // Normal scroll - let the container handle it naturally
        // Remove preventDefault for this case so scrolling works
        e.preventDefault();
        
        // Manual scroll handling
        const scrollDelta = e.deltaY;
        canvasContainer.scrollTop += scrollDelta;
        
        // Handle horizontal scroll if shift is held
        if (e.shiftKey) {
          canvasContainer.scrollLeft += e.deltaX || scrollDelta;
        } else {
          canvasContainer.scrollLeft += e.deltaX;
        }
      }
    }, { passive: false });

    // Add support for trackpad gestures (if supported)
    canvasContainer.addEventListener('gesturestart', (e) => {
      e.preventDefault();
      this.initialZoom = this.zoom;
    });
    
    canvasContainer.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      if (this.initialZoom) {
        const newZoom = this.initialZoom * e.scale;
        this.setZoom(newZoom);
      }
    });
    
    canvasContainer.addEventListener('gestureend', (e) => {
      e.preventDefault();
      this.initialZoom = null;
    });

    // Add resize listener to re-fit image when container size changes
    this.resizeHandler = () => {
      if (this.processedImage && !this.userManuallySetZoom) {
        // Only auto-fit on resize if user hasn't manually adjusted zoom
        // Small delay to ensure layout has settled
        setTimeout(() => {
          this.fitToContainer();
          this.redrawCanvas();
        }, 100);
      } else if (this.processedImage) {
        // Just redraw at current zoom if user has manually set zoom
        setTimeout(() => {
          this.redrawCanvas();
        }, 100);
      }
    };
    
    window.addEventListener('resize', this.resizeHandler);
  }

  setZoom(newZoom) {
    this.zoom = Math.max(0.1, Math.min(8, newZoom));
    this.userManuallySetZoom = true; // Mark that user has manually adjusted zoom
    this.updateZoomDisplay();
    this.redrawCanvas();
  }

  fitToContainer() {
    if (!this.processedImage || !this.canvas) return;
    
    // Get the canvas container dimensions
    const canvasContainer = this.canvas.parentElement;
    if (!canvasContainer) return;
    
    const containerRect = canvasContainer.getBoundingClientRect();
    
    // Account for padding and borders (leave some margin)
    const availableWidth = containerRect.width - 40; // 20px margin on each side
    const availableHeight = containerRect.height - 40; // 20px margin on top and bottom
    
    // Calculate scale to fit both width and height while maintaining aspect ratio
    const scaleX = availableWidth / this.processedImage.width;
    const scaleY = availableHeight / this.processedImage.height;
    
    // Use the smaller scale to ensure the image fits completely
    const fitScale = Math.min(scaleX, scaleY); // Allow scaling up to fit the container
    
    console.log('[SimpleImageViewer] Container size:', availableWidth, 'x', availableHeight);
    console.log('[SimpleImageViewer] Image size:', this.processedImage.width, 'x', this.processedImage.height);
    console.log('[SimpleImageViewer] Calculated fit scale:', fitScale);
    
    // Set the zoom to the calculated fit scale (clamp to valid zoom range)
    this.zoom = Math.max(0.1, Math.min(8, fitScale));
    this.userManuallySetZoom = false; // Reset manual flag since this is an automatic fit
    this.updateZoomDisplay();
  }

  toggleAnimation() {
    if (!this.processedImage || !this.processedImage.isAnimated) return;
    
    if (this.shouldBeAnimating) {
      // User wants to stop animation
      this.shouldBeAnimating = false;
      this.processedImage.stopAnimation();
      this.stopAnimationLoop();
    } else {
      // User wants to start animation
      this.shouldBeAnimating = true;
      this.processedImage.startAnimation();
      this.startAnimationLoop();
    }
    
    this.updateAnimationControls();
  }

  setCurrentFrame(frameIndex) {
    if (!this.processedImage || !this.processedImage.isAnimated) return;
    
    // Pause animation when manually setting frame
    if (this.shouldBeAnimating) {
      this.shouldBeAnimating = false;
      this.processedImage.stopAnimation();
      this.stopAnimationLoop();
    }
    
    // Set the frame
    this.processedImage.currentFrameIndex = Math.max(0, Math.min(frameIndex, this.processedImage.frameCount - 1));
    
    // Update UI and redraw
    this.updateAnimationControls();
    this.redrawCanvas();
  }

  startAnimationLoop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    console.log('[SimpleImageViewer] Starting animation loop');

    const animate = () => {
      if (this.processedImage && this.processedImage.isPlaying) {
        const frameChanged = this.processedImage.updateAnimation();
        console.log('[SimpleImageViewer] Animation tick - frame changed:', frameChanged, 'current frame:', this.processedImage.currentFrameIndex);
        if (frameChanged) {
          this.redrawCanvas();
          this.updateAnimationControls(); // Update frame slider and display
        }
        this.animationFrameId = requestAnimationFrame(animate);
      } else {
        console.log('[SimpleImageViewer] Animation loop stopped - playing:', this.processedImage?.isPlaying);
      }
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  stopAnimationLoop(alsoStopProcessedImage = true) {
    if (this.animationFrameId) {
      console.log('[SimpleImageViewer] Stopping animation loop, frame ID:', this.animationFrameId);
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    } else {
      console.log('[SimpleImageViewer] No animation loop to stop');
    }
    
    // Only stop the processed image animation if explicitly requested
    // (not when just pausing due to focus loss)
    if (alsoStopProcessedImage && this.processedImage) {
      this.processedImage.stopAnimation();
      console.log('[SimpleImageViewer] Stopped processedImage animation, isPlaying:', this.processedImage.isPlaying);
    }
  }

  updateZoomDisplay() {
    if (!this.element) return;
    
    const zoomDisplay = this.element.querySelector('#zoomDisplay');
    const zoomSlider = this.element.querySelector('#zoomSlider');
    
    if (zoomDisplay) {
      zoomDisplay.textContent = Math.round(this.zoom * 100) + '%';
    }
    if (zoomSlider) {
      zoomSlider.value = this.zoom;
    }
  }

  async loadImageFromPath() {
    console.log('[SimpleImageViewer] loadImageFromPath() called with path:', this.path);
    
    // Critical: Immediately stop any existing animation when loading a new image
    this._performCleanup();
    
    try {
      let fileData;
      
      // Use preloaded file data if available (from dedicated tab creation)
      if (this.preloadedFileData) {
        console.log('[SimpleImageViewer] Using preloaded file data');
        fileData = this.preloadedFileData;
        this.preloadedFileData = null; // Clear it after use
      } else {
        // Load file data from storage (for preview tabs)
        console.log('[SimpleImageViewer] Loading file data from storage');
        const serviceContainer = window.serviceContainer;
        const fileManager = serviceContainer.get('fileManager');
        
        if (!fileManager) {
          throw new Error('FileManager not available');
        }

        // Load the file data using the path
        fileData = await fileManager.loadFile(this.path);
        console.log('[SimpleImageViewer] File data loaded:', fileData);
      }

      if (!fileData || !fileData.fileContent) {
        throw new Error('No file content available');
      }

      // Load the image using ImageProcessor
      await this.loadImageData(fileData);
      
    } catch (error) {
      console.error('[SimpleImageViewer] Error loading image from path:', error);
      this.showError('Error loading image: ' + error.message);
    }
  }

  async loadImageData(fileData) {
    console.log('[SimpleImageViewer] loadImageData() called');
    console.log('[SimpleImageViewer] File is binary:', fileData.binaryData);
    console.log('[SimpleImageViewer] Content length:', fileData.fileContent.length);

    try {
      // Create data URL
      let dataUrl;
      if (fileData.binaryData) {
        const mimeType = this.getMimeTypeFromFilename(fileData.filename);
        dataUrl = `data:${mimeType};base64,${fileData.fileContent}`;
      } else {
        dataUrl = fileData.fileContent;
      }

      console.log('[SimpleImageViewer] Created data URL, length:', dataUrl.length);

      // Process the image using ImageProcessor
      const mimeType = this.getMimeTypeFromFilename(fileData.filename);
      console.log('[SimpleImageViewer] About to process image with mimeType:', mimeType);
      
      this.processedImage = await this.imageProcessor.processImage(dataUrl, mimeType);
      
      console.log('[SimpleImageViewer] Image processed successfully!');
      console.log('[SimpleImageViewer] Image dimensions:', this.processedImage.width, 'x', this.processedImage.height);
      console.log('[SimpleImageViewer] Is animated:', this.processedImage.isAnimated);
      console.log('[SimpleImageViewer] Frame count:', this.processedImage.frameCount);
      console.log('[SimpleImageViewer] First frame:', this.processedImage.getCurrentFrame());
      
      // Reset animation state for new image
      this.processedImage.currentFrameIndex = 0;
      this.processedImage.isPlaying = false;
      this.processedImage.animationStartTime = 0;
      this.shouldBeAnimating = false; // Reset our tracking state
      
      // Update UI
      this.updateImageInfo();
      this.updateAnimationControls();
      
      // Calculate and set initial zoom to fit container
      this.fitToContainer();
      
      this.redrawCanvas();
      
      // Auto-start animation ONLY for animated GIFs with multiple frames
      if (this.processedImage.isAnimated && this.processedImage.frameCount > 1) {
        this.shouldBeAnimating = true; // Mark that it should be animating
        this.processedImage.startAnimation();
        this.startAnimationLoop();
      }
      
    } catch (error) {
      console.error('[SimpleImageViewer] Error processing image:', error);
      this.showError('Error processing image: ' + error.message);
    }
  }

  updateAnimationControls() {
    if (!this.element) return;
    
    const animationControls = this.element.querySelector('#animationControls');
    const playPauseBtn = this.element.querySelector('#playPauseBtn');
    const frameSlider = this.element.querySelector('#frameSlider');
    const frameDisplay = this.element.querySelector('#frameDisplay');
    
    console.log('[SimpleImageViewer] updateAnimationControls - isAnimated:', this.processedImage?.isAnimated, 'frameCount:', this.processedImage?.frameCount);
    
    if (this.processedImage && this.processedImage.frameCount >= 1) {
      // Show animation controls for all images (static and animated)
      animationControls.style.display = 'flex';
      
      // Update frame slider
      frameSlider.max = Math.max(0, this.processedImage.frameCount - 1);
      frameSlider.value = this.processedImage.currentFrameIndex;
      
      // Update frame display
      frameDisplay.textContent = `${this.processedImage.currentFrameIndex + 1} / ${this.processedImage.frameCount}`;
      
      if (this.processedImage.isAnimated && this.processedImage.frameCount > 1) {
        // Enable play/pause for animated images with multiple frames
        playPauseBtn.disabled = false;
        playPauseBtn.style.opacity = '1';
        frameSlider.disabled = false;
        frameSlider.style.opacity = '1';
        
        // Update play/pause button
        if (this.shouldBeAnimating) {
          playPauseBtn.textContent = '⏸️ Pause';
          playPauseBtn.style.background = '#555';
        } else {
          playPauseBtn.textContent = '▶️ Play';
          playPauseBtn.style.background = '#0066cc';
        }
        
        console.log('[SimpleImageViewer] Animation controls enabled - frameCount:', this.processedImage.frameCount);
        
      } else {
        // Disable play/pause for static images
        playPauseBtn.disabled = true;
        playPauseBtn.style.opacity = '0.5';
        playPauseBtn.textContent = '▶️ Play';
        playPauseBtn.style.background = '#333';
        
        frameSlider.disabled = true;
        frameSlider.style.opacity = '0.5';
        
        console.log('[SimpleImageViewer] Animation controls disabled - static image');
      }
      
    } else {
      // Hide animation controls if no processed image
      animationControls.style.display = 'none';
      console.log('[SimpleImageViewer] Animation controls hidden - no image');
    }
  }

  redrawCanvas() {
    console.log('[SimpleImageViewer] redrawCanvas() called');
    console.log('[SimpleImageViewer] Canvas available:', !!this.canvas);
    console.log('[SimpleImageViewer] Context available:', !!this.ctx);
    console.log('[SimpleImageViewer] ProcessedImage available:', !!this.processedImage);
    
    if (!this.canvas || !this.ctx || !this.processedImage) {
      console.log('[SimpleImageViewer] Cannot redraw - missing canvas, context, or image');
      
      // Try to re-find canvas if missing
      if (!this.canvas && this.element) {
        console.log('[SimpleImageViewer] Attempting to re-find canvas...');
        this.canvas = this.element.querySelector('#imageCanvas');
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        if (this.ctx) {
          this.ctx.imageSmoothingEnabled = false;
        }
        console.log('[SimpleImageViewer] Re-found canvas:', !!this.canvas, 'context:', !!this.ctx);
      }
      
      if (!this.canvas || !this.ctx || !this.processedImage) {
        return;
      }
    }

    const currentFrame = this.processedImage.getCurrentFrame();
    if (!currentFrame || !currentFrame.image) {
      console.log('[SimpleImageViewer] No current frame available');
      return;
    }

    // Calculate display dimensions
    const displayWidth = Math.round(this.processedImage.width * this.zoom);
    const displayHeight = Math.round(this.processedImage.height * this.zoom);
    
    // Set canvas size
    this.canvas.width = displayWidth;
    this.canvas.height = displayHeight;
    
    // Re-apply anti-aliasing settings after canvas resize
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.webkitImageSmoothingEnabled = false;
    this.ctx.mozImageSmoothingEnabled = false;
    this.ctx.msImageSmoothingEnabled = false;
    this.ctx.oImageSmoothingEnabled = false;
    
    // Clear and draw
    this.ctx.clearRect(0, 0, displayWidth, displayHeight);
    this.ctx.drawImage(currentFrame.image, 0, 0, displayWidth, displayHeight);
    
    // Only log frame info for animated images
    if (this.processedImage.isAnimated) {
      console.log('[SimpleImageViewer] Canvas redrawn:', displayWidth, 'x', displayHeight, 'frame:', this.processedImage.currentFrame);
    } else {
      console.log('[SimpleImageViewer] Canvas redrawn:', displayWidth, 'x', displayHeight, '(static image)');
    }
  }

  getMimeTypeFromFilename(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes = {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'bmp': 'image/bmp',
      'webp': 'image/webp'
    };
    return mimeTypes[ext] || 'image/png';
  }

  updateImageInfo() {
    if (!this.element || !this.processedImage) return;
    
    const imageInfo = this.element.querySelector('#imageInfo');
    if (imageInfo) {
      const frameText = this.processedImage.isAnimated ? 
        ` (${this.processedImage.frameCount} frames)` : '';
      imageInfo.textContent = `${this.processedImage.width} × ${this.processedImage.height}${frameText}`;
    }
  }

  showError(message) {
    if (!this.element) return;
    
    const imageInfo = this.element.querySelector('#imageInfo');
    if (imageInfo) {
      imageInfo.textContent = message;
      imageInfo.style.color = '#ff6b6b';
    }
  }

  // Cleanup when viewer is destroyed or replaced
  cleanup() {
    console.log('[SimpleImageViewer] cleanup() called');
    this._performCleanup();
  }

  destroy() {
    console.log('[SimpleImageViewer] destroy() called');
    this._performCleanup();
    super.destroy && super.destroy();
  }

  // Called when tab is closed
  close() {
    console.log('[SimpleImageViewer] close() called');
    this._performCleanup();
    return true; // Allow close
  }

  // Internal cleanup method
  _performCleanup() {
    console.log('[SimpleImageViewer] _performCleanup() - stopping animation and clearing resources');
    
    // Reset animation tracking state
    this.shouldBeAnimating = false;
    
    // Stop animation loop immediately
    this.stopAnimationLoop();
    
    // Stop and clear processed image
    if (this.processedImage) {
      this.processedImage.stopAnimation();
      this.processedImage = null;
    }
    
    // Clear image processor cache
    if (this.imageProcessor) {
      this.imageProcessor.cache.clear();
    }
    
    // Remove resize listener
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    
    // Clear canvas references
    this.canvas = null;
    this.ctx = null;
  }

  // Called when tab gains focus
  onFocus() {
    console.log('[SimpleImageViewer] onFocus() called - resuming animation if needed');
    console.log('[SimpleImageViewer] shouldBeAnimating:', this.shouldBeAnimating, 'isAnimated:', this.processedImage?.isAnimated);
    
    if (this.processedImage && this.processedImage.isAnimated && this.processedImage.frameCount > 1) {
      // Resume animation if it should be animating
      if (this.shouldBeAnimating) {
        console.log('[SimpleImageViewer] Restarting animation on focus');
        this.processedImage.startAnimation();
        this.startAnimationLoop();
      }
    }
  }

  // Called when tab loses focus
  onBlur() {
    console.log('[SimpleImageViewer] onBlur() called - pausing animation');
    // Just stop the animation loop, but preserve the shouldBeAnimating state
    // so we can resume when focus is regained
    this.stopAnimationLoop(false); // Don't stop ProcessedImage, just the loop
  }

  // Alternative method name that TabManager also checks for
  loseFocus() {
    this.onBlur();
  }
}

// Static method to define supported file extensions
SimpleImageViewer.getFileExtensions = () => ['.png', '.gif', '.jpg', '.jpeg', '.bmp', '.webp'];

// Auto-register the viewer
if (typeof ComponentRegistry !== 'undefined') {
  SimpleImageViewer.registerComponent();
}
