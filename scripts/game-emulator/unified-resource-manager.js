/**
 * Unified Resource Manager
 * Manages resources through levels and pluggable loaders
 */
class UnifiedResourceManager {
  constructor(gameEmulator) {
    this.gameEmulator = gameEmulator;
    this.fileManager = null;
    
    // Resource tracking
    this.loadedResources = new Map(); // resourceId (int) -> LoadedResource
    this.nextResourceId = 1;
    
    // Level management
    this.currentLevel = null; // Currently loaded level
    this.levelResources = new Map(); // resourceId -> resource name from level
    
    // Loader management
    this.loaders = new Map(); // fileExtension -> ResourceLoader
    this.resourcesByLoader = new Map(); // loaderId -> Set of resourceIds
    
    // Loading state
    this.loadingPromises = new Map(); // resourceName -> Promise (prevent duplicate loads)
    
    this.initialize();
  }
  
  async initialize() {
    // Get services from container
    const services = window.serviceContainer;
    this.fileManager = services?.get?.('fileManager') || window.fileManager;
    
    console.log('[UnifiedResourceManager] Initialized with level-based loading');
  }
  
  /**
   * Register a resource loader
   * @param {string} loaderId - Unique identifier for this loader
   * @param {ResourceLoader} loader - Loader implementation
   */
  registerLoader(loaderId, loader) {
    // Validate loader interface
    if (!loader.GetFileExtensions || typeof loader.GetFileExtensions !== 'function') {
      throw new Error(`Loader ${loaderId} must implement GetFileExtensions() method`);
    }
    if (!loader.Load || typeof loader.Load !== 'function') {
      throw new Error(`Loader ${loaderId} must implement Load(file, resourceId) method`);
    }
    if (!loader.Unload || typeof loader.Unload !== 'function') {
      throw new Error(`Loader ${loaderId} must implement Unload(resourceId) method`);
    }
    
    // Register loader for each supported extension
    const extensions = loader.GetFileExtensions();
    for (const ext of extensions) {
      const normalizedExt = ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : '.' + ext.toLowerCase();
      this.loaders.set(normalizedExt, { id: loaderId, loader });
    }
    
    // Initialize resource tracking for this loader
    this.resourcesByLoader.set(loaderId, new Set());
    
    console.log(`[UnifiedResourceManager] Registered loader '${loaderId}' for extensions: ${extensions.join(', ')}`);
  }
  
  /**
   * Load a level - this is the main way to load resources
   * @param {Object} level - Level definition with resource mappings
   * @param {Object} level.resources - Map of resource names to file paths
   * @returns {Promise<void>}
   */
  async loadLevel(level) {
    if (!level || !level.resources) {
      throw new Error('Invalid level definition - must have resources property');
    }
    
    console.log(`[UnifiedResourceManager] Loading level with ${Object.keys(level.resources).length} resources`);
    
    // Unload current level first
    await this.unloadCurrentLevel();
    
    this.currentLevel = level;
    const resourcesToLoad = new Map(); // resourceName -> filePath
    
    // Determine which resources need to be loaded
    for (const [resourceName, filePath] of Object.entries(level.resources)) {
      // Check if already loaded with same path
      const existingResource = this._findLoadedResourceByName(resourceName);
      if (existingResource && existingResource.filePath === filePath) {
        // Already loaded, just mark as part of this level
        this.levelResources.set(existingResource.id, resourceName);
        console.log(`[UnifiedResourceManager] Resource ${resourceName} already loaded`);
        continue;
      }
      
      resourcesToLoad.set(resourceName, filePath);
    }
    
    // Load new resources
    const loadPromises = [];
    for (const [resourceName, filePath] of resourcesToLoad) {
      loadPromises.push(this._loadResource(resourceName, filePath));
    }
    
    try {
      await Promise.all(loadPromises);
      
      // Clean up any resources no longer needed
      await this._unloadUnusedResources();
      
      console.log(`[UnifiedResourceManager] Level loaded successfully. Active resources: ${this.loadedResources.size}`);
    } catch (error) {
      console.error('[UnifiedResourceManager] Failed to load level:', error);
      throw error;
    }
  }
  
  /**
   * Internal resource loading logic
   * @private
   */
  async _loadResource(resourceName, filePath) {
    // Check if already loading
    if (this.loadingPromises.has(resourceName)) {
      return await this.loadingPromises.get(resourceName);
    }
    
    const loadPromise = this._loadResourceInternal(resourceName, filePath);
    this.loadingPromises.set(resourceName, loadPromise);
    
    try {
      const resourceId = await loadPromise;
      return resourceId;
    } finally {
      this.loadingPromises.delete(resourceName);
    }
  }
  
  /**
   * Internal resource loading implementation
   * @private
   */
  async _loadResourceInternal(resourceName, filePath) {
    console.log(`[UnifiedResourceManager] Loading resource: ${resourceName} from ${filePath}`);
    
    try {
      // Load the file
      const fileData = await this.fileManager.loadFile(filePath);
      if (!fileData) {
        throw new Error(`Failed to load file: ${filePath}`);
      }
      
      // Create File object
      const file = this._createFileObject(fileData, filePath);
      
      // Find appropriate loader based on file extension
      const extension = this._getFileExtension(filePath);
      const loaderInfo = this.loaders.get(extension);
      if (!loaderInfo) {
        throw new Error(`No loader registered for extension: ${extension}`);
      }
      
      // Assign resource ID
      const resourceId = this.nextResourceId++;
      
      // Create resource record
      const resource = {
        id: resourceId,
        name: resourceName,
        filePath: filePath,
        loaderId: loaderInfo.id,
        loadedAt: Date.now()
      };
      
      // Load through the appropriate loader
      await loaderInfo.loader.Load(file, resourceId);
      
      // Track resource
      this.loadedResources.set(resourceId, resource);
      this.levelResources.set(resourceId, resourceName);
      this.resourcesByLoader.get(loaderInfo.id).add(resourceId);
      
      console.log(`[UnifiedResourceManager] Successfully loaded resource: ${resourceName} (ID: ${resourceId}) via ${loaderInfo.id}`);
      return resourceId;
      
    } catch (error) {
      console.error(`[UnifiedResourceManager] Failed to load ${resourceName}:`, error);
      throw error;
    }
  }
  
  /**
   * Unload the current level
   */
  async unloadCurrentLevel() {
    if (!this.currentLevel) {
      return;
    }
    
    console.log('[UnifiedResourceManager] Unloading current level');
    
    // Unload all resources from current level
    const resourcesToUnload = Array.from(this.levelResources.keys());
    for (const resourceId of resourcesToUnload) {
      this._unloadResource(resourceId);
    }
    
    this.currentLevel = null;
    this.levelResources.clear();
    
    console.log('[UnifiedResourceManager] Current level unloaded');
  }
  
  /**
   * Unload a specific resource
   * @private
   */
  _unloadResource(resourceId) {
    const resource = this.loadedResources.get(resourceId);
    if (!resource) {
      return false;
    }
    
    // Find the loader and unload through it
    const loaderResources = this.resourcesByLoader.get(resource.loaderId);
    if (loaderResources && loaderResources.has(resourceId)) {
      // Find the loader
      for (const [ext, loaderInfo] of this.loaders) {
        if (loaderInfo.id === resource.loaderId) {
          loaderInfo.loader.Unload(resourceId);
          break;
        }
      }
      
      loaderResources.delete(resourceId);
    }
    
    // Remove from tracking
    this.loadedResources.delete(resourceId);
    this.levelResources.delete(resourceId);
    
    console.log(`[UnifiedResourceManager] Unloaded resource: ${resource.name} (ID: ${resourceId})`);
    return true;
  }
  
  /**
   * Unload resources that are no longer needed
   * @private
   */
  async _unloadUnusedResources() {
    const currentLevelResourceNames = new Set(Object.keys(this.currentLevel?.resources || {}));
    const resourcesToUnload = [];
    
    // Find resources not in current level
    for (const [resourceId, resourceName] of this.levelResources) {
      if (!currentLevelResourceNames.has(resourceName)) {
        resourcesToUnload.push(resourceId);
      }
    }
    
    // Unload them
    for (const resourceId of resourcesToUnload) {
      this._unloadResource(resourceId);
    }
    
    if (resourcesToUnload.length > 0) {
      console.log(`[UnifiedResourceManager] Unloaded ${resourcesToUnload.length} unused resources`);
    }
  }
  
  /**
   * Get a loaded resource by name
   * @param {string} resourceName - Resource name from level
   * @returns {Object|null} Resource info or null if not found
   */
  getResource(resourceName) {
    const resource = this._findLoadedResourceByName(resourceName);
    return resource ? {
      id: resource.id,
      name: resource.name,
      filePath: resource.filePath,
      loaderId: resource.loaderId
    } : null;
  }
  
  /**
   * Get a resource by its integer ID
   * @param {number} resourceId - Integer resource ID
   * @returns {Object|null} Resource info or null if not found
   */
  getResourceById(resourceId) {
    const resource = this.loadedResources.get(resourceId);
    return resource ? {
      id: resource.id,
      name: resource.name,
      filePath: resource.filePath,
      loaderId: resource.loaderId
    } : null;
  }
  
  /**
   * Get all resources loaded by a specific loader
   * @param {string} loaderId - Loader ID
   * @returns {Array<Object>} Array of resource info objects
   */
  getResourcesByLoader(loaderId) {
    const resourceIds = this.resourcesByLoader.get(loaderId);
    if (!resourceIds) {
      return [];
    }
    
    const results = [];
    for (const resourceId of resourceIds) {
      const resource = this.loadedResources.get(resourceId);
      if (resource) {
        results.push({
          id: resource.id,
          name: resource.name,
          filePath: resource.filePath,
          loaderId: resource.loaderId
        });
      }
    }
    return results;
  }
  
  /**
   * Get all currently loaded resources
   * @returns {Array<Object>} Array of resource info objects
   */
  getAllResources() {
    const results = [];
    for (const resource of this.loadedResources.values()) {
      results.push({
        id: resource.id,
        name: resource.name,
        filePath: resource.filePath,
        loaderId: resource.loaderId
      });
    }
    return results;
  }
  
  /**
   * Clear all resources and unload current level
   */
  clear() {
    console.log('[UnifiedResourceManager] Clearing all resources');
    
    // Unload all resources through their loaders
    for (const resourceId of this.loadedResources.keys()) {
      this._unloadResource(resourceId);
    }
    
    // Clear all tracking
    this.loadedResources.clear();
    this.levelResources.clear();
    this.loadingPromises.clear();
    this.currentLevel = null;
    
    // Clear loader resource tracking
    for (const resourceSet of this.resourcesByLoader.values()) {
      resourceSet.clear();
    }
    
    console.log('[UnifiedResourceManager] All resources cleared');
  }
  
  // Helper methods
  
  /**
   * Find a loaded resource by name
   * @private
   */
  _findLoadedResourceByName(resourceName) {
    for (const [resourceId, name] of this.levelResources) {
      if (name === resourceName) {
        return this.loadedResources.get(resourceId);
      }
    }
    return null;
  }
  
  /**
   * Get file extension from path
   * @private
   */
  _getFileExtension(filePath) {
    const lastDotIndex = filePath.lastIndexOf('.');
    if (lastDotIndex === -1) {
      return '';
    }
    return filePath.substring(lastDotIndex).toLowerCase();
  }
  
  /**
   * Create a File object from file data
   * @private
   */
  _createFileObject(fileData, filePath) {
    const fileName = filePath.split('/').pop() || 'unknown';
    
    if (fileData.content instanceof ArrayBuffer) {
      return new File([fileData.content], fileName);
    } else if (fileData.binaryData && fileData.fileContent) {
      // Base64 encoded data
      const binaryString = atob(fileData.fileContent);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new File([bytes.buffer], fileName);
    } else if (typeof fileData === 'string' || (fileData.fileContent && !fileData.binaryData)) {
      // Text data
      const content = fileData.fileContent || fileData;
      return new File([content], fileName, { type: 'text/plain' });
    } else {
      throw new Error(`Unsupported file data format for: ${filePath}`);
    }
  }
}

// Export
window.UnifiedResourceManager = UnifiedResourceManager;
