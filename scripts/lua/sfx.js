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

  _requireStringArg(args, index, methodName, argName) {
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new Error(`[SFX] ${methodName} missing required string argument: ${argName}`);
    }
    return raw;
  }

  _optionalNumberArg(args, index, defaultValue, methodName, argName) {
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
    if (raw === undefined || raw === null || raw === '') {
      return defaultValue;
    }
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`[SFX] ${methodName} invalid numeric argument ${argName}: ${raw}`);
    }
    return value;
  }

  _optionalBooleanArg(args, index, defaultValue) {
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
    if (raw === undefined || raw === null || raw === '') {
      return defaultValue;
    }
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'string') {
      const normalized = raw.toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === '0') {
        return false;
      }
    }
    throw new Error(`[SFX] invalid boolean argument: ${raw}`);
  }

  _requireAudioEngine(methodName) {
    this.audioEngine = window.serviceContainer?.get?.('audioEngine') || window.audioEngine || this.audioEngine;
    if (!this.audioEngine) {
      throw new Error(`[SFX] ${methodName} requires an available audio engine`);
    }
    return this.audioEngine;
  }

  _requireResource(resourceId, methodName) {
    if (!this.gameEmulator || typeof this.gameEmulator.GetResource !== 'function') {
      throw new Error(`[SFX] ${methodName} requires an available game emulator resource API`);
    }
    const resource = this.gameEmulator.GetResource(resourceId);
    if (!resource) {
      throw new Error(`SFX resource not found: ${resourceId}`);
    }
    if (!resource.isPreloaded || !resource.audioResource) {
      throw new Error(`SFX resource not preloaded: ${resourceId}`);
    }
    return resource;
  }

  /**
   * Initialize the SFX extension using centralized resource system
   * @param {Object} luaState - The Lua execution state
   */
  async initialize(luaState) {
    this.setLuaState(luaState);
    
    this.audioEngine = window.serviceContainer?.get?.('audioEngine') || window.audioEngine;
    this.resourceManager = window.serviceContainer?.get?.('resourceManager') || window.resourceManager;
    
    if (!this.audioEngine) {
      console.warn('[SFX] AudioEngine not available');
    }
    if (!this.resourceManager) {
      console.warn('[SFX] ResourceManager not available');
    }
  }

  /**
   * Play a sound effect using preloaded resources from centralized system
   * Lua usage: SFX.Play(resourceId, shouldRepeat)
   */
  Play(...args) {
    const resourceId = this._requireStringArg(args, 0, 'Play', 'resourceId');
    const shouldRepeat = this._optionalBooleanArg(args, 1, false);
    const resource = this._requireResource(resourceId, 'Play');
    const audioEngine = this._requireAudioEngine('Play');
    if (typeof audioEngine.startSound !== 'function') {
      throw new Error('[SFX] Play requires audioEngine.startSound');
    }

    const volume = 1.0;
    audioEngine.startSound(resource.audioResource, volume, shouldRepeat);
    return true;
  }

  /**
   * Stop a playing sound effect using centralized resource system
   * Lua usage: SFX.Stop(resourceId)
   */
  Stop(...args) {
    const resourceId = this._requireStringArg(args, 0, 'Stop', 'resourceId');
    const resource = this._requireResource(resourceId, 'Stop');
    const audioEngine = this._requireAudioEngine('Stop');
    if (typeof audioEngine.stopSound !== 'function') {
      throw new Error('[SFX] Stop requires audioEngine.stopSound');
    }

    audioEngine.stopSound(resource.audioResource);
    return true;
  }

  /**
   * Check if a sound effect is currently playing using centralized resource system
   * Lua usage: SFX.IsPlaying(resourceId)
   */
  IsPlaying(...args) {
    const resourceId = this._requireStringArg(args, 0, 'IsPlaying', 'resourceId');
    const resource = this._requireResource(resourceId, 'IsPlaying');
    const audioEngine = this._requireAudioEngine('IsPlaying');
    if (typeof audioEngine.isSoundPlaying !== 'function') {
      throw new Error('[SFX] IsPlaying requires audioEngine.isSoundPlaying');
    }
    return audioEngine.isSoundPlaying(resource.audioResource);
  }

  /**
   * Set volume for a sound effect resource using centralized resource system
   * Lua usage: SFX.SetVolume(resourceId, volume)
   */
  SetVolume(...args) {
    const resourceId = this._requireStringArg(args, 0, 'SetVolume', 'resourceId');
    const volume = this._optionalNumberArg(args, 1, 1.0, 'SetVolume', 'volume');
    const volumeLevel = Math.max(0.0, Math.min(1.0, volume));

    const resource = this._requireResource(resourceId, 'SetVolume');
    const audioEngine = this._requireAudioEngine('SetVolume');
    if (typeof audioEngine.setSoundVolume !== 'function') {
      throw new Error(`Volume control not available in audio engine for: ${resourceId}`);
    }

    audioEngine.setSoundVolume(resource.audioResource, volumeLevel);
    return true;
  }

  /**
   * List all available SFX resources using centralized resource system
   * @returns {number} Number of available resources
   */
  List() {
    if (!this.gameEmulator) {
      throw new Error('Game emulator not available');
    }
    return this.gameEmulator.GetResourcesByType('SFX').length;
  }
}

// Make the class available globally
window.LuaSFXExtensions = LuaSFXExtensions;