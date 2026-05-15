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
              Images: { type: 'folder', filter: ['.png', '.gif', '.jpg', '.jpeg', '.bmp', '.tga', '.texture', '.frameset', '.d2'], children: {} },
              Palettes: { type: 'folder', filter: ['.act', '.pal', '.aco'], children: {} },
              Lua: { type: 'folder', filter: ['.lua', '.txt'], children: {} },
              Sprites: { type: 'folder', filter: ['.sprite'], children: {} },
              Package: { type: 'folder', filter: ['.package', '.png', '.webm', '.mp4'], children: {} },
              Binary: { type: 'folder', filter: ['*'], children: {} }
            }
          },
          [buildRoot]: { type: 'folder', children: {} }
        }
      };
    }
    // Always apply project defaults for newly created/opened projects.
    this.applyTemplateDefaults(projectName).catch((e) => {
      console.warn('[ProjectExplorer] Project defaults setup failed:', e);
    });
    // Re-render if initialized
    if (this.treeContainer) this.renderTree();
  }

  async createDefaultPackageIcon32File() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to create package icon canvas');

    ctx.fillStyle = '#0b132b';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#1c2541';
    ctx.fillRect(2, 2, 28, 28);
    ctx.strokeStyle = '#5bc0be';
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 3, 26, 26);
    ctx.fillStyle = '#e0fbfc';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RW', 16, 17);

    let blob = null;
    if (typeof canvas.toBlob === 'function') {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    }
    if (!blob && typeof canvas.toDataURL === 'function') {
      const dataUrl = canvas.toDataURL('image/png');
      const commaIndex = dataUrl.indexOf(',');
      if (commaIndex > 0) {
        const mimeMatch = dataUrl.substring(0, commaIndex).match(/data:([^;]+);base64/);
        const mime = (mimeMatch && mimeMatch[1]) ? mimeMatch[1] : 'image/png';
        const base64 = dataUrl.substring(commaIndex + 1);
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        blob = new Blob([bytes], { type: mime });
      }
    }
    if (!blob) throw new Error('Failed to encode default package icon32');
    return this.createFileLike([blob], 'icon32.png', 'image/png');
  }

  createFileLike(parts, name, type = 'application/octet-stream') {
    if (typeof File === 'function') {
      return new File(parts, name, { type });
    }
    const blob = new Blob(parts, { type });
    blob.name = name;
    blob.lastModified = Date.now();
    return blob;
  }

  async ensurePackageScaffold(projectName) {
    if (!projectName) return;
    const sourcesRoot = this.getPreferredSourcesRootForProject(projectName);
    await this.ensurePackageScaffoldForRoot(projectName, sourcesRoot);
  }

  getPreferredSourcesRootForProject(projectName) {
    if (!projectName) {
      return (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi)
        ? window.ProjectPaths.getSourcesRootUi()
        : 'Resources';
    }

    const projectNode = this.projectData?.structure?.[projectName];
    const configuredRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi)
      ? window.ProjectPaths.getSourcesRootUi()
      : 'Resources';

    // Prefer whatever root currently exists and has content.
    const hasConfigured = !!projectNode?.children?.[configuredRoot];
    const hasLegacyResources = !!projectNode?.children?.Resources;
    if (hasConfigured) return configuredRoot;
    if (hasLegacyResources) return 'Resources';
    return configuredRoot;
  }

  isManagedPackagePath(path) {
    if (!path || typeof path !== 'string') return false;
    const pp = window.ProjectPaths?.parseProjectPath
      ? window.ProjectPaths.parseProjectPath(path)
      : { rest: path };
    const rest = String(pp.rest || path).replace(/\\/g, '/');
    const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi)
      ? window.ProjectPaths.getSourcesRootUi()
      : 'Sources';
    return rest === `${sourcesRoot}/Package` || rest.startsWith(`${sourcesRoot}/Package/`);
  }

  async ensurePackageScaffoldForRoot(projectName, sourcesRoot) {
    if (!projectName || !sourcesRoot) return;
    const projectNode = this.projectData?.structure?.[projectName];
    if (!projectNode) return;

    if (!projectNode.children[sourcesRoot]) {
      projectNode.children[sourcesRoot] = { type: 'folder', children: {} };
    }
    const srcChildren = projectNode.children[sourcesRoot].children || (projectNode.children[sourcesRoot].children = {});
    if (!srcChildren.Package) {
      srcChildren.Package = { type: 'folder', filter: ['.package', '.png', '.webm', '.mp4'], children: {} };
    }

    const packageFolder = `${projectName}/${sourcesRoot}/Package`;
    const appSettingsPath = `${packageFolder}/app.package`;
    const iconPath = `${packageFolder}/icons/icon32.png`;

    let changed = false;

    if (!this.getNodeByPath(appSettingsPath)) {
      const defaultSettings = {
        formatVersion: 1,
        projectName,
        packageKind: 'rwa',
        title: projectName,
        author: '',
        version: '0.0.1',
        versionCode: 1,
        uniqueId: '',
        category: '',
        targetDeviceSlug: '',
        shortDescription: '',
        description: '',
        releaseChannel: '',
        minFirmwareVersion: '',
        sourceRevision: '',
        buildId: '',
        icons: {
          icon32: `${sourcesRoot}/Package/icons/icon32.png`,
          icon128: ''
        },
        screenshots: [],
        videos: []
      };
      const settingsFile = this.createFileLike([
        JSON.stringify(defaultSettings, null, 2)
      ], 'app.package', 'application/json');
      await this.addFileToProject(settingsFile, packageFolder, true, true);
      changed = true;
    }

    if (!this.getNodeByPath(iconPath)) {
      try {
        const icon = await this.createDefaultPackageIcon32File();
        await this.addFileToProject(icon, `${packageFolder}/icons`, true, true);
        changed = true;
      } catch (e) {
        console.warn('[ProjectExplorer] Failed to scaffold default icon32:', e);
      }
    }

    if (changed) {
      this.renderTree();
    }
  }

  async fetchDefaultAssetAsFile(candidates, outName) {
    for (const url of candidates) {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (!blob || blob.size <= 0) continue;
        return this.createFileLike([blob], outName, blob.type || 'application/octet-stream');
      } catch (_) {
        // Try next candidate path.
      }
    }
    return null;
  }

  async applyTemplateDefaults(projectName) {
    if (!projectName) return;

    const sourcesRoot = this.getPreferredSourcesRootForProject(projectName);
    await this.ensurePackageScaffoldForRoot(projectName, sourcesRoot);

    const defaults = [
      {
        targetPath: `${projectName}/${sourcesRoot}/Palettes`,
        fileName: 'retrowatch_256.act',
        candidates: [
          'templates/defaults/retrowatch_256.act'
        ]
      },
      {
        targetPath: `${projectName}/${sourcesRoot}/Package/icons`,
        fileName: 'icon32.png',
        candidates: [
          'templates/defaults/icon32.png',
          'templates/defaults/package/icon32.png'
        ]
      },
      {
        targetPath: `${projectName}/${sourcesRoot}/Package/screenshots`,
        fileName: 'default.png',
        candidates: [
          'templates/defaults/screenshot.png',
          'templates/defaults/package/screenshot.png'
        ]
      }
    ];

    let changed = false;
    for (const item of defaults) {
      const fullPath = `${item.targetPath}/${item.fileName}`;
      if (this.getNodeByPath(fullPath)) continue;

      const file = await this.fetchDefaultAssetAsFile(item.candidates, item.fileName);
      if (!file) continue;
      await this.addFileToProject(file, item.targetPath, true, true);
      changed = true;
    }

    if (changed) {
      this.renderTree();
    }
  }

  ensurePackageScaffoldForAllProjects() {
    const projectNames = Object.keys(this.projectData?.structure || {});
    for (const projectName of projectNames) {
      this.applyTemplateDefaults(projectName).catch((e) => {
        console.warn(`[ProjectExplorer] Package scaffold backfill failed for ${projectName}:`, e);
      });
    }
  }

  async openPackageSettingsForProject(projectName, preferDedicatedTab = true) {
    if (!projectName) return;

    const sourcesRoot = this.getPreferredSourcesRootForProject(projectName);
    const packagePath = `${projectName}/${sourcesRoot}/Package/app.package`;

    const openNow = async () => {
      const tabManager = window.tabManager || window.gameEmulator?.tabManager;
      if (!tabManager) return false;

      const componentInfo = this._getComponentForFile(packagePath, true);
      if (preferDedicatedTab) {
        await tabManager.openInTab(packagePath, componentInfo || null);
      } else {
        await tabManager.openInPreview(packagePath, componentInfo || null);
      }
      return true;
    };

    // TabManager may not be ready immediately after startup/import wiring.
    try {
      const opened = await openNow();
      if (opened) return;
    } catch (_) {
      // Retry on the next tick.
    }

    setTimeout(() => {
      openNow().catch((e) => {
        console.warn('[ProjectExplorer] Failed to auto-open package settings:', e);
      });
    }, 100);
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
    this.ensurePackageScaffoldForAllProjects();
    
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

  shouldHideNode(currentPath, data) {
    if (!data) {
      return false;
    }

    const pp = window.ProjectPaths?.parseProjectPath
      ? window.ProjectPaths.parseProjectPath(currentPath)
      : { rest: currentPath };
    const rest = String(pp.rest || currentPath).replace(/\\/g, '/');
    const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi)
      ? window.ProjectPaths.getSourcesRootUi()
      : 'Sources';

    if (data.type === 'folder') {
      return rest === `${sourcesRoot}/Package`;
    }

    if (data.type === 'file') {
      return rest === `${sourcesRoot}/config.json`;
    }

    return false;
  }

  shouldExpandNodeByDefault(currentPath, data) {
    if (this.collapsedPaths.has(currentPath)) {
      return false;
    }

    if (!data || data.type !== 'folder') {
      return true;
    }

    const pp = window.ProjectPaths?.parseProjectPath
      ? window.ProjectPaths.parseProjectPath(currentPath)
      : { rest: currentPath };
    const rest = String(pp.rest || currentPath).replace(/\\/g, '/');
    const buildRoot = (window.ProjectPaths && window.ProjectPaths.getBuildRootUi)
      ? window.ProjectPaths.getBuildRootUi()
      : 'Build';

    if (rest === buildRoot) {
      return false;
    }

    return true;
  }

  // Reorganize project structure to show linked texture files as children of image files
  reorganizeLinkedFiles(structure) {
    const reorganized = JSON.parse(JSON.stringify(structure)); // Deep clone
    
    // Function to recursively process folders
    const processFolder = (folderData, currentPath = '') => {
      if (!folderData.children) return folderData;
      
      const imageFiles = {};
      const textureFiles = {};
      const d2Files = {};
      const framesetFiles = {};
      const otherFiles = {};
      
      // First pass: categorize files
      for (const [name, data] of Object.entries(folderData.children)) {
        if (data.type === 'file') {
          const ext = this.getFileExtension(name).toLowerCase();
          if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(ext)) {
            imageFiles[name] = data;
          } else if (ext === '.texture') {
            textureFiles[name] = data;
          } else if (ext === '.d2') {
            d2Files[name] = data;
          } else if (ext === '.frameset') {
            framesetFiles[name] = data;
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
      
      // Process image files and their linked textures / d2 files
      for (const [imageName, imageData] of Object.entries(imageFiles)) {
        const baseName = imageName.substring(0, imageName.lastIndexOf('.'));
        const linkedTextureName = baseName + '.texture';
        const linkedD2Name = baseName + '.d2';
        const linkedFramesetName = baseName + '.frameset';
        
        const hasLinked = textureFiles[linkedTextureName] || d2Files[linkedD2Name] || framesetFiles[linkedFramesetName];
        if (hasLinked) {
          // Create image with linked files as children
          const imageWithChild = JSON.parse(JSON.stringify(imageData));
          imageWithChild.children = {};

          if (textureFiles[linkedTextureName]) {
            const textureData = JSON.parse(JSON.stringify(textureFiles[linkedTextureName]));
            const originalTexturePath = currentPath ? `${currentPath}/${linkedTextureName}` : linkedTextureName;
            textureData.originalPath = originalTexturePath;
            imageWithChild.children[linkedTextureName] = textureData;
            delete textureFiles[linkedTextureName];
          }

          if (framesetFiles[linkedFramesetName]) {
            const framesetData = JSON.parse(JSON.stringify(framesetFiles[linkedFramesetName]));
            const originalFramesetPath = currentPath ? `${currentPath}/${linkedFramesetName}` : linkedFramesetName;
            framesetData.originalPath = originalFramesetPath;
            imageWithChild.children[linkedFramesetName] = framesetData;
            delete framesetFiles[linkedFramesetName];
          }

          if (d2Files[linkedD2Name]) {
            const d2Data = JSON.parse(JSON.stringify(d2Files[linkedD2Name]));
            const originalD2Path = currentPath ? `${currentPath}/${linkedD2Name}` : linkedD2Name;
            d2Data.originalPath = originalD2Path;
            imageWithChild.children[linkedD2Name] = d2Data;
            delete d2Files[linkedD2Name];
          }

          newChildren[imageName] = imageWithChild;
        } else {
          newChildren[imageName] = imageData;
        }
      }
      
      // Add any remaining unlinked texture / frameset / d2 files
      Object.assign(newChildren, textureFiles);
      Object.assign(newChildren, framesetFiles);
      Object.assign(newChildren, d2Files);
      
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
      if (this.shouldHideNode(currentPath, data)) {
        continue;
      }

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
        const shouldExpand = this.shouldExpandNodeByDefault(currentPath, data);
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
          if (data.type === 'folder' && !currentPath.includes('/')) {
            this.openPackageSettingsForProject(name, true).catch((error) => {
              console.warn('[ProjectExplorer] Failed to open package settings from project root click:', error);
            });
            return;
          }

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
      
      // Context menu (right-click)
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const menuPath = data.originalPath || currentPath;
        const menuName = (menuPath && menuPath.includes('/')) ? menuPath.split('/').pop() : name;
        this._showContextMenu(e, data, menuPath, menuName);
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
        if (this.shouldExpandNodeByDefault(currentPath, data)) {
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
        if (name === 'Sprites') return '🎞️';
        if (name === 'Lua') return '📜';
        if (name === 'Package') return '📦';
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
    if (['.sprite'].includes(ext)) {
      return '🎞️';
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
    // Build output stays collapsed unless the user explicitly expands it.
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
    // Fall back to native confirm so critical actions still work if modal utils fail to load.
    console.warn('[ProjectExplorer] ModalUtils unavailable; using native confirm fallback');
    try {
      return window.confirm(message);
    } catch (_) {
      return false;
    }
  }
  

  async closeProject(projectPath) {
    // projectPath is the project name (no slash) when invoked from root
    const pp = window.ProjectPaths?.parseProjectPath ? window.ProjectPaths.parseProjectPath(projectPath) : { project: null, rest: projectPath };
    const projectName = pp.project || (projectPath.includes('/') ? projectPath.split('/')[0] : projectPath);
    if (!projectName || !this.projectData.structure[projectName]) return;

    const confirmed = await this._confirm('Close Project', `Close project "${projectName}"? Open tabs for its files will be closed.`, { okText: 'Close Project', cancelText: 'Cancel' });
    if (!confirmed) return;

    // Non-destructive close: remove from UI and close tabs, keep stored files intact.
    await this.removeProjectFromUI(projectName);
  }
  
  handleFileUpload(files) {
    const targetPath = this.currentUploadPath || this.getDefaultPath();
    if (this.isManagedPackagePath(targetPath)) {
      try {
        window.gameEmulator?.updateStatus?.('Package folder is managed by Package Settings editor', 'warning');
      } catch (_) {}
      return;
    }
    this.addFiles(files, targetPath);
  }
  
  async handleFileDrop(event, targetPath = null) {
    const files = event.dataTransfer.files;
    const path = targetPath || this.getDropTargetPath(event.target);

    if (this.isManagedPackagePath(path)) {
      try {
        window.gameEmulator?.updateStatus?.('Drop blocked: Package folder is managed by Package Settings editor', 'warning');
      } catch (_) {}
      return;
    }

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
      // For font source files, always skip auto-open — FontEditor intercept handles them below
      const ext = this.getFileExtension(file.name).toLowerCase();
      const isFontSource = ['.ttf', '.otf', '.woff', '.woff2'].includes(ext);
      const skipAutoOpen = multiDrop || isFontSource;
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

    const fontSourceExts = ['.ttf', '.otf', '.woff', '.woff2'];
    const fontSourceFiles = fileList.filter(f => {
      const ext = this.getFileExtension(f.name).toLowerCase();
      return fontSourceExts.includes(ext);
    });
    if (fontSourceFiles.length === fileList.length) {
      return;
    }

    // For multi-drop, open all files in tabs after persistence is complete
    if (multiDrop && persistPromises.length > 0) {
      try {
        await Promise.allSettled(persistPromises);
        
        // Open each file in a tab
        for (const file of fileList) {
          const extension = this.getFileExtension(file.name).toLowerCase();
          if (fontSourceExts.includes(extension)) {
            continue;
          }
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
    } else if (['.texture', '.frameset', '.d2'].includes(ext)) {
      return { allowed: true, path: `${project}/${sourcesRoot}/Images` };
    } else if (['.sprite'].includes(ext)) {
      return { allowed: true, path: `${project}/${sourcesRoot}/Sprites` };
    } else if (luaExts.includes(ext)) {
      return { allowed: true, path: `${project}/${sourcesRoot}/Lua` };
    } else if (['.pal', '.act', '.aco'].includes(ext)) {
      return { allowed: true, path: `${project}/${sourcesRoot}/Palettes` };
    } else if (['.fnt', '.font', '.ttf', '.otf', '.woff', '.woff2'].includes(ext)) {
      return { allowed: true, path: `${project}/${sourcesRoot}/Fonts` };
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
    const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
    const tempPath = `${focusedProject}/${sourcesRoot}`;
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
    let persistReject;
    const persistDone = new Promise((resolve, reject) => {
      persistResolve = resolve;
      persistReject = reject;
    });
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
    const builderId = file.builderId || (finalExt === '.sfx' ? 'sfx' : (['.pal', '.act', '.aco'].includes(finalExt) ? 'pal' : undefined));

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
        const textExts = ['.lua', '.txt', '.pal', '.sfx', '.sprite', '.json', '.package', '.font', '.texture', '.frameset'];
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
              if (window.gameEmulator && window.gameEmulator.setStatus) {
                window.gameEmulator.setStatus(`Failed to convert ${fileName}`);
              }
              throw conversionError;
            }
          }
          
          if (window.fileIOService) {
            await window.fileIOService.saveFile(storageFullPath, finalContent, {
              binaryData: needsConversion ? true : isBinary, // ACT files are always binary
              builderId
            });
            console.log(`[ProjectExplorer] Persisted ${needsConversion ? 'converted' : 'dropped'} file to storage: ${storageFullPath}`);
          }
        }).then(() => {
          persistResolve();
        }).catch(err => {
          console.error('[ProjectExplorer] Failed persisting dropped file:', err);
          persistReject(err);
        });
      } catch (e) {
        console.error('[ProjectExplorer] Error persisting dropped file:', e);
        persistReject(e);
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
    
    // Auto-create texture and frameset files for image files (after file is added to project)
    if (this.isImageFile(finalFileName)) {
      console.log('[ProjectExplorer] Image file detected, will create texture + frameset files:', finalFileName);
      persistDone.then(() => {
        console.log('[ProjectExplorer] Persistence done, creating companion files for:', finalFileName);
        this.createTextureFileForImage(uiFullPath, path, finalFileName);
        this.createFramesetFileForImage(uiFullPath, path, finalFileName);
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
      // Enumerate directly from storage so orphaned artifacts are cleaned too.
      const buildPrefix = (window.ProjectPaths && window.ProjectPaths.getBuildStoragePrefix)
        ? window.ProjectPaths.getBuildStoragePrefix()
        : 'build/';
      const buildPrefixNoSlash = buildPrefix.replace(/\/$/, '');
      const buildRecords = await fm.listFiles(buildPrefixNoSlash);
      const buildFilePaths = (buildRecords || [])
        .map(rec => rec?.path || rec)
        .filter(path => typeof path === 'string' && path.startsWith(buildPrefix));
      
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
    const selectedName = path.split('/').pop() || path;

  // Build storage deletion list
    const toDelete = new Set();
    const collectPaths = (basePath, nodeData) => {
      if (!nodeData) return;
      if (nodeData.type === 'file') {
        toDelete.add(basePath);
      } else if (nodeData.children) {
        for (const [name, child] of Object.entries(nodeData.children)) {
          collectPaths(`${basePath}/${name}`.replace(/\\/g, '/'), child);
        }
      }
    };

    if (isFolder) {
      collectPaths(path, node);
    } else {
      toDelete.add(path);

      if (this.isImageFile(selectedName)) {
        const lastDot = selectedName.lastIndexOf('.');
        const baseName = lastDot >= 0 ? selectedName.substring(0, lastDot) : selectedName;
        const parentPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : '';
        const companionExtensions = ['.texture', '.frameset', '.d2'];

        for (const extension of companionExtensions) {
          const companionName = `${baseName}${extension}`;
          const companionPath = parentPath ? `${parentPath}/${companionName}` : companionName;
          toDelete.add(companionPath);
        }
      }
    }

    const deletedPaths = Array.from(toDelete);

  // Delete from storage (FileManager preferred)
    try {
      const fm = window.serviceContainer?.get?.('fileManager') || window.fileManager;
      if (fm) {
        for (const p of deletedPaths) {
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
    const removeFileNode = (targetPath) => {
      const parts = targetPath.split('/');
      const name = parts.pop();
      let current = this.projectData.structure;
      for (const part of parts) {
        if (current[part] && current[part].type === 'folder') {
          current = current[part].children;
        } else {
          return;
        }
      }

      if (name && current[name]) {
        delete current[name];
      }
    };

    if (isFolder) {
      removeFileNode(path);
    } else {
      for (const deletedPath of deletedPaths) {
        removeFileNode(deletedPath);
      }
    }

    // Re-render tree
    this.renderTree();
    console.log(`[ProjectExplorer] Deleted: ${path}`);

    // Emit deletion event for other systems (e.g., TabManager)
    try {
      if (window.eventBus && typeof window.eventBus.emit === 'function') {
        await window.eventBus.emit('file.deleted', { path, isFolder, deletedPaths });
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
    
    // Handle linked files for image asset set members (.png/.jpg/.../.texture/.frameset/.d2)
    const linkedRenames = [];
    let renamedImageOldPath = null;
    let renamedImageNewPath = null;
    if (type === 'file') {
      const currentExt = this.getFileExtension(currentName).toLowerCase();
      const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tga'];
      const companionExtensions = ['.texture', '.frameset', '.d2'];
      const assetFamilyExtensions = [...imageExtensions, ...companionExtensions];
      const isImageAssetSetMember = assetFamilyExtensions.includes(currentExt);

      if (isImageAssetSetMember) {
        const oldBaseName = currentName.substring(0, currentName.lastIndexOf('.'));
        const newBaseName = newName.substring(0, newName.lastIndexOf('.'));
        const familyOldPaths = new Set();

        for (const familyExt of assetFamilyExtensions) {
          const siblingOldName = oldBaseName + familyExt;
          const siblingOldPath = parentPath ? `${parentPath}/${siblingOldName}` : siblingOldName;
          if (this.getNodeByPath(siblingOldPath)) {
            familyOldPaths.add(siblingOldPath);
          }
        }

        if (this.isImageFile(currentName)) {
          renamedImageOldPath = path;
          renamedImageNewPath = newPath;
        }

        for (const familyExt of assetFamilyExtensions) {
          const linkedOldName = oldBaseName + familyExt;
          const linkedOldPath = parentPath ? `${parentPath}/${linkedOldName}` : linkedOldName;
          if (linkedOldPath === path) continue;

          const linkedNode = this.getNodeByPath(linkedOldPath);
          if (!linkedNode) continue;

          const linkedNewName = newBaseName + familyExt;
          const linkedNewPath = parentPath ? `${parentPath}/${linkedNewName}` : linkedNewName;

          // Check if linked new name would conflict with an unrelated existing file
          const destinationExists = this.getNodeByPath(linkedNewPath);
          const destinationIsInRenameSet = familyOldPaths.has(linkedNewPath) || linkedNewPath === newPath;
          if (linkedNewPath !== linkedOldPath && destinationExists && !destinationIsInRenameSet) {
            alert(`Cannot rename: linked file "${linkedNewName}" would conflict with existing file.`);
            return;
          }

          linkedRenames.push({ oldPath: linkedOldPath, newPath: linkedNewPath, newName: linkedNewName });
          console.log(`[ProjectExplorer] Will also rename linked file: ${linkedOldPath} → ${linkedNewPath}`);

          if (!renamedImageOldPath && imageExtensions.includes(familyExt)) {
            renamedImageOldPath = linkedOldPath;
            renamedImageNewPath = linkedNewPath;
          }
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
        
        // Also rename linked companion files if they exist
        for (const linkedRename of linkedRenames) {
          const linkedNodeData = this.getNodeByPath(linkedRename.oldPath);
          if (!linkedNodeData) continue;
          try {
            await this.renameFileInStorage(linkedRename.oldPath, linkedRename.newPath, linkedNodeData.file);
            console.log(`[ProjectExplorer] Successfully renamed linked file: ${linkedRename.oldPath} → ${linkedRename.newPath}`);
          } catch (error) {
            console.error(`[ProjectExplorer] Failed to rename linked file:`, error);
            // Continue with main file rename even if linked file rename fails
          }
        }

        // Keep companion JSON references in sync if this rename set also moved an image.
        if (renamedImageOldPath && renamedImageNewPath) {
          const refTargets = new Set();
          const newPrimaryExt = this.getFileExtension(newPath).toLowerCase();
          if (['.texture', '.frameset'].includes(newPrimaryExt)) {
            refTargets.add(newPath);
          }
          for (const linkedRename of linkedRenames) {
            const ext = this.getFileExtension(linkedRename.newPath).toLowerCase();
            if (['.texture', '.frameset'].includes(ext)) {
              refTargets.add(linkedRename.newPath);
            }
          }

          for (const targetPath of refTargets) {
            try {
              await this.updateCompanionSourceReferences(targetPath, renamedImageOldPath, renamedImageNewPath);
            } catch (error) {
              console.warn('[ProjectExplorer] Failed to update companion source references:', error);
            }
          }
        }
      }
      
      // Update the project structure
      this.updateNodePath(path, newPath, nodeData);
      
      // Update linked companion files in project structure too
      for (const linkedRename of linkedRenames) {
        const linkedNodeData = this.getNodeByPath(linkedRename.oldPath);
        if (!linkedNodeData) continue;
        try {
          this.updateNodePath(linkedRename.oldPath, linkedRename.newPath, linkedNodeData);
          console.log(`[ProjectExplorer] Updated linked file structure: ${linkedRename.oldPath} → ${linkedRename.newPath}`);
        } catch (error) {
          console.error(`[ProjectExplorer] Failed to update linked file structure:`, error);
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
          
          // Update linked companion tab references too
          for (const linkedRename of linkedRenames) {
            tabManager.updateFileReference(linkedRename.oldPath, linkedRename.newPath, linkedRename.newName);
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

  _rewriteImageReference(value, oldPath, newPath) {
    if (typeof value !== 'string' || !value) return value;

    const oldNorm = oldPath.replace(/\\/g, '/');
    const newNorm = newPath.replace(/\\/g, '/');
    const oldName = oldNorm.split('/').pop();
    const newName = newNorm.split('/').pop();
    const valueNorm = value.replace(/\\/g, '/');

    if (valueNorm === oldNorm) return newNorm;
    if (valueNorm === oldName) return newName;
    if (oldName && valueNorm.endsWith('/' + oldName)) {
      return valueNorm.slice(0, -oldName.length) + newName;
    }
    return value;
  }

  async updateCompanionSourceReferences(companionPath, oldImagePath, newImagePath) {
    const ext = this.getFileExtension(companionPath).toLowerCase();
    if (!['.texture', '.frameset'].includes(ext)) return;

    const fm = window.serviceContainer?.get?.('fileManager') || window.fileManager;
    if (!fm) return;

    const storagePath = window.ProjectPaths?.normalizeStoragePath
      ? window.ProjectPaths.normalizeStoragePath(companionPath)
      : companionPath;

    const record = await fm.loadFile(storagePath);
    if (!record) return;

    const content = record.content !== undefined ? record.content : (record.fileContent || '');
    if (typeof content !== 'string') return;

    let data;
    try {
      data = JSON.parse(content);
    } catch (_err) {
      // Not JSON content; ignore.
      return;
    }

    let changed = false;
    const rewrite = (v) => this._rewriteImageReference(v, oldImagePath, newImagePath);

    if (ext === '.texture') {
      const nextSourceImagePath = rewrite(data.sourceImagePath);
      if (nextSourceImagePath !== data.sourceImagePath) {
        data.sourceImagePath = nextSourceImagePath;
        changed = true;
      }
      const nextSourceImage = rewrite(data.sourceImage);
      if (nextSourceImage !== data.sourceImage) {
        data.sourceImage = nextSourceImage;
        changed = true;
      }
      if (data.metadata && typeof data.metadata === 'object') {
        const nextMetaSource = rewrite(data.metadata.sourceImagePath);
        if (nextMetaSource !== data.metadata.sourceImagePath) {
          data.metadata.sourceImagePath = nextMetaSource;
          changed = true;
        }
      }
    }

    if (ext === '.frameset') {
      const nextImagePath = rewrite(data.imagePath);
      if (nextImagePath !== data.imagePath) {
        data.imagePath = nextImagePath;
        changed = true;
      }
    }

    if (!changed) return;

    const metadata = { binaryData: false };
    if (record.builderId) metadata.builderId = record.builderId;
    await fm.saveFile(storagePath, JSON.stringify(data, null, 2), metadata);
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
    const fileName = (filePath || '').split('/').pop() || (filePath || '').split('\\').pop() || '';
    if (fileName.toLowerCase() === 'app.package' && window.PackageSettingsEditor) {
      return {
        type: 'editor',
        name: 'package-settings-editor',
        displayName: 'Package Settings',
        class: window.PackageSettingsEditor,
        icon: '⚙️',
        priority: 0
      };
    }

    const componentRegistry = window.serviceContainer?.get('componentRegistry');
    if (!componentRegistry) {
      console.warn('[ProjectExplorer] ComponentRegistry not available');
      return null;
    }

    // Get file extension
    const extension = fileName.includes('.') ? '.' + fileName.split('.').pop().toLowerCase() : '';
    const musicExtensions = ['.mod', '.xm', '.s3m', '.it', '.mptm'];
    
    console.log(`[ProjectExplorer] Getting component for file: ${fileName}, extension: ${extension}, preferEditor: ${preferEditor}`);

    if (musicExtensions.includes(extension)) {
      const viewer = componentRegistry.getViewerForFile(filePath);
      if (viewer) {
        console.log(`[ProjectExplorer] Using viewer for music file: ${viewer.name}`);
        return viewer;
      }
      console.warn(`[ProjectExplorer] No viewer found for music file ${fileName}`);
    }

    let component = null;
    
    if (preferEditor) {
      // Try to get an editor first
      const editors = componentRegistry.getComponentsForExtension(extension).filter(c => c.type === 'editor');
      component = editors.length > 0 ? editors[0] : null;
      console.log(`[ProjectExplorer] Found ${editors.length} editors for ${extension}`);
    }
    
    if (!component) {
      // Get all compatible components (editors and viewers)
      const allComponents = componentRegistry.getComponentsForExtension(extension);
      console.log(`[ProjectExplorer] Found ${allComponents.length} total components for ${extension}:`, allComponents.map(c => c.name));
      
      // Prefer editors over viewers for double-click
      const editors = allComponents.filter(c => c.type === 'editor');
      const viewers = allComponents.filter(c => c.type === 'viewer');
      
      if (preferEditor && editors.length > 0) {
        component = editors[0];
      } else if (editors.length > 0) {
        // Always prefer editors if available
        component = editors[0];
      } else if (viewers.length > 0) {
        component = viewers[0];
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
      
      // Get the appropriate component for this file type
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

    // Convert storage path to full UI path
    const focusedProject = this.getFocusedProjectName();
    if (!focusedProject) return defaultPalette;

    // Ensure we have a string (ProjectConfigManager should return string path)
    if (typeof defaultPalette !== 'string') {
      console.error('[ProjectExplorer] Expected string path from ProjectConfigManager, got:', typeof defaultPalette, defaultPalette);
      return null;
    }

    // If it already has the project prefix, return as-is
    if (defaultPalette.startsWith(focusedProject + '/')) {
      return defaultPalette;
    }

    // Add project prefix to create full UI path
    return `${focusedProject}/${defaultPalette}`;
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
    const sourcesRoot = this.getPreferredSourcesRootForProject(projectName);
    console.log('[ProjectExplorer] Initializing config for project:', projectName);

    // Backstop: ensure package scaffold exists even if earlier async setup was skipped.
    try {
      await this.ensurePackageScaffoldForRoot(projectName, sourcesRoot);
    } catch (e) {
      console.warn('[ProjectExplorer] Package scaffold backstop failed during config init:', e);
    }

    // Backstop: ensure template defaults are applied before selecting a default palette.
    try {
      await this.applyTemplateDefaults(projectName);
    } catch (e) {
      console.warn('[ProjectExplorer] Template defaults backstop failed during config init:', e);
    }

    // Step 1: Initialize the config manager for this project (will create config if doesn't exist)
    await window.ProjectConfigManager.initializeForProject(projectName);

    // Add config file to project structure if it doesn't exist there
    const configPath = `${sourcesRoot}/config.json`;
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
      .map(file => `${sourcesRoot}/Palettes/${file.name}`);
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
        // Prefer the shared template default palette if present.
        const preferred = `${sourcesRoot}/Palettes/retrowatch_256.act`;
        const newDefault = paletteFiles.includes(preferred) ? preferred : paletteFiles[0];
        console.log('[ProjectExplorer] Setting first palette as default:', newDefault);
        await window.ProjectConfigManager.setDefaultPalette(newDefault);
      } else {
        // Create a default palette file
        console.log('[ProjectExplorer] No palettes found, creating default palette');
        await this.createDefaultPalette(sourcesRoot);
      }
    }

    console.log('[ProjectExplorer] Project config initialization complete');
    
    // Re-render tree to show config file and update visuals
    this.renderTree();
    this.updatePaletteFileVisuals();
  }

  // Create a default palette file when none exists
  async createDefaultPalette(sourcesRoot = 'Sources') {
    try {
      // First choice: shared template default palette asset.
      const templatePalette = await this.fetchDefaultAssetAsFile(
        ['templates/defaults/retrowatch_256.act'],
        'retrowatch_256.act'
      );

      if (templatePalette) {
        const targetFolder = `${this.focusedProjectName}/${sourcesRoot}/Palettes`;
        await this.addFileToProject(templatePalette, targetFolder, true, true);
        const defaultPath = `${sourcesRoot}/Palettes/retrowatch_256.act`;
        await window.ProjectConfigManager.setDefaultPalette(defaultPath);
        this.renderTree();
        console.log('[ProjectExplorer] Created default palette from template defaults:', defaultPath);
        return;
      }

      // Fallback: generate basic built-in palette.
      const defaultPaletteData = this.generateDefaultPaletteData();
      const defaultPath = `${sourcesRoot}/Palettes/default.act`;
      const storagePath = window.ProjectPaths?.normalizeStoragePath
        ? window.ProjectPaths.normalizeStoragePath(defaultPath)
        : defaultPath;

      await window.fileIOService.saveFile(storagePath, defaultPaletteData, { binaryData: true, builderId: 'pal' });
      this.addFileToProjectStructure(this.focusedProjectName, defaultPath, { type: 'file' });
      await window.ProjectConfigManager.setDefaultPalette(defaultPath);
      this.renderTree();

      console.log('[ProjectExplorer] Created fallback default palette:', defaultPath);
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
      const currentDefault = await window.ProjectConfigManager.getDefaultPalette();
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

  // Auto-create texture file for image files
  async createTextureFileForImage(imageUIPath, imagePath, imageFileName) {
    try {
      const io = window.fileIOService || window.fileManager || window.serviceContainer?.get?.('fileManager');
      if (!io || typeof io.saveFile !== 'function' || typeof io.loadFile !== 'function') {
        console.warn('[ProjectExplorer] No file I/O service available for texture companion creation');
        return;
      }
      
      // Calculate texture file paths
      const baseName = imageFileName.substring(0, imageFileName.lastIndexOf('.'));
      const textureFileName = baseName + '.texture';
      
      // Convert UI path to storage path for both image and texture
      const imageStoragePath = window.ProjectPaths?.normalizeStoragePath ? 
        window.ProjectPaths.normalizeStoragePath(imageUIPath) : imageUIPath;
      const textureStoragePath = imageStoragePath.replace(imageFileName, textureFileName);
      const textureUIPath = imagePath + '/' + textureFileName;
      
      // Check if texture file already exists
      try {
        const existingTexture = await io.loadFile(textureStoragePath);
        if (existingTexture) {
          console.log('[ProjectExplorer] Texture file already exists in storage:', textureFileName);
          const existingTextureNode = this.getNodeByPath(textureUIPath);
          if (!existingTextureNode) {
            // Keep tree/storage in sync when companion already exists but is missing from UI structure.
            this.addFileToProject({
              name: textureFileName,
              size: 0,
              lastModified: Date.now(),
              originalPath: textureUIPath
            }, imagePath, true, true);
            this.renderTree();
            console.log('[ProjectExplorer] Re-linked existing texture file into project tree:', textureUIPath);
          }
          return;
        }
      } catch (e) {
        // File doesn't exist, proceed with creation
      }
      
      // Load the image to get its actual dimensions
      let imageWidth = 32;
      let imageHeight = 32;
      
      try {
        console.log('[ProjectExplorer] Loading image to get dimensions:', imageStoragePath);
        const imageFile = await io.loadFile(imageStoragePath);
        if (imageFile && imageFile.fileContent) {
          // Create an image element to get dimensions
          const img = new Image();
          const imageDimensions = await new Promise((resolve, reject) => {
            img.onload = () => {
              console.log('[ProjectExplorer] Image loaded, dimensions:', img.width, 'x', img.height);
              resolve({ width: img.width, height: img.height });
            };
            img.onerror = (error) => {
              console.warn('[ProjectExplorer] Failed to load image for dimensions:', error);
              resolve({ width: 32, height: 32 }); // Use defaults on error
            };
            
            // Set image source based on content type
            if (imageFile.binaryData || imageFile.fileContent.startsWith('data:')) {
              img.src = imageFile.fileContent.startsWith('data:') ? 
                         imageFile.fileContent : 
                         `data:image/png;base64,${imageFile.fileContent}`;
            } else {
              img.src = `data:image/png;base64,${imageFile.fileContent}`;
            }
          });
          
          imageWidth = imageDimensions.width;
          imageHeight = imageDimensions.height;
        }
      } catch (error) {
        console.warn('[ProjectExplorer] Could not load image for dimensions, using defaults:', error);
      }
      
      const importDefaults = await this.getTextureImportDefaults(imageStoragePath, imageFileName, io);

      // Create texture data with actual image dimensions and import-time defaults
      // so Image.Create() works immediately after dropping an image.
      const defaultTextureData = {
        width: imageWidth,
        height: imageHeight,
        colorDepth: importDefaults.colorDepth,
        palette: null,
        transparentColor: importDefaults.transparentColor,
        useColorKey: importDefaults.useColorKey,
        compression: 'none',
        rotation: 0,
        scale: 1,
        paletteSize: 256,
        paletteOffset: importDefaults.paletteOffset,
        sourceImagePath: imageFileName,
        palettePath: importDefaults.palettePath,
        metadata: {
          created: new Date().toISOString(),
          autoGenerated: true,
          outputPixelFormat: importDefaults.outputPixelFormat,
          palettePath: importDefaults.palettePath,
          paletteOffset: importDefaults.paletteOffset
        }
      };
      
      console.log('[ProjectExplorer] Creating texture file with dimensions:', imageWidth, 'x', imageHeight);
      const textureContent = JSON.stringify(defaultTextureData, null, 2);
      
      // Save texture file to storage
      await io.saveFile(textureStoragePath, textureContent);
      console.log('[ProjectExplorer] Auto-created texture file:', textureStoragePath);
      
      // Add texture file to project structure
      this.addFileToProject({ 
        name: textureFileName, 
        size: textureContent.length,
        lastModified: Date.now(),
        originalPath: textureUIPath  // Preserve the actual file path for operations
      }, imagePath, true, true); // Skip auto-open and skip render to avoid duplicate refreshes
      
      console.log('[ProjectExplorer] Added texture file to project structure:', textureUIPath);
      
      // Manually refresh the UI to show the new texture file
      this.renderTree();
      console.log('[ProjectExplorer] Refreshed UI after texture file creation');
      
    } catch (error) {
      console.error('[ProjectExplorer] Failed to auto-create texture file:', error);
    }
  }

  // Determine import-time defaults for a dropped image so first-run behavior is usable.
  async getTextureImportDefaults(imageStoragePath, imageFileName, io = null) {
    const defaults = {
      outputPixelFormat: 'd2_mode_rgba8888',
      colorDepth: 32,
      palettePath: '',
      paletteOffset: 0,
      useColorKey: false,
      transparentColor: '#FF00FF'
    };

    const ioService = io || window.fileIOService || window.fileManager || window.serviceContainer?.get?.('fileManager');
    if (!ioService || typeof ioService.loadFile !== 'function' || !window.ImageData) {
      return defaults;
    }

    let frame = null;
    try {
      const imageFile = await ioService.loadFile(imageStoragePath);
      if (!imageFile || !imageFile.fileContent) {
        return defaults;
      }

      const imageData = await window.ImageData.fromFile(imageFile.fileContent, imageFileName);
      frame = imageData?.getCurrentFrame ? imageData.getCurrentFrame() : null;
      if (!frame || !Array.isArray(frame.colors)) {
        return defaults;
      }
    } catch (error) {
      console.warn('[ProjectExplorer] Could not analyze image for import defaults:', error);
      return defaults;
    }

    let hasAlpha = false;
    const uniqueOpaque = new Set();
    for (const px of frame.colors) {
      const a = typeof px.a === 'number' ? px.a : Math.round((px.alpha || 0) * 255);
      if (a < 255) {
        hasAlpha = true;
      }
      if (a >= 128) {
        uniqueOpaque.add(((px.r & 0xFF) << 16) | ((px.g & 0xFF) << 8) | (px.b & 0xFF));
      }
    }

    const neededColors = Math.max(1, uniqueOpaque.size + (hasAlpha ? 1 : 0));

    let defaultPalettePath = '';
    let paletteColors = [];
    try {
      defaultPalettePath = await this.getDefaultPalettePath();
      if (defaultPalettePath && window.Palette) {
        const paletteStoragePath = window.ProjectPaths?.normalizeStoragePath
          ? window.ProjectPaths.normalizeStoragePath(defaultPalettePath)
          : defaultPalettePath;
        const paletteFile = await ioService.loadFile(paletteStoragePath);
        if (paletteFile && paletteFile.fileContent) {
          const paletteObj = await window.Palette.fromFile(paletteFile.fileContent, defaultPalettePath);
          paletteColors = paletteObj?.getColors ? paletteObj.getColors() : (paletteObj?.colors || []);
          const parsedPalettePath = window.ProjectPaths?.parseProjectPath
            ? window.ProjectPaths.parseProjectPath(defaultPalettePath)
            : { rest: defaultPalettePath };
          defaults.palettePath = parsedPalettePath.rest || defaultPalettePath;
        }
      }
    } catch (error) {
      console.warn('[ProjectExplorer] Could not load default palette for import defaults:', error);
    }

    defaults.useColorKey = hasAlpha;

    // Need at least one drawable palette entry, plus one reserved color-key slot for alpha imports.
    const minPaletteEntries = hasAlpha ? 2 : 1;
    if (paletteColors.length < minPaletteEntries) {
      if (hasAlpha) {
        defaults.outputPixelFormat = 'd2_mode_rgba8888';
        defaults.colorDepth = 32;
      } else {
        defaults.outputPixelFormat = 'd2_mode_rgb565';
        defaults.colorDepth = 16;
      }
      defaults.palettePath = '';
      defaults.paletteOffset = 0;
      return defaults;
    }

    if (!Array.isArray(paletteColors) || paletteColors.length === 0) {
      // No palette available: pick a sensible true-color default.
      if (hasAlpha) {
        defaults.outputPixelFormat = 'd2_mode_rgba8888';
        defaults.colorDepth = 32;
      } else {
        defaults.outputPixelFormat = 'd2_mode_rgb565';
        defaults.colorDepth = 16;
      }
      return defaults;
    }

    const candidates = [
      { format: 'd2_mode_i1', capacity: 2, bits: 1 },
      { format: 'd2_mode_i2', capacity: 4, bits: 2 },
      { format: 'd2_mode_i4', capacity: 16, bits: 4 },
      { format: 'd2_mode_i8', capacity: 256, bits: 8 }
    ].filter(c => c.capacity >= neededColors && paletteColors.length >= c.capacity);

    const usableCandidates = candidates.length > 0 ? candidates : [
      { format: 'd2_mode_i8', capacity: Math.min(256, paletteColors.length), bits: 8 }
    ];

    const samplePixels = [];
    const maxSamples = 1024;
    const step = Math.max(1, Math.floor(frame.colors.length / maxSamples));
    for (let i = 0; i < frame.colors.length; i += step) {
      const px = frame.colors[i];
      const a = typeof px.a === 'number' ? px.a : Math.round((px.alpha || 0) * 255);
      if (a >= 128) {
        samplePixels.push({ r: px.r, g: px.g, b: px.b });
      }
    }

    const parseHex = (hex) => {
      if (!hex || typeof hex !== 'string' || hex.length !== 7 || hex[0] !== '#') return null;
      return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16)
      };
    };

    const colorDistance = (a, b) => {
      const dr = a.r - b.r;
      const dg = a.g - b.g;
      const db = a.b - b.b;
      return (dr * dr) + (dg * dg) + (db * db);
    };

    let best = null;
    for (const candidate of usableCandidates) {
      if (candidate.capacity <= 0) continue;

      const offsetLimit = Math.max(0, paletteColors.length - candidate.capacity);
      for (let offset = 0; offset <= offsetLimit; offset++) {
        const startIdx = hasAlpha ? 1 : 0;
        const endIdx = candidate.capacity;
        if (startIdx >= endIdx) continue;

        const working = [];
        for (let i = startIdx; i < endIdx; i++) {
          const rgb = parseHex(paletteColors[offset + i]);
          if (rgb) working.push(rgb);
        }
        if (working.length === 0) continue;

        let total = 0;
        for (const px of samplePixels) {
          let localBest = Number.POSITIVE_INFINITY;
          for (const pal of working) {
            const dist = colorDistance(px, pal);
            if (dist < localBest) localBest = dist;
          }
          total += localBest;
        }

        const avgError = samplePixels.length > 0 ? (total / samplePixels.length) : 0;
        if (!best || avgError < best.avgError || (avgError === best.avgError && candidate.bits < best.bits)) {
          best = {
            format: candidate.format,
            bits: candidate.bits,
            offset,
            avgError
          };
        }
      }
    }

    if (best) {
      defaults.outputPixelFormat = best.format;
      defaults.colorDepth = best.bits;
      defaults.paletteOffset = best.offset;
    } else {
      // If no valid indexed fit was found, fall back to true-color so import remains usable.
      if (hasAlpha) {
        defaults.outputPixelFormat = 'd2_mode_rgba8888';
        defaults.colorDepth = 32;
      } else {
        defaults.outputPixelFormat = 'd2_mode_rgb565';
        defaults.colorDepth = 16;
      }
      defaults.palettePath = '';
      defaults.paletteOffset = 0;
    }

    if (hasAlpha) {
      const keyColor = paletteColors[defaults.paletteOffset];
      if (typeof keyColor === 'string' && keyColor.startsWith('#')) {
        defaults.transparentColor = keyColor;
      }
    }

    return defaults;
  }

  // Auto-create frameset file for image files
  async createFramesetFileForImage(imageUIPath, imagePath, imageFileName) {
    try {
      const io = window.fileIOService || window.fileManager || window.serviceContainer?.get?.('fileManager');
      if (!io || typeof io.saveFile !== 'function' || typeof io.loadFile !== 'function') {
        console.warn('[ProjectExplorer] No file I/O service available for frameset companion creation');
        return;
      }

      const baseName = imageFileName.substring(0, imageFileName.lastIndexOf('.'));
      const framesetFileName = baseName + '.frameset';

      const imageStoragePath = window.ProjectPaths?.normalizeStoragePath
        ? window.ProjectPaths.normalizeStoragePath(imageUIPath)
        : imageUIPath;
      const framesetStoragePath = imageStoragePath.replace(imageFileName, framesetFileName);
      const framesetUIPath = imagePath + '/' + framesetFileName;

      // Check if frameset file already exists
      try {
        const existing = await io.loadFile(framesetStoragePath);
        if (existing) {
          console.log('[ProjectExplorer] Frameset file already exists in storage:', framesetFileName);
          const existingFramesetNode = this.getNodeByPath(framesetUIPath);
          if (!existingFramesetNode) {
            // Keep tree/storage in sync when companion already exists but is missing from UI structure.
            this.addFileToProject({
              name: framesetFileName,
              size: 0,
              lastModified: Date.now(),
              originalPath: framesetUIPath
            }, imagePath, true, true);
            this.renderTree();
            console.log('[ProjectExplorer] Re-linked existing frameset file into project tree:', framesetUIPath);
          }
          return;
        }
      } catch (e) {
        // File doesn't exist, proceed
      }

      // Load image to get dimensions
      let imageWidth = 32;
      let imageHeight = 32;
      try {
        const imageFile = await io.loadFile(imageStoragePath);
        if (imageFile && imageFile.fileContent) {
          const img = new Image();
          const dims = await new Promise((resolve) => {
            img.onload = () => resolve({ width: img.width, height: img.height });
            img.onerror = () => resolve({ width: 32, height: 32 });
            img.src = imageFile.fileContent.startsWith('data:')
              ? imageFile.fileContent
              : `data:image/png;base64,${imageFile.fileContent}`;
          });
          imageWidth = dims.width;
          imageHeight = dims.height;
        }
      } catch (error) {
        console.warn('[ProjectExplorer] Could not load image for frameset dimensions:', error);
      }

      // Build frameset JSON — single frame covering the whole image
      const framesetData = {
        name: baseName,
        imagePath: imageFileName,
        imageWidth: imageWidth,
        imageHeight: imageHeight,
        frames: [
          { id: 0, name: 'frame_0', x: 0, y: 0, w: imageWidth, h: imageHeight }
        ],
        metadata: {
          created: new Date().toISOString(),
          autoGenerated: true
        }
      };

      const framesetContent = JSON.stringify(framesetData, null, 2);

      await io.saveFile(framesetStoragePath, framesetContent);
      console.log('[ProjectExplorer] Auto-created frameset file:', framesetStoragePath);

      this.addFileToProject({
        name: framesetFileName,
        size: framesetContent.length,
        lastModified: Date.now(),
        originalPath: framesetUIPath
      }, imagePath, true, true);

      this.renderTree();
      console.log('[ProjectExplorer] Frameset file created and tree refreshed');
    } catch (error) {
      console.error('[ProjectExplorer] Failed to auto-create frameset file:', error);
    }
  }

  // Public method to refresh the project explorer display
  refresh() {
    console.log('[ProjectExplorer] Refreshing display...');
    this.renderTree();
  }

  /* ================================================================== */
  /*  Context menu                                                       */
  /* ================================================================== */
  _showContextMenu(e, nodeData, nodePath, nodeName) {
    // Remove any existing context menu
    this._hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    const ext = nodeName.split('.').pop().toLowerCase();
    const isFile = nodeData.type === 'file';
    const isPalette = isFile && this.isPaletteFile(nodePath);
    const isManagedPackage = this.isManagedPackagePath(nodePath);

    // "Make Sprite" / "Make Frameset" — shown for raw image files
    if (isFile && ['png', 'gif', 'jpg', 'jpeg', 'bmp'].includes(ext)) {
      const makeFrameset = document.createElement('div');
      makeFrameset.className = 'context-item';
      makeFrameset.innerHTML = '<span>🖼️</span><span>Make Frameset</span>';
      makeFrameset.addEventListener('click', () => {
        this._hideContextMenu();
        this._makeFrameset(nodePath);
      });
      menu.appendChild(makeFrameset);

      const makeSprite = document.createElement('div');
      makeSprite.className = 'context-item';
      makeSprite.innerHTML = '<span>🎞️</span><span>Make Sprite</span>';
      makeSprite.addEventListener('click', () => {
        this._hideContextMenu();
        this._makeSprite(nodePath);
      });
      menu.appendChild(makeSprite);
    }

    // Palette action: allow setting project default palette from explorer menu path.
    if (isPalette) {
      const setDefaultPaletteItem = document.createElement('div');
      setDefaultPaletteItem.className = 'context-item';
      setDefaultPaletteItem.innerHTML = '<span>🎨</span><span>Set as Default Palette</span>';
      setDefaultPaletteItem.addEventListener('click', async () => {
        this._hideContextMenu();
        await this.setDefaultPalette(nodePath);
      });
      menu.appendChild(setDefaultPaletteItem);
    }

    // Don't allow delete/rename on top-level root nodes (e.g. "Sources", "Build")
    const depth = nodePath.split('/').length;
    const isRootSection = depth <= 1;
    const isTopLevelProject = (
      nodeData.type === 'folder' &&
      depth === 1 &&
      !!this.projectData?.structure?.[nodePath]
    );

    if (isTopLevelProject) {
      const isActive = this.getFocusedProjectName() === nodePath;

      if (!isActive) {
        const setActiveItem = document.createElement('div');
        setActiveItem.className = 'context-item';
        setActiveItem.innerHTML = '<span>📌</span><span>Set Active Project</span>';
        setActiveItem.addEventListener('click', () => {
          this._hideContextMenu();
          this.setFocusedProjectName(nodePath);
        });
        menu.appendChild(setActiveItem);
      }

      const closeProjectItem = document.createElement('div');
      closeProjectItem.className = 'context-item context-item-danger';
      closeProjectItem.innerHTML = '<span>🔻</span><span>Close Project</span>';
      closeProjectItem.addEventListener('click', async () => {
        this._hideContextMenu();
        await this.closeProject(nodePath);
      });
      menu.appendChild(closeProjectItem);
    }

    if (!isRootSection && !isManagedPackage) {
      // Separator if there are already items above
      if (menu.children.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'context-separator';
        menu.appendChild(sep);
      }

      // Rename
      const renameItem = document.createElement('div');
      renameItem.className = 'context-item';
      renameItem.innerHTML = '<span>✏️</span><span>Rename</span>';
      renameItem.addEventListener('click', () => {
        this._hideContextMenu();
        this.renameNode(nodePath, nodeData.type);
      });
      menu.appendChild(renameItem);

      // Delete
      const deleteItem = document.createElement('div');
      deleteItem.className = 'context-item context-item-danger';
      deleteItem.innerHTML = '<span>🗑️</span><span>Delete</span>';
      deleteItem.addEventListener('click', () => {
        this._hideContextMenu();
        this.deleteNode(nodePath);
      });
      menu.appendChild(deleteItem);
    }

    // Only show the menu if it has items
    if (menu.children.length === 0) return;

    // Dismiss on click outside
    const dismiss = (ev) => {
      if (!menu.contains(ev.target)) {
        this._hideContextMenu();
        document.removeEventListener('click', dismiss, true);
      }
    };
    document.addEventListener('click', dismiss, true);

    this._activeContextMenu = menu;
    document.body.appendChild(menu);

    // Clamp to viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;
  }

  _hideContextMenu() {
    if (this._activeContextMenu) {
      this._activeContextMenu.remove();
      this._activeContextMenu = null;
    }
  }

  /**
   * Create a .sprite file pre-linked to the given texture / image path
   * and open it in the Sprite Editor.
   */
  async _makeSprite(imagePath) {
    try {
      console.log('[ProjectExplorer] Make Sprite from:', imagePath);

      // Derive sprite file name from the source image
      const baseName = imagePath.split('/').pop().replace(/\.[^.]+$/, '');
      const spriteName = baseName + '.sprite';

      // Build the initial .sprite JSON using SpriteEditorData (or plain JSON)
      const spriteJSON = (window.SpriteEditor && window.SpriteEditor.createFromImage)
        ? window.SpriteEditor.createFromImage(imagePath)
        : JSON.stringify({ name: baseName, imagePath }, null, 2);

      // Save to storage
      const fm = window.fileManager || window.serviceContainer?.get('fileManager');
      const focusedProject = this.getFocusedProjectName();
      const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi)
        ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
      const spriteUIPath = focusedProject
        ? `${focusedProject}/${sourcesRoot}/Sprites/${spriteName}`
        : `${sourcesRoot}/Sprites/${spriteName}`;
      const storagePath = window.ProjectPaths?.normalizeStoragePath
        ? window.ProjectPaths.normalizeStoragePath(spriteUIPath)
        : spriteUIPath;

      if (fm) {
        await fm.saveFile(storagePath, spriteJSON);
      } else if (window.fileIOService) {
        await window.fileIOService.saveFile(storagePath, spriteJSON);
      }

      // Add to the project tree at the explicit sprite folder path
      const spriteFolderPath = spriteUIPath.split('/').slice(0, -1).join('/');
      this.addFileToProject({ name: spriteName, path: spriteUIPath, isNewFile: true }, spriteFolderPath, true, true);
      this.renderTree();

      // Open in editor
      if (window.tabManager) {
        const fullPath = spriteUIPath;
        const componentInfo = this._getComponentForFile(fullPath, true);
        if (componentInfo) {
          window.tabManager.openInTab(fullPath, componentInfo, { isReadOnly: false });
        }
      }

      console.log('[ProjectExplorer] Sprite created:', spriteUIPath, '->', storagePath);
    } catch (error) {
      console.error('[ProjectExplorer] Failed to create sprite:', error);
      alert('Failed to create sprite: ' + error.message);
    }
  }

  /**
   * Create a .frameset file pre-linked to the given image path
   * and open it in the Frameset Editor.
   */
  async _makeFrameset(imagePath) {
    try {
      console.log('[ProjectExplorer] Make Frameset from:', imagePath);

      const baseName = imagePath.split('/').pop().replace(/\.[^.]+$/, '');
      const framesetName = baseName + '.frameset';

      const framesetJSON = (window.FramesetEditor && window.FramesetEditor.createFromImage)
        ? window.FramesetEditor.createFromImage(imagePath)
        : JSON.stringify({ name: baseName, imagePath }, null, 2);

      const fm = window.fileManager || window.serviceContainer?.get('fileManager');
      // Framesets should live alongside their source image so image-local workflows work.
      const framesetUIPath = imagePath.replace(/\.[^/.]+$/i, '.frameset');
      const storagePath = window.ProjectPaths?.normalizeStoragePath
        ? window.ProjectPaths.normalizeStoragePath(framesetUIPath)
        : framesetUIPath;

      if (fm) {
        await fm.saveFile(storagePath, framesetJSON);
      } else if (window.fileIOService) {
        await window.fileIOService.saveFile(storagePath, framesetJSON);
      }

      const folderPath = framesetUIPath.split('/').slice(0, -1).join('/');
      this.addFileToProject({ name: framesetName, path: framesetUIPath, isNewFile: true }, folderPath, true, true);
      this.renderTree();

      if (window.tabManager) {
        const componentInfo = this._getComponentForFile(framesetUIPath, true);
        if (componentInfo) {
          window.tabManager.openInTab(framesetUIPath, componentInfo, { isReadOnly: false });
        }
      }

      console.log('[ProjectExplorer] Frameset created:', framesetUIPath, '->', storagePath);
    } catch (error) {
      console.error('[ProjectExplorer] Failed to create frameset:', error);
      alert('Failed to create frameset: ' + error.message);
    }
  }
}

// Export for use
window.ProjectExplorer = ProjectExplorer;
