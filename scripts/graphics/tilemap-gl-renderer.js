/**
 * TilemapGLRenderer — WebGL viewport-culled tilemap renderer with D2 tileset support.
 *
 * Architecture
 * ────────────
 *  • Renders tilemaps using D2Canvas for tileset texture blitting
 *  • Viewport culling: only tiles visible in the current viewport are drawn
 *  • Real-time frame redraws via requestAnimationFrame
 *  • Orthogonal/isometric/hexagonal map support
 *  • Per-layer opacity and visibility
 *
 * Public API
 * ──────────
 *  const renderer = new TilemapGLRenderer(canvas, mapData, tilesets);
 *  renderer.setViewport(offsetX, offsetY, width, height);  // pixel coords in map space
 *  renderer.setZoom(zoomLevel);                             // 1.0 = 1:1
 *  renderer.render();                                       // draw one frame
 *  renderer.startAnimationLoop();                           // continuous render
 *  renderer.stopAnimationLoop();
 *  renderer.destroy();
 *
 * Dependencies:
 *  • d2-canvas.js (D2Canvas)
 *  • mapData: { map: { width, height, tileWidth, tileHeight, orientation }, layers: [...], tilesets: [...] }
 *  • tilesets: { [tilesetId]: { d2Bytes: Uint8Array, source: '.texture path' } }
 */

class TilemapGLRenderer {
  constructor(canvas, mapData, tilesets = {}) {
    this.canvas = canvas;
    this.mapData = mapData;
    this.tilesets = tilesets; // { tilesetId → { d2Bytes, source } }
    this.tilesetCache = new Map(); // D2Canvas textures cache

    // Viewport state
    this.viewportX = 0;      // pixel offset in map space
    this.viewportY = 0;
    this.viewportWidth = canvas.width;
    this.viewportHeight = canvas.height;
    this.zoom = 1.0;

    // Animation
    this.animationLoopHandle = null;

    // GPU
    this.gpu = null;
    this.palette = null; // default palette for indexed formats

    // Initialize WebGL renderer
    this._initGPU();
  }

  _initGPU() {
    try {
      this.gpu = new D2Canvas(this.canvas);
      if (!this.gpu) throw new Error('D2Canvas initialization failed');
      this.gpu.resize(this.canvas.width, this.canvas.height);
      // Default palette: grayscale + some colors
      this.palette = this._createDefaultPalette();
      this.gpu.setPalette(this.palette);
    } catch (e) {
      console.error('[TilemapGLRenderer] GPU init failed:', e);
      this.gpu = null;
    }
  }

  _createDefaultPalette() {
    const pal = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const v = i;
      pal[i * 4 + 0] = v; // R
      pal[i * 4 + 1] = v; // G
      pal[i * 4 + 2] = v; // B
      pal[i * 4 + 3] = 255; // A
    }
    return pal;
  }

  /**
   * Load a D2 tileset from bytes and cache the GPU texture.
   */
  loadTileset(tilesetId, d2Bytes) {
    if (!this.gpu) return null;

    try {
      if (this.tilesetCache.has(tilesetId)) {
        const cached = this.tilesetCache.get(tilesetId);
        this.gpu.deleteTexture(cached);
      }
      const gpuTex = this.gpu.createTexture(d2Bytes);
      this.tilesetCache.set(tilesetId, gpuTex);
      return gpuTex;
    } catch (e) {
      console.error(`[TilemapGLRenderer] Failed to load tileset ${tilesetId}:`, e);
      return null;
    }
  }

  /**
   * Set the viewport (world-space pixel coordinates where the visible area starts).
   */
  setViewport(x, y, width, height) {
    this.viewportX = x;
    this.viewportY = y;
    this.viewportWidth = width || this.canvas.width;
    this.viewportHeight = height || this.canvas.height;
  }

  /**
   * Set zoom factor (1.0 = 1:1).
   */
  setZoom(z) {
    this.zoom = Math.max(0.1, Math.min(16, z));
  }

  /**
   * Single-frame render.
   */
  render() {
    if (!this.gpu || !this.mapData) return;

    this.gpu.clear(0, 0, 0, 1); // Black background

    const map = this.mapData.map;
    const tileW = map.tileWidth;
    const tileH = map.tileHeight;

    // Calculate culling bounds (in tile coordinates)
    const culledTiles = this._calculateCulledTiles(map);

    // Render each visible layer
    if (Array.isArray(this.mapData.layers)) {
      for (const layer of this.mapData.layers) {
        if (layer.visible === false) continue;

        const opacity = layer.opacity !== undefined ? Math.max(0, Math.min(1, layer.opacity)) : 1;
        this._renderLayer(layer, map, culledTiles, opacity);
      }
    }

    // Render object groups (optional, for reference)
    // if (Array.isArray(this.mapData.objectGroups)) { ... }

    this.gpu.present();
  }

  /**
   * Calculate which tiles are visible in the current viewport.
   */
  _calculateCulledTiles(map) {
    const tileW = map.tileWidth;
    const tileH = map.tileHeight;

    const viewLeft = this.viewportX / this.zoom;
    const viewTop = this.viewportY / this.zoom;
    const viewRight = viewLeft + this.viewportWidth / this.zoom;
    const viewBottom = viewTop + this.viewportHeight / this.zoom;

    // For orthogonal maps, compute tile range
    if (map.orientation === 'orthogonal') {
      return {
        minX: Math.max(0, Math.floor(viewLeft / tileW) - 1),
        maxX: Math.min(map.width - 1, Math.ceil(viewRight / tileW) + 1),
        minY: Math.max(0, Math.floor(viewTop / tileH) - 1),
        maxY: Math.min(map.height - 1, Math.ceil(viewBottom / tileH) + 1),
      };
    }

    // For isometric/hexagonal, cull less aggressively (TODO: implement proper culling)
    return {
      minX: 0,
      maxX: map.width - 1,
      minY: 0,
      maxY: map.height - 1,
    };
  }

  /**
   * Render a single layer with viewport culling.
   */
  _renderLayer(layer, map, culledTiles, opacity) {
    const tileW = map.tileWidth;
    const tileH = map.tileHeight;

    const { minX, maxX, minY, maxY } = culledTiles;

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const idx = ty * layer.width + tx;
        const rawGid = layer.data[idx];

        if (rawGid <= 0) continue; // Empty tile

        // Tiled packs three orientation bits into the top of the gid. They must
        // come off before anything resolves a tileset, or the id looks larger
        // than every firstGid and the tile samples far outside the texture.
        const gid = this._gidIndex(rawGid);
        if (gid <= 0) continue;

        // Find which tileset owns this GID
        const tileset = this._findTilesetForGid(gid);
        if (!tileset) continue;

        // Get GPU texture for this tileset
        const gpuTex = this.tilesetCache.get(tileset.id);
        if (!gpuTex) continue;

        // Calculate local tile ID within tileset
        const localId = gid - tileset.firstGid;
        if (localId < 0) continue;
        const tilesPerRow = Math.ceil(tileset.imageWidth / tileW);
        const col = localId % tilesPerRow;
        const row = Math.floor(localId / tilesPerRow);

        const srcX = col * tileW;
        const srcY = row * tileH;

        // Screen position
        const screenX = (tx * tileW - this.viewportX) * this.zoom;
        const screenY = (ty * tileH - this.viewportY) * this.zoom;

        // Blit via GPU
        this.gpu.blit(gpuTex, {
          x: screenX,
          y: screenY,
          scaleX: this.zoom,
          scaleY: this.zoom,
          srcX: srcX,
          srcY: srcY,
          srcW: tileW,
          srcH: tileH,
          filter: this.zoom < 1 ? 'bilinear' : 'nearest',
        });
      }
    }
  }

  /**
   * Strip Tiled's orientation bits, leaving a plain global tile id.
   * Uses the shared helper when it is loaded, so the mask lives in one place.
   */
  _gidIndex(rawGid) {
    if (typeof window !== 'undefined' && window.TileGid) {
      return window.TileGid.gidIndex(rawGid);
    }
    return ((Number(rawGid) >>> 0) & ~0xE0000000) >>> 0;
  }

  /**
   * Find tileset by GID (assumes tilesets are sorted by firstGid).
   */
  _findTilesetForGid(gid) {
    if (!Array.isArray(this.mapData.tilesets)) return null;

    // Search backwards (higher firstGid = more specific)
    for (let i = this.mapData.tilesets.length - 1; i >= 0; i--) {
      const ts = this.mapData.tilesets[i];
      if (gid >= ts.firstGid) {
        return ts;
      }
    }
    return null;
  }

  /**
   * Start continuous rendering via requestAnimationFrame.
   */
  startAnimationLoop() {
    if (this.animationLoopHandle) return;

    const tick = () => {
      this.render();
      this.animationLoopHandle = requestAnimationFrame(tick);
    };

    this.animationLoopHandle = requestAnimationFrame(tick);
  }

  /**
   * Stop the animation loop.
   */
  stopAnimationLoop() {
    if (this.animationLoopHandle) {
      cancelAnimationFrame(this.animationLoopHandle);
      this.animationLoopHandle = null;
    }
  }

  /**
   * Resize output canvas.
   */
  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.viewportWidth = width;
    this.viewportHeight = height;
    if (this.gpu) {
      this.gpu.resize(width, height);
    }
  }

  /**
   * Set palette for indexed texture formats.
   */
  setPalette(rgbaArray) {
    this.palette = rgbaArray;
    if (this.gpu) {
      this.gpu.setPalette(rgbaArray);
    }
  }

  /**
   * Clean up GPU resources.
   */
  destroy() {
    this.stopAnimationLoop();
    if (this.gpu) {
      for (const tex of this.tilesetCache.values()) {
        this.gpu.deleteTexture(tex);
      }
      this.tilesetCache.clear();
      this.gpu.destroy();
      this.gpu = null;
    }
  }
}

// Auto-register if plugin system available
if (typeof window !== 'undefined' && window.ComponentRegistry) {
  TilemapGLRenderer.registerComponent = () => {
    console.log('[TilemapGLRenderer] Registered');
  };
  TilemapGLRenderer.registerComponent();
}
