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
  
  async buildProject(projectFiles = null) {
    if (this.isBuilding) {
      console.log('[BuildSystem] Build already in progress');
      return { success: false, error: 'Build already in progress' };
    }
    
    try {
      this.isBuilding = true;
      console.log('[BuildSystem] Starting project build...');
      
      // Get all resource files from project explorer or use provided files
      const resourceFiles = projectFiles ? this.extractFilesFromProjectExplorer(projectFiles) : this.getAllResourceFiles();
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
      files.push(...this.extractFilesFromNode(explorer.resources, 'Resources/'));
    }
    
    return files;
  }
  
  extractFilesFromProjectExplorer(projectFiles) {
    const files = [];
    
    // ProjectExplorer.files is a Map structure where each entry contains file data
    if (projectFiles && typeof projectFiles.forEach === 'function') {
      projectFiles.forEach((fileData, filePath) => {
        files.push({
          name: fileData.name || filePath.split('/').pop(),
          path: filePath,
          file: fileData.file || fileData,
          folder: filePath.substring(0, filePath.lastIndexOf('/') + 1)
        });
      });
    }
    
    console.log(`[BuildSystem] Extracted ${files.length} files from project explorer`);
    return files;
  }
  
  extractFilesFromNode(node, basePath = '') {
    const files = [];
    
    if (node.type === 'file' && node.file) {
      files.push({
        name: node.name,
        path: basePath + node.name,
        file: node.file,
        folder: basePath
      });
    } else if (node.type === 'folder' && node.children) {
      for (const child of node.children) {
        const childPath = basePath + node.name + '/';
        files.push(...this.extractFilesFromNode(child, childPath));
      }
    }
    
    return files;
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
      const outputPath = `build/${file.path}`;
      
      // Read file content
      const content = await file.file.arrayBuffer();
      
      // Save to build directory
      if (window.fileIOService) {
        await window.fileIOService.saveFile(outputPath, content, {
          binaryData: true
        });
      }
      
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
      const outputPath = file.path.replace(/\.sfx$/i, '.wav').replace(/^Resources\//, 'build/Resources/');
      
      // Save WAV file
      if (window.fileIOService) {
        await window.fileIOService.saveFile(outputPath, wavData, {
          type: '.wav',
          binaryData: true
        });
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
