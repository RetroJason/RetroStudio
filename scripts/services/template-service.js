// template-service.js
// Service for loading and processing file templates

class TemplateService {
  constructor() {
    this.templateCache = new Map();
    this.ready = false;
    this.initPromise = null;
  this.availableProjectTemplates = {};
  }

  /**
   * Initialize the template service
   */
  async init() {
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = this._loadTemplateIndex();
    await this.initPromise;
    this.ready = true;
    console.log('[TemplateService] Initialized successfully');
  }

  /**
   * Load template index (for now, we'll hardcode the available templates)
   * In the future, this could load from a templates.json file
   */
  async _loadTemplateIndex() {
    // Define available templates
    this.availableTemplates = {
      lua: {
        basic: { name: 'Basic Script', description: 'Simple Lua script with main function' },
        game: { name: 'Game Logic', description: 'Game script with init/update/render functions' },
        utility: { name: 'Utility Functions', description: 'Collection of helper functions' },
        empty: { name: 'Empty File', description: 'Blank file with header only' }
      }
    };

    // Define available PROJECT templates (manifest-driven)
    this.availableProjectTemplates = {
      basic: {
        id: 'basic',
        name: 'Basic Project',
        description: 'Starter project with a main.lua and folders',
        manifestPath: 'templates/projects/basic/template.json'
      }
    };
  }

  /**
   * Get available templates for a specific editor type
   * @param {string} editorType - The editor type (e.g., 'lua', 'css', 'html')
   * @returns {Object} Available templates for the editor type
   */
  getTemplatesForEditor(editorType) {
    return this.availableTemplates[editorType] || {};
  }

  /**
   * Get available project templates
   * @returns {Object} Map of project templates
   */
  getProjectTemplates() {
    return this.availableProjectTemplates || {};
  }

  /**
   * Load a template file
   * @param {string} editorType - The editor type (e.g., 'lua')
   * @param {string} templateName - The template name (e.g., 'basic')
   * @param {boolean} includeComments - Whether to include comments version
   * @returns {Promise<string>} The template content
   */
  async loadTemplate(editorType, templateName, includeComments = true) {
    const suffix = includeComments ? '' : '-minimal';
    const templateKey = `${editorType}/${templateName}${suffix}`;
    
    // Check cache first
    if (this.templateCache.has(templateKey)) {
      return this.templateCache.get(templateKey);
    }

    try {
      const templatePath = `templates/${editorType}/${templateName}${suffix}.${editorType}`;
      console.log(`[TemplateService] Loading template: ${templatePath}`);
      
      const response = await fetch(templatePath);
      if (!response.ok) {
        throw new Error(`Failed to load template: ${response.status} ${response.statusText}`);
      }
      
      const content = await response.text();
      
      // Cache the template
      this.templateCache.set(templateKey, content);
      
      console.log(`[TemplateService] Loaded template: ${templateKey} (${content.length} chars)`);
      return content;
    } catch (error) {
      console.error(`[TemplateService] Failed to load template ${templateKey}:`, error);
      
      // Return a basic fallback template
      return this._getFallbackTemplate(editorType, templateName, includeComments);
    }
  }

  /**
   * Load a project template manifest by name
   * @param {string} templateName
   * @returns {Promise<Object>} manifest JSON
   */
  async loadProjectManifest(templateName) {
    const tpl = this.availableProjectTemplates?.[templateName];
    if (!tpl) {
      console.warn(`[TemplateService] Unknown project template: ${templateName}, using fallback`);
      return this._getFallbackProjectManifest(templateName);
    }
    const url = tpl.manifestPath;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      return json;
    } catch (err) {
      console.warn(`[TemplateService] Failed to load project manifest ${url}:`, err);
      return this._getFallbackProjectManifest(templateName);
    }
  }

  /**
   * Create a new project from a template manifest
   * Saves files through FileManager/FileIOService and returns created paths
   * @param {string} templateName
   * @param {Object} options - variables like { projectName }
   * @returns {Promise<string[]>} list of created file paths
   */
  async createProjectFromTemplate(templateName, options = {}) {
    // Ensure services
    const fm = window.serviceContainer?.get?.('fileManager') || window.fileManager;
    if (!fm) throw new Error('FileManager not available');

    const manifest = await this.loadProjectManifest(templateName);
    const variables = { projectName: 'MyProject', ...options };

    const created = [];
    if (!manifest || !Array.isArray(manifest.files)) return created;

    for (const file of manifest.files) {
      try {
        const outPath = this.processTemplate(file.path, variables);

        // Determine content
        let content = '';
        if (file.source === 'inline') {
          content = this.processTemplate(file.content || '', variables);
        } else if (file.source === 'template') {
          const editorType = file.editorType || 'lua';
          const tplName = file.templateName || 'basic';
          const includeComments = file.includeComments !== false;
          content = await this.createFromTemplate(editorType, tplName, {
            includeComments,
            variables: { filename: outPath.split('/').pop(), projectName: variables.projectName }
          });
        } else if (file.source === 'base64') {
          // Binary from base64
          const b64 = (file.content || '').split(',').pop();
          content = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
        }

        // Infer metadata
        const ext = outPath.toLowerCase().split('.').pop();
        let builderId;
        if (window.buildSystem?.getBuilderIdForExtension) {
          builderId = window.buildSystem.getBuilderIdForExtension('.' + ext);
        } else if (ext === 'sfx') {
          builderId = 'sfx';
        } else if (['pal', 'act', 'aco'].includes(ext)) {
          builderId = 'pal';
        }

        // Save via FileManager (delegates to storage service)
        await fm.saveFile(outPath, content, { builderId });
        created.push(outPath);
      } catch (err) {
        console.warn('[TemplateService] Failed creating file from template:', file, err);
      }
    }

    return created;
  }

  /**
   * Fallback project manifest when external file is missing
   */
  _getFallbackProjectManifest(templateName) {
    const sourcesRoot = (window.ProjectPaths && typeof window.ProjectPaths.getSourcesRootUi === 'function')
      ? window.ProjectPaths.getSourcesRootUi()
      : 'Resources';
    return {
      name: 'Basic Project',
      version: 1,
      files: [
        {
          path: `${sourcesRoot}/Lua/main.lua`,
          source: 'template',
          editorType: 'lua',
          templateName: 'game',
          includeComments: true
        },
        {
          path: `${sourcesRoot}/README.txt`,
          source: 'inline',
          content: `# {{projectName}}\n\nThis is your new RetroStudio project. Start in ${sourcesRoot}/Lua/main.lua.`
        }
      ]
    };
  }

  /**
   * Process template placeholders
   * @param {string} templateContent - The raw template content
   * @param {Object} variables - Variables to substitute
   * @returns {string} Processed template content
   */
  processTemplate(templateContent, variables = {}) {
    let processed = templateContent;
    
    // Default variables
    const defaultVars = {
      filename: 'untitled',
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString(),
      datetime: new Date().toLocaleString(),
      year: new Date().getFullYear().toString(),
      user: 'User' // Could be made configurable
    };
    
    // Merge with provided variables
    const allVars = { ...defaultVars, ...variables };
    
    // Replace placeholders
    for (const [key, value] of Object.entries(allVars)) {
      const placeholder = `{{${key}}}`;
      processed = processed.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    }
    
    return processed;
  }

  /**
   * Get a fallback template if the file can't be loaded
   * @param {string} editorType - The editor type
   * @param {string} templateName - The template name
   * @param {boolean} includeComments - Whether to include comments
   * @returns {string} Fallback template content
   */
  _getFallbackTemplate(editorType, templateName, includeComments) {
    console.log(`[TemplateService] Using fallback template for ${editorType}/${templateName}`);
    
    if (editorType === 'lua') {
      if (includeComments) {
        return `-- {{filename}}
-- Created: {{date}}

-- ${templateName} template (fallback)

function main()
    print("Hello from {{filename}}!")
end

main()`;
      } else {
        return `function main()
    print("Hello from {{filename}}!")
end

main()`;
      }
    }
    
    // Generic fallback
    return includeComments ? 
      `// {{filename}}\n// Created: {{date}}\n\n// ${templateName} template\n` :
      '';
  }

  /**
   * Create content from template
   * @param {string} editorType - The editor type
   * @param {string} templateName - The template name
   * @param {Object} options - Template options
   * @returns {Promise<string>} Generated content
   */
  async createFromTemplate(editorType, templateName, options = {}) {
    const { includeComments = true, variables = {} } = options;
    
    // Load the template
    const templateContent = await this.loadTemplate(editorType, templateName, includeComments);
    
    // Process placeholders
    const processedContent = this.processTemplate(templateContent, variables);
    
    return processedContent;
  }

  /**
   * Preload templates for better performance
   * @param {string} editorType - The editor type to preload
   */
  async preloadTemplates(editorType) {
    const templates = this.getTemplatesForEditor(editorType);
    const loadPromises = [];
    
    for (const templateName of Object.keys(templates)) {
      loadPromises.push(this.loadTemplate(editorType, templateName, true));
      loadPromises.push(this.loadTemplate(editorType, templateName, false));
    }
    
    try {
      await Promise.all(loadPromises);
      console.log(`[TemplateService] Preloaded templates for ${editorType}`);
    } catch (error) {
      console.warn(`[TemplateService] Some templates failed to preload for ${editorType}:`, error);
    }
  }
}

// Create global instance
window.templateService = new TemplateService();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.templateService.init();
  });
} else {
  window.templateService.init();
}

// Export for use
window.TemplateService = TemplateService;
