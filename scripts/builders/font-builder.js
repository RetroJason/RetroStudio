// font-builder.js
// Build-time font processor: reads .font metadata, copies the pre-built .d2
// (with header patching) and .fnt BMFont binary to build output.

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
   *   "outputPixelFormat": "d2_mode_alpha8",
   *   ...
   * }
   *
   * The FontEditor already creates companion files alongside the .font:
   *   name.d2   — D2TX atlas texture
   *   name.fnt  — BMFont binary glyph data
   *   name.png  — source atlas image (not needed in build output)
   *
   * This builder loads and patches the .d2 header, then copies both .d2 and
   * .fnt to the build output directory.
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

      // ── 2. Load the source .d2 ───────────────────────────────────
      const sourceD2Path = basePath + '.d2';
      const sourceD2Content = await this._loadFileContent(sourceD2Path);
      if (!sourceD2Content) {
        throw new Error(`Source .d2 not found: ${sourceD2Path} — open in Font Editor and generate atlas first`);
      }

      let d2Bytes = this._toUint8Array(sourceD2Content);
      if (!d2Bytes || d2Bytes.length < 32 ||
          d2Bytes[0] !== 0x44 || d2Bytes[1] !== 0x32 ||
          d2Bytes[2] !== 0x54 || d2Bytes[3] !== 0x58) {
        throw new Error(`Invalid D2TX magic in source .d2: ${sourceD2Path}`);
      }

      console.log(`${tag} Loaded source .d2: ${d2Bytes.length} bytes from ${sourceD2Path}`);

      // Make a mutable copy for header patching
      const output = new Uint8Array(d2Bytes.length);
      output.set(d2Bytes);

      // ── 3. Save .d2 to build output ──────────────────────────────
      const d2OutputPath = this._toBuildOutputPath(basePath + '.d2');
      await this._saveFile(d2OutputPath, output);
      console.log(`${tag} ✓ Saved .d2: ${d2OutputPath} (${output.length} bytes)`);

      // ── 4. Copy .fnt to build output ─────────────────────────────
      const sourceFntPath = basePath + '.fnt';
      const fntContent = await this._loadFileContent(sourceFntPath);
      let fntSaved = false;
      let fntOutputPath = null;
      if (fntContent) {
        const fntBytes = this._toUint8Array(fntContent);
        if (fntBytes) {
          fntOutputPath = this._toBuildOutputPath(basePath + '.fnt');
          await this._saveFile(fntOutputPath, fntBytes);
          fntSaved = true;
          console.log(`${tag} ✓ Saved .fnt: ${fntOutputPath} (${fntBytes.length} bytes)`);
        }
      }
      if (!fntSaved) {
        console.warn(`${tag} .fnt not found at ${sourceFntPath} — skipping`);
      }

      const headerView = new DataView(output.buffer, output.byteOffset, output.byteLength);
      const hWidth = headerView.getUint16(6, true);
      const hHeight = headerView.getUint16(8, true);

      return {
        success: true,
        inputPath: file.path,
        outputPath: d2OutputPath,
        additionalOutputPaths: fntOutputPath ? [fntOutputPath] : [],
        builder: 'font',
        meta: {
          width: hWidth,
          height: hHeight,
          format: fontJson.outputPixelFormat || 'd2_mode_alpha8',
          binarySize: output.length - 32,
          fntSaved
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
