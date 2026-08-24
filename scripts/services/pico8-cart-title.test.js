// pico8-cart-title.test.js
// Regression tests for the package title/author a PICO-8 import stamps.
//
// PICO-8 carts conventionally open with `-- title` then `-- by author`, and the
// importer reads those two lines. Carts also label their editor tabs with a
// dash-wrapped banner comment, and tab 0's banner sits on exactly the line the
// title convention claims. train_09.p8 opens `-- main --` and imported as a
// project named train_09 whose package title was "main --".

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

function title(lua) {
  return makeService().readCartHeaderComment(lua, 0);
}

function author(lua) {
  return makeService().readCartHeaderComment(lua, 1);
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('the conventional title/author header is read', () => {
  const lua = '-- sonic 2.5\n-- by bonevolt\n\nfunction _init() end';
  assert.strictEqual(title(lua), 'sonic 2.5');
  assert.strictEqual(author(lua), 'bonevolt');
});

test('a tab banner is not a title, so the caller falls back to the file name', () => {
  // train_09.p8 verbatim: every tab opens with a `-- name --` banner, and the
  // blank line after tab 0's banner ends the header block.
  const lua = '-- main --\n\n-- train game (working title)\n-- brian kumanchik\n\nfunction _init() end';
  assert.strictEqual(title(lua), '');
  assert.strictEqual(author(lua), '');
});

test('a banner does not shift the author up into the title slot', () => {
  // Dropping the banner entry outright would promote "someone" to the title.
  const lua = '-- my game --\n-- by someone\nfunction _init() end';
  assert.strictEqual(title(lua), '');
  assert.strictEqual(author(lua), 'someone');
});

test('the header stops at the first line that is not a comment', () => {
  const lua = '-- real title\nx = 1\n-- not a header comment';
  assert.strictEqual(title(lua), 'real title');
  assert.strictEqual(author(lua), '');
});

test('a title containing a dash is kept, only a trailing dash is decoration', () => {
  assert.strictEqual(title('-- spelunky-like\n-- by someone'), 'spelunky-like');
  assert.strictEqual(title('-- a - b\n-- by someone'), 'a - b');
});

test('a missing or non-string cart body reads as empty', () => {
  assert.strictEqual(title(undefined), '');
  assert.strictEqual(title(''), '');
  assert.strictEqual(title('function _init() end'), '');
});

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
