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
    if (!this.originalCanvas) {
      this.originalCanvas = null;
    }
    this.originalCtx = this.originalCtx || null;
    // Don't reset outputCanvas - it was created in createPreviewPanel()
    if (!this.outputCanvas) {
      this.outputCanvas = null;
    }
    if (!this.outputCtx) {
      this.outputCtx = null;
    }
    this.sourceImage = null;
    this.processedImageData = null;
    
    // UI elements - only initialize if not already created
    this.colorDepthSelect = this.colorDepthSelect || null;
    this.compressionCheckbox = this.compressionCheckbox || null;
    this.paletteSelect = this.paletteSelect || null;
    this.originalScaleSlider = this.originalScaleSlider || null;
    this.processedScaleSlider = this.processedScaleSlider || null;
    this.colorCountSelect = this.colorCountSelect || null;
    this.paletteDisplay = this.paletteDisplay || null;
    this.currentPalette = this.currentPalette || null;
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
    console.log('[TextureEditor] createElement() called, canvas before super:', !!this.originalCanvas);
    const element = super.createElement();
    console.log('[TextureEditor] createElement() after super, canvas:', !!this.originalCanvas);
    
    // After element is created, load content if needed
    if (this.isCreatingFromImage) {
      console.log('[TextureEditor] About to load source image, canvas exists:', !!this.originalCanvas);
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
    if (this.textureData.sourceImageData && this.outputCanvas) {
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
    
    this.originalCanvas = document.createElement('canvas');
    console.log('[TextureEditor] Canvas created:', !!this.originalCanvas);
    this.originalCanvas.className = 'preview-canvas';
    this.originalCtx = this.originalCanvas.getContext('2d');
    console.log('[TextureEditor] Canvas context created:', !!this.originalCtx);
    originalSection.appendChild(this.originalCanvas);
    
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

    // New streamlined palette controls
    console.log('[TextureEditor] About to create palette controls panel');
    const paletteControlsPanel = this.createPaletteControlsPanel();
    console.log('[TextureEditor] Palette controls panel created');
    settingsSection.appendChild(paletteControlsPanel);
    
    // Texture Output image section
    console.log('[TextureEditor] About to create texture output section');
    const processedSection = document.createElement('div');
    processedSection.className = 'preview-section';
    
    const processedHeader = document.createElement('div');
    processedHeader.className = 'preview-header';
    
    const processedTitle = document.createElement('h4');
    processedTitle.textContent = 'Texture Output';
    
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
    
    this.outputCanvas = document.createElement('canvas');
    this.outputCanvas.className = 'preview-canvas';
    this.outputCtx = this.outputCanvas.getContext('2d');
    console.log('[TextureEditor] Texture output canvas created:', !!this.outputCanvas);
    processedSection.appendChild(this.outputCanvas);
    
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
    
    console.log('[TextureEditor] createPreviewPanel() completed - outputCanvas:', !!this.outputCanvas);
    
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
    if (this.originalCanvas && this.sourceImage) {
      console.log('[TextureEditor] Source image native dimensions:', this.sourceImage.width, 'x', this.sourceImage.height);
      console.log('[TextureEditor] Calculated aspect ratio:', (this.sourceImage.width / this.sourceImage.height).toFixed(3));
      
      // Calculate display dimensions based on native size * scale
      const displayWidth = Math.round(this.sourceImage.width * originalScale);
      const displayHeight = Math.round(this.sourceImage.height * originalScale);
      
      console.log('[TextureEditor] Original scaled display dimensions:', displayWidth, 'x', displayHeight);
      console.log('[TextureEditor] Maintained aspect ratio:', (displayWidth / displayHeight).toFixed(3));
      
      // Set canvas display size (this scales the visual appearance)
      // while keeping the actual canvas resolution at native size
      this.originalCanvas.style.setProperty('width', `${displayWidth}px`, 'important');
      this.originalCanvas.style.setProperty('height', `${displayHeight}px`, 'important');
      
      // Log what we applied
      const canvasComputedStyle = window.getComputedStyle(this.originalCanvas);
      console.log('[TextureEditor] Canvas computed dimensions:', canvasComputedStyle.width, 'x', canvasComputedStyle.height);
      console.log('[TextureEditor] Canvas native resolution:', this.originalCanvas.width, 'x', this.originalCanvas.height);
    }
      
    // Apply scaling to preview canvas if it exists  
    if (this.outputCanvas && this.sourceImage) {
      const processedDisplayWidth = Math.round(this.sourceImage.width * processedScale);
      const processedDisplayHeight = Math.round(this.sourceImage.height * processedScale);
      
      this.outputCanvas.style.setProperty('width', `${processedDisplayWidth}px`, 'important');
      this.outputCanvas.style.setProperty('height', `${processedDisplayHeight}px`, 'important');
      
      const previewComputedStyle = window.getComputedStyle(this.outputCanvas);
      console.log('[TextureEditor] Preview canvas computed dimensions:', previewComputedStyle.width, 'x', previewComputedStyle.height);
      console.log('[TextureEditor] Preview canvas native resolution:', this.outputCanvas.width, 'x', this.outputCanvas.height);
    }
    
    console.log('[TextureEditor] Applied native resolution scaling - scroll bars will appear if needed');
  }

  createPaletteControlsPanel() {
    const panel = document.createElement('div');
    panel.className = 'palette-controls-panel';
    panel.style.cssText = `
      padding: 15px;
      background: #2a2a2a;
      border-radius: 6px;
      margin-bottom: 15px;
    `;

    // Color Depth Section
    const colorDepthSection = document.createElement('div');
    colorDepthSection.className = 'color-depth-section';
    colorDepthSection.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 15px;
      padding-bottom: 15px;
      border-bottom: 1px solid #444;
    `;

    const colorDepthLabel = document.createElement('label');
    colorDepthLabel.innerHTML = 'Color Depth: <span style="color: #4a9eff;">8-bit</span>';
    colorDepthLabel.style.cssText = `
      color: #ddd;
      font-weight: 500;
      white-space: nowrap;
    `;

    const arrow = document.createElement('span');
    arrow.textContent = '→';
    arrow.style.cssText = `
      color: #888;
      font-size: 16px;
      margin: 0 5px;
    `;

    this.colorDepthSelect = document.createElement('select');
    this.colorDepthSelect.className = 'color-depth-select';
    this.colorDepthSelect.style.cssText = `
      padding: 8px 12px;
      background: #333;
      color: #ddd;
      border: 1px solid #555;
      border-radius: 4px;
      flex: 1;
      max-width: 200px;
    `;

    // Color depth options
    const colorDepths = [
      { value: 1, label: '1-bit (2 colors)' },
      { value: 2, label: '2-bit (4 colors)' },
      { value: 4, label: '4-bit (16 colors)' },
      { value: 8, label: '8-bit (256 colors)' },
      { value: 16, label: '16-bit (65K colors)' },
      { value: 24, label: '24-bit (16M colors)' },
      { value: 32, label: '32-bit (16M + alpha)' }
    ];

    colorDepths.forEach(depth => {
      const option = document.createElement('option');
      option.value = depth.value;
      option.textContent = depth.label;
      this.colorDepthSelect.appendChild(option);
    });
    this.colorDepthSelect.value = 8; // Default to 256 colors

    colorDepthSection.appendChild(colorDepthLabel);
    colorDepthSection.appendChild(arrow);
    colorDepthSection.appendChild(this.colorDepthSelect);

    // Action Buttons Section
    const actionSection = document.createElement('div');
    actionSection.className = 'action-section';
    actionSection.style.cssText = `
      display: flex;
      gap: 10px;
      margin-bottom: 15px;
    `;

    // Load Palette Button
    this.loadPaletteBtn = document.createElement('button');
    this.loadPaletteBtn.textContent = 'Load Palette';
    this.loadPaletteBtn.className = 'load-palette-btn';
    this.loadPaletteBtn.style.cssText = `
      flex: 1;
      padding: 10px 15px;
      background: #4a9eff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
    `;

    // Extract Palette Button
    this.extractPaletteBtn = document.createElement('button');
    this.extractPaletteBtn.textContent = 'Extract Palette';
    this.extractPaletteBtn.className = 'extract-palette-btn';
    this.extractPaletteBtn.style.cssText = `
      flex: 1;
      padding: 10px 15px;
      background: #333;
      color: #ddd;
      border: 1px solid #555;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
    `;

    // Button hover effects and click handlers
    this.loadPaletteBtn.addEventListener('mouseenter', () => {
      if (this.loadPaletteBtn.classList.contains('active')) return;
      this.loadPaletteBtn.style.background = '#3a8eef';
    });
    
    this.loadPaletteBtn.addEventListener('mouseleave', () => {
      if (this.loadPaletteBtn.classList.contains('active')) return;
      this.loadPaletteBtn.style.background = '#4a9eff';
    });

    this.extractPaletteBtn.addEventListener('mouseenter', () => {
      if (this.extractPaletteBtn.classList.contains('active')) return;
      this.extractPaletteBtn.style.background = '#444';
    });
    
    this.extractPaletteBtn.addEventListener('mouseleave', () => {
      if (this.extractPaletteBtn.classList.contains('active')) return;
      this.extractPaletteBtn.style.background = '#333';
    });

    // Button click handlers
    this.loadPaletteBtn.addEventListener('click', () => this.showLoadPaletteModal());
    this.extractPaletteBtn.addEventListener('click', () => this.showExtractPaletteModal());

    actionSection.appendChild(this.loadPaletteBtn);
    actionSection.appendChild(this.extractPaletteBtn);

    // Palette Display Area
    this.paletteDisplay = document.createElement('div');
    this.paletteDisplay.className = 'palette-display';
    this.paletteDisplay.style.cssText = `
      min-height: 120px;
      background: #1a1a1a;
      border: 2px dashed #444;
      border-radius: 4px;
      margin-bottom: 15px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #888;
      font-style: italic;
    `;
    this.paletteDisplay.textContent = 'No palette loaded';

    // Apply Button
    this.applyBtn = document.createElement('button');
    this.applyBtn.textContent = 'Apply';
    this.applyBtn.className = 'apply-btn';
    this.applyBtn.disabled = true;
    this.applyBtn.style.cssText = `
      width: 100%;
      padding: 12px;
      background: #2a7f2a;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      opacity: 0.5;
    `;

    this.applyBtn.addEventListener('click', () => this.applyPaletteToImage());
    
    // Apply button hover effect
    this.applyBtn.addEventListener('mouseenter', () => {
      if (!this.applyBtn.disabled) {
        this.applyBtn.style.background = '#238f23';
      }
    });
    
    this.applyBtn.addEventListener('mouseleave', () => {
      if (!this.applyBtn.disabled) {
        this.applyBtn.style.background = '#2a7f2a';
      }
    });

    // Assemble the panel
    panel.appendChild(colorDepthSection);
    panel.appendChild(actionSection);
    panel.appendChild(this.paletteDisplay);
    panel.appendChild(this.applyBtn);

    // Initialize state
    this.currentPaletteMode = null; // 'load' or 'extract'
    this.currentPalette = null;

    return panel;
  }

  async loadSourceImageFromDataUrl(dataUrl) {
    // Store canvas reference to avoid scope issues
    const canvas = this.originalCanvas;
    const ctx = this.originalCtx;
    
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        console.log('[TextureEditor] Image loaded, canvas available:', !!canvas);
        console.log('[TextureEditor] this.originalCanvas available:', !!this.originalCanvas);
        
        // Use stored reference instead of this.originalCanvas
        if (!canvas) {
          console.log('[TextureEditor] Canvas not ready, waiting...');
          const checkCanvas = () => {
            if (this.originalCanvas) {
              this.setImageToCanvas(img, resolve);
            } else {
              setTimeout(checkCanvas, 10);
            }
          };
          checkCanvas();
        } else {
          // Use the setImageToCanvas method which properly sets up masterImageData
          this.setImageToCanvas(img, resolve);
          return; // setImageToCanvas will handle the resolve
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
    console.log('[TextureEditor] setImageToCanvas - loading image into custom ImageData class');
    
    this.sourceImage = img;
    this.textureData.sourceImage = this.filename || 'unknown';
    this.textureData.width = img.width;
    this.textureData.height = img.height;
    
    console.log('[TextureEditor] Image dimensions:', img.width, 'x', img.height);
    
    // Create our custom ImageData from the loaded image
    const masterImageData = new ImageData();
    
    // Create a temporary canvas to load the image into our custom class
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(img, 0, 0);
    
    // Load into our custom ImageData class - this becomes our master source
    masterImageData.loadFromCanvas(tempCanvas);
    this.textureData.masterImageData = masterImageData;
    
    // Also keep the native ImageData for compatibility
    this.textureData.sourceImageData = tempCtx.getImageData(0, 0, img.width, img.height);
    
    // Set up the original canvas display
    this.originalCanvas.width = img.width;
    this.originalCanvas.height = img.height;
    this.originalCtx.drawImage(img, 0, 0);
    
    console.log('[TextureEditor] Master image data created:', masterImageData);
    
    // Update color depth indicator to show actual image colors
    this.updateColorDepthIndicator();
    
    // Set initial canvas display size to native resolution (1:1 scale)
    this.originalCanvas.style.setProperty('width', `${img.width}px`, 'important');
    this.originalCanvas.style.setProperty('height', `${img.height}px`, 'important');
    console.log('[TextureEditor] Set initial canvas display size:', img.width, 'x', img.height);
    
    if (this.originalScaleSlider) {
      console.log('[TextureEditor] Calling updatePreviewScale with loaded image');
      this.updatePreviewScale();
    } else {
      console.log('[TextureEditor] Scale slider not available yet - will update when DOM is ready');
    }
    
    // Process texture if preview canvas is ready
    if (this.outputCanvas && this.textureData.sourceImageData) {
      this.processTexture();
    }
    
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
    if (!this.outputCanvas || !this.outputCtx) return;
    
    const processed = this.textureData.processedImageData;
    this.outputCanvas.width = processed.width;
    this.outputCanvas.height = processed.height;
    
    // Convert our custom ImageData to native ImageData for putImageData
    const tempCanvas = processed.toCanvas();
    if (tempCanvas) {
      const tempCtx = tempCanvas.getContext('2d');
      const nativeImageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      this.outputCtx.putImageData(nativeImageData, 0, 0);
    }
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
    if (!this.paletteSelect) {
      console.warn('[TextureEditor] paletteSelect not available yet');
      return;
    }
    
    const selectedPalette = this.paletteSelect.value;
    console.log('[TextureEditor] Palette changed to:', selectedPalette);
    
    if (selectedPalette && selectedPalette !== 'reduce') {
      this.loadPaletteFile(selectedPalette);
    }
  }

  onColorCountChanged() {
    // Update UI when color count changes
    if (!this.colorCountSelect) {
      console.warn('[TextureEditor] colorCountSelect not available yet');
      return;
    }
    
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
    
    // Use the enhanced ImageData class for color reduction
    try {
      const imageData = new ImageData();
      
      // Convert ImageData to canvas for processing
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = this.textureData.sourceImageData.width;
      canvas.height = this.textureData.sourceImageData.height;
      ctx.putImageData(this.textureData.sourceImageData, 0, 0);
      
      // Load the canvas into our ImageData class
      imageData.loadFromCanvas(canvas);
      
      // Reduce colors using our enhanced algorithm with correct parameter order
      await imageData.reduceColors(null, colorCount, { algorithm: 'auto' });
      
      // Get the reduced colors
      const reducedColors = imageData.getUniqueColors();
      console.log(`[TextureEditor] Reduced to ${reducedColors.length} colors`);
      
      // Create a new Palette instance
      const palette = new Palette();
      palette.setColors(reducedColors.map(color => `rgb(${color.r},${color.g},${color.b})`));
      palette.name = 'Generated Palette';
      
      // Display the created palette
      this.displayPalette(palette.getColors());
      
      // Store the palette for potential saving
      this.currentPalette = palette;
      
      // Show save button
      if (this.savePaletteButton) {
        this.savePaletteButton.style.display = 'inline-block';
      }
      
      console.log('[TextureEditor] Created palette:', palette.toString());
      
    } catch (error) {
      console.error('[TextureEditor] Error creating palette:', error);
      
      // Fallback to old method
      const extractedColors = Palette.extractColorsFromImageData(this.textureData.sourceImageData, colorCount);
      const palette = Palette.fromColors(extractedColors, 'Generated Palette');
      this.displayPalette(palette.getColors());
      this.currentPalette = palette;
      
      if (this.savePaletteButton) {
        this.savePaletteButton.style.display = 'inline-block';
      }
    }
  }

  async showPaletteExtractionModal() {
    if (!this.colorCountSelect) {
      console.warn('[TextureEditor] colorCountSelect not available yet');
      return;
    }
    
    const colorCount = parseInt(this.colorCountSelect.value);
    
    if (isNaN(colorCount)) {
      console.log('[TextureEditor] True Color selected - no palette needed');
      return;
    }
    
    if (!this.textureData.sourceImageData) {
      console.error('[TextureEditor] No source image data available');
      return;
    }
    
    // Create modal for algorithm selection
    const modal = document.createElement('div');
    modal.className = 'modal palette-extraction-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
    `;
    
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.style.cssText = `
      background: #2a2a2a;
      border-radius: 8px;
      padding: 20px;
      max-width: 400px;
      color: #fff;
      border: 1px solid #444;
    `;
    
    modalContent.innerHTML = `
      <h3>Extract Palette (${colorCount} colors)</h3>
      <p>Choose color reduction algorithm:</p>
      <div style="margin: 15px 0;">
        <label style="display: block; margin: 5px 0;">
          <input type="radio" name="algorithm" value="auto" checked> Auto (Recommended)
        </label>
        <label style="display: block; margin: 5px 0;">
          <input type="radio" name="algorithm" value="median-cut"> Median Cut (Precise)
        </label>
        <label style="display: block; margin: 5px 0;">
          <input type="radio" name="algorithm" value="simple-sample"> Simple Sample (Fast)
        </label>
      </div>
      <div style="margin-top: 20px; text-align: right;">
        <button class="cancel-btn" style="margin-right: 10px;">Cancel</button>
        <button class="extract-btn" style="background: #007acc; color: white; border: none; padding: 8px 16px; border-radius: 4px;">Extract</button>
      </div>
      <div class="progress-container" style="display: none; margin-top: 15px;">
        <div style="background: #444; border-radius: 4px; overflow: hidden;">
          <div class="progress-bar" style="background: #007acc; height: 20px; width: 0%; transition: width 0.3s;"></div>
        </div>
        <div class="progress-text" style="margin-top: 5px; font-size: 12px; color: #ccc;">Processing...</div>
      </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Handle modal interactions
    const cancelBtn = modalContent.querySelector('.cancel-btn');
    const extractBtn = modalContent.querySelector('.extract-btn');
    const progressContainer = modalContent.querySelector('.progress-container');
    const progressBar = modalContent.querySelector('.progress-bar');
    const progressText = modalContent.querySelector('.progress-text');
    
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    
    extractBtn.addEventListener('click', async () => {
      const selectedAlgorithm = modalContent.querySelector('input[name="algorithm"]:checked').value;
      
      // Show progress
      progressContainer.style.display = 'block';
      extractBtn.disabled = true;
      
      try {
        const imageData = new ImageData();
        
        // Convert ImageData to canvas for processing
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = this.textureData.sourceImageData.width;
        canvas.height = this.textureData.sourceImageData.height;
        ctx.putImageData(this.textureData.sourceImageData, 0, 0);
        
        // Load the canvas into our ImageData class
        imageData.loadFromCanvas(canvas);
        
        // Set up progress callback
        const progressCallback = (progress, message) => {
          progressBar.style.width = `${progress * 100}%`;
          progressText.textContent = message || 'Processing...';
        };
        
        // Reduce colors using selected algorithm with correct parameter order
        await imageData.reduceColors(null, colorCount, {
          algorithm: selectedAlgorithm,
          onProgress: progressCallback
        });
        
        // Get the reduced colors
        const reducedColors = imageData.getUniqueColors();
        console.log(`[TextureEditor] Reduced to ${reducedColors.length} colors using ${selectedAlgorithm}`);
        
        // Create a new Palette instance
        const palette = new Palette();
        palette.setColors(reducedColors.map(color => `rgb(${color.r},${color.g},${color.b})`));
        palette.name = `Generated Palette (${selectedAlgorithm})`;
        
        // Display the created palette
        this.displayPalette(palette.getColors());
        
        // Store the palette for potential saving
        this.currentPalette = palette;
        
        // Show save button
        if (this.savePaletteButton) {
          this.savePaletteButton.style.display = 'inline-block';
        }
        
        console.log('[TextureEditor] Created palette:', palette.toString());
        
        // Close modal
        document.body.removeChild(modal);
        
      } catch (error) {
        console.error('[TextureEditor] Error extracting palette:', error);
        progressText.textContent = 'Error: ' + error.message;
        progressText.style.color = '#ff6b6b';
        extractBtn.disabled = false;
      }
    });
    
    // Close modal on background click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
  }

  async savePaletteToProject() {
    if (!this.currentPalette) {
      console.error('[TextureEditor] No palette to save');
      return;
    }
    
    try {
      // Get a filename from user
      const fileName = prompt('Enter palette filename (without extension):', 'extracted_palette');
      if (!fileName) return;
      
      // Ensure it has .act extension for our auto-conversion system
      const fullFileName = fileName.endsWith('.act') ? fileName : `${fileName}.act`;
      
      // Export palette as ACT format
      const actData = this.currentPalette.exportToACT();
      
      // Get project explorer
      const projectExplorer = window.gameEmulator?.projectExplorer;
      if (!projectExplorer) {
        console.error('[TextureEditor] Project explorer not available');
        return;
      }
      
      // Create a synthetic File object for the ACT data
      const actBlob = new Blob([actData], { type: 'application/octet-stream' });
      const actFile = new File([actBlob], fullFileName, { lastModified: Date.now() });
      
      // Add to project (this will handle the file correctly)
      const paletteFolder = projectExplorer.getCurrentProject() + '/Sources/Palettes';
      await projectExplorer.addFileToProject(actFile, paletteFolder, false, false);
      
      console.log(`[TextureEditor] Saved palette as ${fullFileName}`);
      
      // Update the palette dropdown
      this.populatePaletteOptions();
      
      // Hide save button
      if (this.savePaletteButton) {
        this.savePaletteButton.style.display = 'none';
      }
      
    } catch (error) {
      console.error('[TextureEditor] Error saving palette:', error);
      alert('Error saving palette: ' + error.message);
    }
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
    
    if (!palette || palette.length === 0) {
      this.paletteDisplay.innerHTML = '<div class="empty-palette">No palette loaded</div>';
      return;
    }
    
    const paletteGrid = document.createElement('div');
    paletteGrid.className = 'palette-grid';
    paletteGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(20px, 1fr));
      gap: 2px;
      max-height: 200px;
      overflow-y: auto;
      padding: 5px;
      background: #1a1a1a;
      border-radius: 4px;
      border: 1px solid #444;
    `;
    
    palette.forEach((color, index) => {
      const colorSwatch = document.createElement('div');
      colorSwatch.className = 'palette-swatch';
      colorSwatch.style.cssText = `
        width: 20px;
        height: 20px;
        background-color: ${color};
        border: 1px solid #666;
        border-radius: 2px;
        cursor: pointer;
        transition: transform 0.2s;
      `;
      colorSwatch.title = `Color ${index}: ${color}`;
      
      // Add hover effect
      colorSwatch.addEventListener('mouseenter', () => {
        colorSwatch.style.transform = 'scale(1.2)';
        colorSwatch.style.zIndex = '10';
        colorSwatch.style.border = '2px solid #fff';
      });
      
      colorSwatch.addEventListener('mouseleave', () => {
        colorSwatch.style.transform = 'scale(1)';
        colorSwatch.style.zIndex = '1';
        colorSwatch.style.border = '1px solid #666';
      });
      
      // Copy color to clipboard on click
      colorSwatch.addEventListener('click', () => {
        navigator.clipboard.writeText(color).then(() => {
          console.log(`[TextureEditor] Copied color ${color} to clipboard`);
          // Visual feedback
          const originalBg = colorSwatch.style.backgroundColor;
          colorSwatch.style.backgroundColor = '#fff';
          setTimeout(() => {
            colorSwatch.style.backgroundColor = originalBg;
          }, 150);
        }).catch(err => {
          console.warn('[TextureEditor] Could not copy color to clipboard:', err);
        });
      });
      
      paletteGrid.appendChild(colorSwatch);
    });
    
    // Add palette info
    const paletteInfo = document.createElement('div');
    paletteInfo.className = 'palette-info';
    paletteInfo.style.cssText = `
      margin-top: 10px;
      padding: 5px;
      background: #333;
      border-radius: 4px;
      font-size: 12px;
      color: #ccc;
      text-align: center;
    `;
    paletteInfo.textContent = `${palette.length} colors - Click to copy color value`;
    
    this.paletteDisplay.appendChild(paletteGrid);
    this.paletteDisplay.appendChild(paletteInfo);
    
    // Show save button if this is an extracted palette
    this.showSavePaletteButton();
  }

  showSavePaletteButton() {
    // Show save button for extracted palettes
    const existingSaveButton = this.paletteDisplay.querySelector('.save-palette-button');
    if (!existingSaveButton) {
      const saveButton = document.createElement('button');
      saveButton.className = 'save-palette-button';
      saveButton.textContent = 'Save Palette to Project';
      saveButton.style.cssText = `
        margin-top: 10px;
        padding: 8px 16px;
        background: #4a9eff;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: background-color 0.2s;
      `;
      
      saveButton.addEventListener('mouseenter', () => {
        saveButton.style.backgroundColor = '#3a8eef';
      });
      
      saveButton.addEventListener('mouseleave', () => {
        saveButton.style.backgroundColor = '#4a9eff';
      });
      
      saveButton.addEventListener('click', () => {
        this.savePaletteToProject();
      });
      
      this.paletteDisplay.appendChild(saveButton);
    }
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

  showLoadPaletteModal() {
    console.log('[TextureEditor] Show Load Palette Modal');
    
    // Set button states
    this.setButtonState('load');
    
    // Get available palettes from project
    const projectExplorer = window.gameEmulator?.projectExplorer;
    if (!projectExplorer) {
      console.error('[TextureEditor] ProjectExplorer not available');
      return;
    }
    
    const paletteFiles = projectExplorer.GetSourceFiles('Palettes') || [];
    
    if (paletteFiles.length === 0) {
      alert('No palette files found in project. Add some .act, .pal, or .aco files to the Palettes folder.');
      return;
    }
    
    // Create modal for palette selection
    const modal = document.createElement('div');
    modal.className = 'palette-select-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: #333;
      border-radius: 8px;
      padding: 20px;
      max-width: 400px;
      width: 90%;
      color: white;
    `;
    
    modalContent.innerHTML = `
      <h3>Select Palette</h3>
      <div style="margin: 15px 0;">
        ${paletteFiles.map(file => `
          <label style="display: block; margin: 8px 0; cursor: pointer;">
            <input type="radio" name="palette" value="${file.name}" style="margin-right: 8px;">
            ${file.name}
          </label>
        `).join('')}
      </div>
      <div style="margin-top: 20px; text-align: right;">
        <button id="cancelBtn" style="padding: 8px 16px; margin-right: 10px; background: #666; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
        <button id="loadBtn" style="padding: 8px 16px; background: #4a9eff; color: white; border: none; border-radius: 4px; cursor: pointer;">Load</button>
      </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Handle modal events
    modalContent.querySelector('#cancelBtn').addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    
    modalContent.querySelector('#loadBtn').addEventListener('click', async () => {
      const selected = modalContent.querySelector('input[name="palette"]:checked');
      if (!selected) {
        alert('Please select a palette');
        return;
      }
      
      await this.loadPaletteFromProject(selected.value);
      document.body.removeChild(modal);
    });
    
    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
  }

  showExtractPaletteModal() {
    console.log('[TextureEditor] Show Extract Palette Modal');
    
    // Set button states
    this.setButtonState('extract');
    
    // Get color count from color depth setting
    const selectedDepth = parseInt(this.colorDepthSelect.value);
    let maxColors;
    
    switch (selectedDepth) {
      case 1: maxColors = 2; break;
      case 2: maxColors = 4; break;
      case 4: maxColors = 16; break;
      case 8: maxColors = 256; break;
      default: maxColors = 256; break;
    }
    
    // Show our existing extraction modal
    this.showExtractPaletteModalWithAlgorithms(maxColors);
  }

  showExtractPaletteModalWithAlgorithms(colorCount) {
    // Check if source image is available
    if (!this.textureData.sourceImageData) {
      alert('No source image available for palette extraction');
      return;
    }
    
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'palette-extract-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: #333;
      border-radius: 8px;
      padding: 20px;
      max-width: 400px;
      width: 90%;
      color: white;
    `;
    
    // Progress container
    const progressContainer = document.createElement('div');
    progressContainer.style.cssText = `
      display: none;
      margin: 15px 0;
    `;
    
    const progressBar = document.createElement('div');
    progressBar.style.cssText = `
      width: 0%;
      height: 4px;
      background: #4a9eff;
      border-radius: 2px;
      transition: width 0.2s;
      margin-bottom: 5px;
    `;
    
    const progressText = document.createElement('div');
    progressText.style.cssText = `
      font-size: 12px;
      color: #ccc;
    `;
    progressText.textContent = 'Processing...';
    
    progressContainer.appendChild(progressBar);
    progressContainer.appendChild(progressText);
    
    modalContent.innerHTML = `
      <h3>Extract Palette (${colorCount} colors)</h3>
      <p>Choose color reduction algorithm:</p>
      <div style="margin: 15px 0;">
        <label style="display: block; margin: 5px 0;">
          <input type="radio" name="algorithm" value="auto" checked> Auto (Recommended)
        </label>
        <label style="display: block; margin: 5px 0;">
          <input type="radio" name="algorithm" value="median-cut"> Median Cut (Precise)
        </label>
        <label style="display: block; margin: 5px 0;">
          <input type="radio" name="algorithm" value="simple-sample"> Simple Sample (Fast)
        </label>
      </div>
    `;
    
    modalContent.appendChild(progressContainer);
    
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      margin-top: 20px;
      text-align: right;
    `;
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      padding: 8px 16px;
      margin-right: 10px;
      background: #666;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    `;
    
    const extractBtn = document.createElement('button');
    extractBtn.textContent = 'Extract';
    extractBtn.style.cssText = `
      padding: 8px 16px;
      background: #4a9eff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    `;
    
    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(extractBtn);
    modalContent.appendChild(buttonContainer);
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Event handlers
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    
    extractBtn.addEventListener('click', async () => {
      const selectedAlgorithm = modalContent.querySelector('input[name="algorithm"]:checked').value;
      
      // Show progress
      progressContainer.style.display = 'block';
      extractBtn.disabled = true;
      
      try {
        await this.extractPaletteWithAlgorithm(colorCount, selectedAlgorithm, (progress, message) => {
          progressBar.style.width = `${progress * 100}%`;
          progressText.textContent = message || 'Processing...';
        });
        
        document.body.removeChild(modal);
      } catch (error) {
        console.error('[TextureEditor] Palette extraction failed:', error);
        alert('Palette extraction failed: ' + error.message);
        extractBtn.disabled = false;
        progressContainer.style.display = 'none';
      }
    });
    
    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
  }

  async extractPaletteWithAlgorithm(colorCount, algorithm, progressCallback) {
    try {
      // Always work from the master source data, creating a fresh copy
      if (!this.textureData.masterImageData) {
        throw new Error('No master image data available for palette extraction');
      }
      
      console.log('[TextureEditor] Creating fresh copy from master image data for palette extraction');
      
      // Create a fresh copy of our master image data for processing
      const workingImageData = new ImageData();
      
      // Create fresh canvas from master data
      const masterCanvas = this.textureData.masterImageData.toCanvas();
      if (!masterCanvas) {
        throw new Error('Failed to create canvas from master image data');
      }
      
      // Load the fresh canvas into our working ImageData
      workingImageData.loadFromCanvas(masterCanvas);
      
      console.log('[TextureEditor] Working with fresh copy dimensions:', workingImageData.width, 'x', workingImageData.height);
      
      // Reduce colors using selected algorithm with correct parameter order
      const result = await workingImageData.reduceColors(null, colorCount, {
        algorithm: algorithm,
        onProgress: progressCallback
      });
      
      if (!result || !result.palette) {
        throw new Error('Failed to extract palette');
      }
      
      console.log(`[TextureEditor] Reduced to ${result.palette.length} colors using ${algorithm}`);
      
      // Create a new Palette instance using the static factory method
      const palette = Palette.fromColors(result.palette, `Generated Palette (${algorithm})`);
      
      // Store the palette and the reduction result (including indexed frames)
      this.currentPalette = palette;
      this.lastReductionResult = result;  // Store for later application
      this.displayPalette(palette.getColors());
      this.enableApplyButton();
      
    } catch (error) {
      console.error('[TextureEditor] Error extracting palette:', error);
      throw error;
    }
  }

  async loadPaletteFromProject(filename) {
    try {
      const fileManager = window.serviceContainer.get('fileManager');
      const paletteData = await fileManager.loadFile(`Sources/Palettes/${filename}`);
      
      // Load palette using our Palette class
      const palette = new Palette();
      
      // Use the loadFromContent method which auto-detects format
      await palette.loadFromContent(paletteData.fileContent, filename);
      
      palette.name = filename;
      
      // Store the palette and display it
      this.currentPalette = palette;
      this.displayPalette(palette.getColors());
      this.enableApplyButton();
      
      console.log(`[TextureEditor] Loaded palette: ${filename}`);
      
    } catch (error) {
      console.error('[TextureEditor] Error loading palette:', error);
      alert('Failed to load palette: ' + error.message);
    }
  }

  setButtonState(mode) {
    // Update button visual states
    if (mode === 'load') {
      this.loadPaletteBtn.style.background = '#4a9eff';
      this.loadPaletteBtn.classList.add('active');
      this.extractPaletteBtn.style.background = '#333';
      this.extractPaletteBtn.classList.remove('active');
      this.currentPaletteMode = 'load';
    } else if (mode === 'extract') {
      this.extractPaletteBtn.style.background = '#4a9eff';
      this.extractPaletteBtn.classList.add('active');
      this.loadPaletteBtn.style.background = '#333';
      this.loadPaletteBtn.classList.remove('active');
      this.currentPaletteMode = 'extract';
    }
  }

  displayPalette(palette) {
    // Clear the default state
    this.paletteDisplay.innerHTML = '';
    this.paletteDisplay.style.cssText = `
      min-height: 120px;
      background: #1a1a1a;
      border: 2px solid #4a9eff;
      border-radius: 4px;
      margin-bottom: 15px;
      padding: 10px;
      overflow-y: auto;
    `;
    
    if (!palette || palette.length === 0) {
      this.paletteDisplay.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">No colors in palette</div>';
      return;
    }
    
    // Create palette grid
    const paletteGrid = document.createElement('div');
    paletteGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(20px, 1fr));
      gap: 2px;
      margin-bottom: 10px;
    `;
    
    palette.forEach((color, index) => {
      const colorSwatch = document.createElement('div');
      colorSwatch.style.cssText = `
        width: 20px;
        height: 20px;
        background-color: ${color};
        border: 1px solid #666;
        border-radius: 2px;
        cursor: pointer;
        transition: transform 0.2s;
      `;
      colorSwatch.title = `Color ${index}: ${color}`;
      
      // Add hover effect
      colorSwatch.addEventListener('mouseenter', () => {
        colorSwatch.style.transform = 'scale(1.2)';
        colorSwatch.style.zIndex = '10';
        colorSwatch.style.border = '2px solid #fff';
      });
      
      colorSwatch.addEventListener('mouseleave', () => {
        colorSwatch.style.transform = 'scale(1)';
        colorSwatch.style.zIndex = '1';
        colorSwatch.style.border = '1px solid #666';
      });
      
      // Copy color to clipboard on click
      colorSwatch.addEventListener('click', () => {
        navigator.clipboard.writeText(color).then(() => {
          console.log(`[TextureEditor] Copied color ${color} to clipboard`);
        }).catch(err => {
          console.warn('[TextureEditor] Could not copy color to clipboard:', err);
        });
      });
      
      paletteGrid.appendChild(colorSwatch);
    });
    
    // Add palette info
    const paletteInfo = document.createElement('div');
    paletteInfo.style.cssText = `
      font-size: 12px;
      color: #ccc;
      text-align: center;
    `;
    paletteInfo.textContent = `${palette.length} colors - Click to copy color value`;
    
    this.paletteDisplay.appendChild(paletteGrid);
    this.paletteDisplay.appendChild(paletteInfo);
  }

  enableApplyButton() {
    this.applyBtn.disabled = false;
    this.applyBtn.style.opacity = '1';
  }

  async applyPaletteToImage() {
    if (!this.currentPalette) {
      alert('No palette selected');
      return;
    }
    
    console.log('[TextureEditor] Applying palette to image');
    console.log('[TextureEditor] Debug - outputCanvas exists:', !!this.outputCanvas);
    console.log('[TextureEditor] Debug - originalCanvas exists:', !!this.originalCanvas);
    
    try {
      // If we have a reduction result from palette extraction, use it
      if (this.lastReductionResult && this.lastReductionResult.indexedFrames) {
        console.log('[TextureEditor] Using stored reduction result');
        this.applyReductionResult(this.lastReductionResult);
      } else {
        // Apply the current palette to the image using matchToPalette
        console.log('[TextureEditor] Applying palette using matchToPalette');
        await this.matchImageToPalette();
      }
      
      console.log('[TextureEditor] Palette application completed');
      
    } catch (error) {
      console.error('[TextureEditor] Error applying palette:', error);
      alert('Failed to apply palette: ' + error.message);
    }
  }

  applyReductionResult(result) {
    console.log('[TextureEditor] applyReductionResult called with:', result);
    
    if (!result.indexedFrames || result.indexedFrames.length === 0) {
      throw new Error('No indexed frames in reduction result');
    }
    
    // Get indexed data from the consistent structure
    const indexedFrameData = result.indexedFrames[0]; // Use first frame
    const indexedData = indexedFrameData.indexedData;
    const palette = result.palette;
    
    console.log('[TextureEditor] IndexedData length:', indexedData.length);
    console.log('[TextureEditor] Palette length:', palette.length);
    console.log('[TextureEditor] First few palette colors:', palette.slice(0, 5));
    
    // Use actual image dimensions from original canvas, not textureData defaults
    const width = this.originalCanvas.width;
    const height = this.originalCanvas.height;
    
    console.log('[TextureEditor] Using dimensions:', width, 'x', height);
    console.log('[TextureEditor] Expected pixel count:', width * height);
    
    // Create a new canvas for the reduced image
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    // Create ImageData for the canvas
    const imageData = ctx.createImageData(canvas.width, canvas.height);
    const data = imageData.data;
    
    // Convert indexed data back to RGBA using the palette
    for (let i = 0; i < indexedData.length; i++) {
      const paletteIndex = indexedData[i];
      if (paletteIndex >= palette.length) {
        console.error('[TextureEditor] Invalid palette index:', paletteIndex, 'max:', palette.length - 1);
        continue;
      }
      
      const color = palette[paletteIndex];
      let r, g, b;
      
      // Handle different color formats
      if (typeof color === 'string' && color.startsWith('#')) {
        // Hex color string
        r = parseInt(color.substring(1, 3), 16);
        g = parseInt(color.substring(3, 5), 16);
        b = parseInt(color.substring(5, 7), 16);
      } else if (typeof color === 'object' && color.r !== undefined) {
        // RGB object
        r = color.r;
        g = color.g;
        b = color.b;
      } else {
        console.error('[TextureEditor] Unknown color format:', color);
        r = g = b = 0; // Default to black
      }
      
      const pixelIndex = i * 4;
      data[pixelIndex] = r;     // Red
      data[pixelIndex + 1] = g; // Green
      data[pixelIndex + 2] = b; // Blue
      data[pixelIndex + 3] = 255; // Alpha (fully opaque)
    }
    
    // Put the reconstructed image data to canvas
    ctx.putImageData(imageData, 0, 0);
    
    // Update the preview canvas with the reduced image
    this.updateCanvasFromImage(canvas);
  }

  async matchImageToPalette() {
    console.log('[TextureEditor] Creating fresh copy from master image data for palette application');
    
    // Always work from the master source data, creating a fresh copy
    if (!this.textureData.masterImageData) {
      throw new Error('No master image data available for palette application');
    }
    
    // Create a fresh copy of our master image data for processing
    const workingImageData = new ImageData();
    
    // Create fresh canvas from master data
    const masterCanvas = this.textureData.masterImageData.toCanvas();
    if (!masterCanvas) {
      throw new Error('Failed to create canvas from master image data');
    }
    
    // Load the fresh canvas into our working ImageData
    workingImageData.loadFromCanvas(masterCanvas);
    
    console.log('[TextureEditor] Working with fresh copy for palette application');
    
    // Match to the current palette
    const result = workingImageData.matchToPalette(null, this.currentPalette);
    
    if (!result) {
      throw new Error('Failed to match image to palette');
    }
    
    // Apply the matched result (now has consistent structure)
    this.applyReductionResult(result);
  }

  updateCanvasFromImage(sourceCanvas) {
    // Debug this context
    console.log('[TextureEditor] updateCanvasFromImage - this:', this);
    console.log('[TextureEditor] updateCanvasFromImage - this.constructor.name:', this.constructor.name);
    
    // Check if outputCanvas exists
    if (!this.outputCanvas) {
      console.error('[TextureEditor] outputCanvas is null - cannot update output');
      console.log('[TextureEditor] All canvas properties:', {
        originalCanvas: !!this.originalCanvas,
        outputCanvas: !!this.outputCanvas,
        originalCtx: !!this.originalCtx,
        outputCtx: !!this.outputCtx
      });
      throw new Error('Texture output canvas not initialized');
    }
    
    // Clear and resize the processed output canvas
    const ctx = this.outputCanvas.getContext('2d');
    this.outputCanvas.width = sourceCanvas.width;
    this.outputCanvas.height = sourceCanvas.height;
    ctx.clearRect(0, 0, this.outputCanvas.width, this.outputCanvas.height);
    
    // Draw the processed image to the output canvas
    ctx.drawImage(sourceCanvas, 0, 0);
    
    console.log('[TextureEditor] Successfully updated texture output canvas');
    
    // Update processed texture data (not the original source)
    const newImageData = new ImageData();
    newImageData.loadFromCanvas(sourceCanvas);
    this.textureData.processedImageData = newImageData;
    
    // Mark as modified
    this.markDirty();
  }

  updateColorDepthIndicator() {
    if (!this.textureData.sourceImageData || !this.colorDepthSelect) {
      return;
    }
    
    try {
      // Count unique colors in the image
      const imageData = this.textureData.sourceImageData;
      const colorSet = new Set();
      
      for (let i = 0; i < imageData.data.length; i += 4) {
        const r = imageData.data[i];
        const g = imageData.data[i + 1];
        const b = imageData.data[i + 2];
        const a = imageData.data[i + 3];
        
        // Skip transparent pixels
        if (a < 255) continue;
        
        // Create color key
        const colorKey = `${r},${g},${b}`;
        colorSet.add(colorKey);
        
        // Early exit if we have too many colors for efficient counting
        if (colorSet.size > 256) break;
      }
      
      const uniqueColors = colorSet.size;
      
      // Determine appropriate color depth based on unique colors
      let suggestedDepth = 8; // Default to 8-bit
      if (uniqueColors <= 2) {
        suggestedDepth = 1;
      } else if (uniqueColors <= 4) {
        suggestedDepth = 2;
      } else if (uniqueColors <= 16) {
        suggestedDepth = 4;
      } else {
        suggestedDepth = 8;
      }
      
      // Update the dropdown to show the detected depth
      this.colorDepthSelect.value = suggestedDepth;
      
      // Update the label to show actual color count
      const paletteControlsPanel = this.element.querySelector('.palette-controls-panel');
      const label = paletteControlsPanel?.querySelector('label');
      if (label && label.innerHTML.includes('Color Depth')) {
        label.innerHTML = `Color Depth: <span style="color: #4a9eff;">${suggestedDepth}-bit</span>`;
      }
      
      console.log(`[TextureEditor] Detected ${uniqueColors} unique colors, suggested ${suggestedDepth}-bit depth`);
      
    } catch (error) {
      console.error('[TextureEditor] Error analyzing image colors:', error);
    }
  }
}

// Export for use
window.TextureEditor = TextureEditor;

// Register the component
TextureEditor.registerComponent();
