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
  'pset', 'pget', 'color', 'line', 'rect', 'rectfill', 'circ', 'circfill', 'cls', 'pico_mode', 'spr',
  'sspr', 'map', 'mget', 'mset',
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
  // Input
  'btn', 'btnp',
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
    gameConsole: {
      _lines: [],
      writeToConsole(text) { this._lines.push(String(text)); },
    },
    audioEngine: {
      playMusic(n, fade, mask) { this._lastMusic = { n, fade, mask }; },
      playSfx(n, channel, offset, length) { this._lastSfx = { n, channel, offset, length }; },
    },
    inputManager: {
      _held: 0,
      _pressed: 0,
      isKeyHeld(mask) { return (this._held & mask) !== 0; },
      isKeyPressed(mask) { return (this._pressed & mask) !== 0; },
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

/** Build a minimal D2TX buffer: 32-byte header followed by the pixel payload. */
function makeD2Texture(format, width, height, payload) {
  const bytes = new Uint8Array(32 + payload.length);
  bytes.set([0x44, 0x32, 0x54, 0x58], 0); // "D2TX"
  bytes[4] = 2; // version
  bytes[5] = format;
  new DataView(bytes.buffer).setUint16(6, width, true);
  new DataView(bytes.buffer).setUint16(8, height, true);
  bytes.set(payload, 32);
  return bytes;
}

const tests = [
  {
    name: 'Contract: expected function count is stable',
    fn: () => {
      assert.strictEqual(EXPECTED_FUNCTIONS.length, 61);
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
      assert.strictEqual(pico8._framebuffer[0], 2);
      assert.strictEqual(pico8._cameraX, 11);
      assert.strictEqual(pico8._cameraY, 22);
      assert.deepStrictEqual(pico8._clipRect, { x: 1, y: 2, w: 3, h: 4 });
      assert.deepStrictEqual(emulator.spriteEngine._lastText, { text: 'hi', x: 8, y: 9, color: 6 });
      assert.strictEqual(emulator.gameConsole._lines.length, 0);
    },
  },
  {
    name: 'clip with partial args keeps default width/height (no stack bleed)',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.luaState = {
        raw_tostring() {
          return '7';
        },
      };

      pico8.clip(4, 5);
      assert.deepStrictEqual(pico8._clipRect, { x: 4, y: 5, w: 128, h: 128 });
    },
  },
  {
    name: 'circfill draws in lower half when unclipped',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();
      pico8.circfill(6, 121, 2, 12);

      const hit = pico8._framebuffer[(121 * 128) + 6];
      assert.strictEqual(hit, 12);
    },
  },
  {
    name: 'Fallback renderer uploads and blits framebuffer without spriteEngine',
    fn: () => {
      const pico8 = new LuaPico8Extensions({});
      const fakeGpu = {
        createTextureRaw(pixels, width, height, format) {
          const probeX = Math.floor(((1 + 0.5) * width) / 128);
          const probeY = Math.floor(((2 + 0.5) * height) / 128);
          this.created = {
            width,
            height,
            format,
            pixel0: pixels[0],
            probePixel: pixels[(probeY * width) + probeX],
          };
          return { id: 'fbtex' };
        },
        deleteTexture() {},
        setPalette() {},
        setPaletteOffset(offset) {
          this.paletteOffset = offset;
        },
        blit(tex, opts) {
          this.blitCall = { tex, opts };
        },
      };

      pico8.initGpu(fakeGpu);
      pico8.pset(1, 2, 5);

      const queue = [];
      pico8.renderFrame(fakeGpu, 16, { enqueue: (item) => queue.push(item) });
      assert.strictEqual(queue.length, 1);
      queue[0].draw();

      assert.strictEqual(fakeGpu.created.width, 448);
      assert.strictEqual(fakeGpu.created.height, 368);
      assert.strictEqual(fakeGpu.created.format, 0x09);
      assert.strictEqual(fakeGpu.created.probePixel, 5);
      assert.strictEqual(fakeGpu.paletteOffset, 0);
      assert.ok(fakeGpu.blitCall);
      assert.strictEqual(fakeGpu.blitCall.opts.srcW, 448);
      assert.strictEqual(fakeGpu.blitCall.opts.srcH, 368);
      assert.strictEqual(fakeGpu.blitCall.opts.x, 0);
      assert.strictEqual(fakeGpu.blitCall.opts.y, 0);
      assert.strictEqual(fakeGpu.blitCall.opts.scaleX, 1);
      assert.strictEqual(fakeGpu.blitCall.opts.scaleY, 1);
    },
  },
  {
    name: 'pico_mode supports fixed scale and querying current mode',
    fn: () => {
      const { pico8 } = makePico8();
      const fakeGpu = {
        canvas: { width: 448, height: 368 },
        createTextureRaw() { return { id: 'fbtex' }; },
        deleteTexture() {},
        setPalette() {},
        setPaletteOffset() {},
        blit(tex, opts) {
          this.blitCall = { tex, opts };
        },
      };

      pico8.initGpu(fakeGpu);
      pico8.cls(0);
      assert.strictEqual(pico8.pico_mode(), 0);

      pico8.pico_mode(2);
      assert.strictEqual(pico8.pico_mode(), 2);

      pico8.renderFrame(fakeGpu, 16);

      assert.ok(fakeGpu.blitCall);
      assert.strictEqual(fakeGpu.blitCall.opts.x, 96);
      assert.strictEqual(fakeGpu.blitCall.opts.y, 56);
      assert.strictEqual(fakeGpu.blitCall.opts.scaleX, 2);
      assert.strictEqual(fakeGpu.blitCall.opts.scaleY, 2);
    },
  },
  {
    name: 'sset/sget roundtrip writes and reads sprite pixel',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.setSpriteSheet(new Uint8Array(128 * 128), 128, 128);
      pico8.sset(4, 6, 12);
      assert.strictEqual(pico8.sget(4, 6), 12);
    },
  },
  {
    name: '_decodeIndexedD2 reads an i8 texture (mode 0x09) one byte per pixel',
    fn: () => {
      const { pico8 } = makePico8();
      const bytes = makeD2Texture(0x09, 4, 2, [1, 2, 3, 4, 5, 6, 7, 8]);
      const decoded = pico8._decodeIndexedD2(bytes);
      assert.strictEqual(decoded.width, 4);
      assert.strictEqual(decoded.height, 2);
      assert.deepStrictEqual(Array.from(decoded.pixels), [1, 2, 3, 4, 5, 6, 7, 8]);
    },
  },
  {
    name: '_decodeIndexedD2 unpacks mode 0x0a as i4, not i2',
    fn: () => {
      // Regression: the mode table was off by one, so cart sprite sheets (i4)
      // were unpacked at 2bpp, halving every colour and doubling the width.
      const { pico8 } = makePico8();
      const previousD2File = global.window.D2File;
      let seenBits = null;
      global.window.D2File = {
        _unpackSubBytePixels(data, format, bits, count) {
          seenBits = bits;
          return new Uint8Array(count);
        },
      };
      try {
        pico8._decodeIndexedD2(makeD2Texture(0x0a, 4, 2, [0x21, 0x43, 0x65, 0x87]));
      } finally {
        global.window.D2File = previousD2File;
      }
      assert.strictEqual(seenBits, 4);
    },
  },
  {
    name: 'spr blits sprite sheet pixels into the framebuffer with flip and transparency',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      const sheet = new Uint8Array(128 * 128);
      // Sprite 1 occupies sheet x 8..15, y 0..7. Mark its top-left corner only.
      sheet[(0 * 128) + 8] = 9;
      pico8.setSpriteSheet(sheet, 128, 128);

      pico8.spr(1, 20, 30);
      assert.strictEqual(pico8._framebuffer[(30 * 128) + 20], 9);
      // Colour 0 is transparent by default, so the rest of the cell is untouched.
      assert.strictEqual(pico8._framebuffer[(30 * 128) + 21], 0);

      // Horizontal flip puts the marked pixel at the far edge of the cell.
      pico8.spr(1, 40, 50, 1, 1, 1, 0);
      assert.strictEqual(pico8._framebuffer[(50 * 128) + 47], 9);
    },
  },
  {
    name: 'sspr stretches a sheet rectangle',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      const sheet = new Uint8Array(128 * 128);
      sheet[0] = 5;
      pico8.setSpriteSheet(sheet, 128, 128);

      pico8.sspr(0, 0, 1, 1, 10, 10, 2, 2);
      assert.strictEqual(pico8._framebuffer[(10 * 128) + 10], 5);
      assert.strictEqual(pico8._framebuffer[(11 * 128) + 11], 5);
    },
  },
  {
    name: 'map draws non-zero cells and mget/mset access map data',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      const sheet = new Uint8Array(128 * 128);
      sheet[(0 * 128) + 8] = 4; // sprite 1 top-left
      pico8.setSpriteSheet(sheet, 128, 128);

      const tiles = new Uint8Array(4 * 4);
      pico8.setMapData(tiles, 4, 4);

      pico8.mset(1, 0, 1);
      assert.strictEqual(pico8.mget(1, 0), 1);

      pico8.map(0, 0, 0, 0, 4, 4);
      // Cell (1,0) draws sprite 1 at screen x=8, y=0.
      assert.strictEqual(pico8._framebuffer[(0 * 128) + 8], 4);
      // Cell (0,0) is sprite 0, which PICO-8 treats as empty.
      assert.strictEqual(pico8._framebuffer[0], 0);
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
    name: 'palt configures transparency and resets to colour 0',
    fn: () => {
      const { pico8, emulator } = makePico8();
      pico8.palt(0, 1);
      assert.deepStrictEqual(emulator.spriteEngine._flags.transparent[0], { c: 0, t: true });
      assert.ok(pico8._isTransparentColor(0));

      pico8.palt(0, 0);
      assert.ok(!pico8._isTransparentColor(0));

      pico8.palt();
      assert.ok(pico8._isTransparentColor(0));
    },
  },
  {
    name: 'palt accepts the boolean flag PICO-8 carts actually pass',
    fn: () => {
      const { pico8, emulator } = makePico8();
      pico8.palt(3, true);
      assert.deepStrictEqual(emulator.spriteEngine._flags.transparent[0], { c: 3, t: true });
      assert.ok(pico8._isTransparentColor(3));

      pico8.palt(3, false);
      assert.deepStrictEqual(emulator.spriteEngine._flags.transparent[1], { c: 3, t: false });
      assert.ok(!pico8._isTransparentColor(3));

      // Colour 0 is transparent by default, and palt(0, false) must clear it.
      pico8.palt(0, false);
      assert.ok(!pico8._isTransparentColor(0));
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
    name: 'add supports Lua-style table object',
    fn: () => {
      const { pico8 } = makePico8();
      const t = { 1: 'a', 2: 'b' };
      const out = pico8.add(t, 'c');
      assert.strictEqual(out, 'c');
      assert.strictEqual(t[1], 'a');
      assert.strictEqual(t[2], 'b');
      assert.strictEqual(t[3], 'c');
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

  // Input
  {
    name: 'btn maps pico8 button indices onto input masks',
    fn: () => {
      const { pico8, emulator } = makePico8();
      emulator.inputManager._held = 0x0040 | 0x0100; // Left + X
      assert.strictEqual(pico8.btn(0), true, 'left');
      assert.strictEqual(pico8.btn(1), false, 'right');
      assert.strictEqual(pico8.btn(2), false, 'up');
      assert.strictEqual(pico8.btn(3), false, 'down');
      assert.strictEqual(pico8.btn(4), false, 'O');
      assert.strictEqual(pico8.btn(5), true, 'X');
    },
  },
  {
    name: 'btn with no index returns a bitfield in pico8 button order',
    fn: () => {
      const { pico8, emulator } = makePico8();
      emulator.inputManager._held = 0x0080 | 0x0001; // Right (index 1) + O (index 4)
      assert.strictEqual(pico8.btn(), (1 << 1) | (1 << 4));
    },
  },
  {
    name: 'btn reads held state while btnp reads this-frame presses',
    fn: () => {
      const { pico8, emulator } = makePico8();
      emulator.inputManager._held = 0x0010;   // Up held
      emulator.inputManager._pressed = 0;     // but not newly pressed
      assert.strictEqual(pico8.btn(2), true);
      assert.strictEqual(pico8.btnp(2), false);

      emulator.inputManager._pressed = 0x0010;
      assert.strictEqual(pico8.btnp(2), true);
    },
  },
  {
    name: 'btn reports nothing for players other than 0',
    fn: () => {
      const { pico8, emulator } = makePico8();
      emulator.inputManager._held = 0x0040;
      assert.strictEqual(pico8.btn(0, 0), true);
      assert.strictEqual(pico8.btn(0, 1), false, 'only one controller is wired up');
    },
  },
  {
    name: 'btn returns false for an out of range button index',
    fn: () => {
      const { pico8, emulator } = makePico8();
      emulator.inputManager._held = 0xFFFF;
      assert.strictEqual(pico8.btn(6), false);
    },
  },
  {
    name: 'btn is safe before the input manager exists',
    fn: () => {
      const { pico8, emulator } = makePico8();
      emulator.inputManager = null;
      assert.strictEqual(pico8.btn(0), false);
      assert.strictEqual(pico8.btnp(0), false);
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
