# Level-Based Resource Manager Upgrade

## Overview
The resource manager has been completely redesigned around two key concepts:
1. **Levels** - Collections of named resources mapped to file paths
2. **Loaders** - Pluggable interfaces for handling different file types

## Key Features

### 1. Level-Based Loading
Resources are now organized into levels, which define what should be loaded together:

```javascript
const level = {
  resources: {
    "menuMusic": "demomods/jesper_kyd_-_nightfall.mod",
    "buttonSound": "demomods/sound-of-da-lunatic.mod",
    "playerSprite": "Resources/Textures/player.d2"
  }
};

await resourceManager.loadLevel(level);
```

**Benefits:**
- ✅ Clear organization of what resources belong together
- ✅ Automatic loading of needed resources
- ✅ Automatic unloading of unused resources
- ✅ Memory management handled automatically

### 2. Pluggable Loader System
The resource manager is completely agnostic about file types. All loading logic is handled by pluggable loaders:

```javascript
class MyResourceLoader {
  GetFileExtensions() {
    return ['.myformat', '.custom'];
  }
  
  async Load(file, resourceId) {
    // Load file into your system
    // resourceId is an integer assigned by resource manager
  }
  
  Unload(resourceId) {
    // Unload resource by integer ID
  }
}

resourceManager.registerLoader('myLoader', new MyResourceLoader());
```

**Benefits:**
- ✅ Complete separation of concerns
- ✅ Resource manager doesn't know about file formats
- ✅ Easy to add new file types
- ✅ Consistent interface across all loaders

### 3. Integer Resource IDs
Resources are assigned integer IDs internally, providing:
- ✅ Efficient lookups
- ✅ Consistent identification across loaders
- ✅ No confusion with file paths or names

## API Changes

### Resource Manager
```javascript
// OLD: Individual resource loading by string ID
const resource = await resourceManager.loadResource("SFX.COOL");

// NEW: Level-based loading
await resourceManager.loadLevel({
  resources: {
    "coolSound": "path/to/cool.wav"
  }
});
const resource = resourceManager.getResource("coolSound");
```

### SFX Extension (Lua)
```lua
-- OLD: Used TYPE.NAME format
SFX.Play("SFX.COOL")

-- NEW: Uses resource names from level
SFX.Play("coolSound")
```

### Loaders
```javascript
// Audio Loader
class AudioResourceLoader {
  GetFileExtensions() { return ['.wav', '.mod', '.xm']; }
  async Load(file, resourceId) { /* load into audio engine */ }
  Unload(resourceId) { /* remove from audio engine */ }
}

// Texture Loader
class TextureResourceLoader {
  GetFileExtensions() { return ['.d2', '.png', '.jpg']; }
  async Load(file, resourceId) { /* load into graphics system */ }
  Unload(resourceId) { /* remove from graphics system */ }
}
```

## Implementation Details

### 1. Unified Resource Manager
- **Single entry point** for all resource operations
- **Level management** with automatic load/unload
- **Loader registry** for different file types
- **Integer ID assignment** for consistent resource identification

### 2. Resource Loaders
- **AudioResourceLoader** - Handles audio files (WAV, MOD, etc.)
- **TextureResourceLoader** - Handles texture files (D2, PNG, etc.)
- **Extensible** - Easy to add new loaders for new file types

### 3. Game Emulator Integration
- **Automatic loader registration** during initialization
- **Level loading API** exposed to game logic
- **Resource access** through resource names

## Migration Benefits

### Before (Legacy System)
```javascript
// Complex, multiple systems
const resourceId = await gameEmulator.loadAudioFileOnDemand(filename);
const resource = gameEmulator.GetResource("SFX.COOL");
if (!resource.isPreloaded) {
  // Complex fallback logic
}
```

### After (Level-Based System)
```javascript
// Simple, unified approach
await gameEmulator.loadLevel(levelDefinition);
// All resources are now loaded and ready to use
const resource = resourceManager.getResource("coolSound");
```

## File Organization

### Level Definitions
```
levels/
  menu-level.json       - Main menu resources
  game-level-1.json     - First game level
  game-level-2.json     - Second game level
```

### Loaders
```
scripts/audio/audio-resource-loader.js      - Audio file handling
scripts/graphics/texture-resource-loader.js - Texture file handling
```

### Core System
```
scripts/game-emulator/unified-resource-manager.js - Main resource manager
scripts/game-emulator/game-emulator.js            - Integration layer
```

## Performance Improvements

1. **Predictable Loading** - No more complex file searching
2. **Batch Operations** - Load/unload resources as groups
3. **Memory Management** - Automatic cleanup of unused resources
4. **Efficient Lookups** - Integer-based resource identification

## Usage Examples

### Loading a Game Level
```javascript
const gameLevel = {
  resources: {
    "backgroundMusic": "music/level1.mod",
    "playerSprite": "sprites/player.d2",
    "enemySprite": "sprites/enemy.d2",
    "explosionSound": "sfx/explosion.wav"
  }
};

await gameEmulator.loadLevel(gameLevel);
```

### Playing Audio in Lua
```lua
-- Resource must be loaded in current level
SFX.Play("explosionSound")
```

### Accessing Textures
```javascript
const playerResource = resourceManager.getResource("playerSprite");
const textureId = gameEmulator.textureResourceLoader.getTextureId(playerResource.id);
```

## Testing

The system includes comprehensive testing through `test-level-resource-manager.html`:
- ✅ Level loading/unloading
- ✅ Resource enumeration
- ✅ Audio playback testing
- ✅ Performance benchmarking
- ✅ Loader information display

## Conclusion

The new level-based resource management system provides:
- **Simplified API** - One way to load resources
- **Better Organization** - Resources grouped by usage
- **Extensibility** - Easy to add new file types
- **Performance** - Efficient loading and memory management
- **Maintainability** - Clear separation of concerns

This replaces the complex legacy system with a clean, efficient, and extensible approach to resource management.
