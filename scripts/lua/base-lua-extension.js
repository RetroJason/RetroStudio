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
        // Opt-in: this logs on every single API call, so with the bridge no
        // longer dominated by js.global lookups it is the next bottleneck.
        // Set window.__RETRO_LUA_BRIDGE_LOGS__ = true to trace calls.
        if (window.__RETRO_LUA_BRIDGE_LOGS__ === true) {
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

    // Some PICO-8 builtins cannot go through the JS bridge at all:
    //  - the table helpers take and return Lua tables, which would have to be
    //    marshalled both ways on every call;
    //  - the coroutine helpers must yield across their own call frame, and a
    //    yield cannot cross a C/JS boundary ("attempt to yield across a
    //    C-call boundary").
    // Both are implemented directly in Lua instead.
    const isPico8LuaNative = className === 'Pico8'
      && ['add', 'del', 'count', 'all', 'foreach',
        'cocreate', 'coresume', 'costatus', 'cowrap', 'yield'].includes(luaFunctionName);

    if (isPico8LuaNative) {
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
      -- PICO-8 tolerates all(nil); it yields an iterator that stops immediately.
      if t == nil then return function() end end
      local i, prev = 1, nil
      return function()
        -- PICO-8 guarantees del() on the current item is safe mid-loop. When
        -- that happens the table shifts down, so t[i] is already the next
        -- item and the cursor must not advance.
        if t[i] == prev then i = i + 1 end
        prev = t[i]
        return prev
      end
    end
    all = Pico8.all
      `,
      foreach: `
    function Pico8.foreach(t, f)
      -- PICO-8 defines foreach in terms of all(), so the callback removing the
      -- current item is safe. A numeric loop would cache #t and then read past
      -- the shrunken table, handing the callback a nil.
      for v in Pico8.all(t) do
        f(v)
      end
    end
    foreach = Pico8.foreach
      `,
      cocreate: `
    function Pico8.cocreate(f)
      return coroutine.create(f)
    end
    cocreate = Pico8.cocreate
      `,
      coresume: `
    function Pico8.coresume(c, ...)
      return coroutine.resume(c, ...)
    end
    coresume = Pico8.coresume
      `,
      costatus: `
    function Pico8.costatus(c)
      -- PICO-8 reports a dead coroutine for anything that is not a live one,
      -- so carts can call costatus() on a nil-ed out handle.
      if type(c) ~= "thread" then return "dead" end
      return coroutine.status(c)
    end
    costatus = Pico8.costatus
      `,
      cowrap: `
    function Pico8.cowrap(f)
      return coroutine.wrap(f)
    end
    cowrap = Pico8.cowrap
      `,
      yield: `
    function Pico8.yield(...)
      return coroutine.yield(...)
    end
    yield = Pico8.yield
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
        ${luaFunctionName} = ${className}.${luaFunctionName}
    `
      : '';

    // A few PICO-8 builtins accept either a number or a table. A table cannot
    // cross the JS bridge (see the note above - it arrives as the string
    // "table: 0x..."), so the table case is answered in Lua and everything
    // else is forwarded to the JS implementation that was just registered.
    const luaArgumentAdapters = {
      rnd: `
        local __rndNative = ${className}.${luaFunctionName}
        function ${className}.${luaFunctionName}(x)
          -- rnd(t) returns one of the table's elements rather than a number.
          -- An empty table gives nil, like an out of range index would.
          if type(x) == "table" then
            local n = #x
            if n == 0 then return nil end
            -- Floored without math.floor: the firmware's linit.c does not
            -- register the math library, so it is nil here too. Lua's % is a
            -- floored modulo, which makes v - v % 1 exactly floor(v).
            local v = __rndNative(n)
            return x[(v - v % 1) + 1]
          end
          return __rndNative(x)
        end
      `,
    };

    const registerArgumentAdapter = className === 'Pico8'
      ? (luaArgumentAdapters[luaFunctionName] || '')
      : '';

    // Register as part of a class/namespace using Lua script
    this.luaState.execute(`
    -- A JS function can only return one value, so multi-return API functions
    -- (Image.GetSize, Sprite.GetXY, ...) hand back a JS array. That arrives in
    -- Lua as a single 0-indexed userdata proxy, so "local w, h = ..." used to
    -- put the proxy in w and nil in h. Expand array-like results back into
    -- real Lua multiple returns.
    if not __retroExpandJsResult then
        -- table.unpack, not the bare unpack: that global is a 5.1 leftover that
        -- only exists under LUA_COMPAT_UNPACK, and the VM is now 5.3 built to
        -- match the firmware, where it is nil.
        local __unpack = table.unpack or unpack
        function __retroExpandJsResult(result)
            if type(result) ~= 'userdata' then return result end
            local length = result.length
            if type(length) ~= 'number' then return result end
            local values = {}
            for i = 1, length do values[i] = result[i - 1] end
            return __unpack(values, 1, length)
        end
    end

    -- Ensure class table exists
    if not ${className} then
        ${className} = {}
    end

    -- Register function that reads parameters from stack and calls JS implementation
    -- NOTE: js.global.fn(a, b, ...) consumes the first argument as the JS "this"
    -- receiver, so we pass js.null as a dummy receiver to forward all real
    -- arguments intact.
    --
    -- PERF: reading js.global.<name> goes through the emscripten js library's
    -- __index metamethod, which builds a fresh userdata proxy on every access
    -- and costs ~0.93ms. Doing that per call capped the whole API at ~2000
    -- calls/second (windy ran at 1fps). Resolving it once into an upvalue
    -- drops a call to ~0.0024ms, a ~380x speedup.
    do
        local __impl = js.global.${globalFunctionName}
        local __null = js.null
        function ${className}.${luaFunctionName}(...)
            return __retroExpandJsResult(__impl(__null, ...))
        end
        ${registerArgumentAdapter}
        ${registerGlobalAlias}
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
