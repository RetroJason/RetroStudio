// textbox.js - TextBox Lua Extensions for RetroStudio Emulator
// Provides firmware-parity TextBox API for rendering text using BMFont assets.
// TextBox instances are created from a font asset name and return opaque handles.
// Font assets are loaded from build output (.fnt BMFont binary + .d2 texture atlas).

class LuaTextBoxExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;

    /** @type {Map<number, object>} handle -> textbox runtime state */
    this.textboxes = new Map();

    /** @type {number} Monotonic textbox handle allocator */
    this._nextHandle = 1;

    /** @type {Map<string, object>} font name -> parsed BMFont data + d2Path */
    this.fontAssets = new Map();

    /** @type {Map<string, object>} font name -> GPU texture handle */
    this.gpuTextures = new Map();

    /** @type {Uint8Array|null} Concatenated PMAP RGBA data */
    this.pmapData = null;

    /** @type {Array<{offset:number, count:number}>} PMAP entries */
    this.pmapEntries = [];

    /** @type {Uint8Array} Active GPU palette buffer (256 RGBA entries) */
    this.currentPalette = new Uint8Array(1024);

    /** @type {number} Active PMAP index on GPU (-1 = none) */
    this._activePaletteIndex = -1;

    /** @type {number} Active PMAP offset on GPU */
    this._activePaletteOffset = -1;

    /** @type {D2Canvas|null} GPU renderer */
    this.gpu = null;
  }

  async initialize(luaState) {
    console.log('[LuaTextBox] Initializing textbox system');
    this.luaState = luaState;
    await this._preloadFontAssets();
  }

  reset() {
    this.textboxes.clear();
    this._nextHandle = 1;
    this.gpuTextures.clear();
    this._activePaletteIndex = -1;
    this._activePaletteOffset = -1;
    this.gpu = null;
    console.log('[LuaTextBox] TextBox system reset');
  }

  // ── Helper: get textbox by handle from Lua stack ─────────────────

  _getHandleArg(argIndex = 2) {
    const raw = this.luaState.raw_tostring(argIndex);
    if (raw === undefined || raw === null || raw === '') return null;
    const handle = parseInt(raw, 10);
    return Number.isFinite(handle) ? handle : null;
  }

  _getTextBoxByHandleArg(argIndex = 2) {
    const handle = this._getHandleArg(argIndex);
    if (handle === null) {
      throw new Error(`TextBox: bad argument #${argIndex - 1} (valid textbox handle expected)`);
    }
    const tb = this.textboxes.get(handle);
    if (!tb) {
      throw new Error(`TextBox: bad argument #${argIndex - 1} (unknown textbox handle ${handle})`);
    }
    return tb;
  }

  // ── BMFont Binary Parser ─────────────────────────────────────────

  _parseBMFont(bytes) {
    if (bytes.length < 4 ||
        bytes[0] !== 0x42 || bytes[1] !== 0x4D ||
        bytes[2] !== 0x46 || bytes[3] !== 3) {
      throw new Error('Invalid BMFont binary (expected BMF\\x03 header)');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 4;

    const font = {
      info: null,
      common: null,
      characters: new Map(),
      kerning: new Map(),
    };

    while (offset + 5 <= bytes.length) {
      const blockType = bytes[offset];
      const blockSize = view.getUint32(offset + 1, true);
      offset += 5;

      if (offset + blockSize > bytes.length) break;

      const blockView = new DataView(bytes.buffer, bytes.byteOffset + offset, blockSize);

      switch (blockType) {
        case 1: // Info
          font.info = {
            size: blockView.getInt16(0, true),
          };
          break;

        case 2: // Common
          font.common = {
            lineHeight: blockView.getUint16(0, true),
            base: blockView.getUint16(2, true),
            scaleW: blockView.getUint16(4, true),
            scaleH: blockView.getUint16(6, true),
          };
          break;

        case 3: // Pages — not needed
          break;

        case 4: { // Chars (20 bytes each)
          const numChars = Math.floor(blockSize / 20);
          for (let i = 0; i < numChars; i++) {
            const off = i * 20;
            const charInfo = {
              id:       blockView.getUint32(off, true),
              x:        blockView.getUint16(off + 4, true),
              y:        blockView.getUint16(off + 6, true),
              width:    blockView.getUint16(off + 8, true),
              height:   blockView.getUint16(off + 10, true),
              xoffset:  blockView.getInt16(off + 12, true),
              yoffset:  blockView.getInt16(off + 14, true),
              xadvance: blockView.getInt16(off + 16, true),
              page:     bytes[offset + off + 18],
              chnl:     bytes[offset + off + 19],
            };
            font.characters.set(charInfo.id, charInfo);
          }
          break;
        }

        case 5: { // Kerning (10 bytes each)
          const numKernings = Math.floor(blockSize / 10);
          for (let i = 0; i < numKernings; i++) {
            const off = i * 10;
            const first  = blockView.getUint32(off, true);
            const second = blockView.getUint32(off + 4, true);
            const amount = blockView.getInt16(off + 8, true);
            font.kerning.set(`${first},${second}`, amount);
          }
          break;
        }

        // case 6: embedded texture — handled separately via .d2 file
      }

      offset += blockSize;
    }

    return font;
  }

  // ── Lua API: TextBox.Create(fontName, x, y, z, color, text) ───────

  Create() {
    const L = this.luaState;
    const fontName = L.raw_tostring(2);
    const x          = parseFloat(L.raw_tostring(3)) || 0;
    const y          = parseFloat(L.raw_tostring(4)) || 0;
    const zValue     = Number.parseFloat(L.raw_tostring(5));
    const colorValue = Number.parseInt(L.raw_tostring(6), 10);
    const z          = Number.isNaN(zValue) ? 0 : zValue;
    const color      = Number.isNaN(colorValue) ? 0x00FFFFFF : colorValue;
    const text     = L.raw_tostring(7) || '';

    if (!fontName) throw new Error('TextBox.Create: bad argument #1 (string font name expected)');

    const fontAsset = this.fontAssets.get(fontName);
    if (!fontAsset) throw new Error(`TextBox.Create: font asset not found: "${fontName}"`);

    const handle = this._nextHandle++;

    const state = {
      _handle: handle,
      _fontName: fontName,
      _text: text,
      _posX: x,
      _posY: y,
      _layer: z,
      _centerX: 0,
      _centerY: 0,
      _rotation: 0,
      _scaleX: 1,
      _scaleY: 1,
      _color: color,
      _paletteSlot: null,
      _visible: true,
      _attributes: 0,
      _width: 448,
      _height: 368,
    };

    this.textboxes.set(handle, state);
    console.log(`[LuaTextBox] Created textbox handle ${handle} with font "${fontName}": "${text}"`);
    return handle;
  }

  Destroy() {
    const tb = this._getTextBoxByHandleArg(2);
    this.textboxes.delete(tb._handle);
  }

  // ── TextBox-specific: SetText / GetText ──────────────────────────

  SetText() {
    const tb  = this._getTextBoxByHandleArg(2);
    const txt = this.luaState.raw_tostring(3);
    if (txt === undefined || txt === null) {
      throw new Error('TextBox.SetText: bad argument #2 (string expected)');
    }
    tb._text = txt;
  }

  GetText() {
    const tb = this._getTextBoxByHandleArg(2);
    return tb._text || '';
  }

  // ── Renderable API (firmware parity, handle as first arg) ────────

  SetX() {
    const tb = this._getTextBoxByHandleArg(2);
    tb._posX = parseFloat(this.luaState.raw_tostring(3)) || 0;
  }

  GetX() {
    const tb = this._getTextBoxByHandleArg(2);
    return tb._posX || 0;
  }

  SetY() {
    const tb = this._getTextBoxByHandleArg(2);
    tb._posY = parseFloat(this.luaState.raw_tostring(3)) || 0;
  }

  GetY() {
    const tb = this._getTextBoxByHandleArg(2);
    return tb._posY || 0;
  }

  SetXY() {
    const tb = this._getTextBoxByHandleArg(2);
    tb._posX = parseFloat(this.luaState.raw_tostring(3)) || 0;
    tb._posY = parseFloat(this.luaState.raw_tostring(4)) || 0;
  }

  GetXY() {
    const tb = this._getTextBoxByHandleArg(2);
    return [tb._posX || 0, tb._posY || 0];
  }

  SetCenter() {
    const tb = this._getTextBoxByHandleArg(2);
    tb._centerX = parseFloat(this.luaState.raw_tostring(3)) || 0;
    tb._centerY = parseFloat(this.luaState.raw_tostring(4)) || 0;
  }

  GetCenter() {
    const tb = this._getTextBoxByHandleArg(2);
    return [tb._centerX || 0, tb._centerY || 0];
  }

  SetSize() {
    const tb = this._getTextBoxByHandleArg(2);
    tb._width = parseFloat(this.luaState.raw_tostring(3)) || 0;
    tb._height = parseFloat(this.luaState.raw_tostring(4)) || 0;
  }

  GetSize() {
    const tb = this._getTextBoxByHandleArg(2);
    return [tb._width || 0, tb._height || 0];
  }

  SetAngle() {
    const tb = this._getTextBoxByHandleArg(2);
    tb._rotation = parseFloat(this.luaState.raw_tostring(3)) || 0;
  }

  GetAngle() {
    const tb = this._getTextBoxByHandleArg(2);
    return tb._rotation || 0;
  }

  SetScale() {
    const tb = this._getTextBoxByHandleArg(2);
    const scaleX = Number.parseFloat(this.luaState.raw_tostring(3));
    const scaleY = Number.parseFloat(this.luaState.raw_tostring(4));
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
      throw new Error('TextBox.SetScale: bad arguments #2/#3 (number expected)');
    }
    tb._scaleX = scaleX;
    tb._scaleY = scaleY;
  }

  GetScale() {
    const tb = this._getTextBoxByHandleArg(2);
    return [tb._scaleX ?? 1, tb._scaleY ?? 1];
  }

  SetColor() {
    const tb = this._getTextBoxByHandleArg(2);
    const color = Number(this.luaState.raw_tostring(3));
    if (!Number.isInteger(color)) {
      throw new Error('TextBox.SetColor: bad argument #2 (integer expected)');
    }
    tb._color = color;
  }

  GetColor() {
    const tb = this._getTextBoxByHandleArg(2);
    return tb._color ?? 0x00FFFFFF;
  }

  SetPaletteSlot() {
    const tb = this._getTextBoxByHandleArg(2);
    tb._paletteSlot = parseInt(this.luaState.raw_tostring(3)) || 0;
  }

  GetPaletteSlot() {
    const tb = this._getTextBoxByHandleArg(2);
    return tb._paletteSlot || 0;
  }

  SetVisible() {
    const tb = this._getTextBoxByHandleArg(2);
    tb._visible = this._requireBooleanStackArg(3, 'TextBox.SetVisible', 'visible');
  }

  GetVisible() {
    const tb = this._getTextBoxByHandleArg(2);
    return tb._visible !== false;
  }

  SetAttributes() {
    const tb = this._getTextBoxByHandleArg(2);
    tb._attributes = parseInt(this.luaState.raw_tostring(3)) || 0;
  }

  GetAttributes() {
    const tb = this._getTextBoxByHandleArg(2);
    return tb._attributes || 0;
  }

  // ── GPU Initialization ───────────────────────────────────────────

  async initGpu(gpu) {
    this.gpu = gpu;
    console.log('[LuaTextBox] GPU init — loading palette map + font textures');

    await this._loadPaletteMap();
    await this._uploadFontTextures();

    if (this.pmapEntries.length > 0) {
      this._activatePalette(1, 0);
    }
  }

  // ── Per-Frame Rendering ──────────────────────────────────────────

  renderFrame(gpu, deltaMs) {
    for (const [, tb] of this.textboxes) {
      if (tb._visible === false) continue;

      const fontAsset = this.fontAssets.get(tb._fontName);
      if (!fontAsset) continue;

      const texHandle = this.gpuTextures.get(tb._fontName);
      if (!texHandle) continue;

      const font = fontAsset.font;
      if (!font || !font.characters) continue;

      // Activate palette for this font texture
      const paletteIndex = (tb._paletteSlot != null && tb._paletteSlot > 0)
        ? tb._paletteSlot
        : (fontAsset.paletteSlot || 1);
      const paletteOffset = fontAsset.paletteOffset || 0;

      if (paletteIndex !== this._activePaletteIndex || paletteOffset !== this._activePaletteOffset) {
        this._activatePalette(paletteIndex, paletteOffset);
      }

      const scaleX = tb._scaleX ?? 1;
      const scaleY = tb._scaleY ?? 1;

      let xCursor = tb._posX || 0;
      const yBase = tb._posY || 0;
      const text = tb._text || '';

      for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        const chInfo = font.characters.get(charCode);
        if (!chInfo) continue;

        const glyphX = xCursor + chInfo.xoffset * scaleX;
        const glyphY = yBase + chInfo.yoffset * scaleY;

        if (chInfo.width > 0 && chInfo.height > 0) {
          gpu.blit(texHandle, {
            x: glyphX,
            y: glyphY,
            srcX: chInfo.x,
            srcY: chInfo.y,
            srcW: chInfo.width,
            srcH: chInfo.height,
            scaleX: scaleX,
            scaleY: scaleY,
            rotation: tb._rotation || 0,
            pivotX: 0,
            pivotY: 0,
            filter: 'nearest',
            tint: tb._color ?? 0x00FFFFFF,
          });
        }

        // Advance cursor
        xCursor += chInfo.xadvance * scaleX;

        // Apply kerning for next character
        if (i + 1 < text.length) {
          const nextChar = text.charCodeAt(i + 1);
          const kerning = font.kerning.get(`${charCode},${nextChar}`) || 0;
          xCursor += kerning * scaleX;
        }
      }
    }
  }

  // ── Palette Management ───────────────────────────────────────────

  _activatePalette(index, offset) {
    if (!this.gpu) return;
    if (index >= 1 && index <= this.pmapEntries.length) {
      const entry = this.pmapEntries[index - 1];
      this.currentPalette.fill(0);
      const src = this.pmapData.subarray(entry.offset, entry.offset + entry.count * 4);
      this.currentPalette.set(src.subarray(0, Math.min(src.length, 1024)));
      this.gpu.setPalette(this.currentPalette);
    }
    this.gpu.setPaletteOffset(offset);
    this._activePaletteIndex = index;
    this._activePaletteOffset = offset;
  }

  async _loadPaletteMap() {
    try {
      const pmapPath = this._buildPrefix() + 'palette_map.pmap';
      const raw = await this._loadBinary(pmapPath);
      if (!raw) {
        console.warn('[LuaTextBox] No PMAP found — palette rendering may fail');
        return;
      }

      const bytes = new Uint8Array(raw);
      if (bytes.length < 8) return;
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4D ||
          bytes[2] !== 0x41 || bytes[3] !== 0x50) {
        console.warn('[LuaTextBox] Invalid PMAP magic');
        return;
      }

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const count = view.getUint16(6, true);
      this.pmapEntries = [];
      let off = 8;
      const allPalData = [];
      let accumOffset = 0;

      for (let i = 0; i < count; i++) {
        if (off + 2 > bytes.length) break;
        const colorCount = view.getUint16(off, true);
        off += 2;
        const dataLen = colorCount * 4;
        this.pmapEntries.push({ offset: accumOffset, count: colorCount });
        allPalData.push(bytes.slice(off, off + dataLen));
        accumOffset += dataLen;
        off += dataLen;
      }

      this.pmapData = new Uint8Array(accumOffset);
      let writeOff = 0;
      for (const chunk of allPalData) {
        this.pmapData.set(chunk, writeOff);
        writeOff += chunk.length;
      }

      console.log(`[LuaTextBox] Loaded PMAP: ${count} palettes`);
    } catch (e) {
      console.error('[LuaTextBox] PMAP load error:', e);
    }
  }

  // ── Font Asset Loading ───────────────────────────────────────────

  async _preloadFontAssets() {
    try {
      const allFiles = await this._listBuildFiles(this._buildPrefix());
      const fntFiles = allFiles.filter(p => p.toLowerCase().endsWith('.fnt'));

      for (const fntPath of fntFiles) {
        try {
          const raw = await this._loadBinary(fntPath);
          if (!raw) continue;

          const fntBytes = new Uint8Array(raw);
          if (fntBytes.length < 4 ||
              fntBytes[0] !== 0x42 || fntBytes[1] !== 0x4D ||
              fntBytes[2] !== 0x46 || fntBytes[3] !== 3) {
            continue; // Not a valid BMFont binary
          }

          const font = this._parseBMFont(fntBytes);
          const fontName = fntPath.split('/').pop().replace(/\.fnt$/i, '');

          // The companion .d2 texture atlas has the same base name
          const d2Path = fntPath.replace(/\.fnt$/i, '.d2');

          // Read D2TX header for palette info
          let paletteSlot = 1;
          let paletteOffset = 0;
          const d2Raw = await this._loadBinary(d2Path);
          if (d2Raw) {
            const d2Bytes = new Uint8Array(d2Raw);
            if (d2Bytes.length >= 32 &&
                d2Bytes[0] === 0x44 && d2Bytes[1] === 0x32 &&
                d2Bytes[2] === 0x54 && d2Bytes[3] === 0x58) {
              const d2View = new DataView(d2Bytes.buffer, d2Bytes.byteOffset, d2Bytes.byteLength);
              paletteSlot = d2View.getUint16(10, true) || 1;
              paletteOffset = d2Bytes[12] || 0;
            }
          }

          this.fontAssets.set(fontName, {
            name: fontName,
            fntPath,
            d2Path,
            font,
            paletteSlot,
            paletteOffset,
          });

          console.log(`[LuaTextBox] Loaded font asset: "${fontName}" (${font.characters.size} chars, ${font.kerning.size} kerning pairs)`);
        } catch (e) {
          console.error(`[LuaTextBox] Failed to preload font asset ${fntPath}:`, e);
        }
      }

      console.log(`[LuaTextBox] Pre-loaded ${this.fontAssets.size} font assets`);
    } catch (e) {
      console.error('[LuaTextBox] Failed to preload font assets:', e);
    }
  }

  async _uploadFontTextures() {
    if (!this.gpu) return;

    for (const [fontName, asset] of this.fontAssets.entries()) {
      try {
        const raw = await this._loadBinary(asset.d2Path);
        if (!raw) continue;

        const d2Bytes = new Uint8Array(raw);
        if (d2Bytes.length < 32 ||
            d2Bytes[0] !== 0x44 || d2Bytes[1] !== 0x32 ||
            d2Bytes[2] !== 0x54 || d2Bytes[3] !== 0x58) {
          continue;
        }

        const texHandle = this.gpu.createTexture(d2Bytes);
        this.gpuTextures.set(fontName, texHandle);
        console.log(`[LuaTextBox] Uploaded font GPU texture "${fontName}": ${texHandle.width}x${texHandle.height}`);
      } catch (e) {
        console.error(`[LuaTextBox] Failed to upload font texture ${asset.d2Path}:`, e);
      }
    }

    console.log(`[LuaTextBox] ${this.gpuTextures.size} font GPU textures ready`);
  }

  // ── File I/O Helpers (same pattern as Image) ─────────────────────

  _buildPrefix() {
    const pathResolver = this._getService('pathResolver');
    return pathResolver?.getBuildStoragePrefix?.() || 'build/';
  }

  async _listBuildFiles(prefix) {
    const fileManager = this._getService('fileManager');
    if (!fileManager) return [];

    if (typeof fileManager.listFiles === 'function') {
      const results = await fileManager.listFiles(prefix);
      return results.map(r => (typeof r === 'string') ? r : (r.path || r.name || ''));
    }

    const projectExplorer = this._getService('projectExplorer');
    if (!projectExplorer) return [];

    const pathResolver = this._getService('pathResolver');
    const paths = [];
    const buildRoot = pathResolver?.getBuildRootUi?.() || 'Game Objects';

    this._collectPaths(projectExplorer.projectData?.structure, '', buildRoot, prefix, paths);
    return paths;
  }

  _collectPaths(node, currentPath, buildRoot, prefix, out) {
    if (!node) return;
    for (const [name, child] of Object.entries(node)) {
      const path = currentPath ? `${currentPath}/${name}` : name;
      if (child && child.type === 'folder' && child.children) {
        this._collectPaths(child.children, path, buildRoot, prefix, out);
      } else if (child && child.type === 'file') {
        const storagePath = prefix + path.replace(new RegExp(`^${buildRoot}/`), '');
        out.push(storagePath);
      }
    }
  }

  async _loadBinary(path) {
    const fileManager = this._getService('fileManager');
    if (!fileManager) return null;

    const pathResolver = this._getService('pathResolver');
    const normPath = pathResolver?.normalizeStoragePath?.(path) || path;

    const obj = await fileManager.loadFile(normPath);
    if (!obj) return null;

    const content = obj.content ?? obj.fileContent ?? obj.data;
    if (content instanceof ArrayBuffer) return content;
    if (ArrayBuffer.isView(content)) return content.buffer;
    if (typeof content === 'string') {
      try {
        const bin = atob(content);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr.buffer;
      } catch (_) {
        return null;
      }
    }

    return null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LuaTextBoxExtensions;
} else {
  window.LuaTextBoxExtensions = LuaTextBoxExtensions;
}
