// font-builder.js
// Build-time font processor: reads .font metadata and emits runtime .d2 + .fnt
// assets by rendering the font atlas and passing it through the shared D2File
// texture generator.

console.log('[FontBuilder] Class definition loading');

class FontBuilder extends BaseBuilder {
  /**
   * Build a .font file into .d2 + .fnt outputs for the target device.
   *
   * A .font file is JSON metadata. There are two flavours.
   *
   * TrueType (the FontEditor's output, and the default when "source" is absent):
   * {
   *   "type": "retrowatch-font",
   *   "sourceFontPath": "...",
   *   "fontFamily": "...",
   *   "fontSize": 32,
   *   "outputPixelFormat": "d2_mode_alpha8",
   *   ...
   * }
   *
   * Bitmap, for pixel fonts that cannot survive being rasterised from an
   * outline. A 3x5 glyph rendered from a TTF at 5px lands wherever the
   * hinter puts it and picks up antialiasing; the whole point of a pixel font
   * is that the author placed every pixel. So the atlas is authored directly
   * and the build only has to package it:
   * {
   *   "type": "retrowatch-font",
   *   "source": "bitmap",
   *   "sourceAtlasPath": "Sources/Fonts/pico8_font.png",
   *   "outputPixelFormat": "d2_mode_alpha8",
   *   "lineHeight": 6,
   *   "base": 5,
   *   "atlas": { "columns": 16, "cellWidth": 8, "cellHeight": 6, "firstCode": 32 },
   *   "ranges": [ { "first": 32, "last": 127, "width": 3, "height": 5, "xadvance": 4 } ]
   * }
   *
   * Both flavours converge on the same .d2 payload and the same BMFont .fnt
   * writer, so the firmware sees one font format either way.
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
    if (typeof D2File === 'undefined' || typeof D2File.buildFromRGBA !== 'function') {
      throw new Error('D2File.buildFromRGBA is not available; cannot generate .d2 during build');
    }
    if (!fontJson || fontJson.type !== 'retrowatch-font') {
      throw new Error('Invalid .font metadata; expected retrowatch-font JSON');
    }

    // A pixel font ships its own atlas; there is no outline to rasterise.
    if (String(fontJson.source || '').toLowerCase() === 'bitmap') {
      return this._generateOutputsFromAtlas(fontJson, basePath);
    }

    if (typeof FontAtlasGenerator === 'undefined') {
      throw new Error('FontAtlasGenerator is not available; cannot generate font atlas during build');
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

  /**
   * Package an authored pixel-font atlas: decode the PNG, convert it to a D2
   * texture, and describe the glyph grid as BMFont metrics.
   *
   * The .fnt is written by the same FontAtlasGenerator.toBMFontBinary() the
   * TrueType path uses, so both flavours produce byte-identical structure and
   * the firmware only ever learns one format.
   */
  async _generateOutputsFromAtlas(fontJson, basePath) {
    if (!fontJson.sourceAtlasPath) {
      throw new Error(`.font metadata is missing sourceAtlasPath: ${basePath}.font`);
    }
    if (typeof FontAtlasGenerator === 'undefined') {
      throw new Error('FontAtlasGenerator is not available; cannot write the .fnt during build');
    }

    const RWImageData = window.ImageData;
    if (!RWImageData || typeof RWImageData.fromFile !== 'function') {
      throw new Error('RetroStudio ImageData loader is not available; cannot decode the font atlas');
    }

    let atlasContent = null;
    let resolvedAtlasPath = null;
    for (const candidatePath of this._candidateSourceFontPaths(fontJson.sourceAtlasPath, basePath)) {
      atlasContent = await this._loadFileContent(candidatePath);
      if (atlasContent) {
        resolvedAtlasPath = candidatePath;
        break;
      }
    }

    if (!atlasContent) {
      throw new Error(`Font atlas not found: ${fontJson.sourceAtlasPath}`);
    }

    // ImageData.fromFile() only understands a base64/data-URL string or a plain
    // ArrayBuffer. Storage hands back whichever of those - or a typed array -
    // it happens to be holding, and a Uint8Array falls through its type check
    // as "Unsupported content type".
    let decodable = atlasContent;
    if (ArrayBuffer.isView(decodable)) {
      decodable = decodable.buffer.slice(
        decodable.byteOffset,
        decodable.byteOffset + decodable.byteLength
      );
    }

    const image = await RWImageData.fromFile(decodable, resolvedAtlasPath);
    const width = image.width;
    const height = image.height;
    const frame = image.frames?.[0];
    if (!frame || !frame.colors) {
      throw new Error(`Unable to decode font atlas pixels: ${resolvedAtlasPath}`);
    }

    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < frame.colors.length; index += 1) {
      const color = frame.colors[index];
      const offset = index * 4;
      rgba[offset] = color.r;
      rgba[offset + 1] = color.g;
      rgba[offset + 2] = color.b;
      rgba[offset + 3] = Math.round((color.alpha ?? 1) * 255);
    }

    const outputPixelFormat = fontJson.outputPixelFormat || 'd2_mode_alpha8';
    const d2Bytes = D2File.buildFromRGBA({
      outputPixelFormat,
      metadata: {
        outputPixelFormat,
        paletteOffset: 0,
      },
      rotation: 0,
      compressionType: 'none',
    }, rgba, width, height);

    const glyphs = this._expandAtlasGlyphs(fontJson, basePath, width, height);

    const result = {
      fontFamily: fontJson.fontFamily || basePath.split('/').pop(),
      // A pixel font has no point size; report the glyph height so anything
      // reading the .fnt info block sees a sane number.
      fontSize: fontJson.fontSize ?? (fontJson.base ?? 0),
      padding: fontJson.padding ?? 0,
      spacing: fontJson.spacing ?? 0,
      lineHeight: fontJson.lineHeight ?? height,
      base: fontJson.base ?? fontJson.lineHeight ?? height,
      width,
      height,
      glyphs,
    };

    const pageName = basePath.split('/').pop() + '.png';
    const fntBytes = new FontAtlasGenerator().toBMFontBinary(result, pageName);

    return { d2Bytes, fntBytes };
  }

  /**
   * Turn the compact {atlas grid} + {ranges} description into one BMFont char
   * record per code point.
   *
   * The grid is what makes this compact: cell N holds code `firstCode + N`, so
   * only the differing ink sizes need spelling out. PICO-8, for instance, is
   * two ranges - 3x5 narrow ASCII and 7x5 wide symbols - rather than 128
   * near-identical entries.
   */
  _expandAtlasGlyphs(fontJson, basePath, atlasWidth, atlasHeight) {
    const grid = fontJson.atlas;
    if (!grid) {
      throw new Error(`.font metadata is missing atlas grid: ${basePath}.font`);
    }

    const columns = Number(grid.columns);
    const cellWidth = Number(grid.cellWidth);
    const cellHeight = Number(grid.cellHeight);
    const firstCode = Number(grid.firstCode ?? 0);
    if (!(columns > 0) || !(cellWidth > 0) || !(cellHeight > 0)) {
      throw new Error(`.font atlas grid needs positive columns, cellWidth and cellHeight: ${basePath}.font`);
    }
    if (columns * cellWidth > atlasWidth) {
      throw new Error(
        `.font atlas grid is ${columns}x${cellWidth}px wide but the image is only ${atlasWidth}px: ${basePath}.font`
      );
    }

    const ranges = Array.isArray(fontJson.ranges) ? fontJson.ranges : [];
    if (ranges.length === 0) {
      throw new Error(`.font metadata is missing ranges: ${basePath}.font`);
    }

    const rowCount = Math.floor(atlasHeight / cellHeight);
    const capacity = columns * rowCount;
    const glyphs = [];
    const seen = new Set();

    for (const range of ranges) {
      const first = Number(range.first);
      const last = Number(range.last ?? range.first);
      const inkWidth = Number(range.width ?? cellWidth);
      const inkHeight = Number(range.height ?? cellHeight);
      const xadvance = Number(range.xadvance ?? inkWidth);

      for (let code = first; code <= last; code += 1) {
        const index = code - firstCode;
        if (index < 0 || index >= capacity) {
          throw new Error(
            `.font range covers code ${code}, which falls outside the ${columns}x${rowCount} atlas grid: ${basePath}.font`
          );
        }
        // Later ranges must not silently shadow earlier ones; a duplicate is
        // an authoring mistake that would otherwise emit two records for the
        // same code and let the consumer pick whichever it saw last.
        if (seen.has(code)) {
          throw new Error(`.font ranges cover code ${code} twice: ${basePath}.font`);
        }
        seen.add(code);

        glyphs.push({
          id: code,
          x: (index % columns) * cellWidth,
          y: Math.floor(index / columns) * cellHeight,
          width: inkWidth,
          height: inkHeight,
          xoffset: Number(range.xoffset ?? 0),
          yoffset: Number(range.yoffset ?? 0),
          xadvance,
          page: 0,
          chnl: 15,
        });
      }
    }

    if (glyphs.length === 0) {
      throw new Error(`.font ranges describe no glyphs: ${basePath}.font`);
    }

    return glyphs;
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
