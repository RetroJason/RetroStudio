/**
 * PipelineEditor - Main editor UI component
 * 
 * Provides toolbar, node palette, and canvas integration
 */

class PipelineEditor {
  constructor(containerId) {
    this.container = typeof containerId === 'string' 
      ? document.getElementById(containerId)
      : containerId;

    this.canvas = null;
    this.registry = null;
    this.currentPipeline = null;
    this.validationErrors = [];

    this.createUI();
  }

  /**
   * Create editor UI
   */
  createUI() {
    // Container styling
    this.container.style.cssText = `
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      background: #1a1a1a;
      color: #e0e0e0;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;

    // Toolbar
    const toolbar = this.createToolbar();
    this.container.appendChild(toolbar);

    // Main content area (canvas + palette)
    const content = document.createElement('div');
    content.style.cssText = `
      display: flex;
      flex: 1;
      gap: 0;
      overflow: hidden;
    `;

    // Canvas
    const canvasContainer = document.createElement('div');
    canvasContainer.style.cssText = `
      flex: 1;
      position: relative;
      background: #0a0a0a;
      border-right: 1px solid #333;
    `;

    this.canvasElement = document.createElement('canvas');
    this.canvasElement.style.cssText = `
      display: block;
      width: 100%;
      height: 100%;
      cursor: crosshair;
    `;
    canvasContainer.appendChild(this.canvasElement);

    // Set canvas size to match container (handle resizing)
    const updateCanvasSize = () => {
      const rect = canvasContainer.getBoundingClientRect();
      this.canvasElement.width = rect.width;
      this.canvasElement.height = rect.height;
    };
    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);

    // Initialize canvas
    this.canvas = new PipelineCanvas(this.canvasElement, this.canvasElement.width, this.canvasElement.height);
    this.canvas.onConnectionCreated = (from, to) => this.onConnectionCreated(from, to);

    content.appendChild(canvasContainer);

    // Palette (right panel)
    const palette = this.createPalette();
    content.appendChild(palette);

    this.container.appendChild(content);

    // Status bar
    const statusBar = this.createStatusBar();
    this.container.appendChild(statusBar);
    this.statusBar = statusBar;
  }

  /**
   * Create toolbar
   */
  createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
      display: flex;
      gap: 8px;
      padding: 12px;
      background: #1a1a1a;
      border-bottom: 1px solid #333;
      align-items: center;
      flex-wrap: wrap;
    `;

    // File operations
    const fileGroup = document.createElement('div');
    fileGroup.style.cssText = 'display: flex; gap: 4px;';

    fileGroup.appendChild(this.createButton('New', () => this.newPipeline()));
    fileGroup.appendChild(this.createButton('Open', () => this.openPipeline()));
    fileGroup.appendChild(this.createButton('Save', () => this.savePipeline()));
    fileGroup.appendChild(this.createButton('Export', () => this.exportPipeline()));

    toolbar.appendChild(fileGroup);

    // Separator
    const sep1 = document.createElement('div');
    sep1.style.cssText = 'width: 1px; height: 24px; background: #333; margin: 0 4px;';
    toolbar.appendChild(sep1);

    // Edit operations
    const editGroup = document.createElement('div');
    editGroup.style.cssText = 'display: flex; gap: 4px;';

    editGroup.appendChild(this.createButton('Clear', () => this.clearCanvas()));
    editGroup.appendChild(this.createButton('Delete Selected', () => this.deleteSelected()));

    toolbar.appendChild(editGroup);

    // Separator
    const sep2 = document.createElement('div');
    sep2.style.cssText = 'width: 1px; height: 24px; background: #333; margin: 0 4px;';
    toolbar.appendChild(sep2);

    // View operations
    const viewGroup = document.createElement('div');
    viewGroup.style.cssText = 'display: flex; gap: 4px;';

    viewGroup.appendChild(this.createButton('Zoom In', () => {
      this.canvas.zoom *= 1.2;
      this.canvas.draw();
    }));
    viewGroup.appendChild(this.createButton('Zoom Out', () => {
      this.canvas.zoom /= 1.2;
      this.canvas.draw();
    }));
    viewGroup.appendChild(this.createButton('Fit', () => this.fitToView()));

    toolbar.appendChild(viewGroup);

    // Separator
    const sep3 = document.createElement('div');
    sep3.style.cssText = 'width: 1px; height: 24px; background: #333; margin: 0 4px;';
    toolbar.appendChild(sep3);

    // Validation
    const validateGroup = document.createElement('div');
    validateGroup.style.cssText = 'display: flex; gap: 4px;';

    validateGroup.appendChild(this.createButton('Validate', () => this.validatePipeline()));
    validateGroup.appendChild(this.createButton('Execute', () => this.executePipeline()));

    toolbar.appendChild(validateGroup);

    return toolbar;
  }

  /**
   * Create palette panel
   */
  createPalette() {
    const palette = document.createElement('div');
    palette.style.cssText = `
      width: 280px;
      background: #0f0f0f;
      border-left: 1px solid #333;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 100;
    `;

    // Node templates section
    const templatesTitle = document.createElement('h3');
    templatesTitle.textContent = 'Node Templates';
    templatesTitle.style.cssText = `
      padding: 12px;
      margin: 0;
      border-bottom: 1px solid #333;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #888;
    `;
    palette.appendChild(templatesTitle);

    const templates = [
      { label: '📥 Input', type: 'InputNode' },
      { label: '⚙️ Transformer', type: 'TransformerNode' },
      { label: '📤 Output', type: 'OutputNode' },
      { label: '🔀 Filter', type: 'FilterNode' },
      { label: '🔗 Mux', type: 'MuxNode' },
    ];

    for (const template of templates) {
      const btn = document.createElement('button');
      btn.textContent = template.label;
      btn.style.cssText = `
        width: 100%;
        padding: 12px;
        background: #2d2d2d;
        border: none;
        border-bottom: 1px solid #333;
        color: #4ade80;
        cursor: pointer;
        text-align: left;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s;
      `;

      btn.onmouseover = () => {
        btn.style.background = '#3a5f4d';
        btn.style.color = '#86efac';
        btn.style.paddingLeft = '16px';
      };
      btn.onmouseout = () => {
        btn.style.background = '#2d2d2d';
        btn.style.color = '#4ade80';
        btn.style.paddingLeft = '12px';
      };

      btn.onclick = () => this.addNode(template.type, template.label);
      palette.appendChild(btn);
    }

    // Separator
    const sep = document.createElement('div');
    sep.style.cssText = 'height: 1px; background: #333; margin: 8px 0;';
    palette.appendChild(sep);

    // Pipelines section
    const pipelinesTitle = document.createElement('h3');
    pipelinesTitle.textContent = 'Pipelines';
    pipelinesTitle.style.cssText = templatesTitle.style.cssText;
    palette.appendChild(pipelinesTitle);

    this.pipelinesList = document.createElement('div');
    this.pipelinesList.style.cssText = `
      flex: 1;
      overflow-y: auto;
    `;
    palette.appendChild(this.pipelinesList);

    // Properties section
    const propsTitle = document.createElement('h3');
    propsTitle.textContent = 'Properties';
    propsTitle.style.cssText = templatesTitle.style.cssText;
    palette.appendChild(propsTitle);

    this.propertiesPanel = document.createElement('div');
    this.propertiesPanel.style.cssText = `
      padding: 12px;
      font-size: 11px;
      color: #999;
    `;
    this.propertiesPanel.textContent = 'Select a node to edit properties';
    palette.appendChild(this.propertiesPanel);

    return palette;
  }

  /**
   * Create status bar
   */
  createStatusBar() {
    const statusBar = document.createElement('div');
    statusBar.style.cssText = `
      display: flex;
      gap: 12px;
      padding: 8px 12px;
      background: #0f0f0f;
      border-top: 1px solid #333;
      font-size: 11px;
      color: #666;
      height: 24px;
      align-items: center;
    `;

    this.statusText = document.createElement('span');
    this.statusText.textContent = 'Ready';
    statusBar.appendChild(this.statusText);

    const sep = document.createElement('div');
    sep.style.cssText = 'width: 1px; height: 16px; background: #333;';
    statusBar.appendChild(sep);

    this.nodeCountText = document.createElement('span');
    this.updateNodeCount();
    statusBar.appendChild(this.nodeCountText);

    return statusBar;
  }

  /**
   * Create a button
   */
  createButton(label, onclick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      padding: 6px 12px;
      background: #2d2d2d;
      border: 1px solid #444;
      color: #e0e0e0;
      cursor: pointer;
      font-size: 12px;
      border-radius: 3px;
      transition: background 0.2s;
    `;

    btn.onmouseover = () => { btn.style.background = '#3a3a3a'; };
    btn.onmouseout = () => { btn.style.background = '#2d2d2d'; };

    btn.onclick = onclick;
    return btn;
  }

  /**
   * Add a node to the canvas
   */
  addNode(type, label) {
    const id = `${type}-${Date.now()}`;
    
    let inputs = [];
    let outputs = [];

    if (type === 'InputNode') {
      outputs = ['file'];
    } else if (type === 'TransformerNode') {
      inputs = ['input'];
      outputs = ['output'];
    } else if (type === 'OutputNode') {
      inputs = ['input'];
    } else if (type === 'FilterNode') {
      inputs = ['input'];
      outputs = ['pass', 'reject'];
    } else if (type === 'MuxNode') {
      inputs = ['input1', 'input2'];
      outputs = ['output'];
    }

    this.canvas.addNode(id, type, label, inputs, outputs);
    this.canvas.draw();
    this.updateNodeCount();
  }

  /**
   * Handle connection creation
   */
  onConnectionCreated(from, to) {
    if (!from || !to) return;

    if (this.isValidConnection(from, to)) {
      this.canvas.addConnection(
        from.node.id, from.portId,
        to.node.id, to.portId
      );
      this.canvas.draw();
      this.updateStatus('Connection created');
    } else {
      this.updateStatus('Invalid connection', true);
    }
  }

  /**
   * Check if connection is valid
   */
  isValidConnection(from, to) {
    if (from.node === to.node) return false;
    if (from.isInput === to.isInput) return false;
    return true;
  }

  /**
   * Delete selected node
   */
  deleteSelected() {
    if (this.canvas.selectedNode) {
      this.canvas.removeNode(this.canvas.selectedNode.id);
      this.canvas.selectedNode = null;
      this.canvas.draw();
      this.updateNodeCount();
      this.updateStatus('Node deleted');
    }
  }

  /**
   * Clear entire canvas
   */
  clearCanvas() {
    if (confirm('Clear all nodes and connections?')) {
      this.canvas.nodes.clear();
      this.canvas.connections.clear();
      this.canvas.draw();
      this.updateNodeCount();
      this.updateStatus('Canvas cleared');
    }
  }

  /**
   * Fit canvas to view
   */
  fitToView() {
    if (this.canvas.nodes.size === 0) return;

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const node of this.canvas.nodes.values()) {
      minX = Math.min(minX, node.x - node.width / 2 - 50);
      minY = Math.min(minY, node.y - node.height / 2 - 50);
      maxX = Math.max(maxX, node.x + node.width / 2 + 50);
      maxY = Math.max(maxY, node.y + node.height / 2 + 50);
    }

    const width = maxX - minX;
    const height = maxY - minY;

    this.canvas.zoom = Math.min(
      this.canvas.width / width,
      this.canvas.height / height,
      2
    );

    this.canvas.panX = -minX * this.canvas.zoom + 50;
    this.canvas.panY = -minY * this.canvas.zoom + 50;

    this.canvas.draw();
    this.updateStatus('Fitted to view');
  }

  /**
   * Validate pipeline
   */
  validatePipeline() {
    const errors = [];

    // Check for isolated nodes
    for (const node of this.canvas.nodes.values()) {
      const hasIncoming = Array.from(this.canvas.connections).some(
        c => c.to.nodeId === node.id
      );
      const hasOutgoing = Array.from(this.canvas.connections).some(
        c => c.from.nodeId === node.id
      );

      if (!hasIncoming && node.inputs.length > 0) {
        errors.push(`Node "${node.label}" has unconnected inputs`);
      }
    }

    // Check for cycles (simplified)
    if (this.hasCycle()) {
      errors.push('Pipeline contains cycles');
    }

    this.validationErrors = errors;

    if (errors.length === 0) {
      this.updateStatus('✓ Pipeline is valid', false);
    } else {
      this.updateStatus(`✗ ${errors.length} error(s)`, true);
      alert('Validation errors:\n' + errors.join('\n'));
    }
  }

  /**
   * Simple cycle detection
   */
  hasCycle() {
    const visited = new Set();
    const recStack = new Set();

    const visit = (nodeId) => {
      visited.add(nodeId);
      recStack.add(nodeId);

      for (const conn of this.canvas.connections) {
        if (conn.from.nodeId === nodeId) {
          if (!visited.has(conn.to.nodeId)) {
            if (visit(conn.to.nodeId)) return true;
          } else if (recStack.has(conn.to.nodeId)) {
            return true;
          }
        }
      }

      recStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.canvas.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (visit(nodeId)) return true;
      }
    }

    return false;
  }

  /**
   * Execute pipeline
   */
  executePipeline() {
    this.validatePipeline();
    if (this.validationErrors.length > 0) {
      alert('Cannot execute: validation errors exist');
      return;
    }

    const def = this.canvas.exportPipeline('Edited Pipeline');
    this.updateStatus('Pipeline execution starting...', false);
    
    // In real implementation, would create graph and execute
    alert('Pipeline exported. Would execute here.');
  }

  /**
   * New pipeline
   */
  newPipeline() {
    this.clearCanvas();
    this.currentPipeline = null;
    this.updateStatus('New pipeline');
  }

  /**
   * Open pipeline
   */
  openPipeline() {
    // Would show file picker or registry browser
    this.updateStatus('Open pipeline not yet implemented');
  }

  /**
   * Save pipeline
   */
  savePipeline() {
    const def = this.canvas.exportPipeline(this.currentPipeline?.name || 'Pipeline');
    localStorage.setItem('pipeline_' + def.id, JSON.stringify(def));
    this.updateStatus('Pipeline saved');
  }

  /**
   * Export pipeline
   */
  exportPipeline() {
    const def = this.canvas.exportPipeline(this.currentPipeline?.name || 'Pipeline');
    const json = JSON.stringify(def, null, 2);
    
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${def.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    this.updateStatus('Pipeline exported');
  }

  /**
   * Update status message
   */
  updateStatus(message, isError = false) {
    this.statusText.textContent = message;
    this.statusText.style.color = isError ? '#f87171' : '#4ade80';
  }

  /**
   * Update node count display
   */
  updateNodeCount() {
    const nodeCount = this.canvas.nodes.size;
    const connCount = this.canvas.connections.size;
    this.nodeCountText.textContent = `Nodes: ${nodeCount} | Connections: ${connCount}`;
  }

  /**
   * Load a pipeline definition
   */
  loadPipeline(pipelineDefinition) {
    this.clearCanvas();
    this.currentPipeline = pipelineDefinition;

    // Add nodes
    for (const nodeDef of pipelineDefinition.nodes) {
      const inputs = nodeDef.ports
        ?.filter(p => p.direction === 'in')
        .map(p => p.id) || [];
      const outputs = nodeDef.ports
        ?.filter(p => p.direction === 'out')
        .map(p => p.id) || [];

      this.canvas.addNode(nodeDef.id, nodeDef.type, nodeDef.id, inputs, outputs);
    }

    // Add connections
    for (const connDef of pipelineDefinition.connections) {
      this.canvas.addConnection(
        connDef.from.nodeId, connDef.from.portId,
        connDef.to.nodeId, connDef.to.portId
      );
    }

    this.canvas.draw();
    this.fitToView();
    this.updateNodeCount();
    this.updateStatus(`Loaded: ${pipelineDefinition.name}`);
  }
}

// Export
if (typeof window !== 'undefined') {
  window.PipelineEditor = PipelineEditor;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PipelineEditor };
}
