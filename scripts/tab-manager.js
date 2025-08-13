// tab-manager.js
// Unified tabbed interface manager with atomic operations

class TabManager {
  constructor() {
    this.dedicatedTabs = new Map(); // tabId -> TabInfo (renamed to avoid conflict)
    this.activeTabId = 'preview';
    this.tabBar = null;
    this.tabContentArea = null;
    this.nextTabId = 1;
    
    // Preview tab state
    this.previewPath = null;
    this.previewFileName = null;
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
    
    // Hide preview tab by default
    this._hidePreviewByDefault();
    
    // Start monitoring dirty state
    this._startDirtyStateMonitoring();
    
    console.log('[TabManager] Initialized');
  }
  
  _hidePreviewByDefault() {
    const previewTab = this.tabBar.querySelector('[data-tab-id="preview"]');
    const previewPane = this.tabContentArea.querySelector('[data-tab-id="preview"]');
    
    if (previewTab) {
      previewTab.style.display = 'none';
    }
    if (previewPane) {
      previewPane.style.display = 'none';
    }
    
    console.log('[TabManager] Preview tab hidden by default');
  }
  
  registerDefaultEditors() {
    // Get editor mappings from the global editor registry
    if (window.editorRegistry && window.editorRegistry.editors) {
      for (const [extension, editorClass] of window.editorRegistry.editors.entries()) {
        this.editorRegistry.set(extension, editorClass);
      }
      console.log('[TabManager] Registered editors for extensions:', Array.from(this.editorRegistry.keys()));
    } else {
      console.warn('[TabManager] EditorRegistry not available during initialization, will retry when needed');
    }
  }
  
  // Ensure editor registry is populated (lazy loading)
  ensureEditorsRegistered() {
    if (this.editorRegistry.size === 0 && window.editorRegistry) {
      console.log('[TabManager] Lazy loading editor registry');
      this.registerDefaultEditors();
    }
  }
  
  setupEventListeners() {
    // Subscribe to content refresh events to refresh build artifact tabs
    this.setupContentRefreshListener();
    
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
  
  setupContentRefreshListener() {
    const trySubscribe = () => {
      console.log('[TabManager] Attempting to subscribe to content.refresh.required events...');
      
      // Try global event bus first
      if (window.eventBus && window.eventBus.on) {
        window.eventBus.on('content.refresh.required', () => {
          console.log('[TabManager] Received content.refresh.required event, refreshing build artifact tabs');
          this.refreshBuildArtifactTabs();
        });
        console.log('[TabManager] Successfully subscribed to content.refresh.required via global eventBus');
        return true;
      }
      
      // Try GameEditor's event system as fallback
      if (window.gameEditor && window.gameEditor.events && window.gameEditor.events.subscribe) {
        window.gameEditor.events.subscribe('content.refresh.required', () => {
          console.log('[TabManager] Received content.refresh.required event, refreshing build artifact tabs');
          this.refreshBuildArtifactTabs();
        });
        console.log('[TabManager] Successfully subscribed to content.refresh.required via GameEditor.events');
        return true;
      }
      
      return false;
    };

    // Try immediate subscription
    if (!trySubscribe()) {
      console.log('[TabManager] Event systems not ready, retrying subscription...');
      // Retry with multiple attempts
      let attempts = 0;
      const maxAttempts = 10;
      const retryInterval = setInterval(() => {
        attempts++;
        if (trySubscribe()) {
          clearInterval(retryInterval);
        } else if (attempts >= maxAttempts) {
          clearInterval(retryInterval);
          console.warn(`[TabManager] Failed to subscribe to events after ${maxAttempts} attempts`);
        }
      }, 200);
    }
  }
  
  refreshBuildArtifactTabs() {
    console.log('[TabManager] Refreshing tabs containing build artifacts...');
    
    let refreshedCount = 0;
    
    // Check dedicated tabs
    for (const [tabId, tabInfo] of this.dedicatedTabs.entries()) {
      if (this.isBuildArtifact(tabInfo.fullPath)) {
        console.log(`[TabManager] Refreshing build artifact tab: ${tabId} (${tabInfo.fullPath})`);
        this.refreshTabViewer(tabInfo);
        refreshedCount++;
      }
    }
    
    // Check preview tab if it contains a build artifact
    if (this.previewPath && this.isBuildArtifact(this.previewPath)) {
      console.log(`[TabManager] Refreshing build artifact in preview: ${this.previewPath}`);
      this.refreshPreviewViewer();
      refreshedCount++;
    }
    
    console.log(`[TabManager] Refreshed ${refreshedCount} tabs containing build artifacts`);
  }
  
  isBuildArtifact(filePath) {
    if (!filePath) return false;
    // Check if the file path indicates it's a build artifact
    return filePath.startsWith('build/') || filePath.startsWith('Build/');
  }
  
  refreshTabViewer(tabInfo) {
    try {
      if (tabInfo.viewer && typeof tabInfo.viewer.refreshContent === 'function') {
        console.log(`[TabManager] Calling refreshContent on viewer for ${tabInfo.fullPath}`);
        tabInfo.viewer.refreshContent();
      } else {
        console.log(`[TabManager] Viewer for ${tabInfo.fullPath} does not have refreshContent method`);
      }
    } catch (error) {
      console.error(`[TabManager] Error refreshing viewer for ${tabInfo.fullPath}:`, error);
    }
  }
  
  refreshPreviewViewer() {
    try {
      if (this.previewViewer && typeof this.previewViewer.refreshContent === 'function') {
        console.log(`[TabManager] Calling refreshContent on preview viewer for ${this.previewPath}`);
        this.previewViewer.refreshContent();
      } else {
        console.log(`[TabManager] Preview viewer for ${this.previewPath} does not have refreshContent method`);
      }
    } catch (error) {
      console.error(`[TabManager] Error refreshing preview viewer for ${this.previewPath}:`, error);
    }
  }

  // MAIN PUBLIC INTERFACE - Atomic operations
  
  /**
   * Open a file in preview tab - single entry point
   * @param {string} fullPath - Full path to the resource (e.g. "Resources/Lua/script.lua")
   * @param {File} file - File object
   * @param {Object} options - { isReadOnly: boolean }
   */
  async openInPreview(fullPath, file = null, options = {}) {
    console.log(`[TabManager] openInPreview: ${fullPath}`);
    
    // Check if already open in any tab
    const existingTabId = this.findTabByPath(fullPath);
    console.log(`[TabManager] findTabByPath("${fullPath}") returned: ${existingTabId}`);
    
    if (existingTabId) {
      console.log(`[TabManager] File already open in tab ${existingTabId}, switching`);
      this.switchToTab(existingTabId);
      return existingTabId;
    }
    
    console.log(`[TabManager] File not found in existing tabs, opening in preview`);
    // Open in preview tab (file parameter is now ignored, we load from storage)
    return await this._openInPreviewTab(fullPath, null, options);
  }
  
  /**
   * Open a file in dedicated tab - single entry point  
   * @param {string} fullPath - Full path to the resource
   * @param {File} file - File object
   * @param {Object} options - { isReadOnly: boolean, forceNew: boolean }
   */
  async openInTab(fullPath, file = null, options = {}) {
    console.log(`[TabManager] openInTab: ${fullPath}`);
    
    // Check if already open in any tab (unless forcing new)
    if (!options.forceNew) {
      const existingTabId = this.findTabByPath(fullPath);
      if (existingTabId) {
        if (existingTabId === 'preview') {
          console.log(`[TabManager] File open in preview, promoting to dedicated tab`);
          // Promote preview to dedicated tab
          return await this._promotePreviewToTab();
        } else {
          console.log(`[TabManager] File already open in tab ${existingTabId}, switching`);
          this.switchToTab(existingTabId);
          return existingTabId;
        }
      }
    }
    
    // Create new dedicated tab (file parameter is now ignored, we load from storage)
    return await this._createDedicatedTab(fullPath, null, options);
  }
  
  // INTERNAL IMPLEMENTATION
  
  findTabByPath(fullPath) {
    console.log(`[TabManager] findTabByPath searching for: "${fullPath}"`);
    
    // Check preview tab
    console.log(`[TabManager] Preview tab path: "${this.previewPath}"`);
    if (this.previewPath === fullPath) {
      console.log(`[TabManager] Found in preview tab`);
      return 'preview';
    }
    
    // Check dedicated tabs
    console.log(`[TabManager] Checking ${this.dedicatedTabs.size} dedicated tabs:`);
    for (const [tabId, tabInfo] of this.dedicatedTabs.entries()) {
      console.log(`[TabManager] Tab ${tabId} path: "${tabInfo.fullPath}"`);
      if (tabInfo.fullPath === fullPath) {
        console.log(`[TabManager] Found in dedicated tab ${tabId}`);
        return tabId;
      }
    }
    
    console.log(`[TabManager] File not found in any tab`);
    return null;
  }
  
  async _openInPreviewTab(fullPath, file = null, options = {}) {
    const previewPane = this.tabContentArea.querySelector('[data-tab-id="preview"]');
    if (!previewPane) return null;
    
    // Extract filename from path
    const fileName = fullPath.split('/').pop() || fullPath.split('\\').pop();
    
    // Cleanup previous preview FIRST - before any rendering starts
    this._cleanupPreview();
    
    // Create viewer/editor (now loads from storage)
    const viewerInfo = await this._createViewer(fullPath, fileName);
    if (!viewerInfo) {
      this._hidePreviewWithAnimation();
      return null;
    }
    
    // Setup preview content BEFORE showing animation
    previewPane.innerHTML = '';
    previewPane.appendChild(viewerInfo.element);
    
    this.previewPath = fullPath;
    this.previewFileName = fileName; // Store filename instead of file object
    this.previewViewer = viewerInfo.viewer;
    this.previewReadOnly = options.isReadOnly || false;
    
    // Show preview with animation AFTER content is ready
    this._showPreviewWithAnimation();
    
    // Update preview tab title
    const previewTab = this.tabBar.querySelector('[data-tab-id="preview"]');
    if (previewTab) {
      const title = previewTab.querySelector('.tab-title');
      const readOnlyIndicator = this.previewReadOnly ? ' 🔒' : '';
      title.textContent = `Preview: ${fileName}${readOnlyIndicator}`;
    }
    
    this.switchToTab('preview');
    
    // Emit event
    document.dispatchEvent(new CustomEvent('fileOpened', {
      detail: { fullPath, type: 'preview' }
    }));
    
    return 'preview';
  }
  
  async _createDedicatedTab(fullPath, file = null, options = {}) {
    const tabId = `tab-${this.nextTabId++}`;
    
    // Extract filename from path
    const fileName = fullPath.split('/').pop() || fullPath.split('\\').pop();
    
    // Create viewer/editor (now loads from storage)
    const viewerInfo = await this._createViewer(fullPath, fileName);
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
      <span class="tab-title">${fileName}${readOnlyIndicator}</span>
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
    
    // Store tab info (file parameter is deprecated, we use storage)
    const tabInfo = {
      tabId,
      fullPath,
      fileName,
      viewer: viewerInfo.viewer,
      element: tabElement,
      pane: tabPane,
      isReadOnly: options.isReadOnly || false,
      viewerType: viewerInfo.type
    };
    
    this.dedicatedTabs.set(tabId, tabInfo);
    
    // Switch to new tab
    this.switchToTab(tabId);
    
    console.log(`[TabManager] Created tab ${tabId} for ${fullPath}`);
    return tabId;
  }
  
  async _promotePreviewToTab() {
    if (!this.previewViewer || !this.previewFileName || !this.previewPath) {
      console.warn('[TabManager] No preview content to promote');
      return null;
    }
    
    console.log(`[TabManager] Promoting preview to dedicated tab: ${this.previewPath}`);
    
    // Create new dedicated tab with a NEW viewer instance (don't move the preview viewer)
    const tabId = `tab-${this.nextTabId++}`;
    
    // Create a new viewer instance for the dedicated tab (loads from storage)
    const viewerInfo = await this._createViewer(this.previewPath, this.previewFileName);
    if (!viewerInfo) {
      console.error('[TabManager] Failed to create viewer for promoted tab');
      return null;
    }
    
    // Create tab element (copied from _createDedicatedTab)
    const tabElement = document.createElement('div');
    tabElement.className = 'tab';
    if (this.previewReadOnly) {
      tabElement.classList.add('readonly-tab');
    }
    tabElement.dataset.tabId = tabId;
    
    const readOnlyIndicator = this.previewReadOnly ? ' 🔒' : '';
    tabElement.innerHTML = `
      <span class="tab-title">${this.previewFileName}${readOnlyIndicator}</span>
      <span class="tab-close" data-action="close">×</span>
    `;
    
    // Create content pane (copied from _createDedicatedTab)
    const tabPane = document.createElement('div');
    tabPane.className = 'tab-pane';
    tabPane.dataset.tabId = tabId;
    tabPane.appendChild(viewerInfo.viewer.getElement());
    
    this.tabBar.appendChild(tabElement);
    this.tabContentArea.appendChild(tabPane);
    
    // Store tab info
    const tabInfo = {
      tabId,
      fullPath: this.previewPath,
      fileName: this.previewFileName,
      viewer: viewerInfo.viewer,
      element: tabElement,
      pane: tabPane,
      isReadOnly: this.previewReadOnly,
      viewerType: viewerInfo.type
    };
    
    this.dedicatedTabs.set(tabId, tabInfo);
    
    // Clear and hide preview since it's now been promoted
    this._clearAndHidePreview();
    
    // Switch to the new dedicated tab
    this.switchToTab(tabId);
    
    console.log(`[TabManager] Promoted preview to tab ${tabId}, preview cleared`);
    return tabId;
  }
  
  async _createViewer(fullPath, fileName = null) {
    // Ensure we have editors registered
    this.ensureEditorsRegistered();
    
    // Extract filename from path if not provided
    if (!fileName) {
      fileName = fullPath.split('/').pop() || fullPath.split('\\').pop();
    }
    
    const ext = this._getFileExtension(fileName);
    console.log(`[TabManager] Creating viewer for file: ${fileName}, extension: ${ext}, path: ${fullPath}`);
    
    // Load content using FileManager
    const fileManager = window.serviceContainer?.get('fileManager');
    if (!fileManager) {
      console.error('[TabManager] FileManager not available');
      return null;
    }
    
    const fileObj = await fileManager.loadFile(fullPath);
    if (!fileObj) {
      console.error(`[TabManager] File not found: ${fullPath}`);
      return null;
    }
    
    console.log(`[TabManager] Loaded file from storage: ${fullPath}, size: ${fileObj.size}`);
    
    // Try to use new component registry first
    if (window.serviceContainer) {
      const componentRegistry = window.serviceContainer.get('componentRegistry');
      if (componentRegistry) {
        console.log(`[TabManager] Using component registry to find editor for ${fullPath}`);
        const editorInfo = componentRegistry.getEditorForFile(fullPath);
        if (editorInfo) {
          try {
            console.log(`[TabManager] Found editor in component registry: ${editorInfo.name} (${editorInfo.editorClass.name})`);
            // Files from storage are never "new" resources unless marked as such
            const isNewResource = fileObj.isNew || false;
            console.log(`[TabManager] Creating editor with path: ${fullPath}, isNewResource: ${isNewResource}`);
            const editor = new editorInfo.editorClass(fullPath, isNewResource);
            return {
              type: 'editor',
              viewer: editor,
              element: editor.getElement()
            };
          } catch (error) {
            console.error(`[TabManager] Failed to create editor for ${fileName}:`, error);
          }
        } else {
          console.log(`[TabManager] No editor found in component registry for ${fullPath}`);
        }
      } else {
        console.log(`[TabManager] Component registry not available`);
      }
    } else {
      console.log(`[TabManager] Service container not available`);
    }
    
    // Fall back to old editor registry
    const editorClass = this.editorRegistry.get(ext);
    if (editorClass) {
      try {
        console.log(`[TabManager] Creating legacy editor for ${ext}: ${editorClass.name}`);
        const editor = new editorClass(fileObj, fullPath, fileObj.isNew || false);
        return {
          type: 'editor',
          viewer: editor,
          element: editor.getElement()
        };
      } catch (error) {
        console.error(`[TabManager] Failed to create legacy editor for ${fileName}:`, error);
      }
    } else {
      console.log(`[TabManager] No legacy editor found for ${ext}`);
    }
    
    // Fall back to viewers
    let viewerType = this._getViewerType(ext);
    const ViewerClass = window.ViewerPlugins?.[viewerType];
    
    if (!ViewerClass) {
      console.error(`[TabManager] No viewer found for ${ext}, using hex viewer`);
      viewerType = 'hex';
    }
    
    try {
      const viewer = new (window.ViewerPlugins[viewerType])(fullPath);
      return {
        type: 'viewer',
        subtype: viewerType,
        viewer: viewer,
        element: viewer.getElement()
      };
    } catch (error) {
      console.error(`[TabManager] Failed to create viewer for ${fileName}:`, error);
      return null;
    }
  }
  
  _getFileExtension(filename) {
    if (!filename) {
      console.warn('[TabManager] _getFileExtension called with undefined filename');
      return '';
    }
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
  
  // PREVIEW ANIMATION METHODS
  
  _showPreviewWithAnimation() {
    const previewTab = this.tabBar.querySelector('[data-tab-id="preview"]');
    const previewPane = this.tabContentArea.querySelector('[data-tab-id="preview"]');
    
    if (!previewTab || !previewPane) return;
    
    // Show the tab element first
    previewTab.style.display = 'block';
    
    // Ensure pane is visible but positioned off-screen initially
    previewPane.style.display = 'block';
    previewPane.style.transform = 'translateX(-100%)';
    previewPane.style.transition = 'none'; // No transition for initial setup
    
    // Force a reflow to ensure the initial state is applied
    previewPane.offsetWidth;
    
    // Now add transition and animate in
    previewPane.style.transition = 'transform 0.2s ease-out';
    
    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      previewPane.style.transform = 'translateX(0)';
    });
    
    console.log('[TabManager] Preview sliding in from left');
  }
  
  _hidePreviewWithAnimation() {
    const previewTab = this.tabBar.querySelector('[data-tab-id="preview"]');
    const previewPane = this.tabContentArea.querySelector('[data-tab-id="preview"]');
    
    if (!previewTab || !previewPane) return;
    
    // Animate out to the left
    previewPane.style.transform = 'translateX(-100%)';
    previewPane.style.transition = 'transform 0.15s ease-in';
    
    // Hide after animation completes
    setTimeout(() => {
      previewTab.style.display = 'none';
      previewPane.style.display = 'none';
      previewPane.style.transform = '';
      previewPane.style.transition = '';
    }, 150);
    
    console.log('[TabManager] Preview sliding out to left');
  }
  
  _clearAndHidePreview() {
    this._cleanupPreview();
    this._hidePreviewWithAnimation();
    console.log('[TabManager] Preview cleared and hidden');
  }
  
  _closePreviewTab() {
    console.log('[TabManager] Closing preview tab');
    
    // Clean up the preview content
    this._cleanupPreview();
    
    // Hide preview tab and pane
    this._hidePreviewWithAnimation();
    
    // Reset preview tab to default state
    this._resetPreviewTab();
    
    console.log('[TabManager] Preview tab closed');
  }

  _cleanupPreview() {
    console.log('[TabManager] Cleaning up preview tab');
    
    // Stop any focus events from firing during cleanup
    const oldViewer = this.previewViewer;
    
    // Clear state FIRST to prevent any callbacks
    this.previewPath = null;
    this.previewFileName = null;
    this.previewViewer = null;
    this.previewReadOnly = false;
    
    // Now cleanup the old viewer safely
    if (oldViewer && typeof oldViewer.cleanup === 'function') {
      console.log('[TabManager] Calling cleanup on preview viewer');
      try {
        oldViewer.cleanup();
      } catch (error) {
        console.error('[TabManager] Error during viewer cleanup:', error);
      }
    }
    
    // Clear preview pane content completely
    const previewPane = this.tabContentArea.querySelector('[data-tab-id="preview"]');
    if (previewPane) {
      console.log('[TabManager] Clearing preview pane HTML content');
      // Force removal of all child elements to prevent any DOM leakage
      while (previewPane.firstChild) {
        previewPane.removeChild(previewPane.firstChild);
      }
      previewPane.innerHTML = '';
    }
    
    console.log('[TabManager] Preview state reset');
  }
  
  // TAB MANAGEMENT
  
  switchToTab(tabId) {
    if (this.activeTabId === tabId) {
      console.log(`[TabManager] Already on tab ${tabId}, ignoring switch`);
      return;
    }
    
    console.log(`[TabManager] Switching from ${this.activeTabId} to ${tabId}`);
    
    // Store previous tab for proper cleanup
    const previousTabId = this.activeTabId;
    
    // Special behavior: If switching away from preview tab, close it automatically
    if (previousTabId === 'preview' && tabId !== 'preview') {
      console.log('[TabManager] Switching away from preview tab - auto-closing preview');
      this._closePreviewTab();
    }
    
    // Cleanup current tab FIRST
    this._notifyTabBlur(previousTabId);
    
    // Deactivate current tab elements
    const currentTab = this.tabBar.querySelector(`[data-tab-id="${previousTabId}"]`);
    const currentPane = this.tabContentArea.querySelector(`[data-tab-id="${previousTabId}"]`);
    if (currentTab) {
      currentTab.classList.remove('active');
      console.log(`[TabManager] Deactivated tab element for ${previousTabId}`);
    }
    if (currentPane) {
      currentPane.classList.remove('active');
      console.log(`[TabManager] Deactivated pane element for ${previousTabId}`);
    }
    
    // Update active tab ID BEFORE activating new tab
    this.activeTabId = tabId;
    
    // Activate new tab elements
    const newTab = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
    const newPane = this.tabContentArea.querySelector(`[data-tab-id="${tabId}"]`);
    if (newTab) {
      newTab.classList.add('active');
      console.log(`[TabManager] Activated tab element for ${tabId}`);
    }
    if (newPane) {
      newPane.classList.add('active');
      console.log(`[TabManager] Activated pane element for ${tabId}`);
    } else {
      console.warn(`[TabManager] No pane found for tab ${tabId}`);
    }
    
    console.log(`[TabManager] Active tab ID set to ${tabId}`);
    
    // Notify new tab AFTER everything is set up
    this._notifyTabFocus(tabId);
    
    // Fire event
    this._fireEvent('tabSwitched', { tabId, tabInfo: this.getActiveTab() });
  }
  
  closeTab(tabId) {
    if (tabId === 'preview') {
      // Allow closing preview tab explicitly
      this._closePreviewTab();
      
      // If no dedicated tabs exist, set activeTabId to null
      if (this.dedicatedTabs.size === 0) {
        this.activeTabId = null;
      } else {
        // Switch to the first available dedicated tab
        const firstTabId = this.dedicatedTabs.keys().next().value;
        this.switchToTab(firstTabId);
      }
      return;
    }
    
    const tabInfo = this.dedicatedTabs.get(tabId);
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
    this.dedicatedTabs.delete(tabId);
    
    // Switch to preview if this was active, but only if preview has content
    if (this.activeTabId === tabId) {
      if (this.previewPath && this.previewFileName) {
        this.switchToTab('preview');
      } else {
        // No preview content, hide preview tab
        this._hidePreviewWithAnimation();
        this.activeTabId = null;
      }
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
    let fullPath = null;
    
    if (tabId === 'preview') {
      viewer = this.previewViewer;
      fullPath = this.previewPath;
    } else {
      const tabInfo = this.dedicatedTabs.get(tabId);
      viewer = tabInfo?.viewer;
      fullPath = tabInfo?.fullPath;
    }
    
    if (viewer && typeof viewer.onFocus === 'function') {
      viewer.onFocus();
    }
    
    // Notify project explorer with full path
    if (fullPath && window.projectExplorer && typeof window.projectExplorer.highlightActiveFile === 'function') {
      window.projectExplorer.highlightActiveFile(fullPath);
    }
  }
  
  _notifyTabBlur(tabId) {
    let viewer = null;
    
    if (tabId === 'preview') {
      viewer = this.previewViewer;
    } else {
      const tabInfo = this.dedicatedTabs.get(tabId);
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
        fileName: this.previewFileName,
        viewer: this.previewViewer,
        isReadOnly: this.previewReadOnly
      };
    }
    
    return this.dedicatedTabs.get(this.activeTabId) || null;
  }
  
  getAllTabs() {
    const allTabs = [];
    
    if (this.previewPath) {
      allTabs.push({
        tabId: 'preview',
        fullPath: this.previewPath,
        fileName: this.previewFileName,
        viewer: this.previewViewer,
        isReadOnly: this.previewReadOnly
      });
    }
    
    for (const tabInfo of this.dedicatedTabs.values()) {
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
  
  // Update tab file reference after saving (legacy compatibility - mainly for file content updates)
  updateTabFile(viewer, newFile) {
    console.log(`[TabManager] updateTabFile called - updating file content only`);
    
    // Find tab by viewer
    for (const [tabId, tabInfo] of this.dedicatedTabs.entries()) {
      if (tabInfo.viewer === viewer) {
        tabInfo.file = newFile;
        console.log(`[TabManager] Updated file reference for tab ${tabId}: ${newFile.name}`);
        return;
      }
    }
    
    // Check preview tab
    if (this.previewViewer === viewer) {
      // For storage-first approach, we don't store File objects
      // The filename will be updated when the tab is refreshed from storage
      console.log(`[TabManager] Preview viewer updated, file changes will be reflected from storage`);
    }
  }
  
  // Update file references when a file is renamed in the project explorer
  updateFileReference(oldPath, newPath, newFileName) {
    console.log(`[TabManager] Updating file references: ${oldPath} → ${newPath}`);
    
    // Update dedicated tabs
    for (const [tabId, tabInfo] of this.dedicatedTabs.entries()) {
      if (tabInfo.fullPath === oldPath) {
        // Update the tab info
        tabInfo.fullPath = newPath;
        
        // Update filename (no longer storing File objects)
        if (newFileName) {
          tabInfo.fileName = newFileName;
        }
        
        // Update tab title
        const tabElement = tabInfo.element;
        if (tabElement) {
          const titleElement = tabElement.querySelector('.tab-title');
          if (titleElement && newFileName) {
            const readOnlyIndicator = tabInfo.isReadOnly ? ' 🔒' : '';
            titleElement.textContent = newFileName + readOnlyIndicator;
          }
        }
        
        // Notify the viewer of the path change if it supports it
        if (tabInfo.viewer && typeof tabInfo.viewer.updateFilePath === 'function') {
          tabInfo.viewer.updateFilePath(newPath, newFileName);
        }
        
        console.log(`[TabManager] Updated tab ${tabId} path: ${oldPath} → ${newPath}`);
        
        // If this is the active tab, update project explorer highlighting
        if (this.activeTabId === tabId) {
          this._notifyTabFocus(tabId);
        }
      }
    }
    
    // Update preview tab
    if (this.previewPath === oldPath) {
      this.previewPath = newPath;
      
      if (newFileName) {
        this.previewFileName = newFileName;
      }
      
      // Update preview tab title
      const previewTab = this.tabBar.querySelector('[data-tab-id="preview"]');
      if (previewTab && newFileName) {
        const titleElement = previewTab.querySelector('.tab-title');
        if (titleElement) {
          const readOnlyIndicator = this.previewReadOnly ? ' 🔒' : '';
          titleElement.textContent = `Preview: ${newFileName}${readOnlyIndicator}`;
        }
      }
      
      // Notify the viewer of the path change if it supports it
      if (this.previewViewer && typeof this.previewViewer.updateFilePath === 'function') {
        this.previewViewer.updateFilePath(newPath, newFileName);
      }
      
      console.log(`[TabManager] Updated preview tab path: ${oldPath} → ${newPath}`);
      
      // If preview is active, update project explorer highlighting
      if (this.activeTabId === 'preview') {
        this._notifyTabFocus('preview');
      }
    }
  }
  
  // DIRTY STATE TRACKING
  
  markTabDirty(tabId) {
    const tabElement = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabElement && !tabElement.classList.contains('dirty')) {
      console.log(`[TabManager] Marking tab ${tabId} as dirty`);
      tabElement.classList.add('dirty');
    }
  }
  
  markTabClean(tabId) {
    const tabElement = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabElement && tabElement.classList.contains('dirty')) {
      console.log(`[TabManager] Marking tab ${tabId} as clean`);
      tabElement.classList.remove('dirty');
    }
  }
  
  updateTabDirtyState(viewer) {
    // Find the tab that contains this viewer
    let tabId = null;
    
    // Check dedicated tabs
    for (const [id, tabInfo] of this.dedicatedTabs.entries()) {
      if (tabInfo.viewer === viewer) {
        tabId = id;
        break;
      }
    }
    
    // Check preview tab
    if (!tabId && this.previewViewer === viewer) {
      tabId = 'preview';
    }
    
    if (tabId) {
      if (typeof viewer.isModified === 'function' && viewer.isModified()) {
        this.markTabDirty(tabId);
      } else {
        this.markTabClean(tabId);
      }
    }
  }
  
  // PUBLIC METHODS for editors to call
  notifyContentChanged(viewer) {
    this.updateTabDirtyState(viewer);
  }
  
  notifyContentSaved(viewer) {
    // Find the tab that contains this viewer and mark it clean
    let tabId = null;
    
    // Check dedicated tabs
    for (const [id, tabInfo] of this.dedicatedTabs.entries()) {
      if (tabInfo.viewer === viewer) {
        tabId = id;
        break;
      }
    }
    
    // Check preview tab
    if (!tabId && this.previewViewer === viewer) {
      tabId = 'preview';
    }
    
    if (tabId) {
      this.markTabClean(tabId);
    }
  }
  
  // TEST METHOD - can be called from console to test dirty state
  testDirtyState() {
    console.log('[TabManager] Testing dirty state...');
    
    // Mark active tab as dirty
    if (this.activeTabId) {
      this.markTabDirty(this.activeTabId);
      console.log(`[TabManager] Marked ${this.activeTabId} as dirty`);
      
      // Clean it after 3 seconds
      setTimeout(() => {
        this.markTabClean(this.activeTabId);
        console.log(`[TabManager] Marked ${this.activeTabId} as clean`);
      }, 3000);
    }
  }
  
  // Periodic check for dirty state changes
  _startDirtyStateMonitoring() {
    if (this._dirtyStateInterval) {
      clearInterval(this._dirtyStateInterval);
    }
    
    this._dirtyStateInterval = setInterval(() => {
      // Check all tabs for dirty state changes
      if (this.previewViewer) {
        this.updateTabDirtyState(this.previewViewer);
      }
      
      for (const [tabId, tabInfo] of this.dedicatedTabs.entries()) {
        if (tabInfo.viewer) {
          this.updateTabDirtyState(tabInfo.viewer);
        }
      }
    }, 1000); // Check every second
  }
  
  _stopDirtyStateMonitoring() {
    if (this._dirtyStateInterval) {
      clearInterval(this._dirtyStateInterval);
      this._dirtyStateInterval = null;
    }
  }
  
  // SAVE OPERATIONS
  
  getUnsavedTabs() {
    const unsavedTabs = [];
    
    // Check preview tab
    if (this.previewViewer && typeof this.previewViewer.isModified === 'function' && this.previewViewer.isModified()) {
      unsavedTabs.push({
        id: 'preview',
        name: 'Preview',
        viewer: this.previewViewer
      });
    }
    
    // Check all dedicated tabs
    for (const [tabId, tabInfo] of this.dedicatedTabs.entries()) {
      if (tabInfo.viewer && typeof tabInfo.viewer.isModified === 'function' && tabInfo.viewer.isModified()) {
        unsavedTabs.push({
          id: tabId,
          name: tabInfo.name || tabId,
          viewer: tabInfo.viewer
        });
      }
    }
    
    return unsavedTabs;
  }

  async saveAllOpenTabs() {
    console.log('[TabManager] Saving all open tabs...');
    const savePromises = [];
    let savedCount = 0;
    
    // Save preview tab if it has content and is modified
    if (this.previewViewer && typeof this.previewViewer.save === 'function') {
      if (typeof this.previewViewer.isModified === 'function' && this.previewViewer.isModified()) {
        console.log('[TabManager] Saving preview tab...');
        savePromises.push(
          this.previewViewer.save().then(() => {
            savedCount++;
            this.markTabClean('preview'); // Clear dirty state
            console.log('[TabManager] Preview tab saved');
          }).catch(error => {
            console.error('[TabManager] Failed to save preview tab:', error);
            throw error;
          })
        );
      }
    }
    
    // Save all dedicated tabs
    for (const [tabId, tabInfo] of this.dedicatedTabs.entries()) {
      if (tabInfo.viewer && typeof tabInfo.viewer.save === 'function') {
        if (typeof tabInfo.viewer.isModified === 'function' && tabInfo.viewer.isModified()) {
          console.log(`[TabManager] Saving tab ${tabId}...`);
          savePromises.push(
            tabInfo.viewer.save().then(() => {
              savedCount++;
              this.markTabClean(tabId); // Clear dirty state
              console.log(`[TabManager] Tab ${tabId} saved`);
            }).catch(error => {
              console.error(`[TabManager] Failed to save tab ${tabId}:`, error);
              throw error;
            })
          );
        }
      }
    }
    
    // Wait for all saves to complete
    if (savePromises.length > 0) {
      await Promise.all(savePromises);
      console.log(`[TabManager] Successfully saved ${savedCount} tabs`);
    } else {
      console.log('[TabManager] No modified tabs to save');
    }
    
    return savedCount;
  }

  // BUILD FILES MANAGEMENT
  
  async refreshBuildTabs(buildFiles) {
    console.log('[TabManager] refreshBuildTabs called - delegating to refreshBuildArtifactTabs');
    
    // Log the build files for reference
    if (buildFiles && Array.isArray(buildFiles)) {
      console.log('[TabManager] Build files received:', buildFiles.map(f => f.path || f.name));
    }
    
    // Use the new centralized refresh mechanism
    this.refreshBuildArtifactTabs();
  }

  // Legacy property accessors
  get tabs() {
    // Convert to legacy format for compatibility
    const legacyTabs = new Map();
    
    // Add preview tab if active
    if (this.previewPath) {
      const previewTabData = {
        viewer: this.previewViewer,
        fileName: this.previewFileName,
        filePath: this.previewPath,
        filename: this.previewFileName,
        isReadOnly: this.previewReadOnly
      };
      legacyTabs.set('preview', previewTabData);
    }
    
    // Add dedicated tabs
    for (const [tabId, tabInfo] of this.dedicatedTabs.entries()) {
      const legacyTabData = {
        viewer: tabInfo.viewer,
        fileName: tabInfo.fileName,
        filePath: tabInfo.fullPath,
        filename: tabInfo.fileName,
        isReadOnly: tabInfo.isReadOnly
      };
      legacyTabs.set(tabId, legacyTabData);
    }
    
    return legacyTabs;
  }

  // Helper method to determine if file content is default/new
  _isDefaultContent(file, editorInfo) {
    if (!file || file.size === 0) return true;
    
    // Check if the editor has a createNew method and compare content
    if (editorInfo.editorClass.createNew) {
      try {
        const defaultContent = editorInfo.editorClass.createNew();
        // For binary files or when we can't compare, assume it's new if very small
        return file.size <= (defaultContent ? defaultContent.length + 50 : 100);
      } catch (e) {
        return file.size < 100; // Fallback for small files
      }
    }
    
    return file.size < 100; // Default assumption for small files
  }
  
  closeAllTabs() {
    console.log('[TabManager] Closing all tabs...');
    
    // Close all dedicated tabs
    const tabIds = Array.from(this.dedicatedTabs.keys());
    for (const tabId of tabIds) {
      this.closeTab(tabId);
    }
    
    // Close preview tab
    this.closePreviewTab();
    
    console.log('[TabManager] All tabs closed');
  }
}

// Export for use
window.TabManager = TabManager;
