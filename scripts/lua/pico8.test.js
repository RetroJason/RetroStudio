/**
 * Contract-first unit tests for Pico-8 Lua Extensions.
 *
 * IMPORTANT:
 * These tests validate the intended API contract, not the current implementation.
 * If a function is missing or behaves like a stub, tests should fail.
 */

const assert = require('assert');
const path = require('path');

class BaseLuaExtension {
  constructor() {
    this.luaState = null;
    this.gameEmulator = null;
  }

  setLuaState(luaState) {
    this.luaState = luaState;
  }
}

global.BaseLuaExtension = BaseLuaExtension;
global.window = global.window || {};

const pico8SourcePath = path.resolve(__dirname, 'pico8.js');
delete require.cache[pico8SourcePath];
require(pico8SourcePath);

const LuaPico8Extensions = global.window.LuaPico8Extensions;
if (!LuaPico8Extensions) {
  throw new Error('Failed to load LuaPico8Extensions from pico8.js');
}

const EXPECTED_FUNCTIONS = [
  // Graphics and rendering
  'pset', 'pget', 'color', 'line', 'rect', 'rectfill', 'circ', 'circfill', 'cls', 'spr',
  'sget', 'sset', 'fget', 'fset', 'pal', 'palt', 'camera', 'clip', 'print',
  // Math
  'sin', 'cos', 'atan2', 'sqrt', 'abs', 'sgn', 'flr', 'ceil', 'min', 'max', 'mid', 'rnd', 'srand',
  // Bitwise
  'band', 'bor', 'bxor', 'bnot', 'shl', 'shr', 'lshl', 'lshr', 'rotl', 'rotr',
  // String
  'sub', 'tostr', 'tonum',
  // Table
  'add', 'del', 'count', 'all', 'foreach',
  // Audio
  'music', 'sfx',
  // Utility
  'printh', 'stat',
];

const coveredFunctions = new Set();

function makeMockEmulator() {
  return {
    spriteEngine: {
      _pixels: new Map(),
      _spritePixels: new Map(),
      _flags: {
        transparent: [],
        camera: null,
        clip: null,
      },
      setPixel(x, y, c) { this._pixels.set(`${x},${y}`, c); },
      getPixel(x, y) { return this._pixels.get(`${x},${y}`) ?? 0; },
      line() {},
      rect() {},
      rectfill() {},
      circ() {},
      circfill() {},
      clear(c) { this._lastClear = c; },
      drawSprite(n, x, y, w, h, fx, fy) { this._lastSpr = { n, x, y, w, h, fx, fy }; },
      getSpritePixel(x, y) { return this._spritePixels.get(`${x},${y}`) ?? 0; },
      setSpritePixel(x, y, c) { this._spritePixels.set(`${x},${y}`, c); },
      setTransparentColor(c, t) { this._flags.transparent.push({ c, t }); },
      setCamera(x, y) { this._flags.camera = { x, y }; },
      setClip(x, y, w, h) { this._flags.clip = { x, y, w, h }; },
      drawText(text, x, y, color) { this._lastText = { text, x, y, color }; },
    },
    audioEngine: {
      playMusic(n, fade, mask) { this._lastMusic = { n, fade, mask }; },
      playSfx(n, channel, offset, length) { this._lastSfx = { n, channel, offset, length }; },
    },
  };
}

function makePico8() {
  const emulator = makeMockEmulator();
  const pico8 = new LuaPico8Extensions(emulator);

  // Wrap required API methods so coverage is tracked by invocation.
  for (const fnName of EXPECTED_FUNCTIONS) {
    if (typeof pico8[fnName] !== 'function') {
      continue;
    }

    const original = pico8[fnName].bind(pico8);
    pico8[fnName] = (...args) => {
      coveredFunctions.add(fnName);
      return original(...args);
    };
  }

  return { pico8, emulator };
}

const tests = [
  {
    name: 'Contract: expected function count is stable',
    fn: () => {
      assert.strictEqual(EXPECTED_FUNCTIONS.length, 54);
    },
  },
  {
    name: 'Contract: every expected function exists on the extension',
    fn: () => {
      const { pico8 } = makePico8();
      for (const fnName of EXPECTED_FUNCTIONS) {
        assert.strictEqual(typeof pico8[fnName], 'function', `Missing function: ${fnName}`);
      }
    },
  },

  // Graphics
  {
    name: 'pset/pget roundtrip writes and reads pixel',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.pset(10, 20, 7);
      assert.strictEqual(pico8.pget(10, 20), 7);
    },
  },
  {
    name: 'color updates current drawing color',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.color(255);
      assert.strictEqual(pico8.currentColor, 255);
    },
  },
  {
    name: 'line/rect/rectfill/circ/circfill/cls/spr/camera/clip/print are callable',
    fn: () => {
      const { pico8, emulator } = makePico8();
      assert.doesNotThrow(() => pico8.line(0, 0, 5, 5, 3));
      assert.doesNotThrow(() => pico8.rect(0, 0, 5, 5, 3));
      assert.doesNotThrow(() => pico8.rectfill(0, 0, 5, 5, 3));
      assert.doesNotThrow(() => pico8.circ(5, 5, 2, 3));
      assert.doesNotThrow(() => pico8.circfill(5, 5, 2, 3));
      assert.doesNotThrow(() => pico8.cls(2));
      assert.doesNotThrow(() => pico8.spr(1, 2, 3, 1, 1, 0, 1));
      assert.doesNotThrow(() => pico8.camera(11, 22));
      assert.doesNotThrow(() => pico8.clip(1, 2, 3, 4));
      assert.doesNotThrow(() => pico8.print('hi', 8, 9, 6));
      assert.strictEqual(emulator.spriteEngine._lastClear, 2);
      assert.deepStrictEqual(emulator.spriteEngine._flags.camera, { x: 11, y: 22 });
      assert.deepStrictEqual(emulator.spriteEngine._flags.clip, { x: 1, y: 2, w: 3, h: 4 });
      assert.deepStrictEqual(emulator.spriteEngine._lastText, { text: 'hi', x: 8, y: 9, color: 6 });
    },
  },
  {
    name: 'sset/sget roundtrip writes and reads sprite pixel',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.sset(4, 6, 12);
      assert.strictEqual(pico8.sget(4, 6), 12);
    },
  },
  {
    name: 'fset/fget toggles sprite flags',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.fset(1, 2, 1);
      assert.strictEqual(pico8.fget(1, 2), 1);
      pico8.fset(1, 2, 0);
      assert.strictEqual(pico8.fget(1, 2), 0);
    },
  },
  {
    name: 'pal supports set and reset behavior',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.pal(1, 2);
      assert.strictEqual(pico8.currentPalette.get(1), 2);
      pico8.pal();
      assert.strictEqual(pico8.currentPalette.size, 0);
    },
  },
  {
    name: 'palt forwards transparent color configuration',
    fn: () => {
      const { pico8, emulator } = makePico8();
      pico8.palt(0, 1);
      assert.deepStrictEqual(emulator.spriteEngine._flags.transparent[0], { c: 0, t: true });
    },
  },

  // Math
  {
    name: 'sin/cos use pico8 domain (0.0-1.0)',
    fn: () => {
      const { pico8 } = makePico8();
      assert.ok(Math.abs(pico8.sin(0.25) - 1.0) < 0.001);
      assert.ok(Math.abs(pico8.cos(0.0) - 1.0) < 0.001);
    },
  },
  {
    name: 'atan2/sqrt/abs/sgn/flr/ceil/min/max/mid produce expected values',
    fn: () => {
      const { pico8 } = makePico8();
      assert.ok(Math.abs(pico8.atan2(1, 1) - 0.125) < 0.01);
      assert.strictEqual(pico8.sqrt(16), 4);
      assert.strictEqual(pico8.abs(-7), 7);
      assert.strictEqual(pico8.sgn(-3), -1);
      assert.strictEqual(pico8.flr(3.8), 3);
      assert.strictEqual(pico8.ceil(3.2), 4);
      assert.strictEqual(pico8.min(3, 5), 3);
      assert.strictEqual(pico8.max(3, 5), 5);
      assert.strictEqual(pico8.mid(1, 9, 4), 4);
    },
  },
  {
    name: 'rnd/srand are callable and track seed',
    fn: () => {
      const { pico8 } = makePico8();
      const n = pico8.rnd(10);
      assert.ok(n >= 0 && n <= 10);
      pico8.srand(1234);
      assert.strictEqual(pico8.randomSeed, 1234);
    },
  },

  // Bitwise
  {
    name: 'band/bor/bxor/bnot/shl/shr/lshl/lshr/rotl/rotr produce expected values',
    fn: () => {
      const { pico8 } = makePico8();
      assert.strictEqual(pico8.band(12, 10), 8);
      assert.strictEqual(pico8.bor(12, 10), 14);
      assert.strictEqual(pico8.bxor(12, 10), 6);
      assert.strictEqual(pico8.bnot(0), -1);
      assert.strictEqual(pico8.shl(2, 3), 16);
      assert.strictEqual(pico8.shr(16, 2), 4);
      assert.strictEqual(pico8.lshl(2, 3), 16);
      assert.strictEqual(pico8.lshr(16, 2), 4);
      assert.strictEqual(pico8.rotl(1, 1), 2);
      assert.strictEqual(pico8.rotr(2, 1), 1);
    },
  },

  // Strings
  {
    name: 'sub/tostr/tonum work on representative cases',
    fn: () => {
      const { pico8 } = makePico8();
      assert.strictEqual(pico8.sub('hello', 2, 4), 'ell');
      assert.strictEqual(pico8.tostr(42), '42');
      assert.strictEqual(pico8.tonum('3.5'), 3.5);
    },
  },

  // Table contract tests (must not be stubs)
  {
    name: 'add appends and returns inserted value',
    fn: () => {
      const { pico8 } = makePico8();
      const t = [1, 2];
      const out = pico8.add(t, 3);
      assert.strictEqual(out, 3);
      assert.deepStrictEqual(t, [1, 2, 3]);
    },
  },
  {
    name: 'del removes first matching value and returns it',
    fn: () => {
      const { pico8 } = makePico8();
      const t = [10, 20, 30];
      const out = pico8.del(t, 20);
      assert.strictEqual(out, 20);
      assert.deepStrictEqual(t, [10, 30]);
    },
  },
  {
    name: 'count returns table element count',
    fn: () => {
      const { pico8 } = makePico8();
      const t = ['a', 'b', 'c'];
      assert.strictEqual(pico8.count(t), 3);
    },
  },
  {
    name: 'all returns an iterator function',
    fn: () => {
      const { pico8 } = makePico8();
      const t = [5, 6];
      const iter = pico8.all(t);
      assert.strictEqual(typeof iter, 'function');
      assert.strictEqual(iter(), 5);
      assert.strictEqual(iter(), 6);
      assert.strictEqual(iter(), undefined);
    },
  },
  {
    name: 'foreach calls callback for each table value',
    fn: () => {
      const { pico8 } = makePico8();
      const t = [1, 2, 3];
      let sum = 0;
      pico8.foreach(t, (v) => { sum += v; });
      assert.strictEqual(sum, 6);
    },
  },

  // Audio and utility
  {
    name: 'music and sfx forward calls to audio engine',
    fn: () => {
      const { pico8, emulator } = makePico8();
      pico8.music(2, 100, 255);
      pico8.sfx(7, 1, 2, 16);
      assert.deepStrictEqual(emulator.audioEngine._lastMusic, { n: 2, fade: 100, mask: 255 });
      assert.deepStrictEqual(emulator.audioEngine._lastSfx, { n: 7, channel: 1, offset: 2, length: 16 });
    },
  },
  {
    name: 'printh and stat are callable with expected stat behavior',
    fn: () => {
      const { pico8 } = makePico8();
      assert.doesNotThrow(() => pico8.printh('hello'));
      assert.strictEqual(pico8.stat(4), 60);
      assert.strictEqual(pico8.stat(999), 0);
    },
  },
  {
    name: 'Coverage: all required functions were invoked by tests',
    fn: () => {
      const missing = EXPECTED_FUNCTIONS.filter((name) => !coveredFunctions.has(name));
      assert.deepStrictEqual(missing, [], `Missing function coverage: ${missing.join(', ')}`);
    },
  },
];

function run() {
  console.log('Running Pico-8 contract tests (contract-first)...\n');

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      test.fn();
      passed += 1;
      console.log(`PASS ${test.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${test.name}`);
      console.error(`  ${error.message}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);
  process.exit(failed > 0 ? 1 : 0);
}

if (require.main === module) {
  run();
}

module.exports = {
  LuaPico8Extensions,
  EXPECTED_FUNCTIONS,
};
