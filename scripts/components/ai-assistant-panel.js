// AI Assistant panel - a dockable chat strip under the editor tabs.
//
// Sits inside .main-content as a sibling of .viewer-container so the Lua editor
// stays visible while the assistant is open.

class AiAssistantPanel {
  constructor(service) {
    this.service = service || window.aiAssistantService;
    this.root = null;
    this.messagesEl = null;
    this.inputEl = null;
    this.sendBtn = null;
    this.stopBtn = null;
    this.statusEl = null;
    this.modelSelect = null;
    this.includeFileCheckbox = null;
    this.autoApplyCheckbox = null;
    this.saveCheckbox = null;
    this.history = [];
    this.streaming = false;
    // Set by renderAssistantText when the model answers a change request with a
    // whole-file rewrite in a fence instead of edit blocks. It does this on
    // roughly one request in five, so the rewrite needs an apply path too.
    this.pendingRewrite = null;
  }

  isOpen() {
    return Boolean(this.root) && !this.root.classList.contains('is-hidden');
  }

  toggle() {
    if (!this.root) this.mount();
    if (this.isOpen()) {
      this.root.classList.add('is-hidden');
    } else {
      this.root.classList.remove('is-hidden');
      this.refreshModels();
      this.inputEl?.focus();
    }
  }

  mount() {
    const mainContent = document.getElementById('mainContent');
    if (!mainContent) {
      console.error('[AiAssistant] #mainContent not found; cannot mount panel.');
      return;
    }

    const panel = document.createElement('div');
    panel.className = 'ai-panel is-hidden';
    panel.id = 'aiAssistantPanel';

    const resizer = document.createElement('div');
    resizer.className = 'ai-panel-resizer';
    panel.appendChild(resizer);

    const header = document.createElement('div');
    header.className = 'ai-panel-header';

    const title = document.createElement('span');
    title.className = 'ai-panel-title';
    title.textContent = 'Lua Assistant';
    header.appendChild(title);

    this.statusEl = document.createElement('span');
    this.statusEl.className = 'ai-panel-status';
    header.appendChild(this.statusEl);

    const spacer = document.createElement('span');
    spacer.className = 'ai-panel-spacer';
    header.appendChild(spacer);

    this.modelSelect = document.createElement('select');
    this.modelSelect.className = 'ai-panel-model';
    this.modelSelect.title = 'Ollama model';
    this.modelSelect.addEventListener('change', () => {
      this.service.setModel(this.modelSelect.value);
    });
    header.appendChild(this.modelSelect);

    const includeLabel = document.createElement('label');
    includeLabel.className = 'ai-panel-toggle';
    includeLabel.title = 'Send the currently open Lua file as context';
    this.includeFileCheckbox = document.createElement('input');
    this.includeFileCheckbox.type = 'checkbox';
    this.includeFileCheckbox.checked = true;
    includeLabel.appendChild(this.includeFileCheckbox);
    includeLabel.appendChild(document.createTextNode(' open file'));
    header.appendChild(includeLabel);

    const saveLabel = document.createElement('label');
    saveLabel.className = 'ai-panel-toggle';
    saveLabel.title = 'Apply suggested edits as soon as the answer finishes';
    this.autoApplyCheckbox = document.createElement('input');
    this.autoApplyCheckbox.type = 'checkbox';
    this.autoApplyCheckbox.checked = true;
    const autoLabel = document.createElement('label');
    autoLabel.className = 'ai-panel-toggle';
    autoLabel.title = 'Apply suggested edits as soon as the answer finishes';
    autoLabel.appendChild(this.autoApplyCheckbox);
    autoLabel.appendChild(document.createTextNode(' auto-apply'));
    header.appendChild(autoLabel);

    saveLabel.title = 'Write the file to disk after applying an edit';
    this.saveCheckbox = document.createElement('input');
    this.saveCheckbox.type = 'checkbox';
    this.saveCheckbox.checked = true;
    saveLabel.appendChild(this.saveCheckbox);
    saveLabel.appendChild(document.createTextNode(' save on apply'));
    header.appendChild(saveLabel);

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'ai-panel-btn';
    settingsBtn.type = 'button';
    settingsBtn.textContent = 'Server';
    settingsBtn.title = 'Change the Ollama server URL';
    settingsBtn.addEventListener('click', () => this.promptForBaseUrl());
    header.appendChild(settingsBtn);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'ai-panel-btn';
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => this.clear());
    header.appendChild(clearBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ai-panel-btn';
    closeBtn.type = 'button';
    closeBtn.textContent = '\u00d7';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => this.toggle());
    header.appendChild(closeBtn);

    panel.appendChild(header);

    this.messagesEl = document.createElement('div');
    this.messagesEl.className = 'ai-panel-messages';
    panel.appendChild(this.messagesEl);

    const inputRow = document.createElement('div');
    inputRow.className = 'ai-panel-input-row';

    this.inputEl = document.createElement('textarea');
    this.inputEl.className = 'ai-panel-input';
    this.inputEl.rows = 2;
    this.inputEl.placeholder = 'Ask about Lua for this project\u2026  (Enter to send, Shift+Enter for a new line)';
    this.inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.send();
      }
    });
    inputRow.appendChild(this.inputEl);

    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'ai-panel-send';
    this.sendBtn.type = 'button';
    this.sendBtn.textContent = 'Send';
    this.sendBtn.addEventListener('click', () => this.send());
    inputRow.appendChild(this.sendBtn);

    this.stopBtn = document.createElement('button');
    this.stopBtn.className = 'ai-panel-send ai-panel-stop is-hidden';
    this.stopBtn.type = 'button';
    this.stopBtn.textContent = 'Stop';
    this.stopBtn.addEventListener('click', () => this.service.cancel());
    inputRow.appendChild(this.stopBtn);

    panel.appendChild(inputRow);

    // .main-content is a flex column whose .viewer-container is flex:1, so
    // appending here docks the panel under the editor and shrinks the editor
    // rather than covering it.
    mainContent.appendChild(panel);

    this.root = panel;
    this.setupResizer(resizer);
    this.addSystemNote('Connected to a local Ollama server. Nothing is sent off this machine.');
  }

  setupResizer(resizer) {
    let startY = 0;
    let startHeight = 0;

    const onMove = (event) => {
      const delta = startY - event.clientY;
      const next = Math.min(Math.max(startHeight + delta, 120), window.innerHeight - 200);
      this.root.style.height = `${next}px`;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };

    resizer.addEventListener('mousedown', (event) => {
      startY = event.clientY;
      startHeight = this.root.getBoundingClientRect().height;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.userSelect = 'none';
      event.preventDefault();
    });
  }

  async promptForBaseUrl() {
    const current = this.service.getBaseUrl();
    const next = window.prompt('Ollama server URL', current);
    if (next === null) return;
    this.service.setBaseUrl(next);
    this.service.apiReferencePromise = null;
    await this.refreshModels();
  }

  async refreshModels() {
    this.setStatus('connecting\u2026');
    try {
      const models = await this.service.listModels();
      this.modelSelect.textContent = '';
      const current = this.service.getModel();

      if (models.length === 0) {
        this.setStatus('no models installed', true);
        return;
      }

      for (const name of models) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        this.modelSelect.appendChild(option);
      }

      // Keep the configured model if it is still installed, otherwise fall back
      // to whatever the server actually has so the first request cannot 404.
      if (models.includes(current)) {
        this.modelSelect.value = current;
      } else {
        this.modelSelect.value = models[0];
        this.service.setModel(models[0]);
      }

      this.setStatus(`ready \u00b7 ${models.length} model${models.length === 1 ? '' : 's'}`);
    } catch (error) {
      this.setStatus(this.service.describeConnectionError(error), true);
    }
  }

  setStatus(text, isError = false) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('is-error', Boolean(isError));
  }

  clear() {
    this.history = [];
    this.messagesEl.textContent = '';
    this.addSystemNote('Conversation cleared.');
  }

  addSystemNote(text) {
    const note = document.createElement('div');
    note.className = 'ai-msg ai-msg-system';
    note.textContent = text;
    this.messagesEl.appendChild(note);
    this.scrollToBottom();
  }

  addMessage(role) {
    const wrapper = document.createElement('div');
    wrapper.className = `ai-msg ai-msg-${role}`;

    const label = document.createElement('div');
    label.className = 'ai-msg-role';
    label.textContent = role === 'user' ? 'You' : 'Assistant';
    wrapper.appendChild(label);

    const body = document.createElement('div');
    body.className = 'ai-msg-body';
    wrapper.appendChild(body);

    this.messagesEl.appendChild(wrapper);
    this.scrollToBottom();
    return body;
  }

  scrollToBottom() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  /**
   * Renders assistant text. Model output is untrusted, so every value goes in as
   * textContent - never innerHTML - and fenced code becomes real DOM nodes.
   */
  renderAssistantText(container, text) {
    container.textContent = '';
    this.pendingRewrite = null;

    // Reasoning models (qwen3, deepseek-r1) wrap their scratchpad in <think>.
    // Drop it, including the unclosed tail while the answer is still streaming.
    let cleaned = String(text)
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/<think>[\s\S]*$/, '')
      .trim();

    if (!cleaned) {
      const thinking = document.createElement('div');
      thinking.className = 'ai-msg-system';
      thinking.textContent = 'thinking\u2026';
      container.appendChild(thinking);
      return [];
    }

    // Models fence the edit blocks despite being told not to (ornith does it
    // every time). Strip fences that sit directly against the edit markers
    // rather than requiring the whole block to be wrapped in one match.
    cleaned = cleaned
      .replace(/```[a-zA-Z0-9_+-]*[ \t]*\r?\n(?=<{5,9}[ \t]*SEARCH)/g, '')
      .replace(/(>{5,9}[ \t]*REPLACE)[ \t]*\r?\n[ \t]*```[ \t]*/g, '$1\n');

    const editPattern = /<{5,9}[ \t]*SEARCH[ \t]*\r?\n([\s\S]*?)\r?\n?={5,9}[ \t]*\r?\n([\s\S]*?)\r?\n?>{5,9}[ \t]*REPLACE/g;
    const edits = [];
    let lastIndex = 0;
    let match;

    while ((match = editPattern.exec(cleaned)) !== null) {
      this.renderProse(container, cleaned.slice(lastIndex, match.index));
      const edit = { search: match[1], replace: match[2] };
      edits.push(edit);
      container.appendChild(this.buildEditCard(edit));
      lastIndex = match.index + match[0].length;
    }

    this.renderProse(container, cleaned.slice(lastIndex));

    if (edits.length > 1) {
      const bar = document.createElement('div');
      bar.className = 'ai-edit-all';
      const applyAll = document.createElement('button');
      applyAll.type = 'button';
      applyAll.className = 'ai-code-btn';
      applyAll.textContent = `Apply all ${edits.length} edits`;
      applyAll.addEventListener('click', () => this.applyAll(edits, applyAll));
      bar.appendChild(applyAll);
      container.appendChild(bar);
    }

    return edits;
  }

  renderProse(container, text) {
    if (!text || !text.trim()) return;

    const parts = text.split(/```/);

    parts.forEach((part, index) => {
      const isCode = index % 2 === 1;

      if (!isCode) {
        if (!part.trim()) return;
        const paragraph = document.createElement('div');
        paragraph.className = 'ai-text';
        paragraph.textContent = part.replace(/^\n+|\n+$/g, '');
        container.appendChild(paragraph);
        return;
      }

      const newlineIndex = part.indexOf('\n');
      const firstLine = newlineIndex === -1 ? part : part.slice(0, newlineIndex);
      const looksLikeLanguage = /^[a-zA-Z0-9_+-]*$/.test(firstLine.trim());
      const language = looksLikeLanguage ? firstLine.trim() : '';
      const code = looksLikeLanguage && newlineIndex !== -1 ? part.slice(newlineIndex + 1) : part;

      container.appendChild(this.buildCodeBlock(code.replace(/\n+$/, ''), language));
    });
  }

  buildCodeBlock(code, language) {
    const block = document.createElement('div');
    block.className = 'ai-code';

    const toolbar = document.createElement('div');
    toolbar.className = 'ai-code-toolbar';

    const languageLabel = document.createElement('span');
    languageLabel.className = 'ai-code-lang';
    languageLabel.textContent = language || 'code';
    toolbar.appendChild(languageLabel);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'ai-code-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
      } catch {
        copyBtn.textContent = 'Failed';
      }
    });
    toolbar.appendChild(copyBtn);

    const insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'ai-code-btn';
    insertBtn.textContent = 'Insert at cursor';
    insertBtn.addEventListener('click', () => this.insertIntoEditor(code, insertBtn));
    toolbar.appendChild(insertBtn);

    // A fenced block that still contains every top level function of the open
    // file is a rewrite of that file, not a snippet, so offer to swap it in.
    if (this.isFullFileRewrite(code)) {
      languageLabel.textContent = `${language || 'code'} \u00b7 full file`;

      const status = document.createElement('span');
      status.className = 'ai-edit-status';
      toolbar.appendChild(status);

      const replaceBtn = document.createElement('button');
      replaceBtn.type = 'button';
      replaceBtn.className = 'ai-code-btn';
      replaceBtn.textContent = 'Replace file';
      replaceBtn.addEventListener('click', () => this.applyFullRewrite(code, status, replaceBtn));
      toolbar.appendChild(replaceBtn);

      this.pendingRewrite = { code, statusEl: status, button: replaceBtn };
    }

    block.appendChild(toolbar);

    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    codeEl.textContent = code;
    pre.appendChild(codeEl);
    block.appendChild(pre);

    return block;
  }

  buildEditCard(edit) {
    const card = document.createElement('div');
    card.className = 'ai-edit';

    const toolbar = document.createElement('div');
    toolbar.className = 'ai-code-toolbar';

    const label = document.createElement('span');
    label.className = 'ai-code-lang';
    label.textContent = edit.search.trim() ? 'Suggested edit' : 'Insertion';
    toolbar.appendChild(label);

    const status = document.createElement('span');
    status.className = 'ai-edit-status';
    toolbar.appendChild(status);
    edit.statusEl = status;

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'ai-code-btn';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', () => this.applyEdit(edit, status, applyBtn));
    toolbar.appendChild(applyBtn);
    edit.button = applyBtn;

    card.appendChild(toolbar);

    const diff = document.createElement('pre');
    diff.className = 'ai-edit-diff';
    this.appendDiffLines(diff, edit.search, 'ai-diff-del', '-');
    this.appendDiffLines(diff, edit.replace, 'ai-diff-add', '+');
    card.appendChild(diff);

    return card;
  }

  /**
   * True when a fenced block looks like a rewrite of the whole open file rather
   * than a snippet. Requires every top level function in the current file to
   * survive, so a partial answer can never silently delete working code.
   */
  isFullFileRewrite(code) {
    if (!this.service.isEditModeEnabled()) return false;

    const viewer = this.getActiveEditorViewer();
    if (!viewer) return false;

    const current = viewer.monacoEditor.getValue() || '';
    if (!current.trim() || !code.trim()) return false;

    const names = [...current.matchAll(/^[ \t]*function[ \t]+([A-Za-z_][\w.:]*)[ \t]*\(/gm)].map((m) => m[1]);
    if (!names.length) return false;

    return names.every((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`function[ \\t]+${escaped}[ \\t]*\\(`).test(code);
    });
  }

  appendDiffLines(container, text, className, prefix) {
    if (!text) return;
    for (const line of text.split('\n')) {
      const row = document.createElement('span');
      row.className = className;
      row.textContent = `${prefix} ${line}\n`;
      container.appendChild(row);
    }
  }

  /**
   * Locates the SEARCH text in the model by whole-line comparison. Line based
   * rather than raw indexOf so that trailing-whitespace and CRLF differences in
   * the model's copy of the file do not defeat an otherwise correct edit.
   * Returns { range, matches } or null.
   */
  locateEditRange(model, search) {
    const searchLines = search.replace(/\r\n/g, '\n').split('\n');
    while (searchLines.length && !searchLines[searchLines.length - 1].trim()) searchLines.pop();
    while (searchLines.length && !searchLines[0].trim()) searchLines.shift();
    if (!searchLines.length) return null;

    const lineCount = model.getLineCount();

    const collect = (compare) => {
      const hits = [];
      for (let start = 1; start + searchLines.length - 1 <= lineCount; start += 1) {
        let ok = true;
        for (let i = 0; i < searchLines.length; i += 1) {
          if (!compare(model.getLineContent(start + i), searchLines[i])) {
            ok = false;
            break;
          }
        }
        if (ok) hits.push(start);
      }
      return hits;
    };

    let hits = collect((a, b) => a.replace(/\s+$/, '') === b.replace(/\s+$/, ''));
    if (hits.length === 0) hits = collect((a, b) => a.trim() === b.trim());
    if (hits.length === 0) return null;

    const startLine = hits[0];
    const endLine = startLine + searchLines.length - 1;

    return {
      range: new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)),
      matches: hits.length,
    };
  }

  applyEdit(edit, statusEl, button, options = {}) {
    const viewer = this.getActiveEditorViewer();
    if (!viewer) {
      this.setEditStatus(statusEl, 'no editor open', true);
      return false;
    }

    const editor = viewer.monacoEditor;
    const model = editor.getModel();
    const replacement = edit.replace.replace(/\r\n/g, '\n');

    let range;
    let matches = 1;

    if (!edit.search.trim()) {
      // Pure insertion: place it at the end of the file.
      const lastLine = model.getLineCount();
      range = new monaco.Range(lastLine, model.getLineMaxColumn(lastLine), lastLine, model.getLineMaxColumn(lastLine));
    } else {
      const located = this.locateEditRange(model, edit.search);
      if (!located) {
        this.setEditStatus(statusEl, 'original lines not found in this file', true);
        return false;
      }
      range = located.range;
      matches = located.matches;
    }

    editor.executeEdits('ai-assistant', [{ range, text: replacement, forceMoveMarkers: true }]);
    editor.revealRangeInCenter(range);

    if (button) {
      button.textContent = 'Applied';
      button.disabled = true;
    }

    const note = matches > 1 ? `applied to the first of ${matches} matches` : 'applied';
    this.setEditStatus(statusEl, note);
    if (!options.skipSave) this.saveActiveFile(viewer, statusEl, note);
    return true;
  }

  /**
   * Swaps the entire file for the model's rewrite. Goes through executeEdits so
   * a single Ctrl+Z puts the original back.
   */
  applyFullRewrite(code, statusEl, button, options = {}) {
    const viewer = this.getActiveEditorViewer();
    if (!viewer) {
      this.setEditStatus(statusEl, 'no editor open', true);
      return false;
    }

    const editor = viewer.monacoEditor;
    const model = editor.getModel();
    const lastLine = model.getLineCount();
    const range = new monaco.Range(1, 1, lastLine, model.getLineMaxColumn(lastLine));

    editor.executeEdits('ai-assistant', [{ range, text: code.replace(/\r\n/g, '\n'), forceMoveMarkers: true }]);

    if (button) {
      button.textContent = 'Replaced';
      button.disabled = true;
    }

    this.setEditStatus(statusEl, 'whole file replaced \u00b7 Ctrl+Z to undo');
    if (!options.skipSave) this.saveActiveFile(viewer, statusEl, 'whole file replaced');
    return true;
  }

  async saveActiveFile(viewer, statusEl, note) {
    if (!this.saveCheckbox?.checked || typeof viewer.save !== 'function') return;
    try {
      await viewer.save();
      this.setEditStatus(statusEl, `${note} \u00b7 saved`);
    } catch (error) {
      this.setEditStatus(statusEl, `${note} \u00b7 save failed: ${error?.message || error}`, true);
    }
  }

  applyAll(edits, button) {
    const { applied, failed } = this.applyEdits(edits);

    if (button) {
      button.textContent = failed
        ? `Applied ${applied}, ${failed} failed`
        : `Applied ${applied}`;
      button.disabled = true;
    }
  }

  /**
   * Applies a batch. Each edit is located by content, so applying them in
   * sequence stays valid even though earlier edits shift line numbers.
   */
  applyEdits(edits) {
    let applied = 0;
    let failed = 0;

    for (const edit of edits) {
      if (this.applyEdit(edit, edit.statusEl, edit.button, { skipSave: true })) applied += 1;
      else failed += 1;
    }

    // One save for the whole batch rather than one per edit.
    if (applied) {
      const viewer = this.getActiveEditorViewer();
      if (viewer) this.saveActiveFile(viewer, null, 'applied');
    }

    return { applied, failed };
  }

  setEditStatus(element, text, isError = false) {
    if (!element) return;
    element.textContent = text;
    element.classList.toggle('is-error', Boolean(isError));
  }

  getActiveEditorViewer() {
    const tabManager = window.tabManager;
    if (!tabManager) return null;

    const viewer = tabManager.activeTabId === 'preview'
      ? tabManager.previewViewer
      : tabManager.dedicatedTabs?.get(tabManager.activeTabId)?.viewer;

    return viewer?.monacoEditor ? viewer : null;
  }

  insertIntoEditor(code, button) {
    const viewer = this.getActiveEditorViewer();
    if (!viewer) {
      const original = button.textContent;
      button.textContent = 'No open editor';
      setTimeout(() => { button.textContent = original; }, 1600);
      return;
    }

    const editor = viewer.monacoEditor;
    const selection = editor.getSelection();
    editor.executeEdits('ai-assistant', [{ range: selection, text: code, forceMoveMarkers: true }]);
    editor.focus();

    const original = button.textContent;
    button.textContent = 'Inserted';
    setTimeout(() => { button.textContent = original; }, 1200);
  }

  collectEditorContext() {
    if (!this.includeFileCheckbox?.checked) return null;
    const viewer = this.getActiveEditorViewer();
    if (!viewer) return null;

    const code = viewer.monacoEditor.getValue() || '';
    if (!code.trim()) return null;

    const name = viewer.fileName || viewer.filename || viewer.fullPath || 'current file';
    const selection = viewer.monacoEditor.getSelection();
    const selectedText = selection && !selection.isEmpty?.()
      ? viewer.monacoEditor.getModel()?.getValueInRange(selection)
      : '';

    let context = `The user is editing \`${name}\`:\n\n\`\`\`lua\n${code}\n\`\`\``;
    if (selectedText) {
      context += `\n\nThey have this selected:\n\n\`\`\`lua\n${selectedText}\n\`\`\``;
    }
    // Restated next to the file itself; the system prompt alone is often too far
    // away in a long context for small models to honour.
    if (this.service.isEditModeEnabled()) {
      context += '\n\nIf the user asks for any change to this file, reply with SEARCH/REPLACE edit blocks, not a fenced code block.';
    }
    return context;
  }

  setStreaming(streaming) {
    this.streaming = streaming;
    this.sendBtn.classList.toggle('is-hidden', streaming);
    this.stopBtn.classList.toggle('is-hidden', !streaming);
    this.inputEl.disabled = streaming;
  }

  async send() {
    const text = this.inputEl.value.trim();
    if (!text || this.streaming) return;

    this.inputEl.value = '';
    const userBody = this.addMessage('user');
    userBody.textContent = text;

    const assistantBody = this.addMessage('assistant');
    assistantBody.textContent = '\u2026';

    this.setStreaming(true);
    this.setStatus('thinking\u2026');

    try {
      const systemPrompt = await this.service.buildSystemPrompt();
      const editorContext = this.collectEditorContext();

      const messages = [{ role: 'system', content: systemPrompt }];
      if (editorContext) {
        messages.push({ role: 'system', content: editorContext });
      }
      messages.push(...this.history, { role: 'user', content: text });

      // Overflow is silent on Ollama's side: it just truncates and the model
      // starts looping. Surface it instead. ~4 chars/token is close enough.
      const budget = this.service.getContextSize();
      const estimated = Math.round(
        messages.reduce((sum, message) => sum + message.content.length, 0) / 4,
      );
      if (estimated > budget * 0.9) {
        this.addSystemNote(
          `Heads up: this request is roughly ${estimated} tokens against a ${budget} context window. `
          + 'Ollama will truncate it, which usually makes the model repeat itself. '
          + 'Try Clear, or untick "open file" for general questions.',
        );
      }

      const started = performance.now();
      const reply = await this.service.streamChat(messages, (_chunk, full) => {
        const pinned = this.messagesEl.scrollTop + this.messagesEl.clientHeight
          >= this.messagesEl.scrollHeight - 40;
        this.renderAssistantText(assistantBody, full);
        if (pinned) this.scrollToBottom();
      });

      if (!reply.trim()) {
        assistantBody.textContent = '(empty response)';
      } else {
        const edits = this.renderAssistantText(assistantBody, reply);

        // Auto-apply only once the stream has finished; a partially streamed
        // block would parse into a truncated, wrong edit.
        if (edits?.length && this.autoApplyCheckbox?.checked) {
          const { applied, failed } = this.applyEdits(edits);
          this.setStatus(
            failed ? `applied ${applied}, ${failed} failed` : `auto-applied ${applied} edit(s)`,
            Boolean(failed),
          );
          this.history.push({ role: 'user', content: text });
          this.history.push({ role: 'assistant', content: reply });
          if (this.history.length > 12) this.history = this.history.slice(-12);
          return;
        }

        // No edit blocks, but the model rewrote the whole file in a fence.
        // Deliberately NOT auto-applied: a plain question can also come back as
        // a rewrite, and silently replacing the file for that is destructive.
        if (!edits?.length && this.pendingRewrite) {
          this.setEditStatus(
            this.pendingRewrite.statusEl,
            'answered with a full file rewrite - review it, then use Replace file',
          );
          this.setStatus('full file rewrite offered - not auto-applied');
          this.history.push({ role: 'user', content: text });
          this.history.push({ role: 'assistant', content: reply });
          if (this.history.length > 12) this.history = this.history.slice(-12);
          return;
        }
      }

      this.history.push({ role: 'user', content: text });
      this.history.push({ role: 'assistant', content: reply });
      // Keep the tail only; local models have modest context windows.
      if (this.history.length > 12) {
        this.history = this.history.slice(-12);
      }

      this.setStatus(`done in ${((performance.now() - started) / 1000).toFixed(1)}s`);
    } catch (error) {
      const message = this.service.describeConnectionError(error);
      if (error?.name === 'AbortError') {
        this.setStatus('stopped');
      } else {
        this.renderAssistantText(assistantBody, message);
        this.setStatus(message, true);
      }
    } finally {
      this.setStreaming(false);
      this.inputEl.focus();
    }
  }
}

window.AiAssistantPanel = AiAssistantPanel;

// Local-development guard, defined by ai-assistant-service.js. Fails closed: if
// that file did not load, the panel is not created and the ribbon section stays
// hidden. See isAiAssistantHostAllowed() for why this is loopback-only.
if (typeof window.isAiAssistantHostAllowed === 'function' && window.isAiAssistantHostAllowed()) {
  window.aiAssistantPanel = new AiAssistantPanel();

  const revealAssistantRibbonSection = () => {
    document
      .querySelector('.ribbon-section[data-ribbon-group="assist"]')
      ?.removeAttribute('hidden');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', revealAssistantRibbonSection, { once: true });
  } else {
    revealAssistantRibbonSection();
  }
}
