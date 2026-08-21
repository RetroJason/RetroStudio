// AI Assistant service - talks to a locally running Ollama server.
//
// Local development only. There are deliberately no credentials here: Ollama is
// unauthenticated on loopback, so nothing sensitive is stored in the browser and
// nothing leaves the machine. If this graduates to a hosted model provider the
// request must move behind a server-side proxy rather than gaining an API key
// field here.

class AiAssistantService {
  constructor() {
    this.defaultBaseUrl = 'http://localhost:11434';
    // ornith:9b reproduces SEARCH blocks character-exact, so edits apply without
    // falling back to lenient whitespace matching. ~5.6GB, fits the 12GB card.
    this.defaultModel = 'ornith:9b';
    this.apiReferencePromise = null;
    this.activeController = null;
  }

  getBaseUrl() {
    const configured = window.configManager?.get('ai.baseUrl') || this.defaultBaseUrl;
    return String(configured).replace(/\/+$/, '');
  }

  setBaseUrl(value) {
    window.configManager?.set('ai.baseUrl', String(value || '').trim() || this.defaultBaseUrl);
  }

  getModel() {
    return window.configManager?.get('ai.model') || this.defaultModel;
  }

  setModel(value) {
    window.configManager?.set('ai.model', String(value || '').trim() || this.defaultModel);
  }

  isIncludeApiReferenceEnabled() {
    const value = window.configManager?.get('ai.includeApiReference');
    return value === undefined ? true : Boolean(value);
  }

  setIncludeApiReference(enabled) {
    window.configManager?.set('ai.includeApiReference', Boolean(enabled));
  }

  /**
   * Ollama defaults to a small context window (~4k), which would silently drop
   * most of the injected API reference plus the open file. Ask for more.
   */
  getContextSize() {
    // The system prompt alone is ~4.7k tokens (the API reference dominates), so a
    // real source file plus chat history can blow past 8k. Ollama then silently
    // truncates and the model loses the edit protocol.
    // Measured on a 12GB card: ornith:9b is 6.3GB at 32k, 9.6GB at 128k, and
    // 15GB at 256k where it spills to CPU. 64k keeps it fully on GPU.
    return Number(window.configManager?.get('ai.contextSize')) || 65536;
  }

  isEditModeEnabled() {
    const value = window.configManager?.get('ai.editMode');
    return value === undefined ? true : Boolean(value);
  }

  setEditMode(enabled) {
    window.configManager?.set('ai.editMode', Boolean(enabled));
  }

  /**
   * Ollama refuses cross-origin requests unless the studio's origin is allowed,
   * which shows up as an opaque TypeError rather than an HTTP status.
   */
  describeConnectionError(error) {
    const baseUrl = this.getBaseUrl();
    if (error?.name === 'AbortError') return 'Cancelled.';
    if (error instanceof TypeError) {
      return `Could not reach Ollama at ${baseUrl}. Check it is running (\`ollama serve\`), and if the studio is not on localhost set OLLAMA_ORIGINS to allow ${window.location.origin}.`;
    }
    return error?.message || String(error);
  }

  async listModels() {
    const response = await fetch(`${this.getBaseUrl()}/api/tags`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status} ${response.statusText}`);
    }
    const payload = await response.json();
    return (payload?.models || []).map((entry) => entry.name).filter(Boolean);
  }

  /**
   * Build a compact reference from the machine-readable Lua API spec so the model
   * answers with this project's real API instead of inventing generic Lua.
   */
  async getLuaApiReference() {
    if (!this.apiReferencePromise) {
      this.apiReferencePromise = (async () => {
        const response = await fetch('scripts/lua/api.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`api.json returned ${response.status}`);
        const spec = await response.json();
        const lines = [];

        for (const category of spec.categories || []) {
          const functions = Array.isArray(category.functions) ? category.functions : [];
          if (functions.length === 0) continue;
          lines.push(`-- ${category.name}`);
          for (const fn of functions) {
            const params = (fn.parameters || [])
              .map((param) => `${param.name}: ${param.type || 'any'}`)
              .join(', ');
            const returns = fn.returns?.type ? ` -> ${fn.returns.type}` : '';
            const description = String(fn.description || '').split('\n')[0].slice(0, 90);
            lines.push(`${category.name}.${fn.name}(${params})${returns}${description ? `  -- ${description}` : ''}`);
          }
        }

        return lines.join('\n');
      })().catch((error) => {
        console.warn('[AiAssistant] Could not load Lua API reference:', error);
        this.apiReferencePromise = null;
        return '';
      });
    }

    return this.apiReferencePromise;
  }

  async buildSystemPrompt() {
    const sections = [
      'You are a Lua coding assistant embedded in RetroStudio, an IDE for building apps and games that run on a small wearable RetroWatch device.',
      'Answer with Lua that targets the RetroStudio runtime API listed below. Do not invent API functions; if something is not in the list, say so.',
      'The runtime is an embedded device with tight memory limits, so prefer simple, allocation-light code. Entry points are Setup() and Update(), and callbacks are registered through the On table.',
      'This is Lua 5.1: there are no native bitwise operators. Use Math.And, Math.Or, Math.Xor, Math.Not, Math.LShift and Math.RShift instead of & | ~ << >>. Remember that 0 is truthy in Lua, so compare bit test results explicitly, e.g. `if Math.And(keys, KEY_RIGHT) ~= 0 then`.',
      // Deliberately does not say "put code in fenced blocks" unconditionally:
      // that competes with the edit protocol below and models pick the fence.
      this.isEditModeEnabled()
        ? 'Keep answers short. Use ```lua fenced blocks only for brand new standalone snippets that are not changes to the open file.'
        : 'Keep answers short. Put code in ```lua fenced blocks so it can be inserted into the editor.',
    ];

    if (this.isEditModeEnabled()) {
      sections.push(this.buildEditProtocolPrompt());
    }

    if (this.isIncludeApiReferenceEnabled()) {
      const reference = await this.getLuaApiReference();
      if (reference) {
        sections.push(`Available API:\n${reference}`);
      }
    }

    return sections.join('\n\n');
  }

  /**
   * Aider-style search/replace blocks. Chosen over tool calling because it works
   * identically across every locally installed model, including reasoning models
   * with no tool support.
   */
  buildEditProtocolPrompt() {
    return [
      'IMPORTANT: if the user asks you to add, change, fix or remove anything in the file shown to you, you MUST answer with edit blocks. Do NOT answer with a fenced code block in that case - a fenced block cannot be applied to the file.',
      '',
      'Edit blocks use EXACTLY this format:',
      '',
      '<<<<<<< SEARCH',
      'lines copied verbatim from the current file',
      '=======',
      'the replacement lines',
      '>>>>>>> REPLACE',
      '',
      'Rules for edit blocks:',
      '- The SEARCH section must match the current file EXACTLY, character for character, including indentation. Copy it; do not retype it from memory.',
      '- Keep each SEARCH section small: only the lines that change, plus at most a line or two of surrounding context to make it unique.',
      '- Prefer several small edit blocks over one large one.',
      '- To append new code, SEARCH for a nearby existing line and repeat that line at the start of the REPLACE section.',
      '- Do NOT wrap edit blocks in markdown fences.',
      'Give a one or two sentence explanation, then the edit blocks.',
    ].join('\n');
  }

  cancel() {
    if (this.activeController) {
      this.activeController.abort();
      this.activeController = null;
    }
  }

  get isStreaming() {
    return Boolean(this.activeController);
  }

  /**
   * Streams a chat completion, invoking onDelta with each token chunk.
   * Returns the full assembled reply.
   */
  async streamChat(messages, onDelta) {
    this.cancel();
    const controller = new AbortController();
    this.activeController = controller;

    try {
      const response = await fetch(`${this.getBaseUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.getModel(),
          messages,
          stream: true,
          options: {
            num_ctx: this.getContextSize(),
            // Edits need format fidelity, not creativity. repeat_penalty is a
            // backstop against the "let me try again" loops small models fall into.
            temperature: 0.2,
            repeat_penalty: 1.1,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Ollama returned ${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';

      // Ollama streams newline-delimited JSON objects.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let payload;
          try {
            payload = JSON.parse(trimmed);
          } catch {
            continue;
          }
          if (payload.error) throw new Error(payload.error);
          const chunk = payload.message?.content;
          if (chunk) {
            full += chunk;
            onDelta?.(chunk, full);
          }
        }
      }

      return full;
    } finally {
      if (this.activeController === controller) {
        this.activeController = null;
      }
    }
  }
}

// Local-development guard.
//
// The assistant talks to an unauthenticated Ollama server on loopback. That only
// exists on a developer machine, so on any hosted origin the feature is dead
// weight that would also advertise a capability the deployment cannot honour.
// This fails closed: anything that is not an explicit loopback origin is denied.
function isAiAssistantHostAllowed() {
  try {
    const { hostname, protocol } = window.location;
    if (protocol === 'file:') {
      return true;
    }
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname === '[::1]';
  } catch (_) {
    return false;
  }
}

window.isAiAssistantHostAllowed = isAiAssistantHostAllowed;
window.AiAssistantService = AiAssistantService;

if (isAiAssistantHostAllowed()) {
  window.aiAssistantService = new AiAssistantService();

  if (window.serviceContainer?.registerSingleton) {
    window.serviceContainer.registerSingleton('aiAssistantService', window.aiAssistantService);
  }
}
