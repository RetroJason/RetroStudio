/**
 * Base class for all builders in the RetroStudio build system
 * Provides the standard interface and common functionality
 */

console.log('[BuilderBase] Loading base class...');

// Prevent redeclaration if already loaded
if (typeof window.BuilderBase === 'undefined') {

class BuilderBase {
  constructor() {
    this.name = 'Base Builder';
    this.version = '1.0.0';
    this.description = 'Base class for builders';
  }

  /**
   * Get the builder's unique identifier
   * @returns {string} Builder ID
   */
  static getId() {
    throw new Error('Builder must implement static getId() method');
  }

  /**
   * Get the builder's display name
   * @returns {string} Display name
   */
  static getName() {
    throw new Error('Builder must implement static getName() method');
  }

  /**
   * Get the builder's description
   * @returns {string} Description
   */
  static getDescription() {
    return 'No description provided';
  }

  /**
   * Get supported input file extensions
   * @returns {Array<string>} Array of extensions (e.g., ['.texture', '.tex'])
   */
  static getSupportedExtensions() {
    throw new Error('Builder must implement static getSupportedExtensions() method');
  }

  /**
   * Get the output extension for built files
   * @returns {string} Output extension (e.g., '.d2')
   */
  static getOutputExtension() {
    throw new Error('Builder must implement static getOutputExtension() method');
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
   * Build a file
   * @param {Object} file - File object with path, content, etc.
   * @returns {Promise<Object>} Build result with success/error info
   */
  async build(file) {
    throw new Error('Builder must implement build() method');
  }

  /**
   * Get build priority (lower = higher priority)
   * Higher priority builders are preferred when multiple builders support the same extension
   * @returns {number} Priority value (0 = highest, 100 = lowest)
   */
  static getPriority() {
    return 50; // Default medium priority
  }

  /**
   * Get builder capabilities/features
   * @returns {Array<string>} Array of capability strings
   */
  static getCapabilities() {
    return [];
  }

  /**
   * Get builder metadata for registration
   * @returns {Object} Builder metadata
   */
  static getMetadata() {
    return {
      id: this.getId(),
      name: this.getName(),
      description: this.getDescription(),
      version: '1.0.0',
      supportedExtensions: this.getSupportedExtensions(),
      outputExtension: this.getOutputExtension(),
      priority: this.getPriority(),
      capabilities: this.getCapabilities()
    };
  }

  /**
   * Validate build input
   * @param {Object} file - File object to validate
   * @returns {Object} Validation result { valid: boolean, error?: string }
   */
  validateInput(file) {
    if (!file) {
      return { valid: false, error: 'No file provided' };
    }

    if (!file.path) {
      return { valid: false, error: 'File path is required' };
    }

    if (!this.constructor.canBuild(file.path)) {
      return { valid: false, error: `File extension not supported by ${this.constructor.getName()}` };
    }

    return { valid: true };
  }

  /**
   * Generate standard build result object
   * @param {boolean} success - Whether build succeeded
   * @param {string} inputPath - Input file path
   * @param {string} outputPath - Output file path (if successful)
   * @param {string} error - Error message (if failed)
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Build result
   */
  createBuildResult(success, inputPath, outputPath = null, error = null, metadata = {}) {
    const result = {
      success,
      inputPath,
      builderId: this.constructor.getId(),
      builderName: this.constructor.getName(),
      timestamp: new Date().toISOString()
    };

    if (success && outputPath) {
      result.outputPath = outputPath;
      result.metadata = metadata;
    }

    if (!success && error) {
      result.error = error;
    }

    return result;
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
  changeExtension(filePath, newExtension) {
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot >= 0) {
      return filePath.substring(0, lastDot) + newExtension;
    }
    return filePath + newExtension;
  }

  /**
   * Generate output path for built file
   * @param {string} inputPath - Input file path
   * @param {string} outputExtension - Output extension
   * @returns {string} Output path in build directory
   */
  generateOutputPath(inputPath, outputExtension = null) {
    const extension = outputExtension || this.constructor.getOutputExtension();
    const outputFilename = this.changeExtension(inputPath, extension);
    
    // Use ProjectPaths if available, otherwise simple replacement
    if (window.ProjectPaths && typeof window.ProjectPaths.toBuildOutputPath === 'function') {
      return window.ProjectPaths.toBuildOutputPath(outputFilename);
    }
    
    // Fallback: simple replacement
    return outputFilename.replace(/^(test\/)?Sources\//, 'build/');
  }

  /**
   * Save built file using FileManager
   * @param {string} outputPath - Output file path
   * @param {*} content - File content (string, ArrayBuffer, etc.)
   * @param {Object} options - Save options
   * @returns {Promise<boolean>} Success status
   */
  async saveBuiltFile(outputPath, content, options = {}) {
    const fileManager = window.serviceContainer?.get('fileManager');
    if (!fileManager) {
      throw new Error('FileManager not available');
    }

    try {
      await fileManager.saveFile(outputPath, content, options);
      console.log(`[${this.constructor.getName()}] Saved: ${outputPath}`);
      return true;
    } catch (error) {
      console.error(`[${this.constructor.getName()}] Failed to save ${outputPath}:`, error);
      throw error;
    }
  }

  /**
   * Load input file using FileManager
   * @param {string} filePath - Input file path
   * @returns {Promise<Object>} File content object
   */
  async loadInputFile(filePath) {
    const fileManager = window.serviceContainer?.get('fileManager');
    if (!fileManager) {
      throw new Error('FileManager not available');
    }

    try {
      const file = await fileManager.loadFile(filePath);
      console.log(`[${this.constructor.getName()}] Loaded: ${filePath}`);
      return file;
    } catch (error) {
      console.error(`[${this.constructor.getName()}] Failed to load ${filePath}:`, error);
      throw error;
    }
  }
}

// Export to global scope
window.BuilderBase = BuilderBase;
console.log('[BuilderBase] Base class loaded');

} // End guard clause
