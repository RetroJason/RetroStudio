/**
 * ImageBuilder - Handles image files intelligently
 * - If image has associated .texture file: excludes from build (texture handles it)
 * - If image has no .texture file: copies to build directory
 */

console.log('[ImageBuilder] Loading builder...');

class ImageBuilder extends window.BuilderBase {
  constructor() {
    super();
    this.name = 'Image Builder';
    this.description = 'Handles images based on whether they have associated texture files';
  }

  /**
   * Get the builder's unique identifier
   */
  static getId() {
    return 'image';
  }

  /**
   * Get the builder's display name
   */
  static getName() {
    return 'Image Builder';
  }

  /**
   * Get the builder's description
   */
  static getDescription() {
    return 'Handles images: excludes if .texture exists, copies otherwise';
  }

  /**
   * Get supported input file extensions
   */
  static getSupportedExtensions() {
    return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.tga'];
  }

  /**
   * Get the output extension (variable - could be same or null)
   */
  static getOutputExtension() {
    return null; // Variable - depends on whether texture file exists
  }

  /**
   * Get build priority - medium priority
   */
  static getPriority() {
    return 40; // Higher than copy builder but lower than texture builder
  }

  /**
   * Get builder capabilities
   */
  static getCapabilities() {
    return ['smart-image-handling', 'texture-aware', 'conditional-copy'];
  }

  /**
   * Build an image file by checking for associated texture file
   */
  async build(file) {
    console.log(`[ImageBuilder] Processing image: ${file.path}`);

    try {
      // Validate input
      const validation = this.validateInput(file);
      if (!validation.valid) {
        return this.createBuildResult(false, file.path, null, validation.error);
      }

      // Check if there's an associated .texture file
      const hasTextureFile = await this.hasAssociatedTextureFile(file.path);

      if (hasTextureFile) {
        // Exclude from build - the texture file will handle this image
        console.log(`[ImageBuilder] Excluding ${file.path} - has associated .texture file`);
        
        return this.createBuildResult(true, file.path, null, null, {
          operation: 'exclude',
          reason: 'Image has associated .texture file',
          handledBy: 'texture-builder'
        });
      } else {
        // Copy to build directory - standalone image
        console.log(`[ImageBuilder] Copying ${file.path} - no associated .texture file`);
        
        // Get file content
        let content;
        if (file.content !== undefined) {
          content = file.content;
        } else {
          const loadedFile = await this.loadInputFile(file.path);
          content = loadedFile.content;
        }

        // Generate output path (same extension as input)
        const inputExtension = this.constructor.getFileExtension(file.path);
        const outputPath = this.generateOutputPath(file.path, inputExtension);

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

        console.log(`[ImageBuilder] Successfully copied: ${file.path} → ${outputPath} (${fileSize} bytes)`);

        return this.createBuildResult(true, file.path, outputPath, null, {
          operation: 'copy',
          reason: 'Standalone image with no .texture file',
          fileSize: fileSize,
          isBinary: isBinary
        });
      }

    } catch (error) {
      console.error(`[ImageBuilder] Failed to process ${file.path}:`, error);
      return this.createBuildResult(false, file.path, null, error.message);
    }
  }

  /**
   * Check if an image file has an associated .texture file
   */
  async hasAssociatedTextureFile(imagePath) {
    try {
      // Generate expected texture file path
      const textureFilePath = this.changeExtension(imagePath, '.texture');
      
      // Check if texture file exists using FileManager
      const fileManager = window.serviceContainer?.get('fileManager');
      if (!fileManager) {
        console.warn('[ImageBuilder] FileManager not available for texture file check');
        return false;
      }

      try {
        await fileManager.loadFile(textureFilePath);
        console.log(`[ImageBuilder] Found associated texture file: ${textureFilePath}`);
        return true;
      } catch (error) {
        // File doesn't exist or can't be loaded
        console.log(`[ImageBuilder] No texture file found for ${imagePath} (checked: ${textureFilePath})`);
        return false;
      }
    } catch (error) {
      console.warn(`[ImageBuilder] Error checking for texture file:`, error);
      return false;
    }
  }

  /**
   * Get all image files that should be excluded (have texture files)
   */
  async getExcludedImages(imageFiles) {
    const excluded = [];
    
    for (const imageFile of imageFiles) {
      if (await this.hasAssociatedTextureFile(imageFile)) {
        excluded.push(imageFile);
      }
    }
    
    return excluded;
  }

  /**
   * Get all standalone images (no texture files)
   */
  async getStandaloneImages(imageFiles) {
    const standalone = [];
    
    for (const imageFile of imageFiles) {
      if (!(await this.hasAssociatedTextureFile(imageFile))) {
        standalone.push(imageFile);
      }
    }
    
    return standalone;
  }
}

// Export to global scope
window.ImageBuilder = ImageBuilder;
console.log('[ImageBuilder] Builder loaded');

// Auto-register with ComponentRegistry when available
if (window.componentRegistry) {
  window.componentRegistry.registerBuilder(ImageBuilder);
  console.log('[ImageBuilder] Registered with ComponentRegistry');
} else {
  // Wait for component registry to be available
  document.addEventListener('DOMContentLoaded', () => {
    if (window.componentRegistry) {
      window.componentRegistry.registerBuilder(ImageBuilder);
      console.log('[ImageBuilder] Registered with ComponentRegistry (deferred)');
    }
  });
}
