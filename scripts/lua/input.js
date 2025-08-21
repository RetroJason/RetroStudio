/**
 * Input Lua Extension
 * Provides keyboard input functionality using GameInputManager
 */
class LuaInputExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
    this.inputManager = null;
  }

  /**
   * Initialize the Input extension
   * @param {Object} luaState - The Lua execution state
   */
  async initialize(luaState) {
    this.setLuaState(luaState);
    
    // Get input manager from game emulator
    this.inputManager = this.gameEmulator.inputManager;
    
    // Create Input.Buttons constants in Lua
    luaState.execute(`
      -- Input namespace
      Input = Input or {}
      
      -- Button constants (bit masks)
      Keys = {
        None   = 0x0000,
        B      = 0x0001,  -- Z key
        Y      = 0x0002,  -- A key  
        Select = 0x0004,  -- Space key
        Start  = 0x0008,  -- Enter key
        Up     = 0x0010,  -- Arrow Up
        Down   = 0x0020,  -- Arrow Down
        Left   = 0x0040,  -- Arrow Left
        Right  = 0x0080,  -- Arrow Right
        A      = 0x0100,  -- X key
        X      = 0x0200,  -- S key
        L      = 0x0400,  -- Left Shift
        R      = 0x0800   -- Right Shift
      }
      

    `);
  }

  /**
   * Reset the input manager reference (called on project reload)
   */
  reset() {
    this.inputManager = null;
  }

  /**
   * Get keys currently held (bit array)
   * Lua usage: Input.GetKeysHeld()
   */
  GetKeysHeld() {
    // Dynamically check for input manager (it might not be available during initialization)
    if (!this.inputManager && this.gameEmulator && this.gameEmulator.inputManager) {
      this.inputManager = this.gameEmulator.inputManager;
    }
    
    if (this.inputManager) {
      return this.inputManager.getKeysHeld();
    }
    return 0;
  }

  /**
   * Get keys pressed this frame (bit array)
   * Lua usage: Input.GetKeysPressed()
   */
  GetKeysPressed() {
    // Always get fresh reference to input manager (handles reloads)
    if (this.gameEmulator && this.gameEmulator.inputManager) {
      this.inputManager = this.gameEmulator.inputManager;
    }
    
    if (this.inputManager) {
      return this.inputManager.getKeysPressed();
    }
    return 0;
  }

  /**
   * Get keys released this frame (bit array)
   * Lua usage: Input.GetKeysReleased()
   */
  GetKeysReleased() {
    // Always get fresh reference to input manager (handles reloads)
    if (this.gameEmulator && this.gameEmulator.inputManager) {
      this.inputManager = this.gameEmulator.inputManager;
    }
    
    if (this.inputManager) {
      return this.inputManager.getKeysReleased();
    }
    return 0;
  }

  /**
   * Check if a specific key is held
   * Lua usage: Input.IsKeyHeld(Input.Buttons.A)
   */
  IsKeyHeld() {
    // Get the key mask from the first Lua argument
    const keyMask = parseInt(this.luaState.raw_tostring(2) || 0);
    
    // Always get fresh reference to input manager (handles reloads)
    if (this.gameEmulator && this.gameEmulator.inputManager) {
      this.inputManager = this.gameEmulator.inputManager;
    }
    
    if (this.inputManager) {
      return this.inputManager.isKeyHeld(keyMask);
    }
    return false;
  }

  /**
   * Check if a specific key was pressed this frame
   * Lua usage: Input.IsKeyPressed(Input.Buttons.A)
   */
  IsKeyPressed() {
    // Get the key mask from the first Lua argument
    const keyMask = parseInt(this.luaState.raw_tostring(2) || 0);
    
    // Always get fresh reference to input manager (handles reloads)
    if (this.gameEmulator && this.gameEmulator.inputManager) {
      this.inputManager = this.gameEmulator.inputManager;
    }
    
    if (this.inputManager) {
      return this.inputManager.isKeyPressed(keyMask);
    }
    return false;
  }

  /**
   * Check if a specific key was released this frame
   * Lua usage: Input.IsKeyReleased(Input.Buttons.A)
   */
  IsKeyReleased() {
    // Get the key mask from the first Lua argument
    const keyMask = parseInt(this.luaState.raw_tostring(2) || 0);
    
    // Always get fresh reference to input manager (handles reloads)
    if (this.gameEmulator && this.gameEmulator.inputManager) {
      this.inputManager = this.gameEmulator.inputManager;
    }
    
    if (this.inputManager) {
      return this.inputManager.isKeyReleased(keyMask);
    }
    return false;
  }
}

// Make the class available globally
window.LuaInputExtensions = LuaInputExtensions;
