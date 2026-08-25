/**
 * Contract-first unit tests for Pico-8 Lua Extensions.
 *
 * IMPORTANT:
 * These tests validate the intended API contract, not the current implementation.
 * If a function is missing or behaves like a stub, tests should fail.
 */

const assert = require('assert');
const fs = require('fs');
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

// The Lua a native helper actually registers. Reading the source file and
// pulling the template literal out of it gives back the placeholders as text
// ("unexpected symbol near '$'"), because a helper that deals in cart numbers
// converts at its own edge and the emitters that do it are chosen when the
// method is registered. So register the method for real against a Lua state
// that only records what it is asked to run. The base class does not declare a
// number representation, so this is the unscaled form - which is the one that
// has to agree with the JS implementations.
const nativeHelperSource = (...names) => {
  const RealBaseLuaExtension = require(path.resolve(__dirname, 'base-lua-extension.js'));
  const extension = new RealBaseLuaExtension();
  const chunks = [];
  extension.setLuaState({ execute: (chunk) => { chunks.push(chunk); } });
  for (const name of names) {
    extension.registerMethod(name, () => {}, 'Pico8');
  }
  assert.ok(chunks.length === names.length, `${names.join('/')} did not register as Lua-native helpers`);
  return chunks.join('\n');
};

const EXPECTED_FUNCTIONS = [
  // Graphics and rendering
  'pset', 'pget', 'color', 'fillp', 'line', 'rect', 'rectfill', 'circ', 'circfill', 'oval', 'ovalfill',
  'cls', 'pico_mode', 'pico_screen', 'spr',
  'sspr', 'map', 'tline', 'mget', 'mset',
  'sget', 'sset', 'fget', 'fset', 'pal', 'palt', 'camera', 'clip', 'print', 'cursor',
  // Math
  'sin', 'cos', 'atan2', 'sqrt', 'abs', 'sgn', 'flr', 'ceil', 'min', 'max', 'mid', 'rnd', 'srand',
  // Bitwise
  'band', 'bor', 'bxor', 'bnot', 'shl', 'shr', 'lshl', 'lshr', 'rotl', 'rotr',
  // String
  'sub', 'tostr', 'tonum', 'chr', 'ord', 'split',
  // Table
  'add', 'del', 'deli', 'count', 'all', 'foreach', 'inext', 'pack', 'unpack',
  // Coroutines (implemented in Lua; the JS stubs only satisfy the loader)
  'cocreate', 'coresume', 'costatus', 'cowrap', 'yield',
  // Memory
  'peek', 'poke', 'peek2', 'poke2', 'peek4', 'poke4', 'memcpy', 'memset', 'reload',
  // Multi-cart games
  'load',
  // Persistent storage
  'cartdata', 'dget', 'dset',
  // Audio
  'music', 'sfx',
  // Input
  'btn', 'btnp',
  // Utility
  'printh', 'stat', 'menuitem', 'flip', 'pico_flags', 'pico_fps', 'time', 't',
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
      oval() {},
      ovalfill() {},
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
    // Mirrors GameEmulator: load() queues a cart swap here for the game loop
    // to perform once the current frame is out of the way.
    pico8PendingLoad: null,
    // Mirrors GameEmulator.setUpdateRate so pico_fps can be exercised without
    // standing up the whole emulator.
    _updateIntervalMs: 0,
    setUpdateRate(hz) {
      const rate = Number(hz);
      this._updateIntervalMs = Number.isFinite(rate) && rate > 0 ? (1000 / rate) : 0;
      return this._updateIntervalMs;
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

/**
 * A cart image with specific bytes set, for the multi-cart tests.
 * @param {Record<number, number[]>} patches Address -> bytes to write there.
 */
function makeCartRom(patches) {
  const rom = new Uint8Array(0x4300);
  for (const [address, bytes] of Object.entries(patches)) {
    rom.set(bytes, Number(address));
  }
  return rom;
}

/**
 * Stand in for the carts the importer copies into the project.
 *
 * The images are handed over already parsed, so these tests exercise the cart
 * lookup and memory swap rather than the .p8 text they are stored as.
 */
function installCartFamily(pico8, carts, mainCart = '') {
  pico8._cartFamily = new Map(
    Object.entries(carts).map(([name, cart]) => [
      name,
      { text: '', rom: cart.rom, lua: cart.lua || null },
    ])
  );
  pico8._mainCartName = mainCart;
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

// The string-index behaviour is installed as Lua source, so a mock luaState
// proves nothing about it - a syntax error in an embedded Lua string stays
// invisible until a cart runs. Evaluate it in the VM the editor really uses.
// One state, built on first use, because each one costs a full luaL_openlibs.
let stringIndexEval = null;
function evalWithStringIndex(expression) {
  if (!stringIndexEval) {
    const { Lua } = require(path.resolve(__dirname, '..', 'external', 'lua-vm', 'lua.vm.js'));
    const L = new Lua.State();
    L.execute(LuaPico8Extensions.STRING_INDEX_LUA);
    stringIndexEval = (source) => {
      L.execute(`__string_index_result = tostring(${source})`);
      L.getglobal('__string_index_result');
      const value = L.raw_tostring(-1);
      L.pop(1);
      return value;
    };
  }
  return stringIndexEval(expression);
}

// The fixed-point helpers are the arithmetic PICO-8 numbers cannot get from a
// plain Lua operator, and they lean on exact int32 wrapping and on >> being
// logical. A mock cannot show either, so evaluate them in the real VM too.
let fixedPointEval = null;
function evalWithFixedPoint(expression) {
  if (!fixedPointEval) {
    const { Lua } = require(path.resolve(__dirname, '..', 'external', 'lua-vm', 'lua.vm.js'));
    const L = new Lua.State();
    L.execute(LuaPico8Extensions.FIXED_POINT_LUA);
    fixedPointEval = (source) => {
      L.execute(`__fixed_point_result = tostring(${source})`);
      L.getglobal('__fixed_point_result');
      const value = L.raw_tostring(-1);
      L.pop(1);
      return value;
    };
  }
  return fixedPointEval(expression);
}

const tests = [
  {
    name: 'Fixed point: multiply is exact across the whole 32-bit range',
    fn: () => {
      const raw = (v) => String(Math.round(v * 65536) | 0);
      const mul = (a, b) => evalWithFixedPoint(`__p8mul(${a}, ${b})`);

      assert.strictEqual(mul(raw(1), raw(1)), raw(1));
      assert.strictEqual(mul(raw(0.5), raw(2)), raw(1));
      assert.strictEqual(mul(raw(-1), raw(2)), raw(-2));
      assert.strictEqual(mul(raw(-3), raw(-4)), raw(12));
      assert.strictEqual(mul(raw(0.5), raw(0.5)), raw(0.25));
      // Anything below 1/65536 truncates away, as it does on a real PICO-8.
      assert.strictEqual(mul('1', '1'), '0');
      // The case a float32 lua_Number cannot do: a value needing all 32 bits
      // multiplied by one has to come back completely unchanged.
      assert.strictEqual(mul('2147483647', raw(1)), '2147483647');
      assert.strictEqual(mul('-2147483640', raw(1)), '-2147483640');
    },
  },
  {
    name: 'Fixed point: divide is exact and saturates instead of going infinite',
    fn: () => {
      const raw = (v) => String(Math.round(v * 65536) | 0);
      const div = (a, b) => evalWithFixedPoint(`__p8div(${a}, ${b})`);

      assert.strictEqual(div(raw(1), raw(2)), raw(0.5));
      assert.strictEqual(div(raw(3), raw(2)), raw(1.5));
      assert.strictEqual(div(raw(-3), raw(2)), raw(-1.5));
      assert.strictEqual(div(raw(12), raw(-4)), raw(-3));
      // 10/3 is not representable, so it truncates towards zero at 1/65536.
      assert.strictEqual(div(raw(10), raw(3)), String(Math.floor((10 / 3) * 65536)));
      // PICO-8 has no infinity: division by zero pins to the end of the range.
      assert.strictEqual(div(raw(1), '0'), '2147483647');
      assert.strictEqual(div(raw(-1), '0'), '-2147483648');
      // A remainder large enough to push its top bit out of the word during
      // the shift still has to produce the right quotient.
      assert.strictEqual(div('2147483647', '2147483647'), raw(1));
    },
  },
  {
    name: 'Fixed point: integer divide floors and modulo follows it',
    fn: () => {
      const raw = (v) => String(Math.round(v * 65536) | 0);

      assert.strictEqual(evalWithFixedPoint(`__p8idiv(${raw(7)}, ${raw(2)})`), raw(3));
      assert.strictEqual(evalWithFixedPoint(`__p8idiv(${raw(-7)}, ${raw(2)})`), raw(-4));
      assert.strictEqual(evalWithFixedPoint(`__p8mod(${raw(7)}, ${raw(3)})`), raw(1));
      // PICO-8's % takes the sign of the divisor, so this is 2 and not -1.
      assert.strictEqual(evalWithFixedPoint(`__p8mod(${raw(-7)}, ${raw(3)})`), raw(2));
      // Modulo by zero is 0 rather than a crash.
      assert.strictEqual(evalWithFixedPoint(`__p8mod(${raw(7)}, 0)`), '0');
    },
  },
  {
    name: 'Fixed point: shifts take a fixed point count and keep PICO-8 semantics',
    fn: () => {
      const raw = (v) => String(Math.round(v * 65536) | 0);
      const ev = evalWithFixedPoint;

      // The count is a number too, so it arrives as a fixed point word.
      assert.strictEqual(ev(`__p8shl(${raw(1)}, ${raw(2)})`), raw(4));
      assert.strictEqual(ev(`__p8shr(${raw(4)}, ${raw(2)})`), raw(1));
      // PICO-8's >> keeps the sign where Lua's own operator would not.
      assert.strictEqual(ev(`__p8shr(${raw(-4)}, ${raw(1)})`), raw(-2));
      assert.strictEqual(ev(`__p8lshr(-1, ${raw(31)})`), '1');
      // A count past the word width goes to nothing rather than wrapping.
      assert.strictEqual(ev(`__p8shl(${raw(1)}, ${raw(64)})`), '0');
      assert.strictEqual(ev(`__p8shr(${raw(-1)}, ${raw(64)})`), '-1');
      // A negative count shifts the other way.
      assert.strictEqual(ev(`__p8shl(${raw(4)}, ${raw(-2)})`), raw(1));
      // Rotating by zero has to be a no-op, not a shift of 32.
      assert.strictEqual(ev(`__p8rotl(${raw(1)}, 0)`), raw(1));
      assert.strictEqual(ev(`__p8rotr(${raw(1)}, 0)`), raw(1));
      assert.strictEqual(ev(`__p8rotl(0x40000000, ${raw(2)})`), '1');
    },
  },
  {
    name: 'Fixed point: whole exponents are exact and tostr matches PICO-8',
    fn: () => {
      const raw = (v) => String(Math.round(v * 65536) | 0);
      const ev = evalWithFixedPoint;

      assert.strictEqual(ev(`__p8pow(${raw(2)}, ${raw(10)})`), raw(1024));
      assert.strictEqual(ev(`__p8pow(${raw(3)}, ${raw(0)})`), raw(1));
      assert.strictEqual(ev(`__p8pow(${raw(2)}, ${raw(-2)})`), raw(0.25));

      assert.strictEqual(ev(`__p8tostr(${raw(3)})`), '3');
      assert.strictEqual(ev(`__p8tostr(${raw(-3)})`), '-3');
      assert.strictEqual(ev(`__p8tostr(${raw(0.5)})`), '0.5');
      // A small negative must not floor its way to the wrong whole part.
      assert.strictEqual(ev(`__p8tostr(${raw(-0.5)})`), '-0.5');
      assert.strictEqual(ev(`__p8tostr(${raw(1 / 3)})`), '0.3333');
      // The one word that cannot be negated.
      assert.strictEqual(ev(`__p8tostr(0x80000000)`), '-32768');
      assert.strictEqual(ev(`__p8cat(${raw(1)}, "up")`), '1up');
    },
  },
  {
    name: 'Fixed point: a cart can keep flags in the low bits of a number',
    fn: () => {
      const { Lua } = require(path.resolve(__dirname, '..', 'external', 'lua-vm', 'lua.vm.js'));
      const Pico8Parser = require(path.resolve(__dirname, 'pico8-parser.js'));
      const L = new Lua.State();
      L.execute(LuaPico8Extensions.FIXED_POINT_LUA);

      // POOM's potential visibility set, written the way the cart writes it:
      // one 32-bit word per 32 sectors, with 0x0.0001 as the unit bit. This is
      // the exact shape a float32 lua_Number cannot hold - once a high bit is
      // set the low ones round away, in_pvs starts answering false and
      // draw_bsp skips whole subsectors, which is the black wedge.
      const cart = `
        pvs = {}
        function setbit(id)
          local w = id \\ 32
          pvs[w] = (pvs[w] or 0) | 0x0.0001 << (id & 31)
        end
        function hasbit(id)
          local w = id \\ 32
          return pvs[w] and pvs[w] & 0x0.0001 << (id & 31) != 0
        end
        setbit(3)
        setbit(31)
        result = hasbit(3) .. "," .. hasbit(31) .. "," .. hasbit(5)
      `;

      L.execute(Pico8Parser.compile(cart, { fixedPoint: true }));
      L.getglobal('result');
      const result = L.raw_tostring(-1);
      L.pop(1);

      // Bit 3 has to survive bit 31 being set alongside it.
      assert.strictEqual(result, 'true,true,false');
    },
  },
  {
    name: 'Fixed point: the bridge scales both ways, and only for PICO-8',
    fn: () => {
      const BaseLuaExtension = require(path.resolve(__dirname, 'base-lua-extension.js'));

      const luaState = {
        execute() {}, getglobal() {}, pushnumber() {}, setglobal() {},
      };

      const makeExt = (fixedPoint) => {
        const ext = new BaseLuaExtension();
        ext.luaState = luaState;
        Object.defineProperty(ext, 'fixedPointNumbers', { value: fixedPoint });
        return ext;
      };

      // An extension that is not scaled must be left completely alone, which
      // is what keeps the Studio API working the way it always has.
      const seenPlain = [];
      makeExt(false).registerMethod('plain', (...args) => {
        seenPlain.push(...args);
        return 12.5;
      }, 'Other');
      assert.strictEqual(window.Other_plain_Impl(64, 7), 12.5);
      assert.deepStrictEqual(seenPlain, [64, 7]);

      // A scaled one is handed ordinary values, because that is what its
      // methods are written against, and its result goes back out scaled.
      const seenScaled = [];
      makeExt(true).registerMethod('scaled', (...args) => {
        seenScaled.push(...args);
        return 12.5;
      }, 'Pico8');
      assert.strictEqual(window.Pico8_scaled_Impl(64 * 65536, 32768), 12.5 * 65536);
      assert.deepStrictEqual(seenScaled, [64, 0.5]);

      // Anything that is not a number passes straight through either way.
      const seenMixed = [];
      makeExt(true).registerMethod('mixed', (...args) => {
        seenMixed.push(...args);
        return 'hi';
      }, 'Pico8');
      assert.strictEqual(window.Pico8_mixed_Impl('str', true, undefined), 'hi');
      assert.deepStrictEqual(seenMixed, ['str', true, undefined]);

      makeExt(true).registerMethod('flag', () => true, 'Pico8');
      assert.strictEqual(window.Pico8_flag_Impl(), true);
    },
  },
  {
    name: 'Fixed point: a value passing through a container is not rescaled',
    fn: () => {
      const BaseLuaExtension = require(path.resolve(__dirname, 'base-lua-extension.js'));

      const ext = new BaseLuaExtension();
      ext.luaState = { execute() {}, getglobal() {}, pushnumber() {}, setglobal() {} };
      Object.defineProperty(ext, 'fixedPointNumbers', { value: true });
      Object.defineProperty(ext, 'opaqueValueArgs', { value: { add: [1] } });
      Object.defineProperty(ext, 'opaqueValueResults', { value: ['add'] });

      const seen = [];
      ext.registerMethod('add', (...args) => { seen.push(...args); return args[1]; }, 'Pico8');

      // The table and the value pass through untouched, but a third argument
      // is an insertion index and is a quantity like any other.
      const value = 32768;
      assert.strictEqual(window.Pico8_add_Impl(null, value, 3 * 65536), value);
      assert.deepStrictEqual(seen, [null, 32768, 3]);

      // Without the declaration the same call quietly turns the value into a
      // float, which is the failure this guards against.
      const other = [];
      ext.registerMethod('plainadd', (...args) => { other.push(...args); return args[1]; }, 'Pico8');
      assert.strictEqual(window.Pico8_plainadd_Impl(null, value), 0.5 * 65536);
      assert.deepStrictEqual(other, [null, 0.5]);
    },
  },
  {
    // The bridge scales the arguments it can see. It cannot see inside a
    // table, so the numbers in one arrive in the cart's representation and
    // have to be converted where they are read. pal(tbl, 1) masks each entry
    // to a byte, and the low byte of a scaled colour is zero - which mapped
    // every colour to black and displayed a fully drawn frame as an empty one.
    name: 'Fixed point: numbers read out of a Lua table come back to ordinary ones',
    fn: () => {
      const { pico8 } = makePico8();
      assert.strictEqual(pico8.fixedPointNumbers, true, 'this test describes the representation being on');

      // A Lua table does not arrive as a JS object: lua.vm.js wraps it in a
      // proxy that is a function carrying a ref and a get accessor.
      const luaTable = (entries) => Object.assign(() => {}, {
        ref: 1,
        get: (key) => entries[key],
      });

      const word = (v) => Math.round(v * 65536) | 0;
      // POOM's title palette, in the cart's representation.
      pico8.pal(luaTable({ 1: word(140), 2: word(1), 3: word(139), 16: word(7) }), 1);

      assert.strictEqual(pico8._screenPalette[1], 140);
      assert.strictEqual(pico8._screenPalette[2], 1);
      assert.strictEqual(pico8._screenPalette[3], 139);
      // Key 16 wraps onto colour 0, which is how a 16-element array reaches it.
      assert.strictEqual(pico8._screenPalette[0], 7);

      // A JS array is not a cart table - it is what the rest of this file
      // passes - so it keeps its ordinary numbers.
      pico8.pal([9, 10], 1);
      assert.strictEqual(pico8._screenPalette[1], 9);
      assert.strictEqual(pico8._screenPalette[2], 10);
    },
  },
  {
    // A key the cart reads back has to be one it could have written. Every
    // subscript is lowered to __p8key(...), so a plain key out of pairs() gets
    // divided a second time - which is how copying a table entry by entry lost
    // every entry.
    name: 'Fixed point: a key survives the round trip through pairs and next',
    fn: () => {
      const raw = (v) => String(Math.round(v * 65536) | 0);

      // The copy idiom, written exactly as a cart writes it.
      assert.strictEqual(evalWithFixedPoint(
        `(function()
           local src = {}
           src[__p8key(${raw(1)})] = "a"
           src[__p8key(${raw(5)})] = "b"
           local dst = {}
           for k, v in pairs(src) do dst[__p8key(k)] = v end
           return __p8cat(dst[__p8key(${raw(1)})], dst[__p8key(${raw(5)})])
         end)()`), 'ab');

      // The key itself arrives as a cart number, so arithmetic on it works.
      assert.strictEqual(evalWithFixedPoint(
        `(function()
           local t = {}
           t[__p8key(${raw(3)})] = true
           for k in pairs(t) do return k end
         end)()`), raw(3));

      // ipairs walks the sequence in the same numbers.
      assert.strictEqual(evalWithFixedPoint(
        `(function()
           local t = {"x", "y"}
           local out = ""
           for i, v in ipairs(t) do out = out .. __p8tostr(i) .. v end
           return out
         end)()`), '1x2y');
    },
  },
  {
    name: 'Fixed point: table keys stay ordinary Lua keys',
    fn: () => {
      const raw = (v) => String(Math.round(v * 65536) | 0);

      // A whole number has to become an integer key, or #, add() and unpack()
      // stop seeing the table as a sequence.
      assert.strictEqual(evalWithFixedPoint(`__p8key(${raw(1)})`), '1');
      assert.strictEqual(evalWithFixedPoint(`__p8key(${raw(-3)})`), '-3');
      // A fractional one becomes the float it stands for. Truncating to an
      // integer instead would put 0.5 and 1 in the same slot.
      assert.strictEqual(evalWithFixedPoint(`__p8key(${raw(0.5)})`), '0.5');
      assert.strictEqual(evalWithFixedPoint(`__p8key(${raw(0.5)}) == __p8key(${raw(1)})`), 'false');
      // Non-numbers pass straight through, since string keys are ordinary.
      assert.strictEqual(evalWithFixedPoint(`__p8key("hp")`), 'hp');
    },
  },
  {
    name: 'Contract: expected function count is stable',
    fn: () => {
      assert.strictEqual(EXPECTED_FUNCTIONS.length, 98);
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
  {
    // api.json is what extension-loader.js actually registers with Lua, so it
    // is the real surface. This list drives the coverage gate below; if the two
    // drift, a cart-visible function can ship with no test at all.
    name: 'Contract: the expected function list matches the Pico8 category in api.json',
    fn: () => {
      const api = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'api.json'), 'utf8'));
      const category = (api.categories || []).find((c) => c.name === 'Pico8');
      assert.ok(category, 'api.json has no Pico8 category');

      const declared = (category.functions || []).map((f) => f.name).sort();
      const expected = [...EXPECTED_FUNCTIONS].sort();

      const undeclared = expected.filter((name) => !declared.includes(name));
      const untested = declared.filter((name) => !expected.includes(name));

      assert.deepStrictEqual(untested, [],
        `api.json declares PICO-8 functions with no test coverage: ${untested.join(', ')}`);
      assert.deepStrictEqual(undeclared, [],
        `Tests expect PICO-8 functions that api.json does not declare: ${undeclared.join(', ')}`);
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
    // 0xA5A5 is a checkerboard: rows 1010 / 0101 / 1010 / 0101, read from the
    // most significant bit. Clear bits take the pen colour, set bits the
    // secondary colour from the high nibble.
    name: 'fillp stipples shape fills with the two-colour pen',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.fillp(0xA5A5);
      pico8.color(0x21);
      pico8.rectfill(0, 0, 3, 3);
      assert.strictEqual(px(pico8, 0, 0), 2);
      assert.strictEqual(px(pico8, 1, 0), 1);
      assert.strictEqual(px(pico8, 0, 1), 1);
      assert.strictEqual(px(pico8, 1, 1), 2);
    },
  },
  {
    name: 'fillp is keyed on screen position, not on the shape',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.fillp(0xA5A5);
      pico8.color(0x21);
      // A shape-relative pattern would put the secondary colour at the shape's
      // own top-left corner; a screen-aligned one keeps it on even columns.
      pico8.rectfill(1, 0, 4, 3);
      assert.strictEqual(px(pico8, 1, 0), 1);
      assert.strictEqual(px(pico8, 2, 0), 2);
    },
  },
  {
    name: 'fillp fraction bit 0b0.1 makes the set bits transparent',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.cls(5);
      pico8.fillp(0xA5A5 + 0.5);
      assert.strictEqual(pico8._fillPattern, 0xA5A5);
      assert.strictEqual(pico8._fillPatternTransparent, true);
      pico8.color(0x21);
      pico8.rectfill(0, 0, 3, 3);
      assert.strictEqual(px(pico8, 0, 0), 5, 'a set bit must leave the pixel alone');
      assert.strictEqual(px(pico8, 1, 0), 1);
    },
  },
  {
    name: 'fillp with no argument returns to a solid fill',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.fillp(0xA5A5);
      pico8.fillp();
      pico8.color(0x21);
      pico8.rectfill(0, 0, 3, 3);
      // Solid means the pen colour everywhere, never the secondary nibble.
      assert.strictEqual(px(pico8, 0, 0), 1);
      assert.strictEqual(px(pico8, 1, 1), 1);
    },
  },
  {
    name: 'fillp applies to line, rect, circ, circfill and pset',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.fillp(0xA5A5);
      pico8.color(0x21);
      pico8.line(0, 0, 3, 0);
      assert.strictEqual(px(pico8, 0, 0), 2);
      assert.strictEqual(px(pico8, 1, 0), 1);
      pico8.pset(0, 4, 0x21);
      assert.strictEqual(px(pico8, 0, 4), 2);
      pico8.rect(8, 8, 12, 12);
      assert.strictEqual(px(pico8, 8, 8), 2);
      assert.strictEqual(px(pico8, 9, 8), 1);
      pico8.circfill(40, 40, 3);
      assert.strictEqual(px(pico8, 40, 40), 2);
      assert.strictEqual(px(pico8, 41, 40), 1);
      pico8.circ(80, 80, 4);
      assert.strictEqual(px(pico8, 84, 80), 2);
    },
  },
  {
    name: 'fillp leaves sprites and text alone',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.cls(0);
      // Every bit set and transparent, so anything honouring the pattern would
      // draw nothing at all.
      pico8.fillp(0xFFFF + 0.5);
      pico8.print('a', 0, 0, 7);
      assert.ok(pico8._framebuffer.includes(7), 'print must ignore the fill pattern');

      pico8.color(0x21);
      pico8.rectfill(100, 100, 103, 103);
      assert.strictEqual(px(pico8, 100, 100), 0, 'the pattern is still active');
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
  {
    name: 'circfill lines up with circ when a camera is set',
    fn: () => {
      // circ() and circfill() reached the framebuffer by different routes, and
      // the filled one subtracted the camera a second time.
      const topLeft = (pico8) => {
        for (let y = 0; y < pico8._fbHeight; y += 1) {
          for (let x = 0; x < pico8._fbWidth; x += 1) {
            if (pico8._framebuffer[(y * pico8._fbWidth) + x] !== 0) {
              return { x, y };
            }
          }
        }
        return null;
      };

      const outline = makePico8().pico8;
      outline.resetRuntimeState();
      outline.pico_mode(1);
      outline.camera(10, 20);
      outline.circ(64, 64, 5, 7);

      const filled = makePico8().pico8;
      filled.resetRuntimeState();
      filled.pico_mode(1);
      filled.camera(10, 20);
      filled.circfill(64, 64, 5, 7);

      assert.deepStrictEqual(topLeft(filled), topLeft(outline));
    },
  },
  {
    name: 'ovalfill fills its bounding box and oval outlines it',
    fn: () => {
      const extent = (pico8) => {
        let minX = Infinity; let minY = Infinity;
        let maxX = -1; let maxY = -1; let count = 0;
        for (let y = 0; y < pico8._fbHeight; y += 1) {
          for (let x = 0; x < pico8._fbWidth; x += 1) {
            if (pico8._framebuffer[(y * pico8._fbWidth) + x] !== 0) {
              count += 1;
              minX = Math.min(minX, x); maxX = Math.max(maxX, x);
              minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            }
          }
        }
        return { minX, minY, maxX, maxY, count };
      };

      const filled = makePico8().pico8;
      filled.resetRuntimeState();
      filled.ovalfill(20, 40, 60, 50, 12);
      const fill = extent(filled);

      // The ellipse touches every edge of the box it was given.
      assert.deepStrictEqual(
        { minX: fill.minX, minY: fill.minY, maxX: fill.maxX, maxY: fill.maxY },
        { minX: 20, minY: 40, maxX: 60, maxY: 50 }
      );
      assert.strictEqual(filled._framebuffer[(45 * 128) + 40], 12, 'centre is filled');

      const hollow = makePico8().pico8;
      hollow.resetRuntimeState();
      hollow.oval(20, 40, 60, 50, 12);
      const line = extent(hollow);

      assert.strictEqual(hollow._framebuffer[(45 * 128) + 40], 0, 'centre is empty');
      assert.ok(line.count < fill.count, 'outline uses fewer pixels than the fill');

      // A wide ellipse has near-flat top and bottom rows. Scanning rows alone
      // leaves those rows blank, so the outline has to scan columns as well.
      for (let y = line.minY; y <= line.maxY; y += 1) {
        let drawn = false;
        for (let x = 0; x < 128; x += 1) {
          if (hollow._framebuffer[(y * 128) + x] !== 0) { drawn = true; break; }
        }
        assert.ok(drawn, `outline row ${y} should not be empty`);
      }
    },
  },
  {
    name: 'poking the screen mode register picks the stretch divisors',
    fn: () => {
      // LOWREZ carts poke mode 3 and then draw to a 64x64 area, trusting the
      // hardware to double it up to the full screen.
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      assert.deepStrictEqual(pico8._screenModeDivisors(), [1, 1]);
      pico8.poke(0x5f2c, 3);
      assert.deepStrictEqual(pico8._screenModeDivisors(), [2, 2]);
      pico8.poke(0x5f2c, 1);
      assert.deepStrictEqual(pico8._screenModeDivisors(), [2, 1]);
      pico8.poke(0x5f2c, 2);
      assert.deepStrictEqual(pico8._screenModeDivisors(), [1, 2]);
      pico8.poke(0x5f2c, 0);
      assert.deepStrictEqual(pico8._screenModeDivisors(), [1, 1]);
    },
  },
  {
    name: 'poke writes a long run of values, as font uploads do',
    fn: () => {
      // ascent.p8 loads its custom font with a single poke of 1232 values
      // unpacked from a string.
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      const values = Array.from({ length: 1232 }, (_, i) => i % 256);
      pico8.poke(0x5600, ...values);

      assert.strictEqual(pico8.peek(0x5600), values[0]);
      assert.strictEqual(pico8.peek(0x5600 + 617), values[617]);
      assert.strictEqual(pico8.peek(0x5600 + 1231), values[1231]);
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
    name: 'pico_screen centres a reduced screen and clamps to the display',
    fn: () => {
      const makeFakeGpu = () => ({
        canvas: { width: 448, height: 368 },
        createTextureRaw() { return { id: 'fbtex' }; },
        deleteTexture() {},
        setPalette() {},
        setPaletteOffset() {},
        blit(tex, opts) {
          this.blitCall = { tex, opts };
        },
      });

      // Default: no call means fill the display, exactly as before.
      const filled = makePico8().pico8;
      const filledGpu = makeFakeGpu();
      filled.initGpu(filledGpu);
      filled.cls(0);
      filled.renderFrame(filledGpu, 16);
      assert.strictEqual(filledGpu.blitCall.opts.x, 0);
      assert.strictEqual(filledGpu.blitCall.opts.y, 0);
      assert.strictEqual(filledGpu.blitCall.opts.srcW, 448);
      assert.strictEqual(filledGpu.blitCall.opts.srcH, 368);

      // Square output: centred, and inset far enough to clear the corners.
      const square = makePico8().pico8;
      const squareGpu = makeFakeGpu();
      square.initGpu(squareGpu);
      square.pico_screen(366, 366);
      square.cls(0);
      square.renderFrame(squareGpu, 16);
      assert.strictEqual(squareGpu.blitCall.opts.srcW, 366);
      assert.strictEqual(squareGpu.blitCall.opts.srcH, 366);
      assert.strictEqual(squareGpu.blitCall.opts.x, 41);
      assert.strictEqual(squareGpu.blitCall.opts.y, 1);
      // Stretched to fit means the framebuffer is the output rectangle, so the
      // blit never magnifies.
      assert.strictEqual(squareGpu.blitCall.opts.scaleX, 1);
      assert.strictEqual(squareGpu.blitCall.opts.scaleY, 1);

      // Asking for more than the display gets the display.
      const huge = makePico8().pico8;
      const hugeGpu = makeFakeGpu();
      huge.initGpu(hugeGpu);
      huge.pico_screen(4000, 4000);
      huge.cls(0);
      huge.renderFrame(hugeGpu, 16);
      assert.strictEqual(hugeGpu.blitCall.opts.srcW, 448);
      assert.strictEqual(hugeGpu.blitCall.opts.srcH, 368);
      assert.strictEqual(hugeGpu.blitCall.opts.x, 0);
      assert.strictEqual(hugeGpu.blitCall.opts.y, 0);

      // 0 restores filling the display.
      square.pico_screen(0, 0);
      square.renderFrame(squareGpu, 16);
      assert.strictEqual(squareGpu.blitCall.opts.srcW, 448);
      assert.strictEqual(squareGpu.blitCall.opts.srcH, 368);
    },
  },
  {
    name: 'pico_fps paces the cart without touching the display rate',
    fn: () => {
      const { pico8, emulator } = makePico8();

      assert.strictEqual(pico8.pico_fps(), 0, 'Studio default is one update per display frame');

      // A cart with only _update() is a 30fps cart. Anything else runs it twice
      // as fast as the author intended.
      pico8.pico_fps(30);
      assert.ok(
        Math.abs(emulator._updateIntervalMs - (1000 / 30)) < 1e-9,
        `30fps should ask the emulator for a 33.33ms step, got ${emulator._updateIntervalMs}`
      );
      assert.strictEqual(Math.round(pico8.pico_fps()), 30, 'the rate reads back');

      pico8.pico_fps(60);
      assert.ok(
        Math.abs(emulator._updateIntervalMs - (1000 / 60)) < 1e-9,
        'a _update60 cart steps every display frame worth of time'
      );

      pico8.pico_fps(0);
      assert.strictEqual(emulator._updateIntervalMs, 0, 'zero restores per-frame updates');
      assert.strictEqual(pico8.pico_fps(), 0);
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
    name: 'the map layer mask selects tiles carrying any of its flags, not all of them',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      const sheet = new Uint8Array(128 * 128);
      sheet[(0 * 128) + 8] = 4; // sprite 1 top-left
      sheet[(0 * 128) + 16] = 5; // sprite 2 top-left
      sheet[(0 * 128) + 24] = 6; // sprite 3 top-left
      pico8.setSpriteSheet(sheet, 128, 128);
      pico8.setMapData(new Uint8Array([0, 1, 2, 3]), 4, 1);

      pico8.fset(1, 0b00010); // flag 1 only
      pico8.fset(2, 0b00100); // flag 2 only
      pico8.fset(3, 0b100000); // outside the mask

      // A cart asking for several gameplay layers at once, e.g.
      // map(0, 0, 0, 0, 128, 64, 30), expects every tile flagged with any one
      // of them. Demanding all of them drew nothing at all.
      pico8.map(0, 0, 0, 0, 4, 1, 0b11110);
      assert.strictEqual(pico8._framebuffer[8], 4, 'flag 1 is in the mask');
      assert.strictEqual(pico8._framebuffer[16], 5, 'flag 2 is in the mask');
      assert.strictEqual(pico8._framebuffer[24], 0, 'flag 5 is not in the mask');
    },
  },
  {
    name: 'tline samples the map along a line, one map pixel per screen pixel',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      // Sprite 1 is a horizontal ramp: pixel column i holds colour i + 1.
      const sheet = new Uint8Array(128 * 128);
      for (let i = 0; i < 8; i += 1) sheet[(0 * 128) + 8 + i] = i + 1;
      pico8.setSpriteSheet(sheet, 128, 128);
      pico8.setMapData(new Uint8Array([1, 0, 0, 0]), 4, 1);

      // Start at cell 0, pixel 0, and walk one map pixel per screen pixel.
      pico8.tline(0, 0, 7, 0, 0, 0, 1 / 8, 0);
      for (let i = 0; i < 8; i += 1) {
        assert.strictEqual(pico8._framebuffer[i], i + 1, `screen x ${i}`);
      }
      // Cell 1 is sprite 0, which is empty, so the line stops leaving pixels.
      pico8.tline(20, 1, 27, 1, 1, 0, 1 / 8, 0);
      assert.strictEqual(pico8._framebuffer[128 + 20], 0);
    },
  },
  {
    name: 'tline honours the layer mask and the map coordinate fraction',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      const sheet = new Uint8Array(128 * 128);
      sheet[(0 * 128) + 8 + 4] = 9; // sprite 1, pixel (4, 0)
      sheet[(0 * 128) + 16] = 11; // sprite 2, pixel (0, 0)
      pico8.setSpriteSheet(sheet, 128, 128);
      pico8.setMapData(new Uint8Array([1, 2, 0, 0]), 4, 1);
      pico8.fset(1, 0b100);
      pico8.fset(2, 0b1000);

      // mx = 0.5 is halfway across cell 0, i.e. sprite pixel column 4.
      pico8.tline(0, 0, 0, 0, 0.5, 0, 0, 0);
      assert.strictEqual(pico8._framebuffer[0], 9);

      // Cell 1 carries flag 3, which is outside this mask, so nothing lands.
      pico8.tline(5, 0, 5, 0, 1, 0, 0, 0, 0b100);
      assert.strictEqual(pico8._framebuffer[5], 0);
      // With its own flag in the mask it draws.
      pico8.tline(6, 0, 6, 0, 1, 0, 0, 0, 0b1000);
      assert.strictEqual(pico8._framebuffer[6], 11);
    },
  },
  {
    name: 'tline with a single argument sets the precision instead of drawing',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      // Sprite 1 is a horizontal ramp: pixel column i holds colour i + 1.
      const sheet = new Uint8Array(128 * 128);
      for (let i = 0; i < 8; i += 1) sheet[(0 * 128) + 8 + i] = i + 1;
      pico8.setSpriteSheet(sheet, 128, 128);
      pico8.setMapData(new Uint8Array([1, 0, 0, 0]), 4, 1);

      assert.strictEqual(pico8._tlineBits, 13, 'one unit is a cell by default');
      pico8.tline(16);
      assert.strictEqual(pico8._tlineBits, 16);
      assert.ok(pico8._framebuffer.every((c) => c === 0), 'setting precision draws nothing');

      // At 16 bits one unit is a map pixel rather than a cell, so a step of 1
      // now walks the sprite a pixel at a time.
      pico8.tline(0, 0, 7, 0, 0, 0, 1, 0);
      for (let i = 0; i < 8; i += 1) {
        assert.strictEqual(pico8._framebuffer[i], i + 1, `screen x ${i}`);
      }

      // POOM raises the precision for its wall spans and puts it back after,
      // so the reset has to restore the default rather than keep the last set.
      pico8.tline(13);
      assert.strictEqual(pico8._tlineBits, 13);
      pico8.resetRuntimeState();
      assert.strictEqual(pico8._tlineBits, 13);
    },
  },
  {
    name: 'tline repeats and offsets the sampled cells through 0x5f38-0x5f3b',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      // Sprites 1 and 2 are solid colours, so which cell was sampled is
      // readable straight off the framebuffer.
      const sheet = new Uint8Array(128 * 128);
      for (let i = 0; i < 8; i += 1) {
        sheet[(0 * 128) + 8 + i] = 3;
        sheet[(0 * 128) + 16 + i] = 12;
      }
      pico8.setSpriteSheet(sheet, 128, 128);
      // Cells 0-1 are empty; the texture is the two cells at x = 2.
      pico8.setMapData(new Uint8Array([0, 0, 1, 2]), 4, 1);

      // Repeat every 2 cells, starting at cell 2. Walking four cells then
      // covers the two texture cells twice.
      pico8.poke(0x5f38, 2);
      pico8.poke(0x5f39, 1);
      pico8.poke(0x5f3a, 2);
      pico8.poke(0x5f3b, 0);
      pico8.tline(0, 0, 3, 0, 0, 0, 1, 0);
      assert.deepStrictEqual(
        Array.from(pico8._framebuffer.slice(0, 4)),
        [3, 12, 3, 12],
        'the two texture cells repeat'
      );

      // Cleared registers mean the region is the whole map and starts at its
      // origin, which is the plain behaviour every single-texture cart relies
      // on.
      pico8.poke(0x5f38, 0);
      pico8.poke(0x5f39, 0);
      pico8.poke(0x5f3a, 0);
      pico8.poke(0x5f3b, 0);
      pico8.tline(0, 1, 3, 1, 0, 0, 1, 0);
      assert.deepStrictEqual(
        Array.from(pico8._framebuffer.slice(128, 132)),
        [0, 0, 3, 12],
        'cells 0 and 1 are empty again'
      );

      // A texture mapper's map coordinate goes negative all the time, and the
      // repeat has to bring it back inside the region. Masking the cell index
      // instead of wrapping it sent POOM off the end of the map, where there
      // is nothing to sample, and its walls came out black.
      pico8.poke(0x5f38, 2);
      pico8.poke(0x5f39, 1);
      pico8.poke(0x5f3a, 2);
      pico8.tline(0, 2, 3, 2, -4, 0, 1, 0);
      assert.deepStrictEqual(
        Array.from(pico8._framebuffer.slice(256, 260)),
        [3, 12, 3, 12],
        'a negative map coordinate wraps into the region'
      );
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

  // -------------------------------------------------------------------------
  // Music and SFX memory
  //
  // Nothing plays from these bytes - the importer turns those sections into
  // audio resources - but carts read and write them anyway. Some retune a sound
  // effect by poking its speed byte; a multi-cart game uses the whole region as
  // storage for level data and never makes a sound with it at all.
  // -------------------------------------------------------------------------
  {
    name: 'peek/poke round-trip through the music and SFX region',
    fn: () => {
      const { pico8 } = makePico8();
      assert.strictEqual(pico8.peek(0x3100), 0, 'music memory starts empty');

      pico8.poke(0x3100, 0x41);
      pico8.poke(0x3200, 0x42);
      // 0x3200 + 68*1 + 65 is sfx slot 1's note duration, which is the byte
      // carts poke to change a sound effect's speed.
      pico8.poke(0x3200 + 68 + 65, 0x0c);
      pico8.poke(0x42ff, 0x43);

      assert.strictEqual(pico8.peek(0x3100), 0x41);
      assert.strictEqual(pico8.peek(0x3200), 0x42);
      assert.strictEqual(pico8.peek(0x3200 + 68 + 65), 0x0c);
      assert.strictEqual(pico8.peek(0x42ff), 0x43, 'the region runs up to general purpose RAM');
    },
  },
  {
    name: 'the music and SFX region is distinct from the sprite flags and user RAM either side of it',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.poke(0x30ff, 0x11);
      pico8.poke(0x3100, 0x22);
      pico8.poke(0x42ff, 0x33);
      pico8.poke(0x4300, 0x44);

      assert.strictEqual(pico8.peek(0x30ff), 0x11);
      assert.strictEqual(pico8.peek(0x3100), 0x22);
      assert.strictEqual(pico8.peek(0x42ff), 0x33);
      assert.strictEqual(pico8.peek(0x4300), 0x44);
    },
  },

  // -------------------------------------------------------------------------
  // Multi-cart games
  //
  // A PICO-8 game too big for one cart ships as a folder of them and reads the
  // rest of itself at run time. reload() with a filename pulls data across
  // without disturbing the running cart; load() hands over to another cart
  // entirely, passing it a string that only stat(6) can retrieve.
  // -------------------------------------------------------------------------
  {
    name: 'reload copies from a named sibling cart',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.setSpriteSheet(new Uint8Array(128 * 128), 128, 128);
      installCartFamily(pico8, {
        'main.p8': { rom: makeCartRom({ 0x2000: [1, 2, 3, 4] }) },
        'data_1.p8': { rom: makeCartRom({ 0x2000: [9, 8, 7, 6] }) },
      });

      pico8.reload(0x4300, 0x2000, 4, 'data_1.p8');
      assert.deepStrictEqual(pico8.peek(0x4300, 4), [9, 8, 7, 6]);
    },
  },
  {
    name: 'reload accepts a cart named without its extension',
    fn: () => {
      const { pico8 } = makePico8();
      installCartFamily(pico8, { 'data_1.p8': { rom: makeCartRom({ 0x2000: [5] }) } });

      pico8.reload(0x4300, 0x2000, 1, 'data_1');
      assert.strictEqual(pico8.peek(0x4300), 5);
    },
  },
  {
    name: 'reload from a cart that was never imported writes zeroes rather than leaving stale bytes',
    fn: () => {
      const { pico8 } = makePico8();
      installCartFamily(pico8, {});
      pico8.poke(0x4300, 1, 2, 3);

      // PICO-8 would read a missing cart as zeroes rather than fail, and a game
      // streaming its levels would otherwise die partway through one.
      pico8.reload(0x4300, 0x2000, 3, 'absent.p8');
      assert.deepStrictEqual(pico8.peek(0x4300, 3), [0, 0, 0]);
    },
  },
  {
    name: 'reload without a filename still reads the running cart, not a sibling',
    fn: () => {
      const { pico8 } = makePico8();
      installCartFamily(pico8, { 'data_1.p8': { rom: makeCartRom({ 0x3100: [9] }) } });
      pico8.poke(0x3100, 4);

      pico8.reload(0x4300, 0x3100, 1);
      assert.strictEqual(pico8.peek(0x4300), 0, 'the running cart has no audio ROM behind it here');
    },
  },
  {
    name: 'reload from a sibling cart reads past the sprite sheet into its sound data',
    fn: () => {
      const { pico8 } = makePico8();
      // The whole point of the extra carts: the level data runs off the end of
      // one section and straight into the next.
      installCartFamily(pico8, {
        'data_1.p8': { rom: makeCartRom({ 0x30fe: [1, 2, 3, 4] }) },
      });

      pico8.reload(0x4300, 0x30fe, 4, 'data_1.p8');
      assert.deepStrictEqual(pico8.peek(0x4300, 4), [1, 2, 3, 4]);
    },
  },
  {
    name: 'applyCartImage swaps in a sibling cart and re-bases what reload() restores',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.setSpriteSheet(new Uint8Array(128 * 128), 128, 128);
      pico8.setMapData(new Uint8Array(128 * 64), 128, 64);
      installCartFamily(pico8, {
        'level2.p8': {
          rom: makeCartRom({ 0x0000: [0x21], 0x2000: [7], 0x3000: [0x88], 0x3200: [0x5a] }),
        },
      });

      assert.strictEqual(pico8.applyCartImage('level2.p8'), true);
      assert.strictEqual(pico8.sget(0, 0), 1, 'the new cart brings its own sprites');
      assert.strictEqual(pico8.sget(1, 0), 2);
      assert.strictEqual(pico8.mget(0, 0), 7, 'and its own map');
      assert.strictEqual(pico8.fget(0), 0x88, 'and its own sprite flags');
      assert.strictEqual(pico8.peek(0x3200), 0x5a, 'and its own sound data');

      // A reload() now has to restore the cart that is running, not the one it
      // replaced.
      pico8.sset(0, 0, 5);
      pico8.reload();
      assert.strictEqual(pico8.sget(0, 0), 1);
    },
  },
  {
    name: 'applyCartImage reports a cart it does not have rather than half-applying one',
    fn: () => {
      const { pico8 } = makePico8();
      installCartFamily(pico8, {});
      assert.strictEqual(pico8.applyCartImage('nope.p8'), false);
    },
  },
  {
    name: 'load queues a cart swap for the emulator to perform between frames',
    fn: () => {
      const { pico8, emulator } = makePico8();
      installCartFamily(pico8, {
        'main.p8': { rom: makeCartRom({}) },
        'level2.p8': { rom: makeCartRom({}), lua: 'function Setup() end' },
      }, 'main.p8');

      pico8.load('level2.p8', 'back to menu', 'skill=3,map=1');

      assert.deepStrictEqual(emulator.pico8PendingLoad, {
        cart: 'level2.p8',
        param: 'skill=3,map=1',
        lua: 'function Setup() end',
      });
    },
  },
  {
    name: 'load of the main cart restarts the project script rather than a stale copy',
    fn: () => {
      const { pico8, emulator } = makePico8();
      installCartFamily(pico8, {
        'main.p8': { rom: makeCartRom({}) },
        'level2.p8': { rom: makeCartRom({}), lua: 'function Setup() end' },
      }, 'main.p8');

      pico8.load('main.p8');

      // null means "the project's own main.lua", which is the only copy that
      // reflects edits made in the Studio since the cart was imported.
      assert.strictEqual(emulator.pico8PendingLoad.lua, null);
      assert.strictEqual(emulator.pico8PendingLoad.param, '');
    },
  },
  {
    name: 'load ignores a cart that was never imported or carries no code',
    fn: () => {
      const { pico8, emulator } = makePico8();
      installCartFamily(pico8, {
        'main.p8': { rom: makeCartRom({}) },
        'data_1.p8': { rom: makeCartRom({}) },
      }, 'main.p8');

      pico8.load('absent.p8');
      assert.strictEqual(emulator.pico8PendingLoad, null, 'a cart that is not there is not loadable');

      // data_1.p8 exists but is pure storage. Swapping to it would leave the
      // game with no code at all.
      pico8.load('data_1.p8');
      assert.strictEqual(emulator.pico8PendingLoad, null);
    },
  },
  {
    name: 'stat(6) returns the string the previous cart passed to load',
    fn: () => {
      const { pico8 } = makePico8();
      assert.strictEqual(pico8.stat(6), '', 'a cart started from Play was given nothing');

      pico8._loadParam = '2,1';
      assert.strictEqual(pico8.stat(6), '2,1');
    },
  },
  {
    name: 'memcpy into 0x1800 updates map rows 48-63, as bank-switching carts expect',    fn: () => {
      const { pico8 } = makePico8();
      pico8.setSpriteSheet(new Uint8Array(128 * 128), 128, 128);
      pico8.setMapData(new Uint8Array(128 * 64), 128, 64);

      // Stage two tile indices in general-purpose RAM, then bank them into the
      // shared gfx/map window the way "UFO Swamp Odyssey" swaps its parallax
      // backdrops with memcpy(0x1800, 0x4e00, 2048).
      pico8.poke(0x4e00, 0x2a, 0x3b);
      pico8.memcpy(0x1800, 0x4e00, 2);

      assert.strictEqual(pico8.mget(0, 48), 0x2a);
      assert.strictEqual(pico8.mget(1, 48), 0x3b);
      // The same bytes are the bottom of the sprite sheet: low nibble first.
      assert.strictEqual(pico8.sget(0, 96), 0xa);
      assert.strictEqual(pico8.sget(1, 96), 0x2);
    },
  },
  {
    name: 'memcpy out of 0x1800 reads the current map rows 48-63',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.setSpriteSheet(new Uint8Array(128 * 128), 128, 128);
      pico8.setMapData(new Uint8Array(128 * 64), 128, 64);

      pico8.mset(0, 48, 0xc4);
      pico8.memcpy(0x5600, 0x1800, 1);
      assert.strictEqual(pico8.peek(0x5600), 0xc4);
    },
  },
  {
    name: 'writes below 0x1000 leave the map alone',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.setSpriteSheet(new Uint8Array(128 * 128), 128, 128);
      pico8.setMapData(new Uint8Array(128 * 64), 128, 64);

      pico8.poke(0x0fff, 0x77);
      assert.strictEqual(pico8.mget(0, 32), 0);
      assert.strictEqual(pico8.mget(127, 31), 0);
    },
  },
  {
    name: 'sset in the shared region rewrites only its own nibble of the map byte',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.setSpriteSheet(new Uint8Array(128 * 128), 128, 128);
      pico8.setMapData(new Uint8Array(128 * 64), 128, 64);

      pico8.mset(0, 48, 0x2a);
      pico8.sset(1, 96, 0x5); // high nibble
      assert.strictEqual(pico8.mget(0, 48), 0x5a);
      pico8.sset(0, 96, 0x1); // low nibble
      assert.strictEqual(pico8.mget(0, 48), 0x51);
    },
  },
  {
    name: 'tonum parses 0x and 0b literals, as carts packing data into strings expect',
    fn: () => {
      const { pico8 } = makePico8();
      assert.strictEqual(pico8.tonum('0xa'), 10);
      assert.strictEqual(pico8.tonum('0XFF'), 255);
      assert.strictEqual(pico8.tonum('0b1010'), 10);
      assert.strictEqual(pico8.tonum('0x1.8'), 1.5);
      assert.strictEqual(pico8.tonum('-0x10'), -16);
      // Still decimal by default, and still 0 for anything unparseable.
      assert.strictEqual(pico8.tonum('42'), 42);
      assert.strictEqual(pico8.tonum('0x'), 0);
      assert.strictEqual(pico8.tonum('0xzz'), 0);
      assert.strictEqual(pico8.tonum('nope'), 0);
    },
  },
  {
    name: 'the screen is readable and writable at 0x6000, as carts that memcpy it expect',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      // Low nibble is the left pixel of the pair, as in the sprite sheet.
      pico8.poke(0x6000, 0x9c);
      assert.strictEqual(pico8._framebuffer[0], 0x0c);
      assert.strictEqual(pico8._framebuffer[1], 0x09);
      assert.strictEqual(pico8.peek(0x6000), 0x9c);

      // Row 1 starts 64 bytes in: 128 pixels at two per byte.
      pico8.poke(0x6000 + 64, 0x21);
      assert.strictEqual(pico8._framebuffer[128], 0x01);
      assert.strictEqual(pico8._framebuffer[129], 0x02);

      // Drawing is visible through the same window, which is how a cart
      // stashes and restores a rendered screen with memcpy.
      pico8.rectfill(0, 2, 1, 2, 7);
      assert.strictEqual(pico8.peek(0x6000 + 128), 0x77);
      pico8.memcpy(0x4300, 0x6000 + 128, 1);
      pico8.cls();
      assert.strictEqual(pico8.peek(0x6000 + 128), 0);
      pico8.memcpy(0x6000 + 128, 0x4300, 1);
      assert.strictEqual(pico8._framebuffer[(2 * 128) + 0], 7);
      assert.strictEqual(pico8._framebuffer[(2 * 128) + 1], 7);
    },
  },
  {
    name: 'poking the screen ignores clip, camera and the draw palette',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      // A raw store to screen memory is not a draw call on hardware.
      pico8.clip(64, 64, 8, 8);
      pico8.camera(50, 50);
      pico8.pal(3, 11);
      pico8.poke(0x6000, 0x33);
      pico8.clip();
      pico8.camera();
      assert.strictEqual(pico8._framebuffer[0], 3);
      assert.strictEqual(pico8._framebuffer[1], 3);
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
    name: 'pal with p=1 sets the screen palette without touching the draw palette',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.pal(14, 3, 1);
      assert.strictEqual(pico8.currentPalette.size, 0, 'screen palette must not leak into the draw palette');
      assert.strictEqual(pico8._screenPalette[14], 3);

      const rgba = pico8._buildPicoPaletteRGBA();
      assert.deepStrictEqual(
        [rgba[14 * 4], rgba[14 * 4 + 1], rgba[14 * 4 + 2]],
        [0, 135, 81],
        'colour 14 should now display as colour 3',
      );
    },
  },
  {
    name: 'the screen palette reaches the extended 128-143 colours',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.pal(14, 131, 1);
      const rgba = pico8._buildPicoPaletteRGBA();
      assert.deepStrictEqual(
        [rgba[14 * 4], rgba[14 * 4 + 1], rgba[14 * 4 + 2]],
        [18, 83, 89],
        'colour 131 is the extended dark teal',
      );
    },
  },
  {
    name: 'poking 0x5f10 sets the screen palette, as memcpy-driven carts do',
    fn: () => {
      const { pico8 } = makePico8();
      // "UFO Swamp Odyssey" installs its palettes with memcpy(0x5f10, ...)
      // rather than calling pal(), so the registers have to be live state.
      pico8.poke(0x4300, 131, 12);
      pico8.memcpy(0x5f10, 0x4300, 2);
      assert.strictEqual(pico8._screenPalette[0], 131);
      assert.strictEqual(pico8._screenPalette[1], 12);
      assert.deepStrictEqual(pico8.peek(0x5f10, 2), [131, 12]);
    },
  },
  {
    name: 'the draw palette registers at 0x5f00 read back what pal and palt set',
    fn: () => {
      const { pico8 } = makePico8();
      assert.strictEqual(pico8.peek(0x5f00), 0x10, 'colour 0 starts transparent');
      assert.strictEqual(pico8.peek(0x5f07), 7, 'unmapped colours read as themselves');

      pico8.pal(7, 2);
      assert.strictEqual(pico8.peek(0x5f07), 2);

      pico8.poke(0x5f03, 9);
      assert.strictEqual(pico8.currentPalette.get(3), 9);

      pico8.poke(0x5f05, 0x15);
      assert.ok(pico8._isTransparentColor(5), 'bit 0x10 marks the colour transparent');
      assert.strictEqual(pico8.peek(0x5f05), 0x15, 'colour 5 still draws as itself');
    },
  },
  {
    name: 'pal() with no arguments resets the screen palette too',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.pal(14, 131, 1);
      pico8.pal(1, 2);
      pico8.pal();
      assert.strictEqual(pico8.currentPalette.size, 0);
      assert.strictEqual(pico8._screenPalette[14], 14);
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
    name: 'pal returns the mapping it replaced, so a cart can put it back',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      // An untouched entry maps to itself.
      assert.strictEqual(pico8.pal(3, 9), 3);
      assert.strictEqual(pico8.pal(3, 11), 9);
      assert.strictEqual(pico8.pal(14, 131, 1), 14);
      assert.strictEqual(pico8.pal(14, 2, 1), 131);
    },
  },
  {
    name: 'pal with a table assigns an entry per key, wrapping key 16 to colour 0',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      // A plain array is keyed 1..16, so colour 0 is given last.
      pico8.pal([1, 1, 5, 5, 5, 6, 7, 13, 6, 7, 7, 6, 13, 6, 7, 2], 1);
      assert.strictEqual(pico8._screenPalette[1], 1);
      assert.strictEqual(pico8._screenPalette[3], 5);
      assert.strictEqual(pico8._screenPalette[15], 7);
      assert.strictEqual(pico8._screenPalette[0], 2, 'key 16 wraps to colour 0');

      // A sparse table touches only the keys it carries.
      pico8.pal({ 12: 9, 14: 8 });
      assert.strictEqual(pico8.currentPalette.get(12), 9);
      assert.strictEqual(pico8.currentPalette.get(14), 8);
      assert.strictEqual(pico8.currentPalette.get(13), undefined);
    },
  },
  {
    name: 'pal reads a Lua table proxy, which arrives as a function not an object',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      // lua.vm.js hands a Lua table to a bridged builtin as a Lua.Proxy: a
      // callable carrying a registry ref and a get() accessor. typeof is
      // 'function' and indexing it directly returns undefined, so pal has to
      // recognise the proxy and read entries through get().
      //
      // A proxy is a cart's own table, so its numbers are in the cart's
      // representation - the bridge scales arguments, not the contents of a
      // table it never looks inside.
      const word = (v) => (pico8.fixedPointNumbers === true ? Math.round(v * 65536) | 0 : v);
      const entries = { 0: word(7), 1: word(13), 2: word(1), 3: word(0), 4: word(14) };
      const proxy = function () {};
      proxy.ref = 42;
      proxy.get = (key) => entries[key];

      pico8.pal(proxy);
      assert.strictEqual(pico8.currentPalette.get(0), 7);
      assert.strictEqual(pico8.currentPalette.get(1), 13);
      assert.strictEqual(pico8.currentPalette.get(4), 14);
      assert.strictEqual(pico8.currentPalette.get(5), undefined);
    },
  },
  {
    name: 'camera returns the position it replaced, so a cart can put it back',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      // The bridge expands an array return into Lua multiple returns, which is
      // how `local camx, camy = camera()` gets both halves.
      assert.deepStrictEqual(pico8.camera(11, 22), [0, 0]);
      assert.deepStrictEqual(pico8.camera(3, 4), [11, 22]);
      assert.deepStrictEqual(pico8.camera(), [3, 4]);
      assert.strictEqual(pico8._cameraX, 0);
      assert.strictEqual(pico8._cameraY, 0);
    },
  },
  {
    name: 'pal(p) resets one palette, and pal() also restores transparency',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      pico8.pal(3, 9);
      pico8.pal(14, 131, 1);
      pico8.pal(1);
      assert.strictEqual(pico8._screenPalette[14], 14, 'screen palette reset');
      assert.strictEqual(pico8.currentPalette.get(3), 9, 'draw palette untouched');

      pico8.pal(0);
      assert.strictEqual(pico8.currentPalette.size, 0);

      // pal() with no arguments takes palt() back to its default too.
      pico8.palt(0, false);
      pico8.palt(7, true);
      pico8.pal();
      assert.ok(pico8._isTransparentColor(0));
      assert.ok(!pico8._isTransparentColor(7));
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
  {
    name: 'map floors negative fractional screen offsets so tiles align with spr',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.resetRuntimeState();

      const sheet = new Uint8Array(128 * 128);
      sheet[(0 * 128) + 8] = 7; // sprite 1 top-left pixel
      pico8.setSpriteSheet(sheet, 128, 128);
      pico8.setMapData(new Uint8Array([1]), 1, 1);

      // Scrolling levels pass a negative fractional offset. parseInt truncated
      // toward zero (-0.014 -> 0) while spr floors (-0.014 -> -1), so map tiles
      // sat a pixel right of anything drawn over them - a seam down the middle
      // of scenery like Mario's pipes.
      const blits = [];
      const origBlit = pico8._blitSheet.bind(pico8);
      pico8._blitSheet = (sheetX, sheetY, w, h, dx, dy) => {
        blits.push({ dx, dy });
        return origBlit(sheetX, sheetY, w, h, dx, dy);
      };
      pico8.map(0, 0, -0.014, -0.014, 1, 1);
      pico8._blitSheet = origBlit;

      assert.deepStrictEqual(
        blits[0],
        { dx: -1, dy: -1 },
        'map must floor negative fractional screen offsets like PICO-8 flr()',
      );

      // spr must agree, or the two drift apart by a pixel.
      pico8.cls(0);
      pico8.spr(1, 48 - 0.014, 0);
      assert.strictEqual(
        pico8._framebuffer[47],
        7,
        'spr should floor 47.986 to 47, matching map',
      );
    },
  },
  {
    name: 'initGpu does not wipe transparency the cart chose in _init',
    fn: () => {
      const { pico8 } = makePico8();

      // A cart's _init typically runs before the renderer hands over its GPU.
      pico8.palt(0, false);
      pico8.palt(3, true);

      pico8.initGpu({});

      // initGpu used to call resetRuntimeState(), which landed after _init and
      // put transparency back to the default {0}. Carts then drew an opaque
      // background colour behind every sprite.
      assert.ok(
        pico8._isTransparentColor(3),
        'initGpu cleared the transparency the cart set in _init',
      );
      assert.ok(
        !pico8._isTransparentColor(0),
        'initGpu restored colour 0 transparency that the cart turned off',
      );
    },
  },

  // Math
  {
    // The manual documents SIN(0.25) as -1: PICO-8's sine is inverted so that a
    // positive angle turns anticlockwise on a screen whose y runs down. COS is
    // not inverted. Asserting +1 here is what let galaxis.p8 fire backwards.
    name: 'sin/cos use the pico8 domain of 0..1, and sin is inverted',
    fn: () => {
      const { pico8 } = makePico8();
      assert.ok(Math.abs(pico8.sin(0.25) - -1.0) < 0.001, 'sin(0.25) should be -1');
      assert.ok(Math.abs(pico8.sin(0.75) - 1.0) < 0.001, 'sin(0.75) should be 1');
      assert.ok(Math.abs(pico8.sin(0)) < 0.001);
      assert.ok(Math.abs(pico8.cos(0.0) - 1.0) < 0.001);
      assert.ok(Math.abs(pico8.cos(0.5) - -1.0) < 0.001);

      // Negating turns 0 into -0, which the console has no way to represent.
      assert.ok(Object.is(pico8.sin(0), 0), 'sin(0) should be +0, not -0');
      assert.ok(Object.is(pico8.atan2(1, 0), 0), 'atan2(1,0) should be +0, not -0');

      // sin/cos have to agree with each other, or anything that builds a
      // rotation matrix shears instead of rotating.
      for (const turn of [0, 0.1, 0.25, 0.5, 0.7, 0.99]) {
        const magnitude = pico8.sin(turn) ** 2 + pico8.cos(turn) ** 2;
        assert.ok(Math.abs(magnitude - 1) < 0.001, `unit circle at ${turn}`);
      }
    },
  },
  {
    // atan2 takes (dx, dy), returns 0..1, and has to round-trip through cos/sin.
    // The manual's worked example is ATAN(0,-1) -> 0.25, i.e. straight up.
    name: 'atan2 returns a 0..1 turn that round-trips through cos/sin',
    fn: () => {
      const { pico8 } = makePico8();
      assert.ok(Math.abs(pico8.atan2(0, -1) - 0.25) < 0.001, 'up is a quarter turn');
      assert.ok(Math.abs(pico8.atan2(1, 0)) < 0.001, 'right is zero');
      assert.ok(Math.abs(pico8.atan2(0, 1) - 0.75) < 0.001, 'down is three quarters');
      assert.ok(Math.abs(pico8.atan2(-1, 0) - 0.5) < 0.001, 'left is half');

      // Never negative: carts index tables and lerp with this.
      for (const [dx, dy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
        const turn = pico8.atan2(dx, dy);
        assert.ok(turn >= 0 && turn < 1, `atan2(${dx},${dy}) = ${turn} out of 0..1`);
        // Walking back out along the angle has to land on the input direction.
        const length = Math.sqrt(dx * dx + dy * dy);
        assert.ok(Math.abs(pico8.cos(turn) * length - dx) < 0.001, `cos round trip ${dx},${dy}`);
        assert.ok(Math.abs(pico8.sin(turn) * length - dy) < 0.001, `sin round trip ${dx},${dy}`);
      }
    },
  },
  {
    // galaxis.p8's oprint() outlines text by printing it nine times:
    //   for _x=-1,1 do for _y=-1,1 do print(t,x+_x,y+_y,o) end end
    //   print(t,x,y,c)
    // and the title screen calls it without `o`, so the outline passes a nil
    // colour. PICO-8's optional arguments are optional by count, so that nil
    // is a real colour argument and reads as 0. We used to treat it as "keep
    // the current pen", which made each outline inherit the previous line's
    // fill colour; because oprint dilates by a pixel in all directions, the
    // gaps between glyphs closed up and words rendered as solid bars.
    name: 'an optional argument passed as nil reads as 0, but omitting it keeps the default',
    fn: () => {
      const { pico8 } = makePico8();

      pico8.color(9);
      pico8.print('a', 0, 0);
      assert.strictEqual(pico8.currentColor, 9, 'omitting the colour keeps the pen');

      pico8.color(9);
      pico8.print('a', 0, 0, undefined);
      assert.strictEqual(pico8.currentColor, 0, 'an explicit nil colour is colour 0');

      pico8.color(9);
      pico8.print('a', 0, 0, 12);
      assert.strictEqual(pico8.currentColor, 12, 'a real colour still sets the pen');
    },
  },
  {
    name: 'sqrt/abs/sgn/flr/ceil/min/max/mid produce expected values',
    fn: () => {
      const { pico8 } = makePico8();
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
    // starfox.p8 calls generate_cam_matrix_transform(cam_ax, cam_ay, cam_az)
    // every frame but only ever assigns cam_az, so sin() and cos() are handed
    // nil twice a frame. PICO-8 runs the cart; we used to stop it with
    // "[Pico8] sin missing required argument: x". The manual is explicit that
    // the builtins, unlike the operators, "default to a value of 0".
    name: 'a missing or unreadable argument reads as 0, as it does on the console',
    fn: () => {
      const { pico8 } = makePico8();
      assert.strictEqual(pico8.sin(), 0);
      assert.strictEqual(pico8.cos(), 1);
      assert.strictEqual(pico8.sin(undefined), 0);
      assert.strictEqual(pico8.flr(null), 0);
      assert.strictEqual(pico8.min(4, undefined), 0);
      assert.strictEqual(pico8.max(-4, undefined), 0);

      // A table cannot cross the bridge, so it arrives as Lua's tostring.
      assert.strictEqual(pico8.abs('table: 0x1234'), 0);
    },
  },
  {
    // PICO-8 numbers are 16.16 fixed point, so there is no NaN and no infinity:
    // the manual says dividing by zero "evaluates to 0x7fff.ffff if positive,
    // or -0x7fff.ffff if negative". Our Lua VM divides in doubles, so
    // galaxis.p8's particle with max_age 0 reached min() as 0/0 = NaN and threw
    // "[Pico8] min invalid numeric argument a: NaN". Zero is not negative, so
    // that division saturates positive and min(0/0, 1) has to come back as 1.
    name: 'NaN and infinity saturate to the largest number 16.16 can hold',
    fn: () => {
      const { pico8 } = makePico8();
      const max = 0x7fffffff / 0x10000;

      assert.strictEqual(pico8.min(0 / 0, 1), 1);
      assert.strictEqual(pico8.max(NaN, 1), max);
      assert.strictEqual(pico8.abs(1 / 0), max);
      assert.strictEqual(pico8.min(-1 / 0, 0), -max);
      assert.strictEqual(pico8.mid(NaN, 1, -1 / 0), 1);

      // The same values arriving as text off the Lua stack.
      assert.strictEqual(pico8.abs('-nan'), max);
      assert.strictEqual(pico8.abs('-inf'), max);
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
  {
    name: 'rnd given a table picks one of its elements rather than throwing',
    fn: () => {
      const { pico8 } = makePico8();

      // An array-backed table, which is what add() builds.
      const values = ['a', 'b', 'c'];
      for (let i = 0; i < 50; i += 1) {
        assert.ok(values.includes(pico8.rnd(values)));
      }

      // A table that came across as an object keyed by index.
      const keyed = { 1: 10, 2: 20 };
      for (let i = 0; i < 50; i += 1) {
        assert.ok([10, 20].includes(pico8.rnd(keyed)));
      }

      // Every element should be reachable, not just the first.
      const seen = new Set();
      for (let i = 0; i < 200; i += 1) seen.add(pico8.rnd(values));
      assert.strictEqual(seen.size, 3);

      // Empty table is nil, like an out of range index in Lua.
      assert.strictEqual(pico8.rnd([]), undefined);

      // Numbers still behave.
      assert.ok(pico8.rnd(4) < 4);
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
      assert.strictEqual(pico8.shl(2, 3), 16);
      assert.strictEqual(pico8.shr(16, 2), 4);
      assert.strictEqual(pico8.lshl(2, 3), 16);
      assert.strictEqual(pico8.lshr(16, 2), 4);
      assert.strictEqual(pico8.rotl(1, 1), 2);
      assert.strictEqual(pico8.rotr(2, 1), 1);

      // Every PICO-8 number is 16.16 fixed point, so ~0 is 0xffff.ffff and
      // not -1, and shifting is a fixed point divide that keeps the fraction.
      assert.strictEqual(pico8.bnot(0), -1 / 0x10000);
      assert.strictEqual(pico8.shr(1, 3), 0.125);
      assert.strictEqual(pico8.shr(0.5, 1), 0.25);
      assert.strictEqual(pico8.shl(0.125, 3), 1);
      assert.strictEqual(pico8.band(0.75, 0.5), 0.5);

      // Arithmetic shift right keeps the sign; the logical one does not.
      assert.strictEqual(pico8.shr(-1, 1), -0.5);
      assert.strictEqual(pico8.lshr(-1, 1), 32767.5);
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
    // PICO-8's sub() has Lua's index rules, so a negative offset counts back
    // from the end. Treating a negative j as "to the end" instead swallowed
    // whole strings, and String.substring silently swaps a reversed range
    // rather than yielding "".
    name: 'sub handles negative offsets and empty ranges like Lua',
    fn: () => {
      const { pico8 } = makePico8();
      assert.strictEqual(pico8.sub('hello', 2), 'ello', 'no j runs to the end');
      assert.strictEqual(pico8.sub('hello', -3), 'llo', 'negative i counts from the end');
      assert.strictEqual(pico8.sub('hello', 2, -2), 'ell', 'negative j counts from the end');
      assert.strictEqual(pico8.sub('hello', 4, 2), '', 'a reversed range is empty, not swapped');
      assert.strictEqual(pico8.sub('hello', 0, 2), 'he', 'index 0 clamps to the first character');
      assert.strictEqual(pico8.sub('hello', 2, 99), 'ello', 'j past the end clamps');
    },
  },
  {
    // sub() and ord() ship as Lua source so that a long string is not copied
    // across the JS bridge on every call (ord() on an 8KB string cost 30us
    // against 2.9us on a short one, and POOM's title screen burnt 250ms of a
    // 300ms frame in 8192 of them). A mock proves nothing about Lua source:
    // run it in the VM the editor really uses and hold it to the same answers
    // as the JS implementations above.
    name: 'the Lua-native sub/ord agree with the JS implementations',
    fn: () => {
      const { Lua } = require(path.resolve(__dirname, '..', 'external', 'lua-vm', 'lua.vm.js'));
      const L = new Lua.State();
      L.execute(`Pico8 = {}\n${nativeHelperSource('sub', 'ord')}`);

      const evalLua = (expression) => {
        L.execute(`__str_result = tostring(${expression})`);
        L.getglobal('__str_result');
        const value = L.raw_tostring(-1);
        L.pop(1);
        return value;
      };

      const { pico8 } = makePico8();
      for (const [expr, jsValue] of [
        ['sub("hello", 2, 4)', pico8.sub('hello', 2, 4)],
        ['sub("hello", 2)', pico8.sub('hello', 2)],
        ['sub("hello", -3)', pico8.sub('hello', -3)],
        ['sub("hello", 2, -2)', pico8.sub('hello', 2, -2)],
        ['sub("hello", 4, 2)', pico8.sub('hello', 4, 2)],
        ['sub("hello", 0, 2)', pico8.sub('hello', 0, 2)],
        ['ord("@")', pico8.ord('@')],
        ['ord("123", 2)', pico8.ord('123', 2)],
      ]) {
        assert.strictEqual(evalLua(expr), String(jsValue), expr);
      }

      // Out of range is nil, matching the JS undefined.
      for (const expr of ['ord("abc", 5)', 'ord("abc", 0)', 'ord("", 1)', 'ord(nil)']) {
        assert.strictEqual(evalLua(expr), 'nil', expr);
      }

      // The third argument is a COUNT, and it produces real Lua multiple
      // returns rather than one value or a table.
      L.execute('__str_result = table.concat({ord("123", 2, 2)}, ",")');
      L.getglobal('__str_result');
      const counted = L.raw_tostring(-1);
      L.pop(1);
      assert.strictEqual(counted, pico8.ord('123', 2, 2).join(','));

      // A count running past the end stops there rather than padding with nil,
      // which would truncate the value list at the first hole.
      L.execute('__str_result = table.concat({ord("ab", 1, 5)}, ",")');
      L.getglobal('__str_result');
      const clamped = L.raw_tostring(-1);
      L.pop(1);
      assert.strictEqual(clamped, pico8.ord('ab', 1, 5).join(','));
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
  {
    name: 'split cuts on a delimiter and converts numeric elements by default',
    fn: () => {
      const { pico8 } = makePico8();
      assert.deepStrictEqual(pico8.split('1,2,3'), [1, 2, 3]);
      assert.deepStrictEqual(pico8.split('a,b,c'), ['a', 'b', 'c']);

      // A non-default delimiter, and conversion turned off.
      assert.deepStrictEqual(pico8.split('one:two:3', ':'), ['one', 'two', 3]);
      assert.deepStrictEqual(pico8.split('one:two:3', ':', false), ['one', 'two', '3']);

      // Empty elements are kept, including a trailing one.
      assert.deepStrictEqual(pico8.split('1,,2,'), [1, '', 2, '']);

      // Partly numeric text is not a number.
      assert.deepStrictEqual(pico8.split('1a,2'), ['1a', 2]);
    },
  },
  {
    name: 'split with a numeric separator cuts fixed-size groups instead',
    fn: () => {
      const { pico8 } = makePico8();
      assert.deepStrictEqual(pico8.split('abcdef', 3), ['abc', 'def']);
      assert.deepStrictEqual(pico8.split('12345', 2), [12, 34, 5]);

      // A trailing partial group is kept rather than dropped or padded.
      assert.deepStrictEqual(pico8.split('abcde', 2), ['ab', 'cd', 'e']);

      // A separator that cannot make progress yields nothing rather than
      // looping forever.
      assert.deepStrictEqual(pico8.split('abc', 0), []);

      // An empty delimiter means the same as a size of 1. Carts pack lookup
      // tables into a run of glyphs and unpack them with split(s, ""), so
      // returning nothing here loses the whole table.
      assert.deepStrictEqual(pico8.split('abc', ''), ['a', 'b', 'c']);
      assert.deepStrictEqual(pico8.split('\x80\x1e', ''), ['\x80', '\x1e']);
    },
  },
  {
    name: 'deli removes by index and defaults to the last element',
    fn: () => {
      const { pico8 } = makePico8();
      const t = [10, 20, 30];
      assert.strictEqual(pico8.deli(t, 2), 20);
      assert.deepStrictEqual(t, [10, 30]);

      // No index means the last element.
      assert.strictEqual(pico8.deli(t), 30);
      assert.deepStrictEqual(t, [10]);

      // Out of range is nil rather than an error, and leaves the table alone.
      assert.strictEqual(pico8.deli(t, 5), undefined);
      assert.strictEqual(pico8.deli(t, 0), undefined);
      assert.deepStrictEqual(t, [10]);
    },
  },
  {
    name: 'pack counts its arguments in n so a trailing nil is not lost',
    fn: () => {
      const { pico8 } = makePico8();
      assert.deepStrictEqual(pico8.pack(1, 2, 3), { n: 3, 1: 1, 2: 2, 3: 3 });
      assert.deepStrictEqual(pico8.pack(), { n: 0 });
    },
  },
  {
    name: 'unpack returns the table range as separate values',
    fn: () => {
      const { pico8 } = makePico8();
      // An array result is what the bridge expands into Lua multiple returns.
      assert.deepStrictEqual(pico8.unpack([1, 2, 3]), [1, 2, 3]);
      assert.deepStrictEqual(pico8.unpack([1, 2, 3], 2), [2, 3]);
      assert.deepStrictEqual(pico8.unpack([1, 2, 3], 2, 2), [2]);

      // Lua-style tables are 1-based objects rather than arrays.
      assert.deepStrictEqual(pico8.unpack({ 1: 'a', 2: 'b' }), ['a', 'b']);
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
  {
    name: 'inext walks a sequence and returns index and value together',
    fn: () => {
      const { pico8 } = makePico8();
      const t = ['a', 'b'];
      // Two values, as an array, because that is how the bridge makes Lua
      // multiple returns - a single value would break the for loop.
      assert.deepStrictEqual(pico8.inext(t), [1, 'a']);
      assert.deepStrictEqual(pico8.inext(t, 1), [2, 'b']);
      assert.strictEqual(pico8.inext(t, 2), undefined, 'past the end stops the loop');
      assert.strictEqual(pico8.inext(undefined), undefined, 'inext(nil) must not throw');
    },
  },
  {
    name: 'the Lua-native inext drives a real for loop',
    fn: () => {
      // inext ships as Lua source, so a mock proves nothing: a syntax error or
      // a wrong return arity stays invisible until a cart runs. dinky_kong uses
      // it as "for i,p in inext,split(st) do", so run exactly that shape in the
      // VM the editor really uses.
      const { Lua } = require(path.resolve(__dirname, '..', 'external', 'lua-vm', 'lua.vm.js'));
      const L = new Lua.State();
      L.execute(`Pico8 = {}\n${nativeHelperSource('inext')}`);
      L.execute(`
        local out = {}
        for i, v in inext, {'a', 'b', 'c'} do out[#out + 1] = i .. v end
        -- A hole ends the sequence, and an empty table yields nothing at all.
        for i, v in inext, {} do out[#out + 1] = 'empty' end
        __inext_result = table.concat(out, ',')
      `);
      L.getglobal('__inext_result');
      const result = L.raw_tostring(-1);
      L.pop(1);
      assert.strictEqual(result, '1a,2b,3c');
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
    name: 'music() with a nil track plays song 0 instead of erroring',
    fn: () => {
      const { pico8, emulator } = makePico8();
      // Indexing a split() list out of range is how carts reach song 0, so this
      // has to behave like PICO-8 and not stop the caller's update.
      assert.doesNotThrow(() => pico8.music(undefined));
      assert.deepStrictEqual(emulator.audioEngine._lastMusic, { n: 0, fade: 0, mask: 0xFF });

      emulator.audioEngine._lastMusic = null;
      assert.doesNotThrow(() => pico8.music());
      assert.deepStrictEqual(emulator.audioEngine._lastMusic, { n: 0, fade: 0, mask: 0xFF });

      // A real track still gets through untouched.
      pico8.music(19);
      assert.strictEqual(emulator.audioEngine._lastMusic.n, 19);
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
    name: 'initialize installs the string index metamethod and the fixed point helpers',
    fn: () => {
      const { pico8 } = makePico8();
      const executed = [];
      pico8.initialize({ execute: (source) => executed.push(source) });
      assert.deepStrictEqual(executed, [
        LuaPico8Extensions.STRING_INDEX_LUA,
        LuaPico8Extensions.FIXED_POINT_LUA,
      ]);
    },
  },
  {
    name: 'a string indexes like an array of characters',
    fn: () => {
      // Carts walk a string with for i=1,#s do local c=s[i] end. Stock Lua
      // points the string metatable at the string library, so every one of
      // those reads is nil.
      assert.strictEqual(evalWithStringIndex('("hello")[1]'), 'h');
      assert.strictEqual(evalWithStringIndex('("hello")[5]'), 'o');
      assert.strictEqual(evalWithStringIndex('("hello")[-1]'), 'o',
        'a negative index counts back from the end, like sub');
      assert.strictEqual(evalWithStringIndex('("hello")[2.7]'), 'e',
        'a fixed-point index floors instead of raising');
      assert.strictEqual(evalWithStringIndex('("hello")[0]'), 'nil',
        'out of range reads nil');
      assert.strictEqual(evalWithStringIndex('("hello")[6]'), 'nil');
    },
  },
  {
    name: 'string methods still resolve once string indexing is installed',
    fn: () => {
      assert.strictEqual(evalWithStringIndex('("hello"):sub(2, 3)'), 'el');
      assert.strictEqual(evalWithStringIndex('("hello"):upper()'), 'HELLO');
      assert.strictEqual(evalWithStringIndex('string.rep("ab", 2)'), 'abab');
    },
  },
  {
    name: 'P8SCII: "\\*" repeats the next character rather than printing its count',
    fn: () => {
      const { pico8 } = makePico8();
      // "\x01" "4" "0" means "four zeroes". A renderer that drops the control
      // byte but keeps its arguments draws "40" instead, which is how a score
      // of 000000 rendered as 4000.
      const width = pico8.print('\u00014000', 0, 0, 7);
      const plain = pico8.print('000000', 0, 20, 7);
      assert.strictEqual(width, plain, 'repeat must expand to six characters');
    },
  },
  {
    name: 'P8SCII: "\\f" sets the colour and outlives the print that used it',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.print('\u000c8A', 0, 0, 7);
      assert.ok(pico8._framebuffer.includes(8), 'the glyph must use the new colour');
      assert.ok(!pico8._framebuffer.includes(7), 'the old colour must not be drawn');
      assert.strictEqual(pico8.currentColor, 8, 'the colour persists after print');
    },
  },
  {
    name: 'P8SCII: cursor shifts move the pen without drawing their arguments',
    fn: () => {
      const { pico8 } = makePico8();
      // "\-" takes P0-16, so 'h' (17) is +1 and '0' (0) is -16.
      assert.strictEqual(pico8.print('\u0003hA', 0, 0, 7), pico8.print('A', 1, 20, 7));
      // "\|" moves vertically only, leaving the reported width alone.
      pico8.print('\u0004hA', 40, 0, 7);
      assert.strictEqual(px(pico8, 40, 0), 0, 'the glyph must have moved down a row');
    },
  },
  {
    name: 'P8SCII: a control code argument past "f" keeps counting',
    fn: () => {
      // Parameters are a superset of hex: 'g' is 16, 'h' is 17, and the
      // cursor-shift codes bias by 16, so they routinely land past 'f'.
      assert.strictEqual(LuaPico8Extensions._p8sciiParam('g', 0), 16);
      assert.strictEqual(LuaPico8Extensions._p8sciiParam('f', 0), 15);
      assert.strictEqual(LuaPico8Extensions._p8sciiParam('9', 0), 9);
      assert.strictEqual(LuaPico8Extensions._p8sciiParam('s', 0), 28);
    },
  },
  {
    name: 'P8SCII: "\\^@" writes raw bytes to memory mid-string',
    fn: () => {
      const { pico8 } = makePico8();
      // "@" takes a 4-digit address then a 4-digit count. This is how a cart
      // installs a custom font, so a renderer that only draws text never sees
      // the font at all.
      pico8.print('\u0006@43000003ABC', 0, 0, 7);
      assert.strictEqual(pico8.peek(0x4300), 0x41);
      assert.strictEqual(pico8.peek(0x4301), 0x42);
      assert.strictEqual(pico8.peek(0x4302), 0x43);
    },
  },
  {
    name: 'a cart-supplied font at 0x5600 replaces the built-in one',
    fn: () => {
      const { pico8 } = makePico8();
      // Header: 6px wide, 6px wide for high codes, 6px tall.
      pico8.poke(0x5600, 6, 6, 6);
      // Character 'A' (65) is a solid 6x6 block.
      for (let row = 0; row < 6; row += 1) {
        pico8.poke(0x5600 + (65 * 8) + row, 0x3f);
      }
      pico8.poke(0x5f58, 0x81); // observe defaults, use the custom font

      assert.strictEqual(pico8.print('A', 0, 0, 7), 6, 'advance comes from the font header');
      for (let row = 0; row < 6; row += 1) {
        for (let col = 0; col < 6; col += 1) {
          assert.strictEqual(px(pico8, col, row), 7, `pixel ${col},${row} must be filled`);
        }
      }
    },
  },
  {
    name: 'a custom font is ignored until the cart actually defines one',
    fn: () => {
      const { pico8 } = makePico8();
      pico8.poke(0x5f58, 0x81);
      // 0x5600 is still blank, so falling back to the built-in font is the
      // only way to avoid drawing 256 empty characters.
      pico8.print('A', 0, 0, 7);
      assert.ok(pico8._framebuffer.includes(7), 'the built-in glyph must still draw');
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
