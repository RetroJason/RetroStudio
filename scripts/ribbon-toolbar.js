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

    // React to project focus changes
    try {
      window.eventBus?.on?.('project.focus.changed', () => {
        try {
          this.setupDynamicCreateButtons();
        } catch (_) {}
      });
    } catch (_) {}
    
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
      const btn = this.addCreateButton(createSection, editorInfo);
      // Disable if no active project
      const hasProject = !!(window.gameEditor?.projectExplorer?.getFocusedProjectName?.());
      btn.disabled = !hasProject;
      btn.style.opacity = hasProject ? '1' : '0.5';
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
  return button;
  }

  async createNewResourceFromEditor(editorInfo) {
    try {
      console.log(`[RibbonToolbar] Creating new ${editorInfo.displayName}`);
      const focusedProject = window.gameEditor?.projectExplorer?.getFocusedProjectName?.();
      if (!focusedProject) {
        alert('No active project');
        return;
      }
      
      // Generate simple filename with counter
      const counter = this.getNextFileCounter();
      const defaultName = `new_${counter}`;
      
      // Check if editor needs filename prompt (some editors like MOD/XM always load demo)
      let filename;
      if (editorInfo.needsFilenamePrompt === false) {
        // For editors that don't need filename prompt, create temporary editor without adding to project
        console.log(`[RibbonToolbar] Creating temporary ${editorInfo.displayName} (no file created yet)`);
        
        // Create a temporary path for the editor
        const counter = this.getNextFileCounter();
        const tempName = `untitled_${counter}${editorInfo.extensions[0]}`;
        const tempPath = `temp:///${tempName}`;
        
        // Open the editor directly without creating a file
        if (window.gameEditor && window.gameEditor.tabManager) {
          // Use the tab manager's normal opening flow but with a temporary path
          try {
            await window.gameEditor.tabManager.openInTab(tempPath, editorInfo, { forceNew: true, isTemporary: true });
            console.log(`[RibbonToolbar] Opened temporary ${editorInfo.displayName}: ${tempName}`);
          } catch (error) {
            console.error(`[RibbonToolbar] Failed to open temporary editor:`, error);
            alert(`Failed to create ${editorInfo.displayName}: ${error.message}`);
          }
        }
        return; // Exit early for temporary editors
      } else {
        filename = await this.promptForFilename(defaultName, editorInfo.extensions[0]);
        if (!filename) {
          return; // User cancelled
        }
      }
      
      // Get default folder for this editor type
  const defaultFolder = editorInfo.editorClass.getDefaultFolder ? 
            editorInfo.editorClass.getDefaultFolder() : 
            ((window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources');
      
      // Get default content
      const defaultContent = editorInfo.editorClass.createNew ? 
                            editorInfo.editorClass.createNew() : 
                            '';
      
  // Generate paths
  const extension = editorInfo.extensions[0];
  const uiFolder = window.ProjectPaths?.withProjectPrefix ? window.ProjectPaths.withProjectPrefix(focusedProject, defaultFolder) : (focusedProject ? `${focusedProject}/${defaultFolder}` : defaultFolder);
  const displayFilename = `${filename}${extension}`;
  const fullUiPath = `${uiFolder}/${displayFilename}`;
  const storagePath = window.ProjectPaths?.normalizeStoragePath ? window.ProjectPaths.normalizeStoragePath(fullUiPath) : fullUiPath;
      
  console.log(`[RibbonToolbar] Creating new file: ${displayFilename}, UI path: ${fullUiPath}`);
      
      // Use FileManager to create and save the file (robust resolution)
      let fileManager = null;
      try { fileManager = window.serviceContainer?.get('fileManager'); } catch (_) { /* not registered yet */ }
      fileManager = fileManager || window.FileManager || window.fileManager;
      if (fileManager && !fileManager.storageService && window.fileIOService) {
        try { fileManager.initialize(window.fileIOService); } catch (_) {}
        try { window.serviceContainer?.registerSingleton?.('fileManager', fileManager); } catch (_) {}
      }
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

  const fileObj = await fileManager.createAndSaveFile(storagePath, defaultContent, {
          type: extension.substring(1), // Remove the dot
          isNew: true,
          builderId
        });
        
        if (!fileObj) {
          throw new Error('Failed to create file');
        }
        
  console.log(`[RibbonToolbar] Created and saved new file: ${storagePath}`);
        
        // Add to project explorer structure (as a reference to the persisted file)
        if (window.gameEditor && window.gameEditor.projectExplorer) {
          console.log(`[RibbonToolbar] Adding file to project explorer...`);
          if (typeof window.gameEditor.projectExplorer.addFileToProject === 'function') {
            window.gameEditor.projectExplorer.addFileToProject({
              name: displayFilename,
              path: fullUiPath,
              isNewFile: true
            }, uiFolder, true); // skipAutoOpen = true, we'll open manually
            console.log(`[RibbonToolbar] File added to project explorer`);
          } else {
            console.error(`[RibbonToolbar] addFileToProject method not found`);
          }
        }
        
        // Now open from storage
        if (window.gameEditor && window.gameEditor.tabManager) {
          console.log(`[RibbonToolbar] Opening file from storage...`);
          await window.gameEditor.tabManager.openInTab(fullUiPath, editorInfo);
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
    
    // New Project
    this.setupButton('newProjectBtn', async () => {
      await this.createNewProject();
    });

    // Import/Export RWP
    this.setupButton('exportRwpBtn', async () => {
      await this.exportProjectRwp();
    });
    this.setupButton('importRwpBtn', async () => {
      await this.importProjectRwp();
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

  // Export current focused project as .rwp
  async exportProjectRwp() {
    try {
      const project = window.gameEditor?.projectExplorer?.getFocusedProjectName?.();
      if (!project) return alert('No active project');
      const svc = window.serviceContainer?.get?.('rwpService') || window.rwpService;
      if (!svc) return alert('Project export service unavailable');
      await svc.exportProject(project);
    } catch (e) {
      console.error('[RibbonToolbar] Export failed:', e);
      alert('Export failed: ' + (e?.message || e));
    }
  }

  // Import a .rwp file and create a project
  async importProjectRwp() {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.rwp,application/octet-stream,application/gzip,application/json';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const svc = window.serviceContainer?.get?.('rwpService') || window.rwpService;
        if (!svc) return alert('Project import service unavailable');
        await svc.importProject(file);
      };
      input.click();
    } catch (e) {
      console.error('[RibbonToolbar] Import failed:', e);
      alert('Import failed: ' + (e?.message || e));
    }
  }

  async createNewProject() {
    try {
      // Ask for project name first
      const form = await (window.ModalUtils?.showForm?.('New Project', [
        { name: 'projectName', type: 'text', label: 'Project Name', required: true, placeholder: 'MyProject' }
      ], { okText: 'Next' }) ?? Promise.resolve(null));
      if (!form) return;
      const projectName = (form.projectName || '').trim();
      if (!projectName) return;

      // Fetch templates (stubbed service)
      const catalog = window.serviceContainer?.get?.('templateCatalog') || window.templateCatalog;
      const templates = (await (catalog?.fetchProjectTemplates?.() ?? [])) || [];
      if (!templates.length) return alert('No templates available');

      // Build options for selection
      const options = templates.map(t => ({ value: t.id, text: `${t.icon || ''} ${t.name} — ${t.description}`.trim() }));
      const pick = await (window.ModalUtils?.showForm?.('Choose Template', [
        { name: 'templateId', type: 'select', label: 'Template', options, required: true }
      ], { okText: 'Create Project' }) ?? Promise.resolve(null));
      if (!pick) return;

      const chosen = templates.find(t => t.id === pick.templateId);
      if (!chosen) return;

      // Load the .rwp file via fetch and pass a File/Blob to import
      const resp = await fetch(chosen.path, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`Failed to load template: ${resp.status}`);
      const blob = await resp.blob();
      const file = new File([blob], `${chosen.name}.rwp`, { type: 'application/zip' });

      const svc = window.serviceContainer?.get?.('rwpService') || window.rwpService;
      if (!svc) return alert('Project import service unavailable');
      await svc.importProject(file, { projectNameOverride: projectName });
    } catch (err) {
      console.error('[RibbonToolbar] Failed to create new project:', err?.stack || err);
      alert('Failed to create project: ' + (err?.message || String(err)));
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
