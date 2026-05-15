// texture-editor.js
// Editor for creating and editing texture files with compression, palettes, and processing options

console.log('[TextureEditor] Class definition loading');

/**
 * TextureData - Data structure for texture information with event support
 */
class TextureData extends EventTarget {
  constructor(options = {}) {
    super(); // Call EventTarget constructor
    
    this.width = options.width || 32;
    this.height = options.height || 32;
    this.colorDepth = options.colorDepth || 8;
    this.palette = options.palette || null;
    this.transparentColor = options.transparentColor || '#FF00FF';
    this.useColorKey = options.useColorKey !== undefined ? !!options.useColorKey : false;
    this.compressionType = options.compressionType || 'none';
    this.mipmaps = options.mipmaps || false;
    this.format = options.format || 'RGBA';
    this.name = options.name || 'texture';
    this.sourceImage = options.sourceImage || null;
    this.rotation = options.rotation || 90; // Default to 90 (pre-rotated); || also converts 0 → 90 so old files get migrated
    this.hasExplicitOutputPixelFormat = options.hasExplicitOutputPixelFormat === true ||
      (options.outputPixelFormat !== undefined && options.outputPixelFormat !== null && options.outputPixelFormat !== '');
    
    // Metadata for .texture file format with auto-population
    this._metadata = {
      sourceImagePath: options.sourceImagePath || '',
      palettePath: options.palettePath || '',
      outputPixelFormat: options.outputPixelFormat || 'd2_mode_i8',
      scale: options.scale || 1.0,
      paletteOffset: options.paletteOffset || 0
    };
    
    // Auto-populate default palette path if not provided
    this.populateDefaultPalette();
  }

  // Getter for metadata
  get metadata() {
    return this._metadata;
  }

  // Method to update metadata with event emission
  updateMetadata(property, value) {
    if (this._metadata.hasOwnProperty(property)) {
      const oldValue = this._metadata[property];
      // Skip if value hasn't actually changed — prevents infinite event loops
      if (oldValue === value) return;
      this._metadata[property] = value;
      
      // Emit event for metadata change
      this.dispatchEvent(new CustomEvent('metadataChanged', {
        detail: { property, oldValue, newValue: value, metadata: this._metadata }
      }));
    }
  }

  // Legacy property accessors for backward compatibility  
  get sourceImagePath() { return this._metadata.sourceImagePath; }
  set sourceImagePath(value) { this.updateMetadata('sourceImagePath', value); }

  get palettePath() { return this._metadata.palettePath; }
  set palettePath(value) { this.updateMetadata('palettePath', value); }

  get outputPixelFormat() { return this._metadata.outputPixelFormat; }
  set outputPixelFormat(value) {
    this.hasExplicitOutputPixelFormat = true;
    this.updateMetadata('outputPixelFormat', value);
  }

  applySuggestedOutputPixelFormat(value) {
    if (this.hasExplicitOutputPixelFormat) {
      return false;
    }

    this.updateMetadata('outputPixelFormat', value);
    return true;
  }

  get scale() { return this._metadata.scale; }
  set scale(value) { this.updateMetadata('scale', value); }

  get paletteOffset() { return this._metadata.paletteOffset; }
  set paletteOffset(value) { this.updateMetadata('paletteOffset', value); }

  // Async method to populate default palette path if not set
  async populateDefaultPalette() {
    if (this.palettePath && this.palettePath !== '') {
      return; // Already has a palette path
    }

    // Only auto-populate palette for indexed (paletted) formats
    if (!TextureData.isIndexedFormat(this.outputPixelFormat)) {
      return;
    }

    try {
      const projectExplorer = window.gameEmulator?.projectExplorer;
      if (projectExplorer && typeof projectExplorer.getDefaultPalettePath === 'function') {
        const defaultPalettePath = await projectExplorer.getDefaultPalettePath();
        if (defaultPalettePath) {
          const parsedPalettePath = window.ProjectPaths?.parseProjectPath
            ? window.ProjectPaths.parseProjectPath(defaultPalettePath)
            : { rest: defaultPalettePath };
          const storagePalettePath = parsedPalettePath.rest || defaultPalettePath;
          this.palettePath = storagePalettePath;
          console.log('[TextureData] Auto-populated default palette path:', storagePalettePath);
        }
      }
    } catch (error) {
      console.log('[TextureData] Could not populate default palette path:', error);
    }
  }

  // Check if format uses a palette
  static isIndexedFormat(formatValue) {
    return formatValue.startsWith('d2_mode_i') || formatValue === 'd2_mode_ai44';
  }

  // Delegate to ImageData for format color count (for backward compatibility)
  static getFormatColorCount(formatValue) {
    return ImageData.getTextureFormatColorCount(formatValue);
  }

  static getFormatBitsPerPixel(formatValue) {
    const format = ImageData.getTextureFormatOptions().find(option => option.value === formatValue);
    if (!format) {
      throw new Error(`Unsupported texture format: ${formatValue}`);
    }
    return Number(format.bitsPerPixel);
  }

  // Serialize to JSON
  toJSON() {
    return {
      width: this.width,
      height: this.height,
      colorDepth: this.colorDepth,
      palette: this.palette,
      transparentColor: this.transparentColor,
      useColorKey: this.useColorKey,
      compressionType: this.compressionType,
      mipmaps: this.mipmaps,
      format: this.format,
      name: this.name,
      sourceImage: this.sourceImage,
      rotation: this.rotation,
      metadata: this._metadata
    };
  }

  // Load from JSON
  static fromJSON(data) {
    return new TextureData({
      width: data.width,
      height: data.height,
      colorDepth: data.colorDepth,
      palette: data.palette,
      transparentColor: data.transparentColor,
      useColorKey: data.useColorKey,
      compressionType: data.compressionType,
      mipmaps: data.mipmaps,
      format: data.format,
      name: data.name,
      sourceImage: data.sourceImage,
      rotation: data.rotation || 90,
      sourceImagePath: data.sourceImagePath || data.metadata?.sourceImagePath || '',
      palettePath: data.palettePath || data.metadata?.palettePath || '',
      outputPixelFormat: data.metadata?.outputPixelFormat,
      hasExplicitOutputPixelFormat: !!data.metadata?.outputPixelFormat,
      scale: data.metadata?.scale,
      paletteOffset: data.metadata?.paletteOffset
    });
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
    console.log('[TextureEditor] this.file after super():', this.file);
    
    // Now set properties after super() but preserve canvas reference
    this.textureData = tempTextureData;
    console.log('[TextureEditor] this.file after textureData assignment:', this.file);
    
    // Don't reset canvas if it was already created
    if (!this.originalCanvas) {
      this.originalCanvas = null;
    }
    this.originalCtx = this.originalCtx || null;
    console.log('[TextureEditor] this.file after canvas assignments:', this.file);
    
    // Don't reset outputCanvas - it was created in createPreviewPanel()
    if (!this.outputCanvas) {
      this.outputCanvas = null;
    }
    if (!this.outputCtx) {
      this.outputCtx = null;
    }
    this.sourceImage = null;
    this.processedImageData = null;
    console.log('[TextureEditor] this.file after image assignments:', this.file);
    
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
    
    // Setup two-way data binding for metadata
    this.setupMetadataEventListeners();
    
    // Ensure default palette is populated after everything is set up
    setTimeout(() => {
      if (this.textureData) {
        console.log('[TextureEditor] Manually triggering populateDefaultPalette after setup');
        this.textureData.populateDefaultPalette();
      }
    }, 500); // Give some time for project explorer to be ready
    
    console.log('[TextureEditor] Constructor completed, textureData:', this.textureData);
    console.log('[TextureEditor] Constructor completed, this.file:', this.file);
    
    // Initialize content now that constructor is complete
    this.initializeContent();
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

  setupMetadataEventListeners() {
    // Remove listener from any previous textureData instance
    if (this._prevTextureData && this.metadataChangeHandler) {
      this._prevTextureData.removeEventListener('metadataChanged', this.metadataChangeHandler);
    }
    this._prevTextureData = this.textureData;

    // Listen for metadata changes from TextureData
    this.metadataChangeHandler = (event) => {
      console.log('[TextureEditor] Metadata changed:', event.detail);
      // Update the metadata display
      this.updateMetadataDisplay();
      
      // Update existing UI controls based on metadata changes
      if (event.detail.property === 'outputPixelFormat') {
        // Update the format label
        const formats = ImageData.getTextureFormatOptions();
        const selectedFormat = formats.find(f => f.value === event.detail.newValue);
        if (selectedFormat && this.formatLabel) {
          this.formatLabel.innerHTML = `Output Format: <span style="color: #4a9eff;">${selectedFormat.label}</span>`;
        }
        
        // Also update color depth for backward compatibility
        if (this.colorDepthSelect && selectedFormat) {
          this.colorDepthSelect.value = selectedFormat.bitsPerPixel;
        }
        
        // Reset palette offset when format changes
        this.textureData.metadata.paletteOffset = 0;
        
        // Refresh palette display to show format-appropriate slot selection
        if (this.currentPalette) {
          const colors = this.currentPalette.getColors ? this.currentPalette.getColors() : this.currentPalette;
          this.displayPalette(colors);
        } else if (this.textureData.palette && this.textureData.palette.length > 0) {
          this.displayPalette(this.textureData.palette);
        }
        
        // Update options visibility (e.g. RLE only for i8, palette panel only for indexed)
        this.updateOptionsVisibility();
        this.updatePaletteVisibility();
        
        // Re-apply palette / generate output with new format settings
        this.checkAndAutoGenerateTexture();
      }
      
      // Auto-load palette when palettePath changes
      if (event.detail.property === 'palettePath' && event.detail.newValue) {
        console.log('[TextureEditor] Auto-loading palette:', event.detail.newValue);
        this.loadPaletteByPath(event.detail.newValue).then(() => {
          // After palette is loaded, check if we can auto-generate
          this.checkAndAutoGenerateTexture();
        });
      }
    };

    // Add the event listener to textureData
    this.textureData.addEventListener('metadataChanged', this.metadataChangeHandler);
    
    // Listen for changes from existing UI controls to update metadata
    this.setupUIToMetadataBinding();
  }

  setupUIToMetadataBinding() {
    // Defer UI binding until controls are created
    setTimeout(() => {
      // Format is now handled by the format selection modal button
      // No need to bind anything here as the modal handles the selection
      
      // Color depth select is now secondary (for compatibility/display)
      if (this.colorDepthSelect) {
        this.colorDepthSelect.addEventListener('change', () => {
          const colorDepth = Number(this.colorDepthSelect.value);
          console.log('[TextureEditor] Color depth select changed:', colorDepth);
          this.setOutputFormatForColorDepth(colorDepth);
        });
      }
    }, 100);
  }

  // Check if texture is ready for auto-generation and trigger it
  checkAndAutoGenerateTexture() {
    const hasSourceImage = this.sourceImage && this.originalCanvas;
    const hasPalette = this.currentPalette && this.currentPalette.colors;
    const isIndexed = TextureData.isIndexedFormat(this.textureData.outputPixelFormat);

    console.log('[TextureEditor] Auto-generation check - Source Image:', hasSourceImage,
                'Palette:', hasPalette, 'Indexed:', isIndexed);

    // For indexed formats: need both source image and palette
    // For direct-colour formats: need only the source image
    const canGenerate = hasSourceImage && (isIndexed ? hasPalette : true);

    if (canGenerate) {
      // Debounce: cancel any pending auto-generation and schedule a new one
      if (this._autoGenTimer) {
        clearTimeout(this._autoGenTimer);
      }
      console.log('[TextureEditor] Auto-generating texture output...');
      this._autoGenTimer = setTimeout(() => {
        this._autoGenTimer = null;
        if (isIndexed) {
          this.applyPaletteToImage(false); // palette matching path
        } else {
          this.generateDirectColorOutput(); // direct-colour path (no palette)
        }
      }, 150);
    }
  }

  // Override destroy method to clean up event listeners
  destroy() {
    // Clean up GPU resources
    if (this._gpuTex && this._gpu) {
      this._gpu.deleteTexture(this._gpuTex);
      this._gpuTex = null;
    }
    if (this._gpu) {
      this._gpu.destroy();
      this._gpu = null;
    }

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

  /* ──────────────────────────────────────────────────────────────────
     GPU (D2Canvas) rendering helpers
     ────────────────────────────────────────────────────────────────── */

  /** Lazy-init the D2Canvas WebGL 2 renderer on the output canvas. */
  _initGpu() {
    if (this._gpu) return;
    if (!this.outputCanvas) return;
    try {
      this._gpu = new D2Canvas(this.outputCanvas, { alpha: true, premultiplied: false });
      console.log('[TextureEditor] D2Canvas GPU renderer initialised');
    } catch (e) {
      console.error('[TextureEditor] D2Canvas init failed, falling back to CPU:', e);
      this._gpu = null;
    }
  }

  /**
   * Convert an array of hex colour strings (#RRGGBB) to a 256×RGBA8 Uint8Array
   * suitable for D2Canvas.setPalette().
   */
  _hexPaletteToRGBA8(hexColors) {
    const rgba = new Uint8Array(1024); // 256 × 4
    for (let i = 0; i < hexColors.length && i < 256; i++) {
      const color = hexColors[i];
      let r = 0, g = 0, b = 0;
      if (typeof color === 'string' && color.startsWith('#')) {
        r = parseInt(color.substring(1, 3), 16);
        g = parseInt(color.substring(3, 5), 16);
        b = parseInt(color.substring(5, 7), 16);
      } else if (typeof color === 'object' && color.r !== undefined) {
        r = color.r; g = color.g; b = color.b;
      }
      const off = i * 4;
      rgba[off]     = r;
      rgba[off + 1] = g;
      rgba[off + 2] = b;
      rgba[off + 3] = 255;
    }
    return rgba;
  }

  /**
   * Build the actual game-resource .d2 binary via D2File, upload it to the
   * GPU, and render — identical path to how the D2 Viewer displays a .d2.
   *
   * This is the SINGLE code path for preview rendering.  The same .d2 is
   * saved to storage so the D2 Viewer, build system, and preview all
   * operate on the exact same binary.
   *
   * @param {Uint8Array} indexedData  Per-pixel 8-bit palette indices.
   * @param {number} width   Source image width (before any rotation).
   * @param {number} height  Source image height (before any rotation).
   */
  _buildD2Preview(indexedData, width, height) {
    this._initGpu();
    if (!this._gpu) return;

    // Build the real .d2 binary (packing, rotation, RLE — all applied)
    const textureCfg = this.textureData.toJSON();
    const d2Bytes = D2File.build(textureCfg, indexedData, width, height);

    // Upload the complete .d2 to D2Canvas — same as D2 Viewer does
    if (this._gpuTex) {
      this._gpu.deleteTexture(this._gpuTex);
      this._gpuTex = null;
    }
    this._gpuTex = this._gpu.createTexture(d2Bytes);

    // Set palette (shader handles paletteOffset uniform)
    this._updateGpuPalette();

    // Blit with un-rotation when the .d2 is pre-rotated (flags byte 13, bit 1)
    const isPreRotated = !!(d2Bytes[13] & 0x02);
    this._d2PreRotated = isPreRotated;
    this._gpuBlit(isPreRotated);

    // Persist .d2 alongside .texture (async, non-blocking)
    this._saveTextureJsonAfterPreview();

    const formatStr = this.textureData.outputPixelFormat;
    console.log(`[TextureEditor] D2 preview: ${width}×${height} ${formatStr} (${d2Bytes.length} bytes)`);
  }

  /**\n   * Upload the FULL current palette to the GPU and set the palette offset.
   * Always reads from this.currentPalette so the shader's paletteOffset
   * uniform correctly selects the sub-palette window for sub-8-bit formats.
   * (Uploading a pre-sliced palette + non-zero offset would double-apply the
   * offset, causing a blank image.)
   *
   * When color key is enabled, sets alpha=0 on index 0 of each palette chunk
   * so the GPU renders those pixels as transparent.
   */
  _updateGpuPalette() {
    if (!this._gpu) return;
    const allColors = this.currentPalette
      ? (this.currentPalette.getColors ? this.currentPalette.getColors() : this.currentPalette)
      : [];
    const rgba = this._hexPaletteToRGBA8(allColors);

    // Color key: punch alpha=0 on index 0 of every sub-palette chunk
    const format = this.textureData.outputPixelFormat;
    if (this.textureData.useColorKey && TextureData.isIndexedFormat(format) && format !== 'd2_mode_ai44') {
      let chunkSize = 256;
      if (format === 'd2_mode_i4')  chunkSize = 16;
      else if (format === 'd2_mode_i2')  chunkSize = 4;
      else if (format === 'd2_mode_i1')  chunkSize = 2;
      for (let base = 0; base < 256; base += chunkSize) {
        rgba[base * 4 + 3] = 0;
      }
    }

    this._gpu.setPalette(rgba);
    const offset = this.textureData.metadata.paletteOffset || 0;
    this._gpu.setPaletteOffset(offset);
  }

  /**
   * Clear, blit the current GPU texture, and present.
   * Handles un-rotation for pre-rotated .d2 files — identical to D2 Viewer.
   * @param {boolean} [isPreRotated=false]
   */
  _gpuBlit(isPreRotated) {
    if (!this._gpu || !this._gpuTex) return;
    const tex = this._gpuTex;

    // Logical display dimensions (pre-rotation is handled inside blit)
    const displayW = isPreRotated ? tex.height : tex.width;
    const displayH = isPreRotated ? tex.width  : tex.height;
    this._gpu.resize(displayW, displayH);
    this._gpu.clear(0, 0, 0, 0);
    this._gpu.blit(tex);
    this._gpu.present();
  }

  /**
    * Persist the .texture JSON after a preview rebuild.
   * The .texture JSON is always saved so that palettePath, paletteOffset,
   * transparentColor, and the embedded palette are on disk for the D2 Viewer.
   */
  async _saveTextureJsonAfterPreview() {
    try {
      if (!this.path) return;
      await this._saveTextureJson();
    } catch (e) {
      console.warn('[TextureEditor] .texture auto-save failed:', e.message);
    }
  }

  /**
   * Persist the current .texture JSON to storage.
   * Ensures palettePath, paletteOffset, transparentColor, and the embedded
   * palette array are on disk — the D2 Viewer depends on these.
   */
  async _saveTextureJson() {
    try {
      if (!this.path || !this.textureData) return;
      const content = this.getContent();
      if (!content) return;
      const fileService = window.serviceContainer?.get('fileIOService') || window.fileIOService;
      if (fileService) {
        await fileService.saveFile(this.path, content);
        console.log(`[TextureEditor] Persisted .texture JSON: ${this.path}`);
      }
    } catch (e) {
      console.warn('[TextureEditor] .texture auto-save failed:', e.message);
    }
  }

  createElement() {
    console.log('[TextureEditor] createElement() called, canvas before super:', !!this.originalCanvas);
    const element = super.createElement();
    console.log('[TextureEditor] createElement() after super, canvas:', !!this.originalCanvas);
    console.log('[TextureEditor] createElement() this.file:', this.file);
    console.log('[TextureEditor] createElement() this.isNewResource:', this.isNewResource);
    
    // Content loading will be handled by initializeContent() called after constructor
    return element;
  }

  // Called after constructor completes to initialize content
  initializeContent() {
    console.log('[TextureEditor] initializeContent() called');
    console.log('[TextureEditor] initializeContent() this.file:', this.file);
    console.log('[TextureEditor] initializeContent() this.isNewResource:', this.isNewResource);
    console.log('[TextureEditor] initializeContent() this.isCreatingFromImage:', this.isCreatingFromImage);
    
    if (this.isCreatingFromImage) {
      console.log('[TextureEditor] About to load source image, canvas exists:', !!this.originalCanvas);
      this.loadSourceImageFromPath();
    } else if (!this.isNewResource && this.file) {
      console.log('[TextureEditor] About to load texture file content');
      this.loadFileContent();
    }
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
          sourceImage: this.path,
          sourceImagePath: this.path
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
    bodyContainer.style.cssText = `
      padding: 0;
      margin: 0;
      overflow: hidden;
      height: 100%;
    `;
    
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
    
    // Note: File content loading is now handled in createElement() after constructor completes
    
    return bodyContainer;
  }

  /**
   * Load source image from texture data sourceImagePath
   */
  async loadSourceImageFromTexture() {
    if (!this.textureData?.sourceImagePath) {
      console.log('[TextureEditor] No source image path in texture data');
      return;
    }

    try {
      // Construct the full path to the source image
      // The texture file is in the same directory as the source image
      const texturePath = this.file?.path || this.path;
      const textureDirectory = texturePath.substring(0, texturePath.lastIndexOf('/'));
      const sourceImagePath = `${textureDirectory}/${this.textureData.sourceImagePath}`;
      
      console.log('[TextureEditor] Loading source image from path:', sourceImagePath);
      console.log('[TextureEditor] Texture directory:', textureDirectory);
      console.log('[TextureEditor] Source image filename:', this.textureData.sourceImagePath);
      
      // Load the image file from storage
      const fileManager = window.serviceContainer?.get?.('fileManager') || window.fileManager;
      if (!fileManager) {
        console.error('[TextureEditor] FileManager not available');
        return;
      }
      
      // Remove the 'test/' prefix if it exists for storage path
      const storageImagePath = sourceImagePath.replace(/^test\//, '');
      console.log('[TextureEditor] Storage path for image:', storageImagePath);
      
      const imageFile = await fileManager.loadFile(storageImagePath);
      if (!imageFile || !imageFile.fileContent) {
        console.error('[TextureEditor] Failed to load source image file:', storageImagePath);
        return;
      }
      
      console.log('[TextureEditor] Source image file loaded:', imageFile.filename);
      
      // Create image element and load the image data
      const img = new Image();
      img.onload = () => {
        console.log('[TextureEditor] Source image loaded successfully:', img.width, 'x', img.height);
        
        // Use the existing setImageToCanvas method to process the image
        this.setImageToCanvas(img, () => {
          console.log('[TextureEditor] Image processed and loaded into texture data');
          
          // Update the original image canvas display
          this.updateOriginalImageCanvas();
          
          // Trigger auto-generation check
          this.checkAndAutoGenerateTexture();
        });
      };
      
      img.onerror = (error) => {
        console.error('[TextureEditor] Failed to load source image:', error);
      };
      
      // Convert file content to data URL for the image
      if (imageFile.binaryData || imageFile.fileContent.startsWith('data:')) {
        img.src = imageFile.fileContent.startsWith('data:') ? 
                   imageFile.fileContent : 
                   `data:image/png;base64,${imageFile.fileContent}`;
      } else {
        // Handle base64 content
        img.src = `data:image/png;base64,${imageFile.fileContent}`;
      }
      
    } catch (error) {
      console.error('[TextureEditor] Error loading source image from texture:', error);
    }
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
    panel.style.cssText = `
      padding: 8px;
      margin: 0;
      height: calc(100% - 16px);
      overflow: hidden;
    `;
    
    // Main preview layout - horizontal with settings in between
    const previewContainer = document.createElement('div');
    previewContainer.className = 'preview-container-horizontal';
    previewContainer.style.cssText = `
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      gap: 0;
      overflow: auto;
      flex: 1;
      min-height: 0;
    `;
    
    // Original image section
    const originalSection = document.createElement('div');
    originalSection.className = 'preview-section';
    
    const originalHeader = document.createElement('div');
    originalHeader.className = 'preview-header';
    originalHeader.style.cssText = `
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 8px 8px;
  background: #3a3a3a;
  border-bottom: 1px solid #555;
  gap: 10px;
    `;
    
    // Left side of header (title and info button)
    const originalHeaderLeft = document.createElement('div');
    originalHeaderLeft.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    
    const originalTitle = document.createElement('h4');
    originalTitle.textContent = 'Original';
    originalTitle.style.margin = '0';
    
    const originalInfoBtn = document.createElement('button');
    originalInfoBtn.textContent = 'i';
    originalInfoBtn.className = 'info-button';
    originalInfoBtn.addEventListener('click', () => this.showImageInfo('original'));
    
    originalHeaderLeft.appendChild(originalTitle);
    originalHeaderLeft.appendChild(originalInfoBtn);
    
    // Right side of header (zoom controls)
    const originalZoomControls = document.createElement('div');
    originalZoomControls.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    
    const originalZoomLabel = document.createElement('label');
    originalZoomLabel.textContent = 'Zoom:';
    originalZoomLabel.style.cssText = `
      font-size: 12px;
      color: #ccc;
      margin: 0;
    `;
    
    this.originalScaleSlider = document.createElement('input');
    this.originalScaleSlider.type = 'range';
    this.originalScaleSlider.min = '0.1';
    this.originalScaleSlider.max = '4.0';
    this.originalScaleSlider.step = '0.1';
    this.originalScaleSlider.value = '1.0';
    this.originalScaleSlider.style.cssText = `
      width: 80px;
      margin: 0;
    `;
    this.originalScaleSlider.addEventListener('input', () => this.updatePreviewScale());
    
    const originalScaleValue = document.createElement('span');
    originalScaleValue.textContent = '1.0x';
    originalScaleValue.id = 'original-scale-value';
    originalScaleValue.style.cssText = `
      font-size: 11px;
      color: #ccc;
      min-width: 30px;
    `;
    
    // Fit to area button with icon
    const originalFitButton = document.createElement('button');
    originalFitButton.innerHTML = '⌂'; // House/fit icon
    originalFitButton.className = 'fit-button';
    originalFitButton.title = 'Fit to Area';
    originalFitButton.style.cssText = `
      width: 20px;
      height: 20px;
      padding: 0;
      background: #4a9eff;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    originalFitButton.addEventListener('click', () => this.fitOriginalToArea());
    
    originalZoomControls.appendChild(originalZoomLabel);
    originalZoomControls.appendChild(this.originalScaleSlider);
    originalZoomControls.appendChild(originalScaleValue);
    originalZoomControls.appendChild(originalFitButton);
    
    originalHeader.appendChild(originalHeaderLeft);
    originalHeader.appendChild(originalZoomControls);
    originalSection.appendChild(originalHeader);
    
    this.originalCanvas = document.createElement('canvas');
    console.log('[TextureEditor] Canvas created:', !!this.originalCanvas);
    this.originalCanvas.className = 'preview-canvas';
    this.originalCtx = this.originalCanvas.getContext('2d');
    console.log('[TextureEditor] Canvas context created:', !!this.originalCtx);
    
    originalSection.appendChild(this.originalCanvas);
    
    // Add mouse controls for the original canvas
    this.setupCanvasMouseControls(this.originalCanvas, 'original');
    
    // Settings section (between images) - simplified structure
    const settingsSection = document.createElement('div');
    settingsSection.className = 'between-images-settings';
    settingsSection.style.cssText = `
      display: flex;
      flex-direction: row;
      transition: width 0.3s ease;
      overflow: visible;
      min-height: 400px;
      max-height: calc(100vh - 200px);
      width: 20px;
      min-width: 20px;
      margin: 0 10px;
    `;
    
    // Store reference for toggling
    this.settingsSection = settingsSection;
    this.isSettingsCollapsed = true;
    
    // Create collapse/expand toggle bar - this IS the entire settings section when collapsed
    const toggleBar = document.createElement('div');
    toggleBar.className = 'settings-toggle-bar';
    toggleBar.style.cssText = `
      width: 20px;
      background: #4a9eff;
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
      user-select: none;
      border-radius: 4px;
      transition: all 0.3s ease;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      padding: 10px 0px 10px 0px;
      min-height: 100px;
    `;
    toggleBar.textContent = 'Show Settings';
    toggleBar.title = 'Click to show settings panel';
    
    // Create collapsible content container (initially hidden)
    const settingsContent = document.createElement('div');
    settingsContent.className = 'settings-content';
    settingsContent.style.cssText = `
      transition: all 0.3s ease;
      overflow-y: auto;
      overflow-x: hidden;
      max-height: calc(100vh - 200px);
      background: transparent;
      border: none;
      width: 0px;
      min-width: 0;
      padding: 0;
      opacity: 0;
      display: none;
    `;

    // New streamlined palette controls
    console.log('[TextureEditor] About to create palette controls panel');
    const paletteControlsPanel = this.createPaletteControlsPanel();
    console.log('[TextureEditor] Palette controls panel created');
    settingsContent.appendChild(paletteControlsPanel);
    
    // Add toggle functionality
    toggleBar.addEventListener('click', () => {
      this.toggleSettingsPanel();
    });
    
    // Assemble the settings section - only append toggle bar initially
    settingsSection.appendChild(toggleBar);
    settingsSection.appendChild(settingsContent);
    
    // Store references
    this.settingsToggleBar = toggleBar;
    this.settingsContent = settingsContent;
    
    // Texture Output image section
    console.log('[TextureEditor] About to create texture output section');
    const processedSection = document.createElement('div');
    processedSection.className = 'preview-section';
    
    const processedHeader = document.createElement('div');
    processedHeader.className = 'preview-header';
    processedHeader.style.cssText = `
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 8px 8px;
  background: #3a3a3a;
  border-bottom: 1px solid #555;
  gap: 10px;
    `;
    
    // Left side of header (title, size, and info button)
    const processedHeaderLeft = document.createElement('div');
    processedHeaderLeft.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    
    const processedTitle = document.createElement('h4');
    processedTitle.textContent = 'Texture Output';
    processedTitle.style.margin = '0';
    
    const outputSize = document.createElement('span');
    outputSize.className = 'output-size';
    outputSize.id = 'output-size';
    outputSize.textContent = '';
    outputSize.style.cssText = `
      font-size: 12px;
      color: #888;
    `;
    
    const processedInfoBtn = document.createElement('button');
    processedInfoBtn.textContent = 'i';
    processedInfoBtn.className = 'info-button';
    processedInfoBtn.addEventListener('click', () => this.showImageInfo('processed'));
    
    processedHeaderLeft.appendChild(processedTitle);
    processedHeaderLeft.appendChild(outputSize);
    processedHeaderLeft.appendChild(processedInfoBtn);
    
    // Right side of header (zoom controls)
    const processedZoomControls = document.createElement('div');
    processedZoomControls.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    
    const processedZoomLabel = document.createElement('label');
    processedZoomLabel.textContent = 'Zoom:';
    processedZoomLabel.style.cssText = `
      font-size: 12px;
      color: #ccc;
      margin: 0;
    `;
    
    this.processedScaleSlider = document.createElement('input');
    this.processedScaleSlider.type = 'range';
    this.processedScaleSlider.min = '0.1';
    this.processedScaleSlider.max = '4.0';
    this.processedScaleSlider.step = '0.1';
    this.processedScaleSlider.value = '1.0';
    this.processedScaleSlider.style.cssText = `
      width: 80px;
      margin: 0;
    `;
    this.processedScaleSlider.addEventListener('input', () => this.updatePreviewScale());
    
    const processedScaleValue = document.createElement('span');
    processedScaleValue.textContent = '1.0x';
    processedScaleValue.id = 'processed-scale-value';
    processedScaleValue.style.cssText = `
      font-size: 11px;
      color: #ccc;
      min-width: 30px;
    `;
    
    // Fit to area button with icon
    const processedFitButton = document.createElement('button');
    processedFitButton.innerHTML = '⌂'; // House/fit icon
    processedFitButton.className = 'fit-button';
    processedFitButton.title = 'Fit to Area';
    processedFitButton.style.cssText = `
      width: 20px;
      height: 20px;
      padding: 0;
      background: #4a9eff;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    processedFitButton.addEventListener('click', () => this.fitProcessedToArea());
    
    processedZoomControls.appendChild(processedZoomLabel);
    processedZoomControls.appendChild(this.processedScaleSlider);
    processedZoomControls.appendChild(processedScaleValue);
    processedZoomControls.appendChild(processedFitButton);
    
    processedHeader.appendChild(processedHeaderLeft);
    processedHeader.appendChild(processedZoomControls);
    processedSection.appendChild(processedHeader);
    
    this.outputCanvas = document.createElement('canvas');
    this.outputCanvas.className = 'preview-canvas';
    // D2Canvas (WebGL 2) is initialized lazily on first render via _initGpu()
    this.outputCtx = null;
    this._gpu = null;
    this._gpuTex = null;
    console.log('[TextureEditor] Texture output canvas created:', !!this.outputCanvas);
    processedSection.appendChild(this.outputCanvas);
    
    // Add mouse controls for the output canvas
    this.setupCanvasMouseControls(this.outputCanvas, 'output');
    
    previewContainer.appendChild(originalSection);
    previewContainer.appendChild(settingsSection);
    previewContainer.appendChild(processedSection);
    
    // Create main panel structure with simple horizontal layout
    panel.appendChild(previewContainer);
    
    console.log('[TextureEditor] createPreviewPanel() completed - outputCanvas:', !!this.outputCanvas);
    
    return panel;
  }

  updatePreviewScale() {
    // NOTE: These scale sliders are for PREVIEW DISPLAY only
    // They do not affect the actual texture metadata scale
    
    // Handle original image scale (preview display only)
    let originalScale = 1.0;
    if (this.originalScaleSlider) {
      originalScale = parseFloat(this.originalScaleSlider.value);
      const originalScaleValue = document.getElementById('original-scale-value');
      if (originalScaleValue) {
        originalScaleValue.textContent = `${originalScale}x`;
      }
    }
    
    // Handle processed image scale (preview display only)
    let processedScale = 1.0;
    if (this.processedScaleSlider) {
      processedScale = parseFloat(this.processedScaleSlider.value);
      const processedScaleValue = document.getElementById('processed-scale-value');
      if (processedScaleValue) {
        processedScaleValue.textContent = `${processedScale}x`;
      }
    }
    
    console.log('[TextureEditor] updatePreviewScale called with PREVIEW scales:', originalScale, processedScale);
    console.log('[TextureEditor] Actual texture metadata scale remains:', this.textureData.scale);
    
    // Update canvas display size while maintaining native resolution and aspect ratio
    if (this.originalCanvas && this.sourceImage) {
      console.log('[TextureEditor] Source image native dimensions:', this.sourceImage.width, 'x', this.sourceImage.height);
      console.log('[TextureEditor] Calculated aspect ratio:', (this.sourceImage.width / this.sourceImage.height).toFixed(3));
      
      // Calculate display dimensions based on native size * preview scale
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
      // Use the processed scale slider for output canvas preview display
      const processedDisplayWidth = Math.round(this.sourceImage.width * processedScale);
      const processedDisplayHeight = Math.round(this.sourceImage.height * processedScale);
      
      console.log('[TextureEditor] Output canvas using processed preview scale:', processedScale);
      console.log('[TextureEditor] Output display dimensions:', processedDisplayWidth, 'x', processedDisplayHeight);
      
      this.outputCanvas.style.setProperty('width', `${processedDisplayWidth}px`, 'important');
      this.outputCanvas.style.setProperty('height', `${processedDisplayHeight}px`, 'important');
      
      const previewComputedStyle = window.getComputedStyle(this.outputCanvas);
      console.log('[TextureEditor] Output canvas computed dimensions:', previewComputedStyle.width, 'x', previewComputedStyle.height);
      console.log('[TextureEditor] Output canvas native resolution:', this.outputCanvas.width, 'x', this.outputCanvas.height);
      console.log('[TextureEditor] Actual texture metadata scale remains:', this.textureData.scale);
    }
    
    console.log('[TextureEditor] Applied native resolution scaling - scroll bars will appear if needed');
  }

  setupCanvasMouseControls(canvas, canvasType) {
    console.log(`[TextureEditor] Setting up mouse controls for ${canvasType} canvas`);
    
    if (!canvas) {
      console.warn(`[TextureEditor] No canvas provided for ${canvasType} mouse controls`);
      return;
    }

    // Get the canvas container (parent element)
    const canvasContainer = canvas.parentElement;
    if (!canvasContainer) {
      console.warn(`[TextureEditor] No container found for ${canvasType} canvas`);
      return;
    }

    // Add wheel event for zoom and scroll
    canvasContainer.addEventListener('wheel', (e) => {
      e.preventDefault(); // Prevent default scroll behavior
      
      if (e.ctrlKey || e.metaKey) {
        // Pinch-to-zoom (Ctrl+scroll or Cmd+scroll on Mac)
        const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
        
        // Get the appropriate zoom slider
        const scaleSlider = canvasType === 'original' ? this.originalScaleSlider : this.processedScaleSlider;
        if (scaleSlider) {
          const currentZoom = parseFloat(scaleSlider.value);
          const newZoom = Math.max(0.1, Math.min(8.0, currentZoom + zoomDelta));
          scaleSlider.value = newZoom;
          
          // Trigger the scale update
          this.updatePreviewScale();
          
          console.log(`[TextureEditor] ${canvasType} canvas zoom changed to ${newZoom}x via wheel`);
        }
      } else {
        // Normal scroll - handle manually for better control
        const scrollDelta = e.deltaY;
        canvasContainer.scrollTop += scrollDelta;
        
        // Handle horizontal scroll if shift is held or if there's deltaX
        if (e.shiftKey) {
          canvasContainer.scrollLeft += e.deltaX || scrollDelta;
        } else {
          canvasContainer.scrollLeft += e.deltaX;
        }
      }
    }, { passive: false });

    // Add trackpad gesture support (for macOS and some Windows trackpads)
    let initialZoom = 1.0;
    
    canvasContainer.addEventListener('gesturestart', (e) => {
      e.preventDefault();
      const scaleSlider = canvasType === 'original' ? this.originalScaleSlider : this.processedScaleSlider;
      if (scaleSlider) {
        initialZoom = parseFloat(scaleSlider.value);
      }
    });
    
    canvasContainer.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      const scaleSlider = canvasType === 'original' ? this.originalScaleSlider : this.processedScaleSlider;
      if (scaleSlider && initialZoom) {
        const newZoom = Math.max(0.1, Math.min(8.0, initialZoom * e.scale));
        scaleSlider.value = newZoom;
        this.updatePreviewScale();
        
        console.log(`[TextureEditor] ${canvasType} canvas zoom changed to ${newZoom}x via gesture`);
      }
    });

    // Make sure the container can scroll
    canvasContainer.style.overflow = 'auto';
    canvasContainer.style.cursor = 'default';
    
    console.log(`[TextureEditor] Mouse controls added to ${canvasType} canvas`);
  }

  toggleSettingsPanel() {
    this.isSettingsCollapsed = !this.isSettingsCollapsed;
    
    if (this.isSettingsCollapsed) {
      // Collapse the settings panel
      this.settingsSection.style.width = '20px'; // Just wide enough for toggle button
      this.settingsSection.style.minWidth = '20px';
      this.settingsContent.style.width = '0px';
      this.settingsContent.style.opacity = '0';
      this.settingsContent.style.padding = '0';
      this.settingsContent.style.minWidth = '0';
      this.settingsContent.style.overflow = 'hidden';
      this.settingsContent.style.display = 'none';
      
      // Update toggle bar text only
      this.settingsToggleBar.textContent = 'Show Settings';
      this.settingsToggleBar.title = 'Click to expand settings panel';
      
      console.log('[TextureEditor] Settings panel collapsed');
    } else {
      // Expand the settings panel
      this.settingsSection.style.width = 'auto'; // Allow full width
      this.settingsSection.style.minWidth = 'auto';
      this.settingsContent.style.width = 'auto';
      this.settingsContent.style.opacity = '1';
      this.settingsContent.style.padding = '5px';
      this.settingsContent.style.minWidth = '250px';
      this.settingsContent.style.overflowY = 'auto';
      this.settingsContent.style.overflowX = 'hidden';
      this.settingsContent.style.maxHeight = 'calc(100vh - 200px)'; // Allow scrolling but limit height
      this.settingsContent.style.display = 'block';
      
      // Update toggle bar text only
      this.settingsToggleBar.textContent = 'Hide Settings';
      this.settingsToggleBar.title = 'Click to collapse settings panel';
      
      console.log('[TextureEditor] Settings panel expanded');
    }
  }

  /**
   * Update the original image canvas with the loaded source image
   */
  updateOriginalImageCanvas() {
    console.log('[TextureEditor] updateOriginalImageCanvas() called');
    
    if (!this.originalCanvas || !this.originalCtx) {
      console.log('[TextureEditor] Original canvas or context not available');
      return;
    }
    
    if (!this.sourceImage && !this.textureData?.sourceImageData) {
      console.log('[TextureEditor] No source image data available');
      return;
    }
    
    try {
      let imageToDisplay = this.sourceImage;
      let width, height;
      
      if (imageToDisplay) {
        // Use the loaded Image element
        width = imageToDisplay.width;
        height = imageToDisplay.height;
      } else if (this.textureData.sourceImageData) {
        // Use the ImageData from texture data
        width = this.textureData.width;
        height = this.textureData.height;
      } else {
        console.log('[TextureEditor] No valid image source found');
        return;
      }
      
      console.log('[TextureEditor] Updating original canvas with image:', width, 'x', height);
      
      // Set canvas native resolution to match image
      this.originalCanvas.width = width;
      this.originalCanvas.height = height;
      
      // Clear the canvas
      this.originalCtx.clearRect(0, 0, width, height);
      
      if (imageToDisplay) {
        // Draw the Image element
        this.originalCtx.drawImage(imageToDisplay, 0, 0);
      } else if (this.textureData.sourceImageData) {
        // Draw the ImageData
        this.originalCtx.putImageData(this.textureData.sourceImageData, 0, 0);
      }
      
      console.log('[TextureEditor] Original canvas updated successfully');
      
      // Update the display scaling
      this.updatePreviewScale();
      
    } catch (error) {
      console.error('[TextureEditor] Error updating original image canvas:', error);
    }
  }

  setupCropControls() {
    if (!this.originalCanvas) return;
    
    // Make canvas position relative for proper mouse coordinates
    this.originalCanvas.style.position = 'relative';
    this.originalCanvas.style.cursor = 'crosshair';
    
    // Mouse event handlers for crop selection
    this.originalCanvas.addEventListener('mousedown', (e) => {
      this.startCropSelection(e);
    });
    
    this.originalCanvas.addEventListener('mousemove', (e) => {
      this.updateCropSelection(e);
    });
    
    this.originalCanvas.addEventListener('mouseup', (e) => {
      this.endCropSelection(e);
    });
    
    // Prevent context menu on right click
    this.originalCanvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    
    console.log('[TextureEditor] Crop controls set up');
  }

  createPaletteControlsPanel() {
    const panel = document.createElement('div');
    panel.className = 'palette-controls-panel';
    panel.style.cssText = `
      padding: 8px;
      background: #2a2a2a;
      border-radius: 6px;
      margin-bottom: 8px;
    `;

    // Color Depth Section
    const colorDepthSection = document.createElement('div');
    colorDepthSection.className = 'color-depth-section';
    colorDepthSection.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid #444;
    `;

    const colorDepthLabel = document.createElement('label');
    colorDepthLabel.textContent = 'Color Depth:';
    colorDepthLabel.style.cssText = `
      font-weight: bold;
      color: #ddd;
      min-width: 100px;
    `;

    const arrow = document.createElement('span');
    arrow.textContent = '→';
    arrow.style.cssText = `
      color: #888;
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

    // Output Format Section
    const formatSection = document.createElement('div');
    formatSection.className = 'format-section';
    formatSection.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid #444;
    `;

    const formatLabel = document.createElement('label');
    formatLabel.innerHTML = 'Output Format: <span style="color: #4a9eff;">Indexed 8-bit</span>';
    formatLabel.style.cssText = `
      color: #ddd;
      font-weight: 500;
      white-space: nowrap;
      flex: 1;
    `;
    
    // Store reference for updates
    this.formatLabel = formatLabel;

    const formatArrow = document.createElement('span');
    formatArrow.textContent = '→';
    formatArrow.style.cssText = `
      color: #888;
      font-size: 16px;
      margin: 0 5px;
    `;

    this.formatSelectBtn = document.createElement('button');
    this.formatSelectBtn.className = 'format-select-btn';
    this.formatSelectBtn.textContent = 'Select Format';
    this.formatSelectBtn.style.cssText = `
      padding: 8px 15px;
      background: #4a9eff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
      font-family: 'Courier New', monospace;
      font-size: 12px;
    `;

    // Add hover effect
    this.formatSelectBtn.addEventListener('mouseenter', () => {
      this.formatSelectBtn.style.background = '#3a8eef';
    });
    this.formatSelectBtn.addEventListener('mouseleave', () => {
      this.formatSelectBtn.style.background = '#4a9eff';
    });

    // Add click handler to show format selection modal
    this.formatSelectBtn.addEventListener('click', () => this.showFormatSelectionModal());

    formatSection.appendChild(formatLabel);
    formatSection.appendChild(formatArrow);
    formatSection.appendChild(this.formatSelectBtn);

    // Store the format label for updates
    this.formatLabel = formatLabel;

    // Options Section (Compression + Pre-Rotation)
    const optionsSection = document.createElement('div');
    optionsSection.className = 'options-section';
    optionsSection.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid #444;
    `;

    // RLE Compression checkbox
    const compressionRow = document.createElement('label');
    compressionRow.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      color: #ddd;
      font-size: 12px;
      cursor: pointer;
    `;
    this.compressionCheckbox = document.createElement('input');
    this.compressionCheckbox.type = 'checkbox';
    this.compressionCheckbox.checked = false;
    this.compressionCheckbox.style.cssText = 'accent-color: #4a9eff; cursor: pointer;';
    this.compressionCheckbox.addEventListener('change', () => {
      this.textureData.compressionType = this.compressionCheckbox.checked ? 'rle' : 'none';
      this.onSettingsChanged();
    });
    const compressionLabel = document.createElement('span');
    compressionLabel.textContent = 'RLE Compression (TGA-style)';
    compressionRow.appendChild(this.compressionCheckbox);
    compressionRow.appendChild(compressionLabel);

    // Pre-rotation checkbox
    const rotationRow = document.createElement('label');
    rotationRow.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      color: #ddd;
      font-size: 12px;
      cursor: pointer;
    `;
    this.preRotateCheckbox = document.createElement('input');
    this.preRotateCheckbox.type = 'checkbox';
    this.preRotateCheckbox.checked = true; // Default ON — always start checked
    this.preRotateCheckbox.style.cssText = 'accent-color: #4a9eff; cursor: pointer;';
    this.preRotateCheckbox.addEventListener('change', () => {
      if (!this.preRotateCheckbox.checked) {
        // User is trying to uncheck — show confirmation popup
        if (!confirm('Without pre-rotation, textures draw slower on hardware.\n\nAre you sure you want to disable it?')) {
          this.preRotateCheckbox.checked = true;
          return; // User cancelled — keep pre-rotation on
        }
      }
      this.textureData.rotation = this.preRotateCheckbox.checked ? 90 : 0;
      this.onSettingsChanged();
    });
    const rotationLabel = document.createElement('span');
    rotationLabel.textContent = 'Pre-rotate 90° (faster draw)';
    rotationRow.appendChild(this.preRotateCheckbox);
    rotationRow.appendChild(rotationLabel);

    // Color Key checkbox + color picker
    const colorKeyRow = document.createElement('label');
    colorKeyRow.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      color: #ddd;
      font-size: 12px;
      cursor: pointer;
    `;
    this.colorKeyCheckbox = document.createElement('input');
    this.colorKeyCheckbox.type = 'checkbox';
    this.colorKeyCheckbox.checked = this.textureData.useColorKey;
    this.colorKeyCheckbox.style.cssText = 'accent-color: #4a9eff; cursor: pointer;';
    this.colorKeyCheckbox.addEventListener('change', () => {
      this.textureData.useColorKey = this.colorKeyCheckbox.checked;
      this._updateColorKeyPickerVisibility();
      this.onSettingsChanged();
    });
    const colorKeyLabel = document.createElement('span');
    colorKeyLabel.textContent = 'Color Key (index 0 = transparent)';
    colorKeyRow.appendChild(this.colorKeyCheckbox);
    colorKeyRow.appendChild(colorKeyLabel);

    // Color key color picker (inline, shown when checkbox is checked)
    this.colorKeyPickerRow = document.createElement('div');
    this.colorKeyPickerRow.style.cssText = `
      display: none;
      align-items: center;
      gap: 8px;
      padding-left: 24px;
      font-size: 12px;
      color: #ddd;
    `;
    const colorKeyPickerLabel = document.createElement('span');
    colorKeyPickerLabel.textContent = 'Key Color:';
    this.colorKeyPicker = document.createElement('input');
    this.colorKeyPicker.type = 'color';
    this.colorKeyPicker.value = this.textureData.transparentColor || '#FF00FF';
    this.colorKeyPicker.style.cssText = 'width:32px;height:22px;border:1px solid #555;border-radius:3px;cursor:pointer;padding:0;background:none;';
    this.colorKeyPicker.addEventListener('input', () => {
      this.textureData.transparentColor = this.colorKeyPicker.value;
    });
    this.colorKeyPicker.addEventListener('change', () => {
      this.textureData.transparentColor = this.colorKeyPicker.value;
      this.onSettingsChanged();
    });
    this.colorKeyPickerRow.appendChild(colorKeyPickerLabel);
    this.colorKeyPickerRow.appendChild(this.colorKeyPicker);

    optionsSection.appendChild(compressionRow);
    optionsSection.appendChild(rotationRow);
    optionsSection.appendChild(colorKeyRow);
    optionsSection.appendChild(this.colorKeyPickerRow);

    this._updateColorKeyPickerVisibility();

    // Set initial visibility of options based on current format
    this.updateOptionsVisibility();

    // Action Buttons Section
    const actionSection = document.createElement('div');
    actionSection.className = 'action-section';
    actionSection.style.cssText = `
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
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
      flex: 1;
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

    this.applyBtn.addEventListener('click', () => this.applyPaletteToImage(true));
    
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

    // Best Fit Button — re-matches all pixels to the current palette slice
    this.bestFitBtn = document.createElement('button');
    this.bestFitBtn.textContent = 'Best Fit';
    this.bestFitBtn.className = 'best-fit-btn';
    this.bestFitBtn.disabled = true;
    this.bestFitBtn.style.cssText = `
      flex: 1;
      padding: 12px;
      background: #4a5a8a;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      opacity: 0.5;
    `;
    this.bestFitBtn.title = 'Re-match all pixel indices to best-fit the current palette';

    this.bestFitBtn.addEventListener('click', () => {
      // Force a full re-match by clearing cached reduction result
      this.lastReductionResult = null;
      this.applyPaletteToImage(true);
    });

    this.bestFitBtn.addEventListener('mouseenter', () => {
      if (!this.bestFitBtn.disabled) {
        this.bestFitBtn.style.background = '#5a6a9a';
      }
    });
    this.bestFitBtn.addEventListener('mouseleave', () => {
      if (!this.bestFitBtn.disabled) {
        this.bestFitBtn.style.background = '#4a5a8a';
      }
    });

    // Container for Apply + Best Fit buttons (side-by-side)
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;width:100%;';

    // Metadata Display Section
    const metadataSection = document.createElement('div');
    metadataSection.className = 'metadata-section';
    metadataSection.style.cssText = `
      margin-bottom: 15px;
      padding-top: 15px;
      border-top: 1px solid #444;
    `;

    const metadataTitle = document.createElement('h5');
    metadataTitle.textContent = 'Texture Metadata';
    metadataTitle.style.cssText = `
      color: #4a9eff;
      margin: 0 0 10px 0;
      font-size: 12px;
      font-weight: 600;
    `;
    metadataSection.appendChild(metadataTitle);

    this.metadataDisplay = document.createElement('div');
    this.metadataDisplay.className = 'metadata-display';
    this.metadataDisplay.style.cssText = `
      font-family: 'Courier New', monospace;
      font-size: 11px;
      color: #ccc;
      line-height: 1.4;
      background: #1a1a1a;
      padding: 8px;
      border-radius: 3px;
      border: 1px solid #333;
    `;
    metadataSection.appendChild(this.metadataDisplay);

    // Update metadata display
    this.updateMetadataDisplay();

    // Assemble the panel
    panel.appendChild(formatSection);
    panel.appendChild(optionsSection);
    panel.appendChild(actionSection);
    panel.appendChild(this.paletteDisplay);
    panel.appendChild(metadataSection);
    btnRow.appendChild(this.applyBtn);
    btnRow.appendChild(this.bestFitBtn);
    panel.appendChild(btnRow);

    // Initialize state
    this.currentPaletteMode = null; // 'load' or 'extract'
    this.currentPalette = null;

    return panel;
  }

  updateMetadataDisplay() {
    if (!this.metadataDisplay || !this.textureData) return;

    const metadata = this.textureData.metadata;
    const metadataItems = [
      `Source: ${metadata.sourceImagePath || 'None'}`,
      `Palette: ${metadata.palettePath || 'None'}`,
      `Format: ${metadata.outputPixelFormat}`,
      `Scale: ${metadata.scale}x`,
      `Palette Offset: ${metadata.paletteOffset || 0}`,
      `Compression: ${this.textureData.compressionType || 'none'}`,
      `Pre-rotate: ${this.textureData.rotation ? this.textureData.rotation + '°' : 'off'}`
    ];

    this.metadataDisplay.innerHTML = metadataItems.map(item => 
      `<div style="margin-bottom: 2px;">${item}</div>`
    ).join('');
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
  
  calculateAutoFitScale(imageWidth, imageHeight) {
    // Get the available space for the original canvas container
    // Assume a reasonable max display size (adjust these values as needed)
    const maxDisplayWidth = 300;  // Maximum width for the original canvas display
    const maxDisplayHeight = 300; // Maximum height for the original canvas display
    
    // Calculate scale to fit within the container while maintaining aspect ratio
    const scaleX = maxDisplayWidth / imageWidth;
    const scaleY = maxDisplayHeight / imageHeight;
    
    // Use the smaller scale to ensure the image fits completely
    const autoFitScale = Math.min(scaleX, scaleY, 1.0); // Don't scale up, only down
    
    // Round to reasonable precision
    return Math.round(autoFitScale * 100) / 100;
  }
  
  fitOriginalToArea() {
    if (this.sourceImage) {
      const autoFitScale = this.calculateAutoFitScale(this.sourceImage.width, this.sourceImage.height);
      
      // Update the preview scale slider
      if (this.originalScaleSlider) {
        this.originalScaleSlider.value = autoFitScale;
      }
      
      // Update the preview display
      this.updatePreviewScale();
      
      console.log('[TextureEditor] Fit original to area - scale set to:', autoFitScale);
    }
  }
  
  fitProcessedToArea() {
    if (this.sourceImage) {
      const autoFitScale = this.calculateAutoFitScale(this.sourceImage.width, this.sourceImage.height);
      
      // Update the preview scale slider
      if (this.processedScaleSlider) {
        this.processedScaleSlider.value = autoFitScale;
      }
      
      // Update the preview display
      this.updatePreviewScale();
      
      console.log('[TextureEditor] Fit processed to area - scale set to:', autoFitScale);
    }
  }

  setImageToCanvas(img, resolve) {
    console.log('[TextureEditor] setImageToCanvas - loading image into custom ImageData class');
    
    this.sourceImage = img;
    // Only update source references if not already set (e.g. loaded from .texture JSON)
    if (!this.textureData.sourceImage || this.textureData.sourceImage === 'unknown') {
      this.textureData.sourceImage = this.getFileName() || 'unknown';
    }
    if (!this.textureData.sourceImagePath || this.textureData.sourceImagePath === 'unknown') {
      this.textureData.sourceImagePath = this.path || this.getFileName() || 'unknown';
    }
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
    
    // Calculate auto-fit scale for the original canvas container
    const autoFitScale = this.calculateAutoFitScale(img.width, img.height);
    console.log('[TextureEditor] Auto-fit scale calculated:', autoFitScale);
    
    // Update the texture metadata scale (this is the actual texture scale)
    this.textureData.scale = autoFitScale;
    
    // Set initial canvas display size to auto-fit scale
    const displayWidth = Math.round(img.width * autoFitScale);
    const displayHeight = Math.round(img.height * autoFitScale);
    this.originalCanvas.style.setProperty('width', `${displayWidth}px`, 'important');
    this.originalCanvas.style.setProperty('height', `${displayHeight}px`, 'important');
    
    // Update the scale slider to reflect the auto-fit scale (for preview purposes only)
    if (this.originalScaleSlider) {
      this.originalScaleSlider.value = autoFitScale;
      const originalScaleValue = document.getElementById('original-scale-value');
      if (originalScaleValue) {
        originalScaleValue.textContent = `${autoFitScale}x`;
      }
    }
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

    // Auto-load default palette if available AND format is indexed
    if (TextureData.isIndexedFormat(this.textureData.outputPixelFormat)) {
      this.autoLoadDefaultPalette();
    } else {
      console.log('[TextureEditor] Skipping palette auto-load — format is not indexed:', this.textureData.outputPixelFormat);
    }
    
    // Check if we can auto-generate texture output now that image is loaded
    setTimeout(() => {
      this.checkAndAutoGenerateTexture();
    }, 200); // Small delay to allow palette loading to complete
    
    // Auto-save linked texture file if we're creating from an image
    if (this.isCreatingFromImage && this.path) {
      setTimeout(() => {
        this.autoSaveLinkedTextureFile();
      }, 500); // Give time for UI setup to complete
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
      this.textureData.compressionType = this.compressionCheckbox.checked ? 'rle' : 'none';
    }
    if (this.preRotateCheckbox) {
      this.textureData.rotation = this.preRotateCheckbox.checked ? 90 : 0;
    }
    
    // Update metadata display to reflect new settings
    this.updateMetadataDisplay();
    
    // Re-apply the palette with the new settings so the output canvas
    // reflects the change immediately (e.g. rotation, compression).
    // This is better than processTexture() which only does color-depth
    // reduction and leaves the output canvas stale.
    this.checkAndAutoGenerateTexture();
    
    this.markDirty();
  }

  updateRotationWarning() {
    // No-op: rotation warning is now a confirm() popup on uncheck, not a persistent label
  }

  /**
   * Show/hide options based on the current output pixel format.
   * RLE compression is only supported for 8-bit indexed (d2_mode_i8).
   */
  updateOptionsVisibility() {
    if (!this.compressionCheckbox) return;
    const format = this.textureData.outputPixelFormat;
    const rleSupported = (format === 'd2_mode_i8');
    const row = this.compressionCheckbox.closest('label');
    if (row) {
      row.style.display = rleSupported ? 'flex' : 'none';
    }
    // If hiding RLE, also uncheck it so it doesn't persist
    if (!rleSupported && this.compressionCheckbox.checked) {
      this.compressionCheckbox.checked = false;
      this.textureData.compressionType = 'none';
    }

    // Color key is only meaningful for indexed (paletted) formats without
    // a native alpha channel.  Hide for RGB/RGBA and alpha-only formats.
    const isIndexed = TextureData.isIndexedFormat(format) && format !== 'd2_mode_ai44';
    if (this.colorKeyCheckbox) {
      const ckRow = this.colorKeyCheckbox.closest('label');
      if (ckRow) ckRow.style.display = isIndexed ? 'flex' : 'none';
      if (!isIndexed) {
        this.colorKeyPickerRow.style.display = 'none';
      } else {
        this._updateColorKeyPickerVisibility();
      }
    }
  }

  /**
   * Show/hide the color key color picker based on the checkbox state.
   */
  _updateColorKeyPickerVisibility() {
    if (!this.colorKeyPickerRow || !this.colorKeyCheckbox) return;
    this.colorKeyPickerRow.style.display = this.colorKeyCheckbox.checked ? 'flex' : 'none';
  }

  /**
   * Refresh the palette display for the current format.
   * Called directly from showFormatSelectionModal as a safety net
   * (in case the metadataChanged event handler is orphaned).
   */
  refreshPaletteForFormat() {
    if (this.currentPalette) {
      const colors = this.currentPalette.getColors ? this.currentPalette.getColors() : this.currentPalette;
      this.displayPalette(colors);
    } else if (this.textureData.palette && this.textureData.palette.length > 0) {
      this.displayPalette(this.textureData.palette);
    }
  }

  updatePaletteVisibility() {
    // Only update if DOM elements exist
    if (this.paletteContainer) {
      const isIndexed = TextureData.isIndexedFormat(this.textureData?.outputPixelFormat);
      this.paletteContainer.style.display = isIndexed ? 'block' : 'none';
    }
  }

  // Auto-load default palette if configured
  async autoLoadDefaultPalette() {
    if (!window.ProjectConfigManager) return;
    
    const defaultPalettePath = window.ProjectConfigManager.getDefaultPalette();
    if (!defaultPalettePath) {
      console.log('[TextureEditor] No default palette configured');
      return;
    }

    try {
      console.log(`[TextureEditor] Auto-loading default palette: ${defaultPalettePath}`);
      
      // Check if file exists
      if (window.fileIOService) {
        const exists = await window.fileIOService.fileExists(defaultPalettePath);
        if (!exists) {
          console.warn(`[TextureEditor] Default palette file not found: ${defaultPalettePath}`);
          return;
        }

        // Load the palette file
        const paletteData = await window.fileIOService.readFile(defaultPalettePath);
        const palette = new Palette();
        
        // Load based on file extension
        const extension = defaultPalettePath.split('.').pop().toLowerCase();
        let loadResult;
        
        switch (extension) {
          case 'pal':
            loadResult = palette.loadFromPAL(paletteData);
            break;
          case 'act':
            loadResult = palette.loadFromACT(paletteData);
            break;
          case 'aco':
            loadResult = palette.loadFromACO(paletteData);
            break;
          default:
            console.warn(`[TextureEditor] Unsupported palette format: ${extension}`);
            return;
        }

        if (loadResult.success) {
          this.textureData.palette = palette;
          this.updatePaletteDisplay();
          console.log(`[TextureEditor] Default palette loaded successfully: ${palette.colors.length} colors`);
          
          // Reprocess texture if we're in an indexed color mode
          if (this.textureData.colorDepth <= 8) {
            this.processTexture();
          }
        } else {
          console.error(`[TextureEditor] Failed to load default palette: ${loadResult.error}`);
        }
      }
    } catch (error) {
      console.error(`[TextureEditor] Error auto-loading default palette:`, error);
    }
  }

  processTexture() {
    if (!this.textureData.sourceImageData) return;
    
    // Start with source image data — use NativeImageData for canvas putImageData() compatibility
    const NID = window.NativeImageData || window.ImageData;
    let imageData = new NID(
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
    
    const NID = window.NativeImageData || window.ImageData;
    return new NID(data, imageData.width, imageData.height);
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
    
    const NID = window.NativeImageData || window.ImageData;
    return new NID(data, imageData.width, imageData.height);
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
    
    const NID = window.NativeImageData || window.ImageData;
    return new NID(data, imageData.width, imageData.height);
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
    
    const NID = window.NativeImageData || window.ImageData;
    return new NID(data, imageData.width, imageData.height);
  }

  convertTo24Bit(imageData) {
    // Remove alpha channel
    const data = new Uint8ClampedArray(imageData.data);
    
    for (let i = 0; i < data.length; i += 4) {
      data[i + 3] = 255; // Full opacity
    }
    
    const NID = window.NativeImageData || window.ImageData;
    return new NID(data, imageData.width, imageData.height);
  }

  updatePreview() {
    if (!this.textureData.processedImageData) return;
    // GPU handles rendering; this method is only needed for 2D fallback
    if (this._gpu) return;
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
      
      // Re-register metadata event listener on the new textureData instance
      this.setupMetadataEventListeners();
      
      this.updateUIFromData();
      
      // If there's a source image path, load the source image
      if (this.textureData.sourceImagePath) {
        console.log('[TextureEditor] Found source image path in texture data:', this.textureData.sourceImagePath);
        this.loadSourceImageFromTexture();
      }
    } catch (error) {
      console.error('[TextureEditor] Failed to parse content:', error);
    }
  }

  // Load texture data from .texture file
  loadFileContent() {
    console.log('[TextureEditor] loadFileContent() called');
    console.log('[TextureEditor] this.file:', this.file);
    console.log('[TextureEditor] this.file?.fileContent:', this.file?.fileContent);
    
    if (!this.file || !this.file.fileContent) {
      console.error('[TextureEditor] No file content available to load');
      console.error('[TextureEditor] file exists:', !!this.file);
      console.error('[TextureEditor] fileContent exists:', !!this.file?.fileContent);
      return;
    }

    try {
      let content = this.file.fileContent;
      console.log('[TextureEditor] Raw file content:', content);
      console.log('[TextureEditor] Content type:', typeof content);
      console.log('[TextureEditor] Content length:', content.length);
      
      // If content is base64 encoded, decode it first
      if (typeof content === 'string' && content.length > 0) {
        try {
          // Try to decode base64 content
          const decodedContent = atob(content);
          content = decodedContent;
          console.log('[TextureEditor] Decoded base64 content:', content);
        } catch (e) {
          // If it fails, assume it's already plain text JSON
          console.log('[TextureEditor] Content is not base64, treating as plain text');
        }
      }
      
      console.log('[TextureEditor] Loading texture data from file content');
      this.setContent(content);
    } catch (error) {
      console.error('[TextureEditor] Failed to load file content:', error);
    }
  }

  updateUIFromData() {
    if (!this.textureData) return;
    
    // Update controls
    const selectedFormat = ImageData.getTextureFormatOptions().find(option => option.value === this.textureData.outputPixelFormat);
    if (!selectedFormat) {
      throw new Error(`Unsupported texture outputPixelFormat: ${this.textureData.outputPixelFormat}`);
    }

    if (this.colorDepthSelect) this.colorDepthSelect.value = selectedFormat.bitsPerPixel;
    if (this.formatLabel) {
      this.formatLabel.innerHTML = `Output Format: <span style="color: #4a9eff;">${selectedFormat.label}</span>`;
    }
    if (this.compressionCheckbox) this.compressionCheckbox.checked = (this.textureData.compressionType === 'rle');
    if (this.preRotateCheckbox) {
      this.preRotateCheckbox.checked = (this.textureData.rotation === 90);
      this.updateRotationWarning();
    }
    if (this.colorKeyCheckbox) {
      this.colorKeyCheckbox.checked = !!this.textureData.useColorKey;
      this._updateColorKeyPickerVisibility();
    }
    if (this.colorKeyPicker) {
      this.colorKeyPicker.value = this.textureData.transparentColor || '#FF00FF';
    }
    if (this.paletteSizeSelect) this.paletteSizeSelect.value = this.textureData.paletteSize;
    if (this.paletteOffsetSlider) this.paletteOffsetSlider.value = this.textureData.paletteOffset;
    
    this.updatePaletteVisibility();
    this.updateOptionsVisibility();
  }

  setOutputFormatForColorDepth(colorDepth) {
    const formatByDepth = new Map([
      [1, 'd2_mode_i1'],
      [2, 'd2_mode_i2'],
      [4, 'd2_mode_i4'],
      [8, 'd2_mode_i8'],
      [16, 'd2_mode_rgb565'],
      [24, 'd2_mode_rgb888'],
      [32, 'd2_mode_rgba8888'],
    ]);

    const format = formatByDepth.get(colorDepth);
    if (!format) {
      throw new Error(`Unsupported texture color depth: ${colorDepth}`);
    }

    this.textureData.outputPixelFormat = format;
    this.textureData.colorDepth = colorDepth;
    this._saveTextureJson();
  }

  // Override save method to handle image-to-texture conversion
  save() {
    if (this.isCreatingFromImage && this.path) {
      // When creating from an image, save as a .texture file in the same directory
      const originalPath = this.path;
      const pathParts = originalPath.split('/');
      const fileName = pathParts.pop();
      const directory = pathParts.join('/');
      const baseName = fileName.substring(0, fileName.lastIndexOf('.'));
      const texturePath = directory ? `${directory}/${baseName}.texture` : `${baseName}.texture`;
      
      console.log(`[TextureEditor] Creating linked texture file: ${texturePath} for image: ${originalPath}`);
      
      // Update the texture data with the source image reference
      this.textureData.sourceImage = originalPath;
      this.textureData.sourceImagePath = originalPath;
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

  // Auto-save linked texture file when image is loaded
  async autoSaveLinkedTextureFile() {
    if (!this.isCreatingFromImage || !this.path || !this.textureData) {
      return;
    }

    try {
      const originalPath = this.path;
      console.log(`[TextureEditor] Original image path: ${originalPath}`);
      
      // Try multiple ways to get the current active project context
      let currentProject = window.gameEmulator?.currentProject;
      if (!currentProject && window.gameEmulator?.projectExplorer) {
        // Try to get from project explorer
        currentProject = window.gameEmulator.projectExplorer.getCurrentProject?.();
      }
      if (!currentProject) {
        // Try to extract from the full path we know works (from tab manager)
        // The tab manager showed: test/Sources/Images/Animating-A-Sprite.png
        // But our originalPath is: Sources/Images/Animating-A-Sprite.png
        // So we can infer the project from context
        currentProject = 'test'; // Hardcode for now, but we'll improve this
      }
      
      console.log(`[TextureEditor] Current project: ${currentProject}`);
      console.log(`[TextureEditor] originalPath starts with project?`, originalPath.startsWith(currentProject + '/'));
      
      // Get the full path with project context
      let fullPath = originalPath;
      if (currentProject && !originalPath.startsWith(currentProject + '/')) {
        fullPath = `${currentProject}/${originalPath}`;
        console.log(`[TextureEditor] Reconstructed full path with project context: ${fullPath}`);
      } else {
        console.log(`[TextureEditor] Using original path as-is: ${fullPath}`);
      }
      
      const pathParts = fullPath.split('/');
      const fileName = pathParts.pop();
      const directory = pathParts.join('/');
      const baseName = fileName.substring(0, fileName.lastIndexOf('.'));
      const texturePath = directory ? `${directory}/${baseName}.texture` : `${baseName}.texture`;
      
      console.log(`[TextureEditor] Calculated texture path: ${texturePath}`);
      console.log(`[TextureEditor] Directory: ${directory}`);
      console.log(`[TextureEditor] Base name: ${baseName}`);
      
      // Update the texture data with the source image reference
      this.textureData.sourceImage = originalPath;
      this.textureData.sourceImagePath = originalPath;
      this.textureData.name = baseName;
      
      // Create the texture content
      const content = JSON.stringify(this.textureData.toJSON(), null, 2);
      
      // Save using the file service
      const fileService = window.serviceContainer?.get('fileIOService') || window.fileIOService;
      if (fileService) {
        await fileService.saveFile(texturePath, content);
        console.log(`[TextureEditor] Auto-saved linked texture: ${texturePath}`);
        
        // Notify project explorer to refresh
        if (window.gameEmulator?.projectExplorer) {
          // Wait a moment for the file to be written to storage
          setTimeout(async () => {
            try {
              // Load the file from storage and add it to project structure
              const fileService = window.serviceContainer?.get('fileIOService') || window.fileIOService;
              if (fileService) {
                // Try to load the file that was just saved
                const savedContent = await fileService.loadFile(texturePath);
                if (savedContent) {
                  // Create a proper file object
                  const textureFile = new File([savedContent.fileContent || content], `${baseName}.texture`, { 
                    type: 'application/json' 
                  });
                  
                  // Add to the exact same path as the source image, maintaining project context
                  // Use the directory from the full path that includes project context
                  console.log(`[TextureEditor] Adding texture file to project at path: ${directory}`);
                  console.log(`[TextureEditor] Source image was at: ${originalPath}`);
                  console.log(`[TextureEditor] Full directory with project: ${directory}`);
                  
                  window.gameEmulator.projectExplorer.addFileToProject(textureFile, directory, true, false);
                  
                  // Refresh the display
                  window.gameEmulator.projectExplorer.refresh();
                }
              }
            } catch (error) {
              console.error('[TextureEditor] Error adding texture file to project:', error);
              // Fallback to simple refresh
              window.gameEmulator.projectExplorer.refresh();
            }
          }, 200);
        }
        
        // Show success message
        if (window.gameConsole?.info) {
          window.gameConsole.info(`Linked texture file created: ${baseName}.texture`);
        }
      }
    } catch (error) {
      console.error('[TextureEditor] Failed to auto-save linked texture:', error);
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
    return ['.texture', '.tex']; // Only handle texture files, not source images
  }
  static getDisplayName() { return 'Texture Editor'; }
  static getIcon() { return '🖼️'; }
  static getPriority() { return 10; } // Standard priority for texture files
  static getCapabilities() { return ['texture-editing', 'palette-editing']; }
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
      const paletteFolder = projectExplorer.getFocusedProjectName() + '/Sources/Palettes';
      await projectExplorer.addFileToProject(actFile, paletteFolder, false, false);
      
      console.log(`[TextureEditor] Saved palette as ${fullFileName}`);
      
      // Update palettePath metadata to point to the newly saved palette file
      const savedPalettePath = `Sources/Palettes/${fullFileName}`;
      this.textureData.palettePath = savedPalettePath;
      console.log(`[TextureEditor] Updated palettePath to: ${savedPalettePath}`);

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

    // Update default palette indicator if available
    this.updateDefaultPaletteIndicator();
  }

  updateDefaultPaletteIndicator() {
    // Find or create the default palette indicator
    let indicator = document.querySelector('.default-palette-indicator');
    if (!indicator) {
      // Create indicator near the palette controls
      const paletteControlsPanel = document.querySelector('.palette-controls-panel');
      if (paletteControlsPanel) {
        indicator = document.createElement('div');
        indicator.className = 'default-palette-indicator';
        indicator.style.cssText = `
          margin-top: 5px;
          padding: 5px 8px;
          background: #2a4a2a;
          border: 1px solid #4a6a4a;
          border-radius: 4px;
          font-size: 11px;
          color: #8fa;
          display: none;
        `;
        paletteControlsPanel.appendChild(indicator);
      }
    }

    if (indicator && window.configManager) {
      const defaultPalettePath = window.configManager.getDefaultPalette();
      if (defaultPalettePath) {
        const fileName = defaultPalettePath.split('/').pop();
        indicator.textContent = `🎨 Default: ${fileName}`;
        indicator.style.display = 'block';
      } else {
        indicator.style.display = 'none';
      }
    }
  }

  // NOTE: The active displayPalette() with slot-selector support is defined
  // further below (near displayFullPaletteGrid / displaySlotSelector).

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

  async showLoadPaletteModal() {
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

    // Convert palette files to options format
    const paletteOptions = paletteFiles.map(file => ({
      value: file.name,
      label: file.name,
      description: `${file.size ? Math.round(file.size / 1024) + ' KB' : 'Unknown size'} - ${file.name.split('.').pop().toUpperCase()} format`
    }));

    try {
      const selectedPalette = await ModalUtils.showSelectionList(
        'Select Palette',
        'Choose a palette file from your project:',
        paletteOptions,
        {
          confirmText: 'Load',
          cancelText: 'Cancel'
        }
      );

      if (selectedPalette) {
        await this.loadPaletteFromProject(selectedPalette);
      }
    } catch (error) {
      console.error('[TextureEditor] Error in palette load modal:', error);
      alert('Failed to load palette: ' + error.message);
    }
  }

  async showFormatSelectionModal() {
    console.log('[TextureEditor] Show Format Selection Modal');
    
    // Get all available texture formats
    const formats = ImageData.getTextureFormatOptions();
    
    // Convert formats to simple list items for ModalUtils.showSelectionList
    const formatItems = formats.map(format => ({
      value: format.value,
      label: format.label,
      description: `${format.description} (${format.colorCount})`
    }));

    try {
      const result = await ModalUtils.showSelectionList(
        'Select Texture Format',
        'Choose a GPU texture format for your output:',
        formatItems
      );

      if (result) {
        // Update the format in texture data (triggers metadataChanged event)
        this.textureData.outputPixelFormat = result;
        
        // Update the UI label
        const format = formats.find(f => f.value === result);
        if (format && this.formatLabel) {
          this.formatLabel.innerHTML = `Output Format: <span style="color: #4a9eff;">${format.label}</span>`;
        }
        
        // Also update color depth for backward compatibility
        if (this.colorDepthSelect && format) {
          this.colorDepthSelect.value = format.bitsPerPixel;
        }
        if (format) {
          this.textureData.colorDepth = Number(format.bitsPerPixel);
        }
        
        // Direct UI refresh so these work even if the metadata handler
        // isn't registered on the current textureData instance.
        this.textureData.metadata.paletteOffset = 0;
        this.refreshPaletteForFormat();
        this.updateOptionsVisibility();
        this.updatePaletteVisibility();
        this.updateMetadataDisplay();
        this.checkAndAutoGenerateTexture();
        await this._saveTextureJson();
        
        console.log('[TextureEditor] Selected format:', result);
      }
    } catch (error) {
      console.error('[TextureEditor] Error in format selection modal:', error);
    }
  }

  showExtractPaletteModal() {
    console.log('[TextureEditor] Extract Palette — using Auto mode directly');
    
    // Set button states
    this.setButtonState('extract');
    
    // Check if source image is available
    if (!this.textureData.sourceImageData) {
      alert('No source image available for palette extraction');
      return;
    }
    
    // Go directly to Auto extraction without showing algorithm selection dialog.
    // Always extract a full 256-color palette; the paletteOffset mechanism
    // selects which slice to use at build time for sub-8-bit modes.
    this.extractPaletteWithAlgorithm(256, 'auto', (progress, message) => {
      console.log(`[TextureEditor] Progress: ${Math.round(progress * 100)}% - ${message}`);
    }).catch(error => {
      console.error('[TextureEditor] Error extracting palette:', error);
      alert('Failed to extract palette: ' + error.message);
    });
  }

  async showExtractPaletteModalWithAlgorithms(colorCount) {
    // Check if source image is available
    if (!this.textureData.sourceImageData) {
      alert('No source image available for palette extraction');
      return;
    }

    const algorithmOptions = [
      {
        value: 'auto',
        label: 'Auto (Recommended)',
        description: 'Automatically selects the best algorithm based on image complexity'
      },
      {
        value: 'median-cut',
        label: 'Median Cut',
        description: 'High quality, slower. Best for photos and complex images'
      },
      {
        value: 'simple-sample',
        label: 'Simple Sampling',
        description: 'Fast, lower quality. Good for pixel art and simple images'
      }
    ];

    try {
      const selectedAlgorithm = await ModalUtils.showSelectionList(
        `Extract Palette (${colorCount} colors)`,
        'Choose the algorithm to use for reducing the image colors:',
        algorithmOptions,
        {
          defaultValue: 'auto',
          confirmText: 'Extract',
          cancelText: 'Cancel'
        }
      );

      if (selectedAlgorithm) {
        await this.extractPaletteWithAlgorithm(colorCount, selectedAlgorithm, (progress, message) => {
          // TODO: Add progress UI support to modal
          console.log(`[TextureEditor] Progress: ${Math.round(progress * 100)}% - ${message}`);
        });
      }
    } catch (error) {
      console.error('[TextureEditor] Error in palette extraction modal:', error);
      alert('Failed to extract palette: ' + error.message);
    }
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

      // When color key is enabled, ensure the key color occupies palette index 0.
      // reduceColors() skips transparent pixels so the key color won't be in the
      // extracted palette — insert it at index 0 and shift all indices up by one so
      // transparent pixels (already mapped to index 0) render as the key color.
      if (this.textureData.useColorKey) {
        const keyColor = (this.textureData.transparentColor || '#FF00FF').toUpperCase();
        const palUpper = result.palette.map(c => c.toUpperCase());
        const existingIdx = palUpper.indexOf(keyColor);

        if (existingIdx === 0) {
          // Already in the right spot — nothing to do
          console.log('[TextureEditor] Color key already at index 0');
        } else if (existingIdx > 0) {
          // Swap the key color to index 0
          [result.palette[0], result.palette[existingIdx]] = [result.palette[existingIdx], result.palette[0]];
          // Fix up indexed frame data so pixel colors stay correct after the swap
          if (result.indexedFrames) {
            for (const frame of result.indexedFrames) {
              for (let i = 0; i < frame.indexedData.length; i++) {
                if (frame.indexedData[i] === 0) frame.indexedData[i] = existingIdx;
                else if (frame.indexedData[i] === existingIdx) frame.indexedData[i] = 0;
              }
            }
          }
          console.log(`[TextureEditor] Swapped color key from index ${existingIdx} to index 0`);
        } else {
          // Key color not present — insert at index 0 and bump everything else
          result.palette.pop();                    // drop last entry to keep count
          result.palette.unshift(keyColor);        // insert key at front
          // Shift all existing indices up by one; transparent pixels stay at 0
          if (result.indexedFrames) {
            for (const frame of result.indexedFrames) {
              for (let i = 0; i < frame.indexedData.length; i++) {
                // Transparent pixels were already mapped to 0 by reduceColors —
                // they should remain 0 (the color-key index).  Opaque pixels
                // need their index incremented because the palette shifted right.
                if (frame.indexedData[i] !== 0) {
                  frame.indexedData[i] = Math.min(frame.indexedData[i] + 1, result.palette.length - 1);
                }
              }
            }
          }
          console.log(`[TextureEditor] Inserted color key ${keyColor} at index 0`);
        }
      }

      // Create a new Palette instance using the static factory method
      const palette = Palette.fromColors(result.palette, `Generated Palette (${algorithm})`);
      
      // Store the palette and the reduction result (including indexed frames)
      this.currentPalette = palette;
      this.lastReductionResult = result;  // Store for later application

      // Persist palette colors into textureData so they are serialized into .texture JSON
      // This ensures the TextureBuilder uses the extracted palette, not the default palette file
      this.textureData.palette = palette.getColors();
      console.log(`[TextureEditor] Embedded ${palette.getColors().length} extracted palette colors into textureData`);

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

      // Persist palette colors into textureData so they are serialized into .texture JSON
      this.textureData.palette = palette.getColors();
      // Also update the palettePath metadata to point to this palette file
      this.textureData.palettePath = `Sources/Palettes/${filename}`;
      console.log(`[TextureEditor] Embedded ${palette.getColors().length} loaded palette colors into textureData, palettePath: Sources/Palettes/${filename}`);

      this.displayPalette(palette.getColors());
      this.enableApplyButton();
      
      // When loading a new palette, keep existing pixel indices and just
      // recolor with the new palette (don't re-match).
      // Use full match only if no indexed data exists yet.
      this.recolorExistingIndices();
      
      console.log(`[TextureEditor] Loaded palette: ${filename}`);
      
    } catch (error) {
      console.error('[TextureEditor] Error loading palette:', error);
      alert('Failed to load palette: ' + error.message);
    }
  }

  async loadPaletteByPath(palettePath) {
    try {
      // Extract filename from path (e.g., "Sources/Palettes/new_2.act" -> "new_2.act")
      const filename = palettePath.split('/').pop();
      console.log('[TextureEditor] Loading palette by path:', palettePath, '-> filename:', filename);
      
      // Use the existing loadPaletteFromProject method
      await this.loadPaletteFromProject(filename);
      
      // Update UI state to show palette is loaded
      this.setButtonState('load');
      
    } catch (error) {
      console.error('[TextureEditor] Error loading palette by path:', error);
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
      min-height: 60px;
      max-height: 320px;
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

    // Pad palette to 256 colors (standard .act palette size)
    const fullPalette = [...palette];
    while (fullPalette.length < 256) {
      fullPalette.push('#000000');
    }

    // Get current format info
    const currentFormat = this.textureData.outputPixelFormat;
    const isIndexed = TextureData.isIndexedFormat(currentFormat);
    const formatColorCount = ImageData.getTextureFormatColorCount(currentFormat);
    const currentOffset = this.textureData.metadata.paletteOffset || 0;
    const needsSlotSelector = isIndexed && formatColorCount < 256;

    if (needsSlotSelector) {
      // Sub-8-bit indexed: show clickable grouped rows (e.g. 16 rows of 16 for i4)
      this.displayIndexedPalette(fullPalette, formatColorCount, currentOffset);
    } else {
      // 8-bit or non-indexed: compact 16×16 grid
      this.displayFullPaletteGrid(fullPalette, 0, 0);
    }
  }

  displayFullPaletteGrid(palette, chunkSize, currentOffset) {
    // Info header
    const infoHeader = document.createElement('div');
    infoHeader.style.cssText = `
      font-size: 11px;
      color: #888;
      margin-bottom: 6px;
      text-align: center;
    `;
    infoHeader.textContent = `${palette.length} colors`;
    this.paletteDisplay.appendChild(infoHeader);

    // 16x16 grid of all 256 colors
    const grid = document.createElement('div');
    grid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(16, 1fr);
      gap: 1px;
      margin-bottom: 8px;
    `;

    palette.forEach((color, index) => {
      const swatch = document.createElement('div');
      swatch.style.cssText = `
        width: 100%;
        aspect-ratio: 1;
        background-color: ${color};
        border: 1px solid #333;
        border-radius: 1px;
        cursor: pointer;
        transition: transform 0.1s;
        box-sizing: border-box;
      `;
      swatch.title = `#${index}: ${color}`;

      swatch.addEventListener('mouseenter', () => {
        swatch.style.transform = 'scale(1.3)';
        swatch.style.zIndex = '10';
        swatch.style.border = '2px solid #fff';
      });
      swatch.addEventListener('mouseleave', () => {
        swatch.style.transform = 'scale(1)';
        swatch.style.zIndex = '1';
        swatch.style.border = '1px solid #333';
      });
      swatch.addEventListener('click', () => {
        navigator.clipboard.writeText(color).then(() => {
          console.log(`[TextureEditor] Copied color ${color} to clipboard`);
        }).catch(() => {});
      });

      grid.appendChild(swatch);
    });

    this.paletteDisplay.appendChild(grid);
  }

  displaySlotSelector(palette, colorsPerSlot, currentOffset) {
    const totalSlots = Math.ceil(256 / colorsPerSlot);

    const selectorContainer = document.createElement('div');
    selectorContainer.style.cssText = `
      border-top: 1px solid #444;
      padding-top: 8px;
      margin-top: 4px;
    `;

    const label = document.createElement('div');
    label.style.cssText = `
      font-size: 11px;
      color: #4a9eff;
      margin-bottom: 6px;
      text-align: center;
      font-weight: 600;
    `;
    label.textContent = `Palette Slot (${colorsPerSlot} colors each) — click to select`;
    selectorContainer.appendChild(label);

    const slotsRow = document.createElement('div');
    slotsRow.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      justify-content: center;
    `;

    for (let slot = 0; slot < totalSlots; slot++) {
      const startIdx = slot * colorsPerSlot;
      const isSelected = startIdx === currentOffset;

      const slotBtn = document.createElement('button');
      slotBtn.style.cssText = `
        padding: 4px 8px;
        font-size: 11px;
        font-family: 'Courier New', monospace;
        background: ${isSelected ? '#4a9eff' : '#333'};
        color: ${isSelected ? '#fff' : '#aaa'};
        border: 1px solid ${isSelected ? '#4a9eff' : '#555'};
        border-radius: 3px;
        cursor: pointer;
        min-width: 36px;
        font-weight: ${isSelected ? 'bold' : 'normal'};
      `;
      slotBtn.textContent = `${startIdx}`;
      slotBtn.title = `Colors ${startIdx}–${startIdx + colorsPerSlot - 1}`;

      slotBtn.addEventListener('click', () => {
        this.textureData.metadata.paletteOffset = startIdx;
        const colors = this.currentPalette?.getColors ? this.currentPalette.getColors() : this.currentPalette;
        this.displayPalette(colors || palette);
        // Keep existing pixel indices — just re-render with the new palette slice
        this.recolorExistingIndices();
        console.log(`[TextureEditor] Selected palette slot offset: ${startIdx}`);
      });

      slotBtn.addEventListener('mouseenter', () => {
        if (!isSelected) {
          slotBtn.style.background = '#444';
          slotBtn.style.borderColor = '#888';
        }
      });
      slotBtn.addEventListener('mouseleave', () => {
        if (!isSelected) {
          slotBtn.style.background = '#333';
          slotBtn.style.borderColor = '#555';
        }
      });

      slotsRow.appendChild(slotBtn);
    }

    selectorContainer.appendChild(slotsRow);
    this.paletteDisplay.appendChild(selectorContainer);
  }

  displayIndexedPalette(palette, colorsPerChunk, currentOffset) {
    const totalChunks = Math.ceil(palette.length / colorsPerChunk);
    
    // Add info header
    const infoHeader = document.createElement('div');
    infoHeader.style.cssText = `
      font-size: 12px;
      color: #4a9eff;
      margin-bottom: 10px;
      text-align: center;
    `;
    infoHeader.textContent = `${this.textureData.outputPixelFormat} - ${colorsPerChunk} colors per block. Click a block to select it.`;
    this.paletteDisplay.appendChild(infoHeader);

    // Create container for all palette chunks
    const chunksContainer = document.createElement('div');
    chunksContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const startIndex = chunkIndex * colorsPerChunk;
      const endIndex = Math.min(startIndex + colorsPerChunk, palette.length);
      const chunkColors = palette.slice(startIndex, endIndex);
      
      // Create chunk container
      const chunkContainer = document.createElement('div');
      const isSelected = startIndex === currentOffset;
      chunkContainer.style.cssText = `
        display: flex;
        align-items: center;
        padding: 8px;
        border: 2px solid ${isSelected ? '#4a9eff' : '#444'};
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
        background: ${isSelected ? 'rgba(74, 158, 255, 0.1)' : 'transparent'};
      `;
      
      // Add chunk label
      const chunkLabel = document.createElement('div');
      chunkLabel.style.cssText = `
        min-width: 60px;
        font-size: 11px;
        color: ${isSelected ? '#4a9eff' : '#ccc'};
        font-weight: ${isSelected ? 'bold' : 'normal'};
      `;
      chunkLabel.textContent = `Offset ${startIndex}:`;
      chunkContainer.appendChild(chunkLabel);
      
      // Create color grid for this chunk
      const colorGrid = document.createElement('div');
      colorGrid.style.cssText = `
        display: flex;
        gap: 2px;
        flex: 1;
        margin-left: 10px;
      `;
      
      chunkColors.forEach((color, localIndex) => {
        const colorSwatch = document.createElement('div');
        colorSwatch.style.cssText = `
          width: 16px;
          height: 16px;
          background-color: ${color};
          border: 1px solid #666;
          border-radius: 2px;
          flex-shrink: 0;
        `;
        colorSwatch.title = `Color ${startIndex + localIndex}: ${color}`;
        colorGrid.appendChild(colorSwatch);
      });
      
      chunkContainer.appendChild(colorGrid);
      
      // Add click handler to select this chunk
      chunkContainer.addEventListener('click', () => {
        // Update palette offset in metadata
        this.textureData.metadata.paletteOffset = startIndex;
        
        // Refresh display to show new selection
        this.displayPalette(palette);
        
        // Keep existing pixel indices — just re-render with the new palette slice
        // (use recolorExistingIndices if we have indexed data, otherwise match)
        this.recolorExistingIndices();
        
        console.log(`[TextureEditor] Selected palette offset: ${startIndex}`);
      });
      
      // Add hover effect
      chunkContainer.addEventListener('mouseenter', () => {
        if (startIndex !== currentOffset) {
          chunkContainer.style.borderColor = '#666';
          chunkContainer.style.background = 'rgba(255, 255, 255, 0.05)';
        }
      });
      
      chunkContainer.addEventListener('mouseleave', () => {
        if (startIndex !== currentOffset) {
          chunkContainer.style.borderColor = '#444';
          chunkContainer.style.background = 'transparent';
        }
      });
      
      chunksContainer.appendChild(chunkContainer);
    }
    
    this.paletteDisplay.appendChild(chunksContainer);
    
    // Add summary info
    const summaryInfo = document.createElement('div');
    summaryInfo.style.cssText = `
      font-size: 11px;
      color: #888;
      text-align: center;
      margin-top: 10px;
    `;
    summaryInfo.textContent = `${palette.length} total colors, ${totalChunks} blocks of ${colorsPerChunk} colors each`;
    this.paletteDisplay.appendChild(summaryInfo);
  }

  displayFullPalette(palette) {
    // Create palette grid for true color formats (no chunking needed)
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
    if (this.bestFitBtn) {
      this.bestFitBtn.disabled = false;
      this.bestFitBtn.style.opacity = '1';
    }
  }

  /**
   * Re-render the preview using existing pixel indices but a new palette slice.
   * This is the DEFAULT behaviour when changing palette offset/slot — it keeps
   * the colour indices the same and only swaps which palette colours are visible.
   * If no indexed data exists yet, falls back to a full best-fit match.
   */
  recolorExistingIndices() {
    if (!this.currentPalette || !this.originalCanvas) return;

    // Build the effective palette slice for the current format + offset
    const format = this.textureData.outputPixelFormat;
    const formatColorCount = ImageData.getTextureFormatColorCount(format);
    const offset = this.textureData.metadata.paletteOffset || 0;
    const allColors = this.currentPalette.getColors();
    let sliceColors = allColors;
    if (formatColorCount < 256 && allColors.length > offset) {
      sliceColors = allColors.slice(offset, offset + formatColorCount);
    }

    // If we have stored indexed data, re-render with the new palette slice
    if (this.lastReductionResult && this.lastReductionResult.indexedFrames) {
      console.log('[TextureEditor] Recolouring existing indices with new palette slice');
      // Build a modified reduction result that uses the new palette colours
      const recoloredResult = {
        ...this.lastReductionResult,
        palette: sliceColors
      };
      this.applyReductionResult(recoloredResult, true); // paletteOnly — skip D2 rebuild
      this.markDirty();
      return;
    }

    // No existing indexed data — fall back to a full match
    console.log('[TextureEditor] No existing indexed data — running full match');
    this.checkAndAutoGenerateTexture();
  }

  /**
   * Generate the D2 output for direct-colour (non-indexed) formats.
   * Converts the source RGBA pixel data to the target format and builds
   * the D2 preview — no palette matching is needed.
   */
  generateDirectColorOutput() {
    try {
      const srcData = this.textureData.sourceImageData;
      if (!srcData) {
        console.warn('[TextureEditor] generateDirectColorOutput: no source image data');
        return;
      }

      const format = this.textureData.outputPixelFormat;
      const width  = srcData.width;
      const height = srcData.height;

      console.log(`[TextureEditor] Generating direct-colour output: ${format} ${width}×${height}`);
      const textureCfg = this.textureData.toJSON();
      const d2Bytes = D2File.buildFromRGBA(textureCfg, srcData.data, width, height);

      // Initialise GPU renderer
      this._initGpu();

      // Update processedImageData for export (keep a canvas-backed copy)
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const nativeImgData = ctx.createImageData(width, height);
      nativeImgData.data.set(srcData.data);
      ctx.putImageData(nativeImgData, 0, 0);
      this.updateCanvasFromImage(canvas);

      // Upload the shared D2 build for preview/persistence.
      this._buildD2PreviewDirect(d2Bytes, format);

      console.log(`[TextureEditor] Direct-colour output complete (${d2Bytes.length} bytes)`);
    } catch (error) {
      console.error('[TextureEditor] generateDirectColorOutput failed:', error);
    }
  }

  /**
   * Build & display a D2 preview from pre-encoded format bytes (not indices).
   * Used for direct-colour formats where the pixel data is already in the
   * target format (RGB565, RGBA8888, etc.) and does NOT need packIndexedPixels.
   */
  _buildD2PreviewDirect(d2, format) {
    this._initGpu();
    if (!this._gpu) return;

    // Upload to GPU
    if (this._gpuTex) {
      this._gpu.deleteTexture(this._gpuTex);
      this._gpuTex = null;
    }
    this._gpuTex = this._gpu.createTexture(d2);

    // No palette needed for direct-colour formats, but set an empty one
    // to avoid stale palette data from a prior indexed preview
    this._gpu.setPalette(new Uint8Array(1024));
    this._gpu.setPaletteOffset(0);

    const isPreRotated = !!(d2[13] & 0x02);
    this._d2PreRotated = isPreRotated;
    this._gpuBlit(isPreRotated);

    // Persist .d2
    this._saveTextureJsonAfterPreview();

    console.log(`[TextureEditor] D2 direct preview: ${format} (${d2.length} bytes)`);
  }

  async applyPaletteToImage(userInitiated = false) {
    if (!this.currentPalette) {
      alert('No palette selected');
      return;
    }
    
    console.log('[TextureEditor] Applying palette to image (userInitiated:', userInitiated, ')');
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

      // Do not auto-create palette files on Apply/Best Fit.
      // Shared palettes should stay shared unless user explicitly saves a new one.
      
      console.log('[TextureEditor] Palette application completed');
      
    } catch (error) {
      console.error('[TextureEditor] Error applying palette:', error);
      alert('Failed to apply palette: ' + error.message);
    }
  }

  /**
   * Auto-save the current palette as an .act file in Sources/Palettes/ when the
   * user applies a palette.  This makes the palette a reusable build object and
   * records its path in the .texture metadata so the TextureBuilder can look it up.
   */
  async autoSavePaletteOnApply() {
    if (!this.currentPalette) return;

    try {
      const projectExplorer = window.gameEmulator?.projectExplorer;
      if (!projectExplorer) {
        console.warn('[TextureEditor] Project explorer not available — skipping palette auto-save');
        return;
      }

      // Derive filename from the source image (e.g. "retrowatch_analogue.png" → "retrowatch_analogue.act")
      // Try multiple sources in order of reliability:
      //   1. sourceImagePath from .texture metadata (e.g. "retrowatch_analogue.png")
      //   2. sourceImage property
      //   3. The .texture file's own path (strip .texture to get base name)
      //   4. textureData.name
      // Prefer this.path (the .texture file path, always available) — strip .texture extension later.
      // sourceImagePath/sourceImage may be stale or 'unknown' from setImageToCanvas.
      const srcPath = this.path
        || this.textureData.sourceImagePath
        || this.textureData.sourceImage
        || this.textureData.name
        || '';
      console.log(`[TextureEditor] autoSavePaletteOnApply: srcPath=${srcPath}`);
      const srcFileName = srcPath.split('/').pop() || 'palette';
      const dotIdx = srcFileName.lastIndexOf('.');
      const baseName = (dotIdx > 0 ? srcFileName.substring(0, dotIdx) : srcFileName) || 'palette';
      const fullFileName = `${baseName}.act`;

      const project = projectExplorer.getFocusedProjectName();
      if (!project) {
        console.warn('[TextureEditor] No active project — skipping palette auto-save');
        return;
      }
      const paletteFolder = project + '/Sources/Palettes';
      const palettePath = `Sources/Palettes/${fullFileName}`;
      const storagePath = `${project}/${palettePath}`;

      // Export palette to ACT binary format
      const actData = this.currentPalette.exportToACT();

      // Save via fileIOService (IndexedDB)
      const fileService = window.serviceContainer?.get('fileIOService') || window.fileIOService;
      if (fileService) {
        await fileService.saveFile(storagePath, actData, { binaryData: true });
        console.log(`[TextureEditor] Auto-saved palette: ${storagePath}`);
      }

      // Add to the project explorer tree so it's visible & buildable
      // skipAutoOpen = true (don't open in a new tab), skipRender = false (refresh tree)
      const actBlob = new Blob([actData], { type: 'application/octet-stream' });
      const actFile = new File([actBlob], fullFileName, { lastModified: Date.now() });
      await projectExplorer.addFileToProject(actFile, paletteFolder, true, false);

      // Update textureData metadata so .texture JSON references this palette
      this.textureData.palettePath = palettePath;
      this.textureData.palette = this.currentPalette.getColors();
      console.log(`[TextureEditor] Updated palettePath → ${palettePath} (${this.currentPalette.getColors().length} colors)`);

      // Persist the .texture file with the new palettePath
      await this.autoSaveLinkedTextureFile();

    } catch (error) {
      console.error('[TextureEditor] Auto-save palette failed (non-fatal):', error);
    }
  }

  applyReductionResult(result, paletteOnly = false) {
    console.log('[TextureEditor] applyReductionResult called (paletteOnly:', paletteOnly, ')');
    
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
    
    // Create a new canvas for the reduced image (for processedImageData / export)
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
    
    // Ensure GPU is initialised BEFORE updateCanvasFromImage so it knows to
    // skip the 2D context path (a canvas can only have one context type).
    this._initGpu();

    // Update processedImageData for save/export (GPU handles canvas display)
    this.updateCanvasFromImage(canvas);

    // GPU rendering — always rebuild the real .d2 so preview, D2 Viewer,
    // and build output are guaranteed identical.
    this._buildD2Preview(indexedData, width, height);
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
    
    // Determine effective palette — for sub-8-bit formats, use only the
    // color slice at the current paletteOffset so the preview matches what
    // the build will produce.
    let effectivePalette = this.currentPalette;
    const format = this.textureData.outputPixelFormat;
    const formatColorCount = ImageData.getTextureFormatColorCount(format);
    if (formatColorCount < 256 && this.currentPalette) {
      const offset = this.textureData.metadata.paletteOffset || 0;
      const allColors = this.currentPalette.getColors();
      if (allColors && allColors.length > offset) {
        const slice = allColors.slice(offset, offset + formatColorCount);
        effectivePalette = Palette.fromColors(slice, `Slice@${offset}`);
        console.log(`[TextureEditor] Using palette slice [${offset}..${offset + formatColorCount - 1}] (${slice.length} colors)`);
      }
    }
    
    // Build color key options for the matching function
    const colorKeyOpts = (this.textureData.useColorKey && TextureData.isIndexedFormat(format) && format !== 'd2_mode_ai44')
      ? { enabled: true, color: this.textureData.transparentColor || '#FF00FF' }
      : null;

    // Match to the effective palette
    const result = workingImageData.matchToPalette(null, effectivePalette, 0, null, colorKeyOpts);
    
    if (!result) {
      throw new Error('Failed to match image to palette');
    }
    
    // Apply the matched result (now has consistent structure)
    this.applyReductionResult(result);
  }

  updateCanvasFromImage(sourceCanvas) {
    // Check if outputCanvas exists
    if (!this.outputCanvas) {
      console.error('[TextureEditor] outputCanvas is null - cannot update output');
      throw new Error('Texture output canvas not initialized');
    }

    // Update processed texture data from the source canvas (for save/export)
    const newImageData = new ImageData();
    newImageData.loadFromCanvas(sourceCanvas);
    this.textureData.processedImageData = newImageData;

    if (this._gpu) {
      // GPU handles canvas display — skip 2D context draw.
      // The caller (applyReductionResult) invokes _buildD2Preview or _gpuBlit.
      console.log('[TextureEditor] updateCanvasFromImage: GPU active, processedImageData updated');
    } else {
      // Fallback: 2D canvas rendering (no WebGL available)
      const ctx = this.outputCanvas.getContext('2d');
      this.outputCanvas.width = sourceCanvas.width;
      this.outputCanvas.height = sourceCanvas.height;
      ctx.clearRect(0, 0, this.outputCanvas.width, this.outputCanvas.height);
      ctx.drawImage(sourceCanvas, 0, 0);
      console.log('[TextureEditor] Successfully updated texture output canvas (2D fallback)');
    }

    // Mark as modified
    this.markDirty();
  }

  updateColorDepthIndicator() {
    if (!this.textureData.sourceImageData || !this.colorDepthSelect) {
      return;
    }
    
    try {
      // Count unique colors and detect alpha in the image
      const imageData = this.textureData.sourceImageData;
      const colorSet = new Set();
      let hasAlpha = false;
      let hasSemiAlpha = false; // any alpha that is not 0 or 255
      const totalPixels = imageData.data.length / 4;
      
      // For large images, sample every Nth pixel for speed
      const sampleStep = totalPixels > 500000 ? Math.floor(totalPixels / 500000) : 1;
      const pixelStride = sampleStep * 4;
      
      for (let i = 0; i < imageData.data.length; i += pixelStride) {
        const r = imageData.data[i];
        const g = imageData.data[i + 1];
        const b = imageData.data[i + 2];
        const a = imageData.data[i + 3];
        
        if (a < 255) {
          hasAlpha = true;
          if (a > 0) hasSemiAlpha = true;
        }
        
        // Create color key (include alpha in uniqueness)
        const colorKey = `${r},${g},${b}`;
        colorSet.add(colorKey);
        
        // Early exit if clearly true-color
        if (colorSet.size > 256) {
          // Keep scanning for alpha but stop counting colors
          if (hasAlpha) break;
          for (let j = i + pixelStride; j < imageData.data.length; j += pixelStride) {
            if (imageData.data[j + 3] < 255) {
              hasAlpha = true;
              if (imageData.data[j + 3] > 0) hasSemiAlpha = true;
              break;
            }
          }
          break;
        }
      }
      
      const uniqueColors = colorSet.size;
      
      // Determine appropriate output format based on image characteristics
      let suggestedFormat;
      let suggestedDepth;
      
      if (uniqueColors <= 2) {
        suggestedFormat = 'd2_mode_i1';
        suggestedDepth = 1;
      } else if (uniqueColors <= 4) {
        suggestedFormat = 'd2_mode_i2';
        suggestedDepth = 2;
      } else if (uniqueColors <= 16 && !hasSemiAlpha) {
        suggestedFormat = hasAlpha ? 'd2_mode_ai44' : 'd2_mode_i4';
        suggestedDepth = hasAlpha ? 8 : 4;
      } else if (uniqueColors <= 256 && !hasSemiAlpha) {
        suggestedFormat = 'd2_mode_i8';
        suggestedDepth = 8;
      } else if (hasAlpha) {
        // True color with alpha
        suggestedFormat = 'd2_mode_rgba8888';
        suggestedDepth = 32;
      } else {
        // True color without alpha — RGB565 is a good default (small + decent quality)
        suggestedFormat = 'd2_mode_rgb565';
        suggestedDepth = 16;
      }
      
      const appliedSuggestedFormat = this.textureData.applySuggestedOutputPixelFormat(suggestedFormat);
      if (appliedSuggestedFormat) {
        this.textureData.colorDepth = suggestedDepth;
      }
      
      if (appliedSuggestedFormat) {
        this.colorDepthSelect.value = suggestedDepth;
      }
      
      // Update the format label to show the detected format
      const formats = ImageData.getTextureFormatOptions();
      const formatInfo = formats.find(f => f.value === this.textureData.outputPixelFormat);
      if (formatInfo && this.formatLabel) {
        this.formatLabel.innerHTML = `Output Format: <span style="color: #4a9eff;">${formatInfo.label}</span>`;
      }
      
      // Update the color depth label
      const paletteControlsPanel = this.element.querySelector('.palette-controls-panel');
      const label = paletteControlsPanel?.querySelector('label');
      if (appliedSuggestedFormat && label && label.innerHTML.includes('Color Depth')) {
        label.innerHTML = `Color Depth: <span style="color: #4a9eff;">${suggestedDepth}-bit</span>`;
      }
      
      // Update visibility of palette/colorkey options to match new format
      this.updateOptionsVisibility();
      this.updatePaletteVisibility();
      
      const alphaNote = hasAlpha ? (hasSemiAlpha ? ' (with semi-transparent alpha)' : ' (with binary alpha)') : '';
      console.log(`[TextureEditor] Detected ${uniqueColors > 256 ? '>256' : uniqueColors} unique colors${alphaNote}, ${appliedSuggestedFormat ? 'auto-selected' : 'kept explicit'} ${this.textureData.outputPixelFormat} (${this.textureData.colorDepth}-bit)`);
      
    } catch (error) {
      console.error('[TextureEditor] Error analyzing image colors:', error);
    }
  }
}

// Export for use
window.TextureEditor = TextureEditor;

// Register the component
TextureEditor.registerComponent();
