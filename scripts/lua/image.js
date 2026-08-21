// image.js - Image Lua Extensions for RetroStudio Emulator
// Provides Sprite-like rendering and transform APIs for static/multi-frame images.
// Images are sourced from build .d2 textures with optional companion .d2fs frame data.

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

  _normalizeLuaArgs(argsLike) {
    const args = Array.from(argsLike || []);
    const hasBridgeReceiver = args.length > 1
      && (args[0] === null
      || args[0] === undefined
      || (typeof args[0] === 'object' && args[0] !== null));
    if (hasBridgeReceiver) {
      return args.slice(1);
    }
    return args;
  }

  _requireStringArg(args, index, methodName, argName) {
    const raw = args[index];
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new Error(`${methodName}: bad argument #${index + 1} (${argName} expected)`);
    }
    return raw;
  }

  _requireNumberArg(args, index, methodName, argName) {
    const value = Number.parseFloat(args[index]);
    if (!Number.isFinite(value)) {
      throw new Error(`${methodName}: bad argument #${index + 1} (${argName} expected)`);
    }
    return value;
  }

  _requireIntegerArg(args, index, methodName, argName) {
    const value = Number.parseInt(args[index], 10);
    if (!Number.isFinite(value)) {
      throw new Error(`${methodName}: bad argument #${index + 1} (${argName} expected)`);
    }
    return value;
  }

  _requireBooleanArg(args, index, methodName, argName) {
    return this._coerceBooleanArg(args[index], methodName, argName);
  }

  _requireHandleArg(args, index = 0) {
    const handle = Number.parseInt(args[index], 10);
    return Number.isFinite(handle) ? handle : null;
  }

  _getImageByHandleArg(args, index = 0) {
    const handle = this._requireHandleArg(args, index);
    if (handle === null) {
      throw new Error(`Image: bad argument #${index + 1} (valid image handle expected)`);
    }

    const image = this.images.get(handle) || null;
    if (!image) {
      throw new Error(`Image: bad argument #${index + 1} (unknown image handle ${handle})`);
    }

    return image;
  }

  Create(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const name = this._requireStringArg(args, 0, 'Image.Create', 'string');

    const asset = this.imageAssets.get(name);
    if (!asset) {
      throw new Error(`Image.Create: asset not found: ${name}`);
    }

    const state = {
      _assetName: name,
      _frameIndex: 0,
      _posX: 0,
      _posY: 0,
      _z: null,
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
    state._creationOrder = this.gameEmulator?.allocateRenderOrder?.() ?? handle;
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

    const { centerX, centerY } = this._resolveFrameCenter(frame, asset);
    state._posX = displayCenterX - centerX;
    state._posY = displayCenterY - centerY;
  }

  _resolveFrameCenter(frame, asset = null) {
    const w = Math.max(0, Number(frame?.w) || 0);
    const h = Math.max(0, Number(frame?.h) || 0);

    const fallbackX = Math.round(w / 2);
    const fallbackY = Math.round(h / 2);

    const rawX = Number(frame?.centerX);
    const rawY = Number(frame?.centerY);

    const hasExplicitCenterX = Number.isFinite(rawX) && rawX >= 0 && rawX <= w;
    const hasExplicitCenterY = Number.isFinite(rawY) && rawY >= 0 && rawY <= h;

    if (hasExplicitCenterX || hasExplicitCenterY) {
      return {
        centerX: hasExplicitCenterX ? rawX : fallbackX,
        centerY: hasExplicitCenterY ? rawY : fallbackY,
      };
    }

    return { centerX: fallbackX, centerY: fallbackY };
  }

  Destroy(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    this.images.delete(s._handle);
  }

  Clone(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const src = this._getImageByHandleArg(args, 0);

    const clone = { ...src };
    const handle = this._nextHandle++;
    clone._handle = handle;
    clone._creationOrder = this.gameEmulator?.allocateRenderOrder?.() ?? handle;
    this.images.set(handle, clone);
    return handle;
  }

  SetX(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    s._posX = Number.parseFloat(args[1]) || 0;
  }

  GetX(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    return (s && s._posX) || 0;
  }

  SetY(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    s._posY = Number.parseFloat(args[1]) || 0;
  }

  GetY(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    return (s && s._posY) || 0;
  }

  SetXY(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    s._posX = Number.parseFloat(args[1]) || 0;
    s._posY = Number.parseFloat(args[2]) || 0;
  }

  GetXY(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    return [s._posX || 0, s._posY || 0];
  }

  SetZ(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    const z = this._requireNumberArg(args, 1, 'Image.SetZ', 'number');
    s._z = z;
  }

  GetZ(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    return Number.isFinite(s._z) ? s._z : 0;
  }

  SetXYZ(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    const x = this._requireNumberArg(args, 1, 'Image.SetXYZ', 'number');
    const y = this._requireNumberArg(args, 2, 'Image.SetXYZ', 'number');
    const z = this._requireNumberArg(args, 3, 'Image.SetXYZ', 'number');
    s._posX = x;
    s._posY = y;
    s._z = z;
  }

  SetCenter(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    s._centerX = Number.parseFloat(args[1]) || 0;
    s._centerY = Number.parseFloat(args[2]) || 0;
    s._hasCustomCenter = true;
  }

  GetCenter(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    return [(s && s._centerX) || 0, (s && s._centerY) || 0];
  }

  SetSize(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    s._width = Number.parseFloat(args[1]) || 0;
    s._height = Number.parseFloat(args[2]) || 0;
  }

  GetSize(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    if (!s) return [0, 0];

    // Create() does not know the display size, so _width/_height stay 0 until
    // SetSize is called. Fall back to the current frame's real dimensions so a
    // freshly created image reports its actual size instead of 0, 0.
    if (!s._width && !s._height) {
      const frame = this._getFrameForState(s, this.imageAssets.get(s._assetName));
      if (frame) return [Number(frame.w) || 0, Number(frame.h) || 0];
    }

    return [s._width || 0, s._height || 0];
  }

  SetAngle(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    s._rotation = Number.parseFloat(args[1]) || 0;
  }

  GetAngle(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    return (s && s._rotation) || 0;
  }

  SetScale(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    const scaleX = this._requireNumberArg(args, 1, 'Image.SetScale', 'number');
    const scaleY = this._requireNumberArg(args, 2, 'Image.SetScale', 'number');
    s._scaleX = scaleX;
    s._scaleY = scaleY;
  }

  GetScale(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    return [(s && s._scaleX) ?? 1, (s && s._scaleY) ?? 1];
  }

  SetColor(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    const color = this._requireIntegerArg(args, 1, 'Image.SetColor', 'integer');
    s._color = color;
  }

  GetColor(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    return (s && s._color) ?? 0x00FFFFFF;
  }

  SetPaletteSlot(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    s._paletteSlot = Number.parseInt(args[1], 10) || 0;
  }

  GetPaletteSlot(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    return (s && s._paletteSlot) || 0;
  }

  SetVisible(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    s._visible = this._requireBooleanArg(args, 1, 'Image.SetVisible', 'visible');
  }

  GetVisible(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    return s ? (s._visible !== false) : false;
  }

  SetAttributes(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    s._attributes = Number.parseInt(args[1], 10) || 0;
  }

  GetAttributes(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    return (s && s._attributes) || 0;
  }

  SetFrame(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);

    const asset = this.imageAssets.get(s._assetName);
    if (!asset || asset.frames.length === 0) {
      throw new Error(`Image.SetFrame: no frames for asset ${s._assetName}`);
    }

    const index = this._requireIntegerArg(args, 1, 'Image.SetFrame', 'number');

    const clamped = Math.max(0, Math.min(asset.frames.length - 1, index));
    s._frameIndex = clamped;
  }

  GetFrame(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
    return (s && Number.isFinite(s._frameIndex)) ? s._frameIndex : 0;
  }

  GetFrameCount(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getImageByHandleArg(args, 0);
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

  renderFrame(gpu, deltaMs, renderOptions = null) {
    for (const [, s] of this.images) {
      if (s._visible === false) continue;

      const drawImage = () => this._drawImage(gpu, s);
      if (typeof renderOptions?.enqueue === 'function') {
        renderOptions.enqueue({
          type: 'image',
          z: Number.isFinite(s._z) ? s._z : null,
          defaultLayer: 1000,
          creationOrder: s._creationOrder ?? s._handle ?? 0,
          draw: drawImage,
        });
      } else {
        drawImage();
      }
    }
  }

  _drawImage(gpu, s) {
    if (s._visible === false) return;

    const asset = this.imageAssets.get(s._assetName);
    if (!asset) return;

    const texHandle = this.gpuTextures.get(s._assetName);
    if (!texHandle) return;

    const frame = this._getFrameForState(s, asset);
    if (!frame) return;

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

    const resolvedCenter = this._resolveFrameCenter(frame, asset);
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
          const frames = await this._loadFramesForTexture(d2Path, header.width, header.height, header.flags);

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
      flags: d2Bytes[13] || 0,
    };
  }

  async _loadFramesForTexture(d2Path, texWidth, texHeight, flags = 0) {
    const preRotated = !!(flags & 0x02);
    const logicalWidth = preRotated ? texHeight : texWidth;
    const logicalHeight = preRotated ? texWidth : texHeight;
    const fallback = [{ id: 0, name: 'frame_0', x: 0, y: 0, w: logicalWidth, h: logicalHeight, centerX: Math.round((logicalWidth || 0) / 2), centerY: Math.round((logicalHeight || 0) / 2) }];

    const d2fsPath = d2Path.replace(/\.d2$/i, '.d2fs');
    const d2fsRaw = await this._loadBinary(d2fsPath);
    if (d2fsRaw) {
      const frames = this._parseD2FS(new Uint8Array(d2fsRaw), d2fsPath);
      if (frames.length === 0) {
        throw new Error(`D2FS has no frames: ${d2fsPath}`);
      }
      return frames;
    }

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
      const rawCenterX = Number(src.centerX);
      const rawCenterY = Number(src.centerY);
      out.push({
        id: Number.isFinite(src.id) ? src.id : i,
        name: src.name || `frame_${i}`,
        x,
        y,
        w,
        h,
        centerX: Number.isFinite(rawCenterX) ? rawCenterX : Math.round(w / 2),
        centerY: Number.isFinite(rawCenterY) ? rawCenterY : Math.round(h / 2),
      });
    }

    return out.length > 0 ? out : fallback;
  }

  _parseD2FS(bytes, path) {
    if (!bytes || bytes.length < 16) {
      throw new Error(`D2FS too small: ${path}`);
    }

    if (bytes[0] !== 0x44 || bytes[1] !== 0x32 || bytes[2] !== 0x46 || bytes[3] !== 0x53) {
      throw new Error(`Invalid D2FS magic: ${path}`);
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint8(4);
    if (version !== 1) {
      throw new Error(`Unsupported D2FS version ${version}: ${path}`);
    }

    const frameCount = view.getUint16(6, true);
    const frameSize = view.getUint16(12, true);
    if (frameSize !== 16) {
      throw new Error(`Unsupported D2FS frame size ${frameSize}: ${path}`);
    }

    const expectedLength = 16 + frameCount * frameSize;
    if (bytes.length < expectedLength) {
      throw new Error(`Truncated D2FS ${path}: expected ${expectedLength} bytes, got ${bytes.length}`);
    }

    const frames = [];
    for (let index = 0; index < frameCount; index++) {
      const offset = 16 + index * frameSize;
      const flags = view.getUint8(offset + 14);
      const frame = {
        id: view.getUint16(offset + 0, true),
        name: `frame_${index}`,
        x: view.getUint16(offset + 2, true),
        y: view.getUint16(offset + 4, true),
        w: view.getUint16(offset + 6, true),
        h: view.getUint16(offset + 8, true),
      };

      if (flags & 0x01) {
        frame.centerX = view.getInt16(offset + 10, true);
      }
      if (flags & 0x02) {
        frame.centerY = view.getInt16(offset + 12, true);
      }

      frames.push(frame);
    }

    return frames;
  }

  _toCompanionSourcePath(buildPath, ext) {
    if (!buildPath || !ext) return null;

    const pathResolver = this._getService('pathResolver');
    return pathResolver?.resolveCompanionAssetPath?.(buildPath, ext) || null;
  }

  _buildPrefix() {
    const pathResolver = this._getService('pathResolver');
    return pathResolver?.getBuildStoragePrefix?.() || 'build/';
  }

  async _listBuildFiles(prefix) {
    const fileManager = this._getService('fileManager');
    if (!fileManager) return [];

    if (typeof fileManager.listFiles === 'function') {
      const results = await fileManager.listFiles(prefix);
      return results.map((r) => (typeof r === 'string') ? r : (r.path || r.name || ''));
    }

    throw new Error('[LuaImage] FileManager.listFiles() is required for image asset discovery');
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
    const fileManager = this._getService('fileManager');
    if (!fileManager) return null;

    const pathResolver = this._getService('pathResolver');
    const normPath = pathResolver?.normalizeStoragePath?.(path) || path;

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
    const fileManager = this._getService('fileManager');
    if (!fileManager) return null;

    const pathResolver = this._getService('pathResolver');
    const normPath = pathResolver?.normalizeStoragePath?.(path) || path;

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
