/**
 * CopyBuilder - Copies files directly to the build directory without modification
 * Used for assets that don't need processing (images, audio, etc.)
 */

if (typeof window.CopyBuilder === 'undefined') {

console.log('[CopyBuilder] Loading builder...');

class CopyBuilder extends window.BuilderBase {
  constructor() {
    super();
    this.name = 'Copy Builder';
    this.description = 'Copies files to build directory without modification';
  }

  /**
   * Get the builder's unique identifier
   */
  static getId() {
    return 'copy';
  }

  /**
   * Get the builder's display name
   */
  static getName() {
    return 'Copy Builder';
  }

  /**
   * Get the builder's description
   */
  static getDescription() {
    return 'Copies files to build directory without modification';
  }

  /**
   * Get supported input file extensions
   * Copy builder supports many common file types, but NOT images (they should be handled by texture system)
   */
  static getSupportedExtensions() {
    return [
      // Audio
      '.wav', '.mp3', '.ogg', '.m4a', '.flac',
      // Documents
      '.txt', '.md', '.json', '.xml', '.csv',
      // Scripts
      '.lua', '.js', '.py',
      // Modules
      '.mod', '.xm', '.s3m', '.it',
      // Palettes
      '.act', '.pal',
      // Other
      '.dat', '.bin'
    ];
  }

  /**
   * Get the output extension (same as input for copy)
   */
  static getOutputExtension() {
    return null; // Same as input
  }

  /**
   * Check if this builder can handle the given file
   */
  static canBuild(filePath) {
    const extension = this.getFileExtension(filePath).toLowerCase();
    return this.getSupportedExtensions().includes(extension);
  }

  /**
   * Get build priority - copy builder has low priority
   * Other specialized builders should take precedence
   */
  static getPriority() {
    return 90; // Low priority
  }

  /**
   * Get builder capabilities
   */
  static getCapabilities() {
    return ['file-copy', 'asset-passthrough'];
  }

  /**
   * Build a file by copying it
   */
  async build(file) {
    console.log(`[CopyBuilder] Copying file: ${file.path}`);

    try {
      // Validate input
      const validation = this.validateInput(file);
      if (!validation.valid) {
        return this.createBuildResult(false, file.path, null, validation.error);
      }

      // Generate output path (same extension as input)
      const inputExtension = this.constructor.getFileExtension(file.path);
      const outputPath = this.generateOutputPath(file.path, inputExtension);

      // Get file content
      let content;
      if (file.content !== undefined) {
        // Content already available
        content = file.content;
      } else {
        // Load file content
        const loadedFile = await this.loadInputFile(file.path);
        content = loadedFile.content;
      }

      // Determine if content is binary
      const isBinary = content instanceof ArrayBuffer || 
                      ArrayBuffer.isView(content) ||
                      (typeof content === 'string' && file.binaryData === true);

      // Save to build directory
      await this.saveBuiltFile(outputPath, content, {
        binaryData: isBinary
      });

      // Calculate file size for metadata
      let fileSize = 0;
      if (content instanceof ArrayBuffer) {
        fileSize = content.byteLength;
      } else if (ArrayBuffer.isView(content)) {
        fileSize = content.byteLength;
      } else if (typeof content === 'string') {
        fileSize = content.length;
      }

      console.log(`[CopyBuilder] Successfully copied: ${file.path} → ${outputPath} (${fileSize} bytes)`);

      return this.createBuildResult(true, file.path, outputPath, null, {
        operation: 'copy',
        fileSize: fileSize,
        isBinary: isBinary
      });

    } catch (error) {
      console.error(`[CopyBuilder] Failed to copy ${file.path}:`, error);
      return this.createBuildResult(false, file.path, null, error.message);
    }
  }

  /**
   * Get the output extension for a specific input file
   */
  getOutputExtensionForFile(filePath) {
    return this.constructor.getFileExtension(filePath);
  }
}

// Export to global scope
window.CopyBuilder = CopyBuilder;
console.log('[CopyBuilder] Builder loaded');

// Auto-register with ComponentRegistry when available
if (window.componentRegistry) {
  window.componentRegistry.registerBuilder(CopyBuilder);
  console.log('[CopyBuilder] Registered with ComponentRegistry');
} else {
  // Wait for component registry to be available
  document.addEventListener('DOMContentLoaded', () => {
    if (window.componentRegistry) {
      window.componentRegistry.registerBuilder(CopyBuilder);
      console.log('[CopyBuilder] Registered with ComponentRegistry (deferred)');
    }
  });
}

} // End guard clause
