// sfx-binary.test.js
// The binary sound effect containers that replace built WAV files.
//
// The PICO-8 half is checked against picotool's bytes for a real cart pattern,
// the same ground truth pico8-cart-rom.test.js uses, because the whole point of
// that format is that it IS the cart's bytes - if the encoder and the ROM writer
// ever disagree, one of them is wrong and the sound is silently different.

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const SfxBinary = require(path.resolve(__dirname, 'sfx-binary.js'));
const PicoAudio = require(path.resolve(__dirname, 'pico-audio.js'));

function loadImportService() {
  global.window = global.window || {};
  global.window.ProjectPaths = {
    getSourcesRootUi: () => 'Sources',
    resolveFolderForExtension: (extension) => (extension === '.lua' ? 'Sources/Scripts' : 'Sources/Binary'),
    normalizeStoragePath: (uiPath) => uiPath,
  };

  const sourcePath = path.join(__dirname, '..', 'services', 'pico8-import-service.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  vm.runInThisContext(`${source}\n;globalThis.__Pico8ImportServiceClass = Pico8ImportService;`, {
    filename: sourcePath,
  });

  return new globalThis.__Pico8ImportServiceClass(null);
}

const importService = loadImportService();

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// picotool tests/pico8/sfx/sfx_test.py, TestHelloWorld: one pattern of a real
// cart, as the .p8 line and as the 68 bytes it occupies in memory.
const HELLO_SFX_LINE = '01100000183732440518433394033c65539403185432b543184733940318433394033c655306053940339403'
  + '184733940318423394033c655394031845321433184733940318473394033c655394033940339403';
const HELLO_SFX_BYTES = 'd83e245118373931bc5b393158396b39183f393118373931bc5bb05139313931183f393118353931bc5b3931'
  + '183b2137183f3931183f3931bc5b39313931393101100000';

// -------------------------------------------------------------------------
// PICO-8 slots: the bytes themselves
// -------------------------------------------------------------------------

test('a real cart pattern encodes to the bytes picotool reads from the cart image', () => {
  const [slot] = importService.parseP8SfxSection([HELLO_SFX_LINE]);
  assert.strictEqual(hex(SfxBinary.encodePicoSlot(slot)), HELLO_SFX_BYTES);
});

test('a slot is 68 bytes, which is the entire point of the format', () => {
  const [slot] = importService.parseP8SfxSection([HELLO_SFX_LINE]);
  assert.strictEqual(SfxBinary.encodePicoSlot(slot).byteLength, 68);
  assert.strictEqual(SfxBinary.PICO_SLOT_BYTES, 68);
});

test('a slot survives a round trip through the binary', () => {
  const [slot] = importService.parseP8SfxSection([HELLO_SFX_LINE]);
  const decoded = SfxBinary.decodePicoSlot(SfxBinary.encodePicoSlot(slot));

  assert.strictEqual(decoded.mode, slot.mode);
  assert.strictEqual(decoded.speed, slot.speed);
  assert.strictEqual(decoded.loopStart, slot.loopStart);
  assert.strictEqual(decoded.loopEnd, slot.loopEnd);
  assert.strictEqual(decoded.steps.length, 32);

  for (let i = 0; i < 32; i += 1) {
    assert.deepStrictEqual(
      {
        pitch: decoded.steps[i].pitch,
        waveform: decoded.steps[i].waveform,
        volume: decoded.steps[i].volume,
        effect: decoded.steps[i].effect,
      },
      {
        pitch: slot.steps[i].pitch,
        waveform: slot.steps[i].waveform,
        volume: slot.steps[i].volume,
        effect: slot.steps[i].effect,
      },
      `step ${i} disagrees`
    );
  }
});

test('a note packs pitch, waveform, volume and effect across two bytes', () => {
  // picotool testSetNote: pitch 1, waveform 2, volume 3, effect 4.
  const noteBytes = (note) => {
    const [slot] = importService.parseP8SfxSection([`00000000${note}`]);
    return hex(SfxBinary.encodePicoSlot(slot).slice(0, 2));
  };

  assert.strictEqual(noteBytes('01234'), '8146');
  // testSetNoteHighWaveform: waveform 10 sets the custom-instrument bit and
  // clears the w3 bit, which a naive shift would leave set.
  assert.strictEqual(noteBytes('01a34'), '81c6');
});

test('the custom instrument bit survives the round trip', () => {
  const [slot] = importService.parseP8SfxSection([`00000000${'01a34'.repeat(32)}`]);
  const decoded = SfxBinary.decodePicoSlot(SfxBinary.encodePicoSlot(slot));

  assert.strictEqual(decoded.steps[0].custom, true, 'instrument 10 is a custom instrument');
  assert.strictEqual(decoded.steps[0].waveform, 2, 'and its base waveform is 2');
});

test('the four header bytes are mode, speed, loop start, loop end', () => {
  const [slot] = importService.parseP8SfxSection([`01100407${'00000'.repeat(32)}`]);
  assert.strictEqual(hex(SfxBinary.encodePicoSlot(slot).slice(64, 68)), '01100407');
});

// -------------------------------------------------------------------------
// PICO-8 slots: the loop dialects
// -------------------------------------------------------------------------

test('an editor loop converts back to an exclusive cart end', () => {
  // .sfx JSON stores an INCLUSIVE range plus a loop flag; the cart stores an
  // exclusive end. Losing that distinction drops the last step of every loop.
  const bytes = SfxBinary.encodePicoSlot({
    type: 'pico_sfx',
    pico: { speed: 16, loopStart: 2, loopEnd: 7, loop: true, steps: [] },
  });

  assert.strictEqual(bytes[66], 2, 'loop start is unchanged');
  assert.strictEqual(bytes[67], 8, 'loop end moves one past the last step');
});

test('a non-looping range becomes a length', () => {
  const bytes = SfxBinary.encodePicoSlot({
    type: 'pico_sfx',
    pico: { speed: 8, loopStart: 0, loopEnd: 3, loop: false, steps: [] },
  });

  assert.strictEqual(bytes[66], 4, 'length is the step count, not the last index');
  assert.strictEqual(bytes[67], 0, 'a length has no end marker');
});

test('a range covering every step is the 0/0 case, not a length of 32', () => {
  // A length byte of 32 is out of range, and PICO-8's own editor writes 0/0.
  const steps = new Array(32).fill({ pitch: 0, waveform: 0, volume: 5, effect: 0 });
  const bytes = SfxBinary.encodePicoSlot({
    type: 'pico_sfx',
    pico: { speed: 8, loopStart: 0, loopEnd: 31, loop: false, steps },
  });

  assert.strictEqual(bytes[66], 0);
  assert.strictEqual(bytes[67], 0);
});

test('a raw slot passes its loop pair through untouched', () => {
  // Music files embed raw slots straight from the cart, which are already in
  // cart dialect. Translating them a second time would shift every loop.
  const bytes = SfxBinary.encodePicoSlot({ speed: 8, loopStart: 2, loopEnd: 8, steps: [] });

  assert.strictEqual(bytes[66], 2);
  assert.strictEqual(bytes[67], 8, 'an exclusive end is not incremented again');
});

test('a decoded slot renders through the existing PICO-8 synthesiser', () => {
  // decodePicoSlot returns raw cart semantics precisely so that pico-audio.js,
  // which implements those rules, can consume it with no adapter in between.
  const [slot] = importService.parseP8SfxSection([HELLO_SFX_LINE]);
  const decoded = SfxBinary.decodePicoSlot(SfxBinary.encodePicoSlot(slot));

  const samples = PicoAudio.renderSfxSlot(decoded, 22050);
  assert.ok(samples.length > 0, 'the slot produced audio');
  assert.ok(samples.some((s) => s !== 0), 'the audio is not silence');
});

// -------------------------------------------------------------------------
// Studio-native (RSFX)
// -------------------------------------------------------------------------

const JSFXR_SAMPLE = {
  wave_type: 3,
  p_base_freq: 0.35,
  p_env_sustain: 0.28,
  p_env_decay: 0.41,
  p_freq_ramp: -0.22,
  p_lpf_freq: 1,
  p_duty: 0.5,
};

test('native parameters survive a round trip within Q15 precision', () => {
  const decoded = SfxBinary.decodeNative(SfxBinary.encodeNative(JSFXR_SAMPLE));

  assert.strictEqual(decoded.wave_type, 3);
  for (const [name, value] of Object.entries(JSFXR_SAMPLE)) {
    if (name === 'wave_type') continue;
    assert.ok(
      Math.abs(decoded[name] - value) < 1e-4,
      `${name} came back as ${decoded[name]}, expected ${value}`
    );
  }
});

test('a native effect is 52 bytes rather than a WAV', () => {
  assert.strictEqual(SfxBinary.encodeNative(JSFXR_SAMPLE).byteLength, 52);
});

test('a negative parameter keeps its sign', () => {
  const decoded = SfxBinary.decodeNative(SfxBinary.encodeNative({ p_freq_ramp: -1 }));
  assert.ok(decoded.p_freq_ramp < -0.999, `expected about -1, got ${decoded.p_freq_ramp}`);
});

test('an out of range parameter clamps instead of wrapping', () => {
  // Q15 overflow would turn a too-large positive into a negative, which is an
  // audible sign flip rather than a slightly wrong value.
  const decoded = SfxBinary.decodeNative(SfxBinary.encodeNative({ p_base_freq: 4 }));
  assert.ok(decoded.p_base_freq > 0, `clamped value should stay positive, got ${decoded.p_base_freq}`);
});

test('a shorter parameter vector from an older build still decodes', () => {
  const full = SfxBinary.encodeNative(JSFXR_SAMPLE);
  const short = full.slice(0, 8 + (4 * 2));
  new DataView(short.buffer, short.byteOffset).setUint16(6, 4, true);

  const decoded = SfxBinary.decodeNative(short);
  assert.strictEqual(decoded.wave_type, 3);
  assert.ok(Math.abs(decoded.p_base_freq - 0.35) < 1e-4);
  assert.strictEqual(decoded.p_lpf_freq, undefined, 'fields it never knew about are absent');
});

test('a newer format version is refused rather than misread', () => {
  const bytes = SfxBinary.encodeNative(JSFXR_SAMPLE);
  bytes[4] = SfxBinary.RSFX_VERSION + 1;
  assert.throws(() => SfxBinary.decodeNative(bytes), /newer than this build/);
});

// -------------------------------------------------------------------------
// Dispatch
// -------------------------------------------------------------------------

test('encode picks the format from the file body', () => {
  const [slot] = importService.parseP8SfxSection([HELLO_SFX_LINE]);
  const pico = SfxBinary.encode(importService.picoSlotToSfxJson(slot));
  assert.strictEqual(pico.format, 'pico');
  assert.strictEqual(pico.bytes.byteLength, 68);

  const native = SfxBinary.encode({ type: 'jsfxr', parameters: JSFXR_SAMPLE });
  assert.strictEqual(native.format, 'native');
  assert.strictEqual(native.bytes.byteLength, 52);
});

test('decode tells the two formats apart', () => {
  const [slot] = importService.parseP8SfxSection([HELLO_SFX_LINE]);

  const pico = SfxBinary.decode(SfxBinary.encodePicoSlot(slot));
  assert.strictEqual(pico.format, 'pico');
  assert.strictEqual(pico.slot.speed, slot.speed);

  const native = SfxBinary.decode(SfxBinary.encodeNative(JSFXR_SAMPLE));
  assert.strictEqual(native.format, 'native');
  assert.strictEqual(native.parameters.wave_type, 3);
});

test('an unrecognised blob is refused rather than guessed at', () => {
  assert.throws(() => SfxBinary.decode(new Uint8Array(11)), /Unrecognised sfx binary/);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
  }
}

console.log(`\n${tests.length - failed} passed, ${failed} failed, ${tests.length} total`);
process.exit(failed === 0 ? 0 : 1);
