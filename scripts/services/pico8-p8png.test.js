// pico8-p8png.test.js
// Regression tests for reading PICO-8 `.p8.png` cartridges.
//
// A `.p8.png` is a label image with the cartridge hidden in the low two bits of
// every colour channel, and its code is usually compressed with one of two
// schemes PICO-8 has shipped over the years. Three things can go wrong quietly
// here, so each gets a test: the image can be decoded lossily (which corrupts
// exactly the bits the cart lives in), a compression branch can be subtly wrong
// (which yields plausible-looking but broken Lua), and a section can be packed
// back into `.p8` text with the wrong nibble or bit order.
//
// The synthetic tests below build real PNGs so the decoder is exercised
// end-to-end rather than from its middle. The real carts in sandbox/test-wrom
// are used when present, because nothing catches a format mistake like a cart
// that shipped.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const assert = require('assert');

const JSZip = require('jszip');

const P8Png = require(path.join(__dirname, 'pico8-p8png.js'));
const Pico8Parser = require(path.join(__dirname, '..', 'lua', 'pico8-parser.js'));

function loadImportService() {
  globalThis.window = globalThis;
  globalThis.JSZip = JSZip;
  globalThis.alert = () => {};
  globalThis.Pico8Parser = Pico8Parser;
  globalThis.Pico8P8Png = P8Png;

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

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// -------------------------------------------------------------------------
// PNG writer (test-only)
// -------------------------------------------------------------------------

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Write an 8-bit RGBA PNG, cycling through all five scanline filters so the
 * decoder's unfilter paths are all exercised by any image this produces.
 */
function encodeRgbaPng(width, height, pixels, { colourType = 6, depth = 8 } = {}) {
  const stride = width * 4;
  const rows = [];

  for (let y = 0; y < height; y += 1) {
    const filter = y % 5;
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const line = Buffer.alloc(stride + 1);
    line[0] = filter;

    for (let i = 0; i < stride; i += 1) {
      const left = i >= 4 ? cur[i - 4] : 0;
      const up = prev[i];
      const upLeft = i >= 4 ? prev[i - 4] : 0;
      let value = cur[i];
      if (filter === 1) value -= left;
      else if (filter === 2) value -= up;
      else if (filter === 3) value -= (left + up) >> 1;
      else if (filter === 4) value -= paeth(left, up, upLeft);
      line[i + 1] = value & 0xff;
    }

    rows.push(line);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = colourType;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Hide a 32800-byte ROM in a 160x205 image the way PICO-8 does. The high bits
 * of each channel are filled with an arbitrary picture so that a decoder which
 * forgets to mask down to two bits fails loudly.
 */
function encodeCartPng(rom) {
  const pixels = Buffer.alloc(160 * 205 * 4);
  for (let i = 0; i < 160 * 205; i += 1) {
    const byte = rom[i] || 0;
    const noise = (i * 37) & 0xfc;
    pixels[i * 4] = noise | ((byte >> 4) & 3);
    pixels[i * 4 + 1] = noise | ((byte >> 2) & 3);
    pixels[i * 4 + 2] = noise | (byte & 3);
    pixels[i * 4 + 3] = 0xfc | ((byte >> 6) & 3);
  }
  return encodeRgbaPng(160, 205, pixels);
}

// -------------------------------------------------------------------------
// Compression writers (test-only)
// -------------------------------------------------------------------------

const LEGACY_CHARS = '\n 0123456789abcdefghijklmnopqrstuvwxyz!#%(){}[]<>+=/*:;.,~_';

/** Build a `:c:` code region from an explicit op list. */
function encodeLegacy(ops, decompressedLength) {
  const bytes = [0x3a, 0x63, 0x3a, 0x00, decompressedLength >> 8, decompressedLength & 0xff, 0, 0];

  for (const op of ops) {
    if (op.text !== undefined) {
      for (const ch of op.text) {
        const index = LEGACY_CHARS.indexOf(ch);
        // A byte of 0 escapes the next byte, which is how anything outside the
        // 58-character table (capitals, quotes, ...) is stored.
        if (index < 0) bytes.push(0, ch.charCodeAt(0));
        else bytes.push(index + 1);
      }
    } else {
      bytes.push(0x3c + (op.offset >> 4), ((op.length - 2) << 4) | (op.offset & 0xf));
    }
  }

  return Uint8Array.from(bytes);
}

/** Build a `\0pxa` code region from an explicit op list. */
function encodePxa(ops, decompressedLength) {
  const bits = [];
  const put = (value, count) => {
    for (let i = 0; i < count; i += 1) bits.push((value >> i) & 1);
  };

  const mtf = [...Array(256).keys()];

  for (const op of ops) {
    if (op.text !== undefined) {
      for (const ch of op.text) {
        const index = mtf.indexOf(ch.charCodeAt(0));
        let width = 4;
        while (index > (2 * (1 << width)) - 17) width += 1;

        put(1, 1);
        put((1 << (width - 4)) - 1, width - 4); // unary widening prefix
        put(0, 1);
        put(index - (1 << width) + 16, width);

        mtf.splice(index, 1);
        mtf.unshift(ch.charCodeAt(0));
      }
    } else if (op.raw !== undefined) {
      // A 10-bit offset of 1 is impossible as a back reference, so PICO-8
      // reuses it to introduce a NUL-terminated run of literal bytes.
      put(0, 1);
      put(1, 1);
      put(0, 1);
      put(0, 10);
      for (const ch of op.raw) put(ch.charCodeAt(0), 8);
      put(0, 8);
    } else {
      put(0, 1);
      put(1, 1);
      put(1, 1);
      put(op.offset - 1, 5);
      let remaining = op.length - 3;
      while (remaining >= 7) {
        put(7, 3);
        remaining -= 7;
      }
      put(remaining, 3);
    }
  }

  const body = Buffer.alloc(Math.ceil(bits.length / 8));
  bits.forEach((bit, i) => { body[i >> 3] |= bit << (i & 7); });

  const size = 8 + body.length;
  return Uint8Array.from(Buffer.concat([
    Buffer.from([0x00, 0x70, 0x78, 0x61,
      decompressedLength >> 8, decompressedLength & 0xff,
      size >> 8, size & 0xff]),
    body,
  ]));
}

function makeRom(code) {
  const rom = new Uint8Array(32800);
  rom.set(code, 0x4300);
  rom[0x8000] = 42;
  return rom;
}

// -------------------------------------------------------------------------
// Image decoding
// -------------------------------------------------------------------------

test('the cartridge is read from the low two bits of every channel', async () => {
  const rom = makeRom(Uint8Array.from(Buffer.from('x=1\0', 'latin1')));
  // Fingerprint a few sections so a transposed or off-by-one read shows up.
  rom[0x0000] = 0xa5;
  rom[0x1fff] = 0x5a;
  rom[0x2000] = 0xc3;
  rom[0x3000] = 0xff;
  rom[0x81ff] = 0x99;

  const cart = await P8Png.readCart(encodeCartPng(rom));
  assert.deepStrictEqual(Array.from(cart.rom), Array.from(rom));
  assert.strictEqual(cart.version, 42);
});

test('a PNG that is not the shape PICO-8 writes is rejected with a reason', async () => {
  // Re-encoding a .p8.png (to indexed colour, say) throws the cart away, so
  // guessing is worse than refusing.
  const indexed = encodeRgbaPng(160, 205, Buffer.alloc(160 * 205 * 4), { colourType: 3 });
  await assert.rejects(() => P8Png.readCart(indexed), /8-bit RGBA/);

  const wrongSize = encodeRgbaPng(160, 204, Buffer.alloc(160 * 204 * 4));
  await assert.rejects(() => P8Png.readCart(wrongSize), /160x205; this one is 160x204/);

  await assert.rejects(() => P8Png.readCart(Buffer.from('not a png at all')), /Not a PNG/);
});

// -------------------------------------------------------------------------
// Code decompression
// -------------------------------------------------------------------------

test('uncompressed code is read up to its terminator', () => {
  const code = new Uint8Array(0x3d00);
  code.set(Buffer.from('a=1\nb=2\0trailing garbage', 'latin1'));
  const rom = makeRom(code);
  assert.strictEqual(P8Png.readCode(rom), 'a=1\nb=2');
});

test('legacy :c: code expands its character table and back references', () => {
  // "abc" then a back reference three characters earlier, repeated four times.
  const expected = 'abcabca';
  const code = encodeLegacy(
    [{ text: 'abc' }, { offset: 3, length: 4 }],
    expected.length
  );
  assert.strictEqual(P8Png.decompressLegacy(code), expected);
});

test('legacy :c: escapes anything outside its character table', () => {
  // Capitals and quotes are not in the 58-character table, so they arrive as
  // escaped literals; getting the escape wrong shifts every following byte.
  const expected = 'x="Hi"';
  const code = encodeLegacy([{ text: expected }], expected.length);
  assert.strictEqual(P8Png.decompressLegacy(code), expected);
});

test('legacy :c: stops at the declared length', () => {
  const code = encodeLegacy([{ text: 'abcdef' }], 3);
  assert.strictEqual(P8Png.decompressLegacy(code), 'abc');
});

test('pxa code expands literals, back references and raw blocks', () => {
  const ops = [
    { text: 'function ' },
    { raw: 'Update()' },        // raw block: bytes verbatim until a NUL
    { text: '\n' },
    { offset: 18, length: 9 },  // back reference into "function "
  ];
  const expected = 'function Update()\nfunction ';
  const code = encodePxa(ops, expected.length);
  assert.strictEqual(P8Png.decompressPxa(code), expected);
});

test('pxa literals cost fewer bits the more recently they were used', () => {
  // The move-to-front table is the whole trick: repeating a character must
  // re-index it to 0. If the table is not rotated the same way on both sides,
  // output diverges after the first repeat rather than failing outright.
  const expected = 'aaabbbaaa';
  const code = encodePxa([{ text: expected }], expected.length);
  assert.strictEqual(P8Png.decompressPxa(code), expected);
});

test('the compression scheme is chosen by header, not by guesswork', async () => {
  const lua = 'print("hello")\nprint("hello")';

  const legacy = await P8Png.readCart(encodeCartPng(makeRom(
    encodeLegacy([{ text: 'print("hello")\n' }, { offset: 15, length: 14 }], lua.length)
  )));
  const pxa = await P8Png.readCart(encodeCartPng(makeRom(
    encodePxa([{ text: 'print("hello")\n' }, { offset: 15, length: 14 }], lua.length)
  )));

  for (const cart of [legacy, pxa]) {
    assert.match(cart.text, /^pico-8 cartridge/);
    assert.match(cart.text, /^version 42$/m);
    assert.strictEqual(cart.text.split(/^__lua__\s*$/m)[1].trim(), lua);
  }
});

test('the shim old PICO-8 appended for _update60 is not treated as cart code', () => {
  const shim = 'if(_update60)_update=function()_update60()_update60()end';
  const source = 'function _update60()\nend\n';
  const rom = makeRom(encodeLegacy([{ text: source + shim }], (source + shim).length));
  assert.strictEqual(P8Png.readCode(rom), source.trimEnd());
});

// -------------------------------------------------------------------------
// Section packing
// -------------------------------------------------------------------------

test('sprite sheet nibbles are emitted in PICO-8 pixel order', () => {
  const rom = makeRom(new Uint8Array(0));
  // One byte holds two pixels with the LEFT one in the low nibble, so these two
  // bytes must read out as 1, 2, 3, 4 across the row.
  rom[0] = 0x21;
  rom[1] = 0x43;
  const row = P8Png.romToP8Text(rom, 42).split(/^__gfx__\s*$/m)[1].trim().split('\n')[0];
  assert.strictEqual(row.slice(0, 4), '1234');
});

test('a note packs pitch, waveform, volume and effect back into five characters', () => {
  const rom = makeRom(new Uint8Array(0));
  const sfx = 0x3200;
  // pitch 0x25, waveform 0xb (bit 3 lives up in bit 7), volume 5, effect 3
  const waveform = 0xb;
  rom[sfx] = 0x25 | ((waveform & 0x3) << 6);
  rom[sfx + 1] = ((waveform >> 2) & 1) | (5 << 1) | (3 << 4) | (((waveform >> 3) & 1) << 7);
  rom[sfx + 64] = 0x01; // mode
  rom[sfx + 65] = 0x10; // speed
  rom[sfx + 66] = 0x02; // loop start
  rom[sfx + 67] = 0x08; // loop end

  const row = P8Png.romToP8Text(rom, 42).split(/^__sfx__\s*$/m)[1].trim().split('\n')[0];
  assert.strictEqual(row.slice(0, 8), '01100208');
  assert.strictEqual(row.slice(8, 13), '25b53');
});

test('music flags are unpacked from the top bit of each channel', () => {
  const rom = makeRom(new Uint8Array(0));
  const music = 0x3100;
  rom[music] = 0x80 | 0x11;  // flag bit 0 set, sfx 0x11
  rom[music + 1] = 0x02;
  rom[music + 2] = 0x80 | 0x03;  // flag bit 2 set
  rom[music + 3] = 0x44;

  const row = P8Png.romToP8Text(rom, 42).split(/^__music__\s*$/m)[1].trim().split('\n')[0];
  assert.strictEqual(row, '05 11020344');
});

test('sections holding nothing are left out, as PICO-8 leaves them out', async () => {
  const cart = await P8Png.readCart(encodeCartPng(makeRom(
    Uint8Array.from(Buffer.from('x=1\0', 'latin1'))
  )));
  assert.match(cart.text, /__lua__/);
  for (const section of ['gfx', 'gff', 'map', 'sfx', 'music']) {
    assert.doesNotMatch(cart.text, new RegExp(`__${section}__`), `${section} should be omitted`);
  }
});

// -------------------------------------------------------------------------
// Import integration
// -------------------------------------------------------------------------

test('a .p8.png imports through the same path as a .p8', async () => {
  const lua = 'function _draw()\n cls()\n print("hi")\nend';
  const rom = makeRom(encodeLegacy([{ text: lua }], lua.length));
  rom[0] = 0x12; // a sprite, so the sheet is not empty

  const service = new Pico8ImportService(null);
  const file = new File([encodeCartPng(rom)], 'Cave Story.p8.png', { type: 'image/png' });

  const result = await service.convertToRws(file);
  assert.strictEqual(result.projectName, 'Cave-Story');

  const outer = await JSZip.loadAsync(await result.blob.arrayBuffer());
  const rwpName = Object.keys(outer.files).find((name) => name.endsWith('.rwp'));
  const inner = await JSZip.loadAsync(await outer.file(rwpName).async('arraybuffer'));
  const cartPath = Object.keys(inner.files).find((name) => name.endsWith('cart-original.p8'));
  assert.ok(cartPath, `expected the archived cart, found: ${Object.keys(inner.files).join(', ')}`);
  const cart = await inner.file(cartPath).async('string');
  assert.match(cart, /^pico-8 cartridge/);
  assert.match(cart, /print\("hi"\)/);
});

test('a .p8.png inside a .zip is read as bytes, not as text', async () => {
  // Reading a cart image with a string decoder mangles every byte above 0x7f,
  // which is most of them.
  const lua = 'x=1';
  const zip = new JSZip();
  zip.file('build/game.p8.png', encodeCartPng(makeRom(encodeLegacy([{ text: lua }], lua.length))));
  zip.file('readme.txt', 'not a cart');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });

  const service = new Pico8ImportService(null);
  const bundle = await service.readCartBundle(new File([buffer], 'game.zip'));
  assert.strictEqual(bundle.cartName, 'game.p8.png');
  assert.strictEqual(bundle.cartDir, 'build');
  assert.strictEqual(bundle.cartText.split(/^__lua__\s*$/m)[1].trim(), lua);
});

test('a cart image is not offered as an #include source', () => {
  const service = new Pico8ImportService(null);
  // `#include` reads text; a .p8.png would arrive as binary noise.
  assert.strictEqual(service.isIncludableName('lib.p8.png'), false);
  assert.strictEqual(service.isIncludableName('lib.lua'), true);
  assert.strictEqual(service.isCartName('game.p8.png'), true);
  assert.strictEqual(service.isCartName('game.p8'), true);
  assert.strictEqual(service.isCartName('label.png'), false);
});

// -------------------------------------------------------------------------
// Real carts
// -------------------------------------------------------------------------

const CART_ROOT = path.join(__dirname, '..', '..', '..', 'sandbox', 'test-wrom', 'repos');

function sectionsOf(text) {
  const out = {};
  let name = 'header';
  out[name] = [];
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const match = line.match(/^__([a-z0-9_]+)__\s*$/i);
    if (match) {
      name = match[1].toLowerCase();
      out[name] = [];
      continue;
    }
    out[name].push(line);
  }
  return out;
}

test('published carts decode to Lua that still compiles', async () => {
  const carts = [
    ['Pico8Platformer', 'platformer'],
    ['Minima', 'minima'],
    ['picobox', 'windy'],
  ].filter(([repo, base]) => fs.existsSync(path.join(CART_ROOT, repo, `${base}.p8.png`)));

  if (carts.length === 0) {
    console.log('        (no sandbox carts available - skipped)');
    return;
  }

  for (const [repo, base] of carts) {
    const cart = await P8Png.readCart(fs.readFileSync(path.join(CART_ROOT, repo, `${base}.p8.png`)));
    const lua = cart.text.split(/^__lua__$/m)[1].split(/^__(?:gfx|gff|map|sfx|music)__$/m)[0];

    // Compression that is even one byte out yields Lua that will not parse.
    assert.doesNotThrow(() => Pico8Parser.compile(lua), `${base} should compile`);

    // The cart declares how long its code is; decompression must land on it
    // exactly, because stopping short still leaves syntactically valid Lua.
    const region = cart.rom.subarray(0x4300);
    const declared = (region[4] * 256) + region[5];
    assert.strictEqual(P8Png.decompressLegacy(region).length, declared, `${base} code length`);
  }
});

test('decoded sections match the .p8 the author published alongside', async () => {
  // windy.p8 and its .p8.png are the same build, so every section must agree.
  const dir = path.join(CART_ROOT, 'picobox');
  if (!fs.existsSync(path.join(dir, 'windy.p8'))) {
    console.log('        (no sandbox carts available - skipped)');
    return;
  }

  const cart = await P8Png.readCart(fs.readFileSync(path.join(dir, 'windy.p8.png')));
  const got = sectionsOf(cart.text);
  const want = sectionsOf(fs.readFileSync(path.join(dir, 'windy.p8'), 'utf8'));

  for (const key of ['gfx', 'gff', 'map', 'sfx']) {
    const mine = (got[key] || []).filter((row) => row !== '');
    assert.ok(mine.length > 0, `${key} should be present`);
    // The author's file keeps its trailing blank rows; ours are trimmed, so
    // compare only the rows that carry data.
    mine.forEach((row, i) => {
      assert.strictEqual(row, want[key][i], `${key} row ${i}`);
    });
  }
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
