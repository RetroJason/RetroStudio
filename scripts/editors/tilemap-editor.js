// tilemap-editor.js
// Studio-integrated tilemap editor:
// - Source JSON editing for .tilemap/.tmj
// - Embedded visual editor (tmx-viewer.html) inside tab
// - Save pulls current visual state back into source JSON

console.log('[TilemapEditor] Class definition loading');

class TilemapEditor extends EditorBase {
  constructor(fileObject = null, readOnly = false) {
    super(fileObject, readOnly);
    this.mapPayload = null;
    this.sourceFormat = 'json';
    this.rawSourceText = '';
    this.sourceTextArea = null;
    this.visualFrame = null;
    this.visualReady = false;
    this.host = null;
    this.isInitializingContent = false;
    this.hasUserEdited = false;
  }

  createBody(bodyContainer) {
    bodyContainer.style.display = 'flex';
    bodyContainer.style.flexDirection = 'column';
    bodyContainer.style.padding = '0';

    const host = document.createElement('div');
    host.style.cssText = 'display:flex;flex:1;min-height:520px;overflow:hidden;background:#1e1e1e;';
    this.host = host;

    const frame = document.createElement('iframe');
    frame.src = 'tmx-viewer.html?embedded=1';
    frame.style.cssText = 'width:100%;height:100%;border:none;display:block;background:#1e1e1e;';
    frame.onload = async () => {
      this.visualReady = true;
      try {
        await this.pushPayloadToVisualEditor();
      } catch (error) {
        console.warn('[TilemapEditor] Initial push to visual editor failed:', error);
      }
    };
    this.visualFrame = frame;

    const source = document.createElement('textarea');
    source.spellcheck = false;
    source.style.cssText = 'display:none;width:100%;height:100%;border:none;outline:none;resize:none;background:#1e1e1e;color:#d4d4d4;padding:10px;font-family:Consolas,monospace;font-size:12px;line-height:1.4;';
    source.addEventListener('input', () => this.markUserEdited());
    this.sourceTextArea = source;

    host.appendChild(frame);
    host.appendChild(source);
    bodyContainer.appendChild(host);

    this.loadContentFromFile();
  }

  markUserEdited() {
    this.hasUserEdited = true;
    this.markDirty();
  }

  async loadContentFromFile() {
    this.isInitializingContent = true;
    let content = this.file?.content;
    if (content == null) content = this.file?.fileContent;

    if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
      const bytes = content instanceof ArrayBuffer
        ? new Uint8Array(content)
        : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
      content = new TextDecoder('utf-8').decode(bytes);
    }

    const normalizedText = typeof content === 'string' ? content : '';
    const isTmxSource = this.isTmxFilePath(this.path || this.file?.path || this.file?.name || '');

    if (!normalizedText.trim().length) {
      this.mapPayload = this.getDefaultMapTemplate();
      this.sourceFormat = 'json';
      this.rawSourceText = '';
      this.isNewResource = true;
      this.isDirty = false;
      this.hasUnsavedChanges = false;
    } else if (isTmxSource) {
      this.sourceFormat = 'tmx';
      this.rawSourceText = normalizedText;
      this.mapPayload = this.getDefaultMapTemplate();
    } else {
      try {
        const parsed = JSON.parse(normalizedText);
        this.mapPayload = this.normalizePayload(parsed);
        this.sourceFormat = 'json';
        this.rawSourceText = '';
      } catch (error) {
        this.isInitializingContent = false;
        throw new Error(`Invalid tilemap JSON: ${error.message}`);
      }
    }

    this.syncSourceText();

    if (this.visualReady) {
      await this.pushPayloadToVisualEditor();
    }

    this.isInitializingContent = false;
  }

  isModified() {
    if (this.isNewResource && !this.hasUserEdited) {
      return false;
    }
    return super.isModified();
  }

  getSafeVisualFilename() {
    const rawName = String(this.getFileName?.() || '').trim();
    const fallback = 'untitled.tilemap';
    if (!rawName) return fallback;

    // Avoid passing path separators or illegal path characters into iframe loaders.
    const sanitized = rawName
      .replace(/[\\/]+/g, '_')
      .replace(/[<>:"|?*]/g, '_')
      .replace(/^\.+/, '')
      .trim();

    if (!sanitized) return fallback;
    return /\.(tilemap|tmj|tmx|json)$/i.test(sanitized) ? sanitized : `${sanitized}.tilemap`;
  }

  isTmxFilePath(pathLike) {
    const normalized = String(pathLike || '').trim().toLowerCase();
    return normalized.endsWith('.tmx');
  }

  normalizePayload(parsed) {
    if (parsed && typeof parsed === 'object' && parsed.mapData && parsed.schema) {
      return parsed;
    }

    if (parsed && typeof parsed === 'object' && parsed.map && Array.isArray(parsed.layers) && Array.isArray(parsed.tilesets)) {
      return {
        schema: 'retrostudio-map-v1',
        app: 'RetroStudio',
        mapData: parsed,
      };
    }

    throw new Error('Tilemap must be a studio payload or a mapData object with map/layers/tilesets');
  }

  syncSourceText() {
    if (!this.sourceTextArea) return;
    if (this.sourceFormat === 'tmx' && this.rawSourceText) {
      this.sourceTextArea.value = this.rawSourceText;
      return;
    }
    this.sourceTextArea.value = JSON.stringify(this.mapPayload, null, 2);
  }

  async pushPayloadToVisualEditor() {
    if (!this.visualReady || !this.visualFrame) return;
    const win = this.visualFrame.contentWindow;
    if (!win) return;

    // Preferred path: use unified loader
    if (typeof win.loadMapFromText === 'function') {
      const format = this.sourceFormat === 'tmx' ? 'tmx' : 'json';
      const sourceText = format === 'tmx'
        ? (this.rawSourceText || this.sourceTextArea?.value || '')
        : JSON.stringify(this.mapPayload);
      await win.loadMapFromText(sourceText, this.getSafeVisualFilename(), format);

      if (format === 'tmx') {
        // After parsing TMX in the visual editor, normalize into Studio JSON payload.
        const parsedPayload = await this.pullPayloadFromVisualEditor();
        this.mapPayload = this.normalizePayload(parsedPayload);
        this.sourceFormat = 'json';
        this.rawSourceText = '';
        this.syncSourceText();
      }
      return;
    }

    // Fallback: assign globals if available
    if (typeof win.mapData !== 'undefined') {
      win.mapData = this.mapPayload.mapData;
      if (typeof win.updateUI === 'function') win.updateUI();
      if (typeof win.renderMap === 'function') win.renderMap();
      return;
    }

    throw new Error('Embedded visual editor API is not available');
  }

  pullPayloadFromSourceEditor() {
    if (!this.sourceTextArea) return this.mapPayload;
    const parsed = JSON.parse(this.sourceTextArea.value);
    return this.normalizePayload(parsed);
  }

  async pullPayloadFromVisualEditor() {
    if (!this.visualReady || !this.visualFrame) return this.mapPayload;

    const win = this.visualFrame.contentWindow;
    if (!win) return this.mapPayload;

    if (typeof win.serializeStudioMapPayload === 'function') {
      const payload = win.serializeStudioMapPayload();
      if (payload && payload.mapData) return this.normalizePayload(payload);
    }

    if (win.mapData && typeof win.mapData === 'object') {
      return this.normalizePayload({
        schema: 'retrostudio-map-v1',
        app: 'RetroStudio',
        mapData: JSON.parse(JSON.stringify(win.mapData)),
      });
    }

    return this.mapPayload;
  }

  getContent() {
    return this.sourceTextArea ? this.sourceTextArea.value : JSON.stringify(this.mapPayload || this.getDefaultMapTemplate(), null, 2);
  }

  async save() {
    try {
      if (!this.visualReady) {
        this.mapPayload = this.pullPayloadFromSourceEditor();
      } else {
        this.mapPayload = await this.pullPayloadFromVisualEditor();
      }
    } catch (error) {
      alert(`Cannot save invalid tilemap JSON: ${error.message}`);
      throw error;
    }

    this.hasUserEdited = true;
    this.syncSourceText();
    return super.save();
  }

  getDefaultMapTemplate() {
    return {
      schema: 'retrostudio-map-v1',
      app: 'RetroStudio',
      mapData: {
        map: {
          width: 32,
          height: 24,
          tileWidth: 16,
          tileHeight: 16,
          orientation: 'orthogonal',
        },
        tilesets: [],
        layers: [
          {
            name: 'Ground',
            width: 32,
            height: 24,
            visible: true,
            data: new Array(32 * 24).fill(0),
          },
        ],
      },
    };
  }

  static getFileExtensions() {
    return ['.tilemap', '.tmj', '.tmx'];
  }

  static getFileExtension() {
    return '.tilemap';
  }

  static getDisplayName() {
    return 'Tilemap Editor';
  }

  static getIcon() {
    return '🗺️';
  }

  static getPriority() {
    return 8;
  }

  static canCreate = true;

  static getDefaultFolder() {
    return 'Sources/Maps';
  }

  static createNew() {
    const payload = {
      schema: 'retrostudio-map-v1',
      app: 'RetroStudio',
      mapData: {
        map: {
          width: 32,
          height: 24,
          tileWidth: 16,
          tileHeight: 16,
          orientation: 'orthogonal',
        },
        tilesets: [],
        layers: [
          {
            name: 'Ground',
            width: 32,
            height: 24,
            visible: true,
            data: new Array(32 * 24).fill(0),
          },
        ],
      },
    };
    return JSON.stringify(payload, null, 2);
  }
}

TilemapEditor.registerComponent();
console.log('[TilemapEditor] Registered component');

window.TilemapEditor = TilemapEditor;
