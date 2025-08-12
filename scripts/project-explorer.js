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
              filter: [".wav"],
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
    
    // Global drag and drop
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      // Add visual feedback for drag over
      document.body.classList.add('drag-over');
    });
    
    document.addEventListener('dragleave', (e) => {
      // Only remove if we're leaving the document entirely
      if (!e.relatedTarget || e.relatedTarget.nodeName === 'HTML') {
        document.body.classList.remove('drag-over');
      }
    });
    
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      // Remove visual feedback
      document.body.classList.remove('drag-over');
      // Handle file drops anywhere on the page
      this.handleFileDrop(e);
    });
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
      icon.textContent = this.getFileIconSymbol(name, data.type);
      
      // Label
      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = name;
      
      item.appendChild(expand);
      item.appendChild(icon);
      item.appendChild(label);
      
      // Event listeners
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        // Don't auto-select here - let tab manager control highlighting via highlightActiveFile
        
        // Show in preview if it's a file
        if (data.type === 'file' && window.tabManager) {
          window.tabManager.previewResource(data.file, currentPath);
        }
      });
      
      item.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        
        // Open in new tab if it's a file
        if (data.type === 'file' && window.tabManager) {
          window.tabManager.openInNewTab(data.file, currentPath);
        } else if (data.type === 'folder') {
          // Toggle folder on double-click
          this.toggleNode(li, expand);
        }
      });
      
      item.addEventListener('contextmenu', (e) => {
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
  
  getFileIconSymbol(name, type) {
    if (type === 'folder') return '📁';
    
    const ext = this.getFileExtension(name).toLowerCase();
    if (['.mod', '.xm', '.s3m', '.it', '.mptm'].includes(ext)) return '🎵';
    if (['.wav'].includes(ext)) return '🔊';
    
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
    this.contextMenu.style.display = 'block';
    this.contextMenu.style.left = `${x}px`;
    this.contextMenu.style.top = `${y}px`;
  }
  
  hideContextMenu() {
    this.contextMenu.style.display = 'none';
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
  
  addFiles(files, targetPath) {
    let lastAddedFile = null;
    let lastAddedPath = null;
    
    for (const file of files) {
      const filtered = this.filterFile(file, targetPath);
      if (filtered.allowed) {
        this.addFileToProject(file, filtered.path);
        lastAddedFile = file;
        lastAddedPath = filtered.path;
      } else {
        console.warn(`[ProjectExplorer] File ${file.name} not allowed in ${targetPath}. Redirected to ${filtered.path || 'nowhere'}`);
        if (filtered.path) {
          this.addFileToProject(file, filtered.path);
          lastAddedFile = file;
          lastAddedPath = filtered.path;
        }
      }
    }
    
    // Re-render tree after all files are added
    this.renderTree();
    
    // Only highlight the last added file to avoid multiple selections
    if (lastAddedFile && lastAddedPath) {
      setTimeout(() => {
        this.expandToPath(lastAddedPath);
        // Don't auto-select files - let tab manager control highlighting
        console.log(`[ProjectExplorer] Expanded to show last added file: ${lastAddedFile.name}`);
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
    }
    
    // Default unrecognized files to Binary folder
    return { allowed: true, path: 'Resources/Binary' };
  }
  
  addFileToProject(file, path) {
    const parts = path.split('/');
    let current = this.projectData.structure;
    
    // Navigate to the target folder
    for (const part of parts) {
      if (current[part] && current[part].type === 'folder') {
        current = current[part].children;
      }
    }
    
    // Add the file
    current[file.name] = {
      type: 'file',
      file: file,
      size: file.size,
      lastModified: file.lastModified
    };
    
    console.log(`[ProjectExplorer] Added file: ${file.name} to ${path}`);
    
    // Notify game editor if available
    if (window.gameEditor) {
      window.gameEditor.onFileAdded(file, path, false);
    }
  }
  
  getNodeByPath(path) {
    const parts = path.split('/');
    let current = this.projectData.structure;
    
    for (const part of parts) {
      if (current[part]) {
        if (current[part].type === 'folder') {
          current = current[part];
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
  
  deleteNode(path) {
    if (confirm(`Are you sure you want to delete "${path}"?`)) {
      const parts = path.split('/');
      const fileName = parts.pop();
      let current = this.projectData.structure;
      
      for (const part of parts) {
        if (current[part] && current[part].type === 'folder') {
          current = current[part].children;
        }
      }
      
      delete current[fileName];
      this.renderTree();
      console.log(`[ProjectExplorer] Deleted: ${path}`);
    }
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
  highlightActiveFile(filename) {
    console.log(`[ProjectExplorer] Highlighting active file: ${filename}`);
    
    // Always clear all current selections first
    const allSelected = this.treeContainer.querySelectorAll('.tree-item.selected');
    allSelected.forEach(item => {
      item.classList.remove('selected');
      console.log(`[ProjectExplorer] Removed selection from: ${item.dataset.path}`);
    });
    this.selectedNode = null;
    
    if (!filename) {
      console.log(`[ProjectExplorer] No filename provided, cleared all selections`);
      return;
    }
    
    // Find the tree item with this filename
    const allItems = this.treeContainer.querySelectorAll('.tree-item[data-type="file"]');
    for (const item of allItems) {
      const path = item.dataset.path;
      const itemFilename = path.substring(path.lastIndexOf('/') + 1);
      if (itemFilename === filename) {
        item.classList.add('selected');
        this.selectedNode = item;
        console.log(`[ProjectExplorer] Selected file: ${filename} at ${path}`);
        break;
      }
    }
  }

  // Expand tree view to show a specific path
  expandToPath(path) {
    console.log(`[ProjectExplorer] Expanding to path: ${path}`);
    
    // Debug: show all current data-path attributes
    const allElements = this.treeContainer.querySelectorAll('[data-path]');
    console.log(`[ProjectExplorer] Available data-path elements:`, 
      Array.from(allElements).map(el => el.dataset.path));
    
    const parts = path.split('/').filter(part => part); // Remove empty parts
    
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
}

// Export for use
window.ProjectExplorer = ProjectExplorer;
