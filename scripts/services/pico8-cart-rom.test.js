// pico8-cart-rom.test.js
// The .p8 text -> cart RAM image conversion.
//
// A multi-cart PICO-8 game uses its extra carts as flat storage: no code, just
// level data poured across the gfx, map and sound regions, read back later with
// reload() and peek(). Every byte therefore has to land exactly where PICO-8
// would have put it, and the .p8 text does not store things in either the order
// or the encoding that memory uses - the gfx nibbles are swapped, the music
// flags move into the top bits of all four channel bytes, and an sfx note is
// split across two bytes with its waveform in three pieces.
//
// The expected values below are picotool's, which were derived from real cart
// images rather than from the format documentation.

const path = require('path');
const assert = require('assert');

class BaseLuaExtension {
  constructor() {
    this.luaState = null;
    this.gameEmulator = null;
  }
}
global.BaseLuaExtension = BaseLuaExtension;
global.window = global.window || {};

require(path.resolve(__dirname, '..', 'lua', 'pico8-font.js'));
require(path.resolve(__dirname, '..', 'lua', 'pico8.js'));

const LuaPico8Extensions = global.window.LuaPico8Extensions;
if (!LuaPico8Extensions) {
  throw new Error('Failed to load LuaPico8Extensions from pico8.js');
}

// The parser is pure: it reads .p8 text and returns bytes, touching no runtime
// state, so the tests skip the constructor and its emulator dependencies.
const parser = Object.create(LuaPico8Extensions.prototype);

/**
 * Render sections back into the .p8 text a cart is stored as.
 *
 * The tests are written in terms of sections because that is the unit the
 * layout is defined in; the file wrapper around them carries no information.
 */
function makeService() {
  return {
    buildCartRom(sections) {
      let text = 'pico-8 cartridge // http://www.pico-8.com\nversion 41\n';
      for (const [name, lines] of Object.entries(sections)) {
        text += `__${name}__\n${(lines || []).join('\n')}\n`;
      }
      return parser._parseCartRom(text);
    },
  };
}

/**
 * The importer's section parsers, for the cross-checks at the end.
 *
 * The sprite sheet and tilemap come out of the import pipeline rather than out
 * of the cart image, so the two readings of the same section have to agree.
 */
function loadImportService() {
  const fs = require('fs');
  const vm = require('vm');

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

  return new globalThis.__Pico8ImportServiceClass(null);
}

const importService = loadImportService();

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// picotool tests/pico8/sfx/sfx_test.py, TestHelloWorld: one pattern of a real
// cart, as the .p8 line and as the 68 bytes it occupies in memory.
const HELLO_SFX_LINE = '01100000183732440518433394033c65539403185432b543184733940318433394033c655306053940339403'
  + '184733940318423394033c655394031845321433184733940318473394033c655394033940339403';
const HELLO_SFX_BYTES = 'd83e245118373931bc5b393158396b39183f393118373931bc5bb05139313931183f393118353931bc5b3931'
  + '183b2137183f3931183f3931bc5b39313931393101100000';

// -------------------------------------------------------------------------
// Region layout
// -------------------------------------------------------------------------

test('the image is the 0x4300 bytes below the code region', () => {
  const rom = makeService().buildCartRom({});
  assert.strictEqual(rom.length, 0x4300);
  assert.ok(rom.every((b) => b === 0), 'an empty cart is all zeroes');
});

test('each section is written at its own address', () => {
  const service = makeService();
  const rom = service.buildCartRom({
    gfx: ['11'],
    map: ['22'],
    gff: ['33'],
    music: ['00 44000000'],
    sfx: ['55000000'],
  });

  assert.strictEqual(rom[0x0000], 0x11, 'gfx starts at 0x0000');
  assert.strictEqual(rom[0x2000], 0x22, 'map starts at 0x2000');
  assert.strictEqual(rom[0x3000], 0x33, 'gff starts at 0x3000');
  assert.strictEqual(rom[0x3100], 0x44, 'music starts at 0x3100');
  // The sfx header bytes sit after the pattern's 32 note words, not before.
  assert.strictEqual(rom[0x3200 + 64], 0x55, 'sfx starts at 0x3200');
});

// -------------------------------------------------------------------------
// __gfx__
// -------------------------------------------------------------------------

test('gfx character pairs are stored with the left pixel in the low nibble', () => {
  const rom = makeService().buildCartRom({ gfx: ['0123456789abcdef'] });
  assert.strictEqual(rom[0], 0x10, 'pixels 0 and 1 become 0x10, not 0x01');
  assert.strictEqual(rom[1], 0x32);
  assert.strictEqual(rom[7], 0xfe);
});

test('gfx rows are 64 bytes apart even when a row is short', () => {
  const rom = makeService().buildCartRom({ gfx: ['11', '22', '33'] });
  assert.strictEqual(rom[0], 0x11);
  assert.strictEqual(rom[64], 0x22, 'a short row still consumes a whole row');
  assert.strictEqual(rom[128], 0x33);
});

test('gfx stops at the end of its region', () => {
  const rom = makeService().buildCartRom({ gfx: new Array(200).fill('f'.repeat(128)) });
  assert.strictEqual(rom[0x1fff], 0xff, 'the last gfx byte is written');
  assert.strictEqual(rom[0x2000], 0x00, 'the map region is untouched');
});

// -------------------------------------------------------------------------
// __map__ and __gff__
// -------------------------------------------------------------------------

test('map bytes are plain hex laid down in order', () => {
  const rom = makeService().buildCartRom({ map: ['0a0b0c', '0d0e0f'] });
  assert.strictEqual(hex(rom.slice(0x2000, 0x2006)), '0a0b0c0d0e0f');
});

test('map cannot spill into the sprite flags', () => {
  const rom = makeService().buildCartRom({ map: new Array(40).fill('ab'.repeat(128)) });
  assert.strictEqual(rom[0x2fff], 0xab);
  assert.strictEqual(rom[0x3000], 0x00);
});

test('gff cannot spill into the music region', () => {
  const rom = makeService().buildCartRom({ gff: new Array(4).fill('cd'.repeat(128)) });
  assert.strictEqual(rom[0x30ff], 0xcd);
  assert.strictEqual(rom[0x3100], 0x00);
});

// -------------------------------------------------------------------------
// __music__
// -------------------------------------------------------------------------

test('music channels are stored verbatim when no flags are set', () => {
  // picotool tests/pico8/music/music_test.py: `00 41424344` x64.
  const rom = makeService().buildCartRom({ music: new Array(64).fill('00 41424344') });
  assert.strictEqual(hex(rom.slice(0x3100, 0x3104)), '41424344');
  assert.strictEqual(hex(rom.slice(0x31fc, 0x3200)), '41424344', 'the last pattern is at 0x31fc');
});

test('each music flag bit moves into the top bit of its own channel', () => {
  const service = makeService();

  // 1 = begin loop, 2 = end loop, 4 = stop, 8 = the fourth channel's own bit.
  assert.strictEqual(hex(service.buildCartRom({ music: ['01 41424344'] }).slice(0x3100, 0x3104)), 'c1424344');
  assert.strictEqual(hex(service.buildCartRom({ music: ['02 41424344'] }).slice(0x3100, 0x3104)), '41c24344');
  assert.strictEqual(hex(service.buildCartRom({ music: ['04 41424344'] }).slice(0x3100, 0x3104)), '4142c344');
  assert.strictEqual(hex(service.buildCartRom({ music: ['08 41424344'] }).slice(0x3100, 0x3104)), '414243c4');
  assert.strictEqual(
    hex(service.buildCartRom({ music: ['0f 41424344'] }).slice(0x3100, 0x3104)),
    'c1c2c3c4',
    'all four bits together'
  );
});

test('a music pattern used as storage survives the round trip', () => {
  // POOM's data carts write bytes with the top bit set in every channel,
  // including the fourth. PICO-8 saves those as flag bits, and losing one
  // corrupts the byte - which is exactly what derails a cart streaming level
  // geometry out of this region. Real line from poom_0.p8.
  const rom = makeService().buildCartRom({ music: ['0b 33010533'] });
  assert.strictEqual(hex(rom.slice(0x3100, 0x3104)), 'b38105b3');
});

test('an unparseable music line is skipped without shifting the rest', () => {
  const rom = makeService().buildCartRom({ music: ['', '00 41424344'] });
  assert.strictEqual(hex(rom.slice(0x3100, 0x3104)), '41424344', 'the blank line consumes no pattern');
});

// -------------------------------------------------------------------------
// __sfx__
// -------------------------------------------------------------------------

test('a real sfx pattern matches the bytes picotool reads from the cart image', () => {
  const rom = makeService().buildCartRom({ sfx: [HELLO_SFX_LINE] });
  assert.strictEqual(hex(rom.slice(0x3200, 0x3200 + 68)), HELLO_SFX_BYTES);
});

test('sfx notes pack pitch, waveform, volume and effect across two bytes', () => {
  const service = makeService();
  const noteBytes = (note) => hex(service.buildCartRom({ sfx: [`00000000${note}`] }).slice(0x3200, 0x3202));

  // picotool tests/pico8/sfx/sfx_test.py testSetNote: pitch 1, waveform 2,
  // volume 3, effect 4.
  assert.strictEqual(noteBytes('01234'), '8146');
  // testSetNoteHighWaveform: waveform 10 sets the custom-instrument bit and
  // clears the w3 bit, which a naive shift would leave set.
  assert.strictEqual(noteBytes('01a34'), '81c6');
});

test('the four sfx header bytes follow the notes', () => {
  const rom = makeService().buildCartRom({ sfx: [`01100000${'00000'.repeat(32)}`] });
  assert.strictEqual(
    hex(rom.slice(0x3200 + 64, 0x3200 + 68)),
    '01100000',
    'editor mode, note duration, loop start, loop end'
  );
});

test('sfx patterns are 68 bytes apart', () => {
  const rom = makeService().buildCartRom({ sfx: ['00000000', 'ff000000'] });
  assert.strictEqual(rom[0x3200 + 64], 0x00);
  assert.strictEqual(rom[0x3200 + 68 + 64], 0xff);
});

test('a short sfx line leaves the rest of its pattern as zeroes', () => {
  // Only two notes given. The remaining 30 must not read past the end of the
  // string and produce NaN bytes.
  const rom = makeService().buildCartRom({ sfx: ['0110000001234012'] });
  assert.strictEqual(hex(rom.slice(0x3200, 0x3202)), '8146');
  assert.ok(rom.slice(0x3202, 0x3200 + 64).every((b) => b === 0), 'no partial note is written');
});

test('sfx cannot spill past the end of the image', () => {
  const line = `00000000${'00000'.repeat(32)}`;
  const rom = makeService().buildCartRom({ sfx: new Array(70).fill(line) });
  assert.strictEqual(rom.length, 0x4300, 'writing 70 patterns does not grow or throw');
});

// -------------------------------------------------------------------------
// The .p8 file wrapper
// -------------------------------------------------------------------------

test('the header lines above the first section are not read as data', () => {
  const rom = parser._parseCartRom('pico-8 cartridge // http://www.pico-8.com\nversion 41\n__map__\nab\n');
  assert.strictEqual(rom[0x2000], 0xab);
  assert.ok(rom.slice(0, 0x2000).every((b) => b === 0), 'nothing landed in the sprite sheet');
});

test('a section split across the file is read as one run of lines', () => {
  const sections = parser._splitCartSections('__map__\n11\n__gfx__\nff\n__map__\n22');
  assert.deepStrictEqual(sections.map, ['11', '22']);
  assert.deepStrictEqual(sections.gfx, ['ff']);
});

test('a cart with no sections at all is a blank image', () => {
  const rom = parser._parseCartRom('pico-8 cartridge // http://www.pico-8.com\nversion 41\n');
  assert.strictEqual(rom.length, 0x4300);
  assert.ok(rom.every((b) => b === 0));
});

// -------------------------------------------------------------------------
// Round trip against the section parsers
// -------------------------------------------------------------------------

test('gfx survives a round trip through the sprite sheet parser', () => {
  const line = '0123456789abcdef'.repeat(8);
  const rom = makeService().buildCartRom({ gfx: [line] });
  const sheet = importService.parseP8GfxSection([line]);

  for (let x = 0; x < 128; x += 1) {
    const byte = rom[x >> 1];
    const pixel = (x & 1) ? (byte >> 4) & 0x0f : byte & 0x0f;
    assert.strictEqual(pixel, sheet.pixels[x], `pixel ${x} disagrees with the sheet parser`);
  }
});

test('map survives a round trip through the tilemap parser', () => {
  const line = 'a1b2c3d4'.repeat(32);
  const rom = makeService().buildCartRom({ map: [line] });
  const map = importService.parseP8MapSection([line]);

  for (let x = 0; x < 128; x += 1) {
    assert.strictEqual(rom[0x2000 + x], map.tiles[x], `tile ${x} disagrees with the map parser`);
  }
});

// -------------------------------------------------------------------------
// Runner
// -------------------------------------------------------------------------

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
  }
}

console.log(`\n${tests.length - failed} passed, ${failed} failed, ${tests.length} total`);
process.exit(failed === 0 ? 0 : 1);
