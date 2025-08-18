// sound-fx-editor.js - Clean implementation with proper jsfxr integration
// VERSION: 2.1 - Added Create New button and save prompting functionality

console.log('[SoundFXEditor] Class definition loading - NEW CONSTRUCTOR VERSION 2.1');

class SoundFXEditor extends CompoundEditor {
  constructor(fileObject = null, readOnly = false) {
    super(fileObject, readOnly);
    console.log(`[SoundFXEditor] Constructor called with NEW SIGNATURE: ${fileObject} ${readOnly}`);
    
    this.audioContext = null;
    this.audioBuffer = null;
    this.previewSource = null;
    this.controlsContainer = null;
    this.isLooping = false;
    this.isPlaying = false;
    
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
    this.isInitializing = true; // Flag to prevent operations during setup
    
    // Load file data if we have a file object
    if (fileObject && !this.isNewResource) {
      this.loadFileData();
    }
  }

  async loadFileData() {
    console.log(`[SoundFXEditor] loadFileData called with path: ${this.path}`);
    try {
      const fileManager = window.serviceContainer?.get('fileManager');
      if (fileManager) {
        const fileObj = await fileManager.loadFile(this.path);
        if (fileObj && fileObj.fileContent) {
          console.log(`[SoundFXEditor] Loaded file content for: ${this.path}, content length: ${fileObj.fileContent.length}`);
          this.setFileData(fileObj.fileContent);
        } else {
          console.warn(`[SoundFXEditor] No file content found for: ${this.path}`);
        }
      } else {
        console.error('[SoundFXEditor] FileManager not available');
      }
    } catch (error) {
      console.error('[SoundFXEditor] Failed to load file data:', error);
    }
  }

  setFileData(content) {
    console.log(`[SoundFXEditor] setFileData called with content type: ${typeof content}`);
    console.log(`[SoundFXEditor] setFileData content preview:`, typeof content === 'string' ? content.substring(0, 100) + '...' : content);
    
    // Check if content is base64 encoded - this should NEVER happen for SFX files
    if (typeof content === 'string' && this.isBase64(content)) {
      const error = new Error('SFX files must be JSON format, not base64. Base64 encoding is not supported for SFX files.');
      console.error('[SoundFXEditor] REJECTED base64 content:', error.message);
      console.error('[SoundFXEditor] Base64 content that was rejected:', content.substring(0, 200) + '...');
      throw error;
    }
    
    try {
      let data;
      if (typeof content === 'string') {
        // Parse as JSON directly - SFX files are always JSON
        data = JSON.parse(content);
      } else {
        data = content;
      }
      
      // Extract parameters from the file data
      if (data && data.parameters) {
        this.parameters = { ...this.defaultParameters, ...data.parameters };
      } else {
        this.parameters = { ...this.defaultParameters };
      }
    } catch (error) {
      console.error('[SoundFXEditor] Failed to parse JSON file data:', error);
      console.error('[SoundFXEditor] Content that failed to parse:', content);
      throw new Error(`Invalid SFX file format: ${error.message}`);
    }
  }

  // Helper method to detect base64 content
  isBase64(str) {
    // Base64 strings are typically long, contain only base64 characters, and don't start with JSON characters
    if (str.length < 10) return false;
    if (str.trim().startsWith('{') || str.trim().startsWith('[')) return false; // Looks like JSON
    
    // Check if it contains only base64 characters (and is reasonably long)
    const base64Regex = /^[A-Za-z0-9+/]+=*$/;
    return base64Regex.test(str.trim()) && str.length > 50;
  }

  getDisplayName() {
    return 'Sound FX Editor';
  }

  createBody(parentContainer) {
    const htmlContent = `
      <style>
        .param-row {
          display: grid;
          grid-template-columns: 120px 144px 60px; /* Fixed widths: Label 120px, slider 144px (~1.5"), value 60px */
          gap: 8px;
          align-items: center;
          margin-bottom: 8px;
        }
        
        .param-row label {
          text-align: left;
          font-weight: 500;
        }
        
        .param-slider {
          width: 144px; /* Approximately 1.5 inches at 96 DPI */
          height: 20px;
        }
        
        .param-value {
          text-align: center;
          font-family: monospace;
          font-size: 12px;
          min-width: 50px;
        }
        
        .param-select {
          width: 144px;
        }
        
        .parameters-grid {
          display: grid;
          grid-template-columns: 360px 360px; /* Fixed matching column widths */
          gap: 20px; /* Consistent gap between columns */
          margin-top: 10px;
          padding: 0 10px;
          justify-content: start; /* Align columns to start */
        }
        
        .param-column {
          display: flex;
          flex-direction: column;
          gap: 15px; /* Consistent spacing between sections within a column */
          width: 360px; /* Fixed width matching grid column */
        }
        
        .param-section {
          padding: 12px 15px; /* Tight but comfortable padding */
          border: 1px solid #444; /* Uniform border around each section */
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.02); /* Subtle background */
          box-sizing: border-box;
          width: 100%; /* Fill the column width exactly */
        }
        
        .param-section h4 {
          margin: 0 0 10px 0; /* Tight margins for section headers */
          font-size: 13px;
          color: #ccc;
          font-weight: 600;
        }
        
        .param-section h4 {
          margin: 0 0 10px 0;
          border-bottom: 1px solid rgba(255,255,255,0.2);
          padding-bottom: 5px;
        }
        
        .fixed-controls {
          padding: 10px;
          border-radius: 5px;
          margin-bottom: 10px;
          max-height: 100px; /* Limit the height of the entire controls area */
        }
        
        .control-group, .preset-group {
          display: flex;
          gap: 10px;
          align-items: center;
          margin-bottom: 10px;
          max-height: 40px; /* Limit height of control groups */
          flex-wrap: nowrap;
        }
        
        .control-group > * {
          flex-shrink: 0;
          flex-grow: 0;
        }
        
        /* Simple, direct styling for our waveform */
        .compact-waveform-unique {
          width: 200px !important;
          height: 34px !important;
          border: 1px solid #555 !important;
          border-radius: 4px !important;
          background: #222 !important;
          margin-left: 10px !important;
          overflow: hidden !important;
          flex-shrink: 0 !important;
          flex-grow: 0 !important;
          flex-basis: auto !important;
          min-width: 200px !important;
          max-width: 200px !important;
          min-height: 34px !important;
          max-height: 34px !important;
          box-sizing: border-box !important;
        }
        
        .compact-waveform-unique canvas {
          display: block;
          width: 200px !important;
          height: 34px !important;
          position: relative;
        }
        
        .control-btn, .preset-btn {
          padding: 8px 12px;
          border: 1px solid #555;
          border-radius: 4px;
          background: #444;
          color: #fff;
          cursor: pointer;
          font-size: 12px;
        }
        
        .play-pause-btn {
          width: 40px !important;
          padding: 8px 12px !important;
          font-size: 14px !important;
          text-align: center;
          min-width: 40px;
          max-width: 40px;
          border: 1px solid #555 !important;
          border-radius: 4px !important;
          background: #444 !important;
          color: #fff !important;
          cursor: pointer !important;
          line-height: 1.2 !important;
          box-sizing: border-box !important;
          vertical-align: middle !important;
          height: auto !important;
        }
        
        .control-btn:hover, .preset-btn:hover {
          background: #555;
        }
        
        .preset-btn {
          font-size: 11px;
          padding: 6px 10px;
        }
      </style>
      
      <div class="sound-fx-editor">
        <!-- Fixed Controls -->
        <div class="fixed-controls">
          <div class="control-group">
            <button id="mutate-btn" class="control-btn">🎲 Mutate</button>
            <button id="randomize-btn" class="control-btn">🎯 Randomize</button>
            <div class="waveform-display compact-waveform-unique" id="compact-waveform-${Date.now()}">
              <canvas id="waveform-display" width="200" height="34"></canvas>
            </div>
            <button id="play-pause-btn" class="control-btn play-pause-btn">▶</button>
            <label class="loop-control">
              <input type="checkbox" id="loop-checkbox"> Loop
            </label>
            <button id="create-new-btn" class="control-btn">💾 Save New FX</button>
          </div>
          <div class="preset-group">
            <label>Presets:</label>
            <button class="preset-btn" data-preset="pickupCoin">💰 Pickup</button>
            <button class="preset-btn" data-preset="laserShoot">🔫 Laser</button>
            <button class="preset-btn" data-preset="explosion">💥 Explosion</button>
            <button class="preset-btn" data-preset="powerUp">⚡ Power Up</button>
            <button class="preset-btn" data-preset="hitHurt">💢 Hit</button>
            <button class="preset-btn" data-preset="jump">🦘 Jump</button>
            <button class="preset-btn" data-preset="blipSelect">🎵 Blip</button>
            <button class="preset-btn" data-preset="synth">🎹 Synth</button>
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
                <div class="param-row">
                  <label>Sample rate:</label>
                  <select id="sample_rate_select" name="sample_rate" class="param-select">
                    <option value="22050">22.05 kHz</option>
                    <option value="44100" selected>44.1 kHz</option>
                    <option value="48000">48 kHz</option>
                  </select>
                  <span></span>
                </div>
                <div class="param-row">
                  <label>Sample size:</label>
                  <select id="sample_size_select" name="sample_size" class="param-select">
                    <option value="8">8-bit</option>
                    <option value="16" selected>16-bit</option>
                    <option value="24">24-bit</option>
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
        
        <!-- Credits -->
        <div style="text-align: center; margin-top: 20px; padding: 10px; font-size: 11px; color: #888;">
          Powered by <a href="https://sfxr.me/" target="_blank" style="color: #4CAF50; text-decoration: none;">Jsfxr</a>
        </div>
      </div>
    `;

    console.log('[SoundFXEditor] Setting parentContainer innerHTML');
    parentContainer.innerHTML = htmlContent;
    
    // Wait a moment for DOM to update, then find the container
    setTimeout(() => {
      console.log('[SoundFXEditor] Looking for controls container');
      this.controlsContainer = parentContainer.querySelector('.sound-fx-editor');
      
      if (!this.controlsContainer) {
        console.error('[SoundFXEditor] Failed to find .sound-fx-editor in:', parentContainer);
        console.error('[SoundFXEditor] ParentContainer innerHTML:', parentContainer.innerHTML.substring(0, 200));
        return;
      }
      
      console.log('[SoundFXEditor] Found controls container, setting up');
      this.setupEventListeners();
      
      // Load parameters
      if (!this.isNewResource) {
        this.loadFileData().then(() => {
          this.loadParametersIntoUI();
          this.isInitializing = false;
          console.log('[SoundFXEditor] Initialization complete (existing file)');
        }).catch((error) => {
          console.error('[SoundFXEditor] Error loading file data:', error);
          this.isInitializing = false;
        });
      } else {
        this.loadParametersIntoUI();
        this.isInitializing = false;
        console.log('[SoundFXEditor] Initialization complete (new file)');
      }
    }, 50); // Short delay for DOM update
  }

  setupEventListeners() {
    if (!this.controlsContainer) return;

    // Control buttons
    const createNewBtn = this.controlsContainer.querySelector('#create-new-btn');
    console.log('[SoundFXEditor] Create New button found:', createNewBtn);
    
    const playPauseBtn = this.controlsContainer.querySelector('#play-pause-btn');
    const mutateBtn = this.controlsContainer.querySelector('#mutate-btn');
    const randomizeBtn = this.controlsContainer.querySelector('#randomize-btn');
    const loopCheckbox = this.controlsContainer.querySelector('#loop-checkbox');
    const waveformContainer = this.controlsContainer.querySelector('.compact-waveform-unique');
    const waveformCanvas = waveformContainer ? waveformContainer.querySelector('#waveform-display') : null;

    if (createNewBtn) {
      createNewBtn.addEventListener('click', () => this.createNewSoundFX());
      console.log('[SoundFXEditor] Create New button event listener attached');
    } else {
      console.error('[SoundFXEditor] Create New button not found!');
    }
    if (playPauseBtn) playPauseBtn.addEventListener('click', () => this.togglePlayPause());
    if (mutateBtn) mutateBtn.addEventListener('click', () => {
      this.mutateParameters();
      // Auto-play after mutation
      setTimeout(() => this.playPreview(), 100);
    });
    if (randomizeBtn) randomizeBtn.addEventListener('click', () => {
      this.randomizeParameters();
      // Auto-play after randomization
      setTimeout(() => this.playPreview(), 100);
    });
    if (loopCheckbox) loopCheckbox.addEventListener('change', (e) => {
      this.isLooping = e.target.checked;
    });
    
    // Initialize waveform display
    if (waveformCanvas) {
      this.waveformCanvas = waveformCanvas;
      this.waveformContext = waveformCanvas.getContext('2d');
      this.drawInitialWaveform();
    }

    // Preset buttons
    const presetButtons = this.controlsContainer.querySelectorAll('.preset-btn');
    presetButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        // Prevent preset application during initialization
        if (this.isInitializing) {
          console.log('[SoundFXEditor] Ignoring preset click during initialization');
          return;
        }
        
        const presetName = e.target.dataset.preset;
        // Add delay to ensure UI is fully ready, then play
        setTimeout(() => {
          this.applyPreset(presetName);
          // Auto-play after applying preset
          setTimeout(() => this.playPreview(), 100);
        }, 50);
      });
    });

    // Parameter controls
    const waveTypeSelect = this.controlsContainer.querySelector('#wave_type_select');
    if (waveTypeSelect) {
      waveTypeSelect.addEventListener('change', (e) => {
        this.parameters.wave_type = parseInt(e.target.value);
        
        // Save the updated parameters
        this.markDirty();
        
        this.updateWaveformPreview();
        // Remove auto-play to prevent timing issues
        // this.playPreview(); // Auto-play on change
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
        
        // Save the updated parameters
        this.markDirty();
        
        this.updateWaveformPreview();
        // Remove auto-play to prevent timing issues
        // this.playPreview(); // Auto-play on change
      });
    });
  }

  loadParametersIntoUI() {
    if (!this.controlsContainer) {
      console.warn('[SoundFXEditor] Controls container not available for loadParametersIntoUI');
      return;
    }

    // Check for key DOM elements
    const waveTypeSelect = this.controlsContainer.querySelector('#wave_type_select');
    if (!waveTypeSelect) {
      console.warn('[SoundFXEditor] Wave type select not found, DOM may not be ready');
      return;
    }

    if (!this.parameters) {
      console.warn('[SoundFXEditor] No parameters available for loadParametersIntoUI');
      return;
    }

    console.log('[SoundFXEditor] Loading parameters into UI');

    // Update wave type dropdown
    waveTypeSelect.value = this.parameters.wave_type || 0;
    if (waveTypeSelect) {
      waveTypeSelect.value = this.parameters.wave_type || 0;
    }

    // Update all parameter sliders
    Object.keys(this.parameters).forEach(key => {
      if (key === 'wave_type') return; // Already handled above
      
      const slider = this.controlsContainer.querySelector(`input[name="${key}"]`);
      if (slider) {
        const value = this.parameters[key];
        slider.value = value;
        
        // Update value display
        const valueSpan = slider.parentNode.querySelector('.param-value');
        if (valueSpan) {
          valueSpan.textContent = value.toFixed(2);
        }
      }
    });

    console.log('[SoundFXEditor] UI updated with parameters:', this.parameters);
  }

  async synthesizeAudio() {
    try {
      // Initialize audio context if needed
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      // Ensure jsfxr is available
      if (typeof window.jsfxr === 'undefined' || typeof window.jsfxr.Params === 'undefined' || typeof window.jsfxr.sfxr === 'undefined') {
        throw new Error('jsfxr library not loaded correctly');
      }
      
      // Create jsfxr parameters object
      const params = new window.jsfxr.Params();
      
      // Map our parameters to jsfxr format
      Object.keys(this.parameters).forEach(key => {
        if (params.hasOwnProperty(key)) {
          params[key] = this.parameters[key];
        }
      });
      
      // Use toWebAudio to get a BufferSource with AudioBuffer
      const bufferSource = window.jsfxr.sfxr.toWebAudio(params, this.audioContext);
      
      if (bufferSource && bufferSource.buffer) {
        this.audioBuffer = bufferSource.buffer;
        return this.audioBuffer;
      } else {
        throw new Error('Failed to generate audio buffer');
      }

    } catch (error) {
      console.error('[SoundFXEditor] Error during audio synthesis:', error);
      throw error;
    }
  }

  drawInitialWaveform() {
    if (!this.waveformContext) return;
    
    const canvas = this.waveformCanvas;
    const ctx = this.waveformContext;
    
    // Clear canvas
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw a placeholder waveform
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 1;
    ctx.beginPath();
    
    const centerY = canvas.height / 2;
    const samples = 100;
    
    for (let i = 0; i < samples; i++) {
      const x = (i / samples) * canvas.width;
      const y = centerY + Math.sin(i * 0.3) * (centerY * 0.5);
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    
    ctx.stroke();
  }

  updateWaveformDisplay() {
    if (!this.waveformContext || !this.audioBuffer) {
      this.drawInitialWaveform();
      return;
    }
    
    const canvas = this.waveformCanvas;
    const ctx = this.waveformContext;
    const audioData = this.audioBuffer.getChannelData(0);
    
    // Clear canvas
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw waveform
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 1;
    ctx.beginPath();
    
    const centerY = canvas.height / 2;
    const step = Math.ceil(audioData.length / canvas.width);
    
    for (let i = 0; i < canvas.width; i++) {
      const sampleIndex = i * step;
      const sample = audioData[sampleIndex] || 0;
      const y = centerY + (sample * centerY);
      
      if (i === 0) {
        ctx.moveTo(i, y);
      } else {
        ctx.lineTo(i, y);
      }
    }
    
    ctx.stroke();
  }

  togglePlayPause() {
    if (this.isPlaying) {
      this.stopPreview();
    } else {
      this.playPreview();
    }
  }

  async playPreview() {
    try {
      // Stop any currently playing audio
      this.stopPreview();
      
      // Synthesize audio
      await this.synthesizeAudio();
      
      if (this.audioBuffer && this.audioContext) {
        // Update waveform display
        this.updateWaveformDisplay();
        
        // Create and play audio source
        this.previewSource = this.audioContext.createBufferSource();
        this.previewSource.buffer = this.audioBuffer;
        this.previewSource.connect(this.audioContext.destination);
        this.previewSource.loop = this.isLooping;
        
        // Handle playback end
        this.previewSource.onended = () => {
          this.previewSource = null;
          this.isPlaying = false;
          this.updatePlayPauseButton();
        };
        
        this.previewSource.start();
        this.isPlaying = true;
        this.updatePlayPauseButton();
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
    this.isPlaying = false;
    this.updatePlayPauseButton();
  }

          updatePlayPauseButton() {
    const playPauseBtn = this.controlsContainer?.querySelector('#play-pause-btn');
    if (playPauseBtn) {
      if (this.isPlaying) {
        playPauseBtn.textContent = '⏸';
      } else {
        playPauseBtn.textContent = '▶';
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
    
    // Save the updated parameters
    this.markDirty();
    
    this.updateWaveformPreview();
    this.playPreview();
  }

  randomizeParameters() {
    console.log('[SoundFXEditor] Randomizing all parameters');
    
    try {
      // Use jsfxr's built-in random method which ensures valid parameters
      if (typeof window.jsfxr !== 'undefined' && typeof window.jsfxr.Params !== 'undefined') {
        const randomParams = new window.jsfxr.Params();
        randomParams.random();
        
        // Copy the randomized parameters to our parameters object
        Object.keys(this.defaultParameters).forEach(key => {
          if (randomParams.hasOwnProperty(key)) {
            this.parameters[key] = randomParams[key];
          }
        });
      } else {
        // Fallback to safer manual randomization based on working presets
        this.parameters = {
          wave_type: Math.floor(Math.random() * 4),
          p_base_freq: 0.2 + Math.random() * 0.5, // Safe range 0.2-0.7
          p_freq_limit: Math.random() * 0.3,
          p_freq_ramp: (Math.random() - 0.5) * 0.8, // Reduced range
          p_freq_dramp: (Math.random() - 0.5) * 0.6, // Reduced range
          p_vib_strength: Math.random() * 0.4,
          p_vib_speed: Math.random() * 0.6,
          p_env_attack: Math.random() * 0.1,
          p_env_sustain: 0.1 + Math.random() * 0.4, // Safe range
          p_env_punch: Math.random() * 0.3,
          p_env_decay: 0.1 + Math.random() * 0.4, // Safe range
          p_arp_mod: (Math.random() - 0.5) * 0.8, // Reduced range
          p_arp_speed: Math.random() * 0.6,
          p_duty: 0.2 + Math.random() * 0.6, // Safe range
          p_duty_ramp: (Math.random() - 0.5) * 0.6, // Reduced range
          p_repeat_speed: Math.random() * 0.5,
          p_pha_offset: (Math.random() - 0.5) * 0.6, // Reduced range
          p_pha_ramp: (Math.random() - 0.5) * 0.6, // Reduced range
          p_lpf_freq: 0.3 + Math.random() * 0.6, // Safe range
          p_lpf_ramp: (Math.random() - 0.5) * 0.6, // Reduced range
          p_lpf_resonance: Math.random() * 0.5,
          p_hpf_freq: Math.random() * 0.2,
          p_hpf_ramp: (Math.random() - 0.5) * 0.4 // Reduced range
        };
      }
    } catch (error) {
      console.error('[SoundFXEditor] Error in randomization:', error);
      // Safe fallback parameters
      this.parameters = {
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
      };
    }
    
    this.loadParametersIntoUI();
    
    // Save the updated parameters
    this.markDirty();
    
    this.updateWaveformPreview();
    this.playPreview();
  }

  applyPreset(presetName) {
    console.log(`[SoundFXEditor] applyPreset called with: ${presetName}, isInitializing: ${this.isInitializing}`);
    
    try {
      // Don't apply presets during initialization
      if (this.isInitializing) {
        console.log('[SoundFXEditor] Skipping preset application during initialization');
        return;
      }
      
      // Add retry limit to prevent infinite loops
      if (!this.presetRetryCount) this.presetRetryCount = 0;
      
      // Ensure UI is ready
      if (!this.controlsContainer) {
        this.presetRetryCount++;
        if (this.presetRetryCount > 50) {
          console.error('[SoundFXEditor] Controls container setup failed after 50 retries, aborting preset application');
          this.presetRetryCount = 0;
          return;
        }
        console.warn('[SoundFXEditor] Controls container not ready for preset application, retrying...');
        setTimeout(() => this.applyPreset(presetName), 100);
        return;
      }
      
      // Reset retry count on success
      this.presetRetryCount = 0;
      
      // Ensure jsfxr is available
      if (typeof window.jsfxr === 'undefined' || typeof window.jsfxr.Params === 'undefined') {
        console.error('[SoundFXEditor] jsfxr library not loaded');
        return;
      }
      
      // Create new params object and apply preset
      const params = new window.jsfxr.Params();
      
      if (typeof params[presetName] === 'function') {
        params[presetName]();
        
        // Copy the preset parameters to our parameters object
        Object.keys(this.defaultParameters).forEach(key => {
          if (params.hasOwnProperty(key)) {
            this.parameters[key] = params[key];
          }
        });
        
        console.log('[SoundFXEditor] Applied preset parameters:', this.parameters);
        
        // Update UI sliders and dropdowns
        this.loadParametersIntoUI();
        
        // Mark as dirty but don't auto-save - let build system handle saving
        this.markDirty();
        
        this.updateWaveformPreview();
        // Remove auto-play to prevent timing issues
        // this.playPreview();
        
        console.log('[SoundFXEditor] Applied preset:', presetName);
      } else {
        console.error('[SoundFXEditor] Preset not found:', presetName);
      }
    } catch (error) {
      console.error('[SoundFXEditor] Error applying preset:', error);
    }
  }



  async updateWaveformPreview() {
    // Use the always-visible waveform display instead
    this.updateWaveformDisplay();
  }

  // File handling methods
  getContent() {
    const jsonContent = this.parametersToJson(this.parameters);
    console.log('[SoundFXEditor] getContent() returning JSON:', typeof jsonContent, jsonContent.length, 'chars');
    console.log('[SoundFXEditor] getContent() preview:', jsonContent.substring(0, 100) + '...');
    return jsonContent;
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

  // Method to create a new sound FX file while keeping the current one open
  async createNewSoundFX() {
    console.log('[SoundFXEditor] Creating new sound FX file...');
    
    try {
      // Use the same save logic as the regular save - just call saveAsNewFile directly
      await this.saveAsNewFile();
      console.log(`[SoundFXEditor] Successfully created new sound FX file via saveAsNewFile`);
      
    } catch (error) {
      console.error('[SoundFXEditor] Failed to create new sound FX file:', error);
      alert(`Failed to create new sound FX file: ${error.message}`);
    }
  }

  // Override save method to handle new files with filename prompting
  async save() {
    console.log('[SoundFXEditor] save() method called!');
    console.log(`[SoundFXEditor] save() called - isNewResource: ${this.isNewResource}, file: ${this.file}, path: ${this.path}`);
    
    if (this.isNewResource) {
      console.log('[SoundFXEditor] New file detected, prompting for filename');
      // For new files, prompt for filename and save as new
      await this.saveAsNewFile();
    } else {
      console.log('[SoundFXEditor] Existing file, saving directly');
      // For existing files, save normally
      await this.saveExistingFile();
    }
  }
  
  async saveAsNewFile() {
    // Get the sound data to save
    const soundData = this.getContent();
    
    try {
      // Use the standardized save dialog from EditorBase
      await this.saveNewResource(soundData);
      
      console.log(`[SoundFXEditor] Successfully saved new sound effect`);
      
    } catch (error) {
      console.error(`[SoundFXEditor] Error saving sound effect:`, error);
      throw error;
    }
  }

  async saveExistingFile() {
    const content = this.getContent();
    await this.saveExistingResource(content);
    this.markClean();
    console.log(`[SoundFXEditor] Successfully saved existing file: ${this.path}`);
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
  return (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? `${window.ProjectPaths.getSourcesRootUi()}/SFX` : 'Resources/SFX';
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

  // Refresh content method for tab synchronization
  async refreshContent() {
    console.log(`[SoundFXEditor] Refreshing content... path: ${this.path}, isNewResource: ${this.isNewResource}`);
    if (this.path && !this.isNewResource) {
      try {
        await this.loadFileData();
        this.loadParametersIntoUI();
        console.log('[SoundFXEditor] Content refreshed successfully');
      } catch (error) {
        console.error('[SoundFXEditor] Error refreshing content:', error);
      }
    } else {
      console.log(`[SoundFXEditor] Skipping refresh - path: ${this.path}, isNewResource: ${this.isNewResource}`);
    }
  }
}

// Export the class
window.SoundFXEditor = SoundFXEditor;

// Static metadata for auto-registration
SoundFXEditor.getFileExtensions = () => ['.sfx'];
SoundFXEditor.getDisplayName = () => 'Sound FX';
SoundFXEditor.getIcon = () => '🔊';
SoundFXEditor.getPriority = () => 10;
SoundFXEditor.getCapabilities = () => ['audio-preview', 'waveform-display', 'buildable'];
SoundFXEditor.canCreate = true;
