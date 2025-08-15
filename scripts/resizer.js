// resizer.js
// Handles resizable panels in the editor layout

class PanelResizer {
  constructor() {
    this.isResizing = false;
    this.startX = 0;
    this.startWidth = 0;
    this.minWidth = 200;
    this.maxWidth = 500;
    
    this.initialize();
  }
  
  initialize() {
    const resizer = document.getElementById('resizer');
    const projectExplorer = document.getElementById('projectExplorer');
    
    if (!resizer || !projectExplorer) {
      console.error('[PanelResizer] Required elements not found');
      return;
    }
    
    this.resizer = resizer;
    this.projectExplorer = projectExplorer;
    
    this.setupEventListeners();
    
    console.log('[PanelResizer] Initialized');
  }
  
  setupEventListeners() {
    // Mouse events for desktop
    this.resizer.addEventListener('mousedown', (e) => {
      this.startResize(e);
    });
    
    document.addEventListener('mousemove', (e) => {
      this.handleResize(e);
    });
    
    document.addEventListener('mouseup', () => {
      this.stopResize();
    });
    
    // Touch events for mobile/tablet
    this.resizer.addEventListener('touchstart', (e) => {
      this.startResize(e.touches[0]);
    });
    
    document.addEventListener('touchmove', (e) => {
      if (this.isResizing) {
        e.preventDefault();
        this.handleResize(e.touches[0]);
      }
    });
    
    document.addEventListener('touchend', () => {
      this.stopResize();
    });
  }
  
  startResize(event) {
    this.isResizing = true;
    this.startX = event.clientX;
    this.startWidth = parseInt(window.getComputedStyle(this.projectExplorer).width, 10);
    
    // Add visual feedback
    this.resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    
    console.log(`[PanelResizer] Started resize from width: ${this.startWidth}px`);
  }
  
  handleResize(event) {
    if (!this.isResizing) return;
    
    const deltaX = event.clientX - this.startX;
    let newWidth = this.startWidth + deltaX;
    
    // Enforce min/max constraints
    newWidth = Math.max(this.minWidth, Math.min(this.maxWidth, newWidth));
    
    // Apply the new width
    this.projectExplorer.style.width = `${newWidth}px`;

  // Notify listeners that layout width changed (throttled to animation frame)
  this._scheduleResizeEvent();

  // Emit a custom event with the live width so editors can resize precisely
  this._emitResized(newWidth);
  }
  
  stopResize() {
    if (!this.isResizing) return;
    
    this.isResizing = false;
    
    // Remove visual feedback
    this.resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    
    const finalWidth = parseInt(window.getComputedStyle(this.projectExplorer).width, 10);
    console.log(`[PanelResizer] Finished resize at width: ${finalWidth}px`);
    
    // Save the width preference to localStorage
    this.saveWidthPreference(finalWidth);

  // Fire a final resize notification after drag ends
  try { window.dispatchEvent(new Event('resize')); } catch (_) {}

  // Emit final width via custom event
  this._emitResized(finalWidth);
  }
  
  saveWidthPreference(width) {
    try {
      localStorage.setItem('project-explorer-width', width.toString());
      console.log(`[PanelResizer] Saved width preference: ${width}px`);
    } catch (error) {
      console.warn('[PanelResizer] Could not save width preference:', error);
    }
  }
  
  loadWidthPreference() {
    try {
      const savedWidth = localStorage.getItem('project-explorer-width');
      if (savedWidth) {
        const width = parseInt(savedWidth, 10);
        if (width >= this.minWidth && width <= this.maxWidth) {
          this.projectExplorer.style.width = `${width}px`;
          console.log(`[PanelResizer] Loaded width preference: ${width}px`);
          return true;
        }
      }
    } catch (error) {
      console.warn('[PanelResizer] Could not load width preference:', error);
    }
    return false;
  }
  
  // Public API
  setWidth(width) {
    const constrainedWidth = Math.max(this.minWidth, Math.min(this.maxWidth, width));
    this.projectExplorer.style.width = `${constrainedWidth}px`;
    this.saveWidthPreference(constrainedWidth);
  }
  
  getWidth() {
    return parseInt(window.getComputedStyle(this.projectExplorer).width, 10);
  }
  
  resetToDefault() {
    this.setWidth(300); // Default width
  }

  _scheduleResizeEvent() {
    if (this._resizeScheduled) return;
    this._resizeScheduled = true;
    requestAnimationFrame(() => {
      this._resizeScheduled = false;
      try { window.dispatchEvent(new Event('resize')); } catch (_) {}
    });
  }

  _emitResized(width) {
    try {
      const evt = new CustomEvent('project-explorer.resized', { detail: { width } });
      window.dispatchEvent(evt);
    } catch (_) {
      // Fallback if CustomEvent unsupported (very old browsers)
      try { window.dispatchEvent(new Event('project-explorer.resized')); } catch (__) {}
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.panelResizer = new PanelResizer();
  
  // Load saved width preference after a short delay to ensure layout is ready
  setTimeout(() => {
    window.panelResizer.loadWidthPreference();
  }, 100);
});

// Export for use
window.PanelResizer = PanelResizer;
