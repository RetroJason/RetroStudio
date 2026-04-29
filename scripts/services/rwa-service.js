// rwa-service.js
// Export Retro Watch App runtime archives (.rwa) from build outputs

class RwaService {
  constructor(services) {
    this.services = services;
    this.fileManager = null;
    this.buildSystem = null;
  }

  getBuildStoragePrefix() {
    return (window.ProjectPaths && window.ProjectPaths.getBuildStoragePrefix)
      ? window.ProjectPaths.getBuildStoragePrefix()
      : 'build/';
  }

  getSourcesRootUi() {
    return (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi)
      ? window.ProjectPaths.getSourcesRootUi()
      : 'Sources';
  }

  getPackageSettingsStoragePath(projectName) {
    return `${projectName}/${this.getSourcesRootUi()}/Package/app.package`;
  }

  getDefaultPackageSettings(projectName) {
    return {
      formatVersion: 1,
      projectName,
      packageKind: 'rwa',
      category: '',
      title: projectName,
      author: '',
      version: '1.0.0',
      description: '',
      icons: { icon32: '', icon128: '' },
      screenshots: [],
      videos: []
    };
  }

  getAppManifestType(settings) {
    const category = String(settings?.category || '').trim();
    if (!category) {
      throw new Error('Package Settings: Category is required for app.ini.');
    }
    return category;
  }

  categoryOmitsRuntimeIcons(category) {
    return category === 'watch' || category === 'low_power_watch';
  }

  async loadPackageSettings(projectName) {
    this.ensureDeps();
    if (!this.fileManager || typeof this.fileManager.loadFile !== 'function') {
      throw new Error('FileManager unavailable');
    }

    const defaults = this.getDefaultPackageSettings(projectName);
    const path = this.getPackageSettingsStoragePath(projectName);
    const rec = await this.fileManager.loadFile(path);
    if (!rec) return defaults;

    let text = rec.content;
    if (text == null && typeof rec.fileContent === 'string') text = rec.fileContent;
    if (typeof text !== 'string') return defaults;

    try {
      const parsed = JSON.parse(text);
      return { ...defaults, ...parsed };
    } catch (_) {
      return defaults;
    }
  }

  normalizePackageKind(kind) {
    return 'rwa';
  }

  makeAppIni(projectName, settings) {
    const s = settings || this.getDefaultPackageSettings(projectName);
    const shots = Array.isArray(s.screenshots) ? s.screenshots : [];
    const vids = Array.isArray(s.videos) ? s.videos : [];
    const icons = s.icons || {};
    const manifestType = this.getAppManifestType(s);
    const includeRuntimeIcons = !this.categoryOmitsRuntimeIcons(manifestType);

    const lines = [
      '[app]',
      `title = ${s.title || projectName}`,
      `author = ${s.author || 'Unknown'}`,
      `version = ${s.version || '1.0.0'}`,
      `description = ${s.description || 'Exported from RetroStudio'}`,
      `type = ${manifestType}`,
      `runtime = ${this.normalizePackageKind(s.packageKind)}`,
      '',
      '[display]',
      'fps = 30',
      'orientation = auto',
      '',
      '[media]',
      `screenshots = ${shots.join(',')}`,
      `videos = ${vids.join(',')}`,
      ''
    ];

    if (includeRuntimeIcons) {
      lines.splice(7, 0, `icon32 = ${icons.icon32 || ''}`, `icon128 = ${icons.icon128 || ''}`);
    }

    return lines.join('\n');
  }

  async buildRuntimePackage(projectName, options = {}) {
    if (!projectName) throw new Error('No project selected');

    this.ensureDeps();
    if (!this.fileManager) throw new Error('FileManager unavailable');

    const buildBeforeExport = options.buildBeforeExport !== false;
    let buildResult = null;
    if (buildBeforeExport) {
      if (!this.buildSystem || typeof this.buildSystem.buildProject !== 'function') {
        throw new Error('BuildSystem unavailable');
      }

      buildResult = await this.buildSystem.buildProject();
      if (!buildResult || buildResult.success !== true) {
        const msg = buildResult?.error || 'Build failed';
        throw new Error(`Build failed: ${msg}`);
      }
    }

    const packageSettings = await this.loadPackageSettings(projectName);
    const packageKind = this.normalizePackageKind(packageSettings.packageKind);
    const outputName = `${projectName}.${packageKind}`;

    const buildPrefix = this.getBuildStoragePrefix();
    const buildPrefixNoSlash = buildPrefix.replace(/\/$/, '');
    const records = await this.fileManager.listFiles(buildPrefixNoSlash);

    const buildPaths = (records || [])
      .map((rec) => rec?.path || rec)
      .filter((p) => typeof p === 'string' && p.startsWith(buildPrefix));

    if (!buildPaths.length) {
      throw new Error('No build outputs found under build/');
    }

    const zip = new JSZip();
    let hasAppIni = false;

    for (const storagePath of buildPaths) {
      const rec = await this.fileManager.loadFile(storagePath);
      if (!rec) continue;

      const normalized = this.normalizeRecord(rec);
      if (!normalized) continue;

      const zipPath = storagePath.substring(buildPrefix.length);
      if (!zipPath) continue;

      zip.file(zipPath, normalized.bytes, { binary: true });
      if (zipPath.toLowerCase() === 'app.ini') {
        hasAppIni = true;
      }
    }

    if (!hasAppIni) {
      const ini = this.makeAppIni(projectName, packageSettings);
      zip.file('app.ini', new TextEncoder().encode(ini), { binary: true });
    }

    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    return {
      blob,
      packageKind,
      filename: outputName,
      settings: packageSettings,
      fileCount: buildPaths.length,
      buildResult
    };
  }

  async exportProject(projectName, options = {}) {
    const pkg = await this.buildRuntimePackage(projectName, options);
    this.downloadBlob(pkg.blob, pkg.filename);
    return pkg;
  }

  normalizeRecord(rec) {
    const content = (rec && rec.content !== undefined) ? rec.content : rec?.fileContent;
    let binary = !!rec?.binaryData;

    if (content instanceof ArrayBuffer) {
      return { bytes: new Uint8Array(content), binary: true };
    }

    if (content instanceof Uint8Array) {
      return { bytes: content, binary: true };
    }

    if (ArrayBuffer.isView(content)) {
      return {
        bytes: new Uint8Array(content.buffer, content.byteOffset, content.byteLength),
        binary: true
      };
    }

    if (typeof content === 'string') {
      // If content is marked binary, assume it is stored base64 (same convention used in RWP service).
      if (binary) {
        try {
          return { bytes: new Uint8Array(this.base64ToArrayBuffer(content)), binary: true };
        } catch (_) {
          // Fall back to UTF-8 encoding if base64 decoding fails.
        }
      }
      return { bytes: new TextEncoder().encode(content), binary: false };
    }

    if (content == null) {
      return null;
    }

    return { bytes: new TextEncoder().encode(String(content)), binary: false };
  }

  ensureDeps() {
    try {
      if (!this.fileManager) {
        if (this.services?.has?.('fileManager')) {
          this.fileManager = this.services.get('fileManager');
        } else if (window.fileManager) {
          this.fileManager = window.fileManager;
        } else if (window.FileManager) {
          this.fileManager = window.FileManager;
          if (!this.fileManager.storageService && window.fileIOService && this.fileManager.initialize) {
            try { this.fileManager.initialize(window.fileIOService); } catch (_) {}
          }
        }
      }
    } catch (_) {}

    try {
      if (!this.buildSystem) {
        if (this.services?.has?.('buildSystem')) {
          this.buildSystem = this.services.get('buildSystem');
        } else if (window.buildSystem) {
          this.buildSystem = window.buildSystem;
        }
      }
    } catch (_) {}
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

  base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes.buffer;
  }
}

(function initRwaService() {
  try {
    const services = window.serviceContainer;
    if (services) {
      const instance = new RwaService(services);
      services.registerSingleton('rwaService', instance);
      window.rwaService = instance;
    } else {
      window.rwaService = new RwaService(null);
    }
  } catch (_) {
    // ignore
  }
})();

window.RwaService = RwaService;
