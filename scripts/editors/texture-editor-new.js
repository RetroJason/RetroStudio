// texture-editor.js
// Clean, simplified texture editor implementation

console.log('[TextureEditor] Class definition loading');

// TextureData class - simplified data structure
class TextureData extends EventTarget {
  constructor(options = {}) {
    super();
    
    // Basic properties
    this.name = options.name || 'texture';
    this.sourceImage = options.sourceImage || null;
    this.width = options.width || 32;
    this.height = options.height || 32;
    this.colorKey = options.colorKey || '#FF00FF';
    this.RLE = options.RLE !== undefined ? options.RLE : false;
    this.rotation = options.rotation || 0;
    this.colorFormat = options.colorFormat || 'd2_mode_i8';
    this.colorDepth = options.colorDepth || 8;
    this.palette = options.palette || '';
    this.paletteObject = null;
    this.scale = options.scale || 1.0;
    this.paletteOffset = options.paletteOffset || 0;
    
    // Image data
    this.sourceImageData = null;
    this.processedImageData = null;
  }
}

// Main TextureEditor class
class TextureEditor extends EditorBase {
  constructor(fileObject, isNewResource = false) {
    console.log('[TextureEditor] Constructor called:', fileObject, isNewResource);
    
    // Initialize basic properties
    this.textureData = new TextureData();
    this.originalCanvas = null;
    this.originalCtx = null;
    this.outputCanvas = null;
    this.outputCtx = null;
    this.isCreatingFromImage = false;
    
    // Call parent constructor
    super(fileObject, isNewResource);
    
    console.log('[TextureEditor] Constructor completed');
  }

  createBody(bodyContainer) {
    console.log('[TextureEditor] createBody called');
    
    // Initialize texture data based on file type
    this.initializeTextureData();
    
    // Create the main layout
    const mainContainer = document.createElement('div');
    mainContainer.className = 'texture-editor';
    mainContainer.style.cssText = 'display: flex; flex-direction: column; height: 100%; gap: 10px; padding: 10px;';
    
    // Create preview panel
    this.createPreviewPanel(mainContainer);
    
    bodyContainer.appendChild(mainContainer);
    
    // Initialize content after DOM is ready
    setTimeout(() => this.initializeContent(), 0);
  }
  
  initializeTextureData() {
    console.log('[TextureEditor] initializeTextureData called');
    
    if (!this.file) {
      console.log('[TextureEditor] No file object, using defaults');
      return;
    }
    
    const fileExt = this.file.filename ? this.file.filename.toLowerCase().split('.').pop() : '';
    console.log('[TextureEditor] File extension:', fileExt);
    
    if (fileExt === 'png' || fileExt === 'jpg' || fileExt === 'jpeg' || fileExt === 'gif' || fileExt === 'bmp') {
      // Creating texture from image file
      this.isCreatingFromImage = true;
      const baseName = this.file.filename.split('.').slice(0, -1).join('.');
      this.textureData.name = baseName;
      this.textureData.sourceImage = this.file.path;
      console.log('[TextureEditor] Created texture data for image file:', baseName);
    } else if (fileExt === 'texture' || fileExt === 'tex') {
      // Loading existing texture file
      this.isCreatingFromImage = false;
      try {
        const textureContent = JSON.parse(this.file.fileContent);
        Object.assign(this.textureData, textureContent);
        console.log('[TextureEditor] Loaded texture data from file');
      } catch (error) {
        console.error('[TextureEditor] Failed to parse texture file:', error);
      }
    }
  }
  
  createPreviewPanel(container) {
    console.log('[TextureEditor] createPreviewPanel called');
    
    // Source image section
    const sourceSection = document.createElement('div');
    sourceSection.style.cssText = 'display: flex; flex-direction: column; gap: 5px;';
    
    const sourceLabel = document.createElement('label');
    sourceLabel.textContent = 'Source Image:';
    sourceSection.appendChild(sourceLabel);
    
    this.originalCanvas = document.createElement('canvas');
    this.originalCanvas.style.cssText = 'border: 1px solid #444; max-width: 100%; max-height: 200px;';
    this.originalCtx = this.originalCanvas.getContext('2d');
    sourceSection.appendChild(this.originalCanvas);
    
    // Palette section
    const paletteSection = document.createElement('div');
    paletteSection.style.cssText = 'display: flex; flex-direction: column; gap: 5px;';
    
    const paletteLabel = document.createElement('label');
    paletteLabel.textContent = 'Palette:';
    paletteSection.appendChild(paletteLabel);
    
    this.paletteSelect = document.createElement('select');
    this.paletteSelect.style.cssText = 'padding: 5px;';
    paletteSection.appendChild(paletteSelect);
    
    // Apply button
    this.applyButton = document.createElement('button');
    this.applyButton.textContent = 'Apply';
    this.applyButton.style.cssText = 'padding: 8px 16px; background: #0078d4; color: white; border: none; cursor: pointer;';
    this.applyButton.onclick = () => this.processTexture();
    paletteSection.appendChild(this.applyButton);
    
    // Output section
    const outputSection = document.createElement('div');
    outputSection.style.cssText = 'display: flex; flex-direction: column; gap: 5px;';
    
    const outputLabel = document.createElement('label');
    outputLabel.textContent = 'Texture Output:';
    outputSection.appendChild(outputLabel);
    
    this.outputCanvas = document.createElement('canvas');
    this.outputCanvas.style.cssText = 'border: 1px solid #444; max-width: 100%; max-height: 200px;';
    this.outputCtx = this.outputCanvas.getContext('2d');
    outputSection.appendChild(this.outputCanvas);
    
    // Add sections to container
    container.appendChild(sourceSection);
    container.appendChild(paletteSection);
    container.appendChild(outputSection);
    
    console.log('[TextureEditor] Preview panel created');
  }
  
  async initializeContent() {
    console.log('[TextureEditor] initializeContent called');
    
    if (this.isCreatingFromImage && this.file) {
      await this.loadSourceImage();
    }
    
    this.updatePaletteOptions();
  }
  
  async loadSourceImage() {
    console.log('[TextureEditor] loadSourceImage called');
    
    if (!this.file || !this.file.fileContent) {
      console.error('[TextureEditor] No file content to load');
      return;
    }
    
    try {
      // Create image from base64 data
      const img = new Image();
      img.onload = () => {
        console.log('[TextureEditor] Image loaded:', img.width, 'x', img.height);
        
        // Set canvas size and draw image
        this.originalCanvas.width = img.width;
        this.originalCanvas.height = img.height;
        this.originalCtx.drawImage(img, 0, 0);
        
        // Store image data
        this.textureData.sourceImageData = this.originalCtx.getImageData(0, 0, img.width, img.height);
        this.textureData.width = img.width;
        this.textureData.height = img.height;
        
        console.log('[TextureEditor] Source image loaded and processed');
        
        // Auto-process if palette is available
        if (this.textureData.paletteObject) {
          this.processTexture();
        }
      };
      
      img.onerror = (error) => {
        console.error('[TextureEditor] Failed to load image:', error);
      };
      
      // Convert file content to data URL
      const dataUrl = `data:image/png;base64,${this.file.fileContent}`;
      img.src = dataUrl;
      
    } catch (error) {
      console.error('[TextureEditor] Error loading source image:', error);
    }
  }
  
  updatePaletteOptions() {
    console.log('[TextureEditor] updatePaletteOptions called');
    
    // Clear existing options
    this.paletteSelect.innerHTML = '<option value="">Select palette...</option>';
    
    // Get project explorer instance to find palette files
    const projectExplorer = window.ServiceContainer?.get('projectExplorer');
    if (projectExplorer) {
      const paletteFiles = projectExplorer.getSourceFiles('Palettes') || [];
      paletteFiles.forEach(palette => {
        const option = document.createElement('option');
        option.value = palette;
        option.textContent = palette.split('/').pop();
        this.paletteSelect.appendChild(option);
      });
    }
    
    // Set up change handler
    this.paletteSelect.onchange = () => {
      const selectedPalette = this.paletteSelect.value;
      if (selectedPalette) {
        this.loadPalette(selectedPalette);
      }
    };
  }
  
  async loadPalette(palettePath) {
    console.log('[TextureEditor] loadPalette called:', palettePath);
    
    try {
      const fileManager = window.ServiceContainer?.get('fileManager');
      if (!fileManager) {
        console.error('[TextureEditor] FileManager not available');
        return;
      }
      
      const paletteFile = await fileManager.loadFile(palettePath);
      if (!paletteFile) {
        console.error('[TextureEditor] Failed to load palette file');
        return;
      }
      
      // Create palette object
      this.textureData.paletteObject = new Palette();
      await this.textureData.paletteObject.loadFromContent(paletteFile.fileContent, paletteFile.filename);
      this.textureData.palette = palettePath;
      
      console.log('[TextureEditor] Palette loaded successfully:', this.textureData.paletteObject.colors.length, 'colors');
      
      // Auto-process if source image is available
      if (this.textureData.sourceImageData) {
        this.processTexture();
      }
      
    } catch (error) {
      console.error('[TextureEditor] Error loading palette:', error);
    }
  }
  
  processTexture() {
    console.log('[TextureEditor] processTexture called');
    
    if (!this.textureData.sourceImageData) {
      console.warn('[TextureEditor] No source image data');
      return;
    }
    
    if (!this.textureData.paletteObject) {
      console.warn('[TextureEditor] No palette loaded');
      return;
    }
    
    try {
      // Create a copy of the source image data
      const sourceData = this.textureData.sourceImageData;
      const processedData = new ImageData(
        new Uint8ClampedArray(sourceData.data),
        sourceData.width,
        sourceData.height
      );
      
      // Apply basic palette quantization
      this.applyPaletteQuantization(processedData);
      
      // Store processed data
      this.textureData.processedImageData = processedData;
      
      // Update output canvas
      this.updateOutput();
      
      console.log('[TextureEditor] Texture processing completed');
      
    } catch (error) {
      console.error('[TextureEditor] Error processing texture:', error);
    }
  }
  
  applyPaletteQuantization(imageData) {
    const data = imageData.data;
    const palette = this.textureData.paletteObject.colors;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // Find closest palette color (simple distance)
      let closestIndex = 0;
      let closestDistance = Infinity;
      
      for (let j = 0; j < palette.length; j++) {
        const pr = palette[j].r;
        const pg = palette[j].g;
        const pb = palette[j].b;
        
        const distance = Math.sqrt(
          Math.pow(r - pr, 2) +
          Math.pow(g - pg, 2) +
          Math.pow(b - pb, 2)
        );
        
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = j;
        }
      }
      
      // Apply closest palette color
      data[i] = palette[closestIndex].r;
      data[i + 1] = palette[closestIndex].g;
      data[i + 2] = palette[closestIndex].b;
      // Keep original alpha
    }
  }
  
  updateOutput() {
    console.log('[TextureEditor] updateOutput called');
    
    if (!this.textureData.processedImageData) {
      console.warn('[TextureEditor] No processed image data');
      return;
    }
    
    const processed = this.textureData.processedImageData;
    
    // Set output canvas size
    this.outputCanvas.width = processed.width;
    this.outputCanvas.height = processed.height;
    
    // Draw processed image
    this.outputCtx.putImageData(processed, 0, 0);
    
    console.log('[TextureEditor] Output updated');
  }
  
  // EditorBase required methods
  getContent() {
    return JSON.stringify(this.textureData, null, 2);
  }
  
  setContent(content) {
    try {
      const data = JSON.parse(content);
      Object.assign(this.textureData, data);
    } catch (error) {
      console.error('[TextureEditor] Failed to set content:', error);
    }
  }
  
  isDirty() {
    return this.textureData.sourceImageData !== null;
  }
  
  canSave() {
    return true;
  }
}

console.log('[TextureEditor] TextureData class defined:', typeof TextureData);
console.log('[TextureEditor] Class definition loaded');
