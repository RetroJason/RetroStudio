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
    if (!this._hostedPackageDefaults || typeof this._hostedPackageDefaults !== 'object') {
      this._hostedPackageDefaults = null;
    }
    if (typeof this._hostedDefaultsRequestId !== 'number') {
      this._hostedDefaultsRequestId = 0;
    }
    if (typeof this._hostedDefaultsDebounceTimer !== 'number') {
      this._hostedDefaultsDebounceTimer = 0;
    }

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
    note.textContent = 'Edit the hosted store fields here. Retrowww owns the authors list, title lineage, generated application ID, and publish version tracking. package.ini only publishes supported YouTube URLs; uploaded local videos stay inside the project for preview only.';
    note.style.cssText = 'opacity:0.8; font-size:12px; color:#9aa3b8;';
    wrap.appendChild(note);

    const form = document.createElement('div');
    form.style.cssText = 'display:grid; grid-template-columns: 140px 1fr; gap:8px 10px; align-items:center;';

    this._ui.title = this.makeInputRow(form, 'Title', 'text');
    this._ui.titleStatus = this.makeStatusRow(form);
    this._ui.author = this.makeAuthorRow(form, 'Authors');
    this._ui.version = this.makeInputRow(form, 'Version', 'text');
    this._ui.versionStatus = this.makeStatusRow(form);
    this._ui.versionCode = this.makeInputRow(form, 'Version Code', 'number');
    this._ui.uniqueId = this.makeInputRow(form, 'Application ID', 'text');
    this._ui.category = this.makeSelectRow(form, 'Application Type', this.getFallbackCategoryOptions());
    this._ui.targetDeviceSlug = this.makeSelectRow(form, 'Target Device', this.getFallbackTargetDeviceOptions());
    this._ui.shortDescription = this.makeTextAreaRow(form, 'Short Description', 2);
    this._ui.description = this.makeTextAreaRow(form, 'Description', 3);
    this._ui.packageKind = this.makeSelectRow(form, 'Package Type', [
      { value: 'rwa', label: 'App / Watch Face (.rwa)' }
    ]);
    this._ui.releaseChannel = this.makeSelectRow(form, 'Release Channel', [
      { value: '', label: 'None' },
      { value: 'dev', label: 'dev' },
      { value: 'beta', label: 'beta' },
      { value: 'stable', label: 'stable' }
    ]);
    this._ui.minFirmwareVersion = this.makeInputRow(form, 'Min Firmware Version', 'text');
    this._ui.sourceRevision = this.makeInputRow(form, 'Source Revision', 'text');
    this._ui.buildId = this.makeInputRow(form, 'Build ID', 'text');

    this.configureFormUi();

    wrap.appendChild(form);

    const iconSection = document.createElement('div');
    this._ui.iconSection = iconSection;
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
    videoSection.innerHTML = '<strong>Videos</strong><div style="margin-top:6px; font-size:12px; color:#9aa3b8;">Local video uploads preview in RetroStudio, but Retrowww package.ini only emits supported YouTube URLs.</div>';

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

  makeAuthorRow(container, labelText) {
    const label = document.createElement('label');
    label.textContent = labelText;
    label.style.cssText = 'color:#d7dbe4;';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; align-items:center; gap:8px; min-width:0;';

    const input = document.createElement('input');
    input.type = 'text';
    input.style.cssText = 'flex:1; min-width:0; padding:6px; border-radius:4px; border:1px solid #4b5368; background:#0f131b; color:#e7ecf7;';
    wrap.appendChild(input);

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.textContent = '+';
    addButton.title = 'Add author';
    addButton.setAttribute('aria-label', 'Add author');
    addButton.style.cssText = 'width:32px; height:32px; border-radius:999px; border:1px solid #4b5368; background:#272d3c; color:#e7ecf7; cursor:pointer; font-size:18px; line-height:1;';
    wrap.appendChild(addButton);

    container.appendChild(label);
    container.appendChild(wrap);
    this._ui.authorAddButton = addButton;
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

  makeStatusRow(container) {
    const spacer = document.createElement('div');
    spacer.setAttribute('aria-hidden', 'true');
    const status = document.createElement('div');
    status.style.cssText = 'min-height:16px; margin-top:-4px; margin-bottom:4px; font-size:12px; color:#9aa3b8;';
    container.appendChild(spacer);
    container.appendChild(status);
    return status;
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

  getFallbackCategoryOptions() {
    return [
      { value: '', label: 'Select application type' },
      { value: 'watch', label: 'Watch Face' },
      { value: 'low_power_watch', label: 'Low-Power Watch Face' },
      { value: 'lua_game', label: 'Lua Game' },
      { value: 'lua_app', label: 'Lua App' },
    ];
  }

  getFallbackTargetDeviceOptions() {
    return [{ value: 'retrowatch-classic', label: 'RetroWatch Classic' }];
  }

  setSelectOptions(select, options) {
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '';
    options.forEach((option) => {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      select.appendChild(element);
    });

    if (currentValue && Array.from(select.options).every((option) => option.value !== currentValue)) {
      const customOption = document.createElement('option');
      customOption.value = currentValue;
      customOption.textContent = currentValue;
      select.appendChild(customOption);
    }

    select.value = currentValue || select.options[0]?.value || '';
  }

  hideRow(control) {
    if (!control) return;
    const label = control.previousElementSibling;
    if (label) label.style.display = 'none';
    control.style.display = 'none';
  }

  configureFormUi() {
    [
      this._ui.versionCode,
      this._ui.uniqueId,
      this._ui.targetDeviceSlug,
      this._ui.packageKind,
      this._ui.releaseChannel,
      this._ui.minFirmwareVersion,
      this._ui.sourceRevision,
      this._ui.buildId,
    ].forEach((control) => this.hideRow(control));

    if (this._ui.author) {
      this._ui.author.readOnly = true;
      this._ui.author.style.opacity = '0.8';
      this._ui.author.title = 'Managed by the saved Retrowww project authors.';
    }

    if (this._ui.iconSection) {
      this._ui.iconSection.style.display = 'none';
    }
  }

  async loadHostedPackageDefaults(projectName, title) {
    const hostedStudio = window.retrowwwHostedStudio;
    if (!hostedStudio || typeof hostedStudio.getPackageDefaults !== 'function') {
      return null;
    }

    return hostedStudio.getPackageDefaults(projectName || '', title || '');
  }

  async searchHostedUsers(query) {
    const hostedStudio = window.retrowwwHostedStudio;
    if (!hostedStudio || typeof hostedStudio.searchUsers !== 'function') {
      throw new Error('Retrowww user search is unavailable.');
    }

    return hostedStudio.searchUsers(query || '');
  }

  async addHostedProjectCollaborator(userUuid) {
    const hostedStudio = window.retrowwwHostedStudio;
    if (!hostedStudio || typeof hostedStudio.addProjectCollaborator !== 'function') {
      throw new Error('Retrowww collaborator editing is unavailable.');
    }

    const projectName = this.getProjectNameFromPath(this.path || this.file?.path);
    if (!projectName) {
      throw new Error('Project name is required before authors can be updated.');
    }

    return hostedStudio.addProjectCollaborator(projectName, userUuid);
  }

  setStatusMessage(element, tone, message) {
    if (!element) return;
    const palette = {
      neutral: '#9aa3b8',
      success: '#8ad1a1',
      warning: '#e5c36b',
      error: '#e09494',
    };
    element.textContent = message || '';
    element.style.color = palette[tone] || palette.neutral;
  }

  compareDottedVersions(left, right) {
    const normalizedLeft = String(left || '').trim();
    const normalizedRight = String(right || '').trim();

    if (!/^\d+(?:\.\d+)*$/.test(normalizedLeft) || !/^\d+(?:\.\d+)*$/.test(normalizedRight)) {
      return null;
    }

    const leftSegments = normalizedLeft.split('.').map((segment) => Number.parseInt(segment, 10));
    const rightSegments = normalizedRight.split('.').map((segment) => Number.parseInt(segment, 10));
    const maxLength = Math.max(leftSegments.length, rightSegments.length);

    for (let index = 0; index < maxLength; index += 1) {
      const leftValue = leftSegments[index] ?? 0;
      const rightValue = rightSegments[index] ?? 0;
      if (leftValue > rightValue) return 1;
      if (leftValue < rightValue) return -1;
    }

    return 0;
  }

  updateHostedValidationMessages() {
    const titleStatus = this._hostedPackageDefaults?.titleStatus || null;

    if (!titleStatus || titleStatus.state === 'empty') {
      this.setStatusMessage(this._ui.titleStatus, 'neutral', '');
    } else if (titleStatus.state === 'available') {
      this.setStatusMessage(this._ui.titleStatus, 'success', 'Title is available.');
    } else if (titleStatus.state === 'owned') {
      this.setStatusMessage(
        this._ui.titleStatus,
        'success',
        `Title is already linked to your app.`,
      );
    } else if (titleStatus.state === 'taken') {
      this.setStatusMessage(
        this._ui.titleStatus,
        'error',
        `Title is owned by ${titleStatus.ownerDisplayName}.`,
      );
    }

    const currentVersion = String(this._ui.version?.value || '').trim();
    const latestPublishedVersion = String(titleStatus?.latestPublishedVersion || '').trim();

    if (!latestPublishedVersion) {
      this.setStatusMessage(this._ui.versionStatus, 'neutral', '');
      return;
    }

    const comparison = this.compareDottedVersions(currentVersion, latestPublishedVersion);
    if (comparison == null) {
      this.setStatusMessage(
        this._ui.versionStatus,
        'warning',
        `Use a dotted numeric version greater than ${latestPublishedVersion}.`,
      );
      return;
    }

    if (comparison <= 0) {
      this.setStatusMessage(
        this._ui.versionStatus,
        'error',
        `Version must be greater than the last published version (${latestPublishedVersion}).`,
      );
      return;
    }

    this.setStatusMessage(
      this._ui.versionStatus,
      'success',
      `Version is ahead of the last published version (${latestPublishedVersion}).`,
    );
  }

  async applyHostedPackageDefaults(projectName, options = {}) {
    const title = String(this.settings.title || projectName || '').trim();
    const hostedDefaults = await this.loadHostedPackageDefaults(projectName, title);
    if (!hostedDefaults) return;

    this._hostedPackageDefaults = hostedDefaults;

    if (Array.isArray(hostedDefaults.categoryOptions) && hostedDefaults.categoryOptions.length > 0) {
      this.setSelectOptions(this._ui.category, hostedDefaults.categoryOptions);
    }

    if (Array.isArray(hostedDefaults.targetDeviceOptions) && hostedDefaults.targetDeviceOptions.length > 0) {
      this.setSelectOptions(this._ui.targetDeviceSlug, hostedDefaults.targetDeviceOptions);
    }

    this.settings.author = String(hostedDefaults.defaults?.author || this.settings.author || '').trim();
    this.settings.uniqueId = String(hostedDefaults.defaults?.uniqueId || this.settings.uniqueId || '').trim();
    this.settings.targetDeviceSlug = String(hostedDefaults.defaults?.targetDeviceSlug || this.settings.targetDeviceSlug || '').trim();
    this.settings.packageKind = String(hostedDefaults.defaults?.packageKind || this.settings.packageKind || 'rwa').trim();
    this.settings.versionCode = Number.parseInt(String(hostedDefaults.defaults?.versionCode ?? this.settings.versionCode ?? 1), 10) || 1;

    if ((!String(this.settings.version || '').trim() || options.replaceVersion === true) && hostedDefaults.defaults?.versionString) {
      this.settings.version = String(hostedDefaults.defaults.versionString).trim();
    }

    this.updateHostedValidationMessages();
  }

  scheduleHostedDefaultsRefresh(options = {}) {
    if (this._hostedDefaultsDebounceTimer) {
      window.clearTimeout(this._hostedDefaultsDebounceTimer);
    }

    const requestId = ++this._hostedDefaultsRequestId;
    this._hostedDefaultsDebounceTimer = window.setTimeout(async () => {
      try {
        await this.applyHostedPackageDefaults(this.getProjectNameFromPath(this.path), options);
        if (requestId !== this._hostedDefaultsRequestId) {
          return;
        }
        this.renderFromSettings();
      } catch (error) {
        console.error('[PackageSettingsEditor] Failed to refresh hosted package defaults:', error);
      }
    }, 250);
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
      versionCode: 1,
      uniqueId: '',
      category: '',
      targetDeviceSlug: '',
      shortDescription: '',
      description: '',
      releaseChannel: '',
      minFirmwareVersion: '',
      sourceRevision: '',
      buildId: '',
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

    try {
      await this.applyHostedPackageDefaults(project, { replaceVersion: !String(this.settings.version || '').trim() });
    } catch (error) {
      console.error('[PackageSettingsEditor] Failed to load Retrowww package defaults:', error);
      window.gameEmulator?.updateStatus?.('Failed to load Retrowww package defaults', 'error');
    }

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
    const fields = [
      this._ui.title,
      this._ui.author,
      this._ui.version,
      this._ui.versionCode,
      this._ui.uniqueId,
      this._ui.category,
      this._ui.targetDeviceSlug,
      this._ui.shortDescription,
      this._ui.description,
      this._ui.packageKind,
      this._ui.releaseChannel,
      this._ui.minFirmwareVersion,
      this._ui.sourceRevision,
      this._ui.buildId
    ];
    fields.forEach((el) => {
      if (!el || el._pkgBound) return;
      el.addEventListener('input', () => {
        this.syncSettingsFromUi();
        if (el === this._ui.title) {
          this.scheduleHostedDefaultsRefresh();
        }
        if (el === this._ui.version) {
          this.updateHostedValidationMessages();
        }
      });
      el.addEventListener('change', () => {
        this.syncSettingsFromUi();
        if (el === this._ui.title) {
          this.scheduleHostedDefaultsRefresh();
        }
        if (el === this._ui.version) {
          this.updateHostedValidationMessages();
        }
      });
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

    if (this._ui.authorAddButton && !this._ui.authorAddButton._pkgBound) {
      this._ui.authorAddButton.addEventListener('click', async () => {
        try {
          await this.openAuthorSearchDialog();
        } catch (error) {
          console.error('[PackageSettingsEditor] Failed to open author picker:', error);
          window.gameEmulator?.updateStatus?.(error?.message || 'Failed to open author picker.', 'error');
        }
      });
      this._ui.authorAddButton._pkgBound = true;
    }
  }

  renderFromSettings() {
    if (!this._ui.title) return;
    this._ui.title.value = this.settings.title || '';
    this._ui.author.value = this.settings.author || '';
    this._ui.version.value = this.settings.version || '0.0.1';
    this._ui.versionCode.value = String(this.settings.versionCode ?? 1);
    this._ui.uniqueId.value = this.settings.uniqueId || '';
    this._ui.category.value = this.settings.category || '';
    this._ui.targetDeviceSlug.value = this.settings.targetDeviceSlug || '';
    this._ui.shortDescription.value = this.settings.shortDescription || '';
    this._ui.description.value = this.settings.description || '';
    this._ui.packageKind.value = (String(this.settings.packageKind || 'rwa').toLowerCase() === 'rwg') ? 'rwg' : 'rwa';
    this._ui.releaseChannel.value = this.settings.releaseChannel || '';
    this._ui.minFirmwareVersion.value = this.settings.minFirmwareVersion || '';
    this._ui.sourceRevision.value = this.settings.sourceRevision || '';
    this._ui.buildId.value = this.settings.buildId || '';
    this._ui.icon32Path.textContent = this.settings.icons?.icon32 || '(not set)';
    this.updateHostedValidationMessages();
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
    this.settings.versionCode = Number.parseInt(this._ui.versionCode.value || '1', 10) || 1;
    this.settings.uniqueId = this._ui.uniqueId.value || '';
    this.settings.category = this._ui.category.value || '';
    this.settings.targetDeviceSlug = this._ui.targetDeviceSlug.value || '';
    this.settings.shortDescription = this._ui.shortDescription.value || '';
    this.settings.description = this._ui.description.value || '';
    this.settings.packageKind = (String(this._ui.packageKind.value || 'rwa').toLowerCase() === 'rwg') ? 'rwg' : 'rwa';
    this.settings.releaseChannel = this._ui.releaseChannel.value || '';
    this.settings.minFirmwareVersion = this._ui.minFirmwareVersion.value || '';
    this.settings.sourceRevision = this._ui.sourceRevision.value || '';
    this.settings.buildId = this._ui.buildId.value || '';
    this.markDirty();
  }

  async openAuthorSearchDialog() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(7,10,16,0.82); display:flex; align-items:center; justify-content:center; z-index:9999;';

    const panel = document.createElement('div');
    panel.style.cssText = 'width:min(560px, calc(100vw - 24px)); max-height:min(78vh, 720px); overflow:hidden; border:1px solid #3b4152; border-radius:12px; background:#151b24; box-shadow:0 20px 60px rgba(0, 0, 0, 0.45); display:flex; flex-direction:column;';
    overlay.appendChild(panel);

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; border-bottom:1px solid #2b3140;';
    panel.appendChild(header);

    const title = document.createElement('div');
    title.textContent = 'Add project author';
    title.style.cssText = 'font-size:16px; font-weight:600; color:#e7ecf7;';
    header.appendChild(title);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = 'Close';
    closeButton.style.cssText = 'padding:6px 10px; border-radius:4px; border:1px solid #4b5368; background:#272d3c; color:#e7ecf7; cursor:pointer;';
    header.appendChild(closeButton);

    const content = document.createElement('div');
    content.style.cssText = 'padding:16px; display:flex; flex-direction:column; gap:12px;';
    panel.appendChild(content);

    const help = document.createElement('div');
    help.textContent = 'Search by username or email, then add the user to this saved project.';
    help.style.cssText = 'font-size:12px; color:#9aa3b8;';
    content.appendChild(help);

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search by username or email';
    searchInput.style.cssText = 'padding:8px 10px; border-radius:6px; border:1px solid #4b5368; background:#0f131b; color:#e7ecf7;';
    content.appendChild(searchInput);

    const status = document.createElement('div');
    status.style.cssText = 'min-height:18px; font-size:12px; color:#9aa3b8;';
    content.appendChild(status);

    const results = document.createElement('div');
    results.style.cssText = 'display:flex; flex-direction:column; gap:8px; overflow:auto;';
    content.appendChild(results);

    const closeDialog = () => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    };

    closeButton.addEventListener('click', closeDialog);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeDialog();
      }
    });

    let searchRequestId = 0;
    let searchDebounceTimer = 0;

    const renderResults = (users) => {
      results.innerHTML = '';
      if (!Array.isArray(users) || users.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No matching users found.';
        empty.style.cssText = 'padding:10px 12px; border:1px solid #2b3140; border-radius:8px; color:#9aa3b8; background:#10151e;';
        results.appendChild(empty);
        return;
      }

      users.forEach((user) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.style.cssText = 'display:flex; width:100%; align-items:flex-start; justify-content:space-between; gap:12px; padding:10px 12px; border:1px solid #2b3140; border-radius:8px; background:#10151e; color:#e7ecf7; cursor:pointer; text-align:left;';

        const primary = document.createElement('div');
        primary.style.cssText = 'display:flex; flex-direction:column; gap:4px; min-width:0;';

        const name = document.createElement('div');
        name.textContent = user.displayName || user.username || user.email;
        name.style.cssText = 'font-size:14px; font-weight:600; color:#e7ecf7;';
        primary.appendChild(name);

        const meta = document.createElement('div');
        meta.textContent = `${user.username} | ${user.email}`;
        meta.style.cssText = 'font-size:12px; color:#9aa3b8;';
        primary.appendChild(meta);

        const action = document.createElement('span');
        action.textContent = 'Add';
        action.style.cssText = 'padding:4px 8px; border-radius:999px; border:1px solid #4b5368; font-size:12px; color:#d7dbe4;';

        row.appendChild(primary);
        row.appendChild(action);
        row.addEventListener('click', async () => {
          status.textContent = `Adding ${user.username}...`;
          status.style.color = '#9aa3b8';
          try {
            await this.addHostedProjectCollaborator(user.uuid);
            await this.applyHostedPackageDefaults(this.getProjectNameFromPath(this.path || this.file?.path));
            this.markDirty();
            this.renderFromSettings();
            window.gameEmulator?.updateStatus?.(`Added ${user.username} to project authors.`, 'success');
            closeDialog();
          } catch (error) {
            console.error('[PackageSettingsEditor] Failed to add author:', error);
            status.textContent = error?.message || 'Failed to add author.';
            status.style.color = '#e09494';
          }
        });
        results.appendChild(row);
      });
    };

    const runSearch = async () => {
      const query = String(searchInput.value || '').trim();
      if (query.length < 2) {
        status.textContent = 'Type at least 2 characters to search.';
        status.style.color = '#9aa3b8';
        results.innerHTML = '';
        return;
      }

      const requestId = ++searchRequestId;
      status.textContent = 'Searching...';
      status.style.color = '#9aa3b8';
      try {
        const users = await this.searchHostedUsers(query);
        if (requestId !== searchRequestId) {
          return;
        }
        status.textContent = `${users.length} result${users.length === 1 ? '' : 's'}.`;
        status.style.color = '#9aa3b8';
        renderResults(users);
      } catch (error) {
        if (requestId !== searchRequestId) {
          return;
        }
        console.error('[PackageSettingsEditor] User search failed:', error);
        status.textContent = error?.message || 'Search failed.';
        status.style.color = '#e09494';
        results.innerHTML = '';
      }
    };

    searchInput.addEventListener('input', () => {
      if (searchDebounceTimer) {
        window.clearTimeout(searchDebounceTimer);
      }
      searchDebounceTimer = window.setTimeout(() => {
        void runSearch();
      }, 200);
    });

    document.body.appendChild(overlay);
    searchInput.focus();
    status.textContent = 'Type at least 2 characters to search.';
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

  }

  clearFieldHighlights() {
    const highlightableControls = [
      this._ui.title,
      this._ui.version,
      this._ui.versionCode,
      this._ui.uniqueId,
      this._ui.category,
      this._ui.targetDeviceSlug,
      this._ui.shortDescription,
      this._ui.description,
      this._ui.screenshotStage,
    ];

    highlightableControls.forEach((control) => {
      if (!control) return;
      control.style.borderColor = '#4b5368';
      control.style.boxShadow = 'none';
      control.removeAttribute('aria-invalid');
    });
  }

  focusField(fieldName) {
    const control = this._ui?.[fieldName];
    if (!control) return false;

    this.clearFieldHighlights();
    control.style.borderColor = '#d6a34c';
    control.style.boxShadow = '0 0 0 2px rgba(214, 163, 76, 0.25)';
    control.setAttribute('aria-invalid', 'true');

    if (typeof control.focus === 'function') {
      control.focus();
    }
    if (typeof control.scrollIntoView === 'function') {
      control.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if ((control.tagName === 'INPUT' || control.tagName === 'TEXTAREA') && typeof control.select === 'function') {
      control.select();
    }

    return true;
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
