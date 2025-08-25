# RetroStudio Component Architecture Guide

This document explains how to create, register, and integrate new components (editors, viewers, and builders) into the RetroStudio application.

## Table of Contents

1. [Overview](#overview)
2. [Component Registry System](#component-registry-system)
3. [Creating Editors](#creating-editors)
4. [Creating Viewers](#creating-viewers)
5. [Creating Builders](#creating-builders)
6. [File Type Associations](#file-type-associations)
7. [Dynamic Loading](#dynamic-loading)
8. [Common Patterns](#common-patterns)
9. [Troubleshooting](#troubleshooting)

## Overview

RetroStudio uses a component-based architecture with dynamic loading and automatic registration. All components (editors, viewers, builders) are registered through the `ComponentRegistry` system and loaded dynamically at application startup.

### Key Principles

- **Dynamic Loading**: Components are loaded via script injection at runtime
- **Auto-Registration**: Components register themselves when loaded
- **File Type Associations**: Components declare which file types they handle
- **Service Dependencies**: Components can access application services
- **Event-Driven**: Components communicate via the event bus

## Component Registry System

The `ComponentRegistry` class (located in `scripts/core/component-registry.js`) manages all component registration and discovery.

### Registry Methods

```javascript
// Register a component
ComponentRegistry.register(type, componentClass);

// Get components by type
ComponentRegistry.getComponents('editor');
ComponentRegistry.getComponents('viewer');
ComponentRegistry.getComponents('builder');

// Find component for file type
ComponentRegistry.findViewerForFile('texture.png');
ComponentRegistry.findEditorForFile('script.lua');
```

## Creating Editors

Editors allow users to modify files and must extend `EditorBase`.

### 1. Create Editor Class

```javascript
// scripts/editors/my-editor.js
class MyEditor extends EditorBase {
  constructor() {
    super();
    this.fileExtensions = ['.myext'];
    this.displayName = 'My File Editor';
    this.description = 'Editor for .myext files';
  }

  // Required: Create the editor UI
  async createEditor(container, file, content) {
    this.container = container;
    this.file = file;
    
    // Create your editor UI here
    const editorElement = document.createElement('div');
    editorElement.className = 'my-editor';
    container.appendChild(editorElement);
    
    // Load content
    await this.loadContent(content);
    
    return editorElement;
  }

  // Required: Get current content for saving
  getContent() {
    // Return the current state as string/binary data
    return this.currentContent;
  }

  // Required: Load content into editor
  async loadContent(content) {
    this.currentContent = content;
    // Update UI with content
  }

  // Optional: Cleanup resources
  dispose() {
    super.dispose();
    // Clean up any resources
  }

  // Optional: Handle save operations
  async save() {
    const content = this.getContent();
    // Perform save logic
    return content;
  }

  // Optional: Check if content has been modified
  isDirty() {
    return this.hasUnsavedChanges;
  }
}

// Register the editor
ComponentRegistry.register('editor', MyEditor);
```

### 2. Add to Dynamic Loading

Add your editor script to `scripts/core/application.js`:

```javascript
async loadComponentScripts() {
  const componentScripts = [
    // Editors
    'scripts/editors/lua-editor.js',
    'scripts/editors/my-editor.js',  // Add your editor here
    // ... other scripts
  ];
}
```

## Creating Viewers

Viewers display file content in read-only mode and must extend `ViewerBase`.

### 1. Create Viewer Class

```javascript
// scripts/viewers/my-viewer.js
class MyViewer extends ViewerBase {
  constructor() {
    super();
    this.fileExtensions = ['.myext'];
    this.displayName = 'My File Viewer';
    this.description = 'Viewer for .myext files';
  }

  // Required: Check if viewer can handle this file
  canHandle(fileExtension, mimeType) {
    return this.fileExtensions.includes(fileExtension.toLowerCase());
  }

  // Required: Create the viewer UI
  async createViewer(container, file, content) {
    this.container = container;
    this.file = file;
    
    // Create viewer UI
    const viewerElement = document.createElement('div');
    viewerElement.className = 'my-viewer';
    
    // Render content
    await this.renderContent(content);
    
    container.appendChild(viewerElement);
    return viewerElement;
  }

  // Required: Render content in viewer
  async renderContent(content) {
    // Parse and display the content
  }

  // Optional: Cleanup resources
  dispose() {
    super.dispose();
    // Clean up resources
  }

  // Optional: Refresh content
  async refresh(newContent) {
    await this.renderContent(newContent);
  }
}

// Register the viewer
ComponentRegistry.register('viewer', MyViewer);
```

### 2. Add to Dynamic Loading

Add your viewer script to `scripts/core/application.js`:

```javascript
async loadComponentScripts() {
  const componentScripts = [
    // ... editors
    // Viewers
    'scripts/viewers/mod-viewer.js',
    'scripts/viewers/my-viewer.js',  // Add your viewer here
    'scripts/viewers/viewer-plugins.js'
  ];
}
```

## Creating Builders

Builders process source files into game assets and must implement the `Buildable` interface.

### 1. Create Builder Class

```javascript
// scripts/build/my-builder.js
class MyBuilder {
  constructor() {
    this.inputExtensions = ['.mysource'];
    this.outputExtension = '.myasset';
    this.builderName = 'My Asset Builder';
    this.description = 'Converts .mysource files to .myasset format';
  }

  // Required: Check if builder can handle this file
  canBuild(filePath) {
    const ext = this.getFileExtension(filePath);
    return this.inputExtensions.includes(ext);
  }

  // Required: Build the file
  async build(inputFile, outputPath, options = {}) {
    try {
      console.log(`[MyBuilder] Building ${inputFile.name}...`);
      
      // Get source content
      const sourceContent = inputFile.content;
      
      // Process content (your conversion logic here)
      const processedContent = await this.processContent(sourceContent);
      
      // Generate output filename
      const outputFileName = this.generateOutputFileName(inputFile.name);
      const fullOutputPath = `${outputPath}/${outputFileName}`;
      
      // Create output file
      const outputFile = {
        name: outputFileName,
        path: fullOutputPath,
        content: processedContent,
        mimeType: 'application/octet-stream'
      };
      
      console.log(`[MyBuilder] Built ${outputFileName}`);
      return outputFile;
      
    } catch (error) {
      console.error(`[MyBuilder] Build failed:`, error);
      throw error;
    }
  }

  // Process source content into target format
  async processContent(sourceContent) {
    // Your conversion logic here
    return new Uint8Array(sourceContent);
  }

  // Generate output filename
  generateOutputFileName(inputName) {
    const baseName = inputName.replace(/\.[^.]+$/, '');
    return `${baseName}${this.outputExtension}`;
  }

  // Helper to get file extension
  getFileExtension(filePath) {
    return filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  }
}

// Register the builder
ComponentRegistry.register('builder', MyBuilder);
```

### 2. Add to Build System

Add your builder to `scripts/build-system.js`:

```javascript
// The build system will automatically discover registered builders
// No additional registration needed beyond ComponentRegistry.register()
```

## File Type Associations

File type associations are handled automatically based on the `fileExtensions` property of components.

### Extension Matching

```javascript
class MyComponent extends ViewerBase {
  constructor() {
    super();
    // Define which file extensions this component handles
    this.fileExtensions = ['.txt', '.md', '.log'];
  }

  canHandle(fileExtension, mimeType) {
    // Custom logic for file type detection
    return this.fileExtensions.includes(fileExtension.toLowerCase()) ||
           mimeType === 'text/plain';
  }
}
```

### MIME Type Support

```javascript
canHandle(fileExtension, mimeType) {
  // Check both extension and MIME type
  const extensionMatch = this.fileExtensions.includes(fileExtension.toLowerCase());
  const mimeMatch = this.supportedMimeTypes.includes(mimeType);
  return extensionMatch || mimeMatch;
}
```

## Dynamic Loading

The application loads components dynamically during startup via `scripts/core/application.js`.

### Loading Order

1. **Core Systems**: Service container, event bus, configuration
2. **Component Registry**: Central registration system
3. **Component Scripts**: Editors, viewers, builders loaded sequentially
4. **Auto-Registration**: Components register themselves when loaded

### Script Loading Configuration

```javascript
// scripts/core/application.js
async loadComponentScripts() {
  const componentScripts = [
    // Editors (load first)
    'scripts/editors/lua-editor.js',
    'scripts/editors/sound-fx-editor.js',
    'scripts/editors/palette-editor.js',
    'scripts/editors/mod-xm-tracker-editor.js',
    'scripts/editors/texture-editor.js',
    'scripts/editors/editor-registry.js',
    
    // Viewers (load after editors)
    'scripts/viewers/mod-viewer.js',
    'scripts/viewers/wav-viewer.js',
    'scripts/viewers/hex-viewer.js',
    'scripts/viewers/simple-image-viewer.js',
    'scripts/viewers/simple-text-viewer.js',
    'scripts/viewers/d2-image-viewer.js',
    'scripts/viewers/viewer-plugins.js',
    
    // Builders (load after viewers)
    'scripts/builders/palette-builder.js',
    'scripts/builders/texture-builder.js'
  ];

  // Load scripts sequentially to maintain dependency order
  for (const scriptPath of componentScripts) {
    await this.loadScript(scriptPath);
  }
}
```

## Common Patterns

### Service Access

```javascript
class MyComponent extends ViewerBase {
  constructor() {
    super();
    // Access application services
    this.fileService = window.serviceContainer.get('fileService');
    this.eventBus = window.eventBus;
  }

  async someMethod() {
    // Use services
    const file = await this.fileService.loadFile('path/to/file');
    this.eventBus.emit('file.processed', { file });
  }
}
```

### Event Communication

```javascript
class MyEditor extends EditorBase {
  constructor() {
    super();
    this.eventBus = window.eventBus;
    
    // Listen for events
    this.eventBus.on('file.changed', this.onFileChanged.bind(this));
  }

  onFileChanged(event) {
    if (event.file === this.file) {
      this.refresh();
    }
  }

  // Emit events
  notifyChange() {
    this.eventBus.emit('editor.contentChanged', {
      editor: this,
      file: this.file
    });
  }
}
```

### Resource Management

```javascript
class MyViewer extends ViewerBase {
  constructor() {
    super();
    this.resources = [];
  }

  async createViewer(container, file, content) {
    // Track resources for cleanup
    const canvas = document.createElement('canvas');
    this.resources.push(canvas);
    
    // Setup viewer
    container.appendChild(canvas);
    return canvas;
  }

  dispose() {
    // Clean up resources
    this.resources.forEach(resource => {
      if (resource.dispose) resource.dispose();
      if (resource.parentNode) resource.parentNode.removeChild(resource);
    });
    this.resources = [];
    super.dispose();
  }
}
```

## Troubleshooting

### Component Not Found

**Problem**: Component isn't being discovered by the system.

**Solutions**:
1. Check that `ComponentRegistry.register()` is called
2. Verify script is added to `loadComponentScripts()` in `application.js`
3. Ensure script loads without errors (check browser console)
4. Confirm component class extends the correct base class

### File Type Not Associated

**Problem**: Files aren't opening with your component.

**Solutions**:
1. Check `fileExtensions` array in component constructor
2. Verify `canHandle()` method logic
3. Test file extension matching (case sensitivity)
4. Check if another component has higher priority

### Build Errors

**Problem**: Builder isn't processing files correctly.

**Solutions**:
1. Verify `canBuild()` method returns true for target files
2. Check build process error handling
3. Ensure output format is correct
4. Test with minimal input files first

### Loading Order Issues

**Problem**: Component depends on another component that isn't loaded yet.

**Solutions**:
1. Adjust order in `loadComponentScripts()` array
2. Use async/await in component initialization
3. Listen for component ready events
4. Defer dependent functionality until all components are loaded

### Memory Leaks

**Problem**: Components consuming too much memory over time.

**Solutions**:
1. Implement proper `dispose()` methods
2. Remove event listeners in cleanup
3. Clear references to DOM elements
4. Monitor resource usage during development

## Example Integration

Here's a complete example of integrating a new D2 texture viewer:

```javascript
// 1. Create the viewer (scripts/viewers/d2-image-viewer.js)
class D2ImageViewer extends ViewerBase {
  constructor() {
    super();
    this.fileExtensions = ['.d2'];
    this.displayName = 'D2 Texture Viewer';
    this.description = 'Viewer for D2 texture format files';
  }

  canHandle(fileExtension, mimeType) {
    return fileExtension.toLowerCase() === '.d2';
  }

  async createViewer(container, file, content) {
    // Implementation details...
  }
}

// Register the viewer
ComponentRegistry.register('viewer', D2ImageViewer);

// 2. Add to application loading (scripts/core/application.js)
async loadComponentScripts() {
  const componentScripts = [
    // ... existing scripts
    'scripts/viewers/d2-image-viewer.js',  // Add here
    'scripts/viewers/viewer-plugins.js'    // Keep this last
  ];
}
```

This pattern ensures proper integration with the RetroStudio architecture and component discovery system.
