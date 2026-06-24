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
    this.sourceTextArea = null;
    this.visualFrame = null;
    this.visualReady = false;
    this.currentView = 'visual';
    this.host = null;
  }

  createBody(bodyContainer) {
    bodyContainer.style.display = 'flex';
    bodyContainer.style.flexDirection = 'column';
    bodyContainer.style.gap = '8px';
    bodyContainer.style.padding = '8px';

    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;';

    const title = document.createElement('div');
    title.textContent = 'Tilemap Editor';
    title.style.cssText = 'font-size:12px;font-weight:600;color:#d4d4d4;';
    toolbar.appendChild(title);

    const visualBtn = document.createElement('button');
    visualBtn.type = 'button';
    visualBtn.textContent = 'Visual';
    visualBtn.style.cssText = 'font-size:11px;padding:4px 8px;';
    visualBtn.onclick = () => this.switchView('visual');

    const sourceBtn = document.createElement('button');
    sourceBtn.type = 'button';
    sourceBtn.textContent = 'Source';
    sourceBtn.style.cssText = 'font-size:11px;padding:4px 8px;';
    sourceBtn.onclick = () => this.switchView('source');

    const reloadVisualBtn = document.createElement('button');
    reloadVisualBtn.type = 'button';
    reloadVisualBtn.textContent = 'Reload Visual';
    reloadVisualBtn.style.cssText = 'font-size:11px;padding:4px 8px;';
    reloadVisualBtn.onclick = async () => {
      try {
        await this.pushPayloadToVisualEditor();
      } catch (error) {
        alert(`Visual reload failed: ${error.message}`);
      }
    };

    const spacer = document.createElement('div');
    spacer.style.cssText = 'flex:1;';

    const hint = document.createElement('div');
    hint.textContent = 'Build output: .d2m';
    hint.style.cssText = 'font-size:11px;color:#8a8a8a;';

    toolbar.appendChild(visualBtn);
    toolbar.appendChild(sourceBtn);
    toolbar.appendChild(reloadVisualBtn);
    toolbar.appendChild(spacer);
    toolbar.appendChild(hint);

    bodyContainer.appendChild(toolbar);

    const host = document.createElement('div');
    host.style.cssText = 'display:flex;flex:1;min-height:520px;border:1px solid #3e3e42;border-radius:4px;overflow:hidden;background:#1e1e1e;';
    this.host = host;

    const frame = document.createElement('iframe');
    frame.src = 'tmx-viewer.html';
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
    source.addEventListener('input', () => this.markDirty());
    this.sourceTextArea = source;

    host.appendChild(frame);
    host.appendChild(source);
    bodyContainer.appendChild(host);

    this.loadContentFromFile();
    this.switchView('visual');
  }

  async loadContentFromFile() {
    let content = this.file?.content;
    if (content == null) content = this.file?.fileContent;

    if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
      const bytes = content instanceof ArrayBuffer
        ? new Uint8Array(content)
        : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
      content = new TextDecoder('utf-8').decode(bytes);
    }

    if (typeof content !== 'string' || content.trim().length === 0) {
      this.mapPayload = this.getDefaultMapTemplate();
      this.isNewResource = true;
      this.markDirty();
    } else {
      try {
        const parsed = JSON.parse(content);
        this.mapPayload = this.normalizePayload(parsed);
      } catch (error) {
        throw new Error(`Invalid tilemap JSON: ${error.message}`);
      }
    }

    this.syncSourceText();

    if (this.visualReady) {
      await this.pushPayloadToVisualEditor();
    }
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
    this.sourceTextArea.value = JSON.stringify(this.mapPayload, null, 2);
  }

  switchView(view) {
    this.currentView = view;
    if (!this.visualFrame || !this.sourceTextArea) return;

    if (view === 'source') {
      this.visualFrame.style.display = 'none';
      this.sourceTextArea.style.display = 'block';
    } else {
      this.visualFrame.style.display = 'block';
      this.sourceTextArea.style.display = 'none';
    }
  }

  async pushPayloadToVisualEditor() {
    if (!this.visualReady || !this.visualFrame) return;
    const win = this.visualFrame.contentWindow;
    if (!win) return;

    // Preferred path: use unified loader
    if (typeof win.loadMapFromText === 'function') {
      await win.loadMapFromText(JSON.stringify(this.mapPayload), this.getFileName(), 'json');
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
      if (this.currentView === 'source') {
        this.mapPayload = this.pullPayloadFromSourceEditor();
      } else {
        this.mapPayload = await this.pullPayloadFromVisualEditor();
      }
    } catch (error) {
      alert(`Cannot save invalid tilemap JSON: ${error.message}`);
      throw error;
    }

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
    return ['.tilemap', '.tmj'];
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
