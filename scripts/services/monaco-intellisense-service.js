/**
 * Monaco IntelliSense Service
 * Processes Lua extension definitions and generates Monaco Editor compatible IntelliSense data
 */
class MonacoIntelliSenseService {
    constructor() {
        this.extensionData = null;
        this.completionItems = [];
        this.hoverProviders = new Map();
        this.signatureHelpers = new Map();
        console.log('[MonacoIntelliSenseService] Service initialized');
    }

    /**
     * Load and process extension definitions from JSON
     * @param {string} extensionFilePath - Path to the extensions.json file
     */
    async loadExtensions(extensionFilePath = 'scripts/lua/extensions.json') {
        try {
            console.log('[MonacoIntelliSenseService] Loading extensions from:', extensionFilePath);
            
            const response = await fetch(extensionFilePath);
            if (!response.ok) {
                throw new Error(`Failed to load extensions: ${response.status}`);
            }
            
            const text = await response.text();
            // Remove JSON comments for parsing
            const cleanJson = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
            this.extensionData = JSON.parse(cleanJson);
            
            console.log('[MonacoIntelliSenseService] Loaded extension data:', this.extensionData.name, 'v' + this.extensionData.version);
            
            // Process extensions into Monaco format
            this.processExtensions();
            
            return this.extensionData;
        } catch (error) {
            console.error('[MonacoIntelliSenseService] Failed to load extensions:', error);
            throw error;
        }
    }

    /**
     * Process the loaded extension data into Monaco-compatible formats
     */
    processExtensions() {
        if (!this.extensionData) {
            console.warn('[MonacoIntelliSenseService] No extension data to process');
            return;
        }

        console.log('[MonacoIntelliSenseService] Processing extensions for Monaco...');
        
        this.completionItems = [];
        this.hoverProviders.clear();
        this.signatureHelpers.clear();

        // Process each category
        this.extensionData.categories.forEach(category => {
            this.processCategory(category);
        });

        console.log(`[MonacoIntelliSenseService] Generated ${this.completionItems.length} completion items`);
        console.log(`[MonacoIntelliSenseService] Generated ${this.hoverProviders.size} hover providers`);
        console.log(`[MonacoIntelliSenseService] Generated ${this.signatureHelpers.size} signature helpers`);
    }

    /**
     * Process a single category of functions
     * @param {Object} category - Category object from extensions.json
     */
    processCategory(category) {
        if (!category.functions || category.functions.length === 0) {
            return;
        }

        category.functions.forEach(func => {
            this.processFunctionDefinition(category, func);
        });
    }

    /**
     * Process a single function definition into Monaco formats
     * @param {Object} category - The category this function belongs to
     * @param {Object} func - Function definition from extensions.json
     */
    processFunctionDefinition(category, func) {
        const fullName = `${category.name}.${func.name}`;
        
        // Generate completion item
        const completionItem = this.generateCompletionItem(category, func);
        this.completionItems.push(completionItem);

        // Generate hover provider data
        const hoverData = this.generateHoverData(category, func);
        this.hoverProviders.set(fullName, hoverData);

        // Generate signature help data
        const signatureData = this.generateSignatureHelp(category, func);
        this.signatureHelpers.set(fullName, signatureData);
    }

    /**
     * Generate Monaco completion item for a function
     * @param {Object} category - Function category
     * @param {Object} func - Function definition
     * @returns {Object} Monaco completion item
     */
    generateCompletionItem(category, func) {
        const fullName = `${category.name}.${func.name}`;
        
        // Generate parameter snippets for insertText
        const parameters = func.parameters || [];
        let snippetParams = '';
        if (parameters.length > 0) {
            const paramSnippets = parameters.map((param, index) => {
                return `\${${index + 1}:${param.name}}`;
            });
            snippetParams = paramSnippets.join(', ');
        }

        const insertText = `${fullName}(${snippetParams})`; // Use fullName instead of func.name
        
        // Generate documentation
        let documentation = func.description;
        if (parameters.length > 0) {
            documentation += '\n\nParameters:\n';
            parameters.forEach(param => {
                documentation += `• ${param.name} (${param.type}): ${param.description}\n`;
            });
        }
        
        if (func.returns) {
            documentation += `\nReturns: ${func.returns.type}`;
            if (func.returns.description) {
                documentation += ` - ${func.returns.description}`;
            }
        }

        if (func.example) {
            documentation += `\n\nExample:\n${func.example}`;
        }

        return {
            label: fullName,
            kind: monaco?.languages?.CompletionItemKind?.Function || 2, // Function kind
            insertText: insertText,
            insertTextRules: monaco?.languages?.CompletionItemInsertTextRule?.InsertAsSnippet || 4,
            documentation: {
                value: documentation,
                isTrusted: true
            },
            detail: `${category.name} function`,
            sortText: `${category.name}_${func.name}`,
            filterText: `${category.name}.${func.name} ${func.name}`,
            additionalTextEdits: [],
            commitCharacters: ['('],
            preselect: false,
            tags: []
        };
    }

    /**
     * Generate hover data for a function
     * @param {Object} category - Function category
     * @param {Object} func - Function definition
     * @returns {Object} Hover data
     */
    generateHoverData(category, func) {
        const fullName = `${category.name}.${func.name}`;
        
        // Generate function signature
        const parameters = func.parameters || [];
        const paramStrings = parameters.map(param => `${param.name}: ${param.type}`);
        const signature = `${fullName}(${paramStrings.join(', ')})`;
        
        let returnType = 'void';
        if (func.returns) {
            returnType = func.returns.type;
        }

        // Build markdown documentation
        let markdown = `\`\`\`lua\n${signature} -> ${returnType}\n\`\`\`\n\n`;
        markdown += `**${func.description}**\n\n`;
        
        if (parameters.length > 0) {
            markdown += '**Parameters:**\n\n';
            parameters.forEach(param => {
                markdown += `- \`${param.name}\` (\`${param.type}\`): ${param.description}\n`;
            });
            markdown += '\n';
        }

        if (func.returns && func.returns.description) {
            markdown += `**Returns:** \`${func.returns.type}\` - ${func.returns.description}\n\n`;
        }

        if (func.example) {
            markdown += '**Example:**\n\n```lua\n' + func.example + '\n```\n';
        }

        markdown += `\n*From ${category.description}*`;

        return {
            contents: [
                {
                    value: markdown,
                    isTrusted: true
                }
            ]
        };
    }

    /**
     * Generate signature help data for a function
     * @param {Object} category - Function category
     * @param {Object} func - Function definition
     * @returns {Object} Signature help data
     */
    generateSignatureHelp(category, func) {
        const fullName = `${category.name}.${func.name}`;
        const parameters = func.parameters || [];
        
        // Generate signature label
        const paramLabels = parameters.map(param => `${param.name}: ${param.type}`);
        const signatureLabel = `${fullName}(${paramLabels.join(', ')})`;

        // Generate parameter information
        const parameterInformation = parameters.map(param => ({
            label: `${param.name}: ${param.type}`,
            documentation: {
                value: param.description,
                isTrusted: true
            }
        }));

        return {
            signatures: [
                {
                    label: signatureLabel,
                    documentation: {
                        value: func.description,
                        isTrusted: true
                    },
                    parameters: parameterInformation
                }
            ],
            activeSignature: 0,
            activeParameter: 0
        };
    }

    /**
     * Get all completion items for Monaco completion provider
     * @returns {Array} Array of Monaco completion items
     */
    getCompletionItems() {
        return this.completionItems;
    }

    /**
     * Get hover data for a specific function
     * @param {string} functionName - Full function name (Category.Function)
     * @returns {Object|null} Hover data or null if not found
     */
    getHoverData(functionName) {
        return this.hoverProviders.get(functionName) || null;
    }

    /**
     * Get signature help data for a specific function
     * @param {string} functionName - Full function name (Category.Function)
     * @returns {Object|null} Signature help data or null if not found
     */
    getSignatureHelp(functionName) {
        return this.signatureHelpers.get(functionName) || null;
    }

    /**
     * Get all available function names
     * @returns {Array} Array of function names
     */
    getAllFunctionNames() {
        return Array.from(this.hoverProviders.keys());
    }

    /**
     * Get functions by category
     * @param {string} categoryName - Name of the category
     * @returns {Array} Array of function names in the category
     */
    getFunctionsByCategory(categoryName) {
        return this.getAllFunctionNames().filter(name => name.startsWith(categoryName + '.'));
    }

    /**
     * Check if a function exists in the definitions
     * @param {string} functionName - Full function name to check
     * @returns {boolean} True if function exists
     */
    hasFunction(functionName) {
        return this.hoverProviders.has(functionName);
    }

    /**
     * Get extension metadata
     * @returns {Object|null} Extension metadata or null if not loaded
     */
    getExtensionInfo() {
        if (!this.extensionData) {
            return null;
        }

        return {
            name: this.extensionData.name,
            version: this.extensionData.version,
            description: this.extensionData.description,
            targetPlatforms: this.extensionData.target_platforms,
            categoryCount: this.extensionData.categories.length,
            functionCount: this.completionItems.length
        };
    }

    /**
     * Ensure the service is ready by loading extensions if not already loaded
     * @returns {Promise<void>}
     */
    async ensureReady() {
        if (!this.extensionData) {
            console.log('[MonacoIntelliSenseService] Loading extensions data...');
            try {
                await this.loadExtensions();
                console.log('[MonacoIntelliSenseService] Extensions loaded successfully');
            } catch (error) {
                console.error('[MonacoIntelliSenseService] Failed to load extensions:', error);
                // Continue without extensions - better than failing completely
            }
        } else {
            console.log('[MonacoIntelliSenseService] Extensions already loaded');
        }
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MonacoIntelliSenseService;
}

// Export for browser global
if (typeof window !== 'undefined') {
    window.MonacoIntelliSenseService = MonacoIntelliSenseService;
}

console.log('[MonacoIntelliSenseService] Class definition loaded');
