// project-paths.js
// Centralized helpers for project root labels and path conversions

(function () {
  const DEFAULTS = {
  sourcesLabel: 'Sources',          // UI label for sources root
  buildLabel: 'Game Objects',       // UI label for build root
    buildStoragePrefix: 'build/',     // Internal storage prefix for build artifacts
  };

  function ensureTrailingSlash(s) {
    return s.endsWith('/') ? s : s + '/';
  }

  const ProjectPaths = {
    // UI labels (readable names shown in the tree)
    getSourcesRootUi() {
      // Could be made configurable later via configManager
      return DEFAULTS.sourcesLabel;
    },
    getBuildRootUi() {
      // Could be made configurable later via configManager
      return DEFAULTS.buildLabel;
    },

    // Storage mapping
    getBuildStoragePrefix() {
      return DEFAULTS.buildStoragePrefix; // always lower-case and slash-terminated
    },

    // Common subpaths under Sources
    getSourcesSubfolder(name) {
      return `${this.getSourcesRootUi()}/${name}`;
    },

    // Default main script location
    getDefaultMainScriptPath() {
      return `${this.getSourcesRootUi()}/Lua/main.lua`;
    },

    // Resolve appropriate Sources subfolder based on file extension
    resolveFolderForExtension(extension) {
      const ext = (extension || '').toLowerCase();
      if (ext === '.lua') return this.getSourcesSubfolder('Lua');
      if (['.mod', '.xm', '.s3m', '.it', '.mptm'].includes(ext)) return this.getSourcesSubfolder('Music');
      if (ext === '.wav' || ext === '.sfx') return this.getSourcesSubfolder('SFX');
      if (['.pal', '.act', '.aco'].includes(ext)) return this.getSourcesSubfolder('Palettes');
      return this.getSourcesSubfolder('Binary');
    },

    // Convert any UI-ish path to storage path
    // - Map UI build root to storage build/
    // - Normalize any legacy 'Build/' casing to 'build/'
    normalizeStoragePath(path) {
      if (!path || typeof path !== 'string') return path;
      const buildUi = ensureTrailingSlash(this.getBuildRootUi());
      const buildStorage = this.getBuildStoragePrefix();

      // Replace UI build root (supports spaces) with storage build prefix
      let out = path.replace(new RegExp('^' + escapeRegExp(buildUi), 'i'), buildStorage);
      // Also normalize legacy 'Build/' to 'build/'
      out = out.replace(/^Build\//, buildStorage);
      return out;
    },

    // Map storage build/ to UI build label for display
    mapStorageToUi(path) {
      if (!path || typeof path !== 'string') return path;
      const buildUi = ensureTrailingSlash(this.getBuildRootUi());
      const buildStorage = this.getBuildStoragePrefix();
      return path.replace(new RegExp('^' + escapeRegExp(buildStorage)), buildUi);
    },

    // Compute output artifact storage path from a source UI path
    toBuildOutputPath(sourceUiPath) {
      const sourcesUi = ensureTrailingSlash(this.getSourcesRootUi());
      const buildStorage = this.getBuildStoragePrefix();
      if (sourceUiPath && sourceUiPath.startsWith(sourcesUi)) {
        return sourceUiPath.replace(new RegExp('^' + escapeRegExp(sourcesUi)), buildStorage);
      }
      // Fallback: if not under sources, prefix under build storage
      const trimmed = (sourceUiPath || '').replace(/^\/?/, '');
      return buildStorage + trimmed;
    },

    // Classification helpers
    isBuildArtifact(path) {
      if (!path) return false;
      const buildUi = ensureTrailingSlash(this.getBuildRootUi());
      const buildStorage = this.getBuildStoragePrefix();
      return path.startsWith(buildStorage) || path.startsWith(buildUi) || path.startsWith('Build/');
    },

    isSourcesPath(path) {
      if (!path) return false;
      const sourcesUi = ensureTrailingSlash(this.getSourcesRootUi());
      return path.startsWith(sourcesUi);
    },
  };

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Attach to global
  window.projectPaths = ProjectPaths;
  window.ProjectPaths = ProjectPaths;
})();
