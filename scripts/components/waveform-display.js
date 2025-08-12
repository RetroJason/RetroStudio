// waveform-display.js
// Reusable waveform visualization component

class WaveformDisplay {
  constructor(container, options = {}) {
    this.container = container;
    this.canvas = null;
    this.ctx = null;
    this.audioBuffer = null;
    
    this.options = {
      width: 600,
      height: 200,
      backgroundColor: '#1e1e1e',
      gradientColors: ['#4fc3f7', '#29b6f6', '#0288d1'],
      ...options
    };
    
    this.init();
  }
  
  init() {
    // Create canvas element
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'waveformCanvas';
    this.canvas.style.width = this.options.width + 'px';
    this.canvas.style.height = this.options.height + 'px';
    this.canvas.style.border = '1px solid #333';
    this.canvas.style.borderRadius = '4px';
    
    // Add to container
    this.container.innerHTML = '';
    this.container.appendChild(this.canvas);
    
    this.ctx = this.canvas.getContext('2d');
    
    // Draw initial empty state
    this.drawEmpty();
  }
  
  drawEmpty() {
    if (!this.canvas || !this.ctx) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const height = rect.height;
    
    // Clear with background color
    this.ctx.fillStyle = this.options.backgroundColor;
    this.ctx.fillRect(0, 0, width, height);
    
    // Draw placeholder text
    this.ctx.fillStyle = '#666';
    this.ctx.font = '14px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('No audio data', width / 2, height / 2);
  }
  
  updateWaveform(audioBuffer) {
    this.audioBuffer = audioBuffer;
    this.drawWaveform();
  }
  
  drawWaveform() {
    if (!this.canvas || !this.ctx) {
      console.warn('[WaveformDisplay] Canvas not initialized');
      return;
    }
    
    if (!this.audioBuffer) {
      this.drawEmpty();
      return;
    }
    
    const rect = this.canvas.getBoundingClientRect();
    
    if (rect.width === 0 || rect.height === 0) {
      console.warn('[WaveformDisplay] Canvas has zero dimensions, retrying in 100ms');
      setTimeout(() => this.drawWaveform(), 100);
      return;
    }
    
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const height = rect.height;
    
    // Clear canvas with background
    this.ctx.fillStyle = this.options.backgroundColor;
    this.ctx.fillRect(0, 0, width, height);
    
    // Draw waveform data
    const channelData = this.audioBuffer.getChannelData(0); // Use first channel
    const samplesPerPixel = channelData.length / width;
    const centerY = height / 2;
    
    // Create gradient for waveform
    const gradient = this.ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, this.options.gradientColors[0]);
    gradient.addColorStop(0.5, this.options.gradientColors[1]);
    gradient.addColorStop(1, this.options.gradientColors[2]);
    
    // Draw filled waveform with gradient
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    
    // Start from bottom left
    this.ctx.moveTo(0, height);
    
    // Draw top envelope
    for (let x = 0; x < width; x++) {
      const startSample = Math.floor(x * samplesPerPixel);
      const endSample = Math.min(Math.floor((x + 1) * samplesPerPixel), channelData.length);
      
      // Find min and max in this segment
      let min = 0, max = 0;
      for (let i = startSample; i < endSample; i++) {
        const sample = channelData[i];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      
      // Convert to canvas coordinates (flip Y axis and scale to 90% of height)
      const yMax = centerY - (max * centerY * 0.9);
      this.ctx.lineTo(x, yMax);
    }
    
    // Draw bottom envelope (right to left)
    for (let x = width - 1; x >= 0; x--) {
      const startSample = Math.floor(x * samplesPerPixel);
      const endSample = Math.min(Math.floor((x + 1) * samplesPerPixel), channelData.length);
      
      // Find min and max in this segment
      let min = 0, max = 0;
      for (let i = startSample; i < endSample; i++) {
        const sample = channelData[i];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      
      // Convert to canvas coordinates (flip Y axis and scale to 90% of height)
      const yMin = centerY - (min * centerY * 0.9);
      this.ctx.lineTo(x, yMin);
    }
    
    // Close the path and fill
    this.ctx.lineTo(0, height);
    this.ctx.closePath();
    this.ctx.fill();
    
    // Add a subtle outline
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
  }
  
  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.canvas = null;
    this.ctx = null;
    this.audioBuffer = null;
  }
}

// Export for use
window.WaveformDisplay = WaveformDisplay;
