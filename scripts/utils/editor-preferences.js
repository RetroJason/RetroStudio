// editor-preferences.js
// Shared Monaco editor preferences for RetroStudio.

class EditorPreferences {
  static getDefaultPreferences() {
    return {
      fontSize: 14,
      tabSize: 2,
      indentSize: 2,
      insertSpaces: true,
      wordWrap: true,
      renderWhitespace: 'selection',
      showLineNumbers: true,
      highlightCurrentLine: true,
      minimapEnabled: true,
      quickSuggestions: true,
      quickSuggestionsDelay: 10,
      suggestOnTriggerCharacters: false,
      acceptSuggestionOnEnter: false,
      acceptSuggestionOnCommitCharacter: false,
      snippetSuggestions: 'inline',
      tabCompletion: 'off',
      wordBasedSuggestions: 'matchingDocuments',
      suggestSelection: 'recentlyUsedByPrefix',
      parameterHintsEnabled: true,
      inlineSuggestEnabled: true
    };
  }

  static getConfigManager() {
    if (!window.configManager) {
      throw new Error('ConfigManager is not available');
    }

    return window.configManager;
  }

  static getTabManager() {
    const tabManager = window.serviceContainer?.get?.('tabManager') || window.tabManager;
    if (!tabManager) {
      throw new Error('TabManager is not available');
    }

    return tabManager;
  }

  static getPreferences() {
    const config = this.getConfigManager();
    const defaults = this.getDefaultPreferences();

    return {
      fontSize: config.get('editor.fontSize', defaults.fontSize),
      tabSize: config.get('editor.tabSize', defaults.tabSize),
      indentSize: config.get('editor.indentSize', defaults.indentSize),
      insertSpaces: config.get('editor.insertSpaces', defaults.insertSpaces),
      wordWrap: config.get('editor.wordWrap', defaults.wordWrap),
      renderWhitespace: config.get('editor.renderWhitespace', defaults.renderWhitespace),
      showLineNumbers: config.get('editor.showLineNumbers', defaults.showLineNumbers),
      highlightCurrentLine: config.get('editor.highlightCurrentLine', defaults.highlightCurrentLine),
      minimapEnabled: config.get('editor.minimapEnabled', defaults.minimapEnabled),
      quickSuggestions: config.get('editor.quickSuggestions', defaults.quickSuggestions),
      quickSuggestionsDelay: config.get('editor.quickSuggestionsDelay', defaults.quickSuggestionsDelay),
      suggestOnTriggerCharacters: config.get('editor.suggestOnTriggerCharacters', defaults.suggestOnTriggerCharacters),
      acceptSuggestionOnEnter: config.get('editor.acceptSuggestionOnEnter', defaults.acceptSuggestionOnEnter),
      acceptSuggestionOnCommitCharacter: config.get('editor.acceptSuggestionOnCommitCharacter', defaults.acceptSuggestionOnCommitCharacter),
      snippetSuggestions: config.get('editor.snippetSuggestions', defaults.snippetSuggestions),
      tabCompletion: config.get('editor.tabCompletion', defaults.tabCompletion),
      wordBasedSuggestions: config.get('editor.wordBasedSuggestions', defaults.wordBasedSuggestions),
      suggestSelection: config.get('editor.suggestSelection', defaults.suggestSelection),
      parameterHintsEnabled: config.get('editor.parameterHintsEnabled', defaults.parameterHintsEnabled),
      inlineSuggestEnabled: config.get('editor.inlineSuggestEnabled', defaults.inlineSuggestEnabled)
    };
  }

  static validatePreferences(preferences) {
    if (!preferences || typeof preferences !== 'object') {
      throw new Error('IDE preferences payload must be an object');
    }

    const value = preferences;
    const renderWhitespaceValues = new Set(['none', 'selection', 'boundary', 'all']);
    const snippetSuggestionValues = new Set(['top', 'bottom', 'inline', 'none']);
    const tabCompletionValues = new Set(['off', 'on', 'onlySnippets']);
    const wordBasedSuggestionValues = new Set(['off', 'currentDocument', 'matchingDocuments', 'allDocuments']);
    const suggestSelectionValues = new Set(['first', 'recentlyUsed', 'recentlyUsedByPrefix']);

    if (!Number.isInteger(value.fontSize) || value.fontSize < 8 || value.fontSize > 32) {
      throw new Error('IDE preference fontSize is invalid');
    }

    if (!Number.isInteger(value.tabSize) || value.tabSize < 1 || value.tabSize > 8) {
      throw new Error('IDE preference tabSize is invalid');
    }

    if (!Number.isInteger(value.indentSize) || value.indentSize < 1 || value.indentSize > 8) {
      throw new Error('IDE preference indentSize is invalid');
    }

    if (typeof value.insertSpaces !== 'boolean') {
      throw new Error('IDE preference insertSpaces is invalid');
    }

    if (typeof value.wordWrap !== 'boolean') {
      throw new Error('IDE preference wordWrap is invalid');
    }

    if (!renderWhitespaceValues.has(value.renderWhitespace)) {
      throw new Error('IDE preference renderWhitespace is invalid');
    }

    if (typeof value.showLineNumbers !== 'boolean') {
      throw new Error('IDE preference showLineNumbers is invalid');
    }

    if (typeof value.highlightCurrentLine !== 'boolean') {
      throw new Error('IDE preference highlightCurrentLine is invalid');
    }

    if (typeof value.minimapEnabled !== 'boolean') {
      throw new Error('IDE preference minimapEnabled is invalid');
    }

    if (typeof value.quickSuggestions !== 'boolean') {
      throw new Error('IDE preference quickSuggestions is invalid');
    }

    if (!Number.isInteger(value.quickSuggestionsDelay) || value.quickSuggestionsDelay < 0 || value.quickSuggestionsDelay > 5000) {
      throw new Error('IDE preference quickSuggestionsDelay is invalid');
    }

    if (typeof value.suggestOnTriggerCharacters !== 'boolean') {
      throw new Error('IDE preference suggestOnTriggerCharacters is invalid');
    }

    if (typeof value.acceptSuggestionOnEnter !== 'boolean') {
      throw new Error('IDE preference acceptSuggestionOnEnter is invalid');
    }

    if (typeof value.acceptSuggestionOnCommitCharacter !== 'boolean') {
      throw new Error('IDE preference acceptSuggestionOnCommitCharacter is invalid');
    }

    if (!snippetSuggestionValues.has(value.snippetSuggestions)) {
      throw new Error('IDE preference snippetSuggestions is invalid');
    }

    if (!tabCompletionValues.has(value.tabCompletion)) {
      throw new Error('IDE preference tabCompletion is invalid');
    }

    if (!wordBasedSuggestionValues.has(value.wordBasedSuggestions)) {
      throw new Error('IDE preference wordBasedSuggestions is invalid');
    }

    if (!suggestSelectionValues.has(value.suggestSelection)) {
      throw new Error('IDE preference suggestSelection is invalid');
    }

    if (typeof value.parameterHintsEnabled !== 'boolean') {
      throw new Error('IDE preference parameterHintsEnabled is invalid');
    }

    if (typeof value.inlineSuggestEnabled !== 'boolean') {
      throw new Error('IDE preference inlineSuggestEnabled is invalid');
    }

    return {
      fontSize: value.fontSize,
      tabSize: value.tabSize,
      indentSize: value.indentSize,
      insertSpaces: value.insertSpaces,
      wordWrap: value.wordWrap,
      renderWhitespace: value.renderWhitespace,
      showLineNumbers: value.showLineNumbers,
      highlightCurrentLine: value.highlightCurrentLine,
      minimapEnabled: value.minimapEnabled,
      quickSuggestions: value.quickSuggestions,
      quickSuggestionsDelay: value.quickSuggestionsDelay,
      suggestOnTriggerCharacters: value.suggestOnTriggerCharacters,
      acceptSuggestionOnEnter: value.acceptSuggestionOnEnter,
      acceptSuggestionOnCommitCharacter: value.acceptSuggestionOnCommitCharacter,
      snippetSuggestions: value.snippetSuggestions,
      tabCompletion: value.tabCompletion,
      wordBasedSuggestions: value.wordBasedSuggestions,
      suggestSelection: value.suggestSelection,
      parameterHintsEnabled: value.parameterHintsEnabled,
      inlineSuggestEnabled: value.inlineSuggestEnabled
    };
  }

  static async persistLocalPreferences(preferences) {
    const config = this.getConfigManager();

    config.set('editor.fontSize', preferences.fontSize);
    config.set('editor.tabSize', preferences.tabSize);
    config.set('editor.indentSize', preferences.indentSize);
    config.set('editor.insertSpaces', preferences.insertSpaces);
    config.set('editor.wordWrap', preferences.wordWrap);
    config.set('editor.renderWhitespace', preferences.renderWhitespace);
    config.set('editor.showLineNumbers', preferences.showLineNumbers);
    config.set('editor.highlightCurrentLine', preferences.highlightCurrentLine);
    config.set('editor.minimapEnabled', preferences.minimapEnabled);
    config.set('editor.quickSuggestions', preferences.quickSuggestions);
    config.set('editor.quickSuggestionsDelay', preferences.quickSuggestionsDelay);
    config.set('editor.suggestOnTriggerCharacters', preferences.suggestOnTriggerCharacters);
    config.set('editor.acceptSuggestionOnEnter', preferences.acceptSuggestionOnEnter);
    config.set('editor.acceptSuggestionOnCommitCharacter', preferences.acceptSuggestionOnCommitCharacter);
    config.set('editor.snippetSuggestions', preferences.snippetSuggestions);
    config.set('editor.tabCompletion', preferences.tabCompletion);
    config.set('editor.wordBasedSuggestions', preferences.wordBasedSuggestions);
    config.set('editor.suggestSelection', preferences.suggestSelection);
    config.set('editor.parameterHintsEnabled', preferences.parameterHintsEnabled);
    config.set('editor.inlineSuggestEnabled', preferences.inlineSuggestEnabled);

    await config.saveToStorage();
  }

  static async applyHostedPreferences(preferences) {
    if (preferences == null) {
      return false;
    }

    const validatedPreferences = this.validatePreferences(preferences);
    await this.persistLocalPreferences(validatedPreferences);
    this.applyToOpenEditors();
    return true;
  }

  static async savePreferences(preferences) {
    const validatedPreferences = this.validatePreferences(preferences);
    const hostedStudioApi = window.retrowwwHostedStudio;

    if (hostedStudioApi && typeof hostedStudioApi.saveIdePreferences === 'function') {
      const savedPreferences = await hostedStudioApi.saveIdePreferences(validatedPreferences);
      const resolvedPreferences = savedPreferences == null
        ? validatedPreferences
        : this.validatePreferences(savedPreferences);

      await this.persistLocalPreferences(resolvedPreferences);
      this.applyToOpenEditors();
      return resolvedPreferences;
    }

    await this.persistLocalPreferences(validatedPreferences);
    this.applyToOpenEditors();
    return validatedPreferences;
  }

  static buildMonacoOptions(overrides = {}) {
    const preferences = this.getPreferences();

    return {
      fontSize: preferences.fontSize,
      tabSize: preferences.tabSize,
      indentSize: preferences.indentSize,
      insertSpaces: preferences.insertSpaces,
      lineNumbers: preferences.showLineNumbers ? 'on' : 'off',
      wordWrap: preferences.wordWrap ? 'on' : 'off',
      renderWhitespace: preferences.renderWhitespace,
      renderLineHighlight: preferences.highlightCurrentLine ? 'line' : 'none',
      minimap: { enabled: preferences.minimapEnabled },
      quickSuggestions: {
        other: preferences.quickSuggestions,
        comments: preferences.quickSuggestions,
        strings: preferences.quickSuggestions
      },
      quickSuggestionsDelay: preferences.quickSuggestionsDelay,
      suggestOnTriggerCharacters: preferences.suggestOnTriggerCharacters,
      acceptSuggestionOnEnter: preferences.acceptSuggestionOnEnter ? 'on' : 'off',
      acceptSuggestionOnCommitCharacter: preferences.acceptSuggestionOnCommitCharacter,
      snippetSuggestions: preferences.snippetSuggestions,
      tabCompletion: preferences.tabCompletion,
      wordBasedSuggestions: preferences.wordBasedSuggestions,
      suggestSelection: preferences.suggestSelection,
      parameterHints: { enabled: preferences.parameterHintsEnabled },
      inlineSuggest: { enabled: preferences.inlineSuggestEnabled },
      ...overrides
    };
  }

  static applyToMonacoEditor(editor, overrides = {}) {
    if (!editor || typeof editor.updateOptions !== 'function') {
      throw new Error('A Monaco editor instance is required');
    }

    const options = this.buildMonacoOptions(overrides);
    editor.updateOptions(options);
    return options;
  }

  static applyToViewer(viewer) {
    if (!viewer) {
      return false;
    }

    if (typeof viewer.applyEditorPreferences === 'function') {
      viewer.applyEditorPreferences();
      return true;
    }

    if (viewer.monacoEditor && typeof viewer.monacoEditor.updateOptions === 'function') {
      this.applyToMonacoEditor(viewer.monacoEditor, { readOnly: !!viewer.readOnly });
      return true;
    }

    if (viewer.editor && typeof viewer.editor.updateOptions === 'function') {
      this.applyToMonacoEditor(viewer.editor, { readOnly: !!viewer.isReadOnly });
      return true;
    }

    return false;
  }

  static applyToOpenEditors() {
    const tabManager = this.getTabManager();

    this.applyToViewer(tabManager.previewViewer);

    for (const tabInfo of tabManager.dedicatedTabs.values()) {
      this.applyToViewer(tabInfo.viewer);
    }
  }

  static async showPreferencesDialog() {
    if (!window.ModalUtils || typeof window.ModalUtils.showForm !== 'function') {
      throw new Error('ModalUtils.showForm is not available');
    }

    const preferences = this.getPreferences();
    const result = await window.ModalUtils.showForm(
      'IDE Preferences',
      [
        {
          type: 'section',
          label: 'Editor',
          hint: 'Layout, indentation, and visibility options for Monaco-based editors.'
        },
        {
          type: 'number',
          name: 'fontSize',
          label: 'Editor Font Size',
          defaultValue: preferences.fontSize,
          min: 8,
          max: 32,
          required: true,
          hint: 'Applies to Monaco-based editors.'
        },
        {
          type: 'number',
          name: 'tabSize',
          label: 'Tab Size',
          defaultValue: preferences.tabSize,
          min: 1,
          max: 8,
          required: true,
          hint: 'Number of spaces a tab represents.'
        },
        {
          type: 'number',
          name: 'indentSize',
          label: 'Indent Size',
          defaultValue: preferences.indentSize,
          min: 1,
          max: 8,
          required: true,
          hint: 'Size Monaco uses for indentation operations.'
        },
        {
          type: 'checkbox',
          name: 'insertSpaces',
          label: 'Insert Spaces',
          defaultValue: preferences.insertSpaces,
          hint: 'Uses spaces instead of literal tab characters when indenting.'
        },
        {
          type: 'checkbox',
          name: 'wordWrap',
          label: 'Word Wrap',
          defaultValue: preferences.wordWrap,
          hint: 'Wrap long lines inside the editor viewport.'
        },
        {
          type: 'checkbox',
          name: 'showLineNumbers',
          label: 'Show Line Numbers',
          defaultValue: preferences.showLineNumbers
        },
        {
          type: 'checkbox',
          name: 'highlightCurrentLine',
          label: 'Highlight Current Line',
          defaultValue: preferences.highlightCurrentLine
        },
        {
          type: 'checkbox',
          name: 'minimapEnabled',
          label: 'Show Minimap',
          defaultValue: preferences.minimapEnabled
        },
        {
          type: 'select',
          name: 'renderWhitespace',
          label: 'Render Whitespace',
          defaultValue: preferences.renderWhitespace,
          options: [
            { value: 'none', text: 'Never' },
            { value: 'selection', text: 'Selection Only' },
            { value: 'boundary', text: 'Boundary' },
            { value: 'all', text: 'Always' }
          ],
          hint: 'Controls visible whitespace markers in the editor.'
        },
        {
          type: 'section',
          label: 'IntelliSense',
          hint: 'Suggestion and auto-complete behavior.'
        },
        {
          type: 'checkbox',
          name: 'quickSuggestions',
          label: 'Enable Auto Complete While Typing',
          defaultValue: preferences.quickSuggestions,
          hint: 'Controls Monaco quick suggestions.'
        },
        {
          type: 'number',
          name: 'quickSuggestionsDelay',
          label: 'Suggestion Delay (ms)',
          defaultValue: preferences.quickSuggestionsDelay,
          min: 0,
          max: 5000,
          required: true,
          hint: 'Delay before quick suggestions appear while typing.'
        },
        {
          type: 'checkbox',
          name: 'suggestOnTriggerCharacters',
          label: 'Trigger Suggestions From Special Characters',
          defaultValue: preferences.suggestOnTriggerCharacters,
          hint: 'Shows IntelliSense after trigger characters such as ".".'
        },
        {
          type: 'checkbox',
          name: 'acceptSuggestionOnEnter',
          label: 'Accept Suggestions On Enter',
          defaultValue: preferences.acceptSuggestionOnEnter,
          hint: 'When enabled, pressing Enter commits the selected suggestion.'
        },
        {
          type: 'checkbox',
          name: 'acceptSuggestionOnCommitCharacter',
          label: 'Accept On Commit Character',
          defaultValue: preferences.acceptSuggestionOnCommitCharacter,
          hint: 'Allows characters like "." or "(" to accept a suggestion.'
        },
        {
          type: 'checkbox',
          name: 'parameterHintsEnabled',
          label: 'Show Parameter Hints',
          defaultValue: preferences.parameterHintsEnabled
        },
        {
          type: 'checkbox',
          name: 'inlineSuggestEnabled',
          label: 'Enable Inline Suggestions',
          defaultValue: preferences.inlineSuggestEnabled
        },
        {
          type: 'select',
          name: 'snippetSuggestions',
          label: 'Snippet Suggestions',
          defaultValue: preferences.snippetSuggestions,
          options: [
            { value: 'top', text: 'Top' },
            { value: 'inline', text: 'Inline' },
            { value: 'bottom', text: 'Bottom' },
            { value: 'none', text: 'Off' }
          ]
        },
        {
          type: 'select',
          name: 'tabCompletion',
          label: 'Tab Completion',
          defaultValue: preferences.tabCompletion,
          options: [
            { value: 'off', text: 'Off' },
            { value: 'on', text: 'On' },
            { value: 'onlySnippets', text: 'Snippets Only' }
          ]
        },
        {
          type: 'select',
          name: 'wordBasedSuggestions',
          label: 'Word Based Suggestions',
          defaultValue: preferences.wordBasedSuggestions,
          options: [
            { value: 'off', text: 'Off' },
            { value: 'currentDocument', text: 'Current Document' },
            { value: 'matchingDocuments', text: 'Matching Open Documents' },
            { value: 'allDocuments', text: 'All Open Documents' }
          ]
        },
        {
          type: 'select',
          name: 'suggestSelection',
          label: 'Default Suggestion Selection',
          defaultValue: preferences.suggestSelection,
          options: [
            { value: 'first', text: 'First' },
            { value: 'recentlyUsed', text: 'Recently Used' },
            { value: 'recentlyUsedByPrefix', text: 'Recently Used By Prefix' }
          ]
        }
      ],
      {
        okText: 'Save',
        cancelText: 'Cancel'
      }
    );

    if (!result) {
      return false;
    }

    await this.savePreferences(result);
    window.gameEmulator?.updateStatus?.('IDE preferences updated', 'success');
    return true;
  }
}

window.EditorPreferences = EditorPreferences;