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
    } else if (this.supportsIndexedDB()) {
      this.storageType = 'indexeddb';
      await this.initIndexedDB();
      console.log('[FileIOService] Using IndexedDB');
      // Note: File System Access API may also be available, but we prefer IndexedDB
    } else {
  // Force IndexedDB-only approach; if unavailable, operations will fail loudly
  this.storageType = 'indexeddb';
  console.error('[FileIOService] IndexedDB not supported in this environment');
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
          console.error('[FileIOService] IndexedDB failed');
          this.db = null;
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
      console.error('[FileIOService] IndexedDB initialization failed:', error);
      this.db = null;
    }
  }
  
  // Save file content to persistent storage
  async saveFile(path, content, metadata = {}) {
    console.log(`[FileIOService] saveFile called:`);
    console.log(`[FileIOService] - Path: ${path}`);
    console.log(`[FileIOService] - Content type: ${typeof content}`);
    console.log(`[FileIOService] - Content length: ${content.length}`);
    
    // Safe preview generation for different content types
    let preview = '';
    if (typeof content === 'string') {
      preview = content.substring(0, 100) + '...';
    } else if (content instanceof ArrayBuffer) {
      const view = new Uint8Array(content);
      preview = `ArrayBuffer[${content.byteLength}] first bytes: ${Array.from(view.slice(0, 10)).join(' ')}...`;
    } else if (content instanceof Uint8Array) {
      preview = `Uint8Array[${content.length}] first bytes: ${Array.from(content.slice(0, 10)).join(' ')}...`;
    } else {
      preview = `${typeof content} content`;
    }
    console.log(`[FileIOService] - Content preview: ${preview}`);
    console.log(`[FileIOService] - Metadata:`, metadata);
    
    // Handle binary data conversion for storage
    let processedContent = content;
    let isBinaryData = false;

    // Only encode as base64 if content is actually binary types (ArrayBuffer/Uint8Array)
    // Editors are responsible for providing content in the correct format
    
    // Helper to safely convert binary to base64 without blowing the call stack
    const toBase64 = (bufOrBytes) => {
      const bytes = bufOrBytes instanceof Uint8Array ? bufOrBytes : new Uint8Array(bufOrBytes);
      const chunkSize = 0x8000; // 32KB chunks to avoid argument limits
      let binary = '';
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, bytes.length);
        // Build chunk string without spread/apply to avoid stack overflow
        let chunkStr = '';
        for (let j = i; j < end; j++) {
          chunkStr += String.fromCharCode(bytes[j]);
        }
        binary += chunkStr;
      }
      return btoa(binary);
    };

    try {
      // Only encode truly binary content types
      if (content instanceof ArrayBuffer) {
        processedContent = toBase64(content);
        isBinaryData = true;
      } else if (content instanceof Uint8Array) {
        processedContent = toBase64(content);
        isBinaryData = true;
      } else if (metadata.binaryData === true) {
        // Editor explicitly requested binary encoding
        if (typeof content === 'string') {
          processedContent = btoa(content);
          isBinaryData = true;
        }
      }
    } catch (e) {
      console.error('[FileIOService] Failed to encode binary content, aborting save for path:', path, e);
      throw e;
    }
    
    const fileData = {
      path: path,
      filename: path.split('/').pop(),
      directory: path.substring(0, path.lastIndexOf('/')),
      fileContent: processedContent,  // Use fileContent instead of content
      lastModified: Date.now(),
      size: content instanceof ArrayBuffer ? content.byteLength : 
            typeof content === 'string' ? content.length :
            new Blob([content]).size,
      binaryData: isBinaryData,
      ...metadata
    };
    
    console.log(`[FileIOService] Final fileData being stored:`);
    console.log(`[FileIOService] - processedContent type: ${typeof processedContent}`);
    console.log(`[FileIOService] - processedContent length: ${processedContent.length}`);
    console.log(`[FileIOService] - processedContent preview: ${processedContent.substring(0, 100)}...`);
    console.log(`[FileIOService] - isBinaryData: ${isBinaryData}`);
    console.log(`[FileIOService] - fileData.binaryData: ${fileData.binaryData}`);
    
    try {
      // Ensure the service is ready
      await this.ensureReady();
      
      switch (this.storageType) {
        case 'indexeddb':
          return await this.saveToIndexedDB(fileData);
        case 'nodejs':
          return await this.saveToNodeFS(fileData);
        default:
          throw new Error('Unsupported storage type');
      }
    } catch (error) {
      console.error('[FileIOService] Save failed:', error);
      throw error;
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
        case 'nodejs':
          return await this.loadFromNodeFS(path);
        default:
          throw new Error('Unsupported storage type');
      }
    } catch (error) {
      console.error('[FileIOService] Load failed:', error);
      return null;
    }
  }
  
  // IndexedDB implementation
  async saveToIndexedDB(fileData) {
    if (!this.db) {
  throw new Error('IndexedDB not ready');
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
  request.onerror = () => reject(request.error);
        
  transaction.onerror = () => reject(transaction.error);
      } catch (error) {
  reject(error);
      }
    });
  }
  
  async loadFromIndexedDB(path) {
    if (!this.db) {
  throw new Error('IndexedDB not ready');
    }
    
    return new Promise((resolve, reject) => {
      try {
        // Validate the path parameter
        if (!path || typeof path !== 'string') {
          console.error('[FileIOService] Invalid path for IndexedDB get:', typeof path, path);
          reject(new Error(`Invalid path: ${path}`));
          return;
        }
        
        const transaction = this.db.transaction(['files'], 'readonly');
        const store = transaction.objectStore('files');
        const request = store.get(path);
        
        request.onsuccess = () => {
          const result = request.result;
          if (result) {
            console.log(`[FileIOService] Raw data loaded from IndexedDB for ${path}:`);
            console.log(`[FileIOService] - result.binaryData: ${result.binaryData}`);
            console.log(`[FileIOService] - result.fileContent type: ${typeof result.fileContent}`);
            console.log(`[FileIOService] - result.fileContent length: ${result.fileContent.length}`);
            console.log(`[FileIOService] - result.fileContent preview: ${result.fileContent.substring(0, 100)}...`);
            
            // Decode base64 to ArrayBuffer if binary
            if (result.binaryData && result.fileContent) {
              try {
                const binaryString = atob(result.fileContent);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                result.content = bytes.buffer;
              } catch (err) {
                console.warn(`[FileIOService] Failed to decode binary data for ${path}:`, err);
                result.content = result.fileContent;
              }
            } else {
              result.content = result.fileContent;
            }
            console.log(`[FileIOService] Loaded from IndexedDB: ${path}`);
            resolve(result);
          } else {
            // Normalize missing record to null
            resolve(null);
          }
        };
  request.onerror = () => reject(request.error);
        
  transaction.onerror = () => reject(transaction.error);
      } catch (error) {
  reject(error);
      }
    });
  }
  
  // localStorage implementation (for simple fallback)
  // Removed localStorage fallbacks for pure IndexedDB approach
  
  // File System Access API implementation
  async saveToFileSystem(fileData) { throw new Error('File System Access not supported'); }
  async loadFromFileSystem(path) { throw new Error('File System Access not supported'); }
  
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
        default:
          return [];
      }
    } catch (error) {
      console.error('[FileIOService] List files failed:', error);
      return [];
    }
  }
  
  async listFromIndexedDB(directoryPath) {
    // Support exact directory listing and prefix search (case-insensitive)
    const hasDir = typeof directoryPath === 'string' && directoryPath.length > 0;
    const dirLower = hasDir ? directoryPath.toLowerCase() : '';
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction(['files'], 'readonly');
        const store = transaction.objectStore('files');
        const results = [];
        const request = store.openCursor();
        
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const value = cursor.value;
            if (!hasDir) {
              results.push(value);
            } else {
              const path = (value.path || '').toLowerCase();
              const dir = (value.directory || '').toLowerCase();
              if (dir === dirLower || path.startsWith(dirLower + '/') || path.startsWith(dirLower)) {
                results.push(value);
              }
            }
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }
  
  // Removed localStorage listing for pure IndexedDB approach
  
  // Delete a file
  async deleteFile(path) {
    try {
      switch (this.storageType) {
        case 'indexeddb':
          return await this.deleteFromIndexedDB(path);
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
  
  // Removed localStorage delete for pure IndexedDB approach

  // Danger: Clear all persisted files in IndexedDB
  async clearAll() {
    await this.ensureReady();
    if (!this.db) return 0;
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(['files'], 'readwrite');
        const store = tx.objectStore('files');
        const clearReq = store.clear();
        clearReq.onsuccess = () => resolve(1);
        clearReq.onerror = () => reject(clearReq.error);
      } catch (e) {
        reject(e);
      }
    });
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
