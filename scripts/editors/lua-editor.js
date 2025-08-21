// lua-editor.js
// Monaco Editor-based Lua script editor

console.log('[LuaEditor] Class definition loading - Monaco Editor version');

class LuaEditor extends EditorBase {
  constructor(fileObject = null, readOnly = false) {
    console.log('[LuaEditor] Constructor called with Monaco Editor:', fileObject, readOnly);
    super(fileObject, readOnly);
    this.monacoEditor = null;
    this.editorContainer = null;
    this._isLoadingContent = false;
  }

  createElement() { return super.createElement(); }

  isLoadingContent() {
    return this._isLoadingContent;
  }

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
     
      // Configure efficient Lua-specific indentation rules
      // Using simpler regex patterns to avoid performance issues on long lines
      monaco.languages.setLanguageConfiguration('lua', {
        indentationRules: {
          // Increase indent after these keywords at end of line
          increaseIndentPattern: /^\s*(function|if|for|while|repeat|else|elseif|then|do)\s*.*$/,
          // Decrease indent for these keywords at start of line  
          decreaseIndentPattern: /^\s*(end|else|elseif|until)\b/,
          // Auto-indent after function declarations
          indentNextLinePattern: /^\s*function\s+.*\(\s*\)\s*$/,
          // Don't auto-indent comment-only lines
          unIndentedLinePattern: /^\s*--.*$/
        }
      });

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
        if (!this.readOnly && !this._isLoadingContent) {
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
        
        this._isLoadingContent = true;
        this.monacoEditor.setValue(content);
        this._isLoadingContent = false;
        
        // Set up auto-testing for Lua errors (after content is loaded and editor is ready)
        this.setupAutoTesting();
        
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
        this._isLoadingContent = true;
        this.monacoEditor.setValue('');
        this._isLoadingContent = false;
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

  /**
   * Set error markers in the Monaco editor
   * @param {Array} errors - Array of error objects with {line, column, message, severity}
   */
  // Parse Lua error messages and extract line/column information
        parseLuaError(error) {
            const markers = [];
            
            if (!error || !error.message) {
                return markers;
            }
            
            const message = error.message;
            
            // Lua error format: [string "..."]:line: error message
            // Example: [string "..."]:4: <near 'end'>
            // Example: [string "..."]:2: attempt to call a nil value (global 'nonexistent_function')
            const luaErrorPattern = /\[string "[^"]*"\]:(\d+):\s*(.*)/;
            const match = message.match(luaErrorPattern);
            
            if (match) {
                const lineNumber = parseInt(match[1], 10);
                const errorMessage = match[2];
                
                // Create marker for the error line
                markers.push({
                    startLineNumber: lineNumber,
                    endLineNumber: lineNumber,
                    startColumn: 1,
                    endColumn: 1000, // Highlight entire line
                    message: errorMessage,
                    severity: monaco.MarkerSeverity.Error
                });
            }
            
            // Also check lua_stack for additional context
            if (error.lua_stack) {
                // Lua stack might have additional line references
                // Format: stack traceback:
                //         [string "..."]:line: in function 'functionName'
                const stackPattern = /\[string "[^"]*"\]:(\d+):/g;
                let stackMatch;
                
                while ((stackMatch = stackPattern.exec(error.lua_stack)) !== null) {
                    const lineNumber = parseInt(stackMatch[1], 10);
                    
                    // Avoid duplicate markers for the same line
                    if (!markers.some(m => m.startLineNumber === lineNumber)) {
                        markers.push({
                            startLineNumber: lineNumber,
                            endLineNumber: lineNumber,
                            startColumn: 1,
                            endColumn: 1000,
                            message: 'Referenced in stack trace',
                            severity: monaco.MarkerSeverity.Info
                        });
                    }
                }
            }
            
            return markers;
        }
        
        // Test Lua code and update error markers (simple syntax check only)
        async testLuaCode() {
            try {
                // Clear previous errors
                this.clearErrorMarkers();
                
                const code = this.getContent();
                if (!code.trim()) {
                    return; // No code to test
                }
                
                // Ensure Lua engine is loaded
                await this.ensureLuaEngine();
                
                // Check if Lua is available
                if (!window.Lua || typeof window.Lua.State === 'undefined') {
                    console.warn('[LuaEditor] Lua engine not available for error checking');
                    return;
                }
                
                // Create Lua state and test the code (syntax check only)
                const L = new window.Lua.State();
                
                try {
                    // Simple syntax check - just try to load the script
                    L.execute(code);
                    console.log('[LuaEditor] Code syntax check passed');
                } catch (error) {
                    console.log('[LuaEditor] Lua syntax error:', error);
                    
                    // Parse syntax error and create markers
                    const markers = this.parseLuaError(error);
                    
                    if (markers.length > 0) {
                        this.setErrorMarkers(markers);
                        console.log('[LuaEditor] Added', markers.length, 'error markers');
                    }
                }
                
            } catch (error) {
                console.error('[LuaEditor] Error testing Lua code:', error);
            }
        }
        
        // Ensure Lua engine is loaded (same method as game emulator)
        async ensureLuaEngine() {
            return new Promise((resolve, reject) => {
                if (window.Lua) {
                    resolve();
                    return;
                }
                
                console.log('[LuaEditor] Loading Lua engine...');
                const script = document.createElement('script');
                script.src = 'scripts/external/lua/dist/lua.vm.js';
                script.onload = () => {
                    console.log('[LuaEditor] Lua engine loaded successfully');
                    resolve();
                };
                script.onerror = (error) => {
                    console.error('[LuaEditor] Failed to load Lua engine:', error);
                    reject(new Error('Failed to load Lua engine'));
                };
                document.head.appendChild(script);
            });
        }
        
        // Auto-test Lua code on content change (with debouncing)
        setupAutoTesting() {
            if (!this.monacoEditor) {
                console.warn('[LuaEditor] Monaco editor not available for auto-testing setup');
                return;
            }
            
            // Prevent duplicate setup
            if (this._autoTestingSetup) {
                console.log('[LuaEditor] Auto-testing already set up, skipping...');
                return;
            }
            
            console.log('[LuaEditor] Setting up auto-testing for Lua errors');
            this._autoTestingSetup = true;
            
            let testTimeout = null;
            
            this.monacoEditor.onDidChangeModelContent(() => {
                // Clear previous timeout
                if (testTimeout) {
                    clearTimeout(testTimeout);
                }
                
                // Debounce: wait 500ms after user stops typing
                testTimeout = setTimeout(async () => {
                    await this.testLuaCode();
                }, 500);
            });
        }
        
        setErrorMarkers(markers) {
    if (!this.monacoEditor) {
      console.warn('[LuaEditor] Cannot set error markers - Monaco editor not available');
      return;
    }

    try {
      const model = this.monacoEditor.getModel();
      if (!model) {
        console.warn('[LuaEditor] Cannot set error markers - no model available');
        return;
      }

      // Convert errors to Monaco marker format
      const monacoMarkers = markers.map(marker => ({
        startLineNumber: marker.startLineNumber || 1,
        startColumn: marker.startColumn || 1,
        endLineNumber: marker.endLineNumber || 1,
        endColumn: marker.endColumn || Number.MAX_VALUE,
        message: marker.message || 'Unknown error',
        severity: marker.severity || monaco.MarkerSeverity.Error,
        source: 'lua-errors'
      }));

      // Set markers on the model
      monaco.editor.setModelMarkers(model, 'lua-errors', monacoMarkers);
      
      console.log(`[LuaEditor] Set ${markers.length} error markers`);
    } catch (error) {
      console.error('[LuaEditor] Error setting markers:', error);
    }
  }

  /**
   * Clear all error markers
   */
  clearErrorMarkers() {
    if (!this.monacoEditor) return;

    try {
      const model = this.monacoEditor.getModel();
      if (model) {
        monaco.editor.setModelMarkers(model, 'lua-errors', []);
        console.log('[LuaEditor] Cleared error markers');
      }
    } catch (error) {
      console.error('[LuaEditor] Error clearing markers:', error);
    }
  }

  /**
   * Accept runtime errors from external source (like game emulator)
   * @param {Array} errors - Array of error objects or strings
   */
  setRuntimeErrors(errors) {
    try {
      // Clear any existing auto-test errors first
      this.clearErrorMarkers();
      
      if (!errors || errors.length === 0) {
        console.log('[LuaEditor] No runtime errors to display');
        return;
      }
      
      const markers = [];
      
      // Process each error
      for (const error of errors) {
        if (typeof error === 'string') {
          // Parse string error message
          const errorMarkers = this.parseLuaError(new Error(error));
          markers.push(...errorMarkers);
        } else if (error.message) {
          // Parse error object
          const errorMarkers = this.parseLuaError(error);
          markers.push(...errorMarkers);
        } else if (error.line && error.message) {
          // Direct marker format
          markers.push({
            startLineNumber: error.line,
            endLineNumber: error.line,
            startColumn: error.column || 1,
            endColumn: error.endColumn || 1000,
            message: error.message,
            severity: monaco.MarkerSeverity.Error
          });
        }
      }
      
      if (markers.length > 0) {
        this.setErrorMarkers(markers);
        console.log('[LuaEditor] Set', markers.length, 'runtime error markers');
      }
      
    } catch (error) {
      console.error('[LuaEditor] Error setting runtime errors:', error);
    }
  }

  /**
   * Convert severity string to Monaco severity constant
   * @param {string} severity - 'error', 'warning', 'info', or 'hint'
   * @returns {number} Monaco severity constant
   */
  getMonacoSeverity(severity) {
    switch (severity.toLowerCase()) {
      case 'error': return monaco.MarkerSeverity.Error;
      case 'warning': return monaco.MarkerSeverity.Warning;
      case 'info': return monaco.MarkerSeverity.Info;
      case 'hint': return monaco.MarkerSeverity.Hint;
      default: return monaco.MarkerSeverity.Error;
    }
  }

  /**
   * Navigate to a specific line and column in the editor
   * @param {number} line - Line number (1-based)
   * @param {number} column - Column number (1-based, optional)
   */
  navigateToError(line, column = 1) {
    if (!this.monacoEditor) {
      console.warn('[LuaEditor] Cannot navigate - Monaco editor not available');
      return;
    }

    try {
      const position = { lineNumber: line, column: column };
      
      // Set cursor position
      this.monacoEditor.setPosition(position);
      
      // Scroll to the position and center it
      this.monacoEditor.revealPositionInCenter(position);
      
      // Focus the editor
      this.monacoEditor.focus();
      
      console.log(`[LuaEditor] Navigated to line ${line}, column ${column}`);
    } catch (error) {
      console.error('[LuaEditor] Error navigating to position:', error);
    }
  }

  setContent(content) {
    // Ensure Monaco editor reference is maintained
    if (!this.monacoEditor && this._monacoBackup) {
      console.log(`[LuaEditor] Restoring Monaco reference for setContent`);
      this.monacoEditor = this._monacoBackup;
    }
    
    if (this.monacoEditor) {
      this._isLoadingContent = true;
      this.monacoEditor.setValue(content || '');
      this._isLoadingContent = false;
      
      // Set up auto-testing for Lua errors (ensure it's set up when content is loaded)
      this.setupAutoTesting();
      
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

// Register the component
LuaEditor.registerComponent();
