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
    let finalFilename = filename;
    let project, extension, targetPath, uiFolderPath, fullUiPath, storagePath;
    
    // Loop until user provides a valid filename or cancels
    while (true) {
      // If no filename provided, show standardized save dialog
      if (!finalFilename) {
        let defaultName = this.getFileName() || 'untitled';
        extension = this.constructor.getFileExtension ? this.constructor.getFileExtension() : this.getFileExtension();
        
        // Remove existing extension from default name for cleaner prompt
        let baseName = defaultName;
        if (baseName.includes('.')) {
          baseName = baseName.substring(0, baseName.lastIndexOf('.'));
        }
        
        // For new resources with "untitled" default, make it unique to avoid conflicts
        if (this.isNewResource && baseName === 'untitled') {
          baseName = await this._generateUniqueFilename('untitled', extension);
        }
        
        const result = await window.ModalUtils.showForm(`Save ${this.constructor.getDisplayName()}`, [
          {
            name: 'filename',
            type: 'text',
            label: `Filename${extension}`,
            defaultValue: baseName,
            placeholder: 'Enter filename without extension',
            required: true,
            hint: `File will be saved with ${extension} extension`
          }
        ], { okText: 'Save', cancelText: 'Cancel' });
        
        if (!result || !result.filename) {
          console.log(`[EditorBase] Save cancelled by user`);
          return;
        }
        
        finalFilename = result.filename + extension;
      }
      
      // Calculate paths for the current filename
      project = window.gameEditor?.projectExplorer?.getFocusedProjectName?.();
      extension = this.getFileExtension(finalFilename);
      const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
      targetPath = `${sourcesRoot}/Binary`; // Default fallback
      
      if (extension === '.lua') {
        targetPath = `${sourcesRoot}/Lua`;
      } else if (['.mod', '.xm', '.s3m', '.it', '.mptm'].includes(extension)) {
        targetPath = `${sourcesRoot}/Music`;
      } else if (extension === '.wav' || extension === '.sfx') {
        targetPath = `${sourcesRoot}/SFX`;
      } else if (['.pal', '.act', '.aco'].includes(extension)) {
        targetPath = `${sourcesRoot}/Palettes`;
      }
      
      uiFolderPath = window.ProjectPaths?.withProjectPrefix ? window.ProjectPaths.withProjectPrefix(project, targetPath) : (project ? `${project}/${targetPath}` : targetPath);
      fullUiPath = `${uiFolderPath}/${finalFilename}`;
      storagePath = window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(fullUiPath) : fullUiPath;
      
      // Check if file exists within the current project scope
      let fileExistsInProject = false;
      if (window.gameEditor?.projectExplorer?.fileExists) {
        // Use project-scoped file existence check
        fileExistsInProject = window.gameEditor.projectExplorer.fileExists(fullUiPath);
      } else {
        // Fallback: check via project structure (project-scoped)
        const projectStructure = window.gameEditor?.projectExplorer?.projectData?.structure;
        if (projectStructure) {
          const pathParts = fullUiPath.split('/');
          let current = projectStructure;
          
          for (const part of pathParts) {
            if (current[part]) {
              current = current[part].type === 'folder' ? current[part].children : current[part];
            } else {
              current = null;
              break;
            }
          }
          fileExistsInProject = !!current;
        }
      }
      
      if (fileExistsInProject) {
        const shouldOverwrite = await window.ModalUtils.showConfirm(
          'File Exists', 
          `File "${finalFilename}" already exists in this project. Overwrite?`,
          { okText: 'Overwrite', cancelText: 'Cancel', danger: true }
        );
        if (!shouldOverwrite) {
          console.log(`[EditorBase] Overwrite cancelled by user - prompting for new filename`);
          finalFilename = null; // Reset filename to prompt again
          continue; // Go back to filename prompt
        }
      }
      
      // If we get here, either file doesn't exist or user chose to overwrite
      break;
    }
    
    // Prepare a File object (best-effort; handle binary and text)
    let file;
    try {
      const isBinary = content instanceof Uint8Array || content instanceof ArrayBuffer;
      const blobParts = [];
      if (isBinary) {
        blobParts.push(content);
      } else if (typeof content === 'string') {
        blobParts.push(content);
      } else {
        // Fallback: JSON stringify unknown objects
        blobParts.push(JSON.stringify(content));
      }
      const mime = isBinary ? 'application/octet-stream' : 'text/plain';
      const blob = new Blob(blobParts, { type: mime });
      file = new File([blob], finalFilename, { type: mime });
    } catch (e) {
      console.warn('[EditorBase] Failed to construct File object:', e);
    }
    
    try {
      // Save to persistent storage using the file I/O service
      if (window.fileIOService) {
        const builderId = extension === '.sfx' ? 'sfx' : undefined;
        const metadata = {
          type: extension,
          editor: this.constructor.name,
          ...(builderId ? { builderId } : {})
        };
        
        console.log(`[EditorBase] About to save to file I/O service:`);
        console.log(`[EditorBase] - Path: ${storagePath}`);
        // Debug: Log what getContent returns vs what we received
        console.log(`[EditorBase] saveNewResource debug - incoming content length: ${content ? content.length : 'null/undefined'}`);
        if (typeof this.getContent === 'function') {
          const live = this.getContent();
          console.log(`[EditorBase] getContent() returned length: ${live ? live.length : 'null/undefined'}`);
          console.log(`[EditorBase] getContent() preview: "${live ? live.substring(0, 50) : 'null/undefined'}..."`);
          
          // If incoming content is empty but editor buffer has data (e.g. async timing), re-fetch now
          if ((content === '' || content === undefined || content === null) && live && live.length) {
            console.log('[EditorBase] Provided empty content; using live editor buffer instead (length=' + live.length + ')');
            content = live;
          }
        }
        const isBinary = content instanceof Uint8Array || content instanceof ArrayBuffer;
        const length = (content && typeof content === 'string') ? content.length : (content instanceof Uint8Array ? content.length : (content instanceof ArrayBuffer ? content.byteLength : 0));
        let preview = '';
        if (typeof content === 'string') {
          preview = content.substring(0, 100) + '...';
        } else if (content instanceof Uint8Array) {
          preview = 'Uint8Array[' + content.length + '] ' + Array.from(content.slice(0, 16)).map(b=>b.toString(16).padStart(2,'0')).join(' ') + (content.length>16?'...':'');
        } else if (content instanceof ArrayBuffer) {
          const view = new Uint8Array(content.slice(0, 16));
            preview = 'ArrayBuffer[' + content.byteLength + '] ' + Array.from(view).map(b=>b.toString(16).padStart(2,'0')).join(' ') + (content.byteLength>16?'...':'');
        } else {
          preview = (content && content.toString) ? content.toString().substring(0,50)+'...' : String(content);
        }
        console.log(`[EditorBase] - Content type: ${typeof content}`);
        console.log(`[EditorBase] - Content length: ${length}`);
        console.log(`[EditorBase] - Content preview: ${preview}`);
        console.log(`[EditorBase] - Metadata:`, metadata);
        
        await window.fileIOService.saveFile(storagePath, content, metadata);
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
    
    // Update tab manager
    if (window.gameEditor && window.gameEditor.tabManager) {
      const currentPath = this.path || 'untitled';
      console.log(`[EditorBase] Updating tab manager: currentPath="${currentPath}", storagePath="${storagePath}", filename="${finalFilename}"`);
      window.gameEditor.tabManager.updateFileReference(currentPath, storagePath, finalFilename);
    }
    
  // Keep UI path separately for display while internal path (storage key) uses normalized storagePath
  this.displayPath = fullUiPath;
  this.path = storagePath; // ensure subsequent loads/saves use the exact storage key
    this.isNewResource = false;
    if (typeof this.markClean === 'function') {
      this.markClean();
    }
    
    console.log(`[EditorBase] Created new resource: ${finalFilename} in ${targetPath}`);
    
    // Resource is now saved and has proper path - no need to update tabs
    // The TabManager will open this with the correct path from the start
      // Emit global refresh event so all tabs update
      if (window.eventBus && typeof window.eventBus.emit === 'function') {
        window.eventBus.emit('content.refresh.required');
      }
  }

  // Helper method to generate unique filename by checking existence in current project
  async _generateUniqueFilename(baseName, extension) {
    const project = window.gameEditor?.projectExplorer?.getFocusedProjectName?.();
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
    
    const uiFolderPath = window.ProjectPaths?.withProjectPrefix ? window.ProjectPaths.withProjectPrefix(project, targetPath) : (project ? `${project}/${targetPath}` : targetPath);
    
    // Helper function to check if file exists in project
    const fileExistsInProject = (filename) => {
      const fullPath = `${uiFolderPath}/${filename}`;
      
      if (window.gameEditor?.projectExplorer?.fileExists) {
        return window.gameEditor.projectExplorer.fileExists(fullPath);
      }
      
      // Fallback: check via project structure
      const projectStructure = window.gameEditor?.projectExplorer?.projectData?.structure;
      if (projectStructure) {
        const pathParts = fullPath.split('/');
        let current = projectStructure;
        
        for (const part of pathParts) {
          if (current[part]) {
            current = current[part].type === 'folder' ? current[part].children : current[part];
          } else {
            return false;
          }
        }
        return !!current;
      }
      
      return false;
    };
    
    // Check if base name is unique within the project
    let testName = baseName;
    let counter = 1;
    
    while (true) {
      const testFilename = testName + extension;
      
      if (!fileExistsInProject(testFilename)) {
        return testName; // Found unique name within project
      }
      
      counter++;
      testName = `${baseName}_${counter}`;
    }
  }
  
  async saveExistingResource(content) {
    try {
      // Use FileManager to save content
      const fileManager = window.serviceContainer.get('fileManager');
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
  
  // Close the editor - handles save prompting and returns true/false for whether close should proceed
  async close() {
    if (this.hasUnsavedChanges) {
      if (this._discardConfirmed) {
        this._performClose();
        return true;
      }
      
      if (window.ModalUtils && typeof window.ModalUtils.showForm === 'function') {
        // Use a custom 3-button dialog for better UX
        const choice = await this._showSaveDialog();
        
        switch (choice) {
          case 'save':
            try {
              await this.save();
              this._performClose();
              return true;
            } catch (error) {
              console.error('[EditorBase] Failed to save before closing:', error);
              alert(`Failed to save ${this.getFileName()}: ${error.message}`);
              return false; // Cancel close on save failure
            }
          
          case 'discard':
            this._performClose();
            return true;
          
          case 'cancel':
          default:
            return false; // Cancel close
        }
      } else {
        // Fallback to basic confirm
        const result = confirm(`${this.getFileName()} has unsaved changes. Close without saving?`);
        if (result) {
          this._performClose();
          return true;
        }
        return false;
      }
    } else {
      // No unsaved changes, safe to close
      this._performClose();
      return true;
    }
  }

  // Show a custom save dialog with Save/Discard/Cancel options
  async _showSaveDialog() {
    return new Promise((resolve) => {
      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      
      // Create modal dialog
      const dialog = document.createElement('div');
      dialog.className = 'modal-dialog';
      
      // Create modal content
      dialog.innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">Save Changes?</h3>
        </div>
        <div class="modal-body">
          <p style="color: #cccccc; margin: 0; line-height: 1.5;">
            <strong>${this.getFileName()}</strong> has unsaved changes.<br>
            What would you like to do?
          </p>
        </div>
        <div class="modal-footer">
          <button class="modal-btn modal-btn-secondary" id="modal-cancel">Cancel</button>
          <button class="modal-btn modal-btn-danger" id="modal-discard">Don't Save</button>
          <button class="modal-btn modal-btn-primary" id="modal-save">Save</button>
        </div>
      `;
      
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      
      // Get elements
      const saveBtn = dialog.querySelector('#modal-save');
      const discardBtn = dialog.querySelector('#modal-discard');
      const cancelBtn = dialog.querySelector('#modal-cancel');
      
      // Focus Save button by default
      setTimeout(() => {
        saveBtn.focus();
      }, 100);
      
      // Cleanup function
      function cleanup() {
        document.body.removeChild(overlay);
      }
      
      // Event handlers
      saveBtn.addEventListener('click', () => {
        cleanup();
        resolve('save');
      });
      
      discardBtn.addEventListener('click', () => {
        cleanup();
        resolve('discard');
      });
      
      cancelBtn.addEventListener('click', () => {
        cleanup();
        resolve('cancel');
      });
      
      // Handle keyboard
      dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveBtn.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelBtn.click();
        }
      });
      
      // Handle overlay click (close on outside click)
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          cancelBtn.click();
        }
      });
    });
  }
  
  // Perform the actual close operations
  _performClose() {
    // Subclasses can override this to add custom cleanup
    
    // Mark as closed
    this._isClosed = true;
    
    // Clear any timers or intervals
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    
    // Cleanup event listeners if any
    if (this.cleanup && typeof this.cleanup === 'function') {
      this.cleanup();
    }
  }
  
  // Legacy method for backwards compatibility - now just calls close()
  canClose() {
    console.warn('[EditorBase] canClose() is deprecated, use close() instead');
    return this.close();
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
