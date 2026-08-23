// pico8-font.js - built-in bitmap font for imported PICO-8 carts.
//
// WHY THIS EXISTS RATHER THAN REUSING TextBox
// -------------------------------------------
// The platform's TextBox API is retained-mode (Create/Destroy handles that live
// in the scene), GPU-composited on its own layer, and takes 0x00RRGGBB colours.
// PICO-8's print() is the opposite on every axis: it is called dozens of times
// per frame in immediate mode, writes into the same palette framebuffer as
// spr()/rectfill(), takes a 0-15 palette index, and must obey camera(), clip()
// and pal(). Above all it has to respect draw order - carts routinely draw
// sprites *over* text they printed earlier in the same frame, which a separate
// composited layer can never reproduce. So print() rasterises these glyphs on
// the CPU through the same _plot() path as every other PICO-8 draw call.
//
// METRICS
// -------
// Deliberately identical to PICO-8, because cart layout code hard-codes them
// (`x + #str * 4`, `y + 6` between lines, `print(s, 64 - #s * 2, ...)` to
// centre):
//   narrow glyphs  3x5 ink on a 4x6 advance   (ASCII 0x20-0x7f)
//   wide glyphs    7x5 ink on an 8x6 advance  (0x80 and above)
//
// The glyph shapes below are an original 3x5 design, not a copy of the PICO-8
// ROM font. At 3x5 there is very little room to differ and still be legible.
//
// KNOWN DEVIATIONS
// ----------------
// - PICO-8 draws A-Z and a-z with two *different* glyph sets. Here both cases
//   fold to the same capitals, so text stays readable but a cart that switches
//   case for a stylistic effect will not show the difference.
// - Characters 0x80..0x99 (the button/heart/symbol block) are approximations of
//   PICO-8's shapes at the same 7x5 size and 8px advance, not pixel copies.
// - Characters 0x9a and up are PICO-8's kana. They measure correctly but render
//   as a hollow box placeholder, and the exported atlas stops at 0x9f.
// - P8SCII control codes (\^c colour switches, wide/tall modes, ...) are
//   consumed without effect. Only \n and \t do anything.

(function registerPico8Font(root) {
  'use strict';

  const GLYPH_HEIGHT = 5;
  const LINE_HEIGHT = 6;
  const NARROW_ADVANCE = 4;
  const WIDE_ADVANCE = 8;

  // Rows are written leftmost-pixel-first; '#' is ink, '.' is transparent.
  const GLYPH_ROWS = {
    ' ': ['...', '...', '...', '...', '...'],
    '!': ['.#.', '.#.', '.#.', '...', '.#.'],
    '"': ['#.#', '#.#', '...', '...', '...'],
    '#': ['#.#', '###', '#.#', '###', '#.#'],
    $: ['.##', '##.', '.#.', '.##', '##.'],
    '%': ['#.#', '..#', '.#.', '#..', '#.#'],
    '&': ['##.', '##.', '###', '#.#', '.##'],
    "'": ['.#.', '.#.', '...', '...', '...'],
    '(': ['..#', '.#.', '.#.', '.#.', '..#'],
    ')': ['#..', '.#.', '.#.', '.#.', '#..'],
    '*': ['#.#', '.#.', '#.#', '...', '...'],
    '+': ['...', '.#.', '###', '.#.', '...'],
    ',': ['...', '...', '...', '.#.', '#..'],
    '-': ['...', '...', '###', '...', '...'],
    '.': ['...', '...', '...', '...', '.#.'],
    '/': ['..#', '..#', '.#.', '#..', '#..'],

    0: ['###', '#.#', '#.#', '#.#', '###'],
    1: ['.#.', '##.', '.#.', '.#.', '###'],
    2: ['##.', '..#', '.#.', '#..', '###'],
    3: ['##.', '..#', '.#.', '..#', '##.'],
    4: ['#.#', '#.#', '###', '..#', '..#'],
    5: ['###', '#..', '##.', '..#', '##.'],
    6: ['.##', '#..', '###', '#.#', '###'],
    7: ['###', '..#', '..#', '.#.', '.#.'],
    8: ['###', '#.#', '###', '#.#', '###'],
    9: ['###', '#.#', '###', '..#', '##.'],

    ':': ['...', '.#.', '...', '.#.', '...'],
    ';': ['...', '.#.', '...', '.#.', '#..'],
    '<': ['..#', '.#.', '#..', '.#.', '..#'],
    '=': ['...', '###', '...', '###', '...'],
    '>': ['#..', '.#.', '..#', '.#.', '#..'],
    '?': ['##.', '..#', '.#.', '...', '.#.'],
    '@': ['.#.', '#.#', '###', '#..', '.##'],

    a: ['.#.', '#.#', '###', '#.#', '#.#'],
    b: ['##.', '#.#', '##.', '#.#', '##.'],
    c: ['.##', '#..', '#..', '#..', '.##'],
    d: ['##.', '#.#', '#.#', '#.#', '##.'],
    e: ['###', '#..', '##.', '#..', '###'],
    f: ['###', '#..', '##.', '#..', '#..'],
    g: ['.##', '#..', '#.#', '#.#', '.##'],
    h: ['#.#', '#.#', '###', '#.#', '#.#'],
    i: ['###', '.#.', '.#.', '.#.', '###'],
    j: ['..#', '..#', '..#', '#.#', '.#.'],
    k: ['#.#', '#.#', '##.', '#.#', '#.#'],
    l: ['#..', '#..', '#..', '#..', '###'],
    m: ['#.#', '###', '###', '#.#', '#.#'],
    n: ['#.#', '###', '###', '###', '#.#'],
    o: ['.#.', '#.#', '#.#', '#.#', '.#.'],
    p: ['##.', '#.#', '##.', '#..', '#..'],
    q: ['.#.', '#.#', '#.#', '##.', '.##'],
    r: ['##.', '#.#', '##.', '#.#', '#.#'],
    s: ['.##', '#..', '.#.', '..#', '##.'],
    t: ['###', '.#.', '.#.', '.#.', '.#.'],
    u: ['#.#', '#.#', '#.#', '#.#', '###'],
    v: ['#.#', '#.#', '#.#', '#.#', '.#.'],
    w: ['#.#', '#.#', '###', '###', '#.#'],
    x: ['#.#', '#.#', '.#.', '#.#', '#.#'],
    y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
    z: ['###', '..#', '.#.', '#..', '###'],

    '[': ['.##', '.#.', '.#.', '.#.', '.##'],
    '\\': ['#..', '#..', '.#.', '..#', '..#'],
    ']': ['##.', '.#.', '.#.', '.#.', '##.'],
    '^': ['.#.', '#.#', '...', '...', '...'],
    _: ['...', '...', '...', '...', '###'],
    '`': ['#..', '.#.', '...', '...', '...'],
    '{': ['..#', '.#.', '##.', '.#.', '..#'],
    '|': ['.#.', '.#.', '.#.', '.#.', '.#.'],
    '}': ['#..', '.#.', '.##', '.#.', '#..'],
    '~': ['...', '..#', '###', '#..', '...'],
  };

  /**
   * Pack '#'/'.' rows into one bitmask per row, bit 0 = leftmost pixel.
   * The renderer walks bits rather than characters so print() does no string
   * work per pixel.
   */
  function packRows(rows) {
    const packed = new Uint8Array(GLYPH_HEIGHT);
    for (let y = 0; y < GLYPH_HEIGHT; y += 1) {
      const row = rows[y] || '';
      let bits = 0;
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] === '#') {
          bits |= (1 << x);
        }
      }
      packed[y] = bits;
    }
    return packed;
  }

  const glyphsByCode = new Map();
  for (const character of Object.keys(GLYPH_ROWS)) {
    glyphsByCode.set(character.charCodeAt(0), packRows(GLYPH_ROWS[character]));
  }

  // A-Z reuse the a-z shapes. See KNOWN DEVIATIONS above.
  for (let code = 0x41; code <= 0x5a; code += 1) {
    const lower = glyphsByCode.get(code + 0x20);
    if (lower) {
      glyphsByCode.set(code, lower);
    }
  }

  // Placeholder for the 0x80+ symbol block: a hollow 7x5 box.
  const WIDE_PLACEHOLDER = packRows(['#######', '#.....#', '#.....#', '#.....#', '#######']);

  // The 0x80..0x99 symbol block, keyed by PICO-8 character code. These are the
  // ones carts actually print - button prompts, hearts, stars - so they get real
  // shapes rather than the placeholder. 0x9a and up is kana; see KNOWN
  // DEVIATIONS.
  const WIDE_GLYPH_ROWS = {
    0x80: ['#######', '#######', '#######', '#######', '#######'], // full block
    0x81: ['#.#.#.#', '.#.#.#.', '#.#.#.#', '.#.#.#.', '#.#.#.#'], // medium shade
    0x82: ['##...##', '#######', '#.#.#.#', '#######', '.#####.'], // cat
    0x83: ['..###..', '..###..', '#######', '.#####.', '..###..'], // down
    0x84: ['#...#..', '.......', '..#...#', '.......', '#...#..'], // light shade
    0x85: ['#..#..#', '.#.#.#.', '#######', '.#.#.#.', '#..#..#'], // asterisk
    0x86: ['..###..', '.#####.', '#######', '.#####.', '..###..'], // filled dot
    0x87: ['.##.##.', '#######', '#######', '.#####.', '...#...'], // heart
    0x88: ['..###..', '.#...#.', '#..#..#', '.#...#.', '..###..'], // ringed dot
    0x89: ['..###..', '..###..', '#######', '...#...', '..#.#..'], // person
    0x8a: ['...#...', '..###..', '.#####.', '#######', '.##.##.'], // house
    0x8b: ['...####', '..#####', '#######', '..#####', '...####'], // left
    0x8c: ['.#####.', '#.#.#.#', '#.....#', '#.###.#', '.#####.'], // face
    0x8d: ['...###.', '...#.#.', '...#...', '.###...', '.###...'], // note
    0x8e: ['.#####.', '##...##', '##...##', '##...##', '.#####.'], // O button
    0x8f: ['...#...', '..###..', '#######', '..###..', '...#...'], // diamond
    0x90: ['.......', '.......', '.......', '.......', '.#.#.#.'], // ellipsis
    0x91: ['####...', '#####..', '#######', '#####..', '####...'], // right
    0x92: ['...#...', '.#####.', '#######', '.#####.', '.#...#.'], // star
    0x93: ['#######', '.#####.', '..###..', '.#####.', '#######'], // hourglass
    0x94: ['..###..', '.#####.', '#######', '..###..', '..###..'], // up
    0x95: ['#.....#', '.#...#.', '..#.#..', '...#...', '.......'], // caron
    0x96: ['...#...', '..#.#..', '.#...#.', '#.....#', '.......'], // wedge
    0x97: ['##...##', '.##.##.', '..###..', '.##.##.', '##...##'], // X button
    0x98: ['#######', '.......', '#######', '.......', '#######'], // rows
    0x99: ['#.#.#.#', '#.#.#.#', '#.#.#.#', '#.#.#.#', '#.#.#.#'], // columns
  };

  for (const code of Object.keys(WIDE_GLYPH_ROWS)) {
    glyphsByCode.set(Number(code), packRows(WIDE_GLYPH_ROWS[code]));
  }

  // Anything printable we have no glyph for still needs *something* on screen,
  // otherwise a missing character looks like a rendering bug rather than an
  // unsupported one.
  const NARROW_PLACEHOLDER = packRows(['###', '#.#', '#.#', '#.#', '###']);

  const font = {
    GLYPH_HEIGHT,
    LINE_HEIGHT,
    NARROW_ADVANCE,
    WIDE_ADVANCE,

    /** Horizontal advance in pixels for one character code. */
    advanceFor(code) {
      return code >= 0x80 ? WIDE_ADVANCE : NARROW_ADVANCE;
    },

    /**
     * Packed bitmask rows for a character code, or null for codes that occupy
     * space but draw nothing (space, control codes).
     */
    rowsFor(code) {
      if (code === 0x20) {
        return null;
      }
      if (code >= 0x80) {
        return glyphsByCode.get(code) || WIDE_PLACEHOLDER;
      }
      return glyphsByCode.get(code) || NARROW_PLACEHOLDER;
    },

    /** Width in pixels of the longest line in `text`, matching print()'s layout. */
    measure(text) {
      const source = String(text ?? '');
      let widest = 0;
      let width = 0;
      for (let i = 0; i < source.length; i += 1) {
        const code = source.charCodeAt(i);
        if (code === 10) {
          width = 0;
          continue;
        }
        if (code < 0x20) {
          continue;
        }
        width += font.advanceFor(code);
        if (width > widest) {
          widest = width;
        }
      }
      return widest;
    },
  };

  // ── atlas export ────────────────────────────────────────────────────────
  //
  // Rasterising on the CPU keeps print() correct (see the header), but it also
  // leaves the glyphs living only inside Studio's JavaScript. Nothing the build
  // pipeline can see means nothing reaches the watch, so a cart that prints its
  // HUD would come up blank on hardware.
  //
  // buildAtlas() spills this same table into a texture page plus BMFont-shaped
  // metrics, so the importer can write a real .font asset that builds to the
  // .fnt/.d2 pair the firmware's font renderer already consumes. Both the
  // simulator and the asset read this one table, so they cannot drift apart.

  // 16 columns is just a readable sheet shape; nothing depends on it beyond the
  // metrics reported below.
  const ATLAS_COLUMNS = 16;
  // 0x20..0x9f - the printable range rowsFor() answers for. Below 0x20 is
  // control codes, above 0x9f PICO-8 itself has nothing.
  const ATLAS_FIRST_CODE = 0x20;
  const ATLAS_CODE_COUNT = 128;

  // The advance carries one column/row of letter spacing beyond the ink.
  const NARROW_INK_WIDTH = NARROW_ADVANCE - 1;
  const WIDE_INK_WIDTH = WIDE_ADVANCE - 1;

  /**
   * Render every glyph into a single RGBA texture page and describe each one in
   * the {id, x, y, width, height, xoffset, yoffset, xadvance, page, chnl} shape
   * FontAtlasGenerator.toBMFontBinary() expects, so the .fnt writer is shared
   * rather than duplicated.
   *
   * Ink is opaque white: the glyph lives in the alpha channel so the texture
   * works as d2_mode_alpha8, and the renderer supplies the colour.
   */
  function buildAtlas() {
    const cellWidth = WIDE_ADVANCE;
    const cellHeight = LINE_HEIGHT;
    const rowCount = Math.ceil(ATLAS_CODE_COUNT / ATLAS_COLUMNS);
    const width = ATLAS_COLUMNS * cellWidth;
    const height = rowCount * cellHeight;
    const rgba = new Uint8Array(width * height * 4);
    const glyphs = [];

    for (let index = 0; index < ATLAS_CODE_COUNT; index += 1) {
      const code = ATLAS_FIRST_CODE + index;
      const originX = (index % ATLAS_COLUMNS) * cellWidth;
      const originY = Math.floor(index / ATLAS_COLUMNS) * cellHeight;
      const packed = font.rowsFor(code);
      const inkWidth = code >= 0x80 ? WIDE_INK_WIDTH : NARROW_INK_WIDTH;

      if (packed) {
        for (let y = 0; y < GLYPH_HEIGHT; y += 1) {
          const bits = packed[y];
          for (let x = 0; x < inkWidth; x += 1) {
            if (!(bits & (1 << x))) continue;
            const offset = (((originY + y) * width) + originX + x) * 4;
            rgba[offset] = 0xff;
            rgba[offset + 1] = 0xff;
            rgba[offset + 2] = 0xff;
            rgba[offset + 3] = 0xff;
          }
        }
      }

      glyphs.push({
        id: code,
        x: originX,
        y: originY,
        // Uniform per-range ink size, including blanks like space: a fully
        // transparent 3x5 blit costs nothing and draws the same as skipping
        // it, and it keeps this array identical to what a consumer derives
        // from the grid+ranges metadata written alongside the atlas.
        width: inkWidth,
        height: GLYPH_HEIGHT,
        xoffset: 0,
        yoffset: 0,
        xadvance: font.advanceFor(code),
        page: 0,
        chnl: 15,
      });
    }

    return {
      width,
      height,
      rgba,
      glyphs,
      columns: ATLAS_COLUMNS,
      cellWidth,
      cellHeight,
      firstCode: ATLAS_FIRST_CODE,
      codeCount: ATLAS_CODE_COUNT,
      lineHeight: LINE_HEIGHT,
      // PICO-8 glyphs sit on the baseline with no descenders, so the baseline
      // is the full glyph height.
      base: GLYPH_HEIGHT,
      // The same layout stated compactly, for the .font metadata. Expanding
      // these against the grid above must reproduce `glyphs` exactly - that is
      // what keeps the shipped asset and this table from drifting apart.
      ranges: [
        {
          first: ATLAS_FIRST_CODE,
          last: 0x7f,
          width: NARROW_INK_WIDTH,
          height: GLYPH_HEIGHT,
          xadvance: NARROW_ADVANCE,
        },
        {
          first: 0x80,
          last: ATLAS_FIRST_CODE + ATLAS_CODE_COUNT - 1,
          width: WIDE_INK_WIDTH,
          height: GLYPH_HEIGHT,
          xadvance: WIDE_ADVANCE,
        },
      ],
    };
  }

  font.buildAtlas = buildAtlas;

  root.Pico8Font = font;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = font;
  }
})(typeof window !== 'undefined' ? window : globalThis);
