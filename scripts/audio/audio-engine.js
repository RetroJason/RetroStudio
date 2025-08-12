// audio-engine.js
// MOD file upload, list, and play/pause integration using openmpt.js

let audioCtx;
let workletNode;
let modFiles = [];
let wavFiles = [];
let selectedModIdx = null;
let modWorker = null;
let isPlaying = false;
let modPCMBuffer = [];
let modPCMPos = 0;
let modPCMBlockSize = 2048;

async function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.audioWorklet.addModule('scripts/audio/mixer-worklet.js');
    workletNode = new AudioWorkletNode(audioCtx, 'mixer-worklet');
    workletNode.connect(audioCtx.destination);
    
    // Handle worklet messages
    workletNode.port.onmessage = (e) => {
      if (e.data.type === 'request-pcm' && modWorker && isPlaying) {
        // Worklet is requesting more PCM data
        modWorker.postMessage({ type: 'get-pcm', frames: e.data.frames });
      }
    };
  }
}

function setupModWorker() {
  if (!modWorker) {
    modWorker = new Worker('scripts/audio/openmpt-integration.js');
    modWorker.onmessage = (e) => {
      const status = document.getElementById('status');
      
      if (e.data.type === 'log') {
        console.log(e.data.message);
        status.textContent = e.data.message.replace('[ModWorker] ', '');
      } else if (e.data.type === 'error') {
        console.error('MOD Worker Error:', e.data.message);
        status.textContent = `Error: ${e.data.message}`;
        status.style.color = 'red';
        document.getElementById('playBtn').disabled = true;
        document.getElementById('pauseBtn').disabled = true;
      } else if (e.data.type === 'mod-loaded') {
        // MOD loaded, ready to play
        document.getElementById('playBtn').disabled = false;
        document.getElementById('pauseBtn').disabled = false;
        status.textContent = `Ready: ${e.data.title || 'Unknown'}`;
        status.style.color = 'green';
        if (e.data.duration) {
          status.textContent += ` (${Math.round(e.data.duration)}s)`;
        }
      } else if (e.data.type === 'pcm') {
        // PCM data received, send to mixer
        if (e.data.frames > 0) {
          workletNode.port.postMessage({
            type: 'play',
            streamId: 'mod-stream',
            channels: [e.data.left, e.data.right],
            sampleRate: audioCtx.sampleRate
          });
          // Don't immediately request next block - let the mixer worklet request when needed
        } else {
          // End of track
          isPlaying = false;
          document.getElementById('playBtn').disabled = false;
        }
      }
    };
    modWorker.onerror = (error) => {
      console.error('MOD worker error:', error);
      isPlaying = false;
    };
  }
}

// Handle MOD file input
const modFileInput = document.getElementById('modFileInput');
const modList = document.getElementById('modList');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');

// Handle WAV file input
const wavFileInput = document.getElementById('wavFileInput');
const wavList = document.getElementById('wavList');

modFileInput.addEventListener('change', async (e) => {
  const status = document.getElementById('status');
  status.textContent = 'Loading files...';
  status.style.color = 'blue';
  
  modFiles = [];
  modList.innerHTML = '';
  
  try {
    for (let i = 0; i < e.target.files.length; i++) {
      const file = e.target.files[i];
      status.textContent = `Loading ${file.name} (${i + 1}/${e.target.files.length})...`;
      
      const arrayBuffer = await file.arrayBuffer();
      modFiles.push({ name: file.name, arrayBuffer });
      
      const li = document.createElement('li');
      li.textContent = file.name;
      li.onclick = () => selectMod(modFiles.length - 1);
      modList.appendChild(li);
    }
    
    if (modFiles.length > 0) {
      status.textContent = `${modFiles.length} files loaded. Select one to play.`;
      status.style.color = 'black';
      selectMod(0);
    } else {
      status.textContent = 'No files loaded';
      status.style.color = 'gray';
    }
  } catch (error) {
    status.textContent = `Error loading files: ${error.message}`;
    status.style.color = 'red';
  }
});

function selectMod(idx) {
  selectedModIdx = idx;
  // Highlight selected
  Array.from(modList.children).forEach((li, i) => {
    li.classList.toggle('selected', i === idx);
  });
  // Load into worker
  setupModWorker();
  const status = document.getElementById('status');
  status.textContent = 'Loading MOD file...';
  status.style.color = 'blue';
  
  modWorker.postMessage({
    type: 'load-mod',
    arrayBuffer: modFiles[idx].arrayBuffer,
    sampleRate: audioCtx ? audioCtx.sampleRate : 48000
  });
}

playBtn.onclick = async () => {
  if (selectedModIdx === null) return;
  await initAudio();
  setupModWorker();
  isPlaying = true;
  
  // Tell worklet to start playing
  workletNode.port.postMessage({ type: 'start-playing' });
  
  // Request initial PCM data
  modWorker.postMessage({ type: 'get-pcm', frames: modPCMBlockSize });
};

pauseBtn.onclick = () => {
  isPlaying = false;
  // Stop the stream in the mixer
  if (workletNode) {
    workletNode.port.postMessage({ type: 'stop-stream', streamId: 'mod-stream' });
  }
};

// Volume slider handling
const volumeSlider = document.getElementById('volumeSlider');
const volumeDisplay = document.getElementById('volumeDisplay');

function updateVolume() {
  const volume = volumeSlider.value / 100; // Convert percentage to 0.0-2.0 range
  volumeDisplay.textContent = `${volumeSlider.value}%`;
  
  if (workletNode) {
    workletNode.port.postMessage({ type: 'set-volume', volume: volume });
  }
}

volumeSlider.addEventListener('input', updateVolume);

// Set initial volume
updateVolume();

// WAV file handling
async function decodeWavFile(arrayBuffer, fileName) {
  try {
    await initAudio(); // Ensure audio context is ready
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    return {
      name: fileName,
      audioBuffer: audioBuffer,
      duration: audioBuffer.duration
    };
  } catch (error) {
    console.error(`Error decoding WAV file ${fileName}:`, error);
    throw error;
  }
}

function playWavFile(wavFile) {
  if (!workletNode || !wavFile.audioBuffer) return;
  
  console.log(`Playing WAV: ${wavFile.name}`);
  
  // Convert AudioBuffer to Float32Arrays for each channel
  const channels = [];
  for (let ch = 0; ch < wavFile.audioBuffer.numberOfChannels; ch++) {
    channels.push(wavFile.audioBuffer.getChannelData(ch));
  }
  
  // Send to mixer as one-shot buffer (no streamId = one-shot playback)
  workletNode.port.postMessage({
    type: 'play',
    channels: channels,
    sampleRate: wavFile.audioBuffer.sampleRate
  });
}

function createWavControls(wavFile, index) {
  const wavItem = document.createElement('div');
  wavItem.className = 'wav-item';
  
  const nameSpan = document.createElement('span');
  nameSpan.className = 'name';
  nameSpan.textContent = `${wavFile.name} (${wavFile.duration.toFixed(1)}s)`;
  
  const playButton = document.createElement('button');
  playButton.textContent = 'Play';
  playButton.onclick = () => playWavFile(wavFile);
  
  wavItem.appendChild(nameSpan);
  wavItem.appendChild(playButton);
  
  return wavItem;
}

wavFileInput.addEventListener('change', async (e) => {
  const status = document.getElementById('status');
  
  try {
    for (let i = 0; i < e.target.files.length; i++) {
      const file = e.target.files[i];
      status.textContent = `Decoding ${file.name}...`;
      status.style.color = 'blue';
      
      const arrayBuffer = await file.arrayBuffer();
      const wavFile = await decodeWavFile(arrayBuffer, file.name);
      
      wavFiles.push(wavFile);
      
      const controls = createWavControls(wavFile, wavFiles.length - 1);
      wavList.appendChild(controls);
    }
    
    status.textContent = `${wavFiles.length} WAV files loaded`;
    status.style.color = 'green';
  } catch (error) {
    status.textContent = `Error loading WAV files: ${error.message}`;
    status.style.color = 'red';
  }
});
