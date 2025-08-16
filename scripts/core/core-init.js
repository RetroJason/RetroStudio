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
      wordWrap: { type: 'boolean', default: true },
      showLineNumbers: { type: 'boolean', default: true },
      indentSize: { type: 'number', default: 2 },
      highlightCurrentLine: { type: 'boolean', default: true }
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

  console.log('[Core] Configuration manager initialized');

  // Set up default configurations
  window.configManager.set('application.theme', 'dark');
  window.configManager.set('application.debugMode', false);
  window.configManager.set('editor.fontSize', 14);
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
