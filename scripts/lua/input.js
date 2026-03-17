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

  _refreshInputManager() {
    if (this.gameEmulator && this.gameEmulator.inputManager) {
      this.inputManager = this.gameEmulator.inputManager;
    }
  }

  _requireInputManager(methodName) {
    this._refreshInputManager();
    if (!this.inputManager) {
      throw new Error(`[Input] ${methodName} requires an available input manager`);
    }
    return this.inputManager;
  }

  _requireIntegerArg(args, index, methodName, argName) {
    const raw = args[index] ?? this.luaState?.raw_tostring?.(index + 2);
    if (raw === undefined || raw === null || raw === '') {
      throw new Error(`[Input] ${methodName} missing required argument: ${argName}`);
    }

    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value)) {
      throw new Error(`[Input] ${methodName} invalid integer argument ${argName}: ${raw}`);
    }
    return value;
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
    return this._requireInputManager('GetKeysHeld').getKeysHeld();
  }

  /**
   * Get keys pressed this frame (bit array)
   * Lua usage: Input.GetKeysPressed()
   */
  GetKeysPressed() {
    return this._requireInputManager('GetKeysPressed').getKeysPressed();
  }

  /**
   * Get keys released this frame (bit array)
   * Lua usage: Input.GetKeysReleased()
   */
  GetKeysReleased() {
    return this._requireInputManager('GetKeysReleased').getKeysReleased();
  }

  /**
   * Check if a specific key is held
   * Lua usage: Input.IsKeyHeld(Input.Buttons.A)
   */
  IsKeyHeld(...args) {
    const keyMask = this._requireIntegerArg(args, 0, 'IsKeyHeld', 'keyMask');
    return this._requireInputManager('IsKeyHeld').isKeyHeld(keyMask);
  }

  /**
   * Check if a specific key was pressed this frame
   * Lua usage: Input.IsKeyPressed(Input.Buttons.A)
   */
  IsKeyPressed(...args) {
    const keyMask = this._requireIntegerArg(args, 0, 'IsKeyPressed', 'keyMask');
    return this._requireInputManager('IsKeyPressed').isKeyPressed(keyMask);
  }

  /**
   * Check if a specific key was released this frame
   * Lua usage: Input.IsKeyReleased(Input.Buttons.A)
   */
  IsKeyReleased(...args) {
    const keyMask = this._requireIntegerArg(args, 0, 'IsKeyReleased', 'keyMask');
    return this._requireInputManager('IsKeyReleased').isKeyReleased(keyMask);
  }
}

// Make the class available globally
window.LuaInputExtensions = LuaInputExtensions;
