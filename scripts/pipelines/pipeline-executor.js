/**
 * pipeline-executor.js
 * 
 * Execution engine for DAG-based graphics pipeline.
 * Handles execution with logging, progress tracking, and error handling.
 */

/**
 * @typedef {Object} ExecutionStats
 * @property {number} totalNodes - Total nodes in graph
 * @property {number} executedNodes - Nodes that executed
 * @property {number} failedNodes - Nodes that failed
 * @property {number} totalTime - Total execution time in ms
 * @property {Object[]} logs - Execution logs
 */

/**
 * PipelineExecutor orchestrates execution with progress and logging
 */
class PipelineExecutor {
  constructor(graph) {
    this.graph = graph;
    this.isRunning = false;
    this.stats = null;
    this.logs = [];
    this.progressCallback = null;
  }

  /**
   * Set callback for progress updates
   * @param {Function} callback - (nodeId: string, status: 'pending' | 'running' | 'done' | 'error', data: any) => void
   */
  onProgress(callback) {
    this.progressCallback = callback;
  }

  /**
   * Add a log entry
   * @param {string} level - 'info', 'warn', 'error'
   * @param {string} message
   * @param {Object} [data]
   */
  log(level, message, data = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };
    this.logs.push(entry);
    
    if (typeof console !== 'undefined') {
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
        `[${entry.timestamp}] ${message}`,
        data ? `\n${JSON.stringify(data, null, 2)}` : ''
      );
    }
  }

  /**
   * Execute the pipeline
   * @param {Map<string, *>} inputs - Optional initial inputs
   * @returns {Promise<{results: Map, stats: ExecutionStats}>}
   */
  async execute(inputs = new Map()) {
    if (this.isRunning) {
      throw new Error('Pipeline is already running');
    }

    this.isRunning = true;
    this.logs = [];
    const startTime = performance.now();

    try {
      this.log('info', `Starting pipeline execution: "${this.graph.name}"`);
      
      // Validate graph
      const validationErrors = this.graph.validate();
      if (validationErrors.length > 0) {
        const errorMsg = validationErrors
          .map(e => `${e.nodeId}: ${e.message}`)
          .join('\n');
        this.log('error', `Pipeline validation failed:\n${errorMsg}`, validationErrors);
        throw new Error(`Pipeline validation failed with ${validationErrors.length} error(s)`);
      }

      this.log('info', 'Pipeline validation passed');

      // Get execution order
      const order = this.graph.getTopologicalOrder();
      this.log('info', `Execution order: ${order.join(' → ')}`);

      // Initialize stats
      this.stats = {
        totalNodes: this.graph.nodes.size,
        executedNodes: 0,
        failedNodes: 0,
        totalTime: 0,
        logs: [],
      };

      // Execute via graph
      const results = await this.graph.execute(inputs);

      // Collect execution results
      this.stats.totalTime = performance.now() - startTime;
      this.stats.executedNodes = order.length;

      this.log('info', `Pipeline completed successfully in ${this.stats.totalTime.toFixed(2)}ms`);

      return {
        results,
        stats: this.stats,
      };

    } catch (error) {
      this.stats = {
        totalNodes: this.graph.nodes.size,
        executedNodes: 0,
        failedNodes: 1,
        totalTime: performance.now() - startTime,
        logs: this.logs,
      };

      this.log('error', `Pipeline execution failed: ${error.message}`, {
        stack: error.stack,
      });

      throw error;

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Execute and return final outputs from all output nodes
   * @param {Map<string, *>} inputs
   * @returns {Promise<Map<string, *>>} - fileName -> fileContent
   */
  async executeAndCollectOutputs(inputs = new Map()) {
    const { results } = await this.execute(inputs);

    const outputs = new Map();

    // Collect results from all OutputNode instances
    for (const [nodeId, nodeOutputs] of results) {
      const node = this.graph.getNode(nodeId);
      
      if (node && node.type === 'output') {
        const savedMeta = nodeOutputs.get('saved');
        if (savedMeta && savedMeta.path) {
          outputs.set(savedMeta.path, nodeOutputs);
        }
      }
    }

    return outputs;
  }

  /**
   * Get execution logs as formatted string
   * @returns {string}
   */
  getLogsAsString() {
    return this.logs
      .map(entry => `[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}`)
      .join('\n');
  }

  /**
   * Clear logs
   */
  clearLogs() {
    this.logs = [];
  }
}

/**
 * High-level helper: Execute a pipeline from JSON definition
 * 
 * @param {Object} pipelineJSON - Pipeline definition
 * @param {Map<string, *>} inputs - Initial inputs
 * @param {Function} nodeFactory - Factory function to create nodes from definitions
 * @returns {Promise<{results: Map, stats: ExecutionStats}>}
 */
async function executePipelineFromJSON(pipelineJSON, inputs = new Map(), nodeFactory) {
  const PipelineGraph = window.PipelineGraph || require('./pipeline-graph.js').PipelineGraph;
  
  const graph = PipelineGraph.fromJSON(pipelineJSON, nodeFactory);
  const executor = new PipelineExecutor(graph);
  
  return await executor.execute(inputs);
}

/**
 * Helper: Create a simple texture pipeline node factory
 * @param {Object} def - Node definition
 * @returns {PipelineNode}
 */
function createNodeFromDefinition(def) {
  const nodeClasses = {
    input: window.InputNode,
    transformer: window.TransformerNode,
    output: window.OutputNode,
    filter: window.FilterNode,
    mux: window.MuxNode,
  };

  const NodeClass = nodeClasses[def.type];
  if (!NodeClass) {
    throw new Error(`Unknown node type: ${def.type}`);
  }

  const node = new NodeClass(def);
  
  // If transformer, look up builder
  if (def.type === 'transformer' && def.builderName) {
    const builderClass = window[`${def.builderName.charAt(0).toUpperCase() + def.builderName.slice(1)}Builder`];
    if (builderClass) {
      node.setBuilder(new builderClass());
    }
  }

  return node;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PipelineExecutor,
    executePipelineFromJSON,
    createNodeFromDefinition,
  };
}

// Also export to window if in browser
if (typeof window !== 'undefined') {
  window.PipelineExecutor = PipelineExecutor;
  window.executePipelineFromJSON = executePipelineFromJSON;
  window.createNodeFromDefinition = createNodeFromDefinition;
}
