// pico8-import-service.js
// Convert PICO-8 text carts (.p8) into RetroStudio source packages (.rws).
//
// The converter only ever emits SOURCE files (.png/.texture/.frameset/.sprite/
// .tilemap/.sfx/.p8mus/.lua). Built artefacts (.d2/.d2s/.d2f/.d2fs/.d2m) are the
// build system's job, so the cart is packaged as an .rws and handed to the
// normal RwpService import path rather than being written straight into the
// Project Explorer.

// Mirrors the text/binary split in ProjectExplorer.addFileToProject so the
// manifest's `binary` flag round-trips identically on import.
const PICO8_DRAFT_TEXT_EXTENSIONS = [
  '.lua', '.txt', '.pal', '.sfx', '.p8mus', '.sprite',
  '.json', '.package', '.font', '.texture', '.frameset', '.tilemap', '.tmj',
];

/**
 * In-memory stand-in for ProjectExplorer used while converting a cart. It
 * implements just enough of the explorer surface (`addFileToProject` and
 * `getPreferredManagedFolderForExtension`) that every `importXxx` method can
 * write to a package instead of to live project storage.
 */
class Pico8ProjectDraft {
  constructor(projectName, sourcesRootUi) {
    this.projectName = projectName;
    this.sourcesRootUi = sourcesRootUi;
    /** @type {Map<string, {storagePath: string, bytes: Uint8Array, binary: boolean}>} */
    this.files = new Map();
  }

  getPreferredManagedFolderForExtension(projectName, extension) {
    const subfolder = window.ProjectPaths?.resolveFolderForExtension?.(extension);
    return `${projectName}/${subfolder || `${this.sourcesRootUi}/Binary`}`;
  }

  async addFileToProject(file, folderPath) {
    const uiPath = `${folderPath}/${file.name}`;
    const storagePath = window.ProjectPaths?.normalizeStoragePath
      ? window.ProjectPaths.normalizeStoragePath(uiPath)
      : uiPath;
    const dot = file.name.lastIndexOf('.');
    const extension = dot >= 0 ? file.name.substring(dot).toLowerCase() : '';

    this.files.set(storagePath, {
      storagePath,
      bytes: new Uint8Array(await file.arrayBuffer()),
      binary: !PICO8_DRAFT_TEXT_EXTENSIONS.includes(extension),
    });
  }
}

class Pico8ImportService {
  constructor(services) {
    this.services = services;
    this.projectExplorer = null;
  }

  getSourcesRootUi() {
    return (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi)
      ? window.ProjectPaths.getSourcesRootUi()
      : 'Sources';
  }

  ensureDeps() {
    try {
      if (!this.projectExplorer) {
        if (this.services?.has?.('projectExplorer')) {
          this.projectExplorer = this.services.get('projectExplorer');
        } else if (window.gameEmulator?.projectExplorer) {
          this.projectExplorer = window.gameEmulator.projectExplorer;
        } else if (window.projectExplorer) {
          this.projectExplorer = window.projectExplorer;
        }
      }
    } catch (_) {
      // best effort
    }
  }

  sanitizeProjectName(rawName) {
    const base = String(rawName || 'ImportedPico8')
      .replace(/\.zip$/i, '')
      .replace(/\.p8(\.png)?$/i, '')
      .trim();

    const cleaned = base
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');

    return cleaned || 'ImportedPico8';
  }

  allocateProjectName(explorer, preferredName) {
    let candidate = preferredName;
    let suffix = 2;
    while (explorer.projectData?.structure?.[candidate]) {
      candidate = `${preferredName}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  parseP8Text(text) {
    const normalized = String(text || '').replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n');

    const sections = {
      lua: [],
      gfx: [],
      map: [],
      sfx: [],
      music: [],
      gff: [],
      label: [],
      meta: [],
    };

    let activeSection = 'meta';
    const sectionRegex = /^__([a-z0-9_]+)__\s*$/i;

    for (const line of lines) {
      const match = line.match(sectionRegex);
      if (match) {
        const sectionName = match[1].toLowerCase();
        activeSection = Object.prototype.hasOwnProperty.call(sections, sectionName)
          ? sectionName
          : 'meta';
        continue;
      }
      sections[activeSection].push(line);
    }

    return {
      raw: normalized,
      lua: sections.lua.join('\n').trim(),
      sections,
    };
  }

  clampInt(value, min, max) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  /**
   * Normalise the __gff__ section into 256 bytes of sprite flags as a hex
   * string (two chars per sprite, sprite 0 first).
   *
   * PICO-8 writes two lines of 128 hex chars each; anything shorter is padded
   * with zeroes so sprite indices never shift.
   */
  parseP8GffSection(lines) {
    const source = Array.isArray(lines) ? lines.join('') : String(lines || '');
    const hex = source.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 512);
    if (!hex) return '';
    return hex.padEnd(512, '0');
  }

  /**
   * Parse the __sfx__ section of a .p8 cart.
   * Each line is one SFX slot: 8 header hex chars (mode, speed, loopStart, loopEnd)
   * followed by 32 steps of 5 hex chars each (PPWVE = pitch, waveform, volume, effect).
   */
  parseP8SfxSection(lines) {
    const source = Array.isArray(lines) ? lines : String(lines || '').split('\n');
    const slots = [];

    source.forEach((rawLine, index) => {
      const clean = String(rawLine || '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');
      if (clean.length < 8) return;

      const steps = [];
      for (let i = 0; i < 32; i += 1) {
        const offset = 8 + (i * 5);
        const token = clean.slice(offset, offset + 5).padEnd(5, '0');
        // The waveform nibble is 0-f: the low 3 bits pick one of the eight
        // built-in instruments and bit 3 means "use SFX 0-7 as a custom
        // instrument" instead. Clamping to 0-7 would turn instrument 8 into
        // the phaser rather than the triangle it is based on.
        const instrument = Number.parseInt(token.slice(2, 3), 16) || 0;
        steps.push({
          pitch: this.clampInt(Number.parseInt(token.slice(0, 2), 16) || 0, 0, 63),
          waveform: instrument & 0x07,
          custom: instrument >= 8,
          volume: this.clampInt(Number.parseInt(token.slice(3, 4), 16) || 0, 0, 7),
          effect: this.clampInt(Number.parseInt(token.slice(4, 5), 16) || 0, 0, 7),
        });
      }

      slots.push({
        index,
        mode: Number.parseInt(clean.slice(0, 2), 16) || 0,
        speed: Number.parseInt(clean.slice(2, 4), 16) || 0,
        loopStart: Number.parseInt(clean.slice(4, 6), 16) || 0,
        loopEnd: Number.parseInt(clean.slice(6, 8), 16) || 0,
        steps,
      });
    });

    return slots;
  }

  /**
   * Convert one parsed PICO-8 SFX slot into RetroStudio `.sfx` JSON.
   * Returns null for slots that contain no audible steps.
   */
  picoSlotToSfxJson(slot) {
    const steps = Array.isArray(slot?.steps) ? slot.steps : [];
    if (steps.length === 0) return null;

    let lastAudible = -1;
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      if (steps[i].volume > 0) {
        lastAudible = i;
        break;
      }
    }
    if (lastAudible < 0) return null;

    // PICO-8 overloads the loop pair three ways: 0/0 means no loop, end > start
    // is a real loop with an exclusive end, and a start with a zero end means
    // "play this many notes" (shown as LEN in the SFX editor). RetroStudio
    // treats the pair as an inclusive playback range, so translate all three.
    const hasLoop = slot.loopEnd > slot.loopStart;
    const hasLength = !hasLoop && slot.loopStart > 0;
    const loopStart = hasLoop ? this.clampInt(slot.loopStart, 0, 31) : 0;
    let loopEnd;
    if (hasLoop) {
      loopEnd = this.clampInt(slot.loopEnd - 1, loopStart, 31);
    } else if (hasLength) {
      loopEnd = this.clampInt(slot.loopStart - 1, 0, 31);
    } else {
      loopEnd = lastAudible;
    }

    return {
      type: 'pico_sfx',
      version: '1.0',
      pico: {
        speed: this.clampInt(slot.speed || 8, 1, 255),
        loopStart,
        loopEnd,
        // Only a real loop repeats forever. LEN and plain no-loop slots play
        // their range once, so the flag has to survive alongside the range.
        loop: hasLoop,
        steps,
      },
    };
  }

  /**
   * Parse the __music__ section of a .p8 cart.
   * Each line is one pattern: 2 hex chars of flags followed by 4 channel bytes.
   * Flag bits are 0x01 loop start, 0x02 loop end, 0x04 stop.
   * A channel byte with 0x40 set means that channel is silent for the pattern.
   */
  parseP8MusicSection(lines) {
    const source = Array.isArray(lines) ? lines : String(lines || '').split('\n');
    const patterns = [];

    for (const rawLine of source) {
      const clean = String(rawLine || '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');
      if (clean.length < 10) continue;

      const flags = Number.parseInt(clean.slice(0, 2), 16) || 0;
      const channels = [];
      for (let c = 0; c < 4; c += 1) {
        const byte = Number.parseInt(clean.slice(2 + (c * 2), 4 + (c * 2)), 16);
        const value = Number.isFinite(byte) ? byte : 0x40;
        channels.push((value & 0x40) ? -1 : (value & 0x3f));
      }

      patterns.push({
        index: patterns.length,
        flags,
        loopStart: Boolean(flags & 0x01),
        loopEnd: Boolean(flags & 0x02),
        stop: Boolean(flags & 0x04),
        channels,
      });
    }

    return patterns;
  }

  /**
   * Group the flat pattern table into songs. PICO-8 `music(n)` starts at pattern n
   * and runs until a stop or loop-end flag, so each group is one playable song.
   */
  buildPicoSongs(patterns) {
    const list = Array.isArray(patterns) ? patterns : [];
    const songs = [];
    let start = null;
    let loopTo = null;

    for (const pattern of list) {
      const silent = pattern.channels.every((slot) => slot < 0);
      if (start === null) {
        if (silent && !pattern.stop && !pattern.loopEnd) continue;
        start = pattern.index;
        loopTo = null;
      }
      if (pattern.loopStart) loopTo = pattern.index;
      if (pattern.stop || pattern.loopEnd) {
        songs.push({
          start,
          end: pattern.index,
          loopTo: pattern.loopEnd ? (loopTo === null ? start : loopTo) : null,
        });
        start = null;
        loopTo = null;
      }
    }

    if (start !== null) {
      songs.push({ start, end: list[list.length - 1].index, loopTo });
    }

    return songs;
  }

  /**
   * Build a self-contained RetroStudio `.p8mus` song from a song range.
   * The referenced SFX slots are embedded so the song plays without resolving
   * sibling `.sfx` resources at runtime.
   */
  picoSongToMusicJson(song, patterns, sfxSlots, meta = {}) {
    const songPatterns = patterns.filter((p) => p.index >= song.start && p.index <= song.end);
    if (songPatterns.length === 0) return null;

    const usedSlots = new Set();
    for (const pattern of songPatterns) {
      for (const slot of pattern.channels) {
        if (slot >= 0) usedSlots.add(slot);
      }
    }
    if (usedSlots.size === 0) return null;

    const sfx = {};
    for (const slotIndex of Array.from(usedSlots).sort((a, b) => a - b)) {
      const slot = (sfxSlots || []).find((s) => s.index === slotIndex);
      if (!slot) continue;
      sfx[slotIndex] = {
        speed: this.clampInt(slot.speed || 8, 1, 255),
        loopStart: this.clampInt(slot.loopStart, 0, 31),
        // PICO-8 loop ends are exclusive, so a full-slot loop stores 32.
        loopEnd: this.clampInt(slot.loopEnd, 0, 32),
        steps: slot.steps,
      };
    }

    return {
      type: 'pico_music',
      version: '1.0',
      name: meta.name || `music_${String(song.start).padStart(2, '0')}`,
      sourceFile: meta.sourceFile || null,
      song: {
        start: song.start,
        end: song.end,
        loopTo: song.loopTo,
        patterns: songPatterns.map((p) => ({
          index: p.index,
          flags: p.flags,
          loopStart: p.loopStart,
          loopEnd: p.loopEnd,
          stop: p.stop,
          channels: p.channels,
        })),
      },
      sfx,
    };
  }

  // ============================================================
  // Graphics (__gfx__) and map (__map__) conversion
  // ============================================================

  /**
   * Write every cart the archive held into the project, so that reload() and
   * load() have something to name.
   *
   * A PICO-8 game too big for one cart ships as a folder of them. One holds the
   * code, most are pure data - level geometry poured across the gfx, map and
   * sound regions - and a few carry code of their own for separate chapters.
   * The importer only turns the cart the user picked into a project, so without
   * this the siblings are dropped and every reload() naming one reads zeroes.
   *
   * The carts are written out as the .p8 text they arrived as, under
   * Import/pico8/carts, and the runtime parses them when the game starts. They
   * are not converted to a packed image here: a cart is a plain text file that
   * any tool - or the watch firmware - can read, whereas a decoded image would
   * have to be carried in some container of our own invention.
   *
   * The one edit made is flattening #include: a cart whose code pulls in a
   * sibling .lua would otherwise be unrunnable on its own, and the .lua files
   * cannot be shipped alongside it because the project's Lua build compiles
   * every .lua it finds and raw PICO-8 source does not compile.
   *
   * The main cart is written out too, under its own name. Carts refer to each
   * other by filename, and a game that load()s back to its title screen names
   * the cart the project was made from. Its copy is byte-identical to
   * cart-original.p8, which is how the runtime tells which cart that is without
   * a manifest to consult - and knowing that matters, because a load() of the
   * main cart has to re-run the project's own main.lua rather than the archived
   * copy, or the user's edits would be silently thrown away.
   *
   * @returns {Promise<{count: number, warnings: string[]}>}
   */
  async writeCartFamily(draft, importFolder, bundle, archivedCart) {
    const warnings = [];
    const seen = new Set();
    const folder = `${importFolder}/carts`;

    const write = async (cartPath, text) => {
      const name = String(cartPath || '').split('/').pop().toLowerCase();
      if (!name || seen.has(name)) return;
      seen.add(name);
      await this.addTextFile(draft, folder, name, text);
    };

    await write(bundle.cartName, archivedCart);

    for (const entry of bundle.sources?.byPath?.values() || []) {
      if (!this.isCartName(entry.path)) continue;

      const parsed = this.parseP8Text(entry.text);
      let text = parsed.raw;

      if (/^\s*#include\b/im.test(parsed.lua)) {
        // A failure here is not fatal: the cart's data is still worth keeping,
        // and only a load() of this particular cart would notice.
        try {
          const slash = entry.path.lastIndexOf('/');
          const includes = this.resolveIncludes(parsed.lua, bundle.sources, {
            baseDir: slash >= 0 ? entry.path.slice(0, slash) : '',
          });
          if (includes.problems.length > 0) {
            throw new Error(this.describeIncludeProblems(entry.path, includes.problems));
          }
          text = this.flattenCartText(parsed.raw, includes.lua);
        } catch (error) {
          warnings.push(
            `${entry.path} includes source that could not be resolved, so load("${entry.path.split('/').pop()}") `
            + `will fail. Its data is still available to reload(). ${error.message}`
          );
        }
      }

      await write(entry.path, text);
    }

    return { count: seen.size, warnings };
  }

  /**
   * Decode __gfx__ into the 128x128 sprite sheet. Each character is one pixel
   * as a PICO-8 palette index (0-15).
   */
  parseP8GfxSection(lines) {
    const source = Array.isArray(lines) ? lines : String(lines || '').split('\n');
    const width = 128;
    const height = 128;
    const pixels = new Uint8Array(width * height);
    let rowsSeen = 0;
    let wrote = false;

    for (const rawLine of source) {
      const row = String(rawLine || '').trim().toLowerCase();
      if (!row) continue;
      if (rowsSeen >= height) break;

      for (let x = 0; x < Math.min(width, row.length); x += 1) {
        const n = Number.parseInt(row[x], 16);
        if (Number.isFinite(n)) {
          pixels[rowsSeen * width + x] = n & 0x0f;
          wrote = true;
        }
      }
      rowsSeen += 1;
    }

    return wrote ? { width, height, pixels, rows: rowsSeen } : null;
  }

  /**
   * Decode __map__ into tile indices. The text section only ever carries the
   * 32 rows of dedicated map memory; rows 32-63 live in the shared region.
   */
  parseP8MapSection(lines) {
    const source = Array.isArray(lines) ? lines : String(lines || '').split('\n');
    const width = 128;
    const rows = [];

    for (const rawLine of source) {
      const line = String(rawLine || '').trim().toLowerCase();
      if (line) rows.push(line);
    }
    if (rows.length === 0) return null;

    const height = rows.length;
    const tiles = new Uint8Array(width * height);
    let wrote = false;

    for (let y = 0; y < height; y += 1) {
      const row = rows[y];
      for (let x = 0; x < width; x += 1) {
        const i = x * 2;
        if (i + 1 >= row.length) break;
        const byte = Number.parseInt(row.slice(i, i + 2), 16);
        if (Number.isFinite(byte)) {
          tiles[y * width + x] = byte & 0xff;
          wrote = true;
        }
      }
    }

    return wrote ? { width, height, tiles } : null;
  }

  /**
   * PICO-8 map rows 32-63 share memory with sprites 128-255 (gfx rows 64-127).
   * Reinterpret that region as tile bytes: two 4-bit pixels per byte, low nibble
   * first.
   */
  extractSharedMapRows(gfx) {
    if (!gfx || gfx.rows < 128) return null;

    const width = 128;
    const height = 32;
    const tiles = new Uint8Array(width * height);
    let nonZero = 0;

    for (let index = 0; index < tiles.length; index += 1) {
      const gfxRow = 64 + Math.floor(index / 64);
      const x = (index % 64) * 2;
      const base = gfxRow * gfx.width + x;
      const byte = (gfx.pixels[base] & 0x0f) | ((gfx.pixels[base + 1] & 0x0f) << 4);
      tiles[index] = byte;
      if (byte !== 0) nonZero += 1;
    }

    return nonZero > 0 ? { width, height, tiles, nonZero } : null;
  }

  /**
   * Place recovered shared rows at map row 32, where they actually live.
   *
   * PICO-8 trims trailing empty rows when it writes __map__, so a cart that
   * stores a one screen tall level yields height 16 even though the shared
   * region is still rows 32-63. Appending would land those rows at 16-47 and
   * shift the whole lower half of the map.
   */
  mergeSharedMapRows(map, sharedRows) {
    const SHARED_ROW_START = 32;
    const keptRows = Math.min(map.height, SHARED_ROW_START);
    const height = SHARED_ROW_START + sharedRows.height;
    const tiles = new Uint8Array(map.width * height);
    tiles.set(map.tiles.subarray(0, map.width * keptRows), 0);
    tiles.set(sharedRows.tiles, map.width * SHARED_ROW_START);
    return { width: map.width, height, tiles };
  }

  /**
   * Detect whether a cart draws sprites 128-255. Those sprites occupy the same
   * bytes as map rows 32-63, so only one interpretation can be meaningful.
   */
  cartUsesHighSprites(luaSource) {
    const source = String(luaSource || '');
    for (const match of source.matchAll(/\b(?:spr|sspr)\s*\(\s*(\d+)/g)) {
      if (Number(match[1]) >= 128) return true;
    }
    return false;
  }

  /** PICO-8's fixed 16-colour palette as `#rrggbb` strings. */
  static get PICO8_PALETTE() {
    return [
      '#000000', '#1d2b53', '#7e2553', '#008751',
      '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
      '#ff004d', '#ffa300', '#ffec27', '#00e436',
      '#29adff', '#83769c', '#ff77a8', '#ffccaa',
    ];
  }

  _crc32(bytes) {
    let table = Pico8ImportService._crcTable;
    if (!table) {
      table = new Uint32Array(256);
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
          c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
      }
      Pico8ImportService._crcTable = table;
    }

    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  _pngChunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, this._crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  /** Wrap raw bytes in a zlib stream using uncompressed deflate blocks. */
  _zlibStore(raw) {
    const MAX = 0xffff;
    const blockCount = Math.max(1, Math.ceil(raw.length / MAX));
    const out = new Uint8Array(2 + (blockCount * 5) + raw.length + 4);
    let p = 0;

    out[p++] = 0x78; // CMF: deflate, 32K window
    out[p++] = 0x01; // FLG: no dictionary, fastest

    for (let block = 0; block < blockCount; block += 1) {
      const offset = block * MAX;
      const size = Math.min(MAX, raw.length - offset);
      out[p++] = block === blockCount - 1 ? 1 : 0;
      out[p++] = size & 0xff;
      out[p++] = (size >>> 8) & 0xff;
      out[p++] = ~size & 0xff;
      out[p++] = (~size >>> 8) & 0xff;
      out.set(raw.subarray(offset, offset + size), p);
      p += size;
    }

    let a = 1;
    let b = 0;
    for (let i = 0; i < raw.length; i += 1) {
      a = (a + raw[i]) % 65521;
      b = (b + a) % 65521;
    }
    out[p++] = (b >>> 8) & 0xff;
    out[p++] = b & 0xff;
    out[p++] = (a >>> 8) & 0xff;
    out[p++] = a & 0xff;

    return out.subarray(0, p);
  }

  /**
   * Encode palette-indexed pixels as an 8-bit indexed PNG. Writing indices
   * directly keeps the PICO-8 colours exact instead of round-tripping RGBA
   * through a canvas.
   */
  encodeIndexedPng(width, height, pixels, palette) {
    const raw = new Uint8Array(height * (width + 1));
    for (let y = 0; y < height; y += 1) {
      raw[y * (width + 1)] = 0; // filter type: none
      raw.set(pixels.subarray(y * width, (y + 1) * width), (y * (width + 1)) + 1);
    }

    const ihdr = new Uint8Array(13);
    const ihdrView = new DataView(ihdr.buffer);
    ihdrView.setUint32(0, width);
    ihdrView.setUint32(4, height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 3; // colour type: indexed
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const plte = new Uint8Array(palette.length * 3);
    palette.forEach((hex, i) => {
      const value = parseInt(String(hex).replace('#', ''), 16);
      plte[i * 3] = (value >> 16) & 0xff;
      plte[(i * 3) + 1] = (value >> 8) & 0xff;
      plte[(i * 3) + 2] = value & 0xff;
    });

    const parts = [
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      this._pngChunk('IHDR', ihdr),
      this._pngChunk('PLTE', plte),
      this._pngChunk('IDAT', this._zlibStore(raw)),
      this._pngChunk('IEND', new Uint8Array(0)),
    ];

    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const png = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      png.set(part, offset);
      offset += part.length;
    }
    return png;
  }

  /**
   * Encode straight RGBA pixels as a 32-bit PNG.
   *
   * The font atlas needs real transparency rather than a palette index that
   * happens to mean "background", because the build turns it into a
   * d2_mode_alpha8 texture where the alpha channel *is* the glyph.
   */
  encodeRgbaPng(width, height, rgba) {
    const stride = width * 4;
    const raw = new Uint8Array(height * (stride + 1));
    for (let y = 0; y < height; y += 1) {
      raw[y * (stride + 1)] = 0; // filter type: none
      raw.set(rgba.subarray(y * stride, (y + 1) * stride), (y * (stride + 1)) + 1);
    }

    const ihdr = new Uint8Array(13);
    const ihdrView = new DataView(ihdr.buffer);
    ihdrView.setUint32(0, width);
    ihdrView.setUint32(4, height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type: RGBA
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const parts = [
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      this._pngChunk('IHDR', ihdr),
      this._pngChunk('IDAT', this._zlibStore(raw)),
      this._pngChunk('IEND', new Uint8Array(0)),
    ];

    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const png = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      png.set(part, offset);
      offset += part.length;
    }
    return png;
  }

  /**
   * Write the PICO-8 print() font as a real project asset: an atlas PNG plus
   * the `.font` metadata that builds it into the .d2 + .fnt pair.
   *
   * WHY THE IMPORT CARRIES A FONT AT ALL
   * ------------------------------------
   * A cart has no font in it - PICO-8's is part of the console, not the
   * cartridge - so there is nothing here to convert. Studio supplies the
   * glyphs from Pico8Font, and print() rasterises them on the CPU because it
   * has to obey camera()/clip()/pal() and draw order (see pico8-font.js).
   *
   * That works in the simulator but leaves the glyphs living only in
   * JavaScript, where the build pipeline cannot see them: a cart that draws
   * its HUD with print() would come up blank on the watch. Emitting the same
   * table as an asset gives the firmware's font renderer something to load.
   * Both sides read Pico8Font.buildAtlas(), so they cannot disagree.
   */
  async importFont(draft, projectName, sourceFile = null) {
    const fontApi = (typeof window !== 'undefined' && window.Pico8Font)
      || (typeof globalThis !== 'undefined' && globalThis.Pico8Font);
    if (!fontApi || typeof fontApi.buildAtlas !== 'function') {
      return null;
    }

    const atlas = fontApi.buildAtlas();
    const baseName = 'pico8_font';
    const folder = draft.getPreferredManagedFolderForExtension(projectName, '.font');

    // The atlas sits beside its .font rather than in Sources/Images: it is not
    // artwork the project draws with, and splitting the pair across folders
    // just makes it easy to move one without the other.
    const png = this.encodeRgbaPng(atlas.width, atlas.height, atlas.rgba);
    await this.addBinaryFile(draft, folder, `${baseName}.png`, png, 'image/png', {
      skipCompanionCreation: true,
    });

    const pngPath = this.toProjectRelativePath(`${folder}/${baseName}.png`);
    const metadata = {
      type: 'retrowatch-font',
      // Not a TrueType face: rasterising a 3x5 glyph from an outline at 5px
      // would antialias it and slide it off the pixel grid.
      source: 'bitmap',
      sourceAtlasPath: pngPath,
      fontFamily: 'pico8',
      fontSize: atlas.base,
      outputPixelFormat: 'd2_mode_alpha8',
      lineHeight: atlas.lineHeight,
      base: atlas.base,
      padding: 0,
      spacing: 0,
      atlas: {
        columns: atlas.columns,
        cellWidth: atlas.cellWidth,
        cellHeight: atlas.cellHeight,
        firstCode: atlas.firstCode,
      },
      ranges: atlas.ranges,
      metadata: {
        sourceAtlasPath: pngPath,
        sourceCart: sourceFile,
      },
    };

    await this.addTextFile(draft, folder, `${baseName}.font`, JSON.stringify(metadata, null, 2));

    return {
      pngFile: `${baseName}.png`,
      fontFile: `${baseName}.font`,
      fontPath: this.toProjectRelativePath(`${folder}/${baseName}.font`),
      width: atlas.width,
      height: atlas.height,
      glyphCount: atlas.glyphs.length,
    };
  }

  /**
   * Write the cart's sprite sheet as a PNG plus the `.texture` metadata the
   * build pipeline needs to emit a Dave2D texture.
   */
  async importSpriteSheet(draft, projectName, gfx, sourceFile = null) {
    if (!gfx) return null;

    const folder = draft.getPreferredManagedFolderForExtension(projectName, '.png');

    const baseName = 'pico8_sprites';
    const palette = Pico8ImportService.PICO8_PALETTE;
    const png = this.encodeIndexedPng(gfx.width, gfx.height, gfx.pixels, palette);

    // The converter writes its own .texture (4bpp indexed) and .frameset (256 8x8
    // frames); the explorer's generic image companions would otherwise race with
    // these writes and replace them with rgb565 / single full-image defaults.
    await this.addBinaryFile(draft, folder, `${baseName}.png`, png, 'image/png', {
      skipCompanionCreation: true,
    });

    // Cross-resource references are stored project-relative so a copied or
    // renamed project still resolves them (ProjectPaths.rebaseManagedPath
    // re-prefixes them against the owning file's project).
    const pngPath = this.toProjectRelativePath(`${folder}/${baseName}.png`);
    const texture = {
      version: 1,
      name: baseName,
      sourceImage: pngPath,
      sourceImagePath: pngPath,
      width: gfx.width,
      height: gfx.height,
      colorDepth: 4,
      palette,
      metadata: {
        sourceImagePath: pngPath,
        outputPixelFormat: 'd2_mode_i4',
        paletteOffset: 0,
        scale: 1.0,
        tileWidth: 8,
        tileHeight: 8,
        // PICO-8 treats colour 0 as transparent in spr()/map() unless palt()
        // says otherwise; the pixels stay opaque so nothing is lost.
        transparentIndex: 0,
        sourceCart: sourceFile,
      },
    };

    await this.addTextFile(draft, folder, `${baseName}.texture`, JSON.stringify(texture, null, 2));

    const frameset = await this.importFrameset(draft, projectName, folder, baseName, gfx, pngPath);

    return {
      pngFile: `${baseName}.png`,
      textureFile: `${baseName}.texture`,
      texturePath: this.toProjectRelativePath(`${folder}/${baseName}.texture`),
      framesetFile: frameset?.framesetFile || null,
      spriteFile: frameset?.spriteFile || null,
      frameCount: frameset?.frameCount || 0,
      width: gfx.width,
      height: gfx.height,
      spriteCount: 256,
    };
  }

  /**
   * Emit the sprite-sheet grid as a `.frameset` (256 uniform 8x8 frames, frame
   * id == PICO-8 sprite index) plus a `.sprite` that exposes one single-frame
   * animation per sprite. This makes the sheet a first-class Studio sprite
   * asset, so `Sprite.Create('pico8_sprites')` and the PICO-8 runtime share one
   * source of pixels instead of each carrying their own copy.
   */
  async importFrameset(draft, projectName, imageFolder, baseName, gfx, pngPath) {
    const tileSize = 8;
    const columns = Math.floor(gfx.width / tileSize);
    const rows = Math.floor(gfx.height / tileSize);
    const frameCount = columns * rows;
    if (frameCount <= 0) return null;

    const frames = [];
    const animations = [];
    for (let index = 0; index < frameCount; index += 1) {
      const label = `spr_${String(index).padStart(3, '0')}`;
      frames.push({
        id: index,
        name: label,
        x: (index % columns) * tileSize,
        y: Math.floor(index / columns) * tileSize,
        w: tileSize,
        h: tileSize,
      });
      // No Sprite.SetFrame exists, so a single-frame animation per sprite is
      // the only way for Lua to select a specific PICO-8 sprite index.
      animations.push({
        name: label,
        frameIds: [`0:${index}`],
        frameDuration: 100,
        loop: false,
      });
    }

    const framesetName = `${baseName}.frameset`;
    const frameset = {
      version: 1,
      name: baseName,
      imagePath: pngPath,
      imageWidth: gfx.width,
      imageHeight: gfx.height,
      frameWidth: tileSize,
      frameHeight: tileSize,
      columns,
      rows,
      frames,
    };
    await this.addTextFile(draft, imageFolder, framesetName, JSON.stringify(frameset, null, 2));

    const spriteFolder = draft.getPreferredManagedFolderForExtension(projectName, '.sprite');
    const framesetPath = this.toProjectRelativePath(`${imageFolder}/${framesetName}`);
    const sprite = {
      version: 1,
      name: baseName,
      framesets: [{ path: framesetPath }],
      animations,
    };
    await this.addTextFile(draft, spriteFolder, `${baseName}.sprite`, JSON.stringify(sprite, null, 2));

    return {
      framesetFile: framesetName,
      framesetPath,
      spriteFile: `${baseName}.sprite`,
      spritePath: this.toProjectRelativePath(`${spriteFolder}/${baseName}.sprite`),
      frameCount,
    };
  }

  toProjectRelativePath(fullPath) {
    return window.ProjectPaths?.toProjectRelative
      ? window.ProjectPaths.toProjectRelative(fullPath)
      : fullPath;
  }

  /**
   * Write the cart's map as a Studio `.tilemap`, referencing the sprite-sheet
   * texture as an 8x8 tileset of 256 tiles.
   */
  async importTilemap(draft, projectName, map, texturePath, sourceFile = null) {
    if (!map) return null;

    const folder = draft.getPreferredManagedFolderForExtension(projectName, '.tilemap');

    const firstGid = 1;
    // PICO-8's map() skips sprite 0, so tile 0 becomes an empty cell (gid 0).
    const data = new Array(map.width * map.height);
    for (let i = 0; i < data.length; i += 1) {
      const tile = map.tiles[i];
      data[i] = tile === 0 ? 0 : tile + firstGid;
    }

    const tilemap = {
      schema: 'retrostudio-map-v1',
      app: 'RetroStudio',
      mapData: {
        map: {
          width: map.width,
          height: map.height,
          tileWidth: 8,
          tileHeight: 8,
          orientation: 'orthogonal',
        },
        layers: [{
          name: 'Map',
          width: map.width,
          height: map.height,
          visible: true,
          opacity: 1,
          data,
        }],
        tilesets: [{
          firstGid,
          name: 'pico8_sprites',
          tileWidth: 8,
          tileHeight: 8,
          columns: 16,
          tileCount: 256,
          spacing: 0,
          margin: 0,
          sourceTexturePath: texturePath || '',
          image: {
            source: texturePath || '',
            width: 128,
            height: 128,
          },
        }],
      },
      source: {
        cart: sourceFile,
        note: 'Tile gid = PICO-8 sprite index + 1; gid 0 is PICO-8 sprite 0 (skipped by map()).',
      },
    };

    const fileName = 'map.tilemap';
    await this.addTextFile(draft, folder, fileName, JSON.stringify(tilemap, null, 2));

    return {
      file: fileName,
      width: map.width,
      height: map.height,
      usedTiles: new Set(Array.from(map.tiles)).size,
    };
  }

  /**
   * Tidy the generated Lua before it is written to the project.
   *
   * The generator deliberately keeps every token on the line it occupied in the
   * cart, so a runtime error reported at line 412 still points at line 412 of
   * the original. That fidelity is worth having while converting, but it leaves
   * the file unindented and full of the blank runs where the cart's other
   * sections used to be - which is nobody's idea of source you want to open.
   *
   * Kept out of buildRuntimeLua because that one is called synchronously from
   * the emulator when a multicart does load(), and it must stay synchronous.
   * Formatting is a nicety for code a human will read, not for code about to be
   * handed straight to the interpreter.
   */
  async formatRuntimeLua(luaSource) {
    const formatter = window.luaFormatService;
    if (!formatter) return luaSource;
    try {
      // Converge rather than single-pass: this file is written once and read
      // many times, so the extra few hundred milliseconds at import is cheap.
      return await formatter.formatStable(luaSource);
    } catch (error) {
      // An unformatted import still runs. Failing the whole import because the
      // prettifier choked would be a poor trade.
      console.warn('[Pico8Import] Could not format generated Lua:', error?.message || error);
      return luaSource;
    }
  }

  buildRuntimeLua(luaSource, options = {}) {
    // PICO-8 ships a patched Lua, so the cart source has to be lowered to plain
    // Lua before lua.vm.js will even compile it.
    const parser = (typeof window !== 'undefined' && window.Pico8Parser)
      || (typeof globalThis !== 'undefined' && globalThis.Pico8Parser);
    if (!parser) throw new Error('Pico8Parser unavailable; cannot convert cart Lua.');

    // trimEnd only: the parser emits every statement on its original line, so
    // trimming the front would shift runtime error line numbers off the source.
    const source = parser.compile(String(luaSource || '')).trimEnd();
    const hasSetup = /\bfunction\s+Setup\s*\(/.test(source);
    const hasUpdate = /\bfunction\s+Update\s*\(/.test(source);

    // Everything appended below is plain Lua rather than cart dialect, because
    // it shims stock library functions and must not be lowered along with the
    // source. That means any number it hands to a PICO-8 builtin has to be
    // written in whatever representation the builtins expect, which is not
    // necessarily the number as spelt: get this wrong and the value is out by a
    // factor of 65536, which for pico_fps() is the difference between 30 frames
    // a second and one every thirty-six minutes.
    //
    // The two called below are exempt. pico_screen and pico_fps declare their
    // arguments opaque, so the bridge hands them over unscaled and they can be
    // written as the sizes and rates they actually are. That matters because
    // this is the part of the generated file an author is invited to edit.
    // Anything else added here does need lowering.

    const chunks = [];
    if (source) {
      chunks.push(source);
    }

    chunks.push('');
    chunks.push('-- Imported by Pico8ImportService');

    // PICO-8 iterates nil as an empty table, and carts lean on it: POOM builds
    // its per-subsector thing list lazily and then walks it every frame with
    // "for thing in pairs(segs.things)", commented "if any". Stock Lua raises
    // there. all() already tolerates nil in the Pico8 extension; pairs() is
    // plain Lua, so it is shimmed here, where the change stays scoped to
    // imported carts.
    chunks.push('do');
    chunks.push('  local _lua_pairs = pairs');
    chunks.push('  local _no_pairs = function() return nil end');
    chunks.push('  pairs = function(t)');
    chunks.push('    if t == nil then return _no_pairs, nil, nil end');
    chunks.push('    return _lua_pairs(t)');
    chunks.push('  end');
    chunks.push('end');
    chunks.push('');

    // In a cart, print() draws text into the framebuffer; it is not logging.
    // The emulator otherwise replaces the global print() with its debug-console
    // capture after extensions load, which both hides the cart's HUD and floods
    // the console. Opting in here scopes the change to imported carts, so
    // ordinary Studio projects keep print()-to-console.
    chunks.push('_retrostudio_pico8_print = Pico8 and Pico8.print or nil');
    chunks.push('');

    // The cart's __gff__ sprite flags have no home in a Studio asset - a
    // .texture carries no per-sprite metadata - so they ride along here.
    // Without them every fget() returns 0 and flag-driven collision or terrain
    // silently stops working.
    const spriteFlags = String(options.spriteFlags || '');
    if (spriteFlags && /[1-9a-f]/.test(spriteFlags)) {
      chunks.push(`pico_flags("${spriteFlags}")`);
      chunks.push('');
    }

    // The screen size used to be implicit - the cart simply filled the display,
    // corners included. Writing it into the imported cart makes it something
    // the author can edit without touching the engine. Emitted before _init()
    // so the framebuffer is already the right size for anything it draws.
    const screenLines = [
      '-- Output size of the 128x128 PICO-8 screen, centred on the display and',
      '-- stretched to fit. 448x366 fills the display. 366x366 renders centered,',
      '-- maintains the aspect ratio, and avoids the corners.',
      'pico_screen(448, 366)',
    ];

    // Bind the PICO-8 entry points at call time, not import time. Scanning the
    // source for "function _update(" misses the carts that swap entry points to
    // change game state (`_update,_draw = world_update,world_draw`), and those
    // carts then ran with an empty Update() and never advanced.
    if (!hasSetup) {
      chunks.push('function Setup()');
      for (const line of screenLines) {
        chunks.push(`  ${line}`);
      }
      chunks.push('  if type(_init) == "function" then _init() end');
      chunks.push('  -- PICO-8 ticks at 30fps and only runs at 60 for carts that');
      chunks.push('  -- define _update60. Studio updates once per display frame, so');
      chunks.push('  -- without this a 30fps cart plays at double speed. PICO-8 fixes');
      chunks.push('  -- the rate when the cart starts, which is why this is decided');
      chunks.push('  -- here rather than per frame.');
      chunks.push('  if type(_update60) == "function" then');
      chunks.push('    pico_fps(60)');
      chunks.push('  else');
      chunks.push('    pico_fps(30)');
      chunks.push('  end');
      chunks.push('end');
      chunks.push('');
    } else {
      // The cart brought its own Setup(), so there is no generated one to put
      // the call in. Chunk scope runs before Setup() either way.
      chunks.push(...screenLines);
      chunks.push('');
    }

    if (!hasUpdate) {
      chunks.push('function Update(deltaTime)');
      chunks.push('  -- PICO-8 prefers _update60 when a cart defines both.');
      chunks.push('  if type(_update60) == "function" then');
      chunks.push('    _update60()');
      chunks.push('  elseif type(_update) == "function" then');
      chunks.push('    _update()');
      chunks.push('  end');
      chunks.push('  if type(_draw) == "function" then _draw() end');
      chunks.push('end');
      chunks.push('');
    }

    return chunks.join('\n');
  }

  detectCompatibilityWarnings(luaSource, parsedSections, sfxConverted = 0, musicConverted = 0, graphics = {}) {
    const warnings = [];
    const source = String(luaSource || '');
    const checks = [
      { api: 'cstore', regex: /\bcstore\s*\(/ },
      { api: 'serial', regex: /\bserial\s*\(/ },
      { api: 'run', regex: /\brun\s*\(/ },
      { api: 'extcmd', regex: /\bextcmd\s*\(/ },
    ];

    for (const check of checks) {
      if (check.regex.test(source)) {
        warnings.push(`Uses ${check.api}(), which may be unsupported or partial in RetroStudio runtime.`);
      }
    }

    // Supported, but not identically to PICO-8.
    if (/\bflip\s*\(/.test(source)) {
      warnings.push('Uses flip(). It presents the framebuffer but cannot block until the next display frame, so flip-driven animation runs faster than on PICO-8.');
    }
    if (/\bmenuitem\s*\(/.test(source)) {
      warnings.push('Uses menuitem(). The entries are registered but there is no pause menu yet, so the cart\'s menu actions cannot be triggered.');
    }

    const gfxLines = (parsedSections?.gfx || []).join('').trim();
    const mapLines = (parsedSections?.map || []).join('').trim();
    const sfxLines = (parsedSections?.sfx || []).join('').trim();
    const musicLines = (parsedSections?.music || []).join('').trim();

    if (gfxLines) {
      if (graphics?.convertedGraphics) {
        warnings.push('Converted __gfx__ to pico8_sprites.png/.texture (128x128, 4bpp indexed). PICO-8 treats colour 0 as transparent at draw time; the texture keeps it opaque black.');
        if (graphics.convertedGraphics.spriteFile) {
          warnings.push(`Generated ${graphics.convertedGraphics.spriteFile} with ${graphics.convertedGraphics.frameCount} 8x8 frames (one single-frame animation per PICO-8 sprite index), so Sprite.Create() and PICO-8 spr() share the same sheet.`);
        }
      } else {
        warnings.push('Includes __gfx__ data. The raw section is stored as text; no pixels were decoded.');
      }
    }

    if (mapLines) {
      if (graphics?.convertedMap) {
        warnings.push(`Converted __map__ to map.tilemap (${graphics.convertedMap.width}x${graphics.convertedMap.height} tiles, 8x8). Tile gid = sprite index + 1; gid 0 means empty because PICO-8's map() skips sprite 0.`);
      } else {
        warnings.push('Includes __map__ data. The raw section is stored as text; no tiles were decoded.');
      }

      if (graphics?.sharedRows && !graphics.sharedRowsUsed) {
        // Not a truncation: the cart demonstrably draws sprites out of these
        // bytes, so there was never any map data up there to lose. Say so, or it
        // reads as though the level was cut short.
        const mapRows = graphics?.convertedMap?.height;
        const rowText = Number.isFinite(mapRows) ? ` The map is ${mapRows} rows.` : '';
        warnings.push(`Map rows 32-63 are the same bytes as sprites 128-255. This cart draws sprites in that range, so those bytes were imported as sprite data and no map rows were discarded.${rowText}`);
      } else if (graphics?.sharedRowsUsed) {
        warnings.push('Map rows 32-63 were recovered from the shared sprite/map memory region (sprites 128-255). If the cart actually uses those sprites through variables, delete the extra rows.');
      }
    }

    if (!graphics?.convertedGraphics && graphics?.convertedMap) {
      warnings.push('The imported tilemap has no tileset texture because __gfx__ was empty. Assign a tileset before building.');
    }

    if (sfxLines && !sfxConverted) warnings.push('Includes __sfx__ data, but no slot contained audible steps. The raw section is stored as text.');
    if (musicLines && !musicConverted) warnings.push('Includes __music__ data, but no pattern referenced a playable SFX slot. The raw section is stored as text.');

    return warnings;
  }

  async showImportSummaryModal(summary) {
    const includes = summary?.includes || [];
    const warnings = summary?.warnings || [];
    const graphics = summary?.convertedGraphics;

    const assets = [
      ['Sprite sheet', graphics ? `${graphics.textureFile} (${graphics.width}x${graphics.height})` : null],
      ['Sprite asset', graphics?.spriteFile ? `${graphics.spriteFile} (${graphics.frameCount} frames)` : null],
      ['Font', summary?.convertedFont ? `${summary.convertedFont.fontFile} (${summary.convertedFont.glyphCount} glyphs)` : null],
      ['Tilemap', summary?.convertedMap ? `${summary.convertedMap.file} (${summary.convertedMap.width}x${summary.convertedMap.height} tiles)` : null],
      ['SFX slots', (summary?.convertedSfx || []).length || null],
      ['Music songs', (summary?.convertedMusic || []).length || null],
    ];

    const lifecycle = [
      ['Setup from _init', summary.transformed.setupFromInit ? 'yes' : 'no'],
      ['Update synthesized', summary.transformed.synthesizedUpdate ? 'yes' : 'no'],
    ];

    // The plain text form is what the alert() fallback shows, and it doubles as
    // the accessible reading of the dialog.
    const text = [
      `Project: ${summary.projectName}`,
      `Source: ${summary.sourceFile}`,
      '',
      ...(includes.length
        ? ['Expanded #include files:', ...includes.map((inc) => `- ${inc.directive} -> ${inc.path} (${inc.lines} lines)`), '']
        : []),
      'Assets',
      ...assets.map(([label, value]) => `- ${label}: ${value ?? 'none'}`),
      '',
      'Lifecycle transforms',
      ...lifecycle.map(([label, value]) => `- ${label}: ${value}`),
      '',
      'Compatibility warnings',
      ...(warnings.length ? warnings.map((w, i) => `${i + 1}. ${w}`) : ['None']),
    ].join('\n');

    if (window.ModalUtils?.showConfirm) {
      const esc = (v) => window.ModalUtils.escapeHtml(v);
      const heading = (label) => `<div style="color:#4CAF50;font-weight:600;text-transform:uppercase;letter-spacing:.06em;font-size:11px;margin:14px 0 6px;">${esc(label)}</div>`;
      const rows = (pairs) => `<dl style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0;">${
        pairs.map(([label, value]) => `
          <dt style="color:#8b8b8b;">${esc(label)}</dt>
          <dd style="margin:0;color:${value == null ? '#6f6f6f' : '#e0e0e0'};font-style:${value == null ? 'italic' : 'normal'};">${esc(value ?? 'none')}</dd>
        `).join('')
      }</dl>`;
      const list = (items, ordered) => `<${ordered ? 'ol' : 'ul'} style="margin:0;padding-left:18px;color:#e0e0e0;">${
        items.map((item) => `<li style="margin-bottom:3px;">${item}</li>`).join('')
      }</${ordered ? 'ol' : 'ul'}>`;

      const bodyHtml = `
        <div style="color:#cccccc;line-height:1.5;font-size:13px;max-height:55vh;overflow-y:auto;">
          ${rows([['Project', summary.projectName], ['Source', summary.sourceFile]])}
          ${includes.length ? heading(`Expanded #include files (${includes.length})`) : ''}
          ${includes.length ? list(includes.map((inc) => `<code style="color:#dcdcaa;">${esc(inc.directive)}</code> &rarr; ${esc(inc.path)} <span style="color:#8b8b8b;">(${esc(inc.lines)} lines)</span>`), false) : ''}
          ${heading('Assets')}
          ${rows(assets)}
          ${heading('Lifecycle transforms')}
          ${rows(lifecycle)}
          ${heading(`Compatibility warnings (${warnings.length})`)}
          ${warnings.length
            ? list(warnings.map((w) => esc(w)), true)
            : '<div style="color:#6f6f6f;font-style:italic;">None</div>'}
        </div>
      `;

      await window.ModalUtils.showConfirm('PICO-8 Import Summary', text, {
        okText: 'Done',
        cancelText: 'Close',
        bodyHtml,
      });
      return;
    }

    alert(text);
  }

  async addTextFile(draft, folderPath, fileName, content) {
    const file = new File([String(content || '')], fileName, { type: 'text/plain' });
    await draft.addFileToProject(file, folderPath, true, true);
  }

  async addBinaryFile(draft, folderPath, fileName, bytes, mimeType = 'application/octet-stream', options = {}) {
    const file = new File([bytes], fileName, { type: mimeType });
    await draft.addFileToProject(file, folderPath, true, true, options);
  }

  /**
   * Stamp the package settings a PICO-8 cart implies. Without a category the
   * runtime packager refuses to emit app.ini, so an imported cart would fail to
   * play until the user opened Package Settings by hand.
   */
  async applyPackageSettings(draft, projectName, parsed) {
    const settings = {
      formatVersion: 1,
      projectName,
      packageKind: 'rwa',
      title: this.readCartHeaderComment(parsed?.lua, 0) || projectName,
      author: this.readCartHeaderComment(parsed?.lua, 1) || '',
      version: '1.0.0',
      description: '',
      category: 'lua_game',
      icons: { icon32: '', icon128: '' },
      screenshots: [],
      videos: [],
    };

    const folder = `${projectName}/${this.getSourcesRootUi()}/Package`;
    await this.addTextFile(draft, folder, 'app.package', JSON.stringify(settings, null, 2));
  }

  /**
   * PICO-8 carts conventionally open with `-- title` then `-- by author`.
   *
   * Carts also label their editor tabs with a dash-wrapped banner comment, and
   * the first tab's banner sits exactly where the title convention expects the
   * title: train_09.p8 opens `-- main --` and went in titled "main --" while its
   * project was named train_09. A trailing dash is decoration and never part of
   * a title, so those entries are dropped and the caller's filename fallback
   * wins. Positions are kept so `-- my game --` / `-- by someone` still reads
   * the author.
   */
  readCartHeaderComment(lua, index) {
    if (typeof lua !== 'string') return '';
    const comments = [];
    for (const line of lua.split('\n', 8)) {
      const match = line.match(/^\s*--\s*(.+?)\s*$/);
      if (!match) break;
      const text = match[1].replace(/^by\s+/i, '');
      comments.push(/-$/.test(text) ? '' : text);
    }
    return comments[index] || '';
  }

  /**
   * Convert every audible slot in the cart's __sfx__ section into a Studio `.sfx`
   * resource. File names keep the PICO-8 slot number so `sfx(n)` calls line up.
   */
  async importSfxSlots(draft, projectName, slots) {
    if (!Array.isArray(slots) || slots.length === 0) return [];

    const sfxFolder = draft.getPreferredManagedFolderForExtension(projectName, '.sfx');

    const converted = [];
    for (const slot of slots) {
      const spec = this.picoSlotToSfxJson(slot);
      if (!spec) continue;

      const fileName = `sfx_${String(slot.index).padStart(2, '0')}.sfx`;
      await this.addTextFile(draft, sfxFolder, fileName, JSON.stringify(spec, null, 2));
      converted.push({
        slot: slot.index,
        file: fileName,
        speed: spec.pico.speed,
        loopStart: spec.pico.loopStart,
        loopEnd: spec.pico.loopEnd,
      });
    }

    return converted;
  }

  /**
   * Convert the cart's __music__ section into `.p8mus` song resources.
   * One file per song entry point, named so `music(n)` maps to `music_NN.p8mus`.
   */
  async importMusicSongs(draft, projectName, musicLines, sfxSlots, sourceFile = null) {
    const patterns = this.parseP8MusicSection(musicLines);
    if (patterns.length === 0) return [];

    const songs = this.buildPicoSongs(patterns);
    if (songs.length === 0) return [];

    const musicFolder = draft.getPreferredManagedFolderForExtension(projectName, '.p8mus');

    const converted = [];
    for (const song of songs) {
      const name = `music_${String(song.start).padStart(2, '0')}`;
      const spec = this.picoSongToMusicJson(song, patterns, sfxSlots, { name, sourceFile });
      if (!spec) continue;

      const fileName = `${name}.p8mus`;
      await this.addTextFile(draft, musicFolder, fileName, JSON.stringify(spec, null, 2));
      converted.push({
        start: song.start,
        end: song.end,
        loopTo: song.loopTo,
        patterns: spec.song.patterns.length,
        sfxSlots: Object.keys(spec.sfx).length,
        file: fileName,
      });
    }

    return converted;
  }

  /**
   * Files a `#include` directive is allowed to name. PICO-8 accepts a plaintext
   * Lua file or another cart (optionally one tab of it). A `.p8.png` is not
   * includable: PICO-8 only reads text here.
   */
  isIncludableName(name) {
    return /\.(lua|p8|txt)$/i.test(String(name || ''));
  }

  /**
   * True for either cartridge form. PICO-8 exports the same cart as `.p8` text
   * or as a `.p8.png` label image with the cart hidden in its low colour bits,
   * and both are importable.
   */
  isCartName(name) {
    return /\.p8(\.png)?$/i.test(String(name || ''));
  }

  /**
   * Recover `.p8` text from a cart image so that nothing downstream has to know
   * which of the two forms the user picked.
   */
  async readCartImage(name, bytes) {
    if (typeof Pico8P8Png === 'undefined') {
      throw new Error('The .p8.png reader is unavailable; cannot read a cart image.');
    }
    try {
      return (await Pico8P8Png.readCart(bytes)).text;
    } catch (error) {
      throw new Error(`${name} could not be read as a PICO-8 cart image: ${error.message}`);
    }
  }

  /**
   * Collapse a path to a comparable key: forward slashes, no `.`/`..` segments,
   * lower case. `..` that would escape the root is dropped rather than kept, the
   * same way PICO-8 clamps `CD ..` at the top of its virtual drive.
   */
  normalizeIncludePath(rawPath) {
    const stack = [];
    for (const part of String(rawPath || '').replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { stack.pop(); continue; }
      stack.push(part);
    }
    return stack.join('/').toLowerCase();
  }

  /**
   * Index include candidates for lookup by full path and by bare filename.
   * @param {{path: string, text: string}[]} entries
   */
  indexIncludeSources(entries) {
    const byPath = new Map();
    const byName = new Map();

    for (const entry of entries || []) {
      const key = this.normalizeIncludePath(entry.path);
      if (!key) continue;
      byPath.set(key, entry);

      const base = key.split('/').pop();
      if (!byName.has(base)) byName.set(base, []);
      byName.get(base).push(entry);
    }

    return { byPath, byName };
  }

  /**
   * `#include foo.lua`, `#include alltabs.p8`, `#include onetab.p8:1`.
   *
   * The `:n` suffix only means a tab index after a cart, so a bare path that
   * happens to contain a colon is left alone.
   */
  parseIncludeDirective(spec) {
    const raw = String(spec || '').trim();
    const tabbed = raw.match(/^(.*\.p8):(\d+)$/i);
    if (tabbed) return { path: tabbed[1], tab: Number.parseInt(tabbed[2], 10) };
    return { path: raw, tab: null };
  }

  /**
   * Find the file a directive names. Paths are relative to the cart, so try that
   * first, then the archive root, and finally fall back to a bare filename match
   * when it is unambiguous - authors often flatten a cart and its libraries into
   * one folder when zipping them up.
   */
  lookupIncludeSource(sources, includePath, baseDir) {
    const relative = this.normalizeIncludePath(`${baseDir || ''}/${includePath}`);
    const fromRoot = this.normalizeIncludePath(includePath);

    if (sources.byPath.has(relative)) return sources.byPath.get(relative);
    if (sources.byPath.has(fromRoot)) return sources.byPath.get(fromRoot);

    const matches = sources.byName.get(fromRoot.split('/').pop()) || [];
    return matches.length === 1 ? matches[0] : null;
  }

  /**
   * PICO-8 identifies a cart by its header line rather than its extension, and
   * real projects rely on that: Pico8Platformer ships `platformer.lua`, which is
   * a complete cart file. Trusting the extension would paste the `pico-8
   * cartridge` header straight into the Lua and fail to parse.
   */
  looksLikeCartText(text) {
    return /^\s*pico-?8 cartridge/i.test(String(text || ''));
  }

  /**
   * Split a cart's Lua into its editor tabs. PICO-8 writes `-->8` on its own
   * line between tabs.
   */
  extractCartTabs(p8Text) {
    return this.parseP8Text(p8Text).lua.split(/^-->8[ \t]*$/m);
  }

  /**
   * Pull the text a directive refers to out of the file it resolved to.
   * Returns `{ text }` or `{ error }`.
   */
  readIncludeText(entry, spec) {
    if (!this.looksLikeCartText(entry.text)) {
      if (spec.tab !== null) return { error: 'tab indices are only valid for PICO-8 carts' };
      return { text: entry.text };
    }

    const tabs = this.extractCartTabs(entry.text);
    // Join with '' rather than '\n': splitting consumed the `-->8` text but left
    // the newlines on either side, so the tab separator already occupies a line.
    if (spec.tab === null) return { text: tabs.join('') };
    if (spec.tab < 0 || spec.tab >= tabs.length) {
      return { error: `${entry.path} has ${tabs.length} tab(s), so tab ${spec.tab} does not exist` };
    }
    return { text: tabs[spec.tab] };
  }

  /**
   * Expand `#include` directives into the cart's Lua.
   *
   * PICO-8 pastes the included text in place of the directive line, so the
   * flattened result keeps the author's own line numbering for everything above
   * each include. Includes are deliberately NOT expanded recursively - the
   * PICO-8 manual states "Includes are not performed recursively" - so a
   * directive inside an included file is reported instead of being followed.
   */
  resolveIncludes(luaSource, sources, options = {}) {
    const baseDir = options.baseDir || '';
    const lines = String(luaSource || '').replace(/\r\n?/g, '\n').split('\n');

    const resolved = [];
    const problems = [];
    const out = [];

    for (const line of lines) {
      const match = line.match(/^[ \t]*#include[ \t]+(\S.*?)[ \t]*$/i);
      if (!match) {
        out.push(line);
        continue;
      }

      const directive = match[1];
      const spec = this.parseIncludeDirective(directive);
      const entry = this.lookupIncludeSource(sources, spec.path, baseDir);

      if (!entry) {
        problems.push({ directive, reason: 'file was not supplied with the cart' });
        out.push(line);
        continue;
      }

      const read = this.readIncludeText(entry, spec);
      if (read.error) {
        problems.push({ directive, reason: read.error });
        out.push(line);
        continue;
      }

      const text = String(read.text || '').replace(/\r\n?/g, '\n');
      if (/^[ \t]*#include[ \t]/im.test(text)) {
        problems.push({
          directive,
          reason: `${entry.path} contains its own #include, and PICO-8 does not expand includes recursively`,
        });
        out.push(line);
        continue;
      }

      const body = text.split('\n');
      resolved.push({
        directive,
        path: entry.path,
        tab: spec.tab,
        lines: body.length,
        text,
      });
      out.push(...body);
    }

    return { lua: out.join('\n'), resolved, problems };
  }

  /**
   * Rewrite a cart's `__lua__` section with its `#include` directives already
   * expanded. PICO-8 does the same on export - "any included files are
   * flattened and saved with the cartridge so that there are no external
   * dependencies" - and it matters twice over here: the archived copy stays
   * re-importable on its own, and no stray `.lua` is left in the project for
   * the Lua build to sweep up and compile as game source.
   */
  flattenCartText(rawP8, expandedLua) {
    const lines = String(rawP8 || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let inLua = false;
    let wroteLua = false;

    for (const line of lines) {
      const header = line.match(/^__([a-z0-9_]+)__\s*$/i);
      if (header) {
        inLua = header[1].toLowerCase() === 'lua';
        out.push(line);
        if (inLua) {
          out.push(expandedLua);
          wroteLua = true;
        }
        continue;
      }
      if (!inLua) out.push(line);
    }

    if (!wroteLua) out.push('__lua__', expandedLua);
    return out.join('\n');
  }

  describeIncludeProblems(cartName, problems) {    return [
      `${cartName} has ${problems.length} unresolved #include directive(s):`,
      ...problems.map((p) => `  #include ${p.directive} — ${p.reason}`),
      '',
      'PICO-8 stores include files next to the cart on disk, so a lone .p8 does not carry them.',
      'Re-import a .zip archive containing the cart and its include files, or select them all together.',
    ].join('\n');
  }

  /**
   * Read a `.p8`/`.p8.png` cart (optionally with sibling files selected
   * alongside it) or a `.zip` archive into
   * `{ cartName, cartText, cartDir, sources }`.
   */
  async readCartBundle(file, options = {}) {
    const name = String(file?.name || '');

    if (/\.zip$/i.test(name)) return this.readCartArchive(file, options);
    if (!this.isCartName(name)) {
      throw new Error('Only .p8 / .p8.png carts and .zip archives containing one are supported.');
    }

    const entries = [];
    for (const extra of options.includeFiles || []) {
      if (!extra || extra === file || typeof extra.name !== 'string') continue;
      if (!this.isIncludableName(extra.name)) continue;
      // webkitRelativePath is set when a whole folder is chosen, which preserves
      // the layout that relative #include paths are written against.
      entries.push({ path: extra.webkitRelativePath || extra.name, text: await extra.text() });
    }

    const cartText = /\.png$/i.test(name)
      ? await this.readCartImage(name, new Uint8Array(await file.arrayBuffer()))
      : await file.text();

    return {
      cartName: name,
      cartText,
      cartDir: '',
      sources: this.indexIncludeSources(entries),
    };
  }

  /**
   * Pick the cart out of a zip and read every file that could satisfy one of its
   * `#include` directives.
   */
  async readCartArchive(file, options = {}) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip is unavailable; cannot read the archive.');
    }

    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const paths = [];
    // __MACOSX holds resource-fork twins of every real entry; including them
    // would make each filename ambiguous for the bare-name fallback.
    zip.forEach((relativePath, entry) => {
      if (entry.dir) return;
      if (/(^|\/)__macosx\//i.test(relativePath)) return;
      if (/(^|\/)\._/.test(relativePath)) return;
      paths.push(relativePath);
    });

    const cartPath = this.chooseCartPath(paths, file.name, options.cartPath);

    const entries = [];
    for (const path of paths) {
      if (path === cartPath) continue;
      if (!this.isIncludableName(path)) continue;
      entries.push({ path, text: await zip.file(path).async('string') });
    }

    const slash = cartPath.lastIndexOf('/');
    const cartText = /\.png$/i.test(cartPath)
      ? await this.readCartImage(cartPath, await zip.file(cartPath).async('uint8array'))
      : await zip.file(cartPath).async('string');

    return {
      cartName: cartPath.split('/').pop(),
      cartText,
      cartDir: slash >= 0 ? cartPath.slice(0, slash) : '',
      sources: this.indexIncludeSources(entries),
      archiveName: file.name,
    };
  }

  /**
   * Decide which `.p8` in an archive is the cart to import. Ambiguity is an
   * error rather than a guess: picking the wrong cart silently imports the wrong
   * game.
   */
  chooseCartPath(paths, archiveName, requestedPath) {
    const carts = paths.filter((path) => this.isCartName(path));
    if (carts.length === 0) throw new Error(`${archiveName} contains no .p8 cart.`);
    if (carts.length === 1) return carts[0];

    if (requestedPath) {
      const wanted = this.normalizeIncludePath(requestedPath);
      const hit = carts.find((path) => this.normalizeIncludePath(path) === wanted);
      // Falling back to a guess here would quietly import a different cart than
      // the caller asked for, which is exactly the bug the picker exists to stop.
      if (!hit) throw new Error(`${archiveName} has no cart at ${requestedPath}.`);
      return hit;
    }

    const archiveBase = String(archiveName || '').replace(/\.zip$/i, '').toLowerCase();
    const named = carts.filter(
      (path) => path.split('/').pop().replace(/\.p8(\.png)?$/i, '').toLowerCase() === archiveBase
    );
    if (named.length === 1) return named[0];

    const depth = (path) => path.split('/').length;
    const shallowest = Math.min(...carts.map(depth));
    const top = carts.filter((path) => depth(path) === shallowest);
    if (top.length === 1) return top[0];

    // Guessing here would silently import the wrong game, so make the caller
    // choose. The candidate list rides along so the UI can offer a picker.
    const error = new Error(
      `${archiveName} contains ${carts.length} carts. Choose which one to import.`
    );
    error.cartPaths = carts;
    throw error;
  }

  /**
   * True when a `.zip` looks like a PICO-8 cart archive rather than an ordinary
   * asset the user meant to drop into the project.
   */
  async looksLikeCartArchive(file) {
    try {
      if (typeof JSZip === 'undefined') return false;
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      let found = false;
      zip.forEach((relativePath, entry) => {
        if (entry.dir || found) return;
        if (/(^|\/)__macosx\//i.test(relativePath)) return;
        if (this.isCartName(relativePath)) found = true;
      });
      return found;
    } catch (_) {
      return false;
    }
  }

  /**
   * Convert a `.p8` cart into a RetroStudio source package (`.rws`).
   *
   * Nothing is written to project storage and no built artefacts are produced —
   * the result is a self-contained bundle of source files that the normal
   * `.rws`/`.rwp` import path (or the Retrowww uploader) can consume.
   */
  async convertToRws(file, options = {}) {
    const name = typeof file?.name === 'string' ? file.name : '';
    if (!this.isCartName(name) && !/\.zip$/i.test(name)) {
      throw new Error('Only .p8 / .p8.png carts and .zip archives containing one are supported.');
    }
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip is unavailable; cannot build an .rws package.');
    }

    const bundle = await this.readCartBundle(file, options);
    const parsed = this.parseP8Text(bundle.cartText);

    // Flatten #include directives before anything reads the cart's Lua: the
    // token scans below (high sprites, compatibility warnings) and the parser
    // all need to see the included code, not the directive line.
    const includes = this.resolveIncludes(parsed.lua, bundle.sources, { baseDir: bundle.cartDir });
    if (includes.problems.length > 0) {
      throw new Error(this.describeIncludeProblems(bundle.cartName, includes.problems));
    }
    const cartLua = includes.lua;

    const projectName = options.projectNameOverride
      ? this.sanitizeProjectName(options.projectNameOverride)
      : this.sanitizeProjectName(bundle.cartName);

    const sourcesRoot = this.getSourcesRootUi();
    const draft = new Pico8ProjectDraft(projectName, sourcesRoot);

    await this.applyPackageSettings(draft, projectName, parsed);

    const preferredLuaFolder = draft.getPreferredManagedFolderForExtension(projectName, '.lua');
    const importFolder = `${projectName}/${sourcesRoot}/Import/pico8`;

    const runtimeLua = this.buildRuntimeLua(cartLua, {
      spriteFlags: this.parseP8GffSection(parsed.sections?.gff),
    });

    await this.addTextFile(draft, preferredLuaFolder, 'main.lua', await this.formatRuntimeLua(runtimeLua));

    // Archive the flattened cart rather than the original text plus its loose
    // include files: the project's Lua build compiles every .lua it finds, so
    // an archived `platformer.lua` full of raw PICO-8 would be concatenated
    // into the game and fail to parse.
    const archivedCart = includes.resolved.length > 0
      ? this.flattenCartText(parsed.raw, cartLua)
      : parsed.raw;
    await this.addTextFile(draft, importFolder, 'cart-original.p8', archivedCart);

    const namedSections = ['gfx', 'map', 'gff', 'sfx', 'music', 'label'];
    for (const name of namedSections) {
      const sectionLines = parsed.sections[name] || [];
      if (sectionLines.length === 0) continue;
      const sectionContent = sectionLines.join('\n').trim();
      if (!sectionContent) continue;
      await this.addTextFile(draft, importFolder, `${name}.txt`, sectionContent);
    }

    const cartFamily = await this.writeCartFamily(draft, importFolder, bundle, archivedCart);

    const convertedSfxSlots = this.parseP8SfxSection(parsed.sections.sfx || []);
    const convertedSfx = await this.importSfxSlots(draft, projectName, convertedSfxSlots);
    const convertedMusic = await this.importMusicSongs(
      draft,
      projectName,
      parsed.sections.music || [],
      convertedSfxSlots,
      bundle.cartName
    );

    const gfx = this.parseP8GfxSection(parsed.sections.gfx || []);
    const convertedGraphics = await this.importSpriteSheet(draft, projectName, gfx, bundle.cartName);

    // Unconditional: unlike the sections above there is nothing in the cart to
    // key off, and any cart may call print() at any point.
    const convertedFont = await this.importFont(draft, projectName, bundle.cartName);

    const map = this.parseP8MapSection(parsed.sections.map || []);
    const sharedRows = this.extractSharedMapRows(gfx);
    const usesHighSprites = this.cartUsesHighSprites(cartLua);
    let mapSource = map;
    let sharedRowsUsed = false;

    // Map rows 32-63 and sprites 128-255 are the same bytes. Only extend the map
    // when the cart shows no sign of drawing those sprites.
    if (map && sharedRows && !usesHighSprites) {
      mapSource = this.mergeSharedMapRows(map, sharedRows);
      sharedRowsUsed = true;
    }

    const convertedMap = await this.importTilemap(
      draft,
      projectName,
      mapSource,
      convertedGraphics?.texturePath || '',
      bundle.cartName
    );

    const warnings = this.detectCompatibilityWarnings(
      cartLua,
      parsed.sections,
      convertedSfx.length,
      convertedMusic.length,
      { convertedGraphics, convertedMap, sharedRows, sharedRowsUsed, usesHighSprites }
    );

    if (includes.resolved.length > 0) {
      warnings.unshift(
        `Expanded ${includes.resolved.length} #include file(s) into main.lua. `
        + 'cart-original.p8 was flattened the same way, so it has no external dependencies.'
      );
      if (includes.resolved.some((include) => include.tab !== null)) {
        warnings.push(
          'A #include used the cart:tab form. Tab indices are treated as 0-based '
          + '(the numbering PICO-8 shows on its editor tabs); check the included code if it looks off by one.'
        );
      }
    }

    if (cartFamily.count > 1) {
      warnings.unshift(
        `Kept ${cartFamily.count - 1} extra cart(s) from the archive under Import/pico8/carts so that `
        + 'reload() and load() can reach their data.'
      );
    }
    warnings.push(...cartFamily.warnings);

    const importSummary = {
      sourceFile: bundle.archiveName || bundle.cartName,
      cartFile: bundle.cartName,
      projectName,
      transformed: {
        setupFromInit: /\bfunction\s+Setup\s*\(/.test(runtimeLua) && /_init/.test(runtimeLua),
        synthesizedUpdate: /\bfunction\s+Update\s*\(/.test(runtimeLua),
      },
      hasSections: {
        lua: Boolean(cartLua),
        gfx: (parsed.sections.gfx || []).length > 0,
        map: (parsed.sections.map || []).length > 0,
        sfx: (parsed.sections.sfx || []).length > 0,
        music: (parsed.sections.music || []).length > 0,
      },
      includes: includes.resolved.map(({ directive, path, tab, lines }) => ({ directive, path, tab, lines })),
      convertedSfx,
      convertedMusic,
      convertedGraphics,
      convertedFont,
      convertedMap,
      warnings,
    };
    await this.addTextFile(draft, importFolder, 'import-summary.json', JSON.stringify(importSummary, null, 2));

    const blob = await this.buildRwsBlob(draft);
    return { blob, fileName: `${projectName}.rws`, projectName, summary: importSummary };
  }

  /**
   * Package a draft as `.rws` — a ZIP holding exactly one `.rwp`, which is what
   * `RwpService.importProject` detects and unwraps.
   *
   * No `runtime/` payload or `package.ini` is emitted: both describe built
   * output, which only the studio's build system can produce. The studio adds
   * them when the loaded project is exported or published.
   */
  async buildRwsBlob(draft) {
    const projectZip = new JSZip();
    const manifestFiles = [];

    for (const entry of draft.files.values()) {
      projectZip.file(entry.storagePath, entry.bytes, { binary: true });
      manifestFiles.push({ path: entry.storagePath, builderId: null, binary: entry.binary });
    }

    const manifest = {
      format: 'retro-watch-project',
      version: 2,
      projectName: draft.projectName,
      sourcesRoot: draft.sourcesRootUi,
      createdAt: new Date().toISOString(),
      files: manifestFiles,
      generator: 'Pico8ImportService',
    };
    projectZip.file('rwp.json', new TextEncoder().encode(JSON.stringify(manifest)), { binary: true });

    const projectBlob = await projectZip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const workspaceZip = new JSZip();
    workspaceZip.file(`${draft.projectName}.rwp`, new Uint8Array(await projectBlob.arrayBuffer()), {
      binary: true,
    });

    return workspaceZip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
  }

  /**
   * Convert a cart and save the resulting `.rws` to disk without touching the
   * open workspace. Useful for producing bundle-upload fixtures.
   */
  async downloadRws(file, options = {}) {
    const converted = await this.convertToRws(file, options);
    const url = URL.createObjectURL(converted.blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = converted.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return converted;
  }

  /**
   * Ask which cart to import when an archive holds several. Returns null when
   * there is no UI to ask with, or the user cancelled.
   */
  async promptForCartPath(archiveName, cartPaths) {
    if (!window.ModalUtils?.showForm) return null;
    const picked = await window.ModalUtils.showForm(
      'Choose a cart',
      [{
        name: 'cartPath',
        type: 'select',
        label: `${archiveName} contains ${cartPaths.length} carts`,
        options: cartPaths.map((path) => ({ value: path, text: path })),
        required: true,
      }],
      { okText: 'Import' }
    );
    return picked?.cartPath || null;
  }

  async importProject(file, options = {}) {
    this.ensureDeps();
    const explorer = this.projectExplorer;
    if (!explorer) throw new Error('ProjectExplorer unavailable');

    const rwpService = window.serviceContainer?.get?.('rwpService') || window.rwpService;
    if (!rwpService || typeof rwpService.importProject !== 'function') {
      throw new Error('RwpService unavailable; cannot import the converted package.');
    }

    const preferredName = this.sanitizeProjectName(options.projectNameOverride || file?.name);
    const projectName = this.allocateProjectName(explorer, preferredName);

    let converted;
    try {
      converted = await this.convertToRws(file, { ...options, projectNameOverride: projectName });
    } catch (error) {
      if (!Array.isArray(error?.cartPaths)) throw error;
      const cartPath = await this.promptForCartPath(file.name, error.cartPaths);
      if (!cartPath) throw error;
      converted = await this.convertToRws(file, { ...options, cartPath, projectNameOverride: projectName });
    }

    const packageFile = new File([converted.blob], converted.fileName, {
      type: 'application/zip',
    });

    await rwpService.importProject(packageFile, { projectNameOverride: projectName });

    await this.showImportSummaryModal(converted.summary);

    window.gameEmulator?.updateStatus?.(`Imported PICO-8 cart: ${projectName}`, 'success');
    return converted.summary;
  }
}

// Register service in container if available
(function initPico8ImportService() {
  try {
    const services = window.serviceContainer;
    if (services) {
      const instance = new Pico8ImportService(services);
      services.registerSingleton('pico8ImportService', instance);
      window.pico8ImportService = instance;
    } else {
      window.pico8ImportService = new Pico8ImportService(null);
    }
  } catch (_) {
    // ignore
  }
})();

window.Pico8ImportService = Pico8ImportService;
