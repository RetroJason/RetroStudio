// texture-editor.js
// Simple, clean texture editor based on the workflow test design

console.log('[TextureEditor] Simple class definition loading');

/**
 * TextureData - Simplified data structure for texture information
 */
class TextureData extends EventTarget {
  constructor(options = {}) {
    super();
    
    this.name = options.name || 'texture';
    this.sourceImage = options.sourceImage || null;
    this.width = options.width || 32;
    this.height = options.height || 32;
    this.colorFormat = options.colorFormat || 'd2_mode_i4';
    this.palette = options.palette || '';
    this.paletteObject = null;
    this.paletteOffset = options.paletteOffset || 0;
    
    // Auto-populate default palette if needed
    this.populateDefaultPalette();
  }

  populateDefaultPalette() {
    if (!this.palette && this.colorFormat && this.colorFormat.includes('_i')) {
      // Try to get the project's default palette
      const projectConfig = window.projectConfigManager?.getCurrentConfig();
      if (projectConfig?.project?.defaultPalette) {
        this.palette = projectConfig.project.defaultPalette;
        console.log('[TextureData] Auto-set project default palette:', this.palette);
      } else {
        this.palette = 'Resources/Palettes/default.act';
        console.log('[TextureData] Auto-set fallback default palette:', this.palette);
      }
    }
  }

  // Property accessors with event dispatch
  get sourceImagePath() { return this.sourceImage; }
  set sourceImagePath(value) { 
    this.sourceImage = value;
    this.dispatchEvent(new CustomEvent('metadataChanged', {
      detail: { property: 'sourceImage', oldValue: this.sourceImage, newValue: value }
    }));
  }

  get palettePath() { return this.palette; }
  set palettePath(value) { 
    this.palette = value;
    this.dispatchEvent(new CustomEvent('metadataChanged', {
      detail: { property: 'palette', oldValue: this.palette, newValue: value }
    }));
  }

  get outputPixelFormat() { return this.colorFormat; }
  set outputPixelFormat(value) { 
    this.colorFormat = value;
    this.populateDefaultPalette();
    this.dispatchEvent(new CustomEvent('metadataChanged', {
      detail: { property: 'colorFormat', oldValue: this.colorFormat, newValue: value }
    }));
  }
}

console.log('[TextureEditor] TextureData class defined');

/**
 * Simple TextureEditor - Clean, workflow-test-based implementation
 */
class TextureEditor extends EditorBase {
  constructor(fileObject, readOnly = false) {
    console.log('[TextureEditor] Constructor called:', fileObject?.filename || 'new file');
    
    // Store file object before super() call since super() will trigger createBody()
    const tempFileObject = fileObject;
    
    super(fileObject, readOnly);
    
    // Ensure file is set (it should be set by EditorBase, but let's be safe)
    if (!this.file && tempFileObject) {
      this.file = tempFileObject;
    }
    
    // Initialize texture data
    this.textureData = new TextureData({
      name: this.file?.filename || 'texture',
      sourceImage: this.file?.path
    });

    // Initialize RetroImage for processing
    this.retroImage = null;
    this.currentPalette = null;
    this.paletteOffset = 0;
    this.reserveTransparency = false;
    
    // Auto-save timer for texture file
    this.autoSaveTimer = null;
  }

  createBody(bodyContainer) {
    console.log('[TextureEditor] createBody called with container:', bodyContainer);
    console.log('[TextureEditor] In createBody, this.file is:', this.file);
    this.bodyContainer = bodyContainer;
    this.setupUI();
    
    // Defer image loading until after constructor completes
    setTimeout(() => {
      console.log('[TextureEditor] Deferred loadInitialImage, this.file is:', this.file);
      this.loadInitialImage();
    }, 0);
  }

  setupUI() {
    console.log('[TextureEditor] setupUI called');
    this.bodyContainer.innerHTML = `
      <div style="display: flex; height: calc(100vh - 100px); gap: 15px; padding: 15px;">
        
        <!-- Left Side: Image Areas (Dominant) -->
        <div style="flex: 1; display: flex; flex-direction: column; gap: 15px; min-width: 0;">
          
          <!-- Original and Processed Images -->
          <div style="flex: 1; display: flex; gap: 15px; min-height: 0;">
            
            <!-- Original Image -->
            <div style="flex: 1; background: #2d2d2d; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; min-width: 0;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4 style="color: #fff; margin: 0; font-size: 16px; font-weight: 500;">Original</h4>
                <div id="imageInfo" style="color: #999; font-size: 11px; padding: 3px 8px; background: #1e1e1e; border-radius: 3px; border: 1px solid #444;">No image loaded</div>
              </div>
              <div id="originalViewport" style="flex: 1; overflow: auto; border: 2px solid #555; background: linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0px; background-color: #f0f0f0; position: relative; border-radius: 6px;">
                <canvas id="originalCanvas" style="display: block; image-rendering: pixelated; cursor: grab;"></canvas>
              </div>
              <div style="margin-top: 10px; display: flex; gap: 8px; align-items: center; justify-content: center;">
                <button id="originalZoomOut" style="padding: 6px 10px; background: #4a4a4a; color: #fff; border: 1px solid #666; border-radius: 4px; cursor: pointer; font-size: 12px;">−</button>
                <span id="originalZoomLevel" style="color: #ccc; font-size: 12px; min-width: 45px; text-align: center; font-weight: 500;">100%</span>
                <button id="originalZoomIn" style="padding: 6px 10px; background: #4a4a4a; color: #fff; border: 1px solid #666; border-radius: 4px; cursor: pointer; font-size: 12px;">+</button>
                <button id="originalZoomFit" style="padding: 6px 12px; background: #4a4a4a; color: #fff; border: 1px solid #666; border-radius: 4px; cursor: pointer; font-size: 12px;">Fit</button>
              </div>
            </div>
            
            <!-- Processed Image -->
            <div style="flex: 1; background: #2d2d2d; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; min-width: 0;">
              <h4 style="color: #fff; margin: 0 0 10px 0; font-size: 16px; font-weight: 500;">Processed</h4>
              <div id="processedViewport" style="flex: 1; overflow: auto; border: 2px solid #555; background: linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0px; background-color: #f0f0f0; position: relative; border-radius: 6px;">
                <canvas id="processedCanvas" style="display: block; image-rendering: pixelated; cursor: grab;"></canvas>
              </div>
              <div style="margin-top: 10px; display: flex; gap: 8px; align-items: center; justify-content: center;">
                <button id="processedZoomOut" style="padding: 6px 10px; background: #4a4a4a; color: #fff; border: 1px solid #666; border-radius: 4px; cursor: pointer; font-size: 12px;">−</button>
                <span id="processedZoomLevel" style="color: #ccc; font-size: 12px; min-width: 45px; text-align: center; font-weight: 500;">100%</span>
                <button id="processedZoomIn" style="padding: 6px 10px; background: #4a4a4a; color: #fff; border: 1px solid #666; border-radius: 4px; cursor: pointer; font-size: 12px;">+</button>
                <button id="processedZoomFit" style="padding: 6px 12px; background: #4a4a4a; color: #fff; border: 1px solid #666; border-radius: 4px; cursor: pointer; font-size: 12px;">Fit</button>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Right Side: Palette & Controls (Compact) -->
        <div style="width: 280px; background: #2d2d2d; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; flex-shrink: 0;">
          
          <!-- Palette Controls -->
          <div style="margin-bottom: 15px;">
            <h4 style="color: #fff; margin: 0 0 12px 0; font-size: 15px; font-weight: 500;">Palette Tools</h4>
            
            <!-- Format and Distance Settings -->
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; padding: 10px; background: #242424; border-radius: 4px; border: 1px solid #444;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="color: #ccc; font-size: 12px; font-weight: 500; min-width: 55px;">Format:</span>
                <select id="formatSelect" style="flex: 1; padding: 5px 8px; background: #1e1e1e; color: #fff; border: 1px solid #444; border-radius: 3px; font-size: 11px;">
                  <option value="d2_mode_argb8888" selected>A8R8G8B8 (32-bit)</option>
                  <option value="d2_mode_argb1555">A1R5G5B5 (16-bit+α)</option>
                  <option value="d2_mode_rgb565">R5G6B5 (16-bit)</option>
                  <option value="d2_mode_rgba4444">A4R4G4B4 (16-bit+α)</option>
                  <option value="d2_mode_i8">I8 (256 colors)</option>
                  <option value="d2_mode_i4">I4 (16 colors)</option>
                  <option value="d2_mode_i2">I2 (4 colors)</option>
                  <option value="d2_mode_i1">I1 (2 colors)</option>
                  <option value="d2_mode_ai44">AI44 (16+α)</option>
                </select>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="color: #ccc; font-size: 12px; font-weight: 500; min-width: 55px;">Distance:</span>
                <select id="colorDistanceSelect" style="flex: 1; padding: 5px 8px; background: #1e1e1e; color: #fff; border: 1px solid #444; border-radius: 3px; font-size: 11px;">
                  <option value="dei" selected>DEI</option>
                  <option value="euclidean">Euclidean</option>
                  <option value="weighted">Weighted</option>
                </select>
              </div>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <button id="createPaletteBtn" style="padding: 8px 12px; background: #4a4a4a; color: #fff; border: 1px solid #666; border-radius: 4px; font-size: 12px; cursor: pointer;">Create from Image</button>
              <button id="loadPaletteBtn" style="padding: 8px 12px; background: #4a4a4a; color: #fff; border: 1px solid #666; border-radius: 4px; font-size: 12px; cursor: pointer;">Load Project Palette</button>
              <button id="fitToPaletteBtn" style="padding: 8px 12px; background: #2a5a2a; color: #fff; border: 1px solid #4a8a4a; border-radius: 4px; font-size: 12px; cursor: pointer;">Fit to Selected Palette</button>
              <button id="findBestPaletteBtn" style="padding: 8px 12px; background: #5a4a2a; color: #fff; border: 1px solid #8a7a4a; border-radius: 4px; font-size: 12px; cursor: pointer;">Find Best Palette</button>
            </div>
          </div>
          
          <!-- Palette Display -->
          <div style="flex: 1; display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <h4 style="color: #fff; margin: 0; font-size: 15px; font-weight: 500;">Palette</h4>
              <div id="paletteOffsetGroup" style="display: none; flex: 0 0 auto;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="color: #ccc; font-size: 12px; font-weight: 500;">Offset:</span>
                  <input id="paletteOffsetSlider" type="range" min="0" max="240" step="16" value="0" style="width: 80px;">
                  <span id="paletteOffsetValue" style="color: #ccc; font-size: 11px; min-width: 25px;">0</span>
                </div>
              </div>
              <div id="transparencyGroup" style="display: none; flex: 0 0 auto;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <label style="color: #ccc; font-size: 12px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                    <input id="reserveTransparencyCheckbox" type="checkbox" style="margin: 0;">
                    Reserve Index 0 for Color Key (Magenta)
                  </label>
                </div>
              </div>
            </div>
            <div id="paletteDisplay" style="flex: 1; overflow-y: auto; border: 2px solid #555; background: #1a1a1a; padding: 10px; border-radius: 6px; min-height: 200px;">
              <div style="color: #999; text-align: center; padding: 30px 15px; font-size: 13px;">No palette loaded</div>
            </div>
            <div id="paletteInfo" style="margin-top: 10px; font-size: 11px; color: #999; text-align: center;"></div>
          </div>
        </div>
      </div>
    `;

    // Get UI elements
    this.imageInput = this.bodyContainer.querySelector('#imageInput');
    this.formatSelect = this.bodyContainer.querySelector('#formatSelect');
    this.originalCanvas = this.bodyContainer.querySelector('#originalCanvas');
    this.processedCanvas = this.bodyContainer.querySelector('#processedCanvas');
    this.originalViewport = this.bodyContainer.querySelector('#originalViewport');
    this.processedViewport = this.bodyContainer.querySelector('#processedViewport');
    this.imageInfo = this.bodyContainer.querySelector('#imageInfo');
    
    // Palette UI elements
    this.paletteDisplay = this.bodyContainer.querySelector('#paletteDisplay');
    this.paletteInfo = this.bodyContainer.querySelector('#paletteInfo');
    this.palettePanel = this.bodyContainer.querySelector('#palettePanel');
    this.createPaletteBtn = this.bodyContainer.querySelector('#createPaletteBtn');
    this.loadPaletteBtn = this.bodyContainer.querySelector('#loadPaletteBtn');
    this.fitToPaletteBtn = this.bodyContainer.querySelector('#fitToPaletteBtn');
    this.findBestPaletteBtn = this.bodyContainer.querySelector('#findBestPaletteBtn');
    this.colorDistanceSelect = this.bodyContainer.querySelector('#colorDistanceSelect');
    this.paletteOffsetGroup = this.bodyContainer.querySelector('#paletteOffsetGroup');
    this.paletteOffsetSlider = this.bodyContainer.querySelector('#paletteOffsetSlider');
    this.paletteOffsetValue = this.bodyContainer.querySelector('#paletteOffsetValue');
    this.transparencyGroup = this.bodyContainer.querySelector('#transparencyGroup');
    this.reserveTransparencyCheckbox = this.bodyContainer.querySelector('#reserveTransparencyCheckbox');

    // Debug: Check if elements were found
    console.log('[TextureEditor] UI elements found:', {
      formatSelect: !!this.formatSelect,
      paletteSelect: !!this.paletteSelect,
      paletteGroup: !!this.paletteGroup,
      originalCanvas: !!this.originalCanvas,
      processedCanvas: !!this.processedCanvas,
      paletteDisplay: !!this.paletteDisplay
    });

    // Initialize state
    this.currentPalette = null;
    this.paletteOffset = 0;
    this.colorDistanceMethod = 'dei';

    // Initialize zoom and pan state
    this.originalZoom = 1.0;
    this.processedZoom = 1.0;
    this.originalPanX = 0;
    this.originalPanY = 0;
    this.processedPanX = 0;
    this.processedPanY = 0;

    // Setup event listeners
    this.setupEventListeners();
    this.updatePaletteVisibility();
  }

  setupEventListeners() {
    // Image input (only if it exists - not needed for pre-loaded files)
    if (this.imageInput) {
      this.imageInput.addEventListener('change', (e) => {
        if (e.target.files[0]) {
          this.loadImage(e.target.files[0]);
        }
      });
    }

    // Format selection
    if (this.formatSelect) {
      this.formatSelect.addEventListener('change', () => {
        this.textureData.outputPixelFormat = this.formatSelect.value;
        this.markDirty(); // Mark texture file as needing save
        
        const format = this.formatSelect.value;
        const isIndexed = format.includes('_i') || format.includes('ai44');
        
        if (isIndexed && this.currentPalette && this.currentPalette.colors.length > 0) {
          const maxColors = this.getMaxColorsForFormat(format);
          // Reset offset to 0 when changing formats
          this.paletteOffset = 0;
          this.paletteOffsetSlider.value = 0;
          this.paletteOffsetValue.textContent = '0';
          
          // Update offset slider max
          if (this.currentPalette.colors.length > maxColors) {
            const maxOffset = Math.floor((this.currentPalette.colors.length - 1) / maxColors) * maxColors;
            this.paletteOffsetSlider.max = maxOffset;
            this.paletteOffsetSlider.step = maxColors;
          } else {
            this.paletteOffsetSlider.max = 0;
          }
          
          this.displayPalette(); // Refresh palette display
        }
        
        this.updatePaletteVisibility();
        this.processTexture();
      });
    }

    // Palette controls
    if (this.createPaletteBtn) {
      this.createPaletteBtn.addEventListener('click', () => {
        this.createPaletteFromImage();
      });
    }

    if (this.loadPaletteBtn) {
      this.loadPaletteBtn.addEventListener('click', () => {
        this.showPaletteLoadDialog();
      });
    }

    if (this.fitToPaletteBtn) {
      this.fitToPaletteBtn.addEventListener('click', () => {
        this.fitImageToPalette();
      });
    }

    if (this.findBestPaletteBtn) {
      this.findBestPaletteBtn.addEventListener('click', () => {
        this.findBestPalette();
      });
    }

    if (this.colorDistanceSelect) {
      this.colorDistanceSelect.addEventListener('change', () => {
        this.colorDistanceMethod = this.colorDistanceSelect.value;
        this.markDirty(); // Mark texture file as needing save
        if (this.currentPalette) {
          this.processTexture(); // Reprocess with new distance method
        }
      });
    }

    if (this.paletteOffsetSlider) {
      this.paletteOffsetSlider.addEventListener('input', () => {
        this.paletteOffset = parseInt(this.paletteOffsetSlider.value);
        this.paletteOffsetValue.textContent = this.paletteOffset;
        this.textureData.paletteOffset = this.paletteOffset;
        this.markDirty(); // Mark texture file as needing save
        this.displayPalette();
        this.processTexture();
      });
    }

    if (this.reserveTransparencyCheckbox) {
      this.reserveTransparencyCheckbox.addEventListener('change', () => {
        this.reserveTransparency = this.reserveTransparencyCheckbox.checked;
        this.textureData.reserveTransparency = this.reserveTransparency;
        this.markDirty(); // Mark texture file as needing save
        this.processTexture(); // Reprocess with new transparency setting
      });
    }

    // Setup zoom and pan controls for original canvas
    this.setupCanvasControls('original');
    this.setupCanvasControls('processed');
  }

  setupCanvasControls(canvasType) {
    const viewport = this.bodyContainer.querySelector(`#${canvasType}Viewport`);
    const canvas = this.bodyContainer.querySelector(`#${canvasType}Canvas`);
    const zoomOutBtn = this.bodyContainer.querySelector(`#${canvasType}ZoomOut`);
    const zoomInBtn = this.bodyContainer.querySelector(`#${canvasType}ZoomIn`);
    const zoomFitBtn = this.bodyContainer.querySelector(`#${canvasType}ZoomFit`);
    const zoomLevel = this.bodyContainer.querySelector(`#${canvasType}ZoomLevel`);

    if (!viewport || !canvas || !zoomOutBtn || !zoomInBtn || !zoomFitBtn || !zoomLevel) return;

    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    // Zoom controls
    zoomOutBtn.addEventListener('click', () => {
      const currentZoom = canvasType === 'original' ? this.originalZoom : this.processedZoom;
      const newZoom = Math.max(0.1, currentZoom / 1.5);
      this.setCanvasZoom(canvasType, newZoom);
    });

    zoomInBtn.addEventListener('click', () => {
      const currentZoom = canvasType === 'original' ? this.originalZoom : this.processedZoom;
      const newZoom = Math.min(10, currentZoom * 1.5);
      this.setCanvasZoom(canvasType, newZoom);
    });

    zoomFitBtn.addEventListener('click', () => {
      this.fitCanvasToViewport(canvasType);
    });

    // Mouse wheel zoom
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const currentZoom = canvasType === 'original' ? this.originalZoom : this.processedZoom;
      const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(10, currentZoom * zoomDelta));
      this.setCanvasZoom(canvasType, newZoom);
    });

    // Pan controls
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // Left mouse button
        isDragging = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const deltaX = e.clientX - lastMouseX;
        const deltaY = e.clientY - lastMouseY;
        
        if (canvasType === 'original') {
          this.originalPanX += deltaX;
          this.originalPanY += deltaY;
        } else {
          this.processedPanX += deltaX;
          this.processedPanY += deltaY;
        }
        
        this.updateCanvasTransform(canvasType);
        
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        e.preventDefault();
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        isDragging = false;
        canvas.style.cursor = 'grab';
      }
    });

    canvas.addEventListener('mouseleave', () => {
      isDragging = false;
      canvas.style.cursor = 'grab';
    });
  }

  setCanvasZoom(canvasType, zoom) {
    if (canvasType === 'original') {
      this.originalZoom = zoom;
    } else {
      this.processedZoom = zoom;
    }
    
    this.updateCanvasTransform(canvasType);
    
    const zoomLevel = this.bodyContainer.querySelector(`#${canvasType}ZoomLevel`);
    if (zoomLevel) {
      zoomLevel.textContent = Math.round(zoom * 100) + '%';
    }
  }

  updateCanvasTransform(canvasType) {
    const canvas = this.bodyContainer.querySelector(`#${canvasType}Canvas`);
    if (!canvas) return;

    const zoom = canvasType === 'original' ? this.originalZoom : this.processedZoom;
    const panX = canvasType === 'original' ? this.originalPanX : this.processedPanX;
    const panY = canvasType === 'original' ? this.originalPanY : this.processedPanY;

    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    canvas.style.transformOrigin = '0 0';
  }

  fitCanvasToViewport(canvasType) {
    const viewport = this.bodyContainer.querySelector(`#${canvasType}Viewport`);
    const canvas = this.bodyContainer.querySelector(`#${canvasType}Canvas`);
    
    if (!viewport || !canvas) return;

    const viewportRect = viewport.getBoundingClientRect();
    const canvasWidth = canvas.width || canvas.naturalWidth || 256;
    const canvasHeight = canvas.height || canvas.naturalHeight || 256;

    const scaleX = (viewportRect.width - 20) / canvasWidth;
    const scaleY = (viewportRect.height - 20) / canvasHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Don't zoom in beyond 100%

    if (canvasType === 'original') {
      this.originalPanX = 0;
      this.originalPanY = 0;
    } else {
      this.processedPanX = 0;
      this.processedPanY = 0;
    }

    this.setCanvasZoom(canvasType, scale);
  }

  updatePaletteVisibility() {
    if (!this.formatSelect) {
      console.warn('[TextureEditor] updatePaletteVisibility called but UI elements not ready');
      return;
    }
    
    const format = this.formatSelect.value;
    const isIndexed = format.includes('_i') || format.includes('ai44');
    
    // Show/hide palette offset controls
    if (this.paletteOffsetGroup) {
      this.paletteOffsetGroup.style.display = isIndexed ? 'block' : 'none';
    }
    
    // Show/hide transparency controls for indexed formats
    if (this.transparencyGroup) {
      this.transparencyGroup.style.display = isIndexed ? 'block' : 'none';
    }
    
    // Update palette offset range based on format
    if (isIndexed && this.paletteOffsetSlider) {
      const maxColors = this.getMaxColorsForFormat(format);
      const maxOffset = Math.max(0, 256 - maxColors);
      this.paletteOffsetSlider.max = maxOffset;
      this.paletteOffsetSlider.step = maxColors;
      
      // Reset offset if it exceeds new maximum
      if (this.paletteOffset > maxOffset) {
        this.paletteOffset = 0;
        this.paletteOffsetSlider.value = 0;
        this.paletteOffsetValue.textContent = 0;
      }
    }
  }

  async loadInitialImage() {
    if (!this.file) {
      console.log('[TextureEditor] No file to load');
      return;
    }

    const filename = this.file.filename || '';
    const isTextureFile = filename.match(/\.(texture|tex)$/i);
    const isImageFile = filename.match(/\.(png|jpg|jpeg|gif|bmp|webp)$/i);

    if (isTextureFile) {
      // Loading a .texture file - use RetroImage to handle parsing and loading
      try {
        console.log('[TextureEditor] Loading texture file:', filename);
        
        // Create a RetroImage and load the texture content using loadFromTexture
        const retroImage = new window.RetroImage();
        await retroImage.loadFromTexture(this.file.fileContent, filename);
        
        // Set the loaded RetroImage
        this.retroImage = retroImage;
        
        console.log('[TextureEditor] RetroImage loaded, format:', retroImage._format);
        
        // Setup original canvas to show the source image
        this.originalCanvas.width = this.retroImage.width;
        this.originalCanvas.height = this.retroImage.height;
        
        const ctx = this.originalCanvas.getContext('2d');
        
        // Get the original image data and draw it
        const imageData = this.retroImage.toImageData();
        ctx.putImageData(imageData, 0, 0);
        
        // Update image info display
        if (this.imageInfo) {
          this.imageInfo.textContent = `${this.retroImage.width}x${this.retroImage.height}`;
        }
        
        // Update UI with format from the loaded image BEFORE processing
        if (retroImage._format) {
          this.formatSelect.value = retroImage._format;
          console.log('[TextureEditor] Set format from texture file:', retroImage._format);
        }
        
        // Update palette offset if available
        if (retroImage.paletteOffset !== undefined) {
          this.paletteOffset = retroImage.paletteOffset;
          this.paletteOffsetSlider.value = this.paletteOffset;
          this.paletteOffsetValue.textContent = this.paletteOffset;
        }
        
        // Update display after setting UI values
        await this.processTexture();
        
      } catch (error) {
        console.error('[TextureEditor] Error loading texture file:', error);
      }
    } else if (isImageFile) {
      // Loading an image file - first check if there's already a corresponding .texture file
      try {
        console.log('[TextureEditor] Loading image file:', filename);
        
        // Check if a corresponding .texture file exists
        const baseName = this.file.filename.replace(/\.[^.]+$/, ''); // Remove extension
        const textureFileName = baseName + '.texture';
        const texturePath = this.file.path.replace(/\.[^.]+$/, '.texture');
        
        console.log('[TextureEditor] Image file path:', this.file.path);
        console.log('[TextureEditor] Constructed texture path:', texturePath);
        
        // Try to load the corresponding texture file
        const fileIOService = window.serviceContainer?.get('fileIOService');
        let existingTextureFile = null;
        
        if (fileIOService) {
          try {
            // this.file.path is already the storage path, don't remove prefix
            existingTextureFile = await fileIOService.loadFile(texturePath);
            console.log('[TextureEditor] Successfully loaded existing texture file');
            console.log('[TextureEditor] Texture file has content:', !!existingTextureFile?.fileContent);
          } catch (error) {
            console.log('[TextureEditor] Failed to load texture file:', error.message);
          }
        }
        
        if (existingTextureFile && existingTextureFile.fileContent) {
          try {
            console.log('[TextureEditor] Using existing texture file with', existingTextureFile.fileContent.length, 'bytes');
            // Load the existing texture file instead of creating a new one
            console.log('[TextureEditor] Loading existing texture file instead of image');
            
            // Create a RetroImage and load the texture content
            const retroImage = new window.RetroImage();
            await retroImage.loadFromTexture(existingTextureFile.fileContent, textureFileName);
            
            // Set the loaded RetroImage
            this.retroImage = retroImage;
            
            console.log('[TextureEditor] RetroImage loaded from existing texture, format:', retroImage._format);
            
            // Setup original canvas to show the source image
            this.originalCanvas.width = this.retroImage.width;
            this.originalCanvas.height = this.retroImage.height;
            
            const ctx = this.originalCanvas.getContext('2d');
            
            // Get the original image data and draw it
            const imageData = this.retroImage.toImageData();
            ctx.putImageData(imageData, 0, 0);
            
            // Update image info display
            if (this.imageInfo) {
              this.imageInfo.textContent = `${this.retroImage.width}x${this.retroImage.height}`;
            }
            
            // Update UI with format from the loaded texture BEFORE processing
            if (retroImage._format) {
              this.formatSelect.value = retroImage._format;
              console.log('[TextureEditor] Set format from existing texture file:', retroImage._format);
            }
            
            // Update palette offset if available
            if (retroImage.paletteOffset !== undefined) {
              this.paletteOffset = retroImage.paletteOffset;
              this.paletteOffsetSlider.value = this.paletteOffset;
              this.paletteOffsetValue.textContent = this.paletteOffset;
            }
            
            // Update display after setting UI values
            await this.processTexture();
            
            // Load texture data properties from the existing texture file
            try {
              const textureConfig = JSON.parse(existingTextureFile.fileContent);
              this.textureData.name = textureConfig.name || baseName;
              this.textureData.sourceImage = textureConfig.sourceImage || this.file.path;
              
              // Load transparency setting
              if (textureConfig.reserveTransparency !== undefined) {
                this.reserveTransparency = textureConfig.reserveTransparency;
                this.textureData.reserveTransparency = this.reserveTransparency;
                if (this.reserveTransparencyCheckbox) {
                  this.reserveTransparencyCheckbox.checked = this.reserveTransparency;
                }
              }
              
              // Load palette if specified
              if (textureConfig.palette) {
                this.textureData.palettePath = textureConfig.palette;
                await this.loadPaletteFromFile(textureConfig.palette, false); // false = don't mark dirty when loading existing
              }
              
              console.log('[TextureEditor] Loaded texture configuration:', textureConfig);
            } catch (error) {
              console.warn('[TextureEditor] Could not parse texture config from existing file:', error);
            }
            
            console.log('[TextureEditor] Successfully loaded existing texture file');
            return; // Exit early, don't create new texture data
            
          } catch (error) {
            console.error('[TextureEditor] Error loading existing texture file:', error);
            console.log('[TextureEditor] Falling back to creating new texture data from image');
          }
        } else {
          console.log('[TextureEditor] No existing texture file found or no content, creating new texture data');
        }
        
        // No existing texture file, create new texture data from image
        {
          // No existing texture file, create new texture data from image
          console.log('[TextureEditor] Creating new texture data from image file');
          
          // Convert base64 content to blob
          const base64Data = this.file.fileContent;
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'image/png' });
          
          // Update texture data to reference this image
          this.textureData.sourceImage = this.file.path;
          this.textureData.name = baseName;
          
          await this.loadImage(blob);
          
          // Mark as dirty since we've created new texture data that needs saving
          this.markDirty();
          
          console.log('[TextureEditor] Image loaded, texture data created and marked dirty');
        }
      } catch (error) {
        console.error('[TextureEditor] Error loading image file:', error);
      }
    } else {
      console.log('[TextureEditor] File is not a supported image or texture file:', filename);
    }
  }

  async loadImage(file) {
    console.log('[TextureEditor] loadImage called with file:', file);
    try {
      // Create RetroImage directly from the file
      this.retroImage = new window.RetroImage();
      
      console.log('[TextureEditor] Loading RetroImage from file:', file);
      await this.retroImage.loadFromFile(file);
      
      console.log('[TextureEditor] RetroImage loaded:', this.retroImage.width, 'x', this.retroImage.height);
      
      // Update image info
      this.imageInfo.textContent = `${this.retroImage.width}x${this.retroImage.height}`;
      
      // Setup original canvas
      this.originalCanvas.width = this.retroImage.width;
      this.originalCanvas.height = this.retroImage.height;
      
      const ctx = this.originalCanvas.getContext('2d');
      
      // Get the original image data and draw it
      const imageData = this.retroImage.toImageData();
      ctx.putImageData(imageData, 0, 0);

      // Use the suggested format from RetroImage analysis
      if (this.retroImage.suggestedFormat) {
        console.log('[TextureEditor] Using suggested format from RetroImage:', this.retroImage.suggestedFormat);
        this.formatSelect.value = this.retroImage.suggestedFormat;
        this.textureData.outputPixelFormat = this.retroImage.suggestedFormat;
        this.updatePaletteVisibility();
      }
      
      // Fit canvases to viewport after loading
      setTimeout(() => {
        this.fitCanvasToViewport('original');
        this.fitCanvasToViewport('processed');
      }, 100);
      
      this.processTexture();
      
    } catch (error) {
      console.error('[TextureEditor] Error loading image:', error);
    }
  }

  async loadPalette() {
    if (!this.textureData.palettePath) {
      this.currentPalette = null;
      this.processTexture();
      return;
    }

    try {
      console.log('[TextureEditor] Loading palette:', this.textureData.palettePath);
      const palette = await window.Palette.load(this.textureData.palettePath);
      this.currentPalette = palette;
      this.displayPalette();
      this.processTexture();
    } catch (error) {
      console.error('[TextureEditor] Error loading palette:', error);
      this.currentPalette = null;
    }
  }

  getMaxColorsForFormat(format) {
    switch (format) {
      case 'd2_mode_i4':
      case 'ai44':
        return 16;
      case 'd2_mode_i8':
        return 256;
      case 'd2_mode_a8':
      case 'd2_mode_l8':
      case 'd2_mode_lum8':
      case 'd2_mode_r8':
      case 'd2_mode_g8':
      case 'd2_mode_b8':
        return 256;
      default:
        return 256; // Default max for indexed formats
    }
  }

  displayPalette() {
    if (!this.paletteDisplay) {
      console.warn('[TextureEditor] Palette display element not found');
      return;
    }

    if (!this.currentPalette) {
      this.paletteDisplay.innerHTML = '<div style="color: #999; text-align: center; padding: 20px;">No palette loaded</div>';
      this.paletteInfo.textContent = '';
      return;
    }

    const colors = this.currentPalette.colors || [];
    console.log(`[TextureEditor] displayPalette: showing ${colors.length} colors`);
    console.log(`[TextureEditor] First 5 colors:`, colors.slice(0, 5));
    
    const format = this.formatSelect.value;
    const isIndexed = format.includes('_i') || format.includes('ai44');
    
    // Create palette grid
    const paletteGrid = document.createElement('div');
    paletteGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(16, 16px);
      gap: 1px;
      margin-bottom: 10px;
      position: relative;
    `;

    console.log(`[TextureEditor] Creating palette grid for ${colors.length} colors`);

    // Get max colors for format
    const maxColors = this.getMaxColorsForFormat(format);
    
    colors.forEach((color, index) => {
      // Convert RGB object to CSS color string
      const colorString = `rgb(${color.r}, ${color.g}, ${color.b})`;
      
      const colorSwatch = document.createElement('div');
      colorSwatch.style.cssText = `
        width: 16px;
        height: 16px;
        background: ${colorString};
        border: 1px solid #333;
        cursor: pointer;
        position: relative;
      `;

      if (index < 5) {
        console.log(`[TextureEditor] Color ${index}: ${colorString}`);
      }

      // Dim colors not in current chunk for indexed formats
      if (isIndexed) {
        const chunkStart = Math.floor(index / maxColors) * maxColors;
        const isCurrentOffset = chunkStart === this.paletteOffset;
        
        if (!isCurrentOffset) {
          colorSwatch.style.opacity = '0.3';
        }
      }

      // Click handler for palette offset
      colorSwatch.addEventListener('click', () => {
        if (isIndexed) {
          const newOffset = Math.floor(index / maxColors) * maxColors;
          if (newOffset !== this.paletteOffset && newOffset <= parseInt(this.paletteOffsetSlider.max)) {
            this.paletteOffset = newOffset;
            this.paletteOffsetSlider.value = newOffset;
            this.paletteOffsetValue.textContent = newOffset;
            this.textureData.paletteOffset = newOffset;
            this.displayPalette(); // Refresh display
            this.processTexture(); // Reprocess with new offset
          }
        }
      });

      // Tooltip
      const chunkIndex = Math.floor(index / maxColors);
      const colorDesc = `rgb(${color.r},${color.g},${color.b})`;
      colorSwatch.title = `Color ${index}: ${colorDesc}${isIndexed ? ` (chunk ${chunkIndex + 1})` : ''}`;

      paletteGrid.appendChild(colorSwatch);
    });

    console.log(`[TextureEditor] Added ${colors.length} color swatches to grid`);
    console.log(`[TextureEditor] Grid children count:`, paletteGrid.children.length);

    // Add green border around selected chunk for indexed formats
    if (isIndexed && colors.length > maxColors) {
      const chunkIndex = Math.floor(this.paletteOffset / maxColors);
      const startIndex = chunkIndex * maxColors;
      const endIndex = Math.min(startIndex + maxColors - 1, colors.length - 1);
      
      // Create border overlay using CSS grid positioning
      const borderOverlay = document.createElement('div');
      borderOverlay.style.cssText = `
        border: 2px solid #4a8a4a;
        background: rgba(74, 138, 74, 0.1);
        pointer-events: none;
        z-index: 1;
        box-sizing: border-box;
        grid-area: ${Math.floor(startIndex / 16) + 1} / ${(startIndex % 16) + 1} / ${Math.floor(endIndex / 16) + 2} / ${(endIndex % 16) + 2};
      `;
      
      paletteGrid.appendChild(borderOverlay);
    }

    // Add palette info
    const paletteInfo = document.createElement('div');
    paletteInfo.style.cssText = `
      font-size: 11px;
      color: #ccc;
      text-align: center;
      margin-top: 5px;
    `;
    
    if (isIndexed) {
      const chunkIndex = Math.floor(this.paletteOffset / maxColors);
      const totalChunks = Math.ceil(colors.length / maxColors);
      paletteInfo.innerHTML = `${colors.length} total colors<br>Using chunk ${chunkIndex + 1}/${totalChunks} (${maxColors} colors)<br>Click colors to select chunk`;
    } else {
      paletteInfo.textContent = `${colors.length} colors - Full palette used`;
    }

    this.paletteDisplay.innerHTML = '';
    this.paletteDisplay.appendChild(paletteGrid);
    this.paletteDisplay.appendChild(paletteInfo);

    // Update info panel
    if (this.paletteInfo) {
      this.paletteInfo.textContent = `Distance: ${this.colorDistanceMethod.toUpperCase()}`;
    }
  }

  getMaxColorsForFormat(format) {
    switch (format) {
      case 'd2_mode_i1': return 2;
      case 'd2_mode_i2': return 4;
      case 'd2_mode_i4': return 16;
      case 'd2_mode_ai44': return 16;
      case 'd2_mode_i8': return 256;
      default: return 256;
    }
  }

  async processTexture() {
    if (!this.retroImage) return;

    try {
      const format = this.formatSelect.value;
      
      // Configure RetroImage using the same pattern as workflow test
      this.retroImage.setFormat(format);
      
      // Handle palette for indexed formats
      if (format.includes('_i') || format === 'd2_mode_ai44') {
        if (this.currentPalette && this.currentPalette.rgbObjects) {
          this.retroImage.setPalette(this.currentPalette.rgbObjects);
        } else {
          // Extract palette from the image if none is loaded
          const palette = this.retroImage.extractPalette(256);
          this.retroImage.setPalette(palette);
          
          // Generate a unique name for the auto-generated palette
          const imageName = this.file?.filename?.replace(/\.(png|jpg|jpeg|gif|bmp|webp|tga)$/i, '') || 'texture';
          const paletteName = `${imageName}_palette.act`;
          const palettePath = `Sources/Palettes/${paletteName}`;
          
          this.currentPalette = {
            colors: palette, // Store RGB objects directly (system standard)
            rgbObjects: palette, // Maintain compatibility
            name: paletteName,
            source: 'auto-generated',
            path: palettePath
          };
          
          // Update texture data to reference the saved palette
          console.log('[TextureEditor] Setting auto-generated palette path to:', palettePath);
          this.textureData.palettePath = palettePath;
          // Note: Don't save the full palette object to avoid serializing color data
          // this.textureData.palette = this.currentPalette;
          
          // Save the auto-generated palette to the project
          await this.saveAutoGeneratedPalette(palettePath, palette);
          
          this.displayPalette();
        }
        this.retroImage.setPaletteOffset(this.paletteOffset);
      }

      // Generate D2 texture data
      const d2Data = await this.retroImage.toD2({
        reserveTransparency: this.reserveTransparency
      });
      
      // Load back for display
      const textureImage = await window.RetroImage.fromD2(d2Data);
      
      // Display the result
      this.displayTextureOutput(textureImage, d2Data);
      
      console.log('[TextureEditor] Texture processed successfully');
      
    } catch (error) {
      console.error('[TextureEditor] Error processing texture:', error);
    }
  }

  async saveAutoGeneratedPalette(palettePath, paletteColors) {
    try {
      console.log(`[TextureEditor] Saving auto-generated palette to: ${palettePath}`);
      
      // Convert RGB objects to ACT format binary data
      const actBuffer = new ArrayBuffer(772); // 256 * 3 + 4 bytes for count
      const actView = new Uint8Array(actBuffer);
      
      // Write palette colors (ACT format: RGB triplets)
      for (let i = 0; i < 256; i++) {
        const color = paletteColors[i] || { r: 0, g: 0, b: 0 }; // Pad with black if needed
        actView[i * 3] = color.r;
        actView[i * 3 + 1] = color.g;
        actView[i * 3 + 2] = color.b;
      }
      
      // Write color count at the end (ACT format requirement)
      const colorCount = Math.min(paletteColors.length, 256);
      actView[768] = colorCount & 0xFF;
      actView[769] = (colorCount >> 8) & 0xFF;
      actView[770] = 0; // Reserved
      actView[771] = 0; // Reserved
      
      // Save to project storage
      await window.fileIOService.saveFile(palettePath, actBuffer, { binaryData: true });
      
      // Add to project explorer if available
      const gameEmulator = window.gameEmulator || (typeof window !== 'undefined' ? window.gameEmulator : null);
      if (gameEmulator && gameEmulator.projectExplorer && gameEmulator.projectExplorer.addFileToProjectByName) {
        const filename = palettePath.split('/').pop();
        gameEmulator.projectExplorer.addFileToProjectByName(filename, 'Sources/Palettes');
        console.log(`[TextureEditor] Added auto-generated palette to project: ${filename}`);
      }
      
      console.log(`[TextureEditor] Successfully saved auto-generated palette with ${colorCount} colors`);
      
    } catch (error) {
      console.error('[TextureEditor] Failed to save auto-generated palette:', error);
      // Don't throw the error - we don't want to break the texture processing
    }
  }

  displayTextureOutput(textureImage, d2Data) {
    if (!this.processedCanvas || !textureImage) {
      console.warn('[TextureEditor] Cannot display texture output - missing canvas or image');
      return;
    }

    try {
      // Get the processed image data
      const imageData = textureImage.toImageData();
      console.log('[TextureEditor] Processing texture output:', imageData.width, 'x', imageData.height);
      
      // Set canvas to actual image size
      this.processedCanvas.width = imageData.width;
      this.processedCanvas.height = imageData.height;
      
      // Draw the processed image data directly
      const ctx = this.processedCanvas.getContext('2d');
      ctx.putImageData(imageData, 0, 0);
      
      // Update canvas transform for zoom/pan
      this.updateCanvasTransform('processed');
      
      console.log('[TextureEditor] Displayed processed texture:', imageData.width, 'x', imageData.height);
      
    } catch (error) {
      console.error('[TextureEditor] Error displaying texture output:', error);
    }
  }

  // Required EditorBase methods
  onFileChanged() {
    console.log('[TextureEditor] File changed notification');
  }

  async saveFile() {
    if (!this.retroImage) {
      throw new Error('No image loaded to save texture data for');
    }

    try {
      // Create texture file content
      const format = this.formatSelect?.value || 'd2_mode_i4';
      const isIndexed = format.includes('_i') || format.includes('ai44');
      
      const textureData = {
        name: this.textureData.name,
        width: this.retroImage.width,
        height: this.retroImage.height,
        format: format,
        paletteOffset: this.paletteOffset || 0,
        sourceImage: this.textureData.sourceImage || this.file.path
      };
      
      // Only include palette for indexed formats, and ensure it's a path string
      if (isIndexed && this.textureData.palettePath && typeof this.textureData.palettePath === 'string') {
        textureData.palette = this.textureData.palettePath;
        console.log('[TextureEditor] saveFile including palette for indexed format:', this.textureData.palettePath);
      } else if (isIndexed) {
        console.log('[TextureEditor] saveFile indexed format but no valid palette path:', this.textureData.palettePath);
      } else {
        console.log('[TextureEditor] saveFile direct color format, not including palette');
      }

      console.log('[TextureEditor] saveFile generated texture content:', textureData);

      // Determine the texture file path
      let texturePath;
      const filename = this.file.filename || '';
      const isTextureFile = filename.match(/\.(texture|tex)$/i);
      
      if (isTextureFile) {
        // Already editing a .texture file, save to the same path
        texturePath = this.file.path;
      } else {
        // Image file - create corresponding .texture file
        texturePath = this.file.path.replace(/\.(png|jpg|jpeg|gif|bmp|webp)$/i, '.texture');
      }
      
      // Save using FileIOService
      const fileIOService = window.serviceContainer?.get('fileIOService');
      if (!fileIOService) {
        throw new Error('FileIOService not available');
      }

      await fileIOService.saveFile(texturePath, JSON.stringify(textureData, null, 2), {
        binaryData: false,
        builderId: 'texture'
      });

      console.log('[TextureEditor] Saved texture file:', texturePath);
      
      // Mark as not dirty after successful save
      this.isDirty = false;
      this.hasUnsavedChanges = false;
      
      // Notify tab manager about the save
      if (window.eventBus) {
        window.eventBus.emit('editor.content.saved', { editor: this });
      }
      
      // Update tab title to remove dirty indicator
      this.updateTabTitle();
      
      console.log('[TextureEditor] Cleared dirty state and notified tab manager');
      
      // Extract directory and filename from texture path
      const pathParts = texturePath.split('/');
      const fileName = pathParts.pop();
      const directory = pathParts.join('/');
      
      // Notify project explorer that a new file was created
      if (window.eventBus) {
        // Emit file added event like the project explorer does
        window.eventBus.emit('file.added', { 
          name: fileName,
          path: texturePath,
          directory: directory,
          type: 'file'
        });
        
        // Also emit content refresh for good measure
        window.eventBus.emit('content.refresh.required', { 
          reason: 'texture-file-created',
          path: texturePath 
        });
        
        // Emit file list refresh event like project explorer does
        window.eventBus.emit('file.list.refresh', {
          reason: 'texture-file-created',
          path: texturePath
        });
      }
      
      // Try to add the file directly to the project explorer
      console.log('[TextureEditor] Checking for project explorer... {gameEditor: false, projectExplorer: false, directProjectExplorer: true, serviceProjectExplorer: true, addFileToProject: \'undefined\'}');
      
      let projectExplorer = null;
      
      // Try multiple paths to find the project explorer
      if (window.gameEditor?.projectExplorer) {
        projectExplorer = window.gameEditor.projectExplorer;
        console.log('[TextureEditor] Found project explorer via gameEditor');
      } else if (window.projectExplorer) {
        projectExplorer = window.projectExplorer;
        console.log('[TextureEditor] Found project explorer via window.projectExplorer');
      } else if (window.serviceContainer?.get) {
        projectExplorer = window.serviceContainer.get('projectExplorer');
        console.log('[TextureEditor] Found project explorer via serviceContainer');
      }
      
      if (projectExplorer && typeof projectExplorer.addFileToProject === 'function') {
        // Create a file metadata object like the project explorer expects
        const textureFileMetadata = {
          name: fileName,
          size: JSON.stringify(textureData, null, 2).length,
          lastModified: Date.now()
        };
        
        console.log('[TextureEditor] Adding texture file to project via addFileToProject:', textureFileMetadata);
        
        try {
          // Add the texture file to the project structure and render tree
          await projectExplorer.addFileToProject(textureFileMetadata, directory, true, false); // skipAutoOpen=true, skipRender=false
          console.log('[TextureEditor] Successfully added texture file to project structure');
        } catch (error) {
          console.error('[TextureEditor] Failed to add texture file to project:', error);
        }
      } else {
        console.log('[TextureEditor] No project explorer found - texture file will not appear in tree');
      }
      
      return texturePath;
      
    } catch (error) {
      console.error('[TextureEditor] Error saving texture file:', error);
      throw error;
    }
  }

  // Override markDirty to properly mark the editor as dirty
  markDirty() {
    const stack = new Error().stack;
    console.log('[TextureEditor] markDirty called, current dirty state:', this.isDirty);
    console.log('[TextureEditor] markDirty stack trace:', stack);
    super.markDirty(); // Call the base class method
  }

  canSave() {
    return !!this.retroImage;
  }

  // Override getContent to return texture file JSON content
  getContent() {
    if (!this.retroImage) {
      console.warn('[TextureEditor] getContent called but no retroImage available');
      return '';
    }

    try {
      // Create texture file content
      const format = this.formatSelect?.value || 'd2_mode_i4';
      const isIndexed = format.includes('_i') || format.includes('ai44');
      
      const textureData = {
        name: this.textureData.name,
        width: this.retroImage.width,
        height: this.retroImage.height,
        format: format,
        paletteOffset: this.paletteOffset || 0,
        sourceImage: this.textureData.sourceImage || this.file.path
      };
      
      // Only include palette for indexed formats
      if (isIndexed && this.textureData.palettePath) {
        console.log('[TextureEditor] Including palette for indexed format:', this.textureData.palettePath);
        textureData.palette = this.textureData.palettePath;
      } else if (isIndexed) {
        console.log('[TextureEditor] Indexed format but no palette path set');
      } else {
        console.log('[TextureEditor] Direct color format, not including palette');
      }

      console.log('[TextureEditor] Generated texture content:', textureData);
      return JSON.stringify(textureData, null, 2);
    } catch (error) {
      console.error('[TextureEditor] Error creating texture content:', error);
      return '';
    }
  }

  // Override save method to create .texture file
  async save() {
    console.log('[TextureEditor] save() called');
    
    if (!this.retroImage) {
      throw new Error('No texture data to save');
    }

    try {
      // Get the texture content
      const content = this.getContent();
      if (!content) {
        throw new Error('No content to save');
      }

      // Determine the texture file path
      let texturePath;
      const filename = this.file.filename || '';
      const isTextureFile = filename.match(/\.(texture|tex)$/i);
      
      if (isTextureFile) {
        // Already editing a .texture file, save to the same path normally
        texturePath = this.file.path;
        
        const fileIOService = window.serviceContainer?.get('fileIOService');
        if (!fileIOService) {
          throw new Error('FileIOService not available');
        }

        await fileIOService.saveFile(texturePath, content, {
          binaryData: false,
          builderId: 'texture',
          type: '.texture',
          editor: 'TextureEditor'
        });
        
        console.log('[TextureEditor] Updated existing texture file:', texturePath);
      } else {
        // Image file - create corresponding .texture file via addFileToProjectByName
        const basePath = this.path.replace(/\.(png|jpg|jpeg|gif|bmp|webp)$/i, '');
        const textureFileName = basePath.split('/').pop() + '.texture';
        
        console.log('[TextureEditor] Creating new texture file via addFileToProjectByName:', textureFileName);

        // Find project explorer
        let projectExplorer = null;
        
        if (window.gameEmulator?.projectExplorer) {
          projectExplorer = window.gameEmulator.projectExplorer;
          console.log('[TextureEditor] Found project explorer via gameEmulator');
        }
        
        console.log('[TextureEditor] Project explorer found:', {
          found: !!projectExplorer,
          hasAddFileToProject: !!(projectExplorer && typeof projectExplorer.addFileToProject === 'function'),
          hasAddFileToProjectByName: !!(projectExplorer && typeof projectExplorer.addFileToProjectByName === 'function'),
          type: projectExplorer ? projectExplorer.constructor?.name : 'none'
        });
        
        if (projectExplorer && typeof projectExplorer.addFileToProjectByName === 'function') {
          console.log('[TextureEditor] Adding texture file to project via addFileToProjectByName:', textureFileName);
          
          // First add the file to the project structure - this will determine the correct path automatically
          await projectExplorer.addFileToProjectByName(textureFileName, true, false); // skipAutoOpen=true, skipRender=false
          
          // Now save the content using the file I/O service
          const fileIOService = window.serviceContainer?.get('fileIOService');
          if (!fileIOService) {
            throw new Error('FileIOService not available');
          }
          
          // The addFileToProjectByName should have determined the correct storage path
          // For .texture files, this should be "Sources/Images/filename.texture"
          const storagePath = `Sources/Images/${textureFileName}`;
          texturePath = `test/Sources/Images/${textureFileName}`; // Full path for display
          
          console.log('[TextureEditor] Saving texture content to storage path:', storagePath);
          await fileIOService.saveFile(storagePath, content, { binaryData: false }); // JSON content, not binary
          console.log('[TextureEditor] Successfully added texture file to project via addFileToProjectByName');
        } else {
          // Fallback to direct save if project explorer not available
          console.log('[TextureEditor] Project explorer not available, using direct save');
          const fileIOService = window.serviceContainer?.get('fileIOService');
          if (!fileIOService) {
            throw new Error('FileIOService not available');
          }

          await fileIOService.saveFile(texturePath, content, {
            binaryData: false,
            builderId: 'texture',
            type: '.texture',
            editor: 'TextureEditor'
          });
        }
      }

      console.log('[TextureEditor] Saved texture file:', texturePath);
      
      // Mark as not dirty after successful save
      this.isDirty = false;
      this.hasUnsavedChanges = false;
      
      // Notify that the editor content was saved
      if (window.eventBus) {
        window.eventBus.emit('editor.content.saved', { editor: this });
      }
      
      // Update tab title to remove dirty indicator
      this.updateTabTitle();
      
      console.log('[TextureEditor] Save completed successfully');
      
    } catch (error) {
      console.error('[TextureEditor] Save failed:', error);
      throw error;
    }
  }

  getDisplayName() {
    return this.file?.name || 'Texture Editor';
  }

  async createPaletteFromImage() {
    if (!this.retroImage) {
      console.warn('[TextureEditor] No RetroImage loaded to create palette from');
      return;
    }

    // Ask user for max colors using themed prompt
    const format = this.formatSelect.value;
    const maxColorsForFormat = this.getMaxColorsForFormat(format);
    const isIndexed = format.includes('_i') || format.includes('ai44');
    
    const defaultMaxColors = isIndexed ? maxColorsForFormat : 256;
    const message = `Enter maximum number of colors to extract from image:\n\nCurrent format: ${format}\nRecommended: ${defaultMaxColors} colors`;
    
    try {
      const userInput = await ModalUtils.showPrompt(
        'Create Palette from Image', 
        message, 
        defaultMaxColors.toString(),
        {
          inputType: 'number',
          placeholder: 'Enter number between 1-256',
          okText: 'Create Palette',
          cancelText: 'Cancel'
        }
      );
      
      if (!userInput) {
        console.log('[TextureEditor] Palette creation cancelled by user');
        return;
      }
      
      const requestedColors = parseInt(userInput);
      if (isNaN(requestedColors) || requestedColors < 1 || requestedColors > 256) {
        await ModalUtils.showConfirm('Invalid Input', 'Please enter a valid number between 1 and 256', {
          okText: 'OK',
          showCancel: false
        });
        return;
      }

      // Use RetroImage's built-in extractPalette method
      const paletteRgbObjects = this.retroImage.extractPalette(requestedColors);
      
      console.log(`[TextureEditor] extractPalette returned ${paletteRgbObjects.length} colors`);
      console.log(`[TextureEditor] Sample colors:`, paletteRgbObjects.slice(0, 10));
      
      // Check for duplicates
      const uniqueCheck = new Set();
      paletteRgbObjects.forEach(color => {
        uniqueCheck.add(`${color.r},${color.g},${color.b}`);
      });
      console.log(`[TextureEditor] Unique color count: ${uniqueCheck.size} out of ${paletteRgbObjects.length}`);
      
      if (paletteRgbObjects && paletteRgbObjects.length > 0) {
        // Store palette as RGB objects (system standard)
        this.currentPalette = {
          colors: paletteRgbObjects, // Store as RGB objects directly
          rgbObjects: paletteRgbObjects, // Maintain compatibility
          name: `Generated (${paletteRgbObjects.length} colors)`,
          source: 'image'
        };
        
        // Reset offset for new palette
        this.paletteOffset = 0;
        this.paletteOffsetSlider.value = 0;
        this.paletteOffsetValue.textContent = '0';
        
        // Update offset slider max
        if (isIndexed && paletteRgbObjects.length > maxColorsForFormat) {
          const maxOffset = Math.floor((paletteRgbObjects.length - 1) / maxColorsForFormat) * maxColorsForFormat;
          this.paletteOffsetSlider.max = maxOffset;
          this.paletteOffsetSlider.step = maxColorsForFormat;
          this.updatePaletteVisibility(); // Show offset controls
        } else {
          this.paletteOffsetSlider.max = 0;
          this.updatePaletteVisibility(); // Hide offset controls if not needed
        }
        
        // Update texture data
        // Note: Don't save the full palette object to avoid serializing color data
        // this.textureData.palette = this.currentPalette;
        this.textureData.paletteOffset = this.paletteOffset;
        
        this.displayPalette();
        this.processTexture();
        
        console.log(`[TextureEditor] Created palette with ${paletteRgbObjects.length} colors from image (requested: ${requestedColors})`);
      } else {
        console.error('[TextureEditor] Failed to create palette from image - extractPalette returned empty result');
        await ModalUtils.showConfirm('Palette Creation Failed', 'Could not extract colors from the image. The image may be corrupted or contain no usable colors.', {
          okText: 'OK',
          showCancel: false
        });
      }
    } catch (error) {
      console.error('[TextureEditor] Error in palette creation:', error);
      await ModalUtils.showConfirm('Error Creating Palette', `An error occurred while creating the palette: ${error.message}`, {
        okText: 'OK',
        showCancel: false
      });
    }
  }

  async showPaletteLoadDialog() {
    console.log('[TextureEditor] Opening palette load dialog...');
    
    try {
      // Try ProjectExplorer first, then fallback to FileIOService
      let paletteFiles = [];
      
      // Get ProjectExplorer instance
      const projectExplorer = window.serviceContainer?.get('projectExplorer');
      if (projectExplorer && projectExplorer.GetPaletteFiles) {
        console.log('[TextureEditor] Using ProjectExplorer.GetPaletteFiles()');
        paletteFiles = projectExplorer.GetPaletteFiles() || [];
        console.log('[TextureEditor] ProjectExplorer found palette files:', paletteFiles);
      }
      
      // Fallback to FileIOService
      if (paletteFiles.length === 0) {
        const fileIOService = window.serviceContainer?.get('fileIOService');
        if (fileIOService && fileIOService.getSourcePalettes) {
          console.log('[TextureEditor] Fallback: Using FileIOService.getSourcePalettes()');
          paletteFiles = await fileIOService.getSourcePalettes() || [];
          console.log('[TextureEditor] FileIOService found palette files:', paletteFiles);
        }
      }
      
      if (!paletteFiles || paletteFiles.length === 0) {
        await ModalUtils.showConfirm('No Palettes Found', 'No palette files (.act or .pal) found in the project.', {
          okText: 'OK',
          showCancel: false
        });
        return;
      }

      // Extract names for display
      const paletteNames = paletteFiles.map(f => f.name || f.filename || f.path?.split('/').pop() || 'Unknown');
      
      // If only one palette, just confirm and load it
      if (paletteFiles.length === 1) {
        const confirmed = await ModalUtils.showConfirm(
          'Load Palette', 
          `Load the palette "${paletteNames[0]}"?`, 
          {
            okText: 'Load Palette',
            cancelText: 'Cancel'
          }
        );
        
        if (confirmed) {
          const selectedFile = paletteFiles[0];
          const palettePath = selectedFile.fullPath || selectedFile.path || selectedFile.filename || selectedFile.name;
          console.log(`[TextureEditor] Loading single palette: ${palettePath}`);
          await this.loadPaletteFromFile(palettePath);
        }
        return;
      }
      
      // Multiple palettes - show selection list
      const paletteOptions = paletteFiles.map((file, index) => ({
        value: index.toString(),
        label: paletteNames[index]
      }));
      
      const selectedIndex = await ModalUtils.showSelectionList(
        'Select Palette', 
        'Choose a palette to load from the project:',
        paletteOptions,
        {
          defaultValue: '0',
          confirmText: 'Load Palette',
          cancelText: 'Cancel'
        }
      );
      
      if (selectedIndex !== null) {
        const index = parseInt(selectedIndex);
        const selectedFile = paletteFiles[index];
        const palettePath = selectedFile.fullPath || selectedFile.path || selectedFile.filename || selectedFile.name;
        console.log(`[TextureEditor] Loading selected palette: ${palettePath}`);
        await this.loadPaletteFromFile(palettePath);
      }
    } catch (error) {
      console.error('[TextureEditor] Error loading palette from project:', error);
      await ModalUtils.showConfirm('Error Loading Palette', `Failed to load palette: ${error.message}`, {
        okText: 'OK',
        showCancel: false
      });
    }
  }

  async loadPaletteFromFile(palettePath, markDirtyFlag = true) {
    try {
      console.log(`[TextureEditor] Loading palette from: ${palettePath}`);
      
      // Use the file service to load the palette file
      const fileIOService = window.serviceContainer?.get('fileIOService');
      if (!fileIOService) {
        throw new Error('FileIOService not available');
      }
      
      const storagePath = ProjectPaths.normalizeStoragePath(palettePath);
      const fileData = await fileIOService.loadFile(storagePath);
      
      if (!fileData || !fileData.fileContent) {
        throw new Error('Failed to load palette file');
      }
      
      const paletteData = new Palette();
      await paletteData.loadFromContent(fileData.fileContent, palettePath);
      
      console.log(`[TextureEditor] Palette loaded, checking data:`, paletteData);
      console.log(`[TextureEditor] Palette rgbObjects:`, paletteData.rgbObjects);
      console.log(`[TextureEditor] Palette colors:`, paletteData.colors);
      
      if (paletteData && paletteData.rgbObjects) {
        this.currentPalette = {
          name: paletteData.name || 'Loaded Palette',
          rgbObjects: paletteData.rgbObjects,
          colors: paletteData.colors // Add this for displayPalette compatibility
        };
        
        console.log(`[TextureEditor] Loaded external palette: ${this.currentPalette.name} with ${this.currentPalette.rgbObjects.length} colors`);
        console.log(`[TextureEditor] First 3 palette colors:`, this.currentPalette.rgbObjects.slice(0, 3));
        
        // Set palette on image (marks as dirty)
        this.retroImage.setPalette(this.currentPalette.rgbObjects, this.currentPalette.name);
        
        // Ensure we only save the palette path as a string, never color data
        const palettePath = this.currentPalette.path || this.currentPalette.name;
        if (typeof palettePath === 'string') {
          this.textureData.palettePath = palettePath;
          console.log('[TextureEditor] Set palette path to:', palettePath);
        } else {
          console.warn('[TextureEditor] Invalid palette path type:', typeof palettePath, palettePath);
        }
        
        if (markDirtyFlag) {
          this.markDirty(); // Mark texture file as needing save
        }
        
        this.displayPalette();
        await this.processTexture(); // Refresh display
        
        console.log(`[TextureEditor] Palette loaded: ${this.currentPalette.name} (${this.currentPalette.rgbObjects.length} colors)`);
      } else {
        console.error(`[TextureEditor] Palette data is invalid:`, {
          paletteData: paletteData,
          hasRgbObjects: !!paletteData?.rgbObjects,
          rgbObjectsLength: paletteData?.rgbObjects?.length,
          colors: paletteData?.colors
        });
      }
    } catch (error) {
      console.error('[TextureEditor] Error loading palette:', error);
      ModalUtils.showConfirm('Error loading palette: ' + error.message);
    }
  }

  // Static methods for EditorRegistry registration
  static getFileExtensions() { 
    return ['.texture', '.tex', '.png', '.gif', '.jpg', '.jpeg', '.bmp', '.webp', '.tga']; // Handle both texture files and image files
  }
  
  static getDisplayName() { 
    return 'Texture Editor'; 
  }
  
  static getIcon() { 
    return '🖼️'; 
  }
  
  static getPriority() { 
    return 5; // Higher priority than simple viewers (lower number = higher priority)
  }
  
  static getCapabilities() { 
    return ['texture-editing', 'palette-editing', 'image-editing']; 
  }
  
  static canCreate = true; // Can create new texture files
  static singleInstance = false; // Allow multiple instances
  
  static getDefaultFolder() {
    return 'Resources/Textures/Source';
  }

  static createNew() {
    // Return default texture data structure
    const format = 'd2_mode_i4';  // Default to indexed format
    const isIndexed = format.includes('_i') || format.includes('ai44');
    
    const textureData = {
      name: 'texture',
      width: 32,
      height: 32,
      format: format,
      paletteOffset: 0,
      data: []
    };
    
    // Only include palette for indexed formats
    if (isIndexed) {
      textureData.palette = 'Resources/Palettes/default.act';
    }
    
    return JSON.stringify(textureData, null, 2);
  }

  // Fit image colors to the currently selected palette
  async fitImageToPalette() {
    if (!this.retroImage || !this.currentPalette) {
      console.warn('[TextureEditor] No image or palette available for fitting');
      return;
    }

    try {
      console.log(`[TextureEditor] Fitting image to palette: ${this.currentPalette.name}`);
      
      const offset = parseInt(this.paletteOffsetSlider.value) || 0;
      const distanceMethod = this.colorDistanceSelect.value || 'euclidean';
      
      console.log(`[TextureEditor] Using distance method: ${distanceMethod}, offset: ${offset}`);
      
      // Use RetroImage's fit method
      await this.retroImage.fitToPalette(offset, distanceMethod);
      await this.processTexture();
      
      console.log('[TextureEditor] Image fitted to palette successfully');
    } catch (error) {
      console.error('[TextureEditor] Error fitting image to palette:', error);
      ModalUtils.showConfirm('Error fitting to palette: ' + error.message);
    }
  }

  // Find the best palette offset for the current image
  async findBestPalette() {
    if (!this.retroImage || !this.currentPalette) {
      await ModalUtils.showConfirm('No Data', 'No image or palette available for optimization.', {
        okText: 'OK',
        showCancel: false
      });
      return;
    }

    const format = this.formatSelect.value;
    const isIndexed = format.includes('_i') || format.includes('ai44');
    
    if (!isIndexed) {
      await ModalUtils.showConfirm('Invalid Format', 'Palette offset optimization is only available for indexed color formats (I1, I2, I4, I8, AI44).', {
        okText: 'OK',
        showCancel: false
      });
      return;
    }

    try {
      console.log(`[TextureEditor] Finding best palette offset for: ${this.currentPalette.name}`);
      
      // Disable button and show progress
      this.findBestPaletteBtn.disabled = true;
      this.findBestPaletteBtn.textContent = 'Searching...';
      
      // Create progress bar in the palette info area
      const originalInfoContent = this.paletteInfo.innerHTML;
      this.paletteInfo.innerHTML = `
        <div style="margin: 5px 0;">
          <div style="font-size: 11px; color: #ccc; margin-bottom: 5px;">Finding best palette offset...</div>
          <div style="background: #333; border-radius: 3px; overflow: hidden; height: 8px;">
            <div id="progressBar" style="background: #4a8a4a; height: 100%; width: 0%; transition: width 0.3s;"></div>
          </div>
        </div>
      `;
      
      const progressBar = this.paletteInfo.querySelector('#progressBar');
      
      const distanceMethod = this.colorDistanceSelect.value || 'euclidean';
      
      // Set the current format on the RetroImage so it knows the chunk size
      if (this.retroImage && this.retroImage.setCurrentFormat) {
        this.retroImage.setCurrentFormat(format);
      }
      
      // Use RetroImage's find best method with progress callback
      const bestOffset = await this.retroImage.findBestPaletteOffset(distanceMethod, (progress) => {
        if (progressBar) {
          progressBar.style.width = `${Math.round(progress * 100)}%`;
        }
      });
      
      // Restore original content
      this.paletteInfo.innerHTML = originalInfoContent;
      
      // Re-enable button
      this.findBestPaletteBtn.disabled = false;
      this.findBestPaletteBtn.textContent = 'Find Best Palette';
      
      if (bestOffset !== undefined && bestOffset !== null) {
        // Update the UI
        this.paletteOffset = bestOffset;
        this.paletteOffsetSlider.value = bestOffset;
        this.paletteOffsetValue.textContent = bestOffset;
        this.textureData.paletteOffset = bestOffset;
        this.retroImage.setPaletteOffset(bestOffset);
        this.markDirty(); // Mark texture file as needing save
        
        // Refresh display
        this.displayPalette();
        await this.processTexture();
        
        console.log(`[TextureEditor] Best offset found: ${bestOffset}`);
        await ModalUtils.showConfirm('Optimization Complete', `Best palette offset found: ${bestOffset}`, {
          okText: 'OK',
          showCancel: false
        });
      } else {
        await ModalUtils.showConfirm('No Result', 'Could not determine optimal palette offset.', {
          okText: 'OK',
          showCancel: false
        });
      }
    } catch (error) {
      console.error('[TextureEditor] Error finding best palette:', error);
      
      // Restore button state
      this.findBestPaletteBtn.disabled = false;
      this.findBestPaletteBtn.textContent = 'Find Best Palette';
      
      await ModalUtils.showConfirm('Error', 'Error finding best palette: ' + error.message, {
        okText: 'OK',
        showCancel: false
      });
    }
  }
}

// Export class
window.TextureEditor = TextureEditor;

// Register the component
TextureEditor.registerComponent();

console.log('[TextureEditor] Simple class definition complete with EditorRegistry support');
