/**
 * PICO-8 dialect parser.
 *
 * PICO-8 ships a patched Lua, so cart source has to be lowered to stock Lua
 * before lua.vm.js will compile it. This does that with a real lexer and
 * recursive-descent parser rather than text substitution, because most of the
 * dialect is grammar rather than spelling: `x += 1`, `if (c) a=1 b=2` and the
 * bitwise operators all depend on knowing where a statement ends, and that is
 * exactly what a regex cannot see.
 *
 * Operator precedence follows Lua 5.3, which is where PICO-8 took its bitwise
 * operators from. The operators still lower to the runtime functions in pico8.js
 * (band, bor, shl, ...) even though the VM is now 5.3 and has `&`, `|`, `<<`,
 * `>>` and unary `~` of its own. Two reasons, both checked:
 *
 *   - Four of the eight have no Lua spelling at all: `^^` (xor - Lua spells it
 *     `~`, which PICO-8 uses for bnot), `>>>` (logical shift), and the rotates
 *     `<<>` and `>><`. Those have to be calls whatever the VM version.
 *   - The four that do exist do not behave the same, in three ways that were
 *     checked against this VM:
 *       * `0.5 & 1` is 0 here (pico8.js coerces with parseInt) but raises
 *         "number has no integer representation" in Lua.
 *       * Lua's `>>` is a LOGICAL shift: `-1 >> 1` is 2147483647. PICO-8's `>>`
 *         is arithmetic and gives -1. Lua's `>>` is really PICO-8's `>>>`.
 *       * Lua returns 0 for a shift wider than the type (`1 << 40`), while the
 *         JS runtime shifts modulo 32 and returns 256.
 *     Swapping in the native operators would silently change cart behaviour.
 *
 * So do not "simplify" these away on the grounds that 5.3 understands the
 * syntax. (Neither behaviour is true PICO-8, which works on 16.16 fixed point -
 * that is a separate, pre-existing gap and is not what this lowering is about.)
 *
 * Output preserves line numbers: every token is emitted on the line it came
 * from, so runtime errors point at the author's line and not ours.
 */
(function umd(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Pico8Parser = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';

  // =========================================================================
  // Shared tables
  // =========================================================================

  const KEYWORDS = new Set([
    'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
    'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return',
    'then', 'true', 'until', 'while',
  ]);

  /** Longest match wins, so this is sorted by length before use. */
  const OPERATORS = [
    '>>>=', '<<>=', '>><=',
    '>>>', '<<>', '>><', '^^=', '..=', '...', '<<=', '>>=',
    '==', '~=', '!=', '<=', '>=', '<<', '>>', '^^', '..', '::',
    '+=', '-=', '*=', '/=', '%=', '^=', '\\=', '&=', '|=',
    '+', '-', '*', '/', '%', '^', '#', '&', '|', '~', '<', '>', '=',
    '(', ')', '{', '}', '[', ']', ';', ':', ',', '.', '\\', '@', '$', '?',
  ].sort((a, b) => b.length - a.length);

  /** PICO-8 spells "not equal" both ways; normalise at the lexer. */
  const OPERATOR_ALIASES = { '!=': '~=' };

  /** Lua 5.3 binding powers. right < left means right associative. */
  const BINARY_PREC = {
    or: [1, 1],
    and: [2, 2],
    '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '~=': [3, 3], '==': [3, 3],
    '|': [4, 4],
    '^^': [5, 5],
    '&': [6, 6],
    '<<': [7, 7], '>>': [7, 7], '>>>': [7, 7], '<<>': [7, 7], '>><': [7, 7],
    '..': [9, 8],
    '+': [10, 10], '-': [10, 10],
    '*': [11, 11], '/': [11, 11], '%': [11, 11], '\\': [11, 11],
    '^': [14, 13],
  };
  const UNARY_PREC = 12;
  /** Anything lowered to a call is atomic and never needs bracketing. */
  const ATOMIC_PREC = [100, 100];

  const UNARY_OPERATORS = new Set(['-', 'not', '#', '~', '@', '%', '$']);

  /** Bitwise operators; these become runtime calls. See the header note. */
  const BINARY_TO_CALL = {
    '&': 'band', '|': 'bor', '^^': 'bxor',
    '<<': 'shl', '>>': 'shr', '>>>': 'lshr', '<<>': 'rotl', '>><': 'rotr',
  };
  const UNARY_TO_CALL = { '~': 'bnot', '@': 'peek', '%': 'peek2', $: 'peek4' };

  /** `a \ b` is integer division: flr(a / b). */
  const INTEGER_DIVIDE = '\\';

  /**
   * Under the fixed point lowering every number is carried as its raw 16.16
   * word in a Lua integer, which leaves + - and the comparisons already exact:
   * the scale factor is common to both sides and simply comes along. These are
   * the operators where it does not. Multiply and divide need a 64-bit
   * intermediate the VM has no type for, the shifts take a count that is itself
   * a scaled word, and .. has to turn a word back into digits.
   */
  const FIXED_BINARY_TO_CALL = {
    '*': '__p8mul', '/': '__p8div', '%': '__p8mod', '^': '__p8pow',
    '\\': '__p8idiv',
    '<<': '__p8shl', '>>': '__p8shr', '>>>': '__p8lshr',
    '<<>': '__p8rotl', '>><': '__p8rotr',
    '..': '__p8cat',
  };

  /**
   * A bitwise op works on the word itself, so under fixed point these stop
   * being runtime calls and become native Lua operators: exact, and one less
   * trip across the bridge than the lowering they replace. Only the spelling
   * differs, PICO-8 writing exclusive or as ^^ where Lua writes ~.
   */
  const FIXED_BINARY_NATIVE = { '&': '&', '|': '|', '^^': '~' };

  /**
   * PICO-8 adds its own string escapes for P8SCII control codes, filling the
   * character slots below Lua's own \a=7 .. \r=13. Stock Lua rejects these
   * outright, so they are decoded here and re-emitted as plain \ddd escapes.
   */
  const P8SCII_ESCAPES = {
    '*': '\x01', '#': '\x02', '-': '\x03', '|': '\x04', '+': '\x05', '^': '\x06',
  };

  /**
   * Since 0.2.0 a button glyph can stand in for its btn() index, so carts write
   * `btnp(🅾️)` rather than `btnp(4)`. A .p8 stores them as UTF-8, and the emoji
   * ones are usually followed by a variation selector (U+FE0F) that carries no
   * meaning here - so each glyph is listed with and without it, longest first.
   */
  const BUTTON_GLYPHS = [
    ['\u2B05\uFE0F', 0], ['\u2B05', 0],               // left
    ['\u27A1\uFE0F', 1], ['\u27A1', 1],               // right
    ['\u2B06\uFE0F', 2], ['\u2B06', 2],               // up
    ['\u2B07\uFE0F', 3], ['\u2B07', 3],               // down
    ['\uD83C\uDD7E\uFE0F', 4], ['\uD83C\uDD7E', 4],   // O
    ['\u274E\uFE0F', 5], ['\u274E', 5],               // X
  ];

  const UTF8_ENCODER = new TextEncoder();

  /**
   * PICO-8's character set. A cart holds text as single bytes, but a .p8 file is
   * written as UTF-8, so every byte outside ASCII shows up in the file as a
   * multi-byte glyph. Translating them back to their byte is what makes `#s`
   * count what the cart expects (layout code leans on it constantly, e.g.
   * `print(s, 64 - #s * 2)`), and what lets print() find the glyph in the font.
   *
   * Index == the PICO-8 character code. 0x20..0x7e map to themselves.
   */
  const P8SCII_CHARSET = [
    '\0', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '\t', '\n', 'ᵇ', 'ᶜ', '\r', 'ᵉ', 'ᶠ',
    '▮', '■', '□', '⁙', '⁘', '‖', '◀', '▶', '「', '」', '¥', '•', '、', '。', '゛', '゜',
  ];
  for (let code = 0x20; code < 0x7f; code += 1) {
    P8SCII_CHARSET.push(String.fromCharCode(code));
  }
  P8SCII_CHARSET.push(
    '○',
    // Several of these carry a trailing variation selector (U+FE0F); both the
    // decorated and bare spellings are accepted below.
    '█', '▒', '🐱', '⬇️', '░', '✽', '●', '♥', '☉', '웃', '⌂', '⬅️', '😐', '♪', '🅾️', '◆',
    '…', '➡️', '★', '⧗', '⬆️', 'ˇ', '∧', '❎', '▤', '▥', 'あ', 'い', 'う', 'え', 'お', 'か',
    'き', 'く', 'け', 'こ', 'さ', 'し', 'す', 'せ', 'そ', 'た', 'ち', 'つ', 'て', 'と', 'な', 'に',
    'ぬ', 'ね', 'の', 'は', 'ひ', 'ふ', 'へ', 'ほ', 'ま', 'み', 'む', 'め', 'も', 'や', 'ゆ', 'よ',
    'ら', 'り', 'る', 'れ', 'ろ', 'わ', 'を', 'ん', 'っ', 'ゃ', 'ゅ', 'ょ', 'ア', 'イ', 'ウ', 'エ',
    'オ', 'カ', 'キ', 'ク', 'ケ', 'コ', 'サ', 'シ', 'ス', 'セ', 'ソ', 'タ', 'チ', 'ツ', 'テ', 'ト',
    'ナ', 'ニ', 'ヌ', 'ネ', 'ノ', 'ハ', 'ヒ', 'フ', 'ヘ', 'ホ', 'マ', 'ミ', 'ム', 'メ', 'モ', 'ヤ',
    'ユ', 'ヨ', 'ラ', 'リ', 'ル', 'レ', 'ロ', 'ワ', 'ヲ', 'ン', 'ッ', 'ャ', 'ュ', 'ョ', '◜', '◝',
  );

  /**
   * Glyph spelling -> PICO-8 character code. ASCII is left out; it is identity.
   *
   * Several of these glyphs are usually written with a trailing variation
   * selector (U+FE0F) asking for the emoji rendering. It carries no meaning for
   * a cart, and whether a given .p8 includes it varies, so it is stripped from
   * both the table and the text being mapped.
   */
  const VARIATION_SELECTOR = /\uFE0F/g;
  const P8SCII_CODES = new Map();
  for (let code = 0; code < P8SCII_CHARSET.length; code += 1) {
    const glyph = P8SCII_CHARSET[code].replace(VARIATION_SELECTOR, '');
    if (glyph.codePointAt(0) < 0x80) continue;
    P8SCII_CODES.set(glyph, code);
  }
  /** Longest remaining spelling is a surrogate pair. */
  const P8SCII_MAX_UNITS = 2;

  /**
   * Rewrite decoded string text into PICO-8's single-byte characters. Anything
   * outside the character set is kept as its raw UTF-8 bytes, which is what
   * PICO-8 itself does with text it does not recognise.
   */
  function toP8Scii(text) {
    if (!/[^\x00-\x7f]/.test(text)) return text;
    const source = text.replace(VARIATION_SELECTOR, '');
    let out = '';
    let i = 0;
    while (i < source.length) {
      let matched = false;
      for (let len = P8SCII_MAX_UNITS; len >= 1; len -= 1) {
        const code = P8SCII_CODES.get(source.substr(i, len));
        if (code === undefined) continue;
        out += String.fromCharCode(code);
        i += len;
        matched = true;
        break;
      }
      if (matched) continue;
      const point = source.codePointAt(i);
      if (point < 0x80) { out += source[i]; i += 1; continue; }
      const units = point > 0xffff ? 2 : 1;
      for (const byte of UTF8_ENCODER.encode(source.substr(i, units))) {
        out += String.fromCharCode(byte);
      }
      i += units;
    }
    return out;
  }

  /** Compound assignment is "any binary operator with = appended". */
  const COMPOUND_ASSIGN = {
    '+=': '+', '-=': '-', '*=': '*', '/=': '/', '%=': '%', '^=': '^',
    '..=': '..', '\\=': '\\',
    '&=': '&', '|=': '|', '^^=': '^^',
    '<<=': '<<', '>>=': '>>', '>>>=': '>>>', '<<>=': '<<>', '>><=': '>><',
  };

  const BLOCK_ENDERS = new Set(['end', 'else', 'elseif', 'until']);

  function fail(message, line, column) {
    const error = new Error(`pico8: ${message} (line ${line})`);
    error.line = line;
    error.column = column;
    throw error;
  }

  // =========================================================================
  // Lexer
  // =========================================================================

  const isDigit = (ch) => ch >= '0' && ch <= '9';
  const isHexDigit = (ch) => isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');

  const isNameStart = (ch) => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  const isNameChar = (ch) => isNameStart(ch) || isDigit(ch);

  const HAS_GLYPH = /[^\x00-\x7f]/;

  /**
   * PICO-8's Lua counts the high P8SCII characters as name characters, so a
   * glyph can be a variable. Carts use them as one-character names, and reading
   * one that was never assigned is simply nil - `fillp(cond and pat or \u25a4)`
   * relies on that to mean "otherwise clear the pattern".
   *
   * Returns the matched spelling, including any trailing variation selector, so
   * the caller knows how far to advance. Limited to the characters a .p8 can
   * actually hold, which keeps anything else an error.
   */
  function matchGlyph(src, pos) {
    if (!(src.charCodeAt(pos) >= 0x80)) return null;
    for (let len = P8SCII_MAX_UNITS; len >= 1; len -= 1) {
      if (!P8SCII_CODES.has(src.substr(pos, len))) continue;
      return src[pos + len] === '\uFE0F' ? src.substr(pos, len + 1) : src.substr(pos, len);
    }
    return null;
  }

  /**
   * Generated output is ordinary Lua, which only accepts ASCII identifiers, so
   * a glyph name has to be rewritten. Keyed on the PICO-8 character code, which
   * is stable and cannot collide with an ASCII name from the same cart.
   */
  function sanitizeName(name) {
    if (!HAS_GLYPH.test(name)) return name;
    let out = '';
    let i = 0;
    while (i < name.length) {
      const glyph = matchGlyph(name, i);
      if (!glyph) {
        out += name[i];
        i += 1;
        continue;
      }
      out += `__p8g${P8SCII_CODES.get(glyph.replace(VARIATION_SELECTOR, '')).toString(16)}_`;
      i += glyph.length;
    }
    return out;
  }

  function tokenize(source) {
    const src = String(source == null ? '' : source);
    const tokens = [];
    let pos = 0;
    let line = 1;
    let lineStart = 0;

    const column = () => (pos - lineStart) + 1;

    /** Reads `[[`/`[==[` and returns the level, or -1 if this is not one. */
    function longBracketLevel(at) {
      if (src[at] !== '[') return -1;
      let i = at + 1;
      while (src[i] === '=') i += 1;
      return src[i] === '[' ? (i - at - 1) : -1;
    }

    function readLongBracket(level, startLine) {
      const close = `]${'='.repeat(level)}]`;
      const bodyStart = pos + level + 2;
      const end = src.indexOf(close, bodyStart);
      if (end < 0) fail('unfinished long bracket', startLine, column());
      let body = src.slice(bodyStart, end);
      for (let i = bodyStart; i < end + close.length; i += 1) {
        if (src[i] === '\n') { line += 1; lineStart = i + 1; }
      }
      const raw = src.slice(pos, end + close.length);
      pos = end + close.length;
      // Lua drops a newline immediately after the opening bracket.
      if (body[0] === '\n') body = body.slice(1);
      else if (body.startsWith('\r\n')) body = body.slice(2);
      return { raw, value: body };
    }

    function readShortString(quote, startLine) {
      const start = pos;
      let value = '';
      pos += 1;
      while (pos < src.length) {
        const ch = src[pos];
        if (ch === quote) {
          pos += 1;
          return { raw: src.slice(start, pos), value, quote };
        }
        if (ch === '\n') break;
        if (ch === '\\') {
          const next = src[pos + 1];
          const simple = {
            n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v',
            '\\': '\\', '"': '"', "'": "'", '\n': '\n',
            ...P8SCII_ESCAPES,
          };
          if (next === '\n') { line += 1; lineStart = pos + 2; }
          if (next === 'z') {
            // Lua 5.2's \z swallows the following run of whitespace.
            pos += 2;
            while (pos < src.length && /\s/.test(src[pos])) {
              if (src[pos] === '\n') { line += 1; lineStart = pos + 1; }
              pos += 1;
            }
            continue;
          }
          if (Object.prototype.hasOwnProperty.call(simple, next)) {
            value += simple[next];
            pos += 2;
          } else if (next === 'x') {
            value += String.fromCharCode(parseInt(src.substr(pos + 2, 2), 16) || 0);
            pos += 4;
          } else if (isDigit(next)) {
            let digits = '';
            let i = pos + 1;
            while (digits.length < 3 && isDigit(src[i])) { digits += src[i]; i += 1; }
            value += String.fromCharCode(Number(digits));
            pos = i;
          } else {
            value += next == null ? '' : next;
            pos += 2;
          }
          continue;
        }
        value += ch;
        pos += 1;
      }
      return fail('unfinished string', startLine, column());
    }

    function readNumber(startLine, startColumn) {
      const start = pos;
      let value;

      if (src[pos] === '0' && (src[pos + 1] === 'x' || src[pos + 1] === 'X')) {
        pos += 2;
        let digits = '';
        while (isHexDigit(src[pos])) { digits += src[pos]; pos += 1; }
        let fraction = '';
        if (src[pos] === '.') {
          pos += 1;
          while (isHexDigit(src[pos])) { fraction += src[pos]; pos += 1; }
        }
        let exponent = 0;
        if (src[pos] === 'p' || src[pos] === 'P') {
          pos += 1;
          let exp = '';
          if (src[pos] === '+' || src[pos] === '-') { exp += src[pos]; pos += 1; }
          while (isDigit(src[pos])) { exp += src[pos]; pos += 1; }
          exponent = Number(exp);
        }
        if (!digits && !fraction) fail('malformed number', startLine, startColumn);
        value = parseInt(digits || '0', 16);
        for (let i = 0; i < fraction.length; i += 1) {
          value += parseInt(fraction[i], 16) / (16 ** (i + 1));
        }
        value *= 2 ** exponent;
        return { value, raw: src.slice(start, pos) };
      }

      if (src[pos] === '0' && (src[pos + 1] === 'b' || src[pos + 1] === 'B')) {
        pos += 2;
        let digits = '';
        while (src[pos] === '0' || src[pos] === '1') { digits += src[pos]; pos += 1; }
        let fraction = '';
        if (src[pos] === '.') {
          pos += 1;
          while (src[pos] === '0' || src[pos] === '1') { fraction += src[pos]; pos += 1; }
        }
        if (!digits && !fraction) fail('malformed binary number', startLine, startColumn);
        value = digits ? parseInt(digits, 2) : 0;
        for (let i = 0; i < fraction.length; i += 1) {
          value += Number(fraction[i]) / (2 ** (i + 1));
        }
        return { value, raw: src.slice(start, pos) };
      }

      while (isDigit(src[pos])) pos += 1;
      if (src[pos] === '.') { pos += 1; while (isDigit(src[pos])) pos += 1; }
      if (src[pos] === 'e' || src[pos] === 'E') {
        pos += 1;
        if (src[pos] === '+' || src[pos] === '-') pos += 1;
        while (isDigit(src[pos])) pos += 1;
      }
      const raw = src.slice(start, pos);
      value = Number(raw);
      if (!Number.isFinite(value)) fail(`malformed number near '${raw}'`, startLine, startColumn);
      return { value, raw };
    }

    while (pos < src.length) {
      const ch = src[pos];

      if (ch === '\n') { pos += 1; line += 1; lineStart = pos; continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') { pos += 1; continue; }

      if (ch === '-' && src[pos + 1] === '-') {
        pos += 2;
        const level = longBracketLevel(pos);
        if (level >= 0) { readLongBracket(level, line); continue; }
        while (pos < src.length && src[pos] !== '\n') pos += 1;
        continue;
      }

      // `#include` is a cart directive rather than Lua, so the whole line is
      // captured verbatim for the importer to resolve later.
      if (ch === '#'
        && /^[ \t]*$/.test(src.slice(lineStart, pos))
        && /^#include\b/i.test(src.slice(pos, pos + 9))) {
        const directiveLine = line;
        const directiveColumn = column();
        let end = src.indexOf('\n', pos);
        if (end < 0) end = src.length;
        const file = src.slice(pos + 8, end).trim();
        pos = end;
        tokens.push({
          type: 'include', value: file, line: directiveLine, column: directiveColumn,
        });
        continue;
      }

      const startLine = line;
      const startColumn = column();

      if (ch === '"' || ch === "'") {
        const { raw, value, quote } = readShortString(ch, startLine);
        tokens.push({
          type: 'string', value: toP8Scii(value), raw, quote, long: false, line: startLine, column: startColumn,
        });
        continue;
      }

      if (ch === '[') {
        const level = longBracketLevel(pos);
        if (level >= 0) {
          const { raw, value } = readLongBracket(level, startLine);
          tokens.push({
            type: 'string', value: toP8Scii(value), raw, long: true, line: startLine, column: startColumn,
          });
          continue;
        }
      }

      if (isDigit(ch) || (ch === '.' && isDigit(src[pos + 1]))) {
        const { value, raw } = readNumber(startLine, startColumn);
        tokens.push({ type: 'number', value, raw, line: startLine, column: startColumn });
        continue;
      }

      // Must beat the name path: a button glyph is a number literal, not a
      // variable, even though it is otherwise a legal name character.
      const button = src.charCodeAt(pos) >= 0x80
        ? BUTTON_GLYPHS.find(([text]) => src.startsWith(text, pos))
        : null;
      if (button) {
        pos += button[0].length;
        tokens.push({
          type: 'number',
          value: button[1],
          raw: button[0],
          line: startLine,
          column: startColumn,
        });
        continue;
      }

      const nameGlyph = matchGlyph(src, pos);
      if (isNameStart(ch) || nameGlyph) {
        const start = pos;
        pos += nameGlyph ? nameGlyph.length : 1;
        for (;;) {
          if (isNameChar(src[pos])) {
            pos += 1;
            continue;
          }
          const more = matchGlyph(src, pos);
          if (!more) break;
          pos += more.length;
        }
        const word = src.slice(start, pos);
        tokens.push({
          type: KEYWORDS.has(word) ? 'keyword' : 'name',
          value: word,
          line: startLine,
          column: startColumn,
        });
        continue;
      }

      const op = OPERATORS.find((candidate) => src.startsWith(candidate, pos));
      if (!op) {
        fail(`unexpected symbol near '${ch}'`, startLine, startColumn);
      }
      pos += op.length;
      tokens.push({
        type: 'op',
        value: OPERATOR_ALIASES[op] || op,
        line: startLine,
        column: startColumn,
      });
    }

    tokens.push({ type: 'eof', value: '<eof>', line, column: column() });
    return tokens;
  }

  // =========================================================================
  // Parser
  // =========================================================================

  function parse(source) {
    const tokens = tokenize(source);
    let index = 0;

    const peek = (ahead = 0) => tokens[Math.min(index + ahead, tokens.length - 1)];
    const next = () => tokens[index++];

    const isOp = (value, ahead = 0) => {
      const token = peek(ahead);
      return token.type === 'op' && token.value === value;
    };
    const isKeyword = (value, ahead = 0) => {
      const token = peek(ahead);
      return token.type === 'keyword' && token.value === value;
    };

    function expectOp(value) {
      if (!isOp(value)) {
        const token = peek();
        fail(`'${value}' expected near '${token.value}'`, token.line, token.column);
      }
      return next();
    }

    function expectKeyword(value) {
      if (!isKeyword(value)) {
        const token = peek();
        fail(`'${value}' expected near '${token.value}'`, token.line, token.column);
      }
      return next();
    }

    function expectName() {
      const token = peek();
      if (token.type !== 'name') fail(`<name> expected near '${token.value}'`, token.line, token.column);
      return next().value;
    }

    // ---- expressions ------------------------------------------------------

    function parsePrimaryExpression() {
      const token = peek();
      if (token.type === 'name') {
        next();
        return { type: 'Identifier', name: token.value, line: token.line };
      }
      if (isOp('(')) {
        next();
        const expression = parseExpression(0);
        expectOp(')');
        return { type: 'Paren', expression, line: token.line };
      }
      return fail(`unexpected symbol near '${token.value}'`, token.line, token.column);
    }

    const stringNode = (token) => ({
      type: 'StringLiteral',
      raw: token.raw,
      value: token.value,
      quote: token.quote,
      long: token.long,
      line: token.line,
    });

    function parseCallArguments() {
      const token = peek();
      if (token.type === 'string') {
        next();
        return { kind: 'string', argument: stringNode(token) };
      }
      if (isOp('{')) {
        return { kind: 'table', argument: parseTable() };
      }
      expectOp('(');
      const args = [];
      if (!isOp(')')) {
        args.push(parseExpression(0));
        while (isOp(',')) { next(); args.push(parseExpression(0)); }
      }
      expectOp(')');
      return { kind: 'paren', args };
    }

    function parseSuffixedExpression() {
      let base = parsePrimaryExpression();
      for (;;) {
        if (isOp('.')) {
          next();
          base = { type: 'Member', base, name: expectName(), indexer: '.', line: base.line };
        } else if (isOp('[')) {
          next();
          const index = parseExpression(0);
          expectOp(']');
          base = { type: 'Index', base, index, line: base.line };
        } else if (isOp(':')) {
          next();
          const name = expectName();
          const callee = { type: 'Member', base, name, indexer: ':', line: base.line };
          base = { type: 'Call', base: callee, ...parseCallArguments(), line: base.line };
        } else if (isOp('(') || isOp('{') || peek().type === 'string') {
          base = { type: 'Call', base, ...parseCallArguments(), line: base.line };
        } else {
          return base;
        }
      }
    }

    function parseTable() {
      const open = expectOp('{');
      const fields = [];
      while (!isOp('}')) {
        if (isOp('[')) {
          next();
          const key = parseExpression(0);
          expectOp(']');
          expectOp('=');
          fields.push({ kind: 'index', key, value: parseExpression(0) });
        } else if (peek().type === 'name' && isOp('=', 1)) {
          const key = expectName();
          next();
          fields.push({ kind: 'name', key, value: parseExpression(0) });
        } else {
          fields.push({ kind: 'array', value: parseExpression(0) });
        }
        if (isOp(',') || isOp(';')) next();
        else break;
      }
      expectOp('}');
      return { type: 'Table', fields, line: open.line };
    }

    function parseFunctionBody(line) {
      expectOp('(');
      const params = [];
      let hasVararg = false;
      if (!isOp(')')) {
        for (;;) {
          if (isOp('...')) { next(); hasVararg = true; break; }
          params.push(expectName());
          if (!isOp(',')) break;
          next();
        }
      }
      expectOp(')');
      const body = parseBlock();
      const end = expectKeyword('end');
      return { params, hasVararg, body, line, endLine: end.line };
    }

    function parseSimpleExpression() {
      const token = peek();
      if (token.type === 'number') {
        next();
        return { type: 'NumericLiteral', value: token.value, line: token.line };
      }
      if (token.type === 'string') {
        next();
        return stringNode(token);
      }
      if (isKeyword('nil') || isKeyword('true') || isKeyword('false')) {
        next();
        return { type: 'Literal', value: token.value, line: token.line };
      }
      if (isOp('...')) {
        next();
        return { type: 'Vararg', line: token.line };
      }
      if (isOp('{')) return parseTable();
      if (isKeyword('function')) {
        next();
        return { type: 'FunctionExpression', ...parseFunctionBody(token.line) };
      }
      return parseSuffixedExpression();
    }

    function parseExpression(limit) {
      const token = peek();
      let left;

      const unary = (token.type === 'op' || token.type === 'keyword') && UNARY_OPERATORS.has(token.value);
      if (unary) {
        next();
        left = {
          type: 'Unary',
          operator: token.value,
          argument: parseExpression(UNARY_PREC),
          line: token.line,
        };
      } else {
        left = parseSimpleExpression();
      }

      for (;;) {
        const op = peek();
        const usable = op.type === 'op' || op.type === 'keyword';
        const prec = usable ? BINARY_PREC[op.value] : undefined;
        if (!prec || prec[0] <= limit) return left;
        next();
        const right = parseExpression(prec[1]);
        left = {
          type: 'Binary', operator: op.value, left, right, line: left.line,
        };
      }
    }

    function parseExpressionList() {
      const list = [parseExpression(0)];
      while (isOp(',')) { next(); list.push(parseExpression(0)); }
      return list;
    }

    // ---- statements -------------------------------------------------------

    function blockEnded() {
      const token = peek();
      if (token.type === 'eof') return true;
      return token.type === 'keyword' && BLOCK_ENDERS.has(token.value);
    }

    /**
     * `sameLine` is what makes the shorthand forms work: PICO-8's bracketed
     * `if`/`while` swallow statements only to the end of the physical line.
     */
    function parseBlock(sameLine) {
      const body = [];
      while (!blockEnded()) {
        if (sameLine != null && peek().line !== sameLine) break;
        if (isKeyword('return')) {
          body.push(parseReturn(sameLine));
          break;
        }
        const statement = parseStatement();
        if (statement) body.push(statement);
      }
      return body;
    }

    /**
     * A `return` closing a shorthand if ends with the line: in
     * `if (a) f() return` the return takes no values, even though the next line
     * starts with something that would otherwise parse as an expression.
     */
    function parseReturn(sameLine) {
      const token = expectKeyword('return');
      const endsHere = blockEnded()
        || isOp(';')
        || (sameLine != null && peek().line !== sameLine);
      const values = endsHere ? [] : parseExpressionList();
      if (isOp(';')) next();
      return { type: 'Return', values, line: token.line };
    }

    function parseIf() {
      const token = expectKeyword('if');
      const condition = parseExpression(0);

      // A bracketed condition is only shorthand when nothing else follows it.
      // `if (a or b) and c then` parses as a whole expression ending in `then`,
      // so it stays an ordinary if.
      if (condition.type === 'Paren' && !isKeyword('then')) {
        const body = parseBlock(token.line);
        if (!body.length) {
          fail('shorthand if needs a statement on the same line', token.line, token.column);
        }
        const clauses = [{ condition: condition.expression, body, line: token.line }];
        let alternate = null;
        if (isKeyword('else') && peek().line === token.line) {
          next();
          alternate = parseBlock(token.line);
        }
        return {
          type: 'If', clauses, alternate, shorthand: true, line: token.line, endLine: token.line,
        };
      }

      expectKeyword('then');
      const clauses = [{ condition, body: parseBlock(), line: token.line }];
      while (isKeyword('elseif')) {
        const elseifToken = next();
        const elseifCondition = parseExpression(0);
        expectKeyword('then');
        clauses.push({ condition: elseifCondition, body: parseBlock(), line: elseifToken.line });
      }
      let alternate = null;
      let elseLine = 0;
      if (isKeyword('else')) {
        elseLine = next().line;
        alternate = parseBlock();
      }
      const end = expectKeyword('end');
      return {
        type: 'If', clauses, alternate, elseLine, shorthand: false, line: token.line, endLine: end.line,
      };
    }

    function parseWhile() {
      const token = expectKeyword('while');
      const condition = parseExpression(0);

      if (condition.type === 'Paren' && !isKeyword('do')) {
        const body = parseBlock(token.line);
        if (!body.length) {
          fail('shorthand while needs a statement on the same line', token.line, token.column);
        }
        return {
          type: 'While',
          condition: condition.expression,
          body,
          shorthand: true,
          line: token.line,
          endLine: token.line,
        };
      }

      expectKeyword('do');
      const body = parseBlock();
      const end = expectKeyword('end');
      return {
        type: 'While', condition, body, shorthand: false, line: token.line, endLine: end.line,
      };
    }

    function parseDo() {
      const token = expectKeyword('do');
      const body = parseBlock();
      const end = expectKeyword('end');
      return { type: 'Do', body, line: token.line, endLine: end.line };
    }

    function parseRepeat() {
      const token = expectKeyword('repeat');
      const body = parseBlock();
      const until = expectKeyword('until');
      const condition = parseExpression(0);
      return {
        type: 'Repeat', body, condition, line: token.line, untilLine: until.line,
      };
    }

    function parseFor() {
      const token = expectKeyword('for');
      const first = expectName();
      if (isOp('=')) {
        next();
        const start = parseExpression(0);
        expectOp(',');
        const limit = parseExpression(0);
        let step = null;
        if (isOp(',')) { next(); step = parseExpression(0); }
        expectKeyword('do');
        const body = parseBlock();
        const end = expectKeyword('end');
        return {
          type: 'NumericFor',
          variable: first,
          start,
          limit,
          step,
          body,
          line: token.line,
          endLine: end.line,
        };
      }
      const names = [first];
      while (isOp(',')) { next(); names.push(expectName()); }
      expectKeyword('in');
      const iterators = parseExpressionList();
      expectKeyword('do');
      const body = parseBlock();
      const end = expectKeyword('end');
      return {
        type: 'GenericFor', names, iterators, body, line: token.line, endLine: end.line,
      };
    }

    function parseFunctionStatement() {
      const token = expectKeyword('function');
      let name = { type: 'Identifier', name: expectName(), line: token.line };
      let isMethod = false;
      while (isOp('.')) {
        next();
        name = {
          type: 'Member', base: name, name: expectName(), indexer: '.', line: token.line,
        };
      }
      if (isOp(':')) {
        next();
        name = {
          type: 'Member', base: name, name: expectName(), indexer: ':', line: token.line,
        };
        isMethod = true;
      }
      return {
        type: 'FunctionDeclaration',
        identifier: name,
        isLocal: false,
        isMethod,
        ...parseFunctionBody(token.line),
      };
    }

    function parseLocal() {
      const token = expectKeyword('local');
      if (isKeyword('function')) {
        next();
        const name = { type: 'Identifier', name: expectName(), line: token.line };
        return {
          type: 'FunctionDeclaration',
          identifier: name,
          isLocal: true,
          isMethod: false,
          ...parseFunctionBody(token.line),
        };
      }
      const names = [expectName()];
      while (isOp(',')) { next(); names.push(expectName()); }
      let values = [];
      if (isOp('=')) { next(); values = parseExpressionList(); }
      return {
        type: 'Local', names, values, line: token.line,
      };
    }

    function parsePrint() {
      const token = expectOp('?');
      const args = [];
      if (peek().line === token.line && peek().type !== 'eof' && !blockEnded()) {
        args.push(parseExpression(0));
        while (isOp(',')) { next(); args.push(parseExpression(0)); }
      }
      return {
        type: 'Call',
        base: { type: 'Identifier', name: 'print', line: token.line },
        kind: 'paren',
        args,
        line: token.line,
        statement: true,
      };
    }

    function parseExpressionStatement() {
      const start = peek();
      const first = parseSuffixedExpression();

      const token = peek();
      if (token.type === 'op' && COMPOUND_ASSIGN[token.value]) {
        next();
        const value = parseExpression(0);
        return {
          type: 'CompoundAssignment',
          target: first,
          operator: COMPOUND_ASSIGN[token.value],
          value,
          line: start.line,
        };
      }

      if (isOp(',') || isOp('=')) {
        const targets = [first];
        while (isOp(',')) { next(); targets.push(parseSuffixedExpression()); }
        expectOp('=');
        return {
          type: 'Assignment', targets, values: parseExpressionList(), line: start.line,
        };
      }

      if (first.type !== 'Call') {
        fail(`syntax error near '${token.value}'`, token.line, token.column);
      }
      return { ...first, statement: true };
    }

    function parseStatement() {
      const token = peek();

      if (token.type === 'include') {
        next();
        return { type: 'Include', file: token.value, line: token.line };
      }

      if (token.type === 'op') {
        if (token.value === ';') { next(); return null; }
        if (token.value === '::') {
          next();
          const name = expectName();
          expectOp('::');
          return { type: 'Label', name, line: token.line };
        }
        if (token.value === '?') return parsePrint();
      }

      if (token.type === 'keyword') {
        switch (token.value) {
          case 'if': return parseIf();
          case 'while': return parseWhile();
          case 'do': return parseDo();
          case 'for': return parseFor();
          case 'repeat': return parseRepeat();
          case 'function': return parseFunctionStatement();
          case 'local': return parseLocal();
          case 'return': return parseReturn();
          case 'break': next(); return { type: 'Break', line: token.line };          case 'goto': {
            next();
            return { type: 'Goto', label: expectName(), line: token.line };
          }
          default: break;
        }
      }

      return parseExpressionStatement();
    }

    const body = parseBlock();
    const last = peek();
    if (last.type !== 'eof') {
      fail(`unexpected symbol near '${last.value}'`, last.line, last.column);
    }
    return { type: 'Chunk', body, line: 1 };
  }

  // =========================================================================
  // Code generator
  // =========================================================================

  /**
   * Writes tokens at the line they came from. Anything that has to move (an
   * expanded shorthand `if`, say) simply lands on the line its opener was on.
   */
  class Writer {
    constructor() {
      this.out = '';
      this.line = 1;
      this.needSpace = false;
      this.suppress = false;
    }

    put(text, line, options) {
      if (text === '' || text == null) return;
      const opts = options || {};
      const target = Math.max(line || this.line, this.line);
      if (target > this.line) {
        this.out += '\n'.repeat(target - this.line);
        this.line = target;
      } else if (this.needSpace && !this.suppress && !opts.tight) {
        this.out += ' ';
      }
      this.out += text;
      // A long string carries its own newlines, so the cursor has to follow
      // them or everything after it drifts down the file.
      const breaks = text.length - text.replace(/\n/g, '').length;
      if (breaks) this.line += breaks;
      this.needSpace = true;
      this.suppress = Boolean(opts.open);
    }

    toString() {
      return this.out;
    }
  }

  function formatNumber(value, fixedPoint) {
    if (!fixedPoint) {
      if (Object.is(value, -0)) return '0';
      return String(value);
    }
    // Rounding then truncating to int32 is PICO-8's own conversion: it keeps
    // 1/65536 of precision and wraps at the ends of the range rather than
    // saturating or growing into a float.
    const raw = Math.round(value * 65536) | 0;
    if (raw >= 0) return String(raw);
    // A negative word cannot be written in decimal. Lua reads `-2147483648` as
    // unary minus applied to a literal that has already overflowed into a
    // float, which would put the number back in the representation this whole
    // lowering exists to get out of. A hex literal wraps into the integer type,
    // so it lands on the exact bit pattern instead.
    return `0x${(raw >>> 0).toString(16)}`;
  }

  /** Which runtime call an operator lowers to, if any, in this mode. */
  function binaryCallFor(operator, fixedPoint) {
    if (fixedPoint) return FIXED_BINARY_TO_CALL[operator] || null;
    return BINARY_TO_CALL[operator] || null;
  }

  function unaryCallFor(operator, fixedPoint) {
    if (!fixedPoint) return UNARY_TO_CALL[operator] || null;
    // ~ is exact as a native Lua operator on the raw word.
    if (operator === '~') return null;
    // # yields a count, not a number the cart can compute with.
    if (operator === '#') return '__p8len';
    return UNARY_TO_CALL[operator] || null;
  }

  /**
   * Long strings have no escapes at all, so they are emitted verbatim. Short
   * strings are rebuilt from the decoded text because the original spelling may
   * contain PICO-8 escapes that Lua 5.2 refuses to compile.
   *
   * A long string holding PICO-8 characters cannot be emitted verbatim either -
   * its raw spelling is still the UTF-8 glyph - so it is rebuilt as a quoted
   * string, which decodes to exactly the same bytes.
   */
  function formatString(node) {
    if (node.long && !/[^\x00-\x7e]/.test(node.value)) return node.raw;
    const quote = node.quote === "'" ? "'" : '"';
    let out = quote;
    for (let i = 0; i < node.value.length; i += 1) {
      const ch = node.value[i];
      const code = node.value.charCodeAt(i);
      if (ch === quote || ch === '\\') out += `\\${ch}`;
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      // Always three digits, so a following digit cannot extend the escape.
      // Everything from 0x7f up is escaped too, keeping the output plain ASCII
      // rather than leaving bytes that Lua would have to read as UTF-8.
      else if (code < 32 || code >= 127) out += `\\${String(code).padStart(3, '0')}`;
      else out += ch;
    }
    return out + quote;
  }

  function precedenceOf(node, fixedPoint) {
    if (node.type === 'Binary') {
      if (binaryCallFor(node.operator, fixedPoint)) return ATOMIC_PREC;
      if (node.operator === INTEGER_DIVIDE) return ATOMIC_PREC;
      return BINARY_PREC[node.operator] || ATOMIC_PREC;
    }
    if (node.type === 'Unary') {
      if (unaryCallFor(node.operator, fixedPoint)) return ATOMIC_PREC;
      return [UNARY_PREC, UNARY_PREC];
    }
    return ATOMIC_PREC;
  }

  /** True when the target can safely be written out twice. */
  function isPureTarget(node) {
    switch (node.type) {
      case 'Identifier':
        return true;
      case 'Member':
        return isPureTarget(node.base);
      case 'Index':
        return isPureTarget(node.base)
          && ['Identifier', 'NumericLiteral', 'StringLiteral', 'Literal'].includes(node.index.type);
      default:
        return false;
    }
  }

  function generate(ast, options) {
    const fixedPoint = Boolean(options && options.fixedPoint);
    const writer = new Writer();

    const precOf = (node) => precedenceOf(node, fixedPoint);

    /**
     * A subscript has to end up an ordinary Lua key rather than a raw word, or
     * the table stops looking like a sequence and #, add(), all(), ipairs() and
     * unpack() all quietly change meaning. A literal is converted here for
     * nothing, which covers most of the indexing a cart does; anything else has
     * to be worked out while it runs.
     */
    function genIndexKey(node) {
      if (!fixedPoint) {
        genExpression(node);
        return;
      }
      if (node.type === 'NumericLiteral') {
        writer.put(formatNumber(node.value, false), node.line);
        return;
      }
      // A string or a boolean is already the key it looks like.
      if (node.type === 'StringLiteral' || node.type === 'Literal') {
        genExpression(node);
        return;
      }
      writer.put('__p8key', node.line);
      writer.put('(', writer.line, { tight: true, open: true });
      genExpression(node);
      writer.put(')', writer.line, { tight: true });
    }

    function genExpression(node, line) {
      const at = line || node.line;
      switch (node.type) {
        case 'Identifier':
          writer.put(sanitizeName(node.name), at);
          break;
        case 'NumericLiteral':
          writer.put(formatNumber(node.value, fixedPoint), at);
          break;
        case 'StringLiteral':
          writer.put(formatString(node), at);
          break;
        case 'Literal':
          writer.put(node.value, at);
          break;
        case 'Vararg':
          writer.put('...', at);
          break;
        case 'Paren':
          writer.put('(', at, { open: true });
          genExpression(node.expression);
          writer.put(')', writer.line, { tight: true });
          break;
        case 'Member':
          genExpression(node.base, at);
          if (node.indexer === '.' && HAS_GLYPH.test(node.name)) {
            // A field name has to stay the key the cart wrote, so `t.\u25a4` and
            // `t["\u25a4"]` still reach the same entry. Sanitizing would break that,
            // so index by the PICO-8 string instead.
            writer.put('[', writer.line, { tight: true, open: true });
            writer.put(formatString({ value: toP8Scii(node.name), quote: '"' }), writer.line);
            writer.put(']', writer.line, { tight: true });
            break;
          }
          writer.put(node.indexer, writer.line, { tight: true, open: true });
          writer.put(node.name, writer.line);
          break;
        case 'Index':
          genExpression(node.base, at);
          writer.put('[', writer.line, { tight: true, open: true });
          genIndexKey(node.index);
          writer.put(']', writer.line, { tight: true });
          break;
        case 'Call':
          genCall(node, at);
          break;
        case 'Table':
          genTable(node, at, false);
          break;
        case 'FunctionExpression':
          writer.put('function', at, { open: true });
          genFunctionRest(node);
          break;
        case 'Unary':
          genUnary(node, at);
          break;
        case 'Binary':
          genBinary(node, at);
          break;
        default:
          throw new Error(`pico8: cannot generate ${node.type}`);
      }
    }

    function genCallArgs(node) {
      if (node.kind === 'string') {
        writer.put(formatString(node.argument), writer.line, { tight: true });
        return;
      }
      if (node.kind === 'table') {
        genTable(node.argument, writer.line, true);
        return;
      }
      writer.put('(', writer.line, { tight: true, open: true });
      node.args.forEach((arg, i) => {
        if (i > 0) writer.put(',', writer.line, { tight: true });
        genExpression(arg);
      });
      writer.put(')', writer.line, { tight: true });
    }

    function genCall(node, at) {
      genExpression(node.base, at);
      genCallArgs(node);
    }

    function genTable(node, at, tight) {
      writer.put('{', at, { tight: Boolean(tight), open: true });
      node.fields.forEach((field, i) => {
        if (i > 0) writer.put(',', writer.line, { tight: true });
        if (field.kind === 'index') {
          writer.put('[', field.value.line, { open: true });
          genIndexKey(field.key);
          writer.put(']', writer.line, { tight: true });
          writer.put('=', writer.line);
        } else if (field.kind === 'name') {
          if (HAS_GLYPH.test(field.key)) {
            // Same reasoning as Member: keep the cart's own key.
            writer.put('[', field.value.line, { open: true });
            writer.put(formatString({ value: toP8Scii(field.key), quote: '"' }), writer.line);
            writer.put(']', writer.line, { tight: true });
          } else {
            writer.put(field.key, field.value.line);
          }
          writer.put('=', writer.line);
        }
        genExpression(field.value);
      });
      writer.put('}', writer.line, { tight: true });
    }

    function genFunctionRest(node) {
      writer.put('(', writer.line, { tight: true, open: true });
      node.params.forEach((param, i) => {
        if (i > 0) writer.put(',', writer.line, { tight: true });
        writer.put(sanitizeName(param), writer.line);
      });
      if (node.hasVararg) {
        if (node.params.length) writer.put(',', writer.line, { tight: true });
        writer.put('...', writer.line);
      }
      writer.put(')', writer.line, { tight: true });
      genBlock(node.body);
      writer.put('end', node.endLine);
    }

    function genUnary(node, at) {
      const call = unaryCallFor(node.operator, fixedPoint);
      if (call) {
        writer.put(call, at);
        writer.put('(', writer.line, { tight: true, open: true });
        genExpression(node.argument);
        writer.put(')', writer.line, { tight: true });
        return;
      }
      // `not` is a word, so it needs the space that `-` and `#` must not have.
      writer.put(node.operator, at, { open: node.operator !== 'not' });
      const needsParens = precOf(node.argument)[1] < UNARY_PREC;
      if (needsParens) writer.put('(', writer.line, { tight: true, open: true });
      genExpression(node.argument);
      if (needsParens) writer.put(')', writer.line, { tight: true });
    }

    function genBinary(node, at) {
      const call = binaryCallFor(node.operator, fixedPoint);
      if (call || node.operator === INTEGER_DIVIDE) {
        writer.put(call || 'flr', at);
        writer.put('(', writer.line, { tight: true, open: true });
        genExpression(node.left);
        writer.put(call ? ',' : '/', writer.line, { tight: Boolean(call) });
        genExpression(node.right);
        writer.put(')', writer.line, { tight: true });
        return;
      }

      const prec = BINARY_PREC[node.operator];
      const leftParens = precOf(node.left)[1] < prec[0];
      if (leftParens) writer.put('(', at, { open: true });
      genExpression(node.left, leftParens ? writer.line : at);
      if (leftParens) writer.put(')', writer.line, { tight: true });

      writer.put((fixedPoint && FIXED_BINARY_NATIVE[node.operator]) || node.operator, writer.line);

      const rightParens = precOf(node.right)[0] <= prec[1];
      if (rightParens) writer.put('(', writer.line, { open: true });
      genExpression(node.right);
      if (rightParens) writer.put(')', writer.line, { tight: true });
    }

    function genTargetList(targets) {
      targets.forEach((target, i) => {
        if (i > 0) writer.put(',', writer.line, { tight: true });
        genExpression(target);
      });
    }

    function genExpressionList(values) {
      values.forEach((value, i) => {
        if (i > 0) writer.put(',', writer.line, { tight: true });
        genExpression(value);
      });
    }

    /**
     * `a[f()] += 1` must not call f twice, so an impure target is hoisted into
     * a do-block first. Simple names and constant keys are rewritten in place.
     */
    function genCompoundAssignment(node) {
      const at = node.line;
      if (isPureTarget(node.target)) {
        genExpression(node.target, at);
        writer.put('=', writer.line);
        genBinary({
          type: 'Binary', operator: node.operator, left: node.target, right: node.value, line: at,
        }, writer.line);
        return;
      }

      const object = { type: 'Identifier', name: '__p8_obj', line: at };
      writer.put('do', at);
      writer.put('local', writer.line);
      writer.put('__p8_obj', writer.line);

      let slot;
      if (node.target.type === 'Index') {
        writer.put(',', writer.line, { tight: true });
        writer.put('__p8_key', writer.line);
        writer.put('=', writer.line);
        genExpression(node.target.base);
        writer.put(',', writer.line, { tight: true });
        genExpression(node.target.index);
        slot = {
          type: 'Index', base: object, index: { type: 'Identifier', name: '__p8_key', line: at }, line: at,
        };
      } else {
        writer.put('=', writer.line);
        genExpression(node.target.base);
        slot = {
          type: 'Member', base: object, name: node.target.name, indexer: '.', line: at,
        };
      }

      genExpression(slot, writer.line);
      writer.put('=', writer.line);
      genBinary({
        type: 'Binary', operator: node.operator, left: slot, right: node.value, line: writer.line,
      }, writer.line);
      writer.put('end', writer.line);
    }

    function genStatement(node) {
      const at = node.line;
      switch (node.type) {
        case 'Local':
          writer.put('local', at);
          node.names.forEach((name, i) => {
            if (i > 0) writer.put(',', writer.line, { tight: true });
            writer.put(sanitizeName(name), writer.line);
          });
          if (node.values.length) {
            writer.put('=', writer.line);
            genExpressionList(node.values);
          }
          break;

        case 'Assignment':
          genTargetList(node.targets);
          writer.put('=', writer.line);
          genExpressionList(node.values);
          break;

        case 'CompoundAssignment':
          genCompoundAssignment(node);
          break;

        case 'Call':
          genCall(node, at);
          break;

        case 'Return':
          writer.put('return', at);
          if (node.values.length) genExpressionList(node.values);
          break;

        case 'Break':
          writer.put('break', at);
          break;

        case 'Goto':
          writer.put('goto', at);
          writer.put(node.label, writer.line);
          break;

        case 'Label':
          writer.put(`::${node.name}::`, at);
          break;

        case 'Include':
          fail(
            `unresolved #include '${node.file}': includes must be expanded before compiling`,
            node.line,
            1,
          );
          break;

        case 'Do':
          writer.put('do', at);
          genBlock(node.body);
          writer.put('end', node.endLine);
          break;

        case 'If':
          node.clauses.forEach((clause, i) => {
            writer.put(i === 0 ? 'if' : 'elseif', clause.line);
            genExpression(clause.condition);
            writer.put('then', writer.line);
            genBlock(clause.body);
          });
          if (node.alternate) {
            writer.put('else', node.shorthand ? writer.line : (node.elseLine || writer.line));
            genBlock(node.alternate);
          }
          writer.put('end', node.endLine);
          break;

        case 'While':
          writer.put('while', at);
          genExpression(node.condition);
          writer.put('do', writer.line);
          genBlock(node.body);
          writer.put('end', node.endLine);
          break;

        case 'Repeat':
          writer.put('repeat', at);
          genBlock(node.body);
          writer.put('until', node.untilLine);
          genExpression(node.condition);
          break;

        case 'NumericFor':
          writer.put('for', at);
          writer.put(sanitizeName(node.variable), writer.line);
          writer.put('=', writer.line);
          genExpression(node.start);
          writer.put(',', writer.line, { tight: true });
          genExpression(node.limit);
          if (node.step) {
            writer.put(',', writer.line, { tight: true });
            genExpression(node.step);
          } else if (fixedPoint) {
            // The control variable counts in raw words, so the implied step of
            // one has to be spelled out as one whole unit rather than 1/65536.
            writer.put(',', writer.line, { tight: true });
            writer.put('0x10000', writer.line);
          }
          writer.put('do', writer.line);
          genBlock(node.body);
          writer.put('end', node.endLine);
          break;

        case 'GenericFor':
          writer.put('for', at);
          node.names.forEach((name, i) => {
            if (i > 0) writer.put(',', writer.line, { tight: true });
            writer.put(sanitizeName(name), writer.line);
          });
          writer.put('in', writer.line);
          genExpressionList(node.iterators);
          writer.put('do', writer.line);
          genBlock(node.body);
          writer.put('end', node.endLine);
          break;

        case 'FunctionDeclaration':
          if (node.isLocal) writer.put('local', at);
          writer.put('function', at, { open: false });
          genExpression(node.identifier, writer.line);
          genFunctionRest(node);
          break;

        default:
          throw new Error(`pico8: cannot generate ${node.type}`);
      }
    }

    function genBlock(body) {
      body.forEach((statement) => genStatement(statement));
    }

    genBlock(ast.body);
    return writer.toString();
  }

  /**
   * Whether a cart is lowered onto raw 16.16 words rather than float32
   * lua_Numbers. This is baked into the stored Lua when a cart is imported, so
   * it is the compile half of the representation; the runtime half is
   * FIXED_POINT in pico8.js, which reads those words back at the API boundary.
   * THE TWO MUST BE FLIPPED TOGETHER.
   */
  const FIXED_POINT = true;

  function compile(source, options) {
    const fixedPoint = options && options.fixedPoint !== undefined
      ? options.fixedPoint
      : FIXED_POINT;
    return generate(parse(source), { fixedPoint });
  }

  return {
    tokenize, parse, generate, compile, FIXED_POINT,
  };
}));
