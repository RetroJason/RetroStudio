// tilemap-editor.js
// First-class tilemap editor — extends EditorBase, renders entirely in the DOM (no iframes).
//
// File format: .tilemap (Studio JSON payload)
//   { schema: 'retrostudio-map-v1', app: 'RetroStudio', mapData: { map, layers, tilesets } }
//
// TMX import: scripts/tilemap-importer.js (lazy-loaded on demand).

/* ═══════════════════════════════════════════════════════════════════
   Data model
   ═══════════════════════════════════════════════════════════════════ */

class TilemapData {
  constructor(options = {}) {
    this.map = {
      width:       options.map?.width       || 32,
      height:      options.map?.height      || 24,
      tileWidth:   options.map?.tileWidth   || 16,
      tileHeight:  options.map?.tileHeight  || 16,
      orientation: options.map?.orientation || 'orthogonal',
    };
    // Only auto-create default layer if explicitly requested or if loading from options
    this.layers   = options.layers   || (options.autoCreateDefaultLayer ? [TilemapData.defaultLayer(this.map)] : []);
    this.tilesets = options.tilesets || [];
  }

  static defaultLayer(map) {
    return {
      name:    'Ground',
      width:   map.width,
      height:  map.height,
      visible: true,
      opacity: 1,
      data:    new Array(map.width * map.height).fill(0),
    };
  }

  toJSON() {
    return {
      schema:  'retrostudio-map-v1',
      app:     'RetroStudio',
      mapData: {
        map:      { ...this.map },
        layers:   this.layers.map(l => ({ ...l, data: Array.from(l.data || []) })),
        tilesets: this.tilesets.map(ts => ({ ...ts })),
      },
    };
  }

  static fromJSON(json) {
    const md = json?.mapData ?? json;
    return new TilemapData({
      map:      md?.map,
      layers:   md?.layers?.map(l => ({ ...l, data: Array.from(l.data || []) })) || [],
      tilesets: md?.tilesets || [],
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Editor
   ═══════════════════════════════════════════════════════════════════ */

class TilemapEditor extends EditorBase {
  constructor(fileObject = null, readOnly = false) {
    // NOTE: super() invokes ViewerBase → createElement() → createBody() BEFORE
    // this constructor body runs. createBody() seeds all data/UI state (mapData,
    // _loadedTilesets, tool state, canvas + panel refs). Therefore this body must
    // NOT re-initialize or null-out anything createBody() already set, or it will
    // wipe the freshly-built UI. Only set state createBody() does not manage.
    super(fileObject, readOnly);

    // Mouse state (not managed by createBody)
    this._painting      = false;
    this._lastPaintCell = null;

    // WebGL renderer state
    this._glRenderer    = null;
    this._glReady       = false;

    // Parse file content into mapData and refresh the UI built by createBody().
    this._initContent();
  }

  /* ─── Content init ───────────────────────────────────────────────── */

  _initContent() {
    let raw = this.file?.content ?? this.file?.fileContent;

    if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
      raw = new TextDecoder().decode(raw instanceof ArrayBuffer ? raw : raw.buffer);
    }

    if (typeof raw === 'string' && raw.trim().length) {
      if (raw.trimStart().startsWith('<')) {
        // TMX source — createBody() has already run, so import it here and refresh.
        this._importTmx(raw).then(() => { if (this._canvas) this._fullRefresh(); });
        return;
      } else {
        try {
          this.mapData = TilemapData.fromJSON(JSON.parse(raw));
        } catch (e) {
          console.warn('[TilemapEditor] Could not parse file content:', e);
        }
      }
    }

    if (!this.mapData) {
      this.mapData       = new TilemapData();
      this.isNewResource = true;
    }

    // If createBody already ran (super called it), refresh the UI now.
    if (this._canvas) this._fullRefresh();
  }

  /* ─── Content serialization (required by EditorBase) ──────────────── */

  getContent() {
    // EditorBase calls this when saving
    if (!this.mapData) return '';
    return JSON.stringify(this.mapData.toJSON(), null, 2);
  }

  setContent(content) {
    // EditorBase calls this when loading
    try {
      if (typeof content === 'string' && content.trim().length) {
        if (content.trimStart().startsWith('<')) {
          // TMX format
          this._pendingTmxSource = content;
        } else {
          // JSON format
          this.mapData = TilemapData.fromJSON(JSON.parse(content));
        }
      }
    } catch (e) {
      console.warn('[TilemapEditor] Could not parse content:', e);
    }
    if (this._canvas) this._fullRefresh();
  }

  /* ─── createBody ─────────────────────────────────────────────────── */

  createBody(bodyContainer) {
    // super() triggers createBody() before the constructor body runs, so all
    // instance properties used below must be seeded here if not yet set.
    if (!this.mapData)         { this.mapData = new TilemapData(); this.isNewResource = true; }
    if (!this._loadedTilesets) { this._loadedTilesets = new Map(); }
    if (this.currentLayer  === undefined) this.currentLayer  = 0;
    if (this.selectedGid   === undefined) this.selectedGid   = 1;
    if (this.activeTool    === undefined) this.activeTool    = 'paint';
    if (this.zoom          === undefined) this.zoom          = 1;
    if (this.showGrid      === undefined) this.showGrid      = true;
    if (!this.undoStack)  this.undoStack  = [];
    if (!this.redoStack)  this.redoStack  = [];
    if (this._progressBarEl === undefined) this._progressBarEl = null;

    bodyContainer.classList.add('tilemap-editor-container');

    // ── Toolbar ──────────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.className = 'tilemap-toolbar';
    toolbar.innerHTML = `
      <button class="te-btn" data-action="new-map"   title="New map">🗺 New</button>
      <button class="te-btn" data-action="map-props" title="Map size &amp; settings">⚙ Props</button>
      <span class="te-sep"></span>
      <button class="te-btn te-tool" data-tool="paint" title="Paint  [P]" data-active>🖊 Paint</button>
      <button class="te-btn te-tool" data-tool="erase" title="Erase  [E]">◻ Erase</button>
      <button class="te-btn te-tool" data-tool="fill"  title="Fill   [F]">🪣 Fill</button>
      <span class="te-sep"></span>
      <button class="te-btn" data-action="undo" title="Undo [Ctrl+Z]">↩ Undo</button>
      <button class="te-btn" data-action="redo" title="Redo [Ctrl+Y]">↪ Redo</button>
      <span class="te-sep"></span>
      <label class="te-check"><input type="checkbox" id="teShowGrid" checked> Grid</label>
      <button class="te-btn" data-action="zoom-in"  title="Zoom in">+</button>
      <button class="te-btn" data-action="zoom-out" title="Zoom out">−</button>
      <button class="te-btn" data-action="fit-view" title="Fit to view">⤢</button>
    `;
    bodyContainer.appendChild(toolbar);

    // ── Main: left panel | canvas wrap ───────────────────────────────
    const main = document.createElement('div');
    main.className = 'tilemap-main';

    // LEFT
    const left = document.createElement('div');
    left.className = 'tilemap-left-panel';

    this._layerTabsEl = document.createElement('div');
    this._layerTabsEl.className = 'tilemap-layer-tabs';

    this._tilesetPanelEl = document.createElement('div');
    this._tilesetPanelEl.className = 'tilemap-tileset-panel';

    const addTilesetBtn = document.createElement('button');
    addTilesetBtn.className = 'te-btn te-add-tileset-btn';
    addTilesetBtn.textContent = '+ Tileset from Project';
    addTilesetBtn.title = 'Load a tileset image from the project';
    addTilesetBtn.addEventListener('click', () => this._promptAddTileset());

    const importLayersBtn = document.createElement('button');
    importLayersBtn.className = 'te-btn te-add-tileset-btn';
    importLayersBtn.textContent = '📥 Import Layers';
    importLayersBtn.title = 'Import layers from TMX or PNG';
    importLayersBtn.addEventListener('click', () => this._promptImportLevels());

    this._tilePaletteEl = document.createElement('div');
    this._tilePaletteEl.className = 'tilemap-tile-palette';

    this._tilesetPanelEl.appendChild(addTilesetBtn);
    this._tilesetPanelEl.appendChild(importLayersBtn);
    this._tilesetPanelEl.appendChild(this._tilePaletteEl);

    left.appendChild(this._layerTabsEl);
    left.appendChild(this._tilesetPanelEl);

    // CANVAS
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'tilemap-canvas-wrap';

    this._canvas = document.createElement('canvas');
    this._canvas.className = 'tilemap-canvas';
    this._ctx = this._canvas.getContext('2d');
    canvasWrap.appendChild(this._canvas);

    // STATUS
    this._statusEl = document.createElement('div');
    this._statusEl.className = 'tilemap-status';

    main.appendChild(left);
    main.appendChild(canvasWrap);
    bodyContainer.appendChild(main);
    bodyContainer.appendChild(this._statusEl);

    this._hasUI = true;

    this._bindToolbar(toolbar);
    this._bindCanvas(this._canvas, canvasWrap);
    this._bindKeyboard();

    if (this._pendingTmxSource) {
      this._importTmx(this._pendingTmxSource).then(() => this._fullRefresh());
    } else {
      this._fullRefresh();
    }
  }

  /* ─── Toolbar ────────────────────────────────────────────────────── */

  _bindToolbar(toolbar) {
    toolbar.addEventListener('click', (e) => {
      const tool = e.target.closest('[data-tool]');
      if (tool) { this._selectTool(tool.dataset.tool); return; }
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      switch (btn.dataset.action) {
        case 'new-map':   this._promptNewMap();    break;
        case 'map-props': this._showMapProps();    break;
        case 'undo':      this._undo();            break;
        case 'redo':      this._redo();            break;
        case 'zoom-in':   this._adjustZoom(1.25);  break;
        case 'zoom-out':  this._adjustZoom(0.8);   break;
        case 'fit-view':  this._fitView();         break;
      }
    });
    const gridToggle = toolbar.querySelector('#teShowGrid');
    if (gridToggle) {
      gridToggle.addEventListener('change', (e) => {
        this.showGrid = e.target.checked;
        this._renderMap();
      });
    }
  }

  _selectTool(tool) {
    this.activeTool = tool;
    const container = this._canvas?.closest('.tilemap-editor-container');
    container?.querySelectorAll('.te-tool').forEach(b => {
      b.toggleAttribute('data-active', b.dataset.tool === tool);
    });
    this._setStatus(`Tool: ${tool}`);
  }

  /* ─── Canvas interaction ─────────────────────────────────────────── */

  _bindCanvas(canvas, wrap) {
    canvas.addEventListener('mousedown', (e) => {
      // Right-click picks up tile from map (samples GID)
      if (e.button === 2) {
        e.preventDefault();
        const cell = this._cellFromEvent(e);
        if (!cell) return;
        const layer = this.mapData.layers[this.currentLayer];
        if (!layer) return;
        const idx = cell.y * this.mapData.map.width + cell.x;
        const gid = layer.data[idx];
        if (gid > 0) {
          this.selectedGid = gid;
          this._rebuildTilePalette();
          this._setStatus(`Picked tile: GID ${gid}`);
        }
        return;
      }

      // Left-click paints
      if (e.button !== 0) return;
      this._painting = true;
      this._applyTool(e);
    });
    canvas.addEventListener('mousemove', (e) => {
      if (!this._painting) return;
      this._applyTool(e);
    });
    const endPaint = () => { this._painting = false; this._lastPaintCell = null; };
    canvas.addEventListener('mouseup',    endPaint);
    canvas.addEventListener('mouseleave', endPaint);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());  // Prevent context menu
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._adjustZoom(e.deltaY < 0 ? 1.15 : 0.87);
    }, { passive: false });
  }

  _cellFromEvent(e) {
    const rect = this._canvas.getBoundingClientRect();
    const tw   = this.mapData.map.tileWidth  * this.zoom;
    const th   = this.mapData.map.tileHeight * this.zoom;
    const cx   = Math.floor((e.clientX - rect.left) / tw);
    const cy   = Math.floor((e.clientY - rect.top)  / th);
    if (cx < 0 || cy < 0 || cx >= this.mapData.map.width || cy >= this.mapData.map.height) return null;
    return { x: cx, y: cy };
  }

  _applyTool(e) {
    const cell = this._cellFromEvent(e);
    if (!cell) return;
    const key = `${cell.x},${cell.y}`;
    if (this.activeTool !== 'fill' && this._lastPaintCell === key) return;
    this._lastPaintCell = key;

    const layer = this.mapData.layers[this.currentLayer];
    if (!layer) return;
    const idx = cell.y * this.mapData.map.width + cell.x;

    if (this.activeTool === 'paint') {
      const gid = this.selectedGid || 0;
      if (layer.data[idx] === gid) return;
      this._pushUndo(); layer.data[idx] = gid;
    } else if (this.activeTool === 'erase') {
      if (layer.data[idx] === 0) return;
      this._pushUndo(); layer.data[idx] = 0;
    } else if (this.activeTool === 'fill') {
      this._pushUndo();
      this._floodFill(layer, cell.x, cell.y, layer.data[idx], this.selectedGid || 0);
    }

    this._renderMap();
    this.markDirty?.();
  }

  _floodFill(layer, startX, startY, targetGid, replaceGid) {
    if (targetGid === replaceGid) return;
    const { width, height } = this.mapData.map;
    const stack   = [[startX, startY]];
    const visited = new Set();
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const idx = y * width + x;
      if (visited.has(idx)) continue;
      visited.add(idx);
      if (layer.data[idx] !== targetGid) continue;
      layer.data[idx] = replaceGid;
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
  }

  /* ─── Rendering (WebGL) ─────────────────────────────────────────── */

  _fullRefresh() {
    this._rebuildLayerTabs();
    this._rebuildTilePalette();
    this._resizeCanvas();
    this._initWebGLRenderer();
    this._renderMap();
  }

  _resizeCanvas() {
    if (!this._canvas || !this.mapData) return;
    const { tileWidth, tileHeight } = this.mapData.map;
    
    // Find the maximum layer dimensions needed
    let maxWidth = 0, maxHeight = 0;
    for (const layer of this.mapData.layers) {
      maxWidth = Math.max(maxWidth, layer.width || 0);
      maxHeight = Math.max(maxHeight, layer.height || 0);
    }
    
    // Fallback to map metadata if no layers yet
    if (maxWidth === 0) maxWidth = this.mapData.map.width || 32;
    if (maxHeight === 0) maxHeight = this.mapData.map.height || 24;
    
    // Canvas holds the WebGL viewport
    const wrap = this._canvas?.parentElement;
    if (wrap) {
      this._canvas.width  = Math.min(wrap.clientWidth, 1280);
      this._canvas.height = Math.min(wrap.clientHeight, 960);
    } else {
      this._canvas.width  = Math.min(maxWidth * tileWidth * this.zoom, 1280);
      this._canvas.height = Math.min(maxHeight * tileHeight * this.zoom, 960);
    }

    if (this._glRenderer) {
      this._glRenderer.resize(this._canvas.width, this._canvas.height);
      // Set viewport to show map from (0,0) in world space
      this._glRenderer.setViewport(0, 0, this._canvas.width, this._canvas.height);
      this._glRenderer.setZoom(this.zoom);
    }
  }

  _initWebGLRenderer() {
    if (!this._canvas || !this.mapData) return;

    // Destroy old renderer if exists
    if (this._glRenderer) {
      this._glRenderer.destroy();
      this._glRenderer = null;
    }

    try {
      // Check if TilemapGLRenderer is available
      if (typeof TilemapGLRenderer === 'undefined') {
        console.warn('[TilemapEditor] TilemapGLRenderer not available, falling back to 2D');
        this._glReady = false;
        return;
      }

      this._glRenderer = new TilemapGLRenderer(this._canvas, this.mapData, {});
      
      // Load all available D2 tilesets
      for (const [firstGid, entry] of this._loadedTilesets) {
        if (entry.d2Bytes) {
          this._glRenderer.loadTileset(`tileset_${firstGid}`, entry.d2Bytes);
        }
      }

      this._glReady = true;
      console.log('[TilemapEditor] WebGL renderer initialized');
    } catch (e) {
      console.error('[TilemapEditor] WebGL init failed:', e);
      this._glReady = false;
      this._glRenderer = null;
    }
  }

  _renderMap() {
    if (!this.mapData) return;

    // Try to use WebGL renderer
    if (this._glReady && this._glRenderer) {
      try {
        this._glRenderer.render();
        return;
      } catch (e) {
        console.error('[TilemapEditor] WebGL render failed:', e);
        this._glReady = false;
      }
    }

    // Fallback to 2D canvas (for backward compatibility during development)
    if (!this._ctx) return;
    
    const { tileWidth, tileHeight } = this.mapData.map;
    const ctx = this._ctx;
    const tw  = tileWidth  * this.zoom;
    const th  = tileHeight * this.zoom;

    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

    // Render each layer with its own dimensions
    for (const layer of this.mapData.layers) {
      if (layer.visible === false) continue;
      if (!layer.data || layer.data.length === 0) continue;
      
      ctx.globalAlpha = typeof layer.opacity === 'number' ? layer.opacity : 1;
      const layerWidth = layer.width || this.mapData.map.width;
      const layerHeight = layer.height || this.mapData.map.height;
      
      for (let ty = 0; ty < layerHeight; ty++) {
        for (let tx = 0; tx < layerWidth; tx++) {
          const idx = ty * layerWidth + tx;
          const gid = layer.data?.[idx];
          if (!gid) continue;
          const ts = this._tilesetForGid(gid);
          if (!ts?.canvas) continue;
          const localId = gid - ts.tileset.firstGid;
          const cols    = Math.floor(ts.canvas.width / tileWidth);
          const sx      = (localId % cols)           * tileWidth;
          const sy      = Math.floor(localId / cols) * tileHeight;
          ctx.drawImage(ts.canvas, sx, sy, tileWidth, tileHeight, tx * tw, ty * th, tw, th);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Grid overlay (2D fallback only)
    if (this.showGrid) {
      const { width, height } = this.mapData.map;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth   = 0.5;
      for (let tx = 0; tx <= width;  tx++) { ctx.beginPath(); ctx.moveTo(tx*tw, 0); ctx.lineTo(tx*tw, height*th); ctx.stroke(); }
      for (let ty = 0; ty <= height; ty++) { ctx.beginPath(); ctx.moveTo(0, ty*th); ctx.lineTo(width*tw, ty*th);  ctx.stroke(); }
    }

    // Active-layer border
    ctx.strokeStyle = 'rgba(100,180,255,0.35)';
    ctx.lineWidth   = 2;
    ctx.strokeRect(1, 1, this._canvas.width - 2, this._canvas.height - 2);
  }

  _tilesetForGid(gid) {
    let best = null;
    for (const [firstGid, entry] of this._loadedTilesets) {
      if (gid >= firstGid && (!best || firstGid > best.tileset.firstGid)) best = entry;
    }
    return best;
  }

  /* ─── Layer tabs ─────────────────────────────────────────────────── */

  _rebuildLayerTabs() {
    if (!this._layerTabsEl) return;
    const el = this._layerTabsEl;
    el.innerHTML = '';

    const hdr = document.createElement('div');
    hdr.className = 'te-panel-header';
    const title = document.createElement('span');
    title.textContent = 'Layers';
    const addBtn = document.createElement('button');
    addBtn.className = 'te-icon-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add layer';
    addBtn.addEventListener('click', () => this._promptAddLayer());
    hdr.appendChild(title);
    hdr.appendChild(addBtn);
    el.appendChild(hdr);

    const list = document.createElement('div');
    list.className = 'te-layer-list';

    this.mapData.layers.forEach((layer, idx) => {
      const row = document.createElement('div');
      row.className = 'te-layer-row' + (idx === this.currentLayer ? ' active' : '');

      const eyeBtn = document.createElement('button');
      eyeBtn.className = 'te-icon-btn';
      eyeBtn.textContent = layer.visible !== false ? '👁' : '🙈';
      eyeBtn.title = 'Toggle visibility';
      eyeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        layer.visible = layer.visible === false;
        this._rebuildLayerTabs();
        this._renderMap();
        this.markDirty?.();
      });

      const name = document.createElement('span');
      name.className = 'te-layer-name';
      name.textContent = layer.name;
      name.addEventListener('click', () => {
        this.currentLayer = idx;
        this._rebuildLayerTabs();
        this._renderMap();
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'te-icon-btn te-danger';
      delBtn.textContent = '✕';
      delBtn.title = 'Delete layer';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.mapData.layers.length <= 1) { this._setStatus('Cannot delete the last layer'); return; }
        this._pushUndo();
        this.mapData.layers.splice(idx, 1);
        this.currentLayer = Math.min(this.currentLayer, this.mapData.layers.length - 1);
        this._rebuildLayerTabs();
        this._renderMap();
        this.markDirty?.();
      });

      row.appendChild(eyeBtn);
      row.appendChild(name);
      row.appendChild(delBtn);
      list.appendChild(row);
    });

    el.appendChild(list);
  }

  _promptAddLayer() {
    const name = window.prompt('Layer name:', `Layer ${this.mapData.layers.length + 1}`);
    if (!name) return;
    this._pushUndo();
    this.mapData.layers.push({
      name:    name.trim() || `Layer ${this.mapData.layers.length + 1}`,
      width:   this.mapData.map.width,
      height:  this.mapData.map.height,
      visible: true,
      opacity: 1,
      data:    new Array(this.mapData.map.width * this.mapData.map.height).fill(0),
    });
    this.currentLayer = this.mapData.layers.length - 1;
    this._rebuildLayerTabs();
    this._renderMap();
    this.markDirty?.();
  }

  /* ─── Tileset panel ──────────────────────────────────────────────── */

  _rebuildTilePalette() {
    if (!this._tilePaletteEl) return;
    this._tilePaletteEl.innerHTML = '';

    if (this._loadedTilesets.size === 0) {
      const hint = document.createElement('div');
      hint.className = 'te-palette-hint';
      hint.textContent = 'No tilesets loaded. Click "+ Tileset from Project" to add one.';
      this._tilePaletteEl.appendChild(hint);
      return;
    }

    for (const [firstGid, entry] of this._loadedTilesets) {
      const { canvas, tileset } = entry;
      const { tileWidth, tileHeight } = this.mapData.map;

      const section = document.createElement('div');
      section.className = 'te-tileset-section';

      const lbl = document.createElement('div');
      lbl.className = 'te-tileset-label';
      lbl.textContent = tileset.name || `GID ${firstGid}`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'te-icon-btn te-danger';
      removeBtn.textContent = '✕';
      removeBtn.title = 'Remove tileset';
      removeBtn.addEventListener('click', () => {
        this._loadedTilesets.delete(firstGid);
        this.mapData.tilesets = this.mapData.tilesets.filter(ts => ts.firstGid !== firstGid);
        this._rebuildTilePalette();
        this._renderMap();
        this.markDirty?.();
      });
      lbl.appendChild(removeBtn);

      const grid = document.createElement('div');
      grid.className = 'te-palette-grid';
      const cols  = Math.floor(canvas.width  / tileWidth);
      const rows  = Math.floor(canvas.height / tileHeight);

      for (let t = 0; t < cols * rows; t++) {
        const tileGid = firstGid + t;
        const cell = document.createElement('canvas');
        cell.width  = tileWidth;
        cell.height = tileHeight;
        cell.className = 'te-palette-tile' + (tileGid === this.selectedGid ? ' selected' : '');
        cell.title = `GID ${tileGid}`;
        cell.getContext('2d').drawImage(
          canvas,
          (t % cols) * tileWidth, Math.floor(t / cols) * tileHeight, tileWidth, tileHeight,
          0, 0, tileWidth, tileHeight
        );
        cell.addEventListener('click', () => {
          this.selectedGid = tileGid;
          this._selectTool('paint');
          this._rebuildTilePalette();
        });
        grid.appendChild(cell);
      }

      section.appendChild(lbl);
      section.appendChild(grid);
      this._tilePaletteEl.appendChild(section);
    }
  }

  async _promptAddTileset() {
    const explorer = window.gameEmulator?.projectExplorer
                  || window.serviceContainer?.get?.('projectExplorer');
    const project  = explorer?.getFocusedProjectName?.();
    if (!project) { this._setStatus('No active project'); return; }

    // Collect all image files from the entire project
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
    const allFiles  = explorer.GetSourceFiles?.() || [];
    const images    = allFiles.filter(f => imageExts.some(x => (f.name || '').toLowerCase().endsWith(x)));

    // Build options list: existing images + upload option
    const options = images.map(f => ({ label: f.name, value: f.fullPath }));
    options.unshift({ label: '📤 Upload New Image…', value: '__upload__' });

    let chosen = null;
    if (window.ModalUtils?.showSelectionList) {
      chosen = await window.ModalUtils.showSelectionList(
        'Add Tileset',
        'Choose a tileset image or upload a new one:',
        options,
        { confirmText: 'Add', cancelText: 'Cancel' }
      );
    } else {
      const idx = parseInt(window.prompt(
        'Pick a tileset image:\n' + options.map((o, i) => `${i}: ${o.label}`).join('\n'), '0'
      ), 10);
      if (!isNaN(idx) && options[idx]) chosen = options[idx].value;
    }

    if (!chosen) return;

    // If user picked the upload option, open file picker
    if (chosen === '__upload__') {
      await this._uploadAndLoadTileset();
      return;
    }

    await this._loadTilesetFromProjectPath(chosen);
  }

  async _uploadAndLoadTileset() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/gif,image/bmp,image/webp,.png,.jpg,.jpeg,.gif,.bmp,.webp';
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) { resolve(); return; }
        
        this._setStatus(`Loading tileset: ${file.name}…`);
        try {
          const url = URL.createObjectURL(file);
          await this._loadTilesetFromObjectUrl(url);
          this._setStatus(`Tileset loaded: ${file.name}`);
        } catch (err) {
          this._setStatus(`Error loading tileset: ${err.message}`);
          console.error('Tileset upload error:', err);
        } finally {
          resolve();
        }
      };
      input.click();
    });
  }

  async _loadTilesetFromProjectPath(projectPath) {
    this._setStatus(`Loading tileset: ${projectPath.split('/').pop()}…`);
    try {
      const fm = window.serviceContainer?.get?.('fileManager') || window.fileManager;
      if (!fm) throw new Error('FileManager unavailable');

      const storagePath = window.ProjectPaths?.normalizeStoragePath
        ? window.ProjectPaths.normalizeStoragePath(projectPath)
        : projectPath;
      const obj = await fm.loadFile(storagePath);
      if (!obj) throw new Error(`File not found: ${storagePath}`);

      let blob;
      if (obj.content instanceof ArrayBuffer) {
        blob = new Blob([obj.content]);
      } else if (obj.binaryData && typeof obj.fileContent === 'string') {
        const bytes = Uint8Array.from(atob(obj.fileContent), c => c.charCodeAt(0));
        blob = new Blob([bytes]);
      } else if (typeof obj.fileContent === 'string') {
        blob = new Blob([obj.fileContent]);
      } else {
        throw new Error('Unrecognised file content format');
      }

      const url = URL.createObjectURL(blob);
      await this._loadTilesetFromObjectUrl(url, projectPath);
      URL.revokeObjectURL(url);
    } catch (e) {
      this._setStatus(`Failed to load tileset: ${e.message}`);
      console.error('[TilemapEditor] Tileset load error:', e);
    }
  }

  _loadTilesetFromObjectUrl(url, projectPath) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const offscreen = document.createElement('canvas');
        offscreen.width  = img.width;
        offscreen.height = img.height;
        offscreen.getContext('2d').drawImage(img, 0, 0);

        const name     = (projectPath.split('/').pop() || 'tileset').replace(/\.[^.]+$/, '');
        const firstGid = this._nextFirstGid();
        const { tileWidth, tileHeight } = this.mapData.map;
        const tileset = {
          name,
          firstGid,
          tileWidth,
          tileHeight,
          tileCount: Math.floor(img.width / tileWidth) * Math.floor(img.height / tileHeight),
          image: { source: projectPath, width: img.width, height: img.height },
        };

        this._loadedTilesets.set(firstGid, { canvas: offscreen, tileset });
        this.mapData.tilesets.push(tileset);
        this._rebuildTilePalette();
        this._renderMap();
        this._setStatus(`Loaded tileset: ${name} (GID ${firstGid})`);
        this.markDirty?.();
        resolve();
      };
      img.onerror = () => { this._setStatus('Failed to decode tileset image'); resolve(); };
      img.src = url;
    });
  }

  _nextFirstGid() {
    if (!this.mapData.tilesets.length) return 1;
    const last = this.mapData.tilesets.reduce((m, ts) => ts.firstGid > m.firstGid ? ts : m);
    return last.firstGid + Math.max(1, last.tileCount || 1);
  }

  /* ─── Map properties ─────────────────────────────────────────────── */

  _promptNewMap() {
    const w  = parseInt(window.prompt('Map width (tiles):',   '32'), 10);
    const h  = parseInt(window.prompt('Map height (tiles):',  '24'), 10);
    const tw = parseInt(window.prompt('Tile width (pixels):', '16'), 10);
    const th = parseInt(window.prompt('Tile height (pixels):','16'), 10);
    if (!w || !h || !tw || !th || w <= 0 || h <= 0 || tw <= 0 || th <= 0) return;
    this.mapData = new TilemapData({ map: { width: w, height: h, tileWidth: tw, tileHeight: th } });
    this._loadedTilesets.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.currentLayer = 0;
    this._fullRefresh();
    this.markDirty?.();
  }

  _showMapProps() {
    const m = this.mapData.map;
    window.alert([
      `Size:        ${m.width} × ${m.height} tiles`,
      `Tile size:   ${m.tileWidth} × ${m.tileHeight} px`,
      `Orientation: ${m.orientation}`,
      `Layers:      ${this.mapData.layers.length}`,
      `Tilesets:    ${this.mapData.tilesets.length}`,
    ].join('\n'));
  }

  /* ─── Zoom ───────────────────────────────────────────────────────── */

  _adjustZoom(factor) {
    this.zoom = Math.max(0.25, Math.min(8, this.zoom * factor));
    this._resizeCanvas();
    this._renderMap();
    this._setStatus(`Zoom: ${Math.round(this.zoom * 100)}%`);
  }

  _fitView() {
    const wrap = this._canvas?.parentElement;
    if (!wrap || !this.mapData) return;
    const zw = wrap.clientWidth  / (this.mapData.map.width  * this.mapData.map.tileWidth);
    const zh = wrap.clientHeight / (this.mapData.map.height * this.mapData.map.tileHeight);
    this.zoom = Math.max(0.25, Math.min(4, zw, zh));
    this._resizeCanvas();
    this._renderMap();
  }

  /* ─── Undo / Redo ────────────────────────────────────────────────── */

  _pushUndo() {
    this.undoStack.push(JSON.stringify(this.mapData.toJSON()));
    this.redoStack = [];
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  _undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.mapData.toJSON()));
    this.mapData = TilemapData.fromJSON(JSON.parse(this.undoStack.pop()));
    this._fullRefresh();
    this.markDirty?.();
  }

  _redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.mapData.toJSON()));
    this.mapData = TilemapData.fromJSON(JSON.parse(this.redoStack.pop()));
    this._fullRefresh();
    this.markDirty?.();
  }

  /* ─── Keyboard shortcuts ─────────────────────────────────────────── */

  _bindKeyboard() {
    this._keyHandler = (e) => {
      if (!this.isActiveEditor?.()) return;
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); this._undo(); return; }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); this._redo(); return; }
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.key === 'p') this._selectTool('paint');
        if (e.key === 'e') this._selectTool('erase');
        if (e.key === 'f') this._selectTool('fill');
      }
    };
    document.addEventListener('keydown', this._keyHandler);
  }

  destroy() {
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
    super.destroy();
  }

  /* ─── TMX import (lazy) ──────────────────────────────────────────── */

  async _importTmx(tmxText) {
    await this._ensureTmxImporter();
    if (typeof TMXImporter === 'undefined') { this._setStatus('TMX importer unavailable'); return; }
    try {
      const parsed = TMXImporter.parse(tmxText);
      this.mapData  = TilemapData.fromJSON(parsed);
      this._setStatus('TMX imported — add tilesets via "+ Tileset from Project"');
    } catch (e) {
      this._setStatus(`TMX parse error: ${e.message}`);
    }
  }

  _ensureTmxImporter() {
    if (typeof TMXImporter !== 'undefined') return Promise.resolve();
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'scripts/tilemap-importer.js?v=1';
      s.onload  = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
    });
  }

  /* ─── Level import (TMX & PNG) ──────────────────────────────────── */

  async _promptImportLevels() {
    const options = [
      { label: 'Tiled Map (.tmx)', value: 'tmx' },
      { label: 'PNG Image', value: 'png' },
    ];

    let chosen = null;
    if (window.ModalUtils?.showSelectionList) {
      chosen = await window.ModalUtils.showSelectionList(
        'Import Levels',
        'Choose import format:',
        options,
        { confirmText: 'Continue', cancelText: 'Cancel' }
      );
    } else {
      const idx = parseInt(window.prompt(
        'Pick import format:\n' + options.map((o, i) => `${i}: ${o.label}`).join('\n'), '0'
      ), 10);
      if (!isNaN(idx) && options[idx]) chosen = options[idx].value;
    }

    if (!chosen) return;

    if (chosen === 'tmx')  { await this._importLevelsTMX(); }
    else if (chosen === 'png') { await this._importLevelsPNG(); }
  }

  async _importLevelsTMX() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.tmx,text/plain,application/xml';
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) { resolve(); return; }

        this._setStatus(`Importing TMX: ${file.name}…`);
        try {
          const text = await file.text();
          await this._importTmx(text);
          this._fullRefresh();
          this._setStatus(`TMX imported: ${file.name}`);
        } catch (err) {
          this._setStatus(`Error importing TMX: ${err.message}`);
          console.error('TMX import error:', err);
        } finally {
          resolve();
        }
      };
      input.click();
    });
  }

  async _importLevelsPNG() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/gif,image/bmp,image/webp';

      input.onchange = (e) => {
        const file = e.target.files?.[0];
        if (!file) { resolve(); return; }

        const tileSizeStr = window.prompt(
          'Enter tile size (format: WxH, e.g., 16x16)',
          '16x16'
        );
        if (!tileSizeStr) { resolve(); return; }

        const [tw, th] = tileSizeStr.split('x').map(s => parseInt(s.trim(), 10));
        if (!Number.isInteger(tw) || !Number.isInteger(th) || tw <= 0 || th <= 0) {
          this._setStatus('Invalid tile size');
          resolve();
          return;
        }

        this._setStatus(`Analyzing PNG: ${file.name}…`);
        this._showProgressBar();
        const url = URL.createObjectURL(file);

        this._analyzePngAsLevel(url, tw, th, file.name).then(() => {
          this._hideProgressBar();
          this.markDirty();
          this._fullRefresh();
          this._setStatus(`PNG imported: ${file.name}`);
          resolve();
        }).catch(err => {
          this._hideProgressBar();
          this._setStatus(`Error importing PNG: ${err.message}`);
          console.error('[TilemapEditor] PNG import error:', err);
          resolve();
        });
      };

      input.click();
    });
  }

  async _analyzePngAsLevel(imageUrl, tileWidth, tileHeight, fileName) {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = async () => {
        try {
          const imageCanvas = document.createElement('canvas');
          imageCanvas.width = img.width;
          imageCanvas.height = img.height;
          const imageCtx = imageCanvas.getContext('2d');
          imageCtx.drawImage(img, 0, 0);

          const tilesWide = Math.floor(img.width / tileWidth);
          const tilesTall = Math.floor(img.height / tileHeight);
          const totalTiles = tilesWide * tilesTall;

          // Extract unique tiles from the image
          const uniqueTiles = []; // Array of { canvas, pixels }
          const tileMap = new Map(); // Map<pixelHash, gid>
          const layerData = new Array(totalTiles).fill(0);

          // Process tiles in chunks to allow progress updates
          const chunkSize = 32;
          for (let startIdx = 0; startIdx < totalTiles; startIdx += chunkSize) {
            const endIdx = Math.min(startIdx + chunkSize, totalTiles);
            
            for (let idx = startIdx; idx < endIdx; idx++) {
              const ty = Math.floor(idx / tilesWide);
              const tx = idx % tilesWide;

              // Extract tile at (tx, ty)
              const tileCanvas = document.createElement('canvas');
              tileCanvas.width = tileWidth;
              tileCanvas.height = tileHeight;
              const tileCtx = tileCanvas.getContext('2d');
              tileCtx.drawImage(
                imageCanvas,
                tx * tileWidth,
                ty * tileHeight,
                tileWidth,
                tileHeight,
                0,
                0,
                tileWidth,
                tileHeight
              );

              // Get pixel data as hash for comparison
              const tileImageData = tileCtx.getImageData(0, 0, tileWidth, tileHeight);
              const pixelHash = this._hashPixels(tileImageData.data);

              // Check if we've seen this tile
              let gid = tileMap.get(pixelHash);
              if (gid === undefined) {
                gid = uniqueTiles.length + 1; // GID starts at 1
                uniqueTiles.push({
                  canvas: tileCanvas,
                  pixelHash,
                });
                tileMap.set(pixelHash, gid);
              }

              layerData[idx] = gid;
            }

            // Yield to UI thread and update progress
            this._updateProgressBar(endIdx / totalTiles);
            await new Promise(r => setTimeout(r, 0));
          }

          // Build tileset canvas by combining all unique tiles
          this._updateProgressBar(0.9); // Show almost done
          const tilesetCanvas = document.createElement('canvas');
          tilesetCanvas.width = tileWidth * uniqueTiles.length;
          tilesetCanvas.height = tileHeight;
          const tilesetCtx = tilesetCanvas.getContext('2d');

          uniqueTiles.forEach((tile, idx) => {
            tilesetCtx.drawImage(tile.canvas, idx * tileWidth, 0);
          });

          // Add to current map data
          const firstGid = Math.max(
            ...Array.from(this.mapData.tilesets).map(ts => (ts.firstGid || 0) + 1),
            1
          );

          // Convert tileset canvas to PNG blob and save via texture pipeline
          const pngBlob = await new Promise(resolve => tilesetCanvas.toBlob(resolve, 'image/png'));
          const timestamp = Date.now();

          // Save PNG + create .texture metadata file
          const textureResult = await this._saveTilesetAsTexture(pngBlob, timestamp, tileWidth, tileHeight);
          if (!textureResult) {
            throw new Error('Failed to save tileset as texture');
          }

          this.mapData.tilesets.push({
            firstGid,
            name: `Import_${timestamp}`,
            tileWidth,
            tileHeight,
            tileCount: uniqueTiles.length,
            columns: uniqueTiles.length,
            image: {
              source: textureResult.texturePath,  // Reference the .texture file, not PNG
              width: tilesetCanvas.width,
              height: tilesetCanvas.height,
            },
          });

          // Cache the tileset canvas for rendering
          this._loadedTilesets.set(firstGid, {
            canvas: tilesetCanvas,
            tileset: this.mapData.tilesets[this.mapData.tilesets.length - 1],
          });

          // Offset layer GIDs to match tileset's firstGid
          // Local tile IDs are 1-N, but need to be absolute GIDs starting at firstGid
          const gidOffset = firstGid - 1;
          for (let i = 0; i < layerData.length; i++) {
            if (layerData[i] > 0) {
              layerData[i] += gidOffset;
            }
          }

          // Create new layer at PNG dimensions (don't resize to map size)
          const newLayer = {
            name: fileName.replace(/\.[^.]+$/, ''),
            width: tilesWide,
            height: tilesTall,
            visible: true,
            opacity: 1,
            data: layerData,
          };

          this._setStatus(`PNG imported as layer: ${fileName} (${tilesWide}×${tilesTall})`);

          this.mapData.layers.push(newLayer);

          this.currentLayer = this.mapData.layers.length - 1;  // Switch to new layer

          this._rebuildLayerTabs();
          this._rebuildTilePalette();
          this._renderMap();
          this._updateProgressBar(1.0);

          resolve();
        } catch (e) {
          reject(e);
        }
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load PNG image'));
      };
      
      img.onabort = () => {
        reject(new Error('PNG image load aborted'));
      };
      
      img.src = imageUrl;
    });
  }

  _hashPixels(pixelData) {
    // Simple hash of pixel data for quick equality check
    let hash = 0;
    for (let i = 0; i < pixelData.length; i += 4) {
      // Only hash RGB, ignore alpha variations
      hash = ((hash << 5) - hash) + pixelData[i] + pixelData[i + 1] + pixelData[i + 2];
      hash = hash & 0xffffffff;
    }
    return hash.toString(36);
  }

  /* ─── Texture file creation (PNG → .texture metadata) ───────────── */

  async _saveTilesetAsTexture(pngBlob, timestamp, tileWidth, tileHeight) {
    // Save PNG file and create .texture metadata
    try {
      const fm = window.serviceContainer?.get?.('fileManager') || window.fileManager;
      if (!fm || !fm.saveFile) {
        console.error('[TilemapEditor] FileManager not available:', { fm: !!fm, saveFile: fm?.saveFile });
        alert('ERROR: FileManager not available - cannot save tileset PNG');
        throw new Error('FileManager unavailable');
      }

      const pngFileName = `tileset_${timestamp}.png`;
      const pngPath = `Sources/Images/${pngFileName}`;
      const arrayBuffer = await pngBlob.arrayBuffer();
      
      console.log('[TilemapEditor] Saving PNG:', { pngPath, size: arrayBuffer.byteLength });
      await fm.saveFile(pngPath, arrayBuffer);
      console.log('[TilemapEditor] PNG saved successfully');

      // Create .texture metadata file
      const textureName = `tileset_${timestamp}`;
      const textureMetadata = {
        version: 1,
        sourceImagePath: pngPath,
        outputPixelFormat: 'd2_mode_i8',
        paletteOffset: 0,
        useColorKey: true,
        colorKey: '#ff00ff',
        compressionType: 'none',
        tileWidth,
        tileHeight,
      };

      const texturePath = `Sources/Images/${textureName}.texture`;
      const textureJson = JSON.stringify(textureMetadata, null, 2);
      
      console.log('[TilemapEditor] Saving texture metadata:', { texturePath, metadata: textureMetadata });
      await fm.saveFile(texturePath, textureJson);
      console.log('[TilemapEditor] Texture file saved successfully');

      // Refresh project explorer to show new files
      const explorer = window.gameEmulator?.projectExplorer || window.serviceContainer?.get?.('projectExplorer');
      if (explorer?.refresh) {
        console.log('[TilemapEditor] Refreshing project explorer');
        explorer.refresh();
      }

      return { texturePath, pngPath, textureName };
    } catch (err) {
      console.error('[TilemapEditor] Error saving tileset:', err);
      alert(`Error saving tileset: ${err.message}`);
      throw err;
    }
  }

  /* ─── Progress bar ──────────────────────────────────────────────── */

  _showProgressBar() {
    if (this._progressBarEl) return; // Already showing
    this._progressBarEl = document.createElement('div');
    this._progressBarEl.className = 'tilemap-progress-overlay';
    this._progressBarEl.innerHTML = `
      <div class="tilemap-progress-box">
        <div class="tilemap-progress-label">Processing…</div>
        <div class="tilemap-progress-bar">
          <div class="tilemap-progress-fill" style="width: 0%"></div>
        </div>
        <div class="tilemap-progress-percent">0%</div>
      </div>
    `;
    document.body.appendChild(this._progressBarEl);
  }

  _hideProgressBar() {
    if (this._progressBarEl) {
      this._progressBarEl.remove();
      this._progressBarEl = null;
    }
  }

  _updateProgressBar(fraction) {
    if (!this._progressBarEl) return;
    const percent = Math.round(fraction * 100);
    const fill = this._progressBarEl.querySelector('.tilemap-progress-fill');
    const label = this._progressBarEl.querySelector('.tilemap-progress-percent');
    if (fill) fill.style.width = percent + '%';
    if (label) label.textContent = percent + '%';
  }

  /* ─── Status ─────────────────────────────────────────────────────── */

  _setStatus(msg) {
    if (this._statusEl) this._statusEl.textContent = msg;
  }

  /* ─── EditorBase overrides ───────────────────────────────────────── */

  getContent() {
    return JSON.stringify(this.mapData?.toJSON() ?? new TilemapData().toJSON(), null, 2);
  }

  isModified() {
    if (this.isNewResource && !this.isDirty) return false;
    return super.isModified();
  }

  /* ─── Static interface ───────────────────────────────────────────── */

  static getFileExtensions() { return ['.tilemap', '.tmj']; }
  static getFileExtension()  { return '.tilemap'; }
  static getDisplayName()    { return 'Tilemap Editor'; }
  static getIcon()           { return '🗺️'; }
  static getPriority()       { return 8; }
  static canCreate = true;
  static getDefaultFolder()  { return 'Sources/Maps'; }

  static createNew() {
    return JSON.stringify(new TilemapData().toJSON(), null, 2);
  }
}

try {
  TilemapEditor.registerComponent();
} catch (err) {
  console.error('[TilemapEditor] registerComponent() failed:', err);
}

window.TilemapEditor = TilemapEditor;
