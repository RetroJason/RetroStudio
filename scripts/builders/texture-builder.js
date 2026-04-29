// texture-builder.js
// Build-time texture processor: reads .texture metadata, loads source image + palette,
// runs color reduction / palette matching, outputs Dave2D GPU binary (.d2)

console.log('[TextureBuilder] Class definition loading');

class TextureBuilder extends BaseBuilder {
  /**
   * Build a .texture file into a .d2 binary ready for the Dave2D GPU.
   *
   * A .texture file is JSON metadata created by the TextureEditor:
   * {
   *   "sourceImage": "MyProject/Sources/Images/player.png",
   *   "name": "player",
   *   "format": "RGBA",
   *   "width": 32, "height": 32,
   *   "colorDepth": 8,
   *   "metadata": {
   *     "sourceImagePath": "MyProject/Sources/Images/player.png",
   *     "palettePath": "MyProject/Sources/Palettes/main.act",
   *     "outputPixelFormat": "d2_mode_i8",
   *     "scale": 1.0,
   *     "paletteOffset": 0
   *   }
   * }
   */
  async build(file) {
    const tag = '[TextureBuilder]';
    try {
      console.log(`${tag} Processing: ${file.path}`);

      // ── 1. Parse the .texture JSON ────────────────────────────────
      const textureJson = this.parseTextureJson(file.content);
      const meta = textureJson.metadata || {};
      const format = meta.outputPixelFormat;
      if (!format || typeof format !== 'string') {
        throw new Error(`Texture metadata is missing outputPixelFormat: ${file.path}`);
      }
      const paletteOffset = meta.paletteOffset ?? 0;
      const palettePath = meta.palettePath || '';
      const sourceImagePath = meta.sourceImagePath || textureJson.sourceImagePath || textureJson.sourceImage || '';
      const resolvedImagePath = this.resolveResourcePath(file.path, sourceImagePath);
      const resolvedPalettePath = this.resolveResourcePath(file.path, palettePath);
      const fmtEnum = FORMAT_STRING_TO_ENUM[format];
      if (fmtEnum === undefined) {
        throw new Error(`Unsupported texture outputPixelFormat "${format}" in ${file.path}`);
      }

      const expectedColorDepth = this.getColorDepthForFormat(format);
      if (textureJson.colorDepth !== undefined && Number(textureJson.colorDepth) !== expectedColorDepth) {
        throw new Error(`Texture colorDepth (${textureJson.colorDepth}) does not match outputPixelFormat ${format} (${expectedColorDepth}-bit) in ${file.path}`);
      }

      // ── 2. Load the source image and rebuild the D2 payload ───────
      if (!resolvedImagePath) {
        throw new Error(`Source image path missing in .texture: ${file.path}`);
      }

      const sourceImageContent = await this.loadFileContent(resolvedImagePath);
      if (!sourceImageContent) {
        throw new Error(`Source image not found: ${resolvedImagePath}`);
      }

      const RWImageData = window.ImageData;
      if (!RWImageData || typeof RWImageData.fromFile !== 'function') {
        throw new Error('RetroStudio ImageData loader is not available');
      }

      const image = await RWImageData.fromFile(sourceImageContent, resolvedImagePath);
      const width = image.width;
      const height = image.height;
      const rgbaFrame = image.frames?.[0];
      if (!rgbaFrame || !rgbaFrame.colors) {
        throw new Error(`Unable to decode source image pixels: ${resolvedImagePath}`);
      }

      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let index = 0; index < rgbaFrame.colors.length; index++) {
        const color = rgbaFrame.colors[index];
        const offset = index * 4;
        rgba[offset] = color.r;
        rgba[offset + 1] = color.g;
        rgba[offset + 2] = color.b;
        rgba[offset + 3] = Math.round((color.alpha ?? 1) * 255);
      }

      let d2Bytes;

      // ── 3. Resolve palette index from the build-time palette registry ──
      let paletteIndex = 0;
      let palette = null;
      if (palettePath) {
        const embeddedPalette = textureJson.palette;
        if (Array.isArray(embeddedPalette) && embeddedPalette.length > 0) {
          palette = embeddedPalette.map(c => {
            if (typeof c === 'string') return c;
            if (c && typeof c === 'object' && c.r !== undefined) {
              const toHex = v => v.toString(16).padStart(2, '0');
              return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
            }
            return '#000000';
          });
        } else {
          // Load from palette file
          const paletteContent = await this.loadFileContent(resolvedPalettePath);
          if (!paletteContent) throw new Error(`Palette not found: ${resolvedPalettePath}`);
          const PaletteClass = window.Palette;
          if (!PaletteClass) throw new Error('Palette class not available');
          const paletteObj = new PaletteClass();
          await paletteObj.loadFromContent(paletteContent, resolvedPalettePath);
          palette = paletteObj.colors.map(c => typeof c === 'string' ? c : '#000000');
        }

        paletteIndex = TextureBuilder.getPaletteIndex(resolvedPalettePath, palette);
        console.log(`${tag} Palette index ${paletteIndex} for ${resolvedPalettePath} (${palette.length} colors)`);
      }

      const D2FileClass = window.D2File;
      if (!D2FileClass) {
        throw new Error('D2File builder is not available');
      }

      if (this.isIndexedFormatEnum(fmtEnum)) {
        if (!palette || palette.length === 0) {
          throw new Error(`Indexed texture requires a palette: ${file.path}`);
        }

        const chunkSize = this.getIndexedPaletteColorCount(fmtEnum);
        const paletteSlice = palette.slice(paletteOffset, paletteOffset + chunkSize);
        if (paletteSlice.length !== chunkSize) {
          throw new Error(`Palette slice out of range for ${file.path}: offset=${paletteOffset} size=${chunkSize} paletteLen=${palette.length}`);
        }

        const colorKeyOpts = (textureJson.useColorKey && format !== 'd2_mode_ai44')
          ? { enabled: true, color: textureJson.transparentColor || '#FF00FF' }
          : null;

        const reduced = image.matchToPalette(0, paletteSlice, 0, null, colorKeyOpts);
        if (!reduced || !reduced.indexedFrames || reduced.indexedFrames.length === 0) {
          throw new Error(`Failed to match source image to palette: ${resolvedImagePath}`);
        }

        d2Bytes = D2FileClass.build(textureJson, reduced.indexedFrames[0].indexedData, width, height);
      } else {
        d2Bytes = D2FileClass.buildFromRGBA(textureJson, rgba, width, height);
      }

      // ── 4. Patch the rebuilt .d2 header with build-time palette info ─
      const output = new Uint8Array(d2Bytes.length);
      output.set(d2Bytes);
      const headerView = new DataView(output.buffer, output.byteOffset, output.byteLength);

      // Offset 10-11: paletteIndex (uint16 LE)
      headerView.setUint16(10, paletteIndex, true);
      // Offset 12: paletteOffset (uint8)
      output[12] = paletteOffset & 0xFF;

      // Patch color key from .texture metadata into D2TX header
      if (textureJson.useColorKey) {
        const hex = textureJson.transparentColor || '#FF00FF';
        const r = parseInt(hex.substring(1, 3), 16) || 0;
        const g = parseInt(hex.substring(3, 5), 16) || 0;
        const b = parseInt(hex.substring(5, 7), 16) || 0;
        const rgb565 = (Math.round(r * 31 / 255) << 11) | (Math.round(g * 63 / 255) << 5) | Math.round(b * 31 / 255);
        output[13] = output[13] | 0x04;                    // flag bit 2 = color key enabled
        headerView.setUint16(14, rgb565 & 0xFFFF, true);   // RGB565 color key LE
      }

      const hWidth  = headerView.getUint16(6, true);
      const hHeight = headerView.getUint16(8, true);
      const hFormat = output[5];
      const hFlags  = output[13];
      console.log(`${tag} Rebuilt header: paletteIndex=${paletteIndex}, paletteOffset=${paletteOffset}, ${hWidth}×${hHeight}, fmt=0x${hFormat.toString(16)}, flags=0x${hFlags.toString(16)}`);

      // ── 5. Save to build directory ────────────────────────────────
      const outUiPath = file.path.replace(/\.texture$/i, '.d2');
      const outputPath = (window.ProjectPaths && typeof window.ProjectPaths.toBuildOutputPath === 'function')
        ? window.ProjectPaths.toBuildOutputPath(outUiPath)
        : outUiPath.replace(/^Resources\//, 'build/');

      const fileManager = window.serviceContainer?.get('fileManager');
      if (fileManager) {
        await fileManager.saveFile(outputPath, output.buffer, { binaryData: true });
      } else if (window.fileIOService) {
        await window.fileIOService.saveFile(outputPath, output.buffer, { binaryData: true });
      } else {
        throw new Error('No file service available to save build output');
      }

      console.log(`${tag} ✓ ${file.path} → ${outputPath} (${output.length} bytes, palIdx=${paletteIndex})`);

      return {
        success: true,
        inputPath: file.path,
        outputPath: outputPath,
        builder: 'texture',
        meta: {
          width: hWidth,
          height: hHeight,
          format: format,
          binarySize: output.length - 32,
          paletteIndex: paletteIndex,
          paletteOffset: paletteOffset
        }
      };

    } catch (error) {
      console.error(`${tag} ✗ ${file.path}: ${error.message}`);
      return {
        success: false,
        inputPath: file.path,
        error: error.message,
        builder: 'texture'
      };
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  parseTextureJson(content) {
    if (typeof content === 'string') {
      try {
        return JSON.parse(content);
      } catch (e) {
        throw new Error(`Invalid .texture JSON: ${e.message}`);
      }
    }
    if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
      const bytes = content instanceof ArrayBuffer
        ? new Uint8Array(content)
        : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
      const text = new TextDecoder('utf-8').decode(bytes);
      return JSON.parse(text);
    }
    throw new Error('Unexpected .texture content type');
  }

  /**
   * Load a file from storage, trying FileManager then fileIOService.
   * Returns the raw content (string or ArrayBuffer).
   */
  async loadFileContent(path) {
    const normPath = (window.ProjectPaths && typeof window.ProjectPaths.normalizeStoragePath === 'function')
      ? window.ProjectPaths.normalizeStoragePath(path)
      : path;

    const fileManager = window.serviceContainer?.get('fileManager');
    if (fileManager) {
      const obj = await fileManager.loadFile(normPath);
      if (obj) {
        return obj.content !== undefined ? obj.content
             : obj.fileContent !== undefined ? obj.fileContent
             : obj.data;
      }
    }

    if (window.fileIOService) {
      const obj = await window.fileIOService.loadFile(normPath);
      if (obj) {
        return obj.content !== undefined ? obj.content
             : obj.fileContent !== undefined ? obj.fileContent
             : obj.data;
      }
    }

    return null;
  }

  resolveResourcePath(texturePath, resourcePath) {
    if (!resourcePath) return '';
    if (resourcePath.includes('/Sources/')) return resourcePath;
    if (resourcePath.startsWith('Sources/')) {
      const marker = texturePath.lastIndexOf('/Sources/');
      if (marker >= 0) {
        return texturePath.substring(0, marker + 1) + resourcePath;
      }
    }

    const slash = texturePath.lastIndexOf('/');
    return slash >= 0 ? `${texturePath.substring(0, slash + 1)}${resourcePath}` : resourcePath;
  }

  isIndexedFormatEnum(fmtEnum) {
    return fmtEnum === D2_FORMAT.I8 ||
           fmtEnum === D2_FORMAT.I4 ||
           fmtEnum === D2_FORMAT.I2 ||
           fmtEnum === D2_FORMAT.I1 ||
           fmtEnum === D2_FORMAT.AI44;
  }

  getIndexedPaletteColorCount(fmtEnum) {
    switch (fmtEnum) {
      case D2_FORMAT.I8:
        return 256;
      case D2_FORMAT.I4:
      case D2_FORMAT.AI44:
        return 16;
      case D2_FORMAT.I2:
        return 4;
      case D2_FORMAT.I1:
        return 2;
      default:
        throw new Error(`Unsupported indexed format enum: ${fmtEnum}`);
    }
  }

  /**
   * Build a 32-byte header for .d2 files so firmware can parse dimensions.
   *
   * Offset  Size  Field
   * 0       4     Magic "D2TX"
   * 4       1     Version (1)
   * 5       1     Format enum (see formatToEnum)
   * 6       2     Width  (uint16 LE)
   * 8       2     Height (uint16 LE)
   * 10      2     Palette index (uint16 LE) — index into palette map (0 = none)
   * 12      1     Palette offset (uint8)
   * 13      1     Flags (bit 0 = RLE, bit 1 = pre-rotated 90° CW, bit 2 = color key)
   * 14      2     Color key (uint16 LE, RGB565) — valid when flag bit 2 set
   * 16      16    Reserved (future: animation frame count, etc.)
   */
  buildD2Header(width, height, format, paletteIndex, paletteOffset, flags = 0) {
    const buf = new ArrayBuffer(32);
    const view = new DataView(buf);

    // Magic "D2TX"
    view.setUint8(0, 0x44); // 'D'
    view.setUint8(1, 0x32); // '2'
    view.setUint8(2, 0x54); // 'T'
    view.setUint8(3, 0x58); // 'X'

    view.setUint8(4, 2); // version 2 (palette-index header)
    view.setUint8(5, this.formatToEnum(format));
    view.setUint16(6, width, true);   // LE
    view.setUint16(8, height, true);  // LE
    view.setUint16(10, paletteIndex, true); // palette map index
    view.setUint8(12, paletteOffset & 0xFF);
    view.setUint8(13, flags & 0xFF);
    // bytes 14-31 reserved (zero-filled by ArrayBuffer constructor)

    return new Uint8Array(buf);
  }

  /**
   * Map format string to a numeric enum for the firmware header.
   */
  formatToEnum(format) {
    const map = {
      'd2_mode_alpha8':   0x00,
      'd2_mode_rgb565':   0x01,
      'd2_mode_argb8888': 0x02,
      'd2_mode_argb4444': 0x03,
      'd2_mode_argb1555': 0x04,
      'd2_mode_ai44':     0x05,
      'd2_mode_rgba8888': 0x06,
      'd2_mode_rgba4444': 0x07,
      'd2_mode_rgba5551': 0x08,
      'd2_mode_i8':       0x09,
      'd2_mode_i4':       0x0A,
      'd2_mode_i2':       0x0B,
      'd2_mode_i1':       0x0C,
      'd2_mode_alpha4':   0x0D,
      'd2_mode_alpha2':   0x0E,
      'd2_mode_alpha1':   0x0F,
      'd2_mode_rgb888':   0x40,
      'd2_mode_rgb444':   0x41,
      'd2_mode_rgb555':   0x42,
    };
    if (map[format] === undefined) {
      throw new Error(`Unsupported texture format: ${format}`);
    }
    return map[format];
  }

  getColorDepthForFormat(format) {
    const map = {
      'd2_mode_alpha8': 8,
      'd2_mode_rgb565': 16,
      'd2_mode_argb8888': 32,
      'd2_mode_argb4444': 16,
      'd2_mode_argb1555': 16,
      'd2_mode_ai44': 8,
      'd2_mode_rgba8888': 32,
      'd2_mode_rgba4444': 16,
      'd2_mode_rgba5551': 16,
      'd2_mode_i8': 8,
      'd2_mode_i4': 4,
      'd2_mode_i2': 2,
      'd2_mode_i1': 1,
      'd2_mode_alpha4': 4,
      'd2_mode_alpha2': 2,
      'd2_mode_alpha1': 1,
      'd2_mode_rgb888': 24,
      'd2_mode_rgb444': 12,
      'd2_mode_rgb555': 15,
    };
    if (map[format] === undefined) {
      throw new Error(`Unsupported texture format: ${format}`);
    }
    return map[format];
  }

  getBaseName(path) {
    const name = path.split('/').pop() || path;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.substring(0, dot) : name;
  }

  concatBuffers(a, b) {
    const aBytes = a instanceof Uint8Array ? a : new Uint8Array(a);
    const bBytes = b instanceof Uint8Array ? b : new Uint8Array(b);
    const result = new Uint8Array(aBytes.length + bBytes.length);
    result.set(aBytes, 0);
    result.set(bBytes, aBytes.length);
    return result.buffer;
  }

  // ── Static palette registry ───────────────────────────────────────
  // During a build, every palette used by a texture is registered here.
  // After all textures are built, buildPaletteMap() serialises the
  // registry into a binary palette map file (PMAP).

  /**
   * Reset the palette registry (call at the start of each build).
   */
  static resetPaletteRegistry() {
    TextureBuilder._paletteEntries = [];   // [{key, colors}]
    TextureBuilder._paletteKeyToIndex = new Map();
    console.log('[TextureBuilder] Palette registry reset');
  }

  /**
   * Get (or create) a 1-based palette index for the given palette key.
   * @param {string} key   — usually the Sources/Palettes/… path
   * @param {string[]} colors — hex color array ('#RRGGBB')
   * @returns {number} 1-based palette index (0 means "no palette")
   */
  static getPaletteIndex(key, colors) {
    if (!TextureBuilder._paletteKeyToIndex) TextureBuilder.resetPaletteRegistry();

    const map = TextureBuilder._paletteKeyToIndex;
    if (map.has(key)) return map.get(key);

    const idx = TextureBuilder._paletteEntries.length + 1; // 1-based
    TextureBuilder._paletteEntries.push({ key, colors: [...colors] });
    map.set(key, idx);
    return idx;
  }

  /**
   * Build a binary palette map (PMAP) from the current registry.
   *
   * Format
   * ------
   * Offset  Size  Description
   * 0       4     Magic "PMAP"
   * 4       1     Version (1)
   * 5       1     Reserved
   * 6       2     Palette count (uint16 LE)
   *
   * For each palette (sequential, 1-based index):
   *   +0     2    Color count (uint16 LE)
   *   +2     N×4  Colors as RGBA32 (R, G, B, 0xFF)
   *
   * @returns {{buffer: ArrayBuffer, entries: Array}} the binary map and metadata
   */
  static buildPaletteMap() {
    const entries = TextureBuilder._paletteEntries || [];

    // Calculate total size: 8-byte header + per-palette (2 + colors×4)
    let dataSize = 8;
    for (const e of entries) {
      dataSize += 2 + e.colors.length * 4;
    }

    const buf = new ArrayBuffer(dataSize);
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);

    // Header
    bytes[0] = 0x50; // 'P'
    bytes[1] = 0x4D; // 'M'
    bytes[2] = 0x41; // 'A'
    bytes[3] = 0x50; // 'P'
    view.setUint8(4, 1);                     // version
    view.setUint8(5, 0);                     // reserved
    view.setUint16(6, entries.length, true);  // count

    let offset = 8;
    for (const e of entries) {
      view.setUint16(offset, e.colors.length, true);
      offset += 2;
      for (const hex of e.colors) {
        bytes[offset]     = parseInt(hex.substring(1, 3), 16) || 0; // R
        bytes[offset + 1] = parseInt(hex.substring(3, 5), 16) || 0; // G
        bytes[offset + 2] = parseInt(hex.substring(5, 7), 16) || 0; // B
        bytes[offset + 3] = 255;                                     // A
        offset += 4;
      }
    }

    console.log(`[TextureBuilder] Built palette map: ${entries.length} palettes, ${dataSize} bytes`);
    return {
      buffer: buf,
      entries: entries.map((e, i) => ({ index: i + 1, key: e.key, colorCount: e.colors.length }))
    };
  }
}

console.log('[TextureBuilder] Class defined');

// Self-register with the build system once it exists.
// serviceContainer.get() throws if the service hasn't been registerService()'d yet,
// so we must guard with has() or try-catch.
(function registerTextureBuilder() {
  function tryRegister() {
    try {
      if (!window.serviceContainer || !window.serviceContainer.has('buildSystem')) {
        return false;
      }
      const buildSystem = window.serviceContainer.get('buildSystem');
      if (buildSystem) {
        const tb = new TextureBuilder();
        buildSystem.registerBuilder('.texture', tb);
        buildSystem.builderById.set('texture', tb);
        console.log('[TextureBuilder] Registered with BuildSystem');
        return true;
      }
    } catch (e) {
      // Service not available yet — will retry
    }
    return false;
  }

  // Try immediately (in case build system already exists)
  if (tryRegister()) return;

  // Listen for the service container event (most reliable)
  if (window.serviceContainer) {
    window.serviceContainer.addEventListener('buildSystemReady', () => {
      tryRegister();
    });
  }

  // Also poll as fallback in case the event already fired
  let attempts = 0;
  const interval = setInterval(() => {
    if (tryRegister() || ++attempts > 100) {
      clearInterval(interval);
      if (attempts > 100) {
        console.warn('[TextureBuilder] Gave up waiting for BuildSystem after 20s');
      }
    }
  }, 200);
})();
