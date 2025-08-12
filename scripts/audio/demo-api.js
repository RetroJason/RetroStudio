// demo-api.js
// Demonstration of the Audio Engine API

class AudioEngineDemo {
  constructor() {
    this.audioEngine = null;
    this.resourceManager = null;
    this.loadedResources = new Map();
  }
  
  async initialize() {
    console.log('=== Audio Engine API Demo ===');
    
    // Initialize audio engine
    this.audioEngine = new AudioEngine();
    const success = await this.audioEngine.initialize();
    
    if (!success) {
      console.error('Failed to initialize audio engine');
      return false;
    }
    
    // Create resource manager
    this.resourceManager = new ResourceManager(this.audioEngine);
    
    // Set up UI event handlers
    this.setupUI();
    
    console.log('Audio Engine API ready!');
    return true;
  }
  
  setupUI() {
    // Override the existing file handlers to use the new API
    const modFileInput = document.getElementById('modFileInput');
    const wavFileInput = document.getElementById('wavFileInput');
    const playBtn = document.getElementById('playBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const volumeSlider = document.getElementById('volumeSlider');
    
    // Handle MOD file loading
    modFileInput.addEventListener('change', async (e) => {
      await this.handleModFiles(e.target.files);
    });
    
    // Handle WAV file loading
    wavFileInput.addEventListener('change', async (e) => {
      await this.handleWavFiles(e.target.files);
    });
    
    // Handle play button
    playBtn.addEventListener('click', () => {
      this.playSelectedSong();
    });
    
    // Handle pause button
    pauseBtn.addEventListener('click', () => {
      this.pauseAllSongs();
    });
    
    // Handle volume changes
    volumeSlider.addEventListener('input', (e) => {
      const volume = e.target.value / 100;
      this.audioEngine.setMasterVolume(volume);
      document.getElementById('volumeDisplay').textContent = `${e.target.value}%`;
    });
    
    // Set initial volume
    const initialVolume = volumeSlider.value / 100;
    this.audioEngine.setMasterVolume(initialVolume);
    
    // Add one-time click handler to resume AudioContext
    this.addAudioContextResumeHandler();
  }
  
  addAudioContextResumeHandler() {
    const resumeHandler = async () => {
      if (this.audioEngine.audioContext.state === 'suspended') {
        console.log('[Demo] User interaction detected, resuming AudioContext...');
        try {
          await this.audioEngine.audioContext.resume();
          console.log('[Demo] AudioContext resumed, state:', this.audioEngine.audioContext.state);
        } catch (error) {
          console.warn('[Demo] Failed to resume AudioContext:', error);
        }
      }
      // Remove handler after first use
      document.removeEventListener('click', resumeHandler);
      document.removeEventListener('keydown', resumeHandler);
    };
    
    // Listen for any user interaction
    document.addEventListener('click', resumeHandler);
    document.addEventListener('keydown', resumeHandler);
  }
  
  async handleModFiles(files) {
    const status = document.getElementById('status');
    const modList = document.getElementById('modList');
    
    status.textContent = 'Loading MOD files...';
    status.style.color = 'blue';
    
    try {
      for (const file of files) {
        const resourceId = await this.resourceManager.loadFromFile(file, 'mod');
        const resource = this.audioEngine.getResource(resourceId);
        
        // Store for UI
        this.loadedResources.set(resourceId, {
          type: 'mod',
          name: resource.name,
          file: file
        });
        
        // Add to UI list
        const li = document.createElement('li');
        li.textContent = resource.name;
        li.dataset.resourceId = resourceId;
        li.onclick = () => this.selectSong(resourceId);
        modList.appendChild(li);
        
        // Auto-select first song
        if (!this.selectedSongId) {
          this.selectSong(resourceId);
        }
        
        console.log(`[Demo] Loaded MOD: ${resourceId} (${resource.name})`);
      }
      
      status.textContent = `${files.length} MOD files loaded`;
      status.style.color = 'green';
      
      // Enable play button
      document.getElementById('playBtn').disabled = false;
      document.getElementById('pauseBtn').disabled = false;
      
    } catch (error) {
      status.textContent = `Error loading MOD files: ${error.message}`;
      status.style.color = 'red';
      console.error('[Demo] MOD loading error:', error);
    }
  }
  
  async handleWavFiles(files) {
    const status = document.getElementById('status');
    const wavList = document.getElementById('wavList');
    
    try {
      for (const file of files) {
        const resourceId = await this.resourceManager.loadFromFile(file, 'wav');
        const resource = this.audioEngine.getResource(resourceId);
        
        // Store for UI
        this.loadedResources.set(resourceId, {
          type: 'wav',
          name: resource.name,
          file: file
        });
        
        // Add to UI
        const wavItem = document.createElement('div');
        wavItem.className = 'wav-item';
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = `${resource.name} (${resource.duration.toFixed(1)}s)`;
        
        const playButton = document.createElement('button');
        playButton.textContent = 'Play';
        playButton.onclick = () => this.playSound(resourceId);
        
        wavItem.appendChild(nameSpan);
        wavItem.appendChild(playButton);
        wavList.appendChild(wavItem);
        
        console.log(`[Demo] Loaded WAV: ${resourceId} (${resource.name})`);
      }
      
      status.textContent = `${files.length} WAV files loaded`;
      status.style.color = 'green';
      
    } catch (error) {
      status.textContent = `Error loading WAV files: ${error.message}`;
      status.style.color = 'red';
      console.error('[Demo] WAV loading error:', error);
    }
  }
  
  selectSong(resourceId) {
    // Update UI selection
    const modList = document.getElementById('modList');
    Array.from(modList.children).forEach(li => {
      li.classList.toggle('selected', li.dataset.resourceId === resourceId);
    });
    
    this.selectedSongId = resourceId;
    console.log(`[Demo] Selected song: ${resourceId}`);
  }
  
  async playSelectedSong() {
    if (!this.selectedSongId) {
      console.warn('[Demo] No song selected');
      return;
    }
    
    const success = await this.audioEngine.startSong(this.selectedSongId, 1.0, true);
    if (success) {
      console.log(`[Demo] Started playing song: ${this.selectedSongId}`);
    }
  }
  
  pauseAllSongs() {
    for (const [resourceId, data] of this.loadedResources) {
      if (data.type === 'mod') {
        this.audioEngine.pauseSong(resourceId, true);
      }
    }
    console.log('[Demo] Paused all songs');
  }
  
  async playSound(resourceId, volume = 1.0) {
    const instanceId = await this.audioEngine.startSound(resourceId, volume);
    if (instanceId) {
      console.log(`[Demo] Started sound: ${resourceId} (instance: ${instanceId})`);
    }
    return instanceId;
  }
  
  // Utility methods for demonstration
  
  listAllResources() {
    console.log('=== Loaded Resources ===');
    const resources = this.resourceManager.listResources();
    resources.forEach(resource => {
      console.log(`${resource.resourceId}: ${resource.name} (${resource.type})`);
    });
  }
  
  async demonstrateAPI() {
    console.log('=== API Demonstration ===');
    
    // Example of programmatic resource loading (would work with URLs)
    try {
      // This would work if you had audio files served by your HTTP server
      // const songId = await this.resourceManager.loadFromUrl('/music/song.xm', 'mod');
      // const soundId = await this.resourceManager.loadFromUrl('/sounds/effect.wav', 'wav');
      
      // Set different volumes
      this.audioEngine.setMasterVolume(0.8); // 80% master volume
      
      // Example of playing with different volumes
      // this.audioEngine.startSong(songId, 0.5); // 50% song volume
      // this.audioEngine.startSound(soundId, 1.2); // 120% sound volume (boost)
      
      console.log('API demonstration complete');
    } catch (error) {
      console.log('API demonstration skipped (no URL resources available)');
    }
  }
}

// Initialize the demo when page loads
window.addEventListener('DOMContentLoaded', async () => {
  window.audioDemo = new AudioEngineDemo();
  await window.audioDemo.initialize();
  
  // Demonstrate API usage
  setTimeout(() => {
    window.audioDemo.demonstrateAPI();
  }, 1000);
});
