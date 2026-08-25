#!/usr/bin/env bash
#
# Build scripts/external/lua-vm/lua.vm.js from the FIRMWARE's own Lua sources.
#
# Why not a vendored copy of stock Lua: the simulator and the watch must run the
# same dialect. The firmware's tree (librw/lua) is Lua 5.3.5 with LUA_32BITS
# enabled in luaconf.h, which makes lua_Integer a 32-bit int and lua_Number a
# single-precision float. A stock 5.3.5 build would use 64-bit ints and doubles
# and quietly diverge in precision, overflow and number formatting. Building
# from librw/lua means parity holds by construction, including which standard
# libraries linit.c registers (_G, coroutine, table, string, bit32 - NOT math,
# os, io, debug, package or utf8).
#
# -sWASM=0 is deliberate. The page loads this file with a plain <script> tag and
# calls new Lua.State() straight after onload, so the runtime has to be ready
# synchronously. A wasm build instantiates asynchronously, and synchronous
# compilation is capped at 4KB on the browser main thread, so wasm would require
# changing every call site. wasm2js keeps this a drop-in replacement.
#
# Usage:  ./build.sh            (expects emsdk activated, or at ~/emsdk)
#         LUA_SRC=/path/to/lua ./build.sh

set -euo pipefail

# RS_DIR, not DIR: sourcing emsdk_env.sh below overwrites a variable named DIR.
RS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LUA_SRC="${LUA_SRC:-$RS_DIR/../../../../../../librw/lua}"
OUT="$RS_DIR/../lua-vm/lua.vm.js"

if ! command -v emcc >/dev/null 2>&1; then
  if [ -f "$HOME/emsdk/emsdk_env.sh" ]; then
    # shellcheck disable=SC1091
    EMSDK_QUIET=1 source "$HOME/emsdk/emsdk_env.sh"
  else
    echo "emcc not found and no emsdk at ~/emsdk" >&2
    exit 1
  fi
fi

if [ ! -f "$LUA_SRC/lua.h" ]; then
  echo "Lua sources not found at: $LUA_SRC" >&2
  echo "Set LUA_SRC to the firmware's lua directory (librw/lua)." >&2
  exit 1
fi

VER=$(sed -n 's/.*LUA_VERSION_RELEASE[[:space:]]*"\([0-9]*\)".*/\1/p' "$LUA_SRC/lua.h" | head -1)
MIN=$(sed -n 's/.*LUA_VERSION_MINOR[[:space:]]*"\([0-9]*\)".*/\1/p' "$LUA_SRC/lua.h" | head -1)
echo "Building from Lua 5.$MIN.$VER at $LUA_SRC"
grep -q '^#define LUA_32BITS' "$LUA_SRC/luaconf.h" \
  && echo "LUA_32BITS: on (32-bit int, single-precision float) - matches firmware" \
  || echo "WARNING: LUA_32BITS is NOT set - this build will NOT match firmware numerics" >&2

# Everything except the standalone interpreter, the compiler driver and the
# internal test harness.
SRCS=$(find "$LUA_SRC" -maxdepth 1 -name '*.c' \
  ! -name 'lua.c' ! -name 'luac.c' ! -name 'ltests.c' | sort)

# lua_remove is a macro in 5.3; shim.c gives it a real symbol.
#
# lua_pushinteger/lua_tointegerx are here because PICO-8 numbers are 16.16 fixed
# point: 32 significant bits, which a float32 lua_Number cannot hold. The cart
# lowering represents them as lua_Integer instead, which LUA_32BITS makes a
# true int32 and therefore an exact container. Reading one back through
# lua_tonumberx would convert it to float32 and undo that, so the bridge needs
# the integer accessors. Purely additive: no existing numeric behaviour changes.
EXPORTED_FUNCTIONS="_luaL_checkudata,_luaL_loadbufferx,_luaL_newmetatable,_luaL_newstate,_luaL_openlibs,_luaL_ref,_luaL_setmetatable,_luaL_testudata,_luaL_tolstring,_luaL_traceback,_luaL_unref,_lua_checkstack,_lua_createtable,_lua_error,_lua_gc,_lua_getfield,_lua_getglobal,_lua_gettable,_lua_gettop,_lua_newuserdata,_lua_pcallk,_lua_pushboolean,_lua_pushcclosure,_lua_pushinteger,_lua_pushlightuserdata,_lua_pushlstring,_lua_pushnil,_lua_pushnumber,_lua_pushvalue,_lua_rawgeti,_lua_setfield,_lua_setglobal,_lua_setmetatable,_lua_settable,_lua_settop,_lua_toboolean,_lua_tointegerx,_lua_tolstring,_lua_tonumberx,_lua_tothread,_lua_touserdata,_lua_type,_lua_typename,_rs_lua_remove,_malloc,_free"

EXPORTED_RUNTIME_METHODS="cwrap,ccall,getValue,setValue,addFunction,removeFunction,intArrayFromString,UTF8ToString,stringToUTF8,stackAlloc,stackSave,stackRestore,HEAPU8,HEAP32"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# LUA_COMPAT_5_2 matches the firmware archive, which has luaopen_bit32 compiled
# in (verified with nm); linit.c registers bit32 unconditionally.
# shellcheck disable=SC2086
emcc \
  -Os \
  -DLUA_COMPAT_5_2 \
  -I"$LUA_SRC" \
  $SRCS \
  "$RS_DIR/shim.c" \
  -o "$TMP/vm.js" \
  -sWASM=0 \
  -sWASM_ASYNC_COMPILATION=0 \
  -sINVOKE_RUN=0 \
  -sEXIT_RUNTIME=0 \
  -sINITIAL_MEMORY=33554432 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sALLOW_TABLE_GROWTH=1 \
  -sEXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
  -sEXPORTED_RUNTIME_METHODS="$EXPORTED_RUNTIME_METHODS" \
  --post-js "$RS_DIR/glue.js" \
  --embed-file "$RS_DIR/js.lua"@js.lua

# Wrap so the module exposes itself the way the page expects: window.Lua in the
# browser, module.exports under node. Mirrors the wrapper the original
# lua.vm.js Makefile emitted.
{
  echo "!(function(exports){var module;"
  cat "$TMP/vm.js"
  echo ";exports['emscripten'] = Module;})(typeof module !== 'undefined'?module.exports:this);"
} > "$OUT"

echo "Wrote $OUT ($(wc -c < "$OUT") bytes)"
