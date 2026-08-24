// lua-dialect.test.js
// Locks the simulator's Lua VM to the dialect the watch actually runs.
//
// This is not a test of any RetroStudio API. It tests the language underneath
// them, because that layer silently drifted once already: the simulator shipped
// Lua 5.2.4 while the firmware ran 5.3.5, so `x & 0xFF` and `a // b` were syntax
// errors in the editor and perfectly valid on the device. The firmware API audit
// cannot catch that class of bug - it matches function names, and the names were
// never the problem.
//
// Three properties matter, in rough order of how quietly they break things:
//
//   1. Number representation. librw/lua/luaconf.h enables LUA_32BITS, which
//      stock Lua ships commented out. That makes lua_Integer a 32-bit int and
//      lua_Number a single-precision float. A stock 5.3.5 build uses 64-bit ints
//      and doubles and would agree with the watch on every test you would think
//      to write, then disagree on overflow and on the 8th significant digit.
//
//   2. Which standard libraries exist. The firmware's linit.c registers only
//      _G, coroutine, table, string and bit32. math, os, io, debug, package and
//      utf8 are commented out. A creator who calls math.floor in the editor gets
//      a working script and a broken watch.
//
//   3. 5.3 syntax and semantics - floor division, native bitwise operators, and
//      the integer/float distinction that makes tostring(3.0) return "3.0".
//
// Where the firmware sources are available the library set is checked against
// linit.c directly rather than a list copied into this file, so the test follows
// the firmware instead of needing to be remembered.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const VM_PATH = path.join(__dirname, '..', 'external', 'lua-vm', 'lua.vm.js');
// scripts/lua -> scripts -> RetroStudio -> Retrowww -> RetroStudio -> monorepo root
const FIRMWARE_LUA = path.join(__dirname, '..', '..', '..', '..', '..', 'librw', 'lua');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const Lua = require(VM_PATH).Lua;

// A fresh state per assertion would be cleaner but each one costs a full
// luaL_openlibs; these tests never mutate globals they do not own.
const L = new Lua.State();

// Evaluate an expression and return tostring() of it. Errors propagate as
// Lua.Error, which is what the "not available" assertions below rely on.
function evalLua(expression) {
  L.execute(`__dialect_result = tostring(${expression})`);
  L.getglobal('__dialect_result');
  const value = L.raw_tostring(-1);
  L.pop(1);
  return value;
}

test('runs Lua 5.3, not 5.2', () => {
  assert.strictEqual(evalLua('_VERSION'), 'Lua 5.3');
});

// --- number representation -------------------------------------------------

test('integers are 32-bit: 0x7fffffff + 1 wraps negative', () => {
  // With stock 64-bit lua_Integer this is 2147483648.
  assert.strictEqual(evalLua('0x7fffffff + 1'), '-2147483648');
});

test('floats are single precision, not double', () => {
  // float32(0.1) is 0.100000001490116119; double would give 0.10000000000000001.
  assert.strictEqual(evalLua('string.format("%.17g", 0.1)'), '0.10000000149011612');
});

test('integers and floats are distinct subtypes', () => {
  assert.strictEqual(evalLua('3.0'), '3.0', 'a float must keep its .0');
  assert.strictEqual(evalLua('3'), '3', 'an integer must not gain one');
});

// --- 5.3 syntax that 5.2 rejected outright ---------------------------------

test('floor division is available', () => {
  assert.strictEqual(evalLua('7//2'), '3');
  assert.strictEqual(evalLua('7/2'), '3.5', 'plain / must stay float division');
});

test('native bitwise operators are available', () => {
  assert.strictEqual(evalLua('0xF0 & 0x3C'), '48');
  assert.strictEqual(evalLua('0xF0 | 0x0F'), '255');
  assert.strictEqual(evalLua('1 << 10'), '1024');
  assert.strictEqual(evalLua('1024 >> 4'), '64');
  assert.strictEqual(evalLua('~0'), '-1');
});

// --- standard library surface ----------------------------------------------

// luaopen_* name -> the global it installs. _G is special: it has no table of
// its own, so a base function stands in for it.
const LIB_GLOBALS = {
  luaopen_base: null,
  luaopen_coroutine: 'coroutine',
  luaopen_table: 'table',
  luaopen_string: 'string',
  luaopen_bit32: 'bit32',
  luaopen_math: 'math',
  luaopen_os: 'os',
  luaopen_io: 'io',
  luaopen_debug: 'debug',
  luaopen_package: 'package',
  luaopen_utf8: 'utf8',
};

function readFirmwareLibs() {
  const initPath = path.join(FIRMWARE_LUA, 'linit.c');
  if (!fs.existsSync(initPath)) return null;

  const source = fs.readFileSync(initPath, 'utf8');
  const registered = new Set();
  for (const line of source.split('\n')) {
    // Only the loadedlibs table entries, and only ones not commented out.
    const match = line.match(/^\s*\{\s*(?:"[^"]*"|LUA_\w+)\s*,\s*(luaopen_\w+)\s*\}/);
    if (match) registered.add(match[1]);
  }
  return registered.size ? registered : null;
}

test('registers exactly the libraries the firmware registers', () => {
  const firmware = readFirmwareLibs();
  if (!firmware) {
    console.log('        (skipped: librw/lua/linit.c not found beside this checkout)');
    return;
  }

  const unknown = [...firmware].filter((n) => !(n in LIB_GLOBALS));
  assert.strictEqual(
    unknown.length,
    0,
    `firmware linit.c registers libraries this test does not know about: ${unknown.join(', ')}. ` +
      'Add them to LIB_GLOBALS.'
  );

  const wrong = [];
  for (const [openName, global] of Object.entries(LIB_GLOBALS)) {
    if (global === null) continue; // _G checked separately below
    const shouldExist = firmware.has(openName);
    const actual = evalLua(`type(${global})`);
    const doesExist = actual === 'table';
    if (shouldExist !== doesExist) {
      wrong.push(
        `${global}: firmware ${shouldExist ? 'HAS' : 'does NOT have'} it, ` +
          `simulator reports type ${actual}`
      );
    }
  }

  assert.strictEqual(wrong.length, 0, `simulator stdlib does not match firmware:\n        ${wrong.join('\n        ')}`);
});

test('base library is present', () => {
  assert.strictEqual(evalLua('type(pcall)'), 'function');
  assert.strictEqual(evalLua('type(tostring)'), 'function');
});

test('libraries the firmware omits are absent', () => {
  // Spelled out as well as derived above, so this still fails loudly in a
  // standalone RetroStudio checkout where linit.c is not reachable.
  for (const missing of ['math', 'os', 'io', 'debug', 'package', 'utf8']) {
    assert.strictEqual(
      evalLua(`type(${missing})`),
      'nil',
      `'${missing}' is available in the simulator but not on the watch`
    );
  }
});

test('bit32 is present despite being a 5.2 library', () => {
  // linit.c still registers it, and lbitlib.c is compiled via LUA_COMPAT_5_2.
  assert.strictEqual(evalLua('type(bit32)'), 'table');
  assert.strictEqual(evalLua('bit32.band(0xF0, 0x3C)'), '48');
});

// --- the JS bridge must live within that same library set --------------------

// base-lua-extension.js injects Lua to wrap every registered API function. It
// runs in this VM, so it may only use libraries the firmware registers. It
// previously called math.floor and the bare 5.1 `unpack`, both of which are nil
// here; the multi-return path and rnd(t) raised at runtime.
test('the JS bridge does not reach for libraries the firmware omits', () => {
  const bridgePath = path.join(__dirname, 'base-lua-extension.js');
  const lines = fs.readFileSync(bridgePath, 'utf8').split('\n');

  const offenders = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    // Skip comments - both the JS ones around the snippets and the Lua ones
    // inside them, which legitimately name these libraries when explaining why
    // they are avoided.
    if (trimmed.startsWith('--') || trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    const removedLib = /(?<![\w.])(math|os|io|debug|package|utf8)\s*\./.exec(line);
    if (removedLib) offenders.push(`${index + 1}: ${removedLib[1]} - ${trimmed}`);

    // table.unpack is fine; the bare global is not.
    if (/(?<![\w.:])unpack\s*\(/.test(line)) offenders.push(`${index + 1}: bare unpack() - ${trimmed}`);
  });

  assert.strictEqual(
    offenders.length,
    0,
    'base-lua-extension.js uses Lua libraries the watch does not register:\n        ' + offenders.join('\n        ')
  );
});

test('the multi-return bridge expands a result without the 5.1 unpack', () => {
  L.execute(`
    local __unpack = table.unpack or unpack
    __dialect_a, __dialect_b, __dialect_c = __unpack({7, 8, 9}, 1, 3)
  `);
  assert.strictEqual(evalLua('__dialect_a'), '7');
  assert.strictEqual(evalLua('__dialect_b'), '8');
  assert.strictEqual(evalLua('__dialect_c'), '9');
});

test('the rnd(table) adapter floors without the math library', () => {
  // Lua's % is a floored modulo, so v - v % 1 is exactly math.floor(v).
  L.execute('function __dialect_floor(v) return v - v % 1 end');
  for (const [input, expected] of [[0.0, '0'], [0.9, '0'], [1.999, '1'], [4.5, '4'], [-0.1, '-1'], [-2.5, '-3']]) {
    assert.strictEqual(
      evalLua(`__dialect_floor(${input})`).replace(/\.0$/, ''),
      expected,
      `floor(${input})`
    );
  }
});

// --- byte strings ----------------------------------------------------------

test('byte strings survive the JS boundary intact', () => {
  // Lua strings are byte strings. Decoding them as UTF-8 corrupts PICO-8 cart
  // text and any packed binary, and stops at the first NUL. See the
  // readLuaString comment in external/lua53/glue.js.
  L.execute('__dialect_bytes = "\\200\\201\\202"');
  L.getglobal('__dialect_bytes');
  const value = L.raw_tostring(-1);
  L.pop(1);

  assert.strictEqual(value.length, 3, 'high bytes were re-encoded rather than passed through');
  assert.deepStrictEqual([...value].map((c) => c.charCodeAt(0)), [200, 201, 202]);
});

test('embedded NUL does not truncate a string', () => {
  L.execute('__dialect_nul = "a\\0b"');
  L.getglobal('__dialect_nul');
  const value = L.raw_tostring(-1);
  L.pop(1);

  assert.strictEqual(value.length, 3, 'string was truncated at the NUL terminator');
  assert.deepStrictEqual([...value].map((c) => c.charCodeAt(0)), [97, 0, 98]);
});

(async function run() {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL  ${name}`);
      console.error(`        ${error && error.message}`);
    }
  }

  console.log(`\n${tests.length - failed} passed, ${failed} failed, ${tests.length} total`);
  if (failed > 0) process.exit(1);
}());
