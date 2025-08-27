/**
 * SfxBuilder - Converts .sfx files to .wav audio files
 * Uses SFXR library to generate audio from sound effect parameters
 */

if (typeof window.SfxBuilder === 'undefined') {

console.log('[SfxBuilder] Loading builder...');

class SfxBuilder extends window.BuilderBase {
  constructor() {
    super();
    this.name = 'SFX Builder';
    this.description = 'Converts SFX files to WAV audio files';
  }

  /**
   * Get the builder's unique identifier
   */
  static getId() {
    return 'sfx';
  }

  /**
   * Get the builder's display name
   */
  static getName() {
    return 'SFX Builder';
  }

  /**
   * Get the builder's description
   */
  static getDescription() {
    return 'Converts .sfx sound effect files to .wav audio files using SFXR';
  }

  /**
   * Get supported input file extensions
   */
  static getSupportedExtensions() {
    return ['.sfx'];
  }

  /**
   * Get the output extension
   */
  static getOutputExtension() {
    return '.wav';
  }

  /**
   * Get build priority - medium priority
   */
  static getPriority() {
    return 30; // Medium-high priority
  }

  /**
   * Get builder capabilities
   */
  static getCapabilities() {
    return ['audio-generation', 'sfxr-synthesis', 'sound-effects'];
  }

  /**
   * Build an SFX file by converting it to WAV
   */
  async build(file) {
    console.log(`[SfxBuilder] Building SFX file: ${file.path}`);

    try {
      // Validate input
      const validation = this.validateInput(file);
      if (!validation.valid) {
        return this.createBuildResult(false, file.path, null, validation.error);
      }

      // Check if SFXR is available
      if (!window.jsfxr || !window.jsfxr.sfxr) {
        console.warn('[SfxBuilder] SFXR library not available - skipping SFX file:', file.path);
        return this.createBuildResult(true, file.path, null, 'SFXR library not available - SFX file skipped');
      }

      // Get file content
      let content;
      if (file.content !== undefined) {
        content = file.content;
      } else {
        const loadedFile = await this.loadInputFile(file.path);
        content = loadedFile.content;
      }

      // Parse SFX content
      let sfxData;
      try {
        sfxData = typeof content === 'string' ? JSON.parse(content) : content;
        console.log(`[SfxBuilder] Parsed SFX data:`, sfxData);
      } catch (error) {
        throw new Error(`Failed to parse SFX file: ${error.message}`);
      }

      // Validate SFX format
      if (!sfxData.type || sfxData.type !== 'sound_fx') {
        throw new Error('Invalid SFX file format - missing type field');
      }

      if (!sfxData.parameters) {
        throw new Error('Invalid SFX file format - missing parameters field');
      }

      console.log(`[SfxBuilder] Found SFXR parameters in file`);

      // Extract SFXR parameters
      const params = sfxData.parameters;
      console.log(`[SfxBuilder] SFXR parameters:`, params);

      // Create a proper Params object and populate it
      const sfxrParams = new window.jsfxr.Params();
      sfxrParams.fromJSON(params);
      console.log(`[SfxBuilder] Created SFXR Params object:`, sfxrParams);
      
      // Debug key parameters that affect audio generation
      console.log(`[SfxBuilder] Key params - wave_type:`, sfxrParams.wave_type, 
                  `p_base_freq:`, sfxrParams.p_base_freq,
                  `p_env_attack:`, sfxrParams.p_env_attack,
                  `p_env_sustain:`, sfxrParams.p_env_sustain,
                  `p_env_decay:`, sfxrParams.p_env_decay,
                  `sound_vol:`, sfxrParams.sound_vol);

      // Generate WAV data using SFXR
      const waveObject = window.jsfxr.sfxr.toWave(sfxrParams);
      console.log(`[SfxBuilder] SFXR waveObject:`, waveObject);
      console.log(`[SfxBuilder] waveObject.wav length:`, waveObject?.wav?.length);
      console.log(`[SfxBuilder] waveObject.buffer length:`, waveObject?.buffer?.length);
      console.log(`[SfxBuilder] waveObject.data length:`, waveObject?.data?.length);
      
      if (!waveObject || !waveObject.wav || waveObject.wav.length === 0) {
        throw new Error('Failed to generate WAV data from SFX parameters');
      }

      // Use the original SFXR WAV format (this works correctly for waveform display and game emulator)
      const wavData = new Uint8Array(waveObject.wav);
      console.log(`[SfxBuilder] Generated WAV data: ${wavData.byteLength} bytes`);

      // Generate output path
      const outputPath = this.generateOutputPath(file.path, '.wav');
      console.log(`[SfxBuilder] Output path: ${outputPath}`);

      // Save WAV file
      await this.saveBuiltFile(outputPath, wavData, {
        type: '.wav',
        binaryData: true
      });

      console.log(`[SfxBuilder] Successfully built: ${file.path} → ${outputPath}`);

      return this.createBuildResult(true, file.path, outputPath, null, {
        operation: 'sfx-to-wav',
        outputFormat: 'wav',
        fileSize: wavData.byteLength,
        sampleRate: params.sample_rate || 44100,
        waveType: params.wave_type || 0
      });

    } catch (error) {
      console.error(`[SfxBuilder] Failed to build ${file.path}:`, error);
      return this.createBuildResult(false, file.path, null, error.message);
    }
  }

  /**
   * Validate SFX parameters
   */
  validateSfxParameters(params) {
    const required = ['wave_type'];
    const missing = required.filter(param => !(param in params));
    
    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing required SFX parameters: ${missing.join(', ')}`
      };
    }

    return { valid: true };
  }

  /**
   * Get supported wave types
   */
  static getSupportedWaveTypes() {
    return {
      0: 'Square',
      1: 'Sawtooth',
      2: 'Sine',
      3: 'Noise'
    };
  }

  /**
   * Get default SFX parameters
   */
  static getDefaultParameters() {
    return {
      wave_type: 0,
      p_base_freq: 0.3,
      p_freq_limit: 0.0,
      p_freq_ramp: 0.0,
      p_freq_dramp: 0.0,
      p_duty: 0.0,
      p_duty_ramp: 0.0,
      p_vib_strength: 0.0,
      p_vib_speed: 0.0,
      p_vib_delay: 0.0,
      p_env_attack: 0.0,
      p_env_sustain: 0.3,
      p_env_decay: 0.4,
      p_env_punch: 0.0,
      filter_on: false,
      p_lpf_resonance: 0.0,
      p_lpf_freq: 1.0,
      p_lpf_ramp: 0.0,
      p_hpf_freq: 0.0,
      p_hpf_ramp: 0.0,
      p_pha_offset: 0.0,
      p_pha_ramp: 0.0,
      p_repeat_speed: 0.0,
      p_arp_speed: 0.0,
      p_arp_mod: 0.0,
      sample_rate: 44100,
      sample_size: 8
    };
  }
}

// Export to global scope
window.SfxBuilder = SfxBuilder;
console.log('[SfxBuilder] Builder loaded');

// Auto-register with ComponentRegistry when available
if (window.componentRegistry) {
  window.componentRegistry.registerBuilder(SfxBuilder);
  console.log('[SfxBuilder] Registered with ComponentRegistry');
} else {
  // Wait for component registry to be available
  document.addEventListener('DOMContentLoaded', () => {
    if (window.componentRegistry) {
      window.componentRegistry.registerBuilder(SfxBuilder);
      console.log('[SfxBuilder] Registered with ComponentRegistry (deferred)');
    }
  });
}

} // End guard clause
