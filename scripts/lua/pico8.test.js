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

// print() rasterises the built-in font, which lives in its own module.
require(path.resolve(__dirname, 'pico8-font.js'));

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
  'sget', 'sset', 'fget', 'fset', 'pal', 'palt', 'camera', 'clip', 'print', 'cursor',
  // Math
  'sin', 'cos', 'atan2', 'sqrt', 'abs', 'sgn', 'flr', 'ceil', 'min', 'max', 'mid', 'rnd', 'srand',
  // Bitwise
  'band', 'bor', 'bxor', 'bnot', 'shl', 'shr', 'lshl', 'lshr', 'rotl', 'rotr',
  // String
  'sub', 'tostr', 'tonum', 'chr', 'ord',
  // Table
  'add', 'del', 'count', 'all', 'foreach',
  // Coroutines (implemented in Lua; the JS stubs only satisfy the loader)
  'cocreate', 'coresume', 'costatus', 'cowrap', 'yield',
  // Memory
  'peek', 'poke', 'peek2', 'poke2', 'peek4', 'poke4', 'memcpy', 'memset', 'reload',
  // Persistent storage
  'cartdata', 'dget', 'dset',
  // Audio
  'music', 'sfx',
  // Input
  'btn', 'btnp',
  // Utility
  'printh', 'stat', 'menuitem', 'flip', 'pico_flags', 'time', 't',
];

const coveredFunctions = new Set();

function makeMockEmulator() {
  return {
    frameCount: 0,
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

/** Read a framebuffer pixel by logical coordinate. */
function px(pico8, x, y) {
  return pico8._framebuffer[(y * 128) + x];
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
      assert.strictEqual(EXPECTED_FUNCTIONS.length, 86);
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
      // print() rasterises into the framebuffer; it must not reach for a
      // spriteEngine (never assigned in production) or the debug console.
      assert.strictEqual(emulator.spriteEngine._lastText, undefined);
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

  // print() / cursor() - the built-in font
  {
    name: 'print rasterises glyph pixels into the framebuffer',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();
      // 'i' is ['###', '.#.', '.#.', '.#.', '###'].
      pico8.print('i', 10, 20, 7);

      assert.strictEqual(px(pico8, 10, 20), 7, 'top-left of "i" should be ink');
      assert.strictEqual(px(pico8, 11, 20), 7);
      assert.strictEqual(px(pico8, 12, 20), 7);
      assert.strictEqual(px(pico8, 10, 21), 0, 'row 1 of "i" is only the stem');
      assert.strictEqual(px(pico8, 11, 21), 7);
      assert.strictEqual(px(pico8, 11, 24), 7, 'glyph is 5 rows tall');
      assert.strictEqual(px(pico8, 11, 25), 0, 'nothing below the glyph');
    },
  },
  {
    name: 'print returns the x position after the last character',
    fn: () => {
      const { pico8 } = makePico8();
      // Narrow glyphs advance 4px; carts use the return value to chain text.
      assert.strictEqual(pico8.print('abc', 10, 0), 22);
      // The 0x80+ symbol block is 8px wide.
      assert.strictEqual(pico8.print(String.fromCharCode(0x80), 0, 0), 8);
    },
  },
  {
    name: 'print colour argument sets the pen for later draws',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();
      pico8.print('a', 0, 0, 11);
      assert.strictEqual(pico8.currentColor, 11);

      // ...and printing without a colour reuses it rather than resetting.
      pico8.print('a', 0, 64);
      assert.strictEqual(px(pico8, 1, 64), 11);
    },
  },
  {
    name: 'print without coordinates uses the cursor and drops a line',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();
      pico8.cursor(20, 30, 9);

      pico8.print('i');
      assert.strictEqual(px(pico8, 20, 30), 9);
      assert.deepStrictEqual([pico8._cursorX, pico8._cursorY], [20, 36]);

      pico8.print('i');
      assert.strictEqual(px(pico8, 20, 36), 9, 'second line sits 6px below');
      assert.deepStrictEqual([pico8._cursorX, pico8._cursorY], [20, 42]);
    },
  },
  {
    name: 'print newline resets x and drops a line',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();
      pico8.print('i\ni', 40, 10, 7);

      assert.strictEqual(px(pico8, 40, 10), 7);
      assert.strictEqual(px(pico8, 40, 16), 7, 'second line back at the start x');
      assert.strictEqual(pico8._cursorY, 22, 'cursor lands below the last line');
    },
  },
  {
    name: 'print scrolls the screen once the cursor reaches the bottom',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();
      pico8.pset(5, 20, 9);
      pico8.cursor(0, 126, 7);

      pico8.print('i');

      assert.strictEqual(px(pico8, 5, 20), 0, 'old content moved up');
      assert.strictEqual(px(pico8, 5, 14), 9, 'by exactly one line height');
      assert.strictEqual(px(pico8, 0, 120), 7, 'text drawn on the last line');
    },
  },
  {
    name: 'print obeys camera and clip like every other draw call',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();
      pico8.camera(5, 4);
      pico8.print('i', 10, 20, 7);
      assert.strictEqual(px(pico8, 5, 16), 7, 'camera offset applied');

      pico8.resetRuntimeState();
      pico8.clip(0, 0, 11, 128);
      pico8.print('i', 10, 20, 7);
      assert.strictEqual(px(pico8, 10, 20), 7);
      assert.strictEqual(px(pico8, 11, 20), 0, 'pixels past the clip are dropped');
    },
  },
  {
    name: 'print does not log to the console (that is printh)',
    fn: () => {
      const { pico8, emulator } = makePico8();
      pico8.print('hud text');
      pico8.print('hud text', 0, 0);
      assert.strictEqual(emulator.gameConsole._lines.length, 0);
    },
  },
  {
    name: 'cursor returns the previous position and cls homes it',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      assert.deepStrictEqual(pico8.cursor(12, 34), [0, 0]);
      assert.deepStrictEqual(pico8.cursor(1, 2), [12, 34]);

      pico8.cls(0);
      assert.deepStrictEqual([pico8._cursorX, pico8._cursorY], [0, 0]);
    },
  },
  {
    name: 'font metrics match PICO-8 so cart layout maths lines up',
    fn: () => {
      const font = global.window.Pico8Font;
      assert.ok(font, 'pico8-font.js should register window.Pico8Font');
      assert.strictEqual(font.GLYPH_HEIGHT, 5);
      assert.strictEqual(font.LINE_HEIGHT, 6);
      assert.strictEqual(font.NARROW_ADVANCE, 4);
      assert.strictEqual(font.WIDE_ADVANCE, 8);

      assert.strictEqual(font.measure('score'), 20);
      assert.strictEqual(font.measure('ab\nabcd'), 16, 'measure takes the longest line');
      assert.strictEqual(font.rowsFor(0x20), null, 'space draws nothing');
      assert.ok(font.rowsFor('a'.charCodeAt(0)), 'letters have glyphs');
      assert.deepStrictEqual(
        Array.from(font.rowsFor('A'.charCodeAt(0))),
        Array.from(font.rowsFor('a'.charCodeAt(0))),
        'both cases fold to the same capitals'
      );
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
    // Carts write `spr(n, x, y, 1, 1, facing_left, false)`, passing real Lua
    // booleans. Parsing these as integers threw and killed the frame.
    name: 'spr and sspr accept boolean flip arguments as well as 0/1',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      const sheet = new Uint8Array(128 * 128);
      sheet[(0 * 128) + 8] = 9; // sprite 1 top-left
      pico8.setSpriteSheet(sheet, 128, 128);

      // false must behave exactly like 0: no flip.
      pico8.spr(1, 20, 30, 1, 1, false, false);
      assert.strictEqual(pico8._framebuffer[(30 * 128) + 20], 9);

      // true must behave exactly like 1: the marked pixel lands on the far edge.
      pico8.spr(1, 40, 50, 1, 1, true, false);
      assert.strictEqual(pico8._framebuffer[(50 * 128) + 47], 9);

      // Vertical flip via boolean moves it to the bottom row of the cell.
      pico8.spr(1, 60, 70, 1, 1, false, true);
      assert.strictEqual(pico8._framebuffer[(77 * 128) + 60], 9);

      const flat = new Uint8Array(128 * 128);
      flat[0] = 5;
      pico8.setSpriteSheet(flat, 128, 128);
      pico8.sspr(0, 0, 1, 1, 10, 10, 2, 2, false, false);
      assert.strictEqual(pico8._framebuffer[(10 * 128) + 10], 5);
    },
  },
  {
    // Carts animate with `sin(time()/2)` and gate state on `t() > deadline`.
    // Without these the cart died at load with "attempt to call global 'time'".
    name: 'time and t report elapsed seconds from the emulator frame counter',
    fn: () => {
      const { pico8, emulator } = makePico8();

      assert.strictEqual(pico8.time(), 0);
      assert.strictEqual(pico8.t(), 0);

      emulator.frameCount = 90;
      assert.strictEqual(pico8.time(), 1.5);
      assert.strictEqual(pico8.t(), 1.5);
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
      assert.strictEqual(pico8.fget(1, 2), true);
      pico8.fset(1, 2, 0);
      assert.strictEqual(pico8.fget(1, 2), false);
    },
  },
  {
    name: 'fget with a flag index returns a boolean, not 0 (Lua treats 0 as true)',
    fn: () => {
      const { pico8 } = makePico8();
      assert.strictEqual(pico8.fget(9, 7), false);
      pico8.fset(9, 7, true);
      assert.strictEqual(pico8.fget(9, 7), true);
    },
  },
  {
    name: 'fset with two arguments writes the whole flag byte',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.fset(5, 0b10000010);
      assert.strictEqual(pico8.fget(5), 0b10000010);
      assert.strictEqual(pico8.fget(5, 1), true);
      assert.strictEqual(pico8.fget(5, 7), true);
      assert.strictEqual(pico8.fget(5, 2), false);
    },
  },
  {
    name: 'pico_flags installs cart sprite flags and reads them back',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.pico_flags('0103ff');
      assert.strictEqual(pico8.fget(0), 0x01);
      assert.strictEqual(pico8.fget(1), 0x03);
      assert.strictEqual(pico8.fget(2), 0xff);
      assert.strictEqual(pico8.fget(3), 0);
      assert.strictEqual(pico8.pico_flags().slice(0, 6), '0103ff');
    },
  },
  {
    name: 'peek/poke round-trip through the sprite flag region',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.poke(0x3000 + 12, 0x2a);
      assert.strictEqual(pico8.fget(12), 0x2a);
      assert.strictEqual(pico8.peek(0x3000 + 12), 0x2a);
    },
  },
  {
    name: 'peek/poke round-trip through general purpose RAM',
    fn: () => {
      const { pico8 } = makePico8();
      assert.strictEqual(pico8.peek(0x4300), 0);
      pico8.poke(0x4300, 1, 2, 3);
      assert.deepStrictEqual(pico8.peek(0x4300, 3), [1, 2, 3]);
    },
  },
  {
    name: 'peek2/poke2 and peek4/poke4 round-trip signed and fixed-point values',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.poke2(0x4300, -2);
      assert.strictEqual(pico8.peek2(0x4300), -2);
      pico8.poke4(0x4310, -1.5);
      assert.strictEqual(pico8.peek4(0x4310), -1.5);
    },
  },
  {
    name: 'peek/poke map the sprite sheet two pixels per byte, low nibble first',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.setSpriteSheet(new Uint8Array(128 * 128), 128, 128);
      pico8.sset(0, 0, 3);
      pico8.sset(1, 0, 5);
      assert.strictEqual(pico8.peek(0), 0x53);
      pico8.poke(0, 0x21);
      assert.strictEqual(pico8.sget(0, 0), 1);
      assert.strictEqual(pico8.sget(1, 0), 2);
    },
  },
  {
    name: 'memcpy handles overlapping ranges like memmove',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.poke(0x4300, 1, 2, 3, 4);
      pico8.memcpy(0x4301, 0x4300, 3);
      assert.deepStrictEqual(pico8.peek(0x4300, 4), [1, 1, 2, 3]);
    },
  },
  {
    name: 'reload restores sprite pixels the cart overwrote',
    fn: () => {
      const { pico8 } = makePico8();
      const pixels = new Uint8Array(128 * 128);
      pixels[0] = 7;
      pixels[1] = 7;
      pico8.setSpriteSheet(pixels, 128, 128);
      pico8.sset(0, 0, 1);
      assert.strictEqual(pico8.sget(0, 0), 1);
      pico8.reload(0, 0, 1);
      assert.strictEqual(pico8.sget(0, 0), 7);
    },
  },
  {
    name: 'reload with no arguments restores flags and map as well',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.setMapData(new Uint8Array([9, 9, 9, 9]), 2, 2);
      pico8.pico_flags('11');
      pico8.mset(0, 0, 4);
      pico8.fset(0, 0x55);
      pico8.reload();
      assert.strictEqual(pico8.mget(0, 0), 9);
      assert.strictEqual(pico8.fget(0), 0x11);
    },
  },
  {
    name: 'memset fills a block',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.memset(0x4300, 0xab, 3);
      assert.deepStrictEqual(pico8.peek(0x4300, 3), [0xab, 0xab, 0xab]);
    },
  },
  {
    name: 'cartdata/dset/dget persist values and report prior data',
    fn: () => {
      const store = new Map();
      global.localStorage = {
        getItem: key => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
      };
      try {
        const first = makePico8().pico8;
        assert.strictEqual(first.cartdata('unit_test'), true);
        assert.strictEqual(first.dget(0), 0);
        first.dset(0, 42);
        first.dset(63, -1.5);

        const second = makePico8().pico8;
        assert.strictEqual(second.cartdata('unit_test'), false);
        assert.strictEqual(second.dget(0), 42);
        assert.strictEqual(second.dget(63), -1.5);
      } finally {
        delete global.localStorage;
      }
    },
  },
  {
    name: 'cartdata rejects ids that are not filename safe',
    fn: () => {
      const { pico8 } = makePico8();
      assert.throws(() => pico8.cartdata('../escape'), /invalid id/);
      assert.throws(() => pico8.cartdata(''), /invalid id/);
    },
  },
  {
    name: 'dset before cartdata is an error rather than a silent no-op',
    fn: () => {
      const { pico8 } = makePico8();
      assert.throws(() => pico8.dset(0, 1), /cartdata/);
    },
  },
  {
    name: 'menuitem registers and removes pause menu entries',
    fn: () => {
      const { pico8 } = makePico8();
      const cb = () => {};
      pico8.menuitem(1, 'save game', cb);
      assert.deepStrictEqual(pico8.menuItems.get(1), { label: 'save game', callback: cb });
      pico8.menuitem(1);
      assert.strictEqual(pico8.menuItems.has(1), false);
    },
  },
  {
    name: 'flip is a no-op without a GPU rather than throwing',
    fn: () => {
      const { pico8 } = makePico8();
      assert.doesNotThrow(() => pico8.flip());
    },
  },
  {
    name: 'coroutine stubs refuse to run: they must come from the Lua implementation',
    fn: () => {
      const { pico8 } = makePico8();
      for (const name of ['cocreate', 'coresume', 'costatus', 'cowrap', 'yield']) {
        assert.throws(() => pico8[name](), /Lua-native/, `${name} should not be callable in JS`);
      }
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
  {
    name: 'chr builds a string from ordinals and stays in byte range',
    fn: () => {
      const { pico8 } = makePico8();
      assert.strictEqual(pico8.chr(64), '@');
      assert.strictEqual(pico8.chr(104, 101, 108, 108, 111), 'hello');
      assert.strictEqual(pico8.chr(), '');
      // PICO-8 strings are byte strings, so codes wrap rather than becoming
      // a multi-byte character.
      assert.strictEqual(pico8.chr(0x141), 'A');
    },
  },
  {
    // The third argument is a COUNT, unlike Lua's string.byte(s, i, j) which
    // takes an end index. Getting this backwards silently returns too few
    // values.
    name: 'ord reads ordinals and treats its third argument as a count',
    fn: () => {
      const { pico8 } = makePico8();
      assert.strictEqual(pico8.ord('@'), 64);
      assert.strictEqual(pico8.ord('123', 2), 50);
      assert.deepStrictEqual(pico8.ord('123', 2, 2), [50, 51]);

      // Out of range is nil, not an error. undefined (not null) so the bridge
      // hands Lua a real nil instead of a truthy js.null.
      assert.strictEqual(pico8.ord('abc', 5), undefined);
      assert.strictEqual(pico8.ord('', 1), undefined);
      assert.strictEqual(pico8.ord('abc', 0), undefined);

      // A count running past the end stops there rather than padding.
      assert.deepStrictEqual(pico8.ord('ab', 1, 5), [97, 98]);
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
