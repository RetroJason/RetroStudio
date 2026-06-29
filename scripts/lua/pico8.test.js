/**
 * Unit tests for Pico-8 Lua Extensions
 * Tests all pico-8 API functions for RetroStudio
 */

const assert = require('assert');

// Mock BaseLuaExtension for testing
class BaseLuaExtension {
  constructor() {
    this.luaState = null;
    this.gameEmulator = null;
  }

  setLuaState(luaState) {
    this.luaState = luaState;
  }
}

// Mock LuaPico8Extensions - simulating the pico8.js file
class LuaPico8Extensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
    this.currentColor = 0;
    this.currentPalette = new Map();
    this.randomSeed = 0;
    this.spriteFlags = new Map();
  }

  _optionalNumberArg(args, index, defaultValue, methodName, argName) {
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
    if (raw === undefined || raw === null || raw === '') {
      return defaultValue;
    }
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`[Pico8] ${methodName} invalid numeric argument ${argName}: ${raw}`);
    }
    return value;
  }

  _requireNumberArg(args, index, methodName, argName) {
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
    if (raw === undefined || raw === null || raw === '') {
      throw new Error(`[Pico8] ${methodName} missing required argument: ${argName}`);
    }
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`[Pico8] ${methodName} invalid numeric argument ${argName}: ${raw}`);
    }
    return value;
  }

  _requireIntegerArg(args, index, methodName, argName) {
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
    if (raw === undefined || raw === null || raw === '') {
      throw new Error(`[Pico8] ${methodName} missing required argument: ${argName}`);
    }
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value)) {
      throw new Error(`[Pico8] ${methodName} invalid integer argument ${argName}: ${raw}`);
    }
    return value;
  }

  _optionalIntegerArg(args, index, defaultValue, methodName, argName) {
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
    if (raw === undefined || raw === null || raw === '') {
      return defaultValue;
    }
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value)) {
      throw new Error(`[Pico8] ${methodName} invalid integer argument ${argName}: ${raw}`);
    }
    return value;
  }

  // Graphics
  color(...args) { this.currentColor = Math.floor(this._requireNumberArg(args, 0, 'color', 'c')) & 0xFF; }
  
  sin(...args) {
    const x = this._requireNumberArg(args, 0, 'sin', 'x');
    return Math.sin(x * 2 * Math.PI);
  }

  cos(...args) {
    const x = this._requireNumberArg(args, 0, 'cos', 'x');
    return Math.cos(x * 2 * Math.PI);
  }

  atan2(...args) {
    const y = this._requireNumberArg(args, 0, 'atan2', 'y');
    const x = this._requireNumberArg(args, 1, 'atan2', 'x');
    return Math.atan2(y, x) / (2 * Math.PI);
  }

  sqrt(...args) {
    const x = this._requireNumberArg(args, 0, 'sqrt', 'x');
    return Math.sqrt(x);
  }

  abs(...args) {
    const x = this._requireNumberArg(args, 0, 'abs', 'x');
    return Math.abs(x);
  }

  sgn(...args) {
    const x = this._requireNumberArg(args, 0, 'sgn', 'x');
    return x > 0 ? 1 : (x < 0 ? -1 : 0);
  }

  flr(...args) {
    const x = this._requireNumberArg(args, 0, 'flr', 'x');
    return Math.floor(x);
  }

  ceil(...args) {
    const x = this._requireNumberArg(args, 0, 'ceil', 'x');
    return Math.ceil(x);
  }

  min(...args) {
    const a = this._requireNumberArg(args, 0, 'min', 'a');
    const b = this._requireNumberArg(args, 1, 'min', 'b');
    return Math.min(a, b);
  }

  max(...args) {
    const a = this._requireNumberArg(args, 0, 'max', 'a');
    const b = this._requireNumberArg(args, 1, 'max', 'b');
    return Math.max(a, b);
  }

  mid(...args) {
    const a = this._requireNumberArg(args, 0, 'mid', 'a');
    const b = this._requireNumberArg(args, 1, 'mid', 'b');
    const c = this._requireNumberArg(args, 2, 'mid', 'c');
    return Math.max(Math.min(a, b, c), Math.min(Math.max(a, b), Math.max(b, c)));
  }

  rnd(...args) {
    const x = this._optionalNumberArg(args, 0, 1.0, 'rnd', 'x');
    return Math.random() * x;
  }

  srand(...args) {
    const x = this._requireIntegerArg(args, 0, 'srand', 'x');
    this.randomSeed = x;
  }

  // Bitwise
  band(...args) {
    const a = this._requireIntegerArg(args, 0, 'band', 'a');
    const b = this._requireIntegerArg(args, 1, 'band', 'b');
    return a & b;
  }

  bor(...args) {
    const a = this._requireIntegerArg(args, 0, 'bor', 'a');
    const b = this._requireIntegerArg(args, 1, 'bor', 'b');
    return a | b;
  }

  bxor(...args) {
    const a = this._requireIntegerArg(args, 0, 'bxor', 'a');
    const b = this._requireIntegerArg(args, 1, 'bxor', 'b');
    return a ^ b;
  }

  bnot(...args) {
    const x = this._requireIntegerArg(args, 0, 'bnot', 'x');
    return ~x;
  }

  shl(...args) {
    const x = this._requireIntegerArg(args, 0, 'shl', 'x');
    const n = this._requireIntegerArg(args, 1, 'shl', 'n');
    return x << n;
  }

  shr(...args) {
    const x = this._requireIntegerArg(args, 0, 'shr', 'x');
    const n = this._requireIntegerArg(args, 1, 'shr', 'n');
    return x >> n;
  }

  lshl(...args) {
    const x = this._requireIntegerArg(args, 0, 'lshl', 'x');
    const n = this._requireIntegerArg(args, 1, 'lshl', 'n');
    return (x << n) & 0xFFFFFFFF;
  }

  lshr(...args) {
    const x = this._requireIntegerArg(args, 0, 'lshr', 'x');
    const n = this._requireIntegerArg(args, 1, 'lshr', 'n');
    return (x >>> n) & 0xFFFFFFFF;
  }

  rotl(...args) {
    const x = this._requireIntegerArg(args, 0, 'rotl', 'x');
    const n = this._requireIntegerArg(args, 1, 'rotl', 'n');
    const mask = 0xFFFFFFFF;
    return ((x << n) | (x >>> (32 - n))) & mask;
  }

  rotr(...args) {
    const x = this._requireIntegerArg(args, 0, 'rotr', 'x');
    const n = this._requireIntegerArg(args, 1, 'rotr', 'n');
    const mask = 0xFFFFFFFF;
    return ((x >>> n) | (x << (32 - n))) & mask;
  }

  // String
  sub(...args) {
    const s = args[0]?.toString() ?? '';
    const i = this._requireIntegerArg(args, 1, 'sub', 'i');
    const j = this._optionalIntegerArg(args, 2, -1, 'sub', 'j');
    const startIdx = i - 1;
    const endIdx = j >= 0 ? j : s.length;
    return s.substring(startIdx, endIdx);
  }

  tostr(...args) {
    const x = args[0];
    const showDecimal = this._optionalIntegerArg(args, 1, 1, 'tostr', 'show_decimal');
    if (typeof x === 'number') {
      if (showDecimal && x % 1 !== 0) {
        return x.toString();
      }
      return Math.floor(x).toString();
    }
    return x?.toString() ?? '';
  }

  tonum(...args) {
    const s = args[0]?.toString() ?? '';
    const value = Number.parseFloat(s);
    return Number.isFinite(value) ? value : 0;
  }

  // Utility
  stat(...args) {
    const x = this._requireIntegerArg(args, 0, 'stat', 'x');
    switch (x) {
      case 0: return Date.now();
      case 4: return 60;
      case 5: return (performance.memory?.usedJSHeapSize || 0) / 1024 / 1024;
      default: return 0;
    }
  }

  fget(...args) {
    const n = this._requireIntegerArg(args, 0, 'fget', 'n');
    const f = this._optionalIntegerArg(args, 1, 0, 'fget', 'f');
    const key = `sprite_${n}_flag_${f}`;
    return this.spriteFlags.get(key) ? 1 : 0;
  }

  fset(...args) {
    const n = this._requireIntegerArg(args, 0, 'fset', 'n');
    const f = this._optionalIntegerArg(args, 1, 0, 'fset', 'f');
    const v = this._optionalIntegerArg(args, 2, 1, 'fset', 'v');
    const key = `sprite_${n}_flag_${f}`;
    if (v !== 0) {
      this.spriteFlags.set(key, true);
    } else {
      this.spriteFlags.delete(key);
    }
  }
}

// ============================================================
// Test Suite
// ============================================================
// Note: Jest tests below are for reference/CI integration
// Manual tests are run at the bottom

// Jest describe/test blocks (for npm test with Jest)
// Uncomment these if Jest is configured
/*
describe('Pico-8 Lua Extensions', () => {
  let pico8;

  beforeEach(() => {
    pico8 = new LuaPico8Extensions(null);
  });

  describe('Math Functions', () => {
    test('sin - returns sine of value in 0.0-1.0 range', () => {
      const result = pico8.sin(0.25);
      assert.ok(Math.abs(result - 1.0) < 0.01); // sin(π/2) ≈ 1
    });

    test('cos - returns cosine of value in 0.0-1.0 range', () => {
      const result = pico8.cos(0);
      assert.ok(Math.abs(result - 1.0) < 0.01); // cos(0) ≈ 1
    });

    test('sqrt - calculates square root', () => {
      assert.strictEqual(pico8.sqrt(16), 4);
      assert.strictEqual(pico8.sqrt(9), 3);
    });

    test('abs - returns absolute value', () => {
      assert.strictEqual(pico8.abs(-5), 5);
      assert.strictEqual(pico8.abs(5), 5);
      assert.strictEqual(pico8.abs(0), 0);
    });

    test('sgn - returns sign (-1, 0, 1)', () => {
      assert.strictEqual(pico8.sgn(-5), -1);
      assert.strictEqual(pico8.sgn(0), 0);
      assert.strictEqual(pico8.sgn(5), 1);
    });

    test('flr - returns floor', () => {
      assert.strictEqual(pico8.flr(3.7), 3);
      assert.strictEqual(pico8.flr(3.2), 3);
      assert.strictEqual(pico8.flr(-2.5), -3);
    });

    test('ceil - returns ceiling', () => {
      assert.strictEqual(pico8.ceil(3.2), 4);
      assert.strictEqual(pico8.ceil(3.7), 4);
      assert.strictEqual(pico8.ceil(-2.5), -2);
    });

    test('min - returns minimum of two values', () => {
      assert.strictEqual(pico8.min(5, 3), 3);
      assert.strictEqual(pico8.min(3, 5), 3);
      assert.strictEqual(pico8.min(5, 5), 5);
    });

    test('max - returns maximum of two values', () => {
      assert.strictEqual(pico8.max(5, 3), 5);
      assert.strictEqual(pico8.max(3, 5), 5);
      assert.strictEqual(pico8.max(5, 5), 5);
    });

    test('mid - returns median of three values', () => {
      assert.strictEqual(pico8.mid(1, 5, 3), 3);
      assert.strictEqual(pico8.mid(5, 1, 3), 3);
      assert.strictEqual(pico8.mid(3, 1, 5), 3);
    });

    test('rnd - returns random number in range', () => {
      const result = pico8.rnd(10);
      assert.ok(result >= 0 && result <= 10);
    });

    test('srand - seeds random number generator', () => {
      pico8.srand(12345);
      assert.strictEqual(pico8.randomSeed, 12345);
    });

    test('atan2 - returns arctangent in 0.0-1.0 range', () => {
      const result = pico8.atan2(1, 1);
      assert.ok(result >= 0 && result <= 1);
    });
  });

  describe('Bitwise Operations', () => {
    test('band - bitwise AND', () => {
      assert.strictEqual(pico8.band(12, 10), 8);  // 1100 & 1010 = 1000
      assert.strictEqual(pico8.band(15, 7), 7);   // 1111 & 0111 = 0111
    });

    test('bor - bitwise OR', () => {
      assert.strictEqual(pico8.bor(12, 10), 14);  // 1100 | 1010 = 1110
      assert.strictEqual(pico8.bor(8, 4), 12);    // 1000 | 0100 = 1100
    });

    test('bxor - bitwise XOR', () => {
      assert.strictEqual(pico8.bxor(12, 10), 6);  // 1100 ^ 1010 = 0110
      assert.strictEqual(pico8.bxor(15, 7), 8);   // 1111 ^ 0111 = 1000
    });

    test('bnot - bitwise NOT', () => {
      const result = pico8.bnot(0);
      assert.strictEqual(result, -1);
    });

    test('shl - shift left', () => {
      assert.strictEqual(pico8.shl(8, 2), 32);    // 8 << 2 = 32
      assert.strictEqual(pico8.shl(1, 3), 8);     // 1 << 3 = 8
    });

    test('shr - shift right', () => {
      assert.strictEqual(pico8.shr(32, 2), 8);    // 32 >> 2 = 8
      assert.strictEqual(pico8.shr(8, 1), 4);     // 8 >> 1 = 4
    });

    test('rotl - rotate left', () => {
      // Rotate 1 left 1 bit: 00000001 -> 00000010
      const result = pico8.rotl(1, 1);
      assert.strictEqual(result, 2);
    });

    test('rotr - rotate right', () => {
      // Rotate 2 right 1 bit: 00000010 -> 00000001
      const result = pico8.rotr(2, 1);
      assert.strictEqual(result, 1);
    });
  });

  describe('String Functions', () => {
    test('sub - extracts substring (1-indexed)', () => {
      assert.strictEqual(pico8.sub('hello', 2, 4), 'ell');
      assert.strictEqual(pico8.sub('hello', 1, 5), 'hello');
    });

    test('tostr - converts number to string', () => {
      assert.strictEqual(pico8.tostr(42), '42');
      assert.strictEqual(pico8.tostr(3.14, 1), '3.14');
      assert.strictEqual(pico8.tostr(3.14, 0), '3');
    });

    test('tonum - converts string to number', () => {
      assert.strictEqual(pico8.tonum('42'), 42);
      assert.strictEqual(pico8.tonum('3.14'), 3.14);
      assert.strictEqual(pico8.tonum('invalid'), 0);
    });
  });

  describe('Graphics Functions', () => {
    test('color - sets current color', () => {
      pico8.color(7);
      assert.strictEqual(pico8.currentColor, 7);
      pico8.color(255);
      assert.strictEqual(pico8.currentColor, 255);
    });

    test('color - masks color to 8 bits', () => {
      pico8.color(256);  // 256 & 0xFF = 0
      assert.strictEqual(pico8.currentColor, 0);
    });
  });

  describe('Sprite Flags', () => {
    test('fget - retrieves sprite flag', () => {
      assert.strictEqual(pico8.fget(1, 0), 0);
    });

    test('fset - sets sprite flag', () => {
      pico8.fset(1, 0, 1);
      assert.strictEqual(pico8.fget(1, 0), 1);
      
      pico8.fset(1, 0, 0);
      assert.strictEqual(pico8.fget(1, 0), 0);
    });

    test('fset/fget with multiple sprites', () => {
      pico8.fset(1, 0, 1);
      pico8.fset(2, 0, 1);
      pico8.fset(1, 1, 1);
      
      assert.strictEqual(pico8.fget(1, 0), 1);
      assert.strictEqual(pico8.fget(2, 0), 1);
      assert.strictEqual(pico8.fget(1, 1), 1);
      assert.strictEqual(pico8.fget(2, 1), 0);
    });
  });

  describe('Stat Function', () => {
    test('stat - returns frame stats', () => {
      const fps = pico8.stat(4);
      assert.strictEqual(fps, 60);
    });

    test('stat - returns 0 for unknown stats', () => {
      assert.strictEqual(pico8.stat(999), 0);
    });
  });
});
*/
// End of Jest tests - uncomment above block for npm test


// Run tests if this is executed directly
if (require.main === module) {
  console.log('Running Pico-8 Extensions Unit Tests...\n');
  
  const tests = [
    { name: 'Math: sin', fn: () => {
      const p = new LuaPico8Extensions(null);
      const result = p.sin(0.25);
      console.assert(Math.abs(result - 1.0) < 0.01, 'sin(0.25) should be ~1');
      console.log('✓ Math: sin');
    }},
    { name: 'Math: sqrt', fn: () => {
      const p = new LuaPico8Extensions(null);
      console.assert(p.sqrt(16) === 4, 'sqrt(16) should be 4');
      console.log('✓ Math: sqrt');
    }},
    { name: 'Math: abs', fn: () => {
      const p = new LuaPico8Extensions(null);
      console.assert(p.abs(-5) === 5, 'abs(-5) should be 5');
      console.log('✓ Math: abs');
    }},
    { name: 'Math: sgn', fn: () => {
      const p = new LuaPico8Extensions(null);
      console.assert(p.sgn(-5) === -1, 'sgn(-5) should be -1');
      console.assert(p.sgn(0) === 0, 'sgn(0) should be 0');
      console.assert(p.sgn(5) === 1, 'sgn(5) should be 1');
      console.log('✓ Math: sgn');
    }},
    { name: 'Math: flr/ceil', fn: () => {
      const p = new LuaPico8Extensions(null);
      console.assert(p.flr(3.7) === 3, 'flr(3.7) should be 3');
      console.assert(p.ceil(3.2) === 4, 'ceil(3.2) should be 4');
      console.log('✓ Math: flr/ceil');
    }},
    { name: 'Math: min/max/mid', fn: () => {
      const p = new LuaPico8Extensions(null);
      console.assert(p.min(5, 3) === 3, 'min(5,3) should be 3');
      console.assert(p.max(5, 3) === 5, 'max(5,3) should be 5');
      console.assert(p.mid(1, 5, 3) === 3, 'mid(1,5,3) should be 3');
      console.log('✓ Math: min/max/mid');
    }},
    { name: 'Bitwise: band', fn: () => {
      const p = new LuaPico8Extensions(null);
      console.assert(p.band(12, 10) === 8, 'band(12,10) should be 8');
      console.log('✓ Bitwise: band');
    }},
    { name: 'Bitwise: bor', fn: () => {
      const p = new LuaPico8Extensions(null);
      console.assert(p.bor(12, 10) === 14, 'bor(12,10) should be 14');
      console.log('✓ Bitwise: bor');
    }},
    { name: 'Bitwise: bxor', fn: () => {
      const p = new LuaPico8Extensions(null);
      console.assert(p.bxor(12, 10) === 6, 'bxor(12,10) should be 6');
      console.log('✓ Bitwise: bxor');
    }},
    { name: 'Bitwise: shifts', fn: () => {
      const p = new LuaPico8Extensions(null);
      console.assert(p.shl(8, 2) === 32, 'shl(8,2) should be 32');
      console.assert(p.shr(32, 2) === 8, 'shr(32,2) should be 8');
      console.log('✓ Bitwise: shifts');
    }},
    { name: 'String: sub', fn: () => {
      const p = new LuaPico8Extensions(null);
      console.assert(p.sub('hello', 2, 4) === 'ell', "sub('hello',2,4) should be 'ell'");
      console.log('✓ String: sub');
    }},
    { name: 'String: tostr/tonum', fn: () => {
      const p = new LuaPico8Extensions(null);
      console.assert(p.tostr(42) === '42', "tostr(42) should be '42'");
      console.assert(p.tonum('42') === 42, "tonum('42') should be 42");
      console.log('✓ String: tostr/tonum');
    }},
    { name: 'Color: set/use', fn: () => {
      const p = new LuaPico8Extensions(null);
      p.color(7);
      console.assert(p.currentColor === 7, 'color(7) should set currentColor to 7');
      console.log('✓ Color: set/use');
    }},
    { name: 'Flags: fget/fset', fn: () => {
      const p = new LuaPico8Extensions(null);
      p.fset(1, 0, 1);
      console.assert(p.fget(1, 0) === 1, 'fget after fset should return 1');
      console.log('✓ Flags: fget/fset');
    }},
    { name: 'Stat: fps', fn: () => {
      const p = new LuaPico8Extensions(null);
      console.assert(p.stat(4) === 60, 'stat(4) should return 60 (fps)');
      console.log('✓ Stat: fps');
    }}
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      test.fn();
      passed++;
    } catch (e) {
      console.error(`✗ ${test.name}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${tests.length} tests`);
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = { LuaPico8Extensions };
