// BassoonTracker MOD/XM Editor with FileIOService Integration
// Uses iframe isolation for multiple instances while avoiding ArrayBuffer serialization issues

class ModXmTrackerEditor extends EditorBase {
  constructor(fileObject = null, readOnly = false) {
    // Support legacy constructor signatures
    if (arguments.length >= 2 && typeof arguments[0] === 'string') {
      const path = arguments[0];
      const convertedFileObject = path ? { path } : null;
      super(convertedFileObject, readOnly);
    } else if (arguments.length >= 2 && typeof arguments[0] === 'object' && typeof arguments[1] === 'string') {
      const fileRecord = arguments[0];
      super(fileRecord, readOnly);
    } else {
      super(fileObject, readOnly);
    }

    this._container = null;
    this._iframe = null;
    this._logPrefix = '[ModXmTrackerEditor]';
    this._readyReceived = false;
    this._initialLoadSent = false;
    this._initialFileRecord = fileObject;
    this._id = 'mod-xm-tracker-' + Math.random().toString(36).substring(2);
    this._currentFilename = null;

    try {
      console.log(this._logPrefix, 'constructor completed', {
        path: this.path, isNewResource: this.isNewResource, hasFileRecord: !!this.file, id: this._id
      });
    } catch(_) {}
  }

  // Metadata
  static getFileExtensions() { return ['.mod', '.xm']; }
  static getFileExtension() { return '.mod'; }
  static getDisplayName() { return 'MOD/XM Tracker'; }
  static getIcon() { return '🎵'; }
  static getCreateIcon() { return '🎵'; }
  static getPriority() { return 5; }
  static getCapabilities() { return ['audio', 'music', 'tracker']; }
  static canCreate = true;
  static getCreateLabel() { return 'Music'; }
  static getDefaultFolder() { return 'Sources/Music'; }
  static needsFilenamePrompt() { return true; }

  createBody(body) {
    body.style.cssText = 'display:block;width:100%;height:100%;padding:0;margin:0;overflow:hidden;position:relative;background:#1a1a1a;';
    this._container = body;
    this._iframe = document.createElement('iframe');
    this._iframe.id = `${this._id}-iframe`;
    this._iframe.src = 'bt-host.html';
    this._iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
    this._iframe.setAttribute('allow', 'autoplay; microphone; camera; fullscreen; geolocation; payment; usb');
    this._iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-same-origin');
    this._iframe.setAttribute('referrerpolicy', 'same-origin');
    this._iframe.setAttribute('loading', 'eager');
    body.appendChild(this._iframe);
    this._iframeRef = this._iframe;
    window[`_iframe_${this._id}`] = this._iframe;
    this._observeIframeRemoval();
    this._setupIframeCommunication();
    this._hookResize();
    this._sizeToTab('init');
  }

  _observeIframeRemoval() {
    if (typeof MutationObserver === 'undefined' || !this._container) return;
    this._mutationObserver = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'childList') {
          for (const n of m.removedNodes) {
            if (n === this._iframe || n.contains?.(this._iframe)) {
              console.error(this._logPrefix, 'iframe removed unexpectedly');
              this._restoreIframe();
              return;
            }
          }
        }
      }
    });
    this._mutationObserver.observe(this._container, { childList: true, subtree: true });
  }

  _setupIframeCommunication() {
    this._messageHandler = (e) => {
      const msg = e.data || {};
      if (!msg.type) return;
      if (msg.type === 'bt-ready') {
        this._readyReceived = true;
        this._maybeSendFile();
      } else if (msg.type === 'module-loaded') {
        // Final confirmation of full song structure; ensure tab reflects real filename
        if (msg.title && msg.title.length > 0 && this._currentFilename && this._currentFilename.startsWith('untitled')) {
          // Optionally update window title; keep existing filename until user saves
          document.title = `RetroStudio - ${msg.title}`;
        }
        // Clear any internal duplicate load suppression flags
        this._pendingModuleLoad = false;
        // Mark export ready once tracker reports a module loaded and buildBinary exists
        try {
          const win = this._iframe?.contentWindow;
          const deRef = win && (win.de || win.BassoonTracker || {});
          if (deRef && typeof deRef.buildBinary === 'function') {
            this._exportReady = true;
          }
        } catch(_){}
      } else if (msg.type === 'file-load-result') {
        if (msg.success) this._justLoadedExistingProjectFile = true; else console.error(this._logPrefix, 'File load failed', msg.error);
      } else if (msg.type === 'bt-load-invoked') {
        if (!msg.url || !msg.url.startsWith('buffer://')) {
          if (this._justLoadedExistingProjectFile) {
            this._justLoadedExistingProjectFile = false;
            this._handleExistingProjectFileLoad(msg.url);
          } else {
            this._handleInternalFileLoad(msg.url);
          }
        }
        if (msg.url) {
          if (msg.url.startsWith('buffer://')) {
            this._currentFilename = msg.filename || msg.url.substring(9);
          } else {
            const parts = msg.url.split('/');
            this._currentFilename = parts[parts.length - 1];
          }
        }
      }
    };
    window.addEventListener('message', this._messageHandler);
    if (this._iframe) {
      setTimeout(() => this._sendPing(), 50);
      this._iframe.onload = () => setTimeout(() => this._sendPing(), 100);
      let attempts = 0;
      const pingInterval = setInterval(() => {
        attempts++;
        if (this._readyReceived || attempts >= 20) {
          clearInterval(pingInterval);
          return;
        }
        this._sendPing();
      }, 100);
    }
  }

  _restoreIframe() {
    if (!this._container) return;
    this._container.innerHTML = '';
    this._iframe = document.createElement('iframe');
    this._iframe.id = `${this._id}-iframe`;
    this._iframe.src = 'bt-host.html';
    this._iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
    this._iframe.setAttribute('allow', 'autoplay; microphone; camera; fullscreen; geolocation; payment; usb');
    this._iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-same-origin');
    this._iframe.setAttribute('referrerpolicy', 'same-origin');
    this._iframe.setAttribute('loading', 'eager');
    this._container.appendChild(this._iframe);
    this._iframeRef = this._iframe;
    window[`_iframe_${this._id}`] = this._iframe;
    this._iframe.onload = () => setTimeout(() => this._sendPing(), 100);
  }

  _sendPing() {
    if (!this._iframe) {
      this._iframe = document.getElementById(`${this._id}-iframe`) || this._iframeRef || window[`_iframe_${this._id}`];
      if (!this._iframe) { this._restoreIframe(); return; }
    }
    if (this._iframe.contentWindow) {
      try { this._iframe.contentWindow.postMessage({ type: 'ping' }, '*'); } catch(_) {}
    }
  }

  _maybeSendFile() {
    if (!this._readyReceived || this._initialLoadSent || !this._iframe || !this._iframe.contentWindow) return;
    // Ensure host pane has non-zero size (preview tab animation may still be in progress)
    const pane = this._getActiveTabPane() || this._closestTabPane();
    const w = pane?.clientWidth || 0;
    const h = pane?.clientHeight || 0;
    if (!w || !h) {
      this._initialLoadSizeChecks = (this._initialLoadSizeChecks || 0) + 1;
      if (this._initialLoadSizeChecks < 40) { // retry up to ~4s (40 * 100ms)
        setTimeout(() => this._maybeSendFile(), 100);
      } else {
        console.warn(`${this._logPrefix} giving up waiting for non-zero size; proceeding with load`);
      }
      if (w === 0 || h === 0) return; // don't proceed until we have a size (unless retries exhausted)
    }
    const isExisting = !this.isNewResource && this.path && !this.path.startsWith('temp://');
    if (isExisting) {
      const filename = this._initialFileRecord?.filename || (this.path ? this.path.split('/').pop() : 'untitled.mod');
      this._iframe.contentWindow.postMessage({ type: 'load-file-from-service', filePath: this.path, filename }, '*');
      this._justLoadedExistingProjectFile = true;
    } else {
      this._iframe.contentWindow.postMessage({ type: 'load-demo' }, '*');
    }
    this._initialLoadSent = true;
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
      setTimeout(() => this._sizeToTab('tab-deferred'), 0);
      try { requestAnimationFrame(() => this._sizeToTab('tab-raf')); } catch(_) {}
    };
    window.eventBus?.on?.('tab.switched', this._onTabSwitched);
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

  // Update tab to reflect the new file (internal source -> unsaved *)
  this._updateTabForNewFile(newFilename, url, { internal: true });
  }

  _handleExistingProjectFileLoad(url) {
    console.log(`${this._logPrefix} handling existing project file load:`, url);
    // Extract filename similarly
    let filename = 'song.mod';
    try {
      if (url) {
        if (url.includes('#')) {
          filename = decodeURIComponent(url.split('#')[1]);
        } else {
          const urlPath = url.split('/').pop().split('?')[0];
          if (urlPath) filename = urlPath;
        }
      }
    } catch(_) {}
    this._updateTabForNewFile(filename, url, { existing: true });
  }

  async _handleSaveToProject(filename, dataArray, mimeType) {
  // Deprecated: internal tracker save interception removed for deterministic path
  }


  _updateTabForNewFile(filename, sourceUrl, options = {}) {
    console.log(`${this._logPrefix} updating tab for new file:`, { filename, sourceUrl, options });
    
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
      const isTrackerFormat = filename.endsWith('.mod') || filename.endsWith('.xm');
      const displayName = isTrackerFormat ? filename : `${filename}`;

      let titleText = `🎵 ${displayName}`;
      if (options.internal && !options.existing) {
        // Internal (demo / drag-drop) load -> mark unsaved
        this.isNewResource = true;
        titleText += '*';
      } else if (options.existing) {
        // Existing project file -> clean state
        this.isNewResource = false;
      } else {
        // Default to internal semantics if unspecified
        this.isNewResource = true;
        titleText += '*';
      }
      this._currentFilename = filename;
      this._currentSourceUrl = sourceUrl;

      if (tabManager.updateTabTitle) {
        tabManager.updateTabTitle(currentTabId, titleText);
      } else {
        const tabElement = document.querySelector(`[data-tab-id="${currentTabId}"] .tab-title`);
        if (tabElement) tabElement.textContent = titleText;
      }

      // Also mark tab dirty for visual consistency if TabManager available
      try {
        if (options.internal && !options.existing) {
          if (window.tabManager && typeof window.tabManager.markTabDirty === 'function') {
            window.tabManager.markTabDirty(currentTabId);
          }
          window.eventBus?.emit?.('editor.content.changed', { editor: this });
        } else {
          // Ensure clean state for existing file
            if (window.tabManager && typeof window.tabManager.markTabClean === 'function') {
              window.tabManager.markTabClean(currentTabId);
            }
        }
      } catch(_) {}

      // Update window title if this is the active tab
      if (currentTabId === tabManager.getActiveTabId?.()) {
        document.title = `RetroStudio - ${displayName}`;
      }

  console.log(`${this._logPrefix} tab updated for file: ${displayName} (internal=${!!options.internal} existing=${!!options.existing})`);

    } catch (e) {
      console.error(`${this._logPrefix} failed to update tab:`, e);
    }
  }

  // Save functionality - required for EditorBase
  getContent() {
  // Returns last exported bytes; may be empty until first save/export
  if (this._lastCapturedModuleBytes instanceof Uint8Array) return this._lastCapturedModuleBytes;
  return new Uint8Array(0);
  }


  // Override save to handle filename prompting for temporary files
  async save() {
    try {
      const freshBytes = await this._directInternalSave();
      const isTemp = !this.path || this.path.startsWith('temp://');
      if (isTemp || this.isNewResource) {
        await this.saveNewResource(freshBytes);
      } else {
        await this.saveExistingResource(freshBytes);
      }
      this._clearUnsavedIndicator(); // ensure tab cleaned
      
    } catch (error) {
      console.error(`${this._logPrefix} save failed:`, error);
      alert(`Failed to save: ${error.message}`);
    }
  }

  async _invokeIframeSaveAndCapture(timeoutMs=5000) {
    // Removed: legacy capture path no longer used
    return this.getContent();
  }

  async _directInternalSave() {
    if (!this._iframe?.contentWindow) throw new Error('Tracker iframe not ready');
  const win = this._iframe.contentWindow;
  const bytes = await new Promise((resolve, reject)=>{
    let done=false;
    try {
      const invoke = ()=>{
        const fn = win.RetroTrackerSave || (win.Editor && win.Editor.save && ((cb)=>win.Editor.save(null,cb)));
        if (!fn) return false;
        fn(async (blob)=>{
          try {
            const buf = await blob.arrayBuffer();
            const arr = new Uint8Array(buf);
            if (!arr.length) { reject(new Error('Empty module export')); return; }
            this._lastCapturedModuleBytes = arr;
            done=true; resolve(arr);
          }catch(e){ reject(e); }
        });
        return true;
      };
      if(!invoke()) reject(new Error('RetroTrackerSave not ready'));
      setTimeout(()=>{ if(!done) reject(new Error('RetroTrackerSave timeout')); },8000);
    }catch(e){ reject(e); }
  });
  return bytes;
  }

  isExportReady() {
  return !!(this._iframe?.contentWindow && (this._iframe.contentWindow.RetroTrackerSave || (this._iframe.contentWindow.Editor && this._iframe.contentWindow.Editor.save)));
  }

  _resolveExporter() {
  // Deprecated (exporter abstraction removed)
  }

  // Provide a better initial filename when creating new resource
  async saveNewResource(content, filename = null) {
    // Always force standard prompt for new tracker resources; ignore provided filename param
    let base = '';
    try {
      base = this._currentFilename || '';
      if (!base) {
        const tm = window.serviceContainer?.get('tabManager') || window.tabManager;
        const tabId = tm?.getActiveTabId?.() || tm?.activeTabId;
        const tabEl = tabId ? document.querySelector(`[data-tab-id="${tabId}"] .tab-title`) : null;
        if (tabEl) base = tabEl.textContent || '';
      }
    } catch(_) {}
    base = (base || '').replace(/[*]+$/,'').replace(/^🎵\s*/, '');
    let ext = '.mod';
    if (/\.xm$/i.test(base)) ext = '.xm';
    if (/\.(mod|xm)$/i.test(base)) base = base.replace(/\.(mod|xm)$/i,'');
    if (!base) base = 'untitled';
    // Monkey patch instance getFileName + static extension to seed dialog
    const originalGetFileName = this.getFileName;
    const originalStatic = this.constructor.getFileExtension;
    this.constructor.getFileExtension = () => ext;
    this.getFileName = () => base + ext; // EditorBase will strip extension for form default
    try {
      return await super.saveNewResource(content, null); // null -> force prompt
    } finally {
      this.getFileName = originalGetFileName;
      this.constructor.getFileExtension = originalStatic;
    }
  }

  async _captureModuleBytes(timeoutMs = 5000) {
  // Removed legacy capture pathway; deterministic buildBinary export only
  return this.getContent();
  }

  destroy() {
    console.log(`${this._logPrefix} destroy called`);
    this.cleanup();
    super.destroy?.();
  }

  _clearUnsavedIndicator() {
    try {
      const tabManager = window.serviceContainer?.get('tabManager') || window.tabManager;
      if (!tabManager) return;
      const currentTabId = tabManager.getActiveTabId?.() || tabManager.activeTabId;
      if (!currentTabId) return;
      const filename = this._currentFilename || this.getFileName?.() || 'song.mod';
      const cleanTitle = `🎵 ${filename}`;
      if (tabManager.updateTabTitle) {
        tabManager.updateTabTitle(currentTabId, cleanTitle);
      } else {
        const tabElement = document.querySelector(`[data-tab-id="${currentTabId}"] .tab-title`);
        if (tabElement) tabElement.textContent = cleanTitle;
      }
      // Mark tab clean visually
      if (typeof tabManager.markTabClean === 'function') {
        tabManager.markTabClean(currentTabId);
      }
      // Emit saved event
      window.eventBus?.emit?.('editor.content.saved', { editor: this });
    } catch(_) {}
  }
}

// Export for global access
window.ModXmTrackerEditor = ModXmTrackerEditor;
