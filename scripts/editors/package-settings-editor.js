// package-settings-editor.js
// Dedicated UI editor for Sources/Package/app.package
// Package assets are stored under Sources/Package/...

class PackageSettingsEditor extends EditorBase {
  constructor(fileObject = null, readOnly = false) {
    super(fileObject, readOnly);

    // createBody is invoked during super(); do not overwrite _ui afterward.
    if (!this.settings || typeof this.settings !== 'object') {
      this.settings = this.getDefaultSettings(this.getProjectNameFromPath(this.path || fileObject?.path));
    }
    if (!this._ui || typeof this._ui !== 'object') {
      this._ui = {};
    }
    if (typeof this._screenshotIndex !== 'number') this._screenshotIndex = 0;
    if (typeof this._videoIndex !== 'number') this._videoIndex = 0;
    if (!Array.isArray(this._previewObjectUrls)) this._previewObjectUrls = [];
    if (typeof this._iconRenderToken !== 'number') this._iconRenderToken = 0;
    if (typeof this._shotRenderToken !== 'number') this._shotRenderToken = 0;
    if (typeof this._videoRenderToken !== 'number') this._videoRenderToken = 0;

    this.initializeFromFile();
  }

  static getDisplayName() {
    return 'Package Settings';
  }

  static getFileExtensions() {
    return ['.package'];
  }

  static getPriority() {
    // We route to this editor explicitly only for app.package.
    return 100;
  }

  createBody(bodyContainer) {
    // createBody can run during super() before this subclass constructor body.
    if (!this._ui || typeof this._ui !== 'object') {
      this._ui = {};
    }
    if (typeof this._screenshotIndex !== 'number') {
      this._screenshotIndex = 0;
    }
    if (typeof this._videoIndex !== 'number') {
      this._videoIndex = 0;
    }
    if (!Array.isArray(this._previewObjectUrls)) {
      this._previewObjectUrls = [];
    }
    if (typeof this._iconRenderToken !== 'number') {
      this._iconRenderToken = 0;
    }
    if (typeof this._shotRenderToken !== 'number') {
      this._shotRenderToken = 0;
    }
    if (typeof this._videoRenderToken !== 'number') {
      this._videoRenderToken = 0;
    }

    bodyContainer.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'pkg-settings-editor';
    wrap.style.cssText = 'padding:12px; overflow:auto; display:flex; flex-direction:column; gap:12px; color:#d7dbe4;';

    const title = document.createElement('h3');
    title.textContent = 'Package Settings';
    title.style.margin = '0';
    wrap.appendChild(title);

    const note = document.createElement('div');
    note.textContent = 'Edits are saved to app.package. Use Save (Ctrl+S).';
    note.style.cssText = 'opacity:0.8; font-size:12px; color:#9aa3b8;';
    wrap.appendChild(note);

    const form = document.createElement('div');
    form.style.cssText = 'display:grid; grid-template-columns: 140px 1fr; gap:8px 10px; align-items:center;';

    this._ui.title = this.makeInputRow(form, 'Title', 'text');
    this._ui.author = this.makeInputRow(form, 'Author', 'text');
    this._ui.version = this.makeInputRow(form, 'Version', 'text');
    this._ui.description = this.makeTextAreaRow(form, 'Description', 3);
    this._ui.packageKind = this.makeSelectRow(form, 'Package Type', [
      { value: 'rwa', label: 'App / Watch Face' },
      { value: 'rwg', label: 'Game Mode (faster clock, high power)' }
    ]);

    wrap.appendChild(form);

    const iconSection = document.createElement('div');
    iconSection.style.cssText = 'border:1px solid #3b4152; border-radius:6px; padding:10px; background:#191c23;';
    iconSection.innerHTML = '<strong>Icon 32x32 (launcher)</strong>';

    const iconPreviewWrap = document.createElement('div');
    iconPreviewWrap.style.cssText = 'margin-top:8px; display:flex; align-items:center; gap:12px;';
    const iconPreview = document.createElement('div');
    iconPreview.style.cssText = 'width:96px; height:96px; border:1px solid #4b5368; border-radius:6px; background:repeating-conic-gradient(#2a2f3b 0 25%, #20242e 0 50%) 50% / 12px 12px; display:flex; align-items:center; justify-content:center; overflow:hidden;';
    this._ui.iconPreview = iconPreview;
    iconPreviewWrap.appendChild(iconPreview);

    const iconInfoWrap = document.createElement('div');
    iconInfoWrap.style.cssText = 'flex:1; min-width:0;';

    const iconPath = document.createElement('div');
    iconPath.style.cssText = 'margin:6px 0; font-family:monospace; font-size:12px; opacity:0.9; color:#9aa3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    this._ui.icon32Path = iconPath;
    iconInfoWrap.appendChild(iconPath);
    iconPreviewWrap.appendChild(iconInfoWrap);
    iconSection.appendChild(iconPreviewWrap);

    const iconActions = document.createElement('div');
    iconActions.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;';
    this._ui.btnIconUpload = this.makeButton('Upload Icon...');
    iconActions.appendChild(this._ui.btnIconUpload);
    iconSection.appendChild(iconActions);
    wrap.appendChild(iconSection);

    const shotSection = document.createElement('div');
    shotSection.style.cssText = 'border:1px solid #3b4152; border-radius:6px; padding:10px; background:#191c23;';
    shotSection.innerHTML = '<strong>Screenshots</strong>';

    const shotActions = document.createElement('div');
    shotActions.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;';
    this._ui.btnShotUpload = this.makeButton('Add Screenshot...');
    this._ui.btnShotCapture = this.makeButton('Capture Screenshot from Simulator');
    shotActions.appendChild(this._ui.btnShotUpload);
    shotActions.appendChild(this._ui.btnShotCapture);
    shotSection.appendChild(shotActions);

    const shotViewer = document.createElement('div');
    shotViewer.style.cssText = 'margin-top:10px; border:1px solid #4b5368; border-radius:6px; min-height:220px; background:#141821; display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative;';
    this._ui.screenshotStage = shotViewer;
    shotSection.appendChild(shotViewer);

    const shotThumbs = document.createElement('div');
    shotThumbs.style.cssText = 'margin-top:10px; display:flex; gap:10px; flex-wrap:wrap; align-items:flex-start;';
    this._ui.screenshotThumbs = shotThumbs;
    shotSection.appendChild(shotThumbs);

    wrap.appendChild(shotSection);

    const videoSection = document.createElement('div');
    videoSection.style.cssText = 'border:1px solid #3b4152; border-radius:6px; padding:10px; background:#191c23;';
    videoSection.innerHTML = '<strong>Videos</strong>';

    const videoActions = document.createElement('div');
    videoActions.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;';
    this._ui.btnVideoUpload = this.makeButton('Upload Video...');
    videoActions.appendChild(this._ui.btnVideoUpload);
    videoSection.appendChild(videoActions);

    const videoStage = document.createElement('div');
    videoStage.style.cssText = 'margin-top:10px; border:1px solid #4b5368; border-radius:6px; min-height:220px; background:#141821; display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative;';
    this._ui.videoStage = videoStage;
    videoSection.appendChild(videoStage);

    const videoThumbs = document.createElement('div');
    videoThumbs.style.cssText = 'margin-top:10px; display:flex; gap:10px; flex-wrap:wrap; align-items:flex-start;';
    this._ui.videoThumbs = videoThumbs;
    videoSection.appendChild(videoThumbs);

    wrap.appendChild(videoSection);

    bodyContainer.appendChild(wrap);
  }

  makeInputRow(container, labelText, type) {
    const label = document.createElement('label');
    label.textContent = labelText;
    label.style.cssText = 'color:#d7dbe4;';
    const input = document.createElement('input');
    input.type = type;
    input.style.cssText = 'padding:6px; border-radius:4px; border:1px solid #4b5368; background:#0f131b; color:#e7ecf7;';
    container.appendChild(label);
    container.appendChild(input);
    return input;
  }

  makeTextAreaRow(container, labelText, rows) {
    const label = document.createElement('label');
    label.textContent = labelText;
    label.style.cssText = 'color:#d7dbe4;';
    const area = document.createElement('textarea');
    area.rows = rows;
    area.style.cssText = 'padding:6px; resize:vertical; border-radius:4px; border:1px solid #4b5368; background:#0f131b; color:#e7ecf7;';
    container.appendChild(label);
    container.appendChild(area);
    return area;
  }

  makeSelectRow(container, labelText, options) {
    const label = document.createElement('label');
    label.textContent = labelText;
    label.style.cssText = 'color:#d7dbe4;';
    const sel = document.createElement('select');
    sel.style.cssText = 'padding:6px; border-radius:4px; border:1px solid #4b5368; background:#0f131b; color:#e7ecf7;';
    options.forEach((o) => {
      const op = document.createElement('option');
      op.value = o.value;
      op.textContent = o.label;
      sel.appendChild(op);
    });
    container.appendChild(label);
    container.appendChild(sel);
    return sel;
  }

  makeButton(text) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.style.cssText = 'padding:6px 10px; border-radius:4px; border:1px solid #4b5368; background:#272d3c; color:#e7ecf7; cursor:pointer;';
    return b;
  }

  getProjectNameFromPath(path) {
    if (path && typeof path === 'string') {
      if (window.ProjectPaths && typeof window.ProjectPaths.parseProjectPath === 'function') {
        const parsed = window.ProjectPaths.parseProjectPath(path);
        if (parsed && parsed.project) return parsed.project;
      }
      const parts = path.split('/').filter(Boolean);
      if (parts.length > 1 && parts[0] !== 'Sources' && parts[0] !== 'Resources') {
        return parts[0];
      }
    }

    // Fallback when file paths are storage-normalized (no project prefix).
    return window.gameEmulator?.projectExplorer?.getFocusedProjectName?.() || '';
  }

  getDefaultSettings(projectName) {
    return {
      formatVersion: 1,
      projectName: projectName || '',
      packageKind: 'rwa',
      title: projectName || '',
      author: '',
      version: '0.0.1',
      description: '',
      icons: { icon32: '', icon128: '' },
      screenshots: [],
      videos: []
    };
  }

  async initializeFromFile() {
    await this.loadPath(this.path || this.file?.path);
    this.installHandlers();
    this.renderFromSettings();
  }

  async loadPath(path) {
    if (!path) return;
    this.path = path;
    const fm = window.serviceContainer?.get?.('fileManager') || window.FileManager || window.fileManager;
    if (!fm || typeof fm.loadFile !== 'function') return;

    const rec = await fm.loadFile(path);
    const text = (typeof rec?.content === 'string') ? rec.content : ((typeof rec?.fileContent === 'string') ? rec.fileContent : '');

    const project = this.getProjectNameFromPath(path);
    const defaults = this.getDefaultSettings(project);
    try {
      const parsed = text ? JSON.parse(text) : {};
      this.settings = { ...defaults, ...parsed };
    } catch (_) {
      this.settings = defaults;
    }

    if (!this.settings.icons) this.settings.icons = { icon32: '', icon128: '' };
    if (!Array.isArray(this.settings.screenshots)) this.settings.screenshots = [];
    if (!Array.isArray(this.settings.videos)) this.settings.videos = [];

    await this.backfillDefaultsFromPackageFolder(project, fm);

    if (!this.settings.icons.icon32) {
      await this.ensureDefaultIcon32();
    }

    this.markClean();
    this.renderFromSettings();
  }

  async reload() {
    await this.loadPath(this.path);
    return true;
  }

  installHandlers() {
    const fields = [this._ui.title, this._ui.author, this._ui.version, this._ui.description, this._ui.packageKind];
    fields.forEach((el) => {
      if (!el || el._pkgBound) return;
      el.addEventListener('input', () => this.syncSettingsFromUi());
      el.addEventListener('change', () => this.syncSettingsFromUi());
      el._pkgBound = true;
    });

    if (this._ui.btnIconUpload && !this._ui.btnIconUpload._pkgBound) {
      this._ui.btnIconUpload.addEventListener('click', async () => {
        await this.uploadIcon32();
      });
      this._ui.btnIconUpload._pkgBound = true;
    }

    if (this._ui.btnShotUpload && !this._ui.btnShotUpload._pkgBound) {
      this._ui.btnShotUpload.addEventListener('click', async () => {
        await this.uploadScreenshot();
      });
      this._ui.btnShotUpload._pkgBound = true;
    }

    if (this._ui.btnShotCapture && !this._ui.btnShotCapture._pkgBound) {
      this._ui.btnShotCapture.addEventListener('click', async () => {
        await this.captureScreenshot();
      });
      this._ui.btnShotCapture._pkgBound = true;
    }

    if (this._ui.btnVideoUpload && !this._ui.btnVideoUpload._pkgBound) {
      this._ui.btnVideoUpload.addEventListener('click', async () => {
        await this.uploadVideo();
      });
      this._ui.btnVideoUpload._pkgBound = true;
    }
  }

  renderFromSettings() {
    if (!this._ui.title) return;
    this._ui.title.value = this.settings.title || '';
    this._ui.author.value = this.settings.author || '';
    this._ui.version.value = this.settings.version || '0.0.1';
    this._ui.description.value = this.settings.description || '';
    this._ui.packageKind.value = (String(this.settings.packageKind || 'rwa').toLowerCase() === 'rwg') ? 'rwg' : 'rwa';
    this._ui.icon32Path.textContent = this.settings.icons?.icon32 || '(not set)';
    this.renderIconPreview();
    this.renderScreenshotCarousel();
    this.renderVideoCarousel();
  }

  _revokePreviewUrls() {
    if (!Array.isArray(this._previewObjectUrls)) return;
    this._previewObjectUrls.forEach((u) => {
      try { URL.revokeObjectURL(u); } catch (_) {}
    });
    this._previewObjectUrls = [];
  }

  _trackPreviewUrl(url) {
    if (typeof url !== 'string') return;
    if (!url.startsWith('blob:')) return;
    if (!Array.isArray(this._previewObjectUrls)) {
      this._previewObjectUrls = [];
    }
    this._previewObjectUrls.push(url);
  }

  _mimeFromPath(path) {
    const ext = String(path || '').split('.').pop().toLowerCase();
    return {
      png: 'image/png',
      gif: 'image/gif',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      bmp: 'image/bmp',
      webp: 'image/webp',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      m4v: 'video/x-m4v'
    }[ext] || 'application/octet-stream';
  }

  async resolveAssetImageSrc(assetPath) {
    if (!assetPath) return null;
    const fm = window.serviceContainer?.get?.('fileManager') || window.FileManager || window.fileManager;
    if (!fm || typeof fm.loadFile !== 'function') return null;

    const project = this.getProjectNameFromPath(this.path || this.file?.path);
    const candidates = [];
    const push = (p) => {
      if (typeof p !== 'string' || !p) return;
      if (!candidates.includes(p)) candidates.push(p);
    };

    push(assetPath);
    if (project && !assetPath.startsWith(project + '/')) push(`${project}/${assetPath}`);

    const normalized = String(assetPath).replace(/^\/+/, '');
    if (!normalized.startsWith('Sources/') && !normalized.startsWith('Resources/')) {
      push(`Sources/${normalized}`);
      push(`Resources/${normalized}`);
      if (project) {
        push(`${project}/Sources/${normalized}`);
        push(`${project}/Resources/${normalized}`);
      }
    }

    for (const p of candidates) {
      try {
        const rec = await fm.loadFile(p);
        const content = rec?.fileContent ?? rec?.content;
        if (!content) continue;

        if (typeof content === 'string') {
          if (content.startsWith('data:') || content.startsWith('blob:')) return content;
          return `data:${this._mimeFromPath(p)};base64,${content}`;
        }

        if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
          const blob = new Blob([content], { type: this._mimeFromPath(p) });
          const url = URL.createObjectURL(blob);
          this._trackPreviewUrl(url);
          return url;
        }
      } catch (_) {
        // Try next candidate.
      }
    }
    return null;
  }

  async resolveAssetVideoSrc(assetPath) {
    return this.resolveAssetImageSrc(assetPath);
  }

  async renderIconPreview() {
    if (!this._ui.iconPreview) return;

    const token = ++this._iconRenderToken;
    const iconPath = this.settings.icons?.icon32 || '';
    this._ui.iconPreview.innerHTML = '';

    if (!iconPath) {
      const none = document.createElement('div');
      none.textContent = 'No Icon';
      none.style.cssText = 'font-size:12px; color:#93a0b7;';
      this._ui.iconPreview.appendChild(none);
      return;
    }

    const src = await this.resolveAssetImageSrc(iconPath);
    if (token !== this._iconRenderToken) return;
    if (!src) {
      const miss = document.createElement('div');
      miss.textContent = 'Missing';
      miss.style.cssText = 'font-size:12px; color:#d08f8f;';
      this._ui.iconPreview.appendChild(miss);
      return;
    }

    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Icon preview';
    img.style.cssText = 'width:96px; height:96px; image-rendering:pixelated; object-fit:contain;';
    this._ui.iconPreview.appendChild(img);
  }

  selectScreenshot(index) {
    this._screenshotIndex = index;
    this.renderScreenshotCarousel();
  }

  deleteScreenshotAt(index) {
    if (!Array.isArray(this.settings.screenshots) || this.settings.screenshots.length === 0) return;
    this.settings.screenshots.splice(index, 1);
    if (this._screenshotIndex >= this.settings.screenshots.length) {
      this._screenshotIndex = Math.max(0, this.settings.screenshots.length - 1);
    }
    this.markDirty();
    this.renderScreenshotCarousel();
  }

  async renderScreenshotCarousel() {
    if (!this._ui.screenshotStage) return;

    const token = ++this._shotRenderToken;

    const shots = Array.isArray(this.settings.screenshots) ? this.settings.screenshots : [];
    if (!shots.length) {
      this._screenshotIndex = 0;
      this._ui.screenshotStage.innerHTML = '<div style="font-size:12px; color:#93a0b7;">No screenshots yet</div>';
      if (this._ui.screenshotThumbs) this._ui.screenshotThumbs.innerHTML = '';
      return;
    }

    if (this._screenshotIndex >= shots.length) this._screenshotIndex = shots.length - 1;
    if (this._screenshotIndex < 0) this._screenshotIndex = 0;

    const currentPath = shots[this._screenshotIndex];

    const src = await this.resolveAssetImageSrc(currentPath);
    if (token !== this._shotRenderToken) return;

    this._ui.screenshotStage.innerHTML = '';
    if (!src) {
      this._ui.screenshotStage.innerHTML = '<div style="font-size:12px; color:#d08f8f;">Unable to load screenshot</div>';
      return;
    }

    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Screenshot preview';
    img.style.cssText = 'max-width:100%; max-height:420px; object-fit:contain; image-rendering:auto;';
    this._ui.screenshotStage.appendChild(img);

    if (this._ui.screenshotThumbs) {
      this._ui.screenshotThumbs.innerHTML = '';
      shots.forEach((path, idx) => {
        const item = document.createElement('div');
        item.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:4px;';

        const thumbBtn = document.createElement('button');
        thumbBtn.type = 'button';
        thumbBtn.style.cssText = `width:70px; height:70px; border-radius:4px; border:1px solid ${idx === this._screenshotIndex ? '#6aa6ff' : '#4b5368'}; background:#111722; padding:2px; overflow:hidden; cursor:pointer;`;
        thumbBtn.title = path;
        thumbBtn.addEventListener('click', () => this.selectScreenshot(idx));

        const thumbImg = document.createElement('img');
        thumbImg.src = '';
        thumbImg.alt = `Screenshot ${idx + 1}`;
        thumbImg.style.cssText = 'width:100%; height:100%; object-fit:cover;';
        thumbBtn.appendChild(thumbImg);
        this.resolveAssetImageSrc(path).then((thumbSrc) => {
          if (token !== this._shotRenderToken) return;
          if (thumbSrc) thumbImg.src = thumbSrc;
        }).catch(() => {});

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = 'X';
        delBtn.style.cssText = 'padding:2px 8px; border-radius:3px; border:1px solid #7b4a4a; background:#2d1717; color:#f2c6c6; cursor:pointer; font-size:11px;';
        delBtn.addEventListener('click', () => this.deleteScreenshotAt(idx));

        item.appendChild(thumbBtn);
        item.appendChild(delBtn);
        this._ui.screenshotThumbs.appendChild(item);
      });
    }
  }

  selectVideo(index) {
    this._videoIndex = index;
    this.renderVideoCarousel();
  }

  deleteVideoAt(index) {
    if (!Array.isArray(this.settings.videos) || this.settings.videos.length === 0) return;
    this.settings.videos.splice(index, 1);
    if (this._videoIndex >= this.settings.videos.length) {
      this._videoIndex = Math.max(0, this.settings.videos.length - 1);
    }
    this.markDirty();
    this.renderVideoCarousel();
  }

  async renderVideoCarousel() {
    if (!this._ui.videoStage) return;

    const token = ++this._videoRenderToken;
    const videos = Array.isArray(this.settings.videos) ? this.settings.videos : [];
    if (!videos.length) {
      this._videoIndex = 0;
      this._ui.videoStage.innerHTML = '<div style="font-size:12px; color:#93a0b7;">No videos yet</div>';
      if (this._ui.videoThumbs) this._ui.videoThumbs.innerHTML = '';
      return;
    }

    if (this._videoIndex >= videos.length) this._videoIndex = videos.length - 1;
    if (this._videoIndex < 0) this._videoIndex = 0;

    const currentPath = videos[this._videoIndex];
    const src = await this.resolveAssetVideoSrc(currentPath);
    if (token !== this._videoRenderToken) return;

    this._ui.videoStage.innerHTML = '';
    if (!src) {
      this._ui.videoStage.innerHTML = '<div style="font-size:12px; color:#d08f8f;">Unable to load video</div>';
      return;
    }

    const video = document.createElement('video');
    video.src = src;
    video.controls = true;
    video.style.cssText = 'max-width:100%; max-height:420px; background:#000;';
    this._ui.videoStage.appendChild(video);

    if (this._ui.videoThumbs) {
      this._ui.videoThumbs.innerHTML = '';
      videos.forEach((path, idx) => {
        const item = document.createElement('div');
        item.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:4px; width:88px;';

        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.style.cssText = `width:88px; height:54px; border-radius:4px; border:1px solid ${idx === this._videoIndex ? '#6aa6ff' : '#4b5368'}; background:#111722; color:#c4d2ee; cursor:pointer; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`;
        selectBtn.textContent = path.split('/').pop();
        selectBtn.title = path;
        selectBtn.addEventListener('click', () => this.selectVideo(idx));

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = 'X';
        delBtn.style.cssText = 'padding:2px 8px; border-radius:3px; border:1px solid #7b4a4a; background:#2d1717; color:#f2c6c6; cursor:pointer; font-size:11px;';
        delBtn.addEventListener('click', () => this.deleteVideoAt(idx));

        item.appendChild(selectBtn);
        item.appendChild(delBtn);
        this._ui.videoThumbs.appendChild(item);
      });
    }
  }

  syncSettingsFromUi() {
    this.settings.title = this._ui.title.value || '';
    this.settings.author = this._ui.author.value || '';
    this.settings.version = this._ui.version.value || '0.0.1';
    this.settings.description = this._ui.description.value || '';
    this.settings.packageKind = (String(this._ui.packageKind.value || 'rwa').toLowerCase() === 'rwg') ? 'rwg' : 'rwa';
    this.markDirty();
  }

  getSourcesRoot() {
    return (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi)
      ? window.ProjectPaths.getSourcesRootUi()
      : 'Sources';
  }

  async backfillDefaultsFromPackageFolder(projectName, fileManager) {
    if (!fileManager || typeof fileManager.listFiles !== 'function') return;

    const effectiveProject = projectName || this.getProjectNameFromPath(this.path || this.file?.path);

    const sourcesRoot = this.getSourcesRoot();
    const packagePrefixStorage = `${sourcesRoot}/Package`;
    const screenshotPrefixStorage = `${packagePrefixStorage}/screenshots/`;
    const iconPath = `${sourcesRoot}/Package/icons/icon32.png`;

    // Keep title/version sensible even when older package files are blank.
    if (!String(this.settings.title || '').trim()) {
      this.settings.title = effectiveProject || this.settings.projectName || '';
    }
    if (!String(this.settings.version || '').trim()) {
      this.settings.version = '0.0.1';
    }

    // If icon path is missing but package icon file exists, link it.
    if (!String(this.settings.icons?.icon32 || '').trim()) {
      try {
        let rec = null;
        if (effectiveProject) {
          rec = await fileManager.loadFile(`${effectiveProject}/${iconPath}`);
        }
        if (!rec) {
          rec = await fileManager.loadFile(iconPath);
        }
        if (rec) {
          this.settings.icons = this.settings.icons || {};
          this.settings.icons.icon32 = iconPath;
        }
      } catch (_) {
        // Ignore; fallback creation runs later.
      }
    }

    // If screenshots list is empty, auto-link existing package screenshots.
    if (!Array.isArray(this.settings.screenshots) || this.settings.screenshots.length === 0) {
      try {
        const files = await fileManager.listFiles(screenshotPrefixStorage);
        const rel = (files || [])
          .map((f) => (typeof f === 'string' ? f : (f?.path || '')))
          .filter((p) => typeof p === 'string' && p.startsWith(screenshotPrefixStorage))
          .filter((p) => /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(p))
          .sort()
          .map((p) => p);

        if (rel.length) {
          this.settings.screenshots = rel;
          this._screenshotIndex = 0;
        }
      } catch (_) {
        // Ignore discovery failures.
      }
    }
  }

  async ensureDefaultIcon32(force = false) {
    const rb = window.ribbonToolbar;
    if (!rb) throw new Error('RibbonToolbar unavailable');

    if (!force && this.settings.icons?.icon32) return;

    const project = this.getProjectNameFromPath(this.path);
    const iconFile = await rb.createDefaultIcon32File();
    const rel = await rb.saveAssetToProject(iconFile, project, 'icons', 'icon32.png');
    this.settings.icons = this.settings.icons || {};
    this.settings.icons.icon32 = rel;
    this.markDirty();
    this.renderFromSettings();
  }

  async uploadIcon32() {
    const rb = window.ribbonToolbar;
    if (!rb) throw new Error('RibbonToolbar unavailable');
    const file = await rb.chooseFile('image/png,image/*');
    if (!file) return;

    const project = this.getProjectNameFromPath(this.path);
    const rel = await rb.saveAssetToProject(file, project, 'icons', 'icon32.png');
    this.settings.icons = this.settings.icons || {};
    this.settings.icons.icon32 = rel;
    this.markDirty();
    this.renderFromSettings();
  }

  async captureIcon32() {
    const rb = window.ribbonToolbar;
    if (!rb) throw new Error('RibbonToolbar unavailable');
    const file = await rb.captureSimulatorPng('icon32.png');

    const project = this.getProjectNameFromPath(this.path);
    const rel = await rb.saveAssetToProject(file, project, 'icons', 'icon32.png');
    this.settings.icons = this.settings.icons || {};
    this.settings.icons.icon32 = rel;
    this.markDirty();
    this.renderFromSettings();
  }

  async uploadScreenshot() {
    const rb = window.ribbonToolbar;
    if (!rb) throw new Error('RibbonToolbar unavailable');
    const file = await rb.chooseFile('image/png,image/*');
    if (!file) return;

    const project = this.getProjectNameFromPath(this.path);
    const rel = await rb.saveAssetToProject(file, project, 'screenshots', `shot-${Date.now()}-${file.name}`);
    if (!Array.isArray(this.settings.screenshots)) this.settings.screenshots = [];
    this.settings.screenshots.push(rel);
    this._screenshotIndex = this.settings.screenshots.length - 1;
    this.markDirty();
    this.renderFromSettings();
  }

  async captureScreenshot() {
    const rb = window.ribbonToolbar;
    if (!rb) throw new Error('RibbonToolbar unavailable');
    const file = await rb.captureSimulatorPng(`shot-${Date.now()}.png`);

    const project = this.getProjectNameFromPath(this.path);
    const rel = await rb.saveAssetToProject(file, project, 'screenshots', file.name);
    if (!Array.isArray(this.settings.screenshots)) this.settings.screenshots = [];
    this.settings.screenshots.push(rel);
    this._screenshotIndex = this.settings.screenshots.length - 1;
    this.markDirty();
    this.renderFromSettings();
  }

  async uploadVideo() {
    const rb = window.ribbonToolbar;
    if (!rb) throw new Error('RibbonToolbar unavailable');
    const file = await rb.chooseFile('video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v');
    if (!file) return;

    const project = this.getProjectNameFromPath(this.path);
    const rel = await rb.saveAssetToProject(file, project, 'videos', `video-${Date.now()}-${file.name}`);
    if (!Array.isArray(this.settings.videos)) this.settings.videos = [];
    this.settings.videos.push(rel);
    this._videoIndex = this.settings.videos.length - 1;
    this.markDirty();
    this.renderFromSettings();
  }

  getContent() {
    this.syncSettingsFromUi();
    return JSON.stringify(this.settings, null, 2);
  }

  setContent(content) {
    try {
      const parsed = JSON.parse(content || '{}');
      const defaults = this.getDefaultSettings(this.getProjectNameFromPath(this.path));
      this.settings = { ...defaults, ...parsed };
      if (!this.settings.icons) this.settings.icons = { icon32: '', icon128: '' };
      if (!Array.isArray(this.settings.screenshots)) this.settings.screenshots = [];
      if (!Array.isArray(this.settings.videos)) this.settings.videos = [];
      this.renderFromSettings();
      this.markClean();
    } catch (_) {
      // Keep previous settings on parse errors.
    }
  }

  destroy() {
    this._revokePreviewUrls();
    if (super.destroy) super.destroy();
  }
}

window.PackageSettingsEditor = PackageSettingsEditor;
