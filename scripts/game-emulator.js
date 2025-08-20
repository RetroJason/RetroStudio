// game-emulator.js
// Main game engine emulator that integrates audio engine and project explorer

class GameEmulator {
  constructor() {
    this.audioEngine = null;
    this.resourceManager = null;
    this.projectExplorer = null;
    this.buildSystem = null;
    this.loadedAudioResources = new Map(); // Maps file paths to resource IDs
    this._inflightLoads = new Map(); // filename -> Promise
    
    // Set up project paths configuration
    this.setupProjectPaths();
    this.resourceMap = new Map(); // Centralized resource mapping: resourceId -> resource object
    this.printOutput = []; // Store Lua print output
    this.luaState = null; // Lua execution state
    this.isRunning = false; // Game loop state
    this.frameCount = 0;
    this.lastFrameTime = 0;
    this.extensionLoader = null; // Lua extension loader

    this.initialize();
  }

  // Set up project paths configuration to use correct folder names
  setupProjectPaths() {
    if (!window.ProjectPaths) {
      window.ProjectPaths = {
        getSourcesRootUi: () => 'Sources',
        getBuildRootUi: () => 'Game Objects',
        normalizeStoragePath: (path) => path,
        isBuildArtifact: (path) => path && path.includes('Game Objects/')
      };
      console.log('[GameEmulator] ProjectPaths configured: Sources -> "Sources", Build -> "Game Objects"');
    }
  }

  async initialize() {
    console.log('=== Game Engine Emulator ===');
    
    // Prefer singletons from the service container to avoid duplicate instances
    const services = window.serviceContainer;

    // Initialize or obtain AudioEngine
    if (services) {
      try {
        this.audioEngine = services.get('audioEngine');
      } catch (_) { /* not registered yet */ }
    }
    if (!this.audioEngine) {
      this.audioEngine = new AudioEngine();
      const audioSuccess = await this.audioEngine.initialize();
      if (!audioSuccess) {
        console.error('[GameEmulator] Failed to initialize audio engine');
        return false;
      }
      services?.register?.('audioEngine', this.audioEngine);
    }

    // Initialize or obtain ResourceManager
    if (services) {
      try {
        this.resourceManager = services.get('resourceManager');
      } catch (_) { /* not registered yet */ }
    }
    if (!this.resourceManager) {
      this.resourceManager = new ResourceManager(this.audioEngine);
      services?.register?.('resourceManager', this.resourceManager);
    }

    // Initialize or obtain BuildSystem
    if (services) {
      try {
        this.buildSystem = services.get('buildSystem');
        if (this.buildSystem) {
          window.buildSystem = this.buildSystem; // Make available globally for builders
        }
      } catch (e) {
        console.log('[GameEditor] BuildSystem service not yet available');
        this.buildSystem = null;
      }
    } else {
      console.log('[GameEditor] Service container not available, BuildSystem will be initialized later');
      this.buildSystem = null;
    }
    
    // Listen for audio engine events
    this.audioEngine.addEventListener('resourceLoaded', this.onResourceLoaded.bind(this));
    this.audioEngine.addEventListener('resourceUpdated', this.onResourceUpdated.bind(this));
    
    // Initialize or obtain TabManager
    if (services) {
      try {
        this.tabManager = services.get('tabManager');
      } catch (_) { /* not registered yet */ }
    }
    if (!this.tabManager) {
      this.tabManager = new TabManager();
      services?.registerSingleton?.('tabManager', this.tabManager);
    }
    window.tabManager = this.tabManager; // Make available globally
    
    // Listen for tab changes to update save button state and project explorer
    this.tabManager.addEventListener('tabSwitched', (data) => {
      this.updateSaveButtonState();
      // Project explorer highlighting is handled automatically in TabManager
    });
    
    // Initialize or obtain ProjectExplorer
    if (services) {
      try {
        this.projectExplorer = services.get('projectExplorer');
      } catch (_) { /* not registered yet */ }
    }
    if (!this.projectExplorer) {
      this.projectExplorer = new ProjectExplorer();
      services?.register?.('projectExplorer', this.projectExplorer);
    }
    
    // Listen for file added events from ProjectExplorer
    document.addEventListener('projectFileAdded', this.handleFileAddedEvent.bind(this));
    
    // Set up UI event handlers
    this.setupUI();
    
    // Add audio context resume handler
    this.addAudioContextResumeHandler();
    
    // Update initial UI state
    this.updateSaveButtonState();
    
    console.log('[GameEmulator] Initialized successfully');
    return true;
  }
  
  // Initialize BuildSystem if it wasn't available during initial setup
  initializeBuildSystemIfNeeded() {
    if (!this.buildSystem) {
      const services = window.serviceContainer;
      if (services) {
        try {
          console.log('[GameEditor] Late-initializing BuildSystem from service container');
          this.buildSystem = services.get('buildSystem');
          if (this.buildSystem) {
            window.buildSystem = this.buildSystem;
            return true;
          }
        } catch (e) {
          console.log('[GameEditor] BuildSystem service not yet available');
        }
      }
    }
    return !!this.buildSystem;
  }
  
  setupUI() {
    // The ribbon toolbar handles its own button setup
    // TODO: Add proper keyboard shortcuts later without interfering with Monaco Editor
    console.log('[GameEmulator] UI setup complete - keyboard shortcuts disabled for now');
  }
  
  addAudioContextResumeHandler() {
    const resumeHandler = async () => {
      if (this.audioEngine.audioContext.state === 'suspended') {
        console.log('[GameEditor] User interaction detected, resuming AudioContext...');
        try {
          await this.audioEngine.audioContext.resume();
          console.log('[GameEditor] AudioContext resumed, state:', this.audioEngine.audioContext.state);
        } catch (error) {
          console.warn('[GameEditor] Failed to resume AudioContext:', error);
        }
      }
      // Remove handler after first use
      document.removeEventListener('click', resumeHandler);
      document.removeEventListener('keydown', resumeHandler);
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
  }
  
  async playProject() {
    console.log('[GameEmulator] Play project');
    this.updateStatus('Preparing to run project...', 'info');
    
    try {
      // First, build the project to get all scripts
      console.log('[GameEmulator] Building project...');
      await this.buildProject();
      
      // Concatenate and load the scripts
      console.log('[GameEmulator] Concatenating Lua scripts...');
      const concatenatedScript = await this.concatenateLuaScripts();
      
      if (!concatenatedScript) {
        this.updateStatus('No Lua scripts found in project', 'warning');
        await this.showErrorPopup(
          'No Lua Scripts Found',
          'Your project must contain at least one Lua script to run.',
          'Please create a Lua script file in your project and add a Setup() function to get started.'
        );
        return;
      }
      
      console.log(`[GameEmulator] Concatenated ${concatenatedScript.fileCount} Lua files`);
      
      // Load and execute the concatenated script
      await this.loadAndExecuteScript(concatenatedScript);
      
    } catch (error) {
      console.error('[GameEmulator] Error running project:', error);
      console.error('[GameEmulator] Error stack:', error.stack);
      this.updateStatus(`Error running project: ${error.message}`, 'error');
      
      await this.showErrorPopup(
        'Project Run Error',
        'An error occurred while trying to run your project.',
        `Error Details:\n${error.message}\n\nStack Trace:\n${error.stack || 'No stack trace available'}\n\nPlease check your project files and try again.`
      );
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
          return;
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
        return;
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
    } catch (error) {
      console.error('[GameEditor] Build failed:', error);
      this.updateStatus(`Build failed: ${error.message}`, 'error');
    }
  }
  
  getAllBuildFiles() {
    // Get all files from the Build folder in project explorer
    const buildFiles = [];
    
  const project = this.projectExplorer?.getFocusedProjectName?.();
  const buildRoot = (window.ProjectPaths && window.ProjectPaths.getBuildRootUi) ? window.ProjectPaths.getBuildRootUi() : 'Build';
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
      
      // Get all build files
      console.log('[GameEmulator] DEBUG: Getting all build files...');
      const buildFiles = this.getAllBuildFiles();
      console.log(`[GameEmulator] DEBUG: Found ${buildFiles.length} total build files:`, buildFiles);
      
      // Process all build files and create resource mappings based on folder structure
      for (const file of buildFiles) {
        const resourceMapping = this.createResourceMapping(file);
        if (resourceMapping) {
          this.resourceMap.set(resourceMapping.id, resourceMapping);
          console.log(`[GameEmulator] DEBUG: Mapped resource: ${resourceMapping.id} -> ${file.path}`);
        }
      }
      
      console.log(`[GameEmulator] DEBUG: Final resource map size: ${this.resourceMap.size}`);
      console.log(`[GameEmulator] DEBUG: All resource IDs:`, Array.from(this.resourceMap.keys()));
      
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

    // Extract folder structure from path
    // Expected formats: "test/Game Objects/SFX/sound.wav" or "build/SFX/sound.wav"
    let folderMatch = null;
    
    // Try "Game Objects/FolderName/" pattern first
    const gameObjectsMatch = file.path.match(/Game Objects\/([^\/]+)\//);
    if (gameObjectsMatch) {
      folderMatch = gameObjectsMatch[1].toUpperCase();
    } else {
      // Fallback to "build/FolderName/" pattern
      const buildMatch = file.path.match(/build\/([^\/]+)\//);
      if (buildMatch) {
        folderMatch = buildMatch[1].toUpperCase();
      }
    }

    if (!folderMatch) {
      console.log(`[GameEmulator] DEBUG: Skipping file with no recognized folder structure: ${file.path}`);
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
      console.log(`[GameEmulator] DEBUG: Skipping unsupported file type .${fileExtension} in ${folderMatch} folder: ${file.path}`);
      return null;
    }

    console.log(`[GameEmulator] DEBUG: Creating ${folderMatch} resource: ${resourceId} (.${fileExtension})`);

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
          const loadPromise = this.loadAudioFileOnDemand(resource.name)
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
  }

  /**
   * Create Lua constants for all resource types
   */
  async createAllLuaConstants() {
    console.log('[GameEmulator] DEBUG: Creating Lua constants for all resource types...');
    
    if (!this.luaState) {
      console.error('[GameEmulator] DEBUG: Lua state not available - skipping constant creation');
      return;
    }
    
    console.log('[GameEmulator] DEBUG: Lua state is available, proceeding with constant creation');
    
    try {
      // Create SFX constants
      console.log('[GameEmulator] DEBUG: Getting SFX resource constants...');
      const sfxConstants = this.GetResourceConstants('SFX');
      console.log(`[GameEmulator] DEBUG: Got ${Object.keys(sfxConstants).length} SFX constants:`, sfxConstants);
      
      if (Object.keys(sfxConstants).length > 0) {
        let luaCode = 'SFX = SFX or {}\n';
        
        for (const [constantName, resourceId] of Object.entries(sfxConstants)) {
          luaCode += `SFX.${constantName} = "${resourceId}"\n`;
          console.log(`[GameEmulator] DEBUG: Adding constant: SFX.${constantName} = "${resourceId}"`);
        }
        
        console.log(`[GameEmulator] DEBUG: About to execute Lua code:\n${luaCode}`);
        this.luaState.execute(luaCode);
        console.log(`[GameEmulator] DEBUG: Successfully executed Lua constants creation`);
        
        // Verify the constants were created
        try {
          const verifyCode = 'return type(SFX), SFX';
          const result = this.luaState.execute(verifyCode);
          console.log(`[GameEmulator] DEBUG: Verification - SFX type and value:`, result);
        } catch (verifyError) {
          console.error('[GameEmulator] DEBUG: Failed to verify SFX constants:', verifyError);
        }
        
        console.log(`[GameEmulator] Created ${Object.keys(sfxConstants).length} SFX constants in Lua`);
        console.log('[GameEmulator] SFX constants:', Object.keys(sfxConstants));
      } else {
        console.warn('[GameEmulator] DEBUG: No SFX constants to create');
      }
      
      // TODO: Add other resource type constants here (Graphics, Music, etc.)
      
    } catch (error) {
      console.error('[GameEmulator] DEBUG: Failed to create Lua constants:', error);
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
      console.log('[GameEmulator] Available resources:', Array.from(this.resourceMap.keys()));
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
    console.log(`[GameEmulator] DEBUG: GetResourceConstants called with type: ${type}`);
    console.log(`[GameEmulator] DEBUG: Current resourceMap size: ${this.resourceMap.size}`);
    console.log(`[GameEmulator] DEBUG: All resources in map:`, Array.from(this.resourceMap.entries()));
    
    const constants = {};
    for (const [resourceId, resource] of this.resourceMap) {
      console.log(`[GameEmulator] DEBUG: Processing resource: ${resourceId}, type: ${resource.type}`);
      if (!type || resource.type === type) {
        // Extract constant name from resource ID (e.g., "SFX.COOL" -> "COOL")
        const parts = resourceId.split('.');
        if (parts.length === 2) {
          const constantName = parts[1];
          constants[constantName] = resourceId;
          console.log(`[GameEmulator] DEBUG: Added constant: ${constantName} = ${resourceId}`);
        } else {
          console.warn(`[GameEmulator] DEBUG: Invalid resource ID format: ${resourceId}`);
        }
      }
    }
    
    console.log(`[GameEmulator] DEBUG: Final constants object:`, constants);
    return constants;
  }
  
  findMainLuaScript() {
    // Look for main.lua in the Lua directory
  const project = this.projectExplorer?.getFocusedProjectName?.();
  const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
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
  
  runLuaScript(scriptSource) {
    let content = '';
    let scriptName = '';
    
    if (scriptSource.getContent) {
      // It's an editor
      content = scriptSource.getContent();
      scriptName = scriptSource.file.name;
    } else if (scriptSource.file) {
      // It's a file data object
      scriptName = scriptSource.file.name;
      // Read file content
      const reader = new FileReader();
      reader.onload = (e) => {
        content = e.target.result;
        this.executeScript(content, scriptName);
      };
      reader.readAsText(scriptSource.file);
      return;
    }
    
    this.executeScript(content, scriptName);
  }
  
  executeScript(content, scriptName) {
    if (!content.trim()) {
      this.updateStatus('Script is empty!', 'warning');
      this.showErrorPopup(
        'Empty Script',
        'The script you are trying to execute is empty.',
        `Script: ${scriptName}\n\nPlease add some content to your script and try again.`
      );
      return;
    }
    
    console.log(`[GameEditor] Running Lua script: ${scriptName}`);
    console.log(content);
    
    // Create a simple output window for now
    const outputWindow = window.open('', '_blank', 'width=800,height=600,scrollbars=yes,resizable=yes');
    outputWindow.document.write(`
      <html>
        <head>
          <title>Game Project - ${scriptName}</title>
          <style>
            body { 
              font-family: 'Consolas', 'Courier New', monospace; 
              background: #1e1e1e; 
              color: #cccccc; 
              padding: 20px; 
              margin: 0;
            }
            .header { 
              color: #0078d4; 
              margin-bottom: 15px; 
              font-size: 18px;
              border-bottom: 1px solid #3c3c3c;
              padding-bottom: 10px;
            }
            .code { 
              background: #2d2d30; 
              padding: 20px; 
              border-radius: 6px; 
              white-space: pre-wrap; 
              border: 1px solid #3c3c3c;
              line-height: 1.5;
            }
            .note {
              margin-top: 15px;
              color: #ffb74d;
              font-style: italic;
            }
          </style>
        </head>
        <body>
          <div class="header">🚀 Running: ${scriptName}</div>
          <div class="code">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
          <div class="note">Note: Actual Lua execution will be implemented in future updates</div>
        </body>
      </html>
    `);
    
    this.updateStatus(`Running ${scriptName}`, 'success');
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
  
  getLoadedResourceId(filename) {
    for (const [path, id] of this.loadedAudioResources) {
      if (path.endsWith(filename)) {
        return id;
      }
    }
    return null;
  }

  // Load an audio file on demand (called by viewers)
  async loadAudioFileOnDemand(filename, forceReload = false) {
    console.log(`[GameEditor] Loading audio file on demand: ${filename}${forceReload ? ' (force reload)' : ''}`);
    
    // Check if already loaded, unless forcing reload
    if (!forceReload) {
      const existingId = this.getLoadedResourceId(filename);
      if (existingId) {
        console.log(`[GameEditor] File ${filename} already loaded with ID: ${existingId}`);
        return existingId;
      }
    } else {
      // Force reload: clear existing resource first
      const existingId = this.getLoadedResourceId(filename);
      if (existingId) {
        console.log(`[GameEditor] Force reload: clearing existing resource ${existingId} for ${filename}`);
        if (this.audioEngine) {
          this.audioEngine.unloadResource(existingId);
        }
      }
    }
    
    // Dedupe concurrent requests for the same filename
    if (!forceReload && this._inflightLoads.has(filename)) {
      console.log('[GameEditor] Returning in-flight load for', filename);
      return this._inflightLoads.get(filename);
    }

    const loadPromise = (async () => {
      // First try to find in pending files (regular project files)
    if (this.pendingAudioFiles) {
      for (const [fileKey, fileData] of this.pendingAudioFiles.entries()) {
        if (fileKey.endsWith(filename)) {
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
      if (window.fileIOService && typeof window.fileIOService.listFiles === 'function') {
        console.log(`[GameEditor] Listing build files for ${filename}...`);
        const buildRecords = await window.fileIOService.listFiles('build');
        console.log(`[GameEditor] Found ${buildRecords.length} build records:`, buildRecords);
        for (const rec of buildRecords) {
          const recPath = rec.path || rec;
          if ((recPath || '').endsWith(filename)) {
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
            const rec = window.fileIOService ? await window.fileIOService.loadFile(path) : null;
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
          const file = new File([buf], filename, { type: 'audio/wav' });
          console.log(`[GameEditor] Created File object:`, { name: file.name, size: file.size, type: file.type });
          const resourceId = await this.resourceManager.loadFromFile(file, 'wav');
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
      if (window.fileIOService && typeof window.fileIOService.listFiles === 'function') {
    const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
    const resRecords = await window.fileIOService.listFiles(sourcesRoot);
        for (const rec of resRecords) {
          const recPath = rec.path || rec;
          if ((recPath || '').endsWith(filename)) {
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
              const rec = await window.fileIOService.loadFile(path);
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
    this._inflightLoads.set(filename, loadPromise);
    try {
      const id = await loadPromise;
      return id;
    } finally {
      // Remove only if this exact promise is still the one stored
      if (this._inflightLoads.get(filename) === loadPromise) {
        this._inflightLoads.delete(filename);
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
    
    if (!this.projectExplorer) {
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
    const fileIOService = window.serviceContainer?.get?.('fileIOService');
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
      const fileManager = window.serviceContainer?.get?.('fileManager') || window.fileManager;
      if (!fileManager) {
        console.error('[GameEditor] File manager not available');
        return null;
      }
      
      const normalizedPath = window.ProjectPaths?.normalizeStoragePath?.(filePath) || filePath;
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
  
  async loadAndExecuteScript(scriptData) {
    console.log('[GameEmulator] Loading and executing Lua script...');
    this.updateStatus('Loading Lua script...', 'info');
    
    try {
      // Load Lua engine if not already loaded
      if (!window.Lua) {
        await this.loadLuaEngine();
      }
      
      // Create a new Lua state
      const L = new window.Lua.State();
      this.luaState = L;
      
      // Initialize print output capture
      this.printOutput = [];
      
      // Simple approach: Override print function in Lua to accumulate output
      // We'll capture it differently by checking Lua's output after each execution
      L.execute(`
        -- Create a global output buffer
        _print_buffer = {}
        
        -- Override print to capture output in buffer
        local original_print = print
        function print(...)
          local args = {...}
          local parts = {}
          for i = 1, select('#', ...) do
            local v = select(i, ...)
            table.insert(parts, tostring(v))
          end
          local output = table.concat(parts, "\\t")
          
          -- Add to buffer
          table.insert(_print_buffer, output)
          
          -- Also call original print for console output
          original_print(...)
        end
      `);
      
      // Initialize centralized resource mappings
      console.log('[GameEmulator] DEBUG: About to initialize resource mappings...');
      await this.initializeResourceMappings();
      console.log('[GameEmulator] DEBUG: Resource mappings initialization completed');
      
      // Load and initialize Lua extensions
      console.log('[GameEmulator] Loading Lua extensions...');
      try {
        await this.loadLuaExtensions(L);
        console.log('[GameEmulator] Lua extensions loaded successfully');
      } catch (error) {
        console.warn('[GameEmulator] Failed to load Lua extensions:', error);
        // Continue anyway - extensions are optional
      }
      
      console.log('[GameEmulator] Concatenated Lua script:');
      console.log(scriptData.content);
      
      // Load the concatenated script into Lua
      console.log('[GameEmulator] Loading script into Lua engine...');
      try {
        L.execute(scriptData.content);
        console.log('[GameEmulator] Script loaded successfully');
        
        // Check what functions are defined in the global scope
        try {
          L.execute(`
            print("=== Checking defined functions ===")
            print("Setup function type: " .. type(Setup))
            print("Update function type: " .. type(Update))
            if System then
              print("System table exists with LogLua function: " .. type(System.LogLua))
            else
              print("System table not defined")
            end
            print("=== End function check ===")
          `);
          this.captureLuaPrintOutput();
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
      } catch (error) {
        console.log('[GameEmulator] Setup() function issue:', error.message);
        if (error.message.includes('Setup function is not defined')) {
          console.log('[GameEmulator] Setup() function not found - this is optional, continuing...');
        } else {
          console.error('[GameEmulator] Setup() function failed during execution:', error);
          this.updateStatus(`Setup() error: ${error.message}`, 'warning');
        }
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
      
      // Start the game loop
      console.log('[GameEmulator] About to start game loop...');
      this.startGameLoop();
      console.log('[GameEmulator] Game loop start command issued');
      
      // Show game engine
      this.showGameEngine(scriptData);
      
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
  
  startGameLoop() {
    console.log('[GameEmulator] Starting game loop...');
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.frameCount = 0;
    
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
        // Call Update(deltaTime) in Lua
        this.luaState.execute(`Update(${deltaTime})`);
        
        // Check for new print output from Lua
        this.captureLuaPrintOutput();
        
        // Log every 60 frames (once per second at 60fps)
        if (this.frameCount % 60 === 0) {
          console.log(`[GameEmulator] Game loop running - Frame ${this.frameCount}, Delta: ${deltaTime.toFixed(2)}ms`);
        }
      } catch (error) {
        console.error('[GameEmulator] Error in Update() function:', error);
        this.stopGameLoop();
        this.updateStatus(`Update() error: ${error.message}`, 'error');
        
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
    this.updateStatus('Game loop stopped', 'info');
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
  
  async loadExtensionLoader() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'scripts/lua/extension-loader.js';
      script.onload = () => {
        console.log('[GameEmulator] Extension loader loaded successfully');
        resolve();
      };
      script.onerror = (error) => {
        console.error('[GameEmulator] Failed to load extension loader:', error);
        reject(new Error('Failed to load extension loader'));
      };
      document.head.appendChild(script);
    });
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
    try {
      // Get the print buffer from Lua
      const bufferSize = this.luaState.execute('return #_print_buffer');
      if (bufferSize > 0) {
        // Extract all items from the buffer
        for (let i = 1; i <= bufferSize; i++) {
          const output = this.luaState.execute(`return _print_buffer[${i}]`);
          this.printOutput.push(output);
        }
        
        // Clear the buffer
        this.luaState.execute('_print_buffer = {}');
        
        // Update the game engine output display
        this.updateGameEngineOutput();
      }
    } catch (error) {
      // Silently ignore errors in print capture to avoid disrupting the game loop
      console.warn('[GameEmulator] Error capturing print output:', error.message);
    }
  }

  updateGameEngineOutput() {
    // Update the output console in the game engine panel
    const outputContent = document.querySelector('.console-content');
    if (outputContent && this.printOutput) {
      // Show last 100 lines to prevent memory issues
      const recentOutput = this.printOutput.slice(-100);
      outputContent.textContent = recentOutput.join('\n');
      // Auto-scroll to bottom
      outputContent.scrollTop = outputContent.scrollHeight;
    }
  }

  showGameEngine(scriptData) {
    // Create sliding game engine panel
    this.createGameEnginePanel(scriptData);
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
    
    // Add styles if not already added
    this.addErrorPopupStyles();
    
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
  
  addErrorPopupStyles() {
    // Only add styles if they don't exist
    if (document.querySelector('#error-popup-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'error-popup-styles';
    style.textContent = `
      .error-popup-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        z-index: 20000;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s ease;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }
      
      .error-popup-overlay.visible {
        opacity: 1;
      }
      
      .error-popup {
        background: #2d2d30;
        border: 2px solid #dc3545;
        border-radius: 8px;
        min-width: 400px;
        max-width: 600px;
        max-height: 80vh;
        overflow: hidden;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
        transform: scale(0.9);
        transition: transform 0.2s ease;
      }
      
      .error-popup-overlay.visible .error-popup {
        transform: scale(1);
      }
      
      .error-popup-header {
        background: #dc3545;
        color: white;
        padding: 15px 20px;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      
      .error-icon {
        font-size: 24px;
      }
      
      .error-popup-header h3 {
        margin: 0;
        flex: 1;
        font-size: 18px;
        font-weight: 600;
      }
      
      .error-popup-close {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }
      
      .error-popup-close:hover {
        background: rgba(255, 255, 255, 0.3);
      }
      
      .error-popup-content {
        padding: 20px;
        color: #cccccc;
        max-height: 400px;
        overflow-y: auto;
      }
      
      .error-message {
        font-size: 16px;
        line-height: 1.5;
        margin-bottom: 15px;
      }
      
      .error-details-section {
        border-top: 1px solid #3c3c3c;
        padding-top: 15px;
      }
      
      .error-details-toggle {
        background: #6c757d;
        border: none;
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        transition: background 0.2s;
        margin-bottom: 10px;
      }
      
      .error-details-toggle:hover {
        background: #5a6268;
      }
      
      .error-details {
        background: #1e1e1e;
        border: 1px solid #3c3c3c;
        border-radius: 4px;
        padding: 15px;
        margin-top: 10px;
      }
      
      .error-details pre {
        margin: 0;
        font-family: 'Consolas', 'Monaco', monospace;
        font-size: 14px;
        color: #f8f9fa;
        white-space: pre-wrap;
        word-break: break-word;
      }
      
      .error-popup-actions {
        background: #252526;
        padding: 15px 20px;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        border-top: 1px solid #3c3c3c;
      }
      
      .error-popup-btn {
        padding: 8px 20px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: background 0.2s;
      }
      
      .error-popup-btn.primary {
        background: #0078d4;
        color: white;
      }
      
      .error-popup-btn.primary:hover {
        background: #106ebe;
      }
      
      .error-popup-btn.secondary {
        background: #6c757d;
        color: white;
      }
      
      .error-popup-btn.secondary:hover {
        background: #5a6268;
      }
    `;
    
    document.head.appendChild(style);
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
  
  createGameEnginePanel(scriptData) {
    // Remove any existing game engine elements
    const existingPanel = document.querySelector('.game-engine-panel');
    const existingResizer = document.querySelector('.game-engine-resizer');
    if (existingPanel) existingPanel.remove();
    if (existingResizer) existingResizer.remove();
    
    // Get the content wrapper where we'll add the game engine
    const contentWrapper = document.querySelector('.content-wrapper');
    if (!contentWrapper) {
      console.error('[GameEditor] Content wrapper not found');
      return;
    }
    
    // Extract data from scriptData or use defaults
    const currentOutput = this.printOutput ? this.printOutput.join('\n') : 'No output yet...';
    const output = scriptData?.output || currentOutput;
    const script = scriptData?.script || this.currentScript || 'No script loaded';
    
    // Create a new resizer for the game engine
    const gameEngineResizer = document.createElement('div');
    gameEngineResizer.className = 'game-engine-resizer';
    gameEngineResizer.innerHTML = `
      <div class="resizer-handle">
        <div class="resizer-line"></div>
        <div class="resizer-line"></div>
        <div class="resizer-line"></div>
      </div>
    `;
    
    // Create the game engine panel
    const gameEnginePanel = document.createElement('div');
    gameEnginePanel.className = 'game-engine-panel';
    gameEnginePanel.innerHTML = `
      <div class="game-engine-header">
        <h3>🎮 Game Engine</h3>
        <button class="close-engine-btn">×</button>
      </div>
      <div class="game-engine-tabs">
        <button class="tab-btn active" data-tab="game">Game</button>
        <button class="tab-btn" data-tab="output">Output</button>
        <button class="tab-btn" data-tab="script">Script</button>
      </div>
      <div class="game-engine-content">
        <div class="tab-content active" id="game-tab">
          <div class="game-canvas-container">
            <canvas id="game-canvas" width="800" height="600"></canvas>
            <div class="game-info">Game running... (simulated)</div>
          </div>
        </div>
        <div class="tab-content" id="output-tab">
          <div class="output-console">
            <div class="console-header">📝 Print Output</div>
            <div class="console-content">${this.escapeHtml(output)}</div>
          </div>
        </div>
        <div class="tab-content" id="script-tab">
          <div class="script-viewer">
            <div class="script-header">📜 Concatenated Script (${scriptData?.fileCount || 0} files)</div>
            <div class="script-content">${this.escapeHtml(scriptData?.content || 'No script content available')}</div>
          </div>
        </div>
      </div>
    `;
    
    // Append the resizer and panel to the content wrapper
    contentWrapper.appendChild(gameEngineResizer);
    contentWrapper.appendChild(gameEnginePanel);
    
    // Add styles
    this.addGameEngineStyles();
    
    // Modify the content wrapper layout to accommodate the game engine
    this.adjustLayoutForGameEngine(contentWrapper, gameEngineResizer, gameEnginePanel);
    
    // Setup resizer functionality  
    this.setupGameEngineResizer(gameEngineResizer, gameEnginePanel);
    
    // Slide in animation
    setTimeout(() => {
      gameEnginePanel.classList.add('visible');
      gameEngineResizer.classList.add('visible');
    }, 10);
    
    // Add event listeners
    this.setupGameEngineEvents(gameEnginePanel);
  }
  
  adjustLayoutForGameEngine(contentWrapper, resizer, panel) {
    // Add class to body for global layout adjustments
    document.body.classList.add('game-engine-active');
    
    // Adjust the content wrapper to use CSS Grid for proper layout
    contentWrapper.style.display = 'grid';
    contentWrapper.style.gridTemplateColumns = 'auto 4px 1fr 4px 0fr';
    contentWrapper.style.transition = 'grid-template-columns 0.3s ease-in-out';
    
    // Animate to show the game engine
    requestAnimationFrame(() => {
      contentWrapper.style.gridTemplateColumns = 'auto 4px 1fr 4px 400px';
    });
  }
  
  setupGameEngineResizer(resizer, panel) {
    const contentWrapper = resizer.parentElement;
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    
    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      
      const deltaX = startX - e.clientX; // Inverted because we're resizing from the right
      let newWidth = startWidth + deltaX;
      
      // Enforce constraints
      newWidth = Math.max(300, Math.min(800, newWidth));
      
      // Update grid template
      const existingColumns = contentWrapper.style.gridTemplateColumns.split(' ');
      existingColumns[4] = `${newWidth}px`;
      contentWrapper.style.gridTemplateColumns = existingColumns.join(' ');
      
      e.preventDefault();
    });
    
    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
    
    // Double-click to reset
    resizer.addEventListener('dblclick', () => {
      const existingColumns = contentWrapper.style.gridTemplateColumns.split(' ');
      existingColumns[4] = '400px';
      contentWrapper.style.gridTemplateColumns = existingColumns.join(' ');
    });
  }
  
  hideGameEngine() {
    const contentWrapper = document.querySelector('.content-wrapper');
    const gameEnginePanel = document.querySelector('.game-engine-panel');
    const gameEngineResizer = document.querySelector('.game-engine-resizer');
    
    if (contentWrapper && gameEnginePanel && gameEngineResizer) {
      // Animate out
      gameEnginePanel.classList.remove('visible');
      gameEngineResizer.classList.remove('visible');
      
      // Reset grid layout
      contentWrapper.style.gridTemplateColumns = 'auto 4px 1fr 4px 0fr';
      
      setTimeout(() => {
        // Remove elements
        gameEnginePanel.remove();
        gameEngineResizer.remove();
        
        // Reset layout
        document.body.classList.remove('game-engine-active');
        contentWrapper.style.display = '';
        contentWrapper.style.gridTemplateColumns = '';
        contentWrapper.style.transition = '';
      }, 300);
    }
  }
  
  addGameEngineStyles() {
    // Only add styles if they don't exist
    if (document.querySelector('#game-engine-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'game-engine-styles';
    style.textContent = `
      /* Game engine layout integration */
      body.game-engine-active .content-wrapper {
        display: grid !important;
        grid-template-columns: auto 4px 1fr 4px 0fr;
        transition: grid-template-columns 0.3s ease-in-out;
      }
      
      body.game-engine-active .content-wrapper.game-engine-visible {
        grid-template-columns: auto 4px 1fr 4px 400px;
      }
      
      .game-engine-resizer {
        background: #3c3c3c;
        cursor: col-resize;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        user-select: none;
        opacity: 0;
        transition: opacity 0.3s ease-in-out;
        grid-column: 4;
      }
      
      .game-engine-resizer.visible {
        opacity: 1;
      }
      
      .game-engine-resizer:hover {
        background: #0078d4;
      }
      
      .resizer-handle {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        opacity: 0.6;
      }
      
      .resizer-line {
        width: 2px;
        height: 8px;
        background: currentColor;
        border-radius: 1px;
      }
      
      .game-engine-resizer:hover .resizer-handle {
        opacity: 1;
      }
      
      .game-engine-panel {
        background: #2d2d30;
        border-left: 2px solid #3c3c3c;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        opacity: 0;
        transform: translateX(100%);
        transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        color: #cccccc;
        grid-column: 5;
      }
      
      .game-engine-panel.visible {
        opacity: 1;
        transform: translateX(0);
      }
      
      .game-engine-header {
        background: #1e1e1e;
        padding: 15px 20px;
        border-bottom: 1px solid #3c3c3c;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
      }
      
      .game-engine-header h3 {
        margin: 0;
        color: #0078d4;
        font-size: 18px;
      }
      
      .close-engine-btn {
        background: #dc3545;
        border: none;
        color: white;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .close-engine-btn:hover {
        background: #c82333;
      }
      
      .game-engine-tabs {
        background: #252526;
        display: flex;
        border-bottom: 1px solid #3c3c3c;
        flex-shrink: 0;
      }
      
      .tab-btn {
        background: none;
        border: none;
        color: #cccccc;
        padding: 12px 20px;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: all 0.2s;
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      
      .tab-btn.active {
        color: #0078d4;
        border-bottom-color: #0078d4;
      }
      
      .tab-btn:hover:not(.active) {
        background: #3c3c3c;
      }
      
      .game-engine-content {
        flex: 1;
        overflow: hidden;
        position: relative;
      }
      
      .tab-content {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: none;
        overflow: auto;
      }
      
      .tab-content.active {
        display: block;
      }
      
      .game-canvas-container {
        padding: 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        height: 100%;
      }
      
      #game-canvas {
        background: #000;
        border: 2px solid #3c3c3c;
        max-width: 100%;
        max-height: calc(100% - 60px);
      }
      
      .game-info {
        margin-top: 10px;
        color: #6c757d;
        font-style: italic;
      }
      
      .output-console, .script-viewer {
        height: 100%;
        display: flex;
        flex-direction: column;
      }
      
      .console-header, .script-header {
        background: #1e1e1e;
        padding: 10px 15px;
        border-bottom: 1px solid #3c3c3c;
        color: #0078d4;
        font-weight: bold;
        flex-shrink: 0;
      }
      
      .console-content, .script-content {
        flex: 1;
        padding: 15px;
        overflow: auto;
        font-family: 'Consolas', 'Monaco', monospace;
        font-size: 14px;
        line-height: 1.5;
        white-space: pre-wrap;
        background: #1e1e1e;
      }
      
      .console-content {
        color: #d4edda;
      }
      
      .script-content {
        color: #f8f9fa;
        background: #2d2d30;
      }
    `;
    
    document.head.appendChild(style);
  }
  
  setupGameEngineEvents(panel) {
    // Close button
    const closeBtn = panel.querySelector('.close-engine-btn');
    closeBtn.addEventListener('click', () => {
      this.hideGameEngine();
    });
    
    // Tab switching
    const tabBtns = panel.querySelectorAll('.tab-btn');
    const tabContents = panel.querySelectorAll('.tab-content');
    
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        
        // Update active tab button
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update active tab content
        tabContents.forEach(content => {
          content.classList.remove('active');
          if (content.id === `${targetTab}-tab`) {
            content.classList.add('active');
          }
        });
      });
    });
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showScriptResults(scriptData, output) {
    // Create a results window
    const resultsWindow = window.open('', '_blank', 'width=1000,height=800,scrollbars=yes,resizable=yes');
    
    resultsWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Lua Script Execution Results</title>
          <style>
            body { 
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
              background: #1e1e1e; 
              color: #cccccc; 
              padding: 20px; 
              margin: 0;
              line-height: 1.6;
            }
            .header { 
              color: #0078d4; 
              margin-bottom: 20px; 
              font-size: 24px;
              border-bottom: 2px solid #3c3c3c;
              padding-bottom: 15px;
              display: flex;
              align-items: center;
              gap: 10px;
            }
            .status {
              background: #0e5a1a;
              color: #4caf50;
              padding: 4px 12px;
              border-radius: 12px;
              font-size: 12px;
              font-weight: bold;
            }
            .info-section {
              background: #2d2d30;
              padding: 15px;
              border-radius: 6px;
              margin-bottom: 20px;
              border-left: 4px solid #0078d4;
            }
            .info-title {
              color: #0078d4;
              font-weight: bold;
              margin-bottom: 8px;
            }
            .file-list {
              color: #ddd;
              font-family: 'Consolas', monospace;
              font-size: 14px;
            }
            .section {
              margin-bottom: 20px;
            }
            .section-title {
              color: #f0f6fc;
              font-weight: bold;
              margin-bottom: 10px;
              font-size: 16px;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .output-section {
              background: #0d1117;
              border: 1px solid #30363d;
              border-radius: 6px;
              padding: 20px;
              min-height: 150px;
            }
            .script-section {
              background: #0d1117;
              border: 1px solid #30363d;
              border-radius: 6px;
              padding: 20px;
              max-height: 400px;
              overflow-y: auto;
            }
            .content {
              font-family: 'Consolas', 'Courier New', monospace;
              color: #e6edf3;
              white-space: pre-wrap;
              font-size: 14px;
              line-height: 1.5;
            }
            .no-output {
              color: #7d8590;
              font-style: italic;
            }
            .actions {
              margin-top: 20px;
              text-align: center;
            }
            .btn {
              background: #0078d4;
              color: white;
              padding: 8px 16px;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              margin: 0 5px;
              font-size: 14px;
            }
            .btn:hover {
              background: #106ebe;
            }
            .btn-secondary {
              background: #6c757d;
            }
            .btn-secondary:hover {
              background: #5a6268;
            }
            .toggle-script {
              background: #6f42c1;
              margin-top: 10px;
            }
            .toggle-script:hover {
              background: #5a32a3;
            }
          </style>
          <script>
            function toggleScript() {
              const scriptSection = document.getElementById('scriptSection');
              const toggleBtn = document.getElementById('toggleBtn');
              if (scriptSection.style.display === 'none') {
                scriptSection.style.display = 'block';
                toggleBtn.textContent = 'Hide Concatenated Script';
              } else {
                scriptSection.style.display = 'none';
                toggleBtn.textContent = 'Show Concatenated Script';
              }
            }
          </script>
        </head>
        <body>
          <div class="header">
            🚀 Lua Script Execution Results
            <span class="status">SUCCESS</span>
          </div>
          
          <div class="info-section">
            <div class="info-title">Execution Summary</div>
            <div class="file-list">
              📄 Files processed: ${scriptData.fileCount}<br>
              🔧 Setup() function: ${scriptData.hasSetup ? 'Found and executed' : 'Default generated'}<br>
              ⏱️ Executed at: ${new Date().toLocaleString()}
            </div>
          </div>
          
          <div class="section">
            <div class="section-title">💻 Script Output</div>
            <div class="output-section">
              <div class="content">${output || '<span class="no-output">No output generated</span>'}</div>
            </div>
          </div>
          
          <div class="section">
            <div class="section-title">📜 Concatenated Script</div>
            <button class="btn toggle-script" id="toggleBtn" onclick="toggleScript()">Show Concatenated Script</button>
            <div class="script-section" id="scriptSection" style="display: none;">
              <div class="content">${scriptData.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
            </div>
          </div>
          
          <div class="actions">
            <button class="btn" onclick="window.close()">Close</button>
            <button class="btn btn-secondary" onclick="toggleScript()">Toggle Script View</button>
          </div>
        </body>
      </html>
    `);
    
    resultsWindow.document.close();
  }
}

// Initialize when page loads
window.addEventListener('DOMContentLoaded', async () => {
  if (!window.gameEmulator) {
    window.gameEmulator = new GameEmulator();
    
    // Emit ready event after gameEmulator is fully initialized
    document.dispatchEvent(new CustomEvent('gameEmulatorReady'));
    console.log('[GameEmulator] Ready event emitted');
  } else {
    console.log('[GameEmulator] Instance already exists, skipping initialization');
  }
});
