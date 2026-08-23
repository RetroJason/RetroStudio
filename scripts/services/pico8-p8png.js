/**
 * PICO-8 `.p8.png` cartridge reader.
 *
 * A `.p8.png` is a 160x205 label image with the cartridge hidden in the low two
 * bits of every colour channel: 160 * 205 = 32800 pixels, one ROM byte each.
 * Decoding one gives back the same 32800 bytes PICO-8 keeps in cart memory, so
 * this module turns that ROM back into ordinary `.p8` text and lets the rest of
 * the importer stay format-agnostic.
 *
 * Two things make this more than a bit-shuffle:
 *
 *  - The image must be decoded losslessly. Drawing it to a canvas and reading it
 *    back is NOT safe: canvas stores premultiplied alpha, and these carts have
 *    alpha values just below 255, so the round trip perturbs exactly the low
 *    bits the cart data lives in. Hence the small PNG reader below.
 *  - The code region is usually compressed, in one of two formats that PICO-8
 *    has used over the years. Both are implemented; the algorithms follow
 *    zepto8's reference implementation.
 */
(function umd(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Pico8P8Png = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';

  const CART_WIDTH = 160;
  const CART_HEIGHT = 205;
  const ROM_SIZE = CART_WIDTH * CART_HEIGHT; // 32800

  // Cart memory map. The code region runs from CODE_START to ROM_END; the bytes
  // past ROM_END hold the version stamp rather than cart data.
  const GFX_START = 0x0000;
  const MAP_START = 0x2000;
  const GFF_START = 0x3000;
  const MUSIC_START = 0x3100;
  const SFX_START = 0x3200;
  const CODE_START = 0x4300;
  const ROM_END = 0x8000;

  // =========================================================================
  // PNG
  // =========================================================================

  function readChunks(bytes) {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 8 || signature.some((b, i) => bytes[i] !== b)) {
      throw new Error('Not a PNG file.');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunks = [];
    let p = 8;

    while (p + 8 <= bytes.length) {
      const length = view.getUint32(p);
      const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
      const start = p + 8;
      if (start + length > bytes.length) break;
      chunks.push({ type, data: bytes.subarray(start, start + length) });
      if (type === 'IEND') break;
      p = start + length + 4; // skip the trailing CRC
    }

    return chunks;
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('DecompressionStream is unavailable; cannot read PNG image data.');
    }
    // 'deflate' is the zlib-wrapped variant, which is what a PNG IDAT stream is.
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  }

  /** Undo the per-scanline filters PNG applies before compression. */
  function unfilter(raw, width, height, bytesPerPixel) {
    const stride = width * bytesPerPixel;
    const out = new Uint8Array(height * stride);
    let p = 0;

    for (let y = 0; y < height; y += 1) {
      const filter = raw[p];
      p += 1;
      const rowStart = y * stride;
      const prevStart = rowStart - stride;

      for (let i = 0; i < stride; i += 1) {
        const left = i >= bytesPerPixel ? out[rowStart + i - bytesPerPixel] : 0;
        const up = y > 0 ? out[prevStart + i] : 0;
        const upLeft = (y > 0 && i >= bytesPerPixel) ? out[prevStart + i - bytesPerPixel] : 0;

        let value = raw[p + i];
        if (filter === 1) value += left;
        else if (filter === 2) value += up;
        else if (filter === 3) value += (left + up) >> 1;
        else if (filter === 4) value += paeth(left, up, upLeft);
        else if (filter !== 0) throw new Error(`Unsupported PNG filter type ${filter}.`);

        out[rowStart + i] = value & 0xff;
      }

      p += stride;
    }

    return out;
  }

  /**
   * Decode a non-interlaced 8-bit RGBA PNG. That is exactly what PICO-8 writes,
   * and anything else means the file has been re-encoded - which destroys the
   * cart data - so the narrow support is deliberate.
   */
  async function decodePng(bytes) {
    const chunks = readChunks(bytes);
    const header = chunks.find((chunk) => chunk.type === 'IHDR');
    if (!header || header.data.length < 13) throw new Error('PNG is missing its IHDR chunk.');

    const view = new DataView(header.data.buffer, header.data.byteOffset, header.data.byteLength);
    const width = view.getUint32(0);
    const height = view.getUint32(4);
    const depth = header.data[8];
    const colourType = header.data[9];
    const interlace = header.data[12];

    if (depth !== 8 || colourType !== 6 || interlace !== 0) {
      throw new Error(
        'This PNG is not in the form PICO-8 writes (8-bit RGBA, no interlacing). '
        + 'Re-encoding a .p8.png discards the cartridge hidden in its low colour bits, '
        + 'so the original download is needed.'
      );
    }

    const idat = chunks.filter((chunk) => chunk.type === 'IDAT');
    if (idat.length === 0) throw new Error('PNG is missing its image data.');

    const total = idat.reduce((sum, chunk) => sum + chunk.data.length, 0);
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of idat) {
      joined.set(chunk.data, offset);
      offset += chunk.data.length;
    }

    const raw = await inflate(joined);
    const expected = height * ((width * 4) + 1);
    if (raw.length < expected) throw new Error('PNG image data is truncated.');

    return { width, height, pixels: unfilter(raw, width, height, 4) };
  }

  // =========================================================================
  // ROM extraction
  // =========================================================================

  /**
   * Rebuild cart memory from the image. Each pixel carries one byte across the
   * low two bits of its four channels, alpha holding the most significant pair.
   */
  function extractRom(image) {
    if (image.width !== CART_WIDTH || image.height !== CART_HEIGHT) {
      throw new Error(
        `A PICO-8 cart image is ${CART_WIDTH}x${CART_HEIGHT}; this one is ${image.width}x${image.height}.`
      );
    }

    const rom = new Uint8Array(ROM_SIZE);
    for (let i = 0; i < ROM_SIZE; i += 1) {
      const o = i * 4;
      rom[i] = ((image.pixels[o + 3] & 3) << 6)
        | ((image.pixels[o] & 3) << 4)
        | ((image.pixels[o + 1] & 3) << 2)
        | (image.pixels[o + 2] & 3);
    }
    return rom;
  }

  // =========================================================================
  // Code decompression
  // =========================================================================

  // Index 0 is never a character: a zero byte escapes the next byte as a literal.
  const LEGACY_CHARS = '\n 0123456789abcdefghijklmnopqrstuvwxyz!#%(){}[]<>+=/*:;.,~_';

  // Old PICO-8 versions appended this shim so that carts using _update60 kept
  // working on older runtimes. It is not part of the author's code.
  const FUTURE_SHIM = /if\(_update60\)_update=function\(\)_update60\(\)(?:_update_buttons\(\))?_update60\(\)end\s*$/;

  function stripRuntimeShim(code) {
    return code.replace(FUTURE_SHIM, '').replace(/\n$/, '');
  }

  function hasHeader(rom, offset, header) {
    for (let i = 0; i < header.length; i += 1) {
      if (rom[offset + i] !== header[i]) return false;
    }
    return true;
  }

  /** The `:c:` scheme: a 59-entry character table plus 2-byte back references. */
  function decompressLegacy(code) {
    const length = (code[4] * 256) + code[5];
    const out = [];

    for (let i = 8; i < code.length && out.length < length; i += 1) {
      const byte = code[i];

      if (byte >= 0x3c) {
        const offset = ((byte - 0x3c) * 16) + (code[i + 1] & 0xf);
        let run = (code[i + 1] >> 4) + 2;
        i += 1;
        if (offset === 0 || offset > out.length) continue;
        while (run > 0) {
          out.push(out[out.length - offset]);
          run -= 1;
        }
      } else if (byte === 0) {
        i += 1;
        out.push(String.fromCharCode(code[i]));
      } else {
        out.push(LEGACY_CHARS[byte - 1]);
      }
    }

    return out.join('');
  }

  /**
   * The `\0pxa` scheme: an LSB-first bit stream over a move-to-front table,
   * with back references and escape hatches for raw runs.
   */
  function decompressPxa(code) {
    const length = (code[4] * 256) + code[5];
    const compressed = (code[6] * 256) + code[7];
    const limit = compressed * 8;

    let pos = 8 * 8;
    const getBits = (count) => {
      let n = 0;
      for (let i = 0; i < count && pos < limit; i += 1, pos += 1) {
        n |= ((code[pos >> 3] >> (pos & 7)) & 1) << i;
      }
      return n;
    };

    const mtf = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) mtf[i] = i;
    const moveToFront = (n) => {
      const value = mtf[n];
      mtf.copyWithin(1, 0, n);
      mtf[0] = value;
      return value;
    };

    const out = [];

    while (out.length < length && pos < limit) {
      if (getBits(1)) {
        // A character, indexed into the move-to-front table. The index is coded
        // with a unary prefix that widens the field, so recently used bytes
        // cost fewer bits.
        let width = 4;
        while (getBits(1)) width += 1;
        const index = getBits(width) + (1 << width) - 16;
        const ch = moveToFront(index);
        if (ch === 0) break;
        out.push(String.fromCharCode(ch));
        continue;
      }

      const width = getBits(1) ? (getBits(1) ? 5 : 10) : 15;
      const offset = getBits(width) + 1;

      // A 10-bit offset of 1 is impossible as a back reference, so it is reused
      // to mean "what follows is raw bytes, terminated by a zero".
      if (width === 10 && offset === 1) {
        let ch = getBits(8);
        while (ch !== 0 && pos < limit) {
          out.push(String.fromCharCode(ch));
          ch = getBits(8);
        }
        continue;
      }

      let run = 3;
      let part = 0;
      do {
        part = getBits(3);
        run += part;
      } while (part === 7);

      if (offset > out.length) break;
      for (let i = 0; i < run; i += 1) out.push(out[out.length - offset]);
    }

    return out.join('');
  }

  /** Read the cart's Lua, whichever of the three storage forms it uses. */
  function readCode(rom) {
    const code = rom.subarray(CODE_START, ROM_END);

    if (hasHeader(code, 0, [0x00, 0x70, 0x78, 0x61])) return stripRuntimeShim(decompressPxa(code));
    if (hasHeader(code, 0, [0x3a, 0x63, 0x3a, 0x00])) return stripRuntimeShim(decompressLegacy(code));

    // Uncompressed: plain bytes up to the first NUL.
    let end = code.indexOf(0);
    if (end < 0) end = code.length;
    let text = '';
    for (let i = 0; i < end; i += 1) text += String.fromCharCode(code[i]);
    return stripRuntimeShim(text);
  }

  // =========================================================================
  // Section text
  // =========================================================================

  const hex2 = (value) => value.toString(16).padStart(2, '0');

  // What an untouched row looks like in each section. Cart memory always holds
  // all 64 sfx and music patterns, but PICO-8 only writes out the ones up to the
  // last one in use, and "unused" is not the same as "all zero": a fresh sfx
  // still carries a speed, and a fresh music pattern has all four channels
  // switched off (any channel byte with bit 6 set).
  const BLANK_HEX = /^0*$/;
  const BLANK_SFX = /^00[0-9a-f]{2}0000(00000){32}$/;
  const BLANK_MUSIC = /^00 (?:0{8}|(?:[4-7][0-9a-f]){4})$/;

  function dropTrailingBlankRows(rows, blank) {
    const out = rows.slice();
    while (out.length > 0 && blank.test(out[out.length - 1])) out.pop();
    return out;
  }

  /**
   * The sprite sheet stores two pixels per byte with the LEFT pixel in the low
   * nibble, so the hex pairs come out reversed relative to every other section.
   */
  function gfxRows(rom) {
    const rows = [];
    for (let y = 0; y < 128; y += 1) {
      let row = '';
      for (let x = 0; x < 64; x += 1) {
        const byte = rom[GFX_START + (y * 64) + x];
        row += (byte & 0xf).toString(16) + (byte >> 4).toString(16);
      }
      rows.push(row);
    }
    return rows;
  }

  function byteRows(rom, start, rowCount, rowBytes) {
    const rows = [];
    for (let y = 0; y < rowCount; y += 1) {
      let row = '';
      for (let x = 0; x < rowBytes; x += 1) row += hex2(rom[start + (y * rowBytes) + x]);
      rows.push(row);
    }
    return rows;
  }

  /**
   * Each sound effect is 32 two-byte notes followed by editor mode, speed and
   * loop points. A note packs pitch, waveform, volume and effect; the waveform's
   * top bit lives up in bit 7 because that is the only room left.
   */
  function sfxRows(rom) {
    const rows = [];
    for (let n = 0; n < 64; n += 1) {
      const base = SFX_START + (n * 68);
      let row = hex2(rom[base + 64]) + hex2(rom[base + 65]) + hex2(rom[base + 66]) + hex2(rom[base + 67]);

      for (let i = 0; i < 32; i += 1) {
        const lo = rom[base + (i * 2)];
        const hi = rom[base + (i * 2) + 1];
        const pitch = lo & 0x3f;
        const waveform = ((lo >> 6) & 0x3) | ((hi & 0x1) << 2) | (((hi >> 7) & 0x1) << 3);
        const volume = (hi >> 1) & 0x7;
        const effect = (hi >> 4) & 0x7;
        row += hex2(pitch) + waveform.toString(16) + volume.toString(16) + effect.toString(16);
      }

      rows.push(row);
    }
    return rows;
  }

  /**
   * A music pattern is four channel bytes whose top bits are stolen to hold the
   * loop/stop flags; the text form breaks those back out into a leading byte.
   */
  function musicRows(rom) {
    const rows = [];
    for (let n = 0; n < 64; n += 1) {
      const base = MUSIC_START + (n * 4);
      let flags = 0;
      let channels = '';
      for (let c = 0; c < 4; c += 1) {
        const byte = rom[base + c];
        flags |= ((byte >> 7) & 1) << c;
        channels += hex2(byte & 0x7f);
      }
      rows.push(`${hex2(flags)} ${channels}`);
    }
    return rows;
  }

  function section(name, rows, blank) {
    const kept = dropTrailingBlankRows(rows, blank);
    if (kept.length === 0) return [];
    return [`__${name}__`, ...kept];
  }

  /**
   * Rebuild `.p8` text from cart memory. Sections that hold nothing are left out
   * exactly as PICO-8 does, so a converted cart reads like a hand-saved one.
   */
  function romToP8Text(rom, version) {
    const lines = [
      'pico-8 cartridge // http://www.pico-8.com',
      `version ${version}`,
      '__lua__',
      readCode(rom),
    ];

    const gfx = dropTrailingBlankRows(gfxRows(rom), BLANK_HEX);

    lines.push(...section('gfx', gfx, BLANK_HEX));
    // Sprite flags are meaningless without a sprite sheet to flag.
    if (gfx.length > 0) lines.push(...section('gff', byteRows(rom, GFF_START, 2, 128), BLANK_HEX));
    lines.push(...section('map', byteRows(rom, MAP_START, 32, 128), BLANK_HEX));
    lines.push(...section('sfx', sfxRows(rom), BLANK_SFX));
    lines.push(...section('music', musicRows(rom), BLANK_MUSIC));
    lines.push('');

    return lines.join('\n');
  }

  // =========================================================================
  // Entry points
  // =========================================================================

  function isP8PngName(name) {
    return /\.p8\.png$/i.test(String(name || ''));
  }

  /** Read a `.p8.png` and return `{ text, version }`, `text` being `.p8` source. */
  async function readCart(bytes) {
    const image = await decodePng(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    const rom = extractRom(image);
    const version = rom[ROM_END];
    return { text: romToP8Text(rom, version), version, rom };
  }

  return {
    isP8PngName,
    readCart,
    // Exposed for tests.
    decodePng,
    extractRom,
    readCode,
    romToP8Text,
    decompressLegacy,
    decompressPxa,
  };
}));
