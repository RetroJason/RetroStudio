class ModXmTrackerEditor extends EditorBase {
  constructor(fileObject = null, readOnly = false) {
    super(fileObject, readOnly);

    this._logPrefix = '[ModXmTrackerEditor]';
    this.catalogRoot = [];
    this.catalogStack = [];
    this.currentEntries = [];
    this.selectedEntry = null;
    this.importedContent = null;
    this.loadedFileName = fileObject?.filename || fileObject?.name || this.getFileName();
    this.rootReady = false;

    // A new music import should remain unsaved until an actual module is chosen and imported.
    this.isDirty = false;
    this.hasUnsavedChanges = false;
  }

  get audioEngine() {
    return window.serviceContainer?.get?.('audioEngine') || null;
  }

  ensureStateInitialized() {
    if (!Array.isArray(this.catalogRoot)) {
      this.catalogRoot = [];
    }
    if (!Array.isArray(this.catalogStack)) {
      this.catalogStack = [];
    }
    if (!Array.isArray(this.currentEntries)) {
      this.currentEntries = [];
    }
    if (typeof this.rootReady !== 'boolean') {
      this.rootReady = false;
    }
    if (!Object.prototype.hasOwnProperty.call(this, 'selectedEntry')) {
      this.selectedEntry = null;
    }
    if (!Object.prototype.hasOwnProperty.call(this, 'importedContent')) {
      this.importedContent = null;
    }
    if (!Object.prototype.hasOwnProperty.call(this, 'loadedFileName')) {
      this.loadedFileName = this.getFileName();
    }
    if (!Object.prototype.hasOwnProperty.call(this, 'previewViewer')) {
      this.previewViewer = null;
    }
    if (!Object.prototype.hasOwnProperty.call(this, 'previewArrayBuffer')) {
      this.previewArrayBuffer = null;
    }
    if (!Object.prototype.hasOwnProperty.call(this, 'previewModuleId')) {
      this.previewModuleId = null;
    }
    if (!Object.prototype.hasOwnProperty.call(this, 'activePreviewModuleId')) {
      this.activePreviewModuleId = null;
    }
    if (!Object.prototype.hasOwnProperty.call(this, 'previewLoadingModuleId')) {
      this.previewLoadingModuleId = null;
    }
  }

  static getFileExtensions() { return ['.mod', '.xm', '.s3m', '.it']; }
  static getFileExtension() { return '.mod'; }
  static getDisplayName() { return 'Music Importer'; }
  static getIcon() { return '🎵'; }
  static getCreateIcon() { return '🎵'; }
  static getPriority() { return 5; }
  static getCapabilities() { return ['audio', 'music', 'import']; }
  static getCreateLabel() { return 'Music'; }
  static getDefaultFolder() { return 'Music'; }
  static needsFilenamePrompt() { return false; }
  static canCreate = true;

  createBody(body) {
    this.ensureStateInitialized();

    body.innerHTML = `
      <style>
        .music-importer {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          background: #121416;
          color: #e6edf3;
          font-family: 'Segoe UI', sans-serif;
        }

        .music-importer__toolbar {
          display: flex;
          gap: 10px;
          align-items: center;
          padding: 12px;
          border-bottom: 1px solid #2a2f36;
          background: #171b20;
        }

        .music-importer__toolbar button,
        .music-importer__toolbar input {
          border-radius: 6px;
          border: 1px solid #3a4048;
          background: #1d232a;
          color: #e6edf3;
          padding: 8px 10px;
          font-size: 13px;
        }

        .music-importer__toolbar button {
          cursor: pointer;
        }

        .music-importer__toolbar button:hover {
          background: #28303a;
        }

        .music-importer__toolbar input {
          flex: 1;
          min-width: 180px;
        }

        .music-importer__content {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
        }

        .music-importer__browser {
          display: grid;
          grid-template-columns: minmax(420px, 1fr) 320px;
          gap: 0;
          flex: 1;
          min-height: 0;
        }

        .music-importer__list {
          overflow: auto;
          padding: 14px;
          border-right: 1px solid #2a2f36;
        }

        .music-importer__list-title {
          margin: 0 0 12px;
          font-size: 15px;
          color: #f1f5f9;
        }

        .music-importer__entry-row {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
          align-items: stretch;
          margin-bottom: 8px;
        }

        .music-importer__entry-play,
        .music-importer__entry {
          border: 1px solid #313843;
          border-radius: 10px;
          background: #171d24;
          color: inherit;
        }

        .music-importer__entry-play {
          min-width: 84px;
          padding: 0 12px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }

        .music-importer__entry-play:hover:not(:disabled) {
          background: #233449;
          border-color: #4d77a4;
        }

        .music-importer__entry-play.is-active {
          background: #2f6fb3;
          border-color: #63a0df;
          color: #f7fbff;
        }

        .music-importer__entry-play:disabled {
          opacity: 0.6;
          cursor: default;
        }

        .music-importer__entry {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          width: 100%;
          padding: 10px 12px;
          text-align: left;
          cursor: pointer;
        }

        .music-importer__entry:hover {
          background: #202a34;
          border-color: #3f546a;
        }

        .music-importer__entry.is-selected {
          background: #233449;
          border-color: #4d77a4;
        }

        .music-importer__title {
          font-size: 13px;
          line-height: 1.35;
        }

        .music-importer__meta {
          font-size: 11px;
          color: #9aa4af;
          align-self: center;
          text-align: right;
        }

        .music-importer__details {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .music-importer__details {
          padding: 16px;
          overflow: auto;
          background: linear-gradient(180deg, #15191e 0%, #12161b 100%);
          align-content: start;
        }

        .music-importer__preview-card {
          position: sticky;
          top: 0;
          z-index: 2;
        }

        .music-importer__panel {
          border: 1px solid #2b3139;
          border-radius: 10px;
          background: #171b20;
          padding: 14px;
        }

        .music-importer__panel h3 {
          margin: 0 0 10px;
          font-size: 14px;
        }

        .music-importer__panel p,
        .music-importer__panel a,
        .music-importer__panel li {
          font-size: 13px;
          line-height: 1.45;
          color: #c7d0d9;
        }

        .music-importer__panel a {
          color: #8bc5ff;
        }

        .music-importer__status {
          min-height: 18px;
          font-size: 12px;
          color: #9aa4af;
        }

        .music-importer__status.is-error {
          color: #ff8a8a;
        }

        .music-importer__actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .music-importer__actions button {
          border-radius: 6px;
          border: 1px solid #3a4048;
          background: #20262d;
          color: #e6edf3;
          padding: 9px 12px;
          cursor: pointer;
        }

        .music-importer__actions button.primary {
          background: #2f6fb3;
          border-color: #4a88ca;
        }

        .music-importer__actions button:disabled {
          opacity: 0.45;
          cursor: default;
        }

        .music-importer__empty {
          padding: 16px;
          color: #9aa4af;
          font-size: 13px;
        }

        .music-importer__preview-host {
          min-height: 180px;
          max-height: 220px;
          border: 1px solid #2b3139;
          border-radius: 8px;
          overflow: hidden;
          background: #101418;
        }

        .music-importer__preview-frame {
          border: 1px solid #2b3139;
          border-radius: 12px;
          padding: 10px;
          background: rgba(18, 22, 27, 0.9);
          box-shadow: 0 16px 32px rgba(0, 0, 0, 0.22);
        }

        .music-importer__preview-host .mod-player {
          width: 100%;
          min-width: 0;
          padding: 10px;
          gap: 8px;
          box-sizing: border-box;
        }

        .music-importer__preview-host .song-title {
          padding: 0;
          margin-bottom: 2px;
        }

        .music-importer__preview-host .song-title h3 {
          font-size: 15px;
          line-height: 1.2;
          margin: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .music-importer__preview-host .waveform-display {
          min-height: 82px;
          max-height: 82px;
          margin: 0;
        }

        .music-importer__preview-host .waveform-display canvas {
          width: 100% !important;
          height: 82px !important;
          display: block;
        }

        .music-importer__preview-host .player-main {
          padding: 8px 10px;
          gap: 8px;
        }

        .music-importer__preview-host .progress-container {
          gap: 8px;
        }

        .music-importer__preview-host .play-pause-button {
          width: 40px;
          height: 40px;
          min-width: 40px;
          min-height: 40px;
        }

        .music-importer__preview-host .play-pause-button .play-icon {
          font-size: 16px;
        }

        .music-importer__preview-host .time-display,
        .music-importer__preview-host .volume-container,
        .music-importer__preview-host .song-info,
        .music-importer__preview-host .info-item,
        .music-importer__preview-host .info-item strong,
        .music-importer__preview-host .info-item span {
          font-size: 11px;
        }

        .music-importer__preview-host .volume-container {
          gap: 8px;
        }

        .music-importer__preview-host .volume-container label {
          min-width: auto;
        }

        @media (max-width: 1100px) {
          .music-importer__browser {
            grid-template-columns: 1fr;
          }

          .music-importer__list {
            border-right: 0;
            border-bottom: 1px solid #2a2f36;
          }

          .music-importer__preview-card {
            position: static;
          }

          .music-importer__preview-host {
            max-height: none;
          }
        }

        .music-importer__preview-host .viewer-content,
        .music-importer__preview-host .viewer-body {
          height: 100%;
        }
      </style>
      <div class="music-importer">
        <div class="music-importer__toolbar">
          <button type="button" data-action="random">Random Pick</button>
          <input type="text" data-role="search" placeholder="Search ModArchive by song title">
          <button type="button" data-action="search">Search</button>
        </div>
        <div class="music-importer__content">
          <div class="music-importer__browser">
            <div class="music-importer__list" data-role="list"></div>
            <div class="music-importer__details">
              <div class="music-importer__preview-card">
                <div class="music-importer__preview-frame">
                  <div class="music-importer__preview-host" data-role="preview"></div>
                </div>
              </div>
              <div class="music-importer__panel">
                <h3>Music</h3>
                <div data-role="summary"></div>
              </div>
              <div class="music-importer__panel">
                <h3>Selection</h3>
                <div data-role="details"></div>
              </div>
              <div class="music-importer__panel">
                <h3>Actions</h3>
                <div class="music-importer__actions">
                  <button type="button" class="primary" data-action="import" disabled>Import To Project</button>
                  <button type="button" data-action="open-link" disabled>Open ModArchive Page</button>
                </div>
                <div class="music-importer__status" data-role="status"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.rootElement = body.querySelector('.music-importer');
    this.listElement = body.querySelector('[data-role="list"]');
    this.summaryElement = body.querySelector('[data-role="summary"]');
    this.detailsElement = body.querySelector('[data-role="details"]');
    this.previewElement = body.querySelector('[data-role="preview"]');
    this.statusElement = body.querySelector('[data-role="status"]');
    this.searchInput = body.querySelector('[data-role="search"]');
    this.importButton = body.querySelector('[data-action="import"]');
    this.openLinkButton = body.querySelector('[data-action="open-link"]');

    this.initializePreviewViewer();

    body.querySelector('[data-action="random"]').addEventListener('click', () => {
      this.pickRandomModule().catch((error) => this.showError(error));
    });
    body.querySelector('[data-action="search"]').addEventListener('click', () => {
      this.searchCatalog().catch((error) => this.showError(error));
    });
    this.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.searchCatalog().catch((error) => this.showError(error));
      }
    });
    this.importButton.addEventListener('click', () => {
      this.importSelectedModule().catch((error) => this.showError(error));
    });
    this.openLinkButton.addEventListener('click', () => {
      this.openSelectedModulePage();
    });

    this.renderSummary();
    this.renderSelection();
    this.loadRoot().catch((error) => this.showError(error));
  }

  initializePreviewViewer() {
    if (!this.previewElement) {
      throw new Error('Music preview host is missing.');
    }
    if (this.previewViewer) {
      return;
    }
    if (typeof window.ModViewer !== 'function') {
      throw new Error('MOD preview viewer is not available.');
    }

    this.previewViewer = new window.ModViewer('__modarchive_preview__.mod', {
      deferLoad: true,
      displayName: 'Music Preview',
      initialStatus: 'Select a module to preview.',
      initialFormat: 'MOD File',
      onPlaybackStateChange: () => {
        this.renderEntries(this.currentEntries);
      },
    });
    this.previewElement.innerHTML = '';
    this.previewElement.appendChild(this.previewViewer.getElement());
  }

  getContent() {
    return this.importedContent || new Uint8Array();
  }

  async save() {
    if (!(this.importedContent instanceof Uint8Array) || this.importedContent.length === 0) {
      this.setStatus('No music module selected yet. Choose a track before saving.', true);
      this.isDirty = false;
      this.hasUnsavedChanges = false;
      return false;
    }

    return super.save();
  }

  setContent(content) {
    if (content instanceof Uint8Array) {
      this.importedContent = content;
      return;
    }
    if (content instanceof ArrayBuffer) {
      this.importedContent = new Uint8Array(content);
      return;
    }
    throw new Error('[MusicImporter] Unsupported content type for music module');
  }

  async loadRoot() {
    this.setStatus('Loading top 20 ModArchive picks...');
    this.catalogRoot = await this.fetchRootCatalog();
    const topEntries = await this.loadEntriesForRoute('top-rated', ['top-rated']);
    this.catalogStack = [
      { label: 'ModArchive', entries: this.catalogRoot, kind: 'root' },
      { label: 'Top 20 Rated', entries: topEntries, route: 'top-rated', kind: 'browse', baseParts: ['top-rated'] },
    ];
    this.selectedEntry = null;
    this.rootReady = true;
    this.renderEntries(topEntries);
    this.renderSummary();
    this.renderSelection();
    this.setStatus('Loaded top 20 ModArchive picks.');
  }

  async navigateBack() {
    if (this.catalogStack.length <= 1) {
      return;
    }

    this.catalogStack.pop();
    const current = this.catalogStack[this.catalogStack.length - 1];
    this.selectedEntry = null;
    this.renderEntries(current.entries);
    this.renderSummary();
    this.renderSelection();
    this.setStatus(`Viewing ${current.label}.`);
  }

  async refreshCurrentView() {
    if (!this.rootReady || this.catalogStack.length === 0) {
      await this.loadRoot();
      return;
    }

    const current = this.catalogStack[this.catalogStack.length - 1];
    if (current.kind === 'root') {
      await this.loadRoot();
      return;
    }

    const refreshedEntries = await this.loadEntriesForRoute(current.route, current.baseParts);
    current.entries = refreshedEntries;
    this.selectedEntry = null;
    this.renderEntries(refreshedEntries);
    this.renderSummary();
    this.renderSelection();
    this.setStatus(`Refreshed ${current.label}.`);
  }

  async searchCatalog() {
    const query = this.searchInput.value.trim();
    if (!query) {
      throw new Error('Search query is required.');
    }

    this.setStatus(`Searching ModArchive for "${query}"...`);

    const route = `search/${encodeURIComponent(query)}`;
    const entries = await this.loadEntriesForRoute(route, ['search', query]);
    this.catalogStack = [
      { label: 'ModArchive', entries: this.catalogRoot, kind: 'root' },
      { label: `Search: ${query}`, entries, route, kind: 'search', baseParts: ['search', query] },
    ];
    this.selectedEntry = null;
    this.renderEntries(entries);
    this.renderSummary();
    this.renderSelection();
    this.setStatus(`Loaded search results for "${query}".`);
  }

  async pickRandomModule() {
    this.setStatus('Loading a random ModArchive selection...');
    const entries = await this.loadEntriesForRoute('random-list', ['random-list']);
    const selectedEntry = entries[Math.floor(Math.random() * entries.length)] || null;

    this.catalogStack = [
      { label: 'ModArchive', entries: this.catalogRoot, kind: 'root' },
      { label: 'Random 20', entries, route: 'random-list', kind: 'browse', baseParts: ['random-list'] },
    ];
    this.selectedEntry = selectedEntry;
    this.renderEntries(entries);
    this.renderSummary();
    this.renderSelection();
    this.setStatus(`Picked ${selectedEntry.title}.`);
  }

  async openEntry(entry) {
    if (!entry) {
      return;
    }

    if (entry.kind === 'download') {
      this.selectedEntry = entry;
      this.renderEntries(this.currentEntries);
      this.renderSelection();
      this.previewSelectedModule(entry)
        .then(() => {
          this.setStatus(`Preview ready for ${entry.title}.`);
          this.renderEntries(this.currentEntries);
        })
        .catch((error) => this.showError(error));
      return;
    }

    if (!entry.route) {
      throw new Error(`Entry has no route: ${entry.title}`);
    }

    const entries = await this.loadEntriesForRoute(entry.route, entry.baseParts);
    this.catalogStack.push({
      label: entry.title,
      entries,
      route: entry.route,
      kind: 'browse',
      baseParts: entry.baseParts,
    });
    this.selectedEntry = null;
    this.renderEntries(entries);
    this.renderSummary();
    this.renderSelection();
    this.setStatus(`Loaded ${entry.title}.`);
  }

  renderEntries(entries) {
    this.ensureStateInitialized();
    this.currentEntries = Array.isArray(entries) ? entries : [];
    this.listElement.innerHTML = '';

    const heading = document.createElement('h3');
    heading.className = 'music-importer__list-title';
    heading.textContent = 'Browse Modules';
    this.listElement.appendChild(heading);

    if (this.currentEntries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'music-importer__empty';
      empty.textContent = 'No entries found.';
      this.listElement.appendChild(empty);
      return;
    }

    this.currentEntries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'music-importer__entry-row';

      const playButton = document.createElement('button');
      playButton.type = 'button';
      playButton.className = 'music-importer__entry-play';

      const isDownload = entry.kind === 'download';
      const isActiveModule = isDownload && this.activePreviewModuleId === entry.moduleId;
      const isPlayingModule = isActiveModule && this.previewViewer && this.previewViewer.isPlaying;
      const isLoadingModule = isDownload && this.previewLoadingModuleId === entry.moduleId;

      if (!isDownload) {
        playButton.disabled = true;
        playButton.textContent = 'Open';
      } else if (isLoadingModule) {
        playButton.disabled = true;
        playButton.textContent = 'Loading';
      } else if (isPlayingModule) {
        playButton.classList.add('is-active');
        playButton.textContent = 'Pause';
      } else {
        playButton.textContent = 'Play';
      }

      playButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!isDownload) {
          this.openEntry(entry).catch((error) => this.showError(error));
          return;
        }

        this.toggleEntryPlayback(entry).catch((error) => this.showError(error));
      });

      row.appendChild(playButton);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'music-importer__entry';
      if (this.selectedEntry === entry) {
        button.classList.add('is-selected');
      }

      const title = document.createElement('div');
      title.className = 'music-importer__title';
      title.textContent = entry.title;
      button.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'music-importer__meta';
      meta.textContent = entry.info || entry.icon || '';
      button.appendChild(meta);

      button.addEventListener('click', () => {
        this.openEntry(entry).catch((error) => this.showError(error));
      });

      row.appendChild(button);
      this.listElement.appendChild(row);
    });
  }

  renderSummary() {
    this.ensureStateInitialized();
    const current = this.catalogStack[this.catalogStack.length - 1];
    const location = current ? current.label : 'ModArchive';
    const fileLabel = this.path ? this.path : 'New music import';

    this.summaryElement.innerHTML = `
      <p><strong>Current view:</strong> ${this.escapeHtml(location)}</p>
      <p><strong>Target file:</strong> ${this.escapeHtml(fileLabel)}</p>
      <p><strong>Workflow:</strong> Preview from the list, keep one module active at a time, then import the track you want into your project.</p>
    `;
  }

  renderSelection() {
    this.ensureStateInitialized();
    if (!this.selectedEntry) {
      this.detailsElement.innerHTML = `
        <p>Select a module to stage it in the large preview player.</p>
        <p>Existing MOD/XM editing is disabled; this front end is now strictly for importing music from ModArchive.</p>
      `;
      if (this.previewViewer) {
        this.previewViewer.clearLoadedResource('Select a module to preview.', 'MOD File');
      }
      this.activePreviewModuleId = null;
      this.previewLoadingModuleId = null;
      this.importButton.disabled = true;
      this.openLinkButton.disabled = true;
      this.renderEntries(this.currentEntries);
      return;
    }

    const modulePageUrl = this.buildModulePageUrl(this.selectedEntry.moduleId);
    this.detailsElement.innerHTML = `
      <p><strong>Title:</strong> ${this.escapeHtml(this.selectedEntry.title)}</p>
      <p><strong>Format:</strong> ${this.escapeHtml(this.selectedEntry.format)}</p>
      <p><strong>Catalog info:</strong> ${this.escapeHtml(this.selectedEntry.details || this.selectedEntry.info || '')}</p>
      <p><strong>Suggested filename:</strong> ${this.escapeHtml(this.buildSuggestedFilename(this.selectedEntry))}</p>
      <p><strong>Source:</strong> ${this.escapeHtml(modulePageUrl)}</p>
      <p><strong>Preview:</strong> Use the row play button or the hero player controls above.</p>
    `;
    this.importButton.disabled = false;
    this.openLinkButton.disabled = false;
  }

  async previewSelectedModule(entry) {
    if (!entry || entry.kind !== 'download') {
      throw new Error('Select a downloadable music module to preview.');
    }
    if (!this.previewViewer) {
      throw new Error('Music preview viewer is not initialized.');
    }
    if (!this.audioEngine) {
      throw new Error('Audio engine not available.');
    }

    const filename = this.buildSuggestedFilename(entry);
    const formatName = this.getFormatDisplayName(entry.format);

    this.previewLoadingModuleId = entry.moduleId;
    this.renderEntries(this.currentEntries);

    try {
      await this.previewViewer.setResourceLoader(async () => {
        const buffer = await this.fetchModuleArrayBuffer(entry);
        const resourceId = await this.audioEngine.loadResource(buffer.slice(0), 'mod', filename);
        const resource = this.audioEngine.getResource(resourceId);
        if (!resource) {
          throw new Error(`Preview resource not found after load: ${resourceId}`);
        }

        this.previewArrayBuffer = buffer;
        this.previewModuleId = entry.moduleId;

        return {
          resourceId,
          resource,
          title: entry.title,
          format: formatName,
          status: 'Preview ready.',
          ownsResource: true,
        };
      }, {
        displayName: entry.title,
        formatName,
        initialStatus: `Loading preview for ${entry.title}...`,
      });

      this.activePreviewModuleId = entry.moduleId;
    } finally {
      if (this.previewLoadingModuleId === entry.moduleId) {
        this.previewLoadingModuleId = null;
      }
      this.renderEntries(this.currentEntries);
    }
  }

  async toggleEntryPlayback(entry) {
    if (!entry || entry.kind !== 'download') {
      throw new Error('Select a downloadable music module to preview.');
    }
    if (!this.previewViewer) {
      throw new Error('Music preview viewer is not initialized.');
    }

    this.selectedEntry = entry;
    this.renderSelection();

    const isCurrentModule = this.activePreviewModuleId === entry.moduleId;
    const hasLoadedPreview = isCurrentModule && this.previewViewer.audioResource;
    const isPlayingCurrent = hasLoadedPreview && this.previewViewer.isPlaying;

    if (isPlayingCurrent) {
      this.previewViewer.stopPlayback();
      this.setStatus(`Paused ${entry.title}.`);
      this.renderEntries(this.currentEntries);
      return;
    }

    if (!hasLoadedPreview) {
      await this.previewSelectedModule(entry);
    }

    await this.previewViewer.togglePlayback();
    this.setStatus(`${this.previewViewer.isPlaying ? 'Playing' : 'Ready'} ${entry.title}.`);
    this.renderEntries(this.currentEntries);
  }

  async fetchModuleArrayBuffer(entry) {
    if (!entry || entry.kind !== 'download') {
      throw new Error('Select a downloadable music module first.');
    }

    if (
      this.previewModuleId === entry.moduleId &&
      this.previewArrayBuffer instanceof ArrayBuffer &&
      this.previewArrayBuffer.byteLength > 0
    ) {
      return this.previewArrayBuffer;
    }

    const response = await fetch(entry.downloadUrl, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Failed to download module: HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
      throw new Error(`Downloaded module is empty: ${entry.title}`);
    }

    this.previewArrayBuffer = buffer;
    this.previewModuleId = entry.moduleId;
    return buffer;
  }

  async importSelectedModule() {
    const entry = this.selectedEntry;
    if (!entry || entry.kind !== 'download') {
      throw new Error('Select a downloadable music module first.');
    }

    this.setStatus(`Downloading ${entry.title}...`);

    const buffer = await this.fetchModuleArrayBuffer(entry);
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
      throw new Error(`Downloaded module is empty: ${entry.title}`);
    }

    this.importedContent = new Uint8Array(buffer);
    const filename = this.buildSuggestedFilename(entry);

    if (this.isNewResource) {
      await this.saveNewResource(this.importedContent, filename);
      this.loadedFileName = filename;
    } else {
      this.loadedFileName = this.getFileName();
      await this.saveExistingResource(this.importedContent);
      this.markClean();
    }

    this.setStatus(`Imported ${entry.title} into ${this.path || filename}.`);
    this.renderSummary();
  }

  openSelectedModulePage() {
    if (!this.selectedEntry || !this.selectedEntry.moduleId) {
      return;
    }

    const url = this.buildModulePageUrl(this.selectedEntry.moduleId);
    window.open(url, '_blank', 'noopener');
  }

  async fetchRootCatalog() {
    return [
      {
        kind: 'route',
        title: 'Top 20 Rated',
        info: 'Default list',
        route: 'top-rated',
        baseParts: ['top-rated'],
      },
      {
        kind: 'route',
        title: 'Random 20',
        info: 'Fresh shuffle',
        route: 'random-list',
        baseParts: ['random-list'],
      },
    ];
  }

  async loadEntriesForRoute(route, baseParts = null) {
    if (!route) {
      throw new Error('Missing catalog route.');
    }

    const parts = Array.isArray(baseParts) && baseParts.length > 0 ? baseParts : route.split('/');
    const section = parts[0];

    const searchParams = new URLSearchParams();
    if (section === 'top-rated') {
      searchParams.set('action', 'top-rated');
    } else if (section === 'random-list') {
      searchParams.set('action', 'random-list');
    } else if (section === 'search') {
      searchParams.set('action', 'search');
      searchParams.set('query', parts.slice(1).join('/'));
    } else {
      throw new Error(`Unsupported ModArchive route: ${route}`);
    }

    const response = await fetch(`${this.getApiBaseUrl()}?${searchParams.toString()}`, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Failed to load ModArchive route ${route}: HTTP ${response.status}`);
    }
    const data = await response.json();
    const entries = Array.isArray(data?.entries) ? data.entries : null;
    if (!entries) {
      throw new Error(`ModArchive route ${route} returned an invalid payload.`);
    }

    return entries.map((entry) => this.createDownloadEntry(entry));
  }

  getApiBaseUrl() {
    return '/api/retrostudio/modarchive';
  }

  buildDownloadProxyUrl(moduleId) {
    const searchParams = new URLSearchParams({
      action: 'download',
      moduleId: String(moduleId || ''),
    });
    return `${this.getApiBaseUrl()}?${searchParams.toString()}`;
  }

  createDownloadEntry({ title, format, moduleId, info = '', details = '', downloadUrl = null }) {
    const normalizedFormat = String(format || '').toLowerCase();
    if (!normalizedFormat) {
      throw new Error(`Missing music format for ${title}`);
    }

    const normalizedModuleId = String(moduleId || '').trim();
    if (!normalizedModuleId) {
      throw new Error(`Missing module id for ${title}`);
    }

    return {
      kind: 'download',
      title: title || '---',
      info,
      details,
      format: normalizedFormat,
      moduleId: normalizedModuleId,
      downloadUrl: downloadUrl || this.buildDownloadProxyUrl(normalizedModuleId),
    };
  }

  buildSuggestedFilename(entry) {
    const extension = this.mapFormatToExtension(entry.format);
    const baseName = this.slugify(entry.title || `module_${entry.moduleId}`);
    return `${baseName}.${extension}`;
  }

  mapFormatToExtension(format) {
    const normalized = String(format || '').toLowerCase();
    if (['mod', 'xm', 's3m', 'it', 'mptm'].includes(normalized)) {
      return normalized;
    }
    throw new Error(`Unsupported music format: ${format}`);
  }

  getFormatDisplayName(format) {
    const normalized = `.${String(format || '').toLowerCase()}`;
    const names = {
      '.mod': 'ProTracker MOD',
      '.xm': 'FastTracker II Extended Module',
      '.s3m': 'Scream Tracker 3 Module',
      '.it': 'Impulse Tracker Module',
      '.mptm': 'OpenMPT Module',
    };

    const displayName = names[normalized];
    if (!displayName) {
      throw new Error(`Unsupported music format: ${format}`);
    }

    return displayName;
  }

  buildModulePageUrl(moduleId) {
    return `https://modarchive.org/index.php?request=view_by_moduleid&query=${moduleId}`;
  }

  slugify(value) {
    const slug = String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return slug || 'module';
  }

  formatFileSize(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`Invalid file size: ${bytes}`);
    }
    if (size < 1024) {
      return `${size} B`;
    }
    if (size < 1024 * 1024) {
      return `${Math.round(size / 1024)} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  setStatus(message, isError = false) {
    if (!this.statusElement) {
      return;
    }
    this.statusElement.textContent = message;
    this.statusElement.classList.toggle('is-error', isError);
  }

  showError(error) {
    console.error(this._logPrefix, error);
    this.setStatus(error.message || String(error), true);
  }

  destroy() {
    if (this.previewViewer) {
      this.previewViewer.destroy();
      this.previewViewer = null;
    }

    super.destroy();
  }

  escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

window.ModXmTrackerEditor = ModXmTrackerEditor;

ModXmTrackerEditor.registerComponent();