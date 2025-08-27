// build-system.js
// Top-level build system for processing resources into build output

class BuildSystem {
  constructor() {
    this.isBuilding = false;
    this.progressReporter = null;
  }
  
  getBuilderForFile(filename) {
    console.log(`[BuildSystem] getBuilderForFile called for: ${filename}`);
    
    // Use ComponentRegistry exclusively for builder selection
    if (window.componentRegistry) {
      const builder = window.componentRegistry.getBuilderForFile(filename);
      if (builder) {
        console.log(`[BuildSystem] Using ComponentRegistry builder for ${filename}: ${builder.name}`);
        return new builder.builderClass();
      } else {
        console.log(`[BuildSystem] ComponentRegistry returned no builder for ${filename}`);
      }
    } else {
      console.log(`[BuildSystem] ComponentRegistry not available`);
    }
    
    // No fallback - if ComponentRegistry doesn't have a builder, we don't build the file
    return null;
  }
  
  async buildProject() {
    if (this.isBuilding) {
      console.log('[BuildSystem] Build already in progress');
      return { success: false, error: 'Build already in progress' };
    }
    
    try {
      this.isBuilding = true;
      const startTime = Date.now();
      console.log('[BuildSystem] Starting project build...');
      
      // Initialize build progress reporting
      await this.initializeBuildProgress();
      this.updateBuildProgress(5, 'Preparing build...');
      
      // Save all dirty files before building to ensure we get updated parameters
      if (window.gameEditor && window.gameEditor.tabManager) {
        console.log('[BuildSystem] Saving all dirty files before build...');
        this.updateBuildProgress(10, 'Saving open files...');
        await window.gameEditor.tabManager.saveAllOpenTabs();
      }
      
      // Clear the build folder before starting
      if (window.gameEditor && window.gameEditor.projectExplorer) {
        this.updateBuildProgress(15, 'Clearing build folder...');
        await window.gameEditor.projectExplorer.clearBuildFolder();
      }
      
      // Get all resource file paths from project explorer
      this.updateBuildProgress(20, 'Scanning project files...');
      const resourceFilePaths = this.getAllResourceFilePaths();
      console.log(`[BuildSystem] Found ${resourceFilePaths.length} resource files to process`);
      
      if (resourceFilePaths.length === 0) {
        this.completeBuildProgress('No files to build');
        return {
          success: true,
          results: [],
          summary: { total: 0, success: 0, errors: 0, time: Date.now() - startTime }
        };
      }
      const buildResults = [];
      let successCount = 0;
      let errorCount = 0;
      
      // Process each file path by loading from storage
      for (let i = 0; i < resourceFilePaths.length; i++) {
        const filePath = resourceFilePaths[i];
        const fileIndex = i + 1;
        const baseProgress = 25 + (i / resourceFilePaths.length) * 65; // Progress from 25% to 90%
        
        this.updateBuildProgress(
          Math.round(baseProgress), 
          `Building ${fileIndex}/${resourceFilePaths.length}: ${this.getFilename(filePath)}`
        );
        
        try {
          const result = await this.buildFileFromPath(filePath);
          buildResults.push(result);
          
          if (result.success && !result.skipped) {
            successCount++;
            console.log(`[BuildSystem] ✓ Built: ${filePath} → ${result.outputPath}`);
            
            // Add the built file to project explorer
            const projectExplorer = window.serviceContainer?.get('projectExplorer');
            if (projectExplorer && result.outputPath) {
              console.log(`[BuildSystem] Adding built file to explorer: ${result.outputPath}`);
              await this.addBuiltFileToExplorer(result.outputPath, filePath);
            }
          } else if (result.skipped) {
            console.log(`[BuildSystem] ⚠ Skipped: ${filePath} - ${result.message}`);
          } else {
            errorCount++;
            console.error(`[BuildSystem] ✗ Failed: ${filePath} - ${result.error}`);
          }
        } catch (error) {
          errorCount++;
          console.error(`[BuildSystem] ✗ Error building ${filePath}:`, error);
          buildResults.push({
            success: false,
            inputPath: filePath,
            error: error.message
          });
        }
      }
      
      this.updateBuildProgress(90, 'Finalizing build...');
      
      const totalTime = Date.now() - startTime;
      console.log(`[BuildSystem] Build completed: ${successCount} success, ${errorCount} errors`);
      
      // Invalidate ALL cached resources after any build operation
      const gameEmulator = window.serviceContainer?.get('gameEmulator') || window.gameEmulator;
      if (gameEmulator && typeof gameEmulator.invalidateAllResourceCache === 'function') {
        console.log(`[BuildSystem] Invalidating all resource cache after build completion`);
        gameEmulator.invalidateAllResourceCache();
      }
      
      // Complete build progress
      const successMessage = errorCount === 0 
        ? `Build successful: ${successCount} files built` 
        : `Build completed with ${errorCount} errors`;
      this.completeBuildProgress(successMessage);
      
      return {
        success: errorCount === 0,
        results: buildResults,
        summary: {
          total: resourceFilePaths.length,
          success: successCount,
          errors: errorCount,
          time: totalTime
        }
      };
      
    } catch (error) {
      console.error('[BuildSystem] Build failed:', error);
      this.cancelBuildProgress(`Build failed: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    } finally {
      this.isBuilding = false;
    }
  }
  
  async addBuiltFileToExplorer(outputPath, originalFilePath) {
    try {
      console.log(`[BuildSystem] addBuiltFileToExplorer called: ${outputPath} (from ${originalFilePath})`);
      
      // Load the built file from storage using FileManager
      const fileManager = window.serviceContainer?.get('fileManager');
      if (!fileManager) {
        console.error(`[BuildSystem] FileManager not available`);
        return;
      }
      
      const builtFileObj = await fileManager.loadFile(outputPath);
      if (!builtFileObj) {
        console.error(`[BuildSystem] Could not load built file from storage: ${outputPath}`);
        return;
      }
      
      // Extract the relative path from the build path
      const buildPrefix = (window.ProjectPaths && typeof window.ProjectPaths.getBuildStoragePrefix === 'function')
        ? window.ProjectPaths.getBuildStoragePrefix()
        : 'build/';
      const relativePath = outputPath.startsWith(buildPrefix)
        ? outputPath.substring(buildPrefix.length)
        : outputPath.replace(/^build\//, '');
      
      // Add to project explorer's build folder
      const projectExplorer = window.serviceContainer?.get('projectExplorer');
      if (!projectExplorer) {
        console.error(`[BuildSystem] ProjectExplorer not available`);
        return;
      }
      
      const uiContent = (builtFileObj.content !== undefined)
        ? builtFileObj.content
        : (builtFileObj.fileContent !== undefined ? builtFileObj.fileContent : builtFileObj.data);
      
      projectExplorer.addBuildFileToStructure(relativePath, {
        content: uiContent,
        name: builtFileObj.filename || builtFileObj.name || (relativePath.split('/').pop()),
        path: outputPath
      });
      
      console.log(`[BuildSystem] Successfully added built file to explorer: ${relativePath}`);
    } catch (error) {
      console.error(`[BuildSystem] Failed to add built file to explorer:`, error);
    }
  }

  async buildFile(file) {
    // Extract filename from path for extension detection
    const filename = file.name || (file.path ? file.path.split('/').pop() : null);
    if (!filename) {
      return {
        success: false,
        inputPath: file.path || 'unknown',
        error: 'Cannot determine filename from file object'
      };
    }
    
    const builder = this.getBuilderForFile(filename);
    if (!builder) {
      return {
        success: false,
        inputPath: file.path,
        error: 'No builder found for file type'
      };
    }
    
    return await builder.build(file);
  }
  
  getAllResourceFilePaths() {
    console.log('[BuildSystem] getAllResourceFilePaths() called');
    const filePaths = [];
    
    // Get project explorer from service container
    const projectExplorer = window.serviceContainer?.get('projectExplorer');
    console.log('[BuildSystem] ProjectExplorer from service container:', !!projectExplorer);
    
    if (projectExplorer) {
      const project = projectExplorer.getFocusedProjectName?.();
      console.log('[BuildSystem] Focused project:', project);
      
      // Get sources root (default to 'Sources')
      let sourcesRoot = 'Sources';
      if (window.ProjectPaths && typeof window.ProjectPaths.getSourcesRootUi === 'function') {
        sourcesRoot = window.ProjectPaths.getSourcesRootUi();
      }
      console.log('[BuildSystem] ProjectPaths.getSourcesRootUi() returned:', sourcesRoot);
      
      const srcNode = project ? projectExplorer.projectData.structure[project]?.children?.[sourcesRoot]
                              : projectExplorer.projectData.structure[sourcesRoot];
      console.log('[BuildSystem] Looking for node at:', project ? `${project}.children.${sourcesRoot}` : sourcesRoot);
      console.log('[BuildSystem] Found source node:', !!srcNode);
      
      if (srcNode) {
        const base = `${project ? project + '/' : ''}${sourcesRoot}/`;
        console.log('[BuildSystem] Base path for extraction:', base);
        filePaths.push(...this.extractFilePathsFromNode(srcNode, base));
      } else {
        console.error('[BuildSystem] Source node not found in project structure');
      }
    } else {
      console.error('[BuildSystem] ProjectExplorer not available from service container');
    }
    
    console.log(`[BuildSystem] Extracted ${filePaths.length} file paths:`, filePaths);
    return filePaths;
  }

  extractFilePathsFromNode(node, basePath = '') {
    const filePaths = [];
    
    if (!node) {
      return filePaths;
    }

    if (node.type === 'file') {
      // For files, just return the path
      filePaths.push(basePath.replace(/\/$/, '')); // Remove trailing slash if present
    } else if (node.type === 'folder' && node.children) {
      // Recursively process folder children
      for (const [childName, childNode] of Object.entries(node.children)) {
        const childPath = basePath + childName;
        if (childNode.type === 'file') {
          filePaths.push(childPath);
        } else if (childNode.type === 'folder') {
          filePaths.push(...this.extractFilePathsFromNode(childNode, childPath + '/'));
        }
      }
    }
    
    return filePaths;
  }

  async buildFileFromPath(filePath) {
    console.log(`[BuildSystem] Building file from path: ${filePath}`);
    
    // Load current content from storage using FileManager
    const fileManager = window.serviceContainer?.get('fileManager');
    if (!fileManager) {
      throw new Error('FileManager not available for build');
    }

    // Normalize UI path (project-prefixed) to storage path for loading from IndexedDB
    const storagePath = (window.ProjectPaths && typeof window.ProjectPaths.normalizeStoragePath === 'function')
      ? window.ProjectPaths.normalizeStoragePath(filePath)
      : filePath;
    const fileObj = await fileManager.loadFile(storagePath);
    if (!fileObj) {
      throw new Error(`Failed to load file from storage: ${filePath}`);
    }
    
    console.log(`[BuildSystem] Loaded file content for build: ${filePath} (${fileObj.size || 'unknown'} bytes)`);
    
    // Convert to legacy file structure for builders
    const legacyFile = {
      name: fileObj.filename || fileObj.name,
      path: filePath,
      content: fileObj.content !== undefined ? fileObj.content : (fileObj.fileContent !== undefined ? fileObj.fileContent : fileObj.data),
      size: fileObj.size,
      lastModified: fileObj.lastModified || Date.now()
    };

    // Determine builder using ComponentRegistry only
    const builder = this.getBuilderForFile(legacyFile.name);
    if (!builder) {
      console.log(`[BuildSystem] No builder available for ${filePath} - file will be skipped`);
      return { success: true, skipped: true, message: `No builder for ${filePath}` };
    }

    return await builder.build(legacyFile);
  }

  /**
   * Initialize build progress reporting
   * @returns {Promise<void>}
   */
  async initializeBuildProgress() {
    if (!this.progressReporter) {
      await this.loadProgressReporter();
    }

    if (this.progressReporter) {
      await this.progressReporter.startProgress('Building Project', 'Initializing build process...');
    }
  }

  /**
   * Update build progress
   * @param {number} progress - Progress percentage (0-100)
   * @param {string} message - Progress message
   */
  updateBuildProgress(progress, message) {
    if (this.progressReporter) {
      this.progressReporter.updateProgress(progress, message);
    }
  }

  /**
   * Complete build progress
   * @param {string} message - Completion message
   */
  completeBuildProgress(message = 'Build complete') {
    if (this.progressReporter) {
      this.progressReporter.completeProgress(message);
    }
  }

  /**
   * Cancel build progress
   * @param {string} reason - Cancellation reason
   */
  cancelBuildProgress(reason = 'Build cancelled') {
    if (this.progressReporter) {
      this.progressReporter.cancelProgress(reason);
    }
  }

  /**
   * Load progress reporter interface
   * @returns {Promise<void>}
   */
  async loadProgressReporter() {
    if (window.IProgressReporter) {
      this.progressReporter = new window.IProgressReporter();
      return;
    }

    try {
      const script = document.createElement('script');
      script.src = 'scripts/interfaces/progress-reporter.js';
      script.async = true;

      return new Promise((resolve, reject) => {
        script.onload = () => {
          console.log('[BuildSystem] Progress reporter loaded');
          if (window.IProgressReporter) {
            this.progressReporter = new window.IProgressReporter();
          }
          resolve();
        };
        script.onerror = () => {
          console.error('[BuildSystem] Failed to load progress reporter');
          reject(new Error('Failed to load progress reporter'));
        };
        document.head.appendChild(script);
      });
    } catch (error) {
      console.error('[BuildSystem] Error loading progress reporter:', error);
    }
  }

  /**
   * Get filename from path for display
   * @param {string} filePath - File path
   * @returns {string} Filename
   */
  getFilename(filePath) {
    const lastSlash = filePath.lastIndexOf('/');
    return lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
  }
}

// Export for global use
window.BuildSystem = BuildSystem;
