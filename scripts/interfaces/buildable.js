// buildable.js
// Interface for resources that can be built (source → output)

class BuildableInterface {
  /**
   * Build the source file into its output format
   * @returns {Promise<{success: boolean, outputPath?: string, error?: string}>}
   */
  async build() {
    throw new Error('build() method must be implemented by buildable classes');
  }
  
  /**
   * Get the expected output path for this buildable resource
   * @returns {string} The path where the built output should be saved
   */
  getOutputPath() {
    throw new Error('getOutputPath() method must be implemented by buildable classes');
  }
  
  /**
   * Check if the resource needs to be rebuilt (source newer than output)
   * @returns {boolean} True if build is needed
   */
  needsBuild() {
    // Default implementation - always assume build is needed
    // Override in specific implementations for more sophisticated checks
    return true;
  }
  
  /**
   * Get build status information
   * @returns {{status: string, lastBuild?: Date, outputExists: boolean}}
   */
  getBuildStatus() {
    return {
      status: this.needsBuild() ? 'needs-build' : 'up-to-date',
      outputExists: false // Override in implementations
    };
  }
}

// Mixin helper to add buildable functionality to a class
function makeBuildable(BaseClass) {
  return class extends BaseClass {
    constructor(...args) {
      super(...args);
      this.buildable = true;
    }
    
    // Default implementations that can be overridden
    async build() {
      throw new Error(`${this.constructor.name} must implement build() method`);
    }
    
    getOutputPath() {
      throw new Error(`${this.constructor.name} must implement getOutputPath() method`);
    }
    
    needsBuild() {
      return true;
    }
    
    getBuildStatus() {
      return {
        status: this.needsBuild() ? 'needs-build' : 'up-to-date',
        outputExists: false
      };
    }
  };
}

// Export for use
window.BuildableInterface = BuildableInterface;
window.makeBuildable = makeBuildable;
