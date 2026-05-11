class RuntimeArchiveFileManager {
  constructor(files) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('RuntimeArchiveFileManager requires a non-empty files array.');
    }

    this.records = new Map();
    this.uniqueRecords = [];
    this.textDecoder = new TextDecoder();

    for (const file of files) {
      const record = this.createRecord(file);
      this.uniqueRecords.push(record);
      for (const aliasPath of record.aliasPaths) {
        this.records.set(aliasPath, record);
      }
    }
  }

  async ensureReady() {
    return this;
  }

  sanitizePath(path) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('Runtime file path must be a non-empty string.');
    }

    return path
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\/+/, '')
      .replace(/^build\//i, 'build/');
  }

  getAliasPaths(path) {
    const aliasPaths = new Set([path]);

    if (path.startsWith('build/')) {
      aliasPaths.add(path.substring('build/'.length));
    } else {
      aliasPaths.add(`build/${path}`);
    }

    return [...aliasPaths];
  }

  isTextPath(path) {
    return /\.(lua|ini|json|txt|xml|csv|md|glsl|vert|frag|frameset)$/i.test(path);
  }

  createRecord(file) {
    if (!file || typeof file.path !== 'string') {
      throw new Error('Runtime package files must include a path.');
    }

    const path = this.sanitizePath(file.path);
    const bytes = file.bytes instanceof Uint8Array
      ? file.bytes
      : file.bytes instanceof ArrayBuffer
        ? new Uint8Array(file.bytes)
        : ArrayBuffer.isView(file.bytes)
          ? new Uint8Array(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength)
          : null;

    if (!bytes) {
      throw new Error(`Runtime package file ${file.path} is missing binary content.`);
    }

    const isText = this.isTextPath(path);
    const content = isText
      ? this.textDecoder.decode(bytes)
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    return {
      path,
      aliasPaths: this.getAliasPaths(path),
      filename: path.split('/').pop(),
      directory: path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '',
      binaryData: !isText,
      content,
      fileContent: content,
      size: bytes.byteLength,
    };
  }

  async listFiles(prefix = '') {
    const normalizedPrefix = prefix ? this.sanitizePath(prefix).replace(/\/$/, '') : '';
    const results = [];

    for (const record of this.uniqueRecords) {
      const matchingAlias = !normalizedPrefix
        ? record.path
        : record.aliasPaths.find((aliasPath) => aliasPath.startsWith(normalizedPrefix));

      if (matchingAlias) {
        results.push({ ...record, path: matchingAlias });
      }
    }

    return results;
  }

  async loadFile(path) {
    const normalizedPath = this.sanitizePath(path);
    const record = this.records.get(normalizedPath);
    return record ? { ...record, path: normalizedPath } : null;
  }

  async fileExists(path) {
    return this.records.has(this.sanitizePath(path));
  }

  async getSourceScripts() {
    const scripts = [];

    for (const record of this.records.values()) {
      if (record.path.toLowerCase().endsWith('.lua')) {
        scripts.push({ path: record.path });
      }
    }

    scripts.sort((left, right) => {
      const leftIsMain = /\/main\.lua$/i.test(left.path);
      const rightIsMain = /\/main\.lua$/i.test(right.path);
      if (leftIsMain && !rightIsMain) return -1;
      if (!leftIsMain && rightIsMain) return 1;
      return left.path.localeCompare(right.path);
    });

    return scripts;
  }

  getBuildFiles() {
    const buildFiles = [];

    for (const record of this.records.values()) {
      buildFiles.push({
        name: record.filename,
        path: record.path,
        type: 'file',
      });
    }

    return buildFiles;
  }
}

class EmbeddedRuntimePlayer {
  constructor(contentContainer, options = {}) {
    if (!contentContainer) {
      throw new Error('EmbeddedRuntimePlayer requires a content container element.');
    }

    if (typeof GameEmulator !== 'function') {
      throw new Error('GameEmulator must be loaded before EmbeddedRuntimePlayer.');
    }

    this.contentContainer = contentContainer;
    this.options = options;
    this.gameEmulator = new GameEmulator(contentContainer, {
      hostProfile: options.hostProfile || 'embedded',
      runtimeOnly: true,
      ...options,
    });
  }

  async loadRwaFromArrayBuffer(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer) && !ArrayBuffer.isView(arrayBuffer)) {
      throw new Error('loadRwaFromArrayBuffer expects an ArrayBuffer or typed array.');
    }

    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip must be loaded before loading a runtime archive.');
    }

    await this.gameEmulator.whenReady();

    const input = arrayBuffer instanceof ArrayBuffer
      ? arrayBuffer
      : arrayBuffer.buffer.slice(arrayBuffer.byteOffset, arrayBuffer.byteOffset + arrayBuffer.byteLength);
    const zip = await JSZip.loadAsync(input);
    const runtimePackage = await this.extractRuntimePackage(zip);
    await this.gameEmulator.playRuntimePackage(runtimePackage);
    return runtimePackage;
  }

  async loadRwaFromBlob(blob) {
    if (!(blob instanceof Blob)) {
      throw new Error('loadRwaFromBlob expects a Blob.');
    }

    const arrayBuffer = await blob.arrayBuffer();
    return this.loadRwaFromArrayBuffer(arrayBuffer);
  }

  async loadRwaFromFile(file) {
    if (!(file instanceof File)) {
      throw new Error('loadRwaFromFile expects a File.');
    }

    return this.loadRwaFromBlob(file);
  }

  async loadRwaFromUrl(url, requestInit) {
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('loadRwaFromUrl expects a non-empty URL string.');
    }

    const response = await fetch(url, requestInit);
    if (!response.ok) {
      throw new Error(`Failed to fetch runtime archive: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return this.loadRwaFromArrayBuffer(arrayBuffer);
  }

  static async getExtensionDefinitions(extensionFilePath = 'scripts/lua/api.json') {
    if (!EmbeddedRuntimePlayer._extensionDefinitionsCache) {
      EmbeddedRuntimePlayer._extensionDefinitionsCache = new Map();
    }

    if (EmbeddedRuntimePlayer._extensionDefinitionsCache.has(extensionFilePath)) {
      return EmbeddedRuntimePlayer._extensionDefinitionsCache.get(extensionFilePath);
    }

    const response = await fetch(extensionFilePath);
    if (!response.ok) {
      throw new Error(`Failed to fetch extension definitions: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const cleanJson = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const parsed = JSON.parse(cleanJson);
    EmbeddedRuntimePlayer._extensionDefinitionsCache.set(extensionFilePath, parsed);
    return parsed;
  }

  async extractRuntimePackage(zip) {
    const files = [];

    for (const entry of Object.values(zip.files)) {
      if (entry.dir) {
        continue;
      }

      const bytes = await entry.async('uint8array');
      files.push({
        path: entry.name,
        bytes,
      });
    }

    if (files.length === 0) {
      throw new Error('Runtime archive did not contain any files.');
    }

    return { files };
  }

  destroy() {
    this.gameEmulator.destroy();
  }
}

window.RuntimeArchiveFileManager = RuntimeArchiveFileManager;
window.EmbeddedRuntimePlayer = EmbeddedRuntimePlayer;