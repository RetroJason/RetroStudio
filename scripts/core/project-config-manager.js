// project-config-manager.js
// Write-through project configuration manager for Sources/config.json

class ProjectConfigManager {
  constructor() {
    this.defaultConfig = {
      version: "1.0",
      project: {
        defaultPalette: null,
        createdAt: null,
        modifiedAt: null
      }
    };
    this.config = { ...this.defaultConfig };
    this.configPath = 'Sources/config.json';
    this.isLoaded = false;
    this.loadPromise = null;
  }

  /**
   * Ensure config is loaded (lazy loading with write-through)
   */
  async ensureLoaded() {
    if (this.isLoaded) return this.config;
    
    // If already loading, wait for that promise
    if (this.loadPromise) return this.loadPromise;
    
    this.loadPromise = this._loadConfigFile();
    return this.loadPromise;
  }

  /**
   * Internal method to load config file with auto-creation
   */
  async _loadConfigFile() {
    try {
      console.log('[ProjectConfigManager] Loading project config from:', this.configPath);
      
      // Check if config file exists in storage
      const exists = await this._configFileExists();
      
      if (exists) {
        // Load existing config
        const fileManager = window.serviceContainer.get('fileManager');
        const configData = await fileManager.loadFile(this.configPath);
        
        if (configData && configData.fileContent) {
          const parsedConfig = JSON.parse(configData.fileContent);
          this.config = { ...this.defaultConfig, ...parsedConfig };
          console.log('[ProjectConfigManager] Loaded existing config:', this.config);
        }
      } else {
        // Create new config with defaults
        console.log('[ProjectConfigManager] No config found, creating with defaults');
        await this._createDefaultConfig();
      }
      
      this.isLoaded = true;
      this.loadPromise = null;
      return this.config;
    } catch (error) {
      console.error('[ProjectConfigManager] Failed to load/create config:', error);
      this.isLoaded = true;
      this.loadPromise = null;
      return this.config;
    }
  }

  /**
   * Check if config file exists in storage
   */
  async _configFileExists() {
    try {
      const fileIOService = window.fileIOService || window.serviceContainer?.get('fileIOService');
      if (!fileIOService) return false;
      
      const files = await fileIOService.listFiles();
      return files.some(f => f.path === this.configPath);
    } catch (error) {
      console.log('[ProjectConfigManager] Error checking config existence:', error);
      return false;
    }
  }

  /**
   * Create default config file with sensible defaults
   */
  async _createDefaultConfig() {
    this.config = { ...this.defaultConfig };
    this.config.project.createdAt = new Date().toISOString();
    this.config.project.modifiedAt = this.config.project.createdAt;
    
    // Don't auto-assign default palette during config creation
    // Let the ProjectExplorer handle it after files are loaded
    
    // Save the config file
    await this._saveConfigFile();
    await this._addToProjectStructure();
    
    console.log('[ProjectConfigManager] Created default config:', this.config);
  }

  /**
   * Auto-assign default palette based on available palettes
   */
  async _autoAssignDefaultPalette() {
    try {
      // Get all palette files from project explorer
      const projectExplorer = window.gameEmulator?.projectExplorer || window.projectExplorer;
      if (!projectExplorer) {
        console.log('[ProjectConfigManager] ProjectExplorer not available for auto-assignment');
        return;
      }
      
      const paletteFiles = projectExplorer.GetSourceFiles('Palettes') || [];
      console.log('[ProjectConfigManager] Found palette files for auto-assignment:', paletteFiles.map(f => f.name));
      
      if (paletteFiles.length > 0) {
        // Use the first palette as default
        const firstPalette = paletteFiles[0];
        const palettePath = `Sources/Palettes/${firstPalette.name}`;
        this.config.project.defaultPalette = palettePath;
        console.log('[ProjectConfigManager] Auto-assigned default palette:', palettePath);
      } else {
        // No palettes found, create a default one
        await this._createDefaultPalette();
      }
    } catch (error) {
      console.error('[ProjectConfigManager] Error auto-assigning palette:', error);
    }
  }

  /**
   * Create a default palette if none exists
   */
  async _createDefaultPalette() {
    try {
      console.log('[ProjectConfigManager] Creating default palette');
      
      // Create a basic PICO-8 style palette
      const defaultPaletteData = new Uint8Array(768); // 256 colors * 3 bytes (RGB)
      
      // PICO-8 16-color palette repeated to fill 256 colors
      const pico8Colors = [
        [0, 0, 0], [29, 43, 83], [126, 37, 83], [0, 135, 81],
        [171, 82, 54], [95, 87, 79], [194, 195, 199], [255, 241, 232],
        [255, 0, 77], [255, 163, 0], [255, 236, 39], [0, 228, 54],
        [41, 173, 255], [131, 118, 156], [255, 119, 168], [255, 204, 170]
      ];
      
      // Fill the palette data
      for (let i = 0; i < 256; i++) {
        const colorIndex = i % 16;
        const color = pico8Colors[colorIndex];
        defaultPaletteData[i * 3] = color[0];     // R
        defaultPaletteData[i * 3 + 1] = color[1]; // G
        defaultPaletteData[i * 3 + 2] = color[2]; // B
      }
      
      // Save the default palette
      const fileIOService = window.fileIOService || window.serviceContainer?.get('fileIOService');
      if (fileIOService) {
        const palettePath = 'Sources/Palettes/default.act';
        const storagePath = window.ProjectPaths?.normalizeStoragePath(palettePath) || palettePath;
        
        await fileIOService.saveFile(storagePath, defaultPaletteData.buffer, { 
          binaryData: true, 
          builderId: 'pal' 
        });
        
        this.config.project.defaultPalette = storagePath;
        console.log('[ProjectConfigManager] Created and assigned default palette:', storagePath);
        
        // Add to project structure
        const projectExplorer = window.gameEmulator?.projectExplorer || window.projectExplorer;
        if (projectExplorer && projectExplorer.addFileToStructure) {
          await projectExplorer.addFileToStructure('default.act', 'test/Sources/Palettes', {
            size: defaultPaletteData.length,
            type: 'file',
            extension: '.act'
          });
        }
      }
    } catch (error) {
      console.error('[ProjectConfigManager] Error creating default palette:', error);
    }
  }

  /**
   * Save config file to storage
   */
  async _saveConfigFile() {
    try {
      this.config.project.modifiedAt = new Date().toISOString();
      
      const fileIOService = window.fileIOService || window.serviceContainer?.get('fileIOService');
      if (!fileIOService) {
        throw new Error('FileIOService not available');
      }
      
      const configJson = JSON.stringify(this.config, null, 2);
      const storagePath = window.ProjectPaths?.normalizeStoragePath(this.configPath) || this.configPath;
      
      await fileIOService.saveFile(storagePath, configJson, { binaryData: false });
      console.log('[ProjectConfigManager] Saved config to storage:', storagePath);
    } catch (error) {
      console.error('[ProjectConfigManager] Failed to save config file:', error);
      throw error;
    }
  }

  /**
   * Add config file to project structure for UI visibility
   */
  async _addToProjectStructure() {
    try {
      const projectExplorer = window.gameEmulator?.projectExplorer || window.projectExplorer;
      if (projectExplorer && projectExplorer.addFileToStructure) {
        await projectExplorer.addFileToStructure('config.json', 'test/Sources', {
          size: JSON.stringify(this.config, null, 2).length,
          type: 'file',
          extension: '.json'
        });
        console.log('[ProjectConfigManager] Added config.json to project structure');
      }
    } catch (error) {
      console.error('[ProjectConfigManager] Error adding config to structure:', error);
    }
  }

  /**
   * Get the default palette path (write-through)
   */
  async getDefaultPalette() {
    await this.ensureLoaded();
    return this.config.project.defaultPalette;
  }

  /**
   * Set the default palette path (write-through)
   */
  async setDefaultPalette(palettePath) {
    await this.ensureLoaded();
    
    console.log('[ProjectConfigManager] Setting default palette to:', palettePath);
    this.config.project.defaultPalette = palettePath;
    await this._saveConfigFile();
    
    // Emit event for UI updates
    if (window.eventBus) {
      window.eventBus.emit('project.defaultPalette.changed', { palette: palettePath });
    }
  }

  /**
   * Clear the default palette (write-through)
   */
  async clearDefaultPalette() {
    await this.ensureLoaded();
    
    console.log('[ProjectConfigManager] Clearing default palette');
    this.config.project.defaultPalette = null;
    await this._saveConfigFile();
    
    // Emit event for UI updates
    if (window.eventBus) {
      window.eventBus.emit('project.defaultPalette.changed', { palette: null });
    }
  }

  /**
   * Get the full path to the default palette file
   */
  async getDefaultPaletteFullPath() {
    const defaultPalette = await this.getDefaultPalette();
    if (!defaultPalette) return null;
    
    // Convert storage path to full project path
    if (defaultPalette.startsWith('Sources/')) {
      return `test/${defaultPalette}`;
    }
    return defaultPalette;
  }

  /**
   * Initialize project config when project is loaded/created
   * This replaces the old loadProjectConfig method
   */
  async initializeForProject() {
    console.log('[ProjectConfigManager] Initializing for project');
    await this.ensureLoaded();
    
    // Check if we need to auto-assign a default palette
    if (!this.config.project.defaultPalette) {
      await this._autoAssignDefaultPalette();
      if (this.config.project.defaultPalette) {
        await this._saveConfigFile();
      }
    }
    
    return this.config;
  }

  /**
   * Reset config manager for new project
   */
  reset() {
    this.config = { ...this.defaultConfig };
    this.isLoaded = false;
    this.loadPromise = null;
    console.log('[ProjectConfigManager] Reset for new project');
  }

  // Legacy method compatibility
  async loadProjectConfig() {
    console.warn('[ProjectConfigManager] loadProjectConfig is deprecated, use initializeForProject');
    return this.initializeForProject();
  }

  // Legacy method compatibility  
  async saveProjectConfig() {
    console.warn('[ProjectConfigManager] saveProjectConfig is deprecated, changes are auto-saved');
    return true;
  }
}

// Create global instance
window.ProjectConfigManager = new ProjectConfigManager();

console.log('[ProjectConfigManager] Global instance created');
