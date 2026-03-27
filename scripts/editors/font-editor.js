// font-editor.js
// Editor for creating and editing bitmap fonts (.fnt BMFont binary format)
// Uses FontAtlasGenerator for TTF→atlas rendering and BMFont parsing.

console.log('[FontEditor] Class definition loading');

class FontEditor extends EditorBase {
  constructor(fileObject = null, readOnly = false) {
    console.log('[FontEditor] Constructor called:', fileObject, readOnly);
    super(fileObject, readOnly);

    this.gen = new FontAtlasGenerator();
    this.result = null;   // {canvas, glyphs, lineHeight, base, width, height, ...}
    this.zoom = 1;
    this.loadedFontFamily = null;
    this.sourceFontPath = null;              // Path to source TTF in project
    this.outputPixelFormat = 'd2_mode_alpha8'; // Default format for fonts
    this._sourceFontBlob = null;             // ArrayBuffer of loaded TTF

    // UI refs (set in createBody)
    this.ui = {};

    this.initializeEditor();
  }

  // ── static metadata ─────────────────────────────────
  static getFileExtensions() { return ['.font']; }
  static getFileExtension()  { return '.font'; }
  static getDisplayName()    { return 'Font Editor'; }
  static getIcon()           { return '🔤'; }
  static getPriority()       { return 10; }
  static getCapabilities()   { return ['font-editing']; }
  static canCreate = true;
  static getCreateIcon()     { return '🔤'; }
  static getCreateLabel()    { return 'Font'; }
  static getDefaultFolder()  { return 'Fonts'; }
  static needsFilenamePrompt = true;

  // ── lifecycle ───────────────────────────────────────

  initializeEditor() {
    // Container is built via createBody
    this.container = document.createElement('div');
    this.container.className = 'font-editor';
    this.container.innerHTML = this._buildHTML();
    this._bindUI();
    this._attachListeners();

    if (!this.isNewResource) {
      this.loadFileContent().catch(err =>
        console.error('[FontEditor] Failed to load content:', err));
    }
  }

  getElement() {
    if (this.element !== this.container) {
      this.element = this.container;
      this.element.classList.add('viewer-content', 'editor-content');
    }
    return this.element;
  }

  // ── file I/O ────────────────────────────────────────

  async loadFileContent() {
    console.log(`[FontEditor] loadFileContent() path=${this.path}`);
    if (!this.file) return;

    let content = null;

    // Load from persistent storage
    if (window.fileIOService && this.path) {
      const storagePath = window.ProjectPaths?.normalizeStoragePath?.(this.path) || this.path;
      const stored = await window.fileIOService.loadFile(storagePath);
      if (stored) {
        let raw = stored.content !== undefined ? stored.content : stored.fileContent;
        if (stored.binaryData && typeof raw === 'string') {
          const bin = atob(raw);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          raw = bytes.buffer;
        }
        content = raw;
      }
    }

    // Fallback to the file object itself
    if (!content && this.file.content) content = this.file.content;
    if (!content && this.file.fileContent) content = this.file.fileContent;

    if (!content) {
      console.warn('[FontEditor] No content found for', this.path);
      return;
    }

    // Try JSON parse first (new metadata format)
    try {
      const text = typeof content === 'string' ? content : null;
      if (text) {
        const data = JSON.parse(text);
        if (data && data.type === 'retrowatch-font') {
          await this._loadFromMetadata(data);
          return;
        }
      }
    } catch (e) { /* not JSON — try legacy BMFont binary below */ }

    // Legacy: BMFont binary format
    if (content instanceof Uint8Array) content = content.buffer;
    if (typeof content === 'string') {
      const bin = atob(content);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      content = bytes.buffer;
    }

    try {
      const parsed = FontAtlasGenerator.parseBMFont(content);
      console.log('[FontEditor] Parsed legacy .fnt:', parsed.info?.fontName,
        parsed.glyphs.length, 'glyphs');

      let atlasImage = null;
      const pageName = parsed.pages[0] || '';
      if (pageName && this.path) {
        atlasImage = await this._loadProjectImage(pageName);
      }

      this.result = FontAtlasGenerator.bmfontToResult(parsed, atlasImage);

      this.ui.fontName.value  = parsed.info?.fontName || '';
      this.ui.fontSize.value  = parsed.info?.fontSize || 32;
      this.ui.padding.value   = parsed.info?.padding?.[0] ?? 0;
      this.ui.spacing.value   = parsed.info?.spacing?.[0] ?? 0;
      this.ui.chars.value     = this.result.glyphs.map(g => g.char).join('');

      this._showResult();
    } catch (err) {
      console.error('[FontEditor] Failed to parse .fnt:', err);
    }
  }

  async _loadFromMetadata(data) {
    console.log('[FontEditor] Loading from metadata:', data.fontFamily, data.fontSize);

    // Restore UI fields
    this.ui.fontName.value    = data.fontFamily || '';
    this.ui.fontSize.value    = data.fontSize || 32;
    this._syncSizeInputs('slider');
    this.ui.padding.value     = data.padding ?? 0;
    this.ui.spacing.value     = data.spacing ?? 0;
    this.ui.chars.value       = data.characters || '';
    this.ui.antialias.checked = !!data.antialias;

    this.sourceFontPath    = data.sourceFontPath || null;
    this.outputPixelFormat = data.outputPixelFormat || 'd2_mode_alpha8';
    this._updateFormatLabel();

    // Try to load source font and regenerate
    if (this.sourceFontPath) {
      const loaded = await this._loadSourceFontFromStorage(this.sourceFontPath);
      if (loaded) {
        this._generate();
        return;
      }
    }

    // If source font not available, try to load companion atlas for display only
    if (data.atlasPage && this.path) {
      const atlasImage = await this._loadProjectImage(data.atlasPage);
      if (atlasImage) {
        const canvas = document.createElement('canvas');
        canvas.width = atlasImage.width;
        canvas.height = atlasImage.height;
        canvas.getContext('2d').drawImage(atlasImage, 0, 0);
        this.result = {
          canvas,
          width: atlasImage.width,
          height: atlasImage.height,
          glyphs: [],
          lineHeight: data.fontSize || 32,
          base: data.fontSize || 32
        };
        this._showResult();
      }
    }
  }

  async _loadSourceFontFromStorage(fontPath) {
    try {
      if (!window.fileIOService) return false;
      const storagePath = window.ProjectPaths?.normalizeStoragePath?.(fontPath) || fontPath;
      const stored = await window.fileIOService.loadFile(storagePath);
      if (!stored) return false;

      let raw = stored.content !== undefined ? stored.content : stored.fileContent;
      if (stored.binaryData && typeof raw === 'string') {
        const bin = atob(raw);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        raw = bytes.buffer;
      }
      if (!raw) return false;

      const family = this.ui.fontName.value.trim() || 'loaded_font';
      this.loadedFontFamily = family;
      const buf = raw instanceof ArrayBuffer ? raw : new Uint8Array(raw).buffer;
      const blob = new Blob([buf], { type: 'font/ttf' });
      const file = new File([blob], fontPath.split('/').pop() || 'font.ttf', { type: 'font/ttf' });

      await this.gen.loadFont(file, family);
      this._sourceFontBlob = buf;
      console.log('[FontEditor] Loaded source font from storage:', fontPath);
      return true;
    } catch (e) {
      console.warn('[FontEditor] Could not load source font:', e.message);
      return false;
    }
  }

  async _loadProjectImage(pageName) {
    // Try to resolve the atlas PNG relative to the .fnt file's folder
    if (!this.path) return null;
    const folder = this.path.substring(0, this.path.lastIndexOf('/'));
    const imgPath = folder ? `${folder}/${pageName}` : pageName;
    const storagePath = window.ProjectPaths?.normalizeStoragePath?.(imgPath) || imgPath;

    try {
      if (!window.fileIOService) return null;
      const stored = await window.fileIOService.loadFile(storagePath);
      if (!stored) return null;

      let raw = stored.content !== undefined ? stored.content : stored.fileContent;
      // Convert to blob URL for Image loading
      let blob;
      if (raw instanceof ArrayBuffer || raw instanceof Uint8Array) {
        blob = new Blob([raw], { type: 'image/png' });
      } else if (stored.binaryData && typeof raw === 'string') {
        const bin = atob(raw);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blob = new Blob([bytes], { type: 'image/png' });
      } else {
        return null;
      }

      return await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load atlas image')); };
        img.src = url;
      });
    } catch (e) {
      console.warn('[FontEditor] Could not load companion atlas:', e.message);
      return null;
    }
  }

  /** Derive companion base name from the .font file path (e.g. "7seg.font" → "7seg") */
  _baseName() {
    if (this.path) {
      const filename = this.path.split('/').pop();
      return filename.replace(/\.font$/i, '');
    }
    const name = this.ui.fontName.value.trim() || 'font';
    return `${name}_${parseInt(this.ui.fontSize.value) || 32}`;
  }

  /** Derive the folder containing the .font file */
  _fontFolder() {
    if (!this.path) return '';
    const idx = this.path.lastIndexOf('/');
    return idx >= 0 ? this.path.substring(0, idx) : '';
  }

  getContent() {
    const name = this.ui.fontName.value.trim() || 'font';
    const size = parseInt(this.ui.fontSize.value) || 32;
    const base = this._baseName();
    return JSON.stringify({
      type: 'retrowatch-font',
      version: 1,
      sourceFontPath: this.sourceFontPath || '',
      fontFamily: name,
      fontSize: size,
      padding: parseInt(this.ui.padding.value) || 0,
      spacing: parseInt(this.ui.spacing.value) || 0,
      characters: this.ui.chars.value,
      antialias: this.ui.antialias.checked,
      outputPixelFormat: this.outputPixelFormat || 'd2_mode_alpha8',
      atlasPage: this.result ? `${base}.png` : ''
    }, null, 2);
  }

  async save() {
    try {
      // Save the .font JSON metadata via base class (this sets this.path for new files)
      await super.save();

      // Now this.path is set — derive companion names from it
      if (this.path) {
        const folder = this._fontFolder();
        const base = this._baseName();

        // Save source TTF (always, if we have the blob)
        if (this._sourceFontBlob) {
          await this._saveSourceFont(folder);
        }

        if (this.result) {
          // Save companion atlas PNG (source image)
          await this._saveCompanionAtlas(folder, base);

          // Save BMFont .fnt binary
          await this._saveCompanionFnt(folder, base);

          // Save .d2 texture
          await this._saveCompanionD2(folder, base);
        }

        // Refresh project tree to show any newly added companions
        const pe = window.serviceContainer?.get('projectExplorer')
                || window.gameEmulator?.projectExplorer;
        if (pe && typeof pe.renderTree === 'function') pe.renderTree();
      }

      console.log(`[FontEditor] Save complete: ${this.path}`);
    } catch (error) {
      console.error('[FontEditor] Save failed:', error);
      alert('Failed to save font: ' + error.message);
    }
  }

  async _saveSourceFont(folder) {
    // Derive TTF filename from the original file name if known, else from font family
    const origName = this.sourceFontPath ? this.sourceFontPath.split('/').pop() : null;
    const filename = origName || (this.ui.fontName.value.trim() || 'font') + '.ttf';
    const fontPath = folder ? `${folder}/${filename}` : filename;
    const storagePath = window.ProjectPaths?.normalizeStoragePath?.(fontPath) || fontPath;

    if (window.fileIOService && this._sourceFontBlob) {
      await window.fileIOService.saveFile(storagePath, this._sourceFontBlob, {
        type: '.ttf',
        binaryData: true,
        editor: 'FontEditor'
      });
      this.sourceFontPath = fontPath;
      console.log(`[FontEditor] Saved source font: ${storagePath}`);

      // Add TTF to project tree so it's visible in the explorer
      this._addCompanionToProjectTree(filename, fontPath);
    }
  }

  async _saveCompanionAtlas(folder, base) {
    if (!this.result?.canvas) return;
    const blob = await this.gen.toPNG(this.result.canvas);
    const pngBuf = await blob.arrayBuffer();
    const pngPath = folder ? `${folder}/${base}.png` : `${base}.png`;
    const pngStorage = window.ProjectPaths?.normalizeStoragePath?.(pngPath) || pngPath;

    if (window.fileIOService) {
      await window.fileIOService.saveFile(pngStorage, pngBuf, {
        type: '.png',
        binaryData: true,
        editor: 'FontEditor'
      });
      console.log(`[FontEditor] Saved companion atlas: ${pngStorage}`);
    }
  }

  async _saveCompanionFnt(folder, base) {
    if (!this.result) return;
    const fntBin = this.gen.toBMFontBinary(this.result, `${base}.png`);
    const fntPath = folder ? `${folder}/${base}.fnt` : `${base}.fnt`;
    const fntStorage = window.ProjectPaths?.normalizeStoragePath?.(fntPath) || fntPath;

    if (window.fileIOService) {
      await window.fileIOService.saveFile(fntStorage, fntBin, {
        type: '.fnt',
        binaryData: true,
        editor: 'FontEditor'
      });
      console.log(`[FontEditor] Saved BMFont binary: ${fntStorage}`);
    }
  }

  async _saveCompanionD2(folder, base) {
    if (!this.result?.canvas) return;
    if (typeof D2File === 'undefined' || typeof FORMAT_STRING_TO_ENUM === 'undefined') {
      console.warn('[FontEditor] D2File/buildD2TX not available, skipping .d2 save');
      return;
    }

    const format = this.outputPixelFormat || 'd2_mode_alpha8';
    const { canvas } = this.result;
    const ctx = canvas.getContext('2d');
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    // Convert RGBA to target format bytes
    const formatBytes = D2File.convertRGBAToFormat(rgba, format);
    const fmtEnum = FORMAT_STRING_TO_ENUM[format] || D2_FORMAT.ALPHA8;

    // Build D2TX binary
    const d2Bytes = buildD2TX(canvas.width, canvas.height, fmtEnum, formatBytes, {
      paletteOffset: 0
    });

    const d2Path = folder ? `${folder}/${base}.d2` : `${base}.d2`;
    const d2Storage = window.ProjectPaths?.normalizeStoragePath?.(d2Path) || d2Path;

    // Save directly via fileIOService (not D2File.save) to avoid addToProjectTree
    // re-routing the file to the wrong folder
    const fileService = window.serviceContainer?.get('fileIOService') || window.fileIOService;
    if (fileService) {
      await fileService.saveFile(d2Storage, d2Bytes, { binaryData: true });
    }
    console.log(`[FontEditor] Saved D2 texture: ${d2Storage} (${d2Bytes.length} bytes)`);
  }

  /** Add a companion file entry to the project tree (metadata only, content already in storage) */
  _addCompanionToProjectTree(filename, storagePath) {
    const pe = window.serviceContainer?.get('projectExplorer')
            || window.gameEmulator?.projectExplorer;
    if (!pe) return;
    // Derive the UI folder from displayPath (set by saveNewResource)
    const uiFolder = this.displayPath
      ? this.displayPath.substring(0, this.displayPath.lastIndexOf('/'))
      : null;
    if (!uiFolder) return;
    pe.addFileToProject(
      { name: filename, path: `${uiFolder}/${filename}` },
      uiFolder, true, true  // skipAutoOpen, skipRender
    );
  }

  // ── HTML template ───────────────────────────────────

  _buildHTML() {
    return `
      <div class="fe-toolbar">
        <div class="fe-field">
          <label>Font File</label>
          <input type="file" class="fe-fontFile" accept=".ttf,.otf,.woff,.woff2,.fnt,.png" multiple>
        </div>
        <div class="fe-field">
          <label>Font Name</label>
          <input type="text" class="fe-fontName" placeholder="auto-detected">
        </div>
        <div class="fe-field">
          <label>Size (px)</label>
          <div class="fe-sizeControls">
            <input type="range" class="fe-fontSize" value="32" min="6" max="256" step="1">
            <input type="number" class="fe-fontSizeNumber" value="32" min="6" max="256" step="1">
          </div>
        </div>
        <div class="fe-field">
          <label>Padding</label>
          <input type="number" class="fe-padding" value="1" min="0" max="8">
        </div>
        <div class="fe-field">
          <label>Spacing</label>
          <input type="number" class="fe-spacing" value="1" min="0" max="8">
        </div>
        <div class="fe-field">
          <label>Characters</label>
          <textarea class="fe-chars" rows="1">ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,;:!?'"()-+*/=@#$%&amp;_[]{}|&lt;&gt;~\`^\\/</textarea>
        </div>
        <div class="fe-cb-row">
          <input type="checkbox" class="fe-antialias"><label>Anti-alias</label>
        </div>
      </div>

      <div class="fe-busy" style="display:none">
        <div class="fe-busyText">Loading font...</div>
        <progress class="fe-busyProgress" max="100" value="0"></progress>
      </div>

      <div class="fe-main">
        <div class="fe-preview-panel">
          <div class="fe-preview-header">
            <span class="fe-atlasInfo">No atlas generated</span>
            <div class="fe-zoom-controls">
              <button class="fe-zoomOut">−</button>
              <span class="fe-zoomLevel">1×</span>
              <button class="fe-zoomIn">+</button>
              <button class="fe-zoomFit" title="Fit">⊞</button>
            </div>
          </div>
          <div class="fe-canvas-wrap">
            <canvas class="fe-atlasCanvas" width="1" height="1"></canvas>
          </div>
          <div class="fe-text-preview-section">
            <label>Text Preview (448 × 368 watch display)</label>
            <input type="text" class="fe-previewText" value="The quick brown fox jumps over the lazy dog">
            <div class="fe-text-preview-canvas">
              <canvas class="fe-previewCanvas" width="448" height="368"></canvas>
              <span class="fe-watch-label">448×368</span>
            </div>
          </div>
        </div>

        <div class="fe-info-panel">
          <h3>Stats</h3>
          <div class="fe-stats">
            Glyphs: <span class="fe-statGlyphs">–</span><br>
            Atlas:  <span class="fe-statSize">–</span><br>
            Line H: <span class="fe-statLineH">–</span><br>
            Base:   <span class="fe-statBase">–</span>
          </div>

          <div class="fe-glyph-detail" style="display:none">
            <h3>Glyph</h3>
            <div class="fe-glyph-char"></div>
            <table>
              <tr><td>Code</td><td class="fe-gdCode"></td></tr>
              <tr><td>Position</td><td class="fe-gdXY"></td></tr>
              <tr><td>Size</td><td class="fe-gdSize"></td></tr>
              <tr><td>X Offset</td><td class="fe-gdXOff"></td></tr>
              <tr><td>Y Offset</td><td class="fe-gdYOff"></td></tr>
              <tr><td>X Advance</td><td class="fe-gdXAdv"></td></tr>
            </table>
          </div>

          <div class="fe-format-section">
            <h3>Output</h3>
            <div class="fe-format-row">
              <label>Format: <span class="fe-formatValue">Alpha 8-bit</span></label>
              <button class="fe-formatBtn">Select Format</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  _bindUI() {
    const q = (sel) => this.container.querySelector(sel);
    this.ui = {
      fontFile:     q('.fe-fontFile'),
      fontName:     q('.fe-fontName'),
      fontSize:     q('.fe-fontSize'),
      fontSizeNumber:q('.fe-fontSizeNumber'),
      padding:      q('.fe-padding'),
      spacing:      q('.fe-spacing'),
      chars:        q('.fe-chars'),
      antialias:    q('.fe-antialias'),
      busyWrap:     q('.fe-busy'),
      busyText:     q('.fe-busyText'),
      busyProgress: q('.fe-busyProgress'),
      atlasCanvas:  q('.fe-atlasCanvas'),
      canvasWrap:   q('.fe-canvas-wrap'),
      atlasInfo:    q('.fe-atlasInfo'),
      zoomLevel:    q('.fe-zoomLevel'),
      previewText:  q('.fe-previewText'),
      previewCanvas:q('.fe-previewCanvas'),
      statGlyphs:   q('.fe-statGlyphs'),
      statSize:     q('.fe-statSize'),
      statLineH:    q('.fe-statLineH'),
      statBase:     q('.fe-statBase'),
      glyphDetail:  q('.fe-glyph-detail'),
      glyphChar:    q('.fe-glyph-char'),
      gdCode:       q('.fe-gdCode'),
      gdXY:         q('.fe-gdXY'),
      gdSize:       q('.fe-gdSize'),
      gdXOff:       q('.fe-gdXOff'),
      gdYOff:       q('.fe-gdYOff'),
      gdXAdv:       q('.fe-gdXAdv'),
      formatValue:  q('.fe-formatValue'),
      formatBtn:    q('.fe-formatBtn'),
    };
  }

  // ── event wiring ────────────────────────────────────

  _attachListeners() {
    const { ui } = this;

    // Font file import (TTF or .fnt + PNG)
    ui.fontFile.addEventListener('change', async () => {
      const files = Array.from(ui.fontFile.files);
      if (!files.length) return;

      const fntFile = files.find(f => f.name.toLowerCase().endsWith('.fnt'));

      if (fntFile) {
        await this._importFnt(fntFile, files);
      } else {
        await this._loadTtf(files[0]);
      }
    });

    // Auto-generate when font parameters change
    ui.fontSize.addEventListener('input', () => {
      this._syncSizeInputs('slider');
      this._queueGenerate();
    });
    ui.fontSizeNumber.addEventListener('input', () => {
      this._syncSizeInputs('number');
      this._queueGenerate();
    });
    ui.fontName.addEventListener('input', () => this._queueGenerate());
    ui.padding.addEventListener('input', () => this._queueGenerate());
    ui.spacing.addEventListener('input', () => this._queueGenerate());
    ui.chars.addEventListener('input', () => this._queueGenerate());
    ui.antialias.addEventListener('change', () => this._queueGenerate());

    // Zoom
    ui.canvasWrap.querySelector('.fe-zoomIn')?.addEventListener('click',  () => this._setZoom(this.zoom * 2));
    this.container.querySelector('.fe-zoomOut')?.addEventListener('click', () => this._setZoom(this.zoom / 2));
    this.container.querySelector('.fe-zoomFit')?.addEventListener('click', () => this._zoomFit());

    // Atlas click → glyph detail
    ui.atlasCanvas.addEventListener('click', (e) => this._onAtlasClick(e));

    // Text preview
    ui.previewText.addEventListener('input', () => this._renderTextPreview());

    // Format selection
    ui.formatBtn.addEventListener('click', () => this._showFormatSelectionModal());

    this._syncSizeInputs('slider');
  }

  // ── font loading ────────────────────────────────────

  /** Public API — load a TTF/OTF file and enable generation */
  async loadTtfFile(file) {
    return this._loadTtf(file);
  }

  async _loadTtf(file) {
    const raw = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    this.loadedFontFamily = raw;
    this.ui.fontName.value = raw;

    // Store the font data for later save
    try {
      this._setBusy('Reading font file...', 20);
      this._sourceFontBlob = await file.arrayBuffer();
    } catch (e) {
      console.warn('[FontEditor] Could not read font file bytes:', e);
    }

    // Calculate source font path (font is saved to Fonts folder by project-explorer)
    const gameEngine = window.gameEmulator || window.gameEditor;
    const project = gameEngine?.projectExplorer?.getFocusedProjectName?.();
    const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi)
      ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
    if (project) {
      this.sourceFontPath = `${project}/${sourcesRoot}/Fonts/${file.name}`;
    }

    try {
      this._setBusy('Registering font...', 60);
      await this.gen.loadFont(file, raw);
      this._setBusy('Generating atlas...', 90);
      this._queueGenerate(true);
      this._setBusy('Ready', 100);
      setTimeout(() => this._clearBusy(), 120);
    } catch (e) {
      console.error('[FontEditor] Failed to load font:', e);
    } finally {
      this._clearBusy();
    }
  }

  async _importFnt(fntFile, allFiles) {
    const imgFiles = allFiles.filter(f => /\.(png|bmp|tga|jpg|jpeg|gif)$/i.test(f.name));
    try {
      this._setBusy('Reading BMFont file...', 25);
      const fntBuf = await fntFile.arrayBuffer();
      const parsed = FontAtlasGenerator.parseBMFont(fntBuf);
      console.log('[FontEditor] Parsed imported .fnt:', parsed.info?.fontName,
        parsed.glyphs.length, 'glyphs');

      let atlasImage = null;
      const pageName = parsed.pages[0] || '';
      const imgFile = imgFiles.find(f => f.name === pageName)
                   || imgFiles.find(f => /\.png$/i.test(f.name))
                   || imgFiles[0];

      if (imgFile) {
        atlasImage = await this._loadImageFile(imgFile);
      }

      this.result = FontAtlasGenerator.bmfontToResult(parsed, atlasImage);

      this.ui.fontName.value = parsed.info?.fontName || fntFile.name.replace(/\.fnt$/i, '');
      this.ui.fontSize.value = parsed.info?.fontSize || 32;
      this._syncSizeInputs('slider');
      this.ui.padding.value  = parsed.info?.padding?.[0] ?? 0;
      this.ui.spacing.value  = parsed.info?.spacing?.[0] ?? 0;
      this.ui.chars.value    = this.result.glyphs.map(g => g.char).join('');

      this._setBusy('Rendering preview...', 90);
      this._showResult();
      this.markDirty();
      this._setBusy('Ready', 100);
      setTimeout(() => this._clearBusy(), 120);
    } catch (err) {
      console.error('[FontEditor] .fnt import failed:', err);
    } finally {
      this._clearBusy();
    }
  }

  _loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
      img.src = url;
    });
  }

  // ── generate ────────────────────────────────────────

  _generate() {
    const family = this.ui.fontName.value.trim() || this.loadedFontFamily;
    if (!family) return;

    this.result = this.gen.generate({
      fontFamily:   family,
      fontSize:     parseInt(this.ui.fontSize.value) || 32,
      chars:        this.ui.chars.value,
      padding:      parseInt(this.ui.padding.value) || 0,
      spacing:      parseInt(this.ui.spacing.value) || 0,
      antialiasing: this.ui.antialias.checked,
    });

    this._showResult();
    this.markDirty();
  }

  _queueGenerate(immediate = false) {
    this._generate();
  }

  _syncSizeInputs(source = 'slider') {
    if (!this.ui.fontSize || !this.ui.fontSizeNumber) return;
    const min = parseInt(this.ui.fontSize.min, 10) || 6;
    const max = parseInt(this.ui.fontSize.max, 10) || 256;

    let value = source === 'number'
      ? parseInt(this.ui.fontSizeNumber.value, 10)
      : parseInt(this.ui.fontSize.value, 10);

    if (!Number.isFinite(value)) {
      value = parseInt(this.ui.fontSize.value, 10) || 32;
    }

    value = Math.max(min, Math.min(max, value));
    this.ui.fontSize.value = String(value);
    this.ui.fontSizeNumber.value = String(value);
  }

  _setBusy(text, progress = null) {
    if (!this.ui.busyWrap || !this.ui.busyText || !this.ui.busyProgress) return;
    this.ui.busyWrap.style.display = '';
    this.ui.busyText.textContent = text || 'Working...';
    if (progress === null || progress === undefined) {
      this.ui.busyProgress.removeAttribute('value');
    } else {
      this.ui.busyProgress.value = Math.max(0, Math.min(100, progress));
    }
  }

  _clearBusy() {
    if (!this.ui.busyWrap || !this.ui.busyProgress) return;
    this.ui.busyWrap.style.display = 'none';
    this.ui.busyProgress.value = 0;
  }

  // ── display ─────────────────────────────────────────

  _showResult() {
    if (!this.result) return;
    const { ui, result } = this;

    // Atlas canvas
    ui.atlasCanvas.width  = result.width;
    ui.atlasCanvas.height = result.height;
    const ctx = ui.atlasCanvas.getContext('2d');
    if (result.canvas) ctx.drawImage(result.canvas, 0, 0);
    this._setZoom(1);

    // Stats
    ui.statGlyphs.textContent = result.glyphs.length;
    ui.statSize.textContent   = result.width + ' × ' + result.height;
    ui.statLineH.textContent  = result.lineHeight + ' px';
    ui.statBase.textContent   = result.base + ' px';
    ui.atlasInfo.textContent  = `${result.width}×${result.height}  •  ${result.glyphs.length} glyphs`;

    ui.glyphDetail.style.display = 'none';
    this._renderTextPreview();
  }

  // ── zoom ────────────────────────────────────────────

  _setZoom(z) {
    this.zoom = Math.max(0.25, Math.min(16, z));
    this.ui.atlasCanvas.style.transform = `scale(${this.zoom})`;
    this.ui.zoomLevel.textContent = this.zoom + '×';
  }

  _zoomFit() {
    if (!this.result) return;
    const wrapW = this.ui.canvasWrap.clientWidth - 20;
    const wrapH = this.ui.canvasWrap.clientHeight - 20;
    this._setZoom(Math.min(wrapW / this.result.width, wrapH / this.result.height, 8));
  }

  // ── atlas click → glyph detail ──────────────────────

  _onAtlasClick(e) {
    if (!this.result) return;
    const rect = this.ui.atlasCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.zoom;
    const y = (e.clientY - rect.top) / this.zoom;

    const hit = this.result.glyphs.find(g =>
      g.width > 0 && x >= g.x && x < g.x + g.width && y >= g.y && y < g.y + g.height);
    if (!hit) { this.ui.glyphDetail.style.display = 'none'; return; }

    this.ui.glyphDetail.style.display = '';
    this.ui.glyphChar.textContent = hit.char;
    this.ui.gdCode.textContent = 'U+' + hit.id.toString(16).toUpperCase().padStart(4, '0') + ' (' + hit.id + ')';
    this.ui.gdXY.textContent   = hit.x + ', ' + hit.y;
    this.ui.gdSize.textContent = hit.width + ' × ' + hit.height;
    this.ui.gdXOff.textContent = hit.xoffset;
    this.ui.gdYOff.textContent = hit.yoffset;
    this.ui.gdXAdv.textContent = hit.xadvance;

    // Highlight on atlas
    this._redrawAtlas(hit);
  }

  _redrawAtlas(highlight) {
    if (!this.result?.canvas) return;
    const ctx = this.ui.atlasCanvas.getContext('2d');
    ctx.clearRect(0, 0, this.ui.atlasCanvas.width, this.ui.atlasCanvas.height);
    ctx.drawImage(this.result.canvas, 0, 0);
    if (highlight) {
      ctx.strokeStyle = '#ff0';
      ctx.lineWidth = 1;
      ctx.strokeRect(highlight.x + 0.5, highlight.y + 0.5, highlight.width - 1, highlight.height - 1);
    }
  }

  // ── text preview ────────────────────────────────────

  _renderTextPreview() {
    if (!this.result) return;
    const text = this.ui.previewText.value;
    const glyphMap = new Map(this.result.glyphs.map(g => [g.char, g]));

    const W = 448, H = 368;
    const canvas = this.ui.previewCanvas;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    let cx = 4, cy = 4;
    for (const ch of text) {
      const g = glyphMap.get(ch);
      if (!g) continue;
      if (g.width === 0) { cx += g.xadvance; continue; }
      if (cx + g.xoffset + g.width > W - 4) {
        cx = 4;
        cy += this.result.lineHeight;
        if (cy + this.result.lineHeight > H) break;
      }
      if (this.result.canvas) {
        ctx.drawImage(this.result.canvas,
          g.x, g.y, g.width, g.height,
          cx + g.xoffset, cy + g.yoffset, g.width, g.height);
      }
      cx += g.xadvance;
    }
  }

  // ── format selection ──────────────────────────────

  _updateFormatLabel() {
    if (!this.ui.formatValue) return;
    const formats = typeof ImageData !== 'undefined' && ImageData.getTextureFormatOptions
      ? ImageData.getTextureFormatOptions() : [];
    const fmt = formats.find(f => f.value === this.outputPixelFormat);
    this.ui.formatValue.textContent = fmt ? fmt.label : this.outputPixelFormat;
  }

  async _showFormatSelectionModal() {
    if (typeof ImageData === 'undefined' || !ImageData.getTextureFormatOptions) {
      console.warn('[FontEditor] ImageData.getTextureFormatOptions not available');
      return;
    }
    if (typeof ModalUtils === 'undefined' || !ModalUtils.showSelectionList) {
      console.warn('[FontEditor] ModalUtils.showSelectionList not available');
      return;
    }

    const formats = ImageData.getTextureFormatOptions();
    const fontFormats = formats.filter(f =>
      f.category === 'Alpha' || f.category === 'Indexed' || f.category === 'Common');
    const items = fontFormats.map(f => ({
      value: f.value,
      label: f.label,
      description: `${f.description} (${f.bitsPerPixel} bpp)`
    }));

    try {
      const result = await ModalUtils.showSelectionList(
        'Select Font Texture Format',
        'Choose an output pixel format for the font atlas:',
        items
      );
      if (result) {
        this.outputPixelFormat = result;
        this._updateFormatLabel();
        this.markDirty();
        console.log('[FontEditor] Selected format:', result);
      }
    } catch (error) {
      console.error('[FontEditor] Format selection error:', error);
    }
  }

  // ── resize hook ─────────────────────────────────────
  resize() {
    // Text preview and atlas redraw if needed
  }

  destroy() {
    this.result = null;
    this.gen = null;
    this.ui = {};
    this.container = null;
    this.element = null;
    this._sourceFontBlob = null;
  }
}

// Export
window.FontEditor = FontEditor;

// Static metadata for auto-registration
FontEditor.getFileExtensions = () => ['.font'];
FontEditor.getFileExtension  = () => '.font';
FontEditor.getDisplayName    = () => 'Font Editor';
FontEditor.getIcon           = () => '🔤';
FontEditor.getPriority       = () => 10;
FontEditor.getCapabilities   = () => ['font-editing'];
FontEditor.canCreate = true;
FontEditor.getCreateIcon     = () => '🔤';
FontEditor.getCreateLabel    = () => 'Font';
FontEditor.getDefaultFolder  = () => 'Fonts';

// Register the component
FontEditor.registerComponent();
