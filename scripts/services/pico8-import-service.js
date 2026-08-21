// pico8-import-service.js
// Import PICO-8 text carts (.p8) into RetroStudio projects.

class Pico8ImportService {
  constructor(services) {
    this.services = services;
    this.projectExplorer = null;
  }

  getSourcesRootUi() {
    return (window.ProjectPaths && window.ProjectPaths.getSourcesRootUi)
      ? window.ProjectPaths.getSourcesRootUi()
      : 'Sources';
  }

  ensureDeps() {
    try {
      if (!this.projectExplorer) {
        if (this.services?.has?.('projectExplorer')) {
          this.projectExplorer = this.services.get('projectExplorer');
        } else if (window.gameEmulator?.projectExplorer) {
          this.projectExplorer = window.gameEmulator.projectExplorer;
        } else if (window.projectExplorer) {
          this.projectExplorer = window.projectExplorer;
        }
      }
    } catch (_) {
      // best effort
    }
  }

  sanitizeProjectName(rawName) {
    const base = String(rawName || 'ImportedPico8')
      .replace(/\.p8(\.png)?$/i, '')
      .trim();

    const cleaned = base
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');

    return cleaned || 'ImportedPico8';
  }

  allocateProjectName(explorer, preferredName) {
    let candidate = preferredName;
    let suffix = 2;
    while (explorer.projectData?.structure?.[candidate]) {
      candidate = `${preferredName}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  parseP8Text(text) {
    const normalized = String(text || '').replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n');

    const sections = {
      lua: [],
      gfx: [],
      map: [],
      sfx: [],
      music: [],
      gff: [],
      label: [],
      meta: [],
    };

    let activeSection = 'meta';
    const sectionRegex = /^__([a-z0-9_]+)__\s*$/i;

    for (const line of lines) {
      const match = line.match(sectionRegex);
      if (match) {
        const sectionName = match[1].toLowerCase();
        activeSection = Object.prototype.hasOwnProperty.call(sections, sectionName)
          ? sectionName
          : 'meta';
        continue;
      }
      sections[activeSection].push(line);
    }

    return {
      raw: normalized,
      lua: sections.lua.join('\n').trim(),
      sections,
    };
  }

  clampInt(value, min, max) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  /**
   * Parse the __sfx__ section of a .p8 cart.
   * Each line is one SFX slot: 8 header hex chars (mode, speed, loopStart, loopEnd)
   * followed by 32 steps of 5 hex chars each (PPWVE = pitch, waveform, volume, effect).
   */
  parseP8SfxSection(lines) {
    const source = Array.isArray(lines) ? lines : String(lines || '').split('\n');
    const slots = [];

    source.forEach((rawLine, index) => {
      const clean = String(rawLine || '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');
      if (clean.length < 8) return;

      const steps = [];
      for (let i = 0; i < 32; i += 1) {
        const offset = 8 + (i * 5);
        const token = clean.slice(offset, offset + 5).padEnd(5, '0');
        steps.push({
          pitch: this.clampInt(Number.parseInt(token.slice(0, 2), 16) || 0, 0, 63),
          waveform: this.clampInt(Number.parseInt(token.slice(2, 3), 16) || 0, 0, 7),
          volume: this.clampInt(Number.parseInt(token.slice(3, 4), 16) || 0, 0, 7),
          effect: this.clampInt(Number.parseInt(token.slice(4, 5), 16) || 0, 0, 7),
        });
      }

      slots.push({
        index,
        mode: Number.parseInt(clean.slice(0, 2), 16) || 0,
        speed: Number.parseInt(clean.slice(2, 4), 16) || 0,
        loopStart: Number.parseInt(clean.slice(4, 6), 16) || 0,
        loopEnd: Number.parseInt(clean.slice(6, 8), 16) || 0,
        steps,
      });
    });

    return slots;
  }

  /**
   * Convert one parsed PICO-8 SFX slot into RetroStudio `.sfx` JSON.
   * Returns null for slots that contain no audible steps.
   */
  picoSlotToSfxJson(slot) {
    const steps = Array.isArray(slot?.steps) ? slot.steps : [];
    if (steps.length === 0) return null;

    let lastAudible = -1;
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      if (steps[i].volume > 0) {
        lastAudible = i;
        break;
      }
    }
    if (lastAudible < 0) return null;

    // PICO-8 overloads the loop pair three ways: 0/0 means no loop, end > start
    // is a real loop with an exclusive end, and a start with a zero end means
    // "play this many notes" (shown as LEN in the SFX editor). RetroStudio
    // treats the pair as an inclusive playback range, so translate all three.
    const hasLoop = slot.loopEnd > slot.loopStart;
    const hasLength = !hasLoop && slot.loopStart > 0;
    const loopStart = hasLoop ? this.clampInt(slot.loopStart, 0, 31) : 0;
    let loopEnd;
    if (hasLoop) {
      loopEnd = this.clampInt(slot.loopEnd - 1, loopStart, 31);
    } else if (hasLength) {
      loopEnd = this.clampInt(slot.loopStart - 1, 0, 31);
    } else {
      loopEnd = lastAudible;
    }

    return {
      type: 'pico_sfx',
      version: '1.0',
      pico: {
        speed: this.clampInt(slot.speed || 8, 1, 255),
        loopStart,
        loopEnd,
        steps,
      },
    };
  }

  buildRuntimeLua(luaSource) {
    const source = String(luaSource || '').trim();
    const hasSetup = /\bfunction\s+Setup\s*\(/.test(source);
    const hasUpdate = /\bfunction\s+Update\s*\(/.test(source);
    const hasInit = /\bfunction\s+_init\s*\(/.test(source);
    const hasUpdate60 = /\bfunction\s+_update60\s*\(/.test(source);
    const hasUpdateP8 = /\bfunction\s+_update\s*\(/.test(source);
    const hasDraw = /\bfunction\s+_draw\s*\(/.test(source);

    const chunks = [];
    if (source) {
      chunks.push(source);
    }

    chunks.push('');
    chunks.push('-- Imported by Pico8ImportService');

    if (!hasSetup && hasInit) {
      chunks.push('function Setup()');
      chunks.push('  if type(_init) == "function" then _init() end');
      chunks.push('end');
      chunks.push('');
    }

    if (!hasUpdate) {
      chunks.push('function Update(deltaTime)');
      if (hasUpdate60) {
        chunks.push('  _update60()');
      } else if (hasUpdateP8) {
        chunks.push('  _update()');
      }
      if (hasDraw) {
        chunks.push('  _draw()');
      }
      if (!hasUpdate60 && !hasUpdateP8 && !hasDraw) {
        chunks.push('  -- No PICO-8 frame functions were found; add game logic here.');
      }
      chunks.push('end');
      chunks.push('');
    }

    if (chunks.length === 2) {
      chunks.push('function Setup()');
      chunks.push('end');
      chunks.push('');
      chunks.push('function Update(deltaTime)');
      chunks.push('end');
      chunks.push('');
    }

    return chunks.join('\n');
  }

  detectCompatibilityWarnings(luaSource, parsedSections, sfxConverted = 0) {
    const warnings = [];
    const source = String(luaSource || '');
    const checks = [
      { api: 'cartdata', regex: /\bcartdata\s*\(/ },
      { api: 'dget', regex: /\bdget\s*\(/ },
      { api: 'dset', regex: /\bdset\s*\(/ },
      { api: 'peek', regex: /\bpeek\s*\(/ },
      { api: 'poke', regex: /\bpoke\s*\(/ },
      { api: 'peek2', regex: /\bpeek2\s*\(/ },
      { api: 'poke2', regex: /\bpoke2\s*\(/ },
      { api: 'reload', regex: /\breload\s*\(/ },
      { api: 'cstore', regex: /\bcstore\s*\(/ },
      { api: 'serial', regex: /\bserial\s*\(/ },
      { api: 'run', regex: /\brun\s*\(/ },
      { api: 'extcmd', regex: /\bextcmd\s*\(/ },
      { api: 'menuitem', regex: /\bmenuitem\s*\(/ },
      { api: 'printh', regex: /\bprinth\s*\(/ },
    ];

    for (const check of checks) {
      if (check.regex.test(source)) {
        warnings.push(`Uses ${check.api}(), which may be unsupported or partial in RetroStudio runtime.`);
      }
    }

    const gfxLines = (parsedSections?.gfx || []).join('').trim();
    const mapLines = (parsedSections?.map || []).join('').trim();
    const sfxLines = (parsedSections?.sfx || []).join('').trim();
    const musicLines = (parsedSections?.music || []).join('').trim();

    if (gfxLines) warnings.push('Includes __gfx__ data. First pass import stores this section as text; native conversion is pending.');
    if (mapLines) warnings.push('Includes __map__ data. First pass import stores this section as text; native conversion is pending.');
    if (sfxLines && !sfxConverted) warnings.push('Includes __sfx__ data, but no slot contained audible steps. The raw section is stored as text.');
    if (musicLines) warnings.push('Includes __music__ data. First pass import stores this section as text; native conversion is pending.');

    return warnings;
  }

  async showImportSummaryModal(summary) {
    const warningLines = (summary?.warnings || []).length
      ? summary.warnings.map((w, i) => `${i + 1}. ${w}`).join('\n')
      : 'None';

    const message = [
      `Project: ${summary.projectName}`,
      `Source: ${summary.sourceFile}`,
      '',
      'Lifecycle transforms:',
      `- Setup synthesized from _init: ${summary.transformed.setupFromInit ? 'yes' : 'no'}`,
      `- Update synthesized: ${summary.transformed.synthesizedUpdate ? 'yes' : 'no'}`,
      '',
      `Converted SFX slots: ${(summary?.convertedSfx || []).length}`,
      '',
      'Compatibility warnings:',
      warningLines,
    ].join('\n');

    if (window.ModalUtils?.showConfirm) {
      await window.ModalUtils.showConfirm('PICO-8 Import Summary', message, {
        okText: 'Done',
        cancelText: 'Close',
      });
      return;
    }

    alert(message);
  }

  async addTextFile(explorer, folderPath, fileName, content) {
    const file = new File([String(content || '')], fileName, { type: 'text/plain' });
    await explorer.addFileToProject(file, folderPath, true, true);
  }

  /**
   * Convert every audible slot in the cart's __sfx__ section into a Studio `.sfx`
   * resource. File names keep the PICO-8 slot number so `sfx(n)` calls line up.
   */
  async importSfxSlots(explorer, projectName, sfxLines) {
    const slots = this.parseP8SfxSection(sfxLines);
    if (slots.length === 0) return [];

    const sfxFolder = explorer.getPreferredManagedFolderForExtension
      ? explorer.getPreferredManagedFolderForExtension(projectName, '.sfx')
      : `${projectName}/${this.getSourcesRootUi()}/SFX`;

    const converted = [];
    for (const slot of slots) {
      const spec = this.picoSlotToSfxJson(slot);
      if (!spec) continue;

      const fileName = `sfx_${String(slot.index).padStart(2, '0')}.sfx`;
      await this.addTextFile(explorer, sfxFolder, fileName, JSON.stringify(spec, null, 2));
      converted.push({
        slot: slot.index,
        file: fileName,
        speed: spec.pico.speed,
        loopStart: spec.pico.loopStart,
        loopEnd: spec.pico.loopEnd,
      });
    }

    return converted;
  }

  async importProject(file, options = {}) {
    this.ensureDeps();
    const explorer = this.projectExplorer;
    if (!explorer) throw new Error('ProjectExplorer unavailable');

    if (!file || typeof file.name !== 'string' || !file.name.toLowerCase().endsWith('.p8')) {
      throw new Error('Only .p8 files are currently supported.');
    }

    const parsed = this.parseP8Text(await file.text());
    const preferredName = this.sanitizeProjectName(options.projectNameOverride || file.name);
    const projectName = this.allocateProjectName(explorer, preferredName);

    explorer.addProject(projectName);
    explorer.setFocusedProjectName(projectName);

    if (typeof explorer.applyTemplateDefaults === 'function') {
      await explorer.applyTemplateDefaults(projectName);
    } else if (typeof explorer.ensurePackageScaffold === 'function') {
      await explorer.ensurePackageScaffold(projectName);
    }

    const sourcesRoot = this.getSourcesRootUi();
    const preferredLuaFolder = explorer.getPreferredManagedFolderForExtension
      ? explorer.getPreferredManagedFolderForExtension(projectName, '.lua')
      : `${projectName}/${sourcesRoot}/Lua`;
    const importFolder = `${projectName}/${sourcesRoot}/Import/pico8`;

    const runtimeLua = this.buildRuntimeLua(parsed.lua);

    await this.addTextFile(explorer, preferredLuaFolder, 'main.lua', runtimeLua);
    await this.addTextFile(explorer, importFolder, 'cart-original.p8', parsed.raw);

    const namedSections = ['gfx', 'map', 'gff', 'sfx', 'music', 'label'];
    for (const name of namedSections) {
      const sectionLines = parsed.sections[name] || [];
      if (sectionLines.length === 0) continue;
      const sectionContent = sectionLines.join('\n').trim();
      if (!sectionContent) continue;
      await this.addTextFile(explorer, importFolder, `${name}.txt`, sectionContent);
    }

    const convertedSfx = await this.importSfxSlots(explorer, projectName, parsed.sections.sfx || []);

    const importSummary = {
      sourceFile: file.name,
      projectName,
      transformed: {
        setupFromInit: /\bfunction\s+Setup\s*\(/.test(runtimeLua) && /_init/.test(runtimeLua),
        synthesizedUpdate: /\bfunction\s+Update\s*\(/.test(runtimeLua),
      },
      hasSections: {
        lua: Boolean(parsed.lua),
        gfx: (parsed.sections.gfx || []).length > 0,
        map: (parsed.sections.map || []).length > 0,
        sfx: (parsed.sections.sfx || []).length > 0,
        music: (parsed.sections.music || []).length > 0,
      },
      convertedSfx,
      warnings: this.detectCompatibilityWarnings(parsed.lua, parsed.sections, convertedSfx.length),
    };
    await this.addTextFile(explorer, importFolder, 'import-summary.json', JSON.stringify(importSummary, null, 2));

    explorer.renderTree?.();
    if (typeof explorer.initializeProjectConfig === 'function') {
      await explorer.initializeProjectConfig();
    }

    await this.showImportSummaryModal(importSummary);

    window.gameEmulator?.updateStatus?.(`Imported PICO-8 cart: ${projectName}`, 'success');
    return importSummary;
  }
}

// Register service in container if available
(function initPico8ImportService() {
  try {
    const services = window.serviceContainer;
    if (services) {
      const instance = new Pico8ImportService(services);
      services.registerSingleton('pico8ImportService', instance);
      window.pico8ImportService = instance;
    } else {
      window.pico8ImportService = new Pico8ImportService(null);
    }
  } catch (_) {
    // ignore
  }
})();

window.Pico8ImportService = Pico8ImportService;
