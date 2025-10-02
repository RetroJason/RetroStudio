/**
 * Audio Resource Loader
 * Implements the ResourceLoader interface for audio files (WAV, MOD, etc.)
 */
class AudioResourceLoader {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.loadedResources = new Map(); // resourceId -> audioEngineResourceId
  }
  
  /**
   * Get supported file extensions
   * @returns {Array<string>} Array of supported extensions
   */
  GetFileExtensions() {
    return ['.wav', '.mod', '.xm', '.s3m', '.it', '.mptm'];
  }
  
  /**
   * Load an audio file
   * @param {File} file - File object to load
   * @param {number} resourceId - Integer resource ID assigned by resource manager
   * @returns {Promise<void>}
   */
  async Load(file, resourceId) {
    if (!this.audioEngine) {
      throw new Error('AudioEngine not available');
    }
    
    try {
      // Read file as ArrayBuffer
      const arrayBuffer = await this._fileToArrayBuffer(file);
      
      // Determine audio type from extension
      const extension = this._getFileExtension(file.name);
      const audioType = this._isModFile(extension) ? 'mod' : 'wav';
      
      // Load through audio engine
      const audioEngineResourceId = await this.audioEngine.loadResource(arrayBuffer, audioType, file.name);
      
      // Track the mapping
      this.loadedResources.set(resourceId, audioEngineResourceId);
      
      console.log(`[AudioResourceLoader] Loaded ${file.name} as resource ${resourceId} -> audio engine ${audioEngineResourceId}`);
      
    } catch (error) {
      console.error(`[AudioResourceLoader] Failed to load ${file.name}:`, error);
      throw error;
    }
  }
  
  /**
   * Unload an audio resource
   * @param {number} resourceId - Integer resource ID to unload
   * @returns {boolean} Success status
   */
  Unload(resourceId) {
    const audioEngineResourceId = this.loadedResources.get(resourceId);
    if (!audioEngineResourceId) {
      console.warn(`[AudioResourceLoader] Resource ${resourceId} not found`);
      return false;
    }
    
    try {
      // Unload from audio engine
      this.audioEngine.unloadResource(audioEngineResourceId);
      
      // Remove tracking
      this.loadedResources.delete(resourceId);
      
      console.log(`[AudioResourceLoader] Unloaded resource ${resourceId} (audio engine ${audioEngineResourceId})`);
      return true;
      
    } catch (error) {
      console.error(`[AudioResourceLoader] Failed to unload resource ${resourceId}:`, error);
      return false;
    }
  }
  
  /**
   * Get the audio engine resource ID for a resource
   * @param {number} resourceId - Integer resource ID
   * @returns {string|null} Audio engine resource ID or null if not found
   */
  getAudioEngineResourceId(resourceId) {
    return this.loadedResources.get(resourceId) || null;
  }
  
  /**
   * Get all loaded resource mappings
   * @returns {Map<number, string>} Map of resourceId -> audioEngineResourceId
   */
  getAllMappings() {
    return new Map(this.loadedResources);
  }
  
  // Helper methods
  
  /**
   * Convert File to ArrayBuffer
   * @private
   */
  async _fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }
  
  /**
   * Get file extension
   * @private
   */
  _getFileExtension(filename) {
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex === -1) {
      return '';
    }
    return filename.substring(lastDotIndex).toLowerCase();
  }
  
  /**
   * Check if file is a MOD file
   * @private
   */
  _isModFile(extension) {
    return ['.mod', '.xm', '.s3m', '.it', '.mptm'].includes(extension);
  }
}

// Export
window.AudioResourceLoader = AudioResourceLoader;
