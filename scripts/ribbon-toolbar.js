// ribbon-toolbar.js
// Modern ribbon-style toolbar for RetroStudio

class RibbonToolbar {
  constructor() {
    this.buttons = {};
    this.init();
  }
  
  init() {
    console.log('[RibbonToolbar] Initializing...');
    this.setupButtons();
    console.log('[RibbonToolbar] Initialized');
  }
  
  setupButtons() {
    // File operations
    this.setupButton('saveBtn', () => {
      if (window.gameEditor) {
        window.gameEditor.saveActiveEditor();
      }
    });
    
    // Create operations
    this.setupButton('createLuaBtn', () => {
      this.createNewResource('.lua');
    });
    
    this.setupButton('createSfxBtn', () => {
      this.createNewResource('.sfx');
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
  window.ribbonToolbar = new RibbonToolbar();
});
