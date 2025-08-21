// game-input-manager.js
// Dedicated input manager for game emulator that captures keyboard input
// without interfering with other controls like Monaco Editor

class GameInputManager {
  constructor() {
    this.isActive = false;
    this.gameCanvas = null;
    this.keyStates = new Map(); // Track current key states
    this.frameKeys = {
      held: 0,      // Keys currently held down (bitmask)
      pressed: 0,   // Keys pressed this frame (bitmask)
      released: 0   // Keys released this frame (bitmask)
    };
    
    // Previous frame state for calculating pressed/released
    this.previousKeys = 0;
    
    // Key mappings based on the Lua interface
    this.buttonMap = {
      // Main action buttons
      'KeyZ': 0x0001,     // B button (bit 0)
      'KeyX': 0x0100,     // A button (bit 8) 
      'KeyA': 0x0002,     // Y button (bit 1)
      'KeyS': 0x0200,     // X button (bit 9)
      
      // D-pad
      'ArrowUp': 0x0010,    // Up (bit 4)
      'ArrowDown': 0x0020,  // Down (bit 5)
      'ArrowLeft': 0x0040,  // Left (bit 6)
      'ArrowRight': 0x0080, // Right (bit 7)
      
      // System buttons
      'Enter': 0x0008,      // Start (bit 3)
      'Space': 0x0004,      // Select (bit 2)
      'ShiftLeft': 0x0400,  // L shoulder (bit 10)
      'ShiftRight': 0x0800  // R shoulder (bit 11)
    };
    
    // Reverse mapping for debugging
    this.buttonNames = {
      0x0001: 'B',
      0x0002: 'Y', 
      0x0004: 'Select',
      0x0008: 'Start',
      0x0010: 'Up',
      0x0020: 'Down',
      0x0040: 'Left',
      0x0080: 'Right',
      0x0100: 'A',
      0x0200: 'X',
      0x0400: 'L',
      0x0800: 'R'
    };
    
    // Bound event handlers
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundFocus = this.handleFocus.bind(this);
    this.boundBlur = this.handleBlur.bind(this);
    this.boundClick = this.handleClick.bind(this);
    
    console.log('[GameInputManager] Initialized with button mappings:', this.buttonMap);
  }
  
  /**
   * Initialize input manager and bind to game canvas
   * @param {HTMLCanvasElement} canvas - The game canvas element
   */
  initialize(canvas) {
    if (!canvas) {
      console.error('[GameInputManager] No canvas provided for initialization');
      return false;
    }
    
    this.gameCanvas = canvas;
    console.log('[GameInputManager] Initializing with canvas:', canvas.id || 'unnamed');
    
    // Make canvas focusable
    if (!canvas.hasAttribute('tabindex')) {
      canvas.setAttribute('tabindex', '0');
    }
    
    // Set up canvas styling for focus indication
    this.setupCanvasStyles(canvas);
    
    // Add event listeners
    this.addEventListeners();
    
    console.log('[GameInputManager] Initialization complete');
    return true;
  }
  
  /**
   * Set up canvas styles for proper focus indication
   */
  setupCanvasStyles(canvas) {
    // Add focus styles if not already present
    if (!document.querySelector('#game-input-styles')) {
      const style = document.createElement('style');
      style.id = 'game-input-styles';
      style.textContent = `
        #game-canvas {
          outline: none; /* Remove default focus outline */
        }
        
        #game-canvas:focus {
          box-shadow: 0 0 0 2px #0078d4; /* Custom focus indicator */
        }
        
        #game-canvas.input-active {
          box-shadow: 0 0 0 2px #0078d4;
        }
        
        .game-input-indicator {
          position: absolute;
          top: 5px;
          left: 5px;
          background: rgba(0, 120, 212, 0.8);
          color: white;
          padding: 2px 8px;
          border-radius: 3px;
          font-size: 12px;
          font-family: 'Segoe UI', sans-serif;
          pointer-events: none;
          z-index: 10;
        }
      `;
      document.head.appendChild(style);
    }
  }
  
  /**
   * Add event listeners for input capture
   */
  addEventListeners() {
    if (!this.gameCanvas) return;
    
    // Canvas focus events
    this.gameCanvas.addEventListener('focus', this.boundFocus);
    this.gameCanvas.addEventListener('blur', this.boundBlur);
    this.gameCanvas.addEventListener('click', this.boundClick);
    
    // Key events on window (since keydown/keyup bubble up)
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    
    console.log('[GameInputManager] Event listeners added');
  }
  
  /**
   * Remove event listeners
   */
  removeEventListeners() {
    if (this.gameCanvas) {
      this.gameCanvas.removeEventListener('focus', this.boundFocus);
      this.gameCanvas.removeEventListener('blur', this.boundBlur);
      this.gameCanvas.removeEventListener('click', this.boundClick);
    }
    
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    
    console.log('[GameInputManager] Event listeners removed');
  }
  
  /**
   * Handle canvas gaining focus
   */
  handleFocus(event) {
    console.log('[GameInputManager] Canvas gained focus - input capture active');
    this.isActive = true;
    this.gameCanvas.classList.add('input-active');
    this.showInputIndicator();
    this.updateInputStatus(true);
  }
  
  /**
   * Handle canvas losing focus
   */
  handleBlur(event) {
    console.log('[GameInputManager] Canvas lost focus - input capture inactive');
    this.isActive = false;
    this.gameCanvas.classList.remove('input-active');
    this.hideInputIndicator();
    this.updateInputStatus(false);
    
    // Clear all key states when losing focus
    this.clearKeyStates();
  }
  
  /**
   * Handle canvas click to focus
   */
  handleClick(event) {
    // Ensure canvas gets focus when clicked
    if (!this.isActive) {
      console.log('[GameInputManager] Canvas clicked - requesting focus');
      this.gameCanvas.focus();
    }
  }
  
  /**
   * Handle keydown events
   */
  handleKeyDown(event) {
    // Only process if we're active and this is a mapped key
    if (!this.isActive || !this.buttonMap.hasOwnProperty(event.code)) {
      return;
    }
    
    // Prevent default for game keys to avoid browser shortcuts
    event.preventDefault();
    event.stopPropagation();
    
    const button = this.buttonMap[event.code];
    const buttonName = this.buttonNames[button];
    
    // Only process if this key wasn't already held
    if (!this.keyStates.has(event.code)) {
      console.log(`[GameInputManager] Key pressed: ${event.code} -> ${buttonName} (0x${button.toString(16).padStart(4, '0')})`);
      this.keyStates.set(event.code, true);
      
      // Update frame key states
      this.frameKeys.held |= button;
      this.frameKeys.pressed |= button;
    }
  }
  
  /**
   * Handle keyup events
   */
  handleKeyUp(event) {
    // Only process if we're active and this is a mapped key
    if (!this.isActive || !this.buttonMap.hasOwnProperty(event.code)) {
      return;
    }
    
    event.preventDefault();
    event.stopPropagation();
    
    const button = this.buttonMap[event.code];
    const buttonName = this.buttonNames[button];
    
    // Only process if this key was actually held
    if (this.keyStates.has(event.code)) {
      console.log(`[GameInputManager] Key released: ${event.code} -> ${buttonName} (0x${button.toString(16).padStart(4, '0')})`);
      this.keyStates.delete(event.code);
      
      // Update frame key states
      this.frameKeys.held &= ~button;
      this.frameKeys.released |= button;
    }
  }
  
  /**
   * Update input status display
   */
  updateInputStatus(isActive) {
    const statusElement = document.querySelector('.input-status');
    if (statusElement) {
      if (isActive) {
        statusElement.innerHTML = '<strong>🎮 Input Active - Press keys to test!</strong>';
        statusElement.classList.add('active');
      } else {
        statusElement.innerHTML = '<strong>Click the canvas above to activate input capture</strong>';
        statusElement.classList.remove('active');
      }
    }
  }
  
  /**
   * Clear all key states (called when losing focus)
   */
  clearKeyStates() {
    this.keyStates.clear();
    this.frameKeys.held = 0;
    this.frameKeys.pressed = 0;
    this.frameKeys.released = 0;
    this.previousKeys = 0;
    console.log('[GameInputManager] Cleared all key states');
  }
  
  /**
   * Show input indicator on canvas
   */
  showInputIndicator() {
    this.hideInputIndicator(); // Remove any existing indicator
    
    const container = this.gameCanvas.parentElement;
    if (container) {
      const indicator = document.createElement('div');
      indicator.className = 'game-input-indicator';
      indicator.textContent = '🎮 Input Active';
      indicator.id = 'game-input-indicator';
      
      // Position relative to canvas container
      if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }
      
      container.appendChild(indicator);
    }
  }
  
  /**
   * Hide input indicator
   */
  hideInputIndicator() {
    const indicator = document.getElementById('game-input-indicator');
    if (indicator) {
      indicator.remove();
    }
  }
  
  /**
   * Update input state - called once per frame by the game loop
   * This processes frame-based input events and resets pressed/released states
   */
  updateFrame() {
    // Reset pressed and released states for next frame
    this.frameKeys.pressed = 0;
    this.frameKeys.released = 0;
    
    // Store current held state for next frame calculations
    this.previousKeys = this.frameKeys.held;
  }
  
  // === PUBLIC API FOR LUA INTERFACE ===
  
  /**
   * Get keys currently held (bit array)
   * Implements: UInt16 Input.GetKeysHeld()
   */
  getKeysHeld() {
    return this.frameKeys.held;
  }
  
  /**
   * Get keys pressed this frame (bit array)
   * Implements: UInt16 Input.GetKeysPressed()
   */
  getKeysPressed() {
    return this.frameKeys.pressed;
  }
  
  /**
   * Get keys released this frame (bit array)
   * Implements: UInt16 Input.GetKeysReleased()
   */
  getKeysReleased() {
    return this.frameKeys.released;
  }
  
  /**
   * Check if a specific key is held
   * Implements: Boolean Input.IsKeyHeld(Keys key)
   */
  isKeyHeld(keyMask) {
    return (this.frameKeys.held & keyMask) !== 0;
  }
  
  /**
   * Check if a specific key was pressed this frame
   * Implements: Boolean Input.IsKeyPressed(Keys key)
   */
  isKeyPressed(keyMask) {
    return (this.frameKeys.pressed & keyMask) !== 0;
  }
  
  /**
   * Check if a specific key was released this frame
   * Implements: Boolean Input.IsKeyReleased(Keys key)
   */
  isKeyReleased(keyMask) {
    return (this.frameKeys.released & keyMask) !== 0;
  }
  
  /**
   * Get debug information about current input state
   */
  getDebugInfo() {
    const heldButtons = [];
    for (const [mask, name] of Object.entries(this.buttonNames)) {
      if (this.frameKeys.held & parseInt(mask)) {
        heldButtons.push(name);
      }
    }
    
    return {
      active: this.isActive,
      keysHeld: `0x${this.frameKeys.held.toString(16).padStart(4, '0')}`,
      keysPressed: `0x${this.frameKeys.pressed.toString(16).padStart(4, '0')}`,
      keysReleased: `0x${this.frameKeys.released.toString(16).padStart(4, '0')}`,
      buttonsHeld: heldButtons.join(', ') || 'none',
      activeKeyStates: Array.from(this.keyStates.keys())
    };
  }
  
  /**
   * Activate input capture (focus the canvas)
   */
  activate() {
    if (this.gameCanvas) {
      this.gameCanvas.focus();
    }
  }
  
  /**
   * Deactivate input capture
   */
  deactivate() {
    if (this.gameCanvas) {
      this.gameCanvas.blur();
    }
  }
  
  /**
   * Cleanup and destroy the input manager
   */
  destroy() {
    this.removeEventListeners();
    this.hideInputIndicator();
    this.clearKeyStates();
    this.gameCanvas = null;
    this.isActive = false;
    console.log('[GameInputManager] Destroyed');
  }
}

// Export for use in other modules
window.GameInputManager = GameInputManager;

export default GameInputManager;
