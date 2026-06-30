// base-lua-extension.js - Base class for Lua extension classes
// Provides common functionality for registering JavaScript classes with Lua

class BaseLuaExtension {
  constructor() {
    this.luaState = null;
    this.gameEmulator = null;
  }

  setLuaState(luaState) {
    this.luaState = luaState;
  }

  _coerceBooleanArg(raw, methodName, argName) {
    if (typeof raw === 'boolean') {
      return raw;
    }

    if (typeof raw === 'string') {
      const normalized = raw.toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === '0') {
        return false;
      }
    }

    throw new Error(`${methodName} invalid boolean argument ${argName}: ${raw}`);
  }

  _optionalBooleanArg(args, index, defaultValue, methodName, argName) {
    const stackIndex = index + 2;
    if (this.luaState?.type?.(stackIndex) === 1) {
      return this.luaState.toboolean(stackIndex) !== 0;
    }

    const raw = args[index] ?? this.luaState?.raw_tostring?.(stackIndex);
    if (raw === undefined || raw === null || raw === '') {
      return defaultValue;
    }

    return this._coerceBooleanArg(raw, methodName, argName);
  }

  _requireBooleanStackArg(stackIndex, methodName, argName) {
    if (this.luaState?.type?.(stackIndex) === 1) {
      return this.luaState.toboolean(stackIndex) !== 0;
    }

    const raw = this.luaState?.raw_tostring?.(stackIndex);
    if (raw === undefined || raw === null || raw === '') {
      throw new Error(`${methodName} missing required boolean argument: ${argName}`);
    }

    return this._coerceBooleanArg(raw, methodName, argName);
  }

  _getGameEmulator() {
    return this.gameEmulator || null;
  }

  _getService(name) {
    const emulator = this._getGameEmulator();
    if (emulator && typeof emulator.getService === 'function') {
      const service = emulator.getService(name);
      if (service) {
        return service;
      }
    }

    return null;
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
    // Make global function name unique by including className
    const globalFunctionName = `${className}_${luaFunctionName}_Impl`;
    
    // Create a global JavaScript function that can be called from Lua
    window[globalFunctionName] = function() {
      try {
        const enableLuaBridgeLogs = window.__RETRO_LUA_BRIDGE_LOGS__ !== false;
        if (enableLuaBridgeLogs) {
          const argPreview = Array.from(arguments).map((arg) => {
            if (arg === null) return 'null';
            if (arg === undefined) return 'undefined';
            if (typeof arg === 'string') return `"${arg}"`;
            if (typeof arg === 'object') return `[object ${arg?.constructor?.name || 'Object'}]`;
            return String(arg);
          }).join(', ');
          console.log(`[LuaBridge] ${className}.${luaFunctionName}(${argPreview})`);
        }

        // Get the arguments passed from Lua and call the JavaScript method
        const result = jsMethod.apply(self, arguments);
        
        // Return result if any
        return result;
      } catch (error) {
        console.error(`Error in Lua function ${className}.${luaFunctionName}:`, error);
        throw error;
      }
    };

   
    const isPico8TableHelper = className === 'Pico8' && ['add', 'del', 'count', 'all', 'foreach'].includes(luaFunctionName);

    if (isPico8TableHelper) {
      const luaHelperImplementations = {
      add: `
    function Pico8.add(t, v, i)
      if i ~= nil then
        table.insert(t, i, v)
      else
        table.insert(t, v)
      end
      return v
    end
    add = Pico8.add
      `,
      del: `
    function Pico8.del(t, v)
      for i = 1, #t do
        if t[i] == v then
          table.remove(t, i)
          return v
        end
      end
      return nil
    end
    del = Pico8.del
      `,
      count: `
    function Pico8.count(t)
      return #t
    end
    count = Pico8.count
      `,
      all: `
    function Pico8.all(t)
      local i = 0
      return function()
        i = i + 1
        return t[i]
      end
    end
    all = Pico8.all
      `,
      foreach: `
    function Pico8.foreach(t, f)
      for i = 1, #t do
        f(t[i])
      end
    end
    foreach = Pico8.foreach
      `,
      };

      this.luaState.execute(`
    if not Pico8 then
      Pico8 = {}
    end
    ${luaHelperImplementations[luaFunctionName]}
      `);
      return;
    }

    const registerGlobalAlias = className === 'Pico8'
      ? `
    -- Pico-8 compatibility: expose function as a Lua global
    -- NOTE: js.global.fn(a, b, ...) consumes the first argument as the JS
    -- "this" receiver, so we pass js.null as a dummy receiver to forward all
    -- real arguments intact.
    function ${luaFunctionName}(...)
        return js.global.${globalFunctionName}(js.null, unpack({...}))
    end
    `
      : '';

    // Register as part of a class/namespace using Lua script
    this.luaState.execute(`
    -- Ensure class table exists
    if not ${className} then
        ${className} = {}
    end
    
    -- Register function that reads parameters from stack and calls JS implementation
    -- NOTE: js.global.fn(a, b, ...) consumes the first argument as the JS "this"
    -- receiver, so we pass js.null as a dummy receiver to forward all real
    -- arguments intact.
    function ${className}.${luaFunctionName}(...)
        local args = {...}
        return js.global.${globalFunctionName}(js.null, unpack(args))
    end
    ${registerGlobalAlias}
    `);
   }
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BaseLuaExtension;
} else {
  window.BaseLuaExtension = BaseLuaExtension;
}
