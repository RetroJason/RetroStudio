/**
 * Tests for the PICO-8 dialect parser.
 *
 * The parser reads PICO-8's extended Lua and emits stock Lua, which is what
 * lua.vm.js actually understands. Operator precedence follows Lua 5.3, which is
 * where PICO-8 took its bitwise operators from.
 *
 * Run: node --test scripts/lua/pico8-parser.test.js
 */

const test = require('node:test');
const assert = require('node:assert');

const { tokenize, parse, compile } = require('./pico8-parser.js');

/** Collapse whitespace so tests assert on structure, not layout. */
const norm = (source) => String(source).replace(/\s+/g, ' ').trim();

/**
 * Compile and normalise in one step.
 *
 * Explicitly unlowered. Carts are now compiled onto raw 16.16 words by
 * default, but that is a separate lowering on top of this one, and these tests
 * are about the dialect itself: what PICO-8 spellings mean and how precedence
 * comes out. Group N at the bottom covers the fixed point lowering.
 */
const c = (source) => norm(compile(source, { fixedPoint: false }));

/** Token types/values only; positions are asserted separately. */
const kinds = (source) => tokenize(source)
  .filter((t) => t.type !== 'eof')
  .map((t) => `${t.type}:${t.value}`);

const countOf = (haystack, needle) => haystack.split(needle).length - 1;

// ===========================================================================
// Group A - lexer-level token spellings
// ===========================================================================

test('lexer: != normalises to ~=', () => {
  assert.deepStrictEqual(kinds('a != b'), ['name:a', 'op:~=', 'name:b']);
  assert.strictEqual(c('x = a != b'), 'x = a ~= b');
});

test('lexer: ~= still works', () => {
  assert.strictEqual(c('x = a ~= b'), 'x = a ~= b');
});

test('lexer: binary integer literals', () => {
  assert.deepStrictEqual(kinds('0b1010'), ['number:10']);
  assert.deepStrictEqual(kinds('0B1100'), ['number:12']);
  assert.strictEqual(c('x = 0b0011001111001100'), 'x = 13260');
});

test('lexer: binary literals with a fractional part', () => {
  assert.deepStrictEqual(kinds('0b0.1'), ['number:0.5']);
  assert.deepStrictEqual(kinds('0b1.11'), ['number:1.75']);
});

test('lexer: hex literals with a fractional part are stock Lua and survive', () => {
  assert.strictEqual(c('x = 0x11.4'), 'x = 17.25');
});

test('lexer: decimal literals are untouched', () => {
  assert.deepStrictEqual(kinds('1 2.5 .5 1e3 0xff'), [
    'number:1', 'number:2.5', 'number:0.5', 'number:1000', 'number:255',
  ]);
});

test('lexer: compound assignment operators are single tokens', () => {
  const ops = ['+=', '-=', '*=', '/=', '%=', '^=', '..=', '\\=',
    '&=', '|=', '^^=', '<<=', '>>=', '>>>=', '<<>=', '>><='];
  for (const op of ops) {
    assert.deepStrictEqual(kinds(`a ${op} b`), ['name:a', `op:${op}`, 'name:b'], op);
  }
});

test('lexer: bitwise operators are single tokens', () => {
  const ops = ['&', '|', '^^', '~', '<<', '>>', '>>>', '<<>', '>><'];
  for (const op of ops) {
    assert.deepStrictEqual(kinds(`a ${op} b`), ['name:a', `op:${op}`, 'name:b'], op);
  }
});

test('lexer: longest-match wins between overlapping operators', () => {
  assert.deepStrictEqual(kinds('a >>>= b'), ['name:a', 'op:>>>=', 'name:b']);
  assert.deepStrictEqual(kinds('a >>> b'), ['name:a', 'op:>>>', 'name:b']);
  assert.deepStrictEqual(kinds('a >>= b'), ['name:a', 'op:>>=', 'name:b']);
  assert.deepStrictEqual(kinds('a >> b'), ['name:a', 'op:>>', 'name:b']);
  assert.deepStrictEqual(kinds('a >< b'), ['name:a', 'op:>', 'op:<', 'name:b']);
});

test('lexer: strings and comments are never scanned for operators', () => {
  assert.deepStrictEqual(kinds('x = "a += b != c"'), ['name:x', 'op:=', 'string:a += b != c']);
  assert.deepStrictEqual(kinds('-- a += b\nx = 1'), ['name:x', 'op:=', 'number:1']);
  assert.deepStrictEqual(kinds('--[[ a += b ]] x = 1'), ['name:x', 'op:=', 'number:1']);
  assert.deepStrictEqual(kinds('x = [[a += b]]'), ['name:x', 'op:=', 'string:a += b']);
  assert.deepStrictEqual(kinds('x = [==[a ]] b]==]'), ['name:x', 'op:=', 'string:a ]] b']);
});

test('lexer: tracks line and column', () => {
  const tokens = tokenize('x = 1\ny = 2');
  assert.strictEqual(tokens[0].line, 1);
  assert.strictEqual(tokens[0].column, 1);
  const y = tokens.find((t) => t.value === 'y');
  assert.strictEqual(y.line, 2);
  assert.strictEqual(y.column, 1);
});

test('lexer: keywords are distinguished from names', () => {
  assert.deepStrictEqual(kinds('local endx'), ['keyword:local', 'name:endx']);
  assert.deepStrictEqual(kinds('if then end'), ['keyword:if', 'keyword:then', 'keyword:end']);
});

// ===========================================================================
// Group B - bitwise operators, Lua 5.3 precedence
// ===========================================================================

test('precedence: & binds tighter than |', () => {
  assert.strictEqual(c('x = a | b & cc'), 'x = bor(a, band(b, cc))');
});

test('precedence: ^^ sits between | and &', () => {
  assert.strictEqual(c('x = a | b ^^ cc'), 'x = bor(a, bxor(b, cc))');
  assert.strictEqual(c('x = a ^^ b & cc'), 'x = bxor(a, band(b, cc))');
});

test('precedence: shifts bind tighter than &', () => {
  assert.strictEqual(c('x = a & b << cc'), 'x = band(a, shl(b, cc))');
});

test('precedence: arithmetic binds tighter than shifts', () => {
  assert.strictEqual(c('x = a + b << cc'), 'x = shl(a + b, cc)');
});

test('precedence: concat binds tighter than shifts', () => {
  assert.strictEqual(c('x = a .. b << cc'), 'x = shl(a .. b, cc)');
});

test('precedence: | binds tighter than comparison', () => {
  assert.strictEqual(c('x = a < b | cc'), 'x = a < bor(b, cc)');
});

test('precedence: comparison binds tighter than and/or', () => {
  assert.strictEqual(c('x = a and b < cc'), 'x = a and b < cc');
  assert.strictEqual(c('x = a or b and cc'), 'x = a or b and cc');
});

test('precedence: unary ~ binds tighter than binary operators', () => {
  assert.strictEqual(c('x = ~a & b'), 'x = band(bnot(a), b)');
});

test('precedence: ^ binds tighter than a unary operator', () => {
  // Lowering ~ to a call makes the grouping visible: if ^ bound loosest we
  // would get bnot(a) ^ b instead.
  assert.strictEqual(c('x = ~a ^ b'), 'x = bnot(a ^ b)');
  assert.strictEqual(c('x = ~(a) ^ b'), 'x = bnot((a) ^ b)');
});

test('precedence: ^ is right associative', () => {
  assert.strictEqual(c('x = a ^ b ^ cc'), 'x = a ^ b ^ cc');
  assert.strictEqual(c('x = (a ^ b) ^ cc'), 'x = (a ^ b) ^ cc');
});

test('precedence: .. is right associative', () => {
  assert.strictEqual(c('x = a .. b .. cc'), 'x = a .. b .. cc');
});

test('precedence: shifts are left associative', () => {
  assert.strictEqual(c('x = a << b << cc'), 'x = shl(shl(a, b), cc)');
});

test('bitwise: every operator maps to its runtime function', () => {
  assert.strictEqual(c('x = a & b'), 'x = band(a, b)');
  assert.strictEqual(c('x = a | b'), 'x = bor(a, b)');
  assert.strictEqual(c('x = a ^^ b'), 'x = bxor(a, b)');
  assert.strictEqual(c('x = ~a'), 'x = bnot(a)');
  assert.strictEqual(c('x = a << b'), 'x = shl(a, b)');
  assert.strictEqual(c('x = a >> b'), 'x = shr(a, b)');
  assert.strictEqual(c('x = a >>> b'), 'x = lshr(a, b)');
  assert.strictEqual(c('x = a <<> b'), 'x = rotl(a, b)');
  assert.strictEqual(c('x = a >>< b'), 'x = rotr(a, b)');
});

test('integer division \\ lowers to flr and shares * precedence', () => {
  assert.strictEqual(c('x = 9 \\ 2'), 'x = flr(9 / 2)');
  assert.strictEqual(c('x = a \\ b * cc'), 'x = flr(a / b) * cc');
  assert.strictEqual(c('x = a + b \\ cc'), 'x = a + flr(b / cc)');
});

test('peek operators are unary and lower to peek/peek2/peek4', () => {
  assert.strictEqual(c('x = @a'), 'x = peek(a)');
  assert.strictEqual(c('x = %a'), 'x = peek2(a)');
  assert.strictEqual(c('x = $a'), 'x = peek4(a)');
  assert.strictEqual(c('x = @0x5f00'), 'x = peek(24320)');
});

test('% is modulo in infix position and peek2 in prefix position', () => {
  assert.strictEqual(c('x = a % b'), 'x = a % b');
  assert.strictEqual(c('x = a % %b'), 'x = a % peek2(b)');
  assert.strictEqual(c('x = %a % b'), 'x = peek2(a) % b');
});

test('peek binds like other unary operators', () => {
  assert.strictEqual(c('x = @a + b'), 'x = peek(a) + b');
  assert.strictEqual(c('x = @(a + b)'), 'x = peek((a + b))');
});

// ===========================================================================
// Group B - statement forms
// ===========================================================================

test('shorthand if expands to a full if', () => {
  assert.strictEqual(c('if (a) x=1'), 'if a then x = 1 end');
});

test('shorthand if takes every statement to end of line', () => {
  assert.strictEqual(c('if (a) x=1 y=2'), 'if a then x = 1 y = 2 end');
});

test('shorthand if stops at end of line', () => {
  assert.strictEqual(c('if (a) x=1\ny=2'), 'if a then x = 1 end y = 2');
});

test('shorthand if supports a single-line else', () => {
  assert.strictEqual(c('if (a) x=1 else x=2'), 'if a then x = 1 else x = 2 end');
});

test('shorthand if nests', () => {
  assert.strictEqual(c('if (a) if (b) x=1'), 'if a then if b then x = 1 end end');
});

test('shorthand if works with no space after the bracket', () => {
  assert.strictEqual(c('if(a)x=1'), 'if a then x = 1 end');
  assert.strictEqual(c('if(songstrt and curmap.ss)music(curmap.ss)'),
    'if songstrt and curmap.ss then music(curmap.ss) end');
  assert.strictEqual(c('if (palnum>6)palnum=1'), 'if palnum > 6 then palnum = 1 end');
});

test('a parenthesised condition followed by more expression is NOT shorthand', () => {
  assert.strictEqual(c('if (a or b) and cc then x=1 end'),
    'if (a or b) and cc then x = 1 end');
  assert.strictEqual(c('if (btnp(5) or stat(34)==2) and cutscene.override then x=1 end'),
    'if (btnp(5) or stat(34) == 2) and cutscene.override then x = 1 end');
});

test('a fully bracketed condition followed by then is a normal if', () => {
  assert.strictEqual(c('if (a) then x=1 end'), 'if (a) then x = 1 end');
});

test('multi-line if/elseif/else is untouched', () => {
  assert.strictEqual(
    c('if a then\nx=1\nelseif b then\nx=2\nelse\nx=3\nend'),
    'if a then x = 1 elseif b then x = 2 else x = 3 end',
  );
});

test('shorthand while expands to a full while', () => {
  assert.strictEqual(c('while (a) x=1'), 'while a do x = 1 end');
  assert.strictEqual(c('while (a) x=1 y=2'), 'while a do x = 1 y = 2 end');
});

test('normal while is untouched', () => {
  assert.strictEqual(c('while (a) do x=1 end'), 'while (a) do x = 1 end');
  assert.strictEqual(c('while a < b do x=1 end'), 'while a < b do x = 1 end');
});

test('? is print shorthand', () => {
  assert.strictEqual(c('?"hi"'), 'print("hi")');
  assert.strictEqual(c('? x'), 'print(x)');
  assert.strictEqual(c('?x, y, 3'), 'print(x, y, 3)');
});

test('? runs to end of line only', () => {
  assert.strictEqual(c('?x\ny=1'), 'print(x) y = 1');
});

// ===========================================================================
// Group B - compound assignment
// ===========================================================================

test('arithmetic compound assignment', () => {
  assert.strictEqual(c('x += 1'), 'x = x + 1');
  assert.strictEqual(c('x -= 1'), 'x = x - 1');
  assert.strictEqual(c('x *= 2'), 'x = x * 2');
  assert.strictEqual(c('x /= 2'), 'x = x / 2');
  assert.strictEqual(c('x %= 2'), 'x = x % 2');
  assert.strictEqual(c('x ^= 2'), 'x = x ^ 2');
  assert.strictEqual(c('x \\= 2'), 'x = flr(x / 2)');
});

test('concat compound assignment', () => {
  assert.strictEqual(c('x ..= "a"'), 'x = x .. "a"');
});

test('bitwise compound assignment', () => {
  assert.strictEqual(c('x &= 3'), 'x = band(x, 3)');
  assert.strictEqual(c('x |= 3'), 'x = bor(x, 3)');
  assert.strictEqual(c('x ^^= 3'), 'x = bxor(x, 3)');
  assert.strictEqual(c('x <<= 3'), 'x = shl(x, 3)');
  assert.strictEqual(c('x >>= 3'), 'x = shr(x, 3)');
  assert.strictEqual(c('x >>>= 3'), 'x = lshr(x, 3)');
  assert.strictEqual(c('x <<>= 3'), 'x = rotl(x, 3)');
  assert.strictEqual(c('x >><= 3'), 'x = rotr(x, 3)');
});

test('compound assignment brackets the right hand side', () => {
  // The right hand side is always bracketed when it is a lower- or
  // equal-precedence binary expression. Dropping the brackets for + would mean
  // assuming addition is associative, which is not safe.
  assert.strictEqual(c('x -= a - b'), 'x = x - (a - b)');
  assert.strictEqual(c('x += a + b'), 'x = x + (a + b)');
  assert.strictEqual(c('x *= a + b'), 'x = x * (a + b)');
  assert.strictEqual(c('x += a and b'), 'x = x + (a and b)');
  assert.strictEqual(c('x += a * b'), 'x = x + a * b');
});

test('compound assignment on a field target', () => {
  assert.strictEqual(c('a.b += 1'), 'a.b = a.b + 1');
  assert.strictEqual(c('a.b.cc += 1'), 'a.b.cc = a.b.cc + 1');
});

test('compound assignment on a constant index target', () => {
  assert.strictEqual(c('a[1] += 1'), 'a[1] = a[1] + 1');
  assert.strictEqual(c('a[i] += 1'), 'a[i] = a[i] + 1');
  assert.strictEqual(c('a["k"] += 1'), 'a["k"] = a["k"] + 1');
});

test('compound assignment never evaluates a side-effecting target twice', () => {
  const out = compile('a[f()] += 1');
  assert.strictEqual(countOf(out, 'f()'), 1, out);
  assert.match(norm(out), /^do local .* end$/, out);

  const call = compile('get().x += 1');
  assert.strictEqual(countOf(call, 'get()'), 1, call);
});

test('compound assignment respects the whole rest of the expression', () => {
  assert.strictEqual(c('x += a * b + cc'), 'x = x + (a * b + cc)');
});

// ===========================================================================
// Statement boundaries - the cases regex rewriting got wrong
// ===========================================================================

test('run-together compound assignments on one line', () => {
  assert.strictEqual(c('ci.x+=fq ci.y+=fr yield()'),
    'ci.x = ci.x + fq ci.y = ci.y + fr yield()');
});

test('compound assignment terminated by a block keyword', () => {
  assert.strictEqual(c('for i=1,10 do x+=i end'), 'for i = 1, 10 do x = x + i end');
  assert.strictEqual(c('while a do x+=1 end'), 'while a do x = x + 1 end');
  assert.strictEqual(c('if a then x+=1 end'), 'if a then x = x + 1 end');
  assert.strictEqual(c('repeat x+=1 until x>3'), 'repeat x = x + 1 until x > 3');
  assert.strictEqual(c('function f() x+=1 end'), 'function f() x = x + 1 end');
});

test('compound assignment followed by return', () => {
  assert.strictEqual(c('function f() x+=1 return x end'),
    'function f() x = x + 1 return x end');
});

test('shorthand if whose body assigns to a field', () => {
  assert.strictEqual(c('if (btn(0,0)) then wind_x-=w windy.using_force = true end'),
    'if (btn(0, 0)) then wind_x = wind_x - w windy.using_force = true end');
});

test('shorthand if with a trailing comment', () => {
  assert.strictEqual(c('if (a) x=1 -- note'), 'if a then x = 1 end');
});

test('compound assignment inside a shorthand if', () => {
  assert.strictEqual(c('if (a) x+=1 y-=2'), 'if a then x = x + 1 y = y - 2 end');
});

test('a bare return closing a shorthand if stops at the line', () => {
  assert.strictEqual(c('if (a) f() return\nif (b) g()'),
    'if a then f() return end if b then g() end');
  assert.strictEqual(c('if (a) return\nx = 1'), 'if a then return end x = 1');
});

test('a shorthand if can still return a value', () => {
  assert.strictEqual(c('if (a) return 1\nx = 2'), 'if a then return 1 end x = 2');
  assert.strictEqual(c('if (a) return b, cc\nx = 2'), 'if a then return b, cc end x = 2');
});

test('a normal return may span lines', () => {
  assert.strictEqual(c('function f()\nreturn\n1\nend'), 'function f() return 1 end');
});

// ===========================================================================
// #include is a cart directive, not Lua
// ===========================================================================

test('#include is captured rather than parsed as a length operator', () => {
  assert.deepStrictEqual(kinds('#include platformer.lua'), ['include:platformer.lua']);
  assert.deepStrictEqual(kinds('#include onetab.p8:1'), ['include:onetab.p8:1']);
});

test('#include is exposed on the tree so the importer can resolve it', () => {
  const chunk = parse('#include a.lua\nx = 1');
  assert.strictEqual(chunk.body[0].type, 'Include');
  assert.strictEqual(chunk.body[0].file, 'a.lua');
  assert.strictEqual(chunk.body[1].type, 'Assignment');
});

test('compiling an unresolved #include is a clear error', () => {
  assert.throws(() => compile('#include a.lua'), (err) => {
    assert.match(err.message, /unresolved #include 'a\.lua'/);
    assert.strictEqual(err.line, 1);
    return true;
  });
});

test('# is still the length operator everywhere else', () => {
  assert.strictEqual(c('x = #t'), 'x = #t');
  assert.strictEqual(c('x = 1 -- #include a.lua'), 'x = 1');
});

// ===========================================================================
// Stock Lua must survive untouched
// ===========================================================================

test('plain Lua statements round-trip', () => {
  assert.strictEqual(c('local a, b = 1, 2'), 'local a, b = 1, 2');
  assert.strictEqual(c('local function f(a, ...) return a end'),
    'local function f(a, ...) return a end');
  assert.strictEqual(c('function t.a.b:m(x) return self end'),
    'function t.a.b:m(x) return self end');
  assert.strictEqual(c('for k, v in pairs(t) do print(k) end'),
    'for k, v in pairs(t) do print(k) end');
  assert.strictEqual(c('for i = 10, 1, -1 do end'), 'for i = 10, 1, -1 do end');
  assert.strictEqual(c('t = {1, 2, x = 3, ["y"] = 4, [1+1] = 5}'),
    't = {1, 2, x = 3, ["y"] = 4, [1 + 1] = 5}');
  assert.strictEqual(c('do local x = 1 end'), 'do local x = 1 end');
  assert.strictEqual(c('a, b = b, a'), 'a, b = b, a');
  assert.strictEqual(c('f{1}'), 'f{1}');
  assert.strictEqual(c('f"s"'), 'f"s"');
  assert.strictEqual(c('o:m(1)'), 'o:m(1)');
  assert.strictEqual(c('return'), 'return');
  assert.strictEqual(c('while true do break end'), 'while true do break end');
});

test('goto and labels are stock Lua features and survive', () => {
  assert.strictEqual(c('::top:: goto top'), '::top:: goto top');
});

test('semicolons are accepted', () => {
  assert.strictEqual(c('x = 1; y = 2;'), 'x = 1 y = 2');
});

test('compiling stock Lua is idempotent', () => {
  // Unlowered: the fixed point lowering is deliberately not idempotent, since
  // running it twice would scale every number twice.
  const source = 'local function f(a, b) return a + b end\nfor i = 1, 10 do print(f(i, 2)) end';
  const once = compile(source, { fixedPoint: false });
  assert.strictEqual(norm(compile(once, { fixedPoint: false })), norm(once));
});

test('compiled output re-parses cleanly', () => {
  const sources = [
    'if (a) x+=1 else x-=1',
    'x = a | b & ~cc',
    'ci.x+=fq ci.y+=fr yield()',
    '?"hi"',
    'a[f()] += 1',
  ];
  for (const source of sources) {
    const out = compile(source);
    assert.doesNotThrow(() => parse(out), `${source} -> ${out}`);
  }
});

test('string and comment contents are never rewritten', () => {
  assert.strictEqual(c('x = "if (a) y+=1"'), 'x = "if (a) y+=1"');
  assert.strictEqual(c('x = 1 -- if (a) y+=1'), 'x = 1');
  assert.strictEqual(c("x = 'a != b'"), "x = 'a != b'");
  assert.strictEqual(c('x = [[a += b]]'), 'x = [[a += b]]');
});

test('escapes inside strings survive', () => {
  assert.strictEqual(c('x = "a\\"b"'), 'x = "a\\"b"');
  assert.strictEqual(c('x = "line\\n"'), 'x = "line\\n"');
});

// ===========================================================================
// P8SCII string escapes - stock Lua rejects these outright
// ===========================================================================

test('P8SCII escapes decode to their control characters', () => {
  const pairs = [['\\*', 1], ['\\#', 2], ['\\-', 3], ['\\|', 4], ['\\+', 5], ['\\^', 6]];
  for (const [escape, code] of pairs) {
    const [token] = tokenize(`"${escape}"`);
    assert.strictEqual(token.value, String.fromCharCode(code), escape);
  }
});

test('P8SCII escapes are re-emitted as plain Lua decimal escapes', () => {
  assert.strictEqual(c('x = "\\^w\\^t"'), 'x = "\\006w\\006t"');
  assert.strictEqual(c('s = "\\*6a"'), 's = "\\0016a"');
});

test('Lua escapes are preserved through the round trip', () => {
  assert.strictEqual(tokenize('"\\a"')[0].value, '\x07');
  assert.strictEqual(tokenize('"\\65"')[0].value, 'A');
  assert.strictEqual(tokenize('"\\x41"')[0].value, 'A');
  assert.strictEqual(c('x = "\\65"'), 'x = "A"');
});

// ===========================================================================
// Button glyph constants - carts write btnp(O) rather than btnp(4)
// ===========================================================================

test('each button glyph carries the btn() index it stands for', () => {
  const pairs = [
    ['\u2B05\uFE0F', 0], ['\u27A1\uFE0F', 1], ['\u2B06\uFE0F', 2],
    ['\u2B07\uFE0F', 3], ['\uD83C\uDD7E\uFE0F', 4], ['\u274E\uFE0F', 5],
  ];
  for (const [glyph, index] of pairs) {
    const [token] = tokenize(glyph);
    assert.strictEqual(token.type, 'number', glyph);
    assert.strictEqual(token.value, index, glyph);
  }
});

test('a glyph is read the same with or without its variation selector', () => {
  assert.strictEqual(tokenize('\u274E')[0].value, tokenize('\u274E\uFE0F')[0].value);
  assert.strictEqual(tokenize('\u2B05')[0].value, tokenize('\u2B05\uFE0F')[0].value);
});

test('a glyph compiles to the plain number, so the VM never sees it', () => {
  assert.strictEqual(c('if btnp(\uD83C\uDD7E\uFE0F) then x = 1 end'), 'if btnp(4) then x = 1 end');
  assert.strictEqual(c('x = btn(\u2B05\uFE0F)'), 'x = btn(0)');
});

test('a glyph inside a string stays text and is not folded to a number', () => {
  const tokens = tokenize('"press \u274E"');
  assert.strictEqual(tokens[0].type, 'string');
  assert.strictEqual(tokens[0].value, 'press \x97');
});

test('an unsupported symbol is still reported rather than silently dropped', () => {
  assert.throws(() => tokenize('x = \u00A7'), /unexpected symbol/);
});

// ===========================================================================
// Glyph names - PICO-8 counts the high characters as name characters, so carts
// use them as one-character variables. dinky_kong.p8 writes
// `fillp(flk==0 and 0b1111000011110000.1 or \u25a4)`, where \u25a4 is never
// assigned, to mean "otherwise clear the fill pattern".
// ===========================================================================

test('a glyph that is not a button reads as a name, not a syntax error', () => {
  const [token] = tokenize('\u25a4');
  assert.strictEqual(token.type, 'name');
  assert.strictEqual(token.value, '\u25a4');
});

test('an unassigned glyph name compiles to a plain global, so it evaluates to nil', () => {
  assert.strictEqual(c('fillp(flk==0 and 0b1010.1 or \u25a4)'), 'fillp(flk == 0 and 10.5 or __p8g98_)');
});

test('each glyph name gets its own identifier, so two glyphs stay distinct', () => {
  assert.strictEqual(c('x = \u25a4'), 'x = __p8g98_');
  assert.strictEqual(c('x = \u2592'), 'x = __p8g81_');
});

test('a glyph name is an ordinary variable that can be assigned and read back', () => {
  assert.strictEqual(c('\u25a4 = 1 y = \u25a4'), '__p8g98_ = 1 y = __p8g98_');
  assert.strictEqual(c('local \u2592 = 2'), 'local __p8g81_ = 2');
});

test('glyphs combine with ASCII in one name rather than splitting the token', () => {
  const tokens = tokenize('a\u25a4b = 1');
  assert.strictEqual(tokens[0].type, 'name');
  assert.strictEqual(tokens[0].value, 'a\u25a4b');
  assert.strictEqual(c('a\u25a4b = 1'), 'a__p8g98_b = 1');
});

test('a button glyph is still a number even though it could spell a name', () => {
  assert.strictEqual(c('x = \u274E\uFE0F'), 'x = 5');
  assert.strictEqual(c('x = \u2B05\uFE0F'), 'x = 0');
});

test('a glyph field keeps the cart key, so dot and bracket access agree', () => {
  assert.strictEqual(c('x = t.\u25a4'), 'x = t["\\152"]');
  assert.strictEqual(c('t = {\u25a4 = 1}'), 't = {["\\152"] = 1}');
});

test('a glyph name is not confused for the same glyph inside a string', () => {
  assert.strictEqual(c('x = \u25a4 y = "\u25a4"'), 'x = __p8g98_ y = "\\152"');
});

test('a glyph outside the character set is still rejected as a name', () => {
  assert.throws(() => tokenize('\u00A7 = 1'), /unexpected symbol/);
});

// P8SCII strings - a .p8 stores text as UTF-8, PICO-8 runs it as single bytes
test('each glyph in a string becomes the single byte PICO-8 would hold', () => {
  const cases = [
    ['\u2B05\uFE0F', 0x8b], ['\u27A1\uFE0F', 0x91], ['\u2B06\uFE0F', 0x94],
    ['\u2B07\uFE0F', 0x83], ['\uD83C\uDD7E\uFE0F', 0x8e], ['\u274E\uFE0F', 0x97],
    ['\u2665', 0x87], ['\u2605', 0x92], ['\u25CF', 0x86], ['\u25AE', 0x10],
    ['\u25CB', 0x7f], ['\u3042', 0x9a],
  ];
  for (const [glyph, code] of cases) {
    assert.strictEqual(tokenize(`"${glyph}"`)[0].value, String.fromCharCode(code), glyph);
  }
});

test('a glyph counts as one character, so centring maths lines up', () => {
  assert.strictEqual(tokenize('"\u2B05\uFE0F\u27A1\uFE0F"')[0].value.length, 2);
});

test('a glyph is mapped the same with or without its variation selector', () => {
  assert.strictEqual(tokenize('"\u274E"')[0].value, tokenize('"\u274E\uFE0F"')[0].value);
});

test('compiled strings stay ASCII so the VM never sees a raw high byte', () => {
  const out = c('print("press \u274E")');
  assert.strictEqual(out, 'print("press \\151")');
  assert.ok(!/[^\x00-\x7f]/.test(out));
});

test('a long string carrying glyphs is rebuilt rather than emitted verbatim', () => {
  assert.strictEqual(c('x = [[a\u2665b]]'), 'x = "a\\135b"');
});

test('text outside the character set falls back to its UTF-8 bytes', () => {
  // PICO-8 keeps unknown text as raw bytes rather than dropping it.
  assert.strictEqual(tokenize('"\u00E9"')[0].value, '\xc3\xa9');
});

test('quote style is preserved', () => {
  assert.strictEqual(c("x = 'a != b'"), "x = 'a != b'");
  assert.strictEqual(c("x = 'it\\'s'"), "x = 'it\\'s'");
});

test('long strings keep their original spelling', () => {
  assert.strictEqual(c('x = [[a \\^w b]]'), 'x = [[a \\^w b]]');
  assert.strictEqual(c('x = [==[a ]] b]==]'), 'x = [==[a ]] b]==]');
});

test('\\z skips following whitespace', () => {
  assert.strictEqual(tokenize('"a\\z   \n   b"')[0].value, 'ab');
});

// ===========================================================================
// Line preservation and diagnostics
// ===========================================================================

test('output keeps statements on their original lines', () => {
  const source = 'x = 1\n\nif (a) y = 2\nz = 3';
  const out = compile(source, { fixedPoint: false });
  const lines = out.split('\n');
  assert.strictEqual(lines.length, 4, out);
  assert.match(lines[0], /x = 1/);
  assert.strictEqual(lines[1].trim(), '');
  assert.match(lines[2], /if a then y = 2 end/);
  assert.match(lines[3], /z = 3/);
});

test('multi-line constructs keep their line count', () => {
  const source = 'if a then\n  x = 1\nend';
  assert.strictEqual(compile(source).split('\n').length, 3);
});

test('a multi-line long string does not push later lines down', () => {
  const out = compile('x = [[a\nb\nc]]\ny = 1', { fixedPoint: false });
  const lines = out.split('\n');
  assert.strictEqual(lines.length, 4, out);
  assert.match(lines[3], /y = 1/);
});

test('a multi-line table constructor keeps later lines in place', () => {
  const out = compile('t = {\n1,\n2,\n}\ny = 1', { fixedPoint: false });
  const lines = out.split('\n');
  assert.strictEqual(lines.length, 5, out);
  assert.match(lines[4], /y = 1/);
});

test('syntax errors report a line number', () => {
  assert.throws(() => compile('x = 1\ny = = 2'), (err) => {
    assert.strictEqual(err.line, 2, err.message);
    assert.match(err.message, /line 2/);
    return true;
  });
});

test('unterminated string is an error', () => {
  assert.throws(() => compile('x = "abc'), /line 1/);
});

test('shorthand if with an empty body is an error', () => {
  assert.throws(() => compile('if (a)\nx = 1'), /line 1/);
});

test('empty input compiles to empty output', () => {
  assert.strictEqual(compile(''), '');
  assert.strictEqual(c('\n\n'), '');
});

test('leading shebang-style pico header comment is fine', () => {
  assert.strictEqual(c('-- title\n-- by me\nx = 1'), 'x = 1');
});

// ===========================================================================
// Group N - the fixed point lowering
//
// PICO-8 numbers are signed 16.16 fixed point, so each carries 32 significant
// bits and a float32 lua_Number cannot hold one. Under this option a number is
// emitted as its raw word in a Lua integer, which is exact. The option is on by
// default, so the tests above ask for it to be off to describe stock output.
// ===========================================================================

/** Compile with the lowering on and normalise. */
const f = (source) => norm(compile(source, { fixedPoint: true }));

test('fixed point: on by default, and still switchable per compile', () => {
  assert.strictEqual(norm(compile('x = 1')), 'x = 65536');
  assert.strictEqual(norm(compile('x = 1', {})), 'x = 65536');
  assert.strictEqual(norm(compile('x = 1', { fixedPoint: true })), 'x = 65536');
  assert.strictEqual(norm(compile('x = 1', { fixedPoint: false })), 'x = 1');
});

test('fixed point: literals become their raw 16.16 word', () => {
  assert.strictEqual(f('x = 1'), 'x = 65536');
  assert.strictEqual(f('x = 0'), 'x = 0');
  assert.strictEqual(f('x = 0.5'), 'x = 32768');
  // The smallest number PICO-8 has is one raw unit.
  assert.strictEqual(f('x = 0x0.0001'), 'x = 1');
  // Anything finer than that truncates away, as it does on real hardware.
  assert.strictEqual(f('x = 0.000001'), 'x = 0');
});

test('fixed point: a word that goes negative is emitted as hex', () => {
  // 0x8000 scales to 2147483648, which wraps to the most negative word. Written
  // in decimal Lua would read it as unary minus on a literal that had already
  // overflowed into a float, undoing the whole point of the lowering.
  assert.strictEqual(f('x = 0x8000'), 'x = 0x80000000');
  assert.strictEqual(f('x = 0x8000.0001'), 'x = 0x80000001');
});

test('fixed point: add, subtract and compare stay native', () => {
  // The scale factor is common to both sides, so these are already exact.
  assert.strictEqual(f('x = a + b'), 'x = a + b');
  assert.strictEqual(f('x = a - 1'), 'x = a - 65536');
  assert.strictEqual(f('x = a < b'), 'x = a < b');
  assert.strictEqual(f('x = -a'), 'x = -a');
});

test('fixed point: multiply and divide go to the runtime helpers', () => {
  assert.strictEqual(f('x = a * b'), 'x = __p8mul(a, b)');
  assert.strictEqual(f('x = a / b'), 'x = __p8div(a, b)');
  assert.strictEqual(f('x = a % b'), 'x = __p8mod(a, b)');
  assert.strictEqual(f('x = a \\ b'), 'x = __p8idiv(a, b)');
  assert.strictEqual(f('x = a ^ b'), 'x = __p8pow(a, b)');
});

test('fixed point: bitwise ops stop being calls and become native Lua', () => {
  // This is the reason the black wedge appeared: these have to be exact, and
  // as native operators they are, with one less bridge crossing than before.
  assert.strictEqual(f('x = a & b'), 'x = a & b');
  assert.strictEqual(f('x = a | b'), 'x = a | b');
  assert.strictEqual(f('x = a ^^ b'), 'x = a ~ b');
  assert.strictEqual(f('x = ~a'), 'x = ~a');
  // Compare with the default lowering, which routes them through the bridge.
  assert.strictEqual(c('x = a & b'), 'x = band(a, b)');
});

test('fixed point: shifts keep their helper because the count is scaled too', () => {
  assert.strictEqual(f('x = a << b'), 'x = __p8shl(a, b)');
  assert.strictEqual(f('x = a >> b'), 'x = __p8shr(a, b)');
  assert.strictEqual(f('x = a >>> b'), 'x = __p8lshr(a, b)');
  assert.strictEqual(f('x = a <<> b'), 'x = __p8rotl(a, b)');
  assert.strictEqual(f('x = a >>< b'), 'x = __p8rotr(a, b)');
});

test('fixed point: concatenation renders words back to digits', () => {
  assert.strictEqual(f('x = a .. b'), 'x = __p8cat(a, b)');
  assert.strictEqual(f('x = "hp:" .. 3'), 'x = __p8cat("hp:", 196608)');
});

test('fixed point: a literal subscript stays a plain key, at no runtime cost', () => {
  // Most of a cart's indexing is literal, and none of it should pay for the
  // conversion. t[1] must not become t[65536] or the table stops being a
  // sequence and #, add(), all() and unpack() change meaning.
  assert.strictEqual(f('x = v[1]'), 'x = v[1]');
  assert.strictEqual(f('x = v[0]'), 'x = v[0]');
  assert.strictEqual(f('x = v["hp"]'), 'x = v["hp"]');
  assert.strictEqual(f('x = v.hp'), 'x = v.hp');
  assert.strictEqual(f('t = {[2] = 5}'), 't = {[2] = 327680}');
});

test('fixed point: a computed subscript is converted while the cart runs', () => {
  assert.strictEqual(f('x = v[i]'), 'x = v[__p8key(i)]');
  assert.strictEqual(f('x = v[i + 1]'), 'x = v[__p8key(i + 65536)]');
  assert.strictEqual(f('v[i] = 1'), 'v[__p8key(i)] = 65536');
});

test('fixed point: # yields a count, so it has to be scaled up', () => {
  assert.strictEqual(f('x = #v'), 'x = __p8len(v)');
  assert.strictEqual(f('x = #v + 1'), 'x = __p8len(v) + 65536');
});

test('fixed point: a numeric for spells out its implied step', () => {
  // The control variable counts in raw words, so the default step of one has
  // to become one whole unit rather than the 1/65536 Lua would use.
  assert.strictEqual(f('for i = 1, 10 do end'), 'for i = 65536, 655360, 0x10000 do end');
  // An explicit step is already scaled and is left alone.
  assert.strictEqual(f('for i = 1, 10, 2 do end'), 'for i = 65536, 655360, 131072 do end');
});

test('fixed point: precedence still brackets correctly around the helpers', () => {
  // A helper call is atomic, so it never needs bracketing itself, but what it
  // replaced did have a precedence and the operands still do.
  assert.strictEqual(f('x = (a + b) * c'), 'x = __p8mul((a + b), c)');
  assert.strictEqual(f('x = a * b + c'), 'x = __p8mul(a, b) + c');
  assert.strictEqual(f('x = a & b | c'), 'x = a & b | c');
  assert.strictEqual(f('x = (a | b) & c'), 'x = (a | b) & c');
});

