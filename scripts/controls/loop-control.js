// loop-control.js
// Reusable loop checkbox control

class LoopControl {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      checkboxId: options.checkboxId || 'loopCheckbox',
      label: options.label || 'Loop',
      checked: options.checked || false,
      onChange: options.onChange || (() => {}),
      ...options
    };
    
    this.checkbox = null;
    this.isLooping = this.options.checked;
    
    this.init();
  }
  
  init() {
    // Create the loop control HTML if it doesn't exist
    if (!this.container.querySelector(`#${this.options.checkboxId}`)) {
      this.createLoopControl();
    }
    
    // Get reference to element
    this.checkbox = this.container.querySelector(`#${this.options.checkboxId}`);
    
    if (!this.checkbox) {
      console.error('[LoopControl] Checkbox element not found');
      return;
    }
    
    // Set up event listener
    this.checkbox.addEventListener('change', (e) => {
      this.setLooping(e.target.checked);
    });
    
    // Initialize state
    this.setLooping(this.isLooping);
    
    console.log('[LoopControl] Initialized');
  }
  
  createLoopControl() {
    const controlHTML = `
      <div class="loop-container">
        <label>
          <input type="checkbox" id="${this.options.checkboxId}" ${this.options.checked ? 'checked' : ''}>
          ${this.options.label}
        </label>
      </div>
    `;
    this.container.insertAdjacentHTML('beforeend', controlHTML);
  }
  
  setLooping(looping) {
    this.isLooping = looping;
    
    if (this.checkbox) {
      this.checkbox.checked = looping;
    }
    
    // Call the callback with the new state
    this.options.onChange(looping);
  }
  
  getLooping() {
    return this.isLooping;
  }
  
  // Force refresh of element references
  refresh() {
    this.checkbox = this.container.querySelector(`#${this.options.checkboxId}`);
    
    if (!this.checkbox) {
      console.warn('[LoopControl] Checkbox not found during refresh');
    }
  }
  
  // Clean up event listeners
  destroy() {
    if (this.checkbox) {
      this.checkbox.removeEventListener('change', this.setLooping.bind(this));
    }
  }
}

// Export for use
window.LoopControl = LoopControl;
