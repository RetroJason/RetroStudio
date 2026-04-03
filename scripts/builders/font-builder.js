// font-builder.js
// Build-time font processor: reads .font metadata, loads the source TTF,
// generates the atlas (.d2 + .fnt) if needed, and copies to build output.

console.log('[FontBuilder] Class definition loading');

class FontBuilder extends BaseBuilder {
  /**
   * Build a .font file into .d2 + .fnt outputs for the target device.
   *
   * A .font file is JSON metadata created by the FontEditor:
   * {
   *   "type": "retrowatch-font",
   *   "sourceFontPath": "...",
   *   "fontFamily": "...",
   *   "fontSize": 32,
   *   "characters": "...",
   *   "outputPixelFormat": "d2_mode_alpha8",
   *   ...
   * }
   *
   * The builder first tries to use pre-generated companion files (name.d2,
   * name.fnt).  If those are missing it falls back to loading the source
   * TTF and regenerating the atlas via FontAtlasGenerator at build time.
   */
  async build(file) {
    const tag = '[FontBuilder]';
    try {
      console.log(`${tag} Processing: ${file.path}`);

      // ── 1. Parse the .font JSON ──────────────────────────────────
      let fontJson;
      if (typeof file.content === 'string') {
        fontJson = JSON.parse(file.content);
      } else if (file.content instanceof ArrayBuffer || ArrayBuffer.isView(file.content)) {
        const bytes = file.content instanceof ArrayBuffer
          ? new Uint8Array(file.content)
          : new Uint8Array(file.content.buffer, file.content.byteOffset, file.content.byteLength);
        fontJson = JSON.parse(new TextDecoder('utf-8').decode(bytes));
      } else {
        throw new Error('Unexpected .font content type');
      }

      const basePath = file.path.replace(/\.font$/i, '');

      // ── 2. Try pre-generated .d2 first ───────────────────────────
      const sourceD2Path = basePath + '.d2';
      let sourceD2Content = await this._loadFileContent(sourceD2Path);

      let d2Bytes;
      let fntBytes;

      if (sourceD2Content) {
        d2Bytes = this._toUint8Array(sourceD2Content);
        if (!d2Bytes || d2Bytes.length < 32 ||
            d2Bytes[0] !== 0x44 || d2Bytes[1] !== 0x32 ||
            d2Bytes[2] !== 0x54 || d2Bytes[3] !== 0x58) {
          console.warn(`${tag} Invalid D2TX in ${sourceD2Path}, will regenerate`);
          d2Bytes = null;
        } else {
          console.log(`${tag} Using pre-generated .d2: ${d2Bytes.length} bytes`);
        }

        // Also grab pre-generated .fnt
        const sourceFntPath = basePath + '.fnt';
        const fntContent = await this._loadFileContent(sourceFntPath);
        if (fntContent) {
          fntBytes = this._toUint8Array(fntContent);
        }
      }

      // ── 3. If no pre-generated files, generate from source TTF ───
      if (!d2Bytes) {
        console.log(`${tag} No pre-generated .d2 found, generating from source TTF...`);
        const generated = await this._generateFromSource(fontJson, basePath);
        d2Bytes = generated.d2Bytes;
        fntBytes = generated.fntBytes;
      }

      // ── 4. Embed .d2 as block type 6 in the .fnt ────────────────
      // The firmware Font parser reads block 6 as the embedded texture,
      // so the .d2 is not saved separately to build output.
      if (fntBytes && d2Bytes) {
        const block6Header = 5; // 1 byte type + 4 bytes size
        const combined = new Uint8Array(fntBytes.length + block6Header + d2Bytes.length);
        combined.set(fntBytes, 0);
        // Block type 6
        combined[fntBytes.length] = 6;
        // Block size (little-endian uint32)
        const sizeOffset = fntBytes.length + 1;
        combined[sizeOffset]     =  d2Bytes.length        & 0xFF;
        combined[sizeOffset + 1] = (d2Bytes.length >> 8)  & 0xFF;
        combined[sizeOffset + 2] = (d2Bytes.length >> 16) & 0xFF;
        combined[sizeOffset + 3] = (d2Bytes.length >> 24) & 0xFF;
        combined.set(d2Bytes, fntBytes.length + block6Header);
        fntBytes = combined;
        console.log(`${tag} Embedded .d2 (${d2Bytes.length} bytes) as block 6 in .fnt`);
      }

      // ── 5. Save .fnt to build output ─────────────────────────────
      let fntOutputPath = null;
      if (fntBytes) {
        fntOutputPath = this._toBuildOutputPath(basePath + '.fnt');
        await this._saveFile(fntOutputPath, fntBytes);
        console.log(`${tag} ✓ Saved .fnt: ${fntOutputPath} (${fntBytes.length} bytes)`);
      } else {
        console.warn(`${tag} No .fnt data available for ${file.path}`);
      }

      const d2View = new DataView(d2Bytes.buffer, d2Bytes.byteOffset, d2Bytes.byteLength);
      const hWidth = d2View.getUint16(6, true);
      const hHeight = d2View.getUint16(8, true);

      return {
        success: true,
        inputPath: file.path,
        outputPath: fntOutputPath,
        additionalOutputPaths: [],
        builder: 'font',
        meta: {
          width: hWidth,
          height: hHeight,
          format: fontJson.outputPixelFormat || 'd2_mode_alpha8',
          binarySize: d2Bytes.length - 32,
          fntSaved: !!fntOutputPath
        }
      };

    } catch (error) {
      console.error(`${tag} ✗ ${file.path}: ${error.message}`);
      return {
        success: false,
        inputPath: file.path,
        error: error.message,
        builder: 'font'
      };
    }
  }

  // ── Generate .d2 + .fnt from source TTF at build time ───────────

  async _generateFromSource(fontJson, basePath) {
    const tag = '[FontBuilder]';

    // Load the source TTF
    const ttfPath = fontJson.sourceFontPath;
    if (!ttfPath) {
      throw new Error('No sourceFontPath in .font metadata — open in Font Editor and save first');
    }

    const ttfContent = await this._loadFileContent(ttfPath);
    let ttfBuffer;
    if (!ttfContent) {
      // Try same folder as the .font file
      const folder = basePath.substring(0, basePath.lastIndexOf('/'));
      const ttfName = ttfPath.split('/').pop();
      const altPath = folder ? `${folder}/${ttfName}` : ttfName;
      const altContent = await this._loadFileContent(altPath);
      if (!altContent) {
        throw new Error(`Source TTF not found: ${ttfPath} (also tried ${altPath})`);
      }
      ttfBuffer = this._toArrayBuffer(altContent);
    } else {
      ttfBuffer = this._toArrayBuffer(ttfContent);
    }

    if (!ttfBuffer) {
      throw new Error(`Failed to convert TTF content to ArrayBuffer`);
    }

    console.log(`${tag} Loaded source TTF: ${ttfBuffer.byteLength} bytes`);

    // Generate atlas using FontAtlasGenerator
    if (typeof FontAtlasGenerator === 'undefined') {
      throw new Error('FontAtlasGenerator not available — cannot generate atlas at build time');
    }

    const gen = new FontAtlasGenerator();
    const family = fontJson.fontFamily || 'build_font_' + Date.now();
    await gen.loadFont(ttfBuffer, family);

    const result = gen.generate({
      fontFamily:   family,
      fontSize:     fontJson.fontSize || 32,
      chars:        fontJson.characters || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,;:!?\'"()-+*/=',
      padding:      fontJson.padding ?? 1,
      spacing:      fontJson.spacing ?? 1,
      antialiasing: !!fontJson.antialias,
    });

    console.log(`${tag} Generated atlas: ${result.width}×${result.height}, ${result.glyphs.length} glyphs`);

    // Build .fnt binary
    const base = basePath.split('/').pop();
    const fntBytes = gen.toBMFontBinary(result, `${base}.png`);

    // Build .d2 binary
    if (typeof D2File === 'undefined' || typeof FORMAT_STRING_TO_ENUM === 'undefined' || typeof buildD2TX === 'undefined') {
      throw new Error('D2File/buildD2TX not available — cannot generate .d2 at build time');
    }

    const format = fontJson.outputPixelFormat || 'd2_mode_alpha8';
    const ctx = result.canvas.getContext('2d');
    const origW = result.canvas.width, origH = result.canvas.height;
    const rgba = ctx.getImageData(0, 0, origW, origH).data;

    // Pre-rotate 90° CW so texture matches Dave2D scan order
    const rotated = new Uint8Array(origW * origH * 4);
    for (let y = 0; y < origH; y++)
      for (let x = 0; x < origW; x++) {
        const s = (y * origW + x) * 4, d = (x * origH + (origH - 1 - y)) * 4;
        rotated[d] = rgba[s]; rotated[d+1] = rgba[s+1]; rotated[d+2] = rgba[s+2]; rotated[d+3] = rgba[s+3];
      }

    const formatBytes = D2File.convertRGBAToFormat(rotated, format);
    const fmtEnum = FORMAT_STRING_TO_ENUM[format] || D2_FORMAT.ALPHA8;
    const d2Bytes = buildD2TX(origH, origW, fmtEnum, formatBytes, {
      paletteOffset: 0,
      preRotated: true
    });

    console.log(`${tag} Generated .d2: ${d2Bytes.length} bytes, .fnt: ${fntBytes.length} bytes`);

    // Also persist companions back to source folder so they exist for next build
    const folder = basePath.substring(0, basePath.lastIndexOf('/'));
    const savePath = (p, data) => {
      const norm = window.ProjectPaths?.normalizeStoragePath?.(p) || p;
      return window.fileIOService?.saveFile(norm, data, { binaryData: true });
    };
    try {
      await savePath(basePath + '.d2', d2Bytes);
      await savePath(basePath + '.fnt', fntBytes);
      console.log(`${tag} Persisted generated companions to source folder`);
    } catch (e) {
      console.warn(`${tag} Could not persist companions: ${e.message}`);
    }

    return { d2Bytes: new Uint8Array(d2Bytes), fntBytes: new Uint8Array(fntBytes) };
  }

  _toArrayBuffer(raw) {
    if (raw instanceof ArrayBuffer) return raw;
    if (raw instanceof Uint8Array) return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    if (ArrayBuffer.isView(raw)) return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    if (typeof raw === 'string') {
      try {
        const bin = atob(raw);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
      } catch (_) { /* not base64 */ }
    }
    return null;
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  async _loadFileContent(path) {
    const normPath = (window.ProjectPaths && typeof window.ProjectPaths.normalizeStoragePath === 'function')
      ? window.ProjectPaths.normalizeStoragePath(path)
      : path;

    const fileManager = window.serviceContainer?.get('fileManager');
    if (fileManager) {
      const obj = await fileManager.loadFile(normPath);
      if (obj) return obj.content ?? obj.fileContent ?? obj.data ?? null;
    }

    const fileService = window.fileIOService;
    if (fileService) {
      const obj = await fileService.loadFile(normPath);
      if (obj) return obj.content ?? obj.fileContent ?? obj.data ?? null;
    }

    return null;
  }

  _toUint8Array(raw) {
    if (raw instanceof Uint8Array) return raw;
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
    if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (typeof raw === 'string') {
      try {
        const bin = atob(raw);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      } catch (_) { /* not base64 */ }
    }
    return null;
  }

  _toBuildOutputPath(path) {
    return (window.ProjectPaths && typeof window.ProjectPaths.toBuildOutputPath === 'function')
      ? window.ProjectPaths.toBuildOutputPath(path)
      : path.replace(/^Resources\//, 'build/');
  }

  async _saveFile(path, data) {
    const fileManager = window.serviceContainer?.get('fileManager');
    if (fileManager) {
      await fileManager.saveFile(path, data.buffer || data, { binaryData: true });
    } else if (window.fileIOService) {
      await window.fileIOService.saveFile(path, data.buffer || data, { binaryData: true });
    } else {
      throw new Error('No file service available to save build output');
    }
  }
}

console.log('[FontBuilder] Class defined');

// Self-register with the build system once it exists.
(function registerFontBuilder() {
  function tryRegister() {
    try {
      if (!window.serviceContainer || !window.serviceContainer.has('buildSystem')) {
        return false;
      }
      const buildSystem = window.serviceContainer.get('buildSystem');
      if (buildSystem) {
        const fb = new FontBuilder();
        buildSystem.registerBuilder('.font', fb);
        buildSystem.builderById.set('font', fb);
        console.log('[FontBuilder] Registered with BuildSystem');
        return true;
      }
    } catch (e) {
      // Service not available yet — will retry
    }
    return false;
  }

  if (tryRegister()) return;

  if (window.serviceContainer) {
    window.serviceContainer.addEventListener('buildSystemReady', () => {
      tryRegister();
    });
  }

  let attempts = 0;
  const interval = setInterval(() => {
    if (tryRegister() || ++attempts > 100) {
      clearInterval(interval);
      if (attempts > 100) {
        console.warn('[FontBuilder] Gave up waiting for BuildSystem after 20s');
      }
    }
  }, 200);
})();
