// d2-viewer.js
// Viewer for .d2 texture files produced by TextureBuilder
// Parses the 32-byte D2TX header, decodes pixel data, renders to canvas

class D2Viewer extends ViewerBase {
  constructor(path) {
    super(path);
    this.fileData = null;
    this.header = null;
    this.isLoaded = false;
    this.isLoading = false;
    this.zoom = 1;
    this.canvas = null;

    // GPU renderer (D2Canvas)
    this._gpu = null;
    this._gpuTex = null;

    this.initializeUI();
    this.loadFileData();
  }

  // ── D2TX header layout ────────────────────────────────────────────
  // Offset  Size  Field
  // 0       4     Magic "D2TX"
  // 4       1     Version
  // 5       1     Format enum
  // 6       2     Width  (uint16 LE)
  // 8       2     Height (uint16 LE)
  // 10      2     Palette color count (uint16 LE)
  // 12      1     Palette offset (uint8)
  // 13      1     Flags (reserved)
  // 14      2     Reserved
  // 16      16    Reserved
  static HEADER_SIZE = 32;

  static FORMAT_NAMES = {
    0x01: 'd2_mode_i1',
    0x02: 'd2_mode_i2',
    0x04: 'd2_mode_i4',
    0x08: 'd2_mode_i8',
    0x09: 'd2_mode_ai44',
    0x10: 'd2_mode_rgb565',
    0x11: 'd2_mode_argb1555',
    0x12: 'd2_mode_rgba5551',
    0x13: 'd2_mode_rgb555',
    0x14: 'd2_mode_argb4444',
    0x15: 'd2_mode_rgba4444',
    0x16: 'd2_mode_rgb444',
    0x20: 'd2_mode_rgb888',
    0x21: 'd2_mode_rgba8888',
    0x22: 'd2_mode_argb8888',
    0x30: 'd2_mode_alpha1',
    0x31: 'd2_mode_alpha2',
    0x32: 'd2_mode_alpha4',
    0x33: 'd2_mode_alpha8',
  };

  static BITS_PER_PIXEL = {
    0x01: 1,   // i1
    0x02: 2,   // i2
    0x04: 4,   // i4
    0x08: 8,   // i8
    0x09: 8,   // ai44
    0x10: 16,  // rgb565
    0x11: 16,  // argb1555
    0x12: 16,  // rgba5551
    0x13: 16,  // rgb555
    0x14: 16,  // argb4444
    0x15: 16,  // rgba4444
    0x16: 16,  // rgb444
    0x20: 24,  // rgb888
    0x21: 32,  // rgba8888
    0x22: 32,  // argb8888
    0x30: 1,   // alpha1
    0x31: 2,   // alpha2
    0x32: 4,   // alpha4
    0x33: 8,   // alpha8
  };

  // ── UI ────────────────────────────────────────────────────────────
  initializeUI() {
    const bodyContainer = this.element.querySelector('.viewer-body');
    if (!bodyContainer) return;

    bodyContainer.innerHTML = `
      <div class="d2-viewer-container" style="display:flex;flex-direction:column;height:100%;background:#1a1a1a;color:#ccc;font-family:monospace;">
        <!-- Toolbar -->
        <div class="d2-toolbar" style="padding:6px 10px;background:#2d2d2d;border-bottom:1px solid #444;display:flex;gap:12px;align-items:center;flex-shrink:0;font-size:12px;">
          <span style="font-weight:bold;color:#80c0ff;">🖼️ D2 Texture Viewer</span>
          <span id="d2Info" style="color:#999;">Loading…</span>
          <span style="flex:1;"></span>
          <button id="d2ZoomOut" title="Zoom out" style="background:#444;border:none;color:#ccc;cursor:pointer;padding:2px 8px;border-radius:3px;">−</button>
          <span id="d2Zoom" style="min-width:40px;text-align:center;">1×</span>
          <button id="d2ZoomIn" title="Zoom in" style="background:#444;border:none;color:#ccc;cursor:pointer;padding:2px 8px;border-radius:3px;">+</button>
          <button id="d2ZoomFit" title="Fit to view" style="background:#444;border:none;color:#ccc;cursor:pointer;padding:2px 8px;border-radius:3px;">Fit</button>
          <span style="border-left:1px solid #555;height:16px;margin:0 4px;"></span>
          <button id="d2OpenHex" title="Open in Hex Viewer" style="background:#444;border:none;color:#ccc;cursor:pointer;padding:2px 8px;border-radius:3px;">Hex</button>
        </div>

        <!-- Header info panel -->
        <div id="d2Header" style="padding:6px 10px;background:#252525;border-bottom:1px solid #333;font-size:11px;display:none;flex-shrink:0;">
        </div>

        <!-- Palette controls (hidden until an indexed format is loaded) -->
        <div id="d2PaletteControls" style="display:none;padding:6px 10px;background:#252525;border-bottom:1px solid #333;font-size:11px;flex-shrink:0;">
          <span style="color:#80c0ff;font-weight:bold;margin-right:8px;">Palette:</span>
          <label style="margin-right:12px;">Index
            <select id="d2PalIdxSelect" style="background:#333;color:#ccc;border:1px solid #555;border-radius:3px;padding:1px 4px;font-size:11px;font-family:monospace;margin-left:4px;"></select>
          </label>
          <label>Offset
            <input id="d2PalOffsetInput" type="number" min="0" max="255" value="0" style="background:#333;color:#ccc;border:1px solid #555;border-radius:3px;padding:1px 4px;font-size:11px;font-family:monospace;width:50px;margin-left:4px;" />
          </label>
          <button id="d2PalApply" style="background:#4a9eff;border:none;color:#fff;cursor:pointer;padding:2px 10px;border-radius:3px;margin-left:8px;font-size:11px;">Apply</button>
          <span style="border-left:1px solid #555;height:16px;margin:0 8px;"></span>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input id="d2ColorKeyCheck" type="checkbox" style="accent-color:#4a9eff;cursor:pointer;" />
            <span>Show Color Key</span>
          </label>
        </div>

        <!-- Canvas area -->
        <div id="d2CanvasWrap" style="flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;position:relative;">
          <canvas id="d2Canvas" style="image-rendering:pixelated;background:repeating-conic-gradient(#333 0% 25%, #2a2a2a 0% 50%) 0 0 / 16px 16px;"></canvas>
          <div id="d2Status" style="position:absolute;color:#888;font-size:13px;text-align:center;">Loading…</div>
        </div>
      </div>
    `;

    this.canvas = bodyContainer.querySelector('#d2Canvas');

    // Zoom controls
    bodyContainer.querySelector('#d2ZoomIn').addEventListener('click', () => this.setZoom(this.zoom * 2));
    bodyContainer.querySelector('#d2ZoomOut').addEventListener('click', () => this.setZoom(this.zoom / 2));
    bodyContainer.querySelector('#d2ZoomFit').addEventListener('click', () => this.fitToView());

    // Open in Hex Viewer
    bodyContainer.querySelector('#d2OpenHex').addEventListener('click', () => this.openInHexViewer());

    // Palette apply button
    bodyContainer.querySelector('#d2PalApply').addEventListener('click', () => this.applyPaletteOverride());

    // Color key checkbox — toggle transparency for palette index 0
    this._showColorKey = false;
    bodyContainer.querySelector('#d2ColorKeyCheck').addEventListener('change', (e) => {
      this._showColorKey = e.target.checked;
      this._applyColorKeyToPalette();
    });
  }

  setZoom(z) {
    this.zoom = Math.max(0.125, Math.min(32, z));
    const label = this.element.querySelector('#d2Zoom');
    if (label) label.textContent = this.zoom >= 1 ? `${this.zoom}×` : `1/${Math.round(1 / this.zoom)}×`;
    if (this.canvas && this.canvas.width) {
      this.canvas.style.width = `${this.canvas.width * this.zoom}px`;
      this.canvas.style.height = `${this.canvas.height * this.zoom}px`;
    }
  }

  fitToView() {
    if (!this.canvas || !this.canvas.width || !this.canvas.height) return;
    const wrap = this.element.querySelector('#d2CanvasWrap');
    if (!wrap) return;
    const ww = wrap.clientWidth - 20;
    const wh = wrap.clientHeight - 20;
    const scale = Math.min(ww / this.canvas.width, wh / this.canvas.height, 16);
    // Round down to nearest power of 2 for crisp pixels
    const z = Math.pow(2, Math.floor(Math.log2(scale)));
    this.setZoom(Math.max(1, z));
  }

  // ── File loading ──────────────────────────────────────────────────
  async loadFileData() {
    if (this.isLoading) return;
    this.isLoading = true;
    const statusEl = this.element.querySelector('#d2Status');

    try {
      const fileManager = window.serviceContainer?.get('fileManager') || window.FileManager;
      const record = await fileManager?.loadFile(this.path);
      if (!record) throw new Error('File not found in storage');

      this.fileSize = record.size || 0;

      const content = record.content !== undefined ? record.content : record.fileContent;
      let arrayBuffer;
      if (content instanceof ArrayBuffer) {
        arrayBuffer = content;
      } else if (content instanceof Uint8Array || ArrayBuffer.isView(content)) {
        arrayBuffer = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
      } else if (typeof content === 'string' && content.length > 0) {
        // Might be base64 encoded
        try {
          const binary = atob(content);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          arrayBuffer = bytes.buffer;
        } catch (e) {
          const encoder = new TextEncoder();
          arrayBuffer = encoder.encode(content).buffer;
        }
      } else {
        throw new Error('Unknown content type');
      }

      this.fileData = new Uint8Array(arrayBuffer);
      this.fileSize = this.fileData.length;
      this.isLoaded = true;

      console.log(`[D2Viewer] Loaded ${this.fileData.length} bytes from ${this.path}`);

      await this.parseAndRender();
    } catch (error) {
      console.error('[D2Viewer] Failed to load:', error);
      if (statusEl) statusEl.textContent = `Error: ${error.message}`;
    } finally {
      this.isLoading = false;
    }
  }

  // ── Header parsing ────────────────────────────────────────────────
  parseHeader() {
    if (!this.fileData || this.fileData.length < D2Viewer.HEADER_SIZE) {
      throw new Error(`File too small for D2TX header (${this.fileData?.length || 0} bytes)`);
    }

    const view = new DataView(this.fileData.buffer, this.fileData.byteOffset, this.fileData.byteLength);

    // Check magic
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== 'D2TX') {
      throw new Error(`Invalid magic: "${magic}" (expected "D2TX")`);
    }

    const formatEnum = view.getUint8(5);
    const formatName = D2Viewer.FORMAT_NAMES[formatEnum] || `unknown(0x${formatEnum.toString(16)})`;
    const bpp = D2Viewer.BITS_PER_PIXEL[formatEnum] || 0;

    return {
      magic,
      version: view.getUint8(4),
      formatEnum,
      formatName,
      bpp,
      width: view.getUint16(6, true),
      height: view.getUint16(8, true),
      paletteIndex: view.getUint16(10, true),
      paletteOffset: view.getUint8(12),
      flags: view.getUint8(13),
    };
  }

  // ── Rendering ─────────────────────────────────────────────────────
  async parseAndRender() {
    const statusEl = this.element.querySelector('#d2Status');
    const infoEl = this.element.querySelector('#d2Info');
    const headerPanel = this.element.querySelector('#d2Header');

    try {
      this.header = this.parseHeader();
      const h = this.header;
      const isRLE = !!(h.flags & 0x01);
      const isPreRotated = !!(h.flags & 0x02);

      // Populate info bar
      const flagLabels = [];
      if (isRLE) flagLabels.push('RLE');
      if (isPreRotated) flagLabels.push('Rot90');
      const flagStr = flagLabels.length ? ` [${flagLabels.join(',')}]` : '';
      if (infoEl) {
        infoEl.textContent = `${h.width}×${h.height}  ${h.formatName}${flagStr}  ${this.formatSize(this.fileData.length)}`;
      }

      // Load palette for indexed formats.
      // Two mutually-exclusive paths — no fallback:
      //   A. Built .d2 (paletteIndex > 0): load from PMAP.
      //   B. Source .d2 (paletteIndex == 0): load via sibling .texture → palettePath → .act file.
      let palette = null;
      let paletteColorCount = 0;
      if (this.isIndexedFormat(h.formatEnum)) {
        if (h.paletteIndex > 0) {
          // (A) Built .d2 — palette is in the PMAP
          palette = await this.loadPaletteFromMap(h.paletteIndex);
          if (!palette) {
            throw new Error(`PMAP palette index ${h.paletteIndex} not found — was the project built?`);
          }
          paletteColorCount = palette.length / 4;
          console.log(`[D2Viewer] Loaded palette index ${h.paletteIndex}: ${paletteColorCount} colors`);
        } else {
          // (B) Source .d2 — rendering info comes from sibling .texture file
          const texInfo = await this._loadRenderInfoFromTexture();
          palette = texInfo.palette;
          paletteColorCount = palette.length / 4;
          // Override header paletteOffset with the .texture's authoritative value
          h.paletteOffset = texInfo.paletteOffset;
          // Auto-enable "Show Color Key" if the .texture has it enabled
          this._showColorKey = !!texInfo.useColorKey;
          const ckBox = this.element.querySelector('#d2ColorKeyCheck');
          if (ckBox) ckBox.checked = this._showColorKey;
          console.log(`[D2Viewer] Loaded palette via .texture → ${texInfo.palettePath} (${paletteColorCount} colors, offset ${texInfo.paletteOffset}, colorKey=${this._showColorKey})`);
        }
      }
      // Store on header for convenience
      h.paletteColorCount = paletteColorCount;
      h._palette = palette;

      // Discover how many palettes are in the PMAP (for the selector)
      this._pmapPaletteCount = await this._getPmapPaletteCount();

      // Populate palette controls for indexed formats
      this._populatePaletteControls(h);

      // Populate header detail panel
      if (headerPanel) {
        headerPanel.style.display = 'block';
        // Pixel data size for diagnostics
        const pixelBytes = this.fileData.length - D2Viewer.HEADER_SIZE;
        headerPanel.innerHTML = [
          `<b>Magic:</b> ${h.magic}`,
          `<b>Version:</b> ${h.version}`,
          `<b>Format:</b> ${h.formatName} (0x${h.formatEnum.toString(16).padStart(2, '0')})`,
          `<b>Size:</b> ${h.width} × ${h.height}`,
          `<b>BPP:</b> ${h.bpp}`,
          `<b>Palette index:</b> ${h.paletteIndex}`,
          `<b>Palette colors:</b> ${paletteColorCount}`,
          `<b>Palette offset:</b> ${h.paletteOffset}`,
          `<b>Pixel data:</b> ${pixelBytes} bytes`,
          `<b>Flags:</b> 0x${h.flags.toString(16).padStart(2, '0')} ${flagStr}`,
          `<b>File size:</b> ${this.formatSize(this.fileData.length)}`,
        ].map(s => `<span style="margin-right:16px;">${s}</span>`).join('');
      }

      // Render using D2Canvas GPU renderer
      this._renderImageGpu(palette, h, isPreRotated);

    } catch (error) {
      console.error('[D2Viewer] Parse/render error:', error);
      if (statusEl) statusEl.textContent = `Error: ${error.message}`;
      if (infoEl) infoEl.textContent = 'Invalid .d2 file';
    }
  }

  /**
   * GPU-accelerated rendering: upload the entire .d2 file to D2Canvas and blit.
   */
  _renderImageGpu(palette, h, isPreRotated) {
    const statusEl = this.element.querySelector('#d2Status');

    // Lazy-init D2Canvas
    if (!this._gpu) {
      try {
        this._gpu = new D2Canvas(this.canvas, { alpha: true, premultiplied: false });
      } catch (e) {
        console.error('[D2Viewer] D2Canvas init failed:', e);
        if (statusEl) statusEl.textContent = 'WebGL 2 not available';
        return;
      }
    }

    // Upload the complete .d2 file (D2Canvas handles header parsing + RLE decompression)
    if (this._gpuTex) {
      this._gpu.deleteTexture(this._gpuTex);
      this._gpuTex = null;
    }
    this._gpuTex = this._gpu.createTexture(this.fileData);

    // Set palette if available
    // Store original palette for color key toggle
    this._rawPalette = palette ? new Uint8Array(palette) : null;
    this._currentHeader = h;

    if (palette) {
      this._gpu.setPalette(palette);
    }
    this._gpu.setPaletteOffset(h.paletteOffset);

    // Apply color key if checkbox is checked
    if (this._showColorKey) {
      this._applyColorKeyToPalette();
    }

    // Blit (with un-rotation for pre-rotated textures)
    this._gpuBlit(isPreRotated);

    // Hide status, show canvas
    if (statusEl) statusEl.style.display = 'none';
    this.canvas.style.display = 'block';

    // Auto-fit
    this.fitToView();
  }

  /**
   * Toggle color key transparency: set alpha=0 on palette index 0 (and the
   * first index of each sub-palette chunk for sub-8-bit formats), then re-blit.
   */
  _applyColorKeyToPalette() {
    if (!this._gpu || !this._rawPalette || !this._currentHeader) return;

    const pal = new Uint8Array(this._rawPalette); // copy
    if (this._showColorKey) {
      // Determine chunk size from format
      const fmt = this._currentHeader.formatEnum;
      let chunkSize = 256; // I8 — one chunk
      if (fmt === D2_FORMAT.I4)  chunkSize = 16;
      else if (fmt === D2_FORMAT.I2)  chunkSize = 4;
      else if (fmt === D2_FORMAT.I1)  chunkSize = 2;

      // Set alpha=0 on index 0 of every chunk
      for (let base = 0; base < 256; base += chunkSize) {
        pal[base * 4 + 3] = 0; // alpha byte of this chunk's index 0
      }
    }
    this._gpu.setPalette(pal);
    this._gpu.setPaletteOffset(this._currentHeader.paletteOffset);

    const isPreRotated = !!(this._currentHeader.flags & 0x02);
    this._gpuBlit(isPreRotated);
  }

  /**
   * Clear + blit the current GPU texture. Handles un-rotation if needed.
   * @param {boolean} [isPreRotated]  If true, texture is stored rotated 90° CW.
   */
  _gpuBlit(isPreRotated) {
    if (!this._gpu || !this._gpuTex) return;
    const tex = this._gpuTex;

    // Logical display dimensions (pre-rotation is handled inside blit)
    const displayW = isPreRotated ? tex.height : tex.width;
    const displayH = isPreRotated ? tex.width  : tex.height;
    this._gpu.resize(displayW, displayH);
    this._gpu.clear(0, 0, 0, 0);
    this._gpu.blit(tex);
    this._gpu.present();
  }

  /**
   * Populate the palette controls bar (index selector, offset input).
   */
  _populatePaletteControls(h) {
    const panel = this.element.querySelector('#d2PaletteControls');
    if (!panel) return;

    if (!this.isIndexedFormat(h.formatEnum)) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'flex';
    panel.style.alignItems = 'center';

    // Populate palette index dropdown
    const select = this.element.querySelector('#d2PalIdxSelect');
    if (select) {
      select.innerHTML = '<option value="0">(none)</option>';
      const count = this._pmapPaletteCount || 0;
      for (let i = 1; i <= count; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `#${i}`;
        if (i === h.paletteIndex) opt.selected = true;
        select.appendChild(opt);
      }
    }

    // Set offset input
    const offsetInput = this.element.querySelector('#d2PalOffsetInput');
    if (offsetInput) {
      offsetInput.value = h.paletteOffset;
    }
  }

  /**
   * Handle "Apply" click — reload palette with chosen index & offset and re-render.
   * GPU-accelerated: only updates palette uniforms, no texture re-upload.
   */
  async applyPaletteOverride() {
    if (!this.header || !this._gpu || !this._gpuTex) return;
    const h = this.header;

    const select = this.element.querySelector('#d2PalIdxSelect');
    const offsetInput = this.element.querySelector('#d2PalOffsetInput');
    const newIdx = select ? parseInt(select.value) || 0 : h.paletteIndex;
    const newOffset = offsetInput ? parseInt(offsetInput.value) || 0 : h.paletteOffset;

    console.log(`[D2Viewer] Palette override: index ${newIdx}, offset ${newOffset}`);

    // Update header values
    h.paletteIndex = newIdx;
    h.paletteOffset = newOffset;

    // Reload palette if index changed
    let palette = null;
    if (newIdx > 0 && this.isIndexedFormat(h.formatEnum)) {
      palette = await this.loadPaletteFromMap(newIdx);
      if (palette) {
        h._palette = palette;
        h.paletteColorCount = palette.length / 4;
        console.log(`[D2Viewer] Loaded palette index ${newIdx}: ${h.paletteColorCount} colors`);
      }
    }

    // Update GPU palette and offset (no texture re-upload needed)
    const palData = palette || h._palette;
    if (palData) {
      this._gpu.setPalette(palData);
    }
    this._gpu.setPaletteOffset(newOffset);

    // Re-blit
    const isPreRotated = !!(h.flags & 0x02);
    this._gpuBlit(isPreRotated);
  }

  /**
   * Count how many palettes are in the PMAP (for the dropdown).
   */
  async _getPmapPaletteCount() {
    try {
      const pmapPath = this.resolvePmapPath();
      if (!pmapPath) return 0;

      let raw = null;
      const fileManager = window.serviceContainer?.get('fileManager');
      if (fileManager) {
        const obj = await fileManager.loadFile(pmapPath);
        if (obj) raw = obj.content !== undefined ? obj.content : (obj.fileContent ?? obj.data);
      }
      if (!raw && window.fileIOService) {
        const obj = await window.fileIOService.loadFile(pmapPath);
        if (obj) raw = obj.content !== undefined ? obj.content : (obj.fileContent ?? obj.data);
      }
      if (!raw) return 0;

      let bytes;
      if (raw instanceof ArrayBuffer) {
        bytes = new Uint8Array(raw);
      } else if (ArrayBuffer.isView(raw)) {
        bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      } else if (typeof raw === 'string') {
        const bin = atob(raw);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        return 0;
      }
      if (bytes.length < 8) return 0;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return view.getUint16(6, true);
    } catch (e) {
      return 0;
    }
  }

  /**
   * Load a palette from the PMAP file by its 1-based index.
   * Returns a Uint8Array of RGBA32 entries (4 bytes per color), or null.
   */
  async loadPaletteFromMap(paletteIndex) {
    try {
      // Determine PMAP path — try build folder relative to the .d2 file first
      const pmapPath = this.resolvePmapPath();
      if (!pmapPath) return null;

      // Load via fileIOService / fileManager
      let raw = null;
      const fileManager = window.serviceContainer?.get('fileManager');
      if (fileManager) {
        const obj = await fileManager.loadFile(pmapPath);
        if (obj) raw = obj.content !== undefined ? obj.content : (obj.fileContent ?? obj.data);
      }
      if (!raw && window.fileIOService) {
        const obj = await window.fileIOService.loadFile(pmapPath);
        if (obj) raw = obj.content !== undefined ? obj.content : (obj.fileContent ?? obj.data);
      }
      if (!raw) {
        console.warn(`[D2Viewer] palette_map.pmap not found at ${pmapPath}`);
        return null;
      }

      // Normalise to Uint8Array
      let bytes;
      if (raw instanceof ArrayBuffer) {
        bytes = new Uint8Array(raw);
      } else if (ArrayBuffer.isView(raw)) {
        bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      } else if (typeof raw === 'string') {
        // Might be base64-encoded binary
        const bin = atob(raw);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        console.warn('[D2Viewer] Unexpected PMAP content type');
        return null;
      }

      // Parse PMAP header
      if (bytes.length < 8) return null;
      const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      if (magic !== 'PMAP') {
        console.warn(`[D2Viewer] Invalid PMAP magic: "${magic}"`);
        return null;
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const count = view.getUint16(6, true);

      // Walk to the requested index (1-based)
      let offset = 8;
      for (let i = 1; i <= count; i++) {
        const colorCount = view.getUint16(offset, true);
        const palByteLen = colorCount * 4;
        offset += 2;
        if (i === paletteIndex) {
          return new Uint8Array(bytes.buffer, bytes.byteOffset + offset, palByteLen);
        }
        offset += palByteLen;
      }

      console.warn(`[D2Viewer] Palette index ${paletteIndex} out of range (map has ${count})`);
      return null;
    } catch (err) {
      console.error('[D2Viewer] Failed to load palette map:', err);
      return null;
    }
  }

  /**
   * Load rendering parameters from the sibling .texture file.
   * The .texture is the single source of truth for palettePath, paletteOffset,
   * and transparentColor (color key) for source .d2 files.
   *
   * Throws on any missing or corrupt data — there is no fallback.
   *
   * @returns {Promise<{palette: Uint8Array, paletteOffset: number, transparentColor: string, palettePath: string}>}
   */
  async _loadRenderInfoFromTexture() {
    if (!this.path) throw new Error('D2 file path not set');

    const texturePath = this.path.replace(/\.d2$/i, '.texture');
    if (texturePath === this.path) throw new Error(`Cannot derive .texture path from: ${this.path}`);

    // Load .texture JSON
    const raw = await this._loadFileRaw(texturePath);
    if (!raw) throw new Error(`Sibling .texture file not found: ${texturePath}`);

    let text = raw;
    if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
      const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw)
        : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      text = new TextDecoder('utf-8').decode(bytes);
    }
    const json = JSON.parse(text);

    // Read rendering parameters from .texture
    const palettePath  = json.metadata?.palettePath || json.palettePath || '';
    const paletteOffset = json.metadata?.paletteOffset ?? json.paletteOffset ?? 0;
    const transparentColor = json.transparentColor ?? '#FF00FF';
    const useColorKey = !!json.useColorKey;

    if (!palettePath) {
      throw new Error(`.texture has no palettePath — open in Texture Editor and apply a palette first (${texturePath})`);
    }

    // Load the palette file referenced by palettePath
    const palRaw = await this._loadFileRaw(palettePath);
    if (!palRaw) throw new Error(`Palette file not found: ${palettePath} (referenced by ${texturePath})`);

    // Parse palette using Palette class
    const pal = new Palette();
    await pal.loadFromContent(palRaw, palettePath.split('/').pop());
    const colors = pal.getColors();
    if (!colors || colors.length === 0) {
      throw new Error(`Palette file is empty: ${palettePath}`);
    }

    // Convert hex strings → RGBA32 Uint8Array (same format as PMAP palettes)
    const rgba = new Uint8Array(colors.length * 4);
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i];
      let r = 0, g = 0, b = 0;
      if (typeof c === 'string' && c.startsWith('#')) {
        r = parseInt(c.substring(1, 3), 16) || 0;
        g = parseInt(c.substring(3, 5), 16) || 0;
        b = parseInt(c.substring(5, 7), 16) || 0;
      }
      const off = i * 4;
      rgba[off]     = r;
      rgba[off + 1] = g;
      rgba[off + 2] = b;
      rgba[off + 3] = 255;
    }

    return { palette: rgba, paletteOffset, transparentColor, palettePath, useColorKey };
  }

  /**
   * Load a file's raw content from storage. Tries fileManager first, then fileIOService.
   * @param {string} storagePath  Path with or without project prefix.
   * @returns {Promise<string|ArrayBuffer|null>}
   */
  async _loadFileRaw(storagePath) {
    const fileManager = window.serviceContainer?.get('fileManager');
    if (fileManager) {
      const obj = await fileManager.loadFile(storagePath);
      if (obj) return obj.content ?? obj.fileContent ?? obj.data;
    }
    if (window.fileIOService) {
      const obj = await window.fileIOService.loadFile(storagePath);
      if (obj) return obj.content ?? obj.fileContent ?? obj.data;
    }
    return null;
  }

  /**
   * Calculate expected raw (uncompressed) pixel data size for the current header.
   */
  calcExpectedBytes(h) {
    const totalPixels = h.width * h.height;
    const bpp = h.bpp || 8;
    return Math.ceil(totalPixels * bpp / 8);
  }

  /**
   * Resolve the palette_map.pmap path relative to the current .d2 file.
   */
  resolvePmapPath() {
    if (!this.path) return null;

    // The .d2 file lives in the build folder (e.g., "proj/build/Images/sprite.d2").
    // The PMAP sits at the build root (e.g., "proj/build/palette_map.pmap").
    const buildPrefix = (window.ProjectPaths && typeof window.ProjectPaths.getBuildStoragePrefix === 'function')
      ? window.ProjectPaths.getBuildStoragePrefix()
      : null;

    if (buildPrefix && this.path.startsWith(buildPrefix)) {
      return buildPrefix + 'palette_map.pmap';
    }

    // Fallback: walk up from the file until we hit a "build/" segment
    const parts = this.path.split('/');
    const buildIdx = parts.indexOf('build');
    if (buildIdx >= 0) {
      return parts.slice(0, buildIdx + 1).join('/') + '/palette_map.pmap';
    }

    // Last resort: same directory
    const dir = this.path.substring(0, this.path.lastIndexOf('/') + 1);
    return dir + 'palette_map.pmap';
  }

  isIndexedFormat(fmt) {
    return fmt >= 0x01 && fmt <= 0x09;
  }

  // ── Utility ───────────────────────────────────────────────────────
  formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Open this file in a new Hex Viewer tab
  openInHexViewer() {
    try {
      const tabManager = window.serviceContainer?.get('tabManager');
      if (tabManager && window.HexViewer) {
        tabManager.openInTab(this.path, {
          type: 'viewer',
          class: window.HexViewer,
          name: 'hex',
          displayName: 'Hex Viewer'
        }, { forceNew: true });
      } else {
        console.warn('[D2Viewer] TabManager or HexViewer not available');
      }
    } catch (err) {
      console.error('[D2Viewer] Failed to open hex viewer:', err);
    }
  }

  // Reload when file changes (e.g., after a build)
  async refreshContent() {
    this.isLoaded = false;
    this.isLoading = false;
    this.fileData = null;
    this.header = null;
    // Release old GPU texture (D2Canvas instance is reused)
    if (this._gpuTex && this._gpu) {
      this._gpu.deleteTexture(this._gpuTex);
      this._gpuTex = null;
    }
    await this.loadFileData();
  }

  // ── ViewerBase lifecycle ──────────────────────────────────────────
  loseFocus() {}
  cleanup() {
    // Clean up GPU resources
    if (this._gpuTex && this._gpu) {
      this._gpu.deleteTexture(this._gpuTex);
      this._gpuTex = null;
    }
    if (this._gpu) {
      this._gpu.destroy();
      this._gpu = null;
    }
  }
  onFocus() {}
  onBlur() { this.loseFocus(); }
  onClose() { this.cleanup(); }
}

// Export
window.D2Viewer = D2Viewer;
console.log('[D2Viewer] Class exported to window.D2Viewer');

// Static metadata for auto-registration
D2Viewer.getFileExtensions = () => ['.d2'];
D2Viewer.getDisplayName = () => 'D2 Texture Viewer';
D2Viewer.getIcon = () => '🖼️';
D2Viewer.getPriority = () => 5; // Higher priority than hex viewer
D2Viewer.getCapabilities = () => ['texture-preview', 'binary-display'];

// Auto-register with ComponentRegistry if available
if (typeof ComponentRegistry !== 'undefined') {
  D2Viewer.registerComponent();
}
