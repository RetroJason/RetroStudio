// game-editor.js
// Main game engine editor that integrates audio engine and project explorer

class GameEditor {
  constructor() {
    this.audioEngine = null;
    this.resourceManager = null;
    this.projectExplorer = null;
    this.buildSystem = null;
    this.loadedAudioResources = new Map(); // Maps file paths to resource IDs
    
    this.initialize();
  }
  
  async initialize() {
    console.log('=== Game Engine Editor ===');
    
    // Initialize audio engine
    this.audioEngine = new AudioEngine();
    const audioSuccess = await this.audioEngine.initialize();
    
    if (!audioSuccess) {
      console.error('[GameEditor] Failed to initialize audio engine');
      return false;
    }
    
    // Create resource manager
    this.resourceManager = new ResourceManager(this.audioEngine);
    
    // Initialize build system
    this.buildSystem = new BuildSystem();
    window.buildSystem = this.buildSystem; // Make available globally for builders
    
    // Listen for audio engine events
    this.audioEngine.addEventListener('resourceLoaded', this.onResourceLoaded.bind(this));
    this.audioEngine.addEventListener('resourceUpdated', this.onResourceUpdated.bind(this));
    
    // Initialize tab manager
    this.tabManager = new TabManager();
    window.tabManager = this.tabManager; // Make available globally
    
    // Listen for tab changes to update save button state and project explorer
    this.tabManager.addEventListener('tabSwitched', (data) => {
      this.updateSaveButtonState();
      // Project explorer highlighting is handled automatically in TabManager
    });
    
    // Initialize project explorer
    this.projectExplorer = new ProjectExplorer();
    
    // Set up UI event handlers
    this.setupUI();
    
    // Add audio context resume handler
    this.addAudioContextResumeHandler();
    
    // Update initial UI state
    this.updateSaveButtonState();
    
    console.log('[GameEditor] Initialized successfully');
    return true;
  }
  
  setupUI() {
    // The ribbon toolbar handles its own button setup
    // We just need to set up global keyboard shortcuts
    
    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl+S to save
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        this.saveActiveEditor();
      }
    });
  }
  
  addAudioContextResumeHandler() {
    const resumeHandler = async () => {
      if (this.audioEngine.audioContext.state === 'suspended') {
        console.log('[GameEditor] User interaction detected, resuming AudioContext...');
        try {
          await this.audioEngine.audioContext.resume();
          console.log('[GameEditor] AudioContext resumed, state:', this.audioEngine.audioContext.state);
        } catch (error) {
          console.warn('[GameEditor] Failed to resume AudioContext:', error);
        }
      }
      // Remove handler after first use
      document.removeEventListener('click', resumeHandler);
      document.removeEventListener('keydown', resumeHandler);
    };
    
    // Listen for any user interaction
    document.addEventListener('click', resumeHandler);
    document.addEventListener('keydown', resumeHandler);
  }
  
  // Called by ProjectExplorer when files are added
  async onFileAdded(file, path, doTreeOperations = true) {
    console.log(`[GameEditor] File added: ${file.name} at ${path}`);
    
    // Determine file type
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    let audioType = null;
    
    if (['.mod', '.xm', '.s3m', '.it', '.mptm'].includes(ext)) {
      audioType = 'mod';
    } else if (['.wav'].includes(ext)) {
      audioType = 'wav';
    }
    
    if (audioType) {
      // Just register the file for later loading, don't load it immediately
      const fileKey = path + '/' + file.name;
      this.pendingAudioFiles = this.pendingAudioFiles || new Map();
      this.pendingAudioFiles.set(fileKey, { file, audioType, path });
      
      console.log(`[GameEditor] Registered audio file for lazy loading: ${file.name} (${audioType})`);
      this.updateStatus(`Registered ${file.name}`, 'info');
    }
    
    // Auto-open the file in a tab using unified logic
    if (this.tabManager) {
      try {
        console.log(`[GameEditor] Auto-opening file: ${file.name}`);
        const fullPath = `${path}/${file.name}`;
        await this.tabManager.openInTab(fullPath, file);
        
        // Only do tree operations if requested (i.e., not called from bulk file addition)
        if (doTreeOperations) {
          // Small delay to ensure DOM is updated before tree operations
          setTimeout(() => {
            // Expand tree view and select the file
            if (this.projectExplorer) {
              this.projectExplorer.expandToPath(path);
              this.projectExplorer.selectFile(path, file.name);
            }
          }, 100);
        }
      } catch (error) {
        console.error(`[GameEditor] Failed to auto-open file ${file.name}:`, error);
      }
    }
  }
  
  updateStatus(message, type = 'info') {
    console.log(`[GameEditor] Status: ${message}`);
  }
  
  playProject() {
    console.log('[GameEditor] Play project');
    
    // Check if there's an active Lua script editor
    const activeTab = this.tabManager.tabs.get(this.tabManager.activeTabId);
    
    if (activeTab && activeTab.isEditor && activeTab.subtype === '.lua') {
      // Run the active Lua script
      this.runLuaScript(activeTab.viewer);
    } else {
      // Look for main.lua in the project
      const mainLua = this.findMainLuaScript();
      if (mainLua) {
        this.runLuaScript(mainLua);
      } else {
        this.updateStatus('No Lua script to run. Create or open a Lua script first.', 'warning');
        alert('No Lua script to run. Create or open a Lua script first.');
      }
    }
  }
  
  async buildProject() {
    console.log('[GameEditor] Building project...');
    this.updateStatus('Building project...', 'info');
    
    try {
      // Auto-save all open tabs before building
      if (this.tabManager) {
        await this.tabManager.saveAllOpenTabs();
      }
      
      // Debug project explorer structure
      console.log('[GameEditor] ProjectExplorer:', this.projectExplorer);
      console.log('[GameEditor] ProjectData structure:', this.projectExplorer?.projectData?.structure);
      
      // Get project files from the ProjectExplorer
      if (!this.projectExplorer) {
        this.updateStatus('No project explorer available', 'warning');
        return;
      }
      
      // Build the project using the build system (it will read from projectExplorer directly)
      const buildResult = await this.buildSystem.buildProject();
      
      // Refresh build file tabs after successful build
      if (this.tabManager && buildResult && buildResult.success !== false) {
        // Get list of build files from project explorer
        const buildFiles = this.getAllBuildFiles();
        await this.tabManager.refreshBuildTabs(buildFiles);
      }
      
      this.updateStatus('Project built successfully!', 'success');
    } catch (error) {
      console.error('[GameEditor] Build failed:', error);
      this.updateStatus(`Build failed: ${error.message}`, 'error');
    }
  }
  
  getAllBuildFiles() {
    // Get all files from the Build folder in project explorer
    const buildFiles = [];
    
    if (!this.projectExplorer || !this.projectExplorer.projectData || !this.projectExplorer.projectData.structure.Build) {
      return buildFiles;
    }
    
    const collectFiles = (node, currentPath = '') => {
      if (node.type === 'file') {
        buildFiles.push({
          name: node.name,
          path: currentPath,
          type: node.type
        });
      } else if (node.children) {
        for (const [childName, childNode] of Object.entries(node.children)) {
          const childPath = currentPath ? `${currentPath}/${childName}` : childName;
          collectFiles(childNode, childPath);
        }
      }
    };
    
    // Start collecting from Build folder
    collectFiles(this.projectExplorer.projectData.structure.Build, 'Build');
    
    console.log(`[GameEditor] Found ${buildFiles.length} build files:`, buildFiles);
    return buildFiles;
  }
  
  findMainLuaScript() {
    // Look for main.lua in the Lua directory
    const luaFolder = this.projectExplorer.projectData.structure.Resources?.Lua?.children;
    if (luaFolder && luaFolder['main.lua']) {
      return luaFolder['main.lua'];
    }
    
    // If no main.lua, look for any .lua file
    if (luaFolder) {
      for (const [filename, fileData] of Object.entries(luaFolder)) {
        if (filename.endsWith('.lua')) {
          return fileData;
        }
      }
    }
    
    return null;
  }
  
  runLuaScript(scriptSource) {
    let content = '';
    let scriptName = '';
    
    if (scriptSource.getContent) {
      // It's an editor
      content = scriptSource.getContent();
      scriptName = scriptSource.file.name;
    } else if (scriptSource.file) {
      // It's a file data object
      scriptName = scriptSource.file.name;
      // Read file content
      const reader = new FileReader();
      reader.onload = (e) => {
        content = e.target.result;
        this.executeScript(content, scriptName);
      };
      reader.readAsText(scriptSource.file);
      return;
    }
    
    this.executeScript(content, scriptName);
  }
  
  executeScript(content, scriptName) {
    if (!content.trim()) {
      this.updateStatus('Script is empty!', 'warning');
      alert('Script is empty!');
      return;
    }
    
    console.log(`[GameEditor] Running Lua script: ${scriptName}`);
    console.log(content);
    
    // Create a simple output window for now
    const outputWindow = window.open('', '_blank', 'width=800,height=600,scrollbars=yes,resizable=yes');
    outputWindow.document.write(`
      <html>
        <head>
          <title>Game Project - ${scriptName}</title>
          <style>
            body { 
              font-family: 'Consolas', 'Courier New', monospace; 
              background: #1e1e1e; 
              color: #cccccc; 
              padding: 20px; 
              margin: 0;
            }
            .header { 
              color: #0078d4; 
              margin-bottom: 15px; 
              font-size: 18px;
              border-bottom: 1px solid #3c3c3c;
              padding-bottom: 10px;
            }
            .code { 
              background: #2d2d30; 
              padding: 20px; 
              border-radius: 6px; 
              white-space: pre-wrap; 
              border: 1px solid #3c3c3c;
              line-height: 1.5;
            }
            .note {
              margin-top: 15px;
              color: #ffb74d;
              font-style: italic;
            }
          </style>
        </head>
        <body>
          <div class="header">🚀 Running: ${scriptName}</div>
          <div class="code">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
          <div class="note">Note: Actual Lua execution will be implemented in future updates</div>
        </body>
      </html>
    `);
    
    this.updateStatus(`Running ${scriptName}`, 'success');
  }
  
  createProject() {
    console.log('[GameEditor] Create new project');
    // For now, this could reset the current project or show a new project dialog
    this.updateStatus('Create project - not implemented yet', 'info');
  }
  
  saveActiveEditor() {
    // Get the currently active tab
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab) {
      this.updateStatus('No active editor to save', 'warning');
      return;
    }
    
    // Check if the active tab has a viewer that can save
    const viewer = activeTab.viewer;
    if (viewer && typeof viewer.save === 'function') {
      try {
        viewer.save();
        const tabTitle = activeTab.title || viewer.file?.name || 'file';
        this.updateStatus(`Saved ${tabTitle}`, 'success');
      } catch (error) {
        console.error('[GameEditor] Failed to save:', error);
        const tabTitle = activeTab.title || viewer.file?.name || 'file';
        this.updateStatus(`Failed to save ${tabTitle}: ${error.message}`, 'error');
      }
    } else {
      this.updateStatus('Active tab does not support saving', 'warning');
    }
  }
  
  updateSaveButtonState() {
    // Update ribbon toolbar save button state
    if (window.ribbonToolbar) {
      window.ribbonToolbar.onTabChanged();
    }
    
    // Legacy support for old button (if still present)
    const saveBtn = document.getElementById('saveBtn');
    if (!saveBtn) return;
    
    const activeTab = this.tabManager.getActiveTab();
    const canSave = activeTab && activeTab.viewer && typeof activeTab.viewer.save === 'function';
    
    saveBtn.disabled = !canSave;
    if (canSave) {
      const tabTitle = activeTab.title || activeTab.viewer.file?.name || 'current file';
      saveBtn.title = `Save ${tabTitle} (Ctrl+S)`;
    } else {
      saveBtn.title = 'No active editor to save';
    }
  }
  
  // Utility methods
  
  getAllMusicFiles() {
    return this.projectExplorer.getProjectFiles('music');
  }
  
  getAllSFXFiles() {
    return this.projectExplorer.getProjectFiles('sfx');
  }
  
  getLoadedResourceId(filename) {
    for (const [path, id] of this.loadedAudioResources) {
      if (path.endsWith(filename)) {
        return id;
      }
    }
    return null;
  }

  // Load an audio file on demand (called by viewers)
  async loadAudioFileOnDemand(filename) {
    console.log(`[GameEditor] Loading audio file on demand: ${filename}`);
    
    // Check if already loaded
    const existingId = this.getLoadedResourceId(filename);
    if (existingId) {
      console.log(`[GameEditor] File ${filename} already loaded with ID: ${existingId}`);
      return existingId;
    }
    
    // First try to find in pending files (regular project files)
    if (this.pendingAudioFiles) {
      for (const [fileKey, fileData] of this.pendingAudioFiles.entries()) {
        if (fileKey.endsWith(filename)) {
          try {
            console.log(`[GameEditor] Loading ${filename} (${fileData.audioType})...`);
            const resourceId = await this.resourceManager.loadFromFile(fileData.file, fileData.audioType);
            
            // Move from pending to loaded
            this.loadedAudioResources.set(fileKey, resourceId);
            this.pendingAudioFiles.delete(fileKey);
            
            console.log(`[GameEditor] Loaded audio resource: ${resourceId} (${filename})`);
            this.updateStatus(`Loaded ${filename}`, 'success');
            
            return resourceId;
          } catch (error) {
            console.error(`[GameEditor] Failed to load audio file ${filename}:`, error);
            throw error;
          }
        }
      }
    }
    
    // If not found in pending files, try to load from build files in localStorage
    console.log(`[GameEditor] File ${filename} not found in pending files, checking build files...`);
    
    try {
      // Check localStorage for build files - prioritize cleaner paths
      const buildKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('build/') && key.endsWith(filename)) {
          buildKeys.push(key);
        }
      }
      
      // Sort keys to prioritize cleaner paths (without .sfx/ in the middle and without Resources/)
      buildKeys.sort((a, b) => {
        const aHasInvalidPath = a.includes('.sfx/');
        const bHasInvalidPath = b.includes('.sfx/');
        const aHasResources = a.includes('/Resources/');
        const bHasResources = b.includes('/Resources/');
        
        // Strongly prioritize paths without invalid patterns
        if (aHasInvalidPath && !bHasInvalidPath) return 1;
        if (!aHasInvalidPath && bHasInvalidPath) return -1;
        
        // Prefer new format paths (without Resources/)
        if (aHasResources && !bHasResources) return 1;
        if (!aHasResources && bHasResources) return -1;
        
        return 0;
      });
      
      for (const key of buildKeys) {
        console.log(`[GameEditor] Trying build file in localStorage: ${key}`);
        
        const data = localStorage.getItem(key);
        if (data) {
          // Parse the stored data (it's JSON from FileIOService)
          const fileInfo = JSON.parse(data);
          console.log(`[GameEditor] File info structure:`, Object.keys(fileInfo));
          console.log(`[GameEditor] Has binaryData flag:`, fileInfo.binaryData);
          console.log(`[GameEditor] Has fileContent:`, !!fileInfo.fileContent);
          console.log(`[GameEditor] Has content:`, !!fileInfo.content);
          
          // Create a File object from the stored data
          let fileContent;
          if (fileInfo.binaryData && fileInfo.fileContent) {
            try {
              // For binary data, convert base64 back to ArrayBuffer
              const binaryString = atob(fileInfo.fileContent);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              fileContent = bytes.buffer;
              console.log(`[GameEditor] Decoded base64 to ArrayBuffer, size: ${fileContent.byteLength}`);
            } catch (base64Error) {
              console.warn(`[GameEditor] Base64 decode failed for ${key}, trying raw data:`, base64Error);
              // If base64 decode fails, the data might already be raw
              fileContent = fileInfo.fileContent;
            }
          } else if (fileInfo.content) {
            // Use content field if available (from updated FileIOService)
            fileContent = fileInfo.content;
            console.log(`[GameEditor] Using content field, type:`, typeof fileContent);
          } else {
            fileContent = fileInfo.fileContent || data;
            console.log(`[GameEditor] Using fallback content, type:`, typeof fileContent);
          }
          
          const file = new File([fileContent], filename, { 
            type: fileInfo.type || 'audio/wav'
          });
          
          console.log(`[GameEditor] Loading build file ${filename}...`);
          const resourceId = await this.resourceManager.loadFromFile(file, 'wav');
          
          // Add to loaded resources
          this.loadedAudioResources.set(key, resourceId);
          
          console.log(`[GameEditor] Loaded build audio resource: ${resourceId} (${filename})`);
          this.updateStatus(`Loaded ${filename}`, 'success');
          
          return resourceId;
        }
      }
    } catch (error) {
      console.error(`[GameEditor] Error loading build file ${filename}:`, error);
    }
    
    // If we get here, the file wasn't found anywhere
    throw new Error(`File ${filename} not found in project or build files`);
  }

  onResourceLoaded(event) {
    const { resourceId, resource, type } = event.detail;
    console.log(`[GameEditor] Resource loaded event: ${resourceId} (${type})`);
    this.updateStatus(`Loaded ${resource.name}`, 'success');
  }

  onResourceUpdated(event) {
    const { resourceId, property, value } = event.detail;
    console.log(`[GameEditor] Resource updated event: ${resourceId} ${property} = ${value}`);
    
    // Find the filename for this resource
    let filename = null;
    for (const [fileKey, loadedResourceId] of this.loadedAudioResources.entries()) {
      if (loadedResourceId === resourceId) {
        // Extract filename from the fileKey (which is like "Resources/Music/filename.mod")
        filename = fileKey.split('/').pop();
        break;
      }
    }
    
    // Notify the tab manager to update any open viewers for this resource
    if (this.tabManager) {
      this.tabManager.notifyResourceUpdated(resourceId, property, value, filename);
    }
  }

  notifyResourceUpdated(resourceId, property, value) {
    // Legacy method - now just delegates to the event system
    console.log(`[GameEditor] Legacy notification: ${resourceId} ${property} = ${value}`);
    this.onResourceUpdated({ detail: { resourceId, property, value } });
  }
}

// Initialize when page loads
window.addEventListener('DOMContentLoaded', async () => {
  window.gameEditor = new GameEditor();
});
