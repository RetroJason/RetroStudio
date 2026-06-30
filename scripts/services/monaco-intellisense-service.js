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
    * @param {string} extensionFilePath - Path to the canonical Lua API JSON file
     */
    async loadExtensions(extensionFilePath = 'scripts/lua/api.json') {
        try {
            console.log('[MonacoIntelliSenseService] Loading extensions from simulator component:', extensionFilePath);

            if (!window.EmbeddedRuntimePlayer || typeof window.EmbeddedRuntimePlayer.getExtensionDefinitions !== 'function') {
                throw new Error('Simulator component extension provider is unavailable.');
            }

            this.extensionData = await window.EmbeddedRuntimePlayer.getExtensionDefinitions(extensionFilePath);
            
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
    * @param {Object} category - Category object from the canonical Lua API contract
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
    * @param {Object} func - Function definition from the canonical Lua API contract
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

        const paramStrings = parameters.map(param => `${param.name}: ${param.type}`);
        const signature = `${fullName}(${paramStrings.join(', ')})`;
        
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
            categoryName: category.name,
            categoryDescription: category.description,
            functionName: func.name,
            fullName: fullName,
            snippetParams: snippetParams,
            documentation: documentation,
            signature: signature,
            parameters: parameters,
            returns: func.returns || null
        };
    }

    createFunctionSuggestion(item, options = {}) {
        const useMemberInsertText = options.useMemberInsertText === true;
        const label = useMemberInsertText ? item.functionName : item.fullName;
        const insertTextBase = useMemberInsertText ? item.functionName : item.fullName;
        const insertText = item.snippetParams
            ? `${insertTextBase}(${item.snippetParams})`
            : `${insertTextBase}()`;

        return {
            label: label,
            kind: monaco?.languages?.CompletionItemKind?.Function || 2,
            insertText: insertText,
            insertTextRules: monaco?.languages?.CompletionItemInsertTextRule?.InsertAsSnippet || 4,
            documentation: {
                value: item.documentation,
                isTrusted: true
            },
            detail: item.signature,
            sortText: `${item.categoryName}_${item.functionName}`,
            filterText: `${item.fullName} ${item.functionName} ${item.categoryName}`,
            additionalTextEdits: [],
            commitCharacters: ['('],
            preselect: false,
            tags: []
        };
    }

    createCategorySuggestion(category) {
        return {
            label: category.name,
            kind: monaco?.languages?.CompletionItemKind?.Module || 8,
            insertText: category.name,
            documentation: {
                value: category.description,
                isTrusted: true
            },
            detail: `${category.name} module`,
            sortText: `0_${category.name}`,
            filterText: `${category.name} ${category.description}`,
            additionalTextEdits: [],
            preselect: false,
            tags: []
        };
    }

    scoreCompletionItem(item, currentWord, categoryName) {
        const normalizedWord = String(currentWord || '').trim().toLowerCase();
        const fullName = item.fullName.toLowerCase();
        const functionName = item.functionName.toLowerCase();
        const normalizedCategory = String(categoryName || '').trim().toLowerCase();

        if (!normalizedWord) {
            return 0;
        }

        if (normalizedCategory && functionName === normalizedWord) {
            return 0;
        }

        if (!normalizedCategory && fullName === normalizedWord) {
            return 0;
        }

        if (normalizedCategory && functionName.startsWith(normalizedWord)) {
            return 1;
        }

        if (!normalizedCategory && fullName.startsWith(normalizedWord)) {
            return 1;
        }

        if (!normalizedCategory && item.categoryName.toLowerCase().startsWith(normalizedWord)) {
            return 2;
        }

        if (functionName.includes(normalizedWord)) {
            return 3;
        }

        if (fullName.includes(normalizedWord)) {
            return 4;
        }

        return 5;
    }

    getCompletionItemsForContext(options = {}) {
        const currentWord = String(options.currentWord || '').trim();
        const categoryName = String(options.categoryName || '').trim();
        const useMemberInsertText = categoryName.length > 0;
        const normalizedWord = currentWord.toLowerCase();

        const suggestions = this.completionItems
            .filter((item) => {
                if (useMemberInsertText && item.categoryName !== categoryName) {
                    return false;
                }

                if (!normalizedWord) {
                    return true;
                }

                if (useMemberInsertText) {
                    return item.functionName.toLowerCase().includes(normalizedWord);
                }

                return item.fullName.toLowerCase().includes(normalizedWord)
                    || item.functionName.toLowerCase().includes(normalizedWord)
                    || item.categoryName.toLowerCase().includes(normalizedWord);
            })
            .sort((left, right) => {
                const scoreDiff = this.scoreCompletionItem(left, currentWord, categoryName)
                    - this.scoreCompletionItem(right, currentWord, categoryName);
                if (scoreDiff !== 0) {
                    return scoreDiff;
                }

                return left.signature.localeCompare(right.signature);
            })
            .map((item) => this.createFunctionSuggestion(item, { useMemberInsertText }));

        if (!useMemberInsertText && this.extensionData && Array.isArray(this.extensionData.categories)) {
            const categorySuggestions = this.extensionData.categories
                .filter((category) => {
                    if (!normalizedWord) {
                        return true;
                    }

                    return String(category.name || '').toLowerCase().includes(normalizedWord);
                })
                .map((category) => this.createCategorySuggestion(category));

            return [...categorySuggestions, ...suggestions];
        }

        return suggestions;
    }

    getCallContext(textBeforeCursor) {
        const match = String(textBeforeCursor || '').match(/([A-Za-z_]\w*)\.([A-Za-z_]\w*)\(([^()]*)$/);
        if (!match) {
            return null;
        }

        const argumentsText = match[3].trim();
        let activeParameter = 0;
        if (argumentsText.length > 0) {
            activeParameter = argumentsText.split(',').length - 1;
        }

        return {
            categoryName: match[1],
            functionName: match[2],
            fullName: `${match[1]}.${match[2]}`,
            activeParameter: activeParameter
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
        return this.getCompletionItemsForContext();
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
