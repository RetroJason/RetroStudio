// openmpt-integration.js
// Integrates openmpt.js for MOD playback and renders PCM to the audio engine

let modPlayer = null;
let modBuffer = null;
let modSampleRate = 48000; // Default, will be set by context
let OpenMPTModule = null; // Renamed to avoid conflict
let moduleLoadingPromise = null; // Track module loading to prevent concurrent loads
let moduleLoaded = false; // Track if module is already loaded

// Log function for worker debugging
function log(message) {
  postMessage({ type: 'log', message: `[ModWorker] ${message}` });
}

// Load openmpt module (with singleton pattern to prevent multiple loads)
async function loadModule() {
  // If already loaded, return immediately
  if (moduleLoaded && OpenMPTModule) {
    log('Module already loaded, reusing existing instance');
    return true;
  }
  
  // If currently loading, wait for the existing load to complete
  if (moduleLoadingPromise) {
    log('Module loading in progress, waiting...');
    return await moduleLoadingPromise;
  }
  
  // Start loading process
  moduleLoadingPromise = (async () => {
    try {
      log('Loading openmpt module...');
      
      // Check if already imported
      if (typeof self.Module !== 'undefined' && self.Module.calledRun) {
        log('Module already exists and initialized');
        OpenMPTModule = self.Module;
        moduleLoaded = true;
        return true;
      }
      
      // Set up Module configuration BEFORE importing the script
      if (typeof self.Module === 'undefined') {
        self.Module = {
          locateFile: function(path) {
            log(`Locating file: ${path}`);
            if (path.endsWith('.wasm')) {
              const wasmPath = path; // Use same directory as the JS file
              log(`WASM path resolved to: ${wasmPath}`);
              return wasmPath;
            }
            return path;
          },
          onRuntimeInitialized: function() {
            log('Runtime initialized');
          }
        };
        
        // Import the script from same directory only if not already imported
        importScripts('libopenmpt.js');
      }
      
      // Wait for Module to be available and initialized
      log('Waiting for module initialization...');
      OpenMPTModule = await new Promise((resolve, reject) => {
        if (self.Module.calledRun) {
          resolve(self.Module);
        } else {
          const originalCallback = self.Module.onRuntimeInitialized;
          self.Module.onRuntimeInitialized = function() {
            if (originalCallback) originalCallback();
            resolve(self.Module);
          };
          // Timeout after 10 seconds
          setTimeout(() => reject(new Error('Module initialization timeout')), 10000);
        }
      });
      
      moduleLoaded = true;
      log('OpenMPT module loaded successfully');
      return true;
    } catch (error) {
      log(`Error loading module: ${error.message}`);
      postMessage({ type: 'error', message: `Failed to load OpenMPT: ${error.message}` });
      moduleLoaded = false;
      OpenMPTModule = null;
      return false;
    } finally {
      moduleLoadingPromise = null; // Reset loading promise
    }
  })();
  
  return await moduleLoadingPromise;
}

onmessage = async function(e) {
  try {
    if (e.data.type === 'load-mod') {
      log(`Loading MOD file (${e.data.arrayBuffer.byteLength} bytes)`);
      
      // Clean up previous player
      if (modPlayer) {
        if (modPlayer.destroy) {
          modPlayer.destroy();
        }
        modPlayer = null;
      }
      
      // Load module if needed
      if (!OpenMPTModule) {
        const loaded = await loadModule();
        if (!loaded) return;
      }
      
      // Create new player using the C API
      try {
        log('Using libopenmpt C API');
        
        // Comprehensive search for WebAssembly memory
        log('Searching for WebAssembly memory...');
        
        let wasmMemory = null;
        
        // Search through all properties
        for (const prop of Object.getOwnPropertyNames(OpenMPTModule)) {
          const obj = OpenMPTModule[prop];
          if (obj && typeof obj === 'object') {
            // Check if it has a buffer property
            if (obj.buffer instanceof ArrayBuffer) {
              log(`Found memory-like object at: ${prop} (buffer size: ${obj.buffer.byteLength})`);
              wasmMemory = obj;
              break;
            }
            // Check if it IS an ArrayBuffer
            if (obj instanceof ArrayBuffer) {
              log(`Found ArrayBuffer at: ${prop} (size: ${obj.byteLength})`);
              wasmMemory = { buffer: obj };
              break;
            }
            // Check if it's a WebAssembly.Memory
            if (obj instanceof WebAssembly.Memory) {
              log(`Found WebAssembly.Memory at: ${prop}`);
              wasmMemory = obj;
              break;
            }
            // Check nested properties for memory
            if (obj.memory) {
              if (obj.memory.buffer instanceof ArrayBuffer) {
                log(`Found nested memory at: ${prop}.memory`);
                wasmMemory = obj.memory;
                break;
              }
              if (obj.memory instanceof WebAssembly.Memory) {
                log(`Found nested WebAssembly.Memory at: ${prop}.memory`);
                wasmMemory = obj.memory;
                break;
              }
            }
          }
        }
        
        // If still not found, check global WebAssembly instances
        if (!wasmMemory && typeof WebAssembly !== 'undefined') {
          log('Checking global WebAssembly instances...');
          // This is a last resort - try to access memory through global state
          try {
            // Some Emscripten builds store memory globally
            if (self.wasmMemory) {
              wasmMemory = self.wasmMemory;
              log('Found memory in self.wasmMemory');
            }
          } catch (e) {
            log('No global memory found');
          }
        }
        
        if (!wasmMemory || !wasmMemory.buffer) {
          // Last attempt: try using memory from exports if available
          log('Trying alternative memory access...');
          
          // Check if we can access via asm property
          if (OpenMPTModule.asm && OpenMPTModule.asm.memory) {
            wasmMemory = OpenMPTModule.asm.memory;
            log('Found memory via asm.memory');
          } else {
            log('Available top-level properties: ' + Object.getOwnPropertyNames(OpenMPTModule).slice(0, 20).join(', '));
            throw new Error('Could not find WebAssembly memory object anywhere');
          }
        }
        
        if (!wasmMemory.buffer) {
          throw new Error('Found memory object but no buffer property');
        }
        
        log('Found WebAssembly memory with buffer size: ' + wasmMemory.buffer.byteLength);
        
        // Allocate memory for the buffer
        const bufferSize = e.data.arrayBuffer.byteLength;
        const bufferPtr = OpenMPTModule._malloc(bufferSize);
        if (!bufferPtr) {
          throw new Error('Failed to allocate memory for MOD data');
        }
        
        log(`Allocated ${bufferSize} bytes at pointer ${bufferPtr}`);
        
        // Copy data to WASM memory using the memory buffer
        const sourceArray = new Uint8Array(e.data.arrayBuffer);
        const targetArray = new Uint8Array(wasmMemory.buffer, bufferPtr, bufferSize);
        targetArray.set(sourceArray);
        
        log('Data copied to WASM memory');
        
        // Create module from memory
        const modulePtr = OpenMPTModule._openmpt_module_create_from_memory(
          bufferPtr, 
          bufferSize, 
          0, 0, 0, 0, 0
        );
        
        log('Module creation attempted, result: ' + modulePtr);
        
        // Free the temporary buffer
        OpenMPTModule._free(bufferPtr);
        
        if (!modulePtr) {
          throw new Error('Failed to create OpenMPT module - file format not supported or corrupted');
        }
        
        modPlayer = {
          ptr: modulePtr,
          wasmMemory: wasmMemory,
          getDuration: () => OpenMPTModule._openmpt_module_get_duration_seconds(modulePtr),
          getMetadata: () => 'XM Track',
          readStereo: (frames) => {
            const bufferSize = frames * 2 * 4; // stereo * 4 bytes per float
            const bufferPtr = OpenMPTModule._malloc(bufferSize);
            if (!bufferPtr) {
              log('Failed to allocate buffer for PCM reading');
              return null;
            }
            
            // Clear the buffer first
            const clearArray = new Uint8Array(wasmMemory.buffer, bufferPtr, bufferSize);
            clearArray.fill(0);
            
            const actualFrames = OpenMPTModule._openmpt_module_read_interleaved_float_stereo(
              modulePtr, 
              modSampleRate, 
              frames, 
              bufferPtr
            );
            
            // Only log frame requests occasionally to reduce spam
            if (frames % 20480 === 0) {
              log(`Requested ${frames} frames, got ${actualFrames} frames`);
            }
            
            if (actualFrames > 0) {
              try {
                // Read float data from WASM memory
                const floatArray = new Float32Array(wasmMemory.buffer, bufferPtr, actualFrames * 2);
                const result = new Float32Array(actualFrames * 2);
                
                // Copy and validate the data - no clamping, preserve original dynamics
                let hasValidData = false;
                let minSample = 0, maxSample = 0;
                for (let i = 0; i < actualFrames * 2; i++) {
                  const sample = floatArray[i];
                  if (isFinite(sample)) {
                    result[i] = sample; // Keep completely original value
                    
                    if (Math.abs(sample) > 0.0001) hasValidData = true;
                    if (i === 0) {
                      minSample = maxSample = sample;
                    } else {
                      minSample = Math.min(minSample, sample);
                      maxSample = Math.max(maxSample, sample);
                    }
                  } else {
                    result[i] = 0;
                  }
                }
                
                // Only log occasionally to reduce console spam
                if (actualFrames % 20480 === 0) {
                  if (hasValidData) {
                    log(`Audio: ${actualFrames} frames, range: ${minSample.toFixed(3)} to ${maxSample.toFixed(3)} (no clamping)`);
                  } else {
                    log('No valid audio data detected');
                  }
                }
                
                OpenMPTModule._free(bufferPtr);
                return { frames: actualFrames, data: result };
              } catch (error) {
                log(`Error reading PCM data: ${error.message}`);
                OpenMPTModule._free(bufferPtr);
                return { frames: 0, data: null };
              }
            }
            
            OpenMPTModule._free(bufferPtr);
            return { frames: 0, data: null };
          },
          destroy: () => {
            if (modulePtr) OpenMPTModule._openmpt_module_destroy(modulePtr);
          }
        };
        
        modSampleRate = e.data.sampleRate;
        const title = modPlayer.getMetadata();
        const duration = modPlayer.getDuration();
        
        log(`MOD loaded successfully: ${title}, duration: ${duration}s`);
        postMessage({ 
          type: 'mod-loaded', 
          title: title,
          duration: duration
        });
        
      } catch (error) {
        log(`Error creating MOD player: ${error.message}`);
        postMessage({ type: 'error', message: `Invalid MOD file: ${error.message}` });
      }
      
    } else if (e.data.type === 'stop-all') {
      log('Stopping all MOD playback and cleaning up...');
      
      // Clean up current player
      if (modPlayer) {
        try {
          if (modPlayer.destroy) {
            modPlayer.destroy();
          }
        } catch (error) {
          log(`Error destroying MOD player: ${error.message}`);
        }
        modPlayer = null;
      }
      
      // Clear buffers
      modBuffer = null;
      
      log('MOD worker cleanup complete');
      
    } else if (e.data.type === 'get-pcm') {
      if (!modPlayer) {
        log('Warning: get-pcm called but no modPlayer');
        return;
      }
      
      // Render N frames of PCM using the new API
      const frames = e.data.frames;
      const result = modPlayer.readStereo(frames);
      
      if (result && result.frames > 0 && result.data) {
        // Deinterleave stereo data
        const left = new Float32Array(result.frames);
        const right = new Float32Array(result.frames);
        
        for (let i = 0; i < result.frames; i++) {
          left[i] = result.data[i * 2];
          right[i] = result.data[i * 2 + 1];
        }
        
        postMessage({ type: 'pcm', left, right, frames: result.frames });
      } else {
        // No more data available - song has ended
        log('MOD playback ended - no more PCM data available');
        postMessage({ type: 'pcm', left: new Float32Array(0), right: new Float32Array(0), frames: 0 });
        postMessage({ type: 'song-ended' }); // Signal that the song has ended
      }
    }
  } catch (error) {
    log(`Unexpected error: ${error.message}`);
    postMessage({ type: 'error', message: error.message });
  }
};
