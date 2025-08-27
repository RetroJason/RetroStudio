/**
 * TextureBuilder - Converts texture files (.texture) to D2 format (.d2) during build
 * Uses ImageData class for parsing and D2 format conversion
 * Extends BuilderBase for compatibility with new dynamic builder system
 */

console.log('[TextureBuilder] Loading builder...');

// Prevent redeclaration if already loaded
if (typeof window.TextureBuilder === 'undefined') {

class TextureBuilder extends window.BuilderBase {
  constructor() {
    super();
    this.name = 'Texture Builder';
    this.description = 'Converts .texture files to D2 texture format';
  }

  /**
   * Get the builder's unique identifier
   */
  static getId() {
    return 'texture';
  }

  /**
   * Get the builder's display name
   */
  static getName() {
    return 'Texture Builder';
  }

  /**
   * Get the builder's description
   */
  static getDescription() {
    return 'Converts .texture files to D2 texture format (.d2)';
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
   * Build a texture file by converting it to D2 format with progress reporting
   */
  async build(file) {
    console.log(`[TextureBuilder] Building texture: ${file.path}`);
    
    try {
      // Initialize progress reporting for texture building
      await this.initializeProgress(`Building Texture`, 'Validating texture file...');
      
      // Validate input
      this.updateProgress(10, 'Validating input file...');
      const validation = this.validateInput(file);
      if (!validation.valid) {
        this.cancelProgress(`Validation failed: ${validation.error}`);
        return this.createBuildResult(false, file.path, null, validation.error);
      }

      // Ensure ImageData class is available
      this.updateProgress(20, 'Checking dependencies...');
      if (!window.ImageData) {
        const error = 'ImageData class not available - required for texture building';
        this.cancelProgress(error);
        throw new Error(error);
      }

      // Create ImageData instance and load from texture file path
      this.updateProgress(30, 'Loading texture configuration...');
      console.log(`[TextureBuilder] Creating ImageData and loading from path: ${file.path}`);
      const imageData = new window.ImageData();
      
      // Extract the directory from the file path for proper path resolution
      const texturePath = file.path.replace(/^[^\/]+\//, ''); // Remove project prefix like "test/"
      console.log(`[TextureBuilder] Normalized texture path: ${texturePath}`);
      
      this.updateProgress(50, 'Loading source image data...');
      await imageData.loadFromTexturePath(texturePath);
      console.log(`[TextureBuilder] After loadFromTexturePath - frames: ${imageData.frames ? imageData.frames.length : 0}, width: ${imageData.width}, height: ${imageData.height}`);
      
      console.log(`[TextureBuilder] ImageData created from texture file: ${file.path}`);

      // Debug: Check ImageData state before export
      this.updateProgress(70, 'Processing image data...');
      console.log('[TextureBuilder] ImageData state before getD2():');
      console.log('  - frames:', imageData.frames ? imageData.frames.length : 'undefined');
      console.log('  - width:', imageData.width);
      console.log('  - height:', imageData.height);
      console.log('  - currentFrame:', imageData.currentFrame);
      console.log('  - textureConfig:', imageData.textureConfig);
      if (imageData.frames && imageData.frames.length > 0) {
        const frame = imageData.frames[imageData.currentFrame];
        console.log('  - frame colors length:', frame && frame.colors ? frame.colors.length : 'undefined');
        console.log('  - frame width:', frame ? frame.width : 'undefined');
        console.log('  - frame height:', frame ? frame.height : 'undefined');
      }

      // Get D2 binary data - ImageData handles all the complexity
      this.updateProgress(80, 'Converting to D2 format...');
      const d2Buffer = await imageData.getD2();

      // Generate output path
      this.updateProgress(90, 'Preparing output file...');
      const outputPath = this.generateOutputPath(file.path, '.d2');

      // Save to build directory
      this.updateProgress(95, 'Saving built texture...');
      await this.saveBuiltFile(outputPath, d2Buffer, {
        type: '.d2',
        binaryData: true
      });

      console.log(`[TextureBuilder] Successfully built: ${file.path} → ${outputPath} (${d2Buffer.byteLength} bytes)`);
      
      this.completeProgress(`Texture built successfully (${d2Buffer.byteLength} bytes)`);
      
      return this.createBuildResult(true, file.path, outputPath, null, {
        operation: 'texture-to-d2',
        width: imageData.width,
        height: imageData.height,
        format: 'd2',
        fileSize: d2Buffer.byteLength
      });

    } catch (error) {
      console.error(`[TextureBuilder] Failed to build ${file.path}:`, error);
      this.cancelProgress(`Build failed: ${error.message}`);
      console.error(`[TextureBuilder] Error name: ${error.name}`);
      console.error(`[TextureBuilder] Error message: ${error.message}`);
      console.error(`[TextureBuilder] Error stack:`, error.stack);
      return this.createBuildResult(false, file.path, null, error.message || error.toString());
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
   * Get build priority - high priority for texture files
   */
  static getPriority() {
    return 20; // High priority
  }

  /**
   * Get builder capabilities
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

// Export to global scope
window.TextureBuilder = TextureBuilder;
console.log('[TextureBuilder] Builder loaded');

// Auto-register with ComponentRegistry when available
if (window.componentRegistry) {
  window.componentRegistry.registerBuilder(TextureBuilder);
  console.log('[TextureBuilder] Registered with ComponentRegistry');
} else {
  // Wait for component registry to be available
  document.addEventListener('DOMContentLoaded', () => {
    if (window.componentRegistry) {
      window.componentRegistry.registerBuilder(TextureBuilder);
      console.log('[TextureBuilder] Registered with ComponentRegistry (deferred)');
    }
  });
}

} // End guard clause
