// Load Lua chunks from the heap instead of the stack.
//
// WHY THIS FILE EXISTS
//
// lua.vm.js is built by scripts/external/lua53/build.sh, which compiles the
// firmware's Lua with emcc and appends scripts/external/lua53/glue.js as
// --post-js. The fix below is already in glue.js, so a rebuild makes this file
// redundant. But rebuilding needs emsdk and the firmware's librw/lua tree, the
// committed lua.vm.js is minified past the point of surgical patching, and the
// bug stops any large cart from running at all - so the fix is also applied
// here, at runtime, against the artifact we actually ship.
//
// THE BUG
//
// glue.js used to compile a chunk like this:
//
//   var chars = emscripten.intArrayFromString(code, true);
//   this.loadbufferx(chars, chars.length, name, mode)
//
// where loadbufferx is cwrap'd with an "array" argument type. cwrap marshals
// "array" by stack-allocating it. The emscripten stack is 64KB, so any chunk
// larger than that failed inside writeArrayToMemory with
//
//   RangeError: offset is out of bounds
//
// before Lua ever saw a byte of the source. RetroStudio reported that as
// "Script Loading Error ... this usually indicates a syntax error in your Lua
// code", which sends you looking in entirely the wrong place - the script is
// fine, it is simply too big to hand over.
//
// Big PICO-8 carts hit the ceiling easily. POOM's title cart on its own
// transpiles to about 102,000 characters.
//
// THE FIX
//
// Copy the chunk to the heap and pass a plain pointer. build.sh already exports
// _malloc, _free and HEAPU8, so nothing about the build has to change.
(function () {
  'use strict';

  var Lua = window.Lua;
  var em = window.emscripten;

  if (!Lua || !Lua.State || !em) {
    console.warn('[LuaVM] large-chunk-load: Lua VM not present, chunk loading left as built');
    return;
  }

  // A rebuilt lua.vm.js carries the fix in glue.js, and both loaders inject
  // this file, so bail out rather than wrapping twice.
  if (Lua.State.prototype.loadbufferptr || Lua.State.prototype.__rsHeapChunkLoad) {
    return;
  }

  if (typeof em._malloc !== 'function' || typeof em._free !== 'function') {
    console.warn('[LuaVM] large-chunk-load: malloc/free not exported, chunk loading left as built');
    return;
  }

  var loadbufferptr = em.cwrap(
    'luaL_loadbufferx', 'number',
    ['number', 'number', 'number', 'string', 'string'],
  );

  Lua.State.prototype.load = function (code, name, mode) {
    var chars = em.intArrayFromString(code, true);
    var len = chars.length;

    var ptr = em._malloc(len);
    if (ptr === 0) {
      throw new Error('[LuaVM] out of memory loading a ' + len + ' byte chunk');
    }

    try {
      // Read HEAPU8 after the malloc: growing the heap replaces the view.
      em.HEAPU8.set(chars, ptr);
      if (loadbufferptr(this._L, ptr, len, name, mode) !== 0) {
        throw new Lua.Error(this, -1);
      }
    } finally {
      // Lua has copied what it needs by now, on both the success and error path.
      em._free(ptr);
    }

    var r = new Lua.Proxy(this, -1);
    this.pop(1);
    return r;
  };

  Lua.State.prototype.__rsHeapChunkLoad = true;
})();
