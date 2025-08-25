/**
 * TextureBuilder - Converts texture files (.texture) to D2 format (.d2) during build
 * Uses ImageData class for parsing and D2 format conversion
 * Extends BaseBuilder for compatibility with BuildSystem
 */

class TextureBuilder extends window.BaseBuilder {
  constructor() {
    super();
    this.name = 'Texture Builder';
    this.version = '1.0.0';
  }

  /**
   * Get supported input file extensions
   * @returns {Array} Array of supported extensions
   */
  static getSupportedExtensions() {
    return ['.texture']; // Convert .texture files to .d2
  }

  /**
   * Get the output extension for built files
   * @returns {string} Output extension
   */
  static getOutputExtension() {
    return '.d2';
  }

  /**
   * Check if this builder can handle the given file
   * @param {string} filePath - Input file path
   * @returns {boolean} True if this builder can handle the file
   */
  static canBuild(filePath) {
    const extension = this.getFileExtension(filePath);
    return this.getSupportedExtensions().includes(extension.toLowerCase());
  }

  /**
   * Build a texture file by converting it to D2 format
   * @param {Object} file - File object with path, content, etc.
   * @returns {Promise<Object>} Build result with success/error info
   */
  async build(file) {
    console.log(`[TextureBuilder] Building texture: ${file.path || file.name}`);
    
    try {
      // Ensure ImageData class is available
      if (!window.ImageData) {
        throw new Error('ImageData class not available - required for texture building');
      }

      // Parse the .texture file content to extract build parameters
      const textureConfig = this.parseTextureFile(file.content, file.path);
      console.log(`[TextureBuilder] Parsed texture config:`, textureConfig);

      // Create ImageData instance with texture file content
      const imageData = new window.ImageData(file.content);
      
      // Get D2 binary data
      const d2Buffer = await imageData.getD2();

      // Generate output path with .d2 extension
      const outputFilename = this.changeExtension(file.path, '.d2');
      const outputPath = (window.ProjectPaths && typeof window.ProjectPaths.toBuildOutputPath === 'function')
        ? window.ProjectPaths.toBuildOutputPath(outputFilename)
        : outputFilename.replace(/^Resources\//, 'build/');

      // Save to build directory using FileManager
      const fileManager = window.serviceContainer?.get('fileManager');
      if (fileManager) {
        await fileManager.saveFile(outputPath, d2Buffer, {
          type: '.d2',
          binaryData: true
        });
      }

      console.log(`[TextureBuilder] Successfully built D2 texture: ${outputPath} (${d2Buffer.byteLength} bytes)`);
      
      return {
        success: true,
        inputPath: file.path,
        outputPath: outputPath,
        builder: 'texture',
        metadata: {
          width: imageData.width,
          height: imageData.height,
          targetFormat: '.d2',
          fileSize: d2Buffer.byteLength
        }
      };

    } catch (error) {
      console.error(`[TextureBuilder] Failed to build texture ${file.path}:`, error);
      
      return {
        success: false,
        inputPath: file.path,
        error: error.message,
        builder: 'texture'
      };
    }
  }

  /**
   * Parse .texture file content to extract build configuration
   * @param {string} content - File content
   * @param {string} filePath - File path for context
   * @returns {Object} Parsed texture configuration
   */
  parseTextureFile(content, filePath) {
    try {
      // Parse JSON content
      const config = JSON.parse(content);
      
      // Validate required fields
      if (!config.sourceImage) {
        throw new Error('Missing required field: sourceImage');
      }

      // Resolve source image path relative to texture file
      const textureDir = filePath.substring(0, filePath.lastIndexOf('/'));
      const sourceImagePath = textureDir + '/' + config.sourceImage;

      // Map d2_mode_* format names from colorFormat to D2 format constants
      const d2ModeFormatMap = {
        'd2_mode_alpha8': window.ImageData.D2_FORMAT.ALPHA8,
        'd2_mode_rgb565': window.ImageData.D2_FORMAT.RGB565,
        'd2_mode_argb8888': window.ImageData.D2_FORMAT.ARGB8888,
        'd2_mode_rgb888': window.ImageData.D2_FORMAT.RGB888,
        'd2_mode_argb4444': window.ImageData.D2_FORMAT.ARGB4444,
        'd2_mode_rgb444': window.ImageData.D2_FORMAT.RGB444,
        'd2_mode_argb1555': window.ImageData.D2_FORMAT.ARGB1555,
        'd2_mode_rgb555': window.ImageData.D2_FORMAT.RGB555,
        'd2_mode_ai44': window.ImageData.D2_FORMAT.AI44,
        'd2_mode_rgba8888': window.ImageData.D2_FORMAT.RGBA8888,
        'd2_mode_rgba4444': window.ImageData.D2_FORMAT.RGBA4444,
        'd2_mode_rgba5551': window.ImageData.D2_FORMAT.RGBA5551,
        'd2_mode_i8': window.ImageData.D2_FORMAT.I8,
        'd2_mode_i4': window.ImageData.D2_FORMAT.I4,
        'd2_mode_i2': window.ImageData.D2_FORMAT.I2,
        'd2_mode_i1': window.ImageData.D2_FORMAT.I1,
        'd2_mode_alpha4': window.ImageData.D2_FORMAT.ALPHA4,
        'd2_mode_alpha2': window.ImageData.D2_FORMAT.ALPHA2,
        'd2_mode_alpha1': window.ImageData.D2_FORMAT.ALPHA1
      };

      // Get format from colorFormat - this is the source of truth
      if (!config.colorFormat) {
        throw new Error('Missing required field: colorFormat');
      }

      const targetFormat = d2ModeFormatMap[config.colorFormat];
      if (targetFormat === undefined) {
        throw new Error(`Unsupported colorFormat: ${config.colorFormat}`);
      }

      // Parse flags from array or string
      let flags = 0;
      if (config.flags) {
        if (Array.isArray(config.flags)) {
          const flagMap = {
            'WRAPU': 0x01,
            'WRAPV': 0x02,
            'FILTERU': 0x04,
            'FILTERV': 0x08,
            'FILTER': 0x0C
          };
          config.flags.forEach(flag => {
            if (flagMap[flag]) flags |= flagMap[flag];
          });
        } else if (typeof config.flags === 'number') {
          flags = config.flags;
        }
      }

      return {
        sourceImagePath: sourceImagePath,
        format: targetFormat,
        paletteName: config.paletteName || config.palette || '',
        palette: config.palette || config.paletteName || '',
        useRLE: config.useRLE || false,
        flags: flags,
        prerotation: config.prerotation || 0
      };

    } catch (error) {
      throw new Error(`Failed to parse texture file: ${error.message}`);
    }
  }

  /**
   * Get MIME type from file path
   * @param {string} filePath - File path
   * @returns {string} MIME type
   */
  getMimeTypeFromPath(filePath) {
    const extension = this.getFileExtension(filePath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp'
    };
    return mimeTypes[extension] || 'application/octet-stream';
  }

  /**
   * Get file extension from path
   * @param {string} filePath - File path
   * @returns {string} File extension (including dot)
   */
  getFileExtension(filePath) {
    const lastDot = filePath.lastIndexOf('.');
    return lastDot >= 0 ? filePath.substring(lastDot) : '';
  }

  /**
   * Change file extension
   * @param {string} filePath - Original file path
   * @param {string} newExtension - New extension (including dot)
   * @returns {string} Path with new extension
   */
  changeExtension(filePath, newExtension) {
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot >= 0) {
      return filePath.substring(0, lastDot) + newExtension;
    }
    return filePath + newExtension;
  }

  /**
   * Get build priority (lower = higher priority)
   * @returns {number} Priority value
   */
  static getPriority() {
    return 10;
  }

  /**
   * Get builder capabilities
   * @returns {Array} Array of capability strings
   */
  static getCapabilities() {
    return ['texture-conversion', 'd2-format', 'image-processing'];
  }

  /**
   * Get builder metadata for registration
   * @returns {Object} Builder metadata
   */
  static getMetadata() {
    return {
      name: 'Texture Builder',
      description: 'Converts .texture files to D2 texture format (.d2)',
      version: '1.0.0',
      author: 'RetroStudio',
      supportedExtensions: this.getSupportedExtensions(),
      outputExtension: this.getOutputExtension(),
      capabilities: this.getCapabilities()
    };
  }
}

// Export for use
window.TextureBuilder = TextureBuilder;
console.log('[TextureBuilder] Builder class loaded');

// Register with BuildSystem immediately when available
// Since build-system.js loads before this file, window.buildSystem should be available
if (window.buildSystem && typeof window.buildSystem.registerBuilder === 'function') {
  window.buildSystem.registerBuilder('.texture', new TextureBuilder());
  console.log('[TextureBuilder] Registered with BuildSystem for .texture files');
} else {
  console.warn('[TextureBuilder] BuildSystem not available yet, will retry on window load');
  
  // Fallback: try again when window finishes loading
  window.addEventListener('load', () => {
    if (window.buildSystem && typeof window.buildSystem.registerBuilder === 'function') {
      window.buildSystem.registerBuilder('.texture', new TextureBuilder());
      console.log('[TextureBuilder] Registered with BuildSystem for .texture files (on window load)');
    } else {
      console.error('[TextureBuilder] BuildSystem still not available after window load');
    }
  });
}
