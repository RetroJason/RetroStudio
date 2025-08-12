// volume-control.js
// Reusable volume control with slider and display

class VolumeControl {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      sliderId: options.sliderId || 'volumeSlider',
      displayId: options.displayId || 'volumeDisplay',
      label: options.label || 'Volume:',
      min: options.min || 0,
      max: options.max || 100,
      value: options.value || 70,
      step: options.step || 1,
      onChange: options.onChange || (() => {}),
      ...options
    };
    
    this.slider = null;
    this.display = null;
    this.currentValue = this.options.value;
    
    this.init();
  }
  
  init() {
    // Create the volume control HTML if it doesn't exist
    if (!this.container.querySelector(`#${this.options.sliderId}`)) {
      this.createVolumeControl();
    }
    
    // Get references to elements
    this.slider = this.container.querySelector(`#${this.options.sliderId}`);
    this.display = this.container.querySelector(`#${this.options.displayId}`);
    
    if (!this.slider) {
      console.error('[VolumeControl] Slider element not found');
      return;
    }
    
    // Set up event listener
    this.slider.addEventListener('input', (e) => {
      this.setValue(e.target.value);
    });
    
    // Initialize state
    this.setValue(this.currentValue);
    
    console.log('[VolumeControl] Initialized');
  }
  
  createVolumeControl() {
    const controlHTML = `
      <div class="volume-container">
        <label>${this.options.label}</label>
        <input type="range" 
               id="${this.options.sliderId}" 
               min="${this.options.min}" 
               max="${this.options.max}" 
               value="${this.options.value}"
               step="${this.options.step}">
        <span id="${this.options.displayId}">${this.options.value}%</span>
      </div>
    `;
    this.container.insertAdjacentHTML('beforeend', controlHTML);
  }
  
  setValue(value) {
    this.currentValue = value;
    
    if (this.slider) {
      this.slider.value = value;
    }
    
    if (this.display) {
      this.display.textContent = `${value}%`;
    }
    
    // Call the callback with the new value
    this.options.onChange(value / 100); // Convert to 0-1 range
  }
  
  getValue() {
    return this.currentValue;
  }
  
  // Get value as 0-1 range (common for audio APIs)
  getNormalizedValue() {
    return this.currentValue / 100;
  }
  
  // Force refresh of element references
  refresh() {
    this.slider = this.container.querySelector(`#${this.options.sliderId}`);
    this.display = this.container.querySelector(`#${this.options.displayId}`);
    
    if (!this.slider) {
      console.warn('[VolumeControl] Slider not found during refresh');
    }
    
    if (!this.display) {
      console.warn('[VolumeControl] Display not found during refresh');
    }
  }
  
  // Clean up event listeners
  destroy() {
    if (this.slider) {
      this.slider.removeEventListener('input', this.setValue.bind(this));
    }
  }
}

// Export for use
window.VolumeControl = VolumeControl;
