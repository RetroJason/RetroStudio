// Tests for PICO-8 channel arbitration between sfx() and music().
//
// A song takes the channels its pattern needs away from sfx(). We render a
// song as one pre-mixed buffer, so that arbitration has to be reapplied by the
// audio engine; without it a long sfx keeps sounding underneath the music.

const fs = require('fs');
const path = require('path');

const PicoAudio = require(path.resolve(__dirname, 'pico-audio.js'));

/** audio-api.js is a browser script; run it with just enough of a window. */
function loadAudioEngine() {
  const source = fs.readFileSync(path.resolve(__dirname, 'audio-api.js'), 'utf8');
  const win = {};
  const factory = new Function(
    'window', 'console', 'EventTarget', 'PicoAudio',
    `${source}\n;return window.AudioEngine;`
  );
  return factory(win, { log() {}, warn() {}, error() {} }, class {}, PicoAudio);
}

const AudioEngine = loadAudioEngine();

let passed = 0;
let failed = 0;
const queue = [];
/** Queued rather than run inline so async tests are awaited, not fired off. */
function test(name, fn) {
  queue.push({ name, fn });
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// A slot has to be audible-shaped for channelSlot to resolve it.
const slot = () => ({
  speed: 8,
  loopStart: 0,
  loopEnd: 7,
  steps: Array.from({ length: 32 }, () => ({ pitch: 24, waveform: 0, volume: 5, effect: 0 })),
});
const slots = { 0: slot(), 63: slot() };

test('a pattern reports only the channels that carry a slot', () => {
  const used = PicoAudio.patternChannels({ channels: [63, -1, -1, -1] }, slots);
  assert(
    JSON.stringify(used) === '[0]',
    `expected only channel 0 to be claimed, got ${JSON.stringify(used)}`
  );
});

test('every populated channel is reported, not just the first', () => {
  const used = PicoAudio.patternChannels({ channels: [0, -1, 63, 0] }, slots);
  assert(
    JSON.stringify(used) === '[0,2,3]',
    `expected channels 0, 2 and 3, got ${JSON.stringify(used)}`
  );
});

test('a muted channel is not claimed', () => {
  const used = PicoAudio.patternChannels(
    { channels: [{ slot: 63, muted: true }, { slot: 0 }] },
    slots
  );
  assert(
    JSON.stringify(used) === '[1]',
    `a muted channel must stay free for sfx, got ${JSON.stringify(used)}`
  );
});

test('a pattern with no channels claims nothing', () => {
  assert(JSON.stringify(PicoAudio.patternChannels({}, slots)) === '[]', 'expected no channels');
  assert(JSON.stringify(PicoAudio.patternChannels(null, slots)) === '[]', 'expected no channels');
});

/** A real engine carrying sfx on the given channels, and nothing else. */
function engineWithSfxOn(channels) {
  const stopped = [];
  const engine = Object.create(AudioEngine.prototype);
  engine._picoChannels = new Map(
    channels.map(c => [c, { instanceId: `inst${c}`, sfxNumber: c }])
  );
  engine.stopSound = id => { stopped.push(id); };
  return { engine, stopped };
}

test('taking a channel stops the sfx on it and frees the slot', () => {
  const { engine, stopped } = engineWithSfxOn([0, 1]);
  AudioEngine.prototype._stopPicoSfxOnChannels.call(engine, [0]);

  assert(JSON.stringify(stopped) === '["inst0"]', `expected only inst0 stopped, got ${JSON.stringify(stopped)}`);
  assert(!engine._picoChannels.has(0), 'channel 0 must be released');
  assert(engine._picoChannels.has(1), 'channel 1 must keep playing - the song does not use it');
});

test('taking a free channel is harmless', () => {
  const { engine, stopped } = engineWithSfxOn([1]);
  AudioEngine.prototype._stopPicoSfxOnChannels.call(engine, [0, 2, 3]);
  assert(stopped.length === 0, `nothing should have been stopped, got ${JSON.stringify(stopped)}`);
  assert(engine._picoChannels.has(1), 'channel 1 must be untouched');
});

test('no sfx channels at all is not an error', () => {
  const engine = { stopSound() { throw new Error('must not be called'); } };
  AudioEngine.prototype._stopPicoSfxOnChannels.call(engine, [0]);
  AudioEngine.prototype._stopPicoSfxOnChannels.call({ _picoChannels: new Map() }, undefined);
});

// The case that started this: dinky_kong's title runs
//   sfx"1" sfx"9" music"24"
// sfx 1 (1.2s of noise) auto-assigns to channel 0 and sfx 9 to channel 1, then
// music 24 - whose pattern is ch0 only - takes channel 0 back.
test('a song on channel 0 silences the noise but leaves the tonal sfx', () => {
  const { engine, stopped } = engineWithSfxOn([0, 1]);
  const claimed = PicoAudio.patternChannels({ channels: [63, -1, -1, -1] }, slots);
  AudioEngine.prototype._stopPicoSfxOnChannels.call(engine, claimed);

  assert(JSON.stringify(stopped) === '["inst0"]', `the noise on channel 0 must be cut, got ${JSON.stringify(stopped)}`);
  assert(engine._picoChannels.has(1), 'the tonal sfx on channel 1 must play on');
});

// renderSong flattens every channel into one buffer, so unless _renderPicoMusic
// records the claimed channels alongside it, playMusic has nothing to act on.
test('rendering a song records the channels its first pattern claims', () => {
  const source = JSON.stringify({
    type: 'pico_music',
    song: {
      start: 24,
      end: 24,
      loopTo: null,
      patterns: [{ index: 24, flags: 1, channels: [63, -1, -1, -1] }],
    },
    sfx: { 63: slot() },
  });

  const engine = { audioContext: { sampleRate: 44100 } };
  const rendered = AudioEngine.prototype._renderPicoMusic.call(engine, 24, source);

  assert(rendered.samples.length > 0, 'the song should have rendered some audio');
  assert(
    JSON.stringify(rendered.startChannels) === '[0]',
    `expected the song to claim channel 0, got ${JSON.stringify(rendered.startChannels)}`
  );
});

test('the recorded channels survive the render cache', () => {
  const source = JSON.stringify({
    type: 'pico_music',
    song: { start: 0, end: 0, loopTo: null, patterns: [{ index: 0, flags: 0, channels: [-1, 0, -1, -1] }] },
    sfx: { 0: slot() },
  });

  const engine = { audioContext: { sampleRate: 44100 } };
  AudioEngine.prototype._renderPicoMusic.call(engine, 7, source);
  const second = AudioEngine.prototype._renderPicoMusic.call(engine, 7, source);

  assert(
    JSON.stringify(second.startChannels) === '[1]',
    `a cache hit must still report the claimed channels, got ${JSON.stringify(second.startChannels)}`
  );
});

/** Enough of a Web Audio context for playMusic to run headlessly. */
function fakeAudioContext() {
  return {
    state: 'running',
    sampleRate: 44100,
    currentTime: 0,
    destination: {},
    createBuffer: (channels, length, sampleRate) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      copyToChannel() {},
    }),
    createBufferSource: () => ({
      buffer: null,
      loop: false,
      connect() {},
      start() {},
      stop() {},
      disconnect() {},
    }),
    createGain: () => ({
      gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} },
      connect() {},
      disconnect() {},
    }),
  };
}

function engineForPlayMusic(source, sfxChannels) {
  const stopped = [];
  const engine = Object.create(AudioEngine.prototype);
  engine.audioContext = fakeAudioContext();
  engine.masterVolume = { left: 1, right: 1 };
  engine.activeSounds = new Map();
  engine.picoResourceProvider = { getMusicSource: () => source };
  engine.ensureInitialized = async () => true;
  engine._isOutputMuted = () => false;
  engine.stopSound = id => { stopped.push(id); };
  engine._picoChannels = new Map(
    sfxChannels.map(c => [c, { instanceId: `inst${c}`, sfxNumber: c }])
  );
  return { engine, stopped };
}

// This is the wiring that actually matters, and unit-testing the helper alone
// does not cover it: playMusic has to call it. Everything below passed once
// while the call site was missing entirely.
test('playMusic frees the sfx channels the song takes', async () => {
  const source = JSON.stringify({
    type: 'pico_music',
    song: { start: 24, end: 24, loopTo: null, patterns: [{ index: 24, flags: 1, channels: [63, -1, -1, -1] }] },
    sfx: { 63: slot() },
  });
  const { engine, stopped } = engineForPlayMusic(source, [0, 1]);

  const ok = await engine.playMusic(24);

  assert(ok === true, 'the song should have started');
  assert(
    JSON.stringify(stopped) === '["inst0"]',
    `starting the song must cut the sfx on channel 0 only, got ${JSON.stringify(stopped)}`
  );
  assert(!engine._picoChannels.has(0), 'channel 0 must be released to the song');
  assert(engine._picoChannels.has(1), 'channel 1 is untouched by this song, so its sfx plays on');
});

test('playMusic leaves sfx alone on channels the song does not use', async () => {
  const source = JSON.stringify({
    type: 'pico_music',
    song: { start: 0, end: 0, loopTo: null, patterns: [{ index: 0, flags: 0, channels: [-1, -1, -1, 0] }] },
    sfx: { 0: slot() },
  });
  const { engine, stopped } = engineForPlayMusic(source, [0, 1]);

  await engine.playMusic(0);

  assert(stopped.length === 0, `no sfx should have been cut, got ${JSON.stringify(stopped)}`);
  assert(engine._picoChannels.size === 2, 'both sfx channels must survive');
});

/**
 * An engine whose startSound resolves asynchronously, like the real one.
 *
 * Lua cannot await, so a cart line such as `sfx"1" sfx"9" music"24"` fires all
 * three synchronously. Awaiting each call in a test hides every ordering bug
 * that pattern causes, so these tests deliberately do not await between calls.
 */
function engineForSfx() {
  const engine = Object.create(AudioEngine.prototype);
  engine.audioContext = { state: 'running', sampleRate: 44100, currentTime: 0 };
  engine.masterVolume = { left: 1, right: 1 };
  engine.activeSounds = new Map();
  engine._picoChannels = new Map();
  engine.picoResourceProvider = { getSfxResourceId: n => `res${n}` };
  engine._wavLoopPoints = () => null;
  engine._picoSfxDurationMs = () => 1200;
  engine.stopSound = id => { engine.activeSounds.delete(id); };
  engine.startSound = async resourceId => {
    await Promise.resolve();
    const id = `${resourceId}-inst`;
    engine.activeSounds.set(id, {});
    return id;
  };
  return engine;
}

function channelMap(engine) {
  const out = {};
  engine._picoChannels.forEach((entry, ch) => { out[ch] = entry.sfxNumber; });
  return out;
}

test('sfx() calls fired back-to-back take separate channels', async () => {
  const engine = engineForSfx();
  await Promise.all([engine.playSfx(1), engine.playSfx(9)]);

  const map = channelMap(engine);
  assert(
    JSON.stringify(map) === '{"0":1,"1":9}',
    `each sfx needs its own channel, got ${JSON.stringify(map)}`
  );
});

test('a third and fourth simultaneous sfx keep filling channels', async () => {
  const engine = engineForSfx();
  await Promise.all([
    engine.playSfx(1), engine.playSfx(2), engine.playSfx(3), engine.playSfx(4),
  ]);

  const map = channelMap(engine);
  assert(
    JSON.stringify(map) === '{"0":1,"1":2,"2":3,"3":4}',
    `four sfx should occupy all four channels, got ${JSON.stringify(map)}`
  );
});

test('every simultaneous sfx stays tracked, so it can be stopped later', async () => {
  const engine = engineForSfx();
  await Promise.all([engine.playSfx(1), engine.playSfx(9)]);

  // The real defect was not the channel numbering but the lost handle: an
  // overwritten entry left its sound playing with nothing able to stop it.
  const tracked = new Set();
  engine._picoChannels.forEach(entry => tracked.add(entry.instanceId));
  for (const id of engine.activeSounds.keys()) {
    assert(tracked.has(id), `sound ${id} is playing but no channel tracks it`);
  }
});

test('music started in the same frame silences the right sfx', async () => {
  const engine = engineForSfx();
  const source = JSON.stringify({
    type: 'pico_music',
    song: { start: 24, end: 24, loopTo: null, patterns: [{ index: 24, flags: 1, channels: [63, -1, -1, -1] }] },
    sfx: { 63: slot() },
  });
  engine.picoResourceProvider.getMusicSource = () => source;
  engine.ensureInitialized = async () => true;
  engine._isOutputMuted = () => false;
  engine.stopPicoMusic = () => {};
  engine.audioContext = fakeAudioContext();

  // dinky_kong's title line, in its real order and without awaiting.
  const calls = [engine.playSfx(1), engine.playSfx(9), engine.playMusic(24)];
  await Promise.all(calls);

  const map = channelMap(engine);
  assert(!engine._picoChannels.has(0), `the song must own channel 0, got ${JSON.stringify(map)}`);
  assert(
    engine._picoChannels.get(1)?.sfxNumber === 9,
    `the tonal sfx must survive on channel 1, got ${JSON.stringify(map)}`
  );
  // The noise must be genuinely stopped, not merely untracked.
  assert(
    !engine.activeSounds.has('res1-inst'),
    'the noise sfx is still playing after the song took its channel'
  );
});

test('a channel taken while its sfx is still starting does not leak the sound', async () => {
  const engine = engineForSfx();
  const pending = engine.playSfx(1);
  engine._releasePicoChannel(0);
  await pending;

  assert(engine.activeSounds.size === 0, 'the cancelled sfx should not be left playing');
  assert(!engine._picoChannels.has(0), 'the released channel should stay free');
});

async function main() {
  for (const { name, fn } of queue) {
    try {
      await fn();
      passed += 1;
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${name}`);
      console.log(`     ${error.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
