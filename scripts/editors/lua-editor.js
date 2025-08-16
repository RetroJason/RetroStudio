// lua-editor.js
// Editor for Lua script files

console.log('[LuaEditor] Class definition loading - NEW VERSION WITH SAVE OVERRIDE');

class LuaEditor extends EditorBase {
  constructor(fileObject = null, readOnly = false) {
    console.log('[LuaEditor] Constructor called with NEW SIGNATURE:', fileObject, readOnly);
    super(fileObject, readOnly);
    this.textArea = null;
  }

  createElement() { return super.createElement(); }

  createBody(bodyContainer) {
    const editorContainer = document.createElement('div');
    editorContainer.className = 'lua-editor-container';

    this.textArea = document.createElement('textarea');
    this.textArea.className = 'lua-editor-textarea';
    this.textArea.placeholder = '';

    this._textAreaElement = this.textArea;

    this.textArea.addEventListener('input', () => {
      if (!this.readOnly) this.markDirty();
      else this._revertInputIfReadOnly();
    });

    editorContainer.appendChild(this.textArea);
    bodyContainer.appendChild(editorContainer);

    this.loadFileContent().catch(err => console.error('[LuaEditor] Failed to load content:', err));

    setTimeout(() => {
      if (this.textArea && this.textArea.parentNode && !this.readOnly) {
        try { this.textArea.focus(); } catch (_) {}
      }
      if (this.readOnly) this._applyReadOnly();
    }, 50);
  }

  _applyReadOnly() {
    if (!this.textArea) return;
    this.textArea.readOnly = true;
    this.textArea.disabled = true;
    this.textArea.classList.add('is-readonly');
  }

  _clearReadOnly() {
    if (!this.textArea) return;
    this.textArea.readOnly = false;
    this.textArea.disabled = false;
    this.textArea.classList.remove('is-readonly');
  }

  _revertInputIfReadOnly() {
    if (!this.textArea) return;
    const v = this.textArea.value;
    setTimeout(() => { if (this.readOnly) this.textArea.value = v; }, 0);
  }

  setReadOnly(isReadOnly) {
    super.setReadOnly(isReadOnly);
    if (!this.textArea) return;
    if (this.readOnly) this._applyReadOnly();
    else this._clearReadOnly();
  }

  async refreshContent() {
    try { await this.loadFileContent(); }
    catch (e) { console.error('[LuaEditor] refreshContent() failed:', e); }
  }

  async loadFileContent() {
    try {
      let content = null;
      if (this.isNewResource) {
        content = '';
      } else if (this.path) {
        const fm = window.serviceContainer.get('fileManager');
        const storagePath = window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(this.path) : this.path;
        if (fm) {
          const rec = await fm.loadFile(storagePath);
          if (rec) content = rec.content ?? rec.fileContent ?? '';
        } else if (window.fileIOService) {
          const rec = await window.fileIOService.loadFile(storagePath);
          if (rec) content = rec.content ?? '';
        }
      }

      if (content === null || content === undefined) content = '';
      if (typeof content !== 'string') content = String(content);

      const ta = this.textArea || this._textAreaElement || (this.element && this.element.querySelector('.lua-editor-textarea'));
      if (ta) {
        ta.value = content;
        this.textArea = ta;
        // Only mark clean for existing files, not new ones
        if (!this.isNewResource) {
          this.markClean();
        }
      }
    } catch (e) {
      console.error('[LuaEditor] loadFileContent() failed:', e);
      if (this.textArea) {
        this.textArea.value = '';
        this.markClean();
      }
    }
  }

  getContent() {
    const ta = this.textArea || this._textAreaElement || (this.element && this.element.querySelector('.lua-editor-textarea'));
    return ta ? ta.value : '';
  }

  setContent(content) {
    if (!this.textArea) return;
    this.textArea.value = content;
    // Only mark clean if this is not a new resource
    if (!this.isNewResource) {
      this.markClean();
    }
  }

  async save() {
    console.log(`[LuaEditor] save() method called!`);
    console.log(`[LuaEditor] save() called - isNewResource: ${this.isNewResource}, file: ${this.file}, path: ${this.path}`);
    
    // If this is a new file without a path, use standardized save dialog
    if (this.isNewResource && !this.file) {
      console.log(`[LuaEditor] New file detected, using standardized save dialog`);
      
      // Get the Lua script content
      const luaContent = this.getContent();
      
      try {
        // Use the standardized save dialog from EditorBase
        await this.saveNewResource(luaContent);
        console.log(`[LuaEditor] Successfully saved new Lua script`);
      } catch (error) {
        console.error(`[LuaEditor] Error saving Lua script:`, error);
        throw error;
      }
    } else {
      console.log(`[LuaEditor] Using parent save logic`);
      // Use parent save logic
      await super.save();
    }
  }

  async saveAsNewFile() {
    // Get the Lua script content to save
    const content = this.getContent();
    
    try {
      // Use the standardized save dialog from EditorBase
      await this.saveNewResource(content);
      
      console.log(`[LuaEditor] Successfully saved new Lua script`);
      
    } catch (error) {
      console.error(`[LuaEditor] Error saving Lua script:`, error);
      throw error;
    }
  }

  onFocus() {
    super.onFocus();
    if (this.textArea && this.textArea.parentNode) {
      try { this.textArea.focus(); } catch (_) {}
    }
  }

  static getFileExtension() { return '.lua'; }
  static getFileExtensions() { return ['.lua', '.txt']; }
  static getDisplayName() { return 'Lua Script'; }
  static getIcon() { return '🌙'; }
  static getPriority() { return 10; }
  static getCapabilities() { return ['syntax-highlighting']; }
  static canCreate = true;

  static async showCreateDialog() {
    let currentUniqueName = null;
    const result = await ModalUtils.showForm('Create New Lua Script', [
      {
        name: 'name', type: 'text', label: 'Script Name:', defaultValue: 'new_script',
        placeholder: 'Enter script name...', required: true,
        hint: 'Name for your Lua script (without .lua extension)',
        validator: (value) => {
          const trimmed = value.trim(); if (!trimmed) return false;
          return !(/[<>:"\\/\\|?*]/.test(trimmed));
        },
        onInput: async (value) => {
          let test = value.trim(); if (!test.toLowerCase().endsWith('.lua')) test += '.lua';
          try {
            const unique = await EditorRegistry.getUniqueFileName(test);
            currentUniqueName = unique;
            const modal = document.querySelector('.modal-dialog');
            const input = modal?.querySelector('input[id*="modal-field-0"]');
            if (input) {
              let display = unique.toLowerCase().endsWith('.lua') ? unique.slice(0, -4) : unique;
              if (input.value !== display) input.value = display;
            }
          } catch (_) {}
        }
      }
    ], { okText: 'Create Script', cancelText: 'Cancel' });

    if (!result) return null;
    let finalName = currentUniqueName || result.name.trim();
    if (!finalName.toLowerCase().endsWith('.lua')) finalName += '.lua';
    finalName = await EditorRegistry.getUniqueFileName(finalName);
    return { name: finalName, uniqueNameChecked: true };
  }

  static getDefaultFolder() {
    return (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? `${window.ProjectPaths.getSourcesRootUi()}/Lua` : 'Resources/Lua';
  }

  static createNew() { return ''; }
}

window.LuaEditor = LuaEditor;
