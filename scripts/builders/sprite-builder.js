// sprite-builder.js
// Build-time sprite processor: reads .sprite JSON metadata, emits
// .d2f (frame atlas) and .d2s (sprite/animation) binaries.
//
// Follows the same pattern as TextureBuilder:
//   1. Parse the .sprite JSON (saved by SpriteEditor)
//   2. Resolve texture index from the companion .texture/.d2 file
//   3. Build .d2f + .d2s via D2Sprite library
//   4. Save both to the build directory
//
// Dependencies: d2-sprite.js (D2Sprite.buildD2F, D2Sprite.buildD2S)

console.log('[SpriteBuilder] Class definition loading');

class SpriteBuilder extends BaseBuilder {

  /**
   * Build a .sprite file into .d2f + .d2s binaries.
   *
   * @param {object} file  { name, path, content, size }
   * @returns {object}     { success, inputPath, outputPath, outputs[], ... }
   */
  async build(file) {
    const tag = '[SpriteBuilder]';
    try {
      console.log(`${tag} Processing: ${file.path}`);

      // ── 1. Parse the .sprite JSON ─────────────────────────────────
      const spriteData = await this._normalizeSpriteData(this._parseSpriteJson(file.content));
      const spriteName = spriteData.name || this._baseName(file.path);

      console.log(`${tag} Sprite "${spriteName}": ${(spriteData.frames || []).length} frames, ${(spriteData.animations || []).length} animations`);

      if (!spriteData.frames || spriteData.frames.length === 0) {
        throw new Error('Sprite has no frames — open in Sprite Editor and slice frames first');
      }

      // ── 2. Resolve texture metadata ───────────────────────────────
      const textureOutputPath = this._resolveSpriteTextureOutputPath(spriteData);
      const textureIndex = this._resolveTextureIndex(textureOutputPath);
      const textureHeader = await this._loadD2TextureHeader(textureOutputPath);

      // ── 3. Build .d2f (frame atlas) ───────────────────────────────
      const d2fBytes = D2Sprite.buildD2F(spriteData, {
        textureIndex,
        paletteSlot: textureHeader.paletteIndex,
        paletteOffset: textureHeader.paletteOffset,
      });
      console.log(`${tag} Built .d2f: ${d2fBytes.length} bytes (${spriteData.frames.length} frames)`);

      // ── 4. Build .d2s (sprite/animation) ──────────────────────────
      const d2sBytes = D2Sprite.buildD2S(spriteData, {
        frameAtlasIndex: 0, // always 0 for now (1:1 sprite–atlas)
      });
      console.log(`${tag} Built .d2s: ${d2sBytes.length} bytes (${spriteData.animations.length} animations)`);

      // ── 5. Save both to build directory ───────────────────────────
      const baseOutputPath = file.path.replace(/\.sprite$/i, '');
      const d2fOutputPath = this._toBuildPath(baseOutputPath + '.d2f');
      const d2sOutputPath = this._toBuildPath(baseOutputPath + '.d2s');

      await this._saveBinary(d2fOutputPath, d2fBytes);
      await this._saveBinary(d2sOutputPath, d2sBytes);

      console.log(`${tag} ✓ ${file.path} → ${d2fOutputPath} (${d2fBytes.length}B) + ${d2sOutputPath} (${d2sBytes.length}B)`);

      // Add .d2s to project explorer as the primary output
      // (.d2f is a companion file added alongside)
      try {
        await this._addBuildFile(d2fOutputPath);
        await this._addBuildFile(d2sOutputPath);
      } catch (e) {
        console.warn(`${tag} Could not add build files to explorer: ${e.message}`);
      }

      return {
        success: true,
        inputPath: file.path,
        outputPath: d2sOutputPath,   // primary output
        outputs: [d2fOutputPath, d2sOutputPath],
        builder: 'sprite',
        meta: {
          name: spriteName,
          frameCount: spriteData.frames.length,
          animCount: spriteData.animations.length,
          d2fSize: d2fBytes.length,
          d2sSize: d2sBytes.length,
          textureIndex,
        },
      };

    } catch (error) {
      console.error(`${tag} ✗ ${file.path}: ${error.message}`);
      return {
        success: false,
        inputPath: file.path,
        error: error.message,
        builder: 'sprite',
      };
    }
  }

  /* ────────────────────────────────────────────────────────────────────
     Helpers
     ──────────────────────────────────────────────────────────────────── */

  _parseSpriteJson(content) {
    if (typeof content === 'string') {
      try {
        return JSON.parse(content);
      } catch (e) {
        throw new Error(`Invalid .sprite JSON: ${e.message}`);
      }
    }
    if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
      const bytes = content instanceof ArrayBuffer
        ? new Uint8Array(content)
        : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
      const text = new TextDecoder('utf-8').decode(bytes);
      return JSON.parse(text);
    }
    throw new Error('Unexpected .sprite content type');
  }

  async _normalizeSpriteData(spriteData) {
    const normalized = { ...(spriteData || {}) };
    const framesetRefs = Array.isArray(normalized.framesets) ? normalized.framesets : [];
    if (framesetRefs.length === 0) {
      throw new Error('Sprite must reference at least one .frameset file');
    }

    const mergedFrames = [];
    let firstFramesetImagePath = null;

    for (let fsIdx = 0; fsIdx < framesetRefs.length; fsIdx++) {
      const fsRef = framesetRefs[fsIdx] || {};
      const fsPath = fsRef.path;
      if (!fsPath || typeof fsPath !== 'string') {
        throw new Error(`Frameset reference #${fsIdx} is missing a path`);
      }

      const fsData = await this._loadJsonFile(fsPath);
      const fsFrames = Array.isArray(fsData.frames) ? fsData.frames : [];
      if (fsFrames.length === 0) {
        throw new Error(`Frameset has no frames: ${fsPath}`);
      }

      const fsImagePath = typeof fsData.imagePath === 'string' ? fsData.imagePath : '';
      if (!fsImagePath) {
        throw new Error(`Frameset is missing imagePath: ${fsPath}`);
      }
      const resolvedFsImagePath = this._resolveResourcePath(fsPath, fsImagePath);
      if (firstFramesetImagePath === null) {
        firstFramesetImagePath = resolvedFsImagePath;
      } else if (resolvedFsImagePath !== firstFramesetImagePath) {
        throw new Error('Sprite uses framesets from different source images, which is not supported by current D2 sprite build');
      }

      for (const f of fsFrames) {
        const localId = f?.id;
        if (localId === undefined || localId === null || localId === '') {
          throw new Error(`Frameset frame is missing id in ${fsPath}`);
        }
        const mergedId = `${fsIdx}:${localId}`;
        const w = Number(f?.w) || 0;
        const h = Number(f?.h) || 0;
        if (w <= 0 || h <= 0) {
          throw new Error(`Frameset frame ${mergedId} in ${fsPath} has invalid size ${w}x${h}`);
        }
        mergedFrames.push({
          id: mergedId,
          name: f?.name || `frame_${mergedId}`,
          x: Number(f?.x) || 0,
          y: Number(f?.y) || 0,
          w,
          h,
        });
      }
    }

    normalized.sourceImagePath = firstFramesetImagePath;

    const validFrameIds = new Set(mergedFrames.map(frame => frame.id));

    // Frame IDs must already be frameset keys in the format "fsIdx:localId".
    normalized.animations = (Array.isArray(normalized.animations) ? normalized.animations : []).map(anim => {
      const frameIds = Array.isArray(anim?.frameIds) ? anim.frameIds : [];
      for (const fid of frameIds) {
        if (typeof fid !== 'string' || !fid.includes(':')) {
          throw new Error(`Sprite animation "${anim?.name || '(unnamed)'}" contains non-frameset frame ID "${fid}"; regenerate animation frames in Sprite Editor`);
        }
        if (!validFrameIds.has(fid)) {
          throw new Error(`Sprite animation "${anim?.name || '(unnamed)'}" references unknown frame "${fid}"`);
        }
      }
      return {
        ...anim,
        frameIds,
      };
    });

    normalized.frames = mergedFrames;

    return normalized;
  }

  async _loadJsonFile(path) {
    const fileManager = window.serviceContainer?.get('fileManager');
    const storagePath = window.ProjectPaths?.normalizeStoragePath
      ? window.ProjectPaths.normalizeStoragePath(path)
      : path;

    let raw = null;
    if (fileManager) {
      raw = await fileManager.loadFile(storagePath);
      raw = raw?.content ?? raw?.fileContent ?? raw?.data ?? raw;
    } else if (window.fileIOService) {
      raw = await window.fileIOService.loadFile(storagePath);
      raw = raw?.content ?? raw?.fileContent ?? raw?.data ?? raw;
    } else {
      throw new Error('No file service available to load frameset data');
    }

    const parsed = this._parseSpriteJson(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`Invalid JSON data at ${path}`);
    }
    return parsed;
  }

  async _loadBinaryFile(path) {
    const fileManager = window.serviceContainer?.get('fileManager');
    const storagePath = window.ProjectPaths?.normalizeStoragePath
      ? window.ProjectPaths.normalizeStoragePath(path)
      : path;

    let raw = null;
    if (fileManager) {
      raw = await fileManager.loadFile(storagePath);
      raw = raw?.content ?? raw?.fileContent ?? raw?.data ?? raw;
    } else if (window.fileIOService) {
      raw = await window.fileIOService.loadFile(storagePath);
      raw = raw?.content ?? raw?.fileContent ?? raw?.data ?? raw;
    } else {
      throw new Error('No file service available to load built texture data');
    }

    if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
      return raw;
    }

    if (typeof raw === 'string') {
      const bin = atob(raw);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      return bytes;
    }

    return null;
  }

  _baseName(path) {
    const name = (path || '').split('/').pop() || 'sprite';
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.substring(0, dot) : name;
  }

  _resolveTextureIndex(textureOutputPath) {
    const d2OutputPaths = this._collectBuildD2OutputPaths();
    const textureIndex = d2OutputPaths.indexOf(textureOutputPath);
    if (textureIndex < 0) {
      throw new Error(`Sprite source texture output was not found in build texture list: ${textureOutputPath}. Available textures: ${d2OutputPaths.join(', ') || '(none)'}`);
    }
    return textureIndex;
  }

  async _loadD2TextureHeader(textureOutputPath) {
    const raw = await this._loadBinaryFile(textureOutputPath);
    if (!raw) {
      throw new Error(`Sprite source texture was not built before sprite atlas generation: ${textureOutputPath}`);
    }

    const bytes = raw instanceof Uint8Array
      ? raw
      : (raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    if (bytes.length < 32 || bytes[0] !== 0x44 || bytes[1] !== 0x32 || bytes[2] !== 0x54 || bytes[3] !== 0x58) {
      throw new Error(`Sprite source texture is not a valid D2TX file: ${textureOutputPath}`);
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      paletteIndex: view.getUint16(10, true),
      paletteOffset: view.getUint8(12),
      flags: view.getUint8(13),
      colorKeyRgb565: view.getUint16(14, true),
    };
  }

  _resolveSpriteTextureOutputPath(spriteData) {
    const imagePath = spriteData.sourceImagePath;
    if (!imagePath || typeof imagePath !== 'string') {
      throw new Error('Sprite framesets did not resolve a source image path');
    }
    const canonicalImagePath = this._canonicalizeSourcePath(imagePath);
    const textureUiPath = canonicalImagePath.replace(/\.(png|jpg|jpeg|bmp|gif|webp|texture|d2)$/i, '.d2');
    if (textureUiPath === canonicalImagePath) {
      throw new Error(`Unsupported sprite source image extension: ${imagePath}`);
    }
    return this._toBuildPath(textureUiPath);
  }

  _resolveResourcePath(fromPath, resourcePath) {
    if (!resourcePath) return '';
    const normalizedResource = String(resourcePath).replace(/\\/g, '/');
    if (normalizedResource.includes('/Sources/') || normalizedResource.startsWith('Sources/')) {
      return normalizedResource;
    }
    if (normalizedResource.includes('/Resources/') || normalizedResource.startsWith('Resources/')) {
      return normalizedResource;
    }

    const normalizedFrom = String(fromPath || '').replace(/\\/g, '/');
    const slash = normalizedFrom.lastIndexOf('/');
    return slash >= 0 ? `${normalizedFrom.substring(0, slash + 1)}${normalizedResource}` : normalizedResource;
  }

  _canonicalizeSourcePath(path) {
    const sourcesRoot = (window.ProjectPaths && typeof window.ProjectPaths.getSourcesRootUi === 'function')
      ? window.ProjectPaths.getSourcesRootUi()
      : 'Sources';
    const normalized = String(path || '').replace(/\\/g, '/');
    const parsed = (window.ProjectPaths && typeof window.ProjectPaths.parseProjectPath === 'function')
      ? window.ProjectPaths.parseProjectPath(normalized)
      : { project: null, rest: normalized };
    const rest = parsed.rest || normalized;

    if (rest === 'Resources') {
      return parsed.project ? `${parsed.project}/${sourcesRoot}` : sourcesRoot;
    }

    if (rest.startsWith('Resources/')) {
      const canonicalRest = `${sourcesRoot}/${rest.substring('Resources/'.length)}`;
      return parsed.project ? `${parsed.project}/${canonicalRest}` : canonicalRest;
    }

    return parsed.project ? `${parsed.project}/${rest}` : rest;
  }

  _collectBuildD2OutputPaths() {
    const buildSystem = window.serviceContainer?.get('buildSystem');
    if (!buildSystem || typeof buildSystem.getAllResourceFilePaths !== 'function') {
      throw new Error('BuildSystem is not available for sprite texture indexing');
    }

    const resourceFilePaths = buildSystem.getAllResourceFilePaths();
    const textureBaseNames = new Set();
    const fontBaseNames = new Set();
    for (const filePath of resourceFilePaths) {
      const lower = filePath.toLowerCase();
      if (lower.endsWith('.texture')) {
        textureBaseNames.add(filePath.substring(0, filePath.length - '.texture'.length).toLowerCase());
      } else if (lower.endsWith('.font')) {
        fontBaseNames.add(filePath.substring(0, filePath.length - '.font'.length).toLowerCase());
      }
    }

    const d2Paths = [];
    for (const filePath of resourceFilePaths) {
      const lower = filePath.toLowerCase();
      if (lower.endsWith('.texture')) {
        d2Paths.push(this._toBuildPath(filePath.replace(/\.texture$/i, '.d2')));
        continue;
      }
      if (lower.endsWith('.font')) {
        d2Paths.push(this._toBuildPath(filePath.replace(/\.font$/i, '.d2')));
        continue;
      }
      if (lower.endsWith('.d2')) {
        const baseName = filePath.substring(0, filePath.length - '.d2'.length).toLowerCase();
        if (!textureBaseNames.has(baseName) && !fontBaseNames.has(baseName)) {
          d2Paths.push(this._toBuildPath(filePath));
        }
      }
    }

    return Array.from(new Set(d2Paths)).sort((left, right) => left.localeCompare(right));
  }

  _toBuildPath(uiPath) {
    if (window.ProjectPaths && typeof window.ProjectPaths.toBuildOutputPath === 'function') {
      return window.ProjectPaths.toBuildOutputPath(uiPath);
    }
    return uiPath.replace(/^Resources\//, 'build/');
  }

  async _saveBinary(outputPath, bytes) {
    const fileManager = window.serviceContainer?.get('fileManager');
    if (fileManager) {
      await fileManager.saveFile(outputPath, bytes.buffer, { binaryData: true });
    } else if (window.fileIOService) {
      await window.fileIOService.saveFile(outputPath, bytes.buffer, { binaryData: true });
    } else {
      throw new Error('No file service available to save build output');
    }
  }

  async _addBuildFile(outputPath) {
    const projectExplorer = window.serviceContainer?.get('projectExplorer');
    if (!projectExplorer) return;

    const fileManager = window.serviceContainer?.get('fileManager');
    if (!fileManager) return;

    const fileObj = await fileManager.loadFile(outputPath);
    if (!fileObj) return;

    const buildPrefix = (window.ProjectPaths && typeof window.ProjectPaths.getBuildStoragePrefix === 'function')
      ? window.ProjectPaths.getBuildStoragePrefix()
      : 'build/';
    const relativePath = outputPath.startsWith(buildPrefix)
      ? outputPath.substring(buildPrefix.length)
      : outputPath.replace(/^build\//, '');

    const sourcesUi = (window.ProjectPaths && typeof window.ProjectPaths.getSourcesRootUi === 'function')
      ? window.ProjectPaths.getSourcesRootUi()
      : 'Resources';
    const rel = relativePath.startsWith(sourcesUi + '/')
      ? relativePath.substring(sourcesUi.length + 1)
      : relativePath;

    const uiContent = fileObj.content !== undefined
      ? fileObj.content
      : (fileObj.fileContent !== undefined ? fileObj.fileContent : fileObj.data);

    projectExplorer.addBuildFileToStructure(rel, {
      content: uiContent,
      name: (rel.split('/').pop()),
      path: outputPath,
    });
  }
}

console.log('[SpriteBuilder] Class defined');

// ── Self-register with BuildSystem ──────────────────────────────────
(function registerSpriteBuilder() {
  function tryRegister() {
    try {
      if (!window.serviceContainer || !window.serviceContainer.has('buildSystem')) {
        return false;
      }
      const buildSystem = window.serviceContainer.get('buildSystem');
      if (buildSystem) {
        const sb = new SpriteBuilder();
        buildSystem.registerBuilder('.sprite', sb);
        buildSystem.builderById.set('sprite', sb);
        console.log('[SpriteBuilder] Registered with BuildSystem');
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
        console.warn('[SpriteBuilder] Gave up waiting for BuildSystem after 20s');
      }
    }
  }, 200);
})();
