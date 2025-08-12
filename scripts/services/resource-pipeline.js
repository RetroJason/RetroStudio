// resource-pipeline.js
// System for defining and managing resource transformation pipelines

class ResourcePipeline {
  constructor() {
    this.pipelines = new Map(); // editorType -> pipeline definition
    this.processors = new Map(); // processorType -> processor function
    
    this.registerDefaultProcessors();
    console.log('[ResourcePipeline] Initialized');
  }
  
  // Register a pipeline for a specific editor type
  registerPipeline(editorType, pipelineDefinition) {
    this.pipelines.set(editorType, pipelineDefinition);
    console.log(`[ResourcePipeline] Registered pipeline for ${editorType}`);
  }
  
  // Register a processor function
  registerProcessor(processorType, processorFunction) {
    this.processors.set(processorType, processorFunction);
    console.log(`[ResourcePipeline] Registered processor: ${processorType}`);
  }
  
  // Get pipeline definition for an editor type
  getPipeline(editorType) {
    return this.pipelines.get(editorType);
  }
  
  // Execute a pipeline for a specific resource
  async executePipeline(editorType, sourceData, context = {}) {
    const pipeline = this.getPipeline(editorType);
    if (!pipeline) {
      throw new Error(`No pipeline defined for editor type: ${editorType}`);
    }
    
    console.log(`[ResourcePipeline] Executing pipeline for ${editorType}`);
    
    const results = {};
    
    // Process each output defined in the pipeline
    for (const [outputName, outputDef] of Object.entries(pipeline.outputs)) {
      try {
        console.log(`[ResourcePipeline] Processing output: ${outputName}`);
        
        // Execute the processing chain
        let data = sourceData;
        for (const step of outputDef.steps) {
          const processor = this.processors.get(step.processor);
          if (!processor) {
            throw new Error(`Unknown processor: ${step.processor}`);
          }
          
          data = await processor(data, step.params || {}, context);
        }
        
        results[outputName] = {
          data: data,
          contentType: outputDef.contentType || 'application/octet-stream',
          extension: outputDef.extension
        };
        
      } catch (error) {
        console.error(`[ResourcePipeline] Failed to process ${outputName}:`, error);
        throw error;
      }
    }
    
    return results;
  }
  
  // Register default processors
  registerDefaultProcessors() {
    // JSON validator/formatter
    this.registerProcessor('json-validate', async (data, params) => {
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        return JSON.stringify(parsed, null, params.indent || 2);
      } catch (error) {
        throw new Error(`Invalid JSON: ${error.message}`);
      }
    });
    
    // Text encoding
    this.registerProcessor('text-encode', async (data, params) => {
      const encoding = params.encoding || 'utf-8';
      if (typeof data === 'string') {
        return new TextEncoder().encode(data);
      }
      return data;
    });
    
    // Audio synthesis placeholder (will be implemented for sound FX)
    this.registerProcessor('audio-synthesize', async (data, params, context) => {
      // This will be implemented when we create the sound FX editor
      console.log('[ResourcePipeline] Audio synthesis not yet implemented');
      return new ArrayBuffer(1024); // Placeholder
    });
    
    // Validation processor
    this.registerProcessor('validate', async (data, params) => {
      if (params.schema) {
        // Could integrate with a JSON schema validator
        console.log('[ResourcePipeline] Schema validation not yet implemented');
      }
      return data;
    });
  }
  
  // Define a simple pipeline format
  static createPipelineDefinition(inputs, outputs, metadata = {}) {
    return {
      metadata: {
        name: metadata.name || 'Unnamed Pipeline',
        description: metadata.description || '',
        version: metadata.version || '1.0'
      },
      inputs: inputs,
      outputs: outputs
    };
  }
  
  // Helper to create processing steps
  static createStep(processor, params = {}) {
    return { processor, params };
  }
}

// Example pipeline definitions
class PipelineDefinitions {
  static get SOUND_FX() {
    return ResourcePipeline.createPipelineDefinition(
      // Inputs
      {
        settings: { 
          role: 'source', 
          extension: '.sfx', 
          contentType: 'application/json',
          editable: true,
          description: 'Sound effect parameters and settings'
        }
      },
      // Outputs  
      {
        audio: {
          extension: '.wav',
          contentType: 'audio/wav',
          editable: false,
          generated: true,
          description: 'Generated audio file',
          steps: [
            ResourcePipeline.createStep('json-validate'),
            ResourcePipeline.createStep('audio-synthesize', { 
              format: 'wav',
              sampleRate: 44100,
              bitDepth: 16
            })
          ]
        }
      },
      {
        name: 'Sound FX Generator',
        description: 'Generates audio files from sound effect parameters'
      }
    );
  }
  
  static get SHADER() {
    return ResourcePipeline.createPipelineDefinition(
      // Inputs
      {
        source: {
          role: 'source',
          extension: '.glsl',
          contentType: 'text/plain',
          editable: true,
          description: 'GLSL shader source code'
        }
      },
      // Outputs
      {
        compiled: {
          extension: '.spv',
          contentType: 'application/octet-stream',
          editable: false,
          generated: true,
          description: 'Compiled shader bytecode',
          steps: [
            ResourcePipeline.createStep('glsl-compile', { target: 'vulkan' })
          ]
        },
        metadata: {
          extension: '.json',
          contentType: 'application/json',
          editable: false,
          generated: true,
          description: 'Shader metadata and reflection info',
          steps: [
            ResourcePipeline.createStep('glsl-reflect'),
            ResourcePipeline.createStep('json-validate', { indent: 2 })
          ]
        }
      },
      {
        name: 'Shader Compiler',
        description: 'Compiles GLSL shaders and extracts metadata'
      }
    );
  }
}

// Create global instance
window.resourcePipeline = new ResourcePipeline();

// Register example pipelines
window.resourcePipeline.registerPipeline('sound-fx', PipelineDefinitions.SOUND_FX);
window.resourcePipeline.registerPipeline('shader', PipelineDefinitions.SHADER);

// Export for use
window.ResourcePipeline = ResourcePipeline;
window.PipelineDefinitions = PipelineDefinitions;
