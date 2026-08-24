/**
 * Multi-return conformance test.
 *
 * A JS function returns one value, but api.json declares several functions as
 * returning two (Image.GetSize -> "int32, int32"). Those implementations return
 * a JS array, which reaches Lua as a single 0-indexed userdata proxy - so
 * `local w, h = Image.GetSize(logo)` silently put the proxy in w and nil in h.
 *
 * This covers the three things that have to line up for that to work:
 *   1. every function declaring N>1 returns actually returns an array
 *   2. the Lua bridge expands array results into real Lua multiple returns
 *   3. Image.GetSize reports a real size for a freshly created image
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function repoPath(...parts) {
  return path.resolve(__dirname, ...parts);
}

function loadApiContract() {
  return JSON.parse(fs.readFileSync(repoPath('api.json'), 'utf8'));
}

function setupGlobals() {
  global.window = global.window || {};
  const basePath = repoPath('base-lua-extension.js');
  delete require.cache[basePath];
  const BaseLuaExtension = require(basePath) || global.window.BaseLuaExtension;
  if (typeof BaseLuaExtension !== 'function') throw new Error('Failed to load BaseLuaExtension');
  global.BaseLuaExtension = BaseLuaExtension;
}

function declaredReturnCount(func) {
  const type = func && func.returns && func.returns.type;
  if (typeof type !== 'string' || !type.trim()) return 0;
  return type.split(',').map((part) => part.trim()).filter(Boolean).length;
}

function loadExtensionClass(categoryName) {
  const filePath = repoPath(`${categoryName.toLowerCase()}.js`);
  if (!fs.existsSync(filePath)) return null;
  delete require.cache[filePath];
  const exported = require(filePath);
  return (typeof exported === 'function' ? exported : null)
    || global.window[`Lua${categoryName}Extensions`]
    || null;
}

// 1. Declared multi-returns must be implemented as arrays.
function checkMultiReturnImplementations() {
  const api = loadApiContract();
  const violations = [];
  const checked = [];

  for (const category of api.categories || []) {
    if (!Array.isArray(category.functions)) continue;

    const ExtensionClass = loadExtensionClass(category.name);
    if (!ExtensionClass) continue;

    for (const func of category.functions) {
      if (declaredReturnCount(func) < 2) continue;

      const method = ExtensionClass.prototype[func.name];
      if (typeof method !== 'function') {
        violations.push(`${category.name}.${func.name}: declared ${declaredReturnCount(func)} returns but is not implemented`);
        continue;
      }

      checked.push(`${category.name}.${func.name}`);
      if (!/return\s*\[/.test(method.toString())) {
        violations.push(
          `${category.name}.${func.name}: api.json declares "${func.returns.type}" `
          + 'but the implementation never returns an array, so Lua cannot receive multiple values',
        );
      }
    }
  }

  assert.ok(checked.length > 0, 'Expected to find at least one multi-return function to check');
  assert.deepStrictEqual(violations, [], `Multi-return contract violations:\n${violations.join('\n')}`);
  return checked;
}

// 2. The bridge must expand array results, or every one of the above is broken.
function checkBridgeExpandsArrays() {
  const source = fs.readFileSync(repoPath('base-lua-extension.js'), 'utf8');

  assert.ok(
    /function __retroExpandJsResult\(result\)/.test(source),
    'base-lua-extension.js no longer defines __retroExpandJsResult, so multi-return API '
    + 'functions such as Image.GetSize will hand Lua a userdata proxy and nil',
  );

  // Count call sites rather than just looking for the helper's name: the helper
  // can still be defined while a call site bypasses it. The bridge resolves
  // js.global.<name> once into the `__impl` upvalue (looking it up per call cost
  // ~0.93ms and capped the API at ~2000 calls/second), so every invocation of
  // __impl is a call into JS and must be wrapped. The Pico-8 global alias is a
  // plain assignment to the same function, so it shares this one call site.
  assert.ok(
    /local __impl = js\.global\.\$\{globalFunctionName\}/.test(source),
    'base-lua-extension.js no longer resolves js.global.<name> into an upvalue; '
    + 'if the bridge shape changed, this test needs to follow it',
  );

  const callSites = (source.match(/__impl\(/g) || []).length;
  const wrapped = (source.match(/__retroExpandJsResult\(\s*__impl\(/g) || []).length;

  assert.ok(callSites >= 1, `Expected at least 1 bridge call site, found ${callSites}`);
  assert.strictEqual(
    wrapped,
    callSites,
    `${callSites - wrapped} of ${callSites} bridge call sites return the raw JS result `
    + 'without expanding arrays into Lua multiple returns',
  );
}

// 3. rnd(t) must be adapted in Lua, because a table cannot cross the JS bridge.
function checkRndTableAdapter() {
  const emitted = [];
  const extension = new global.BaseLuaExtension();
  extension.setLuaState({ execute: (source) => emitted.push(source) });

  extension.registerMethod('rnd', function rnd() {}, 'Pico8');
  const rndLua = emitted.join('\n');

  // A Lua table reaches a bridged JS function as the string "table: 0x...",
  // never as an object, so a JS-side `typeof x === 'object'` branch can never
  // fire. rnd(t) has to be answered in Lua or the cart dies with
  // "[Pico8] rnd invalid numeric argument x: table: 0x...".
  assert.ok(
    /if type\(x\) == "table" then/.test(rndLua),
    'Pico8.rnd is registered without a Lua-side table branch, so rnd(t) will '
    + 'reach the JS implementation as a string and throw',
  );

  // The adapter rebinds Pico8.rnd, so the global alias has to be assigned
  // afterwards or `rnd` keeps pointing at the unwrapped numeric-only version.
  const adapterAt = rndLua.indexOf('if type(x) == "table" then');
  const aliasAt = rndLua.indexOf('rnd = Pico8.rnd');
  assert.ok(aliasAt !== -1, 'Pico8.rnd is no longer aliased to the rnd global');
  assert.ok(
    adapterAt < aliasAt,
    'The rnd global alias is assigned before the table adapter wraps Pico8.rnd, '
    + 'so the global rnd() still rejects tables',
  );

  // The adapter must delegate the numeric case rather than reimplementing it.
  assert.ok(
    /return __rndNative\(x\)/.test(rndLua),
    'The rnd adapter no longer forwards non-table arguments to the JS implementation',
  );

  // Functions without an adapter must be left exactly as they were.
  const other = [];
  const plain = new global.BaseLuaExtension();
  plain.setLuaState({ execute: (source) => other.push(source) });
  plain.registerMethod('sin', function sin() {}, 'Pico8');
  assert.ok(
    !/if type\(x\) == "table" then/.test(other.join('\n')),
    'The rnd adapter leaked into other Pico8 functions',
  );
}

// 4. Whole numbers must arrive as integers, not floats.
function checkBridgeFoldsWholeNumbers() {
  // Run the bridge's own Lua through the VM the editor uses. A mock luaState
  // only records the source, so neither a syntax error nor the wrong numeric
  // result would show up until a cart ran.
  const { Lua } = require(repoPath('..', 'external', 'lua-vm', 'lua.vm.js'));
  const L = new Lua.State();
  L.execute(global.BaseLuaExtension.JS_RESULT_LUA);

  const fold = (expression) => {
    L.execute(`__folded = tostring(__retroExpandJsResult(${expression}))`);
    L.getglobal('__folded');
    const value = L.raw_tostring(-1);
    L.pop(1);
    return value;
  };

  // Every JS number crosses the bridge as a float, so this is what flr(),
  // max() and friends really hand back. A cart concatenating one used to get
  // "3.0" printed on screen, because PICO-8 has no float subtype to show.
  assert.strictEqual(fold('3.0'), '3', 'a whole number must lose its .0');
  assert.strictEqual(fold('-7.0'), '-7', 'a negative whole number must fold too');
  assert.strictEqual(fold('0.0'), '0');
  assert.strictEqual(fold('3.5'), '3.5', 'a fractional number must keep its fraction');

  // Outside 32-bit there is no integer to fold to, so | would raise rather
  // than convert: the guard has to reject the value first. 2^31 is used
  // because lua_Number here is a single-precision float, which cannot hold
  // 2147483647 exactly in the first place.
  assert.strictEqual(fold('16777216.0'), '16777216', 'the largest exact float32 integer still folds');
  assert.notStrictEqual(fold('2147483648.0'), '2147483648', 'past int32 the value must stay a float');
  assert.notStrictEqual(fold('-4294967296.0'), '-4294967296');

  // | has no integer representation for these, so the range test has to reject
  // them before it runs rather than raising.
  assert.strictEqual(fold('1/0'), 'inf');
  assert.strictEqual(fold('0/0'), fold('0/0'), 'nan must pass through rather than raise');

  // Non-numbers are untouched.
  assert.strictEqual(fold('"7.0"'), '7.0', 'a string that looks numeric must not be folded');
  assert.strictEqual(fold('nil'), 'nil');
  assert.strictEqual(fold('true'), 'true');
}

// 5. A freshly created image should report its real size, not 0, 0.
function checkImageGetSizeUsesFrameDimensions() {
  const LuaImageExtensions = loadExtensionClass('Image');
  assert.ok(LuaImageExtensions, 'Failed to load LuaImageExtensions');

  const image = new LuaImageExtensions({ allocateRenderOrder: () => 1 });
  image.imageAssets.set('logo', { frames: [{ w: 64, h: 32 }] });

  const handle = image.Create('logo');
  const [width, height] = image.GetSize(handle);

  assert.strictEqual(width, 64, 'Image.GetSize should report the frame width for a new image');
  assert.strictEqual(height, 32, 'Image.GetSize should report the frame height for a new image');

  // An explicit SetSize must still win.
  image.SetSize(handle, 10, 20);
  assert.deepStrictEqual(image.GetSize(handle), [10, 20], 'SetSize should override the frame size');
}

function run() {
  setupGlobals();

  const checked = checkMultiReturnImplementations();
  checkBridgeExpandsArrays();
  checkBridgeFoldsWholeNumbers();
  checkRndTableAdapter();
  checkImageGetSizeUsesFrameDimensions();

  console.log(JSON.stringify({
    multiReturnFunctionsChecked: checked.length,
    functions: checked,
    bridgeExpandsArrays: true,
    rndTableAdapter: true,
    imageGetSizeUsesFrameDimensions: true,
  }, null, 2));
}

if (require.main === module) {
  try {
    run();
    console.log('\nmulti-return.test.js: PASS');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { run };
