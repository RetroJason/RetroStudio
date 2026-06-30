// core-init.js
// Initialize core systems before application bootstrap

// Create global core systems immediately
(function() {
  console.log('🔧 [Core] Initializing core systems...');

  // Initialize service container
  window.serviceContainer = new ServiceContainer();
  console.log('[Core] Service container initialized');

  // Initialize event bus
  window.eventBus = new TypedEventBus();
  console.log('[Core] Event bus initialized');

  // Initialize configuration manager
  window.configManager = new ConfigManager();
  
  // Load default configuration schemas
  window.configManager.registerSchema('application', {
    type: 'object',
    properties: {
      theme: { type: 'string', default: 'dark' },
      autoSave: { type: 'boolean', default: true },
      tabCloseConfirmation: { type: 'boolean', default: true },
      maxRecentFiles: { type: 'number', default: 10 },
      debugMode: { type: 'boolean', default: false }
    }
  });

  window.configManager.registerSchema('editor', {
    type: 'object',
    properties: {
      fontSize: { type: 'number', default: 14 },
      tabSize: { type: 'number', default: 2 },
      indentSize: { type: 'number', default: 2 },
      insertSpaces: { type: 'boolean', default: true },
      wordWrap: { type: 'boolean', default: true },
      renderWhitespace: { type: 'string', default: 'selection' },
      showLineNumbers: { type: 'boolean', default: true },
      highlightCurrentLine: { type: 'boolean', default: true },
      minimapEnabled: { type: 'boolean', default: true },
      quickSuggestions: { type: 'boolean', default: true },
      quickSuggestionsDelay: { type: 'number', default: 10 },
      suggestOnTriggerCharacters: { type: 'boolean', default: false },
      acceptSuggestionOnEnter: { type: 'boolean', default: false },
      acceptSuggestionOnCommitCharacter: { type: 'boolean', default: false },
      snippetSuggestions: { type: 'string', default: 'inline' },
      tabCompletion: { type: 'string', default: 'off' },
      wordBasedSuggestions: { type: 'string', default: 'matchingDocuments' },
      suggestSelection: { type: 'string', default: 'recentlyUsedByPrefix' },
      parameterHintsEnabled: { type: 'boolean', default: true },
      inlineSuggestEnabled: { type: 'boolean', default: true }
    }
  });

  window.configManager.registerSchema('build', {
    type: 'object',
    properties: {
      outputFormat: { type: 'string', default: 'pico8' },
      optimizeOutput: { type: 'boolean', default: true },
      includeDebugInfo: { type: 'boolean', default: false },
      compressionLevel: { type: 'number', default: 3 }
    }
  });

  // Register project schema for default palette management
  window.configManager.registerSchema('project', {
    type: 'object',
    properties: {
      defaultPalette: { 
        type: 'string', 
        default: '',
        description: 'Path to the default palette file for this project'
      },
      lastOpenedFiles: {
        type: 'array',
        default: [],
        description: 'List of recently opened files in this project'
      },
      projectSettings: {
        type: 'object',
        default: {},
        description: 'Project-specific settings and preferences'
      }
    }
  });

  console.log('[Core] Configuration manager initialized');

  // Set up default configurations
  window.configManager.set('application.theme', 'dark');
  window.configManager.set('application.debugMode', false);
  window.configManager.set('editor.fontSize', 14);
  window.configManager.set('editor.tabSize', 2);
  window.configManager.set('editor.indentSize', 2);
  window.configManager.set('editor.insertSpaces', true);
  window.configManager.set('editor.wordWrap', true);
  window.configManager.set('editor.renderWhitespace', 'selection');
  window.configManager.set('editor.showLineNumbers', true);
  window.configManager.set('editor.highlightCurrentLine', true);
  window.configManager.set('editor.minimapEnabled', true);
  window.configManager.set('editor.quickSuggestions', true);
  window.configManager.set('editor.quickSuggestionsDelay', 10);
  window.configManager.set('editor.suggestOnTriggerCharacters', false);
  window.configManager.set('editor.acceptSuggestionOnEnter', false);
  window.configManager.set('editor.acceptSuggestionOnCommitCharacter', false);
  window.configManager.set('editor.snippetSuggestions', 'inline');
  window.configManager.set('editor.tabCompletion', 'off');
  window.configManager.set('editor.wordBasedSuggestions', 'matchingDocuments');
  window.configManager.set('editor.suggestSelection', 'recentlyUsedByPrefix');
  window.configManager.set('editor.parameterHintsEnabled', true);
  window.configManager.set('editor.inlineSuggestEnabled', true);
  window.configManager.set('build.outputFormat', 'pico8');

  console.log('✅ [Core] Core systems ready');

  // Initialize FileManager when DOM is ready, with retry logic for fileIOService
  document.addEventListener('DOMContentLoaded', () => {
    const initializeFileManager = () => {
      if (window.FileManager && window.fileIOService) {
        try {
          window.FileManager.initialize(window.fileIOService);
          console.log('[Core] FileManager initialized with storage service');
          return true;
        } catch (error) {
          console.error('[Core] Failed to initialize FileManager:', error);
          return false;
        }
      }
      return false;
    };

    // Try immediate initialization
    if (!initializeFileManager()) {
      console.log('[Core] FileManager or fileIOService not ready, setting up periodic check...');
      
      // Set up periodic check for fileIOService availability
      const checkInterval = setInterval(() => {
        if (initializeFileManager()) {
          clearInterval(checkInterval);
          console.log('[Core] FileManager successfully initialized on retry');
        }
      }, 100);
      
      // Give up after 10 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        if (!window.FileManager.storageService) {
          console.error('[Core] Failed to initialize FileManager after timeout');
        }
      }, 10000);
    }

    // Register BuilderRegistry if available
    if (window.BuilderRegistry) {
      window.serviceContainer.registerSingleton('builderRegistry', window.BuilderRegistry);
      console.log('[Core] BuilderRegistry registered');
    }
  });

  // Notify that core is ready
  document.dispatchEvent(new CustomEvent('core-ready'));
})();
