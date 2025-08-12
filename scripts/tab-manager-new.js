// tab-manager.js
// Unified tabbed interface manager with atomic operations

class TabManager {
  constructor() {
    this.tabs = new Map(); // tabId -> TabInfo
    this.activeTabId = 'preview';
    this.tabBar = null;
    this.tabContentArea = null;
    this.nextTabId = 1;
    
    // Preview tab state
    this.previewPath = null;
    this.previewFile = null;
    this.previewViewer = null;
    this.previewReadOnly = false;
    
    // Event system
    this.eventListeners = {
      tabSwitched: [],
      tabClosed: [],
      tabRenamed: []
    };
    
    // File extension to editor mapping
    this.editorRegistry = new Map();
    
    this.initialize();
  }
  
  initialize() {
    this.tabBar = document.getElementById('tabBar');
    this.tabContentArea = document.getElementById('tabContentArea');
    
    if (!this.tabBar || !this.tabContentArea) {
      console.error('[TabManager] Required elements not found');
      return;
    }
    
    this.setupEventListeners();
    this.registerDefaultEditors();
    console.log('[TabManager] Initialized');
  }
  
  registerDefaultEditors() {
    // Get editor mappings from the global editor registry
    if (window.editorRegistry && window.editorRegistry.editors) {
      for (const [extension, editorInfo] of window.editorRegistry.editors.entries()) {
        this.editorRegistry.set(extension, editorInfo.editorClass);
      }
      console.log('[TabManager] Registered editors for extensions:', Array.from(this.editorRegistry.keys()));
    }
  }
  
  setupEventListeners() {
    // Tab clicking
    this.tabBar.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      
      const action = e.target.dataset.action;
      const tabId = tab.dataset.tabId;
      
      if (action === 'close' && tabId !== 'preview') {
        e.stopPropagation();
        this.closeTab(tabId);
      } else {
        this.switchToTab(tabId);
      }
    });
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        const tabs = Array.from(this.tabBar.querySelectorAll('.tab'));
        if (tabs[index]) {
          this.switchToTab(tabs[index].dataset.tabId);
        }
      } else if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        if (this.activeTabId !== 'preview') {
          this.closeTab(this.activeTabId);
        }
      }
    });
  }
  
  // MAIN PUBLIC INTERFACE - Atomic operations
  
  /**
   * Open a file in preview tab - single entry point
   * @param {string} fullPath - Full path to the resource (e.g. "Resources/Lua/script.lua")
   * @param {File} file - File object
   * @param {Object} options - { isReadOnly: boolean }
   */
  async openInPreview(fullPath, file, options = {}) {
    console.log(`[TabManager] openInPreview: ${fullPath}`);
    
    // Check if already open in any tab
    const existingTabId = this.findTabByPath(fullPath);
    if (existingTabId) {
      console.log(`[TabManager] File already open in tab ${existingTabId}, switching`);
      this.switchToTab(existingTabId);
      return existingTabId;
    }
    
    // Open in preview tab
    return await this._openInPreviewTab(fullPath, file, options);
  }
  
  /**
   * Open a file in dedicated tab - single entry point  
   * @param {string} fullPath - Full path to the resource
   * @param {File} file - File object
   * @param {Object} options - { isReadOnly: boolean, forceNew: boolean }
   */
  async openInTab(fullPath, file, options = {}) {
    console.log(`[TabManager] openInTab: ${fullPath}`);
    
    // Check if already open in any tab (unless forcing new)
    if (!options.forceNew) {
      const existingTabId = this.findTabByPath(fullPath);
      if (existingTabId) {
        console.log(`[TabManager] File already open in tab ${existingTabId}, switching`);
        this.switchToTab(existingTabId);
        return existingTabId;
      }
    }
    
    // Create new dedicated tab
    return await this._createDedicatedTab(fullPath, file, options);
  }
  
  // INTERNAL IMPLEMENTATION
  
  findTabByPath(fullPath) {
    // Check preview tab
    if (this.previewPath === fullPath) {
      return 'preview';
    }
    
    // Check dedicated tabs
    for (const [tabId, tabInfo] of this.tabs.entries()) {
      if (tabInfo.fullPath === fullPath) {
        return tabId;
      }
    }
    
    return null;
  }
  
  async _openInPreviewTab(fullPath, file, options = {}) {
    const previewPane = this.tabContentArea.querySelector('[data-tab-id="preview"]');
    if (!previewPane) return null;
    
    // Cleanup previous preview
    this._cleanupPreview();
    
    // Create viewer/editor
    const viewerInfo = await this._createViewer(fullPath, file);
    if (!viewerInfo) return null;
    
    // Setup preview
    previewPane.innerHTML = '';
    previewPane.appendChild(viewerInfo.element);
    
    this.previewPath = fullPath;
    this.previewFile = file;
    this.previewViewer = viewerInfo.viewer;
    this.previewReadOnly = options.isReadOnly || false;
    
    // Update preview tab title
    const previewTab = this.tabBar.querySelector('[data-tab-id="preview"]');
    if (previewTab) {
      const title = previewTab.querySelector('.tab-title');
      title.textContent = `Preview: ${file.name}`;
    }
    
    this.switchToTab('preview');
    return 'preview';
  }
  
  async _createDedicatedTab(fullPath, file, options = {}) {
    const tabId = `tab-${this.nextTabId++}`;
    
    // Create viewer/editor
    const viewerInfo = await this._createViewer(fullPath, file);
    if (!viewerInfo) return null;
    
    // Create tab element
    const tabElement = document.createElement('div');
    tabElement.className = 'tab';
    if (options.isReadOnly) {
      tabElement.classList.add('readonly-tab');
    }
    tabElement.dataset.tabId = tabId;
    
    const readOnlyIndicator = options.isReadOnly ? ' 🔒' : '';
    tabElement.innerHTML = `
      <span class="tab-title">${file.name}${readOnlyIndicator}</span>
      <span class="tab-close" data-action="close">×</span>
    `;
    
    // Create content pane
    const tabPane = document.createElement('div');
    tabPane.className = 'tab-pane';
    tabPane.dataset.tabId = tabId;
    tabPane.appendChild(viewerInfo.element);
    
    // Add to DOM
    this.tabBar.appendChild(tabElement);
    this.tabContentArea.appendChild(tabPane);
    
    // Store tab info
    const tabInfo = {
      tabId,
      fullPath,
      file,
      viewer: viewerInfo.viewer,
      element: tabElement,
      pane: tabPane,
      isReadOnly: options.isReadOnly || false,
      viewerType: viewerInfo.type
    };
    
    this.tabs.set(tabId, tabInfo);
    
    // Switch to new tab
    this.switchToTab(tabId);
    
    console.log(`[TabManager] Created tab ${tabId} for ${fullPath}`);
    return tabId;
  }
  
  async _createViewer(fullPath, file) {
    const ext = this._getFileExtension(file.name);
    
    // Try to create editor first
    const editorClass = this.editorRegistry.get(ext);
    if (editorClass) {
      try {
        console.log(`[TabManager] Creating editor for ${ext}: ${editorClass.name}`);
        const editor = new editorClass(file, fullPath, false);
        return {
          type: 'editor',
          viewer: editor,
          element: editor.getElement()
        };
      } catch (error) {
        console.error(`[TabManager] Failed to create editor for ${file.name}:`, error);
      }
    }
    
    // Fall back to viewers
    let viewerType = this._getViewerType(ext);
    const ViewerClass = window.ViewerPlugins?.[viewerType];
    
    if (!ViewerClass) {
      console.error(`[TabManager] No viewer found for ${ext}, using hex viewer`);
      viewerType = 'hex';
    }
    
    try {
      const viewer = new (window.ViewerPlugins[viewerType])(file, fullPath);
      return {
        type: 'viewer',
        subtype: viewerType,
        viewer: viewer,
        element: viewer.getElement()
      };
    } catch (error) {
      console.error(`[TabManager] Failed to create viewer for ${file.name}:`, error);
      return null;
    }
  }
  
  _getFileExtension(filename) {
    return filename.substring(filename.lastIndexOf('.')).toLowerCase();
  }
  
  _getViewerType(ext) {
    if (['.mod', '.xm', '.s3m', '.it', '.mptm'].includes(ext)) {
      return 'mod';
    } else if (['.wav'].includes(ext)) {
      return 'wav';
    } else {
      return 'hex';
    }
  }
  
  _cleanupPreview() {
    if (this.previewViewer && typeof this.previewViewer.cleanup === 'function') {
      this.previewViewer.cleanup();
    }
    
    this.previewPath = null;
    this.previewFile = null;
    this.previewViewer = null;
    this.previewReadOnly = false;
  }
  
  // TAB MANAGEMENT
  
  switchToTab(tabId) {
    if (this.activeTabId === tabId) return;
    
    console.log(`[TabManager] Switching from ${this.activeTabId} to ${tabId}`);
    
    // Cleanup current tab
    this._notifyTabBlur(this.activeTabId);
    
    // Deactivate current
    const currentTab = this.tabBar.querySelector(`[data-tab-id="${this.activeTabId}"]`);
    const currentPane = this.tabContentArea.querySelector(`[data-tab-id="${this.activeTabId}"]`);
    if (currentTab) currentTab.classList.remove('active');
    if (currentPane) currentPane.classList.remove('active');
    
    // Activate new
    const newTab = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
    const newPane = this.tabContentArea.querySelector(`[data-tab-id="${tabId}"]`);
    if (newTab) newTab.classList.add('active');
    if (newPane) newPane.classList.add('active');
    
    this.activeTabId = tabId;
    
    // Notify new tab
    this._notifyTabFocus(tabId);
    
    // Fire event
    this._fireEvent('tabSwitched', { tabId, tabInfo: this.getActiveTab() });
  }
  
  closeTab(tabId) {
    if (tabId === 'preview') return; // Can't close preview
    
    const tabInfo = this.tabs.get(tabId);
    if (!tabInfo) return;
    
    // Check if can close
    if (tabInfo.viewer && typeof tabInfo.viewer.canClose === 'function') {
      if (!tabInfo.viewer.canClose()) {
        return; // User cancelled
      }
    }
    
    // Cleanup
    if (tabInfo.viewer && typeof tabInfo.viewer.cleanup === 'function') {
      tabInfo.viewer.cleanup();
    }
    
    // Remove DOM
    if (tabInfo.element) tabInfo.element.remove();
    if (tabInfo.pane) tabInfo.pane.remove();
    
    // Remove from map
    this.tabs.delete(tabId);
    
    // Switch to preview if this was active
    if (this.activeTabId === tabId) {
      this.switchToTab('preview');
      this._resetPreviewTab();
    }
    
    // Fire event
    this._fireEvent('tabClosed', { tabId, tabInfo });
    
    console.log(`[TabManager] Closed tab ${tabId}`);
  }
  
  _resetPreviewTab() {
    const previewTab = this.tabBar.querySelector('[data-tab-id="preview"]');
    if (previewTab) {
      const title = previewTab.querySelector('.tab-title');
      title.textContent = 'Preview';
    }
    
    const previewPane = this.tabContentArea.querySelector('[data-tab-id="preview"]');
    if (previewPane) {
      previewPane.innerHTML = `
        <div class="preview-pane">
          <div class="preview-header">
            <h3>Welcome to Game Engine Editor</h3>
            <p>Select a resource from the Project Explorer to preview it here, or double-click to open in a new tab.</p>
          </div>
        </div>
      `;
    }
    
    this._cleanupPreview();
  }
  
  _notifyTabFocus(tabId) {
    let viewer = null;
    let filename = null;
    
    if (tabId === 'preview') {
      viewer = this.previewViewer;
      filename = this.previewFile?.name;
    } else {
      const tabInfo = this.tabs.get(tabId);
      viewer = tabInfo?.viewer;
      filename = tabInfo?.file?.name;
    }
    
    if (viewer && typeof viewer.onFocus === 'function') {
      viewer.onFocus();
    }
    
    // Notify project explorer
    if (filename && window.projectExplorer && typeof window.projectExplorer.highlightActiveFile === 'function') {
      window.projectExplorer.highlightActiveFile(filename);
    }
  }
  
  _notifyTabBlur(tabId) {
    let viewer = null;
    
    if (tabId === 'preview') {
      viewer = this.previewViewer;
    } else {
      const tabInfo = this.tabs.get(tabId);
      viewer = tabInfo?.viewer;
    }
    
    if (viewer) {
      if (typeof viewer.loseFocus === 'function') {
        viewer.loseFocus();
      } else if (typeof viewer.onBlur === 'function') {
        viewer.onBlur();
      }
    }
  }
  
  // PUBLIC API
  
  getActiveTab() {
    if (this.activeTabId === 'preview') {
      return {
        tabId: 'preview',
        fullPath: this.previewPath,
        file: this.previewFile,
        viewer: this.previewViewer,
        isReadOnly: this.previewReadOnly
      };
    }
    
    return this.tabs.get(this.activeTabId) || null;
  }
  
  getAllTabs() {
    const allTabs = [];
    
    if (this.previewPath) {
      allTabs.push({
        tabId: 'preview',
        fullPath: this.previewPath,
        file: this.previewFile,
        viewer: this.previewViewer,
        isReadOnly: this.previewReadOnly
      });
    }
    
    for (const tabInfo of this.tabs.values()) {
      allTabs.push(tabInfo);
    }
    
    return allTabs;
  }
  
  // EVENT SYSTEM
  
  addEventListener(event, callback) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].push(callback);
    }
  }
  
  removeEventListener(event, callback) {
    if (this.eventListeners[event]) {
      const index = this.eventListeners[event].indexOf(callback);
      if (index > -1) {
        this.eventListeners[event].splice(index, 1);
      }
    }
  }
  
  _fireEvent(event, data) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[TabManager] Error in event listener for ${event}:`, error);
        }
      });
    }
  }
  
  // LEGACY COMPATIBILITY (to be removed)
  
  async createNewResource(editorClass) {
    try {
      const editor = await window.editorRegistry.createNewResource(editorClass);
      if (!editor) return;
      
      // Create initial tab with temporary path
      const tabId = await this._createDedicatedTab(editor.file.name, editor.file, { isEditor: true });
      const tabInfo = this.tabs.get(tabId);
      tabInfo.viewer = editor;
      
      // Auto-save and update path
      if (editor.isNewResource && editor.save) {
        await editor.save();
        
        // Update tab path after save
        if (editor.path) {
          tabInfo.fullPath = editor.path;
          console.log(`[TabManager] Updated tab ${tabId} path to: ${editor.path}`);
        }
      }
      
      return tabId;
    } catch (error) {
      console.error('[TabManager] Failed to create new resource:', error);
    }
  }
  
  // Legacy methods for compatibility
  async openFile(file, path, options = {}) {
    if (options.preferPreview) {
      return this.openInPreview(path, file, options);
    } else {
      return this.openInTab(path, file, options);
    }
  }
  
  previewResource(file, path) {
    return this.openInPreview(path, file);
  }
  
  showInPreview(file, path, isReadOnly = false) {
    return this.openInPreview(path, file, { isReadOnly });
  }
  
  openInNewTab(file, path, isReadOnly = false) {
    return this.openInTab(path, file, { isReadOnly });
  }
}

// Export for use
window.TabManager = TabManager;
