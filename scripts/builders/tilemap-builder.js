// tilemap-builder.js
// Build-time tilemap processor: reads .tilemap/.tmj JSON and emits
// a compact .d2m binary map payload for embedded runtime and simulator.

console.log('[TilemapBuilder] Class definition loading');

class TilemapBuilder extends BaseBuilder {
  async build(file) {
    const tag = '[TilemapBuilder]';
    try {
      console.log(`${tag} Processing: ${file.path}`);

      const source = this.parseTilemapJson(file.content, file.path);
      const normalized = this.normalizeMap(source, file.path);
      const bytes = this.buildD2M(normalized);
      const outputPath = this.toBuildPath(file.path.replace(/\.(tilemap|tmj|json)$/i, '.d2m'));

      await this.saveBinary(outputPath, bytes);

      console.log(`${tag} ✓ ${file.path} -> ${outputPath} (${bytes.length} bytes)`);

      return {
        success: true,
        inputPath: file.path,
        outputPath,
        outputs: [outputPath],
        builder: 'tilemap',
        meta: {
          width: normalized.map.width,
          height: normalized.map.height,
          layerCount: normalized.layers.length,
          tilesetCount: normalized.tilesets.length,
          binarySize: bytes.length,
        },
      };
    } catch (error) {
      console.error(`${tag} ✗ ${file.path}: ${error.message}`);
      return {
        success: false,
        inputPath: file.path,
        error: error.message,
        builder: 'tilemap',
      };
    }
  }

  parseTilemapJson(content, path) {
    let parsed = null;
    if (typeof content === 'string') {
      parsed = JSON.parse(content);
    } else if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
      const bytes = content instanceof ArrayBuffer
        ? new Uint8Array(content)
        : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
      parsed = JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } else {
      throw new Error(`Unexpected tilemap content type in ${path}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`Invalid tilemap JSON object in ${path}`);
    }

    if (parsed.mapData && typeof parsed.mapData === 'object') {
      return parsed.mapData;
    }

    return parsed;
  }

  normalizeMap(mapData, filePath) {
    if (!mapData.map || !Array.isArray(mapData.layers) || !Array.isArray(mapData.tilesets)) {
      throw new Error('Tilemap JSON must include map, layers, and tilesets');
    }

    const map = {
      width: this.toU16(mapData.map.width, 'map.width'),
      height: this.toU16(mapData.map.height, 'map.height'),
      tileWidth: this.toU16(mapData.map.tileWidth, 'map.tileWidth'),
      tileHeight: this.toU16(mapData.map.tileHeight, 'map.tileHeight'),
      orientation: String(mapData.map.orientation || 'orthogonal').toLowerCase(),
    };

    const orientationCode = this.orientationToCode(map.orientation);

    const d2Paths = this.collectBuildD2OutputPaths();

    const strings = [];
    const stringToId = new Map();
    const pushString = (value) => {
      if (typeof value !== 'string' || value.length === 0) return 0xFFFF;
      if (stringToId.has(value)) return stringToId.get(value);
      const id = strings.length;
      strings.push(value);
      stringToId.set(value, id);
      return id;
    };

    const tilesets = mapData.tilesets
      .map((tsRaw) => this.normalizeTileset(tsRaw, filePath, d2Paths, pushString))
      .sort((a, b) => a.firstGid - b.firstGid);

    const layerCellCount = map.width * map.height;
    const layers = mapData.layers
      .filter((layer) => Array.isArray(layer?.data))
      .map((layerRaw) => {
        const data = new Uint32Array(layerCellCount);
        const src = layerRaw.data;
        for (let i = 0; i < layerCellCount; i++) {
          const value = Number(src[i] || 0);
          data[i] = this.toU32(value >>> 0, `layer[${layerRaw.name || '?'}].data[${i}]`);
        }
        const flags = (layerRaw.visible === false ? 0 : 1) | (layerRaw.locked ? 2 : 0);
        return {
          nameStrId: pushString(String(layerRaw.name || 'Layer')),
          flags,
          width: map.width,
          height: map.height,
          data,
        };
      });

    if (layers.length === 0) {
      throw new Error('Tilemap must contain at least one tile layer with data[]');
    }

    const wangSource = this.collectWangBlocks(mapData.tilesets);

    return {
      map,
      orientationCode,
      tilesets,
      layers,
      strings,
      wangSource,
    };
  }

  normalizeTileset(tsRaw, filePath, d2Paths, pushString) {
    const firstGid = this.toU32(Number(tsRaw.firstGid || 0), 'tileset.firstGid');
    const tileWidth = this.toU16(Number(tsRaw.tileWidth || tsRaw.tilewidth || 16), 'tileset.tileWidth');
    const tileHeight = this.toU16(Number(tsRaw.tileHeight || tsRaw.tileheight || 16), 'tileset.tileHeight');
    const columns = this.toU16(Number(tsRaw.columns || 0), 'tileset.columns');
    const tileCount = this.toU16(Number(tsRaw.tileCount || tsRaw.tilecount || 0), 'tileset.tileCount');
    const spacing = this.toU8(Number(tsRaw.spacing || 0), 'tileset.spacing');
    const margin = this.toU8(Number(tsRaw.margin || 0), 'tileset.margin');
    const name = String(tsRaw.name || 'tileset');

    const textureRefSource = this.getTilesetTextureRef(tsRaw, filePath);
    let textureBuildPath = '';
    let textureIndex = 0xFFFF;
    let flags = 0;

    if (textureRefSource) {
      textureBuildPath = this.toBuildPath(textureRefSource.replace(/\.(texture|png|jpg|jpeg|bmp|gif|webp|d2)$/i, '.d2'));
      textureIndex = d2Paths.indexOf(textureBuildPath);
      if (textureIndex < 0) {
        throw new Error(`Tileset '${name}' references texture '${textureRefSource}', but built texture '${textureBuildPath}' was not found. Build the texture or fix tileset texture reference.`);
      }
      flags |= 0x0001;
    }

    return {
      firstGid,
      tileWidth,
      tileHeight,
      columns,
      tileCount,
      spacing,
      margin,
      textureIndex,
      flags,
      nameStrId: pushString(name),
      texturePathStrId: textureBuildPath ? pushString(textureBuildPath) : 0xFFFF,
    };
  }

  getTilesetTextureRef(tsRaw, mapPath) {
    const candidates = [
      tsRaw.sourceTexturePath,
      tsRaw.texturePath,
      tsRaw.runtimeTexturePath,
      tsRaw.texture,
      tsRaw.image?.source,
      tsRaw.imageSource,
      tsRaw.imagePath,
    ];

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'string') continue;
      const normalized = candidate.replace(/\\/g, '/');
      if (window.ProjectPaths && typeof window.ProjectPaths.rebaseManagedPath === 'function') {
        return window.ProjectPaths.rebaseManagedPath(normalized, mapPath);
      }

      const slash = mapPath.lastIndexOf('/');
      return slash >= 0 ? `${mapPath.substring(0, slash + 1)}${normalized}` : normalized;
    }

    return '';
  }

  collectWangBlocks(tilesets) {
    const payload = [];
    for (const ts of tilesets || []) {
      if (!Array.isArray(ts?.retroWangBlocks) || ts.retroWangBlocks.length === 0) continue;
      payload.push({
        firstGid: Number(ts.firstGid || 0),
        blocks: ts.retroWangBlocks,
      });
    }
    return payload.length > 0 ? payload : null;
  }

  buildD2M(normalized) {
    const textEncoder = new TextEncoder();

    const headerSize = 40;
    const stringChunk = this.buildStringChunk(normalized.strings, textEncoder);
    const tilesetChunk = this.buildTilesetChunk(normalized.tilesets);
    // Layers are laid out immediately after the tileset chunk, and their cell
    // offsets are absolute, so the chunk needs its own file position up front.
    const layersFileOffset = headerSize + tilesetChunk.byteLength;
    const layerChunk = this.buildLayerChunk(normalized.layers, layersFileOffset);
    const wangChunk = this.buildWangChunk(normalized.wangSource, textEncoder);

    const totalSize = headerSize
      + tilesetChunk.byteLength
      + layerChunk.byteLength
      + stringChunk.byteLength
      + (wangChunk ? wangChunk.byteLength : 0);

    const out = new Uint8Array(totalSize);
    const view = new DataView(out.buffer);

    // Header
    out[0] = 0x44; // D
    out[1] = 0x32; // 2
    out[2] = 0x4D; // M
    out[3] = 0x50; // P
    out[4] = 1;    // format version
    out[5] = normalized.orientationCode;
    out[6] = 0; // flags
    out[7] = 0; // reserved

    view.setUint16(8, normalized.map.width, true);
    view.setUint16(10, normalized.map.height, true);
    view.setUint16(12, normalized.map.tileWidth, true);
    view.setUint16(14, normalized.map.tileHeight, true);
    view.setUint16(16, normalized.layers.length, true);
    view.setUint16(18, normalized.tilesets.length, true);
    view.setUint16(20, 0, true); // object layer count reserved for v2
    view.setUint16(22, 0, true);

    let offset = headerSize;

    view.setUint32(24, offset, true); // tilesets offset
    out.set(tilesetChunk, offset);
    offset += tilesetChunk.byteLength;

    view.setUint32(28, layersFileOffset, true); // layers offset
    out.set(layerChunk, layersFileOffset);
    offset = layersFileOffset + layerChunk.byteLength;

    view.setUint32(32, offset, true); // strings offset
    out.set(stringChunk, offset);
    offset += stringChunk.byteLength;

    view.setUint32(36, wangChunk ? offset : 0, true); // wang offset (0 = none)
    if (wangChunk) {
      out.set(wangChunk, offset);
    }

    return out;
  }

  buildTilesetChunk(tilesets) {
    const recordSize = 24;
    const bytes = new Uint8Array(4 + tilesets.length * recordSize);
    const view = new DataView(bytes.buffer);

    view.setUint16(0, this.toU16(tilesets.length, 'tileset count'), true);
    view.setUint16(2, recordSize, true);

    for (let i = 0; i < tilesets.length; i++) {
      const ts = tilesets[i];
      const base = 4 + i * recordSize;
      view.setUint32(base + 0, ts.firstGid, true);
      view.setUint16(base + 4, ts.tileWidth, true);
      view.setUint16(base + 6, ts.tileHeight, true);
      view.setUint16(base + 8, ts.columns, true);
      view.setUint16(base + 10, ts.tileCount, true);
      view.setUint16(base + 12, ts.textureIndex === 0xFFFF ? 0xFFFF : this.toU16(ts.textureIndex, 'tileset.textureIndex'), true);
      view.setUint16(base + 14, ts.flags, true);
      view.setUint8(base + 16, ts.spacing);
      view.setUint8(base + 17, ts.margin);
      view.setUint16(base + 18, ts.nameStrId, true);
      view.setUint16(base + 20, ts.texturePathStrId, true);
      view.setUint16(base + 22, 0, true);
    }

    return bytes;
  }

  /**
   * Cell data offsets in a layer record are absolute file offsets, per the D2M
   * spec, so the chunk has to know where it will be placed in the file. The
   * caller passes that in; writes into `bytes` stay chunk-local.
   */
  buildLayerChunk(layers, chunkFileOffset) {
    const layerRecordSize = 16;
    const recordsSize = 4 + layers.length * layerRecordSize;

    let tileDataBytes = 0;
    for (const layer of layers) {
      tileDataBytes += layer.data.length * 4;
    }

    const bytes = new Uint8Array(recordsSize + tileDataBytes);
    const view = new DataView(bytes.buffer);

    view.setUint16(0, this.toU16(layers.length, 'layer count'), true);
    view.setUint16(2, 0, true);

    let dataCursor = recordsSize;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const base = 4 + i * layerRecordSize;

      view.setUint16(base + 0, layer.nameStrId, true);
      view.setUint16(base + 2, this.toU16(layer.flags, 'layer.flags'), true);
      view.setUint16(base + 4, layer.width, true);
      view.setUint16(base + 6, layer.height, true);
      view.setUint32(base + 8, chunkFileOffset + dataCursor, true);
      view.setUint32(base + 12, layer.data.length * 4, true);

      for (let cell = 0; cell < layer.data.length; cell++) {
        view.setUint32(dataCursor + cell * 4, layer.data[cell], true);
      }

      dataCursor += layer.data.length * 4;
    }

    return bytes;
  }

  buildStringChunk(strings, encoder) {
    let total = 4;
    const encoded = strings.map((value) => {
      const bytes = encoder.encode(value);
      total += 4 + bytes.length;
      return bytes;
    });

    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    view.setUint16(0, this.toU16(strings.length, 'string count'), true);
    view.setUint16(2, 0, true);

    let cursor = 4;
    for (const bytes of encoded) {
      view.setUint16(cursor + 0, this.toU16(bytes.length, 'string length'), true);
      view.setUint16(cursor + 2, 0, true);
      out.set(bytes, cursor + 4);
      cursor += 4 + bytes.length;
    }

    return out;
  }

  buildWangChunk(wangSource, encoder) {
    if (!wangSource) return null;
    const json = JSON.stringify(wangSource);
    const payload = encoder.encode(json);
    const out = new Uint8Array(4 + payload.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, payload.length, true);
    out.set(payload, 4);
    return out;
  }

  collectBuildD2OutputPaths() {
    const buildSystem = window.serviceContainer?.get('buildSystem');
    if (!buildSystem || typeof buildSystem.getAllResourceFilePaths !== 'function') {
      throw new Error('BuildSystem is not available for tilemap texture indexing');
    }

    const resourceFilePaths = buildSystem.getAllResourceFilePaths();
    const textureBaseNames = new Set();
    const fontBaseNames = new Set();

    for (const filePath of resourceFilePaths) {
      const lower = filePath.toLowerCase();
      if (lower.endsWith('.texture')) {
        textureBaseNames.add(filePath.substring(0, filePath.length - '.texture'.length).toLowerCase());
      } else if (lower.endsWith('.font')) {
        fontBaseNames.add(filePath.substring(0, filePath.length - '.font'.length).toLowerCase());
      }
    }

    const d2Paths = [];
    for (const filePath of resourceFilePaths) {
      const lower = filePath.toLowerCase();
      if (lower.endsWith('.texture')) {
        d2Paths.push(this.toBuildPath(filePath.replace(/\.texture$/i, '.d2')));
        continue;
      }
      if (lower.endsWith('.font')) {
        d2Paths.push(this.toBuildPath(filePath.replace(/\.font$/i, '.d2')));
        continue;
      }
      if (lower.endsWith('.d2')) {
        const baseName = filePath.substring(0, filePath.length - '.d2'.length).toLowerCase();
        if (!textureBaseNames.has(baseName) && !fontBaseNames.has(baseName)) {
          d2Paths.push(this.toBuildPath(filePath));
        }
      }
    }

    return Array.from(new Set(d2Paths)).sort((left, right) => left.localeCompare(right));
  }

  orientationToCode(orientation) {
    switch (orientation) {
      case 'orthogonal': return 0;
      case 'isometric': return 1;
      case 'hexagonal': return 2;
      case 'staggered': return 3;
      default: return 0;
    }
  }

  toBuildPath(uiPath) {
    if (window.ProjectPaths && typeof window.ProjectPaths.toBuildOutputPath === 'function') {
      return window.ProjectPaths.toBuildOutputPath(uiPath);
    }
    return uiPath.replace(/^Resources\//, 'build/');
  }

  async saveBinary(outputPath, bytes) {
    const fileManager = window.serviceContainer?.get('fileManager');
    if (fileManager) {
      await fileManager.saveFile(outputPath, bytes.buffer, { binaryData: true });
      return;
    }

    if (window.fileIOService) {
      await window.fileIOService.saveFile(outputPath, bytes.buffer, { binaryData: true });
      return;
    }

    throw new Error('No file service available to save map build output');
  }

  toU8(value, field) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 0xFF) throw new Error(`Invalid ${field}: ${value}`);
    return n;
  }

  toU16(value, field) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 0xFFFF) throw new Error(`Invalid ${field}: ${value}`);
    return n;
  }

  toU32(value, field) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 0xFFFFFFFF) throw new Error(`Invalid ${field}: ${value}`);
    return n >>> 0;
  }
}

console.log('[TilemapBuilder] Class defined');

(function registerTilemapBuilder() {
  function tryRegister() {
    try {
      if (!window.serviceContainer || !window.serviceContainer.has('buildSystem')) {
        return false;
      }
      const buildSystem = window.serviceContainer.get('buildSystem');
      if (buildSystem) {
        const tb = new TilemapBuilder();
        buildSystem.registerBuilder('.tilemap', tb);
        buildSystem.registerBuilder('.tmj', tb);
        buildSystem.builderById.set('tilemap', tb);
        console.log('[TilemapBuilder] Registered with BuildSystem');
        return true;
      }
    } catch (_) {
      // Service not available yet — will retry
    }
    return false;
  }

  if (tryRegister()) return;

  if (window.serviceContainer) {
    window.serviceContainer.addEventListener('buildSystemReady', () => {
      tryRegister();
    });
  }

  let attempts = 0;
  const interval = setInterval(() => {
    if (tryRegister() || ++attempts > 100) {
      clearInterval(interval);
      if (attempts > 100) {
        console.warn('[TilemapBuilder] Gave up waiting for BuildSystem after 20s');
      }
    }
  }, 200);
})();
