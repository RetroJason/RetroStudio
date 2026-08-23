// font-editor.js

class FontEditor extends EditorBase {
  constructor(fileObject = null, readOnly = false) {
    super(fileObject, readOnly);
    this.metadata = this.metadata || FontEditor.createDefaultMetadata();
    this.previewText = this.previewText || '12:48 RetroWatch AaBb123';
    this.previewBackgroundColor = this.previewBackgroundColor || '#000000';
    this.previewForegroundColor = this.previewForegroundColor || '#ffffff';
    this.previewFontFamily = this.previewFontFamily || null;
    this.previewSourcePath = this.previewSourcePath || null;
    this.previewFontFamilySourcePath = this.previewFontFamilySourcePath || null;
    this.sourceFontBuffer = this.sourceFontBuffer || null;
    this.previewRevision = this.previewRevision || 0;
    this.previewGpu = this.previewGpu || null;
    this.previewGpuCanvas = this.previewGpuCanvas || null;
    this.previewTexture = this.previewTexture || null;
    this.previewD2Bytes = this.previewD2Bytes || null;
    this.previewFntBytes = this.previewFntBytes || null;

    this.form = this.form || {};
    this.statusElements = this.statusElements || {};
    this.previewCanvas = this.previewCanvas || null;
    this.previewSample = this.previewSample || null;
    this.atlasCanvas = this.atlasCanvas || null;
    this.previewStats = this.previewStats || null;
    this.estimateStats = this.estimateStats || null;
    this._loadStarted = this._loadStarted || false;

    this._bindEvents();
    this._startLoad();
  }

  static createDefaultMetadata() {
    return {
      type: 'retrowatch-font',
      sourceFontPath: '',
      fontFamily: '',
      fontSize: 32,
      outputPixelFormat: 'd2_mode_alpha8',
      characters: FontEditor.DEFAULT_CHARACTERS,
      padding: 1,
      spacing: 1,
      antialias: false
    };
  }

  static get WATCH_WIDTH() {
    return 448;
  }

  static get WATCH_HEIGHT() {
    return 368;
  }

  static get FORMAT_BITS_PER_PIXEL() {
    if (window.FORMAT_STRING_TO_ENUM && window.BITS_PER_PIXEL) {
      return Object.fromEntries(
        FontEditor.OUTPUT_PIXEL_FORMATS.map(format => [
          format,
          window.BITS_PER_PIXEL[window.FORMAT_STRING_TO_ENUM[format]] || 8
        ])
      );
    }

    return {
      d2_mode_alpha8: 8,
      d2_mode_rgb565: 16,
      d2_mode_argb8888: 32,
      d2_mode_argb4444: 16,
      d2_mode_argb1555: 16,
      d2_mode_alpha4: 4,
      d2_mode_alpha2: 2,
      d2_mode_alpha1: 1,
      d2_mode_ai44: 8,
      d2_mode_rgba8888: 32,
      d2_mode_rgba4444: 16,
      d2_mode_rgba5551: 16,
      d2_mode_i8: 8,
      d2_mode_i4: 4,
      d2_mode_i2: 2,
      d2_mode_i1: 1,
      d2_mode_rgb888: 32,
      d2_mode_rgb444: 16,
      d2_mode_rgb555: 16
    };
  }

  static get OUTPUT_PIXEL_FORMATS() {
    return [
      'd2_mode_alpha8',
      'd2_mode_rgb565',
      'd2_mode_argb8888',
      'd2_mode_argb4444',
      'd2_mode_argb1555',
      'd2_mode_ai44',
      'd2_mode_rgba8888',
      'd2_mode_rgba4444',
      'd2_mode_rgba5551',
      'd2_mode_i8',
      'd2_mode_i4',
      'd2_mode_i2',
      'd2_mode_i1',
      'd2_mode_alpha4',
      'd2_mode_alpha2',
      'd2_mode_alpha1',
      'd2_mode_rgb888',
      'd2_mode_rgb444',
      'd2_mode_rgb555'
    ];
  }

  static get ALPHA_ONLY_FORMATS() {
    return new Set([
      'd2_mode_alpha8',
      'd2_mode_alpha4',
      'd2_mode_alpha2',
      'd2_mode_alpha1'
    ]);
  }

  static get INDEXED_FORMATS() {
    return new Set([
      'd2_mode_i8',
      'd2_mode_i4',
      'd2_mode_i2',
      'd2_mode_i1'
    ]);
  }

  static get OPAQUE_RGB_FORMATS() {
    return new Set([
      'd2_mode_rgb565',
      'd2_mode_rgb888',
      'd2_mode_rgb444',
      'd2_mode_rgb555'
    ]);
  }

  static getOutputFormatOptionsMarkup() {
    return FontEditor.OUTPUT_PIXEL_FORMATS
      .map(format => `<option value="${format}">${format}</option>`)
      .join('');
  }

  static get DEFAULT_CHARACTERS() {
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,:+-*/()[]{}<> =_#@%&';
  }

  static getFileExtensions() {
    return ['.font'];
  }

  static getDisplayName() {
    return 'Font Editor';
  }

  static getCreateIcon() {
    return '𝐅';
  }

  static getCreateLabel() {
    return 'Font';
  }

  static canCreate() {
    return true;
  }

  static getDefaultFolder() {
    const sourcesRoot = window.ProjectPaths?.getSourcesRootUi?.() || 'Sources';
    return `${sourcesRoot}/Fonts`;
  }

  getDisplayName() {
    return this.path ? this.path.split('/').pop() : 'New Font';
  }

  createBody(bodyContainer) {
    this.form = this.form || {};
    this.statusElements = this.statusElements || {};
    if (!this.metadata) {
      this.metadata = FontEditor.createDefaultMetadata();
    }
    if (!this.previewText) {
      this.previewText = '12:48 RetroWatch AaBb123';
    }

    bodyContainer.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'font-editor';
    root.innerHTML = `
      <div class="font-editor__layout">
        <section class="font-editor__panel font-editor__panel--settings">
          <div class="font-editor__card font-editor__card--source">
            <div class="font-editor__eyebrow">Source</div>
            <div class="font-editor__sourceName" data-role="source-name"></div>
            <div class="font-editor__sourcePath" data-role="source-path"></div>
          </div>

          <div class="font-editor__card">
            <div class="font-editor__grid">
              <label class="font-editor__field">
                <span>Font Size</span>
                <div class="font-editor__sizeControl">
                  <input type="range" min="1" max="256" step="1" data-field="fontSizeSlider">
                  <input type="number" min="1" max="512" step="1" data-field="fontSize">
                </div>
              </label>

              <label class="font-editor__field">
                <span>Output Format</span>
                <select data-field="outputPixelFormat">
                  ${FontEditor.getOutputFormatOptionsMarkup()}
                </select>
              </label>

              <label class="font-editor__field">
                <span>Padding</span>
                <input type="number" min="0" max="32" step="1" data-field="padding">
              </label>

              <label class="font-editor__field">
                <span>Spacing</span>
                <input type="number" min="0" max="32" step="1" data-field="spacing">
              </label>

              <label class="font-editor__toggle">
                <input type="checkbox" data-field="antialias">
                <span>Smooth glyph edges in generated atlas</span>
              </label>

              <label class="font-editor__field font-editor__field--full">
                <span>Characters</span>
                <textarea data-field="characters"></textarea>
              </label>

              <div class="font-editor__estimate" data-role="estimate-stats"></div>
            </div>
          </div>

          <div class="font-editor__card font-editor__card--atlas">
            <div class="font-editor__eyebrow">Atlas Preview</div>
            <canvas class="font-editor__atlasCanvas" data-role="atlas-canvas"></canvas>
            <div class="font-editor__stats" data-role="preview-stats"></div>
          </div>
        </section>

        <section class="font-editor__panel font-editor__panel--preview">
          <div class="font-editor__card font-editor__card--preview">
            <div class="font-editor__eyebrow">Preview</div>
            <label class="font-editor__field font-editor__field--full">
              <span>Preview Text</span>
              <input type="text" data-field="previewText">
            </label>
            <div class="font-editor__previewStage">
              <canvas class="font-editor__canvas" data-role="preview-canvas"></canvas>
            </div>
            <div class="font-editor__previewSliders">
              <label class="font-editor__field font-editor__field--inlineColor">
                <span>Font Color</span>
                <input type="color" data-field="previewForegroundColor">
              </label>
              <label class="font-editor__field font-editor__field--inlineColor">
                <span>Background Color</span>
                <input type="color" data-field="previewBackgroundColor">
              </label>
            </div>
            <div class="font-editor__status" data-role="status"></div>
          </div>
        </section>
      </div>
    `;

    bodyContainer.appendChild(root);

    this.form.fontSize = root.querySelector('[data-field="fontSize"]');
    this.form.fontSizeSlider = root.querySelector('[data-field="fontSizeSlider"]');
    this.form.outputPixelFormat = root.querySelector('[data-field="outputPixelFormat"]');
    this.form.previewText = root.querySelector('.font-editor__panel--preview [data-field="previewText"]');
    this.form.padding = root.querySelector('[data-field="padding"]');
    this.form.spacing = root.querySelector('[data-field="spacing"]');
    this.form.antialias = root.querySelector('[data-field="antialias"]');
    this.form.characters = root.querySelector('[data-field="characters"]');
    this.form.previewBackgroundColor = root.querySelector('[data-field="previewBackgroundColor"]');
    this.form.previewForegroundColor = root.querySelector('[data-field="previewForegroundColor"]');

    this.statusElements.sourceName = root.querySelector('[data-role="source-name"]');
    this.statusElements.sourcePath = root.querySelector('[data-role="source-path"]');
    this.statusElements.status = root.querySelector('[data-role="status"]');

    this.previewCanvas = root.querySelector('[data-role="preview-canvas"]');
    this.atlasCanvas = root.querySelector('[data-role="atlas-canvas"]');
    this.previewStats = root.querySelector('[data-role="preview-stats"]');
    this.estimateStats = root.querySelector('[data-role="estimate-stats"]');
  }

  _startLoad() {
    if (this._loadStarted) {
      return;
    }

    this._loadStarted = true;
    this.loadFileContent().catch(error => {
      console.error('[FontEditor] Failed to load font content:', error);
      this._setStatus(error.message || String(error), 'error');
    });
  }

  _bindEvents() {
    if (this._eventsBound) {
      return;
    }

    if (!this.form || !this.form.fontSize) {
      return;
    }

    const handleInput = () => {
      if (this.readOnly) {
        return;
      }

      this._syncMetadataFromForm();
      this.markDirty();
      this.renderPreview().catch(error => {
        console.error('[FontEditor] Failed to render preview:', error);
        this._setStatus(error.message || String(error), 'error');
      });
    };

    if (this.form.fontSize && this.form.fontSizeSlider) {
      const syncSizeFields = source => {
        const value = source.value;
        this.form.fontSize.value = value;
        this.form.fontSizeSlider.value = value;
      };

      this.form.fontSize.addEventListener('input', () => syncSizeFields(this.form.fontSize));
      this.form.fontSizeSlider.addEventListener('input', () => syncSizeFields(this.form.fontSizeSlider));
    }

    Object.values(this.form).forEach(element => {
      if (!element) {
        return;
      }

      element.addEventListener('input', handleInput);
      element.addEventListener('change', handleInput);
    });

    this._eventsBound = true;
  }

  async loadFileContent() {
    let content = this.file?.content ?? null;

    if (!this.isNewResource && this.path) {
      const fileManager = window.serviceContainer?.get?.('fileManager');
      const storagePath = window.ProjectPaths?.normalizeStoragePath
        ? window.ProjectPaths.normalizeStoragePath(this.path)
        : this.path;

      if (fileManager) {
        const record = await fileManager.loadFile(storagePath);
        if (record) {
          content = record.content ?? record.fileContent ?? content;
        }
      } else if (window.fileIOService) {
        const record = await window.fileIOService.loadFile(storagePath);
        if (record) {
          content = record.content ?? content;
        }
      }
    }

    if (content) {
      const parsed = typeof content === 'string' ? JSON.parse(content) : content;
      this.metadata = FontEditor._mergeMetadata(parsed);
    } else {
      this.metadata = FontEditor.createDefaultMetadata();
    }

    this.previewText = this.metadata.previewText || this.previewText;
    this._applyMetadataToForm();
    await this.renderPreview();

    if (!this.isNewResource) {
      this.markClean();
    }
  }

  static _mergeMetadata(value) {
    return {
      ...FontEditor.createDefaultMetadata(),
      ...(value || {})
    };
  }

  _applyMetadataToForm() {
    if (!this.form.fontSize) {
      return;
    }

    this.form.fontSize.value = this.metadata.fontSize ?? 32;
    this.form.fontSizeSlider.value = this.metadata.fontSize ?? 32;
    this.form.outputPixelFormat.value = this.metadata.outputPixelFormat || 'd2_mode_alpha8';
    this.form.previewText.value = this.previewText || '';
    this.form.padding.value = this.metadata.padding ?? 1;
    this.form.spacing.value = this.metadata.spacing ?? 1;
    this.form.antialias.checked = !!this.metadata.antialias;
    this.form.characters.value = this.metadata.characters || '';
    this.form.previewBackgroundColor.value = this.previewBackgroundColor || '#000000';
    this.form.previewForegroundColor.value = this.previewForegroundColor || '#ffffff';

    this._refreshSourceSummary();
    this.setReadOnly(this.readOnly);
  }

  _syncMetadataFromForm() {
    if (!this.form || !this.form.fontSize) {
      return;
    }

    this.previewText = this.form.previewText.value;
    this.previewBackgroundColor = this.form.previewBackgroundColor.value || '#000000';
    this.previewForegroundColor = this.form.previewForegroundColor.value || '#ffffff';
    this.metadata.fontSize = FontEditor._parseInteger(this.form.fontSize.value, 32);
    this.metadata.outputPixelFormat = this.form.outputPixelFormat.value;
    this.metadata.padding = FontEditor._parseInteger(this.form.padding.value, 1);
    this.metadata.spacing = FontEditor._parseInteger(this.form.spacing.value, 1);
    this.metadata.antialias = !!this.form.antialias.checked;
    this.metadata.characters = this.form.characters.value;
    this.metadata.fontFamily = this._deriveFontFamily();
  }

  static _parseInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  async renderPreview() {
    const currentRevision = ++this.previewRevision;

    // A bitmap font has no outline to rasterise and none of the controls on
    // this form apply to it. Bail out before _syncMetadataFromForm(), which
    // would otherwise stamp this editor's TTF defaults over the atlas
    // description and make the font unbuildable.
    if (this._isBitmapFont()) {
      this._clearPreview();
      this._setStatus(
        'This is a bitmap font: its glyphs come from the linked atlas image, not a TrueType face. '
        + 'Edit the atlas to change it.',
        'neutral'
      );
      return;
    }

    this._syncMetadataFromForm();
    this._refreshSourceSummary();

    if (!this.metadata.sourceFontPath) {
      this._clearPreview();
      this._setStatus('No source font is linked to this .font file.', 'error');
      return;
    }

    this.metadata.fontFamily = this._deriveFontFamily();

    if (!this.metadata.characters) {
      this._clearPreview();
      this._setStatus('Characters cannot be empty.', 'error');
      return;
    }

    this._setStatus('Rendering preview...', 'working');

    const sourceBuffer = await this._loadSourceFontBuffer(this.metadata.sourceFontPath);
    if (currentRevision !== this.previewRevision) {
      return;
    }

    const previewFamily = await this._ensurePreviewFont(sourceBuffer, this.metadata.sourceFontPath);
    if (currentRevision !== this.previewRevision) {
      return;
    }

    if (typeof FontAtlasGenerator === 'undefined') {
      this._setStatus('FontAtlasGenerator is not available.', 'error');
      return;
    }

    const generator = new FontAtlasGenerator();
    await generator.loadFont(sourceBuffer.slice(0), `${previewFamily}-atlas-${currentRevision}`);
    const atlas = generator.generate({
      fontFamily: `${previewFamily}-atlas-${currentRevision}`,
      fontSize: this.metadata.fontSize,
      chars: this.metadata.characters,
      padding: this.metadata.padding,
      spacing: this.metadata.spacing,
      antialiasing: this.metadata.antialias
    });

    if (currentRevision !== this.previewRevision) {
      return;
    }

    const pageName = `${this.getDisplayName().replace(/\.font$/i, '') || 'font-preview'}.png`;
    this.previewFntBytes = generator.toBMFontBinary(atlas, pageName);
    this.previewD2Bytes = this._buildPreviewD2Bytes(atlas);
    this._renderWatchPreview(this.previewD2Bytes, this.previewFntBytes);
    this._renderAtlasPreview(atlas.canvas, atlas.width, atlas.height);
    const estimatedSize = this.previewD2Bytes?.length || this._estimateAtlasBytes(atlas.width, atlas.height, this.metadata.outputPixelFormat);
    this.previewStats.textContent = `${atlas.glyphs.length} glyphs | ${atlas.width}x${atlas.height} atlas | line ${atlas.lineHeight} | base ${atlas.base}`;
    this.estimateStats.textContent = `Converted size: ${estimatedSize.toLocaleString()} bytes (${this.metadata.outputPixelFormat}) | .fnt ${this.previewFntBytes.length.toLocaleString()} bytes`;
    this._setStatus('', 'neutral');
  }

  _renderWatchPreview(d2Bytes, fntBytes) {
    const canvas = this.previewCanvas;
    const width = FontEditor.WATCH_WIDTH;
    const height = FontEditor.WATCH_HEIGHT;

    if (!canvas || typeof D2Canvas === 'undefined' || typeof FontAtlasGenerator === 'undefined') {
      throw new Error('D2 preview dependencies are not available.');
    }

    if (!this.previewGpuCanvas) {
      this.previewGpuCanvas = document.createElement('canvas');
    }

    if (!this.previewGpu) {
      this.previewGpu = new D2Canvas(this.previewGpuCanvas, { alpha: true, premultiplied: true });
    }

    this.previewGpu.resize(width, height);
    this.previewGpu.clear(0, 0, 0, 0);

    if (this.previewTexture) {
      this.previewGpu.deleteTexture(this.previewTexture);
      this.previewTexture = null;
    }

    this.previewTexture = this.previewGpu.createTexture(d2Bytes);

    const format = this.metadata.outputPixelFormat;
    const palette = this._buildPreviewPalette(format);
    if (palette) {
      this.previewGpu.setPalette(palette);
      this.previewGpu.setPaletteOffset(0);
    }

    const parsed = FontAtlasGenerator.parseBMFont(fntBytes);
    const font = this._mapParsedBmFont(parsed);
    const lines = this._splitPreviewLines();
    const lineHeight = font.common?.lineHeight || Math.max(this.metadata.fontSize, 1);
    const blockHeight = lineHeight * lines.length;
    const blockTop = Math.round((height - blockHeight) / 2);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const lineWidth = this._measureLine(font, line);
      let xCursor = Math.round((width - lineWidth) / 2);
      const yBase = blockTop + lineIndex * lineHeight;

      for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
        const charCode = line.charCodeAt(charIndex);
        const glyph = font.characters.get(charCode);
        if (!glyph) {
          continue;
        }

        const glyphX = xCursor + glyph.xoffset;
        const glyphY = yBase + glyph.yoffset;

        if (glyph.width > 0 && glyph.height > 0) {
          this.previewGpu.blit(this.previewTexture, {
            x: glyphX,
            y: glyphY,
            srcX: glyph.x,
            srcY: glyph.y,
            srcW: glyph.width,
            srcH: glyph.height,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            pivotX: 0,
            pivotY: 0,
            filter: 'nearest'
          });
        }

        xCursor += glyph.xadvance;
        if (charIndex + 1 < line.length) {
          xCursor += font.kerning.get(`${charCode},${line.charCodeAt(charIndex + 1)}`) || 0;
        }
      }
    }

    this.previewGpu.present();

    const context = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = this.previewBackgroundColor || '#000000';
    context.fillRect(0, 0, width, height);

    if (FontEditor.ALPHA_ONLY_FORMATS.has(format)) {
      const tintCanvas = document.createElement('canvas');
      tintCanvas.width = width;
      tintCanvas.height = height;
      const tintContext = tintCanvas.getContext('2d');
      tintContext.drawImage(this.previewGpuCanvas, 0, 0);
      tintContext.globalCompositeOperation = 'source-in';
      tintContext.fillStyle = this.previewForegroundColor || '#ffffff';
      tintContext.fillRect(0, 0, width, height);
      tintContext.globalCompositeOperation = 'source-over';
      context.drawImage(tintCanvas, 0, 0);
      return;
    }

    context.drawImage(this.previewGpuCanvas, 0, 0);
  }

  _renderAtlasPreview(sourceCanvas, atlasWidth, atlasHeight) {
    const canvas = this.atlasCanvas;
    const context = canvas.getContext('2d');
    const maxWidth = Math.max(240, Math.min(420, canvas.parentElement.clientWidth - 12));
    const maxHeight = 220;
    const scale = Math.min(maxWidth / Math.max(1, atlasWidth), maxHeight / Math.max(1, atlasHeight), 1);
    const drawWidth = Math.max(1, Math.round(atlasWidth * scale));
    const drawHeight = Math.max(1, Math.round(atlasHeight * scale));

    canvas.width = drawWidth;
    canvas.height = drawHeight;
    context.clearRect(0, 0, drawWidth, drawHeight);
    context.imageSmoothingEnabled = false;
    context.drawImage(sourceCanvas, 0, 0, drawWidth, drawHeight);
  }

  _estimateAtlasBytes(width, height, format) {
    const bitsPerPixel = FontEditor.FORMAT_BITS_PER_PIXEL[format] || 8;
    const payloadBytes = Math.ceil((width * height * bitsPerPixel) / 8);
    const headerBytes = 32;
    return headerBytes + payloadBytes;
  }

  _buildPreviewD2Bytes(atlas) {
    if (typeof D2File === 'undefined' || typeof D2File.buildFromRGBA !== 'function') {
      throw new Error('D2File.buildFromRGBA is not available.');
    }

    const context = atlas.canvas.getContext('2d');
    const imageData = context.getImageData(0, 0, atlas.width, atlas.height);
    const rgba = this._preparePreviewRgba(imageData.data, this.metadata.outputPixelFormat);

    return D2File.buildFromRGBA({
      outputPixelFormat: this.metadata.outputPixelFormat,
      metadata: {
        outputPixelFormat: this.metadata.outputPixelFormat,
        paletteOffset: 0,
      },
      rotation: 0,
      compressionType: 'none',
    }, rgba, atlas.width, atlas.height);
  }

  _preparePreviewRgba(sourceRgba, format) {
    const output = new Uint8ClampedArray(sourceRgba.length);
    const foreground = this._hexToRgb(this.previewForegroundColor || '#ffffff');
    const background = this._hexToRgb(this.previewBackgroundColor || '#000000');
    const compositeOpaque = FontEditor.OPAQUE_RGB_FORMATS.has(format);

    for (let index = 0; index < sourceRgba.length; index += 4) {
      const alpha = sourceRgba[index + 3] / 255;
      if (compositeOpaque) {
        output[index] = Math.round(background.r + (foreground.r - background.r) * alpha);
        output[index + 1] = Math.round(background.g + (foreground.g - background.g) * alpha);
        output[index + 2] = Math.round(background.b + (foreground.b - background.b) * alpha);
        output[index + 3] = 255;
        continue;
      }

      output[index] = foreground.r;
      output[index + 1] = foreground.g;
      output[index + 2] = foreground.b;
      output[index + 3] = sourceRgba[index + 3];
    }

    return output;
  }

  _buildPreviewPalette(format) {
    const foreground = this._hexToRgb(this.previewForegroundColor || '#ffffff');

    if (format === 'd2_mode_ai44') {
      const palette = new Uint8Array(1024);
      for (let index = 0; index < 16; index += 1) {
        const offset = index * 4;
        palette[offset] = foreground.r;
        palette[offset + 1] = foreground.g;
        palette[offset + 2] = foreground.b;
        palette[offset + 3] = 255;
      }
      return palette;
    }

    if (!FontEditor.INDEXED_FORMATS.has(format)) {
      return null;
    }

    const levelsByFormat = {
      d2_mode_i8: 256,
      d2_mode_i4: 16,
      d2_mode_i2: 4,
      d2_mode_i1: 2,
    };
    const levels = levelsByFormat[format] || 256;
    const palette = new Uint8Array(1024);
    for (let index = 0; index < levels; index += 1) {
      const offset = index * 4;
      const alpha = levels === 1 ? 255 : Math.round((index / (levels - 1)) * 255);
      palette[offset] = foreground.r;
      palette[offset + 1] = foreground.g;
      palette[offset + 2] = foreground.b;
      palette[offset + 3] = alpha;
    }
    return palette;
  }

  _mapParsedBmFont(parsed) {
    const font = {
      common: parsed.common || {},
      characters: new Map(),
      kerning: new Map(),
    };

    for (const glyph of parsed.glyphs || []) {
      font.characters.set(glyph.id, glyph);
    }

    for (const kerning of parsed.kernings || []) {
      font.kerning.set(`${kerning.first},${kerning.second}`, kerning.amount);
    }

    return font;
  }

  _measureLine(font, line) {
    let width = 0;
    for (let index = 0; index < line.length; index += 1) {
      const charCode = line.charCodeAt(index);
      const glyph = font.characters.get(charCode);
      if (!glyph) {
        continue;
      }

      width += glyph.xadvance;
      if (index + 1 < line.length) {
        width += font.kerning.get(`${charCode},${line.charCodeAt(index + 1)}`) || 0;
      }
    }
    return width;
  }

  _splitPreviewLines() {
    const lines = (this.previewText || 'Preview').split(/\n/);
    return lines.length ? lines : ['Preview'];
  }

  _hexToRgb(value) {
    const normalized = (value || '#000000').replace('#', '');
    const expanded = normalized.length === 3
      ? normalized.split('').map(part => `${part}${part}`).join('')
      : normalized;

    return {
      r: parseInt(expanded.slice(0, 2), 16) || 0,
      g: parseInt(expanded.slice(2, 4), 16) || 0,
      b: parseInt(expanded.slice(4, 6), 16) || 0,
    };
  }

  _deriveFontFamily() {
    if (this.metadata.fontFamily && this.metadata.fontFamily.trim()) {
      return this.metadata.fontFamily.trim();
    }

    const sourcePath = this.metadata.sourceFontPath || '';
    const filename = sourcePath.split('/').pop() || '';
    return filename.replace(/\.[^.]+$/, '');
  }

  async _loadSourceFontBuffer(sourcePath) {
    if (this.previewSourcePath === sourcePath && this.sourceFontBuffer instanceof ArrayBuffer) {
      return this.sourceFontBuffer;
    }

    const fileManager = window.serviceContainer?.get?.('fileManager');
    const storagePath = window.ProjectPaths?.normalizeStoragePath
      ? window.ProjectPaths.normalizeStoragePath(sourcePath)
      : sourcePath;

    let record = null;
    if (fileManager) {
      record = await fileManager.loadFile(storagePath);
    } else if (window.fileIOService) {
      record = await window.fileIOService.loadFile(storagePath);
    }

    if (!record) {
      throw new Error(`Source font not found: ${sourcePath}`);
    }

    const buffer = FontEditor._toArrayBuffer(record.content ?? record.fileContent ?? record);
    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error(`Unable to decode source font: ${sourcePath}`);
    }

    this.previewSourcePath = sourcePath;
    this.sourceFontBuffer = buffer;
    return buffer;
  }

  async _ensurePreviewFont(buffer, sourcePath) {
    if (this.previewFontFamily && this.previewFontFamilySourcePath === sourcePath) {
      return this.previewFontFamily;
    }

    const family = `retro-font-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const face = new FontFace(family, buffer.slice(0));
    await face.load();
    document.fonts.add(face);
    this.previewFontFamily = family;
    this.previewFontFamilySourcePath = sourcePath;
    return family;
  }

  static _toArrayBuffer(value) {
    if (value instanceof ArrayBuffer) {
      return value;
    }

    if (ArrayBuffer.isView(value)) {
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }

    if (typeof value === 'string') {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes.buffer;
    }

    return null;
  }

  _refreshSourceSummary() {
    const sourcePath = this.metadata.sourceFontPath || 'No source font selected';
    const sourceName = sourcePath.split('/').pop();
    this.statusElements.sourceName.textContent = sourceName || 'No source font selected';
    this.statusElements.sourcePath.textContent = sourcePath;
    this.metadata.fontFamily = this._deriveFontFamily();
  }

  _clearPreview() {
    this.previewStats.textContent = '';
    if (this.estimateStats) {
      this.estimateStats.textContent = '';
    }
    if (this.previewCanvas) {
      const previewContext = this.previewCanvas.getContext('2d');
      previewContext.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    }
    if (this.atlasCanvas) {
      const atlasContext = this.atlasCanvas.getContext('2d');
      atlasContext.clearRect(0, 0, this.atlasCanvas.width, this.atlasCanvas.height);
    }
  }

  _setStatus(message, tone) {
    this.statusElements.status.textContent = message;
    this.statusElements.status.dataset.tone = tone || 'neutral';
  }

  async loadTtfFile(file) {
    const sourcePath = file.path || `${window.ProjectPaths?.getSourcesRootUi?.() || 'Sources'}/Fonts/${file.name}`;
    this.metadata.sourceFontPath = sourcePath;
    this.metadata.fontFamily = file.name.replace(/\.[^.]+$/, '');
    this.previewSourcePath = sourcePath;
    this.previewFontFamilySourcePath = null;
    this.sourceFontBuffer = file instanceof File ? await file.arrayBuffer() : this.sourceFontBuffer;
    this._applyMetadataToForm();
    await this.renderPreview();
  }

  /** True for .font metadata whose glyphs come from an atlas image. */
  _isBitmapFont() {
    return String(this.metadata?.source || '').toLowerCase() === 'bitmap';
  }

  getContent() {
    // Round-trip bitmap metadata untouched; see renderPreview().
    if (this._isBitmapFont()) {
      return JSON.stringify(this.metadata, null, 2);
    }

    this._syncMetadataFromForm();

    if (!this.metadata.sourceFontPath) {
      throw new Error('Source font path is required.');
    }
    this.metadata.fontFamily = this._deriveFontFamily();
    if (!this.metadata.characters) {
      throw new Error('Characters cannot be empty.');
    }

    return JSON.stringify(this.metadata, null, 2);
  }

  setReadOnly(isReadOnly) {
    super.setReadOnly(isReadOnly);

    Object.values(this.form).forEach(element => {
      if (element) {
        element.disabled = !!isReadOnly;
      }
    });
  }
}

window.FontEditor = FontEditor;

if (typeof ComponentRegistry !== 'undefined') {
  FontEditor.registerComponent();
} else {
  setTimeout(() => {
    if (typeof ComponentRegistry !== 'undefined') {
      FontEditor.registerComponent();
    }
  }, 1000);
}