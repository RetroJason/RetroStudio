/**
 * Music (Background Music) Lua Extension
 * Provides background music playback functionality using centralized resource management
 */
class LuaMusicExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
    this.audioEngine = null;
    this.resourceManager = null;
  }

  /**
   * Initialize the Music extension using centralized resource system
   * @param {Object} luaState - The Lua execution state
   */
  async initialize(luaState) {
    console.log('[LuaMusicExtensions] Initializing Music extension...');
    
    this.setLuaState(luaState);
    
    // Get audio services
    console.log('[LuaMusicExtensions] DEBUG: Getting audio engine...');
    console.log('[LuaMusicExtensions] DEBUG: window.serviceContainer exists:', !!window.serviceContainer);
    console.log('[LuaMusicExtensions] DEBUG: window.serviceContainer.get exists:', !!window.serviceContainer?.get);
    
    this.audioEngine = window.serviceContainer?.get?.('audioEngine') || window.audioEngine;
    this.resourceManager = window.serviceContainer?.get?.('resourceManager') || window.resourceManager;
    
    console.log('[LuaMusicExtensions] DEBUG: Retrieved audioEngine:', !!this.audioEngine);
    console.log('[LuaMusicExtensions] DEBUG: Retrieved resourceManager:', !!this.resourceManager);
    
    if (!this.audioEngine) {
      console.warn('[LuaMusicExtensions] AudioEngine not available - Music functionality will be limited');
    }
    
    if (!this.resourceManager) {
      console.warn('[LuaMusicExtensions] ResourceManager not available - Music functionality will be limited');
    }
        
    console.log('[LuaMusicExtensions] Music extension initialized successfully');
  }

  /**
   * Play background music using preloaded resources from centralized system
   * Lua usage: Music.Play(resourceId, volume, loop)
   */
  Play() {
    // Get parameters from Lua stack
    const resourceId = this.luaState.raw_tostring(2) || '';
    const volume = parseFloat(this.luaState.raw_tostring(3) || 1.0);
    const loop = this.luaState.raw_tostring(4) === 'true' || this.luaState.raw_tostring(4) === '' || true; // Default to true if not specified
    
    console.log(`[LuaMusicExtensions] Playing Music: ${resourceId}, volume: ${volume}, loop: ${loop}`);
    
    if (!resourceId) {
      console.warn('[LuaMusicExtensions] Play called with empty resource ID');
      return false;
    }

    // Debug: Check audio engine availability
    console.log(`[LuaMusicExtensions] Audio engine available: ${!!this.audioEngine}`);
    
    // Get resource from centralized system
    const resource = this.gameEmulator.GetResource(resourceId);
    if (!resource) {
      const errorMsg = `Music resource not found: ${resourceId}`;
      console.error(`[LuaMusicExtensions] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // Debug: Check resource details
    console.log(`[LuaMusicExtensions] Resource found: ${resourceId}`, resource);
    console.log(`[LuaMusicExtensions] Resource isPreloaded: ${resource.isPreloaded}`);
    console.log(`[LuaMusicExtensions] Resource audioResource: ${resource.audioResource}`);
    
    // Check if resource is preloaded
    if (!resource.isPreloaded) {
      console.warn(`[LuaMusicExtensions] Music resource not preloaded: ${resourceId}`);
      // Music files should be preloaded, but we could add fallback loading here if needed
      const errorMsg = `Music resource not preloaded: ${resourceId}`;
      console.error(`[LuaMusicExtensions] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // Use preloaded resource - start music with the preloaded resource ID
    if (this.audioEngine && resource.audioResource) {
      // Note: startSong expects (resourceId, volume, loop)
      this.audioEngine.startSong(resource.audioResource, volume, loop);
      console.log(`[LuaMusicExtensions] Playing preloaded Music: ${resourceId} (${resource.audioResource}) with volume ${volume}, loop: ${loop}`);
      return true;
    } else {
      const errorMsg = `Audio system not available or resource not properly preloaded - cannot play Music: ${resourceId}`;
      console.warn(`[LuaMusicExtensions] ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }

  /**
   * Stop playing background music using centralized resource system
   * Lua usage: Music.Stop(resourceId)
   */
  Stop() {
    const resourceId = this.luaState.raw_tostring(2) || '';
    
    console.log(`[LuaMusicExtensions] Stopping Music: ${resourceId}`);
    
    if (!resourceId) {
      console.warn('[LuaMusicExtensions] Stop called with empty resource ID');
      return false;
    }
    
    // Get resource from centralized system
    const resource = this.gameEmulator.GetResource(resourceId);
    if (!resource) {
      const errorMsg = `Music resource not found: ${resourceId}`;
      console.error(`[LuaMusicExtensions] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // Use the preloaded resource ID for stopping
    if (this.audioEngine && resource.audioResource) {
      this.audioEngine.stopSong(resource.audioResource);
      console.log(`[LuaMusicExtensions] Stopped Music: ${resourceId} (${resource.audioResource})`);
      return true;
    } else {
      const errorMsg = `Audio system not available - cannot stop Music: ${resourceId}`;
      console.warn(`[LuaMusicExtensions] ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }
}

// Make the class available globally
window.LuaMusicExtensions = LuaMusicExtensions;
