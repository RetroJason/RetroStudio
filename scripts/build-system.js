// build-system.js
// Top-level build system for processing resources into build output

class BuildSystem {
  constructor() {
    this.builders = new Map();
    this.isBuilding = false;
    
    // Register default builders
    this.registerDefaultBuilders();
  }
  
  registerDefaultBuilders() {
    // Default copy builder for files without specific builders
    this.registerBuilder('*', new CopyBuilder());
    
    // SFX builder for .sfx files
    this.registerBuilder('.sfx', new SfxBuilder());
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
  
  async buildProject() {
    if (this.isBuilding) {
      console.log('[BuildSystem] Build already in progress');
      return { success: false, error: 'Build already in progress' };
    }
    
    try {
      this.isBuilding = true;
      console.log('[BuildSystem] Starting project build...');
      
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
            if (window.gameEditor && window.gameEditor.projectExplorer && result.outputPath) {
              await this.addBuiltFileToExplorer(result.outputPath, filePath);
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
      
      const totalTime = Date.now() - Date.now(); // Placeholder for actual timing
      console.log(`[BuildSystem] Build completed: ${successCount} success, ${errorCount} errors`);
      
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
      
      // Extract the relative path from the build path (remove "build/" prefix)
      const relativePath = outputPath.replace(/^build\//, '');
      
      // Add to project explorer's build folder
      window.gameEditor.projectExplorer.addBuildFileToStructure(relativePath, {
        content: builtFileObj.content,
        name: builtFileObj.name,
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
    const filePaths = [];
    
    // Get file paths from project explorer structure
    if (window.gameEditor && window.gameEditor.projectExplorer) {
      const explorer = window.gameEditor.projectExplorer;
      console.log('[BuildSystem] Explorer structure:', explorer.projectData?.structure);
      
      if (explorer.projectData && explorer.projectData.structure && explorer.projectData.structure.Resources) {
        console.log('[BuildSystem] Resources node:', explorer.projectData.structure.Resources);
        filePaths.push(...this.extractFilePathsFromNode(explorer.projectData.structure.Resources, 'Resources/'));
      }
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
    
    const fileObj = await fileManager.loadFile(filePath);
    if (!fileObj) {
      throw new Error(`Failed to load file from storage: ${filePath}`);
    }
    
    console.log(`[BuildSystem] Loaded file content for build: ${filePath} (${fileObj.size} bytes)`);
    
    // Convert to legacy file structure for builders
    const legacyFile = {
      name: fileObj.name,
      path: filePath,
      content: fileObj.content,
      size: fileObj.size,
      lastModified: fileObj.lastModified || Date.now()
    };
    
    // Use existing buildFile method with the loaded file
    return await this.buildFile(legacyFile);
  }
  
  getAllResourceFiles() {
    // Legacy method - deprecated in favor of getAllResourceFilePaths()
    console.warn('[BuildSystem] getAllResourceFiles() is deprecated, use getAllResourceFilePaths() instead');
    const files = [];
    
    // Get files from project explorer
    if (window.gameEditor && window.gameEditor.projectExplorer) {
      const explorer = window.gameEditor.projectExplorer;
      console.log('[BuildSystem] Explorer structure:', explorer.projectData?.structure);
      
      if (explorer.projectData && explorer.projectData.structure && explorer.projectData.structure.Resources) {
        console.log('[BuildSystem] Resources node:', explorer.projectData.structure.Resources);
        files.push(...this.extractFilesFromNode(explorer.projectData.structure.Resources, 'Resources/'));
      }
    }
    
    console.log(`[BuildSystem] Extracted ${files.length} files:`, files);
    return files;
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
      // Remove Resources/ prefix and add build/ prefix: Resources/Lua/file.lua -> build/Lua/file.lua
      const outputPath = file.path.replace(/^Resources\//, 'build/');
      
      // Read file content - check persistent storage first for saved edits
      let content;
      const fileExtension = file.path.split('.').pop().toLowerCase();
      const textExtensions = ['.pal', '.lua', '.txt', '.json', '.xml', '.csv', '.md'];
      const isTextFile = textExtensions.includes('.' + fileExtension);
      
      // First try to load from persistent storage (for saved edits)
      let contentFromStorage = null;
      if (window.fileIOService) {
        try {
          const storedFile = await window.fileIOService.loadFile(file.path);
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
        console.log(`[CopyBuilder] Using saved content for ${file.path}`);
      } else {
        // Fallback to reading from file object
        if (isTextFile) {
          content = await file.file.text();
          console.log(`[CopyBuilder] Reading ${file.path} as text from file object (${content.length} chars)`);
        } else {
          content = await file.file.arrayBuffer();
          console.log(`[CopyBuilder] Reading ${file.path} as binary from file object (${content.byteLength} bytes)`);
        }
      }
      
      // Save to build directory using FileManager
      const fileManager = window.serviceContainer?.get('fileManager');
      if (fileManager) {
        await fileManager.saveFile(outputPath, content, {
          binaryData: !isTextFile
        });
      } else if (window.fileIOService) {
        // Fallback to direct fileIOService if FileManager not available
        await window.fileIOService.saveFile(outputPath, content, {
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
      
      const fileContent = await fileManager.loadFile(file.path);
      console.log(`[SfxBuilder] Raw file content:`, fileContent);
      console.log(`[SfxBuilder] Type of content:`, typeof fileContent);
      
      let text;
      if (typeof fileContent === 'object' && fileContent !== null) {
        // Try different possible content properties
        text = fileContent.content || fileContent.fileContent || fileContent.data;
        console.log(`[SfxBuilder] Extracted text from object:`, text, `(type: ${typeof text})`);
      } else {
        text = fileContent;
        console.log(`[SfxBuilder] Direct text:`, text);
      }
      
      if (!text || typeof text !== 'string') {
        console.error(`[SfxBuilder] Content extraction failed:`, {
          fileContent,
          extractedText: text,
          textType: typeof text
        });
        throw new Error(`Invalid file content for ${file.path}: ${typeof text}`);
      }
      
      const parameters = this.parseParameters(text);
      console.log(`[SfxBuilder] Parsed parameters:`, parameters);
      
      // Generate audio
      const audioBuffer = await this.synthesizeAudio(parameters);
      if (!audioBuffer) {
        throw new Error('Failed to synthesize audio');
      }
      
      // Convert to WAV
      const wavData = this.audioBufferToWav(audioBuffer);
      console.log(`[SfxBuilder] Generated WAV data: ${wavData.byteLength} bytes`);
      
      // Generate output path (convert .sfx to .wav in build directory)
      const inputPath = file.path;
      // Remove Resources/ prefix and add build/ prefix: Resources/SFX/file.sfx -> build/SFX/file.wav
      const outputPath = file.path.replace(/\.sfx$/i, '.wav').replace(/^Resources\//, 'build/');
      
      console.log(`[SfxBuilder] Input path: ${inputPath}`);
      console.log(`[SfxBuilder] Output path: ${outputPath}`);
      
      // Save WAV file using FileManager
      if (fileManager) {
        await fileManager.saveFile(outputPath, wavData, {
          type: '.wav',
          binaryData: true
        });
        console.log(`[SfxBuilder] Saved WAV file to: ${outputPath}`);
      } else if (window.fileIOService) {
        // Fallback to direct fileIOService if FileManager not available
        await window.fileIOService.saveFile(outputPath, wavData, {
          type: '.wav',
          binaryData: true
        });
        console.log(`[SfxBuilder] Saved WAV file to: ${outputPath}`);
      }
      
      // Build files are saved to localStorage under build/ prefix
      // No automatic download - files go to virtual build directory
      
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
    // Simple JSON parsing for SFX parameters
    const defaultParams = {
      type: 'sine',
      frequency: 440,
      duration: 1.0
    };
    
    if (!jsonContent.trim()) {
      return defaultParams;
    }
    
    try {
      const params = JSON.parse(jsonContent);
      
      return {
        type: params.type || defaultParams.type,
        frequency: parseFloat(params.frequency) || defaultParams.frequency,
        duration: parseFloat(params.duration) || defaultParams.duration
      };
    } catch (error) {
      console.warn('[SfxBuilder] Failed to parse JSON, using defaults:', error);
    }
    
    return defaultParams;
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

// Export for global use
window.BuildSystem = BuildSystem;
window.BaseBuilder = BaseBuilder;
window.CopyBuilder = CopyBuilder;
window.SfxBuilder = SfxBuilder;
