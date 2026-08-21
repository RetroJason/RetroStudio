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
  // can still be defined while a call site bypasses it. Every place that calls
  // into JS must be wrapped, both the namespaced function and the Pico8 alias.
  const callSites = (source.match(/js\.global\.\$\{globalFunctionName\}\(/g) || []).length;
  const wrapped = (source.match(/__retroExpandJsResult\(\s*js\.global\.\$\{globalFunctionName\}\(/g) || []).length;

  assert.ok(callSites >= 2, `Expected at least 2 bridge call sites, found ${callSites}`);
  assert.strictEqual(
    wrapped,
    callSites,
    `${callSites - wrapped} of ${callSites} bridge call sites return the raw JS result `
    + 'without expanding arrays into Lua multiple returns',
  );
}

// 3. A freshly created image should report its real size, not 0, 0.
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
  checkImageGetSizeUsesFrameDimensions();

  console.log(JSON.stringify({
    multiReturnFunctionsChecked: checked.length,
    functions: checked,
    bridgeExpandsArrays: true,
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
