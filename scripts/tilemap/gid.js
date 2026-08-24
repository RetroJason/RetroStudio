/**
 * Tile GID flags and brush transforms.
 *
 * A GID is not just a tile index. Tiled packs three orientation bits into the
 * high end of the 32-bit value, so the same artwork can be reused mirrored or
 * rotated without extra tiles. Anything that reads map data has to mask those
 * bits off before resolving a tileset, and anything that draws has to honour
 * them - forgetting either is how a flipped tile turns into a garbage blit.
 *
 * Rotation is expressed through the same three bits rather than an angle:
 * the diagonal flag transposes the tile, and combining it with the mirror
 * flags produces all four rotations. Composing two operations is therefore not
 * a simple OR, so transforms are applied in unit-square space and the matching
 * flag combination is recovered by searching the eight possibilities.
 *
 * Extracted from the standalone map editor prototype so the Studio editor, the
 * build pipeline and the runtime all share one implementation.
 */

const TMX_FLIP_H = 0x80000000;
const TMX_FLIP_V = 0x40000000;
const TMX_FLIP_D = 0x20000000;
const TMX_FLIP_MASK = TMX_FLIP_H | TMX_FLIP_V | TMX_FLIP_D;

/** Strip the orientation bits, leaving a plain tile index. */
function gidIndex(rawGid) {
  return ((Number(rawGid) >>> 0) & ~TMX_FLIP_MASK) >>> 0;
}

/** Split a raw GID into its tile index and orientation flags. */
function decodeGid(rawGid) {
  const gid = Number(rawGid) >>> 0;
  return {
    gid: (gid & ~TMX_FLIP_MASK) >>> 0,
    flipH: (gid & TMX_FLIP_H) !== 0,
    flipV: (gid & TMX_FLIP_V) !== 0,
    flipD: (gid & TMX_FLIP_D) !== 0,
  };
}

/** Recombine a tile index with orientation flags. */
function encodeGid(baseGid, flags) {
  let gid = (Number(baseGid) >>> 0) & ~TMX_FLIP_MASK;
  if (flags && flags.flipH) gid |= TMX_FLIP_H;
  if (flags && flags.flipV) gid |= TMX_FLIP_V;
  if (flags && flags.flipD) gid |= TMX_FLIP_D;
  return gid >>> 0;
}

/** Map a point in the tile's unit square through its orientation flags. */
function applyTileFlagsToUnitPoint(x, y, flags) {
  let u = x;
  let v = y;
  if (flags && flags.flipD) {
    const t = u;
    u = v;
    v = t;
  }
  if (flags && flags.flipH) u = 1 - u;
  if (flags && flags.flipV) v = 1 - v;
  return { u, v };
}

const FLAG_CANDIDATES = [
  { flipH: false, flipV: false, flipD: false },
  { flipH: true, flipV: false, flipD: false },
  { flipH: false, flipV: true, flipD: false },
  { flipH: true, flipV: true, flipD: false },
  { flipH: false, flipV: false, flipD: true },
  { flipH: true, flipV: false, flipD: true },
  { flipH: false, flipV: true, flipD: true },
  { flipH: true, flipV: true, flipD: true },
];

/**
 * Recover the flag combination equivalent to an arbitrary unit-square
 * transform. Only eight orientations are representable, and the corners
 * determine the mapping, so testing all four corners against each candidate
 * identifies it exactly.
 */
function findFlagsForTransform(transformFn) {
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const epsilon = 0.0001;

  for (const flags of FLAG_CANDIDATES) {
    let matches = true;
    for (const [x, y] of corners) {
      const expected = transformFn(x, y);
      const got = applyTileFlagsToUnitPoint(x, y, flags);
      if (Math.abs(expected.u - got.u) > epsilon || Math.abs(expected.v - got.v) > epsilon) {
        matches = false;
        break;
      }
    }
    if (matches) return flags;
  }

  return { flipH: false, flipV: false, flipD: false };
}

function operationFn(op) {
  if (op === 'rotate90') return (x, y) => ({ u: 1 - y, v: x });
  if (op === 'flipX') return (x, y) => ({ u: 1 - x, v: y });
  if (op === 'flipY') return (x, y) => ({ u: x, v: 1 - y });
  return (x, y) => ({ u: x, v: y });
}

/**
 * Apply 'rotate90' | 'flipX' | 'flipY' to a GID, composing with any
 * orientation it already carries. Empty tiles pass through untouched.
 */
function transformGid(rawGid, op) {
  const decoded = decodeGid(rawGid);
  if (decoded.gid <= 0) return Number(rawGid) >>> 0;

  const baseFlags = { flipH: decoded.flipH, flipV: decoded.flipV, flipD: decoded.flipD };
  const opFn = operationFn(op);
  const composed = (x, y) => {
    const t = applyTileFlagsToUnitPoint(x, y, baseFlags);
    return opFn(t.u, t.v);
  };

  return encodeGid(decoded.gid, findFlagsForTransform(composed));
}

/**
 * Transform a rectangular brush. Every tile is reoriented individually and the
 * pattern itself is rearranged; a 90 degree rotation also swaps the extents.
 */
function transformBrushPattern(pattern, op) {
  if (!pattern || !Array.isArray(pattern.data) || pattern.width <= 0 || pattern.height <= 0) {
    return pattern;
  }

  const oldW = pattern.width;
  const oldH = pattern.height;
  const rotate = op === 'rotate90';
  const nextW = rotate ? oldH : oldW;
  const nextH = rotate ? oldW : oldH;
  const nextData = new Array(nextW * nextH).fill(0);

  for (let y = 0; y < oldH; y++) {
    for (let x = 0; x < oldW; x++) {
      const src = pattern.data[y * oldW + x] || 0;
      const transformed = src > 0 ? transformGid(src, op) : 0;

      let nx = x;
      let ny = y;
      if (rotate) {
        nx = oldH - 1 - y;
        ny = x;
      } else if (op === 'flipX') {
        nx = oldW - 1 - x;
      } else if (op === 'flipY') {
        ny = oldH - 1 - y;
      }

      nextData[ny * nextW + nx] = transformed;
    }
  }

  return { width: nextW, height: nextH, data: nextData };
}

const TileGid = {
  TMX_FLIP_H,
  TMX_FLIP_V,
  TMX_FLIP_D,
  TMX_FLIP_MASK,
  gidIndex,
  decodeGid,
  encodeGid,
  applyTileFlagsToUnitPoint,
  findFlagsForTransform,
  transformGid,
  transformBrushPattern,
};

// Export for Node.js or browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TileGid;
}

if (typeof window !== 'undefined') {
  window.TileGid = TileGid;
}
