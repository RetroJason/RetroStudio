// pico8-font.test.js
// Regression tests for the PICO-8 print() font as a shipped asset.
//
// print() rasterises glyphs on the CPU from the table in pico8-font.js, because
// it has to obey camera()/clip()/pal() and draw order. That is the right call
// for drawing, but it means the glyphs live only in Studio's JavaScript - and
// the build pipeline cannot carry JavaScript onto the watch. So the importer
// also writes the same table out as a .font asset.
//
// Two things can now go wrong silently, and each gets tests here:
//
//   1. The asset and the runtime table drift apart, so a cart's text looks one
//      way in the simulator and another way (or not at all) on hardware. The
//      atlas is described compactly in the .font as a grid plus a couple of
//      ranges, so the load-bearing check is that expanding that description
//      reproduces the glyph list byte for byte.
//
//   2. The atlas PNG is written wrong. It is a hand-rolled encoder, and a bad
//      stride or filter byte yields an image that still opens but has the
//      glyphs sheared, so it is decoded back here and compared pixel by pixel.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const JSZip = require('jszip');

const Pico8Font = require(path.join(__dirname, 'pico8-font.js'));
const Pico8Parser = require(path.join(__dirname, 'pico8-parser.js'));
const P8Png = require(path.join(__dirname, '..', 'services', 'pico8-p8png.js'));

function loadImportService() {
  globalThis.window = globalThis;
  globalThis.JSZip = JSZip;
  globalThis.alert = () => {};
  globalThis.Pico8Parser = Pico8Parser;
  globalThis.Pico8P8Png = P8Png;
  globalThis.Pico8Font = Pico8Font;

  globalThis.ProjectPaths = {
    getSourcesRootUi: () => 'Sources',
    resolveFolderForExtension: (extension) => {
      if (extension === '.lua') return 'Sources/Scripts';
      if (extension === '.font') return 'Sources/Fonts';
      return 'Sources/Binary';
    },
    normalizeStoragePath: (uiPath) => uiPath,
    // Cross-resource references are stored project-relative so a copied or
    // renamed project still resolves them.
    toProjectRelative: (fullPath) => String(fullPath).replace(/^[^/]+\/(?=Sources\/)/, ''),
  };

  const sourcePath = path.join(__dirname, '..', 'services', 'pico8-import-service.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  vm.runInThisContext(`${source}\n;globalThis.__Pico8ImportServiceClass = Pico8ImportService;`, {
    filename: sourcePath,
  });

  return globalThis.__Pico8ImportServiceClass;
}

function loadFontBuilder() {
  globalThis.window = globalThis;
  // FontBuilder extends BaseBuilder, which lives in build-system.js alongside a
  // large amount of browser-only wiring. The bitmap path touches none of it, so
  // a bare base class is enough to get the subclass defined.
  globalThis.BaseBuilder = class BaseBuilder {};

  // The file self-registers with the build system on a 200ms interval that runs
  // for 20 seconds. In a browser that is a harmless retry loop; in Node it just
  // holds the process open long after the tests finish.
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;

  try {
    const sourcePath = path.join(__dirname, '..', 'builders', 'font-builder.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    vm.runInThisContext(`${source}\n;globalThis.__FontBuilderClass = FontBuilder;`, {
      filename: sourcePath,
    });
  } finally {
    globalThis.setInterval = realSetInterval;
  }

  return globalThis.__FontBuilderClass;
}

const Pico8ImportService = loadImportService();
const FontBuilder = loadFontBuilder();

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

/**
 * Minimal stand-in for the draft object the importer writes into: it only has
 * to remember what was written and where.
 */
function makeDraft() {
  const files = new Map();
  return {
    files,
    getPreferredManagedFolderForExtension(projectName, extension) {
      return `${projectName}/${globalThis.ProjectPaths.resolveFolderForExtension(extension)}`;
    },
    get(folderPath, fileName) {
      return files.get(`${folderPath}/${fileName}`);
    },
  };
}

function makeService(draft) {
  const service = new Pico8ImportService();
  service.addTextFile = async (_draft, folderPath, fileName, content) => {
    draft.files.set(`${folderPath}/${fileName}`, content);
  };
  service.addBinaryFile = async (_draft, folderPath, fileName, bytes) => {
    draft.files.set(`${folderPath}/${fileName}`, bytes);
  };
  return service;
}

// -------------------------------------------------------------------------
// The asset must not drift from the table print() draws with
// -------------------------------------------------------------------------

test('the .font grid expands to exactly the glyphs the runtime font reports', async () => {
  const atlas = Pico8Font.buildAtlas();

  const draft = makeDraft();
  const service = makeService(draft);
  const result = await service.importFont(draft, 'Cart', 'cart.p8');

  const metadata = JSON.parse(draft.get('Cart/Sources/Fonts', 'pico8_font.font'));
  const expanded = new FontBuilder()._expandAtlasGlyphs(
    metadata,
    'Cart/Sources/Fonts/pico8_font',
    atlas.width,
    atlas.height
  );

  assert.strictEqual(expanded.length, atlas.glyphs.length);
  assert.deepStrictEqual(expanded, atlas.glyphs);
  assert.strictEqual(result.glyphCount, atlas.glyphs.length);
});

test('every code print() can draw has a glyph in the asset', () => {
  const atlas = Pico8Font.buildAtlas();
  const byCode = new Map(atlas.glyphs.map((glyph) => [glyph.id, glyph]));

  for (let code = 0x20; code <= 0x9f; code += 1) {
    const glyph = byCode.get(code);
    assert.ok(glyph, `no glyph for code ${code}`);
    // Layout is what carts hard-code (`x + #s * 4`), so an advance that
    // disagrees with the renderer would shift every HUD on hardware.
    assert.strictEqual(
      glyph.xadvance,
      Pico8Font.advanceFor(code),
      `advance mismatch for code ${code}`
    );
  }
});

test('glyph cells never overlap their neighbours in the atlas', () => {
  const atlas = Pico8Font.buildAtlas();

  for (const glyph of atlas.glyphs) {
    assert.ok(
      glyph.x + glyph.width <= atlas.width,
      `glyph ${glyph.id} runs past the right edge`
    );
    assert.ok(
      glyph.y + glyph.height <= atlas.height,
      `glyph ${glyph.id} runs past the bottom edge`
    );
    // The ink has to fit inside its cell, otherwise a blit picks up the
    // neighbouring character's pixels.
    assert.ok(glyph.width <= atlas.cellWidth, `glyph ${glyph.id} is wider than its cell`);
    assert.ok(glyph.height <= atlas.cellHeight, `glyph ${glyph.id} is taller than its cell`);
  }
});

// -------------------------------------------------------------------------
// The atlas image itself
// -------------------------------------------------------------------------

test('the atlas png decodes back to the pixels the font rasterised', async () => {
  const atlas = Pico8Font.buildAtlas();

  const draft = makeDraft();
  const service = makeService(draft);
  await service.importFont(draft, 'Cart', 'cart.p8');

  const png = draft.get('Cart/Sources/Fonts', 'pico8_font.png');
  const decoded = await P8Png.decodePng(png);

  assert.strictEqual(decoded.width, atlas.width);
  assert.strictEqual(decoded.height, atlas.height);
  assert.deepStrictEqual(Array.from(decoded.pixels), Array.from(atlas.rgba));
});

test('ink lands in the alpha channel, because the build emits an alpha8 texture', async () => {
  const atlas = Pico8Font.buildAtlas();
  const glyph = atlas.glyphs.find((entry) => entry.id === 'a'.charCodeAt(0));
  const rows = Pico8Font.rowsFor('a'.charCodeAt(0));

  let inkPixels = 0;
  for (let y = 0; y < glyph.height; y += 1) {
    for (let x = 0; x < glyph.width; x += 1) {
      const offset = (((glyph.y + y) * atlas.width) + glyph.x + x) * 4;
      const isInk = (rows[y] & (1 << x)) !== 0;
      assert.strictEqual(
        atlas.rgba[offset + 3],
        isInk ? 0xff : 0x00,
        `alpha mismatch at ${x},${y} of glyph 'a'`
      );
      if (isInk) inkPixels += 1;
    }
  }

  // Guards against a glyph that is technically well-formed but blank, which
  // would render as invisible text rather than an obvious error.
  assert.ok(inkPixels > 0, "glyph 'a' has no ink");
});

test('the space glyph occupies its advance but draws nothing', () => {
  const atlas = Pico8Font.buildAtlas();
  const glyph = atlas.glyphs.find((entry) => entry.id === 0x20);

  assert.strictEqual(glyph.xadvance, Pico8Font.NARROW_ADVANCE);

  for (let y = 0; y < glyph.height; y += 1) {
    for (let x = 0; x < glyph.width; x += 1) {
      const offset = (((glyph.y + y) * atlas.width) + glyph.x + x) * 4;
      assert.strictEqual(atlas.rgba[offset + 3], 0x00, 'space has ink in it');
    }
  }
});

// -------------------------------------------------------------------------
// What the importer writes
// -------------------------------------------------------------------------

test('the font is written as an atlas beside its .font, not loose in Images', async () => {
  const draft = makeDraft();
  const service = makeService(draft);
  const result = await service.importFont(draft, 'Cart', 'cart.p8');

  assert.ok(draft.get('Cart/Sources/Fonts', 'pico8_font.font'), '.font was not written');
  assert.ok(draft.get('Cart/Sources/Fonts', 'pico8_font.png'), 'atlas was not written');

  const metadata = JSON.parse(draft.get('Cart/Sources/Fonts', 'pico8_font.font'));
  assert.strictEqual(metadata.type, 'retrowatch-font');
  assert.strictEqual(metadata.source, 'bitmap');
  // Stored project-relative so a copied or renamed project still resolves it.
  assert.strictEqual(metadata.sourceAtlasPath, 'Sources/Fonts/pico8_font.png');
  assert.strictEqual(result.fontFile, 'pico8_font.font');
});

test('a bitmap font declares no TrueType source, so the build cannot take the outline path', async () => {
  const draft = makeDraft();
  const service = makeService(draft);
  await service.importFont(draft, 'Cart', 'cart.p8');

  const metadata = JSON.parse(draft.get('Cart/Sources/Fonts', 'pico8_font.font'));
  assert.ok(!metadata.sourceFontPath, 'bitmap font should not name a TTF');
  assert.strictEqual(metadata.outputPixelFormat, 'd2_mode_alpha8');
});

// -------------------------------------------------------------------------
// Authoring mistakes in a hand-written .font
// -------------------------------------------------------------------------

test('a range reaching past the end of the grid is rejected', () => {
  const builder = new FontBuilder();
  const metadata = {
    atlas: { columns: 4, cellWidth: 8, cellHeight: 6, firstCode: 32 },
    ranges: [{ first: 32, last: 200, width: 3, height: 5, xadvance: 4 }],
  };

  assert.throws(
    () => builder._expandAtlasGlyphs(metadata, 'x/font', 32, 12),
    /falls outside the 4x2 atlas grid/
  );
});

test('ranges that cover the same code twice are rejected', () => {
  const builder = new FontBuilder();
  const metadata = {
    atlas: { columns: 4, cellWidth: 8, cellHeight: 6, firstCode: 32 },
    ranges: [
      { first: 32, last: 35, width: 3, height: 5, xadvance: 4 },
      { first: 35, last: 36, width: 7, height: 5, xadvance: 8 },
    ],
  };

  assert.throws(
    () => builder._expandAtlasGlyphs(metadata, 'x/font', 32, 12),
    /cover code 35 twice/
  );
});

test('a grid wider than its atlas image is rejected', () => {
  const builder = new FontBuilder();
  const metadata = {
    atlas: { columns: 16, cellWidth: 8, cellHeight: 6, firstCode: 32 },
    ranges: [{ first: 32, last: 33, width: 3, height: 5, xadvance: 4 }],
  };

  assert.throws(
    () => builder._expandAtlasGlyphs(metadata, 'x/font', 32, 12),
    /but the image is only 32px/
  );
});

test('a bitmap .font with no atlas path is rejected rather than built empty', async () => {
  const builder = new FontBuilder();
  await assert.rejects(
    () => builder._generateOutputsFromAtlas({ type: 'retrowatch-font', source: 'bitmap' }, 'x/font'),
    /missing sourceAtlasPath/
  );
});

test('build() writes palette index into indexed D2 output', async () => {
  const builder = new FontBuilder();
  const saved = new Map();

  builder._toBuildOutputPath = (p) => p;
  builder._saveFile = async (p, bytes) => {
    saved.set(p, bytes);
  };
  builder._generateOutputsFromMetadata = async () => {
    const d2Bytes = new Uint8Array(64);
    d2Bytes[0] = 0x44; d2Bytes[1] = 0x32; d2Bytes[2] = 0x54; d2Bytes[3] = 0x58; // D2TX
    return {
      d2Bytes,
      fntBytes: null,
      outputPixelFormat: 'd2_mode_i1',
      paletteIndex: 7,
    };
  };

  const file = {
    path: 'Cart/Sources/Fonts/test.font',
    content: JSON.stringify({ type: 'retrowatch-font', outputPixelFormat: 'd2_mode_i1' }),
  };

  const result = await builder.build(file);
  assert.strictEqual(result.success, true);

  const written = saved.get('Cart/Sources/Fonts/test.d2');
  assert.ok(written instanceof Uint8Array, 'expected .d2 output bytes to be saved');

  const header = new DataView(written.buffer, written.byteOffset, written.byteLength);
  assert.strictEqual(header.getUint16(10, true), 7, 'palette index should be present in D2 header');
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
