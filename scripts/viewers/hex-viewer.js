// hex-viewer.js
// Generic hex editor viewer for any file type with lazy loading

class HexViewer extends ViewerBase {
  constructor(path) {
    super(path);
    this.fileData = null;
    this.bytesPerRow = 16; // Fixed to 16 columns
    this.maxBytesToLoad = 64 * 1024; // Load max 64KB initially for performance
    this.currentOffset = 0;
    this.isLoaded = false;
    this.isLoading = false;

    this.initializeUI();
    // Auto-load the file data immediately
    this.loadFileData();
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async initializeUI() {
    const bodyContainer = this.element.querySelector('.viewer-body');
    if (!bodyContainer) return;

    bodyContainer.innerHTML = `
      <div class="hex-viewer-container">
        <div class="hex-content-wrapper">
          <div class="hex-status" id="hexStatus">
            Loading file data...
          </div>
          <div class="hex-content" id="hexContent" style="display: none;">
            <div class="hex-header">
              <div class="offset-column">Offset</div>
              <div class="hex-column">Hex Values</div>
              <div class="ascii-column">ASCII</div>
            </div>
            <div class="hex-data" id="hexData"></div>
          </div>
        </div>
      </div>
    `;
  }

  async loadFileData() {
    if (this.isLoading) return;
    
    this.isLoading = true;
    const statusElement = this.element.querySelector('#hexStatus');
    
    try {
      if (statusElement) statusElement.textContent = 'Loading file data...';

      let arrayBuffer;

      // Load from FileManager using the path-first storage
      const fileManager = window.serviceContainer?.get('fileManager') || window.FileManager;
      const record = await fileManager?.loadFile(this.path);
      if (!record) throw new Error('File not found in storage');

      // Cache size for ViewerBase.getFileSize()
      this.fileSize = record.size || 0;

      const content = record.content !== undefined ? record.content : record.fileContent;
      if (content instanceof ArrayBuffer) {
        arrayBuffer = content;
      } else if (content instanceof Uint8Array) {
        arrayBuffer = content.buffer;
      } else if (typeof content === 'string') {
        const encoder = new TextEncoder();
        arrayBuffer = encoder.encode(content).buffer;
      } else if (content && content.base64) {
        // Not expected, but handle base64 payloads
        const binary = atob(content.base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        arrayBuffer = bytes.buffer;
      } else {
        // Fallback: try JSON stringify
        const jsonString = JSON.stringify(content ?? '');
        const encoder = new TextEncoder();
        arrayBuffer = encoder.encode(jsonString).buffer;
      }

      this.fileData = new Uint8Array(arrayBuffer);
      this.isLoaded = true;

  const fileName = this.path ? (this.path.split('/').pop() || this.path.split('\\').pop()) : 'Unknown file';
  console.log(`[HexViewer] Loaded ${this.fileData.length} bytes from ${fileName}`);
      
      // Show hex content and render
      const hexContent = this.element.querySelector('#hexContent');
      if (hexContent) hexContent.style.display = 'block';
      if (statusElement) statusElement.style.display = 'none';
      
      this.renderHexData();
      
    } catch (error) {
      console.error('[HexViewer] Failed to load file data:', error);
      if (statusElement) statusElement.textContent = `Error loading file: ${error.message}`;
    } finally {
      this.isLoading = false;
    }
  }

  renderHexData() {
    if (!this.fileData) return;

    const hexDataElement = this.element.querySelector('#hexData');
    if (!hexDataElement) return;

    let html = '';
    const dataLength = Math.min(this.fileData.length, this.maxBytesToLoad);
    
    for (let offset = 0; offset < dataLength; offset += this.bytesPerRow) {
      const rowData = this.fileData.slice(offset, offset + this.bytesPerRow);
      html += this.renderHexRow(offset, rowData);
    }

    if (this.fileData.length > this.maxBytesToLoad) {
      html += `<div class="hex-truncated">... and ${this.fileData.length - this.maxBytesToLoad} more bytes (showing first ${this.formatFileSize(this.maxBytesToLoad)})</div>`;
    }

    hexDataElement.innerHTML = html;
  }

  renderHexRow(offset, rowData) {
    const offsetStr = offset.toString(16).padStart(8, '0').toUpperCase();
    
    let hexStr = '';
    let asciiStr = '';
    
    for (let i = 0; i < this.bytesPerRow; i++) {
      if (i < rowData.length) {
        const byte = rowData[i];
  // Append hex byte; add a space after each except the last to keep width predictable
  hexStr += byte.toString(16).padStart(2, '0').toUpperCase();
  if (i !== this.bytesPerRow - 1) hexStr += ' ';
        
        // Convert to ASCII, show . for non-printable characters
        if (byte >= 32 && byte <= 126) {
          asciiStr += String.fromCharCode(byte);
        } else {
          asciiStr += '.';
        }
      } else {
  // For missing bytes, add two spaces to match a "byte" width plus separator
  hexStr += (i !== this.bytesPerRow - 1) ? '   ' : '  ';
        asciiStr += ' ';
      }
    }

    return `
      <div class="hex-row">
        <div class="offset">${offsetStr}</div>
        <div class="hex-bytes">${hexStr}</div>
        <div class="ascii-chars">${asciiStr}</div>
      </div>
    `;
  }

  // ViewerBase interface methods
  loseFocus() {
    console.log('[HexViewer] Tab lost focus');
    // No audio to stop, but consistent interface
  }

  cleanup() {
    console.log('[HexViewer] Cleaning up hex viewer');
    // No resources to clean up, but consistent interface
  }

  // Legacy support
  onFocus() {
    console.log('[HexViewer] Tab gained focus');
  }

  onBlur() {
    this.loseFocus();
  }

  onClose() {
    this.cleanup();
  }
}

// Export for use
window.HexViewer = HexViewer;
console.log('[HexViewer] Class exported to window.HexViewer');

// Static metadata for auto-registration
HexViewer.getFileExtensions = () => ['*'];
HexViewer.getDisplayName = () => 'Hex Viewer';
HexViewer.getIcon = () => '🔍';
HexViewer.getPriority = () => 1; // low priority fallback
HexViewer.getCapabilities = () => ['binary-display'];
