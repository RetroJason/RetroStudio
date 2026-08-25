// lua-format-service.js
// Lua source formatting, backed by StyLua compiled to WebAssembly.
//
// StyLua is a reprinter rather than a re-indenter: it parses the source and
// writes it back out from scratch. That is what makes it safe to point at
// imported PICO-8 code, which arrives with the cart's original line numbering
// and no indentation at all, but it also means a parse failure has to be
// treated as "leave the file alone" rather than "write out whatever we got".

// Where this file was served from. Captured while the script is still
// executing, which is the only time document.currentScript is set, and needed
// because a classic script has no import.meta to resolve a sibling path with.
const LUA_FORMAT_SCRIPT_URL = (document.currentScript && document.currentScript.src) || document.baseURI;

class LuaFormatService {
  constructor() {
    this._modulePromise = null;
    this._module = null;
  }

  /**
   * Load the wasm on first use.
   *
   * It is 3MB, so it stays out of the initial page load and is fetched only
   * when someone actually formats something. The module resolves its own
   * .wasm path relative to itself, so the two files just have to stay
   * side by side.
   */
  async _load() {
    if (this._module) return this._module;
    if (!this._modulePromise) {
      this._modulePromise = (async () => {
        const url = new URL('../vendor/stylua/stylua_lib_web.js', LUA_FORMAT_SCRIPT_URL).href;
        const stylua = await import(url);
        await stylua.default();
        this._module = stylua;
        return stylua;
      })().catch((error) => {
        // Let the next attempt retry rather than caching the failure forever.
        this._modulePromise = null;
        throw error;
      });
    }
    return this._modulePromise;
  }

  /** Whether the formatter has already been downloaded. */
  get isLoaded() {
    return Boolean(this._module);
  }

  /**
   * A fresh config per call: the wasm bindings take ownership of it, so a
   * shared instance is a use-after-free the second time round.
   */
  _buildConfig(stylua, options = {}) {
    const config = stylua.Config.new();
    config.indent_type = options.useTabs ? stylua.IndentType.Tabs : stylua.IndentType.Spaces;
    config.indent_width = options.indentWidth || 4;
    config.column_width = options.columnWidth || 100;
    config.line_endings = stylua.LineEndings.Unix;
    // The Lua the studio runs is 5.4. Left on the default "All", the union of
    // every dialect's syntax is accepted, and Luau's `x :: number` shadows
    // 5.2 goto labels; naming the version keeps that ambiguity out.
    config.syntax = stylua.LuaVersion.Lua54;
    return config;
  }

  /**
   * Format Lua source. Returns the formatted text.
   *
   * Throws if the source does not parse, which is deliberate - the caller has
   * to decide whether a syntax error means "keep the original" or "tell the
   * user". Verification is on, so StyLua re-parses its own output and fails
   * rather than handing back something that no longer means the same thing.
   */
  async format(source, options = {}) {
    if (typeof source !== 'string' || source.trim() === '') return source;
    const stylua = await this._load();
    return stylua.formatCode(
      source,
      this._buildConfig(stylua, options),
      null,
      stylua.OutputVerification.Full
    );
  }

  /**
   * Format until the result stops changing.
   *
   * StyLua is deterministic but not idempotent: the line breaks already in the
   * source feed into its wrapping decisions, so a long call can settle over two
   * or three passes. Generated code is written once and read for a long time
   * afterwards, so it is worth converging before saving it. Interactive
   * formatting uses the single-pass format() instead, where a stray extra pass
   * is more surprising than a slightly wide line.
   */
  async formatStable(source, options = {}) {
    let current = await this.format(source, options);
    // Three passes is what a 2000-line cart needed; the cap is only here so a
    // pathological input cannot spin forever.
    for (let pass = 0; pass < 4; pass += 1) {
      const next = await this.format(current, options);
      if (next === current) return current;
      current = next;
    }
    return current;
  }

  /**
   * Turn a whole reformatted document into the smallest edit that produces it.
   *
   * StyLua always hands back the entire file, but replacing the entire model
   * moves the caret and collapses the change into one enormous undo step. Since
   * formatting usually rewrites a handful of lines, trimming the matching head
   * and tail keeps the caret where the user left it - which matters most for
   * formatOnPaste, where they are still typing.
   *
   * Offsets rather than lines, so a pure insertion or an appended tail comes
   * out as an empty range at the right spot instead of an inverted one.
   */
  _minimalEdit(model, formatted) {
    const original = model.getValue();
    if (original === formatted) return [];

    const limit = Math.min(original.length, formatted.length);

    let head = 0;
    while (head < limit && original[head] === formatted[head]) head += 1;
    // Never cut between the halves of a surrogate pair; the two halves are
    // meaningless on their own and would corrupt the character.
    if (head > 0 && head < original.length) {
      const code = original.charCodeAt(head);
      if (code >= 0xdc00 && code <= 0xdfff) head -= 1;
    }

    let tail = 0;
    while (
      tail < limit - head
      && original[original.length - 1 - tail] === formatted[formatted.length - 1 - tail]
    ) tail += 1;
    if (tail > 0) {
      const code = original.charCodeAt(original.length - tail);
      if (code >= 0xdc00 && code <= 0xdfff) tail -= 1;
    }

    const start = model.getPositionAt(head);
    const end = model.getPositionAt(original.length - tail);
    return [{
      range: {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      },
      text: formatted.slice(head, formatted.length - tail),
    }];
  }

  /**
   * Register Format Document / Format Selection with Monaco.
   *
   * Without a provider registered, Shift+Alt+F and the editor's formatOnPaste
   * and formatOnType options are silently inert, which is the state the Lua
   * editor was in. Registration is global to the language, so it is done once
   * rather than per editor instance.
   */
  registerMonacoProvider(monaco) {
    if (!monaco?.languages || this._registered) return;
    this._registered = true;

    const buildOptions = (formattingOptions) => ({
      useTabs: formattingOptions ? !formattingOptions.insertSpaces : false,
      indentWidth: formattingOptions?.tabSize || 4,
    });

    monaco.languages.registerDocumentFormattingEditProvider('lua', {
      provideDocumentFormattingEdits: async (model, formattingOptions) => {
        try {
          const formatted = await this.format(model.getValue(), buildOptions(formattingOptions));
          return this._minimalEdit(model, formatted);
        } catch (error) {
          // A cart mid-edit usually does not parse. Formatting is not the place
          // to complain about that, and returning no edits leaves it untouched.
          console.warn('[LuaFormatService] Format document failed:', error?.message || error);
          return [];
        }
      },
    });

    monaco.languages.registerDocumentRangeFormattingEditProvider('lua', {
      provideDocumentRangeFormattingEdits: async (model, range, formattingOptions) => {
        try {
          const stylua = await this._load();
          const source = model.getValue();
          // StyLua takes byte offsets, and only formats whole statements that
          // fall inside them, so a partial selection widens to the statements
          // it touches rather than corrupting them.
          const byteOffset = (position) => new TextEncoder().encode(
            source.slice(0, model.getOffsetAt(position))
          ).length;
          const formatted = stylua.formatCode(
            source,
            this._buildConfig(stylua, buildOptions(formattingOptions)),
            stylua.Range.from_values(
              byteOffset({ lineNumber: range.startLineNumber, column: range.startColumn }),
              byteOffset({ lineNumber: range.endLineNumber, column: range.endColumn })
            ),
            stylua.OutputVerification.Full
          );
          return this._minimalEdit(model, formatted);
        } catch (error) {
          console.warn('[LuaFormatService] Format selection failed:', error?.message || error);
          return [];
        }
      },
    });

    console.log('[LuaFormatService] Registered Lua formatting provider (Shift+Alt+F)');
  }
}

window.LuaFormatService = LuaFormatService;

(function initLuaFormatService() {
  try {
    const services = window.serviceContainer;
    const instance = new LuaFormatService();
    if (services) {
      services.registerSingleton('luaFormatService', instance);
    }
    window.luaFormatService = instance;
  } catch (_) {
    // ignore
  }
})();
