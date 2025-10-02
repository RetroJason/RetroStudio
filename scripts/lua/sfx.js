/**
 * SFX (Sound Effects) Lua Extension
 * Provides sound effect playback functionality using centralized resource management
 */
class LuaSFXExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
    this.audioEngine = null;
  }

  /**
   * Initialize the SFX extension using centralized resource system
   * @param {Object} luaState - The Lua execution state
   */
  initialize(luaState) {
    console.log('[LuaSfxExtensions] Initializing SFX extension...');
    
    // Note: luaState is already set by the base class setLuaState() method
    
    // Get audio services (if available)
    this.audioEngine = window.serviceContainer?.get?.('audioEngine') || window.audioEngine;
    
    if (!this.audioEngine) {
      console.warn('[LuaSfxExtensions] AudioEngine not available - using mock implementation');
    }
    
    // Register all SFX methods using the base class approach
    this.registerMethod('Play', this.Play.bind(this), 'SFX');
    this.registerMethod('Stop', this.Stop.bind(this), 'SFX');
    this.registerMethod('IsPlaying', this.IsPlaying.bind(this), 'SFX');
        
    console.log('[LuaSfxExtensions] SFX extension initialized successfully');
  }



  /**
   * Play a sound effect using unified resource system
   * Lua usage: SFX.Play(resourceName, shouldRepeat)
   */
  Play() {
    // Get the resource name from Lua stack (index 2 is first parameter)
    const resourceName = this.luaState.raw_tostring(2) || '';
    const shouldRepeat = this.luaState.raw_tostring(3) === 'true' || false;
    
    console.log(`[LuaSfxExtensions] Playing SFX: ${resourceName}, repeat: ${shouldRepeat}`);
    
    if (!resourceName) {
      console.warn('[LuaSfxExtensions] Play called with empty resource name');
      return false;
    }

    try {
      // Get resource info from unified resource manager
      const resourceInfo = this.gameEmulator.unifiedResourceManager?.getResource(resourceName);
      
      if (!resourceInfo) {
        throw new Error(`SFX resource not loaded: ${resourceName}. Please ensure the resource is included in the current level.`);
      }

      // Get the audio engine resource ID from the audio loader
      const audioEngineResourceId = this.gameEmulator.audioResourceLoader?.getAudioEngineResourceId(resourceInfo.id);
      
      if (!audioEngineResourceId) {
        throw new Error(`Audio resource not available for: ${resourceName}`);
      }

      // Play using audio engine
      if (this.audioEngine) {
        this.audioEngine.startSound(audioEngineResourceId, 1.0);
        console.log(`[LuaSfxExtensions] Playing SFX: ${resourceName} (ID: ${resourceInfo.id}, AudioEngine: ${audioEngineResourceId})`);
        return true;
      } else {
        throw new Error(`Audio system not available for: ${resourceName}`);
      }
      
    } catch (error) {
      console.error(`[LuaSfxExtensions] Failed to play SFX ${resourceName}:`, error);
      throw error;
    }
  }

  /**
   * Stop a playing sound effect using the unified resource system
   * Lua usage: SFX.Stop(resourceName)
   */
  Stop() {
    const resourceName = this.luaState.raw_tostring(2) || '';
    
    console.log(`[LuaSfxExtensions] Stopping SFX: ${resourceName}`);
    
    if (!resourceName) {
      console.warn('[LuaSfxExtensions] Stop called with empty resource name');
      return false;
    }
    
    try {
      // Get resource info from unified resource manager
      const resourceInfo = this.gameEmulator.unifiedResourceManager?.getResource(resourceName);
      
      if (!resourceInfo) {
        throw new Error(`SFX resource not loaded: ${resourceName}`);
      }

      // Get the audio engine resource ID from the audio loader
      const audioEngineResourceId = this.gameEmulator.audioResourceLoader?.getAudioEngineResourceId(resourceInfo.id);
      
      if (!audioEngineResourceId) {
        throw new Error(`Audio resource not available for: ${resourceName}`);
      }
      
      if (this.audioEngine) {
        // Stop by audio engine resource ID
        this.audioEngine.stopSound(audioEngineResourceId);
        return true;
      } else {
        throw new Error(`Audio system not available - cannot stop SFX: ${resourceName}`);
      }
      
    } catch (error) {
      console.error(`[LuaSfxExtensions] Failed to stop SFX ${resourceName}:`, error);
      throw error;
    }
  }

  /**
   * Check if a sound effect is currently playing using the unified resource system
   * Lua usage: SFX.IsPlaying(resourceName)
   */
  IsPlaying() {
    const resourceName = this.luaState.raw_tostring(2) || '';
    
    if (!resourceName) {
      console.warn('[LuaSfxExtensions] IsPlaying called with empty resource name');
      return false;
    }
    
    try {
      // Get resource info from unified resource manager
      const resourceInfo = this.gameEmulator.unifiedResourceManager?.getResource(resourceName);
      
      if (!resourceInfo) {
        throw new Error(`SFX resource not loaded: ${resourceName}`);
      }

      // Get the audio engine resource ID from the audio loader
      const audioEngineResourceId = this.gameEmulator.audioResourceLoader?.getAudioEngineResourceId(resourceInfo.id);
      
      if (!audioEngineResourceId) {
        throw new Error(`Audio resource not available for: ${resourceName}`);
      }
      
      if (this.audioEngine && typeof this.audioEngine.isSoundPlaying === 'function') {
        return this.audioEngine.isSoundPlaying(audioEngineResourceId);
      }
      
      // If audio engine doesn't support checking playing status, return false (not an error)
      return false;
      
    } catch (error) {
      console.error(`[LuaSfxExtensions] Failed to check playing status for ${resourceName}:`, error);
      return false;
    }
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
   * List all available SFX resources using the unified resource system
   * @returns {number} Number of available resources
   */
  List() {
    console.log('[LuaSfxExtensions] Available SFX resources:');
    
    if (!this.gameEmulator.unifiedResourceManager) {
      var errorMsg = 'Unified resource manager not available';
      console.error(`[LuaSfxExtensions] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // Get all resources loaded by the audio loader
    var audioResources = this.gameEmulator.unifiedResourceManager.getResourcesByLoader('audio');
    
    for (var i = 0; i < audioResources.length; i++) {
      var resource = audioResources[i];
      console.log(`  ${resource.name} -> ${resource.filePath} (ID: ${resource.id})`);
    }
    
    return audioResources.length;
  }
}

// Make the class available globally
window.LuaSFXExtensions = LuaSFXExtensions;