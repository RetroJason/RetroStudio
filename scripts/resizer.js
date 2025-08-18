// resizer.js
// Handles resizable panels in the editor layout

class PanelResizer {
  constructor() {
    this.isResizing = false;
    this.startX = 0;
    this.startWidth = 0;
    this.minWidth = 32; // Width when collapsed (enough for toggle button + padding)
    this.minExpandedWidth = 150; // Minimum when expanded (reduced from 200)
    this.maxWidth = 600; // Increased max width
    this.defaultWidth = 300;
    this.isCollapsed = false;
    this.lastExpandedWidth = this.defaultWidth;
    
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
    
    // Ensure we start in expanded state
    this.isCollapsed = false;
    this.projectExplorer.classList.remove('collapsed');
    this.resizer.classList.remove('collapsed-mode');
    
    this.setupEventListeners();
    this.addCollapseButton();
    this.addStyles();
    
    console.log('[PanelResizer] Initialized with enhanced collapse functionality - starting expanded');
  }
  
  addCollapseButton() {
    const explorerHeader = this.projectExplorer.querySelector('.explorer-header');
    if (!explorerHeader) return;
    
    // Create toggle button
    const toggleButton = document.createElement('button');
    toggleButton.className = 'explorer-toggle-btn';
    toggleButton.innerHTML = '◀';
    toggleButton.title = 'Collapse Project Explorer';
    
    // Add button to header
    explorerHeader.appendChild(toggleButton);
    
    // Add click handler
    toggleButton.addEventListener('click', () => {
      this.toggle();
    });
    
    this.toggleButton = toggleButton;
  }
  
  addStyles() {
    if (document.querySelector('#panel-resizer-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'panel-resizer-styles';
    style.textContent = `
      .explorer-header {
        position: relative;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 15px;
      }
      
      .explorer-toggle-btn {
        background: #3c3c3c;
        border: none;
        color: #cccccc;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        flex-shrink: 0;
      }
      
      .explorer-toggle-btn:hover {
        background: #0078d4;
        color: white;
      }
      
      .project-explorer {
        transition: width 0.3s ease;
        overflow: hidden;
        min-width: 32px !important; /* Override CSS file constraint */
      }
      
      .project-explorer.collapsed {
        width: 32px !important;
        min-width: 32px !important;
        max-width: 32px !important;
        flex-shrink: 0 !important;
      }
      
      .project-explorer.collapsed .explorer-header h3,
      .project-explorer.collapsed .explorer-tree {
        opacity: 0;
        pointer-events: none;
        width: 0;
        overflow: hidden;
        margin: 0;
        padding: 0;
      }
      
      .project-explorer.collapsed .explorer-header {
        padding: 0;
        justify-content: flex-start;
        position: relative;
        width: 100%;
        display: flex;
        align-items: center;
      }
      
      .project-explorer.collapsed .explorer-toggle-btn {
        margin: 4px;
        position: relative;
        flex-shrink: 0;
      }
        width: 24px;
        overflow: visible;
      }
      
      .project-explorer.collapsed .explorer-toggle-btn {
        position: static;
        margin: 10px 0;
        width: 24px;
        height: 32px;
        border-radius: 0 4px 4px 0;
        background: #0078d4;
        transform: none;
      }
      
      .resizer.collapsed-mode {
        opacity: 0.3;
        pointer-events: none;
      }
    `;
    
    document.head.appendChild(style);
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
    
    console.log(`[PanelResizer] Started resize from width: ${this.startWidth}px (collapsed: ${this.isCollapsed})`);
  }
  
  handleResize(event) {
    if (!this.isResizing) return;
    
    const deltaX = event.clientX - this.startX;
    let newWidth = this.startWidth + deltaX;
    
    // Enhanced width constraints based on current state
    if (this.isCollapsed) {
      // When collapsed, only allow expanding past threshold
      if (newWidth > this.minWidth + 20) { // Small buffer to prevent accidental expand
        this.expand();
        newWidth = Math.max(this.minExpandedWidth, newWidth);
      } else {
        newWidth = this.minWidth;
      }
    } else {
      // When expanded, allow resizing down to collapsed width
      if (newWidth < this.minWidth) {
        this.collapse();
        return;
      }
      // Allow resizing between minWidth and maxWidth when expanded
      newWidth = Math.max(this.minWidth, Math.min(this.maxWidth, newWidth));
    }
    
    // Apply the new width
    this.projectExplorer.style.width = `${newWidth}px`;

    // Notify listeners that layout width changed (throttled to animation frame)
    this._scheduleResizeEvent();

    // Emit a custom event with the live width so editors can resize precisely
    this._emitResized(newWidth);
  }
  
  collapse() {
    if (this.isCollapsed) return;
    
    // Save current width before collapsing
    this.lastExpandedWidth = parseInt(window.getComputedStyle(this.projectExplorer).width, 10);
    
    this.isCollapsed = true;
    this.projectExplorer.classList.add('collapsed');
    this.resizer.classList.add('collapsed-mode');
    
    // Update button if it exists
    if (this.toggleButton) {
      this.toggleButton.innerHTML = '▶';
      this.toggleButton.title = 'Expand Project Explorer';
    }
    
    // Force width to collapsed size and trigger layout recalculation
    this.projectExplorer.style.width = `${this.minWidth}px`;
    this.projectExplorer.style.minWidth = `${this.minWidth}px`;
    this.projectExplorer.style.maxWidth = `${this.minWidth}px`;
    
    // Force immediate layout recalculation
    setTimeout(() => {
      this._scheduleResizeEvent();
    }, 50); // Small delay to let CSS transition start
    
    this.saveCollapseState(true);
    this._emitResized(this.minWidth);
    
    console.log('[PanelResizer] Collapsed project explorer');
  }
  
  expand(targetWidth = null) {
    if (!this.isCollapsed) return;
    
    this.isCollapsed = false;
    this.projectExplorer.classList.remove('collapsed');
    this.resizer.classList.remove('collapsed-mode');
    
    // Update button if it exists
    if (this.toggleButton) {
      this.toggleButton.innerHTML = '◀';
      this.toggleButton.title = 'Collapse Project Explorer';
    }
    
    // Restore to last expanded width or use target
    const newWidth = targetWidth || this.lastExpandedWidth;
    this.projectExplorer.style.width = `${newWidth}px`;
    this.projectExplorer.style.minWidth = `${this.minExpandedWidth}px`;
    this.projectExplorer.style.maxWidth = `${this.maxWidth}px`;
    
    // Force immediate layout recalculation
    setTimeout(() => {
      this._scheduleResizeEvent();
    }, 50); // Small delay to let CSS transition start
    
    this.saveCollapseState(false);
    this._emitResized(newWidth);
    
    console.log(`[PanelResizer] Expanded project explorer to ${newWidth}px`);
  }
  
  toggle() {
    if (this.isCollapsed) {
      this.expand();
    } else {
      this.collapse();
    }
  }
  
  stopResize() {
    if (!this.isResizing) return;
    
    this.isResizing = false;
    
    // Remove visual feedback
    this.resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    
    const finalWidth = parseInt(window.getComputedStyle(this.projectExplorer).width, 10);
    console.log(`[PanelResizer] Finished resize at width: ${finalWidth}px (collapsed: ${this.isCollapsed})`);
    
    // Save the width preference (only if not collapsed)
    if (!this.isCollapsed) {
      this.saveWidthPreference(finalWidth);
      this.lastExpandedWidth = finalWidth;
    }

    // Fire a final resize notification after drag ends
    try { window.dispatchEvent(new Event('resize')); } catch (_) {}

    // Emit final width via custom event
    this._emitResized(finalWidth);
  }
  
  saveWidthPreference(width) {
    try {
      // Only save width if we're not collapsed
      if (!this.isCollapsed) {
        localStorage.setItem('project-explorer-width', width.toString());
        console.log(`[PanelResizer] Saved width preference: ${width}px`);
      }
    } catch (error) {
      console.warn('[PanelResizer] Could not save width preference:', error);
    }
  }
  
  saveCollapseState(collapsed) {
    try {
      localStorage.setItem('project-explorer-collapsed', collapsed.toString());
      console.log(`[PanelResizer] Saved collapse state: ${collapsed}`);
    } catch (error) {
      console.warn('[PanelResizer] Could not save collapse state:', error);
    }
  }
  
  loadWidthPreference() {
    try {
      console.log('[PanelResizer] Loading preferences...');
      
      // Ensure we start expanded by default
      this.isCollapsed = false;
      this.projectExplorer.classList.remove('collapsed');
      this.resizer.classList.remove('collapsed-mode');
      
      // Load normal width first
      const savedWidth = localStorage.getItem('project-explorer-width');
      if (savedWidth) {
        const width = parseInt(savedWidth, 10);
        if (width >= this.minExpandedWidth && width <= this.maxWidth) {
          this.projectExplorer.style.width = `${width}px`;
          this.lastExpandedWidth = width;
          console.log(`[PanelResizer] Loaded width preference: ${width}px`);
        }
      } else {
        // Set default width if no preference saved
        this.projectExplorer.style.width = `${this.defaultWidth}px`;
        this.lastExpandedWidth = this.defaultWidth;
        console.log(`[PanelResizer] Using default width: ${this.defaultWidth}px`);
      }
      
      // TEMPORARY: Skip collapse state loading to always start expanded
      // This can be removed later once we verify it works
      console.log('[PanelResizer] Staying expanded (ignoring saved collapse state for now)');
      
      // Uncomment these lines later to restore collapse state loading:
      /*
      const savedCollapsed = localStorage.getItem('project-explorer-collapsed');
      console.log(`[PanelResizer] Saved collapse state: ${savedCollapsed}`);
      
      if (savedCollapsed === 'true') {
        console.log('[PanelResizer] Will collapse after delay...');
        setTimeout(() => {
          if (this.toggleButton) {
            this.collapse();
          } else {
            console.warn('[PanelResizer] Toggle button not ready, staying expanded');
          }
        }, 200);
        return true;
      } else {
        console.log('[PanelResizer] Staying expanded (default or saved preference)');
      }
      */
      
    } catch (error) {
      console.warn('[PanelResizer] Could not load preferences:', error);
    }
    return false;
  }
  
  // Public API
  setWidth(width) {
    if (this.isCollapsed) {
      // If collapsed, save this as the target expansion width
      this.lastExpandedWidth = Math.max(this.minExpandedWidth, Math.min(this.maxWidth, width));
      this.saveWidthPreference(this.lastExpandedWidth);
    } else {
      // If expanded, apply immediately
      const constrainedWidth = Math.max(this.minExpandedWidth, Math.min(this.maxWidth, width));
      this.projectExplorer.style.width = `${constrainedWidth}px`;
      this.lastExpandedWidth = constrainedWidth;
      this.saveWidthPreference(constrainedWidth);
    }
  }
  
  getWidth() {
    return parseInt(window.getComputedStyle(this.projectExplorer).width, 10);
  }
  
  getEffectiveWidth() {
    // Returns the width that would be used if expanded
    return this.isCollapsed ? this.lastExpandedWidth : this.getWidth();
  }
  
  resetToDefault() {
    if (this.isCollapsed) {
      this.expand(this.defaultWidth);
    } else {
      this.setWidth(this.defaultWidth);
    }
  }
  
  // New public methods for collapse functionality
  isCollapsedState() {
    return this.isCollapsed;
  }
  
  forceCollapse() {
    this.collapse();
  }
  
  forceExpand(width = null) {
    this.expand(width);
  }
  
  // Clear saved preferences and reset to defaults
  resetPreferences() {
    try {
      localStorage.removeItem('project-explorer-width');
      localStorage.removeItem('project-explorer-collapsed');
      console.log('[PanelResizer] Cleared saved preferences');
      
      // Reset to defaults
      this.lastExpandedWidth = this.defaultWidth;
      if (this.isCollapsed) {
        this.expand(this.defaultWidth);
      } else {
        this.setWidth(this.defaultWidth);
      }
    } catch (error) {
      console.warn('[PanelResizer] Could not clear preferences:', error);
    }
  }

  // Convenient static method to call from console
  static clearAllPreferences() {
    if (window.panelResizer) {
      window.panelResizer.resetPreferences();
      console.log('✅ Preferences cleared! Reload page to see defaults.');
    } else {
      console.warn('❌ PanelResizer not initialized yet');
    }
  }
  
  // Debug method to check current state
  debugState() {
    console.log('[PanelResizer] Debug State:');
    console.log('- isCollapsed:', this.isCollapsed);
    console.log('- Current width:', this.getWidth());
    console.log('- Last expanded width:', this.lastExpandedWidth);
    console.log('- Has collapsed class:', this.projectExplorer.classList.contains('collapsed'));
    console.log('- Computed width:', window.getComputedStyle(this.projectExplorer).width);
    console.log('- Toggle button exists:', !!this.toggleButton);
    console.log('- LocalStorage collapsed:', localStorage.getItem('project-explorer-collapsed'));
    console.log('- LocalStorage width:', localStorage.getItem('project-explorer-width'));
  }

  _scheduleResizeEvent() {
    if (this._resizeScheduled) return;
    this._resizeScheduled = true;
    requestAnimationFrame(() => {
      this._resizeScheduled = false;
      // Force layout recalculation
      this.projectExplorer.offsetWidth; // Trigger reflow
      try { 
        window.dispatchEvent(new Event('resize')); 
      } catch (_) {}
      
      // Also notify main content areas that layout changed
      const mainContent = document.querySelector('.main-content');
      if (mainContent) {
        mainContent.dispatchEvent(new CustomEvent('layout-changed', {
          detail: { 
            explorerWidth: this.getWidth(),
            isCollapsed: this.isCollapsed 
          }
        }));
      }
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
  console.log('[PanelResizer] DOM ready, initializing...');
  window.panelResizer = new PanelResizer();
  
  // Load saved width preference after a short delay to ensure layout is ready
  setTimeout(() => {
    console.log('[PanelResizer] Loading preferences after delay...');
    window.panelResizer.loadWidthPreference();
  }, 150);
});

// Export for use
window.PanelResizer = PanelResizer;
