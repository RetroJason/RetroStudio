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

  _requireStringArg(args, index, methodName, argName) {
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new Error(`[Music] ${methodName} missing required string argument: ${argName}`);
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
      throw new Error(`[Music] ${methodName} invalid numeric argument ${argName}: ${raw}`);
    }
    return value;
  }

  _requireAudioEngine(methodName) {
    this.audioEngine = this._getService('audioEngine') || window.audioEngine || this.audioEngine;
    if (!this.audioEngine) {
      throw new Error(`[Music] ${methodName} requires an available audio engine`);
    }
    return this.audioEngine;
  }

  _requireResource(resourceId, methodName) {
    if (!this.gameEmulator || typeof this.gameEmulator.GetResource !== 'function') {
      throw new Error(`[Music] ${methodName} requires an available game emulator resource API`);
    }
    const resource = this.gameEmulator.GetResource(resourceId);
    if (!resource) {
      throw new Error(`Music resource not found: ${resourceId}`);
    }
    if (!resource.isPreloaded || !resource.audioResource) {
      throw new Error(`Music resource not preloaded: ${resourceId}`);
    }
    return resource;
  }

  /**
   * Initialize the Music extension using centralized resource system
   * @param {Object} luaState - The Lua execution state
   */
  async initialize(luaState) {
    this.setLuaState(luaState);
    
    this.audioEngine = this._getService('audioEngine') || window.audioEngine;
    this.resourceManager = this._getService('resourceManager') || window.resourceManager;
    
    if (!this.audioEngine) {
      console.warn('[Music] AudioEngine not available');
    }
    if (!this.resourceManager) {
      console.warn('[Music] ResourceManager not available');
    }
  }

  /**
   * Play background music using preloaded resources from centralized system
   * Lua usage: Music.Play(resourceId, volume, loop)
   */
  Play(...args) {
    const resourceId = this._requireStringArg(args, 0, 'Play', 'resourceId');
    const volume = this._optionalNumberArg(args, 1, 1.0, 'Play', 'volume');
    const loop = this._optionalBooleanArg(args, 2, true, '[Music] Play', 'loop');
    const resource = this._requireResource(resourceId, 'Play');
    this._requireAudioEngine('Play').startSong(resource.audioResource, volume, loop);
    return true;
  }

  /**
   * Stop playing background music using centralized resource system
   * Lua usage: Music.Stop(resourceId)
   */
  Stop(...args) {
    const resourceId = this._requireStringArg(args, 0, 'Stop', 'resourceId');
    const resource = this._requireResource(resourceId, 'Stop');
    this._requireAudioEngine('Stop').stopSong(resource.audioResource);
    return true;
  }
}

// Make the class available globally
window.LuaMusicExtensions = LuaMusicExtensions;
