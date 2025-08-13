// application.js
// Main application bootstrap and lifecycle manager

class RetroStudioApplication {
  constructor() {
    this.isInitialized = false;
    this.services = null;
    this.plugins = null;
    this.components = null;
    this.events = null;
    this.config = null;
    this.startTime = Date.now();
  }

  // Initialize the application
  async initialize() {
    if (this.isInitialized) {
      console.warn('[Application] Already initialized');
      return;
    }

    console.log('🚀 [RetroStudio] Starting application...');

    try {
      // 1. Initialize core systems
      await this.initializeCore();

      // 2. Load configuration
      await this.loadConfiguration();

      // 3. Initialize services
      await this.initializeServices();

      // 4. Register components
      await this.registerComponents();

      // 5. Initialize plugins
      await this.initializePlugins();

      // 6. Setup UI
      await this.setupUI();

      // 7. Start main systems
      await this.startSystems();

      this.isInitialized = true;
      const loadTime = Date.now() - this.startTime;
      console.log(`✅ [RetroStudio] Application initialized in ${loadTime}ms`);
      
      // Emit ready event
      this.events.emit('application.ready', { loadTime });

      // Also emit on document for backward compatibility
      document.dispatchEvent(new CustomEvent('retrostudio-ready', { 
        detail: { loadTime } 
      }));

    } catch (error) {
      console.error('❌ [RetroStudio] Failed to initialize:', error);
      this.events?.emit('application.error', { error });
      throw error;
    }
  }

  // Initialize core systems
  async initializeCore() {
    console.log('[Application] Initializing core systems...');

    // Service container
    this.services = window.serviceContainer;
    
    // Event bus
    this.events = window.eventBus;
    this.events.enableDebug();
    
    // Configuration
    this.config = window.configManager;
    
    // Plugin system
    this.plugins = new PluginSystem(this.services);
    this.services.registerSingleton('pluginSystem', this.plugins);
    
    // Component registry
    this.components = new ComponentRegistry(this.plugins);
    this.services.registerSingleton('componentRegistry', this.components);

    console.log('[Application] Core systems initialized');
  }

  // Load configuration
  async loadConfiguration() {
    console.log('[Application] Loading configuration...');
    
    await this.config.loadFromStorage();
    
    // Register core event types
    this.events.registerEventType('file.opened', {
      path: 'string',
      type: 'string'
    });
    
    this.events.registerEventType('tab.switched', {
      tabId: 'string',
      previousTabId: 'string'
    });
    
    this.events.registerEventType('build.started', {
      projectPath: 'string'
    });
    
    this.events.registerEventType('content.refresh.required', {});

    console.log('[Application] Configuration loaded');
  }

  // Initialize services
  async initializeServices() {
    console.log('[Application] Initializing services...');

    // Register core services
    this.services.registerService('audioEngine', AudioEngine);
    this.services.registerService('resourceManager', ResourceManager, ['audioEngine']);
    this.services.registerService('buildSystem', BuildSystem);
    this.services.registerService('projectExplorer', ProjectExplorer);
    this.services.registerService('tabManager', TabManager);

    // Create service instances
    const audioEngine = this.services.get('audioEngine');
    await audioEngine.initialize();

    console.log('[Application] Services initialized');
  }

  // Register components
  async registerComponents() {
    console.log('[Application] Registering components...');

    // Register built-in editors
    this.components.registerEditor({
      name: 'lua-editor',
      extensions: ['.lua'],
      displayName: 'Lua Script',
      icon: '📜',
      editorClass: LuaEditor,
      priority: 10,
      capabilities: ['syntax-highlighting', 'auto-completion'],
      canCreate: true
    });

    this.components.registerEditor({
      name: 'sfx-editor',
      extensions: ['.sfx'],
      displayName: 'Sound FX',
      icon: '🔊',
      editorClass: SoundFXEditor,
      priority: 10,
      capabilities: ['audio-preview', 'waveform-display', 'buildable'],
      canCreate: true
    });

    this.components.registerEditor({
      name: 'palette-editor',
      extensions: ['.pal', '.act', '.aco'],
      displayName: 'Palette Editor',
      icon: '🎨',
      editorClass: PaletteEditor,
      priority: 10,
      capabilities: ['color-editing', 'import-export', 'color-stealing'],
      canCreate: true
    });

    // Register built-in viewers
    this.components.registerViewer({
      name: 'mod-viewer',
      extensions: ['.mod', '.xm', '.s3m', '.it', '.mptm'],
      displayName: 'MOD Viewer',
      icon: '🎵',
      viewerClass: ModViewer,
      priority: 10,
      capabilities: ['audio-playback', 'visualization']
    });

    this.components.registerViewer({
      name: 'wav-viewer',
      extensions: ['.wav'],
      displayName: 'WAV Viewer',
      icon: '🔊',
      viewerClass: WavViewer,
      priority: 10,
      capabilities: ['audio-playback', 'waveform-display']
    });

    this.components.registerViewer({
      name: 'hex-viewer',
      extensions: ['*'],
      displayName: 'Hex Viewer',
      icon: '🔍',
      viewerClass: HexViewer,
      priority: 1,
      capabilities: ['binary-display']
    });

    console.log('[Application] Components registered');
  }

  // Initialize plugins
  async initializePlugins() {
    console.log('[Application] Initializing plugins...');

    // Register hooks for extensibility
    this.plugins.registerHook('file.beforeOpen');
    this.plugins.registerHook('file.afterOpen');
    this.plugins.registerHook('build.beforeStart');
    this.plugins.registerHook('build.afterComplete');
    this.plugins.registerHook('ui.createContextMenu');

    // Register middleware pipelines
    this.plugins.registerMiddleware('file.processing', async (context) => {
      // File validation, preprocessing, etc.
      return context;
    });

    console.log('[Application] Plugins initialized');
  }

  // Setup UI
  async setupUI() {
    console.log('[Application] Setting up UI...');

    const tabManager = this.services.get('tabManager');
    const projectExplorer = this.services.get('projectExplorer');

    // Setup event connections
    this.events.on('tab.switched', (data) => {
      this.services.get('gameEditor')?.updateSaveButtonState();
    });

    this.events.on('file.opened', (data) => {
      projectExplorer.highlightActiveFile(data.path);
    });

    console.log('[Application] UI setup complete');
  }

  // Start main systems
  async startSystems() {
    console.log('[Application] Starting main systems...');

    // Create and start main game editor
    const gameEditor = new GameEditor();
    this.services.registerSingleton('gameEditor', gameEditor);
    
    // Make legacy globals available for backward compatibility
    window.gameEditor = gameEditor;
    window.tabManager = this.services.get('tabManager');
    window.buildSystem = this.services.get('buildSystem');

    console.log('[Application] Main systems started');

    // Initialize service adapters
    const adapterRegistry = new ServiceAdapterRegistry(this.services, this.events);
    adapterRegistry.initializeAllAdapters();

    console.log('[Application] Service adapters initialized');
  }

  // Graceful shutdown
  async shutdown() {
    console.log('[Application] Shutting down...');

    try {
      // Save configuration
      await this.config.saveToStorage();

      // Emit shutdown event
      this.events.emit('application.shutdown');

      // Cleanup services
      this.services = null;
      this.plugins = null;
      this.components = null;
      this.events = null;
      this.config = null;

      console.log('[Application] Shutdown complete');
    } catch (error) {
      console.error('[Application] Shutdown error:', error);
    }
  }

  // Get application info
  getInfo() {
    return {
      name: 'RetroStudio',
      version: '1.0.0',
      initialized: this.isInitialized,
      services: this.services?.getServiceNames() || [],
      uptime: Date.now() - this.startTime
    };
  }
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  window.retroStudio = new RetroStudioApplication();
  await window.retroStudio.initialize();
});

// Export for use
window.RetroStudioApplication = RetroStudioApplication;
