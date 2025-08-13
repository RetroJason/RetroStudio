// lua-editor.js
// Editor for Lua script files

class LuaEditor extends EditorBase {
  constructor(path, isNewResource = false, templateOptions = null) {
    console.log(`[LuaEditor] Constructor called with isNewResource: ${isNewResource}, path: ${path}`);
    super(path, isNewResource, templateOptions);
    this.textArea = null;
  }
  
  // Override createElement to ensure proper initialization order
  createElement() {
    console.log(`[LuaEditor] createElement called, isNewResource: ${this.isNewResource}, path: ${this.path}`);
    
    // Call parent createElement which will call createBody where textarea gets created
    return super.createElement();
  }
  
  createBody(bodyContainer) {
    console.log(`[LuaEditor] createBody called for ${this.path}, isNewResource: ${this.isNewResource}`);
    
    // Create text editor container
    const editorContainer = document.createElement('div');
    editorContainer.className = 'lua-editor-container';
    
    // Create textarea for code editing
    this.textArea = document.createElement('textarea');
    this.textArea.className = 'lua-editor-textarea';
    this.textArea.placeholder = '-- Enter your Lua script here...\n\nfunction main()\n    -- Your code here\nend';
    
    // Store a backup reference to prevent loss during async operations
    this._textAreaElement = this.textArea;
    
    console.log(`[LuaEditor] Created textarea for ${this.path}`);
    
    // Setup change detection
    this.textArea.addEventListener('input', () => {
      this.markDirty();
    });
    
    // Setup syntax highlighting class (for future CSS styling)
    this.textArea.addEventListener('input', () => {
      this.applySyntaxHighlighting();
    });
    
    editorContainer.appendChild(this.textArea);
    bodyContainer.appendChild(editorContainer);
    
    // Load content using FileManager
    this.loadFileContent().catch(err => console.error('[LuaEditor] Failed to load content:', err));
    
    // Focus the editor after it's added to DOM
    setTimeout(() => {
      if (this.textArea && this.textArea.parentNode) {
        this.textArea.focus();
      }
    }, 100);
  }
  
  applySyntaxHighlighting() {
    // For now, this is just a placeholder
    // In the future, we could add proper syntax highlighting
    // or integrate with a library like CodeMirror or Monaco Editor
    
    // Add basic line numbers and syntax classes - only if textarea exists
    if (this.textArea) {
      this.textArea.classList.add('syntax-highlighted');
    }
  }

  async generateTemplateContent() {
    const fileName = this.file.name;
    const options = this.templateOptions || { template: 'empty', addComments: true };
    
    try {
      // Always use the commented version of templates
      const content = await window.templateService.createFromTemplate('lua', options.template, {
        includeComments: true,
        variables: {
          filename: fileName
        }
      });
      
      return content;
    } catch (error) {
      console.error('[LuaEditor] Failed to generate template content:', error);
      
      // Fallback to simple empty template
      return `-- ${fileName}
-- Created: ${new Date().toLocaleDateString()}

`;
    }
  }
  
  async refreshContent() {
    console.log(`[LuaEditor] Refreshing content for: ${this.path}`);
    try {
      // Reload the file content from storage
      await this.loadFileContent();
      console.log(`[LuaEditor] Successfully refreshed content for: ${this.path}`);
    } catch (error) {
      console.error(`[LuaEditor] Failed to refresh content for ${this.path}:`, error);
    }
  }
  
  async loadFileContent() {
    console.log(`[LuaEditor] loadFileContent() called for: ${this.path}, isNewResource: ${this.isNewResource}`);
    
    try {
      let content = null;
      
      // For new resources, use default template
      if (this.isNewResource) {
        console.log(`[LuaEditor] Loading default template for new resource`);
        content = `-- Enter your Lua script here...

function main()
    -- Your code here
end`;
      } else if (this.path) {
        // Use FileManager to load content
        const fileManager = window.serviceContainer?.get('fileManager');
        if (fileManager) {
          console.log(`[LuaEditor] Using FileManager to load: ${this.path}`);
          const fileObj = await fileManager.loadFile(this.path);
          if (fileObj) {
            // Extract content from the file object
            let fileContent = fileObj.content || fileObj.fileContent;
            if (fileContent) {
              console.log(`[LuaEditor] Loaded content from FileManager: ${this.path} (${fileContent.length} chars)`);
              content = fileContent;
            } else {
              console.log(`[LuaEditor] File object found but no content property:`, fileObj);
            }
          } else {
            console.log(`[LuaEditor] No file object returned from FileManager for: ${this.path}`);
          }
        } else {
          console.log(`[LuaEditor] FileManager not available, falling back to fileIOService`);
          // Fallback to direct fileIOService
          if (window.fileIOService) {
            const storedFile = await window.fileIOService.loadFile(this.path);
            if (storedFile && storedFile.content) {
              console.log(`[LuaEditor] Loaded content from fileIOService: ${this.path} (${storedFile.content.length} chars)`);
              content = storedFile.content;
            }
          }
        }
      }
      
      // Set content to textarea if we have valid content
      if (content !== null && content !== undefined) {
        // Extract content from FileManager object structure
        if (typeof content === 'object' && content.content !== undefined) {
          content = content.content;
        }
        
        // Ensure we have string content
        if (typeof content !== 'string') {
          content = String(content);
        }
        
        // Try multiple ways to get a valid textarea reference
        let textarea = this.textArea || this._textAreaElement;
        if (!textarea && this.element) {
          textarea = this.element.querySelector('.lua-editor-textarea');
        }
        
        if (textarea) {
          console.log(`[LuaEditor] About to set content to textarea, content length: ${content.length}`);
          textarea.value = content;
          // Restore the main reference if it was lost
          this.textArea = textarea;
          console.log(`[LuaEditor] Set textarea content, length: ${content.length}`);
          this.markClean();
          this.applySyntaxHighlighting();
        } else {
          console.error(`[LuaEditor] Could not find any textarea to set content to`);
        }
      } else {
        console.log(`[LuaEditor] No content to load, using default template`);
        // Load default template when no content found
        const defaultContent = `-- Enter your Lua script here...

function main()
    -- Your code here
end`;
        
        if (this.textArea) {
          this.textArea.value = defaultContent;
          this.markClean();
          this.applySyntaxHighlighting();
        }
      }
    } catch (error) {
      console.error('[LuaEditor] Failed to load file content:', error);
      
      // Load default template on error
      const defaultContent = `-- Enter your Lua script here...

function main()
    -- Your code here
end`;
      
      if (this.textArea) {
        this.textArea.value = defaultContent;
        this.markClean();
        this.applySyntaxHighlighting();
      }
    }
  }
  
  getContent() {
    // Try multiple ways to get a valid textarea reference
    let textarea = this.textArea || this._textAreaElement;
    if (!textarea && this.element) {
      textarea = this.element.querySelector('.lua-editor-textarea');
      // Restore the main reference if found
      if (textarea) {
        this.textArea = textarea;
      }
    }
    
    const content = textarea ? textarea.value : '';
    console.log(`[LuaEditor] getContent called, textArea exists: ${!!textarea}, content length: ${content.length}`);
    if (textarea && content.length === 0) {
      console.log(`[LuaEditor] Textarea is empty, placeholder value: "${textarea.placeholder}"`);
    }
    return content;
  }
  
  setContent(content) {
    if (this.textArea) {
      this.textArea.value = content;
      this.markClean();
    }
  }
  
  // Override toolbar creation to add Lua-specific tools
  // Override focus to focus the textarea
  onFocus() {
    super.onFocus();
    if (this.textArea && this.textArea.parentNode) {
      try {
        this.textArea.focus();
      } catch (error) {
        console.warn('[LuaEditor] Could not focus textarea:', error);
      }
    }
  }
  
  // Static methods for editor registration
  static getFileExtension() {
    return '.lua';
  }
  
  static getDisplayName() {
    return 'Lua Script';
  }
  
  static getIcon() {
    return '🌙'; // Lua moon icon
  }

  // Custom creation dialog for Lua scripts
  static async showCreateDialog() {
    // Wait for template service to be ready
    if (!window.templateService.ready) {
      await window.templateService.init();
    }
    
    // Get available templates
    const templates = window.templateService.getTemplatesForEditor('lua');
    const templateOptions = Object.entries(templates).map(([key, info]) => ({
      value: key,
      text: info.name
    }));

    let currentUniqueName = null; // Store the current unique name

    const result = await ModalUtils.showForm('Create New Lua Script', [
      {
        name: 'name',
        type: 'text',
        label: 'Script Name:',
        defaultValue: 'new_script',
        placeholder: 'Enter script name...',
        required: true,
        hint: 'Name for your Lua script (without .lua extension)',
        validator: (value) => {
          const trimmed = value.trim();
          if (trimmed.length === 0) return false;
          // Check for invalid filename characters
          const invalidChars = /[<>:"/\\|?*]/;
          return !invalidChars.test(trimmed);
        },
        onInput: async (value, formData) => {
          console.log(`[LuaEditor] onInput called with value: ${value}`);
          // Real-time duplicate checking and preview
          let testName = value.trim();
          if (!testName.toLowerCase().endsWith('.lua')) {
            testName += '.lua';
          }
          
          try {
            // Check for duplicates and show what the actual filename will be
            const uniqueName = await EditorRegistry.getUniqueFileName(testName);
            currentUniqueName = uniqueName; // Store for later use
            console.log(`[LuaEditor] Duplicate check: ${testName} -> ${uniqueName}`);
            
            // Update the input field to show the actual filename that will be created
            const modal = document.querySelector('.modal-dialog');
            if (modal) {
              const nameInput = modal.querySelector('input[id*="modal-field-0"]'); // First field
              if (nameInput) {
                // Update the input value to show the unique name (without .lua extension)
                let displayName = uniqueName;
                if (displayName.toLowerCase().endsWith('.lua')) {
                  displayName = displayName.substring(0, displayName.length - 4);
                }
                
                // Only update if it's different from current value to avoid cursor jumping
                if (nameInput.value !== displayName) {
                  nameInput.value = displayName;
                  console.log(`[LuaEditor] Updated input field to: ${displayName}`);
                }
                
                // Reset any warning styling
                const hint = nameInput.parentNode.querySelector('.modal-hint');
                if (hint) {
                  hint.textContent = 'Name for your Lua script (without .lua extension)';
                  hint.style.color = '';
                  hint.style.fontWeight = '';
                }
                nameInput.style.borderColor = '';
                nameInput.style.backgroundColor = '';
              } else {
                console.log(`[LuaEditor] Could not find name input in modal`);
              }
            } else {
              console.log(`[LuaEditor] Could not find modal dialog`);
            }
          } catch (error) {
            console.error(`[LuaEditor] Error in onInput callback:`, error);
          }
        }
      },
      {
        name: 'template',
        type: 'select',
        label: 'Template:',
        defaultValue: 'empty',
        required: true,
        hint: 'Choose a starting template for your script',
        options: templateOptions
      }
    ], {
      okText: 'Create Script',
      cancelText: 'Cancel'
    });

    if (!result) return null; // User cancelled

    // Use the stored unique name if available, otherwise generate it
    let finalName;
    if (currentUniqueName) {
      finalName = currentUniqueName;
    } else {
      let name = result.name.trim();
      // Ensure proper extension
      if (!name.toLowerCase().endsWith('.lua')) {
        name += '.lua';
      }
      // Check for duplicates and auto-increment if needed (final check)
      finalName = await EditorRegistry.getUniqueFileName(name);
    }

    console.log(`[LuaEditor] Final name selected: ${finalName}`);

    return {
      name: finalName,
      template: result.template,
      addComments: true, // Always include comments from templates
      uniqueNameChecked: true // Mark that we already checked for uniqueness
    };
  }

  // Remove the old getUniqueFileName method since we're using the centralized one

  // Static methods for creation support
  static getCreateIcon() {
    return '📜';
  }

  static getCreateLabel() {
    return 'Lua Script';
  }

  static getDefaultFolder() {
    return 'Resources/Lua';
  }

  static createNew() {
    return `-- New Lua Script
-- Created: ${new Date().toLocaleDateString()}

function _init()
    -- Initialize your script here
end

function _update()
    -- Update game logic here
end

function _draw()
    -- Draw graphics here
end`;
  }
}

// Export for use
window.LuaEditor = LuaEditor;
