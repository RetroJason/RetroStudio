// game-editor.js
// Main game engine editor that integrates audio engine and project explorer

class GameEditor {
  constructor() {
    this.audioEngine = null;
    this.resourceManager = null;
    this.projectExplorer = null;
    this.buildSystem = null;
    this.loadedAudioResources = new Map(); // Maps file paths to resource IDs
  this._inflightLoads = new Map(); // filename -> Promise

    this.initialize();
  }
  
  async initialize() {
    console.log('=== Game Engine Editor ===');
    
    // Prefer singletons from the service container to avoid duplicate instances
    const services = window.serviceContainer;

    // Initialize or obtain AudioEngine
    if (services) {
      try {
        this.audioEngine = services.get('audioEngine');
      } catch (_) { /* not registered yet */ }
    }
    if (!this.audioEngine) {
      this.audioEngine = new AudioEngine();
      const audioSuccess = await this.audioEngine.initialize();
      if (!audioSuccess) {
        console.error('[GameEditor] Failed to initialize audio engine');
        return false;
      }
      services?.register?.('audioEngine', this.audioEngine);
    }

    // Initialize or obtain ResourceManager
    if (services) {
      try {
        this.resourceManager = services.get('resourceManager');
      } catch (_) { /* not registered yet */ }
    }
    if (!this.resourceManager) {
      this.resourceManager = new ResourceManager(this.audioEngine);
      services?.register?.('resourceManager', this.resourceManager);
    }

    // Initialize or obtain BuildSystem
    if (services) {
      try {
        this.buildSystem = services.get('buildSystem');
        if (this.buildSystem) {
          window.buildSystem = this.buildSystem; // Make available globally for builders
        }
      } catch (e) {
        console.log('[GameEditor] BuildSystem service not yet available');
        this.buildSystem = null;
      }
    } else {
      console.log('[GameEditor] Service container not available, BuildSystem will be initialized later');
      this.buildSystem = null;
    }
    
    // Listen for audio engine events
    this.audioEngine.addEventListener('resourceLoaded', this.onResourceLoaded.bind(this));
    this.audioEngine.addEventListener('resourceUpdated', this.onResourceUpdated.bind(this));
    
    // Initialize or obtain TabManager
    if (services) {
      try {
        this.tabManager = services.get('tabManager');
      } catch (_) { /* not registered yet */ }
    }
    if (!this.tabManager) {
      this.tabManager = new TabManager();
      services?.registerSingleton?.('tabManager', this.tabManager);
    }
    window.tabManager = this.tabManager; // Make available globally
    
    // Listen for tab changes to update save button state and project explorer
    this.tabManager.addEventListener('tabSwitched', (data) => {
      this.updateSaveButtonState();
      // Project explorer highlighting is handled automatically in TabManager
    });
    
    // Initialize or obtain ProjectExplorer
    if (services) {
      try {
        this.projectExplorer = services.get('projectExplorer');
      } catch (_) { /* not registered yet */ }
    }
    if (!this.projectExplorer) {
      this.projectExplorer = new ProjectExplorer();
      services?.register?.('projectExplorer', this.projectExplorer);
    }
    
    // Set up UI event handlers
    this.setupUI();
    
    // Add audio context resume handler
    this.addAudioContextResumeHandler();
    
    // Update initial UI state
    this.updateSaveButtonState();
    
    console.log('[GameEditor] Initialized successfully');
    return true;
  }
  
  // Initialize BuildSystem if it wasn't available during initial setup
  initializeBuildSystemIfNeeded() {
    if (!this.buildSystem) {
      const services = window.serviceContainer;
      if (services) {
        try {
          console.log('[GameEditor] Late-initializing BuildSystem from service container');
          this.buildSystem = services.get('buildSystem');
          if (this.buildSystem) {
            window.buildSystem = this.buildSystem;
            return true;
          }
        } catch (e) {
          console.log('[GameEditor] BuildSystem service not yet available');
        }
      }
    }
    return !!this.buildSystem;
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

  // Persistence is handled by ProjectExplorer.addFileToProject; avoid duplicate saves here
    }
    
    // Auto-open the file in a tab using unified logic
    if (this.tabManager) {
      try {
        console.log(`[GameEditor] Auto-opening file: ${file.name}`);
        // Ensure we pass full path including filename
        const fullPath = path.endsWith(file.name) ? path : `${path}/${file.name}`;
        await this.tabManager.openInTab(fullPath, null); // Let tab manager auto-detect component

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
      // Initialize BuildSystem if it wasn't available during startup
      if (!this.buildSystem) {
        if (!this.initializeBuildSystemIfNeeded()) {
          this.updateStatus('Build system not available', 'error');
          return;
        }
      }
      
      // Check for unsaved files before building
      if (this.tabManager) {
        const unsavedTabs = this.tabManager.getUnsavedTabs();
        if (unsavedTabs.length > 0) {
          // Automatically save all unsaved tabs before building
          await this.tabManager.saveAllOpenTabs();
          this.updateStatus('Saved all files, building project...', 'info');
        }
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
      
      // Expand the Build folder to show new build files (they are added as they are built)
      if (this.projectExplorer && buildResult && buildResult.success !== false) {
        setTimeout(() => {
          this.projectExplorer.expandBuildFolder();
        }, 100);
      }
      
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
    
  const project = this.projectExplorer?.getFocusedProjectName?.();
  const buildRoot = (window.ProjectPaths && window.ProjectPaths.getBuildRootUi) ? window.ProjectPaths.getBuildRootUi() : 'Build';
  const buildNode = project ? this.projectExplorer.projectData.structure[project]?.children?.[buildRoot] : this.projectExplorer?.projectData?.structure?.[buildRoot];
  if (!buildNode) {
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
  collectFiles(buildNode, `${project ? project + '/' : ''}${buildRoot}`);
    
    console.log(`[GameEditor] Found ${buildFiles.length} build files:`, buildFiles);
    return buildFiles;
  }
  
  findMainLuaScript() {
    // Look for main.lua in the Lua directory
  const project = this.projectExplorer?.getFocusedProjectName?.();
  const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
  const luaFolder = project ? this.projectExplorer.projectData.structure[project]?.children?.[sourcesRoot]?.children?.Lua?.children
                : this.projectExplorer.projectData.structure[sourcesRoot]?.Lua?.children;
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
  async loadAudioFileOnDemand(filename, forceReload = false) {
    console.log(`[GameEditor] Loading audio file on demand: ${filename}${forceReload ? ' (force reload)' : ''}`);
    
    // Check if already loaded, unless forcing reload
    if (!forceReload) {
      const existingId = this.getLoadedResourceId(filename);
      if (existingId) {
        console.log(`[GameEditor] File ${filename} already loaded with ID: ${existingId}`);
        return existingId;
      }
    } else {
      // Force reload: clear existing resource first
      const existingId = this.getLoadedResourceId(filename);
      if (existingId) {
        console.log(`[GameEditor] Force reload: clearing existing resource ${existingId} for ${filename}`);
        if (this.audioEngine) {
          this.audioEngine.unloadResource(existingId);
        }
      }
    }
    
    // Dedupe concurrent requests for the same filename
    if (!forceReload && this._inflightLoads.has(filename)) {
      console.log('[GameEditor] Returning in-flight load for', filename);
      return this._inflightLoads.get(filename);
    }

    const loadPromise = (async () => {
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
    
      // If not found in pending files, try to load from build files via storage
      console.log(`[GameEditor] File ${filename} not found in pending files, checking build files...`);
    
    try {
      // Prefer storage backend to enumerate possible build files
      const candidates = [];
      if (window.fileIOService && typeof window.fileIOService.listFiles === 'function') {
        const buildRecords = await window.fileIOService.listFiles('build');
        for (const rec of buildRecords) {
          const recPath = rec.path || rec;
          if ((recPath || '').endsWith(filename)) {
            candidates.push(recPath);
          }
        }
      }

      // Sort to prioritize clean paths
      candidates.sort((a, b) => {
        const aBad = a.includes('.sfx/') || a.includes('/Resources/');
        const bBad = b.includes('.sfx/') || b.includes('/Resources/');
        if (aBad && !bBad) return 1;
        if (!aBad && bBad) return -1;
        return a.length - b.length; // prefer shorter paths
      });

        for (const path of candidates) {
        try {
            const rec = window.fileIOService ? await window.fileIOService.loadFile(path) : null;
          if (!rec) continue;
          const buf = rec.content instanceof ArrayBuffer ? rec.content : (rec.binaryData && rec.fileContent ? (() => { const bin = atob(rec.fileContent); const bytes = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i); return bytes.buffer; })() : new TextEncoder().encode(String(rec.fileContent || rec.content || '')).buffer);
          const file = new File([buf], filename, { type: 'audio/wav' });
          const resourceId = await this.resourceManager.loadFromFile(file, 'wav');
          this.loadedAudioResources.set(path, resourceId);
          this.updateStatus(`Loaded ${filename}`, 'success');
          return resourceId;
        } catch (innerErr) {
          console.warn('[GameEditor] Candidate load failed, trying next:', path, innerErr);
        }
      }
    } catch (error) {
      console.error(`[GameEditor] Error loading build file ${filename}:`, error);
    }
    
    // If still not found, try to load directly from stored Resources by filename
    console.log(`[GameEditor] ${filename} not found in build files, checking Resources in storage...`);
  try {
      const resourceCandidates = [];
      if (window.fileIOService && typeof window.fileIOService.listFiles === 'function') {
    const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
    const resRecords = await window.fileIOService.listFiles(sourcesRoot);
        for (const rec of resRecords) {
          const recPath = rec.path || rec;
          if ((recPath || '').endsWith(filename)) {
            resourceCandidates.push(recPath);
          }
        }
      }

      // Sort to prioritize shortest paths
      resourceCandidates.sort((a, b) => a.length - b.length);

      if (resourceCandidates.length) {
        // Determine audio type by extension
        const lower = filename.toLowerCase();
        const isMod = ['.mod', '.xm', '.s3m', '.it', '.mptm'].some(ext => lower.endsWith(ext));
        const audioType = isMod ? 'mod' : (lower.endsWith('.wav') ? 'wav' : null);
        if (!audioType) {
          throw new Error('Unsupported audio type for on-demand load');
        }

          for (const key of resourceCandidates) {
          try {
              const path = key;
              const rec = await window.fileIOService.loadFile(path);
            if (!rec) continue;
            let buf;
            if (rec.content instanceof ArrayBuffer) {
              buf = rec.content;
            } else if (rec.binaryData && rec.fileContent) {
              const binaryString = atob(rec.fileContent);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
              buf = bytes.buffer;
            } else if (typeof rec.fileContent === 'string') {
              buf = new TextEncoder().encode(rec.fileContent).buffer;
            } else {
              continue;
            }
            const file = new File([buf], filename, { type: isMod ? 'application/octet-stream' : 'audio/wav' });
            const resourceId = await this.resourceManager.loadFromFile(file, audioType);
            this.loadedAudioResources.set(path, resourceId);
            this.updateStatus(`Loaded ${filename}`, 'success');
            return resourceId;
          } catch (resErr) {
            console.warn('[GameEditor] Failed to load resource candidate:', key, resErr);
          }
        }
      }
    } catch (error) {
      console.error('[GameEditor] Error during Resources storage lookup:', error);
    }

    // If we get here, the file wasn't found anywhere
    throw new Error(`File ${filename} not found in project or build files`);
    })();

    // Track in-flight and clean up when done
    this._inflightLoads.set(filename, loadPromise);
    try {
      const id = await loadPromise;
      return id;
    } finally {
      // Remove only if this exact promise is still the one stored
      if (this._inflightLoads.get(filename) === loadPromise) {
        this._inflightLoads.delete(filename);
      }
    }
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
    if (this.tabManager && typeof this.tabManager.notifyResourceUpdated === 'function') {
      this.tabManager.notifyResourceUpdated(resourceId, property, value, filename);
    } else {
      console.warn('[GameEditor] TabManager.notifyResourceUpdated is not available');
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
  if (!window.gameEditor) {
    window.gameEditor = new GameEditor();
    
    // Emit ready event after gameEditor is fully initialized
    document.dispatchEvent(new CustomEvent('gameEditorReady'));
    console.log('[GameEditor] Ready event emitted');
  } else {
    console.log('[GameEditor] Instance already exists, skipping initialization');
  }
});
