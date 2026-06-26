// editor-preferences.js
// Shared Monaco editor preferences for RetroStudio.

class EditorPreferences {
  static getPreferenceFieldDefinitions() {
    return [
      { key: 'fontSize', label: 'Editor Font Size', type: 'number', min: 8, max: 32 },
      { key: 'tabSize', label: 'Tab Size', type: 'number', min: 1, max: 8 },
      { key: 'indentSize', label: 'Indent Size', type: 'number', min: 1, max: 8 },
      { key: 'insertSpaces', label: 'Insert Spaces', type: 'checkbox' },
      { key: 'wordWrap', label: 'Word Wrap', type: 'checkbox' },
      {
        key: 'renderWhitespace',
        label: 'Render Whitespace',
        type: 'select',
        options: [
          { value: 'none', text: 'Never' },
          { value: 'selection', text: 'Selection Only' },
          { value: 'boundary', text: 'Boundary' },
          { value: 'all', text: 'Always' }
        ]
      },
      { key: 'showLineNumbers', label: 'Show Line Numbers', type: 'checkbox' },
      { key: 'highlightCurrentLine', label: 'Highlight Current Line', type: 'checkbox' },
      { key: 'minimapEnabled', label: 'Show Minimap', type: 'checkbox' },
      { key: 'quickSuggestions', label: 'Enable Auto Complete While Typing', type: 'checkbox' },
      { key: 'quickSuggestionsDelay', label: 'Suggestion Delay (ms)', type: 'number', min: 0, max: 5000 },
      { key: 'suggestOnTriggerCharacters', label: 'Trigger Suggestions From Special Characters', type: 'checkbox' },
      { key: 'acceptSuggestionOnEnter', label: 'Accept Suggestions On Enter', type: 'checkbox' },
      { key: 'acceptSuggestionOnCommitCharacter', label: 'Accept On Commit Character', type: 'checkbox' },
      {
        key: 'snippetSuggestions',
        label: 'Snippet Suggestions',
        type: 'select',
        options: [
          { value: 'top', text: 'Top' },
          { value: 'inline', text: 'Inline' },
          { value: 'bottom', text: 'Bottom' },
          { value: 'none', text: 'Off' }
        ]
      },
      {
        key: 'tabCompletion',
        label: 'Tab Completion',
        type: 'select',
        options: [
          { value: 'off', text: 'Off' },
          { value: 'on', text: 'On' },
          { value: 'onlySnippets', text: 'Snippets Only' }
        ]
      },
      {
        key: 'wordBasedSuggestions',
        label: 'Word Based Suggestions',
        type: 'select',
        options: [
          { value: 'off', text: 'Off' },
          { value: 'currentDocument', text: 'Current Document' },
          { value: 'matchingDocuments', text: 'Matching Open Documents' },
          { value: 'allDocuments', text: 'All Open Documents' }
        ]
      },
      {
        key: 'suggestSelection',
        label: 'Default Suggestion Selection',
        type: 'select',
        options: [
          { value: 'first', text: 'First' },
          { value: 'recentlyUsed', text: 'Recently Used' },
          { value: 'recentlyUsedByPrefix', text: 'Recently Used By Prefix' }
        ]
      },
      { key: 'parameterHintsEnabled', label: 'Show Parameter Hints', type: 'checkbox' },
      { key: 'inlineSuggestEnabled', label: 'Enable Inline Suggestions', type: 'checkbox' }
    ];
  }

  static _normalizePreferencePayload(preferences) {
    let value = preferences;
    let parseAttempts = 0;

    while (typeof value === 'string' && parseAttempts < 2) {
      const trimmed = value.trim();
      if (!trimmed) {
        break;
      }

      try {
        value = JSON.parse(trimmed);
      } catch (_) {
        break;
      }

      parseAttempts += 1;
    }

    return value;
  }

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
    const value = this._normalizePreferencePayload(preferences);

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('IDE preferences payload must be an object');
    }

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

  static async openPreferencesTab() {
    const tabManager = this.getTabManager();
    const componentInfo = {
      type: 'editor',
      name: 'ide-preferences-editor',
      displayName: 'IDE Preferences',
      class: IdePreferencesTabEditor,
      editorClass: IdePreferencesTabEditor
    };

    const tabId = await tabManager.openInTab('temp://ide-preferences', componentInfo, {
      forceNew: false,
      isReadOnly: false
    });

    if (tabId && typeof tabManager.updateTabTitle === 'function') {
      tabManager.updateTabTitle(tabId, 'IDE Preferences');
    }

    return tabId;
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
    await this.openPreferencesTab();
    return true;
  }
}

class IdePreferencesTabEditor {
  constructor() {
    this._controls = new Map();
    this._element = document.createElement('div');
    this._element.className = 'ide-preferences-tab';
    this._element.style.cssText = 'height:100%; overflow:auto; padding:16px; color:#d7dbe4; background:#151821;';

    this._render();
    this._load(EditorPreferences.getPreferences());
  }

  getElement() {
    return this._element;
  }

  cleanup() {
    // No-op for tab manager compatibility.
  }

  destroy() {
    // No-op for tab manager compatibility.
  }

  _render() {
    const title = document.createElement('h2');
    title.textContent = 'IDE Preferences';
    title.style.cssText = 'margin:0 0 8px 0; font-size:18px;';
    this._element.appendChild(title);

    const note = document.createElement('p');
    note.textContent = 'Changes apply to Monaco editors immediately after save and persist to your hosted account.';
    note.style.cssText = 'margin:0 0 14px 0; color:#9aa3b8; font-size:12px;';
    this._element.appendChild(note);

    this._status = document.createElement('div');
    this._status.style.cssText = 'min-height:18px; margin:0 0 12px 0; font-size:12px; color:#9aa3b8;';
    this._element.appendChild(this._status);

    const form = document.createElement('div');
    form.style.cssText = 'display:grid; grid-template-columns: 220px minmax(240px, 1fr); gap:10px 12px; align-items:center; max-width:860px;';

    for (const field of EditorPreferences.getPreferenceFieldDefinitions()) {
      const label = document.createElement('label');
      label.textContent = field.label;
      label.htmlFor = `ide-pref-${field.key}`;
      label.style.cssText = 'font-size:12px; color:#bac4db;';
      form.appendChild(label);

      let control;
      if (field.type === 'checkbox') {
        control = document.createElement('input');
        control.type = 'checkbox';
      } else if (field.type === 'select') {
        control = document.createElement('select');
        for (const option of field.options || []) {
          const optionEl = document.createElement('option');
          optionEl.value = option.value;
          optionEl.textContent = option.text;
          control.appendChild(optionEl);
        }
      } else {
        control = document.createElement('input');
        control.type = 'number';
        if (Number.isFinite(field.min)) {
          control.min = String(field.min);
        }
        if (Number.isFinite(field.max)) {
          control.max = String(field.max);
        }
      }

      control.id = `ide-pref-${field.key}`;
      if (field.type !== 'checkbox') {
        control.style.cssText = 'height:30px; border:1px solid #3f4a67; border-radius:4px; background:#0f1218; color:#e4e8f2; padding:0 8px;';
      }

      this._controls.set(field.key, { control, field });
      form.appendChild(control);
    }

    this._element.appendChild(form);

    const actions = document.createElement('div');
    actions.style.cssText = 'margin-top:14px; display:flex; gap:8px;';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.textContent = 'Save';
    saveButton.style.cssText = 'height:32px; padding:0 14px; border:1px solid #4f5f87; border-radius:4px; background:#1b2750; color:#fff; cursor:pointer;';
    saveButton.addEventListener('click', async () => {
      try {
        this._setStatus('Saving preferences...', 'info');
        const saved = await EditorPreferences.savePreferences(this._collect());
        this._load(saved);
        this._setStatus('IDE preferences saved.', 'success');
        window.gameEmulator?.updateStatus?.('IDE preferences updated', 'success');
      } catch (error) {
        this._setStatus('Save failed: ' + (error?.message || String(error)), 'error');
      }
    });
    actions.appendChild(saveButton);

    const reloadButton = document.createElement('button');
    reloadButton.type = 'button';
    reloadButton.textContent = 'Reload Current';
    reloadButton.style.cssText = 'height:32px; padding:0 14px; border:1px solid #3f4a67; border-radius:4px; background:#171d2a; color:#d7dbe4; cursor:pointer;';
    reloadButton.addEventListener('click', () => {
      this._load(EditorPreferences.getPreferences());
      this._setStatus('Reloaded current local values.', 'info');
    });
    actions.appendChild(reloadButton);

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.textContent = 'Reset To Defaults';
    resetButton.style.cssText = 'height:32px; padding:0 14px; border:1px solid #3f4a67; border-radius:4px; background:#171d2a; color:#d7dbe4; cursor:pointer;';
    resetButton.addEventListener('click', () => {
      this._load(EditorPreferences.getDefaultPreferences());
      this._setStatus('Defaults loaded. Click Save to apply.', 'info');
    });
    actions.appendChild(resetButton);

    this._element.appendChild(actions);
  }

  _load(preferences) {
    const valid = EditorPreferences.validatePreferences(preferences);
    for (const [key, entry] of this._controls.entries()) {
      if (!Object.prototype.hasOwnProperty.call(valid, key)) {
        continue;
      }

      if (entry.field.type === 'checkbox') {
        entry.control.checked = !!valid[key];
      } else {
        entry.control.value = String(valid[key]);
      }
    }
  }

  _collect() {
    const value = {};
    for (const [key, entry] of this._controls.entries()) {
      if (entry.field.type === 'checkbox') {
        value[key] = !!entry.control.checked;
      } else if (entry.field.type === 'number') {
        value[key] = Number.parseInt(entry.control.value, 10);
      } else {
        value[key] = String(entry.control.value);
      }
    }

    return value;
  }

  _setStatus(message, kind) {
    this._status.textContent = message;
    if (kind === 'error') {
      this._status.style.color = '#f48c8c';
    } else if (kind === 'success') {
      this._status.style.color = '#8fd99c';
    } else {
      this._status.style.color = '#9aa3b8';
    }
  }
}

window.EditorPreferences = EditorPreferences;
window.IdePreferencesTabEditor = IdePreferencesTabEditor;