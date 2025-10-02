// system.js - System Extensions for Lua
// Provides system-related functions accessible from Lua scripts

class LuaSystemExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
  }

  initialize(luaState) {
    console.log('[LuaSystemExtensions] Initializing System extension...');
    
    // Note: luaState is already set by the base class setLuaState() method
    
    // Register all system methods using the base class approach
    this.registerMethod('LogLua', this.LogLua.bind(this), 'System');
    this.registerMethod('GetTime', this.GetTime.bind(this), 'System');
    this.registerMethod('Log', this.Log.bind(this), 'System');
    this.registerMethod('GetOS', this.GetOS.bind(this), 'System');
    this.registerMethod('GetVersion', this.GetVersion.bind(this), 'System');
    this.registerMethod('Exit', this.Exit.bind(this), 'System');
    this.registerMethod('SetClipboard', this.SetClipboard.bind(this), 'System');
    this.registerMethod('GetClipboard', this.GetClipboard.bind(this), 'System');
    
    console.log('[LuaSystemExtensions] System extension initialized successfully');
  }

  // Add the missing methods with basic implementations
  GetTime() {
    return Date.now();
  }

  Log() {
    const message = this.luaState.raw_tostring(2);
    console.log('[System]', message);
  }

  GetOS() {
    return navigator.platform || 'Unknown';
  }

  GetVersion() {
    return '1.0.0';
  }

  Exit() {
    console.log('[System] Exit requested');
  }

  SetClipboard() {
    const text = this.luaState.raw_tostring(2);
    console.log('[System] SetClipboard:', text);
  }

  GetClipboard() {
    return 'clipboard content';
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
