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
      if (ext === '.lua' || ext === '.txt') return this.getSourcesSubfolder('Lua');
      if (['.mod', '.xm', '.s3m', '.it', '.mptm'].includes(ext)) return this.getSourcesSubfolder('Music');
      if (ext === '.wav' || ext === '.sfx') return this.getSourcesSubfolder('SFX');
      if (['.pal', '.act', '.aco'].includes(ext)) return this.getSourcesSubfolder('Palettes');
      return this.getSourcesSubfolder('Binary');
    },

    // Determine if a path has an actual project prefix; returns { project, rest }
    // - If the first segment is one of the UI roots (Sources/Game Objects) or storage roots (build),
    //   treat it as NOT a project prefix.
    parseProjectPath(path) {
      if (!path || typeof path !== 'string') return { project: null, rest: path };
      // Normalize slashes
      const p = String(path).replace(/\\/g, '/');
      const idx = p.indexOf('/');
      if (idx <= 0) {
        return { project: null, rest: p };
      }
      const first = p.substring(0, idx);
      const rest = p.substring(idx + 1);

      // Known non-project roots
      const sourcesUi = this.getSourcesRootUi();
      const buildUi = this.getBuildRootUi();
      const buildStorage = this.getBuildStoragePrefix().replace(/\/$/, ''); // e.g. 'build'
      const nonProjectRoots = new Set([
        sourcesUi,
        buildUi,
        buildStorage,
        buildStorage.toUpperCase(), // 'BUILD' safeguard
        'Build',
        'build'
      ]);

      if (nonProjectRoots.has(first)) {
        // Not a project-prefixed path; do not strip the first segment
        return { project: null, rest: p };
      }

      return { project: first, rest };
    },

    withProjectPrefix(project, subPath) {
      if (!project) return subPath;
      const cleaned = (subPath || '').replace(/^\/?/, '');
      return `${project}/${cleaned}`;
    },

    // Convert any UI-ish path to storage path
    // - Map UI build root to storage build/
    // - Normalize any legacy 'Build/' casing to 'build/'
  normalizeStoragePath(path) {
      if (!path || typeof path !== 'string') return path;
      const p = String(path).replace(/\\/g, '/');
      const { /*project,*/ rest } = this.parseProjectPath(p);
      const buildUi = ensureTrailingSlash(this.getBuildRootUi());
      const buildStorage = this.getBuildStoragePrefix();

      // Replace UI build root (supports spaces) with storage build prefix
      let out = (rest || '').replace(new RegExp('^' + escapeRegExp(buildUi), 'i'), buildStorage);
      // Also normalize legacy 'Build/' to 'build/'
      out = out.replace(/^Build\//, buildStorage);
      return out;
    },

    // Map storage build/ to UI build label for display
    mapStorageToUi(path) {
      if (!path || typeof path !== 'string') return path;
      const { /*project,*/ rest } = this.parseProjectPath(path);
      const buildUi = ensureTrailingSlash(this.getBuildRootUi());
      const buildStorage = this.getBuildStoragePrefix();
      const mapped = (rest || '').replace(new RegExp('^' + escapeRegExp(buildStorage)), buildUi);
      return mapped;
    },

    // Compute output artifact storage path from a source UI path
    toBuildOutputPath(sourceUiPath) {
      const { /*project,*/ rest } = this.parseProjectPath(sourceUiPath);
      const sourcesUi = ensureTrailingSlash(this.getSourcesRootUi());
      const buildStorage = this.getBuildStoragePrefix();
      let out;
      if (rest && rest.startsWith(sourcesUi)) {
        out = rest.replace(new RegExp('^' + escapeRegExp(sourcesUi)), buildStorage);
      } else {
        // Fallback: if not under sources, prefix under build storage
        const trimmed = (rest || '').replace(/^\/?/, '');
        out = buildStorage + trimmed;
      }
      // Storage paths are not project-prefixed
      return out;
    },

    // Classification helpers
    isBuildArtifact(path) {
      if (!path) return false;
      const { rest } = this.parseProjectPath(path);
      const buildUi = ensureTrailingSlash(this.getBuildRootUi());
      const buildStorage = this.getBuildStoragePrefix();
      return (rest || '').startsWith(buildStorage) || (rest || '').startsWith(buildUi) || (rest || '').startsWith('Build/');
    },

    isSourcesPath(path) {
      if (!path) return false;
      const { rest } = this.parseProjectPath(path);
      const sourcesUi = ensureTrailingSlash(this.getSourcesRootUi());
      return (rest || '').startsWith(sourcesUi);
    },
  };

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Attach to global
  window.projectPaths = ProjectPaths;
  window.ProjectPaths = ProjectPaths;
})();
