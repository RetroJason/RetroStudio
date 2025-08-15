// mod-xm-tracker-editor.js
// Editor wrapper that embeds BassoonTracker as a full MOD/XM tracker UI

class ModXmTrackerEditor extends EditorBase {
  constructor(path, isNewResource = false) {
    super(path, isNewResource);
    this._canvas = null;
    this._container = null;
    this._loaded = false;
    this._scriptLoaded = false;
    this._resizeObserver = null;
    this._canvasAdopted = false;
    this._baseUrl = 'scripts/audio/external/BassoonTracker';
    this._initOncePromise = null;
  }

  // Static metadata for auto-registration
  static getFileExtensions() { return ['.mod', '.xm']; }
  static getDisplayName() { return 'MOD/XM Tracker'; }
  // Icon used both for editor tabs and create button (if creatable)
  static getIcon() { return '🎵'; }
  static getCreateIcon() { return '🎵'; }
  static getPriority() { return 5; } // Prefer over plain viewer
  static getCapabilities() { return ['audio', 'music', 'tracker']; }
  // Expose as creatable to show a "Music" button in the ribbon
  static canCreate = true;
  static getCreateLabel() { return 'Music'; }
  static getDefaultFolder() { return 'Sources/Music'; }

  // Element creation
  createBody(body) {
    console.log('[ModXmTrackerEditor] Creating container with canvas placeholder for BassoonTracker');
    // Ensure the editor body fills its tab pane and allows a child to flex
    try {
      body.style.display = 'flex';
      body.style.flexDirection = 'column';
      body.style.height = '100%';
      body.style.padding = '0';
      body.style.margin = '0';
      body.style.overflow = 'hidden';
  } catch(_) {}
    const container = document.createElement('div');
    container.className = 'tracker-plugin-container';
    container.setAttribute('data-bt-scope', 'true');
  container.style.cssText = 'position: relative; width: 100%; height: 100%; overflow: hidden; flex: 1 1 auto; min-width: 0; min-height: 0;';
    
    // Create a canvas that BassoonTracker can initialize with
  const canvas = document.createElement('canvas');
  canvas.id = 'canvas'; // Some builds look for this ID
  canvas.classList.add('bt-canvas');
  // Do NOT scale via CSS; we will resize by setting attribute width/height to fit the container
  canvas.style.cssText = 'display:block; position:absolute; top:0; left:0; image-rendering:pixelated;';
  // Start with a safe small size; we'll size on next frame
  canvas.width = 640;
  canvas.height = 480;
    
    // Create wrapper for scrolling and centering
  const canvasWrapper = document.createElement('div');
  // Keep a simple wrapper that fills the space; no centering, no padding
  canvasWrapper.style.cssText = 'position:relative; width:100%; height:100%; overflow:hidden; display:block; box-sizing:border-box; padding:0; margin:0;';
  canvasWrapper.appendChild(canvas);
  container.appendChild(canvasWrapper);
    
    // Debug button for testing
    const debugBtn = document.createElement('button');
    debugBtn.textContent = 'Debug Canvas';
    debugBtn.style.position = 'absolute';
    debugBtn.style.top = '10px';
    debugBtn.style.right = '10px';
    debugBtn.style.zIndex = '999';
    debugBtn.addEventListener('click', () => {
      this._scanAndMaybeAdoptCanvas(true);
  this._showDpiInfo();
  this._dumpFullLayout();
  this._traceSizeDecision('debug-button');
  this._logResizeDebug('debug-button');
    });
    
    container.appendChild(debugBtn);
    body.appendChild(container);

  this._container = container;
  this._canvas = canvas;

  // Start resize handling now so the canvas is sized to the available space
  this._setupResize();

  // Initialize BassoonTracker immediately
    this._initPlugin()
      .catch(err => console.error('[ModXmTrackerEditor] init error:', err));
  }

  // Add bright outlines around the tab page area and the tracker canvas
  _applyDebugBorders() {
    try {
      const host = this._container || this.element;
      if (!host) return;
      const pane = host.closest?.('.tab-pane');
      if (pane) {
        if (!this._savedPaneOutline) this._savedPaneOutline = { el: pane, outline: pane.style.outline, outlineOffset: pane.style.outlineOffset };
        pane.style.outline = '4px solid #ff00ff'; // bright magenta around tab page area
        pane.style.outlineOffset = '0px';
      }
      if (this._container) {
        if (!this._savedContainerOutline) this._savedContainerOutline = { el: this._container, outline: this._container.style.outline, outlineOffset: this._container.style.outlineOffset };
        this._container.style.outline = '2px solid #ffff00'; // bright yellow around container
        this._container.style.outlineOffset = '0px';
      }
      if (this._canvas) {
        if (!this._savedCanvasOutline) this._savedCanvasOutline = { el: this._canvas, outline: this._canvas.style.outline, outlineOffset: this._canvas.style.outlineOffset };
        this._canvas.style.outline = '3px solid #00ffff'; // bright cyan around tracker canvas
        this._canvas.style.outlineOffset = '0px';
      }
    } catch (_) { /* ignore */ }
  }

  _logLayout() {
    try {
      const el = this._container || this.element;
      const pane = el?.closest?.('.tab-pane');
      const viewerBody = el?.closest?.('.viewer-body');
      const contentArea = el?.closest?.('.tab-content-area');
      const rect = (n) => n?.getBoundingClientRect ? n.getBoundingClientRect() : null;
      const info = (n, name) => ({
        name,
        tag: n?.tagName,
        classes: n?.className,
        pos: n ? getComputedStyle(n).position : undefined,
        outline: n?.style?.outline,
        rect: rect(n) && {
          top: Math.round(rect(n).top), left: Math.round(rect(n).left),
          width: Math.round(rect(n).width), height: Math.round(rect(n).height)
        }
      });
      const chain = [];
      let p = this._canvas;
      while (p) { chain.push(p); p = p.parentElement; }
      console.groupCollapsed('[ModXmTrackerEditor] Layout dump');
      console.log('pane', info(pane, 'pane'));
      console.log('viewerBody', info(viewerBody, 'viewerBody'));
      console.log('contentArea', info(contentArea, 'contentArea'));
      console.log('container', info(this._container, 'container'));
      console.log('canvas', info(this._canvas, 'canvas'));
      console.log('offset chain (canvas→…):');
      chain.forEach((n,i) => console.log(i, info(n, n?.className || n?.tagName)));
      try { console.log('scrolls', { winY: window.scrollY, pane: pane?.scrollTop, viewerBody: viewerBody?.scrollTop }); } catch(_){ }
      console.groupEnd();
    } catch (e) {
      console.warn('[ModXmTrackerEditor] Layout dump failed:', e);
    }
  }

  // Adopt the actual BassoonTracker canvas into our container (no CSS scaling)
  _scanAndMaybeAdoptCanvas(adoptIfBetter = false) {
    if (this._canvasAdopted && !adoptIfBetter) return false;
    try {
      const canvases = Array.from(document.querySelectorAll('canvas'));
      const btCanvas = this._getTrackerCanvasCandidate() || canvases.find(c => (!this._container || !this._container.contains(c)) && c.width > 0 && c.height > 0);
      if (!btCanvas) return false;
      if (!adoptIfBetter) return false;
      // Move the tracker's canvas into our container and position at 0,0
      if (btCanvas.parentElement !== this._container) {
        try {
          this._container.appendChild(btCanvas);
        } catch(_) {}
      }
      btCanvas.style.position = 'absolute';
      btCanvas.style.top = '0';
      btCanvas.style.left = '0';
      btCanvas.style.width = '';
      btCanvas.style.height = '';
      btCanvas.style.transform = 'none';
      btCanvas.style.imageRendering = 'pixelated';
      this._canvas = btCanvas;
      this._canvasAdopted = true;
      // Rebind input to the adopted canvas
      this._bindInputToCanvas();
  // Watch for engine trying to resize/scale canvas and correct it to tab size
  this._attachCanvasMutationWatch();
      // Resize to current container
      this._resizeCanvasToContainer();
      console.log('[ModXmTrackerEditor] Canvas adopted into container');
      return true;
    } catch (e) {
      console.warn('[ModXmTrackerEditor] Canvas scan failed:', e);
      return false;
    }
  }

  // Try to get the tracker's own canvas reference if the library exposes it
  _getTrackerCanvasCandidate() {
    try {
      const BT = window.BassoonTracker;
      if (BT?.UI?.canvas && BT.UI.canvas instanceof HTMLCanvasElement) return BT.UI.canvas;
      if (BT?.UI?.root?.canvas && BT.UI.root.canvas instanceof HTMLCanvasElement) return BT.UI.root.canvas;
    } catch (_) {}
    return null;
  }

  // Deep layout dump of key ancestors, html/body, scrolls, and transforms
  _dumpFullLayout() {
    try {
      const nodeInfo = (n, name) => {
        if (!n) return { name, missing: true };
        const cs = getComputedStyle(n);
        const r = n.getBoundingClientRect?.() || { top:0,left:0,width:0,height:0 };
        return {
          name,
          tag: n.tagName,
          classes: n.className,
          id: n.id,
          pos: cs.position,
          disp: cs.display,
          overflow: cs.overflow,
          margin: cs.margin,
          padding: cs.padding,
          transform: cs.transform,
          transformOrigin: cs.transformOrigin,
          zIndex: cs.zIndex,
          rect: { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) },
          scrollTop: n.scrollTop ?? undefined,
          scrollLeft: n.scrollLeft ?? undefined
        };
      };
      const el = this._container || this.element;
      const pane = el?.closest?.('.tab-pane');
      const viewerBody = el?.closest?.('.viewer-body');
      const contentArea = el?.closest?.('.tab-content-area');
      const html = document.documentElement;
      const body = document.body;
      const appRoot = document.getElementById('app') || document.getElementById('root') || undefined;
      const canvases = Array.from(document.querySelectorAll('canvas'));
      const canvasSumm = canvases.map((c,i) => {
        const r = c.getBoundingClientRect();
        return { i, ours: !!(this._container && this._container.contains(c)), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left), parent: c.parentElement?.className || c.parentElement?.tagName };
      });
      const chain = [];
      let p = this._canvas;
      while (p) { chain.push(p); p = p.parentElement; }
      console.groupCollapsed('[ModXmTrackerEditor] Deep layout dump');
      console.log('html', nodeInfo(html, 'html'));
      console.log('body', nodeInfo(body, 'body'));
      if (appRoot) console.log('appRoot', nodeInfo(appRoot, appRoot.id || 'appRoot'));
      console.log('pane', nodeInfo(pane, 'pane'));
      console.log('viewerBody', nodeInfo(viewerBody, 'viewerBody'));
      console.log('contentArea', nodeInfo(contentArea, 'contentArea'));
      console.log('container', nodeInfo(this._container, 'container'));
      console.log('canvas', nodeInfo(this._canvas, 'canvas'));
      console.log('window scroll', { x: window.scrollX, y: window.scrollY });
      console.log('all canvases', canvasSumm);
      console.log('offset chain (canvas→…):');
      chain.forEach((n,i) => console.log(i, nodeInfo(n, n?.className || n?.tagName)));
      console.groupEnd();
    } catch (e) {
      console.warn('[ModXmTrackerEditor] Deep layout dump failed:', e);
    }
  }

  // Watch DOM mutations so if the tracker injects a canvas later, we immediately adopt it
  _startCanvasObserver() {
    try {
      if (this._canvasObserver) return; // already running
      const target = document.body || document.documentElement;
      if (!target) return;
      let scheduled = false;
      console.info('[ModXmTrackerEditor] Canvas observer started');
      const scheduleScan = () => {
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => {
          scheduled = false;
          try {
            const before = (this._container?.querySelectorAll('canvas') || []).length;
            const adopted = this._scanAndMaybeAdoptCanvas(true);
            const after = (this._container?.querySelectorAll('canvas') || []).length;
            console.info('[ModXmTrackerEditor] Observer scan', { before, after, adopted });
          } catch(_){}
        }, 50);
      };
      this._canvasObserver = new MutationObserver((mutations) => {
        if (this._canvasAdopted) return; // Stop processing if already adopted
        
        for (const m of mutations) {
          if (m.type === 'childList') {
            // If any canvases were added, schedule adoption
            const added = Array.from(m.addedNodes || []);
            const hasCanvas = added.some(n => n instanceof HTMLCanvasElement || (n?.querySelector && n.querySelector('canvas')));
            if (hasCanvas) {
              scheduleScan();
              break;
            }
          } else if (m.type === 'attributes' && m.target instanceof HTMLCanvasElement) {
            scheduleScan();
            break;
          }
        }
      });
      this._canvasObserver.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    } catch (_) { /* ignore */ }
  }

  _stopCanvasObserver() {
    try { this._canvasObserver?.disconnect?.(); } catch(_) {}
    this._canvasObserver = null;
  }

  async _initPlugin() {
    if (this._initOncePromise) return this._initOncePromise;
    this._initOncePromise = (async () => {
      await this._ensureBassoonLoaded();

      console.log('[ModXmTrackerEditor] Waiting for BassoonTracker to fully initialize...');
      
      // Wait for BassoonTracker to be fully ready with all UI components
      await this._waitForFullyReady();
      
      console.log('[ModXmTrackerEditor] BassoonTracker is fully ready');

      // Initialize the engine explicitly in plugin mode so it does not bind to window size
      try {
        const BT = window.BassoonTracker || window.Main;
        const canvas = this._canvas;
        if (BT && BT.init && canvas) {
          BT.init({ plugin: true, canvas, baseUrl: this._baseUrl });
          console.log('[ModXmTrackerEditor] BassoonTracker.init(plugin mode) called');
        } else if (BT && BT.UI && BT.UI.initPlugin && canvas) {
          // Older builds expose UI.initPlugin
          BT.UI.initPlugin({ canvas, baseUrl: this._baseUrl });
          console.log('[ModXmTrackerEditor] BT.UI.initPlugin called');
        }
      } catch (e) {
        console.warn('[ModXmTrackerEditor] Engine plugin init failed or not needed:', e);
      }
      
      // Start canvas observer to find and adopt the tracker's canvas
      this._startCanvasObserver();
      this._scanAndMaybeAdoptCanvas(true);
      
      // Load current file if not empty
      setTimeout(async () => {
        try {
          const loaded = await this._loadCurrentFileIntoTracker();
          if (!loaded) {
            console.log('[ModXmTrackerEditor] No file to load, letting BassoonTracker use its default state');
          }
        } catch (err) {
          console.warn('[ModXmTrackerEditor] load file error:', err);
        }
      }, 1000);
    })();
    return this._initOncePromise;
  }

  async _waitForFullyReady() {
    return new Promise((resolve) => {
      const checkReady = () => {
        // Check if BassoonTracker has completed initialization
        const BT = window.BassoonTracker || window.Main;
        if (!BT) {
          setTimeout(checkReady, 100);
          return;
        }
        
        // Look for signs that the UI is fully loaded
        const hasUI = BT.UI || BT.ui || (Object.keys(BT).length > 30);
        const hasCanvas = document.querySelector('canvas#canvas');
        
        if (hasUI && hasCanvas) {
          console.log('[ModXmTrackerEditor] BassoonTracker UI and canvas ready');
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };
      
      checkReady();
    });
  }

  async _ensureCanvasReady() {
    // Wait a couple of frames to allow EditorBase to append our body into the DOM
    const waitFrame = () => new Promise(r => requestAnimationFrame(() => r()));
    if (!this._canvas) {
      // Create a fallback canvas if missing and attach it so it's visible once the root mounts
      const c = document.createElement('canvas');
      c.style.display = 'block';
      c.style.imageRendering = 'pixelated';
      c.width = 800; c.height = 600;
      if (this._container && this._container.appendChild) {
        this._container.appendChild(c);
      } else if (this.element && this.element.appendChild) {
        this.element.appendChild(c);
      }
      this._canvas = c;
    }
    // Wait up to 3 frames for DOM attach
    for (let i = 0; i < 3; i++) { await waitFrame(); }
  // Ensure non-zero initial size by resizing attributes to container
  try { this._resizeCanvasToContainer(); } catch(_){}
  // Do not throw here; we ensured a fallback canvas exists above
  }

  async _ensureBassoonLoaded() {
    if (this._scriptLoaded && window.BassoonTracker) return;
    
    console.log('[ModXmTrackerEditor] Loading freshly built BassoonTracker 0.5.0.5 with full UI');
    
    // Use the newly built 0.5.0.5 version with full UI components
    const builtUrl = 'scripts/audio/external/BassoonTracker/build/main-DyfYTZQh.js';
    
    try {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.type = 'module';
        s.src = builtUrl;
        s.onload = () => { 
          this._scriptLoaded = true; 
          console.log('[ModXmTrackerEditor] BassoonTracker 0.5.0.5 built version loaded');
          resolve(); 
        };
        s.onerror = () => reject(new Error('Failed to load BassoonTracker 0.5.0.5 build'));
        document.head.appendChild(s);
      });
    } catch (err) {
      console.warn('[ModXmTrackerEditor] 0.5.0.5 build failed, falling back to 0.4.0:', err);
      
      // Fallback to the 0.4.0 bundle
      const fallbackUrl = 'scripts/audio/external/BassoonTracker/versions/0.4.0/bassoontracker-min.js';
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = fallbackUrl;
        s.async = true;
        s.onload = () => { 
          this._scriptLoaded = true; 
          console.log('[ModXmTrackerEditor] Fallback to 0.4.0 bundle loaded');
          resolve(); 
        };
        s.onerror = () => reject(new Error('Failed to load BassoonTracker fallback'));
        document.head.appendChild(s);
      });
    }
    
    // Wait for the BassoonTracker global to be ready
    const waitForGlobal = (ms = 5000) => new Promise((resolve, reject) => {
      const start = Date.now();
      (function poll(){
        // Check for both BassoonTracker and Main globals (0.5.0.5 vs 0.4.0)
        if (window.BassoonTracker || window.Main) {
          if (window.Main && !window.BassoonTracker) {
            console.log('[ModXmTrackerEditor] Found Main global from 0.5.0.5 - already auto-initialized');
            // Make Main available as BassoonTracker for compatibility
            window.BassoonTracker = window.Main;
          }
          
          const propCount = Object.keys(window.BassoonTracker || {}).length;
          console.log('[ModXmTrackerEditor] BassoonTracker ready with', propCount, 'properties');
          return resolve();
        }
        if (Date.now() - start > ms) return reject(new Error('BassoonTracker/Main global not ready'));
        setTimeout(poll, 50);
      })();
    });
    
    await waitForGlobal(5000);
    
    // Check if it's the full version with UI components
    const propCount = Object.keys(window.BassoonTracker || {}).length;
    if (propCount > 20) {
      console.log('[ModXmTrackerEditor] ✅ Full BassoonTracker with UI loaded! Properties:', Object.keys(window.BassoonTracker));
    } else {
      console.warn('[ModXmTrackerEditor] ⚠️ Still limited API. Properties:', Object.keys(window.BassoonTracker || {}));
    }
  }

  async _loadCurrentFileIntoTracker() {
    if (!this.path || !window.serviceContainer) {
      console.log('[ModXmTrackerEditor] No file path or service container available');
      return false;
    }
    
    // Safe-get FileManager and ensure it's initialized
    let fm = null;
    try { fm = window.serviceContainer?.get('fileManager'); } catch (_) { /* not registered yet */ }
    fm = fm || window.FileManager || window.fileManager;
    if (fm && !fm.storageService && window.fileIOService && typeof fm.initialize === 'function') {
      try { fm.initialize(window.fileIOService); } catch(_){}
      try { window.serviceContainer?.registerSingleton?.('fileManager', fm); } catch(_){}
    }
    if (!fm) {
      console.log('[ModXmTrackerEditor] FileManager not available');
      return false;
    }
    
    const storagePath = window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(this.path) : this.path;
    const rec = await fm.loadFile(storagePath);
    if (!rec) {
      console.log('[ModXmTrackerEditor] No file record found');
      return false;
    }

    // Convert storage record to ArrayBuffer
    let buf;
    if (rec.content instanceof ArrayBuffer) {
      buf = rec.content;
    } else if (rec.binaryData && rec.fileContent) {
      // base64
      const binaryString = atob(rec.fileContent);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
      buf = bytes.buffer;
    } else if (typeof rec.fileContent === 'string') {
      buf = new TextEncoder().encode(rec.fileContent).buffer;
    } else {
      console.log('[ModXmTrackerEditor] Unknown file content format');
      return false;
    }

    // If this is a brand-new/empty file, don't try to load anything into the tracker.
    if (!buf || (buf.byteLength || 0) === 0) {
      console.info('[ModXmTrackerEditor] Empty module content - skipping initial load');
      return false;
    }

    const name = this.getFileName();
    console.log('[ModXmTrackerEditor] Loading file into BassoonTracker:', name, 'size:', buf.byteLength);
    
    try {
      const BT = window.BassoonTracker || window.Main;
      if (!BT) {
        console.warn('[ModXmTrackerEditor] BassoonTracker not available for file loading');
        return false;
      }
      
      // Try different approaches to load the file
      if (typeof BT.loadFile === 'function') {
        // Direct file loading with ArrayBuffer
        const uint8Array = new Uint8Array(buf);
        BT.loadFile(uint8Array, name);
        console.log('[ModXmTrackerEditor] File loaded via loadFile method');
        return true;
      } else if (typeof BT.load === 'function') {
        // Create a blob URL for loading
        const blob = new Blob([buf], { type: 'application/octet-stream' });
        const blobUrl = URL.createObjectURL(blob) + '#' + encodeURIComponent(name);
        BT.load(blobUrl);
        console.log('[ModXmTrackerEditor] File loaded via load method with blob URL');
        return true;
      } else {
        console.warn('[ModXmTrackerEditor] No suitable loading method found in BassoonTracker');
        return false;
      }
    } catch (e) {
      console.warn('[ModXmTrackerEditor] Failed to load module into tracker:', e);
      return false;
    }
  }

  _initBlankSong() {
    // Prefer BassoonTracker's own namespaces; globals may not be exported
    try {
      const BT = window.BassoonTracker;
      if (BT && BT.EventBus && BT.EVENT && BT.COMMAND) {
        BT.EventBus.trigger(BT.EVENT.command, BT.COMMAND.newFile);
        console.info('[ModXmTrackerEditor] Initialized blank song via EventBus');
        return;
      }
    } catch (_) { /* ignore */ }
    try {
      const BT = window.BassoonTracker;
      if (BT && BT.Tracker && typeof BT.Tracker.new === 'function') {
        BT.Tracker.new();
        console.info('[ModXmTrackerEditor] Initialized blank song via Tracker.new()');
        return;
      }
    } catch (_) { /* ignore */ }
    // Last resort: legacy globals (unlikely in plugin mode)
    try {
      if (window.EventBus && window.EVENT && window.COMMAND) {
        window.EventBus.trigger(window.EVENT.command, window.COMMAND.newFile);
        console.info('[ModXmTrackerEditor] Initialized blank song via legacy globals');
        return;
      }
      if (window.Tracker && typeof window.Tracker.new === 'function') {
        window.Tracker.new();
        console.info('[ModXmTrackerEditor] Initialized blank song via legacy Tracker.new()');
      }
    } catch (_) { /* ignore */ }
  }

  _setupResize() {
    const doResize = (reason = 'observer') => {
      try { console.log('[ModXmTrackerEditor] doResize called', { reason }); } catch(_){}
      this._resizeCanvasToContainer(reason);
    };
    const attachObserver = () => {
      if (!this._container) return;
      try {
        if (!this._resizeObserver) this._resizeObserver = new ResizeObserver((entries) => {
          const entry = entries && entries[0];
          try {
            const cr = entry?.contentRect;
            console.log('[ModXmTrackerEditor] ResizeObserver fired', cr ? { w: Math.round(cr.width), h: Math.round(cr.height) } : {});
          } catch(_){}
          doResize('observer');
        });
        this._resizeObserver.observe(this._container);
        // Also observe ancestor panes that might change width when the sidebar moves
        try {
          const host = this._container;
          const pane = host.closest?.('.tab-pane');
          const viewerBody = host.closest?.('.viewer-body');
          const contentArea = host.closest?.('.tab-content-area');
          if (pane) this._resizeObserver.observe(pane);
          if (viewerBody) this._resizeObserver.observe(viewerBody);
          if (contentArea) this._resizeObserver.observe(contentArea);
        } catch (_) {}
        try {
          const r = this._container.getBoundingClientRect?.();
          console.log('[ModXmTrackerEditor] ResizeObserver attached to container', r ? { w: Math.round(r.width), h: Math.round(r.height), connected: this._container.isConnected } : { connected: this._container.isConnected });
        } catch(_){}
      } catch (_) { /* ignore */ }
      requestAnimationFrame(() => doResize('init'));
    };
    // Listen to window resize as well (covers app-level layout changes)
    if (!this._onWinResize) {
      this._onWinResize = () => { try { console.log('[ModXmTrackerEditor] window.resize'); } catch(_){} doResize('window'); };
      window.addEventListener('resize', this._onWinResize);
    }
    // Listen to custom sidebar resize events for deterministic updates
    if (!this._onSidebarResize) {
      this._onSidebarResize = (e) => {
        try { console.log('[ModXmTrackerEditor] project-explorer.resized', e?.detail); } catch(_){}
        doResize('sidebar');
      };
      window.addEventListener('project-explorer.resized', this._onSidebarResize);
    }
    requestAnimationFrame(() => attachObserver());
  }

  // Compute the tab page inner (client minus padding). Accurate source of truth.
  _getTabPageInnerSize() {
    try {
      const host = this._container || this.element;
      const pane = host?.closest?.('.tab-pane');
      if (!pane) return null;
      const cs = getComputedStyle(pane);
      const toNum = (v) => v ? parseFloat(v) || 0 : 0;
      const padX = toNum(cs.paddingLeft) + toNum(cs.paddingRight);
      const padY = toNum(cs.paddingTop) + toNum(cs.paddingBottom);
      const clientW = pane.clientWidth;
      const clientH = pane.clientHeight;
      const w = Math.max(1, Math.floor(clientW - padX));
      const h = Math.max(1, Math.floor(clientH - padY));
      return { w, h };
    } catch (_) { return null; }
  }

  // Watch the canvas attributes/styles and counteract overrides to non-tab sizes
  _attachCanvasMutationWatch() {
    try {
      if (!this._canvas || this._canvasMutationObs) return;
      const obs = new MutationObserver(() => {
        try {
          const inner = this._getTabPageInnerSize();
          if (!inner || !this._canvas) return;
          const { w, h } = inner;
          // Compare CSS box first to avoid fighting the engine's high-DPI backing store scaling.
          const rect = this._canvas.getBoundingClientRect?.();
          const cssW = rect ? Math.round(rect.width) : 0;
          const cssH = rect ? Math.round(rect.height) : 0;
          const cssMismatch = (Math.abs(cssW - w) > 1) || (Math.abs(cssH - h) > 1);
          if (cssMismatch) {
            const cw = this._canvas.width || 0;
            const ch = this._canvas.height || 0;
            console.warn('[ModXmTrackerEditor] Correcting canvas CSS/attr size to tab page', { css: { w: cssW, h: cssH }, attr: { w: cw, h: ch }, to: { w, h } });
            this._setCanvasSize(w, h);
          }
        } catch(_){}
      });
      obs.observe(this._canvas, { attributes: true, attributeFilter: ['width', 'height', 'style'] });
      this._canvasMutationObs = obs;
    } catch(_){}
  }

  // Ensure the tab pane doesn’t scroll and is at the very top
  _applyNoScrollToTabPane(rootEl) { /* no-op; allow vertical scroll in pane */ }

  // Normalize ancestor containers so nothing centers or offsets the canvas
  _normalizeAncestors(rootEl) {
    try {
      const host = rootEl || this._container || this.element;
      if (!host) return;
      const targets = [];
      const pane = host.closest?.('.tab-pane');
      const viewerBody = host.closest?.('.viewer-body');
      const contentArea = host.closest?.('.tab-content-area');
      if (pane) targets.push(pane);
      if (viewerBody) targets.push(viewerBody);
      if (contentArea) targets.push(contentArea);
      // Save previous styles once
      if (!this._savedAncestorStyles) this._savedAncestorStyles = new Map();
      for (const t of targets) {
        if (!this._savedAncestorStyles.has(t)) {
          this._savedAncestorStyles.set(t, {
            overflow: t.style.overflow,
            padding: t.style.padding,
            margin: t.style.margin,
            alignItems: t.style.alignItems,
            justifyContent: t.style.justifyContent,
      position: t.style.position,
      transform: t.style.transform,
      transformOrigin: t.style.transformOrigin
          });
        }
        // Enforce top-left, no scroll, no extra spacing
        t.style.overflow = 'hidden';
        t.style.padding = '0';
        t.style.margin = '0';
        t.style.alignItems = 'stretch';
        t.style.justifyContent = 'flex-start';
        if (getComputedStyle(t).position === 'static') t.style.position = 'relative';
    // Neutralize transforms to keep client rects aligned with visual pixels
    t.style.transform = 'none';
    t.style.transformOrigin = '0 0';
        try { t.scrollTop = 0; } catch(_){ }
      }
      // Ensure our own container also opts-out of centering and spacing
      if (this._container) {
        this._container.style.margin = '0';
        this._container.style.padding = '0';
        this._container.style.textAlign = 'left';
        if (getComputedStyle(this._container).position === 'static') this._container.style.position = 'relative';
      }
    } catch (_) { /* ignore */ }
  }

  _scrollParentToTop() {
    try {
      const el = this._container || this.element;
      if (!el) return;
      const pane = el.closest?.('.tab-pane');
      if (pane) { try { pane.scrollTop = 0; } catch(_){} }
      const viewerBody = el.closest?.('.viewer-body');
      if (viewerBody) { try { viewerBody.scrollTop = 0; } catch(_){} }
      // Also ensure window is at top if it happened to scroll
      try { if (window.scrollY) window.scrollTo(0, 0); } catch(_){}
    } catch (_) { /* ignore */ }
  }

  // Try to force BassoonTracker's input system to recompute canvas bounds
  _refreshInputBounds() {
    try {
      if (window.Input) {
        if (typeof window.Input.updateBounds === 'function') {
          window.Input.updateBounds();
          return;
        }
        if (typeof window.Input.onResize === 'function') {
          window.Input.onResize();
          return;
        }
        if (typeof window.Input.init === 'function') {
          // Re-init as last resort; expected to be idempotent in this build
          window.Input.init();
        }
      }
      // Generic fallback: broadcast a resize so any listeners recompute rects
      try { window.dispatchEvent(new Event('resize')); } catch (_) {}
    } catch (_) {}
  }

  // Compute canvas-relative and logical (attribute-space) coordinates from a mouse event
  _toCanvasCoords(e) {
    if (!this._canvas) return { x: 0, y: 0, lx: 0, ly: 0 };
    const rect = this._canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const cw = this._canvas.width || cssW;
    const ch = this._canvas.height || cssH;
    const scaleX = cw / cssW;
    const scaleY = ch / cssH;
    return { x: cssX, y: cssY, lx: Math.round(cssX * scaleX), ly: Math.round(cssY * scaleY) };
  }

  // Resize canvas by setting attribute width/height to container bounds (no CSS scaling)
  _setCanvasSize(w, h) {
    try {
      if (!this._canvas) return;
      const W = Math.max(1, Math.floor(w));
      const H = Math.max(1, Math.floor(h));
      if (this._canvas.width !== W) this._canvas.width = W;
      if (this._canvas.height !== H) this._canvas.height = H;
      this._canvas.style.width = W + 'px';
      this._canvas.style.height = H + 'px';
      this._lastAttrSize = { w: W, h: H };
    } catch (_) { /* ignore */ }
  }

  _resizeCanvasToContainer(reason = 'unknown') {
    try {
      if (!this._canvas) return;
      const inner = this._getTabPageInnerSize();
      if (!inner) { console.warn('[ModXmTrackerEditor] Tab page not found for sizing'); return; }
      let { w, h } = inner;
      // Optional: clamp to engine's known max to avoid back-and-forth corrections
      try {
        const BT = window.BassoonTracker || window.Main;
        const maxW = BT?.UI?.maxWidth || BT?.maxWidth;
        const maxH = BT?.UI?.maxHeight || BT?.maxHeight;
        const minH = BT?.UI?.minHeight || BT?.minHeight;
        if (typeof maxW === 'number') w = Math.min(w, maxW);
        if (typeof maxH === 'number') h = Math.min(h, maxH);
        if (typeof minH === 'number') h = Math.max(h, minH);
      } catch(_){}
  if (!w || !h) { console.warn('[ModXmTrackerEditor] Tab page inner size is zero', inner); return; }
      if (this._lastAttrSize && this._lastAttrSize.w === w && this._lastAttrSize.h === h && reason !== 'init') {
        console.info('[ModXmTrackerEditor] Size unchanged; skipping attribute update', { reason, w, h, source: 'tabPageInner' });
      }
      this._lastSetSize = { w, h, reason, source: 'tabPageInner' };
      this._setCanvasSize(w, h);
      // Let BassoonTracker know, if API exists
      try {
        const BT = window.BassoonTracker || window.Main;
        if (BT?.UI?.setSize) {
          BT.UI.setSize(w, h);
          try { console.log('[ModXmTrackerEditor] BT.UI.setSize called', { w, h, source: 'tabPageInner' }); } catch(_){ }
        } else if (BT && typeof BT.resize === 'function') {
          BT.resize(w, h);
          try { console.log('[ModXmTrackerEditor] BT.resize called', { w, h, source: 'tabPageInner' }); } catch(_){ }
        }
      } catch(_){}
      // Refresh input bounds
      requestAnimationFrame(() => this._bindInputToCanvas(true));
      // Debug log after applying sizes
      this._logResizeDebug(reason);
      this._traceSizeDecision(reason);
    } catch (_) { /* ignore */ }
  }

  _logResizeDebug(reason) {
    try {
      const winW = typeof window !== 'undefined' ? window.innerWidth : 0;
      const winH = typeof window !== 'undefined' ? window.innerHeight : 0;
      const host = this._container || this.element;
      const pane = host?.closest?.('.tab-pane');
      const pRect = pane?.getBoundingClientRect?.();
      // Compute tab page inner content size (client box minus padding)
      const tabInner = (() => {
        if (!pane) return null;
        const cs = getComputedStyle(pane);
        const toNum = (v) => v ? parseFloat(v) || 0 : 0;
        const padX = toNum(cs.paddingLeft) + toNum(cs.paddingRight);
        const padY = toNum(cs.paddingTop) + toNum(cs.paddingBottom);
        const clientW = pane.clientWidth;
        const clientH = pane.clientHeight;
        // clientWidth includes padding; subtract to approximate inner content area
        const innerW = Math.max(0, clientW - padX);
        const innerH = Math.max(0, clientH - padY);
        return { w: innerW, h: innerH, client: { w: clientW, h: clientH }, padding: { x: padX, y: padY } };
      })();
      const cRect = this._container?.getBoundingClientRect?.();
      const kRect = this._canvas?.getBoundingClientRect?.();
      const info = {
        reason,
        window: { w: winW, h: winH },
        tabPage: pRect ? { w: Math.round(pRect.width), h: Math.round(pRect.height) } : null,
        tabPageInner: tabInner,
        container: cRect ? { w: Math.round(cRect.width), h: Math.round(cRect.height) } : null,
        canvasCss: kRect ? { w: Math.round(kRect.width), h: Math.round(kRect.height) } : null,
        canvasAttr: this._canvas ? { w: this._canvas.width, h: this._canvas.height } : null,
        lastSetSize: this._lastSetSize || null,
        lastAttrSize: this._lastAttrSize || null
      };
      console.info('[ModXmTrackerEditor] Resize', info);
    } catch (_) { /* ignore */ }
  }

  // Extra verbose trace of how we decide the canvas size
  _traceSizeDecision(reason = 'trace') {
    try {
      const host = this._container || this.element;
      const pane = host?.closest?.('.tab-pane');
      const viewerBody = host?.closest?.('.viewer-body');
      const contentArea = host?.closest?.('.tab-content-area');
      const cs = (n) => (n ? getComputedStyle(n) : null);
      const rect = (n) => (n?.getBoundingClientRect?.() || { width: 0, height: 0 });
      const box = (n) => {
        const r = rect(n);
        const s = cs(n);
        const toNum = (v) => v ? parseFloat(v) || 0 : 0;
        const pad = { t: toNum(s?.paddingTop), r: toNum(s?.paddingRight), b: toNum(s?.paddingBottom), l: toNum(s?.paddingLeft) };
        const mar = { t: toNum(s?.marginTop), r: toNum(s?.marginRight), b: toNum(s?.marginBottom), l: toNum(s?.marginLeft) };
        const bor = { t: toNum(s?.borderTopWidth), r: toNum(s?.borderRightWidth), b: toNum(s?.borderBottomWidth), l: toNum(s?.borderLeftWidth) };
        return {
          rect: { w: Math.round(r.width), h: Math.round(r.height) },
          client: { w: n?.clientWidth ?? null, h: n?.clientHeight ?? null },
          offset: { w: n?.offsetWidth ?? null, h: n?.offsetHeight ?? null },
          padding: pad,
          margin: mar,
          border: bor,
          display: s?.display,
          position: s?.position,
          overflow: s?.overflow,
        };
      };
      const data = {
        reason,
        container: box(this._container),
        pane: box(pane),
        viewerBody: box(viewerBody),
        contentArea: box(contentArea),
        devicePixelRatio: window.devicePixelRatio || 1,
        canvasAttr: this._canvas ? { w: this._canvas.width, h: this._canvas.height } : null,
        lastSetSize: this._lastSetSize || null,
      };
      console.debug('[ModXmTrackerEditor] Size decision trace', data);
    } catch(_) { /* ignore */ }
  }

  _toggleDebug() {
    this._debugEnabled = !this._debugEnabled;
  if (this._debugEnabled) {
      if (!this._debugOverlay) {
        const ov = document.createElement('div');
        ov.style.position = 'absolute';
        ov.style.top = '0';
        ov.style.left = '0';
        ov.style.background = 'rgba(0,0,0,0.5)';
        ov.style.color = '#0f0';
        ov.style.fontFamily = 'Consolas, monospace';
        ov.style.fontSize = '11px';
        ov.style.padding = '4px 6px';
        ov.style.zIndex = '10';
        ov.style.pointerEvents = 'none';
        const dot = document.createElement('div');
        dot.style.position = 'absolute';
        dot.style.width = '6px';
        dot.style.height = '6px';
        dot.style.borderRadius = '50%';
        dot.style.background = '#f00';
        dot.style.zIndex = '11';
        dot.style.transform = 'translate(-3px, -3px)';
        this._debugDot = dot;
        this._debugOverlay = ov;
        const host = this._container || this.element;
        if (!host) {
          console.warn('[ModXmTrackerEditor] Debug overlay host not ready');
          return;
        }
        // Ensure host can position absolute children
        if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
        host.appendChild(ov);
        host.appendChild(dot);
      }
      const onMove = (e) => {
        if (!this._canvas || !this._debugEnabled) return;
  const { x, y, lx, ly } = this._toCanvasCoords(e);
        const dpr = window.devicePixelRatio || 1;
  const rect = this._canvas.getBoundingClientRect();
  const cw = this._canvas.width;
  const ch = this._canvas.height;
  const cssW = Math.round(rect.width);
  const cssH = Math.round(rect.height);
        if (this._debugOverlay) {
          this._debugOverlay.textContent = `x:${Math.round(x)} y:${Math.round(y)} | logical:${lx},${ly} | css:${cssW}x${cssH} | attr:${cw}x${ch} | dpr:${dpr}`;
        }
        if (this._debugDot) {
          // Show dot at the CSS position relative to canvas within container
          const canvasRect = this._canvas.getBoundingClientRect();
          const containerRect = this._container.getBoundingClientRect();
          const canvasOffsetX = canvasRect.left - containerRect.left;
          const canvasOffsetY = canvasRect.top - containerRect.top;
          this._debugDot.style.left = (canvasOffsetX + x) + 'px';
          this._debugDot.style.top = (canvasOffsetY + y) + 'px';
        }
      };
      const onLeave = () => {
        if (this._debugOverlay) this._debugOverlay.textContent = '';
      };
      this._debugHandlers = { onMove, onLeave };
      this._canvas.addEventListener('mousemove', onMove);
      this._canvas.addEventListener('mouseleave', onLeave);
    } else {
      if (this._debugHandlers && this._canvas) {
        this._canvas.removeEventListener('mousemove', this._debugHandlers.onMove);
        this._canvas.removeEventListener('mouseleave', this._debugHandlers.onLeave);
      }
      this._debugHandlers = null;
      if (this._debugOverlay) this._debugOverlay.textContent = '';
      if (this._debugDot) { this._debugDot.style.left = '-9999px'; this._debugDot.style.top = '-9999px'; }
    }
  }

  // Bind BassoonTracker.Input to our current canvas and refresh bounds
  _bindInputToCanvas(refreshOnly = false) {
    try {
      if (!window.Input || !this._canvas) return;
      if (!refreshOnly && typeof window.Input.setCanvas === 'function') window.Input.setCanvas(this._canvas);
      if (typeof window.Input.init === 'function') window.Input.init();
      if (typeof window.Input.updateBounds === 'function') window.Input.updateBounds();
      else if (typeof window.Input.onResize === 'function') window.Input.onResize();
    } catch(_){}
  }

  // EditorBase API
  getContent() {
    // We don’t manage binary content directly; saving is handled by the tracker UI.
    return '';
  }

  async save() {
    alert('Use the tracker menu (File > Save Module) to export a .mod/.xm file.');
  }

  // Creation entry-point for the Ribbon "Music" button
  static createNew(defaultName = 'new_song.mod') {
  // Return initial file content for a fresh module. We'll start empty and let the
  // embedded tracker initialize a blank song. Content can be empty.
  return '';
  }

  // Lifecycle
  onFocus() {
    super.onFocus();
    console.log('[ModXmTrackerEditor] Focus - scanning for canvas');
    // Just scan for canvas, no complex layout modifications
    this._startCanvasObserver();
  this._scanAndMaybeAdoptCanvas(true);
  this._resizeCanvasToContainer('focus');
  this._bindInputToCanvas(true);
  }
  onBlur() { super.onBlur(); }
  cleanup() {
    console.log('[ModXmTrackerEditor] Cleanup');
    this._stopCanvasObserver();

    if (this._adoptTimer) { 
      try { clearInterval(this._adoptTimer); } catch(_){} 
      this._adoptTimer = null; 
    }
    try {
      if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
      if (this._onWinResize) { window.removeEventListener('resize', this._onWinResize); this._onWinResize = null; }
  if (this._onSidebarResize) { window.removeEventListener('project-explorer.resized', this._onSidebarResize); this._onSidebarResize = null; }
    } catch(_){}
  }

  // Re-run adoption on a short interval for robustness during late UI creation
  _kickAdoptWatchdog(durationMs = 2000, intervalMs = 150) {
    try {
      if (this._adoptTimer) { try { clearInterval(this._adoptTimer); } catch(_){} this._adoptTimer = null; }
      const start = Date.now();
      this._adoptTimer = setInterval(() => {
        if (Date.now() - start > durationMs) {
          try { clearInterval(this._adoptTimer); } catch(_){}
          this._adoptTimer = null;
          return;
        }
        try { this._scanAndMaybeAdoptCanvas(true); } catch(_){}
      }, Math.max(50, intervalMs));
    } catch (_) { /* ignore */ }
  }
}
// Make available globally
window.ModXmTrackerEditor = ModXmTrackerEditor;
