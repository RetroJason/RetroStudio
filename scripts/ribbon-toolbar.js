// ribbon-toolbar.js
// Modern ribbon-style toolbar for RetroStudio

class RibbonToolbar {
  constructor() {
    this.buttons = {};
    this.componentRegistry = null;
    this.fileCounter = 1; // Counter for new file naming
    this.init();
  }
  
  init() {
    console.log('[RibbonToolbar] Initializing...');
    this.setupButtons();
    
    // Wait for component registry to be available
    this.waitForComponentRegistry();
    
    console.log('[RibbonToolbar] Initialized');
  }

  waitForComponentRegistry() {
    console.log('[RibbonToolbar] Waiting for component registry...');
    
    const trySetupButtons = () => {
      if (window.serviceContainer && window.serviceContainer.has('componentRegistry')) {
        console.log('[RibbonToolbar] Component registry found, setting up buttons');
        this.componentRegistry = window.serviceContainer.get('componentRegistry');
        this.setupDynamicCreateButtons();
        return true;
      }
      return false;
    };

    // Try immediately
    if (!trySetupButtons()) {
      // If not available, poll every 100ms for up to 5 seconds
      let attempts = 0;
      const maxAttempts = 50;
      
      const pollForRegistry = () => {
        attempts++;
        if (trySetupButtons()) {
          console.log(`[RibbonToolbar] Component registry found after ${attempts} attempts`);
          return;
        }
        
        if (attempts < maxAttempts) {
          setTimeout(pollForRegistry, 100);
        } else {
          console.error('[RibbonToolbar] Timeout waiting for component registry');
        }
      };
      
      setTimeout(pollForRegistry, 100);
    }
  }

  setupDynamicCreateButtons() {
    console.log('[RibbonToolbar] Setting up dynamic create buttons...');
    
    if (!this.componentRegistry) {
      console.error('[RibbonToolbar] Component registry not available');
      return;
    }

    const creatableEditors = this.componentRegistry.getCreatableEditors();
    console.log('[RibbonToolbar] Found creatable editors:', creatableEditors);
    
    const createSection = document.querySelector('.ribbon-section:nth-child(2) .ribbon-buttons');
    
    if (!createSection) {
      console.error('[RibbonToolbar] Create section not found in DOM');
      return;
    }

    // Clear existing dynamic buttons
    const existingButtons = createSection.querySelectorAll('[data-dynamic="true"]');
    console.log(`[RibbonToolbar] Removing ${existingButtons.length} existing dynamic buttons`);
    existingButtons.forEach(btn => btn.remove());

    // Add buttons for each creatable editor
    creatableEditors.forEach(editorInfo => {
      console.log(`[RibbonToolbar] Adding button for ${editorInfo.displayName}`);
      this.addCreateButton(createSection, editorInfo);
    });
    
    console.log('[RibbonToolbar] Dynamic create buttons setup complete');
  }

  addCreateButton(container, editorInfo) {
    console.log(`[RibbonToolbar] Creating button for ${editorInfo.displayName}...`);
    
    const button = document.createElement('button');
    button.className = 'ribbon-btn';
    button.setAttribute('data-dynamic', 'true');
    button.title = `Create ${editorInfo.displayName}`;
    
    // Get create icon and label from editor class
    const icon = editorInfo.editorClass.getCreateIcon ? 
                 editorInfo.editorClass.getCreateIcon() : 
                 editorInfo.icon;
    const label = editorInfo.editorClass.getCreateLabel ? 
                  editorInfo.editorClass.getCreateLabel() : 
                  editorInfo.displayName;

    console.log(`[RibbonToolbar] Button details - Icon: ${icon}, Label: ${label}`);

    button.innerHTML = `
      <div class="ribbon-icon">${icon}</div>
      <div class="ribbon-text">${label}</div>
    `;

    button.addEventListener('click', () => {
      console.log(`[RibbonToolbar] Clicked create button for ${editorInfo.displayName}`);
      this.createNewResourceFromEditor(editorInfo);
    });

    container.appendChild(button);
    
    console.log(`[RibbonToolbar] Successfully added create button for ${editorInfo.displayName}`);
  }

  async createNewResourceFromEditor(editorInfo) {
    try {
      console.log(`[RibbonToolbar] Creating new ${editorInfo.displayName}`);
      
      // Generate simple filename with counter
      const counter = this.getNextFileCounter();
      const defaultName = `new_${counter}`;
      const filename = await this.promptForFilename(defaultName, editorInfo.extensions[0]);
      if (!filename) {
        return; // User cancelled
      }
      
      // Get default folder for this editor type
      const defaultFolder = editorInfo.editorClass.getDefaultFolder ? 
                            editorInfo.editorClass.getDefaultFolder() : 
                            'Resources';
      
      // Get default content
      const defaultContent = editorInfo.editorClass.createNew ? 
                            editorInfo.editorClass.createNew() : 
                            '';
      
      // Generate paths
      const extension = editorInfo.extensions[0];
      const fullPath = `${defaultFolder}/${filename}${extension}`;
      const displayFilename = `${filename}${extension}`;
      
      console.log(`[RibbonToolbar] Creating new file: ${displayFilename}, Full path: ${fullPath}`);
      
      // Use FileManager to create and save the file
      const fileManager = window.serviceContainer?.get('fileManager');
      if (!fileManager) {
        throw new Error('FileManager not available');
      }
      
      try {
        // Choose default builderId by extension
        let builderId = 'copy';
        if (window.buildSystem && window.buildSystem.getBuilderIdForExtension) {
          builderId = window.buildSystem.getBuilderIdForExtension(extension);
        } else if (extension === '.sfx') {
          builderId = 'sfx';
        }

        const fileObj = await fileManager.createAndSaveFile(fullPath, defaultContent, {
          type: extension.substring(1), // Remove the dot
          isNew: true,
          builderId
        });
        
        if (!fileObj) {
          throw new Error('Failed to create file');
        }
        
        console.log(`[RibbonToolbar] Created and saved new file: ${fullPath}`);
        
        // Add to project explorer structure (as a reference to the persisted file)
        if (window.gameEditor && window.gameEditor.projectExplorer) {
          console.log(`[RibbonToolbar] Adding file to project explorer...`);
          if (typeof window.gameEditor.projectExplorer.addFileToProject === 'function') {
            window.gameEditor.projectExplorer.addFileToProject({
              name: displayFilename,
              path: fullPath,
              isNewFile: true
            }, defaultFolder, true); // skipAutoOpen = true, we'll open manually
            console.log(`[RibbonToolbar] File added to project explorer`);
          } else {
            console.error(`[RibbonToolbar] addFileToProject method not found`);
          }
        }
        
        // Now open from storage
        if (window.gameEditor && window.gameEditor.tabManager) {
          console.log(`[RibbonToolbar] Opening file from storage...`);
          await window.gameEditor.tabManager.openInTab(fullPath);
        }
        
      } catch (error) {
        console.error(`[RibbonToolbar] Failed to create file: ${error.message}`);
        alert(`Failed to create file: ${error.message}`);
        return;
      }
      
    } catch (error) {
      console.error(`[RibbonToolbar] Failed to create ${editorInfo.displayName}:`, error);
    }
  }
  
  getNextFileCounter() {
    if (!this.fileCounter) {
      this.fileCounter = 1;
    }
    return this.fileCounter++;
  }
  
  async promptForFilename(defaultName, extension) {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'filename-modal';
      modal.innerHTML = `
        <div class="modal-content">
          <h3>Create New File</h3>
          <div class="filename-input-group">
            <label>Filename:</label>
            <input type="text" class="filename-input" value="${defaultName}" />
            <span class="extension">${extension}</span>
          </div>
          <div class="modal-buttons">
            <button class="btn cancel-btn">Cancel</button>
            <button class="btn create-btn">Create</button>
          </div>
        </div>
      `;
      
      // Add modal styles
      const style = document.createElement('style');
      style.textContent = `
        .filename-modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        }
        .filename-modal .modal-content {
          background: var(--bg-color, #2d2d2d);
          padding: 20px;
          border-radius: 8px;
          min-width: 300px;
          border: 1px solid var(--border-color, #555);
        }
        .filename-modal h3 {
          margin: 0 0 15px 0;
          color: var(--text-color, #fff);
        }
        .filename-input-group {
          display: flex;
          align-items: center;
          gap: 5px;
          margin-bottom: 15px;
        }
        .filename-input {
          flex: 1;
          padding: 8px;
          border: 1px solid var(--border-color, #555);
          background: var(--input-bg, #3a3a3a);
          color: var(--text-color, #fff);
          border-radius: 4px;
        }
        .extension {
          color: var(--text-color, #fff);
          font-weight: bold;
        }
        .modal-buttons {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }
      `;
      
      document.head.appendChild(style);
      document.body.appendChild(modal);
      
      const input = modal.querySelector('.filename-input');
      const createBtn = modal.querySelector('.create-btn');
      const cancelBtn = modal.querySelector('.cancel-btn');
      
      input.focus();
      input.select();
      
      const cleanup = () => {
        document.body.removeChild(modal);
        document.head.removeChild(style);
      };
      
      createBtn.addEventListener('click', () => {
        const filename = input.value.trim();
        if (filename) {
          cleanup();
          resolve(filename);
        }
      });
      
      cancelBtn.addEventListener('click', () => {
        cleanup();
        resolve(null);
      });
      
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const filename = input.value.trim();
          if (filename) {
            cleanup();
            resolve(filename);
          }
        } else if (e.key === 'Escape') {
          cleanup();
          resolve(null);
        }
      });
    });
  }
  
  setupButtons() {
    // File operations
    this.setupButton('saveBtn', () => {
      if (window.gameEditor) {
        window.gameEditor.saveActiveEditor();
      }
    });
    
    this.setupButton('clearDataBtn', async () => {
      await this.clearProjectData();
    });
    
    // Project operations
    this.setupButton('buildBtn', () => {
      if (window.gameEditor) {
        window.gameEditor.buildProject();
      }
    });
    
    this.setupButton('playProjectBtn', () => {
      if (window.gameEditor) {
        window.gameEditor.playProject();
      }
    });
    
    // Note: Create buttons are now handled dynamically
  }
  
  async clearProjectData() {
    const message = 'This will clear ALL project data including:\n' +
      '• All saved files in Resources/\n' +
      '• All build outputs in build/\n' +
      '• Project structure\n' +
      '• Open tabs\n\n' +
      'This action cannot be undone. Continue?';
    const confirmed = await (window.ModalUtils?.showConfirm('Clear project data', message, { okText: 'Clear All', cancelText: 'Cancel', danger: true })
      ?? Promise.resolve(confirm(message)));
    if (!confirmed) return;
    
    try {
      console.log('[RibbonToolbar] Clearing all project data...');
      let clearedCount = 0;
      
      // Prefer FileIOService clearAll (IndexedDB)
      if (window.fileIOService && typeof window.fileIOService.clearAll === 'function') {
        try {
          await window.fileIOService.clearAll();
          clearedCount = -1; // unknown exact count
          console.log('[RibbonToolbar] Cleared all records from IndexedDB');
        } catch (e) {
          console.warn('[RibbonToolbar] clearAll failed, falling back to enumerating files:', e);
        }
      }

      // Fallback: enumerate via FileManager and delete
      if (clearedCount === 0) {
        const fm = window.serviceContainer?.get?.('fileManager') || window.fileManager;
        if (fm) {
          const files = await fm.listFiles('');
          for (const rec of files) {
            const p = rec.path || rec;
            try { await fm.deleteFile(p); clearedCount++; } catch (_) {}
          }
          console.log(`[RibbonToolbar] Cleared ${clearedCount} files via FileManager`);
        }
      }

      // Close all tabs
      if (window.gameEditor?.tabManager) {
        window.gameEditor.tabManager.closeAllTabs();
      }
      
      // Clear project structure
      if (window.gameEditor?.projectExplorer) {
        window.gameEditor.projectExplorer.clearProject();
      }
      
      alert(`Project data cleared. Page will refresh.`);
      
      // Refresh the page to ensure clean state
      window.location.reload();
      
    } catch (error) {
      console.error('[RibbonToolbar] Error clearing project data:', error);
      alert('Error clearing project data: ' + error.message);
    }
  }
  
  setupButton(id, handler) {
    const button = document.getElementById(id);
    if (button) {
      button.addEventListener('click', handler);
      this.buttons[id] = button;
      console.log(`[RibbonToolbar] Setup button: ${id}`);
    } else {
      console.warn(`[RibbonToolbar] Button not found: ${id}`);
    }
  }
  
  async createNewResource(extension) {
    if (!window.gameEditor || !window.gameEditor.tabManager) {
      console.error('[RibbonToolbar] GameEditor or TabManager not available');
      return;
    }
    
    if (!window.editorRegistry) {
      console.error('[RibbonToolbar] EditorRegistry not available');
      return;
    }
    
    try {
      console.log(`[RibbonToolbar] Creating new ${extension} resource`);
      
      // Get the editor class for the extension
      const editors = window.editorRegistry.getAllEditors();
      console.log(`[RibbonToolbar] Available editors:`, editors);
      
      const editor = editors.find(e => e.extension === extension);
      console.log(`[RibbonToolbar] Found editor for ${extension}:`, editor);
      
      if (!editor) {
        console.error(`[RibbonToolbar] No editor found for extension: ${extension}`);
        console.error(`[RibbonToolbar] Available extensions:`, editors.map(e => e.extension));
        return;
      }
      
      // Create the resource first, then open it in a tab
      await this.createAndOpenResource(editor.editorClass);
    } catch (error) {
      console.error(`[RibbonToolbar] Failed to create ${extension} resource:`, error);
    }
  }
  
  async createAndOpenResource(editorClass) {
    try {
      // Step 1: Create the resource using EditorRegistry (gets proper filename)
      const editor = await window.editorRegistry.createNewResource(editorClass);
      if (!editor) return;
      
      // Step 2: Save the resource immediately to get proper path
      if (editor.isNewResource && editor.save) {
        await editor.save();
      }
      
      // Step 3: Open the saved resource in a tab
      if (editor.path && window.gameEditor?.tabManager) {
        await window.gameEditor.tabManager.openInTab(editor.path, editor.file);
      }
      
    } catch (error) {
      console.error('[RibbonToolbar] Failed to create and open resource:', error);
    }
  }
  
  updateButtonState(buttonId, enabled) {
    const button = this.buttons[buttonId];
    if (button) {
      button.disabled = !enabled;
      button.style.opacity = enabled ? '1' : '0.5';
    }
  }
  
  updateSaveButton() {
    // Update save button based on whether there's an active editor
    const hasActiveEditor = window.gameEditor && 
                           window.gameEditor.tabManager && 
                           window.gameEditor.tabManager.activeTabId;
    
    this.updateButtonState('saveBtn', hasActiveEditor);
    
    const saveBtn = this.buttons['saveBtn'];
    if (saveBtn) {
      if (hasActiveEditor) {
        saveBtn.title = 'Save Active File';
      } else {
        saveBtn.title = 'No active file to save';
      }
    }
  }
  
  // Called when tab changes to update button states
  onTabChanged() {
    this.updateSaveButton();
  }
}

// Initialize ribbon toolbar when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('[RibbonToolbar] DOM ready, initializing...');
  window.ribbonToolbar = new RibbonToolbar();
});

// Listen for application ready event
document.addEventListener('retrostudio-ready', () => {
  console.log('[RibbonToolbar] RetroStudio ready, setting up dynamic buttons...');
  if (window.ribbonToolbar) {
    window.ribbonToolbar.waitForComponentRegistry();
  }
});
