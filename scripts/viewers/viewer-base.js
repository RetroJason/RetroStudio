// viewer-base.js
// Base class for all resource viewers

class ViewerBase {
  constructor(path) {
    this.path = path;
    this.element = null;
    this.isDestroyed = false;
    
    this.createElement();
  }
  
  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'viewer-content';
    
    // Create body
    const body = document.createElement('div');
    body.className = 'viewer-body';
    this.createBody(body);
    
    this.element.appendChild(body);
  }

  getFileSize() {
    const bytes = this.file.size;
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  createBody(bodyContainer) {
    // Override in subclasses
    bodyContainer.innerHTML = '<p>Base viewer - override createBody() method</p>';
  }
  
  getElement() {
    return this.element;
  }
  
  // Lifecycle methods - override in subclasses
  onFocus() {
    // Called when tab becomes active
  }
  
  onBlur() {
    // Called when tab loses focus
  }
  
  destroy() {
    this.isDestroyed = true;
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

// Export for use
window.ViewerBase = ViewerBase;
