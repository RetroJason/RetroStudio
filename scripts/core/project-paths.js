// project-paths.js
// Centralized helpers for project root labels and path conversions

(function () {
  const DEFAULTS = {
  sourcesLabel: 'Sources',          // UI label for sources root
  buildLabel: 'Build Output',       // UI label for build root
    buildStoragePrefix: 'build/',     // Internal storage prefix for build artifacts
  };

  function ensureTrailingSlash(s) {
    return s.endsWith('/') ? s : s + '/';
  }

  function getProjectExplorer() {
    return window.serviceContainer?.get?.('projectExplorer') || window.projectExplorer || null;
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

    getFocusedProjectName() {
      return getProjectExplorer()?.getFocusedProjectName?.() || null;
    },

    // Storage mapping
    getBuildStoragePrefix(projectName = this.getFocusedProjectName()) {
      if (!projectName) {
        return DEFAULTS.buildStoragePrefix;
      }

      return `${projectName}/${DEFAULTS.buildStoragePrefix}`;
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
      if (['.png', '.gif', '.jpg', '.jpeg', '.bmp', '.tga', '.texture', '.frameset', '.d2'].includes(ext)) return this.getSourcesSubfolder('Images');
      if (['.tilemap', '.tmj', '.tmx'].includes(ext)) return this.getSourcesSubfolder('Maps');
      if (['.pal', '.act', '.aco'].includes(ext)) return this.getSourcesSubfolder('Palettes');
      if (ext === '.sprite') return this.getSourcesSubfolder('Sprites');
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
      const sourceFolders = [
        'Lua',
        'Music',
        'SFX',
        'Images',
        'Maps',
        'Palettes',
        'Sprites',
        'Binary'
      ];
      const nonProjectRoots = new Set([
        sourcesUi,
        buildUi,
        buildStorage,
        buildStorage.toUpperCase(), // 'BUILD' safeguard
        'Build',
        'build',
        ...sourceFolders
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

    isManagedProjectPath(path) {
      if (!path || typeof path !== 'string') return false;

      const normalized = String(path).replace(/\\/g, '/');
      const { rest } = this.parseProjectPath(normalized);
      const candidate = rest || normalized;
      const firstSegment = candidate.split('/')[0] || '';
      const buildStorage = DEFAULTS.buildStoragePrefix.replace(/\/$/, '');
      const sourcesRoot = this.getSourcesRootUi();
      const buildRoot = this.getBuildRootUi();
      const sourceFolders = new Set([
        'Lua',
        'Music',
        'SFX',
        'Images',
        'Maps',
        'Palettes',
        'Sprites',
        'Binary',
        'Package'
      ]);

      return firstSegment === sourcesRoot
        || firstSegment === buildRoot
        || firstSegment === 'Build'
        || firstSegment === buildStorage
        || sourceFolders.has(firstSegment);
    },

    scopeToProject(path, projectName = this.getFocusedProjectName()) {
      if (!path || typeof path !== 'string') return path;

      const normalized = String(path).replace(/\\/g, '/');
      const parsed = this.parseProjectPath(normalized);
      if (parsed.project) {
        return normalized;
      }

      if (!projectName || !this.isManagedProjectPath(normalized)) {
        return normalized;
      }

      return this.withProjectPrefix(projectName, normalized);
    },

    rebaseManagedPath(path, owningPath) {
      if (!path || typeof path !== 'string') return path;

      const normalizedPath = String(path).replace(/\\/g, '/');
      const normalizedOwner = String(owningPath || '').replace(/\\/g, '/');
      const resourceParsed = this.parseProjectPath(normalizedPath);
      const ownerParsed = this.parseProjectPath(normalizedOwner);
      const resourceRest = resourceParsed.rest || normalizedPath;

      if (!ownerParsed.project || !this.isManagedProjectPath(resourceRest)) {
        return normalizedPath;
      }

      return this.withProjectPrefix(ownerParsed.project, resourceRest);
    },

    // Strip a project-name prefix from a managed resource reference, leaving a
    // project-relative path (e.g. 'MyGame/Sources/Images/x.png' -> 'Sources/Images/x.png').
    // Paths that are already project-relative, or that are not managed project
    // paths, are returned unchanged. This keeps asset references portable so a
    // copied/renamed project resolves them against the currently focused project.
    toProjectRelative(path) {
      if (!path || typeof path !== 'string') return path;
      const normalized = String(path).replace(/\\/g, '/');
      const parsed = this.parseProjectPath(normalized);
      if (parsed.project && this.isManagedProjectPath(parsed.rest)) {
        return parsed.rest;
      }
      return normalized;
    },

    _isLikelyResourcePath(value) {
      if (typeof value !== 'string') return false;
      const raw = value.trim();
      if (!raw) return false;
      if (/^(https?:|data:|blob:|javascript:|mailto:|#)/i.test(raw)) return false;
      if (/^[A-Za-z]:\//.test(raw)) return false;
      if (raw.includes('\\')) return false;
      // Require slash-delimited paths so plain tokens are not touched.
      if (!raw.includes('/')) return false;
      return this.isManagedProjectPath(raw);
    },

    _normalizeJsonResourcePaths(value, state) {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const next = this._normalizeJsonResourcePaths(value[i], state);
          if (next !== value[i]) {
            value[i] = next;
            state.changed = true;
          }
        }
        return value;
      }

      if (value && typeof value === 'object') {
        for (const key of Object.keys(value)) {
          const next = this._normalizeJsonResourcePaths(value[key], state);
          if (next !== value[key]) {
            value[key] = next;
            state.changed = true;
          }
        }
        return value;
      }

      if (typeof value === 'string' && this._isLikelyResourcePath(value)) {
        return this.toProjectRelative(value);
      }

      return value;
    },

    // Rewrite an asset's JSON text so all internal resource references are
    // project-relative. Returns the (possibly rewritten) text. Non-asset or
    // unparseable content is returned unchanged.
    rewriteAssetReferencesToProjectRelative(fileName, textContent) {
      if (typeof textContent !== 'string' || !textContent.trim()) return textContent;

      let data;
      try {
        data = JSON.parse(textContent);
      } catch (_) {
        return textContent;
      }
      if (!data || typeof data !== 'object') return textContent;

      const state = { changed: false };
      this._normalizeJsonResourcePaths(data, state);

      if (!state.changed) return textContent;
      return JSON.stringify(data, null, 2);
    },

    // Convert any UI-ish path to storage path
    // - Map UI build root to storage build/
    // - Normalize any legacy 'Build/' casing to 'build/'
  normalizeStoragePath(path) {
      if (!path || typeof path !== 'string') return path;
      const p = this.scopeToProject(path);
      const { project, rest } = this.parseProjectPath(p);
      const buildUi = ensureTrailingSlash(this.getBuildRootUi());
      const buildStorage = DEFAULTS.buildStoragePrefix;

      // Replace UI build root (supports spaces) with storage build prefix
      let out = (rest || '').replace(new RegExp('^' + escapeRegExp(buildUi), 'i'), buildStorage);
      // Also normalize legacy 'Build/' to 'build/'
      out = out.replace(/^Build\//, buildStorage);
      return project ? this.withProjectPrefix(project, out) : out;
    },

    // Map storage build/ to UI build label for display
    mapStorageToUi(path) {
      if (!path || typeof path !== 'string') return path;
      const scopedPath = this.scopeToProject(path);
      const { project, rest } = this.parseProjectPath(scopedPath);
      const buildUi = ensureTrailingSlash(this.getBuildRootUi());
      const buildStorage = DEFAULTS.buildStoragePrefix;
      const mapped = (rest || '').replace(new RegExp('^' + escapeRegExp(buildStorage)), buildUi);
      return project ? this.withProjectPrefix(project, mapped) : mapped;
    },

    // Compute output artifact storage path from a source UI path
    toBuildOutputPath(sourceUiPath) {
      const scopedPath = this.scopeToProject(sourceUiPath);
      const { project, rest } = this.parseProjectPath(scopedPath);
      const sourcesUi = ensureTrailingSlash(this.getSourcesRootUi());
      const buildStorage = DEFAULTS.buildStoragePrefix;
      let out;
      if (rest && rest.startsWith(sourcesUi)) {
        out = rest.replace(new RegExp('^' + escapeRegExp(sourcesUi)), buildStorage);
      } else {
        // Fallback: if not under sources, prefix under build storage
        const trimmed = (rest || '').replace(/^\/?/, '');
        out = buildStorage + trimmed;
      }
      return project ? this.withProjectPrefix(project, out) : out;
    },

    // Classification helpers
    isBuildArtifact(path) {
      if (!path) return false;
      const { rest } = this.parseProjectPath(path);
      const buildUi = ensureTrailingSlash(this.getBuildRootUi());
      const buildStorage = DEFAULTS.buildStoragePrefix;
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
