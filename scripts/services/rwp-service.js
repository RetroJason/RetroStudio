// rwp-service.js
// Export and import Retro Watch Project archives (.rwp)

class RwpService {
  constructor(services) {
    this.services = services;
    this.fileManager = null;
    this.projectExplorer = null;
  }

  getSourcesRootUi() {
    return (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi) ? window.ProjectPaths.getSourcesRootUi() : 'Resources';
  }

  normalizeToStorage(uiPath) {
    return (window.ProjectPaths && window.ProjectPaths.normalizeStoragePath) ? window.ProjectPaths.normalizeStoragePath(uiPath) : uiPath;
  }

  getDefaultManagedIconPath() {
    return `${this.getSourcesRootUi()}/Package/icons/icon32.png`;
  }

  getPackageFieldValidationError(settings) {
    const uniqueId = String(settings.uniqueId || '').trim();
    const applicationType = String(settings.category || '').trim();
    const targetDeviceSlug = String(settings.targetDeviceSlug || '').trim();
    const shortDescription = String(settings.shortDescription || '').trim();
    const description = String(settings.description || '').trim();
    const versionString = String(settings.version || '').trim();
    const versionCode = Number.parseInt(String(settings.versionCode ?? ''), 10);
    const iconPath = String(settings.icons?.icon32 || '').trim();
    const screenshots = Array.isArray(settings.screenshots) ? settings.screenshots.filter(Boolean) : [];

    if (!uniqueId) {
      return { fieldName: 'uniqueId', message: 'Package Settings: Application ID is required.' };
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(uniqueId)) {
      return {
        fieldName: 'uniqueId',
        message: 'Package Settings: Application ID must use lowercase letters, numbers, and hyphens only.',
      };
    }
    if (!applicationType) {
      return { fieldName: 'category', message: 'Package Settings: Application Type is required.' };
    }
    if (!targetDeviceSlug) {
      return { fieldName: 'targetDeviceSlug', message: 'Package Settings: Target Device is required.' };
    }
    if (!shortDescription) {
      return { fieldName: 'shortDescription', message: 'Package Settings: Short Description is required.' };
    }
    if (!description) {
      return { fieldName: 'description', message: 'Package Settings: Description is required.' };
    }
    if (!versionString) {
      return { fieldName: 'version', message: 'Package Settings: Version is required.' };
    }
    if (!Number.isInteger(versionCode) || versionCode < 1) {
      return {
        fieldName: 'versionCode',
        message: 'Package Settings: Version Code must be an integer greater than or equal to 1.',
      };
    }
    if (!iconPath) {
      return { fieldName: 'icons.icon32', message: 'Package Settings: Icon 32x32 is required for package.ini.' };
    }
    if (screenshots.length === 0) {
      return { fieldName: 'screenshots', message: 'Package Settings: At least one screenshot is required before publish.' };
    }

    return null;
  }

  async loadProjectAssetRecord(projectName, assetPath) {
    this.ensureDeps();
    if (!this.fileManager || typeof this.fileManager.loadFile !== 'function') {
      throw new Error('FileManager unavailable');
    }

    const normalizedAssetPath = String(assetPath || '').trim().replace(/^\/+/, '');
    if (!normalizedAssetPath) {
      return null;
    }

    const candidates = [];
    const pushCandidate = (candidate) => {
      if (!candidate || candidates.includes(candidate)) return;
      candidates.push(candidate);
    };

    pushCandidate(normalizedAssetPath);
    if (projectName && !normalizedAssetPath.startsWith(`${projectName}/`)) {
      pushCandidate(`${projectName}/${normalizedAssetPath}`);
    }

    for (const candidate of candidates) {
      const record = await this.fileManager.loadFile(candidate);
      if (record) {
        return record;
      }
    }

    return null;
  }

  async ensureManagedPackageIcon(projectName, settings) {
    const configuredIconPath = String(settings?.icons?.icon32 || '').trim();
    const defaultIconPath = this.getDefaultManagedIconPath();
    const effectiveIconPath = configuredIconPath || defaultIconPath;
    const iconRecord = await this.loadProjectAssetRecord(projectName, effectiveIconPath);

    if (iconRecord) {
      if (!settings.icons) settings.icons = {};
      settings.icons.icon32 = effectiveIconPath;
      return settings;
    }

    if (configuredIconPath && configuredIconPath !== defaultIconPath) {
      throw new Error(`Package Settings: Icon 32x32 file is missing: ${configuredIconPath}.`);
    }

    const ribbonToolbar = window.ribbonToolbar;
    if (!ribbonToolbar || typeof ribbonToolbar.createDefaultIcon32File !== 'function' || typeof ribbonToolbar.saveAssetToProject !== 'function') {
      throw new Error('Package Settings: Unable to create the required default icon32 asset.');
    }

    const iconFile = await ribbonToolbar.createDefaultIcon32File();
    const savedPath = await ribbonToolbar.saveAssetToProject(iconFile, projectName, 'icons', 'icon32.png');
    if (!settings.icons) settings.icons = {};
    settings.icons.icon32 = savedPath;
    return settings;
  }

  getCanonicalProjectSlug(projectName) {
    return String(projectName || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async loadPackageSettings(projectName) {
    this.ensureDeps();
    const rwaService = window.serviceContainer?.get?.('rwaService') || window.rwaService;
    if (!rwaService || typeof rwaService.loadPackageSettings !== 'function') {
      throw new Error('Runtime package service unavailable');
    }
    return rwaService.loadPackageSettings(projectName);
  }

  getPackageSettingsStoragePath(projectName) {
    return `${projectName}/${this.getSourcesRootUi()}/Package/app.package`;
  }

  async applyPackageSettingsOverride(projectName, override = {}) {
    if (!projectName || !override || typeof override !== 'object') {
      return;
    }

    this.ensureDeps();
    if (!this.fileManager || typeof this.fileManager.saveFile !== 'function' || typeof this.fileManager.loadFile !== 'function') {
      throw new Error('FileManager unavailable');
    }

    const packageSettingsPath = this.getPackageSettingsStoragePath(projectName);
    const existingRecord = await this.fileManager.loadFile(packageSettingsPath);
    const currentSettings = await this.loadPackageSettings(projectName);
    const nextSettings = {
      ...currentSettings,
      ...override,
    };
    const metadata = { binaryData: false };

    if (existingRecord?.builderId) {
      metadata.builderId = existingRecord.builderId;
    }

    const saved = await this.fileManager.saveFile(
      packageSettingsPath,
      JSON.stringify(nextSettings, null, 2),
      metadata,
    );

    if (!saved) {
      throw new Error('Failed to update imported package settings.');
    }
  }

  async getRetroStudioVersion() {
    const response = await fetch('version.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('RetroStudio version.json is required for package trace metadata.');
    }

    const payload = await response.json();
    if (!payload || typeof payload.version !== 'string' || payload.version.trim().length === 0) {
      throw new Error('RetroStudio version.json must contain a non-empty version string.');
    }

    return payload.version.trim();
  }

  async getHostedPackageDefaults(projectName, title) {
    const hostedStudio = window.retrowwwHostedStudio;
    if (!hostedStudio || typeof hostedStudio.getPackageDefaults !== 'function') {
      return null;
    }

    return hostedStudio.getPackageDefaults(projectName, title);
  }

  async resolveEffectivePackageSettings(projectName, settings) {
    const hostedDefaults = await this.getHostedPackageDefaults(projectName, settings.title || projectName);
    const defaults = hostedDefaults?.defaults || {};

    return {
      ...settings,
      author: String(defaults.author || settings.author || '').trim(),
      uniqueId: String(settings.uniqueId || defaults.uniqueId || '').trim(),
      targetDeviceSlug: String(settings.targetDeviceSlug || defaults.targetDeviceSlug || '').trim(),
      packageKind: String(settings.packageKind || defaults.packageKind || 'rwa').trim(),
      versionCode: Number.parseInt(String(settings.versionCode || defaults.versionCode || 1), 10) || 1,
    };
  }

  buildPackageIni(projectName, settings, runtimePkg, retroStudioVersion, options = {}) {
    const validationError = this.getPackageFieldValidationError(settings);
    if (validationError) {
      throw new Error(validationError.message);
    }

    const uniqueId = String(settings.uniqueId || '').trim();
    const category = String(settings.category || '').trim();
    const targetDeviceSlug = String(settings.targetDeviceSlug || '').trim();
    const shortDescription = String(settings.shortDescription || '').trim();
    const longDescription = String(settings.description || '').trim();
    const versionString = String(settings.version || '').trim();
    const rawVersionCode = Number.parseInt(String(settings.versionCode ?? ''), 10);
    const iconPath = String(settings.icons?.icon32 || '').trim();
    const releaseChannel = String(settings.releaseChannel || '').trim();
    const minFirmwareVersion = String(settings.minFirmwareVersion || '').trim();
    const sourceRevision = String(settings.sourceRevision || '').trim();
    const buildId = String(settings.buildId || '').trim();
    const authorLabel = String(settings.author || '').trim();

    const screenshots = Array.isArray(settings.screenshots) ? settings.screenshots.filter(Boolean) : [];
    const videos = Array.isArray(settings.videos) ? settings.videos.filter(Boolean) : [];
    const externalVideoUrls = videos.filter((value) => /^https?:\/\//i.test(String(value || '').trim()));

    const lines = [
      '[package]',
      'manifest_version=1',
      `unique_id=${uniqueId}`,
      `title=${String(settings.title || projectName).trim()}`,
      `category=${category}`,
      `target_device_slug=${targetDeviceSlug}`,
      '',
      '[release]',
      `version_string=${versionString}`,
      `version_code=${rawVersionCode}`,
      `runtime_package=runtime/${runtimePkg.filename}`,
    ];

    if (options.shareSource === true) lines.push('share_source=true');

    if (releaseChannel) lines.push(`release_channel=${releaseChannel}`);
    if (minFirmwareVersion) lines.push(`min_firmware_version=${minFirmwareVersion}`);

    lines.push(
      '',
      '[display]',
      `short_description=${shortDescription}`,
      `long_description=${longDescription}`,
      `icon_path=${iconPath}`,
    );

    if (authorLabel) lines.push(`author_label=${authorLabel}`);
    if (screenshots.length) lines.push(`screenshots=${screenshots.join(',')}`);
    if (externalVideoUrls.length) lines.push(`videos=${externalVideoUrls.join(',')}`);

    lines.push(
      '',
      '[trace]',
      'build_tool=RetroStudio',
      `build_tool_version=${retroStudioVersion}`,
    );

    if (sourceRevision) lines.push(`source_revision=${sourceRevision}`);
    if (buildId) lines.push(`build_id=${buildId}`);
    lines.push(`built_at_utc=${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`);

    return lines.join('\n') + '\n';
  }

  async buildWorkspacePackage(projectName, options = {}) {
    const projectPackage = options.projectPackage || await this.exportProject(projectName, {
      returnBlob: true,
      skipDownload: true,
    });
    const zip = new JSZip();
    zip.file(projectPackage.fileName, new Uint8Array(await projectPackage.blob.arrayBuffer()), {
      binary: true,
    });

    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    return {
      blob,
      fileName: `${projectName}.rws`,
      projectPackageFileName: projectPackage.fileName,
    };
  }

  async publishProject(projectName, options = {}) {
    const projectPackage = await this.exportProject(projectName, {
      returnBlob: true,
      skipDownload: true,
      shareSource: options.shareSource === true,
    });
    const workspacePackage = await this.buildWorkspacePackage(projectName, { projectPackage });
    const formData = new FormData();
    formData.set('projectFile', new File([workspacePackage.blob], workspacePackage.fileName, { type: 'application/zip' }));
    formData.set('packageFile', new File([projectPackage.blob], projectPackage.fileName, { type: 'application/zip' }));

    const response = await fetch('/api/retrostudio/publish', {
      method: 'POST',
      body: formData,
      credentials: 'same-origin',
    });

    const responseText = await response.text();
    let payload = null;
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch (error) {
        payload = null;
      }
    }

    if (!response.ok) {
      const errorMessage = payload?.error || responseText || `Publish hook failed with status ${response.status}.`;
      throw new Error(errorMessage);
    }

    return {
      ...payload,
      buildResult: projectPackage.buildResult,
    };
  }

  // Walk the project explorer for a given project's Sources tree and return UI file paths
  getProjectSourceFileUiPaths(projectName) {
  this.ensureDeps();
    const files = [];
  const explorer = this.projectExplorer;
    if (!explorer) return files;
    const sourcesRoot = this.getSourcesRootUi();
    const srcNode = explorer.projectData?.structure?.[projectName]?.children?.[sourcesRoot];
    if (!srcNode) return files;

    const walk = (node, base) => {
      if (!node) return;
      if (node.type === 'file') {
        files.push(base);
      } else if (node.type === 'folder' && node.children) {
        for (const [name, child] of Object.entries(node.children)) {
          const next = base ? `${base}/${name}` : name;
          if (child.type === 'file') files.push(`${next}`);
          else walk(child, `${next}`);
        }
      }
    };

    // Start at project/Sources
    for (const [name, child] of Object.entries(srcNode.children || {})) {
      const p = `${projectName}/${sourcesRoot}/${name}`;
      if (child.type === 'file') files.push(p);
      else walk(child, p);
    }
    return files;
  }

  shouldOmitSourceD2(uiPath, textureSourceBases) {
    if (typeof uiPath !== 'string' || !uiPath.toLowerCase().endsWith('.d2')) {
      return false;
    }

    const base = uiPath.substring(0, uiPath.length - '.d2'.length).toLowerCase();
    return textureSourceBases.has(base);
  }

  // Build a ZIP (.rwp) using JSZip with DEFLATE compression for all files
  async exportProject(projectName, options = {}) {
    if (!projectName) throw new Error('No project selected');
    this.ensureDeps();
    if (!this.fileManager) throw new Error('FileManager unavailable');

    const packageSettings = await this.ensureManagedPackageIcon(
      projectName,
      await this.resolveEffectivePackageSettings(
        projectName,
        await this.loadPackageSettings(projectName)
      )
    );

    const uiPaths = this.getProjectSourceFileUiPaths(projectName);
    const textureSourceBases = new Set(
      uiPaths
        .filter((uiPath) => typeof uiPath === 'string' && uiPath.toLowerCase().endsWith('.texture'))
        .map((uiPath) => uiPath.substring(0, uiPath.length - '.texture'.length).toLowerCase())
    );
    const manifestFiles = [];
    const zip = new JSZip();

    for (const uiPath of uiPaths) {
      try {
        if (this.shouldOmitSourceD2(uiPath, textureSourceBases)) {
          console.log('[RwpService] Omitting source .d2 companion from RWP:', uiPath);
          continue;
        }

        const storagePath = this.normalizeToStorage(uiPath);
        const rec = await this.fileManager.loadFile(storagePath);
        if (!rec) {
          throw new Error(`Source file is missing from storage: ${storagePath}`);
        }

        // Normalize content to {text or base64 string}
        let binary = !!rec.binaryData;
        let bytes;
        if (rec.content instanceof ArrayBuffer) {
          binary = true;
          bytes = new Uint8Array(rec.content);
        } else if (rec.content instanceof Uint8Array) {
          binary = true;
          bytes = rec.content;
        } else if (typeof rec.fileContent === 'string' && binary) {
          // stored as base64; decode to bytes
          bytes = new Uint8Array(this.base64ToArrayBuffer(rec.fileContent));
        } else if (typeof rec.content === 'string') {
          const enc = new TextEncoder();
          bytes = enc.encode(rec.content);
          binary = false;
        } else if (typeof rec.fileContent === 'string') {
          const enc = new TextEncoder();
          bytes = enc.encode(rec.fileContent);
          binary = false;
        } else {
          // Last resort
          const buf = await new Blob([rec.content ?? '']).arrayBuffer();
          bytes = new Uint8Array(buf);
          binary = true;
        }

        // ZIP entries must be storage-relative so package.ini paths like Sources/... resolve.
        const zipPath = storagePath;
        // Add file bytes to zip; JSZip will compress on generateAsync
        zip.file(zipPath, bytes, { binary: true });
        manifestFiles.push({ path: zipPath, builderId: rec.builderId || null, binary: !!binary });
      } catch (e) {
        console.error('[RwpService] Failed to export source file:', uiPath, e);
        throw e;
      }
    }

    // Also bundle the deployable runtime package (.rwa/.rwg) into the .rwp.
    const rwaService = window.serviceContainer?.get?.('rwaService') || window.rwaService;
    if (!rwaService || typeof rwaService.buildRuntimePackage !== 'function') {
      throw new Error('Runtime package service unavailable');
    }
    const runtimePkg = await rwaService.buildRuntimePackage(projectName, { buildBeforeExport: true });
    const runtimeBytes = new Uint8Array(await runtimePkg.blob.arrayBuffer());
    zip.file(`runtime/${runtimePkg.filename}`, runtimeBytes, { binary: true });

    const retroStudioVersion = await this.getRetroStudioVersion();
    const packageIni = this.buildPackageIni(projectName, packageSettings, runtimePkg, retroStudioVersion, options);
    zip.file('package.ini', new TextEncoder().encode(packageIni), { binary: true });

    // Build manifest and append to ZIP as rwp.json
    const manifest = {
      format: 'retro-watch-project',
      version: 2,
      projectName,
      sourcesRoot: this.getSourcesRootUi(),
      createdAt: new Date().toISOString(),
      files: manifestFiles,
      runtimePackage: {
        path: `runtime/${runtimePkg.filename}`,
        kind: runtimePkg.packageKind
      },
      packageIniPath: 'package.ini'
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 0));
    zip.file('rwp.json', manifestBytes, { binary: true });

    // Generate ZIP with DEFLATE compression for all files
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const fileName = options.fileName || `${projectName}.rwp`;
    if (!options.skipDownload) {
      this.downloadBlob(zipBlob, fileName);
    }
    if (options.returnBlob) {
      return { blob: zipBlob, fileName, buildResult: runtimePkg.buildResult };
    }
    return { fileName, buildResult: runtimePkg.buildResult };
  }

  // Import from ZIP (.rwp). Requires manifest rwp.json
  async importProject(file, options = {}) {
    this.ensureDeps();
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);

    // Read manifest
    const manifestFile = zip.file('rwp.json');
    if (!manifestFile) throw new Error('Invalid RWP: missing rwp.json');
    const manifestText = await manifestFile.async('string');
    const archive = JSON.parse(manifestText);
    if (!archive || archive.format !== 'retro-watch-project') throw new Error('Not a valid RWP archive');

  const incomingName = archive.projectName || 'ImportedProject';
    const explorer = this.projectExplorer;
    if (!explorer) throw new Error('ProjectExplorer unavailable');

    // Check for name conflict and abort with simple message
  let projectName = options.projectNameOverride || incomingName;
    if (explorer.projectData?.structure?.[projectName]) {
      try { alert('A project with that name is already open'); } catch (_) {}
      return;
    }

    explorer.addProject(projectName);
    explorer.setFocusedProjectName(projectName);

    // Persist files
    for (const f of archive.files || []) {
      try {
        // Resolve UI paths into this project
        const relUi = this.stripProjectPrefix(f.path || f.uiPath);
        const uiPath = `${projectName}/${relUi}`;

        // Get file bytes from ZIP using the stored path
        const key = f.path || f.uiPath;
        const fileEntry = zip.file(key);
        if (!fileEntry) { console.warn('[RwpService] Entry not found in zip:', key); continue; }

        const rawBytes = new Uint8Array(await fileEntry.async('uint8array'));
        let content;
        if (f.binary) {
          content = rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength);
        } else {
          content = new TextDecoder().decode(rawBytes);
        }

        // Create a File-like object to pass to addFileToProject
        // This will trigger the normal file addition flow including palette conversion
        const fileName = uiPath.split('/').pop();
        const folderPath = uiPath.split('/').slice(0, -1).join('/');
        
        // Create a synthetic File object with the content
        const fileBlob = new Blob([content], { 
          type: f.binary ? 'application/octet-stream' : 'text/plain' 
        });
        const syntheticFile = new File([fileBlob], fileName, { 
          lastModified: Date.now() 
        });
        
        // Add builderId as a property for compatibility
        syntheticFile.builderId = f.builderId;
        // Don't set syntheticFile.path - let addFileToProject compute the correct path
        // This allows palette conversion to work with the new filename
        syntheticFile.isNewFile = true;

        // Use the normal addFileToProject flow which handles conversion automatically
        await explorer.addFileToProject(syntheticFile, folderPath, true, true);
        
      } catch (e) {
        console.warn('[RwpService] Failed to import file entry:', f?.uiPath || f?.path, e);
      }
    }

    // Render the tree first with all files loaded
    explorer.renderTree?.();

    // Ensure project defaults are applied even for template imports.
    // This is intentionally called here as a backstop in case addProject-time
    // setup was skipped or delayed.
    if (typeof explorer.applyTemplateDefaults === 'function') {
      try {
        await explorer.applyTemplateDefaults(projectName);
      } catch (e) {
        console.warn('[RwpService] Failed to apply project defaults after import:', e);
      }
    } else if (typeof explorer.ensurePackageScaffold === 'function') {
      // Backward compatibility fallback
      try { await explorer.ensurePackageScaffold(projectName); } catch (_) {}
    }

    if (options.packageSettingsOverride) {
      await this.applyPackageSettingsOverride(projectName, options.packageSettingsOverride);
    }
    
    // Then initialize project configuration
    if (explorer.initializeProjectConfig) {
      await explorer.initializeProjectConfig();
    }

    // Open package settings once import/defaults are fully applied.
    if (typeof explorer.openPackageSettingsForProject === 'function') {
      await explorer.openPackageSettingsForProject(projectName, true);
    }
  }

  ensureDeps() {
    // Resolve dependencies lazily to avoid ServiceContainer.get throwing during early load
    try {
      if (!this.fileManager) {
        if (this.services?.has?.('fileManager')) {
          this.fileManager = this.services.get('fileManager');
        } else if (window.FileManager) {
          this.fileManager = window.FileManager;
          // Initialize with fileIOService if needed
          if (!this.fileManager.storageService && window.fileIOService && this.fileManager.initialize) {
            try { this.fileManager.initialize(window.fileIOService); } catch (_) {}
          }
        }
      }
    } catch (_) {}
    try {
      if (!this.projectExplorer) {
        if (this.services?.has?.('projectExplorer')) {
          this.projectExplorer = this.services.get('projectExplorer');
        } else if (window.gameEmulator?.projectExplorer) {
          this.projectExplorer = window.gameEmulator.projectExplorer;
        }
      }
    } catch (_) {}
  }

  stripProjectPrefix(uiPath) {
    const normalizedPath = String(uiPath || '').replace(/\\/g, '/');
    if (!normalizedPath) return normalizedPath;
    if (window.ProjectPaths?.parseProjectPath) {
      return window.ProjectPaths.parseProjectPath(normalizedPath).rest || normalizedPath;
    }

    const parts = normalizedPath.split('/');
    if (parts.length <= 1) return normalizedPath;
    return parts.slice(1).join('/');
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes.buffer;
  }

  async _ensureModalUtils() {
    if (window.ModalUtils && typeof window.ModalUtils.showConfirm === 'function') return true;
    return new Promise((resolve) => {
      const script = document.createElement('script');
      const cacheBust = Date.now();
      script.src = `scripts/utils/modal-utils.js?v=${cacheBust}`;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }
}

// Register service in container if available
(function initRwpService() {
  try {
    const services = window.serviceContainer;
    if (services) {
      const instance = new RwpService(services);
      services.registerSingleton('rwpService', instance);
      window.rwpService = instance;
    } else {
      window.rwpService = new RwpService(null);
    }
  } catch (_) {
    // ignore
  }
})();

window.RwpService = RwpService;
