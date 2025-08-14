// project-explorer.js
// Project Explorer with tree view, drag & drop, and file filtering

class ProjectExplorer {
  constructor() {
    this.projectData = {
      name: "Game Project",
      structure: {
        "Resources": {
          type: "folder",
          children: {
            "Music": {
              type: "folder", 
              filter: [".mod", ".xm", ".s3m", ".it", ".mptm"],
              children: {}
            },
            "SFX": {
              type: "folder",
              filter: [".wav", ".sfx"],
              children: {}
            },
            "Palettes": {
              type: "folder",
              filter: [".pal", ".act", ".aco"],
              children: {}
            },
            "Lua": {
              type: "folder",
              filter: [".lua"],
              children: {}
            },
            "Binary": {
              type: "folder",
              filter: ["*"], // Accepts any file type
              children: {}
            }
          }
        },
        "Build": {
          type: "folder",
          children: {}
        }
      }
    };
    
    this.selectedNode = null;
    this.treeContainer = null;
    this.contextMenu = null;
    this.fileUpload = null;
    this.pendingTreeOperations = [];
    
    this.initialize();
  }
  
  initialize() {
    this.treeContainer = document.getElementById('projectTree');
    this.contextMenu = document.getElementById('contextMenu');
    this.fileUpload = document.getElementById('fileUpload');
    
    if (!this.treeContainer) {
      console.error('[ProjectExplorer] Tree container not found');
      return;
    }
    
    this.setupEventListeners();
    this.renderTree();
    
    console.log('[ProjectExplorer] Initialized');
  }
  
  setupEventListeners() {
    // Listen to tab manager events for file highlighting (with deferred setup)
    this.setupTabManagerEventListener();
    
    // Global click to hide context menu
    document.addEventListener('click', (e) => {
      if (!this.contextMenu.contains(e.target)) {
        this.hideContextMenu();
      }
    });
    
    // Context menu actions
    this.contextMenu.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action) {
        this.handleContextAction(action);
        this.hideContextMenu();
      }
    });
    
    // File upload change
    this.fileUpload.addEventListener('change', (e) => {
      this.handleFileUpload(e.target.files);
      e.target.value = ''; // Reset input
    });
    
    // Global drag and drop (robust overlay handling)
    this._dragDepth = 0;
    const clearDragOverlay = () => {
      this._dragDepth = 0;
      document.body.classList.remove('drag-over');
    };

    document.addEventListener('dragenter', (e) => {
      // Increment depth and show overlay
      this._dragDepth++;
      document.body.classList.add('drag-over');
    });

    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      document.body.classList.add('drag-over');
    });
    
    document.addEventListener('dragleave', (e) => {
      // Decrement depth; when it reaches 0, we're outside
      this._dragDepth = Math.max(0, (this._dragDepth || 0) - 1);
      if (this._dragDepth === 0) {
        document.body.classList.remove('drag-over');
      }
    });
    
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      // Remove visual feedback and reset depth
      clearDragOverlay();
      // Handle file drops anywhere on the page
      this.handleFileDrop(e);
    });

    // Safety nets to ensure overlay is cleared
    window.addEventListener('dragend', clearDragOverlay);
    window.addEventListener('blur', clearDragOverlay);
    document.addEventListener('mouseleave', clearDragOverlay);
  }
  
  setupTabManagerEventListener() {
    // Try to set up the event listener, with retry if TabManager isn't ready
    const trySetup = () => {
      if (window.gameEditor && window.gameEditor.tabManager) {
        console.log('[ProjectExplorer] Setting up TabManager event listener');
        window.gameEditor.tabManager.addEventListener('tabSwitched', (data) => {
          console.log('[ProjectExplorer] TabManager tabSwitched event received:', data);
          const tabInfo = data.tabInfo;
          if (tabInfo && tabInfo.fullPath) {
            console.log('[ProjectExplorer] Highlighting file:', tabInfo.fullPath);
            this.highlightActiveFile(tabInfo.fullPath);
          }
        });
      } else {
        // TabManager not ready yet, try again in 100ms
        console.log('[ProjectExplorer] TabManager not ready, retrying in 100ms');
        setTimeout(trySetup, 100);
      }
    };
    
    trySetup();
  }
  
  renderTree() {
    this.treeContainer.innerHTML = '';
    const rootList = document.createElement('ul');
    rootList.className = 'tree-node';
    
    this.renderNode(this.projectData.structure, rootList, '');
    this.treeContainer.appendChild(rootList);
  }
  
  renderNode(nodeData, container, path) {
    for (const [name, data] of Object.entries(nodeData)) {
      const currentPath = path ? `${path}/${name}` : name;
      const li = document.createElement('li');
      li.className = 'tree-node';
      
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.dataset.path = currentPath;
      item.dataset.type = data.type;
      
      // Expand button
      const expand = document.createElement('span');
      expand.className = 'tree-expand';
      if (data.type === 'folder' && Object.keys(data.children || {}).length > 0) {
        expand.textContent = '▶';
        expand.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleNode(li, expand);
        });
      } else {
        expand.className += ' empty';
      }
      
      // Icon
      const icon = document.createElement('span');
      icon.className = `tree-icon file-icon ${this.getFileIcon(name, data.type)}`;
      icon.textContent = this.getFileIconSymbol(name, data.type, currentPath);
      
      // Label
      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = name;
      
      item.appendChild(expand);
      item.appendChild(icon);
      item.appendChild(label);
      
      // Event listeners with double-click protection
      let clickTimeout = null;
      
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Don't auto-select here - let tab manager control highlighting via highlightActiveFile
        
        // Delay single-click action to check for double-click
        clearTimeout(clickTimeout);
        clickTimeout = setTimeout(() => {
          // Show in preview if it's a file (only if not double-clicked)
          if (data.type === 'file' && window.tabManager) {
            const isReadOnly = data.isReadOnly || data.isBuildFile;
            // For files, currentPath already includes the full path, don't append filename again
            let fullPath = currentPath;
            
            // Convert Build/ paths to build/ for storage access
            if (fullPath.startsWith('Build/')) {
              fullPath = fullPath.replace(/^Build\//, 'build/');
            }
            
            console.log(`[ProjectExplorer] Single-clicking file: currentPath="${currentPath}", fullPath="${fullPath}"`);
            window.tabManager.openInPreview(fullPath, data.file, { isReadOnly });
          }
        }, 200); // 200ms delay to detect double-click
      });

      item.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        
        // Cancel the single-click timeout
        clearTimeout(clickTimeout);
        
        // Open in new tab if it's a file
        if (data.type === 'file' && window.tabManager) {
          const isReadOnly = data.isReadOnly || data.isBuildFile;
          // For files, currentPath already includes the full path, don't append filename again
          let fullPath = currentPath;
          
          // Convert Build/ paths to build/ for storage access
          if (fullPath.startsWith('Build/')) {
            fullPath = fullPath.replace(/^Build\//, 'build/');
          }
          
          console.log(`[ProjectExplorer] Double-clicking file: currentPath="${currentPath}", fullPath="${fullPath}"`);
          // TabManager now loads from storage, no need to pass file object
          window.tabManager.openInTab(fullPath, null, { isReadOnly });
        } else if (data.type === 'folder') {
          // Toggle folder on double-click
          this.toggleNode(li, expand);
        }
      });      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.selectNode(item);
        this.showContextMenu(e.clientX, e.clientY);
      });
      
      // Drag and drop for folders
      if (data.type === 'folder') {
        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          item.classList.add('drag-over');
        });
        
        item.addEventListener('dragleave', (e) => {
          if (!item.contains(e.relatedTarget)) {
            item.classList.remove('drag-over');
          }
        });
        
        item.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          item.classList.remove('drag-over');
          this.handleFileDrop(e, currentPath);
        });
      }
      
      li.appendChild(item);
      
      // Children container
      if (data.type === 'folder' && data.children) {
        const childrenUl = document.createElement('ul');
        childrenUl.className = 'tree-children';
        this.renderNode(data.children, childrenUl, currentPath);
        li.appendChild(childrenUl);
      }
      
      container.appendChild(li);
    }
  }
  
  getFileIcon(name, type) {
    if (type === 'folder') return 'folder';
    
    const ext = this.getFileExtension(name).toLowerCase();
    if (['.mod', '.xm', '.s3m', '.it', '.mptm'].includes(ext)) return 'mod';
    if (['.wav'].includes(ext)) return 'wav';
    
    return 'file';
  }
  
  getFileIconSymbol(name, type, currentPath = '') {
    if (type === 'folder') {
      // Different icons for different folder types
      if (name === 'Resources') return '📁'; // Standard blue folder for editable resources
      if (name === 'Build') return '📦'; // Package box for build outputs
      if (currentPath.startsWith('Build/')) return '🗂️'; // File folder for build subfolders
      if (currentPath.startsWith('Resources/')) {
        // Special icons for resource type folders
        if (name === 'Music') return '🎼';
        if (name === 'SFX') return '🔊';
        if (name === 'Lua') return '📜';
        if (name === 'Binary') return '🗃️';
        return '📂'; // Open folder for resource subfolders
      }
      return '📁'; // Default folder
    }
    
    const ext = this.getFileExtension(name).toLowerCase();
    if (['.mod', '.xm', '.s3m', '.it', '.mptm'].includes(ext)) return '🎵';
    if (['.wav'].includes(ext)) return '🔊';
    if (['.lua'].includes(ext)) return '📜';
    
    return '📄';
  }
  
  getFileExtension(filename) {
    return filename.substring(filename.lastIndexOf('.'));
  }
  
  toggleNode(li, expandButton) {
    const children = li.querySelector('.tree-children');
    if (!children) return;
    
    const isExpanded = children.classList.contains('expanded');
    
    if (isExpanded) {
      children.classList.remove('expanded');
      expandButton.textContent = '▶';
      expandButton.classList.remove('expanded');
    } else {
      children.classList.add('expanded');
      expandButton.textContent = '▼';
      expandButton.classList.add('expanded');
    }
  }
  
  // Method to expand the Build folder after successful builds
  expandBuildFolder() {
    try {
      console.log('[ProjectExplorer] Attempting to expand Build folder...');
      
      // Find the Build folder node
      const buildNodes = this.treeContainer.querySelectorAll('.tree-item');
      console.log(`[ProjectExplorer] Found ${buildNodes.length} tree items to check`);
      
      for (const node of buildNodes) {
        const textElement = node.querySelector('.tree-text');
        if (textElement) {
          const textContent = textElement.textContent.trim();
          console.log(`[ProjectExplorer] Checking node text: "${textContent}"`);
          
          if (textContent === 'Build') {
            console.log('[ProjectExplorer] Found Build folder node');
            const expandButton = node.querySelector('.tree-expand');
            const children = node.querySelector('.tree-children');
            
            console.log('[ProjectExplorer] Build folder elements:', {
              expandButton: !!expandButton,
              children: !!children,
              isExpanded: children?.classList.contains('expanded')
            });
            
            // Expand if not already expanded
            if (expandButton && children && !children.classList.contains('expanded')) {
              children.classList.add('expanded');
              expandButton.textContent = '▼';
              expandButton.classList.add('expanded');
              console.log('[ProjectExplorer] Expanded Build folder after build');
            } else {
              console.log('[ProjectExplorer] Build folder already expanded or missing elements');
            }
            break;
          }
        }
      }
    } catch (error) {
      console.error('[ProjectExplorer] Error expanding Build folder:', error);
    }
  }
  
  selectNode(item) {
    // Remove previous selection
    if (this.selectedNode) {
      this.selectedNode.classList.remove('selected');
    }
    
    // Select new node
    this.selectedNode = item;
    item.classList.add('selected');
    
    console.log('[ProjectExplorer] Selected:', item.dataset.path);
  }
  
  showContextMenu(x, y) {
    if (!this.selectedNode) return;
    
    const path = this.selectedNode.dataset.path;
    const type = this.selectedNode.dataset.type;
    
    // Show/hide menu items based on selection
    const uploadItem = this.contextMenu.querySelector('[data-action="upload"]');
    const newFolderItem = this.contextMenu.querySelector('[data-action="newfolder"]');
    const renameItem = this.contextMenu.querySelector('[data-action="rename"]');
    const deleteItem = this.contextMenu.querySelector('[data-action="delete"]');
    
    // Upload and New Folder only available for folders
    uploadItem.style.display = type === 'folder' ? 'block' : 'none';
    newFolderItem.style.display = type === 'folder' ? 'block' : 'none';
    
    // Rename and Delete available for files and non-root folders, but not for build files/folders
    const isRootFolder = path === 'Resources' || path === 'Build';
    const isBuildFile = path.startsWith('Build/');
    const canModify = !isRootFolder && !isBuildFile;
    
    if (type === 'file') {
      renameItem.style.display = canModify ? 'block' : 'none';
      deleteItem.style.display = canModify ? 'block' : 'none';
    } else if (type === 'folder') {
      renameItem.style.display = canModify ? 'block' : 'none';
      deleteItem.style.display = canModify ? 'block' : 'none';
    }
    
    // Check if any menu items are visible before showing the context menu
    const visibleItems = [uploadItem, newFolderItem, renameItem, deleteItem].filter(item => 
      item && item.style.display !== 'none'
    );
    
    // Only show context menu if there are visible items
    if (visibleItems.length > 0) {
      this.contextMenu.style.display = 'block';
      this.contextMenu.style.left = `${x}px`;
      this.contextMenu.style.top = `${y}px`;
    } else {
      console.log('[ProjectExplorer] No context menu items available for this selection');
    }
  }
  
  hideContextMenu() {
    this.contextMenu.style.display = 'none';
  }

  // Ensure custom modal utils are available (dynamic load fallback)
  async _ensureModalUtils() {
    if (window.ModalUtils && typeof window.ModalUtils.showConfirm === 'function') return true;
    if (this._modalUtilsLoading) return this._modalUtilsLoading;
    this._modalUtilsLoading = new Promise((resolve) => {
      const script = document.createElement('script');
      const cacheBust = Date.now();
      script.src = `scripts/utils/modal-utils.js?v=${cacheBust}`;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
    return this._modalUtilsLoading;
  }

  async _confirm(title, message, options = {}) {
    const ok = await this._ensureModalUtils();
    if (ok && window.ModalUtils) {
      return window.ModalUtils.showConfirm(title, message, options);
    }
    // If modal utils cannot be loaded, default to cancelling destructive actions
    console.warn('[ProjectExplorer] ModalUtils unavailable; cancelling action');
    return false;
  }
  
  handleContextAction(action) {
    if (!this.selectedNode) return;
    
    const path = this.selectedNode.dataset.path;
    const type = this.selectedNode.dataset.type;
    
    switch (action) {
      case 'upload':
        if (type === 'folder') {
          this.currentUploadPath = path;
          this.fileUpload.click();
        }
        break;
      case 'newfolder':
        if (type === 'folder') {
          this.createNewFolder(path);
        }
        break;
      case 'rename':
        this.renameNode(path, type);
        break;
      case 'delete':
  this.deleteNode(path);
        break;
    }
  }
  
  handleFileUpload(files) {
    const targetPath = this.currentUploadPath || this.getDefaultPath();
    this.addFiles(files, targetPath);
  }
  
  handleFileDrop(event, targetPath = null) {
    const files = event.dataTransfer.files;
    const path = targetPath || this.getDropTargetPath(event.target);
    
    if (files.length > 0) {
      this.addFiles(files, path);
    }
  }
  
  async addFiles(files, targetPath) {
    const fileList = Array.from(files || []);
    const multiDrop = fileList.length > 1;
    let lastAddedFile = null;
    let lastAddedPath = null;
    const persistPromises = [];

    for (const file of fileList) {
      const filtered = this.filterFile(file, targetPath);
      const destPath = filtered.allowed ? filtered.path : (filtered.path || null);
      if (!destPath) {
        console.warn(`[ProjectExplorer] File ${file.name} not allowed in ${targetPath} and no redirect path`);
        continue;
      }

      // During multi-drop, skip auto-open and skip per-file re-render to avoid thrash
      const skipAutoOpen = multiDrop;
      const skipRender = true;
      persistPromises.push(this.addFileToProject(file, destPath, skipAutoOpen, skipRender));
      lastAddedFile = file;
      lastAddedPath = destPath;
    }

    // Wait for all content to be persisted before continuing (prevents partial builds)
    if (persistPromises.length) {
      try {
        await Promise.allSettled(persistPromises);
      } catch (_) { /* ignore */ }
    }

    // Render once after batch
    this.renderTree();

    // Highlight and optionally auto-open the last file only (prevents duplicate opens)
    if (lastAddedFile && lastAddedPath) {
      setTimeout(async () => {
        this.expandToPath(lastAddedPath);
        console.log(`[ProjectExplorer] Expanded to show last added file: ${lastAddedFile.name}`);
        if (multiDrop && window.gameEditor && typeof window.gameEditor.onFileAdded === 'function') {
          try {
            await window.gameEditor.onFileAdded(lastAddedFile, lastAddedPath, true);
          } catch (e) {
            console.warn('[ProjectExplorer] Auto-open of last file failed:', e);
          }
        }
      }, 50);
    }
  }
  
  filterFile(file, targetPath) {
  const ext = this.getFileExtension(file.name).toLowerCase();
  const musicExts = ['.mod', '.xm', '.s3m', '.it', '.mptm'];
  const sfxExts = ['.wav'];
    
    // Get the target folder data
    const folderData = this.getNodeByPath(targetPath);
    
    // If dropping on a filtered folder, check if file matches
    if (folderData && folderData.filter) {
      const allowed = folderData.filter.includes(ext);
      return { allowed, path: targetPath };
    }
    
    // Auto-filter to appropriate folder
    if (musicExts.includes(ext)) {
      return { allowed: true, path: 'Resources/Music' };
    } else if (sfxExts.includes(ext)) {
      return { allowed: true, path: 'Resources/SFX' };
    } else if (['.pal', '.act', '.aco'].includes(ext)) {
      return { allowed: true, path: 'Resources/Palettes' };
    }
    
    // Default unrecognized files to Binary folder
    return { allowed: true, path: 'Resources/Binary' };
  }
  
  addFileToProject(file, path, skipAutoOpen = false, skipRender = false) {
    // Return a promise that resolves after persistence (if any)
    let persistResolve;
    const persistDone = new Promise((resolve) => { persistResolve = resolve; });
    const parts = path.split('/');
    let current = this.projectData.structure;
    
    // Navigate to the target folder
    for (const part of parts) {
      if (current[part] && current[part].type === 'folder') {
        current = current[part].children;
      }
    }
    
  // Handle both File objects and file metadata objects
    let fileName, fileSize, lastModified;
    if (file instanceof File) {
      fileName = file.name;
      fileSize = file.size;
      lastModified = file.lastModified;
    } else {
      // File metadata object
      fileName = file.name;
      fileSize = 0; // Will be updated when content is loaded
      lastModified = Date.now();
    }
    
    // Add the file reference (not the content - content is in storage)
  const ext = this.getFileExtension(fileName).toLowerCase();
  const builderId = ext === '.sfx' ? 'sfx' : (['.pal', '.act', '.aco'].includes(ext) ? 'pal' : undefined);

    current[fileName] = {
      type: 'file',
      path: file.path || `${path}/${fileName}`,
      size: fileSize,
      lastModified: lastModified,
      isNewFile: file.isNewFile || false,
      builderId
    };
    
    console.log(`[ProjectExplorer] Added file reference: ${fileName} to ${path}`);

    // Persist content to storage for storage-first workflows
    const fullPath = file.path || `${path}/${fileName}`;
  if (file instanceof File) {
      try {
    // Palette-like formats are text for our editors; keep as text
    const isBinary = ['.wav', '.mod', '.xm', '.s3m', '.it', '.mptm'].includes(ext);
    const readPromise = isBinary ? file.arrayBuffer() : file.text();
        readPromise.then(async (content) => {
          if (window.fileIOService) {
            await window.fileIOService.saveFile(fullPath, content, {
        binaryData: isBinary,
              builderId
            });
            console.log(`[ProjectExplorer] Persisted dropped file to storage: ${fullPath}`);
          }
        }).catch(err => console.warn('[ProjectExplorer] Failed reading dropped file:', err)).finally(() => {
          // Resolve persist promise regardless of success (so caller can proceed)
          persistResolve();
        });
      } catch (e) {
        console.warn('[ProjectExplorer] Error persisting dropped file:', e);
        persistResolve();
      }
    } else {
      // No persistence to perform
      persistResolve();
    }
    
    // Refresh the tree to show the new file (unless we're batching)
    if (!skipRender) {
      this.renderTree();
    }
    
    // Notify game editor if available (unless skipping auto-open)
    if (window.gameEditor && !skipAutoOpen) {
      window.gameEditor.onFileAdded(file, path, false);
    }

    return persistDone;
  }
  
  async clearBuildFolder() {
    console.log('[ProjectExplorer] Clearing build folder...');
    
    // Clean up old build files from storage first
    await this.cleanupBuildFilesFromStorage();
    
    // Clear existing build folder contents
    this.projectData.structure.Build.children = {};
    
    // Update the UI
    this.renderTree();
  }

  async cleanupBuildFilesFromStorage() {
    console.log('[ProjectExplorer] Cleaning up old build files from storage...');
    
    const fm = window.serviceContainer?.get?.('fileManager') || window.fileManager;
    if (!fm) {
      console.warn('[ProjectExplorer] FileManager not available yet, skipping cleanup');
      return;
    }
    
    try {
      // Get all build file paths from the current build structure
      const buildFilePaths = this.getAllBuildFilePaths();
      
      console.log(`[ProjectExplorer] Found ${buildFilePaths.length} build files to clean up`);
      
      let deletedCount = 0;
    for (const filePath of buildFilePaths) {
        try {
      const success = await fm.deleteFile(filePath);
          if (success) {
            deletedCount++;
            console.log(`[ProjectExplorer] Deleted build file: ${filePath}`);
          }
        } catch (error) {
          console.warn(`[ProjectExplorer] Failed to delete build file ${filePath}:`, error);
        }
      }
      
      console.log(`[ProjectExplorer] Cleaned up ${deletedCount} build files via FileManager`);
    } catch (error) {
  console.error('[ProjectExplorer] Error cleaning up build files:', error);
    }
  }

  getAllBuildFilePaths() {
    const buildFilePaths = [];
    
    const traverseNode = (node, currentPath = '') => {
      if (node && typeof node === 'object') {
        if (node.type === 'file') {
          buildFilePaths.push(currentPath);
        } else if (node.children) {
          for (const [name, child] of Object.entries(node.children)) {
            const childPath = currentPath ? `${currentPath}/${name}` : name;
            traverseNode(child, childPath);
          }
        }
      }
    };
    
    if (this.projectData?.structure?.Build?.children) {
      for (const [name, child] of Object.entries(this.projectData.structure.Build.children)) {
        traverseNode(child, `build/${name}`);
      }
    }
    
    return buildFilePaths;
  }

  async refreshBuildFolder() {
    console.log('[ProjectExplorer] Refreshing build folder...');
    
    // Clear existing build folder contents
    this.projectData.structure.Build.children = {};
    
  // Load all build files from storage
    try {
      const buildFiles = await this.loadBuildFilesFromStorage();
      console.log('[ProjectExplorer] Found build files:', Object.keys(buildFiles));
      
      // Clean up any duplicate or invalid entries
      const cleanedBuildFiles = {};
      for (const [filePath, fileData] of Object.entries(buildFiles)) {
        // Skip invalid paths (like paths with double extensions)
        if (filePath.includes('.sfx/') || filePath.includes('..')) {
          console.log(`[ProjectExplorer] Skipping invalid build file path: ${filePath}`);
          continue;
        }
        
        // Skip if we already have a file with the same final path
        const finalPath = filePath.startsWith('build/') ? filePath.substring(6) : filePath;
        const fileName = finalPath.split('/').pop();
        const existing = Object.values(cleanedBuildFiles).find(f => f.name === fileName && f.path.endsWith(finalPath));
        
        if (!existing) {
          cleanedBuildFiles[filePath] = fileData;
        } else {
          console.log(`[ProjectExplorer] Skipping duplicate build file: ${filePath}`);
        }
      }
      
      // Add each cleaned build file to the project structure
      for (const [filePath, fileData] of Object.entries(cleanedBuildFiles)) {
        if (filePath.startsWith('build/')) {
          // Remove 'build/' prefix and add to Build folder
          let relativePath = filePath.substring(6); // Remove 'build/' prefix
          
          // Also remove 'Resources/' prefix if it exists (legacy paths)
          if (relativePath.startsWith('Resources/')) {
            relativePath = relativePath.substring(10); // Remove 'Resources/' prefix
          }
          
          console.log(`[ProjectExplorer] Adding build file: ${relativePath}`);
          this.addBuildFileToStructure(relativePath, fileData);
        }
      }
      
      console.log('[ProjectExplorer] Build folder structure:', this.projectData.structure.Build);
      
      // Refresh the tree display
      this.renderTree();
      
      console.log('[ProjectExplorer] Build folder refreshed');
    } catch (error) {
      console.error('[ProjectExplorer] Failed to refresh build folder:', error);
    }
  }
  
  async loadBuildFilesFromStorage() {
    const buildFiles = {};
    console.log('[ProjectExplorer] Listing build files from storage service...');

    const fm = window.serviceContainer?.get?.('fileManager') || window.fileManager;
    if (!fm) {
      console.warn('[ProjectExplorer] FileManager not available, returning empty list');
      return buildFiles;
    }

    try {
      const records = await fm.listFiles('build');
      for (const rec of records) {
        const path = rec.path || rec; // support both record and string paths
        if (typeof path !== 'string' || !path.startsWith('build/')) continue;
        try {
          // Load to get content size and ensure it exists
          const obj = await fm.loadFile(path);
          if (!obj) continue;

          // Normalize to ArrayBuffer for binary files, or UTF-8 for text
          let contentBuf = null;
          if (obj.content instanceof ArrayBuffer) {
            contentBuf = obj.content;
          } else if (obj.binaryData && typeof obj.fileContent === 'string') {
            // Base64 decode; guard against malformed base64
            try {
              const bin = atob(obj.fileContent);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              contentBuf = bytes.buffer;
            } catch (e) {
              console.warn('[ProjectExplorer] Skipping malformed base64 build item:', path, e);
              continue;
            }
          } else if (typeof obj.fileContent === 'string') {
            contentBuf = new TextEncoder().encode(obj.fileContent).buffer;
          } else if (obj.content) {
            // Last resort: try to coerce other content types
            try {
              const blob = new Blob([obj.content]);
              contentBuf = await blob.arrayBuffer();
            } catch (e) {
              console.warn('[ProjectExplorer] Unable to normalize content for', path, e);
              continue;
            }
          } else {
            continue; // Nothing to add
          }

          buildFiles[path] = {
            content: contentBuf,
            name: path.split('/').pop(),
            path
          };
        } catch (perItemErr) {
          console.warn('[ProjectExplorer] Skipping build record due to error:', path, perItemErr);
          continue;
        }
      }
    } catch (err) {
      console.error('[ProjectExplorer] Error listing build files from storage:', err);
    }

    console.log('[ProjectExplorer] Total build files found:', Object.keys(buildFiles).length);
    return buildFiles;
  }
  
  async clearBuildFiles() {
    console.log('[ProjectExplorer] Clearing build files from storage...');
    const fm = window.serviceContainer?.get?.('fileManager') || window.fileManager;
    if (!fm) {
      console.warn('[ProjectExplorer] FileManager not available, cannot clear build files');
      return;
    }

    try {
      const records = await fm.listFiles('build');
      let removed = 0;
      for (const rec of records) {
        const path = rec.path || rec;
        if (typeof path === 'string' && path.startsWith('build/')) {
          const ok = await fm.deleteFile(path);
          if (ok) removed++;
        }
      }
      console.log(`[ProjectExplorer] Cleared ${removed} build files`);
    } catch (err) {
      console.error('[ProjectExplorer] Error clearing build files:', err);
    }

    // Clear the build folder structure and refresh
    this.projectData.structure.Build.children = {};
    this.renderTree();
  }
  
  addBuildFileToStructure(relativePath, fileData) {
    console.log(`[ProjectExplorer] addBuildFileToStructure called with: ${relativePath}`, fileData);
    
    const parts = relativePath.split('/');
    const fileName = parts.pop();
    console.log(`[ProjectExplorer] Path parts:`, parts, `FileName: ${fileName}`);
    
    // Navigate to or create the folder structure
    let current = this.projectData.structure.Build.children;
    console.log(`[ProjectExplorer] Starting from Build.children:`, current);
    
    for (const part of parts) {
      if (!current[part]) {
        console.log(`[ProjectExplorer] Creating folder: ${part}`);
        current[part] = {
          type: 'folder',
          children: {}
        };
      }
      current = current[part].children;
      console.log(`[ProjectExplorer] Navigated to:`, current);
    }
    
    // Add the file
    let size = 0;
    const content = fileData.content;
    if (content instanceof ArrayBuffer) size = content.byteLength;
    else if (ArrayBuffer.isView(content)) size = content.byteLength;
    else if (typeof content === 'string') size = content.length;
    else if (content && typeof content.size === 'number') size = content.size;

    current[fileName] = {
      type: 'file',
      name: fileName,
      file: new File([content], fileName),
      size,
      lastModified: Date.now(),
      isBuildFile: true,
      isReadOnly: true  // Mark build files as read-only
    };
    
    console.log(`[ProjectExplorer] Added file ${fileName} to structure. Current:`, current);
    
    // Update the UI to show the new build file
    this.renderTree();
  }
  
  getNodeByPath(path) {
    const parts = path.split('/');
    let current = this.projectData.structure;
    
    for (const part of parts) {
      if (current[part]) {
        if (current[part].type === 'folder') {
          current = current[part].children;
        } else {
          return current[part];
        }
      } else {
        return null;
      }
    }
    
    return current;
  }
  
  getDropTargetPath(element) {
    const treeItem = element.closest('.tree-item');
    if (treeItem) {
      const path = treeItem.dataset.path;
      const type = treeItem.dataset.type;
      
      if (type === 'folder') {
        return path;
      } else {
        // If dropping on a file, use its parent folder
        const parts = path.split('/');
        parts.pop();
        return parts.join('/') || 'Resources';
      }
    }
    
    return 'Resources';
  }
  
  getDefaultPath() {
    return 'Resources';
  }
  
  createNewFolder(parentPath) {
    const name = prompt('Enter folder name:');
    if (name && name.trim()) {
      const parts = parentPath.split('/');
      let current = this.projectData.structure;
      
      for (const part of parts) {
        if (current[part] && current[part].type === 'folder') {
          current = current[part].children;
        }
      }
      
      current[name.trim()] = {
        type: 'folder',
        children: {}
      };
      
      this.renderTree();
      console.log(`[ProjectExplorer] Created folder: ${name} in ${parentPath}`);
    }
  }
  
  async deleteNode(path) {
    const confirmed = await this._confirm(
      'Delete',
      `Are you sure you want to delete "${path}"?`,
      { okText: 'Delete', cancelText: 'Cancel', danger: true }
    );
    if (!confirmed) return;

    // Determine if path is file or folder from structure
    const node = this.getNodeByPath(path);
    const isFolder = node && node.type === 'folder';

    // Build storage deletion list
    const toDelete = [];
    const collectPaths = (basePath, nodeData) => {
      if (!nodeData) return;
      if (nodeData.type === 'file') {
        toDelete.push(basePath);
      } else if (nodeData.children) {
        for (const [name, child] of Object.entries(nodeData.children)) {
          collectPaths(`${basePath}/${name}`.replace(/\\/g, '/'), child);
        }
      }
    };

    if (isFolder) {
      collectPaths(path, node);
    } else {
      toDelete.push(path);
    }

    // Delete from storage (FileManager preferred)
    try {
      const fm = window.serviceContainer?.get?.('fileManager') || window.fileManager;
      if (fm) {
        for (const p of toDelete) {
          const storagePath = p.startsWith('Build/') ? p.replace(/^Build\//, 'build/') : p;
          try {
            await fm.deleteFile(storagePath);
            console.log('[ProjectExplorer] Deleted from storage:', storagePath);
          } catch (e) {
            console.warn('[ProjectExplorer] Failed to delete from storage:', storagePath, e);
          }
        }
      }
    } catch (e) {
      console.warn('[ProjectExplorer] FileManager unavailable for deletion');
    }

    // Remove from in-memory structure
    const parts = path.split('/');
    const name = parts.pop();
    let current = this.projectData.structure;
    for (const part of parts) {
      if (current[part] && current[part].type === 'folder') {
        current = current[part].children;
      }
    }
    delete current[name];

    // Re-render tree
    this.renderTree();
    console.log(`[ProjectExplorer] Deleted: ${path}`);

    // Emit deletion event for other systems (e.g., TabManager)
    try {
      if (window.eventBus && typeof window.eventBus.emit === 'function') {
        await window.eventBus.emit('file.deleted', { path, isFolder, deletedPaths: toDelete });
      }
    } catch (e) {
      console.warn('[ProjectExplorer] Failed to emit file.deleted:', e);
    }
  }
  
  async renameNode(path, type) {
    console.log(`[ProjectExplorer] Starting rename for: ${path} (${type})`);
    
    const parts = path.split('/');
    const currentName = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join('/');
    
    console.log(`[ProjectExplorer] Current name: ${currentName}, Parent path: ${parentPath}`);
    
    // Create input dialog for new name
    const newName = await this.showRenameDialog(currentName, type);
    if (!newName || newName === currentName) {
      console.log(`[ProjectExplorer] Rename cancelled or no change`);
      return; // User cancelled or no change
    }
    
    console.log(`[ProjectExplorer] New name: ${newName}`);
    
    // Validate the new name
    const validation = this.validateFileName(newName, type);
    if (!validation.valid) {
      console.log(`[ProjectExplorer] Validation failed: ${validation.message}`);
      alert(`Invalid name: ${validation.message}`);
      return;
    }
    
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;
    console.log(`[ProjectExplorer] New path will be: ${newPath}`);
    
    // Check if new name already exists
    if (this.getNodeByPath(newPath)) {
      console.log(`[ProjectExplorer] Path already exists: ${newPath}`);
      alert(`A ${type} with the name "${newName}" already exists.`);
      return;
    }
    
    try {
      // Get the node data before renaming
      console.log(`[ProjectExplorer] Looking for node at path: ${path}`);
      const nodeData = this.getNodeByPath(path);
      if (!nodeData) {
        console.error(`[ProjectExplorer] Node not found: ${path}`);
        console.log(`[ProjectExplorer] Project structure:`, JSON.stringify(this.projectData.structure, null, 2));
        return;
      }
      
      console.log(`[ProjectExplorer] Found node data:`, nodeData);
      
      // Handle file renaming (update storage) regardless of in-memory file presence
      if (type === 'file') {
        await this.renameFileInStorage(path, newPath, nodeData.file);
      }
      
      // Update the project structure
      this.updateNodePath(path, newPath, nodeData);
      
      // Re-render the tree
      this.renderTree();
      
      // Expand to show the renamed item
      this.expandToPath(newPath);
      
      // Update any open tabs with the renamed file
      if (type === 'file' && window.gameEditor && window.gameEditor.tabManager) {
        window.gameEditor.tabManager.updateFileReference(path, newPath, newName);
      }
      
      console.log(`[ProjectExplorer] Renamed: ${path} → ${newPath}`);
    } catch (error) {
      console.error(`[ProjectExplorer] Failed to rename ${path}:`, error);
      alert(`Failed to rename ${type}: ${error.message}`);
    }
  }
  
  async showRenameDialog(currentName, type) {
    return new Promise((resolve) => {
      // Create modal dialog
      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-dialog">
          <div class="modal-header">
            <h3 class="modal-title">Rename ${type === 'file' ? 'File' : 'Folder'}</h3>
          </div>
          <div class="modal-body">
            <div class="modal-field">
              <label class="modal-label">New name:</label>
              <input type="text" id="renameInput" class="modal-input" value="${currentName}" />
              <div id="validationMessage" class="modal-hint" style="color: #ff6b6b; margin-top: 4px; display: none;"></div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="modal-btn modal-btn-primary" id="renameConfirm">Rename</button>
            <button type="button" class="modal-btn modal-btn-secondary" id="renameCancel">Cancel</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      
      const input = modal.querySelector('#renameInput');
      const confirmBtn = modal.querySelector('#renameConfirm');
      const cancelBtn = modal.querySelector('#renameCancel');
      const validationMsg = modal.querySelector('#validationMessage');
      
      // Focus input and select filename without extension
      input.focus();
      if (type === 'file') {
        const lastDot = currentName.lastIndexOf('.');
        if (lastDot > 0) {
          input.setSelectionRange(0, lastDot);
        } else {
          input.select();
        }
      } else {
        input.select();
      }
      
      // Real-time validation
      const validateInput = () => {
        const name = input.value.trim();
        if (name === currentName) {
          validationMsg.style.display = 'none';
          confirmBtn.disabled = false;
          return;
        }
        
        const validation = this.validateFileName(name, type);
        if (!validation.valid) {
          validationMsg.textContent = validation.message;
          validationMsg.style.display = 'block';
          confirmBtn.disabled = true;
        } else {
          validationMsg.style.display = 'none';
          confirmBtn.disabled = false;
        }
      };
      
      // Validate on input
      input.addEventListener('input', validateInput);
      
      const cleanup = () => {
        document.body.removeChild(modal);
      };
      
      const handleConfirm = () => {
        const newName = input.value.trim();
        cleanup();
        resolve(newName);
      };
      
      const handleCancel = () => {
        cleanup();
        resolve(null);
      };
      
      // Event listeners
      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (!confirmBtn.disabled) {
            handleConfirm();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          handleCancel();
        }
      });
      
      // Click outside to cancel
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          handleCancel();
        }
      });
    });
  }
  
  validateFileName(name, type) {
    // Basic validation for file/folder names
    const validNameRegex = /^[a-zA-Z0-9._-]+$/;
    
    if (!name || name.length === 0) {
      return { valid: false, message: 'Name cannot be empty.' };
    }
    
    if (name.length > 255) {
      return { valid: false, message: 'Name is too long (max 255 characters).' };
    }
    
    // Check for valid characters
    if (!validNameRegex.test(name)) {
      return { valid: false, message: 'Name can only contain letters, numbers, dots, hyphens, and underscores.' };
    }
    
    // Check for reserved names
    const reservedNames = ['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'];
    if (reservedNames.includes(name.toLowerCase())) {
      return { valid: false, message: 'This name is reserved by the system.' };
    }
    
    // Files should have an extension, folders shouldn't
    if (type === 'file') {
      if (!name.includes('.')) {
        return { valid: false, message: 'Files must have an extension (e.g., .lua, .wav).' };
      }
      // Check if it starts with a dot
      if (name.startsWith('.')) {
        return { valid: false, message: 'File names cannot start with a dot.' };
      }
    } else {
      if (name.includes('.')) {
        return { valid: false, message: 'Folder names cannot contain dots.' };
      }
    }
    
    return { valid: true };
  }
  
  async renameFileInStorage(oldPath, newPath, _file) {
    const fm = window.serviceContainer?.get?.('fileManager') || window.fileManager;
    if (!fm) {
      console.warn('[ProjectExplorer] FileManager not available, skipping storage rename');
      return;
    }
    try {
      // Load existing record from storage
      const record = await fm.loadFile(oldPath);
      if (!record) {
        console.log(`[ProjectExplorer] No stored content for ${oldPath}, nothing to move`);
        return;
      }
      // Determine content and metadata
      const content = record.content !== undefined ? record.content : (record.fileContent || '');
      const isBinary = !!record.binaryData || (content instanceof ArrayBuffer);
      const metadata = { binaryData: isBinary };
      if (record.builderId) metadata.builderId = record.builderId;
      // Save under new path
      const saved = await fm.saveFile(newPath, content, metadata);
      if (!saved) throw new Error('Save under new path failed');
      // Delete old record
      await fm.deleteFile(oldPath);
      console.log(`[ProjectExplorer] Renamed in storage: ${oldPath} → ${newPath}`);
    } catch (error) {
      console.error('[ProjectExplorer] Failed to rename file in storage:', error);
      throw new Error('Failed to update file storage');
    }
  }
  
  updateNodePath(oldPath, newPath, nodeData) {
    // Remove from old location
    const oldParts = oldPath.split('/');
    const oldFileName = oldParts.pop();
    let oldParent = this.projectData.structure;
    
    for (const part of oldParts) {
      if (oldParent[part] && oldParent[part].type === 'folder') {
        oldParent = oldParent[part].children;
      }
    }
    
    delete oldParent[oldFileName];
    
    // Add to new location
    const newParts = newPath.split('/');
    const newFileName = newParts.pop();
    let newParent = this.projectData.structure;
    
    for (const part of newParts) {
      if (newParent[part] && newParent[part].type === 'folder') {
        newParent = newParent[part].children;
      }
    }
    
    // Update the node data with new name if it's a file
    if (nodeData.type === 'file' && nodeData.file) {
      // Create a new File object with the updated name
      const newFile = new File([nodeData.file], newFileName, {
        type: nodeData.file.type,
        lastModified: nodeData.file.lastModified
      });
      nodeData.file = newFile;
    }
    
    newParent[newFileName] = nodeData;
  }

  // Public API
  getSelectedFile() {
    if (this.selectedNode && this.selectedNode.dataset.type === 'file') {
      const path = this.selectedNode.dataset.path;
      const nodeData = this.getNodeByPath(path);
      return nodeData ? nodeData.file : null;
    }
    return null;
  }
  
  getProjectFiles(filterType = null) {
    const files = [];
    this.collectFiles(this.projectData.structure, '', files, filterType);
    return files;
  }
  
  collectFiles(node, path, files, filterType) {
    for (const [name, data] of Object.entries(node)) {
      const currentPath = path ? `${path}/${name}` : name;
      
      if (data.type === 'file') {
        if (!filterType || this.matchesFilter(name, filterType)) {
          files.push({
            name,
            path: currentPath,
            file: data.file
          });
        }
      } else if (data.type === 'folder' && data.children) {
        this.collectFiles(data.children, currentPath, files, filterType);
      }
    }
  }
  
  matchesFilter(filename, filterType) {
    const ext = this.getFileExtension(filename).toLowerCase();
    
    switch (filterType) {
      case 'music':
        return ['.mod', '.xm', '.s3m', '.it', '.mptm'].includes(ext);
      case 'sfx':
        return ['.wav'].includes(ext);
      default:
        return true;
    }
  }
  
  // Highlight only the currently active file in the tab
  highlightActiveFile(fullPath) {
    console.log(`[ProjectExplorer] Highlighting active file: ${fullPath}`);
    
    // Always clear all current selections first
    const allSelected = this.treeContainer.querySelectorAll('.tree-item.selected');
    allSelected.forEach(item => {
      item.classList.remove('selected');
      console.log(`[ProjectExplorer] Removed selection from: ${item.dataset.path}`);
    });
    this.selectedNode = null;
    
    if (!fullPath) {
      console.log(`[ProjectExplorer] No path provided, cleared all selections`);
      return;
    }
    
    // Find the tree item with this exact path
    const allItems = this.treeContainer.querySelectorAll('.tree-item[data-type="file"]');
    for (const item of allItems) {
      const itemPath = item.dataset.path;
      if (itemPath === fullPath) {
        // Expand tree to show this file
        this.expandToPath(itemPath);
        
        // Select the file
        item.classList.add('selected');
        this.selectedNode = item;
        console.log(`[ProjectExplorer] Selected file at exact path: ${fullPath}`);
        
        // Scroll into view if needed
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        break;
      }
    }
  }

  // Expand tree view to show a specific path
  expandToPath(path) {
    console.log(`[ProjectExplorer] Expanding to path: ${path}`);
    
    // Extract the directory path (remove filename)
    const pathParts = path.split('/');
    const isFile = pathParts.length > 0 && pathParts[pathParts.length - 1].includes('.');
    const directoryPath = isFile ? pathParts.slice(0, -1).join('/') : path;
    
    console.log(`[ProjectExplorer] Target directory path: ${directoryPath}`);
    
    const parts = directoryPath.split('/').filter(part => part); // Remove empty parts
    
    for (let i = 0; i < parts.length; i++) {
      const currentPath = parts.slice(0, i + 1).join('/');
      console.log(`[ProjectExplorer] Looking for folder at path: ${currentPath}`);
      const folderElement = this.treeContainer.querySelector(`[data-path="${currentPath}"]`);
      
      if (folderElement && folderElement.dataset.type === 'folder') {
        console.log(`[ProjectExplorer] Found folder element, checking expansion: ${currentPath}`);
        const toggle = folderElement.querySelector('.tree-expand');
        const children = folderElement.parentElement.querySelector('.tree-children');
        
        if (toggle && children && !children.classList.contains('expanded')) {
          console.log(`[ProjectExplorer] Clicking toggle for: ${currentPath}`);
          toggle.click(); // Trigger expansion
        } else if (children && children.classList.contains('expanded')) {
          console.log(`[ProjectExplorer] Folder already expanded: ${currentPath}`);
        }
      } else {
        console.warn(`[ProjectExplorer] Folder element not found for path: ${currentPath}`);
      }
    }
  }
  
  // Select a specific file in the tree view
  selectFile(path, filename) {
    console.log(`[ProjectExplorer] Selecting file: ${filename} in ${path}`);
    const fullPath = path + '/' + filename;
    const fileElement = this.treeContainer.querySelector(`[data-path="${fullPath}"]`);
    
    if (fileElement) {
      // Remove previous selection
      const previousSelection = this.treeContainer.querySelector('.file-item.selected');
      if (previousSelection) {
        previousSelection.classList.remove('selected');
      }
      
      // Add selection to the new file
      fileElement.classList.add('selected');
      
      // Scroll into view
      fileElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      console.warn(`[ProjectExplorer] File element not found for: ${fullPath}`);
    }
  }
  
  clearProject() {
    console.log('[ProjectExplorer] Clearing project structure...');
    
    // Reset project structure to initial state
    this.projectData = {
      structure: {
        Resources: {
          type: 'folder',
          children: {
            Palettes: { type: 'folder', children: {} },
            Lua: { type: 'folder', children: {} },
            Audio: { type: 'folder', children: {} },
            Graphics: { type: 'folder', children: {} }
          }
        },
        Build: {
          type: 'folder',
          children: {}
        }
      }
    };
    
    // Clear UI
    this.selectedNode = null;
    this.renderTree();
    
    console.log('[ProjectExplorer] Project cleared');
  }
}

// Export for use
window.ProjectExplorer = ProjectExplorer;
