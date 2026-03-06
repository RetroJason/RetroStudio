// frameset-editor.js
// Editor for creating and editing frameset files — a source image sliced into named frames.

console.log('[FramesetEditor] Class definition loading');

/**
 * FramesetEditorData — Serialisable data model for .frameset files.
 * Wraps a single source image and a set of extracted frame regions.
 */
class FramesetEditorData {
  constructor(options = {}) {
    this.name = options.name || 'untitled_frameset';

    /** Path to the raw source image (PNG, GIF, etc.) inside the project. */
    this.imagePath = options.imagePath || '';

    /** Pixel dimensions of the source image (set when loaded). */
    this.imageWidth = options.imageWidth || 0;
    this.imageHeight = options.imageHeight || 0;

    // --- Frame grid settings ---
    this.frameWidth = options.frameWidth || 0;   // 0 = full-texture (single frame)
    this.frameHeight = options.frameHeight || 0;
    this.gridOffsetX = options.gridOffsetX || 0;
    this.gridOffsetY = options.gridOffsetY || 0;
    this.gridSpacingX = options.gridSpacingX || 0;
    this.gridSpacingY = options.gridSpacingY || 0;

    /**
     * Extracted frames — array of { id, name, x, y, w, h }
     * By default one entry covering the whole image.
     */
    this.frames = options.frames || [];
  }

  toJSON() {
    return {
      name: this.name,
      imagePath: this.imagePath,
      imageWidth: this.imageWidth,
      imageHeight: this.imageHeight,
      frameWidth: this.frameWidth,
      frameHeight: this.frameHeight,
      gridOffsetX: this.gridOffsetX,
      gridOffsetY: this.gridOffsetY,
      gridSpacingX: this.gridSpacingX,
      gridSpacingY: this.gridSpacingY,
      frames: this.frames,
    };
  }

  static fromJSON(data) {
    return new FramesetEditorData(data);
  }

  /** Rebuild the frame list from current grid settings.
   *  If frameWidth/Height are 0 the whole image is one frame. */
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
}

/* ====================================================================
 *  FramesetEditor — extends EditorBase
 * ==================================================================== */
class FramesetEditor extends EditorBase {
  constructor(fileObject = null, readOnly = false) {
    console.log('[FramesetEditor] Constructor called');

    const tempData = new FramesetEditorData();
    FramesetEditor._pendingData = tempData;

    super(fileObject, readOnly);

    this.framesetData = FramesetEditor._pendingData || new FramesetEditorData();
    FramesetEditor._pendingData = null;
    this._sourceImage = null;
    this._selectedFrameIds = new Set();
    this._pendingImagePath = null;

    this.initializeContent();
  }

  /* ------------------------------------------------------------------ */
  /*  EditorBase overrides                                               */
  /* ------------------------------------------------------------------ */
  createBody(bodyContainer) {
    if (!this.framesetData) {
      this.framesetData = FramesetEditor._pendingData || new FramesetEditorData();
    }

    bodyContainer.classList.add('frameset-editor-container');
    bodyContainer.innerHTML = '';

    const layout = document.createElement('div');
    layout.className = 'frameset-editor-layout';

    // LEFT — sidebar
    const sidebar = document.createElement('div');
    sidebar.className = 'frameset-sidebar';
    this._buildSidebar(sidebar);
    layout.appendChild(sidebar);

    // RIGHT — frame gallery
    const main = document.createElement('div');
    main.className = 'frameset-main';
    this._buildMainArea(main);
    layout.appendChild(main);

    bodyContainer.appendChild(layout);
  }

  getContent() {
    return this.framesetData ? JSON.stringify(this.framesetData.toJSON(), null, 2) : '';
  }

  setContent(content) {
    try {
      const data = JSON.parse(content);
      this.framesetData = FramesetEditorData.fromJSON(data);
      this._syncUIFromData();
      if (this.framesetData.imagePath) {
        this._loadSourceImage(this.framesetData.imagePath);
      }
    } catch (err) {
      console.error('[FramesetEditor] Failed to parse content:', err);
    }
  }

  initializeContent() {
    console.log('[FramesetEditor] initializeContent()');
    if (this.file && this.file.fileContent) {
      let content = this.file.fileContent;
      if (typeof content === 'string') {
        try {
          if (content.charAt(0) !== '{') content = atob(content);
        } catch (_) { /* already plaintext */ }
      }
      this.setContent(content);
    } else if (this._pendingImagePath) {
      this.framesetData.imagePath = this._pendingImagePath;
      this._pendingImagePath = null;
      this._loadSourceImage(this.framesetData.imagePath);
      this.markDirty();
    }
  }

  destroy() {
    super.destroy();
  }

  /* ------------------------------------------------------------------ */
  /*  Static registration                                                */
  /* ------------------------------------------------------------------ */
  static getFileExtensions() { return ['.frameset']; }
  static getFileExtension() { return '.frameset'; }
  static getDisplayName() { return 'Frameset Editor'; }
  static getIcon() { return '🖼️'; }
  static getPriority() { return 10; }
  static getCapabilities() { return ['frameset-editing']; }
  static canCreate = true;
  static getDefaultFolder() { return 'Sprites'; }

  static createNew() {
    return JSON.stringify(new FramesetEditorData().toJSON(), null, 2);
  }

  /** Create a frameset pre-populated with a given source image path. */
  static createFromImage(imagePath) {
    const data = new FramesetEditorData();
    data.imagePath = imagePath;
    const baseName = imagePath.split('/').pop().replace(/\.[^.]+$/, '');
    data.name = baseName;
    return JSON.stringify(data.toJSON(), null, 2);
  }

  /* ================================================================== */
  /*  SIDEBAR — image preview, info                                      */
  /* ================================================================== */
  _buildSidebar(container) {
    // --- Source Image Section ---
    const imgSection = document.createElement('div');
    imgSection.className = 'frameset-section';

    const headerRow = document.createElement('div');
    headerRow.className = 'frameset-section-header';
    const h = document.createElement('h3');
    h.textContent = 'Source Image';
    headerRow.appendChild(h);
    const browseBtn = document.createElement('button');
    browseBtn.className = 'sprite-btn sprite-btn-primary sprite-btn-sm';
    browseBtn.textContent = 'Browse\u2026';
    browseBtn.addEventListener('click', () => this._showImagePicker());
    headerRow.appendChild(browseBtn);
    imgSection.appendChild(headerRow);
    container.appendChild(imgSection);

    // Canvas showing scaled-down source image
    this._imagePreviewCanvas = document.createElement('canvas');
    this._imagePreviewCanvas.className = 'frameset-image-preview';
    this._imagePreviewCanvas.width = 200;
    this._imagePreviewCanvas.height = 200;
    imgSection.appendChild(this._imagePreviewCanvas);

    // Filename label
    this._texPathLabel = document.createElement('div');
    this._texPathLabel.className = 'frameset-tex-path';
    this._texPathLabel.textContent = '(none)';
    imgSection.appendChild(this._texPathLabel);

    // Slice Frames button
    const actionRow = document.createElement('div');
    actionRow.className = 'sprite-row';
    this._sliceBtn = document.createElement('button');
    this._sliceBtn.className = 'sprite-btn sprite-btn-primary';
    this._sliceBtn.textContent = 'Slice Frames\u2026';
    this._sliceBtn.disabled = true;
    this._sliceBtn.addEventListener('click', () => this._showSlicerModal());
    actionRow.appendChild(this._sliceBtn);
    imgSection.appendChild(actionRow);

    this._frameCountLabel = document.createElement('div');
    this._frameCountLabel.className = 'frameset-frame-count';
    this._frameCountLabel.textContent = '0 frames';
    imgSection.appendChild(this._frameCountLabel);

    // --- Name Section ---
    const nameSection = document.createElement('div');
    nameSection.className = 'frameset-section';
    const nameH = document.createElement('h3');
    nameH.textContent = 'Properties';
    nameSection.appendChild(nameH);

    const nameRow = document.createElement('div');
    nameRow.className = 'sprite-field-row';
    const nameLbl = document.createElement('label');
    nameLbl.textContent = 'Name';
    this._nameInput = document.createElement('input');
    this._nameInput.type = 'text';
    this._nameInput.className = 'sprite-props-input';
    this._nameInput.value = this.framesetData.name;
    this._nameInput.addEventListener('change', () => {
      this.framesetData.name = this._nameInput.value.trim() || this.framesetData.name;
      this.markDirty();
    });
    nameRow.appendChild(nameLbl);
    nameRow.appendChild(this._nameInput);
    nameSection.appendChild(nameRow);

    // Image dimensions (read-only)
    this._dimLabel = document.createElement('div');
    this._dimLabel.className = 'frameset-dim-label';
    this._dimLabel.textContent = '';
    nameSection.appendChild(this._dimLabel);

    container.appendChild(nameSection);
  }

  /* ================================================================== */
  /*  MAIN AREA — frame gallery                                          */
  /* ================================================================== */
  _buildMainArea(container) {
    const gallerySection = document.createElement('div');
    gallerySection.className = 'frameset-gallery-panel';
    const galleryHeader = document.createElement('h4');
    galleryHeader.textContent = 'Frames';
    gallerySection.appendChild(galleryHeader);

    this._frameGallery = document.createElement('div');
    this._frameGallery.className = 'sprite-frame-gallery';
    gallerySection.appendChild(this._frameGallery);
    container.appendChild(gallerySection);
  }

  /* ================================================================== */
  /*  Source image loading                                               */
  /* ================================================================== */
  async _loadSourceImage(imagePath) {
    console.log('[FramesetEditor] Loading source image:', imagePath);
    if (this._texPathLabel) {
      this._texPathLabel.textContent = imagePath ? imagePath.split('/').pop() : '(none)';
    }
    if (!imagePath) return;

    try {
      const imgSrc = await this._loadImageSrc(imagePath);
      if (!imgSrc) {
        console.warn('[FramesetEditor] Could not resolve image for', imagePath);
        return;
      }

      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imgSrc;
      });

      this._sourceImage = img;
      this.framesetData.imageWidth = img.naturalWidth;
      this.framesetData.imageHeight = img.naturalHeight;

      if (this._sliceBtn) this._sliceBtn.disabled = false;

      // Default frame = full image when no frames exist
      if (this.framesetData.frames.length === 0) {
        this.framesetData.rebuildFramesFromGrid();
      }

      this._syncUIFromData();
      this._renderFrameGallery();
    } catch (err) {
      console.error('[FramesetEditor] Error loading source image:', err);
    }
  }

  /** Resolve a project-relative image path to a data-URL or blob URL. */
  async _loadImageSrc(imagePath) {
    const fm = window.fileManager || window.serviceContainer?.get('fileManager');
    if (!fm) return null;

    let paths = [imagePath];
    if (!imagePath.startsWith('Sources/')) paths.push('Sources/' + imagePath);
    if (!imagePath.startsWith('Resources/')) paths.push('Resources/' + imagePath);
    const filename = imagePath.split('/').pop();
    paths.push('Sources/Images/' + filename);
    paths.push('Resources/Images/' + filename);

    for (const p of paths) {
      try {
        const file = await fm.loadFile(p);
        if (!file) continue;
        const content = file.fileContent;
        if (!content) continue;
        if (typeof content === 'string' && (content.startsWith('data:') || content.startsWith('blob:'))) {
          return content;
        }
        if (typeof content === 'string') {
          const ext = p.split('.').pop().toLowerCase();
          const mime = { png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp' }[ext] || 'image/png';
          return `data:${mime};base64,${content}`;
        }
        if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
          const blob = new Blob([content], { type: 'image/png' });
          return URL.createObjectURL(blob);
        }
      } catch (_) { /* try next */ }
    }
    return null;
  }

  /** Show a picker listing raw image files in the project. */
  async _showImagePicker() {
    const projectExplorer = window.serviceContainer?.get('projectExplorer');
    let candidates = [];

    if (projectExplorer && typeof projectExplorer.GetImageFiles === 'function') {
      const imageFiles = projectExplorer.GetImageFiles();
      candidates = imageFiles
        .filter(f => /\.(png|gif|jpg|jpeg|bmp)$/i.test(f.name))
        .map(f => ({ label: f.name, path: f.fullPath }));
    }

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
        this.framesetData.imagePath = item.path;
        this.framesetData.frames = [];
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
    if (!this.framesetData) return;

    if (this._frameCountLabel) {
      this._frameCountLabel.textContent = `${this.framesetData.frames.length} frame(s)`;
    }

    if (this._texPathLabel) {
      const path = this.framesetData.imagePath || '';
      this._texPathLabel.textContent = path ? path.split('/').pop() : '(none)';
    }

    if (this._nameInput) {
      this._nameInput.value = this.framesetData.name;
    }

    if (this._dimLabel) {
      if (this.framesetData.imageWidth && this.framesetData.imageHeight) {
        this._dimLabel.textContent = `${this.framesetData.imageWidth} \u00d7 ${this.framesetData.imageHeight} px`;
      } else {
        this._dimLabel.textContent = '';
      }
    }

    this._updateImagePreview();
    this._renderFrameGallery();
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
  /*  Frame Gallery                                                      */
  /* ================================================================== */
  _renderFrameGallery() {
    const el = this._frameGallery;
    if (!el) return;
    el.innerHTML = '';

    if (this.framesetData.frames.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'sprite-hint';
      hint.textContent = 'No frames yet \u2014 use Slice Frames to extract from the source image.';
      el.appendChild(hint);
      return;
    }

    for (const frame of this.framesetData.frames) {
      const cell = document.createElement('div');
      cell.className = 'sprite-gallery-cell';
      if (this._selectedFrameIds.has(frame.id)) cell.classList.add('selected');

      // Draggable — for future use (drag frames into sprite editors etc.)
      cell.draggable = true;
      cell.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-sprite-frame-id', String(frame.id));
        e.dataTransfer.effectAllowed = 'copy';
        cell.classList.add('dragging');
      });
      cell.addEventListener('dragend', () => cell.classList.remove('dragging'));

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

  /** Draw a single frame region onto a thumbnail canvas */
  _drawFrameToCanvas(canvas, frame) {
    if (!this._sourceImage) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / frame.w, canvas.height / frame.h);
    const dw = frame.w * scale;
    const dh = frame.h * scale;
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._sourceImage, frame.x, frame.y, frame.w, frame.h, dx, dy, dw, dh);
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

    const body = document.createElement('div');
    body.className = 'slicer-body';
    modal.appendChild(body);

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

    let currentMode = 'grid';
    let pendingFrames = [];

    const gridState = {
      fw: this.framesetData.frameWidth || iw,
      fh: this.framesetData.frameHeight || ih,
      ox: this.framesetData.gridOffsetX || 0,
      oy: this.framesetData.gridOffsetY || 0,
      sx: this.framesetData.gridSpacingX || 0,
      sy: this.framesetData.gridSpacingY || 0,
    };

    /* ---------- Grid Mode ---------- */
    const buildGridMode = () => {
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

      const snapToDivisor = (value, total) => {
        if (total <= 0 || value <= 0) return value;
        let best = total;
        let bestDist = Math.abs(value - total);
        for (let d = 1; d * d <= total; d++) {
          if (total % d === 0) {
            for (const candidate of [d, total / d]) {
              const dist = Math.abs(value - candidate);
              if (dist < bestDist) { bestDist = dist; best = candidate; }
            }
          }
        }
        return best;
      };

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

      const fitSize = 600;
      const scale = fitSize / Math.max(iw, ih);
      canvas.width = Math.ceil(iw * scale);
      canvas.height = Math.ceil(ih * scale);

      const redraw = () => {
        applySnap();
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this._drawCheckerboard(ctx, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

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

        ctx.strokeStyle = 'rgba(74, 158, 255, 0.8)';
        ctx.lineWidth = 1;
        for (const f of pendingFrames) {
          ctx.strokeRect(f.x * scale + 0.5, f.y * scale + 0.5,
                         f.w * scale - 1, f.h * scale - 1);
        }

        const cx = Math.min(fw, iw) * scale;
        const cy = Math.min(fh, ih) * scale;
        ctx.strokeStyle = 'rgba(255, 200, 50, 0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, canvas.height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(canvas.width, cy); ctx.stroke();
        ctx.setLineDash([]);

        infoLabel.textContent = `${pendingFrames.length} frame(s)  \u2014  ${fw}\u00d7${fh} px`;
      };

      let dragging = false;
      canvas.style.cursor = 'crosshair';

      canvas.addEventListener('mousedown', (e) => { dragging = true; updateFromMouse(e); });
      canvas.addEventListener('mousemove', (e) => { if (dragging) updateFromMouse(e); });
      overlay.addEventListener('mouseup', () => { dragging = false; });

      const updateFromMouse = (e) => {
        const rect = canvas.getBoundingClientRect();
        const z = zoomView.getZoom();
        const mx = Math.max(1, Math.round((e.clientX - rect.left) / (scale * z)));
        const my = Math.max(1, Math.round((e.clientY - rect.top) / (scale * z)));
        gridState.fw = Math.min(mx, iw);
        gridState.fh = Math.min(my, ih);
        redraw();
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
      if (currentMode === 'grid') {
        this.framesetData.frameWidth = gridState.fw;
        this.framesetData.frameHeight = gridState.fh;
        this.framesetData.gridOffsetX = gridState.ox;
        this.framesetData.gridOffsetY = gridState.oy;
        this.framesetData.gridSpacingX = gridState.sx;
        this.framesetData.gridSpacingY = gridState.sy;
      }
      this.framesetData.frames = pendingFrames;
      this._syncUIFromData();
      this.markDirty();
      overlay.remove();
    });

    document.body.appendChild(overlay);
    buildGridMode();
  }

  /**
   * Detect frames by flood-filling connected regions of non-transparent pixels.
   */
  _detectFramesFromImage(img, alphaThreshold = 1) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    const opaque = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      opaque[i] = data[i * 4 + 3] >= alphaThreshold ? 1 : 0;
    }

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

    frames.sort((a, b) => a.y - b.y || a.x - b.x);
    frames.forEach((f, i) => { f.id = i; f.name = `frame_${i}`; });

    return frames;
  }

  /* ================================================================== */
  /*  Zoomable canvas helper                                             */
  /* ================================================================== */
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

    outer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = outer.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const oldZoom = zoom;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoom = Math.min(maxZoom, Math.max(minZoom, zoom * delta));
      panX = mx - (mx - panX) * (zoom / oldZoom);
      panY = my - (my - panY) * (zoom / oldZoom);
      applyTransform();
    }, { passive: false });

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

    let panning = false, panStartX = 0, panStartY = 0;

    outer.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.button === 2) {
        e.preventDefault();
        panning = true;
        panStartX = e.clientX - panX;
        panStartY = e.clientY - panY;
        outer.style.cursor = 'grabbing';
      }
    });
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
  /*  Drawing helpers                                                    */
  /* ================================================================== */
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
}

// Self-register
window.FramesetEditor = FramesetEditor;
window.FramesetEditorData = FramesetEditorData;
FramesetEditor.registerComponent();
