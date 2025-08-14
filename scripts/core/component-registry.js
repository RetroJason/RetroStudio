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
      canCreate = false
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
      canCreate
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

  // Register a viewer
  registerViewer(viewerInfo) {
    const { 
      name, 
      extensions, 
      displayName, 
      icon, 
      viewerClass, 
      priority = 10,
      capabilities = []
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
      capabilities
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
    const associations = this.fileAssociations.get(extension);
    
    if (associations && associations.viewers.length > 0) {
      const viewerName = associations.viewers[0].name;
      return this.viewers.get(viewerName);
    }
    
    // Fallback to hex viewer
    return this.viewers.get('hex-viewer');
  }

  // Create editor instance
  createEditor(editorInfo, file, path, isNewResource = false, options = {}) {
    const { editorClass } = editorInfo;
    return new editorClass(file, path, isNewResource, options);
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
}

// Export for use
window.ComponentRegistry = ComponentRegistry;
