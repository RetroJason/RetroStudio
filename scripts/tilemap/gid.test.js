/**
 * Tests for tile GID orientation flags and brush transforms.
 *
 * The interesting risk here is composition. Orientation is stored as three
 * bits, not an angle, so "rotate a tile that is already flipped" is not
 * obvious by inspection - which is exactly why gid.js recovers flags by
 * searching rather than by hand-written bit twiddling. These tests pin the
 * algebra: four rotations return to the start, mirrors are their own inverse,
 * and the eight representable orientations stay distinct.
 */

const assert = require('assert');
const TileGid = require('./gid.js');

const {
  TMX_FLIP_H, TMX_FLIP_V, TMX_FLIP_D,
  gidIndex, decodeGid, encodeGid, transformGid, transformBrushPattern,
} = TileGid;

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

/* ── encoding ───────────────────────────────────────────────────────── */

test('a plain gid carries no flags', () => {
  const d = decodeGid(42);
  assert.strictEqual(d.gid, 42);
  assert.strictEqual(d.flipH, false);
  assert.strictEqual(d.flipV, false);
  assert.strictEqual(d.flipD, false);
});

test('flag bits decode without disturbing the index', () => {
  const raw = (42 | TMX_FLIP_H | TMX_FLIP_D) >>> 0;
  const d = decodeGid(raw);
  assert.strictEqual(d.gid, 42);
  assert.strictEqual(d.flipH, true);
  assert.strictEqual(d.flipV, false);
  assert.strictEqual(d.flipD, true);
});

test('gidIndex strips every flag combination', () => {
  for (const flags of [0, TMX_FLIP_H, TMX_FLIP_V, TMX_FLIP_D,
    TMX_FLIP_H | TMX_FLIP_V, TMX_FLIP_H | TMX_FLIP_D,
    TMX_FLIP_V | TMX_FLIP_D, TMX_FLIP_H | TMX_FLIP_V | TMX_FLIP_D]) {
    assert.strictEqual(gidIndex((7 | flags) >>> 0), 7);
  }
});

test('encode and decode round-trip', () => {
  const flags = { flipH: true, flipV: false, flipD: true };
  const encoded = encodeGid(1234, flags);
  const decoded = decodeGid(encoded);
  assert.strictEqual(decoded.gid, 1234);
  assert.strictEqual(decoded.flipH, true);
  assert.strictEqual(decoded.flipV, false);
  assert.strictEqual(decoded.flipD, true);
});

test('encoding replaces existing flags rather than merging them', () => {
  const already = encodeGid(5, { flipH: true, flipV: true, flipD: true });
  const cleared = encodeGid(already, { flipH: false, flipV: false, flipD: false });
  assert.strictEqual(cleared, 5);
});

test('a gid above the signed 32-bit boundary stays unsigned', () => {
  const raw = encodeGid(1, { flipH: true });
  assert.ok(raw > 0, 'flag bit 31 must not produce a negative number');
  assert.strictEqual(raw, (1 | TMX_FLIP_H) >>> 0);
});

/* ── transform algebra ──────────────────────────────────────────────── */

test('rotating four times returns the original orientation', () => {
  let gid = 9;
  for (let i = 0; i < 4; i++) gid = transformGid(gid, 'rotate90');
  assert.strictEqual(gid, 9);
});

test('rotating four times returns the original even when pre-flipped', () => {
  const start = encodeGid(9, { flipH: true, flipV: false, flipD: true });
  let gid = start;
  for (let i = 0; i < 4; i++) gid = transformGid(gid, 'rotate90');
  assert.strictEqual(gid, start);
});

test('a mirror is its own inverse', () => {
  for (const op of ['flipX', 'flipY']) {
    assert.strictEqual(transformGid(transformGid(11, op), op), 11, op);
  }
});

test('one rotation is not the identity', () => {
  assert.notStrictEqual(transformGid(9, 'rotate90'), 9);
});

test('two rotations equal flipping both axes', () => {
  const rotatedTwice = transformGid(transformGid(9, 'rotate90'), 'rotate90');
  const mirroredBoth = transformGid(transformGid(9, 'flipX'), 'flipY');
  assert.strictEqual(rotatedTwice, mirroredBoth);
});

test('the eight orientations of a tile are all distinct', () => {
  const seen = new Set();
  for (const flipH of [false, true]) {
    for (const flipV of [false, true]) {
      for (const flipD of [false, true]) {
        seen.add(encodeGid(3, { flipH, flipV, flipD }));
      }
    }
  }
  assert.strictEqual(seen.size, 8);
});

test('transforms never change which tile is referenced', () => {
  let gid = encodeGid(77, { flipV: true });
  for (const op of ['rotate90', 'flipX', 'rotate90', 'flipY', 'rotate90']) {
    gid = transformGid(gid, op);
    assert.strictEqual(gidIndex(gid), 77, `after ${op}`);
  }
});

test('an empty tile is unaffected by transforms', () => {
  assert.strictEqual(transformGid(0, 'rotate90'), 0);
  assert.strictEqual(transformGid(0, 'flipX'), 0);
});

/* ── brush patterns ─────────────────────────────────────────────────── */

test('rotating a brush swaps its extents', () => {
  const pattern = { width: 3, height: 2, data: [1, 2, 3, 4, 5, 6] };
  const rotated = transformBrushPattern(pattern, 'rotate90');
  assert.strictEqual(rotated.width, 2);
  assert.strictEqual(rotated.height, 3);
  assert.strictEqual(rotated.data.length, 6);
});

test('mirroring a brush reverses each row', () => {
  const pattern = { width: 3, height: 2, data: [1, 2, 3, 4, 5, 6] };
  const flipped = transformBrushPattern(pattern, 'flipX');
  assert.strictEqual(flipped.width, 3);
  assert.strictEqual(flipped.height, 2);
  assert.deepStrictEqual(flipped.data.map(gidIndex), [3, 2, 1, 6, 5, 4]);
});

test('mirroring a brush vertically reverses row order', () => {
  const pattern = { width: 3, height: 2, data: [1, 2, 3, 4, 5, 6] };
  const flipped = transformBrushPattern(pattern, 'flipY');
  assert.deepStrictEqual(flipped.data.map(gidIndex), [4, 5, 6, 1, 2, 3]);
});

test('rotating a brush four times restores it exactly', () => {
  const pattern = { width: 3, height: 2, data: [1, 2, 3, 4, 5, 6] };
  let result = pattern;
  for (let i = 0; i < 4; i++) result = transformBrushPattern(result, 'rotate90');
  assert.strictEqual(result.width, 3);
  assert.strictEqual(result.height, 2);
  assert.deepStrictEqual(result.data, [1, 2, 3, 4, 5, 6]);
});

test('brush transforms reorient the individual tiles too', () => {
  const pattern = { width: 1, height: 1, data: [1] };
  const flipped = transformBrushPattern(pattern, 'flipX');
  assert.strictEqual(decodeGid(flipped.data[0]).flipH, true);
});

test('empty cells in a brush stay empty', () => {
  const pattern = { width: 2, height: 1, data: [0, 5] };
  const flipped = transformBrushPattern(pattern, 'flipX');
  assert.strictEqual(flipped.data[1], 0);
  assert.strictEqual(gidIndex(flipped.data[0]), 5);
});

/* ── runner ─────────────────────────────────────────────────────────── */

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
