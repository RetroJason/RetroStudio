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
    this.sfxHandles = new Map();
    this._nextHandle = 1;
  }

  reset() {
    if (this.audioEngine && typeof this.audioEngine.stopSound === 'function') {
      for (const sfx of this.sfxHandles.values()) {
        if (sfx.instanceId) {
          this.audioEngine.stopSound(sfx.instanceId);
        }
      }
    }

    this.sfxHandles.clear();
    this._nextHandle = 1;
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

  _requireAudioEngine(methodName) {
    const serviceAudioEngine = this._getService('audioEngine');
    if (this.audioEngine && serviceAudioEngine && serviceAudioEngine !== this.audioEngine) {
      throw new Error(`[SFX] ${methodName} resolved a different audio engine instance than initialization`);
    }
    this.audioEngine = serviceAudioEngine || this.audioEngine;
    if (!this.audioEngine) {
      throw new Error(`[SFX] ${methodName} requires an available audio engine`);
    }
    return this.audioEngine;
  }

  _requirePlayableResource(resource, methodName, resourceName = resource?.fileName || resource?.name || 'unknown') {
    if (!resource) {
      throw new Error(`[SFX] ${methodName} missing resource object`);
    }
    if (!resource.loaded || !resource.audioResource) {
      throw new Error(`SFX asset not preloaded: ${resourceName}`);
    }
    const audioEngine = this._requireAudioEngine(methodName);
    const loadedResource = typeof audioEngine.getResource === 'function'
      ? audioEngine.getResource(resource.audioResource)
      : null;

    if (!loadedResource) {
      const loadedResourceIds = audioEngine?.resources instanceof Map
        ? Array.from(audioEngine.resources.keys())
        : [];
      throw new Error(`[SFX] ${methodName} could not resolve audio resource for ${resourceName}: ${resource.audioResource}. Loaded audio resources: ${loadedResourceIds.join(', ') || '(none)'}`);
    }

    if (loadedResource.type !== 'wav') {
      throw new Error(`[SFX] ${methodName} expected WAV resource for ${resourceName}, got ${loadedResource.type}`);
    }

    return { resource, loadedResource, audioEngine };
  }

  _requireResourceByName(resourceName, methodName) {
    if (!this.gameEmulator || typeof this.gameEmulator.GetResourcesByType !== 'function') {
      throw new Error(`[SFX] ${methodName} requires an available game emulator resource API`);
    }

    const resources = this.gameEmulator.GetResourcesByType('SFX');
    const resource = resources.find((entry) => entry.fileName === resourceName);
    if (!resource) {
      throw new Error(`SFX asset not found: ${resourceName}`);
    }
    if (!resource.loaded || !resource.audioResource) {
      throw new Error(`SFX asset not preloaded: ${resourceName}`);
    }
    return resource;
  }

  _requireStackStringArg(stackIndex, methodName, argName) {
    const raw = this.luaState?.raw_tostring?.(stackIndex);
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new Error(`[SFX] ${methodName} missing required string argument: ${argName}`);
    }
    return raw;
  }

  _requireStackHandleArg(stackIndex, methodName, argName = 'handle') {
    const raw = this.luaState?.raw_tostring?.(stackIndex);
    const handle = Number.parseInt(raw, 10);
    if (!Number.isFinite(handle)) {
      throw new Error(`[SFX] ${methodName} missing or invalid ${argName}: ${raw}`);
    }
    return handle;
  }

  _requireHandleStateByStack(stackIndex, methodName) {
    const handle = this._requireStackHandleArg(stackIndex, methodName);
    const sfx = this.sfxHandles.get(handle);
    if (!sfx) {
      throw new Error(`[SFX] ${methodName} unknown handle: ${handle}`);
    }
    return sfx;
  }

  _requireHandleArg(args, index, methodName, argName = 'handle') {
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
    const handle = Number.parseInt(raw, 10);
    if (!Number.isFinite(handle)) {
      throw new Error(`[SFX] ${methodName} missing or invalid ${argName}: ${raw}`);
    }
    return handle;
  }

  _requireHandleState(args, index, methodName) {
    const handle = this._requireHandleArg(args, index, methodName);
    const sfx = this.sfxHandles.get(handle);
    if (!sfx) {
      throw new Error(`[SFX] ${methodName} unknown handle: ${handle}`);
    }
    return sfx;
  }

  /**
   * Initialize the SFX extension using centralized resource system
   * @param {Object} luaState - The Lua execution state
   */
  async initialize(luaState) {
    this.setLuaState(luaState);
    
    this.audioEngine = this._getService('audioEngine');
    this.resourceManager = this._getService('resourceManager');
    
    if (!this.audioEngine) {
      console.warn('[SFX] AudioEngine not available');
    }
    if (!this.resourceManager) {
      console.warn('[SFX] ResourceManager not available');
    }
  }

  /**
   * Create a sound effect handle from a preloaded SFX asset name.
   * Lua usage: local handle = SFX.Create("shoot")
   */
  Create() {
    const resourceName = this._requireStackStringArg(2, 'Create', 'resourceName');
    const resource = this._requireResourceByName(resourceName, 'Create');
    const { loadedResource } = this._requirePlayableResource(resource, 'Create', resourceName);

    const handle = this._nextHandle++;
    this.sfxHandles.set(handle, {
      handle,
      resourceName,
      resource,
      resourceId: resource.audioResource,
      audioResourceObject: loadedResource,
      instanceId: null,
      volume: 1.0,
    });

    return handle;
  }

  /**
   * Destroy a sound effect handle.
   * Lua usage: SFX.Destroy(handle)
   */
  Destroy() {
    const sfx = this._requireHandleStateByStack(2, 'Destroy');
    const audioEngine = this._requireAudioEngine('Destroy');
    if (typeof audioEngine.stopSound === 'function' && sfx.instanceId) {
      audioEngine.stopSound(sfx.instanceId);
      sfx.instanceId = null;
    }
    this.sfxHandles.delete(sfx.handle);
    return true;
  }

  /**
   * Play a sound effect handle using preloaded resources.
   * Lua usage: SFX.Play(handle, shouldRepeat)
   */
  Play() {
    const sfx = this._requireHandleStateByStack(2, 'Play');
    const shouldRepeat = this._optionalBooleanArg([], 1, false, '[SFX] Play', 'shouldRepeat');
    const audioEngine = this._requireAudioEngine('Play');
    const loadedResourceIds = audioEngine?.resources instanceof Map
      ? Array.from(audioEngine.resources.keys())
      : [];
    console.log('[SFX][AudioDebug] Play requested:', {
      resourceName: sfx.resourceName,
      audioResourceId: sfx.resourceId,
      audioEngineId: audioEngine?._debugId || 'audio_unknown',
      loadedResourceIds,
    });
    if (typeof audioEngine.startSound !== 'function') {
      throw new Error('[SFX] Play requires audioEngine.startSound');
    }
    if (shouldRepeat) {
      throw new Error('[SFX] Play does not support repeating sound effects');
    }

    if (sfx.instanceId && typeof audioEngine.stopSound === 'function') {
      audioEngine.stopSound(sfx.instanceId);
      sfx.instanceId = null;
    }

    Promise.resolve()
      .then(async () => {
        if (audioEngine.audioContext?.state === 'suspended') {
          await audioEngine.audioContext.resume();
        }
        return audioEngine.startSound(sfx.audioResourceObject, sfx.volume);
      })
      .then((instanceId) => {
        if (!instanceId) {
          const contextState = audioEngine.audioContext?.state ?? 'missing';
          const reason = !sfx.audioResourceObject
            ? 'handle has no associated audio resource object'
            : sfx.audioResourceObject.type !== 'wav'
              ? `resource has type ${sfx.audioResourceObject.type}`
              : `audio context state is ${contextState}`;
          throw new Error(`[SFX] Play failed to start sound resource: ${sfx.resourceName} (${reason})`);
        }
        sfx.instanceId = instanceId;
      })
      .catch((error) => {
        console.error(`[SFX] Play failed for ${sfx.resourceName}:`, error);
        throw error;
      });

    return true;
  }

  /**
   * Stop a playing sound effect handle.
   * Lua usage: SFX.Stop(handle)
   */
  Stop() {
    const sfx = this._requireHandleStateByStack(2, 'Stop');
    const audioEngine = this._requireAudioEngine('Stop');
    if (typeof audioEngine.stopSound !== 'function') {
      throw new Error('[SFX] Stop requires audioEngine.stopSound');
    }

    if (sfx.instanceId) {
      audioEngine.stopSound(sfx.instanceId);
      sfx.instanceId = null;
    }
    return true;
  }

  /**
   * Check if a sound effect handle is currently playing.
   * Lua usage: SFX.IsPlaying(handle)
   */
  IsPlaying() {
    const sfx = this._requireHandleStateByStack(2, 'IsPlaying');
    const audioEngine = this._requireAudioEngine('IsPlaying');
    if (!sfx.instanceId) {
      return false;
    }
    return audioEngine.activeSounds instanceof Map && audioEngine.activeSounds.has(sfx.instanceId);
  }

  /**
   * Set volume for a sound effect handle.
   * Lua usage: SFX.SetVolume(handle, volume)
   */
  SetVolume() {
    const sfx = this._requireHandleStateByStack(2, 'SetVolume');
    const volume = this._optionalNumberArg([], 1, 1.0, 'SetVolume', 'volume');
    const volumeLevel = Math.max(0.0, Math.min(1.0, volume));

    sfx.volume = volumeLevel;
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