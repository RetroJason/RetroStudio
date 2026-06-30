// resource-manager.js
// Resource management system for audio assets

class ResourceManager {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.resourceCache = new Map(); // url/name -> resourceId
    this.resourceMetadata = new Map(); // resourceId -> metadata
  }

  _toArrayBuffer(value) {
    if (value instanceof ArrayBuffer) {
      return value;
    }

    if (ArrayBuffer.isView(value)) {
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }

    return null;
  }

  _decodeBase64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  }

  async _normalizeFileInput(file, customName = null) {
    if (!file) {
      throw new Error('Audio file input is required');
    }

    const directName = customName || file.name || file.filename || file.path?.split('/').pop() || file.path?.split('\\').pop();
    if (typeof file.arrayBuffer === 'function') {
      const arrayBuffer = await file.arrayBuffer();
      return {
        name: directName || 'audio-resource',
        originalName: file.name || directName || 'audio-resource',
        size: typeof file.size === 'number' ? file.size : arrayBuffer.byteLength,
        lastModified: typeof file.lastModified === 'number' ? file.lastModified : 0,
        arrayBuffer
      };
    }

    const directBuffer = this._toArrayBuffer(file);
    if (directBuffer) {
      return {
        name: directName || 'audio-resource',
        originalName: directName || 'audio-resource',
        size: directBuffer.byteLength,
        lastModified: 0,
        arrayBuffer: directBuffer
      };
    }

    const contentBuffer = this._toArrayBuffer(file.content)
      || this._toArrayBuffer(file.fileContent)
      || this._toArrayBuffer(file.data);
    if (contentBuffer) {
      return {
        name: directName || 'audio-resource',
        originalName: file.name || file.filename || directName || 'audio-resource',
        size: typeof file.size === 'number' ? file.size : contentBuffer.byteLength,
        lastModified: typeof file.lastModified === 'number' ? file.lastModified : 0,
        arrayBuffer: contentBuffer
      };
    }

    if (file.binaryData && typeof file.fileContent === 'string') {
      const arrayBuffer = this._decodeBase64ToArrayBuffer(file.fileContent);
      return {
        name: directName || 'audio-resource',
        originalName: file.name || file.filename || directName || 'audio-resource',
        size: typeof file.size === 'number' ? file.size : arrayBuffer.byteLength,
        lastModified: typeof file.lastModified === 'number' ? file.lastModified : 0,
        arrayBuffer
      };
    }

    throw new Error(`Unsupported audio file input for ${directName || 'unknown resource'}`);
  }
  
  /**
   * Load a resource from a file
   * @param {File} file - File object from input
   * @param {string} type - 'mod' or 'wav' 
   * @param {string} customName - Optional custom name
   * @returns {Promise<string>} Resource ID
   */
  async loadFromFile(file, type = null, customName = null) {
    const normalizedFile = await this._normalizeFileInput(file, customName);

    // Auto-detect type if not provided
    if (!type) {
      type = this._detectFileType(normalizedFile.name);
    }
    
    const name = customName || normalizedFile.name;
    const cacheKey = `file:${name}:${normalizedFile.size}:${normalizedFile.lastModified}`;
    
    // Check cache
    if (this.resourceCache.has(cacheKey)) {
      const resourceId = this.resourceCache.get(cacheKey);
      if (!this.audioEngine.getResource(resourceId)) {
        console.warn(`[ResourceManager] Evicting stale cached resource: ${resourceId}`);
        this.resourceCache.delete(cacheKey);
        this.resourceMetadata.delete(resourceId);
      } else {
      console.log(`[ResourceManager] Using cached resource: ${resourceId}`);
      return resourceId;
      }
    }
    
    try {
      const arrayBuffer = normalizedFile.arrayBuffer;
      const resourceId = await this.audioEngine.loadResource(arrayBuffer, type, name);
      
      // Cache and store metadata
      this.resourceCache.set(cacheKey, resourceId);
      this.resourceMetadata.set(resourceId, {
        name,
        type,
        source: 'file',
        originalName: normalizedFile.originalName,
        size: normalizedFile.size,
        loadedAt: Date.now()
      });
      
      return resourceId;
    } catch (error) {
      console.error(`[ResourceManager] Failed to load file ${name}:`, error);
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
      if (!this.audioEngine.getResource(resourceId)) {
        console.warn(`[ResourceManager] Evicting stale cached resource: ${resourceId}`);
        this.resourceCache.delete(cacheKey);
        this.resourceMetadata.delete(resourceId);
      } else {
      console.log(`[ResourceManager] Using cached resource: ${resourceId}`);
      return resourceId;
      }
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

class StudioAudioService {
  constructor(audioEngine, resourceManager) {
    this.audioEngine = audioEngine;
    this.resourceManager = resourceManager;
    this.loadedAudioResources = new Map();
    this.pendingAudioFiles = new Map();
    this._inflightLoads = new Map();

    this._boundHandleFileAddedEvent = this.handleFileAddedEvent.bind(this);
    this._boundOnResourceUpdated = this.onResourceUpdated.bind(this);

    document.addEventListener('projectFileAdded', this._boundHandleFileAddedEvent);
    this.audioEngine.addEventListener('resourceUpdated', this._boundOnResourceUpdated);
  }

  getFileIOService() {
    return window.serviceContainer?.get?.('fileIOService') || window.fileIOService || null;
  }

  getSourcesRootUi() {
    return window.ProjectPaths?.getSourcesRootUi?.() || 'Resources';
  }

  getBuildStoragePrefix() {
    return window.ProjectPaths?.getBuildStoragePrefix?.() || 'build/';
  }

  normalizeStoragePath(path) {
    return window.ProjectPaths?.normalizeStoragePath?.(path) || path;
  }

  resolveAudioType(filename) {
    const lower = String(filename || '').toLowerCase();
    if (['.mod', '.xm', '.s3m', '.it', '.mptm'].some(ext => lower.endsWith(ext))) {
      return 'mod';
    }
    if (lower.endsWith('.wav')) {
      return 'wav';
    }
    return null;
  }

  hasInlineAudioData(file) {
    if (!file) {
      return false;
    }

    if (typeof file.arrayBuffer === 'function') {
      return true;
    }

    if (file instanceof ArrayBuffer || ArrayBuffer.isView(file)) {
      return true;
    }

    if (file.content instanceof ArrayBuffer || ArrayBuffer.isView(file.content)) {
      return true;
    }

    if (file.fileContent instanceof ArrayBuffer || ArrayBuffer.isView(file.fileContent)) {
      return true;
    }

    if (file.data instanceof ArrayBuffer || ArrayBuffer.isView(file.data)) {
      return true;
    }

    return !!(file.binaryData && typeof file.fileContent === 'string');
  }

  getLoadedResourceId(filePathOrName) {
    const normalizedLookupPath = this.normalizeStoragePath(String(filePathOrName || ''));

    for (const [path, id] of this.loadedAudioResources) {
      if (path === normalizedLookupPath) {
        const resource = this.audioEngine?.getResource?.(id) || null;
        if (!resource) {
          console.warn(`[StudioAudioService] Evicting stale loaded resource mapping for ${normalizedLookupPath}: ${id}`);
          this.loadedAudioResources.delete(path);
          return null;
        }
        return id;
      }
    }

    return null;
  }

  handleFileAddedEvent(event) {
    const { file, path, fullPath, extension } = event.detail || {};
    const audioType = this.resolveAudioType(extension || file?.name || fullPath || '');
    if (!audioType) {
      return;
    }

    const fileKey = this.normalizeStoragePath(fullPath || (path && file?.name ? `${path}/${file.name}` : file?.path || file?.name));
    if (!fileKey) {
      throw new Error('Audio file event is missing a path');
    }

    if (!this.hasInlineAudioData(file)) {
      console.log(`[StudioAudioService] Skipping pending audio registration for ${fileKey} because no inline audio bytes were provided`);
      return;
    }

    this.pendingAudioFiles.set(fileKey, { file, audioType, path });
    console.log(`[StudioAudioService] Registered audio file for lazy loading: ${fileKey} (${audioType})`);
  }

  onResourceUpdated(event) {
    const { resourceId, property, value } = event.detail || {};
    let filename = null;

    for (const [fileKey, loadedResourceId] of this.loadedAudioResources.entries()) {
      if (loadedResourceId === resourceId) {
        filename = fileKey.split('/').pop() || fileKey.split('\\').pop() || null;
        break;
      }
    }

    const tabManager = window.serviceContainer?.get?.('tabManager') || window.tabManager || null;
    if (tabManager && typeof tabManager.notifyResourceUpdated === 'function') {
      tabManager.notifyResourceUpdated(resourceId, property, value, filename);
    }
  }

  async loadAudioFileOnDemand(filePathOrName, forceReload = false) {
    const lookupPath = String(filePathOrName || '');
    const normalizedLookupPath = this.normalizeStoragePath(lookupPath);
    const filename = lookupPath.split('/').pop() || lookupPath.split('\\').pop() || lookupPath;
    const inflightKey = normalizedLookupPath;

    console.log(`[StudioAudioService] Loading audio file on demand: ${normalizedLookupPath}${forceReload ? ' (force reload)' : ''}`);

    if (!normalizedLookupPath) {
      throw new Error('Audio file path is required');
    }

    if (!forceReload) {
      const existingId = this.getLoadedResourceId(normalizedLookupPath);
      if (existingId) {
        return existingId;
      }
    } else {
      const existingId = this.getLoadedResourceId(normalizedLookupPath);
      if (existingId) {
        this.resourceManager.unloadResource(existingId);
      }
    }

    if (!forceReload && this._inflightLoads.has(inflightKey)) {
      return this._inflightLoads.get(inflightKey);
    }

    const loadPromise = (async () => {
      for (const [fileKey, fileData] of this.pendingAudioFiles.entries()) {
        if (fileKey === normalizedLookupPath) {
          if (!this.hasInlineAudioData(fileData.file)) {
            console.warn(`[StudioAudioService] Evicting invalid pending audio entry for ${fileKey}`);
            this.pendingAudioFiles.delete(fileKey);
            continue;
          }
          const resourceId = await this.resourceManager.loadFromFile(fileData.file, fileData.audioType, filename);
          this.loadedAudioResources.set(fileKey, resourceId);
          this.pendingAudioFiles.delete(fileKey);
          return resourceId;
        }
      }

      const fileIOService = this.getFileIOService();
      if (!fileIOService || typeof fileIOService.listFiles !== 'function') {
        throw new Error('FileIOService is not available for studio audio loading');
      }

      const audioType = this.resolveAudioType(filename);
      if (!audioType) {
        throw new Error(`Unsupported audio type for ${filename}`);
      }

      const rec = await fileIOService.loadFile(normalizedLookupPath);
      if (!rec) {
        throw new Error(`Audio file not found at exact path: ${normalizedLookupPath}`);
      }
      const resourceId = await this.resourceManager.loadFromFile(rec, audioType, filename);
      this.loadedAudioResources.set(normalizedLookupPath, resourceId);
      return resourceId;
    })();

    this._inflightLoads.set(inflightKey, loadPromise);
    try {
      return await loadPromise;
    } finally {
      if (this._inflightLoads.get(inflightKey) === loadPromise) {
        this._inflightLoads.delete(inflightKey);
      }
    }
  }
}

// Export for use
window.ResourceManager = ResourceManager;
window.StudioAudioService = StudioAudioService;
