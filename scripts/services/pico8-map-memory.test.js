// pico8-map-memory.test.js
// Regression tests for the shared map/sprite memory region.
//
// PICO-8 maps map rows 32-63 onto the same bytes as sprites 128-255, so a cart
// gets one or the other and the importer has to pick. Two things went wrong
// here. The recovered rows were appended to whatever __map__ contained rather
// than placed at row 32 - and because PICO-8 trims trailing empty rows when it
// writes the section, a cart with a one screen tall level reports height 16, so
// the lower half of its map would have been shifted 16 rows up. Separately, a
// cart that legitimately uses the region for sprites was told its map had been
// truncated, which sent a tester hunting for missing level data that was never
// there (mario_15.p8: a 128x16 level plus a pipe drawn with spr(141)).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function loadImportService() {
  globalThis.window = globalThis;
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

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

/** A map section of `height` rows where every tile in a row equals the row index. */
function makeMap(height, width = 128) {
  const tiles = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) tiles.fill(y + 1, y * width, (y + 1) * width);
  return { width, height, tiles };
}

/** Stand-in for extractSharedMapRows() output: 32 rows of a single marker byte. */
function makeSharedRows(marker = 0xaa, width = 128) {
  const height = 32;
  return { width, height, tiles: new Uint8Array(width * height).fill(marker), nonZero: width * height };
}

// -------------------------------------------------------------------------
// Placement of the recovered rows
// -------------------------------------------------------------------------

test('recovered shared rows land at map row 32 when __map__ is a full 32 rows', () => {
  const service = makeService();
  const merged = service.mergeSharedMapRows(makeMap(32), makeSharedRows(0xaa));

  assert.strictEqual(merged.height, 64, 'a full map plus the shared region is 64 rows');
  assert.strictEqual(merged.tiles[31 * 128], 32, 'row 31 keeps its own data');
  assert.strictEqual(merged.tiles[32 * 128], 0xaa, 'row 32 is the first recovered row');
});

test('recovered shared rows still land at row 32 when PICO-8 trimmed __map__ short', () => {
  const service = makeService();
  // The mario_15.p8 shape: a level exactly one screen tall, so __map__ is 16
  // rows. Appending would put the recovered rows at 16-47 instead of 32-63.
  const merged = service.mergeSharedMapRows(makeMap(16), makeSharedRows(0xaa));

  assert.strictEqual(merged.height, 64, 'the map still ends at row 63, not row 47');
  assert.strictEqual(merged.tiles[15 * 128], 16, 'row 15 keeps the last authored row');

  for (let y = 16; y < 32; y += 1) {
    assert.strictEqual(merged.tiles[y * 128], 0, `row ${y} is padding, not recovered data`);
  }

  assert.strictEqual(merged.tiles[32 * 128], 0xaa, 'the recovered region starts at row 32');
  assert.strictEqual(merged.tiles[63 * 128], 0xaa, 'and runs to row 63');
});

// -------------------------------------------------------------------------
// Deciding which interpretation the cart meant
// -------------------------------------------------------------------------

test('a cart drawing sprites 128-255 keeps the region as sprites', () => {
  const service = makeService();

  assert.strictEqual(service.cartUsesHighSprites('spr(141, x, y, 2, 3)'), true, 'spr(141) is sprite use');
  assert.strictEqual(service.cartUsesHighSprites('sspr(200, 0, 8, 8, 0, 0)'), true, 'sspr counts too');
  assert.strictEqual(service.cartUsesHighSprites('spr(17, x, y)'), false, 'low sprites do not');
  assert.strictEqual(service.cartUsesHighSprites(''), false, 'an empty cart does not');
});

test('the shared region note does not claim map rows were discarded', () => {
  const service = makeService();
  const sections = { gfx: ['0'.repeat(128)], map: ['0'.repeat(256)] };
  const graphics = {
    convertedGraphics: null,
    convertedMap: { width: 128, height: 16 },
    sharedRows: makeSharedRows(0xaa),
    sharedRowsUsed: false,
    usesHighSprites: true,
  };

  const warnings = service.detectCompatibilityWarnings('spr(141,0,0)', sections, 0, 0, graphics);
  const note = warnings.find((w) => w.includes('Map rows 32-63'));

  assert.ok(note, 'the ambiguity is still reported');
  assert.ok(
    !/only the first 32 map rows|truncat/i.test(note),
    `the note must not imply data loss, got: ${note}`
  );
  assert.ok(note.includes('no map rows were discarded'), 'it should say nothing was lost');
  assert.ok(note.includes('16 rows'), 'and report the real map height');
});

// -------------------------------------------------------------------------

async function run() {
  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`PASS  ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL  ${name}`);
      console.log(`      ${error.message}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run();
