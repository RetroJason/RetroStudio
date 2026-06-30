/**
 * pipeline-node.js
 * 
 * Node classes and port system for the DAG-based graphics pipeline.
 * Defines the basic building blocks: ports (data connections), nodes (processors),
 * and connections (edges between ports).
 */

/**
 * @typedef {Object} PortDefinition
 * @property {string} id - Unique identifier within node (e.g., 'input', 'output')
 * @property {string} name - Display name
 * @property {'in' | 'out'} direction - Input or output
 * @property {string} [mimeType] - Optional MIME type constraint (e.g., 'image/png')
 * @property {boolean} [required=true] - Whether this input port requires a connection
 * @property {string} [description] - Human-readable description
 */

/**
 * Port represents a data connection point on a node.
 * Ports can be connected to other ports via Connections.
 */
class Port {
  constructor(definition) {
    this.id = definition.id;
    this.name = definition.name;
    this.direction = definition.direction; // 'in' or 'out'
    this.mimeType = definition.mimeType || null;
    this.required = definition.required !== false;
    this.description = definition.description || '';
    this.connections = new Set(); // Set of Connection objects
  }

  /**
   * @param {Connection} connection
   */
  addConnection(connection) {
    this.connections.add(connection);
  }

  /**
   * @param {Connection} connection
   */
  removeConnection(connection) {
    this.connections.delete(connection);
  }

  /**
   * Check if this port can connect to another port
   * @param {Port} otherPort
   * @returns {boolean}
   */
  canConnectTo(otherPort) {
    // Direction check: in connects to out, out connects to in
    if (this.direction === otherPort.direction) return false;
    
    // Type check: if both have mimeType, they must match
    if (this.mimeType && otherPort.mimeType && this.mimeType !== otherPort.mimeType) {
      return false;
    }
    
    return true;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      direction: this.direction,
      mimeType: this.mimeType,
      required: this.required,
      description: this.description,
      connectionCount: this.connections.size,
    };
  }
}

/**
 * Connection represents a directed edge between two ports.
 */
class Connection {
  constructor(definition) {
    this.id = definition.id;
    this.fromNode = definition.fromNode;    // Node ID
    this.fromPort = definition.fromPort;    // Port ID
    this.toNode = definition.toNode;        // Node ID
    this.toPort = definition.toPort;        // Port ID
    
    // Optional routing logic
    this.conditions = definition.conditions || null;
  }

  /**
   * Apply connection filter/transform to data
   * @param {*} data
   * @returns {*} Transformed data or null if filtered out
   */
  transform(data) {
    if (!this.conditions) return data;
    
    if (this.conditions.filter && !this.conditions.filter(data)) {
      return null; // Filtered out
    }
    
    if (this.conditions.transform) {
      return this.conditions.transform(data);
    }
    
    return data;
  }

  toJSON() {
    return {
      id: this.id,
      from: `${this.fromNode}:${this.fromPort}`,
      to: `${this.toNode}:${this.toPort}`,
      hasConditions: !!this.conditions,
    };
  }
}

/**
 * Base class for all pipeline nodes.
 * Subclasses must implement execute().
 */
class PipelineNode {
  constructor(definition) {
    this.id = definition.id;
    this.type = definition.type; // 'input', 'transformer', 'output', 'filter', 'mux'
    this.label = definition.label || definition.id;
    this.config = definition.config || {};
    
    // Canvas position for visualization
    this.position = definition.position || { x: 0, y: 0 };
    
    // Ports
    this.inputs = new Map();  // id -> Port
    this.outputs = new Map(); // id -> Port
    
    // Initialize ports from definition
    if (definition.ports) {
      for (const portDef of definition.ports) {
        const port = new Port(portDef);
        if (portDef.direction === 'in') {
          this.inputs.set(port.id, port);
        } else {
          this.outputs.set(port.id, port);
        }
      }
    }
  }

  /**
   * Add a port to this node
   * @param {PortDefinition} definition
   * @returns {Port}
   */
  addPort(definition) {
    const port = new Port(definition);
    if (definition.direction === 'in') {
      this.inputs.set(port.id, port);
    } else {
      this.outputs.set(port.id, port);
    }
    return port;
  }

  /**
   * Get a port by ID
   * @param {string} portId
   * @returns {Port | null}
   */
  getPort(portId) {
    return this.inputs.get(portId) || this.outputs.get(portId) || null;
  }

  /**
   * Execute this node with given inputs.
   * Subclasses must implement this.
   * 
   * @param {Map<string, *>} inputData - Map of port IDs to data
   * @returns {Promise<Map<string, *>>} - Map of output port IDs to data
   */
  async execute(inputData) {
    throw new Error(`${this.constructor.name}.execute() not implemented`);
  }

  /**
   * Validate that this node is properly configured.
   * @returns {string[]} - Array of error messages, empty if valid
   */
  validate() {
    const errors = [];
    
    // Check required inputs
    for (const [portId, port] of this.inputs) {
      if (port.required && port.connections.size === 0) {
        errors.push(`Required input port "${port.name}" has no connections`);
      }
    }
    
    return errors;
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      label: this.label,
      config: this.config,
      position: this.position,
      ports: {
        inputs: Array.from(this.inputs.values()).map(p => p.toJSON()),
        outputs: Array.from(this.outputs.values()).map(p => p.toJSON()),
      },
    };
  }
}

/**
 * InputNode loads files from filesystem
 */
class InputNode extends PipelineNode {
  constructor(definition) {
    super(definition);
    this.type = 'input';
    
    // Add default output port if not provided
    if (this.outputs.size === 0) {
      this.addPort({
        id: 'file',
        name: 'File',
        direction: 'out',
        description: 'Loaded file content',
      });
    }
  }

  async execute(inputData) {
    const filePath = this.config.filePath || this.config.path;
    if (!filePath) {
      throw new Error(`InputNode "${this.id}" has no filePath configured`);
    }

    // Use global FileIOService if available
    if (typeof window !== 'undefined' && window.fileIOService) {
      const file = await window.fileIOService.loadFile(filePath);
      return new Map([['file', file]]);
    }

    // In tests or Node.js, would need to mock or use file system
    throw new Error(`InputNode requires window.fileIOService to load files`);
  }
}

/**
 * TransformerNode wraps existing builders
 */
class TransformerNode extends PipelineNode {
  constructor(definition) {
    super(definition);
    this.type = 'transformer';
    this.builder = null;
    
    // Add default ports if not provided
    if (this.inputs.size === 0) {
      this.addPort({
        id: 'input',
        name: 'Input',
        direction: 'in',
        description: 'Input file or data',
      });
    }
    if (this.outputs.size === 0) {
      this.addPort({
        id: 'output',
        name: 'Output',
        direction: 'out',
        description: 'Transformed output',
      });
    }
  }

  /**
   * Set the builder for this transformer
   * @param {BaseBuilder} builder
   */
  setBuilder(builder) {
    this.builder = builder;
  }

  async execute(inputData) {
    if (!this.builder) {
      throw new Error(`TransformerNode "${this.id}" has no builder configured`);
    }

    const inputPort = Array.from(this.inputs.keys())[0];
    const input = inputData.get(inputPort);

    if (!input) {
      throw new Error(`TransformerNode "${this.id}" missing input on port "${inputPort}"`);
    }

    // Call builder's build method
    const result = await this.builder.build(input);

    // Map to first output port
    const outputPort = Array.from(this.outputs.keys())[0];
    return new Map([[outputPort, result]]);
  }
}

/**
 * OutputNode saves results to filesystem
 */
class OutputNode extends PipelineNode {
  constructor(definition) {
    super(definition);
    this.type = 'output';
    
    // Add default input port if not provided
    if (this.inputs.size === 0) {
      this.addPort({
        id: 'input',
        name: 'Input',
        direction: 'in',
        required: true,
        description: 'Data to save',
      });
    }
    
    // Add default output port (metadata about save)
    if (this.outputs.size === 0) {
      this.addPort({
        id: 'saved',
        name: 'Saved',
        direction: 'out',
        description: 'Metadata about saved file',
      });
    }
  }

  async execute(inputData) {
    const inputPort = Array.from(this.inputs.keys())[0];
    const data = inputData.get(inputPort);

    if (!data) {
      throw new Error(`OutputNode "${this.id}" missing input on port "${inputPort}"`);
    }

    const outputPath = this.config.outputPath;
    if (!outputPath) {
      throw new Error(`OutputNode "${this.id}" has no outputPath configured`);
    }

    // Use global FileIOService if available
    if (typeof window !== 'undefined' && window.fileIOService) {
      await window.fileIOService.saveFile(outputPath, data, this.config.metadata || {});
      
      return new Map([['saved', {
        path: outputPath,
        size: data.length || 0,
        savedAt: new Date().toISOString(),
      }]]);
    }

    throw new Error(`OutputNode requires window.fileIOService to save files`);
  }
}

/**
 * FilterNode conditionally passes data based on a predicate
 */
class FilterNode extends PipelineNode {
  constructor(definition) {
    super(definition);
    this.type = 'filter';
    
    if (this.inputs.size === 0) {
      this.addPort({
        id: 'input',
        name: 'Input',
        direction: 'in',
        description: 'Data to filter',
      });
    }
    
    if (this.outputs.size === 0) {
      this.addPort({
        id: 'pass',
        name: 'Pass',
        direction: 'out',
        description: 'Data that passed the filter',
      });
      this.addPort({
        id: 'reject',
        name: 'Reject',
        direction: 'out',
        description: 'Data that failed the filter',
      });
    }
  }

  async execute(inputData) {
    const inputPort = Array.from(this.inputs.keys())[0];
    const input = inputData.get(inputPort);

    const predicate = this.config.predicate;
    if (!predicate) {
      throw new Error(`FilterNode "${this.id}" has no predicate configured`);
    }

    const passed = predicate(input);
    
    return new Map([
      ['pass', passed ? input : null],
      ['reject', !passed ? input : null],
    ]);
  }
}

/**
 * MuxNode combines multiple inputs into a single output
 */
class MuxNode extends PipelineNode {
  constructor(definition) {
    super(definition);
    this.type = 'mux';
    
    if (this.outputs.size === 0) {
      this.addPort({
        id: 'combined',
        name: 'Combined',
        direction: 'out',
        description: 'Combined data from all inputs',
      });
    }
  }

  async execute(inputData) {
    const combined = {};
    
    for (const [portId, data] of inputData) {
      combined[portId] = data;
    }
    
    return new Map([['combined', combined]]);
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    Port,
    Connection,
    PipelineNode,
    InputNode,
    TransformerNode,
    OutputNode,
    FilterNode,
    MuxNode,
  };
}

// Also export to window if in browser
if (typeof window !== 'undefined') {
  window.PipelineNode = PipelineNode;
  window.InputNode = InputNode;
  window.TransformerNode = TransformerNode;
  window.OutputNode = OutputNode;
  window.FilterNode = FilterNode;
  window.MuxNode = MuxNode;
  window.Port = Port;
  window.Connection = Connection;
}
