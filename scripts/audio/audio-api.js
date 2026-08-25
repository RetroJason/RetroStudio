// audio-api.js
// High-level Audio Engine API for games and applications

/** PICO-8 mixes four sfx channels; a new sfx on a channel replaces the old one. */
const PICO8_SFX_CHANNELS = 4;

class AudioEngine extends EventTarget {
  constructor() {
    super(); // Enable event functionality
    this.initialized = false;
    this.audioContext = null;
    this.workletNode = null;
    this.modWorker = null;
    
    // Resource management
    this.resources = new Map(); // resourceId -> AudioResource
    this.nextResourceId = 1;
    this.currentResourceId = null; // Track currently playing resource
    this._loadingPromises = new Map(); // Track loading promises for awaitable operations
    
    // Volume control
    this.masterVolume = { left: 1.0, right: 1.0 };
    
    // Playback state
    this.activeSongs = new Map(); // resourceId -> PlaybackState
    this.activeSounds = new Map(); // instanceId -> PlaybackState
    this.nextInstanceId = 1;
    this.loadedModResourceId = null;
    this.lastSongStartError = null;

    // PICO-8 playback (music()/sfx())
    this.picoResourceProvider = null;
    this.picoMusic = null; // { number, node, gain }
    this.picoMusicCache = new Map(); // song number -> rendered samples

    this.isInitialized = false;
    this.initializationPromise = null;
  }

  _setSongStartError(message) {
    this.lastSongStartError = message;
    return false;
  }

  getLastSongStartError() {
    return this.lastSongStartError;
  }

  _isOutputMuted(requestedVolume = 1.0) {
    const volume = Number.isFinite(Number(requestedVolume)) ? Number(requestedVolume) : 1.0;
    return volume <= 0 || (this.masterVolume.left <= 0 && this.masterVolume.right <= 0);
  }

  async ensureInitialized() {
    if (this.isInitialized) {
      return true;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.initialize();

    try {
      return await this.initializationPromise;
    } finally {
      if (!this.isInitialized) {
        this.initializationPromise = null;
      }
    }
  }
  
  /**
   * Initialize the audio engine
   * @returns {Promise<boolean>} Success status
   */
  async initialize() {
    if (this.isInitialized) return true;
    
    try {
      console.log('[AudioEngine] Initializing...');
      
      // Create audio context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      console.log('[AudioEngine] AudioContext created, state:', this.audioContext.state, 'sampleRate:', this.audioContext.sampleRate);
      
      if (this.audioContext.state === 'suspended') {
        console.log('[AudioEngine] AudioContext is suspended - will resume on first user interaction');
      }
      
      // Load audio worklet
      await this.audioContext.audioWorklet.addModule('scripts/audio/mixer-worklet.js?v=3');
      this.workletNode = new AudioWorkletNode(this.audioContext, 'mixer-worklet');
      this.workletNode.connect(this.audioContext.destination);
      this.setMasterVolume(this.masterVolume.left, this.masterVolume.right);
      
      // Handle worklet messages
      this.workletNode.port.onmessage = (e) => {
        this._handleWorkletMessage(e);
      };
      
      // Create MOD worker
      this._createModWorker();
      
      this.isInitialized = true;
      console.log('[AudioEngine] Initialized successfully');
      return true;
    } catch (error) {
      console.error('[AudioEngine] Initialization failed:', error);
      return false;
    }
  }
  
  /**
   * Load an audio resource
   * @param {ArrayBuffer} data - Audio file data
   * @param {string} type - 'mod' or 'wav'
   * @param {string} name - Optional name for the resource
   * @returns {Promise<string>} Resource ID
   */
  async loadResource(data, type, name = null) {
    const initialized = await this.ensureInitialized();
    if (!initialized) {
      throw new Error('AudioEngine failed to initialize');
    }
    
    const resourceId = `res_${this.nextResourceId++}`;
    
    try {
      let resource;
      
      if (type === 'mod') {
        resource = await this._loadModResource(data, name || `MOD_${resourceId}`, resourceId);
        // Resource is already in the Map from _loadModResource
      } else if (type === 'wav') {
        resource = await this._loadWavResource(data, name || `WAV_${resourceId}`);
        resource.id = resourceId;
        resource.type = type;
        this.resources.set(resourceId, resource);
      } else if (type === 'sfx') {
        resource = await this._loadSfxResource(data, name || `SFX_${resourceId}`);
        resource.id = resourceId;
        resource.type = type;
        this.resources.set(resourceId, resource);
      } else {
        throw new Error(`Unsupported audio type: ${type}`);
      }
      
      console.log(`[AudioEngine] Loaded ${type} resource: ${resourceId} (${resource.name})`);
      
      // Emit event when resource is loaded (with duration for MOD files)
      this.dispatchEvent(new CustomEvent('resourceLoaded', {
        detail: { resourceId, resource, type }
      }));
      
      return resourceId;
    } catch (error) {
      console.error(`[AudioEngine] Failed to load ${type} resource:`, error);
      throw error;
    }
  }
  
  /**
   * Unload an audio resource
   * @param {string} resourceId - Resource ID to unload
   * @returns {boolean} Success status
   */
  unloadResource(resourceId) {
    if (!this.resources.has(resourceId)) {
      console.warn(`[AudioEngine] Resource not found: ${resourceId}`);
      return false;
    }
    
    // Stop any active playback
    this.stopSong(resourceId);
    this.stopAllSounds(resourceId);
    
    // Remove resource
    this.resources.delete(resourceId);
    console.log(`[AudioEngine] Unloaded resource: ${resourceId}`);
    return true;
  }
  
  /**
   * Get a resource object by ID
   * @param {string} resourceId - Resource ID
   * @returns {AudioResource|null} Resource object or null if not found
   */
  getResource(resourceId) {
    return this.resources.get(resourceId) || null;
  }
  
  /**
   * Start playing a song (background music)
   * @param {string} resourceId - Resource ID
   * @param {number} volume - Volume (0.0 to 1.0+)
   * @param {boolean} loop - Whether to loop
   * @returns {boolean} Success status
   */
  async startSong(resourceId, volume = 1.0, loop = true) {
    this.lastSongStartError = null;

    const initialized = await this.ensureInitialized();
    if (!initialized) {
      return this._setSongStartError('audio engine initialization failed');
    }

    const resource = this.resources.get(resourceId);
    if (!resource) {
      console.warn(`[AudioEngine] Song resource not found: ${resourceId}`);
      return this._setSongStartError(`song resource not found: ${resourceId}`);
    }
    
    if (resource.type !== 'mod') {
      console.warn(`[AudioEngine] Resource ${resourceId} is not a song (MOD) type`);
      return this._setSongStartError(`resource ${resourceId} is not a MOD song (got ${resource.type})`);
    }
    
    // Resume on-demand so playback does not depend on caller-specific resume logic.
    if (this.audioContext.state === 'suspended' && this._isOutputMuted(volume)) {
      console.log('[AudioEngine] AudioContext suspended; starting muted song without requesting browser audio playback');
    } else if (this.audioContext.state === 'suspended') {
      console.log('[AudioEngine] AudioContext suspended, resuming before song playback');
      try {
        await this.audioContext.resume();
      } catch (error) {
        console.error('[AudioEngine] Failed to resume AudioContext before song playback:', error);
        return this._setSongStartError(`failed to resume AudioContext: ${error.message}`);
      }
      if (this.audioContext.state === 'suspended') {
        console.warn('[AudioEngine] AudioContext remained suspended after resume attempt');
        return this._setSongStartError('AudioContext remained suspended after resume attempt');
      }
    }

    const canReuseLoadedMod = this.loadedModResourceId === resourceId;

    // Keep one active MOD stream, while allowing WAV sound effects to mix over it.
    for (const activeResourceId of this.activeSongs.keys()) {
      this.stopSong(activeResourceId);
    }

    this.currentResourceId = null;

    if (this.workletNode) {
      this.workletNode.port.postMessage({ 
        type: 'stop-stream', 
        streamId: 'mod-stream' 
      });
    }

    if (!canReuseLoadedMod && this.modWorker) {
      this.modWorker.postMessage({ type: 'stop-all' });
      this.loadedModResourceId = null;
    }
    
    try {
      // Track the current resource being played
      this.currentResourceId = resourceId;

      this.activeSongs.set(resourceId, {
        resourceId,
        volume,
        loop,
        isPlaying: true
      });

      if (canReuseLoadedMod) {
        this.workletNode.port.postMessage({ type: 'start-playing' });
        this.workletNode.port.postMessage({ type: 'request-pcm' });
        this.modWorker.postMessage({ type: 'get-pcm', frames: 16384 });
      } else {
        this.modWorker.postMessage({
          type: 'load-mod',
          arrayBuffer: resource.data,
          sampleRate: this.audioContext.sampleRate,
          analysisOnly: false,
          resourceId
        });
      }
      
      console.log(`[AudioEngine] Started song: ${resourceId} (volume: ${volume})`);
      return true;
    } catch (error) {
      console.error(`[AudioEngine] Failed to start song ${resourceId}:`, error);
      return this._setSongStartError(`failed to start song ${resourceId}: ${error.message}`);
    }
  }
  
  /**
   * Pause/resume a song
   * @param {string} resourceId - Resource ID
   * @param {boolean} pause - True to pause, false to resume
   * @returns {boolean} Success status
   */
  pauseSong(resourceId, pause = true) {
    const playback = this.activeSongs.get(resourceId);
    if (!playback) {
      console.warn(`[AudioEngine] No active song: ${resourceId}`);
      return false;
    }
    
    if (pause) {
      this.workletNode.port.postMessage({ 
        type: 'stop-stream', 
        streamId: 'mod-stream' 
      });
      playback.isPlaying = false;
    } else {
      // Resume - restart the PCM request cycle
      playback.isPlaying = true;
      
      // Restart the worklet playback cycle
      this.workletNode.port.postMessage({ type: 'start-playing' });
      this.workletNode.port.postMessage({ type: 'request-pcm' });
      
      // Request initial PCM data from MOD worker to kickstart the cycle
      this.modWorker.postMessage({ type: 'get-pcm', frames: 16384 });
    }
    
    console.log(`[AudioEngine] ${pause ? 'Paused' : 'Resumed'} song: ${resourceId}`);
    return true;
  }
  
  /**
   * Stop a song
   * @param {string} resourceId - Resource ID
   * @returns {boolean} Success status
   */
  stopSong(resourceId) {
    const playback = this.activeSongs.get(resourceId);
    if (!playback) return false;
    
    this.workletNode.port.postMessage({ 
      type: 'stop-stream', 
      streamId: 'mod-stream' 
    });
    
    // Clear current resource if it matches
    if (this.currentResourceId === resourceId) {
      this.currentResourceId = null;
    }
    
    this.activeSongs.delete(resourceId);
    console.log(`[AudioEngine] Stopped song: ${resourceId}`);
    return true;
  }
  
  /**
   * Start playing a sound effect
   * @param {string} resourceId - Resource ID
   * @param {number} volume - Volume (0.0 to 1.0+)
   * @returns {string|null} Instance ID for the playing sound, or null on failure
   */
  async startSound(resourceOrId, volume = 1.0, options = {}) {
    const initialized = await this.ensureInitialized();
    if (!initialized) {
      return null;
    }

    const resource = typeof resourceOrId === 'string'
      ? this.resources.get(resourceOrId)
      : resourceOrId;
    const resourceId = typeof resourceOrId === 'string'
      ? resourceOrId
      : (resourceOrId?.id || 'detached_wav_resource');
    if (!resource) {
      console.warn(`[AudioEngine] Sound resource not found: ${resourceId}`);
      return null;
    }
    
    if (resource.type !== 'wav' && resource.type !== 'sfx') {
      console.warn(`[AudioEngine] Resource ${resourceId} is not a sound (WAV) type`);
      return null;
    }

    // A sound effect is stored as its definition and synthesized the first time
    // it is actually played.
    if (!resource.audioBuffer) {
      try {
        this._synthesizeSfxBuffer(resource);
      } catch (error) {
        console.error(`[AudioEngine] Failed to synthesize sound ${resourceId}:`, error);
        return null;
      }
    }
    
    // Resume on-demand so playback does not depend on caller-specific resume logic.
    if (this.audioContext.state === 'suspended' && this._isOutputMuted(volume)) {
      console.log('[AudioEngine] AudioContext suspended; starting muted sound without requesting browser audio playback');
    } else if (this.audioContext.state === 'suspended') {
      console.log('[AudioEngine] AudioContext suspended, resuming before sound playback');
      try {
        await this.audioContext.resume();
      } catch (error) {
        console.error('[AudioEngine] Failed to resume AudioContext before sound playback:', error);
        return null;
      }
      if (this.audioContext.state === 'suspended') {
        console.warn('[AudioEngine] AudioContext remained suspended after resume attempt');
        return null;
      }
    }

    console.log(`[AudioEngine] Starting sound ${resourceId}, channels: ${resource.audioBuffer.numberOfChannels}, duration: ${resource.duration}s`);
    
    try {
      const instanceId = `snd_${this.nextInstanceId++}`;
      
      // Prepare audio data with volume
      const channels = [];
      for (let ch = 0; ch < resource.audioBuffer.numberOfChannels; ch++) {
        const originalData = resource.audioBuffer.getChannelData(ch);
        const volumeAdjusted = new Float32Array(originalData.length);
        for (let i = 0; i < originalData.length; i++) {
          volumeAdjusted[i] = originalData[i] * volume;
        }
        channels.push(volumeAdjusted);
      }
      
      console.log(`[AudioEngine] Prepared ${channels.length} channels, ${channels[0].length} samples each`);
      
      this.workletNode.port.postMessage({ type: 'start-playing' });

      // Send to mixer as one-shot
      this.workletNode.port.postMessage({
        type: 'play',
        instanceId,
        channels: channels,
        sampleRate: resource.audioBuffer.sampleRate,
        loop: options.loop || null
      });
      
      this.activeSounds.set(instanceId, {
        resourceId,
        instanceId,
        volume,
        startTime: Date.now()
      });
      
      console.log(`[AudioEngine] Started sound: ${resourceId} (instance: ${instanceId}, volume: ${volume})`);
      return instanceId;
    } catch (error) {
      console.error(`[AudioEngine] Failed to start sound ${resourceId}:`, error);
      return null;
    }
  }
  
  /**
   * Stop a specific sound instance
   * @param {string} instanceId - Instance ID returned by startSound
   * @returns {boolean} Success status
   */
  stopSound(instanceId) {
    if (!this.activeSounds.has(instanceId)) {
      return false;
    }
    
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'stop-sound',
        instanceId
      });
    }
    
    this.activeSounds.delete(instanceId);
    console.log(`[AudioEngine] Stopped sound instance: ${instanceId}`);
    return true;
  }
  
  /**
   * Stop all sounds from a specific resource
   * @param {string} resourceId - Resource ID
   * @returns {number} Number of sounds stopped
   */
  stopAllSounds(resourceId) {
    let count = 0;
    for (const [instanceId, playback] of Array.from(this.activeSounds.entries())) {
      if (playback.resourceId === resourceId) {
        this.stopSound(instanceId);
        count++;
      }
    }
    
    if (count > 0) {
      console.log(`[AudioEngine] Stopped ${count} sound instances for resource: ${resourceId}`);
    }
    return count;
  }
  
  /**
   * Set master volume
   * @param {number} left - Left channel volume (0.0 to 1.0+)
   * @param {number} right - Right channel volume (0.0 to 1.0+)
   */
  setMasterVolume(left, right = null) {
    this.masterVolume.left = Math.max(0, left);
    this.masterVolume.right = Math.max(0, right !== null ? right : left);

    if (!this.workletNode) {
      return;
    }
    
    // Send to worklet
    const avgVolume = (this.masterVolume.left + this.masterVolume.right) / 2;
    this.workletNode.port.postMessage({ 
      type: 'set-volume', 
      volume: avgVolume 
    });
    
    console.log(`[AudioEngine] Set master volume: L=${this.masterVolume.left}, R=${this.masterVolume.right}`);
  }
  
  /**
   * Set volume for a specific song
   * @param {string} resourceId - Resource ID
   * @param {number} volume - Volume (0.0 to 1.0+)
   * @returns {boolean} Success status
   */
  setSongVolume(resourceId, volume) {
    const playback = this.activeSongs.get(resourceId);
    if (!playback) {
      console.warn(`[AudioEngine] No active song: ${resourceId}`);
      return false;
    }
    
    playback.volume = Math.max(0, volume);
    
    // Send volume update to mixer worklet
    if (this.workletNode) {
      this.workletNode.port.postMessage({ 
        type: 'set-volume', 
        volume: volume 
      });
      console.log(`[AudioEngine] Set song volume: ${resourceId} = ${volume}`);
    }
    
    return true;
  }
  
  // Private methods
  
  _createModWorker() {
    this.modWorker = new Worker('scripts/audio/openmpt-integration.js?v=2');
    this.modWorker.onmessage = (e) => {
      this._handleModWorkerMessage(e);
    };
    this.modWorker.onerror = (error) => {
      console.error('[AudioEngine] MOD Worker Error:', error);
    };
    console.log('[AudioEngine] MOD Worker created');
  }
  
  _handleModWorkerMessage(e) {
    if (e.data.type === 'log') {
      // MOD Worker log silenced (uncomment for debug): console.log('[MOD Worker]', e.data.message);
    } else if (e.data.type === 'pcm') {
      // Forward PCM data to mixer
      if (e.data.frames > 0) {
        this.workletNode.port.postMessage({
          type: 'play',
          streamId: 'mod-stream',
          channels: [e.data.left, e.data.right],
          sampleRate: this.audioContext.sampleRate
        });
      }
      // Don't automatically request next block - let the mixer worklet request when needed
    } else if (e.data.type === 'song-ended') {
      // MOD playback has ended - clean up the stream
      console.log('[AudioEngine] MOD song ended, cleaning up stream');
      this.workletNode.port.postMessage({
        type: 'stop-stream',
        streamId: 'mod-stream'
      });
    } else if (e.data.type === 'mod-loaded') {
      console.log('[AudioEngine] MOD loaded successfully, title:', e.data.title, 'duration:', e.data.duration);
      const messageResourceId = e.data.resourceId || null;
      if (messageResourceId) {
        this.loadedModResourceId = messageResourceId;
      }

      if (e.data.analysisOnly) {
        const matchingResource = messageResourceId ? this.resources.get(messageResourceId) : null;
        if (!matchingResource || matchingResource.type !== 'mod') {
          console.warn('[AudioEngine] Analysis result did not match a MOD resource:', messageResourceId);
          return;
        }

        matchingResource.duration = e.data.duration;
        matchingResource.title = e.data.title;
        console.log('[AudioEngine] Updated analyzed MOD resource', messageResourceId, 'with duration:', e.data.duration);

        const promiseData = this._loadingPromises.get(messageResourceId);
        if (promiseData) {
          console.log('[AudioEngine] Resolving loading promise for:', messageResourceId);
          clearTimeout(promiseData.timeoutId);
          this._loadingPromises.delete(messageResourceId);
          promiseData.resolve();
        }

        this.dispatchEvent(new CustomEvent('resourceUpdated', {
          detail: { resourceId: messageResourceId, property: 'duration', value: e.data.duration }
        }));
        return;
      }

      if (!messageResourceId || this.currentResourceId !== messageResourceId || !this.activeSongs.has(messageResourceId)) {
        console.warn('[AudioEngine] Ignoring stale MOD playback load for resource:', messageResourceId);
        return;
      }

      const resource = this.resources.get(messageResourceId);
      if (resource && resource.type === 'mod') {
        resource.duration = e.data.duration;
        resource.title = e.data.title;
      }

      this.workletNode.port.postMessage({ type: 'start-playing' });
      this.workletNode.port.postMessage({ type: 'request-pcm' });
      this.modWorker.postMessage({ type: 'get-pcm', frames: 16384 });
    } else if (e.data.type === 'error') {
      console.error('[AudioEngine] MOD Worker Error:', e.data.message);
    }
  }
  
  _handleWorkletMessage(e) {
    if (e.data.type === 'request-pcm') {
      // Worklet wants more PCM data
      if (this.modWorker && this.activeSongs.size > 0) {
        const requestedFrames = Number.isFinite(e.data.frames) ? e.data.frames : 16384;
        this.modWorker.postMessage({ type: 'get-pcm', frames: Math.max(16384, requestedFrames) });
      }
    }
  }
  
  async _loadModResource(data, name, resourceId) {
    const resource = {
      name,
      data: data.slice(), // Copy the data
      duration: null // Will be set when analyzed
    };
    
    // Add resource metadata immediately
    resource.id = resourceId;
    resource.type = 'mod';
    
    // Add to the resources Map immediately so analysis can find it
    this.resources.set(resourceId, resource);
    console.log(`[AudioEngine] Added MOD resource to Map: ${resourceId}`);
    
    // Pre-analyze the MOD file to get duration without starting playback
    // Wait for analysis to complete before returning
    await this._analyzeModFile(data, resource, resourceId);
    
    return resource;
  }
  
  async _analyzeModFile(data, resource, resourceId) {
    // Send MOD data to worker for analysis only (not playback)
    console.log('[AudioEngine] Analyzing MOD file for duration...');
    
    // Create a promise that resolves when analysis completes
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        console.warn(`[AudioEngine] MOD analysis timeout for ${resourceId} after 30 seconds`);
        this._loadingPromises.delete(resourceId);
        reject(new Error('MOD analysis timeout'));
      }, 30000); // Increased to 30 second timeout for multiple files
      
      // Store the resolve function to call when analysis completes
      this._loadingPromises.set(resourceId, { resolve, reject, timeoutId, resourceId });
      
      console.log(`[AudioEngine] Queuing MOD analysis for ${resourceId}, pending analyses: ${this._loadingPromises.size}`);
      
      // Use the same 'load-mod' command but mark this as analysis-only
      this.modWorker.postMessage({
        type: 'load-mod',
        arrayBuffer: data,
        sampleRate: this.audioContext.sampleRate,
        analysisOnly: true, // Flag to indicate this is just for getting duration
        resourceId: resourceId // Add resource ID to help with promise resolution
      });
    });
  }
  
  async _loadWavResource(data, name) {
    const audioBuffer = await this.audioContext.decodeAudioData(data.slice());
    return {
      name,
      data: data.slice(),
      audioBuffer,
      duration: audioBuffer.duration
    };
  }

  /**
   * Build a playable resource from a binary sound effect definition.
   *
   * The build used to ship these as rendered WAVs, which cost 88-220KB each for
   * a definition of a few dozen bytes; a cart with a full sfx bank paid
   * megabytes for it. Only the definition is loaded here.
   *
   * Nothing is synthesized until the effect is first played. That matters more
   * than it sounds: PICO-8 carts routinely use spare sfx slots as flat storage
   * for level data, and those slots decode to minutes of noise that is never
   * played. Rendering the bank up front cost POOM 268MB of audio buffers for
   * sound it never makes.
   */
  async _loadSfxResource(data, name) {
    const SfxBinary = (typeof window !== 'undefined' && window.SfxBinary) || null;
    if (!SfxBinary) throw new Error('SfxBinary module not loaded');

    const decoded = SfxBinary.decode(data);
    const resource = {
      name,
      // The definition, not the audio: a few dozen bytes instead of a WAV.
      data: data.slice(),
      definition: decoded,
      audioBuffer: null,
      duration: 0,
      // Loop points come from the slot's own markers, so _wavLoopPoints has
      // nothing to parse - and must not try, since there is no smpl chunk.
      _loopPoints: null
    };

    if (decoded.format === 'pico') {
      const PicoAudio = (typeof window !== 'undefined' && window.PicoAudio) || null;
      if (!PicoAudio) throw new Error('PicoAudio module not loaded');
      // Length and loop points follow from the slot's step count and speed, so
      // they are known without rendering a single sample.
      resource.duration = PicoAudio.slotDuration(decoded.slot);
      resource._loopPoints = this._picoLoopPoints(decoded.slot, this.audioContext.sampleRate);
    }

    return resource;
  }

  /** Render a deferred sound effect definition into its AudioBuffer. */
  _synthesizeSfxBuffer(resource) {
    const decoded = resource.definition;
    if (!decoded) throw new Error('Sound effect resource has no definition');

    const rendered = decoded.format === 'pico'
      ? this._renderPicoSfx(decoded.slot, this.audioContext.sampleRate)
      : this._renderNativeSfx(decoded.parameters);

    const audioBuffer = this.audioContext.createBuffer(1, Math.max(1, rendered.samples.length), rendered.sampleRate);
    audioBuffer.getChannelData(0).set(rendered.samples);

    resource.audioBuffer = audioBuffer;
    resource.duration = audioBuffer.duration;
    return audioBuffer;
  }

  _renderPicoSfx(slot, sampleRate) {
    const PicoAudio = window.PicoAudio;
    // Gain 1: a standalone sfx() is not mixed with three other channels, so it
    // renders at PICO-8's own amplitude rather than the per-channel level.
    return {
      samples: PicoAudio.renderSfxSlot(slot, sampleRate, PicoAudio.DEFAULT_TICK_RATE, 1),
      sampleRate
    };
  }

  /**
   * Loop points in sample frames, or null for a one-shot.
   *
   * The cart's loop end is exclusive; _wavLoopPoints reports an inclusive last
   * frame, so it lands one frame before the excluded step.
   */
  _picoLoopPoints(slot, sampleRate) {
    const PicoAudio = window.PicoAudio;
    if (!PicoAudio.slotIsLooping(slot)) return null;

    const stepSamples = PicoAudio.slotStepSamples(slot, sampleRate, PicoAudio.DEFAULT_TICK_RATE);
    const total = stepSamples * PicoAudio.slotPlayLength(PicoAudio.normalizeSlot(slot));
    const start = slot.loopStart * stepSamples;
    const end = Math.min(slot.loopEnd * stepSamples, total) - 1;
    return end > start ? { start, end } : null;
  }

  _renderNativeSfx(parameters) {
    const jsfxr = (typeof window !== 'undefined' && window.jsfxr) || null;
    if (!jsfxr || !jsfxr.Params || !jsfxr.SoundEffect) {
      throw new Error('jsfxr library not loaded correctly');
    }

    const params = new jsfxr.Params();
    Object.keys(parameters).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(params, key)) params[key] = parameters[key];
    });

    const soundEffect = new jsfxr.SoundEffect(params);
    return {
      samples: soundEffect.getRawBuffer().normalized,
      // SFXR picks its own rate; the worklet resamples, exactly as it did for
      // the WAV this replaces.
      sampleRate: soundEffect.sampleRate || 44100
    };
  }

  /**
   * Stop all audio playback and clear all buffers
   * This ensures complete silence and prevents static from paused audio
   */
  stopAllAudio() {
    console.log('[AudioEngine] Stopping ALL audio and clearing buffers...');
    
    try {
      // Stop all songs
      for (const resourceId of this.activeSongs.keys()) {
        this.stopSong(resourceId);
      }
      
      // Stop all sound instances
      for (const instanceId of this.activeSounds.keys()) {
        this.stopSound(instanceId);
      }

      // Stop PICO-8 music, which plays outside the mixer worklet
      this.stopPicoMusic(0);

      // Clear current resource
      this.currentResourceId = null;
      this.loadedModResourceId = null;
      
      // Send comprehensive stop message to worklet
      if (this.workletNode) {
        this.workletNode.port.postMessage({ 
          type: 'stop-all-audio'
        });
      }
      
      // Stop MOD worker and clear any ongoing operations
      if (this.modWorker) {
        this.modWorker.postMessage({ type: 'stop-all' });
      }
      
      console.log('[AudioEngine] All audio stopped and buffers cleared');
      return true;
    } catch (error) {
      console.error('[AudioEngine] Error stopping all audio:', error);
      return false;
    }
  }

  /**
   * Emergency audio cleanup - disconnects audio nodes to ensure silence
   */
  emergencyAudioStop() {
    console.log('[AudioEngine] Emergency audio stop - disconnecting audio nodes...');
    
    try {
      // Disconnect worklet from destination
      if (this.workletNode) {
        this.workletNode.disconnect();
        // Reconnect after a brief moment to restore audio capability
        setTimeout(() => {
          if (this.workletNode && this.audioContext) {
            this.workletNode.connect(this.audioContext.destination);
            console.log('[AudioEngine] Audio nodes reconnected');
          }
        }, 100);
      }
      
      // Clear all active tracking
      this.stopPicoMusic(0);
      this.activeSongs.clear();
      this.activeSounds.clear();
      this.currentResourceId = null;
      this.loadedModResourceId = null;
      
      return true;
    } catch (error) {
      console.error('[AudioEngine] Error in emergency audio stop:', error);
      return false;
    }
  }

  // ============================================================
  // PICO-8 playback (music()/sfx() from scripts/lua/pico8.js)
  // ============================================================

  /**
   * Supply the lookup used to turn PICO-8 numbers into studio resources.
   * @param {{getMusicSource?: function(number): (string|object|null),
   *          getSfxResourceId?: function(number): (string|null)}} provider
   */
  setPicoResourceProvider(provider) {
    this.picoResourceProvider = provider || null;
  }

  /**
   * Play an imported PICO-8 song (`.p8mus`).
   * @param {number} n - Song number, or -1 to stop.
   * @param {number} fade - Fade in/out length in milliseconds.
   * @param {number} mask - Reserved channel mask (unused; PICO-8 compatibility).
   * @returns {Promise<boolean>} Success status
   */
  async playMusic(n, fade = 0, mask = 0xFF) {
    if (n < 0) {
      this.stopPicoMusic(fade);
      return true;
    }

    const source = this.picoResourceProvider?.getMusicSource?.(n);
    if (!source) {
      console.warn(`[AudioEngine] No PICO-8 music resource for music(${n})`);
      return false;
    }

    if (typeof PicoAudio === 'undefined') {
      console.warn('[AudioEngine] PicoAudio module is not loaded; music() ignored');
      return false;
    }

    const initialized = await this.ensureInitialized();
    if (!initialized) {
      return false;
    }

    if (this.audioContext.state === 'suspended' && !this._isOutputMuted()) {
      try {
        await this.audioContext.resume();
      } catch (error) {
        console.error('[AudioEngine] Failed to resume AudioContext before PICO-8 music:', error);
        return false;
      }
    }

    let rendered;
    try {
      rendered = this._renderPicoMusic(n, source);
    } catch (error) {
      console.error(`[AudioEngine] Failed to render PICO-8 music ${n}:`, error);
      return false;
    }

    if (!rendered || !rendered.samples.length) {
      console.warn(`[AudioEngine] PICO-8 music ${n} rendered to silence`);
      return false;
    }

    this.stopPicoMusic(0);

    // Starting a song takes the channels its first pattern needs away from
    // sfx(). Skipping this leaves a long sfx sounding underneath the music:
    // dinky_kong's title fires a 1.2s noise and a short tonal sfx, then starts
    // a song on the noise's channel, so on hardware only the tonal one is
    // heard. Rendering the song as one pre-mixed buffer loses the per-channel
    // arbitration, so it has to be applied here instead.
    this._stopPicoSfxOnChannels(rendered.startChannels);

    const buffer = this.audioContext.createBuffer(1, rendered.samples.length, rendered.sampleRate);
    buffer.copyToChannel(rendered.samples, 0);

    const node = this.audioContext.createBufferSource();
    node.buffer = buffer;
    if (rendered.loopStartSample !== null) {
      node.loop = true;
      node.loopStart = rendered.loopStartSample / rendered.sampleRate;
      node.loopEnd = buffer.duration;
    }

    const gain = this.audioContext.createGain();
    const target = this._picoMasterGain();
    const fadeSeconds = Math.max(0, Number(fade) || 0) / 1000;
    if (fadeSeconds > 0) {
      gain.gain.setValueAtTime(0, this.audioContext.currentTime);
      gain.gain.linearRampToValueAtTime(target, this.audioContext.currentTime + fadeSeconds);
    } else {
      gain.gain.value = target;
    }

    node.connect(gain);
    gain.connect(this.audioContext.destination);

    node.onended = () => {
      if (this.picoMusic && this.picoMusic.node === node) {
        this.picoMusic = null;
      }
    };

    this.picoMusic = { number: n, node, gain };
    node.start();
    console.log(`[AudioEngine] Started PICO-8 music ${n} (loop: ${node.loop})`);
    return true;
  }

  /**
   * Stop the currently playing PICO-8 song.
   * @param {number} fade - Fade out length in milliseconds.
   * @returns {boolean} Success status
   */
  stopPicoMusic(fade = 0) {
    const playing = this.picoMusic;
    if (!playing) return false;

    this.picoMusic = null;
    playing.node.onended = null;

    const fadeSeconds = Math.max(0, Number(fade) || 0) / 1000;
    const stopAt = this.audioContext.currentTime + fadeSeconds;

    if (fadeSeconds > 0) {
      playing.gain.gain.setValueAtTime(playing.gain.gain.value, this.audioContext.currentTime);
      playing.gain.gain.linearRampToValueAtTime(0, stopAt);
    }

    try {
      playing.node.stop(stopAt);
    } catch (_) {
      // Already stopped.
    }

    // Release the graph once playback has actually finished.
    setTimeout(() => {
      playing.node.disconnect();
      playing.gain.disconnect();
    }, Math.ceil(fadeSeconds * 1000) + 50);

    return true;
  }

  /**
   * Play an imported PICO-8 sound effect (`.sfx`, built to WAV).
   * @param {number} n - SFX number, or negative to stop.
   * @param {number} channel - PICO-8 channel 0-3, or negative to auto-assign.
   * @param {number} offset - Reserved (PICO-8 compatibility).
   * @param {number} length - Reserved (PICO-8 compatibility).
   * @returns {Promise<string|null>} Instance ID, or null on failure
   */
  async playSfx(n, channel = -1, offset = 0, length = 32) {
    if (!this._picoChannels) {
      this._picoChannels = new Map();
    }

    const requested = Number.isFinite(channel) ? Math.floor(channel) : -1;

    if (n < 0) {
      // sfx(-1) stops the given channel, sfx(-2) releases a looping sfx.
      if (requested >= 0) {
        this._releasePicoChannel(requested);
        return null;
      }
      for (const [instanceId, playback] of Array.from(this.activeSounds.entries())) {
        if (playback.isPicoSfx) {
          this.stopSound(instanceId);
        }
      }
      // Flag reservations still starting, so they stop instead of coming back
      // to life on a channel map that has already been cleared.
      this._picoChannels.forEach(entry => { entry.cancelled = true; });
      this._picoChannels.clear();
      return null;
    }

    const resourceId = this.picoResourceProvider?.getSfxResourceId?.(n);
    if (!resourceId) {
      console.warn(`[AudioEngine] No PICO-8 sfx resource for sfx(${n})`);
      return null;
    }

    let target = requested >= 0 ? Math.min(requested, PICO8_SFX_CHANNELS - 1) : -1;
    if (target < 0) {
      target = 0;
      while (target < PICO8_SFX_CHANNELS - 1 && this._picoChannelPlaying(target)) {
        target++;
      }
    }

    // Carts hold a continuous sound (engine hum, wind) by re-issuing the same
    // sfx on the same channel every frame. Restarting it each time would stack
    // one overlapping one-shot per frame, so let the existing playback run.
    const playing = this._picoChannelPlaying(target);
    if (playing && playing.sfxNumber === n) {
      return playing.instanceId;
    }
    if (playing) {
      this._releasePicoChannel(target);
    }

    const loop = this._wavLoopPoints(resourceId);

    // Claim the channel now, before the await. Lua cannot await, so a cart line
    // like `sfx"1" sfx"9" music"24"` runs all three synchronously; a channel
    // claimed only once startSound resolves is still free to the next call, so
    // every sfx in the frame picks channel 0 and the last one overwrites the
    // rest. The overwritten sounds keep playing with nothing tracking them, so
    // neither a later sfx() nor music() can ever stop them.
    const reservation = {
      instanceId: null,
      sfxNumber: n,
      // A looping sfx runs until something replaces it, so it must never be
      // aged out; a one-shot has to be, because the worklet never reports
      // completion back to us.
      endsAt: loop ? 0 : Date.now() + this._picoSfxDurationMs(resourceId),
      cancelled: false,
    };
    this._picoChannels.set(target, reservation);

    const instanceId = await this.startSound(resourceId, this._picoMasterGain(), { loop });

    if (!instanceId) {
      if (this._picoChannels.get(target) === reservation) {
        this._picoChannels.delete(target);
      }
      return null;
    }

    const playback = this.activeSounds.get(instanceId);
    if (playback) playback.isPicoSfx = true;

    // Something took this channel while the sound was starting, so this
    // playback is already obsolete - stop it rather than leaving it untracked.
    if (reservation.cancelled || this._picoChannels.get(target) !== reservation) {
      this.stopSound(instanceId);
      return null;
    }

    reservation.instanceId = instanceId;
    return instanceId;
  }

  /**
   * Free a PICO-8 channel, stopping whatever holds it.
   *
   * A reservation that has not finished starting is flagged rather than
   * stopped, because there is no instance to stop yet; playSfx sees the flag
   * when startSound resolves and drops the sound then.
   */
  _releasePicoChannel(channel) {
    const entry = this._picoChannels?.get(channel);
    if (!entry) return;
    entry.cancelled = true;
    if (entry.instanceId) this.stopSound(entry.instanceId);
    this._picoChannels.delete(channel);
  }

  /**
   * Current playback on a PICO-8 channel, or null when it is free.
   *
   * The mixer worklet never reports completion, so playback is aged out using
   * the resource duration; without this the channel would stay busy forever.
   */
  _picoChannelPlaying(channel) {
    const entry = this._picoChannels?.get(channel);
    if (!entry) return null;

    // Still starting: busy, so the next sfx() this frame picks another channel.
    if (!entry.instanceId) return entry;

    if (!this.activeSounds.has(entry.instanceId)) {
      this._picoChannels.delete(channel);
      return null;
    }
    if (entry.endsAt && Date.now() >= entry.endsAt) {
      this.stopSound(entry.instanceId);
      this._picoChannels.delete(channel);
      return null;
    }
    return entry;
  }

  /**
   * Release PICO-8 sfx channels, the way starting a song does.
   */
  _stopPicoSfxOnChannels(channels) {
    if (!this._picoChannels || !Array.isArray(channels)) return;
    for (const channel of channels) {
      this._releasePicoChannel(channel);
    }
  }

  _picoSfxDurationMs(resourceId) {
    const resource = this.resources.get(resourceId);
    // This is read before the sound starts, to decide when the channel ages
    // out, so it has to work for a definition that has not been synthesized
    // yet. A PICO-8 slot's length follows from its step count and speed.
    const seconds = resource?.audioBuffer?.duration ?? resource?.duration;
    return Number.isFinite(seconds) ? seconds * 1000 : 0;
  }

  /**
   * Loop points from a WAV's standard `smpl` chunk, in sample frames, or null
   * when the file is a plain one-shot. The build system writes this chunk for
   * PICO-8 SFX slots whose cart loop end is past their loop start.
   */
  _wavLoopPoints(resourceId) {
    const resource = this.resources.get(resourceId);
    if (!resource) return null;
    if (resource._loopPoints !== undefined) return resource._loopPoints;

    resource._loopPoints = null;
    const data = resource.data;
    if (data instanceof ArrayBuffer && data.byteLength >= 12) {
      const view = new DataView(data);
      const bytes = new Uint8Array(data);
      let offset = 12;
      while (offset + 8 <= bytes.length) {
        const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
        const size = view.getUint32(offset + 4, true);
        if (id === 'smpl' && size >= 60 && offset + 8 + size <= bytes.length) {
          const body = offset + 8;
          if (view.getUint32(body + 28, true) >= 1) {
            resource._loopPoints = {
              start: view.getUint32(body + 44, true),
              end: view.getUint32(body + 48, true),
            };
          }
          break;
        }
        offset += 8 + size + (size & 1);
      }
    }

    // The file is rendered at its own rate but decoded to the context rate, so
    // frame indices have to be rescaled or the loop drifts out of the buffer.
    const points = resource._loopPoints;
    if (points && resource.audioBuffer) {
      const decoded = resource.audioBuffer.length;
      const total = points.end + 1;
      if (total > 0 && decoded > 0 && total !== decoded) {
        const ratio = decoded / total;
        points.start = Math.round(points.start * ratio);
        points.end = Math.max(points.start, Math.round((points.end + 1) * ratio) - 1);
      }
    }
    return resource._loopPoints;
  }

  _picoMasterGain() {
    const { left, right } = this.masterVolume;
    return Math.max(0, (left + right) / 2);
  }

  _renderPicoMusic(n, source) {
    if (!this.picoMusicCache) {
      this.picoMusicCache = new Map();
    }
    if (this.picoMusicCache.has(n)) {
      return this.picoMusicCache.get(n);
    }

    // A built project supplies the `.d2mu` binary the watch plays; an unbuilt
    // one supplies the `.p8mus` source. parseSong takes either.
    const song = PicoAudio.parseSong(source);
    const rendered = PicoAudio.renderSong(
      song.patterns,
      0,
      song.slots,
      this.audioContext.sampleRate
    );
    // renderSong mixes every channel down to one buffer, so the channels the
    // song claims have to be recorded separately for playMusic to honour them.
    rendered.startChannels = PicoAudio.patternChannels(song.patterns[0], song.slots);
    this.picoMusicCache.set(n, rendered);
    return rendered;
  }
}

// Export for use
window.AudioEngine = AudioEngine;
