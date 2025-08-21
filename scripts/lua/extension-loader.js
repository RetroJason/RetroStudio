// extension-loader.js - Automatic Lua Extension Loader
// Loads and registers all Lua extensions based on extensions.json

class LuaExtensionLoader {
  constructor(gameEmulator) {
    this.gameEmulator = gameEmulator;
    this.extensions = new Map();
    this.extensionConfig = null;
  }

  /**
   * Load extension configuration from extensions.json
   */
  async loadExtensionConfig() {
    try {
      const response = await fetch('scripts/lua/extensions.json');
      if (!response.ok) {
        throw new Error(`Failed to load extensions.json: ${response.status}`);
      }
      this.extensionConfig = await response.json();
      console.log(`[LuaExtensionLoader] Loaded extension config: ${this.extensionConfig.name} v${this.extensionConfig.version}`);
      return this.extensionConfig;
    } catch (error) {
      console.error('[LuaExtensionLoader] Failed to load extension config:', error);
      throw error;
    }
  }

  /**
   * Load a specific extension JavaScript file
   * @param {string} categoryName - Name of the category/file to load
   */
  async loadExtensionFile(categoryName) {
    try {
      const scriptId = `lua-extension-${categoryName.toLowerCase()}`;
      
      // Check if script is already loaded
      if (document.getElementById(scriptId)) {
        console.log(`[LuaExtensionLoader] ${categoryName} extension already loaded`);
        return;
      }
      
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = `scripts/lua/${categoryName.toLowerCase()}.js`;
      
      return new Promise((resolve, reject) => {
        script.onload = () => {
          console.log(`[LuaExtensionLoader] Loaded ${categoryName} extension`);
          resolve();
        };
        script.onerror = () => {
          console.warn(`[LuaExtensionLoader] Failed to load ${categoryName} extension`);
          resolve(); // Don't fail entirely if one extension fails
        };
        document.head.appendChild(script);
      });
    } catch (error) {
      console.error(`[LuaExtensionLoader] Error loading ${categoryName}:`, error);
    }
  }

  /**
   * Initialize and register all extensions with the Lua state
   * @param {Object} luaState - The Lua execution state
   */
  async initializeExtensions(luaState) {
    try {
      // Load extension configuration
      await this.loadExtensionConfig();
      
      // First load the base extension class
      await this.loadBaseExtensionFile();
      
      // Load all extension files (only for categories with functions)
      const loadPromises = this.extensionConfig.categories
        .filter(category => category.functions.length > 0)
        .map(category => this.loadExtensionFile(category.name));
      await Promise.all(loadPromises);

      // Wait a bit for scripts to fully load
      await new Promise(resolve => setTimeout(resolve, 100));

      // Initialize extension instances and register functions
      for (const category of this.extensionConfig.categories) {
        if (category.functions.length > 0) {
          await this.initializeCategory(category, luaState);
        }
      }

      console.log('[LuaExtensionLoader] All extensions initialized');
    } catch (error) {
      console.error('[LuaExtensionLoader] Failed to initialize extensions:', error);
    }
  }

  /**
   * Load the base extension class
   */
  async loadBaseExtensionFile() {
    try {
      const scriptId = 'lua-base-extension';
      
      // Check if script is already loaded
      if (document.getElementById(scriptId)) {
        console.log('[LuaExtensionLoader] Base extension class already loaded');
        return;
      }
      
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = 'scripts/lua/base-lua-extension.js';
      
      return new Promise((resolve, reject) => {
        script.onload = () => {
          console.log('[LuaExtensionLoader] Loaded base extension class');
          resolve();
        };
        script.onerror = () => {
          console.error('[LuaExtensionLoader] Failed to load base extension class');
          reject(new Error('Failed to load base extension class'));
        };
        document.head.appendChild(script);
      });
    } catch (error) {
      console.error('[LuaExtensionLoader] Error loading base extension:', error);
      throw error;
    }
  }

  /**
   * Initialize a specific category of extensions
   * @param {Object} category - Category configuration
   * @param {Object} luaState - The Lua execution state
   */
  async initializeCategory(category, luaState) {
    try {
      const categoryName = category.name;
      const className = `Lua${categoryName}Extensions`;
      
      // Check if the extension class exists
      if (window[className]) {
        // Create instance
        const extensionInstance = new window[className](this.gameEmulator);
        extensionInstance.setLuaState(luaState);
        
        // Initialize the extension (important for service container access)
        if (typeof extensionInstance.initialize === 'function') {
          await extensionInstance.initialize(luaState);
        }
        
        this.extensions.set(categoryName, extensionInstance);
        
        // Register each function defined in the JSON configuration
        for (const func of category.functions) {
          this.registerFunction(extensionInstance, func, categoryName);
        }
        
        console.log(`[LuaExtensionLoader] Registered ${categoryName} functions: ${category.functions.map(f => f.name).join(', ')}`);
      } else {
        console.warn(`[LuaExtensionLoader] Extension class ${className} not found`);
      }
    } catch (error) {
      console.error(`[LuaExtensionLoader] Failed to initialize ${category.name}:`, error);
    }
  }

  /**
   * Register a single function from the JSON configuration
   * @param {Object} extensionInstance - The extension class instance
   * @param {Object} funcConfig - Function configuration from JSON
   * @param {string} categoryName - Category name for namespace
   */
  registerFunction(extensionInstance, funcConfig, categoryName) {
    try {
      const methodName = funcConfig.name;
      
      // Check if the method exists on the extension instance
      if (typeof extensionInstance[methodName] === 'function') {
        extensionInstance.registerMethod(methodName, extensionInstance[methodName], categoryName);
        console.log(`[LuaExtensionLoader] Registered ${categoryName}.${methodName}`);
      } else {
        console.error(`[LuaExtensionLoader] Method ${methodName} not found on ${categoryName} extension`);
      }
    } catch (error) {
      console.error(`[LuaExtensionLoader] Failed to register ${categoryName}.${funcConfig.name}:`, error);
    }
  }

  /**
   * Get extension configuration for IntelliSense generation
   */
  getExtensionConfig() {
    return this.extensionConfig;
  }

  /**
   * Get a specific extension instance
   * @param {string} categoryName - Name of the category
   */
  getExtension(categoryName) {
    return this.extensions.get(categoryName);
  }

  /**
   * Reset all extensions (clear state for reload)
   */
  resetExtensions() {
    console.log('[LuaExtensionLoader] Resetting all extensions...');
    for (const [categoryName, extension] of this.extensions) {
      if (typeof extension.reset === 'function') {
        extension.reset();
        console.log(`[LuaExtensionLoader] Reset ${categoryName} extension`);
      }
    }
  }

  /**
   * Generate IntelliSense definitions (for future use)
   */
  generateIntelliSenseDefinitions() {
    if (!this.extensionConfig) return null;

    const definitions = {
      functions: [],
      globals: []
    };

    for (const category of this.extensionConfig.categories) {
      for (const func of category.functions) {
        definitions.functions.push({
          name: func.name,
          description: func.description,
          parameters: func.parameters,
          returns: func.returns,
          example: func.example,
          category: category.name
        });
      }
    }

    return definitions;
  }
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LuaExtensionLoader;
} else {
  window.LuaExtensionLoader = LuaExtensionLoader;
}
