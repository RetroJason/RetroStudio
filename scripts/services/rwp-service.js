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

  // Build a ZIP (.rwp) using JSZip with DEFLATE compression for all files
  async exportProject(projectName) {
    if (!projectName) throw new Error('No project selected');
    this.ensureDeps();
    if (!this.fileManager) throw new Error('FileManager unavailable');

    const uiPaths = this.getProjectSourceFileUiPaths(projectName);
    const manifestFiles = [];
    const zip = new JSZip();

    for (const uiPath of uiPaths) {
      try {
        const storagePath = this.normalizeToStorage(uiPath);
        const rec = await this.fileManager.loadFile(storagePath);
        if (!rec) continue;

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

        // Use the UI path inside the ZIP (preserve project/Sources/...)
        const zipPath = uiPath;
        // Add file bytes to zip; JSZip will compress on generateAsync
        zip.file(zipPath, bytes, { binary: true });
        manifestFiles.push({ path: zipPath, builderId: rec.builderId || null, binary: !!binary });
      } catch (e) {
        console.warn('[RwpService] Skipping file due to error:', uiPath, e);
      }
    }

    // Build manifest and append to ZIP as rwp.json
    const manifest = {
      format: 'retro-watch-project',
      version: 2,
      projectName,
      sourcesRoot: this.getSourcesRootUi(),
      createdAt: new Date().toISOString(),
      files: manifestFiles
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 0));
    zip.file('rwp.json', manifestBytes, { binary: true });

    // Generate ZIP with DEFLATE compression for all files
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const fileName = `${projectName}.rwp`;
    this.downloadBlob(zipBlob, fileName);
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

    explorer.renderTree?.();
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
    // Convert "AnyProject/Resources/..." to "Resources/..."
    const parts = (uiPath || '').split('/');
    if (parts.length <= 1) return uiPath;
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
