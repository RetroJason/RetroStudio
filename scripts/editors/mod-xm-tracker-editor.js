// BassoonTracker MOD/XM Editor with FileIOService Integration
// Uses iframe isolation for multiple instances while avoiding ArrayBuffer serialization issues

class ModXmTrackerEditor extends EditorBase {
  constructor(arg1, arg2 = false, arg3 = null) {
    // Support signatures: (path, isNew) OR (fileRecord, path, isNew)
    let fileRecord = null; let path = null; let isNewResource = false;
    if (typeof arg1 === 'object' && arg1 && arg1.filename && typeof arg2 === 'string') {
      fileRecord = arg1; path = arg2; isNewResource = !!arg3;
    } else {
      path = arg1; isNewResource = !!arg2;
    }
    
    // MUST call super() first before accessing 'this'
    super(path, isNewResource);
    
    // Initialize instance variables
    this._container = null;
    this._iframe = null;
    this._logPrefix = '[ModXmTrackerEditor]';
    this._readyReceived = false;
    this._initialLoadSent = false; // Track if initial file/demo load has been sent
    this._initialFileRecord = fileRecord;
    this._id = 'mod-xm-tracker-' + Math.random().toString(36).substring(2);
    this._hasLoadedNewSong = false; // Track when new songs are loaded
    this._currentFilename = null; // Current loaded song filename
    
    try { 
      console.log(this._logPrefix, 'constructor completed', { 
        path, isNewResource, hasFileRecord: !!fileRecord, id: this._id 
      }); 
    } catch(_) {}
  }

  // Metadata
  static getFileExtensions() { return ['.mod', '.xm']; }
  static getDisplayName() { return 'MOD/XM Tracker'; }
  static getIcon() { return '🎵'; }
  static getCreateIcon() { return '🎵'; }
  static getPriority() { return 5; }
  static getCapabilities() { return ['audio', 'music', 'tracker']; }
  static canCreate = true;
  static getCreateLabel() { return 'Music'; }
  static getDefaultFolder() { return 'Sources/Music'; }
  static needsFilenamePrompt() { return false; } // Skip prompt since demo always loads
  
  // iframe-based embedding for clean isolation
  createBody(body) {
    try { 
      console.log(this._logPrefix, 'createBody called', { bodyExists: !!body, id: this._id }); 
    } catch(_) {}
    
    body.style.cssText = 'display:block;width:100%;height:100%;padding:0;margin:0;overflow:hidden;position:relative;background:#1a1a1a;';
    this._container = body;

    // Create iframe element directly for better control
    this._iframe = document.createElement('iframe');
    this._iframe.id = `${this._id}-iframe`;
    
    // For existing files (not temp:// paths), disable demo loading by adding skipDemo parameter
    const isExistingFile = !this.isNewResource && this.path && !this.path.startsWith('temp://');
    const iframeSrc = isExistingFile ? 'bt-host.html?skipDemo=1' : 'bt-host.html';
    this._iframe.src = iframeSrc;
    this._iframe.style.cssText = 'width: 100%; height: 100%; border: none; display: block;';
    
    // Remove all possible restrictions for iframe communication
    this._iframe.setAttribute('allow', 'autoplay; microphone; camera; fullscreen; geolocation; payment; usb');
    this._iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-top-navigation allow-pointer-lock');
    this._iframe.setAttribute('referrerpolicy', 'same-origin');
    this._iframe.setAttribute('loading', 'eager');
    
    body.appendChild(this._iframe);
    
    // Store strong reference to prevent garbage collection
    this._iframeRef = this._iframe;
    window[`_iframe_${this._id}`] = this._iframe; // Global reference as backup
    
    // Set up DOM mutation observer to detect if iframe gets removed
    if (typeof MutationObserver !== 'undefined') {
      this._mutationObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList' && mutation.removedNodes) {
            for (let node of mutation.removedNodes) {
              if (node === this._iframe || node.contains?.(this._iframe)) {
                console.error(`${this._logPrefix} iframe was removed from DOM by external code!`);
                // Try to restore it
                this._restoreIframe();
                break;
              }
            }
          }
        });
      });
      this._mutationObserver.observe(body, { childList: true, subtree: true });
    }
    
    // Set up communication
    this._setupIframeCommunication();
    
    // Hooks and initial sizing
    this._hookResize();
    this._sizeToTab('init');
    
    try { 
      console.log(this._logPrefix, 'iframe created and communication setup', { 
        id: this._id, 
        src: this._iframe.src,
        parentElement: !!this._iframe.parentElement
      }); 
    } catch(_) {}
  }

  _setupIframeCommunication() {
    // Listen for messages from iframe
    this._messageHandler = (e) => {
      const msg = e.data || {};
      if (!msg || !msg.type) return;
      
      if (msg.type === 'bt-ready') {
        console.log(`${this._logPrefix} BassoonTracker ready in iframe`);
        this._readyReceived = true;
        this._maybeSendFile();
      } else if (msg.type === 'file-load-result') {
        console.log(`${this._logPrefix} File load result:`, msg);
        if (msg.success) {
          console.log(`${this._logPrefix} File loaded successfully via FileIOService`);
        } else {
          console.error(`${this._logPrefix} File load failed:`, msg.error);
        }
      } else if (msg.type === 'bt-load-invoked') {
        console.log(`${this._logPrefix} BassoonTracker loaded new file internally:`, msg.url);
        this._handleInternalFileLoad(msg.url);
        // Mark that a new song has been loaded
        this._hasLoadedNewSong = true;
        // Extract filename from URL for display
        if (msg.url) {
          const urlParts = msg.url.split('/');
          this._currentFilename = urlParts[urlParts.length - 1];
        }
      } else if (msg.type === 'save-to-project') {
        console.log(`${this._logPrefix} Save to project requested:`, msg.filename);
        this._handleSaveToProject(msg.filename, msg.data, msg.mimeType);
      }
    };
    
    window.addEventListener('message', this._messageHandler);
    
    // Set up iframe load handling with multiple approaches
    if (this._iframe) {
      // Try immediate ping in case iframe loads very quickly
      setTimeout(() => this._sendPing(), 50);
      
      // Set up onload handler
      this._iframe.onload = () => {
        console.log(`${this._logPrefix} iframe onload event fired`);
        setTimeout(() => this._sendPing(), 100);
      };
      
      // Fallback: try periodic pings for first few seconds
      let attempts = 0;
      const maxAttempts = 20; // 2 seconds total
      const pingInterval = setInterval(() => {
        attempts++;
        if (this._readyReceived || attempts >= maxAttempts) {
          clearInterval(pingInterval);
          return;
        }
        this._sendPing();
      }, 100);
    }
  }

  _restoreIframe() {
    if (!this._container) {
      console.error(`${this._logPrefix} cannot restore iframe - no container`);
      return;
    }
    
    console.log(`${this._logPrefix} attempting to restore iframe`);
    
    // Clear container and recreate iframe
    this._container.innerHTML = '';
    
    this._iframe = document.createElement('iframe');
    this._iframe.id = `${this._id}-iframe`;
    this._iframe.src = 'bt-host.html';
    this._iframe.style.cssText = 'width: 100%; height: 100%; border: none; display: block;';
    
    // Remove all possible restrictions for iframe communication
    this._iframe.setAttribute('allow', 'autoplay; microphone; camera; fullscreen; geolocation; payment; usb');
    this._iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-top-navigation allow-pointer-lock');
    this._iframe.setAttribute('referrerpolicy', 'same-origin');
    this._iframe.setAttribute('loading', 'eager');
    
    this._container.appendChild(this._iframe);
    
    // Update references
    this._iframeRef = this._iframe;
    window[`_iframe_${this._id}`] = this._iframe;
    
    // Set up new onload handler
    this._iframe.onload = () => {
      console.log(`${this._logPrefix} restored iframe loaded`);
      setTimeout(() => this._sendPing(), 100);
    };
    
    console.log(`${this._logPrefix} iframe restored successfully`);
  }

  _sendPing() {
    if (!this._iframe) {
      console.error(`${this._logPrefix} iframe element is null - checking if it was removed from DOM`);
      // Try to find it again by ID
      this._iframe = document.getElementById(`${this._id}-iframe`);
      if (!this._iframe) {
        // Try backup references
        this._iframe = this._iframeRef || window[`_iframe_${this._id}`];
        if (!this._iframe) {
          console.error(`${this._logPrefix} iframe completely missing from DOM - attempting restore`);
          this._restoreIframe();
          return;
        } else {
          console.log(`${this._logPrefix} iframe recovered from backup reference`);
        }
      } else {
        console.log(`${this._logPrefix} iframe found again by ID - was temporarily null`);
      }
    }
    
    // Check iframe properties for debugging
    console.log(`${this._logPrefix} iframe debug info:`, {
      id: this._iframe.id,
      src: this._iframe.src,
      readyState: this._iframe.readyState,
      contentWindow: !!this._iframe.contentWindow,
      contentDocument: !!this._iframe.contentDocument,
      parentNode: !!this._iframe.parentNode,
      offsetWidth: this._iframe.offsetWidth,
      offsetHeight: this._iframe.offsetHeight
    });
    
    if (this._iframe.contentWindow) {
      console.log(`${this._logPrefix} Sending ping to iframe`);
      try {
        this._iframe.contentWindow.postMessage({type: 'ping'}, '*');
      } catch (e) {
        console.error(`${this._logPrefix} Failed to send ping:`, e);
      }
    } else {
      console.warn(`${this._logPrefix} iframe contentWindow not accessible yet`);
    }
  }

  _maybeSendFile() {
    if (!this._readyReceived) {
      console.log(`${this._logPrefix} Not ready yet, deferring file send`);
      return;
    }
    
    if (this._initialLoadSent) {
      console.log(`${this._logPrefix} Initial load already sent, skipping`);
      return;
    }
    
    if (!this._iframe) {
      console.error(`${this._logPrefix} iframe element is null - attempting recovery`);
      this._iframe = document.getElementById(`${this._id}-iframe`) || this._iframeRef || window[`_iframe_${this._id}`];
      if (!this._iframe) {
        console.error(`${this._logPrefix} iframe completely missing - attempting restore`);
        this._restoreIframe();
        return;
      }
    }
    
    if (!this._iframe.contentWindow) {
      console.warn(`${this._logPrefix} iframe contentWindow not accessible for file sending`);
      console.log(`${this._logPrefix} iframe state:`, {
        id: this._iframe.id,
        src: this._iframe.src,
        readyState: this._iframe.readyState,
        parentNode: !!this._iframe.parentNode
      });
      return;
    }

    // Determine what to load
    const isExistingFile = !this.isNewResource && this.path && !this.path.startsWith('temp://');
    if (isExistingFile) {
      // Load existing file via FileIOService
      console.log(`${this._logPrefix} Loading existing file from path: ${this.path}`);
      const filename = this._initialFileRecord?.filename || this.path.split('/').pop() || 'untitled.mod';
      try {
        this._iframe.contentWindow.postMessage({
          type: 'load-file-from-service',
          filePath: this.path,
          filename: filename
        }, '*');
        this._initialLoadSent = true; // Mark as sent
      } catch (e) {
        console.error(`${this._logPrefix} Failed to send file load message:`, e);
      }
    } else {
      // Load demo for new files
      console.log(`${this._logPrefix} Loading demo for new file`);
      try {
        this._iframe.contentWindow.postMessage({type: 'load-demo'}, '*');
        this._initialLoadSent = true; // Mark as sent
      } catch (e) {
        console.error(`${this._logPrefix} Failed to send demo load message:`, e);
      }
    }
  }

  _hookResize() {
    this._onWinResize = () => this._sizeToTab('window');
    window.addEventListener('resize', this._onWinResize);

    this._onSidebarResize = () => this._sizeToTab('sidebar');
    window.addEventListener('project-explorer.resized', this._onSidebarResize);

    const pane = this._closestTabPane() || this._container;
    if (typeof ResizeObserver !== 'undefined' && pane) {
      this._hostRO = new ResizeObserver(() => this._sizeToTab('ro'));
      try { this._hostRO.observe(pane); } catch(_) {}
    }

    this._onTabSwitched = () => {
      this._sizeToTab('tab');
      setTimeout(() => { this._sizeToTab('tab-deferred'); }, 0);
      try { requestAnimationFrame(() => { this._sizeToTab('tab-raf'); }); } catch(_) {}
    };
    try { window.eventBus?.on?.('tab.switched', this._onTabSwitched); } catch(_) {}
  }

  _closestTabPane() {
    try { return (this._container || this.element)?.closest?.('.tab-pane') || null; } catch(_) { return null; }
  }

  _getActiveTabPane() {
    try {
      const mine = this._container?.closest?.('.tab-pane');
      if (mine && mine.classList && mine.classList.contains('active')) return mine;
    } catch(_) {}
    try { return window.tabManager?.tabContentArea?.querySelector?.('.tab-pane.active') || null; } catch(_) { return null; }
  }

  _getTabInnerSize() {
    const target = this._getActiveTabPane() || this._closestTabPane();
    if (!target) {
      console.error('[ModXmTrackerEditor] No .tab-pane found for sizing (strict mode).');
      return null;
    }
    const width = Math.floor(target.clientWidth || 0);
    const height = Math.floor(target.clientHeight || 0);
    if (!width || !height) {
      console.error('[ModXmTrackerEditor] .tab-pane has zero size (strict mode).', {
        clientW: target.clientWidth,
        clientH: target.clientHeight
      });
      return null;
    }
    return { width, height, target };
  }

  _sizeToTab(reason) {
    if (!this._container || !this._iframe) return;
    const info = this._getTabInnerSize();
    if (!info) return;
    
    // iframe automatically sizes to 100% of container, so just ensure container is sized
    try { 
      console.debug(this._logPrefix, 'sizeToTab', reason, { 
        width: info.width, 
        height: info.height 
      }); 
    } catch(_) {}
  }

  // FileIOService integration methods
  async reload() { 
    console.log(`${this._logPrefix} reload called`);
    this._maybeSendFile();
    return true; 
  }
  
  updateFilePath(newPath) { 
    console.log(`${this._logPrefix} updateFilePath called:`, newPath);
    this.path = newPath;
  }
  
  async loadPath(path) { 
    console.log(`${this._logPrefix} loadPath called:`, path);
    this.path = path;
    this._maybeSendFile();
    return true; 
  }

  // Called when a file is set/changed
  setFile(fileRecord) {
    console.log(`${this._logPrefix} setFile called:`, fileRecord);
    this._initialFileRecord = fileRecord;
    if (fileRecord && fileRecord.path) {
      this.path = fileRecord.path;
      this.isNewResource = false;
    }
    this._maybeSendFile();
  }

  // Cleanup resources
  cleanup() {
    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
      this._messageHandler = null;
    }
    
    // Stop observing DOM mutations
    if (this._mutationObserver) {
      this._mutationObserver.disconnect();
      this._mutationObserver = null;
    }
    
    // Clean up iframe references
    if (this._iframe) {
      this._iframe.src = 'about:blank'; // Stop any loading
      this._iframe.remove?.();
    }
    
    // Remove global reference
    if (this._id && window[`_iframe_${this._id}`]) {
      delete window[`_iframe_${this._id}`];
    }
    
    this._iframe = null;
    this._iframeRef = null;
    
    try { if (this._hostRO) { this._hostRO.disconnect?.(); this._hostRO = null; } } catch (_) {}
    try { if (this._onWinResize) window.removeEventListener('resize', this._onWinResize); } catch (_) {}
    try { if (this._onSidebarResize) window.removeEventListener('project-explorer.resized', this._onSidebarResize); } catch (_) {}
    try { if (this._onTabSwitched && window.eventBus?.off) window.eventBus.off('tab.switched', this._onTabSwitched); } catch (_) {}
    
    console.log(`${this._logPrefix} cleanup completed`);
  }

  _handleInternalFileLoad(url) {
    console.log(`${this._logPrefix} handling internal file load:`, url);
    
    // Extract filename from URL 
    let newFilename = 'untitled.mod';
    try {
      if (url) {
        // Handle object URLs with fragment (blob:...#filename.mod)
        if (url.includes('#')) {
          newFilename = decodeURIComponent(url.split('#')[1]);
        } else {
          // Extract from regular URL path
          const urlPath = url.split('/').pop().split('?')[0];
          if (urlPath && urlPath.length > 0) {
            newFilename = urlPath;
          }
        }
      }
    } catch (e) {
      console.warn(`${this._logPrefix} failed to extract filename from URL:`, e);
    }

    console.log(`${this._logPrefix} extracted filename: ${newFilename}`);

    // Update tab to reflect the new file
    this._updateTabForNewFile(newFilename, url);
  }

  _handleSaveToProject(filename, dataArray, mimeType) {
    console.log(`${this._logPrefix} handling save to project:`, { filename, dataLength: dataArray?.length, mimeType });
    
    try {
      // Convert data array back to Uint8Array
      const content = new Uint8Array(dataArray);
      
      // For temporary files OR when loading a new song, always prompt for filename
      if (this.path.startsWith('temp://') || this._hasLoadedNewSong) {
        // Use the current loaded filename as suggestion, or the passed filename
        let suggestedName = this._currentFilename || filename || 'song.mod';
        
        // Remove path and extension for cleaner suggestion
        if (suggestedName.includes('/')) {
          suggestedName = suggestedName.split('/').pop();
        }
        if (suggestedName.includes('.')) {
          suggestedName = suggestedName.substring(0, suggestedName.lastIndexOf('.'));
        }
        
        const finalFilename = prompt('Save as:', suggestedName);
        if (!finalFilename) {
          console.log(`${this._logPrefix} save cancelled by user`);
          return;
        }
        
        // Check if file exists and prompt for overwrite
        const project = window.gameEditor?.projectExplorer?.getFocusedProjectName?.();
        const defaultFolder = this.constructor.getDefaultFolder();
        const extension = finalFilename.includes('.') ? '' : '.mod'; // Add .mod if no extension
        const fullFilename = finalFilename + extension;
        
        const uiFolder = window.ProjectPaths?.withProjectPrefix ? 
          window.ProjectPaths.withProjectPrefix(project, defaultFolder) : 
          (project ? `${project}/${defaultFolder}` : defaultFolder);
        const fullUiPath = `${uiFolder}/${fullFilename}`;
        
        // Check if file exists
        if (window.gameEditor?.projectExplorer?.fileExists?.(fullUiPath)) {
          if (!confirm(`File "${fullFilename}" already exists. Overwrite?`)) {
            console.log(`${this._logPrefix} overwrite cancelled by user`);
            return;
          }
        }
        
        // Convert to non-temporary path and mark for new file creation
        this.path = fullUiPath;
        this.isNewResource = true;
        this._currentFilename = fullFilename;
        this._hasLoadedNewSong = false; // Reset flag
        
        // Update tab title to reflect new filename
        const tabManager = window.serviceContainer?.get('tabManager') || window.tabManager;
        if (tabManager) {
          const currentTabId = tabManager.getActiveTabId?.() || tabManager.activeTabId;
          if (currentTabId && tabManager.updateTabTitle) {
            tabManager.updateTabTitle(currentTabId, `🎵 ${fullFilename}`);
          }
        }
      }
      
      // Save using the parent class method with the binary content
      this._saveContentToProject(content);
      
    } catch (error) {
      console.error(`${this._logPrefix} save to project failed:`, error);
      alert(`Failed to save to project: ${error.message}`);
    }
  }

  async _saveContentToProject(content) {
    try {
      // Use the EditorBase saveNewResource method
      const name = this.getFileName();
      
      // Get project and folder info
      const project = window.gameEditor?.projectExplorer?.getFocusedProjectName?.();
      const defaultFolder = this.constructor.getDefaultFolder();
      const extension = this.getFileExtension(name);
      
      // Build paths
      const uiFolder = window.ProjectPaths?.withProjectPrefix ? 
        window.ProjectPaths.withProjectPrefix(project, defaultFolder) : 
        (project ? `${project}/${defaultFolder}` : defaultFolder);
      const fullUiPath = `${uiFolder}/${name}`;
      const storagePath = window.ProjectPaths?.normalizeStoragePath ? 
        window.ProjectPaths.normalizeStoragePath(fullUiPath) : fullUiPath;
      
      // Save to persistent storage using the file I/O service
      if (window.fileIOService) {
        await window.fileIOService.saveFile(storagePath, content, {
          type: extension.substring(1), // Remove the dot
          editor: this.constructor.name
        });
        console.log(`${this._logPrefix} saved to persistent storage: ${storagePath}`);
      }
      
      // Add to project explorer
      if (window.gameEditor && window.gameEditor.projectExplorer) {
        const file = new File([content], name, { type: 'application/octet-stream' });
        window.gameEditor.projectExplorer.addFileToProject(file, uiFolder, true); // Skip auto-open during save
      }
      
      // Update path and mark as saved
      this.path = fullUiPath;
      this.isNewResource = false;
      this.markClean();
      
      console.log(`${this._logPrefix} successfully saved to project: ${name}`);
      
    } catch (error) {
      console.error(`${this._logPrefix} failed to save content to project:`, error);
      throw error;
    }
  }

  _updateTabForNewFile(filename, sourceUrl) {
    console.log(`${this._logPrefix} updating tab for new file:`, { filename, sourceUrl });
    
    // Get the tab manager to update the tab
    const tabManager = window.serviceContainer?.get('tabManager') || window.tabManager;
    if (!tabManager) {
      console.warn(`${this._logPrefix} tabManager not available for tab update`);
      return;
    }

    // Find the current tab
    const currentTabId = tabManager.getActiveTabId?.() || tabManager.activeTabId;
    if (!currentTabId) {
      console.warn(`${this._logPrefix} no active tab found`);
      return;
    }

    // Update the tab title and properties to reflect the new file
    try {
      // Mark as modified/different from original
      this.isNewResource = true;
      this._currentFilename = filename;
      this._currentSourceUrl = sourceUrl;
      
      // Update the display name to show it's a new file
      const displayName = filename.endsWith('.mod') || filename.endsWith('.xm') ? 
        filename : `${filename} (MOD/XM)`;
      
      // Try to update the tab title
      if (tabManager.updateTabTitle) {
        tabManager.updateTabTitle(currentTabId, `🎵 ${displayName} (loaded)`);
      } else {
        // Fallback: find and update tab element directly
        const tabElement = document.querySelector(`[data-tab-id="${currentTabId}"] .tab-title`);
        if (tabElement) {
          tabElement.textContent = `🎵 ${displayName} (loaded)`;
        }
      }

      // Update window title if this is the active tab
      if (currentTabId === tabManager.getActiveTabId?.()) {
        document.title = `RetroStudio - ${displayName}`;
      }

      console.log(`${this._logPrefix} tab updated for new file: ${displayName}`);

    } catch (e) {
      console.error(`${this._logPrefix} failed to update tab:`, e);
    }
  }

  // Save functionality - required for EditorBase
  getContent() {
    // For MOD/XM files, we need to get the current file data from BassoonTracker
    // This will be the binary data of the current module
    try {
      if (this._iframe && this._iframe.contentWindow) {
        // Try to get the current module data from BassoonTracker
        const btWindow = this._iframe.contentWindow;
        if (btWindow.tracker && btWindow.tracker.getModuleData) {
          const moduleData = btWindow.tracker.getModuleData();
          if (moduleData) {
            return moduleData; // Should be ArrayBuffer or Uint8Array
          }
        }
        
        // Alternative: try to export current module
        if (btWindow.exportCurrentModule) {
          return btWindow.exportCurrentModule();
        }
      }
    } catch (e) {
      console.warn(`${this._logPrefix} failed to get content from BassoonTracker:`, e);
    }
    
    // Fallback: return empty MOD file data or default content
    return new Uint8Array(0);
  }

  // Override save to handle filename prompting for temporary files
  async save() {
    try {
      // If this is a temporary file (starts with temp://) prompt for filename
      if (this.path.startsWith('temp://')) {
        const currentFilename = this._currentFilename || 'untitled.mod';
        const filename = prompt('Save as:', currentFilename);
        if (!filename) {
          return; // User cancelled
        }
        
        // Check if file exists and prompt for overwrite
        const project = window.gameEditor?.projectExplorer?.getFocusedProjectName?.();
        const defaultFolder = this.constructor.getDefaultFolder();
        const extension = filename.includes('.') ? '' : '.mod'; // Add .mod if no extension
        const fullFilename = filename + extension;
        
        const uiFolder = window.ProjectPaths?.withProjectPrefix ? 
          window.ProjectPaths.withProjectPrefix(project, defaultFolder) : 
          (project ? `${project}/${defaultFolder}` : defaultFolder);
        const fullUiPath = `${uiFolder}/${fullFilename}`;
        
        // Check if file exists
        if (window.gameEditor?.projectExplorer?.fileExists?.(fullUiPath)) {
          if (!confirm(`File "${fullFilename}" already exists. Overwrite?`)) {
            return; // User cancelled overwrite
          }
        }
        
        // Convert to non-temporary path and mark as new resource
        this.path = fullUiPath;
        this.isNewResource = true;
        this._currentFilename = fullFilename;
        
        // Update tab title to reflect new filename
        const tabManager = window.serviceContainer?.get('tabManager') || window.tabManager;
        if (tabManager) {
          const currentTabId = tabManager.getActiveTabId?.() || tabManager.activeTabId;
          if (currentTabId && tabManager.updateTabTitle) {
            tabManager.updateTabTitle(currentTabId, `🎵 ${fullFilename}`);
          }
        }
      }
      
      // Call parent save method
      await super.save();
      
    } catch (error) {
      console.error(`${this._logPrefix} save failed:`, error);
      alert(`Failed to save: ${error.message}`);
    }
  }

  destroy() {
    console.log(`${this._logPrefix} destroy called`);
    this.cleanup();
    super.destroy?.();
  }
}

// Export for global access
window.ModXmTrackerEditor = ModXmTrackerEditor;
