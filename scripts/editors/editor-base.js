// editor-base.js
// Base class for all resource editors (extends ViewerBase)

class EditorBase extends ViewerBase {
  constructor(file, path, isNewResource = false, templateOptions = null) {
    console.log(`[EditorBase] Constructor called with isNewResource: ${isNewResource}`);
    super(file, path);
    this.isNewResource = isNewResource;
    console.log(`[EditorBase] Set this.isNewResource to: ${this.isNewResource}`);
    this.isDirty = false;
    this.hasUnsavedChanges = false;
    this.templateOptions = templateOptions;
    
    // Add editor-specific classes
    this.element.classList.add('editor-content');
    
    // Setup save handlers
    this.setupSaveHandlers();
  }
  
  setupSaveHandlers() {
    // Ctrl+S to save
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 's' && this.isActiveEditor()) {
        e.preventDefault();
        this.save();
      }
    });
  }
  
  isActiveEditor() {
    // Check if this editor is currently active
    if (!window.tabManager) return false;
    
    const activeTabData = window.tabManager.tabs.get(window.tabManager.activeTabId);
    return activeTabData && activeTabData.viewer === this;
  }
  
  // Override createElement to add editor toolbar
  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'viewer-content editor-content';
    
    // Create toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    this.createToolbar(toolbar);
    
    // Create body
    const body = document.createElement('div');
    body.className = 'viewer-body editor-body';
    this.createBody(body);
    
    this.element.appendChild(toolbar);
    this.element.appendChild(body);
  }
  
  createToolbar(toolbarContainer) {
    // Create status indicator only
    const statusSpan = document.createElement('span');
    statusSpan.className = 'editor-status';
    statusSpan.textContent = this.isNewResource ? 'New Resource' : 'Saved';
    this.statusSpan = statusSpan;
    
    // Add file path info
    const pathSpan = document.createElement('span');
    pathSpan.className = 'editor-path';
    pathSpan.textContent = this.file.name;
    pathSpan.style.color = '#999999';
    pathSpan.style.fontSize = '12px';
    pathSpan.style.marginLeft = '15px';
    
    toolbarContainer.appendChild(pathSpan);
    toolbarContainer.appendChild(statusSpan);
  }
  
  // Mark editor as having unsaved changes
  markDirty() {
    if (!this.isDirty) {
      this.isDirty = true;
      this.hasUnsavedChanges = true;
      this.updateStatus('Modified');
      this.updateTabTitle();
    }
  }
  
  // Mark editor as clean (saved)
  markClean() {
    this.isDirty = false;
    this.hasUnsavedChanges = false;
    this.updateStatus('Saved');
    this.updateTabTitle();
    this.updateToolbarPath();
  }
  
  updateToolbarPath() {
    const pathSpan = this.element ? this.element.querySelector('.editor-path') : null;
    if (pathSpan) {
      const displayPath = this.path || this.file.name;
      pathSpan.textContent = displayPath;
    }
  }
  
  updateStatus(status) {
    if (this.statusSpan) {
      this.statusSpan.textContent = status;
      this.statusSpan.className = 'editor-status ' + status.toLowerCase().replace(' ', '-');
    }
  }
  
  updateTabTitle() {
    // Find the tab for this editor and update its title
    if (window.tabManager && window.tabManager.activeTabId) {
      // Find the tab data for this editor
      for (const [tabId, tabData] of window.tabManager.tabs.entries()) {
        if (tabData.viewer === this) {
          const tabElement = tabData.element;
          if (tabElement) {
            const titleSpan = tabElement.querySelector('.tab-title');
            if (titleSpan) {
              const baseName = this.file.name;
              titleSpan.textContent = this.isDirty ? `${baseName} *` : baseName;
              
              // Also add/remove dirty class
              if (this.isDirty) {
                tabElement.classList.add('dirty');
              } else {
                tabElement.classList.remove('dirty');
              }
            }
          }
          break;
        }
      }
    }
  }
  
  // Get the current content (override in subclasses)
  getContent() {
    return '';
  }
  
  // Set content (override in subclasses)
  setContent(content) {
    // Override in subclasses
  }
  
  // Save the current content
  async save() {
    try {
      const content = this.getContent();
      console.log(`[EditorBase] Saving ${this.file.name}, content length: ${content.length}, isNewResource: ${this.isNewResource}`);
      
      if (this.isNewResource) {
        // New resource - need to save to project
        await this.saveNewResource(content);
      } else {
        // Existing resource - update file
        await this.saveExistingResource(content);
      }
      
      this.markClean();
      console.log(`[EditorBase] Saved ${this.file.name}`);
    } catch (error) {
      console.error('[EditorBase] Save failed:', error);
      this.updateStatus('Save Failed');
      alert(`Failed to save: ${error.message}`);
    }
  }
  
  // Save as new file
  async saveAs() {
    const newName = prompt('Enter new filename:', this.file.name);
    if (!newName) return;
    
    try {
      const content = this.getContent();
      
      // Create new file object
      const newFile = new File([content], newName, { type: 'text/plain' });
      
      // Save as new resource
      await this.saveNewResource(content, newName);
      
      // Update editor to point to new file
      this.file = newFile;
      this.path = newName;
      this.isNewResource = false;
      this.markClean();
      
      console.log(`[EditorBase] Saved as ${newName}`);
    } catch (error) {
      console.error('[EditorBase] Save As failed:', error);
      alert(`Failed to save as: ${error.message}`);
    }
  }
  
  async saveNewResource(content, filename = null) {
    // For now, we'll create a blob and simulate saving
    // In a real implementation, this would save to the project structure
    const name = filename || this.file.name;
    const blob = new Blob([content], { type: 'text/plain' });
    const file = new File([blob], name, { type: 'text/plain' });
    
    // Determine the appropriate directory based on file extension
    const extension = this.getFileExtension(name);
    let targetPath = 'Resources/Binary'; // Default fallback
    
    if (extension === '.lua') {
      targetPath = 'Resources/Lua';
    } else if (['.mod', '.xm', '.s3m', '.it', '.mptm'].includes(extension)) {
      targetPath = 'Resources/Music';
    } else if (extension === '.wav' || extension === '.sfx') {
      targetPath = 'Resources/SFX';
    }
    
    const fullPath = `${targetPath}/${name}`;
    
    try {
      // Save to persistent storage using the file I/O service
      if (window.fileIOService) {
        await window.fileIOService.saveFile(fullPath, content, {
          type: extension,
          editor: this.constructor.name
        });
        console.log(`[EditorBase] Saved to persistent storage: ${fullPath}`);
      }
    } catch (error) {
      console.warn(`[EditorBase] Failed to save to persistent storage: ${error.message}`);
      // Continue with in-memory storage as fallback
    }
    
    // Add to project explorer and update the file in the project structure
    if (window.gameEditor && window.gameEditor.projectExplorer) {
      window.gameEditor.projectExplorer.addFileToProject(file, targetPath);
      window.gameEditor.projectExplorer.renderTree(); // Refresh the tree view
    }
    
    this.file = file;
    this.path = fullPath;
    this.isNewResource = false;
    
    console.log(`[EditorBase] Created new resource: ${name} in ${targetPath}`);
    
    // Update tab data if this editor is in a tab
    if (window.tabManager) {
      window.tabManager.updateTabFile(this, file);
    }
  }
  
  async saveExistingResource(content) {
    // Create updated file with new content
    const blob = new Blob([content], { type: 'text/plain' });
    const file = new File([blob], this.file.name, { type: 'text/plain' });
    
    try {
      // Save to persistent storage using the file I/O service
      if (window.fileIOService && this.path) {
        await window.fileIOService.saveFile(this.path, content, {
          type: this.getFileExtension(this.file.name),
          editor: this.constructor.name
        });
        console.log(`[EditorBase] Saved to persistent storage: ${this.path}`);
      }
    } catch (error) {
      console.warn(`[EditorBase] Failed to save to persistent storage: ${error.message}`);
      // Continue with in-memory storage as fallback
    }
    
    // Update the file in the project structure
    if (window.gameEditor && window.gameEditor.projectExplorer && this.path) {
      const pathParts = this.path.split('/');
      const fileName = pathParts.pop();
      const folderPath = pathParts.join('/');
      
      // Navigate to the file location and update it
      const parts = folderPath.split('/');
      let current = window.gameEditor.projectExplorer.projectData.structure;
      
      for (const part of parts) {
        if (current[part] && current[part].type === 'folder') {
          current = current[part].children;
        }
      }
      
      // Update the file
      if (current[fileName]) {
        current[fileName].file = file;
        current[fileName].lastModified = file.lastModified;
        console.log(`[EditorBase] Updated existing file: ${fileName} in ${folderPath}`);
      }
    }
    
    this.file = file;
    console.log(`[EditorBase] Updated existing resource: ${this.file.name}`);
    
    // Update tab data if this editor is in a tab
    if (window.tabManager) {
      window.tabManager.updateTabFile(this, file);
    }
  }
  
  // Check if editor can be closed (prompt if unsaved changes)
  canClose() {
    if (this.hasUnsavedChanges) {
      const result = confirm(`${this.file.name} has unsaved changes. Close without saving?`);
      return result;
    }
    return true;
  }
  
  // Lifecycle methods
  onFocus() {
    super.onFocus();
    // Editor-specific focus handling
  }
  
  onBlur() {
    super.onBlur();
    // Editor-specific blur handling
  }
  
  destroy() {
    // Check for unsaved changes before destroying
    if (this.hasUnsavedChanges) {
      const save = confirm(`${this.file.name} has unsaved changes. Save before closing?`);
      if (save) {
        this.save();
      }
    }
    
    super.destroy();
  }
  
  // Instance method to get file extension from filename
  getFileExtension(filename) {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot) : '';
  }
  
  // Static method to get file extension for this editor type
  static getFileExtension() {
    return '.txt'; // Override in subclasses
  }
  
  // Static method to get display name for this editor type
  static getDisplayName() {
    return 'Text Editor'; // Override in subclasses
  }

  // Static method to show custom creation dialog
  // Returns Promise<{name: string, ...otherData}> or null if cancelled
  static async showCreateDialog() {
    const defaultName = `new_${this.getDisplayName().toLowerCase().replace(/\s+/g, '_')}${this.getFileExtension()}`;
    
    const name = await ModalUtils.showPrompt(
      `Create New ${this.getDisplayName()}`,
      'Enter filename:',
      defaultName,
      {
        validator: (value) => {
          const trimmed = value.trim();
          if (trimmed.length === 0) return false;
          // Check for invalid filename characters
          const invalidChars = /[<>:"/\\|?*]/;
          return !invalidChars.test(trimmed);
        }
      }
    );
    
    if (!name) return null; // User cancelled
    
    // Ensure proper extension
    let finalName = name.trim();
    const extension = this.getFileExtension();
    if (!finalName.toLowerCase().endsWith(extension.toLowerCase())) {
      finalName += extension;
    }
    
    return { name: finalName };
  }
}

// Export for use
window.EditorBase = EditorBase;
