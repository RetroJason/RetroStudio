// sound-fx-editor.js - Clean implementation with proper jsfxr integration

class SoundFXEditor extends CompoundEditor {
  constructor(path, isNewResource = false) {
    super(path, isNewResource);
    console.log('[SoundFXEditor] Constructor called for', path);
    
    this.audioContext = null;
    this.audioBuffer = null;
    this.previewSource = null;
    this.waveformDisplay = null;
    this.controlsContainer = null;
    this.isLooping = false;
    
    // Default SFXR parameters
    this.defaultParameters = {
      wave_type: 0,           // Square wave
      p_base_freq: 0.3,       // Base frequency
      p_freq_limit: 0,        // Frequency limit
      p_freq_ramp: 0,         // Frequency ramp
      p_freq_dramp: 0,        // Frequency delta ramp
      p_vib_strength: 0,      // Vibrato strength
      p_vib_speed: 0,         // Vibrato speed
      p_env_attack: 0,        // Attack time
      p_env_sustain: 0.3,     // Sustain time
      p_env_punch: 0,         // Sustain punch
      p_env_decay: 0.4,       // Decay time
      p_arp_mod: 0,           // Arpeggio mod
      p_arp_speed: 0,         // Arpeggio speed
      p_duty: 0,              // Square duty
      p_duty_ramp: 0,         // Duty ramp
      p_repeat_speed: 0,      // Repeat speed
      p_pha_offset: 0,        // Phaser offset
      p_pha_ramp: 0,          // Phaser ramp
      p_lpf_freq: 1,          // Low-pass filter frequency
      p_lpf_ramp: 0,          // Low-pass filter ramp
      p_lpf_resonance: 0,     // Low-pass filter resonance
      p_hpf_freq: 0,          // High-pass filter frequency
      p_hpf_ramp: 0           // High-pass filter ramp
    };
    
    this.parameters = { ...this.defaultParameters };
  }

  getDisplayName() {
    return 'Sound FX Editor';
  }

  createBody(parentContainer) {
    console.log('[SoundFXEditor] createBody called');
    
    parentContainer.innerHTML = `
      <div class="sound-fx-editor">
        <!-- Fixed Controls -->
        <div class="fixed-controls">
          <div class="control-group">
            <button id="play-btn" class="control-btn">▶ Play</button>
            <button id="stop-btn" class="control-btn">⏹ Stop</button>
            <button id="mutate-btn" class="control-btn">🎲 Mutate</button>
            <label class="loop-control">
              <input type="checkbox" id="loop-checkbox"> Loop
            </label>
            <button id="preview-btn" class="control-btn">🔊 Preview</button>
          </div>
        </div>

        <!-- Parameters Area -->
        <div class="parameters-scroll">
          <div class="parameters-grid">
            <!-- Column 1 -->
            <div class="param-column">
              <div class="param-section">
                <h4>Waveform</h4>
                <div class="param-row">
                  <label>Wave type:</label>
                  <select id="wave_type_select" name="wave_type" class="param-select">
                    <option value="0">Square</option>
                    <option value="1">Sawtooth</option>
                    <option value="2">Sine</option>
                    <option value="3">Noise</option>
                  </select>
                  <span></span>
                </div>
              </div>

              <div class="param-section">
                <h4>Envelope</h4>
                <div class="param-row">
                  <label>Attack:</label>
                  <input type="range" name="p_env_attack" min="0" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
                <div class="param-row">
                  <label>Sustain:</label>
                  <input type="range" name="p_env_sustain" min="0" max="1" step="0.01" value="0.3" class="param-slider">
                  <span class="param-value">0.3</span>
                </div>
                <div class="param-row">
                  <label>Punch:</label>
                  <input type="range" name="p_env_punch" min="0" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
                <div class="param-row">
                  <label>Decay:</label>
                  <input type="range" name="p_env_decay" min="0" max="1" step="0.01" value="0.4" class="param-slider">
                  <span class="param-value">0.4</span>
                </div>
              </div>

              <div class="param-section">
                <h4>Frequency</h4>
                <div class="param-row">
                  <label>Base frequency:</label>
                  <input type="range" name="p_base_freq" min="0" max="1" step="0.01" value="0.3" class="param-slider">
                  <span class="param-value">0.3</span>
                </div>
                <div class="param-row">
                  <label>Frequency limit:</label>
                  <input type="range" name="p_freq_limit" min="0" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
                <div class="param-row">
                  <label>Frequency ramp:</label>
                  <input type="range" name="p_freq_ramp" min="-1" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
                <div class="param-row">
                  <label>Frequency delta:</label>
                  <input type="range" name="p_freq_dramp" min="-1" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
              </div>

              <div class="param-section">
                <h4>Vibrato</h4>
                <div class="param-row">
                  <label>Strength:</label>
                  <input type="range" name="p_vib_strength" min="0" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
                <div class="param-row">
                  <label>Speed:</label>
                  <input type="range" name="p_vib_speed" min="0" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
              </div>
            </div>

            <!-- Column 2 -->
            <div class="param-column">
              <div class="param-section">
                <h4>Arpeggio</h4>
                <div class="param-row">
                  <label>Mod:</label>
                  <input type="range" name="p_arp_mod" min="-1" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
                <div class="param-row">
                  <label>Speed:</label>
                  <input type="range" name="p_arp_speed" min="0" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
              </div>

              <div class="param-section">
                <h4>Duty (Square Wave)</h4>
                <div class="param-row">
                  <label>Duty:</label>
                  <input type="range" name="p_duty" min="0" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
                <div class="param-row">
                  <label>Duty ramp:</label>
                  <input type="range" name="p_duty_ramp" min="-1" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
              </div>

              <div class="param-section">
                <h4>Repeat</h4>
                <div class="param-row">
                  <label>Repeat speed:</label>
                  <input type="range" name="p_repeat_speed" min="0" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
              </div>

              <div class="param-section">
                <h4>Phaser</h4>
                <div class="param-row">
                  <label>Offset:</label>
                  <input type="range" name="p_pha_offset" min="-1" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
                <div class="param-row">
                  <label>Ramp:</label>
                  <input type="range" name="p_pha_ramp" min="-1" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
              </div>

              <div class="param-section">
                <h4>Low-pass Filter</h4>
                <div class="param-row">
                  <label>Frequency:</label>
                  <input type="range" name="p_lpf_freq" min="0" max="1" step="0.01" value="1" class="param-slider">
                  <span class="param-value">1</span>
                </div>
                <div class="param-row">
                  <label>Ramp:</label>
                  <input type="range" name="p_lpf_ramp" min="-1" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
                <div class="param-row">
                  <label>Resonance:</label>
                  <input type="range" name="p_lpf_resonance" min="0" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
              </div>

              <div class="param-section">
                <h4>High-pass Filter</h4>
                <div class="param-row">
                  <label>Frequency:</label>
                  <input type="range" name="p_hpf_freq" min="0" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
                <div class="param-row">
                  <label>Ramp:</label>
                  <input type="range" name="p_hpf_ramp" min="-1" max="1" step="0.01" value="0" class="param-slider">
                  <span class="param-value">0</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Audio Preview Popup -->
        <div id="audio-preview-popup" class="audio-popup" style="display: none;">
          <div class="popup-content">
            <div class="popup-header">
              <h3>Audio Preview</h3>
              <button class="close-btn" id="close-popup-btn">×</button>
            </div>
            <div class="waveform-container" id="waveform-container">
              <!-- Waveform display will be added here -->
            </div>
            <div id="audio-status" class="audio-status">Ready</div>
            <div id="preview-controls" class="preview-controls">
              <!-- Preview controls will be added here -->
            </div>
          </div>
        </div>
      </div>
    `;

    this.controlsContainer = parentContainer.querySelector('.sound-fx-editor');
    this.setupEventListeners();
    this.loadParametersIntoUI();
    
    console.log('[SoundFXEditor] createBody completed');
  }

  setupEventListeners() {
    if (!this.controlsContainer) return;

    // Control buttons
    const playBtn = this.controlsContainer.querySelector('#play-btn');
    const stopBtn = this.controlsContainer.querySelector('#stop-btn');
    const mutateBtn = this.controlsContainer.querySelector('#mutate-btn');
    const previewBtn = this.controlsContainer.querySelector('#preview-btn');
    const loopCheckbox = this.controlsContainer.querySelector('#loop-checkbox');

    if (playBtn) playBtn.addEventListener('click', () => this.playPreview());
    if (stopBtn) stopBtn.addEventListener('click', () => this.stopPreview());
    if (mutateBtn) mutateBtn.addEventListener('click', () => this.mutateParameters());
    if (previewBtn) previewBtn.addEventListener('click', () => this.showAudioPreview());
    if (loopCheckbox) loopCheckbox.addEventListener('change', (e) => {
      this.isLooping = e.target.checked;
    });

    // Parameter controls
    const waveTypeSelect = this.controlsContainer.querySelector('#wave_type_select');
    if (waveTypeSelect) {
      waveTypeSelect.addEventListener('change', (e) => {
        this.parameters.wave_type = parseInt(e.target.value);
        this.updateWaveformPreview();
        this.playPreview(); // Auto-play on change
      });
    }

    // Parameter sliders
    const sliders = this.controlsContainer.querySelectorAll('.param-slider');
    sliders.forEach(slider => {
      slider.addEventListener('input', (e) => {
        const paramName = e.target.name;
        const value = parseFloat(e.target.value);
        this.parameters[paramName] = value;
        
        // Update value display
        const valueSpan = e.target.parentNode.querySelector('.param-value');
        if (valueSpan) {
          valueSpan.textContent = value.toFixed(2);
        }
        
        this.updateWaveformPreview();
        this.playPreview(); // Auto-play on change
      });
    });

    // Audio preview popup
    const closePopupBtn = this.controlsContainer.querySelector('#close-popup-btn');
    if (closePopupBtn) {
      closePopupBtn.addEventListener('click', () => this.hideAudioPreview());
    }
  }

  loadParametersIntoUI() {
    console.log('[SoundFXEditor] Loading parameters into UI');
    
    if (!this.controlsContainer) {
      console.warn('[SoundFXEditor] Controls container not available');
      return;
    }

    // Update wave type dropdown
    const waveTypeSelect = this.controlsContainer.querySelector('#wave_type_select');
    if (waveTypeSelect) {
      waveTypeSelect.value = this.parameters.wave_type || 0;
    }

    // Update all parameter sliders
    Object.keys(this.parameters).forEach(key => {
      if (key === 'wave_type') return; // Already handled above
      
      const slider = this.controlsContainer.querySelector(`input[name="${key}"]`);
      if (slider) {
        slider.value = this.parameters[key];
        
        // Update value display
        const valueSpan = slider.parentNode.querySelector('.param-value');
        if (valueSpan) {
          valueSpan.textContent = this.parameters[key].toFixed(2);
        }
      }
    });
  }

  async synthesizeAudio() {
    console.log('[SoundFXEditor] Synthesizing audio with jsfxr parameters:', this.parameters);
    
    try {
      // Initialize audio context if needed
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      // Ensure jsfxr is available
      if (typeof window.sfxr === 'undefined') {
        throw new Error('jsfxr library not loaded');
      }
      
      // Create jsfxr parameters object
      const params = new window.Params();
      
      // Map our parameters to jsfxr format
      Object.keys(this.parameters).forEach(key => {
        params[key] = this.parameters[key];
      });
      
      // Use jsfxr to generate WebAudio AudioBuffer
      const audioBuffer = window.sfxr.toWebAudio(params, this.audioContext);
      
      this.audioBuffer = audioBuffer;
      console.log('[SoundFXEditor] Audio synthesis complete, buffer length:', audioBuffer.length);
      return audioBuffer;

    } catch (error) {
      console.error('[SoundFXEditor] Error during audio synthesis:', error);
      throw error;
    }
  }

  async playPreview() {
    console.log('[SoundFXEditor] Playing audio preview');
    
    try {
      // Stop any currently playing audio
      this.stopPreview();
      
      // Synthesize audio
      await this.synthesizeAudio();
      
      if (this.audioBuffer && this.audioContext) {
        // Create and play audio source
        this.previewSource = this.audioContext.createBufferSource();
        this.previewSource.buffer = this.audioBuffer;
        this.previewSource.connect(this.audioContext.destination);
        this.previewSource.loop = this.isLooping;
        
        // Handle playback end
        this.previewSource.onended = () => {
          this.previewSource = null;
        };
        
        this.previewSource.start();
        console.log('[SoundFXEditor] Audio preview started');
      }
    } catch (error) {
      console.error('[SoundFXEditor] Error playing preview:', error);
    }
  }

  stopPreview() {
    if (this.previewSource) {
      try {
        this.previewSource.stop();
        this.previewSource = null;
        console.log('[SoundFXEditor] Audio preview stopped');
      } catch (error) {
        console.warn('[SoundFXEditor] Error stopping preview:', error);
      }
    }
  }

  mutateParameters() {
    console.log('[SoundFXEditor] Mutating parameters');
    
    // Randomly adjust some parameters
    const paramKeys = Object.keys(this.parameters);
    const numToMutate = Math.floor(Math.random() * 5) + 2; // Mutate 2-6 parameters
    
    for (let i = 0; i < numToMutate; i++) {
      const randomKey = paramKeys[Math.floor(Math.random() * paramKeys.length)];
      if (randomKey === 'wave_type') {
        this.parameters[randomKey] = Math.floor(Math.random() * 4);
      } else {
        // Add random variation
        const variation = (Math.random() - 0.5) * 0.4; // ±0.2 variation
        this.parameters[randomKey] = Math.max(-1, Math.min(1, this.parameters[randomKey] + variation));
      }
    }
    
    this.loadParametersIntoUI();
    this.updateWaveformPreview();
    this.playPreview();
  }

  showAudioPreview() {
    const popup = this.controlsContainer.querySelector('#audio-preview-popup');
    if (popup) {
      popup.style.display = 'block';
      
      // Initialize waveform display
      setTimeout(() => {
        this.initializeWaveform();
      }, 100);
    }
  }

  hideAudioPreview() {
    const popup = this.controlsContainer.querySelector('#audio-preview-popup');
    if (popup) {
      popup.style.display = 'none';
    }
  }

  initializeWaveform() {
    const waveformContainer = this.controlsContainer.querySelector('#waveform-container');
    if (waveformContainer && window.WaveformDisplay && !this.waveformDisplay) {
      setTimeout(() => {
        this.waveformDisplay = new WaveformDisplay(waveformContainer, {
          width: 600,
          height: 200
        });
        
        // Generate initial waveform
        this.updateWaveformPreview();
      }, 50);
    }
  }

  async updateWaveformPreview() {
    console.log('[SoundFXEditor] updateWaveformPreview called, waveformDisplay:', !!this.waveformDisplay);
    if (!this.waveformDisplay) return;
    
    try {
      // Synthesize audio for waveform
      const audioBuffer = await this.synthesizeAudio();
      console.log('[SoundFXEditor] Got audioBuffer for waveform:', audioBuffer);
      if (audioBuffer) {
        console.log('[SoundFXEditor] Calling updateWaveform with buffer, length:', audioBuffer.length);
        this.waveformDisplay.updateWaveform(audioBuffer);
        
        const statusEl = this.controlsContainer.querySelector('#audio-status');
        if (statusEl) {
          statusEl.textContent = `Generated: wave type ${this.parameters.wave_type}, ${audioBuffer.length} samples`;
        }
      }
    } catch (error) {
      console.error('[SoundFXEditor] Failed to update waveform preview:', error);
      
      const statusEl = this.controlsContainer.querySelector('#audio-status');
      if (statusEl) {
        statusEl.textContent = 'Error generating preview';
      }
    }
  }

  // File handling methods
  getContent() {
    return this.parametersToJson(this.parameters);
  }

  setContent(content) {
    console.log('[SoundFXEditor] Setting content:', content);
    
    try {
      if (typeof content === 'object' && content.fileContent) {
        content = content.fileContent;
      }
      
      if (typeof content === 'string') {
        this.parameters = this.jsonToParameters(content);
      } else {
        console.warn('[SoundFXEditor] Unexpected content type:', typeof content);
        this.parameters = { ...this.defaultParameters };
      }
      
      this.loadParametersIntoUI();
      this.updateWaveformPreview();
      
    } catch (error) {
      console.error('[SoundFXEditor] Error setting content:', error);
      this.parameters = { ...this.defaultParameters };
    }
  }

  parametersToJson(params) {
    const saveData = {
      type: "sound_fx",
      version: "1.0",
      parameters: params
    };
    return JSON.stringify(saveData, null, 2);
  }

  jsonToParameters(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      
      // If it has SFXR parameters, use them
      if (data.parameters) {
        return { ...this.defaultParameters, ...data.parameters };
      }
      
      // Fallback to defaults
      console.warn('[SoundFXEditor] No parameters found in JSON, using defaults');
      return { ...this.defaultParameters };
      
    } catch (error) {
      console.error('[SoundFXEditor] Error parsing JSON:', error);
      return { ...this.defaultParameters };
    }
  }

  // Static methods for editor registration
  static getFileExtension() {
    return '.sfx';
  }

  static getDisplayName() {
    return 'Sound FX';
  }

  static getDirectory() {
    return 'Resources/SFX';
  }

  static createNew() {
    // Return SFX structure with SFXR parameters
    return JSON.stringify({
      type: 'sound_fx',
      version: '1.0',
      parameters: {
        wave_type: 0,
        p_base_freq: 0.3,
        p_freq_limit: 0,
        p_freq_ramp: 0,
        p_freq_dramp: 0,
        p_vib_strength: 0,
        p_vib_speed: 0,
        p_env_attack: 0,
        p_env_sustain: 0.3,
        p_env_punch: 0,
        p_env_decay: 0.4,
        p_arp_mod: 0,
        p_arp_speed: 0,
        p_duty: 0,
        p_duty_ramp: 0,
        p_repeat_speed: 0,
        p_pha_offset: 0,
        p_pha_ramp: 0,
        p_lpf_freq: 1,
        p_lpf_ramp: 0,
        p_lpf_resonance: 0,
        p_hpf_freq: 0,
        p_hpf_ramp: 0
      }
    }, null, 2);
  }
}

// Export the class
window.SoundFXEditor = SoundFXEditor;
