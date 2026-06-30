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
    this.musicHandles = new Map();
    this._nextHandle = 1;
    this._activeHandle = null;
  }

  reset() {
    if (this.audioEngine && typeof this.audioEngine.stopSong === 'function') {
      for (const music of this.musicHandles.values()) {
        this.audioEngine.stopSong(music.resourceId);
      }
    }

    this.musicHandles.clear();
    this._nextHandle = 1;
    this._activeHandle = null;
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

  _requirePlayableResource(resource, methodName, resourceName = resource?.fileName || resource?.name || 'unknown') {
    if (!resource) {
      throw new Error(`[Music] ${methodName} missing resource object`);
    }
    if (!resource.loaded || !resource.audioResource) {
      throw new Error(`Music asset not preloaded: ${resourceName}`);
    }

    const audioEngine = this._requireAudioEngine(methodName);
    const loadedResource = typeof audioEngine.getResource === 'function'
      ? audioEngine.getResource(resource.audioResource)
      : null;

    if (!loadedResource) {
      const loadedResourceIds = audioEngine?.resources instanceof Map
        ? Array.from(audioEngine.resources.keys())
        : [];
      throw new Error(`[Music] ${methodName} could not resolve audio resource for ${resourceName}: ${resource.audioResource}. Loaded audio resources: ${loadedResourceIds.join(', ') || '(none)'}`);
    }

    if (loadedResource.type !== 'mod') {
      throw new Error(`[Music] ${methodName} expected MOD resource for ${resourceName}, got ${loadedResource.type}`);
    }

    return { resource, loadedResource, audioEngine };
  }

  _requireResourceByName(resourceName, methodName) {
    if (!this.gameEmulator || typeof this.gameEmulator.GetResourcesByType !== 'function') {
      throw new Error(`[Music] ${methodName} requires an available game emulator resource API`);
    }

    const resources = this.gameEmulator.GetResourcesByType('MUSIC');
    const resource = resources.find((entry) => entry.fileName === resourceName);
    if (!resource) {
      throw new Error(`Music asset not found: ${resourceName}`);
    }
    if (!resource.loaded || !resource.audioResource) {
      throw new Error(`Music asset not preloaded: ${resourceName}`);
    }
    return resource;
  }

  _requireStackStringArg(stackIndex, methodName, argName) {
    const raw = this.luaState?.raw_tostring?.(stackIndex);
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new Error(`[Music] ${methodName} missing required string argument: ${argName}`);
    }
    return raw;
  }

  _requireStackHandleArg(stackIndex, methodName, argName = 'handle') {
    const raw = this.luaState?.raw_tostring?.(stackIndex);
    const handle = Number.parseInt(raw, 10);
    if (!Number.isFinite(handle)) {
      throw new Error(`[Music] ${methodName} missing or invalid ${argName}: ${raw}`);
    }
    return handle;
  }

  _requireHandleStateByStack(stackIndex, methodName) {
    const handle = this._requireStackHandleArg(stackIndex, methodName);
    const music = this.musicHandles.get(handle);
    if (!music) {
      throw new Error(`[Music] ${methodName} unknown handle: ${handle}`);
    }
    return music;
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

  _resolveHandlePlaybackState(music, methodName) {
    const resource = this._requireResourceByName(music.resourceName, methodName);
    const { resource: playableResource, loadedResource, audioEngine } = this._requirePlayableResource(resource, methodName, music.resourceName);

    music.resource = playableResource;
    music.resourceId = playableResource.audioResource;
    music.audioResourceObject = loadedResource;

    return { resource: playableResource, loadedResource, audioEngine };
  }

  _normalizeLuaArgs(argsLike) {
    const args = Array.from(argsLike || []);
    const hasBridgeReceiver = args.length > 1
      && (args[0] === null
      || args[0] === undefined
      || (typeof args[0] === 'object' && args[0] !== null));
    if (hasBridgeReceiver) {
      return args.slice(1);
    }
    return args;
  }

  _reportPlaybackFailure(music, error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorDetails = error instanceof Error && error.stack
      ? error.stack
      : errorMessage;

    if (this.gameEmulator && typeof this.gameEmulator.updateStatus === 'function') {
      this.gameEmulator.updateStatus(`Music playback error: ${errorMessage}`, 'error');
    }

    if (this.gameEmulator && typeof this.gameEmulator.showErrorPopup === 'function') {
      this.gameEmulator.showErrorPopup(
        'Music Playback Error',
        `Failed to play music asset "${music.resourceName}".`,
        errorDetails,
      );
    }
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
   * Create a music handle from a preloaded music asset name.
   * Lua usage: local handle = Music.Create("song_name")
   */
  Create(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const resourceName = this._requireStringArg(args, 0, 'Create', 'resourceName');
    const resource = this._requireResourceByName(resourceName, 'Create');
    this._requirePlayableResource(resource, 'Create', resourceName);

    const handle = this._nextHandle++;
    this.musicHandles.set(handle, {
      handle,
      resourceName,
      resource,
      resourceId: resource.audioResource,
      volume: 1.0,
      loop: true,
    });

    return handle;
  }

  /**
   * Destroy a music handle.
   * Lua usage: Music.Destroy(handle)
   */
  Destroy(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const music = this._requireHandleState(args, 0, 'Destroy');
    const audioEngine = this._requireAudioEngine('Destroy');
    audioEngine.stopSong(music.resourceId);
    if (this._activeHandle === music.handle) {
      this._activeHandle = null;
    }
    this.musicHandles.delete(music.handle);
    return true;
  }

  /**
   * Play a music handle using preloaded resources.
   * Lua usage: Music.Play(handle, volume, loop)
   */
  Play(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const music = this._requireHandleState(args, 0, 'Play');
    const volume = this._optionalNumberArg(args, 1, 1.0, 'Play', 'volume');
    const loop = this._optionalBooleanArg(args, 2, true, 'Play', 'loop');
    const { audioEngine } = this._resolveHandlePlaybackState(music, 'Play');

    if (this._activeHandle !== null && this._activeHandle !== music.handle) {
      const activeMusic = this.musicHandles.get(this._activeHandle);
      if (activeMusic) {
        activeMusic.isPlaying = false;
      }
    }

    music.volume = volume;
    music.loop = loop;
    music.isPlaying = true;
    this._activeHandle = music.handle;

    Promise.resolve(audioEngine.startSong(music.resourceId, volume, loop))
      .then((success) => {
        if (!success) {
          music.isPlaying = false;
          if (this._activeHandle === music.handle) {
            this._activeHandle = null;
          }
          const reason = typeof audioEngine.getLastSongStartError === 'function'
            ? audioEngine.getLastSongStartError()
            : audioEngine.lastSongStartError;
          throw new Error(`[Music] Play failed to start music resource: ${music.resourceName}${reason ? ` (${reason})` : ''}`);
        }
      })
      .catch((error) => {
        console.error(`[Music] Play failed for ${music.resourceName}:`, error);
        music.isPlaying = false;
        if (this._activeHandle === music.handle) {
          this._activeHandle = null;
        }
        this._reportPlaybackFailure(music, error);
      });

    return true;
  }

  /**
   * Stop a playing music handle.
   * Lua usage: Music.Stop(handle)
   */
  Stop(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const music = this._requireHandleState(args, 0, 'Stop');
    const { audioEngine } = this._resolveHandlePlaybackState(music, 'Stop');
    audioEngine.stopSong(music.resourceId);
    music.isPlaying = false;
    if (this._activeHandle === music.handle) {
      this._activeHandle = null;
    }
    return true;
  }

  /**
   * Check if a music handle is currently playing.
   * Lua usage: Music.IsPlaying(handle)
   */
  IsPlaying(...rawArgs) {
    const args = this._normalizeLuaArgs(rawArgs);
    const music = this._requireHandleState(args, 0, 'IsPlaying');
    const { audioEngine } = this._resolveHandlePlaybackState(music, 'IsPlaying');
    return audioEngine.activeSongs instanceof Map && audioEngine.activeSongs.has(music.resourceId);
  }
}

// Make the class available globally
window.LuaMusicExtensions = LuaMusicExtensions;
