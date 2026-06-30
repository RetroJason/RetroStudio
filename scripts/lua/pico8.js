// pico8.js - Pico-8 API Compatibility Layer for RetroStudio
// Provides full pico-8 Lua API compatibility for games targeting pico-8 style development

class LuaPico8Extensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
    this.currentColor = 0;
    this.currentPalette = new Map();
    this.randomSeed = 0;
    this.spriteFlags = new Map();

    // Pico-8 fallback framebuffer (used when no spriteEngine is available).
    this._fbWidth = 128;
    this._fbHeight = 128;
    this._framebuffer = new Uint8Array(this._fbWidth * this._fbHeight);
    this._clipRect = { x: 0, y: 0, w: this._fbWidth, h: this._fbHeight };
    this._cameraX = 0;
    this._cameraY = 0;
    this._dirty = true;
    this._gpu = null;
    this._fbTexture = null;
    this._paletteRGBA = this._buildPicoPaletteRGBA();
  }

  initGpu(gpu) {
    this._gpu = gpu;
    this._fbTexture = null;
    this._dirty = true;
    this.resetRuntimeState();
  }

  resetRuntimeState() {
    this.currentColor = 0;
    this._cameraX = 0;
    this._cameraY = 0;
    this._clipRect = { x: 0, y: 0, w: this._fbWidth, h: this._fbHeight };
    this._clearFb(0);
  }

  _buildPicoPaletteRGBA() {
    const palette = new Uint8Array(1024);
    const pico16 = [
      [0, 0, 0],
      [29, 43, 83],
      [126, 37, 83],
      [0, 135, 81],
      [171, 82, 54],
      [95, 87, 79],
      [194, 195, 199],
      [255, 241, 232],
      [255, 0, 77],
      [255, 163, 0],
      [255, 236, 39],
      [0, 228, 54],
      [41, 173, 255],
      [131, 118, 156],
      [255, 119, 168],
      [255, 204, 170],
    ];

    for (let i = 0; i < 256; i += 1) {
      const p = pico16[i & 0x0f];
      const o = i * 4;
      palette[o] = p[0];
      palette[o + 1] = p[1];
      palette[o + 2] = p[2];
      palette[o + 3] = 255;
    }
    return palette;
  }

  _getFallbackEngine() {
    return {
      setPixel: (x, y, c) => {
        this._plot(x, y, c, false);
      },
      getPixel: (x, y) => this._readPixel(x, y),
      line: (x0, y0, x1, y1, c) => this._lineToFb(x0, y0, x1, y1, c),
      rect: (x0, y0, x1, y1, c) => this._rectToFb(x0, y0, x1, y1, c),
      rectfill: (x0, y0, x1, y1, c) => this._rectFillToFb(x0, y0, x1, y1, c),
      circ: (x, y, r, c) => this._circToFb(x, y, r, c),
      circfill: (x, y, r, c) => this._circFillToFb(x, y, r, c),
      clear: (c) => this._clearFb(c),
      setCamera: (x, y) => {
        this._cameraX = x | 0;
        this._cameraY = y | 0;
      },
      setClip: (x, y, w, h) => {
        this._clipRect = {
          x: x | 0,
          y: y | 0,
          w: Math.max(0, w | 0),
          h: Math.max(0, h | 0),
        };
      },
    };
  }

  _getEngine() {
    // Use Pico framebuffer primitives consistently to match Pico-8 coordinates.
    // Sprite engine integration remains available for non-primitive APIs.
    return this._getFallbackEngine();
  }

  _markDirty() {
    this._dirty = true;
  }

  _inClip(x, y) {
    return x >= this._clipRect.x
      && y >= this._clipRect.y
      && x < (this._clipRect.x + this._clipRect.w)
      && y < (this._clipRect.y + this._clipRect.h);
  }

  _inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this._fbWidth && y < this._fbHeight;
  }

  _plot(x, y, c, useCamera = true) {
    const drawX = (x | 0) - (useCamera ? this._cameraX : 0);
    const drawY = (y | 0) - (useCamera ? this._cameraY : 0);
    if (!this._inBounds(drawX, drawY) || !this._inClip(drawX, drawY)) {
      return;
    }
    this._framebuffer[drawY * this._fbWidth + drawX] = c & 0xff;
    this._markDirty();
  }

  _readPixel(x, y) {
    const px = x | 0;
    const py = y | 0;
    if (!this._inBounds(px, py)) {
      return 0;
    }
    return this._framebuffer[py * this._fbWidth + px] || 0;
  }

  _lineToFb(x0, y0, x1, y1, c) {
    let ax = (x0 | 0) - this._cameraX;
    let ay = (y0 | 0) - this._cameraY;
    const bx = (x1 | 0) - this._cameraX;
    const by = (y1 | 0) - this._cameraY;

    const dx = Math.abs(bx - ax);
    const sx = ax < bx ? 1 : -1;
    const dy = -Math.abs(by - ay);
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;

    while (true) {
      this._plot(ax, ay, c, false);
      if (ax === bx && ay === by) {
        break;
      }
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
  }

  _rectToFb(x0, y0, x1, y1, c) {
    const ax = Math.min(x0, x1) | 0;
    const ay = Math.min(y0, y1) | 0;
    const bx = Math.max(x0, x1) | 0;
    const by = Math.max(y0, y1) | 0;
    this._lineToFb(ax, ay, bx, ay, c);
    this._lineToFb(ax, by, bx, by, c);
    this._lineToFb(ax, ay, ax, by, c);
    this._lineToFb(bx, ay, bx, by, c);
  }

  _rectFillToFb(x0, y0, x1, y1, c) {
    const ax = Math.min(x0, x1) | 0;
    const ay = Math.min(y0, y1) | 0;
    const bx = Math.max(x0, x1) | 0;
    const by = Math.max(y0, y1) | 0;
    for (let y = ay; y <= by; y += 1) {
      this._lineToFb(ax, y, bx, y, c);
    }
  }

  _circToFb(x, y, r, c) {
    const cx = (x | 0) - this._cameraX;
    const cy = (y | 0) - this._cameraY;
    let dx = Math.max(0, r | 0);
    let dy = 0;
    let err = 1 - dx;

    while (dx >= dy) {
      this._plot(cx + dx, cy + dy, c, false);
      this._plot(cx + dy, cy + dx, c, false);
      this._plot(cx - dy, cy + dx, c, false);
      this._plot(cx - dx, cy + dy, c, false);
      this._plot(cx - dx, cy - dy, c, false);
      this._plot(cx - dy, cy - dx, c, false);
      this._plot(cx + dy, cy - dx, c, false);
      this._plot(cx + dx, cy - dy, c, false);
      dy += 1;
      if (err < 0) {
        err += 2 * dy + 1;
      } else {
        dx -= 1;
        err += 2 * (dy - dx) + 1;
      }
    }
  }

  _circFillToFb(x, y, r, c) {
    const cx = (x | 0) - this._cameraX;
    const cy = (y | 0) - this._cameraY;
    let dx = Math.max(0, r | 0);
    let dy = 0;
    let err = 1 - dx;

    while (dx >= dy) {
      this._lineToFb(cx - dx, cy + dy, cx + dx, cy + dy, c);
      this._lineToFb(cx - dx, cy - dy, cx + dx, cy - dy, c);
      this._lineToFb(cx - dy, cy + dx, cx + dy, cy + dx, c);
      this._lineToFb(cx - dy, cy - dx, cx + dy, cy - dx, c);
      dy += 1;
      if (err < 0) {
        err += 2 * dy + 1;
      } else {
        dx -= 1;
        err += 2 * (dy - dx) + 1;
      }
    }
  }

  _clearFb(color) {
    this._framebuffer.fill(color & 0xff);
    this._markDirty();
  }

  _ensureFramebufferTexture(gpu) {
    if (!gpu) {
      return;
    }
    if (this._fbTexture && this._dirty) {
      gpu.deleteTexture(this._fbTexture);
      this._fbTexture = null;
    }
    if (!this._fbTexture) {
      this._fbTexture = gpu.createTextureRaw(this._framebuffer, this._fbWidth, this._fbHeight, 0x09);
      this._dirty = false;
    }
  }

  renderFrame(gpu, deltaMs, renderOptions = null) {
    const activeGpu = gpu || this._gpu;
    if (!activeGpu) {
      return;
    }

    const drawFramebuffer = () => {
      this._ensureFramebufferTexture(activeGpu);
      if (!this._fbTexture) {
        return;
      }
      activeGpu.setPalette(this._paletteRGBA);
      activeGpu.setPaletteOffset(0);
      const canvasWidth = activeGpu?.canvas?.width || 448;
      const canvasHeight = activeGpu?.canvas?.height || 368;
      const scale = Math.min(canvasWidth / this._fbWidth, canvasHeight / this._fbHeight);
      const drawW = this._fbWidth * scale;
      const drawH = this._fbHeight * scale;
      const drawX = Math.floor((canvasWidth - drawW) * 0.5);
      const drawY = Math.floor((canvasHeight - drawH) * 0.5);
      activeGpu.blit(this._fbTexture, {
        x: drawX,
        y: drawY,
        srcX: 0,
        srcY: 0,
        srcW: this._fbWidth,
        srcH: this._fbHeight,
        scaleX: scale,
        scaleY: scale,
        filter: 'nearest',
      });
    };

    if (typeof renderOptions?.enqueue === 'function') {
      renderOptions.enqueue({
        type: 'pico8',
        z: null,
        defaultLayer: 1500,
        creationOrder: 0,
        draw: drawFramebuffer,
      });
    } else {
      drawFramebuffer();
    }
  }

  // ============================================================
  // Helper Methods for Argument Processing
  // ============================================================

  _readArg(args, index, allowStackFallback = true) {
    if (args && index < args.length) {
      return args[index];
    }
    if (!allowStackFallback) {
      return undefined;
    }
    return this.luaState?.raw_tostring?.(index + 2);
  }

  _optionalNumberArg(args, index, defaultValue, methodName, argName) {
    const hasExplicitArgs = !!args && args.length > 0;
    if (!hasExplicitArgs) {
      return defaultValue;
    }
    const raw = this._readArg(args, index, false);
    if (raw === undefined || raw === null || raw === '') {
      return defaultValue;
    }
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`[Pico8] ${methodName} invalid numeric argument ${argName}: ${raw}`);
    }
    return value;
  }

  _requireNumberArg(args, index, methodName, argName) {
    const hasExplicitArgs = !!args && args.length > 0;
    const raw = this._readArg(args, index, !hasExplicitArgs);
    if (raw === undefined || raw === null || raw === '') {
      throw new Error(`[Pico8] ${methodName} missing required argument: ${argName}`);
    }
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`[Pico8] ${methodName} invalid numeric argument ${argName}: ${raw}`);
    }
    return value;
  }

  _requireIntegerArg(args, index, methodName, argName) {
    const hasExplicitArgs = !!args && args.length > 0;
    const raw = this._readArg(args, index, !hasExplicitArgs);
    if (raw === undefined || raw === null || raw === '') {
      throw new Error(`[Pico8] ${methodName} missing required argument: ${argName}`);
    }
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value)) {
      throw new Error(`[Pico8] ${methodName} invalid integer argument ${argName}: ${raw}`);
    }
    return value;
  }

  _optionalIntegerArg(args, index, defaultValue, methodName, argName) {
    const hasExplicitArgs = !!args && args.length > 0;
    if (!hasExplicitArgs) {
      return defaultValue;
    }
    const raw = this._readArg(args, index, false);
    if (raw === undefined || raw === null || raw === '') {
      return defaultValue;
    }
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value)) {
      throw new Error(`[Pico8] ${methodName} invalid integer argument ${argName}: ${raw}`);
    }
    return value;
  }

  // ============================================================
  // Graphics Functions
  // ============================================================

  /**
   * Set pixel color at (x, y) to c
   * Lua: pset(x, y, [c])
   */
  pset(...args) {
    const x = this._requireNumberArg(args, 0, 'pset', 'x');
    const y = this._requireNumberArg(args, 1, 'pset', 'y');
    const c = this._optionalNumberArg(args, 2, this.currentColor, 'pset', 'c');
    
    const engine = this._getEngine();
    if (engine?.setPixel) {
      engine.setPixel(Math.floor(x), Math.floor(y), Math.floor(c) & 0xFF);
    }
  }

  /**
   * Get pixel color at (x, y)
   * Lua: pget(x, y) -> color
   */
  pget(...args) {
    const x = this._requireNumberArg(args, 0, 'pget', 'x');
    const y = this._requireNumberArg(args, 1, 'pget', 'y');
    
    const engine = this._getEngine();
    if (engine?.getPixel) {
      return engine.getPixel(Math.floor(x), Math.floor(y)) || 0;
    }
    return 0;
  }

  /**
   * Set pen color
   * Lua: color(c)
   */
  color(...args) {
    const c = this._requireNumberArg(args, 0, 'color', 'c');
    this.currentColor = Math.floor(c) & 0xFF;
  }

  /**
   * Draw line from (x0,y0) to (x1,y1) with optional color
   * Lua: line(x0, y0, x1, y1, [c])
   */
  line(...args) {
    const x0 = this._requireNumberArg(args, 0, 'line', 'x0');
    const y0 = this._requireNumberArg(args, 1, 'line', 'y0');
    const x1 = this._requireNumberArg(args, 2, 'line', 'x1');
    const y1 = this._requireNumberArg(args, 3, 'line', 'y1');
    const c = this._optionalNumberArg(args, 4, this.currentColor, 'line', 'c');
    
    const engine = this._getEngine();
    if (engine?.line) {
      engine.line(
        Math.floor(x0), Math.floor(y0),
        Math.floor(x1), Math.floor(y1),
        Math.floor(c) & 0xFF
      );
    }
  }

  /**
   * Draw rectangle outline from (x0,y0) to (x1,y1) with optional color
   * Lua: rect(x0, y0, x1, y1, [c])
   */
  rect(...args) {
    const x0 = this._requireNumberArg(args, 0, 'rect', 'x0');
    const y0 = this._requireNumberArg(args, 1, 'rect', 'y0');
    const x1 = this._requireNumberArg(args, 2, 'rect', 'x1');
    const y1 = this._requireNumberArg(args, 3, 'rect', 'y1');
    const c = this._optionalNumberArg(args, 4, this.currentColor, 'rect', 'c');
    
    const engine = this._getEngine();
    if (engine?.rect) {
      engine.rect(
        Math.floor(x0), Math.floor(y0),
        Math.floor(x1), Math.floor(y1),
        Math.floor(c) & 0xFF
      );
    }
  }

  /**
   * Draw filled rectangle from (x0,y0) to (x1,y1) with optional color
   * Lua: rectfill(x0, y0, x1, y1, [c])
   */
  rectfill(...args) {
    const x0 = this._requireNumberArg(args, 0, 'rectfill', 'x0');
    const y0 = this._requireNumberArg(args, 1, 'rectfill', 'y0');
    const x1 = this._requireNumberArg(args, 2, 'rectfill', 'x1');
    const y1 = this._requireNumberArg(args, 3, 'rectfill', 'y1');
    const c = this._optionalNumberArg(args, 4, this.currentColor, 'rectfill', 'c');
    
    const engine = this._getEngine();
    if (engine?.rectfill) {
      engine.rectfill(
        Math.floor(x0), Math.floor(y0),
        Math.floor(x1), Math.floor(y1),
        Math.floor(c) & 0xFF
      );
    }
  }

  /**
   * Draw circle outline at (x,y) with radius r and optional color
   * Lua: circ(x, y, r, [c])
   */
  circ(...args) {
    const x = this._requireNumberArg(args, 0, 'circ', 'x');
    const y = this._requireNumberArg(args, 1, 'circ', 'y');
    const r = this._requireNumberArg(args, 2, 'circ', 'r');
    const c = this._optionalNumberArg(args, 3, this.currentColor, 'circ', 'c');
    
    const engine = this._getEngine();
    if (engine?.circ) {
      engine.circ(
        Math.floor(x), Math.floor(y),
        Math.floor(r),
        Math.floor(c) & 0xFF
      );
    }
  }

  /**
   * Draw filled circle at (x,y) with radius r and optional color
   * Lua: circfill(x, y, r, [c])
   */
  circfill(...args) {
    const x = this._requireNumberArg(args, 0, 'circfill', 'x');
    const y = this._requireNumberArg(args, 1, 'circfill', 'y');
    const r = this._requireNumberArg(args, 2, 'circfill', 'r');
    const c = this._optionalNumberArg(args, 3, this.currentColor, 'circfill', 'c');
    const engine = this._getEngine();
    if (engine?.circfill) {
      engine.circfill(
        Math.floor(x), Math.floor(y),
        Math.floor(r),
        Math.floor(c) & 0xFF
      );
    }
  }

  /**
   * Clear screen to color c
   * Lua: cls([c])
   */
  cls(...args) {
    const c = this._optionalNumberArg(args, 0, 0, 'cls', 'c');
    const engine = this._getEngine();
    if (engine?.clear) {
      engine.clear(Math.floor(c) & 0xFF);
    }
  }

  /**
   * Draw sprite n at (x,y) with optional width/height/flip flags
   * Lua: spr(n, x, y, [w, h, fx, fy])
   */
  spr(...args) {
    const n = this._requireIntegerArg(args, 0, 'spr', 'n');
    const x = this._requireNumberArg(args, 1, 'spr', 'x');
    const y = this._requireNumberArg(args, 2, 'spr', 'y');
    const w = this._optionalNumberArg(args, 3, 1, 'spr', 'w');
    const h = this._optionalNumberArg(args, 4, 1, 'spr', 'h');
    const fx = this._optionalIntegerArg(args, 5, 0, 'spr', 'fx');
    const fy = this._optionalIntegerArg(args, 6, 0, 'spr', 'fy');
    
    if (this.gameEmulator?.spriteEngine?.drawSprite) {
      this.gameEmulator.spriteEngine.drawSprite(
        n,
        Math.floor(x), Math.floor(y),
        Math.floor(w), Math.floor(h),
        fx !== 0, fy !== 0
      );
    }
  }

  /**
   * Get sprite pixel at (x,y)
   * Lua: sget(x, y) -> color
   */
  sget(...args) {
    const x = this._requireNumberArg(args, 0, 'sget', 'x');
    const y = this._requireNumberArg(args, 1, 'sget', 'y');
    
    if (this.gameEmulator?.spriteEngine?.getSpritePixel) {
      return this.gameEmulator.spriteEngine.getSpritePixel(Math.floor(x), Math.floor(y)) || 0;
    }
    return 0;
  }

  /**
   * Set sprite pixel at (x,y) to color c
   * Lua: sset(x, y, c)
   */
  sset(...args) {
    const x = this._requireNumberArg(args, 0, 'sset', 'x');
    const y = this._requireNumberArg(args, 1, 'sset', 'y');
    const c = this._optionalNumberArg(args, 2, this.currentColor, 'sset', 'c');
    
    if (this.gameEmulator?.spriteEngine?.setSpritePixel) {
      this.gameEmulator.spriteEngine.setSpritePixel(Math.floor(x), Math.floor(y), Math.floor(c) & 0xFF);
    }
  }

  /**
   * Get sprite flag
   * Lua: fget(n, [f]) -> value
   */
  fget(...args) {
    const n = this._requireIntegerArg(args, 0, 'fget', 'n');
    const f = this._optionalIntegerArg(args, 1, 0, 'fget', 'f');
    
    const key = `sprite_${n}_flag_${f}`;
    return this.spriteFlags.get(key) ? 1 : 0;
  }

  /**
   * Set sprite flag
   * Lua: fset(n, [f, v])
   */
  fset(...args) {
    const n = this._requireIntegerArg(args, 0, 'fset', 'n');
    const f = this._optionalIntegerArg(args, 1, 0, 'fset', 'f');
    const v = this._optionalIntegerArg(args, 2, 1, 'fset', 'v');
    
    const key = `sprite_${n}_flag_${f}`;
    if (v !== 0) {
      this.spriteFlags.set(key, true);
    } else {
      this.spriteFlags.delete(key);
    }
  }

  /**
   * Set palette mapping
   * Lua: pal([c0, c1, [p]])
   */
  pal(...args) {
    const c0 = this._optionalIntegerArg(args, 0, -1, 'pal', 'c0');
    const c1 = this._optionalIntegerArg(args, 1, -1, 'pal', 'c1');
    
    if (c0 >= 0 && c1 >= 0) {
      this.currentPalette.set(c0, c1);
    } else {
      this.currentPalette.clear();
    }
  }

  /**
   * Set transparent color
   * Lua: palt([c, [t]])
   */
  palt(...args) {
    // Store transparent color mapping
    const c = this._optionalIntegerArg(args, 0, -1, 'palt', 'c');
    const t = this._optionalIntegerArg(args, 1, 1, 'palt', 't');
    
    if (c >= 0) {
      if (this.gameEmulator?.spriteEngine?.setTransparentColor) {
        this.gameEmulator.spriteEngine.setTransparentColor(c, t !== 0);
      }
    }
  }

  /**
   * Set camera position
   * Lua: camera([x, y])
   */
  camera(...args) {
    const x = this._optionalNumberArg(args, 0, 0, 'camera', 'x');
    const y = this._optionalNumberArg(args, 1, 0, 'camera', 'y');
    
    const engine = this._getEngine();
    if (engine?.setCamera) {
      engine.setCamera(Math.floor(x), Math.floor(y));
    }
  }

  /**
   * Set clipping region
   * Lua: clip([x, y, w, h])
   */
  clip(...args) {
    const x = this._optionalNumberArg(args, 0, 0, 'clip', 'x');
    const y = this._optionalNumberArg(args, 1, 0, 'clip', 'y');
    const w = this._optionalNumberArg(args, 2, 128, 'clip', 'w');
    const h = this._optionalNumberArg(args, 3, 128, 'clip', 'h');
    
    const engine = this._getEngine();
    if (engine?.setClip) {
      engine.setClip(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
    }
  }

  /**
   * Print text at position
   * Lua: print(text, x, y, [color])
   */
  print(...args) {
    const text = args[0]?.toString() ?? '';
    const x = this._optionalNumberArg(args, 1, undefined, 'print', 'x');
    const y = this._optionalNumberArg(args, 2, undefined, 'print', 'y');
    const color = this._optionalNumberArg(args, 3, this.currentColor, 'print', 'color');

    if (this.gameEmulator?.gameConsole?.writeToConsole) {
      this.gameEmulator.gameConsole.writeToConsole(`${text}\n`, true);
    }

    // If no coordinates were provided, treat this like debug output.
    if (x === undefined || y === undefined) {
      console.log(text);
      return;
    }
    
    if (this.gameEmulator?.spriteEngine?.drawText) {
      this.gameEmulator.spriteEngine.drawText(text, Math.floor(x), Math.floor(y), Math.floor(color) & 0xFF);
      return;
    }

    // Local test harnesses may not have drawText; fall back to console.
    console.log(text);
  }

  // ============================================================
  // Math Functions (Pico-8 Style)
  // ============================================================

  /**
   * Sine function (takes 0.0-1.0, not radians like standard Lua)
   * Lua: sin(x) -> result
   */
  sin(...args) {
    const x = this._requireNumberArg(args, 0, 'sin', 'x');
    // Pico-8 sin takes 0.0-1.0 where 1.0 = 2π
    return Math.sin(x * 2 * Math.PI);
  }

  /**
   * Cosine function (takes 0.0-1.0, not radians)
   * Lua: cos(x) -> result
   */
  cos(...args) {
    const x = this._requireNumberArg(args, 0, 'cos', 'x');
    // Pico-8 cos takes 0.0-1.0 where 1.0 = 2π
    return Math.cos(x * 2 * Math.PI);
  }

  /**
   * Arc tangent 2 (returns 0.0-1.0)
   * Lua: atan2(y, x) -> result
   */
  atan2(...args) {
    const y = this._requireNumberArg(args, 0, 'atan2', 'y');
    const x = this._requireNumberArg(args, 1, 'atan2', 'x');
    // Return result in 0.0-1.0 range
    return Math.atan2(y, x) / (2 * Math.PI);
  }

  /**
   * Square root
   * Lua: sqrt(x) -> result
   */
  sqrt(...args) {
    const x = this._requireNumberArg(args, 0, 'sqrt', 'x');
    return Math.sqrt(x);
  }

  /**
   * Absolute value
   * Lua: abs(x) -> result
   */
  abs(...args) {
    const x = this._requireNumberArg(args, 0, 'abs', 'x');
    return Math.abs(x);
  }

  /**
   * Sign function (-1, 0, or 1)
   * Lua: sgn(x) -> result
   */
  sgn(...args) {
    const x = this._requireNumberArg(args, 0, 'sgn', 'x');
    return x > 0 ? 1 : (x < 0 ? -1 : 0);
  }

  /**
   * Floor function
   * Lua: flr(x) -> result
   */
  flr(...args) {
    const x = this._requireNumberArg(args, 0, 'flr', 'x');
    return Math.floor(x);
  }

  /**
   * Ceiling function
   * Lua: ceil(x) -> result
   */
  ceil(...args) {
    const x = this._requireNumberArg(args, 0, 'ceil', 'x');
    return Math.ceil(x);
  }

  /**
   * Minimum of two values
   * Lua: min(a, b) -> result
   */
  min(...args) {
    const a = this._requireNumberArg(args, 0, 'min', 'a');
    const b = this._requireNumberArg(args, 1, 'min', 'b');
    return Math.min(a, b);
  }

  /**
   * Maximum of two values
   * Lua: max(a, b) -> result
   */
  max(...args) {
    const a = this._requireNumberArg(args, 0, 'max', 'a');
    const b = this._requireNumberArg(args, 1, 'max', 'b');
    return Math.max(a, b);
  }

  /**
   * Median/Clamp of three values
   * Lua: mid(a, b, c) -> result (returns middle value)
   */
  mid(...args) {
    const a = this._requireNumberArg(args, 0, 'mid', 'a');
    const b = this._requireNumberArg(args, 1, 'mid', 'b');
    const c = this._requireNumberArg(args, 2, 'mid', 'c');
    const minValue = Math.min(a, b, c);
    const maxValue = Math.max(a, b, c);
    return a + b + c - minValue - maxValue;
  }

  /**
   * Random number (0 to x)
   * Lua: rnd([x]) -> result
   */
  rnd(...args) {
    const x = this._optionalNumberArg(args, 0, 1.0, 'rnd', 'x');
    return Math.random() * x;
  }

  /**
   * Seed random
   * Lua: srand(x)
   */
  srand(...args) {
    const x = this._requireIntegerArg(args, 0, 'srand', 'x');
    this.randomSeed = x;
    // Note: JavaScript Math.random() can't be truly seeded, this is a placeholder
  }

  // ============================================================
  // Bitwise Operations
  // ============================================================

  /**
   * Bitwise AND
   * Lua: band(a, b) -> result
   */
  band(...args) {
    const a = this._requireIntegerArg(args, 0, 'band', 'a');
    const b = this._requireIntegerArg(args, 1, 'band', 'b');
    return a & b;
  }

  /**
   * Bitwise OR
   * Lua: bor(a, b) -> result
   */
  bor(...args) {
    const a = this._requireIntegerArg(args, 0, 'bor', 'a');
    const b = this._requireIntegerArg(args, 1, 'bor', 'b');
    return a | b;
  }

  /**
   * Bitwise XOR
   * Lua: bxor(a, b) -> result
   */
  bxor(...args) {
    const a = this._requireIntegerArg(args, 0, 'bxor', 'a');
    const b = this._requireIntegerArg(args, 1, 'bxor', 'b');
    return a ^ b;
  }

  /**
   * Bitwise NOT
   * Lua: bnot(x) -> result
   */
  bnot(...args) {
    const x = this._requireIntegerArg(args, 0, 'bnot', 'x');
    return ~x;
  }

  /**
   * Shift left
   * Lua: shl(x, n) -> result
   */
  shl(...args) {
    const x = this._requireIntegerArg(args, 0, 'shl', 'x');
    const n = this._requireIntegerArg(args, 1, 'shl', 'n');
    return x << n;
  }

  /**
   * Shift right (arithmetic)
   * Lua: shr(x, n) -> result
   */
  shr(...args) {
    const x = this._requireIntegerArg(args, 0, 'shr', 'x');
    const n = this._requireIntegerArg(args, 1, 'shr', 'n');
    return x >> n;
  }

  /**
   * Logical shift left
   * Lua: lshl(x, n) -> result
   */
  lshl(...args) {
    const x = this._requireIntegerArg(args, 0, 'lshl', 'x');
    const n = this._requireIntegerArg(args, 1, 'lshl', 'n');
    return (x << n) & 0xFFFFFFFF;
  }

  /**
   * Logical shift right
   * Lua: lshr(x, n) -> result
   */
  lshr(...args) {
    const x = this._requireIntegerArg(args, 0, 'lshr', 'x');
    const n = this._requireIntegerArg(args, 1, 'lshr', 'n');
    return (x >>> n) & 0xFFFFFFFF;
  }

  /**
   * Rotate left
   * Lua: rotl(x, n) -> result
   */
  rotl(...args) {
    const x = this._requireIntegerArg(args, 0, 'rotl', 'x');
    const n = this._requireIntegerArg(args, 1, 'rotl', 'n');
    const mask = 0xFFFFFFFF;
    return ((x << n) | (x >>> (32 - n))) & mask;
  }

  /**
   * Rotate right
   * Lua: rotr(x, n) -> result
   */
  rotr(...args) {
    const x = this._requireIntegerArg(args, 0, 'rotr', 'x');
    const n = this._requireIntegerArg(args, 1, 'rotr', 'n');
    const mask = 0xFFFFFFFF;
    return ((x >>> n) | (x << (32 - n))) & mask;
  }

  // ============================================================
  // String Functions
  // ============================================================

  /**
   * Substring function
   * Lua: sub(s, i, [j]) -> result
   */
  sub(...args) {
    const s = args[0]?.toString() ?? '';
    const i = this._requireIntegerArg(args, 1, 'sub', 'i');
    const j = this._optionalIntegerArg(args, 2, -1, 'sub', 'j');
    
    const startIdx = i - 1; // Lua uses 1-based indexing
    const endIdx = j >= 0 ? j : s.length;
    
    return s.substring(startIdx, endIdx);
  }

  /**
   * Convert value to string
   * Lua: tostr(x, [show_decimal]) -> result
   */
  tostr(...args) {
    const x = args[0];
    const showDecimal = this._optionalIntegerArg(args, 1, 1, 'tostr', 'show_decimal');
    
    if (typeof x === 'number') {
      if (showDecimal && x % 1 !== 0) {
        return x.toString();
      }
      return Math.floor(x).toString();
    }
    return x?.toString() ?? '';
  }

  /**
   * Convert string to number
   * Lua: tonum(s) -> result
   */
  tonum(...args) {
    const s = args[0]?.toString() ?? '';
    const value = Number.parseFloat(s);
    return Number.isFinite(value) ? value : 0;
  }

  _isTableLike(value) {
    return Array.isArray(value) || (value !== null && typeof value === 'object');
  }

  _getNumericKeys(tableValue) {
    return Object.keys(tableValue)
      .map((key) => Number.parseInt(key, 10))
      .filter((key) => Number.isInteger(key) && key >= 1)
      .sort((a, b) => a - b);
  }

  _tableLength(tableValue) {
    if (Array.isArray(tableValue)) {
      return tableValue.length;
    }
    const keys = this._getNumericKeys(tableValue);
    return keys.length > 0 ? keys[keys.length - 1] : 0;
  }

  // ============================================================
  // Table Functions (Pico-8 style)
  // ============================================================

  /**
   * Add value to table
   * Lua: add(t, v, [i])
   */
  add(...args) {
    const t = args[0];
    const v = args[1];
    const i = args.length > 2 ? this._optionalIntegerArg(args, 2, undefined, 'add', 'i') : undefined;

    if (!this._isTableLike(t)) {
      throw new Error('[Pico8] add() requires first argument to be a table');
    }

    if (Array.isArray(t) && i === undefined) {
      t.push(v);
      return v;
    }

    if (Array.isArray(t)) {
      const insertAt = Math.max(0, i - 1); // Lua indices are 1-based
      t.splice(insertAt, 0, v);
      return v;
    }

    const tableLength = this._tableLength(t);
    const insertAt = i === undefined ? tableLength + 1 : Math.max(1, i);
    if (insertAt <= tableLength) {
      for (let idx = tableLength; idx >= insertAt; idx -= 1) {
        t[idx + 1] = t[idx];
      }
    }
    t[insertAt] = v;

    return v;
  }

  /**
   * Delete value from table
   * Lua: del(t, v)
   */
  del(...args) {
    const t = args[0];
    const v = args[1];

    if (!this._isTableLike(t)) {
      throw new Error('[Pico8] del() requires first argument to be a table');
    }

    if (Array.isArray(t)) {
      const index = t.indexOf(v);
      if (index === -1) {
        return undefined;
      }

      t.splice(index, 1);
      return v;
    }

    const keys = this._getNumericKeys(t);
    const matchKey = keys.find((key) => t[key] === v);
    if (matchKey === undefined) {
      return undefined;
    }

    const tableLength = this._tableLength(t);
    for (let idx = matchKey; idx < tableLength; idx += 1) {
      t[idx] = t[idx + 1];
    }
    delete t[tableLength];

    return v;
  }

  /**
   * Count table elements
   * Lua: count(t) -> result
   */
  count(...args) {
    const t = args[0];

    if (!this._isTableLike(t)) {
      return 0;
    }

    if (Array.isArray(t)) {
      return t.length;
    }

    return this._getNumericKeys(t).length;
  }

  /**
   * Iterate all table elements
   * Lua: all(t) -> iterator
   */
  all(...args) {
    const t = args[0];

    if (!this._isTableLike(t)) {
      throw new Error('[Pico8] all() requires first argument to be a table');
    }

    const values = Array.isArray(t)
      ? t
      : this._getNumericKeys(t).map((key) => t[key]);

    let index = 0;
    return () => {
      if (index >= values.length) {
        return undefined;
      }
      const value = values[index];
      index += 1;
      return value;
    };
  }

  /**
   * Apply function to all table elements
   * Lua: foreach(t, f)
   */
  foreach(...args) {
    const t = args[0];
    const f = args[1];

    if (!this._isTableLike(t)) {
      throw new Error('[Pico8] foreach() requires first argument to be a table');
    }

    if (typeof f !== 'function') {
      throw new Error('[Pico8] foreach() requires a callback function');
    }

    const values = Array.isArray(t)
      ? t
      : this._getNumericKeys(t).map((key) => t[key]);

    for (const item of values) {
      f(item);
    }
  }

  // ============================================================
  // Audio Functions
  // ============================================================

  /**
   * Play music track
   * Lua: music(n, [fade, mask])
   */
  music(...args) {
    const n = this._requireIntegerArg(args, 0, 'music', 'n');
    const fade = this._optionalIntegerArg(args, 1, 0, 'music', 'fade');
    const mask = this._optionalIntegerArg(args, 2, 0xFF, 'music', 'mask');
    
    if (this.gameEmulator?.audioEngine?.playMusic) {
      this.gameEmulator.audioEngine.playMusic(n, fade, mask);
    }
  }

  /**
   * Play sound effect
   * Lua: sfx(n, [channel, offset, length])
   */
  sfx(...args) {
    const n = this._requireIntegerArg(args, 0, 'sfx', 'n');
    const channel = this._optionalIntegerArg(args, 1, -1, 'sfx', 'channel');
    const offset = this._optionalIntegerArg(args, 2, 0, 'sfx', 'offset');
    const length = this._optionalIntegerArg(args, 3, 32, 'sfx', 'length');
    
    if (this.gameEmulator?.audioEngine?.playSfx) {
      this.gameEmulator.audioEngine.playSfx(n, channel, offset, length);
    }
  }

  // ============================================================
  // Utility Functions
  // ============================================================

  /**
   * Print to console (debug)
   * Lua: printh(text, [filename, overwrite, precision])
   */
  printh(...args) {
    const text = args[0]?.toString() ?? '';
    console.log(`[Pico8] ${text}`);
  }

  /**
   * Get statistics
   * Lua: stat(x) -> result
   */
  stat(...args) {
    const x = this._requireIntegerArg(args, 0, 'stat', 'x');
    
    // Common stat indices:
    // 0: clock ticks
    // 1: number of cartridges loaded
    // 4: current fps
    // 5: current memory usage
    
    switch (x) {
      case 0:
        return Date.now();
      case 4:
        return 60; // Default pico-8 target fps
      case 5:
        return (performance.memory?.usedJSHeapSize || 0) / 1024 / 1024; // MB
      default:
        return 0;
    }
  }
}

// Register the extension with the Lua system
if (typeof window !== 'undefined') {
  window.LuaPico8Extensions = LuaPico8Extensions;
}
