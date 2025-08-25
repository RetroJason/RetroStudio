// component-registry.js
// Enhanced registry for editors, viewers, and tools

class ComponentRegistry {
  constructor(pluginSystem) {
    this.plugins = pluginSystem;
    this.editors = new Map();
    this.viewers = new Map();
    this.tools = new Map();
    this.fileAssociations = new Map();
  }

  // Register an editor
  registerEditor(editorInfo) {
    const { 
      name, 
      extensions, 
      displayName, 
      icon, 
      editorClass, 
      priority = 10,
      capabilities = [],
      canCreate = false,
      singleInstance = false,
      needsFilenamePrompt = true
    } = editorInfo;

    // Validate required methods
    this.validateComponent(editorClass, 'editor');

    // Store editor
    this.editors.set(name, {
      name,
      extensions: Array.isArray(extensions) ? extensions : [extensions],
      displayName,
      icon,
      editorClass,
      priority,
      capabilities,
      canCreate,
      singleInstance,
      needsFilenamePrompt
    });

    // Register file associations
    const extensionList = Array.isArray(extensions) ? extensions : [extensions];
    extensionList.forEach(ext => {
      if (!this.fileAssociations.has(ext)) {
        this.fileAssociations.set(ext, { editors: [], viewers: [] });
      }
      this.fileAssociations.get(ext).editors.push({ name, priority });
      this.fileAssociations.get(ext).editors.sort((a, b) => a.priority - b.priority);
    });

    console.log(`[ComponentRegistry] Registered editor: ${name} for ${extensionList.join(', ')}`);
  }

  // Derive a kebab-case unique name from a class, stripping common suffixes
  _deriveName(componentClass, typeHint) {
    const clsName = componentClass?.name || 'component';
    let base = clsName
      .replace(/(Editor|Viewer)$/i, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase();
    if (!base) base = typeHint || 'component';
    return `${base}-${typeHint || 'component'}`;
  }

  // Try to get supported extensions from a class
  _deriveExtensions(componentClass, fallback = ['*']) {
    try {
      if (typeof componentClass.getFileExtensions === 'function') {
        const exts = componentClass.getFileExtensions();
        if (Array.isArray(exts) && exts.length) return exts;
      }
      if (typeof componentClass.getFileExtension === 'function') {
        const ext = componentClass.getFileExtension();
        if (ext) return [ext];
      }
      // Also allow instance prototype methods
      if (typeof componentClass.prototype?.getFileExtensions === 'function') {
        const exts = componentClass.prototype.getFileExtensions();
        if (Array.isArray(exts) && exts.length) return exts;
      }
      if (typeof componentClass.prototype?.getFileExtension === 'function') {
        const ext = componentClass.prototype.getFileExtension();
        if (ext) return [ext];
      }
    } catch (_) {}
    return fallback;
  }

  _deriveDisplayName(componentClass, defaultName) {
    try {
      if (typeof componentClass.getDisplayName === 'function') return componentClass.getDisplayName();
      if (typeof componentClass.prototype?.getDisplayName === 'function') return componentClass.prototype.getDisplayName();
    } catch (_) {}
    // Title-case the default
    const t = (defaultName || 'Component').replace(/(^|[-_])([a-z])/g, (_, p1, p2) => (p1 ? ' ' : '') + p2.toUpperCase());
    return t;
  }

  _deriveIcon(componentClass, defaultIcon = '') {
    try {
      if (typeof componentClass.getIcon === 'function') return componentClass.getIcon();
    } catch (_) {}
    return defaultIcon;
  }

  _derivePriority(componentClass, defaultPriority = 10) {
    try {
      if (typeof componentClass.getPriority === 'function') return componentClass.getPriority();
    } catch (_) {}
    return defaultPriority;
  }

  _deriveCapabilities(componentClass) {
    try {
      if (typeof componentClass.getCapabilities === 'function') return componentClass.getCapabilities() || [];
    } catch (_) {}
    return [];
  }

  _deriveSingleInstance(componentClass) {
    try {
      if (typeof componentClass.singleInstance === 'boolean') return componentClass.singleInstance;
      if (typeof componentClass.getSingleInstance === 'function') return !!componentClass.getSingleInstance();
    } catch (_) {}
    return false;
  }

  _deriveCanCreate(editorClass) {
    try {
      if (typeof editorClass.canCreate === 'boolean') return editorClass.canCreate;
      if (typeof editorClass.showCreateDialog === 'function') return true;
      if (typeof editorClass.createNew === 'function') return true;
    } catch (_) {}
    return false;
  }

  _deriveNeedsFilenamePrompt(editorClass) {
    try {
      if (typeof editorClass.needsFilenamePrompt === 'function') return editorClass.needsFilenamePrompt();
      if (typeof editorClass.needsFilenamePrompt === 'boolean') return editorClass.needsFilenamePrompt;
    } catch (_) {}
    return true; // Default to true for existing behavior
  }

  // Public helpers to auto-register by class
  autoRegisterEditor(editorClass) {
    const name = this._deriveName(editorClass, 'editor');
    const extensions = this._deriveExtensions(editorClass, null); // No fallback for editors
    if (!extensions || !Array.isArray(extensions) || extensions.length === 0) {
      throw new Error(`Editor '${name}' must implement getFileExtensions() method that returns a non-empty array of supported file extensions`);
    }
    const displayName = this._deriveDisplayName(editorClass, name);
    const icon = this._deriveIcon(editorClass, '✏️');
    const priority = this._derivePriority(editorClass, 10);
    const capabilities = this._deriveCapabilities(editorClass);
    const canCreate = this._deriveCanCreate(editorClass);
    const singleInstance = this._deriveSingleInstance(editorClass);
    const needsFilenamePrompt = this._deriveNeedsFilenamePrompt(editorClass);

    this.registerEditor({
      name,
      extensions,
      displayName,
      icon,
      editorClass,
      priority,
      capabilities,
      canCreate,
      singleInstance,
      needsFilenamePrompt
    });
  }

  autoRegisterViewer(viewerClass) {
    const name = this._deriveName(viewerClass, 'viewer');
    const extensions = this._deriveExtensions(viewerClass, null); // No fallback for viewers
    if (!extensions || !Array.isArray(extensions) || extensions.length === 0) {
      throw new Error(`Viewer '${name}' must implement getFileExtensions() method that returns a non-empty array of supported file extensions`);
    }
    const displayName = this._deriveDisplayName(viewerClass, name);
    const icon = this._deriveIcon(viewerClass, '👁️');
    const priority = this._derivePriority(viewerClass, 10);
    const capabilities = this._deriveCapabilities(viewerClass);

    this.registerViewer({
      name,
      extensions,
      displayName,
      icon,
      viewerClass,
      priority,
      capabilities
    });
  }

  // Register a viewer
  registerViewer(viewerInfo) {
    const { 
      name, 
      extensions, 
      displayName, 
      icon, 
      viewerClass, 
      priority = 10,
  capabilities = [],
  singleInstance = false
    } = viewerInfo;

    // Validate required methods
    this.validateComponent(viewerClass, 'viewer');

    // Store viewer
    this.viewers.set(name, {
      name,
      extensions: Array.isArray(extensions) ? extensions : [extensions],
      displayName,
      icon,
      viewerClass,
      priority,
      capabilities,
      singleInstance
    });

    // Register file associations
    const extensionList = Array.isArray(extensions) ? extensions : [extensions];
    extensionList.forEach(ext => {
      if (!this.fileAssociations.has(ext)) {
        this.fileAssociations.set(ext, { editors: [], viewers: [] });
      }
      this.fileAssociations.get(ext).viewers.push({ name, priority });
      this.fileAssociations.get(ext).viewers.sort((a, b) => a.priority - b.priority);
    });

    console.log(`[ComponentRegistry] Registered viewer: ${name} for ${extensionList.join(', ')}`);
  }

  // Register a tool
  registerTool(toolInfo) {
    const { 
      name, 
      displayName, 
      icon, 
      toolClass, 
      category = 'general',
      dependencies = []
    } = toolInfo;

    this.tools.set(name, {
      name,
      displayName,
      icon,
      toolClass,
      category,
      dependencies
    });

    console.log(`[ComponentRegistry] Registered tool: ${name} (${category})`);
  }

  // Get best editor for file
  getEditorForFile(filePath) {
    const extension = this.getFileExtension(filePath);
    const associations = this.fileAssociations.get(extension);
    
    if (associations && associations.editors.length > 0) {
      const editorName = associations.editors[0].name;
      return this.editors.get(editorName);
    }
    
    return null;
  }

  // Get best viewer for file
  getViewerForFile(filePath) {
    const extension = this.getFileExtension(filePath);
    
    // Special case: Route images in source directory to texture editor
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tga'];
    if (imageExtensions.includes(extension)) {
      // Check if this is in a source directory (Resources/Sources/ or similar)
      const normalizedPath = filePath.replace(/\\/g, '/');
      if (normalizedPath.includes('/Sources/') || normalizedPath.includes('\\Sources\\')) {
        // Return texture editor as viewer for source images
        const textureEditor = this.editors.get('texture-editor');
        if (textureEditor) {
          console.log('[ComponentRegistry] Routing source image to texture editor:', filePath);
          return textureEditor;
        }
      }
    }
    
    const associations = this.fileAssociations.get(extension);
    
    if (associations && associations.viewers.length > 0) {
      const viewerName = associations.viewers[0].name;
      return this.viewers.get(viewerName);
    }
    
    // Fallback: find any viewer registered for '*' (wildcard), prefer lowest priority
    let fallback = null;
    for (const v of this.viewers.values()) {
      if (Array.isArray(v.extensions) && v.extensions.includes('*')) {
        if (!fallback || v.priority < fallback.priority) fallback = v;
      }
    }
    return fallback;
  }

  // Create editor instance
  createEditor(editorInfo, file, path, isNewResource = false, options = {}) {
    const { editorClass } = editorInfo;
    // Use new constructor signature: (fileObject, readOnly)
    return new editorClass(file, options.readOnly || false);
  }

  // Create viewer instance
  createViewer(viewerInfo, file, path) {
    const { viewerClass } = viewerInfo;
    return new viewerClass(file, path);
  }

  // Get all editors
  getAllEditors() {
    return Array.from(this.editors.values());
  }

  // Get all viewers
  getAllViewers() {
    return Array.from(this.viewers.values());
  }

  // Get all editors that can create new files
  getCreatableEditors() {
    const creatableEditors = Array.from(this.editors.values())
      .filter(editor => editor.canCreate);
    
    console.log(`[ComponentRegistry] Found ${creatableEditors.length} creatable editors:`, 
                creatableEditors.map(e => e.name));
    
    return creatableEditors;
  }

  // Get all tools by category
  getToolsByCategory(category) {
    return Array.from(this.tools.values())
      .filter(tool => tool.category === category);
  }

  // Get all compatible components (editors and viewers) for a file extension
  getComponentsForExtension(extension) {
    const components = [];
    
    // Get all editors for this extension
    for (const editor of this.editors.values()) {
      if (editor.extensions.includes(extension) || editor.extensions.includes('*')) {
        components.push({
          type: 'editor',
          name: editor.name,
          displayName: editor.displayName,
          class: editor.editorClass,
          icon: editor.icon,
          priority: editor.priority
        });
      }
    }
    
    // Get all viewers for this extension  
    for (const viewer of this.viewers.values()) {
      if (viewer.extensions.includes(extension) || viewer.extensions.includes('*')) {
        components.push({
          type: 'viewer',
          name: viewer.name,
          displayName: viewer.displayName,
          class: viewer.viewerClass,
          icon: viewer.icon,
          priority: viewer.priority
        });
      }
    }
    
    // Sort by priority (lower numbers = higher priority)
    components.sort((a, b) => a.priority - b.priority);
    
    return components;
  }

  // Utility methods
  getFileExtension(filePath) {
    // Accept strings, file records, or File objects; return safe extension or empty string
    if (filePath == null) return '';
    let fp = filePath;
    if (typeof fp !== 'string') {
      // Try common shapes
      if (fp && typeof fp.path === 'string') {
        fp = fp.path;
      } else if (fp && typeof fp.name === 'string') {
        fp = fp.name;
      } else {
        return '';
      }
    }
    const dotIndex = fp.lastIndexOf('.');
    return dotIndex >= 0 ? fp.substring(dotIndex).toLowerCase() : '';
  }

  validateComponent(componentClass, type) {
    const requiredMethods = {
      editor: ['getDisplayName', 'getFileExtension', 'getElement'],
      viewer: ['getElement'],
      tool: ['execute']
    };

    const required = requiredMethods[type] || [];
    for (const method of required) {
      if (typeof componentClass.prototype[method] !== 'function' && 
          typeof componentClass[method] !== 'function') {
        throw new Error(`${type} must implement ${method}() method`);
      }
    }
  }

  // Static convenience method for registration
  static register(type, componentClass) {
    const componentRegistry = window.serviceContainer.get('componentRegistry');
    if (type.toLowerCase().includes('viewer')) {
      componentRegistry.autoRegisterViewer(componentClass);
    } else if (type.toLowerCase().includes('editor')) {
      componentRegistry.autoRegisterEditor(componentClass);
    } else {
      console.warn(`[ComponentRegistry] Unknown component type '${type}' for ${componentClass.name}`);
    }
  }
}

// Export for use
window.ComponentRegistry = ComponentRegistry;
