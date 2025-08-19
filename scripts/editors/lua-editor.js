// lua-editor.js
// Monaco Editor-based Lua script editor

console.log('[LuaEditor] Class definition loading - Monaco Editor version');

class LuaEditor extends EditorBase {
  constructor(fileObject = null, readOnly = false) {
    console.log('[LuaEditor] Constructor called with Monaco Editor:', fileObject, readOnly);
    super(fileObject, readOnly);
    this.monacoEditor = null;
    this.editorContainer = null;
  }

  createElement() { return super.createElement(); }

  createBody(bodyContainer) {
    this.editorContainer = document.createElement('div');
    this.editorContainer.className = 'lua-editor-container';
    this.editorContainer.style.width = '100%';
    this.editorContainer.style.height = '100%';
    this.editorContainer.style.position = 'relative';

    bodyContainer.appendChild(this.editorContainer);

    // Initialize Monaco Editor
    this.initializeMonacoEditor();

    this.loadFileContent().catch(err => console.error('[LuaEditor] Failed to load content:', err));
  }

  async initializeMonacoEditor() {
    try {
      // Wait for Monaco to be available
      if (typeof monaco === 'undefined') {
        console.log('[LuaEditor] Waiting for Monaco Editor to load...');
        await new Promise(resolve => {
          const checkMonaco = () => {
            if (typeof monaco !== 'undefined') {
              resolve();
            } else {
              setTimeout(checkMonaco, 100);
            }
          };
          checkMonaco();
        });
      }
     
      // Remove custom Lua indentation rules - they were causing performance issues on long lines
      // monaco.languages.setLanguageConfiguration('lua', {
      //   indentationRules: {
      //     increaseIndentPattern: /^((?!.*?--.*).*)*((.*\b(function|if|for|while|repeat|else|elseif|then|do)\b.*)|(.*\{.*))$/,
      //     decreaseIndentPattern: /^\s*(end|else|elseif|until|\})\b.*$/,
      //     indentNextLinePattern: /^\s*(local\s+)?function\s+.*\(\s*\)\s*$/,
      //     unIndentedLinePattern: /^(\s*--.*)?$/
      //   }
      // });

      // Create the Monaco Editor instance with all features restored
      this.monacoEditor = monaco.editor.create(this.editorContainer, {
        value: '', // Will be set when content loads
        language: 'lua', // Restored Lua language support
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: true }, // Restored minimap
        scrollBeyondLastLine: false,
        fontSize: 14,
        lineNumbers: 'on',
        renderWhitespace: 'selection', // Restored whitespace rendering
        tabSize: 2,
        insertSpaces: true,
        wordWrap: 'on', // Restored word wrap
        autoIndent: 'full', // Restored auto-indent (using Monaco's default rules)
        bracketMatching: 'always', // Restored bracket matching
        formatOnPaste: true, // Restored formatting
        formatOnType: true,
        readOnly: this.readOnly
      });

      console.log(`[LuaEditor] Monaco editor created - instance: ${!!this.monacoEditor}, model: ${!!this.monacoEditor.getModel()}`);
      
      // Store a backup reference to debug if the main reference gets lost
      this._monacoBackup = this.monacoEditor;

      // Set up change detection
      this.monacoEditor.onDidChangeModelContent(() => {
        if (!this.readOnly) {
          this.markDirty();
        }
      });

      // Set up IntelliSense (now that we've fixed the performance issue)
      await this.setupIntelliSense();

      // Give container a tabIndex to allow focusing chain if needed
      if (this.editorContainer && this.editorContainer.tabIndex < 0) {
        this.editorContainer.tabIndex = 0;
      }

      console.log('[LuaEditor] Monaco Editor initialized successfully');

    } catch (error) {
      console.error('[LuaEditor] Failed to initialize Monaco Editor:', error);
      throw error;
    }
  }

  _applyReadOnly() {
    if (this.monacoEditor) {
      this.monacoEditor.updateOptions({ readOnly: true });
    }
  }

  _clearReadOnly() {
    if (this.monacoEditor) {
      this.monacoEditor.updateOptions({ readOnly: false });
    }
  }

  async loadFileContent() {
    console.log(`[LuaEditor] loadFileContent() called - isNewResource: ${this.isNewResource}, path: ${this.path}`);
    
    try {
      let content = null;
      if (this.isNewResource) {
        console.log(`[LuaEditor] New resource, using empty content`);
        content = '';
      } else if (this.path) {
        console.log(`[LuaEditor] Loading content for path: ${this.path}`);
        const fm = window.serviceContainer.get('fileManager');
        const storagePath = window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(this.path) : this.path;
        console.log(`[LuaEditor] Normalized storage path: ${storagePath}`);
        
        if (fm) {
          console.log(`[LuaEditor] Using FileManager to load file`);
          const rec = await fm.loadFile(storagePath);
          console.log(`[LuaEditor] FileManager returned:`, rec);
          if (rec) content = rec.content ?? rec.fileContent ?? '';
        } else if (window.fileIOService) {
          console.log(`[LuaEditor] Using FileIOService to load file`);
          const rec = await window.fileIOService.loadFile(storagePath);
          console.log(`[LuaEditor] FileIOService returned:`, rec);
          if (rec) content = rec.content ?? '';
        }
      }

      if (content === null || content === undefined) content = '';
      if (typeof content !== 'string') content = String(content);

      console.log(`[LuaEditor] Final content to set: length=${content.length}, preview="${content.substring(0, 50)}..."`);

      // Set content in Monaco editor
      if (this.monacoEditor || this._monacoBackup) {
        // Ensure Monaco reference is restored
        if (!this.monacoEditor && this._monacoBackup) {
          this.monacoEditor = this._monacoBackup;
        }
        
        this.monacoEditor.setValue(content);
        console.log(`[LuaEditor] Content set in Monaco editor`);
        // Only mark clean for existing files, not new ones
        if (!this.isNewResource) {
          this.markClean();
        }
      }
    } catch (e) {
      console.error('[LuaEditor] loadFileContent() failed:', e);
      if (this.monacoEditor || this._monacoBackup) {
        if (!this.monacoEditor && this._monacoBackup) {
          this.monacoEditor = this._monacoBackup;
        }
        this.monacoEditor.setValue('');
        this.markClean();
      }
    }
  }

  setReadOnly(isReadOnly) {
    super.setReadOnly(isReadOnly);
    if (this.monacoEditor) {
      this.monacoEditor.updateOptions({ readOnly: isReadOnly });
    }
  }

  getContent() {
    // Ensure Monaco editor reference is maintained
    if (!this.monacoEditor && this._monacoBackup) {
      console.log(`[LuaEditor] Restoring Monaco reference from backup`);
      this.monacoEditor = this._monacoBackup;
    }
    
    if (this.monacoEditor) {
      try {
        return this.monacoEditor.getValue() || '';
      } catch (error) {
        console.error(`[LuaEditor] Error getting Monaco content:`, error);
        return '';
      }
    }
    return '';
  }

  setContent(content) {
    // Ensure Monaco editor reference is maintained
    if (!this.monacoEditor && this._monacoBackup) {
      console.log(`[LuaEditor] Restoring Monaco reference for setContent`);
      this.monacoEditor = this._monacoBackup;
    }
    
    if (this.monacoEditor) {
      this.monacoEditor.setValue(content || '');
      // Only mark clean if this is not a new resource
      if (!this.isNewResource) {
        this.markClean();
      }
    }
  }

  async save() {
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
    if (this.monacoEditor) {
      try { this.monacoEditor.focus(); } catch (_) {}
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

  async setupIntelliSense() {
    try {
      // Prevent multiple registrations
      if (this.intelliSenseSetup) {
        console.log('[LuaEditor] IntelliSense already setup, skipping...');
        return;
      }
      
      console.log('[LuaEditor] Setting up IntelliSense...');
      
      // Get the Monaco IntelliSense service
      const intelliSenseService = window.serviceContainer?.get?.('monacoIntelliSenseService') || window.monacoIntelliSenseService;
      
      if (!intelliSenseService) {
        console.warn('[LuaEditor] Monaco IntelliSense service not available');
        return;
      }

      // Wait for the service to be ready
      await intelliSenseService.ensureReady();
      
      // Register completion provider with timeout protection
      monaco.languages.registerCompletionItemProvider('lua', {
        provideCompletionItems: (model, position) => {
          return new Promise((resolve) => {
            // Set a timeout to prevent hanging
            const timeout = setTimeout(() => {
              console.warn('[LuaEditor] Completion provider timeout');
              resolve({ suggestions: [] });
            }, 500);

            try {
              const word = model.getWordUntilPosition(position);
              const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn
              };

              // Get all completion items and filter client-side for performance
              const allItems = intelliSenseService.getCompletionItems();
              
              if (!Array.isArray(allItems)) {
                clearTimeout(timeout);
                resolve({ suggestions: [] });
                return;
              }
              
              // Apply range to all items
              const suggestions = allItems.map(item => ({
                ...item,
                range: range
              }));
              
              clearTimeout(timeout);
              resolve({ suggestions });
            } catch (error) {
              console.error('[LuaEditor] Error in completion provider:', error);
              clearTimeout(timeout);
              resolve({ suggestions: [] });
            }
          });
        }
      });

      // Register hover provider with timeout protection
      monaco.languages.registerHoverProvider('lua', {
        provideHover: (model, position) => {
          return new Promise((resolve) => {
            // Set a timeout to prevent hanging
            const timeout = setTimeout(() => {
              console.warn('[LuaEditor] Hover provider timeout');
              resolve(null);
            }, 200);

            try {
              const word = model.getWordAtPosition(position);
              if (!word) {
                clearTimeout(timeout);
                resolve(null);
                return;
              }

              const hoverData = intelliSenseService.getHoverData(word.word);
              if (!hoverData || !hoverData.markdown) {
                clearTimeout(timeout);
                resolve(null);
                return;
              }

              const result = {
                range: new monaco.Range(
                  position.lineNumber,
                  word.startColumn,
                  position.lineNumber,
                  word.endColumn
                ),
                contents: [{ value: hoverData.markdown }]
              };

              clearTimeout(timeout);
              resolve(result);
            } catch (error) {
              console.error('[LuaEditor] Error in hover provider:', error);
              clearTimeout(timeout);
              resolve(null);
            }
          });
        }
      });

      // Temporarily disable signature help provider to isolate the issue
      /*
      monaco.languages.registerSignatureHelpProvider('lua', {
        signatureHelpTriggerCharacters: ['(', ','],
        provideSignatureHelp: (model, position) => {
          // Implementation temporarily disabled
          return null;
        }
      });
      */

      this.intelliSenseSetup = true;
      console.log('[LuaEditor] IntelliSense providers registered successfully');
      
    } catch (error) {
      console.error('[LuaEditor] Failed to setup IntelliSense:', error);
    }
  }

  static getDefaultFolder() {
    return (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? `${window.ProjectPaths.getSourcesRootUi()}/Lua` : 'Resources/Lua';
  }

  static createNew() { return ''; }
}

window.LuaEditor = LuaEditor;
