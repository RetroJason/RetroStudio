// palette-editor.js
// Advanced palette editor for .pal files

class PaletteEditor extends EditorBase {
  constructor(file, path, isNewResource = false, options = {}) {
    super(file, path, isNewResource);
    this.options = options;
    
    // Palette data
    this.colors = [];
    this.paletteSize = 256; // Fixed at 256 colors
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

  loadPalette() {
    console.log(`[PaletteEditor] loadPalette - isNewResource: ${this.isNewResource}`);
    console.log(`[PaletteEditor] loadPalette - file:`, this.file);
    
    if (this.isNewResource) {
      // For new resources, use the default content from createNew()
      console.log(`[PaletteEditor] Loading new resource with default content`);
      const defaultContent = this.constructor.createNew();
      this.file = { ...this.file, content: defaultContent };
      this.parsePaletteFile();
    } else {
      this.loadFileContent().then(() => {
        this.parsePaletteFile();
        this.renderPaletteGrid();
        this.updateColorEditor();
      }).catch(error => {
        console.error('[PaletteEditor] Failed to load file content:', error);
        this.createDefaultPalette();
        this.renderPaletteGrid();
        this.updateColorEditor();
      });
      return; // Early return to avoid calling render methods twice
    }
    this.renderPaletteGrid();
    this.updateColorEditor();
  }

  createDefaultPalette() {
    // Create a default 256-color palette with a nice gradient
    this.colors = [];
    this.paletteSize = 256;
    
    // Generate a 256-color palette
    for (let i = 0; i < 256; i++) {
      const hue = (i / 256) * 360;
      const saturation = 70 + (i % 4) * 10; // Vary saturation slightly
      const lightness = 40 + (i % 8) * 7; // Vary lightness
      this.colors.push(this.hslToHex(hue, saturation, lightness));
    }
  }

  parsePaletteFile() {
    try {
      if (this.file) {
        // Parse different palette formats
        const extension = this.getFileExtension().toLowerCase();
        
        switch (extension) {
          case '.pal':
            this.parseGIMPPalette();
            break;
          case '.act':
            this.parseACTPalette();
            break;
          case '.aco':
            this.parseACOPalette();
            break;
          default:
            this.parseGenericPalette();
        }
      }
    } catch (error) {
      console.error('Failed to parse palette:', error);
      this.createDefaultPalette();
    }
  }

  async refreshContent() {
    console.log(`[PaletteEditor] Refreshing content for: ${this.path}`);
    try {
      // Reload the file content from storage
      await this.loadFileContent();
      console.log(`[PaletteEditor] Successfully refreshed content for: ${this.path}`);
    } catch (error) {
      console.error(`[PaletteEditor] Failed to refresh content for ${this.path}:`, error);
    }
  }

  async loadFileContent() {
    console.log(`[PaletteEditor] loadFileContent() - Path: ${this.path}, File: ${this.file?.name}`);
    
    try {
      let content = null;
      
      // First try to load from persistent storage if we have a path
      if (window.fileIOService && this.path) {
        // Fix path case for build files: Build/... -> build/...
        let storagePath = this.path;
        if (this.path.startsWith('Build/')) {
          storagePath = this.path.replace('Build/', 'build/');
          console.log(`[PaletteEditor] Converted build path: ${this.path} -> ${storagePath}`);
        }
        
        console.log(`[PaletteEditor] Attempting to load from persistent storage: ${storagePath}`);
        const storedFile = await window.fileIOService.loadFile(storagePath);
        if (storedFile) {
          // Prefer decoded content if present; else fallback to raw fileContent
          let raw = storedFile.content !== undefined ? storedFile.content : storedFile.fileContent;
          // If binaryData flagged but content is a string (base64), decode to text
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
          if (typeof raw === 'string') {
            console.log(`[PaletteEditor] Loaded content from persistent storage: ${storagePath} (${raw.length} chars)`);
          }
          content = raw;
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
    
    console.log(`[PaletteEditor] parseGIMPPalette - parsed ${this.colors.length} colors`);
    this.paletteSize = this.colors.length;
  }

  parseACTPalette() {
    // Parse Adobe Color Table format (binary)
    // For now, create a placeholder implementation
    this.createDefaultPalette();
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
    this.colors[this.selectedColorIndex] = hex;
    this.renderPaletteGrid();
    this.updateColorEditor();
    this.markDirty();
  }

  randomizePalette() {
    for (let i = 0; i < this.paletteSize; i++) {
      const r = Math.floor(Math.random() * 256);
      const g = Math.floor(Math.random() * 256);
      const b = Math.floor(Math.random() * 256);
      this.colors[i] = this.rgbToHex(r, g, b);
    }
    
    this.renderPaletteGrid();
    this.updateColorEditor();
    this.markDirty();
  }

  sortPalette() {
    // Sort colors by hue, then saturation, then lightness
    const sortedColors = [...this.colors].sort((a, b) => {
      const hslA = this.hexToHsl(a);
      const hslB = this.hexToHsl(b);
      
      // First by hue
      if (Math.abs(hslA.h - hslB.h) > 1) {
        return hslA.h - hslB.h;
      }
      
      // Then by saturation
      if (Math.abs(hslA.s - hslB.s) > 1) {
        return hslB.s - hslA.s; // Higher saturation first
      }
      
      // Finally by lightness
      return hslA.l - hslB.l;
    });
    
    this.colors = sortedColors;
    this.renderPaletteGrid();
    this.updateColorEditor();
    this.markDirty();
  }

  openImageSteal() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        this.stealColorsFromImage(file);
      }
    };
    input.click();
  }

  async stealColorsFromImage(imageFile) {
    try {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      img.onload = () => {
        // Resize image for processing (max 200x200 for performance)
        const maxSize = 200;
        let { width, height } = img;
        
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width *= ratio;
          height *= ratio;
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        
        // Extract colors using median cut algorithm
        const imageData = ctx.getImageData(0, 0, width, height);
        const extractedColors = this.extractColorsFromImageData(imageData, this.paletteSize);
        
        this.colors = extractedColors;
        this.renderPaletteGrid();
        this.updateColorEditor();
        this.markDirty();
      };
      
      img.src = URL.createObjectURL(imageFile);
    } catch (error) {
      console.error('Failed to steal colors from image:', error);
      alert('Failed to extract colors from image');
    }
  }

  extractColorsFromImageData(imageData, targetColors) {
    // Simple color quantization using median cut algorithm
    const pixels = [];
    
    // Sample pixels (every 4th pixel for performance)
    for (let i = 0; i < imageData.data.length; i += 16) {
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];
      const a = imageData.data[i + 3];
      
      if (a > 128) { // Skip transparent pixels
        pixels.push([r, g, b]);
      }
    }
    
    // Use median cut to find representative colors
    const colors = this.medianCut(pixels, targetColors);
    return colors.map(color => this.rgbToHex(color[0], color[1], color[2]));
  }

  medianCut(pixels, targetColors) {
    if (pixels.length === 0) return [];
    if (targetColors === 1) {
      // Return average color
      const avg = [0, 0, 0];
      for (const pixel of pixels) {
        avg[0] += pixel[0];
        avg[1] += pixel[1];
        avg[2] += pixel[2];
      }
      avg[0] = Math.round(avg[0] / pixels.length);
      avg[1] = Math.round(avg[1] / pixels.length);
      avg[2] = Math.round(avg[2] / pixels.length);
      return [avg];
    }
    
    // Find the channel with the largest range
    const ranges = [0, 1, 2].map(channel => {
      const values = pixels.map(p => p[channel]);
      return Math.max(...values) - Math.min(...values);
    });
    
    const splitChannel = ranges.indexOf(Math.max(...ranges));
    
    // Sort by the channel with largest range
    pixels.sort((a, b) => a[splitChannel] - b[splitChannel]);
    
    // Split in half
    const mid = Math.floor(pixels.length / 2);
    const left = pixels.slice(0, mid);
    const right = pixels.slice(mid);
    
    // Recursively split
    const leftColors = Math.floor(targetColors / 2);
    const rightColors = targetColors - leftColors;
    
    return [
      ...this.medianCut(left, leftColors),
      ...this.medianCut(right, rightColors)
    ];
  }

  exportPalette() {
    const content = this.exportToGIMP();
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.file?.name || 'palette'}.pal`;
    a.click();
    URL.revokeObjectURL(url);
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

  getFileExtension() {
    return '.pal';
  }

  getElement() {
    return this.container;
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
    return 'Resources/Palettes';
  }

  static createNew() {
    // Return default 256-color palette content in GIMP format
    let paletteContent = `GIMP Palette
#
# 256-Color Default Palette
#
`;
    
    // Generate a nice 256-color palette
    for (let i = 0; i < 256; i++) {
      const hue = (i / 256) * 360;
      const saturation = 70 + (i % 4) * 10; // Vary saturation slightly
      const lightness = 40 + (i % 8) * 7; // Vary lightness
      
      const rgb = PaletteEditor.hslToRgb(hue, saturation, lightness);
      const r = Math.round(rgb.r).toString().padStart(3, ' ');
      const g = Math.round(rgb.g).toString().padStart(3, ' ');
      const b = Math.round(rgb.b).toString().padStart(3, ' ');
      
      paletteContent += `${r} ${g} ${b} Color${i}\n`;
    }
    
    return paletteContent;
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
}

// Export for use
window.PaletteEditor = PaletteEditor;
