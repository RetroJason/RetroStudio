// base-lua-extension.js - Base class for Lua extension classes
// Provides common functionality for registering JavaScript classes with Lua

class BaseLuaExtension {
  constructor() {
    this.luaState = null;
  }

  setLuaState(luaState) {
    this.luaState = luaState;
  }

  /**
   * Register a JavaScript method as a Lua C function
   * @param {string} luaFunctionName - Name to register in Lua
   * @param {Function} jsMethod - JavaScript method to wrap
   * @param {string} className - Class name for Lua namespace (optional)
   */
  registerMethod(luaFunctionName, jsMethod, className) {
    if (!this.luaState) {
      throw new Error('Lua state not set. Call setLuaState() first.');
    }

    const self = this;
    
    // Use the js.global approach instead of C function registration to avoid function pointer limits
    const globalFunctionName = `${luaFunctionName}_Impl`;
    
    // Create a global JavaScript function that can be called from Lua
    window[globalFunctionName] = function() {
      try {
        // Call the JavaScript method with the actual arguments passed from Lua
        const result = jsMethod.apply(self);
        
        // Return result if any
        return result;
      } catch (error) {
        console.error(`Error in Lua function ${className}.${luaFunctionName}:`, error);
        throw error;
      }
    };

   
    // Register as part of a class/namespace using Lua script
    this.luaState.execute(`
    -- Ensure class table exists
    if not ${className} then
        ${className} = {}
    end
    
    -- Register function that reads parameters from stack and calls JS implementation
    function ${className}.${luaFunctionName}(...)
        local args = {...}        
        return js.global.${globalFunctionName}(unpack(args))          
    end
    `);
   }
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BaseLuaExtension;
} else {
  window.BaseLuaExtension = BaseLuaExtension;
}
