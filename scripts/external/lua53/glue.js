!(function(exports, global, emscripten){
/* Modern-Emscripten compatibility.
**
** This glue was written against the 2016-era Emscripten runtime. Two things it
** relies on have since moved:
**   - Runtime.addFunction(fn) now lives on the module and requires an explicit
**     wasm signature. Every function added here is a lua_CFunction, that is
**     int (*)(lua_State *), so the signature is always "ii".
**   - allocate(n, type, ALLOC_STACK) is gone in favour of stackAlloc.
** Shimming addFunction in one place keeps the eight call sites below untouched.
*/
if (!emscripten.Runtime) {
	emscripten.Runtime = {
		addFunction: function (fn) { return emscripten.addFunction(fn, "ii"); },
		removeFunction: function (ptr) { return emscripten.removeFunction(ptr); }
	};
}
/* Utility functions */
var slice = [].slice;
var apply = (function(){}).apply;

// applying arguments to new isn't easy with js.....
function new_(a, b, c, d, e, f, g, h, i) {
	switch (arguments.length) {
		case 0: return new this();
		case 1: return new this(a);
		case 2: return new this(a, b);
		case 3: return new this(a, b, c);
		case 4: return new this(a, b, c, d);
		case 5: return new this(a, b, c, d, e);
		case 6: return new this(a, b, c, d, e, f);
		case 7: return new this(a, b, c, d, e, f, g);
		case 8: return new this(a, b, c, d, e, f, g, h);
		case 9: return new this(a, b, c, d, e, f, g, h, i);
		default:
			// Attempt the theorectically equivalent way
			// Native objects often detect this and throw;
			// luckily there aren't many native objects that take >9 arguments; so this case is rare
			var obj = Object.create(this.prototype);
			var ret = apply.call(this, obj, arguments);
			return ((typeof ret === 'object' && ret !== null) || typeof ret === 'function')?ret:obj;
	}
}

/* */
var Lua = exports.Lua = {
	"defines": {
		"REGISTRYINDEX": /*FIRSTPSEUDOIDX*/ ( - /*LUAI_MAXSTACK*/1000000 - 1000 ),
		"RIDX_GLOBALS": 2,
		"RIDX_MAINTHREAD": 1,
		"MULTRET": -1,
		"NOREF": -2,
		"GC": {
			"STOP": 0,
			"RESTART": 1,
			"COLLECT": 2,
			"COUNT": 3,
			"COUNTB": 4,
			"STEP": 5,
			"SETPAUSE": 6,
			"SETSTEPMUL": 7,
			"SETMAJORINC": 8,
			"ISRUNNING": 9,
			"GEN": 10,
			"INC": 11,
		},
		"T": {
			"NONE": -1,
			"NIL": 0,
			"BOOLEAN": 1,
			"LIGHTUSERDATA": 2,
			"NUMBER": 3,
			"STRING": 4,
			"TABLE": 5,
			"FUNCTION": 6,
			"USERDATA": 7,
			"THREAD": 8,
		},
	},
	"lib": {
		// absindex
		// arith
		// atpanic
		// callk
		"checkstack":        emscripten.cwrap('lua_checkstack',        null,     ["number", "number"]),
		// close
		// compare
		// concat
		// copy
		"createtable":       emscripten.cwrap('lua_createtable',       null,     ["number", "number", "number"]),
		// dump
		"error":             emscripten.cwrap('lua_error',             "number", ["number"]),
		"gc":                emscripten.cwrap('lua_gc',                "number", ["number", "number", "number"]),
		// getallocf
		// getctx
		"getfield":          emscripten.cwrap('lua_getfield',          null,     ["number", "number", "string"]),
		"getglobal":         emscripten.cwrap('lua_getglobal',         null,     ["number", "string"]),
		// gethook
		// gethookcount
		// gethookmask
		// getinfo
		// getlocal
		// getmetatable
		// getstack
		"gettable":          emscripten.cwrap('lua_gettable',          null,     ["number", "number"]),
		"gettop":            emscripten.cwrap('lua_gettop',            "number", ["number"]),
		// getupvalue
		// getuservalue
		// insert
		// iscfunction
		// isnumber
		// isstring
		// isuserdata
		// len
		// load
		// newstate
		// newthread
		"newuserdata":       emscripten.cwrap('lua_newuserdata',       "number", ["number", "number"]),
		// next
		"pcallk":            emscripten.cwrap('lua_pcallk',            "number", ["number", "number", "number", "number", "number", "number"]),
		"pushboolean":       emscripten.cwrap('lua_pushboolean',       null,     ["number", "number"]),
		"pushcclosure":      emscripten.cwrap('lua_pushcclosure',      null,     ["number", "number", "number"]),
		// pushfstring
		// pushinteger
		"pushlightuserdata": emscripten.cwrap('lua_pushlightuserdata', null,     ["number", "number"]),
		"pushlstring":       emscripten.cwrap('lua_pushlstring',       null,     ["number", "array", "number"]),
		"pushnil":           emscripten.cwrap('lua_pushnil',           null,     ["number"]),
		"pushnumber":        emscripten.cwrap('lua_pushnumber',        null,     ["number", "number"]),
		// pushstring
		// pushthread
		// pushunsigned
		"pushvalue":         emscripten.cwrap('lua_pushvalue',         null,     ["number", "number"]),
		// pushvfstring
		// rawequal
		// rawget
		"rawgeti":           emscripten.cwrap('lua_rawgeti',           null,     ["number", "number", "number"]),
		// rawgetp
		// rawlen
		// rawset
		// rawseti
		// rawsetp
		"remove":            emscripten.cwrap('rs_lua_remove',         null,     ["number", "number"]),
		// replace
		// resume
		// setallocf
		"setfield":          emscripten.cwrap('lua_setfield',          null,     ["number", "number", "string"]),
		"setglobal":         emscripten.cwrap('lua_setglobal',         null,     ["number", "string"]),
		// sethook
		// setlocal
		"setmetatable":      emscripten.cwrap('lua_setmetatable',      null,     ["number", "number"]),
		"settable":          emscripten.cwrap('lua_settable',          null,     ["number", "number"]),
		"settop":            emscripten.cwrap('lua_settop',            null,     ["number", "number"]),
		// setupvalue
		// setuservalue
		// status
		"toboolean":         emscripten.cwrap('lua_toboolean',         "number", ["number", "number"]),
		// tocfunction
		// tointegerx
		"tolstring":         emscripten.cwrap('lua_tolstring',         "number", ["number", "number", "number"]),
		"tonumberx":         emscripten.cwrap('lua_tonumberx',         "number", ["number", "number", "number"]),
		// topointer
		"tothread":          emscripten.cwrap('lua_tothread',          "number", ["number", "number"]),
		// tounsignedx
		"touserdata":        emscripten.cwrap('lua_touserdata',        "number", ["number", "number"]),
		"type":              emscripten.cwrap('lua_type',              "number", ["number", "number"]),
		"typename":          emscripten.cwrap('lua_typename',          "string", ["number", "number"]),
		// upvalueid
		// upvaluejoin
		// version
		// xmove
		// yieldk
	},
	"auxlib":{
		// addlstring
		// addstring
		// addvalue
		// argerror
		// buffinit
		// buffinitsize
		// callmeta
		// checkany
		// checkinteger
		// checklstring
		// checknumber
		// checkoption
		// checkstack
		// checktype
		"checkudata":        emscripten.cwrap('luaL_checkudata',       "number", ["number", "number", "string"]),
		// checkunsigned
		// error
		// execresult
		// fileresult
		// getmetafield
		// getsubtable
		// gsub
		// len
		"loadbufferx":       emscripten.cwrap('luaL_loadbufferx',      "number", ["number", "array", "number", "string", "string"]),
		// Same C function, but taking the chunk as a heap pointer instead of a JS
		// array. cwrap's "array" type stack-allocates, and the stack is 64KB, so
		// the call above cannot load a chunk bigger than that. See
		// Lua.State.prototype.load.
		"loadbufferptr":     emscripten.cwrap('luaL_loadbufferx',      "number", ["number", "number", "number", "string", "string"]),
		// loadfilex
		// loadstring
		"newmetatable":      emscripten.cwrap('luaL_newmetatable',     "number", ["number", "string"]),
		"newstate":          emscripten.cwrap('luaL_newstate',         "number", []),
		"openlibs":          emscripten.cwrap('luaL_openlibs',         null,     ["number"]),
		// optinteger
		// optlstring
		// optnumber
		// optunsigned
		// prepbuffsize
		// pushresult
		// pushresultsize
		"ref":               emscripten.cwrap('luaL_ref',              "number", ["number", "number"]),
		// requiref
		// setfuncs
		"setmetatable":      emscripten.cwrap('luaL_setmetatable',     null,     ["number", "string"]),
		"testudata":         emscripten.cwrap('luaL_testudata',        "number", ["number", "number", "string"]),
		"tolstring":         emscripten.cwrap('luaL_tolstring',        "number", ["number", "number", "number"]),
		"traceback":         emscripten.cwrap('luaL_traceback',        null,     ["number", "number", "string", "number"]),
		"unref":             emscripten.cwrap('luaL_unref',            "number", ["number", "number", "number"]),
		// where
	},
	"refs": {}, /* indexed by state */
};

Lua.Error = function (L, error_index) {
	this.message = L.tostring(error_index);
	// Get lua stack trace
	L.traceback(L._L, this.message, 1);
	this.lua_stack = L.raw_tostring(-1);
	L.pop(1);
};
Lua.Error.prototype = new Error();
Lua.Error.prototype.name = "Lua.Error";

Lua.cfuncs = {
	"__gc": emscripten.Runtime.addFunction(function(L){
		L = new Lua.State(L);
		var box = L.checkudata(1, "_PROXY_MT");
		var id = emscripten.getValue(box, "double");
		delete Lua.refs[getmain(L)][id];
		return 0;
	}),
	"__index": emscripten.Runtime.addFunction(function(L){
		L = new Lua.State(L);
		var box = L.checkudata(1, "_PROXY_MT");
		var id = emscripten.getValue(box, "double");
		var ob = Lua.refs[getmain(L)][id];
		var k = L.lua_to_js(2);
		try {
			var res = ob[k];
		} catch (e) {
			L.push(e);
			L.error();
			throw "Unreachable";
		}
		L.push(res);
		return 1;
	}),
	"__newindex": emscripten.Runtime.addFunction(function(L){
		L = new Lua.State(L);
		var box = L.checkudata(1, "_PROXY_MT");
		var id = emscripten.getValue(box, "double");
		var ob = Lua.refs[getmain(L)][id];
		var k = L.lua_to_js(2);
		if (L.isnil(3)) {
			try {
				delete ob[k];
			} catch (e) {
				L.push(e);
				L.error();
				throw "Unreachable";
			}
		} else {
			var v = L.lua_to_js(3);
			try {
				ob[k]=v;
			} catch (e) {
				L.push(e);
				L.error();
				throw "Unreachable";
			}
		}
		return 0;
	}),
	"__call": emscripten.Runtime.addFunction(function(L){
		L = new Lua.State(L);
		var box = L.checkudata(1, "_PROXY_MT");
		var id = emscripten.getValue(box, "double");
		var ob = Lua.refs[getmain(L)][id];
		var top = L.gettop();
		var thisarg = top>=2?L.lua_to_js(2):null;
		var args = [];
		for (var i=3; i<=top; i++) {
			args.push(L.lua_to_js(i));
		}
		try {
			var res = apply.call(ob, thisarg, args);
		} catch (e) {
			L.push(e);
			L.error();
			throw "Unreachable";
		}
		L.push(res);
		return 1;
	}),
	"__len": emscripten.Runtime.addFunction(function(L){
		L = new Lua.State(L);
		var box = L.checkudata(1, "_PROXY_MT");
		var id = emscripten.getValue(box, "double");
		var ob = Lua.refs[getmain(L)][id];
		L.push(ob.length);
		return 1;
	}),
	"__tostring": emscripten.Runtime.addFunction(function(L){
		L = new Lua.State(L);
		var box = L.checkudata(1, "_PROXY_MT");
		var id = emscripten.getValue(box, "double");
		var ob = Lua.refs[getmain(L)][id];
		L.pushstring((ob!==null && ob.toString)?ob.toString():typeof ob);
		return 1;
	}),
	"new": emscripten.Runtime.addFunction(function(L){
		L = new Lua.State(L);
		var box = L.checkudata(1, "_PROXY_MT");
		var id = emscripten.getValue(box, "double");
		var ob = Lua.refs[getmain(L)][id];
		var top = L.gettop();
		var args = [];
		for (var i=2; i<=top;i++) {
			args.push(L.lua_to_js(i));
		}
		try {
			var res = new_.apply(ob,args);
		} catch (e) {
			L.push(e);
			L.error();
			throw "Unreachable";
		}
		L.push(res);
		return 1;
	}),
	// "delete": emscripten.Runtime.addFunction(function(L){
	// 	L = new Lua.State(L);
	// 	var box = L.checkudata(1, "_PROXY_MT");
	// 	var id = emscripten.getValue(box, "double");
	// 	var ob = Lua.refs[getmain(L)][id];
	// 	var k = L.lua_to_js(2);
	// 	L.pushboolean(delete ob[k]);
	// 	return 1;
	// }),
	// Our error handler
	"traceback": emscripten.Runtime.addFunction(function(L){
		L = new Lua.State(L);
		L.pushjs(new Lua.Error(L, 1));
		return 1;
	}),
};

// Either wraps existing state; or makes a new one
Lua.State = function (_L) {
	if (_L) {
		this._L = _L;
	} else {
		this._L = Lua.auxlib.newstate();

		var refs = [];
		refs.i = 0;
		Lua.refs[this._L] = refs;

		this.gc(Lua.defines.GC.STOP, 0);

		this.openlibs();

		// Construct Proxy metatable
		this.newmetatable("_PROXY_MT");
		this.pushcclosure(Lua.cfuncs.__gc, 0);
		this.setfield(-2, "__gc");
		this.pushcclosure(Lua.cfuncs.__index, 0);
		this.setfield(-2, "__index");
		this.pushcclosure(Lua.cfuncs.__newindex, 0);
		this.setfield(-2, "__newindex");
		this.pushcclosure(Lua.cfuncs.__call, 0);
		this.setfield(-2, "__call");
		this.pushcclosure(Lua.cfuncs.__len, 0);
		this.setfield(-2, "__len");
		this.pushcclosure(Lua.cfuncs.__tostring, 0);
		this.setfield(-2, "__tostring");
		this.pop(1);

		// Set up weakly valued table for holding userdata
		// This level of indirection ensures equal js objects are equal
		this.createtable(0, 0);
		this.createtable(0, 1);
		this.pushstring("kv");
		this.setfield(-2, "__mode");
		Lua.lib.setmetatable(this._L, -2);
		this.setfield(Lua.defines.REGISTRYINDEX, "wrapped");

		// Create 'js' library
		this.createtable(0, 3);
		this.pushcclosure(Lua.cfuncs["new"], 0);
		this.setfield(-2, "new");
		this.push(null);
		this.setfield(-2, "null");
		this.push(global);
		this.setfield(-2, "global");
		this.setglobal("js");

		this.gc(Lua.defines.GC.RESTART, 0);
	}
	this._G = Lua.Proxy.create(this, Lua.defines.RIDX_GLOBALS);
};
// Add all C functions as methods on a Lua_State object.
// Auxiliary library takes precedence
(function() {
	function wrap(func) {
		return function() {
			var args = slice.call(arguments, 0);
			args.splice(0, 0, this._L);
			return func.apply(null, args);
		};
	}
	for (var i in Lua.lib) {
		Lua.State.prototype[i] = wrap(Lua.lib[i]);
	}
	for (var j in Lua.auxlib) {
		Lua.State.prototype[j] = wrap(Lua.auxlib[j]);
	}
})();
// Add functions that are normally macros
Lua.State.prototype.pop = function(n) {
	this.settop(-n-1);
};
Lua.State.prototype.isnil = function(n) {
	return this.type(n) === 0;
};
Lua.State.prototype.isnoneornil = function(n) {
	return this.type(n) <= 0;
};
Lua.State.prototype.getmetatable = function(n) {
	this.getfield(Lua.defines.REGISTRYINDEX, n);
};
Lua.State.prototype.pcall = function(n,r,f) {
	return this.pcallk(n, r, f, 0, null);
};
Lua.State.prototype.tonumber = function(n) {
	return this.tonumberx(n, null);
};

// Debugging
Lua.State.prototype.printStack = function() {
	for(var j=1;j<=this.gettop();j++){
		var t = this.type(j);
		console.log(j, this.typename(t), (function(t){switch(t){
			case Lua.defines.T.NUMBER:
				return this.tonumber(j);
			case Lua.defines.T.STRING:
				return this.raw_tostring(j);
			case Lua.defines.T.USERDATA:
				return this.touserdata(j);
			default:
				return;
		}}).call(this, t));
	}
};
// Add handy wrappers to make for idiomatic js
Lua.State.prototype.pushstring = function (str) {
	var chars = emscripten.intArrayFromString(str, true);
	this.pushlstring(chars, chars.length);
};
// A Lua string is a byte string, not text. Reading it back as UTF-8 gives the
// bytes verbatim only while every one of them is below 128; the moment a single
// byte is higher a UTF-8 decode turns any string carrying real bytes (a PICO-8
// cart's characters, packed binary) into garbage - and the C-string helpers read
// to the NUL terminator, ignoring the length they were given. So decode as UTF-8
// only when the bytes genuinely are UTF-8, and otherwise hand back one JS
// character per byte, losing nothing.
Lua.readLuaString = function (ptr, len) {
	if (!len || ptr === 0 /* NULL */) return "";
	// Re-read the view every time: the heap is replaced when it grows.
	var bytes = emscripten.HEAPU8.subarray(ptr, ptr + len);
	var high = 0;
	for (var i = 0; i < len; i++) high |= bytes[i];
	if (high < 128) return Lua.bytesToString(bytes);
	if (Lua._utf8Decoder) {
		try {
			return Lua._utf8Decoder.decode(bytes);
		} catch (e) {
			// Not text. Fall through and keep the bytes.
		}
	}
	return Lua.bytesToString(bytes);
};
// Chunked so a long string cannot blow the argument limit of apply().
Lua.bytesToString = function (bytes) {
	var CHUNK = 4096;
	if (bytes.length <= CHUNK) return String.fromCharCode.apply(String, bytes);
	var out = "";
	for (var i = 0; i < bytes.length; i += CHUNK) {
		out += String.fromCharCode.apply(String, bytes.subarray(i, i + CHUNK));
	}
	return out;
};
Lua._utf8Decoder = (typeof TextDecoder !== "undefined")
	? new TextDecoder("utf-8", { fatal: true })
	: null;
Lua.State.prototype.raw_tostring = function(i) {
	// stackAlloc has no matching free, so save and restore around it - otherwise
	// every tostring call leaks a few bytes of the runtime stack.
	var sp = emscripten.stackSave();
	try {
		var l = emscripten.stackAlloc(4);
		var p = Lua.lib.tolstring(this._L, i || -1, l);
		if (p === 0 /* NULL */) return null;
		return Lua.readLuaString(p, emscripten.getValue(l, "i32"));
	} finally {
		emscripten.stackRestore(sp);
	}
};
// This version calls __tostring metamethod
Lua.State.prototype.tostring = function(i) {
	var sp = emscripten.stackSave();
	try {
		var l = emscripten.stackAlloc(4);
		var p = this.tolstring(i || -1, l);
		return Lua.readLuaString(p, emscripten.getValue(l, "i32"));
	} finally {
		emscripten.stackRestore(sp);
	}
};
Lua.State.prototype.lua_to_js = function(i) {
	switch(this.type(i)) {
		case -1: // LUA_TNONE
		case 0: // LUA_TNIL
			return void 0;
		case 1: // LUA_TBOOLEAN
			return this.toboolean(i)!==0;
		case 2: // LUA_TLIGHTUSERDATA
			return this.touserdata(i);
		case 3: // LUA_TNUMBER
			return this.tonumberx(i);
		case 4: // LUA_TSTRING
			return this.raw_tostring(i);
		case 7: // LUA_TUSERDATA
			var box = this.testudata(i, "_PROXY_MT");
			if (box !== /* NULL */ 0) {
				var id = emscripten.getValue(box, "double");
				return Lua.refs[getmain(this)][id];
			}
			/* fall through */
		default: // LUA_TTABLE, LUA_TFUNCTION, LUA_TTHREAD
			return new Lua.Proxy(this, i);
	}
};
Lua.State.prototype.pushjs = function(ob) {
	var refs = Lua.refs[getmain(this)];
	var i = refs.indexOf(ob);
	if (i !== -1) {
		this.getfield(Lua.defines.REGISTRYINDEX, "wrapped");
		this.pushnumber(i);
		this.gettable(-2);
		if (!this.isnil(-1)) {
			this.remove(this.gettop()-2+1); // Remove "wrapped" from the stack; remove can't take a psuedo index
			return;
		} else {
			// Object has been removed from weak table, but hasn't been collected yet.
			this.pop(2);
		}
	}
	i = refs.i++;
	refs[i] = ob;
	var box = this.newuserdata(8);
	emscripten.setValue(box, i, "double");
	this.setmetatable("_PROXY_MT");
	// Save in lua table
	this.getfield(Lua.defines.REGISTRYINDEX, "wrapped");
	this.pushnumber(i);
	this.pushvalue(-3);
	this.settable(-3);
	this.pop(1); // pop "wrapped"
};
// Get main lua_State of given thread
function getmain(L) {
	L.rawgeti(Lua.defines.REGISTRYINDEX, Lua.defines.RIDX_MAINTHREAD);
	var _L = L.tothread(-1);
	L.pop(1);
	return _L;
};
Lua.State.prototype.push = function(ob) {
	switch (typeof ob) {
		case "boolean":
			return this.pushboolean(ob?1:0);
		case "number":
			return this.pushnumber(ob);
		case "string":
			return this.pushstring(ob);
		case "undefined":
			return this.pushnil();
		default:
			if (typeof ob === "function" && ob.L instanceof Lua.State && ob.L._L === getmain(this)) { // Is Lua.Proxy object for this state
				return ob.push();
			}
			/* convert Classes of the primitive objects to primitives */
			if (typeof ob === "object" && (ob instanceof Boolean || ob instanceof Number || ob instanceof String)) {
				return this.push(ob.valueOf());
			}
			return this.pushjs(ob);
	}
};
// The chunk is copied to the HEAP, not the stack.
//
// The obvious spelling of this - loadbufferx(chars, chars.length, ...) - hands
// the source to cwrap's "array" argument type, which stack-allocates it. The
// emscripten stack is 64KB, so any chunk larger than that died inside
// writeArrayToMemory with "RangeError: offset is out of bounds" before Lua ever
// saw a byte of it. The error surfaced as "Script Loading Error ... this usually
// indicates a syntax error in your Lua code", which is exactly the wrong place
// to go looking. Big PICO-8 carts hit this easily: POOM's title cart alone
// transpiles to ~102KB of Lua.
//
// malloc/free and HEAPU8 are already exported by build.sh, so this needs no
// change to the build flags.
Lua.State.prototype.load = function(code, name, mode) {
	var chars = emscripten.intArrayFromString(code, true);
	var len = chars.length;
	var ptr = emscripten._malloc(len);
	if (ptr === 0) {
		throw new Error("Lua.State.load: out of memory for a " + len + " byte chunk");
	}
	try {
		// Read HEAPU8 after the malloc: growing the heap replaces the view.
		emscripten.HEAPU8.set(chars, ptr);
		if (this.loadbufferptr(ptr, len, name, mode) !== 0) {
			throw new Lua.Error(this, -1);
		}
	} finally {
		// Lua has copied everything it needs by now, on both paths.
		emscripten._free(ptr);
	}
	var r = new Lua.Proxy(this, -1);
	this.pop(1);
	return r;
};
Lua.State.prototype.execute = function(code) {
	var proxy = this.load(code);
	var args = slice.call(arguments, 1);
	try {
		return proxy.invoke(args);
	} finally {
		proxy.free();
	}
};

Lua.Proxy = function (L, i) {
	// Push the given index (luaL_ref pops it)
	// Need to use the passed stack, as that's where `i` is.
	L.pushvalue(i);
	var ref = L.ref(Lua.defines.REGISTRYINDEX);

	// Use the main stack for calling
	var _L = getmain(L);
	if (L._L != _L) {
		L = new Lua.State(_L);
	}

	return Lua.Proxy.create(L, ref);
};
Lua.Proxy.create = function(L, ref) {
	// We want the proxy to be callable as a normal JS function
	// This means we have to attach other methods to the function manually
	// and return only the first return result
	function self() {
		"use strict"; /* if a function isn't strict, you can't pass null as 'this' */
		var args = slice.call(arguments, 0);
		args.splice(0, 0, this);
		return self.invoke(args, 1)[0];
	}

	self.L = L;
	self.ref = ref;

	// Add methods
	self.invoke   = Lua.Proxy.invoke;
	self.push     = Lua.Proxy.push;
	self.free     = Lua.Proxy.free;
	self.toString = Lua.Proxy.toString;
	self.get      = Lua.Proxy.get;
	self.set      = Lua.Proxy.set;

	return self;
};
Lua.Proxy.push = function() {
	this.L.rawgeti(Lua.defines.REGISTRYINDEX, this.ref);
};
Lua.Proxy.free = function() {
	this.L.unref(Lua.defines.REGISTRYINDEX, this.ref);
	this.ref = Lua.defines.NOREF;
};
Lua.Proxy.invoke = function(args, n_results) {
	if (this.L.checkstack(1+1+args.length)===0) throw "Out of stack space";
	if ((n_results === void 0) || (n_results === null)) {
		n_results = Lua.defines.MULTRET;
	}
	var pre = this.L.gettop();
	this.L.pushcclosure(Lua.cfuncs.traceback, 0);
	this.push();
	for (var i=0; i<args.length; i++) {
		this.L.push(args[i]);
	}
	if (this.L.pcall(args.length, n_results, pre+1) !== 0) {
		var err = this.L.lua_to_js(-1);
		this.L.settop(pre);
		throw err;
	}
	var top = this.L.gettop();
	var results=[];
	for (var j=pre+2; j<=top; j++) {
		results.push(this.L.lua_to_js(j));
	}
	this.L.settop(pre);
	return results;
};
Lua.Proxy.toString = function() {
	this.push();
	var s = this.L.tostring(-1);
	this.L.pop(2); // Pop self + tostring result
	return s;
};
Lua.Proxy.get = function(key) {
	this.push();
	this.L.push(key);
	this.L.gettable(-2);
	var res = this.L.lua_to_js(-1);
	this.L.pop(2); // Pop self + result
	return res;
};
Lua.Proxy.set = function(key, value) {
	this.push();
	this.L.push(key);
	this.L.push(value);
	this.L.settable(-3);
	this.L.pop(1); // Pop self
	return;
};

Lua.init = function() {
	// Create arbitraily "primary" lua state
	var L = exports.L = new Lua.State();
	L.execute("dofile'js.lua'");
	if (ENVIRONMENT_IS_WEB) {
		// Run script tags on page
		var onload = window.onload;
		window.onload = function() {
			if (onload) onload();
			Lua.executeScripts(L);
		};
	}
};
Lua.executeScripts = function(L) {
	Array.prototype.forEach.call(document.querySelectorAll('script[type=\"text\/lua\"]'), function(tag) {
		L.execute(tag.innerHTML);
	});
};
// Deliberately not auto-initialising. Lua.init() creates a throwaway primary
// state and runs js.lua, the upstream JS-interop library, which indexes the
// 'debug' global on its 5th line. The firmware's linit.c does not register
// debug (nor math, os, io, package or utf8), so js.lua cannot load in a build
// that matches the watch. Nothing in RetroStudio uses it - lua-editor.js and
// game-emulator.js each construct their own Lua.State - so the primary state
// was only ever dead weight. Call Lua.init() explicitly if you want it.
return Lua;
})(exports,
	ENVIRONMENT_IS_NODE ? global : this,
	Module);
