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
        window.gameEditor.projectExplorer.clearBuildFolder();
      }
      
      // Get all resource files from project explorer
      const resourceFiles = this.getAllResourceFiles();
      console.log(`[BuildSystem] Found ${resourceFiles.length} resource files to process`);
      
      const buildResults = [];
      let successCount = 0;
      let errorCount = 0;
      
      // Process each file
      for (const file of resourceFiles) {
        try {
          const result = await this.buildFile(file);
          buildResults.push(result);
          
          if (result.success) {
            successCount++;
            console.log(`[BuildSystem] ✓ Built: ${file.path} → ${result.outputPath}`);
            
            // Add the built file to the project explorer
            if (window.gameEditor && window.gameEditor.projectExplorer && result.outputPath) {
              await this.addBuiltFileToExplorer(result.outputPath, file);
            }
          } else {
            errorCount++;
            console.error(`[BuildSystem] ✗ Failed: ${file.path} - ${result.error}`);
          }
        } catch (error) {
          errorCount++;
          console.error(`[BuildSystem] ✗ Error building ${file.path}:`, error);
          buildResults.push({
            success: false,
            inputPath: file.path,
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
          total: resourceFiles.length,
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
  
  async addBuiltFileToExplorer(outputPath, originalFile) {
    try {
      console.log(`[BuildSystem] Adding built file to explorer: ${outputPath}`);
      
      // Load the built file from localStorage
      const fileData = await window.fileIOService.loadFromLocalStorage(outputPath);
      if (!fileData) {
        console.error(`[BuildSystem] Could not load built file from storage: ${outputPath}`);
        return;
      }
      
      // Extract the relative path from the build path (remove "build/" prefix)
      const relativePath = outputPath.replace(/^build\//, '');
      
      // Create a file object for the built file
      const builtFile = new File([fileData.content], originalFile.file.name, {
        type: originalFile.file.type
      });
      
      // Add to project explorer's build folder
      window.gameEditor.projectExplorer.addBuildFileToStructure(relativePath, {
        content: fileData.content,
        name: originalFile.file.name,
        path: outputPath
      });
      
      console.log(`[BuildSystem] Successfully added built file to explorer: ${relativePath}`);
    } catch (error) {
      console.error(`[BuildSystem] Failed to add built file to explorer:`, error);
    }
  }

  async buildFile(file) {
    const builder = this.getBuilderForFile(file.name);
    if (!builder) {
      return {
        success: false,
        inputPath: file.path,
        error: 'No builder found for file type'
      };
    }
    
    return await builder.build(file);
  }
  
  getAllResourceFiles() {
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
    // This method is not used since ProjectExplorer doesn't have a .files property
    // Instead, we use getAllResourceFiles() which traverses the projectData.structure
    return this.getAllResourceFiles();
  }

  extractFilesFromNode(node, basePath = '') {
    const files = [];
    
    if (!node) {
      return files;
    }

    if (node.type === 'file' && node.file) {
      files.push({
        name: node.file.name,
        path: basePath + node.file.name,
        file: node.file,
        folder: basePath
      });
    } else if (node.type === 'folder' && node.children) {
      // Recursively process all children in the folder
      for (const [childName, childNode] of Object.entries(node.children)) {
        if (childNode.type === 'file') {
          // For files, use basePath + childName
          files.push(...this.extractFilesFromNode(childNode, basePath));
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
      
      // Read file content
      const content = await file.file.arrayBuffer();
      
      // Save to build directory
      if (window.fileIOService) {
        await window.fileIOService.saveFile(outputPath, content, {
          binaryData: true
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
      // Parse SFX file to get parameters
      const text = await file.file.text();
      const parameters = this.parseParameters(text);
      
      // Generate audio
      const audioBuffer = await this.synthesizeAudio(parameters);
      if (!audioBuffer) {
        throw new Error('Failed to synthesize audio');
      }
      
      // Convert to WAV
      const wavData = this.audioBufferToWav(audioBuffer);
      
      // Generate output path (convert .sfx to .wav in build directory)
      const inputPath = file.path;
      // Remove Resources/ prefix and add build/ prefix: Resources/SFX/file.sfx -> build/SFX/file.wav
      const outputPath = file.path.replace(/\.sfx$/i, '.wav').replace(/^Resources\//, 'build/');
      
      console.log(`[SfxBuilder] Input path: ${inputPath}`);
      console.log(`[SfxBuilder] Output path: ${outputPath}`);
      
      // Save WAV file
      if (window.fileIOService) {
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
  
  parseParameters(xmlContent) {
    // Simple XML parsing for SFX parameters
    const defaultParams = {
      type: 'sine',
      frequency: 440,
      duration: 1.0
    };
    
    if (!xmlContent.trim()) {
      return defaultParams;
    }
    
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlContent, 'text/xml');
      
      const soundEffect = doc.querySelector('SoundEffect');
      if (soundEffect) {
        return {
          type: soundEffect.getAttribute('type') || defaultParams.type,
          frequency: parseFloat(soundEffect.getAttribute('frequency')) || defaultParams.frequency,
          duration: parseFloat(soundEffect.getAttribute('duration')) || defaultParams.duration
        };
      }
    } catch (error) {
      console.warn('[SfxBuilder] Failed to parse XML, using defaults:', error);
    }
    
    return defaultParams;
  }
  
  async synthesizeAudio(parameters) {
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
