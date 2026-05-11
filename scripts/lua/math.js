// math.js - Math Extensions for Lua
// Provides mathematical utility functions accessible from Lua scripts

class LuaMathExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
  }

  _requireNumberArg(args, index, methodName, argName) {
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
    if (raw === undefined || raw === null || raw === '') {
      throw new Error(`[Math] ${methodName} missing required argument: ${argName}`);
    }

    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`[Math] ${methodName} invalid numeric argument ${argName}: ${raw}`);
    }
    return value;
  }

  _requireIntegerArg(args, index, methodName, argName) {
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
    if (raw === undefined || raw === null || raw === '') {
      throw new Error(`[Math] ${methodName} missing required argument: ${argName}`);
    }

    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value)) {
      throw new Error(`[Math] ${methodName} invalid integer argument ${argName}: ${raw}`);
    }
    return value;
  }

  _requireIntegerStackArg(stackIndex, methodName, argName) {
    const raw = this.luaState?.raw_tostring?.(stackIndex);
    if (raw === undefined || raw === null || raw === '') {
      throw new Error(`[Math] ${methodName} missing required argument: ${argName}`);
    }

    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value)) {
      throw new Error(`[Math] ${methodName} invalid integer argument ${argName}: ${raw}`);
    }
    return value;
  }

  /**
   * Sin function - uses Lua state to get parameters
   * Lua usage: Math.Sin(x)
   */
  Sin(...args) {
    const x = this._requireNumberArg(args, 0, 'Sin', 'x');
    const result = Math.sin(x);
    return result;
  }

  /**
   * Cos function
   * Lua usage: Math.Cos(x)
   */
  Cos(...args) {
    const x = this._requireNumberArg(args, 0, 'Cos', 'x');
    const result = Math.cos(x);
    return result;
  }

  /**
   * Square root function
   * Lua usage: Math.Sqrt(x)
   */
  Sqrt(...args) {
    const x = this._requireNumberArg(args, 0, 'Sqrt', 'x');
    const result = Math.sqrt(x);
    return result;
  }

  /**
   * Power function
   * Lua usage: Math.Pow(x, y)
   */
  Pow(...args) {
    const x = this._requireNumberArg(args, 0, 'Pow', 'x');
    const y = this._requireNumberArg(args, 1, 'Pow', 'y');
    const result = Math.pow(x, y);
    return result;
  }

  /**
   * Arctangent 2 function
   * Lua usage: Math.Atan2(y, x)
   */
  Atan2(...args) {
    const y = this._requireNumberArg(args, 0, 'Atan2', 'y');
    const x = this._requireNumberArg(args, 1, 'Atan2', 'x');
    const result = Math.atan2(y, x);
    return result;
  }

  /**
   * Minimum function
   * Lua usage: Math.Min(x, y)
   */
  Min(...args) {
    const x = this._requireNumberArg(args, 0, 'Min', 'x');
    const y = this._requireNumberArg(args, 1, 'Min', 'y');
    const result = Math.min(x, y);
    return result;
  }

  /**
   * Maximum function
   * Lua usage: Math.Max(x, y)
   */
  Max(...args) {
    const x = this._requireNumberArg(args, 0, 'Max', 'x');
    const y = this._requireNumberArg(args, 1, 'Max', 'y');
    const result = Math.max(x, y);
    return result;
  }

  /**
   * Clamp a value between minimum and maximum bounds
   * Lua usage: Math.Clamp(value, min, max)
   */
  Clamp(...args) {
    const value = this._requireNumberArg(args, 0, 'Clamp', 'value');
    const min = this._requireNumberArg(args, 1, 'Clamp', 'min');
    const max = this._requireNumberArg(args, 2, 'Clamp', 'max');
    
    const result = Math.min(Math.max(value, min), max);
    
    return result;
  }

  /**
   * Ceiling function
   * Lua usage: Math.Ceil(x)
   */
  Ceil(...args) {
    const x = this._requireNumberArg(args, 0, 'Ceil', 'x');
    const result = Math.ceil(x);
    return result;
  }

  /**
   * Floor function
   * Lua usage: Math.Floor(x)
   */
  Floor(...args) {
    const x = this._requireNumberArg(args, 0, 'Floor', 'x');
    const result = Math.floor(x);
    return result;
  }

  /**
   * Round function
   * Lua usage: Math.Round(x)
   */
  Round(...args) {
    const x = this._requireNumberArg(args, 0, 'Round', 'x');
    const result = Math.round(x);
    return result;
  }

  /**
   * Absolute value function
   * Lua usage: Math.Abs(x)
   */
  Abs(...args) {
    const x = this._requireNumberArg(args, 0, 'Abs', 'x');
    const result = Math.abs(x);
    return result;
  }

  /**
   * Binary AND function
   * Lua usage: Math.And(x, y)
   */
  And(...args) {
    const x = this._requireIntegerArg(args, 0, 'And', 'x');
    const y = this._requireIntegerArg(args, 1, 'And', 'y');
    const result = x & y;
    return result;
  }

  /**
   * Binary NOT function
   * Lua usage: Math.Not(x)
   */
  Not(...args) {
    const x = this._requireIntegerArg(args, 0, 'Not', 'x');
    const result = ~x;
    return result;
  }

  /**
   * Binary OR function
   * Lua usage: Math.Or(x, y)
   */
  Or(...args) {
    const x = this._requireIntegerArg(args, 0, 'Or', 'x');
    const y = this._requireIntegerArg(args, 1, 'Or', 'y');
    const result = x | y;
    return result;
  }

  /**
   * Binary XOR function
   * Lua usage: Math.Xor(x, y)
   */
  Xor(...args) {
    const x = this._requireIntegerArg(args, 0, 'Xor', 'x');
    const y = this._requireIntegerArg(args, 1, 'Xor', 'y');
    const result = x ^ y;
    return result;
  }

  /**
   * Left shift function
   * Lua usage: Math.LShift(x, y)
   */
  LShift(...args) {
    const x = this._requireIntegerArg(args, 0, 'LShift', 'x');
    const y = this._requireIntegerArg(args, 1, 'LShift', 'y');
    const result = x << y;
    return result;
  }

  /**
   * Right shift function
   * Lua usage: Math.RShift(x, y)
   */
  RShift(...args) {
    const x = this._requireIntegerArg(args, 0, 'RShift', 'x');
    const y = this._requireIntegerArg(args, 1, 'RShift', 'y');
    const result = x >> y;
    return result;
  }

  /**
   * Random integer function
   * Lua usage: Math.Random(x, y)
   */
  Random() {
    const min = this._requireIntegerStackArg(2, 'Random', 'min');
    const max = this._requireIntegerStackArg(3, 'Random', 'max');
    if (max <= min) {
      throw new Error(`[Math] Random requires max > min (min=${min}, max=${max})`);
    }
    const result = Math.floor(Math.random() * (max - min)) + min;
    return result;
  }

  /**
   * Convert radians to degrees
   * Lua usage: Math.RadiansToDegrees(radians)
   */
  RadiansToDegrees(...args) {
    const radians = this._requireNumberArg(args, 0, 'RadiansToDegrees', 'radians');
    const result = radians * (180 / Math.PI);
    return result;
  }

  /**
   * Convert degrees to radians
   * Lua usage: Math.DegreesToRadians(degrees)
   */
  DegreesToRadians(...args) {
    const degrees = this._requireNumberArg(args, 0, 'DegreesToRadians', 'degrees');
    const result = degrees * (Math.PI / 180);
    return result;
  }
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LuaMathExtensions;
} else {
  window.LuaMathExtensions = LuaMathExtensions;
}
