// pico8-include.test.js
// Regression tests for PICO-8 `#include` resolution.
//
// PICO-8 keeps include files next to the cart on disk, so a .p8 dropped on its
// own never carries them. Importing such a cart used to reach the parser with
// the directive still in place and die with "unresolved #include". These tests
// cover the two ways the missing files can now be supplied - a .zip archive, or
// loose files selected alongside the cart - plus the failure message shown when
// they are not supplied at all.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const JSZip = require('jszip');

function loadImportService() {
  globalThis.window = globalThis;
  globalThis.JSZip = JSZip;
  globalThis.alert = () => {};
  globalThis.Pico8Parser = require(path.join(__dirname, '..', 'lua', 'pico8-parser.js'));

  // Minimal stand-in for the studio's path helper. Only the extension-to-folder
  // mapping matters here; the exact folders are covered by the rwp tests.
  globalThis.ProjectPaths = {
    getSourcesRootUi: () => 'Sources',
    resolveFolderForExtension: (extension) => (extension === '.lua' ? 'Sources/Scripts' : 'Sources/Binary'),
    normalizeStoragePath: (uiPath) => uiPath,
  };

  const sourcePath = path.join(__dirname, 'pico8-import-service.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  vm.runInThisContext(`${source}\n;globalThis.__Pico8ImportServiceClass = Pico8ImportService;`, {
    filename: sourcePath,
  });

  return globalThis.__Pico8ImportServiceClass;
}

const Pico8ImportService = loadImportService();

function makeService() {
  return new Pico8ImportService(null);
}

function makeCart(luaBody) {
  return ['pico-8 cartridge // http://www.pico-8.com', 'version 42', '__lua__', luaBody, ''].join('\n');
}

function makeSources(service, entries) {
  return service.indexIncludeSources(
    Object.entries(entries).map(([filePath, text]) => ({ path: filePath, text }))
  );
}

async function zipFile(name, entries) {
  const zip = new JSZip();
  for (const [entryPath, content] of Object.entries(entries)) zip.file(entryPath, content);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return new File([buffer], name, { type: 'application/zip' });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// -------------------------------------------------------------------------
// Path resolution
// -------------------------------------------------------------------------

test('include paths resolve relative to the cart, then the archive root', () => {
  const service = makeService();
  const sources = makeSources(service, {
    'carts/helper.lua': '-- next to the cart',
    'dist/lib.lua': '-- at the root',
  });

  assert.strictEqual(
    service.lookupIncludeSource(sources, 'helper.lua', 'carts').path,
    'carts/helper.lua'
  );
  // scumm-8 carts do exactly this: `#include ../dist/scumm-8.min.lua`.
  assert.strictEqual(
    service.lookupIncludeSource(sources, '../dist/lib.lua', 'carts').path,
    'dist/lib.lua'
  );
  assert.strictEqual(service.lookupIncludeSource(sources, 'dist/lib.lua', '').path, 'dist/lib.lua');
});

test('a unique bare filename resolves even when the folder layout was flattened', () => {
  const service = makeService();
  const flattened = makeSources(service, { 'lib.lua': '-- flattened' });

  // The author zipped up a flat folder, but the cart still says `../dist/lib.lua`.
  assert.strictEqual(service.lookupIncludeSource(flattened, '../dist/lib.lua', '').path, 'lib.lua');

  // Ambiguous bare names must NOT be guessed at - picking the wrong one would
  // silently compile the wrong code.
  const ambiguous = makeSources(service, { 'a/lib.lua': '-- a', 'b/lib.lua': '-- b' });
  assert.strictEqual(service.lookupIncludeSource(ambiguous, 'lib.lua', ''), null);
});

test('.. cannot escape the archive root', () => {
  const service = makeService();
  assert.strictEqual(service.normalizeIncludePath('../../../etc/passwd'), 'etc/passwd');
  assert.strictEqual(service.normalizeIncludePath('./Foo/./Bar.LUA'), 'foo/bar.lua');
  assert.strictEqual(service.normalizeIncludePath('a\\b\\c.lua'), 'a/b/c.lua');
});

// -------------------------------------------------------------------------
// Directive parsing and expansion
// -------------------------------------------------------------------------

test('a tab suffix is only read after a .p8 cart', () => {
  const service = makeService();
  assert.deepStrictEqual(service.parseIncludeDirective('foo.lua'), { path: 'foo.lua', tab: null });
  assert.deepStrictEqual(service.parseIncludeDirective('onetab.p8:1'), { path: 'onetab.p8', tab: 1 });
  assert.deepStrictEqual(service.parseIncludeDirective('alltabs.p8'), { path: 'alltabs.p8', tab: null });
  // A colon in a plain path is part of the path, not a tab index.
  assert.deepStrictEqual(service.parseIncludeDirective('weird:name.lua'), { path: 'weird:name.lua', tab: null });
});

test('directives are replaced in place, keeping surrounding line numbers', () => {
  const service = makeService();
  const sources = makeSources(service, { 'lib.lua': 'function helper()\n return 1\nend' });

  const result = service.resolveIncludes('a = 1\n#include lib.lua\nb = 2', sources);

  assert.deepStrictEqual(result.problems, []);
  assert.strictEqual(result.lua, 'a = 1\nfunction helper()\n return 1\nend\nb = 2');
  assert.strictEqual(result.resolved.length, 1);
  assert.strictEqual(result.resolved[0].lines, 3);
});

test('a whole cart or a single tab can be included', () => {
  const service = makeService();
  const sources = makeSources(service, {
    'other.p8': makeCart('tab0 = 0\n-->8\ntab1 = 1\n-->8\ntab2 = 2'),
  });

  assert.strictEqual(
    service.resolveIncludes('#include other.p8', sources).lua,
    'tab0 = 0\n\ntab1 = 1\n\ntab2 = 2'
  );

  // Tab indices are 0-based, matching the numbering on PICO-8's editor tabs.
  assert.strictEqual(service.resolveIncludes('#include other.p8:1', sources).lua, '\ntab1 = 1\n');

  const outOfRange = service.resolveIncludes('#include other.p8:9', sources);
  assert.strictEqual(outOfRange.problems.length, 1);
  assert.match(outOfRange.problems[0].reason, /has 3 tab\(s\)/);
});

test('a cart is recognised by its header, not its extension', () => {
  // Pico8Platformer really does ship its library as `platformer.lua` while the
  // file is a complete cart. Pasting it verbatim puts "pico-8 cartridge" on line
  // 1 of the Lua and the parser dies.
  const service = makeService();
  const sources = makeSources(service, { 'platformer.lua': makeCart('function helper() end') });

  const result = service.resolveIncludes('#include platformer.lua', sources);
  assert.deepStrictEqual(result.problems, []);
  assert.strictEqual(result.lua.trim(), 'function helper() end');
});

test('a missing include is reported instead of reaching the parser', () => {
  const service = makeService();
  const result = service.resolveIncludes('#include gone.lua', makeSources(service, {}));

  assert.strictEqual(result.resolved.length, 0);
  assert.deepStrictEqual(result.problems, [
    { directive: 'gone.lua', reason: 'file was not supplied with the cart' },
  ]);
  // The line survives so the parser's own error still fires if this is ignored.
  assert.strictEqual(result.lua, '#include gone.lua');
});

test('nested includes are reported rather than followed', () => {
  // The PICO-8 manual states "Includes are not performed recursively", so
  // silently expanding them would run code that real PICO-8 would not.
  const service = makeService();
  const sources = makeSources(service, { 'outer.lua': '#include inner.lua', 'inner.lua': 'x = 1' });

  const result = service.resolveIncludes('#include outer.lua', sources);
  assert.strictEqual(result.problems.length, 1);
  assert.match(result.problems[0].reason, /does not expand includes recursively/);
});

test('a line that merely mentions #include is left alone', () => {
  const service = makeService();
  const source = '-- #include lib.lua\ns = "#include lib.lua"';
  const result = service.resolveIncludes(source, makeSources(service, { 'lib.lua': 'x=1' }));

  assert.strictEqual(result.lua, source);
  assert.strictEqual(result.resolved.length, 0);
});

// -------------------------------------------------------------------------
// Choosing the cart out of an archive
// -------------------------------------------------------------------------

test('the cart in an archive is chosen by name, then by depth', () => {
  const service = makeService();

  assert.strictEqual(service.chooseCartPath(['a/only.p8', 'a/lib.lua'], 'bundle.zip'), 'a/only.p8');
  assert.strictEqual(
    service.chooseCartPath(['carts/game.p8', 'carts/other.p8'], 'game.zip'),
    'carts/game.p8'
  );
  assert.strictEqual(
    service.chooseCartPath(['main.p8', 'sub/data.p8'], 'bundle.zip'),
    'main.p8'
  );

  // An explicit choice must be honoured exactly - falling back to a heuristic
  // would import a different cart than the one the user picked.
  assert.strictEqual(
    service.chooseCartPath(['src/game.p8', 'src/bundle.p8'], 'bundle.zip', 'src/game.p8'),
    'src/game.p8'
  );
  assert.throws(
    () => service.chooseCartPath(['src/game.p8', 'src/bundle.p8'], 'bundle.zip', 'nope.p8'),
    /has no cart at nope\.p8/
  );

  // Genuine ambiguity carries the candidates so the UI can offer a picker.
  assert.throws(() => service.chooseCartPath(['a/x.p8', 'b/y.p8'], 'bundle.zip'), (err) => {
    assert.match(err.message, /contains 2 carts/);
    assert.deepStrictEqual(err.cartPaths, ['a/x.p8', 'b/y.p8']);
    return true;
  });
  assert.throws(() => service.chooseCartPath(['readme.txt'], 'bundle.zip'), /contains no \.p8 cart/);
});

// -------------------------------------------------------------------------
// End to end
// -------------------------------------------------------------------------

test('a .zip archive imports a cart together with its includes', async () => {
  const service = makeService();
  const file = await zipFile('Platformer.zip', {
    'carts/platformer.p8': makeCart('#include platformer.lua\nfunction _draw() helper() end'),
    'carts/platformer.lua': 'function helper() cls() end',
  });

  const converted = await service.convertToRws(file);
  const mainLua = await readPackagedFile(converted.blob, 'platformer/Sources/Scripts/main.lua');

  // The cart names the project, not the archive: the archive is just packaging.
  assert.strictEqual(converted.projectName, 'platformer');
  assert.match(mainLua, /function helper\(\)/);
  assert.deepStrictEqual(converted.summary.includes, [
    { directive: 'platformer.lua', path: 'carts/platformer.lua', tab: null, lines: 1 },
  ]);

  // The archived cart is flattened, PICO-8 export style: it must stay
  // re-importable on its own, and a loose .lua of raw PICO-8 left in the
  // project would be swept into the Lua build and fail to compile.
  const stored = await readPackagedFile(
    converted.blob,
    'platformer/Sources/Import/pico8/cart-original.p8'
  );
  assert.doesNotMatch(stored, /#include/);
  assert.match(stored, /function helper\(\) cls\(\) end/);
  assert.match(stored, /^pico-8 cartridge/);
});

test('loose files selected alongside a cart are used as includes', async () => {
  const service = makeService();
  const cart = new File([makeCart('#include lib.lua\nfunction _draw() helper() end')], 'game.p8');
  const lib = new File(['function helper() cls() end'], 'lib.lua');

  const converted = await service.convertToRws(cart, { includeFiles: [lib] });
  const mainLua = await readPackagedFile(converted.blob, 'game/Sources/Scripts/main.lua');

  assert.match(mainLua, /function helper\(\)/);
});

test('importing a cart without its includes explains how to supply them', async () => {
  const service = makeService();
  const cart = new File([makeCart('#include lib.lua')], 'game.p8');

  await assert.rejects(() => service.convertToRws(cart), (err) => {
    assert.match(err.message, /1 unresolved #include/);
    assert.match(err.message, /#include lib\.lua/);
    assert.match(err.message, /\.zip archive/);
    return true;
  });
});

async function readPackagedFile(rwsBlob, storagePath) {
  const outer = await JSZip.loadAsync(await rwsBlob.arrayBuffer());
  const rwpName = Object.keys(outer.files).find((name) => name.endsWith('.rwp'));
  const inner = await JSZip.loadAsync(await outer.file(rwpName).async('arraybuffer'));
  const entry = inner.file(storagePath);
  assert.ok(entry, `expected ${storagePath} in the package, found: ${Object.keys(inner.files).join(', ')}`);
  return entry.async('string');
}

(async function run() {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL  ${name}`);
      console.error(`        ${error && error.message}`);
    }
  }

  console.log(`\n${tests.length - failed} passed, ${failed} failed, ${tests.length} total`);
  if (failed > 0) process.exit(1);
}());
