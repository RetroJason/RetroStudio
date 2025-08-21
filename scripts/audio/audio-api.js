// audio-api.js
// High-level Audio Engine API for games and applications

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
    
    this.isInitialized = false;
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
      await this.audioContext.audioWorklet.addModule('scripts/audio/mixer-worklet.js');
      this.workletNode = new AudioWorkletNode(this.audioContext, 'mixer-worklet');
      this.workletNode.connect(this.audioContext.destination);
      
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
    if (!this.isInitialized) {
      throw new Error('AudioEngine not initialized');
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
    const resource = this.resources.get(resourceId);
    if (!resource) {
      console.warn(`[AudioEngine] Song resource not found: ${resourceId}`);
      return false;
    }
    
    if (resource.type !== 'mod') {
      console.warn(`[AudioEngine] Resource ${resourceId} is not a song (MOD) type`);
      return false;
    }
    
    // Check AudioContext state
    if (this.audioContext.state === 'suspended') {
      console.warn('[AudioEngine] AudioContext is suspended. Please interact with the page first.');
      return false;
    }
    
    // Stop existing song playback
    this.stopSong(resourceId);
    
    try {
      // Track the current resource being played
      this.currentResourceId = resourceId;
      
      // Start MOD playback
      this.modWorker.postMessage({
        type: 'load-mod',
        arrayBuffer: resource.data,
        sampleRate: this.audioContext.sampleRate
      });
      
      this.activeSongs.set(resourceId, {
        resourceId,
        volume,
        loop,
        isPlaying: true
      });
      
      console.log(`[AudioEngine] Started song: ${resourceId} (volume: ${volume})`);
      return true;
    } catch (error) {
      console.error(`[AudioEngine] Failed to start song ${resourceId}:`, error);
      return false;
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
      this.modWorker.postMessage({ type: 'get-pcm', frames: 2048 });
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
  async startSound(resourceId, volume = 1.0) {
    const resource = this.resources.get(resourceId);
    if (!resource) {
      console.warn(`[AudioEngine] Sound resource not found: ${resourceId}`);
      return null;
    }
    
    if (resource.type !== 'wav') {
      console.warn(`[AudioEngine] Resource ${resourceId} is not a sound (WAV) type`);
      return null;
    }
    
    // Check AudioContext state
    if (this.audioContext.state === 'suspended') {
      console.warn('[AudioEngine] AudioContext is suspended. Please interact with the page first.');
      return null;
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
      
      // Send to mixer as one-shot
      this.workletNode.port.postMessage({
        type: 'play',
        channels: channels,
        sampleRate: resource.audioBuffer.sampleRate
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
    for (const [instanceId, playback] of this.activeSounds) {
      if (playback.resourceId === resourceId) {
        this.activeSounds.delete(instanceId);
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
    this.modWorker = new Worker('scripts/audio/openmpt-integration.js');
    this.modWorker.onmessage = (e) => {
      this._handleModWorkerMessage(e);
    };
    this.modWorker.onerror = (error) => {
      console.error('[AudioEngine] MOD Worker Error:', error);
    };
    console.log('[AudioEngine] MOD Worker created');
  }
  
  _handleModWorkerMessage(e) {
    console.log('[AudioEngine] MOD Worker message:', e.data.type);
    
    if (e.data.type === 'log') {
      console.log('[MOD Worker]', e.data.message);
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
      
      // Update the currently playing resource with the actual duration
      if (this.currentResourceId && this.resources.has(this.currentResourceId)) {
        const resource = this.resources.get(this.currentResourceId);
        if (resource.type === 'mod') {
          resource.duration = e.data.duration;
          resource.title = e.data.title;
          console.log('[AudioEngine] Updated current MOD resource', this.currentResourceId, 'with duration:', e.data.duration);
        }
      }
      
      // Find the correct pending analysis resource by iterating through loading promises
      let matchingResourceId = null;
      let matchingResource = null;
      
      console.log('[AudioEngine] Looking for pending analysis resource, promises count:', this._loadingPromises.size);
      for (const [resourceId, promiseData] of this._loadingPromises.entries()) {
        const resource = this.resources.get(resourceId);
        if (resource && resource.type === 'mod' && !resource.duration) {
          // This resource doesn't have a duration yet, so it's likely the one we just analyzed
          console.log(`[AudioEngine] Found likely match: ${resourceId}, checking if it needs duration...`);
          matchingResourceId = resourceId;
          matchingResource = resource;
          break;
        }
      }
      
      // If we found a matching resource, update it
      if (matchingResource && matchingResourceId) {
        matchingResource.duration = e.data.duration;
        matchingResource.title = e.data.title;
        console.log('[AudioEngine] Updated MOD resource', matchingResourceId, 'with duration:', e.data.duration);
        
        // Resolve the loading promise
        const promiseData = this._loadingPromises.get(matchingResourceId);
        if (promiseData) {
          console.log('[AudioEngine] Resolving loading promise for:', matchingResourceId);
          clearTimeout(promiseData.timeoutId);
          this._loadingPromises.delete(matchingResourceId);
          promiseData.resolve(); // Analysis complete, resource is ready
        }
        
        // Emit event for duration update
        console.log('[AudioEngine] Emitting resourceUpdated event for:', matchingResourceId);
        this.dispatchEvent(new CustomEvent('resourceUpdated', {
          detail: { resourceId: matchingResourceId, property: 'duration', value: e.data.duration }
        }));
      } else {
        console.warn('[AudioEngine] Could not find matching resource for MOD analysis result');
        console.log('[AudioEngine] Available resources:', Array.from(this.resources.keys()));
        console.log('[AudioEngine] Pending promises:', Array.from(this._loadingPromises.keys()));
      }
      
      // Only start playing if there's a current resource (meaning this was for playback, not analysis)
      if (this.currentResourceId) {
        // Signal worklet to start playing
        this.workletNode.port.postMessage({ type: 'start-playing' });
        // Start PCM generation
        this.workletNode.port.postMessage({ type: 'request-pcm' });
        // Request PCM data from MOD worker only for playback
        this.modWorker.postMessage({ type: 'get-pcm', frames: 2048 });
      }
    } else if (e.data.type === 'error') {
      console.error('[AudioEngine] MOD Worker Error:', e.data.message);
    }
  }
  
  _handleWorkletMessage(e) {
    console.log('[AudioEngine] Worklet message:', e.data.type);
    
    if (e.data.type === 'request-pcm') {
      // Worklet wants more PCM data
      if (this.modWorker && this.activeSongs.size > 0) {
        console.log('[AudioEngine] Requesting more PCM data');
        this.modWorker.postMessage({ type: 'get-pcm', frames: e.data.frames });
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
      
      // Clear current resource
      this.currentResourceId = null;
      
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
      this.activeSongs.clear();
      this.activeSounds.clear();
      this.currentResourceId = null;
      
      return true;
    } catch (error) {
      console.error('[AudioEngine] Error in emergency audio stop:', error);
      return false;
    }
  }
}

// Export for use
window.AudioEngine = AudioEngine;
