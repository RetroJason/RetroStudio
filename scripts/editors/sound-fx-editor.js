// sound-fx-editor.js
// Editor for sound effect files (.sfx)

class SoundFXEditor extends CompoundEditor {
  constructor(file, path, isNewResource = false, templateOptions = null) {
    super(file, path, isNewResource, templateOptions);
    
    console.log(`[SoundFXEditor] Constructor called for ${file?.name}`);
    
    // Default sound parameters (simplified)
    this.defaultParameters = {
      type: 'sine',           // sine, square, sawtooth, noise
      frequency: 440,         // Hz
      duration: 1.0           // seconds
    };
    
    // Initialize parameters with defaults
    this.parameters = { ...this.defaultParameters };
    
    // If template options provided, use them
    if (templateOptions) {
      this.parameters = { ...this.defaultParameters, ...templateOptions };
    }
    
    // Define the file structure for sound FX
    this.managedFiles = {
      source: { 
        extension: '.sfx', 
        role: 'source', 
        editable: true,
        contentType: 'application/xml',
        description: 'Sound effect parameters'
      },
      output: { 
        extension: '.wav', 
        role: 'output', 
        generated: true,
        editable: false,
        contentType: 'audio/wav',
        description: 'Generated audio file'
      }
    };
    
    // Audio context for preview
    this.audioContext = null;
    this.previewSource = null;
    
    // Load parameters from file if it's an existing resource
    if (!isNewResource && file && file.size > 0) {
      this.loadParametersFromFile();
    }
  }
  
  // Override CompoundEditor's createBody to exclude build button
  createBody(bodyContainer) {
    console.log('[SoundFXEditor] createBody called');
    
    // Clear any existing content
    bodyContainer.innerHTML = '';
    bodyContainer.className = 'compound-editor-body';
    
    // Create source editor area
    const sourceArea = document.createElement('div');
    sourceArea.className = 'source-editor-area';
    
    // Create output preview area (no build controls)
    const outputArea = document.createElement('div');
    outputArea.className = 'output-preview-area';
    
    bodyContainer.appendChild(sourceArea);
    bodyContainer.appendChild(outputArea);
    
    // Let subclass populate the source area
    this.populateSourceEditor(sourceArea);
    this.populateOutputPreview(outputArea);
    
    // Ensure waveform loads after DOM is ready
    setTimeout(() => {
      this.updateWaveformPreview();
    }, 200);
    
    console.log('[SoundFXEditor] createBody completed');
  }
  
  // Override to populate source editor with SoundFX parameters
  populateSourceEditor(container) {
    console.log('[SoundFXEditor] populateSourceEditor called');
    console.log('[SoundFXEditor] Current parameters:', this.parameters);
    
    container.innerHTML = `
      <div class="sound-fx-controls">
        <h3>Sound Parameters</h3>
        
        <div class="parameter-group">
          <label>Waveform Type:</label>
          <select id="sfx-type">
            <option value="sine">Sine Wave</option>
            <option value="square">Square Wave</option>
            <option value="sawtooth">Sawtooth Wave</option>
            <option value="noise">White Noise</option>
          </select>
        </div>
        
        <div class="parameter-group">
          <label>Frequency (Hz):</label>
          <input type="range" id="sfx-frequency" min="20" max="2000" value="440" step="1">
          <span id="sfx-frequency-value">440</span>
        </div>
        
        <div class="parameter-group">
          <label>Duration (seconds):</label>
          <input type="range" id="sfx-duration" min="0.1" max="5.0" value="1.0" step="0.1">
          <span id="sfx-duration-value">1.0</span>
        </div>
      </div>
    `;
    
    // Setup event handlers and load current values
    this.setupParameterControls(container);
    this.loadParametersIntoUI();
  }
  
  populateOutputPreview(container) {
    container.innerHTML = `
      <div class="output-preview">
        <h3>Audio Preview</h3>
        <div class="waveform-row">
          <div id="preview-controls" class="play-controls"></div>
          <div class="waveform-container" id="waveform-container">
            <!-- Waveform display will be added here -->
          </div>
        </div>
        <div class="audio-info">
          <div id="audio-status">Adjust parameters to generate audio</div>
        </div>
      </div>
    `;
    
    // Initialize waveform display
    this.initializeWaveform(container);
    
    // Setup audio preview controls
    this.setupAudioPreview(container);
  }
  
  initializeWaveform(container) {
    const waveformContainer = container.querySelector('#waveform-container');
    if (waveformContainer && window.WaveformDisplay) {
      this.waveformDisplay = new WaveformDisplay(waveformContainer, {
        width: 550,
        height: 150
      });
      
      // Generate initial waveform
      this.updateWaveformPreview();
    }
  }
  
  setupParameterControls(container) {
    const controls = {
      'sfx-type': 'type',
      'sfx-frequency': 'frequency',
      'sfx-duration': 'duration'
    };
    
    for (const [elementId, paramPath] of Object.entries(controls)) {
      const element = container.querySelector(`#${elementId}`);
      if (element) {
        element.addEventListener('input', () => {
          const value = element.type === 'range' ? parseFloat(element.value) : element.value;
          this.parameters[paramPath] = value;
          this.updateValueDisplay(elementId);
          this.markDirty();
          
          // Update waveform preview in real-time
          this.updateWaveformPreview();
        });
      }
    }
  }
  
  updateValueDisplay(elementId) {
    const valueElement = document.getElementById(`${elementId}-value`);
    if (valueElement) {
      const inputElement = document.getElementById(elementId);
      if (inputElement) {
        valueElement.textContent = inputElement.value;
      }
    }
  }
  
  loadParametersIntoUI() {
    if (!this.parameters) {
      this.parameters = { ...this.defaultParameters };
    }
    
    const elements = {
      'sfx-type': this.parameters.type,
      'sfx-frequency': this.parameters.frequency,
      'sfx-duration': this.parameters.duration
    };
    
    for (const [elementId, value] of Object.entries(elements)) {
      const element = document.getElementById(elementId);
      if (element) {
        element.value = value;
        this.updateValueDisplay(elementId);
      }
    }
  }
  
  setupAudioPreview(container) {
    const controlsContainer = container.querySelector('#preview-controls');
    
    if (controlsContainer && window.PlayPauseButton) {
      // Create the play/pause button with proper callback
      this.playPauseButton = new PlayPauseButton(controlsContainer, {
        buttonId: 'sfx-play-button',
        onToggle: (isPlaying) => {
          if (isPlaying) {
            this.playPreview();
          } else {
            this.stopPreview();
          }
        }
      });
    } else {
      // Fallback to simple buttons if PlayPauseButton is not available
      controlsContainer.innerHTML = `
        <button id="preview-play" class="btn btn-primary">▶️ Play</button>
        <button id="preview-stop" class="btn btn-secondary">⏹️ Stop</button>
      `;
      
      const playBtn = controlsContainer.querySelector('#preview-play');
      const stopBtn = controlsContainer.querySelector('#preview-stop');
      
      if (playBtn) {
        playBtn.addEventListener('click', () => this.playPreview());
      }
      
      if (stopBtn) {
        stopBtn.addEventListener('click', () => this.stopPreview());
      }
    }
  }
  
  getOutputPath() {
    const outputFilename = this.getOutputFilename();
    return `build/Resources/SFX/${outputFilename}`;
  }
  
  getOutputFilename() {
    // Convert .sfx to .wav
    const baseName = this.file.name.replace(/\.sfx$/i, '');
    return `${baseName}.wav`;
  }
  
  // Override CompoundEditor's updateOutputPreview to preserve our audio controls
  updateOutputPreview(outputPath) {
    const statusEl = this.element.querySelector('#audio-status');
    if (statusEl) {
      statusEl.textContent = `Preview: ${this.parameters.type} wave, ${this.parameters.frequency}Hz, ${this.parameters.duration}s`;
    }
    
    // Don't let CompoundEditor replace our audio controls
    console.log(`[SoundFXEditor] Output updated: ${outputPath}`);
  }
  
  // Audio synthesis methods
  async synthesizeAudio() {
    try {
      console.log('[SoundFXEditor] Synthesizing audio with parameters:', this.parameters);
      
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      const sampleRate = this.audioContext.sampleRate;
      const duration = this.parameters.duration;
      const frequency = this.parameters.frequency;
      const frameCount = sampleRate * duration;
      
      const audioBuffer = this.audioContext.createBuffer(1, frameCount, sampleRate);
      const outputData = audioBuffer.getChannelData(0);
      
      for (let frame = 0; frame < frameCount; frame++) {
        const time = frame / sampleRate;
        let sample = 0;
        
        switch (this.parameters.type) {
          case 'sine':
            sample = Math.sin(2 * Math.PI * frequency * time);
            break;
          case 'square':
            sample = Math.sin(2 * Math.PI * frequency * time) > 0 ? 1 : -1;
            break;
          case 'sawtooth':
            sample = 2 * (time * frequency % 1) - 1;
            break;
          case 'noise':
            sample = Math.random() * 2 - 1;
            break;
          default:
            sample = Math.sin(2 * Math.PI * frequency * time);
        }
        
        // Apply envelope to prevent clicks
        const envelope = Math.min(1, Math.min(time * 10, (duration - time) * 10));
        outputData[frame] = sample * envelope * 0.3; // 30% volume
      }
      
      return audioBuffer;
      
    } catch (error) {
      console.error('[SoundFXEditor] Audio synthesis failed:', error);
      return null;
    }
  }
  
  // Convert AudioBuffer to WAV file format
  audioBufferToWav(buffer) {
    const length = buffer.length;
    const arrayBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(arrayBuffer);
    const channels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    
    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);
    
    // Convert float samples to 16-bit PCM
    const channelData = buffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample * 0x7FFF, true);
      offset += 2;
    }
    
    return arrayBuffer;
  }
  
  // XML parameter serialization
  parametersToXml(params) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soundfx>
  <waveform>${params.type}</waveform>
  <frequency>${params.frequency}</frequency>
  <duration>${params.duration}</duration>
</soundfx>`;
  }
  
  xmlToParameters(xmlString) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlString, 'text/xml');
      
      return {
        type: doc.querySelector('waveform')?.textContent || 'sine',
        frequency: parseFloat(doc.querySelector('frequency')?.textContent || '440'),
        duration: parseFloat(doc.querySelector('duration')?.textContent || '1.0')
      };
    } catch (error) {
      console.error('[SoundFXEditor] XML parsing failed:', error);
      return { ...this.defaultParameters };
    }
  }
  
  getContent() {
    return this.parametersToXml(this.parameters);
  }
  
  setContent(content) {
    try {
      this.parameters = this.xmlToParameters(content);
      this.loadParametersIntoUI();
    } catch (error) {
      console.error('[SoundFXEditor] Failed to set content:', error);
    }
  }
  
  // Static methods for editor registry
  static getFileExtension() {
    return '.sfx';
  }
  
  static getDisplayName() {
    return 'Sound FX';
  }
  
  static async showCreateDialog() {
    const result = await ModalUtils.showForm('Create New Sound Effect', [
      {
        name: 'name',
        type: 'text',
        label: 'File Name:',
        defaultValue: 'new_sound',
        placeholder: 'Enter filename...',
        required: true,
        hint: 'Name for your sound effect (without .sfx extension)'
      }
    ]);
    
    if (!result) return null;
    
    let name = result.name.trim();
    
    // Ensure proper extension
    if (!name.toLowerCase().endsWith('.sfx')) {
      name += '.sfx';
    }
    
    return {
      name: name,
      uniqueNameChecked: true
    };
  }
  
  // Simplified preview methods
  async playPreview() {
    try {
      const audioBuffer = await this.synthesizeAudio();
      if (!audioBuffer) return;
      
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      this.stopPreview();
      
      this.previewSource = this.audioContext.createBufferSource();
      this.previewSource.buffer = audioBuffer;
      this.previewSource.connect(this.audioContext.destination);
      this.previewSource.start();
      
      const statusEl = document.getElementById('audio-status');
      if (statusEl) {
        statusEl.textContent = 'Playing preview...';
      }
      
      // Update play button state
      if (this.playPauseButton) {
        this.playPauseButton.setPlaying(true);
      }
      
      this.previewSource.onended = () => {
        if (statusEl) {
          statusEl.textContent = 'Preview finished';
        }
        // Reset play button state
        if (this.playPauseButton) {
          this.playPauseButton.setPlaying(false);
        }
      };
      
    } catch (error) {
      console.error('[SoundFXEditor] Preview failed:', error);
      if (this.playPauseButton) {
        this.playPauseButton.setPlaying(false);
      }
    }
  }
  
  stopPreview() {
    if (this.previewSource) {
      this.previewSource.stop();
      this.previewSource = null;
      
      const statusEl = document.getElementById('audio-status');
      if (statusEl) {
        statusEl.textContent = 'Preview stopped';
      }
    }
    
    // Update play button state
    if (this.playPauseButton) {
      this.playPauseButton.setPlaying(false);
    }
  }
  
  async updateWaveformPreview() {
    if (!this.waveformDisplay) return;
    
    try {
      // Synthesize audio with current parameters
      const audioBuffer = await this.synthesizeAudio();
      if (audioBuffer) {
        this.waveformDisplay.updateWaveform(audioBuffer);
        
        const statusEl = document.getElementById('audio-status');
        if (statusEl) {
          statusEl.textContent = `Generated: ${this.parameters.type} wave, ${this.parameters.frequency}Hz, ${this.parameters.duration}s`;
        }
      }
    } catch (error) {
      console.error('[SoundFXEditor] Failed to update waveform preview:', error);
      
      const statusEl = document.getElementById('audio-status');
      if (statusEl) {
        statusEl.textContent = 'Error generating preview';
      }
    }
  }
  
  loadParametersFromFile() {
    try {
      if (this.file && this.file.size > 0) {
        this.loadFileContent();
      } else {
        console.log('[SoundFXEditor] No file content, using defaults');
        this.parameters = { ...this.defaultParameters };
      }
    } catch (error) {
      console.error('[SoundFXEditor] Failed to load parameters from file:', error);
      this.parameters = { ...this.defaultParameters };
    }
  }
  
  async loadFileContent() {
    try {
      const text = await this.file.text();
      if (text.trim()) {
        console.log('[SoundFXEditor] Loading parameters from file content');
        this.parameters = this.xmlToParameters(text);
      } else {
        console.log('[SoundFXEditor] Empty file, using defaults');
        this.parameters = { ...this.defaultParameters };
      }
      
      // Update waveform preview after loading parameters
      setTimeout(() => this.updateWaveformPreview(), 100);
      
    } catch (error) {
      console.error('[SoundFXEditor] Failed to load file content:', error);
      this.parameters = { ...this.defaultParameters };
    }
  }
}

// Export for use
window.SoundFXEditor = SoundFXEditor;