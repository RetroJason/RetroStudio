/**
 * Tests for the PICO-8 dialect parser.
 *
 * The parser reads PICO-8's extended Lua and emits stock Lua 5.2, which is what
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

/** Compile and normalise in one step. */
const c = (source) => norm(compile(source));

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

test('lexer: hex literals with a fractional part are stock Lua 5.2 and survive', () => {
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
// Stock Lua 5.2 must survive untouched
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

test('goto and labels are Lua 5.2 features and survive', () => {
  assert.strictEqual(c('::top:: goto top'), '::top:: goto top');
});

test('semicolons are accepted', () => {
  assert.strictEqual(c('x = 1; y = 2;'), 'x = 1 y = 2');
});

test('compiling stock Lua is idempotent', () => {
  const source = 'local function f(a, b) return a + b end\nfor i = 1, 10 do print(f(i, 2)) end';
  const once = compile(source);
  assert.strictEqual(norm(compile(once)), norm(once));
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
// P8SCII string escapes - Lua 5.2 rejects these outright
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
  const out = compile(source);
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
  const out = compile('x = [[a\nb\nc]]\ny = 1');
  const lines = out.split('\n');
  assert.strictEqual(lines.length, 4, out);
  assert.match(lines[3], /y = 1/);
});

test('a multi-line table constructor keeps later lines in place', () => {
  const out = compile('t = {\n1,\n2,\n}\ny = 1');
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
