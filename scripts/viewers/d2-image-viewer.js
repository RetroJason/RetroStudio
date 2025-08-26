/**
 * D2 Image Viewer
 * Displays D2 texture files with metadata and image preview
 * Uses the ImageData class to load and display D2 textures.
 */

class D2ImageViewer extends ViewerBase {
  constructor(path) {
    super(path);
    this.className = 'D2ImageViewer';
    this.supportedExtensions = ['.d2'];
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    console.log('[D2ImageViewer] Constructor completed for path:', this.path);
    console.log('[D2ImageViewer] Canvas state in constructor:', this.canvas);
    
    // Load file data after initialization is complete
    this.loadFileData();
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

    // Create main content area with image and info side by side
    const mainContent = document.createElement('div');
    mainContent.style.cssText = `
      flex: 1;
      display: flex;
      overflow: hidden;
    `;

    // Create canvas container (left side)
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
    console.log('[D2ImageViewer] Canvas created in createBody:', this.canvas);
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

    // Setup canvas interactions
    this.setupCanvasInteractions();

    // Create info panel (right side)
    this.createInfoPanel();

    // Add both to main content
    mainContent.appendChild(canvasContainer);
    mainContent.appendChild(this.infoPanel);
    
    // Add main content to container
    bodyContainer.appendChild(mainContent);
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
      
      const file = await fileManager.loadFile(this.path);
      console.log('[D2ImageViewer] File data loaded from storage, size:', file.content?.byteLength || file.content?.length || 'unknown');
      
      this.file = file;
      
      // Process the D2 file
      await this.loadD2File();
      
    } catch (error) {
      console.error('[D2ImageViewer] Error loading file data:', error);
      this.showError(`Failed to load file: ${error.message}`);
    }
  }

  createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
      padding: 8px 12px;
      background: var(--bg-secondary, #3d3d3d);
      border-bottom: 1px solid var(--border-color, #555);
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
    `;

    // File info
    const fileInfo = document.createElement('span');
    fileInfo.textContent = this.path ? this.path.split('/').pop() : 'Unknown file';
    fileInfo.style.cssText = `
      color: var(--text-primary, #fff);
      font-weight: 500;
    `;

    // Spacer
    const spacer = document.createElement('div');
    spacer.style.flex = '1';

    // Zoom controls
    const zoomControls = document.createElement('div');
    zoomControls.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
    `;

    // Zoom out button
    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.textContent = '−';
    zoomOutBtn.style.cssText = `
      width: 24px;
      height: 24px;
      border: 1px solid var(--border-color, #555);
      background: var(--bg-primary, #2d2d2d);
      color: var(--text-primary, #fff);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      line-height: 1;
    `;
    zoomOutBtn.onclick = () => this.setScale(this.scale * 0.8);

    // Scale display
    this.scaleDisplay = document.createElement('span');
    this.scaleDisplay.style.cssText = `
      min-width: 40px;
      text-align: center;
      color: var(--text-secondary, #ccc);
    `;

    // Zoom in button
    const zoomInBtn = document.createElement('button');
    zoomInBtn.textContent = '+';
    zoomInBtn.style.cssText = zoomOutBtn.style.cssText;
    zoomInBtn.onclick = () => this.setScale(this.scale * 1.25);

    // Fit to view button
    const fitBtn = document.createElement('button');
    fitBtn.textContent = 'Fit';
    fitBtn.style.cssText = `
      padding: 2px 8px;
      border: 1px solid var(--border-color, #555);
      background: var(--bg-primary, #2d2d2d);
      color: var(--text-primary, #fff);
      cursor: pointer;
      font-size: 11px;
    `;
    fitBtn.onclick = () => this.fitToView();

    zoomControls.appendChild(zoomOutBtn);
    zoomControls.appendChild(this.scaleDisplay);
    zoomControls.appendChild(zoomInBtn);
    zoomControls.appendChild(fitBtn);

    toolbar.appendChild(fileInfo);
    toolbar.appendChild(spacer);
    toolbar.appendChild(zoomControls);

    this.container.appendChild(toolbar);
  }

  createInfoPanel() {
    this.infoPanel = document.createElement('div');
    this.infoPanel.style.cssText = `
      width: 300px;
      padding: 15px;
      background: var(--bg-secondary, #3d3d3d);
      border-left: 1px solid var(--border-color, #555);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      color: var(--text-primary, #fff);
      overflow-y: auto;
      box-sizing: border-box;
    `;

    this.updateInfoPanel();
  }

  setupCanvasInteractions() {
    // Mouse wheel zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
      this.setScale(this.scale * scaleFactor);
    });

    // Mouse drag panning
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.canvas.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
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

    document.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
      }
    });
  }

  async loadD2File() {
    try {
      if (!this.file || !this.file.content) {
        console.log('[D2ImageViewer] No file content to load');
        return;
      }

      console.log('[D2ImageViewer] Loading D2 file');
      console.log('[D2ImageViewer] File info:', {
        name: this.file.name,
        contentType: typeof this.file.content,
        contentLength: this.file.content?.length,
        binaryData: this.file.binaryData
      });

      // Convert content to ArrayBuffer if needed
      let content = this.file.content;
      if (typeof content === 'string' && this.file.binaryData) {
        console.log('[D2ImageViewer] Converting base64 string to ArrayBuffer');
        const binaryString = atob(content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        content = bytes.buffer;
      }

      console.log('[D2ImageViewer] Loading ImageData from D2 binary data');
      this.imageData = new ImageData();
      await this.imageData.loadFromD2Binary(content);

      console.log('[D2ImageViewer] ImageData loaded:', {
        width: this.imageData?.width,
        height: this.imageData?.height,
        format: this.imageData?.format,
        frames: this.imageData?.frames?.length
      });

      // Always update info panel first to show header data
      this.updateInfoPanel();

      // Check if we have valid image data for rendering
      const canRender = this.imageData?.width > 0 && this.imageData?.height > 0 && this.imageData?.frames?.length > 0;
      
      console.log('[D2ImageViewer] Condition check:', {
        width: this.imageData?.width,
        height: this.imageData?.height,
        canvas: this.canvas ? 'present' : 'missing',
        canvasElement: this.canvas ? 'present' : 'missing',
        condition: canRender
      });

      if (canRender && this.canvas) {
        if (!this.canvas.parentElement) {
          console.log('[D2ImageViewer] Canvas missing, attempting to re-acquire...');
          // Canvas was removed, try to re-acquire it
          const canvasElements = this.container.querySelectorAll('canvas');
          if (canvasElements.length > 0) {
            this.canvas = canvasElements[0];
            this.ctx = this.canvas.getContext('2d');
            this.ctx.imageSmoothingEnabled = false;
            console.log('[D2ImageViewer] Successfully re-acquired canvas');
          } else {
            console.log('[D2ImageViewer] Could not re-acquire canvas');
            return;
          }
        }
        
        console.log('[D2ImageViewer] Starting image render process');
        this.renderImage();
      } else {
        console.log('[D2ImageViewer] No valid image data to display, showing header info only');
      }

    } catch (error) {
      console.error('[D2ImageViewer] Error loading D2 file:', error);
      this.showError(`Failed to load D2 image: ${error.message}`);
    }

    // D2 file processed successfully
    console.log('[D2ImageViewer] D2 file processed successfully');
    
    // Still try to show whatever info we can get
    this.updateInfoPanel();
  }

  renderImage() {
    try {
      if (!this.imageData || !this.canvas) {
        console.log('[D2ImageViewer] Missing imageData or canvas for rendering');
        return;
      }

      console.log('[D2ImageViewer] Rendering D2 image using Image.toCanvas()');
      const renderedCanvas = this.imageData.toCanvas();
      
      if (!renderedCanvas) {
        console.error('[D2ImageViewer] toCanvas() returned null');
        return;
      }

      console.log('[D2ImageViewer] Successfully rendered image from toCanvas()');

      // Set canvas size and draw the image
      this.canvas.width = renderedCanvas.width;
      this.canvas.height = renderedCanvas.height;
      
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(renderedCanvas, 0, 0);

      // Fit to view on first load
      this.fitToView();

    } catch (error) {
      console.error('[D2ImageViewer] Error rendering image:', error);
      this.showError(`Failed to render image: ${error.message}`);
    }
  }

  updateInfoPanel() {
    if (!this.infoPanel) return;

    let html = '<h3 style="margin: 0 0 15px 0; color: var(--text-primary, #fff); font-size: 14px; border-bottom: 1px solid var(--border-color, #555); padding-bottom: 8px;">D2 Texture Info</h3>';

    if (this.imageData) {
      const metadata = this.imageData.getD2Metadata ? this.imageData.getD2Metadata() : {};
      
      html += '<table style="width: 100%; border-collapse: collapse; font-size: 12px;">';
      
      // Essential information in clean table format
      const rows = [
        ['Palette', metadata.paletteName || 'None'],
        ['Format', `D2 (${metadata.baseFormat || 'Unknown'})`],
        ['Dimensions', `${this.imageData.width || 0} × ${this.imageData.height || 0}`],
        ['Size', this.formatFileSize(this.file?.content?.byteLength || this.file?.content?.length || 0)],
        ['Compression', metadata.isRLE ? 'RLE' : 'None'],
        ['Flags', metadata.flags || 0]
      ];

      rows.forEach(([label, value]) => {
        html += `
          <tr>
            <td style="padding: 4px 8px 4px 0; color: var(--text-secondary, #ccc); vertical-align: top; width: 35%;">${label}:</td>
            <td style="padding: 4px 0; color: var(--text-primary, #fff); word-break: break-word;">${value}</td>
          </tr>
        `;
      });

      html += '</table>';
    } else {
      html += '<p style="color: var(--text-secondary, #ccc); font-style: italic;">Loading...</p>';
    }

    this.infoPanel.innerHTML = html;
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  setScale(scale) {
    this.scale = Math.max(0.1, Math.min(10, scale));
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

  fitToView() {
    if (!this.canvas || !this.canvas.parentElement) return;
    
    const container = this.canvas.parentElement;
    const containerRect = container.getBoundingClientRect();
    const padding = 40;
    
    const scaleX = (containerRect.width - padding) / this.canvas.width;
    const scaleY = (containerRect.height - padding) / this.canvas.height;
    const fitScale = Math.min(scaleX, scaleY, 1);
    
    this.setScale(fitScale);
    this.panX = 0;
    this.panY = 0;
    this.updateCanvasTransform();
  }

  showError(message) {
    if (this.infoPanel) {
      this.infoPanel.innerHTML = `
        <h3 style="margin: 0 0 15px 0; color: var(--text-primary, #fff); font-size: 14px; border-bottom: 1px solid var(--border-color, #555); padding-bottom: 8px;">Error</h3>
        <div style="color: #ff6b6b; background: rgba(255, 107, 107, 0.1); padding: 10px; border-radius: 4px; border-left: 3px solid #ff6b6b;">
          ${message}
        </div>
      `;
    }
  }

  // ViewerBase interface methods
  cleanup() {
    // Clean up any resources
    if (this.canvas) {
      this.canvas.removeEventListener('wheel', this.wheelHandler);
      this.canvas.removeEventListener('mousedown', this.mouseDownHandler);
    }
  }

  getElement() {
    return this.element;
  }

  supportsFile(file) {
    if (!file || !file.name) return false;
    const extension = file.name.toLowerCase().split('.').pop();
    return this.supportedExtensions.includes('.' + extension);
  }

  async setFile(file) {
    this.file = file;
    if (this.container) {
      await this.loadD2File();
    }
  }
}

// Static method to define supported file extensions
D2ImageViewer.getFileExtensions = () => ['.d2'];

// Auto-register the viewer
if (typeof ComponentRegistry !== 'undefined') {
  D2ImageViewer.registerComponent();
}
