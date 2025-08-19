/**
 * SFX (Sound Effects) Lua Extension
 * Provides sound effect playback functionality using centralized resource management
 */
class LuaSFXExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
    this.audioEngine = null;
    this.resourceManager = null;
  }

  /**
   * Initialize the SFX extension using centralized resource system
   * @param {Object} luaState - The Lua execution state
   */
  async initialize(luaState) {
    console.log('[LuaSfxExtensions] Initializing SFX extension...');
    
    this.setLuaState(luaState);
    
    // Get audio services
    console.log('[LuaSfxExtensions] DEBUG: Getting audio engine...');
    console.log('[LuaSfxExtensions] DEBUG: window.serviceContainer exists:', !!window.serviceContainer);
    console.log('[LuaSfxExtensions] DEBUG: window.serviceContainer.get exists:', !!window.serviceContainer?.get);
    
    this.audioEngine = window.serviceContainer?.get?.('audioEngine') || window.audioEngine;
    this.resourceManager = window.serviceContainer?.get?.('resourceManager') || window.resourceManager;
    
    console.log('[LuaSfxExtensions] DEBUG: Retrieved audioEngine:', !!this.audioEngine);
    console.log('[LuaSfxExtensions] DEBUG: Retrieved resourceManager:', !!this.resourceManager);
    
    if (!this.audioEngine) {
      console.warn('[LuaSfxExtensions] AudioEngine not available - SFX functionality will be limited');
    }
    
    if (!this.resourceManager) {
      console.warn('[LuaSfxExtensions] ResourceManager not available - SFX functionality will be limited');
    }
        
    console.log('[LuaSfxExtensions] SFX extension initialized successfully');
  }

  /**
   * Play a sound effect using preloaded resources from centralized system
   * Lua usage: SFX.Play(resourceId, shouldRepeat)
   */
  Play() {
    // Get the resource ID from Lua stack (index 2 is first parameter)
    const resourceId = this.luaState.raw_tostring(2) || '';
    const shouldRepeat = this.luaState.raw_tostring(3) === 'true' || false;
    
    console.log(`[LuaSfxExtensions] Playing SFX: ${resourceId}, repeat: ${shouldRepeat}`);
    
    if (!resourceId) {
      console.warn('[LuaSfxExtensions] Play called with empty resource ID');
      return false;
    }

    // Debug: Check audio engine availability
    console.log(`[LuaSfxExtensions] Audio engine available: ${!!this.audioEngine}`);
    
    // Get resource from centralized system
    const resource = this.gameEmulator.GetResource(resourceId);
    if (!resource) {
      const errorMsg = `SFX resource not found: ${resourceId}`;
      console.error(`[LuaSfxExtensions] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // Debug: Check resource details
    console.log(`[LuaSfxExtensions] Resource found: ${resourceId}`, resource);
    console.log(`[LuaSfxExtensions] Resource isPreloaded: ${resource.isPreloaded}`);
    console.log(`[LuaSfxExtensions] Resource audioResource: ${resource.audioResource}`);
    
    // Check if resource is preloaded
    if (!resource.isPreloaded) {
      console.warn(`[LuaSfxExtensions] SFX resource not preloaded: ${resourceId}`);
      // Fallback to loading on demand (shouldn't happen if preloading worked)
      if (this.gameEmulator) {
        const self = this;
        this.gameEmulator.loadAudioFileOnDemand(resourceId).then(function(audioResourceId) {
          self.audioEngine.startSound(audioResourceId, shouldRepeat);
        }).catch(function(error) {
          console.error(`[LuaSfxExtensions] Failed to load/play SFX ${resourceId}:`, error);
        });
        return true;
      } else {
        const errorMsg = `Resource not preloaded and GameEmulator not available for: ${resourceId}`;
        console.error(`[LuaSfxExtensions] ${errorMsg}`);
        throw new Error(errorMsg);
      }
    }
    
    // Use preloaded resource - start audio with the preloaded resource ID
    if (this.audioEngine && resource.audioResource) {
      // Note: startSound expects (resourceId, volume), not (resourceId, shouldRepeat)
      // For now, we'll use default volume of 1.0 and ignore shouldRepeat
      // TODO: Implement proper repeat functionality in audio engine
      this.audioEngine.startSound(resource.audioResource, 1.0);
      console.log(`[LuaSfxExtensions] Playing preloaded SFX: ${resourceId} (${resource.audioResource}) with volume 1.0, repeat: ${shouldRepeat}`);
      return true;
    } else {
      const errorMsg = `Audio system not available or resource not properly preloaded - cannot play SFX: ${resourceId}`;
      console.warn(`[LuaSfxExtensions] ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }

  /**
   * Stop a playing sound effect using centralized resource system
   * Lua usage: SFX.Stop(resourceId)
   */
  Stop() {
    const resourceId = this.luaState.raw_tostring(2) || '';
    
    console.log(`[LuaSfxExtensions] Stopping SFX: ${resourceId}`);
    
    if (!resourceId) {
      console.warn('[LuaSfxExtensions] Stop called with empty resource ID');
      return false;
    }
    
    // Get resource from centralized system
    const resource = this.gameEmulator.GetResource(resourceId);
    if (!resource) {
      const errorMsg = `SFX resource not found: ${resourceId}`;
      console.error(`[LuaSfxExtensions] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    const filePath = resource.filePath;
    
    if (this.audioEngine) {
      this.audioEngine.stopSound(filePath);
      return true;
    } else {
      const errorMsg = `Audio system not available - cannot stop SFX: ${resourceId}`;
      console.warn(`[LuaSfxExtensions] ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }

  /**
   * Check if a sound effect is currently playing using centralized resource system
   * Lua usage: SFX.IsPlaying(resourceId)
   */
  IsPlaying() {
    const resourceId = this.luaState.raw_tostring(2) || '';
    
    if (!resourceId) {
      console.warn('[LuaSfxExtensions] IsPlaying called with empty resource ID');
      return false;
    }
    
    // Get resource from centralized system
    const resource = this.gameEmulator.GetResource(resourceId);
    if (!resource) {
      const errorMsg = `SFX resource not found: ${resourceId}`;
      console.error(`[LuaSfxExtensions] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    const filePath = resource.filePath;
    
    if (this.audioEngine && typeof this.audioEngine.isSoundPlaying === 'function') {
      return this.audioEngine.isSoundPlaying(filePath);
    }
    
    // If audio engine doesn't support checking playing status, return false (not an error)
    return false;
  }

  /**
   * Set volume for a sound effect resource using centralized resource system
   * Lua usage: SFX.SetVolume(resourceId, volume)
   */
  SetVolume() {
    const resourceId = this.luaState.raw_tostring(2) || '';
    const volume = parseFloat(this.luaState.raw_tostring(3) || 1.0);
    const volumeLevel = Math.max(0.0, Math.min(1.0, volume));
    
    console.log(`[LuaSfxExtensions] Setting volume for ${resourceId}: ${volumeLevel}`);
    
    if (!resourceId) {
      console.warn('[LuaSfxExtensions] SetVolume called with empty resource ID');
      return false;
    }
    
    // Get resource from centralized system
    const resource = this.gameEmulator.GetResource(resourceId);
    if (!resource) {
      const errorMsg = `SFX resource not found: ${resourceId}`;
      console.error(`[LuaSfxExtensions] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    const filePath = resource.filePath;
    
    if (this.audioEngine && typeof this.audioEngine.setSoundVolume === 'function') {
      this.audioEngine.setSoundVolume(filePath, volumeLevel);
      return true;
    } else {
      const errorMsg = `Volume control not available in audio engine for: ${resourceId}`;
      console.warn(`[LuaSfxExtensions] ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }

  /**
   * List all available SFX resources using centralized resource system
   * @returns {number} Number of available resources
   */
  List() {
    console.log('[LuaSfxExtensions] Available SFX resources:');
    
    if (!this.gameEmulator) {
      var errorMsg = 'Game emulator not available';
      console.error(`[LuaSfxExtensions] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    var sfxResources = this.gameEmulator.GetResourcesByType('SFX');
    for (var i = 0; i < sfxResources.length; i++) {
      var resource = sfxResources[i];
      console.log(`  ${resource.id} -> ${resource.filePath}`);
    }
    
    return sfxResources.length;
  }
}

// Make the class available globally
window.LuaSFXExtensions = LuaSFXExtensions;