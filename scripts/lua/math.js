// math.js - Math Extensions for Lua
// Provides mathematical utility functions accessible from Lua scripts

class LuaMathExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
  }

  initialize(luaState) {
    console.log('[LuaMathExtensions] Initializing Math extension...');
    
    // Note: luaState is already set by the base class setLuaState() method
    // Register all methods using the base class approach
    this.registerMethod('Sin', this.Sin.bind(this), 'Math');
    this.registerMethod('Cos', this.Cos.bind(this), 'Math');
    this.registerMethod('Sqrt', this.Sqrt.bind(this), 'Math');
    this.registerMethod('Pow', this.Pow.bind(this), 'Math');
    this.registerMethod('Atan2', this.Atan2.bind(this), 'Math');
    this.registerMethod('Min', this.Min.bind(this), 'Math');
    this.registerMethod('Max', this.Max.bind(this), 'Math');
    this.registerMethod('Clamp', this.Clamp.bind(this), 'Math');
    this.registerMethod('Ceil', this.Ceil.bind(this), 'Math');
    this.registerMethod('Floor', this.Floor.bind(this), 'Math');
    this.registerMethod('Round', this.Round.bind(this), 'Math');
    this.registerMethod('Abs', this.Abs.bind(this), 'Math');
    this.registerMethod('And', this.And.bind(this), 'Math');
    this.registerMethod('Not', this.Not.bind(this), 'Math');
    this.registerMethod('Or', this.Or.bind(this), 'Math');
    this.registerMethod('Xor', this.Xor.bind(this), 'Math');
    this.registerMethod('LShift', this.LShift.bind(this), 'Math');
    this.registerMethod('RShift', this.RShift.bind(this), 'Math');
    this.registerMethod('Random', this.Random.bind(this), 'Math');
    this.registerMethod('RadiansToDegrees', this.RadiansToDegrees.bind(this), 'Math');
    this.registerMethod('DegreesToRadians', this.DegreesToRadians.bind(this), 'Math');
    this.registerMethod('DivMod', this.DivMod.bind(this), 'Math');
    this.registerMethod('SinCos', this.SinCos.bind(this), 'Math');
    
    console.log('[LuaMathExtensions] Math extension initialized successfully');
  }

  /**
   * Sin function - uses Lua state to get parameters
   * Lua usage: Math.Sin(x)
   */
  Sin() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = Math.sin(x);
    return result;
  }

  /**
   * Cos function
   * Lua usage: Math.Cos(x)
   */
  Cos() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = Math.cos(x);
    return result;
  }

  /**
   * Square root function
   * Lua usage: Math.Sqrt(x)
   */
  Sqrt() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = Math.sqrt(x);
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
    return result;
  }

  /**
   * Ceiling function
   * Lua usage: Math.Ceil(x)
   */
  Ceil() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = Math.ceil(x);
    return result;
  }

  /**
   * Floor function
   * Lua usage: Math.Floor(x)
   */
  Floor() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = Math.floor(x);
    return result;
  }

  /**
   * Round function
   * Lua usage: Math.Round(x)
   */
  Round() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = Math.round(x);
    return result;
  }

  /**
   * Absolute value function
   * Lua usage: Math.Abs(x)
   */
  Abs() {
    const x = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = Math.abs(x);
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
    return result;
  }

  /**
   * Binary NOT function
   * Lua usage: Math.Not(x)
   */
  Not() {
    const x = parseInt(this.luaState.raw_tostring(2) || 0);
    const result = ~x;
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
    return result;
  }

  /**
   * Convert radians to degrees
   * Lua usage: Math.RadiansToDegrees(radians)
   */
  RadiansToDegrees() {
    const radians = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = radians * (180 / Math.PI);
    return result;
  }

  /**
   * Convert degrees to radians
   * Lua usage: Math.DegreesToRadians(degrees)
   */
  DegreesToRadians() {
    const degrees = parseFloat(this.luaState.raw_tostring(2) || 0);
    const result = degrees * (Math.PI / 180);
    return result;
  }

  /**
   * Division with remainder function - returns quotient and remainder
   * Lua usage: local quotient, remainder = Math.DivMod(dividend, divisor)
   */
  DivMod() {
    const dividend = parseFloat(this.luaState.raw_tostring(2) || 0);
    const divisor = parseFloat(this.luaState.raw_tostring(3) || 1);
    
    if (divisor === 0) {
      throw new Error("Division by zero in DivMod");
    }
    
    const quotient = Math.floor(dividend / divisor);
    const remainder = dividend % divisor;
    
    // Return multiple values by returning an array
    // Lua will receive this as two separate return values
    return [quotient, remainder];
  }

  /**
   * Sine and Cosine function - returns both sin and cos of angle
   * Lua usage: local sinValue, cosValue = Math.SinCos(angle)
   */
  SinCos() {
    const angle = parseFloat(this.luaState.raw_tostring(2) || 0);
    
    const sinValue = Math.sin(angle);
    const cosValue = Math.cos(angle);
    
    // Return multiple values by returning an array
    return [sinValue, cosValue];
  }
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LuaMathExtensions;
} else {
  window.LuaMathExtensions = LuaMathExtensions;
}
