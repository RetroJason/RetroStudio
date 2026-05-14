// d2-sprite.js
// Shared sprite runtime library for building, parsing, and rendering D2F/D2S
// binary sprite data. Used by:
//   - SpriteBuilder  (build-time: .sprite JSON → .d2f + .d2s binaries)
//   - GameEmulator   (runtime: loads .d2f/.d2s, ticks animations, renders frames)
//   - SpriteEditor   (preview: renders animation frames to canvas)
//
// Binary formats are defined in docs/sprite_format.md.
//
// Dependencies: none (pure library — no DOM, no fileIOService)

console.log('[D2Sprite] Library loading');

/* ══════════════════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════════════════ */

const D2F_MAGIC = 'D2FA';      // Frame atlas magic
const D2S_MAGIC = 'D2SP';      // Sprite magic
const D2F_VERSION = 1;
const D2S_VERSION = 1;

const D2F_HEADER_SIZE = 16;    // bytes
const D2F_FRAME_SIZE  = 20;    // bytes per frame entry

const D2S_HEADER_SIZE = 32;    // bytes
const D2S_ANIM_SIZE   = 24;    // bytes per animation entry
const D2S_ANIMFRAME_SIZE = 8;  // bytes per anim-frame entry

const D2S_NAME_LENGTH  = 16;   // sprite name in header
const D2S_ANIM_NAME_LENGTH = 12; // animation name

/** Sentinel: "use animation default" for per-frame dx/dy */
const DX_DY_DEFAULT = -128;    // 0x80 as int8

/* Loop modes */
const LOOP_FORWARD   = 0;
const LOOP_REVERSE   = 1;
const LOOP_PINGPONG  = 2;
const LOOP_ONCE      = 3;

/* ══════════════════════════════════════════════════════════════════════
   D2Sprite — static utility class
   ══════════════════════════════════════════════════════════════════════ */

class D2Sprite {

  /* ────────────────────────────────────────────────────────────────────
     BUILD: .sprite JSON → .d2f + .d2s Uint8Arrays
     ──────────────────────────────────────────────────────────────────── */

  /**
   * Build a .d2f (frame atlas) binary from sprite editor data.
   *
   * @param {object} spriteData  SpriteEditorData.toJSON() output
   * @param {object} opts
   * @param {number} opts.textureIndex  Build-time texture index (default 0)
   * @param {number} opts.paletteSlot   Header-level palette slot (default 0)
   * @param {number} opts.paletteOffset Header-level palette offset (default 0)
   * @returns {Uint8Array} Complete .d2f file bytes
   */
  static buildD2F(spriteData, opts = {}) {
    const frames = spriteData.frames || [];
    const frameCount = frames.length;
    const textureIndex  = opts.textureIndex  ?? 0;
    const paletteSlot   = opts.paletteSlot   ?? 0;
    const paletteOffset = opts.paletteOffset ?? 0;

    if (!Number.isInteger(textureIndex) || textureIndex < 0 || textureIndex > 0xFFFF) {
      throw new Error(`D2F build failed: textureIndex out of range (${textureIndex})`);
    }
    if (!Number.isInteger(paletteSlot) || paletteSlot < 0 || paletteSlot > 0xFF) {
      throw new Error(`D2F build failed: paletteSlot out of range (${paletteSlot})`);
    }
    if (!Number.isInteger(paletteOffset) || paletteOffset < 0 || paletteOffset > 0xFF) {
      throw new Error(`D2F build failed: paletteOffset out of range (${paletteOffset})`);
    }

    const totalSize = D2F_HEADER_SIZE + frameCount * D2F_FRAME_SIZE;
    const buf  = new ArrayBuffer(totalSize);
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);

    // ── Header (16 bytes) ───────────────────────────────────────────
    bytes[0] = 0x44; // 'D'
    bytes[1] = 0x32; // '2'
    bytes[2] = 0x46; // 'F'
    bytes[3] = 0x41; // 'A'
    view.setUint8(4, D2F_VERSION);
    view.setUint8(5, 0);                          // flags
    view.setUint16(6, frameCount, true);           // frame_count
    view.setUint16(8, textureIndex, true);         // texture_index
    view.setUint8(10, paletteSlot);                // palette_slot
    view.setUint8(11, paletteOffset);              // palette_offset
    // bytes 12–15: reserved (already 0)

    // ── Frame entries (20 bytes each) ───────────────────────────────
    for (let i = 0; i < frameCount; i++) {
      const f = frames[i];
      const off = D2F_HEADER_SIZE + i * D2F_FRAME_SIZE;

      const w = f.w || 0;
      const h = f.h || 0;

      view.setUint16(off + 0,  f.x || 0, true);   // x
      view.setUint16(off + 2,  f.y || 0, true);   // y
      view.setUint16(off + 4,  w, true);           // w
      view.setUint16(off + 6,  h, true);           // h
      view.setInt16(off + 8,   Math.round(w / 2), true);  // center_x (default: center)
      view.setInt16(off + 10,  Math.round(h / 2), true);  // center_y (default: center)
      view.setInt16(off + 12,  0, true);           // offset_x (default: 0)
      view.setInt16(off + 14,  0, true);           // offset_y (default: 0)
      view.setUint8(off + 16,  0xFF);              // palette_slot (inherit)
      view.setUint8(off + 17,  0xFF);              // pal_offset (inherit)
      // bytes 18–19: reserved (already 0)
    }

    return new Uint8Array(buf);
  }

  /**
   * Build a .d2s (sprite) binary from sprite editor data.
   *
   * @param {object} spriteData  SpriteEditorData.toJSON() output
   * @param {object} opts
   * @param {number} opts.frameAtlasIndex  Build-time .d2f index (default 0)
   * @returns {Uint8Array} Complete .d2s file bytes
   */
  static buildD2S(spriteData, opts = {}) {
    const animations = spriteData.animations || [];
    const animCount  = animations.length;
    const frameAtlas = opts.frameAtlasIndex ?? 0;
    const spriteName = (spriteData.name || 'untitled').substring(0, D2S_NAME_LENGTH - 1);

    // Build a map from frame id → sequential index in the .d2f
    const frameIdToIndex = new Map();
    (spriteData.frames || []).forEach((f, idx) => {
      frameIdToIndex.set(f.id, idx);
    });

    // Pre-compute total anim-frame count
    let totalFrames = 0;
    for (const anim of animations) {
      totalFrames += (anim.frameIds || []).length;
    }

    const totalSize = D2S_HEADER_SIZE
                    + animCount * D2S_ANIM_SIZE
                    + totalFrames * D2S_ANIMFRAME_SIZE;
    const buf   = new ArrayBuffer(totalSize);
    const view  = new DataView(buf);
    const bytes = new Uint8Array(buf);

    // ── Header (32 bytes) ───────────────────────────────────────────
    bytes[0] = 0x44; // 'D'
    bytes[1] = 0x32; // '2'
    bytes[2] = 0x53; // 'S'
    bytes[3] = 0x50; // 'P'
    view.setUint8(4, D2S_VERSION);
    view.setUint8(5, 0);                           // flags
    view.setUint16(6, animCount, true);             // anim_count
    view.setUint16(8, totalFrames, true);           // total_frames
    view.setUint16(10, frameAtlas, true);           // frame_atlas index

    // name[16] at offset 12
    for (let i = 0; i < D2S_NAME_LENGTH; i++) {
      bytes[12 + i] = i < spriteName.length ? spriteName.charCodeAt(i) : 0;
    }
    // bytes 28–31: reserved (already 0)

    // ── Animation entries (24 bytes each) ───────────────────────────
    let framePoolOffset = 0;  // running index into the AnimFrame pool
    const animBaseOffset = D2S_HEADER_SIZE;

    for (let a = 0; a < animCount; a++) {
      const anim = animations[a];
      const off  = animBaseOffset + a * D2S_ANIM_SIZE;
      const frameIds = anim.frameIds || [];

      // name[12]
      const animName = (anim.name || `anim_${a}`).substring(0, D2S_ANIM_NAME_LENGTH - 1);
      for (let i = 0; i < D2S_ANIM_NAME_LENGTH; i++) {
        bytes[off + i] = i < animName.length ? animName.charCodeAt(i) : 0;
      }

      view.setUint16(off + 12, framePoolOffset, true);          // frame_start
      view.setUint16(off + 14, frameIds.length, true);          // frame_count
      view.setUint16(off + 16, anim.frameDuration || 100, true);// default_duration (ms)

      // loop_mode
      let loopMode = LOOP_FORWARD;
      if (anim.loop === false) {
        loopMode = LOOP_ONCE;
      } else if (anim.loopMode !== undefined) {
        loopMode = anim.loopMode;
      }
      view.setUint8(off + 18, loopMode);

      // dx/dy (animation-level default per-frame motion)
      view.setInt8(off + 19, D2Sprite._clampI8(anim.dx || 0));
      view.setInt8(off + 20, D2Sprite._clampI8(anim.dy || 0));
      // bytes 21–23: reserved (already 0)

      framePoolOffset += frameIds.length;
    }

    // ── AnimFrame pool (8 bytes each) ───────────────────────────────
    const poolBaseOffset = D2S_HEADER_SIZE + animCount * D2S_ANIM_SIZE;
    let poolIdx = 0;

    for (let a = 0; a < animCount; a++) {
      const anim = animations[a];
      const frameIds = anim.frameIds || [];
      const overrides = anim.frameOverrides || {};

      for (let s = 0; s < frameIds.length; s++) {
        const off = poolBaseOffset + poolIdx * D2S_ANIMFRAME_SIZE;
        const frameId = frameIds[s];

        // Map frame id → d2f index
        if (!frameIdToIndex.has(frameId)) {
          throw new Error(`D2S build failed: animation "${anim.name || `anim_${a}`}" references unknown frame "${frameId}"`);
        }
        const d2fIndex = frameIdToIndex.get(frameId);
        view.setUint16(off + 0, d2fIndex, true);  // frame_id

        // Per-frame overrides (from sprite editor's frameOverrides map)
        const ov = overrides[String(s)] || {};
        const duration = ov.duration || 0;   // 0 = use anim default
        view.setUint16(off + 2, duration, true);  // duration

        // dx/dy: 0x80 (-128) = use animation default
        const dx = ov.dx !== undefined ? D2Sprite._clampI8(ov.dx) : DX_DY_DEFAULT;
        const dy = ov.dy !== undefined ? D2Sprite._clampI8(ov.dy) : DX_DY_DEFAULT;
        view.setInt8(off + 4, dx);
        view.setInt8(off + 5, dy);
        // bytes 6–7: reserved (already 0)

        poolIdx++;
      }
    }

    return new Uint8Array(buf);
  }

  /* ────────────────────────────────────────────────────────────────────
     PARSE: .d2f / .d2s Uint8Array → runtime objects
     ──────────────────────────────────────────────────────────────────── */

  /**
   * Parse a .d2f binary into a frame atlas object.
   *
   * @param {Uint8Array|ArrayBuffer} data  Raw .d2f bytes
   * @returns {{ header: object, frames: object[] }}
   */
  static parseD2F(data) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    if (bytes.length < D2F_HEADER_SIZE) {
      throw new Error(`D2F too small: ${bytes.length} bytes`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Validate magic
    if (bytes[0] !== 0x44 || bytes[1] !== 0x32 || bytes[2] !== 0x46 || bytes[3] !== 0x41) {
      throw new Error('Invalid D2F magic');
    }

    const header = {
      version:       view.getUint8(4),
      flags:         view.getUint8(5),
      frameCount:    view.getUint16(6, true),
      textureIndex:  view.getUint16(8, true),
      paletteSlot:   view.getUint8(10),
      paletteOffset: view.getUint8(11),
    };

    const frames = [];
    for (let i = 0; i < header.frameCount; i++) {
      const off = D2F_HEADER_SIZE + i * D2F_FRAME_SIZE;
      if (off + D2F_FRAME_SIZE > bytes.length) break;
      frames.push({
        x:           view.getUint16(off + 0, true),
        y:           view.getUint16(off + 2, true),
        w:           view.getUint16(off + 4, true),
        h:           view.getUint16(off + 6, true),
        centerX:     view.getInt16(off + 8, true),
        centerY:     view.getInt16(off + 10, true),
        offsetX:     view.getInt16(off + 12, true),
        offsetY:     view.getInt16(off + 14, true),
        paletteSlot: view.getUint8(off + 16),
        palOffset:   view.getUint8(off + 17),
      });
    }

    return { header, frames };
  }

  /**
   * Parse a .d2s binary into a sprite object with animations.
   *
   * @param {Uint8Array|ArrayBuffer} data  Raw .d2s bytes
   * @returns {{ header: object, animations: object[], animFrames: object[] }}
   */
  static parseD2S(data) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    if (bytes.length < D2S_HEADER_SIZE) {
      throw new Error(`D2S too small: ${bytes.length} bytes`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Validate magic
    if (bytes[0] !== 0x44 || bytes[1] !== 0x32 || bytes[2] !== 0x53 || bytes[3] !== 0x50) {
      throw new Error('Invalid D2S magic');
    }

    const header = {
      version:     view.getUint8(4),
      flags:       view.getUint8(5),
      animCount:   view.getUint16(6, true),
      totalFrames: view.getUint16(8, true),
      frameAtlas:  view.getUint16(10, true),
      name:        D2Sprite._readString(bytes, 12, D2S_NAME_LENGTH),
    };

    // Parse animations
    const animations = [];
    const animBase = D2S_HEADER_SIZE;
    for (let a = 0; a < header.animCount; a++) {
      const off = animBase + a * D2S_ANIM_SIZE;
      if (off + D2S_ANIM_SIZE > bytes.length) break;
      animations.push({
        name:            D2Sprite._readString(bytes, off, D2S_ANIM_NAME_LENGTH),
        frameStart:      view.getUint16(off + 12, true),
        frameCount:      view.getUint16(off + 14, true),
        defaultDuration: view.getUint16(off + 16, true),
        loopMode:        view.getUint8(off + 18),
        dx:              view.getInt8(off + 19),
        dy:              view.getInt8(off + 20),
      });
    }

    // Parse AnimFrame pool
    const poolBase = D2S_HEADER_SIZE + header.animCount * D2S_ANIM_SIZE;
    const animFrames = [];
    for (let i = 0; i < header.totalFrames; i++) {
      const off = poolBase + i * D2S_ANIMFRAME_SIZE;
      if (off + D2S_ANIMFRAME_SIZE > bytes.length) break;
      animFrames.push({
        frameId:  view.getUint16(off + 0, true),
        duration: view.getUint16(off + 2, true),
        dx:       view.getInt8(off + 4),
        dy:       view.getInt8(off + 5),
      });
    }

    return { header, animations, animFrames };
  }

  /* ────────────────────────────────────────────────────────────────────
     RUNTIME: Animation state machine (mirrors rl_sprite.c)
     ──────────────────────────────────────────────────────────────────── */

  /**
   * Create a runtime sprite state object from parsed D2S + D2F data.
   * This is the JS equivalent of firmware's sprite_t + animation bookkeeping.
   *
   * @param {object} d2s  Parsed D2S (from parseD2S)
   * @param {object} d2f  Parsed D2F (from parseD2F)
   * @returns {object}    Runtime sprite state
   */
  static createSpriteState(d2s, d2f) {
    return {
      name:            d2s.header.name,
      d2s,
      d2f,
      currentAnim:     null,      // current animation object (from d2s.animations)
      animIndex:       -1,        // index into d2s.animations
      frameIndex:      0,         // current frame within current animation
      elapsed:         0,         // ms elapsed on current frame
      pingDir:         1,         // +1 forward, -1 reverse (for ping-pong)
      finished:        false,     // true when LOOP_ONCE completed
      x:               0,         // accumulated position (from dx/dy motion)
      y:               0,
    };
  }

  /**
   * Set the active animation by name.
   *
   * @param {object} state   Runtime sprite state (from createSpriteState)
   * @param {string} animName  Animation name to activate
   * @returns {boolean} true if animation was found and set
   */
  static setAnimation(state, animName) {
    const idx = state.d2s.animations.findIndex(a => a.name === animName);
    if (idx < 0) return false;

    if (state.animIndex === idx && state.currentAnim === state.d2s.animations[idx]) {
      return true;
    }

    state.animIndex  = idx;
    state.currentAnim = state.d2s.animations[idx];
    state.frameIndex = 0;
    state.elapsed    = 0;
    state.pingDir    = 1;
    state.finished   = false;
    return true;
  }

  /**
   * Tick the animation forward by deltaMs.
   * Advances frames, applies loop mode, accumulates dx/dy motion.
   *
   * @param {object} state    Runtime sprite state
   * @param {number} deltaMs  Milliseconds since last tick
   * @returns {object|null}   Current D2F frame entry, or null if no animation
   */
  static updateAnimation(state, deltaMs) {
    const anim = state.currentAnim;
    if (!anim || anim.frameCount === 0 || state.finished) {
      return D2Sprite.getCurrentFrame(state);
    }

    state.elapsed += deltaMs;

    // Get current anim-frame's duration
    const af = D2Sprite._getAnimFrame(state);
    const dur = (af && af.duration > 0) ? af.duration : anim.defaultDuration;

    while (state.elapsed >= dur && dur > 0) {
      state.elapsed -= dur;

      // Apply per-frame motion
      const dx = (af && af.dx !== DX_DY_DEFAULT) ? af.dx : anim.dx;
      const dy = (af && af.dy !== DX_DY_DEFAULT) ? af.dy : anim.dy;
      state.x += dx;
      state.y += dy;

      // Advance frame
      D2Sprite._advanceFrame(state);

      if (state.finished) break;
    }

    return D2Sprite.getCurrentFrame(state);
  }

  /**
   * Get the current D2F frame entry for the sprite's active animation frame.
   *
   * @param {object} state  Runtime sprite state
   * @returns {object|null} D2F frame { x, y, w, h, centerX, centerY, ... } or null
   */
  static getCurrentFrame(state) {
    const af = D2Sprite._getAnimFrame(state);
    if (!af) return null;
    return state.d2f.frames[af.frameId] || null;
  }

  /**
   * Get the current animation frame's effective duration.
   *
   * @param {object} state  Runtime sprite state
   * @returns {number} Duration in ms
   */
  static getCurrentDuration(state) {
    const anim = state.currentAnim;
    if (!anim) return 0;
    const af = D2Sprite._getAnimFrame(state);
    return (af && af.duration > 0) ? af.duration : anim.defaultDuration;
  }

  /* ────────────────────────────────────────────────────────────────────
     RENDER: Draw a sprite frame to a 2D canvas
     ──────────────────────────────────────────────────────────────────── */

  /**
   * Draw a single frame from a frame atlas onto a canvas.
   * Uses the source image (HTMLImageElement or ImageBitmap) for pixel data.
   *
   * @param {CanvasRenderingContext2D} ctx  Target canvas context
   * @param {HTMLImageElement|ImageBitmap} sourceImage  The texture source image
   * @param {object} frame  D2F frame entry { x, y, w, h, centerX, centerY, offsetX, offsetY }
   * @param {number} destX  Destination X on canvas
   * @param {number} destY  Destination Y on canvas
   * @param {object} [opts] Rendering options
   * @param {number} [opts.scaleX=1]    Horizontal scale
   * @param {number} [opts.scaleY=1]    Vertical scale
   * @param {number} [opts.rotation=0]  Rotation in radians
   * @param {boolean} [opts.flipX=false] Horizontal mirror
   * @param {boolean} [opts.flipY=false] Vertical mirror
   */
  static drawFrame(ctx, sourceImage, frame, destX, destY, opts = {}) {
    if (!frame || !sourceImage) return;

    const scaleX   = opts.scaleX ?? 1;
    const scaleY   = opts.scaleY ?? 1;
    const rotation = opts.rotation ?? 0;
    const flipX    = opts.flipX ? -1 : 1;
    const flipY    = opts.flipY ? -1 : 1;

    ctx.save();

    // Position at destination + render offset
    ctx.translate(destX + (frame.offsetX || 0), destY + (frame.offsetY || 0));

    // Apply rotation around center of rotation
    if (rotation !== 0) {
      ctx.translate(frame.centerX * scaleX * flipX, frame.centerY * scaleY * flipY);
      ctx.rotate(rotation);
      ctx.translate(-frame.centerX * scaleX * flipX, -frame.centerY * scaleY * flipY);
    }

    // Apply scale + flip
    ctx.scale(scaleX * flipX, scaleY * flipY);

    // Flip correction: if flipped, shift origin so the frame draws correctly
    const drawX = flipX < 0 ? -frame.w : 0;
    const drawY = flipY < 0 ? -frame.h : 0;

    // Draw the sub-rectangle from the source image
    ctx.drawImage(
      sourceImage,
      frame.x, frame.y, frame.w, frame.h,     // source rect
      drawX, drawY, frame.w, frame.h           // dest rect (pre-scaled by ctx)
    );

    ctx.restore();
  }

  /**
   * Convenience: draw the current animation frame of a sprite state.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLImageElement|ImageBitmap} sourceImage
   * @param {object} state  Runtime sprite state
   * @param {number} destX
   * @param {number} destY
   * @param {object} [opts] Same as drawFrame opts
   */
  static drawSprite(ctx, sourceImage, state, destX, destY, opts = {}) {
    const frame = D2Sprite.getCurrentFrame(state);
    if (!frame) return;
    D2Sprite.drawFrame(ctx, sourceImage, frame, destX + state.x, destY + state.y, opts);
  }

  /* ────────────────────────────────────────────────────────────────────
     INTERNAL HELPERS
     ──────────────────────────────────────────────────────────────────── */

  /** Get the current AnimFrame entry from the pool */
  static _getAnimFrame(state) {
    const anim = state.currentAnim;
    if (!anim || state.frameIndex < 0 || state.frameIndex >= anim.frameCount) return null;
    const poolIdx = anim.frameStart + state.frameIndex;
    return state.d2s.animFrames[poolIdx] || null;
  }

  /** Advance frame index according to loop mode */
  static _advanceFrame(state) {
    const anim = state.currentAnim;
    if (!anim) return;

    const last = anim.frameCount - 1;

    switch (anim.loopMode) {
      case LOOP_FORWARD:
        state.frameIndex = (state.frameIndex + 1) % anim.frameCount;
        break;

      case LOOP_REVERSE:
        state.frameIndex--;
        if (state.frameIndex < 0) state.frameIndex = last;
        break;

      case LOOP_PINGPONG:
        state.frameIndex += state.pingDir;
        if (state.frameIndex > last) {
          state.pingDir = -1;
          state.frameIndex = Math.max(last - 1, 0);
        } else if (state.frameIndex < 0) {
          state.pingDir = 1;
          state.frameIndex = Math.min(1, last);
        }
        break;

      case LOOP_ONCE:
        if (state.frameIndex < last) {
          state.frameIndex++;
        } else {
          state.finished = true;
        }
        break;
    }
  }

  /** Read a null-terminated string from a byte array */
  static _readString(bytes, offset, maxLen) {
    let s = '';
    for (let i = 0; i < maxLen; i++) {
      const c = bytes[offset + i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  /** Clamp a number to int8 range [-127, 127] (reserve -128 as sentinel) */
  static _clampI8(v) {
    const n = Math.round(v);
    if (n <= -128) return -127;
    if (n > 127) return 127;
    return n;
  }
}

/* ── Export to global scope ──────────────────────────────────────────── */
window.D2Sprite = D2Sprite;

// Also export constants for consumers
window.D2Sprite.LOOP_FORWARD  = LOOP_FORWARD;
window.D2Sprite.LOOP_REVERSE  = LOOP_REVERSE;
window.D2Sprite.LOOP_PINGPONG = LOOP_PINGPONG;
window.D2Sprite.LOOP_ONCE     = LOOP_ONCE;

window.D2Sprite.D2F_MAGIC       = D2F_MAGIC;
window.D2Sprite.D2S_MAGIC       = D2S_MAGIC;
window.D2Sprite.D2F_HEADER_SIZE = D2F_HEADER_SIZE;
window.D2Sprite.D2S_HEADER_SIZE = D2S_HEADER_SIZE;

console.log('[D2Sprite] Library loaded');
