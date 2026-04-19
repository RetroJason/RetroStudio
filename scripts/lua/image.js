// image.js - Image Lua Extensions for RetroStudio Emulator
// Provides Sprite-like rendering and transform APIs for static/multi-frame images.
// Images are sourced from build .d2 textures with optional companion .frameset data.

class LuaImageExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;

    /** @type {Map<number, object>} handle -> runtime image state */
    this.images = new Map();

    /** @type {number} Monotonic image handle allocator */
    this._nextHandle = 1;

    /** @type {Map<string, object>} image name -> asset metadata */
    this.imageAssets = new Map();

    /** @type {Map<string, object>} image name -> GPU texture handle */
    this.gpuTextures = new Map();

    /** @type {Uint8Array|null} Concatenated PMAP RGBA data */
    this.pmapData = null;

    /** @type {Array<{offset:number, count:number}>} PMAP entries */
    this.pmapEntries = [];

    /** @type {Uint8Array} Active GPU palette buffer (256 RGBA entries) */
    this.currentPalette = new Uint8Array(1024);

    /** @type {number} Active PMAP index on GPU (-1 = none) */
    this._activePaletteIndex = -1;

    /** @type {number} Active PMAP offset on GPU */
    this._activePaletteOffset = -1;

    /** @type {D2Canvas|null} GPU renderer */
    this.gpu = null;
  }

  async initialize(luaState) {
    console.log('[LuaImage] Initializing image system');
    this.luaState = luaState;
    await this._preloadImageAssets();
  }

  reset() {
    this.images.clear();
    this._nextHandle = 1;
    this.gpuTextures.clear();
    this._activePaletteIndex = -1;
    this._activePaletteOffset = -1;
    this.gpu = null;
    console.log('[LuaImage] Image system reset');
  }

  _getHandleArg(argIndex = 2) {
    const raw = this.luaState.raw_tostring(argIndex);
    if (raw === undefined || raw === null || raw === '') return null;
    const handle = parseInt(raw, 10);
    return Number.isFinite(handle) ? handle : null;
  }

  _getImageByHandleArg(argIndex = 2) {
    const handle = this._getHandleArg(argIndex);
    if (handle === null) {
      throw new Error(`Image: bad argument #${argIndex - 1} (valid image handle expected)`);
    }

    const image = this.images.get(handle) || null;
    if (!image) {
      throw new Error(`Image: bad argument #${argIndex - 1} (unknown image handle ${handle})`);
    }

    return image;
  }

  Create() {
    const L = this.luaState;
    const name = L.raw_tostring(2);
    if (!name) {
      throw new Error('Image.Create: bad argument #1 (string expected)');
    }

    const asset = this.imageAssets.get(name);
    if (!asset) {
      throw new Error(`Image.Create: asset not found: ${name}`);
    }

    const state = {
      _assetName: name,
      _frameIndex: 0,
      _posX: 0,
      _posY: 0,
      _centerX: 0,
      _centerY: 0,
      _hasCustomCenter: false,
      _width: 0,
      _height: 0,
      _rotation: 0,
      _scaleX: 1,
      _scaleY: 1,
      _color: 0x00FFFFFF,
      _paletteSlot: null,
      _visible: true,
      _attributes: 0,
    };

    this._setDefaultSpawnPosition(state, asset);

    const handle = this._nextHandle++;
    state._handle = handle;
    this.images.set(handle, state);

    console.log(`[LuaImage] Created image "${name}" as handle ${handle} (${asset.frames.length} frame(s))`);
    return handle;
  }

  _setDefaultSpawnPosition(state, asset) {
    const displayCenterX = 448 / 2;
    const displayCenterY = 368 / 2;

    const frame = this._getFrameForState(state, asset);
    if (!frame) {
      state._posX = displayCenterX;
      state._posY = displayCenterY;
      return;
    }

    const { centerX, centerY } = this._resolveFrameCenter(frame);
    state._posX = displayCenterX - centerX;
    state._posY = displayCenterY - centerY;
  }

  _resolveFrameCenter(frame) {
    const w = Math.max(0, Number(frame?.w) || 0);
    const h = Math.max(0, Number(frame?.h) || 0);

    const fallbackX = Math.round(w / 2);
    const fallbackY = Math.round(h / 2);

    const rawX = Number(frame?.centerX);
    const rawY = Number(frame?.centerY);

    const centerX = Number.isFinite(rawX) && rawX >= 0 && rawX <= w ? rawX : fallbackX;
    const centerY = Number.isFinite(rawY) && rawY >= 0 && rawY <= h ? rawY : fallbackY;

    return { centerX, centerY };
  }

  Destroy() {
    const s = this._getImageByHandleArg(2);
    this.images.delete(s._handle);
  }

  Clone() {
    const src = this._getImageByHandleArg(2);

    const clone = { ...src };
    const handle = this._nextHandle++;
    clone._handle = handle;
    this.images.set(handle, clone);
    return handle;
  }

  SetX() {
    const s = this._getImageByHandleArg(2);
    s._posX = parseFloat(this.luaState.raw_tostring(3)) || 0;
  }

  GetX() {
    const s = this._getImageByHandleArg(2);
    return (s && s._posX) || 0;
  }

  SetY() {
    const s = this._getImageByHandleArg(2);
    s._posY = parseFloat(this.luaState.raw_tostring(3)) || 0;
  }

  GetY() {
    const s = this._getImageByHandleArg(2);
    return (s && s._posY) || 0;
  }

  SetXY() {
    const L = this.luaState;
    const s = this._getImageByHandleArg(2);
    s._posX = parseFloat(L.raw_tostring(3)) || 0;
    s._posY = parseFloat(L.raw_tostring(4)) || 0;
  }

  GetXY() {
    const s = this._getImageByHandleArg(2);
    return [s._posX || 0, s._posY || 0];
  }

  SetCenter() {
    const L = this.luaState;
    const s = this._getImageByHandleArg(2);
    s._centerX = parseFloat(L.raw_tostring(3)) || 0;
    s._centerY = parseFloat(L.raw_tostring(4)) || 0;
    s._hasCustomCenter = true;
  }

  GetCenter() {
    const s = this._getImageByHandleArg(2);
    return [(s && s._centerX) || 0, (s && s._centerY) || 0];
  }

  SetSize() {
    const L = this.luaState;
    const s = this._getImageByHandleArg(2);
    s._width = parseFloat(L.raw_tostring(3)) || 0;
    s._height = parseFloat(L.raw_tostring(4)) || 0;
  }

  GetSize() {
    const s = this._getImageByHandleArg(2);
    return [(s && s._width) || 0, (s && s._height) || 0];
  }

  SetAngle() {
    const s = this._getImageByHandleArg(2);
    s._rotation = parseFloat(this.luaState.raw_tostring(3)) || 0;
  }

  GetAngle() {
    const s = this._getImageByHandleArg(2);
    return (s && s._rotation) || 0;
  }

  SetScale() {
    const L = this.luaState;
    const s = this._getImageByHandleArg(2);
    const scaleX = Number.parseFloat(L.raw_tostring(3));
    const scaleY = Number.parseFloat(L.raw_tostring(4));
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
      throw new Error('Image.SetScale: bad arguments #2/#3 (number expected)');
    }
    s._scaleX = scaleX;
    s._scaleY = scaleY;
  }

  GetScale() {
    const s = this._getImageByHandleArg(2);
    return [(s && s._scaleX) ?? 1, (s && s._scaleY) ?? 1];
  }

  SetColor() {
    const s = this._getImageByHandleArg(2);
    const color = Number(this.luaState.raw_tostring(3));
    if (!Number.isInteger(color)) {
      throw new Error('Image.SetColor: bad argument #2 (integer expected)');
    }
    s._color = color;
  }

  GetColor() {
    const s = this._getImageByHandleArg(2);
    return (s && s._color) ?? 0x00FFFFFF;
  }

  SetPaletteSlot() {
    const s = this._getImageByHandleArg(2);
    s._paletteSlot = parseInt(this.luaState.raw_tostring(3)) || 0;
  }

  GetPaletteSlot() {
    const s = this._getImageByHandleArg(2);
    return (s && s._paletteSlot) || 0;
  }

  SetVisible() {
    const s = this._getImageByHandleArg(2);
    s._visible = this._requireBooleanStackArg(3, 'Image.SetVisible', 'visible');
  }

  GetVisible() {
    const s = this._getImageByHandleArg(2);
    return s ? (s._visible !== false) : false;
  }

  SetAttributes() {
    const s = this._getImageByHandleArg(2);
    s._attributes = parseInt(this.luaState.raw_tostring(3)) || 0;
  }

  GetAttributes() {
    const s = this._getImageByHandleArg(2);
    return (s && s._attributes) || 0;
  }

  SetFrame() {
    const L = this.luaState;
    const s = this._getImageByHandleArg(2);

    const asset = this.imageAssets.get(s._assetName);
    if (!asset || asset.frames.length === 0) {
      throw new Error(`Image.SetFrame: no frames for asset ${s._assetName}`);
    }

    const index = parseInt(L.raw_tostring(3), 10);
    if (!Number.isFinite(index)) {
      throw new Error('Image.SetFrame: bad argument #2 (number expected)');
    }

    const clamped = Math.max(0, Math.min(asset.frames.length - 1, index));
    s._frameIndex = clamped;
  }

  GetFrame() {
    const s = this._getImageByHandleArg(2);
    return (s && Number.isFinite(s._frameIndex)) ? s._frameIndex : 0;
  }

  GetFrameCount() {
    const s = this._getImageByHandleArg(2);
    const asset = this.imageAssets.get(s._assetName);
    if (!asset) {
      throw new Error(`Image.GetFrameCount: asset not found for handle ${s._handle}`);
    }
    return asset.frames.length;
  }

  async initGpu(gpu) {
    this.gpu = gpu;
    console.log('[LuaImage] GPU init - loading palette map + textures');

    await this._loadPaletteMap();
    await this._uploadImageTextures();

    if (this.pmapEntries.length > 0) {
      this._activatePalette(1, 0);
    }
  }

  renderFrame(gpu, deltaMs) {
    for (const [, s] of this.images) {
      if (s._visible === false) continue;

      const asset = this.imageAssets.get(s._assetName);
      if (!asset) continue;

      const texHandle = this.gpuTextures.get(s._assetName);
      if (!texHandle) continue;

      const frame = this._getFrameForState(s, asset);
      if (!frame) continue;

      const paletteIndex = (s._paletteSlot != null && s._paletteSlot > 0)
        ? s._paletteSlot
        : (texHandle.paletteIndex || asset.paletteSlot || 1);
      const paletteOffset = asset.paletteOffset || 0;

      if (paletteIndex !== this._activePaletteIndex || paletteOffset !== this._activePaletteOffset) {
        this._activatePalette(paletteIndex, paletteOffset);
      }

      const posX = s._posX || 0;
      const posY = s._posY || 0;
      const rotation = s._rotation || 0;
      const scaleX = s._scaleX ?? 1;
      const scaleY = s._scaleY ?? 1;
      const flipX = !!(s._attributes & 0x08);
      const flipY = !!(s._attributes & 0x04);

      const resolvedCenter = this._resolveFrameCenter(frame);
      const centerX = s._hasCustomCenter ? s._centerX : resolvedCenter.centerX;
      const centerY = s._hasCustomCenter ? s._centerY : resolvedCenter.centerY;

      gpu.blit(texHandle, {
        x: posX,
        y: posY,
        srcX: frame.x,
        srcY: frame.y,
        srcW: frame.w,
        srcH: frame.h,
        scaleX: scaleX * (flipX ? -1 : 1),
        scaleY: scaleY * (flipY ? -1 : 1),
        rotation,
        pivotX: centerX / (frame.w || 1),
        pivotY: centerY / (frame.h || 1),
        filter: 'nearest',
      });
    }
  }

  _getFrameForState(state, asset) {
    if (!asset || !Array.isArray(asset.frames) || asset.frames.length === 0) return null;
    const idx = Number.isFinite(state?._frameIndex) ? state._frameIndex : 0;
    return asset.frames[Math.max(0, Math.min(asset.frames.length - 1, idx))] || null;
  }

  _activatePalette(index, offset) {
    if (!this.gpu) return;
    if (index >= 1 && index <= this.pmapEntries.length) {
      const entry = this.pmapEntries[index - 1];
      this.currentPalette.fill(0);
      const src = this.pmapData.subarray(entry.offset, entry.offset + entry.count * 4);
      this.currentPalette.set(src.subarray(0, Math.min(src.length, 1024)));
      this.gpu.setPalette(this.currentPalette);
    }
    this.gpu.setPaletteOffset(offset);
    this._activePaletteIndex = index;
    this._activePaletteOffset = offset;
  }

  async _loadPaletteMap() {
    try {
      const pmapPath = this._buildPrefix() + 'palette_map.pmap';
      const raw = await this._loadBinary(pmapPath);
      if (!raw) {
        console.warn('[LuaImage] No PMAP found - palette rendering may fail');
        return;
      }

      const bytes = new Uint8Array(raw);
      if (bytes.length < 8) return;
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4D || bytes[2] !== 0x41 || bytes[3] !== 0x50) {
        console.warn('[LuaImage] Invalid PMAP magic');
        return;
      }

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const count = view.getUint16(6, true);
      this.pmapEntries = [];
      let off = 8;
      const allPalData = [];
      let accumOffset = 0;

      for (let i = 0; i < count; i++) {
        const colorCount = view.getUint16(off, true);
        off += 2;
        const dataLen = colorCount * 4;
        this.pmapEntries.push({ offset: accumOffset, count: colorCount });
        allPalData.push(bytes.slice(off, off + dataLen));
        accumOffset += dataLen;
        off += dataLen;
      }

      this.pmapData = new Uint8Array(accumOffset);
      let writeOff = 0;
      for (const chunk of allPalData) {
        this.pmapData.set(chunk, writeOff);
        writeOff += chunk.length;
      }

      console.log(`[LuaImage] Loaded PMAP: ${count} palettes`);
    } catch (e) {
      console.error('[LuaImage] PMAP load error:', e);
    }
  }

  async _uploadImageTextures() {
    if (!this.gpu) return;

    for (const [assetName, asset] of this.imageAssets.entries()) {
      try {
        const raw = await this._loadBinary(asset.d2Path);
        if (!raw) continue;

        const d2Bytes = new Uint8Array(raw);
        if (d2Bytes.length < 32 || d2Bytes[0] !== 0x44 || d2Bytes[1] !== 0x32 || d2Bytes[2] !== 0x54 || d2Bytes[3] !== 0x58) {
          continue;
        }

        const texHandle = this.gpu.createTexture(d2Bytes);
        this.gpuTextures.set(assetName, texHandle);
        console.log(`[LuaImage] Uploaded GPU texture "${assetName}": ${texHandle.width}x${texHandle.height} from ${asset.d2Path}`);
      } catch (e) {
        console.error(`[LuaImage] Failed to upload texture ${asset.d2Path}:`, e);
      }
    }

    console.log(`[LuaImage] ${this.gpuTextures.size} GPU textures ready`);
  }

  async _preloadImageAssets() {
    try {
      const allFiles = await this._listBuildFiles(this._buildPrefix());
      const d2Files = allFiles.filter((p) => p.toLowerCase().endsWith('.d2'));

      for (const d2Path of d2Files) {
        try {
          const raw = await this._loadBinary(d2Path);
          if (!raw) continue;

          const d2Bytes = new Uint8Array(raw);
          const header = this._parseD2Header(d2Bytes);
          if (!header) continue;

          const imageName = d2Path.split('/').pop().replace(/\.d2$/i, '');
          const frames = await this._loadFramesForTexture(d2Path, header.width, header.height);

          this.imageAssets.set(imageName, {
            name: imageName,
            d2Path,
            width: header.width,
            height: header.height,
            paletteSlot: header.paletteSlot,
            paletteOffset: header.paletteOffset,
            frames,
          });

          console.log(`[LuaImage] Loaded image asset: "${imageName}" (${frames.length} frame(s))`);
        } catch (e) {
          console.error(`[LuaImage] Failed to preload image asset ${d2Path}:`, e);
        }
      }

      console.log(`[LuaImage] Pre-loaded ${this.imageAssets.size} image assets`);
    } catch (e) {
      console.error('[LuaImage] Failed to preload image assets:', e);
    }
  }

  _parseD2Header(d2Bytes) {
    if (!d2Bytes || d2Bytes.length < 32) return null;
    if (d2Bytes[0] !== 0x44 || d2Bytes[1] !== 0x32 || d2Bytes[2] !== 0x54 || d2Bytes[3] !== 0x58) {
      return null;
    }

    const view = new DataView(d2Bytes.buffer, d2Bytes.byteOffset, d2Bytes.byteLength);
    return {
      width: view.getUint16(6, true),
      height: view.getUint16(8, true),
      paletteSlot: view.getUint16(10, true),
      paletteOffset: d2Bytes[12] || 0,
    };
  }

  async _loadFramesForTexture(d2Path, texWidth, texHeight) {
    const fallback = [{ id: 0, name: 'frame_0', x: 0, y: 0, w: texWidth, h: texHeight }];

    const framesetStoragePath = this._toCompanionSourcePath(d2Path, '.frameset');
    if (!framesetStoragePath) return fallback;

    const frameset = await this._loadJson(framesetStoragePath);
    if (!frameset || !Array.isArray(frameset.frames) || frameset.frames.length === 0) {
      return fallback;
    }

    const out = [];
    for (let i = 0; i < frameset.frames.length; i++) {
      const src = frameset.frames[i] || {};
      const x = Math.max(0, parseInt(src.x, 10) || 0);
      const y = Math.max(0, parseInt(src.y, 10) || 0);
      const w = Math.max(1, parseInt(src.w, 10) || texWidth || 1);
      const h = Math.max(1, parseInt(src.h, 10) || texHeight || 1);
      out.push({
        id: Number.isFinite(src.id) ? src.id : i,
        name: src.name || `frame_${i}`,
        x,
        y,
        w,
        h,
      });
    }

    return out.length > 0 ? out : fallback;
  }

  _toCompanionSourcePath(buildPath, ext) {
    if (!buildPath || !ext) return null;

    const buildPrefix = this._buildPrefix();
    if (!buildPath.startsWith(buildPrefix)) return null;

    const rel = buildPath.substring(buildPrefix.length).replace(/\.d2$/i, ext);
    const sourcesRoot = (window.ProjectPaths && typeof window.ProjectPaths.getSourcesRootUi === 'function')
      ? window.ProjectPaths.getSourcesRootUi()
      : 'Sources';

    return `${sourcesRoot}/${rel}`;
  }

  _buildPrefix() {
    return (window.ProjectPaths && typeof window.ProjectPaths.getBuildStoragePrefix === 'function')
      ? window.ProjectPaths.getBuildStoragePrefix()
      : 'build/';
  }

  async _listBuildFiles(prefix) {
    const fileManager = window.serviceContainer?.get('fileManager');
    if (!fileManager) return [];

    if (typeof fileManager.listFiles === 'function') {
      const results = await fileManager.listFiles(prefix);
      return results.map((r) => (typeof r === 'string') ? r : (r.path || r.name || ''));
    }

    const projectExplorer = window.serviceContainer?.get('projectExplorer');
    if (!projectExplorer) return [];

    const paths = [];
    const buildRoot = (window.ProjectPaths && typeof window.ProjectPaths.getBuildRootUi === 'function')
      ? window.ProjectPaths.getBuildRootUi()
      : 'Game Objects';

    this._collectPaths(projectExplorer.projectData?.structure, '', buildRoot, prefix, paths);
    return paths;
  }

  _collectPaths(node, currentPath, buildRoot, prefix, out) {
    if (!node) return;
    for (const [name, child] of Object.entries(node)) {
      const path = currentPath ? `${currentPath}/${name}` : name;
      if (child && child.type === 'folder' && child.children) {
        this._collectPaths(child.children, path, buildRoot, prefix, out);
      } else if (child && child.type === 'file') {
        const storagePath = prefix + path.replace(new RegExp(`^${buildRoot}/`), '');
        out.push(storagePath);
      }
    }
  }

  async _loadBinary(path) {
    const fileManager = window.serviceContainer?.get('fileManager');
    if (!fileManager) return null;

    const normPath = (window.ProjectPaths && typeof window.ProjectPaths.normalizeStoragePath === 'function')
      ? window.ProjectPaths.normalizeStoragePath(path)
      : path;

    const obj = await fileManager.loadFile(normPath);
    if (!obj) return null;

    const content = obj.content ?? obj.fileContent ?? obj.data;
    if (content instanceof ArrayBuffer) return content;
    if (ArrayBuffer.isView(content)) return content.buffer;
    if (typeof content === 'string') {
      try {
        const bin = atob(content);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr.buffer;
      } catch (_) {
        return null;
      }
    }

    return null;
  }

  async _loadJson(path) {
    const fileManager = window.serviceContainer?.get('fileManager');
    if (!fileManager) return null;

    const normPath = (window.ProjectPaths && typeof window.ProjectPaths.normalizeStoragePath === 'function')
      ? window.ProjectPaths.normalizeStoragePath(path)
      : path;

    const obj = await fileManager.loadFile(normPath);
    if (!obj) return null;

    const content = obj.content ?? obj.fileContent ?? obj.data;

    if (typeof content === 'string') {
      try {
        return JSON.parse(content);
      } catch (_) {
        return null;
      }
    }

    if (content && typeof content === 'object' && !(content instanceof ArrayBuffer) && !ArrayBuffer.isView(content)) {
      return content;
    }

    if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
      try {
        const bytes = content instanceof ArrayBuffer ? new Uint8Array(content) : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
        const text = new TextDecoder().decode(bytes);
        return JSON.parse(text);
      } catch (_) {
        return null;
      }
    }

    return null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LuaImageExtensions;
} else {
  window.LuaImageExtensions = LuaImageExtensions;
}
