// game-emulator.js
// Main game engine emulator that integrates audio engine and project explorer

const console = window.RetroStudioLogger?.createConsole('GameEmulator') ?? window.console;

class GameEmulator {
  constructor(contentContainer = null, options = {}) {
    this.contentContainer = contentContainer; // DOM element to render content into
    this.options = this.resolveHostOptions(options);
    this.serviceResolver = typeof this.options.resolveService === 'function'
      ? this.options.resolveService
      : null;
    this.serviceRegistrar = typeof this.options.registerService === 'function'
      ? this.options.registerService
      : null;
    this.pathResolver = this.resolvePathResolver(this.options.pathResolver);
    this.audioEngine = null;
    this.resourceManager = null;
    this.projectExplorer = null;
    this.buildSystem = null;
    this.runtimePackage = null;
    this.runtimeFileManager = null;
    this.embeddedRuntimePlayer = null;
    this.hostServices = new Map();
    this.loadedAudioResources = new Map(); // Maps file paths to resource IDs
    this._inflightLoads = new Map(); // filename -> Promise
    
    // Volume control properties
    const configuredVolume = Number.isFinite(Number(this.options.initialVolume))
      ? Number(this.options.initialVolume)
      : 75;
    this.currentVolume = this.options.startMuted ? 0 : configuredVolume;
    this.previousVolume = configuredVolume > 0 ? configuredVolume : 75;
    this.isMuted = this.options.startMuted || this.currentVolume === 0;
    
    // Input management
    this.inputManager = null; // Game input manager for keyboard capture
    
    // Console management - NEW
    this.gameConsole = null;
    this.consoleInitialized = false;
    
    this.registerHostService('pathResolver', this.pathResolver);
    this.resourceMap = new Map(); // Centralized resource mapping: resourceId -> resource object
    this.luaState = null; // Lua execution state
    this.isRunning = false; // Game loop state
    this.isPaused = false; // Pause state
    this.isStarting = false; // Run startup/build state
    this.hasDeferredResourceInvalidation = false;
    this.frameCount = 0;
    this.lastFrameTime = 0;
    this.compileOverlayHidden = true;
    this.compileOverlayShownAt = 0;
    this.extensionLoader = null; // Lua extension loader
    this.clearColor = { r: 0, g: 0, b: 0, a: 1 };
    this._renderOrderCounter = 1;

    // Initialize the game engine panel content
    this.initializeGameEnginePanel();

    this.readyPromise = this.initialize();
  }

  resolveHostOptions(options = {}) {
    const profile = options.hostProfile || options.profile || 'studio';
    const baseByProfile = {
      studio: {
        hostProfile: 'studio',
        runtimeOnly: false,
        showPlaybackControls: true,
        showConsole: true,
        showReload: true,
        showVolumeControls: true,
        showKeyBindings: true,
        overlayImagePath: 'Resources/Images/cp-overlay.png',
        autoFocusCanvas: true,
        initialVolume: 75,
        startMuted: false,
      },
      embedded: {
        hostProfile: 'embedded',
        runtimeOnly: true,
        showPlaybackControls: true,
        showConsole: true,
        showReload: false,
        showVolumeControls: true,
        showKeyBindings: false,
        overlayImagePath: 'Resources/Images/cp-overlay.png',
        autoFocusCanvas: true,
        initialVolume: 75,
        startMuted: false,
      },
      storefront: {
        hostProfile: 'storefront',
        runtimeOnly: true,
        showPlaybackControls: true,
        showConsole: false,
        showReload: false,
        showVolumeControls: true,
        showKeyBindings: false,
        overlayImagePath: 'Resources/Images/cp-overlay.png',
        autoFocusCanvas: true,
        initialVolume: 75,
        startMuted: false,
      },
    };

    const profileDefaults = baseByProfile[profile] || baseByProfile.studio;
    return {
      ...profileDefaults,
      ...options,
      hostProfile: profile,
    };
  }

  resolvePathResolver(pathResolver) {
    return {
      getSourcesRootUi: typeof pathResolver?.getSourcesRootUi === 'function'
        ? pathResolver.getSourcesRootUi.bind(pathResolver)
        : () => 'Sources',
      getBuildRootUi: typeof pathResolver?.getBuildRootUi === 'function'
        ? pathResolver.getBuildRootUi.bind(pathResolver)
        : () => 'Game Objects',
      getBuildStoragePrefix: typeof pathResolver?.getBuildStoragePrefix === 'function'
        ? pathResolver.getBuildStoragePrefix.bind(pathResolver)
        : () => 'build/',
      normalizeStoragePath: typeof pathResolver?.normalizeStoragePath === 'function'
        ? pathResolver.normalizeStoragePath.bind(pathResolver)
        : (path) => path,
      isBuildArtifact: typeof pathResolver?.isBuildArtifact === 'function'
        ? pathResolver.isBuildArtifact.bind(pathResolver)
        : (path) => typeof path === 'string' && path.startsWith('build/'),
      resolveCompanionAssetPath: typeof pathResolver?.resolveCompanionAssetPath === 'function'
        ? pathResolver.resolveCompanionAssetPath.bind(pathResolver)
        : (buildPath, ext) => {
            if (typeof buildPath !== 'string' || typeof ext !== 'string' || ext.length === 0) {
              return null;
            }

            if (this.options.runtimeOnly) {
              return buildPath.replace(/^build\//i, '').replace(/\.[^.]+$/i, ext);
            }

            const buildPrefix = typeof pathResolver?.getBuildStoragePrefix === 'function'
              ? pathResolver.getBuildStoragePrefix()
              : 'build/';
            const sourcesRoot = typeof pathResolver?.getSourcesRootUi === 'function'
              ? pathResolver.getSourcesRootUi()
              : 'Sources';

            if (!buildPath.startsWith(buildPrefix)) {
              return null;
            }

            const rel = buildPath.substring(buildPrefix.length).replace(/\.[^.]+$/i, ext);
            return `${sourcesRoot}/${rel}`;
          },
    };
  }

  getLuaExtension(categoryName) {
    if (!this.extensionLoader || typeof this.extensionLoader.getExtension !== 'function') {
      return null;
    }

    const direct = this.extensionLoader.getExtension(categoryName);
    if (direct) {
      return direct;
    }

    const extensions = this.extensionLoader.extensions;
    if (!(extensions instanceof Map)) {
      return null;
    }

    const target = String(categoryName || '').toLowerCase();
    for (const [name, extension] of extensions.entries()) {
      if (String(name).toLowerCase() === target) {
        return extension;
      }
    }

    return null;
  }

  getSourcesRootUi() {
    return this.pathResolver.getSourcesRootUi();
  }

  getBuildRootUi() {
    return this.pathResolver.getBuildRootUi();
  }

  getBuildStoragePrefix() {
    return this.pathResolver.getBuildStoragePrefix();
  }

  normalizeStoragePath(path) {
    return this.pathResolver.normalizeStoragePath(path);
  }

  allocateRenderOrder() {
    const order = this._renderOrderCounter;
    this._renderOrderCounter += 1;
    return order;
  }

  registerExternalService(name, instance) {
    this.serviceRegistrar?.(name, instance);
  }

  whenReady() {
    return this.readyPromise;
  }

  registerHostService(name, instance) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Host service name must be a non-empty string.');
    }

    this.hostServices.set(name, instance);
    return instance;
  }

  ensureAudioDebugIds() {
    if (this.audioEngine && !this.audioEngine._debugId) {
      GameEmulator._nextAudioDebugId = (GameEmulator._nextAudioDebugId || 1);
      this.audioEngine._debugId = `audio_${GameEmulator._nextAudioDebugId++}`;
    }

    if (this.resourceManager && !this.resourceManager._debugId) {
      GameEmulator._nextResourceManagerDebugId = (GameEmulator._nextResourceManagerDebugId || 1);
      this.resourceManager._debugId = `resource_manager_${GameEmulator._nextResourceManagerDebugId++}`;
    }
  }

  logLoadedAudioResources(label) {
    const engineId = this.audioEngine?._debugId || 'audio_unknown';
    const managerId = this.resourceManager?._debugId || 'resource_manager_unknown';
    const engineResourceIds = this.audioEngine?.resources instanceof Map
      ? Array.from(this.audioEngine.resources.keys())
      : [];
    const managerResources = typeof this.resourceManager?.listResources === 'function'
      ? this.resourceManager.listResources().map((resource) => ({
          resourceId: resource.resourceId,
          name: resource.name,
          type: resource.type,
        }))
      : [];

    console.log(`[GameEmulator][AudioDebug] ${label}: engine=${engineId}, resourceManager=${managerId}, shared=${this.resourceManager?.audioEngine === this.audioEngine}`);
    console.log('[GameEmulator][AudioDebug] Engine resource IDs:', engineResourceIds);
    console.log('[GameEmulator][AudioDebug] ResourceManager resources:', managerResources);
  }

  getService(name) {
    if (this.hostServices.has(name)) {
      return this.hostServices.get(name);
    }

    if (this.serviceResolver) {
      const resolvedService = this.serviceResolver(name);
      if (resolvedService) {
        return resolvedService;
      }
    }

    switch (name) {
      case 'gameEmulator':
        return this;
      default:
        return null;
    }
  }

  getActiveFileManager() {
    const fileManager = this.getService('fileManager');
    if (fileManager) {
      return fileManager;
    }

    return null;
  }

  getActiveFileIOService() {
    const fileIOService = this.getService('fileIOService');
    if (fileIOService) {
      return fileIOService;
    }

    return null;
  }

  getPlaybackHost() {
    return this.embeddedRuntimePlayer?.gameEmulator || this;
  }

  syncPlaybackStateFromHost() {
    const playbackHost = this.embeddedRuntimePlayer?.gameEmulator;
    if (!playbackHost) {
      return;
    }

    this.isRunning = !!playbackHost.isRunning;
    this.isPaused = !!playbackHost.isPaused;
    this.currentVolume = playbackHost.currentVolume;
    this.previousVolume = playbackHost.previousVolume;
    this.isMuted = playbackHost.isMuted;
  }

  getEmbeddedRuntimeMountContainer() {
    const mountContainer = this.contentContainer?.querySelector('.game-canvas-container');
    if (!mountContainer) {
      throw new Error('Simulator canvas container is not available for embedded runtime playback.');
    }

    return mountContainer;
  }

  async destroyEmbeddedRuntimePlayer() {
    if (!this.embeddedRuntimePlayer) {
      return;
    }

    const player = this.embeddedRuntimePlayer;
    this.embeddedRuntimePlayer = null;
    player.destroy();
  }

  logRuntimePackageContents(runtimePackage) {
    const files = Array.isArray(runtimePackage?.files) ? runtimePackage.files : [];
    const sortedPaths = files
      .map(file => String(file?.path || '').replace(/\\/g, '/'))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));

    const summary = {
      lua: 0,
      sprites: 0,
      spriteFrames: 0,
      images: 0,
      palettes: 0,
      sfx: 0,
      music: 0,
      other: 0,
    };

    for (const path of sortedPaths) {
      const lowerPath = path.toLowerCase();
      if (lowerPath.endsWith('.lua')) {
        summary.lua++;
      } else if (lowerPath.endsWith('.d2s')) {
        summary.sprites++;
      } else if (lowerPath.endsWith('.d2f')) {
        summary.spriteFrames++;
      } else if (lowerPath.endsWith('.d2') || lowerPath.match(/\.(png|gif|jpg|jpeg|bmp|webp)$/)) {
        summary.images++;
      } else if (lowerPath.match(/\.(pal|act|aco|pmap)$/)) {
        summary.palettes++;
      } else if (lowerPath.match(/\.(wav|sfx)$/)) {
        summary.sfx++;
      } else if (lowerPath.match(/\.(mod|xm|s3m|it|mptm)$/)) {
        summary.music++;
      } else {
        summary.other++;
      }
    }

    console.log(`[RuntimePackage] Loaded ${sortedPaths.length} file(s)`);
    console.log('[RuntimePackage] Summary:', summary);
    for (const path of sortedPaths) {
      console.log(`[RuntimePackage] ${path}`);
    }
  }

  setRuntimePackage(runtimePackage) {
    if (!runtimePackage || !Array.isArray(runtimePackage.files) || runtimePackage.files.length === 0) {
      throw new Error('Runtime package must provide a non-empty files array.');
    }

    if (typeof window.RuntimeArchiveFileManager !== 'function') {
      throw new Error('RuntimeArchiveFileManager is not available.');
    }

    this.runtimePackage = runtimePackage;
    this.logRuntimePackageContents(runtimePackage);
    this.runtimeFileManager = new window.RuntimeArchiveFileManager(runtimePackage.files);
  }

  createRuntimePathResolver() {
    const baseResolver = this.pathResolver;
    const buildRootUi = baseResolver?.getBuildRootUi?.() || 'Build Output';
    const runtimeRoots = [
      'build/',
      'Lua/',
      'Images/',
      'Sprites/',
      'Palettes/',
      'SFX/',
      'Music/',
      'Binary/',
      'Fonts/',
      'app.ini',
      'config.json',
      'palette_map.pmap',
    ];

    const normalizeRuntimePath = (path) => {
      if (typeof path !== 'string' || path.length === 0) {
        return path;
      }

      let normalized = String(path)
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/^\/+/, '');

      const buildMarker = normalized.toLowerCase().indexOf('/build/');
      if (buildMarker >= 0) {
        return `build/${normalized.substring(buildMarker + '/build/'.length)}`;
      }

      const buildUiPrefix = `${buildRootUi}/`;
      if (normalized.startsWith(buildUiPrefix)) {
        return `build/${normalized.substring(buildUiPrefix.length)}`;
      }

      for (const root of runtimeRoots) {
        const marker = normalized.indexOf(root);
        if (marker > 0) {
          return normalized.substring(marker);
        }
        if (marker === 0) {
          return normalized;
        }
      }

      return normalized;
    };

    return {
      getSourcesRootUi: () => baseResolver?.getSourcesRootUi?.() || 'Sources',
      getBuildRootUi: () => buildRootUi,
      getBuildStoragePrefix: () => 'build/',
      normalizeStoragePath: normalizeRuntimePath,
      isBuildArtifact: (path) => {
        const normalized = normalizeRuntimePath(path);
        return typeof normalized === 'string' && normalized.startsWith('build/');
      },
      resolveCompanionAssetPath: (buildPath, ext) => {
        const normalized = normalizeRuntimePath(buildPath);
        if (typeof normalized !== 'string' || typeof ext !== 'string' || ext.length === 0) {
          return null;
        }

        return normalized.replace(/^build\//i, '').replace(/\.[^.]+$/i, ext);
      },
    };
  }

  installRuntimeFileServices() {
    if (!this.runtimeFileManager) {
      throw new Error('No runtime file manager is configured.');
    }

    this.registerHostService('fileManager', this.runtimeFileManager);
    this.registerHostService('fileIOService', this.runtimeFileManager);
    this.registerHostService('pathResolver', this.createRuntimePathResolver());
  }

  restoreRuntimeFileServices() {
    this.hostServices.delete('fileManager');
    this.hostServices.delete('fileIOService');
    this.registerHostService('pathResolver', this.pathResolver);
  }

  destroy() {
    this.stopProject();
    this.restoreRuntimeFileServices();
  }

  async initialize() {
    console.log('=== Game Engine Emulator ===');

    // Initialize or obtain AudioEngine
    this.audioEngine = this.getService('audioEngine');
    if (!this.audioEngine) {
      this.audioEngine = new AudioEngine();
      if (!this.options.runtimeOnly) {
        const audioSuccess = await this.audioEngine.initialize();
        if (!audioSuccess) {
          console.error('[GameEmulator] Failed to initialize audio engine');
          return false;
        }
      }
      this.registerExternalService('audioEngine', this.audioEngine);
    }
    this.registerHostService('audioEngine', this.audioEngine);
    this.setVolume(this.currentVolume);
    this.updateMuteButton();

    // Initialize or obtain ResourceManager
    this.resourceManager = this.getService('resourceManager');
    if (this.resourceManager && this.resourceManager.audioEngine !== this.audioEngine) {
      console.warn('[GameEmulator] Replacing ResourceManager bound to a different AudioEngine instance');
      this.resourceManager = null;
    }
    if (!this.resourceManager) {
      this.resourceManager = new ResourceManager(this.audioEngine);
      this.registerExternalService('resourceManager', this.resourceManager);
    }
    this.registerHostService('resourceManager', this.resourceManager);
    this.ensureAudioDebugIds();
    this.logLoadedAudioResources('after initialize services');

    if (!this.options.runtimeOnly) {
      this.buildSystem = this.getService('buildSystem');
    }
    
    // Listen for audio engine events
    this.audioEngine.addEventListener('resourceLoaded', this.onResourceLoaded.bind(this));
    this.audioEngine.addEventListener('resourceUpdated', this.onResourceUpdated.bind(this));
    
    if (!this.options.runtimeOnly) {
      this.tabManager = this.getService('tabManager');
      
      if (this.tabManager) {
        // Listen for tab changes to update save button state and project explorer
        this.tabManager.addEventListener('tabSwitched', (data) => {
          this.updateSaveButtonState();
          // Project explorer highlighting is handled automatically in TabManager
        });
      }
      
      this.projectExplorer = this.getService('projectExplorer');
      
      // Listen for file added events from ProjectExplorer
      document.addEventListener('projectFileAdded', this.handleFileAddedEvent.bind(this));
    }
    
    // Set up UI event handlers
    this.setupUI();
    
    // NOTE: Panel content is now initialized in constructor, no need to create dynamically
    
    // Add audio context resume handler
    this.addAudioContextResumeHandler();
    
    // Update initial UI state
    if (!this.options.runtimeOnly) {
      this.updateSaveButtonState();
    }
    
    console.log('[GameEmulator] Initialized successfully');
    return true;
  }

  setClearColor(color) {
    if (!Number.isFinite(color)) {
      throw new Error(`[GameEmulator] SetClearColor invalid color: ${color}`);
    }

    const rgb = Number(color) >>> 0;
    this.clearColor = {
      r: ((rgb >> 16) & 0xFF) / 255,
      g: ((rgb >> 8) & 0xFF) / 255,
      b: (rgb & 0xFF) / 255,
      a: 1,
    };
  }
  
  // Initialize BuildSystem if it wasn't available during initial setup
  initializeBuildSystemIfNeeded() {
    if (!this.buildSystem) {
      this.buildSystem = this.getService('buildSystem');
      if (this.buildSystem) {
        return true;
      }
    }
    return !!this.buildSystem;
  }
  
  // Load external scripts dynamically for self-contained module
  async loadScript(src) {
    if (!window.__retroStudioScriptLoads) {
      window.__retroStudioScriptLoads = new Map();
    }

    if (window.__retroStudioScriptLoads.has(src)) {
      return window.__retroStudioScriptLoads.get(src);
    }

    const loadPromise = new Promise((resolve, reject) => {
      const normalizedSrc = new URL(src, window.location.href).href;

      // Check if script is already loaded or currently loading
      const existingScript = Array.from(document.querySelectorAll('script[src]')).find(
        (scriptElement) => scriptElement.src === normalizedSrc
      );
      if (existingScript) {
        if (existingScript.dataset.loadState === 'loaded') {
          resolve();
          return;
        }

        existingScript.addEventListener('load', () => resolve(), { once: true });
        existingScript.addEventListener('error', (event) => reject(event), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.dataset.loadState = 'loading';
      script.onload = () => {
        script.dataset.loadState = 'loaded';
        resolve();
      };
      script.onerror = (event) => {
        window.__retroStudioScriptLoads.delete(src);
        reject(event);
      };
      document.head.appendChild(script);
    });

    window.__retroStudioScriptLoads.set(src, loadPromise);
    return loadPromise;
  }
  
  // Initialize console module
  async initializeConsole() {
    if (this.consoleInitialized) return;
    
    try {
      // Load console script if not already loaded
      if (typeof GameConsole === 'undefined') {
        await this.loadScript('scripts/game-emulator/console.js');
      }
      
      // Create console container in the slide panel
      const consoleSlidePanel = this.contentContainer.querySelector('#consoleSlidePanel');
      if (consoleSlidePanel) {
        // Clear existing content and create console container
        consoleSlidePanel.innerHTML = '<div id="game-console-container" class="console-container"></div>';
        
        // Initialize GameConsole
        this.gameConsole = new GameConsole({
          showTimestamps: false,
          maxMessages: 5000,
          autoScroll: true
        });
        
        const consoleContainer = consoleSlidePanel.querySelector('#game-console-container');
        this.gameConsole.initialize(consoleContainer);
        
        this.consoleInitialized = true;
        console.log('[GameEmulator] Console module initialized');
      } else {
        console.error('[GameEmulator] Console slide panel not found');
      }
    } catch (error) {
      console.error('[GameEmulator] Failed to initialize console:', error);
    }
  }
  
  setupUI() {
    // The ribbon toolbar handles its own button setup
    // Initialize console module
    if (this.options.showConsole) {
      this.initializeConsole();
    }
    
    // TODO: Add proper keyboard shortcuts later without interfering with Monaco Editor
    console.log('[GameEmulator] UI setup complete - keyboard shortcuts disabled for now');
  }
  
  addAudioContextResumeHandler() {
    const resumeHandler = async () => {
      if (!this.audioEngine?.audioContext) {
        return;
      }

      if (this.audioEngine.audioContext.state === 'suspended') {
        console.log('[GameEditor] User interaction detected, resuming AudioContext...');
        try {
          await this.audioEngine.audioContext.resume();
          console.log('[GameEditor] AudioContext resumed, state:', this.audioEngine.audioContext.state);
        } catch (error) {
          console.warn('[GameEditor] Failed to resume AudioContext:', error);
        }
      }

      if (this.audioEngine.audioContext.state !== 'suspended') {
        document.removeEventListener('click', resumeHandler);
        document.removeEventListener('keydown', resumeHandler);
      }
    };
    
    // Listen for any user interaction
    document.addEventListener('click', resumeHandler);
    document.addEventListener('keydown', resumeHandler);
  }
  
  // Handle file added events from ProjectExplorer
  handleFileAddedEvent(event) {
    const { file, path, fullPath, extension } = event.detail;
    console.log(`[GameEditor] Received file added event: ${file.name} at ${path}`);
    
    // Determine if this is an audio file that we need to register
    let audioType = null;
    
    if (['.mod', '.xm', '.s3m', '.it', '.mptm'].includes(extension)) {
      audioType = 'mod';
    } else if (['.wav'].includes(extension)) {
      audioType = 'wav';
    }
    
    if (audioType) {
      // Register the file for later loading
      const fileKey = fullPath;
      this.pendingAudioFiles = this.pendingAudioFiles || new Map();
      this.pendingAudioFiles.set(fileKey, { file, audioType, path });
      
      console.log(`[GameEditor] Registered audio file for lazy loading: ${file.name} (${audioType})`);
      this.updateStatus(`Registered ${file.name}`, 'info');
    }
  }
  
  updateStatus(message, type = 'info') {
    console.log(`[GameEmulator] Status: ${message}`);
    
    // Update play button text based on running state
    this.updatePlayButton();
    this.updatePlayPauseButton();
  }

  updatePlayButton() {
    const playBtn = document.getElementById('playProjectBtn');
    if (playBtn) {
      const iconElement = playBtn.querySelector('.ribbon-icon');
      const textElement = playBtn.querySelector('.ribbon-text');
      const playbackHost = this.getPlaybackHost();
      const isRunning = !!playbackHost.isRunning;
      
      if (isRunning) {
        if (iconElement) iconElement.textContent = '⏹️';
        if (textElement) textElement.textContent = 'Stop';
        playBtn.title = 'Stop Project';
      } else {
        if (iconElement) iconElement.textContent = '▶️';
        if (textElement) textElement.textContent = 'Run';
        playBtn.title = 'Run Project';
      }
    }
  }

  /**
   * Toggle mute state
   */
  toggleMute() {
    this.isMuted = !this.isMuted;
    
    if (this.isMuted) {
      this.previousVolume = this.currentVolume;
      this.setVolume(0);
    } else {
      this.setVolume(this.previousVolume || 75);
    }
    
    this.updateMuteButton();
    console.log(`[GameEmulator] Audio ${this.isMuted ? 'muted' : 'unmuted'}`);
  }

  /**
   * Set volume level
   */
  setVolume(volume) {
    this.currentVolume = Math.max(0, Math.min(100, volume));
    
    // Update the volume slider to reflect the new value
    const volumeSlider = document.getElementById('volumeSlider');
    if (volumeSlider) {
      volumeSlider.value = this.currentVolume;
    }
    
    // Set volume on audio engine if available
    if (this.audioEngine && this.audioEngine.setMasterVolume) {
      this.audioEngine.setMasterVolume(this.currentVolume / 100);
    }
    
    // Update mute state based on volume
    if (this.currentVolume === 0 && !this.isMuted) {
      this.isMuted = true;
      this.updateMuteButton();
    } else if (this.currentVolume > 0 && this.isMuted) {
      this.isMuted = false;
      this.updateMuteButton();
    }
  }

  /**
   * Update mute button appearance
   */
  updateMuteButton() {
    const muteBtn = document.getElementById('muteBtn');
    if (muteBtn) {
      muteBtn.textContent = this.isMuted ? '🔇' : '🔊';
      muteBtn.title = this.isMuted ? 'Unmute Audio' : 'Mute Audio';
    }
  }

  async extractRuntimePackageFromBlob(blob) {
    if (!(blob instanceof Blob)) {
      throw new Error('Runtime package export did not produce a Blob.');
    }

    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip must be loaded before running runtime archives.');
    }

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const files = [];

    for (const entry of Object.values(zip.files)) {
      if (entry.dir) {
        continue;
      }

      files.push({
        path: entry.name,
        bytes: await entry.async('uint8array'),
      });
    }

    if (files.length === 0) {
      throw new Error('Runtime archive did not contain any files.');
    }

    return { files };
  }

  async buildRuntimeArchiveForPlayback() {
    const projectName = this.projectExplorer?.getFocusedProjectName?.();
    if (!projectName) {
      throw new Error('No project selected.');
    }

    const rwaService = this.getService('rwaService') || window.rwaService;
    if (!rwaService || typeof rwaService.buildRuntimePackage !== 'function') {
      throw new Error('RwaService is not available.');
    }

    const exportedPackage = await rwaService.buildRuntimePackage(projectName, {
      buildBeforeExport: true,
    });

    if (!(exportedPackage?.blob instanceof Blob)) {
      throw new Error('Runtime package export did not produce a Blob.');
    }

    return exportedPackage.blob;
  }

  async buildRuntimePackageForPlayback() {
    const archiveBlob = await this.buildRuntimeArchiveForPlayback();
    return this.extractRuntimePackageFromBlob(archiveBlob);
  }
  
  async playProject() {
    if (this.isStarting) {
      throw new Error('Play already in progress');
    }

    console.log('[GameEmulator] Play project');
    this.updateStatus('Preparing to run project...', 'info');
    this.isStarting = true;

    const playStart = performance.now();
    let phaseStart = playStart;
    const logPhase = (label) => {
      const now = performance.now();
      const phaseMs = now - phaseStart;
      const totalMs = now - playStart;
      console.log(`[Timing][Play] ${label}: ${phaseMs.toFixed(1)}ms (total ${totalMs.toFixed(1)}ms)`);
      phaseStart = now;
    };
    
    try {
      console.log('[GameEmulator] Building runtime archive for embedded playback...');
      const runtimeArchiveBlob = await this.buildRuntimeArchiveForPlayback();
      logPhase('buildRuntimeArchiveForPlayback');

      await this.destroyEmbeddedRuntimePlayer();

      if (typeof window.EmbeddedRuntimePlayer !== 'function') {
        throw new Error('EmbeddedRuntimePlayer is not available.');
      }

      this.embeddedRuntimePlayer = new window.EmbeddedRuntimePlayer(this.getEmbeddedRuntimeMountContainer(), {
        hostProfile: 'embedded',
        showPlaybackControls: false,
        showConsole: false,
        showReload: false,
        showVolumeControls: false,
        showKeyBindings: false,
        overlayImagePath: this.options.overlayImagePath,
        autoFocusCanvas: this.options.autoFocusCanvas,
        initialVolume: this.currentVolume,
        startMuted: this.isMuted,
      });

      await this.embeddedRuntimePlayer.loadRwaFromBlob(runtimeArchiveBlob);
      this.syncPlaybackStateFromHost();
      this.updatePlayPauseButton();
      this.updatePlayButton();
      logPhase('embeddedRuntimePlayer.loadRwaFromBlob');

      console.log(`[Timing][Play] COMPLETE: ${(performance.now() - playStart).toFixed(1)}ms`);
      
    } catch (error) {
      console.error('[GameEmulator] Error running project:', error);
      console.error('[GameEmulator] Error stack:', error.stack);
      this.updateStatus(`Error running project: ${error.message}`, 'error');
      
      await this.showErrorPopup(
        'Project Run Error',
        'An error occurred while trying to run your project.',
        `Error Details:\n${error.message}\n\nStack Trace:\n${error.stack || 'No stack trace available'}\n\nPlease check your project files and try again.`
      );
    } finally {
      this.isStarting = false;
    }
  }
  
  async buildProject() {
    console.log('[GameEditor] Building project...');
    this.updateStatus('Building project...', 'info');
    
    try {
      // Initialize BuildSystem if it wasn't available during startup
      if (!this.buildSystem) {
        if (!this.initializeBuildSystemIfNeeded()) {
          this.updateStatus('Build system not available', 'error');
          return { success: false, error: 'Build system not available' };
        }
      }
      
      // Check for unsaved files before building
      if (this.tabManager) {
        const unsavedTabs = this.tabManager.getUnsavedTabs();
        if (unsavedTabs.length > 0) {
          // Automatically save all unsaved tabs before building
          await this.tabManager.saveAllOpenTabs();
          this.updateStatus('Saved all files, building project...', 'info');
        }
      }

      // Debug project explorer structure
      console.log('[GameEditor] ProjectExplorer:', this.projectExplorer);
      console.log('[GameEditor] ProjectData structure:', this.projectExplorer?.projectData?.structure);
      
      // Get project files from the ProjectExplorer
      if (!this.projectExplorer) {
        this.updateStatus('No project explorer available', 'warning');
        return { success: false, error: 'No project explorer available' };
      }
      
      // Build the project using the build system (it will read from projectExplorer directly)
      const buildResult = await this.buildSystem.buildProject();
      
      // Expand the Build folder to show new build files (they are added as they are built)
      if (this.projectExplorer && buildResult && buildResult.success !== false) {
        setTimeout(() => {
          this.projectExplorer.expandBuildFolder();
        }, 100);
      }
      
      // Refresh build file tabs after successful build
      if (this.tabManager && buildResult && buildResult.success !== false) {
        // Get list of build files from project explorer
        const buildFiles = this.getAllBuildFiles();
        await this.tabManager.refreshBuildTabs(buildFiles);
      }
      
      this.updateStatus('Project built successfully!', 'success');
      return buildResult;
    } catch (error) {
      console.error('[GameEditor] Build failed:', error);
      this.updateStatus(`Build failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }
  
  getAllBuildFiles() {
    if (this.runtimeFileManager) {
      return this.runtimeFileManager.getBuildFiles();
    }

    // Get all files from the Build folder in project explorer
    const buildFiles = [];
    
  const project = this.projectExplorer?.getFocusedProjectName?.();
  const buildRoot = this.getBuildRootUi();
  const buildNode = project ? this.projectExplorer.projectData.structure[project]?.children?.[buildRoot] : this.projectExplorer?.projectData?.structure?.[buildRoot];
  if (!buildNode) {
      return buildFiles;
    }
    
    const collectFiles = (node, currentPath = '') => {
      if (node.type === 'file') {
        buildFiles.push({
          name: node.name,
          path: currentPath,
          type: node.type
        });
      } else if (node.children) {
        for (const [childName, childNode] of Object.entries(node.children)) {
          const childPath = currentPath ? `${currentPath}/${childName}` : childName;
          collectFiles(childNode, childPath);
        }
      }
    };
    
  // Start collecting from Build folder
  collectFiles(buildNode, `${project ? project + '/' : ''}${buildRoot}`);
    
    console.log(`[GameEditor] Found ${buildFiles.length} build files:`, buildFiles);
    return buildFiles;
  }

  /**
   * Initialize all resource mappings from build files
   * This creates a centralized resource mapping system for all components to use
   */
  /**
   * Initialize centralized resource mappings by scanning all build files
   * Uses folder structure to determine resource type (e.g., SFX/, Music/, Graphics/)
   */
  async initializeResourceMappings() {
    console.log('[GameEmulator] Initializing centralized resource mappings...');
    
    try {
      this.resourceMap.clear();
      
      const buildFiles = this.getAllBuildFiles();
      
      // Process all build files and create resource mappings based on folder structure
      for (const file of buildFiles) {
        const resourceMapping = this.createResourceMapping(file);
        if (resourceMapping) {
          this.resourceMap.set(resourceMapping.id, resourceMapping);
        }
      }

      // Preload all resources into memory
      await this.preloadResources();
      
      // Create Lua constants for all resource types
      await this.createAllLuaConstants();
      
    } catch (error) {
      console.error('[GameEmulator] Failed to initialize resource mappings:', error);
    }
  }

  /**
   * Create a resource mapping object from a build file based on its folder structure
   * @param {Object} file - Build file object with path and name
   * @returns {Object|null} Resource mapping object or null if not a mappable resource
   */
  createResourceMapping(file) {
    if (!file.path || !file.name) {
      return null;
    }

    const normalizedPath = String(file.path).replace(/\\/g, '/');
    const relativePath = String(this.normalizeStoragePath(normalizedPath) || normalizedPath);
    const pathSegments = relativePath.split('/').filter(Boolean);

    let folderMatch = null;
    const resourceFolderAliases = {
      sfx: 'SFX',
      music: 'MUSIC',
      graphics: 'GRAPHICS',
      images: 'GRAPHICS',
      data: 'DATA',
      shaders: 'SHADERS',
      palettes: 'PALETTES',
    };
    const buildRootUi = String(this.getBuildRootUi() || '').trim().toLowerCase();
    const buildStorageRoot = String(this.getBuildStoragePrefix() || 'build/')
      .replace(/\/$/, '')
      .trim()
      .toLowerCase();

    if (this.options.runtimeOnly && pathSegments.length >= 2) {
      folderMatch = resourceFolderAliases[pathSegments[0].toLowerCase()] || null;
    }

    if (pathSegments.length >= 2) {
      const rootSegment = pathSegments[0].toLowerCase();
      if (rootSegment === buildRootUi || rootSegment === buildStorageRoot || rootSegment === 'game objects') {
        folderMatch = resourceFolderAliases[pathSegments[1].toLowerCase()] || pathSegments[1].toUpperCase();
      }
    }

    if (!folderMatch) {
      return null;
    }

    // Get file extension and base name
    const fileExtension = file.name.split('.').pop().toLowerCase();
    const fileName = file.name.replace(new RegExp(`\\.${fileExtension}$`), '');
    
    // Create resource ID: FOLDERNAME.FILENAME
    const resourceId = `${folderMatch}.${fileName.toUpperCase()}`;
    
    // Determine resource type and supported extensions
    const resourceTypeMap = {
      'SFX': ['wav'],
      'MUSIC': ['mod', 'xm', 's3m', 'it'],
      'GRAPHICS': ['png', 'jpg', 'jpeg', 'gif', 'bmp'],
      'DATA': ['json', 'txt', 'xml'],
      'SHADERS': ['glsl', 'frag', 'vert'],
      'PALETTES': ['pal', 'act', 'aco']
    };

    // Check if this file type is supported for this folder
    const supportedExtensions = resourceTypeMap[folderMatch] || [];
    if (supportedExtensions.length > 0 && !supportedExtensions.includes(fileExtension)) {
      return null;
    }

    return {
      type: folderMatch,
      id: resourceId,
      fileName: fileName,
      filePath: file.path,
      category: folderMatch,
      name: file.name,
      extension: fileExtension,
      loaded: false,
      audioResource: null
    };
  }

  /**
   * Preload all resources into memory so Play() doesn't need to load them
   * Handles both audio (SFX, MUSIC) and non-audio resources
   */
  async preloadResources() {
    console.log('[GameEmulator] Preloading all resources into memory...');
    
    if (!this.resourceManager) {
      console.warn('[GameEmulator] ResourceManager not available - skipping preload');
      return;
    }
    
    const preloadPromises = [];
    
    for (const [resourceId, resource] of this.resourceMap) {
      if (!resource.loaded) {
        console.log(`[GameEmulator] Preloading ${resource.type} resource: ${resourceId}`);
        
        // Handle audio resources (SFX and MUSIC)
        if (resource.type === 'SFX' || resource.type === 'MUSIC') {
          const loadPromise = this.preloadAudioResource(resource)
            .then((audioResourceId) => {
              resource.loaded = true;
              resource.audioResource = audioResourceId;
              console.log(`[GameEmulator] Successfully preloaded: ${resourceId} as ${audioResourceId}`);
            })
            .catch((error) => {
              console.warn(`[GameEmulator] Failed to preload ${resourceId}:`, error);
              resource.loaded = false;
              resource.audioResource = null;
            });
          
          preloadPromises.push(loadPromise);
        } else {
          // For non-audio resources, just mark as loaded (no preloading needed)
          // They will be loaded on-demand when accessed
          resource.loaded = true;
          console.log(`[GameEmulator] Marked ${resource.type} resource as available: ${resourceId}`);
        }
      }
    }
    
    // Wait for all audio resources to load
    await Promise.all(preloadPromises);
    
    const loadedCount = Array.from(this.resourceMap.values()).filter(r => r.loaded).length;
    console.log(`[GameEmulator] Preloaded ${loadedCount}/${this.resourceMap.size} resources into memory`);
    this.logLoadedAudioResources('after preloadResources');
  }

  /**
   * Create Lua constants for all resource types
   */
  async createAllLuaConstants() {
    if (!this.luaState) {
      console.error('[GameEmulator] Lua state not available - skipping constant creation');
      return;
    }
    
    try {
      const sfxConstants = this.GetResourceConstants('SFX');
      
      if (Object.keys(sfxConstants).length > 0) {
        let luaCode = 'SFX = SFX or {}\n';
        
        for (const [constantName, resourceId] of Object.entries(sfxConstants)) {
          luaCode += `SFX.${constantName} = "${resourceId}"\n`;
        }
        
        this.luaState.execute(luaCode);
        
        console.log(`[GameEmulator] Created ${Object.keys(sfxConstants).length} SFX constants in Lua`);
      }
      
      // TODO: Add other resource type constants here (Graphics, Music, etc.)
      
    } catch (error) {
      console.error('[GameEmulator] Failed to create Lua constants:', error);
    }
  }

  /**
   * Get a resource by its ID
   * @param {string} resourceId - The resource ID (e.g., "SFX.COOL")
   * @returns {Object|null} Resource object or null if not found
   */
  GetResource(resourceId) {
    const resource = this.resourceMap.get(resourceId);
    if (!resource) {
      console.warn(`[GameEmulator] Resource not found: ${resourceId}`);
      return null;
    }
    
    // Return resource with preloaded status
    return {
      ...resource,
      isPreloaded: resource.loaded,
      audioResource: resource.audioResource
    };
  }

  /**
   * Get all resources of a specific type
   * @param {string} type - Resource type (e.g., "SFX", "Graphics")
   * @returns {Array} Array of resource objects
   */
  GetResourcesByType(type) {
    const resources = [];
    for (const resource of this.resourceMap.values()) {
      if (resource.type === type) {
        resources.push(resource);
      }
    }
    return resources;
  }

  /**
   * Get all resource IDs for Lua constant generation
   * @param {string} type - Resource type filter (optional)
   * @returns {Object} Map of constant names to resource IDs
   */
  GetResourceConstants(type = null) {
    const constants = {};
    for (const [resourceId, resource] of this.resourceMap) {
      if (!type || resource.type === type) {
        const parts = resourceId.split('.');
        if (parts.length === 2) {
          constants[parts[1]] = resourceId;
        }
      }
    }
    return constants;
  }
  
  findMainLuaScript() {
    // Look for main.lua in the Lua directory
  const project = this.projectExplorer?.getFocusedProjectName?.();
  const sourcesRoot = this.getSourcesRootUi();
  const luaFolder = project ? this.projectExplorer.projectData.structure[project]?.children?.[sourcesRoot]?.children?.Lua?.children
                : this.projectExplorer.projectData.structure[sourcesRoot]?.Lua?.children;
    if (luaFolder && luaFolder['main.lua']) {
      return luaFolder['main.lua'];
    }
    
    // If no main.lua, look for any .lua file
    if (luaFolder) {
      for (const [filename, fileData] of Object.entries(luaFolder)) {
        if (filename.endsWith('.lua')) {
          return fileData;
        }
      }
    }
    
    return null;
  }
  
  async runLuaScript(scriptSource) {
    const scriptName = scriptSource?.file?.name || 'script';
    console.warn(`[GameEmulator] Legacy runLuaScript(${scriptName}) invoked; delegating to playProject() to use the single runtime execution path.`);
    return this.playProject();
  }
  
  createProject() {
    console.log('[GameEditor] Create new project');
    // For now, this could reset the current project or show a new project dialog
    this.updateStatus('Create project - not implemented yet', 'info');
  }
  
  saveActiveEditor() {
    // Get the currently active tab
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab) {
      this.updateStatus('No active editor to save', 'warning');
      return;
    }
    
    // Check if the active tab has a viewer that can save
    const viewer = activeTab.viewer;
    if (viewer && typeof viewer.save === 'function') {
      try {
        viewer.save();
        const tabTitle = activeTab.title || viewer.file?.name || 'file';
        this.updateStatus(`Saved ${tabTitle}`, 'success');
      } catch (error) {
        console.error('[GameEditor] Failed to save:', error);
        const tabTitle = activeTab.title || viewer.file?.name || 'file';
        this.updateStatus(`Failed to save ${tabTitle}: ${error.message}`, 'error');
      }
    } else {
      this.updateStatus('Active tab does not support saving', 'warning');
    }
  }
  
  updateSaveButtonState() {
    // Update ribbon toolbar save button state
    if (window.ribbonToolbar) {
      window.ribbonToolbar.onTabChanged();
    }
    
    // Legacy support for old button (if still present)
    const saveBtn = document.getElementById('saveBtn');
    if (!saveBtn) return;
    
    const activeTab = this.tabManager.getActiveTab();
    const canSave = activeTab && activeTab.viewer && typeof activeTab.viewer.save === 'function';
    
    saveBtn.disabled = !canSave;
    if (canSave) {
      const tabTitle = activeTab.title || activeTab.viewer.file?.name || 'current file';
      saveBtn.title = `Save ${tabTitle} (Ctrl+S)`;
    } else {
      saveBtn.title = 'No active editor to save';
    }
  }
  
  // Utility methods
  
  getAllMusicFiles() {
    return this.projectExplorer.getProjectFiles('music');
  }
  
  getAllSFXFiles() {
    return this.projectExplorer.getProjectFiles('sfx');
  }
  
  getLoadedResourceId(filePathOrName) {
    const lookupPath = String(filePathOrName || '');
    const lookupName = lookupPath.split('/').pop() || lookupPath.split('\\').pop() || lookupPath;

    for (const [path, id] of this.loadedAudioResources) {
      if (path === lookupPath || path.endsWith(lookupName)) {
        return id;
      }
    }
    return null;
  }

  applyResourceCacheInvalidation() {
    console.log('[GameEmulator] Applying resource cache invalidation');

    const audioResourceCount = this.loadedAudioResources.size;
    for (const [path, resourceId] of this.loadedAudioResources.entries()) {
      console.log(`[GameEmulator] Clearing cached audio resource: ${path} -> ${resourceId}`);

      if (this.audioEngine) {
        this.audioEngine.unloadResource(resourceId);
      }

      if (this.resourceManager) {
        this.resourceManager.unloadResource(resourceId);
      }
    }

    this.loadedAudioResources.clear();

    if (this.resourceManager && typeof this.resourceManager.clear === 'function') {
      this.resourceManager.clear();
    }

    if (this.resourceMap) {
      for (const [resourceId, resource] of this.resourceMap.entries()) {
        if (resource.loaded) {
          resource.loaded = false;
          resource.audioResource = null;
        }
      }
    }

    this.hasDeferredResourceInvalidation = false;
    console.log(`[GameEmulator] Cleared ${audioResourceCount} audio resources and reset all resource cache`);
  }

  /**
   * Invalidate ALL cached resources
   * This is called when any build operation occurs to ensure viewers get the latest version
   */
  invalidateAllResourceCache() {
    console.log(`[GameEmulator] Invalidating ALL cached resources due to build operation`);

    if (this.isRunning) {
      this.hasDeferredResourceInvalidation = true;
      console.log('[GameEmulator] Deferring resource cache invalidation until the current run stops');
      return;
    }

    this.applyResourceCacheInvalidation();
  }

  /**
   * Preload a single audio resource directly from build files
   * Used during emulator startup to load ALL resources into memory
   * @param {Object} resource - Resource object with filePath and type info
   * @returns {Promise<string>} Resource ID
   */
  async preloadAudioResource(resource) {
    console.log(`[GameEmulator] Preloading audio resource: ${resource.id} from ${resource.filePath}`);
    
    try {
      // Load the file from build storage
      const fileManager = this.getActiveFileManager();
      if (!fileManager) {
        throw new Error('FileManager not available');
      }
      
      // Convert UI or project-relative build paths to the canonical storage path.
      const storagePath = this.normalizeStoragePath(resource.filePath) || resource.filePath;
      console.log(`[GameEmulator] Loading from storage path: ${storagePath}`);
      
      const fileData = await fileManager.loadFile(storagePath);
      if (!fileData) {
        throw new Error(`Failed to load file from storage: ${storagePath}`);
      }
      
      // Convert file data to ArrayBuffer
      let arrayBuffer;
      if (fileData.content instanceof ArrayBuffer) {
        arrayBuffer = fileData.content;
      } else if (fileData.binaryData && fileData.fileContent) {
        // Decode base64 binary data
        const binaryString = atob(fileData.fileContent);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        arrayBuffer = bytes.buffer;
      } else {
        throw new Error(`Unsupported file data format for ${storagePath}`);
      }
      
      console.log(`[GameEmulator] Converted to ArrayBuffer, size: ${arrayBuffer.byteLength} bytes`);
      
      // Determine audio type from file extension
      const extension = resource.name.toLowerCase();
      const isModFile = ['.mod', '.xm', '.s3m', '.it', '.mptm'].some(ext => extension.endsWith(ext));
      const audioType = isModFile ? 'mod' : 'wav';
      const mimeType = isModFile ? 'application/octet-stream' : 'audio/wav';
      
      // Create File object for ResourceManager
      const file = new File([arrayBuffer], resource.name, { type: mimeType });
      console.log(`[GameEmulator] Created File object: ${file.name}, size: ${file.size}, type: ${file.type}`);
      
      // Load through ResourceManager
      const resourceId = await this.resourceManager.loadFromFile(file, audioType);
      console.log(`[GameEmulator] Successfully loaded audio resource: ${resourceId}`);
      this.logLoadedAudioResources(`after preloadAudioResource ${resource.id}`);
      
      return resourceId;
      
    } catch (error) {
      console.error(`[GameEmulator] Failed to preload audio resource ${resource.id}:`, error);
      throw error;
    }
  }

  // Load an audio file on demand (called by viewers)
  async loadAudioFileOnDemand(filePathOrName, forceReload = false) {
    const lookupPath = String(filePathOrName || '');
    const filename = lookupPath.split('/').pop() || lookupPath.split('\\').pop() || lookupPath;
    console.log(`[GameEditor] Loading audio file on demand: ${lookupPath}${forceReload ? ' (force reload)' : ''}`);
    
    // Check if already loaded, unless forcing reload
    if (!forceReload) {
      const existingId = this.getLoadedResourceId(lookupPath);
      if (existingId) {
        console.log(`[GameEditor] File ${filename} already loaded with ID: ${existingId}`);
        return existingId;
      }
    } else {
      // Force reload: clear existing resource first
      const existingId = this.getLoadedResourceId(lookupPath);
      if (existingId) {
        console.log(`[GameEditor] Force reload: clearing existing resource ${existingId} for ${filename}`);
        if (this.audioEngine) {
          this.audioEngine.unloadResource(existingId);
        }
      }
    }
    
    // Dedupe concurrent requests for the same filename
    if (!forceReload && this._inflightLoads.has(lookupPath)) {
      console.log('[GameEditor] Returning in-flight load for', lookupPath);
      return this._inflightLoads.get(lookupPath);
    }

    const loadPromise = (async () => {
      // First try to find in pending files (regular project files)
    if (this.pendingAudioFiles) {
      for (const [fileKey, fileData] of this.pendingAudioFiles.entries()) {
        if (fileKey === lookupPath || fileKey.endsWith(filename)) {
          try {
            console.log(`[GameEditor] Loading ${filename} (${fileData.audioType})...`);
            const resourceId = await this.resourceManager.loadFromFile(fileData.file, fileData.audioType);
            
            // Move from pending to loaded
            this.loadedAudioResources.set(fileKey, resourceId);
            this.pendingAudioFiles.delete(fileKey);
            
            console.log(`[GameEditor] Loaded audio resource: ${resourceId} (${filename})`);
            this.updateStatus(`Loaded ${filename}`, 'success');
            
            return resourceId;
          } catch (error) {
            console.error(`[GameEditor] Failed to load audio file ${filename}:`, error);
            throw error;
          }
        }
      }
    }
    
      // If not found in pending files, try to load from build files via storage
      console.log(`[GameEditor] File ${filename} not found in pending files, checking build files...`);
    
    try {
      // Prefer storage backend to enumerate possible build files
      const candidates = [];
      const fileIOService = this.getActiveFileIOService();
      if (fileIOService && typeof fileIOService.listFiles === 'function') {
        console.log(`[GameEditor] Listing build files for ${filename}...`);
        const buildRecords = await fileIOService.listFiles(this.getBuildStoragePrefix());
        console.log(`[GameEditor] Found ${buildRecords.length} build records:`, buildRecords);
        for (const rec of buildRecords) {
          const recPath = rec.path || rec;
          if ((recPath || '') === lookupPath || (recPath || '').endsWith(filename)) {
            candidates.push(recPath);
            console.log(`[GameEditor] Found candidate: ${recPath}`);
          }
        }
      }
      
      console.log(`[GameEditor] Total candidates for ${filename}:`, candidates);

      // Sort to prioritize clean paths
      candidates.sort((a, b) => {
        const aBad = a.includes('.sfx/') || a.includes('/Resources/');
        const bBad = b.includes('.sfx/') || b.includes('/Resources/');
        if (aBad && !bBad) return 1;
        if (!aBad && bBad) return -1;
        return a.length - b.length; // prefer shorter paths
      });

        for (const path of candidates) {
        try {
            console.log(`[GameEditor] Attempting to load candidate: ${path}`);
            const rec = fileIOService ? await fileIOService.loadFile(path) : null;
          if (!rec) {
            console.log(`[GameEditor] No record found for: ${path}`);
            continue;
          }
          console.log(`[GameEditor] Loaded record:`, { 
            path: path, 
            binaryData: rec.binaryData, 
            contentType: typeof rec.content, 
            fileContentType: typeof rec.fileContent,
            fileContentLength: rec.fileContent ? rec.fileContent.length : 'N/A'
          });
          const buf = rec.content instanceof ArrayBuffer ? rec.content : (rec.binaryData && rec.fileContent ? (() => { const bin = atob(rec.fileContent); const bytes = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i); return bytes.buffer; })() : new TextEncoder().encode(String(rec.fileContent || rec.content || '')).buffer);
          console.log(`[GameEditor] Converted to ArrayBuffer, length: ${buf.byteLength}`);
          const lower = filename.toLowerCase();
          const isMod = ['.mod', '.xm', '.s3m', '.it', '.mptm'].some(ext => lower.endsWith(ext));
          const audioType = isMod ? 'mod' : 'wav';
          const file = new File([buf], filename, { type: isMod ? 'application/octet-stream' : 'audio/wav' });
          console.log(`[GameEditor] Created File object:`, { name: file.name, size: file.size, type: file.type });
          const resourceId = await this.resourceManager.loadFromFile(file, audioType);
          console.log(`[GameEditor] Successfully loaded audio resource: ${resourceId}`);
          this.loadedAudioResources.set(path, resourceId);
          this.updateStatus(`Loaded ${filename}`, 'success');
          return resourceId;
        } catch (innerErr) {
          console.warn('[GameEditor] Candidate load failed, trying next:', path, innerErr);
        }
      }
    } catch (error) {
      console.error(`[GameEditor] Error loading build file ${filename}:`, error);
    }
    
    // If still not found, try to load directly from stored Resources by filename
    console.log(`[GameEditor] ${filename} not found in build files, checking Resources in storage...`);
  try {
      const resourceCandidates = [];
      const fileIOService = this.getActiveFileIOService();
      if (fileIOService && typeof fileIOService.listFiles === 'function') {
    const sourcesRoot = this.getSourcesRootUi();
    const resRecords = await fileIOService.listFiles(sourcesRoot);
        for (const rec of resRecords) {
          const recPath = rec.path || rec;
          if ((recPath || '') === lookupPath || (recPath || '').endsWith(filename)) {
            resourceCandidates.push(recPath);
          }
        }
      }

      // Sort to prioritize shortest paths
      resourceCandidates.sort((a, b) => a.length - b.length);

      if (resourceCandidates.length) {
        // Determine audio type by extension
        const lower = filename.toLowerCase();
        const isMod = ['.mod', '.xm', '.s3m', '.it', '.mptm'].some(ext => lower.endsWith(ext));
        const audioType = isMod ? 'mod' : (lower.endsWith('.wav') ? 'wav' : null);
        if (!audioType) {
          throw new Error('Unsupported audio type for on-demand load');
        }

          for (const key of resourceCandidates) {
          try {
              const path = key;
              const rec = await fileIOService.loadFile(path);
            if (!rec) continue;
            let buf;
            if (rec.content instanceof ArrayBuffer) {
              buf = rec.content;
            } else if (rec.binaryData && rec.fileContent) {
              const binaryString = atob(rec.fileContent);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
              buf = bytes.buffer;
            } else if (typeof rec.fileContent === 'string') {
              buf = new TextEncoder().encode(rec.fileContent).buffer;
            } else {
              continue;
            }
            const file = new File([buf], filename, { type: isMod ? 'application/octet-stream' : 'audio/wav' });
            const resourceId = await this.resourceManager.loadFromFile(file, audioType);
            this.loadedAudioResources.set(path, resourceId);
            this.updateStatus(`Loaded ${filename}`, 'success');
            return resourceId;
          } catch (resErr) {
            console.warn('[GameEditor] Failed to load resource candidate:', key, resErr);
          }
        }
      }
    } catch (error) {
      console.error('[GameEditor] Error during Resources storage lookup:', error);
    }

    // If we get here, the file wasn't found anywhere
    throw new Error(`File ${filename} not found in project or build files`);
    })();

    // Track in-flight and clean up when done
    this._inflightLoads.set(lookupPath, loadPromise);
    try {
      const id = await loadPromise;
      return id;
    } finally {
      // Remove only if this exact promise is still the one stored
      if (this._inflightLoads.get(lookupPath) === loadPromise) {
        this._inflightLoads.delete(lookupPath);
      }
    }
  }

  onResourceLoaded(event) {
    const { resourceId, resource, type } = event.detail;
    console.log(`[GameEditor] Resource loaded event: ${resourceId} (${type})`);
    this.updateStatus(`Loaded ${resource.name}`, 'success');
  }

  onResourceUpdated(event) {
    const { resourceId, property, value } = event.detail;
    console.log(`[GameEditor] Resource updated event: ${resourceId} ${property} = ${value}`);
    
    // Find the filename for this resource
    let filename = null;
    for (const [fileKey, loadedResourceId] of this.loadedAudioResources.entries()) {
      if (loadedResourceId === resourceId) {
        // Extract filename from the fileKey (which is like "Resources/Music/filename.mod")
        filename = fileKey.split('/').pop();
        break;
      }
    }
    
    // Notify the tab manager to update any open viewers for this resource
    if (this.tabManager && typeof this.tabManager.notifyResourceUpdated === 'function') {
      this.tabManager.notifyResourceUpdated(resourceId, property, value, filename);
    } else {
      console.warn('[GameEditor] TabManager.notifyResourceUpdated is not available');
    }
  }

  notifyResourceUpdated(resourceId, property, value) {
    // Legacy method - now just delegates to the event system
    console.log(`[GameEditor] Legacy notification: ${resourceId} ${property} = ${value}`);
    this.onResourceUpdated({ detail: { resourceId, property, value } });
  }
  
  async concatenateLuaScripts() {
    console.log('[GameEditor] Concatenating Lua scripts...');
    
    if (!this.projectExplorer && !this.runtimeFileManager) {
      throw new Error('Project explorer not available');
    }
    
    // Get all Lua files from the project
    const luaFiles = await this.getAllLuaFiles();
    
    if (luaFiles.length === 0) {
      return null;
    }
    
    console.log(`[GameEditor] Found ${luaFiles.length} Lua files to concatenate`);
    
    let concatenatedContent = '';
    let hasSetupFunction = false;
    
    // Add header comment
    concatenatedContent += '-- Auto-generated concatenated Lua script\n';
    concatenatedContent += `-- Generated at: ${new Date().toISOString()}\n`;
    concatenatedContent += `-- Files included: ${luaFiles.map(f => f.name).join(', ')}\n\n`;
    
    // Concatenate all Lua files
    for (const file of luaFiles) {
      concatenatedContent += `-- === File: ${file.name} ===\n`;
      
      let content = file.content;
      
      // Ensure content is a string
      if (typeof content !== 'string') {
        console.warn(`[GameEditor] Content for ${file.name} is not a string:`, typeof content, content);
        content = content ? String(content) : '';
      }
      
      // Check if this file contains a Setup function
      if (content.includes('function Setup()') || content.includes('function Setup (')) {
        hasSetupFunction = true;
        console.log(`[GameEditor] Found Setup() function in ${file.name}`);
      }
      
      concatenatedContent += content;
      concatenatedContent += '\n\n';
    }
    
    // If no Setup function was found, add a default one
    if (!hasSetupFunction) {
      console.log('[GameEditor] No Setup() function found, adding default one');
      concatenatedContent += `-- Default Setup function\nfunction Setup()\n  print("No Setup() function found in project")\nend\n`;
    }
    
    return {
      content: concatenatedContent,
      fileCount: luaFiles.length,
      hasSetup: hasSetupFunction,
      files: luaFiles.map(f => f.path || f.name) // Include file paths for error reporting
    };
  }
  
  async getAllLuaFiles() {
    const luaFiles = [];
    
    // Get the FileIOService from ServiceContainer
    const fileIOService = this.getActiveFileIOService();
    if (!fileIOService) {
      throw new Error('FileIOService is not available. Critical service missing from ServiceContainer.');
    }
    
    // Wait for FileIOService to be fully initialized
    await fileIOService.ensureReady();
    
    if (typeof fileIOService.getSourceScripts !== 'function') {
      throw new Error('FileIOService.getSourceScripts() method is not available. Service may be outdated.');
    }
    
    console.log('[GameEditor] Using FileIOService.getSourceScripts()');
    const sourceScripts = await fileIOService.getSourceScripts();
    console.log(`[GameEditor] Found ${sourceScripts.length} source Lua scripts:`, sourceScripts.map(f => f.path || f));
    
    // Load content for each source script
    for (const scriptFile of sourceScripts) {
      const scriptPath = scriptFile.path || scriptFile;
      const content = await this.loadFileContent(scriptPath);
      if (content !== null) {
        luaFiles.push({
          path: scriptPath,
          name: scriptPath.split(/[/\\]/).pop(), // Get filename from path
          content: content
        });
      }
    }
    
    return luaFiles;
  }
  
  async findLuaFilesRecursive(structure, currentPath, luaFiles, processedPaths) {
    for (const [name, item] of Object.entries(structure)) {
      const fullPath = currentPath ? `${currentPath}/${name}` : name;
      
      // Skip build directories and compiled files
      const lowerPath = fullPath.toLowerCase();
      if (lowerPath.includes('build/') || 
          lowerPath.includes('gameobjects/') || 
          lowerPath.includes('.sfx/') ||
          lowerPath.startsWith('build/') ||
          lowerPath.startsWith('gameobjects/')) {
        console.log(`[GameEditor] Skipping build/compiled directory: ${fullPath}`);
        continue;
      }
      
      if (item.type === 'file' && name.toLowerCase().endsWith('.lua')) {
        // Check for duplicates
        if (processedPaths.has(fullPath)) {
          console.log(`[GameEditor] Skipping duplicate Lua file: ${fullPath}`);
          continue;
        }
        processedPaths.add(fullPath);
        
        try {
          // Load file content from storage
          const content = await this.loadFileContent(fullPath);
          if (content !== null && content !== undefined) {
            // Ensure content is a string
            const stringContent = typeof content === 'string' ? content : String(content || '');
            luaFiles.push({
              name: name,
              path: fullPath,
              content: stringContent
            });
            console.log(`[GameEditor] Added source Lua file: ${fullPath} (${stringContent.length} chars)`);
            console.log(`[GameEditor] Content preview:`, stringContent.substring(0, 100) + '...');
          } else {
            console.warn(`[GameEditor] Skipping Lua file ${fullPath}: content is null/undefined`);
          }
        } catch (error) {
          console.warn(`[GameEditor] Failed to load Lua file ${fullPath}:`, error);
        }
      } else if (item.type === 'folder' && item.children) {
        await this.findLuaFilesRecursive(item.children, fullPath, luaFiles, processedPaths);
      }
    }
  }
  
  async loadFileContent(filePath) {
    try {
      // Use the same loading mechanism as the file manager
      const fileManager = this.getActiveFileManager();
      if (!fileManager) {
        console.error('[GameEditor] File manager not available');
        return null;
      }
      
      const normalizedPath = fileManager === this.runtimeFileManager
        ? filePath
        : this.normalizeStoragePath(filePath);
      console.log(`[GameEditor] Loading file content: ${normalizedPath}`);
      
      const result = await fileManager.loadFile(normalizedPath);
      console.log(`[GameEditor] File manager returned:`, typeof result, result);
      
      // Handle the file manager's response format (same as LuaEditor)
      let content = null;
      
      if (result) {
        // File manager returns an object with content property
        content = result.content ?? result.fileContent ?? '';
      }
      
      // Ensure we return a string or null
      if (content === null || content === undefined) {
        console.warn(`[GameEditor] File content is null/undefined for: ${normalizedPath}`);
        return null;
      }
      
      // Convert to string if it's not already
      if (typeof content !== 'string') {
        console.log(`[GameEditor] Converting content to string (was ${typeof content})`);
        content = String(content);
      }
      
      console.log(`[GameEditor] Final content length: ${content.length} chars`);
      console.log(`[GameEditor] Content preview:`, content.substring(0, 100) + '...');
      return content;
    } catch (error) {
      console.error(`[GameEditor] Error loading file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Preprocess Lua script for pico-8 compatibility
   * Converts compound assignment operators (+=, -=, etc.) to standard Lua
   * @param {string} code - Raw Lua code
   * @returns {string} Preprocessed code
   */
  preprocessLuaScript(code) {
    if (!code) return code;
    
    // Convert compound assignment operators to standard Lua
    // Pattern: variable += value -> variable = variable + value
    // Handles: +=, -=, *=, /=, %=
    
    // Match compound assignments, being careful not to match == or ~= or other operators
    const compoundOpsPattern = /([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\[[^\]]+\])?)\s*(\+=|-=|\*=|\/=|%=)\s*(.+?)(?=\n|;|$)/g;
    
    let preprocessed = code.replace(compoundOpsPattern, (match, variable, operator, value) => {
      // Extract the actual operator (without the =)
      const actualOp = operator.slice(0, -1);
      return `${variable} = ${variable} ${actualOp} ${value}`;
    });

    // Also handle cases where there's no newline at the end of the last statement
    // This catches += at the very end of the code
    preprocessed = preprocessed.replace(/([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\[[^\]]+\])?)\s*(\+=|-=|\*=|\/=|%=)\s*(.+?)$/gm, (match, variable, operator, value) => {
      const actualOp = operator.slice(0, -1);
      return `${variable} = ${variable} ${actualOp} ${value}`;
    });
    
    // Debug: log if preprocessing made changes
    if (preprocessed !== code) {
      console.log('[GameEmulator] Lua preprocessing applied - compound operators converted to standard Lua');
    }
    
    return preprocessed;
  }

  async loadAndExecuteScript(scriptData) {
    console.log('[GameEmulator] Loading and executing Lua script...');
    this.updateStatus('Loading Lua script...', 'info');
    this._renderOrderCounter = 1;

    const runStart = performance.now();
    let runPhaseStart = runStart;
    const logRunPhase = (label) => {
      const now = performance.now();
      const phaseMs = now - runPhaseStart;
      const totalMs = now - runStart;
      console.log(`[Timing][Run] ${label}: ${phaseMs.toFixed(1)}ms (total ${totalMs.toFixed(1)}ms)`);
      runPhaseStart = now;
    };
    
    try {
      // Load Lua engine if not already loaded
      if (!window.Lua) {
        await this.loadLuaEngine();
        logRunPhase('loadLuaEngine (cold)');
      } else {
        logRunPhase('loadLuaEngine (warm)');
      }
      
      // Create a new Lua state
      const L = new window.Lua.State();
      this.luaState = L;
      logRunPhase('createLuaState');
      
      // Initialize print output capture.
      this.installLuaPrintCapture(L);
      
      // Initialize centralized resource mappings
      await this.initializeResourceMappings();
      logRunPhase('initializeResourceMappings');
      
      // Load and initialize Lua extensions
      console.log('[GameEmulator] Loading Lua extensions...');
      try {
        await this.loadLuaExtensions(L);
        // Extensions (especially Pico8 global aliases) can replace print.
        // Reapply capture so all print calls continue flowing to the game console.
        this.installLuaPrintCapture(L);
        await this.verifyLuaApiContract(L);
        console.log('[GameEmulator] Lua extensions loaded successfully');
        logRunPhase('loadLuaExtensions');
        
        // Test Input API availability
        try {
          const testInput = L.execute('return type(Input)');
          console.log('[GameEmulator] Input type check:', testInput);
          
          if (testInput && testInput[0] === 'table') {
            const testGetKeysHeld = L.execute('return type(Input.GetKeysHeld)');
            console.log('[GameEmulator] Input.GetKeysHeld type:', testGetKeysHeld);
          }
        } catch (testError) {
          console.error('[GameEmulator] Input API test failed:', testError);
        }
        
      } catch (error) {
        this.reportFatalLuaApiInitializationError(error);
        console.error('[GameEmulator] Failed to load Lua extensions:', error);
        logRunPhase('loadLuaExtensions (failed)');
        this.updateStatus(`Lua extension initialization failed: ${error.message}`, 'error');

        await this.showErrorPopup(
          'Lua API Initialization Error',
          'Required Lua APIs failed to initialize. Execution has been stopped to prevent hidden runtime faults.',
          `Error: ${error.message}\n\nFix the extension/API mismatch and run again.`
        );
        return;
      }

      await this.initializeInputManager();
      logRunPhase('initializeInputManager');

      const pico8Ext = this.getLuaExtension('Pico8');
      if (pico8Ext && typeof pico8Ext.resetRuntimeState === 'function') {
        pico8Ext.resetRuntimeState();
      }
      
      console.log('[GameEmulator] Concatenated Lua script:');
      console.log(scriptData.content);
      
      // Preprocess script for pico-8 compatibility (+=, -=, etc.)
      const preprocessedCode = this.preprocessLuaScript(scriptData.content);
      
      // Load the concatenated script into Lua
      console.log('[GameEmulator] Loading script into Lua engine...');
      try {
        L.execute(preprocessedCode);
        console.log('[GameEmulator] Script loaded successfully');
        logRunPhase('luaLoadScript');
        
        // Check what functions are defined in the global scope
        try {
          // Check function definitions silently
          L.execute(`
            -- Silent function verification (no debug output)
            local setup_type = type(Setup)
            local update_type = type(Update)
            local system_exists = System ~= nil
            -- Functions exist, no output needed
          `);
        } catch (checkError) {
          console.error('[GameEmulator] Error checking function definitions:', checkError);
        }
        
      } catch (error) {
        console.error('[GameEmulator] Lua script loading error:', error);
        this.updateStatus(`Script loading error: ${error.message}`, 'error');
        
        await this.showErrorPopup(
          'Script Loading Error', 
          'An error occurred while loading the Lua script.',
          `Error: ${error.message}\n\nThis usually indicates a syntax error in your Lua code.`
        );
        return;
      }
      
      // Try to run Setup() function (optional)
      console.log('[GameEmulator] Attempting to run Setup() function...');
      try {
        // First check if Setup function exists
        L.execute('if Setup == nil then error("Setup function is not defined") end');
        console.log('[GameEmulator] Setup function exists, calling it...');
        
        L.execute('Setup()');
        console.log('[GameEmulator] Setup() function executed successfully');
        // Capture any print output from Setup()
        this.captureLuaPrintOutput();
        logRunPhase('luaSetup');
      } catch (error) {
        console.log('[GameEmulator] Setup() function issue:', error.message);
        if (error.message.includes('Setup function is not defined')) {
          console.log('[GameEmulator] Setup() function not found - this is optional, continuing...');
        } else {
          console.error('[GameEmulator] Setup() function failed during execution:', error);
          this.updateStatus(`Setup() error: ${error.message}`, 'error');

          await this.showErrorPopup(
            'Setup() Function Runtime Error',
            'Your Setup() function exists but has a runtime error.',
            `Lua Error: ${error.message}\n\nPlease fix the error in your Setup() function.`
          );
          return;
        }
        logRunPhase('luaSetup (optional/missing/error)');
      }
      
      // Test Update() function (required) - check if it exists first
      console.log('[GameEmulator] Testing Update() function...');
      try {
        // First check if Update function exists
        const updateExists = L.execute('return type(Update) == "function"');
        
        if (!updateExists) {
          console.error('[GameEmulator] Update() function is not defined');
          this.updateStatus('Error: Missing Update() function', 'error');
          
          await this.showErrorPopup(
            'Missing Update() Function', 
            'Your Lua scripts must contain an Update(deltaTime) function.',
            `The Update function is required and will be called continuously. Please add:\n\nfunction Update(deltaTime)\n  -- Your game logic here\nend`
          );
          return;
        }
        
        // Function exists, now test calling it
        L.execute('Update(16.67)');
        console.log('[GameEmulator] Update() function test successful');
        // Capture any print output from test Update()
        this.captureLuaPrintOutput();
        logRunPhase('luaUpdateSmokeTest');
      } catch (error) {
        console.error('[GameEmulator] Update() function runtime error:', error);
        this.updateStatus(`Update() runtime error: ${error.message}`, 'error');
        
        await this.showErrorPopup(
          'Update() Function Runtime Error', 
          'Your Update() function exists but has a runtime error.',
          `Lua Error: ${error.message}\n\nPlease fix the error in your Update() function.`
        );
        return;
      }
      
      console.log('[GameEmulator] Script loaded and validated successfully');
      this.updateStatus('Script loaded successfully', 'success');
      
      // ── Initialize D2Canvas GPU renderer on the game canvas ──────
      try {
        const root = this.contentContainer || document;
        const gameCanvas = root.querySelector('#game-canvas');
        if (gameCanvas && window.D2Canvas) {
          // Set canvas to RetroWatch LCD resolution (448 wide × 368 tall)
          gameCanvas.width = 448;
          gameCanvas.height = 368;
          this._gpu = new D2Canvas(gameCanvas);
          this._gpu.resize(448, 368);
          console.log('[GameEmulator] D2Canvas GPU renderer initialized (448×368)');

          // Load palette map (PMAP), textures, and prepare render extensions.
          const spriteExt = this.extensionLoader?.getExtension('Sprite');
          if (spriteExt) {
            await spriteExt.initGpu(this._gpu);
          }
          const imageExt = this.extensionLoader?.getExtension('Image');
          if (imageExt) {
            await imageExt.initGpu(this._gpu);
          }
          const tileMapExt = this.extensionLoader?.getExtension('TileMap');
          if (tileMapExt && typeof tileMapExt.setGpu === 'function') {
            tileMapExt.setGpu(this._gpu);
          }
          const textboxExt = this.extensionLoader?.getExtension('TextBox');
          if (textboxExt) {
            await textboxExt.initGpu(this._gpu);
          }
          const pico8Ext = this.getLuaExtension('Pico8');
          if (pico8Ext && typeof pico8Ext.initGpu === 'function') {
            pico8Ext.initGpu(this._gpu);
          }
          logRunPhase('gpuInit');
        } else {
          console.warn('[GameEmulator] D2Canvas not available — sprite rendering disabled');
          this._gpu = null;
          logRunPhase('gpuInit (skipped)');
        }
      } catch (gpuError) {
        console.error('[GameEmulator] GPU init failed:', gpuError);
        this._gpu = null;
        // Lose the broken WebGL context to prevent cascading failures
        try {
          const root = this.contentContainer || document;
          const gameCanvas = root.querySelector('#game-canvas');
          const loseCtx = gameCanvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context');
          if (loseCtx) loseCtx.loseContext();
        } catch (_) { /* best effort */ }
        logRunPhase('gpuInit (failed)');
      }
      
      // Start the game loop
      console.log('[GameEmulator] About to start game loop...');
      this.startGameLoop();
      console.log('[GameEmulator] Game loop start command issued');
      logRunPhase('startGameLoop');
      
      // Show game engine
      this.showGameEngine(scriptData);
      logRunPhase('showGameEngine');

      console.log(`[Timing][Run] COMPLETE: ${(performance.now() - runStart).toFixed(1)}ms`);
      
    } catch (error) {
      console.error('[GameEmulator] Script execution error:', error);
      this.updateStatus(`Script execution error: ${error.message}`, 'error');
      
      await this.showErrorPopup(
        'Script Execution Error',
        'An error occurred while executing the Lua script.',
        `Error: ${error.message}\n\nStack trace:\n${error.stack || 'No stack trace available'}`
      );
    }
  }

  async playRuntimePackage(runtimePackage = null) {
    if (runtimePackage) {
      this.setRuntimePackage(runtimePackage);
    }

    if (!this.runtimeFileManager) {
      throw new Error('No runtime package has been loaded.');
    }

    this.installRuntimeFileServices();
    this.updateStatus('Preparing runtime package...', 'info');

    const playStart = performance.now();
    let phaseStart = playStart;
    const logPhase = (label) => {
      const now = performance.now();
      const phaseMs = now - phaseStart;
      const totalMs = now - playStart;
      console.log(`[Timing][Runtime] ${label}: ${phaseMs.toFixed(1)}ms (total ${totalMs.toFixed(1)}ms)`);
      phaseStart = now;
    };

    try {
      const concatenatedScript = await this.concatenateLuaScripts();
      logPhase('concatenateLuaScripts');

      if (!concatenatedScript) {
        throw new Error('No Lua scripts found in runtime package.');
      }

      await this.loadAndExecuteScript(concatenatedScript);
      logPhase('loadAndExecuteScript');
      console.log(`[Timing][Runtime] COMPLETE: ${(performance.now() - playStart).toFixed(1)}ms`);
    } catch (error) {
      console.error('[GameEmulator] Error running runtime package:', error);
      this.updateStatus(`Error running runtime package: ${error.message}`, 'error');
      throw error;
    }
  }
  
  startGameLoop() {
    console.log('[GameEmulator] Starting game loop...');
    this.isRunning = true;
    this.isPaused = false; // Make sure we start unpaused
    this.lastFrameTime = performance.now();
    this.frameCount = 0;
    this.showCompileOverlay();
    
    // Update button appearance
    this.updatePlayPauseButton();
    
    const runFrame = () => {
      if (!this.isRunning || !this.luaState) {
        console.log('[GameEmulator] Game loop stopped - isRunning:', this.isRunning, 'luaState:', !!this.luaState);
        return;
      }
      
      const currentTime = performance.now();
      const deltaTime = currentTime - this.lastFrameTime;
      this.lastFrameTime = currentTime;
      this.frameCount++;
      
      try {
        // Update input manager first (processes input for this frame)
        if (this.inputManager) {
          this.inputManager.updateFrame();
        }
        
        // Only update if not paused
        if (!this.isPaused) {
          // Call Update(deltaTime) in Lua
          this.luaState.execute(`Update(${deltaTime})`);
        }
        
        // ── Render pass ──────────────────────────────────────────────
        // Clear the GPU canvas and let each renderable extension draw.
        // Sprite/Image extensions use D2Canvas.blit() for hardware-accurate rendering.
        if (this._gpu) {
          this._gpu.clear(
            this.clearColor.r,
            this.clearColor.g,
            this.clearColor.b,
            this.clearColor.a
          );
          const renderQueue = [];
          const enqueueRenderItem = (item) => {
            if (item && typeof item.draw === 'function') {
              renderQueue.push(item);
            }
          };
          const renderOptions = { enqueue: enqueueRenderItem };

          const tileMapExt = this.extensionLoader?.getExtension('TileMap');
          if (tileMapExt && typeof tileMapExt.renderFrame === 'function') {
            tileMapExt.renderFrame(this._gpu, deltaTime, renderOptions);
          }
          const spriteExt = this.extensionLoader?.getExtension('Sprite');
          if (spriteExt) {
            spriteExt.renderFrame(this._gpu, deltaTime, renderOptions);
          }
          const imageExt = this.extensionLoader?.getExtension('Image');
          if (imageExt) {
            imageExt.renderFrame(this._gpu, deltaTime, renderOptions);
          }
          const textboxExt = this.extensionLoader?.getExtension('TextBox');
          if (textboxExt) {
            textboxExt.renderFrame(this._gpu, deltaTime, renderOptions);
          }
          const pico8Ext = this.getLuaExtension('Pico8');
          if (pico8Ext && typeof pico8Ext.renderFrame === 'function') {
            pico8Ext.renderFrame(this._gpu, deltaTime, renderOptions);
          }

          if (renderQueue.length > 0) {
            renderQueue.sort((a, b) => {
              const aLayer = Number.isFinite(a.z) ? a.z : (a.defaultLayer ?? 0);
              const bLayer = Number.isFinite(b.z) ? b.z : (b.defaultLayer ?? 0);
              if (aLayer !== bLayer) {
                return aLayer - bLayer;
              }
              const aOrder = a.creationOrder ?? 0;
              const bOrder = b.creationOrder ?? 0;
              return aOrder - bOrder;
            });

            for (const item of renderQueue) {
              item.draw();
            }
          }
          const didDrawFrame = this._gpu.present();
          this.updateCompileOverlay(didDrawFrame);
        }
        
        // Always check for new print output from Lua (even when paused, to capture any buffered output)
        this.captureLuaPrintOutput();

        if (this.inputManager) {
          this.inputManager.endFrame();
        }
        
        // Debug input state every second (only when there's actual input)
        if (this.frameCount % 60 === 0) {
          if (this.inputManager && this.inputManager.isActive) {
            // Input debug available via inputManager.getDebugInfo() if needed
          }
        }
      } catch (error) {
        console.error('[GameEmulator] Error in Update() function:', error);
        this.stopGameLoop();
        this.updateStatus(`Update() error: ${error.message}`, 'error');
        this.showErrorPopup(
          'Simulator Runtime Error',
          error.message || String(error),
          error.stack || String(error)
        );
        
        return;
      }
      
      // Schedule next frame (60fps = ~16.67ms)
      setTimeout(() => {
        if (this.isRunning) {
          requestAnimationFrame(runFrame);
        }
      }, 1000 / 60);
    };
    
    console.log('[GameEmulator] Starting first frame...');
    requestAnimationFrame(runFrame);
  }
  
  stopGameLoop() {
    console.log('[GameEmulator] Stopping game loop...');
    this.isRunning = false;
    this.isPaused = false; // Reset pause state when stopping
    this.hideCompileOverlay();
    this.updateStatus('Game loop stopped', 'info');
    
    // Update button appearance
    this.updatePlayPauseButton();
  }

  updateCompileOverlay(didDrawFrame) {
    if (this.compileOverlayHidden) {
      return;
    }

    const elapsedSinceOverlayShown = performance.now() - (this.compileOverlayShownAt || 0);
    const shouldHideOverlay = didDrawFrame || elapsedSinceOverlayShown > 800;
    if (!shouldHideOverlay) {
      return;
    }

    this.hideCompileOverlay();

    if (this.options.autoFocusCanvas !== false) {
      this.focusGameCanvas();
    }
  }

  showCompileOverlay() {
    const overlay = this.contentContainer?.querySelector('.simulator-compile-overlay');
    if (!overlay) {
      throw new Error('Simulator compile overlay is not available.');
    }

    overlay.classList.remove('hidden');
    this.compileOverlayHidden = false;
    this.compileOverlayShownAt = performance.now();
  }

  hideCompileOverlay() {
    const overlay = this.contentContainer?.querySelector('.simulator-compile-overlay');
    if (!overlay) {
      throw new Error('Simulator compile overlay is not available.');
    }

    overlay.classList.add('hidden');
    this.compileOverlayHidden = true;
    this.compileOverlayShownAt = 0;
  }

  /**
   * Stop the currently running project
   */
  stopProject() {
    console.log('[GameEmulator] Stopping project...');

    if (this.embeddedRuntimePlayer) {
      this.destroyEmbeddedRuntimePlayer();
      this.renderGameEngineContent();
      this.isRunning = false;
      this.isPaused = false;
      this.updateStatus('Project stopped', 'info');
      return;
    }

    this.stopGameLoop();
    
    // Reset all extensions (clear old state)
    if (this.extensionLoader) {
      this.extensionLoader.resetExtensions();
    }
    
    // Destroy GPU renderer (WebGL context will be reclaimed)
    if (this._gpu) {
      this._gpu.destroy();
      this._gpu = null;
    }
    
    // Stop all audio
    if (this.audioEngine) {
      this.audioEngine.stopAllAudio();
    }

    if (this.hasDeferredResourceInvalidation) {
      this.applyResourceCacheInvalidation();
    }

    this.restoreRuntimeFileServices();
    this.runtimePackage = null;
    this.runtimeFileManager = null;
    
    this.updateStatus('Project stopped', 'info');
  }

  /**
   * Toggle play/pause state - main control button
   */
  async togglePlayPause() {
    this.syncPlaybackStateFromHost();

    if (this.isStarting) {
      console.warn('[GameEmulator] Ignoring play/pause toggle while a run is already starting');
      return;
    }

    if (!this.isRunning) {
      // Not running, so start playing
      await this.playProject();
    } else if (this.isPaused) {
      // Currently paused, so resume
      this.resumeGame();
    } else {
      // Currently running, so pause
      this.pauseGame();
    }
    
    // Update button appearance
    this.updatePlayPauseButton();
  }

  /**
   * Pause the game (separate from toggle for clarity)
   */
  pauseGame() {
    if (this.embeddedRuntimePlayer) {
      const playbackHost = this.embeddedRuntimePlayer.gameEmulator;
      playbackHost.pauseGame();
      this.syncPlaybackStateFromHost();
      this.updateStatus('Game paused', 'info');
      return;
    }

    if (!this.isRunning) {
      console.log('[GameEmulator] Cannot pause - game is not running');
      return;
    }

    this.isPaused = true;
    console.log('[GameEmulator] Game paused');
    
    if (this.audioEngine && this.audioEngine.workletNode) {
      console.log('[GameEmulator] Pausing audio at mixer level');
      this.audioEngine.workletNode.port.postMessage({ type: 'pause-audio' });
    }
    
    this.updateStatus('Game paused', 'info');
  }

  /**
   * Resume the game (separate from toggle for clarity)
   */
  resumeGame() {
    if (this.embeddedRuntimePlayer) {
      const playbackHost = this.embeddedRuntimePlayer.gameEmulator;
      playbackHost.resumeGame();
      this.syncPlaybackStateFromHost();
      this.updateStatus('Game resumed', 'info');
      return;
    }

    if (!this.isRunning) {
      console.log('[GameEmulator] Cannot resume - game is not running');
      return;
    }

    this.isPaused = false;
    console.log('[GameEmulator] Game resumed');
    
    if (this.audioEngine && this.audioEngine.workletNode) {
      console.log('[GameEmulator] Resuming audio at mixer level');
      this.audioEngine.workletNode.port.postMessage({ type: 'resume-audio' });
    }
    
    this.updateStatus('Game resumed', 'info');
  }

  /**
   * Stop the game - when play is pressed again, it will reload
   */
  stopGame() {
    console.log('[GameEmulator] Stopping game...');
    this.stopProject();
    this.updatePlayPauseButton();
  }

  /**
   * Toggle pause/resume state
   */
  togglePauseResume() {
    if (!this.isRunning) {
      console.log('[GameEmulator] Cannot pause/resume - game is not running');
      return;
    }

    this.isPaused = !this.isPaused;
    console.log(`[GameEmulator] ${this.isPaused ? 'Paused' : 'Resumed'} game`);
    
    // Update button appearance
    this.updatePauseResumeButton();
    
    if (this.isPaused) {
      // Pause all audio at the mixer level (preserves all playback state)
      if (this.audioEngine && this.audioEngine.workletNode) {
        console.log('[GameEmulator] Pausing audio at mixer level');
        this.audioEngine.workletNode.port.postMessage({ type: 'pause-audio' });
      }
      
      this.updateStatus('Game paused', 'info');
    } else {
      // Resume all audio at the mixer level
      if (this.audioEngine && this.audioEngine.workletNode) {
        console.log('[GameEmulator] Resuming audio at mixer level');
        this.audioEngine.workletNode.port.postMessage({ type: 'resume-audio' });
      }
      
      this.updateStatus('Game resumed', 'info');
    }
  }

  /**
   * Reload the game (rebuild and restart)
   */
  async reloadGame() {
    console.log('[GameEmulator] Reloading game...');
    this.updateStatus('Reloading game...', 'info');
    
    try {
      // Stop current game
      this.stopGameLoop();
      
      // Clear any paused state
      this.isPaused = false;
      this.updatePauseResumeButton();
      
      // Restart the game (this will rebuild and reload)
      await this.playProject();
      
    } catch (error) {
      console.error('[GameEmulator] Error reloading game:', error);
      this.updateStatus(`Reload failed: ${error.message}`, 'error');
    }
  }

  /**
   * Update pause/resume button appearance
   */
  updatePauseResumeButton() {
    const root = this.contentContainer || document;
    const pauseResumeBtn = root.querySelector('#pauseResumeBtn');
    if (pauseResumeBtn) {
      const icon = pauseResumeBtn.querySelector('.btn-icon');
      const text = pauseResumeBtn.querySelector('.btn-text');
      
      if (this.isPaused) {
        if (icon) icon.textContent = '▶️';
        if (text) text.textContent = 'Resume';
        pauseResumeBtn.classList.add('paused');
        pauseResumeBtn.title = 'Resume Game';
      } else {
        if (icon) icon.textContent = '⏸️';
        if (text) text.textContent = 'Pause';
        pauseResumeBtn.classList.remove('paused');
        pauseResumeBtn.title = 'Pause Game';
      }
    }
  }

  updatePlayPauseButton() {
    const root = this.contentContainer || document;
    const playPauseBtn = root.querySelector('#playPauseBtn');
    if (playPauseBtn) {
      const icon = playPauseBtn.querySelector('.btn-icon');
      const text = playPauseBtn.querySelector('.btn-text');
      const playbackHost = this.getPlaybackHost();
      const isRunning = !!playbackHost.isRunning;
      const isPaused = !!playbackHost.isPaused;
      
      if (!isRunning) {
        // Not running - show play
        if (icon) icon.textContent = '▶️';
        if (text) text.textContent = 'Play';
        playPauseBtn.classList.remove('paused', 'running');
        playPauseBtn.title = 'Play Game';
      } else if (isPaused) {
        // Running but paused - show play
        if (icon) icon.textContent = '▶️';
        if (text) text.textContent = 'Resume';
        playPauseBtn.classList.add('paused');
        playPauseBtn.classList.remove('running');
        playPauseBtn.title = 'Resume Game';
      } else {
        // Running and not paused - show pause
        if (icon) icon.textContent = '⏸️';
        if (text) text.textContent = 'Pause';
        playPauseBtn.classList.add('running');
        playPauseBtn.classList.remove('paused');
        playPauseBtn.title = 'Pause Game';
      }
    }
  }
  
  async executeLuaScript(scriptContent) {
    try {
      // Load Lua engine if not already loaded
      if (!window.Lua) {
        await this.loadLuaEngine();
      }
      
      // Create a new Lua state
      const L = new window.Lua.State();
      let output = '';
      
      // Capture print output and execute everything in one go
      const luaCode = `
        -- Capture print output
        local original_print = print
        local captured_output = {}
        
        function print(...)
          local args = {...}
          local str = ""
          for i, v in ipairs(args) do
            if i > 1 then str = str .. "\\t" end
            str = str .. tostring(v)
          end
          table.insert(captured_output, str)
          original_print(...)
        end
        
        -- User's script
        ${scriptContent}
        
        -- Call Setup function
        Setup()
        
        -- Return captured output
        return table.concat(captured_output, "\\n")
      `;
      
      // Execute everything and get the result
      const result = L.execute(luaCode);
      output = result && result[0] || 'Setup() function executed successfully';
      
      console.log('[GameEditor] Lua output:', output);
      return output;
      
    } catch (error) {
      console.error('[GameEditor] Lua execution error:', error);
      throw new Error(`Lua execution failed: ${error.message}`);
    }
  }
  
  async loadLuaExtensions(luaState) {
    try {
      // Load the extension loader if not already loaded
      if (!window.LuaExtensionLoader) {
        await this.loadExtensionLoader();
      }
      
      // Create extension loader instance
      if (!this.extensionLoader) {
        this.extensionLoader = new window.LuaExtensionLoader(this);
      }
      
      // Initialize all extensions
      await this.extensionLoader.initializeExtensions(luaState);
      
    } catch (error) {
      console.error('[GameEmulator] Failed to load Lua extensions:', error);
      throw error;
    }
  }

  async verifyLuaApiContract(luaState) {
    const config = this.extensionLoader?.getExtensionConfig?.();
    if (!config || !Array.isArray(config.categories)) {
      throw new Error('Lua API contract not available for verification.');
    }

    for (const category of config.categories) {
      if (!Array.isArray(category.functions) || category.functions.length === 0) {
        continue;
      }

      const categoryType = luaState.execute(`return type(${category.name})`);
      const categoryTypeValue = Array.isArray(categoryType) ? categoryType[0] : categoryType;
      if (categoryTypeValue !== 'table') {
        throw new Error(`Lua API verification failed: ${category.name} expected table, got ${categoryTypeValue || 'nil'}`);
      }

      for (const func of category.functions) {
        const funcType = luaState.execute(`return type(${category.name}.${func.name})`);
        const funcTypeValue = Array.isArray(funcType) ? funcType[0] : funcType;
        if (funcTypeValue !== 'function') {
          throw new Error(`Lua API verification failed: ${category.name}.${func.name} expected function, got ${funcTypeValue || 'nil'}`);
        }
      }
    }
  }

  reportFatalLuaApiInitializationError(error) {
    const message = error?.message || String(error);
    console.error('============================================================');
    console.error('[FATAL][LuaAPI] Initialization/verification failed. Execution must stop.');
    console.error(`[FATAL][LuaAPI] ${message}`);
    console.error('[FATAL][LuaAPI] Missing or invalid Lua API is catastrophic by design.');
    console.error('============================================================');

    try {
      window.dispatchEvent(new CustomEvent('retrostudio:lua-api-fatal', {
        detail: {
          message,
          timestamp: new Date().toISOString(),
        },
      }));
    } catch (_) {
      // Event emission is best-effort; never mask the fatal failure.
    }
  }
  
  async loadExtensionLoader() {
    if (typeof window.LuaExtensionLoader === 'function') {
      return;
    }

    if (!window.__luaExtensionLoaderPromise) {
      window.__luaExtensionLoaderPromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector('script[data-lua-extension-loader="true"]');
        if (existingScript) {
          reject(new Error('Lua extension loader script is present but window.LuaExtensionLoader is not registered.'));
          return;
        }

        const script = document.createElement('script');
        script.dataset.luaExtensionLoader = 'true';
        script.src = `scripts/lua/extension-loader.js?v=${Date.now()}`;
        script.onload = () => {
          if (typeof window.LuaExtensionLoader !== 'function') {
            reject(new Error('LuaExtensionLoader did not register after script load.'));
            return;
          }
          console.log('[GameEmulator] Extension loader loaded successfully');
          resolve();
        };
        script.onerror = (error) => {
          console.error('[GameEmulator] Failed to load extension loader:', error);
          reject(new Error('Failed to load extension loader'));
        };
        document.head.appendChild(script);
      }).catch((error) => {
        delete window.__luaExtensionLoaderPromise;
        throw error;
      });
    }

    return window.__luaExtensionLoaderPromise;
  }

  async loadLuaEngine() {
    return new Promise((resolve, reject) => {
      if (window.Lua) {
        resolve();
        return;
      }
      
      console.log('[GameEditor] Loading Lua engine...');
      const script = document.createElement('script');
      script.src = 'scripts/external/lua/dist/lua.vm.js';
      script.onload = () => {
        console.log('[GameEditor] Lua engine loaded successfully');
        resolve();
      };
      script.onerror = (error) => {
        console.error('[GameEditor] Failed to load Lua engine:', error);
        reject(new Error('Failed to load Lua engine'));
      };
      document.head.appendChild(script);
    });
  }
  
  captureLuaPrintOutput() {
    if (!this.luaState) {
      throw new Error('Lua state is not initialized.');
    }

    const rawBufferSize = this.luaState.execute('return #_print_buffer');
    const bufferSize = Array.isArray(rawBufferSize)
      ? Number(rawBufferSize[0] || 0)
      : Number(rawBufferSize || 0);
    if (bufferSize <= 0) {
      return;
    }

    if (!this.gameConsole) {
      this.luaState.execute('_print_buffer = {}');
      if (this.options.showConsole !== false) {
        throw new Error('GameConsole is not initialized.');
      }
      return;
    }

    for (let i = 1; i <= bufferSize; i++) {
      const rawOutput = this.luaState.execute(`return _print_buffer[${i}]`);
      const output = Array.isArray(rawOutput) ? rawOutput[0] : rawOutput;
      this.gameConsole.writeToConsole(output ?? '', true);
    }

    this.luaState.execute('_print_buffer = {}');
  }

  installLuaPrintCapture(luaState) {
    if (!luaState) {
      throw new Error('Lua state is required to install print capture.');
    }

    luaState.execute(`
      _print_buffer = _print_buffer or {}

      if _retrostudio_original_print == nil then
        _retrostudio_original_print = print
      end

      function print(...)
        local parts = {}
        for i = 1, select('#', ...) do
          local v = select(i, ...)
          table.insert(parts, tostring(v))
        end
        table.insert(_print_buffer, table.concat(parts, "\\t"))

        if _retrostudio_original_print then
          _retrostudio_original_print(...)
        end
      end
    `);
  }

  showGameEngine(scriptData) {
    // NOTE: No longer rebuilding entire DOM - this was leftover from old tab-switching behavior
    // The UI is already rendered from initialization, just need to initialize input manager
    
    // Initialize input manager for the game
    this.initializeInputManager();
  }
  
  showErrorPopup(title, message, details = null) {
    // Remove existing error popup if it exists
    const existingPopup = document.querySelector('.error-popup-overlay');
    if (existingPopup) {
      existingPopup.remove();
    }
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'error-popup-overlay';
    
    // Create popup container
    const popup = document.createElement('div');
    popup.className = 'error-popup';
    popup.innerHTML = `
      <div class="error-popup-header">
        <div class="error-icon">⚠️</div>
        <h3>${this.escapeHtml(title)}</h3>
        <button class="error-popup-close">×</button>
      </div>
      <div class="error-popup-content">
        <div class="error-message">${this.escapeHtml(message)}</div>
        ${details ? `
          <div class="error-details-section">
            <button class="error-details-toggle">Show Details</button>
            <div class="error-details" style="display: none;">
              <pre>${this.escapeHtml(details)}</pre>
            </div>
          </div>
        ` : ''}
      </div>
      <div class="error-popup-actions">
        <button class="error-popup-btn primary">OK</button>
      </div>
    `;
    
    overlay.appendChild(popup);
    
    // Add to body
    document.body.appendChild(overlay);
    
    // Animate in
    setTimeout(() => {
      overlay.classList.add('visible');
    }, 10);
    
    // Setup event listeners
    this.setupErrorPopupEvents(overlay, popup);
    
    return new Promise((resolve) => {
      overlay.addEventListener('close', () => resolve());
    });
  }
  
  setupErrorPopupEvents(overlay, popup) {
    // Close button
    const closeBtn = popup.querySelector('.error-popup-close');
    const okBtn = popup.querySelector('.error-popup-btn.primary');
    
    const closePopup = () => {
      overlay.classList.remove('visible');
      setTimeout(() => {
        overlay.remove();
        overlay.dispatchEvent(new Event('close'));
      }, 200);
    };
    
    closeBtn.addEventListener('click', closePopup);
    okBtn.addEventListener('click', closePopup);
    
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closePopup();
      }
    });
    
    // Details toggle
    const detailsToggle = popup.querySelector('.error-details-toggle');
    const detailsSection = popup.querySelector('.error-details');
    
    if (detailsToggle && detailsSection) {
      detailsToggle.addEventListener('click', () => {
        const isVisible = detailsSection.style.display !== 'none';
        detailsSection.style.display = isVisible ? 'none' : 'block';
        detailsToggle.textContent = isVisible ? 'Show Details' : 'Hide Details';
      });
    }
    
    // ESC key to close
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        closePopup();
        document.removeEventListener('keydown', handleKeyDown);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
  }
  
  /**
   * Initialize the game engine panel content (called once on startup)
   */
  initializeGameEnginePanel() {
    if (!this.contentContainer) {
      console.error('[GameEmulator] No content container provided to constructor');
      return;
    }

    // Render the initial content
    this.renderGameEngineContent();
  }

  /**
   * Render the game engine panel content
   */
  renderGameEngineContent(scriptData) {
    if (!this.contentContainer) {
      console.error('[GameEmulator] No content container provided');
      return;
    }

    // Extract data from scriptData or use defaults
    const currentOutput = 'No output yet...'; // GameConsole handles all output display
    const output = scriptData?.output || currentOutput;
    const overlay = this.options.overlayImagePath
      ? `<img class="game-screen-overlay" src="${this.options.overlayImagePath}" alt="" aria-hidden="true">`
      : '';
    const playbackControls = this.options.showPlaybackControls !== false
      ? `<button class="game-control-btn" id="playPauseBtn" title="Play/Pause Game">
          <span class="btn-icon">▶️</span>
          <span class="btn-text">Play</span>
        </button>
        <button class="game-control-btn" id="stopBtn" title="Stop Game">
          <span class="btn-icon">⏹️</span>
          <span class="btn-text">Stop</span>
        </button>`
      : '';
    const reloadButton = this.options.showPlaybackControls !== false && this.options.showReload
      ? `<button class="game-control-btn" id="reloadBtn" title="Rebuild and Reload Game">
          <span class="btn-icon">🔄</span>
          <span class="btn-text">Reload</span>
        </button>`
      : '';
    const volumeControls = this.options.showVolumeControls
      ? `<div class="volume-controls">
          <button class="mute-btn" id="muteBtn" title="Mute/Unmute Audio">🔊</button>
          <input type="range" id="volumeSlider" min="0" max="100" value="75" title="Volume Control">
        </div>`
      : '';
    const utilityControls = (this.options.showKeyBindings || this.options.showConsole)
      ? `<div class="utility-controls">
          ${this.options.showKeyBindings ? '<button class="utility-btn" id="keyBindingsBtn" title="Show Keyboard Mapping">🎮</button>' : ''}
          ${this.options.showConsole ? '<button class="utility-btn console-btn" id="consoleToggleBtn" title="Toggle Debug Console"></button>' : ''}
        </div>`
      : '';
    const consolePanel = this.options.showConsole
      ? `<div class="console-slide-panel" id="consoleSlidePanel">
          <!-- GameConsole will be rendered here -->
        </div>`
      : '';
    const keyBindingsPopup = this.options.showKeyBindings
      ? `<div class="key-bindings-popup" id="keyBindingsPopup" style="display: none;">
          <div class="key-bindings-container">
            <div class="key-bindings-header">
              <h4>🎮 Keyboard Mapping</h4>
              <button class="close-popup-btn" id="closeKeyBindingsBtn">✕</button>
            </div>
            <div class="key-bindings-body">
              <div class="key-mapping-grid">
                <div class="key-mapping-section">
                  <h5>D-Pad</h5>
                  <div class="key-mapping-item">
                    <span class="key">↑</span><span class="button">Up</span>
                  </div>
                  <div class="key-mapping-item">
                    <span class="key">↓</span><span class="button">Down</span>
                  </div>
                  <div class="key-mapping-item">
                    <span class="key">←</span><span class="button">Left</span>
                  </div>
                  <div class="key-mapping-item">
                    <span class="key">→</span><span class="button">Right</span>
                  </div>
                </div>
                <div class="key-mapping-section">
                  <h5>Action Buttons</h5>
                  <div class="key-mapping-item">
                    <span class="key">Z</span><span class="button">B Button</span>
                  </div>
                  <div class="key-mapping-item">
                    <span class="key">X</span><span class="button">A Button</span>
                  </div>
                  <div class="key-mapping-item">
                    <span class="key">A</span><span class="button">Y Button</span>
                  </div>
                  <div class="key-mapping-item">
                    <span class="key">S</span><span class="button">X Button</span>
                  </div>
                </div>
                <div class="key-mapping-section">
                  <h5>System</h5>
                  <div class="key-mapping-item">
                    <span class="key">Space</span><span class="button">Select</span>
                  </div>
                  <div class="key-mapping-item">
                    <span class="key">Enter</span><span class="button">Start</span>
                  </div>
                  <div class="key-mapping-item">
                    <span class="key">L-Shift</span><span class="button">L Shoulder</span>
                  </div>
                  <div class="key-mapping-item">
                    <span class="key">R-Shift</span><span class="button">R Shoulder</span>
                  </div>
                </div>
              </div>
              <div class="input-status">
                <strong>Click the canvas above to activate input capture</strong>
              </div>
            </div>
          </div>
        </div>`
      : '';

    const controls = `${playbackControls}${reloadButton}${volumeControls}${utilityControls}`;

    this.contentContainer.innerHTML = `
      ${controls ? `<div class="game-controls">${controls}</div>` : ''}
      
      <div class="game-main-area">
        <div class="game-canvas-container">
          <div class="game-screen-frame">
            <canvas id="game-canvas" width="448" height="368"></canvas>
            ${overlay}
            <div class="simulator-compile-overlay hidden" aria-live="polite">
              <div class="simulator-compile-spinner" aria-hidden="true"></div>
              <div>Compiling simulator...</div>
            </div>
          </div>
          <div class="game-info">Game running... (simulated)</div>
        </div>
        
        ${consolePanel}
      </div>
      
      ${keyBindingsPopup}
    `;

    const gameScreenFrame = this.contentContainer.querySelector('.game-screen-frame');
    if (gameScreenFrame) {
      gameScreenFrame.addEventListener('mousedown', () => {
        this.focusGameCanvas();
      });
    }

    // Initialize empty console - only Lua print() should write to it
  this.setVolume(this.currentVolume);
  this.updateMuteButton();
    
    // Setup event listeners
    this.setupGameEngineEvents();
  }

  /**
   * Initialize the game input manager
   */
  async initializeInputManager() {
    try {
      // Load the input manager script if not already loaded
      if (!window.GameInputManager) {
        await this.loadInputManagerScript();
      }
      
      // Get the game canvas
      const gameCanvas = document.getElementById('game-canvas');
      if (!gameCanvas) {
        console.error('[GameEmulator] Game canvas not found - cannot initialize input manager');
        return;
      }
      
      // Create and initialize input manager
      this.inputManager = new window.GameInputManager();
      const success = this.inputManager.initialize(gameCanvas);
      
      if (success) {
        console.log('[GameEmulator] Input manager initialized successfully');
        
        // Focus the canvas to activate input capture
        if (this.options.autoFocusCanvas !== false) {
          this.focusGameCanvas({ delay: 100 });
        }
      } else {
        console.error('[GameEmulator] Failed to initialize input manager');
        this.inputManager = null;
      }
      
    } catch (error) {
      console.error('[GameEmulator] Error initializing input manager:', error);
      this.inputManager = null;
    }
  }

  focusGameCanvas(options = {}) {
    const delay = Number.isFinite(options?.delay) ? options.delay : 0;
    const focusCanvas = () => {
      const gameCanvas = this.contentContainer?.querySelector('#game-canvas');
      if (!gameCanvas || typeof gameCanvas.focus !== 'function') {
        return;
      }

      gameCanvas.focus();
    };

    if (delay > 0) {
      setTimeout(focusCanvas, delay);
      return;
    }

    focusCanvas();
  }
  
  /**
   * Load the input manager script
   */
  async loadInputManagerScript() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'scripts/input/game-input-manager.js?v=2';
      script.type = 'module';
      script.onload = () => {
        console.log('[GameEmulator] Input manager script loaded successfully');
        resolve();
      };
      script.onerror = (error) => {
        console.error('[GameEmulator] Failed to load input manager script:', error);
        reject(new Error('Failed to load input manager script'));
      };
      document.head.appendChild(script);
    });
  }

  setupGameEngineEvents() {
    // Key bindings popup handling
    const keyBindingsBtn = this.contentContainer.querySelector('#keyBindingsBtn');
    const keyBindingsPopup = this.contentContainer.querySelector('#keyBindingsPopup');
    const closeKeyBindingsBtn = this.contentContainer.querySelector('#closeKeyBindingsBtn');

    if (keyBindingsBtn) {
      keyBindingsBtn.addEventListener('click', () => {
        keyBindingsPopup.style.display = 'flex';
      });
    }

    if (closeKeyBindingsBtn) {
      closeKeyBindingsBtn.addEventListener('click', () => {
        keyBindingsPopup.style.display = 'none';
      });
    }

    // Make key bindings popup draggable
    if (keyBindingsPopup) {
      this.makeElementDraggable(keyBindingsPopup, keyBindingsPopup.querySelector('.key-bindings-header'));
    }

    // Console slide panel handling
    const consoleToggleBtn = this.contentContainer.querySelector('#consoleToggleBtn');
    const consoleSlidePanel = this.contentContainer.querySelector('#consoleSlidePanel');
    const consoleClearBtn = this.contentContainer.querySelector('.console-clear-btn');

    if (consoleToggleBtn) {
      consoleToggleBtn.addEventListener('click', () => {
        const isOpen = consoleSlidePanel.classList.contains('open');
        if (isOpen) {
          this.hideConsole();
        } else {
          this.showConsole();
        }
      });
    }

    // Console clear functionality
    if (consoleClearBtn) {
      consoleClearBtn.addEventListener('click', () => {
        this.clearConsole();
      });
    }

    // Game control buttons
    const playPauseBtn = this.contentContainer.querySelector('#playPauseBtn');
    const stopBtn = this.contentContainer.querySelector('#stopBtn');
    const reloadBtn = this.contentContainer.querySelector('#reloadBtn');

    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', () => {
        this.togglePlayPause();
        this.focusGameCanvas();
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        this.stopGame();
        this.focusGameCanvas();
      });
    }

    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        this.reloadGame();
        this.focusGameCanvas();
      });
    }

    // Volume controls
    const muteBtn = this.contentContainer.querySelector('#muteBtn');
    const volumeSlider = this.contentContainer.querySelector('#volumeSlider');

    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        this.toggleMute();
      });
    }

    if (volumeSlider) {
      volumeSlider.addEventListener('input', (e) => {
        const volume = parseInt(e.target.value);
        this.setVolume(volume);
      });
    }
  }
  
  // Make an element draggable by its header
  makeElementDraggable(element, dragHandle) {
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };
    
    dragHandle.style.cursor = 'move';
    
    dragHandle.addEventListener('mousedown', (e) => {
      isDragging = true;
      const rect = element.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;
      
      // Prevent text selection while dragging
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const x = e.clientX - dragOffset.x;
      const y = e.clientY - dragOffset.y;
      
      // Keep within viewport bounds
      const maxX = window.innerWidth - element.offsetWidth;
      const maxY = window.innerHeight - element.offsetHeight;
      
      const clampedX = Math.max(0, Math.min(x, maxX));
      const clampedY = Math.max(0, Math.min(y, maxY));
      
      element.style.left = clampedX + 'px';
      element.style.top = clampedY + 'px';
      element.style.right = 'auto'; // Remove right positioning when dragging
    });
    
    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ========================================
  // CONSOLE SYSTEM 
  // Only Lua print() should write to console
  // ========================================

  // Clear console - direct call to GameConsole
  clearConsole() {
    // Clear Lua print buffer if Lua state exists
    if (this.luaState) {
      try {
        this.luaState.execute('_print_buffer = {}');
      } catch (error) {
        console.warn('[GameEmulator] Error clearing Lua print buffer:', error.message);
      }
    }
    
    // Clear the GameConsole display
    this.gameConsole.clearConsole();
  }

  // Cleanup method for when the component is destroyed
  cleanup() {
    // Cleanup GameConsole
    this.gameConsole.cleanup();
    this.gameConsole = null;
    this.consoleInitialized = false;
  }

  // Open the console panel programmatically
  showConsole() {
    const consoleSlidePanel = this.contentContainer.querySelector('#consoleSlidePanel');
    if (consoleSlidePanel && !consoleSlidePanel.classList.contains('open')) {
      consoleSlidePanel.classList.add('open');
      if (window.panelResizer) {
        window.panelResizer.requestResize('gameEngine', { adjustForSlidePanel: true });
      }
    }
  }

  // Close the console panel programmatically
  hideConsole() {
    const consoleSlidePanel = this.contentContainer.querySelector('#consoleSlidePanel');
    if (consoleSlidePanel && consoleSlidePanel.classList.contains('open')) {
      consoleSlidePanel.classList.remove('open');
      if (window.panelResizer) {
        window.panelResizer.requestResize('gameEngine', { adjustForSlidePanel: false });
      }
    }
  }
}

// Initialize when page loads
// GameEmulator class is instantiated by application.js
// No fallback instantiation needed
