// sprite-editor.js
// Editor for creating and editing sprite files with frame extraction, animations and preview

console.log('[SpriteEditor] Class definition loading');

/**
 * SpriteEditorData — Serialisable data model for .sprite files.
 * References one or more .frameset files; animations are built from their frames.
 */
class SpriteEditorData {
  constructor(options = {}) {
    this.name = options.name || 'untitled_sprite';

    /**
     * Frameset references — array of { path } where path points to a .frameset file.
     * At runtime the editor loads each frameset's JSON and caches its frames/image.
     */
    this.framesets = options.framesets || [];

    // --- Legacy fields (kept for backward-compat with old .sprite files) ---
    this.imagePath = options.imagePath || '';
    this.imageWidth = options.imageWidth || 0;
    this.imageHeight = options.imageHeight || 0;
    this.frameWidth = options.frameWidth || 0;
    this.frameHeight = options.frameHeight || 0;
    this.gridOffsetX = options.gridOffsetX || 0;
    this.gridOffsetY = options.gridOffsetY || 0;
    this.gridSpacingX = options.gridSpacingX || 0;
    this.gridSpacingY = options.gridSpacingY || 0;
    this.frames = options.frames || [];

    /**
     * Animations — array of {
     *   name, frameIds:[], frameDuration (ms), loop,
     *   dx, dy,
     *   frameOverrides: { [seqIdx]: { duration?, dx?, dy?, offsetX?, offsetY? } }
     * }
     *
     * frameIds use the format "framesetIdx:localFrameId" (string) for frameset-based
     * sprites, or plain integer ids for legacy sprites.
     */
    this.animations = options.animations || [];

    /** Origin / pivot point */
    this.originX = options.originX || 0;
    this.originY = options.originY || 0;
  }

  /* ------------------------------------------------------------------ */
  /*  Serialisation                                                      */
  /* ------------------------------------------------------------------ */
  toJSON() {
    const out = {
      name: this.name,
      framesets: this.framesets,
      animations: this.animations,
      originX: this.originX,
      originY: this.originY,
    };
    // Persist legacy fields only if they were set (backward compat)
    if (this.imagePath) {
      out.imagePath = this.imagePath;
      out.imageWidth = this.imageWidth;
      out.imageHeight = this.imageHeight;
      out.frameWidth = this.frameWidth;
      out.frameHeight = this.frameHeight;
      out.gridOffsetX = this.gridOffsetX;
      out.gridOffsetY = this.gridOffsetY;
      out.gridSpacingX = this.gridSpacingX;
      out.gridSpacingY = this.gridSpacingY;
      out.frames = this.frames;
    }
    return out;
  }

  static fromJSON(data) {
    return new SpriteEditorData(data);
  }

  /* ------------------------------------------------------------------ */
  /*  Frame helpers                                                      */
  /* ------------------------------------------------------------------ */
  /** Rebuild the frame list from current grid settings (legacy path). */
  rebuildFramesFromGrid() {
    this.frames = [];
    const tw = this.imageWidth;
    const th = this.imageHeight;
    if (!tw || !th) return;

    let fw = this.frameWidth || tw;
    let fh = this.frameHeight || th;

    let id = 0;
    for (let y = this.gridOffsetY; y + fh <= th; y += fh + this.gridSpacingY) {
      for (let x = this.gridOffsetX; x + fw <= tw; x += fw + this.gridSpacingX) {
        this.frames.push({ id, name: `frame_${id}`, x, y, w: fw, h: fh });
        id++;
      }
    }
    if (this.frames.length === 0) {
      this.frames.push({ id: 0, name: 'frame_0', x: 0, y: 0, w: tw, h: th });
    }
  }

  /** Ensure a default "idle" animation exists using the first available frame */
  ensureDefaultAnimation() {
    if (this.animations.length === 0 && this.frames.length > 0) {
      this.animations.push({
        name: 'idle',
        frameIds: [this.frames[0].id],
        frameDuration: 100,
        loop: true,
        dx: 0,
        dy: 0,
        frameOverrides: {},
      });
    }
  }

  /** Check if this sprite uses the new frameset-based workflow */
  get usesFramesets() {
    return this.framesets.length > 0;
  }
}

/* ====================================================================
 *  SpriteEditor — extends EditorBase
 * ==================================================================== */
class SpriteEditor extends EditorBase {
  constructor(fileObject = null, readOnly = false) {
    console.log('[SpriteEditor] Constructor called');

    // Initialize spriteData BEFORE super() because ViewerBase's constructor
    // calls createElement() → createBody() which reads this.spriteData.
    const tempData = new SpriteEditorData();

    // Stash on instance before super — ES6 technically disallows `this`
    // before super(), so we use defineProperty on the prototype instead
    // and reassign after super().  Simpler: just guard in createBody.
    SpriteEditor._pendingData = tempData;

    super(fileObject, readOnly);

    this.spriteData = SpriteEditor._pendingData || new SpriteEditorData();
    SpriteEditor._pendingData = null;
    this._sourceImage = null;        // HTMLImageElement — legacy single-image mode
    this._sourceCanvas = null;       // Off-screen canvas for pixel reads
    this._animTimer = null;          // requestAnimationFrame id
    this._animFrame = 0;             // current animation frame index
    this._animPlaying = true;
    this._animFpsOverride = null;
    this._selectedAnimIndex = 0;
    this._selectedStripIdx = -1;     // selected frame index within animation strip
    this._selectedFrameIds = new Set();
    this._pendingImagePath = null;   // used when created from context menu

    /**
     * Loaded frameset data cache — Map<framesetIdx, { data: FramesetEditorData, image: HTMLImageElement }>
     * Populated when framesets are loaded. Used by _drawFrameToCanvas.
     */
    this._loadedFramesets = new Map();

    /**
     * Merged frame list — flattened from all loaded framesets.
     * Each entry: { id (string "fsIdx:localId"), name, x, y, w, h, framesetIdx, localId, image }
     */
    this._mergedFrames = [];

    this.initializeContent();
  }

  /* ------------------------------------------------------------------ */
  /*  EditorBase overrides                                               */
  /* ------------------------------------------------------------------ */
  createBody(bodyContainer) {
    // spriteData may not be on `this` yet (super() calls createBody before
    // constructor body finishes).  Fall back to the class-level stash.
    if (!this.spriteData) {
      this.spriteData = SpriteEditor._pendingData || new SpriteEditorData();
    }

    bodyContainer.classList.add('sprite-editor-container');
    bodyContainer.innerHTML = '';

    // --- Main layout: sidebar | preview ---
    const layout = document.createElement('div');
    layout.className = 'sprite-editor-layout';

    // LEFT — controls sidebar
    const sidebar = document.createElement('div');
    sidebar.className = 'sprite-sidebar';
    this._buildSidebar(sidebar);
    layout.appendChild(sidebar);

    // RIGHT — canvas area
    const main = document.createElement('div');
    main.className = 'sprite-main';
    this._buildMainArea(main);
    layout.appendChild(main);

    bodyContainer.appendChild(layout);
  }

  getContent() {
    return this.spriteData ? JSON.stringify(this.spriteData.toJSON(), null, 2) : '';
  }

  setContent(content) {
    try {
      const data = JSON.parse(content);
      this.spriteData = SpriteEditorData.fromJSON(data);
      this._syncUIFromData();
      if (this.spriteData.imagePath) {
        this._loadSourceImage(this.spriteData.imagePath);
      }
      if (this.spriteData.usesFramesets) {
        this._loadAllFramesets();
      }
    } catch (err) {
      console.error('[SpriteEditor] Failed to parse content:', err);
    }
  }

  initializeContent() {
    console.log('[SpriteEditor] initializeContent()');
    if (this.file && this.file.fileContent) {
      // Opening an existing .sprite file
      let content = this.file.fileContent;
      if (typeof content === 'string') {
        try {
          if (content.charAt(0) !== '{') {
            content = atob(content);
          }
        } catch (_) { /* already plaintext */ }
      }
      this.setContent(content);
    } else if (this._pendingImagePath) {
      // Created from "Make Sprite" context menu — image path was injected
      // Legacy path: set imagePath directly
      this.spriteData.imagePath = this._pendingImagePath;
      this._pendingImagePath = null;
      this._loadSourceImage(this.spriteData.imagePath);
      this.markDirty();
    }
    // Load any referenced framesets
    this._loadAllFramesets();
  }

  destroy() {
    this._stopAnimation();
    super.destroy();
  }

  /* ------------------------------------------------------------------ */
  /*  Static registration                                                */
  /* ------------------------------------------------------------------ */
  static getFileExtensions() { return ['.sprite']; }
  static getFileExtension() { return '.sprite'; }
  static getDisplayName() { return 'Sprite Editor'; }
  static getIcon() { return '🎞️'; }
  static getPriority() { return 10; }
  static getCapabilities() { return ['sprite-editing', 'animation']; }
  static canCreate = true;
  static getDefaultFolder() { return 'Sprites'; }

  static createNew() {
    return JSON.stringify(new SpriteEditorData().toJSON(), null, 2);
  }

  /**
   * Create a sprite editor pre-populated with a given source image path.
   * Called by the project-explorer "Make Sprite" context menu.
   */
  static createFromImage(imagePath) {
    const data = new SpriteEditorData();
    data.imagePath = imagePath;
    // Derive sprite name from image filename
    const baseName = imagePath.split('/').pop().replace(/\.[^.]+$/, '');
    data.name = baseName;
    return JSON.stringify(data.toJSON(), null, 2);
  }

  /* ================================================================== */
  /*  SIDEBAR — image preview, animations list                           */
  /* ================================================================== */
  _buildSidebar(container) {
    // --- Framesets Section ---
    const fsSection = document.createElement('div');
    fsSection.className = 'sprite-section';

    const fsHeaderRow = document.createElement('div');
    fsHeaderRow.className = 'sprite-section-header';
    const fsH = document.createElement('h3');
    fsH.textContent = 'Framesets';
    fsHeaderRow.appendChild(fsH);
    const addFsBtn = document.createElement('button');
    addFsBtn.className = 'sprite-btn sprite-btn-primary sprite-btn-sm';
    addFsBtn.textContent = '+ Add\u2026';
    addFsBtn.addEventListener('click', () => this._showFramesetPicker());
    fsHeaderRow.appendChild(addFsBtn);
    fsSection.appendChild(fsHeaderRow);

    // Frameset list
    this._framesetListEl = document.createElement('div');
    this._framesetListEl.className = 'sprite-anim-list';
    fsSection.appendChild(this._framesetListEl);

    this._frameCountLabel = document.createElement('div');
    this._frameCountLabel.className = 'sprite-frame-count';
    this._frameCountLabel.textContent = '0 frames';
    fsSection.appendChild(this._frameCountLabel);
    container.appendChild(fsSection);

    // --- Legacy Source Image Section (shown only for old .sprite files) ---
    this._legacySection = document.createElement('div');
    this._legacySection.className = 'sprite-section';
    this._legacySection.style.display = 'none';

    const headerRow = document.createElement('div');
    headerRow.className = 'sprite-section-header';
    const h = document.createElement('h3');
    h.textContent = 'Source Image (Legacy)';
    headerRow.appendChild(h);
    const browseBtn = document.createElement('button');
    browseBtn.className = 'sprite-btn sprite-btn-primary sprite-btn-sm';
    browseBtn.textContent = 'Browse\u2026';
    browseBtn.addEventListener('click', () => this._showImagePicker());
    headerRow.appendChild(browseBtn);
    this._legacySection.appendChild(headerRow);

    this._imagePreviewCanvas = document.createElement('canvas');
    this._imagePreviewCanvas.className = 'sprite-image-preview';
    this._imagePreviewCanvas.width = 200;
    this._imagePreviewCanvas.height = 200;
    this._legacySection.appendChild(this._imagePreviewCanvas);

    this._texPathLabel = document.createElement('div');
    this._texPathLabel.className = 'sprite-tex-path';
    this._texPathLabel.textContent = '(none)';
    this._legacySection.appendChild(this._texPathLabel);

    this._sliceBtn = document.createElement('button');
    this._sliceBtn.className = 'sprite-btn sprite-btn-primary';
    this._sliceBtn.textContent = 'Slice Frames\u2026';
    this._sliceBtn.disabled = true;
    this._sliceBtn.addEventListener('click', () => this._showSlicerModal());
    const actionRow = document.createElement('div');
    actionRow.className = 'sprite-row';
    actionRow.appendChild(this._sliceBtn);
    this._legacySection.appendChild(actionRow);

    container.appendChild(this._legacySection);

    // --- Animations Section ---
    const animSection = this._makeSection('Animations', container);
    // New animation controls
    const animControls = document.createElement('div');
    animControls.className = 'sprite-row';
    this._animNameInput = document.createElement('input');
    this._animNameInput.type = 'text';
    this._animNameInput.placeholder = 'Animation name';
    this._animNameInput.value = 'idle';
    const addAnimBtn = document.createElement('button');
    addAnimBtn.className = 'sprite-btn';
    addAnimBtn.textContent = '+ Add';
    addAnimBtn.addEventListener('click', () => this._addAnimation());
    animControls.appendChild(this._animNameInput);
    animControls.appendChild(addAnimBtn);
    animSection.appendChild(animControls);

    // Animation list (mini preview + name per entry)
    this._animListEl = document.createElement('div');
    this._animListEl.className = 'sprite-anim-list';
    animSection.appendChild(this._animListEl);
  }

  /* ================================================================== */
  /*  MAIN AREA — frame gallery, animation strip + preview               */
  /* ================================================================== */
  _buildMainArea(container) {
    // --- Frame Gallery (drag source) ---
    const gallerySection = document.createElement('div');
    gallerySection.className = 'sprite-gallery-panel';
    const galleryHeader = document.createElement('h4');
    galleryHeader.textContent = 'Frames';
    gallerySection.appendChild(galleryHeader);

    this._frameGallery = document.createElement('div');
    this._frameGallery.className = 'sprite-frame-gallery';
    gallerySection.appendChild(this._frameGallery);
    container.appendChild(gallerySection);

    // --- Draggable splitter between gallery and animation ---
    const splitter = document.createElement('div');
    splitter.className = 'sprite-hsplitter';
    container.appendChild(splitter);

    // --- Animation Panel (strip + preview + props) ---
    const animSection = document.createElement('div');
    animSection.className = 'sprite-anim-panel';
    const animHeader = document.createElement('h4');
    animHeader.textContent = 'Animation';
    animSection.appendChild(animHeader);

    // Frame strip (drop target for frames dragged from gallery)
    this._animDetailEl = document.createElement('div');
    this._animDetailEl.className = 'sprite-anim-detail';
    animSection.appendChild(this._animDetailEl);

    // --- Horizontal row: preview (left) | properties (right) ---
    const animBody = document.createElement('div');
    animBody.className = 'sprite-anim-body';

    // LEFT: preview canvas + playback controls
    const previewCol = document.createElement('div');
    previewCol.className = 'sprite-anim-preview-col';

    this._animCanvasWrap = document.createElement('div');
    this._animCanvasWrap.className = 'sprite-anim-canvas-wrap';
    this._animCanvas = document.createElement('canvas');
    this._animCanvas.className = 'sprite-anim-canvas';
    this._animZoom = this._makeZoomable(this._animCanvas);
    this._animCanvasWrap.appendChild(this._animZoom.container);
    previewCol.appendChild(this._animCanvasWrap);

    // Playback controls
    const controls = document.createElement('div');
    controls.className = 'sprite-anim-controls';

    this._prevFrameBtn = document.createElement('button');
    this._prevFrameBtn.className = 'sprite-btn';
    this._prevFrameBtn.textContent = '\u23ee';
    this._prevFrameBtn.title = 'Previous Frame';
    this._prevFrameBtn.addEventListener('click', () => this._stepFrame(-1));

    this._playBtn = document.createElement('button');
    this._playBtn.className = 'sprite-btn';
    this._playBtn.textContent = '\u23f8';
    this._playBtn.title = 'Play / Pause';
    this._playBtn.addEventListener('click', () => this._togglePlayPause());

    this._stopBtn = document.createElement('button');
    this._stopBtn.className = 'sprite-btn';
    this._stopBtn.textContent = '\u23f9';
    this._stopBtn.title = 'Stop';
    this._stopBtn.addEventListener('click', () => this._stopAndReset());

    this._nextFrameBtn = document.createElement('button');
    this._nextFrameBtn.className = 'sprite-btn';
    this._nextFrameBtn.textContent = '\u23ed';
    this._nextFrameBtn.title = 'Next Frame';
    this._nextFrameBtn.addEventListener('click', () => this._stepFrame(1));

    this._loopCheckbox = document.createElement('input');
    this._loopCheckbox.type = 'checkbox';
    this._loopCheckbox.checked = true;
    this._loopCheckbox.addEventListener('change', () => {
      const anim = this.spriteData.animations[this._selectedAnimIndex];
      if (anim) {
        anim.loop = this._loopCheckbox.checked;
        this.markDirty();
      }
    });
    const loopLabel = document.createElement('label');
    loopLabel.textContent = ' Loop';
    loopLabel.style.marginLeft = '4px';

    this._animFrameLabel = document.createElement('span');
    this._animFrameLabel.className = 'sprite-anim-frame-label';
    this._animFrameLabel.textContent = '0 / 0';

    controls.appendChild(this._prevFrameBtn);
    controls.appendChild(this._playBtn);
    controls.appendChild(this._stopBtn);
    controls.appendChild(this._nextFrameBtn);
    controls.appendChild(this._loopCheckbox);
    controls.appendChild(loopLabel);
    controls.appendChild(this._animFrameLabel);
    previewCol.appendChild(controls);

    animBody.appendChild(previewCol);

    // RIGHT: animation properties + per-frame modifier
    const propsCol = document.createElement('div');
    propsCol.className = 'sprite-anim-props-col';

    // Animation properties (rendered dynamically)
    this._animPropsEl = document.createElement('div');
    this._animPropsEl.className = 'sprite-anim-props';
    propsCol.appendChild(this._animPropsEl);

    // Per-frame modifier (rendered dynamically)
    this._frameModifierEl = document.createElement('div');
    this._frameModifierEl.className = 'sprite-frame-modifier';
    propsCol.appendChild(this._frameModifierEl);

    animBody.appendChild(propsCol);
    animSection.appendChild(animBody);
    container.appendChild(animSection);

    // Wire splitter now that animSection exists
    this._initHSplitter(splitter, gallerySection, animSection);
  }

  /* ================================================================== */
  /*  Horizontal splitter — drag to resize top/bottom panels             */
  /* ================================================================== */
  _initHSplitter(splitterEl, topEl, bottomEl) {
    if (!topEl || !bottomEl) return;

    let startY = 0;
    let startTopH = 0;
    let startBottomH = 0;

    const onMouseMove = (e) => {
      const dy = e.clientY - startY;
      const container = topEl.parentElement;
      const totalH = container.clientHeight;
      // Subtract splitter + gaps
      const available = totalH - splitterEl.offsetHeight - 24; // ~gap+padding
      let newTopH = Math.max(60, Math.min(available - 60, startTopH + dy));
      let newBottomH = available - newTopH;
      topEl.style.flex = 'none';
      topEl.style.height = newTopH + 'px';
      bottomEl.style.flex = 'none';
      bottomEl.style.height = newBottomH + 'px';
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    splitterEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startY = e.clientY;
      startTopH = topEl.offsetHeight;
      startBottomH = bottomEl.offsetHeight;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    // Double-click to reset to default 1/3 – 2/3
    splitterEl.addEventListener('dblclick', () => {
      topEl.style.flex = '1 1 0';
      topEl.style.height = '';
      bottomEl.style.flex = '2 1 0';
      bottomEl.style.height = '';
    });
  }

  /* ================================================================== */
  /*  Helpers — sections, rows                                           */
  /* ================================================================== */
  _makeSection(title, parent) {
    const section = document.createElement('div');
    section.className = 'sprite-section';
    const h = document.createElement('h3');
    h.textContent = title;
    section.appendChild(h);
    parent.appendChild(section);
    return section;
  }

  /**
   * Make a canvas zoomable via mouse-wheel / pinch and pannable via
   * middle-mouse drag.  Returns { container, getZoom, resetZoom }.
   * The caller should append `container` instead of the raw canvas.
   *
   * `canvas` — the <canvas> element to wrap.
   * `opts.minZoom`  — minimum zoom level (default 0.25)
   * `opts.maxZoom`  — maximum zoom level (default 16)
   * `opts.onZoom`   — optional callback(zoom) after each zoom change
   */
  _makeZoomable(canvas, opts = {}) {
    const minZoom = opts.minZoom ?? 0.25;
    const maxZoom = opts.maxZoom ?? 16;
    const onZoom = opts.onZoom || null;

    const outer = document.createElement('div');
    outer.className = 'zoom-outer';
    const inner = document.createElement('div');
    inner.className = 'zoom-inner';
    inner.appendChild(canvas);
    outer.appendChild(inner);

    let zoom = 1;
    let panX = 0, panY = 0;

    const applyTransform = () => {
      inner.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      if (onZoom) onZoom(zoom);
    };

    // --- Mouse-wheel zoom (zoom toward cursor) ---
    outer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = outer.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const oldZoom = zoom;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoom = Math.min(maxZoom, Math.max(minZoom, zoom * delta));

      // Adjust pan so the point under the cursor stays put
      panX = mx - (mx - panX) * (zoom / oldZoom);
      panY = my - (my - panY) * (zoom / oldZoom);
      applyTransform();
    }, { passive: false });

    // --- Pinch-to-zoom (touch) ---
    let lastPinchDist = 0;
    let lastTouchCenter = null;

    outer.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        lastPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        lastTouchCenter = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        };
      }
    }, { passive: false });

    outer.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const center = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        };

        if (lastPinchDist > 0) {
          const rect = outer.getBoundingClientRect();
          const mx = center.x - rect.left;
          const my = center.y - rect.top;
          const oldZoom = zoom;
          zoom = Math.min(maxZoom, Math.max(minZoom, zoom * (dist / lastPinchDist)));
          panX = mx - (mx - panX) * (zoom / oldZoom);
          panY = my - (my - panY) * (zoom / oldZoom);
        }

        // Pan with two-finger drag
        if (lastTouchCenter) {
          panX += center.x - lastTouchCenter.x;
          panY += center.y - lastTouchCenter.y;
        }

        lastPinchDist = dist;
        lastTouchCenter = center;
        applyTransform();
      }
    }, { passive: false });

    outer.addEventListener('touchend', () => {
      lastPinchDist = 0;
      lastTouchCenter = null;
    });

    // --- Middle-mouse & right-click pan ---
    let panning = false, panStartX = 0, panStartY = 0;

    outer.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.button === 2) {  // middle or right button
        e.preventDefault();
        panning = true;
        panStartX = e.clientX - panX;
        panStartY = e.clientY - panY;
        outer.style.cursor = 'grabbing';
      }
    });
    // Suppress context menu on right-click inside the zoom area
    outer.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (!panning) return;
      panX = e.clientX - panStartX;
      panY = e.clientY - panStartY;
      applyTransform();
    });
    window.addEventListener('mouseup', (e) => {
      if ((e.button === 1 || e.button === 2) && panning) {
        panning = false;
        outer.style.cursor = '';
      }
    });

    const getZoom = () => zoom;
    const resetZoom = () => { zoom = 1; panX = 0; panY = 0; applyTransform(); };

    return { container: outer, getZoom, resetZoom };
  }

  /* ================================================================== */
  /*  Source image loading                                               */
  /* ================================================================== */
  async _loadSourceImage(imagePath) {
    console.log('[SpriteEditor] Loading source image:', imagePath);
    if (this._texPathLabel) {
      this._texPathLabel.textContent = imagePath ? imagePath.split('/').pop() : '(none)';
    }
    if (!imagePath) return;

    try {
      const fm = window.fileManager || window.serviceContainer?.get('fileManager');
      if (!fm) { console.error('[SpriteEditor] No FileManager'); return; }

      // Always load as a raw image — we work from the source artwork,
      // never from derived .texture files.
      const imgSrc = await this._loadImageSrc(imagePath);

      if (!imgSrc) {
        console.warn('[SpriteEditor] Could not resolve image for', imagePath);
        return;
      }

      // Create an Image and wait for it to load
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imgSrc;
      });

      this._sourceImage = img;
      this.spriteData.imageWidth = img.naturalWidth;
      this.spriteData.imageHeight = img.naturalHeight;

      // Enable Slice button now that we have an image
      if (this._sliceBtn) this._sliceBtn.disabled = false;

      // Default frame = full image when no grid set
      if (this.spriteData.frames.length === 0) {
        this.spriteData.rebuildFramesFromGrid();
        this.spriteData.ensureDefaultAnimation();
      }

      this._syncUIFromData();
      this._renderFrameGallery();
      this._startAnimation();
    } catch (err) {
      console.error('[SpriteEditor] Error loading source image:', err);
    }
  }

  /** Resolve a project-relative image path to a data-URL or blob URL. */
  async _loadImageSrc(imagePath) {
    const fm = window.fileManager || window.serviceContainer?.get('fileManager');
    if (!fm) return null;

    // Normalise path — may or may not start with "Sources/"
    let paths = [imagePath];
    if (!imagePath.startsWith('Sources/')) paths.push('Sources/' + imagePath);
    if (!imagePath.startsWith('Resources/')) paths.push('Resources/' + imagePath);
    // Also try under Sources/Images/
    const filename = imagePath.split('/').pop();
    paths.push('Sources/Images/' + filename);
    paths.push('Resources/Images/' + filename);

    for (const p of paths) {
      try {
        const file = await fm.loadFile(p);
        if (!file) continue;
        const content = file.fileContent;
        if (!content) continue;
        // If already a data-URL or blob-URL
        if (typeof content === 'string' && (content.startsWith('data:') || content.startsWith('blob:'))) {
          return content;
        }
        // If base64
        if (typeof content === 'string') {
          // Guess mime
          const ext = p.split('.').pop().toLowerCase();
          const mime = { png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp' }[ext] || 'image/png';
          return `data:${mime};base64,${content}`;
        }
        // If ArrayBuffer / Uint8Array
        if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
          const blob = new Blob([content], { type: 'image/png' });
          return URL.createObjectURL(blob);
        }
      } catch (_) { /* try next */ }
    }
    return null;
  }

  /** Show a picker listing raw image files (PNG, GIF, etc.) in the project.
   *  We intentionally exclude .texture files — sprites work from source artwork. */
  async _showImagePicker() {
    const projectExplorer = window.serviceContainer?.get('projectExplorer');
    let candidates = [];

    if (projectExplorer && typeof projectExplorer.GetImageFiles === 'function') {
      const imageFiles = projectExplorer.GetImageFiles();
      candidates = imageFiles
        .filter(f => /\.(png|gif|jpg|jpeg|bmp)$/i.test(f.name))
        .map(f => ({ label: f.name, path: f.fullPath }));
    }

    // Fallback: also try fm.listFiles if the tree gave us nothing
    if (candidates.length === 0) {
      const fm = window.fileManager || window.serviceContainer?.get('fileManager');
      if (fm) {
        try {
          const allFiles = await fm.listFiles('');
          const filtered = allFiles.filter(f => /\.(png|gif|jpg|jpeg|bmp)$/i.test(f));
          candidates = filtered.map(f => ({ label: f.split('/').pop(), path: f }));
        } catch (_) { /* ignore */ }
      }
    }

    if (candidates.length === 0) {
      alert('No image files found in the project.');
      return;
    }

    // Build a simple modal
    const overlay = document.createElement('div');
    overlay.className = 'sprite-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'sprite-modal';
    modal.innerHTML = `<h3>Select Source Image</h3>`;
    const list = document.createElement('ul');
    list.className = 'sprite-tex-list';
    for (const item of candidates) {
      const li = document.createElement('li');
      li.textContent = item.label;
      li.title = item.path;
      li.addEventListener('click', () => {
        overlay.remove();
        this.spriteData.imagePath = item.path;
        this.spriteData.frames = [];
        this.spriteData.animations = [];
        this._loadSourceImage(item.path);
        this.markDirty();
      });
      list.appendChild(li);
    }
    modal.appendChild(list);
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'sprite-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());
    modal.appendChild(cancelBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  /* ================================================================== */
  /*  UI sync — data → widgets                                           */
  /* ================================================================== */
  _syncUIFromData() {
    if (!this.spriteData) return;

    const isLegacy = !this.spriteData.usesFramesets && this.spriteData.imagePath;

    // Show/hide legacy section
    if (this._legacySection) {
      this._legacySection.style.display = isLegacy ? '' : 'none';
    }

    // Frame count — aggregate from framesets or legacy frames
    const totalFrames = this.spriteData.usesFramesets
      ? this._mergedFrames.length
      : this.spriteData.frames.length;
    if (this._frameCountLabel) {
      this._frameCountLabel.textContent = `${totalFrames} frame(s)`;
    }

    // Legacy: filename label
    if (this._texPathLabel) {
      const path = this.spriteData.imagePath || '';
      this._texPathLabel.textContent = path ? path.split('/').pop() : '(none)';
    }

    // Legacy: image preview (sidebar)
    this._updateImagePreview();

    // Frameset list (sidebar)
    this._renderFramesetList();

    // Frame gallery (main area)
    this._renderFrameGallery();

    // Animations list (sidebar — mini previews)
    this._renderAnimationsList();

    // Animation detail strip (main area)
    this._renderAnimationDetail();

    // Animation properties + per-frame modifier (main area)
    this._renderAnimProps();
    this._renderFrameModifiers();
  }

  /** Draw the source image into the sidebar preview canvas */
  _updateImagePreview() {
    const canvas = this._imagePreviewCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this._drawCheckerboard(ctx, canvas.width, canvas.height);
    if (!this._sourceImage) return;
    const img = this._sourceImage;
    const scale = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  /* ================================================================== */
  /*  Frameset management                                                */
  /* ================================================================== */

  /** Load all referenced framesets from storage and rebuild merged frame list. */
  onFocus() {
    super.onFocus();
    // Reload framesets from storage so we pick up any external edits
    if (this.spriteData && this.spriteData.usesFramesets) {
      this._loadAllFramesets();
    }
  }

  async _loadAllFramesets() {
    if (!this.spriteData.usesFramesets) return;

    for (let i = 0; i < this.spriteData.framesets.length; i++) {
      await this._loadFrameset(i);
    }
    this._rebuildMergedFrames();
    this._syncUIFromData();
    this._startAnimation();
  }

  /** Load a single frameset by index into the cache. */
  async _loadFrameset(fsIdx) {
    const fsRef = this.spriteData.framesets[fsIdx];
    if (!fsRef || !fsRef.path) return;

    try {
      let content = null;

      // Prefer live editor content (unsaved changes) over storage
      const tm = window.tabManager;
      if (tm && tm.dedicatedTabs) {
        for (const [, tabInfo] of tm.dedicatedTabs.entries()) {
          if (tabInfo.fullPath === fsRef.path && tabInfo.viewer && typeof tabInfo.viewer.getContent === 'function') {
            content = tabInfo.viewer.getContent();
            break;
          }
        }
        // Also check the preview tab
        if (!content && tm.previewPath === fsRef.path && tm.previewViewer && typeof tm.previewViewer.getContent === 'function') {
          content = tm.previewViewer.getContent();
        }
      }

      // Fall back to storage
      if (!content) {
        const fm = window.fileManager || window.serviceContainer?.get('fileManager');
        if (!fm) return;
        const file = await fm.loadFile(fsRef.path);
        if (!file || !file.fileContent) {
          console.warn('[SpriteEditor] Could not load frameset:', fsRef.path);
          return;
        }
        content = file.fileContent;
        if (typeof content === 'string') {
          try { if (content.charAt(0) !== '{') content = atob(content); } catch (_) {}
        }
      }

      const fsData = JSON.parse(content);

      // Load the source image for this frameset
      let img = null;
      if (fsData.imagePath) {
        const imgSrc = await this._loadImageSrc(fsData.imagePath);
        if (imgSrc) {
          img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = imgSrc;
          });
        }
      }

      this._loadedFramesets.set(fsIdx, { data: fsData, image: img });
    } catch (err) {
      console.error('[SpriteEditor] Error loading frameset:', fsRef.path, err);
    }
  }

  /** Rebuild the merged frame list from all loaded framesets. */
  _rebuildMergedFrames() {
    this._mergedFrames = [];

    for (let fsIdx = 0; fsIdx < this.spriteData.framesets.length; fsIdx++) {
      const cached = this._loadedFramesets.get(fsIdx);
      if (!cached || !cached.data || !cached.data.frames) continue;

      for (const frame of cached.data.frames) {
        this._mergedFrames.push({
          id: `${fsIdx}:${frame.id}`,
          name: frame.name || `frame_${frame.id}`,
          x: frame.x,
          y: frame.y,
          w: frame.w,
          h: frame.h,
          framesetIdx: fsIdx,
          localId: frame.id,
          image: cached.image,
        });
      }
    }
  }

  /** Show picker listing .frameset files in the project. */
  async _showFramesetPicker() {
    let candidates = [];

    // Use project explorer tree to find .frameset files
    const projectExplorer = window.serviceContainer?.get('projectExplorer');
    if (projectExplorer && typeof projectExplorer.GetSourceFiles === 'function') {
      // Search all source files — framesets may be in Sprites or alongside images
      const allSrc = projectExplorer.GetSourceFiles();
      candidates = allSrc
        .filter(f => /\.frameset$/i.test(f.name))
        .map(f => ({ label: f.name, path: f.fullPath }));
    }

    // Fallback: try fileIOService.listFiles (returns record objects)
    if (candidates.length === 0) {
      try {
        const fio = window.fileIOService;
        if (fio) {
          const allFiles = await fio.listFiles('');
          candidates = allFiles
            .filter(r => /\.frameset$/i.test(r.path || r.name || ''))
            .map(r => {
              const p = r.path || r.name || '';
              return { label: p.split('/').pop(), path: p };
            });
        }
      } catch (_) { /* ignore */ }
    }

    if (candidates.length === 0) {
      alert('No .frameset files found in the project.\nCreate one first by right-clicking an image \u2192 Make Frameset.');
      return;
    }

    // Filter out already-added framesets
    const existingPaths = new Set(this.spriteData.framesets.map(fs => fs.path));
    candidates = candidates.filter(c => !existingPaths.has(c.path));

    if (candidates.length === 0) {
      alert('All available framesets are already added to this sprite.');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'sprite-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'sprite-modal';
    modal.innerHTML = `<h3>Add Frameset</h3>`;
    const list = document.createElement('ul');
    list.className = 'sprite-tex-list';
    for (const item of candidates) {
      const li = document.createElement('li');
      li.textContent = item.label;
      li.title = item.path;
      li.addEventListener('click', async () => {
        overlay.remove();
        await this._addFrameset(item.path);
      });
      list.appendChild(li);
    }
    modal.appendChild(list);
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'sprite-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());
    modal.appendChild(cancelBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  /** Add a frameset reference and load it. */
  async _addFrameset(framesetPath) {
    const fsIdx = this.spriteData.framesets.length;
    this.spriteData.framesets.push({ path: framesetPath });
    await this._loadFrameset(fsIdx);
    this._rebuildMergedFrames();

    // Auto-create default animation if this is the first frameset and no animations exist
    if (this._mergedFrames.length > 0 && this.spriteData.animations.length === 0) {
      this.spriteData.animations.push({
        name: 'idle',
        frameIds: [this._mergedFrames[0].id],
        frameDuration: 100,
        loop: true,
        dx: 0,
        dy: 0,
        frameOverrides: {},
      });
    }

    this._syncUIFromData();
    this._restartAnimation();
    this.markDirty();
  }

  /** Remove a frameset by index. */
  _removeFrameset(fsIdx) {
    this.spriteData.framesets.splice(fsIdx, 1);

    // Rebuild loaded frameset cache (indices shift)
    const newCache = new Map();
    for (let i = 0; i < this.spriteData.framesets.length; i++) {
      const oldIdx = i >= fsIdx ? i + 1 : i;
      if (this._loadedFramesets.has(oldIdx)) {
        newCache.set(i, this._loadedFramesets.get(oldIdx));
      }
    }
    this._loadedFramesets = newCache;
    this._rebuildMergedFrames();

    // Clean up animation references to removed frameset
    const removedPrefix = `${fsIdx}:`;
    for (const anim of this.spriteData.animations) {
      // Remap frame IDs: remove the deleted frameset's frames, shift higher indices
      anim.frameIds = anim.frameIds
        .filter(id => !String(id).startsWith(removedPrefix))
        .map(id => {
          const str = String(id);
          const colonIdx = str.indexOf(':');
          if (colonIdx === -1) return id;
          const fsi = parseInt(str.substring(0, colonIdx), 10);
          if (fsi > fsIdx) {
            return `${fsi - 1}:${str.substring(colonIdx + 1)}`;
          }
          return id;
        });
    }

    this._syncUIFromData();
    this._restartAnimation();
    this.markDirty();
  }

  /** Render the frameset list in the sidebar. */
  _renderFramesetList() {
    const el = this._framesetListEl;
    if (!el) return;
    el.innerHTML = '';

    if (this.spriteData.framesets.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'sprite-hint';
      hint.textContent = 'No framesets added yet. Click "+ Add" to add one.';
      el.appendChild(hint);
      return;
    }

    this.spriteData.framesets.forEach((fsRef, idx) => {
      const item = document.createElement('div');
      item.className = 'sprite-anim-item';

      // Thumbnail: first frame of frameset
      const thumb = document.createElement('canvas');
      thumb.width = 32;
      thumb.height = 32;
      thumb.className = 'sprite-frame-thumb';
      const cached = this._loadedFramesets.get(idx);
      if (cached && cached.image && cached.data && cached.data.frames && cached.data.frames.length > 0) {
        const f = cached.data.frames[0];
        const ctx = thumb.getContext('2d');
        const scale = Math.min(32 / f.w, 32 / f.h);
        const dw = f.w * scale;
        const dh = f.h * scale;
        const dx = (32 - dw) / 2;
        const dy = (32 - dh) / 2;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(cached.image, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'sprite-anim-name';
      const fileName = fsRef.path.split('/').pop();
      const frameCount = cached && cached.data ? cached.data.frames.length : '?';
      nameSpan.textContent = `${fileName} (${frameCount})`;
      nameSpan.title = fsRef.path;

      const delBtn = document.createElement('button');
      delBtn.className = 'sprite-btn sprite-btn-danger sprite-btn-sm';
      delBtn.textContent = '\u2715';
      delBtn.title = 'Remove frameset';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._removeFrameset(idx);
      });

      item.appendChild(thumb);
      item.appendChild(nameSpan);
      item.appendChild(delBtn);
      el.appendChild(item);
    });
  }

  /* ================================================================== */
  /*  Frames list rendering                                              */
  /* ================================================================== */
  _renderFramesList() {
    const el = this._framesListEl;
    if (!el) return;
    el.innerHTML = '';

    for (const frame of this.spriteData.frames) {
      const item = document.createElement('div');
      item.className = 'sprite-frame-item';
      if (this._selectedFrameIds.has(frame.id)) item.classList.add('selected');

      // Thumbnail
      const thumb = document.createElement('canvas');
      thumb.width = 32;
      thumb.height = 32;
      thumb.className = 'sprite-frame-thumb';
      this._drawFrameToCanvas(thumb, frame);

      const label = document.createElement('span');
      label.textContent = `#${frame.id} (${frame.w}×${frame.h})`;

      item.appendChild(thumb);
      item.appendChild(label);

      item.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
          // Toggle selection
          if (this._selectedFrameIds.has(frame.id)) {
            this._selectedFrameIds.delete(frame.id);
          } else {
            this._selectedFrameIds.add(frame.id);
          }
        } else {
          this._selectedFrameIds.clear();
          this._selectedFrameIds.add(frame.id);
        }
        this._renderFramesList();
        this._renderFrameGallery();
      });

      el.appendChild(item);
    }
  }

  /** Draw a single frame region onto a thumbnail canvas.
   *  Supports both legacy frames (uses _sourceImage) and merged frameset frames (have .image). */
  _drawFrameToCanvas(canvas, frame) {
    const img = frame.image || this._sourceImage;
    if (!img) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Scale to fit
    const scale = Math.min(canvas.width / frame.w, canvas.height / frame.h);
    const dw = frame.w * scale;
    const dh = frame.h * scale;
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, frame.x, frame.y, frame.w, frame.h, dx, dy, dw, dh);
  }

  /* ================================================================== */
  /*  Animations list rendering                                          */
  /* ================================================================== */
  _renderAnimationsList() {
    const el = this._animListEl;
    if (!el) return;
    el.innerHTML = '';

    this.spriteData.animations.forEach((anim, idx) => {
      const item = document.createElement('div');
      item.className = 'sprite-anim-item';
      if (idx === this._selectedAnimIndex) item.classList.add('selected');

      // Mini preview canvas (first frame of animation)
      const thumb = document.createElement('canvas');
      thumb.width = 32;
      thumb.height = 32;
      thumb.className = 'sprite-frame-thumb';
      if (anim.frameIds.length > 0) {
        const firstId = anim.frameIds[0];
        const frame = this._findFrame(firstId);
        if (frame) this._drawFrameToCanvas(thumb, frame);
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'sprite-anim-name';
      nameSpan.textContent = anim.name;

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'sprite-btn sprite-btn-danger sprite-btn-sm';
      delBtn.textContent = '\u2715';
      delBtn.title = 'Delete animation';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.spriteData.animations.splice(idx, 1);
        if (this._selectedAnimIndex >= this.spriteData.animations.length) {
          this._selectedAnimIndex = Math.max(0, this.spriteData.animations.length - 1);
        }
        this._syncUIFromData();
        this._restartAnimation();
        this.markDirty();
      });

      item.appendChild(thumb);
      item.appendChild(nameSpan);
      item.appendChild(delBtn);

      item.addEventListener('click', () => {
        this._selectedAnimIndex = idx;
        this._selectedStripIdx = -1;
        this._renderAnimationsList();
        this._renderAnimationDetail();
        this._renderAnimProps();
        this._renderFrameModifiers();
        this._restartAnimation();
      });

      el.appendChild(item);
    });
  }

  _addAnimation() {
    const name = (this._animNameInput.value || '').trim() || `anim_${this.spriteData.animations.length}`;
    // Start with just the first available frame
    const frames = this.spriteData.usesFramesets ? this._mergedFrames : this.spriteData.frames;
    const firstId = frames.length > 0 ? frames[0].id : 0;
    this.spriteData.animations.push({
      name,
      frameIds: [firstId],
      frameDuration: 100,
      loop: true,
      dx: 0,
      dy: 0,
      frameOverrides: {},
    });
    this._selectedAnimIndex = this.spriteData.animations.length - 1;
    this._syncUIFromData();
    this._restartAnimation();
    this.markDirty();
  }

  /* ================================================================== */
  /*  Animation detail — frame sequence editing (main area)              */
  /* ================================================================== */

  /** Find a frame by ID — checks merged framesets first, then legacy frames. */
  _findFrame(fid) {
    // Try merged frames (frameset mode)
    const merged = this._mergedFrames.find(f => f.id === fid || String(f.id) === String(fid));
    if (merged) return merged;
    // Legacy: numeric ID lookup
    const numId = typeof fid === 'number' ? fid : parseInt(fid, 10);
    if (!isNaN(numId)) {
      return this.spriteData.frames.find(f => f.id === numId);
    }
    return null;
  }

  _renderAnimationDetail() {
    const el = this._animDetailEl;
    if (!el) return;
    el.innerHTML = '';

    const anim = this.spriteData.animations[this._selectedAnimIndex];
    if (!anim) {
      el.innerHTML = '<span class="sprite-hint">Select or create an animation</span>';
      return;
    }

    // Loop sync
    if (this._loopCheckbox) this._loopCheckbox.checked = anim.loop;

    const label = document.createElement('div');
    label.className = 'sprite-anim-detail-label';
    label.textContent = `Frames for "\u200b${anim.name}\u200b":  (drag from gallery \u2022 reorder by dragging)`;
    el.appendChild(label);

    const frameStrip = document.createElement('div');
    frameStrip.className = 'sprite-anim-strip';

    // --- Drop zone: accept frames from gallery or reorder within strip ---
    frameStrip.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-sprite-strip-idx') ? 'move' : 'copy';
      frameStrip.classList.add('drag-over');
    });
    frameStrip.addEventListener('dragleave', (e) => {
      if (!frameStrip.contains(e.relatedTarget)) frameStrip.classList.remove('drag-over');
    });
    frameStrip.addEventListener('drop', (e) => {
      e.preventDefault();
      frameStrip.classList.remove('drag-over');

      // Determine insert position from mouse X
      const cells = Array.from(frameStrip.querySelectorAll('.sprite-anim-strip-cell'));
      let insertIdx = anim.frameIds.length; // default: append at end
      for (let i = 0; i < cells.length; i++) {
        const rect = cells[i].getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) {
          insertIdx = i;
          break;
        }
      }

      const stripIdx = e.dataTransfer.getData('application/x-sprite-strip-idx');
      const frameIdStr = e.dataTransfer.getData('application/x-sprite-frame-id');

      if (stripIdx !== '') {
        // Reorder within strip
        const fromIdx = parseInt(stripIdx, 10);
        if (fromIdx !== insertIdx) {
          const [moved] = anim.frameIds.splice(fromIdx, 1);
          const adjustedIdx = fromIdx < insertIdx ? insertIdx - 1 : insertIdx;
          anim.frameIds.splice(adjustedIdx, 0, moved);
          this._renderAnimationDetail();
          this._restartAnimation();
          this.markDirty();
        }
      } else if (frameIdStr !== '') {
        // Insert from gallery (allows duplicates) — keep as string for frameset IDs
        const frameId = frameIdStr.includes(':') ? frameIdStr : parseInt(frameIdStr, 10);
        anim.frameIds.splice(insertIdx, 0, frameId);
        this._renderAnimationDetail();
        this._restartAnimation();
        this.markDirty();
      }
    });

    anim.frameIds.forEach((fid, seqIdx) => {
      const frame = this._findFrame(fid);
      if (!frame) return;

      const cell = document.createElement('div');
      cell.className = 'sprite-anim-strip-cell';
      cell.draggable = true;
      cell.dataset.seqIdx = seqIdx;

      const thumb = document.createElement('canvas');
      thumb.width = 40;
      thumb.height = 40;
      thumb.className = 'sprite-frame-thumb';
      this._drawFrameToCanvas(thumb, frame);

      const idLabel = document.createElement('span');
      idLabel.className = 'sprite-anim-strip-id';
      idLabel.textContent = `#${fid}`;

      // Remove from sequence
      const removeBtn = document.createElement('button');
      removeBtn.className = 'sprite-btn sprite-btn-danger sprite-btn-xs';
      removeBtn.textContent = '\u00d7';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        anim.frameIds.splice(seqIdx, 1);
        this._renderAnimationDetail();
        this._restartAnimation();
        this.markDirty();
      });

      cell.appendChild(thumb);
      cell.appendChild(idLabel);
      cell.appendChild(removeBtn);

      // Drag for reorder within strip
      cell.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-sprite-strip-idx', String(seqIdx));
        e.dataTransfer.setData('application/x-sprite-frame-id', String(fid));
        e.dataTransfer.effectAllowed = 'move';
        cell.classList.add('dragging');
      });
      cell.addEventListener('dragend', () => cell.classList.remove('dragging'));
      cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drag-over'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));

      // Click to select (for per-frame modifier)
      if (seqIdx === this._selectedStripIdx) cell.classList.add('selected');
      cell.addEventListener('click', () => {
        this._selectedStripIdx = seqIdx;
        this._renderAnimationDetail();
        this._renderFrameModifiers();
      });

      frameStrip.appendChild(cell);
    });

    el.appendChild(frameStrip);

    // Drop hint when strip is empty
    if (anim.frameIds.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'sprite-hint';
      hint.textContent = 'Drag frames from the gallery above to build this animation.';
      el.appendChild(hint);
    }
  }

  /* ================================================================== */
  /*  Animation Properties panel (right of preview)                      */
  /* ================================================================== */
  _renderAnimProps() {
    const el = this._animPropsEl;
    if (!el) return;
    el.innerHTML = '';

    const anim = this.spriteData.animations[this._selectedAnimIndex];
    if (!anim) return;

    // Ensure new fields exist (backward compat)
    if (anim.frameDuration === undefined) anim.frameDuration = anim.fps ? Math.round(1000 / anim.fps) : 100;
    if (anim.dx === undefined) anim.dx = 0.0;
    if (anim.dy === undefined) anim.dy = 0.0;
    if (!anim.frameOverrides) anim.frameOverrides = {};

    const title = document.createElement('h5');
    title.className = 'sprite-props-title';
    title.textContent = 'Properties';
    el.appendChild(title);

    // Animation Name
    const nameRow = document.createElement('div');
    nameRow.className = 'sprite-field-row';
    const nameLbl = document.createElement('label');
    nameLbl.textContent = 'Name';
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = anim.name;
    nameInp.className = 'sprite-props-input';
    nameInp.addEventListener('change', () => {
      anim.name = nameInp.value.trim() || anim.name;
      this._renderAnimationsList();
      this._renderAnimationDetail();
      this.markDirty();
    });
    nameRow.appendChild(nameLbl);
    nameRow.appendChild(nameInp);
    el.appendChild(nameRow);

    // Frame Duration (ms)
    const durRow = document.createElement('div');
    durRow.className = 'sprite-field-row';
    const durLbl = document.createElement('label');
    durLbl.textContent = 'Duration (ms)';
    const durInp = document.createElement('input');
    durInp.type = 'number';
    durInp.min = '1';
    durInp.value = anim.frameDuration;
    durInp.className = 'sprite-props-input';
    durInp.addEventListener('change', () => {
      anim.frameDuration = Math.max(1, parseInt(durInp.value, 10) || 100);
      this.markDirty();
    });
    durRow.appendChild(durLbl);
    durRow.appendChild(durInp);
    el.appendChild(durRow);

    // dx (per-frame motion — float)
    const dxRow = document.createElement('div');
    dxRow.className = 'sprite-field-row';
    const dxLbl = document.createElement('label');
    dxLbl.textContent = 'Motion dx';
    const dxInp = document.createElement('input');
    dxInp.type = 'number';
    dxInp.step = 'any';
    dxInp.value = anim.dx;
    dxInp.className = 'sprite-props-input';
    dxInp.title = 'Default horizontal motion per frame (px, float)';
    dxInp.addEventListener('change', () => {
      anim.dx = parseFloat(dxInp.value) || 0;
      this.markDirty();
    });
    dxRow.appendChild(dxLbl);
    dxRow.appendChild(dxInp);
    el.appendChild(dxRow);

    // dy (per-frame motion — float)
    const dyRow = document.createElement('div');
    dyRow.className = 'sprite-field-row';
    const dyLbl = document.createElement('label');
    dyLbl.textContent = 'Motion dy';
    const dyInp = document.createElement('input');
    dyInp.type = 'number';
    dyInp.step = 'any';
    dyInp.value = anim.dy;
    dyInp.className = 'sprite-props-input';
    dyInp.title = 'Default vertical motion per frame (px, float)';
    dyInp.addEventListener('change', () => {
      anim.dy = parseFloat(dyInp.value) || 0;
      this.markDirty();
    });
    dyRow.appendChild(dyLbl);
    dyRow.appendChild(dyInp);
    el.appendChild(dyRow);

    // Loop
    const loopRow = document.createElement('div');
    loopRow.className = 'sprite-field-row';
    const loopLbl = document.createElement('label');
    loopLbl.textContent = 'Loop';
    const loopCb = document.createElement('input');
    loopCb.type = 'checkbox';
    loopCb.checked = anim.loop;
    loopCb.style.accentColor = '#4a9eff';
    loopCb.addEventListener('change', () => {
      anim.loop = loopCb.checked;
      if (this._loopCheckbox) this._loopCheckbox.checked = anim.loop;
      this.markDirty();
    });
    loopRow.appendChild(loopLbl);
    loopRow.appendChild(loopCb);
    el.appendChild(loopRow);
  }

  /* ================================================================== */
  /*  Per-frame modifier panel (below anim properties)                   */
  /* ================================================================== */
  _renderFrameModifiers() {
    const el = this._frameModifierEl;
    if (!el) return;
    el.innerHTML = '';

    const anim = this.spriteData.animations[this._selectedAnimIndex];
    if (!anim) return;
    if (!anim.frameOverrides) anim.frameOverrides = {};

    const seqIdx = this._selectedStripIdx;
    if (seqIdx < 0 || seqIdx >= anim.frameIds.length) {
      const hint = document.createElement('div');
      hint.className = 'sprite-hint';
      hint.textContent = 'Click a frame in the strip to edit per-frame overrides.';
      el.appendChild(hint);
      return;
    }

    const fid = anim.frameIds[seqIdx];
    const ov = anim.frameOverrides[seqIdx] || {};

    const title = document.createElement('h5');
    title.className = 'sprite-props-title';
    title.textContent = `Frame #${seqIdx} Override  (id ${fid})`;
    el.appendChild(title);

    const makeRow = (labelText, key, placeholder, isFloat = false) => {
      const row = document.createElement('div');
      row.className = 'sprite-field-row';
      const lbl = document.createElement('label');
      lbl.textContent = labelText;
      const inp = document.createElement('input');
      inp.type = 'number';
      if (isFloat) inp.step = 'any';
      inp.value = ov[key] !== undefined ? ov[key] : '';
      inp.placeholder = placeholder;
      inp.className = 'sprite-props-input';
      inp.addEventListener('change', () => {
        if (!anim.frameOverrides[seqIdx]) anim.frameOverrides[seqIdx] = {};
        const val = inp.value.trim();
        if (val === '') {
          delete anim.frameOverrides[seqIdx][key];
          // Clean up empty override objects
          if (Object.keys(anim.frameOverrides[seqIdx]).length === 0) {
            delete anim.frameOverrides[seqIdx];
          }
        } else {
          anim.frameOverrides[seqIdx][key] = isFloat ? (parseFloat(val) || 0) : (parseInt(val, 10) || 0);
        }
        this.markDirty();
      });
      row.appendChild(lbl);
      row.appendChild(inp);
      el.appendChild(row);
    };

    makeRow('Duration (ms)', 'duration', String(anim.frameDuration));
    makeRow('Motion dx', 'dx', String(anim.dx), true);
    makeRow('Motion dy', 'dy', String(anim.dy), true);
    makeRow('Offset X', 'offsetX', '0');
    makeRow('Offset Y', 'offsetY', '0');

    // Clear overrides button
    if (Object.keys(ov).length > 0) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'sprite-btn sprite-btn-sm';
      clearBtn.textContent = 'Clear Overrides';
      clearBtn.style.marginTop = '6px';
      clearBtn.addEventListener('click', () => {
        delete anim.frameOverrides[seqIdx];
        this._renderFrameModifiers();
        this.markDirty();
      });
      el.appendChild(clearBtn);
    }
  }

  /* ================================================================== */
  /*  Frame Gallery (main area)                                          */
  /* ================================================================== */
  _renderFrameGallery() {
    const el = this._frameGallery;
    if (!el) return;
    el.innerHTML = '';

    // Use merged frames from framesets, or legacy frames
    const frames = this.spriteData.usesFramesets ? this._mergedFrames : this.spriteData.frames;

    if (frames.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'sprite-hint';
      hint.textContent = this.spriteData.usesFramesets
        ? 'No frames yet \u2014 add a frameset to populate frames.'
        : 'No frames yet \u2014 use Slice Frames to extract from the source image.';
      el.appendChild(hint);
      return;
    }

    for (const frame of frames) {
      const cell = document.createElement('div');
      cell.className = 'sprite-gallery-cell';
      if (this._selectedFrameIds.has(frame.id)) cell.classList.add('selected');

      // Make draggable — drag onto animation strip to insert
      cell.draggable = true;
      cell.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-sprite-frame-id', String(frame.id));
        e.dataTransfer.effectAllowed = 'copy';
        cell.classList.add('dragging');
      });
      cell.addEventListener('dragend', () => cell.classList.remove('dragging'));

      // Larger thumbnails for gallery view
      const maxThumb = 64;
      const fscale = Math.min(maxThumb / frame.w, maxThumb / frame.h, 4);
      const thumb = document.createElement('canvas');
      thumb.width = Math.max(16, Math.ceil(frame.w * fscale));
      thumb.height = Math.max(16, Math.ceil(frame.h * fscale));
      thumb.className = 'sprite-frame-thumb';
      this._drawFrameToCanvas(thumb, frame);

      const label = document.createElement('span');
      label.className = 'sprite-gallery-label';
      label.textContent = `#${frame.id}`;

      const size = document.createElement('span');
      size.className = 'sprite-gallery-size';
      size.textContent = `${frame.w}\u00d7${frame.h}`;

      cell.appendChild(thumb);
      cell.appendChild(label);
      cell.appendChild(size);

      cell.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
          if (this._selectedFrameIds.has(frame.id)) {
            this._selectedFrameIds.delete(frame.id);
          } else {
            this._selectedFrameIds.add(frame.id);
          }
        } else {
          this._selectedFrameIds.clear();
          this._selectedFrameIds.add(frame.id);
        }
        this._renderFrameGallery();
      });

      el.appendChild(cell);
    }
  }

  /* ================================================================== */
  /*  Frame Slicer Modal                                                 */
  /* ================================================================== */
  _showSlicerModal() {
    if (!this._sourceImage) {
      alert('Load a source image first.');
      return;
    }

    const img = this._sourceImage;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;

    // --- Modal scaffold ---
    const overlay = document.createElement('div');
    overlay.className = 'slicer-overlay';
    const modal = document.createElement('div');
    modal.className = 'slicer-modal';

    // Header with tabs
    const header = document.createElement('div');
    header.className = 'slicer-header';
    const title = document.createElement('h3');
    title.textContent = 'Frame Slicer';
    header.appendChild(title);

    const tabs = document.createElement('div');
    tabs.className = 'slicer-tabs';
    const gridTab = document.createElement('button');
    gridTab.className = 'slicer-tab active';
    gridTab.textContent = 'Grid';
    const detectTab = document.createElement('button');
    detectTab.className = 'slicer-tab';
    detectTab.textContent = 'Detect';
    tabs.appendChild(gridTab);
    tabs.appendChild(detectTab);
    header.appendChild(tabs);
    modal.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'slicer-body';
    modal.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'slicer-footer';
    const infoLabel = document.createElement('span');
    infoLabel.className = 'slicer-info';
    infoLabel.textContent = '0 frames';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'sprite-btn';
    cancelBtn.textContent = 'Cancel';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'sprite-btn sprite-btn-primary';
    applyBtn.textContent = 'Apply';
    footer.appendChild(infoLabel);
    footer.appendChild(cancelBtn);
    footer.appendChild(applyBtn);
    modal.appendChild(footer);
    overlay.appendChild(modal);

    // Shared state
    let currentMode = 'grid';
    let pendingFrames = [];

    // Grid state — seed from current spriteData.
    // Default to full image (single frame) so the user sees the image clearly
    // and can drag to subdivide.
    const gridState = {
      fw: this.spriteData.frameWidth || iw,
      fh: this.spriteData.frameHeight || ih,
      ox: this.spriteData.gridOffsetX || 0,
      oy: this.spriteData.gridOffsetY || 0,
      sx: this.spriteData.gridSpacingX || 0,
      sy: this.spriteData.gridSpacingY || 0,
    };

    /* ---------- Grid Mode ---------- */
    const buildGridMode = () => {
      body.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'slicer-content';

      // Canvas
      const canvasArea = document.createElement('div');
      canvasArea.className = 'slicer-canvas-area';
      const canvas = document.createElement('canvas');
      canvas.className = 'slicer-canvas';
      const zoomView = this._makeZoomable(canvas);
      canvasArea.appendChild(zoomView.container);
      wrap.appendChild(canvasArea);

      // Controls
      const controls = document.createElement('div');
      controls.className = 'slicer-controls';

      const makeInput = (labelText, value, onChange) => {
        const row = document.createElement('div');
        row.className = 'sprite-field-row';
        const lbl = document.createElement('label');
        lbl.textContent = labelText;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = '0';
        inp.value = value;
        inp.addEventListener('input', () => {
          onChange(parseInt(inp.value, 10) || 0);
          redraw();
        });
        row.appendChild(lbl);
        row.appendChild(inp);
        controls.appendChild(row);
        return inp;
      };

      const fwInput = makeInput('Frame W', gridState.fw, v => { gridState.fw = v; });
      const fhInput = makeInput('Frame H', gridState.fh, v => { gridState.fh = v; });
      makeInput('Offset X', gridState.ox, v => { gridState.ox = v; });
      makeInput('Offset Y', gridState.oy, v => { gridState.oy = v; });
      makeInput('Spacing X', gridState.sx, v => { gridState.sx = v; });
      makeInput('Spacing Y', gridState.sy, v => { gridState.sy = v; });

      // Snap-to-divisor checkbox
      const snapRow = document.createElement('div');
      snapRow.className = 'sprite-field-row';
      snapRow.style.marginTop = '6px';
      const snapCb = document.createElement('input');
      snapCb.type = 'checkbox';
      snapCb.id = 'slicer-snap-cb';
      snapCb.checked = true;
      snapCb.style.accentColor = '#4a9eff';
      const snapLabel = document.createElement('label');
      snapLabel.htmlFor = 'slicer-snap-cb';
      snapLabel.textContent = 'Snap to even divisor';
      snapLabel.style.flex = '1';
      snapRow.appendChild(snapCb);
      snapRow.appendChild(snapLabel);
      controls.appendChild(snapRow);

      /**
       * Snap a value to the nearest divisor of `total` (the usable image
       * extent after subtracting offset).  Returns the closest divisor ≥ 1.
       */
      const snapToDivisor = (value, total) => {
        if (total <= 0 || value <= 0) return value;
        // Find the divisor of `total` closest to `value`
        let best = total;          // fallback = full extent
        let bestDist = Math.abs(value - total);
        for (let d = 1; d * d <= total; d++) {
          if (total % d === 0) {
            // d is a divisor, and so is total/d
            for (const candidate of [d, total / d]) {
              const dist = Math.abs(value - candidate);
              if (dist < bestDist) { bestDist = dist; best = candidate; }
            }
          }
        }
        return best;
      };

      /** Optionally snap fw/fh and update the inputs */
      const applySnap = () => {
        if (!snapCb.checked) return;
        const usableW = iw - gridState.ox;
        const usableH = ih - gridState.oy;
        gridState.fw = snapToDivisor(gridState.fw, usableW);
        gridState.fh = snapToDivisor(gridState.fh, usableH);
        fwInput.value = gridState.fw;
        fhInput.value = gridState.fh;
      };

      snapCb.addEventListener('change', () => { redraw(); });

      const hint = document.createElement('div');
      hint.className = 'sprite-hint';
      hint.style.marginTop = '8px';
      hint.textContent = 'Drag crosshair to set frame size \u2022 Scroll to zoom \u2022 Right-click drag to pan';
      controls.appendChild(hint);
      wrap.appendChild(controls);
      body.appendChild(wrap);

      // Canvas sizing — scale to fit the modal, up or down
      const fitSize = 600;
      const scale = fitSize / Math.max(iw, ih);
      canvas.width = Math.ceil(iw * scale);
      canvas.height = Math.ceil(ih * scale);

      const redraw = () => {
        // Apply snap before computing frames (only affects fw/fh when enabled)
        applySnap();

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this._drawCheckerboard(ctx, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Compute frames
        const fw = gridState.fw || iw;
        const fh = gridState.fh || ih;
        pendingFrames = [];
        let id = 0;
        for (let y = gridState.oy; y + fh <= ih; y += fh + gridState.sy) {
          for (let x = gridState.ox; x + fw <= iw; x += fw + gridState.sx) {
            pendingFrames.push({ id, name: `frame_${id}`, x, y, w: fw, h: fh });
            id++;
          }
        }
        if (pendingFrames.length === 0) {
          pendingFrames.push({ id: 0, name: 'frame_0', x: 0, y: 0, w: iw, h: ih });
        }

        // Draw grid lines
        ctx.strokeStyle = 'rgba(74, 158, 255, 0.8)';
        ctx.lineWidth = 1;
        for (const f of pendingFrames) {
          ctx.strokeRect(f.x * scale + 0.5, f.y * scale + 0.5,
                         f.w * scale - 1, f.h * scale - 1);
        }

        // Crosshair at (fw, fh) — shows the frame cell boundary
        const cx = Math.min(fw, iw) * scale;
        const cy = Math.min(fh, ih) * scale;
        ctx.strokeStyle = 'rgba(255, 200, 50, 0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, canvas.height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(canvas.width, cy);
        ctx.stroke();
        ctx.setLineDash([]);

        infoLabel.textContent = `${pendingFrames.length} frame(s)  \u2014  ${fw}\u00d7${fh} px`;
      };

      // Crosshair dragging
      let dragging = false;
      canvas.style.cursor = 'crosshair';

      canvas.addEventListener('mousedown', (e) => {
        dragging = true;
        updateFromMouse(e);
      });
      canvas.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        updateFromMouse(e);
      });
      overlay.addEventListener('mouseup', () => { dragging = false; });

      const updateFromMouse = (e) => {
        const rect = canvas.getBoundingClientRect();
        const z = zoomView.getZoom();
        const mx = Math.max(1, Math.round((e.clientX - rect.left) / (scale * z)));
        const my = Math.max(1, Math.round((e.clientY - rect.top) / (scale * z)));
        gridState.fw = Math.min(mx, iw);
        gridState.fh = Math.min(my, ih);
        redraw();   // redraw calls applySnap internally
      };

      redraw();
    };

    /* ---------- Detect Mode ---------- */
    const buildDetectMode = () => {
      body.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'slicer-content';

      const canvasArea = document.createElement('div');
      canvasArea.className = 'slicer-canvas-area';
      const canvas = document.createElement('canvas');
      canvas.className = 'slicer-canvas';
      const zoomView = this._makeZoomable(canvas);
      canvasArea.appendChild(zoomView.container);
      wrap.appendChild(canvasArea);

      const controls = document.createElement('div');
      controls.className = 'slicer-controls';

      const alphaRow = document.createElement('div');
      alphaRow.className = 'sprite-field-row';
      const alphaLabel = document.createElement('label');
      alphaLabel.textContent = 'Alpha threshold';
      const alphaInput = document.createElement('input');
      alphaInput.type = 'number';
      alphaInput.min = '0';
      alphaInput.max = '255';
      alphaInput.value = '1';
      alphaRow.appendChild(alphaLabel);
      alphaRow.appendChild(alphaInput);
      controls.appendChild(alphaRow);

      const detectBtn = document.createElement('button');
      detectBtn.className = 'sprite-btn sprite-btn-primary';
      detectBtn.textContent = 'Detect Frames';
      detectBtn.style.marginTop = '6px';
      controls.appendChild(detectBtn);

      const hint = document.createElement('div');
      hint.className = 'sprite-hint';
      hint.style.marginTop = '8px';
      hint.textContent = 'Finds connected opaque regions \u2022 Scroll to zoom \u2022 Right-click drag to pan';
      controls.appendChild(hint);

      wrap.appendChild(controls);
      body.appendChild(wrap);

      // Canvas sizing — scale to fit the modal, up or down
      const fitSize = 600;
      const scale = fitSize / Math.max(iw, ih);
      canvas.width = Math.ceil(iw * scale);
      canvas.height = Math.ceil(ih * scale);

      const redraw = () => {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this._drawCheckerboard(ctx, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Draw detected frame boxes
        ctx.strokeStyle = 'rgba(50, 255, 130, 0.8)';
        ctx.lineWidth = 2;
        for (const f of pendingFrames) {
          ctx.strokeRect(f.x * scale + 0.5, f.y * scale + 0.5,
                         f.w * scale - 1, f.h * scale - 1);
        }
        infoLabel.textContent = `${pendingFrames.length} frame(s) detected`;
      };

      detectBtn.addEventListener('click', () => {
        const threshold = parseInt(alphaInput.value, 10) || 1;
        pendingFrames = this._detectFramesFromImage(img, threshold);
        redraw();
      });

      // Auto-detect on tab switch
      const threshold = parseInt(alphaInput.value, 10) || 1;
      pendingFrames = this._detectFramesFromImage(img, threshold);
      redraw();
    };

    // --- Tab switching ---
    gridTab.addEventListener('click', () => {
      if (currentMode === 'grid') return;
      currentMode = 'grid';
      gridTab.classList.add('active');
      detectTab.classList.remove('active');
      buildGridMode();
    });
    detectTab.addEventListener('click', () => {
      if (currentMode === 'detect') return;
      currentMode = 'detect';
      detectTab.classList.add('active');
      gridTab.classList.remove('active');
      buildDetectMode();
    });

    // --- Cancel / Apply ---
    cancelBtn.addEventListener('click', () => overlay.remove());
    applyBtn.addEventListener('click', () => {
      if (pendingFrames.length === 0) {
        alert('No frames to apply. Use Grid or Detect mode first.');
        return;
      }
      // Persist grid settings when in grid mode
      if (currentMode === 'grid') {
        this.spriteData.frameWidth = gridState.fw;
        this.spriteData.frameHeight = gridState.fh;
        this.spriteData.gridOffsetX = gridState.ox;
        this.spriteData.gridOffsetY = gridState.oy;
        this.spriteData.gridSpacingX = gridState.sx;
        this.spriteData.gridSpacingY = gridState.sy;
      }
      this.spriteData.frames = pendingFrames;
      this.spriteData.ensureDefaultAnimation();
      // Clamp animation frame references
      const validIds = new Set(this.spriteData.frames.map(f => f.id));
      for (const anim of this.spriteData.animations) {
        anim.frameIds = anim.frameIds.filter(id => validIds.has(id));
        if (anim.frameIds.length === 0) {
          anim.frameIds = this.spriteData.frames.map(f => f.id);
        }
      }
      this._syncUIFromData();
      this._restartAnimation();
      this.markDirty();
      overlay.remove();
    });

    // Show with grid mode by default
    document.body.appendChild(overlay);
    buildGridMode();
  }

  /**
   * Detect frames by flood-filling connected regions of non-transparent pixels.
   * Returns an array of { id, name, x, y, w, h }.
   */
  _detectFramesFromImage(img, alphaThreshold = 1) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;

    // Read pixels from an offscreen canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // Build alpha mask
    const opaque = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      opaque[i] = data[i * 4 + 3] >= alphaThreshold ? 1 : 0;
    }

    // Flood fill to find connected components
    const visited = new Uint8Array(w * h);
    const frames = [];
    let frameId = 0;

    const floodFill = (startX, startY) => {
      let minX = startX, maxX = startX, minY = startY, maxY = startY;
      const stack = [[startX, startY]];
      visited[startY * w + startX] = 1;

      while (stack.length > 0) {
        const [cx, cy] = stack.pop();
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        // 4-connected neighbors
        const neighbors = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const ni = ny * w + nx;
            if (!visited[ni] && opaque[ni]) {
              visited[ni] = 1;
              stack.push([nx, ny]);
            }
          }
        }
      }

      return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    };

    // Scan top-to-bottom, left-to-right
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (opaque[i] && !visited[i]) {
          const rect = floodFill(x, y);
          frames.push({ id: frameId, name: `frame_${frameId}`, ...rect });
          frameId++;
        }
      }
    }

    // Sort by Y then X (reading order) and re-index
    frames.sort((a, b) => a.y - b.y || a.x - b.x);
    frames.forEach((f, i) => { f.id = i; f.name = `frame_${i}`; });

    return frames;
  }

  /**
   * Get (or lazily create) a repeating CanvasPattern for the checker grid.
   */
  _getCheckerPattern(ctx, tileSize = 8) {
    const key = `_checkerPat_${tileSize}`;
    if (this[key]) return this[key];
    const s = tileSize;
    const off = document.createElement('canvas');
    off.width = s * 2;
    off.height = s * 2;
    const oc = off.getContext('2d');
    oc.fillStyle = '#2a2a2a';
    oc.fillRect(0, 0, s * 2, s * 2);
    oc.fillStyle = '#3a3a3a';
    oc.fillRect(s, 0, s, s);
    oc.fillRect(0, s, s, s);
    this[key] = ctx.createPattern(off, 'repeat');
    return this[key];
  }

  _drawCheckerboard(ctx, w, h, scrollX = 0, scrollY = 0, tileSize = 8) {
    const pat = this._getCheckerPattern(ctx, tileSize);
    ctx.save();
    ctx.translate(-scrollX, -scrollY);
    ctx.fillStyle = pat;
    ctx.fillRect(scrollX, scrollY, w, h);
    ctx.restore();
  }

  /* ================================================================== */
  /*  Animation preview — timer loop                                     */
  /* ================================================================== */
  _startAnimation() {
    this._stopAnimation();
    this._animPlaying = true;
    this._animFrame = 0;
    this._checkerOffsetX = 0;
    this._checkerOffsetY = 0;
    if (this._playBtn) this._playBtn.textContent = '⏸';
    this._lastAnimTime = performance.now();
    this._animLoop();
  }

  _stopAnimation() {
    if (this._animTimer != null) {
      cancelAnimationFrame(this._animTimer);
      this._animTimer = null;
    }
  }

  _restartAnimation() {
    this._animFrame = 0;
    this._checkerOffsetX = 0;
    this._checkerOffsetY = 0;
    if (this._animPlaying) {
      this._stopAnimation();
      this._lastAnimTime = performance.now();
      this._animLoop();
    } else {
      this._drawAnimFrame();
    }
  }

  _togglePlayPause() {
    this._animPlaying = !this._animPlaying;
    if (this._playBtn) this._playBtn.textContent = this._animPlaying ? '⏸' : '▶';
    if (this._animPlaying) {
      this._lastAnimTime = performance.now();
      this._animLoop();
    } else {
      this._stopAnimation();
    }
  }

  _stopAndReset() {
    this._animPlaying = false;
    this._animFrame = 0;
    this._checkerOffsetX = 0;
    this._checkerOffsetY = 0;
    this._stopAnimation();
    if (this._playBtn) this._playBtn.textContent = '▶';
    this._drawAnimFrame();
  }

  _stepFrame(dir) {
    const anim = this.spriteData.animations[this._selectedAnimIndex];
    if (!anim || anim.frameIds.length === 0) return;
    this._animPlaying = false;
    this._stopAnimation();
    if (this._playBtn) this._playBtn.textContent = '▶';

    // Accumulate per-frame motion for checkerboard scrolling during stepping
    const overrides = anim.frameOverrides || {};
    const curOv = overrides[this._animFrame] || {};
    const frameDx = (curOv.dx !== undefined) ? curOv.dx : (anim.dx || 0);
    const frameDy = (curOv.dy !== undefined) ? curOv.dy : (anim.dy || 0);
    this._checkerOffsetX = (this._checkerOffsetX || 0) + frameDx * dir;
    this._checkerOffsetY = (this._checkerOffsetY || 0) + frameDy * dir;

    this._animFrame = (this._animFrame + dir + anim.frameIds.length) % anim.frameIds.length;
    this._drawAnimFrame();
  }

  _animLoop() {
    const anim = this.spriteData.animations[this._selectedAnimIndex];
    if (!anim || anim.frameIds.length === 0) {
      this._drawAnimFrame();
      return;
    }

    const now = performance.now();
    // Per-frame duration: check frameOverrides first, then animation default
    const overrides = anim.frameOverrides || {};
    const ov = overrides[this._animFrame];
    const interval = (ov && ov.duration > 0) ? ov.duration : (anim.frameDuration || 100);

    if (now - this._lastAnimTime >= interval) {
      this._lastAnimTime = now;

      // Accumulate per-frame motion for checkerboard scrolling
      const curOv = overrides[this._animFrame] || {};
      const frameDx = (curOv.dx !== undefined) ? curOv.dx : (anim.dx || 0);
      const frameDy = (curOv.dy !== undefined) ? curOv.dy : (anim.dy || 0);
      this._checkerOffsetX = (this._checkerOffsetX || 0) + frameDx;
      this._checkerOffsetY = (this._checkerOffsetY || 0) + frameDy;

      this._animFrame++;
      if (this._animFrame >= anim.frameIds.length) {
        if (anim.loop) {
          this._animFrame = 0;
        } else {
          this._animFrame = anim.frameIds.length - 1;
          this._animPlaying = false;
          if (this._playBtn) this._playBtn.textContent = '▶';
          this._drawAnimFrame();
          return;
        }
      }
    }

    this._drawAnimFrame();
    if (this._animPlaying) {
      this._animTimer = requestAnimationFrame(() => this._animLoop());
    }
  }

  _drawAnimFrame() {
    if (!this._animCanvas) return;
    const canvas = this._animCanvas;
    const ctx = canvas.getContext('2d');

    const anim = this.spriteData.animations[this._selectedAnimIndex];
    const hasImage = this._sourceImage || this._loadedFramesets.size > 0;
    if (!anim || anim.frameIds.length === 0 || !hasImage) {
      canvas.width = 128;
      canvas.height = 128;
      ctx.clearRect(0, 0, 128, 128);
      this._drawCheckerboard(ctx, 128, 128);
      ctx.fillStyle = '#888';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No animation', 64, 68);
      if (this._animFrameLabel) this._animFrameLabel.textContent = '0 / 0';
      return;
    }

    // Max frame dimensions across this animation
    let maxW = 0, maxH = 0;
    for (const fid of anim.frameIds) {
      const f = this._findFrame(fid);
      if (f) { maxW = Math.max(maxW, f.w); maxH = Math.max(maxH, f.h); }
    }
    if (maxW === 0 || maxH === 0) return;

    // Size the canvas to fill its container (CSS box)
    const wrap = this._animCanvasWrap;
    const cw = wrap ? wrap.clientWidth - 8 : 256;   // minus padding
    const ch = wrap ? wrap.clientHeight - 8 : 256;
    if (cw <= 0 || ch <= 0) return;

    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    // Compute pixel scale so the sprite (2× for breathing room) fits the canvas
    const fitScale = Math.min(cw / (maxW * 2), ch / (maxH * 2));
    const pixScale = Math.max(1, Math.floor(fitScale));

    const frameId = anim.frameIds[this._animFrame] ?? anim.frameIds[0];
    const frame = this._findFrame(frameId);
    if (!frame) return;

    ctx.clearRect(0, 0, cw, ch);

    // Scrolling checkerboard
    const checkerScrollX = (this._checkerOffsetX || 0) * pixScale;
    const checkerScrollY = (this._checkerOffsetY || 0) * pixScale;
    this._drawCheckerboard(ctx, cw, ch, checkerScrollX, checkerScrollY, 32);

    ctx.imageSmoothingEnabled = false;

    // Per-frame offset (for uneven frame sizes)
    const overrides = anim.frameOverrides || {};
    const frameOv = overrides[this._animFrame] || {};
    const offX = (frameOv.offsetX || 0) * pixScale;
    const offY = (frameOv.offsetY || 0) * pixScale;

    // Use the frame's own image (frameset mode) or the legacy source image
    const img = frame.image || this._sourceImage;
    if (!img) return;

    // Center the frame within the canvas, then apply per-frame offset
    const fw = frame.w * pixScale;
    const fh = frame.h * pixScale;
    const dx = Math.floor((cw - fw) / 2) + offX;
    const dy = Math.floor((ch - fh) / 2) + offY;
    ctx.drawImage(
      img,
      frame.x, frame.y, frame.w, frame.h,
      dx, dy, fw, fh
    );

    if (this._animFrameLabel) {
      this._animFrameLabel.textContent = `${this._animFrame + 1} / ${anim.frameIds.length}`;
    }
  }
}

// Self-register
window.SpriteEditor = SpriteEditor;
window.SpriteEditorData = SpriteEditorData;
SpriteEditor.registerComponent();
