// services/builder-registry.js
// Central registry for builders with metadata and extension mapping

class BuilderRegistry {
  constructor() {
    this.buildersById = new Map(); // id -> { id, displayName, icon, handler, extensions, priority }
    this.extensionIndex = new Map(); // .ext -> [builderId]
  }

  registerBuilder({ id, displayName, icon = '🛠️', handler, extensions = ['*'], priority = 0 }) {
    if (!id || !handler) throw new Error('[BuilderRegistry] id and handler required');
    this.buildersById.set(id, { id, displayName, icon, handler, extensions, priority });
    // Index by extension
    extensions.forEach(ext => {
      const key = (ext || '*').toLowerCase();
      if (!this.extensionIndex.has(key)) this.extensionIndex.set(key, []);
      const list = this.extensionIndex.get(key);
      if (!list.includes(id)) list.push(id);
      // Keep highest priority first
      list.sort((a, b) => (this.buildersById.get(b).priority || 0) - (this.buildersById.get(a).priority || 0));
    });
    console.log(`[BuilderRegistry] Registered builder '${id}' for [${extensions.join(', ')}]`);
  }

  getById(id) { return this.buildersById.get(id) || null; }

  // Prefer explicit builderId on file; else choose by extension; fallback '*'
  resolveForFilePath(path, explicitId = null) {
    if (explicitId && this.buildersById.has(explicitId)) return this.buildersById.get(explicitId);
    const ext = this._getExt(path);
    const byExt = this.extensionIndex.get(ext) || this.extensionIndex.get('*') || [];
    return byExt.length ? this.buildersById.get(byExt[0]) : null;
  }

  getBuildersForExtension(ext) {
    const list = this.extensionIndex.get(ext.toLowerCase()) || [];
    return list.map(id => this.buildersById.get(id));
  }

  _getExt(filename) {
    const i = filename.lastIndexOf('.');
    return i !== -1 ? filename.substring(i).toLowerCase() : '';
  }
}

// Export singleton
window.BuilderRegistry = new BuilderRegistry();
console.log('[BuilderRegistry] Service loaded');
