// tilemap.js - TileMap Lua Extensions for RetroStudio Emulator
// Implements TileMap.* Lua API for loading and rendering D2M binary tilemaps.
//
// Runtime Constraints:
//   - Only loads binary D2M files, not source JSON or images
//   - Texture references are resolved by textureIndex into built .d2 texture table
//   - No access to source assets; works exclusively with runtime package build/
//
// Tilemap instances are identified by opaque integer handles.
// Each tilemap maintains layer data, tileset metadata, and optional Wang terrain info.
//
// Render pipeline:
//   1. Parse D2M header and validate format (magic "D2MP", version 1)
//   2. Load tileset records with texture indices (not paths)
//   3. Decompose layer cell data (uint32 GIDs per tile)
//   4. On DrawLayer: blit tiles using resolved GPU texture handles

class LuaTilemapExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;

    /** @type {Map<number, object>} handle → tilemap runtime state */
    this.tilemaps = new Map();

    /** @type {number} Monotonic tilemap handle allocator */
    this._nextHandle = 1;

    /** @type {Map<string, object>} path → parsed D2M data cache */
    this.tilemapAssets = new Map();

    /** @type {Map<number, object>} textureIndex → GPU texture handle (from D2Canvas.createTexture) */
    this.gpuTextures = new Map();

    /** @type {D2Canvas|null} GPU renderer reference (set by initGpu) */
    this.gpu = null;

    /** @type {Object|null} File manager for runtime package (set during initialize) */
    this.fileManager = null;
  }

  /**
   * Called by extension loader after construction.
   * Set up D2M parsing and GPU rendering.
   */
  async initialize(luaState) {
    console.log('[LuaTileMap] Initializing tilemap system');
    this.luaState = luaState;
    this.fileManager = this.gameEmulator?.fileManager || window.runtimeFileManager;
  }

  /**
   * Reset state (called on project reload / re-run).
   */
  reset() {
    this.tilemaps.clear();
    this._nextHandle = 1;
    this.tilemapAssets.clear();
    this.gpuTextures.clear();
    this.gpu = null;
    console.log('[LuaTileMap] Tilemap system reset');
  }

  /**
   * Initialize GPU reference for rendering.
   * Called by the game emulator during GPU setup.
   */
  setGpu(gpu) {
    this.gpu = gpu;
    console.log('[LuaTileMap] GPU reference set');
  }

  /* ════════════════════════════════════════════════════════════════════
     D2M Binary Format Parsing
     ════════════════════════════════════════════════════════════════════ */

  /**
   * Parse D2M file header (40 bytes).
   */
  _parseD2mHeader(data, offset = 0) {
    const view = new DataView(data.buffer || data, data.byteOffset || 0);
    if (offset + 40 > (data.byteLength || data.length)) {
      throw new Error('D2M header overflow: file too small');
    }

    const magic = String.fromCharCode(
      view.getUint8(offset + 0),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );

    if (magic !== 'D2MP') {
      throw new Error(`D2M invalid magic: expected 'D2MP', got '${magic}'`);
    }

    const version = view.getUint8(offset + 4);
    if (version !== 1) {
      throw new Error(`D2M unsupported version: ${version}`);
    }

    return {
      magic,
      version,
      orientation: view.getUint8(offset + 5),
      flags: view.getUint8(offset + 6),
      reserved1: view.getUint8(offset + 7),
      mapWidth: view.getUint16(offset + 8, true),
      mapHeight: view.getUint16(offset + 10, true),
      tileWidth: view.getUint16(offset + 12, true),
      tileHeight: view.getUint16(offset + 14, true),
      layerCount: view.getUint16(offset + 16, true),
      tilesetCount: view.getUint16(offset + 18, true),
      objectLayerCount: view.getUint16(offset + 20, true),
      reserved2: view.getUint16(offset + 22, true),
      tilesetsOffset: view.getUint32(offset + 24, true),
      layersOffset: view.getUint32(offset + 28, true),
      stringsOffset: view.getUint32(offset + 32, true),
      wangOffset: view.getUint32(offset + 36, true),
    };
  }

  /**
   * Parse tileset records from D2M.
   */
  _parseTilesets(data, header) {
    const view = new DataView(data.buffer || data, data.byteOffset || 0);
    const offset = header.tilesetsOffset;

    if (offset + 4 > data.byteLength) {
      throw new Error('D2M tilesets chunk overflow');
    }

    const count = view.getUint16(offset, true);
    const recordSize = view.getUint16(offset + 2, true);

    const tilesets = [];
    for (let i = 0; i < count; i++) {
      const recOffset = offset + 4 + i * recordSize;
      if (recOffset + 24 > data.byteLength) {
        throw new Error(`D2M tileset record ${i} overflow`);
      }

      tilesets.push({
        firstGid: view.getUint32(recOffset + 0, true),
        tileWidth: view.getUint16(recOffset + 4, true),
        tileHeight: view.getUint16(recOffset + 6, true),
        columns: view.getUint16(recOffset + 8, true),
        tileCount: view.getUint16(recOffset + 10, true),
        textureIndex: view.getUint16(recOffset + 12, true),
        flags: view.getUint16(recOffset + 14, true),
        spacing: view.getUint8(recOffset + 16),
        margin: view.getUint8(recOffset + 17),
        nameStringId: view.getUint16(recOffset + 18, true),
        texturePathStringId: view.getUint16(recOffset + 20, true),
        reserved: view.getUint16(recOffset + 22, true),
      });
    }

    return tilesets;
  }

  /**
   * Parse layer records from D2M.
   */
  _parseLayers(data, header) {
    const view = new DataView(data.buffer || data, data.byteOffset || 0);
    const offset = header.layersOffset;

    if (offset + 4 > data.byteLength) {
      throw new Error('D2M layers chunk overflow');
    }

    const count = view.getUint16(offset, true);
    const layers = [];

    for (let i = 0; i < count; i++) {
      const recOffset = offset + 4 + i * 16;
      if (recOffset + 16 > data.byteLength) {
        throw new Error(`D2M layer record ${i} overflow`);
      }

      const cellDataOffset = view.getUint32(recOffset + 8, true);
      const cellDataLength = view.getUint32(recOffset + 12, true);

      if (cellDataOffset + cellDataLength > data.byteLength) {
        throw new Error(`D2M layer ${i} cell data overflow`);
      }

      const cellData = new Uint32Array(
        data.buffer || data,
        (data.byteOffset || 0) + cellDataOffset,
        cellDataLength / 4
      );

      layers.push({
        nameStringId: view.getUint16(recOffset + 0, true),
        flags: view.getUint16(recOffset + 2, true),
        width: view.getUint16(recOffset + 4, true),
        height: view.getUint16(recOffset + 6, true),
        cellData,
        cellDataOffset,
        cellDataLength,
      });
    }

    return layers;
  }

  /**
   * Parse string table from D2M.
   */
  _parseStrings(data, header) {
    const view = new DataView(data.buffer || data, data.byteOffset || 0);
    const offset = header.stringsOffset;
    const decoder = new TextDecoder('utf-8');

    if (offset + 4 > data.byteLength) {
      throw new Error('D2M strings chunk overflow');
    }

    const count = view.getUint16(offset, true);
    const strings = [];

    let pos = offset + 4;
    for (let i = 0; i < count; i++) {
      if (pos + 4 > data.byteLength) {
        throw new Error(`D2M string record ${i} overflow`);
      }

      const length = view.getUint16(pos, true);
      pos += 4; // skip length + reserved

      if (pos + length > data.byteLength) {
        throw new Error(`D2M string ${i} data overflow`);
      }

      const bytes = new Uint8Array(data.buffer || data, (data.byteOffset || 0) + pos, length);
      strings.push(decoder.decode(bytes));

      pos += length;
    }

    return strings;
  }

  /**
   * Parse optional Wang terrain metadata from D2M.
   */
  _parseWang(data, header) {
    if (header.wangOffset === 0) {
      return null;
    }

    const view = new DataView(data.buffer || data, data.byteOffset || 0);
    const offset = header.wangOffset;

    if (offset + 4 > data.byteLength) {
      return null;
    }

    const jsonLength = view.getUint32(offset, true);
    if (offset + 4 + jsonLength > data.byteLength) {
      return null;
    }

    try {
      const decoder = new TextDecoder('utf-8');
      const bytes = new Uint8Array(data.buffer || data, (data.byteOffset || 0) + offset + 4, jsonLength);
      const jsonStr = decoder.decode(bytes);
      return JSON.parse(jsonStr);
    } catch (error) {
      console.warn('[LuaTileMap] Failed to parse Wang data:', error);
      return null;
    }
  }

  /**
   * Load a D2M file from the runtime package and create a tilemap handle.
   * 
   * RUNTIME CONSTRAINT: This only accepts binary D2M files. Source JSON files
   * and image assets are not available in the runtime environment. Only built
   * artifacts from the project's build/ folder are accessible.
   * 
   * Lua usage: local map = TileMap.Load("Maps/level-1.d2m")
   */
  Load() {
    const mapPath = this.luaState?.raw_tostring?.(2);
    if (!mapPath) {
      throw new Error('[TileMap] Load: missing required argument (mapPath)');
    }

    if (!this.fileManager) {
      throw new Error('[TileMap] Load: file manager not available');
    }

    try {
      // Try to load from cache first
      if (this.tilemapAssets.has(mapPath)) {
        const cached = this.tilemapAssets.get(mapPath);
        const handle = this._nextHandle++;
        this.tilemaps.set(handle, {
          ...cached,
          handle,
        });
        return handle;
      }

      // Load file from runtime package
      let fileData = null;
      try {
        const record = this.fileManager.getFile(mapPath);
        if (!record) {
          throw new Error(`File not found: ${mapPath}`);
        }
        fileData = record.content || record.fileContent;
      } catch (error) {
        throw new Error(`Cannot load map: ${error.message}`);
      }

      // Parse D2M binary
      if (typeof fileData === 'string') {
        const encoder = new TextEncoder();
        fileData = encoder.encode(fileData);
      }

      if (!(fileData instanceof Uint8Array) && !ArrayBuffer.isView(fileData)) {
        throw new Error('Map file must be binary data');
      }

      const header = this._parseD2mHeader(fileData);
      const tilesets = this._parseTilesets(fileData, header);
      const layers = this._parseLayers(fileData, header);
      const strings = this._parseStrings(fileData, header);
      const wang = this._parseWang(fileData, header);

      const mapData = {
        header,
        tilesets,
        layers,
        strings,
        wang,
        fileData,
      };

      this.tilemapAssets.set(mapPath, mapData);

      // Create handle
      const handle = this._nextHandle++;
      this.tilemaps.set(handle, {
        ...mapData,
        handle,
      });

      console.log(`[LuaTileMap] Loaded map ${mapPath}: ${header.mapWidth}x${header.mapHeight}`);
      return handle;
    } catch (error) {
      throw new Error(`[TileMap] Load failed: ${error.message}`);
    }
  }

  /**
   * Get tilemap dimensions in tiles.
   * Lua usage: local width, height = TileMap.GetDimensions(map)
   */
  GetDimensions() {
    const handle = parseInt(this.luaState?.raw_tostring?.(2) || '0', 10);
    const map = this.tilemaps.get(handle);
    if (!map) {
      throw new Error(`[TileMap] GetDimensions: invalid tilemap handle ${handle}`);
    }
    return [map.header.mapWidth, map.header.mapHeight];
  }

  /**
   * Get tile size in pixels.
   * Lua usage: local tileWidth, tileHeight = TileMap.GetTileSize(map)
   */
  GetTileSize() {
    const handle = parseInt(this.luaState?.raw_tostring?.(2) || '0', 10);
    const map = this.tilemaps.get(handle);
    if (!map) {
      throw new Error(`[TileMap] GetTileSize: invalid tilemap handle ${handle}`);
    }
    return [map.header.tileWidth, map.header.tileHeight];
  }

  /**
   * Get tile GID at a specific layer and position.
   * Lua usage: local gid = TileMap.GetTile(map, layer, tx, ty)
   */
  GetTile() {
    const handle = parseInt(this.luaState?.raw_tostring?.(2) || '0', 10);
    const layer = parseInt(this.luaState?.raw_tostring?.(3) || '0', 10);
    const tx = parseInt(this.luaState?.raw_tostring?.(4) || '0', 10);
    const ty = parseInt(this.luaState?.raw_tostring?.(5) || '0', 10);

    const map = this.tilemaps.get(handle);
    if (!map) {
      throw new Error(`[TileMap] GetTile: invalid tilemap handle ${handle}`);
    }

    if (layer < 0 || layer >= map.layers.length) {
      return 0;
    }

    const layerData = map.layers[layer];
    const index = ty * layerData.width + tx;

    if (index < 0 || index >= layerData.cellData.length) {
      return 0;
    }

    return layerData.cellData[index];
  }

  /**
   * Set tile GID at a specific layer and position.
   * Lua usage: TileMap.SetTile(map, layer, tx, ty, gid)
   */
  SetTile() {
    const handle = parseInt(this.luaState?.raw_tostring?.(2) || '0', 10);
    const layer = parseInt(this.luaState?.raw_tostring?.(3) || '0', 10);
    const tx = parseInt(this.luaState?.raw_tostring?.(4) || '0', 10);
    const ty = parseInt(this.luaState?.raw_tostring?.(5) || '0', 10);
    const gid = parseInt(this.luaState?.raw_tostring?.(6) || '0', 10);

    const map = this.tilemaps.get(handle);
    if (!map) {
      throw new Error(`[TileMap] SetTile: invalid tilemap handle ${handle}`);
    }

    if (layer < 0 || layer >= map.layers.length) {
      return;
    }

    const layerData = map.layers[layer];
    const index = ty * layerData.width + tx;

    if (index >= 0 && index < layerData.cellData.length) {
      layerData.cellData[index] = gid >>> 0;
    }
  }

  /**
   * Get layer visibility.
   * Lua usage: local visible = TileMap.GetLayerVisibility(map, layer)
   */
  GetLayerVisibility() {
    const handle = parseInt(this.luaState?.raw_tostring?.(2) || '0', 10);
    const layer = parseInt(this.luaState?.raw_tostring?.(3) || '0', 10);

    const map = this.tilemaps.get(handle);
    if (!map) {
      throw new Error(`[TileMap] GetLayerVisibility: invalid tilemap handle ${handle}`);
    }

    if (layer < 0 || layer >= map.layers.length) {
      return false;
    }

    const layerData = map.layers[layer];
    return (layerData.flags & 0x0001) !== 0; // bit 0 = visible
  }

  /**
   * Set layer visibility.
   * Lua usage: TileMap.SetLayerVisibility(map, layer, visible)
   */
  SetLayerVisibility() {
    const handle = parseInt(this.luaState?.raw_tostring?.(2) || '0', 10);
    const layer = parseInt(this.luaState?.raw_tostring?.(3) || '0', 10);
    const visible = this.luaState?.toboolean?.(4) !== 0;

    const map = this.tilemaps.get(handle);
    if (!map) {
      throw new Error(`[TileMap] SetLayerVisibility: invalid tilemap handle ${handle}`);
    }

    if (layer >= 0 && layer < map.layers.length) {
      const layerData = map.layers[layer];
      if (visible) {
        layerData.flags |= 0x0001;
      } else {
        layerData.flags &= ~0x0001;
      }
    }
  }

  /**
   * Get number of layers.
   * Lua usage: local layerCount = TileMap.GetLayerCount(map)
   */
  GetLayerCount() {
    const handle = parseInt(this.luaState?.raw_tostring?.(2) || '0', 10);
    const map = this.tilemaps.get(handle);
    if (!map) {
      throw new Error(`[TileMap] GetLayerCount: invalid tilemap handle ${handle}`);
    }
    return map.layers.length;
  }

  /**
   * Get optional Wang terrain metadata.
   * Lua usage: local wangData = TileMap.GetWangData(map)
   */
  GetWangData() {
    const handle = parseInt(this.luaState?.raw_tostring?.(2) || '0', 10);
    const map = this.tilemaps.get(handle);
    if (!map) {
      throw new Error(`[TileMap] GetWangData: invalid tilemap handle ${handle}`);
    }

    if (map.wang) {
      return JSON.stringify(map.wang);
    }

    return null;
  }

  /**
   * Draw a layer at screen offset.
   * Lua usage: TileMap.DrawLayer(map, layerIndex, cameraX, cameraY)
   */
  DrawLayer() {
    const handle = parseInt(this.luaState?.raw_tostring?.(2) || '0', 10);
    const layerIndex = parseInt(this.luaState?.raw_tostring?.(3) || '0', 10);
    const cameraX = parseInt(this.luaState?.raw_tostring?.(4) || '0', 10);
    const cameraY = parseInt(this.luaState?.raw_tostring?.(5) || '0', 10);

    const map = this.tilemaps.get(handle);
    if (!map) {
      throw new Error(`[TileMap] DrawLayer: invalid tilemap handle ${handle}`);
    }

    if (layerIndex < 0 || layerIndex >= map.layers.length) {
      return;
    }

    this._drawLayerInternal(map, layerIndex, cameraX, cameraY);
  }

  /**
   * Internal layer rendering implementation.
   */
  _drawLayerInternal(map, layerIndex, offsetX, offsetY) {
    if (!this.gpu) {
      return; // GPU not ready
    }

    const layer = map.layers[layerIndex];
    if (!layer || !(layer.flags & 0x0001)) {
      return; // Layer not visible
    }

    const { tileWidth, tileHeight } = map.header;
    const screenW = 368;
    const screenH = 448;

    // Calculate visible tile range to avoid overdraw
    const startTileX = Math.max(0, Math.floor(-offsetX / tileWidth));
    const startTileY = Math.max(0, Math.floor(-offsetY / tileHeight));
    const endTileX = Math.min(layer.width, Math.ceil((screenW - offsetX) / tileWidth));
    const endTileY = Math.min(layer.height, Math.ceil((screenH - offsetY) / tileHeight));

    // Draw each visible tile using GPU blit
    for (let ty = startTileY; ty < endTileY; ty++) {
      for (let tx = startTileX; tx < endTileX; tx++) {
        const gid = layer.cellData[ty * layer.width + tx];
        if (gid === 0) continue; // Skip empty tiles

        // Extract tileset index and local tile index
        const tilesetIdx = (gid >> 16) & 0xFFFF;
        const localIdx = gid & 0xFFFF;

        if (tilesetIdx >= map.tilesets.length) continue;

        const tileset = map.tilesets[tilesetIdx];
        if (tileset.textureIndex === 0xFFFF) continue; // No texture

        // Get or load the GPU texture handle for this tileset
        if (!this.gpuTextures.has(tileset.textureIndex)) {
          // Texture not yet loaded into GPU - skip for now
          // In a real impl, would trigger async load
          continue;
        }

        const gpuTexHandle = this.gpuTextures.get(tileset.textureIndex);

        // Calculate source position in tileset texture atlas
        const col = localIdx % tileset.columns;
        const row = Math.floor(localIdx / tileset.columns);
        const srcX = col * tileset.tileWidth + tileset.margin;
        const srcY = row * tileset.tileHeight + tileset.margin;

        // Calculate screen position
        const screenX = tx * tileWidth + offsetX;
        const screenY = ty * tileHeight + offsetY;

        // Draw tile via GPU blit (requires gpu.blit implementation)
        if (typeof this.gpu.blit === 'function') {
          try {
            this.gpu.blit(gpuTexHandle, {
              srcX,
              srcY,
              srcW: tileset.tileWidth,
              srcH: tileset.tileHeight,
              x: screenX,
              y: screenY,
              scale: 1.0,
              rotation: 0,
            });
          } catch (error) {
            console.warn('[LuaTileMap] GPU blit failed:', error);
          }
        }
      }
    }
  }

  /**
   * Unload tilemap and free resources.
   * Lua usage: TileMap.Unload(map)
   */
  Unload() {
    const handle = parseInt(this.luaState?.raw_tostring?.(2) || '0', 10);
    if (this.tilemaps.has(handle)) {
      this.tilemaps.delete(handle);
      console.log(`[LuaTileMap] Unloaded tilemap handle ${handle}`);
    }
  }

  /**
   * Clamp camera coordinates to prevent scrolling past map boundaries.
   * Lua usage: local clampedX, clampedY = TileMap.ScreenClamp(cameraX, cameraY, mapW, mapH, screenW, screenH)
   */
  ScreenClamp() {
    const cameraX = parseInt(this.luaState?.raw_tostring?.(2) || '0', 10);
    const cameraY = parseInt(this.luaState?.raw_tostring?.(3) || '0', 10);
    const mapWidth = parseInt(this.luaState?.raw_tostring?.(4) || '0', 10);
    const mapHeight = parseInt(this.luaState?.raw_tostring?.(5) || '0', 10);
    const screenWidth = parseInt(this.luaState?.raw_tostring?.(6) || '368', 10);
    const screenHeight = parseInt(this.luaState?.raw_tostring?.(7) || '448', 10);

    const clampedX = Math.max(0, Math.min(cameraX, mapWidth - screenWidth));
    const clampedY = Math.max(0, Math.min(cameraY, mapHeight - screenHeight));

    return [clampedX, clampedY];
  }
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LuaTilemapExtensions;
} else {
  window.LuaTilemapExtensions = LuaTilemapExtensions;
}
