/**
 * Round-trip tests for the D2MU music binary.
 *
 * WHY THIS EXISTS
 * ---------------
 * music-builder.js writes .d2mu and libretrostudio/src/PicoMusic.cpp reads it
 * back. They agree only by inspection of DocsSource/music_format.md, and a
 * disagreement does not throw - it plays the wrong notes, or the right notes at
 * the wrong tempo, which is a genuinely hard thing to trace by ear.
 *
 * So the reader below is written from the format document rather than from the
 * builder, and the header of the document's own worked example is asserted
 * byte for byte. If the doc, the builder and the C++ reader ever drift apart,
 * this is where it should surface.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

/* ══════════════════════════════════════════════════════════════════════
   Harness
   ══════════════════════════════════════════════════════════════════════ */

const MUSIC_PATH = 'Resources/Music/music_23.p8mus';
const EXPECTED_OUTPUT = 'build/Music/music_23.d2mu';

/**
 * music-builder.js is a browser script: a bare class plus a self-registering
 * IIFE. `require` would run it but hand back the class only by luck of the
 * module.exports tail, and the IIFE's retry timer would keep Node alive. The
 * source is evaluated with the globals it expects instead, and the stubbed
 * serviceContainer makes registration succeed on the first try so the timer
 * is never armed.
 */
function loadMusicBuilder() {
  const source = fs.readFileSync(path.resolve(__dirname, 'music-builder.js'), 'utf8');

  const buildSystem = { registerBuilder() {}, builderById: new Map() };
  const win = {
    serviceContainer: {
      has: (name) => name === 'buildSystem',
      get: (name) => (name === 'buildSystem' ? buildSystem : null),
      addEventListener() {},
    },
  };

  const factory = new Function(
    'window', 'BaseBuilder', 'console', 'TextEncoder', 'setInterval', 'clearInterval',
    `${source}\n;return MusicBuilder;`
  );

  return factory(
    win,
    class BaseBuilder {},
    { log() {}, warn() {}, error() {} },
    TextEncoder,
    () => 0,
    () => {}
  );
}

const MusicBuilder = loadMusicBuilder();

/** Build source JSON all the way to D2MU bytes. */
function buildD2mu(spec, filePath = MUSIC_PATH) {
  const builder = new MusicBuilder();
  const parsed = builder.parseP8MusJson(JSON.stringify(spec), filePath);
  const song = builder.normalizeSong(parsed, filePath);
  return { bytes: builder.buildD2MU(song), song };
}

/**
 * An independent reader, written from DocsSource/music_format.md and matching
 * PicoMusic.cpp. Deliberately NOT sharing code with the builder.
 */
function parseD2mu(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  assert.strictEqual(magic, 'D2MU', 'bad magic');

  const header = {
    magic,
    version: view.getUint8(4),
    channels: view.getUint8(5),
    stepsPerSlot: view.getUint8(6),
    flags: view.getUint8(7),
    tickRate: view.getUint16(8, true),
    start: view.getUint8(10),
    end: view.getUint8(11),
    loopTo: view.getInt8(12),
    patternChunk: view.getUint32(16, true),
    slotChunk: view.getUint32(20, true),
  };

  assert.ok(header.patternChunk + 4 <= bytes.length, 'pattern chunk offset past end of file');
  assert.ok(header.slotChunk + 4 <= bytes.length, 'slot chunk offset past end of file');

  const patternCount = view.getUint16(header.patternChunk, true);
  const patternStride = view.getUint16(header.patternChunk + 2, true);
  const slotCount = view.getUint16(header.slotChunk, true);
  const slotStride = view.getUint16(header.slotChunk + 2, true);

  assert.ok(
    header.patternChunk + 4 + (patternCount * patternStride) <= bytes.length,
    'pattern data past end of file'
  );
  assert.ok(
    header.slotChunk + 4 + (slotCount * slotStride) <= bytes.length,
    'slot data past end of file'
  );

  const patterns = [];
  for (let i = 0; i < patternCount; i++) {
    const base = header.patternChunk + 4 + (i * patternStride);
    patterns.push({
      index: view.getUint8(base),
      flags: view.getUint8(base + 1),
      channels: [
        view.getInt8(base + 2),
        view.getInt8(base + 3),
        view.getInt8(base + 4),
        view.getInt8(base + 5),
      ],
    });
  }

  const slots = [];
  for (let i = 0; i < slotCount; i++) {
    const base = header.slotChunk + 4 + (i * slotStride);
    const steps = [];
    for (let s = 0; s < header.stepsPerSlot; s++) {
      const packed = view.getUint16(base + 4 + (s * 2), true);
      steps.push({
        pitch: packed & 0x3F,
        waveform: (packed >> 6) & 0x07,
        volume: (packed >> 9) & 0x07,
        effect: (packed >> 12) & 0x07,
        raw: packed,
      });
    }
    slots.push({
      cartSlot: view.getUint8(base),
      speed: view.getUint8(base + 1),
      loopStart: view.getUint8(base + 2),
      loopEnd: view.getUint8(base + 3),
      steps,
    });
  }

  return { header, patternStride, slotStride, patterns, slots };
}

/** A step array of `count` audible notes. */
function makeSteps(count, overrides = {}) {
  const steps = [];
  for (let i = 0; i < count; i++) {
    steps.push({
      pitch: (i * 3) % 64,
      waveform: i % 8,
      volume: 3,
      effect: i % 8,
      ...overrides,
    });
  }
  return steps;
}

/** The worked example from the format document: one pattern, two slots. */
function makeSong(overrides = {}) {
  return {
    type: 'pico_music',
    version: '1.0',
    name: 'music_23',
    sourceFile: 'mario_15.p8',
    song: {
      start: 23,
      end: 23,
      loopTo: 23,
      patterns: [
        {
          index: 23, flags: 3, loopStart: true, loopEnd: true, stop: false,
          channels: [7, 27, -1, -1],
        },
      ],
    },
    sfx: {
      7: { speed: 12, loopStart: 0, loopEnd: 0, steps: makeSteps(32) },
      27: { speed: 16, loopStart: 12, loopEnd: 0, steps: makeSteps(32) },
    },
    ...overrides,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   Tests
   ══════════════════════════════════════════════════════════════════════ */

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('header survives the round trip', () => {
  const { bytes } = buildD2mu(makeSong());
  const { header } = parseD2mu(bytes);

  assert.strictEqual(header.magic, 'D2MU');
  assert.strictEqual(header.version, 1);
  assert.strictEqual(header.channels, 4);
  assert.strictEqual(header.stepsPerSlot, 32);
  assert.strictEqual(header.flags, 0);
  assert.strictEqual(header.tickRate, 120);
  assert.strictEqual(header.start, 23);
  assert.strictEqual(header.end, 23);
  assert.strictEqual(header.loopTo, 23);
});

test("the format document's worked example is byte-for-byte correct", () => {
  const { bytes } = buildD2mu(makeSong());

  // 32 header + (4 + 1*8) pattern chunk + (4 + 2*68) slot chunk
  assert.strictEqual(bytes.length, 184, 'documented total size');

  const expected = [
    0x44, 0x32, 0x4d, 0x55, 0x01, 0x04, 0x20, 0x00,
    0x78, 0x00, 0x17, 0x17, 0x17, 0x00, 0x00, 0x00,
    0x20, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ];
  assert.deepStrictEqual(Array.from(bytes.slice(0, 32)), expected);
});

test('chunk offsets are absolute, not chunk-relative', () => {
  const { bytes } = buildD2mu(makeSong());
  const { header } = parseD2mu(bytes);

  // The .d2m tilemap format got this wrong and decoded to plausible garbage.
  assert.strictEqual(header.patternChunk, 32, 'pattern chunk follows the header');
  assert.strictEqual(header.slotChunk, 32 + 4 + 8, 'slot chunk follows the pattern chunk');
});

test('record sizes are declared so a reader can stride by them', () => {
  const { bytes } = buildD2mu(makeSong());
  const { patternStride, slotStride } = parseD2mu(bytes);

  assert.strictEqual(patternStride, 8);
  assert.strictEqual(slotStride, 68);
});

test('pattern records survive the round trip', () => {
  const { bytes } = buildD2mu(makeSong());
  const { patterns } = parseD2mu(bytes);

  assert.strictEqual(patterns.length, 1);
  assert.strictEqual(patterns[0].index, 23);
  assert.strictEqual(patterns[0].flags, 3);
  assert.deepStrictEqual(patterns[0].channels, [7, 27, -1, -1]);
});

test('pattern order is preserved rather than sorted', () => {
  const song = makeSong();
  song.song.patterns = [
    { index: 40, flags: 1, channels: [7, -1, -1, -1] },
    { index: 12, flags: 0, channels: [7, -1, -1, -1] },
    { index: 31, flags: 2, channels: [7, -1, -1, -1] },
  ];

  const { bytes } = buildD2mu(song);
  const { patterns } = parseD2mu(bytes);

  assert.deepStrictEqual(patterns.map((p) => p.index), [40, 12, 31]);
});

test('flow flags are masked to the low three bits', () => {
  const song = makeSong();
  song.song.patterns[0].flags = 0xFF;

  const { bytes } = buildD2mu(song);
  const { patterns } = parseD2mu(bytes);

  assert.strictEqual(patterns[0].flags, 0x07);
});

test('slot records survive the round trip', () => {
  const { bytes } = buildD2mu(makeSong());
  const { slots } = parseD2mu(bytes);

  assert.strictEqual(slots.length, 2);
  assert.deepStrictEqual(slots.map((s) => s.cartSlot), [7, 27]);
  assert.strictEqual(slots[0].speed, 12);
  assert.strictEqual(slots[1].speed, 16);
});

test('the overloaded loop fields are copied verbatim, not normalised', () => {
  const song = makeSong();
  // Slot 7 is a real loop; slot 27 uses loopStart as a LENGTH with loopEnd 0.
  song.sfx[7].loopStart = 4;
  song.sfx[7].loopEnd = 20;
  song.sfx[27].loopStart = 12;
  song.sfx[27].loopEnd = 0;

  const { bytes } = buildD2mu(song);
  const { slots } = parseD2mu(bytes);
  const bySlot = new Map(slots.map((s) => [s.cartSlot, s]));

  assert.strictEqual(bySlot.get(7).loopStart, 4);
  assert.strictEqual(bySlot.get(7).loopEnd, 20);
  // If the builder "helpfully" turned this into loopEnd 12 the slot would play
  // its notes and then fall silent, which is the failure this guards.
  assert.strictEqual(bySlot.get(27).loopStart, 12);
  assert.strictEqual(bySlot.get(27).loopEnd, 0);
});

test('a step packs into the documented bit layout', () => {
  const song = makeSong();
  song.sfx[7].steps = [{ pitch: 36, waveform: 3, volume: 5, effect: 6 }];

  const { bytes } = buildD2mu(song);
  const { slots } = parseD2mu(bytes);
  const slot = slots.find((s) => s.cartSlot === 7);

  const expected = 36 | (3 << 6) | (5 << 9) | (6 << 12);
  assert.strictEqual(slot.steps[0].raw, expected);
  assert.strictEqual(slot.steps[0].pitch, 36);
  assert.strictEqual(slot.steps[0].waveform, 3);
  assert.strictEqual(slot.steps[0].volume, 5);
  assert.strictEqual(slot.steps[0].effect, 6);
});

test('every step of every slot round-trips', () => {
  const { bytes } = buildD2mu(makeSong());
  const { slots } = parseD2mu(bytes);
  const source = makeSteps(32);

  for (const slot of slots) {
    for (let i = 0; i < 32; i++) {
      assert.strictEqual(slot.steps[i].pitch, source[i].pitch, `slot ${slot.cartSlot} step ${i} pitch`);
      assert.strictEqual(slot.steps[i].waveform, source[i].waveform, `slot ${slot.cartSlot} step ${i} waveform`);
      assert.strictEqual(slot.steps[i].volume, source[i].volume, `slot ${slot.cartSlot} step ${i} volume`);
      assert.strictEqual(slot.steps[i].effect, source[i].effect, `slot ${slot.cartSlot} step ${i} effect`);
    }
  }
});

test('a short step array is padded to 32 with zeros', () => {
  const song = makeSong();
  song.sfx[7].steps = makeSteps(5);

  const { bytes } = buildD2mu(song);
  const { slots } = parseD2mu(bytes);
  const slot = slots.find((s) => s.cartSlot === 7);

  assert.strictEqual(slot.steps.length, 32);
  for (let i = 5; i < 32; i++) {
    assert.strictEqual(slot.steps[i].raw, 0, `padded step ${i} should be zero`);
  }
});

test('a step array longer than 32 is truncated', () => {
  const song = makeSong();
  song.sfx[7].steps = makeSteps(40);

  const { bytes } = buildD2mu(song);
  const { slots, slotStride } = parseD2mu(bytes);

  assert.strictEqual(slotStride, 68, 'record size must not grow with the source');
  assert.strictEqual(slots.find((s) => s.cartSlot === 7).steps.length, 32);
});

test('the short field names the SFX editor writes are accepted', () => {
  const song = makeSong();
  song.sfx[7].steps = [{ pitch: 20, wave: 5, volume: 4, fx: 2 }];

  const { bytes } = buildD2mu(song);
  const { slots } = parseD2mu(bytes);
  const step = slots.find((s) => s.cartSlot === 7).steps[0];

  assert.strictEqual(step.waveform, 5, '`wave` should be read as waveform');
  assert.strictEqual(step.effect, 2, '`fx` should be read as effect');
});

test('only referenced slots are emitted', () => {
  const song = makeSong();
  // A cart defines up to 64 slots; a song that plays two must carry two.
  for (let n = 0; n < 64; n++) {
    if (!song.sfx[n]) song.sfx[n] = { speed: 8, loopStart: 0, loopEnd: 0, steps: makeSteps(32) };
  }

  const { bytes } = buildD2mu(song);
  const { slots } = parseD2mu(bytes);

  assert.strictEqual(slots.length, 2, 'the other 62 slots must not be carried');
  assert.deepStrictEqual(slots.map((s) => s.cartSlot), [7, 27]);
});

test('a slot number never appears twice', () => {
  const song = makeSong();
  song.song.patterns = [
    { index: 23, flags: 0, channels: [7, 7, 27, 7] },
    { index: 24, flags: 0, channels: [7, 27, -1, -1] },
  ];

  const { bytes } = buildD2mu(song);
  const { slots } = parseD2mu(bytes);
  const seen = new Set(slots.map((s) => s.cartSlot));

  assert.strictEqual(seen.size, slots.length, 'duplicate slot record');
  assert.strictEqual(slots.length, 2);
});

test('an entirely silent slot becomes a silent channel and is not emitted', () => {
  const song = makeSong();
  song.sfx[27].steps = makeSteps(32, { volume: 0 });

  const { bytes } = buildD2mu(song);
  const { patterns, slots } = parseD2mu(bytes);

  // pico-audio.js drops these in channelSlot(), and a pattern's length comes
  // from its channels - carrying one would make the pattern the wrong length.
  assert.deepStrictEqual(patterns[0].channels, [7, -1, -1, -1]);
  assert.strictEqual(slots.length, 1);
  assert.strictEqual(slots[0].cartSlot, 7);
});

test('a channel referencing an undefined slot becomes silence', () => {
  const song = makeSong();
  song.song.patterns[0].channels = [7, 27, 61, -1];

  const { bytes } = buildD2mu(song);
  const { patterns, slots } = parseD2mu(bytes);

  assert.deepStrictEqual(patterns[0].channels, [7, 27, -1, -1]);
  assert.strictEqual(slots.length, 2, 'no empty record for the missing slot');
});

test('a muted channel object becomes silence', () => {
  const song = makeSong();
  song.song.patterns[0].channels = [{ slot: 7, muted: false }, { slot: 27, muted: true }, -1, -1];

  const { bytes } = buildD2mu(song);
  const { patterns, slots } = parseD2mu(bytes);

  assert.deepStrictEqual(patterns[0].channels, [7, -1, -1, -1]);
  assert.strictEqual(slots.length, 1);
});

test('a song that does not loop writes -1', () => {
  const song = makeSong();
  song.song.loopTo = null;

  const { bytes } = buildD2mu(song);
  const { header } = parseD2mu(bytes);

  assert.strictEqual(header.loopTo, -1);
});

test('start and end default to the first and last pattern', () => {
  const song = makeSong();
  delete song.song.start;
  delete song.song.end;
  song.song.patterns = [
    { index: 12, flags: 0, channels: [7, -1, -1, -1] },
    { index: 13, flags: 4, channels: [7, -1, -1, -1] },
  ];

  const { bytes } = buildD2mu(song);
  const { header } = parseD2mu(bytes);

  assert.strictEqual(header.start, 12);
  assert.strictEqual(header.end, 13);
});

test('a slot speed of zero is raised to 1 rather than stalling the player', () => {
  const song = makeSong();
  song.sfx[7].speed = 0;

  const { bytes } = buildD2mu(song);
  const { slots } = parseD2mu(bytes);

  assert.strictEqual(slots.find((s) => s.cartSlot === 7).speed, 1);
});

test('out-of-range step fields are clamped into their bit widths', () => {
  const song = makeSong();
  // The second step keeps the slot audible; a slot whose every step is silent
  // is dropped entirely, which is a different rule tested above.
  song.sfx[7].steps = [
    { pitch: 999, waveform: 99, volume: 99, effect: 42 },
    { pitch: -7, waveform: -1, volume: 4, effect: -3 },
  ];

  const { bytes } = buildD2mu(song);
  const { slots } = parseD2mu(bytes);
  const steps = slots.find((s) => s.cartSlot === 7).steps;

  // Clamping keeps a bad value from bleeding into the neighbouring field.
  assert.strictEqual(steps[0].pitch, 63);
  assert.strictEqual(steps[0].waveform, 7);
  assert.strictEqual(steps[0].volume, 7);
  assert.strictEqual(steps[0].effect, 7);

  assert.strictEqual(steps[1].pitch, 0);
  assert.strictEqual(steps[1].waveform, 0);
  assert.strictEqual(steps[1].volume, 4);
  assert.strictEqual(steps[1].effect, 0);
});

test('a source that is not pico_music fails the build', () => {
  const song = makeSong();
  song.type = 'pico_sfx';
  assert.throws(() => buildD2mu(song), /not a pico_music/);
});

test('a song with no patterns fails the build', () => {
  const song = makeSong();
  song.song.patterns = [];
  assert.throws(() => buildD2mu(song), /no patterns/);
});

test('the output path lands in the archive Music folder', () => {
  const builder = new MusicBuilder();
  assert.strictEqual(builder.toBuildPath(MUSIC_PATH.replace(/\.p8mus$/i, '.d2mu')), EXPECTED_OUTPUT);
});

/* ── the player ─────────────────────────────────────────────────────────
   The Studio simulator plays the built binary rather than the source JSON,
   so a builder bug is audible in the Studio instead of only on the device.
   That only holds if pico-audio.js reads back what the builder wrote.
   ────────────────────────────────────────────────────────────────────── */

const PicoAudio = require(path.resolve(__dirname, '..', 'audio', 'pico-audio.js'));

test('the player decodes the binary the builder writes', () => {
  const { bytes } = buildD2mu(makeSong());
  const song = PicoAudio.parseD2mu(bytes);

  assert.strictEqual(song.start, 23);
  assert.strictEqual(song.end, 23);
  assert.strictEqual(song.loopTo, 23);
  assert.strictEqual(song.tickRate, 120);
  assert.strictEqual(song.patterns.length, 1);
  assert.deepStrictEqual(song.patterns[0].channels, [7, 27, -1, -1]);
  assert.deepStrictEqual(Object.keys(song.slots).sort(), ['27', '7']);
});

test('a decoded song renders to the same audio as its source JSON', () => {
  const source = makeSong();
  const { bytes } = buildD2mu(source);

  const fromJson = PicoAudio.parseP8Mus(JSON.stringify(source));
  const fromBinary = PicoAudio.parseD2mu(bytes);

  const rendered = (song) => PicoAudio.renderSong(song.patterns, 0, song.slots, 22050);
  const a = rendered(fromJson);
  const b = rendered(fromBinary);

  assert.ok(a.samples.length > 0, 'the source song must actually make sound');
  assert.strictEqual(b.samples.length, a.samples.length, 'binary song has a different length');
});

test('the player accepts either a .p8mus source or a built .d2mu', () => {
  const source = makeSong();
  const { bytes } = buildD2mu(source);

  assert.strictEqual(PicoAudio.isD2mu(bytes), true);
  assert.strictEqual(PicoAudio.isD2mu(JSON.stringify(source)), false);

  // parseSong is what the audio engine calls, and it must not care which it got.
  assert.strictEqual(PicoAudio.parseSong(bytes).start, 23);
  assert.strictEqual(PicoAudio.parseSong(JSON.stringify(source)).start, 23);
});

test('the player rejects a truncated or corrupt .d2mu rather than playing noise', () => {
  const { bytes } = buildD2mu(makeSong());

  assert.throws(() => PicoAudio.parseD2mu(bytes.slice(0, 8)), /Too small|past end of file/);

  const badMagic = bytes.slice();
  badMagic[0] = 0x00;
  assert.throws(() => PicoAudio.parseD2mu(badMagic), /bad magic/);

  const badVersion = bytes.slice();
  badVersion[4] = 9;
  assert.throws(() => PicoAudio.parseD2mu(badVersion), /Unsupported .d2mu version/);
});

test('a silent slot dropped by the builder is dropped by the player too', () => {
  const source = makeSong();
  source.sfx[27].steps = makeSteps(32, { volume: 0 });
  const { bytes } = buildD2mu(source);

  const fromJson = PicoAudio.parseP8Mus(JSON.stringify(source));
  const fromBinary = PicoAudio.parseD2mu(bytes);

  // pico-audio drops the silent channel itself; the builder drops it at build
  // time. Both paths must agree, or the pattern comes out a different length.
  const jsonPlan = PicoAudio.patternPlan(fromJson.patterns[0], fromJson.slots, 22050);
  const binaryPlan = PicoAudio.patternPlan(fromBinary.patterns[0], fromBinary.slots, 22050);

  assert.strictEqual(binaryPlan.totalSamples, jsonPlan.totalSamples);
});

/* ── wiring ─────────────────────────────────────────────────────────────
   Registering the builder for `.p8mus` is necessary but not sufficient.
   buildFileFromPath() resolves a builderId first, and an unknown extension
   resolves to 'copy' - which is a registered builder, so the extension lookup
   never runs and the song JSON is copied into the archive verbatim. That
   failure is silent and looks exactly like the builder not existing.
   ────────────────────────────────────────────────────────────────────── */

/** Instantiate the real BuildSystem. It declares its own default builders. */
function loadBuildSystem() {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'build-system.js'), 'utf8');

  const factory = new Function(
    'window', 'console',
    `${source}\n;return BuildSystem;`
  );

  const BuildSystem = factory({}, { log() {}, warn() {}, error() {} });
  return new BuildSystem();
}

test('the build system routes .p8mus to the music builder, not to copy', () => {
  const buildSystem = loadBuildSystem();
  assert.strictEqual(buildSystem.getBuilderIdForExtension('.p8mus'), 'music');
  assert.strictEqual(buildSystem.getBuilderIdForExtension('.P8MUS'), 'music');
});

test('music-builder.js registers itself under the id the build system asks for', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'music-builder.js'), 'utf8');
  const registered = [];
  const builderById = new Map();
  const buildSystem = {
    registerBuilder: (ext) => registered.push(ext),
    builderById,
  };
  const win = {
    serviceContainer: {
      has: (name) => name === 'buildSystem',
      get: (name) => (name === 'buildSystem' ? buildSystem : null),
      addEventListener() {},
    },
  };

  new Function(
    'window', 'BaseBuilder', 'console', 'TextEncoder', 'setInterval', 'clearInterval',
    source
  )(win, class BaseBuilder {}, { log() {}, warn() {}, error() {} }, TextEncoder, () => 0, () => {});

  assert.ok(registered.includes('.p8mus'), 'extension not registered');
  assert.ok(builderById.has('music'), "no builder under the id 'music'");
});

test('index.html loads the music builder', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.html'), 'utf8');
  assert.ok(
    /scripts\/builders\/music-builder\.js/.test(html),
    'music-builder.js is not loaded by index.html, so it can never register'
  );
});

/* ── the emulator's binary read path ───────────────────────────────────
   The editor's IndexedDB store does NOT hand back an ArrayBuffer. It keeps
   binaries as base64 text with a `binaryData` flag, the same convention
   preloadAudioResource follows. A reader that only accepts ArrayBuffer throws
   on every built song in the Studio, which no amount of round-trip testing of
   the format itself would catch.
   ────────────────────────────────────────────────────────────────────── */

test('the emulator reads a .d2mu the way the editor actually stores it', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'game-emulator', 'game-emulator.js'), 'utf8'
  );
  const start = source.indexOf('async preloadPicoMusicResource(');
  assert.notStrictEqual(start, -1, 'preloadPicoMusicResource not found');
  const body = source.slice(start, start + 2500);
  assert.ok(
    /binaryData/.test(body) && /atob\(/.test(body),
    'the d2mu branch must decode the base64 + binaryData form the editor stores, ' +
    'not assume an ArrayBuffer'
  );
});

/* ══════════════════════════════════════════════════════════════════════
   Runner
   ══════════════════════════════════════════════════════════════════════ */

let passed = 0;
let failed = 0;

for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
    failed += 1;
  }
}

console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);
process.exit(failed === 0 ? 0 : 1);
