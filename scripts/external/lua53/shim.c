/*
** Real functions for Lua 5.3 API macros that the JavaScript glue needs to
** cwrap. In Lua 5.2 these were exported functions; 5.3 turned several of them
** into macros over lua_rotate/lua_copy, so there is no symbol left to export
** and cwrap('lua_remove') would fail to link.
**
** Keep this file as small as possible - anything added here is a divergence
** from the firmware's own Lua build.
*/

#include "lua.h"

void rs_lua_remove(lua_State *L, int idx) {
  lua_remove(L, idx);
}
