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
    // Override openFile to use component registry
    const originalOpenFile = this.tabManager.openFile.bind(this.tabManager);
    this.tabManager.openFile = (filePath, content) => {
      return this.openFileWithComponents(filePath, content, originalOpenFile);
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

  openWithEditor(filePath, content, editorInfo) {
    const EditorClass = editorInfo.editorClass;
    const editor = new EditorClass();
    
    const tabId = this.tabManager.createTab({
      title: this.getFileName(filePath),
      type: 'editor',
      filePath: filePath,
      editor: editor,
      icon: editorInfo.icon
    });

    editor.setContent(content);
    this.events.emit('file.opened', { path: filePath, type: 'editor', tabId });
    
    return tabId;
  }

  openWithViewer(filePath, content, viewerInfo) {
    const ViewerClass = viewerInfo.viewerClass;
    const viewer = new ViewerClass();
    
    const tabId = this.tabManager.createTab({
      title: this.getFileName(filePath),
      type: 'viewer',
      filePath: filePath,
      viewer: viewer,
      icon: viewerInfo.icon
    });

    viewer.setContent(content);
    this.events.emit('file.opened', { path: filePath, type: 'viewer', tabId });
    
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
    this.pluginSystem = services.get('pluginSystem');
    this.setupIntegration();
  }

  setupIntegration() {
    // Hook into build process
    const originalBuild = this.buildSystem.build.bind(this.buildSystem);
    this.buildSystem.build = async (projectPath) => {
      return this.buildWithHooks(projectPath, originalBuild);
    };

    this.setupEventConnections();
  }

  async buildWithHooks(projectPath, originalBuild) {
    try {
      this.events.emit('build.started', { projectPath });

      // Run pre-build hooks
      await this.pluginSystem.runHook('build.beforeStart', { projectPath });

      // Execute build
      const result = await originalBuild(projectPath);

      // Run post-build hooks
      await this.pluginSystem.runHook('build.afterComplete', { 
        projectPath, 
        result,
        success: true 
      });

      this.events.emit('build.completed', { projectPath, result, success: true });
      
      return result;

    } catch (error) {
      await this.pluginSystem.runHook('build.afterComplete', { 
        projectPath, 
        error,
        success: false 
      });

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
    this.projectExplorer.showContextMenu = (event, filePath) => {
      return this.showEnhancedContextMenu(event, filePath, originalShowContextMenu);
    };

    this.setupEventConnections();
  }

  async showEnhancedContextMenu(event, filePath, originalShow) {
    const menuItems = [];

    // Get component info for file
    const editor = this.componentRegistry.getEditorForFile(filePath);
    const viewer = this.componentRegistry.getViewerForFile(filePath);

    // Add component-specific menu items
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

    // Add standard items
    menuItems.push(
      { label: 'Open', action: () => this.openFile(filePath) },
      { label: 'Delete', action: () => this.deleteFile(filePath) },
      { label: 'Rename', action: () => this.renameFile(filePath) }
    );

    // Run plugin hooks for additional menu items
    const hookResult = await this.pluginSystem.runHook('ui.createContextMenu', {
      filePath,
      menuItems,
      event
    });

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
    
    items.forEach(item => {
      const menuItem = document.createElement('div');
      menuItem.className = 'context-menu-item';
      menuItem.innerHTML = `${item.icon || ''} ${item.label}`;
      menuItem.onclick = item.action;
      menu.appendChild(menuItem);
    });

    document.body.appendChild(menu);
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';

    // Remove on click outside
    const removeMenu = () => {
      if (menu.parentNode) {
        menu.parentNode.removeChild(menu);
      }
      document.removeEventListener('click', removeMenu);
    };
    
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
    this.events.on('file.open.requested', (data) => {
      const tabManager = this.services.get('tabManager');
      tabManager.openFile(data.path);
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
