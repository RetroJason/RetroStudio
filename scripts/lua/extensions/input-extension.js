// input-extension.js
// Lua extension for Input API - provides keyboard input functions to Lua scripts

class InputLuaExtension {
  constructor(gameEmulator) {
    this.gameEmulator = gameEmulator;
    this.name = 'Input';
    console.log('[InputLuaExtension] Initialized');
  }
  
  /**
   * Register Input functions with the Lua state
   * @param {Object} luaState - The Lua state object
   */
  register(luaState) {
    console.log('[InputLuaExtension] Registering Input functions...');
    
    try {
      // Create Input namespace in Lua
      luaState.execute(`
        Input = Input or {}
      `);
      
      // Register Input.GetKeysHeld()
      luaState.set('InputGetKeysHeld', () => {
        if (this.gameEmulator.inputManager) {
          return this.gameEmulator.inputManager.getKeysHeld();
        }
        return 0;
      });
      
      // Register Input.GetKeysPressed()
      luaState.set('InputGetKeysPressed', () => {
        if (this.gameEmulator.inputManager) {
          return this.gameEmulator.inputManager.getKeysPressed();
        }
        return 0;
      });
      
      // Register Input.GetKeysReleased()
      luaState.set('InputGetKeysReleased', () => {
        if (this.gameEmulator.inputManager) {
          return this.gameEmulator.inputManager.getKeysReleased();
        }
        return 0;
      });
      
      // Register Input.IsKeyHeld(key)
      luaState.set('InputIsKeyHeld', (keyMask) => {
        if (this.gameEmulator.inputManager) {
          return this.gameEmulator.inputManager.isKeyHeld(keyMask);
        }
        return false;
      });
      
      // Register Input.IsKeyPressed(key) 
      luaState.set('InputIsKeyPressed', (keyMask) => {
        if (this.gameEmulator.inputManager) {
          return this.gameEmulator.inputManager.isKeyPressed(keyMask);
        }
        return false;
      });
      
      // Register Input.IsKeyReleased(key)
      luaState.set('InputIsKeyReleased', (keyMask) => {
        if (this.gameEmulator.inputManager) {
          return this.gameEmulator.inputManager.isKeyReleased(keyMask);
        }
        return false;
      });
      
      // Create the Lua wrapper functions
      luaState.execute(`
        -- Input API functions
        function Input.GetKeysHeld()
          return InputGetKeysHeld()
        end
        
        function Input.GetKeysPressed()
          return InputGetKeysPressed()
        end
        
        function Input.GetKeysReleased()
          return InputGetKeysReleased()
        end
        
        function Input.IsKeyHeld(key)
          return InputIsKeyHeld(key)
        end
        
        function Input.IsKeyPressed(key)
          return InputIsKeyPressed(key)
        end
        
        function Input.IsKeyReleased(key)
          return InputIsKeyReleased(key)
        end
        
        -- Input constants (button bit masks)
        Input.Buttons = {
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
        
        -- Create global constants for easier access
        BUTTON_NONE   = Input.Buttons.None
        BUTTON_B      = Input.Buttons.B
        BUTTON_Y      = Input.Buttons.Y  
        BUTTON_SELECT = Input.Buttons.Select
        BUTTON_START  = Input.Buttons.Start
        BUTTON_UP     = Input.Buttons.Up
        BUTTON_DOWN   = Input.Buttons.Down
        BUTTON_LEFT   = Input.Buttons.Left
        BUTTON_RIGHT  = Input.Buttons.Right
        BUTTON_A      = Input.Buttons.A
        BUTTON_X      = Input.Buttons.X
        BUTTON_L      = Input.Buttons.L
        BUTTON_R      = Input.Buttons.R
      `);
      
      console.log('[InputLuaExtension] Input functions registered successfully');
      console.log('[InputLuaExtension] Available functions:');
      console.log('  - Input.GetKeysHeld() -> UInt16');
      console.log('  - Input.GetKeysPressed() -> UInt16');
      console.log('  - Input.GetKeysReleased() -> UInt16');
      console.log('  - Input.IsKeyHeld(key) -> Boolean');
      console.log('  - Input.IsKeyPressed(key) -> Boolean');
      console.log('  - Input.IsKeyReleased(key) -> Boolean');
      console.log('[InputLuaExtension] Available constants: Input.Buttons.*, BUTTON_*');
      
    } catch (error) {
      console.error('[InputLuaExtension] Failed to register Input functions:', error);
      throw error;
    }
  }
  
  /**
   * Get extension info
   */
  getInfo() {
    return {
      name: this.name,
      version: '1.0.0',
      description: 'Provides keyboard input functions for game controls',
      functions: [
        'Input.GetKeysHeld()',
        'Input.GetKeysPressed()', 
        'Input.GetKeysReleased()',
        'Input.IsKeyHeld(key)',
        'Input.IsKeyPressed(key)',
        'Input.IsKeyReleased(key)'
      ],
      constants: [
        'Input.Buttons.*',
        'BUTTON_* (global constants)'
      ]
    };
  }
}

// Export for use in extension loader
window.InputLuaExtension = InputLuaExtension;

export default InputLuaExtension;
