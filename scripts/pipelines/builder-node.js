/**
 * BuilderNode - Specialized TransformerNode for RetroStudio builders
 * 
 * Wraps existing builders (TextureBuilder, SpriteBuilder, etc.) 
 * as pipeline nodes with proper input/output handling
 */

class BuilderNode extends TransformerNode {
  constructor(id, builderName, builderConfig = {}) {
    super(id);
    this.builderName = builderName;
    this.builderConfig = builderConfig;
    this.builder = null;
    this.initializeBuilder();
  }

  /**
   * Initialize the builder instance
   */
  initializeBuilder() {
    // Get builder from global window object
    if (typeof window !== 'undefined') {
      const BuilderClass = window[this.builderName];
      if (!BuilderClass) {
        console.error(`Builder not found: ${this.builderName}`);
        return;
      }
      this.builder = new BuilderClass();
    }
  }

  /**
   * Execute builder on input file
   */
  async execute(inputs, outputData) {
    try {
      // Get input file from input port
      const inputPort = this.getPort('builder-input') || 
                       this.ports.values().next().value;
      
      if (!inputPort) {
        throw new Error('No input port found');
      }

      const inputConnections = inputPort.connections;
      if (inputConnections.size === 0) {
        throw new Error('Input port not connected');
      }

      // Get data from connected output port
      const connection = inputConnections.values().next().value;
      const fromData = outputData.get(connection.fromNode.id);
      
      if (!fromData || !fromData.has(connection.fromPort.id)) {
        throw new Error('No data from input connection');
      }

      const inputFile = fromData.get(connection.fromPort.id);

      // Execute builder
      if (!this.builder) {
        throw new Error(`Builder ${this.builderName} not initialized`);
      }

      const result = await this.builder.build(inputFile);

      if (!result.success) {
        throw new Error(`Builder failed: ${result.error || 'Unknown error'}`);
      }

      // Map builder output to port outputs
      const portOutputs = new Map();

      // Builder returns outputPath as primary output
      if (result.outputPath) {
        const primaryPort = this.ports.values().next().value;
        if (primaryPort && primaryPort.direction === 'out') {
          portOutputs.set(primaryPort.id, {
            path: result.outputPath,
            data: result.data,
            meta: result.meta
          });
        }
      }

      // Multiple outputs (e.g., SpriteBuilder returns .d2s + .d2f)
      if (result.outputs && Array.isArray(result.outputs)) {
        const outputPorts = Array.from(this.ports.values())
          .filter(p => p.direction === 'out')
          .slice(1);  // Skip primary, use remaining

        for (let i = 0; i < result.outputs.length && i < outputPorts.length; i++) {
          portOutputs.set(outputPorts[i].id, {
            path: result.outputs[i],
            meta: result.meta
          });
        }
      }

      return portOutputs;
    } catch (error) {
      console.error(`BuilderNode ${this.id} error:`, error);
      throw error;
    }
  }

  /**
   * Validate builder is available
   */
  validate() {
    if (!this.builder) {
      return {
        valid: false,
        errors: [`Builder ${this.builderName} not initialized`]
      };
    }
    return super.validate();
  }

  /**
   * Get node description
   */
  getDescription() {
    return `${this.builderName} [${this.id}]`;
  }
}

// Export
if (typeof window !== 'undefined') {
  window.BuilderNode = BuilderNode;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BuilderNode };
}
