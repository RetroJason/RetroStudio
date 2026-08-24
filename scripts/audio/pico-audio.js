// pico-audio.js
// Shared PICO-8 audio synthesis for RetroStudio.
//
// One implementation of the PICO-8 SFX/music renderer, used by the `.p8mus`
// viewer, the runtime `music()`/`sfx()` Lua bindings and the SFX builder.
// Ported from the validated converter lab (sandbox/pico8-converter-lab.html).
//
// Data shapes accepted here:
//   slot    - { speed, loopStart, loopEnd, steps: [{ pitch, waveform, volume, effect }] }
//             (also accepts a `.sfx` file body: { type: 'pico_sfx', pico: { ... } })
//   pattern - { index, flags, channels: [slotIndex|-1, ...4] }
//             (also accepts the lab's [{ slot, muted }] channel form)
//   slots   - array or object keyed by PICO-8 slot index
//
// PICO-8 loop semantics, which everything below depends on:
//   - loopEnd > loopStart      -> a real loop, loopEnd is EXCLUSIVE
//   - loopStart > 0, loopEnd 0 -> "length": play only the first loopStart steps
//   - 0 / 0                    -> play all 32 steps once

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.PicoAudio = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // PICO-8 runs its audio clock at 120 ticks per second.
  const DEFAULT_TICK_RATE = 120;
  const STEPS_PER_SLOT = 32;
  // Matches the lab/builder output level so imported audio is not clipped when
  // four channels stack on top of each other.
  const CHANNEL_GAIN = 0.28;

  // Pattern flow flags stored in the leading byte of a __music__ line.
  const FLAG_LOOP_START = 0x01;
  const FLAG_LOOP_BACK = 0x02;
  const FLAG_STOP = 0x04;

  // 22050 / freq(key 63): scales the noise lowpass so its cutoff tracks pitch.
  const NOISE_TIME_SCALE = 8.858923;

  function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  /** PICO-8 pitch 0 is C-0 = 65.41 Hz, which is MIDI note 36. */
  function pitchToHz(pitch) {
    return 440 * Math.pow(2, ((36 + toNumber(pitch)) - 69) / 12);
  }

  /** The eight PICO-8 waveforms, evaluated at a normalised phase. */
  function waveSample(phase, waveform, noise) {
    const p = phase - Math.floor(phase);
    switch (waveform & 0x07) {
      case 0: return 1 - (4 * Math.abs(p - 0.5));
      case 1: return (p < 0.85) ? ((p / 0.85) * 2 - 1) : (((1 - p) / 0.15) * 2 - 1);
      case 2: return (2 * p) - 1;
      case 3: return p < 0.5 ? 1 : -1;
      case 4: return p < 0.25 ? 1 : -1;
      case 5: return (0.6 * Math.sin(2 * Math.PI * p)) + (0.4 * Math.sin(4 * Math.PI * p));
      case 6: return noiseSample(phase, noise);
      case 7: return (0.7 * Math.sin(2 * Math.PI * p)) + (0.3 * Math.sin(6 * Math.PI * p));
      default: return (2 * p) - 1;
    }
  }

  /**
   * PICO-8's noise is not white noise: it is white noise through a one-pole
   * lowpass whose cutoff follows the note, so low notes rumble and high notes
   * hiss. A plain Math.random() per sample ignores pitch entirely and makes
   * every noise slot sound like the same flat hiss.
   *
   * Constants come from zepto8's reverse-engineered synth: the filter
   * coefficient is the phase advance scaled by 22050 / freq(key 63), and the
   * output is boosted for low keys to compensate for the heavier filtering.
   */
  function noiseSample(phase, noise) {
    const state = noise || { lastPhase: phase, lastSample: 0, key: 0 };
    const scale = Math.max(0, phase - state.lastPhase) * NOISE_TIME_SCALE;
    const sample = (state.lastSample + (scale * ((Math.random() * 2) - 1))) / (1 + scale);
    state.lastSample = sample;
    const factor = 1 - (Math.max(0, Math.min(63, state.key)) / 63);
    return sample * 1.5 * (1 + (factor * factor));
  }

  /** Accepts a raw slot or a `.sfx` file body and returns the raw slot form. */
  function normalizeSlot(raw) {
    if (!raw) return null;
    const source = (raw.type === 'pico_sfx' && raw.pico) ? raw.pico : raw;
    const steps = Array.isArray(source.steps) ? source.steps : [];
    if (steps.length === 0) return null;

    return {
      speed: Math.max(1, toNumber(source.speed, 8)),
      loopStart: Math.max(0, toNumber(source.loopStart)),
      loopEnd: Math.max(0, toNumber(source.loopEnd)),
      steps: steps.map((step) => ({
        pitch: toNumber(step && step.pitch),
        waveform: toNumber(step && (step.waveform ?? step.wave)) & 0x07,
        volume: Math.max(0, Math.min(7, toNumber(step && step.volume))),
        effect: Math.max(0, Math.min(7, toNumber(step && (step.effect ?? step.fx)))),
      })),
    };
  }

  function slotIsLooping(slot) {
    return toNumber(slot && slot.loopEnd) > toNumber(slot && slot.loopStart);
  }

  /**
   * How many of the 32 steps actually play. When only loopStart is set,
   * PICO-8 treats it as a length, which is how carts get time signatures
   * like 3/4 out of a 32 step slot.
   */
  function slotPlayLength(slot) {
    const steps = (slot && Array.isArray(slot.steps)) ? slot.steps.length : 0;
    if (steps === 0) return 0;
    const loopStart = toNumber(slot.loopStart);
    const loopEnd = toNumber(slot.loopEnd);
    if (loopEnd === 0 && loopStart > 0) return Math.min(steps, loopStart);
    return steps;
  }

  function slotStepSamples(slot, sampleRate, tickRate) {
    const speed = Math.max(1, toNumber(slot && slot.speed, 1));
    return Math.max(1, Math.floor((speed / tickRate) * sampleRate));
  }

  function slotIsAudible(slot) {
    return Boolean(slot) && slot.steps.some((step) => step.volume > 0);
  }

  /** Duration in seconds of one full pass through a slot. */
  function slotDuration(slot, tickRate = DEFAULT_TICK_RATE) {
    const normalized = normalizeSlot(slot);
    if (!normalized) return 0;
    return (slotPlayLength(normalized) * Math.max(1, normalized.speed)) / tickRate;
  }

  /**
   * Synthesize one SFX slot from step 0 for its full play length.
   * This is the note source for both `sfx(n)` and music patterns.
   */
  function renderSfxSlot(rawSlot, sampleRate = 44100, tickRate = DEFAULT_TICK_RATE) {
    const slot = normalizeSlot(rawSlot);
    const stepCount = slot ? slotPlayLength(slot) : 0;
    if (stepCount === 0) return new Float32Array(0);

    const stepSamples = slotStepSamples(slot, sampleRate, tickRate);
    const out = new Float32Array(stepSamples * stepCount);
    let phase = 0;
    const noise = { lastPhase: 0, lastSample: 0, key: 0 };

    for (let si = 0; si < stepCount; si += 1) {
      const step = slot.steps[si];
      const next = slot.steps[Math.min(stepCount - 1, si + 1)] || step;
      const baseHz = pitchToHz(step.pitch);
      const nextHz = pitchToHz(next.pitch);
      const volume = step.volume / 7;
      const fx = step.effect;
      const waveform = step.waveform;
      noise.key = step.pitch;

      for (let i = 0; i < stepSamples; i += 1) {
        const t = i / stepSamples;
        let hz = baseHz;

        if (fx === 1) {
          // Slide toward the next step's pitch.
          hz = baseHz + ((nextHz - baseHz) * t);
        } else if (fx === 2) {
          hz = baseHz * (1 + (0.03 * Math.sin(2 * Math.PI * 6 * t)));
        } else if (fx === 3) {
          hz = baseHz * Math.max(0.1, 1 - (0.9 * t));
        } else if (fx === 6 || fx === 7) {
          const arp = [0, 4, 7, 12];
          const rate = fx === 6 ? 16 : 8;
          hz = baseHz * Math.pow(2, arp[Math.floor(t * rate) % arp.length] / 12);
        }

        phase += hz / sampleRate;
        let amp = volume;
        if (fx === 4) amp *= t;
        if (fx === 5) amp *= (1 - t);

        out[(si * stepSamples) + i] = waveSample(phase, waveform, noise) * amp * CHANNEL_GAIN;
        noise.lastPhase = phase;
      }
    }

    return out;
  }

  function lookupSlot(slots, index) {
    if (!slots || index < 0) return null;
    const raw = Array.isArray(slots) ? slots[index] : slots[index] ?? slots[String(index)];
    return normalizeSlot(raw);
  }

  /**
   * Resolve one pattern channel, accepting both the numeric and object forms.
   *
   * A slot whose every step is silent is kept, not dropped. Composers use an
   * empty SFX with a chosen speed as a rest, and because a pattern's length is
   * taken from its channels, that rest is often the only thing setting the
   * length. Dropping it does not just lose silence - it collapses the pattern
   * to nothing, and renderSong() then treats the song as finished.
   */
  function channelSlot(channel, slots) {
    if (channel === null || channel === undefined) return null;
    let index = channel;
    if (typeof channel === 'object') {
      if (channel.muted) return null;
      index = channel.slot;
    }
    index = toNumber(index, -1);
    if (index < 0) return null;

    return lookupSlot(slots, index);
  }

  /**
   * The channel indices a pattern actually plays on.
   *
   * PICO-8 gives a song the channels its pattern needs, which cuts off any sfx
   * still sounding on them. A cart can rely on that: dinky_kong's title fires a
   * long noise sfx and a short tonal one, then starts a song that occupies the
   * noise's channel, so on real hardware the noise is silenced almost at once.
   */
  function patternChannels(pattern, slots) {
    const channels = (pattern && pattern.channels) || [];
    const used = [];
    channels.forEach((channel, index) => {
      if (channelSlot(channel, slots)) used.push(index);
    });
    return used;
  }

  /**
   * Work out which channels play and how long a pattern lasts. Looping
   * channels repeat to fill; the length is set by the first non-looping
   * channel, falling back to the longest channel.
   */
  function patternPlan(pattern, slots, sampleRate, tickRate = DEFAULT_TICK_RATE) {
    const entries = [];
    const channels = (pattern && pattern.channels) || [];

    channels.forEach((channel, index) => {
      const slot = channelSlot(channel, slots);
      if (!slot) return;
      entries.push({
        channel: index,
        slot,
        loops: slotIsLooping(slot),
        samples: slotStepSamples(slot, sampleRate, tickRate) * slotPlayLength(slot),
      });
    });

    if (entries.length === 0) return { entries, totalSamples: 0, leader: -1 };

    const leader = entries.find((entry) => !entry.loops);
    return {
      entries,
      totalSamples: leader ? leader.samples : Math.max(...entries.map((e) => e.samples)),
      leader: leader ? leader.channel : -1,
    };
  }

  /** Mix all channels of one pattern into a single buffer. */
  function renderPattern(pattern, slots, sampleRate = 44100, tickRate = DEFAULT_TICK_RATE, cache = null) {
    const plan = patternPlan(pattern, slots, sampleRate, tickRate);
    const out = new Float32Array(plan.totalSamples);
    if (plan.totalSamples === 0) return out;

    for (const entry of plan.entries) {
      // Patterns reuse the same slots constantly, so only synthesize each once.
      let rendered = cache ? cache.get(entry.slot) : null;
      if (!rendered) {
        rendered = renderSfxSlot(entry.slot, sampleRate, tickRate);
        if (cache) cache.set(entry.slot, rendered);
      }
      if (rendered.length === 0) continue;

      if (!entry.loops) {
        const count = Math.min(rendered.length, out.length);
        for (let i = 0; i < count; i += 1) out[i] += rendered[i];
        continue;
      }

      const stepSamples = slotStepSamples(entry.slot, sampleRate, tickRate);
      const loopStart = Math.min(rendered.length - 1, toNumber(entry.slot.loopStart) * stepSamples);
      const loopEnd = Math.min(
        rendered.length,
        Math.max(loopStart + stepSamples, toNumber(entry.slot.loopEnd) * stepSamples)
      );
      const loopLength = Math.max(1, loopEnd - loopStart);

      for (let i = 0; i < out.length; i += 1) {
        const source = i < loopEnd ? i : loopStart + ((i - loopEnd) % loopLength);
        out[i] += rendered[source] || 0;
      }
    }

    for (let i = 0; i < out.length; i += 1) {
      out[i] = Math.max(-1, Math.min(1, out[i]));
    }
    return out;
  }

  /**
   * Walk the pattern list from startIndex honouring the flow flags, and return
   * the mixed song plus a timeline and loop point for playhead tracking.
   */
  function renderSong(patterns, startIndex, slots, sampleRate = 44100, tickRate = DEFAULT_TICK_RATE, options = {}) {
    const list = Array.isArray(patterns) ? patterns : [];
    const maxSamples = Math.floor(Math.max(1, toNumber(options.maxSeconds, 240)) * sampleRate);
    const cache = new Map();
    const chunks = [];
    const timeline = [];
    let total = 0;
    let loopStartSample = null;
    let loopsBack = false;
    let truncated = false;

    for (let index = startIndex; index >= 0 && index < list.length; index += 1) {
      if (total >= maxSamples) {
        truncated = true;
        break;
      }

      const pattern = list[index];
      const flags = toNumber(pattern && pattern.flags);
      if (flags & FLAG_LOOP_START) loopStartSample = total;

      const samples = renderPattern(pattern, slots, sampleRate, tickRate, cache);
      // Only a pattern with no channels at all is zero length, and that is how
      // the cart separates one song from the next. A pattern that is merely
      // silent still has a duration and must not stop playback.
      if (samples.length === 0) break;

      chunks.push(samples);
      timeline.push({
        pattern: toNumber(pattern.index, index),
        startSample: total,
        endSample: total + samples.length,
      });
      total += samples.length;

      if (flags & FLAG_STOP) break;
      if (flags & FLAG_LOOP_BACK) {
        loopsBack = true;
        break;
      }
    }

    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    return {
      samples: merged,
      timeline,
      truncated,
      sampleRate,
      // Only patterns reached by playback can set the loop point; if a
      // LOOP_BACK was seen without a LOOP_START, PICO-8 returns to the start.
      loopStartSample: loopsBack ? (loopStartSample === null ? 0 : loopStartSample) : null,
    };
  }

  /** Parse a `.p8mus` file body (JSON text or object) into a playable song. */
  function parseP8Mus(source) {
    let spec = source;
    if (typeof spec === 'string') {
      spec = JSON.parse(spec);
    }
    if (!spec || spec.type !== 'pico_music') {
      throw new Error('Not a pico_music (.p8mus) resource');
    }

    const song = spec.song || {};
    const patterns = Array.isArray(song.patterns) ? song.patterns : [];
    if (patterns.length === 0) {
      throw new Error('.p8mus resource contains no patterns');
    }

    return {
      name: spec.name || null,
      sourceFile: spec.sourceFile || null,
      start: toNumber(song.start, patterns[0].index),
      end: toNumber(song.end, patterns[patterns.length - 1].index),
      loopTo: song.loopTo === null || song.loopTo === undefined ? null : toNumber(song.loopTo),
      patterns,
      slots: spec.sfx || {},
    };
  }

  /**
   * Parse a built `.d2mu` song into the same shape `parseP8Mus` returns, so
   * everything downstream is unaware of which one it came from.
   *
   * This is the format the watch plays. Reading it here as well means the
   * simulator exercises the real build output rather than the source JSON,
   * so a builder bug is audible in the Studio instead of only on the device.
   * The layout is DocsSource/music_format.md; the C++ twin is
   * libretrostudio/src/PicoMusic.cpp.
   */
  function parseD2mu(source, name = null) {
    let bytes = source;
    if (bytes instanceof ArrayBuffer) {
      bytes = new Uint8Array(bytes);
    } else if (ArrayBuffer.isView(bytes)) {
      bytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    if (!(bytes instanceof Uint8Array)) {
      throw new Error('.d2mu source must be binary');
    }

    const HEADER_BYTES = 32;
    const CHUNK_HEADER_BYTES = 4;

    if (bytes.length < HEADER_BYTES) {
      throw new Error('Too small to be a .d2mu');
    }
    if (bytes[0] !== 0x44 || bytes[1] !== 0x32 || bytes[2] !== 0x4D || bytes[3] !== 0x55) {
      throw new Error('Not a .d2mu resource (bad magic)');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint8(4);
    if (version !== 1) {
      throw new Error(`Unsupported .d2mu version ${version}`);
    }

    const channelCount = view.getUint8(5);
    const stepsPerSlot = view.getUint8(6);
    const patternChunk = view.getUint32(16, true);
    const slotChunk = view.getUint32(20, true);

    if (patternChunk + CHUNK_HEADER_BYTES > bytes.length
      || slotChunk + CHUNK_HEADER_BYTES > bytes.length) {
      throw new Error('.d2mu chunk offset past end of file');
    }

    const patternCount = view.getUint16(patternChunk, true);
    // Stride by the size in the file, not our own, so a later minor version
    // that grows a record still loads.
    const patternStride = view.getUint16(patternChunk + 2, true);
    const slotCount = view.getUint16(slotChunk, true);
    const slotStride = view.getUint16(slotChunk + 2, true);

    if (patternChunk + CHUNK_HEADER_BYTES + (patternCount * patternStride) > bytes.length
      || slotChunk + CHUNK_HEADER_BYTES + (slotCount * slotStride) > bytes.length) {
      throw new Error('.d2mu chunk data past end of file');
    }
    if (patternCount === 0) {
      throw new Error('.d2mu resource contains no patterns');
    }

    const slots = {};
    for (let i = 0; i < slotCount; i += 1) {
      const base = slotChunk + CHUNK_HEADER_BYTES + (i * slotStride);
      const steps = [];
      for (let s = 0; s < stepsPerSlot; s += 1) {
        const packed = view.getUint16(base + 4 + (s * 2), true);
        steps.push({
          pitch: packed & 0x3F,
          waveform: (packed >> 6) & 0x07,
          volume: (packed >> 9) & 0x07,
          effect: (packed >> 12) & 0x07,
        });
      }
      slots[view.getUint8(base)] = {
        speed: view.getUint8(base + 1),
        loopStart: view.getUint8(base + 2),
        loopEnd: view.getUint8(base + 3),
        steps,
      };
    }

    const patterns = [];
    for (let i = 0; i < patternCount; i += 1) {
      const base = patternChunk + CHUNK_HEADER_BYTES + (i * patternStride);
      const channels = [];
      for (let c = 0; c < channelCount; c += 1) {
        channels.push(view.getInt8(base + 2 + c));
      }
      const flags = view.getUint8(base + 1) & 0x07;
      patterns.push({
        index: view.getUint8(base),
        flags,
        loopStart: Boolean(flags & FLAG_LOOP_START),
        loopEnd: Boolean(flags & FLAG_LOOP_BACK),
        stop: Boolean(flags & FLAG_STOP),
        channels,
      });
    }

    const loopTo = view.getInt8(12);

    return {
      name,
      sourceFile: null,
      start: view.getUint8(10),
      end: view.getUint8(11),
      loopTo: loopTo < 0 ? null : loopTo,
      tickRate: view.getUint16(8, true) || DEFAULT_TICK_RATE,
      patterns,
      slots,
    };
  }

  /** True when a buffer carries the `.d2mu` magic. */
  function isD2mu(source) {
    let bytes = source;
    if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
    else if (ArrayBuffer.isView(bytes)) bytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (!(bytes instanceof Uint8Array) || bytes.length < 4) return false;
    return bytes[0] === 0x44 && bytes[1] === 0x32 && bytes[2] === 0x4D && bytes[3] === 0x55;
  }

  /**
   * Parse either a `.p8mus` source or a built `.d2mu`, whichever it is.
   * Callers that just want to play a song should use this.
   */
  function parseSong(source, name = null) {
    if (isD2mu(source)) return parseD2mu(source, name);
    return parseP8Mus(source);
  }

  /** Render a `.p8mus` file body straight to samples. */
  function renderP8Mus(source, sampleRate = 44100, tickRate = DEFAULT_TICK_RATE, options = {}) {
    const parsed = parseP8Mus(source);
    const rendered = renderSong(parsed.patterns, 0, parsed.slots, sampleRate, tickRate, options);
    return { ...rendered, song: parsed };
  }

  /** Total duration of a `.p8mus` song in seconds, without synthesizing it. */
  function estimateP8MusDuration(source, tickRate = DEFAULT_TICK_RATE) {
    const parsed = parseP8Mus(source);
    let seconds = 0;
    for (const pattern of parsed.patterns) {
      const plan = patternPlan(pattern, parsed.slots, 44100, tickRate);
      seconds += plan.totalSamples / 44100;
    }
    return seconds;
  }

  return {
    DEFAULT_TICK_RATE,
    STEPS_PER_SLOT,
    FLAG_LOOP_START,
    FLAG_LOOP_BACK,
    FLAG_STOP,
    pitchToHz,
    waveSample,
    normalizeSlot,
    slotIsLooping,
    slotPlayLength,
    slotStepSamples,
    slotIsAudible,
    slotDuration,
    renderSfxSlot,
    channelSlot,
    patternChannels,
    patternPlan,
    renderPattern,
    renderSong,
    parseP8Mus,
    parseD2mu,
    parseSong,
    isD2mu,
    renderP8Mus,
    estimateP8MusDuration,
  };
}));
