/**
 * Pipeline Registry System - Phase 2
 * 
 * Scope-based pipeline storage and auto-detection system
 * Manages built-in, project-wide, and file-specific pipelines
 * 
 * Usage:
 *   const registry = new PipelineRegistry();
 *   registry.registerBuiltInPipelines();
 *   const pipeline = registry.getPipelineForFile('example.texture');
 *   const graph = pipeline.toGraph();
 */

/**
 * Pipeline definition - describes a reusable DAG
 */
class PipelineDefinition {
  constructor(config) {
    this.id = config.id;                    // unique identifier
    this.name = config.name;                // display name
    this.description = config.description;  // what this pipeline does
    this.inputMimeType = config.inputMimeType;  // primary input MIME type
    this.outputMimeTypes = config.outputMimeTypes;  // array of output MIME types
    this.fileExtensions = config.fileExtensions || [];  // file extensions to match (.texture, .sprite, etc)
    this.nodes = config.nodes || [];        // array of node definitions
    this.connections = config.connections || [];  // array of connection definitions
    this.metadata = config.metadata || {};  // scope (built-in, project, file-specific), version, etc
  }

  /**
   * Convert pipeline definition to executable PipelineGraph
   */
  toGraph() {
    // In Node.js environment, classes may not be on global
    let PipelineGraphClass = global.PipelineGraph;
    
    if (!PipelineGraphClass) {
      throw new Error('PipelineGraph not available - load pipeline-graph.js first');
    }

    const graph = new PipelineGraphClass({
      name: this.name,
      description: this.description
    });
    const nodeMap = {};

    // Create all nodes
    if (!Array.isArray(this.nodes)) {
      throw new Error(`Pipeline nodes is not an array: ${typeof this.nodes}`);
    }
    
    for (let i = 0; i < this.nodes.length; i++) {
      const nodeDef = this.nodes[i];
      if (!nodeDef || typeof nodeDef !== 'object') {
        throw new Error(`Node ${i} is not an object: ${typeof nodeDef}`);
      }
      if (typeof nodeDef.id === 'undefined') {
        throw new Error(`Node ${i} definition missing id field`);
      }
      const node = this._createNode(nodeDef);
      if (node) {
        graph.addNode(node);
        nodeMap[nodeDef.id] = node;
      }
    }

    // Create connections using graph.connect() method
    for (const connDef of this.connections) {
      try {
        graph.connect(
          connDef.from.nodeId,
          connDef.from.portId,
          connDef.to.nodeId,
          connDef.to.portId,
          connDef.conditions || null
        );
      } catch (err) {
        // Log but don't fail - connection might reference undefined nodes in test context
        console.warn(`Failed to create connection: ${err.message}`);
      }
    }

    return graph;
  }

  /**
   * Create a node instance from definition
   */
  _createNode(nodeDef) {
    if (typeof nodeDef.id === 'undefined') {
      throw new Error(`Node definition missing required id field: ${JSON.stringify(nodeDef)}`);
    }
    
    const NodeClass = global[nodeDef.type];
    if (!NodeClass) {
      console.error(`Unknown node type: ${nodeDef.type}`);
      return null;
    }

    // Phase 1 node constructors expect a full definition object
    // Map class names to lowercase type names for internal use
    const typeMap = {
      'InputNode': 'input',
      'TransformerNode': 'transformer',
      'OutputNode': 'output',
      'FilterNode': 'filter',
      'MuxNode': 'mux'
    };

    // Create definition with correct type field
    const nodeDefWithType = {
      ...nodeDef,
      type: typeMap[nodeDef.type] || nodeDef.type.toLowerCase(),
      ports: nodeDef.ports || []
    };

    const node = new NodeClass(nodeDefWithType);

    // Apply builder config for TransformerNode
    if (nodeDef.type === 'TransformerNode' && nodeDef.builderName) {
      node.config.builderName = nodeDef.builderName;
      node.config.builderConfig = nodeDef.builderConfig || {};
    }

    return node;
  }
}

/**
 * Pipeline Registry - Manages pipelines across different scopes
 */
class PipelineRegistry {
  constructor() {
    // Scope-based storage:
    // - built-in: system pipelines, immutable
    // - project: project-specific pipelines from config
    // - fileSpecific: inline pipelines in .texture/.sprite files
    this.builtInPipelines = new Map();    // id → PipelineDefinition
    this.projectPipelines = new Map();    // id → PipelineDefinition
    this.fileSpecificPipelines = new Map();  // filePath → PipelineDefinition

    // File extension registry: maps extension to pipeline ID
    // Extensions checked in order: file-specific, project, built-in
    this.extensionRegistry = new Map();   // extension (.texture) → [pipeline IDs]
  }

  /**
   * Register built-in pipelines (texture, sprite, tilemap, frameset, font)
   */
  registerBuiltInPipelines() {
    // Texture Pipeline: .texture JSON → TextureBuilder → .d2
    this.registerBuiltInPipeline(this._createTexturePipeline());

    // Sprite Pipeline: .sprite JSON → SpriteBuilder → .d2s + .d2f
    this.registerBuiltInPipeline(this._createSpritePipeline());

    // Tilemap Pipeline: .tilemap JSON → TilemapBuilder → .d2m
    this.registerBuiltInPipeline(this._createTilemapPipeline());

    // Frameset Pipeline: .frameset JSON → FramesetBuilder → .d2fs
    this.registerBuiltInPipeline(this._createFramesetPipeline());

    // Font Pipeline: .font JSON → FontBuilder → .d2 + .fnt
    this.registerBuiltInPipeline(this._createFontPipeline());
  }

  /**
   * Register a built-in pipeline
   */
  registerBuiltInPipeline(pipelineDef) {
    pipelineDef.metadata.scope = 'built-in';
    this.builtInPipelines.set(pipelineDef.id, pipelineDef);

    // Register file extensions
    for (const ext of pipelineDef.fileExtensions) {
      if (!this.extensionRegistry.has(ext)) {
        this.extensionRegistry.set(ext, []);
      }
      this.extensionRegistry.get(ext).push(pipelineDef.id);
    }
  }

  /**
   * Register a project-wide pipeline
   */
  registerProjectPipeline(pipelineDef) {
    pipelineDef.metadata.scope = 'project';
    this.projectPipelines.set(pipelineDef.id, pipelineDef);

    for (const ext of pipelineDef.fileExtensions) {
      if (!this.extensionRegistry.has(ext)) {
        this.extensionRegistry.set(ext, []);
      }
      // Project pipelines take priority - add to front
      this.extensionRegistry.get(ext).unshift(pipelineDef.id);
    }
  }

  /**
   * Register a file-specific pipeline
   */
  registerFileSpecificPipeline(filePath, pipelineDef) {
    pipelineDef.metadata.scope = 'file-specific';
    pipelineDef.metadata.filePath = filePath;
    this.fileSpecificPipelines.set(filePath, pipelineDef);
  }

  /**
   * Get pipeline for a file by extension
   * Returns first matching pipeline in priority order:
   * 1. File-specific
   * 2. Project-wide
   * 3. Built-in
   */
  getPipelineForFile(filePath) {
    // Check file-specific first
    if (this.fileSpecificPipelines.has(filePath)) {
      return this.fileSpecificPipelines.get(filePath);
    }

    // Extract extension
    const ext = this._getFileExtension(filePath);
    if (!ext) {
      return null;
    }

    // Look up pipeline IDs for this extension
    const pipelineIds = this.extensionRegistry.get(ext);
    if (!pipelineIds || pipelineIds.length === 0) {
      return null;
    }

    // Return first available pipeline (project > built-in)
    for (const id of pipelineIds) {
      if (this.projectPipelines.has(id)) {
        return this.projectPipelines.get(id);
      }
      if (this.builtInPipelines.has(id)) {
        return this.builtInPipelines.get(id);
      }
    }

    return null;
  }

  /**
   * Get all pipelines for a file extension
   */
  getPipelinesForExtension(ext) {
    const pipelineIds = this.extensionRegistry.get(ext);
    if (!pipelineIds) {
      return [];
    }

    const pipelines = [];
    for (const id of pipelineIds) {
      if (this.projectPipelines.has(id)) {
        pipelines.push(this.projectPipelines.get(id));
      } else if (this.builtInPipelines.has(id)) {
        pipelines.push(this.builtInPipelines.get(id));
      }
    }
    return pipelines;
  }

  /**
   * Get a specific pipeline by ID
   */
  getPipelineById(id) {
    return this.builtInPipelines.get(id) ||
           this.projectPipelines.get(id);
  }

  /**
   * List all available pipelines
   */
  listPipelines() {
    const pipelines = [];
    
    for (const [id, def] of this.builtInPipelines) {
      pipelines.push({ id, ...def });
    }
    
    for (const [id, def] of this.projectPipelines) {
      pipelines.push({ id, ...def });
    }
    
    return pipelines;
  }

  /**
   * Extract file extension (with dot)
   */
  _getFileExtension(filePath) {
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot <= 0) {
      return null;
    }
    return filePath.substring(lastDot).toLowerCase();
  }

  // ===== Built-in Pipeline Definitions =====

  /**
   * Texture Pipeline: .texture → TextureBuilder → .d2
   */
  _createTexturePipeline() {
    return new PipelineDefinition({
      id: 'texture-default',
      name: 'Texture Pipeline',
      description: 'Converts texture metadata to GPU texture format (.d2)',
      inputMimeType: 'application/x-texture+json',
      outputMimeTypes: ['application/x-d2-gpu-texture'],
      fileExtensions: ['.texture'],

      nodes: [
        {
          id: 'texture-input',
          type: 'InputNode',
          ports: [
            {
              id: 'input-file',
              name: 'Texture File',
              direction: 'out',
              mimeType: 'application/x-texture+json',
              required: true
            }
          ]
        },
        {
          id: 'texture-builder',
          type: 'TransformerNode',
          builderName: 'TextureBuilder',
          ports: [
            {
              id: 'builder-input',
              name: 'Texture Metadata',
              direction: 'in',
              mimeType: 'application/x-texture+json',
              required: true
            },
            {
              id: 'builder-output',
              name: 'GPU Texture',
              direction: 'out',
              mimeType: 'application/x-d2-gpu-texture',
              required: true
            }
          ]
        },
        {
          id: 'texture-output',
          type: 'OutputNode',
          ports: [
            {
              id: 'output-file',
              name: 'Texture Output',
              direction: 'in',
              mimeType: 'application/x-d2-gpu-texture',
              required: true
            }
          ]
        }
      ],

      connections: [
        {
          from: { nodeId: 'texture-input', portId: 'input-file' },
          to: { nodeId: 'texture-builder', portId: 'builder-input' }
        },
        {
          from: { nodeId: 'texture-builder', portId: 'builder-output' },
          to: { nodeId: 'texture-output', portId: 'output-file' }
        }
      ],

      metadata: { version: '1.0' }
    });
  }

  /**
   * Sprite Pipeline: .sprite → SpriteBuilder → .d2s + .d2f
   */
  _createSpritePipeline() {
    return new PipelineDefinition({
      id: 'sprite-default',
      name: 'Sprite Pipeline',
      description: 'Converts sprite metadata to sprite binary format (.d2s + .d2f)',
      inputMimeType: 'application/x-sprite+json',
      outputMimeTypes: [
        'application/x-d2-sprite',
        'application/x-d2-frameatlas'
      ],
      fileExtensions: ['.sprite'],

      nodes: [
        {
          id: 'sprite-input',
          type: 'InputNode',
          ports: [
            {
              id: 'input-file',
              name: 'Sprite File',
              direction: 'out',
              mimeType: 'application/x-sprite+json',
              required: true
            }
          ]
        },
        {
          id: 'sprite-builder',
          type: 'TransformerNode',
          builderName: 'SpriteBuilder',
          ports: [
            {
              id: 'builder-input',
              name: 'Sprite Metadata',
              direction: 'in',
              mimeType: 'application/x-sprite+json',
              required: true
            },
            {
              id: 'builder-output-sprite',
              name: 'Sprite Binary',
              direction: 'out',
              mimeType: 'application/x-d2-sprite',
              required: true
            },
            {
              id: 'builder-output-atlas',
              name: 'Frame Atlas',
              direction: 'out',
              mimeType: 'application/x-d2-frameatlas',
              required: true
            }
          ]
        },
        {
          id: 'sprite-output',
          type: 'OutputNode',
          ports: [
            {
              id: 'output-sprite',
              name: 'Sprite Output',
              direction: 'in',
              mimeType: 'application/x-d2-sprite',
              required: true
            }
          ]
        },
        {
          id: 'atlas-output',
          type: 'OutputNode',
          ports: [
            {
              id: 'output-atlas',
              name: 'Atlas Output',
              direction: 'in',
              mimeType: 'application/x-d2-frameatlas',
              required: true
            }
          ]
        }
      ],

      connections: [
        {
          from: { nodeId: 'sprite-input', portId: 'input-file' },
          to: { nodeId: 'sprite-builder', portId: 'builder-input' }
        },
        {
          from: { nodeId: 'sprite-builder', portId: 'builder-output-sprite' },
          to: { nodeId: 'sprite-output', portId: 'output-sprite' }
        },
        {
          from: { nodeId: 'sprite-builder', portId: 'builder-output-atlas' },
          to: { nodeId: 'atlas-output', portId: 'output-atlas' }
        }
      ],

      metadata: { version: '1.0' }
    });
  }

  /**
   * Tilemap Pipeline: .tilemap → TilemapBuilder → .d2m
   */
  _createTilemapPipeline() {
    return new PipelineDefinition({
      id: 'tilemap-default',
      name: 'Tilemap Pipeline',
      description: 'Converts tilemap data to compact binary format (.d2m)',
      inputMimeType: 'application/x-tilemap+json',
      outputMimeTypes: ['application/x-d2-tilemap'],
      fileExtensions: ['.tilemap', '.tmj'],

      nodes: [
        {
          id: 'tilemap-input',
          type: 'InputNode',
          ports: [
            {
              id: 'input-file',
              name: 'Tilemap File',
              direction: 'out',
              mimeType: 'application/x-tilemap+json',
              required: true
            }
          ]
        },
        {
          id: 'tilemap-builder',
          type: 'TransformerNode',
          builderName: 'TilemapBuilder',
          ports: [
            {
              id: 'builder-input',
              name: 'Tilemap Metadata',
              direction: 'in',
              mimeType: 'application/x-tilemap+json',
              required: true
            },
            {
              id: 'builder-output',
              name: 'Tilemap Binary',
              direction: 'out',
              mimeType: 'application/x-d2-tilemap',
              required: true
            }
          ]
        },
        {
          id: 'tilemap-output',
          type: 'OutputNode',
          ports: [
            {
              id: 'output-file',
              name: 'Tilemap Output',
              direction: 'in',
              mimeType: 'application/x-d2-tilemap',
              required: true
            }
          ]
        }
      ],

      connections: [
        {
          from: { nodeId: 'tilemap-input', portId: 'input-file' },
          to: { nodeId: 'tilemap-builder', portId: 'builder-input' }
        },
        {
          from: { nodeId: 'tilemap-builder', portId: 'builder-output' },
          to: { nodeId: 'tilemap-output', portId: 'output-file' }
        }
      ],

      metadata: { version: '1.0' }
    });
  }

  /**
   * Frameset Pipeline: .frameset → FramesetBuilder → .d2fs
   */
  _createFramesetPipeline() {
    return new PipelineDefinition({
      id: 'frameset-default',
      name: 'Frameset Pipeline',
      description: 'Converts frame metadata to compact binary format (.d2fs)',
      inputMimeType: 'application/x-frameset+json',
      outputMimeTypes: ['application/x-d2-frameset'],
      fileExtensions: ['.frameset'],

      nodes: [
        {
          id: 'frameset-input',
          type: 'InputNode',
          ports: [
            {
              id: 'input-file',
              name: 'Frameset File',
              direction: 'out',
              mimeType: 'application/x-frameset+json',
              required: true
            }
          ]
        },
        {
          id: 'frameset-builder',
          type: 'TransformerNode',
          builderName: 'FramesetBuilder',
          ports: [
            {
              id: 'builder-input',
              name: 'Frameset Metadata',
              direction: 'in',
              mimeType: 'application/x-frameset+json',
              required: true
            },
            {
              id: 'builder-output',
              name: 'Frameset Binary',
              direction: 'out',
              mimeType: 'application/x-d2-frameset',
              required: true
            }
          ]
        },
        {
          id: 'frameset-output',
          type: 'OutputNode',
          ports: [
            {
              id: 'output-file',
              name: 'Frameset Output',
              direction: 'in',
              mimeType: 'application/x-d2-frameset',
              required: true
            }
          ]
        }
      ],

      connections: [
        {
          from: { nodeId: 'frameset-input', portId: 'input-file' },
          to: { nodeId: 'frameset-builder', portId: 'builder-input' }
        },
        {
          from: { nodeId: 'frameset-builder', portId: 'builder-output' },
          to: { nodeId: 'frameset-output', portId: 'output-file' }
        }
      ],

      metadata: { version: '1.0' }
    });
  }

  /**
   * Font Pipeline: .font → FontBuilder → .d2 + .fnt
   */
  _createFontPipeline() {
    return new PipelineDefinition({
      id: 'font-default',
      name: 'Font Pipeline',
      description: 'Converts font metadata to GPU texture and metrics (.d2 + .fnt)',
      inputMimeType: 'application/x-font+json',
      outputMimeTypes: [
        'application/x-d2-gpu-texture',
        'application/x-d2-font-metrics'
      ],
      fileExtensions: ['.font'],

      nodes: [
        {
          id: 'font-input',
          type: 'InputNode',
          ports: [
            {
              id: 'input-file',
              name: 'Font File',
              direction: 'out',
              mimeType: 'application/x-font+json',
              required: true
            }
          ]
        },
        {
          id: 'font-builder',
          type: 'TransformerNode',
          builderName: 'FontBuilder',
          ports: [
            {
              id: 'builder-input',
              name: 'Font Metadata',
              direction: 'in',
              mimeType: 'application/x-font+json',
              required: true
            },
            {
              id: 'builder-output-texture',
              name: 'Font Texture',
              direction: 'out',
              mimeType: 'application/x-d2-gpu-texture',
              required: true
            },
            {
              id: 'builder-output-metrics',
              name: 'Font Metrics',
              direction: 'out',
              mimeType: 'application/x-d2-font-metrics',
              required: false
            }
          ]
        },
        {
          id: 'font-texture-output',
          type: 'OutputNode',
          ports: [
            {
              id: 'output-texture',
              name: 'Texture Output',
              direction: 'in',
              mimeType: 'application/x-d2-gpu-texture',
              required: true
            }
          ]
        },
        {
          id: 'font-metrics-output',
          type: 'OutputNode',
          ports: [
            {
              id: 'output-metrics',
              name: 'Metrics Output',
              direction: 'in',
              mimeType: 'application/x-d2-font-metrics',
              required: false
            }
          ]
        }
      ],

      connections: [
        {
          from: { nodeId: 'font-input', portId: 'input-file' },
          to: { nodeId: 'font-builder', portId: 'builder-input' }
        },
        {
          from: { nodeId: 'font-builder', portId: 'builder-output-texture' },
          to: { nodeId: 'font-texture-output', portId: 'output-texture' }
        },
        {
          from: { nodeId: 'font-builder', portId: 'builder-output-metrics' },
          to: { nodeId: 'font-metrics-output', portId: 'output-metrics' }
        }
      ],

      metadata: { version: '1.0' }
    });
  }
}

// Export to window and module.exports
if (typeof window !== 'undefined') {
  window.PipelineDefinition = PipelineDefinition;
  window.PipelineRegistry = PipelineRegistry;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PipelineDefinition, PipelineRegistry };
}
