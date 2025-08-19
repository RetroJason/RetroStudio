// math.js - Math Extensions for Lua
// Provides mathematical utility functions accessible from Lua scripts

class LuaMathExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
  }

  /**
   * Sin function - uses Lua state to get parameters
   * Lua usage: Math.Sin(x)
   */
  Sin() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = Math.sin(x);
    console.log(`[Lua Math] Sin(${x}) = ${result}`);
    return result;
  }

  /**
   * Cos function
   * Lua usage: Math.Cos(x)
   */
  Cos() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = Math.cos(x);
    console.log(`[Lua Math] Cos(${x}) = ${result}`);
    return result;
  }

  /**
   * Square root function
   * Lua usage: Math.Sqrt(x)
   */
  Sqrt() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = Math.sqrt(x);
    console.log(`[Lua Math] Sqrt(${x}) = ${result}`);
    return result;
  }

  /**
   * Power function
   * Lua usage: Math.Pow(x, y)
   */
  Pow() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const y = parseFloat(this.luaState.raw_tostring(3) || 0);
    const result = Math.pow(x, y);
    console.log(`[Lua Math] Pow(${x}, ${y}) = ${result}`);
    return result;
  }

  /**
   * Arctangent 2 function
   * Lua usage: Math.Atan2(y, x)
   */
  Atan2() {
    const y = parseFloat(this.luaState.raw_tostring(2) || 0);
    const x = parseFloat(this.luaState.raw_tostring(3) || 0);
    const result = Math.atan2(y, x);
    console.log(`[Lua Math] Atan2(${y}, ${x}) = ${result}`);
    return result;
  }

  /**
   * Minimum function
   * Lua usage: Math.Min(x, y)
   */
  Min() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const y = parseFloat(this.luaState.raw_tostring(3) || 0);
    const result = Math.min(x, y);
    console.log(`[Lua Math] Min(${x}, ${y}) = ${result}`);
    return result;
  }

  /**
   * Maximum function
   * Lua usage: Math.Max(x, y)
   */
  Max() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const y = parseFloat(this.luaState.raw_tostring(3) || 0);
    const result = Math.max(x, y);
    console.log(`[Lua Math] Max(${x}, ${y}) = ${result}`);
    return result;
  }

  /**
   * Clamp a value between minimum and maximum bounds
   * Lua usage: Math.Clamp(value, min, max)
   */
  Clamp() {
    const value = parseFloat(this.luaState.raw_tostring(2) || 0);
    const min = parseFloat(this.luaState.raw_tostring(3) || 0);
    const max = parseFloat(this.luaState.raw_tostring(4) || 100);
    
    const result = Math.min(Math.max(value, min), max);
    console.log(`[Lua Math] Clamp(${value}, ${min}, ${max}) = ${result}`);
    
    return result;
  }

  /**
   * Ceiling function
   * Lua usage: Math.Ceil(x)
   */
  Ceil() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = Math.ceil(x);
    console.log(`[Lua Math] Ceil(${x}) = ${result}`);
    return result;
  }

  /**
   * Floor function
   * Lua usage: Math.Floor(x)
   */
  Floor() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = Math.floor(x);
    console.log(`[Lua Math] Floor(${x}) = ${result}`);
    return result;
  }

  /**
   * Round function
   * Lua usage: Math.Round(x)
   */
  Round() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = Math.round(x);
    console.log(`[Lua Math] Round(${x}) = ${result}`);
    return result;
  }

  /**
   * Absolute value function
   * Lua usage: Math.Abs(x)
   */
  Abs() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = Math.abs(x);
    console.log(`[Lua Math] Abs(${x}) = ${result}`);
    return result;
  }

  /**
   * Binary AND function
   * Lua usage: Math.And(x, y)
   */
  And() {
    const x = parseInt(this.luaState.raw_tostring(2) || 0);
    const y = parseInt(this.luaState.raw_tostring(3) || 0);
    const result = x & y;
    console.log(`[Lua Math] And(${x}, ${y}) = ${result}`);
    return result;
  }

  /**
   * Binary NOT function
   * Lua usage: Math.Not(x)
   */
  Not() {
    const x = parseInt(this.luaState.raw_tostring(2) || 0);
    const result = ~x;
    console.log(`[Lua Math] Not(${x}) = ${result}`);
    return result;
  }

  /**
   * Binary OR function
   * Lua usage: Math.Or(x, y)
   */
  Or() {
    const x = parseInt(this.luaState.raw_tostring(2) || 0);
    const y = parseInt(this.luaState.raw_tostring(3) || 0);
    const result = x | y;
    console.log(`[Lua Math] Or(${x}, ${y}) = ${result}`);
    return result;
  }

  /**
   * Binary XOR function
   * Lua usage: Math.Xor(x, y)
   */
  Xor() {
    const x = parseInt(this.luaState.raw_tostring(2) || 0);
    const y = parseInt(this.luaState.raw_tostring(3) || 0);
    const result = x ^ y;
    console.log(`[Lua Math] Xor(${x}, ${y}) = ${result}`);
    return result;
  }

  /**
   * Left shift function
   * Lua usage: Math.LShift(x, y)
   */
  LShift() {
    const x = parseInt(this.luaState.raw_tostring(2) || 0);
    const y = parseInt(this.luaState.raw_tostring(3) || 0);
    const result = x << y;
    console.log(`[Lua Math] LShift(${x}, ${y}) = ${result}`);
    return result;
  }

  /**
   * Right shift function
   * Lua usage: Math.RShift(x, y)
   */
  RShift() {
    const x = parseInt(this.luaState.raw_tostring(2) || 0);
    const y = parseInt(this.luaState.raw_tostring(3) || 0);
    const result = x >> y;
    console.log(`[Lua Math] RShift(${x}, ${y}) = ${result}`);
    return result;
  }

  /**
   * Random integer function
   * Lua usage: Math.Random(x, y)
   */
  Random() {
    const min = parseInt(this.luaState.raw_tostring(2) || 0);
    const max = parseInt(this.luaState.raw_tostring(3) || 100);
    const result = Math.floor(Math.random() * (max - min)) + min;
    console.log(`[Lua Math] Random(${min}, ${max}) = ${result}`);
    return result;
  }

  /**
   * Convert radians to degrees
   * Lua usage: Math.RadiansToDegrees(radians)
   */
  RadiansToDegrees() {
    const radians = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = radians * (180 / Math.PI);
    console.log(`[Lua Math] RadiansToDegrees(${radians}) = ${result}`);
    return result;
  }

  /**
   * Convert degrees to radians
   * Lua usage: Math.DegreesToRadians(degrees)
   */
  DegreesToRadians() {
    const degrees = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = degrees * (Math.PI / 180);
    console.log(`[Lua Math] DegreesToRadians(${degrees}) = ${result}`);
    return result;
  }
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LuaMathExtensions;
} else {
  window.LuaMathExtensions = LuaMathExtensions;
}
