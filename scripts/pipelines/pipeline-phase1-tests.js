/**
 * PHASE 1 IMPLEMENTATION TEST/EXAMPLE
 * 
 * This file demonstrates how to use the Phase 1 pipeline architecture.
 * It can be included in RetroStudio to test the core functionality.
 * 
 * Load in order:
 * 1. pipeline-node.js
 * 2. pipeline-graph.js
 * 3. pipeline-executor.js
 * 4. texture-pipeline-example.js (or create custom pipelines)
 * 5. This file for testing
 */

/**
 * Test: Create a simple texture pipeline and validate it
 */
async function testPipelineValidation() {
  console.log('=== Testing Pipeline Validation ===');
  
  const { graph } = createTexturePipeline();
  
  // Validate
  const errors = graph.validate();
  console.log(`Validation errors: ${errors.length}`);
  if (errors.length > 0) {
    errors.forEach(err => console.error(`  ${err.nodeId}: ${err.message}`));
  } else {
    console.log('✓ Pipeline is valid');
  }
  
  return graph;
}

/**
 * Test: Get topological execution order
 */
async function testTopologicalSort() {
  console.log('\n=== Testing Topological Sort ===');
  
  const { graph } = createTexturePipeline();
  const order = graph.getTopologicalOrder();
  
  console.log(`Execution order: ${order.join(' → ')}`);
  console.log('✓ Topological sort completed');
  
  return order;
}

/**
 * Test: Graph serialization
 */
async function testSerialization() {
  console.log('\n=== Testing Graph Serialization ===');
  
  const { graph } = createTexturePipeline();
  const json = graph.toJSON();
  
  console.log(`Graph JSON has ${json.nodes.length} nodes and ${json.connections.length} connections`);
  console.log('Graph name:', json.name);
  console.log('✓ Serialization successful');
  
  return json;
}

/**
 * Test: Multi-output pipeline
 */
async function testMultiOutputPipeline() {
  console.log('\n=== Testing Multi-Output Pipeline ===');
  
  const { graph } = createMultiOutputPipeline();
  const errors = graph.validate();
  
  console.log(`Nodes: ${graph.nodes.size}`);
  console.log(`Connections: ${graph.connections.size}`);
  console.log(`Validation errors: ${errors.length}`);
  console.log('✓ Multi-output pipeline created');
  
  return graph;
}

/**
 * Test: Filtered pipeline (with conditional routing)
 */
async function testFilteredPipeline() {
  console.log('\n=== Testing Filtered Pipeline ===');
  
  const { graph } = createFilteredPipeline();
  const order = graph.getTopologicalOrder();
  
  console.log(`Execution order: ${order.join(' → ')}`);
  console.log(`Total branches from filter: 2 (pass + reject)`);
  console.log('✓ Filtered pipeline created');
  
  return graph;
}

/**
 * Test: Graph analysis methods
 */
async function testGraphAnalysis() {
  console.log('\n=== Testing Graph Analysis ===');
  
  const { graph } = createTexturePipeline();
  
  // Test getInputs
  const textureInputs = graph.getInputs('texture_builder');
  console.log(`Texture builder inputs: ${textureInputs.join(', ')}`);
  
  // Test getDependents
  const inputDependents = graph.getDependents('input_png');
  console.log(`Input PNG dependents: ${inputDependents.join(', ')}`);
  
  // Test getConnectionsFromPort
  const conns = graph.getConnectionsFromPort('input_png', 'file');
  console.log(`Connections from input_png:file: ${conns.length}`);
  
  console.log('✓ Graph analysis completed');
}

/**
 * Test: Port connection validation
 */
async function testPortValidation() {
  console.log('\n=== Testing Port Validation ===');
  
  const node1 = new window.InputNode({
    id: 'input',
    label: 'Input',
  });
  
  const node2 = new window.TransformerNode({
    id: 'transformer',
    label: 'Transformer',
  });
  
  const inputPort = node1.getPort('file');
  const transformPort = node2.getPort('input');
  
  // Test direction compatibility
  const canConnect = inputPort.canConnectTo(transformPort);
  console.log(`Can connect output→input: ${canConnect}`);
  
  const cannotConnect = inputPort.canConnectTo(inputPort);
  console.log(`Can connect output→output: ${cannotConnect}`);
  
  console.log('✓ Port validation completed');
}

/**
 * Test: Executor with logging
 */
async function testExecutor() {
  console.log('\n=== Testing Pipeline Executor ===');
  
  const { graph } = createTexturePipeline();
  const executor = new window.PipelineExecutor(graph);
  
  // Add progress callback
  executor.onProgress((nodeId, status, data) => {
    console.log(`  [${status}] ${nodeId}`);
  });
  
  try {
    // This will fail because we don't have actual file input,
    // but demonstrates executor setup
    // const { results, stats } = await executor.execute();
    
    // For now, just test the executor setup
    console.log('Executor created with logging');
    console.log(`Graph has ${graph.nodes.size} nodes`);
    console.log('✓ Executor setup completed');
    
  } catch (error) {
    console.log(`Expected error (no file input): ${error.message}`);
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('====================================');
  console.log('   PIPELINE ARCHITECTURE v2');
  console.log('         PHASE 1 TESTS');
  console.log('====================================\n');
  
  try {
    await testPipelineValidation();
    await testTopologicalSort();
    await testSerialization();
    await testMultiOutputPipeline();
    await testFilteredPipeline();
    await testGraphAnalysis();
    await testPortValidation();
    await testExecutor();
    
    console.log('\n====================================');
    console.log('   ALL TESTS COMPLETED ✓');
    console.log('====================================');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
  }
}

// Export for use in console or test runners
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    testPipelineValidation,
    testTopologicalSort,
    testSerialization,
    testMultiOutputPipeline,
    testFilteredPipeline,
    testGraphAnalysis,
    testPortValidation,
    testExecutor,
    runAllTests,
  };
}

// Export to window if in browser
if (typeof window !== 'undefined') {
  window.runAllTests = runAllTests;
  window.testPipelineValidation = testPipelineValidation;
  window.testTopologicalSort = testTopologicalSort;
  window.testSerialization = testSerialization;
  window.testMultiOutputPipeline = testMultiOutputPipeline;
  window.testFilteredPipeline = testFilteredPipeline;
  window.testGraphAnalysis = testGraphAnalysis;
  window.testPortValidation = testPortValidation;
  window.testExecutor = testExecutor;
}

// Auto-run on load (optional)
// Uncomment to auto-run tests when this file is loaded
// if (typeof window !== 'undefined' && document.readyState !== 'loading') {
//   runAllTests();
// } else if (typeof window !== 'undefined') {
//   document.addEventListener('DOMContentLoaded', runAllTests);
// }
