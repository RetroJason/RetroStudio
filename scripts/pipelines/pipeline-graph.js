/**
 * pipeline-graph.js
 * 
 * Graph manager for DAG-based graphics pipeline.
 * Handles node/connection management, validation, topological sorting, and execution.
 */

/**
 * @typedef {Object} ValidationError
 * @property {string} nodeId - Node with error
 * @property {string} message - Error description
 * @property {'cycle' | 'missing_input' | 'type_mismatch' | 'config'} type - Error type
 */

/**
 * PipelineGraph manages the DAG structure and execution
 */
class PipelineGraph {
  constructor(definition = {}) {
    this.name = definition.name || 'Unnamed Pipeline';
    this.description = definition.description || '';
    this.version = definition.version || 2;
    
    this.nodes = new Map();      // id -> PipelineNode
    this.connections = new Set(); // Set<Connection>
    
    // Execution state
    this.isExecuting = false;
    this.lastExecutionTime = null;
    this.lastExecutionError = null;
  }

  /**
   * Add a node to the graph
   * @param {PipelineNode} node
   */
  addNode(node) {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node with id "${node.id}" already exists`);
    }
    this.nodes.set(node.id, node);
  }

  /**
   * Remove a node and all its connections
   * @param {string} nodeId
   */
  removeNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node "${nodeId}" not found`);

    // Remove all connections to/from this node
    const connectionsToRemove = Array.from(this.connections).filter(
      conn => conn.fromNode === nodeId || conn.toNode === nodeId
    );
    
    for (const conn of connectionsToRemove) {
      this.disconnect(conn.id);
    }

    this.nodes.delete(nodeId);
  }

  /**
   * Get a node by ID
   * @param {string} nodeId
   * @returns {PipelineNode | null}
   */
  getNode(nodeId) {
    return this.nodes.get(nodeId) || null;
  }

  /**
   * Connect two ports
   * @param {string} fromNodeId
   * @param {string} fromPortId
   * @param {string} toNodeId
   * @param {string} toPortId
   * @param {Object} [conditions] - Optional filter/transform conditions
   * @returns {Connection}
   */
  connect(fromNodeId, fromPortId, toNodeId, toPortId, conditions = null) {
    const fromNode = this.getNode(fromNodeId);
    const toNode = this.getNode(toNodeId);

    if (!fromNode) throw new Error(`Node "${fromNodeId}" not found`);
    if (!toNode) throw new Error(`Node "${toNodeId}" not found`);

    const fromPort = fromNode.getPort(fromPortId);
    const toPort = toNode.getPort(toPortId);

    if (!fromPort) throw new Error(`Port "${fromPortId}" not found on node "${fromNodeId}"`);
    if (!toPort) throw new Error(`Port "${toPortId}" not found on node "${toNodeId}"`);

    if (!fromPort.canConnectTo(toPort)) {
      throw new Error(`Cannot connect ${fromPortId} (${fromPort.direction}) to ${toPortId} (${toPort.direction})`);
    }

    const Connection = window.Connection || require('./pipeline-node.js').Connection;
    const conn = new Connection({
      id: `${fromNodeId}:${fromPortId}→${toNodeId}:${toPortId}`,
      fromNode: fromNodeId,
      fromPort: fromPortId,
      toNode: toNodeId,
      toPort: toPortId,
      conditions,
    });

    fromPort.addConnection(conn);
    toPort.addConnection(conn);
    this.connections.add(conn);

    return conn;
  }

  /**
   * Remove a connection
   * @param {string} connectionId
   */
  disconnect(connectionId) {
    const conn = Array.from(this.connections).find(c => c.id === connectionId);
    if (!conn) throw new Error(`Connection "${connectionId}" not found`);

    const fromNode = this.getNode(conn.fromNode);
    const toNode = this.getNode(conn.toNode);

    if (fromNode) {
      const fromPort = fromNode.getPort(conn.fromPort);
      if (fromPort) fromPort.removeConnection(conn);
    }

    if (toNode) {
      const toPort = toNode.getPort(conn.toPort);
      if (toPort) toPort.removeConnection(conn);
    }

    this.connections.delete(conn);
  }

  /**
   * Validate the entire graph
   * @returns {ValidationError[]}
   */
  validate() {
    const errors = [];

    // Check for cycles (DFS from each node)
    const visited = new Set();
    const recStack = new Set();

    const hasCycle = (nodeId) => {
      visited.add(nodeId);
      recStack.add(nodeId);

      const node = this.getNode(nodeId);
      const dependents = this.getDependents(nodeId);

      for (const dependent of dependents) {
        if (!visited.has(dependent)) {
          if (hasCycle(dependent)) return true;
        } else if (recStack.has(dependent)) {
          return true; // Back edge found
        }
      }

      recStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (hasCycle(nodeId)) {
          errors.push({
            nodeId,
            message: 'Cycle detected in pipeline',
            type: 'cycle',
          });
        }
      }
    }

    // Check each node's validation
    for (const [nodeId, node] of this.nodes) {
      const nodeErrors = node.validate();
      for (const error of nodeErrors) {
        errors.push({
          nodeId,
          message: error,
          type: 'missing_input',
        });
      }
    }

    return errors;
  }

  /**
   * Get execution order using topological sort
   * @returns {string[]} - Node IDs in execution order
   */
  getTopologicalOrder() {
    const visited = new Set();
    const order = [];

    const visit = (nodeId) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      // Visit all nodes that feed into this one first
      const dependencies = this.getInputs(nodeId);
      for (const dep of dependencies) {
        visit(dep);
      }

      order.push(nodeId);
    };

    // Start from nodes with no inputs (sources)
    for (const nodeId of this.nodes.keys()) {
      if (this.getInputs(nodeId).length === 0) {
        visit(nodeId);
      }
    }

    // Visit any remaining nodes (handles disconnected components)
    for (const nodeId of this.nodes.keys()) {
      visit(nodeId);
    }

    return order;
  }

  /**
   * Get all nodes that this node depends on (predecessors)
   * @param {string} nodeId
   * @returns {string[]}
   */
  getInputs(nodeId) {
    const inputs = new Set();
    const conns = Array.from(this.connections).filter(c => c.toNode === nodeId);
    
    for (const conn of conns) {
      inputs.add(conn.fromNode);
    }

    return Array.from(inputs);
  }

  /**
   * Get all nodes that depend on this node (successors)
   * @param {string} nodeId
   * @returns {string[]}
   */
  getDependents(nodeId) {
    const dependents = new Set();
    const conns = Array.from(this.connections).filter(c => c.fromNode === nodeId);
    
    for (const conn of conns) {
      dependents.add(conn.toNode);
    }

    return Array.from(dependents);
  }

  /**
   * Get connections from a specific output port
   * @param {string} nodeId
   * @param {string} portId
   * @returns {Connection[]}
   */
  getConnectionsFromPort(nodeId, portId) {
    return Array.from(this.connections).filter(
      c => c.fromNode === nodeId && c.fromPort === portId
    );
  }

  /**
   * Execute the entire pipeline
   * @param {Map<string, *>} inputs - Node ID -> input data
   * @returns {Promise<Map<string, *>>} - Node ID -> output data
   */
  async execute(inputs = new Map()) {
    const startTime = performance.now();
    this.isExecuting = true;
    this.lastExecutionError = null;

    try {
      // Validate before execution
      const validationErrors = this.validate();
      if (validationErrors.length > 0) {
        throw new Error(`Pipeline validation failed:\n${validationErrors.map(e => `${e.nodeId}: ${e.message}`).join('\n')}`);
      }

      // Get execution order
      const order = this.getTopologicalOrder();
      
      // Store execution results: nodeId -> Map<portId, data>
      const results = new Map();

      // Initialize with provided inputs
      for (const [nodeId, data] of inputs) {
        results.set(nodeId, new Map([['input', data]]));
      }

      // Execute nodes in topological order
      for (const nodeId of order) {
        const node = this.getNode(nodeId);
        
        // Gather inputs for this node from predecessor outputs
        const nodeInputs = new Map();
        
        const incomingConns = Array.from(this.connections).filter(c => c.toNode === nodeId);
        for (const conn of incomingConns) {
          const predecessorResults = results.get(conn.fromNode);
          
          if (predecessorResults) {
            let data = predecessorResults.get(conn.fromPort);
            
            // Apply connection transformations
            data = conn.transform(data);
            
            if (data !== null) {
              nodeInputs.set(conn.toPort, data);
            }
          }
        }

        // Execute the node
        const nodeOutputs = await node.execute(nodeInputs);
        results.set(nodeId, nodeOutputs);
      }

      const endTime = performance.now();
      this.lastExecutionTime = endTime - startTime;

      return results;

    } catch (error) {
      this.lastExecutionError = error;
      throw error;
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Execute a single node (for debugging/testing)
   * @param {string} nodeId
   * @param {Map<string, *>} inputData
   * @returns {Promise<Map<string, *>>}
   */
  async executeNode(nodeId, inputData) {
    const node = this.getNode(nodeId);
    if (!node) throw new Error(`Node "${nodeId}" not found`);

    return await node.execute(inputData);
  }

  /**
   * Serialize graph to JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      version: this.version,
      name: this.name,
      description: this.description,
      nodes: Array.from(this.nodes.values()).map(n => n.toJSON()),
      connections: Array.from(this.connections).map(c => c.toJSON()),
    };
  }

  /**
   * Create graph from JSON definition
   * @param {Object} definition
   * @param {Object} nodeFactory - Factory to create nodes from definition
   * @returns {PipelineGraph}
   */
  static fromJSON(definition, nodeFactory) {
    const graph = new PipelineGraph(definition);

    // Create nodes
    if (definition.nodes) {
      for (const nodeDef of definition.nodes) {
        const node = nodeFactory(nodeDef);
        graph.addNode(node);
      }
    }

    // Create connections
    if (definition.connections) {
      for (const connDef of definition.connections) {
        // Parse connection format: "nodeId:portId→nodeId:portId"
        const [from, to] = connDef.from ? [connDef.from, connDef.to] : [connDef.from || '', connDef.to || ''];
        const [fromNodeId, fromPortId] = from.split(':');
        const [toNodeId, toPortId] = to.split(':');

        graph.connect(fromNodeId, fromPortId, toNodeId, toPortId, connDef.conditions);
      }
    }

    return graph;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PipelineGraph,
  };
}

// Also export to window if in browser
if (typeof window !== 'undefined') {
  window.PipelineGraph = PipelineGraph;
}
