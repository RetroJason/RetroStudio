// resource-manager.js
// Resource management system for audio assets

class ResourceManager {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.resourceCache = new Map(); // url/name -> resourceId
    this.resourceMetadata = new Map(); // resourceId -> metadata
  }
  
  /**
   * Load a resource from a file
   * @param {File} file - File object from input
   * @param {string} type - 'mod' or 'wav' 
   * @param {string} customName - Optional custom name
   * @returns {Promise<string>} Resource ID
   */
  async loadFromFile(file, type = null, customName = null) {
    // Auto-detect type if not provided
    if (!type) {
      type = this._detectFileType(file.name);
    }
    
    const name = customName || file.name;
    const cacheKey = `file:${name}:${file.size}:${file.lastModified}`;
    
    // Check cache
    if (this.resourceCache.has(cacheKey)) {
      const resourceId = this.resourceCache.get(cacheKey);
      console.log(`[ResourceManager] Using cached resource: ${resourceId}`);
      return resourceId;
    }
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const resourceId = await this.audioEngine.loadResource(arrayBuffer, type, name);
      
      // Cache and store metadata
      this.resourceCache.set(cacheKey, resourceId);
      this.resourceMetadata.set(resourceId, {
        name,
        type,
        source: 'file',
        originalName: file.name,
        size: file.size,
        loadedAt: Date.now()
      });
      
      return resourceId;
    } catch (error) {
      console.error(`[ResourceManager] Failed to load file ${file.name}:`, error);
      throw error;
    }
  }
  
  /**
   * Load a resource from a URL
   * @param {string} url - URL to load from
   * @param {string} type - 'mod' or 'wav'
   * @param {string} customName - Optional custom name
   * @returns {Promise<string>} Resource ID
   */
  async loadFromUrl(url, type = null, customName = null) {
    // Auto-detect type if not provided
    if (!type) {
      type = this._detectFileType(url);
    }
    
    const name = customName || url.split('/').pop();
    const cacheKey = `url:${url}`;
    
    // Check cache
    if (this.resourceCache.has(cacheKey)) {
      const resourceId = this.resourceCache.get(cacheKey);
      console.log(`[ResourceManager] Using cached resource: ${resourceId}`);
      return resourceId;
    }
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const resourceId = await this.audioEngine.loadResource(arrayBuffer, type, name);
      
      // Cache and store metadata
      this.resourceCache.set(cacheKey, resourceId);
      this.resourceMetadata.set(resourceId, {
        name,
        type,
        source: 'url',
        url,
        size: arrayBuffer.byteLength,
        loadedAt: Date.now()
      });
      
      return resourceId;
    } catch (error) {
      console.error(`[ResourceManager] Failed to load URL ${url}:`, error);
      throw error;
    }
  }
  
  /**
   * Preload multiple resources
   * @param {Array<{source: string, type?: string, name?: string}>} resources
   * @returns {Promise<Array<string>>} Array of resource IDs
   */
  async preloadResources(resources) {
    const results = [];
    
    for (const resource of resources) {
      try {
        let resourceId;
        if (resource.source.startsWith('http') || resource.source.startsWith('/')) {
          resourceId = await this.loadFromUrl(resource.source, resource.type, resource.name);
        } else {
          throw new Error('File loading requires File object, use loadFromFile instead');
        }
        results.push(resourceId);
      } catch (error) {
        console.error(`[ResourceManager] Failed to preload ${resource.source}:`, error);
        results.push(null);
      }
    }
    
    return results;
  }
  
  /**
   * Get resource metadata
   * @param {string} resourceId - Resource ID
   * @returns {Object|null} Metadata object
   */
  getResourceInfo(resourceId) {
    const metadata = this.resourceMetadata.get(resourceId);
    if (!metadata) return null;
    
    const resource = this.audioEngine.getResource(resourceId);
    if (!resource) return null;
    
    return {
      ...metadata,
      duration: resource.duration,
      channels: resource.audioBuffer?.numberOfChannels,
      sampleRate: resource.audioBuffer?.sampleRate
    };
  }
  
  /**
   * List all loaded resources
   * @returns {Array<Object>} Array of resource info objects
   */
  listResources() {
    const resources = [];
    for (const [resourceId, metadata] of this.resourceMetadata) {
      const info = this.getResourceInfo(resourceId);
      if (info) {
        resources.push({ resourceId, ...info });
      }
    }
    return resources;
  }
  
  /**
   * Find resources by name or type
   * @param {string} query - Search query
   * @param {string} type - Optional type filter ('mod' or 'wav')
   * @returns {Array<Object>} Matching resources
   */
  findResources(query, type = null) {
    const results = [];
    const queryLower = query.toLowerCase();
    
    for (const [resourceId, metadata] of this.resourceMetadata) {
      if (type && metadata.type !== type) continue;
      
      if (metadata.name.toLowerCase().includes(queryLower) ||
          metadata.originalName?.toLowerCase().includes(queryLower)) {
        const info = this.getResourceInfo(resourceId);
        if (info) {
          results.push({ resourceId, ...info });
        }
      }
    }
    
    return results;
  }
  
  /**
   * Unload a resource and clear cache
   * @param {string} resourceId - Resource ID
   * @returns {boolean} Success status
   */
  unloadResource(resourceId) {
    const metadata = this.resourceMetadata.get(resourceId);
    if (!metadata) return false;
    
    // Remove from audio engine
    const success = this.audioEngine.unloadResource(resourceId);
    
    if (success) {
      // Clear cache entries
      for (const [cacheKey, cachedId] of this.resourceCache) {
        if (cachedId === resourceId) {
          this.resourceCache.delete(cacheKey);
          break;
        }
      }
      
      // Clear metadata
      this.resourceMetadata.delete(resourceId);
    }
    
    return success;
  }
  
  /**
   * Clear all resources
   */
  clear() {
    const resourceIds = Array.from(this.resourceMetadata.keys());
    for (const resourceId of resourceIds) {
      this.unloadResource(resourceId);
    }
    
    this.resourceCache.clear();
    this.resourceMetadata.clear();
  }
  
  // Private methods
  
  _detectFileType(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    
    switch (ext) {
      case 'mod':
      case 'xm':
      case 's3m':
      case 'it':
      case 'mptm':
        return 'mod';
      case 'wav':
      case 'wave':
        return 'wav';
      default:
        throw new Error(`Unknown file type: ${ext}`);
    }
  }
}

// Export for use
window.ResourceManager = ResourceManager;
