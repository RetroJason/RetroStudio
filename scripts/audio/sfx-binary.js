// sfx-binary.js
// Binary container formats for RetroStudio sound effects.
//
// The build used to render every `.sfx` file to a 44.1kHz 16-bit WAV, which is
// 88-220KB for an effect whose actual definition is a few dozen bytes. A cart
// with a full 64-slot bank paid megabytes for data that fits in 4KB. These
// formats ship the DEFINITION instead, and the player synthesises it.
//
// Two formats, because there are two kinds of sound effect:
//
//   PICO-8  -> the cart's own 68-byte slot, byte for byte. Not a new encoding:
//              it is exactly what `pico8.js` already writes into ROM at
//              0x3200 + slot * 68, so a player can blit it straight there and
//              firmware needs no conversion step at all.
//
//   Native  -> `RSFX`, a fixed header plus the jsfxr parameter vector as Q15
//              integers. Studio-authored effects are procedural (SFXR), so the
//              parameters ARE the sound; there is nothing else to store.
//
// Both are integer-only by design. The watch has no FPU worth using in an
// audio callback, so nothing here needs floating point to decode.
//
// LOOP SEMANTICS - the one genuinely subtle part.
// PICO-8 overloads its loop pair three ways:
//   loopEnd > loopStart      -> a real loop; loopEnd is EXCLUSIVE
//   loopStart > 0, loopEnd 0 -> "length": play only the first loopStart steps
//   0 / 0                    -> play all 32 steps once
// `.sfx` JSON does NOT store that. `picoSlotToSfxJson` normalises it into an
// INCLUSIVE range plus a separate `loop` flag, which is easier to edit but is a
// different language. This module speaks raw cart semantics on the wire, so the
// translation happens here, once, and `pico-audio.js` - which already
// implements the raw rules - can consume a decoded slot directly.
//
// The normalised form is very slightly more expressive than the cart form: it
// can say "play steps 4..9 once", which PICO-8 cannot encode (a length always
// starts at 0). That combination is unreachable from an import and only
// reachable by hand-editing; it degrades to "play steps 0..9 once".

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SfxBinary = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STEPS_PER_SLOT = 32;
  /** 32 notes at 2 bytes each, then mode/speed/loopStart/loopEnd. */
  const PICO_SLOT_BYTES = 68;
  const PICO_HEADER_OFFSET = STEPS_PER_SLOT * 2;

  const RSFX_MAGIC = 'RSFX';
  const RSFX_VERSION = 1;
  const RSFX_HEADER_BYTES = 8;

  // The wire order of the jsfxr parameter vector. This is a FILE FORMAT: append
  // to the end for a new version, never reorder, never remove. `wave_type` is
  // not here because it is an integer and lives in the header.
  const NATIVE_PARAM_ORDER = Object.freeze([
    'p_base_freq',
    'p_freq_limit',
    'p_freq_ramp',
    'p_freq_dramp',
    'p_env_attack',
    'p_env_sustain',
    'p_env_punch',
    'p_env_decay',
    'p_vib_strength',
    'p_vib_speed',
    'p_arp_mod',
    'p_arp_speed',
    'p_duty',
    'p_duty_ramp',
    'p_repeat_speed',
    'p_pha_offset',
    'p_pha_ramp',
    'p_lpf_freq',
    'p_lpf_ramp',
    'p_lpf_resonance',
    'p_hpf_freq',
    'p_hpf_ramp',
  ]);

  function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clampInt(value, min, max) {
    const n = Math.round(toNumber(value));
    return Math.max(min, Math.min(max, n));
  }

  // ==========================================================================
  // PICO-8 slots
  // ==========================================================================

  /**
   * Turn a `.sfx` file body (or a raw slot) into the cart's 68-byte slot.
   *
   * Accepts either shape because the two exist in the codebase for real
   * reasons: `.sfx` files carry the normalised editor form, while music files
   * embed raw slots straight from `parseP8SfxSection`.
   *
   * @param {object} source - `.sfx` body, its `pico` block, or a raw slot.
   * @returns {Uint8Array} exactly 68 bytes, ready for ROM at 0x3200.
   */
  function encodePicoSlot(source) {
    const spec = (source && source.type === 'pico_sfx' && source.pico) ? source.pico : (source || {});
    const steps = Array.isArray(spec.steps) ? spec.steps : [];

    const out = new Uint8Array(PICO_SLOT_BYTES);

    for (let i = 0; i < STEPS_PER_SLOT; i += 1) {
      const step = steps[i] || {};
      const pitch = clampInt(step.pitch, 0, 63);
      const volume = clampInt(step.volume, 0, 7);
      const effect = clampInt(step.effect ?? step.fx, 0, 7);

      // The instrument nibble is 0-f: the low 3 bits pick a built-in waveform
      // and bit 3 means "use SFX 0-7 as a custom instrument". Dropping bit 3
      // would silently retune every custom-instrument note to a built-in one,
      // so it has to survive even though nothing renders it yet.
      const waveform = clampInt(step.waveform ?? step.wave, 0, 7)
        | ((step.custom || clampInt(step.waveform ?? step.wave, 0, 15) >= 8) ? 0x08 : 0);

      out[i * 2] = (pitch & 0x3f) | ((waveform & 0x03) << 6);
      out[(i * 2) + 1] = ((waveform & 0x04) >> 2)
        | ((volume & 0x07) << 1)
        | ((effect & 0x07) << 4)
        | ((waveform & 0x08) << 4);
    }

    const loop = encodeLoopPair(spec, steps.length || STEPS_PER_SLOT);
    out[PICO_HEADER_OFFSET] = clampInt(spec.mode, 0, 255);
    out[PICO_HEADER_OFFSET + 1] = clampInt(spec.speed || 8, 1, 255);
    out[PICO_HEADER_OFFSET + 2] = loop.start;
    out[PICO_HEADER_OFFSET + 3] = loop.end;

    return out;
  }

  /**
   * Translate whichever loop dialect `spec` is written in into the cart's pair.
   *
   * A raw slot has no `loop` flag, so its pair is already in cart form and is
   * passed through untouched. Anything carrying `loop` came from the editor and
   * needs converting.
   */
  function encodeLoopPair(spec, stepCount) {
    const hasLoopFlag = Object.prototype.hasOwnProperty.call(spec, 'loop');
    if (!hasLoopFlag) {
      return {
        start: clampInt(spec.loopStart, 0, 255),
        end: clampInt(spec.loopEnd, 0, 255),
      };
    }

    const start = clampInt(spec.loopStart, 0, STEPS_PER_SLOT - 1);
    const end = clampInt(spec.loopEnd, 0, STEPS_PER_SLOT - 1);

    // A real loop: cart loopEnd is exclusive, so it sits one past the last step.
    if (spec.loop) return { start, end: Math.min(STEPS_PER_SLOT, end + 1) };

    // Playing every step once is the 0/0 case, not a length of 32 - PICO-8's
    // own editor writes 0/0 there and a length byte of 32 is out of range.
    if (end >= Math.min(stepCount, STEPS_PER_SLOT) - 1) return { start: 0, end: 0 };

    // Otherwise it is a length. The cart form cannot carry a start offset for a
    // non-looping range, so a range that does not begin at 0 loses its offset.
    return { start: end + 1, end: 0 };
  }

  /**
   * Read a 68-byte cart slot back out.
   *
   * The result is in RAW cart semantics, which is exactly what `pico-audio.js`
   * expects, so it can be handed straight to the renderer.
   *
   * @param {Uint8Array|ArrayBuffer} bytes
   * @returns {{mode:number, speed:number, loopStart:number, loopEnd:number, steps:Array}}
   */
  function decodePicoSlot(bytes) {
    const data = toBytes(bytes);
    if (data.length < PICO_SLOT_BYTES) {
      throw new Error(`PICO-8 sfx slot must be ${PICO_SLOT_BYTES} bytes, got ${data.length}`);
    }

    const steps = [];
    for (let i = 0; i < STEPS_PER_SLOT; i += 1) {
      const lo = data[i * 2];
      const hi = data[(i * 2) + 1];
      const waveform = ((lo >> 6) & 0x03) | ((hi & 0x01) << 2) | ((hi >> 4) & 0x08);
      steps.push({
        pitch: lo & 0x3f,
        waveform: waveform & 0x07,
        custom: (waveform & 0x08) !== 0,
        volume: (hi >> 1) & 0x07,
        effect: (hi >> 4) & 0x07,
      });
    }

    return {
      mode: data[PICO_HEADER_OFFSET],
      speed: data[PICO_HEADER_OFFSET + 1],
      loopStart: data[PICO_HEADER_OFFSET + 2],
      loopEnd: data[PICO_HEADER_OFFSET + 3],
      steps,
    };
  }

  // ==========================================================================
  // Studio-native (RSFX)
  // ==========================================================================

  /**
   * Encode a jsfxr parameter set as `RSFX`.
   *
   * Parameters are SFXR slider positions, all within [-1, 1], so Q15 holds them
   * to about 3e-5 - far finer than the UI can express - in two bytes each
   * instead of eight.
   *
   * @param {object} parameters - jsfxr parameters, including `wave_type`.
   * @returns {Uint8Array}
   */
  function encodeNative(parameters) {
    const params = parameters || {};
    const out = new Uint8Array(RSFX_HEADER_BYTES + (NATIVE_PARAM_ORDER.length * 2));
    const view = new DataView(out.buffer);

    for (let i = 0; i < RSFX_MAGIC.length; i += 1) out[i] = RSFX_MAGIC.charCodeAt(i);
    out[4] = RSFX_VERSION;
    out[5] = clampInt(params.wave_type, 0, 255);
    view.setUint16(6, NATIVE_PARAM_ORDER.length, true);

    NATIVE_PARAM_ORDER.forEach((name, index) => {
      view.setInt16(RSFX_HEADER_BYTES + (index * 2), toQ15(params[name]), true);
    });

    return out;
  }

  /**
   * Decode an `RSFX` blob back into jsfxr parameters.
   *
   * Reads only as many parameters as the header declares, so a file written by
   * an older build stays readable when the vector grows: the fields it never
   * knew about simply keep their defaults.
   */
  function decodeNative(bytes) {
    const data = toBytes(bytes);
    if (!isNative(data)) throw new Error('Not an RSFX sound effect');

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const version = data[4];
    if (version > RSFX_VERSION) {
      throw new Error(`RSFX version ${version} is newer than this build understands (${RSFX_VERSION})`);
    }

    const declared = view.getUint16(6, true);
    const available = Math.floor((data.byteLength - RSFX_HEADER_BYTES) / 2);
    const count = Math.min(declared, available, NATIVE_PARAM_ORDER.length);

    const parameters = { wave_type: data[5] };
    for (let i = 0; i < count; i += 1) {
      parameters[NATIVE_PARAM_ORDER[i]] = fromQ15(view.getInt16(RSFX_HEADER_BYTES + (i * 2), true));
    }

    return parameters;
  }

  function isNative(bytes) {
    const data = toBytes(bytes);
    if (data.length < RSFX_HEADER_BYTES) return false;
    for (let i = 0; i < RSFX_MAGIC.length; i += 1) {
      if (data[i] !== RSFX_MAGIC.charCodeAt(i)) return false;
    }
    return true;
  }

  /** Q15: the whole [-1, 1] range across a signed 16-bit integer. */
  function toQ15(value) {
    const scaled = Math.round(toNumber(value) * 32767);
    return Math.max(-32768, Math.min(32767, scaled));
  }

  function fromQ15(raw) {
    return raw / 32767;
  }

  // ==========================================================================
  // Dispatch
  // ==========================================================================

  /**
   * Encode a parsed `.sfx` file body into whichever binary form suits it.
   * @returns {{ format: 'pico'|'native', bytes: Uint8Array }}
   */
  function encode(sfxBody) {
    const body = sfxBody || {};
    if (body.type === 'pico_sfx' || body.pico) {
      return { format: 'pico', bytes: encodePicoSlot(body) };
    }
    return { format: 'native', bytes: encodeNative(body.parameters || body) };
  }

  /**
   * Decode either binary form.
   *
   * `RSFX` is self-identifying. A PICO-8 slot deliberately is not - it is the
   * cart's own bytes with nothing added - so it is recognised by its length,
   * which cannot collide because RSFX always leads with its magic.
   *
   * @returns {{ format: 'pico'|'native', slot?: object, parameters?: object }}
   */
  function decode(bytes) {
    const data = toBytes(bytes);
    if (isNative(data)) return { format: 'native', parameters: decodeNative(data) };
    if (data.length === PICO_SLOT_BYTES) return { format: 'pico', slot: decodePicoSlot(data) };
    throw new Error(`Unrecognised sfx binary: ${data.length} bytes, no RSFX magic`);
  }

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new Error('Expected binary data for an sfx blob');
  }

  return {
    PICO_SLOT_BYTES,
    RSFX_MAGIC,
    RSFX_VERSION,
    NATIVE_PARAM_ORDER,
    encode,
    decode,
    encodePicoSlot,
    decodePicoSlot,
    encodeNative,
    decodeNative,
    isNative,
  };
}));
