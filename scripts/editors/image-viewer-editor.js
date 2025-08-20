// dpaint-integration-editor.js
// Integration wrapper for DPaint.js pixel art editor

console.log('[DPaintIntegrationEditor] Class definition loading - DPaint.js integration wrapper');

class DPaintIntegrationEditor extends EditorBase {
  constructor(fileObject = null, readOnly = false) {
    super(fileObject, readOnly);
    
    this.dpaintFrame = null;
    this.imageData = null;
    this.originalImageData = null;
    
    console.log('[DPaintIntegrationEditor] Constructor completed', {
      path: this.path,
      isNewResource: this.isNewResource,
      hasFileRecord: this.hasFileRecord,
      id: this.id
    });
  }

  createElement() {
    if (this.element) return this.element;

    super.createElement();
    
    // Create main container with toolbar and embedded DPaint
    this.element.innerHTML = `
      <div class="dpaint-integration-container" style="display: flex; flex-direction: column; height: 100%; background: #2d2d2d;">
        <!-- Toolbar -->
        <div class="dpaint-toolbar" style="background: #3d3d3d; padding: 8px; border-bottom: 1px solid #555; display: flex; gap: 10px; align-items: center;">
          <button id="launchDPaint" style="padding: 6px 12px; background: #0066cc; color: white; border: none; border-radius: 3px; cursor: pointer;">
            🎨 Launch DPaint.js
          </button>
          <button id="importFromDPaint" style="padding: 6px 12px; background: #228b22; color: white; border: none; border-radius: 3px; cursor: pointer;" disabled>
            📥 Import from DPaint
          </button>
          <span style="color: #ccc; font-size: 12px;">
            Click "Launch DPaint.js" to open the full pixel art editor in a new window
          </span>
        </div>
        
        <!-- Preview area -->
        <div class="image-preview" style="flex: 1; display: flex; align-items: center; justify-content: center; background: #1a1a1a; position: relative;">
          <div id="previewContainer" style="max-width: 100%; max-height: 100%; border: 2px solid #555;">
            <canvas id="previewCanvas" style="max-width: 100%; max-height: 100%; image-rendering: pixelated;"></canvas>
          </div>
          <div id="loadingMessage" style="position: absolute; color: #ccc; font-size: 14px; text-align: center;">
            No image loaded. Use "Launch DPaint.js" to create or edit images.
          </div>
        </div>
        
        <!-- Status Bar -->
        <div class="status-bar" style="background: #3d3d3d; padding: 4px 8px; border-top: 1px solid #555; color: #ccc; font-size: 11px; display: flex; justify-content: space-between;">
          <span id="imageInfo">Ready</span>
          <span>DPaint.js Integration v1.0</span>
        </div>
      </div>
    `;

    this.setupEventListeners();
    
    // Load file data if available
    if (this.fileObject) {
      this.loadFileData().catch(error => {
        console.error('[DPaintIntegrationEditor] Failed to load file data:', error);
        this.showError('Failed to load file data: ' + error.message);
      });
    }
    
    return this.element;
  }

  setupEventListeners() {
    const launchBtn = this.element.querySelector('#launchDPaint');
    const importBtn = this.element.querySelector('#importFromDPaint');
    
    launchBtn.addEventListener('click', () => this.launchDPaint());
    importBtn.addEventListener('click', () => this.importFromDPaint());
  }

  async launchDPaint() {
    try {
      console.log('[DPaintIntegrationEditor] Launching DPaint.js...');
      
      // Create a new window with DPaint.js
      const dpaintWindow = window.open('', '_blank', 
        'width=1200,height=800,scrollbars=yes,resizable=yes,menubar=no,toolbar=no'
      );
      
      if (!dpaintWindow) {
        throw new Error('Failed to open DPaint.js window. Please allow popups for this site.');
      }
      
      // Load DPaint.js content
      dpaintWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>DPaint.js - Pixel Art Editor</title>
          <meta charset="utf-8">
          <style>
            body { margin: 0; padding: 20px; background: #2d2d2d; color: #ccc; font-family: Arial, sans-serif; }
            .loading { text-align: center; padding: 50px; }
            .error { color: #ff6666; text-align: center; padding: 50px; }
          </style>
        </head>
        <body>
          <div class="loading">
            <h2>Loading DPaint.js...</h2>
            <p>The pixel art editor is being loaded from GitHub.</p>
            <p>This may take a few moments on first load.</p>
          </div>
          <script>
            // Redirect to the actual DPaint.js application
            window.location.href = 'https://www.stef.be/dpaint/';
          </script>
        </body>
        </html>
      `);
      
      dpaintWindow.document.close();
      
      // Update UI to show DPaint is launched
      this.element.querySelector('#importFromDPaint').disabled = false;
      this.element.querySelector('#imageInfo').textContent = 'DPaint.js launched in new window';
      
      // Store reference for communication
      this.dpaintWindow = dpaintWindow;
      
      // If we have image data, we could potentially send it to DPaint (future enhancement)
      if (this.imageData) {
        console.log('[DPaintIntegrationEditor] Image data available for editing');
        // TODO: Implement image data transfer to DPaint window
      }
      
    } catch (error) {
      console.error('[DPaintIntegrationEditor] Failed to launch DPaint:', error);
      this.showError('Failed to launch DPaint.js: ' + error.message);
    }
  }

  async importFromDPaint() {
    try {
      console.log('[DPaintIntegrationEditor] Importing from DPaint.js...');
      
      // For now, show instructions for manual import
      const instructions = `
To import your image from DPaint.js:

1. In DPaint.js, go to File → Save
2. Choose PNG format
3. Save the file to your computer
4. Drag and drop the PNG file into RetroStudio's Images folder

Future versions will support direct integration for seamless importing.
      `;
      
      alert(instructions);
      
    } catch (error) {
      console.error('[DPaintIntegrationEditor] Failed to import from DPaint:', error);
      this.showError('Failed to import from DPaint.js: ' + error.message);
    }
  }

  async loadFile(filePath) {
    try {
      console.log('[DPaintIntegrationEditor] Loading image file:', filePath);
      
      // Load image using FileManager
      const fileData = await window.fileManager.loadFile(filePath);
      if (!fileData || !fileData.fileContent) {
        throw new Error('Failed to load file data');
      }
      
      await this.displayImage(fileData);
      
    } catch (error) {
      console.error('[DPaintIntegrationEditor] Failed to load image:', error);
      this.showError('Failed to load image: ' + error.message);
    }
  }

  async loadFileData() {
    if (this.fileObject && this.fileObject.fileContent) {
      console.log('[DPaintIntegrationEditor] Loading file data from fileObject:', this.fileObject);
      await this.displayImage(this.fileObject);
    }
  }

  async displayImage(fileData) {
    try {
      const canvas = this.element.querySelector('#previewCanvas');
      const ctx = canvas.getContext('2d');
      const loadingMessage = this.element.querySelector('#loadingMessage');
      const imageInfo = this.element.querySelector('#imageInfo');
      
      // Create image element to load the data
      const img = new Image();
      
      await new Promise((resolve, reject) => {
        img.onload = () => {
          // Set canvas size to match image
          canvas.width = img.width;
          canvas.height = img.height;
          
          // Draw image
          ctx.imageSmoothingEnabled = false; // Pixel art style
          ctx.drawImage(img, 0, 0);
          
          // Update UI
          loadingMessage.style.display = 'none';
          imageInfo.textContent = `${fileData.filename} - ${img.width}x${img.height}px`;
          
          // Store image data
          this.imageData = ctx.getImageData(0, 0, img.width, img.height);
          this.originalImageData = ctx.getImageData(0, 0, img.width, img.height);
          
          console.log('[DPaintIntegrationEditor] Image loaded successfully:', img.width + 'x' + img.height);
          resolve();
        };
        
        img.onerror = () => {
          reject(new Error('Failed to decode image'));
        };
        
        // Handle different data types
        if (fileData.binaryData) {
          // Convert base64 to data URL
          const mimeType = this.getMimeTypeFromExtension(fileData.filename);
          img.src = `data:${mimeType};base64,${fileData.fileContent}`;
        } else if (typeof fileData.fileContent === 'string') {
          if (fileData.fileContent.startsWith('data:')) {
            img.src = fileData.fileContent;
          } else {
            // Assume base64
            img.src = 'data:image/png;base64,' + fileData.fileContent;
          }
        } else {
          throw new Error('Unsupported file data format');
        }
      });
      
    } catch (error) {
      console.error('[DPaintIntegrationEditor] Failed to display image:', error);
      this.showError('Failed to display image: ' + error.message);
    }
  }

  getMimeTypeFromExtension(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes = {
      'png': 'image/png',
      'gif': 'image/gif',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'bmp': 'image/bmp',
      'webp': 'image/webp'
    };
    return mimeTypes[ext] || 'image/png';
  }

  getContent() {
    if (!this.imageData) return null;
    
    // Create canvas and export as PNG
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = this.imageData.width;
    canvas.height = this.imageData.height;
    
    ctx.putImageData(this.imageData, 0, 0);
    
    return canvas.toDataURL('image/png');
  }

  setContent(content) {
    if (content) {
      // Create a file-like object and display it
      const fileData = {
        filename: 'image.png',
        fileContent: content,
        binaryData: false
      };
      this.displayImage(fileData);
    }
  }

  showError(message) {
    const imageInfo = this.element.querySelector('#imageInfo');
    const loadingMessage = this.element.querySelector('#loadingMessage');
    
    if (imageInfo) {
      imageInfo.textContent = 'Error: ' + message;
      imageInfo.style.color = '#ff6666';
    }
    
    if (loadingMessage) {
      loadingMessage.textContent = 'Error: ' + message;
      loadingMessage.style.color = '#ff6666';
      loadingMessage.style.display = 'block';
    }
  }

  markDirty() {
    this.dirty = true;
    if (window.eventBus) {
      window.eventBus.emit('editor.content.changed', { editor: this });
    }
  }

  cleanup() {
    // Close DPaint window if it's still open
    if (this.dpaintWindow && !this.dpaintWindow.closed) {
      this.dpaintWindow.close();
    }
    super.cleanup && super.cleanup();
  }
}

// Register the editor with the component registry
console.log('[DPaintIntegrationEditor] Registering with component registry');

// Static methods for ComponentRegistry auto-registration
DPaintIntegrationEditor.getFileExtensions = () => ['.png', '.gif'];
DPaintIntegrationEditor.getDisplayName = () => 'DPaint.js Editor';
DPaintIntegrationEditor.getIcon = () => '🎨';
DPaintIntegrationEditor.getPriority = () => 5; // Higher priority than basic viewers
DPaintIntegrationEditor.canCreate = false;
DPaintIntegrationEditor.singleInstance = false;

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DPaintIntegrationEditor;
} else {
  window.DPaintIntegrationEditor = DPaintIntegrationEditor;
}
