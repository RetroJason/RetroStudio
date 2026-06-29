/**
 * Pipeline Visual Editor - Phase 3
 * 
 * Canvas-based graph editor for constructing and visualizing DAG pipelines
 * Features:
 * - Drag-and-drop nodes
 * - Click-to-connect ports
 * - Real-time validation
 * - Import/export pipeline definitions
 * 
 * Usage:
 *   const editor = new PipelineEditor(containerElement);
 *   editor.loadPipeline(pipelineDefinition);
 */

/**
 * PipelineCanvas - Core canvas rendering and interaction
 */
class PipelineCanvas {
  constructor(canvas, width = 1200, height = 800) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = width;
    this.height = height;
    
    // Set canvas size
    this.canvas.width = width;
    this.canvas.height = height;
    
    // Visual state
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.nodeRadius = 40;
    this.portRadius = 6;
    
    // Interaction state
    this.selectedNode = null;
    this.draggingNode = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.connectingFrom = null;  // {node, port}
    this.panningStart = null;  // {x, y, panX, panY} for middle-mouse panning
    
    // Data
    this.nodes = new Map();      // id -> {id, x, y, type, label, inputs: [], outputs: []}
    this.connections = new Set();  // Set of {from: {nodeId, portId}, to: {nodeId, portId}}
    
    // Colors and styling
    this.colors = {
      background: '#1a1a1a',
      gridLine: '#333333',
      node: '#2d2d2d',
      nodeInput: '#3a4d5c',
      nodeOutput: '#5c4d3a',
      nodeSelected: '#4a9eff',
      connection: '#888888',
      connectionValid: '#4ade80',
      connectionInvalid: '#f87171',
      port: '#4ade80',
      portHover: '#86efac',
      text: '#e0e0e0',
      error: '#f87171',
      success: '#4ade80',
    };
    
    this.setupEventListeners();

    // Callbacks
    this.onConnectionCreated = null;
    this.onNodeSelected = null;
  }

  /**
   * Set up mouse and keyboard event listeners
   */
  setupEventListeners() {
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('mouseleave', (e) => this.onMouseLeave(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e));
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      return false;
    });

    // Add keyboard controls for panning
    document.addEventListener('keydown', (e) => this.onKeyDown(e));

    // Start animation loop
    this.startAnimationLoop();
  }

  /**
   * Handle keyboard events for panning
   */
  onKeyDown(e) {
    const panAmount = 20;
    
    switch (e.key) {
      case 'ArrowUp':
        this.panY += panAmount;
        this.draw();
        e.preventDefault();
        break;
      case 'ArrowDown':
        this.panY -= panAmount;
        this.draw();
        e.preventDefault();
        break;
      case 'ArrowLeft':
        this.panX += panAmount;
        this.draw();
        e.preventDefault();
        break;
      case 'ArrowRight':
        this.panX -= panAmount;
        this.draw();
        e.preventDefault();
        break;
    }
  }

  /**
   * Start continuous animation loop for real-time rendering
   */
  startAnimationLoop() {
    let frameCount = 0;
    const animate = () => {
      this.draw();
      frameCount++;
      if (frameCount === 1) {
        console.log(`[Canvas] Animation loop started, canvas: ${this.width}x${this.height}px, nodes: ${this.nodes.size}`);
      }
      if (frameCount % 60 === 0) {  // Log every 60 frames (1 second at 60fps)
        console.log(`[Canvas] Frame ${frameCount}: ${this.nodes.size} nodes, zoom: ${this.zoom.toFixed(2)}, pan: (${this.panX}, ${this.panY})`);
      }
      requestAnimationFrame(animate);
    };
    animate();
  }

  /**
   * Add a node to the canvas
   */
  addNode(id, type, label, inputs = [], outputs = []) {
    // Find a position that doesn't overlap
    let x, y;
    let attempts = 0;
    do {
      x = 100 + Math.random() * (this.width - 200);
      y = 100 + Math.random() * (this.height - 200);
      attempts++;
    } while (this.nodes.size > 0 && this.isPositionOccupied(x, y) && attempts < 10);

    this.nodes.set(id, {
      id,
      type,
      label,
      x,
      y,
      width: 100,
      height: 60,
      inputs,
      outputs,
    });
  }

  /**
   * Check if position is near existing nodes
   */
  isPositionOccupied(x, y) {
    const threshold = 120;
    for (const node of this.nodes.values()) {
      const dist = Math.hypot(node.x - x, node.y - y);
      if (dist < threshold) return true;
    }
    return false;
  }

  /**
   * Remove a node
   */
  removeNode(id) {
    this.nodes.delete(id);
    // Remove connections to/from this node
    this.connections = new Set(
      Array.from(this.connections).filter(
        conn => conn.from.nodeId !== id && conn.to.nodeId !== id
      )
    );
  }

  /**
   * Add a connection
   */
  addConnection(fromNodeId, fromPortId, toNodeId, toPortId) {
    this.connections.add({
      from: { nodeId: fromNodeId, portId: fromPortId },
      to: { nodeId: toNodeId, portId: toPortId },
    });
  }

  /**
   * Remove a connection
   */
  removeConnection(fromNodeId, fromPortId, toNodeId, toPortId) {
    this.connections = new Set(
      Array.from(this.connections).filter(
        conn => !(
          conn.from.nodeId === fromNodeId && conn.from.portId === fromPortId &&
          conn.to.nodeId === toNodeId && conn.to.portId === toPortId
        )
      )
    );
  }

  /**
   * Get node at screen position
   */
  getNodeAtPosition(screenX, screenY) {
    const x = (screenX - this.panX) / this.zoom;
    const y = (screenY - this.panY) / this.zoom;

    for (const node of this.nodes.values()) {
      // Check if click is within node rectangle
      if (
        x > node.x - node.width / 2 &&
        x < node.x + node.width / 2 &&
        y > node.y - node.height / 2 &&
        y < node.y + node.height / 2
      ) {
        return node;
      }
    }
    return null;
  }

  /**
   * Get port at screen position
   */
  getPortAtPosition(screenX, screenY) {
    const x = (screenX - this.panX) / this.zoom;
    const y = (screenY - this.panY) / this.zoom;

    for (const node of this.nodes.values()) {
      // Check input ports (left side)
      for (let i = 0; i < node.inputs.length; i++) {
        const portY = node.y - (node.inputs.length - 1) * 15 / 2 + i * 15;
        const dx = x - (node.x - node.width / 2);
        const dy = y - portY;
        
        if (Math.hypot(dx, dy) < this.portRadius * 2) {
          return { node, portId: node.inputs[i], isInput: true };
        }
      }

      // Check output ports (right side)
      for (let i = 0; i < node.outputs.length; i++) {
        const portY = node.y - (node.outputs.length - 1) * 15 / 2 + i * 15;
        const dx = x - (node.x + node.width / 2);
        const dy = y - portY;
        
        if (Math.hypot(dx, dy) < this.portRadius * 2) {
          return { node, portId: node.outputs[i], isInput: false };
        }
      }
    }
    return null;
  }

  /**
   * Mouse down handler
   */
  onMouseDown(e) {
    // Middle mouse button (button 1) for panning
    if (e.button === 1) {
      this.panningStart = { x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
      e.preventDefault();
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Check if clicking on a port
    const port = this.getPortAtPosition(screenX, screenY);
    if (port) {
      this.connectingFrom = port;
      return;
    }

    // Check if clicking on a node
    const node = this.getNodeAtPosition(screenX, screenY);
    if (node) {
      this.selectedNode = node;
      this.draggingNode = node;
      this.dragStartX = screenX;
      this.dragStartY = screenY;
      
      // Notify about node selection
      if (this.onNodeSelected) {
        this.onNodeSelected(node);
      }
      
      return;
    }

    // Deselect
    this.selectedNode = null;
    this.draw();
  }

  /**
   * Mouse move handler
   */
  onMouseMove(e) {
    // Handle middle-mouse panning
    if (this.panningStart) {
      const deltaX = e.clientX - this.panningStart.x;
      const deltaY = e.clientY - this.panningStart.y;
      
      this.panX = this.panningStart.panX + deltaX;
      this.panY = this.panningStart.panY + deltaY;
      
      this.draw();
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (this.draggingNode) {
      const dx = (screenX - this.dragStartX) / this.zoom;
      const dy = (screenY - this.dragStartY) / this.zoom;

      this.draggingNode.x += dx;
      this.draggingNode.y += dy;

      this.dragStartX = screenX;
      this.dragStartY = screenY;

      this.draw();
    }

    this.draw();
  }

  /**
   * Mouse up handler
   */
  onMouseUp(e) {
    this.panningStart = null;
    this.draggingNode = null;

    // Complete connection if we were connecting
    if (this.connectingFrom) {
      const rect = this.canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      
      const port = this.getPortAtPosition(screenX, screenY);
      if (port && this.isValidConnection(this.connectingFrom, port)) {
        // Emit event for connection
        if (this.onConnectionCreated) {
          this.onConnectionCreated(this.connectingFrom, port);
        }
      }
      this.connectingFrom = null;
    }

    this.draw();
  }

  /**
   * Mouse leave handler
   */
  onMouseLeave(e) {
    this.draggingNode = null;
    this.connectingFrom = null;
    this.panningStart = null;
  }

  /**
   * Wheel handler for zoom
   */
  onWheel(e) {
    e.preventDefault();

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = this.zoom * zoomFactor;

    // Clamp zoom level
    this.zoom = Math.max(0.5, Math.min(3, newZoom));

    this.draw();
  }

  /**
   * Check if two ports can connect
   */
  isValidConnection(fromPort, toPort) {
    // Can't connect same port
    if (fromPort.node.id === toPort.node.id && fromPort.portId === toPort.portId) {
      return false;
    }

    // Both must be different directions
    if (fromPort.isInput === toPort.isInput) {
      return false;
    }

    // Ensure output connects to input
    const output = fromPort.isInput ? toPort : fromPort;
    const input = fromPort.isInput ? fromPort : toPort;

    // Check for existing connection
    for (const conn of this.connections) {
      if (
        conn.from.nodeId === output.node.id && conn.from.portId === output.portId &&
        conn.to.nodeId === input.node.id && conn.to.portId === input.portId
      ) {
        return false;  // Already connected
      }
    }

    return true;
  }

  /**
   * Draw the entire canvas
   */
  draw() {
    if (!this.ctx) {
      console.error('[Canvas] No context available');
      return;
    }

    // CRITICAL: Clear the entire canvas first, without any transformations
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.fillStyle = this.colors.background;
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Draw grid (before transformations, in screen space)
    this.drawGrid();

    this.ctx.save();

    // Apply transformations
    this.ctx.translate(this.panX, this.panY);
    this.ctx.scale(this.zoom, this.zoom);

    // Draw connections first (so they appear behind nodes)
    this.drawConnections();

    // Draw connection in progress
    if (this.connectingFrom) {
      this.drawConnectionInProgress();
    }

    // Draw nodes
    if (this.nodes.size > 0) {
      for (const node of this.nodes.values()) {
        this.drawNode(node);
      }
    }

    this.ctx.restore();
  }

  /**
   * Draw grid background
   */
  drawGrid() {
    this.ctx.strokeStyle = this.colors.gridLine;
    this.ctx.lineWidth = 0.5;

    const gridSize = 50;
    for (let x = 0; x < this.width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.height);
      this.ctx.stroke();
    }

    for (let y = 0; y < this.height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.width, y);
      this.ctx.stroke();
    }
  }

  /**
   * Draw all nodes
   */
  drawNodes() {
    for (const node of this.nodes.values()) {
      this.drawNode(node);
    }
  }

  /**
   * Draw a single node
   */
  drawNode(node) {
    const { x, y, width, height, label, inputs, outputs } = node;
    const isSelected = this.selectedNode === node;

    // Draw node background
    this.ctx.fillStyle = isSelected ? this.colors.nodeSelected : this.colors.node;
    this.ctx.fillRect(x - width / 2, y - height / 2, width, height);

    // Draw border
    this.ctx.strokeStyle = isSelected ? this.colors.nodeSelected : this.colors.text;
    this.ctx.lineWidth = isSelected ? 3 : 1;
    this.ctx.strokeRect(x - width / 2, y - height / 2, width, height);

    // Draw label
    this.ctx.fillStyle = this.colors.text;
    this.ctx.font = '12px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(label, x, y - 10);

    // Draw input ports
    for (let i = 0; i < inputs.length; i++) {
      const portY = y - (inputs.length - 1) * 15 / 2 + i * 15;
      this.drawPort(x - width / 2, portY, inputs[i], true);
    }

    // Draw output ports
    for (let i = 0; i < outputs.length; i++) {
      const portY = y - (outputs.length - 1) * 15 / 2 + i * 15;
      this.drawPort(x + width / 2, portY, outputs[i], false);
    }
  }

  /**
   * Draw a port
   */
  drawPort(x, y, portId, isInput) {
    this.ctx.fillStyle = this.colors.port;
    this.ctx.beginPath();
    this.ctx.arc(x, y, this.portRadius, 0, Math.PI * 2);
    this.ctx.fill();

    // Draw port label
    this.ctx.fillStyle = this.colors.text;
    this.ctx.font = '10px monospace';
    this.ctx.textAlign = isInput ? 'right' : 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(portId, isInput ? x - 12 : x + 12, y);
  }

  /**
   * Draw all connections
   */
  drawConnections() {
    for (const conn of this.connections) {
      this.drawConnection(conn);
    }
  }

  /**
   * Draw a single connection
   */
  drawConnection(conn) {
    const fromNode = this.nodes.get(conn.from.nodeId);
    const toNode = this.nodes.get(conn.to.nodeId);

    if (!fromNode || !toNode) return;

    // Find port positions
    const fromPortY = this.getPortY(fromNode, conn.from.portId);
    const toPortY = this.getPortY(toNode, conn.to.portId);

    const fromX = fromNode.x + fromNode.width / 2;
    const fromY = fromNode.y + fromPortY;
    const toX = toNode.x - toNode.width / 2;
    const toY = toNode.y + toPortY;

    // Draw curved line
    this.ctx.strokeStyle = this.colors.connection;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(fromX, fromY);

    const controlX = (fromX + toX) / 2;
    this.ctx.bezierCurveTo(controlX, fromY, controlX, toY, toX, toY);
    this.ctx.stroke();
  }

  /**
   * Draw connection being created
   */
  drawConnectionInProgress() {
    if (!this.connectingFrom) return;

    const fromNode = this.connectingFrom.node;
    const portY = this.getPortY(fromNode, this.connectingFrom.portId);

    const fromX = this.connectingFrom.isInput
      ? fromNode.x - fromNode.width / 2
      : fromNode.x + fromNode.width / 2;
    const fromY = fromNode.y + portY;

    // Draw to mouse position (approximate in viewport space)
    this.ctx.strokeStyle = this.colors.connectionValid;
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 5]);
    this.ctx.beginPath();
    this.ctx.moveTo(fromX, fromY);
    this.ctx.lineTo(fromX + 200, fromY);  // Draw preview line
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  /**
   * Get Y offset of port within node
   */
  getPortY(node, portId) {
    const allPorts = [...node.inputs, ...node.outputs];
    const portIndex = allPorts.indexOf(portId);
    if (portIndex === -1) return 0;

    const isInput = node.inputs.includes(portId);
    const portList = isInput ? node.inputs : node.outputs;
    return (portIndex - (portList.length - 1) / 2) * 15;
  }

  /**
   * Export canvas to pipeline definition
   */
  exportPipeline(name = 'Pipeline') {
    const nodes = [];
    for (const node of this.nodes.values()) {
      nodes.push({
        id: node.id,
        type: node.type,
        ports: [
          ...node.inputs.map(id => ({ id, name: id, direction: 'in' })),
          ...node.outputs.map(id => ({ id, name: id, direction: 'out' })),
        ],
      });
    }

    const connections = Array.from(this.connections).map(conn => ({
      from: conn.from,
      to: conn.to,
    }));

    return {
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      description: '',
      nodes,
      connections,
      metadata: { version: '2.0' },
    };
  }
}

// Export
if (typeof window !== 'undefined') {
  window.PipelineCanvas = PipelineCanvas;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PipelineCanvas };
}
