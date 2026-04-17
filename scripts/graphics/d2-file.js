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
    const fmtEnum  = FORMAT_STRING_TO_ENUM[format] ?? D2_FORMAT.I8;
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

    // 4. Resolve color key → RGB565
    let colorKey = -1;
    if (textureCfg.useColorKey) {
      const hex = textureCfg.transparentColor || '#FF00FF';
      const r = parseInt(hex.substring(1, 3), 16) || 0;
      const g = parseInt(hex.substring(3, 5), 16) || 0;
      const b = parseInt(hex.substring(5, 7), 16) || 0;
      colorKey = (Math.round(r * 31 / 255) << 11) | (Math.round(g * 63 / 255) << 5) | Math.round(b * 31 / 255);
    }

    // 5. Assemble D2TX binary (header + pixel data)
    const d2 = buildD2TX(buildW, buildH, fmtEnum, packed, {
      paletteOffset: palOff,
      rle: isRLE,
      preRotated: rotation === 90,
      colorKey,
    });

    console.log(`[D2File] Built ${format} ${buildW}×${buildH} → ${d2.length} bytes` +
                `${isRLE ? ' (RLE)' : ''}${rotation === 90 ? ' (rot90)' : ''}`);
    return d2;
  }

  /**
   * Build a game-ready .d2 (D2TX) binary from source RGBA pixels.
   * This is the shared direct-colour/alpha path used by previews and tests.
   *
   * @param {object} textureCfg  Parsed .texture JSON (or textureData.toJSON()).
   * @param {Uint8Array|Uint8ClampedArray} rgba Source RGBA pixels.
   * @param {number} width       Source image width (before rotation).
   * @param {number} height      Source image height (before rotation).
   * @returns {Uint8Array} Complete .d2 file bytes.
   */
  static buildFromRGBA(textureCfg, rgba, width, height) {
    const meta     = textureCfg.metadata || {};
    const format   = meta.outputPixelFormat || textureCfg.outputPixelFormat || 'd2_mode_rgba8888';
    const fmtEnum  = FORMAT_STRING_TO_ENUM[format] ?? D2_FORMAT.RGBA8888;
    const palOff   = meta.paletteOffset ?? textureCfg.paletteOffset ?? 0;
    const compress = textureCfg.compressionType || meta.compressionType || 'none';
    const rotation = textureCfg.rotation ?? 0;

    let buildW = width;
    let buildH = height;
    let data = D2File.convertRGBAToFormat(rgba, format, width, height);

    if (rotation === 90) {
      const bpp = BITS_PER_PIXEL[fmtEnum] || 32;
      if ((bpp % 8) === 0) {
        data = D2File._rotateDirectBytes90CW(data, width, height, bpp);
      } else {
        data = D2File._rotateSubByteDirect90CW(data, width, height, fmtEnum, bpp);
      }
      buildW = height;
      buildH = width;
    }

    let isRLE = false;
    if (compress === 'rle') {
      const RWImageData = window.ImageData;
      if (RWImageData && typeof RWImageData.rleEncode === 'function') {
        data = new Uint8Array(RWImageData.rleEncode(data));
        isRLE = true;
      } else {
        console.warn('[D2File] RLE requested but ImageData.rleEncode not available');
      }
    }

    let colorKey = -1;
    if (textureCfg.useColorKey) {
      const hex = textureCfg.transparentColor || '#FF00FF';
      const r = parseInt(hex.substring(1, 3), 16) || 0;
      const g = parseInt(hex.substring(3, 5), 16) || 0;
      const b = parseInt(hex.substring(5, 7), 16) || 0;
      colorKey = (Math.round(r * 31 / 255) << 11) | (Math.round(g * 63 / 255) << 5) | Math.round(b * 31 / 255);
    }

    const d2 = buildD2TX(buildW, buildH, fmtEnum, data, {
      paletteOffset: palOff,
      rle: isRLE,
      preRotated: rotation === 90,
      colorKey,
    });

    console.log(`[D2File] Built ${format} ${buildW}×${buildH} from RGBA → ${d2.length} bytes` +
                `${isRLE ? ' (RLE)' : ''}${rotation === 90 ? ' (rot90)' : ''}`);
    return d2;
  }

  /**
   * Convert RGBA8888 pixel data to any target D2 format.
   *
   * Input:  Uint8ClampedArray | Uint8Array of RGBA bytes (4 per pixel).
   * Output: Uint8Array of format-encoded bytes ready for buildD2TX().
   *
   * For indexed formats this is NOT the right path — use palette matching +
   * packIndexedPixels instead.  This handles direct-colour & alpha-only modes.
   *
   * @param {Uint8Array|Uint8ClampedArray} rgba  Source pixels (R,G,B,A,…).
   * @param {string} formatStr  D2 format string e.g. 'd2_mode_rgba8888'.
   * @returns {Uint8Array}
   */
  static convertRGBAToFormat(rgba, formatStr, width = 0, height = 0) {
    const pixelCount = rgba.length / 4;
    const fmtEnum = FORMAT_STRING_TO_ENUM[formatStr];

    switch (fmtEnum) {
      // ── 32-bit ────────────────────────────────────────
      case D2_FORMAT.RGBA8888: {
        const out = new Uint8Array(pixelCount * 4);
        for (let i = 0, o = 0; i < rgba.length; i += 4, o += 4) {
          out[o]     = rgba[i + 3]; // A
          out[o + 1] = rgba[i + 2]; // B
          out[o + 2] = rgba[i + 1]; // G
          out[o + 3] = rgba[i];     // R
        }
        return out;
      }

      case D2_FORMAT.ARGB8888: {
        const out = new Uint8Array(pixelCount * 4);
        for (let i = 0, o = 0; i < rgba.length; i += 4, o += 4) {
          out[o]     = rgba[i + 2]; // B
          out[o + 1] = rgba[i + 1]; // G
          out[o + 2] = rgba[i];     // R
          out[o + 3] = rgba[i + 3]; // A
        }
        return out;
      }

      // ── 32-bit xRGB ───────────────────────────────────
      case D2_FORMAT.RGB888: {
        const out = new Uint8Array(pixelCount * 4);
        for (let i = 0, o = 0; i < rgba.length; i += 4, o += 4) {
          out[o]     = rgba[i + 2]; // B
          out[o + 1] = rgba[i + 1]; // G
          out[o + 2] = rgba[i];     // R
          out[o + 3] = 0;
        }
        return out;
      }

      // ── 16-bit ────────────────────────────────────────
      case D2_FORMAT.RGB565: {
        const out = new Uint8Array(pixelCount * 2);
        for (let i = 0, o = 0; i < rgba.length; i += 4, o += 2) {
          const r5 = (rgba[i]     >> 3) & 0x1F;
          const g6 = (rgba[i + 1] >> 2) & 0x3F;
          const b5 = (rgba[i + 2] >> 3) & 0x1F;
          const v = (r5 << 11) | (g6 << 5) | b5;
          out[o]     = v & 0xFF;         // low byte
          out[o + 1] = (v >> 8) & 0xFF;  // high byte
        }
        return out;
      }

      case D2_FORMAT.ARGB1555: {
        const out = new Uint8Array(pixelCount * 2);
        for (let i = 0, o = 0; i < rgba.length; i += 4, o += 2) {
          const a1 = rgba[i + 3] >= 128 ? 1 : 0;
          const r5 = (rgba[i]     >> 3) & 0x1F;
          const g5 = (rgba[i + 1] >> 3) & 0x1F;
          const b5 = (rgba[i + 2] >> 3) & 0x1F;
          const v = (a1 << 15) | (r5 << 10) | (g5 << 5) | b5;
          out[o]     = v & 0xFF;
          out[o + 1] = (v >> 8) & 0xFF;
        }
        return out;
      }

      case D2_FORMAT.RGBA5551: {
        const out = new Uint8Array(pixelCount * 2);
        for (let i = 0, o = 0; i < rgba.length; i += 4, o += 2) {
          const r5 = (rgba[i]     >> 3) & 0x1F;
          const g5 = (rgba[i + 1] >> 3) & 0x1F;
          const b5 = (rgba[i + 2] >> 3) & 0x1F;
          const a1 = rgba[i + 3] >= 128 ? 1 : 0;
          const v = (r5 << 11) | (g5 << 6) | (b5 << 1) | a1;
          out[o]     = v & 0xFF;
          out[o + 1] = (v >> 8) & 0xFF;
        }
        return out;
      }

      case D2_FORMAT.RGB555: {
        const out = new Uint8Array(pixelCount * 2);
        for (let i = 0, o = 0; i < rgba.length; i += 4, o += 2) {
          const r5 = (rgba[i]     >> 3) & 0x1F;
          const g5 = (rgba[i + 1] >> 3) & 0x1F;
          const b5 = (rgba[i + 2] >> 3) & 0x1F;
          const v = (r5 << 10) | (g5 << 5) | b5;
          out[o]     = v & 0xFF;
          out[o + 1] = (v >> 8) & 0xFF;
        }
        return out;
      }

      case D2_FORMAT.ARGB4444: {
        const out = new Uint8Array(pixelCount * 2);
        for (let i = 0, o = 0; i < rgba.length; i += 4, o += 2) {
          const a4 = (rgba[i + 3] >> 4) & 0xF;
          const r4 = (rgba[i]     >> 4) & 0xF;
          const g4 = (rgba[i + 1] >> 4) & 0xF;
          const b4 = (rgba[i + 2] >> 4) & 0xF;
          const v = (a4 << 12) | (r4 << 8) | (g4 << 4) | b4;
          out[o]     = v & 0xFF;
          out[o + 1] = (v >> 8) & 0xFF;
        }
        return out;
      }

      case D2_FORMAT.RGBA4444: {
        const out = new Uint8Array(pixelCount * 2);
        for (let i = 0, o = 0; i < rgba.length; i += 4, o += 2) {
          const r4 = (rgba[i]     >> 4) & 0xF;
          const g4 = (rgba[i + 1] >> 4) & 0xF;
          const b4 = (rgba[i + 2] >> 4) & 0xF;
          const a4 = (rgba[i + 3] >> 4) & 0xF;
          const v = (r4 << 12) | (g4 << 8) | (b4 << 4) | a4;
          out[o]     = v & 0xFF;
          out[o + 1] = (v >> 8) & 0xFF;
        }
        return out;
      }

      case D2_FORMAT.RGB444: {
        const out = new Uint8Array(pixelCount * 2);
        for (let i = 0, o = 0; i < rgba.length; i += 4, o += 2) {
          const r4 = (rgba[i]     >> 4) & 0xF;
          const g4 = (rgba[i + 1] >> 4) & 0xF;
          const b4 = (rgba[i + 2] >> 4) & 0xF;
          const v = (r4 << 8) | (g4 << 4) | b4;
          out[o]     = v & 0xFF;
          out[o + 1] = (v >> 8) & 0xFF;
        }
        return out;
      }

      // ── Alpha-only ────────────────────────────────────
      case D2_FORMAT.ALPHA8: {
        const out = new Uint8Array(pixelCount);
        for (let i = 0; i < pixelCount; i++) out[i] = rgba[i * 4 + 3];
        return out;
      }

      case D2_FORMAT.ALPHA4: {
        return D2File._packSubByteRGBAAlpha(rgba, width, height, 4);
      }

      case D2_FORMAT.ALPHA2: {
        return D2File._packSubByteRGBAAlpha(rgba, width, height, 2);
      }

      case D2_FORMAT.ALPHA1: {
        return D2File._packSubByteRGBAAlpha(rgba, width, height, 1);
      }

      default:
        console.warn(`[D2File] convertRGBAToFormat: unknown format ${formatStr}, returning RGBA8888`);
        return new Uint8Array(rgba.buffer ? rgba : new Uint8Array(rgba));
    }
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
   * Rotate format-encoded pixel bytes 90° clockwise.
   * Works for any bpp ≥ 8 where each pixel is an integral number of bytes.
   * For sub-byte formats this is NOT used (indices are rotated before packing).
   *
   * @param {Uint8Array} data  Format-encoded bytes.
   * @param {number} w         Source width in pixels.
   * @param {number} h         Source height in pixels.
   * @param {number} bpp       Bits per pixel (must be multiple of 8).
   * @returns {Uint8Array}     Rotated bytes in H×W layout.
   */
  static _rotateDirectBytes90CW(data, w, h, bpp) {
    const bytesPerPixel = bpp / 8;
    const out = new Uint8Array(w * h * bytesPerPixel);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const srcOff = (y * w + x) * bytesPerPixel;
        const dstOff = (x * h + (h - 1 - y)) * bytesPerPixel;
        for (let b = 0; b < bytesPerPixel; b++) {
          out[dstOff + b] = data[srcOff + b];
        }
      }
    }
    return out;
  }

  static _subByteShift(formatEnum, pixelIndex, bitsPerPixel) {
    if (formatEnum === D2_FORMAT.I4 || formatEnum === D2_FORMAT.ALPHA4) {
      return (pixelIndex & 1) === 0 ? 0 : 4;
    }
    if (formatEnum === D2_FORMAT.I2 || formatEnum === D2_FORMAT.ALPHA2) {
      return (pixelIndex & 3) * 2;
    }
    if (formatEnum === D2_FORMAT.I1 || formatEnum === D2_FORMAT.ALPHA1) {
      return pixelIndex & 7;
    }
    return 8 - bitsPerPixel - ((pixelIndex % (8 / bitsPerPixel)) * bitsPerPixel);
  }

  static _unpackSubBytePixels(data, formatEnum, bitsPerPixel, pixelCount) {
    const out = new Uint8Array(pixelCount);
    const mask = (1 << bitsPerPixel) - 1;
    const pixelsPerByte = 8 / bitsPerPixel;

    for (let i = 0; i < pixelCount; i++) {
      const byteIdx = Math.floor(i / pixelsPerByte);
      const shift = D2File._subByteShift(formatEnum, i, bitsPerPixel);
      out[i] = (data[byteIdx] >> shift) & mask;
    }

    return out;
  }

  static _packSubBytePixels(values, formatEnum, bitsPerPixel) {
    const out = new Uint8Array(Math.ceil((values.length * bitsPerPixel) / 8));
    const mask = (1 << bitsPerPixel) - 1;
    const pixelsPerByte = 8 / bitsPerPixel;

    for (let i = 0; i < values.length; i++) {
      const byteIdx = Math.floor(i / pixelsPerByte);
      const shift = D2File._subByteShift(formatEnum, i, bitsPerPixel);
      out[byteIdx] |= (values[i] & mask) << shift;
    }

    return out;
  }

  static _rotateSubByteDirect90CW(data, w, h, formatEnum, bitsPerPixel) {
    const unpacked = D2File._unpackSubBytePixels(data, formatEnum, bitsPerPixel, w * h);
    const rotated = D2File._rotateIndices90CW(unpacked, w, h);
    return D2File._packSubBytePixels(rotated, formatEnum, bitsPerPixel);
  }

  static _packSubByteRGBAAlpha(rgba, width, height, bitsPerPixel) {
    if (!width || !height) {
      throw new Error('D2File: width/height required for sub-byte alpha packing');
    }

    const formatEnum = bitsPerPixel === 4 ? D2_FORMAT.ALPHA4 :
                       bitsPerPixel === 2 ? D2_FORMAT.ALPHA2 : D2_FORMAT.ALPHA1;
    const values = new Uint8Array(width * height);

    for (let i = 0; i < values.length; i++) {
      const alpha = rgba[i * 4 + 3];
      values[i] = bitsPerPixel === 4 ? ((alpha >> 4) & 0xF) :
                  bitsPerPixel === 2 ? ((alpha >> 6) & 0x3) :
                  (alpha >= 128 ? 1 : 0);
    }

    return D2File._packSubBytePixels(values, formatEnum, bitsPerPixel);
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
