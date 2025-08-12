// viewer-plugins.js
// Registry for all viewer plugins

// Initialize the viewer plugins registry
window.ViewerPlugins = {};

// Register built-in viewers
window.ViewerPlugins.mod = ModViewer;
window.ViewerPlugins.wav = WavViewer;

// Check if HexViewer is available before registering
if (typeof HexViewer !== 'undefined') {
  window.ViewerPlugins.hex = HexViewer; // Fallback for any file type
  console.log('[ViewerPlugins] HexViewer registered successfully');
} else {
  console.error('[ViewerPlugins] HexViewer class not found!');
}

// Plugin registration system for future extensibility
window.ViewerPlugins.register = function(type, viewerClass) {
  if (typeof viewerClass !== 'function') {
    throw new Error('Viewer must be a constructor function');
  }
  
  window.ViewerPlugins[type] = viewerClass;
  console.log(`[ViewerPlugins] Registered viewer for type: ${type}`);
};

window.ViewerPlugins.unregister = function(type) {
  if (window.ViewerPlugins[type]) {
    delete window.ViewerPlugins[type];
    console.log(`[ViewerPlugins] Unregistered viewer for type: ${type}`);
  }
};

window.ViewerPlugins.getAvailableTypes = function() {
  return Object.keys(window.ViewerPlugins).filter(key => 
    typeof window.ViewerPlugins[key] === 'function'
  );
};

console.log('[ViewerPlugins] Initialized with types:', window.ViewerPlugins.getAvailableTypes());
