// intellisense-service.js
// Service for managing IntelliSense definitions for Lua editors

class IntelliSenseService {
  constructor() {
    this.definitions = null;
    this.completionProvider = null;
    this.hoverProvider = null;
    this.signatureProvider = null;
    this.initialized = false;
  }

  /**
   * Initialize the IntelliSense service
   */
  async initialize() {
    if (this.initialized) return;

    console.log('[IntelliSenseService] Initializing...');

    try {
      // Wait for Monaco to be available
      await this.waitForMonaco();

      // Load extension definitions
      await this.loadExtensionDefinitions();

      // Register Monaco providers
      this.registerMonacoProviders();

      this.initialized = true;
      console.log('[IntelliSenseService] Initialized successfully');
    } catch (error) {
      console.error('[IntelliSenseService] Failed to initialize:', error);
    }
  }

  /**
   * Wait for Monaco Editor to be available
   */
  async waitForMonaco() {
    if (typeof monaco !== 'undefined') return;

    console.log('[IntelliSenseService] Waiting for Monaco Editor...');
    return new Promise(resolve => {
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

  /**
   * Load extension definitions from the extension loader
   */
  async loadExtensionDefinitions() {
    try {
      // Ensure LuaExtensionLoader is available
      if (!window.LuaExtensionLoader) {
        console.warn('[IntelliSenseService] LuaExtensionLoader not available');
        throw new Error('LuaExtensionLoader not available');
      }

      // Create a temporary extension loader to get the configuration
      const tempLoader = new window.LuaExtensionLoader(null);
      await tempLoader.loadExtensionConfig();
      
      this.definitions = tempLoader.generateIntelliSenseDefinitions();
      console.log(`[IntelliSenseService] Loaded ${this.definitions?.completionItems?.length || 0} IntelliSense definitions`);
    } catch (error) {
      console.error('[IntelliSenseService] Failed to load extension definitions:', error);
      // Create empty definitions as fallback
      this.definitions = {
        functions: [],
        globals: [],
        completionItems: [],
        hoverProviders: [],
        signatureHelpers: []
      };
    }
  }

  /**
   * Register Monaco Editor language providers
   */
  registerMonacoProviders() {
    if (!this.definitions) return;

    // Register completion provider
    this.completionProvider = monaco.languages.registerCompletionItemProvider('lua', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };

        // Get the text before cursor to check context
        const textBeforeCursor = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        });

        // Filter suggestions based on context
        const suggestions = this.definitions.completionItems
          .filter(item => this.shouldShowSuggestion(item, textBeforeCursor, word.word))
          .map(item => ({
            ...item,
            range: range
          }));

        return { suggestions };
      }
    });

    // Register hover provider
    this.hoverProvider = monaco.languages.registerHoverProvider('lua', {
      provideHover: (model, position) => {
        const word = model.getWordAtPosition(position);
        if (!word) return null;

        const line = model.getLineContent(position.lineNumber);
        const beforeWord = line.substring(0, position.column - word.word.length - 1);
        
        // Check if this is a function call (look for pattern like "Category.")
        const match = beforeWord.match(/(\w+)\.$/);
        if (match) {
          const categoryName = match[1];
          const functionName = word.word;
          const fullName = `${categoryName}.${functionName}`;

          const hoverData = this.definitions.hoverProviders.find(h => 
            h.contents[0].value.includes(`${categoryName}.${functionName}`)
          );

          if (hoverData) {
            return {
              range: new monaco.Range(
                position.lineNumber,
                position.column - word.word.length,
                position.lineNumber,
                position.column
              ),
              contents: hoverData.contents
            };
          }
        }

        return null;
      }
    });

    // Register signature help provider
    this.signatureProvider = monaco.languages.registerSignatureHelpProvider('lua', {
      signatureHelpTriggerCharacters: ['(', ','],
      provideSignatureHelp: (model, position) => {
        // Find the function call we're in
        const line = model.getLineContent(position.lineNumber);
        const beforeCursor = line.substring(0, position.column - 1);
        
        // Look for function call pattern
        const match = beforeCursor.match(/(\w+)\.(\w+)\s*\([^)]*$/);
        if (match) {
          const categoryName = match[1];
          const functionName = match[2];
          
          const signatureData = this.definitions.signatureHelpers.find(s =>
            s.label.startsWith(`${categoryName}.${functionName}(`)
          );

          if (signatureData) {
            return {
              value: {
                signatures: [signatureData],
                activeSignature: 0,
                activeParameter: this.getActiveParameter(beforeCursor)
              },
              dispose: () => {}
            };
          }
        }

        return null;
      }
    });

    console.log('[IntelliSenseService] Monaco providers registered');
  }

  /**
   * Determine if a suggestion should be shown based on context
   */
  shouldShowSuggestion(item, textBeforeCursor, currentWord) {
    // If the user is typing after a dot, only show functions from that category
    const dotMatch = textBeforeCursor.match(/(\w+)\.(\w*)$/);
    if (dotMatch) {
      const categoryName = dotMatch[1];
      const partialFunction = dotMatch[2];
      return item.label.startsWith(`${categoryName}.`) && 
             item.label.toLowerCase().includes(partialFunction.toLowerCase());
    }

    // If the user is typing a category name or function name, show relevant suggestions
    if (currentWord) {
      return item.label.toLowerCase().includes(currentWord.toLowerCase()) ||
             item.filterText.toLowerCase().includes(currentWord.toLowerCase());
    }

    // Show all suggestions if no specific context
    return true;
  }

  /**
   * Get the active parameter index for signature help
   */
  getActiveParameter(textBeforeCursor) {
    const openParenIndex = textBeforeCursor.lastIndexOf('(');
    if (openParenIndex === -1) return 0;

    const paramText = textBeforeCursor.substring(openParenIndex + 1);
    const commaCount = (paramText.match(/,/g) || []).length;
    return commaCount;
  }

  /**
   * Get cached definitions
   */
  getDefinitions() {
    return this.definitions;
  }

  /**
   * Refresh definitions (reload from extension configuration)
   */
  async refreshDefinitions() {
    console.log('[IntelliSenseService] Refreshing definitions...');
    this.initialized = false;
    await this.initialize();
  }

  /**
   * Dispose of Monaco providers
   */
  dispose() {
    if (this.completionProvider) {
      this.completionProvider.dispose();
      this.completionProvider = null;
    }
    if (this.hoverProvider) {
      this.hoverProvider.dispose();
      this.hoverProvider = null;
    }
    if (this.signatureProvider) {
      this.signatureProvider.dispose();
      this.signatureProvider = null;
    }
    this.initialized = false;
  }
}

// Create singleton instance
window.IntelliSenseService = IntelliSenseService;
