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
  
  // Load default configuration
  window.configManager.setSchema('application', {
    type: 'object',
    properties: {
      theme: { type: 'string', default: 'dark' },
      autoSave: { type: 'boolean', default: true },
      tabCloseConfirmation: { type: 'boolean', default: true },
      maxRecentFiles: { type: 'number', default: 10 },
      debugMode: { type: 'boolean', default: false }
    }
  });

  window.configManager.setSchema('editor', {
    type: 'object',
    properties: {
      fontSize: { type: 'number', default: 14 },
      wordWrap: { type: 'boolean', default: true },
      showLineNumbers: { type: 'boolean', default: true },
      indentSize: { type: 'number', default: 2 },
      highlightCurrentLine: { type: 'boolean', default: true }
    }
  });

  window.configManager.setSchema('build', {
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

  // Notify that core is ready
  document.dispatchEvent(new CustomEvent('core-ready'));
})();
