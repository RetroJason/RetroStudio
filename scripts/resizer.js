// resizer.js
// Handles resizable panels in the editor layout - supports both left and right panels

class PanelResizer {
  constructor() {
    this.panels = new Map(); // Store multiple panel configurations
    this.initialize();
  }
  
  initialize() {
    // Initialize left panel (project explorer)
    this.initializePanel({
      id: 'projectExplorer',
      panelId: 'projectExplorer',
      resizerId: 'resizer',
      side: 'left',
      minWidth: 32,
      minExpandedWidth: 150,
      maxWidth: 600,
      defaultWidth: 300,
      headerSelector: '.explorer-header'
    });
    
    // Initialize right panel (game engine)
    this.initializePanel({
      id: 'gameEngine',
      panelId: 'gameEnginePanel',
      resizerId: 'gameEngineResizer',
      side: 'right',
      minWidth: 32,
      minExpandedWidth: 300,
      maxWidth: 800,
      defaultWidth: 400,
      headerSelector: '.game-engine-header'
    });
    
    console.log('[PanelResizer] Initialized with support for left and right panels');
  }
  
  // Initialize a panel with resizing and collapse functionality
  initializePanel(config) {
    const panel = document.getElementById(config.panelId);
    const resizer = document.getElementById(config.resizerId);
    
    if (!panel || !resizer) {
      console.error(`[PanelResizer] Panel elements not found for ${config.id}:`, {
        panel: !!panel,
        resizer: !!resizer
      });
      return false;
    }
    
    const panelState = {
      ...config,
      panel: panel,
      resizer: resizer,
      isResizing: false,
      startX: 0,
      startWidth: 0,
      isCollapsed: false,
      lastExpandedWidth: config.defaultWidth,
      toggleButton: null
    };
    
    this.panels.set(config.id, panelState);
    
    // Ensure panel starts in expanded state
    panel.classList.remove('collapsed');
    resizer.classList.remove('collapsed-mode');
    
    this.setupEventListeners(panelState);
    this.addCollapseButton(panelState);
    this.addStyles();
    
    console.log(`[PanelResizer] Initialized ${config.side} panel: ${config.id}`);
    return true;
  }
  
  // Add collapse/expand toggle button to panel header
  addCollapseButton(panelState) {
    const header = panelState.panel.querySelector(panelState.headerSelector);
    if (!header) {
      console.warn(`[PanelResizer] Header not found for ${panelState.id} with selector: ${panelState.headerSelector}`);
      return;
    }
    
    // Create toggle button
    const toggleButton = document.createElement('button');
    toggleButton.className = `panel-toggle-btn ${panelState.id}-toggle-btn`;
    
    // Set button direction based on panel side
    if (panelState.side === 'left') {
      toggleButton.innerHTML = '◀';
      toggleButton.title = `Collapse ${panelState.id}`;
    } else {
      toggleButton.innerHTML = '▶';
      toggleButton.title = `Collapse ${panelState.id}`;
    }
    
    // Add button to header - CSS will handle positioning
    header.appendChild(toggleButton);
    
    // Ensure header has proper styling for collapsed state
    header.style.position = 'relative';
    
    panelState.toggleButton = toggleButton;
    
    // Add click handler
    toggleButton.addEventListener('click', () => this.toggle(panelState.id));
  }

  // Add styles for panel resizing and collapsing
  addStyles() {
    if (document.querySelector('#panel-resizer-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'panel-resizer-styles';
    style.textContent = `
      .panel-toggle-btn {
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
        margin-left: 8px;
      }
      
      .panel-toggle-btn:hover {
        background: #404040;
        color: #ffffff;
      }
      
      .project-explorer.collapsed,
      .game-engine-panel.collapsed {
        width: 32px !important;
        min-width: 32px !important;
        overflow: hidden;
      }
      
      .project-explorer.collapsed .explorer-tree,
      .project-explorer.collapsed h3,
      .game-engine-panel.collapsed .game-engine-tabs,
      .game-engine-panel.collapsed .game-engine-content {
        display: none;
      }
      
      .project-explorer.collapsed .explorer-header,
      .game-engine-panel.collapsed .game-engine-header {
        padding: 0 !important;
        margin: 0 !important;
        width: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .project-explorer .explorer-header,
      .game-engine-panel .game-engine-header {
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      
      .project-explorer .explorer-header h3,
      .project-explorer .explorer-header .header-title,
      .game-engine-panel .game-engine-header h3,
      .game-engine-panel .game-engine-header .header-title {
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        min-width: 0 !important;
        flex-shrink: 1 !important;
      }
      
      .project-explorer.collapsed .panel-toggle-btn,
      .game-engine-panel.collapsed .panel-toggle-btn {
        margin: 0 !important;
        position: relative;
        left: 0 !important;
        right: 0 !important;
      }
      
      .resizer.collapsed-mode,
      .game-engine-resizer.collapsed-mode {
        background: #3c3c3c;
        opacity: 0.5;
      }
      
      .resizer,
      .game-engine-resizer {
        width: 4px;
        background: #2d2d30;
        cursor: ew-resize;
        transition: background 0.2s ease;
        position: relative;
      }
      
      .resizer:hover,
      .game-engine-resizer:hover {
        background: #0078d4;
      }
      
      .resizer-handle {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 2px;
        height: 20px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        align-items: center;
        justify-content: center;
      }
      
      .resizer-line {
        width: 2px;
        height: 4px;
        background: #666666;
        border-radius: 1px;
      }
    `;
    
    document.head.appendChild(style);
  }

  // Set up event listeners for a panel
  setupEventListeners(panelState) {
    // Mouse events for resizing
    panelState.resizer.addEventListener('mousedown', (e) => this.startResize(e, panelState.id));
    document.addEventListener('mousemove', (e) => this.handleResize(e, panelState.id));
    document.addEventListener('mouseup', () => this.stopResize(panelState.id));
    
    // Prevent text selection during resize
    panelState.resizer.addEventListener('selectstart', (e) => e.preventDefault());
    
    // Handle double-click to toggle
    panelState.resizer.addEventListener('dblclick', () => this.toggle(panelState.id));
  }

  // Start resizing a panel
  startResize(event, panelId) {
    const panelState = this.panels.get(panelId);
    if (!panelState) return;
    
    panelState.isResizing = true;
    panelState.startX = event.clientX;
    panelState.startWidth = parseInt(window.getComputedStyle(panelState.panel).width, 10);
    
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    
    console.log(`[PanelResizer] Started resize for ${panelId} from width: ${panelState.startWidth}px`);
  }
  
  // Handle resizing a panel
  handleResize(event, panelId) {
    const panelState = this.panels.get(panelId);
    if (!panelState || !panelState.isResizing) return;
    
    let deltaX = event.clientX - panelState.startX;
    
    // Reverse delta for right-side panels
    if (panelState.side === 'right') {
      deltaX = -deltaX;
    }
    
    let newWidth = panelState.startWidth + deltaX;
    
    // Enhanced width constraints with hysteresis
    const collapseThreshold = panelState.minExpandedWidth * 0.6; // 90px - collapse threshold
    const expandThreshold = collapseThreshold + 20; // 110px - expand threshold (hysteresis)
    
    if (panelState.isCollapsed) {
      // When collapsed, only allow expanding past the higher threshold
      if (newWidth > expandThreshold) {
        this.expand(panelId);
        newWidth = Math.max(panelState.minExpandedWidth, newWidth);
      } else {
        newWidth = panelState.minWidth;
      }
    } else {
      // When expanded, check for auto-collapse at the lower threshold
      if (newWidth < collapseThreshold) {
        this.collapse(panelId);
        return;
      }
      
      // Allow resizing down to the collapse threshold, not the expand threshold
      newWidth = Math.max(collapseThreshold, Math.min(panelState.maxWidth, newWidth));
    }
    
    // Apply the new width
    panelState.panel.style.width = `${newWidth}px`;

    // Emit resize event
    this._emitResized(panelId, newWidth);
  }
  
  // Collapse a panel
  collapse(panelId) {
    const panelState = this.panels.get(panelId);
    if (!panelState || panelState.isCollapsed) return;
    
    // Save current width before collapsing
    panelState.lastExpandedWidth = parseInt(window.getComputedStyle(panelState.panel).width, 10);
    
    panelState.isCollapsed = true;
    panelState.panel.classList.add('collapsed');
    panelState.resizer.classList.add('collapsed-mode');
    
    // Update button if it exists
    if (panelState.toggleButton) {
      if (panelState.side === 'left') {
        panelState.toggleButton.innerHTML = '▶';
        panelState.toggleButton.title = `Expand ${panelState.id}`;
      } else {
        panelState.toggleButton.innerHTML = '◀';
        panelState.toggleButton.title = `Expand ${panelState.id}`;
      }
    }
    
    // Set collapsed width
    panelState.panel.style.width = `${panelState.minWidth}px`;
    
    this.saveCollapseState(panelId, true);
    this._emitResized(panelId, panelState.minWidth);
    
    console.log(`[PanelResizer] Collapsed ${panelId} panel`);
  }

  // Expand a panel
  expand(panelId, targetWidth = null) {
    const panelState = this.panels.get(panelId);
    if (!panelState || !panelState.isCollapsed) return;
    
    panelState.isCollapsed = false;
    panelState.panel.classList.remove('collapsed');
    panelState.resizer.classList.remove('collapsed-mode');
    
    // Update button if it exists
    if (panelState.toggleButton) {
      if (panelState.side === 'left') {
        panelState.toggleButton.innerHTML = '◀';
        panelState.toggleButton.title = `Collapse ${panelState.id}`;
      } else {
        panelState.toggleButton.innerHTML = '▶';
        panelState.toggleButton.title = `Collapse ${panelState.id}`;
      }
    }
    
    // Restore previous width or use target width
    const newWidth = targetWidth || panelState.lastExpandedWidth;
    panelState.panel.style.width = `${newWidth}px`;
    
    this.saveCollapseState(panelId, false);
    this._emitResized(panelId, newWidth);
    
    console.log(`[PanelResizer] Expanded ${panelId} panel to ${newWidth}px`);
  }

  // Toggle collapse/expand state
  toggle(panelId) {
    const panelState = this.panels.get(panelId);
    if (!panelState) return;
    
    if (panelState.isCollapsed) {
      this.expand(panelId);
    } else {
      this.collapse(panelId);
    }
  }

  // Stop resizing
  stopResize(panelId) {
    const panelState = this.panels.get(panelId);
    if (panelState) {
      panelState.isResizing = false;
    }
    
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  // Add a right panel (like game emulator)
  addRightPanel(config) {
    return this.initializePanel({
      ...config,
      side: 'right'
    });
  }

  // Add a game engine panel specifically
  addGameEnginePanel() {
    const panel = document.querySelector('.game-engine-panel');
    const resizer = document.querySelector('.game-engine-resizer');
    
    if (!panel || !resizer) {
      console.warn('[PanelResizer] Game engine panel or resizer not found, will retry when created');
      return false;
    }
    
    return this.initializePanel({
      id: 'gameEngine',
      panelId: 'game-engine-panel',
      resizerId: 'game-engine-resizer',
      side: 'right',
      minWidth: 32,
      minExpandedWidth: 300,
      maxWidth: 800,
      defaultWidth: 400,
      headerSelector: '.game-engine-header'
    });
  }

  // Remove a panel
  removePanel(panelId) {
    const panelState = this.panels.get(panelId);
    if (panelState && panelState.toggleButton) {
      panelState.toggleButton.remove();
    }
    this.panels.delete(panelId);
  }

  // Get panel state
  getPanelState(panelId) {
    return this.panels.get(panelId);
  }

  // Check if panel is collapsed
  isCollapsed(panelId) {
    const panelState = this.panels.get(panelId);
    return panelState ? panelState.isCollapsed : false;
  }

  // Public API methods for external use
  collapsePanel(panelId) {
    this.collapse(panelId);
  }

  expandPanel(panelId) {
    this.expand(panelId);
  }

  togglePanel(panelId) {
    this.toggle(panelId);
  }

  // Utility methods
  _emitResized(panelId, width) {
    window.dispatchEvent(new CustomEvent('panelResized', {
      detail: { panelId, width }
    }));
  }

  saveCollapseState(panelId, collapsed) {
    try {
      localStorage.setItem(`panel-${panelId}-collapsed`, collapsed.toString());
    } catch (e) {
      console.warn('[PanelResizer] Could not save collapse state:', e);
    }
  }

  loadCollapseState(panelId) {
    try {
      const saved = localStorage.getItem(`panel-${panelId}-collapsed`);
      return saved === 'true';
    } catch (e) {
      console.warn('[PanelResizer] Could not load collapse state:', e);
      return false;
    }
  }
}

// Initialize the panel resizer when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.panelResizer = new PanelResizer();
});
