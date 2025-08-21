// build-system.js
// Top-level build system for processing resources into build output

class BuildSystem {
  constructor() {
    this.builders = new Map();
    this.isBuilding = false;
  this.builderById = new Map();
    
    // Register default builders
    this.registerDefaultBuilders();
  }
  
  registerDefaultBuilders() {
    // Default copy builder for files without specific builders
    this.registerBuilder('*', new CopyBuilder());
    
    // SFX builder for .sfx files
    this.registerBuilder('.sfx', new SfxBuilder());

  // Palette builder for palette-like text formats
  this.registerBuilder('.pal', new PalBuilder());
  this.registerBuilder('.act', new PalBuilder());
  this.registerBuilder('.aco', new PalBuilder());

  // Also index by IDs for explicit selection
  this.builderById.set('copy', new CopyBuilder());
  this.builderById.set('sfx', new SfxBuilder());
  this.builderById.set('pal', new PalBuilder());
  }
  
  registerBuilder(extension, builder) {
    console.log(`[BuildSystem] Registered builder for ${extension}`);
    this.builders.set(extension, builder);
  }
  
  getBuilderForFile(filename) {
    const extension = this.getFileExtension(filename);
    return this.builders.get(extension) || this.builders.get('*');
  }
  
  getFileExtension(filename) {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot).toLowerCase() : '';
  }

  // Map extension to default builderId
  getBuilderIdForExtension(extension) {
    switch ((extension || '').toLowerCase()) {
      case '.sfx': return 'sfx';
      case '.pal':
      case '.act':
      case '.aco':
        return 'pal';
      default: return 'copy';
    }
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
      
      // Save all dirty files before building to ensure we get updated parameters
      if (window.gameEditor && window.gameEditor.tabManager) {
        console.log('[BuildSystem] Saving all dirty files before build...');
        await window.gameEditor.tabManager.saveAllOpenTabs();
      }
      
      // Clear the build folder before starting
      if (window.gameEditor && window.gameEditor.projectExplorer) {
        await window.gameEditor.projectExplorer.clearBuildFolder();
      }
      
      // Get all resource file paths from project explorer (storage-first approach)
      const resourceFilePaths = this.getAllResourceFilePaths();
      console.log(`[BuildSystem] Found ${resourceFilePaths.length} resource files to process`);
      
      const buildResults = [];
      let successCount = 0;
      let errorCount = 0;
      
      // Process each file path by loading from storage
      for (const filePath of resourceFilePaths) {
        try {
          const result = await this.buildFileFromPath(filePath);
          buildResults.push(result);
          
          if (result.success) {
            successCount++;
            console.log(`[BuildSystem] ✓ Built: ${filePath} → ${result.outputPath}`);
            
            // Add the built file to project explorer
            const projectExplorer = window.serviceContainer?.get('projectExplorer');
            if (projectExplorer && result.outputPath) {
              console.log(`[BuildSystem] Adding built file to explorer: ${result.outputPath}`);
              await this.addBuiltFileToExplorer(result.outputPath, filePath);
            } else {
              console.log(`[BuildSystem] Skipping addBuiltFileToExplorer - projectExplorer: ${!!projectExplorer}, outputPath: ${!!result.outputPath}`);
            }
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
      
      const totalTime = Date.now() - startTime;
      console.log(`[BuildSystem] Build completed: ${successCount} success, ${errorCount} errors`);
      
      // Invalidate ALL cached resources after any build operation
      const gameEmulator = window.serviceContainer?.get('gameEmulator') || window.gameEmulator;
      if (gameEmulator && typeof gameEmulator.invalidateAllResourceCache === 'function') {
        console.log(`[BuildSystem] Invalidating all resource cache after build completion`);
        gameEmulator.invalidateAllResourceCache();
      } else {
        console.warn('[BuildSystem] GameEmulator not available for cache invalidation');
      }
      
      // Note: Build files are added to the project explorer as they are built
      // No need to refresh from localStorage here
      
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
      console.log(`[BuildSystem] Adding built file to explorer: ${outputPath}`);
      
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
      
      // Extract the relative path from the build path using dynamic build prefix
      const buildPrefix = (window.ProjectPaths && typeof window.ProjectPaths.getBuildStoragePrefix === 'function')
        ? window.ProjectPaths.getBuildStoragePrefix()
        : 'build/';
      const relativePath = outputPath.startsWith(buildPrefix)
        ? outputPath.substring(buildPrefix.length)
        : outputPath.replace(/^build\//, '');
  // Strip Sources/ prefix if accidentally present
  const sourcesUi = (window.ProjectPaths && typeof window.ProjectPaths.getSourcesRootUi === 'function') ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
  const rel = relativePath.startsWith(sourcesUi + '/') ? relativePath.substring(sourcesUi.length + 1) : relativePath;
      
      // Add to project explorer's build folder
      const projectExplorer = window.serviceContainer?.get('projectExplorer');
      if (!projectExplorer) {
        console.error(`[BuildSystem] ProjectExplorer not available`);
        return;
      }
      
      const uiContent = (builtFileObj.content !== undefined)
        ? builtFileObj.content
        : (builtFileObj.fileContent !== undefined ? builtFileObj.fileContent : builtFileObj.data);
      projectExplorer.addBuildFileToStructure(rel, {
        content: uiContent,
        name: builtFileObj.filename || builtFileObj.name || (rel.split('/').pop()),
        path: outputPath
      });  console.log(`[BuildSystem] Successfully added built file to explorer: ${rel}`);
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
    console.log('[BuildSystem] === NEW VERSION - getAllResourceFilePaths() called ===');
    const filePaths = [];
    
    // Get project explorer from service container instead of window.gameEditor
    const projectExplorer = window.serviceContainer?.get('projectExplorer');
    console.log('[BuildSystem] ProjectExplorer from service container:', !!projectExplorer);
    
    if (projectExplorer) {
      console.log('[BuildSystem] Explorer structure:', projectExplorer.projectData?.structure);
      const project = projectExplorer.getFocusedProjectName?.();
      console.log('[BuildSystem] Focused project:', project);
      
      // Check what ProjectPaths.getSourcesRootUi() actually returns - but don't fail if missing
      let sourcesRoot = 'Sources'; // default to Sources since that's what the project uses
      console.log('[BuildSystem] ProjectPaths available:', !!window.ProjectPaths);
      console.log('[BuildSystem] getSourcesRootUi function:', typeof window.ProjectPaths?.getSourcesRootUi);
      
      if (window.ProjectPaths && typeof window.ProjectPaths.getSourcesRootUi === 'function') {
        try {
          sourcesRoot = window.ProjectPaths.getSourcesRootUi();
          console.log('[BuildSystem] ProjectPaths.getSourcesRootUi() returned:', sourcesRoot);
        } catch (error) {
          console.error('[BuildSystem] Error calling ProjectPaths.getSourcesRootUi():', error);
        }
      } else {
        console.log('[BuildSystem] ProjectPaths.getSourcesRootUi() not available, using default:', sourcesRoot);
      }
      
      const srcNode = project ? projectExplorer.projectData.structure[project]?.children?.[sourcesRoot]
                              : projectExplorer.projectData.structure[sourcesRoot];
      console.log('[BuildSystem] Looking for node at:', project ? `${project}.children.${sourcesRoot}` : sourcesRoot);
      console.log('[BuildSystem] Found source node:', srcNode);
      
      if (srcNode) {
        const base = `${project ? project + '/' : ''}${sourcesRoot}/`;
        console.log('[BuildSystem] Base path for extraction:', base);
        filePaths.push(...this.extractFilePathsFromNode(srcNode, base));
      } else {
        console.error('[BuildSystem] Source node not found in project structure');
        console.error('[BuildSystem] Available structure keys:', Object.keys(projectExplorer.projectData?.structure || {}));
        if (project && projectExplorer.projectData.structure[project]) {
          console.error('[BuildSystem] Available project children:', Object.keys(projectExplorer.projectData.structure[project].children || {}));
        }
      }
    } else {
      console.error('[BuildSystem] ProjectExplorer not available from service container');
      console.error('[BuildSystem] Available services:', Object.keys(window.serviceContainer?.services || {}));
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
      // For files, just return the path - we'll load content from storage
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
    
    console.log(`[BuildSystem] Loaded file content for build: ${filePath} (${fileObj.size} bytes)`);
    
    // Convert to legacy file structure for builders
    const legacyFile = {
      name: fileObj.filename || fileObj.name,
      path: filePath,
      content: fileObj.content !== undefined ? fileObj.content : (fileObj.fileContent !== undefined ? fileObj.fileContent : fileObj.data),
      size: fileObj.size,
      lastModified: fileObj.lastModified || Date.now()
    };

    // Determine builder by explicit assignment or by extension
    const explicitId = fileObj.builderId;
  const ext = this.getFileExtension(filePath);
    const builderId = explicitId || this.getBuilderIdForExtension(ext);
    const builder = this.builderById.get(builderId) || this.getBuilderForFile(legacyFile.name);
    if (!builder) {
      throw new Error(`No builder available for ${filePath}`);
    }

    return await builder.build(legacyFile);
  }
  
  extractFilesFromProjectExplorer(projectFiles) {
    // Legacy method - deprecated
    console.warn('[BuildSystem] extractFilesFromProjectExplorer() is deprecated');
    // This method is not used since ProjectExplorer doesn't have a .files property
    // Instead, we use getAllResourceFilePaths() which traverses the projectData.structure
    return this.getAllResourceFilePaths();
  }

  extractFilesFromNode(node, basePath = '') {
    const files = [];
    
    if (!node) {
      return files;
    }

    if (node.type === 'file' && node.file) {
      // Extract filename from basePath if it was passed with filename
      let fileName = node.file.name;
      let filePath = basePath;
      
      // If basePath ends with a filename (no trailing slash), extract it
      if (basePath && !basePath.endsWith('/')) {
        const lastSlash = basePath.lastIndexOf('/');
        if (lastSlash >= 0) {
          fileName = basePath.substring(lastSlash + 1);
          filePath = basePath.substring(0, lastSlash + 1);
        } else {
          fileName = basePath;
          filePath = '';
        }
      }
      
      files.push({
        name: fileName,
        path: filePath + fileName,
        file: node.file,
        folder: filePath
      });
    } else if (node.type === 'folder' && node.children) {
      // Recursively process all children in the folder
      for (const [childName, childNode] of Object.entries(node.children)) {
        if (childNode.type === 'file') {
          // For files, pass the full path including filename
          files.push(...this.extractFilesFromNode(childNode, basePath + childName));
        } else {
          // For folders, add the folder name to the path
          files.push(...this.extractFilesFromNode(childNode, basePath + childName + '/'));
        }
      }
    }
    
    return files;
  }
  
  downloadBuildFile(filePath, data, mimeType) {
    try {
      // Create a blob from the data
      const blob = new Blob([data], { type: mimeType });
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filePath.split('/').pop(); // Get just the filename
      
      // Trigger download
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Clean up
      URL.revokeObjectURL(url);
      
      console.log(`[BuildSystem] Downloaded: ${filePath}`);
    } catch (error) {
      console.error(`[BuildSystem] Failed to download ${filePath}:`, error);
    }
  }
}

// Base builder class
class BaseBuilder {
  async build(file) {
    throw new Error('build() method must be implemented by subclass');
  }
  
  ensureBuildDirectory(outputPath) {
    // Extract directory from output path
    const lastSlash = outputPath.lastIndexOf('/');
    if (lastSlash !== -1) {
      return outputPath.substring(0, lastSlash);
    }
    return '';
  }
}

// Default copy builder - just copies files to build directory
class CopyBuilder extends BaseBuilder {
  async build(file) {
    try {
      // Map source path to build output via ProjectPaths
      const outputPath = (window.ProjectPaths && typeof window.ProjectPaths.toBuildOutputPath === 'function')
        ? window.ProjectPaths.toBuildOutputPath(file.path)
        : file.path.replace(/^Resources\//, 'build/');
      
      // Read file content - check persistent storage first for saved edits
      let content;
  const fileExtension = (file.path.split('.').pop() || '').toLowerCase();
  const textExtensions = ['pal', 'lua', 'txt', 'json', 'xml', 'csv', 'md'];
  const isTextFile = textExtensions.includes(fileExtension);
      
      // First try to load from persistent storage (for saved edits)
      let contentFromStorage = null;
      if (window.fileIOService) {
        try {
          const normPath = (window.ProjectPaths && typeof window.ProjectPaths.normalizeStoragePath === 'function')
            ? window.ProjectPaths.normalizeStoragePath(file.path)
            : file.path;
          const storedFile = await window.fileIOService.loadFile(normPath);
          if (storedFile && storedFile.content) {
            contentFromStorage = storedFile.content;
            console.log(`[CopyBuilder] Found saved content for ${file.path} (${contentFromStorage.length} chars)`);
          }
        } catch (error) {
          console.log(`[CopyBuilder] No saved content found for ${file.path}: ${error.message}`);
        }
      }
      
      if (contentFromStorage) {
        content = contentFromStorage;
        // Normalize text files that may have been stored as binary ArrayBuffer
        if (isTextFile && (content instanceof ArrayBuffer || ArrayBuffer.isView(content))) {
          try {
            const bytes = content instanceof ArrayBuffer ? new Uint8Array(content) : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
            content = new TextDecoder('utf-8').decode(bytes);
            console.log(`[CopyBuilder] Decoded text content from ArrayBuffer for ${file.path}`);
          } catch (e) {
            console.warn('[CopyBuilder] Failed to decode ArrayBuffer as text, leaving as-is:', e);
          }
        }
        console.log(`[CopyBuilder] Using saved content for ${file.path}`);
      } else {
        // Fallback to reading from file object
        if (isTextFile) {
          if (typeof file.content === 'string') {
            content = file.content;
            console.log(`[CopyBuilder] Using provided text content for ${file.path}`);
          } else if (file.file && typeof file.file.text === 'function') {
            content = await file.file.text();
            console.log(`[CopyBuilder] Reading ${file.path} as text from file object (${content.length} chars)`);
          } else {
            content = '';
          }
        } else {
          if (file.content instanceof ArrayBuffer || ArrayBuffer.isView(file.content)) {
            content = file.content instanceof ArrayBuffer ? file.content : file.content.buffer;
            console.log(`[CopyBuilder] Using provided binary content for ${file.path}`);
          } else if (file.file && typeof file.file.arrayBuffer === 'function') {
            content = await file.file.arrayBuffer();
            console.log(`[CopyBuilder] Reading ${file.path} as binary from file object (${content.byteLength} bytes)`);
          } else {
            content = new ArrayBuffer(0);
          }
        }
      }
      
      // Save to build directory using FileManager
      const fileManager = window.serviceContainer?.get('fileManager');
  if (fileManager) {
        // Ensure text files are saved as plain text (not base64)
        const saveContent = content;
        await fileManager.saveFile(outputPath, saveContent, {
          binaryData: !isTextFile
        });
      } else if (window.fileIOService) {
        // Fallback to direct fileIOService if FileManager not available
        const saveContent = content;
        await window.fileIOService.saveFile(outputPath, saveContent, {
          binaryData: !isTextFile
        });
      }
      
      // Build files are saved to localStorage under build/ prefix
      // No automatic download - files go to virtual build directory
      
      return {
        success: true,
        inputPath: file.path,
        outputPath: outputPath,
        builder: 'copy'
      };
    } catch (error) {
      return {
        success: false,
        inputPath: file.path,
        error: error.message,
        builder: 'copy'
      };
    }
  }
  
  getMimeType(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes = {
      'wav': 'audio/wav',
      'mp3': 'audio/mpeg', 
      'lua': 'text/plain',
      'js': 'application/javascript',
      'json': 'application/json',
      'txt': 'text/plain'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}

// SFX builder - converts .sfx files to .wav files
class SfxBuilder extends BaseBuilder {
  async build(file) {
    try {
      // Parse SFX file to get parameters using FileManager
      const fileManager = window.serviceContainer?.get('fileManager');
      if (!fileManager) {
        throw new Error('FileManager not available');
      }
      
      // Prefer content already provided by BuildSystem
      let fileContent = null;
      if (file && (typeof file.content === 'string' || file.content instanceof ArrayBuffer || ArrayBuffer.isView(file.content))) {
        fileContent = { content: file.content };
      } else {
        const normPath = (window.ProjectPaths && typeof window.ProjectPaths.normalizeStoragePath === 'function')
          ? window.ProjectPaths.normalizeStoragePath(file.path)
          : file.path;
        fileContent = await fileManager.loadFile(normPath);
      }
      console.log(`[SfxBuilder] Raw file content:`, fileContent);
      
      let text;
      if (typeof fileContent === 'object' && fileContent !== null) {
        text = fileContent.content || fileContent.fileContent || fileContent.data;
      } else {
        text = fileContent;
      }
      
      if (!text || typeof text !== 'string') {
        throw new Error(`Invalid file content for ${file.path}: ${typeof text}`);
      }
      
      const parameters = this.parseParameters(text);
      console.log(`[SfxBuilder] Parsed SFXR parameters:`, parameters);
      
      // Generate WAV using jsfxr
      const wavData = await this.generateJsfxrWav(parameters);
      if (!wavData) {
        throw new Error('Failed to generate WAV with jsfxr');
      }
      
      console.log(`[SfxBuilder] Generated WAV data: ${wavData.byteLength} bytes`);
      
      // Generate output path
      const outUiPath = file.path.replace(/\.sfx$/i, '.wav');
      const outputPath = (window.ProjectPaths && typeof window.ProjectPaths.toBuildOutputPath === 'function')
        ? window.ProjectPaths.toBuildOutputPath(outUiPath)
        : outUiPath.replace(/^Resources\//, 'build/');
      
      console.log(`[SfxBuilder] Input path: ${file.path}`);
      console.log(`[SfxBuilder] Output path: ${outputPath}`);
      
      // Save WAV file
      if (fileManager) {
        const saved = await fileManager.saveFile(outputPath, wavData, {
          type: '.wav',
          binaryData: true
        });
        if (!saved) {
          throw new Error('Failed to save WAV to persistent storage');
        }
        console.log(`[SfxBuilder] Saved WAV file to: ${outputPath}`);
      }
      
      return {
        success: true,
        inputPath: file.path,
        outputPath: outputPath,
        builder: 'sfx'
      };
    } catch (error) {
      return {
        success: false,
        inputPath: file.path,
        error: error.message,
        builder: 'sfx'
      };
    }
  }
  
  parseParameters(jsonContent) {
    try {
      const parsed = JSON.parse(jsonContent);
      
      // Extract SFXR parameters from the file
      if (parsed.parameters) {
        console.log('[SfxBuilder] Found SFXR parameters in file');
        return parsed.parameters;
      } else {
        console.log('[SfxBuilder] No SFXR parameters found, using defaults');
        // Return default SFXR parameters
        return {
          wave_type: 0,
          p_base_freq: 0.3,
          p_freq_limit: 0,
          p_freq_ramp: 0,
          p_freq_dramp: 0,
          p_env_attack: 0,
          p_env_sustain: 0.3,
          p_env_punch: 0,
          p_env_decay: 0.4,
          p_vib_strength: 0,
          p_vib_speed: 0,
          p_arp_mod: 0,
          p_arp_speed: 0,
          p_duty: 0,
          p_duty_ramp: 0,
          p_repeat_speed: 0,
          p_pha_offset: 0,
          p_pha_ramp: 0,
          p_lpf_freq: 1,
          p_lpf_ramp: 0,
          p_lpf_resonance: 0,
          p_hpf_freq: 0,
          p_hpf_ramp: 0
        };
      }
    } catch (error) {
      console.error('[SfxBuilder] Failed to parse JSON:', error);
      throw new Error('Invalid SFX file format');
    }
  }
  
  async generateJsfxrWav(parameters) {
    // Ensure jsfxr is available
    if (typeof window.jsfxr === 'undefined' || typeof window.jsfxr.Params === 'undefined' || typeof window.jsfxr.SoundEffect === 'undefined') {
      throw new Error('jsfxr library not loaded correctly');
    }
    
    try {
      // Create jsfxr parameters object
      const params = new window.jsfxr.Params();
      
      // Map our parameters to jsfxr format
      Object.keys(parameters).forEach(key => {
        if (params.hasOwnProperty(key)) {
          params[key] = parameters[key];
        }
      });
      
      // Generate audio using jsfxr - use SoundEffect directly for normalized data
      const soundEffect = new window.jsfxr.SoundEffect(params);
      const rawBuffer = soundEffect.getRawBuffer();
      const audioBuffer = rawBuffer.normalized; // Use normalized float array
      
      // Convert Float32Array to WAV format manually
      const sampleRate = soundEffect.sampleRate || 44100;
      const numChannels = 1;
      const bytesPerSample = 2;
      const blockAlign = numChannels * bytesPerSample;
      const byteRate = sampleRate * blockAlign;
      const dataSize = audioBuffer.length * bytesPerSample;
      const fileSize = 36 + dataSize;
      
      // Create WAV header
      const wavBuffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(wavBuffer);
      
      // RIFF header
      this.writeString(view, 0, 'RIFF');
      view.setUint32(4, fileSize, true);
      this.writeString(view, 8, 'WAVE');
      
      // fmt chunk
      this.writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, 16, true);
      
      // data chunk
      this.writeString(view, 36, 'data');
      view.setUint32(40, dataSize, true);
      
      // Convert float32 samples to int16
      const samples = new Int16Array(wavBuffer, 44);
      for (let i = 0; i < audioBuffer.length; i++) {
        samples[i] = Math.max(-32768, Math.min(32767, audioBuffer[i] * 32767));
      }
      
      return wavBuffer;
      
    } catch (error) {
      console.error('[SfxBuilder] Error generating WAV:', error);
      throw error;
    }
  }
  
  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
  
  async synthesizeAudio(parameters) {
    console.log('[SfxBuilder] Synthesizing audio with parameters:', parameters);
    
    // Create audio context
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const sampleRate = audioContext.sampleRate;
    const duration = parameters.duration;
    const numSamples = Math.floor(sampleRate * duration);
    
    // Create audio buffer
    const audioBuffer = audioContext.createBuffer(1, numSamples, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    
    // Generate waveform
    const frequency = parameters.frequency;
    const type = parameters.type;
    
    console.log(`[SfxBuilder] Generating ${type} wave at ${frequency}Hz for ${duration}s (${numSamples} samples)`);
    
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let sample = 0;
      
      switch (type) {
        case 'sine':
          sample = Math.sin(2 * Math.PI * frequency * t);
          break;
        case 'square':
          sample = Math.sin(2 * Math.PI * frequency * t) > 0 ? 1 : -1;
          break;
        case 'sawtooth':
          sample = 2 * (frequency * t - Math.floor(frequency * t + 0.5));
          break;
        case 'noise':
          sample = Math.random() * 2 - 1;
          break;
        default:
          sample = Math.sin(2 * Math.PI * frequency * t);
      }
      
      // Apply simple envelope (fade in/out)
      const fadeTime = 0.01; // 10ms fade
      const fadeIn = Math.min(1, t / fadeTime);
      const fadeOut = Math.min(1, (duration - t) / fadeTime);
      sample *= fadeIn * fadeOut * 0.3; // 30% volume
      
      channelData[i] = sample;
    }
    
    console.log(`[SfxBuilder] Generated audio buffer: ${numSamples} samples at ${sampleRate}Hz`);
    return audioBuffer;
  }
  
  audioBufferToWav(audioBuffer) {
    // Convert AudioBuffer to WAV format
    const length = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    
    // WAV header
    const arrayBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(arrayBuffer);
    
    // RIFF chunk descriptor
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    this.writeString(view, 8, 'WAVE');
    
    // FMT sub-chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    
    // Data sub-chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, length * 2, true);
    
    // Convert samples to 16-bit PCM
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample * 0x7FFF, true);
      offset += 2;
    }
    
    return arrayBuffer;
  }
  
  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}

// Palette builder - exports text palettes to build folder (e.g., .pal)
class PalBuilder extends BaseBuilder {
  async build(file) {
    try {
      const outputPath = (window.ProjectPaths && typeof window.ProjectPaths.toBuildOutputPath === 'function')
        ? window.ProjectPaths.toBuildOutputPath(file.path)
        : file.path.replace(/^Resources\//, 'build/');

      // Determine if text-like; palettes are text for .pal
      let content;
      if (typeof file.content === 'string') {
        content = file.content;
      } else if (file.content instanceof ArrayBuffer || ArrayBuffer.isView(file.content)) {
        try {
          const bytes = file.content instanceof ArrayBuffer ? new Uint8Array(file.content) : new Uint8Array(file.content.buffer, file.content.byteOffset, file.content.byteLength);
          content = new TextDecoder('utf-8').decode(bytes);
        } catch (e) {
          console.warn('[PalBuilder] Failed to decode ArrayBuffer content, attempting storage load');
        }
      }
      if (typeof content !== 'string') {
        if (file.file && typeof file.file.text === 'function') {
          content = await file.file.text();
        } else {
          // Fallback: try to load latest from storage
          const fm = window.serviceContainer?.get('fileManager');
          const normPath = (window.ProjectPaths && typeof window.ProjectPaths.normalizeStoragePath === 'function')
            ? window.ProjectPaths.normalizeStoragePath(file.path)
            : file.path;
          const loaded = fm ? await fm.loadFile(normPath) : null;
          const stored = loaded && (loaded.content !== undefined ? loaded.content : loaded.fileContent);
          if (typeof stored === 'string') {
            content = stored;
          } else if (stored instanceof ArrayBuffer || ArrayBuffer.isView(stored)) {
            try {
              const bytes = stored instanceof ArrayBuffer ? new Uint8Array(stored) : new Uint8Array(stored.buffer, stored.byteOffset, stored.byteLength);
              content = new TextDecoder('utf-8').decode(bytes);
            } catch (e) {
              console.warn('[PalBuilder] Failed to decode stored ArrayBuffer');
            }
          }
        }
      }
      if (typeof content !== 'string') content = '';

      const fileManager = window.serviceContainer?.get('fileManager');
      if (fileManager) {
        await fileManager.saveFile(outputPath, content, { binaryData: false });
      } else if (window.fileIOService) {
        await window.fileIOService.saveFile(outputPath, content, { binaryData: false });
      }

      return {
        success: true,
        inputPath: file.path,
        outputPath,
        builder: 'pal'
      };
    } catch (error) {
      return {
        success: false,
        inputPath: file.path,
        error: error.message,
        builder: 'pal'
      };
    }
  }
}

// Export for global use
window.BuildSystem = BuildSystem;
window.BaseBuilder = BaseBuilder;
window.CopyBuilder = CopyBuilder;
window.SfxBuilder = SfxBuilder;
window.PalBuilder = PalBuilder;
