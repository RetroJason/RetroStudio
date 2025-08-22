// texture-editor.js
// Editor for creating and editing texture files with compression, palettes, and processing options

console.log('[TextureEditor] Class definition loading');

/**
 * TextureData - Data structure for texture information
 */
class TextureData {
  constructor(options = {}) {
    this.width = options.width || 32;
    this.height = options.height || 32;
    this.colorDepth = options.colorDepth || 8;
    this.palette = options.palette || null;
    this.transparentColor = options.transparentColor || '#FF00FF';
    this.compressionType = options.compressionType || 'none';
    this.mipmaps = options.mipmaps || false;
    this.format = options.format || 'RGBA';
    this.name = options.name || 'texture';
    this.sourceImage = options.sourceImage || null;
    this.rotation = options.rotation || 0;
  }

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

  static getFormatOptions() {
    return [
      { value: 'RGBA', label: 'RGBA', description: 'Red, Green, Blue, Alpha' },
      { value: 'RGB', label: 'RGB', description: 'Red, Green, Blue' },
      { value: 'INDEXED', label: 'Indexed', description: 'Palette-based color' },
      { value: 'GRAYSCALE', label: 'Grayscale', description: 'Grayscale values' }
    ];
  }
}

console.log('[TextureEditor] TextureData class defined:', typeof TextureData);

class TextureEditor extends EditorBase {
  constructor(fileObject = null, readOnly = false) {
    console.log('[TextureEditor] Constructor called:', fileObject, readOnly);
    
    // Initialize properties BEFORE calling super() to prevent them from being reset
    const tempTextureData = new TextureData();
    
    super(fileObject, readOnly);
    console.log('[TextureEditor] After super()');
    
    // Now set properties after super() but preserve canvas reference
    this.textureData = tempTextureData;
    // Don't reset canvas if it was already created
    if (!this.canvas) {
      this.canvas = null;
    }
    this.ctx = this.ctx || null;
    this.previewCanvas = null;
    this.previewCtx = null;
    this.sourceImage = null;
    this.processedImageData = null;
    
    // UI elements
    this.colorDepthSelect = null;
    this.compressionCheckbox = null;
    this.paletteSelect = null;
    this.originalScaleSlider = null;
    this.processedScaleSlider = null;
    this.colorCountSelect = null;
    this.paletteDisplay = null;
    this.currentPalette = null;
    this.paletteContainer = this.paletteContainer || null;
    this.paletteOffsetSlider = null;
    this.paletteSizeSelect = null;
    
    // Setup event listeners for file system changes
    this.setupFileSystemEventListeners();
    
    console.log('[TextureEditor] Constructor completed, textureData:', this.textureData);
  }

  setupFileSystemEventListeners() {
    // Listen for file list refresh events to update palette dropdown
    this.fileListRefreshHandler = () => {
      console.log('[TextureEditor] File list refresh detected, updating palette options');
      if (this.paletteSelect) {
        this.populatePaletteOptions();
      }
    };

    // Listen for specific file events that might affect palettes
    this.paletteFileChangeHandler = (event) => {
      const detail = event.detail;
      if (detail && detail.extension && ['.pal', '.act', '.aco'].includes(detail.extension.toLowerCase())) {
        console.log(`[TextureEditor] Palette file change detected: ${detail.fileName || detail.file?.name}`);
        if (this.paletteSelect) {
          this.populatePaletteOptions();
        }
      }
    };

    // Add event listeners
    document.addEventListener('projectFileListRefresh', this.fileListRefreshHandler);
    document.addEventListener('projectFileAdded', this.paletteFileChangeHandler);
    document.addEventListener('projectFileDeleted', this.paletteFileChangeHandler);
    document.addEventListener('projectFileRenamed', this.paletteFileChangeHandler);
  }

  // Override destroy method to clean up event listeners
  destroy() {
    if (this.fileListRefreshHandler) {
      document.removeEventListener('projectFileListRefresh', this.fileListRefreshHandler);
      document.removeEventListener('projectFileAdded', this.paletteFileChangeHandler);
      document.removeEventListener('projectFileDeleted', this.paletteFileChangeHandler);
      document.removeEventListener('projectFileRenamed', this.paletteFileChangeHandler);
    }
    
    if (super.destroy) {
      super.destroy();
    }
  }

  createElement() {
    console.log('[TextureEditor] createElement() called, canvas before super:', !!this.canvas);
    const element = super.createElement();
    console.log('[TextureEditor] createElement() after super, canvas:', !!this.canvas);
    
    // After element is created, load content if needed
    if (this.isCreatingFromImage) {
      console.log('[TextureEditor] About to load source image, canvas exists:', !!this.canvas);
      // Simple: just load after the element is returned and attached
      this.loadSourceImageFromPath();
    }
    
    return element;
  }

  initializeTextureData() {
    console.log('[TextureEditor] initializeTextureData called, isNewResource:', this.isNewResource);
    if (this.isNewResource) {
      this.textureData = new TextureData({
        name: this.getFileName() || 'new_texture'
      });
      console.log('[TextureEditor] Created new texture data for new resource');
    } else {
      // Check if we're opening an image file or a texture file
      const extension = this.getFileExtension().toLowerCase();
      console.log('[TextureEditor] File extension:', extension);
      const imageExtensions = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.tga'];
      
      if (imageExtensions.includes(extension)) {
        // Opening an image file - create new texture with this as source
        const filename = this.getFileName() || 'new_texture';
        const nameWithoutExt = filename.replace(/\.[^/.]+$/, ''); // Remove extension
        this.textureData = new TextureData({
          name: nameWithoutExt || 'new_texture',
          sourceImage: this.path
        });
        this.isCreatingFromImage = true;
        this.markDirty(); // Mark as needing save since we're creating a new texture
        console.log('[TextureEditor] Created texture data for image file:', nameWithoutExt);
      } else {
        // Opening a texture file - will be loaded from file content
        this.textureData = new TextureData();
        this.isCreatingFromImage = false;
        console.log('[TextureEditor] Created texture data for texture file');
      }
    }
    console.log('[TextureEditor] textureData after initialization:', this.textureData);
  }

  getFileExtension() {
    if (!this.path) return '';
    const parts = this.path.split('.');
    return parts.length > 1 ? '.' + parts.pop().toLowerCase() : '';
  }

  getFileNameWithoutExtension() {
    if (!this.path) return '';
    const fileName = this.path.split('/').pop() || this.path.split('\\').pop() || '';
    const parts = fileName.split('.');
    return parts.length > 1 ? parts.slice(0, -1).join('.') : fileName;
  }

  createBody(bodyContainer) {
    bodyContainer.className = 'texture-editor-container';
    
    // Initialize texture data now that the UI is ready
    console.log('[TextureEditor] createBody - initializing texture data');
    this.initializeTextureData();
    console.log('[TextureEditor] createBody - texture data initialized:', this.textureData);
    
    // Create main layout - just the preview panel now
    const previewPanel = this.createPreviewPanel();
    bodyContainer.appendChild(previewPanel);
    
    // Process texture if source image data is available after DOM creation
    if (this.textureData.sourceImageData && this.previewCanvas) {
      this.processTexture();
    }
    
    // Update preview scale if source image is loaded and scale sliders are now available
    if (this.sourceImage && this.originalScaleSlider) {
      console.log('[TextureEditor] DOM ready - updating preview scale with loaded image');
      this.updatePreviewScale();
    }
    
    // Load content based on what type of file we're editing
    console.log('[TextureEditor] createBody - isCreatingFromImage:', this.isCreatingFromImage, 'isNewResource:', this.isNewResource);
    
    // Note: Image loading is handled in createElement() when DOM is ready
    if (!this.isCreatingFromImage && !this.isNewResource) {
      // Loading an existing texture file
      this.loadFileContent();
    }
    
    return bodyContainer;
  }

  async loadSourceImageFromPath() {
    if (!this.path) return;
    
    try {
      console.log('[TextureEditor] Loading source image from:', this.path);
      
      // Load the image file directly from fileManager
      const fileManager = window.serviceContainer?.get('fileManager');
      if (fileManager) {
        const fileRecord = await fileManager.loadFile(this.path);
        console.log('[TextureEditor] Loaded file record:', fileRecord);
        
        if (fileRecord && fileRecord.fileContent) {
          // Use the base64 content directly
          const dataUrl = `data:image/*;base64,${fileRecord.fileContent}`;
          await this.loadSourceImageFromDataUrl(dataUrl);
          this.processTexture();
        }
      }
    } catch (error) {
      console.error('[TextureEditor] Failed to load source image:', error);
    }
  }

  async loadImageFile(path) {
    try {
      const fileManager = window.serviceContainer?.get('fileManager');
      if (fileManager) {
        const fileRecord = await fileManager.loadFile(path);
        console.log('[TextureEditor] Loaded file record:', fileRecord);
        
        if (fileRecord && fileRecord.fileContent) {
          // Convert base64 content back to blob if needed
          if (typeof fileRecord.fileContent === 'string') {
            // Assume it's base64 encoded
            const response = await fetch(`data:image/*;base64,${fileRecord.fileContent}`);
            return await response.blob();
          } else if (fileRecord.fileContent instanceof ArrayBuffer) {
            return new Blob([fileRecord.fileContent]);
          }
        }
      }
    } catch (error) {
      console.error('[TextureEditor] Error loading image file:', error);
    }
    return null;
  }

  createPreviewPanel() {
    console.log('[TextureEditor] createPreviewPanel() called');
    const panel = document.createElement('div');
    panel.className = 'texture-preview-panel';
    
    // Main preview layout - horizontal with settings in between
    const previewContainer = document.createElement('div');
    previewContainer.className = 'preview-container-horizontal';
    
    // Original image section
    const originalSection = document.createElement('div');
    originalSection.className = 'preview-section';
    
    const originalHeader = document.createElement('div');
    originalHeader.className = 'preview-header';
    
    const originalTitle = document.createElement('h4');
    originalTitle.textContent = 'Original';
    
    const originalInfoBtn = document.createElement('button');
    originalInfoBtn.textContent = 'i';
    originalInfoBtn.className = 'info-button';
    originalInfoBtn.addEventListener('click', () => this.showImageInfo('original'));
    
    originalHeader.appendChild(originalTitle);
    originalHeader.appendChild(originalInfoBtn);
    originalSection.appendChild(originalHeader);
    
    this.canvas = document.createElement('canvas');
    console.log('[TextureEditor] Canvas created:', !!this.canvas);
    this.canvas.className = 'preview-canvas';
    this.ctx = this.canvas.getContext('2d');
    console.log('[TextureEditor] Canvas context created:', !!this.ctx);
    originalSection.appendChild(this.canvas);
    
    // Scale controls under original image
    const originalScaleContainer = document.createElement('div');
    originalScaleContainer.className = 'image-scale-controls';
    
    const originalScaleLabel = document.createElement('label');
    originalScaleLabel.textContent = 'Scale: ';
    
    this.originalScaleSlider = document.createElement('input');
    this.originalScaleSlider.type = 'range';
    this.originalScaleSlider.min = '0.1';
    this.originalScaleSlider.max = '4.0';
    this.originalScaleSlider.step = '0.1';
    this.originalScaleSlider.value = '1.0';
    this.originalScaleSlider.addEventListener('input', () => this.updatePreviewScale());
    
    const originalScaleValue = document.createElement('span');
    originalScaleValue.textContent = '1.0x';
    originalScaleValue.id = 'original-scale-value';
    
    originalScaleContainer.appendChild(originalScaleLabel);
    originalScaleContainer.appendChild(this.originalScaleSlider);
    originalScaleContainer.appendChild(originalScaleValue);
    originalSection.appendChild(originalScaleContainer);
    
    // Settings section (between images)
    const settingsSection = document.createElement('div');
    settingsSection.className = 'between-images-settings';
    
    // Palette controls row (top row)
    const paletteControlsRow = document.createElement('div');
    paletteControlsRow.className = 'palette-controls-top-row';
    
    // Palette dropdown
    const paletteDropdownContainer = document.createElement('div');
    paletteDropdownContainer.className = 'palette-dropdown-container';
    
    this.paletteSelect = document.createElement('select');
    this.paletteSelect.className = 'palette-dropdown';
    this.populatePaletteOptions();
    this.paletteSelect.addEventListener('change', () => this.onPaletteChanged());
    
    // Number of colors dropdown
    const colorsDropdownContainer = document.createElement('div');
    colorsDropdownContainer.className = 'colors-dropdown-container';
    
    const colorsLabel = document.createElement('label');
    colorsLabel.textContent = 'Number of colors';
    colorsLabel.className = 'colors-label';
    
    this.colorCountSelect = document.createElement('select');
    this.colorCountSelect.className = 'colors-dropdown';
    [2, 4, 8, 16, 256, 'True Color'].forEach(count => {
      const option = document.createElement('option');
      option.value = count;
      option.textContent = count === 'True Color' ? 'True Color' : `${count}`;
      this.colorCountSelect.appendChild(option);
    });
    this.colorCountSelect.value = 8;
    this.colorCountSelect.addEventListener('change', () => this.onColorCountChanged());
    
    // Create button
    const createButton = document.createElement('button');
    createButton.textContent = 'Create';
    createButton.className = 'create-button';
    createButton.addEventListener('click', () => this.createPaletteFromImage());
    
    paletteDropdownContainer.appendChild(this.paletteSelect);
    
    colorsDropdownContainer.appendChild(colorsLabel);
    colorsDropdownContainer.appendChild(this.colorCountSelect);
    
    paletteControlsRow.appendChild(paletteDropdownContainer);
    paletteControlsRow.appendChild(colorsDropdownContainer);
    paletteControlsRow.appendChild(createButton);
    
    // Palette display area
    const paletteDisplayContainer = document.createElement('div');
    paletteDisplayContainer.className = 'palette-display-container';
    
    this.paletteDisplay = document.createElement('div');
    this.paletteDisplay.className = 'palette-display';
    this.paletteDisplay.textContent = 'Palette display';
    
    paletteDisplayContainer.appendChild(this.paletteDisplay);
    
    // Apply button (bottom)
    const applyButton = document.createElement('button');
    applyButton.textContent = 'Apply button';
    applyButton.className = 'apply-button-bottom';
    applyButton.addEventListener('click', () => this.applyPaletteProcessing());
    
    settingsSection.appendChild(paletteControlsRow);
    settingsSection.appendChild(paletteDisplayContainer);
    settingsSection.appendChild(applyButton);
    
    // Processed image section
    const processedSection = document.createElement('div');
    processedSection.className = 'preview-section';
    
    const processedHeader = document.createElement('div');
    processedHeader.className = 'preview-header';
    
    const processedTitle = document.createElement('h4');
    processedTitle.textContent = 'Processed';
    
    const outputSize = document.createElement('span');
    outputSize.className = 'output-size';
    outputSize.id = 'output-size';
    outputSize.textContent = '';
    
    const processedInfoBtn = document.createElement('button');
    processedInfoBtn.textContent = 'i';
    processedInfoBtn.className = 'info-button';
    processedInfoBtn.addEventListener('click', () => this.showImageInfo('processed'));
    
    processedHeader.appendChild(processedTitle);
    processedHeader.appendChild(outputSize);
    processedHeader.appendChild(processedInfoBtn);
    processedSection.appendChild(processedHeader);
    
    this.previewCanvas = document.createElement('canvas');
    this.previewCanvas.className = 'preview-canvas';
    this.previewCtx = this.previewCanvas.getContext('2d');
    processedSection.appendChild(this.previewCanvas);
    
    // Scale controls under processed image
    const processedScaleContainer = document.createElement('div');
    processedScaleContainer.className = 'image-scale-controls';
    
    const processedScaleLabel = document.createElement('label');
    processedScaleLabel.textContent = 'Scale: ';
    
    this.processedScaleSlider = document.createElement('input');
    this.processedScaleSlider.type = 'range';
    this.processedScaleSlider.min = '0.1';
    this.processedScaleSlider.max = '4.0';
    this.processedScaleSlider.step = '0.1';
    this.processedScaleSlider.value = '1.0';
    this.processedScaleSlider.addEventListener('input', () => this.updatePreviewScale());
    
    const processedScaleValue = document.createElement('span');
    processedScaleValue.textContent = '1.0x';
    processedScaleValue.id = 'processed-scale-value';
    
    processedScaleContainer.appendChild(processedScaleLabel);
    processedScaleContainer.appendChild(this.processedScaleSlider);
    processedScaleContainer.appendChild(processedScaleValue);
    processedSection.appendChild(processedScaleContainer);
    
    previewContainer.appendChild(originalSection);
    previewContainer.appendChild(settingsSection);
    previewContainer.appendChild(processedSection);
    panel.appendChild(previewContainer);
    
    return panel;
  }

  updatePreviewScale() {
    // Handle original image scale
    let originalScale = 1.0;
    if (this.originalScaleSlider) {
      originalScale = parseFloat(this.originalScaleSlider.value);
      const originalScaleValue = document.getElementById('original-scale-value');
      if (originalScaleValue) {
        originalScaleValue.textContent = `${originalScale}x`;
      }
    }
    
    // Handle processed image scale  
    let processedScale = 1.0;
    if (this.processedScaleSlider) {
      processedScale = parseFloat(this.processedScaleSlider.value);
      const processedScaleValue = document.getElementById('processed-scale-value');
      if (processedScaleValue) {
        processedScaleValue.textContent = `${processedScale}x`;
      }
    }
    
    console.log('[TextureEditor] updatePreviewScale called with scales:', originalScale, processedScale);
    
    // Update canvas display size while maintaining native resolution and aspect ratio
    if (this.canvas && this.sourceImage) {
      console.log('[TextureEditor] Source image native dimensions:', this.sourceImage.width, 'x', this.sourceImage.height);
      console.log('[TextureEditor] Calculated aspect ratio:', (this.sourceImage.width / this.sourceImage.height).toFixed(3));
      
      // Calculate display dimensions based on native size * scale
      const displayWidth = Math.round(this.sourceImage.width * originalScale);
      const displayHeight = Math.round(this.sourceImage.height * originalScale);
      
      console.log('[TextureEditor] Original scaled display dimensions:', displayWidth, 'x', displayHeight);
      console.log('[TextureEditor] Maintained aspect ratio:', (displayWidth / displayHeight).toFixed(3));
      
      // Set canvas display size (this scales the visual appearance)
      // while keeping the actual canvas resolution at native size
      this.canvas.style.setProperty('width', `${displayWidth}px`, 'important');
      this.canvas.style.setProperty('height', `${displayHeight}px`, 'important');
      
      // Log what we applied
      const canvasComputedStyle = window.getComputedStyle(this.canvas);
      console.log('[TextureEditor] Canvas computed dimensions:', canvasComputedStyle.width, 'x', canvasComputedStyle.height);
      console.log('[TextureEditor] Canvas native resolution:', this.canvas.width, 'x', this.canvas.height);
    }
      
    // Apply scaling to preview canvas if it exists  
    if (this.previewCanvas && this.sourceImage) {
      const processedDisplayWidth = Math.round(this.sourceImage.width * processedScale);
      const processedDisplayHeight = Math.round(this.sourceImage.height * processedScale);
      
      this.previewCanvas.style.setProperty('width', `${processedDisplayWidth}px`, 'important');
      this.previewCanvas.style.setProperty('height', `${processedDisplayHeight}px`, 'important');
      
      const previewComputedStyle = window.getComputedStyle(this.previewCanvas);
      console.log('[TextureEditor] Preview canvas computed dimensions:', previewComputedStyle.width, 'x', previewComputedStyle.height);
      console.log('[TextureEditor] Preview canvas native resolution:', this.previewCanvas.width, 'x', this.previewCanvas.height);
    }
    
    console.log('[TextureEditor] Applied native resolution scaling - scroll bars will appear if needed');
  }

  async loadSourceImageFromDataUrl(dataUrl) {
    // Store canvas reference to avoid scope issues
    const canvas = this.canvas;
    const ctx = this.ctx;
    
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        console.log('[TextureEditor] Image loaded, canvas available:', !!canvas);
        console.log('[TextureEditor] this.canvas available:', !!this.canvas);
        
        // Use stored reference instead of this.canvas
        if (!canvas) {
          console.log('[TextureEditor] Canvas not ready, waiting...');
          const checkCanvas = () => {
            if (this.canvas) {
              this.setImageToCanvas(img, resolve);
            } else {
              setTimeout(checkCanvas, 10);
            }
          };
          checkCanvas();
        } else {
          // Use stored canvas reference
          this.sourceImage = img;
          this.textureData.sourceImage = this.filename || 'unknown';
          this.textureData.width = img.width;
          this.textureData.height = img.height;
          
          console.log('[TextureEditor] Image dimensions:', img.width, 'x', img.height);
          
          // Set canvas to image's actual size
          canvas.width = img.width;
          canvas.height = img.height;
          
          // Draw image at actual size
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          
          // Get source image data
          this.textureData.sourceImageData = ctx.getImageData(0, 0, img.width, img.height);
          
          // Set initial canvas display size to native resolution (1:1 scale)
          this.canvas.style.setProperty('width', `${img.width}px`, 'important');
          this.canvas.style.setProperty('height', `${img.height}px`, 'important');
          console.log('[TextureEditor] Set initial canvas display size:', img.width, 'x', img.height);
          
          if (this.originalScaleSlider) {
            console.log('[TextureEditor] Calling updatePreviewScale with loaded image');
            this.updatePreviewScale();
          } else {
            console.log('[TextureEditor] Scale slider not available yet - will update when DOM is ready');
          }
          
          // Process texture if preview canvas is ready
          if (this.previewCanvas && this.textureData.sourceImageData) {
            this.processTexture();
          }
          
          this.markDirty();
          resolve();
        }
      };
      img.onerror = (err) => {
        console.error('[TextureEditor] Image load error:', err);
        reject(err);
      };
      
      img.src = dataUrl;
    });
  }

  setImageToCanvas(img, resolve) {
    this.sourceImage = img;
    this.textureData.sourceImage = this.filename || 'unknown';
    this.textureData.width = img.width;
    this.textureData.height = img.height;
    
    // Update canvas size and draw
    this.canvas.width = img.width;
    this.canvas.height = img.height;
    this.ctx.drawImage(img, 0, 0);
    
    // Get source image data
    this.textureData.sourceImageData = this.ctx.getImageData(0, 0, img.width, img.height);
    
    // Update UI
    this.markDirty();
    resolve();
  }

  onSettingsChanged() {
    // Update texture data from UI (settings are now in preview panel)
    if (this.colorDepthSelect) {
      this.textureData.colorDepth = parseInt(this.colorDepthSelect.value);
    }
    if (this.compressionCheckbox) {
      this.textureData.compression = this.compressionCheckbox.checked ? 'tga' : 'none';
    }
    
    // Reprocess if we have source data
    if (this.textureData.sourceImageData) {
      this.processTexture();
    }
    
    this.markDirty();
  }

  updatePaletteVisibility() {
    // Only update if DOM elements exist
    if (this.paletteContainer) {
      const isIndexed = this.textureData?.colorDepth <= 8;
      this.paletteContainer.style.display = isIndexed ? 'block' : 'none';
    }
  }

  processTexture() {
    if (!this.textureData.sourceImageData) return;
    
    // Start with source image data
    let imageData = new ImageData(
      new Uint8ClampedArray(this.textureData.sourceImageData.data),
      this.textureData.sourceImageData.width,
      this.textureData.sourceImageData.height
    );
    
    // Apply rotation
    if (this.textureData.rotation !== 0) {
      imageData = this.rotateImageData(imageData, this.textureData.rotation);
    }
    
    // Apply color depth processing
    imageData = this.processColorDepth(imageData);
    
    // Store processed data
    this.textureData.processedImageData = imageData;
    
    // Update preview
    this.updatePreview();
  }

  rotateImageData(imageData, degrees) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (degrees === 90 || degrees === 270) {
      canvas.width = imageData.height;
      canvas.height = imageData.width;
    } else {
      canvas.width = imageData.width;
      canvas.height = imageData.height;
    }
    
    // Create temporary canvas for source
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = imageData.width;
    tempCanvas.height = imageData.height;
    tempCtx.putImageData(imageData, 0, 0);
    
    // Apply rotation
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((degrees * Math.PI) / 180);
    ctx.drawImage(tempCanvas, -tempCanvas.width / 2, -tempCanvas.height / 2);
    
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  processColorDepth(imageData) {
    const data = new Uint8ClampedArray(imageData.data);
    
    switch (this.textureData.colorDepth) {
      case 2:
        return this.convertTo2Bit(imageData);
      case 4:
        return this.convertTo4Bit(imageData);
      case 8:
        return this.convertTo8Bit(imageData);
      case 16:
        return this.convertTo16Bit(imageData);
      case 24:
        return this.convertTo24Bit(imageData);
      case 32:
      default:
        return imageData; // No conversion needed
    }
  }

  convertTo2Bit(imageData) {
    // Simple 2-bit conversion (black, white, gray, transparent)
    const data = new Uint8ClampedArray(imageData.data);
    const palette = [
      [0, 0, 0, 255],     // Black
      [85, 85, 85, 255],  // Dark gray
      [170, 170, 170, 255], // Light gray
      [255, 255, 255, 255]  // White
    ];
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      
      // Convert to grayscale
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      
      // Quantize to 4 levels
      const level = Math.floor(gray / 64);
      const clampedLevel = Math.min(level, 3);
      
      data[i] = palette[clampedLevel][0];
      data[i + 1] = palette[clampedLevel][1];
      data[i + 2] = palette[clampedLevel][2];
      data[i + 3] = a;
    }
    
    return new ImageData(data, imageData.width, imageData.height);
  }

  convertTo4Bit(imageData) {
    // 16-color palette quantization
    const data = new Uint8ClampedArray(imageData.data);
    
    for (let i = 0; i < data.length; i += 4) {
      // Quantize each channel to 4 bits (16 levels)
      data[i] = Math.round(data[i] / 17) * 17;     // Red
      data[i + 1] = Math.round(data[i + 1] / 17) * 17; // Green
      data[i + 2] = Math.round(data[i + 2] / 17) * 17; // Blue
      // Alpha unchanged
    }
    
    return new ImageData(data, imageData.width, imageData.height);
  }

  convertTo8Bit(imageData) {
    // 256-color palette quantization
    const data = new Uint8ClampedArray(imageData.data);
    
    for (let i = 0; i < data.length; i += 4) {
      // Quantize to web-safe palette (6x6x6 = 216 colors + grayscale)
      data[i] = Math.round(data[i] / 51) * 51;     // Red
      data[i + 1] = Math.round(data[i + 1] / 51) * 51; // Green
      data[i + 2] = Math.round(data[i + 2] / 51) * 51; // Blue
      // Alpha unchanged
    }
    
    return new ImageData(data, imageData.width, imageData.height);
  }

  convertTo16Bit(imageData) {
    // RGB565 format simulation
    const data = new Uint8ClampedArray(imageData.data);
    
    for (let i = 0; i < data.length; i += 4) {
      // Quantize to RGB565 levels
      data[i] = Math.round(data[i] / 8) * 8;       // Red (5 bits)
      data[i + 1] = Math.round(data[i + 1] / 4) * 4;   // Green (6 bits)
      data[i + 2] = Math.round(data[i + 2] / 8) * 8;   // Blue (5 bits)
      data[i + 3] = 255; // No alpha in 16-bit
    }
    
    return new ImageData(data, imageData.width, imageData.height);
  }

  convertTo24Bit(imageData) {
    // Remove alpha channel
    const data = new Uint8ClampedArray(imageData.data);
    
    for (let i = 0; i < data.length; i += 4) {
      data[i + 3] = 255; // Full opacity
    }
    
    return new ImageData(data, imageData.width, imageData.height);
  }

  updatePreview() {
    if (!this.textureData.processedImageData) return;
    if (!this.previewCanvas || !this.previewCtx) return;
    
    const processed = this.textureData.processedImageData;
    this.previewCanvas.width = processed.width;
    this.previewCanvas.height = processed.height;
    this.previewCtx.putImageData(processed, 0, 0);
  }

  exportTGA() {
    if (!this.textureData.processedImageData) {
      alert('Please process the texture first');
      return;
    }
    
    // Simple TGA export implementation
    const imageData = this.textureData.processedImageData;
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    
    // TGA header (18 bytes)
    const header = new Uint8Array(18);
    header[2] = 2; // Uncompressed true-color image
    header[12] = width & 0xFF;
    header[13] = (width >> 8) & 0xFF;
    header[14] = height & 0xFF;
    header[15] = (height >> 8) & 0xFF;
    header[16] = 32; // 32 bits per pixel
    header[17] = 0x20; // Top-left origin
    
    // Convert RGBA to BGRA for TGA format
    const pixelData = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      pixelData[i] = data[i + 2];     // Blue
      pixelData[i + 1] = data[i + 1]; // Green
      pixelData[i + 2] = data[i];     // Red
      pixelData[i + 3] = data[i + 3]; // Alpha
    }
    
    // Combine header and pixel data
    const tgaData = new Uint8Array(header.length + pixelData.length);
    tgaData.set(header, 0);
    tgaData.set(pixelData, header.length);
    
    // Download
    const blob = new Blob([tgaData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (this.textureData.name || 'texture') + '.tga';
    a.click();
    URL.revokeObjectURL(url);
  }

  getContent() {
    if (this.textureData) {
      return JSON.stringify(this.textureData.toJSON(), null, 2);
    }
    return '';
  }

  setContent(content) {
    try {
      const data = JSON.parse(content);
      this.textureData = TextureData.fromJSON(data);
      this.updateUIFromData();
    } catch (error) {
      console.error('[TextureEditor] Failed to parse content:', error);
    }
  }

  updateUIFromData() {
    if (!this.textureData) return;
    
    // Update controls
    if (this.colorDepthSelect) this.colorDepthSelect.value = this.textureData.colorDepth;
    if (this.compressionSelect) this.compressionSelect.value = this.textureData.compression;
    if (this.rotationSlider) this.rotationSlider.value = this.textureData.rotation;
    if (this.paletteSizeSelect) this.paletteSizeSelect.value = this.textureData.paletteSize;
    if (this.paletteOffsetSlider) this.paletteOffsetSlider.value = this.textureData.paletteOffset;
    
    this.updatePaletteVisibility();
  }

  // Override save method to handle image-to-texture conversion
  save() {
    if (this.isCreatingFromImage && this.imagePath) {
      // When creating from an image, save as a .texture file in Resources/Textures/Source
      const originalName = this.imagePath.split('/').pop().split('\\').pop();
      const baseName = originalName.substring(0, originalName.lastIndexOf('.'));
      const texturePath = `Resources/Textures/Source/${baseName}.texture`;
      
      // Update the texture data with the source image reference
      this.textureData.sourceImage = this.imagePath;
      this.textureData.name = baseName;
      
      // Use the file service to save the texture file
      const content = JSON.stringify(this.textureData.toJSON(), null, 2);
      const fileService = window.serviceContainer?.get('fileIOService') || window.fileIOService;
      
      if (fileService) {
        fileService.saveFile(texturePath, content).then(() => {
          console.log(`Texture saved: ${texturePath}`);
          
          // Update the tab to reflect the new file
          if (this.tabElement) {
            this.tabElement.setAttribute('data-path', texturePath);
            this.tabElement.setAttribute('data-is-dirty', 'false');
            this.tabElement.querySelector('.tab-name').textContent = `${baseName}.texture`;
          }
          
          this.isCreatingFromImage = false; // Mark as saved
          
          // Show success message
          if (window.gameConsole?.info) {
            window.gameConsole.info(`Texture created: ${texturePath}`);
          }
        }).catch(error => {
          console.error(`Failed to save texture: ${texturePath}`, error);
          if (window.gameConsole?.error) {
            window.gameConsole.error(`Failed to save texture: ${error.message}`);
          }
        });
        
        return true;
      } else {
        console.error('FileIOService not available');
        return false;
      }
    } else {
      // Standard save for existing texture files
      return super.save();
    }
  }

  // Override save-as for texture files
  saveAs() {
    if (this.isCreatingFromImage && this.imagePath) {
      // When creating from image, always save to texture format first
      return this.save();
    } else {
      return super.saveAs();
    }
  }

  // Static metadata for auto-registration
  static getFileExtensions() { 
    return ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.tga', '.texture', '.tex']; 
  }
  static getDisplayName() { return 'Texture Editor'; }
  static getIcon() { return '🖼️'; }
  static getPriority() { return 15; } // Higher priority than simple image viewer for images
  static getCapabilities() { return ['image-processing', 'texture-creation', 'palette-editing']; }
  static canCreate = true;

  static getDefaultFolder() {
    return 'Resources/Textures/Source';
  }

  static createNew() {
    return JSON.stringify(new TextureData().toJSON(), null, 2);
  }

  populatePaletteOptions() {
    // Clear existing options
    this.paletteSelect.innerHTML = '';
    
    // Add "Custom" option
    const customOption = document.createElement('option');
    customOption.value = 'reduce';
    customOption.textContent = 'Custom';
    this.paletteSelect.appendChild(customOption);
    
    // Get actual palette files from project explorer
    try {
      const projectExplorer = window.serviceContainer?.get('projectExplorer');
      if (projectExplorer && typeof projectExplorer.GetPaletteFiles === 'function') {
        const paletteFiles = projectExplorer.GetPaletteFiles();
        
        if (paletteFiles.length > 0) {
          paletteFiles.forEach(paletteFile => {
            const option = document.createElement('option');
            option.value = paletteFile.fullPath;
            option.textContent = paletteFile.name;
            this.paletteSelect.appendChild(option);
          });
          
          console.log(`[TextureEditor] Loaded ${paletteFiles.length} palette files`);
        } else {
          console.log('[TextureEditor] No palette files found in project');
        }
      } else {
        console.warn('[TextureEditor] ProjectExplorer.GetPaletteFiles not available, using fallback');
        this.addFallbackPalettes();
      }
    } catch (error) {
      console.error('[TextureEditor] Error loading palette files:', error);
      this.addFallbackPalettes();
    }
  }

  addFallbackPalettes() {
    // Fallback palette options when project explorer is not available
    const examplePalettes = [
      { name: 'Web Safe', file: 'web-safe.pal' },
      { name: 'Grayscale', file: 'grayscale.pal' },
      { name: 'Retro Gaming', file: 'retro.pal' }
    ];
    
    examplePalettes.forEach(palette => {
      const option = document.createElement('option');
      option.value = palette.file;
      option.textContent = palette.name;
      this.paletteSelect.appendChild(option);
    });
  }

  onPaletteChanged() {
    // Load selected palette and display it
    const selectedPalette = this.paletteSelect.value;
    console.log('[TextureEditor] Palette changed to:', selectedPalette);
    
    if (selectedPalette && selectedPalette !== 'reduce') {
      this.loadPaletteFile(selectedPalette);
    }
  }

  onColorCountChanged() {
    // Update UI when color count changes
    const colorCount = this.colorCountSelect.value;
    console.log('[TextureEditor] Color count changed to:', colorCount);
    
    // If a palette is loaded, update the display to show subset options
    this.updatePaletteDisplay();
  }

  async createPaletteFromImage() {
    // Create a new palette from the current image
    const colorCount = parseInt(this.colorCountSelect.value);
    
    if (isNaN(colorCount)) {
      console.log('[TextureEditor] True Color selected - no palette needed');
      return;
    }
    
    console.log('[TextureEditor] Creating palette with', colorCount, 'colors from image');
    
    if (!this.textureData.sourceImageData) {
      console.error('[TextureEditor] No source image data available');
      return;
    }
    
    // Extract colors from image using the Palette class
    const extractedColors = Palette.extractColorsFromImageData(this.textureData.sourceImageData, colorCount);
    
    // Create a new Palette instance
    const palette = Palette.fromColors(extractedColors, 'Generated Palette');
    
    // Display the created palette
    this.displayPalette(palette.getColors());
    
    // Store the palette for potential saving
    this.currentPalette = palette;
    
    console.log('[TextureEditor] Created palette:', palette.toString());
  }

  updatePaletteDisplay() {
    // Update the palette display based on current palette and settings
    if (this.currentPalette) {
      this.displayPalette(this.currentPalette);
    }
  }

  displayPalette(palette) {
    // Display palette colors in the palette display area
    this.paletteDisplay.innerHTML = '';
    this.paletteDisplay.className = 'palette-display active';
    
    const paletteGrid = document.createElement('div');
    paletteGrid.className = 'palette-grid';
    
    palette.forEach((color, index) => {
      const colorSwatch = document.createElement('div');
      colorSwatch.className = 'palette-swatch';
      colorSwatch.style.backgroundColor = color;
      colorSwatch.title = `Color ${index}: ${color}`;
      paletteGrid.appendChild(colorSwatch);
    });
    
    this.paletteDisplay.appendChild(paletteGrid);
  }

  loadPaletteFile(paletteName) {
    // Load a palette file from the project
    console.log('[TextureEditor] Loading palette file:', paletteName);
    
    // For now, create a dummy palette - later this will load from actual files
    const dummyPalette = [
      '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
      '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#C0C0C0', '#808080'
    ];
    
    this.currentPalette = dummyPalette;
    this.displayPalette(dummyPalette);
  }

  hidePaletteVisualization() {
    // Hide any palette preview
    if (this.paletteVisualization) {
      this.paletteVisualization.style.display = 'none';
    }
  }

  showPaletteVisualization(paletteFile) {
    // Create or show palette visualization
    if (!this.paletteVisualization) {
      this.paletteVisualization = document.createElement('div');
      this.paletteVisualization.className = 'palette-visualization';
      
      // Add after the palette controls row
      const settingsSection = document.querySelector('.between-images-settings');
      settingsSection.appendChild(this.paletteVisualization);
    }
    
    this.paletteVisualization.style.display = 'block';
    // TODO: Load and display actual palette
    this.paletteVisualization.innerHTML = `<p>Palette: ${paletteFile} (preview coming soon)</p>`;
  }

  showImageInfo(imageType) {
    let info = '';
    let sizeBytes = 0;
    
    if (imageType === 'original' && this.sourceImage) {
      info = `Dimensions: ${this.sourceImage.width} x ${this.sourceImage.height}\n`;
      info += `Format: ${this.fileObject?.filename?.split('.').pop()?.toUpperCase() || 'Unknown'}\n`;
      sizeBytes = this.fileObject?.fileContent?.length || 0;
    } else if (imageType === 'processed' && this.textureData.processedImageData) {
      const processed = this.textureData.processedImageData;
      info = `Dimensions: ${processed.width} x ${processed.height}\n`;
      info += `Color Depth: ${this.textureData.colorDepth}-bit\n`;
      info += `Compression: ${this.textureData.compression || 'none'}\n`;
      // Estimate processed size
      sizeBytes = processed.width * processed.height * (this.textureData.colorDepth / 8);
    }
    
    info += `Size: ${this.formatBytes(sizeBytes)}`;
    
    alert(info);
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  applyPaletteProcessing() {
    if (!this.textureData.sourceImageData) return;
    
    const selectedPalette = this.paletteSelect.value;
    
    if (selectedPalette === 'reduce') {
      // Reduce colors to the selected color depth
      this.reduceColors();
    } else {
      // Apply selected palette
      this.applyPalette(selectedPalette);
    }
    
    // Update output size display
    this.updateOutputSize();
  }

  reduceColors() {
    // TODO: Implement color reduction algorithm
    console.log('[TextureEditor] Reducing colors to', this.textureData.colorDepth, 'bit');
    // For now, just copy the source to processed
    this.textureData.processedImageData = this.textureData.sourceImageData;
    this.updatePreview();
  }

  applyPalette(paletteFile) {
    // TODO: Implement palette application
    console.log('[TextureEditor] Applying palette:', paletteFile);
    // For now, just copy the source to processed
    this.textureData.processedImageData = this.textureData.sourceImageData;
    this.updatePreview();
  }

  updateOutputSize() {
    if (this.textureData.processedImageData) {
      const processed = this.textureData.processedImageData;
      const sizeBytes = processed.width * processed.height * (this.textureData.colorDepth / 8);
      const outputSizeElement = document.getElementById('output-size');
      if (outputSizeElement) {
        outputSizeElement.textContent = this.formatBytes(sizeBytes);
      }
    }
  }
}

// Export for use
window.TextureEditor = TextureEditor;

// Register the component
TextureEditor.registerComponent();
