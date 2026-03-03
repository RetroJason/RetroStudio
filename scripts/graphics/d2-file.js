// d2-file.js
// Library for building, saving, and loading .d2 (D2TX) game resource files.
//
// A .d2 file is a binary texture ready for the Dave2D GPU on Dialog DA1470x.
// The .texture JSON contains all configuration needed to produce a .d2 from
// a source image: pixel format, palette, palette offset, compression, and
// pre-rotation settings.
//
// This library is the SINGLE source of truth for .texture → .d2 conversion.
// Both the texture editor (live preview) and the build system use it.
//
// Dependencies: d2-canvas.js (buildD2TX, packIndexedPixels, FORMAT_STRING_TO_ENUM, D2_FORMAT)
//               image.js     (ImageData.rleEncode — optional, for RLE compression)
//
// Usage:
//   const d2Bytes = D2File.build(textureJson, indexedData, width, height);
//   await D2File.save(d2Path, d2Bytes);
//   const loaded = await D2File.load(d2Path);

console.log('[D2File] Library loading');

class D2File {

  /**
   * Build a game-ready .d2 (D2TX) binary from indexed pixel data.
   *
   * Reads format, paletteOffset, compressionType, and rotation from the
   * texture configuration and applies them in order:
   *   1. Pre-rotate indices 90° CW (if rotation === 90)
   *   2. Pack per-pixel 8-bit indices into target sub-byte format
   *   3. RLE-compress packed bytes (if compressionType === 'rle')
   *   4. Prepend 32-byte D2TX header
   *
   * @param {object}    textureCfg  Parsed .texture JSON (or textureData.toJSON()).
   * @param {Uint8Array} indexedData Per-pixel palette indices (0–255), source orientation.
   * @param {number}    width       Source image width (before rotation).
   * @param {number}    height      Source image height (before rotation).
   * @returns {Uint8Array} Complete .d2 file bytes.
   */
  static build(textureCfg, indexedData, width, height) {
    const meta     = textureCfg.metadata || {};
    const format   = meta.outputPixelFormat || textureCfg.outputPixelFormat || 'd2_mode_i8';
    const fmtEnum  = FORMAT_STRING_TO_ENUM[format] || D2_FORMAT.I8;
    const palOff   = meta.paletteOffset ?? textureCfg.paletteOffset ?? 0;
    const compress = textureCfg.compressionType || meta.compressionType || 'none';
    const rotation = textureCfg.rotation ?? 0;

    let buildW  = width;
    let buildH  = height;
    let indices = indexedData;

    // 1. Pre-rotate if configured (90° CW swap)
    if (rotation === 90) {
      indices = D2File._rotateIndices90CW(indices, width, height);
      buildW = height;
      buildH = width;
    }

    // 2. Pack into target format (I1/I2/I4 → sub-byte; I8 → identity)
    let packed = packIndexedPixels(indices, fmtEnum);

    // 3. RLE compress if requested
    let isRLE = false;
    if (compress === 'rle') {
      const RWImageData = window.ImageData;
      if (RWImageData && typeof RWImageData.rleEncode === 'function') {
        const before = packed.length;
        packed = new Uint8Array(RWImageData.rleEncode(packed));
        isRLE = true;
        console.log(`[D2File] RLE: ${before} → ${packed.length} bytes (${Math.round(packed.length / before * 100)}%)`);
      } else {
        console.warn('[D2File] RLE requested but ImageData.rleEncode not available');
      }
    }

    // 4. Assemble D2TX binary (header + pixel data)
    const d2 = buildD2TX(buildW, buildH, fmtEnum, packed, {
      paletteOffset: palOff,
      rle: isRLE,
      preRotated: rotation === 90,
    });

    console.log(`[D2File] Built ${format} ${buildW}×${buildH} → ${d2.length} bytes` +
                `${isRLE ? ' (RLE)' : ''}${rotation === 90 ? ' (rot90)' : ''}`);
    return d2;
  }

  // ── Path helpers ──────────────────────────────────────────────────

  /**
   * Derive the .d2 storage path from a .texture (or source image) path.
   * @param {string} path  e.g. "project/Sources/Images/hero.texture"
   * @returns {string}     e.g. "project/Sources/Images/hero.d2"
   */
  static d2PathFrom(path) {
    return path.replace(/\.(texture|png|bmp|gif|jpg|jpeg)$/i, '.d2');
  }

  // ── Storage helpers ───────────────────────────────────────────────

  /**
   * Save a .d2 binary to IndexedDB and optionally register it in the
   * project explorer tree so it is visible and buildable.
   *
   * @param {string}     storagePath  Full storage key (e.g. "proj/Sources/Images/hero.d2").
   * @param {Uint8Array} d2Bytes      The .d2 binary data.
   * @param {boolean}    [addToProject=true] Add to the project explorer tree.
   */
  static async save(storagePath, d2Bytes, addToProject = true) {
    const fileService = window.serviceContainer?.get('fileIOService') || window.fileIOService;
    if (!fileService) {
      console.error('[D2File] No file service available for save');
      return;
    }

    await fileService.saveFile(storagePath, d2Bytes, { binaryData: true });
    console.log(`[D2File] Saved: ${storagePath} (${d2Bytes.length} bytes)`);

    if (addToProject) {
      await D2File._addToProjectTree(storagePath, d2Bytes);
    }
  }

  /**
   * Load a .d2 binary from IndexedDB.
   * @param {string} storagePath  Full storage key.
   * @returns {Uint8Array|null}
   */
  static async load(storagePath) {
    let raw = null;

    const fileManager = window.serviceContainer?.get('fileManager');
    if (fileManager) {
      const obj = await fileManager.loadFile(storagePath);
      if (obj) raw = obj.content ?? obj.fileContent ?? obj.data;
    }

    if (!raw) {
      const fileService = window.fileIOService;
      if (fileService) {
        const obj = await fileService.loadFile(storagePath);
        if (obj) raw = obj.content ?? obj.fileContent ?? obj.data;
      }
    }

    if (!raw) return null;
    return D2File._toUint8Array(raw);
  }

  // ── Internal helpers ──────────────────────────────────────────────

  /**
   * Rotate a flat array of per-pixel 8-bit indices 90° clockwise.
   * Source (x, y) in W×H → destination (H−1−y, x) in H×W.
   */
  static _rotateIndices90CW(indices, w, h) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        out[x * h + (h - 1 - y)] = indices[y * w + x];
      }
    }
    return out;
  }

  /**
   * Register a .d2 file in the project explorer tree so it appears in
   * the file list and is eligible for the build pipeline.
   */
  static async _addToProjectTree(storagePath, d2Bytes) {
    try {
      const pe = window.gameEmulator?.projectExplorer;
      if (!pe) return;

      const parts    = storagePath.split('/');
      const fileName = parts.pop();
      const dir      = parts.join('/');

      const blob = new Blob([d2Bytes], { type: 'application/octet-stream' });
      const file = new File([blob], fileName, { lastModified: Date.now() });

      // skipAutoOpen = true, skipRender = false (refresh tree)
      await pe.addFileToProject(file, dir, true, false);
    } catch (e) {
      console.warn('[D2File] Could not add to project tree:', e.message);
    }
  }

  /**
   * Normalise any storage content type to a Uint8Array.
   */
  static _toUint8Array(raw) {
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
}

// Export
window.D2File = D2File;
console.log('[D2File] Library loaded');
