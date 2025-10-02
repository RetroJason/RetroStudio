// base-lua-extension.js - Base class for Lua extension classes
// Provides common functionality for registering JavaScript classes with Lua

class BaseLuaExtension {
  constructor() {
    this.luaState = null;
  }

  setLuaState(luaState) {
    this.luaState = luaState;
    
    // Automatically call initialize() if it exists to register all methods
    if (typeof this.initialize === 'function') {
      this.initialize(luaState);
    }
  }

  /**
   * Register a JavaScript method as a Lua C function using stack-based approach
   * @param {string} luaFunctionName - Name to register in Lua
   * @param {Function} jsMethod - JavaScript method to wrap (should read from this.luaState stack)
   * @param {string} className - Class name for Lua namespace (optional)
   */
  registerMethod(luaFunctionName, jsMethod, className) {
    if (!this.luaState) {
      throw new Error('Lua state not set. Call setLuaState() first.');
    }

    const self = this;
    
    // Make global function name unique by including className
    const globalFunctionName = `${className}_${luaFunctionName}_Impl`;
    
    // Create a global JavaScript function that can be called from Lua
    window[globalFunctionName] = function() {
      try {
        // Call the JavaScript method - it will read from this.luaState stack
        const result = jsMethod.call(self);
        
        // Return result if any
        return result;
      } catch (error) {
        console.error(`Error in Lua function ${className}.${luaFunctionName}:`, error);
        throw error;
      }
    };

   
    // Register as part of a class/namespace using Lua script with generic multiple return value handling
    this.luaState.execute(`
    -- Ensure class table exists
    if not ${className} then
        ${className} = {}
    end
    
    -- Register function with automatic multiple return value unpacking
    function ${className}.${luaFunctionName}(...)
        local args = {...}
        -- Call the implementation (arguments are on the stack for stack-based functions)
        local result = js.global.${globalFunctionName}(unpack(args))
        
        -- Check if result is an array/userdata that should be unpacked into multiple return values
        if result and type(result) == "userdata" then
            -- Try to determine if this is an array by checking for numeric indices
            local values = {}
            local hasArrayElements = false
            
            -- Check both 0-based (JavaScript) and 1-based (Lua) indexing
            for i = 0, 10 do  -- Check first 11 elements (0-10)
                if result[i] ~= nil then
                    table.insert(values, result[i])
                    hasArrayElements = true
                end
            end
            
            -- If we found array elements with 0-based indexing, return them unpacked
            if hasArrayElements and #values > 1 then
                return unpack(values)
            elseif hasArrayElements and #values == 1 then
                return values[1]
            end
            
            -- Try 1-based indexing if 0-based didn't work
            values = {}
            hasArrayElements = false
            for i = 1, 11 do  -- Check elements 1-11
                if result[i] ~= nil then
                    table.insert(values, result[i])
                    hasArrayElements = true
                end
            end
            
            if hasArrayElements and #values > 1 then
                return unpack(values)
            elseif hasArrayElements and #values == 1 then
                return values[1]
            end
        end
        
        -- For non-arrays or single values, return as-is
        return result
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
