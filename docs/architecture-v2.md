# RetroStudio Architecture v2.0

## Overview

This document describes the new architecture introduced to improve RetroStudio's maintainability, extensibility, and developer experience.

## Core Systems

### 1. Service Container (`scripts/core/service-container.js`)

**Purpose:** Dependency injection and service management

**Features:**
- Singleton and transient service registration
- Automatic dependency resolution
- Service lifecycle management
- Circular dependency detection

**Usage:**
```javascript
// Register a service
serviceContainer.registerService('myService', MyServiceClass, ['dependency1', 'dependency2']);

// Get a service
const myService = serviceContainer.get('myService');

// Register singleton
serviceContainer.registerSingleton('config', configInstance);
```

### 2. Event Bus (`scripts/core/event-bus.js`)

**Purpose:** Decoupled communication between components

**Features:**
- Typed events with schema validation
- Event middleware support
- Priority-based event handling
- Debug logging and profiling

**Usage:**
```javascript
// Register event type
eventBus.registerEventType('file.opened', {
  path: 'string',
  type: 'string'
});

// Emit event
eventBus.emit('file.opened', { path: '/project/script.lua', type: 'editor' });

// Listen to event
eventBus.on('file.opened', (data) => {
  console.log(`File opened: ${data.path}`);
});
```

### 3. Configuration Manager (`scripts/core/config-manager.js`)

**Purpose:** Centralized configuration management

**Features:**
- Schema validation
- Configuration watchers
- Persistent storage
- Environment-specific configs

**Usage:**
```javascript
// Set schema
configManager.setSchema('editor', {
  type: 'object',
  properties: {
    fontSize: { type: 'number', default: 14 },
    theme: { type: 'string', default: 'dark' }
  }
});

// Get/set configuration
const fontSize = configManager.get('editor.fontSize');
configManager.set('editor.fontSize', 16);

// Watch for changes
configManager.watch('editor.fontSize', (newValue, oldValue) => {
  console.log(`Font size changed: ${oldValue} -> ${newValue}`);
});
```

### 4. Plugin System (`scripts/core/plugin-system.js`)

**Purpose:** Extensible plugin architecture

**Features:**
- Hook-based extensibility
- Middleware pipelines
- Plugin dependencies
- Dynamic loading

**Usage:**
```javascript
// Register hook
pluginSystem.registerHook('file.beforeOpen');

// Add hook handler
pluginSystem.addHook('file.beforeOpen', async (context) => {
  // Pre-process file
  return context;
});

// Run hook
await pluginSystem.runHook('file.beforeOpen', { filePath: '/script.lua' });
```

### 5. Component Registry (`scripts/core/component-registry.js`)

**Purpose:** Unified registration for editors and viewers

**Features:**
- File association by extension
- Component capabilities
- Priority-based selection
- Validation and metadata

**Usage:**
```javascript
// Register editor
componentRegistry.registerEditor({
  name: 'lua-editor',
  extensions: ['.lua'],
  displayName: 'Lua Script',
  editorClass: LuaEditor,
  capabilities: ['syntax-highlighting', 'auto-completion']
});

// Get editor for file
const editor = componentRegistry.getEditorForFile('/script.lua');
```

## Migration from Legacy Architecture

### Before (Legacy)
```javascript
// Direct global access
window.gameEditor = new GameEditor();
window.tabManager = new TabManager();
window.buildSystem = new BuildSystem();

// Direct coupling
class GameEditor {
  constructor() {
    this.tabManager = window.tabManager;
    this.buildSystem = window.buildSystem;
  }
}
```

### After (New Architecture)
```javascript
// Service registration
serviceContainer.registerService('gameEditor', GameEditor);
serviceContainer.registerService('tabManager', TabManager);
serviceContainer.registerService('buildSystem', BuildSystem);

// Dependency injection
class GameEditor {
  constructor(tabManager, buildSystem) {
    this.tabManager = tabManager;
    this.buildSystem = buildSystem;
  }
}
```

## Application Lifecycle

### 1. Core Initialization (`scripts/core/core-init.js`)
- Initialize service container
- Set up event bus
- Load configuration schemas
- Set default configurations

### 2. Application Bootstrap (`scripts/core/application.js`)
- Register services
- Initialize components
- Set up plugins
- Connect event handlers
- Start main systems

### 3. Service Adapters (`scripts/core/service-adapters.js`)
- Integrate legacy services with new architecture
- Maintain backward compatibility
- Add enhanced functionality

## Adding New Components

### Creating a New Editor

1. Create editor class extending `EditorBase`:
```javascript
class MyEditor extends EditorBase {
  constructor() {
    super();
  }
  
  setContent(content) {
    // Implementation
  }
  
  getContent() {
    // Implementation
  }
}
```

2. Register in application initialization:
```javascript
componentRegistry.registerEditor({
  name: 'my-editor',
  extensions: ['.myext'],
  displayName: 'My File Editor',
  editorClass: MyEditor,
  capabilities: ['syntax-highlighting']
});
```

### Creating a New Plugin

1. Create plugin with hooks:
```javascript
class MyPlugin {
  static install(pluginSystem) {
    pluginSystem.addHook('file.beforeOpen', this.preprocessFile);
    pluginSystem.addHook('build.afterComplete', this.postBuild);
  }
  
  static async preprocessFile(context) {
    // Plugin logic
    return context;
  }
}
```

2. Install plugin:
```javascript
pluginSystem.installPlugin(MyPlugin);
```

## Configuration Schemas

### Application Configuration
- `application.theme`: UI theme ('dark', 'light')
- `application.autoSave`: Enable auto-save
- `application.debugMode`: Enable debug logging

### Editor Configuration
- `editor.fontSize`: Font size for editors
- `editor.wordWrap`: Enable word wrapping
- `editor.showLineNumbers`: Show line numbers

### Build Configuration
- `build.outputFormat`: Target format ('pico8', 'tic80')
- `build.optimizeOutput`: Enable optimization
- `build.compressionLevel`: Compression level (1-9)

## Event Types

### File Events
- `file.opened`: When a file is opened
- `file.saved`: When a file is saved
- `file.closed`: When a file is closed

### Tab Events
- `tab.switched`: When active tab changes
- `tab.created`: When new tab is created
- `tab.closed`: When tab is closed

### Build Events
- `build.started`: When build process starts
- `build.completed`: When build completes successfully
- `build.failed`: When build fails

## Best Practices

### 1. Use Dependency Injection
- Register services in the service container
- Inject dependencies through constructor
- Avoid direct global access

### 2. Communicate via Events
- Use event bus for loose coupling
- Define typed events with schemas
- Add middleware for cross-cutting concerns

### 3. Centralize Configuration
- Use configuration manager for all settings
- Define schemas for validation
- Watch for configuration changes

### 4. Extend via Plugins
- Use hooks for extensibility points
- Create middleware for processing pipelines
- Register plugins in application bootstrap

### 5. Register Components
- Use component registry for editors/viewers
- Define file associations and capabilities
- Implement proper validation

## Backward Compatibility

The new architecture maintains backward compatibility through:

1. **Service Adapters**: Bridge legacy services with new systems
2. **Global Access**: Legacy `window.*` access still works
3. **Gradual Migration**: Components can be migrated incrementally

## Performance Considerations

- **Lazy Loading**: Services are created on-demand
- **Event Batching**: Events can be batched for performance
- **Caching**: Component lookups are cached
- **Memory Management**: Proper cleanup in service lifecycle

## Debugging and Diagnostics

- **Debug Mode**: Enable via `application.debugMode`
- **Event Logging**: Track event flow in debug mode
- **Service Inspector**: View registered services and dependencies
- **Performance Metrics**: Monitor event timing and service creation
