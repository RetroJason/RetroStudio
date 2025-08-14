// mod-viewer.js
// Viewer plugin for MOD/XM/S3M/IT files

class ModViewer extends ViewerBase {
  constructor(path) {
    super(path);
    this.audioResource = null;
    this.isPlaying = false;
    this.isPaused = false;
    this.duration = 0;
    this.currentTime = 0;
    
    // UI elements
    this.playPauseButton = null;
    this.progressBar = null;
    this.currentTimeSpan = null;
    this.durationSpan = null;
    this.volumeSlider = null;
    this.titleSpan = null;
    
    // Progress tracking
    this.progressInterval = null;
    this.isDragging = false;
    this.durationPollingInterval = null;
    
    // FFT visualization
    this.analyser = null;
    this.frequencyData = null;
    this.animationFrame = null;
    this.isVisualizationActive = false;
    
  this.loadAudioResource();
  }
  
  createActions(actionsContainer) {
    // Volume control in actions bar
    const volumeContainer = document.createElement('div');
    volumeContainer.className = 'volume-control-compact';
    volumeContainer.innerHTML = `
      <span>🔊</span>
      <input type="range" id="volumeSlider" min="0" max="100" value="70" style="width: 80px;">
    `;
    
    this.volumeSlider = volumeContainer.querySelector('#volumeSlider');
    this.setupVolumeControl();
    
    actionsContainer.appendChild(volumeContainer);
  }
  
  createBody(bodyContainer) {
  const displayName = this.getFileName();
    bodyContainer.innerHTML = `
      <div class="mod-player">
        <!-- Song Title -->
        <div class="song-title">
      <h3 id="songTitle">${displayName}</h3>
        </div>
        
        <!-- Equalizer Visualization Display -->
        <div class="waveform-display">
          <canvas id="visualizationCanvas" width="600" height="200"></canvas>
        </div>
        
        <!-- Main Player Controls -->
        <div class="player-main">
          <div class="progress-container">
            <div class="play-button-container">
              <button id="playPauseBtn" class="play-pause-button">
                <span class="play-icon">▶️</span>
              </button>
            </div>
            
            <div class="progress-bar-container">
              <input type="range" 
                     id="progressBar" 
                     class="progress-bar" 
                     min="0" 
                     max="100" 
                     value="0"
                     step="0.1">
            </div>
            
            <div class="time-display">
              <span id="duration">0:00</span>
            </div>
          </div>
          
          <div class="volume-container">
            <label>Volume:</label>
            <input type="range" id="volumeSlider" min="0" max="100" value="70">
            <span id="volumeDisplay">70%</span>
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
            <span id="formatInfo">MOD File</span>
          </div>
        </div>
      </div>
    `;
    
    // Get references to controls
    this.playPauseButton = bodyContainer.querySelector('#playPauseBtn');
    this.progressBar = bodyContainer.querySelector('#progressBar');
    this.currentTimeSpan = bodyContainer.querySelector('#currentTime');
    this.durationSpan = bodyContainer.querySelector('#duration');
    this.titleSpan = bodyContainer.querySelector('#songTitle');
    this.volumeSlider = bodyContainer.querySelector('#volumeSlider');
    this.visualizationCanvas = bodyContainer.querySelector('#visualizationCanvas');
    
    // Debug logging
    console.log('[ModViewer] UI elements found:', {
      playPauseButton: !!this.playPauseButton,
      progressBar: !!this.progressBar,
      currentTimeSpan: !!this.currentTimeSpan,
      durationSpan: !!this.durationSpan,
      titleSpan: !!this.titleSpan,
      volumeSlider: !!this.volumeSlider,
      visualizationCanvas: !!this.visualizationCanvas
    });
    
    // Initialize values and display
    this.currentTime = 0;
    
    // Don't set a default duration - wait for the real one from the MOD worker
    if (!this.duration || this.duration === 0) {
      this.duration = 0; // Start with 0, will be updated when MOD loads
    }
    
    this.updateTimeDisplay();
    this.updateProgressBar();
    this.setupVolumeDisplay();
    
    // Setup control event handlers
    this.setupPlayerControls();
    
    // Initialize FFT visualization
    this.setupFFTVisualization();
  }

  getFileName() {
    return this.path ? this.path.split('/').pop() || this.path.split('\\').pop() : 'Unknown';
  }
  
  setupFFTVisualization() {
    if (!this.visualizationCanvas) {
      console.warn('[ModViewer] Visualization canvas not found');
      return;
    }
    
    const ctx = this.visualizationCanvas.getContext('2d');
    
    // Create a default static display
    this.drawStaticEqualizer(ctx);
    
    // Setup will be completed when audio starts playing
  }
  
  drawStaticEqualizer(ctx) {
    const canvas = this.visualizationCanvas;
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas with dark background
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, width, height);
    
    // Draw static equalizer bars
    const barCount = 32;
    const barWidth = (width - (barCount + 1) * 4) / barCount;
    const barSpacing = 4;
    
    // Create gradient for bars
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#0078d4');
    gradient.addColorStop(0.3, '#00bcf2');
    gradient.addColorStop(0.6, '#40e0d0');
    gradient.addColorStop(1, '#7fffd4');
    
    ctx.fillStyle = gradient;
    
    // Draw bars with random heights for static display
    for (let i = 0; i < barCount; i++) {
      const x = i * (barWidth + barSpacing) + barSpacing;
      const barHeight = Math.random() * 0.3 * height + 10; // Low random heights
      const y = height - barHeight;
      
      // Draw bar with rounded top
      ctx.fillRect(x, y, barWidth, barHeight);
      
      // Add subtle highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(x, y, barWidth, Math.min(barHeight, 8));
      ctx.fillStyle = gradient;
    }
    
    // Add center text
    ctx.fillStyle = '#cccccc';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Audio Equalizer - Play to see live visualization', width / 2, height / 2);
  }
  
  setupAudioAnalyser() {
    if (!window.gameEditor || !window.gameEditor.audioEngine || !window.gameEditor.audioEngine.audioContext) {
      console.warn('[ModViewer] Audio context not available for FFT analysis');
      return false;
    }
    
    try {
      // Create analyser node
      this.analyser = window.gameEditor.audioEngine.audioContext.createAnalyser();
      this.analyser.fftSize = 128; // 64 frequency bins
      this.analyser.smoothingTimeConstant = 0.8;
      
      // Create frequency data array
      this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
      
      // Try to connect to the worklet node if available
      // Note: This is a simple connection approach - we may need to enhance the audio engine
      // to provide a proper analysis tap in the future
      if (window.gameEditor.audioEngine.workletNode) {
        try {
          // Simple connection to analyser (non-destructive)
          window.gameEditor.audioEngine.workletNode.connect(this.analyser);
          console.log('[ModViewer] Audio analyser connected to worklet node');
        } catch (connectError) {
          console.warn('[ModViewer] Could not connect to worklet, using fallback visualization');
          return false;
        }
      } else {
        console.warn('[ModViewer] No worklet node found, using fallback visualization');
        return false;
      }
      
      console.log('[ModViewer] Audio analyser setup complete');
      return true;
    } catch (error) {
      console.error('[ModViewer] Failed to setup audio analyser:', error);
      return false;
    }
  }
  
  startVisualization() {
    if (this.isVisualizationActive) {
      return; // Already running
    }
    
    if (!this.setupAudioAnalyser()) {
      console.warn('[ModViewer] Could not setup analyser, using fallback visualization');
      this.startFallbackVisualization();
      return;
    }
    
    this.isVisualizationActive = true;
    this.renderVisualization();
  }
  
  startFallbackVisualization() {
    // Animated bars without real audio data
    this.isVisualizationActive = true;
    this.renderFallbackVisualization();
  }
  
  renderVisualization() {
    if (!this.isVisualizationActive || !this.visualizationCanvas || !this.analyser) {
      return;
    }
    
    const ctx = this.visualizationCanvas.getContext('2d');
    const canvas = this.visualizationCanvas;
    const width = canvas.width;
    const height = canvas.height;
    
    // Get frequency data
    this.analyser.getByteFrequencyData(this.frequencyData);
    
    // Clear canvas
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, width, height);
    
    // Draw equalizer bars
    const barCount = Math.min(32, this.frequencyData.length);
    const barWidth = (width - (barCount + 1) * 4) / barCount;
    const barSpacing = 4;
    
    // Create dynamic gradient based on overall amplitude
    const avgAmplitude = this.frequencyData.reduce((sum, val) => sum + val, 0) / this.frequencyData.length;
    const intensity = avgAmplitude / 255;
    
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, `rgba(0, 120, 212, ${0.8 + intensity * 0.2})`);
    gradient.addColorStop(0.3, `rgba(0, 188, 242, ${0.8 + intensity * 0.2})`);
    gradient.addColorStop(0.6, `rgba(64, 224, 208, ${0.8 + intensity * 0.2})`);
    gradient.addColorStop(1, `rgba(127, 255, 212, ${0.8 + intensity * 0.2})`);
    
    ctx.fillStyle = gradient;
    
    // Draw bars
    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.floor((i / barCount) * this.frequencyData.length);
      const amplitude = this.frequencyData[dataIndex] / 255;
      
      const x = i * (barWidth + barSpacing) + barSpacing;
      const barHeight = amplitude * height * 0.8;
      const y = height - barHeight;
      
      if (barHeight > 2) {
        // Draw main bar
        ctx.fillRect(x, y, barWidth, barHeight);
        
        // Add highlight at top
        ctx.fillStyle = `rgba(255, 255, 255, ${0.1 + amplitude * 0.3})`;
        ctx.fillRect(x, y, barWidth, Math.min(barHeight, 8));
        
        // Add peak dot
        if (amplitude > 0.7) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x + barWidth / 4, y - 4, barWidth / 2, 2);
        }
        
        ctx.fillStyle = gradient;
      }
    }
    
    // Continue animation
    this.animationFrame = requestAnimationFrame(() => this.renderVisualization());
  }
  
  renderFallbackVisualization() {
    if (!this.isVisualizationActive || !this.visualizationCanvas) {
      return;
    }
    
    const ctx = this.visualizationCanvas.getContext('2d');
    const canvas = this.visualizationCanvas;
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, width, height);
    
    // Draw animated bars with simulated music rhythm
    const barCount = 32;
    const barWidth = (width - (barCount + 1) * 4) / barCount;
    const barSpacing = 4;
    const time = Date.now() * 0.005; // Slow animation
    
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#0078d4');
    gradient.addColorStop(0.3, '#00bcf2');
    gradient.addColorStop(0.6, '#40e0d0');
    gradient.addColorStop(1, '#7fffd4');
    
    ctx.fillStyle = gradient;
    
    // Draw bars with musical rhythm simulation
    for (let i = 0; i < barCount; i++) {
      const frequency = (i + 1) * 0.5;
      const amplitude = (Math.sin(time * frequency) + 1) * 0.5;
      const bassBoost = i < 4 ? Math.sin(time * 2) * 0.3 + 0.7 : 1;
      
      const x = i * (barWidth + barSpacing) + barSpacing;
      const barHeight = amplitude * bassBoost * height * 0.6 + 10;
      const y = height - barHeight;
      
      // Draw bar
      ctx.fillRect(x, y, barWidth, barHeight);
      
      // Add highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fillRect(x, y, barWidth, Math.min(barHeight, 8));
      ctx.fillStyle = gradient;
    }
    
    // Continue animation
    this.animationFrame = requestAnimationFrame(() => this.renderFallbackVisualization());
  }
  
  stopVisualization() {
    this.isVisualizationActive = false;
    
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    
    // Draw static equalizer
    if (this.visualizationCanvas) {
      const ctx = this.visualizationCanvas.getContext('2d');
      this.drawStaticEqualizer(ctx);
    }
  }
  
  setupVolumeDisplay() {
    if (this.volumeSlider) {
      const volumeDisplay = this.element ? this.element.querySelector('#volumeDisplay') : null;
      if (volumeDisplay) {
        volumeDisplay.textContent = this.volumeSlider.value + '%';
      }
    }
  }
  
  setupPlayerControls() {
    // Play/Pause button
    if (this.playPauseButton) {
      this.playPauseButton.addEventListener('click', () => {
        this.togglePlayback();
      });
    }
    
    // Progress bar scrubbing
    if (this.progressBar) {
      // Store reference to bound functions for cleanup
      this.boundMouseMove = (e) => {
        if (this.isDragging && this.progressBar) {
          this.handleProgressScrub(e);
        }
      };
      
      this.boundMouseUp = () => {
        if (this.isDragging) {
          this.isDragging = false;
          console.log('[ModViewer] Drag ended');
        }
      };
      
      // Mouse events for desktop
      this.progressBar.addEventListener('mousedown', (e) => {
        this.isDragging = true;
        this.handleProgressScrub(e);
        console.log('[ModViewer] Drag started');
      });
      
      // Use document for mouse events to capture movement outside element
      document.addEventListener('mousemove', this.boundMouseMove);
      document.addEventListener('mouseup', this.boundMouseUp);
      
      // Touch events for mobile
      this.progressBar.addEventListener('touchstart', (e) => {
        this.isDragging = true;
        this.handleProgressScrub(e);
      });
      
      this.progressBar.addEventListener('touchmove', (e) => {
        if (this.isDragging) {
          e.preventDefault();
          this.handleProgressScrub(e);
        }
      });
      
      this.progressBar.addEventListener('touchend', () => {
        this.isDragging = false;
      });
      
      // Input event for direct value changes
      this.progressBar.addEventListener('input', (e) => {
        const percentage = parseFloat(e.target.value);
        this.seekToPosition(percentage);
        console.log('[ModViewer] Progress bar input:', percentage + '%');
      });
      
      // Change event for when user releases the slider
      this.progressBar.addEventListener('change', (e) => {
        const percentage = parseFloat(e.target.value);
        this.seekToPosition(percentage);
        console.log('[ModViewer] Progress bar changed to:', percentage + '%');
      });
    }
    
    // Setup volume control
    this.setupVolumeControl();
  }
  
  setupVolumeControl() {
    if (this.volumeSlider) {
      this.volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value / 100;
        
        // Update volume display
        const volumeDisplay = this.element ? this.element.querySelector('#volumeDisplay') : null;
        if (volumeDisplay) {
          volumeDisplay.textContent = e.target.value + '%';
        }
        
        if (this.audioResource && window.gameEditor) {
          const resourceId = window.gameEditor.getLoadedResourceId(this.getFileName());
          if (resourceId) {
            window.gameEditor.audioEngine.setSongVolume(resourceId, volume);
          }
        }
      });
    }
  }
  
  handleProgressScrub(event) {
    console.log('[ModViewer] handleProgressScrub called, duration:', this.duration);
    
    if (!this.duration || this.duration <= 0) {
      console.warn('[ModViewer] Cannot scrub - no valid duration');
      return;
    }
    
    if (!this.progressBar) {
      console.warn('[ModViewer] Cannot scrub - no progress bar element');
      return;
    }
    
    const rect = this.progressBar.getBoundingClientRect();
    const clientX = event.type.startsWith('touch') ? event.touches[0].clientX : event.clientX;
    const position = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newTime = position * this.duration;
    
    // Update progress bar and time display immediately
    this.progressBar.value = position * 100;
    this.currentTime = newTime;
    this.updateTimeDisplay(newTime);
    
    console.log('[ModViewer] Scrubbing to:', this.formatTime(newTime), `(${(position * 100).toFixed(1)}%)`);
    
    // Note: Actual seeking would need to be implemented in the audio engine
    // For now, this just updates the visual position
  }
  
  seekToPosition(percentage) {
    if (!this.duration || this.duration <= 0) return;
    
    const newTime = (percentage / 100) * this.duration;
    this.currentTime = newTime;
    this.updateTimeDisplay(newTime);
    
    console.log('[ModViewer] Seek to position:', this.formatTime(newTime), `(${percentage.toFixed(1)}%)`);
    
    // TODO: Implement actual MOD seeking in the audio engine
    // For now, just update the display position
    console.warn('[ModViewer] MOD seeking not yet implemented - only visual position updated');
  }
  
  async loadAudioResource() {
    if (!window.gameEditor) {
      this.updateStatus('Audio engine not available');
      return;
    }

    try {
      const name = this.getFileName();
      console.log('[ModViewer] Loading audio resource for:', name);
      
      // First try to get already loaded resource
      let resourceId = window.gameEditor.getLoadedResourceId(name);
      
      if (resourceId) {
        // File already loaded
        this.audioResource = window.gameEditor.audioEngine.getResource(resourceId);
        console.log(`[ModViewer] File already loaded: ${name}`);
        
        // Get duration from the resource
        if (this.audioResource && this.audioResource.duration && this.audioResource.duration > 0) {
          this.duration = this.audioResource.duration;
          console.log('[ModViewer] Got duration from loaded resource:', this.duration);
        }
        
        this.updateStatus('Loaded');
        this.updateMetadata();
        this.updateTimeDisplay();
        this.updateProgressBar();
        return;
      }

      // File not loaded yet, load it on demand
      console.log('[ModViewer] File not loaded, loading on demand...');
      this.updateStatus('Loading...');
      
      resourceId = await window.gameEditor.loadAudioFileOnDemand(name);
      
      if (resourceId) {
        this.audioResource = window.gameEditor.audioEngine.getResource(resourceId);
        console.log(`[ModViewer] Loaded resource for: ${name}`);
        
        this.updateStatus('Loaded');
        this.updateMetadata();
        
        // Get duration directly from the resource - it should be available immediately after analysis
        if (this.audioResource && this.audioResource.duration && this.audioResource.duration > 0) {
          this.duration = this.audioResource.duration;
          console.log('[ModViewer] Got duration from resource:', this.duration);
        } else {
          console.log('[ModViewer] No duration in resource yet, will be updated via notification');
          this.duration = 0; // Will show "Loading..." until available
        }
        
        this.updateTimeDisplay();
        this.updateProgressBar();
      } else {
        this.updateStatus('Failed to load audio resource');
      }
    } catch (error) {
      console.error('[ModViewer] Failed to load audio resource:', error);
      this.updateStatus(`Error: ${error.message}`);
    }
  }

  // Called when a resource is updated (e.g., when duration becomes available)
  onResourceUpdated(property, value) {
    console.log(`[ModViewer] onResourceUpdated called: ${property} = ${value}`);
    
    if (property === 'duration' && value > 0) {
      this.duration = value;
      console.log(`[ModViewer] Duration updated to: ${value}`);
      this.updateTimeDisplay();
      this.updateProgressBar();
    }
  }

  updateStatus(status) {
    // Use container-scoped query instead of getElementById to avoid conflicts between tabs
    const statusElement = this.element ? this.element.querySelector('#loadStatus') : null;
    if (statusElement) {
      statusElement.textContent = status;
    }
  }
  
  updateMetadata() {
    const metadataContent = this.element ? this.element.querySelector('#metadataContent') : null;
    if (!metadataContent) return;
    
    if (this.audioResource) {
  const baseName = this.getFileName();
  const ext = baseName.substring(baseName.lastIndexOf('.')).toLowerCase();
      const formatName = this.getFormatName(ext);
      
      metadataContent.innerHTML = `
        <div class="metadata-row">
          <strong>Format:</strong> ${formatName}
        </div>
        <div class="metadata-row">
          <strong>File Size:</strong> ${this.getFileSize()}
        </div>
        <div class="metadata-row">
          <strong>Duration:</strong> ${this.audioResource.duration ? this.formatDuration(this.audioResource.duration) : 'Unknown'}
        </div>
        <div class="metadata-row">
          <strong>Resource ID:</strong> ${this.audioResource.id}
        </div>
      `;
    } else {
      metadataContent.innerHTML = '<p>Resource not loaded</p>';
    }
  }
  
  getFormatName(ext) {
    const formats = {
      '.mod': 'ProTracker MOD',
      '.xm': 'FastTracker II Extended Module',
      '.s3m': 'Scream Tracker 3 Module',
      '.it': 'Impulse Tracker Module',
      '.mptm': 'OpenMPT Module'
    };
    
    return formats[ext] || ext.toUpperCase();
  }
  
  formatTime(seconds) {
    // Handle invalid inputs
    if (isNaN(seconds) || seconds < 0) {
      return "0:00";
    }
    
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  
  async togglePlayback() {
    if (!window.gameEditor || !this.audioResource) {
      alert('Audio resource not available');
      return;
    }

  const resourceId = window.gameEditor.getLoadedResourceId(this.getFileName());
    if (!resourceId) {
      alert('Resource not loaded in audio engine');
      return;
    }

    try {
      if (this.isPlaying) {
        // Stop playback completely (since pause/resume might not work properly)
        window.gameEditor.audioEngine.stopSong(resourceId);
        this.isPlaying = false;
        this.isPaused = false;
        this.updatePlayPauseButton();
        this.stopProgressTracking();
        this.stopVisualization(); // Stop FFT visualization
        console.log('[ModViewer] Stopped playback');
      } else {
        // Start fresh playback
        console.log('[ModViewer] Starting playback...');
        
        // Ensure clean state
        window.gameEditor.audioEngine.stopSong(resourceId);
        
        const volume = this.volumeSlider ? this.volumeSlider.value / 100 : 0.7;
        
        // Check if AudioContext is suspended and needs to be resumed
        if (window.gameEditor.audioEngine.audioContext.state === 'suspended') {
          console.log('[ModViewer] AudioContext suspended, resuming...');
          try {
            await window.gameEditor.audioEngine.audioContext.resume();
            console.log('[ModViewer] AudioContext resumed, new state:', window.gameEditor.audioEngine.audioContext.state);
          } catch (error) {
            console.warn('[ModViewer] Failed to resume AudioContext:', error);
            return;
          }
        }

        // Small delay to ensure clean state
        await new Promise(resolve => setTimeout(resolve, 100));

        const success = await window.gameEditor.audioEngine.startSong(resourceId, volume, true);
        console.log('[ModViewer] startSong result:', success);
        
        if (success) {
          this.isPlaying = true;
          this.isPaused = false;
          this.currentTime = 0; // Reset to beginning
          this.updatePlayPauseButton();
          this.startProgressTracking();
          this.startVisualization(); // Start FFT visualization
          
          // Duration should already be available from loading
          this.updateTimeDisplay();
        } else {
          console.warn('[ModViewer] Failed to start song playback');
          alert('Failed to start playback');
        }
      }
    } catch (error) {
      console.error('[ModViewer] Playback error:', error);
      alert(`Playback error: ${error?.message || 'Unknown error'}`);
    }
  }

  checkForUpdatedDuration(resourceId) {
    if (!window.gameEditor || !resourceId) return;
    
    const resource = window.gameEditor.audioEngine.getResource(resourceId);
    if (resource && resource.duration !== null && resource.duration > 0) {
      if (resource.duration !== this.duration) {
        console.log('[ModViewer] Found updated duration:', resource.duration, 'vs current:', this.duration);
        this.duration = resource.duration;
        this.updateTimeDisplay();
        this.updateProgressBar();
      }
    } else {
      console.log('[ModViewer] Resource duration still null or zero, checking again...');
    }
  }
  
  updatePlayPauseButton() {
    // Re-lookup button if it's missing
    if (!this.playPauseButton) {
      console.warn('[ModViewer] playPauseButton not found, attempting re-lookup');
      this.playPauseButton = this.element?.querySelector('#playPauseBtn');
      if (!this.playPauseButton) {
        console.error('[ModViewer] playPauseButton still not found after re-lookup');
        return;
      }
    }

    const icon = this.playPauseButton.querySelector('.play-icon');
    if (!icon) {
      console.warn('[ModViewer] play-icon not found');
      return;
    }

    if (this.isPlaying) {
      icon.textContent = '⏸️';
      this.playPauseButton.classList.add('playing');
      console.log('[ModViewer] Button set to pause state');
    } else {
      icon.textContent = '▶️';
      this.playPauseButton.classList.remove('playing');
      console.log('[ModViewer] Button set to play state');
    }
  }  startProgressTracking() {
    this.stopProgressTracking(); // Clear any existing interval
    
    console.log('[ModViewer] Starting progress tracking');
    
    this.progressInterval = setInterval(() => {
      if (this.isPlaying && !this.isPaused && !this.isDragging) {
        this.currentTime += 0.5; // Update every 500ms
        
        console.log('[ModViewer] Progress update - currentTime:', this.currentTime, 'duration:', this.duration);
        
        if (this.currentTime >= this.duration && this.duration > 0) {
          this.currentTime = this.duration;
          this.isPlaying = false;
          this.isPaused = false;
          this.updatePlayPauseButton();
          this.stopProgressTracking();
          console.log('[ModViewer] Song finished');
        }
        
        this.updateTimeDisplay();
        this.updateProgressBar();
      }
    }, 500);
  }
  
  stopProgressTracking() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }
  
  updateTimeDisplay(time = this.currentTime) {
    // Ensure we have valid numbers
    const currentTime = isNaN(time) ? 0 : time;
    const duration = isNaN(this.duration) ? 0 : this.duration;
    
    console.log('[ModViewer] updateTimeDisplay called with:', { currentTime, duration, thisDuration: this.duration });
    
    if (this.currentTimeSpan) {
      this.currentTimeSpan.textContent = this.formatTime(currentTime);
    }
    if (this.durationSpan) {
      // Show "Loading..." if we don't have a real duration yet
      if (duration === 0 || duration === null || isNaN(duration)) {
        this.durationSpan.textContent = "Loading...";
        console.log('[ModViewer] Showing Loading... for duration:', duration);
      } else {
        this.durationSpan.textContent = this.formatTime(duration);
        console.log('[ModViewer] Showing formatted time:', this.formatTime(duration));
      }
    }
  }
  
  updateProgressBar() {
    if (!this.progressBar) {
      // Try to find the progress bar element again
      if (this.element) {
        this.progressBar = this.element.querySelector('#progressBar');
      }
    }
    
    if (!this.progressBar) {
      console.warn('[ModViewer] Progress bar element not found');
      return;
    }
    
    if (this.duration > 0) {
      const percentage = Math.min(100, Math.max(0, (this.currentTime / this.duration) * 100));
      this.progressBar.value = percentage;
      console.log('[ModViewer] Progress bar updated to:', percentage.toFixed(1) + '%', 'currentTime:', this.currentTime, 'duration:', this.duration);
    } else {
      this.progressBar.value = 0;
      console.log('[ModViewer] Progress bar set to 0% (no duration)');
    }
    
    // Also update the time display to ensure duration label is current
    this.updateTimeDisplay();
  }
  
  // Lifecycle methods
  loseFocus() {
    // Stop (not pause) playback when tab loses focus - MOD doesn't support true pause
    console.log('[ModViewer] loseFocus called - checking playback state');
  console.log('[ModViewer] isPlaying:', this.isPlaying, 'file:', this.getFileName());
    
    try {
      if (this.isPlaying) {
        console.log('[ModViewer] Stopping playback due to focus loss');
        this.stopPlayback();
      } else {
        console.log('[ModViewer] No playback to stop');
      }
    } catch (error) {
      console.error('[ModViewer] Error stopping playback in loseFocus:', error);
    }
  }

  cleanup() {
    // Complete cleanup when viewer is being destroyed
    console.log('[ModViewer] Cleaning up MOD viewer');
    try {
      this.stopPlayback();
      this.stopVisualization(); // Stop FFT visualization
      
      // Stop duration polling
      if (this.durationPollingInterval) {
        clearInterval(this.durationPollingInterval);
        this.durationPollingInterval = null;
      }
      
      // Clear any other intervals
      this.stopProgressTracking();
      
    } catch (error) {
      console.error('[ModViewer] Error in cleanup:', error);
    }
  }

  // Legacy support - map old methods to new interface
  onBlur() {
    this.loseFocus();
  }

  destroy() {
    // Call our cleanup method first
    this.cleanup();
    
    // Then do any additional cleanup
    // Remove document event listeners to prevent memory leaks
    if (this.boundMouseMove) {
      document.removeEventListener('mousemove', this.boundMouseMove);
    }
    if (this.boundMouseUp) {
      document.removeEventListener('mouseup', this.boundMouseUp);
    }
    
    // Stop visualization
    this.stopVisualization();
    
    super.destroy();
  }
  
  stopPlayback() {
    console.log('[ModViewer] stopPlayback called, isPlaying:', this.isPlaying);
    
    if (!this.isPlaying || !window.gameEditor) {
      console.log('[ModViewer] Not playing or no game editor, but clearing buffers anyway');
      // Even if not playing, clear buffers to prevent static
      if (window.gameEditor && window.gameEditor.audioEngine) {
        try {
          window.gameEditor.audioEngine.stopAllAudio();
        } catch (error) {
          console.error('[ModViewer] Error clearing audio buffers:', error);
        }
      }
      return;
    }
    
    try {
  const resourceId = window.gameEditor.getLoadedResourceId(this.getFileName());
      if (resourceId) {
        console.log('[ModViewer] Stopping song for resource:', resourceId);
        window.gameEditor.audioEngine.stopSong(resourceId);
      }
      
      // Also perform comprehensive audio cleanup
      window.gameEditor.audioEngine.stopAllAudio();
    } catch (error) {
      console.error('[ModViewer] Error stopping playback:', error);
      // Try emergency stop as fallback
      try {
        window.gameEditor.audioEngine.emergencyAudioStop();
      } catch (emergencyError) {
        console.error('[ModViewer] Emergency stop also failed:', emergencyError);
      }
    }
    
    this.isPlaying = false;
    this.isPaused = false;
    this.currentTime = 0;
    this.stopProgressTracking();
    this.stopVisualization(); // Stop FFT visualization
    
    try {
      this.updatePlayPauseButton();
      this.updateTimeDisplay();
      this.updateProgressBar();
    } catch (error) {
      console.error('[ModViewer] Error updating UI after stop:', error);
    }
  }

  getFileInfo() {
    const baseInfo = super.getFileInfo();
    
    if (this.audioResource) {
  const baseName = this.getFileName();
  baseInfo.push(`Format: ${this.getFormatName(baseName.substring(baseName.lastIndexOf('.')))}`);
      if (this.audioResource.duration) {
        baseInfo.push(`Duration: ${this.formatDuration(this.audioResource.duration)}`);
      }
      baseInfo.push(`Resource ID: ${this.audioResource.id}`);
    }
    
    return baseInfo;
  }
  
  onFocus() {
    // Refresh status when tab becomes active
    this.loadAudioResource();
  }
  
  // Remove duplicate destroy; cleanup() already stops audio and super.destroy handles DOM removal
}

// Export for use
window.ModViewer = ModViewer;

// Static metadata for auto-registration
ModViewer.getFileExtensions = () => ['.mod', '.xm', '.s3m', '.it', '.mptm'];
ModViewer.getDisplayName = () => 'MOD Viewer';
ModViewer.getIcon = () => '🎵';
ModViewer.getPriority = () => 10;
ModViewer.getCapabilities = () => ['audio-playback', 'visualization'];
