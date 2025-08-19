// math.js - Math Extensions for Lua
// Provides mathematical utility functions accessible from Lua scripts

class LuaMathExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
  }

  /**
   * Clamp a value between minimum and maximum bounds
   * Lua usage: Math.Clamp(value, min, max)
   */
  Clamp() {
    // For the js.global approach, we need to get parameters from the Lua stack differently
    // This is a simplified version - in practice, we'd need access to the Lua state
    // For now, let's use a different approach via arguments
    const value = parseFloat(arguments[0] || 0);
    const min = parseFloat(arguments[1] || 0);
    const max = parseFloat(arguments[2] || 100);
    
    const result = Math.min(Math.max(value, min), max);
    console.log(`[Lua Math] Clamp(${value}, ${min}, ${max}) = ${result}`);
    
    return result;
  }
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LuaMathExtensions;
} else {
  window.LuaMathExtensions = LuaMathExtensions;
}
