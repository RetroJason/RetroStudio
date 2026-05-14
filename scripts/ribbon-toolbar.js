// ribbon-toolbar.js
// Modern ribbon-style toolbar for RetroStudio

class RibbonToolbar {
  constructor() {
    this.buttons = {};
    this.componentRegistry = null;
    this.fileCounter = 1; // Counter for new file naming
    this.ribbonColorValue = '0xFFFFFF';
    this.ribbonToolbar = null;
    this.hostedSaveStateIndicator = null;
    this.hostedSaveStateLabel = null;
    this.init();
  }
  
  init() {
    console.log('[RibbonToolbar] Initializing...');
    this.setupButtons();
    this.setupFileMenu();
    this.setupColorPicker();
    this.setupHostedSaveIndicator();
    this.setupResponsiveRibbon();
    
    // Wait for component registry to be available
    this.waitForComponentRegistry();

    // React to project focus changes and component loading
    try {
      window.eventBus?.on?.('project.focus.changed', () => {
        try {
          this.setupDynamicCreateButtons();
        } catch (_) {}
      });
      window.eventBus?.on?.('components.loaded', () => {
        try {
          this.setupDynamicCreateButtons();
        } catch (_) {}
      });
    } catch (_) {}
    
    console.log('[RibbonToolbar] Initialized');
  }

  setupHostedSaveIndicator() {
    this.hostedSaveStateIndicator = document.getElementById('hostedSaveState');
    this.hostedSaveStateLabel = document.getElementById('hostedSaveStateLabel');

    if (!this.hostedSaveStateIndicator || !this.hostedSaveStateLabel) {
      return;
    }

    window.addEventListener('retrowww-hosted-save-state', (event) => {
      this.renderHostedSaveState(event?.detail || null);
    });

    const initialState = window.retrowwwHostedStudio?.getSaveState?.() || window.__retrowwwHostedSaveState || null;
    this.renderHostedSaveState(initialState);
  }

  renderHostedSaveState(state) {
    if (!this.hostedSaveStateIndicator || !this.hostedSaveStateLabel) {
      return;
    }

    const projectName = String(state?.projectName || '').trim();
    if (!projectName) {
      this.hostedSaveStateIndicator.classList.add('is-hidden');
      this.hostedSaveStateIndicator.removeAttribute('data-state');
      this.hostedSaveStateIndicator.title = 'Hosted save status';
      this.hostedSaveStateLabel.textContent = 'Saved';
      return;
    }

    const indicatorState = String(state?.status || 'idle');
    let label = 'No pending changes';
    let title = 'Hosted save status for ' + projectName;

    if (indicatorState === 'saving') {
      label = 'Saving...';
      title = 'Saving ' + projectName + ' to Retrowww';
    } else if (indicatorState === 'pending') {
      label = 'Unsaved changes';
      title = projectName + ' has local changes that still need to be saved to Retrowww';
    } else if (indicatorState === 'failed') {
      label = 'Save failed';
      title = state?.lastError
        ? 'Failed to save ' + projectName + ': ' + state.lastError
        : 'Failed to save ' + projectName;
    } else if (indicatorState === 'saved') {
      label = state?.lastSavedLabel ? 'Saved ' + state.lastSavedLabel : 'Saved';
      title = 'Last saved ' + projectName;
      if (state?.lastSavedLabel) {
        title += ' at ' + state.lastSavedLabel;
      }
      if (Number.isFinite(state?.revisionNumber)) {
        title += ' (revision ' + state.revisionNumber + ')';
      }
    }

    this.hostedSaveStateIndicator.classList.remove('is-hidden');
    this.hostedSaveStateIndicator.dataset.state = indicatorState;
    this.hostedSaveStateIndicator.title = title;
    this.hostedSaveStateLabel.textContent = label;
  }

  setupColorPicker() {
    this.colorPicker = document.getElementById('ribbonColorPicker');
    this.colorCopyButton = document.getElementById('ribbonColorCopyBtn');
    this.colorValueElement = document.getElementById('ribbonColorValue');

    if (!this.colorPicker || !this.colorCopyButton || !this.colorValueElement) {
      console.error('[RibbonToolbar] Color picker controls not found in DOM');
      return;
    }

    this.updateColorDisplay(this.colorPicker.value);

    this.colorPicker.addEventListener('input', async () => {
      const value = this.colorPicker.value;
      this.updateColorDisplay(value);
      await this.copyRibbonColor();
    });

    this.colorCopyButton.addEventListener('click', async () => {
      await this.copyRibbonColor();
    });
  }

  updateColorDisplay(cssColor) {
    const normalizedColor = this.normalizeColorForClipboard(cssColor);
    this.ribbonColorValue = normalizedColor;
    this.colorValueElement.textContent = normalizedColor;
    this.colorCopyButton.style.borderColor = cssColor;
    this.colorCopyButton.style.boxShadow = `inset 0 0 0 1px ${cssColor}33`;
  }

  normalizeColorForClipboard(cssColor) {
    if (typeof cssColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(cssColor)) {
      throw new Error(`[RibbonToolbar] Invalid color picker value: ${cssColor}`);
    }

    return `0x${cssColor.slice(1).toUpperCase()}`;
  }

  async copyRibbonColor() {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw new Error('[RibbonToolbar] Clipboard API is unavailable');
    }

    await navigator.clipboard.writeText(this.ribbonColorValue);
    console.log(`[RibbonToolbar] Copied ${this.ribbonColorValue} to clipboard`);
    window.gameEmulator?.updateStatus?.(`Copied ${this.ribbonColorValue}`, 'success');
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
    
    const createSection = document.querySelector('.ribbon-section[data-ribbon-group="create"] .ribbon-buttons');
    
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

    this.updateRibbonCompactState();
    
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

  setupResponsiveRibbon() {
    this.ribbonToolbar = document.querySelector('.ribbon-toolbar');
    if (!this.ribbonToolbar) {
      return;
    }

    document.addEventListener('click', (event) => {
      if (!this.ribbonToolbar.contains(event.target)) {
        this.closeFileMenu();
        this.closeAllCompactMenus();
      }
    });

    requestAnimationFrame(() => this.updateRibbonCompactState());
  }

  setupFileMenu() {
    this.fileMenuSection = document.querySelector('.ribbon-section[data-ribbon-group="file"]');
    this.fileMenuToggle = document.getElementById('fileMenuToggle');

    if (!this.fileMenuSection || !this.fileMenuToggle) {
      return;
    }

    this.fileMenuToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const shouldOpen = !this.fileMenuSection.classList.contains('file-menu-open');
      this.closeFileMenu();
      if (shouldOpen) {
        this.fileMenuSection.classList.add('file-menu-open');
        this.fileMenuToggle.setAttribute('aria-expanded', 'true');
      }
    });

    this.fileMenuSection.querySelectorAll('.ribbon-buttons .ribbon-btn').forEach((button) => {
      button.addEventListener('click', () => {
        this.closeFileMenu();
      });
    });
  }

  closeFileMenu() {
    if (!this.fileMenuSection || !this.fileMenuToggle) {
      return;
    }

    this.fileMenuSection.classList.remove('file-menu-open');
    this.fileMenuToggle.setAttribute('aria-expanded', 'false');
  }

  ensureSectionOverflowMenus() {
    const sections = this.ribbonToolbar.querySelectorAll('.ribbon-section[data-ribbon-group]');
    sections.forEach((section) => {
      if (section.querySelector('.ribbon-section-toggle')) {
        return;
      }

      const label = section.querySelector('.ribbon-label')?.textContent?.trim() || 'Menu';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'ribbon-section-toggle';
      toggle.textContent = label;
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        const shouldOpen = !section.classList.contains('compact-open');
        this.closeAllCompactMenus();
        if (shouldOpen) {
          section.classList.add('compact-open');
        }
      });

      const buttons = section.querySelector('.ribbon-buttons');
      if (buttons) {
        section.insertBefore(toggle, buttons);
      } else {
        section.appendChild(toggle);
      }
    });
  }

  closeAllCompactMenus() {
    if (!this.ribbonToolbar) {
      return;
    }

    this.ribbonToolbar.querySelectorAll('.ribbon-section.compact-open').forEach((section) => {
      section.classList.remove('compact-open');
    });
  }

  updateRibbonCompactState() {
    if (!this.ribbonToolbar) {
      return;
    }

    this.ribbonToolbar.classList.remove('ribbon-toolbar-compact');
    this.closeFileMenu();
    this.closeAllCompactMenus();
  }

  async createNewResourceFromEditor(editorInfo) {
    try {
      console.log(`[RibbonToolbar] Creating new ${editorInfo.displayName}`);
      const focusedProject = window.gameEmulator?.projectExplorer?.getFocusedProjectName?.();
      if (!focusedProject) {
        alert('No active project');
        return;
      }

      if (this.isFontEditor(editorInfo)) {
        await this.createFontResourceFromPicker(editorInfo, focusedProject);
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

  isFontEditor(editorInfo) {
    if (!editorInfo) {
      return false;
    }

    if (editorInfo.name === 'font-editor') {
      return true;
    }

    const extensions = editorInfo.extensions || editorInfo.editorClass?.getFileExtensions?.() || [];
    return Array.isArray(extensions) && extensions.includes('.font');
  }

  async createFontResourceFromPicker(editorInfo, focusedProject) {
    const fontSources = await this.listFontSources(focusedProject);
    const pickerOptions = await this.buildFontSelectionOptions(fontSources);

    const selection = await window.ModalUtils.showSelectionList(
      'Choose Font Source',
      'Pick an existing font source or upload a new one. The .font metadata file will be created after you confirm the source.',
      pickerOptions,
      {
        confirmText: 'OK',
        cancelText: 'Cancel'
      }
    );

    if (!selection) {
      return;
    }

    let selectedSource = null;

    if (selection === '__upload__') {
      selectedSource = await this.uploadNewFontSource(focusedProject);
      if (!selectedSource) {
        return;
      }
    } else {
      selectedSource = fontSources.find(source => source.path === selection) || null;
      if (!selectedSource) {
        throw new Error(`Selected font source was not found: ${selection}`);
      }
    }

    const resourceName = await this.promptForFontResourceName(selectedSource.name);
    if (!resourceName) {
      return;
    }

    const sourcesRoot = window.ProjectPaths?.getSourcesRootUi?.() || 'Sources';
    const fontFolder = `${focusedProject}/${sourcesRoot}/Fonts`;
    const fullUiPath = `${fontFolder}/${resourceName}`;
    const fileManager = window.serviceContainer?.get?.('fileManager');
    const existing = fileManager ? await fileManager.fileExists(fullUiPath) : false;

    if (existing) {
      const shouldOverwrite = await window.ModalUtils.showConfirm(
        'Overwrite Existing Font',
        `${resourceName} already exists. Replace it?`,
        { okText: 'Overwrite', cancelText: 'Cancel', danger: true }
      );

      if (!shouldOverwrite) {
        return;
      }
    }

    const fontFamily = selectedSource.name.replace(/\.[^.]+$/, '');
    const metadata = {
      type: 'retrowatch-font',
      sourceFontPath: selectedSource.path,
      fontFamily,
      fontSize: 32,
      outputPixelFormat: 'd2_mode_alpha8',
      characters: window.FontEditor?.DEFAULT_CHARACTERS || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      padding: 1,
      spacing: 1,
      antialias: true
    };

    const newFile = new File(
      [JSON.stringify(metadata, null, 2)],
      resourceName,
      { type: 'application/json' }
    );

    const projectExplorer = window.gameEditor?.projectExplorer || window.gameEmulator?.projectExplorer;
    if (!projectExplorer) {
      throw new Error('Project explorer is not available.');
    }

    await projectExplorer.addFileToProject(newFile, fontFolder, true, true);
    projectExplorer.renderTree();

    const tabManager = window.gameEmulator?.tabManager || window.serviceContainer?.get?.('tabManager');
    if (!tabManager) {
      throw new Error('Tab manager is not available.');
    }

    await tabManager.openInTab(fullUiPath, editorInfo, { isReadOnly: false });
  }

  async listFontSources(focusedProject) {
    const fileManager = window.serviceContainer?.get?.('fileManager');
    if (!fileManager) {
      throw new Error('File manager is not available.');
    }

    const sourcesRoot = window.ProjectPaths?.getSourcesRootUi?.() || 'Sources';
    const fontFolder = `${focusedProject}/${sourcesRoot}/Fonts`;
    const supportedExtensions = new Set(['.ttf', '.otf', '.woff', '.woff2']);
    const records = await fileManager.listFiles(fontFolder);

    return records
      .filter(record => {
        const path = record.path || '';
        const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
        return supportedExtensions.has(extension);
      })
      .sort((left, right) => (left.filename || left.name || '').localeCompare(right.filename || right.name || ''))
      .map(record => ({
        name: record.filename || record.name || (record.path || '').split('/').pop(),
        path: record.path,
        record
      }));
  }

  async buildFontSelectionOptions(fontSources) {
    const options = [
      {
        value: '__upload__',
        label: '<span style="font-size: 16px; font-weight: 700;">Upload a new font</span>',
        description: 'Import a .ttf, .otf, .woff, or .woff2 into Sources/Fonts.'
      }
    ];

    for (const [index, source] of fontSources.entries()) {
      const previewFamily = await this.loadFontPreviewFamily(source.record, index);
      const sampleText = 'Retro Watch 12345';
      const previewHtml = previewFamily
        ? `<div style="font-family: '${previewFamily}', sans-serif; font-size: 22px; color: #aab3be; margin-top: 4px;">${sampleText}</div>`
        : '';

      options.push({
        value: source.path,
        label: `<span style="font-size: 16px; font-weight: 700;">${source.name}</span>${previewHtml}`,
        description: source.path
      });
    }

    return options;
  }

  async loadFontPreviewFamily(record, index) {
    try {
      const content = record.content ?? record.fileContent ?? record;
      const buffer = this.coerceToArrayBuffer(content);
      if (!(buffer instanceof ArrayBuffer)) {
        return null;
      }

      const family = `font-picker-${Date.now()}-${index}`;
      const face = new FontFace(family, buffer.slice(0));
      await face.load();
      document.fonts.add(face);
      return family;
    } catch (error) {
      console.warn('[RibbonToolbar] Failed to load font preview:', error);
      return null;
    }
  }

  coerceToArrayBuffer(value) {
    if (value instanceof ArrayBuffer) {
      return value;
    }

    if (ArrayBuffer.isView(value)) {
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }

    if (typeof value === 'string') {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes.buffer;
    }

    return null;
  }

  async uploadNewFontSource(focusedProject) {
    const file = await this.pickFontFile();
    if (!file) {
      return null;
    }

    const projectExplorer = window.gameEditor?.projectExplorer || window.gameEmulator?.projectExplorer;
    if (!projectExplorer) {
      throw new Error('Project explorer is not available.');
    }

    const sourcesRoot = window.ProjectPaths?.getSourcesRootUi?.() || 'Sources';
    const fontFolder = `${focusedProject}/${sourcesRoot}/Fonts`;
    await projectExplorer.addFileToProject(file, fontFolder, true, true);
    projectExplorer.renderTree();

    return {
      name: file.name,
      path: `${focusedProject}/${sourcesRoot}/Fonts/${file.name}`,
      record: { path: `${focusedProject}/${sourcesRoot}/Fonts/${file.name}` }
    };
  }

  pickFontFile() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.ttf,.otf,.woff,.woff2';
      input.style.display = 'none';
      document.body.appendChild(input);

      input.addEventListener('change', () => {
        const [file] = input.files || [];
        document.body.removeChild(input);
        resolve(file || null);
      }, { once: true });

      input.click();
    });
  }

  async promptForFontResourceName(sourceFilename) {
    const suggestedName = `${sourceFilename.replace(/\.[^.]+$/, '')}.font`;
    const result = await window.ModalUtils.showForm('Create Font', [
      {
        name: 'filename',
        type: 'text',
        label: 'Font name',
        defaultValue: suggestedName,
        required: true,
        hint: 'Name of the .font metadata file.',
        validator: value => {
          const trimmed = value.trim();
          return trimmed.length > 0 && !/[<>:"/\\|?*]/.test(trimmed);
        }
      }
    ], {
      okText: 'Create',
      cancelText: 'Cancel'
    });

    if (!result) {
      return null;
    }

    const trimmed = result.filename.trim();
    return trimmed.toLowerCase().endsWith('.font') ? trimmed : `${trimmed}.font`;
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
    try {
      const projectName = window.gameEmulator?.projectExplorer?.getFocusedProjectName?.();
      if (!projectName) {
        throw new Error('No active project selected.');
      }

      const hostedStudioApi = window.retrowwwHostedStudio;
      if (!hostedStudioApi || typeof hostedStudioApi.saveProject !== 'function') {
        throw new Error('Retrowww hosted project save service is unavailable.');
      }

      const summary = await hostedStudioApi.saveProject(projectName);
      const revisionNumber = summary?.currentRevision?.revisionNumber;
      const revisionSuffix = Number.isFinite(revisionNumber) ? ' revision ' + revisionNumber : '';
      window.gameEmulator?.updateStatus?.('Saved ' + projectName + revisionSuffix, 'success');
    } catch (error) {
      console.error('[RibbonToolbar] Failed to save project:', error);
      window.gameEmulator?.updateStatus?.(
        'Failed to save project: ' + (error && error.message ? error.message : String(error)),
        'error'
      );
    }
  });
    
    // New Project
    this.setupButton('newProjectBtn', async () => {
      await this.createNewProject();
    });

    this.setupButton('idePreferencesBtn', async () => {
      await window.EditorPreferences.showPreferencesDialog();
    });

    // Import/Export RWP
    this.setupButton('exportRwpBtn', async () => {
      await this.exportProjectRwp();
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

    this.setupButton('publishBtn', async () => {
      await this.publishProjectToRetrowww();
    });
    this.setupButton('shareBtn', async () => {
      await this.shareProjectFromStudio();
    });

    // Watch operations
    this.watchClient = null;
    this.watchLaunchBtn = document.getElementById('watchLaunchBtn');

    this.setupButton('watchLaunchBtn', async () => {
      await this.watchLaunch();
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

  async publishProjectToRetrowww() {
    try {
      const project = window.gameEmulator?.projectExplorer?.getFocusedProjectName?.();
      if (!project) return alert('No active project');

      if (window.gameEmulator?.tabManager?.saveActiveTab) {
        await window.gameEmulator.tabManager.saveActiveTab();
      }

      const svc = window.serviceContainer?.get?.('rwpService') || window.rwpService;
      if (!svc || typeof svc.publishProject !== 'function') {
        return alert('Project publish service unavailable');
      }

      const publishOptions = await (window.ModalUtils?.showForm?.('Publish to Retrowww', [
        {
          name: 'shareSource',
          type: 'checkbox',
          label: 'Share source with logged-in users',
          defaultValue: false,
          hint: 'When enabled, logged-in users can open this published Lua project in RetroStudio from the application page.',
        }
      ], { okText: 'Publish' }) ?? Promise.resolve(null));

      if (!publishOptions) {
        return;
      }

      window.gameEmulator?.updateStatus?.('Publishing project to Retrowww...', 'info');
      const result = await svc.publishProject(project, {
        shareSource: publishOptions.shareSource === true,
      });
      if (!result?.buildResult) {
        throw new Error('Publish completed without a build summary result.');
      }
      this.showBuildSummaryPopup(result.buildResult);
      const version = result?.applicationVersion?.versionString || 'draft';
      window.gameEmulator?.updateStatus?.(`Published ${project} as ${version}`, 'success');
      const shareLabel = publishOptions.shareSource === true ? ' Shared source is enabled.' : ' Source remains private.';
      alert(`Published ${project} to Retrowww as draft version ${version}.${shareLabel}`);
    } catch (e) {
      console.error('[RibbonToolbar] Publish failed:', e);
      await this.handlePublishFailure(e);
      alert('Publish failed: ' + (e?.message || e));
    }
  }

  async handlePublishFailure(error) {
    const project = window.gameEmulator?.projectExplorer?.getFocusedProjectName?.();
    if (!project) return;

    const errorMessage = String(error?.message || error || '');
    const fieldName = this.getPackageSettingsFieldFromPublishError(errorMessage);
    if (!fieldName) return;

    const sourcesRoot = window.ProjectPaths?.getSourcesRootUi?.() || 'Sources';
    const packagePath = `${project}/${sourcesRoot}/Package/app.package`;

    try {
      const componentInfo = window.gameEmulator?.projectExplorer?._getComponentForFile?.(packagePath, true) || null;
      await window.gameEmulator?.tabManager?.openInTab?.(packagePath, componentInfo, { isReadOnly: false });

      const activeEditor = window.gameEmulator?.tabManager?.getActiveTab?.()?.viewer || null;
      if (activeEditor && typeof activeEditor.focusField === 'function') {
        activeEditor.focusField(fieldName);
      }
    } catch (openError) {
      console.error('[RibbonToolbar] Failed to focus package settings after publish error:', openError);
    }
  }

  getPackageSettingsFieldFromPublishError(errorMessage) {
    const normalized = String(errorMessage || '').toLowerCase();

    if (normalized.includes('application type is required') || normalized.includes('category is required')) {
      return 'category';
    }
    if (normalized.includes('target device')) {
      return 'targetDeviceSlug';
    }
    if (normalized.includes('short description')) {
      return 'shortDescription';
    }
    if (normalized.includes('package settings: description is required')) {
      return 'description';
    }
    if (normalized.includes('version code')) {
      return 'versionCode';
    }
    if (normalized.includes('package settings: version is required')) {
      return 'version';
    }
    if (normalized.includes('application id') || normalized.includes('unique id')) {
      return 'uniqueId';
    }
    if (normalized.includes('at least one screenshot is required') || normalized.includes('screenshot')) {
      return 'screenshots';
    }

    return null;
  }

  async shareProjectFromStudio() {
    try {
      const project = window.gameEmulator?.projectExplorer?.getFocusedProjectName?.();
      if (!project) return alert('No active project');

      const selection = await (window.ModalUtils?.showSelectionList?.(
        'Share Project',
        'Choose how to share the current project.',
        [
          {
            value: 'preview',
            label: 'Share',
            description: 'Provide a preview link to friends.',
          },
          {
            value: 'source',
            label: 'Share with source',
            description: 'Provide a preview link to friends and give them permission to view the source in Studio.',
          },
        ],
        { confirmText: 'Continue', cancelText: 'Cancel', defaultValue: 'preview' }
      ) ?? Promise.resolve(null));

      if (!selection) {
        return;
      }

      if (selection === 'preview') {
        await this.createPreviewShareLink(project, { shareSource: false });
        return;
      }

      if (selection === 'source') {
        await this.createPreviewShareLink(project, { shareSource: true });
        return;
      }

      throw new Error(`Unsupported share option: ${selection}`);
    } catch (e) {
      console.error('[RibbonToolbar] Share failed:', e);
      alert('Share failed: ' + (e?.message || e));
    }
  }

  async createPreviewShareLink(project, options = {}) {
    if (window.gameEmulator?.tabManager?.saveActiveTab) {
      await window.gameEmulator.tabManager.saveActiveTab();
    }

    const svc = window.serviceContainer?.get?.('rwpService') || window.rwpService;
    if (!svc || typeof svc.publishProject !== 'function') {
      throw new Error('Project publish service unavailable');
    }

    window.gameEmulator?.updateStatus?.('Creating preview share link...', 'info');
    const result = await svc.publishProject(project, {
      shareSource: options.shareSource === true,
    });
    if (!result?.buildResult) {
      throw new Error('Preview publish completed without a build summary result.');
    }
    if (!result?.previewShareUrl) {
      throw new Error('Preview publish did not return a share URL.');
    }

    this.showBuildSummaryPopup(result.buildResult);
    window.gameEmulator?.updateStatus?.(options.shareSource === true ? 'Source share link ready.' : 'Preview share link ready.', 'success');
    this.showShareLinkDialog(
      options.shareSource === true ? 'Share with source' : 'Share',
      result.previewShareUrl,
      options.shareSource === true
        ? 'This temporary link opens the application details page and shows the Edit button to signed-in users only.'
        : 'This temporary link opens the application details page without an Edit button.'
    );
  }

  async createProjectShareLink(project) {
    if (window.gameEmulator?.tabManager?.saveActiveTab) {
      await window.gameEmulator.tabManager.saveActiveTab();
    }

    const hostedStudioApi = window.retrowwwHostedStudio;
    if (!hostedStudioApi || typeof hostedStudioApi.saveProject !== 'function') {
      throw new Error('Retrowww hosted project save service is unavailable.');
    }

    window.gameEmulator?.updateStatus?.('Saving project before sharing...', 'info');
    const summary = await hostedStudioApi.saveProject(project);
    if (!summary?.project?.uuid) {
      throw new Error('Project save did not return a project UUID.');
    }

    const response = await fetch(`/api/projects/${encodeURIComponent(summary.project.uuid)}/share`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error || `Project share request failed with status ${response.status}.`);
    }

    if (!payload?.shareUrl) {
      throw new Error('Project share request did not return a share URL.');
    }

    window.gameEmulator?.updateStatus?.('Project share link ready.', 'success');
    this.showShareLinkDialog(
      'Share Project',
      payload.shareUrl,
      'This temporary link opens RetroStudio with the current project loaded.'
    );
  }

  showShareLinkDialog(title, shareUrl, description) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">${this.escapeHtml(title)}</h3>
      </div>
      <div class="modal-body">
        <p style="color: #cccccc; margin: 0 0 14px 0; line-height: 1.5;">${this.escapeHtml(description || '')}</p>
        <label class="modal-label" for="share-link-input">Temporary link</label>
        <input id="share-link-input" class="modal-input" type="text" readonly value="${this.escapeHtml(shareUrl)}">
      </div>
      <div class="modal-footer">
        <button class="modal-btn modal-btn-secondary" id="share-link-close">Close</button>
        <button class="modal-btn modal-btn-secondary" id="share-link-open">Open</button>
        <button class="modal-btn modal-btn-primary" id="share-link-copy">Copy</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const input = dialog.querySelector('#share-link-input');
    const closeBtn = dialog.querySelector('#share-link-close');
    const openBtn = dialog.querySelector('#share-link-open');
    const copyBtn = dialog.querySelector('#share-link-copy');

    const cleanup = () => {
      if (document.body.contains(overlay)) {
        document.body.removeChild(overlay);
      }
    };

    setTimeout(() => {
      input?.focus();
      input?.select();
    }, 50);

    closeBtn?.addEventListener('click', cleanup);
    openBtn?.addEventListener('click', () => {
      window.open(shareUrl, '_blank', 'noopener');
    });
    copyBtn?.addEventListener('click', async () => {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('Clipboard API is unavailable.');
      }

      await navigator.clipboard.writeText(shareUrl);
      window.gameEmulator?.updateStatus?.('Share link copied to clipboard.', 'success');
      cleanup();
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        cleanup();
      }
    });
  }

  showBuildSummaryPopup(result) {
    const summary = result?.summary || {};
    const ok = result && result.success !== false;
    const title = ok ? 'Build Summary' : 'Build Failed';
    const outputFiles = Array.isArray(summary.outputFiles) ? summary.outputFiles : [];
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog build-summary-modal';

    dialog.innerHTML = `
      <div class="modal-header build-summary-header">
        <h3 class="modal-title">${this.escapeHtml(title)}</h3>
        <span class="build-summary-status ${ok ? 'success' : 'error'}">${ok ? 'Success' : 'Failed'}</span>
      </div>
      <div class="modal-body build-summary-body">
        ${result?.error ? `<div class="build-summary-error">${this.escapeHtml(result.error)}</div>` : ''}
        ${this.renderBuildOutputTree(outputFiles)}
        <div class="build-summary-footer-panel">
          <div class="build-summary-stat"><span>Total files</span><strong>${summary.total ?? 0}</strong></div>
          <div class="build-summary-stat"><span>Built</span><strong>${summary.success ?? 0}</strong></div>
          <div class="build-summary-stat"><span>Errors</span><strong>${summary.errors ?? 0}</strong></div>
          <div class="build-summary-stat"><span>Time</span><strong>${summary.time != null ? this.escapeHtml(summary.time + ' ms') : 'n/a'}</strong></div>
          <div class="build-summary-stat"><span>Output files</span><strong>${outputFiles.length}</strong></div>
          <div class="build-summary-stat"><span>Output size</span><strong>${this.escapeHtml(summary.outputSize || '0 B')}</strong></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="modal-btn modal-btn-primary" id="build-summary-ok">OK</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const okBtn = dialog.querySelector('#build-summary-ok');
    const cleanup = () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (document.body.contains(overlay)) {
        document.body.removeChild(overlay);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        cleanup();
      }
    };

    okBtn.addEventListener('click', cleanup);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) cleanup();
    });
    document.addEventListener('keydown', handleKeyDown);
    setTimeout(() => okBtn.focus(), 0);
  }

  renderBuildOutputTree(outputFiles) {
    if (!outputFiles.length) {
      return '<div class="build-output-empty">No build outputs were produced.</div>';
    }

    const tree = this.createBuildOutputTree(outputFiles);
    return `
      <details class="build-output-tree">
        <summary>
          <span class="build-output-tree-label">Build output</span>
          <span class="build-output-tree-count">${outputFiles.length} files</span>
        </summary>
        ${this.renderBuildOutputTreeNodes(tree.children)}
      </details>
    `;
  }

  createBuildOutputTree(outputFiles) {
    const root = { children: new Map() };
    for (const output of outputFiles) {
      const path = String(output.path || '').replace(/\\/g, '/');
      const parts = path.split('/').filter(Boolean);
      let node = root;
      parts.forEach((part, index) => {
        if (!node.children.has(part)) {
          node.children.set(part, { name: part, children: new Map(), output: null });
        }
        node = node.children.get(part);
        if (index === parts.length - 1) {
          node.output = output;
        }
      });
    }
    return root;
  }

  renderBuildOutputTreeNodes(children) {
    const entries = Array.from(children.values()).sort((a, b) => {
      const aIsFolder = a.children.size > 0 && !a.output;
      const bIsFolder = b.children.size > 0 && !b.output;
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return `<ul class="build-output-tree-list">${entries.map((node) => this.renderBuildOutputTreeNode(node)).join('')}</ul>`;
  }

  renderBuildOutputTreeNode(node) {
    if (node.children.size > 0 && !node.output) {
      return `
        <li class="build-output-tree-node folder">
          <details>
            <summary><span class="build-tree-expand-glyph">+</span><span class="build-tree-icon folder"></span><span class="build-tree-label">${this.escapeHtml(node.name)}</span></summary>
            ${this.renderBuildOutputTreeNodes(node.children)}
          </details>
        </li>
      `;
    }

    const outputSize = node.output?.size || `${node.output?.bytes ?? 0} B`;
    return `
      <li class="build-output-tree-node file">
        <span class="build-tree-spacer"></span><span class="build-tree-icon file"></span><span class="build-tree-label">${this.escapeHtml(node.name)}</span><span class="build-tree-size">${this.escapeHtml(outputSize)}</span>
      </li>
    `;
  }

  escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

        // Create default main.lua with Setup/Update stubs
        const sourcesRoot = (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi)
          ? window.ProjectPaths.getSourcesRootUi() : 'Sources';
        const luaFolder = `${projectName}/${sourcesRoot}/Lua`;
        const luaContent = `function Setup()\n\nend\n\nfunction Update(dt)\n\nend\n`;
        const luaFile = new File([luaContent], 'main.lua', { type: 'text/plain' });
        await explorer.addFileToProject(luaFile, luaFolder, true, true);

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

  // ─── Watch BLE ─────────────────────────────────────────────────

  updateWatchButtonState() {
    const connected = this.watchClient && this.watchClient.isConnected();
    const btn = this.watchLaunchBtn;
    if (btn) {
      btn.title = connected ? 'Build and launch on watch' : 'Connect and launch on watch';
    }
  }

  async ensureWatchConnected() {
    const BLE = window.RetroWatchBle;
    if (!BLE) throw new Error('BLE client not loaded');

    if (this.watchClient && this.watchClient.isConnected()) return;

    if (!this.watchClient) {
      this.watchClient = new BLE.RetroWatchBleClient();
      this.watchClient.onDisconnect(() => {
        this.updateWatchButtonState();
        window.gameEmulator?.updateStatus?.('Watch disconnected', 'info');
      });
    }

    window.gameEmulator?.updateStatus?.('Connecting to watch...', 'info');
    const name = await this.watchClient.connect();
    const unixSeconds = Math.floor(Date.now() / 1000);
    const tzOffsetMinutesEast = -new Date().getTimezoneOffset();
    const timeResponse = await this.watchClient.setTimeUnix(unixSeconds, tzOffsetMinutesEast);
    if (timeResponse.status !== BLE.STATUS.OK) {
      throw new Error(`SET_TIME failed: ${BLE.getStatusName(timeResponse.status)}`);
    }
    const fwVersion = await this.watchClient.ping('version-probe');
    this.updateWatchButtonState();
    window.gameEmulator?.updateStatus?.(`Connected to ${name} — fw ${fwVersion}`, 'success');
  }

  async watchConnect() {
    try {
      await this.ensureWatchConnected();
    } catch (err) {
      this.updateWatchButtonState();
      window.gameEmulator?.updateStatus?.(`Watch connect failed: ${err.message}`, 'error');
    }
  }

  async watchLaunch() {
    try {
      await this.ensureWatchConnected();
    } catch (err) {
      this.updateWatchButtonState();
      window.gameEmulator?.updateStatus?.(`Watch connect failed: ${err.message}`, 'error');
      return;
    }

    try {
      const project = window.gameEmulator?.projectExplorer?.getFocusedProjectName?.();
      if (!project) {
        alert('No active project');
        return;
      }
      const svc = window.serviceContainer?.get?.('rwaService') || window.rwaService;
      if (!svc) {
        alert('Runtime export service unavailable');
        return;
      }

      const hostedStudioApi = window.retrowwwHostedStudio;
      if (hostedStudioApi && typeof hostedStudioApi.saveProject === 'function') {
        window.gameEmulator?.updateStatus?.('Saving project to cloud before watch launch...', 'info');
        await hostedStudioApi.saveProject(project, { skipTabSave: false });
      }

      // Build the RWA (same as Export Runtime but skip download)
      window.gameEmulator?.updateStatus?.('Building runtime package...', 'info');
      console.log('[RibbonToolbar] watchLaunch: building RWA for project:', project);
      const pkg = await svc.buildRuntimePackage(project, { buildBeforeExport: true });
      console.log('[RibbonToolbar] watchLaunch: built', pkg.filename, 'blob size:', pkg.blob.size, 'files:', pkg.fileCount);

      if (!pkg.blob || pkg.blob.size === 0) {
        throw new Error('Build produced an empty package');
      }

      // Convert blob to bytes
      const arrayBuf = await pkg.blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      console.log('[RibbonToolbar] watchLaunch: sending', bytes.length, 'bytes to watch');

      // Show progress bar
      const progressEl = document.getElementById('watchProgress');
      const fillEl = document.getElementById('watchProgressFill');
      const textEl = document.getElementById('watchProgressText');
      if (progressEl) progressEl.style.display = '';
      if (fillEl) fillEl.style.width = '0%';
      if (textEl) textEl.textContent = `Uploading ${pkg.filename}...`;

      // Path must include filename so firmware knows the file type
      const BLE = window.RetroWatchBle;
      const rsp = await this.watchClient.sendFile(bytes, {
        flags: BLE.SEND_FILE_FLAG.PREVIEW,
        path: '/' + pkg.filename,
        chunksPerAck: 1,
        allowOutOfOrder: false,
        onProgress: (sent, total) => {
          const pct = Math.round((sent / total) * 100);
          if (fillEl) fillEl.style.width = pct + '%';
          if (textEl) textEl.textContent = `${pct}%  (${(sent / 1024).toFixed(1)} / ${(total / 1024).toFixed(1)} KB)`;
        },
      });

      console.log('[RibbonToolbar] watchLaunch: response status:', rsp.status);
      if (rsp.status !== BLE.STATUS.OK) {
        const errDetail = rsp.error ? `${rsp.error.name}: ${rsp.error.reasonName}` : `status ${rsp.status}`;
        throw new Error(`Launch failed: ${errDetail}`);
      }

      if (fillEl) fillEl.style.width = '100%';
      if (textEl) textEl.textContent = 'Launched!';
      setTimeout(() => { if (progressEl) progressEl.style.display = 'none'; }, 2000);
    } catch (err) {
      console.error('[RibbonToolbar] Watch launch failed:', err);
      const progressEl = document.getElementById('watchProgress');
      const textEl = document.getElementById('watchProgressText');
      if (textEl) textEl.textContent = 'Failed';
      setTimeout(() => { if (progressEl) progressEl.style.display = 'none'; }, 3000);
      alert('Launch failed: ' + err.message);
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
