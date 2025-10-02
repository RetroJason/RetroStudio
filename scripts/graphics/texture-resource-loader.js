/**
 * Texture Resource Loader
 * Implements the ResourceLoader interface for texture files (D2, PNG, etc.)
 */
class TextureResourceLoader {
  constructor(d2Graphics) {
    this.d2Graphics = d2Graphics;
    this.loadedResources = new Map(); // resourceId -> textureId
  }
  
  /**
   * Get supported file extensions
   * @returns {Array<string>} Array of supported extensions
   */
  GetFileExtensions() {
    return ['.d2', '.png', '.jpg', '.jpeg', '.bmp'];
  }
  
  /**
   * Load a texture file
   * @param {File} file - File object to load
   * @param {number} resourceId - Integer resource ID assigned by resource manager
   * @returns {Promise<void>}
   */
  async Load(file, resourceId) {
    if (!this.d2Graphics) {
      throw new Error('D2Graphics not available');
    }
    
    try {
      // Read file as ArrayBuffer
      const arrayBuffer = await this._fileToArrayBuffer(file);
      
      // Generate texture name from resource ID
      const textureName = `resource_${resourceId}`;
      
      // Load into D2Graphics
      const textureId = this.d2Graphics.loadD2Texture(arrayBuffer, textureName);
      
      // Track the mapping
      this.loadedResources.set(resourceId, textureId);
      
      console.log(`[TextureResourceLoader] Loaded ${file.name} as resource ${resourceId} -> texture ${textureId}`);
      
    } catch (error) {
      console.error(`[TextureResourceLoader] Failed to load ${file.name}:`, error);
      throw error;
    }
  }
  
  /**
   * Unload a texture resource
   * @param {number} resourceId - Integer resource ID to unload
   * @returns {boolean} Success status
   */
  Unload(resourceId) {
    const textureId = this.loadedResources.get(resourceId);
    if (textureId === undefined) {
      console.warn(`[TextureResourceLoader] Resource ${resourceId} not found`);
      return false;
    }
    
    try {
      // Unload from D2Graphics if method exists
      if (this.d2Graphics.unloadTexture) {
        this.d2Graphics.unloadTexture(textureId);
      }
      
      // Remove tracking
      this.loadedResources.delete(resourceId);
      
      console.log(`[TextureResourceLoader] Unloaded resource ${resourceId} (texture ${textureId})`);
      return true;
      
    } catch (error) {
      console.error(`[TextureResourceLoader] Failed to unload resource ${resourceId}:`, error);
      return false;
    }
  }
  
  /**
   * Get the texture ID for a resource
   * @param {number} resourceId - Integer resource ID
   * @returns {number|null} Texture ID or null if not found
   */
  getTextureId(resourceId) {
    const textureId = this.loadedResources.get(resourceId);
    return textureId !== undefined ? textureId : null;
  }
  
  /**
   * Get all loaded resource mappings
   * @returns {Map<number, number>} Map of resourceId -> textureId
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
}

// Export
window.TextureResourceLoader = TextureResourceLoader;
