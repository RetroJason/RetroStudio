// sprite.js - Sprite Lua Extensions for RetroStudio Emulator
// Implements Sprite.* Lua API backed by D2Sprite library (d2-sprite.js)
// and D2Canvas WebGL 2 GPU renderer (d2-canvas.js) for hardware-accurate rendering.
//
// Sprite instances are identified by opaque integer handles.
// Animation runs natively in the render loop — no per-frame Lua calls needed.
//
// Render pipeline per frame:
//   1. Tick auto-animating sprites (D2Sprite.updateAnimation)
//   2. For each visible sprite:
//      a. Get current D2F frame (x,y,w,h in texture atlas)
//      b. Resolve palette slot/offset → setPalette + setPaletteOffset on GPU
//      c. gpu.blit(texHandle, {srcX, srcY, srcW, srcH, x, y, scale, rotation})
//
// Category name = "Sprite" → Lua namespace = Sprite.Create(), Sprite.Play(), etc.
// Class name = LuaSpriteExtensions (Lua{CategoryName}Extensions convention)

class LuaSpriteExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;

    /** @type {Map<number, object>} handle → sprite runtime state */
    this.sprites = new Map();

    /** @type {number} Monotonic sprite handle allocator */
    this._nextHandle = 1;

    /** @type {Map<string, object>} name → { d2s, d2f } parsed binary cache */
    this.spriteAssets = new Map();

    /** @type {Map<number, object>} textureIndex → GPU texture handle (from D2Canvas.createTexture) */
    this.gpuTextures = new Map();

    /** @type {Uint8Array|null} Full PMAP palette data (all palettes concatenated as RGBA8) */
    this.pmapData = null;

    /** @type {Array<{offset:number, count:number}>} Per-palette entry: byte offset into pmapPalettes, color count */
    this.pmapEntries = [];

    /** @type {Uint8Array} 1024-byte RGBA8 palette currently uploaded to GPU */
    this.currentPalette = new Uint8Array(1024);

    /** @type {number} Currently active palette index on the GPU (-1 = none) */
    this._activePaletteIndex = -1;

    /** @type {number} Currently active palette offset on the GPU */
    this._activePaletteOffset = -1;

    /** @type {Set<number>} handles of sprites that are actively animating */
    this.animating = new Set();

    /** @type {D2Canvas|null} GPU renderer reference (set by initGpu) */
    this.gpu = null;
  }

  /**
   * Called by extension loader after construction.
   * Load all .d2s/.d2f from the build folder so Sprite.Create() can find them.
   */
  async initialize(luaState) {
    console.log('[LuaSprite] Initializing sprite system');
    this.luaState = luaState;
    await this._preloadSpriteAssets();
  }

  /**
   * Reset state (called on project reload / re-run).
   */
  reset() {
    this.sprites.clear();
    this.animating.clear();
    this._nextHandle = 1;
    this.gpuTextures.clear();
    this._activePaletteIndex = -1;
    this._activePaletteOffset = -1;
    this.gpu = null;
    // Keep spriteAssets, pmapData, pmapEntries cached across resets
    console.log('[LuaSprite] Sprite system reset');
  }

  /* ════════════════════════════════════════════════════════════════════
     Lua API — Lifecycle
     ════════════════════════════════════════════════════════════════════ */

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

  /** Resolve sprite state from a handle argument. */
  _getSpriteByHandleArg(args, index = 0) {
    const handle = this._requireHandleArg(args, index);
    if (handle === null) {
      throw new Error(`Sprite: bad argument #${index + 1} (valid sprite handle expected)`);
    }

    const sprite = this.sprites.get(handle) || null;
    if (!sprite) {
      throw new Error(`Sprite: bad argument #${index + 1} (unknown sprite handle ${handle})`);
    }

    return sprite;
  }

  /**
   * Sprite.Create("hero")
    * Loads a sprite by asset name (matches d2s_header_t.name).
    * Returns an opaque handle used by all Sprite.* instance calls.
   */
  Create(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const name = this._requireStringArg(args, 0, 'Sprite.Create', 'string');

    // Find the pre-loaded asset
    const asset = this.spriteAssets.get(name);
    if (!asset) {
      throw new Error(`Sprite.Create: asset not found: ${name}`);
    }

    // Create runtime state
    const state = D2Sprite.createSpriteState(asset.d2s, asset.d2f);

    // Set first animation as default if available
    if (asset.d2s.animations.length > 0) {
      D2Sprite.setAnimation(state, asset.d2s.animations[0].name);
    }

    // Default spawn position: place the first frame's rotation center
    // at the center of the RetroWatch display (448x368).
    this._setDefaultSpawnPosition(state);

    const handle = this._nextHandle++;
    state._handle = handle;
    state._assetName = name;
    state._z = null;
    state._creationOrder = this.gameEmulator?.allocateRenderOrder?.() ?? handle;

    this.sprites.set(handle, state);
    console.log(`[LuaSprite] Created sprite "${name}" as handle ${handle} (${asset.d2s.animations.length} anims, ${asset.d2f.frames.length} frames)`);
    return handle;
  }

  /**
   * Initialize sprite position so current frame pivot lands at display center.
   * Display center: (224, 184) for 448x368.
   */
  _setDefaultSpawnPosition(state) {
    const displayCenterX = 448 / 2;
    const displayCenterY = 368 / 2;

    const frame = D2Sprite.getCurrentFrame(state);
    if (!frame) {
      state._posX = displayCenterX;
      state._posY = displayCenterY;
      return;
    }

    const frameOffsetX = frame.offsetX ?? 0;
    const frameOffsetY = frame.offsetY ?? 0;

    // Use a frame-local pivot. Some legacy assets contain out-of-range center values.
    const { centerX: frameCenterX, centerY: frameCenterY } = this._resolveFrameCenter(frame);

    state._posX = displayCenterX - frameCenterX - frameOffsetX;
    state._posY = displayCenterY - frameCenterY - frameOffsetY;
  }

  /**
   * Resolve frame pivot in pixels, clamped to frame-local bounds.
   * Falls back to geometric center when source data is missing/invalid.
   */
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

  /**
   * Sprite.Destroy(handle)
   * Remove the sprite from the scene.
   */
  Destroy(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    this.sprites.delete(s._handle);
    this.animating.delete(s._handle);
  }

  /**
   * Sprite.Clone(handle)
   * Deep-clone a sprite instance and return a new handle.
   */
  Clone(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const src = this._getSpriteByHandleArg(args, 0);

    // Shallow-clone state (d2s/d2f are shared read-only data)
    const clone = { ...src };
    const handle = this._nextHandle++;
    clone._handle = handle;
    clone.x = 0;
    clone.y = 0;
    clone._motionBaseX = 0;
    clone._motionBaseY = 0;
    clone.elapsed = 0;
    clone.finished = false;
    clone._creationOrder = this.gameEmulator?.allocateRenderOrder?.() ?? handle;
    this.sprites.set(handle, clone);
    return handle;
  }

  /* ════════════════════════════════════════════════════════════════════
     Lua API — Position / Transform
     ════════════════════════════════════════════════════════════════════ */

  /**
   * Sprite.SetXY(handle, x, y)
   */
  SetXY(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    s._posX = Number.parseFloat(args[1]) || 0;
    s._posY = Number.parseFloat(args[2]) || 0;
  }

  /**
   * x, y = Sprite.GetXY(handle)
   */
  GetXY(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    return [s._posX || 0, s._posY || 0];
  }

  /** Sprite.SetZ(handle, z) */
  SetZ(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    const z = this._requireNumberArg(args, 1, 'Sprite.SetZ', 'number');
    s._z = z;
  }

  /** float = Sprite.GetZ(handle) */
  GetZ(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    return Number.isFinite(s._z) ? s._z : 0;
  }

  /** Sprite.SetXYZ(handle, x, y, z) */
  SetXYZ(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    const x = this._requireNumberArg(args, 1, 'Sprite.SetXYZ', 'number');
    const y = this._requireNumberArg(args, 2, 'Sprite.SetXYZ', 'number');
    const z = this._requireNumberArg(args, 3, 'Sprite.SetXYZ', 'number');
    s._posX = x;
    s._posY = y;
    s._z = z;
  }

  /**
   * Sprite.SetX(handle, x)
   */
  SetX(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    s._posX = Number.parseFloat(args[1]) || 0;
  }

  /** float = Sprite.GetX(handle) */
  GetX(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    return (s && s._posX) || 0;
  }

  /** Sprite.SetY(handle, y) */
  SetY(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    s._posY = Number.parseFloat(args[1]) || 0;
  }

  /** float = Sprite.GetY(handle) */
  GetY(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    return (s && s._posY) || 0;
  }

  /** Sprite.SetCenter(handle, cx, cy) */
  SetCenter(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    s._centerX = Number.parseFloat(args[1]) || 0;
    s._centerY = Number.parseFloat(args[2]) || 0;
  }

  /** cx, cy = Sprite.GetCenter(handle) */
  GetCenter(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    return [(s && s._centerX) || 0, (s && s._centerY) || 0];
  }

  /** Sprite.SetSize(handle, w, h) */
  SetSize(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    s._width = Number.parseFloat(args[1]) || 0;
    s._height = Number.parseFloat(args[2]) || 0;
  }

  /** w, h = Sprite.GetSize(handle) */
  GetSize(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    return [(s && s._width) || 0, (s && s._height) || 0];
  }

  /** Sprite.SetAngle(handle, angle) — degrees */
  SetAngle(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    s._rotation = Number.parseFloat(args[1]) || 0;
  }

  /** float = Sprite.GetAngle(handle) */
  GetAngle(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    return (s && s._rotation) || 0;
  }

  /** Sprite.SetScale(handle, sx, sy) */
  SetScale(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    const scaleX = this._requireNumberArg(args, 1, 'Sprite.SetScale', 'number');
    const scaleY = this._requireNumberArg(args, 2, 'Sprite.SetScale', 'number');
    s._scaleX = scaleX;
    s._scaleY = scaleY;
  }

  /** sx, sy = Sprite.GetScale(handle) */
  GetScale(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    return [(s && s._scaleX) ?? 1, (s && s._scaleY) ?? 1];
  }

  /** Sprite.SetColor(handle, 0x00FFFFFF) */
  SetColor(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    const color = this._requireIntegerArg(args, 1, 'Sprite.SetColor', 'integer');
    s._color = color;
  }

  /** int = Sprite.GetColor(handle) */
  GetColor(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    return (s && s._color) ?? 0x00FFFFFF;
  }

  /** Sprite.SetPaletteSlot(handle, 2) */
  SetPaletteSlot(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    s._paletteSlot = Number.parseInt(args[1], 10) || 0;
  }

  /** int = Sprite.GetPaletteSlot(handle) */
  GetPaletteSlot(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    return (s && s._paletteSlot) || 0;
  }

  /** Sprite.SetVisible(handle, true) */
  SetVisible(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    s._visible = this._requireBooleanArg(args, 1, 'Sprite.SetVisible', 'visible');
  }

  /** bool = Sprite.GetVisible(handle) */
  GetVisible(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    return s ? (s._visible !== false) : false;
  }

  /** Sprite.SetAttributes(handle, flags) */
  SetAttributes(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    s._attributes = Number.parseInt(args[1], 10) || 0;
  }

  /** int = Sprite.GetAttributes(handle) */
  GetAttributes(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    return (s && s._attributes) || 0;
  }

  /* ════════════════════════════════════════════════════════════════════
     Lua API — Animation
     ════════════════════════════════════════════════════════════════════ */

  /**
   * Sprite.SetAnimation(handle, "run")
   * Set the active animation by name. Does NOT auto-play.
   */
  SetAnimation(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    const animName = args[1];
    D2Sprite.setAnimation(s, animName);
  }

  /**
   * Sprite.Play(handle, "run")
   * Set animation and start native auto-tick (animation runs without Lua calls).
   * If animName is omitted, plays the current animation.
   */
  Play(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    const animName = args[1];
    if (animName) {
      D2Sprite.setAnimation(s, animName);
    }
    this.animating.add(s._handle);
  }

  /**
   * Sprite.Stop(handle)
   * Stop native animation (freeze on current frame).
   */
  Stop(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    this.animating.delete(s._handle);
  }

  /**
   * Sprite.UpdateAnimation(handle, dt)
   * Manual animation tick (for scripts that want frame-level control).
   * Equivalent to firmware's Sprite.UpdateAnimation.
   */
  UpdateAnimation(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const s = this._getSpriteByHandleArg(args, 0);
    const dt = Number.parseFloat(args[1]) || 0;
    D2Sprite.updateAnimation(s, dt * 1000); // Lua passes seconds, D2Sprite expects ms
  }

  /* ════════════════════════════════════════════════════════════════════
     Native render loop integration  (D2Canvas GPU pipeline)
     ════════════════════════════════════════════════════════════════════ */

  /**
   * One-time GPU initialisation called after D2Canvas is created.
   * Loads PMAP palette data and uploads D2 textures that sprites reference.
   *
   * @param {D2Canvas} gpu  The WebGL 2 renderer on the game canvas
   */
  async initGpu(gpu) {
    this.gpu = gpu;
    console.log('[LuaSprite] GPU init — loading palette map + textures');

    // ── 1. Load PMAP ────────────────────────────────────────────────
    await this._loadPaletteMap();

    // ── 2. Upload D2 textures referenced by loaded sprite assets ────
    await this._uploadSpriteTextures();

    // ── 3. Push first palette (index 1) if available ────────────────
    if (this.pmapEntries.length > 0) {
      this._activatePalette(1, 0);
    }
  }

  /**
   * Called by the game emulator's render loop each frame.
   * Ticks all auto-animating sprites and blits them via D2Canvas.
   *
   * Pipeline per visible sprite:
   *   1. Look up sprite state → get current D2F frame
   *   2. Resolve GPU texture handle from D2F header textureIndex
   *   3. If palette slot / offset differ from current GPU state → re-upload
   *   4. gpu.blit(texHandle, { srcX, srcY, srcW, srcH, x, y, … })
   *
   * @param {D2Canvas} gpu      The WebGL 2 renderer
   * @param {number}   deltaMs  Milliseconds since last frame
   */
  renderFrame(gpu, deltaMs, renderOptions = null) {
    // ── Tick all auto-animating sprites ─────────────────────────────
    for (const handle of this.animating) {
      const s = this.sprites.get(handle);
      if (s) D2Sprite.updateAnimation(s, deltaMs);
    }

    // ── Draw all visible sprites ────────────────────────────────────
    for (const [, s] of this.sprites) {
      if (s._visible === false) continue;

      const drawSprite = () => this._drawSprite(gpu, s);
      if (typeof renderOptions?.enqueue === 'function') {
        renderOptions.enqueue({
          type: 'sprite',
          z: Number.isFinite(s._z) ? s._z : null,
          defaultLayer: 2000,
          creationOrder: s._creationOrder ?? s._handle ?? 0,
          draw: drawSprite,
        });
      } else {
        drawSprite();
      }
    }
  }

  _drawSprite(gpu, s) {
    if (s._visible === false) return;

    const frame = D2Sprite.getCurrentFrame(s);
    if (!frame) return;

    // Resolve GPU texture
    const texIdx = s.d2f.header.textureIndex;
    const texHandle = this.gpuTextures.get(texIdx);
    if (!texHandle) return; // texture not uploaded yet

      // ── Palette management ──────────────────────────────────────
      // Per-frame palette overrides (0xFF = inherit from D2F header)
    const palSlot  = (frame.paletteSlot !== 0xFF)  ? frame.paletteSlot  : s.d2f.header.paletteSlot;
    const palOff   = (frame.palOffset   !== 0xFF)  ? frame.palOffset    : s.d2f.header.paletteOffset;
    // Runtime override from Lua (Sprite.SetPaletteSlot)
    const effectiveSlot   = (s._paletteSlot != null) ? s._paletteSlot : palSlot;
    const effectiveOffset = palOff;

      // Re-upload palette only when it changes
    const paletteIndex = texHandle.paletteIndex || effectiveSlot || 1;
    if (paletteIndex !== this._activePaletteIndex || effectiveOffset !== this._activePaletteOffset) {
      this._activatePalette(paletteIndex, effectiveOffset);
    }

      // ── Blit ────────────────────────────────────────────────────
    const posX = (s._posX || 0) + (s.x || 0) + (frame.offsetX || 0);
    const posY = (s._posY || 0) + (s.y || 0) + (frame.offsetY || 0);
    const rotation = s._rotation || 0;
    const scaleX = s._scaleX ?? 1;
    const scaleY = s._scaleY ?? 1;
    const flipX = !!(s._attributes & 0x08);
    const flipY = !!(s._attributes & 0x04);

    const frameCenter = this._resolveFrameCenter(frame);
    const centerX = Number.isFinite(s._centerX) ? s._centerX : frameCenter.centerX;
    const centerY = Number.isFinite(s._centerY) ? s._centerY : frameCenter.centerY;

    gpu.blit(texHandle, {
      x:      posX,
      y:      posY,
      srcX:   frame.x,
      srcY:   frame.y,
      srcW:   frame.w,
      srcH:   frame.h,
      scaleX: scaleX * (flipX ? -1 : 1),
      scaleY: scaleY * (flipY ? -1 : 1),
      rotation,
      pivotX: centerX / (frame.w || 1),
      pivotY: centerY / (frame.h || 1),
      filter: 'nearest',
    });
  }

  /* ════════════════════════════════════════════════════════════════════
     GPU helpers (palette + texture upload)
     ════════════════════════════════════════════════════════════════════ */

  /**
   * Switch the GPU palette to the given PMAP 1-based index + sub-palette offset.
   */
  _activatePalette(index, offset) {
    if (!this.gpu) return;
    if (index >= 1 && index <= this.pmapEntries.length) {
      const entry = this.pmapEntries[index - 1]; // 0-based array
      // Copy entry's RGBA data into the 1024-byte palette buffer
      this.currentPalette.fill(0);
      const src = this.pmapData.subarray(entry.offset, entry.offset + entry.count * 4);
      this.currentPalette.set(src.subarray(0, Math.min(src.length, 1024)));
      this.gpu.setPalette(this.currentPalette);
    }
    this.gpu.setPaletteOffset(offset);
    this._activePaletteIndex  = index;
    this._activePaletteOffset = offset;
  }

  /**
   * Load the PMAP binary from the build directory and parse it.
   */
  async _loadPaletteMap() {
    try {
      // PMAP is saved by the build system as "palette_map.pmap" in the build root
      const buildPrefix = this._buildPrefix();
      const pmapPath = buildPrefix + 'palette_map.pmap';
      const raw = await this._loadBinary(pmapPath);
      if (!raw) {
        console.warn('[LuaSprite] No PMAP found — palette rendering may fail');
        return;
      }

      const bytes = new Uint8Array(raw);
      if (bytes.length < 8) return;
      // Validate magic "PMAP"
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4D || bytes[2] !== 0x41 || bytes[3] !== 0x50) {
        console.warn('[LuaSprite] Invalid PMAP magic');
        return;
      }

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const count = view.getUint16(6, true);
      this.pmapEntries = [];
      let off = 8;
      // Build a single buffer with all palette RGBA data
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
      // Concatenate
      this.pmapData = new Uint8Array(accumOffset);
      let writeOff = 0;
      for (const chunk of allPalData) {
        this.pmapData.set(chunk, writeOff);
        writeOff += chunk.length;
      }

      console.log(`[LuaSprite] Loaded PMAP: ${count} palettes`);
    } catch (e) {
      console.error('[LuaSprite] PMAP load error:', e);
    }
  }

  /**
   * Upload .d2 texture files to the GPU for every unique textureIndex
   * referenced by the loaded sprite assets.
   */
  async _uploadSpriteTextures() {
    if (!this.gpu) return;

    // Collect unique texture indices from all loaded D2F headers
    const neededIndices = new Set();
    for (const [, asset] of this.spriteAssets) {
      neededIndices.add(asset.d2f.header.textureIndex);
    }

    // Scan build directory for .d2 files (textures)
    const buildPrefix = this._buildPrefix();
    const allFiles = await this._listBuildFiles(buildPrefix);
    const d2Files = allFiles
      .filter(p => p.toLowerCase().endsWith('.d2'))
      .sort((left, right) => left.localeCompare(right));

    // Load each .d2 and create GPU texture.
    // textureIndex is the zero-based sorted order of build .d2 paths.
    let idx = 0;
    for (const d2Path of d2Files) {
      try {
        const raw = await this._loadBinary(d2Path);
        if (!raw) continue;
        const d2Bytes = new Uint8Array(raw);
        // Validate D2TX magic
        if (d2Bytes.length < 32 ||
            d2Bytes[0] !== 0x44 || d2Bytes[1] !== 0x32 ||
            d2Bytes[2] !== 0x54 || d2Bytes[3] !== 0x58) {
          continue;
        }

        const texHandle = this.gpu.createTexture(d2Bytes);
        this.gpuTextures.set(idx, texHandle);
        console.log(`[LuaSprite] Uploaded GPU texture idx=${idx}: ${texHandle.width}×${texHandle.height} fmt=0x${texHandle.format.toString(16)} from ${d2Path}`);
        idx++;
      } catch (e) {
        throw new Error(`[LuaSprite] Failed to upload texture ${d2Path}: ${e.message}`);
      }
    }

    for (const textureIndex of neededIndices) {
      if (!this.gpuTextures.has(textureIndex)) {
        throw new Error(`[LuaSprite] Missing GPU texture for sprite texture index ${textureIndex}`);
      }
    }

    console.log(`[LuaSprite] ${this.gpuTextures.size} GPU textures ready`);
  }

  /* ════════════════════════════════════════════════════════════════════
     Asset loading (internal)
     ════════════════════════════════════════════════════════════════════ */

  _buildPrefix() {
    const pathResolver = this._getService('pathResolver');
    return pathResolver?.getBuildStoragePrefix?.() || 'build/';
  }

  /**
   * Pre-load all .d2s/.d2f from the build directory.
   */
  async _preloadSpriteAssets() {
    try {
      const buildPrefix = this._buildPrefix();

      const fileManager = this._getService('fileManager');
      if (!fileManager) {
        console.warn('[LuaSprite] FileManager not available — sprites will not load');
        return;
      }

      // Scan the build directory for .d2s files
      const allFiles = await this._listBuildFiles(buildPrefix);
      const d2sFiles = allFiles.filter(p => p.toLowerCase().endsWith('.d2s'));

      for (const d2sPath of d2sFiles) {
        try {
          const d2sContent = await this._loadBinary(d2sPath);
          if (!d2sContent) continue;

          const d2s = D2Sprite.parseD2S(new Uint8Array(d2sContent));

          // Load companion .d2f
          const d2fPath = d2sPath.replace(/\.d2s$/i, '.d2f');
          const d2fContent = await this._loadBinary(d2fPath);
          if (!d2fContent) {
            console.warn(`[LuaSprite] No .d2f found for ${d2sPath}`);
            continue;
          }
          const d2f = D2Sprite.parseD2F(new Uint8Array(d2fContent));

          // Key by filename stem (e.g. "NakedGuy" from "build/Sprites/NakedGuy.d2s")
          const spriteName = d2sPath.split('/').pop().replace(/\.d2s$/i, '');
          this.spriteAssets.set(spriteName, { d2s, d2f, d2sPath, d2fPath });
          console.log(`[LuaSprite] Loaded sprite asset: "${spriteName}" (${d2s.animations.length} anims, ${d2f.frames.length} frames)`);
        } catch (e) {
          console.error(`[LuaSprite] Failed to load sprite ${d2sPath}:`, e);
        }
      }

      console.log(`[LuaSprite] Pre-loaded ${this.spriteAssets.size} sprite assets`);
    } catch (e) {
      console.error('[LuaSprite] Failed to preload sprite assets:', e);
    }
  }

  /**
   * List all files under a storage prefix.
   */
  async _listBuildFiles(prefix) {
    const fileManager = this._getService('fileManager');
    if (!fileManager) return [];

    // Try fileManager.listFiles if available
    if (typeof fileManager.listFiles === 'function') {
      const results = await fileManager.listFiles(prefix);
      // listFiles may return IndexedDB record objects — normalise to path strings
      return results.map(r => (typeof r === 'string') ? r : (r.path || r.name || ''));
    }

    throw new Error('[LuaSprite] FileManager.listFiles() is required for sprite asset discovery');
  }

  _collectPaths(node, currentPath, buildRoot, prefix, out) {
    if (!node) return;
    for (const [name, child] of Object.entries(node)) {
      const path = currentPath ? `${currentPath}/${name}` : name;
      if (child && child.type === 'folder' && child.children) {
        this._collectPaths(child.children, path, buildRoot, prefix, out);
      } else if (child && child.type === 'file') {
        // Convert UI path to storage path
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
      // Might be base64
      try {
        const bin = atob(content);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr.buffer;
      } catch (e) {
        return null;
      }
    }
    return null;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LuaSpriteExtensions;
} else {
  window.LuaSpriteExtensions = LuaSpriteExtensions;
}
