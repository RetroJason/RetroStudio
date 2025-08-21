# Game Emulator Module

This folder contains the game emulator component that provides Lua script execution, debugging console, and key binding management.

## Files

- `game-emulator.js` - Main GameEmulator class with console management, Lua integration, and UI components
- `console.js` - **NEW** Modular console component with filtering, downloading, and monitoring
- `game-engine.css` - Styling for the game emulator panel, console, and utility controls
- `README.md` - This documentation file

## Features

- **Lua Script Execution**: Runs Lua scripts using lua.vm.js with game-specific APIs
- **Debug Console**: Advanced console with filtering, downloading, and real-time output capture
- **Key Bindings**: Non-modal popup showing game controls and input mappings
- **File Management**: Handles script loading, project files, and resource management
- **Audio Integration**: Supports MOD files and audio playback through the emulator

## Architecture

The GameEmulator is designed to be modular and accepts a content container on construction rather than hardcoding DOM dependencies. This allows for flexible integration into different UI layouts.

### Console System (NEW)

The new `GameConsole` class (`console.js`) provides a standalone, reusable console component:

**Key Features:**
- **Centralized Output**: All console writes go through `writeToConsole()` method
- **Advanced Filtering**: Supports complex filter syntax (+required -excluded "exact" optional)
- **Message Buffer**: Maintains complete message history for filtering and downloading
- **DOM Monitoring**: Uses MutationObserver to detect external modifications
- **Export Functionality**: Download logs as timestamped text files
- **Configurable Options**: Timestamps, line numbers, auto-scroll, message limits

**API Overview:**
```javascript
const console = new GameConsole({
  showTimestamps: true,
  maxMessages: 5000,
  autoScroll: true
});

console.initialize(containerElement);
console.writeToConsole('Hello World\n');
console.applyFilter('+error -debug');
console.downloadLogs();
```

**CSS Organization:**
All console styling is contained in `game-engine.css` under the "MODULAR CONSOLE COMPONENT STYLES" section, keeping JavaScript files clean of styling concerns.

### Integration

The GameEmulator integrates with:
- `PanelResizer` for slide-in console management
- Lua.vm.js for script execution
- Project file system for resource loading
- Audio services for sound playback

## Migration Path

The modular console (`console.js`) is ready for integration but not yet connected to the main GameEmulator. This allows for:
1. **Testing**: Independent testing of console functionality
2. **Gradual Migration**: Replace existing console code piece by piece
3. **Reusability**: Use the console in other parts of the application
