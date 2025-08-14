// editor-registry.js
// Registry for all available editors

class EditorRegistry {
  constructor() {
    this.editors = new Map(); // extension -> editor class
    this.registerDefaultEditors();
  }
  
  registerDefaultEditors() {
    // Register built-in editors with error handling
    try {
      if (typeof LuaEditor !== 'undefined') {
        this.registerEditor(LuaEditor);
      } else {
        console.warn('[EditorRegistry] LuaEditor not available yet');
      }
    } catch (error) {
      console.error('[EditorRegistry] Failed to register LuaEditor:', error);
    }
    
    try {
      if (typeof SoundFXEditor !== 'undefined') {
        this.registerEditor(SoundFXEditor);
      } else {
        console.warn('[EditorRegistry] SoundFXEditor not available yet');
      }
    } catch (error) {
      console.error('[EditorRegistry] Failed to register SoundFXEditor:', error);
    }
    
    console.log('[EditorRegistry] Registered default editors');
  }
  
  registerEditor(editorClass) {
    // Support either getFileExtensions() -> string[] or getFileExtension() -> string
    if ((!editorClass.getFileExtension && !editorClass.getFileExtensions) || !editorClass.getDisplayName) {
      console.error('[EditorRegistry] Editor class must implement getFileExtension() or getFileExtensions() and getDisplayName()');
      return;
    }

    let extensions = [];
    try {
      if (typeof editorClass.getFileExtensions === 'function') {
        const exts = editorClass.getFileExtensions();
        if (Array.isArray(exts)) extensions = exts;
      }
      if (extensions.length === 0 && typeof editorClass.getFileExtension === 'function') {
        const ext = editorClass.getFileExtension();
        if (ext) extensions = [ext];
      }
    } catch (e) {
      console.error('[EditorRegistry] Error reading editor extensions:', e);
      return;
    }

    if (!extensions.length) {
      console.warn('[EditorRegistry] No extensions provided for editor', editorClass.name);
      return;
    }

    for (const extension of extensions) {
      this.editors.set(extension, editorClass);
      console.log(`[EditorRegistry] Registered editor for ${extension}: ${editorClass.getDisplayName()}`);
    }
  }
  
  getEditorForFile(file) {
    const extension = this.getFileExtension(file.name);
    return this.editors.get(extension) || null;
  }
  
  getEditorForExtension(extension) {
    return this.editors.get(extension) || null;
  }
  
  getAllEditors() {
    const editorList = [];
    for (const [extension, editorClass] of this.editors.entries()) {
      editorList.push({
        extension,
        displayName: editorClass.getDisplayName(),
        icon: editorClass.getIcon ? editorClass.getIcon() : '📄',
        editorClass
      });
    }
    return editorList;
  }
  
  getFileExtension(filename) {
    const dotIndex = filename.lastIndexOf('.');
    return dotIndex >= 0 ? filename.substring(dotIndex).toLowerCase() : '';
  }
  
  createEditor(editorClass, file = null, path = null, isNewResource = false, templateOptions = null) {
    try {
      return new editorClass(file, path, isNewResource, templateOptions);
    } catch (error) {
      console.error('[EditorRegistry] Failed to create editor:', error);
      throw error;
    }
  }
  
  // Helper method to generate unique file names
  static async getUniqueFileName(baseName, targetFolder = null) {
    // Check if file already exists in project
    if (!window.gameEditor || !window.gameEditor.projectExplorer) {
      return baseName; // Can't check, return as-is
    }

    const projectData = window.gameEditor.projectExplorer.projectData;
    if (!projectData || !projectData.structure) {
      return baseName; // No project structure, return as-is
    }

    // Parse the filename
    const lastDotIndex = baseName.lastIndexOf('.');
    const nameWithoutExt = lastDotIndex > 0 ? baseName.substring(0, lastDotIndex) : baseName;
    const extension = lastDotIndex > 0 ? baseName.substring(lastDotIndex) : '';

    // Determine target folder based on extension if not specified
    if (!targetFolder) {
      if (extension === '.lua') {
  targetFolder = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? `${window.ProjectPaths.getSourcesRootUi()}/Lua` : 'Resources/Lua';
      } else if (['.mod', '.xm', '.s3m', '.it', '.mptm'].includes(extension)) {
  targetFolder = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? `${window.ProjectPaths.getSourcesRootUi()}/Music` : 'Resources/Music';
      } else if (extension === '.wav') {
  targetFolder = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? `${window.ProjectPaths.getSourcesRootUi()}/SFX` : 'Resources/SFX';
      } else if (extension === '.sfx') {
  targetFolder = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? `${window.ProjectPaths.getSourcesRootUi()}/SFX` : 'Resources/SFX';  // SFX source files go to SFX folder
      } else {
  targetFolder = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? `${window.ProjectPaths.getSourcesRootUi()}/Binary` : 'Resources/Binary';
      }
    }

    // Navigate to the target folder
    const folderParts = targetFolder.split('/');
    let current = projectData.structure;
    
    for (const part of folderParts) {
      if (current[part] && current[part].children) {
        current = current[part].children;
      } else {
        // Folder doesn't exist yet, so name is unique
        return baseName;
      }
    }

    let counter = 0;
    let testName = baseName;

    // Keep incrementing until we find a unique name
    while (current[testName]) {
      counter++;
      testName = `${nameWithoutExt}_${counter}${extension}`;
    }

    if (counter > 0) {
      console.log(`[EditorRegistry] Generated unique filename: ${testName} (${counter} duplicates found)`);
    }

    return testName;
  }

  async createNewResource(editorClass, resourceName = null) {
    try {
      let createData;
      
      if (!resourceName) {
        // Use custom dialog if the editor provides one, otherwise use default
        if (editorClass.showCreateDialog) {
          console.log('[EditorRegistry] Using custom create dialog for', editorClass.getDisplayName());
          createData = await editorClass.showCreateDialog();
        } else {
          console.log('[EditorRegistry] Using default create dialog for', editorClass.getDisplayName());
          createData = await EditorBase.showCreateDialog.call(editorClass);
        }
        
        if (!createData) {
          console.log('[EditorRegistry] User cancelled resource creation');
          return null; // User cancelled
        }
      } else {
        // If resourceName is provided, use it directly but still check for uniqueness
        let finalName = resourceName;
        const extension = editorClass.getFileExtension();
        if (!finalName.toLowerCase().endsWith(extension.toLowerCase())) {
          finalName += extension;
        }
        // Make sure the provided name is unique
        finalName = await EditorRegistry.getUniqueFileName(finalName);
        createData = { name: finalName };
      }
      
      if (!createData || !createData.name) {
        throw new Error('Invalid create data received from dialog');
      }
      
      let fileName = createData.name;
      console.log('[EditorRegistry] Creating new resource:', fileName);
      
      // Ensure proper extension
      const extension = editorClass.getFileExtension();
      if (!fileName.toLowerCase().endsWith(extension.toLowerCase())) {
        fileName += extension;
      }
      
      // If the dialog didn't already handle uniqueness, ensure it's unique
      if (!createData.uniqueNameChecked) {
        fileName = await EditorRegistry.getUniqueFileName(fileName);
      }
      
      // Create empty file object
      const emptyContent = '';
      const file = new File([emptyContent], fileName, { type: 'text/plain' });
      
      // Create editor with new resource flag and template options
      const editor = this.createEditor(editorClass, file, fileName, true, createData);
      console.log('[EditorRegistry] Successfully created new resource:', fileName);
      return editor;
    } catch (error) {
      console.error('[EditorRegistry] Failed to create new resource:', error);
      console.error('[EditorRegistry] Error details:', {
        message: error.message,
        stack: error.stack,
        editorClass: editorClass?.name || 'unknown'
      });
      throw error;
    }
  }
}

// Create global instance after a short delay to ensure all editor classes are loaded
setTimeout(() => {
  if (!window.editorRegistry) {
    window.editorRegistry = new EditorRegistry();
    console.log('[EditorRegistry] Delayed initialization completed');
  }
}, 10);

// Also create immediately in case the delay isn't needed
if (!window.editorRegistry) {
  try {
    window.editorRegistry = new EditorRegistry();
  } catch (error) {
    console.warn('[EditorRegistry] Immediate initialization failed, will retry with delay:', error);
  }
}

// Export for use
window.EditorRegistry = EditorRegistry;
