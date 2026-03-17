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
    
    // Use event-driven approach instead of polling
    window.serviceContainer.waitForService('componentRegistry', 5000)
      .then((componentRegistry) => {
        console.log('[RibbonToolbar] Component registry is ready');
        this.componentRegistry = componentRegistry;
        this.setupDynamicCreateButtons();
      })
      .catch((error) => {
        console.error('[RibbonToolbar] Timeout waiting for component registry:', error);
      });
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
      const hasProject = !!(window.gameEmulator?.projectExplorer?.getFocusedProjectName?.());
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
      const focusedProject = window.gameEmulator?.projectExplorer?.getFocusedProjectName?.();
      if (!focusedProject) {
        alert('No active project');
        return;
      }
      
      // Simply open a new editor with no file object - let the editor handle filename prompting
      if (window.gameEmulator && window.gameEmulator.tabManager) {
        try {
          await window.gameEmulator.tabManager.openNewEditor(editorInfo);
          console.log(`[RibbonToolbar] Opened new ${editorInfo.displayName} editor`);
        } catch (error) {
          console.error(`[RibbonToolbar] Failed to open new editor:`, error);
          alert(`Failed to create ${editorInfo.displayName}: ${error.message}`);
        }
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
  this.setupButton('saveBtn', async () => {
    if (window.gameEmulator && window.gameEmulator.tabManager) {
      try {
        const count = await window.gameEmulator.tabManager.saveActiveTab();
        if (count === 1) {
          window.gameEmulator.updateStatus('Saved active file', 'success');
        } else {
          window.gameEmulator.updateStatus('Active file not modified', 'info');
        }
      } catch (error) {
        console.error('[RibbonToolbar] Failed to save active file:', error);
        window.gameEmulator.updateStatus(`Failed to save: ${error.message}`, 'error');
      }
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
    this.setupButton('saveTemplateBtn', async () => {
      await this.saveProjectAsTemplate();
    });
    this.setupButton('exportRwaBtn', async () => {
      await this.exportProjectRwa();
    });
    this.setupButton('importRwpBtn', async () => {
      await this.importProjectRwp();
    });
    
    // Project operations
    this.setupButton('buildBtn', async () => {
      if (!window.gameEmulator) return;
      const result = await window.gameEmulator.buildProject();
      this.showBuildSummaryPopup(result);
    });
    
    // Note: Create buttons are now handled dynamically
  }

  // Export current focused project as .rwp
  async exportProjectRwp() {
    try {
      const project = window.gameEmulator?.projectExplorer?.getFocusedProjectName?.();
      if (!project) return alert('No active project');
      const svc = window.serviceContainer?.get?.('rwpService') || window.rwpService;
      if (!svc) return alert('Project export service unavailable');
      await svc.exportProject(project);
    } catch (e) {
      console.error('[RibbonToolbar] Export failed:', e);
      alert('Export failed: ' + (e?.message || e));
    }
  }

  async saveProjectAsTemplate() {
    try {
      const project = window.gameEmulator?.projectExplorer?.getFocusedProjectName?.();
      if (!project) return alert('No active project');
      const svc = window.serviceContainer?.get?.('rwpService') || window.rwpService;
      if (!svc) return alert('Project export service unavailable');

      const suggested = `${project.replace(/\s+/g, '')}Template.rwp`;
      const form = await (window.ModalUtils?.showForm?.('Save As Template', [
        { name: 'fileName', type: 'text', label: 'Template File Name', required: true, placeholder: suggested }
      ], { okText: 'Save Template' }) ?? Promise.resolve(null));
      if (!form) return;

      let fileName = (form.fileName || '').trim() || suggested;
      fileName = fileName.replace(/[\\/:*?"<>|]/g, '_');
      if (!fileName.toLowerCase().endsWith('.rwp')) fileName += '.rwp';

      const result = await svc.exportProject(project, { fileName, skipDownload: true, returnBlob: true });
      if (!result?.blob) throw new Error('Template export did not produce an archive');

      // Browser sandbox cannot write directly into repository folders.
      // We download the archive so it can be moved into RetroStudio/templates.
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      window.gameEmulator?.updateStatus?.(`Template downloaded: ${fileName}`, 'success');
    } catch (e) {
      console.error('[RibbonToolbar] Save template failed:', e);
      alert('Save template failed: ' + (e?.message || e));
    }
  }

  // Build and export current focused project as .rwa runtime package
  async exportProjectRwa() {
    try {
      const project = window.gameEmulator?.projectExplorer?.getFocusedProjectName?.();
      if (!project) return alert('No active project');
      const svc = window.serviceContainer?.get?.('rwaService') || window.rwaService;
      if (!svc) return alert('Runtime export service unavailable');

      window.gameEmulator?.updateStatus?.('Building and exporting runtime package...', 'info');
      const pkg = await svc.exportProject(project, { buildBeforeExport: true });
      window.gameEmulator?.updateStatus?.(`Exported ${pkg?.filename || 'runtime package'} successfully`, 'success');
    } catch (e) {
      console.error('[RibbonToolbar] RWA export failed:', e);
      window.gameEmulator?.updateStatus?.(`RWA export failed: ${e?.message || e}`, 'error');
      alert('RWA export failed: ' + (e?.message || e));
    }
  }

  showBuildSummaryPopup(result) {
    const summary = result?.summary || {};
    const ok = result && result.success !== false;
    const title = ok ? 'Build Summary' : 'Build Failed';
    const lines = [
      `${title}`,
      '',
      `Success: ${ok ? 'yes' : 'no'}`,
      `Total files: ${summary.total ?? 0}`,
      `Built: ${summary.success ?? 0}`,
      `Errors: ${summary.errors ?? 0}`,
      `Time: ${summary.time != null ? summary.time + ' ms' : 'n/a'}`
    ];

    if (!ok && result?.error) {
      lines.push('', `Error: ${result.error}`);
    }

    // Intentional popup only for the explicit Build button flow.
    alert(lines.join('\n'));
  }

  getPackageAssetFolder(projectName) {
    const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi)
      ? window.ProjectPaths.getSourcesRootUi()
      : 'Sources';
    return `${projectName}/${sourcesRoot}/Package`;
  }

  async saveAssetToProject(file, projectName, subFolder, filename) {
    const explorer = window.gameEmulator?.projectExplorer;
    if (!explorer) throw new Error('ProjectExplorer unavailable');

    const folderPath = `${this.getPackageAssetFolder(projectName)}/${subFolder}`;
    const targetName = filename || file.name;
    const outFile = (file.name === targetName) ? file : new File([await file.arrayBuffer()], targetName, { type: file.type || 'application/octet-stream' });
    await explorer.addFileToProject(outFile, folderPath, true, true);

    // Return relative path used by package settings.
    const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi)
      ? window.ProjectPaths.getSourcesRootUi()
      : 'Sources';
    return `${sourcesRoot}/Package/${subFolder}/${targetName}`;
  }

  async captureSimulatorPng(defaultName = 'capture.png') {
    const canvas = document.querySelector('#game-canvas');
    if (!canvas) throw new Error('Simulator canvas not found. Run the simulator first.');

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to capture simulator frame');
    return new File([blob], defaultName, { type: 'image/png' });
  }

  async chooseFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
      input.click();
    });
  }

  async createDefaultIcon32File() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to create icon canvas');

    // Small readable launcher icon with high contrast.
    ctx.fillStyle = '#0b132b';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#1c2541';
    ctx.fillRect(2, 2, 28, 28);
    ctx.strokeStyle = '#5bc0be';
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 3, 26, 26);
    ctx.fillStyle = '#e0fbfc';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RW', 16, 17);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to encode default icon32');
    return new File([blob], 'icon32.png', { type: 'image/png' });
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

      // Build options for selection. Always include an explicit empty project mode
      // so users can create brand-new template seeds.
      const options = [
        { value: '__empty__', text: 'Blank Project - No template files' },
        ...templates.map(t => ({ value: t.id, text: `${t.icon || ''} ${t.name} — ${t.description}`.trim() }))
      ];
      const pick = await (window.ModalUtils?.showForm?.('Choose Template', [
        { name: 'templateId', type: 'select', label: 'Template', options, required: true }
      ], { okText: 'Create Project' }) ?? Promise.resolve(null));
      if (!pick) return;

      if (pick.templateId === '__empty__') {
        const explorer = window.gameEmulator?.projectExplorer;
        if (!explorer) throw new Error('ProjectExplorer unavailable');
        if (explorer.projectData?.structure?.[projectName]) {
          alert('A project with that name is already open');
          return;
        }

        explorer.addProject(projectName);
        explorer.setFocusedProjectName(projectName);

        // Explicit backstop to guarantee package scaffold/default assets for blank projects.
        if (typeof explorer.applyTemplateDefaults === 'function') {
          await explorer.applyTemplateDefaults(projectName);
        } else if (typeof explorer.ensurePackageScaffold === 'function') {
          await explorer.ensurePackageScaffold(projectName);
        }

        if (typeof explorer.initializeProjectConfig === 'function') {
          await explorer.initializeProjectConfig();
        }

        if (typeof explorer.openPackageSettingsForProject === 'function') {
          await explorer.openPackageSettingsForProject(projectName, true);
        }

        window.gameEmulator?.updateStatus?.(`Created blank project: ${projectName}`, 'success');
        return;
      }

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
    if (!window.gameEmulator || !window.gameEmulator.tabManager) {
      console.error('[RibbonToolbar] GameEmulator or TabManager not available');
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
      if (editor.path && window.gameEmulator?.tabManager) {
        await window.gameEmulator.tabManager.openInTab(editor.path, editor.file);
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
    // Update save button based on whether there are any modified tabs
    let hasModifiedTabs = false;
    
    if (window.gameEmulator && window.gameEmulator.tabManager) {
      const tabManager = window.gameEmulator.tabManager;
      
      // Check if preview tab is modified
      if (tabManager.previewViewer && 
          typeof tabManager.previewViewer.isModified === 'function' && 
          tabManager.previewViewer.isModified()) {
        hasModifiedTabs = true;
      }
      
      // Check dedicated tabs for modifications
      if (!hasModifiedTabs) {
        for (const [tabId, tabInfo] of tabManager.dedicatedTabs.entries()) {
          if (tabInfo.viewer && 
              typeof tabInfo.viewer.isModified === 'function' && 
              tabInfo.viewer.isModified()) {
            hasModifiedTabs = true;
            break;
          }
        }
      }
    }
    
    this.updateButtonState('saveBtn', hasModifiedTabs);
    
    const saveBtn = this.buttons['saveBtn'];
    if (saveBtn) {
      if (hasModifiedTabs) {
        saveBtn.title = 'Save All Modified Files';
      } else {
        saveBtn.title = 'No modified files to save';
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
