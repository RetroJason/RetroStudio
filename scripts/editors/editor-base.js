// editor-base.js
// Base class for all resource editors (extends ViewerBase)

console.log('[EditorBase] Class definition loading - NEW CONSTRUCTOR SIGNATURE VERSION');

class EditorBase extends ViewerBase {
  constructor(fileObject = null, readOnly = false) {
    // Extract path from file object or use null for new files
    const path = fileObject?.path || null;
    console.log(`[EditorBase] Constructor called with NEW SIGNATURE - fileObject:`, fileObject, `readOnly:`, readOnly);
    console.log(`[EditorBase] fileObject is null:`, fileObject === null, `fileObject is undefined:`, fileObject === undefined);
    super(path);
    
    this.file = fileObject;
    this.isNewResource = !fileObject; // New file if no file object provided
    this.readOnly = readOnly;

    console.log(`[EditorBase] Set this.isNewResource to: ${this.isNewResource}`);
    this.isDirty = false;
    this.hasUnsavedChanges = false;
    
    // New files should start as dirty since they need to be saved
    if (this.isNewResource) {
      this.isDirty = true;
      this.hasUnsavedChanges = true;
      console.log(`[EditorBase] New file created - marked as dirty`);
    }
    
    this._readonlyGuardsInstalled = false;
    this._boundGuards = null;
    
    // Add editor-specific classes
    this.element.classList.add('editor-content');
    
    // Setup save handlers
    this.setupSaveHandlers();
  }

  // Enable/disable read-only mode for editors
  setReadOnly(isReadOnly) {
    this.readOnly = !!isReadOnly;
    if (this.element) {
      this.element.classList.toggle('readonly', this.readOnly);
    }
    if (this.readOnly) {
      this._installReadOnlyGuards();
  this._showReadOnlyOverlay();
    } else {
      this._removeReadOnlyGuards();
  this._hideReadOnlyOverlay();
    }
  }

  _installReadOnlyGuards() {
    if (!this.element || this._readonlyGuardsInstalled) return;
    const root = this.element;
    const onBeforeInput = (e) => {
      const t = e.target;
      if (this._isEditableTarget(t)) {
        e.preventDefault(); e.stopPropagation();
      }
    };
    const onKeyDown = (e) => {
      const t = e.target;
      if (!this._isEditableTarget(t)) return;
      // Allow navigation and copy/select all
      const allowedCombos = (
        (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'a')
      ) || ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Tab','Escape'].includes(e.key);
      if (!allowedCombos) {
        e.preventDefault(); e.stopPropagation();
      }
    };
    const onPaste = (e) => {
      const t = e.target; if (this._isEditableTarget(t)) { e.preventDefault(); e.stopPropagation(); }
    };
    const onDrop = (e) => {
      const t = e.target; if (this._isEditableTarget(t)) { e.preventDefault(); e.stopPropagation(); }
    };
    const onClick = (e) => {
      // Block interactive controls (buttons, links, elements with data-action)
      const t = e.target.closest('button, [role="button"], a[href], [data-action], .toolbar button');
      if (t && root.contains(t)) { e.preventDefault(); e.stopPropagation(); }
    };
    // Capture phase to intercept early
    root.addEventListener('beforeinput', onBeforeInput, true);
    root.addEventListener('keydown', onKeyDown, true);
    root.addEventListener('paste', onPaste, true);
    root.addEventListener('drop', onDrop, true);
    root.addEventListener('click', onClick, true);
    this._boundGuards = { onBeforeInput, onKeyDown, onPaste, onDrop, onClick };
    this._readonlyGuardsInstalled = true;
  }

  _removeReadOnlyGuards() {
    if (!this.element || !this._readonlyGuardsInstalled || !this._boundGuards) return;
    const root = this.element;
    const { onBeforeInput, onKeyDown, onPaste, onDrop, onClick } = this._boundGuards;
    root.removeEventListener('beforeinput', onBeforeInput, true);
    root.removeEventListener('keydown', onKeyDown, true);
    root.removeEventListener('paste', onPaste, true);
    root.removeEventListener('drop', onDrop, true);
    root.removeEventListener('click', onClick, true);
    this._boundGuards = null;
    this._readonlyGuardsInstalled = false;
  }

  _showReadOnlyOverlay() {
    if (!this.element) return;
    if (this._roOverlay && this._roOverlay.parentNode) return; // already present
    const overlay = document.createElement('div');
    overlay.className = 'editor-readonly-overlay';
    // Optional badge text
    const badge = document.createElement('div');
    badge.className = 'editor-readonly-badge';
    badge.textContent = 'Read-only';
    overlay.appendChild(badge);
    // Ensure root can position overlay
    this.element.style.position = this.element.style.position || 'relative';
    this.element.appendChild(overlay);
    this._roOverlay = overlay;
  }

  _hideReadOnlyOverlay() {
    if (this._roOverlay && this._roOverlay.parentNode) {
      this._roOverlay.parentNode.removeChild(this._roOverlay);
    }
    this._roOverlay = null;
  }

  _isEditableTarget(t) {
    if (!t) return false;
    if (t.closest && t.closest('.editor-content.readonly') == null) return false;
    const tag = (t.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') {
      const type = (t.getAttribute('type') || 'text').toLowerCase();
      return type !== 'hidden';
    }
    if (t.isContentEditable) return true;
    return false;
  }
  
  // Helper method to get filename from path
  getFileName() {
    if (!this.path) return 'untitled';
    return this.path.split('/').pop() || this.path.split('\\').pop() || 'untitled';
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
  
  // Override createElement to create editor content without toolbar
  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'viewer-content editor-content';
    
    // Create body (no toolbar)
    const body = document.createElement('div');
    body.className = 'viewer-body editor-body';
    this.createBody(body);
    
    this.element.appendChild(body);
  }
  
  // Mark editor as having unsaved changes
  markDirty() {
    if (!this.isDirty) {
      this.isDirty = true;
      this.hasUnsavedChanges = true;
      console.log(`[EditorBase] Editor marked as dirty`);
      
      // Emit event for TabManager to listen to
      if (window.eventBus) {
        window.eventBus.emit('editor.content.changed', { editor: this });
      }
      
      // Fallback: directly notify TabManager if eventBus not available
      if (window.tabManager) {
        window.tabManager.notifyContentChanged(this);
      } else if (window.gameEditor?.tabManager) {
        window.gameEditor.tabManager.notifyContentChanged(this);
      }
      
      this.updateTabTitle();
    }
  }
  
  // Mark editor as clean (saved)
  markClean() {
    this.isDirty = false;
    this.hasUnsavedChanges = false;
    console.log(`[EditorBase] Editor marked as clean`);
    
    // Emit event for TabManager to listen to
    if (window.eventBus) {
      window.eventBus.emit('editor.content.saved', { editor: this });
    }
    
    // Fallback: directly notify TabManager if eventBus not available
    if (window.tabManager) {
      window.tabManager.notifyContentSaved(this);
    } else if (window.gameEditor?.tabManager) {
      window.gameEditor.tabManager.notifyContentSaved(this);
    }
    
    this.updateTabTitle();
  }
  
  // Method that TabManager uses to check if editor is modified
  isModified() {
    return this.isDirty || this.hasUnsavedChanges;
  }
  
  updateTabTitle() {
    // TabManager now handles tab title updates automatically
    // This method is kept for compatibility but does nothing
    // The dirty state is communicated via notifyContentChanged/notifyContentSaved
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
      console.log(`[EditorBase] Saving ${this.path}, content length: ${content.length}, isNewResource: ${this.isNewResource}`);
      
      if (this.isNewResource) {
        // New resource - need to save to project
        await this.saveNewResource(content);
      } else {
        // Existing resource - update file
        await this.saveExistingResource(content);
      }
      
      this.markClean();
      console.log(`[EditorBase] Saved ${this.path}`);
    } catch (error) {
      console.error('[EditorBase] Save failed:', error);
      // Keep the tab dirty since save failed
      alert(`Failed to save: ${error.message}`);
    }
  }
  
  // Save as new file
  async saveAs() {
    const newName = prompt('Enter new filename:', this.getFileName());
    if (!newName) return;
    
    try {
      const content = this.getContent();
      
      // Save as new resource
      await this.saveNewResource(content, newName);
      
  // Path has been updated in saveNewResource to the full UI path
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
    const name = filename || this.getFileName();
    const blob = new Blob([content], { type: 'text/plain' });
    const file = new File([blob], name, { type: 'text/plain' });
    
    // Determine the appropriate directory based on file extension
    const extension = this.getFileExtension(name);
  const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
  let targetPath = `${sourcesRoot}/Binary`; // Default fallback
    
    if (extension === '.lua') {
  targetPath = `${sourcesRoot}/Lua`;
    } else if (['.mod', '.xm', '.s3m', '.it', '.mptm'].includes(extension)) {
  targetPath = `${sourcesRoot}/Music`;
    } else if (extension === '.wav' || extension === '.sfx') {
  targetPath = `${sourcesRoot}/SFX`;
    } else if (['.pal', '.act', '.aco'].includes(extension)) {
  targetPath = `${sourcesRoot}/Palettes`;
    }
    
  // Build UI path (project-prefixed) and storage path (normalized)
  const project = window.gameEditor?.projectExplorer?.getFocusedProjectName?.();
  const uiFolderPath = window.ProjectPaths?.withProjectPrefix ? window.ProjectPaths.withProjectPrefix(project, targetPath) : (project ? `${project}/${targetPath}` : targetPath);
  const fullUiPath = `${uiFolderPath}/${name}`;
  const storagePath = window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(fullUiPath) : fullUiPath;
    
    try {
      // Save to persistent storage using the file I/O service
      if (window.fileIOService) {
        const builderId = extension === '.sfx' ? 'sfx' : undefined;
        await window.fileIOService.saveFile(storagePath, content, {
          type: extension,
          editor: this.constructor.name,
          ...(builderId ? { builderId } : {})
        });
        console.log(`[EditorBase] Saved to persistent storage: ${storagePath}`);
      }
    } catch (error) {
      console.warn(`[EditorBase] Failed to save to persistent storage: ${error.message}`);
      // Continue with in-memory storage as fallback
    }
    
    // Add to project explorer and update the file in the project structure
    if (window.gameEditor && window.gameEditor.projectExplorer) {
      // Ensure UI path is project-prefixed for the explorer structure
      window.gameEditor.projectExplorer.addFileToProject(file, uiFolderPath, true); // Skip auto-open during save
    }
    
    this.path = fullUiPath;
    this.isNewResource = false;
    
    console.log(`[EditorBase] Created new resource: ${name} in ${targetPath}`);
    
    // Resource is now saved and has proper path - no need to update tabs
    // The TabManager will open this with the correct path from the start
  }
  
  async saveExistingResource(content) {
    try {
      // Use FileManager to save content
      const fileManager = window.serviceContainer?.get('fileManager');
      const storagePath = window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(this.path) : this.path;
      if (fileManager && this.path) {
        await fileManager.saveFile(storagePath, content, {
          type: this.getFileExtension(this.path),
          editor: this.constructor.name
        });
        console.log(`[EditorBase] Saved to persistent storage: ${storagePath}`);
      } else {
        // Fallback to direct fileIOService
        if (window.fileIOService && this.path) {
          await window.fileIOService.saveFile(storagePath, content, {
            type: this.getFileExtension(this.path),
            editor: this.constructor.name
          });
          console.log(`[EditorBase] Saved to persistent storage: ${storagePath}`);
        }
      }
    } catch (error) {
      console.warn(`[EditorBase] Failed to save to persistent storage: ${error.message}`);
      throw error;
    }
    
    // Update the file in the project structure if needed
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
      
      // Update the file metadata if it exists
      if (current[fileName]) {
        current[fileName].lastModified = Date.now();
        console.log(`[EditorBase] Updated existing file: ${fileName} in ${folderPath}`);
      }
    }
    
    console.log(`[EditorBase] Updated existing resource: ${this.getFileName()}`);
    
    // File updated - UI will sync via events
  }
  
  // Check if editor can be closed (prompt if unsaved changes)
  canClose() {
    if (this.hasUnsavedChanges) {
      if (this._discardConfirmed) {
        return true;
      }
      if (window.ModalUtils && typeof window.ModalUtils.showConfirm === 'function') {
  // Return a promise so TabManager can await; track discard confirmation
  return window.ModalUtils.showConfirm(
          'Unsaved changes',
          `${this.getFileName()} has unsaved changes. Close without saving?`,
          { okText: 'Discard', cancelText: 'Cancel', danger: true }
  ).then((ok) => { this._discardConfirmed = !!ok; return ok; });
      } else {
        const result = confirm(`${this.getFileName()} has unsaved changes. Close without saving?`);
  this._discardConfirmed = !!result;
  return result;
      }
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
      if (this._discardConfirmed) {
        // User already chose to discard; don't prompt again
      } else {
      const ask = async () => {
        if (window.ModalUtils && typeof window.ModalUtils.showConfirm === 'function') {
          const save = await window.ModalUtils.showConfirm(
            'Save changes',
            `${this.getFileName()} has unsaved changes. Save before closing?`,
            { okText: 'Save', cancelText: 'Don\'t Save' }
          );
          if (save) await this.save();
        } else {
          const save = confirm(`${this.getFileName()} has unsaved changes. Save before closing?`);
          if (save) this.save();
        }
      };
      // Fire and forget; Tab close flow should have already confirmed discard if needed
      ask();
      }
    }
    
    super.destroy();
  }
  
  // Instance method to get file extension from filename
  getFileExtension(filename) {
    if (!filename || typeof filename !== 'string') {
      console.warn('[EditorBase] getFileExtension called with invalid filename:', typeof filename, filename);
      return '';
    }
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
    const displayName = this.getDisplayName();
    const extension = this.getFileExtension();
    const defaultBaseName = `new_${displayName.toLowerCase().replace(/\s+/g, '_')}`;
    let currentUniqueName = null; // Store the current unique name
    
    const result = await ModalUtils.showForm(`Create New ${displayName}`, [
      {
        name: 'name',
        type: 'text',
        label: 'File Name:',
        defaultValue: defaultBaseName,
        placeholder: 'Enter filename...',
        required: true,
        hint: `Name for your ${displayName.toLowerCase()} (without ${extension} extension)`,
        validator: (value) => {
          const trimmed = value.trim();
          if (trimmed.length === 0) return false;
          // Check for invalid filename characters
          const invalidChars = /[<>:"/\\|?*]/;
          return !invalidChars.test(trimmed);
        },
        onInput: async (value, formData) => {
          console.log(`[${this.name}] onInput called with value: ${value}`);
          // Real-time duplicate checking and preview
          let testName = value.trim();
          if (!testName.toLowerCase().endsWith(extension.toLowerCase())) {
            testName += extension;
          }
          
          try {
            // Check for duplicates and show what the actual filename will be
            const uniqueName = await EditorRegistry.getUniqueFileName(testName);
            currentUniqueName = uniqueName; // Store for later use
            console.log(`[${this.name}] Duplicate check: ${testName} -> ${uniqueName}`);
            
            // Update hint to show the actual filename that will be created
            const modal = document.querySelector('.modal-dialog');
            if (modal) {
              const hintEl = modal.querySelector('.form-hint');
              if (hintEl) {
                let displayName = uniqueName;
                if (displayName.toLowerCase().endsWith(extension.toLowerCase())) {
                  displayName = displayName.substring(0, displayName.length - extension.length);
                }
                
                if (displayName !== value.trim()) {
                  hintEl.textContent = `Will be created as: ${displayName}${extension}`;
                  hintEl.style.color = '#ffa500'; // Orange to indicate change
                } else {
                  hintEl.textContent = `Name for your ${this.getDisplayName().toLowerCase()} (without ${extension} extension)`;
                  hintEl.style.color = ''; // Reset color
                }
              }
            }
          } catch (error) {
            console.error(`[${this.name}] Error during duplicate check:`, error);
            currentUniqueName = null;
          }
        }
      }
    ]);
    
    if (!result) return null; // User cancelled
    
    // Use the stored unique name if available, otherwise generate it
    let finalName;
    if (currentUniqueName) {
      finalName = currentUniqueName;
    } else {
      let name = result.name.trim();
      // Ensure proper extension
      if (!name.toLowerCase().endsWith(extension.toLowerCase())) {
        name += extension;
      }
      // Make sure the final name is unique
      finalName = await EditorRegistry.getUniqueFileName(name);
    }
    
    console.log(`[${this.name}] Final name selected: ${finalName}`);
    
    return { 
      name: finalName,
      uniqueNameChecked: true
    };
  }
}

// Export for use
window.EditorBase = EditorBase;
