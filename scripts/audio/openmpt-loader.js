// openmpt-loader.js
// Loads openmpt.js and provides a helper to decode MOD files to PCM

// This script expects openmpt.js and openmpt.wasm to be in the same directory.

let openmptModulePromise = null;

function loadOpenMPT() {
  if (!openmptModulePromise) {
    openmptModulePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'openmpt.js';
      script.onload = () => {
        if (typeof window.Module !== 'undefined') {
          resolve(window.Module);
        } else {
          reject('openmpt.js loaded but Module not found');
        }
      };
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }
  return openmptModulePromise;
}

// Usage: await loadOpenMPT();
// Then use window.Module to create an openmpt instance
