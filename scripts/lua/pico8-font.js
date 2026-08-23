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
// - Characters >= 0x80 (PICO-8's button/heart/symbol block) render as a hollow
//   box placeholder at the correct 8px advance, so layout still lines up.
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
        return WIDE_PLACEHOLDER;
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

  root.Pico8Font = font;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = font;
  }
})(typeof window !== 'undefined' ? window : globalThis);
