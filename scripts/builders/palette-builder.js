/**
 * PaletteBuilder - Converts palette files (.pal, .aco) to .act format during build
 * Uses shared PaletteUtils for parsing and conversion
 */

class PaletteBuilder {
  constructor() {
    this.name = 'Palette Builder';
    this.version = '1.0.0';
  }

  /**
   * Get supported input file extensions
   * @returns {Array} Array of supported extensions
   */
  static getSupportedExtensions() {
    return ['.pal', '.aco']; // Convert these to .act, but don't convert .act files
  }

  /**
   * Get the output extension for built files
   * @returns {string} Output extension
   */
  static getOutputExtension() {
    return '.act';
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
   * Build a palette file by converting it to .act format
   * @param {Object} buildContext - Build context with file information
   * @returns {Promise<Object>} Build result with output file data
   */
  static async build(buildContext) {
    const { inputPath, outputPath, fileContent } = buildContext;
    
    console.log(`[PaletteBuilder] Building palette: ${inputPath} -> ${outputPath}`);
    
    try {
      // Ensure PaletteUtils is available
      if (!window.PaletteUtils) {
        throw new Error('PaletteUtils not available - required for palette building');
      }

      // Get input file extension
      const inputExtension = this.getFileExtension(inputPath);
      console.log(`[PaletteBuilder] Input format: ${inputExtension}`);

      // Parse the input palette file
      const colors = window.PaletteUtils.parsePalette(fileContent, inputExtension);
      console.log(`[PaletteBuilder] Parsed ${colors.length} colors from input file`);

      // Convert to .act format
      const actBuffer = window.PaletteUtils.exportToACT(colors);
      const actBase64 = window.PaletteUtils.arrayBufferToBase64(actBuffer);

      // Generate output path with .act extension
      const outputActPath = this.changeExtension(outputPath, '.act');

      console.log(`[PaletteBuilder] Successfully built palette: ${outputActPath}`);
      
      return {
        success: true,
        outputPath: outputActPath,
        outputContent: actBase64,
        contentType: 'binary',
        metadata: {
          colorCount: colors.length,
          sourceFormat: inputExtension,
          targetFormat: '.act',
          builder: 'PaletteBuilder'
        }
      };

    } catch (error) {
      console.error(`[PaletteBuilder] Failed to build palette ${inputPath}:`, error);
      
      return {
        success: false,
        error: error.message,
        outputPath: null,
        outputContent: null
      };
    }
  }

  /**
   * Get file extension from path
   * @param {string} filePath - File path
   * @returns {string} File extension (including dot)
   */
  static getFileExtension(filePath) {
    const lastDot = filePath.lastIndexOf('.');
    return lastDot >= 0 ? filePath.substring(lastDot) : '';
  }

  /**
   * Change file extension
   * @param {string} filePath - Original file path
   * @param {string} newExtension - New extension (including dot)
   * @returns {string} Path with new extension
   */
  static changeExtension(filePath, newExtension) {
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
    return ['palette-conversion', 'format-standardization'];
  }

  /**
   * Get builder metadata for registration
   * @returns {Object} Builder metadata
   */
  static getMetadata() {
    return {
      name: 'Palette Builder',
      description: 'Converts palette files to Adobe Color Table (.act) format',
      version: '1.0.0',
      author: 'RetroStudio',
      supportedExtensions: this.getSupportedExtensions(),
      outputExtension: this.getOutputExtension(),
      capabilities: this.getCapabilities()
    };
  }
}

// Export for use
window.PaletteBuilder = PaletteBuilder;
console.log('[PaletteBuilder] Builder class loaded');

// Auto-register with build system if available
if (typeof window.BuildSystem !== 'undefined') {
  window.BuildSystem.registerBuilder('PaletteBuilder', PaletteBuilder);
  console.log('[PaletteBuilder] Registered with BuildSystem');
} else {
  // Try to register when BuildSystem becomes available
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (typeof window.BuildSystem !== 'undefined') {
        window.BuildSystem.registerBuilder('PaletteBuilder', PaletteBuilder);
        console.log('[PaletteBuilder] Late-registered with BuildSystem');
      }
    }, 100);
  });
}
