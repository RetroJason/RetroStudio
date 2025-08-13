// compound-editor.js
// Base class for editors that manage multiple related files (source + generated outputs)

class CompoundEditor extends EditorBase {
  constructor(path, isNewResource = false, templateOptions = null) {
    super(path, isNewResource, templateOptions);
    
    console.log(`[CompoundEditor] Constructor called for ${this.getFileName()}`);
    
    // Define the files this editor manages
    // Override in subclass to define specific file relationships
    this.managedFiles = {
      // Example structure:
      // source: { extension: '.sfx', role: 'source', editable: true },
      // output: { extension: '.wav', role: 'output', generated: true, editable: false }
    };
    
    // Track if outputs need regeneration
    this.needsRegeneration = false;
    this.isRegenerating = false;
    this.isBuilding = false;
    
    // Template options for compound resources
    this.templateOptions = templateOptions;
    
    // Setup regeneration tracking
    this.setupRegenerationTracking();
  }
  
  setupRegenerationTracking() {
    // Mark for regeneration when source content changes
    this.originalMarkDirty = this.markDirty.bind(this);
    this.markDirty = () => {
      this.originalMarkDirty();
      this.needsRegeneration = true;
      this.updateRegenerationStatus();
    };
  }
  
  updateRegenerationStatus() {
    // Update status display but don't call markDirty to avoid circular calls
    if (this.needsRegeneration && !this.isRegenerating) {
      // Visual indication that regeneration is needed
      if (this.container) {
        this.container.classList.add('needs-regeneration');
      }
    } else {
      if (this.container) {
        this.container.classList.remove('needs-regeneration');
      }
    }
  }
  
  // Override to define file management rules for this editor type
  defineFileStructure() {
    // Example:
    // return {
    //   source: { extension: '.sfx', role: 'source', editable: true },
    //   output: { extension: '.wav', role: 'output', generated: true }
    // };
    throw new Error('defineFileStructure() must be implemented by subclass');
  }
  
  // Get the source file data (what the user edits)
  getSourceData() {
    throw new Error('getSourceData() must be implemented by subclass');
  }
  
  // Generate output files from source data
  async regenerateOutputs() {
    throw new Error('regenerateOutputs() must be implemented by subclass');
  }
  
  // Get all files managed by this editor
  getAllManagedFiles() {
    const files = {};
    const baseName = this.getBaseName();
    
    for (const [key, config] of Object.entries(this.managedFiles)) {
      files[key] = {
        name: `${baseName}${config.extension}`,
        path: this.getFilePathForRole(key),
        config: config
      };
    }
    
    return files;
  }
  
  // Get base name (without extension) for file naming
  getBaseName() {
    if (!this.file) return 'unnamed';
    const name = this.file.name;
    const lastDot = name.lastIndexOf('.');
    return lastDot > 0 ? name.substring(0, lastDot) : name;
  }
  
  // Get the file path for a specific role (source/output/etc)
  getFilePathForRole(role) {
    const config = this.managedFiles[role];
    if (!config) return null;
    
    const baseName = this.getBaseName();
    const fileName = `${baseName}${config.extension}`;
    
    // Use the same directory structure as the main file
    const pathParts = this.path ? this.path.split('/') : [];
    pathParts[pathParts.length - 1] = fileName;
    
    return pathParts.join('/');
  }
  
  // Save all managed files
  async save() {
    try {
      // Save the source file first
      await super.save();
      
      // Regenerate outputs if needed (only if method exists)
      if (this.needsRegeneration && typeof this.performRegeneration === 'function') {
        await this.performRegeneration();
      }
      
      this.markClean();
      this.needsRegeneration = false;
      
    } catch (error) {
      console.error('[CompoundEditor] Save failed:', error);
      throw error;
    }
  }
  
  async performBuild() {
    if (this.isBuilding) {
      console.log('[CompoundEditor] Build already in progress');
      return;
    }
    
    try {
      this.isBuilding = true;
      
      // Update UI to show building state
      const buildButton = this.element.querySelector('.regeneration-controls button');
      if (buildButton) {
        buildButton.disabled = true;
        buildButton.textContent = 'Building...';
      }
      
      console.log(`[CompoundEditor] Building outputs for ${this.file.name}`);
      
      // Call the build method (implemented by subclass)
      const result = await this.build();
      
      if (result.success) {
        console.log(`[CompoundEditor] Build successful: ${result.outputPath}`);
        this.needsRegeneration = false;
        
        // Update output preview if available
        if (result.outputPath) {
          this.updateOutputPreview(result.outputPath);
        }
        
        // Mark as clean since build updates the outputs
        this.markClean();
      } else {
        console.error(`[CompoundEditor] Build failed: ${result.error}`);
        alert(`Build failed: ${result.error}`);
      }
      
    } catch (error) {
      console.error('[CompoundEditor] Build error:', error);
      alert(`Build error: ${error.message}`);
    } finally {
      this.isBuilding = false;
      
      // Restore button state
      const buildButton = this.element.querySelector('.regeneration-controls button');
      if (buildButton) {
        buildButton.disabled = false;
        buildButton.textContent = 'Build';
      }
    }
  }
  
  // Build interface methods - override in subclasses
  
  // Default build implementation - override in subclasses
  async build() {
    throw new Error(`${this.constructor.name} must implement build() method`);
  }
  
  // Default getOutputPath implementation - override in subclasses  
  getOutputPath() {
    throw new Error(`${this.constructor.name} must implement getOutputPath() method`);
  }
  
  // Check if build is needed
  needsBuild() {
    return this.needsRegeneration || true; // Default to always needing build
  }
  
  // Get build status
  getBuildStatus() {
    return {
      status: this.needsBuild() ? 'needs-build' : 'up-to-date',
      outputExists: false // Override in implementations
    };
  }
  
  // Update output preview after successful build
  updateOutputPreview(outputPath) {
    const outputArea = this.element.querySelector('.output-preview-area');
    if (outputArea) {
      outputArea.innerHTML = `
        <div class="output-info">
          <h4>Build Output</h4>
          <p>Generated: <code>${outputPath}</code></p>
          <p class="build-time">Built at ${new Date().toLocaleTimeString()}</p>
        </div>
      `;
    }
  }
  
  // Save a specific output file
  async saveOutputFile(role, content, contentType = 'application/octet-stream') {
    const fileInfo = this.getAllManagedFiles()[role];
    if (!fileInfo) {
      throw new Error(`Unknown file role: ${role}`);
    }
    
    try {
      // Create file object
      let fileContent;
      if (content instanceof ArrayBuffer) {
        fileContent = content;
      } else if (typeof content === 'string') {
        fileContent = new TextEncoder().encode(content);
      } else {
        fileContent = content;
      }
      
      const file = new File([fileContent], fileInfo.name, { type: contentType });
      
      // Save using FileIOService
      if (window.fileIOService) {
        await window.fileIOService.saveFile(fileInfo.path, fileContent);
        console.log(`[CompoundEditor] Saved output file: ${fileInfo.path}`);
        
        // Notify project explorer if available
        if (window.gameEditor?.projectExplorer) {
          // Extract directory and filename
          const pathParts = fileInfo.path.split('/');
          const fileName = pathParts.pop();
          const directory = pathParts.join('/');
          
          window.gameEditor.projectExplorer.addFileToProject(fileName, directory, true); // Skip auto-open during save
        }
      }
      
    } catch (error) {
      console.error(`[CompoundEditor] Failed to save output file ${role}:`, error);
      throw error;
    }
  }
  
  // Load an output file
  async loadOutputFile(role) {
    const fileInfo = this.getAllManagedFiles()[role];
    if (!fileInfo) {
      throw new Error(`Unknown file role: ${role}`);
    }
    
    try {
      if (window.fileIOService) {
        const content = await window.fileIOService.loadFile(fileInfo.path);
        console.log(`[CompoundEditor] Loaded output file: ${fileInfo.path}`);
        return content;
      }
    } catch (error) {
      console.log(`[CompoundEditor] Output file not found: ${fileInfo.path}`);
      return null;
    }
  }
  
  // Check if output files exist and are up to date
  async checkOutputStatus() {
    const outputs = {};
    
    for (const [role, config] of Object.entries(this.managedFiles)) {
      if (config.generated) {
        const content = await this.loadOutputFile(role);
        outputs[role] = {
          exists: content !== null,
          content: content
        };
      }
    }
    
    return outputs;
  }
  
  // Create UI for compound editor (can be overridden)
  createBody(bodyContainer) {
    console.log('[CompoundEditor] createBody called');
    
    // Clear any existing content
    bodyContainer.innerHTML = '';
    bodyContainer.className = 'compound-editor-body';
    
    // Create source editor area
    const sourceArea = document.createElement('div');
    sourceArea.className = 'source-editor-area';
    
    // Create regeneration controls
    const controlsArea = document.createElement('div');
    controlsArea.className = 'regeneration-controls';
    
    const buildButton = document.createElement('button');
    buildButton.textContent = 'Build';
    buildButton.className = 'btn btn-primary';
    buildButton.addEventListener('click', () => this.performBuild());
    
    controlsArea.appendChild(buildButton);
    
    // Create output preview area
    const outputArea = document.createElement('div');
    outputArea.className = 'output-preview-area';
    
    bodyContainer.appendChild(sourceArea);
    bodyContainer.appendChild(controlsArea);
    bodyContainer.appendChild(outputArea);
    
    // Let subclass populate the source area
    this.populateSourceEditor(sourceArea);
    this.populateOutputPreview(outputArea);
    
    console.log('[CompoundEditor] createBody completed');
  }
  
  // Override in subclass to populate source editor
  populateSourceEditor(container) {
    container.innerHTML = '<p>Source editor not implemented</p>';
  }
  
  // Override in subclass to populate output preview
  populateOutputPreview(container) {
    container.innerHTML = '<p>Output preview not implemented</p>';
  }
}

// Export for use
window.CompoundEditor = CompoundEditor;
