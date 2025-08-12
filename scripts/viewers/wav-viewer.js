// wav-viewer.js
// Viewer plugin for WAV files

class WavViewer extends ViewerBase {
  constructor(file, path) {
    super(file, path);
    this.audioResource = null;
    this.playButton = null;
    this.volumeSlider = null;
    this.waveformCanvas = null;
    this.audioContext = null;
    
    // Don't load audio resource immediately - wait for DOM to be ready
  }
  
  createBody(bodyContainer) {
    bodyContainer.innerHTML = `
      <div class="wav-player">
        <!-- Song Title -->
        <div class="song-title">
          <h3 id="songTitle">${this.file.name}</h3>
        </div>
        
        <!-- Waveform Display -->
        <div class="waveform-display">
          <canvas id="waveformCanvas" width="600" height="200"></canvas>
        </div>
        
        <!-- Main Player Controls -->
        <div class="player-main">
          <div class="progress-container">
            <div class="play-button-container" id="playButtonContainer">
              <!-- Play/Pause button will be created by control -->
            </div>
            
            <div class="time-display">
              <span id="duration">0:00</span>
            </div>
          </div>
          
          <div class="volume-container" id="volumeContainer">
            <!-- Volume control will be created by control -->
          </div>
          
          <div class="loop-container" id="loopContainer">
            <!-- Loop control will be created by control -->
          </div>
        </div>
        
        <!-- Song Information -->
        <div class="song-info">
          <div class="info-item">
            <strong>STATUS:</strong>
            <span id="loadStatus">Loading...</span>
          </div>
          <div class="info-item">
            <strong>FORMAT:</strong>
            <span id="formatInfo">WAV Audio</span>
          </div>
        </div>
      </div>
    `;
    
    // Get references to container elements
    this.durationSpan = bodyContainer.querySelector('#duration');
    this.waveformCanvas = bodyContainer.querySelector('#waveformCanvas');
    
    // Initialize controls
    this.playPauseButton = new PlayPauseButton(
      bodyContainer.querySelector('#playButtonContainer'),
      {
        buttonId: 'playButton',
        onToggle: (isPlaying) => this.handlePlayToggle(isPlaying)
      }
    );
    
    this.volumeControl = new VolumeControl(
      bodyContainer.querySelector('#volumeContainer'),
      {
        sliderId: 'volumeSlider',
        displayId: 'volumeDisplay',
        onChange: (normalizedValue) => this.handleVolumeChange(normalizedValue)
      }
    );
    
    this.loopControl = new LoopControl(
      bodyContainer.querySelector('#loopContainer'),
      {
        checkboxId: 'loopCheckbox',
        onChange: (isLooping) => this.handleLoopChange(isLooping)
      }
    );
    
    // Playback position tracking
    this.currentTime = 0;
    this.duration = 0;
    this.isPlaying = false;
    this.isLooping = false;
    this.animationFrame = null;
    
    console.log('[WavViewer] Control elements found:', {
      playPauseButton: !!this.playPauseButton,
      volumeControl: !!this.volumeControl,
      loopControl: !!this.loopControl,
      durationSpan: !!this.durationSpan,
      waveformCanvas: !!this.waveformCanvas
    });
    
    // Now that DOM is ready, load the audio resource
    this.loadAudioResource();
    
    // No longer need setupControls since controls handle themselves
  }

  // Control event handlers
  handlePlayToggle(isPlaying) {
    console.log('[WavViewer] Play toggle:', isPlaying);
    
    if (isPlaying && !this.isPlaying) {
      // Starting playback
      this.playSound();
    } else if (!isPlaying && this.isPlaying) {
      // Stopping playback
      this.stopAllPlayback();
    }
  }

  handleVolumeChange(normalizedValue) {
    console.log('[WavViewer] Volume change:', normalizedValue);
    // Volume is already normalized (0-1), so we can use it directly
    // The actual volume application happens in playSound when starting playback
  }

  handleLoopChange(isLooping) {
    console.log('[WavViewer] Loop change:', isLooping);
    this.isLooping = isLooping;
  }
  
  async loadAudioResource() {
    if (!window.gameEditor) {
      this.updateStatus('Audio engine not available');
      return;
    }

    try {
      console.log('[WavViewer] Loading audio resource for:', this.file.name);
      
      // First try to get already loaded resource
      let resourceId = window.gameEditor.getLoadedResourceId(this.file.name);
      
      if (resourceId) {
        // File already loaded
        this.audioResource = window.gameEditor.audioEngine.getResource(resourceId);
        console.log(`[WavViewer] File already loaded: ${this.file.name}`);
        this.updateStatus('Loaded');
        this.updateMetadata();
        this.updateDurationDisplay(); // Ensure duration is shown
        
        // Draw waveform using a more robust approach
        this.scheduleWaveformDraw();
        return;
      }

      // File not loaded yet, load it on demand
      console.log('[WavViewer] File not loaded, loading on demand...');
      this.updateStatus('Loading...');
      
      resourceId = await window.gameEditor.loadAudioFileOnDemand(this.file.name);
      
      if (resourceId) {
        this.audioResource = window.gameEditor.audioEngine.getResource(resourceId);
        console.log(`[WavViewer] Loaded resource for: ${this.file.name}`);
        
        this.updateStatus('Loaded');
        this.updateMetadata();
        this.updateDurationDisplay(); // Ensure duration is shown
        
        // Draw waveform using a more robust approach
        this.scheduleWaveformDraw();
      } else {
        this.updateStatus('Failed to load audio resource');
      }
    } catch (error) {
      console.error('[WavViewer] Failed to load audio resource:', error);
      this.updateStatus(`Error: ${error.message}`);
    }
  }
  
  // Method to schedule waveform drawing after DOM is ready
  scheduleWaveformDraw() {
    // Use requestAnimationFrame to ensure rendering happens after layout
    requestAnimationFrame(() => {
      this.drawWaveform();
    });
  }
  
  updateStatus(status) {
    const statusElement = this.element ? this.element.querySelector('#loadStatus') : null;
    if (statusElement) {
      statusElement.textContent = status;
    }
  }
  
  updateMetadata() {
    const metadataContent = this.element ? this.element.querySelector('#metadataContent') : null;
    if (!metadataContent) return;
    
    if (this.audioResource && this.audioResource.audioBuffer) {
      const buffer = this.audioResource.audioBuffer;
      
      metadataContent.innerHTML = `
        <div class="metadata-row">
          <strong>Format:</strong> WAV Audio
        </div>
        <div class="metadata-row">
          <strong>File Size:</strong> ${this.getFileSize()}
        </div>
        <div class="metadata-row">
          <strong>Duration:</strong> ${this.formatDuration(buffer.duration)}
        </div>
        <div class="metadata-row">
          <strong>Sample Rate:</strong> ${buffer.sampleRate} Hz
        </div>
        <div class="metadata-row">
          <strong>Channels:</strong> ${buffer.numberOfChannels}
        </div>
        <div class="metadata-row">
          <strong>Bit Depth:</strong> 32-bit float (decoded)
        </div>
        <div class="metadata-row">
          <strong>Samples:</strong> ${buffer.length.toLocaleString()}
        </div>
        <div class="metadata-row">
          <strong>Resource ID:</strong> ${this.audioResource.id}
        </div>
      `;
      
      // Update duration display in player
      this.updateDurationDisplay();
    } else {
      metadataContent.innerHTML = '<p>Resource not loaded</p>';
    }
  }
  
  updateDurationDisplay() {
    if (this.audioResource && this.audioResource.audioBuffer && this.durationSpan) {
      this.durationSpan.textContent = this.formatDuration(this.audioResource.audioBuffer.duration);
    }
  }
  
  formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }
  
  drawWaveform() {
    console.log('[WavViewer] drawWaveform called');
    
    // Refresh canvas reference in case it was lost
    if (!this.waveformCanvas) {
      // Try to find it in the current tab pane
      const currentTabPane = document.querySelector('.tab-pane.active');
      if (currentTabPane) {
        this.waveformCanvas = currentTabPane.querySelector('#waveformCanvas');
      } else {
        this.waveformCanvas = document.querySelector('#waveformCanvas');
      }
      console.log('[WavViewer] Refreshed canvas reference:', !!this.waveformCanvas);
    }
    
    if (!this.waveformCanvas) {
      console.log('[WavViewer] No waveformCanvas found');
      return;
    }
    
    if (!this.audioResource) {
      console.log('[WavViewer] No audioResource found');
      return;
    }
    
    if (!this.audioResource.audioBuffer) {
      console.log('[WavViewer] No audioBuffer in audioResource');
      return;
    }
    
    console.log('[WavViewer] All requirements met, drawing waveform...');
    console.log('[WavViewer] AudioBuffer details:', {
      duration: this.audioResource.audioBuffer.duration,
      sampleRate: this.audioResource.audioBuffer.sampleRate,
      numberOfChannels: this.audioResource.audioBuffer.numberOfChannels,
      length: this.audioResource.audioBuffer.length
    });
    
    const canvas = this.waveformCanvas;
    const ctx = canvas.getContext('2d');
    const buffer = this.audioResource.audioBuffer;
    
    // Set canvas size to match display size with proper DPI scaling
    const rect = canvas.getBoundingClientRect();
    console.log('[WavViewer] Canvas getBoundingClientRect:', rect);
    
    if (rect.width === 0 || rect.height === 0) {
      console.error('[WavViewer] Canvas has zero dimensions - this should not happen with proper initialization!');
      console.error('[WavViewer] Canvas rect:', rect);
      console.error('[WavViewer] Canvas parent:', canvas.parentElement);
      return;
    }
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const height = rect.height;
    
    console.log('[WavViewer] Canvas dimensions:', { width, height, dpr });
    
    // Clear canvas with dark background for modern look
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, width, height);

    // Draw waveform data
    const channelData = buffer.getChannelData(0); // Use first channel
    const samplesPerPixel = channelData.length / width;

    console.log('[WavViewer] Waveform data:', {
      channelDataLength: channelData.length,
      samplesPerPixel: samplesPerPixel,
      firstFewSamples: Array.from(channelData.slice(0, 10))
    });

    const centerY = height / 2;

    // Create gradient for waveform
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#4fc3f7');    // Light blue at top
    gradient.addColorStop(0.5, '#29b6f6');  // Medium blue at center
    gradient.addColorStop(1, '#0288d1');    // Darker blue at bottom

    // Draw filled waveform with gradient
    ctx.fillStyle = gradient;
    ctx.beginPath();

    // Start from bottom left
    ctx.moveTo(0, height);

    // Draw top envelope
    for (let x = 0; x < width; x++) {
      const startSample = Math.floor(x * samplesPerPixel);
      const endSample = Math.min(Math.floor((x + 1) * samplesPerPixel), channelData.length);
      
      // Find min and max in this segment
      let min = 0, max = 0;
      for (let i = startSample; i < endSample; i++) {
        const sample = channelData[i];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      
      // Convert to canvas coordinates (flip Y axis and scale to 90% of height)
      const yMax = centerY - (max * centerY * 0.9);
      ctx.lineTo(x, yMax);
    }

    // Draw bottom envelope (right to left)
    for (let x = width - 1; x >= 0; x--) {
      const startSample = Math.floor(x * samplesPerPixel);
      const endSample = Math.min(Math.floor((x + 1) * samplesPerPixel), channelData.length);
      
      // Find min and max in this segment
      let min = 0, max = 0;
      for (let i = startSample; i < endSample; i++) {
        const sample = channelData[i];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      
      // Convert to canvas coordinates (flip Y axis and scale to 90% of height)
      const yMin = centerY - (min * centerY * 0.9);
      ctx.lineTo(x, yMin);
    }

    ctx.closePath();
    ctx.fill();

    // Add outline for better definition
    ctx.strokeStyle = '#0277bd';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Draw subtle center line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // Draw playback position line if playing
    this.drawPlaybackPosition();

    console.log('[WavViewer] Waveform drawing completed');
  }

  drawPlaybackPosition() {
    if (!this.waveformCanvas || !this.duration || this.duration === 0) return;
    
    const canvas = this.waveformCanvas;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    
    // Calculate position based on current time
    const progress = this.currentTime / this.duration;
    const x = progress * width;
    
    // Draw the position line
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  startPositionTracking() {
    if (this.animationFrame) return; // Already tracking
    
    this.startTime = Date.now();
    
    const updatePosition = () => {
      if (this.isPlaying) {
        // Calculate elapsed time since playback started
        const elapsed = (Date.now() - this.startTime) / 1000;
        this.currentTime = elapsed % this.duration; // Use modulo for looping
        
        // Redraw waveform with updated position
        this.drawWaveform();
        
        // Check if we've reached the end
        if (elapsed >= this.duration && !this.isLooping) {
          this.stopPositionTracking();
          return;
        }
        
        // If looping and we've completed a cycle, restart the audio
        if (this.isLooping && elapsed >= this.duration && Math.floor(elapsed / this.duration) > Math.floor((elapsed - 1/60) / this.duration)) {
          // We just completed a loop cycle, restart the audio
          this.restartLoop();
        }
      }
      
      if (this.isPlaying) {
        this.animationFrame = requestAnimationFrame(updatePosition);
      }
    };
    
    this.animationFrame = requestAnimationFrame(updatePosition);
  }

  stopPositionTracking() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.isPlaying = false;
    this.currentTime = 0;
    this.drawWaveform(); // Redraw without position line
  }

  async restartLoop() {
    if (!this.isLooping || !window.gameEditor || !this.audioResource) return;
    
    console.log('[WavViewer] Restarting loop');
    
    try {
      const resourceId = window.gameEditor.getLoadedResourceId(this.file.name);
      if (resourceId) {
        const volume = this.volumeControl ? this.volumeControl.getNormalizedValue() : 0.7;
        
        // Stop current playback
        window.gameEditor.audioEngine.stopAllSounds(resourceId);
        
        // Start new playback
        await window.gameEditor.audioEngine.startSound(resourceId, volume);
        
        // Reset start time for accurate position tracking
        this.startTime = Date.now();
      }
    } catch (error) {
      console.error('[WavViewer] Error restarting loop:', error);
    }
  }

  updatePlayPauseButton() {
    // Use the control's setPlaying method to update the button state
    if (this.playPauseButton) {
      this.playPauseButton.setPlaying(this.isPlaying);
    }
  }
  
  async playSound() {
    console.log('[WavViewer] playSound called, playButton:', this.playButton);
    
    if (!window.gameEditor || !this.audioResource) {
      alert('Audio resource not available');
      return;
    }
    
    const resourceId = window.gameEditor.getLoadedResourceId(this.file.name);
    if (!resourceId) {
      alert('Resource not loaded in audio engine');
      return;
    }
    
    try {
      const volume = this.volumeControl ? this.volumeControl.getNormalizedValue() : 0.7;
      
      // Check if AudioContext is suspended and needs to be resumed
      if (window.gameEditor.audioEngine.audioContext.state === 'suspended') {
        console.log('[WavViewer] AudioContext suspended, resuming...');
        try {
          await window.gameEditor.audioEngine.audioContext.resume();
          console.log('[WavViewer] AudioContext resumed');
        } catch (error) {
          console.warn('[WavViewer] Failed to resume AudioContext:', error);
          return;
        }
      }
      
      const instanceId = await window.gameEditor.audioEngine.startSound(resourceId, volume);
      
      if (instanceId) {
        // Set duration and start position tracking
        this.duration = this.audioResource.duration || 0;
        this.currentTime = 0;
        this.isPlaying = true;
        this.startPositionTracking();
        
        // Update button to playing state (pause icon)
        this.updatePlayPauseButton();
        
        // Reset button after duration (only if not looping)
        if (this.audioResource.duration && !this.isLooping) {
          setTimeout(() => {
            this.stopPositionTracking();
            this.updatePlayPauseButton();
          }, this.audioResource.duration * 1000);
        }
      } else {
        console.warn('[WavViewer] Failed to start sound playback');
      }
    } catch (error) {
      console.error('[WavViewer] Playback error:', error);
      alert(`Playback error: ${error.message}`);
    }
  }
  
  onFocus() {
    // Refresh status when tab becomes active
    this.loadAudioResource();
    
    // Redraw waveform in case canvas was resized
    this.scheduleWaveformDraw();
  }
  
  // Lifecycle methods
  loseFocus() {
    // Stop any playing sounds when tab loses focus
    console.log('[WavViewer] loseFocus called - stopping all playback');
    console.log('[WavViewer] file:', this.file?.name);
    
    try {
      this.stopAllPlayback();
    } catch (error) {
      console.error('[WavViewer] Error stopping playback in loseFocus:', error);
    }
  }

  cleanup() {
    // Complete cleanup when viewer is being destroyed
    console.log('[WavViewer] Cleaning up WAV viewer');
    try {
      this.stopAllPlayback();
      
      // Clean up control objects to prevent DOM element leakage
      if (this.playPauseButton && typeof this.playPauseButton.destroy === 'function') {
        console.log('[WavViewer] Destroying play/pause button');
        this.playPauseButton.destroy();
        this.playPauseButton = null;
      }
      
      if (this.volumeControl && typeof this.volumeControl.destroy === 'function') {
        console.log('[WavViewer] Destroying volume control');
        this.volumeControl.destroy();
        this.volumeControl = null;
      }
      
      if (this.loopControl && typeof this.loopControl.destroy === 'function') {
        console.log('[WavViewer] Destroying loop control');
        this.loopControl.destroy();
        this.loopControl = null;
      }
      
      // Clear any animation frames
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
      
    } catch (error) {
      console.error('[WavViewer] Error in cleanup:', error);
    }
  }

  // Legacy support - map old methods to new interface
  onBlur() {
    this.loseFocus();
  }
  
  stopAllPlayback() {
    console.log('[WavViewer] stopAllPlayback called');
    
    // Stop position tracking
    this.stopPositionTracking();
    
    if (!window.gameEditor) {
      console.log('[WavViewer] No game editor, skipping stop');
      return;
    }
    
    try {
      const resourceId = window.gameEditor.getLoadedResourceId(this.file.name);
      if (resourceId) {
        console.log('[WavViewer] Stopping all sounds for resource:', resourceId);
        // Stop all instances of this sound
        window.gameEditor.audioEngine.stopAllSounds(resourceId);
      }
      
      // Also perform comprehensive audio cleanup to prevent static
      window.gameEditor.audioEngine.stopAllAudio();
    } catch (error) {
      console.error('[WavViewer] Error stopping all playback:', error);
      // Try emergency stop as fallback
      try {
        window.gameEditor.audioEngine.emergencyAudioStop();
      } catch (emergencyError) {
        console.error('[WavViewer] Emergency stop also failed:', emergencyError);
      }
    }
    
    // Reset button state
    this.updatePlayPauseButton();
  }

  destroy() {
    // Call our cleanup method first
    this.cleanup();
    super.destroy();
  }
}

// Export for use
window.WavViewer = WavViewer;
