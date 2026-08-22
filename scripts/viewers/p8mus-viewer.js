/**
 * PICO-8 Music Viewer (.p8mus)
 *
 * Renders an imported PICO-8 song to audio using the shared PicoAudio module
 * (scripts/audio/pico-audio.js) and plays it back through Web Audio, mirroring
 * the behaviour validated in sandbox/pico8-converter-lab.html.
 */

class P8MusViewer extends ViewerBase {
  constructor(pathOrFileObj, fullPath = null) {
    let actualPath;
    let fileData = null;

    if (typeof pathOrFileObj === 'string') {
      actualPath = pathOrFileObj;
    } else if (pathOrFileObj && typeof pathOrFileObj === 'object' && fullPath) {
      actualPath = fullPath;
      fileData = pathOrFileObj;
    } else {
      actualPath = pathOrFileObj || 'unknown';
    }

    super(actualPath);

    this.fileData = fileData;
    this.song = null;
    this.rendered = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.gainNode = null;
    this.playStartedAt = 0;
    this.animationFrame = null;
    this.volume = 0.8;
    this.patternRows = new Map();
  }

  static get SAMPLE_RATE() {
    return 44100;
  }

  createBody(bodyContainer) {
    if (!bodyContainer) {
      console.error('[P8MusViewer] No bodyContainer provided to createBody()');
      return;
    }

    bodyContainer.style.cssText = `
      flex: 1;
      width: 100%;
      height: 100%;
      min-height: 300px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: #1e1e1e;
      color: #d4d4d4;
      font-family: 'Segoe UI', system-ui, sans-serif;
    `;
    bodyContainer.innerHTML = '';

    this.bodyContainer = bodyContainer;

    this.infoEl = document.createElement('div');
    this.infoEl.style.cssText = 'padding: 10px 14px; border-bottom: 1px solid #333; font-size: 12px; line-height: 1.6;';
    this.infoEl.textContent = 'Loading song\u2026';
    bodyContainer.appendChild(this.infoEl);

    bodyContainer.appendChild(this.createTransport());

    this.patternListEl = document.createElement('div');
    this.patternListEl.style.cssText = 'flex: 1; overflow: auto; padding: 8px 14px 14px;';
    bodyContainer.appendChild(this.patternListEl);

    this.loadSong();
  }

  createTransport() {
    const bar = document.createElement('div');
    bar.style.cssText = `
      display: flex; align-items: center; gap: 10px;
      padding: 8px 14px; border-bottom: 1px solid #333; background: #252526;
    `;

    this.playButton = document.createElement('button');
    this.playButton.textContent = '\u25B6 Play';
    this.playButton.disabled = true;
    this.playButton.style.cssText = 'padding: 4px 14px; cursor: pointer; background: #0e639c; color: #fff; border: none; border-radius: 3px;';
    this.playButton.addEventListener('click', () => this.togglePlayback());
    bar.appendChild(this.playButton);

    this.stopButton = document.createElement('button');
    this.stopButton.textContent = '\u25A0 Stop';
    this.stopButton.disabled = true;
    this.stopButton.style.cssText = 'padding: 4px 14px; cursor: pointer; background: #3a3d41; color: #fff; border: none; border-radius: 3px;';
    this.stopButton.addEventListener('click', () => this.stopPlayback());
    bar.appendChild(this.stopButton);

    const volLabel = document.createElement('label');
    volLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 12px; margin-left: 8px;';
    volLabel.textContent = 'Volume';
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.value = String(Math.round(this.volume * 100));
    vol.style.width = '110px';
    vol.addEventListener('input', () => {
      this.volume = Number(vol.value) / 100;
      if (this.gainNode) {
        this.gainNode.gain.value = this.volume;
      }
    });
    volLabel.appendChild(vol);
    bar.appendChild(volLabel);

    this.timeEl = document.createElement('span');
    this.timeEl.style.cssText = 'margin-left: auto; font-family: Consolas, monospace; font-size: 12px; color: #9cdcfe;';
    this.timeEl.textContent = '0:00 / 0:00';
    bar.appendChild(this.timeEl);

    return bar;
  }

  async loadSong() {
    try {
      const content = await this.readFileContent();
      if (typeof PicoAudio === 'undefined') {
        throw new Error('PicoAudio module is not loaded');
      }

      this.song = PicoAudio.parseP8Mus(content);
      this.renderInfo();
      this.renderPatternList();

      this.playButton.disabled = false;
      this.updateTimeDisplay(0);
    } catch (error) {
      console.error('[P8MusViewer] Failed to load song:', error);
      this.infoEl.style.color = '#f48771';
      this.infoEl.textContent = `Failed to load PICO-8 music: ${error.message}`;
    }
  }

  async readFileContent() {
    if (this.fileData && this.fileData.fileContent) {
      return this.fileData.fileContent;
    }

    const fileManager = window.serviceContainer?.get?.('fileManager') || window.fileManager;
    if (!fileManager) {
      throw new Error('File manager is not available');
    }

    const loadedFile = await fileManager.loadFile(String(this.path).replace(/^test\//, ''));
    const content = loadedFile && loadedFile.fileContent;
    if (typeof content !== 'string') {
      throw new Error('File content is empty or not text');
    }
    return content;
  }

  renderInfo() {
    const song = this.song;
    const slotCount = Object.keys(song.slots || {}).length;
    const duration = song.patterns.reduce((total, pattern) => {
      const plan = PicoAudio.patternPlan(pattern, song.slots, P8MusViewer.SAMPLE_RATE);
      return total + plan.totalSamples / P8MusViewer.SAMPLE_RATE;
    }, 0);

    this.totalSeconds = duration;
    this.infoEl.innerHTML = '';

    const rows = [
      ['Song', song.name || this.fileName()],
      ['Source cart', song.sourceFile || 'unknown'],
      ['Patterns', `${song.patterns.length} (cart order ${song.start}\u2013${song.end})`],
      ['Loop', song.loopTo === null ? 'none' : `back to pattern ${song.loopTo}`],
      ['SFX slots used', String(slotCount)],
      ['Length', this.formatTime(duration)],
    ];

    for (const [label, value] of rows) {
      const row = document.createElement('div');
      const key = document.createElement('span');
      key.style.cssText = 'display: inline-block; width: 120px; color: #858585;';
      key.textContent = label;
      row.appendChild(key);
      row.appendChild(document.createTextNode(value));
      this.infoEl.appendChild(row);
    }
  }

  renderPatternList() {
    this.patternListEl.innerHTML = '';
    this.patternRows.clear();

    const header = document.createElement('div');
    header.style.cssText = 'display: grid; grid-template-columns: 60px 90px repeat(4, 1fr); gap: 8px; padding: 6px 8px; color: #858585; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;';
    ['Pattern', 'Flags', 'Ch 1', 'Ch 2', 'Ch 3', 'Ch 4'].forEach((title) => {
      const cell = document.createElement('div');
      cell.textContent = title;
      header.appendChild(cell);
    });
    this.patternListEl.appendChild(header);

    this.song.patterns.forEach((pattern, position) => {
      const row = document.createElement('div');
      row.style.cssText = 'display: grid; grid-template-columns: 60px 90px repeat(4, 1fr); gap: 8px; padding: 5px 8px; font-family: Consolas, monospace; font-size: 12px; border-radius: 3px;';

      const index = document.createElement('div');
      index.textContent = String(pattern.index);
      index.style.color = '#9cdcfe';
      row.appendChild(index);

      const flags = document.createElement('div');
      flags.textContent = this.formatFlags(pattern) || '\u2014';
      flags.style.color = '#c586c0';
      row.appendChild(flags);

      const channels = Array.isArray(pattern.channels) ? pattern.channels : [];
      for (let i = 0; i < 4; i += 1) {
        const cell = document.createElement('div');
        const slot = PicoAudio.channelSlot(channels[i], this.song.slots);
        if (!slot) {
          cell.textContent = '\u2014';
          cell.style.color = '#5a5a5a';
        } else {
          const slotIndex = typeof channels[i] === 'object' && channels[i] ? channels[i].slot : channels[i];
          cell.textContent = `sfx ${slotIndex}`;
          cell.style.color = PicoAudio.slotIsAudible(slot) ? '#ce9178' : '#5a5a5a';
        }
        row.appendChild(cell);
      }

      this.patternRows.set(position, row);
      this.patternListEl.appendChild(row);
    });
  }

  formatFlags(pattern) {
    const parts = [];
    if (pattern.loopStart || (pattern.flags & PicoAudio.FLAG_LOOP_START)) parts.push('start');
    if (pattern.loopEnd || (pattern.flags & PicoAudio.FLAG_LOOP_BACK)) parts.push('loop');
    if (pattern.stop || (pattern.flags & PicoAudio.FLAG_STOP)) parts.push('stop');
    return parts.join(' ');
  }

  async togglePlayback() {
    if (this.sourceNode) {
      this.stopPlayback();
      return;
    }
    await this.startPlayback();
  }

  async startPlayback() {
    if (!this.song) return;

    this.playButton.disabled = true;
    try {
      if (!this.rendered) {
        this.playButton.textContent = 'Rendering\u2026';
        // Yield so the button label paints before the synth blocks the thread.
        await new Promise((resolve) => setTimeout(resolve, 0));
        this.rendered = PicoAudio.renderSong(
          this.song.patterns,
          0,
          this.song.slots,
          P8MusViewer.SAMPLE_RATE
        );
      }

      if (!this.rendered.samples.length) {
        throw new Error('Song rendered to silence');
      }

      const ctx = this.ensureAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const buffer = ctx.createBuffer(1, this.rendered.samples.length, this.rendered.sampleRate);
      buffer.copyToChannel(this.rendered.samples, 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      if (this.rendered.loopStartSample !== null) {
        source.loop = true;
        source.loopStart = this.rendered.loopStartSample / this.rendered.sampleRate;
        source.loopEnd = buffer.duration;
      }

      const gain = ctx.createGain();
      gain.gain.value = this.volume;
      source.connect(gain);
      gain.connect(ctx.destination);

      source.onended = () => {
        if (this.sourceNode === source) {
          this.stopPlayback();
        }
      };

      this.sourceNode = source;
      this.gainNode = gain;
      this.playStartedAt = ctx.currentTime;
      source.start();

      this.playButton.textContent = '\u25A0 Stop';
      this.stopButton.disabled = false;
      this.trackPlayhead();
    } catch (error) {
      console.error('[P8MusViewer] Playback failed:', error);
      this.playButton.textContent = '\u25B6 Play';
    } finally {
      this.playButton.disabled = false;
    }
  }

  stopPlayback() {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    if (this.sourceNode) {
      const source = this.sourceNode;
      this.sourceNode = null;
      source.onended = null;
      try {
        source.stop();
      } catch (_) {
        // Already stopped.
      }
      source.disconnect();
    }

    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    if (this.playButton) this.playButton.textContent = '\u25B6 Play';
    if (this.stopButton) this.stopButton.disabled = true;
    this.highlightPattern(-1);
    this.updateTimeDisplay(0);
  }

  ensureAudioContext() {
    if (!this.audioContext) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new Ctor({ sampleRate: P8MusViewer.SAMPLE_RATE });
    }
    return this.audioContext;
  }

  trackPlayhead() {
    if (!this.sourceNode || !this.rendered) return;

    const total = this.rendered.samples.length / this.rendered.sampleRate;
    let elapsed = this.audioContext.currentTime - this.playStartedAt;

    if (this.sourceNode.loop) {
      const loopStart = this.sourceNode.loopStart;
      if (elapsed > total) {
        const loopLength = total - loopStart;
        elapsed = loopLength > 0 ? loopStart + ((elapsed - loopStart) % loopLength) : loopStart;
      }
    } else if (elapsed > total) {
      elapsed = total;
    }

    this.updateTimeDisplay(elapsed);

    const sample = elapsed * this.rendered.sampleRate;
    const position = this.rendered.timeline.findIndex(
      (entry) => sample >= entry.startSample && sample < entry.endSample
    );
    this.highlightPattern(position);

    this.animationFrame = requestAnimationFrame(() => this.trackPlayhead());
  }

  highlightPattern(position) {
    this.patternRows.forEach((row, key) => {
      const active = key === position;
      row.style.background = active ? '#094771' : 'transparent';
    });
  }

  updateTimeDisplay(elapsed) {
    if (!this.timeEl) return;
    const total = this.rendered
      ? this.rendered.samples.length / this.rendered.sampleRate
      : this.totalSeconds || 0;
    this.timeEl.textContent = `${this.formatTime(elapsed)} / ${this.formatTime(total)}`;
  }

  formatTime(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  fileName() {
    return String(this.path || '').split('/').pop() || 'untitled';
  }

  getDisplayName() {
    return 'PICO-8 Music';
  }

  async refreshContent() {
    this.stopPlayback();
    this.rendered = null;
    await this.loadSong();
  }

  onBlur() {
    this.stopPlayback();
  }

  dispose() {
    this.stopPlayback();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  destroy() {
    this.dispose();
    super.destroy();
  }
}

// Static metadata for auto-registration
P8MusViewer.getFileExtensions = () => ['.p8mus'];
P8MusViewer.getDisplayName = () => 'PICO-8 Music';
P8MusViewer.getIcon = () => '\uD83C\uDFB5';
P8MusViewer.getPriority = () => 10; // Beat SimpleTextViewer so .p8mus opens playable
P8MusViewer.getCapabilities = () => ['audio-playback', 'music'];

window.P8MusViewer = P8MusViewer;

if (typeof ComponentRegistry !== 'undefined') {
  P8MusViewer.registerComponent();
  console.log('[P8MusViewer] Registered with ComponentRegistry');
} else {
  setTimeout(() => {
    if (typeof ComponentRegistry !== 'undefined') {
      P8MusViewer.registerComponent();
      console.log('[P8MusViewer] Late registration successful');
    } else {
      console.error('[P8MusViewer] ComponentRegistry still not available after delay');
    }
  }, 1000);
}
