// plugin-system.js
// Enhanced plugin architecture for extensibility

class PluginSystem {
  constructor(serviceContainer) {
    this.services = serviceContainer;
    this.plugins = new Map();
    this.hooks = new Map();
    this.middlewares = new Map();
  }

  // Plugin registration
  registerPlugin(pluginInfo) {
    const { name, version, type, dependencies = [], factory } = pluginInfo;
    
    // Validate dependencies
    for (const dep of dependencies) {
      if (!this.services.has(dep) && !this.plugins.has(dep)) {
        throw new Error(`Plugin ${name} dependency not found: ${dep}`);
      }
    }

    // Create plugin instance
    const dependencies_resolved = dependencies.map(dep => 
      this.services.has(dep) ? this.services.get(dep) : this.plugins.get(dep)
    );
    
    const plugin = factory(...dependencies_resolved);
    
    // Store plugin
    this.plugins.set(name, {
      instance: plugin,
      info: { name, version, type, dependencies }
    });

    console.log(`[PluginSystem] Registered plugin: ${name} v${version} (${type})`);
    
    // Initialize plugin if it has an init method
    if (typeof plugin.initialize === 'function') {
      plugin.initialize(this.services);
    }

    return plugin;
  }

  // Hook system for extensibility
  registerHook(hookName, priority = 10) {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }
    return (callback) => {
      this.hooks.get(hookName).push({ callback, priority });
      this.hooks.get(hookName).sort((a, b) => a.priority - b.priority);
    };
  }

  // Execute hooks
  async executeHook(hookName, ...args) {
    const hooks = this.hooks.get(hookName) || [];
    const results = [];
    
    for (const { callback } of hooks) {
      try {
        const result = await callback(...args);
        results.push(result);
      } catch (error) {
        console.error(`[PluginSystem] Hook ${hookName} failed:`, error);
      }
    }
    
    return results;
  }

  // Middleware system for processing pipelines
  registerMiddleware(pipelineName, middleware) {
    if (!this.middlewares.has(pipelineName)) {
      this.middlewares.set(pipelineName, []);
    }
    this.middlewares.get(pipelineName).push(middleware);
  }

  // Execute middleware pipeline
  async executePipeline(pipelineName, context) {
    const middlewares = this.middlewares.get(pipelineName) || [];
    
    for (const middleware of middlewares) {
      try {
        context = await middleware(context);
      } catch (error) {
        console.error(`[PluginSystem] Pipeline ${pipelineName} failed:`, error);
        throw error;
      }
    }
    
    return context;
  }

  // Get plugin by name
  getPlugin(name) {
    const plugin = this.plugins.get(name);
    return plugin ? plugin.instance : null;
  }

  // Get all plugins of a specific type
  getPluginsByType(type) {
    return Array.from(this.plugins.values())
      .filter(plugin => plugin.info.type === type)
      .map(plugin => plugin.instance);
  }
}

// Export for use
window.PluginSystem = PluginSystem;
