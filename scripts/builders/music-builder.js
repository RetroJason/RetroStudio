// music-builder.js
// Build-time PICO-8 song processor: reads `.p8mus` JSON and emits the `.d2mu`
// binary the runtime plays. See DocsSource/music_format.md for the format, and
// libretrostudio/src/PicoMusic.cpp for the reader this output has to satisfy.
//
// The source JSON stays as it is; only the packaged artefact changes. Before
// this builder existed the build system's CopyBuilder put the JSON straight
// into the archive, which the firmware cannot read - it has no JSON parser.

console.log('[MusicBuilder] Class definition loading');

class MusicBuilder extends BaseBuilder {
  static get MAGIC() { return 'D2MU'; }
  static get VERSION() { return 1; }
  static get CHANNELS() { return 4; }
  static get STEPS_PER_SLOT() { return 32; }
  static get TICK_RATE() { return 120; }

  static get HEADER_BYTES() { return 32; }
  static get CHUNK_HEADER_BYTES() { return 4; }
  static get PATTERN_RECORD_BYTES() { return 8; }
  static get SLOT_RECORD_BYTES() { return 68; }

  async build(file) {
    const tag = '[MusicBuilder]';
    try {
      console.log(`${tag} Processing: ${file.path}`);

      const source = this.parseP8MusJson(file.content, file.path);
      const song = this.normalizeSong(source, file.path);
      const bytes = this.buildD2MU(song);
      const outputPath = this.toBuildPath(file.path.replace(/\.p8mus$/i, '.d2mu'));

      await this.saveBinary(outputPath, bytes);

      console.log(`${tag} ✓ ${file.path} -> ${outputPath} (${bytes.length} bytes, `
        + `${song.patterns.length} pattern(s), ${song.slots.length} slot(s))`);

      return {
        success: true,
        inputPath: file.path,
        outputPath,
        outputs: [outputPath],
        builder: 'music',
        meta: {
          patternCount: song.patterns.length,
          slotCount: song.slots.length,
          start: song.start,
          end: song.end,
          loopTo: song.loopTo,
          binarySize: bytes.length,
        },
      };
    } catch (error) {
      console.error(`${tag} ✗ ${file.path}: ${error.message}`);
      return {
        success: false,
        inputPath: file.path,
        error: error.message,
        builder: 'music',
      };
    }
  }

  parseP8MusJson(content, filePath) {
    let parsed = null;
    if (typeof content === 'string') {
      parsed = JSON.parse(content);
    } else if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
      const bytes = content instanceof ArrayBuffer
        ? new Uint8Array(content)
        : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
      parsed = JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } else if (content && typeof content === 'object') {
      parsed = content;
    } else {
      throw new Error(`Unexpected music content type in ${filePath}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`Invalid .p8mus JSON object in ${filePath}`);
    }

    // A wrong type here means the importer produced something broken. Failing
    // the build is a much better way to find that out than a silent song.
    if (parsed.type !== 'pico_music') {
      throw new Error(`${filePath} is not a pico_music resource (type: ${parsed.type || 'missing'})`);
    }

    return parsed;
  }

  /**
   * Lower the source JSON to the exact records the binary holds.
   *
   * Channel resolution happens here rather than at write time because a
   * channel that resolves to nothing has to become -1 *before* the slot set is
   * collected - otherwise the file carries a slot no pattern actually plays.
   */
  normalizeSong(spec, filePath) {
    const songSpec = spec.song || {};
    const rawPatterns = Array.isArray(songSpec.patterns) ? songSpec.patterns : [];
    if (rawPatterns.length === 0) {
      throw new Error(`${filePath} contains no patterns`);
    }
    if (rawPatterns.length > 255) {
      throw new Error(`${filePath} has ${rawPatterns.length} patterns, more than the 255 the format allows`);
    }

    const sfx = spec.sfx || {};
    const usedSlots = new Set();

    const patterns = rawPatterns.map((raw, i) => {
      const channels = [];
      const rawChannels = Array.isArray(raw && raw.channels) ? raw.channels : [];

      for (let c = 0; c < MusicBuilder.CHANNELS; c++) {
        const slot = this.resolveChannel(rawChannels[c], sfx, filePath, i, c);
        channels.push(slot);
        if (slot >= 0) usedSlots.add(slot);
      }

      return {
        index: this.clampU8(raw && raw.index, 0),
        // Only the low three bits are flow control; anything above is not ours.
        flags: this.clampU8(raw && raw.flags, 0) & 0x07,
        channels,
      };
    });

    const slots = Array.from(usedSlots)
      .sort((a, b) => a - b)
      .map((slotNumber) => this.normalizeSlot(slotNumber, this.lookupSfx(sfx, slotNumber)));

    const firstIndex = patterns[0].index;
    const lastIndex = patterns[patterns.length - 1].index;
    const loopToRaw = songSpec.loopTo;

    return {
      name: typeof spec.name === 'string' ? spec.name : null,
      start: this.clampU8(songSpec.start, firstIndex),
      end: this.clampU8(songSpec.end, lastIndex),
      // -1 is "does not loop"; the field is signed for exactly this reason.
      loopTo: (loopToRaw === null || loopToRaw === undefined || Number(loopToRaw) < 0)
        ? -1
        : Math.min(127, this.clampU8(loopToRaw, 0)),
      patterns,
      slots,
    };
  }

  lookupSfx(sfx, slotNumber) {
    if (!sfx) return null;
    if (Array.isArray(sfx)) return sfx[slotNumber] || null;
    return sfx[slotNumber] ?? sfx[String(slotNumber)] ?? null;
  }

  /**
   * Turn one pattern channel into a slot number, or -1 for silence.
   *
   * This mirrors `channelSlot()` in scripts/audio/pico-audio.js, and it has to:
   * a pattern's play length is derived from its channels, so a channel the
   * Studio drops but the build keeps makes the pattern the wrong length on the
   * watch. That is a tempo bug, not a missing-note bug, and it is hard to hear
   * as a cause.
   */
  resolveChannel(rawChannel, sfx, filePath, patternIndex, channelIndex) {
    if (rawChannel === null || rawChannel === undefined) return -1;

    let index = rawChannel;
    if (typeof rawChannel === 'object') {
      if (rawChannel.muted) return -1;
      index = rawChannel.slot;
    }

    index = Number(index);
    if (!Number.isFinite(index)) return -1;
    index = Math.trunc(index);
    if (index < 0) return -1;

    const where = `${filePath} pattern ${patternIndex} channel ${channelIndex}`;
    if (index > 63) {
      console.warn(`[MusicBuilder] ${where} references slot ${index}, above the 63 a cart has - writing silence`);
      return -1;
    }

    const slotSource = this.lookupSfx(sfx, index);
    if (!slotSource) {
      console.warn(`[MusicBuilder] ${where} references slot ${index}, which the source does not define - writing silence`);
      return -1;
    }

    const steps = this.sourceSteps(slotSource);
    if (steps.length === 0) {
      console.warn(`[MusicBuilder] ${where} references slot ${index}, which has no steps - writing silence`);
      return -1;
    }

    // An entirely silent slot is dropped rather than carried. Carts leave these
    // behind routinely, so this is normal and not worth warning about.
    const audible = steps.some((step) => this.clamp3(step && step.volume) > 0);
    if (!audible) return -1;

    return index;
  }

  /** The raw step array, accepting the `.sfx` file wrapper as well as a bare slot. */
  sourceSteps(slotSource) {
    const source = (slotSource && slotSource.type === 'pico_sfx' && slotSource.pico)
      ? slotSource.pico
      : slotSource;
    return Array.isArray(source && source.steps) ? source.steps : [];
  }

  normalizeSlot(slotNumber, slotSource) {
    const source = (slotSource && slotSource.type === 'pico_sfx' && slotSource.pico)
      ? slotSource.pico
      : slotSource;
    const rawSteps = this.sourceSteps(slotSource);

    const steps = new Uint16Array(MusicBuilder.STEPS_PER_SLOT);
    const count = Math.min(rawSteps.length, MusicBuilder.STEPS_PER_SLOT);
    for (let i = 0; i < count; i++) {
      steps[i] = this.packStep(rawSteps[i]);
    }
    // Steps past the play length stay zero: a fixed 32-step record keeps the
    // chunk a flat array, which is worth the 60-odd bytes it costs.

    const speedRaw = Math.trunc(Number(source && source.speed));
    const speed = Number.isFinite(speedRaw) ? Math.max(1, Math.min(255, speedRaw)) : 1;

    return {
      cartSlot: slotNumber,
      speed,
      // Copied verbatim, NOT normalised into one representation. loopStart with
      // a zero loopEnd means "length", and the runtime and pico-audio.js both
      // implement that table - they have to agree with each other, so the
      // builder must not quietly pick a side.
      loopStart: this.clampRange(source && source.loopStart, 0, MusicBuilder.STEPS_PER_SLOT),
      loopEnd: this.clampRange(source && source.loopEnd, 0, MusicBuilder.STEPS_PER_SLOT),
      steps,
    };
  }

  /**
   * value = pitch | (waveform << 6) | (volume << 9) | (effect << 12)
   *
   * `wave` and `fx` are accepted as aliases because the SFX editor writes the
   * short names and pico-audio.js already takes both.
   */
  packStep(step) {
    if (!step || typeof step !== 'object') return 0;

    const pitch = this.clampRange(step.pitch, 0, 63);
    const waveform = this.clamp3(step.waveform ?? step.wave);
    const volume = this.clamp3(step.volume);
    const effect = this.clamp3(step.effect ?? step.fx);

    return (pitch | (waveform << 6) | (volume << 9) | (effect << 12)) & 0xFFFF;
  }

  clamp3(value) {
    return this.clampRange(value, 0, 7);
  }

  clampRange(value, min, max) {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  clampU8(value, fallback) {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(255, n));
  }

  buildD2MU(song) {
    const patternCount = song.patterns.length;
    const slotCount = song.slots.length;

    const patternChunkOffset = MusicBuilder.HEADER_BYTES;
    const patternChunkBytes = MusicBuilder.CHUNK_HEADER_BYTES
      + (patternCount * MusicBuilder.PATTERN_RECORD_BYTES);

    // Derived from the pattern chunk rather than restated, so the offset in the
    // header and the position of the bytes cannot drift apart.
    const slotChunkOffset = patternChunkOffset + patternChunkBytes;
    const slotChunkBytes = MusicBuilder.CHUNK_HEADER_BYTES
      + (slotCount * MusicBuilder.SLOT_RECORD_BYTES);

    const out = new Uint8Array(slotChunkOffset + slotChunkBytes);
    const view = new DataView(out.buffer);

    // ── Header ──────────────────────────────────────────────────────────
    out[0] = 0x44; // D
    out[1] = 0x32; // 2
    out[2] = 0x4D; // M
    out[3] = 0x55; // U
    view.setUint8(4, MusicBuilder.VERSION);
    view.setUint8(5, MusicBuilder.CHANNELS);
    view.setUint8(6, MusicBuilder.STEPS_PER_SLOT);
    view.setUint8(7, 0); // flags, reserved
    view.setUint16(8, MusicBuilder.TICK_RATE, true);
    view.setUint8(10, song.start);
    view.setUint8(11, song.end);
    view.setInt8(12, song.loopTo);
    view.setUint8(13, 0); // reserved
    view.setUint16(14, 0, true); // reserved
    view.setUint32(16, patternChunkOffset, true);
    view.setUint32(20, slotChunkOffset, true);
    view.setUint32(24, 0, true); // reserved
    view.setUint32(28, 0, true); // reserved

    // ── Pattern chunk ───────────────────────────────────────────────────
    view.setUint16(patternChunkOffset, patternCount, true);
    view.setUint16(patternChunkOffset + 2, MusicBuilder.PATTERN_RECORD_BYTES, true);

    for (let i = 0; i < patternCount; i++) {
      const pattern = song.patterns[i];
      const base = patternChunkOffset + MusicBuilder.CHUNK_HEADER_BYTES
        + (i * MusicBuilder.PATTERN_RECORD_BYTES);

      view.setUint8(base + 0, pattern.index);
      view.setUint8(base + 1, pattern.flags);
      for (let c = 0; c < MusicBuilder.CHANNELS; c++) {
        view.setInt8(base + 2 + c, pattern.channels[c]);
      }
      view.setUint16(base + 6, 0, true); // reserved
    }

    // ── Slot chunk ──────────────────────────────────────────────────────
    view.setUint16(slotChunkOffset, slotCount, true);
    view.setUint16(slotChunkOffset + 2, MusicBuilder.SLOT_RECORD_BYTES, true);

    for (let i = 0; i < slotCount; i++) {
      const slot = song.slots[i];
      const base = slotChunkOffset + MusicBuilder.CHUNK_HEADER_BYTES
        + (i * MusicBuilder.SLOT_RECORD_BYTES);

      view.setUint8(base + 0, slot.cartSlot);
      view.setUint8(base + 1, slot.speed);
      view.setUint8(base + 2, slot.loopStart);
      view.setUint8(base + 3, slot.loopEnd);
      for (let s = 0; s < MusicBuilder.STEPS_PER_SLOT; s++) {
        view.setUint16(base + 4 + (s * 2), slot.steps[s], true);
      }
    }

    return out;
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

    throw new Error('No file service available to save music build output');
  }
}

console.log('[MusicBuilder] Class defined');

(function registerMusicBuilder() {
  function tryRegister() {
    try {
      if (!window.serviceContainer || !window.serviceContainer.has('buildSystem')) {
        return false;
      }
      const buildSystem = window.serviceContainer.get('buildSystem');
      if (buildSystem) {
        const mb = new MusicBuilder();
        buildSystem.registerBuilder('.p8mus', mb);
        // Registering by extension alone is not enough: buildFileFromPath()
        // resolves builderId first, and an unknown extension resolves to
        // 'copy', which exists - so getBuilderForFile() would never be reached
        // and the JSON would be copied verbatim. build-system.js also needs its
        // `case '.p8mus': return 'music'`.
        buildSystem.builderById.set('music', mb);
        console.log('[MusicBuilder] Registered with BuildSystem');
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
    attempts += 1;
    if (tryRegister() || attempts > 200) {
      clearInterval(interval);
    }
  }, 100);
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MusicBuilder;
}
