// palette-editor.js
// Advanced palette editor using the abstracted Palette class

console.log('[PaletteEditor] Class definition loading - NEW CONSTRUCTOR SIGNATURE VERSION');

class PaletteEditor extends EditorBase {
  constructor(fileObject, readOnly = false) {
    console.log('[PaletteEditor] Constructor called with NEW SIGNATURE:', fileObject, readOnly);
    super(fileObject, readOnly);
    
    // Use the abstracted Palette class
    this.palette = null;
    this.selectedColorIndex = 0;
    
    // UI elements
    this.container = null;
    this.paletteGrid = null;
    this.colorPicker = null;
    this.previewCanvas = null;
    
    // Drag and drop for image stealing
    this.dragOverlay = null;
    
    this.initializeEditor();
    this.setupEventListeners();
    // Apply read-only UI if already flagged
    if (this.readOnly) {
      this._applyReadOnlyPalette();
    }
  }

  initializeEditor() {
    this.container = document.createElement('div');
  this.container.className = 'palette-editor';
    this.container.innerHTML = `
      <div class="palette-toolbar">
        <div class="palette-actions">
          <button class="btn randomize-btn" title="Randomize Colors">
            🎲 Randomize
          </button>
          <button class="btn sort-btn" title="Sort by Hue & Saturation">
            🌈 Sort
          </button>
          <button class="btn steal-btn" title="Extract from Image">
            🎨 Steal Colors
          </button>
          <button class="btn export-btn" title="Export Palette">
            💾 Export
          </button>
        </div>
      </div>

      <div class="palette-main">
        <div class="palette-grid-container">
          <div class="palette-grid"></div>
          <div class="drag-overlay hidden">
            <div class="drag-content">
              <div class="drag-icon">🎨</div>
              <div class="drag-text">Drop image to steal colors</div>
            </div>
          </div>
        </div>
        
        <div class="palette-sidebar">
          <div class="color-editor">
            <h3>Color Editor</h3>
            <div class="selected-color-preview"></div>
            
            <div class="color-wheel-container">
              <canvas class="color-wheel" width="180" height="180"></canvas>
              <div class="color-wheel-cursor"></div>
            </div>
            
            <div class="lightness-bar-container">
              <canvas class="lightness-bar" width="180" height="20"></canvas>
              <div class="lightness-bar-cursor"></div>
            </div>
            
            <div class="color-sliders">
              <div class="slider-group">
                <label>Red:</label>
                <input type="range" class="rgb-slider rgb-r-slider" min="0" max="255" value="0">
                <input type="number" class="rgb-input rgb-r" min="0" max="255" value="0">
              </div>
              
              <div class="slider-group">
                <label>Green:</label>
                <input type="range" class="rgb-slider rgb-g-slider" min="0" max="255" value="0">
                <input type="number" class="rgb-input rgb-g" min="0" max="255" value="0">
              </div>
              
              <div class="slider-group">
                <label>Blue:</label>
                <input type="range" class="rgb-slider rgb-b-slider" min="0" max="255" value="0">
                <input type="number" class="rgb-input rgb-b" min="0" max="255" value="0">
              </div>
              
              <div class="slider-group">
                <label>Hue:</label>
                <input type="range" class="hsl-slider hsl-h-slider" min="0" max="360" value="0">
                <input type="number" class="hsl-input hsl-h" min="0" max="360" value="0">
              </div>
              
              <div class="slider-group">
                <label>Saturation:</label>
                <input type="range" class="hsl-slider hsl-s-slider" min="0" max="100" value="0">
                <input type="number" class="hsl-input hsl-s" min="0" max="100" value="0">
              </div>
              
              <div class="slider-group">
                <label>Lightness:</label>
                <input type="range" class="hsl-slider hsl-l-slider" min="0" max="100" value="0">
                <input type="number" class="hsl-input hsl-l" min="0" max="100" value="0">
              </div>
              
              <div class="input-group">
                <label>Hex:</label>
                <input type="text" class="hex-input" placeholder="#FF0000">
              </div>
            </div>
            
            <input type="color" class="color-picker">
          </div>
        </div>
      </div>
    `;

    this.setupUIReferences();
    this.loadPalette();

  // Align EditorBase root to this container so base read-only overlay/styling works
  this.element = this.container;
  this.element.classList.add('viewer-content', 'editor-content');
  }

  setupUIReferences() {
    // Toolbar elements
    this.randomizeBtn = this.container.querySelector('.randomize-btn');
    this.sortBtn = this.container.querySelector('.sort-btn');
    this.stealBtn = this.container.querySelector('.steal-btn');
    this.exportBtn = this.container.querySelector('.export-btn');
    
    // Main area elements
    this.paletteGrid = this.container.querySelector('.palette-grid');
    this.dragOverlay = this.container.querySelector('.drag-overlay');
    
    // Sidebar elements
    this.selectedColorPreview = this.container.querySelector('.selected-color-preview');
    this.colorWheel = this.container.querySelector('.color-wheel');
    this.colorWheelCursor = this.container.querySelector('.color-wheel-cursor');
    this.lightnessBar = this.container.querySelector('.lightness-bar');
    this.lightnessBarCursor = this.container.querySelector('.lightness-bar-cursor');
    this.colorPicker = this.container.querySelector('.color-picker');
    this.hexInput = this.container.querySelector('.hex-input');
    
    // RGB sliders and inputs
    this.rgbSliders = {
      r: this.container.querySelector('.rgb-r-slider'),
      g: this.container.querySelector('.rgb-g-slider'),
      b: this.container.querySelector('.rgb-b-slider')
    };
    this.rgbInputs = {
      r: this.container.querySelector('.rgb-r'),
      g: this.container.querySelector('.rgb-g'),
      b: this.container.querySelector('.rgb-b')
    };
    
    // HSL sliders and inputs  
    this.hslSliders = {
      h: this.container.querySelector('.hsl-h-slider'),
      s: this.container.querySelector('.hsl-s-slider'),
      l: this.container.querySelector('.hsl-l-slider')
    };
    this.hslInputs = {
      h: this.container.querySelector('.hsl-h'),
      s: this.container.querySelector('.hsl-s'),
      l: this.container.querySelector('.hsl-l')
    };
    
    // Initialize color wheel and lightness bar
    this.initializeColorWheel();
    this.initializeLightnessBar();
  }

  // Toggle read-only UI state for palette editor
  setReadOnly(isReadOnly) {
    super.setReadOnly(isReadOnly);
    this._applyReadOnlyPalette();
  }

  _applyReadOnlyPalette() {
    const disableEl = (el, disabled = this.readOnly) => { if (el) el.disabled = !!disabled; };
    // Disable mutating actions; allow export even in read-only
    disableEl(this.randomizeBtn);
    disableEl(this.sortBtn);
    disableEl(this.stealBtn);
    // Inputs
    disableEl(this.hexInput);
    disableEl(this.colorPicker);
    if (this.rgbSliders) Object.values(this.rgbSliders).forEach(el => disableEl(el));
    if (this.rgbInputs) Object.values(this.rgbInputs).forEach(el => disableEl(el));
    if (this.hslSliders) Object.values(this.hslSliders).forEach(el => disableEl(el));
    if (this.hslInputs) Object.values(this.hslInputs).forEach(el => disableEl(el));
    // Canvases: block pointer interactions
    if (this.colorWheel) this.colorWheel.style.pointerEvents = this.readOnly ? 'none' : '';
    if (this.lightnessBar) this.lightnessBar.style.pointerEvents = this.readOnly ? 'none' : '';
    // Container class for styling
    if (this.container) this.container.classList.toggle('readonly', this.readOnly);
  }
  
  initializeColorWheel() {
    const canvas = this.colorWheel;
    const ctx = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 10;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Create imageData for pixel-perfect drawing
    const imageData = ctx.createImageData(canvas.width, canvas.height);
    const data = imageData.data;
    
    // Draw color wheel with proper HSV color space
    for (let x = 0; x < canvas.width; x++) {
      for (let y = 0; y < canvas.height; y++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance <= radius) {
          // Calculate hue from angle
          let hue = Math.atan2(dy, dx) * 180 / Math.PI;
          if (hue < 0) hue += 360;
          
          // Calculate saturation from distance (0 to 1)
          const saturation = distance / radius;
          
          // Use full value (brightness) for vibrant colors
          const value = 1.0;
          
          // Convert HSV to RGB
          const rgb = this.hsvToRgb(hue, saturation, value);
          
          const index = (y * canvas.width + x) * 4;
          data[index] = rgb.r;     // Red
          data[index + 1] = rgb.g; // Green
          data[index + 2] = rgb.b; // Blue
          data[index + 3] = 255;   // Alpha
        }
      }
    }
    
    // Draw the imageData to canvas
    ctx.putImageData(imageData, 0, 0);
    
    // Add a subtle border
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    let isDragging = false;
    
    const handleColorWheelInput = (e) => {
      if (this.readOnly) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left - centerX;
      const y = e.clientY - rect.top - centerY;
      const distance = Math.sqrt(x * x + y * y);
      
      if (distance <= radius) {
        // Calculate hue from angle
        let hue = Math.atan2(y, x) * 180 / Math.PI;
        if (hue < 0) hue += 360;
        
        // Calculate saturation from distance
        const saturation = Math.min(distance / radius, 1.0) * 100;
        
        // Keep current lightness from the HSL sliders, or default to 50%
        const currentLightness = this.hslInputs?.l ? parseInt(this.hslInputs.l.value) : 50;
        
        // Update HSL inputs
        if (this.hslInputs?.h) this.hslInputs.h.value = Math.round(hue);
        if (this.hslSliders?.h) this.hslSliders.h.value = Math.round(hue);
        if (this.hslInputs?.s) this.hslInputs.s.value = Math.round(saturation);
        if (this.hslSliders?.s) this.hslSliders.s.value = Math.round(saturation);
        
        this.updateFromHSL();
        this.updateColorWheelCursor(hue, saturation);
        this.drawLightnessBar(); // Redraw lightness bar with new hue/saturation
      }
    };
    
    // Add click handler
    canvas.addEventListener('mousedown', (e) => {
      if (this.readOnly) return;
      isDragging = true;
      handleColorWheelInput(e);
    });
    
    // Add drag handler
    canvas.addEventListener('mousemove', (e) => {
      if (isDragging) {
        handleColorWheelInput(e);
      }
    });
    
    // Stop dragging
    canvas.addEventListener('mouseup', () => {
      isDragging = false;
    });
    
    canvas.addEventListener('mouseleave', () => {
      isDragging = false;
    });
  }

  initializeLightnessBar() {
    const canvas = this.lightnessBar;
    if (!canvas) return;
    
    this.drawLightnessBar();
    
    let isDragging = false;
    
    const handleLightnessBarInput = (e) => {
      if (this.readOnly) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const lightness = Math.min(Math.max((x / canvas.width) * 100, 0), 100);
      
      // Update HSL lightness
      if (this.hslInputs?.l) this.hslInputs.l.value = Math.round(lightness);
      if (this.hslSliders?.l) this.hslSliders.l.value = Math.round(lightness);
      
      this.updateFromHSL();
      this.updateLightnessBarCursor(lightness);
    };
    
    // Add click handler
    canvas.addEventListener('mousedown', (e) => {
      if (this.readOnly) return;
      isDragging = true;
      handleLightnessBarInput(e);
    });
    
    // Add drag handler
    canvas.addEventListener('mousemove', (e) => {
      if (isDragging) {
        handleLightnessBarInput(e);
      }
    });
    
    // Stop dragging
    canvas.addEventListener('mouseup', () => {
      isDragging = false;
    });
    
    canvas.addEventListener('mouseleave', () => {
      isDragging = false;
    });
  }

  drawLightnessBar() {
    if (!this.lightnessBar) return;
    
    const canvas = this.lightnessBar;
    const ctx = canvas.getContext('2d');
    
    // Get current hue and saturation
    const currentHue = this.hslInputs?.h ? parseInt(this.hslInputs.h.value) : 0;
    const currentSaturation = this.hslInputs?.s ? parseInt(this.hslInputs.s.value) : 0;
    
    // Create image data for pixel-perfect drawing
    const imageData = ctx.createImageData(canvas.width, canvas.height);
    const data = imageData.data;
    
    // Draw lightness gradient with current hue and saturation
    for (let x = 0; x < canvas.width; x++) {
      const lightness = (x / canvas.width) * 100;
      const rgb = this.hslToRgb(currentHue, currentSaturation / 100, lightness / 100);
      
      for (let y = 0; y < canvas.height; y++) {
        const index = (y * canvas.width + x) * 4;
        data[index] = rgb.r;     // Red
        data[index + 1] = rgb.g; // Green
        data[index + 2] = rgb.b; // Blue
        data[index + 3] = 255;   // Alpha
      }
    }
    
    // Draw the imageData to canvas
    ctx.putImageData(imageData, 0, 0);
    
    // Add border
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
  }

  updateLightnessBarCursor(lightness) {
    if (!this.lightnessBarCursor || !this.lightnessBar) return;
    
    const canvas = this.lightnessBar;
    const x = (lightness / 100) * canvas.width;
    
    // Get the canvas position within its container
    const container = canvas.parentElement;
    const containerRect = container.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    
    // Calculate offset of canvas within container
    const canvasOffsetX = canvasRect.left - containerRect.left;
    
    // Position cursor relative to the container, accounting for canvas offset
    this.lightnessBarCursor.style.left = `${canvasOffsetX + x}px`;
    this.lightnessBarCursor.style.display = 'block';
  }

  updateColorWheelCursor(hue, saturation) {
    if (!this.colorWheelCursor || !this.colorWheel) return;
    
    const canvas = this.colorWheel;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 10;
    
    // Convert HSL to position on wheel
    const angle = (hue * Math.PI) / 180;
    const distance = (saturation / 100) * radius;
    
    // Clamp distance to radius to keep cursor within wheel
    const clampedDistance = Math.min(distance, radius);
    
    const x = centerX + clampedDistance * Math.cos(angle);
    const y = centerY + clampedDistance * Math.sin(angle);
    
    // Get the canvas position within its container
    const container = canvas.parentElement;
    const containerRect = container.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    
    // Calculate offset of canvas within container
    const canvasOffsetX = canvasRect.left - containerRect.left;
    const canvasOffsetY = canvasRect.top - containerRect.top;
    
    // Position cursor relative to the container, accounting for canvas offset
    this.colorWheelCursor.style.left = `${canvasOffsetX + x}px`;
    this.colorWheelCursor.style.top = `${canvasOffsetY + y}px`;
    this.colorWheelCursor.style.display = 'block';
  }

  // HSV to RGB conversion for better color wheel
  hsvToRgb(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    
    let r = 0, g = 0, b = 0;
    
    if (0 <= h && h < 60) {
      r = c; g = x; b = 0;
    } else if (60 <= h && h < 120) {
      r = x; g = c; b = 0;
    } else if (120 <= h && h < 180) {
      r = 0; g = c; b = x;
    } else if (180 <= h && h < 240) {
      r = 0; g = x; b = c;
    } else if (240 <= h && h < 300) {
      r = x; g = 0; b = c;
    } else if (300 <= h && h < 360) {
      r = c; g = 0; b = x;
    }
    
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  }

  setupEventListeners() {
    // Action buttons
    this.randomizeBtn.addEventListener('click', () => this.randomizePalette());
    this.sortBtn.addEventListener('click', () => this.sortPalette());
    this.stealBtn.addEventListener('click', () => this.openImageSteal());
    this.exportBtn.addEventListener('click', () => this.exportPalette());

    // Color editing
    this.hexInput.addEventListener('change', () => this.updateFromHex());
    this.colorPicker.addEventListener('change', () => this.updateFromColorPicker());
    
    // RGB sliders and inputs
    Object.values(this.rgbSliders).forEach(slider => {
      slider.addEventListener('input', () => this.updateFromRGBSliders());
    });
    Object.values(this.rgbInputs).forEach(input => {
      input.addEventListener('change', () => this.updateFromRGB());
    });
    
    // HSL sliders and inputs
    Object.values(this.hslSliders).forEach(slider => {
      slider.addEventListener('input', () => this.updateFromHSLSliders());
    });
    Object.values(this.hslInputs).forEach(input => {
      input.addEventListener('change', () => this.updateFromHSL());
    });

    // Drag and drop for image stealing
    this.setupDragAndDrop();
  }

  setupDragAndDrop() {
    const gridContainer = this.container.querySelector('.palette-grid-container');
    
    gridContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dragOverlay.classList.remove('hidden');
    });
    
    gridContainer.addEventListener('dragleave', (e) => {
      if (!gridContainer.contains(e.relatedTarget)) {
        this.dragOverlay.classList.add('hidden');
      }
    });
    
    gridContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dragOverlay.classList.add('hidden');
      
      const files = Array.from(e.dataTransfer.files);
      const imageFile = files.find(file => file.type.startsWith('image/'));
      
      if (imageFile) {
        this.stealColorsFromImage(imageFile);
      }
    });
  }

  async loadPalette() {
    console.log(`[PaletteEditor] loadPalette - isNewResource: ${this.isNewResource}`);
    console.log(`[PaletteEditor] loadPalette - file:`, this.file);
    
    if (this.isNewResource) {
      // For new resources, create a default palette
      console.log(`[PaletteEditor] Loading new resource with default palette`);
      this.palette = Palette.createDefault(256);
      this.palette.name = 'New Palette';
    } else {
      try {
        await this.loadFileContent();
        
        // Use the abstracted Palette class to load content
        const filename = this.file?.name || this.path || 'palette.act';
        this.palette = await Palette.fromFile(this.file.content, filename);
        
        console.log(`[PaletteEditor] Loaded palette: ${this.palette.toString()}`);
      } catch (error) {
        console.error('[PaletteEditor] Failed to load file content:', error);
        // Fall back to default palette
        this.palette = Palette.createDefault(256);
        this.palette.name = 'Default Palette';
      }
    }
    
    // Ensure we have a valid palette
    if (!this.palette || !this.palette.isValid()) {
      console.warn('[PaletteEditor] Invalid palette, creating default');
      this.palette = Palette.createDefault(256);
      this.palette.name = 'Default Palette';
    }
    
    this.renderPaletteGrid();
    this.updateColorEditor();
  }

  // Legacy compatibility methods - now using abstracted Palette class
  get colors() {
    return this.palette ? this.palette.getColors() : [];
  }
  
  get paletteSize() {
    return this.palette ? this.palette.getColorCount() : 0;
  }

  async refreshContent() {
    console.log(`[PaletteEditor] Refreshing content for: ${this.path}`);
    try {
      // Reload using the abstracted Palette class
      await this.loadFileContent();
      if (!this.file || !this.file.content) {
        throw new Error('Content not found');
      }
      
      // Reload the palette using the abstracted class
      const filename = this.file?.name || this.path || 'palette.act';
      this.palette = await Palette.fromFile(this.file.content, filename);
      
      // Re-render after loading
      this.renderPaletteGrid();
      this.updateColorEditor();
      console.log(`[PaletteEditor] Successfully refreshed content for: ${this.path}`);
    } catch (error) {
      console.error(`[PaletteEditor] Failed to refresh content for ${this.path}:`, error);
      // Bubble up so TabManager can decide to close the tab
      throw error;
    }
  }

  async loadFileContent() {
    console.log(`[PaletteEditor] loadFileContent() - Path: ${this.path}, File: ${this.file?.name}`);
    
    try {
      let content = null;
      
      // First try to load from persistent storage if we have a path
      if (window.fileIOService && this.path) {
        // Fix path case for build files: Build/... -> build/...
          let storagePath = window.ProjectPaths && window.ProjectPaths.normalizeStoragePath ? 
            window.ProjectPaths.normalizeStoragePath(this.path) : this.path;
          if (this.path.startsWith('Build/')) {
            console.log(`[PaletteEditor] Converted build path: ${this.path} -> ${storagePath}`);
          }
        
        console.log(`[PaletteEditor] Attempting to load from persistent storage: ${storagePath}`);
        const storedFile = await window.fileIOService.loadFile(storagePath);
        if (storedFile) {
          // Prefer decoded content if present; else fallback to raw fileContent
          let raw = storedFile.content !== undefined ? storedFile.content : storedFile.fileContent;
          
          // For .act files, preserve binary data (ArrayBuffer or base64)
          const isACTFile = this.path && this.path.toLowerCase().endsWith('.act');
          
          if (!isACTFile) {
            // For non-.act files, convert binary to text as before
            if (storedFile.binaryData && typeof raw === 'string') {
              try {
                const bin = atob(raw);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                raw = new TextDecoder().decode(bytes);
                console.log(`[PaletteEditor] Decoded base64 to text for ${storagePath}`);
              } catch (e) {
                console.warn('[PaletteEditor] Failed to base64-decode stored content; leaving as string');
              }
            } else if (raw instanceof ArrayBuffer) {
              try {
                raw = new TextDecoder().decode(new Uint8Array(raw));
                console.log(`[PaletteEditor] Converted ArrayBuffer to text for ${storagePath}`);
              } catch (e) {
                console.warn('[PaletteEditor] Failed to decode ArrayBuffer to text');
              }
            }
          } else {
            // For .act files, keep binary data as-is (ArrayBuffer) or convert base64 string to ArrayBuffer
            if (storedFile.binaryData && typeof raw === 'string') {
              try {
                const binaryString = atob(raw);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                raw = bytes.buffer; // Store as ArrayBuffer
                console.log(`[PaletteEditor] Converted base64 to ArrayBuffer for .act file: ${bytes.length} bytes`);
              } catch (e) {
                console.warn('[PaletteEditor] Failed to decode base64 for .act file:', e);
              }
            }
            // If raw is already ArrayBuffer, leave it as-is
            console.log(`[PaletteEditor] Preserved binary data for .act file: ${raw instanceof ArrayBuffer ? 'ArrayBuffer' : typeof raw}`);
          }
          
          if (typeof raw === 'string') {
            console.log(`[PaletteEditor] Loaded content from persistent storage: ${storagePath} (${raw.length} chars)`);
          }
          content = raw;
          
          // Preserve binary flag for .act files
          if (isACTFile && storedFile.binaryData) {
            this.file = { ...this.file, content, binaryData: true };
            console.log(`[PaletteEditor] Preserved binary flag for .act file`);
            return;
          }
        } else {
          console.log(`[PaletteEditor] No content found in persistent storage for: ${storagePath}`);
        }
      } else {
        console.log(`[PaletteEditor] No fileIOService or path available for persistent storage`);
      }
      
      // If we got content from storage, update the file object
      if (content) {
        this.file = { ...this.file, content };
        console.log(`[PaletteEditor] Updated file object with loaded content`);
      } else {
        console.log(`[PaletteEditor] No content loaded, using empty content`);
        this.file = { ...this.file, content: '' };
      }
      
    } catch (error) {
      console.error(`[PaletteEditor] Failed to load file content:`, error);
      this.file = { ...this.file, content: '' };
    }
  }

  parseGIMPPalette() {
    // Parse GIMP .pal format
    let content = this.file.content || '';
    
    // Handle different content types
    if (typeof content !== 'string') {
      if (content instanceof ArrayBuffer) {
        content = new TextDecoder().decode(content);
        console.log(`[PaletteEditor] Converted ArrayBuffer to text (${content.length} chars)`);
      } else {
        console.warn(`[PaletteEditor] Unexpected content type: ${typeof content}`, content);
        content = '';
      }
    }
    // Guard: some saved data might be base64 text; detect header and attempt decode
    if (content && !content.startsWith('GIMP') && /^[A-Za-z0-9+/=\r\n]+$/.test(content.substring(0, 120))) {
      try {
        const bin = atob(content.replace(/\s+/g, ''));
        const decoded = new TextDecoder().decode(new Uint8Array([...bin].map(c => c.charCodeAt(0))));
        if (decoded.startsWith('GIMP')) {
          content = decoded;
          console.log('[PaletteEditor] Detected base64-like string; decoded to GIMP text');
        }
      } catch (_) { /* ignore */ }
    }
    
    console.log(`[PaletteEditor] parseGIMPPalette - content length: ${content.length}`);
    
    if (!content) {
      console.log(`[PaletteEditor] No content to parse, using default palette`);
      this.createDefaultPalette();
      return;
    }
    
    const lines = content.split('\n');
    this.colors = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('GIMP')) {
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 3) {
          const r = parseInt(parts[0]);
          const g = parseInt(parts[1]);
          const b = parseInt(parts[2]);
          
          if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
            this.colors.push(this.rgbToHex(r, g, b));
          }
        }
      }
    }
    
  }

  parseACTPalette() {
    // Parse Adobe Color Table format (binary)
    console.log('[PaletteEditor] Parsing .act palette file');
    
    try {
      if (!this.file.content) {
        throw new Error('No file content available');
      }

      let binaryData;
      
      // Handle different content formats
      if (this.file.content instanceof ArrayBuffer) {
        binaryData = new Uint8Array(this.file.content);
        console.log(`[PaletteEditor] Using ArrayBuffer content (${binaryData.length} bytes)`);
      } else if (this.file.content instanceof Uint8Array) {
        binaryData = this.file.content;
        console.log(`[PaletteEditor] Using Uint8Array content (${binaryData.length} bytes)`);
      } else if (typeof this.file.content === 'string') {
        // Try to decode as base64
        if (this.file.content.match(/^[A-Za-z0-9+/=\s]+$/)) {
          const base64 = this.file.content.replace(/\s+/g, ''); // Remove whitespace
          console.log(`[PaletteEditor] Decoding base64 content (${base64.length} chars)`);
          const binaryString = atob(base64);
          binaryData = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            binaryData[i] = binaryString.charCodeAt(i);
          }
        } else {
          throw new Error('String content does not appear to be valid base64');
        }
      } else {
        throw new Error('ACT files must be binary data - unsupported content type: ' + typeof this.file.content);
      }

      console.log(`[PaletteEditor] ACT file size: ${binaryData.length} bytes`);

      // Determine number of colors based on file size
      let maxColors;
      if (binaryData.length === 768) {
        // Standard 768-byte file = 256 colors, no metadata
        maxColors = 256;
      } else if (binaryData.length === 772) {
        // 772-byte file = 256 colors + 4 bytes metadata
        maxColors = 256;
      } else if (binaryData.length >= 3) {
        // For other sizes, calculate colors but limit to RGB data only
        const rgbDataSize = binaryData.length >= 772 ? 768 : binaryData.length;
        maxColors = Math.floor(rgbDataSize / 3);
      } else {
        throw new Error(`Invalid .act file size: ${binaryData.length} bytes (too small)`);
      }

      console.log(`[PaletteEditor] Reading up to ${maxColors} colors from RGB data`);

      this.colors = [];
      
      // Read RGB triplets based on calculated number of colors
      for (let i = 0; i < maxColors; i++) {
        const offset = i * 3;
        
        // Make sure we don't read beyond the RGB data (bytes 0-767)
        if (offset + 2 >= 768) {
          break;
        }
        
        const r = binaryData[offset];
        const g = binaryData[offset + 1];
        const b = binaryData[offset + 2];
        
        // Convert to hex format (consistent with other palette formats)
        const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        this.colors.push(hex.toUpperCase());
      }

      // Check metadata if present, but use it for information only
      let actualColorCount = this.colors.length;
      if (binaryData.length >= 772) {
        // Bytes 768-769: Number of colors (big-endian 16-bit)
        const metadataColors = (binaryData[768] << 8) | binaryData[769];
        // Bytes 770-771: Transparency index (big-endian 16-bit)  
        const transparencyIndex = (binaryData[770] << 8) | binaryData[771];
        
        console.log(`[PaletteEditor] ACT metadata - colors: ${metadataColors}, transparency: ${transparencyIndex}`);
        
        // Option: respect metadata if it indicates fewer colors than we read
        // This helps with palettes that only use a subset of the 256 slots
        if (metadataColors > 0 && metadataColors < this.colors.length) {
          console.log(`[PaletteEditor] Metadata indicates ${metadataColors} colors, but showing all ${this.colors.length} for editing`);
          // We could optionally limit here: this.colors = this.colors.slice(0, metadataColors);
        }
      }

      console.log(`[PaletteEditor] parseACTPalette - parsed ${this.colors.length} colors`);
      this.paletteSize = this.colors.length;

    } catch (error) {
      console.error('[PaletteEditor] Error parsing .act file:', error);
      // Fall back to default palette
      this.createDefaultPalette();
    }
  }

  parseACOPalette() {
    // Parse Adobe Color format (binary)
    // For now, create a placeholder implementation
    this.createDefaultPalette();
  }

  parseGenericPalette() {
    // Try to parse as simple hex color list
    const content = this.file.content || '';
    const hexPattern = /#([0-9A-Fa-f]{6})/g;
    const matches = content.match(hexPattern);
    
    if (matches && matches.length > 0) {
      this.colors = matches;
      this.paletteSize = this.colors.length;
    } else {
      this.createDefaultPalette();
    }
  }

  renderPaletteGrid() {
    console.log(`[PaletteEditor] renderPaletteGrid - colors: ${this.colors.length}, paletteSize: ${this.paletteSize}`);
    
    this.paletteGrid.innerHTML = '';
    
    const gridSize = this.calculateGridSize();
    this.paletteGrid.style.gridTemplateColumns = `repeat(${gridSize.cols}, 1fr)`;
    
    for (let i = 0; i < this.paletteSize; i++) {
      const colorCell = document.createElement('div');
      colorCell.className = 'color-cell';
      colorCell.style.backgroundColor = this.colors[i] || '#000000';
      colorCell.dataset.index = i;
      
      if (i === this.selectedColorIndex) {
        colorCell.classList.add('selected');
      }
      
      colorCell.addEventListener('click', () => {
        this.selectColor(i);
      });
      
      // Add color index label
      const label = document.createElement('span');
      label.className = 'color-index';
      label.textContent = i;
      colorCell.appendChild(label);
      
      this.paletteGrid.appendChild(colorCell);
    }
  }

  calculateGridSize() {
    switch (this.paletteSize) {
      case 4: return { cols: 4, rows: 1 };  // Single row
      case 16: return { cols: 16, rows: 1 }; // Single row
      case 256: return { cols: 16, rows: 16 };
      default: 
        const cols = Math.ceil(Math.sqrt(this.paletteSize));
        const rows = Math.ceil(this.paletteSize / cols);
        return { cols, rows };
    }
  }

  selectColor(index) {
    this.selectedColorIndex = index;
    
    // Update grid selection
    this.paletteGrid.querySelectorAll('.color-cell').forEach((cell, i) => {
      cell.classList.toggle('selected', i === index);
    });
    
    this.updateColorEditor();
  }

  updateColorEditor() {
    const color = this.colors[this.selectedColorIndex] || '#000000';
    const rgb = this.hexToRgb(color);
    const hsl = this.rgbToHsl(rgb.r, rgb.g, rgb.b);
    
    // Update preview
    if (this.selectedColorPreview) {
      this.selectedColorPreview.style.backgroundColor = color;
    }
    
    // Update inputs with null checks
    if (this.hexInput) this.hexInput.value = color;
    if (this.colorPicker) this.colorPicker.value = color;
    
    if (this.rgbInputs?.r) this.rgbInputs.r.value = rgb.r;
    if (this.rgbInputs?.g) this.rgbInputs.g.value = rgb.g;
    if (this.rgbInputs?.b) this.rgbInputs.b.value = rgb.b;
    
    if (this.hslInputs?.h) this.hslInputs.h.value = Math.round(hsl.h);
    if (this.hslInputs?.s) this.hslInputs.s.value = Math.round(hsl.s);
    if (this.hslInputs?.l) this.hslInputs.l.value = Math.round(hsl.l);
    
    // Update RGB sliders
    if (this.rgbSliders?.r) this.rgbSliders.r.value = rgb.r;
    if (this.rgbSliders?.g) this.rgbSliders.g.value = rgb.g;
    if (this.rgbSliders?.b) this.rgbSliders.b.value = rgb.b;
    
    // Update HSL sliders
    if (this.hslSliders?.h) this.hslSliders.h.value = Math.round(hsl.h);
    if (this.hslSliders?.s) this.hslSliders.s.value = Math.round(hsl.s);
    if (this.hslSliders?.l) this.hslSliders.l.value = Math.round(hsl.l);
    
    // Update color wheel cursor
    this.updateColorWheelCursor(hsl.h, hsl.s);
    
    // Update lightness bar cursor
    this.updateLightnessBarCursor(hsl.l);
  }

  updateFromHex() {
    if (this.hexInput) {
      const hex = this.hexInput.value;
      if (this.isValidHex(hex)) {
        this.setSelectedColor(hex);
      }
    }
  }

  updateFromRGB() {
    const r = parseInt(this.rgbInputs?.r?.value) || 0;
    const g = parseInt(this.rgbInputs?.g?.value) || 0;
    const b = parseInt(this.rgbInputs?.b?.value) || 0;
    
    // Update sliders
    if (this.rgbSliders?.r) this.rgbSliders.r.value = r;
    if (this.rgbSliders?.g) this.rgbSliders.g.value = g;
    if (this.rgbSliders?.b) this.rgbSliders.b.value = b;
    
    const hex = this.rgbToHex(r, g, b);
    this.setSelectedColor(hex);
  }
  
  updateFromRGBSliders() {
    const r = parseInt(this.rgbSliders?.r?.value) || 0;
    const g = parseInt(this.rgbSliders?.g?.value) || 0;
    const b = parseInt(this.rgbSliders?.b?.value) || 0;
    
    // Update inputs
    if (this.rgbInputs?.r) this.rgbInputs.r.value = r;
    if (this.rgbInputs?.g) this.rgbInputs.g.value = g;
    if (this.rgbInputs?.b) this.rgbInputs.b.value = b;
    
    const hex = this.rgbToHex(r, g, b);
    this.setSelectedColor(hex);
  }

  updateFromHSL() {
    const h = parseInt(this.hslInputs?.h?.value) || 0;
    const s = parseInt(this.hslInputs?.s?.value) || 0;
    const l = parseInt(this.hslInputs?.l?.value) || 0;
    
    // Update sliders
    if (this.hslSliders?.h) this.hslSliders.h.value = h;
    if (this.hslSliders?.s) this.hslSliders.s.value = s;
    if (this.hslSliders?.l) this.hslSliders.l.value = l;
    
    const rgb = this.hslToRgb(h, s / 100, l / 100);
    const hex = this.rgbToHex(rgb.r, rgb.g, rgb.b);
    this.setSelectedColor(hex);
    
    // Redraw lightness bar when hue or saturation changes
    this.drawLightnessBar();
  }
  
  updateFromHSLSliders() {
    const h = parseInt(this.hslSliders?.h?.value) || 0;
    const s = parseInt(this.hslSliders?.s?.value) || 0;
    const l = parseInt(this.hslSliders?.l?.value) || 0;
    
    // Update inputs
    if (this.hslInputs?.h) this.hslInputs.h.value = h;
    if (this.hslInputs?.s) this.hslInputs.s.value = s;
    if (this.hslInputs?.l) this.hslInputs.l.value = l;
    
    const rgb = this.hslToRgb(h, s / 100, l / 100);
    const hex = this.rgbToHex(rgb.r, rgb.g, rgb.b);
    this.setSelectedColor(hex);
    
    // Redraw lightness bar when hue or saturation changes
    this.drawLightnessBar();
  }

  setSelectedColor(hex) {
    if (this.palette) {
      this.palette.setColor(this.selectedColorIndex, hex);
      this.renderPaletteGrid();
      this.updateColorEditor();
      this.markDirty();
    }
  }

  randomizePalette() {
    if (this.palette) {
      this.palette.randomize();
      this.renderPaletteGrid();
      this.updateColorEditor();
      this.markDirty();
    }
  }

  sortPalette() {
    if (this.palette) {
      // For now, sort by hue - could be extended to offer multiple sort options
      this.palette.sortByHue();
      this.renderPaletteGrid();
      this.updateColorEditor();
      this.markDirty();
      console.log('[PaletteEditor] Sorted palette by hue');
    }
  }

  openImageSteal() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true; // Allow multiple image selection
    input.onchange = async (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) {
        if (files.length === 1) {
          // Single image - use existing workflow
          this.stealColorsFromImage(files[0]);
        } else {
          // Multiple images - combine them first
          this.stealColorsFromMultipleImages(files);
        }
      }
    };
    input.click();
  }

  async stealColorsFromImage(imageFile) {
    try {
      // Show algorithm selection popup
      const selectedAlgorithm = await this.showAlgorithmSelection();
      if (!selectedAlgorithm) {
        return; // User cancelled
      }

      console.log('PaletteEditor: Stealing colors from image:', imageFile.name);
      
      // Create ImageData instance and load the image
      const imageData = new ImageData();
      
      // Convert file to array buffer for loading
      const arrayBuffer = await imageFile.arrayBuffer();
      await imageData.loadFromContent(arrayBuffer, imageFile.name);
      
      if (imageData.getFrameCount() === 0) {
        throw new Error('No frames loaded from image');
      }
      
      console.log('PaletteEditor: Image loaded, reducing to 256 colors...');
      
      // Reduce the image to 256 colors (maximum palette size) with progress
      const reductionResult = await imageData.reduceColors(0, 256, {
        container: document.body, // Use document.body for modal-style progress
        algorithm: selectedAlgorithm
      });
      
      if (!reductionResult || !reductionResult.palette) {
        throw new Error('Failed to reduce image colors');
      }
      
      console.log(`PaletteEditor: Reduced from ${reductionResult.originalColors} to ${reductionResult.reducedColors} colors`);
      
      // Update the palette with the reduced colors
      this.palette.setColors(reductionResult.palette);
      this.palette.name = `Stolen from ${imageFile.name}`;
      
      // Update the UI
      this.renderPaletteGrid();
      this.updateColorEditor();
      this.markDirty();
      
      // Show success message
      console.log('PaletteEditor: Successfully stole colors from image');
      
    } catch (error) {
      console.error('Failed to steal colors from image:', error);
      alert(`Failed to extract colors from image: ${error.message}`);
    }
  }

  async stealColorsFromMultipleImages(imageFiles) {
    try {
      // Show algorithm selection popup
      const selectedAlgorithm = await this.showAlgorithmSelection();
      if (!selectedAlgorithm) {
        return; // User cancelled
      }

      console.log('PaletteEditor: Stealing colors from multiple images:', imageFiles.map(f => f.name));
      
      // Load all images
      const loadedImages = [];
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        console.log(`Loading image ${i + 1}/${imageFiles.length}: ${file.name}`);
        
        const imageData = new ImageData();
        const arrayBuffer = await file.arrayBuffer();
        await imageData.loadFromContent(arrayBuffer, file.name);
        
        if (imageData.getFrameCount() > 0) {
          loadedImages.push(imageData);
        } else {
          console.warn(`No frames loaded from ${file.name}`);
        }
      }
      
      if (loadedImages.length === 0) {
        throw new Error('No valid images loaded');
      }
      
      console.log(`PaletteEditor: Loaded ${loadedImages.length} images, combining...`);
      
      // Combine all images into one
      const combinedImage = ImageData.combine(
        loadedImages, 
        `Combined (${imageFiles.map(f => f.name).join(', ')})`
      );
      
      if (combinedImage.getFrameCount() === 0) {
        throw new Error('No frames in combined image');
      }
      
      console.log(`PaletteEditor: Combined image has ${combinedImage.getFrameCount()} frames, reducing to 256 colors...`);
      
      // Reduce colors across all frames
      const reductionResult = await combinedImage.reduceColors(null, 256, {
        container: document.body,
        algorithm: selectedAlgorithm,
        allFrames: true // Process all frames together
      });
      
      if (!reductionResult || !reductionResult.palette) {
        throw new Error('Failed to reduce combined image colors');
      }
      
      console.log(`PaletteEditor: Reduced from ${reductionResult.originalColors} to ${reductionResult.reducedColors} colors across ${reductionResult.frameCount} frames`);
      
      // Update the palette with the reduced colors
      this.palette.setColors(reductionResult.palette);
      this.palette.name = `Stolen from ${imageFiles.length} images`;
      
      // Update the UI
      this.renderPaletteGrid();
      this.updateColorEditor();
      this.markDirty();
      
      // Show success message
      console.log('PaletteEditor: Successfully stole colors from multiple images');
      
    } catch (error) {
      console.error('Failed to steal colors from multiple images:', error);
      alert(`Failed to extract colors from images: ${error.message}`);
    }
  }

  async showAlgorithmSelection() {
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
        'Select Color Reduction Algorithm',
        'Choose the algorithm to use for reducing the image to 256 colors:',
        algorithmOptions,
        {
          defaultValue: 'auto',
          confirmText: 'Proceed',
          cancelText: 'Cancel'
        }
      );

      return selectedAlgorithm;
    } catch (error) {
      console.error('[PaletteEditor] Error in algorithm selection modal:', error);
      return null;
    }
  }

  exportPalette() {
    // Use the abstracted Palette class for proper ACT export
    const actData = this.palette.exportToACT();
    const blob = new Blob([actData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.file?.name || 'palette'}.act`;
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('PaletteEditor: Exported palette as ACT file');
  }

  updateFromColorPicker() {
    if (this.selectedIndex >= 0) {
      const color = this.colorPicker.value;
      this.colors[this.selectedIndex] = color;
      this.updateColorEditor(color);
      this.generatePaletteGrid();
      this.markDirty();
    }
  }

  exportToGIMP() {
    let content = 'GIMP Palette\n';
    content += '#\n';
    
    for (let i = 0; i < this.colors.length; i++) {
      const rgb = this.hexToRgb(this.colors[i]);
      content += `${rgb.r.toString().padStart(3)} ${rgb.g.toString().padStart(3)} ${rgb.b.toString().padStart(3)} Color ${i}\n`;
    }
    
    return content;
  }

  exportToHex() {
    return this.colors.join('\n');
  }

  exportToCSS() {
    let content = ':root {\n';
    for (let i = 0; i < this.colors.length; i++) {
      content += `  --color-${i}: ${this.colors[i]};\n`;
    }
    content += '}';
    return content;
  }

  // Color utility functions
  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }

  rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  hexToHsl(hex) {
    const rgb = this.hexToRgb(hex);
    return this.rgbToHsl(rgb.r, rgb.g, rgb.b);
  }

  hslToRgb(h, s, l) {
    h /= 360;
    
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    let r, g, b;
    
    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    
    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    };
  }

  isValidHex(hex) {
    return /^#[0-9A-Fa-f]{6}$/.test(hex);
  }

  // EditorBase interface implementation
  getDisplayName() {
    return this.path ? this.path.split('/').pop() : 'New Palette';
  }

  getFileExtension(filePath = null) {
    // Determine extension from the actual file path/name
    const pathToCheck = filePath || this.path || this.file?.name || this.file?.filename || 'untitled.pal';
    
    if (pathToCheck.includes('.')) {
      const extension = '.' + pathToCheck.split('.').pop().toLowerCase();
      
      // Validate that it's a supported extension
      const supportedExts = ['.pal', '.act', '.aco'];
      if (supportedExts.includes(extension)) {
        return extension;
      }
    }
    
    // Default fallback
    return '.pal';
  }

  getElement() {
    // Ensure EditorBase-visible root matches the container
    if (this.element !== this.container) {
      this.element = this.container;
      this.element.classList.add('viewer-content', 'editor-content');
    }
    return this.element;
  }

  getContent() {
    return this.exportToGIMP();
  }

  setContent(content) {
    this.file = { content };
    this.loadPalette();
  }

  // Static methods for creation support
  static getCreateIcon() {
    return '🎨';
  }

  static getCreateLabel() {
    return 'Palette';
  }

  static getDefaultFolder() {
    return (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? 
      `${window.ProjectPaths.getSourcesRootUi()}/Palettes` : 'Resources/Palettes';
  }

  static createNew() {
    // Use the abstracted Palette class to create default content
    // Return ACT format for embedded systems compatibility
    const palette = Palette.createDefault(256);
    return palette.exportToACT();
  }
  
  // Helper method for HSL to RGB conversion (static version)
  static hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    
    if (0 <= h && h < 60) {
      r = c; g = x; b = 0;
    } else if (60 <= h && h < 120) {
      r = x; g = c; b = 0;
    } else if (120 <= h && h < 180) {
      r = 0; g = c; b = x;
    } else if (180 <= h && h < 240) {
      r = 0; g = x; b = c;
    } else if (240 <= h && h < 300) {
      r = x; g = 0; b = c;
    } else if (300 <= h && h < 360) {
      r = c; g = 0; b = x;
    }
    
    return {
      r: (r + m) * 255,
      g: (g + m) * 255,
      b: (b + m) * 255
    };
  }
  
  // Utility method to convert HSL to Hex
  hslToHex(h, s, l) {
    h = h / 360;
    s = s / 100;
    l = l / 100;
    
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    let r, g, b;
    
    if (s === 0) {
      r = g = b = l; // achromatic
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    
    const toHex = (c) => {
      const hex = Math.round(c * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  // Override save method to handle palette saving
  async save() {
    console.log('[PaletteEditor] save() method called!');
    console.log(`[PaletteEditor] save() called - isNewResource: ${this.isNewResource}, file: ${this.file}, path: ${this.path}`);
    
    if (this.isNewResource) {
      console.log('[PaletteEditor] New file detected, prompting for filename');
      // For new files, prompt for filename and save as new
      await this.saveAsNewFile();
    } else {
      console.log('[PaletteEditor] Existing file, saving directly');
      // For existing files, save normally
      await this.saveExistingFile();
    }
  }
  
  async saveAsNewFile() {
    console.log(`[PaletteEditor] saveAsNewFile() called`);
    
    // Get palette data
    const paletteData = this.getPaletteData();
    
    try {
      // Use the standardized save dialog from EditorBase
      await this.saveNewResource(paletteData);
      
      console.log(`[PaletteEditor] Successfully saved new palette`);
      
    } catch (error) {
      console.error(`[PaletteEditor] Error saving palette:`, error);
      throw error;
    }
  }

  async saveExistingFile() {
    try {
      const paletteData = this.getPaletteData();
      
      // Use the base class method
      await this.saveExistingResource(paletteData);
      
      console.log(`[PaletteEditor] Successfully saved existing palette: ${this.path}`);
    } catch (error) {
      console.error('[PaletteEditor] Error saving existing palette:', error);
      throw error;
    }
  }

  getPaletteData() {
    // Use the abstracted Palette class for saving
    // We always save to ACT format for embedded systems compatibility
    if (!this.palette) {
      console.error('[PaletteEditor] No palette data available for saving');
      return new Uint8Array(772).buffer; // Return empty ACT file
    }
    
    return this.palette.exportToACT();
  }

  // Removed old export methods - now using abstracted Palette class
  // All saving is done through this.palette.exportToACT()
}

// Export for use
window.PaletteEditor = PaletteEditor;

// Static metadata for auto-registration
PaletteEditor.getFileExtensions = () => ['.pal', '.act', '.aco'];
PaletteEditor.getFileExtension = () => '.act'; // Changed default to ACT for embedded systems
PaletteEditor.getDisplayName = () => 'Palette Editor';
PaletteEditor.getIcon = () => '🎨';
PaletteEditor.getPriority = () => 10;
PaletteEditor.getCapabilities = () => ['color-editing', 'import-export'];
PaletteEditor.canCreate = true;

// Register the component
PaletteEditor.registerComponent();
