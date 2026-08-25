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

        // An extension whose numbers are a scaled representation has to scale
        // its results back on the way out, because everything inside the JS
        // method worked in ordinary values. Only PICO-8 sets this, so no other
        // extension's return path changes. Rounding to an exact integer here is
        // what lets Lua.State.push hand it over as a lua_Integer, which is the
        // only container that holds all 32 significant bits.
        if (self.fixedPointNumbers === true && typeof result === 'number') {
          return Math.round(result * 65536) | 0;
        }

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
    //  - split() builds a table too, and pack()/unpack() convert between a
    //    table and Lua multiple returns, which the bridge cannot express;
    //  - the coroutine helpers must yield across their own call frame, and a
    //    yield cannot cross a C/JS boundary ("attempt to yield across a
    //    C-call boundary").
    // Both are implemented directly in Lua instead.
    //
    // sub() and ord() are here for a different reason: SPEED. Every Lua string
    // argument is copied out of the VM and decoded into a JS string on its way
    // across the bridge, so a call that inspects one byte still costs time
    // proportional to the whole string. Measured: ord() on a 4-char string is
    // 2.9us, on an 8KB string 30.8us. Carts pack data into long strings and
    // unpack them a byte at a time, which turns that into whole frames -
    // POOM's title screen spent 250ms of a 300ms frame inside 8192 ord() calls
    // on one 8KB string. string.byte/string.sub do the same job without
    // leaving the VM, and cost the same whatever the string's length.
    const isPico8LuaNative = className === 'Pico8'
      && ['add', 'del', 'deli', 'count', 'all', 'foreach', 'inext', 'split', 'pack', 'unpack',
        'sub', 'ord',
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
      deli: `
    function Pico8.deli(t, i)
      if t == nil then return nil end
      -- Defaults to the last element, like table.remove.
      if i == nil then i = #t end
      -- table.remove raises on an out of range index; PICO-8 returns nil.
      if i < 1 or i > #t then return nil end
      return table.remove(t, i)
    end
    deli = Pico8.deli
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
      inext: `
    -- The stateless iterator behind ipairs, exposed as a global by PICO-8 but
    -- not by stock Lua. Carts use it directly as "for i,v in inext,t do", which
    -- is a token cheaper than ipairs(t) and skips a closure per loop.
    function Pico8.inext(t, i)
      if t == nil then return nil end
      -- The generic for passes nil as the initial control value.
      i = (i or 0) + 1
      local v = t[i]
      if v == nil then return nil end
      return i, v
    end
    inext = Pico8.inext
      `,
      split: `
    -- Elements convert to numbers by default, so split("1,2,3") gives numbers
    -- and split("1,2,3", ",", false) gives strings. Anything that is not
    -- wholly numeric stays a string either way.
    local function __splitElement(text, convert)
      if convert then
        local n = tonumber(text)
        if n ~= nil then return n end
      end
      return text
    end

    function Pico8.split(s, separator, convert)
      local out = {}
      if s == nil then return out end
      s = tostring(s)
      -- Defaults, but an explicit false must stay false.
      if convert == nil then convert = true end

      -- A numeric separator means "cut into groups of n characters" rather
      -- than "look for this delimiter". An empty delimiter means the same as 1:
      -- carts pack lookup tables into a string of glyphs and unpack them with
      -- split(s, ""), so returning nothing there loses the whole table.
      if separator == "" then separator = 1 end
      if type(separator) == "number" then
        -- No math.floor: the firmware does not register the math library.
        local size = separator - separator % 1
        if size < 1 then return out end
        local i = 1
        while i <= #s do
          out[#out + 1] = __splitElement(string.sub(s, i, i + size - 1), convert)
          i = i + size
        end
        return out
      end

      if separator == nil then separator = "," end
      separator = tostring(separator)

      local start = 1
      while true do
        -- Plain find: a delimiter such as "." is a literal, not a pattern.
        local from, to = string.find(s, separator, start, true)
        if from == nil then
          out[#out + 1] = __splitElement(string.sub(s, start), convert)
          return out
        end
        out[#out + 1] = __splitElement(string.sub(s, start, from - 1), convert)
        start = to + 1
      end
    end
    split = Pico8.split
      `,
      sub: `
    -- Lua's own string.sub already has PICO-8's index rules, negative offsets
    -- from the end included, so this is a thin argument-tidying wrapper.
    -- No math.floor: the firmware does not register the math library, and
    -- Lua's % is a floored modulo, so v - v % 1 is exactly floor(v).
    function Pico8.sub(s, i, j)
      if s == nil then return "" end
      if type(s) ~= "string" then s = tostring(s) end
      if i == nil then i = 1 end
      i = i - i % 1
      if j == nil then return string.sub(s, i) end
      j = j - j % 1
      return string.sub(s, i, j)
    end
    sub = Pico8.sub
      `,
      ord: `
    -- Note the third argument is a COUNT, not an end index as in Lua's
    -- string.byte(s, i, j): ord("abc", 2, 2) yields 98, 99.
    function Pico8.ord(s, index, num)
      if s == nil then return nil end
      if type(s) ~= "string" then s = tostring(s) end
      if index == nil then index = 1 end
      index = index - index % 1
      -- Out of range reads are nil in PICO-8, not an error. Index 0 and below
      -- are out of range rather than counting from the end, which is where
      -- this parts company with string.byte. The upper bound is checked here
      -- too: string.byte would return NO values, and zero values is not the
      -- same as nil to a caller that passes the result straight on.
      if index < 1 or index > #s then return nil end
      -- A bare ord() is single-valued even when more characters are available.
      if num == nil then return string.byte(s, index) end
      num = num - num % 1
      if num < 1 then return nil end
      -- string.byte clamps the end index to #s, so a short tail returns fewer
      -- values rather than padding with nil.
      return string.byte(s, index, index + num - 1)
    end
    ord = Pico8.ord
      `,
      pack: `
    function Pico8.pack(...)
      -- Sets the field n, so a trailing nil is still counted.
      return table.pack(...)
    end
    pack = Pico8.pack
      `,
      unpack: `
    function Pico8.unpack(t, i, j)
      -- PICO-8 exposes the 5.1 spelling as a global. This VM is 5.3, where the
      -- bare global is gone and only table.unpack exists.
      if t == nil then return end
      return table.unpack(t, i or 1, j or #t)
    end
    unpack = Pico8.unpack
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
    ${BaseLuaExtension.JS_RESULT_LUA}

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

// Everything a JS return value has to go through on its way into Lua.
//
// Kept as a constant rather than inlined in the template above so a test can
// run this exact source through a real Lua VM. A mock luaState only records
// the string, so a syntax error in it would otherwise surface as a broken cart.
BaseLuaExtension.JS_RESULT_LUA = `
    if not __retroExpandJsResult then
        -- table.unpack, not the bare unpack: that global is a 5.1 leftover that
        -- only exists under LUA_COMPAT_UNPACK, and the VM is now 5.3 built to
        -- match the firmware, where it is nil.
        local __unpack = table.unpack or unpack

        -- 32-bit because the VM is built with LUA_32BITS to match the firmware.
        local __intMin, __intMax = -2147483648, 2147483647

        -- A JS function can only return one value, so multi-return API functions
        -- (Image.GetSize, Sprite.GetXY, ...) hand back a JS array. That arrives in
        -- Lua as a single 0-indexed userdata proxy, so "local w, h = ..." used to
        -- put the proxy in w and nil in h. Expand array-like results back into
        -- real Lua multiple returns.
        function __retroExpandJsResult(result)
            local kind = type(result)

            -- Every JS number crosses as a Lua float, so flr(7/2) stringified
            -- as "3.0" and a cart writing "lv"..flr(n) drew a stray .0 on
            -- screen. PICO-8 has no integer/float split to reproduce, so fold
            -- whole numbers back to the integer subtype. The range test runs
            -- first because it also rejects inf and nan, which have no integer
            -- representation for | to convert to.
            if kind == 'number' then
                if result >= __intMin and result <= __intMax and result % 1 == 0 then
                    return result | 0
                end
                return result
            end

            if kind ~= 'userdata' then return result end
            local length = result.length
            if type(length) ~= 'number' then return result end
            local values = {}
            for i = 1, length do values[i] = result[i - 1] end
            return __unpack(values, 1, length)
        end
    end
`;

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BaseLuaExtension;
} else {
  window.BaseLuaExtension = BaseLuaExtension;
}
