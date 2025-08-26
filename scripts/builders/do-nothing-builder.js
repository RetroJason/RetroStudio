/**
 * DoNothingBuilder - Excludes files from the build process
 * Used for files that should not be included in the final build output
 */

console.log('[DoNothingBuilder] Loading builder...');

// Prevent redeclaration if already loaded
if (typeof window.DoNothingBuilder === 'undefined') {

class DoNothingBuilder extends window.BuilderBase {
  constructor() {
    super();
    this.name = 'Do Nothing Builder';
    this.description = 'Excludes files from build output';
  }

  /**
   * Get the builder's unique identifier
   */
  static getId() {
    return 'do-nothing';
  }

  /**
   * Get the builder's display name
   */
  static getName() {
    return 'Do Nothing Builder';
  }

  /**
   * Get the builder's description
   */
  static getDescription() {
    return 'Excludes files from build output (no file is generated)';
  }

  /**
   * Get supported input file extensions
   * This builder can handle any file type for exclusion
   */
  static getSupportedExtensions() {
    return [
      // Development files
      '.md', '.txt', '.log',
      // Temporary files
      '.tmp', '.temp', '.bak',
      // Source files that shouldn't be built
      '.psd', '.ai', '.sketch',
      // Documentation
      '.readme', '.license', '.changelog',
      // IDE files
      '.vscode', '.idea',
      // Version control
      '.git', '.gitignore',
      // Build files
      '.build', '.cache',
      // Image files (source images should not be copied to build)
      '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico',
      // Wildcard - can exclude any extension if explicitly configured
      '*'
    ];
  }

  /**
   * Get the output extension (empty for do-nothing)
   */
  static getOutputExtension() {
    return ''; // Empty string instead of null
  }

  /**
   * Check if this builder can handle the given file
   * Do-nothing builder accepts files based on extension matching
   */
  static canBuild(filePath) {
    const extension = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
    return this.getSupportedExtensions().includes(extension) || this.getSupportedExtensions().includes('*');
  }

  /**
   * Get build priority - should be higher than CopyBuilder for image files
   */
  static getPriority() {
    return 80; // Higher priority than CopyBuilder (90)
  }

  /**
   * Get builder capabilities
   */
  static getCapabilities() {
    return ['exclude-from-build', 'no-output'];
  }

  /**
   * Build a file by doing nothing (excluding it)
   */
  async build(file) {
    console.log(`[DoNothingBuilder] Excluding file from build: ${file.path}`);
    console.log(`[DoNothingBuilder] File extension: ${file.path.substring(file.path.lastIndexOf('.'))}`);

    try {
      // Validate input
      const validation = this.validateInput(file);
      if (!validation.valid) {
        return this.createBuildResult(false, file.path, null, validation.error);
      }

      // Calculate file size for metadata
      let fileSize = 0;
      if (file.content !== undefined) {
        if (file.content instanceof ArrayBuffer) {
          fileSize = file.content.byteLength;
        } else if (ArrayBuffer.isView(file.content)) {
          fileSize = file.content.byteLength;
        } else if (typeof file.content === 'string') {
          fileSize = file.content.length;
        }
      }

      console.log(`[DoNothingBuilder] Successfully excluded: ${file.path} (${fileSize} bytes)`);

      // Return success but with no output path (file was excluded)
      return this.createBuildResult(true, file.path, null, null, {
        operation: 'exclude',
        reason: 'File excluded from build by Do Nothing Builder',
        originalSize: fileSize
      });

    } catch (error) {
      console.error(`[DoNothingBuilder] Error processing ${file.path}:`, error);
      return this.createBuildResult(false, file.path, null, error.message);
    }
  }

  /**
   * Override canBuild to allow explicit assignment
   */
  static canBuildExplicitly(filePath) {
    // Can handle any file if explicitly assigned
    return true;
  }
}

// Export to global scope
window.DoNothingBuilder = DoNothingBuilder;
console.log('[DoNothingBuilder] Builder loaded');

// Auto-register with ComponentRegistry when available
if (window.componentRegistry) {
  window.componentRegistry.registerBuilder(DoNothingBuilder);
  console.log('[DoNothingBuilder] Registered with ComponentRegistry');
} else {
  // Wait for component registry to be available
  document.addEventListener('DOMContentLoaded', () => {
    if (window.componentRegistry) {
      window.componentRegistry.registerBuilder(DoNothingBuilder);
      console.log('[DoNothingBuilder] Registered with ComponentRegistry (deferred)');
    }
  });
}

} // End guard clause
