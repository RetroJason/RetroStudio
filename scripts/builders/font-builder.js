// font-builder.js
// Build-time font processor: reads .font metadata and emits runtime .d2 + .fnt
// assets by rendering the font atlas and passing it through the shared D2File
// texture generator.

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
  * The FontEditor previews runtime outputs, but the build always regenerates
  * them from metadata so the D2 header and payload are produced by the
  * shared D2File generator.
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

      // ── 2. Generate runtime outputs through the shared texture path ─
      const generated = await this._generateOutputsFromMetadata(fontJson, basePath);
      const d2Bytes = generated.d2Bytes;
      const fntBytes = generated.fntBytes;
      console.log(`${tag} Generated runtime outputs from metadata for ${file.path}`);

      // Make a mutable copy for header patching
      const output = new Uint8Array(d2Bytes.length);
      output.set(d2Bytes);

      // ── 3. Save .d2 to build output ──────────────────────────────
      const d2OutputPath = this._toBuildOutputPath(basePath + '.d2');
      await this._saveFile(d2OutputPath, output);
      console.log(`${tag} ✓ Saved .d2: ${d2OutputPath} (${output.length} bytes)`);

      // ── 4. Save .fnt to build output ─────────────────────────────
      let fntSaved = false;
      let fntOutputPath = null;
      if (fntBytes) {
        fntOutputPath = this._toBuildOutputPath(basePath + '.fnt');
        await this._saveFile(fntOutputPath, fntBytes);
        fntSaved = true;
        console.log(`${tag} ✓ Saved .fnt: ${fntOutputPath} (${fntBytes.length} bytes)`);
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
          fntSaved,
          generatedFromSource: true,
          rotation: 0
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

  _candidateSourceFontPaths(sourceFontPath, owningBasePath) {
    const normalized = String(sourceFontPath || '').replace(/\\/g, '/');
    const candidates = [];
    const seen = new Set();
    const add = (p) => {
      if (!p || typeof p !== 'string') return;
      const key = p.replace(/\\/g, '/');
      if (!key || seen.has(key)) return;
      seen.add(key);
      candidates.push(key);
    };

    add(normalized);

    if (window.ProjectPaths) {
      if (typeof window.ProjectPaths.toProjectRelative === 'function') {
        add(window.ProjectPaths.toProjectRelative(normalized));
      }

      if (typeof window.ProjectPaths.rebaseManagedPath === 'function') {
        const owningPath = `${owningBasePath}.font`;
        add(window.ProjectPaths.rebaseManagedPath(normalized, owningPath));
      }
    }

    return candidates;
  }

  async _generateOutputsFromMetadata(fontJson, basePath) {
    if (typeof FontAtlasGenerator === 'undefined') {
      throw new Error('FontAtlasGenerator is not available; cannot generate font atlas during build');
    }
    if (typeof D2File === 'undefined' || typeof D2File.buildFromRGBA !== 'function') {
      throw new Error('D2File.buildFromRGBA is not available; cannot generate .d2 during build');
    }
    if (!fontJson || fontJson.type !== 'retrowatch-font') {
      throw new Error('Invalid .font metadata; expected retrowatch-font JSON');
    }
    if (!fontJson.sourceFontPath) {
      throw new Error(`.font metadata is missing sourceFontPath: ${basePath}.font`);
    }
    if (!fontJson.fontFamily) {
      throw new Error(`.font metadata is missing fontFamily: ${basePath}.font`);
    }
    if (!fontJson.characters) {
      throw new Error(`.font metadata is missing characters: ${basePath}.font`);
    }

    let sourceFontBytes = null;
    const candidatePaths = this._candidateSourceFontPaths(fontJson.sourceFontPath, basePath);
    for (const candidatePath of candidatePaths) {
      const sourceFontContent = await this._loadFileContent(candidatePath);
      sourceFontBytes = this._toUint8Array(sourceFontContent);
      if (sourceFontBytes && sourceFontBytes.length > 0) {
        break;
      }
    }

    if (!sourceFontBytes || sourceFontBytes.length === 0) {
      throw new Error(`Source font not found: ${fontJson.sourceFontPath}`);
    }

    const generator = new FontAtlasGenerator();
    const fontBuffer = sourceFontBytes.buffer.slice(
      sourceFontBytes.byteOffset,
      sourceFontBytes.byteOffset + sourceFontBytes.byteLength
    );

    await generator.loadFont(fontBuffer, fontJson.fontFamily);

    const result = generator.generate({
      fontFamily: fontJson.fontFamily,
      fontSize: fontJson.fontSize,
      chars: fontJson.characters,
      padding: fontJson.padding ?? 0,
      spacing: fontJson.spacing ?? 0,
      antialiasing: !!fontJson.antialias,
    });

    if (!result?.canvas) {
      throw new Error(`Font atlas generation failed for ${basePath}.font`);
    }

    const rgba = result.canvas.getContext('2d').getImageData(0, 0, result.width, result.height).data;
    const outputPixelFormat = fontJson.outputPixelFormat || 'd2_mode_alpha8';
    const d2Bytes = D2File.buildFromRGBA({
      outputPixelFormat,
      metadata: {
        outputPixelFormat,
        paletteOffset: 0,
      },
      rotation: 0,
      compressionType: 'none',
    }, rgba, result.width, result.height);

    const pageName = basePath.split('/').pop() + '.png';
    const fntBytes = generator.toBMFontBinary(result, pageName);

    return { d2Bytes, fntBytes };
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
