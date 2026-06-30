// extension-loader.js - Automatic Lua Extension Loader
// Loads and registers all Lua extensions based on the canonical API contract.

class LuaExtensionLoader {
  constructor(gameEmulator) {
    this.gameEmulator = gameEmulator;
    this.extensions = new Map();
    this.extensionConfig = null;
    this.reloadToken = Date.now().toString();
  }

  getExtensionClassName(categoryName) {
    return `Lua${categoryName}Extensions`;
  }

  buildScriptUrl(relativePath) {
    return `${relativePath}?v=${this.reloadToken}`;
  }

  getScriptLoadPromises() {
    if (!window.__luaExtensionScriptLoadPromises) {
      window.__luaExtensionScriptLoadPromises = new Map();
    }

    return window.__luaExtensionScriptLoadPromises;
  }

  /**
   * Load extension configuration from the canonical API contract.
   */
  async loadExtensionConfig() {
    try {
      const response = await fetch(this.buildScriptUrl('scripts/lua/api.json'), {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Failed to load Lua API contract: ${response.status}`);
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
      const className = this.getExtensionClassName(categoryName);
      const scriptId = `lua-extension-${categoryName.toLowerCase()}`;
      const scriptPromises = this.getScriptLoadPromises();

      if (typeof window[className] === 'function') {
        return;
      }

      if (scriptPromises.has(scriptId)) {
        await scriptPromises.get(scriptId);
        if (typeof window[className] !== 'function') {
          throw new Error(`${className} did not register after script load.`);
        }
        return;
      }

      const existingScript = document.getElementById(scriptId);
      if (existingScript) {
        throw new Error(`${scriptId} is present but ${className} is not registered.`);
      }

      const script = document.createElement('script');
      script.id = scriptId;
      script.src = this.buildScriptUrl(`scripts/lua/${categoryName.toLowerCase()}.js`);
      
      const loadPromise = new Promise((resolve, reject) => {
        script.onload = () => {
          if (typeof window[className] !== 'function') {
            reject(new Error(`${className} did not register after loading ${script.src}.`));
            return;
          }
          console.log(`[LuaExtensionLoader] Loaded ${categoryName} extension`);
          resolve();
        };
        script.onerror = () => {
          reject(new Error(`Failed to load ${categoryName} extension script: ${script.src}`));
        };
        document.head.appendChild(script);
      });

      scriptPromises.set(scriptId, loadPromise);
      try {
        await loadPromise;
      } catch (error) {
        scriptPromises.delete(scriptId);
        throw error;
      }
    } catch (error) {
      console.error(`[LuaExtensionLoader] Error loading ${categoryName}:`, error);
      throw error;
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
      throw error;
    }
  }

  /**
   * Load the base extension class
   */
  async loadBaseExtensionFile() {
    try {
      const scriptId = 'lua-base-extension';
      const scriptPromises = this.getScriptLoadPromises();

      if (typeof window.BaseLuaExtension === 'function') {
        return;
      }

      if (scriptPromises.has(scriptId)) {
        await scriptPromises.get(scriptId);
        if (typeof window.BaseLuaExtension !== 'function') {
          throw new Error('BaseLuaExtension did not register after script load.');
        }
        return;
      }

      const existingScript = document.getElementById(scriptId);
      if (existingScript) {
        throw new Error('lua-base-extension is present but BaseLuaExtension is not registered.');
      }

      const script = document.createElement('script');
      script.id = scriptId;
      script.src = this.buildScriptUrl('scripts/lua/base-lua-extension.js');
      
      const loadPromise = new Promise((resolve, reject) => {
        script.onload = () => {
          if (typeof window.BaseLuaExtension !== 'function') {
            reject(new Error(`BaseLuaExtension did not register after loading ${script.src}.`));
            return;
          }
          console.log('[LuaExtensionLoader] Loaded base extension class');
          resolve();
        };
        script.onerror = () => {
          console.error('[LuaExtensionLoader] Failed to load base extension class');
          reject(new Error('Failed to load base extension class'));
        };
        document.head.appendChild(script);
      });

      scriptPromises.set(scriptId, loadPromise);
      try {
        await loadPromise;
      } catch (error) {
        scriptPromises.delete(scriptId);
        throw error;
      }
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
      const className = this.getExtensionClassName(categoryName);
      
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
        throw new Error(`Extension class ${className} not found`);
      }
    } catch (error) {
      console.error(`[LuaExtensionLoader] Failed to initialize ${category.name}:`, error);
      throw error;
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
        throw new Error(`Method ${methodName} not found on ${categoryName} extension`);
      }
    } catch (error) {
      console.error(`[LuaExtensionLoader] Failed to register ${categoryName}.${funcConfig.name}:`, error);
      throw error;
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
    this.extensions.clear();
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
