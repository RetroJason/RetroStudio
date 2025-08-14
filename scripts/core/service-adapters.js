// service-adapters.js
// Adapters to integrate existing services with new core systems

class GameEditorAdapter {
  constructor(gameEditor, services, events) {
    this.gameEditor = gameEditor;
    this.services = services;
    this.events = events;
    this.setupIntegration();
  }

  setupIntegration() {
    // Make services available to game editor
    this.gameEditor.tabManager = this.services.get('tabManager');
    this.gameEditor.buildSystem = this.services.get('buildSystem');
    this.gameEditor.projectExplorer = this.services.get('projectExplorer');

    // Connect events
    this.setupEventConnections();
  }

  setupEventConnections() {
    // File operations
    this.events.on('file.save.requested', (data) => {
      this.gameEditor.saveCurrentFile();
    });

    // Build operations
    this.events.on('build.start.requested', (data) => {
      this.gameEditor.buildProject();
    });

    // Tab operations
    this.events.on('tab.close.requested', (data) => {
      this.gameEditor.tabManager.closeTab(data.tabId);
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
    const tabId = await this.tabManager.openInTab(filePath, null, { isReadOnly: false });
    this.events.emit('file.opened', { path: filePath, type: 'editor', tabId, preferred: editorInfo?.name });
    return tabId;
  }

  async openWithViewer(filePath, content, viewerInfo) {
    // Use preview for viewers by default
    const tabId = await this.tabManager.openInPreview(filePath, null, { isReadOnly: true });
    this.events.emit('file.opened', { path: filePath, type: 'viewer', tabId, preferred: viewerInfo?.name });
    return tabId;
  }

  setupEventConnections() {
    // Tab switching
    const originalSwitchToTab = this.tabManager.switchToTab.bind(this.tabManager);
    this.tabManager.switchToTab = (tabId) => {
      const previousTabId = this.tabManager.activeTabId;
      const result = originalSwitchToTab(tabId);
      
      if (previousTabId !== tabId) {
        this.events.emit('tab.switched', { tabId, previousTabId });
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
    // Enhanced context menu with component awareness
    const originalShowContextMenu = this.projectExplorer.showContextMenu.bind(this.projectExplorer);
    this.projectExplorer.showContextMenu = (eventOrX, maybeY) => {
      // Support both legacy (x, y) and new (event, filePath) signatures
      let event = null;
      let filePath = null;

      if (typeof eventOrX === 'object' && eventOrX && 'clientX' in eventOrX) {
        // Called with MouseEvent
        event = eventOrX;
      } else if (typeof eventOrX === 'number' && typeof maybeY === 'number') {
        // Called with coordinates
        event = { pageX: eventOrX, pageY: maybeY };
      } else {
        // Fallback: synthesize at 0,0
        event = { pageX: 0, pageY: 0 };
      }

      // Derive filePath from currently selected node when not provided
      try {
        const sel = this.projectExplorer.selectedNode;
        if (sel && typeof sel.dataset?.path === 'string') {
          filePath = sel.dataset.path;
        }
      } catch (_) { /* ignore */ }

      return this.showEnhancedContextMenu(event, filePath, originalShowContextMenu);
    };

    this.setupEventConnections();
  }

  async showEnhancedContextMenu(event, filePath, originalShow) {
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
    let editor = null, viewer = null;
    try { editor = this.componentRegistry.getEditorForFile(filePath); } catch (_) { editor = null; }
    try { viewer = this.componentRegistry.getViewerForFile(filePath); } catch (_) { viewer = null; }

    // Add component-specific menu items only for files
    if (!isFolder) {
      if (editor) {
        menuItems.push({
          label: `Edit with ${editor.displayName}`,
          icon: editor.icon,
          action: () => this.openWithEditor(filePath, editor)
        });
      }

      if (viewer) {
        menuItems.push({
          label: `View with ${viewer.displayName}`,
          icon: viewer.icon,
          action: () => this.openWithViewer(filePath, viewer)
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
      const menuItem = document.createElement('div');
  // Use class that matches existing CSS (.context-item) for proper hover highlight
  menuItem.className = 'context-item';
      menuItem.innerHTML = `${item.icon || ''} ${item.label}`;
      menuItem.onclick = (e) => {
        try { item.action?.(e); } finally { removeMenu(); }
      };
      menu.appendChild(menuItem);
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
      // If a preferred component was specified, still use tabManager API; registry inside will choose best option
      if (data && data.path) {
        try {
          await tabManager.openInTab(data.path);
        } catch (e) {
          console.warn('[ProjectExplorerAdapter] openInTab failed, trying preview:', e?.message || e);
          await tabManager.openInPreview(data.path);
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
    this.registerAdapter('gameEditor', GameEditorAdapter);
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
