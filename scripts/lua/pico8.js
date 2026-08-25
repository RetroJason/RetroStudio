// pico8.js - Pico-8 API Compatibility Layer for RetroStudio
// Provides full pico-8 Lua API compatibility for games targeting pico-8 style development

// PICO-8 button index -> RetroStudio input mask.
// 0 left, 1 right, 2 up, 3 down, 4 O (Z key / B), 5 X (X key / A).
const PICO8_BUTTON_MASKS = [0x0040, 0x0080, 0x0010, 0x0020, 0x0001, 0x0100];

class LuaPico8Extensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
    this.currentColor = 0;
    // fillp(): a 4x4 tile of bits applied to the shape drawing functions.
    // 0 is solid, which is what a cart starts with.
    this._fillPattern = 0;
    this._fillPatternTransparent = false;
    this.currentPalette = new Map();
    // The screen palette (0x5f10-0x5f1f): what each of the 16 colour indices
    // actually displays as. Unlike the draw palette this is applied when the
    // framebuffer reaches the screen, so it recolours everything already
    // drawn. Entries may name an extended colour (128-143).
    this._screenPalette = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) this._screenPalette[i] = i;
    this._paletteRGBADirty = true;
    this.randomSeed = 0;
    // PICO-8 stores sprite flags as one byte per sprite at 0x3000; keep the
    // same layout so fget/fset and peek/poke see the same bits.
    this.spriteFlags = new Uint8Array(256);
    // Colour indices skipped when blitting sprite-sheet pixels (palt).
    this._transparent = new Set([0]);
    // How many of the 16 fractional bits of tline()'s map coordinates count as
    // sub-pixel. 13 leaves three bits for the pixel within an 8x8 cell, which
    // is what makes the default unit one map cell. tline(n) changes it.
    this._tlineBits = 13;
    // Decoded sprite sheet / map, installed from the built cart assets.
    this._sheet = null;
    this._map = null;
    // Pristine copies of the cart's ROM regions, so reload() can restore data
    // the cart has since overwritten with poke()/memcpy()/sset().
    this._romSheet = null;
    this._romSpriteFlags = new Uint8Array(256);
    this._romMap = null;
    // 0x3100-0x42ff music (64 patterns) and SFX (64 slots of 68 bytes).
    // Playback does not read these - music()/sfx() go to the converted audio
    // resources - but the bytes still have to be here, because carts treat the
    // whole 0x0000-0x42ff ROM as a data store and stream it back with peek().
    // POOM packs its level geometry there and unpacks it a byte at a time.
    this._audioRam = null;
    this._romAudioRam = null;
    // Multi-cart games: the sibling carts' .p8 text, parsed on first use and
    // keyed by bare filename, which is how carts name each other.
    this._cartFamily = null;
    this._mainCartName = '';
    // The string a load() handed to the cart it started, returned by stat(6).
    this._loadParam = '';
    // 0x4300-0x5dff general-purpose RAM. Allocated lazily; most carts never
    // touch it and 6.9KB per run is pure waste when they do not.
    // 0x5600-0x5dff of it doubles as the custom font, see _getCustomFont().
    this._userRam = null;
    // 0x5f00-0x5f7f draw state registers. Stored so a cart can read back what
    // it wrote; only the print attribute defaults at 0x5f58 are interpreted.
    this._drawStateRam = null;
    // cartdata()/dget()/dset() persistent storage: 64 numbers, or null until
    // the cart has claimed an id.
    this._cartDataId = null;
    this._cartData = null;
    // menuitem() entries, keyed by 1-based slot.
    this.menuItems = new Map();

    // Arguments already reported by _warnCoercedArg, so a cart that passes nil
    // every frame warns once rather than 60 times a second.
    this._coercedArgWarnings = new Set();

    // print()/cursor() text cursor, in logical (128x128) pixels.
    this._cursorX = 0;
    this._cursorY = 0;
    this._font = null;

    this._logicalWidth = 128;
    this._logicalHeight = 128;

    // Pico-8 fallback framebuffer (used when no spriteEngine is available).
    this._fbWidth = this._logicalWidth;
    this._fbHeight = this._logicalHeight;
    this._framebuffer = new Uint8Array(this._fbWidth * this._fbHeight);
    this._clipRect = { x: 0, y: 0, w: this._logicalWidth, h: this._logicalHeight };
    this._cameraX = 0;
    this._cameraY = 0;
    this._dirty = true;
    this._gpu = null;
    this._fbTexture = null;
    this._renderEnabled = false;
    // 0 means stretch Pico framebuffer to full output canvas.
    // >0 means fixed pixel scale (for classic Pico-8 style presentation).
    this._picoRenderScale = 0;
    this._paletteRGBA = this._buildPicoPaletteRGBA();
  }

  initGpu(gpu) {
    this._gpu = gpu;
    this._fbTexture = null;
    this._dirty = true;
    // Deliberately NOT resetRuntimeState() here. GPU init is a renderer
    // lifecycle event that lands *after* the cart's _init has run, so
    // resetting here wiped state the cart had already chosen - carts calling
    // palt() in _init lost their transparency and drew opaque backgrounds.
    // The cart-level reset belongs to script load, which does it before the
    // cart executes; this method only owns the GPU handles above.
  }

  /**
   * Load the cart's sprite sheet and map from the build output.
   *
   * These are the exact same artefacts the Studio sprite/tilemap engines use —
   * `pico8_sprites.d2` and `map.d2m` produced from the imported `.texture` and
   * `.tilemap`. PICO-8 needs CPU-side pixels because spr()/map() are software
   * raster ops interleaved with the shape primitives in one framebuffer, and
   * because sset() mutates the sheet at runtime.
   */
  async loadCartAssets() {
    try {
      const pathResolver = this._getService?.('pathResolver');
      const prefix = pathResolver?.getBuildStoragePrefix?.() || 'build/';
      const files = await this._listBuildFiles(prefix);

      const sheetPath = files.find(p => /(^|\/)pico8_sprites\.d2$/i.test(p));
      if (sheetPath) {
        const sheet = this._decodeIndexedD2(await this._loadBinaryFile(sheetPath));
        if (sheet) {
          this.setSpriteSheet(sheet.pixels, sheet.width, sheet.height);
          console.log(`[LuaPico8] Sprite sheet loaded: ${sheet.width}x${sheet.height} from ${sheetPath}`);
        }
      }

      const mapPath = files.find(p => /\.d2m$/i.test(p));
      if (mapPath) {
        const map = this._decodeD2M(await this._loadBinaryFile(mapPath));
        if (map) {
          this.setMapData(map.tiles, map.width, map.height);
          console.log(`[LuaPico8] Map loaded: ${map.width}x${map.height} from ${mapPath}`);
        }
      }

      await this._loadCartFamily(files);
    } catch (error) {
      console.warn('[LuaPico8] Failed to load cart assets:', error);
    }
  }

  /**
   * Index the game's carts from the .p8 files the importer copied into
   * Import/pico8/carts.
   *
   * They are stored as the plain text they arrived as, so the parsing happens
   * here rather than at import time. Only the text is read up front; turning a
   * cart into its 0x4300 byte image waits until something asks for it, because
   * a big game ships thirty carts and touches two or three per level.
   *
   * The main cart is identified by matching cart-original.p8 rather than by a
   * recorded name: it is written out as the same flattened text, and a name
   * would have to live in a manifest that nothing else needs.
   */
  async _loadCartFamily(files) {
    const cartPaths = files.filter(p => /(^|\/)carts\/[^/]+\.p8$/i.test(p));
    if (cartPaths.length === 0) return;

    this._cartFamily = new Map();
    for (const path of cartPaths) {
      const text = await this._loadTextFile(path);
      if (text == null) continue;
      const name = this._normalizeCartName(path);
      this._cartFamily.set(name, { text, rom: null, lua: null });
    }

    const originalPath = files.find(p => /(^|\/)cart-original\.p8$/i.test(p));
    const original = originalPath ? await this._loadTextFile(originalPath) : null;
    if (original) {
      for (const [name, entry] of this._cartFamily) {
        if (entry.text === original) { this._mainCartName = name; break; }
      }
      // Fall back to the project's own cart image for the audio region, so a
      // single-cart game still gets the bytes behind 0x3100-0x42ff. The
      // importer turns those sections into playable audio resources and the raw
      // bytes are lost on the way, but carts read them back directly.
      this._seedAudioRam(this._parseCartRom(original));
    } else if (this._mainCartName) {
      this._seedAudioRam(this._getCartRom(this._mainCartName));
    }

    console.log(`[LuaPico8] Cart family loaded: ${this._cartFamily.size} carts`
      + (this._mainCartName ? `, main ${this._mainCartName}` : ''));
  }

  /**
   * PICO-8 lets a cart be named with or without its extension, and a cart in a
   * subfolder is still referred to by its bare name.
   */
  _normalizeCartName(name) {
    const text = String(name ?? '').trim().replace(/\\/g, '/').split('/').pop().toLowerCase();
    if (!text) return '';
    return /\.p8$/.test(text) ? text : `${text}.p8`;
  }

  /** Fill the music and SFX region from a cart image. */
  _seedAudioRam(rom) {
    if (!rom) return;
    this._romAudioRam = rom.slice(0x3100, 0x4300);
    this._audioRam = new Uint8Array(this._romAudioRam);
  }

  /** The 0x4300 byte image of a named cart, parsed on first use. */
  _getCartRom(name) {
    const entry = this._cartFamily?.get(this._normalizeCartName(name));
    if (!entry) return null;
    if (!entry.rom) entry.rom = this._parseCartRom(entry.text);
    return entry.rom;
  }

  /**
   * Split a .p8 file into its `__name__` sections.
   *
   * Everything before the first section header is the format banner, and the
   * `__label__` screenshot is of no interest to anything here, but it costs
   * nothing to keep and the caller simply never asks for it.
   */
  _splitCartSections(text) {
    const sections = {};
    let current = null;
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      const header = /^__(\w+)__\s*$/.exec(rawLine);
      if (header) {
        current = header[1].toLowerCase();
        sections[current] = sections[current] || [];
        continue;
      }
      if (current) sections[current].push(rawLine);
    }
    return sections;
  }

  /**
   * Lay a cart's data sections out as the 0x0000-0x42ff bytes PICO-8 holds them
   * in, which is neither the order nor the encoding the .p8 text uses.
   *
   * Multi-cart games use their sibling carts as flat storage. The extra carts
   * carry no code at all: the level data is simply poured across every section
   * until it runs out, and the running cart pulls it back with reload() and
   * peek(). That only works if every byte lands exactly where PICO-8 would have
   * put it, so the layout here follows picotool's, which is derived from real
   * cart images rather than from the .p8 text format.
   *
   * A section that stops early leaves the rest of its region as zeroes. PICO-8
   * writes all 64 sfx and music lines when it saves, so this only comes up for
   * hand-edited carts, and zero is a better guess there than PICO-8's blank-cart
   * note-duration defaults would be - those would corrupt a slot being used as
   * data.
   *
   * @param {string} text The .p8 file's contents.
   * @returns {Uint8Array} 0x4300 bytes.
   */
  _parseCartRom(text) {
    const sections = this._splitCartSections(text);
    const rom = new Uint8Array(0x4300);
    const nibble = (ch) => {
      const v = Number.parseInt(ch, 16);
      return Number.isFinite(v) ? v : 0;
    };

    // __gfx__ writes one hex character per 4-bit pixel, left to right, but a
    // byte holds the LEFT pixel in its LOW nibble, so each character pair is
    // stored the other way round.
    let gfxRow = 0;
    for (const rawLine of sections.gfx || []) {
      if (gfxRow >= 128) break;
      const line = String(rawLine || '').trim();
      if (!line) continue;
      for (let i = 0; i + 1 < line.length && i < 128; i += 2) {
        rom[gfxRow * 64 + (i >> 1)] = nibble(line[i]) | (nibble(line[i + 1]) << 4);
      }
      gfxRow += 1;
    }

    // __map__ and __gff__ are plain hex bytes filling their regions in order.
    const writeHexBytes = (lines, base, limit) => {
      let out = base;
      for (const rawLine of lines || []) {
        const hex = String(rawLine || '').trim();
        for (let i = 0; i + 1 < hex.length && out < limit; i += 2) {
          rom[out] = (nibble(hex[i]) << 4) | nibble(hex[i + 1]);
          out += 1;
        }
      }
    };
    writeHexBytes(sections.map, 0x2000, 0x3000);
    writeHexBytes(sections.gff, 0x3000, 0x3100);

    // __music__ is `FF CCCCCCCC` per pattern. In memory each pattern is only
    // four bytes, one per channel, so the flags have no byte of their own: each
    // flag bit rides in the top bit of its channel's byte, leaving seven bits
    // for the pattern number. That is why this cannot go through writeHexBytes,
    // and why a cart using the region as storage still round-trips - 4 flags
    // plus 4 x 7 channel bits is exactly the 32 bits memory holds.
    let pattern = 0;
    for (const rawLine of sections.music || []) {
      if (pattern >= 64) break;
      const match = /^([0-9a-f]{2})\s+([0-9a-f]{8})$/i.exec(String(rawLine || '').trim());
      if (!match) continue;
      const flags = Number.parseInt(match[1], 16) || 0;
      const channels = match[2];
      const base = 0x3100 + pattern * 4;
      for (let c = 0; c < 4; c += 1) {
        const value = Number.parseInt(channels.slice(c * 2, c * 2 + 2), 16) || 0;
        rom[base + c] = value | ((flags >> c) & 1 ? 0x80 : 0);
      }
      pattern += 1;
    }

    // __sfx__ is 8 header characters then 32 notes of PPWVE. In memory a
    // pattern is 68 bytes: the 32 note words first, little endian, then the
    // four header bytes. A note packs as w2w1-pppppp / c-eee-vvv-w3, so the
    // waveform is split across three places.
    let slot = 0;
    for (const rawLine of sections.sfx || []) {
      if (slot >= 64) break;
      const line = String(rawLine || '').trim();
      if (line.length < 8) continue;
      const base = 0x3200 + slot * 68;
      for (let note = 0; note < 32; note += 1) {
        const at = 8 + note * 5;
        if (at + 5 > line.length) break;
        const pitch = Number.parseInt(line.slice(at, at + 2), 16) || 0;
        const waveform = nibble(line[at + 2]);
        const volume = nibble(line[at + 3]);
        const effect = nibble(line[at + 4]);
        rom[base + note * 2] = (pitch & 0x3f) | ((waveform & 3) << 6);
        rom[base + note * 2 + 1] = ((waveform & 4) >> 2)
          | ((volume & 7) << 1)
          | ((effect & 7) << 4)
          | ((waveform & 8) << 4);
      }
      for (let i = 0; i < 4; i += 1) {
        rom[base + 64 + i] = Number.parseInt(line.slice(i * 2, i * 2 + 2), 16) || 0;
      }
      slot += 1;
    }

    return rom;
  }

  /**
   * The runnable Lua behind a load() target, built the same way the importer
   * built the project's main.lua.
   *
   * The cart is stored as its original text, so the PICO-8 dialect and the
   * Setup/Update wrappers have to be applied here. That work belongs to the
   * import service, which is the one place that knows how a cart becomes a
   * project script; borrowing it keeps the two from drifting apart.
   */
  _getCartScript(name) {
    const entry = this._cartFamily?.get(this._normalizeCartName(name));
    if (!entry) return null;
    if (entry.lua != null) return entry.lua || null;

    entry.lua = '';
    const sections = this._splitCartSections(entry.text);
    const cartLua = (sections.lua || []).join('\n').trim();
    if (!cartLua) return null;

    const importer = typeof window !== 'undefined' ? window.pico8ImportService : null;
    if (!importer?.buildRuntimeLua) {
      this._warnOnce(
        'load-no-importer',
        'load() needs the PICO-8 import service to convert a cart into runnable code, and it is not available here.'
      );
      return null;
    }

    try {
      entry.lua = importer.buildRuntimeLua(cartLua, {
        spriteFlags: (sections.gff || []).join('').replace(/\s+/g, ''),
      });
    } catch (error) {
      this._warnOnce(`load-badcode-${name}`, `load("${name}") could not convert the cart's code: ${error.message}`);
      return null;
    }
    return entry.lua;
  }

  async _loadTextFile(path) {
    const fileManager = this._getService?.('fileManager');
    if (!fileManager) return null;

    const pathResolver = this._getService?.('pathResolver');
    const normPath = pathResolver?.normalizeStoragePath?.(path) || path;
    const obj = await fileManager.loadFile(normPath);
    const content = obj?.content ?? obj?.fileContent ?? obj?.data;

    if (typeof content === 'string') return content;
    if (content instanceof ArrayBuffer) return new TextDecoder().decode(content);
    if (ArrayBuffer.isView(content)) return new TextDecoder().decode(content);
    return null;
  }

  async _listBuildFiles(prefix) {
    const fileManager = this._getService?.('fileManager');
    if (!fileManager || typeof fileManager.listFiles !== 'function') return [];
    const results = await fileManager.listFiles(prefix);
    return (results || []).map(r => (typeof r === 'string' ? r : (r.path || r.name || ''))).filter(Boolean);
  }

  async _loadBinaryFile(path) {
    const fileManager = this._getService?.('fileManager');
    if (!fileManager) return null;

    const pathResolver = this._getService?.('pathResolver');
    const normPath = pathResolver?.normalizeStoragePath?.(path) || path;
    const obj = await fileManager.loadFile(normPath);
    const content = obj?.content ?? obj?.fileContent ?? obj?.data;

    if (content instanceof ArrayBuffer) return new Uint8Array(content);
    if (ArrayBuffer.isView(content)) return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
    return null;
  }

  /** Decode a D2TX indexed texture (I8/I4/I2/I1) to one byte per pixel. */
  _decodeIndexedD2(bytes) {
    if (!bytes || bytes.length < 32) return null;
    if (bytes[0] !== 0x44 || bytes[1] !== 0x32 || bytes[2] !== 0x54 || bytes[3] !== 0x58) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const format = view.getUint8(5);
    const width = view.getUint16(6, true);
    const height = view.getUint16(8, true);
    if (!width || !height) return null;

    // Modes per D2File.FORMAT_NAMES: i8 = 0x09, i4 = 0x0a, i2 = 0x0b, i1 = 0x0c.
    const bitsByFormat = { 0x09: 8, 0x0a: 4, 0x0b: 2, 0x0c: 1 };
    const bits = bitsByFormat[format];
    if (!bits) {
      console.warn(`[LuaPico8] Unsupported sprite sheet format 0x${format.toString(16)}`);
      return null;
    }

    const data = bytes.subarray(32);
    if (bits === 8) {
      return { pixels: new Uint8Array(data.subarray(0, width * height)), width, height };
    }

    const d2File = (typeof window !== 'undefined' && window.D2File) || null;
    if (!d2File?._unpackSubBytePixels) {
      console.warn('[LuaPico8] D2File unavailable — cannot unpack sub-byte sprite sheet');
      return null;
    }

    return {
      pixels: d2File._unpackSubBytePixels(data, format, bits, width * height),
      width,
      height,
    };
  }

  /**
   * Decode the first layer of a D2MP tilemap into PICO-8 sprite indices.
   * Studio gids are 1-based (firstGid 1 == sprite 0), and gid 0 means empty,
   * which maps back onto PICO-8's "sprite 0 is empty" convention.
   */
  _decodeD2M(bytes) {
    if (!bytes || bytes.length < 40) return null;
    if (bytes[0] !== 0x44 || bytes[1] !== 0x32 || bytes[2] !== 0x4d || bytes[3] !== 0x50) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const layerCount = view.getUint16(16, true);
    if (layerCount === 0) return null;

    const layerChunkOffset = view.getUint32(28, true);
    const layerBase = layerChunkOffset + 4; // skip the chunk's own count field
    const width = view.getUint16(layerBase + 4, true);
    const height = view.getUint16(layerBase + 6, true);
    // Absolute file offset, per the D2M spec and what tilemap-builder writes.
    // Adding layerChunkOffset to it again landed the read one chunk header plus
    // one tileset record too far in, which slid the whole map 17 cells left.
    const dataOffset = view.getUint32(layerBase + 8, true);
    const cellCount = Math.min(width * height, view.getUint32(layerBase + 12, true) / 4);

    const tiles = new Uint8Array(width * height);
    for (let i = 0; i < cellCount; i += 1) {
      const gid = view.getUint32(dataOffset + i * 4, true);
      tiles[i] = gid > 0 ? ((gid - 1) & 0xff) : 0;
    }

    return { tiles, width, height };
  }

  /**
   * Run once by the extension loader, before any PICO-8 function is
   * registered. Installs the language-level behaviour a cart expects but that
   * no single API function can provide.
   */
  initialize(luaState) {
    const state = luaState || this.luaState;
    state?.execute(LuaPico8Extensions.STRING_INDEX_LUA);
    state?.execute(LuaPico8Extensions.FIXED_POINT_LUA);
  }

  resetRuntimeState() {
    this.currentColor = 0;
    this._fillPattern = 0;
    this._fillPatternTransparent = false;
    this._cameraX = 0;
    this._cameraY = 0;
    this._cursorX = 0;
    this._cursorY = 0;
    this._clipRect = { x: 0, y: 0, w: this._logicalWidth, h: this._logicalHeight };
    // Matches PICO-8's reset(), which clears the draw state registers - the
    // print attribute defaults at 0x5f58 among them.
    this._drawStateRam = null;
    this.currentPalette.clear();
    this._resetScreenPalette();
    this._transparent = new Set([0]);
    this._tlineBits = 13;
    this._clearFb(0, false);
  }

  _setFramebufferSize(width, height) {
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    if (this._fbWidth === w && this._fbHeight === h) {
      return;
    }

    const oldWidth = this._fbWidth;
    const oldHeight = this._fbHeight;
    const oldBuffer = this._framebuffer;

    this._fbWidth = w;
    this._fbHeight = h;
    this._framebuffer = new Uint8Array(this._fbWidth * this._fbHeight);

    // Keep existing frame data when mode switches between logical and full-res.
    if (oldBuffer && oldWidth > 0 && oldHeight > 0) {
      for (let py = 0; py < this._fbHeight; py += 1) {
        const srcY = Math.min(oldHeight - 1, Math.floor((py * oldHeight) / this._fbHeight));
        const dstRow = py * this._fbWidth;
        const srcRow = srcY * oldWidth;
        for (let px = 0; px < this._fbWidth; px += 1) {
          const srcX = Math.min(oldWidth - 1, Math.floor((px * oldWidth) / this._fbWidth));
          this._framebuffer[dstRow + px] = oldBuffer[srcRow + srcX];
        }
      }
    }

    this._fbTexture = null;
    this._dirty = true;
  }

  _isFullResolutionMode() {
    return this._picoRenderScale <= 0;
  }

  /**
   * Horizontal and vertical divisors from the screen mode register, 0x5f2c.
   *
   * PICO-8 keeps a full 128x128 framebuffer in every mode; the stretch modes
   * only magnify its top-left corner, so a cart that pokes mode 3 draws to a
   * 64x64 area and the hardware doubles it. Carts written for LOWREZ jams rely
   * on this, and without it they render into one quarter of the screen.
   *
   * Only the stretch modes are reproduced. The mirror and flip modes share the
   * register but are left alone rather than guessed at.
   */
  _screenModeDivisors() {
    switch (this._readByte(0x5f2c)) {
      case 1: return [2, 1];
      case 2: return [1, 2];
      case 3: return [2, 2];
      default: return [1, 1];
    }
  }

  _logicalToRenderX(x) {
    return Math.floor((x * this._fbWidth) / this._logicalWidth);
  }

  _logicalToRenderY(y) {
    return Math.floor((y * this._fbHeight) / this._logicalHeight);
  }

  _logicalCellBounds(x, y) {
    const x0 = Math.floor((x * this._fbWidth) / this._logicalWidth);
    const x1 = Math.ceil(((x + 1) * this._fbWidth) / this._logicalWidth) - 1;
    const y0 = Math.floor((y * this._fbHeight) / this._logicalHeight);
    const y1 = Math.ceil(((y + 1) * this._fbHeight) / this._logicalHeight) - 1;
    return { x0, x1, y0, y1 };
  }

  static PICO8_RGB = [
    [0, 0, 0], [29, 43, 83], [126, 37, 83], [0, 135, 81],
    [171, 82, 54], [95, 87, 79], [194, 195, 199], [255, 241, 232],
    [255, 0, 77], [255, 163, 0], [255, 236, 39], [0, 228, 54],
    [41, 173, 255], [131, 118, 156], [255, 119, 168], [255, 204, 170],
  ];

  // 0x7fff.ffff, the largest number 16.16 fixed point can hold. PICO-8 has no
  // NaN or infinity, and division by zero lands here (negated when negative).
  static NUMBER_MAX = 0x7fffffff / 0x10000;

  // PICO-8's second bank of 16 colours, addressed as 128-143. Carts reach them
  // through the screen palette, e.g. pal(14, 141, 1).
  static PICO8_EXTENDED_RGB = [
    [41, 24, 20], [17, 29, 53], [66, 33, 54], [18, 83, 89],
    [116, 47, 41], [73, 51, 59], [162, 136, 121], [243, 239, 125],
    [190, 18, 80], [255, 108, 36], [168, 231, 46], [0, 181, 67],
    [6, 90, 181], [117, 70, 101], [255, 110, 89], [255, 157, 129],
  ];

  _buildPicoPaletteRGBA() {
    const palette = new Uint8Array(1024);

    for (let i = 0; i < 256; i += 1) {
      // The screen palette only redirects the 16 drawable indices; anything
      // else keeps its own colour so a framebuffer byte outside 0-15 still
      // renders as something rather than black.
      const source = i < 16 ? this._screenPalette[i] : i;
      const p = LuaPico8Extensions._colorRGB(source);
      const o = i * 4;
      palette[o] = p[0];
      palette[o + 1] = p[1];
      palette[o + 2] = p[2];
      palette[o + 3] = 255;
    }
    this._paletteRGBADirty = false;
    return palette;
  }

  /** Resolve a PICO-8 colour number, including the extended 128-143 range. */
  static _colorRGB(n) {
    const c = n & 0xff;
    if (c >= 128 && c <= 143) return LuaPico8Extensions.PICO8_EXTENDED_RGB[c - 128];
    return LuaPico8Extensions.PICO8_RGB[c & 0x0f];
  }

  _getFallbackEngine() {
    return {
      setPixel: (x, y, c) => {
        // pset() is one of the shape functions the fill pattern applies to.
        this._plot(x, y, c, false, true);
      },
      getPixel: (x, y) => this._readPixel(x, y),
      line: (x0, y0, x1, y1, c) => this._lineToFb(x0, y0, x1, y1, c),
      rect: (x0, y0, x1, y1, c) => this._rectToFb(x0, y0, x1, y1, c),
      rectfill: (x0, y0, x1, y1, c) => this._rectFillToFb(x0, y0, x1, y1, c),
      circ: (x, y, r, c) => this._circToFb(x, y, r, c),
      circfill: (x, y, r, c) => this._circFillToFb(x, y, r, c),
      oval: (x0, y0, x1, y1, c) => this._ovalToFb(x0, y0, x1, y1, c),
      ovalfill: (x0, y0, x1, y1, c) => this._ovalFillToFb(x0, y0, x1, y1, c),
      clear: (c) => this._clearFb(c),
      setCamera: (x, y) => {
        this._cameraX = x | 0;
        this._cameraY = y | 0;
      },
      setClip: (x, y, w, h) => {
        this._clipRect = {
          x: x | 0,
          y: y | 0,
          w: Math.max(0, w | 0),
          h: Math.max(0, h | 0),
        };
      },
    };
  }

  _getEngine() {
    // Use Pico framebuffer primitives consistently to match Pico-8 coordinates.
    // Sprite engine integration remains available for non-primitive APIs.
    return this._getFallbackEngine();
  }

  _markDirty() {
    this._dirty = true;
    this._renderEnabled = true;
  }

  _inClip(x, y) {
    return x >= this._clipRect.x
      && y >= this._clipRect.y
      && x < (this._clipRect.x + this._clipRect.w)
      && y < (this._clipRect.y + this._clipRect.h);
  }

  _inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this._fbWidth && y < this._fbHeight;
  }

  /**
   * Resolve the pen colour for one pixel of a shape draw.
   *
   * The fill pattern is a 4x4 tile taken from the low 16 bits of the fillp()
   * argument, read left to right and top to bottom starting at the most
   * significant bit. A clear bit draws the colour's low nibble; a set bit
   * draws the high nibble, or nothing at all in transparent mode.
   *
   * Keyed on the screen position rather than the shape, so a moving shape
   * slides across a fixed grid the way PICO-8 does it.
   *
   * Returns -1 when the pixel must be left untouched.
   */
  _fillPatternColorAt(screenX, screenY, color) {
    const value = color & 0xff;
    if (this._fillPattern === 0) {
      // Solid: the pen colour only, never the secondary nibble.
      return value & 0x0f;
    }

    const bit = ((screenY & 3) * 4) + (screenX & 3);
    if (((this._fillPattern >> (15 - bit)) & 1) === 0) {
      return value & 0x0f;
    }
    return this._fillPatternTransparent ? -1 : (value >> 4) & 0x0f;
  }

  _plot(x, y, color, useCamera = true, applyFillPattern = false) {
    const drawX = (x | 0) - (useCamera ? this._cameraX : 0);
    const drawY = (y | 0) - (useCamera ? this._cameraY : 0);
    if (!this._inClip(drawX, drawY)) {
      return;
    }

    // Only the shape functions carry the fill pattern; spr() and print() draw
    // their own pixels and must not be stippled.
    const pen = applyFillPattern
      ? this._fillPatternColorAt(drawX, drawY, color)
      : color;
    if (pen < 0) {
      return;
    }

    // pal() draw-palette remap applies to every draw operation.
    const c = this.currentPalette.size > 0
      ? (this.currentPalette.get(pen & 0x0f) ?? pen)
      : pen;

    if (!this._isFullResolutionMode()) {
      if (!this._inBounds(drawX, drawY)) {
        return;
      }
      this._framebuffer[drawY * this._fbWidth + drawX] = c & 0xff;
      this._markDirty();
      return;
    }

    const { x0, x1, y0, y1 } = this._logicalCellBounds(drawX, drawY);
    const minX = Math.max(0, x0);
    const maxX = Math.min(this._fbWidth - 1, x1);
    const minY = Math.max(0, y0);
    const maxY = Math.min(this._fbHeight - 1, y1);
    if (minX > maxX || minY > maxY) {
      return;
    }

    for (let py = minY; py <= maxY; py += 1) {
      const row = py * this._fbWidth;
      for (let px = minX; px <= maxX; px += 1) {
        this._framebuffer[row + px] = c & 0xff;
      }
    }
    this._markDirty();
  }

  _readPixel(x, y) {
    const px = x | 0;
    const py = y | 0;
    if (px < 0 || py < 0 || px >= this._logicalWidth || py >= this._logicalHeight) {
      return 0;
    }

    if (!this._isFullResolutionMode()) {
      return this._framebuffer[py * this._fbWidth + px] || 0;
    }

    const sampleX = Math.min(this._fbWidth - 1, Math.max(0, this._logicalToRenderX(px)));
    const sampleY = Math.min(this._fbHeight - 1, Math.max(0, this._logicalToRenderY(py)));
    return this._framebuffer[sampleY * this._fbWidth + sampleX] || 0;
  }

  _drawCircleHighRes(x, y, r, c, filled) {
    const logicalR = Math.max(0, r | 0);
    this._drawEllipseHighRes(x | 0, y | 0, logicalR, logicalR, c, filled);
  }

  /**
   * Rasterise an ellipse into the scaled framebuffer.
   *
   * Takes the centre and the two radii in logical (cart) pixels. A circle is
   * just the case where both radii match, so circ()/circfill() come through
   * here too rather than keeping a second copy of the same scan.
   */
  _drawEllipseHighRes(x, y, radiusX, radiusY, c, filled) {
    const logicalCx = (x | 0) - this._cameraX;
    const logicalCy = (y | 0) - this._cameraY;

    const sx = this._fbWidth / this._logicalWidth;
    const sy = this._fbHeight / this._logicalHeight;
    const cx = (logicalCx + 0.5) * sx;
    const cy = (logicalCy + 0.5) * sy;
    const rx = Math.max(0.5, Math.max(0, radiusX) * sx);
    const ry = Math.max(0.5, Math.max(0, radiusY) * sy);
    const rxSq = rx * rx;
    const rySq = ry * ry;

    const minX = Math.max(0, Math.floor(cx - rx - 1));
    const maxX = Math.min(this._fbWidth - 1, Math.ceil(cx + rx + 1));
    const minY = Math.max(0, Math.floor(cy - ry - 1));
    const maxY = Math.min(this._fbHeight - 1, Math.ceil(cy + ry + 1));
    const edge = 1 / Math.max(1, Math.min(rx, ry));

    for (let py = minY; py <= maxY; py += 1) {
      const row = py * this._fbWidth;
      const logicalY = Math.floor((py * this._logicalHeight) / this._fbHeight);
      for (let px = minX; px <= maxX; px += 1) {
        const logicalX = Math.floor((px * this._logicalWidth) / this._fbWidth);
        if (!this._inClip(logicalX, logicalY)) {
          continue;
        }

        const dx = (px + 0.5) - cx;
        const dy = (py + 0.5) - cy;
        const metric = (dx * dx) / rxSq + (dy * dy) / rySq;

        if (filled ? metric <= 1 : Math.abs(metric - 1) <= edge) {
          // Keyed on the logical position so the pattern stays a 4x4 tile in
          // cart pixels rather than shrinking as the framebuffer scales up.
          const pen = this._fillPatternColorAt(logicalX, logicalY, c);
          if (pen < 0) {
            continue;
          }
          this._framebuffer[row + px] = pen & 0xff;
        }
      }
    }

    this._markDirty();
  }

  _lineToFb(x0, y0, x1, y1, c) {
    let ax = (x0 | 0) - this._cameraX;
    let ay = (y0 | 0) - this._cameraY;
    const bx = (x1 | 0) - this._cameraX;
    const by = (y1 | 0) - this._cameraY;

    const dx = Math.abs(bx - ax);
    const sx = ax < bx ? 1 : -1;
    const dy = -Math.abs(by - ay);
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;

    while (true) {
      this._plot(ax, ay, c, false, true);
      if (ax === bx && ay === by) {
        break;
      }
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
  }

  _rectToFb(x0, y0, x1, y1, c) {
    const ax = Math.min(x0, x1) | 0;
    const ay = Math.min(y0, y1) | 0;
    const bx = Math.max(x0, x1) | 0;
    const by = Math.max(y0, y1) | 0;
    this._lineToFb(ax, ay, bx, ay, c);
    this._lineToFb(ax, by, bx, by, c);
    this._lineToFb(ax, ay, ax, by, c);
    this._lineToFb(bx, ay, bx, by, c);
  }

  _rectFillToFb(x0, y0, x1, y1, c) {
    const ax = Math.min(x0, x1) | 0;
    const ay = Math.min(y0, y1) | 0;
    const bx = Math.max(x0, x1) | 0;
    const by = Math.max(y0, y1) | 0;
    for (let y = ay; y <= by; y += 1) {
      this._lineToFb(ax, y, bx, y, c);
    }
  }

  _circToFb(x, y, r, c) {
    if (this._isFullResolutionMode()) {
      this._drawCircleHighRes(x, y, r, c, false);
      return;
    }

    const cx = (x | 0) - this._cameraX;
    const cy = (y | 0) - this._cameraY;
    let dx = Math.max(0, r | 0);
    let dy = 0;
    let err = 1 - dx;

    while (dx >= dy) {
      this._plot(cx + dx, cy + dy, c, false, true);
      this._plot(cx + dy, cy + dx, c, false, true);
      this._plot(cx - dy, cy + dx, c, false, true);
      this._plot(cx - dx, cy + dy, c, false, true);
      this._plot(cx - dx, cy - dy, c, false, true);
      this._plot(cx - dy, cy - dx, c, false, true);
      this._plot(cx + dy, cy - dx, c, false, true);
      this._plot(cx + dx, cy - dy, c, false, true);
      dy += 1;
      if (err < 0) {
        err += 2 * dy + 1;
      } else {
        dx -= 1;
        err += 2 * (dy - dx) + 1;
      }
    }
  }

  _circFillToFb(x, y, r, c) {
    if (this._isFullResolutionMode()) {
      this._drawCircleHighRes(x, y, r, c, true);
      return;
    }

    // Logical coordinates throughout: _lineToFb applies the camera itself, so
    // subtracting it here as well would offset the fill from circ()'s outline.
    const cx = x | 0;
    const cy = y | 0;
    let dx = Math.max(0, r | 0);
    let dy = 0;
    let err = 1 - dx;

    while (dx >= dy) {
      this._lineToFb(cx - dx, cy + dy, cx + dx, cy + dy, c);
      this._lineToFb(cx - dx, cy - dy, cx + dx, cy - dy, c);
      this._lineToFb(cx - dy, cy + dx, cx + dy, cy + dx, c);
      this._lineToFb(cx - dy, cy - dx, cx + dy, cy - dx, c);
      dy += 1;
      if (err < 0) {
        err += 2 * dy + 1;
      } else {
        dx -= 1;
        err += 2 * (dy - dx) + 1;
      }
    }
  }

  /**
   * Ellipse outline into the unscaled framebuffer, from a bounding box.
   *
   * Scanned on both axes: sweeping rows alone leaves gaps across the flat top
   * and bottom of a wide ellipse, where one row spans many columns.
   */
  _ovalToFb(x0, y0, x1, y1, c) {
    const left = Math.min(x0, x1) | 0;
    const top = Math.min(y0, y1) | 0;
    const right = Math.max(x0, x1) | 0;
    const bottom = Math.max(y0, y1) | 0;

    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const rx = Math.max(0.5, (right - left) / 2);
    const ry = Math.max(0.5, (bottom - top) / 2);

    for (let py = top; py <= bottom; py += 1) {
      const ny = (py - cy) / ry;
      const span = 1 - (ny * ny);
      const half = span <= 0 ? 0 : rx * Math.sqrt(span);
      this._plot(Math.round(cx - half), py, c, true, true);
      this._plot(Math.round(cx + half), py, c, true, true);
    }
    for (let px = left; px <= right; px += 1) {
      const nx = (px - cx) / rx;
      const span = 1 - (nx * nx);
      const half = span <= 0 ? 0 : ry * Math.sqrt(span);
      this._plot(px, Math.round(cy - half), c, true, true);
      this._plot(px, Math.round(cy + half), c, true, true);
    }
  }

  /** Filled ellipse into the unscaled framebuffer, from a bounding box. */
  _ovalFillToFb(x0, y0, x1, y1, c) {
    const left = Math.min(x0, x1) | 0;
    const top = Math.min(y0, y1) | 0;
    const right = Math.max(x0, x1) | 0;
    const bottom = Math.max(y0, y1) | 0;

    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const rx = Math.max(0.5, (right - left) / 2);
    const ry = Math.max(0.5, (bottom - top) / 2);

    for (let py = top; py <= bottom; py += 1) {
      const ny = (py - cy) / ry;
      const span = 1 - (ny * ny);
      if (span <= 0) {
        this._plot(Math.round(cx), py, c, true, true);
        continue;
      }
      const half = rx * Math.sqrt(span);
      this._lineToFb(Math.round(cx - half), py, Math.round(cx + half), py, c);
    }
  }

  _clearFb(color, enableRender = true) {
    this._framebuffer.fill(color & 0xff);
    this._dirty = true;
    if (enableRender) {
      this._renderEnabled = true;
    }
  }

  /**
   * Scroll the framebuffer up, filling the exposed rows with colour 0.
   *
   * Used by print() when the text cursor walks off the bottom of the screen,
   * which is how PICO-8 behaves for coordinate-less print(). `rows` is in
   * logical pixels; in full-resolution mode one logical row is several
   * framebuffer rows.
   */
  _scrollFb(logicalRows) {
    const rows = this._logicalToRenderY(logicalRows);
    if (rows <= 0) {
      return;
    }
    const shift = rows * this._fbWidth;
    if (shift >= this._framebuffer.length) {
      this._clearFb(0);
      return;
    }
    this._framebuffer.copyWithin(0, shift);
    this._framebuffer.fill(0, this._framebuffer.length - shift);
    this._markDirty();
  }

  _ensureFramebufferTexture(gpu) {
    if (!gpu) {
      return;
    }
    if (this._fbTexture && this._dirty) {
      gpu.deleteTexture(this._fbTexture);
      this._fbTexture = null;
    }
    if (!this._fbTexture) {
      this._fbTexture = gpu.createTextureRaw(this._framebuffer, this._fbWidth, this._fbHeight, 0x09);
      this._dirty = false;
    }
  }

  renderFrame(gpu, deltaMs, renderOptions = null) {
    if (!this._renderEnabled) {
      return;
    }

    const activeGpu = gpu || this._gpu;
    if (!activeGpu) {
      return;
    }

    const drawFramebuffer = () => {
      const canvasWidth = activeGpu?.canvas?.width || 448;
      const canvasHeight = activeGpu?.canvas?.height || 368;

      if (this._isFullResolutionMode()) {
        this._setFramebufferSize(canvasWidth, canvasHeight);
      } else {
        this._setFramebufferSize(this._logicalWidth, this._logicalHeight);
      }

      this._ensureFramebufferTexture(activeGpu);
      if (!this._fbTexture) {
        return;
      }
      if (this._paletteRGBADirty) {
        this._paletteRGBA = this._buildPicoPaletteRGBA();
      }
      activeGpu.setPalette(this._paletteRGBA);
      activeGpu.setPaletteOffset(0);
      let drawX = 0;
      let drawY = 0;

      // A stretch mode magnifies the top-left corner of the framebuffer, so it
      // shows less of it at a larger scale while filling the same output area.
      const [modeX, modeY] = this._screenModeDivisors();
      const srcW = Math.max(1, Math.floor(this._fbWidth / modeX));
      const srcH = Math.max(1, Math.floor(this._fbHeight / modeY));
      let scaleX = modeX;
      let scaleY = modeY;

      if (this._picoRenderScale > 0) {
        const drawW = srcW * this._picoRenderScale * modeX;
        const drawH = srcH * this._picoRenderScale * modeY;
        drawX = Math.floor((canvasWidth - drawW) * 0.5);
        drawY = Math.floor((canvasHeight - drawH) * 0.5);
        scaleX = this._picoRenderScale * modeX;
        scaleY = this._picoRenderScale * modeY;
      }

      activeGpu.blit(this._fbTexture, {
        x: drawX,
        y: drawY,
        srcX: 0,
        srcY: 0,
        srcW,
        srcH,
        scaleX,
        scaleY,
        filter: 'nearest',
      });
    };

    if (typeof renderOptions?.enqueue === 'function') {
      renderOptions.enqueue({
        type: 'pico8',
        z: null,
        defaultLayer: 1500,
        creationOrder: 0,
        draw: drawFramebuffer,
      });
    } else {
      drawFramebuffer();
    }
  }

  // ============================================================
  // Helper Methods for Argument Processing
  // ============================================================

  _readArg(args, index, allowStackFallback = true) {
    if (args && index < args.length) {
      return args[index];
    }
    if (!allowStackFallback) {
      return undefined;
    }
    return this.luaState?.raw_tostring?.(index + 2);
  }

  _optionalNumberArg(args, index, defaultValue, methodName, argName) {
    const hasExplicitArgs = !!args && args.length > 0;
    if (!hasExplicitArgs || index >= args.length) {
      return defaultValue;
    }
    const raw = args[index];
    if (raw === undefined || raw === null) {
      return this._nilOptionalArg(defaultValue);
    }
    if (raw === '') {
      return defaultValue;
    }
    return this._coerceNumberArg(raw, methodName, argName);
  }

  /**
   * What an optional argument means when the cart passed it, but passed nil.
   *
   * PICO-8's optional parameters are optional by COUNT, not by value: the
   * manual writes them as PRINT(STR, X, Y, [COL]), and "not specified" means
   * the argument was left off. Handing one an explicit nil is an ordinary
   * numeric argument that happens to be nil, so it coerces to 0 like every
   * other builtin argument does.
   *
   * galaxis.p8 depends on this. Its outline helper is
   *
   *   function oprint(t,x,y,c,o)
   *     for _x=-1,1 do for _y=-1,1 do print(t,x+_x,y+_y,o) end end
   *     print(t,x,y,c)
   *   end
   *
   * and the title screen calls it without `o`, so the outline passes print a
   * nil colour. Treating that as "keep the current pen" made each outline
   * inherit the previous line's fill colour, and since oprint dilates the text
   * by a pixel in all eight directions, same-coloured outlines closed up the
   * gaps between glyphs and turned whole words into solid bars.
   */
  _nilOptionalArg() {
    return 0;
  }

  _requireNumberArg(args, index, methodName, argName) {
    const hasExplicitArgs = !!args && args.length > 0;
    const raw = this._readArg(args, index, !hasExplicitArgs);
    return this._coerceNumberArg(raw, methodName, argName);
  }

  _requireIntegerArg(args, index, methodName, argName) {
    const hasExplicitArgs = !!args && args.length > 0;
    const raw = this._readArg(args, index, !hasExplicitArgs);
    return Math.trunc(this._coerceNumberArg(raw, methodName, argName));
  }

  _optionalIntegerArg(args, index, defaultValue, methodName, argName) {
    const hasExplicitArgs = !!args && args.length > 0;
    if (!hasExplicitArgs || index >= args.length) {
      return defaultValue;
    }
    const raw = args[index];
    if (raw === undefined || raw === null) {
      return Math.trunc(this._nilOptionalArg(defaultValue));
    }
    if (raw === '') {
      return defaultValue;
    }
    return Math.trunc(this._coerceNumberArg(raw, methodName, argName));
  }

  /**
   * Coerce an argument the way a PICO-8 builtin does.
   *
   * These used to throw, which is friendlier to someone writing a cart but is
   * not what the console does, and real carts rely on the console's behaviour.
   * starfox.p8 calls generate_cam_matrix_transform(cam_ax, cam_ay, cam_az)
   * every frame while only ever assigning cam_az, so sin() is handed nil twice
   * per frame and PICO-8 runs it happily. The manual is explicit about this
   * where it contrasts the bitwise operators with their function forms: "if any
   * operands are not numbers the result is a runtime error (the function
   * versions instead default to a value of 0)".
   *
   * PICO-8 also has no NaN or infinity - every number is 16.16 fixed point in
   * -32768 .. 32767.99998 - and the manual states that dividing by zero
   * "evaluates to 0x7fff.ffff if positive, or -0x7fff.ffff if negative". Our
   * Lua VM divides in doubles, so galaxis.p8's particle age/max_age of 0/0
   * reached min() as NaN. Zero is not negative, so NaN saturates positive.
   */
  /**
   * Whether the running cart was lowered onto raw 16.16 words, which decides
   * whether a number arriving from Lua is a value or a scaled word. Reads the
   * one constant so there is a single thing to flip.
   */
  get fixedPointNumbers() {
    return LuaPico8Extensions.FIXED_POINT;
  }

  /**
   * Undo the lowering's scaling on the way in. Everything on the JS side works
   * in ordinary values, so this is the only place the representation is known.
   */
  _fromRawNumber(value) {
    if (!LuaPico8Extensions.FIXED_POINT) return value;
    return value / 65536;
  }

  _coerceNumberArg(raw, methodName, argName) {
    if (raw === undefined || raw === null || raw === '') {
      this._warnCoercedArg(methodName, argName, raw);
      return 0;
    }

    if (typeof raw === 'number') return this._toPico8Number(this._fromRawNumber(raw));

    // The stack fallback in _readArg hands back Lua's tostring of the value.
    const text = String(raw).trim();
    const max = LuaPico8Extensions.NUMBER_MAX;
    if (/^-?inf/i.test(text)) return text.startsWith('-') ? -max : max;
    if (/nan$/i.test(text)) return max;

    const value = Number.parseFloat(text);
    if (Number.isFinite(value)) return this._fromRawNumber(value);

    this._warnCoercedArg(methodName, argName, raw);
    return 0;
  }

  /** Saturate the values PICO-8 cannot represent. */
  _toPico8Number(value) {
    if (Number.isFinite(value)) return value;
    if (Number.isNaN(value)) return LuaPico8Extensions.NUMBER_MAX;
    return value > 0 ? LuaPico8Extensions.NUMBER_MAX : -LuaPico8Extensions.NUMBER_MAX;
  }

  /**
   * PICO-8 says nothing when it coerces, but a cart author almost never means
   * to pass nil. Warn once per argument so the hint is there without spamming a
   * cart that does it every frame.
   */
  _warnCoercedArg(methodName, argName, raw) {
    if (!methodName || !argName) return;
    const key = `${methodName}.${argName}`;
    if (this._coercedArgWarnings.has(key)) return;
    this._coercedArgWarnings.add(key);
    const shown = raw === undefined || raw === null ? 'nil' : JSON.stringify(String(raw));
    console.warn(`[Pico8] ${methodName}(${argName}) got ${shown}; using 0, as PICO-8 does.`);
  }

  /** Warn about a runtime gap once, for the same reason as _warnCoercedArg. */
  _warnOnce(key, message) {
    if (this._coercedArgWarnings.has(key)) return;
    this._coercedArgWarnings.add(key);
    console.warn(`[Pico8] ${message}`);
  }

  /**
   * Read an optional PICO-8 flag argument.
   * PICO-8 passes real booleans (palt(0, true)), but 0/1 is also idiomatic,
   * so both spellings are accepted.
   */
  _optionalFlagArg(args, index, defaultValue, methodName, argName) {
    const raw = args?.[index];
    if (raw === undefined || raw === null || raw === '') {
      return defaultValue;
    }
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    if (typeof raw === 'string') {
      const normalized = raw.toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
      const numeric = Number.parseFloat(raw);
      if (Number.isFinite(numeric)) return numeric !== 0;
    }
    throw new Error(`[Pico8] ${methodName} invalid boolean argument ${argName}: ${raw}`);
  }

  // ============================================================
  // Graphics Functions
  // ============================================================

  /**
   * Set pixel color at (x, y) to c
   * Lua: pset(x, y, [c])
   */
  pset(...args) {
    const x = this._requireNumberArg(args, 0, 'pset', 'x');
    const y = this._requireNumberArg(args, 1, 'pset', 'y');
    const c = this._optionalNumberArg(args, 2, this.currentColor, 'pset', 'c');
    
    const engine = this._getEngine();
    if (engine?.setPixel) {
      engine.setPixel(Math.floor(x), Math.floor(y), Math.floor(c) & 0xFF);
    }
  }

  /**
   * Get pixel color at (x, y)
   * Lua: pget(x, y) -> color
   */
  pget(...args) {
    const x = this._requireNumberArg(args, 0, 'pget', 'x');
    const y = this._requireNumberArg(args, 1, 'pget', 'y');
    
    const engine = this._getEngine();
    if (engine?.getPixel) {
      return engine.getPixel(Math.floor(x), Math.floor(y)) || 0;
    }
    return 0;
  }

  /**
   * Set pen color
   *
   * The high nibble is the secondary colour used by the set bits of the
   * fillp() pattern, so color(0x21) draws in 1 and patterns in 2.
   *
   * Lua: color(c)
   */
  color(...args) {
    const c = this._requireNumberArg(args, 0, 'color', 'c');
    this.currentColor = Math.floor(c) & 0xFF;
  }

  /**
   * Set the 4x4 fill pattern used by pset, line, rect, rectfill, circ and
   * circfill. Sprites, the map and text are unaffected.
   *
   * Lua: fillp([p])
   */
  fillp(...args) {
    // fillp() and fillp(nil) both mean "solid again". Carts lean on the nil
    // form, writing fillp(cond and pattern or unset_global) to clear it.
    const p = this._optionalNumberArg(args, 0, 0, 'fillp', 'p');

    // PICO-8 numbers are 16.16 fixed point: the pattern is the integer part
    // and the 0b0.1 fraction bit asks for transparency instead of a second
    // colour. Taken apart by hand because the fixed-point value overflows the
    // 32-bit ints that JavaScript bit operators use.
    const whole = Math.floor(p);
    this._fillPattern = whole & 0xffff;
    this._fillPatternTransparent = (Math.round((p - whole) * 65536) & 0x8000) !== 0;
  }

  /**
   * Draw line from (x0,y0) to (x1,y1) with optional color
   * Lua: line(x0, y0, x1, y1, [c])
   */
  line(...args) {
    const x0 = this._requireNumberArg(args, 0, 'line', 'x0');
    const y0 = this._requireNumberArg(args, 1, 'line', 'y0');
    const x1 = this._requireNumberArg(args, 2, 'line', 'x1');
    const y1 = this._requireNumberArg(args, 3, 'line', 'y1');
    const c = this._optionalNumberArg(args, 4, this.currentColor, 'line', 'c');
    
    const engine = this._getEngine();
    if (engine?.line) {
      engine.line(
        Math.floor(x0), Math.floor(y0),
        Math.floor(x1), Math.floor(y1),
        Math.floor(c) & 0xFF
      );
    }
  }

  /**
   * Draw rectangle outline from (x0,y0) to (x1,y1) with optional color
   * Lua: rect(x0, y0, x1, y1, [c])
   */
  rect(...args) {
    const x0 = this._requireNumberArg(args, 0, 'rect', 'x0');
    const y0 = this._requireNumberArg(args, 1, 'rect', 'y0');
    const x1 = this._requireNumberArg(args, 2, 'rect', 'x1');
    const y1 = this._requireNumberArg(args, 3, 'rect', 'y1');
    const c = this._optionalNumberArg(args, 4, this.currentColor, 'rect', 'c');
    
    const engine = this._getEngine();
    if (engine?.rect) {
      engine.rect(
        Math.floor(x0), Math.floor(y0),
        Math.floor(x1), Math.floor(y1),
        Math.floor(c) & 0xFF
      );
    }
  }

  /**
   * Draw filled rectangle from (x0,y0) to (x1,y1) with optional color
   * Lua: rectfill(x0, y0, x1, y1, [c])
   */
  rectfill(...args) {
    const x0 = this._requireNumberArg(args, 0, 'rectfill', 'x0');
    const y0 = this._requireNumberArg(args, 1, 'rectfill', 'y0');
    const x1 = this._requireNumberArg(args, 2, 'rectfill', 'x1');
    const y1 = this._requireNumberArg(args, 3, 'rectfill', 'y1');
    const c = this._optionalNumberArg(args, 4, this.currentColor, 'rectfill', 'c');
    
    const engine = this._getEngine();
    if (engine?.rectfill) {
      engine.rectfill(
        Math.floor(x0), Math.floor(y0),
        Math.floor(x1), Math.floor(y1),
        Math.floor(c) & 0xFF
      );
    }
  }

  /**
   * Draw circle outline at (x,y) with radius r and optional color
   * Lua: circ(x, y, r, [c])
   */
  circ(...args) {
    const x = this._requireNumberArg(args, 0, 'circ', 'x');
    const y = this._requireNumberArg(args, 1, 'circ', 'y');
    const r = this._requireNumberArg(args, 2, 'circ', 'r');
    const c = this._optionalNumberArg(args, 3, this.currentColor, 'circ', 'c');
    
    const engine = this._getEngine();
    if (engine?.circ) {
      engine.circ(
        Math.floor(x), Math.floor(y),
        Math.floor(r),
        Math.floor(c) & 0xFF
      );
    }
  }

  /**
   * Draw filled circle at (x,y) with radius r and optional color
   * Lua: circfill(x, y, r, [c])
   */
  circfill(...args) {
    const x = this._requireNumberArg(args, 0, 'circfill', 'x');
    const y = this._requireNumberArg(args, 1, 'circfill', 'y');
    const r = this._requireNumberArg(args, 2, 'circfill', 'r');
    const c = this._optionalNumberArg(args, 3, this.currentColor, 'circfill', 'c');
    const engine = this._getEngine();
    if (engine?.circfill) {
      engine.circfill(
        Math.floor(x), Math.floor(y),
        Math.floor(r),
        Math.floor(c) & 0xFF
      );
    }
  }

  /**
   * Draw ellipse outline inside the bounding box (x0,y0)-(x1,y1)
   * Lua: oval(x0, y0, x1, y1, [c])
   */
  oval(...args) {
    const x0 = this._requireNumberArg(args, 0, 'oval', 'x0');
    const y0 = this._requireNumberArg(args, 1, 'oval', 'y0');
    const x1 = this._requireNumberArg(args, 2, 'oval', 'x1');
    const y1 = this._requireNumberArg(args, 3, 'oval', 'y1');
    const c = this._optionalNumberArg(args, 4, this.currentColor, 'oval', 'c');

    const engine = this._getEngine();
    if (engine?.oval) {
      engine.oval(
        Math.floor(x0), Math.floor(y0),
        Math.floor(x1), Math.floor(y1),
        Math.floor(c) & 0xFF
      );
    }
  }

  /**
   * Draw filled ellipse inside the bounding box (x0,y0)-(x1,y1)
   * Lua: ovalfill(x0, y0, x1, y1, [c])
   */
  ovalfill(...args) {
    const x0 = this._requireNumberArg(args, 0, 'ovalfill', 'x0');
    const y0 = this._requireNumberArg(args, 1, 'ovalfill', 'y0');
    const x1 = this._requireNumberArg(args, 2, 'ovalfill', 'x1');
    const y1 = this._requireNumberArg(args, 3, 'ovalfill', 'y1');
    const c = this._optionalNumberArg(args, 4, this.currentColor, 'ovalfill', 'c');

    const engine = this._getEngine();
    if (engine?.ovalfill) {
      engine.ovalfill(
        Math.floor(x0), Math.floor(y0),
        Math.floor(x1), Math.floor(y1),
        Math.floor(c) & 0xFF
      );
    }
  }

  /**
   * Clear screen to color c
   * Lua: cls([c])
   */
  cls(...args) {
    const c = this._optionalNumberArg(args, 0, 0, 'cls', 'c');
    const engine = this._getEngine();
    if (engine?.clear) {
      engine.clear(Math.floor(c) & 0xFF);
    }
    // PICO-8 homes the text cursor on cls().
    this._cursorX = 0;
    this._cursorY = 0;
  }

  /**
   * Set Pico framebuffer presentation scale.
   * Lua: pico_mode([scale]) -> number
   * scale <= 0: stretch to full output canvas (default)
   * scale > 0: use fixed scale and center in output canvas
   */
  pico_mode(...args) {
    if (!args || args.length === 0) {
      return this._picoRenderScale;
    }

    const scale = this._optionalNumberArg(args, 0, 0, 'pico_mode', 'scale');
    this._picoRenderScale = scale > 0 ? scale : 0;
    if (this._picoRenderScale > 0) {
      this._setFramebufferSize(this._logicalWidth, this._logicalHeight);
    }
    return this._picoRenderScale;
  }

  /**
   * Install the decoded PICO-8 sprite sheet (one byte per pixel, palette
   * indices). Shared with the Studio sprite asset built from the same cart, so
   * there is a single source of pixels.
   */
  setSpriteSheet(pixels, width = 128, height = 128) {
    if (!pixels || !width || !height) {
      this._sheet = null;
      this._romSheet = null;
      return;
    }
    this._sheet = {
      pixels: pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels),
      width: width | 0,
      height: height | 0,
    };
    // reload() copies out of cart ROM, which never changes, so snapshot the
    // sheet before the cart gets a chance to sset()/poke() over it.
    this._romSheet = {
      pixels: new Uint8Array(this._sheet.pixels),
      width: this._sheet.width,
      height: this._sheet.height,
    };
  }

  /** Install map tile data (one byte per cell = sprite index). */
  setMapData(tiles, width = 128, height = 64) {
    if (!tiles || !width || !height) {
      this._map = null;
      this._romMap = null;
      return;
    }
    this._map = {
      tiles: tiles instanceof Uint8Array ? tiles : new Uint8Array(tiles),
      width: width | 0,
      height: height | 0,
    };
    this._romMap = {
      tiles: new Uint8Array(this._map.tiles),
      width: this._map.width,
      height: this._map.height,
    };
  }

  /**
   * Install the cart's `__gff__` sprite flags.
   *
   * Lua: pico_flags(["00010203..."]) -> hex string
   *
   * The flags are cart ROM with no Studio asset to live in — a `.texture` has
   * no per-sprite metadata — so the importer emits them as a hex string in the
   * generated `main.lua`. Without this every fget() returns 0, which silently
   * breaks any cart that uses flags for collision or terrain.
   */
  pico_flags(...args) {
    if (!args || args.length === 0 || args[0] === undefined || args[0] === null) {
      let hex = '';
      for (let i = 0; i < this.spriteFlags.length; i += 1) {
        hex += this.spriteFlags[i].toString(16).padStart(2, '0');
      }
      return hex;
    }

    const hex = String(args[0]).replace(/[^0-9a-fA-F]/g, '');
    this.spriteFlags.fill(0);
    const count = Math.min(this.spriteFlags.length, Math.floor(hex.length / 2));
    for (let i = 0; i < count; i += 1) {
      this.spriteFlags[i] = Number.parseInt(hex.substr(i * 2, 2), 16) & 0xff;
    }
    this._romSpriteFlags = new Uint8Array(this.spriteFlags);
    return hex;
  }

  /**
   * Run the cart at PICO-8's frame rate.
   *
   * Lua: pico_fps([rate]) -> number
   *
   * PICO-8 ticks at 30fps and only runs at 60 when the cart defines _update60.
   * Studio's loop calls Update() once per display frame, so a 30fps cart played
   * at double speed until the importer started calling this from Setup().
   *
   * Drawing still happens every display frame; only the game step is paced.
   * Passing 0 restores one update per display frame, which is the Studio
   * default and what every non-PICO-8 project uses.
   */
  pico_fps(...args) {
    const emulator = this.gameEmulator;
    if (!args || args.length === 0) {
      const interval = emulator?._updateIntervalMs || 0;
      return interval > 0 ? (1000 / interval) : 0;
    }

    const rate = this._optionalNumberArg(args, 0, 0, 'pico_fps', 'rate');
    if (typeof emulator?.setUpdateRate === 'function') {
      emulator.setUpdateRate(rate);
    }
    return rate > 0 ? rate : 0;
  }

  _sheetPixel(x, y) {
    const sheet = this._sheet;
    if (!sheet) return 0;
    if (x < 0 || y < 0 || x >= sheet.width || y >= sheet.height) return 0;
    return sheet.pixels[y * sheet.width + x] & 0x0f;
  }

  /** Sprite flags packed back into the PICO-8 byte layout (bit f = flag f). */
  _spriteFlagByte(n) {
    const index = n | 0;
    if (index < 0 || index >= this.spriteFlags.length) return 0;
    return this.spriteFlags[index];
  }

  /**
   * Copy a rectangle of the sprite sheet into the framebuffer.
   * Goes through _plot so clip, camera, transparency and the high-resolution
   * mode all behave exactly as they do for the shape primitives.
   */
  _blitSheet(sx, sy, sw, sh, dx, dy, flipX = false, flipY = false) {
    if (!this._sheet || sw <= 0 || sh <= 0) return;

    for (let row = 0; row < sh; row += 1) {
      const srcY = sy + (flipY ? (sh - 1 - row) : row);
      for (let col = 0; col < sw; col += 1) {
        const srcX = sx + (flipX ? (sw - 1 - col) : col);
        const c = this._sheetPixel(srcX, srcY);
        if (this._isTransparentColor(c)) continue;
        this._plot(dx + col, dy + row, c);
      }
    }
  }

  /** Nearest-neighbour stretch of a sheet rectangle (backs sspr). */
  _blitSheetScaled(sx, sy, sw, sh, dx, dy, dw, dh, flipX = false, flipY = false) {
    if (!this._sheet || sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;

    for (let row = 0; row < dh; row += 1) {
      const v = Math.floor((row * sh) / dh);
      const srcY = sy + (flipY ? (sh - 1 - v) : v);
      for (let col = 0; col < dw; col += 1) {
        const u = Math.floor((col * sw) / dw);
        const srcX = sx + (flipX ? (sw - 1 - u) : u);
        const c = this._sheetPixel(srcX, srcY);
        if (this._isTransparentColor(c)) continue;
        this._plot(dx + col, dy + row, c);
      }
    }
  }

  /**
   * Draw sprite n at (x,y) with optional width/height/flip flags
   * Lua: spr(n, x, y, [w, h, fx, fy])
   * w/h are measured in sprite cells and select a pixel rectangle of the sheet.
   */
  spr(...args) {
    const n = this._requireIntegerArg(args, 0, 'spr', 'n');
    const x = this._requireNumberArg(args, 1, 'spr', 'x');
    const y = this._requireNumberArg(args, 2, 'spr', 'y');
    const w = this._optionalNumberArg(args, 3, 1, 'spr', 'w');
    const h = this._optionalNumberArg(args, 4, 1, 'spr', 'h');
    // Carts pass real booleans here (`spr(n, x, y, 1, 1, flip, false)`), so
    // these must go through the flag reader rather than parseInt.
    const fx = this._optionalFlagArg(args, 5, false, 'spr', 'fx');
    const fy = this._optionalFlagArg(args, 6, false, 'spr', 'fy');

    const sx = (n % 16) * 8;
    const sy = Math.floor(n / 16) * 8;
    const sw = Math.max(0, Math.round(w * 8));
    const sh = Math.max(0, Math.round(h * 8));

    this._blitSheet(sx, sy, sw, sh, Math.floor(x), Math.floor(y), fx, fy);
  }

  /**
   * Draw a stretched rectangle of the sprite sheet.
   * Lua: sspr(sx, sy, sw, sh, dx, dy, [dw, dh, fx, fy])
   */
  sspr(...args) {
    const sx = this._requireIntegerArg(args, 0, 'sspr', 'sx');
    const sy = this._requireIntegerArg(args, 1, 'sspr', 'sy');
    const sw = this._requireIntegerArg(args, 2, 'sspr', 'sw');
    const sh = this._requireIntegerArg(args, 3, 'sspr', 'sh');
    const dx = this._requireNumberArg(args, 4, 'sspr', 'dx');
    const dy = this._requireNumberArg(args, 5, 'sspr', 'dy');
    const dw = this._optionalIntegerArg(args, 6, sw, 'sspr', 'dw');
    const dh = this._optionalIntegerArg(args, 7, sh, 'sspr', 'dh');
    const fx = this._optionalFlagArg(args, 8, false, 'sspr', 'fx');
    const fy = this._optionalFlagArg(args, 9, false, 'sspr', 'fy');

    this._blitSheetScaled(
      sx, sy, sw, sh,
      Math.floor(dx), Math.floor(dy), dw, dh,
      fx, fy
    );
  }

  /**
   * Draw map cells as sprites.
   * Lua: map(cx, cy, sx, sy, cw, ch, [layer])
   * Sprite 0 is treated as empty. When layer is non-zero only tiles whose
   * sprite flags contain at least one bit of layer are drawn.
   */
  map(...args) {
    const cx = this._optionalIntegerArg(args, 0, 0, 'map', 'cx');
    const cy = this._optionalIntegerArg(args, 1, 0, 'map', 'cy');
    // Screen coordinates must be floored, exactly as PICO-8's flr() and our
    // own spr()/_blitSheet do. _optionalIntegerArg truncates toward zero, so a
    // negative scroll offset such as -794.01 became -794 here but -795 for
    // sprites - putting map tiles one pixel right of anything drawn over them
    // and leaving a seam down the middle of scenery like Mario's pipes.
    const sx = Math.floor(this._optionalNumberArg(args, 2, 0, 'map', 'sx'));
    const sy = Math.floor(this._optionalNumberArg(args, 3, 0, 'map', 'sy'));
    const cw = this._optionalIntegerArg(args, 4, this._map?.width ?? 128, 'map', 'cw');
    const ch = this._optionalIntegerArg(args, 5, this._map?.height ?? 64, 'map', 'ch');
    const layer = this._optionalIntegerArg(args, 6, 0, 'map', 'layer');

    if (!this._map || !this._sheet) return;

    for (let row = 0; row < ch; row += 1) {
      for (let col = 0; col < cw; col += 1) {
        const tile = this._mapTile(cx + col, cy + row);
        if (tile === 0) continue; // PICO-8 skips sprite 0
        // The layer mask selects tiles carrying ANY of its flags, not tiles
        // carrying all of them. Requiring all of them meant a cart asking for
        // several gameplay layers at once - "UFO Swamp Odyssey" draws its
        // level with map(0, 0, 0, 0, 128, 64, 30), flags 1 through 4 - got an
        // empty screen, because no single sprite sets every flag in the mask.
        if (layer !== 0 && (this._spriteFlagByte(tile) & layer) === 0) continue;

        this._blitSheet(
          (tile % 16) * 8,
          Math.floor(tile / 16) * 8,
          8, 8,
          sx + (col * 8),
          sy + (row * 8)
        );
      }
    }
  }

  _mapTile(x, y) {
    const map = this._map;
    if (!map) return 0;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
    return map.tiles[y * map.width + x] & 0xff;
  }

  /**
   * Draw a line textured with the map.
   * Lua: tline(x0, y0, x1, y1, mx, my, [mdx], [mdy], [layers])
   *      tline(bits)
   *
   * Walks the screen line one pixel at a time while a second cursor walks the
   * map, advancing by (mdx, mdy) per pixel - so part of (mx, my) picks the
   * pixel within an 8x8 cell and the rest picks the cell. That indirection is
   * what makes tline() a texture mapper: carts rotate and scale sprites with
   * it, e.g. "Sonic 2.5" draws every rotated sprite as a stack of tlines
   * through a rotation matrix.
   *
   * Where the split falls is not fixed. PICO-8 numbers are 16.16 fixed point,
   * and a precision register says how many of those bits are sub-pixel, so the
   * map position is `raw(mx) >> bits` in map pixels. The default 13 makes one
   * unit a whole cell; calling tline with a single argument changes it, which
   * a perspective texture mapper needs because its step per screen pixel can be
   * far smaller than a cell. POOM raises it to 17 for wall spans and puts it
   * back to 13 for the floors.
   *
   * mdx/mdy default to 1/8 and 0 - one map pixel per screen pixel along x at
   * the default precision.
   */
  tline(...args) {
    // The single-argument form is a register write, not a draw.
    if (args.length === 1) {
      const bits = this._optionalIntegerArg(args, 0, 13, 'tline', 'bits');
      this._tlineBits = Math.max(0, Math.min(31, bits));
      return;
    }

    const x0 = Math.floor(this._requireNumberArg(args, 0, 'tline', 'x0'));
    const y0 = Math.floor(this._requireNumberArg(args, 1, 'tline', 'y0'));
    const x1 = Math.floor(this._requireNumberArg(args, 2, 'tline', 'x1'));
    const y1 = Math.floor(this._requireNumberArg(args, 3, 'tline', 'y1'));
    const mx = this._requireNumberArg(args, 4, 'tline', 'mx');
    const my = this._requireNumberArg(args, 5, 'tline', 'my');
    const mdx = this._optionalNumberArg(args, 6, 1 / 8, 'tline', 'mdx');
    const mdy = this._optionalNumberArg(args, 7, 0, 'tline', 'mdy');
    const layers = this._optionalIntegerArg(args, 8, 0, 'tline', 'layers');

    if (!this._map || !this._sheet) return;

    // The map cursor is stepped as the 32-bit fixed-point value the cart is
    // really working in. Adding mdx as a float would drift over a long span,
    // and wrapping is PICO-8's own behaviour when a coordinate runs past its
    // range rather than something to be avoided.
    const toRaw = (v) => Math.round(v * 65536) | 0;
    let rawX = toRaw(mx);
    let rawY = toRaw(my);
    const rawDx = toRaw(mdx);
    const rawDy = toRaw(mdy);
    const bits = this._tlineBits;

    // 0x5f38-0x5f3b wrap and place the sampled region: the size bytes are how
    // many cells the map coordinate repeats over, 0 meaning the whole map
    // width, and the offset bytes say which cell the region starts at. A cart
    // with several textures packed into one map picks between them by poking
    // these rather than by moving mx/my, which is why POOM writes all four
    // with one poke4 before every wall span.
    //
    // The wrap is a modulo, not a bit mask, and that difference matters: a
    // texture mapper's map coordinate goes negative all the time, and only a
    // modulo brings it back inside the region. Masking left POOM sampling
    // cell 243 of a 128-wide map, which is nothing, so its walls came out
    // black wherever the camera put a span behind the map origin.
    const map = this._map;
    const loopX = this._readByte(0x5f38) || 128;
    const loopY = this._readByte(0x5f39) || 128;
    const offsetX = this._readByte(0x5f3a);
    const offsetY = this._readByte(0x5f3b);

    // Bresenham along the screen line, the same walk line() uses, so a tline
    // and a line between the same endpoints cover exactly the same pixels.
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const stepX = x0 < x1 ? 1 : -1;
    const stepY = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    let x = x0;
    let y = y0;

    // A degenerate mdx/mdy would spin forever on a long line; the pixel budget
    // is the screen diagonal, which is all a real tline can ever cover.
    const budget = (dx - dy) + 1;
    for (let i = 0; i < budget; i += 1) {
      const mapX = rawX >> bits;
      const mapY = rawY >> bits;
      let cellX = (mapX >> 3) % loopX;
      if (cellX < 0) cellX += loopX;
      let cellY = (mapY >> 3) % loopY;
      if (cellY < 0) cellY += loopY;
      const tile = this._mapTile(
        (cellX + offsetX) % map.width,
        (cellY + offsetY) % map.height
      );
      // Sprite 0 is empty, and the layer mask selects any of its flags.
      if (tile !== 0 && (layers === 0 || (this._spriteFlagByte(tile) & layers) !== 0)) {
        const c = this._sheetPixel(
          ((tile % 16) * 8) + (mapX & 7),
          (Math.floor(tile / 16) * 8) + (mapY & 7)
        );
        if (!this._isTransparentColor(c)) this._plot(x, y, c);
      }

      if (x === x1 && y === y1) break;
      const e2 = 2 * error;
      if (e2 >= dy) { error += dy; x += stepX; }
      if (e2 <= dx) { error += dx; y += stepY; }
      rawX = (rawX + rawDx) | 0;
      rawY = (rawY + rawDy) | 0;
    }
  }

  /**
   * Get map cell value
   * Lua: mget(x, y) -> sprite index
   */
  mget(...args) {
    const x = this._requireNumberArg(args, 0, 'mget', 'x');
    const y = this._requireNumberArg(args, 1, 'mget', 'y');
    return this._mapTile(Math.floor(x), Math.floor(y));
  }

  /**
   * Set map cell value
   * Lua: mset(x, y, v)
   */
  mset(...args) {
    const x = Math.floor(this._requireNumberArg(args, 0, 'mset', 'x'));
    const y = Math.floor(this._requireNumberArg(args, 1, 'mset', 'y'));
    const v = this._optionalIntegerArg(args, 2, 0, 'mset', 'v');

    const map = this._map;
    if (!map) return;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    const offset = y * map.width + x;
    map.tiles[offset] = v & 0xff;
    if (map.width === 128) this._mirrorMapByteToSheet(offset, v);
  }

  /**
   * Get sprite pixel at (x,y)
   * Lua: sget(x, y) -> color
   */
  sget(...args) {
    const x = this._requireNumberArg(args, 0, 'sget', 'x');
    const y = this._requireNumberArg(args, 1, 'sget', 'y');

    return this._sheetPixel(Math.floor(x), Math.floor(y));
  }

  /**
   * Set sprite pixel at (x,y) to color c
   * Lua: sset(x, y, c)
   */
  sset(...args) {
    const x = Math.floor(this._requireNumberArg(args, 0, 'sset', 'x'));
    const y = Math.floor(this._requireNumberArg(args, 1, 'sset', 'y'));
    const c = this._optionalNumberArg(args, 2, this.currentColor, 'sset', 'c');

    const sheet = this._sheet;
    if (!sheet) return;
    if (x < 0 || y < 0 || x >= sheet.width || y >= sheet.height) return;
    sheet.pixels[y * sheet.width + x] = Math.floor(c) & 0x0f;
    this._mirrorSheetPixelToMap(x, y);
  }

  /**
   * Get sprite flag
   * Lua: fget(n) -> byte, fget(n, f) -> boolean
   *
   * The single-flag form returns a BOOLEAN, not 0/1. Lua treats 0 as truthy,
   * so returning a number here makes `if fget(n, 7) then` fire for every
   * sprite.
   */
  fget(...args) {
    const n = this._requireIntegerArg(args, 0, 'fget', 'n');
    const f = this._optionalIntegerArg(args, 1, -1, 'fget', 'f');

    const byte = this._spriteFlagByte(n);
    if (f < 0) {
      return byte;
    }
    if (f > 7) {
      return false;
    }

    return (byte & (1 << f)) !== 0;
  }

  /**
   * Set sprite flag
   * Lua: fset(n, v) sets the whole flag byte, fset(n, f, v) sets one bit
   */
  fset(...args) {
    const n = this._requireIntegerArg(args, 0, 'fset', 'n');
    if (n < 0 || n >= this.spriteFlags.length) return;

    // Two-argument form addresses the byte, not a bit. Getting this wrong
    // turns `fset(n, band(fget(n), 64))` into a write to a random flag.
    if (args.length < 3 || args[2] === undefined || args[2] === null) {
      this.spriteFlags[n] = this._optionalIntegerArg(args, 1, 0, 'fset', 'v') & 0xff;
      return;
    }

    const f = this._requireIntegerArg(args, 1, 'fset', 'f');
    if (f < 0 || f > 7) return;
    // PICO-8 accepts either a boolean or 0/1 here.
    const raw = args[2];
    let v;
    if (typeof raw === 'boolean') {
      v = raw;
    } else if (typeof raw === 'number') {
      v = raw !== 0;
    } else {
      v = this._coerceBooleanArg(raw, 'fset', 'v');
    }

    if (v) {
      this.spriteFlags[n] |= (1 << f);
    } else {
      this.spriteFlags[n] &= ~(1 << f) & 0xff;
    }
  }

  // ---------------------------------------------------------------------------
  // Persistent cart data (cartdata / dget / dset)
  // ---------------------------------------------------------------------------

  /** localStorage key for a cartdata id. */
  static _cartDataStorageKey(id) {
    return `retrostudio.pico8.cartdata.${id}`;
  }

  /**
   * Claim a 64-number persistent save area.
   * Lua: cartdata(id) -> boolean (false if the id was already in use)
   *
   * PICO-8 restricts the id to lowercase alphanumerics and underscore so it can
   * be used as a filename; keep the same rule rather than letting a cart write
   * an arbitrary localStorage key.
   */
  cartdata(...args) {
    const id = String(args[0] ?? '').trim();
    if (!/^[a-z0-9_]{1,64}$/.test(id)) {
      throw new Error(`cartdata() invalid id: ${JSON.stringify(id)}`);
    }

    this._cartDataId = id;
    this._cartData = new Float64Array(64);

    let existed = false;
    try {
      const raw = globalThis.localStorage?.getItem(LuaPico8Extensions._cartDataStorageKey(id));
      if (raw) {
        const values = JSON.parse(raw);
        if (Array.isArray(values)) {
          existed = true;
          for (let i = 0; i < 64 && i < values.length; i += 1) {
            this._cartData[i] = Number(values[i]) || 0;
          }
        }
      }
    } catch (error) {
      console.warn('[Pico8] cartdata() could not read saved data:', error);
    }

    return !existed;
  }

  _persistCartData() {
    if (!this._cartDataId || !this._cartData) return;
    try {
      globalThis.localStorage?.setItem(
        LuaPico8Extensions._cartDataStorageKey(this._cartDataId),
        JSON.stringify(Array.from(this._cartData)),
      );
    } catch (error) {
      console.warn('[Pico8] dset() could not persist cart data:', error);
    }
  }

  /**
   * Read a saved value.
   * Lua: dget(index) -> number
   */
  dget(...args) {
    const index = this._requireIntegerArg(args, 0, 'dget', 'index');
    if (!this._cartData || index < 0 || index > 63) return 0;
    return this._cartData[index];
  }

  /**
   * Write a saved value.
   * Lua: dset(index, value)
   */
  dset(...args) {
    const index = this._requireIntegerArg(args, 0, 'dset', 'index');
    const value = this._optionalNumberArg(args, 1, 0, 'dset', 'value');
    if (!this._cartData) {
      throw new Error('dset() called before cartdata(); the cart has no save area');
    }
    if (index < 0 || index > 63) return;
    this._cartData[index] = value;
    this._persistCartData();
  }

  /**
   * Register a pause-menu entry.
   * Lua: menuitem(index, [label, callback])
   *
   * The entries are recorded so a host pause menu can render them; passing only
   * an index removes the entry, which is how PICO-8 hides items.
   */
  menuitem(...args) {
    const index = this._requireIntegerArg(args, 0, 'menuitem', 'index');
    if (index < 1 || index > 5) return;

    const label = args[1];
    if (label === undefined || label === null || label === '') {
      this.menuItems.delete(index);
      return;
    }

    this.menuItems.set(index, { label: String(label), callback: args[2] ?? null });
  }

  // ---------------------------------------------------------------------------
  // Memory access (peek / poke / memcpy / memset / reload)
  //
  // Only the regions with a backing store in this runtime are mapped:
  //   0x0000-0x1fff sprite sheet (two 4-bit pixels per byte, low nibble first)
  //   0x2000-0x2fff map rows 0-31 (one sprite index per byte)
  //   0x3000-0x30ff sprite flags
  //   0x4300-0x5dff general-purpose RAM (0x5600+ doubles as the custom font)
  //   0x5f00-0x5f7f draw state registers
  //   0x6000-0x7fff the screen, packed like the sprite sheet
  // Everything else reads 0 and ignores writes rather than throwing, because
  // carts poke hardware registers speculatively and a throw would kill them.
  //
  // 0x1000-0x1fff is shared: those bytes are BOTH the bottom half of the
  // sprite sheet (sprites 128-255, pixel rows 64-127) and map rows 32-63. We
  // keep two decoded stores - _sheet holds one pixel per entry and _map holds
  // one tile index per entry - so a write through either view has to be
  // mirrored into the other or they drift apart. Carts rely on this: "UFO
  // Swamp Odyssey" bank-switches its parallax backdrops with
  // memcpy(0x1800, 0x4e00, 2048), which is a write to map rows 48-63, and
  // without the mirror map(...,48,...) kept drawing the tiles that shipped in
  // the cart while the sprite sheet filled up with tile indices.
  //
  // A map cell's offset within _map.tiles is y * 128 + x, and for rows 32-63
  // that is exactly the same number as the PICO-8 address, so the two views
  // share an index in this range and need no further translation.
  // ---------------------------------------------------------------------------

  static SHARED_GFX_MAP_START = 0x1000;

  static SHARED_GFX_MAP_END = 0x2000;

  /** Mirror a byte written through the sprite-sheet view into map rows 32-63. */
  _mirrorSheetByteToMap(addr, value) {
    const map = this._map;
    if (!map || map.width !== 128) return;
    if (addr < LuaPico8Extensions.SHARED_GFX_MAP_START || addr >= LuaPico8Extensions.SHARED_GFX_MAP_END) return;
    if (addr < map.tiles.length) map.tiles[addr] = value & 0xff;
  }

  /** Mirror a byte written through the map view into the sprite sheet. */
  _mirrorMapByteToSheet(offset, value) {
    const sheet = this._sheet;
    if (!sheet) return;
    if (offset < LuaPico8Extensions.SHARED_GFX_MAP_START || offset >= LuaPico8Extensions.SHARED_GFX_MAP_END) return;
    const y = offset >> 6;
    const x = (offset & 0x3f) * 2;
    if (y >= sheet.height || x + 1 >= sheet.width) return;
    const row = y * sheet.width + x;
    sheet.pixels[row] = value & 0x0f;
    sheet.pixels[row + 1] = (value >> 4) & 0x0f;
  }

  /** Mirror a single sprite-sheet pixel change into map rows 32-63. */
  _mirrorSheetPixelToMap(x, y) {
    const sheet = this._sheet;
    if (!sheet) return;
    const addr = (y * (sheet.width >> 1)) + (x >> 1);
    if (addr < LuaPico8Extensions.SHARED_GFX_MAP_START || addr >= LuaPico8Extensions.SHARED_GFX_MAP_END) return;
    const even = x & ~1;
    const row = y * sheet.width + even;
    const byte = (sheet.pixels[row] & 0x0f) | ((sheet.pixels[row + 1] & 0x0f) << 4);
    this._mirrorSheetByteToMap(addr, byte);
  }

  static SCREEN_START = 0x6000;

  static SCREEN_END = 0x8000;

  /**
   * Read one packed screen byte: two pixels of a 128x128 4bpp image, low nibble
   * on the left. Sampled through the logical view so a cart still sees the
   * 128x128 screen it addresses when the framebuffer is running larger.
   */
  _readScreenByte(addr) {
    const offset = addr - LuaPico8Extensions.SCREEN_START;
    const y = offset >> 6;
    const x = (offset & 0x3f) * 2;
    const left = this._framebuffer[
      this._logicalToRenderY(y) * this._fbWidth + this._logicalToRenderX(x)
    ] || 0;
    const right = this._framebuffer[
      this._logicalToRenderY(y) * this._fbWidth + this._logicalToRenderX(x + 1)
    ] || 0;
    return (left & 0x0f) | ((right & 0x0f) << 4);
  }

  /**
   * Write one packed screen byte, bypassing clip, camera and the draw palette -
   * a poke to screen memory is a raw store on hardware, not a draw call.
   */
  _writeScreenByte(addr, value) {
    const offset = addr - LuaPico8Extensions.SCREEN_START;
    const y = offset >> 6;
    const x = (offset & 0x3f) * 2;
    this._setScreenPixel(x, y, value & 0x0f);
    this._setScreenPixel(x + 1, y, (value >> 4) & 0x0f);
  }

  /** Store one logical pixel, filling its whole cell when scaled up. */
  _setScreenPixel(x, y, color) {
    const bounds = this._logicalCellBounds(x, y);
    for (let py = bounds.y0; py <= bounds.y1; py += 1) {
      if (py < 0 || py >= this._fbHeight) continue;
      const row = py * this._fbWidth;
      for (let px = bounds.x0; px <= bounds.x1; px += 1) {
        if (px < 0 || px >= this._fbWidth) continue;
        this._framebuffer[row + px] = color;
      }
    }
  }

  _readByte(addr, useRom = false) {
    const a = addr | 0;
    if (a < 0 || a > 0x7fff) return 0;

    if (a < 0x2000) {
      const sheet = useRom ? this._romSheet : this._sheet;
      if (!sheet) return 0;
      const y = a >> 6;
      const x = (a & 0x3f) * 2;
      if (y >= sheet.height || x + 1 >= sheet.width) return 0;
      const row = y * sheet.width + x;
      return (sheet.pixels[row] & 0x0f) | ((sheet.pixels[row + 1] & 0x0f) << 4);
    }

    if (a < 0x3000) {
      const map = useRom ? this._romMap : this._map;
      if (!map) return 0;
      const offset = a - 0x2000;
      return offset < map.tiles.length ? map.tiles[offset] : 0;
    }

    if (a < 0x3100) {
      const flags = useRom ? this._romSpriteFlags : this.spriteFlags;
      return flags[a - 0x3000] || 0;
    }

    if (a < 0x4300) {
      const ram = useRom ? this._romAudioRam : this._audioRam;
      return ram ? ram[a - 0x3100] : 0;
    }

    if (a >= 0x4300 && a < 0x5e00) {
      // ROM has no user RAM; reload() of this region yields zeroes, as it does
      // on hardware for a cart that never stored anything there.
      if (useRom || !this._userRam) return 0;
      return this._userRam[a - 0x4300];
    }

    if (a >= 0x5f00 && a < 0x5f80) {
      if (useRom) return 0;
      // The palettes live in their own state, not in the scratch register
      // block, so read them back from there or a cart that saves and restores
      // them with memcpy() would get stale bytes.
      if (a < 0x5f10) return this._readDrawPaletteByte(a - 0x5f00);
      if (a < 0x5f20) return this._screenPalette[a - 0x5f10];
      if (!this._drawStateRam) return 0;
      return this._drawStateRam[a - 0x5f00];
    }

    if (a >= LuaPico8Extensions.SCREEN_START) {
      // The cart ROM holds no screen, so reload() of this region is zeroes.
      return useRom ? 0 : this._readScreenByte(a);
    }

    return 0;
  }

  _writeByte(addr, value) {
    const a = addr | 0;
    const v = value & 0xff;
    if (a < 0 || a > 0x7fff) return;

    if (a < 0x2000) {
      const sheet = this._sheet;
      if (!sheet) return;
      const y = a >> 6;
      const x = (a & 0x3f) * 2;
      if (y >= sheet.height || x + 1 >= sheet.width) return;
      const row = y * sheet.width + x;
      sheet.pixels[row] = v & 0x0f;
      sheet.pixels[row + 1] = (v >> 4) & 0x0f;
      this._mirrorSheetByteToMap(a, v);
      return;
    }

    if (a < 0x3000) {
      const map = this._map;
      if (!map) return;
      const offset = a - 0x2000;
      if (offset < map.tiles.length) map.tiles[offset] = v;
      return;
    }

    if (a < 0x3100) {
      this.spriteFlags[a - 0x3000] = v;
      return;
    }

    if (a < 0x4300) {
      if (!this._audioRam) this._audioRam = new Uint8Array(0x4300 - 0x3100);
      this._audioRam[a - 0x3100] = v;
      return;
    }

    if (a >= 0x4300 && a < 0x5e00) {
      if (!this._userRam) this._userRam = new Uint8Array(0x5e00 - 0x4300);
      this._userRam[a - 0x4300] = v;
      return;
    }

    if (a >= 0x5f00 && a < 0x5f80) {
      if (a < 0x5f10) {
        this._writeDrawPaletteByte(a - 0x5f00, v);
        return;
      }
      if (a < 0x5f20) {
        this._setScreenPaletteEntry(a - 0x5f10, v);
        return;
      }
      if (!this._drawStateRam) this._drawStateRam = new Uint8Array(0x80);
      this._drawStateRam[a - 0x5f00] = v;
      return;
    }

    if (a >= LuaPico8Extensions.SCREEN_START) {
      this._writeScreenByte(a, v);
    }
  }

  /**
   * Read one byte.
   * Lua: peek(addr, [n]) -> byte, ...
   */
  peek(...args) {
    const addr = this._requireIntegerArg(args, 0, 'peek', 'addr');
    const n = this._optionalIntegerArg(args, 1, 1, 'peek', 'n');
    if (n <= 1) return this._readByte(addr);

    const values = [];
    for (let i = 0; i < Math.min(n, 8192); i += 1) values.push(this._readByte(addr + i));
    return values;
  }

  /**
   * Write one or more bytes.
   * Lua: poke(addr, [value, ...])
   */
  poke(...args) {
    const addr = this._requireIntegerArg(args, 0, 'poke', 'addr');
    if (args.length < 2) {
      this._writeByte(addr, 0);
      return;
    }
    for (let i = 1; i < args.length; i += 1) {
      this._writeByte(addr + i - 1, Math.floor(Number(args[i]) || 0));
    }
  }

  /** Lua: peek2(addr) -> signed 16-bit little-endian value */
  peek2(...args) {
    const addr = this._requireIntegerArg(args, 0, 'peek2', 'addr');
    const raw = this._readByte(addr) | (this._readByte(addr + 1) << 8);
    return raw >= 0x8000 ? raw - 0x10000 : raw;
  }

  /** Lua: poke2(addr, value) */
  poke2(...args) {
    const addr = this._requireIntegerArg(args, 0, 'poke2', 'addr');
    const value = Math.floor(this._optionalNumberArg(args, 1, 0, 'poke2', 'value'));
    this._writeByte(addr, value);
    this._writeByte(addr + 1, value >> 8);
  }

  /** Lua: peek4(addr) -> 16.16 fixed-point value as a number */
  peek4(...args) {
    const addr = this._requireIntegerArg(args, 0, 'peek4', 'addr');
    let raw = 0;
    for (let i = 3; i >= 0; i -= 1) raw = (raw * 256) + this._readByte(addr + i);
    if (raw >= 0x80000000) raw -= 0x100000000;
    return raw / 65536;
  }

  /** Lua: poke4(addr, value) */
  poke4(...args) {
    const addr = this._requireIntegerArg(args, 0, 'poke4', 'addr');
    const value = this._optionalNumberArg(args, 1, 0, 'poke4', 'value');
    let raw = Math.round(value * 65536);
    if (raw < 0) raw += 0x100000000;
    for (let i = 0; i < 4; i += 1) this._writeByte(addr + i, (raw / (256 ** i)) & 0xff);
  }

  /**
   * Copy a block of memory.
   * Lua: memcpy(dest, src, len)
   *
   * Buffered through a temporary so overlapping ranges behave like memmove;
   * carts scroll sprite rows with overlapping copies.
   */
  memcpy(...args) {
    const dest = this._requireIntegerArg(args, 0, 'memcpy', 'dest');
    const src = this._requireIntegerArg(args, 1, 'memcpy', 'src');
    const len = this._requireIntegerArg(args, 2, 'memcpy', 'len');
    if (len <= 0) return;

    const buffer = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) buffer[i] = this._readByte(src + i);
    for (let i = 0; i < len; i += 1) this._writeByte(dest + i, buffer[i]);
  }

  /**
   * Fill a block of memory.
   * Lua: memset(dest, value, len)
   */
  memset(...args) {
    const dest = this._requireIntegerArg(args, 0, 'memset', 'dest');
    const value = this._requireIntegerArg(args, 1, 'memset', 'value');
    const len = this._requireIntegerArg(args, 2, 'memset', 'len');
    for (let i = 0; i < len; i += 1) this._writeByte(dest + i, value);
  }

  /**
   * Restore a block of memory from cart ROM.
   * Lua: reload(dest, src, len, [filename])
   *
   * With no arguments PICO-8 reloads the whole cart; here that means restoring
   * every ROM-backed region to its imported state.
   *
   * The filename form is how a game bigger than one cart reads the rest of
   * itself. The named cart is not loaded or run - only the bytes are copied,
   * so the caller can pull a level out of a sibling cart's sprite and sound
   * regions without disturbing anything that is currently on screen.
   */
  reload(...args) {
    if (args.length === 0) {
      if (this._romSheet && this._sheet) this._sheet.pixels.set(this._romSheet.pixels);
      if (this._romMap && this._map) this._map.tiles.set(this._romMap.tiles);
      this.spriteFlags.set(this._romSpriteFlags);
      if (this._romAudioRam) {
        if (!this._audioRam) this._audioRam = new Uint8Array(0x4300 - 0x3100);
        this._audioRam.set(this._romAudioRam);
      }
      return;
    }

    const dest = this._requireIntegerArg(args, 0, 'reload', 'dest');
    const src = this._requireIntegerArg(args, 1, 'reload', 'src');
    const len = this._requireIntegerArg(args, 2, 'reload', 'len');
    if (len <= 0) return;

    const buffer = new Uint8Array(len);
    const rom = args.length > 3 && args[3] != null ? this._getCartRom(args[3]) : null;

    if (args.length > 3 && args[3] != null && !rom) {
      this._warnOnce(
        `reload-missing-${this._normalizeCartName(args[3])}`,
        `reload() asked for "${args[3]}", which was not imported with this game. `
        + 'Reading zeroes instead. Import the whole folder or .zip a multi-cart game came in.'
      );
      // Fall through: PICO-8 reads a missing cart as zeroes rather than failing,
      // and a game that streams level data would otherwise die on level one.
      for (let i = 0; i < len; i += 1) this._writeByte(dest + i, 0);
      return;
    }

    // Read the whole source before writing any of it: PICO-8 copies through the
    // cart image, so an overlapping reload() must not see its own output.
    for (let i = 0; i < len; i += 1) {
      const addr = src + i;
      buffer[i] = rom
        ? (addr >= 0 && addr < rom.length ? rom[addr] : 0)
        : this._readByte(addr, true);
    }
    for (let i = 0; i < len; i += 1) this._writeByte(dest + i, buffer[i]);
  }

  /**
   * Make a named cart the one that is running: its graphics, map, sprite flags
   * and sound data become both live memory and the ROM that reload() restores.
   *
   * PICO-8's load() swaps the whole cartridge, not just the code, so a game
   * split across several carts expects the new one's sprites to be in place by
   * the time its _init() runs.
   */
  applyCartImage(name) {
    const rom = this._getCartRom(name);
    if (!rom) return false;

    // The regions have to exist before bytes can land in them: the project may
    // have been built from a cart with no map while the one arriving has one.
    if (!this._sheet) this.setSpriteSheet(new Uint8Array(128 * 128), 128, 128);
    if (!this._map) this.setMapData(new Uint8Array(128 * 64), 128, 64);
    if (!this._audioRam) this._audioRam = new Uint8Array(0x4300 - 0x3100);

    for (let addr = 0; addr < 0x4300; addr += 1) this._writeByte(addr, rom[addr]);

    // Re-snapshot the ROM side, or a later reload() would restore the cart this
    // one just replaced.
    this._romSheet.pixels.set(this._sheet.pixels);
    this._romMap.tiles.set(this._map.tiles);
    this._romSpriteFlags.set(this.spriteFlags);
    this._romAudioRam = new Uint8Array(this._audioRam);
    this._dirty = true;
    return true;
  }

  /**
   * Swap in another cart of the same game.
   * Lua: load(filename, [breadcrumb], [param])
   *
   * PICO-8 never returns from load(): the cart it was called from stops where
   * it stands. That cannot be reproduced here, because this is running inside
   * the Lua VM that is about to be discarded, so the request is queued and the
   * game loop performs the swap between frames. Any statements after the call
   * therefore still run, which is harmless in practice - carts call load() as
   * the last thing they do.
   *
   * The breadcrumb is the label PICO-8 puts on the "back to previous cart" menu
   * entry. It is accepted and ignored: there is no cart shell here to go back
   * to.
   */
  load(...args) {
    const requested = args[0];
    const cart = this._normalizeCartName(requested);
    if (!cart) {
      this._warnOnce('load-no-cart', 'load() was called without a cart name; ignoring it.');
      return;
    }

    const entry = this._cartFamily?.get(cart);
    if (!entry) {
      this._warnOnce(
        `load-missing-${cart}`,
        `load("${requested}") names a cart that was not imported with this game, so it was ignored. `
        + 'Import the whole folder or .zip that a multi-cart game came in.'
      );
      return;
    }

    const isMainCart = cart === this._mainCartName;
    // The main cart's code is the project's own main.lua, which the user may
    // have edited since the import; the archived copy is only for the others.
    const lua = isMainCart ? null : this._getCartScript(cart);
    if (!isMainCart && !lua) {
      this._warnOnce(
        `load-nocode-${cart}`,
        `load("${requested}") names a cart that carries no runnable code, so it was ignored.`
      );
      return;
    }

    const emulator = this.gameEmulator;
    if (!emulator) return;

    emulator.pico8PendingLoad = {
      cart,
      // stat(6) is a string even when the cart passes a number.
      param: args[2] == null ? '' : String(args[2]),
      // null means "restart the project script".
      lua,
    };
  }

  /**
   * Present the current framebuffer.
   * Lua: flip()
   *
   * On hardware flip() also blocks until the next display frame. A cart calls
   * it from inside its own loop, and the browser cannot yield the JS stack, so
   * this pushes the pixels out but does not wait — a cart animating purely
   * through flip() will run faster than it does on PICO-8.
   */
  flip() {
    const gpu = this._gpu;
    if (!gpu || !this._renderEnabled) return;
    this.renderFrame(gpu, 0);
    if (typeof gpu.present === 'function') gpu.present();
  }

  // ---------------------------------------------------------------------------
  // Coroutines
  //
  // These are implemented in Lua (see BaseLuaExtension.registerMethod) because
  // a coroutine cannot yield across a JS call frame. The stubs exist so the
  // extension loader finds a method for each api.json entry.
  // ---------------------------------------------------------------------------

  cocreate() { throw new Error('cocreate() must be provided by the Lua-native implementation'); }

  coresume() { throw new Error('coresume() must be provided by the Lua-native implementation'); }

  costatus() { throw new Error('costatus() must be provided by the Lua-native implementation'); }

  cowrap() { throw new Error('cowrap() must be provided by the Lua-native implementation'); }

  yield() { throw new Error('yield() must be provided by the Lua-native implementation'); }

  /**
   * Set palette mapping
   * Lua: pal([c0, c1, [p]]) / pal(tbl, [p]) / pal([p])
   *
   * p selects which palette to change: 0 (default) is the draw palette, which
   * remaps colours as they are drawn, and 1 is the screen palette, which
   * remaps them on the way to the display and so also recolours pixels that
   * are already in the framebuffer. Carts lean on the screen palette for fades
   * and for reaching the extended colours, so treating p as decoration left
   * whole scenes in the wrong hue.
   *
   * Returns the mapping c0 had before the call, which is how a cart saves a
   * palette it is about to change: "Sonic 2.5" draws its text outline with
   * `o_pal[i] = pal(i, c)` and puts the old colours back with `pal(o_pal)`.
   */
  pal(...args) {
    const isTable = this._isTableArg(args[0]);
    const p = isTable
      ? this._optionalIntegerArg(args, 1, 0, 'pal', 'p')
      : this._optionalIntegerArg(args, 2, 0, 'pal', 'p');

    // pal(tbl) assigns an entry per key. Table keys start at 1, so a plain
    // 16-element array gives colour 0 last: the manual's greyscale example
    // pal({1,1,5,5,5,6,7,13,6,7,7,6,13,6,7,1}, 1) leans on that wrap. Key 0 is
    // read first so that wrap wins when a cart supplies both.
    if (isTable) {
      for (let key = 0; key <= 16; key += 1) {
        const value = this._tableGet(args[0], key);
        if (typeof value !== 'number') continue;
        this._setPaletteEntry(key % 16, value, p);
      }
      return undefined;
    }

    // pal() resets every palette, pal(p) resets just that one.
    if (args.length === 0) {
      this._resetPalette(0);
      this._resetPalette(1);
      return undefined;
    }
    if (args.length === 1) {
      this._resetPalette(this._requireIntegerArg(args, 0, 'pal', 'p'));
      return undefined;
    }

    const c0 = this._requireIntegerArg(args, 0, 'pal', 'c0') & 0x0f;
    const c1 = this._requireIntegerArg(args, 1, 'pal', 'c1');
    const previous = p === 1 ? this._screenPalette[c0] : (this.currentPalette.get(c0) ?? c0);
    this._setPaletteEntry(c0, c1, p);
    return previous;
  }

  _setPaletteEntry(c0, c1, p) {
    if (p === 1) this._setScreenPaletteEntry(c0, c1 & 0xff);
    else this.currentPalette.set(c0, c1);
  }

  /** Restore one palette to its defaults. Palette 0 also clears transparency. */
  _resetPalette(p) {
    if (p === 1) {
      this._resetScreenPalette();
      return;
    }
    this.currentPalette.clear();
    // "PAL() resets all palettes to system defaults (including transparency
    // values)" - so the draw palette reset takes palt() back with it.
    this._transparent = new Set([0]);
  }

  _setScreenPaletteEntry(index, color) {
    if (this._screenPalette[index] === color) return;
    this._screenPalette[index] = color;
    this._paletteRGBADirty = true;
  }

  _resetScreenPalette() {
    for (let i = 0; i < 16; i += 1) {
      if (this._screenPalette[i] !== i) {
        this._screenPalette[i] = i;
        this._paletteRGBADirty = true;
      }
    }
  }

  /**
   * Read back a draw palette register (0x5f00-0x5f0f): the low nibble is the
   * colour this index draws as, and bit 0x10 marks it transparent for spr().
   */
  _readDrawPaletteByte(index) {
    const mapped = this.currentPalette.get(index) ?? index;
    return (mapped & 0x0f) | (this._transparent.has(index) ? 0x10 : 0);
  }

  _writeDrawPaletteByte(index, value) {
    const mapped = value & 0x0f;
    if (mapped === index) this.currentPalette.delete(index);
    else this.currentPalette.set(index, mapped);

    if (value & 0x10) this._transparent.add(index);
    else this._transparent.delete(index);
  }

  _isTransparentColor(c) {
    return this._transparent.has(c & 0x0f);
  }

  /**
   * Set transparent color
   * Lua: palt([c, [t]])
   * With no arguments the default (colour 0 transparent) is restored.
   */
  palt(...args) {
    const c = this._optionalIntegerArg(args, 0, -1, 'palt', 'c');
    const t = this._optionalFlagArg(args, 1, true, 'palt', 't');

    if (c < 0) {
      this._transparent = new Set([0]);
    } else if (t) {
      this._transparent.add(c & 0x0f);
    } else {
      this._transparent.delete(c & 0x0f);
    }

    if (this.gameEmulator?.spriteEngine?.setTransparentColor && c >= 0) {
      this.gameEmulator.spriteEngine.setTransparentColor(c, t);
    }
  }

  /**
   * Set camera position
   * Lua: camera([x, y])
   *
   * Returns the position the camera held before the call, as two values. A
   * cart that shifts the camera for one draw and puts it back relies on that:
   * "Sonic 2.5" opens its text routine with `local o_pal,camx,camy={},camera()`
   * and restores it with `camera(camx,camy)`. The JS bridge turns an array
   * return into Lua multiple returns, so handing back a pair is enough.
   */
  camera(...args) {
    const x = this._optionalNumberArg(args, 0, 0, 'camera', 'x');
    const y = this._optionalNumberArg(args, 1, 0, 'camera', 'y');
    const previous = [this._cameraX, this._cameraY];

    const engine = this._getEngine();
    if (engine?.setCamera) {
      engine.setCamera(Math.floor(x), Math.floor(y));
    }
    return previous;
  }

  /**
   * Set clipping region
   * Lua: clip([x, y, w, h])
   */
  clip(...args) {
    const x = this._optionalNumberArg(args, 0, 0, 'clip', 'x');
    const y = this._optionalNumberArg(args, 1, 0, 'clip', 'y');
    const w = this._optionalNumberArg(args, 2, 128, 'clip', 'w');
    const h = this._optionalNumberArg(args, 3, 128, 'clip', 'h');
    
    const engine = this._getEngine();
    if (engine?.setClip) {
      engine.setClip(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
    }
  }

  /**
   * The built-in PICO-8 font, loaded from pico8-font.js.
   *
   * Resolved lazily rather than in the constructor: the extension loader pulls
   * pico8.js in dynamically, so it is not guaranteed to run after the plain
   * script tag in index.html.
   */
  _getFont() {
    if (!this._font) {
      this._font = (typeof window !== 'undefined' && window.Pico8Font)
        || (typeof globalThis !== 'undefined' && globalThis.Pico8Font)
        || null;
    }
    return this._font;
  }

  _printableText(value) {
    if (value === undefined || value === null) {
      return '[nil]';
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    return String(value);
  }

  /**
   * The cart-supplied font at 0x5600, or null when the cart has not defined
   * one.
   *
   * Layout, per the PICO-8 manual: 8 bytes per character for 256 characters,
   * so character N's rows live at 0x5600 + N*8, one byte per row with the low
   * bit on the left. Characters 0-15 are never drawn, so their 128 bytes are
   * reused to describe the font itself.
   *
   * A cart installs this with a P8SCII raw memory write rather than poke(),
   * e.g. "\^@56000003" followed by three bytes, then "\^!5680" and the glyphs.
   */
  _getCustomFont() {
    const ram = this._userRam;
    if (!ram) {
      return null;
    }

    const at = (addr) => ram[addr - 0x4300] || 0;
    const narrow = at(0x5600);
    const height = at(0x5602);
    // An all-zero header means nothing was ever written there. Falling back to
    // the built-in font is much friendlier than drawing 256 blank characters.
    if (!narrow || !height) {
      return null;
    }

    const wide = at(0x5601) || narrow;
    const flags = at(0x5605);
    const applyAdjustments = (flags & 0x1) !== 0;

    return {
      GLYPH_HEIGHT: height,
      LINE_HEIGHT: height,
      NARROW_ADVANCE: narrow,
      WIDE_ADVANCE: wide,
      offsetX: at(0x5603),
      offsetY: at(0x5604),
      tabWidth: at(0x5606),

      advanceFor(code) {
        let width = code >= 0x80 ? wide : narrow;
        if (applyAdjustments && code >= 16) {
          // 120 bytes from 0x5608 hold one nibble per character for 16..255,
          // low nibble first. Bits 0x7 adjust the width by 0,1,2,3,-4,-3,-2,-1.
          const index = code - 16;
          const byte = at(0x5608 + (index >> 1));
          const nibble = (index & 1) ? (byte >> 4) : (byte & 0x0f);
          const delta = (nibble & 0x7);
          width += delta >= 4 ? delta - 8 : delta;
        }
        return Math.max(0, width);
      },

      /** Bit 0x8 of a character's nibble lifts it one pixel, for accents. */
      liftFor(code) {
        if (!applyAdjustments || code < 16) return 0;
        const index = code - 16;
        const byte = at(0x5608 + (index >> 1));
        const nibble = (index & 1) ? (byte >> 4) : (byte & 0x0f);
        return (nibble & 0x8) ? -1 : 0;
      },

      rowsFor(code) {
        const base = 0x5600 + (code & 0xff) * 8;
        const rows = new Uint8Array(8);
        let any = 0;
        for (let i = 0; i < 8; i += 1) {
          rows[i] = at(base + i);
          any |= rows[i];
        }
        return any ? rows : null;
      },
    };
  }

  /**
   * Read one P8SCII parameter character.
   *
   * Parameters use a superset of hexadecimal: '0'..'9' and 'a'..'f' mean 0..15
   * as usual, but the sequence keeps going, so 'g' is 16, 'h' is 17 and so on.
   * That matters for the cursor-shift codes, whose arguments are biased by 16
   * and so routinely land past 'f'.
   */
  static _p8sciiParam(text, index) {
    if (index >= text.length) {
      return 0;
    }
    const c = text.charCodeAt(index);
    if (c >= 48 && c <= 57) return c - 48;          // '0'-'9'
    if (c >= 97) return c - 97 + 10;                // 'a' onwards, unbounded
    if (c >= 65 && c <= 90) return c - 65 + 10;     // 'A'-'Z', same values
    return 0;
  }

  /** Read a fixed-length hex field, used by the raw memory write commands. */
  static _p8sciiHex(text, index, length) {
    return parseInt(text.slice(index, index + length), 16) || 0;
  }

  /**
   * Rasterise `text` into the framebuffer one glyph pixel at a time.
   *
   * Goes through _plot() rather than writing _framebuffer directly so text
   * picks up camera(), clip() and the pal() remap exactly like every other
   * draw call, and so it composites in draw order.
   *
   * Handles the P8SCII control codes (manual appendix A), which carts use for
   * far more than newlines: colour changes, cursor nudges, character repeats,
   * and installing a custom font by poking 0x5600 mid-string. A control code's
   * arguments are ordinary characters, so dropping the code but drawing its
   * arguments - which is what a naive renderer does - puts visible garbage on
   * screen.
   *
   * Returns the pen position after the last character: `right` is the x the
   * next glyph would occupy (what PICO-8's print() returns), `bottom` is the y
   * of the final line, and `color` is the foreground colour left behind, which
   * PICO-8 keeps as a side effect of printing.
   */
  _drawText(text, x, y, color) {
    const builtin = this._getFont();
    if (!builtin) {
      return { right: x, bottom: y, color };
    }

    // 0x5f58 supplies the starting attributes, but only when its low bit says
    // the rest of the register is meaningful.
    const defaults = this._readByte(0x5f58);
    const observeDefaults = (defaults & 0x1) !== 0;

    const state = {
      color,
      bgColor: 0,
      solidBackground: observeDefaults && (defaults & 0x10) !== 0,
      useCustomFont: observeDefaults && (defaults & 0x80) !== 0,
      wide: observeDefaults && (defaults & 0x4) !== 0,
      tall: observeDefaults && (defaults & 0x8) !== 0,
    };

    let penX = x;
    let penY = y;
    let homeX = x;
    let homeY = y;
    let right = x;

    const fontFor = () => (state.useCustomFont && this._getCustomFont()) || builtin;

    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);

      if (code >= 32) {
        penX = this._drawGlyph(fontFor(), code, penX, penY, state);
        if (penX > right) right = penX;
        continue;
      }

      // --- control codes -------------------------------------------------
      switch (code) {
        case 0: // "\0" terminate printing
          return { right, bottom: penY, color: state.color };

        case 1: { // "\*" repeat the next character P0 times
          const count = LuaPico8Extensions._p8sciiParam(text, i + 1);
          const repeated = text.charCodeAt(i + 2);
          i += 2;
          if (!Number.isNaN(repeated)) {
            for (let n = 0; n < count; n += 1) {
              penX = this._drawGlyph(fontFor(), repeated, penX, penY, state);
            }
            if (penX > right) right = penX;
          }
          break;
        }

        case 2: // "\#" solid background in colour P0
          state.bgColor = LuaPico8Extensions._p8sciiParam(text, i + 1);
          state.solidBackground = true;
          i += 1;
          break;

        case 3: // "\-" shift the cursor horizontally by P0-16
          penX += LuaPico8Extensions._p8sciiParam(text, i + 1) - 16;
          i += 1;
          break;

        case 4: // "\|" shift the cursor vertically by P0-16
          penY += LuaPico8Extensions._p8sciiParam(text, i + 1) - 16;
          i += 1;
          break;

        case 5: // "\+" shift the cursor by P0-16, P1-16
          penX += LuaPico8Extensions._p8sciiParam(text, i + 1) - 16;
          penY += LuaPico8Extensions._p8sciiParam(text, i + 2) - 16;
          i += 2;
          break;

        case 6: { // "\^" special command
          const consumed = this._p8sciiCommand(text, i + 1, state, {
            penX, penY, homeX, homeY, originX: x,
          });
          i += consumed.length;
          penX = consumed.penX;
          penY = consumed.penY;
          homeX = consumed.homeX;
          homeY = consumed.homeY;
          break;
        }

        case 8: // "\b" backspace
          penX -= fontFor().advanceFor(32);
          break;

        case 9: { // "\t" tab
          const font = fontFor();
          const stop = font.tabWidth || font.NARROW_ADVANCE * 4;
          penX = x + (Math.floor((penX - x) / stop) + 1) * stop;
          if (penX > right) right = penX;
          break;
        }

        case 10: // "\n" newline
          penY += fontFor().LINE_HEIGHT;
          penX = x;
          break;

        case 11: // "\v" decorate the previous character at an offset
          i += 1;
          break;

        case 12: // "\f" set the foreground colour
          state.color = LuaPico8Extensions._p8sciiParam(text, i + 1) & 0x0f;
          i += 1;
          break;

        case 13: // "\r" carriage return
          penX = x;
          break;

        case 14: // switch to the font at 0x5600
          state.useCustomFont = true;
          break;

        case 15: // switch back to the built-in font
          state.useCustomFont = false;
          break;

        default:
          // "\a" (7) takes a variable-length note string with no terminator we
          // can infer, so it is dropped rather than guessed at.
          break;
      }
    }

    return { right, bottom: penY, color: state.color };
  }

  /**
   * Draw one character and return the pen x after it.
   *
   * Split out of _drawText because "\*" needs to draw the same character
   * repeatedly, and because the background fill has to happen per character
   * rather than once for the whole string.
   */
  _drawGlyph(font, code, penX, penY, state) {
    const advance = font.advanceFor(code);
    const height = font.LINE_HEIGHT;
    const scaleX = state.wide ? 2 : 1;
    const scaleY = state.tall ? 2 : 1;
    const offsetX = font.offsetX || 0;
    const offsetY = (font.offsetY || 0) + (font.liftFor ? font.liftFor(code) : 0);

    if (state.solidBackground) {
      for (let by = 0; by < height * scaleY; by += 1) {
        for (let bx = 0; bx < advance * scaleX; bx += 1) {
          this._plot(penX + bx, penY + by, state.bgColor);
        }
      }
    }

    const rows = font.rowsFor(code);
    if (rows) {
      for (let ry = 0; ry < rows.length; ry += 1) {
        const bits = rows[ry];
        if (!bits) continue;
        for (let rx = 0; rx < 8; rx += 1) {
          if (!(bits & (1 << rx))) continue;
          const px = penX + (rx + offsetX) * scaleX;
          const py = penY + (ry + offsetY) * scaleY;
          for (let sy = 0; sy < scaleY; sy += 1) {
            for (let sx = 0; sx < scaleX; sx += 1) {
              this._plot(px + sx, py + sy, state.color);
            }
          }
        }
      }
    }

    return penX + advance * scaleX;
  }

  /**
   * Handle one "\^" special command starting at `index`, returning how many
   * characters it consumed alongside any cursor movement it caused.
   *
   * The raw memory writes ("@" and "!") are the reason this exists: a cart
   * installs its custom font by embedding the glyph data in a printed string,
   * so a renderer that only draws text will never see the font at all.
   */
  _p8sciiCommand(text, index, state, cursor) {
    const result = { ...cursor, length: 1 };
    const command = text[index];

    switch (command) {
      case '@': { // "@addrnnnn[data]" poke nnnn bytes to address addr
        const addr = LuaPico8Extensions._p8sciiHex(text, index + 1, 4);
        const count = LuaPico8Extensions._p8sciiHex(text, index + 5, 4);
        const start = index + 9;
        for (let n = 0; n < count; n += 1) {
          this._writeByte(addr + n, text.charCodeAt(start + n) & 0xff);
        }
        result.length = 9 + count;
        break;
      }

      case '!': { // "!addr[data]" poke every remaining character to addr
        const addr = LuaPico8Extensions._p8sciiHex(text, index + 1, 4);
        const start = index + 5;
        for (let n = start; n < text.length; n += 1) {
          this._writeByte(addr + (n - start), text.charCodeAt(n) & 0xff);
        }
        result.length = text.length - index;
        break;
      }

      case 'c': // clear the screen to colour P0 and home the cursor
        this._clearFb(LuaPico8Extensions._p8sciiParam(text, index + 1) & 0x0f, false);
        result.penX = 0;
        result.penY = 0;
        result.length = 2;
        break;

      case 'g': // move the cursor to home
        result.penX = result.homeX;
        result.penY = result.homeY;
        break;

      case 'h': // set home to the cursor
        result.homeX = cursor.penX;
        result.homeY = cursor.penY;
        break;

      case 'j': // jump to absolute P0*4, P1*4 in screen pixels
        result.penX = LuaPico8Extensions._p8sciiParam(text, index + 1) * 4;
        result.penY = LuaPico8Extensions._p8sciiParam(text, index + 2) * 4;
        result.length = 3;
        break;

      case 'w': state.wide = true; break;
      case 't': state.tall = true; break;
      case 'p': state.wide = true; state.tall = true; break;
      case '#': state.solidBackground = true; break;

      case '-': { // "-x" disables the mode that "x" enables
        const mode = text[index + 1];
        if (mode === 'w') state.wide = false;
        else if (mode === 't') state.tall = false;
        else if (mode === 'p') { state.wide = false; state.tall = false; }
        else if (mode === '#') state.solidBackground = false;
        result.length = 2;
        break;
      }

      // Commands whose arguments must be stepped over so they are not drawn as
      // text, but whose effects are not reproduced here.
      case 'd': // per-character print delay
      case 'r': // right-hand wrap boundary
      case 's': // tab stop width
      case 'x': // character width override
      case 'y': // character height override
        result.length = 2;
        break;

      case 'o': // outline: colour then a two-digit neighbour bitfield
        result.length = 4;
        break;

      case '.': // one-off character, 8 bytes of raw binary
      case ',':
        result.length = 9;
        break;

      case ':': // one-off character, 16 hex digits
      case ';':
        result.length = 17;
        break;

      default:
        // "1".."9" skip frames, and anything unrecognised takes no argument.
        break;
    }

    return result;
  }

  /**
   * Move the text cursor used by coordinate-less print()
   * Lua: cursor([x, y, [col]]) -> prevX, prevY
   */
  cursor(...args) {
    const prevX = this._cursorX;
    const prevY = this._cursorY;
    this._cursorX = Math.floor(this._optionalNumberArg(args, 0, 0, 'cursor', 'x'));
    this._cursorY = Math.floor(this._optionalNumberArg(args, 1, 0, 'cursor', 'y'));

    const col = this._optionalNumberArg(args, 2, undefined, 'cursor', 'col');
    if (col !== undefined) {
      this.currentColor = Math.floor(col) & 0xFF;
    }
    return [prevX, prevY];
  }

  /**
   * Print text at position
   * Lua: print(text, [x, y], [color]) -> x position after the last character
   *
   * With no x/y the text goes at the cursor and the cursor drops a line,
   * scrolling the screen once it reaches the bottom. `color` is sticky: PICO-8
   * uses it to set the pen for subsequent draws too.
   */
  print(...args) {
    const text = args.length === 0 ? '' : this._printableText(args[0]);
    const x = this._optionalNumberArg(args, 1, undefined, 'print', 'x');
    const y = this._optionalNumberArg(args, 2, undefined, 'print', 'y');
    const col = this._optionalNumberArg(args, 3, undefined, 'print', 'color');

    if (col !== undefined) {
      this.currentColor = Math.floor(col) & 0xFF;
    }

    const font = (((this._readByte(0x5f58) & 0x81) === 0x81) && this._getCustomFont())
      || this._getFont();
    const lineHeight = font ? font.LINE_HEIGHT : 6;
    const useCursor = x === undefined || y === undefined;

    let penX = useCursor ? this._cursorX : Math.floor(x);
    let penY = useCursor ? this._cursorY : Math.floor(y);

    if (useCursor) {
      // Printing past the bottom scrolls rather than drawing offscreen.
      const maxY = this._logicalHeight - lineHeight;
      while (penY > maxY) {
        this._scrollFb(lineHeight);
        penY -= lineHeight;
      }
    }

    const { right, bottom, color } = this._drawText(text, penX, penY, this.currentColor);

    // A "\f" inside the string outlives the print() that contained it: the
    // manual lists cursor position and foreground colour as the only draw
    // state print() is allowed to leave behind.
    this.currentColor = color;
    this._cursorX = penX;
    this._cursorY = bottom + lineHeight;
    return right;
  }

  // ============================================================
  // Math Functions (Pico-8 Style)
  // ============================================================

  /**
   * Sine, over a full turn of 0..1 rather than radians.
   *
   * PICO-8's sine is INVERTED. The manual lists it under "Quirks of PICO-8" -
   * "COS() and SIN() take 0..1 instead of 0..PI*2, and SIN() is inverted" - and
   * documents `SIN(0.25)` as -1, because screen space has y running down while
   * mathematical diagrams have it running up. The snippet the manual gives for
   * getting conventional trig back is `RETURN -P8SIN(ANGLE/(3.1415*2))`, so the
   * negation belongs here. Without it every cart that steers by sin() moves the
   * wrong way vertically: galaxis.p8 fired its bullets backwards.
   *
   * COS() is not inverted.
   *
   * Lua: sin(x) -> result
   */
  sin(...args) {
    const x = this._requireNumberArg(args, 0, 'sin', 'x');
    const value = -Math.sin(x * 2 * Math.PI);
    // Negating rounds 0 to -0, which 16.16 fixed point has no bit pattern for
    // and which tostr() would happily print back to the cart author.
    return value === 0 ? 0 : value;
  }

  /**
   * Cosine function (takes 0.0-1.0, not radians)
   * Lua: cos(x) -> result
   */
  cos(...args) {
    const x = this._requireNumberArg(args, 0, 'cos', 'x');
    // Pico-8 cos takes 0.0-1.0 where 1.0 = 2π
    return Math.cos(x * 2 * Math.PI);
  }

  /**
   * Angle of the vector (dx, dy), as a full turn of 0..1.
   *
   * Three things here are not the standard library's atan2. The arguments are
   * (dx, dy), not (y, x); the angle runs anticlockwise in screen space, which
   * means dy is negated to undo the same y inversion sin() applies; and the
   * result is wrapped into 0..1 rather than allowed to go negative. The manual
   * pins it down with `ATAN(0,-1)` returning 0.25 - straight up is a quarter
   * turn.
   *
   * Lua: atan2(dx, dy) -> result
   */
  atan2(...args) {
    const dx = this._requireNumberArg(args, 0, 'atan2', 'dx');
    const dy = this._requireNumberArg(args, 1, 'atan2', 'dy');
    const turns = Math.atan2(-dy, dx) / (2 * Math.PI);
    // -0.5..0.5 comes back from atan2; a negative turn is the same direction.
    // Negating dy also means dy 0 arrives as -0, so normalise that too.
    if (turns < 0) return turns + 1;
    return turns === 0 ? 0 : turns;
  }

  /**
   * Square root
   * Lua: sqrt(x) -> result
   */
  sqrt(...args) {
    const x = this._requireNumberArg(args, 0, 'sqrt', 'x');
    return Math.sqrt(x);
  }

  /**
   * Absolute value
   * Lua: abs(x) -> result
   */
  abs(...args) {
    const x = this._requireNumberArg(args, 0, 'abs', 'x');
    return Math.abs(x);
  }

  /**
   * Sign function (-1, 0, or 1)
   * Lua: sgn(x) -> result
   */
  sgn(...args) {
    const x = this._requireNumberArg(args, 0, 'sgn', 'x');
    return x > 0 ? 1 : (x < 0 ? -1 : 0);
  }

  /**
   * Floor function
   * Lua: flr(x) -> result
   */
  flr(...args) {
    const x = this._requireNumberArg(args, 0, 'flr', 'x');
    return Math.floor(x);
  }

  /**
   * Ceiling function
   * Lua: ceil(x) -> result
   */
  ceil(...args) {
    const x = this._requireNumberArg(args, 0, 'ceil', 'x');
    return Math.ceil(x);
  }

  /**
   * Minimum of two values
   * Lua: min(a, b) -> result
   */
  min(...args) {
    const a = this._requireNumberArg(args, 0, 'min', 'a');
    const b = this._requireNumberArg(args, 1, 'min', 'b');
    return Math.min(a, b);
  }

  /**
   * Maximum of two values
   * Lua: max(a, b) -> result
   */
  max(...args) {
    const a = this._requireNumberArg(args, 0, 'max', 'a');
    const b = this._requireNumberArg(args, 1, 'max', 'b');
    return Math.max(a, b);
  }

  /**
   * Median/Clamp of three values
   * Lua: mid(a, b, c) -> result (returns middle value)
   */
  mid(...args) {
    const a = this._requireNumberArg(args, 0, 'mid', 'a');
    const b = this._requireNumberArg(args, 1, 'mid', 'b');
    const c = this._requireNumberArg(args, 2, 'mid', 'c');
    const minValue = Math.min(a, b, c);
    const maxValue = Math.max(a, b, c);
    return a + b + c - minValue - maxValue;
  }

  /**
   * Random number (0 to x)
   * Lua: rnd([x]) -> result
   *
   * Handed a table, PICO-8 picks one of its elements instead of returning a
   * number, which carts lean on for things like rnd(spawn_points). An empty
   * table gives nil, matching an out of range index in Lua.
   */
  rnd(...args) {
    const t = args[0];
    if (this._isTableLike(t)) {
      const values = Array.isArray(t)
        ? t
        : this._getNumericKeys(t).map((key) => t[key]);
      if (values.length === 0) return undefined;
      return values[Math.floor(Math.random() * values.length)];
    }

    const x = this._optionalNumberArg(args, 0, 1.0, 'rnd', 'x');
    return Math.random() * x;
  }

  /**
   * Seed random
   * Lua: srand(x)
   */
  srand(...args) {
    const x = this._requireIntegerArg(args, 0, 'srand', 'x');
    this.randomSeed = x;
    // Note: JavaScript Math.random() can't be truly seeded, this is a placeholder
  }

  // ============================================================
  // Bitwise Operations
  // ============================================================

  /**
   * PICO-8 has no integers: every number is a signed 16.16 fixed point value,
   * and the bitwise operators work on that 32-bit pattern rather than on a
   * whole number. Truncating to an integer first threw the fractional half
   * away, which turned `sin(a) >> 3` - the idiomatic "divide by 8, but faster"
   * - into a flat 0 for every angle. "Sonic 2.5" builds its sprite rotation
   * out of `sin(a)>>3` and `cos(a)>>3`, so its tline walk never advanced and
   * the player came out as one solid block of colour.
   *
   * Whole numbers are unaffected: their low 16 bits are zero, so and/or/xor
   * and shifts by whole amounts give the same answer either way.
   */
  _toFixed(value) {
    // | 0 wraps at 32 bits, which is what PICO-8 does on overflow.
    return Math.floor(value * 0x10000) | 0;
  }

  _fromFixed(fixed) {
    return fixed / 0x10000;
  }

  /**
   * Bitwise AND
   * Lua: band(a, b) -> result
   */
  band(...args) {
    const a = this._requireNumberArg(args, 0, 'band', 'a');
    const b = this._requireNumberArg(args, 1, 'band', 'b');
    return this._fromFixed(this._toFixed(a) & this._toFixed(b));
  }

  /**
   * Bitwise OR
   * Lua: bor(a, b) -> result
   */
  bor(...args) {
    const a = this._requireNumberArg(args, 0, 'bor', 'a');
    const b = this._requireNumberArg(args, 1, 'bor', 'b');
    return this._fromFixed(this._toFixed(a) | this._toFixed(b));
  }

  /**
   * Bitwise XOR
   * Lua: bxor(a, b) -> result
   */
  bxor(...args) {
    const a = this._requireNumberArg(args, 0, 'bxor', 'a');
    const b = this._requireNumberArg(args, 1, 'bxor', 'b');
    return this._fromFixed(this._toFixed(a) ^ this._toFixed(b));
  }

  /**
   * Bitwise NOT
   * Lua: bnot(x) -> result
   */
  bnot(...args) {
    const x = this._requireNumberArg(args, 0, 'bnot', 'x');
    return this._fromFixed(~this._toFixed(x));
  }

  /**
   * Shift left
   * Lua: shl(x, n) -> result
   */
  shl(...args) {
    const x = this._requireNumberArg(args, 0, 'shl', 'x');
    const n = this._requireIntegerArg(args, 1, 'shl', 'n');
    return this._fromFixed(this._toFixed(x) << n);
  }

  /**
   * Shift right (arithmetic)
   * Lua: shr(x, n) -> result
   */
  shr(...args) {
    const x = this._requireNumberArg(args, 0, 'shr', 'x');
    const n = this._requireIntegerArg(args, 1, 'shr', 'n');
    return this._fromFixed(this._toFixed(x) >> n);
  }

  /**
   * Logical shift left
   * Lua: lshl(x, n) -> result
   */
  lshl(...args) {
    const x = this._requireNumberArg(args, 0, 'lshl', 'x');
    const n = this._requireIntegerArg(args, 1, 'lshl', 'n');
    return this._fromFixed(this._toFixed(x) << n);
  }

  /**
   * Logical shift right
   * Lua: lshr(x, n) -> result
   */
  lshr(...args) {
    const x = this._requireNumberArg(args, 0, 'lshr', 'x');
    const n = this._requireIntegerArg(args, 1, 'lshr', 'n');
    return this._fromFixed(this._toFixed(x) >>> n);
  }

  /**
   * Rotate left
   * Lua: rotl(x, n) -> result
   */
  rotl(...args) {
    const x = this._toFixed(this._requireNumberArg(args, 0, 'rotl', 'x'));
    const n = this._requireIntegerArg(args, 1, 'rotl', 'n') & 31;
    if (n === 0) return this._fromFixed(x);
    return this._fromFixed(((x << n) | (x >>> (32 - n))) | 0);
  }

  /**
   * Rotate right
   * Lua: rotr(x, n) -> result
   */
  rotr(...args) {
    const x = this._toFixed(this._requireNumberArg(args, 0, 'rotr', 'x'));
    const n = this._requireIntegerArg(args, 1, 'rotr', 'n') & 31;
    if (n === 0) return this._fromFixed(x);
    return this._fromFixed(((x >>> n) | (x << (32 - n))) | 0);
  }

  // ============================================================
  // String Functions
  // ============================================================

  /**
   * Substring function
   * Lua: sub(s, i, [j]) -> result
   *
   * Implemented in Lua at runtime (see base-lua-extension.js) so that a long
   * string is not copied across the JS bridge on every call. This copy is what
   * the tests exercise, so the two have to agree: PICO-8's indices are Lua's,
   * which means a negative i or j counts back from the end of the string and
   * an empty range yields "".
   */
  sub(...args) {
    const s = args[0]?.toString() ?? '';
    const i = this._optionalIntegerArg(args, 1, 1, 'sub', 'i');
    const j = this._optionalIntegerArg(args, 2, s.length, 'sub', 'j');

    const start = i < 0 ? Math.max(s.length + i + 1, 1) : Math.max(i, 1);
    const end = j < 0 ? s.length + j + 1 : Math.min(j, s.length);
    if (start > end) return '';

    // Lua indices are 1-based; String.slice is 0-based and half-open.
    return s.slice(start - 1, end);
  }

  /**
   * Convert value to string
   * Lua: tostr(x, [show_decimal]) -> result
   */
  tostr(...args) {
    const x = args[0];
    const showDecimal = this._optionalIntegerArg(args, 1, 1, 'tostr', 'show_decimal');
    
    if (typeof x === 'number') {
      if (showDecimal && x % 1 !== 0) {
        return x.toString();
      }
      return Math.floor(x).toString();
    }
    return x?.toString() ?? '';
  }

  /**
   * Convert string to number
   * Lua: tonum(s) -> result
   *
   * PICO-8 accepts the same 0x and 0b literals here that the Lua lexer does,
   * including a fractional part such as "0x1.8". Number.parseFloat stops at
   * the "x" and quietly returns 0, so carts that unpack packed data this way
   * got a table of zeroes instead: "UFO Swamp Odyssey" builds its parallax
   * background tile table with tonum("0x"..digit) and every tile came out as
   * sprite 0, leaving the backdrop empty.
   */
  tonum(...args) {
    const raw = args[0];
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;

    const s = (raw?.toString() ?? '').trim();
    const prefixed = /^([-+]?)0([xb])(.*)$/is.exec(s);
    if (prefixed) {
      const radix = prefixed[2].toLowerCase() === 'x' ? 16 : 2;
      const digits = radix === 16 ? /^[0-9a-f]*$/i : /^[01]*$/;
      const [intPart, fracPart = '', ...rest] = prefixed[3].split('.');
      if (rest.length || (!intPart && !fracPart)) return 0;
      if (!digits.test(intPart) || !digits.test(fracPart)) return 0;

      let value = intPart ? Number.parseInt(intPart, radix) : 0;
      for (let i = 0; i < fracPart.length; i += 1) {
        value += Number.parseInt(fracPart[i], radix) / radix ** (i + 1);
      }
      if (!Number.isFinite(value)) return 0;
      return prefixed[1] === '-' ? -value : value;
    }

    const value = Number.parseFloat(s);
    return Number.isFinite(value) ? value : 0;
  }

  /**
   * Build a string from character ordinals
   * Lua: chr(val, [val2, ...]) -> string
   */
  chr(...args) {
    let out = '';
    for (let i = 0; i < args.length; i += 1) {
      const code = this._requireIntegerArg(args, i, 'chr', `val${i + 1}`);
      // PICO-8 strings are byte strings, so keep every code in 0..255 rather
      // than letting String.fromCharCode mint a multi-byte character.
      out += String.fromCharCode(code & 0xff);
    }
    return out;
  }

  /**
   * Read character ordinals out of a string
   * Lua: ord(str, [index], [num_results]) -> number, ...
   *
   * Note the third argument is a COUNT, not an end index as in Lua's
   * string.byte(s, i, j): ord("abc", 2, 2) yields 98, 99.
   *
   * Implemented in Lua at runtime for the same reason as sub(); this copy is
   * what the tests exercise.
   */
  ord(...args) {
    const s = args[0]?.toString() ?? '';
    const index = this._optionalIntegerArg(args, 1, 1, 'ord', 'index');
    const requested = this._optionalIntegerArg(args, 2, 1, 'ord', 'num_results');

    const start = index - 1; // Lua indices are 1-based.
    if (!Number.isFinite(start) || start < 0 || start >= s.length || requested < 1) {
      // Out of range reads are nil in PICO-8, not an error. Return undefined
      // rather than null: null crosses the bridge as js.null userdata, which
      // Lua would treat as a truthy value.
      return undefined;
    }

    // Stop at the end of the string rather than padding with nil.
    const count = Math.min(requested, s.length - start);
    const codes = [];
    for (let i = 0; i < count; i += 1) {
      codes.push(s.charCodeAt(start + i));
    }

    // A bare ord() is single-valued; the bridge only expands arrays into Lua
    // multiple returns, so hand back a plain number unless more were asked for.
    return args.length >= 3 ? codes : codes[0];
  }

  /**
   * Split a string into a table of elements
   * Lua: split(str, [separator], [convert_numbers]) -> table
   *
   * Implemented in Lua at runtime (see base-lua-extension.js) because the
   * result is a table and a table cannot cross the JS bridge. This copy keeps
   * the loader's API surface honest and is what the tests exercise.
   */
  split(...args) {
    const s = args[0] === undefined || args[0] === null ? '' : String(args[0]);
    const separator = args[1] === undefined || args[1] === null ? ',' : args[1];
    const convert = args[2] === undefined || args[2] === null ? true : Boolean(args[2]);

    const asElement = (text) => {
      if (!convert) return text;
      // Only a fully numeric element converts; "1a" stays a string.
      const trimmed = text.trim();
      if (trimmed === '') return text;
      const value = Number(trimmed);
      return Number.isNaN(value) ? text : value;
    };

    // An empty delimiter means the same as a size of 1: carts pack lookup
    // tables into a string of glyphs and unpack them with split(s, ""), so
    // returning nothing there loses the whole table.
    const size = separator === '' ? 1 : separator;
    if (typeof size === 'number') {
      const step = Math.floor(size);
      if (step < 1) return [];
      const out = [];
      for (let i = 0; i < s.length; i += step) {
        out.push(asElement(s.substr(i, step)));
      }
      return out;
    }

    return s.split(String(size)).map(asElement);
  }

  /**
   * Pack arguments into a table
   * Lua: pack(...) -> table
   *
   * Lua-native at runtime, like split(); see base-lua-extension.js.
   */
  pack(...args) {
    // Mirrors table.pack: the count is carried in n so a trailing nil counts.
    const packed = { n: args.length };
    for (let i = 0; i < args.length; i += 1) {
      packed[i + 1] = args[i];
    }
    return packed;
  }

  /**
   * Unpack a table into separate values
   * Lua: unpack(t, [i], [j]) -> value, ...
   *
   * Lua-native at runtime, like split(); see base-lua-extension.js.
   */
  unpack(...args) {
    const t = args[0];
    if (!this._isTableLike(t)) return [];
    const length = this._tableLength(t);
    const from = this._optionalIntegerArg(args, 1, 1, 'unpack', 'i');
    const to = this._optionalIntegerArg(args, 2, length, 'unpack', 'j');

    const values = [];
    for (let i = from; i <= to; i += 1) {
      values.push(Array.isArray(t) ? t[i - 1] : t[i]);
    }
    return values;
  }

  _isTableLike(value) {
    return Array.isArray(value) || (value !== null && typeof value === 'object');
  }

  /**
   * A Lua table handed to a bridged builtin does not arrive as a JS object.
   * lua.vm.js wraps it in a Lua.Proxy, which is a *function* carrying the
   * registry ref plus get/set accessors, so `typeof tbl === 'object'` is false
   * and indexing it with tbl[k] quietly yields undefined. Anything that can
   * receive a table across the bridge has to test for the proxy as well.
   */
  _isLuaTableRef(value) {
    return typeof value === 'function' && typeof value.get === 'function' && typeof value.ref === 'number';
  }

  _isTableArg(value) {
    return this._isLuaTableRef(value) || this._isTableLike(value);
  }

  /** Read one entry from a JS array, a plain object or a Lua table proxy. */
  _tableGet(tableValue, key) {
    if (this._isLuaTableRef(tableValue)) return tableValue.get(key);
    if (Array.isArray(tableValue)) return tableValue[key - 1];
    return tableValue[key];
  }

  _getNumericKeys(tableValue) {
    return Object.keys(tableValue)
      .map((key) => Number.parseInt(key, 10))
      .filter((key) => Number.isInteger(key) && key >= 1)
      .sort((a, b) => a - b);
  }

  _tableLength(tableValue) {
    if (Array.isArray(tableValue)) {
      return tableValue.length;
    }
    const keys = this._getNumericKeys(tableValue);
    return keys.length > 0 ? keys[keys.length - 1] : 0;
  }

  // ============================================================
  // Table Functions (Pico-8 style)
  // ============================================================

  /**
   * Add value to table
   * Lua: add(t, v, [i])
   */
  add(...args) {
    const t = args[0];
    const v = args[1];
    const i = args.length > 2 ? this._optionalIntegerArg(args, 2, undefined, 'add', 'i') : undefined;

    if (!this._isTableLike(t)) {
      throw new Error('[Pico8] add() requires first argument to be a table');
    }

    if (Array.isArray(t) && i === undefined) {
      t.push(v);
      return v;
    }

    if (Array.isArray(t)) {
      const insertAt = Math.max(0, i - 1); // Lua indices are 1-based
      t.splice(insertAt, 0, v);
      return v;
    }

    const tableLength = this._tableLength(t);
    const insertAt = i === undefined ? tableLength + 1 : Math.max(1, i);
    if (insertAt <= tableLength) {
      for (let idx = tableLength; idx >= insertAt; idx -= 1) {
        t[idx + 1] = t[idx];
      }
    }
    t[insertAt] = v;

    return v;
  }

  /**
   * Delete value from table
   * Lua: del(t, v)
   */
  del(...args) {
    const t = args[0];
    const v = args[1];

    if (!this._isTableLike(t)) {
      throw new Error('[Pico8] del() requires first argument to be a table');
    }

    if (Array.isArray(t)) {
      const index = t.indexOf(v);
      if (index === -1) {
        return undefined;
      }

      t.splice(index, 1);
      return v;
    }

    const keys = this._getNumericKeys(t);
    const matchKey = keys.find((key) => t[key] === v);
    if (matchKey === undefined) {
      return undefined;
    }

    const tableLength = this._tableLength(t);
    for (let idx = matchKey; idx < tableLength; idx += 1) {
      t[idx] = t[idx + 1];
    }
    delete t[tableLength];

    return v;
  }

  /**
   * Delete the element at an index
   * Lua: deli(t, [i]) -> value
   *
   * Lua-native at runtime, like split(); see base-lua-extension.js.
   */
  deli(...args) {
    const t = args[0];

    if (!this._isTableLike(t)) {
      throw new Error('[Pico8] deli() requires first argument to be a table');
    }

    const length = this._tableLength(t);
    // Defaults to the last element, like table.remove.
    const index = this._optionalIntegerArg(args, 1, length, 'deli', 'i');
    // Out of range is nil in PICO-8, not an error.
    if (index < 1 || index > length) {
      return undefined;
    }

    if (Array.isArray(t)) {
      return t.splice(index - 1, 1)[0];
    }

    const value = t[index];
    for (let idx = index; idx < length; idx += 1) {
      t[idx] = t[idx + 1];
    }
    delete t[length];
    return value;
  }

  /**
   * Count table elements
   * Lua: count(t) -> result
   */
  count(...args) {
    const t = args[0];

    if (!this._isTableLike(t)) {
      return 0;
    }

    if (Array.isArray(t)) {
      return t.length;
    }

    return this._getNumericKeys(t).length;
  }

  /**
   * Iterate all table elements
   * Lua: all(t) -> iterator
   */
  all(...args) {
    const t = args[0];

    if (!this._isTableLike(t)) {
      throw new Error('[Pico8] all() requires first argument to be a table');
    }

    const values = Array.isArray(t)
      ? t
      : this._getNumericKeys(t).map((key) => t[key]);

    let index = 0;
    return () => {
      if (index >= values.length) {
        return undefined;
      }
      const value = values[index];
      index += 1;
      return value;
    };
  }

  /**
   * Stateless sequence iterator
   * Lua: inext(t, [i]) -> i+1, t[i+1]
   *
   * Lua-native at runtime, like split(); see base-lua-extension.js. PICO-8
   * exposes ipairs' underlying iterator as a global, and carts use it directly
   * as `for i,v in inext,t do`. Stock Lua does not, so without this the loop
   * fails with "attempt to call a nil value".
   */
  inext(...args) {
    const t = args[0];
    if (!this._isTableLike(t)) return undefined;

    // The generic for passes nil as the initial control value.
    const i = this._optionalIntegerArg(args, 1, 0, 'inext', 'i') + 1;
    const value = Array.isArray(t) ? t[i - 1] : t[i];
    if (value === undefined || value === null) return undefined;

    // A JS array becomes multiple returns across the bridge, which is what the
    // two-value contract of an iterator needs.
    return [i, value];
  }

  /**
   * Apply function to all table elements
   * Lua: foreach(t, f)
   */
  foreach(...args) {
    const t = args[0];
    const f = args[1];

    if (!this._isTableLike(t)) {
      throw new Error('[Pico8] foreach() requires first argument to be a table');
    }

    if (typeof f !== 'function') {
      throw new Error('[Pico8] foreach() requires a callback function');
    }

    const values = Array.isArray(t)
      ? t
      : this._getNumericKeys(t).map((key) => t[key]);

    for (const item of values) {
      f(item);
    }
  }

  // ============================================================
  // Audio Functions
  // ============================================================

  /**
   * Play music track
   * Lua: music(n, [fade, mask])
   */
  music(...args) {
    // PICO-8 reads a missing or nil track number as 0 rather than refusing the
    // call, and carts lean on it. dinky_kong's intro runs
    // music(split"5,23,-1,22"[stg]) with stg 0, so the index is out of range
    // and the argument arrives nil - and song 0, the intro theme, is reachable
    // by no other call in the cart. Erroring here stopped the whole update.
    const n = this._optionalIntegerArg(args, 0, 0, 'music', 'n');
    const fade = this._optionalIntegerArg(args, 1, 0, 'music', 'fade');
    const mask = this._optionalIntegerArg(args, 2, 0xFF, 'music', 'mask');
    
    if (this.gameEmulator?.audioEngine?.playMusic) {
      this.gameEmulator.audioEngine.playMusic(n, fade, mask);
    }
  }

  /**
   * Play sound effect
   * Lua: sfx(n, [channel, offset, length])
   */
  sfx(...args) {
    const n = this._requireIntegerArg(args, 0, 'sfx', 'n');
    const channel = this._optionalIntegerArg(args, 1, -1, 'sfx', 'channel');
    const offset = this._optionalIntegerArg(args, 2, 0, 'sfx', 'offset');
    const length = this._optionalIntegerArg(args, 3, 32, 'sfx', 'length');
    
    if (this.gameEmulator?.audioEngine?.playSfx) {
      this.gameEmulator.audioEngine.playSfx(n, channel, offset, length);
    }
  }

  // ============================================================
  // Input Functions
  // ============================================================

  /**
   * Shared body for btn/btnp.
   * @param {Array} args - positional Lua args: (i, p), both optional
   * @param {string} methodName - for argument error messages
   * @param {(mask: number) => boolean} read - reads one button off the input manager
   */
  _readButtons(args, methodName, read) {
    const input = this.gameEmulator?.inputManager;
    if (!input) return false;

    // Only one physical controller is wired up, so PICO-8 players 1-7 read as unpressed.
    const player = this._optionalIntegerArg(args, 1, 0, methodName, 'p');
    if (player !== 0) return false;

    const raw = args?.[0];
    if (raw === undefined || raw === null || raw === '') {
      // No index: PICO-8 returns a bitfield in button order rather than a boolean.
      let bits = 0;
      for (let i = 0; i < PICO8_BUTTON_MASKS.length; i++) {
        if (read(input, PICO8_BUTTON_MASKS[i])) bits |= (1 << i);
      }
      return bits;
    }

    const index = this._requireIntegerArg(args, 0, methodName, 'i');
    const mask = PICO8_BUTTON_MASKS[index];
    if (mask === undefined) return false;
    return read(input, mask);
  }

  /**
   * Is button i held this frame?
   * Lua: btn([i], [p]) -> boolean, or bitfield when i is omitted
   */
  btn(...args) {
    return this._readButtons(args, 'btn', (input, mask) => input.isKeyHeld(mask));
  }

  /**
   * Was button i pressed this frame?
   * Lua: btnp([i], [p]) -> boolean, or bitfield when i is omitted
   */
  btnp(...args) {
    return this._readButtons(args, 'btnp', (input, mask) => input.isKeyPressed(mask));
  }

  // ============================================================
  // Utility Functions
  // ============================================================

  /**
   * Print to console (debug)
   * Lua: printh(text, [filename, overwrite, precision])
   */
  printh(...args) {
    const text = args[0]?.toString() ?? '';
    console.log(`[Pico8] ${text}`);
  }

  /**
   * Seconds the cart has been running
   * Lua: time() -> seconds
   */
  time() {
    // PICO-8 derives time() from the frame counter rather than a wall clock, so
    // it stays in step with the simulation when frames run late. Studio's game
    // loop already maintains that counter and zeroes it in startGameLoop(), so
    // read it instead of starting a second clock in here.
    const frames = this.gameEmulator?.frameCount || 0;
    return frames / 60;
  }

  /**
   * Short alias for time()
   * Lua: t() -> seconds
   */
  t() {
    return this.time();
  }

  /**
   * Get statistics
   * Lua: stat(x) -> result
   */
  stat(...args) {
    const x = this._requireIntegerArg(args, 0, 'stat', 'x');
    
    // Common stat indices:
    // 0: clock ticks
    // 1: number of cartridges loaded
    // 4: current fps
    // 5: current memory usage
    
    switch (x) {
      case 0:
        return Date.now();
      case 4:
        return 60; // Default pico-8 target fps
      case 5:
        return (performance.memory?.usedJSHeapSize || 0) / 1024 / 1024; // MB
      case 6:
        // The string the previous cart passed to load(). This is the only
        // channel a multi-cart game has for telling the cart it just started
        // what to do - which episode and difficulty, say - because everything
        // else is wiped by the swap.
        return this._loadParam || '';
      default:
        return 0;
    }
  }
}

// PICO-8 lets a string be indexed like an array of characters: s[3] is the
// third one. Plain Lua points the string metatable's __index straight at the
// string library, so a numeric key reads as nil and the cart then compares a
// number with nil a line or two later.
//
// Kept as a constant rather than inlined so the test can run this exact source
// through a real Lua VM - a syntax error in an embedded Lua string is
// otherwise invisible until a cart runs.
LuaPico8Extensions.STRING_INDEX_LUA = `
  do
    local meta = getmetatable("")
    -- Captured before the swap so installing twice cannot chain the wrappers.
    local library = string
    meta.__index = function(s, key)
      if type(key) ~= "number" then
        return library[key]
      end
      -- PICO-8 numbers are fixed point, so an index can arrive fractional.
      -- Floor it rather than let string.sub raise "no integer representation".
      key = key - key % 1
      -- Negative indices count back from the end, matching sub().
      local c = string.sub(s, key, key)
      -- Out of range reads nil, the way indexing past a table's end does.
      if c == "" then
        return nil
      end
      return c
    end
  end
`;

// PICO-8 numbers are signed 16.16 fixed point, so every one of them carries 32
// significant bits. A float32 lua_Number only has a 24-bit mantissa, so it
// cannot hold one: a cart that keeps flags in the low bits of a number - an
// everyday PICO-8 idiom, because in fixed point those bits are simply part of
// the number - loses them. lua_Integer is a true int32 under LUA_32BITS, so
// carts lowered by Pico8Parser carry each number as the raw fixed-point word in
// a Lua integer instead, and these are the operations that cannot be written as
// a plain Lua operator on that representation.
//
// Kept as a constant, like STRING_INDEX_LUA above, so a test can run this exact
// source through a real Lua VM.
LuaPico8Extensions.FIXED_POINT_LUA = `
  do
    -- Unsigned >=, for values whose top bit is a magnitude bit rather than a
    -- sign. Flipping both sign bits turns the unsigned order into the signed
    -- order the VM already implements.
    local function uge(x, y)
      return (x ~ 0x80000000) >= (y ~ 0x80000000)
    end

    -- 16.16 multiply. The exact product of two 32-bit words needs 64 bits and
    -- lua_Integer only has 32, so build it from 16-bit halves: with
    -- a = ah*2^16 + al, the product's bits 16..47 - which are exactly the
    -- result - are ah*bh*2^16 + ah*bl + al*bh + (al*bl)>>16.
    --
    -- al*bl overflows on its own, but it wraps to the true low 32 bits and
    -- Lua's >> is logical, so shifting recovers that term's real bits 16..31.
    -- Every other term is taken mod 2^32, which is precisely PICO-8's wrap.
    function __p8mul(a, b)
      local ah, al = a // 0x10000, a & 0xFFFF
      local bh, bl = b // 0x10000, b & 0xFFFF
      return (ah * bh << 16) + ah * bl + al * bh + ((al * bl) >> 16)
    end

    -- 16.16 divide, again without a 64-bit intermediate. The whole part comes
    -- straight from integer division; the sixteen fraction bits are then
    -- produced one at a time by restoring division on the remainder.
    --
    -- Shifting the remainder can push its top bit out of the word. That bit is
    -- not lost information: a remainder at or above 2^31 always exceeds the
    -- divisor, so the carry alone decides the quotient bit.
    function __p8div(a, b)
      -- PICO-8 has no infinity; division by zero saturates to the end of the
      -- range, keeping the sign of the numerator.
      if b == 0 then
        if a < 0 then return 0x80000000 end
        return 0x7FFFFFFF
      end

      local negative = false
      if a < 0 then a = -a; negative = not negative end
      if b < 0 then b = -b; negative = not negative end

      -- The whole part seeds the quotient and the loop below shifts it up the
      -- remaining sixteen places as it appends each fraction bit.
      local q = a // b
      local r = a % b

      for _ = 1, 16 do
        local carry = (r >> 31) & 1
        r = r << 1
        q = q << 1
        if carry == 1 or uge(r, b) then
          r = r - b
          q = q | 1
        end
      end

      if negative then return -q end
      return q
    end

    -- Truncating division: PICO-8's \\ is flr(a/b).
    function __p8idiv(a, b)
      local q = __p8div(a, b)
      return q - q % 0x10000
    end

    function __p8mod(a, b)
      if b == 0 then return 0 end
      return a - __p8mul(__p8idiv(a, b), b)
    end

    -- Only a whole exponent is exact in fixed point, and that one is worth
    -- doing properly because carts square things. Anything else goes through
    -- the VM's float, which is as much precision as PICO-8 offers here anyway.
    function __p8pow(a, b)
      if b % 0x10000 == 0 then
        local n = b // 0x10000
        local negative = n < 0
        if negative then n = -n end
        local result, base = 0x10000, a
        while n > 0 do
          if n & 1 == 1 then result = __p8mul(result, base) end
          base = __p8mul(base, base)
          n = n >> 1
        end
        if negative then return __p8div(0x10000, result) end
        return result
      end
      local r = (a / 0x10000) ^ (b / 0x10000) * 0x10000
      if r ~= r then return 0 end
      if r >= 2147483647.0 then return 0x7FFFFFFF end
      if r <= -2147483648.0 then return 0x80000000 end
      return (r // 1) | 0
    end

    -- A shift count is a number like any other, so it arrives as a fixed point
    -- word and its whole part is the real count. PICO-8 shifts a count past the
    -- word width out to nothing rather than wrapping it the way C does, and a
    -- negative count shifts the other way.
    function __p8shl(a, b)
      local n = b // 0x10000
      if n < 0 then return __p8shr(a, -n * 0x10000) end
      if n > 31 then return 0 end
      return a << n
    end

    -- PICO-8's >> keeps the sign. Lua's is logical, so floor-divide by the
    -- power of two instead, which for an integer is an arithmetic shift.
    function __p8shr(a, b)
      local n = b // 0x10000
      if n < 0 then return __p8shl(a, -n * 0x10000) end
      if n > 31 then
        if a < 0 then return -1 end
        return 0
      end
      return a // (1 << n)
    end

    -- >>> is the logical one, which is what Lua's operator already does.
    function __p8lshr(a, b)
      local n = b // 0x10000
      if n < 0 then return __p8shl(a, -n * 0x10000) end
      if n > 31 then return 0 end
      return a >> n
    end

    -- A rotate of zero would ask for a shift of 32, which Lua answers with 0
    -- rather than a no-op, so the halves are ored back together.
    function __p8rotl(a, b)
      local n = (b // 0x10000) & 31
      return (a << n) | (a >> (32 - n))
    end

    function __p8rotr(a, b)
      local n = (b // 0x10000) & 31
      return (a >> n) | (a << (32 - n))
    end

    -- PICO-8 shows four decimal places, which is all 1/65536 needs.
    function __p8tostr(v)
      if type(v) ~= "number" then return tostring(v) end
      -- Negating the most negative word cannot work, so spell it out.
      if v == 0x80000000 then return "-32768" end
      local sign = ""
      if v < 0 then sign = "-"; v = -v end
      local whole = v // 0x10000
      local frac = v % 0x10000
      if frac == 0 then return sign .. tostring(whole) end
      -- frac is under 2^16, so this stays inside the word.
      local digits = tostring(frac * 10000 // 0x10000)
      digits = string.rep("0", 4 - #digits) .. digits
      digits = (digits:gsub("0+$", ""))
      return sign .. tostring(whole) .. "." .. digits
    end

    function __p8cat(a, b)
      return __p8tostr(a) .. __p8tostr(b)
    end

    -- A table subscript stays an ordinary Lua key rather than a raw word, so
    -- that Lua's own sequences keep working and #t, add(), all() and unpack()
    -- behave. A whole number becomes an integer key; anything else becomes the
    -- float it represents, which cannot collide with an integer key.
    function __p8key(v)
      if type(v) ~= "number" then return v end
      if v % 0x10000 == 0 then return v // 0x10000 end
      return v / 0x10000
    end

    -- # counts entries, so it hands back a plain integer that has to be scaled
    -- up into a word before the cart can do arithmetic on it.
    function __p8len(t)
      return #t << 16
    end
  end
`;

// Whether PICO-8 carts are lowered onto raw 16.16 words rather than float32
// lua_Numbers. This is the runtime half of the representation; the compile half
// is FIXED_POINT in pico8-parser.js, which bakes it into the stored Lua when a
// cart is imported. THE TWO MUST BE FLIPPED TOGETHER - a cart lowered one way
// and read back the other puts every coordinate out by a factor of 65536.
LuaPico8Extensions.FIXED_POINT = false;

// Register the extension with the Lua system
if (typeof window !== 'undefined') {
  window.LuaPico8Extensions = LuaPico8Extensions;
}