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
    
    // Setup event-driven dirty state tracking
    this._setupEventListeners();
  }
  
  _hidePreviewByDefault() {
    // Don't hide preview by default anymore - instead show welcome message
    // Only hide preview when there are actually dedicated tabs open
    const hasDedicatedTabs = this.dedicatedTabs.size > 0;
    
    if (hasDedicatedTabs) {
      const previewTab = this.tabBar.querySelector('[data-tab-id="preview"]');
      const previewPane = this.tabContentArea.querySelector('[data-tab-id="preview"]');
      
      if (previewTab) {
        previewTab.style.display = 'none';
      }
      if (previewPane) {
        previewPane.style.display = 'none';
      }
    } else {
      // Show welcome preview when no dedicated tabs exist
      this._showWelcomePreview();
    }
  }

  _ensurePreviewTabExists() {
    // Check if preview tab elements exist
    let previewTab = this.tabBar.querySelector('[data-tab-id="preview"]');
    let previewPane = this.tabContentArea.querySelector('[data-tab-id="preview"]');
    
    // Create preview tab if it doesn't exist
    if (!previewTab) {
      previewTab = document.createElement('div');
      previewTab.className = 'tab preview-tab';
      previewTab.dataset.tabId = 'preview';
      previewTab.style.display = 'none'; // Hidden by default
      previewTab.innerHTML = `
        <span class="tab-title">Preview</span>
      `;
      // Insert at the beginning of the tab bar (leftmost position)
      this.tabBar.insertBefore(previewTab, this.tabBar.firstChild);
    }
    
    // Create preview pane if it doesn't exist
    if (!previewPane) {
      previewPane = document.createElement('div');
      previewPane.className = 'tab-pane';
      previewPane.dataset.tabId = 'preview';
      previewPane.style.display = 'none'; // Hidden by default
      // Append to content area first
      this.tabContentArea.appendChild(previewPane);
    }
    
    return { previewTab, previewPane };
  }
  
  registerDefaultEditors() {
    // Get editor mappings from the global editor registry
    if (window.editorRegistry && window.editorRegistry.editors) {
      for (const [extension, editorClass] of window.editorRegistry.editors.entries()) {
        this.editorRegistry.set(extension, editorClass);
      }
    } else {
      console.warn('[TabManager] EditorRegistry not available during initialization, will retry when needed');
    }
  }
  
  // Ensure editor registry is populated (lazy loading)
  ensureEditorsRegistered() {
    if (this.editorRegistry.size === 0 && window.editorRegistry) {
      this.registerDefaultEditors();
    }
  }
  
  setupEventListeners() {
    // Subscribe to content refresh events to refresh build artifact tabs
    this.setupContentRefreshListener();
  // Subscribe to file deletion events to close affected tabs
  this.setupFileDeletionListener();
    
    // Tab clicking
    this.tabBar.addEventListener('click', async (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      
      const action = e.target.dataset.action;
      const tabId = tab.dataset.tabId;
      
      if (action === 'close' && tabId !== 'preview') {
        e.stopPropagation();
        
        // Check if tab still exists before attempting to close
        if (tabId !== 'preview' && !this.dedicatedTabs.has(tabId)) {
          console.warn(`[TabManager] Ignoring close click for non-existent tab: ${tabId}`);
          return;
        }
        
        try {
          await this.closeTab(tabId);
        } catch (error) {
          console.error(`[TabManager] Error during tab close for ${tabId}:`, error);
        }
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
      
      // Try global event bus first
      if (window.eventBus && window.eventBus.on) {
        window.eventBus.on('content.refresh.required', () => {
          this.refreshAllTabs();
        });
        return true;
      }
      
      // Try GameEmulator's event system as fallback
      if (window.gameEmulator && window.gameEmulator.events && window.gameEmulator.events.subscribe) {
        window.gameEmulator.events.subscribe('content.refresh.required', () => {
          this.refreshAllTabs();
        });
        return true;
      }
      
      return false;
    };

    // Try immediate subscription
    if (!trySubscribe()) {
      
      // Listen for global eventBus ready event
      const eventBusHandler = () => {
        if (trySubscribe()) {
          document.removeEventListener('eventBusReady', eventBusHandler);
        }
      };
      document.addEventListener('eventBusReady', eventBusHandler);
      
      // Also listen for gameEmulator ready event
      const gameEmulatorHandler = () => {
        if (trySubscribe()) {
          document.removeEventListener('gameEmulatorReady', gameEmulatorHandler);
        }
      };
      document.addEventListener('gameEmulatorReady', gameEmulatorHandler);
      
      // Fallback timeout in case events don't fire
      setTimeout(() => {
        if (!trySubscribe()) {
          console.warn('[TabManager] Failed to subscribe to events after timeout');
        }
        document.removeEventListener('eventBusReady', eventBusHandler);
        document.removeEventListener('gameEmulatorReady', gameEmulatorHandler);
      }, 2000);
    }
  }

  setupFileDeletionListener() {
    const subscribe = () => {
      if (window.eventBus && typeof window.eventBus.on === 'function') {
        window.eventBus.on('file.deleted', async ({ path, isFolder, deletedPaths }) => {
          try {
            const paths = Array.isArray(deletedPaths) && deletedPaths.length ? deletedPaths : [path];
            const normalize = (p) => {
              if (typeof p !== 'string') return p;
              if (window.ProjectPaths && typeof window.ProjectPaths.normalizeStoragePath === 'function') {
                return window.ProjectPaths.normalizeStoragePath(p);
              }
              return p.replace(/^Build\//, 'build/');
            };
            const deletedSet = new Set(paths.map(normalize));
            const folderPrefix = isFolder && typeof path === 'string' ? normalize(path) + '/' : null;

            // Close preview if it matches
            const previewNorm = this.previewPath ? normalize(this.previewPath) : null;
            if (previewNorm && (deletedSet.has(previewNorm) || (folderPrefix && previewNorm.startsWith(folderPrefix)))) {
              this._closePreviewTab();
            }

            // Close any dedicated tabs that match
            const toClose = [];
            for (const [tabId, tabInfo] of this.dedicatedTabs.entries()) {
              const tp = tabInfo.fullPath;
              const tpNorm = tp ? normalize(tp) : null;
              if (!tp) continue;
              if (deletedSet.has(tpNorm) || (folderPrefix && tpNorm.startsWith(folderPrefix))) {
                toClose.push(tabId);
              }
            }
            toClose.forEach(id => {
              this.closeTab(id);
            });
          } catch (e) {
            console.warn('[TabManager] Error handling file.deleted:', e);
          }
        });
        return true;
      }
      return false;
    };

    if (!subscribe()) {
      
      // Listen for eventBus ready event
      const eventBusHandler = () => {
        if (subscribe()) {
          document.removeEventListener('eventBusReady', eventBusHandler);
        }
      };
      document.addEventListener('eventBusReady', eventBusHandler);
      
      // Fallback timeout
      setTimeout(() => {
        if (!subscribe()) {
          console.warn('[TabManager] Failed to subscribe to file.deleted events after timeout');
        }
        document.removeEventListener('eventBusReady', eventBusHandler);
      }, 2000);
    }
  }
  
  async refreshBuildArtifactTabs() {

    let refreshedCount = 0;
    let closedCount = 0;

    // Dedicated tabs: close if artifact removed; else reload
    const reloads = [];
    for (const [tabId, tabInfo] of this.dedicatedTabs.entries()) {
      const path = tabInfo.fullPath;
      if (this.isBuildArtifact(path)) {
        const exists = await this._fileExists(path);
        if (!exists) {
          this.closeTab(tabId);
          closedCount++;
          continue;
        }

        // Try reload; if it fails or returns false, close the tab
        reloads.push(
          (async () => {
            try {
              const res = await this.refreshTabViewer(tabInfo);
              // If viewer reports failure explicitly
              if (res === false) {
                this.closeTab(tabId);
                closedCount++;
                return false;
              }
              refreshedCount++;
              return true;
            } catch (err) {
              console.warn(`[TabManager] Reload error for ${path}; closing tab ${tabId}`, err);
              this.closeTab(tabId);
              closedCount++;
              return false;
            }
          })()
        );
      }
    }
    await Promise.allSettled(reloads);

    // Preview: close if artifact removed; else reload
    if (this.previewPath && this.isBuildArtifact(this.previewPath)) {
      const exists = await this._fileExists(this.previewPath);
      if (!exists) {
        this._closePreviewTab();
      } else {
        try {
          const res = await this.refreshPreviewViewer();
          if (res === false) {
            this._closePreviewTab();
            closedCount++;
          } else {
            refreshedCount++;
          }
        } catch (e) {
          console.warn('[TabManager] Preview reload error; closing preview', e);
          this._closePreviewTab();
          closedCount++;
        }
      }
    }
  }
  
  isBuildArtifact(filePath) {
    if (!filePath) return false;
    // Use centralized classification
    if (window.ProjectPaths && typeof window.ProjectPaths.isBuildArtifact === 'function') {
      return window.ProjectPaths.isBuildArtifact(filePath);
    }
  return filePath.startsWith('build/') || filePath.startsWith('Build/');
  }
  
  refreshTabViewer(tabInfo) {
    try {
      if (tabInfo.viewer) {
        if (typeof tabInfo.viewer.reload === 'function') {
          return tabInfo.viewer.reload();
        } else if (typeof tabInfo.viewer.refreshContent === 'function') {
          return tabInfo.viewer.refreshContent();
        }
      }
    } catch (error) {
      console.error(`[TabManager] Error refreshing viewer for ${tabInfo.fullPath}:`, error);
    }
  }
  
  refreshPreviewViewer() {
    try {
      if (this.previewViewer) {
        if (typeof this.previewViewer.reload === 'function') {
          return this.previewViewer.reload();
        } else if (typeof this.previewViewer.refreshContent === 'function') {
          return this.previewViewer.refreshContent();
        }
      }
    } catch (error) {
      console.error(`[TabManager] Error refreshing preview viewer for ${this.previewPath}:`, error);
    }
  }

  async refreshAllTabs() {
    
    let refreshedCount = 0;
    
    // Refresh all dedicated tabs
    const refreshPromises = [];
    for (const [tabId, tabInfo] of this.dedicatedTabs.entries()) {
      refreshPromises.push(
        (async () => {
          try {
            await this.refreshTabViewer(tabInfo);
            refreshedCount++;
            return true;
          } catch (error) {
            console.error(`[TabManager] Error refreshing tab ${tabId}:`, error);
            return false;
          }
        })()
      );
    }
    
    // Refresh preview tab if it exists
    if (this.previewPath && this.previewViewer) {
      refreshPromises.push(
        (async () => {
          try {
            await this.refreshPreviewViewer();
            refreshedCount++;
            return true;
          } catch (error) {
            console.error(`[TabManager] Error refreshing preview tab:`, error);
            return false;
          }
        })()
      );
    }
    
    await Promise.allSettled(refreshPromises);
  }

  async _fileExists(fullPath) {
    if (!fullPath) return false;
    try {
      // Safe-get FileManager without throwing if not registered yet
      let fm = null;
      try { fm = window.serviceContainer?.get('fileManager'); } catch (_) { /* not registered yet */ }
      fm = fm || window.FileManager || window.fileManager;
      if (!fm || typeof fm.loadFile !== 'function') return true; // assume exists if we can't check
      // Normalize build path
      const path = (window.ProjectPaths && typeof window.ProjectPaths.normalizeStoragePath === 'function')
        ? window.ProjectPaths.normalizeStoragePath(fullPath)
  : fullPath.replace(/^Build\//, 'build/');
      const rec = await fm.loadFile(path);
      // Consider zero-byte or missing-content records as non-existent
      if (!rec) return false;
      const size = typeof rec.size === 'number' ? rec.size : undefined;
      const content = rec.fileContent ?? rec.content;
      const hasContent = (typeof content === 'string' && content.length > 0)
        || (content && typeof content.byteLength === 'number' && content.byteLength > 0)
        || (Array.isArray(content) && content.length > 0);
      if (size === 0 && !hasContent) return false;
      if (size !== undefined) return size > 0 || hasContent;
      return hasContent; // fallback if size not provided
    } catch (_) {
      return false;
    }
  }

  // MAIN PUBLIC INTERFACE - Atomic operations
  
  /**
   * Open a file in preview tab - single entry point
   * @param {string} fullPath - Full path to the resource
   * @param {Object} componentInfo - { type: 'editor'|'viewer', class: ComponentClass, name: string, displayName: string }
   * @param {Object} options - { isReadOnly: boolean }
   */
  async openInPreview(fullPath, componentInfo, options = {}) {
    
    // Check if already open in any tab with the same component
    const existingTabId = this.findTabByPathAndComponent(fullPath, componentInfo);
    
    if (existingTabId) {
      this.switchToTab(existingTabId);
      return existingTabId;
    }
    
    return await this._openInPreviewTab(fullPath, componentInfo, options);
  }
  
  /**
   * Open a file in dedicated tab - single entry point  
   * @param {string} fullPath - Full path to the resource
   * @param {Object} componentInfo - { type: 'editor'|'viewer', class: ComponentClass, name: string, displayName: string }
   * @param {Object} options - { isReadOnly: boolean, forceNew: boolean }
   */
  async openInTab(fullPath, componentInfo, options = {}) {
    
    // Check if already open in any tab with the same component (unless forcing new)
    if (!options.forceNew) {
      const existingTabId = this.findTabByPathAndComponent(fullPath, componentInfo);
      if (existingTabId) {
        if (existingTabId === 'preview') {
          // Promote preview to dedicated tab
          return await this._promotePreviewToTab();
        } else {
          this.switchToTab(existingTabId);
          return existingTabId;
        }
      }
    }
    
    return await this._createDedicatedTab(fullPath, componentInfo, options);
  }
  
  // INTERNAL IMPLEMENTATION
  
  findTabByPathAndComponent(fullPath, componentInfo) {
    
    // Check preview tab
    if (this.previewPath === fullPath) {
      // If no specific component requested, any match is fine
      if (!componentInfo) {
        return 'preview';
      }
      // Check if preview tab uses the same component
      if (this.previewViewer && this.previewViewer.constructor === componentInfo.class) {
        return 'preview';
      }
    }
    
    // Check dedicated tabs
    for (const [tabId, tabInfo] of this.dedicatedTabs.entries()) {
      if (tabInfo.fullPath === fullPath) {
        // If no specific component requested, any match is fine
        if (!componentInfo) {
          return tabId;
        }
        // Check if tab uses the same component
        if (tabInfo.viewer && tabInfo.viewer.constructor === componentInfo.class) {
          return tabId;
        }
      }
    }
    
    return null;
  }
  
  findTabByPath(fullPath) {
    // Legacy method - just calls the new one without component filtering
    return this.findTabByPathAndComponent(fullPath, null);
  }
  
  async _openInPreviewTab(fullPath, componentInfo, options = {}) {
    // Ensure preview tab elements exist (they might have been converted to dedicated tabs)
    this._ensurePreviewTabExists();
    
    const previewPane = this.tabContentArea.querySelector('[data-tab-id="preview"]');
    if (!previewPane) {
      console.error('[TabManager] Failed to create or find preview pane');
      return null;
    }
    
    // Extract filename from path
    const fileName = fullPath.split('/').pop() || fullPath.split('\\').pop();
    
    // Cleanup previous preview FIRST - before any rendering starts
    this._cleanupPreview();
    
    // Create viewer/editor using provided componentInfo
    const viewerInfo = await this._createViewerFromComponent(fullPath, fileName, componentInfo);
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
    if (this.previewReadOnly && viewerInfo.viewer && typeof viewerInfo.viewer.setReadOnly === 'function') {
      try { viewerInfo.viewer.setReadOnly(true); } catch (_) {}
    }
    
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
  
  async _createDedicatedTab(fullPath, componentInfo, options = {}) {
    const tabId = `tab-${this.nextTabId++}`;
    
    // Extract filename from path
    const fileName = fullPath.split('/').pop() || fullPath.split('\\').pop();
    
    // Create viewer/editor using provided componentInfo
    const viewerInfo = await this._createViewerFromComponent(fullPath, fileName, componentInfo);
    if (!viewerInfo) return null;

    // Enforce single-instance editors: if the created viewer is an editor whose
    // class is marked singleInstance in the component registry, reuse existing tab.
    try {
      const compReg = window.serviceContainer?.get('componentRegistry');
      if (compReg && viewerInfo.type === 'editor') {
        const editorClass = viewerInfo.viewer?.constructor;
        // Find this editor in the registry to check singleInstance flag
        let isSingle = false;
        for (const info of compReg.editors.values()) {
          if (info && info.editorClass === editorClass) {
            isSingle = !!info.singleInstance;
            break;
          }
        }
    if (isSingle) {
          // Look for an existing tab with the same editor class
          for (const [existingId, t] of this.dedicatedTabs.entries()) {
            if (t.viewer && t.viewer.constructor === editorClass) {
              // Update tab info to new path/name
              t.fullPath = fullPath;
              t.fileName = fileName;
              // Update tab title
              const titleEl = t.element?.querySelector('.tab-title');
              if (titleEl) {
                const ro = t.isReadOnly ? ' 🔒' : '';
                titleEl.textContent = fileName + ro;
              }
      // Dispose of the newly-created, unused viewer
      try { if (viewerInfo.viewer?.cleanup) viewerInfo.viewer.cleanup(); } catch (_) {}
      try { if (viewerInfo.viewer?.destroy) viewerInfo.viewer.destroy(); } catch (_) {}
              // Notify the editor of the new file path and trigger reload/load
              try {
                if (typeof t.viewer.updateFilePath === 'function') t.viewer.updateFilePath(fullPath, fileName);
                if (typeof t.viewer.loadPath === 'function') await t.viewer.loadPath(fullPath);
                else if (typeof t.viewer.reload === 'function') await t.viewer.reload();
              } catch (e) {
                console.warn('[TabManager] Error updating single-instance editor content:', e);
              }
              this.switchToTab(existingId);
              return existingId;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[TabManager] Single-instance check failed:', e);
    }
    
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
      <span class="tab-close" data-action="close">🗙</span>
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
    
    // Apply read-only to editor if requested
    if (tabInfo.isReadOnly && tabInfo.viewer && typeof tabInfo.viewer.setReadOnly === 'function') {
      try { tabInfo.viewer.setReadOnly(true); } catch (_) {}
    }

    // Switch to new tab
    this.switchToTab(tabId);
    
    return tabId;
  }
  
  async _promotePreviewToTab() {
    if (!this.previewViewer || !this.previewFileName || !this.previewPath) {
      console.warn('[TabManager] No preview content to promote');
      return null;
    }
    
    console.log(`[TabManager] Converting preview tab to dedicated tab: ${this.previewPath}`);
    
    // Get the preview tab elements
    const previewTab = this.tabBar.querySelector('[data-tab-id="preview"]');
    const previewPane = this.tabContentArea.querySelector('[data-tab-id="preview"]');
    
    if (!previewTab || !previewPane) {
      console.error('[TabManager] Preview tab elements not found for promotion');
      return null;
    }
    
    // Generate new dedicated tab ID
    const newTabId = `tab-${this.nextTabId++}`;
    
    // Convert preview tab to dedicated tab by changing IDs and adding to dedicated tabs map
    previewTab.dataset.tabId = newTabId;
    previewPane.dataset.tabId = newTabId;
    
    // Remove preview-specific classes and styling
    previewTab.classList.remove('preview-tab');
    previewTab.classList.add('tab'); // Ensure it has the correct class
    
    // CRITICAL: Clear any inline styles that might interfere with normal tab display
    previewPane.style.cssText = ''; // Clear all inline styles
    previewTab.style.cssText = '';   // Clear all inline styles
    
    // Update tab appearance - remove any special preview styling and add close button if needed
    const tabTitle = previewTab.querySelector('.tab-title');
    if (tabTitle) {
      const readOnlyIndicator = this.previewReadOnly ? ' 🔒' : '';
      tabTitle.textContent = this.previewFileName + readOnlyIndicator;
    }
    
    // Ensure close button exists for dedicated tab
    let closeButton = previewTab.querySelector('.tab-close');
    if (!closeButton) {
      closeButton = document.createElement('span');
      closeButton.className = 'tab-close';
      closeButton.dataset.action = 'close';
      closeButton.textContent = '🗙';
      previewTab.appendChild(closeButton);
    }

    // Debug: log the final tab structure
    console.log(`[TabManager] Promoted tab HTML:`, previewTab.outerHTML);    // Store the tab info in dedicated tabs map
    const tabInfo = {
      tabId: newTabId,
      fullPath: this.previewPath,
      fileName: this.previewFileName,
      viewer: this.previewViewer,
      element: previewTab,
      pane: previewPane,
      isReadOnly: this.previewReadOnly,
      viewerType: 'editor' // Assume it's an editor since it got dirty
    };
    
    this.dedicatedTabs.set(newTabId, tabInfo);
    
    // Clear preview state (but don't destroy the viewer - it's now part of dedicated tab)
    this.previewPath = null;
    this.previewFileName = null;
    this.previewViewer = null;
    this.previewReadOnly = false;
    
    // IMPORTANT: Recreate preview elements for future use
    // This ensures the DOM structure is clean and ready for the next preview
    this._ensurePreviewTabExists();

    // Update active tab ID
    this.activeTabId = 'preview'; // Reset to preview temporarily so switchToTab works
    this.switchToTab(newTabId); // Now properly switch to the promoted tab

    console.log(`[TabManager] Promoted preview to dedicated tab ${newTabId}`);
    return newTabId;
  }
  
  // Legacy method for backward compatibility - should eventually be removed
  // Only used by promotePreviewToDedicated() - that method needs refactoring
  async _createViewer(fullPath, fileName = null, preferredComponent = null) {
    // Ensure we have editors registered
    this.ensureEditorsRegistered();
    
    // Extract filename from path if not provided
    if (!fileName) {
      fileName = fullPath.split('/').pop() || fullPath.split('\\').pop();
    }
    
    const ext = this._getFileExtension(fileName);
    console.log(`[TabManager] Creating viewer for file: ${fileName}, extension: ${ext}, path: ${fullPath}`, preferredComponent ? `with preferred component: ${preferredComponent.displayName}` : '');
    
    // Handle temporary paths (for editors that don't need initial files)
    if (fullPath.startsWith('temp://')) {
      console.log(`[TabManager] Creating temporary editor for: ${fileName}`);
      
      // Find appropriate editor for this extension
      const componentRegistry = window.serviceContainer?.get('componentRegistry');
      if (!componentRegistry) {
        console.error('[TabManager] ComponentRegistry not available');
        return null;
      }
      
      const editorInfo = preferredComponent || this._getEditorForExtension(ext);
      if (editorInfo && editorInfo.editorClass) {
        try {
          const editor = new editorInfo.editorClass(fullPath, true); // isNewResource = true
          return {
            type: 'editor',
            subtype: editorInfo.name,
            viewer: editor,
            element: editor.getElement()
          };
        } catch (error) {
          console.error('[TabManager] Failed to create temporary editor:', error);
          return null;
        }
      } else {
        console.error(`[TabManager] No editor found for extension: ${ext}`);
        return null;
      }
    }
    
    // Load content using FileManager (safe-get and self-register if needed)
    let fileManager = null;
    try { fileManager = window.serviceContainer?.get('fileManager'); } catch (_) { /* not registered yet */ }
    fileManager = fileManager || window.FileManager || window.fileManager;
    if (!fileManager || typeof fileManager.loadFile !== 'function') {
      console.error('[TabManager] FileManager not available');
      return null;
    }
    
    // Normalize to storage path for loading
    const storagePath = window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(fullPath) : fullPath;
    let fileObj = await fileManager.loadFile(storagePath);
    if (!fileObj) {
      console.error(`[TabManager] File not found: ${fullPath}`);
      // Graceful fallback: allow viewer creation for known viewer types (e.g., mod/wav/hex)
      const fallbackType = this._getViewerType(ext);
      const FallbackViewer = window.ViewerPlugins?.[fallbackType];
      if (FallbackViewer) {
        try {
          console.warn(`[TabManager] Creating ${fallbackType} viewer with path-only (no storage record)`);
          const viewer = new FallbackViewer(fullPath);
          return {
            type: 'viewer',
            subtype: fallbackType,
            viewer,
            element: viewer.getElement()
          };
        } catch (err) {
          console.error('[TabManager] Fallback viewer creation failed:', err);
          return null;
        }
      }
      return null;
    }
    
    console.log(`[TabManager] Loaded file from storage: ${fullPath}, size: ${fileObj.size}`);
    
    // Try to use new component registry first
    if (window.serviceContainer) {
      const componentRegistry = window.serviceContainer.get('componentRegistry');
      if (componentRegistry) {
        console.log(`[TabManager] Using component registry to find component for ${fullPath}`);
        
        // If we have a preferred component, use it directly
        if (preferredComponent) {
          console.log(`[TabManager] Using preferred component: ${preferredComponent.displayName}`);
          
          // Check if it's an editor or viewer
          if (preferredComponent.editorClass) {
            // It's an editor
            try {
              console.log(`[TabManager] Creating preferred editor: ${preferredComponent.name}`);
              const isNewResource = fileObj.isNew || false;
              const EditorCtor = preferredComponent.editorClass;
              let editor;
              try {
                editor = new EditorCtor(fullPath, isNewResource);
              } catch (e1) {
                console.warn('[TabManager] (path,isNew) ctor failed; trying (file,path,isNew):', e1?.message || e1);
                editor = new EditorCtor(fileObj, fullPath, isNewResource);
              }
              return {
                type: 'editor',
                subtype: preferredComponent.name,
                viewer: editor,
                element: editor.getElement()
              };
            } catch (error) {
              console.error(`[TabManager] Failed to create preferred editor:`, error);
            }
          } else if (preferredComponent.viewerClass) {
            // It's a viewer
            try {
              console.log(`[TabManager] Creating preferred viewer: ${preferredComponent.name}`);
              const ViewerCtor = preferredComponent.viewerClass;
              const viewer = new ViewerCtor(fileObj, fullPath);
              return {
                type: 'viewer',
                subtype: preferredComponent.name,
                viewer: viewer,
                element: viewer.getElement()
              };
            } catch (error) {
              console.error(`[TabManager] Failed to create preferred viewer:`, error);
            }
          }
        }
        
        // Fall back to default component selection
        const editorInfo = componentRegistry.getEditorForFile(fullPath);
        if (editorInfo) {
          try {
            console.log(`[TabManager] Found editor in component registry: ${editorInfo.name} (${editorInfo.editorClass.name})`);
            // Files from storage are never "new" resources unless marked as such
            const isNewResource = fileObj.isNew || false;
            console.log(`[TabManager] Creating editor with path: ${fullPath}, isNewResource: ${isNewResource}`);
            const EditorCtor = editorInfo.editorClass;
            let editor;
            // Use the NEW SIGNATURE: (fileObject, readOnly)
            try {
              editor = new EditorCtor(fileObj, false); // Pass file object and readOnly=false
            } catch (e1) {
              console.warn('[TabManager] (fileObj,readOnly) ctor failed; trying fallback:', e1?.message || e1);
              // Fallback to old signature if needed
              try {
                editor = new EditorCtor(fileObj, fullPath, isNewResource);
              } catch (e2) {
                console.warn('[TabManager] Fallback ctor failed; trying path-based:', e2?.message || e2);
                editor = new EditorCtor(fullPath, isNewResource);
              }
            }
            return {
              type: 'editor',
              subtype: editorInfo.name,
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
        const isNewResource = fileObj.isNew || false;
        let editor;
        try {
          editor = new editorClass(fullPath, isNewResource);
        } catch (e1) {
          console.warn('[TabManager] Legacy (path,isNew) ctor failed; trying (file,path,isNew):', e1?.message || e1);
          editor = new editorClass(fileObj, fullPath, isNewResource);
        }
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
  let ViewerClass = window.ViewerPlugins?.[viewerType];
  
  // Use preferred component if specified and it's a viewer
  if (preferredComponent && preferredComponent.viewerClass) {
    console.log(`[TabManager] Using preferred viewer: ${preferredComponent.displayName}`);
    ViewerClass = preferredComponent.viewerClass;
    viewerType = preferredComponent.name;
  } else {
    // Try component registry for viewers if no preferred component
    if (window.serviceContainer) {
      const componentRegistry = window.serviceContainer.get('componentRegistry');
      if (componentRegistry) {
        const viewerInfo = componentRegistry.getViewerForFile(fullPath);
        if (viewerInfo) {
          console.log(`[TabManager] Found viewer in component registry: ${viewerInfo.displayName}`);
          ViewerClass = viewerInfo.viewerClass;
          viewerType = viewerInfo.name;
        }
      }
    }
  }
    
    if (!ViewerClass) {
      console.error(`[TabManager] No viewer found for ${ext}, using hex viewer`);
      viewerType = 'hex';
      ViewerClass = window.ViewerPlugins['hex'];
    }
    
    try {
      const viewer = new ViewerClass(fileObj, fullPath);
      // Check if this viewer is single-instance via component registry
      try {
        const compReg = window.serviceContainer?.get('componentRegistry');
        if (compReg) {
          // Find the registered viewer info for this class
          let isSingleViewer = false;
          for (const info of compReg.viewers.values()) {
            if (info && info.viewerClass === ViewerClass) { isSingleViewer = !!info.singleInstance; break; }
          }
          if (isSingleViewer) {
            for (const [existingId, t] of this.dedicatedTabs.entries()) {
              if (t.viewer && t.viewer.constructor === ViewerClass) {
                console.log(`[TabManager] Reusing single-instance viewer tab ${existingId} for ${fullPath}`);
                t.fullPath = fullPath;
                t.fileName = fileName;
                const titleEl = t.element?.querySelector('.tab-title');
                if (titleEl) { const ro = t.isReadOnly ? ' 🔒' : ''; titleEl.textContent = fileName + ro; }
                try { if (typeof t.viewer.updateFilePath === 'function') t.viewer.updateFilePath(fullPath, fileName); } catch (_) {}
                this.switchToTab(existingId);
                // Dispose the new temporary viewer
                try { viewer.cleanup?.(); } catch (_) {}
                try { viewer.destroy?.(); } catch (_) {}
                return {
                  type: 'viewer',
                  subtype: viewerType,
                  viewer: t.viewer,
                  element: t.viewer.getElement()
                };
              }
            }
          }
        }
      } catch (_) {}
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

  async _createViewerFromComponent(fullPath, fileName, componentInfo) {
    try {
      console.log(`TabManager: Creating viewer from component:`, {
        fullPath,
        fileName,
        componentInfo
      });

      // Use the provided componentInfo directly instead of auto-detecting
      // Handle both editor (editorClass) and viewer (viewerClass) components
      const Component = componentInfo.class || componentInfo.editorClass || componentInfo.viewerClass;
      if (!Component) {
        console.error('TabManager: No component class provided in componentInfo (expected class, editorClass, or viewerClass)');
        return null;
      }

      console.log(`TabManager: Creating instance of ${componentInfo.name} for ${fileName}`);
      
      // Handle temporary paths (for editors that don't need initial files)
      if (fullPath.startsWith('temp://')) {
        console.log(`[TabManager] Creating temporary editor for: ${fileName}`);
        
        if (componentInfo.editorClass || componentInfo.type === 'editor') {
          try {
            const editor = new Component(fullPath, true); // isNewResource = true
            return {
              viewer: editor,
              element: editor.getElement(),
              componentInfo: {
                type: 'editor',
                name: componentInfo.name,
                displayName: componentInfo.displayName
              }
            };
          } catch (error) {
            console.error('[TabManager] Failed to create temporary editor:', error);
            return null;
          }
        } else {
          console.error(`[TabManager] Temporary paths only supported for editors`);
          return null;
        }
      }
      
      // Determine if this is an editor or viewer based on the component type
      const isEditor = componentInfo.editorClass || componentInfo.type === 'editor';
      
      if (isEditor) {
        // For editors, use the same pattern as the legacy _createViewer method
        // Load file using FileManager for proper initialization
        let fileManager = null;
        try { fileManager = window.serviceContainer?.get('fileManager'); } catch (_) { /* not registered yet */ }
        fileManager = fileManager || window.FileManager || window.fileManager;
        if (!fileManager || typeof fileManager.loadFile !== 'function') {
          console.error('[TabManager] FileManager not available');
          return null;
        }

        // Normalize to storage path for loading
        const storagePath = window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(fullPath) : fullPath;
        let fileObj = await fileManager.loadFile(storagePath);
        if (!fileObj) {
          console.error(`[TabManager] File not found: ${fullPath}`);
          return null;
        }

        console.log(`[TabManager] Loaded file from storage: ${fullPath}, size: ${fileObj.size}`);

        // Create editor instance
        const isNewResource = fileObj.isNew || false;
        console.log(`[TabManager] Creating editor with path: ${fullPath}, isNewResource: ${isNewResource}`);
        
        // Clean constructor: (fileObject, readOnly)
        const editor = new Component(fileObj, false); // Never read-only from tab manager

        return {
          viewer: editor,
          element: editor.getElement(),
          componentInfo: {
            type: 'editor',
            name: componentInfo.name,
            displayName: componentInfo.displayName
          }
        };
      } else {
        // For viewers, follow the same pattern as the old system
        // Load file using FileManager to get the file object
        let fileManager = null;
        try { fileManager = window.serviceContainer?.get('fileManager'); } catch (_) { /* not registered yet */ }
        fileManager = fileManager || window.FileManager || window.fileManager;
        if (!fileManager || typeof fileManager.loadFile !== 'function') {
          console.error('[TabManager] FileManager not available');
          return null;
        }

        // Normalize to storage path for loading
        const storagePath = window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(fullPath) : fullPath;
        let fileObj = await fileManager.loadFile(storagePath);
        if (!fileObj) {
          console.error(`[TabManager] File not found: ${fullPath}`);
          return null;
        }

        console.log(`[TabManager] Loaded file from storage: ${fullPath}, size: ${fileObj.size}`);

        // Create viewer instance with path (standard viewer pattern)
        const viewer = new Component(fullPath);

        return {
          viewer,
          element: viewer.getElement(),
          componentInfo: {
            type: 'viewer',
            name: componentInfo.name,
            displayName: componentInfo.displayName
          }
        };
      }
    } catch (error) {
      console.error('TabManager: Error creating viewer from component:', error);
      return null;
    }
  }
  notifyResourceUpdated(resourceId, property, value, filename) {
    // Update preview viewer if it matches the filename
    if (this.previewViewer && typeof this.previewViewer.onResourceUpdated === 'function') {
      const previewName = (this.previewPath || '').split('/').pop();
      if (!filename || filename === previewName) {
        try { this.previewViewer.onResourceUpdated(property, value); } catch (e) { console.warn('preview onResourceUpdated error', e); }
      }
    }
    // Update any dedicated viewers that expose onResourceUpdated
    for (const [, tabInfo] of this.dedicatedTabs.entries()) {
      const tabName = (tabInfo.fullPath || '').split('/').pop();
      if (tabInfo.viewer && typeof tabInfo.viewer.onResourceUpdated === 'function') {
        if (!filename || filename === tabName) {
          try { tabInfo.viewer.onResourceUpdated(property, value); } catch (e) { console.warn('tab onResourceUpdated error', e); }
        }
      }
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
  
  _showWelcomePreview() {
    // Ensure preview tab exists and is visible
    this._ensurePreviewTabExists();
    
    const previewTab = this.tabBar.querySelector('[data-tab-id="preview"]');
    const previewPane = this.tabContentArea.querySelector('[data-tab-id="preview"]');
    
    if (previewTab) {
      previewTab.style.display = 'flex';
      previewTab.querySelector('.tab-title').textContent = 'Welcome';
    }
    
    if (previewPane) {
      previewPane.style.display = 'block';
      previewPane.innerHTML = `
        <div class="preview-pane">
          <div class="preview-header">
            <h3>Welcome to Game Engine Editor</h3>
            <p>Select a resource from the Project Explorer to preview it here, or double-click to open in a new tab.</p>
          </div>
        </div>
      `;
    }
    
    // Clear preview state since this is the welcome message
    this.previewPath = null;
    this.previewFileName = null;
    this.previewViewer = null;
    
    console.log('[TabManager] Welcome preview tab shown');
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
    
    // Validate that the tab exists before switching
    if (tabId !== 'preview' && !this.dedicatedTabs.has(tabId)) {
      console.warn(`[TabManager] Cannot switch to ${tabId} - tab does not exist`);
      console.trace(`[TabManager] Call stack for invalid tab switch:`);
      return;
    }
    
    console.log(`[TabManager] Switching from ${this.activeTabId} to ${tabId}`);
    
    // Store previous tab for proper cleanup
    const previousTabId = this.activeTabId;
    
    // Special behavior: If switching away from preview tab, close it automatically
    if (previousTabId === 'preview' && tabId !== 'preview') {
      this._closePreviewTab();
    }

    // Cleanup current tab FIRST
    this._notifyTabBlur(previousTabId);
    
    // Deactivate current tab elements
    const currentTab = this.tabBar.querySelector(`[data-tab-id="${previousTabId}"]`);
    const currentPane = this.tabContentArea.querySelector(`[data-tab-id="${previousTabId}"]`);
    if (currentTab) {
      currentTab.classList.remove('active');
    }
    if (currentPane) {
      currentPane.classList.remove('active');
    }    // Update active tab ID BEFORE activating new tab
    this.activeTabId = tabId;
    
    // Activate new tab elements
    const newTab = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
    const newPane = this.tabContentArea.querySelector(`[data-tab-id="${tabId}"]`);
    if (newTab) {
      newTab.classList.add('active');
    }
    if (newPane) {
      newPane.classList.add('active');
      
      // Debug: Check if multiple panes are active (potential CSS conflict)
      const activePanes = this.tabContentArea.querySelectorAll('.tab-pane.active');
      if (activePanes.length > 1) {
        console.warn(`[TabManager] WARNING: Multiple active panes detected:`, Array.from(activePanes).map(p => p.dataset.tabId));
      }
    } else {
      console.warn(`[TabManager] No pane found for tab ${tabId}`);
    }

    console.log(`[TabManager] Active tab ID set to ${tabId}`);    // Trigger resize for editors that might need it
    const tabInfo = this.dedicatedTabs.get(tabId);
    if (tabInfo?.viewer) {
      setTimeout(() => {
        if (typeof tabInfo.viewer.resize === 'function') {
          tabInfo.viewer.resize();
        }
        if (typeof tabInfo.viewer.refresh === 'function') {
          tabInfo.viewer.refresh();
        }
      }, 50);
    }
    
    // Notify new tab AFTER everything is set up
    this._notifyTabFocus(tabId);
    
    // Fire event
    this._fireEvent('tabSwitched', { tabId, tabInfo: this.getActiveTab() });
  }
  
  async closeTab(tabId) {
    try {
      console.log(`[TabManager] closeTab called for: ${tabId}`);
      
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
      if (!tabInfo) {
        console.warn(`[TabManager] No tab info found for ${tabId}`);
        return;
      }

      console.log(`[TabManager] Found tab info for ${tabId}, checking editor close`);

      // Call close on the editor/viewer - it handles save prompting and returns true/false
      if (tabInfo.viewer && typeof tabInfo.viewer.close === 'function') {
        try {
          const shouldClose = await tabInfo.viewer.close();
          if (!shouldClose) {
            return; // Editor cancelled the close
          }
        } catch (error) {
          console.error('[TabManager] Error in editor close:', error);
          return; // Default to cancel on error
        }
      } else if (tabInfo.viewer && typeof tabInfo.viewer.canClose === 'function') {
        // Fallback to legacy canClose method
        try {
          console.log(`[TabManager] Using legacy canClose() for ${tabId}`);
          const res = tabInfo.viewer.canClose();
          if (res && typeof res.then === 'function') {
            try {
              const canClose = await res;
              if (!canClose) {
                console.log(`[TabManager] Legacy canClose cancelled for ${tabId}`);
                return; // User cancelled
              }
            } catch (error) {
              console.error('[TabManager] Error in canClose promise:', error);
              return; // Default to cancel on error
            }
          } else if (!res) {
            console.log(`[TabManager] Legacy canClose returned false for ${tabId}`);
            return; // User cancelled
          }
        } catch (error) {
          console.error('[TabManager] Error in canClose:', error);
          return; // Default to cancel on error
        }
      }

      this._performTabClose(tabId, tabInfo);
      
    } catch (error) {
      console.error(`[TabManager] Unexpected error in closeTab for ${tabId}:`, error);
    }
  }

  _performTabClose(tabId, tabInfo) {
    // Notify viewer that tab is losing focus/being closed
    this._notifyTabBlur(tabId);
    
    // Editor cleanup is already handled by editor.close()
    // Just handle DOM and tab management cleanup here
    
    // Remove DOM
    console.log(`[TabManager] Removing DOM elements for ${tabId}`);
    if (tabInfo.element) {
      console.log(`[TabManager] Removing tab element for ${tabId}`);
      tabInfo.element.remove();
    } else {
      console.warn(`[TabManager] No tab element found for ${tabId}`);
    }
    if (tabInfo.pane) {
      console.log(`[TabManager] Removing pane element for ${tabId}`);
      tabInfo.pane.remove();
    } else {
      console.warn(`[TabManager] No pane element found for ${tabId}`);
    }

    // Remove from map
    this.dedicatedTabs.delete(tabId);
    console.log(`[TabManager] Removed ${tabId} from dedicatedTabs map`);

    // Switch to preview if this was active, but only if preview has content
    if (this.activeTabId === tabId) {
      console.log(`[TabManager] Closed tab was active (${tabId}), finding new tab to switch to`);
      console.log(`[TabManager] Preview path: ${this.previewPath}, Preview filename: ${this.previewFileName}`);
      console.log(`[TabManager] Remaining dedicated tabs: ${this.dedicatedTabs.size}`);
      
      if (this.previewPath && this.previewFileName) {
        console.log(`[TabManager] Switching to preview tab`);
        this.switchToTab('preview');
      } else {
        // Switch to first available tab or show welcome preview
        if (this.dedicatedTabs.size > 0) {
          const firstTabId = this.dedicatedTabs.keys().next().value;
          console.log(`[TabManager] Switching to first available tab: ${firstTabId}`);
          this.switchToTab(firstTabId);
        } else {
          console.log(`[TabManager] No tabs remaining, showing welcome preview tab`);
          // No dedicated tabs left, show the welcome preview tab
          this._showWelcomePreview();
          this.switchToTab('preview');
        }
      }
    }

    // Fire event
    try {
      this._fireEvent('tabClosed', { tabId, tabInfo });
      console.log(`[TabManager] tabClosed event fired successfully for ${tabId}`);
    } catch (error) {
      console.error(`[TabManager] Error firing tabClosed event for ${tabId}:`, error);
    }

    console.log(`[TabManager] Closed tab ${tabId}`);
      // Emit global refresh event so all tabs update
      if (window.eventBus && typeof window.eventBus.emit === 'function') {
        window.eventBus.emit('content.refresh.required');
      }
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
    console.log(`[TabManager] Updating file references: ${oldPath} → ${newPath}, newFileName: ${newFileName}`);
    
    // Update dedicated tabs
    for (const [tabId, tabInfo] of this.dedicatedTabs.entries()) {
      console.log(`[TabManager] Checking tab ${tabId}: fullPath="${tabInfo.fullPath}", fileName="${tabInfo.fileName}"`);
      
      // Handle new files that were saved (oldPath might be 'untitled' or null)
      const isNewFileSave = (oldPath === 'untitled' || oldPath === null || oldPath === undefined) && 
                           (tabInfo.fullPath === null || tabInfo.fullPath === 'untitled' || tabInfo.fullPath === undefined) && 
                           tabInfo.fileName === 'Untitled';
      
      // Also check if this tab matches by old path
      const isPathMatch = tabInfo.fullPath === oldPath;
      
      console.log(`[TabManager] Tab ${tabId} - isNewFileSave: ${isNewFileSave}, isPathMatch: ${isPathMatch}`);
      
      if (isPathMatch || isNewFileSave) {
        console.log(`[TabManager] Updating tab ${tabId} with new file info`);
        
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
            console.log(`[TabManager] Updated tab title to: ${newFileName + readOnlyIndicator}`);
          }
        } else {
          // For openNewEditor tabs, find the tab element by tabId
          const tabElement = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
          if (tabElement) {
            const titleElement = tabElement.querySelector('.tab-title');
            if (titleElement && newFileName) {
              const readOnlyIndicator = tabInfo.isReadOnly ? ' 🔒' : '';
              titleElement.textContent = newFileName + readOnlyIndicator;
              console.log(`[TabManager] Updated tab title via DOM query to: ${newFileName + readOnlyIndicator}`);
            }
          } else {
            console.warn(`[TabManager] Could not find tab element for ${tabId}`);
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
        
        // Mark the tab as clean since it was just saved
        if (isNewFileSave) {
          this.markTabClean(tabId);
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
      
      // Update save button state
      if (window.gameEmulator) {
        window.gameEmulator.updateSaveButtonState();
      }
    }
  }
  
  markTabClean(tabId) {
    const tabElement = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabElement && tabElement.classList.contains('dirty')) {
      console.log(`[TabManager] Marking tab ${tabId} as clean`);
      tabElement.classList.remove('dirty');
      
      // Update save button state
      if (window.gameEmulator) {
        window.gameEmulator.updateSaveButtonState();
      }
    }
  }

  updateTabName(tabId, newFileName, newFullPath = null) {
    console.log(`[TabManager] Updating tab ${tabId} name to: ${newFileName}`);
    
    // Update tab element
    const tabElement = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabElement) {
      const titleSpan = tabElement.querySelector('.tab-title');
      if (titleSpan) {
        const readOnlyIndicator = tabElement.classList.contains('readonly-tab') ? ' 🔒' : '';
        titleSpan.textContent = `${newFileName}${readOnlyIndicator}`;
      }
    }
    
    // Update stored tab info
    const tabInfo = this.dedicatedTabs.get(tabId);
    if (tabInfo) {
      tabInfo.fileName = newFileName;
      if (newFullPath) {
        tabInfo.fullPath = newFullPath;
      }
    }
    
    // Update preview tab if it's the active one
    if (tabId === 'preview') {
      this.previewFileName = newFileName;
      if (newFullPath) {
        this.previewPath = newFullPath;
      }
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
        // If this is a preview tab that's becoming dirty, check if we should promote it
        if (tabId === 'preview') {
          // Only promote once to prevent double promotion during loading
          if (!this._promotingPreview) {
            console.log('[TabManager] Preview tab becoming dirty from user edit - promoting to dedicated tab');
            this._promotingPreview = true;
            this._promotePreviewToTab().then(newTabId => {
              if (newTabId) {
                // Mark the new dedicated tab as dirty
                this.markTabDirty(newTabId);
                console.log(`[TabManager] Promoted preview tab ${newTabId} marked as dirty`);
              }
              this._promotingPreview = false;
            }).catch(error => {
              console.error('[TabManager] Failed to promote preview tab:', error);
              // Fallback: just mark the preview as dirty
              this.markTabDirty(tabId);
              this._promotingPreview = false;
            });
          } else {
            console.log('[TabManager] Preview promotion already in progress - skipping duplicate promotion');
          }
        } else {
          // Regular dedicated tab - just mark as dirty
          this.markTabDirty(tabId);
        }
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
  
  // Event-driven dirty state tracking setup
  _setupEventListeners() {
    // Listen for content change events from editors
    if (window.eventBus) {
      window.eventBus.on('editor.content.changed', (data) => {
        if (data.editor) {
          this.notifyContentChanged(data.editor);
        }
      });
      
      window.eventBus.on('editor.content.saved', (data) => {
        if (data.editor) {
          this.notifyContentSaved(data.editor);
        }
      });
      
      console.log('[TabManager] Event-driven dirty state tracking initialized');
    } else {
      console.warn('[TabManager] EventBus not available for dirty state tracking');
    }
  }
  
  _stopEventListeners() {
    if (window.eventBus) {
      window.eventBus.off('editor.content.changed');
      window.eventBus.off('editor.content.saved');
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

  async saveActiveTab() {
    try {
      const active = this.getActiveTab();
      if (!active || !active.viewer) {
        console.log('[TabManager] saveActiveTab: no active viewer');
        return 0;
      }
      const v = active.viewer;
      if (typeof v.save !== 'function') {
        console.log('[TabManager] saveActiveTab: active viewer has no save method');
        return 0;
      }
      const modified = typeof v.isModified === 'function' ? v.isModified() : true; // assume needs save if unknown
      if (!modified) {
        console.log('[TabManager] saveActiveTab: active viewer not modified');
        return 0;
      }
      console.log('[TabManager] saveActiveTab: saving active viewer');
      await v.save();
      // Mark tab clean
      if (this.activeTabId === 'preview') this.markTabClean('preview'); else this.markTabClean(this.activeTabId);
      return 1;
    } catch (e) {
      console.error('[TabManager] saveActiveTab failed', e);
      throw e;
    }
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
  this._closePreviewTab();
    
    console.log('[TabManager] All tabs closed');
  }

  updateTabTitle(tabId, newTitle) {
    console.log(`[TabManager] Updating tab title: ${tabId} -> ${newTitle}`);
    
    if (tabId === 'preview') {
      // Update preview tab
      const previewTab = document.querySelector('[data-tab-id="preview"]');
      if (previewTab) {
        const titleEl = previewTab.querySelector('.tab-title');
        if (titleEl) {
          titleEl.textContent = newTitle;
        }
      }
    } else {
      // Update dedicated tab
      const tabInfo = this.dedicatedTabs.get(tabId);
      if (tabInfo && tabInfo.element) {
        const titleEl = tabInfo.element.querySelector('.tab-title');
        if (titleEl) {
          titleEl.textContent = newTitle;
        }
      }
    }
  }

  // Helper method to get editor for extension
  _getEditorForExtension(ext) {
    const componentRegistry = window.serviceContainer?.get('componentRegistry');
    if (!componentRegistry) {
      return null;
    }
    
    // Use the component registry's method to find editor by file extension
    const tempPath = `temp${ext}`; // Create a temporary path with the extension
    return componentRegistry.getEditorForFile(tempPath);
  }

  // Open a new editor with no file object - let editor handle filename prompting
  async openNewEditor(editorInfo) {
    console.log(`[TabManager] Opening new editor: ${editorInfo.displayName}`);
    
    // Create editor with no file object (new file mode)
    const Component = editorInfo.editorClass;
    const editor = new Component(); // No arguments = new file mode
    
    // Generate a temporary tab ID
    const tabId = `new-${Date.now()}`;
    
    // Create tab element
    const tabElement = document.createElement('div');
    tabElement.className = 'tab';
    tabElement.dataset.tabId = tabId;
    tabElement.innerHTML = `
      <span class="tab-title">Untitled</span>
      <span class="tab-close" data-action="close">🗙</span>
    `;
    
    // Create content pane
    const tabPane = document.createElement('div');
    tabPane.className = 'tab-pane';
    tabPane.dataset.tabId = tabId;
    
    const editorElement = editor.getElement();
    
    tabPane.appendChild(editorElement);
    
    // Add to DOM
    this.tabBar.appendChild(tabElement);
    this.tabContentArea.appendChild(tabPane);
    
    // Store tab info
    this.dedicatedTabs.set(tabId, {
      viewer: editor,
      fileName: 'Untitled',
      fullPath: null,
      isReadOnly: false,
      componentInfo: editorInfo,
      element: tabElement,
      pane: tabPane
    });
    
    // Mark new file as dirty immediately since it has unsaved content
    this.markTabDirty(tabId);
    
    // Also mark the editor as dirty to ensure consistency
    if (editor && typeof editor.markDirty === 'function') {
      // Use setTimeout to ensure the editor is fully initialized
      setTimeout(() => {
        editor.markDirty();
      }, 0);
    }
    
    // Switch to the new tab
    this.switchToTab(tabId);
  }
  
  // Cleanup method
  destroy() {
    this._stopEventListeners();
    console.log('[TabManager] Destroyed and cleaned up event listeners');
  }
}

// Export for use
window.TabManager = TabManager;
