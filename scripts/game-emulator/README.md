# Game Emulator Module

This folder contains the game emulator component that provides Lua script execution, debugging console, and key binding management.

## Files

- `game-emulator.js` - Main GameEmulator class with console management, Lua integration, and UI components
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

### Console System

The console uses a centralized `writeToConsole()` method that:
- Maintains a complete message buffer for filtering and downloading
- Applies real-time filtering with advanced syntax (+required -excluded "exact")
- Prevents observer recursion through internal write flags
- Supports bulk updates and individual message appending

### Integration

The GameEmulator integrates with:
- `PanelResizer` for slide-in console management
- Lua.vm.js for script execution
- Project file system for resource loading
- Audio services for sound playback
