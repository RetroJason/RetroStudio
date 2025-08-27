// tab-manager.js
// Manages the tabbed interface for resource viewers

class TabManager {
  constructor() {
    this.tabs = new Map(); // tabId -> {type, data, element, viewer}
    this.activeTabId = 'preview';
    this.tabBar = null;
    this.tabContentArea = null;
    this.nextTabId = 1;
    this.onTabChangeCallbacks = []; // Array to store callbacks for tab changes
    
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
    console.log('[TabManager] Initialized');
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

  // Find if a tab already exists for this file
  findTabForFile(fileName) {
    // Check preview tab first
    if (this.previewViewer && this.previewViewer.file && this.previewViewer.file.name === fileName) {
      return 'preview';
    }
    
    // Check all tabs
    for (const [tabId, tabData] of this.tabs.entries()) {
      if (tabData.file && tabData.file.name === fileName) {
        return tabId;
      }
    }
    
    return null;
  }
  
  findTabForPath(filePath) {
    // Check preview tab first
    if (this.previewViewer && this.previewViewer.filePath === filePath) {
      return 'preview';
    }
    
    // Check all tabs by exact path match
    for (const [tabId, tabData] of this.tabs.entries()) {
      if (tabData.filePath === filePath) {
        return tabId;
      }
    }
    
    return null;
  }
  
  // Show resource in preview tab (single click)
  showInPreview(file, path, isReadOnly = false) {
    // Use unified opening logic with preview preference
    return this.openFile(file, path, { preferPreview: true, isReadOnly });
  }
  
  // Internal method to actually show file in preview tab
  _showInPreviewTab(file, path, isReadOnly = false) {
    const previewPane = this.tabContentArea.querySelector('[data-tab-id="preview"]');
    if (!previewPane) return;
    
    // Clean up previous preview viewer
    if (this.previewViewer) {
      if (typeof this.previewViewer.cleanup === 'function') {
        this.previewViewer.cleanup();
      }
    }
    
    // Clear previous preview content
    previewPane.innerHTML = '';
    
    // Create viewer for this resource
    const viewer = this.createViewer(file, path);
    if (viewer) {
      // Store the preview viewer so notifications can reach it
      this.previewViewer = viewer.viewer;
      this.previewViewer.filename = file.name; // Store filename for tab focus notifications
      this.previewViewer.file = file; // Store file for tab comparison
      this.previewViewer.filePath = path; // Store full path for tab comparison
      
      previewPane.appendChild(viewer.element);
      this.switchToTab('preview');
      
      // Update preview tab title
      const previewTab = this.tabBar.querySelector('[data-tab-id="preview"]');
      if (previewTab) {
        const title = previewTab.querySelector('.tab-title');
        title.textContent = `Preview: ${file.name}`;
      }
      
      return 'preview';
    }
    
    return null;
  }

  // Unified file opening method - all file opening should go through this
  async openFile(file, path, options = {}) {
    const {
      forceNewTab = false,        // Force creation of new tab even if file is open
      preferPreview = false,      // Prefer preview tab over dedicated tab
      isReadOnly = false,         // Mark tab as read-only
      autoOpen = false           // This is an auto-open (less logging)
    } = options;
    
    if (!autoOpen) {
      console.log(`[TabManager] Opening file: ${file.name} at ${path}`, options);
    }
    
    // Check if file is already open somewhere
    const existingTabId = this.findTabForPath(path);
    
    if (!autoOpen) {
      console.log(`[TabManager] Existing tab check for ${path}: ${existingTabId || 'none found'}`);
      // Debug: show all current tab paths
      const tabPaths = [];
      if (this.previewViewer && this.previewViewer.filePath) {
        tabPaths.push(`preview: ${this.previewViewer.filePath}`);
      }
      for (const [tabId, tabData] of this.tabs.entries()) {
        if (tabData.filePath) {
          tabPaths.push(`${tabId}: ${tabData.filePath}`);
        }
      }
      console.log(`[TabManager] Current tab paths:`, tabPaths);
    }
    
    if (existingTabId && !forceNewTab) {
      if (!autoOpen) {
        console.log(`[TabManager] File ${path} already open in tab ${existingTabId}, switching to it`);
      }
      this.switchToTab(existingTabId);
      return existingTabId;
    }
    
    // Decide whether to use preview or create new tab
    if (preferPreview && !forceNewTab) {
      return this._showInPreviewTab(file, path, isReadOnly);
    } else {
      return this.openInNewTab(file, path, isReadOnly, autoOpen);
    }
  }
  
  // Alias for showInPreview to maintain compatibility
  previewResource(file, path) {
    return this.showInPreview(file, path);
  }
  
  // Open resource in new dedicated tab (double click or auto-open)
  openInNewTab(file, path, isReadOnly = false, autoOpen = false) {
    if (!autoOpen) {
      console.log(`[TabManager] Double-click request for: ${file.name} at path: ${path}`);
    }
    
    // This method should only be called after checking for existing tabs
    // But let's be safe and check again
    const existingTabId = this.findTabForPath(path);
    if (existingTabId) {
      if (!autoOpen) {
        console.log(`[TabManager] File ${path} already open in tab ${existingTabId}, focusing existing tab`);
      }
      this.switchToTab(existingTabId);
      return existingTabId;
    }

    if (!autoOpen) {
      console.log(`[TabManager] Creating new tab for: ${file.name} at ${path}`);
    }
    
    const tabId = `tab_${this.nextTabId++}`;
    
    // Create tab element with indicators for read-only files
    const tabElement = document.createElement('div');
    tabElement.className = 'tab';
    if (isReadOnly) {
      tabElement.classList.add('readonly-tab');
    }
    tabElement.dataset.tabId = tabId;
    
    const readOnlyIndicator = isReadOnly ? ' 🔒' : '';
    tabElement.innerHTML = `
      <span class="tab-title">${file.name}${readOnlyIndicator}</span>
      <span class="tab-close" data-action="close">✖</span>
    `;
    
    // Create tab content pane
    const tabPane = document.createElement('div');
    tabPane.className = 'tab-pane';
    tabPane.dataset.tabId = tabId;
    
    // Create viewer
    const viewer = this.createViewer(file, path);
    if (viewer) {
      if (!autoOpen) {
        console.log(`[TabManager] Created ${viewer.type} viewer for: ${file.name}`);
      }
      tabPane.appendChild(viewer.element);
      
      // Add to DOM
      this.tabBar.appendChild(tabElement);
      this.tabContentArea.appendChild(tabPane);
      
      // Store tab data with consistent path storage
      this.tabs.set(tabId, {
        type: viewer.type,
        file,
        filePath: path,  // Store full path for comparison
        element: tabElement,
        pane: tabPane,
        viewer: viewer.viewer,  // Store the actual viewer instance, not the wrapper object
        filename: file.name,
        isReadOnly: isReadOnly
      });
      
      // Switch to new tab
      this.switchToTab(tabId);
      
      if (!autoOpen) {
        console.log(`[TabManager] Opened new tab: ${file.name}, total tabs: ${this.tabs.size}`);
      }
      return tabId;
    } else {
      console.error(`[TabManager] Failed to create viewer for: ${file.name}`);
      return null;
    }
  }
  
  createViewer(file, path) {
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    
    // First check if there's an editor for this file type
    if (window.editorRegistry) {
      const editorClass = window.editorRegistry.getEditorForExtension(ext);
      if (editorClass) {
        console.log(`[TabManager] Creating editor for ${ext}: ${editorClass.getDisplayName()}`);
        try {
          const editor = new editorClass(file, path, false);
          return {
            type: 'editor',
            subtype: ext,
            viewer: editor,
            element: editor.getElement(),
            isEditor: true
          };
        } catch (error) {
          console.error(`[TabManager] Failed to create editor for ${file.name}:`, error);
          // Fall through to viewer creation
        }
      }
    }
    
    // Fall back to viewers
    let viewerType = null;
    
    // Determine viewer type
    if (['.mod', '.xm', '.s3m', '.it', '.mptm'].includes(ext)) {
      viewerType = 'mod';
    } else if (['.wav'].includes(ext)) {
      viewerType = 'wav';
    } else {
      // Use hex viewer as fallback for all other file types
      viewerType = 'hex';
      console.log(`[TabManager] Using hex viewer for unsupported file type: ${ext}`);
    }
    
    // Create viewer instance
    const ViewerClass = window.ViewerPlugins[viewerType];
    if (!ViewerClass) {
      console.error(`[TabManager] Viewer plugin not found: ${viewerType}`);
      return null;
    }
    
    try {
      const viewer = new ViewerClass(file, path);
      return {
        type: viewerType,
        viewer,
        element: viewer.getElement(),
        isEditor: false
      };
    } catch (error) {
      console.error(`[TabManager] Failed to create viewer for ${file.name}:`, error);
      return null;
    }
  }
  
  // Notify project explorer of active tab changes
  notifyTabFocus(filename) {
    if (window.projectExplorer && typeof window.projectExplorer.highlightActiveFile === 'function') {
      window.projectExplorer.highlightActiveFile(filename);
    }
  }
  
  // Create a new resource with an editor
  async createNewResource(editorClass) {
    try {
      const editor = await window.editorRegistry.createNewResource(editorClass);
      if (!editor) return; // User cancelled
      
      // Create a new tab for the editor
      const tabId = `tab-${this.nextTabId++}`;
      
      // Get the proper file path - will be updated after saving
      const filePath = editor.path || editor.file.name;
      
      const tabData = {
        type: 'editor',
        subtype: editorClass.getFileExtension(),
        file: editor.file,
        filePath: filePath,  // Store the file path for duplicate detection
        viewer: editor,
        element: null, // Will be set below
        pane: null,    // Will be set below
        isEditor: true,
        filename: editor.file.name
      };
      
      // Create tab element
      const tabElement = document.createElement('div');
      tabElement.className = 'tab';
      tabElement.dataset.tabId = tabId;
      tabElement.innerHTML = `
        <span class="tab-title">${editor.file.name}</span>
        <span class="tab-close" data-action="close">✖</span>
      `;
      
      // Create content pane
      const tabPane = document.createElement('div');
      tabPane.className = 'tab-pane';
      tabPane.dataset.tabId = tabId;
      tabPane.appendChild(editor.getElement());
      
      // Add to DOM
      this.tabBar.appendChild(tabElement);
      this.tabContentArea.appendChild(tabPane);
      
      // Update tab data with DOM elements
      tabData.element = tabElement;
      tabData.pane = tabPane;
      
      this.tabs.set(tabId, tabData);
      
      // Switch to new tab
      this.switchToTab(tabId);
      
      // Auto-save new resource files immediately so they appear in project structure
      // This ensures duplicate detection works properly for subsequent file creation
      console.log(`[TabManager] Checking auto-save for ${editor.file.name}: isNewResource=${editor.isNewResource}, save method exists=${!!editor.save}`);
      
      if (editor.isNewResource && editor.save) {
        try {
          console.log(`[TabManager] Auto-saving new resource: ${editor.file.name}`);
          await editor.save();
          console.log(`[TabManager] Auto-saved new resource: ${editor.file.name}`);
          
          // Update the tab's file path after saving (now that we know the full path)
          const savedPath = editor.path || `Resources/${editorClass.getFileExtension().replace('.', '').charAt(0).toUpperCase() + editorClass.getFileExtension().replace('.', '').slice(1)}/${editor.file.name}`;
          if (this.tabs.has(tabId)) {
            this.tabs.get(tabId).filePath = savedPath;
            console.log(`[TabManager] Updated tab ${tabId} path to: ${savedPath}`);
          }
          
          // Refresh project explorer to update structure for duplicate detection
          if (window.gameEditor && window.gameEditor.projectExplorer && window.gameEditor.projectExplorer.refreshProject) {
            await window.gameEditor.projectExplorer.refreshProject();
            console.log(`[TabManager] Refreshed project structure after creating ${editor.file.name}`);
          }
        } catch (saveError) {
          console.error('[TabManager] Failed to auto-save new resource:', saveError);
          // Don't show alert here as file creation was successful, just save failed
        }
      } else {
        console.log(`[TabManager] Skipping auto-save for ${editor.file.name}: isNewResource=${editor.isNewResource}, save method exists=${!!editor.save}`);
      }
      
      console.log(`[TabManager] Created new resource tab: ${tabId} for ${editor.file.name}`);
    } catch (error) {
      console.error('[TabManager] Failed to create new resource:', error);
      alert(`Failed to create new resource: ${error.message}`);
    }
  }

  switchToTab(tabId) {
    if (this.activeTabId === tabId) return;
    
    console.log(`[TabManager] Switching from ${this.activeTabId} to ${tabId}`);
    
    // Notify current tab that it's losing focus
    if (this.activeTabId) {
      const currentTabData = this.tabs.get(this.activeTabId);
      if (currentTabData && currentTabData.viewer) {
        // Use new standardized interface first
        if (typeof currentTabData.viewer.loseFocus === 'function') {
          console.log(`[TabManager] Calling loseFocus for tab: ${this.activeTabId}`);
          try {
            currentTabData.viewer.loseFocus();
          } catch (error) {
            console.error(`[TabManager] Error calling loseFocus:`, error);
          }
        }
        // Fallback to legacy interface
        else if (typeof currentTabData.viewer.onBlur === 'function') {
          console.log(`[TabManager] Calling onBlur (legacy) for tab: ${this.activeTabId}`);
          try {
            currentTabData.viewer.onBlur();
          } catch (error) {
            console.error(`[TabManager] Error calling onBlur:`, error);
          }
        }
      }
      // Handle preview tab
      else if (this.activeTabId === 'preview' && this.previewViewer) {
        if (typeof this.previewViewer.loseFocus === 'function') {
          console.log(`[TabManager] Calling loseFocus for preview tab`);
          try {
            this.previewViewer.loseFocus();
          } catch (error) {
            console.error(`[TabManager] Error calling preview loseFocus:`, error);
          }
        }
        else if (typeof this.previewViewer.onBlur === 'function') {
          console.log(`[TabManager] Calling onBlur (legacy) for preview tab`);
          try {
            this.previewViewer.onBlur();
          } catch (error) {
            console.error(`[TabManager] Error calling preview onBlur:`, error);
          }
        }
      }
    }
    
    // Deactivate current tab
    const currentTab = this.tabBar.querySelector(`[data-tab-id="${this.activeTabId}"]`);
    const currentPane = this.tabContentArea.querySelector(`[data-tab-id="${this.activeTabId}"]`);
    
    if (currentTab) currentTab.classList.remove('active');
    if (currentPane) currentPane.classList.remove('active');
    
    // Activate new tab
    const newTab = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
    const newPane = this.tabContentArea.querySelector(`[data-tab-id="${tabId}"]`);
    
    if (newTab) newTab.classList.add('active');
    if (newPane) newPane.classList.add('active');
    
    this.activeTabId = tabId;
    
    // Get tab data for notifications
    const tabData = this.tabs.get(tabId);
    
    // Notify project explorer of the active file
    if (tabData && tabData.filename) {
      this.notifyTabFocus(tabData.filename);
    } else if (tabId === 'preview' && this.previewViewer && this.previewViewer.filename) {
      this.notifyTabFocus(this.previewViewer.filename);
    }
    
    // Notify new tab that it's gaining focus
    if (tabData && tabData.viewer) {
      if (typeof tabData.viewer.onFocus === 'function') {
        console.log(`[TabManager] Calling onFocus for tab: ${tabId}`);
        tabData.viewer.onFocus();
      }
    }
    // Handle preview tab
    else if (tabId === 'preview' && this.previewViewer) {
      if (typeof this.previewViewer.onFocus === 'function') {
        console.log(`[TabManager] Calling onFocus for preview tab`);
        this.previewViewer.onFocus();
      }
    }
    
    console.log(`[TabManager] Switched to tab: ${tabId}`);
    
    // Notify listeners of tab change
    this.notifyTabChange(tabId);
  }
  
  closeTab(tabId) {
    if (tabId === 'preview') return; // Can't close preview tab
    
    const tabData = this.tabs.get(tabId);
    if (!tabData) return;
    
    // Check if this is an editor with unsaved changes
      if (tabData.viewer && typeof tabData.viewer.canClose === 'function') {
        try {
          const res = tabData.viewer.canClose();
          if (res && typeof res.then === 'function') {
            res.then((ok) => { if (ok) this.closeTab(tabId); }).catch(() => {});
            return;
          }
          if (!res) return;
        } catch (_) { return; }
    }
    
    // Cleanup viewer using standardized interface
    if (tabData.viewer) {
      // Use new standardized cleanup first
      if (typeof tabData.viewer.cleanup === 'function') {
        console.log(`[TabManager] Calling cleanup for tab: ${tabId}`);
        tabData.viewer.cleanup();
      }
      // Then call destroy for any additional cleanup
      if (typeof tabData.viewer.destroy === 'function') {
        tabData.viewer.destroy();
      }
    }
    
    // Remove DOM elements
    if (tabData.element) tabData.element.remove();
    if (tabData.pane) tabData.pane.remove();
    
    // Remove from tabs map
    this.tabs.delete(tabId);
    
    // Switch to preview tab if this was the active tab
    if (this.activeTabId === tabId) {
      this.switchToTab('preview');
      
      // Reset preview tab title
      const previewTab = this.tabBar.querySelector('[data-tab-id="preview"]');
      if (previewTab) {
        const title = previewTab.querySelector('.tab-title');
        title.textContent = 'Preview';
      }
      
      // Clear preview content
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
    }
    
    console.log(`[TabManager] Closed tab: ${tabId}`);
  }
  
  closeAllTabs() {
    const tabIds = Array.from(this.tabs.keys());
    for (const tabId of tabIds) {
      this.closeTab(tabId);
    }
  }
  
  getActiveTab() {
    return this.tabs.get(this.activeTabId) || null;
  }
  
  getTabCount() {
    return this.tabs.size;
  }

  notifyResourceUpdated(resourceId, property, value, filename = null) {
    console.log(`[TabManager] Notifying tabs about resource ${resourceId} update: ${property} = ${value}${filename ? ` (${filename})` : ''}`);
    console.log(`[TabManager] Current tabs count: ${this.tabs.size}`);
    
    // Find tabs that are displaying this resource and notify their viewers
    for (const [tabId, tabData] of this.tabs.entries()) {
      if (tabData.viewer && tabData.viewer.file) {
        console.log(`[TabManager] Checking tab ${tabId}, viewer filename: ${tabData.viewer.file.name}`);
        if (filename && tabData.viewer.file.name === filename) {
          console.log(`[TabManager] Notifying viewer in tab ${tabId} about resource update by filename`);
          
          // Check if the viewer has an onResourceUpdated method
          if (typeof tabData.viewer.onResourceUpdated === 'function') {
            tabData.viewer.onResourceUpdated(property, value);
          } else {
            console.log(`[TabManager] Viewer in tab ${tabId} has no onResourceUpdated method`);
          }
        }
      }
    }
    
    // Also check preview tab
    console.log(`[TabManager] Checking preview viewer, filename: ${this.previewViewer?.file?.name}`);
    if (this.previewViewer && this.previewViewer.file && filename && this.previewViewer.file.name === filename) {
      console.log(`[TabManager] Notifying preview viewer about resource update by filename: ${filename}`);
      if (typeof this.previewViewer.onResourceUpdated === 'function') {
        this.previewViewer.onResourceUpdated(property, value);
      } else {
        console.log(`[TabManager] Preview viewer has no onResourceUpdated method`);
      }
    } else {
      console.log(`[TabManager] Preview viewer filename check - previewViewer.file.name: ${this.previewViewer?.file?.name}, notification filename: ${filename}`);
    }
  }
  
  // Callback system for tab changes
  onTabChange(callback) {
    this.onTabChangeCallbacks.push(callback);
  }
  
  notifyTabChange(tabId) {
    this.onTabChangeCallbacks.forEach(callback => {
      try {
        callback(tabId);
      } catch (error) {
        console.error('[TabManager] Error in tab change callback:', error);
      }
    });
  }
  
  // Update tab file reference after saving
  updateTabFile(viewer, newFile) {
    for (const [tabId, tabData] of this.tabs.entries()) {
      if (tabData.viewer === viewer) {
        tabData.file = newFile;
        console.log(`[TabManager] Updated file reference for tab ${tabId}: ${newFile.name}`);
        break;
      }
    }
  }

  // Auto-save all open tabs
  async saveAllOpenTabs() {
    console.log('[TabManager] Auto-saving all open tabs before build...');
    const savedTabs = [];
    
    // Save preview tab if it has unsaved changes
    if (this.previewViewer && this.previewViewer.save && typeof this.previewViewer.save === 'function') {
      try {
        await this.previewViewer.save();
        savedTabs.push('preview');
      } catch (error) {
        console.error('[TabManager] Failed to save preview tab:', error);
      }
    }
    
    // Save all dedicated tabs
    for (const [tabId, tabData] of this.tabs.entries()) {
      if (tabData.viewer && tabData.viewer.save && typeof tabData.viewer.save === 'function') {
        try {
          await tabData.viewer.save();
          savedTabs.push(tabId);
        } catch (error) {
          console.error(`[TabManager] Failed to save tab ${tabId}:`, error);
        }
      }
    }
    
    console.log(`[TabManager] Saved ${savedTabs.length} tabs:`, savedTabs);
    return savedTabs;
  }

  // Refresh build file tabs after a build
  async refreshBuildTabs(buildFiles) {
    console.log('[TabManager] Refreshing build file tabs...');
    const buildFilePaths = new Set(buildFiles.map(f => f.path));
    const tabsToClose = [];
    const tabsToRefresh = [];
    
    // Check all tabs for build files
    for (const [tabId, tabData] of this.tabs.entries()) {
      if (tabData.filePath && tabData.filePath.startsWith('Build/')) {
        if (buildFilePaths.has(tabData.filePath)) {
          // File still exists in build output - refresh it
          tabsToRefresh.push({ tabId, tabData });
        } else {
          // File no longer exists in build output - close the tab
          tabsToClose.push(tabId);
        }
      }
    }
    
    // Close tabs for files that no longer exist
    for (const tabId of tabsToClose) {
      console.log(`[TabManager] Closing tab ${tabId} - file no longer in build output`);
      this.closeTab(tabId);
    }
    
    // Refresh tabs for files that still exist
    for (const { tabId, tabData } of tabsToRefresh) {
      try {
        console.log(`[TabManager] Refreshing tab ${tabId} for build file: ${tabData.filePath}`);
        const buildFile = buildFiles.find(f => f.path === tabData.filePath);
        
        if (buildFile && tabData.viewer) {
          // Try different refresh methods depending on viewer type
          if (tabData.viewer.loadFileContent && typeof tabData.viewer.loadFileContent === 'function') {
            await tabData.viewer.loadFileContent();
          } else if (tabData.viewer.refresh && typeof tabData.viewer.refresh === 'function') {
            await tabData.viewer.refresh();
          } else if (tabData.viewer.load && typeof tabData.viewer.load === 'function') {
            await tabData.viewer.load();
          } else {
            console.log(`[TabManager] No refresh method available for tab ${tabId}`);
          }
        }
      } catch (error) {
        console.error(`[TabManager] Failed to refresh tab ${tabId}:`, error);
      }
    }
    
    console.log(`[TabManager] Closed ${tabsToClose.length} tabs, refreshed ${tabsToRefresh.length} tabs`);
  }

  // Check if a file path is a build file
  isBuildFile(filePath) {
    return filePath && filePath.startsWith('Build/');
  }
}

// Export for use
window.TabManager = TabManager;
