/**
 * texture-pipeline-example.js
 * 
 * Example: Texture processing pipeline
 * Converts: PNG source → .texture metadata → .d2 binary
 * 
 * Usage:
 *   const pipeline = createTexturePipeline();
 *   const executor = new PipelineExecutor(pipeline.graph);
 *   const { results, stats } = await executor.execute(inputs);
 */

/**
 * Create a texture processing pipeline: PNG → TextureBuilder → D2Builder → OutputD2
 */
function createTexturePipeline() {
  const PipelineGraph = window.PipelineGraph;
  const graph = new PipelineGraph({
    name: 'Texture Processing',
    description: 'Convert PNG image to D2 texture format',
    version: 2,
  });

  // Input: PNG file
  const inputNode = new window.InputNode({
    id: 'input_png',
    label: 'PNG Source Image',
    config: {
      filePattern: '*.png',
    },
    position: { x: 50, y: 100 },
  });

  // Transformer: Texture metadata builder
  const textureNode = new window.TransformerNode({
    id: 'texture_builder',
    label: 'Build Texture Metadata',
    config: {
      outputFormat: 'd2_mode_i8',
      compression: 'none',
    },
    position: { x: 250, y: 100 },
  });

  // Try to attach real TextureBuilder if available
  if (typeof window !== 'undefined' && window.TextureBuilder) {
    textureNode.setBuilder(new window.TextureBuilder());
  }

  // Transformer: D2 binary builder
  const d2Node = new window.TransformerNode({
    id: 'd2_builder',
    label: 'Compile to D2 Binary',
    config: {
      compression: 'rle',
    },
    position: { x: 450, y: 100 },
  });

  // Try to attach real D2Builder if available
  if (typeof window !== 'undefined' && window.D2Builder) {
    d2Node.setBuilder(new window.D2Builder());
  }

  // Output: D2 file
  const outputNode = new window.OutputNode({
    id: 'output_d2',
    label: 'Save D2 Binary',
    config: {
      outputPath: 'build/textures/{input}.d2',
    },
    position: { x: 650, y: 100 },
  });

  // Add nodes to graph
  graph.addNode(inputNode);
  graph.addNode(textureNode);
  graph.addNode(d2Node);
  graph.addNode(outputNode);

  // Connect ports
  graph.connect('input_png', 'file', 'texture_builder', 'input');
  graph.connect('texture_builder', 'output', 'd2_builder', 'input');
  graph.connect('d2_builder', 'output', 'output_d2', 'input');

  return { graph };
}

/**
 * Example with multiple outputs from single PNG
 * Demonstrates: PNG → TextureBuilder AND FramesetBuilder
 */
function createMultiOutputPipeline() {
  const PipelineGraph = window.PipelineGraph;
  const graph = new PipelineGraph({
    name: 'Multi-Output Asset Processing',
    description: 'Convert PNG to both tileset and frameset',
    version: 2,
  });

  // Input
  const inputNode = new window.InputNode({
    id: 'input_png',
    label: 'PNG Source',
    config: { filePattern: '*.png' },
    position: { x: 50, y: 100 },
  });

  // Branch 1: Texture path
  const textureNode = new window.TransformerNode({
    id: 'texture_builder',
    label: 'Build Texture',
    position: { x: 250, y: 50 },
  });

  const d2Node = new window.TransformerNode({
    id: 'd2_builder',
    label: 'Build D2',
    position: { x: 450, y: 50 },
  });

  const outputD2 = new window.OutputNode({
    id: 'output_d2',
    label: 'Save D2',
    config: { outputPath: 'build/{input}.d2' },
    position: { x: 650, y: 50 },
  });

  // Branch 2: Frameset path
  const framesetNode = new window.TransformerNode({
    id: 'frameset_builder',
    label: 'Build Frameset',
    position: { x: 250, y: 150 },
  });

  const outputFrameset = new window.OutputNode({
    id: 'output_frameset',
    label: 'Save Frameset',
    config: { outputPath: 'build/{input}.frameset.json' },
    position: { x: 450, y: 150 },
  });

  // Add all nodes
  graph.addNode(inputNode);
  graph.addNode(textureNode);
  graph.addNode(d2Node);
  graph.addNode(outputD2);
  graph.addNode(framesetNode);
  graph.addNode(outputFrameset);

  // Connect texture branch
  graph.connect('input_png', 'file', 'texture_builder', 'input');
  graph.connect('texture_builder', 'output', 'd2_builder', 'input');
  graph.connect('d2_builder', 'output', 'output_d2', 'input');

  // Connect frameset branch
  graph.connect('input_png', 'file', 'frameset_builder', 'input');
  graph.connect('frameset_builder', 'output', 'output_frameset', 'input');

  return { graph };
}

/**
 * Example with filtering
 * Demonstrates: PNG → Filter (check format) → TextureBuilder OR IconBuilder
 */
function createFilteredPipeline() {
  const PipelineGraph = window.PipelineGraph;
  const graph = new PipelineGraph({
    name: 'Format-Aware Asset Processing',
    description: 'Route images to different builders based on format',
    version: 2,
  });

  const inputNode = new window.InputNode({
    id: 'input_png',
    label: 'PNG Source',
    position: { x: 50, y: 100 },
  });

  // Filter: Check if image is large enough for texture
  const filterNode = new window.FilterNode({
    id: 'format_filter',
    label: 'Check Size',
    config: {
      predicate: (imageData) => {
        // Would check actual image dimensions
        return imageData && imageData.width >= 64;
      },
    },
    position: { x: 250, y: 100 },
  });

  // Path 1: Large images → Texture
  const textureNode = new window.TransformerNode({
    id: 'texture_builder',
    label: 'Texture (Large)',
    position: { x: 450, y: 50 },
  });

  const outputTexture = new window.OutputNode({
    id: 'output_texture',
    label: 'Save Texture',
    config: { outputPath: 'build/{input}.texture' },
    position: { x: 650, y: 50 },
  });

  // Path 2: Small images → Icon
  const iconNode = new window.TransformerNode({
    id: 'icon_builder',
    label: 'Icon (Small)',
    position: { x: 450, y: 150 },
  });

  const outputIcon = new window.OutputNode({
    id: 'output_icon',
    label: 'Save Icon',
    config: { outputPath: 'build/{input}.icon.png' },
    position: { x: 650, y: 150 },
  });

  // Add nodes
  graph.addNode(inputNode);
  graph.addNode(filterNode);
  graph.addNode(textureNode);
  graph.addNode(outputTexture);
  graph.addNode(iconNode);
  graph.addNode(outputIcon);

  // Connections
  graph.connect('input_png', 'file', 'format_filter', 'input');
  graph.connect('format_filter', 'pass', 'texture_builder', 'input');
  graph.connect('texture_builder', 'output', 'output_texture', 'input');
  graph.connect('format_filter', 'reject', 'icon_builder', 'input');
  graph.connect('icon_builder', 'output', 'output_icon', 'input');

  return { graph };
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createTexturePipeline,
    createMultiOutputPipeline,
    createFilteredPipeline,
  };
}

// Also export to window if in browser
if (typeof window !== 'undefined') {
  window.createTexturePipeline = createTexturePipeline;
  window.createMultiOutputPipeline = createMultiOutputPipeline;
  window.createFilteredPipeline = createFilteredPipeline;
}
