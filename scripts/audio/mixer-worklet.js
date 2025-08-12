// mixer-worklet.js
// AudioWorkletProcessor for mixing multiple sounds

class MixerWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffers = [];
    this.continuousStreams = new Map(); // For ongoing streams like MOD
    this.modWorker = null; // Reference to communicate back
    this.isPlaying = false;
    this.bufferSize = 2048; // Buffer size threshold for requesting more data
    this.volume = 0.7; // Default volume (0.0 to 1.0+)
    this.requestInFlight = false; // Prevent multiple simultaneous requests
    
    this.port.onmessage = (e) => {
      if (e.data.type === 'play') {
        if (e.data.streamId) {
          // Continuous stream (MOD) - improved buffering
          const newData = {
            channels: e.data.channels.map(arr => new Float32Array(arr)),
            pos: 0,
            sampleRate: e.data.sampleRate
          };
          
          if (this.continuousStreams.has(e.data.streamId)) {
            const existing = this.continuousStreams.get(e.data.streamId);
            // Always append new data, but be smarter about it
            const remainingData = existing.channels.map(channel => 
              channel.subarray(existing.pos)
            );
            
            const newChannels = newData.channels.map((newChannel, i) => {
              const combined = new Float32Array(remainingData[i].length + newChannel.length);
              combined.set(remainingData[i]);
              combined.set(newChannel, remainingData[i].length);
              return combined;
            });
            
            existing.channels = newChannels;
            existing.pos = 0; // Reset position
          } else {
            this.continuousStreams.set(e.data.streamId, newData);
            console.log(`[MixerWorklet] Started stream: ${e.data.streamId}`);
          }
          
          // Clear the request flag since we got data
          this.requestInFlight = false;
        } else {
          // One-shot buffer (WAV) - no logging for routine playback
          this.buffers.push({
            channels: e.data.channels.map(arr => new Float32Array(arr)),
            pos: 0,
            sampleRate: e.data.sampleRate
          });
        }
      } else if (e.data.type === 'stop-stream') {
        if (this.continuousStreams.has(e.data.streamId)) {
          console.log(`[MixerWorklet] Stopped stream: ${e.data.streamId}`);
        }
        this.continuousStreams.delete(e.data.streamId);
        this.isPlaying = false;
      } else if (e.data.type === 'stop-all-audio') {
        // Clear all audio streams and buffers
        console.log('[MixerWorklet] Stopped all audio');
        this.continuousStreams.clear();
        this.buffers = [];
        this.isPlaying = false;
        this.requestInFlight = false;
      } else if (e.data.type === 'start-playing') {
        this.isPlaying = true;
        console.log('[MixerWorklet] Started playing');
      } else if (e.data.type === 'set-volume') {
        this.volume = Math.max(0, e.data.volume); // Allow volume > 1.0 for boost
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const numChannels = output.length;
    const blockSize = output[0].length;
    
    // Clear output
    for (let c = 0; c < numChannels; c++) {
      output[c].fill(0);
    }
    
    // Mix one-shot buffers (WAV files)
    for (let i = this.buffers.length - 1; i >= 0; i--) {
      const buf = this.buffers[i];
      for (let c = 0; c < numChannels; c++) {
        const src = buf.channels[c % buf.channels.length];
        for (let s = 0; s < blockSize; s++) {
          const srcIdx = buf.pos + s;
          if (srcIdx < src.length) {
            output[c][s] += src[srcIdx] * this.volume; // Apply volume to WAV files too
          }
        }
      }
      buf.pos += blockSize;
      // Remove finished buffers
      if (buf.pos >= buf.channels[0].length) {
        this.buffers.splice(i, 1);
      }
    }
    
    // Mix continuous streams
    for (const [streamId, stream] of this.continuousStreams) {
      if (stream.channels && stream.channels.length > 0) {
        for (let c = 0; c < numChannels; c++) {
          const src = stream.channels[c % stream.channels.length];
          if (src && src.length > 0) {
            for (let s = 0; s < blockSize; s++) {
              const srcIdx = stream.pos + s;
              if (srcIdx < src.length) {
                const sample = src[srcIdx];
                if (isFinite(sample)) {
                  output[c][s] += sample * this.volume; // Apply volume control
                }
              } else {
                // Buffer underrun - fill with silence to prevent clicks
                output[c][s] += 0;
              }
            }
          }
        }
        stream.pos += blockSize;
        
        // Check if we need more data (request early to avoid gaps)
        const remainingFrames = stream.channels[0].length - stream.pos;
        if (this.isPlaying && !this.requestInFlight && remainingFrames < this.bufferSize * 3 && streamId === 'mod-stream') {
          // Request more PCM data well before we run out
          this.requestInFlight = true; // Prevent multiple requests
          this.port.postMessage({
            type: 'request-pcm',
            streamId: streamId,
            frames: 2048
          });
        }
        
        // Handle end of buffer more gracefully
        if (stream.pos >= stream.channels[0].length) {
          if (remainingFrames <= 0) {
            console.log(`[MixerWorklet] Error: Stream ${streamId} buffer exhausted`);
          }
          stream.pos = Math.max(0, stream.channels[0].length - 1); // Stay near end but not past it
        }
      }
    }
    
    // No limiting - let the audio system handle clipping naturally
    // This preserves all dynamics and lets the volume slider control everything
    return true;
  }
}

registerProcessor('mixer-worklet', MixerWorklet);
