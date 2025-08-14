/**
 * FileManager - Unified file operations interface
 * 
 * This service provides a consistent abstraction layer for all file operations,
 * isolating storage logic and providing hooks for different storage backends.
 */
class FileManager {
  constructor() {
    this.storageService = null;
    this.listeners = new Map(); // For file change notifications
  }

  /**
   * Initialize the FileManager with a storage service
   * @param {Object} storageService - The storage backend (fileIOService, etc.)
   */
  initialize(storageService) {
    this.storageService = storageService;
    console.log('[FileManager] Initialized with storage service');
  }

  // Normalize any UI path (project-prefixed, UI labels) to storage path
  _normalizePath(path) {
    try {
      if (window.ProjectPaths && typeof window.ProjectPaths.normalizeStoragePath === 'function') {
        return window.ProjectPaths.normalizeStoragePath(path);
      }
    } catch (e) {
      // no-op
    }
    return path;
  }

  /**
   * Create a standardized in-memory file object
   * @param {string} name - File name
   * @param {string|ArrayBuffer|Uint8Array} content - File content
   * @param {Object} options - Additional options (type, lastModified, etc.)
   * @returns {Object} Standardized file object
   */
  createFileObject(name, content = '', options = {}) {
    const fileObj = {
      name,
      content,
      size: this._getContentSize(content),
      type: options.type || this._inferMimeType(name),
      lastModified: options.lastModified || Date.now(),
      path: options.path || null,
      isNew: options.isNew || false,
      isDirty: options.isDirty || false
    };

    console.log(`[FileManager] Created file object: ${name} (${fileObj.size} bytes)`);
    return fileObj;
  }

  /**
   * Save a file to storage
   * @param {string} path - Full path where to save the file
   * @param {Object|string|ArrayBuffer} content - File content or file object
   * @param {Object} options - Save options
   * @returns {Promise<boolean>} Success status
   */
  async saveFile(path, content, options = {}) {
    if (!this.storageService) {
      throw new Error('[FileManager] Storage service not initialized');
    }

    try {
      // Extract content if we received a file object
      const actualContent = (content && typeof content === 'object' && 'content' in content) 
        ? content.content 
        : content;

  const normPath = this._normalizePath(path);
  console.log(`[FileManager] Saving file: ${normPath}`);
  // Forward options as metadata so fields like builderId persist
  const success = await this.storageService.saveFile(normPath, actualContent, options);
      
      if (success) {
        this._notifyFileChanged(path, 'saved');
        console.log(`[FileManager] Successfully saved: ${path}`);
      } else {
        console.error(`[FileManager] Failed to save: ${path}`);
      }
      
      return success;
    } catch (error) {
      console.error(`[FileManager] Error saving file ${path}:`, error);
      return false;
    }
  }

  /**
   * Load a file from storage
   * @param {string} path - Full path of the file to load
   * @returns {Promise<Object|null>} File object or null if not found
   */
  async loadFile(path) {
    if (!this.storageService) {
      throw new Error('[FileManager] Storage service not initialized');
    }

    try {
      const normPath = this._normalizePath(path);
      console.log(`[FileManager] Loading file: ${normPath}`);
      const content = await this.storageService.loadFile(normPath);
      
    console.log('[FileManager] Storage service returned:', content);
      console.log(`[FileManager] Content type:`, typeof content);
      
      if (content === null) {
        console.log(`[FileManager] File not found: ${path}`);
        return null;
      }

      // Extract filename from path
  const fileName = normPath.split('/').pop() || normPath.split('\\').pop();
      
      // The storage service returns an object with properties, we want to return it directly
      // instead of wrapping it in another createFileObject call
      if (typeof content === 'object' && content.content !== undefined) {
        console.log(`[FileManager] Returning storage service object directly`);
        return content;
      }
      
      // Fallback: create file object if storage service returned plain content
      const fileObj = this.createFileObject(fileName, content, {
        path: normPath,
        isNew: false,
        isDirty: false
      });

      console.log(`[FileManager] Successfully loaded: ${path} (${fileObj.size} bytes)`);
      return fileObj;
    } catch (error) {
      console.error(`[FileManager] Error loading file ${path}:`, error);
      return null;
    }
  }

  /**
   * Check if a file exists in storage
   * @param {string} path - Full path of the file
   * @returns {Promise<boolean>} True if file exists
   */
  async fileExists(path) {
    if (!this.storageService) {
      return false;
    }

    try {
      const normPath = this._normalizePath(path);
      const content = await this.storageService.loadFile(normPath);
      return content !== null;
    } catch (error) {
      console.error(`[FileManager] Error checking file existence ${path}:`, error);
      return false;
    }
  }

  /**
   * Delete a file from storage
   * @param {string} path - Full path of the file to delete
   * @returns {Promise<boolean>} Success status
   */
  async deleteFile(path) {
    if (!this.storageService || !this.storageService.deleteFile) {
      console.warn('[FileManager] Delete operation not supported by storage service');
      return false;
    }

    try {
      const normPath = this._normalizePath(path);
      console.log(`[FileManager] Deleting file: ${normPath}`);
      const success = await this.storageService.deleteFile(normPath);
      
      if (success) {
        this._notifyFileChanged(path, 'deleted');
        console.log(`[FileManager] Successfully deleted: ${path}`);
      }
      
      return success;
    } catch (error) {
      console.error(`[FileManager] Error deleting file ${path}:`, error);
      return false;
    }
  }

  /**
   * List all files in storage
   * @param {string} prefix - Optional prefix to filter files
   * @returns {Promise<string[]>} Array of file paths
   */
  async listFiles(prefix = '') {
    if (!this.storageService || !this.storageService.listFiles) {
      console.warn('[FileManager] List operation not supported by storage service');
      return [];
    }

    try {
      const normPrefix = this._normalizePath(prefix);
      const files = await this.storageService.listFiles(normPrefix);
      console.log(`[FileManager] Listed ${files.length} files with prefix: ${normPrefix}`);
      return files;
    } catch (error) {
      console.error(`[FileManager] Error listing files:`, error);
      return [];
    }
  }

  /**
   * Create and save a new file immediately
   * @param {string} path - Full path for the new file
   * @param {string|ArrayBuffer} content - Initial content
   * @param {Object} options - Creation options
   * @returns {Promise<Object|null>} File object if successful
   */
  async createAndSaveFile(path, content = '', options = {}) {
    try {
      const normPath = this._normalizePath(path);
      // First save to storage
      const saveSuccess = await this.saveFile(normPath, content, options);
      if (!saveSuccess) {
        console.error(`[FileManager] Failed to save new file: ${normPath}`);
        return null;
      }

      // Then load it back to get a consistent file object
      const fileObj = await this.loadFile(normPath);
      if (fileObj) {
        fileObj.isNew = true; // Mark as newly created
        this._notifyFileChanged(normPath, 'created');
      }

      return fileObj;
    } catch (error) {
      console.error(`[FileManager] Error creating file ${path}:`, error);
      return null;
    }
  }

  /**
   * Register a listener for file change events
   * @param {string} event - Event type: 'created', 'saved', 'deleted', 'changed'
   * @param {Function} callback - Callback function
   */
  onFileChanged(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  /**
   * Remove a file change listener
   * @param {string} event - Event type
   * @param {Function} callback - Callback function to remove
   */
  offFileChanged(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  // PRIVATE METHODS

  /**
   * Notify listeners of file changes
   * @private
   */
  _notifyFileChanged(path, event) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(path, event);
        } catch (error) {
          console.error(`[FileManager] Error in file change listener:`, error);
        }
      });
    }

    // Also notify generic 'changed' listeners
    if (event !== 'changed' && this.listeners.has('changed')) {
      this.listeners.get('changed').forEach(callback => {
        try {
          callback(path, event);
        } catch (error) {
          console.error(`[FileManager] Error in file change listener:`, error);
        }
      });
    }
  }

  /**
   * Get the size of content in bytes
   * @private
   */
  _getContentSize(content) {
    if (typeof content === 'string') {
      return new Blob([content]).size;
    } else if (content instanceof ArrayBuffer) {
      return content.byteLength;
    } else if (content instanceof Uint8Array) {
      return content.length;
    }
    return 0;
  }

  /**
   * Infer MIME type from filename
   * @private
   */
  _inferMimeType(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes = {
      'txt': 'text/plain',
      'lua': 'text/x-lua',
      'js': 'text/javascript',
      'json': 'application/json',
  'pal': 'text/plain',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'wav': 'audio/wav',
      'mp3': 'audio/mpeg'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}

// Create and export singleton instance
window.FileManager = new FileManager();

console.log('[FileManager] Service loaded');

// Lightweight File wrapper for convenience (available globally)
class RSFile {
  constructor(record, storageService) {
    this._record = record || {};
    this._storage = storageService || window.fileIOService;
  }
  get path() { return this._record.path; }
  get name() { return this._record.filename || (this._record.path ? this._record.path.split('/').pop() : ''); }
  get directory() { return this._record.directory || (this._record.path ? this._record.path.substring(0, this._record.path.lastIndexOf('/')) : ''); }
  get size() { return this._record.size || (typeof this.content === 'string' ? new Blob([this.content]).size : (this.content?.byteLength || 0)); }
  get lastModified() { return this._record.lastModified || Date.now(); }
  get isBinary() { return !!this._record.binaryData; }
  get builderId() { return this._record.builderId; }
  set builderId(id) { this._record.builderId = id; }
  get content() { return this._record.content !== undefined ? this._record.content : this._record.fileContent; }
  set content(val) { this._record.content = val; this._record.fileContent = val; }
  toJSON() { return { ...this._record, content: this.content }; }
  async read() { return this.content; }
  async write(newContent, metadata = {}) {
    this.content = newContent;
    if (!this._storage || !this.path) return false;
    const meta = { ...metadata };
    if (this.builderId && meta.builderId === undefined) meta.builderId = this.builderId;
    await this._storage.saveFile(this.path, newContent, meta);
    return true;
  }
}
window.RSFile = RSFile;
