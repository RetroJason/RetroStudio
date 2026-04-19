/**
 * FontAtlasGenerator — Renders TTF/OTF glyphs into a compact bitmap atlas
 * with BMFont-compatible metrics.
 *
 * Outputs:
 *   - Atlas canvas (PNG-exportable, white glyphs on transparent background)
 *   - Per-glyph metrics (x, y, w, h, xoffset, yoffset, xadvance)
 *   - BMFont v3 binary export
 *   - Frameset JSON export (RetroStudio-compatible)
 *
 * The atlas PNG feeds into the normal texture pipeline for D2 conversion.
 */
class FontAtlasGenerator {

  constructor() {
    this.fontFace = null;
    this.familyName = null;
  }

  /**
   * Load a TTF/OTF font from a File or ArrayBuffer.
   * @param {File|ArrayBuffer} source
   * @param {string} familyName — CSS font-family name to register
   * @returns {Promise<string>} the registered family name
   */
  async loadFont(source, familyName) {
    const buffer = source instanceof File ? await source.arrayBuffer() : source;
    const face = new FontFace(familyName, buffer);
    await face.load();
    document.fonts.add(face);
    this.fontFace = face;
    this.familyName = familyName;
    return familyName;
  }

  // ── public entry point ────────────────────────────────────────

  /**
   * Generate a font atlas.
   * @param {Object} opts
   * @param {string}  opts.fontFamily  — CSS family name (from loadFont)
   * @param {number}  opts.fontSize    — Size in px
   * @param {string}  opts.chars       — Characters to include
   * @param {number} [opts.padding=1]  — Transparent padding around each glyph
   * @param {number} [opts.spacing=1]  — Gap between packed glyphs in the atlas
   * @param {boolean}[opts.antialiasing=false]
   * @returns {{canvas, glyphs, lineHeight, base, width, height, fontFamily, fontSize}}
   */
  generate(opts) {
    const {
      fontFamily,
      fontSize,
      chars,
      padding  = 1,
      spacing  = 1,
      antialiasing = false,
    } = opts;

    const fontStr = `${fontSize}px "${fontFamily}"`;

    // ── 1. Render each glyph to a temp canvas and measure tightly ──
    const cellSize = Math.ceil(fontSize * 3);
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = cellSize;
    tmpCanvas.height = cellSize;
    const tmpCtx = tmpCanvas.getContext('2d', { willReadFrequently: true });

    const drawX = Math.floor(cellSize / 3);
    const drawY = Math.floor(cellSize * 0.65);

    const raw = [];          // per-glyph scan results
    let maxAscent  = 0;
    let maxDescent = 0;

    const uniqueChars = [...new Set(chars)];

    for (const ch of uniqueChars) {
      tmpCtx.clearRect(0, 0, cellSize, cellSize);
      tmpCtx.font = fontStr;
      tmpCtx.fillStyle = '#ffffff';
      tmpCtx.textBaseline = 'alphabetic';
      if (!antialiasing) {
        tmpCtx.imageSmoothingEnabled = false;
      }
      tmpCtx.fillText(ch, drawX, drawY);

      const metrics = tmpCtx.measureText(ch);
      const xadvance = Math.ceil(metrics.width);

      const imgData = tmpCtx.getImageData(0, 0, cellSize, cellSize);
      const bounds = FontAtlasGenerator._findBounds(imgData);

      if (!bounds) {
        // invisible glyph (e.g. space) — keep advance only
        raw.push({ ch, code: ch.codePointAt(0), w: 0, h: 0,
                   xoffset: 0, yoffset: 0, xadvance, pixels: null });
        continue;
      }

      const gw = bounds.maxX - bounds.minX + 1;
      const gh = bounds.maxY - bounds.minY + 1;
      const ascent  = drawY - bounds.minY;
      const descent = bounds.maxY - drawY + 1;

      if (ascent  > maxAscent)  maxAscent  = ascent;
      if (descent > maxDescent) maxDescent = descent;

      const xoffset = bounds.minX - drawX;  // signed

      // extract tight glyph pixels
      const pixels = tmpCtx.getImageData(bounds.minX, bounds.minY, gw, gh);

      raw.push({ ch, code: ch.codePointAt(0),
                 w: gw, h: gh,
                 ascent, xoffset, xadvance, pixels });
    }

    const base       = maxAscent;
    const lineHeight = maxAscent + maxDescent;

    // compute yoffset for each glyph (distance from line-top to glyph-top)
    for (const g of raw) {
      if (g.pixels) {
        g.yoffset = base - g.ascent;
      }
    }

    // ── 2. Shelf-pack visible glyphs into a compact atlas ──
    const visible = raw.filter(g => g.pixels);
    const padW = (g) => g.w + padding * 2;
    const padH = (g) => g.h + padding * 2;

    // sort tallest-first for tighter shelves
    const sorted = visible.slice().sort((a, b) => padH(b) - padH(a) || padW(b) - padW(a));

    const { atlasW, atlasH, placements } = this._shelfPack(sorted, padding, spacing);

    // ── 3. Render glyphs to the final atlas canvas ──
    const atlas = document.createElement('canvas');
    atlas.width  = atlasW;
    atlas.height = atlasH;
    const ctx = atlas.getContext('2d', { willReadFrequently: true });

    for (const p of placements) {
      ctx.putImageData(p.glyph.pixels, p.x + padding, p.y + padding);
    }

    // build final glyph list (sorted by char code for determinism)
    const glyphs = raw.map(g => {
      const p = placements.find(pl => pl.glyph === g);
      return {
        char:     g.ch,
        id:       g.code,
        x:        p ? p.x : 0,
        y:        p ? p.y : 0,
        width:    g.w + padding * 2,
        height:   g.h + padding * 2,
        xoffset:  g.xoffset - padding,
        yoffset:  (g.yoffset ?? 0) - padding,
        xadvance: g.xadvance,
        page:     0,
        chnl:     15,
      };
    }).sort((a, b) => a.id - b.id);

    return {
      canvas:     atlas,
      glyphs,
      lineHeight,
      base,
      width:      atlasW,
      height:     atlasH,
      fontFamily,
      fontSize,
      padding,
      spacing,
    };
  }

  // ── shelf packing ─────────────────────────────────────────────

  _shelfPack(sortedGlyphs, padding, spacing) {
    if (sortedGlyphs.length === 0) return { atlasW: 1, atlasH: 1, placements: [] };

    const padW = (g) => g.w + padding * 2;
    const padH = (g) => g.h + padding * 2;

    // try widths, pick smallest area
    const candidates = [64, 128, 256, 512, 1024, 2048];
    let best = null;

    for (const maxW of candidates) {
      let x = 0, y = 0, rowH = 0, usedW = 0;
      const pl = [];
      let ok = true;

      for (const g of sortedGlyphs) {
        const gw = padW(g);
        const gh = padH(g);
        if (gw > maxW) { ok = false; break; }

        if (x + gw > maxW) {
          y += rowH + spacing;
          x = 0;
          rowH = 0;
        }
        pl.push({ glyph: g, x, y });
        if (x + gw > usedW) usedW = x + gw;
        x += gw + spacing;
        if (gh > rowH) rowH = gh;
      }
      if (!ok) continue;

      const totalH = y + rowH;
      // Dave2D hardware: width <= 2048, height <= 1024
      if (totalH > 1024) continue;
      const area = maxW * totalH;
      if (!best || area < best.area) {
        best = { atlasW: usedW, atlasH: totalH, placements: pl, area };
      }
    }

    if (!best) {
      // fallback: single-column
      let y = 0;
      const pl = [];
      for (const g of sortedGlyphs) {
        pl.push({ glyph: g, x: 0, y });
        y += padH(g) + spacing;
      }
      best = { atlasW: sortedGlyphs.reduce((m, g) => Math.max(m, padW(g)), 0),
               atlasH: y, placements: pl, area: 0 };
    }

    // Dave2D hardware limit: width <= 2048, height <= 1024
    if (best.atlasH > 1024) {
      console.warn(`[FontAtlasGenerator] Atlas height ${best.atlasH} exceeds hardware limit of 1024`);
    }

    return best;
  }

  // ── pixel-bounds scan ─────────────────────────────────────────

  static _findBounds(imageData) {
    const { data, width, height } = imageData;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = data[(y * width + x) * 4 + 3];
        if (a > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return maxX >= 0 ? { minX, minY, maxX, maxY } : null;
  }

  // ── export: PNG blob ──────────────────────────────────────────

  async toPNG(canvas) {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  // ── export: BMFont binary v3 ──────────────────────────────────

  toBMFontBinary(result, pageName) {
    pageName = pageName || 'font_0.png';
    const fontName = result.fontFamily || 'font';

    // Block 1 — info
    const fontNameBytes = FontAtlasGenerator._strToBytes(fontName);
    const infoSize = 14 + fontNameBytes.length;
    const info = new ArrayBuffer(infoSize);
    const infoV = new DataView(info);
    infoV.setInt16(0, result.fontSize, true);         // fontSize (signed)
    infoV.setUint8(2, 0b00000010);                     // bitField: unicode=1
    infoV.setUint8(3, 0);                              // charSet
    infoV.setUint16(4, 100, true);                     // stretchH
    infoV.setUint8(6, 1);                              // aa
    infoV.setUint8(7, result.padding);                 // paddingUp
    infoV.setUint8(8, result.padding);                 // paddingRight
    infoV.setUint8(9, result.padding);                 // paddingDown
    infoV.setUint8(10, result.padding);                // paddingLeft
    infoV.setUint8(11, result.spacing);                // spacingHoriz
    infoV.setUint8(12, result.spacing);                // spacingVert
    infoV.setUint8(13, 0);                             // outline
    new Uint8Array(info, 14).set(fontNameBytes);

    // Block 2 — common
    const common = new ArrayBuffer(15);
    const comV = new DataView(common);
    comV.setUint16(0, result.lineHeight, true);
    comV.setUint16(2, result.base, true);
    comV.setUint16(4, result.width, true);             // scaleW
    comV.setUint16(6, result.height, true);            // scaleH
    comV.setUint16(8, 1, true);                        // pages
    comV.setUint8(10, 0);                              // bitField (not packed)
    comV.setUint8(11, 0);                              // alphaChnl = glyph data
    comV.setUint8(12, 4);                              // redChnl   = one
    comV.setUint8(13, 4);                              // greenChnl = one
    comV.setUint8(14, 4);                              // blueChnl  = one

    // Block 3 — pages
    const pageBytes = FontAtlasGenerator._strToBytes(pageName);

    // Block 4 — chars (20 bytes each)
    const charCount = result.glyphs.length;
    const chars = new ArrayBuffer(charCount * 20);
    const chV = new DataView(chars);
    for (let i = 0; i < charCount; i++) {
      const g = result.glyphs[i];
      const off = i * 20;
      chV.setUint32(off,      g.id,       true);
      chV.setUint16(off + 4,  g.x,        true);
      chV.setUint16(off + 6,  g.y,        true);
      chV.setUint16(off + 8,  g.width,    true);
      chV.setUint16(off + 10, g.height,   true);
      chV.setInt16(off + 12,  g.xoffset,  true);
      chV.setInt16(off + 14,  g.yoffset,  true);
      chV.setInt16(off + 16,  g.xadvance, true);
      chV.setUint8(off + 18,  g.page);
      chV.setUint8(off + 19,  g.chnl);
    }

    // assemble file: header + blocks
    const totalSize = 4                          // "BMF" + version
      + 1 + 4 + infoSize                        // block 1
      + 1 + 4 + 15                              // block 2
      + 1 + 4 + pageBytes.length                // block 3
      + 1 + 4 + charCount * 20;                 // block 4

    const buf = new ArrayBuffer(totalSize);
    const out = new Uint8Array(buf);
    const dv  = new DataView(buf);
    let pos = 0;

    // header
    out[pos++] = 66; out[pos++] = 77; out[pos++] = 70; // "BMF"
    out[pos++] = 3;                                      // version 3

    // block 1
    out[pos++] = 1;
    dv.setUint32(pos, infoSize, true); pos += 4;
    out.set(new Uint8Array(info), pos); pos += infoSize;

    // block 2
    out[pos++] = 2;
    dv.setUint32(pos, 15, true); pos += 4;
    out.set(new Uint8Array(common), pos); pos += 15;

    // block 3
    out[pos++] = 3;
    dv.setUint32(pos, pageBytes.length, true); pos += 4;
    out.set(pageBytes, pos); pos += pageBytes.length;

    // block 4
    out[pos++] = 4;
    dv.setUint32(pos, charCount * 20, true); pos += 4;
    out.set(new Uint8Array(chars), pos); pos += charCount * 20;

    return out;
  }

  // ── export: frameset JSON (RetroStudio-compatible) ────────────

  toFrameset(result, name) {
    name = name || result.fontFamily || 'font';
    const imageName = name + '.png';

    return {
      name,
      imagePath:    imageName,
      imageWidth:   result.width,
      imageHeight:  result.height,
      frameWidth:   0,
      frameHeight:  0,
      gridOffsetX:  0,
      gridOffsetY:  0,
      gridSpacingX: 0,
      gridSpacingY: 0,
      frames: result.glyphs.map(g => ({
        id:       g.id,
        name:     g.char === ' ' ? 'space' : g.char,
        x:        g.x,
        y:        g.y,
        w:        g.width,
        h:        g.height,
        xoffset:  g.xoffset,
        yoffset:  g.yoffset,
        xadvance: g.xadvance,
      })),
      fontMetrics: {
        lineHeight: result.lineHeight,
        base:       result.base,
        fontSize:   result.fontSize,
      },
      metadata: {
        created:       new Date().toISOString(),
        autoGenerated: true,
        generator:     'FontAtlasGenerator',
      },
    };
  }

  // ── import: BMFont binary v3 (.fnt) ────────────────────────────

  /**
   * Parse a BMFont binary v3 .fnt file.
   * @param {ArrayBuffer|Uint8Array} data — raw .fnt bytes
   * @returns {{info, common, pages, glyphs, kernings, d2Block}}
   *   - info:     {fontSize, fontName, bold, italic, unicode, smooth, aa, padding, spacing, outline}
   *   - common:   {lineHeight, base, scaleW, scaleH, pages, packed, alphaChnl, redChnl, greenChnl, blueChnl}
   *   - pages:    string[] — page texture filenames
   *   - glyphs:   [{id, x, y, width, height, xoffset, yoffset, xadvance, page, chnl, char}]
   *   - kernings: [{first, second, amount}]
   *   - d2Block:  Uint8Array|null — custom block type 6 (embedded D2 texture data)
   */
  static parseBMFont(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // validate header: "BMF" + version 3
    if (bytes[0] !== 66 || bytes[1] !== 77 || bytes[2] !== 70) {
      throw new Error('Not a BMFont binary file (bad magic)');
    }
    const version = bytes[3];
    if (version < 3) {
      throw new Error('Unsupported BMFont version ' + version + ' (need v3)');
    }

    let pos = 4;
    let info = null, common = null;
    const pages = [];
    const glyphs = [];
    const kernings = [];
    let d2Block = null;

    while (pos < bytes.length) {
      const blockType = bytes[pos]; pos += 1;
      const blockSize = dv.getUint32(pos, true); pos += 4;
      const blockEnd = pos + blockSize;

      switch (blockType) {
        case 1: { // info
          const fontSize  = dv.getInt16(pos, true);
          const bitField  = bytes[pos + 2];
          const charSet   = bytes[pos + 3];
          const stretchH  = dv.getUint16(pos + 4, true);
          const aa        = bytes[pos + 6];
          const paddingUp    = bytes[pos + 7];
          const paddingRight = bytes[pos + 8];
          const paddingDown  = bytes[pos + 9];
          const paddingLeft  = bytes[pos + 10];
          const spacingH  = bytes[pos + 11];
          const spacingV  = bytes[pos + 12];
          const outline   = bytes[pos + 13];
          const fontName  = FontAtlasGenerator._readString(bytes, pos + 14, blockEnd);
          info = {
            fontSize: Math.abs(fontSize), fontName,
            bold:    !!(bitField & 0x08), italic: !!(bitField & 0x04),
            unicode: !!(bitField & 0x02), smooth: !!(bitField & 0x01),
            aa, padding: [paddingUp, paddingRight, paddingDown, paddingLeft],
            spacing: [spacingH, spacingV], outline, stretchH, charSet,
          };
          break;
        }
        case 2: { // common
          common = {
            lineHeight: dv.getUint16(pos, true),
            base:       dv.getUint16(pos + 2, true),
            scaleW:     dv.getUint16(pos + 4, true),
            scaleH:     dv.getUint16(pos + 6, true),
            pages:      dv.getUint16(pos + 8, true),
            packed:     !!(bytes[pos + 10] & 0x80),
            alphaChnl:  bytes[pos + 11],
            redChnl:    bytes[pos + 12],
            greenChnl:  bytes[pos + 13],
            blueChnl:   bytes[pos + 14],
          };
          break;
        }
        case 3: { // pages
          // null-terminated strings packed together
          let start = pos;
          for (let i = pos; i < blockEnd; i++) {
            if (bytes[i] === 0) {
              const name = FontAtlasGenerator._readString(bytes, start, i + 1);
              if (name) pages.push(name);
              start = i + 1;
            }
          }
          break;
        }
        case 4: { // chars (20 bytes each)
          const count = Math.floor(blockSize / 20);
          for (let i = 0; i < count; i++) {
            const off = pos + i * 20;
            const id = dv.getUint32(off, true);
            glyphs.push({
              id,
              x:        dv.getUint16(off + 4, true),
              y:        dv.getUint16(off + 6, true),
              width:    dv.getUint16(off + 8, true),
              height:   dv.getUint16(off + 10, true),
              xoffset:  dv.getInt16(off + 12, true),
              yoffset:  dv.getInt16(off + 14, true),
              xadvance: dv.getInt16(off + 16, true),
              page:     bytes[off + 18],
              chnl:     bytes[off + 19],
              char:     String.fromCodePoint(id),
            });
          }
          break;
        }
        case 5: { // kerning pairs (10 bytes each)
          const count = Math.floor(blockSize / 10);
          for (let i = 0; i < count; i++) {
            const off = pos + i * 10;
            kernings.push({
              first:  dv.getUint32(off, true),
              second: dv.getUint32(off + 4, true),
              amount: dv.getInt16(off + 8, true),
            });
          }
          break;
        }
        case 6: { // custom: embedded D2 texture data
          d2Block = bytes.slice(pos, blockEnd);
          break;
        }
        default:
          // unknown block — skip
          break;
      }

      pos = blockEnd;
    }

    return { info, common, pages, glyphs, kernings, d2Block };
  }

  /**
   * Convert a parsed BMFont result into the same result shape that generate() returns,
   * so the preview / text-render / export code can be reused uniformly.
   * @param {Object} parsed — output of parseBMFont()
   * @param {HTMLCanvasElement|HTMLImageElement|null} atlasImage — the atlas page 0 image (if available)
   * @returns {Object} same shape as generate() result
   */
  static bmfontToResult(parsed, atlasImage) {
    const { info, common, glyphs } = parsed;
    let canvas = null;
    if (atlasImage) {
      canvas = document.createElement('canvas');
      canvas.width  = atlasImage.naturalWidth  || atlasImage.width;
      canvas.height = atlasImage.naturalHeight || atlasImage.height;
      canvas.getContext('2d').drawImage(atlasImage, 0, 0);
    }
    return {
      canvas,
      glyphs: glyphs.map(g => ({ ...g })),
      lineHeight: common?.lineHeight ?? 0,
      base:       common?.base ?? 0,
      width:      common?.scaleW ?? (canvas?.width ?? 0),
      height:     common?.scaleH ?? (canvas?.height ?? 0),
      fontFamily: info?.fontName ?? 'unknown',
      fontSize:   info?.fontSize ?? 0,
      padding:    info?.padding?.[0] ?? 0,
      spacing:    info?.spacing?.[0] ?? 0,
    };
  }

  // ── helpers ───────────────────────────────────────────────────

  static _readString(bytes, start, end) {
    let len = end - start;
    // strip null terminator
    while (len > 0 && bytes[start + len - 1] === 0) len--;
    if (len <= 0) return '';
    return new TextDecoder().decode(bytes.slice(start, start + len));
  }

  static _strToBytes(str) {
    const enc = new TextEncoder();
    const raw = enc.encode(str);
    const out = new Uint8Array(raw.length + 1); // null-terminated
    out.set(raw);
    out[raw.length] = 0;
    return out;
  }
}

// export for both module and script-tag usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FontAtlasGenerator;
} else {
  window.FontAtlasGenerator = FontAtlasGenerator;
}
