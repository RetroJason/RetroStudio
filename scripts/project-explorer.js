// project-explorer.js
// Project Explorer with tree view, drag & drop, and file filtering

class ProjectExplorer {
  constructor() {
    const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
    const buildRoot = (window.ProjectPaths && window.ProjectPaths.getBuildRootUi) ? window.ProjectPaths.getBuildRootUi() : 'Build';
    this.projectData = {
      structure: {
        // Projects will be added as top-level folders; start with a default one
      }
    };

    this.focusedProjectName = null;
    this.selectedNode = null;
    this.treeContainer = null;
    this.fileUpload = null;
    this.pendingTreeOperations = [];
  this.collapsedPaths = new Set(); // Track user-collapsed folders by path

  // Start with no project by default; user can create/import later
  this.focusedProjectName = null;

    this.initialize();
  }

  addProject(projectName) {
    if (!projectName) return;
    const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
    const buildRoot = (window.ProjectPaths && window.ProjectPaths.getBuildRootUi) ? window.ProjectPaths.getBuildRootUi() : 'Build';
    if (!this.projectData.structure[projectName]) {
      this.projectData.structure[projectName] = {
        type: 'folder',
        children: {
          [sourcesRoot]: {
            type: 'folder',
            children: {
              Music: { type: 'folder', filter: ['.mod', '.xm', '.s3m', '.it', '.mptm'], children: {} },
              SFX: { type: 'folder', filter: ['.wav', '.sfx'], children: {} },
              Images: { type: 'folder', filter: ['.png', '.gif'], children: {} },
              Palettes: { type: 'folder', filter: ['.act', '.pal', '.aco'], children: {} },
              Lua: { type: 'folder', filter: ['.lua', '.txt'], children: {} },
              Binary: { type: 'folder', filter: ['*'], children: {} }
            }
          },
          [buildRoot]: { type: 'folder', children: {} }
        }
      };
    }
    // Re-render if initialized
    if (this.treeContainer) this.renderTree();
  }

  setFocusedProjectName(name) {
  if (!name || !this.projectData.structure[name]) return;
  const prev = this.focusedProjectName;
  if (prev === name) return;
  this.focusedProjectName = name;
  
  // Notify listeners about focus change
  try { window.eventBus?.emit?.('project.focus.changed', { project: name, previous: prev }); } catch (_) {}
  
  // Update UI to reflect active marker
  if (this.treeContainer) this.renderTree();
  }

  getFocusedProjectName() {
  if (this.focusedProjectName && this.projectData.structure[this.focusedProjectName]) return this.focusedProjectName;
  const keys = Object.keys(this.projectData.structure || {});
  return keys.length ? keys[0] : null;
  }
  
  initialize() {
    console.log('[ProjectExplorer] initialize() called');
    console.log('[ProjectExplorer] DOM ready state:', document.readyState);
    
    this.treeContainer = document.getElementById('projectTree');
    this.fileUpload = document.getElementById('fileUpload');
    
    console.log('[ProjectExplorer] Elements found:');
    console.log('- treeContainer:', this.treeContainer);
    console.log('- fileUpload:', this.fileUpload);
    
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
    // Use event-driven approach instead of polling for TabManager readiness
    const setupListener = () => {
      if (window.gameEmulator && window.gameEmulator.tabManager) {
        console.log('[ProjectExplorer] Setting up TabManager event listener');
        window.gameEmulator.tabManager.addEventListener('tabSwitched', (data) => {
          console.log('[ProjectExplorer] TabManager tabSwitched event received:', data);
          const tabInfo = data.tabInfo;
          if (tabInfo && tabInfo.fullPath) {
            console.log('[ProjectExplorer] Highlighting file:', tabInfo.fullPath);
            this.highlightActiveFile(tabInfo.fullPath);
          }
        });
        return true;
      }
      return false;
    };
    
    // Try immediate setup
    if (!setupListener()) {
      console.log('[ProjectExplorer] TabManager not ready, waiting for gameEmulator ready event...');
      
      // Listen for gameEmulator ready event
      const gameEmulatorHandler = () => {
        if (setupListener()) {
          console.log('[ProjectExplorer] Successfully set up TabManager listener after gameEmulator became ready');
          document.removeEventListener('gameEmulatorReady', gameEmulatorHandler);
        }
      };
      document.addEventListener('gameEmulatorReady', gameEmulatorHandler);
      
      // Fallback timeout
      setTimeout(() => {
        if (!setupListener()) {
          console.warn('[ProjectExplorer] Failed to set up TabManager listener after timeout');
        }
        document.removeEventListener('gameEmulatorReady', gameEmulatorHandler);
      }, 2000);
    }
  }
  
  renderTree() {
    this.treeContainer.innerHTML = '';
    const rootList = document.createElement('ul');
    rootList.className = 'tree-node';
    
    // Reorganize structure to show linked files as children
    const reorganizedStructure = this.reorganizeLinkedFiles(this.projectData.structure);
    
    this.renderNode(reorganizedStructure, rootList, '');
    this.treeContainer.appendChild(rootList);
    
    // Only update visual indicators - no logic here
    this.updatePaletteFileVisuals();
  }

  // Reorganize project structure to show linked texture files as children of image files
  reorganizeLinkedFiles(structure) {
    const reorganized = JSON.parse(JSON.stringify(structure)); // Deep clone
    
    // Function to recursively process folders
    const processFolder = (folderData, currentPath = '') => {
      if (!folderData.children) return folderData;
      
      const imageFiles = {};
      const textureFiles = {};
      const otherFiles = {};
      
      // First pass: categorize files
      for (const [name, data] of Object.entries(folderData.children)) {
        if (data.type === 'file') {
          const ext = this.getFileExtension(name).toLowerCase();
          if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(ext)) {
            imageFiles[name] = data;
          } else if (ext === '.texture') {
            textureFiles[name] = data;
          } else {
            otherFiles[name] = data;
          }
        } else if (data.type === 'folder') {
          // Recursively process subfolders
          const folderPath = currentPath ? `${currentPath}/${name}` : name;
          otherFiles[name] = processFolder(data, folderPath);
        }
      }
      
      // Second pass: create hierarchy with linked files
      const newChildren = {};
      
      // Add non-image files first
      Object.assign(newChildren, otherFiles);
      
      // Process image files and their linked textures
      for (const [imageName, imageData] of Object.entries(imageFiles)) {
        const baseName = imageName.substring(0, imageName.lastIndexOf('.'));
        const linkedTextureName = baseName + '.texture';
        
        if (textureFiles[linkedTextureName]) {
          // Create image with texture as child
          const imageWithChild = JSON.parse(JSON.stringify(imageData));
          const textureData = JSON.parse(JSON.stringify(textureFiles[linkedTextureName]));
          // Preserve the original path for file operations
          const originalTexturePath = currentPath ? `${currentPath}/${linkedTextureName}` : linkedTextureName;
          textureData.originalPath = originalTexturePath;
          imageWithChild.children = {
            [linkedTextureName]: textureData
          };
          newChildren[imageName] = imageWithChild;
          // Remove texture from main level (it's now a child)
          delete textureFiles[linkedTextureName];
        } else {
          // No linked texture, add image normally
          newChildren[imageName] = imageData;
        }
      }
      
      // Add any remaining unlinked texture files
      Object.assign(newChildren, textureFiles);
      
      return {
        ...folderData,
        children: newChildren
      };
    };
    
    // Process each top-level item
    for (const [name, data] of Object.entries(reorganized)) {
      if (data.type === 'folder') {
        reorganized[name] = processFolder(data, name);
      }
    }
    
    return reorganized;
  }
  
  renderNode(nodeData, container, path) {
    for (const [name, data] of Object.entries(nodeData)) {
      const currentPath = path ? `${path}/${name}` : name;
      const li = document.createElement('li');
      li.className = 'tree-node';
      
      const item = document.createElement('div');
      item.className = 'tree-item';
      // Use originalPath for linked files (like texture files), otherwise use currentPath
      item.dataset.path = data.originalPath || currentPath;
      item.dataset.type = data.type;
      
      // Expand button
      const expand = document.createElement('span');
      expand.className = 'tree-expand';
      const hasChildren = Object.keys(data.children || {}).length > 0;
      if ((data.type === 'folder' || data.type === 'file') && hasChildren) {
        // Default expanded unless explicitly collapsed
        const shouldExpand = !this.collapsedPaths.has(currentPath);
        expand.textContent = shouldExpand ? '▼' : '▶';
        if (shouldExpand) expand.classList.add('expanded');
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
      // Add active project indicator on root label
      if (data.type === 'folder' && !currentPath.includes('/')) {
        const isActive = (this.getFocusedProjectName && this.getFocusedProjectName()) === name;
        label.textContent = isActive ? `${name} (active)` : name;
      } else {
        label.textContent = name;
      }
      
      item.appendChild(expand);
      item.appendChild(icon);
      item.appendChild(label);
      
      // Event listeners with double-click protection
      let clickTimeout = null;
      
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Don't auto-select here - let tab manager control highlighting via highlightActiveFile
        
        // If clicking a top-level project root, set focus to that project
        if (data.type === 'folder' && !currentPath.includes('/')) {
          this.setFocusedProjectName(name);
        }

        // Delay single-click action to check for double-click
        clearTimeout(clickTimeout);
        clickTimeout = setTimeout(() => {
          // Show in preview if it's a file (only if not double-clicked)
          if (data.type === 'file' && window.tabManager) {
            const isReadOnly = data.isReadOnly || data.isBuildFile;
            // Use original path if available (for linked files), otherwise use current path
            let fullPath = data.originalPath || currentPath;
            // Only normalize build artifacts to storage path; keep project prefix for sources
            if (window.ProjectPaths?.isBuildArtifact?.(fullPath)) {
              fullPath = window.ProjectPaths.normalizeStoragePath(fullPath);
            } else if (fullPath.startsWith('Build/')) {
              fullPath = fullPath.replace(/^Build\//, 'build/');
            }
            console.log(`[ProjectExplorer] Single-clicking file: currentPath="${currentPath}", openPath="${fullPath}", originalPath="${data.originalPath || 'none'}"`);
            
            // Get appropriate component for preview (prefer viewer for single-click)
            const componentInfo = this._getComponentForFile(fullPath, false);
            if (componentInfo) {
              window.tabManager.openInPreview(fullPath, componentInfo, { isReadOnly });
            } else {
              console.warn(`[ProjectExplorer] No component found for ${fullPath}, using legacy method`);
              window.tabManager.openInPreview(fullPath, data.file, { isReadOnly });
            }
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
          // Use original path if available (for linked files), otherwise use current path
          let fullPath = data.originalPath || currentPath;
          
          // Only normalize build artifacts to storage path; keep project prefix for sources
          if (window.ProjectPaths?.isBuildArtifact?.(fullPath)) {
            fullPath = window.ProjectPaths.normalizeStoragePath(fullPath);
          } else if (fullPath.startsWith('Build/')) {
            fullPath = fullPath.replace(/^Build\//, 'build/');
          }
          
          console.log(`[ProjectExplorer] Double-clicking file: currentPath="${currentPath}", fullPath="${fullPath}", originalPath="${data.originalPath || 'none'}"`);
          
          // Get appropriate component for tab (prefer editor for double-click)
          const componentInfo = this._getComponentForFile(fullPath, true);
          if (componentInfo) {
            window.tabManager.openInTab(fullPath, componentInfo, { isReadOnly });
          } else {
            console.warn(`[ProjectExplorer] No component found for ${fullPath}, using legacy method`);
            window.tabManager.openInTab(fullPath, null, { isReadOnly });
          }
        } else if (data.type === 'folder') {
          // If double-clicking a top-level project root, also set focus
          if (!currentPath.includes('/')) {
            this.setFocusedProjectName(name);
          }
          // Toggle folder on double-click
          this.toggleNode(li, expand);
        }
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
      if ((data.type === 'folder' || data.type === 'file') && data.children) {
        const childrenUl = document.createElement('ul');
        childrenUl.className = 'tree-children';
        this.renderNode(data.children, childrenUl, currentPath);
        // Default expanded unless explicitly collapsed
        if (!this.collapsedPaths.has(currentPath)) {
          childrenUl.classList.add('expanded');
        }
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
      const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
      const buildRoot = (window.ProjectPaths && window.ProjectPaths.getBuildRootUi) ? window.ProjectPaths.getBuildRootUi() : 'Build';
      // If this is a top-level project node
      if (!currentPath.includes('/')) return '�️';
      // Remove project prefix for checks
      const pp = window.ProjectPaths?.parseProjectPath ? window.ProjectPaths.parseProjectPath(currentPath) : { rest: currentPath };
      const rest = pp.rest || currentPath;
      if (name === sourcesRoot && rest === sourcesRoot) return '�'; // Sources root
      if (name === buildRoot && rest === buildRoot) return '📦'; // Build root
      if (rest.startsWith(buildRoot + '/')) return '🗂️'; // Build subfolders
      if (rest.startsWith(sourcesRoot + '/')) {
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
    if (['.png', '.gif', '.jpg', '.jpeg', '.bmp'].includes(ext)) {
      return '🖼️';
    }
    if (['.texture'].includes(ext)) {
      return '⚙️';
    }
    
    return '📄';
  }
  
  getFileExtension(filename) {
    return filename.substring(filename.lastIndexOf('.'));
  }
  
  toggleNode(li, expandButton) {
    const children = li.querySelector('.tree-children');
    if (!children) return;
    const path = li.querySelector('.tree-item')?.dataset?.path;
    const isExpanded = children.classList.contains('expanded');
    
    if (isExpanded) {
      children.classList.remove('expanded');
      expandButton.textContent = '▶';
      expandButton.classList.remove('expanded');
      if (path) this.collapsedPaths.add(path);
    } else {
      children.classList.add('expanded');
      expandButton.textContent = '▼';
      expandButton.classList.add('expanded');
      if (path) this.collapsedPaths.delete(path);
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
          
          const buildRoot = (window.ProjectPaths && window.ProjectPaths.getBuildRootUi) ? window.ProjectPaths.getBuildRootUi() : 'Build';
          if (textContent === buildRoot) {
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
  

  async closeProject(projectPath) {
    // projectPath is the project name (no slash) when invoked from root
    const pp = window.ProjectPaths?.parseProjectPath ? window.ProjectPaths.parseProjectPath(projectPath) : { project: null, rest: projectPath };
    const projectName = pp.project || (projectPath.includes('/') ? projectPath.split('/')[0] : projectPath);
    if (!projectName || !this.projectData.structure[projectName]) return;

    const confirmed = await this._confirm('Close Project', `Close project "${projectName}"? Open tabs for its files will be closed.`, { okText: 'Close Project', cancelText: 'Cancel' });
    if (!confirmed) return;

    // Collect all file paths (sources + build) for deletion from storage
    const buildRoot = (window.ProjectPaths && window.ProjectPaths.getBuildRootUi) ? window.ProjectPaths.getBuildRootUi() : 'Build';
    const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
    const toDelete = [];
    const addPaths = (node, base) => {
      if (!node) return;
      if (node.type === 'file') {
        toDelete.push(base);
      } else if (node.children) {
        for (const [name, child] of Object.entries(node.children)) {
          addPaths(child, base ? `${base}/${name}` : name);
        }
      }
    };
    addPaths(this.projectData.structure[projectName]?.children?.[sourcesRoot], `${projectName}/${sourcesRoot}`);
    addPaths(this.projectData.structure[projectName]?.children?.[buildRoot], `${projectName}/${buildRoot}`);

    // Delete from storage via FileManager, normalizing paths
    const fm = window.serviceContainer?.get?.('fileManager') || window.fileManager;
    if (fm) {
      for (const p of toDelete) {
        const norm = window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(p) : p.replace(/^Build\//, 'build/');
        try { await fm.deleteFile(norm); } catch (_) {}
      }
    }

    // Signal deletions to other systems (TabManager will close affected tabs)
    try {
      if (window.eventBus && typeof window.eventBus.emit === 'function') {
        const normalizedDeleted = toDelete.map(p => (window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(p) : p.replace(/^Build\//, 'build/')));
        await window.eventBus.emit('file.deleted', { path: projectName, isFolder: true, deletedPaths: normalizedDeleted });
      }
    } catch (_) { /* ignore */ }

    // Fallback: directly close any open tabs that match deleted files (normalized compare)
    try {
      if (window.gameEmulator?.tabManager) {
        const normalize = (p) => (window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(p) : (typeof p === 'string' ? p.replace(/^Build\//, 'build/') : p));
        const deletedSet = new Set(toDelete.map(normalize));
        const tabs = window.gameEmulator.tabManager.getAllTabs();
        for (const t of tabs) {
          const tp = t.fullPath;
          const tpNorm = normalize(tp);
          if (tpNorm && deletedSet.has(tpNorm)) {
            if (t.tabId && t.tabId !== 'preview') {
              window.gameEmulator.tabManager.closeTab(t.tabId);
            } else if (t.tabId === 'preview') {
              window.gameEmulator.tabManager._closePreviewTab();
            }
          }
        }
      }
    } catch (_) { /* ignore */ }

    // Remove project from structure
    delete this.projectData.structure[projectName];

    // Focus another project if any
    const remaining = Object.keys(this.projectData.structure);
    this.focusedProjectName = remaining[0] || null;

    // Re-render
    this.renderTree();
  }
  
  handleFileUpload(files) {
    const targetPath = this.currentUploadPath || this.getDefaultPath();
    this.addFiles(files, targetPath);
  }
  
  async handleFileDrop(event, targetPath = null) {
    const files = event.dataTransfer.files;
    const path = targetPath || this.getDropTargetPath(event.target);

    if (!files || files.length === 0) return;

    // Check if there's an active project before allowing file drops
    // Exception: .rwp files should be allowed even without an active project (they create projects)
    const activeProject = this.getFocusedProjectName();
    if (!activeProject) {
      // Check if any files are .rwp files
      const hasRwpFile = Array.from(files).some(file => 
        file.name && file.name.toLowerCase().endsWith('.rwp')
      );
      
      if (!hasRwpFile) {
        console.log('[ProjectExplorer] No active project - blocking file drop (non-RWP files)');
        // Show a visual indication that the drop was blocked
        const dropOverlay = document.createElement('div');
        dropOverlay.className = 'drop-blocked-overlay';
        dropOverlay.innerHTML = `
          <div class="drop-blocked-message">
            <div class="warning-icon">⚠</div>
            <p>Please create or open a project first</p>
            <small>Files can only be added to an active project<br>(except .rwp project files)</small>
          </div>
        `;
        dropOverlay.style.cssText = `
          position: fixed; top: 0; left: 0; right: 0; bottom: 0; 
          background: rgba(0,0,0,0.7); z-index: 10000; 
          display: flex; align-items: center; justify-content: center;
          color: white; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        `;
        dropOverlay.querySelector('.drop-blocked-message').style.cssText = `
          background: #dc3545; padding: 2rem; border-radius: 8px; text-align: center;
          box-shadow: 0 8px 32px rgba(0,0,0,0.3); max-width: 400px;
        `;
        dropOverlay.querySelector('.warning-icon').style.cssText = `
          font-size: 3rem; margin-bottom: 1rem; display: block;
        `;
        dropOverlay.querySelector('p').style.cssText = `
          margin: 0 0 0.5rem 0; font-size: 1.2rem; font-weight: 600;
        `;
        dropOverlay.querySelector('small').style.cssText = `
          opacity: 0.8; font-size: 0.9rem;
        `;
        
        document.body.appendChild(dropOverlay);
        setTimeout(() => {
          dropOverlay.style.opacity = '0';
          dropOverlay.style.transition = 'opacity 0.3s ease';
          setTimeout(() => dropOverlay.remove(), 300);
        }, 2000);
        
        return;
      } else {
        console.log('[ProjectExplorer] No active project but RWP file detected - allowing drop for project import');
      }
    }

    // Special-case: .rwp archives should trigger project import, not add as binary
    try {
      const all = Array.from(files);
      const rwpFiles = all.filter(f => typeof f?.name === 'string' && f.name.toLowerCase().endsWith('.rwp'));
      const otherFiles = all.filter(f => !f.name.toLowerCase().endsWith('.rwp'));

      if (rwpFiles.length > 0) {
        const svc = (window.serviceContainer?.get?.('rwpService')) || window.rwpService;
        if (svc && typeof svc.importProject === 'function') {
          for (const f of rwpFiles) {
            try { await svc.importProject(f); } catch (e) { console.warn('[ProjectExplorer] RWP import failed:', e); }
          }
        } else {
          console.warn('[ProjectExplorer] rwpService unavailable; skipping .rwp import');
        }
      }

      if (otherFiles.length > 0) {
        this.addFiles(otherFiles, path);
      }
      return;
    } catch (e) {
      console.warn('[ProjectExplorer] Error handling file drop:', e);
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

    // For multi-drop, open all files in tabs after persistence is complete
    if (multiDrop && persistPromises.length > 0) {
      try {
        await Promise.allSettled(persistPromises);
        
        // Open each file in a tab
        for (const file of fileList) {
          const filtered = this.filterFile(file, targetPath);
          const destPath = filtered.allowed ? filtered.path : (filtered.path || null);
          if (destPath) {
            try {
              await this.openFileInTab(file, destPath);
            } catch (e) {
              console.warn(`[ProjectExplorer] Failed to open ${file.name} in tab:`, e);
            }
          }
        }
      } catch (e) {
        console.warn('[ProjectExplorer] Error opening multiple files in tabs:', e);
      }
    }

    // Highlight the last file for single drops or if multi-drop tab opening failed
    if (lastAddedFile && lastAddedPath) {
      setTimeout(() => {
        this.expandToPath(lastAddedPath);
        console.log(`[ProjectExplorer] Expanded to show last added file: ${lastAddedFile.name}`);
      }, 50);
    }
  }
  
  filterFile(file, targetPath) {
  const ext = this.getFileExtension(file.name).toLowerCase();
  const musicExts = ['.mod', '.xm', '.s3m', '.it', '.mptm'];
  const sfxExts = ['.wav', '.sfx'];
  const luaExts = ['.lua', '.txt'];
    
    // Get the target folder data
    const folderData = this.getNodeByPath(targetPath);
    
    // If dropping on a filtered folder, check if file matches
    if (folderData && folderData.filter) {
      const allowed = folderData.filter.includes(ext);
      return { allowed, path: targetPath };
    }
    
    // Auto-filter to appropriate folder
    const pp = window.ProjectPaths?.parseProjectPath ? window.ProjectPaths.parseProjectPath(targetPath) : { project: this.getFocusedProjectName(), rest: targetPath };
    const project = pp.project || this.getFocusedProjectName();
    const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
    if (musicExts.includes(ext)) {
      return { allowed: true, path: `${project}/${sourcesRoot}/Music` };
    } else if (sfxExts.includes(ext)) {
      return { allowed: true, path: `${project}/${sourcesRoot}/SFX` };
    } else if (['.png', '.gif', '.jpg', '.jpeg', '.bmp'].includes(ext)) {
      return { allowed: true, path: `${project}/${sourcesRoot}/Images` };
    } else if (['.texture'].includes(ext)) {
      return { allowed: true, path: `${project}/${sourcesRoot}/Images` };
    } else if (luaExts.includes(ext)) {
      return { allowed: true, path: `${project}/${sourcesRoot}/Lua` };
    } else if (['.pal', '.act', '.aco'].includes(ext)) {
      return { allowed: true, path: `${project}/${sourcesRoot}/Palettes` };
    }
    // Default unrecognized files to Binary folder
    return { allowed: true, path: `${project}/${sourcesRoot}/Binary` };
  }
  
  /**
   * Add a file to the project using automatic path filtering based on extension
   * @param {string} fileName - Just the filename with extension
   * @param {boolean} skipAutoOpen - Skip auto-opening the file
   * @param {boolean} skipRender - Skip re-rendering the project tree
   * @returns {Promise} Promise that resolves when file is added
   */
  addFileToProjectByName(fileName, skipAutoOpen = false, skipRender = false) {
    // Create a file-like object with just the name for filtering
    const fileObj = { name: fileName };
    
    // Use the filtering system to determine the correct path
    const focusedProject = this.getFocusedProjectName();
    if (!focusedProject) {
      throw new Error('No active project');
    }
    
    // Use an arbitrary target path - the filtering system will auto-redirect
    const tempPath = `${focusedProject}/Sources`;
    const filtered = this.filterFile(fileObj, tempPath);
    
    if (!filtered.allowed) {
      throw new Error(`File type not supported: ${fileName}`);
    }
    
    // Create a file metadata object
    const fileMetadata = {
      name: fileName,
      path: `${filtered.path}/${fileName}`,
      isNewFile: true
    };
    
    // Use the existing addFileToProject method with the determined path
    return this.addFileToProject(fileMetadata, filtered.path, skipAutoOpen, skipRender);
  }

  addFileToProject(file, path, skipAutoOpen = false, skipRender = false) {
    // Return a promise that resolves after persistence (if any)
    let persistResolve;
    const persistDone = new Promise((resolve) => { persistResolve = resolve; });
  const parts = path.split('/');
    let current = this.projectData.structure;
    
    // Navigate to the target folder, creating missing folders as needed
  for (const part of parts) {
      if (!current[part]) {
        // Create missing folder
        current[part] = {
          type: 'folder',
          children: {}
        };
        console.log(`[ProjectExplorer] Created missing folder: ${part}`);
      }
      if (current[part] && current[part].type === 'folder') {
    current = current[part].children;
      } else {
        console.error(`[ProjectExplorer] Path navigation failed at: ${part}, current[part]:`, current[part]);
        break;
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
    
    // Check if this is a palette file that needs conversion to ACT
    const ext = this.getFileExtension(fileName).toLowerCase();
    let finalFileName = fileName;
    let needsConversion = false;
    
    if (['.pal', '.aco'].includes(ext)) {
      // Convert .pal and .aco files to .act format
      finalFileName = fileName.substring(0, fileName.lastIndexOf('.')) + '.act';
      needsConversion = true;
      console.log(`[ProjectExplorer] Will convert palette ${fileName} to ${finalFileName}`);
      
      // Show user feedback about conversion
      if (window.gameEmulator && window.gameEmulator.setStatus) {
        window.gameEmulator.setStatus(`Converting ${fileName} to ACT format...`);
      }
    }
    
    // Add the file reference (not the content - content is in storage)
    const finalExt = this.getFileExtension(finalFileName).toLowerCase();
    const builderId = finalExt === '.sfx' ? 'sfx' : (['.pal', '.act', '.aco'].includes(finalExt) ? 'pal' : undefined);

    current[finalFileName] = {
      type: 'file',
      path: file.path || `${path}/${finalFileName}`,
      size: fileSize,
      lastModified: lastModified,
      isNewFile: file.isNewFile || false,
      builderId,
      // Preserve any additional properties from the file object (like originalPath)
      ...(file.originalPath && { originalPath: file.originalPath })
    };
    
    console.log(`[ProjectExplorer] Added file reference: ${finalFileName} to ${path}`);

    // Persist content to storage for storage-first workflows
  const uiFullPath = file.path || `${path}/${finalFileName}`;
  const storageFullPath = window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(uiFullPath) : uiFullPath;
  if (file instanceof File) {
      try {
        // Decide binary vs text: known text types stay text; everything else treated as binary
        const textExts = ['.lua', '.txt', '.pal', '.sfx'];
        const isBinary = !textExts.includes(finalExt);
        const readPromise = isBinary ? file.arrayBuffer() : file.text();
        readPromise.then(async (content) => {
          let finalContent = content;
          
          // Convert palette files to ACT format if needed
          if (needsConversion && window.Palette) {
            try {
              console.log(`[ProjectExplorer] Converting ${fileName} to ACT format...`);
              const palette = new Palette();
              await palette.loadFromContent(content, fileName);
              finalContent = palette.exportToACT();
              console.log(`[ProjectExplorer] Successfully converted ${fileName} to ACT format`);
              
              // Update user feedback
              if (window.gameEmulator && window.gameEmulator.setStatus) {
                window.gameEmulator.setStatus(`Converted ${fileName} to ${finalFileName}`);
              }
            } catch (conversionError) {
              console.error(`[ProjectExplorer] Failed to convert ${fileName} to ACT:`, conversionError);
              // Fall back to original content if conversion fails
              finalContent = content;
              
              // Show error feedback
              if (window.gameEmulator && window.gameEmulator.setStatus) {
                window.gameEmulator.setStatus(`Failed to convert ${fileName} - using original format`);
              }
            }
          }
          
          if (window.fileIOService) {
            await window.fileIOService.saveFile(storageFullPath, finalContent, {
              binaryData: needsConversion ? true : isBinary, // ACT files are always binary
              builderId
            });
            console.log(`[ProjectExplorer] Persisted ${needsConversion ? 'converted' : 'dropped'} file to storage: ${storageFullPath}`);
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
    
    // Emit file addition event for other components to listen to
    this.emitFileAddedEvent({ ...file, name: finalFileName }, path);
    
    // Auto-create texture file for image files (after file is added to project)
    if (this.isImageFile(finalFileName)) {
      console.log('[ProjectExplorer] Image file detected, will create texture file:', finalFileName);
      persistDone.then(() => {
        console.log('[ProjectExplorer] Persistence done, creating texture file for:', finalFileName);
        this.openTextureEditorForImage(uiFullPath, path, finalFileName);
      });
    }
    
    // Auto-open file in tab if not skipping
    if (!skipAutoOpen) {
      persistDone.then(async () => {
        try {
          await this.openFileInTab({ ...file, name: finalFileName }, path);
        } catch (e) {
          console.warn('[ProjectExplorer] Auto-open failed after persist:', e);
        }
      });
    }

    return persistDone;
  }
  
  async clearBuildFolder() {
    console.log('[ProjectExplorer] Clearing build folder...');
    
    // Clean up old build files from storage first
    await this.cleanupBuildFilesFromStorage();
    
    // Clear existing build folder contents
    const project = this.getFocusedProjectName();
    const buildRoot = (window.ProjectPaths && window.ProjectPaths.getBuildRootUi) ? window.ProjectPaths.getBuildRootUi() : 'Build';
    if (project && this.projectData.structure[project]?.children?.[buildRoot]) {
      this.projectData.structure[project].children[buildRoot].children = {};
    }
    
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
    
    const buildRoot = (window.ProjectPaths && window.ProjectPaths.getBuildRootUi) ? window.ProjectPaths.getBuildRootUi() : 'Build';
    const buildPrefix = (window.ProjectPaths && window.ProjectPaths.getBuildStoragePrefix) ? window.ProjectPaths.getBuildStoragePrefix() : 'build/';
    const project = this.getFocusedProjectName();
    const node = project ? this.projectData?.structure?.[project]?.children?.[buildRoot]?.children : null;
    if (node) {
      for (const [name, child] of Object.entries(node)) {
        traverseNode(child, `${buildPrefix}${name}`.replace(/\/$/, ''));
      }
    }
    
    return buildFilePaths;
  }

  async refreshBuildFolder() {
    console.log('[ProjectExplorer] Refreshing build folder...');
    
    // Clear existing build folder contents
    const _buildRootLog = (window.ProjectPaths && window.ProjectPaths.getBuildRootUi) ? window.ProjectPaths.getBuildRootUi() : 'Build';
    const project = this.getFocusedProjectName();
    if (project && this.projectData.structure[project]?.children?.[_buildRootLog]) {
      this.projectData.structure[project].children[_buildRootLog].children = {};
    }
    
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
        const buildPrefix = (window.ProjectPaths && window.ProjectPaths.getBuildStoragePrefix) ? window.ProjectPaths.getBuildStoragePrefix() : 'build/';
        if (filePath.startsWith(buildPrefix)) {
          // Remove 'build/' prefix and add to Build folder
          let relativePath = filePath.substring(buildPrefix.length);
          
          // Also remove 'Resources/' prefix if it exists (legacy paths)
          const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
          if (relativePath.startsWith(sourcesRoot + '/')) {
            relativePath = relativePath.substring((sourcesRoot + '/').length);
          }
          
          console.log(`[ProjectExplorer] Adding build file: ${relativePath}`);
          this.addBuildFileToStructure(relativePath, fileData);
        }
      }
      
  console.log('[ProjectExplorer] Build folder structure (focused project):', this.projectData.structure[this.getFocusedProjectName()]?.children?.[_buildRootLog]);
      
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
    const buildRoot = (window.ProjectPaths && window.ProjectPaths.getBuildRootUi) ? window.ProjectPaths.getBuildRootUi() : 'Build';
    const project = this.getFocusedProjectName();
    if (project && this.projectData.structure[project]?.children?.[buildRoot]) {
      this.projectData.structure[project].children[buildRoot].children = {};
    }
    this.renderTree();
  }
  
  addBuildFileToStructure(relativePath, fileData) {
    console.log(`[ProjectExplorer] addBuildFileToStructure called with: ${relativePath}`, fileData);
    
    const parts = relativePath.split('/');
    const fileName = parts.pop();
    console.log(`[ProjectExplorer] Path parts:`, parts, `FileName: ${fileName}`);
    
    // Navigate to or create the folder structure
  const buildRoot = (window.ProjectPaths && window.ProjectPaths.getBuildRootUi) ? window.ProjectPaths.getBuildRootUi() : 'Build';
  const project = this.getFocusedProjectName();
  let current = project ? this.projectData.structure[project].children[buildRoot].children : this.projectData.structure[buildRoot].children;
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
    const pp = window.ProjectPaths?.parseProjectPath ? window.ProjectPaths.parseProjectPath(path) : { project: this.getFocusedProjectName(), rest: parts.join('/') };
    const project = pp.project || this.getFocusedProjectName();
    const fallback = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
    const joined = parts.join('/') || `${project}/${fallback}`;
    return joined;
      }
    }
  const project = this.getFocusedProjectName();
  const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
  return project ? `${project}/${sourcesRoot}` : sourcesRoot;
  }
  
  getDefaultPath() {
  const project = this.getFocusedProjectName();
  const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
  return project ? `${project}/${sourcesRoot}` : sourcesRoot;
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
      const storagePath = (window.ProjectPaths && window.ProjectPaths.normalizeStoragePath) ? window.ProjectPaths.normalizeStoragePath(p) : (p.startsWith('Build/') ? p.replace(/^Build\//, 'build/') : p);
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
    
    // Handle linked files - check for and rename linked texture/image pairs
    let linkedOldPath = null;
    let linkedNewPath = null;
    if (type === 'file') {
      const linkedFileName = this.getLinkedFileName(currentName);
      if (linkedFileName) {
        linkedOldPath = parentPath ? `${parentPath}/${linkedFileName}` : linkedFileName;
        const linkedNode = this.getNodeByPath(linkedOldPath);
        if (linkedNode) {
          // Calculate new name for linked file
          const newBaseName = newName.substring(0, newName.lastIndexOf('.'));
          const linkedExt = this.getFileExtension(linkedFileName);
          const linkedNewName = newBaseName + linkedExt;
          linkedNewPath = parentPath ? `${parentPath}/${linkedNewName}` : linkedNewName;
          
          // Check if linked new name would conflict
          if (this.getNodeByPath(linkedNewPath)) {
            alert(`Cannot rename: linked file "${linkedNewName}" would conflict with existing file.`);
            return;
          }
          
          console.log(`[ProjectExplorer] Will also rename linked file: ${linkedOldPath} → ${linkedNewPath}`);
        }
      }
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
        
        // Also rename linked file if it exists
        if (linkedOldPath && linkedNewPath) {
          const linkedNodeData = this.getNodeByPath(linkedOldPath);
          if (linkedNodeData) {
            try {
              await this.renameFileInStorage(linkedOldPath, linkedNewPath, linkedNodeData.file);
              console.log(`[ProjectExplorer] Successfully renamed linked file: ${linkedOldPath} → ${linkedNewPath}`);
            } catch (error) {
              console.error(`[ProjectExplorer] Failed to rename linked file:`, error);
              // Continue with main file rename even if linked file fails
            }
          }
        }
      }
      
      // Update the project structure
      this.updateNodePath(path, newPath, nodeData);
      
      // Update linked file in project structure too
      if (linkedOldPath && linkedNewPath) {
        const linkedNodeData = this.getNodeByPath(linkedOldPath);
        if (linkedNodeData) {
          try {
            this.updateNodePath(linkedOldPath, linkedNewPath, linkedNodeData);
            console.log(`[ProjectExplorer] Updated linked file structure: ${linkedOldPath} → ${linkedNewPath}`);
          } catch (error) {
            console.error(`[ProjectExplorer] Failed to update linked file structure:`, error);
          }
        }
      }
      
      // Re-render the tree
      this.renderTree();
      
      // Expand to show the renamed item
      this.expandToPath(newPath);
      
      // Update any open tabs with the renamed file
      if (type === 'file') {
        // Try multiple ways to get TabManager, similar to other parts of this file
        const tabManager = window.tabManager || 
                          window.serviceContainer?.get?.('tabManager') || 
                          window.gameEmulator?.tabManager ||
                          window.gameEditor?.tabManager;
        
        if (tabManager && typeof tabManager.updateFileReference === 'function') {
          tabManager.updateFileReference(path, newPath, newName);
          
          // Update linked file tab reference too
          if (linkedOldPath && linkedNewPath) {
            const linkedNewName = linkedNewPath.split('/').pop();
            tabManager.updateFileReference(linkedOldPath, linkedNewPath, linkedNewName);
          }
        }
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
  const oldStorage = window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(oldPath) : oldPath;
  const newStorage = window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(newPath) : newPath;
  const record = await fm.loadFile(oldStorage);
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
  const saved = await fm.saveFile(newStorage, content, metadata);
      if (!saved) throw new Error('Save under new path failed');
      // Delete old record
  await fm.deleteFile(oldStorage);
  console.log(`[ProjectExplorer] Renamed in storage: ${oldStorage} → ${newStorage}`);
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

    const findItemForPath = (p) => {
      // 1) Try exact UI path match
      let candidate = this.treeContainer.querySelector(`.tree-item[data-type="file"][data-path="${CSS.escape(p)}"]`);
      if (candidate) return candidate;

      const buildPrefix = (window.ProjectPaths && window.ProjectPaths.getBuildStoragePrefix) ? window.ProjectPaths.getBuildStoragePrefix() : 'build/';
      const sourcesUi = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
      const buildUi = (window.ProjectPaths && window.ProjectPaths.getBuildRootUi) ? window.ProjectPaths.getBuildRootUi() : 'Build';

      // 2) If it's a storage build path, map to each project's UI path
      if (p.startsWith(buildPrefix)) {
        const rel = p.substring(buildPrefix.length);
        const projects = Object.keys(this.projectData.structure || {});
        for (const proj of projects) {
          const uiPath = `${proj}/${buildUi}/${rel}`;
          candidate = this.treeContainer.querySelector(`.tree-item[data-type="file"][data-path="${CSS.escape(uiPath)}"]`);
          if (candidate) return candidate;
        }
        // Fallback: endsWith search across items
        const allItems = Array.from(this.treeContainer.querySelectorAll('.tree-item[data-type="file"]'));
        const suffix = `/${buildUi}/${rel}`;
        candidate = allItems.find(it => (it.dataset.path || '').endsWith(suffix));
        if (candidate) return candidate;
      }

      // 3) If it's a storage sources path, map to each project's UI sources path
      if (p.startsWith('Sources/') || p.startsWith('Resources/')) {
        const prefix = p.startsWith('Sources/') ? 'Sources/' : 'Resources/';
        const rel = p.substring(prefix.length);
        const projects = Object.keys(this.projectData.structure || {});
        for (const proj of projects) {
          const uiPath = `${proj}/${sourcesUi}/${rel}`;
          candidate = this.treeContainer.querySelector(`.tree-item[data-type="file"][data-path="${CSS.escape(uiPath)}"]`);
          if (candidate) return candidate;
        }
        // Fallback: endsWith search across items
        const allItems = Array.from(this.treeContainer.querySelectorAll('.tree-item[data-type="file"]'));
        const suffix = `/${sourcesUi}/${rel}`;
        candidate = allItems.find(it => (it.dataset.path || '').endsWith(suffix));
        if (candidate) return candidate;
      }

      return null;
    };

    const item = findItemForPath(fullPath);
    if (item) {
      const itemPath = item.dataset.path;
      this.expandToPath(itemPath);
      item.classList.add('selected');
      this.selectedNode = item;
      console.log(`[ProjectExplorer] Selected file: ${itemPath}`);
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      console.log(`[ProjectExplorer] No matching tree item for path: ${fullPath}`);
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
    
  // Create a fresh empty project set with a single default project
  this.projectData = { structure: {} };
  const defaultProject = 'Game Project';
  this.addProject(defaultProject);
  this.setFocusedProjectName(defaultProject);
    
    // Clear UI
    this.selectedNode = null;
    this.renderTree();
    
    console.log('[ProjectExplorer] Project cleared');
  }

  // Non-destructive remove: close project from UI without deleting stored files
  async removeProjectFromUI(projectName) {
    if (!projectName || !this.projectData?.structure?.[projectName]) return;

    // Close open tabs for this project's files
    try {
      const tm = window.tabManager || 
                 window.serviceContainer?.get?.('tabManager') || 
                 window.gameEmulator?.tabManager ||
                 window.gameEditor?.tabManager;
      if (tm && typeof tm.getAllTabs === 'function') {
        const tabs = tm.getAllTabs();
        for (const t of tabs) {
          const full = t.fullPath || '';
          if (typeof full === 'string' && full.startsWith(projectName + '/')) {
            if (t.tabId && t.tabId !== 'preview') tm.closeTab(t.tabId);
            else if (t.tabId === 'preview' && tm._closePreviewTab) tm._closePreviewTab();
          }
        }
      }
    } catch (_) { /* ignore */ }

    // Remove from structure and re-focus
    delete this.projectData.structure[projectName];
    const remaining = Object.keys(this.projectData.structure || {});
    this.focusedProjectName = remaining[0] || null;
    this.renderTree();

    try { window.eventBus?.emit?.('project.closed', { project: projectName, removed: true }); } catch (_) {}
  }

  // Helper method to get appropriate component for a file
  _getComponentForFile(filePath, preferEditor = false) {
    const componentRegistry = window.serviceContainer?.get('componentRegistry');
    if (!componentRegistry) {
      console.warn('[ProjectExplorer] ComponentRegistry not available');
      return null;
    }

    // Get file extension
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop();
    const extension = fileName.includes('.') ? '.' + fileName.split('.').pop().toLowerCase() : '';
    
    console.log(`[ProjectExplorer] Getting component for file: ${fileName}, extension: ${extension}, preferEditor: ${preferEditor}`);

    let component = null;
    
    if (preferEditor) {
      // Try to get an editor first
      const editors = componentRegistry.getComponentsForExtension(extension).filter(c => c.type === 'editor');
      component = editors.length > 0 ? editors[0] : null;
      console.log(`[ProjectExplorer] Found ${editors.length} editors for ${extension}`);
    }
    
    if (!component) {
      if (preferEditor) {
        // For editor preference, use the old logic
        const allComponents = componentRegistry.getComponentsForExtension(extension);
        console.log(`[ProjectExplorer] Found ${allComponents.length} total components for ${extension}:`, allComponents.map(c => c.name));
        
        const editors = allComponents.filter(c => c.type === 'editor');
        if (editors.length > 0) {
          component = editors[0];
        }
      } else {
        // For viewer selection, use the component registry's path-aware logic
        const viewerInfo = componentRegistry.getViewerForFile(filePath);
        if (viewerInfo) {
          component = viewerInfo;
          console.log(`[ProjectExplorer] ComponentRegistry selected viewer: ${component.name}`);
        } else {
          // Fallback to old logic if no viewer found
          const allComponents = componentRegistry.getComponentsForExtension(extension);
          console.log(`[ProjectExplorer] Found ${allComponents.length} total components for ${extension}:`, allComponents.map(c => c.name));
          
          const editors = allComponents.filter(c => c.type === 'editor');
          const viewers = allComponents.filter(c => c.type === 'viewer');
          
          if (editors.length > 0) {
            component = editors[0];
          } else if (viewers.length > 0) {
            component = viewers[0];
          }
        }
      }
    }

    if (component) {
      console.log(`[ProjectExplorer] Selected component: ${component.name} (${component.type})`);
    } else {
      console.warn(`[ProjectExplorer] No component found for ${extension}`);
    }

    return component;
  }

  // FILE OPERATIONS AND EVENTS

  /**
   * Open a file in a tab through TabManager
   */
  async openFileInTab(file, path) {
    console.log(`[ProjectExplorer] Opening file in tab: ${file.name} at ${path}`);
    
    // Get TabManager through the service container or gameEmulator
    const tabManager = window.serviceContainer?.get?.('tabManager') || window.gameEmulator?.tabManager;
    
    if (!tabManager) {
      console.warn('[ProjectExplorer] TabManager not available for opening file');
      return;
    }

    try {
      // Ensure we pass full path including filename
      const fullPath = path.endsWith(file.name) ? path : `${path}/${file.name}`;
      
      // Get the appropriate component for this file type - use full path for path-aware routing
      const componentInfo = this._getComponentForFile(fullPath, false); // preferEditor = false for auto-open
      console.log('[ProjectExplorer] Using component for auto-open:', componentInfo?.name);
      
      await tabManager.openInTab(fullPath, componentInfo);

      // Small delay to ensure DOM is updated before tree operations
      setTimeout(() => {
        // Expand tree view and select the file
        this.expandToPath(path);
        this.selectFile(path, file.name);
      }, 100);
      
    } catch (error) {
      console.error(`[ProjectExplorer] Failed to open file ${file.name} in tab:`, error);
    }
  }

  /**
   * Emit a file added event for other components to listen to
   */
  emitFileAddedEvent(file, path) {
    console.log(`[ProjectExplorer] Emitting file added event: ${file.name} at ${path}`);
    
    // Create custom event with file details
    const event = new CustomEvent('projectFileAdded', {
      detail: {
        file: file,
        path: path,
        fullPath: path.endsWith(file.name) ? path : `${path}/${file.name}`,
        extension: this.getFileExtension(file.name),
        timestamp: Date.now()
      }
    });

    // Emit to document for global listening
    document.dispatchEvent(event);
    
    // Also emit general refresh event for components that need to update their file lists
    this.emitFileListRefreshEvent();
  }

  /**
   * Get filtered list of files from the focused project
   * @param {string} folder - Folder name to filter by (e.g., "Palettes", "Images", "Music")
   * @param {string|Array} extensions - File extensions to filter by (e.g., ".pal", [".png", ".jpg"])
   * @param {string} projectName - Optional project name, defaults to focused project
   * @returns {Array} Array of file objects with name, path, fullPath properties
   */
  GetFiles(folder = null, extensions = null, projectName = null) {
    const project = projectName || this.getFocusedProjectName();
    if (!project) {
      console.warn('[ProjectExplorer] No project available for GetFiles');
      return [];
    }

    const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
    const projectStructure = this.projectData.structure[project];
    
    if (!projectStructure) {
      console.warn(`[ProjectExplorer] Project '${project}' not found`);
      return [];
    }

    const files = [];
    
    // Helper function to recursively collect files
    const collectFiles = (node, currentPath) => {
      if (!node || !node.children) return;
      
      Object.keys(node.children).forEach(key => {
        const child = node.children[key];
        const childPath = currentPath ? `${currentPath}/${key}` : key;
        
        if (child.type === 'file') {
          // Check if we should include this file
          let shouldInclude = true;
          
          // Filter by folder if specified
          if (folder && !currentPath.includes(folder)) {
            shouldInclude = false;
          }
          
          // Filter by extensions if specified
          if (shouldInclude && extensions) {
            const fileExt = this.getFileExtension(key);
            const extArray = Array.isArray(extensions) ? extensions : [extensions];
            shouldInclude = extArray.some(ext => 
              ext === '*' || fileExt.toLowerCase() === ext.toLowerCase()
            );
          }
          
          if (shouldInclude) {
            files.push({
              name: key,
              path: currentPath,
              fullPath: childPath,
              extension: this.getFileExtension(key),
              type: 'file'
            });
          }
        } else if (child.type === 'folder') {
          // Recursively search subfolders
          collectFiles(child, childPath);
        }
      });
    };
    
    // Start collecting from the sources root
    if (projectStructure.children && projectStructure.children[sourcesRoot]) {
      collectFiles(projectStructure.children[sourcesRoot], `${project}/${sourcesRoot}`);
    }
    
    console.log(`[ProjectExplorer] GetFiles(${folder}, ${extensions}) found ${files.length} files:`, files);
    return files;
  }

  /**
   * Get all files from the Sources folder, optionally filtered by subfolder
   * @param {string} subfolder - Optional subfolder name (e.g., "Palettes", "Images", "Music", "SFX", "Lua", "Binary")
   * @param {string} projectName - Optional project name, defaults to focused project
   * @returns {Array} Array of file objects
   */
  GetSourceFiles(subfolder = null, projectName = null) {
    const project = projectName || this.getFocusedProjectName();
    if (!project) {
      console.warn('[ProjectExplorer] No project available for GetSourceFiles');
      return [];
    }

    const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
    const projectStructure = this.projectData.structure[project];
    
    if (!projectStructure || !projectStructure.children || !projectStructure.children[sourcesRoot]) {
      console.warn(`[ProjectExplorer] Sources folder not found in project '${project}'`);
      return [];
    }

    const files = [];
    const sourcesNode = projectStructure.children[sourcesRoot];
    
    // Helper function to recursively collect files
    const collectFiles = (node, currentPath) => {
      if (!node || !node.children) return;
      
      Object.keys(node.children).forEach(key => {
        const child = node.children[key];
        const childPath = currentPath ? `${currentPath}/${key}` : key;
        
        if (child.type === 'file') {
          files.push({
            name: key,
            path: currentPath,
            fullPath: childPath,
            extension: this.getFileExtension(key),
            type: 'file',
            folder: currentPath.split('/').pop() // Get the immediate parent folder name
          });
        } else if (child.type === 'folder') {
          collectFiles(child, childPath);
        }
      });
    };
    
    if (subfolder) {
      // Get files from specific subfolder
      if (sourcesNode.children && sourcesNode.children[subfolder]) {
        const subfolderPath = `${project}/${sourcesRoot}/${subfolder}`;
        collectFiles(sourcesNode.children[subfolder], subfolderPath);
      } else {
        console.warn(`[ProjectExplorer] Subfolder '${subfolder}' not found in Sources`);
      }
    } else {
      // Get all files from Sources
      collectFiles(sourcesNode, `${project}/${sourcesRoot}`);
    }
    
    console.log(`[ProjectExplorer] GetSourceFiles(${subfolder}) found ${files.length} files`);
    return files;
  }

  /**
   * Get all files from the Build folder, optionally filtered by subfolder
   * @param {string} subfolder - Optional subfolder name
   * @param {string} projectName - Optional project name, defaults to focused project
   * @returns {Array} Array of file objects
   */
  GetBuildFiles(subfolder = null, projectName = null) {
    const project = projectName || this.getFocusedProjectName();
    if (!project) {
      console.warn('[ProjectExplorer] No project available for GetBuildFiles');
      return [];
    }

    const buildRoot = (window.ProjectPaths && window.ProjectPaths.getBuildRootUi) ? window.ProjectPaths.getBuildRootUi() : 'Build';
    const projectStructure = this.projectData.structure[project];
    
    if (!projectStructure || !projectStructure.children || !projectStructure.children[buildRoot]) {
      console.warn(`[ProjectExplorer] Build folder not found in project '${project}'`);
      return [];
    }

    const files = [];
    const buildNode = projectStructure.children[buildRoot];
    
    // Helper function to recursively collect files
    const collectFiles = (node, currentPath) => {
      if (!node || !node.children) return;
      
      Object.keys(node.children).forEach(key => {
        const child = node.children[key];
        const childPath = currentPath ? `${currentPath}/${key}` : key;
        
        if (child.type === 'file') {
          files.push({
            name: key,
            path: currentPath,
            fullPath: childPath,
            extension: this.getFileExtension(key),
            type: 'file',
            folder: currentPath.split('/').pop()
          });
        } else if (child.type === 'folder') {
          collectFiles(child, childPath);
        }
      });
    };
    
    if (subfolder) {
      // Get files from specific subfolder
      if (buildNode.children && buildNode.children[subfolder]) {
        const subfolderPath = `${project}/${buildRoot}/${subfolder}`;
        collectFiles(buildNode.children[subfolder], subfolderPath);
      } else {
        console.warn(`[ProjectExplorer] Subfolder '${subfolder}' not found in Build`);
      }
    } else {
      // Get all files from Build
      collectFiles(buildNode, `${project}/${buildRoot}`);
    }
    
    console.log(`[ProjectExplorer] GetBuildFiles(${subfolder}) found ${files.length} files`);
    return files;
  }

  // Convenience methods for specific source folders
  /**
   * Get all palette files from Sources/Palettes
   */
  GetPaletteFiles(projectName = null) {
    return this.GetSourceFiles('Palettes', projectName);
  }

  /**
   * Get all image files from Sources/Images
   */
  GetImageFiles(projectName = null) {
    return this.GetSourceFiles('Images', projectName);
  }

  /**
   * Get all music files from Sources/Music
   */
  GetMusicFiles(projectName = null) {
    return this.GetSourceFiles('Music', projectName);
  }

  /**
   * Get all sound effect files from Sources/SFX
   */
  GetSFXFiles(projectName = null) {
    return this.GetSourceFiles('SFX', projectName);
  }

  /**
   * Get all Lua script files from Sources/Lua
   */
  GetLuaFiles(projectName = null) {
    return this.GetSourceFiles('Lua', projectName);
  }

  /**
   * Get all binary files from Sources/Binary
   */
  GetBinaryFiles(projectName = null) {
    return this.GetSourceFiles('Binary', projectName);
  }

  /**
   * Emit a refresh event when file lists need to be updated
   */
  emitFileListRefreshEvent() {
    console.log('[ProjectExplorer] Emitting file list refresh event');
    
    const event = new CustomEvent('projectFileListRefresh', {
      detail: {
        project: this.getFocusedProjectName(),
        timestamp: Date.now()
      }
    });

    document.dispatchEvent(event);
  }

  /**
   * Emit refresh event when files are deleted
   */
  emitFileDeletedEvent(fileName, path) {
    console.log(`[ProjectExplorer] Emitting file deleted event: ${fileName} at ${path}`);
    
    const event = new CustomEvent('projectFileDeleted', {
      detail: {
        fileName: fileName,
        path: path,
        fullPath: path.endsWith(fileName) ? path : `${path}/${fileName}`,
        extension: this.getFileExtension(fileName),
        timestamp: Date.now()
      }
    });

    document.dispatchEvent(event);
    
    // Also emit general refresh event
    this.emitFileListRefreshEvent();
  }

  /**
   * Emit refresh event when files are renamed
   */
  emitFileRenamedEvent(oldName, newName, path) {
    console.log(`[ProjectExplorer] Emitting file renamed event: ${oldName} -> ${newName} at ${path}`);
    
    const event = new CustomEvent('projectFileRenamed', {
      detail: {
        oldName: oldName,
        newName: newName,
        path: path,
        fullPath: path.endsWith(newName) ? path : `${path}/${newName}`,
        extension: this.getFileExtension(newName),
        timestamp: Date.now()
      }
    });

    document.dispatchEvent(event);
    
    // Also emit general refresh event
    this.emitFileListRefreshEvent();
  }

  // Check if a file is a palette file based on its extension
  isPaletteFile(filePath) {
    if (!filePath) return false;
    const extension = filePath.split('.').pop().toLowerCase();
    return ['pal', 'act', 'aco'].includes(extension);
  }

  // Set the specified palette as the default
  async setDefaultPalette(palettePath) {
    if (!window.ProjectConfigManager) {
      console.error('[ProjectExplorer] ProjectConfigManager not available');
      return;
    }

    if (!this.isPaletteFile(palettePath)) {
      console.error('[ProjectExplorer] File is not a palette:', palettePath);
      return;
    }

    // Convert full path to storage path (remove project prefix)
    const pp = window.ProjectPaths?.parseProjectPath ? window.ProjectPaths.parseProjectPath(palettePath) : { project: null, rest: palettePath };
    const storagePath = pp.rest || palettePath;
    console.log(`[ProjectExplorer] Converting palette path for storage: ${palettePath} -> ${storagePath}`);

    // Set in project config manager
    await window.ProjectConfigManager.setDefaultPalette(storagePath);
    console.log(`[ProjectExplorer] Set default palette: ${storagePath}`);

    // Update visual indicators
    this.updatePaletteFileVisuals();

    // Show user feedback
    if (window.application && window.application.showToast) {
      const fileName = palettePath.split('/').pop();
      window.application.showToast(`Default palette set to: ${fileName}`, 'success');
    }
  }

  // Get the current default palette
  getDefaultPalette() {
    if (!window.ProjectConfigManager) {
      console.warn('[ProjectExplorer] ProjectConfigManager not available');
      return null;
    }

    const defaultPalettePath = window.ProjectConfigManager.getDefaultPalette();
    if (!defaultPalettePath) {
      console.log('[ProjectExplorer] No default palette set');
      return null;
    }

    // Load and return the actual Palette object
    try {
      // TODO: Load the palette file from storage and return Palette object
      // For now, return the path until we implement palette loading
      console.log(`[ProjectExplorer] Default palette path: ${defaultPalettePath}`);
      return defaultPalettePath; // Temporary - should return Palette object
    } catch (error) {
      console.error('[ProjectExplorer] Error loading default palette:', error);
      return null;
    }
  }

  // Get the default palette storage path
  async getDefaultPalettePath() {
    if (!window.ProjectConfigManager) {
      console.warn('[ProjectExplorer] ProjectConfigManager not available');
      return null;
    }

    const defaultPalette = await window.ProjectConfigManager.getDefaultPalette();
    if (!defaultPalette) {
      console.log('[ProjectExplorer] No default palette path set');
      return null;
    }

    // Ensure we have a string (ProjectConfigManager should return string path)
    if (typeof defaultPalette !== 'string') {
      console.error('[ProjectExplorer] Expected string path from ProjectConfigManager, got:', typeof defaultPalette, defaultPalette);
      return null;
    }

    // Return the storage path (no project prefix) for consistency with sourceImage paths
    // This makes texture files more portable between projects
    return defaultPalette;
  }

  // Initialize project configuration when project is loaded/created
  async initializeProjectConfig() {
    console.log('[ProjectExplorer] Initializing project configuration');
    
    if (!window.ProjectConfigManager) {
      console.error('[ProjectExplorer] ProjectConfigManager not available');
      return;
    }
    
    try {
      // Initialize config with write-through behavior (auto-creates if needed)
      await window.ProjectConfigManager.initializeForProject();
      console.log('[ProjectExplorer] Project configuration initialized');
      
      // Update UI to show config changes
      this.updatePaletteFileVisuals();
    } catch (error) {
      console.error('[ProjectExplorer] Failed to initialize project config:', error);
    }
  }

  // Clear the default palette
  async clearDefaultPalette() {
    if (!window.ProjectConfigManager) {
      console.error('[ProjectExplorer] ProjectConfigManager not available');
      return;
    }

    // Clear in project config manager (write-through)
    await window.ProjectConfigManager.clearDefaultPalette();
    console.log('[ProjectExplorer] Cleared default palette');

    // Update visual indicators
    this.updatePaletteFileVisuals();

    // Show user feedback
    if (window.application && window.application.showToast) {
      window.application.showToast('Default palette cleared', 'info');
    }
  }

  // Initialize project configuration after project is fully loaded into storage
  async initializeProjectConfig() {
    if (!window.ProjectConfigManager || !this.focusedProjectName) {
      return;
    }

    const projectName = this.focusedProjectName;
    console.log('[ProjectExplorer] Initializing config for project:', projectName);

    // Step 1: Initialize the config manager for this project (will create config if doesn't exist)
    await window.ProjectConfigManager.initializeForProject(projectName);

    // Add config file to project structure if it doesn't exist there
    const configPath = 'Sources/config.json';
    if (!this.doesFileExist(`${projectName}/${configPath}`)) {
      this.addFileToProjectStructure(projectName, configPath, { type: 'file' });
      console.log('[ProjectExplorer] Added config file to project structure:', configPath);
    }

    // Step 2: Get the current default palette from config
    const configDefaultPalette = await window.ProjectConfigManager.getDefaultPalette();
    console.log('[ProjectExplorer] Config default palette:', configDefaultPalette);

    // Step 3: Get all palette files from the project structure (already rendered)
    const paletteFileObjects = this.GetSourceFiles('Palettes');
    const paletteFiles = paletteFileObjects
      .filter(file => this.isPaletteFileByName(file.name))
      .map(file => `Sources/Palettes/${file.name}`);
    console.log('[ProjectExplorer] Found palette files:', paletteFiles);

    // Step 4: Validate and set default palette
    let needsNewDefault = false;
    
    if (!configDefaultPalette) {
      console.log('[ProjectExplorer] No default palette set in config');
      needsNewDefault = true;
    } else if (!paletteFiles.includes(configDefaultPalette)) {
      console.log('[ProjectExplorer] Config default palette does not exist in project:', configDefaultPalette);
      needsNewDefault = true;
    }

    if (needsNewDefault) {
      if (paletteFiles.length > 0) {
        // Set first available palette as default
        const newDefault = paletteFiles[0];
        console.log('[ProjectExplorer] Setting first palette as default:', newDefault);
        await window.ProjectConfigManager.setDefaultPalette(newDefault);
      } else {
        // Create a default palette file
        console.log('[ProjectExplorer] No palettes found, creating default palette');
        await this.createDefaultPalette();
      }
    }

    console.log('[ProjectExplorer] Project config initialization complete');
    
    // Re-render tree to show config file and update visuals
    this.renderTree();
    this.updatePaletteFileVisuals();
  }

  // Create a default palette file when none exists
  async createDefaultPalette() {
    try {
      // Create a basic default palette (16 colors, Pico-8 style)
      const defaultPaletteData = this.generateDefaultPaletteData();
      const defaultPath = 'Sources/Palettes/default.act';
      
      // Save the palette file
      await window.fileIOService.saveFile(defaultPath, defaultPaletteData, { binaryData: true, builderId: 'pal' });
      
      // Add to project structure
      this.addFileToProjectStructure(this.focusedProjectName, defaultPath, { type: 'file' });
      
      // Set as default in config
      await window.ProjectConfigManager.setDefaultPalette(defaultPath);
      
      // Refresh the UI
      this.renderTree();
      
      console.log('[ProjectExplorer] Created default palette:', defaultPath);
    } catch (error) {
      console.error('[ProjectExplorer] Error creating default palette:', error);
    }
  }

  // Generate default palette data (basic 16-color palette)
  generateDefaultPaletteData() {
    // Create a simple 16-color palette in ACT format (3 bytes per color, 768 bytes total)
    const palette = new Uint8Array(768);
    const colors = [
      [0, 0, 0],       // Black
      [29, 43, 83],    // Dark blue
      [126, 37, 83],   // Dark purple
      [0, 135, 81],    // Dark green
      [171, 82, 54],   // Brown
      [95, 87, 79],    // Dark grey
      [194, 195, 199], // Light grey
      [255, 241, 232], // White
      [255, 0, 77],    // Red
      [255, 163, 0],   // Orange
      [255, 236, 39],  // Yellow
      [0, 228, 54],    // Green
      [41, 173, 255],  // Blue
      [131, 118, 156], // Indigo
      [255, 119, 168], // Pink
      [255, 204, 170]  // Peach
    ];
    
    // Fill the palette (repeat the 16 colors to fill 256 slots)
    for (let i = 0; i < 256; i++) {
      const colorIndex = i % colors.length;
      const baseIndex = i * 3;
      palette[baseIndex] = colors[colorIndex][0];     // R
      palette[baseIndex + 1] = colors[colorIndex][1]; // G
      palette[baseIndex + 2] = colors[colorIndex][2]; // B
    }
    
    return palette.buffer;
  }

  // Update visual indicators for palette files
  async updatePaletteFileVisuals() {
    console.log('[ProjectExplorer] updatePaletteFileVisuals called');
    
    if (!window.ProjectConfigManager) {
      console.log('[ProjectExplorer] ProjectConfigManager not available');
      return;
    }
    
    const defaultPalette = await window.ProjectConfigManager.getDefaultPalette();
    console.log('[ProjectExplorer] Current default palette:', defaultPalette);

    // Remove existing indicators
    const existingIndicators = this.treeContainer.querySelectorAll('.default-palette-indicator');
    console.log('[ProjectExplorer] Removing', existingIndicators.length, 'existing indicators');
    existingIndicators.forEach(indicator => indicator.remove());

    if (!defaultPalette) {
      console.log('[ProjectExplorer] No default palette set');
      return;
    }

    // Add indicator to the default palette file
    const defaultPaletteFullPath = await this.getDefaultPalettePath();
    if (!defaultPaletteFullPath) {
      console.log('[ProjectExplorer] Could not determine full path for default palette');
      return;
    }

    // Find the file element and add indicator
    const fileElements = this.treeContainer.querySelectorAll('.tree-item[data-type="file"]');
    console.log('[ProjectExplorer] Checking', fileElements.length, 'file elements for default palette match');
    
    fileElements.forEach(element => {
      const filePath = element.getAttribute('data-path');
      if (this.isPaletteFile(filePath)) {
        const isMatch = filePath === defaultPaletteFullPath;
        console.log('[ProjectExplorer] Palette file:', filePath, 'isMatch:', isMatch);
        
        if (isMatch) {
          // Add default indicator
          const indicator = document.createElement('span');
          indicator.className = 'default-palette-indicator';
          indicator.innerHTML = ' ⭐';
          indicator.title = 'Default Palette';
          indicator.style.color = '#ffd700';
          indicator.style.fontWeight = 'bold';
          
          const fileName = element.querySelector('.tree-label');
          if (fileName && !fileName.querySelector('.default-palette-indicator')) {
            fileName.appendChild(indicator);
            console.log('[ProjectExplorer] Added default palette indicator to:', filePath);
          }
        }
      }
    });
  }

  // Auto-promote single palette to default if none is set
  async checkAndAutoPromoteSinglePalette() {
    console.log('[ProjectExplorer] checkAndAutoPromoteSinglePalette called');
    
    if (!window.ProjectConfigManager) {
      console.log('[ProjectExplorer] ProjectConfigManager not available for auto-promotion');
      return;
    }
    
    try {
      // Check if we already have a default palette
      const currentDefault = window.ProjectConfigManager.getDefaultPalette();
      console.log('[ProjectExplorer] Current default palette for auto-promotion check:', currentDefault);
      
      if (currentDefault) {
        console.log('[ProjectExplorer] Default palette already exists, skipping auto-promotion');
        return; // Already have a default
      }
      
      // Find all palette files in the project
      const paletteFiles = this.getAllPaletteFiles();
      console.log('[ProjectExplorer] Found palette files:', paletteFiles);
      
      // If exactly one palette file exists, promote it to default
      if (paletteFiles.length === 1) {
        const fullPalettePath = paletteFiles[0];
        console.log('[ProjectExplorer] Auto-promoting single palette to default:', fullPalettePath);
        
        // Convert full path to storage path (remove project prefix)
        const pp = window.ProjectPaths?.parseProjectPath ? window.ProjectPaths.parseProjectPath(fullPalettePath) : { project: null, rest: fullPalettePath };
        const storagePath = pp.rest || fullPalettePath;
        console.log('[ProjectExplorer] Storage path for auto-promotion:', storagePath);
        
        await window.ProjectConfigManager.setDefaultPalette(storagePath);
        console.log(`[ProjectExplorer] Auto-promoted single palette to default: ${storagePath}`);
      } else {
        console.log('[ProjectExplorer] Not auto-promoting -', paletteFiles.length, 'palette files found');
      }
    } catch (error) {
      console.error('[ProjectExplorer] Error during auto-promotion:', error);
    }
    
    // Only ensure config file if it doesn't exist (to prevent race conditions)
    const focusedProject = this.getFocusedProjectName();
    if (focusedProject) {
      const configPath = `${focusedProject}/Sources/config.json`;
      const storagePath = window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(configPath) : 'Sources/config.json';
      
      // Check if config already exists in storage before trying to create it
      if (window.fileIOService) {
        try {
          const existingConfig = await window.fileIOService.loadFile(storagePath);
          if (!existingConfig) {
            this.ensureConfigFile(focusedProject);
          }
        } catch (e) {
          // File doesn't exist, create it
          this.ensureConfigFile(focusedProject);
        }
      }
    }
  }

  // Get all palette files in the current project
  getAllPaletteFiles() {
    const paletteFiles = [];
    const fileElements = this.treeContainer.querySelectorAll('.tree-item[data-type="file"]');
    
    fileElements.forEach(element => {
      const filePath = element.getAttribute('data-path');
      if (this.isPaletteFile(filePath)) {
        // Convert from project path (e.g., "test/Sources/Palettes/file.act") 
        // to storage path (e.g., "Sources/Palettes/file.act")
        const storagePath = this.convertProjectPathToStoragePath(filePath);
        if (storagePath) {
          paletteFiles.push(storagePath);
        }
      }
    });
    
    return paletteFiles;
  }

  // Get all palette files from storage (not UI)
  async getAllPaletteFilesFromStorage() {
    const paletteFiles = [];
    
    if (!window.fileIOService) {
      console.log('[ProjectExplorer] FileIOService not available');
      return paletteFiles;
    }

    try {
      // Get all files from storage in the Palettes folder
      const allFiles = await window.fileIOService.listFiles();
      
      for (const filePath of allFiles) {
        // Check if this is a palette file in the Sources/Palettes folder
        if (filePath.startsWith('Sources/Palettes/') && this.isPaletteFileByName(filePath)) {
          paletteFiles.push(filePath);
        }
      }
    } catch (error) {
      console.error('[ProjectExplorer] Error getting palette files from storage:', error);
    }

    return paletteFiles;
  }

  // Helper to check if a file is a palette file by name/extension
  isPaletteFileByName(fileName) {
    if (!fileName) return false;
    const ext = this.getFileExtension(fileName).toLowerCase();
    return ['.pal', '.act', '.aco'].includes(ext);
  }

  // Convert project path to storage path
  convertProjectPathToStoragePath(projectPath) {
    if (!projectPath || !this.focusedProjectName) return null;
    
    // Remove project name prefix: "test/Sources/Palettes/file.act" -> "Sources/Palettes/file.act"
    const prefix = this.focusedProjectName + '/';
    if (projectPath.startsWith(prefix)) {
      return projectPath.substring(prefix.length);
    }
    
    return null;
  }

  // Helper method to add a file directly to the project structure
  addFileToProjectStructure(projectName, filePath, metadata) {
    if (!this.projectData.structure[projectName]) {
      console.error('[ProjectExplorer] Project not found:', projectName);
      return;
    }

    const parts = filePath.split('/');
    const fileName = parts.pop(); // Remove and get the filename
    const folderPath = parts; // Remaining parts are the folder path
    
    let current = this.projectData.structure[projectName].children;
    
    // Navigate to the target folder, creating missing folders as needed
    for (const part of folderPath) {
      if (!current[part]) {
        current[part] = {
          type: 'folder',
          children: {}
        };
      }
      current = current[part].children;
    }
    
    // Add the file
    current[fileName] = {
      type: 'file',
      path: `${projectName}/${filePath}`,
      ...metadata
    };
  }

  // Check if the current default palette is valid
  isDefaultPaletteValid() {
    if (!window.ProjectConfigManager) return false;
    
    const defaultPalette = window.ProjectConfigManager.getDefaultPalette();
    if (!defaultPalette) return false;
    
    // Check if the file still exists in the project
    return this.doesFileExist(defaultPalette);
  }

  // Helper method to check if a file exists in the current project
  doesFileExist(filePath) {
    const fileElements = this.treeContainer.querySelectorAll('.tree-item[data-type="file"]');
    for (const element of fileElements) {
      if (element.getAttribute('data-path') === filePath) {
        return true;
      }
    }
    return false;
  }

  // Linked file functionality for image/texture pairs
  getLinkedFileName(filename) {
    const baseName = filename.substring(0, filename.lastIndexOf('.'));
    const ext = this.getFileExtension(filename).toLowerCase();
    
    // Return the linked file extension
    if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(ext)) {
      return baseName + '.texture';
    } else if (ext === '.texture') {
      return baseName + '.png'; // Default to PNG for linked image
    }
    
    return null;
  }

  findLinkedFile(filename) {
    const linkedName = this.getLinkedFileName(filename);
    if (!linkedName) return null;
    
    try {
      // Check if linked file exists in project structure
      if (!this.projectData?.structure) return null;
      
      // Search for linked file in project structure
      const searchInNode = (node, path = '') => {
        if (!node) return null;
        
        for (const [name, data] of Object.entries(node)) {
          const currentPath = path ? `${path}/${name}` : name;
          
          if (data.type === 'file' && name === linkedName) {
            return linkedName;
          } else if (data.type === 'folder' && data.children) {
            const found = searchInNode(data.children, currentPath);
            if (found) return found;
          }
        }
        return null;
      };
      
      return searchInNode(this.projectData.structure);
    } catch (error) {
      console.warn('[ProjectExplorer] Error finding linked file:', error);
    }
    
    return null;
  }

  isLinkedFile(filename) {
    return this.findLinkedFile(filename) !== null;
  }

  // Helper method to check if a file is an image
  isImageFile(filename) {
    const ext = this.getFileExtension(filename).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tga'].includes(ext);
    return isImage;
  }

  // Open texture editor for new image files by creating a .texture file and opening it
  async openTextureEditorForImage(imageUIPath, imagePath, imageFileName) {
    try {
      console.log('[ProjectExplorer] Creating texture file for new image:', imageFileName);
      
      // Calculate texture file path
      const baseName = imageFileName.substring(0, imageFileName.lastIndexOf('.'));
      const textureFileName = baseName + '.texture';
      const textureUIPath = imagePath + '/' + textureFileName;
      
      // Convert UI path to storage path
      const textureStoragePath = window.ProjectPaths?.normalizeStoragePath ? 
        window.ProjectPaths.normalizeStoragePath(textureUIPath) : textureUIPath;
      
      // Check if texture file already exists
      if (window.fileIOService) {
        try {
          const existingTexture = await window.fileIOService.loadFile(textureStoragePath);
          if (existingTexture) {
            console.log('[ProjectExplorer] Texture file already exists, opening existing:', textureFileName);
            // Open existing texture file - let component registry determine the editor
            if (window.TabManager) {
              window.TabManager.openFile(textureStoragePath);
            }
            return;
          }
        } catch (e) {
          // File doesn't exist, proceed with creating new texture file
        }
      }
      
      // Create a minimal .texture file that the texture editor can populate
      const newTextureData = {
        sourceImagePath: imageFileName,
        metadata: {
          created: new Date().toISOString(),
          sourceImagePath: imageUIPath
        }
      };
      
      const textureContent = JSON.stringify(newTextureData, null, 2);
      
      // Save the new texture file
      if (window.fileIOService) {
        await window.fileIOService.saveFile(textureStoragePath, textureContent);
        console.log('[ProjectExplorer] Created new texture file:', textureStoragePath);
        
        // Add to project structure
        this.addFileToProject({ 
          name: textureFileName, 
          size: textureContent.length,
          lastModified: Date.now(),
          originalPath: textureUIPath
        }, imagePath, true, true);
        
        // Don't auto-open the texture file since the source image is already being opened in texture editor
        // The texture editor will handle the creation and linking of the texture file
        console.log('[ProjectExplorer] Texture file created, letting texture editor handle it:', textureStoragePath);
        
        this.renderTree();
      }
      
    } catch (error) {
      console.error('[ProjectExplorer] Error creating texture file for image:', error);
    }
  }

  // Public method to refresh the project explorer display
  refresh() {
    console.log('[ProjectExplorer] Refreshing display...');
    this.renderTree();
  }
}

// Export for use
window.ProjectExplorer = ProjectExplorer;
