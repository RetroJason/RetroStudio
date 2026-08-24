/**
 * Level and brightness tests for the PICO-8 noise waveform in the SFX builder.
 *
 * WHY THIS EXISTS
 * ---------------
 * The same PICO-8 SFX slot is synthesized by two different pieces of code:
 * SfxBuilder.renderPicoSamples() in build-system.js turns a slot into the WAV
 * that sfx(n) plays, and pico-audio.js renders the same slot when it appears
 * inside a music pattern. Neither one throws when they disagree - the cart just
 * sounds wrong, and only for the noise waveform, which is the hardest one to
 * judge by ear because it is supposed to be random.
 *
 * Two real bugs lived here. The filter coefficient was renormalised by the
 * render rate, which inverted the thing it was meant to fix and made the noise
 * brighter the higher you rendered; and the gain was lifted 4x on the theory
 * that it had to compensate for zepto8's +/-0.25 waveforms, which double
 * counted because our own tonal waveforms are already +/-1. Together they
 * turned dinky_kong's low title thump into a burst of loud white noise that
 * drowned out the sound the cart actually wanted you to hear.
 *
 * The assertions below are about relationships, not absolute sample values,
 * because the source is random: the filter must behave the same at any render
 * rate, low notes must be quieter and darker than high ones, and noise must sit
 * at the same level relative to a tone in both renderers.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

/* ══════════════════════════════════════════════════════════════════════
   Harness
   ══════════════════════════════════════════════════════════════════════ */

/**
 * build-system.js is a browser script that ends by assigning its classes to
 * `window`. Evaluate it with a stub window and take SfxBuilder back out.
 */
function loadSfxBuilder() {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'build-system.js'), 'utf8');
  const win = {};
  const factory = new Function(
    'window', 'console', 'document', 'TextEncoder',
    `${source}\n;return window.SfxBuilder;`
  );
  return factory(win, { log() {}, warn() {}, error() {} }, undefined, TextEncoder);
}

const PicoAudio = require(path.resolve(__dirname, '..', 'audio', 'pico-audio.js'));
const SfxBuilder = loadSfxBuilder();
const builder = Object.create(SfxBuilder.prototype);

/** A 32 step slot of one waveform at one pitch, all at full volume. */
function slot(waveform, pitch, { speed = 8, volume = 7 } = {}) {
  return {
    speed,
    loopStart: 0,
    loopEnd: 31,
    steps: Array.from({ length: 32 }, () => ({
      pitch, waveform, volume, effect: 0,
    })),
  };
}

function rms(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * Recover the one-pole filter's cutoff in Hz from the rendered samples.
 *
 * The synth is y[n] = (y[n-1] + s*x[n]) / (1 + s), so the pole a = 1/(1+s)
 * shows up directly as the lag-1 autocorrelation of the output, and the cutoff
 * is -ln(a) * rate / 2pi. This measures the actual filter rather than guessing
 * at it from how far the signal moves between samples, which scales with the
 * render rate and so cannot tell a rate bug from a correct one.
 */
function cutoffHz(samples, rate) {
  let num = 0;
  let den = 0;
  for (let i = 1; i < samples.length; i += 1) {
    num += samples[i] * samples[i - 1];
    den += samples[i - 1] * samples[i - 1];
  }
  const pole = den > 0 ? num / den : 0;
  if (!(pole > 0) || pole >= 1) return Infinity;
  return (-Math.log(pole) * rate) / (2 * Math.PI);
}

const NOISE = 6;
const SQUARE = 3;

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

/* ══════════════════════════════════════════════════════════════════════
   Tests
   ══════════════════════════════════════════════════════════════════════ */

test('the noise filter has the same cutoff whatever rate it is rendered at', () => {
  // This is the bug that made the title thump sound like white noise. The
  // cutoff is s * rate / 2pi and the phase advance is freq / rate, so the rate
  // cancels on its own. Renormalising s by rate / 22050 cancelled the cancel
  // and made the cutoff proportional to the render rate, so at 44100 every
  // noise note came out an octave too bright.
  const at22k = builder.renderPicoSamples(slot(NOISE, 0), 22050, 120);
  const at44k = builder.renderPicoSamples(slot(NOISE, 0), 44100, 120);

  const ratio = cutoffHz(at44k, 44100) / cutoffHz(at22k, 22050);
  assert.ok(
    ratio > 0.75 && ratio < 1.35,
    'the noise cutoff must not depend on the render rate, but doubling the rate '
    + `moved it by ${ratio.toFixed(2)}x `
    + `(${cutoffHz(at22k, 22050).toFixed(0)} Hz -> ${cutoffHz(at44k, 44100).toFixed(0)} Hz)`,
  );

  // Level is not asserted: white noise carries a fixed variance per sample, so
  // a fixed cutoff passes proportionally less of it as the rate rises. That
  // 1/sqrt(2) per octave of rate is inherent, not a defect.
});

test('the cutoff tracks the note, so low notes rumble and high notes hiss', () => {
  const rate = 44100;
  const lowNote = builder.renderPicoSamples(slot(NOISE, 0), rate, 120);
  const highNote = builder.renderPicoSamples(slot(NOISE, 40), rate, 120);

  assert.ok(
    cutoffHz(highNote, rate) > cutoffHz(lowNote, rate) * 4,
    'a high noise note must be far brighter than a low one; got '
    + `${cutoffHz(highNote, rate).toFixed(0)} Hz vs ${cutoffHz(lowNote, rate).toFixed(0)} Hz`,
  );

  // zepto8 puts the cutoff at freq * 8.858923 / 2pi, about 1.41 times the note.
  const expected = 440 * (2 ** ((36 - 69) / 12)) * (8.858923 / (2 * Math.PI));
  const measured = cutoffHz(lowNote, rate);
  assert.ok(
    measured > expected * 0.7 && measured < expected * 1.3,
    `pitch 0 should filter at about ${expected.toFixed(0)} Hz, measured ${measured.toFixed(0)} Hz`,
  );

  assert.ok(
    rms(lowNote) < rms(highNote),
    'the lowpass removes energy, so a low noise note must be quieter than a high one',
  );
});

test('a low noise note stays well under a tone, so it cannot drown one out', () => {
  // dinky_kong's title plays sfx 1 (noise, pitch 0, volume 7) and sfx 9 (a
  // quiet tone) together, and the tone is the one you are meant to hear.
  const thump = builder.renderPicoSamples(slot(NOISE, 0), 44100, 120);
  const tone = builder.renderPicoSamples(slot(SQUARE, 26, { volume: 3 }), 44100, 120);

  assert.ok(
    rms(thump) < rms(tone),
    `a full volume low noise note (rms ${rms(thump).toFixed(3)}) must not exceed a `
    + `quiet tone (rms ${rms(tone).toFixed(3)}), or it masks the sound the cart wants heard`,
  );
});

test('noise sits at the same level against a tone in both renderers', () => {
  // sfx(n) renders through SfxBuilder and music patterns render through
  // pico-audio.js. A slot must not change character depending on which one
  // played it, so compare the noise-to-tone ratio rather than raw levels -
  // the two paths apply different overall gains on purpose.
  const rate = 44100;
  const builderRatio = rms(builder.renderPicoSamples(slot(NOISE, 0), rate, 120))
    / rms(builder.renderPicoSamples(slot(SQUARE, 0), rate, 120));
  const playerRatio = rms(PicoAudio.renderSfxSlot(slot(NOISE, 0), rate))
    / rms(PicoAudio.renderSfxSlot(slot(SQUARE, 0), rate));

  const drift = builderRatio / playerRatio;
  assert.ok(
    drift > 0.8 && drift < 1.25,
    `the SFX builder and the music player must weigh noise against tone the same way, `
    + `but the builder is ${drift.toFixed(2)}x (builder ${builderRatio.toFixed(3)}, `
    + `player ${playerRatio.toFixed(3)})`,
  );
});

test('noise is still audible, not filtered away to nothing', () => {
  const thump = builder.renderPicoSamples(slot(NOISE, 0), 44100, 120);
  assert.ok(rms(thump) > 0.002, `low noise must still be audible, got rms ${rms(thump).toFixed(4)}`);
});

/* ══════════════════════════════════════════════════════════════════════
   Runner
   ══════════════════════════════════════════════════════════════════════ */

console.log('Running PICO-8 SFX noise tests...\n');
let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}
console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);
process.exit(failed === 0 ? 0 : 1);
