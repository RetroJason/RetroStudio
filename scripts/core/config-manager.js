// config-manager.js
// Centralized configuration management

class ConfigManager {
  constructor() {
    this.config = new Map();
    this.watchers = new Map();
    this.schemas = new Map();
    this.loadDefaults();
  }

  // Load default configuration
  loadDefaults() {
    this.setDefaults({
      // UI Configuration
      ui: {
        theme: 'dark',
        tabAnimation: true,
        previewAutoClose: true,
        contextMenuDelay: 200
      },

      // Editor Configuration
      editors: {
        autoSave: false,
        autoSaveInterval: 30000,
        tabSize: 2,
        wordWrap: true,
        showLineNumbers: true
      },

      // Audio Configuration
      audio: {
        sampleRate: 44100,
        bufferSize: 2048,
        defaultVolume: 0.7,
        mixerLogging: 'minimal' // 'verbose', 'minimal', 'silent'
      },

      // Build Configuration
      build: {
        autoRefreshTabs: true,
        clearBuildOnStart: true,
        parallelBuilds: true,
  // UI label for build root (used only for display); storage always uses ProjectPaths.getBuildStoragePrefix()
  outputDirectory: (window.ProjectPaths && window.ProjectPaths.getBuildRootUi) ? window.ProjectPaths.getBuildRootUi() : 'Game Objects'
      },

      // Project Configuration
      project: {
        autoLoadLastProject: true,
        maxRecentProjects: 10,
        // Derive from ProjectPaths to avoid drift with UI renames
        defaultFolders: (function(){
          try {
            const src = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Sources';
            return [`${src}/Lua`, `${src}/Music`, `${src}/SFX`, `${src}/Binary`];
          } catch(_) {
            return ['Sources/Lua', 'Sources/Music', 'Sources/SFX', 'Sources/Binary'];
          }
        })()
      },

      // Plugin Configuration
      plugins: {
        autoLoadPlugins: true,
        allowExternalPlugins: false,
        pluginDirectory: 'plugins'
      }
    });
  }

  // Set default configuration
  setDefaults(defaults) {
    for (const [key, value] of Object.entries(defaults)) {
      if (!this.config.has(key)) {
        this.config.set(key, this.deepClone(value));
      }
    }
  }

  // Get configuration value
  get(path, defaultValue = undefined) {
    const keys = path.split('.');
    let current = Object.fromEntries(this.config);

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return defaultValue;
      }
    }

    return current;
  }

  // Set configuration value
  set(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const parentPath = keys.join('.');
    
    // Get or create parent object
    const parent = keys.length > 0 ? this.get(parentPath, {}) : Object.fromEntries(this.config);
    
    // Validate against schema if available
    const schema = this.schemas.get(path);
    if (schema && !this.validateValue(value, schema)) {
      throw new Error(`Configuration value for ${path} does not match schema`);
    }

    // Set value
    parent[lastKey] = this.deepClone(value);
    
    // Update root config
    if (keys.length > 0) {
      this.setRootConfig(keys[0], parent);
    } else {
      this.config.set(lastKey, this.deepClone(value));
    }

    // Notify watchers
    this.notifyWatchers(path, value);
    
    console.log(`[ConfigManager] Set ${path} =`, value);
  }

  // Watch for configuration changes
  watch(path, callback) {
    if (!this.watchers.has(path)) {
      this.watchers.set(path, []);
    }
    
    this.watchers.get(path).push(callback);
    
    // Return unwatch function
    return () => {
      const watchers = this.watchers.get(path);
      if (watchers) {
        const index = watchers.indexOf(callback);
        if (index !== -1) {
          watchers.splice(index, 1);
        }
      }
    };
  }

  // Register configuration schema
  registerSchema(path, schema) {
    this.schemas.set(path, schema);
    console.log(`[ConfigManager] Registered schema for ${path}`);
  }

  // Load configuration from storage
  async loadFromStorage() {
    try {
      const stored = localStorage.getItem('retro-studio-config');
      if (stored) {
        const config = JSON.parse(stored);
        for (const [key, value] of Object.entries(config)) {
          this.config.set(key, value);
        }
        console.log('[ConfigManager] Loaded configuration from storage');
      }
    } catch (error) {
      console.error('[ConfigManager] Failed to load configuration:', error);
    }
  }

  // Save configuration to storage
  async saveToStorage() {
    try {
      const config = Object.fromEntries(this.config);
      localStorage.setItem('retro-studio-config', JSON.stringify(config));
      console.log('[ConfigManager] Saved configuration to storage');
    } catch (error) {
      console.error('[ConfigManager] Failed to save configuration:', error);
    }
  }

  // Export configuration
  export() {
    return Object.fromEntries(this.config);
  }

  // Import configuration
  import(config) {
    for (const [key, value] of Object.entries(config)) {
      this.config.set(key, this.deepClone(value));
    }
    console.log('[ConfigManager] Imported configuration');
  }

  // Helper methods
  setRootConfig(key, value) {
    const current = this.config.get(key) || {};
    this.config.set(key, { ...current, ...value });
  }

  notifyWatchers(path, value) {
    const watchers = this.watchers.get(path) || [];
    watchers.forEach(callback => {
      try {
        callback(value, path);
      } catch (error) {
        console.error(`[ConfigManager] Watcher error for ${path}:`, error);
      }
    });
  }

  validateValue(value, schema) {
    // Simple validation - could be enhanced
    if (schema.type && typeof value !== schema.type) {
      return false;
    }
    if (schema.enum && !schema.enum.includes(value)) {
      return false;
    }
    return true;
  }

  deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj);
    if (Array.isArray(obj)) return obj.map(item => this.deepClone(item));
    
    const cloned = {};
    for (const [key, value] of Object.entries(obj)) {
      cloned[key] = this.deepClone(value);
    }
    return cloned;
  }
}

// Global instance
window.configManager = new ConfigManager();
window.ConfigManager = ConfigManager;
