// system.js - System Extensions for Lua
// Provides system-related functions accessible from Lua scripts

class LuaSystemExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
  }

  /**
   * Log a message from Lua to the console
   * Lua usage: System.LogLua("Hello World")
   */
  LogLua() {
    const message = this.luaState.raw_tostring(2);
    console.log('[Lua System]', message);
  }
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LuaSystemExtensions;
} else {
  window.LuaSystemExtensions = LuaSystemExtensions;
}
