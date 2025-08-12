// file-io-service.js
// Handles file persistence across different environments

class FileIOService {
  constructor() {
    this.storageType = 'indexeddb'; // 'indexeddb', 'localstorage', 'filesystem', 'nodejs'
    this.db = null;
    this.dbName = 'RetroStudioFiles';
    this.dbVersion = 1;
    this.initPromise = null; // Track initialization
    
    this.initPromise = this.initialize();
  }
  
  async initialize() {
    // Try to determine the best storage method
    if (this.isNodeEnvironment()) {
      this.storageType = 'nodejs';
      console.log('[FileIOService] Using Node.js filesystem');
    } else if (this.supportsFileSystemAccess()) {
      this.storageType = 'filesystem';
      console.log('[FileIOService] File System Access API available');
    } else if (this.supportsIndexedDB()) {
      this.storageType = 'indexeddb';
      await this.initIndexedDB();
      console.log('[FileIOService] Using IndexedDB');
    } else {
      this.storageType = 'localstorage';
      console.log('[FileIOService] Falling back to localStorage');
    }
    
    return this;
  }
  
  // Ensure service is ready before operations
  async ensureReady() {
    if (this.initPromise) {
      await this.initPromise;
    }
    return this;
  }
  
  isNodeEnvironment() {
    return typeof process !== 'undefined' && process.versions && process.versions.node;
  }
  
  supportsFileSystemAccess() {
    return 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
  }
  
  supportsIndexedDB() {
    return 'indexedDB' in window;
  }
  
  async initIndexedDB() {
    try {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, this.dbVersion);
        
        request.onerror = () => {
          console.warn('[FileIOService] IndexedDB failed, falling back to localStorage');
          this.storageType = 'localstorage';
          resolve();
        };
        
        request.onsuccess = () => {
          this.db = request.result;
          console.log('[FileIOService] IndexedDB initialized successfully');
          resolve();
        };
        
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          
          // Create object store for files
          if (!db.objectStoreNames.contains('files')) {
            const store = db.createObjectStore('files', { keyPath: 'path' });
            store.createIndex('filename', 'filename', { unique: false });
            store.createIndex('directory', 'directory', { unique: false });
          }
        };
      });
    } catch (error) {
      console.warn('[FileIOService] IndexedDB initialization failed, falling back to localStorage:', error);
      this.storageType = 'localstorage';
    }
  }
  
  // Save file content to persistent storage
  async saveFile(path, content, metadata = {}) {
    const fileData = {
      path: path,
      filename: path.split('/').pop(),
      directory: path.substring(0, path.lastIndexOf('/')),
      content: content,
      lastModified: Date.now(),
      size: new Blob([content]).size,
      ...metadata
    };
    
    try {
      // Ensure the service is ready
      await this.ensureReady();
      
      switch (this.storageType) {
        case 'indexeddb':
          return await this.saveToIndexedDB(fileData);
        case 'localstorage':
          return await this.saveToLocalStorage(fileData);
        case 'filesystem':
          return await this.saveToFileSystem(fileData);
        case 'nodejs':
          return await this.saveToNodeFS(fileData);
        default:
          // Fallback to localStorage if something goes wrong
          console.warn('[FileIOService] Unknown storage type, using localStorage');
          return await this.saveToLocalStorage(fileData);
      }
    } catch (error) {
      console.error('[FileIOService] Save failed, trying localStorage fallback:', error);
      try {
        return await this.saveToLocalStorage(fileData);
      } catch (fallbackError) {
        console.error('[FileIOService] All save methods failed:', fallbackError);
        throw fallbackError;
      }
    }
  }
  
  // Load file content from persistent storage
  async loadFile(path) {
    try {
      // Ensure the service is ready
      await this.ensureReady();
      
      switch (this.storageType) {
        case 'indexeddb':
          return await this.loadFromIndexedDB(path);
        case 'localstorage':
          return await this.loadFromLocalStorage(path);
        case 'filesystem':
          return await this.loadFromFileSystem(path);
        case 'nodejs':
          return await this.loadFromNodeFS(path);
        default:
          // Fallback to localStorage if something goes wrong
          console.warn('[FileIOService] Unknown storage type, using localStorage');
          return await this.loadFromLocalStorage(path);
      }
    } catch (error) {
      console.error('[FileIOService] Load failed, trying localStorage fallback:', error);
      try {
        return await this.loadFromLocalStorage(path);
      } catch (fallbackError) {
        console.error('[FileIOService] All load methods failed:', fallbackError);
        return null;
      }
    }
  }
  
  // IndexedDB implementation
  async saveToIndexedDB(fileData) {
    if (!this.db) {
      console.warn('[FileIOService] IndexedDB not ready, falling back to localStorage');
      return await this.saveToLocalStorage(fileData);
    }
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction(['files'], 'readwrite');
        const store = transaction.objectStore('files');
        const request = store.put(fileData);
        
        request.onsuccess = () => {
          console.log(`[FileIOService] Saved to IndexedDB: ${fileData.path}`);
          resolve(fileData);
        };
        request.onerror = () => {
          console.warn(`[FileIOService] IndexedDB save failed, falling back to localStorage`);
          this.saveToLocalStorage(fileData).then(resolve).catch(reject);
        };
        
        transaction.onerror = () => {
          console.warn(`[FileIOService] IndexedDB transaction failed, falling back to localStorage`);
          this.saveToLocalStorage(fileData).then(resolve).catch(reject);
        };
      } catch (error) {
        console.warn(`[FileIOService] IndexedDB error, falling back to localStorage:`, error);
        this.saveToLocalStorage(fileData).then(resolve).catch(reject);
      }
    });
  }
  
  async loadFromIndexedDB(path) {
    if (!this.db) {
      console.warn('[FileIOService] IndexedDB not ready, falling back to localStorage');
      return await this.loadFromLocalStorage(path);
    }
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction(['files'], 'readonly');
        const store = transaction.objectStore('files');
        const request = store.get(path);
        
        request.onsuccess = () => {
          if (request.result) {
            console.log(`[FileIOService] Loaded from IndexedDB: ${path}`);
          }
          resolve(request.result);
        };
        request.onerror = () => {
          console.warn(`[FileIOService] IndexedDB load failed, falling back to localStorage`);
          this.loadFromLocalStorage(path).then(resolve).catch(reject);
        };
        
        transaction.onerror = () => {
          console.warn(`[FileIOService] IndexedDB transaction failed, falling back to localStorage`);
          this.loadFromLocalStorage(path).then(resolve).catch(reject);
        };
      } catch (error) {
        console.warn(`[FileIOService] IndexedDB error, falling back to localStorage:`, error);
        this.loadFromLocalStorage(path).then(resolve).catch(reject);
      }
    });
  }
  
  // localStorage implementation (for simple fallback)
  async saveToLocalStorage(fileData) {
    const key = `retro_studio_file_${fileData.path}`;
    const dataToStore = JSON.stringify(fileData);
    localStorage.setItem(key, dataToStore);
    console.log(`[FileIOService] Saved to localStorage: ${fileData.path} (${dataToStore.length} chars)`);
    return fileData;
  }
  
  async loadFromLocalStorage(path) {
    const key = `retro_studio_file_${path}`;
    const data = localStorage.getItem(key);
    if (data) {
      const parsed = JSON.parse(data);
      console.log(`[FileIOService] Loaded from localStorage: ${path} (${parsed.content?.length || 0} chars)`);
      return parsed;
    } else {
      console.log(`[FileIOService] No data found in localStorage for: ${path}`);
      return null;
    }
  }
  
  // File System Access API implementation
  async saveToFileSystem(fileData) {
    // This would require user permission and file handles
    // For now, fall back to localStorage
    console.log('[FileIOService] File System Access not implemented, using localStorage');
    return await this.saveToLocalStorage(fileData);
  }
  
  async loadFromFileSystem(path) {
    // This would require stored file handles
    // For now, fall back to localStorage
    console.log('[FileIOService] File System Access not implemented, using localStorage');
    return await this.loadFromLocalStorage(path);
  }
  
  // Node.js filesystem implementation
  async saveToNodeFS(fileData) {
    if (typeof require === 'function') {
      const fs = require('fs').promises;
      const path = require('path');
      
      const fullPath = path.join(process.cwd(), fileData.path);
      const dir = path.dirname(fullPath);
      
      // Ensure directory exists
      await fs.mkdir(dir, { recursive: true });
      
      // Write file
      await fs.writeFile(fullPath, fileData.content, 'utf8');
      return fileData;
    }
    throw new Error('Node.js environment not available');
  }
  
  async loadFromNodeFS(path) {
    if (typeof require === 'function') {
      const fs = require('fs').promises;
      const pathModule = require('path');
      
      const fullPath = pathModule.join(process.cwd(), path);
      
      try {
        const content = await fs.readFile(fullPath, 'utf8');
        const stats = await fs.stat(fullPath);
        
        return {
          path: path,
          filename: pathModule.basename(path),
          directory: pathModule.dirname(path),
          content: content,
          lastModified: stats.mtime.getTime(),
          size: stats.size
        };
      } catch (error) {
        if (error.code === 'ENOENT') {
          return null; // File not found
        }
        throw error;
      }
    }
    throw new Error('Node.js environment not available');
  }
  
  // List files in a directory
  async listFiles(directoryPath = '') {
    try {
      switch (this.storageType) {
        case 'indexeddb':
          return await this.listFromIndexedDB(directoryPath);
        case 'localstorage':
          return await this.listFromLocalStorage(directoryPath);
        default:
          return [];
      }
    } catch (error) {
      console.error('[FileIOService] List files failed:', error);
      return [];
    }
  }
  
  async listFromIndexedDB(directoryPath) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const index = store.index('directory');
      const request = index.getAll(directoryPath);
      
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }
  
  async listFromLocalStorage(directoryPath) {
    const files = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('retro_studio_file_')) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          if (data.directory === directoryPath) {
            files.push(data);
          }
        } catch (error) {
          console.warn('Failed to parse stored file data:', key);
        }
      }
    }
    return files;
  }
  
  // Delete a file
  async deleteFile(path) {
    try {
      switch (this.storageType) {
        case 'indexeddb':
          return await this.deleteFromIndexedDB(path);
        case 'localstorage':
          return await this.deleteFromLocalStorage(path);
        default:
          return false;
      }
    } catch (error) {
      console.error('[FileIOService] Delete failed:', error);
      return false;
    }
  }
  
  async deleteFromIndexedDB(path) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.delete(path);
      
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }
  
  async deleteFromLocalStorage(path) {
    const key = `retro_studio_file_${path}`;
    localStorage.removeItem(key);
    return true;
  }
}

// Create global instance and initialize it
const fileIOService = new FileIOService();
fileIOService.initPromise.then(() => {
  window.fileIOService = fileIOService;
  console.log('[FileIOService] Service ready and available globally');
}).catch(error => {
  console.error('[FileIOService] Failed to initialize:', error);
  // Still make it available for localStorage fallback
  window.fileIOService = fileIOService;
});
