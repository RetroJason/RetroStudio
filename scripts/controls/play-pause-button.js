// play-pause-button.js
// Reusable play/pause button control

class PlayPauseButton {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      buttonId: options.buttonId || 'playPauseBtn',
      iconClass: options.iconClass || 'play-icon',
      playingClass: options.playingClass || 'playing',
      onToggle: options.onToggle || (() => {}),
      ...options
    };
    
    this.isPlaying = false;
    this.button = null;
    this.icon = null;
    
    this.init();
  }
  
  init() {
    // Create the button HTML if it doesn't exist
    if (!this.container.querySelector(`#${this.options.buttonId}`)) {
      this.createButton();
    }
    
    // Get references to elements
    this.button = this.container.querySelector(`#${this.options.buttonId}`);
    this.icon = this.button?.querySelector(`.${this.options.iconClass}`);
    
    if (!this.button) {
      console.error('[PlayPauseButton] Button element not found');
      return;
    }
    
    if (!this.icon) {
      console.error('[PlayPauseButton] Icon element not found');
      return;
    }
    
    // Set up event listener
    this.button.addEventListener('click', () => {
      this.toggle();
    });
    
    // Initialize state
    this.updateButton();
    
    console.log('[PlayPauseButton] Initialized');
  }
  
  createButton() {
    const buttonHTML = `
      <button id="${this.options.buttonId}" class="play-pause-button">
        <span class="${this.options.iconClass}">▶️</span>
      </button>
    `;
    this.container.insertAdjacentHTML('beforeend', buttonHTML);
  }
  
  toggle() {
    console.log('[PlayPauseButton] Toggle called, isPlaying:', this.isPlaying);
    this.isPlaying = !this.isPlaying;
    this.updateButton();
    
    // Call the callback with the new state
    this.options.onToggle(this.isPlaying);
  }
  
  setPlaying(playing) {
    if (this.isPlaying !== playing) {
      this.isPlaying = playing;
      this.updateButton();
    }
  }
  
  updateButton() {
    if (!this.button || !this.icon) {
      console.warn('[PlayPauseButton] Button or icon not available for update');
      return;
    }
    
    if (this.isPlaying) {
      this.icon.textContent = '⏸️';
      this.button.classList.add(this.options.playingClass);
      console.log('[PlayPauseButton] Button set to pause state');
    } else {
      this.icon.textContent = '▶️';
      this.button.classList.remove(this.options.playingClass);
      console.log('[PlayPauseButton] Button set to play state');
    }
  }
  
  // Force refresh of element references (useful when DOM changes)
  refresh() {
    this.button = this.container.querySelector(`#${this.options.buttonId}`);
    this.icon = this.button?.querySelector(`.${this.options.iconClass}`);
    
    if (!this.button) {
      console.warn('[PlayPauseButton] Button not found during refresh');
    }
    
    if (!this.icon) {
      console.warn('[PlayPauseButton] Icon not found during refresh');
    }
  }
  
  // Clean up event listeners
  destroy() {
    if (this.button) {
      this.button.removeEventListener('click', this.toggle.bind(this));
    }
  }
}

// Export for use
window.PlayPauseButton = PlayPauseButton;
