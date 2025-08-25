// service-adapters.js
// Adapters to integrate existing services with new core systems

class GameEmulatorAdapter {
  constructor(gameEmulator, services, events) {
    this.gameEmulator = gameEmulator;
    this.services = services;
    this.events = events;
    this.setupIntegration();
  }

  setupIntegration() {
    // Make services available to game emulator
    this.gameEmulator.tabManager = this.services.get('tabManager');
    this.gameEmulator.buildSystem = this.services.get('buildSystem');
    this.gameEmulator.projectExplorer = this.services.get('projectExplorer');

    // Connect events
    this.setupEventConnections();
  }

  setupEventConnections() {
    // File operations
    this.events.on('file.save.requested', (data) => {
      this.gameEmulator.saveCurrentFile();
    });

    // Build operations
    this.events.on('build.start.requested', (data) => {
      this.gameEmulator.buildProject();
    });

    // Tab operations
    this.events.on('tab.close.requested', (data) => {
      this.gameEmulator.tabManager.closeTab(data.tabId);
    });
  }
}

class TabManagerAdapter {
  constructor(tabManager, services, events) {
    this.tabManager = tabManager;
    this.services = services;
    this.events = events;
    this.componentRegistry = services.get('componentRegistry');
    this.setupIntegration();
  }

  setupIntegration() {
    // Override openFile to use component registry, preserving original signature (file, path, options)
    const originalOpenFile = this.tabManager.openFile.bind(this.tabManager);
    this.tabManager.openFile = (file, path, options = {}) => {
      // Prefer explicit path; if missing and file is a string, treat it as path
      const filePath = typeof path === 'string' && path ? path : (typeof file === 'string' ? file : null);
      if (filePath) {
        return this.openFileWithComponents(filePath, null, (fp) => originalOpenFile(file, path, options));
      }
      return originalOpenFile(file, path, options);
    };

    // Connect events
    this.setupEventConnections();
  }

  async openFileWithComponents(filePath, content, fallback) {
    const extension = this.getFileExtension(filePath);
    
    // Try to find appropriate component
    const editor = this.componentRegistry.getEditorForFile(filePath);
    const viewer = this.componentRegistry.getViewerForFile(filePath);

    if (editor) {
      this.events.emit('file.opening', { path: filePath, type: 'editor' });
  return this.openWithEditor(filePath, content, editor);
    } else if (viewer) {
      this.events.emit('file.opening', { path: filePath, type: 'viewer' });
  return this.openWithViewer(filePath, content, viewer);
    }

    // Fallback to original implementation
    return fallback(filePath, content);
  }

  async openWithEditor(filePath, content, editorInfo) {
    // Use TabManager's public API; it will load from storage and pick the right editor via registry
    const tabId = await this.tabManager.openInTab(filePath, editorInfo, { isReadOnly: false });
    this.events.emit('file.opened', { path: filePath, type: 'editor', tabId, preferred: editorInfo?.name });
    return tabId;
  }

  async openWithViewer(filePath, content, viewerInfo) {
    // Use preview for viewers by default
    const tabId = await this.tabManager.openInPreview(filePath, viewerInfo, { isReadOnly: true });
    this.events.emit('file.opened', { path: filePath, type: 'viewer', tabId, preferred: viewerInfo?.name });
    return tabId;
  }

  setupEventConnections() {
    // Tab switching
    const originalSwitchToTab = this.tabManager.switchToTab.bind(this.tabManager);
    this.tabManager.switchToTab = (tabId) => {
      const rawPrev = this.tabManager.activeTabId;
      const previousTabId = (typeof rawPrev === 'string') ? rawPrev : (rawPrev && rawPrev.tabId ? rawPrev.tabId : (rawPrev != null ? String(rawPrev) : ''));
      const result = originalSwitchToTab(tabId);
      
      if (previousTabId !== tabId) {
        const safeTabId = (typeof tabId === 'string') ? tabId : (tabId && tabId.tabId ? tabId.tabId : (tabId != null ? String(tabId) : ''));
        this.events.emit('tab.switched', { tabId: safeTabId, previousTabId });
      }
      
      return result;
    };

    // Tab closing
    this.events.on('tab.close', (data) => {
      this.events.emit('file.closed', { path: data.filePath, tabId: data.tabId });
    });
  }

  getFileExtension(filePath) {
    return filePath.substring(filePath.lastIndexOf('.'));
  }

  getFileName(filePath) {
    return filePath.substring(filePath.lastIndexOf('/') + 1);
  }
}

class BuildSystemAdapter {
  constructor(buildSystem, services, events) {
    this.buildSystem = buildSystem;
    this.services = services;
    this.events = events;
    try {
      this.pluginSystem = services.get('pluginSystem');
    } catch (e) {
      console.warn('[BuildSystemAdapter] Plugin system not available:', e.message);
      this.pluginSystem = null;
    }
    this.setupIntegration();
  }

  setupIntegration() {
    // Hook into build process
    if (this.buildSystem && typeof this.buildSystem.buildProject === 'function') {
      const originalBuild = this.buildSystem.buildProject.bind(this.buildSystem);
      this.buildSystem.buildProject = async (projectPath) => {
        return this.buildWithHooks(projectPath, originalBuild);
      };
      
      // Also provide a build method alias for compatibility
      this.buildSystem.build = this.buildSystem.buildProject;
    } else {
      console.warn('[BuildSystemAdapter] buildSystem does not have buildProject method');
    }

    this.setupEventConnections();
  }

  async buildWithHooks(projectPath, originalBuild) {
    try {
      this.events.emit('build.started', { projectPath });

      // Run pre-build hooks if plugin system is available
      if (this.pluginSystem && typeof this.pluginSystem.runHook === 'function') {
        await this.pluginSystem.runHook('build.beforeStart', { projectPath });
      }

  // Execute build
  const result = await originalBuild(projectPath);
  const success = !!(result && result.success !== false);

      // Run post-build hooks if plugin system is available
      if (this.pluginSystem && typeof this.pluginSystem.runHook === 'function') {
        await this.pluginSystem.runHook('build.afterComplete', { 
          projectPath, 
          result,
          success 
        });
      }

      this.events.emit('build.completed', { projectPath, result, success });
      
      // Emit content refresh required event for viewers to update
      console.log('[ServiceAdapter] Emitting content.refresh.required event');
      this.events.emit('content.refresh.required');
      
      return result;

    } catch (error) {
      // Run error hooks if plugin system is available
      if (this.pluginSystem && typeof this.pluginSystem.runHook === 'function') {
        await this.pluginSystem.runHook('build.afterComplete', { 
          projectPath, 
          error,
          success: false 
        });
      }

      this.events.emit('build.failed', { projectPath, error });
      throw error;
    }
  }

  setupEventConnections() {
    this.events.on('build.start.requested', (data) => {
      this.buildSystem.build(data.projectPath);
    });
  }
}

class ProjectExplorerAdapter {
  constructor(projectExplorer, services, events) {
    this.projectExplorer = projectExplorer;
    this.services = services;
    this.events = events;
    this.componentRegistry = services.get('componentRegistry');
    this.pluginSystem = services.get('pluginSystem');
    this.setupIntegration();
  }

  setupIntegration() {
    // Set up context menu handling directly on project explorer using event delegation
    // This ensures it works for dynamically added files (from build, drop, etc.)
    if (this.projectExplorer.treeContainer) {
      this.projectExplorer.treeContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        
        // Find the closest tree item using event delegation
        const treeItem = e.target.closest('[data-path]');
        if (treeItem) {
          // Select the node
          if (this.projectExplorer.selectNode) {
            this.projectExplorer.selectNode(treeItem);
          }
          
          // Get the file path
          const filePath = treeItem.dataset.path;
          
          // Show enhanced context menu
          this.showEnhancedContextMenu(e, filePath);
        }
      });
    }

    this.setupEventConnections();
  }

  async showEnhancedContextMenu(event, filePath) {
  const menuItems = [];

  // Determine node type via ProjectExplorer
    const explorer = this.projectExplorer;
    // Prefer DOM-selected node type if available
    const selType = explorer?.selectedNode?.dataset?.type;
    let isFolder = selType === 'folder';
    let isProjectRoot = isFolder && filePath && !filePath.includes('/');
    if (selType == null && explorer?.getNodeByPath) {
      // Fallback: infer by path; if path resolves to a file node in structure
      const parts = (filePath || '').split('/').filter(Boolean);
      if (parts.length === 0) {
        isFolder = true; isProjectRoot = true;
      } else {
        // Try to walk structure and check last segment presence
        try {
          let current = explorer.projectData?.structure || {};
          for (let i = 0; i < parts.length; i++) {
            const name = parts[i];
            const node = current[name];
            if (!node) { break; }
            if (i === parts.length - 1) {
              isFolder = node.type === 'folder';
            }
            if (node.type === 'folder') current = node.children || {};
          }
          isProjectRoot = isFolder && parts.length === 1;
        } catch (_) {}
      }
    }

    // Get component info for file
    let allComponents = [];
    if (!isFolder) {
      try { 
        allComponents = this.componentRegistry.getComponentsForExtension(
          this.componentRegistry.getFileExtension(filePath)
        ); 
      } catch (_) { 
        allComponents = []; 
      }
    }

    // Add component-specific menu items only for files
    if (!isFolder && allComponents.length > 0) {
      // Group by type and add all available components
      const editors = allComponents.filter(c => c.type === 'editor');
      const viewers = allComponents.filter(c => c.type === 'viewer');

      // Add editors
      for (const editor of editors) {
        menuItems.push({
          label: `Edit with ${editor.displayName}`,
          icon: editor.icon,
          action: () => this.openWithEditor(filePath, editor)
        });
      }

      // Add viewers
      for (const viewer of viewers) {
        menuItems.push({
          label: `View with ${viewer.displayName}`,
          icon: viewer.icon,
          action: () => this.openWithViewer(filePath, viewer)
        });
      }

      // Add palette-specific options for palette files
      if (this.isPaletteFile(filePath)) {
        // Add separator if we already have items
        if (menuItems.length > 0) {
          menuItems.push({ separator: true });
        }

        // Always show "Set as Default Palette" option
        menuItems.push({
          label: 'Set as Default Palette',
          icon: '🎨',
          action: async () => {
            if (explorer?.setDefaultPalette) {
              await explorer.setDefaultPalette(filePath);
            }
          }
        });
      }
    }

    // Add standard items (avoid file operations on project root)
    if (!isProjectRoot) {
      // For files: Open/Delete/Rename
      if (!isFolder) {
        menuItems.push(
          { label: 'Open', action: () => this.openFile(filePath) },
          { label: 'Delete', action: () => this.deleteFile(filePath) },
          { label: 'Rename', action: () => this.renameFile(filePath) }
        );
      } else {
        // For folders: Upload/New Folder plus Rename/Delete if not root of special areas
        menuItems.push(
          { label: 'Upload Files...', icon: '📁', action: () => {
              try { this.projectExplorer.currentUploadPath = filePath; this.projectExplorer.fileUpload?.click?.(); } catch(_) {}
            }
          },
          { label: 'New Folder', icon: '📂', action: () => this.projectExplorer.createNewFolder(filePath) }
        );
        menuItems.push(
          { label: 'Rename', action: () => this.renameFile(filePath) },
          { label: 'Delete', action: () => this.deleteFile(filePath) }
        );
      }
    }

    // Project root specific actions
    if (isProjectRoot) {
      const alreadyActive = explorer?.getFocusedProjectName?.() === filePath;
      if (!alreadyActive) {
        menuItems.push({
          label: 'Set Active Project',
          icon: '📌',
          action: () => {
            try { explorer.setFocusedProjectName(filePath); } catch (_) {}
          }
        });
      }
      menuItems.push({
        label: 'Close Project',
        icon: '🔻',
        action: () => explorer.closeProject(filePath)
      });
    }

    // Run plugin hooks for additional menu items
    let hookResult = null;
    try {
      if (this.pluginSystem && typeof this.pluginSystem.runHook === 'function') {
        hookResult = await this.pluginSystem.runHook('ui.createContextMenu', {
          filePath,
          menuItems,
          event
        });
      } else if (this.pluginSystem && typeof this.pluginSystem.executeHook === 'function') {
        const results = await this.pluginSystem.executeHook('ui.createContextMenu', { filePath, menuItems, event });
        hookResult = Array.isArray(results) && results.length ? results[results.length - 1] : null;
      }
    } catch (e) {
      console.warn('[ServiceAdapter] Context menu hook failed:', e);
    }

    if (hookResult && hookResult.menuItems) {
      menuItems.push(...hookResult.menuItems);
    }

    // Show enhanced menu if there are items
    if (menuItems.length > 0) {
      this.showContextMenuWithItems(event, menuItems);
    }
  }

  showContextMenuWithItems(event, items) {
    // Create and show context menu with items
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    
    // Helper to remove the menu
    const removeMenu = () => {
      if (menu.parentNode) {
        menu.parentNode.removeChild(menu);
      }
      document.removeEventListener('click', removeMenu);
    };

    items.forEach(item => {
      if (item.separator) {
        // Add separator
        const separator = document.createElement('div');
        separator.className = 'context-separator';
        menu.appendChild(separator);
      } else {
        // Add menu item
        const menuItem = document.createElement('div');
        // Use class that matches existing CSS (.context-item) for proper hover highlight
        menuItem.className = 'context-item';
        menuItem.innerHTML = `${item.icon || ''} ${item.label}`;
        menuItem.onclick = (e) => {
          try { item.action?.(e); } finally { removeMenu(); }
        };
        menu.appendChild(menuItem);
      }
    });

    document.body.appendChild(menu);
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';

  // Also remove on click outside
    setTimeout(() => document.addEventListener('click', removeMenu), 0);
  }

  openFile(filePath) {
    this.events.emit('file.open.requested', { path: filePath });
  }

  openWithEditor(filePath, editorInfo) {
    this.events.emit('file.open.requested', { 
      path: filePath, 
      preferredComponent: editorInfo.name 
    });
  }

  openWithViewer(filePath, viewerInfo) {
    this.events.emit('file.open.requested', { 
      path: filePath, 
      preferredComponent: viewerInfo.name 
    });
  }

  deleteFile(filePath) {
    this.events.emit('file.delete.requested', { path: filePath });
  }

  renameFile(filePath) {
    this.events.emit('file.rename.requested', { path: filePath });
  }

  setupEventConnections() {
    this.events.on('file.open.requested', async (data) => {
      const tabManager = this.services.get('tabManager');
      const componentRegistry = this.services.get('componentRegistry');
      
      // If a preferred component was specified, get the componentInfo
      if (data && data.path) {
        let componentInfo = null;
        
        if (data.preferredComponent && componentRegistry) {
          console.log(`[ServiceAdapter] Looking for preferred component: ${data.preferredComponent}`);
          
          // Try to find the component in registry
          const allComponents = [
            ...componentRegistry.editors.values(),
            ...componentRegistry.viewers.values()
          ];
          
          const foundComponent = allComponents.find(comp => 
            comp && (comp.name === data.preferredComponent || comp.displayName === data.preferredComponent)
          );
          
          if (foundComponent) {
            componentInfo = foundComponent;
            console.log(`[ServiceAdapter] Found component:`, componentInfo);
          } else {
            console.warn(`[ServiceAdapter] Component ${data.preferredComponent} not found in registry`);
          }
        }
        
        // If no specific component, let tab manager auto-detect (use legacy method for now)
        if (!componentInfo) {
          console.log(`[ServiceAdapter] No component specified, using legacy auto-detection`);
          try {
            await tabManager.openInTab(data.path);
          } catch (e) {
            console.warn('[ProjectExplorerAdapter] openInTab failed, trying preview:', e?.message || e);
            await tabManager.openInPreview(data.path);
          }
        } else {
          // Use new componentInfo approach
          try {
            await tabManager.openInTab(data.path, componentInfo);
          } catch (e) {
            console.warn('[ProjectExplorerAdapter] openInTab with component failed, trying preview:', e?.message || e);
            await tabManager.openInPreview(data.path, componentInfo);
          }
        }
      }
    });

    // Perform actual deletion when requested via context menu
    this.events.on('file.delete.requested', async (data) => {
      try {
        if (!data || !data.path) return;
        await this.projectExplorer.deleteNode(data.path);
      } catch (e) {
        console.warn('[ProjectExplorerAdapter] Failed handling file.delete.requested:', e);
      }
    });

    // Optional: handle rename requests emitted by context menu
    this.events.on('file.rename.requested', async (data) => {
      try {
        if (!data || !data.path) return;
        const node = this.projectExplorer.getNodeByPath(data.path);
        if (!node) return;
        await this.projectExplorer.renameNode(data.path, node.type);
      } catch (e) {
        console.warn('[ProjectExplorerAdapter] Failed handling file.rename.requested:', e);
      }
    });
  }

  isPaletteFile(filePath) {
    if (!filePath) return false;
    const extension = filePath.split('.').pop().toLowerCase();
    return ['pal', 'act', 'aco'].includes(extension);
  }
}

// Service adapter registry
class ServiceAdapterRegistry {
  constructor(services, events) {
    this.services = services;
    this.events = events;
    this.adapters = new Map();
  }

  registerAdapter(serviceName, AdapterClass) {
    const service = this.services.get(serviceName);
    if (service) {
      const adapter = new AdapterClass(service, this.services, this.events);
      this.adapters.set(serviceName, adapter);
      console.log(`[ServiceAdapter] Registered adapter for ${serviceName}`);
    }
  }

  initializeAllAdapters() {
    this.registerAdapter('gameEmulator', GameEmulatorAdapter);
    this.registerAdapter('tabManager', TabManagerAdapter);
    this.registerAdapter('buildSystem', BuildSystemAdapter);
    this.registerAdapter('projectExplorer', ProjectExplorerAdapter);
  }

  getAdapter(serviceName) {
    return this.adapters.get(serviceName);
  }
}

// Export
window.ServiceAdapterRegistry = ServiceAdapterRegistry;
