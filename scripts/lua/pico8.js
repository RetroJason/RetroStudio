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
  }

  // ============================================================
  // Helper Methods for Argument Processing
  // ============================================================

  _optionalNumberArg(args, index, defaultValue, methodName, argName) {
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
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
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
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
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
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
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
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
    
    // Call sprite engine to set pixel
    if (this.gameEmulator?.spriteEngine?.setPixel) {
      this.gameEmulator.spriteEngine.setPixel(Math.floor(x), Math.floor(y), Math.floor(c) & 0xFF);
    }
  }

  /**
   * Get pixel color at (x, y)
   * Lua: pget(x, y) -> color
   */
  pget(...args) {
    const x = this._requireNumberArg(args, 0, 'pget', 'x');
    const y = this._requireNumberArg(args, 1, 'pget', 'y');
    
    if (this.gameEmulator?.spriteEngine?.getPixel) {
      return this.gameEmulator.spriteEngine.getPixel(Math.floor(x), Math.floor(y)) || 0;
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
    
    if (this.gameEmulator?.spriteEngine?.line) {
      this.gameEmulator.spriteEngine.line(
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
    
    if (this.gameEmulator?.spriteEngine?.rect) {
      this.gameEmulator.spriteEngine.rect(
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
    
    if (this.gameEmulator?.spriteEngine?.rectfill) {
      this.gameEmulator.spriteEngine.rectfill(
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
    
    if (this.gameEmulator?.spriteEngine?.circ) {
      this.gameEmulator.spriteEngine.circ(
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
    
    if (this.gameEmulator?.spriteEngine?.circfill) {
      this.gameEmulator.spriteEngine.circfill(
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
    
    if (this.gameEmulator?.spriteEngine?.clear) {
      this.gameEmulator.spriteEngine.clear(Math.floor(c) & 0xFF);
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
    
    if (this.gameEmulator?.spriteEngine?.setCamera) {
      this.gameEmulator.spriteEngine.setCamera(Math.floor(x), Math.floor(y));
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
    
    if (this.gameEmulator?.spriteEngine?.setClip) {
      this.gameEmulator.spriteEngine.setClip(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
    }
  }

  /**
   * Print text at position
   * Lua: print(text, x, y, [color])
   */
  print(...args) {
    const text = args[0]?.toString() ?? '';
    const x = this._requireNumberArg(args, 1, 'print', 'x');
    const y = this._requireNumberArg(args, 2, 'print', 'y');
    const color = this._optionalNumberArg(args, 3, this.currentColor, 'print', 'color');
    
    if (this.gameEmulator?.spriteEngine?.drawText) {
      this.gameEmulator.spriteEngine.drawText(text, Math.floor(x), Math.floor(y), Math.floor(color) & 0xFF);
    }
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
    return Math.max(Math.min(a, b, c), Math.min(Math.max(a, b), Math.max(b, c)));
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

  // ============================================================
  // Table Functions (Pico-8 style)
  // ============================================================

  /**
   * Add value to table
   * Lua: add(t, v, [i])
   */
  add(...args) {
    // Note: Lua tables are handled by the Lua engine
    // This is a stub for compatibility
  }

  /**
   * Delete value from table
   * Lua: del(t, v)
   */
  del(...args) {
    // Note: Lua tables are handled by the Lua engine
    // This is a stub for compatibility
  }

  /**
   * Count table elements
   * Lua: count(t) -> result
   */
  count(...args) {
    // Note: Lua tables are handled by the Lua engine
    // This would need access to the actual Lua table
    return 0;
  }

  /**
   * Iterate all table elements
   * Lua: all(t) -> iterator
   */
  all(...args) {
    // Note: Lua tables and iterators are handled by the Lua engine
    // This is a stub for compatibility
  }

  /**
   * Apply function to all table elements
   * Lua: foreach(t, f)
   */
  foreach(...args) {
    // Note: Lua tables and functions are handled by the Lua engine
    // This is a stub for compatibility
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
