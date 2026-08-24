/**
 * Round-trip tests for the D2M tilemap binary.
 *
 * WHY THIS EXISTS
 * ---------------
 * tilemap-builder.js writes .d2m and lua/tilemap.js reads it back, but until
 * now nothing tested the pair. lua-api.test.js seeds `tilemapAssets` with a
 * hand-built object so it never touches the parser, and its comment claiming
 * "the binary parser is covered by its own tests" was simply untrue - this is
 * that file, written after the fact.
 *
 * That matters more than usual here because D2M is a hand-rolled format with
 * manual byte offsets: writer and reader agree only by inspection, and a
 * disagreement corrupts map data silently rather than throwing. Everything
 * below builds a real map, serialises it, parses it back and compares.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

/* ══════════════════════════════════════════════════════════════════════
   Harness
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Texture references resolve as siblings of the map file, and toBuildPath only
 * rewrites a leading `Resources/`, so the fixture keeps the texture beside the
 * map to exercise that rewrite honestly.
 */
const MAP_PATH = 'Resources/Maps/level.tilemap';
const TEXTURE_SOURCE = 'Resources/Maps/tiles.texture';
const TEXTURE_BUILD = 'build/Maps/tiles.d2';

/**
 * tilemap-builder.js is a browser script: it declares a bare class and then
 * self-registers. `require` would run it but hand back an empty exports, so
 * the source is evaluated with the globals it expects and the class returned.
 *
 * The serviceContainer stub matters for more than texture lookup - registration
 * succeeds on the first try, which returns before the 20-second setInterval
 * retry loop that would otherwise keep Node alive after the tests finish.
 */
function loadTilemapBuilder() {
  const source = fs.readFileSync(path.resolve(__dirname, 'tilemap-builder.js'), 'utf8');

  const buildSystem = {
    registerBuilder() {},
    builderById: new Map(),
    getAllResourceFilePaths: () => [TEXTURE_SOURCE],
  };

  const win = {
    serviceContainer: {
      has: (name) => name === 'buildSystem',
      get: (name) => (name === 'buildSystem' ? buildSystem : null),
      addEventListener() {},
    },
  };

  const factory = new Function(
    'window', 'BaseBuilder', 'console', 'TextEncoder', 'setInterval', 'clearInterval',
    `${source}\n;return TilemapBuilder;`
  );

  return factory(
    win,
    class BaseBuilder {},
    { log() {}, warn() {}, error() {} },
    TextEncoder,
    () => 0,
    () => {}
  );
}

/** lua/tilemap.js owns the D2M parser; only the pure parse methods are used. */
function loadTileMapRuntime() {
  global.window = global.window || {};
  const basePath = path.resolve(__dirname, '..', 'lua', 'base-lua-extension.js');
  delete require.cache[basePath];
  global.BaseLuaExtension = require(basePath) || global.window.BaseLuaExtension;

  const tilemapPath = path.resolve(__dirname, '..', 'lua', 'tilemap.js');
  delete require.cache[tilemapPath];
  const exported = require(tilemapPath);
  const TileMap = (typeof exported === 'function' ? exported : null)
    || global.window.LuaTileMapExtensions;

  return new TileMap({ allocateRenderOrder: () => 1, getService: () => null });
}

const TilemapBuilder = loadTilemapBuilder();
const runtime = loadTileMapRuntime();

/**
 * A map with deliberately awkward shape: two layers so the second layer's cell
 * data cannot start at the chunk origin, two tilesets so firstGid resolution is
 * exercised, and a hidden layer so the flag round-trips.
 */
function makeSourceMap(overrides = {}) {
  const width = 5;
  const height = 4;
  const cells = width * height;

  const ground = new Array(cells);
  for (let i = 0; i < cells; i++) ground[i] = (i % 7) + 1;

  const overlay = new Array(cells).fill(0);
  overlay[0] = 33;
  overlay[cells - 1] = 40;

  return {
    schema: 'retrostudio-map-v1',
    app: 'RetroStudio',
    mapData: {
      map: { width, height, tileWidth: 16, tileHeight: 16, orientation: 'orthogonal' },
      tilesets: [
        {
          firstGid: 1, name: 'ground', tileWidth: 16, tileHeight: 16,
          columns: 8, tileCount: 32, texturePath: 'tiles.texture',
        },
        {
          firstGid: 33, name: 'overlay', tileWidth: 16, tileHeight: 16,
          columns: 8, tileCount: 32, texturePath: 'tiles.texture',
        },
      ],
      layers: [
        { name: 'Ground', visible: true, data: ground },
        { name: 'Overlay', visible: false, data: overlay },
      ],
      ...overrides,
    },
  };
}

/** Build source JSON all the way to D2M bytes. */
function buildD2m(sourceMap, mapPath = MAP_PATH) {
  const builder = new TilemapBuilder();
  const parsed = builder.parseTilemapJson(JSON.stringify(sourceMap), mapPath);
  const normalized = builder.normalizeMap(parsed, mapPath);
  return { bytes: builder.buildD2M(normalized), normalized };
}

/** Parse D2M bytes the way the Lua runtime does. */
function parseD2m(bytes) {
  const header = runtime._parseD2mHeader(bytes);
  return {
    header,
    tilesets: runtime._parseTilesets(bytes, header),
    layers: runtime._parseLayers(bytes, header),
    strings: runtime._parseStrings(bytes, header),
    wang: header.wangOffset ? runtime._parseWang(bytes, header) : null,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   Tests
   ══════════════════════════════════════════════════════════════════════ */

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('header survives the round trip', () => {
  const { bytes } = buildD2m(makeSourceMap());
  const { header } = parseD2m(bytes);

  assert.strictEqual(header.magic, 'D2MP');
  assert.strictEqual(header.version, 1);
  assert.strictEqual(header.mapWidth, 5);
  assert.strictEqual(header.mapHeight, 4);
  assert.strictEqual(header.tileWidth, 16);
  assert.strictEqual(header.tileHeight, 16);
  assert.strictEqual(header.layerCount, 2);
  assert.strictEqual(header.tilesetCount, 2);
});

test('tileset records survive the round trip', () => {
  const { bytes } = buildD2m(makeSourceMap());
  const { tilesets, strings } = parseD2m(bytes);

  assert.strictEqual(tilesets.length, 2);
  assert.strictEqual(tilesets[0].firstGid, 1);
  assert.strictEqual(tilesets[1].firstGid, 33);
  assert.strictEqual(tilesets[0].tileWidth, 16);
  assert.strictEqual(tilesets[0].columns, 8);
  assert.strictEqual(strings[tilesets[0].nameStringId], 'ground');
  assert.strictEqual(strings[tilesets[1].nameStringId], 'overlay');
  assert.strictEqual(strings[tilesets[0].texturePathStringId], TEXTURE_BUILD);
});

// This is the test that matters. The builder stores each layer's cell offset
// relative to the start of the layer chunk; the parser has to resolve it the
// same way or it reads whatever bytes happen to live at that file offset.
test('layer cell data survives the round trip', () => {
  const source = makeSourceMap();
  const { bytes } = buildD2m(source);
  const { layers, strings } = parseD2m(bytes);

  assert.strictEqual(layers.length, 2);
  assert.strictEqual(strings[layers[0].nameStringId], 'Ground');
  assert.strictEqual(strings[layers[1].nameStringId], 'Overlay');

  const expectedGround = source.mapData.layers[0].data;
  const expectedOverlay = source.mapData.layers[1].data;

  assert.deepStrictEqual(Array.from(layers[0].cellData), expectedGround);
  assert.deepStrictEqual(Array.from(layers[1].cellData), expectedOverlay);
});

test('layer visibility flag survives the round trip', () => {
  const { bytes } = buildD2m(makeSourceMap());
  const { layers } = parseD2m(bytes);

  assert.strictEqual(layers[0].flags & 1, 1, 'Ground should be visible');
  assert.strictEqual(layers[1].flags & 1, 0, 'Overlay should be hidden');
});

test('a map with no wang data reports no wang chunk', () => {
  const { bytes } = buildD2m(makeSourceMap());
  const { header } = parseD2m(bytes);
  assert.strictEqual(header.wangOffset, 0);
});

test('wang blocks survive the round trip', () => {
  const source = makeSourceMap();
  source.mapData.tilesets[0].retroWangBlocks = [
    { name: 'grass', colors: [1, 2], tiles: [{ localId: 0, wangid: [1, 1, 1, 1, 1, 1, 1, 1] }] },
  ];

  const { bytes } = buildD2m(source);
  const { header, wang } = parseD2m(bytes);

  assert.notStrictEqual(header.wangOffset, 0, 'wang chunk should be present');
  assert.ok(Array.isArray(wang), 'wang payload should be an array');
  assert.strictEqual(wang[0].firstGid, 1);
  assert.strictEqual(wang[0].blocks[0].name, 'grass');
});

test('a tileset referencing an unbuilt texture is a clear error', () => {
  const source = makeSourceMap();
  source.mapData.tilesets[0].texturePath = 'missing.texture';
  assert.throws(() => buildD2m(source), /was not found/);
});

/* ── draw path ──────────────────────────────────────────────────────────
   The renderer has to turn a cell value back into "which tileset, which tile
   in its atlas". That resolution is by firstGid; getting it wrong shifts every
   tile or picks the wrong sheet, and neither throws.
   ────────────────────────────────────────────────────────────────────── */

/** Run the runtime draw path over a parsed map, capturing gpu.blit calls. */
function captureBlits(parsed, layerIndex) {
  const blits = [];
  runtime.gpu = { blit: (texture, opts) => blits.push({ texture, ...opts }) };
  runtime.gpuTextures = new Map();
  for (const ts of parsed.tilesets) {
    runtime.gpuTextures.set(ts.textureIndex, `tex#${ts.textureIndex}`);
  }

  runtime._drawLayerInternal(
    { header: parsed.header, layers: parsed.layers, tilesets: parsed.tilesets },
    layerIndex,
    0,
    0
  );
  return blits;
}

test('the draw path resolves a tile through its tileset firstGid', () => {
  const source = makeSourceMap();
  // A single known tile so the source rect can be predicted exactly.
  const cells = 5 * 4;
  source.mapData.layers = [
    { name: 'Ground', visible: true, data: new Array(cells).fill(0).map((_, i) => (i === 0 ? 3 : 0)) },
  ];

  const { bytes } = buildD2m(source);
  const blits = captureBlits(parseD2m(bytes), 0);

  assert.strictEqual(blits.length, 1, 'exactly one tile should draw');
  // gid 3 in a tileset with firstGid 1 is local tile 2, which in an 8-column
  // atlas of 16px tiles sits at column 2 of row 0.
  assert.strictEqual(blits[0].srcX, 2 * 16);
  assert.strictEqual(blits[0].srcY, 0);
});

test('the draw path selects the correct tileset for a high gid', () => {
  const source = makeSourceMap();
  const cells = 5 * 4;
  source.mapData.layers = [
    { name: 'Ground', visible: true, data: new Array(cells).fill(0).map((_, i) => (i === 0 ? 34 : 0)) },
  ];

  const { bytes } = buildD2m(source);
  const parsed = parseD2m(bytes);
  const blits = captureBlits(parsed, 0);

  assert.strictEqual(blits.length, 1);
  // gid 34 belongs to the second tileset (firstGid 33), local tile 1.
  assert.strictEqual(blits[0].srcX, 1 * 16);
  assert.strictEqual(blits[0].srcY, 0);
});

test('orientation bits do not change which tile the draw path picks', () => {
  const TMX_FLIP_H = 0x80000000;
  const source = makeSourceMap();
  const cells = 5 * 4;
  source.mapData.layers = [
    {
      name: 'Ground',
      visible: true,
      data: new Array(cells).fill(0).map((_, i) => (i === 0 ? ((3 | TMX_FLIP_H) >>> 0) : 0)),
    },
  ];

  const { bytes } = buildD2m(source);
  const blits = captureBlits(parseD2m(bytes), 0);

  assert.strictEqual(blits.length, 1, 'a flipped tile must still draw');
  assert.strictEqual(blits[0].srcX, 2 * 16, 'flag bits must not shift the source rect');
  assert.strictEqual(blits[0].srcY, 0);
});

test('a hidden layer draws nothing', () => {
  const { bytes } = buildD2m(makeSourceMap());
  const blits = captureBlits(parseD2m(bytes), 1); // Overlay is hidden
  assert.strictEqual(blits.length, 0);
});

/* ══════════════════════════════════════════════════════════════════════
   Runner
   ══════════════════════════════════════════════════════════════════════ */

let passed = 0;
let failed = 0;

for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);
process.exit(failed === 0 ? 0 : 1);
