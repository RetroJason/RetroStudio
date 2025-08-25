/**
 * D2 Image Viewer
 * 
 * A simple viewer for D2 texture format files.
 * Uses the ImageData class to load and display D2 textures.
 */

class D2ImageViewer extends ViewerBase {
  constructor(path) {
    super(path);  // Pass path to ViewerBase like HexViewer does
    this.className = 'D2ImageViewer';
    this.supportedExtensions = ['.d2'];
    this.file = null;
    this.imageData = null;
    this.canvas = null;
    this.ctx = null;
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    console.log('[D2ImageViewer] Constructor completed for path:', path);
  }

  createBody(bodyContainer) {
    console.log('[D2ImageViewer] createBody() called with container:', bodyContainer);
    
    // Store reference to the body container
    this.container = bodyContainer;
    
    // Set up the container styling
    bodyContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-primary, #2d2d2d);
      color: var(--text-primary, #ffffff);
    `;

    // Create toolbar
    this.createToolbar();

    // Create canvas container
    const canvasContainer = document.createElement('div');
    canvasContainer.style.cssText = `
      flex: 1;
      overflow: hidden;
      position: relative;
      background: linear-gradient(45deg, #ccc 25%, transparent 25%), 
                  linear-gradient(-45deg, #ccc 25%, transparent 25%), 
                  linear-gradient(45deg, transparent 75%, #ccc 75%), 
                  linear-gradient(-45deg, transparent 75%, #ccc 75%);
      background-size: 20px 20px;
      background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
      background-color: #f0f0f0;
    `;

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      border: 1px solid var(--border-color, #555);
      cursor: grab;
      image-rendering: pixelated;
      image-rendering: -moz-crisp-edges;
      image-rendering: crisp-edges;
    `;
    
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;

    canvasContainer.appendChild(this.canvas);
    bodyContainer.appendChild(canvasContainer);

    // Setup canvas interactions
    this.setupCanvasInteractions();

    // Create info panel
    this.createInfoPanel();

    // Load the D2 file - either from preloaded data or by loading from path
    this.loadFileData();
  }

  async loadFileData() {
    try {
      if (!this.path) {
        throw new Error('No path available for loading D2 file');
      }

      console.log('[D2ImageViewer] Loading file data from path:', this.path);
      
      let fileManager = null;
      try { 
        fileManager = window.serviceContainer?.get('fileManager'); 
      } catch (_) { /* not registered yet */ }
      fileManager = fileManager || window.FileManager || window.fileManager;
      
      if (!fileManager || typeof fileManager.loadFile !== 'function') {
        throw new Error('FileManager not available');
      }

      // Normalize to storage path for loading
      const storagePath = window.ProjectPaths?.normalizeStoragePath ? 
        window.ProjectPaths.normalizeStoragePath(this.path) : this.path;
      
      this.file = await fileManager.loadFile(storagePath);
      if (!this.file) {
        throw new Error(`File not found: ${this.path}`);
      }
      
      console.log('[D2ImageViewer] File data loaded from storage, size:', this.file.size || 'unknown');
      this.loadD2File();
    } catch (error) {
      console.error('[D2ImageViewer] Error loading file data:', error);
      this.showError(`Error loading file: ${error.message}`);
      this.updateInfoPanel();
    }
  }

  createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px;
      background: var(--bg-secondary, #3d3d3d);
      border-bottom: 1px solid var(--border-color, #555);
    `;

    // Zoom controls
    const zoomOut = document.createElement('button');
    zoomOut.textContent = '−';
    zoomOut.title = 'Zoom Out';
    zoomOut.onclick = () => this.setScale(this.scale / 1.5);

    const zoomReset = document.createElement('button');
    zoomReset.textContent = '1:1';
    zoomReset.title = 'Reset Zoom';
    zoomReset.onclick = () => this.setScale(1);

    const zoomIn = document.createElement('button');
    zoomIn.textContent = '+';
    zoomIn.title = 'Zoom In';
    zoomIn.onclick = () => this.setScale(this.scale * 1.5);

    const zoomFit = document.createElement('button');
    zoomFit.textContent = 'Fit';
    zoomFit.title = 'Fit to Window';
    zoomFit.onclick = () => this.fitToWindow();

    // Style buttons
    [zoomOut, zoomReset, zoomIn, zoomFit].forEach(btn => {
      btn.style.cssText = `
        padding: 5px 10px;
        background: var(--accent-color, #555);
        color: var(--text-on-accent, #fff);
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-size: 12px;
      `;
    });

    // Scale display
    this.scaleDisplay = document.createElement('span');
    this.scaleDisplay.style.cssText = `
      font-family: monospace;
      font-size: 12px;
      min-width: 60px;
      color: var(--text-primary, #fff);
    `;
    this.updateScaleDisplay();

    toolbar.appendChild(zoomOut);
    toolbar.appendChild(zoomReset);
    toolbar.appendChild(zoomIn);
    toolbar.appendChild(zoomFit);
    toolbar.appendChild(this.scaleDisplay);

    this.container.appendChild(toolbar);
  }

  createInfoPanel() {
    this.infoPanel = document.createElement('div');
    this.infoPanel.style.cssText = `
      padding: 10px;
      background: var(--bg-secondary, #3d3d3d);
      border-top: 1px solid var(--border-color, #555);
      font-family: monospace;
      font-size: 12px;
      line-height: 1.4;
      color: var(--text-primary, #fff);
    `;

    this.container.appendChild(this.infoPanel);
    this.updateInfoPanel();
  }

  setupCanvasInteractions() {
    // Mouse wheel zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
      this.setScale(this.scale * scaleFactor);
    });

    // Mouse drag pan
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.canvas.style.cursor = 'grabbing';
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        const deltaX = e.clientX - this.lastMouseX;
        const deltaY = e.clientY - this.lastMouseY;
        this.panX += deltaX;
        this.panY += deltaY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.updateCanvasTransform();
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.canvas.style.cursor = 'grab';
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.isDragging = false;
      this.canvas.style.cursor = 'grab';
    });
  }

  loadD2File() {
    try {
      console.log('[D2ImageViewer] Loading D2 file');
      console.log('[D2ImageViewer] File info:', {
        name: this.file.name,
        contentType: typeof this.file.content,
        contentLength: this.file.content ? this.file.content.length : 'undefined',
        binaryData: this.file.binaryData
      });
      
      if (!this.file.content) {
        throw new Error('No file content provided');
      }

      // Create ImageData instance and load the D2 file
      this.imageData = new ImageData();
      
      // Convert base64 content to ArrayBuffer if needed
      let content = this.file.content;
      if (typeof content === 'string' && this.file.binaryData) {
        // Convert base64 to ArrayBuffer
        const binaryString = atob(content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        content = bytes.buffer;
        console.log('[D2ImageViewer] Converted base64 to ArrayBuffer:', content.byteLength, 'bytes');
      }
      
      this.imageData.loadFromContent(content, this.file.name);
      
      console.log('[D2ImageViewer] ImageData loaded:', {
        width: this.imageData.width,
        height: this.imageData.height,
        format: this.imageData.format,
        frames: this.imageData.frames.length
      });
      
      // Always update info panel first to show header data
      this.updateInfoPanel();
      
      // Only set up canvas if we have valid image data
      if (this.imageData.width > 0 && this.imageData.height > 0 && this.canvas) {
        // Set canvas size
        this.canvas.width = this.imageData.width;
        this.canvas.height = this.imageData.height;
        
        // Draw the image
        this.renderImage();
        
        // Fit to window initially
        this.fitToWindow();
      } else {
        console.log('[D2ImageViewer] No valid image data to display, showing header info only');
      }
      
      console.log('[D2ImageViewer] D2 file processed successfully');
      
    } catch (error) {
      console.error('[D2ImageViewer] Error loading D2 file:', error);
      this.showError(`Error loading D2 file: ${error.message}`);
      
      // Still try to show whatever info we can get
      this.updateInfoPanel();
    }
  }

  renderImage() {
    if (!this.imageData || !this.imageData.frames.length) return;
    
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Get current frame data
    const frame = this.imageData.frames[this.imageData.currentFrame];
    const imageData = new window.ImageData(frame.data, frame.width, frame.height);
    
    // Draw the image
    this.ctx.putImageData(imageData, 0, 0);
  }

  setScale(newScale) {
    this.scale = Math.max(0.1, Math.min(20, newScale));
    this.updateCanvasTransform();
    this.updateScaleDisplay();
  }

  updateCanvasTransform() {
    if (this.canvas) {
      this.canvas.style.transform = `translate(-50%, -50%) translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    }
  }

  updateScaleDisplay() {
    if (this.scaleDisplay) {
      this.scaleDisplay.textContent = `${Math.round(this.scale * 100)}%`;
    }
  }

  fitToWindow() {
    if (!this.imageData || !this.canvas) return;
    
    const container = this.canvas.parentElement;
    if (!container) return;
    
    const containerRect = container.getBoundingClientRect();
    const padding = 40; // Padding around the image
    
    const scaleX = (containerRect.width - padding) / this.imageData.width;
    const scaleY = (containerRect.height - padding) / this.imageData.height;
    const scale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond 100%
    
    this.setScale(scale);
    this.panX = 0;
    this.panY = 0;
    this.updateCanvasTransform();
  }

  updateInfoPanel() {
    if (!this.infoPanel) return;
    
    let infoHtml = '';
    
    // Try to show D2 header info even if ImageData failed to parse
    if (this.file && this.file.content) {
      try {
        // Parse raw D2 header manually for debug info
        let content = this.file.content;
        if (typeof content === 'string' && this.file.binaryData) {
          const binaryString = atob(content);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          content = bytes.buffer;
        }
        
        if (content.byteLength >= 25) {
          const view = new DataView(content);
          const magic = view.getUint16(0, true);
          const width = view.getUint16(2, true);
          const height = view.getUint16(4, true);
          const prerotation = view.getUint8(6);
          const flags = view.getUint8(7);
          const formatByte = view.getUint8(8);
          
          // Decode format byte properly
          const baseFormat = formatByte & 0x0F;
          const isRLE = (formatByte & 0x20) !== 0;
          const isIndexed = (formatByte & 0x40) !== 0;
          
          // Read palette name (16 bytes starting at offset 9)
          let paletteName = '';
          for (let i = 0; i < 16; i++) {
            const byte = view.getUint8(9 + i);
            if (byte === 0) break;
            paletteName += String.fromCharCode(byte);
          }
          
          const formatNames = {
            0: 'ALPHA8', 1: 'RGB565', 2: 'ARGB8888/RGB888', 3: 'ARGB4444/RGB444',
            4: 'ARGB1555/RGB555', 5: 'AI44', 6: 'RGBA8888', 7: 'RGBA4444',
            8: 'RGBA5551', 9: 'I8', 10: 'I4', 11: 'I2', 12: 'I1',
            13: 'ALPHA4', 14: 'ALPHA2', 15: 'ALPHA1'
          };
          
          const formatName = formatNames[baseFormat] || `Unknown (${baseFormat})`;
          const flagsText = [];
          if (flags & 0x01) flagsText.push('WRAPU');
          if (flags & 0x02) flagsText.push('WRAPV');
          if (flags & 0x04) flagsText.push('FILTERU');
          if (flags & 0x08) flagsText.push('FILTERV');
          
          infoHtml = `
            <strong>D2 Texture Header (Raw):</strong><br>
            Magic: 0x${magic.toString(16).toUpperCase().padStart(4, '0')} ${magic === 0x3244 ? '✓' : '✗'}<br>
            Dimensions: ${width} × ${height}<br>
            Format: ${formatName}<br>
            Flags: ${flags} (${flagsText.length ? flagsText.join(', ') : 'None'})<br>
            Prerotation: ${prerotation}<br>
            Palette Name: "${paletteName}"<br>
            File Size: ${content.byteLength} bytes<br>
            Header Size: 25 bytes<br>
            Data Size: ${content.byteLength - 25} bytes<br>
            <br>
            <strong>Format Details:</strong><br>
            Format Byte: 0x${formatByte.toString(16).padStart(2, '0')} (${formatByte})<br>
            Base Format: ${baseFormat} (${formatName})<br>
            RLE Compressed: ${isRLE ? 'Yes' : 'No'}<br>
            Indexed Color: ${isIndexed ? 'Yes' : 'No'}
          `;
        } else {
          infoHtml = `
            <strong>D2 File Info:</strong><br>
            File Size: ${content.byteLength} bytes<br>
            <span style="color: #ff6b6b;">⚠️ File too small for D2 header (need 25 bytes minimum)</span>
          `;
        }
      } catch (headerError) {
        console.error('[D2ImageViewer] Error parsing raw header:', headerError);
        infoHtml = `
          <strong>D2 File Info:</strong><br>
          File: ${this.file.name}<br>
          Content Type: ${typeof this.file.content}<br>
          Content Length: ${this.file.content ? this.file.content.length : 'undefined'}<br>
          <span style="color: #ff6b6b;">⚠️ Error parsing header: ${headerError.message}</span>
        `;
      }
    }
    
    // Add ImageData info if available
    if (this.imageData && this.imageData.metadata && this.imageData.metadata.format === 'd2') {
      const meta = this.imageData.metadata;
      const formatNames = {
        0: 'ALPHA8', 1: 'RGB565', 2: 'ARGB8888/RGB888', 3: 'ARGB4444/RGB444',
        4: 'ARGB1555/RGB555', 5: 'AI44', 6: 'RGBA8888', 7: 'RGBA4444',
        8: 'RGBA5551', 9: 'I8', 10: 'I4', 11: 'I2', 12: 'I1',
        13: 'ALPHA4', 14: 'ALPHA2', 15: 'ALPHA1'
      };
      
      const formatName = formatNames[meta.baseFormat] || `Unknown (${meta.baseFormat})`;
      const flagsText = [];
      if (meta.flags & 0x01) flagsText.push('WRAPU');
      if (meta.flags & 0x02) flagsText.push('WRAPV');
      if (meta.flags & 0x04) flagsText.push('FILTERU');
      if (meta.flags & 0x08) flagsText.push('FILTERV');
      
      infoHtml += `
        <br><strong>ImageData Parsed Info:</strong><br>
        Dimensions: ${this.imageData.width} × ${this.imageData.height}<br>
        Format: ${formatName}<br>
        RLE Compressed: ${meta.isRLE ? 'Yes' : 'No'}<br>
        Indexed Color: ${meta.isIndexed ? 'Yes' : 'No'}<br>
        Palette Name: ${meta.paletteName || '(none)'}<br>
        Flags: ${flagsText.length ? flagsText.join(', ') : 'None'}<br>
        Prerotation: ${meta.prerotation}<br>
        ${meta.palette ? `Palette Colors: ${meta.palette.length}` : ''}
      `;
    } else if (this.imageData) {
      infoHtml += `
        <br><strong>ImageData Info:</strong><br>
        Dimensions: ${this.imageData.width} × ${this.imageData.height}<br>
        Format: ${this.imageData.format}<br>
        Frames: ${this.imageData.frames.length}
      `;
    }
    
    if (!infoHtml) {
      infoHtml = 'No file loaded';
    }
    
    this.infoPanel.innerHTML = infoHtml;
  }

  showError(message) {
    if (this.container) {
      this.container.innerHTML = `
        <div style="
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-error, #ff6b6b);
          text-align: center;
          padding: 20px;
        ">
          <div>
            <h3>Error</h3>
            <p>${message}</p>
          </div>
        </div>
      `;
    }
  }

  // ViewerBase interface methods
  getElement() {
    // Create a temporary container if we don't have one yet
    if (!this.container) {
      this.container = document.createElement('div');
      this.createBody(this.container);
    }
    return this.container;
  }

  supportsFile(file) {
    return this.supportedExtensions.some(ext => 
      file.name.toLowerCase().endsWith(ext.toLowerCase())
    );
  }

  async setFile(file) {
    this.file = file;
    if (this.container) {
      this.loadD2File();
    }
  }

  getTitle() {
    return this.file ? `D2 Image: ${this.file.name}` : 'D2 Image Viewer';
  }

  static getFileExtensions() {
    return ['.d2'];
  }
}

// Register the viewer
if (typeof window !== 'undefined') {
  window.D2ImageViewer = D2ImageViewer;
  
  // Auto-register with the component registry when available
  if (window.ComponentRegistry) {
    ComponentRegistry.register('viewer', D2ImageViewer);
  } else {
    // Wait for component registry to be available
    window.addEventListener('DOMContentLoaded', () => {
      if (window.ComponentRegistry) {
        ComponentRegistry.register('viewer', D2ImageViewer);
      }
    });
  }
}

console.log('[D2ImageViewer] Class definition loaded');
