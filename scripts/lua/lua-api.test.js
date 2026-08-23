/**
 * Contract-first unit tests for every non-PICO-8 Lua API.
 *
 * WHY THIS EXISTS
 * ---------------
 * api.json is the authoritative interface definition: extension-loader.js only
 * registers functions that api.json declares, so anything listed here is
 * reachable from Lua and anything absent is not. The firmware Lua engine is
 * being brought up against that same contract, which means every entry needs a
 * behavioural test describing what the call actually does - not just that a
 * method with the right name exists (api-conformance.test.js already covers
 * existence, and it deliberately swallows errors).
 *
 * The final test in this file is a coverage gate: it fails if any function
 * declared in api.json for these categories was never invoked by a test above.
 * Adding an API without a test therefore breaks the build.
 *
 * PICO-8 is covered separately by pico8.test.js, which carries its own
 * invocation-coverage gate and cross-checks itself against api.json.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

/* ══════════════════════════════════════════════════════════════════════
   Harness
   ══════════════════════════════════════════════════════════════════════ */

const realLog = console.log.bind(console);

function repoPath(...parts) {
  return path.resolve(__dirname, ...parts);
}

function loadApiContract() {
  return JSON.parse(fs.readFileSync(repoPath('api.json'), 'utf8'));
}

const API = loadApiContract();

/** Categories owned by this file. PICO-8 lives in pico8.test.js. */
const COVERED_CATEGORIES = [
  'Sprite', 'Image', 'TextBox', 'Music', 'SFX',
  'Input', 'Math', 'Time', 'System', 'TileMap', 'Battery',
];

function declaredFunctionNames(categoryName) {
  const category = (API.categories || []).find((c) => c.name === categoryName);
  if (!category) {
    throw new Error(`api.json has no category named "${categoryName}"`);
  }
  return (category.functions || []).map((f) => f.name);
}

function setupGlobals() {
  global.window = global.window || {};
  const basePath = repoPath('base-lua-extension.js');
  delete require.cache[basePath];
  const BaseLuaExtension = require(basePath) || global.window.BaseLuaExtension;
  if (typeof BaseLuaExtension !== 'function') {
    throw new Error('Failed to load BaseLuaExtension');
  }
  global.BaseLuaExtension = BaseLuaExtension;
}

function loadExtensionClass(categoryName) {
  const filePath = repoPath(`${categoryName.toLowerCase()}.js`);
  delete require.cache[filePath];
  const exported = require(filePath);
  const ExtensionClass = (typeof exported === 'function' ? exported : null)
    || global.window[`Lua${categoryName}Extensions`];
  if (typeof ExtensionClass !== 'function') {
    throw new Error(`Failed to load Lua${categoryName}Extensions from ${filePath}`);
  }
  return ExtensionClass;
}

/** Every API call made through an instrumented instance is recorded here. */
const covered = new Set();

/**
 * Wrap the contract-declared methods so that merely calling the API records
 * coverage. Wrapping by contract name (rather than every method) means private
 * helpers do not count towards coverage.
 */
function instrument(instance, categoryName) {
  for (const name of declaredFunctionNames(categoryName)) {
    const method = instance[name];
    if (typeof method !== 'function') continue;
    const original = method.bind(instance);
    instance[name] = (...args) => {
      covered.add(`${categoryName}.${name}`);
      return original(...args);
    };
  }
  return instance;
}

/* ══════════════════════════════════════════════════════════════════════
   Shared fixtures
   ══════════════════════════════════════════════════════════════════════ */

/**
 * D2Sprite is a browser global that sprite.js calls into. The real parser is
 * not under test here, so this stub provides just enough frame geometry for the
 * transform APIs to produce checkable numbers.
 */
function installD2SpriteStub() {
  global.D2Sprite = {
    createSpriteState(d2s, d2f) {
      return { d2s, d2f, x: 0, y: 0, elapsed: 0, _animName: null, finished: false };
    },
    setAnimation(state, name) {
      state._animName = name;
    },
    getCurrentFrame() {
      return {
        x: 0, y: 0, w: 16, h: 24,
        offsetX: 0, offsetY: 0,
        centerX: 8, centerY: 12,
        paletteSlot: 0xFF, palOffset: 0xFF,
      };
    },
    updateAnimation(state, deltaMs) {
      state.elapsed += deltaMs;
    },
  };
}

function makeEmulator(overrides = {}) {
  return {
    allocateRenderOrder: () => 1,
    getService: () => null,
    ...overrides,
  };
}

/* ── Sprite ─────────────────────────────────────────────────────────── */

function makeSprite() {
  const Sprite = loadExtensionClass('Sprite');
  const sprite = new Sprite(makeEmulator());
  sprite.spriteAssets.set('hero', {
    d2s: { animations: [{ name: 'idle' }, { name: 'run' }] },
    d2f: { frames: [{}], header: { textureIndex: 0, paletteSlot: 1, paletteOffset: 0 } },
  });
  return instrument(sprite, 'Sprite');
}

/* ── Image ──────────────────────────────────────────────────────────── */

function makeImage() {
  const Image = loadExtensionClass('Image');
  const image = new Image(makeEmulator());
  image.imageAssets.set('logo', {
    frames: [{ w: 64, h: 32 }, { w: 64, h: 32 }, { w: 64, h: 32 }],
  });
  return instrument(image, 'Image');
}

/* ── TextBox ────────────────────────────────────────────────────────── */

function makeTextBox() {
  const TextBox = loadExtensionClass('TextBox');
  const textbox = new TextBox(makeEmulator());
  textbox.fontAssets.set('DefaultFont', { common: { lineHeight: 12, base: 10 }, characters: new Map() });
  return instrument(textbox, 'TextBox');
}

/* ── Audio (SFX + Music share this shape) ───────────────────────────── */

function makeAudioEngine() {
  return {
    resources: new Map([['wav-1', { type: 'wav' }], ['mod-1', { type: 'mod' }]]),
    activeSounds: new Map(),
    activeSongs: new Map(),
    calls: [],
    getResource(id) { return this.resources.get(id) || null; },
    startSound(resourceObject, volume) {
      this.calls.push({ fn: 'startSound', volume });
      const id = `inst-${this.activeSounds.size + 1}`;
      this.activeSounds.set(id, { resourceObject, volume });
      return id;
    },
    stopSound(id) {
      this.calls.push({ fn: 'stopSound', id });
      this.activeSounds.delete(id);
    },
    startSong(resourceId, volume, loop) {
      this.calls.push({ fn: 'startSong', resourceId, volume, loop });
      this.activeSongs.set(resourceId, { volume, loop });
      return true;
    },
    stopSong(resourceId) {
      this.calls.push({ fn: 'stopSong', resourceId });
      this.activeSongs.delete(resourceId);
    },
  };
}

function makeSfx() {
  const SFX = loadExtensionClass('SFX');
  const audioEngine = makeAudioEngine();
  const emulator = makeEmulator({
    getService: (name) => (name === 'audioEngine' ? audioEngine : null),
    GetResourcesByType: (type) => (type === 'SFX'
      ? [
        { fileName: 'shoot', loaded: true, audioResource: 'wav-1' },
        { fileName: 'jump', loaded: true, audioResource: 'wav-1' },
      ]
      : []),
  });
  return { sfx: instrument(new SFX(emulator), 'SFX'), audioEngine };
}

function makeMusic() {
  const Music = loadExtensionClass('Music');
  const audioEngine = makeAudioEngine();
  const emulator = makeEmulator({
    getService: (name) => (name === 'audioEngine' ? audioEngine : null),
    GetResourcesByType: (type) => (type === 'MUSIC'
      ? [{ fileName: 'theme', loaded: true, audioResource: 'mod-1' }]
      : []),
  });
  return { music: instrument(new Music(emulator), 'Music'), audioEngine };
}

/* ── Input ──────────────────────────────────────────────────────────── */

const KEY_A = 0x0100;
const KEY_B = 0x0001;

function makeInput() {
  const Input = loadExtensionClass('Input');
  const inputManager = {
    held: 0,
    pressed: 0,
    released: 0,
    getKeysHeld() { return this.held; },
    getKeysPressed() { return this.pressed; },
    getKeysReleased() { return this.released; },
    isKeyHeld(mask) { return (this.held & mask) !== 0; },
    isKeyPressed(mask) { return (this.pressed & mask) !== 0; },
    isKeyReleased(mask) { return (this.released & mask) !== 0; },
  };
  const input = new Input(makeEmulator({ inputManager }));
  return { input: instrument(input, 'Input'), inputManager };
}

/* ── TileMap ────────────────────────────────────────────────────────── */

const MAP_PATH = 'build/Maps/level-1.d2m';

function makeTileMap() {
  const TileMap = loadExtensionClass('TileMap');
  const tilemap = new TileMap(makeEmulator());

  // Load() refuses to run without a file manager, then short-circuits on the
  // asset cache. Seeding the cache exercises the handle bookkeeping without
  // needing a real D2M binary - the binary parser is covered by its own tests.
  tilemap.fileManager = { getFile: () => null };
  tilemap.tilemapAssets.set(MAP_PATH, {
    header: { mapWidth: 40, mapHeight: 30, tileWidth: 16, tileHeight: 16 },
    layers: [
      { width: 40, height: 30, flags: 0x0001, cellData: new Uint32Array(40 * 30) },
      { width: 40, height: 30, flags: 0x0000, cellData: new Uint32Array(40 * 30) },
    ],
    strings: [],
    wang: { terrains: [{ name: 'grass' }] },
    fileData: new Uint8Array(0),
  });

  return instrument(tilemap, 'TileMap');
}

/* ══════════════════════════════════════════════════════════════════════
   Tests
   ══════════════════════════════════════════════════════════════════════ */

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

/* ── Math ───────────────────────────────────────────────────────────── */

function makeMath() {
  return instrument(new (loadExtensionClass('Math'))(makeEmulator()), 'Math');
}

test('Math: trigonometry and roots use radians', () => {
  const m = makeMath();
  assert.strictEqual(m.Sin(0), 0);
  assert.strictEqual(m.Cos(0), 1);
  assert.strictEqual(m.Sqrt(16), 4);
  assert.strictEqual(m.Pow(2, 10), 1024);
  assert.ok(Math.abs(m.Atan2(1, 1) - (Math.PI / 4)) < 1e-12);
});

test('Math: rounding family', () => {
  const m = makeMath();
  assert.strictEqual(m.Ceil(1.2), 2);
  assert.strictEqual(m.Floor(1.8), 1);
  assert.strictEqual(m.Round(2.4), 2);
  assert.strictEqual(m.Round(2.6), 3);
  assert.strictEqual(m.Abs(-3.5), 3.5);
});

test('Math: Min, Max and Clamp', () => {
  const m = makeMath();
  assert.strictEqual(m.Min(3, 7), 3);
  assert.strictEqual(m.Max(3, 7), 7);
  assert.strictEqual(m.Clamp(5, 0, 10), 5, 'a value inside the range is returned unchanged');
  assert.strictEqual(m.Clamp(15, 0, 10), 10, 'a value above the range clamps to max');
  assert.strictEqual(m.Clamp(-5, 0, 10), 0, 'a value below the range clamps to min');
});

test('Math: bitwise operators act on 32-bit integers', () => {
  const m = makeMath();
  assert.strictEqual(m.And(12, 10), 8);
  assert.strictEqual(m.Or(12, 10), 14);
  assert.strictEqual(m.Xor(12, 10), 6);
  assert.strictEqual(m.Not(5), -6, 'Not is a signed bitwise complement, not a logical negation');
  assert.strictEqual(m.LShift(1, 4), 16);
  assert.strictEqual(m.RShift(256, 4), 16);
});

test('Math: angle conversion round-trips', () => {
  const m = makeMath();
  assert.strictEqual(m.RadiansToDegrees(Math.PI), 180);
  assert.ok(Math.abs(m.DegreesToRadians(180) - Math.PI) < 1e-12);
  assert.ok(Math.abs(m.RadiansToDegrees(m.DegreesToRadians(37)) - 37) < 1e-12);
});

test('Math: Random stays inside a half-open range and rejects an empty one', () => {
  const m = makeMath();
  for (let i = 0; i < 200; i += 1) {
    const value = m.Random(5, 10);
    assert.ok(Number.isInteger(value), `Random returned a non-integer: ${value}`);
    assert.ok(value >= 5 && value < 10, `Random returned ${value}, outside [5, 10)`);
  }
  assert.throws(() => m.Random(10, 10), /requires max > min/);
  assert.throws(() => m.Random(10, 5), /requires max > min/);
});

test('Math: a missing or non-numeric argument is an error, not NaN', () => {
  const m = makeMath();
  assert.throws(() => m.Sin(), /missing required argument: x/);
  assert.throws(() => m.Pow(2), /missing required argument: y/);
  assert.throws(() => m.Sqrt('abc'), /invalid numeric argument/);
});

/* ── Time ───────────────────────────────────────────────────────────── */

// Sunday 23 August 2026, 03:30:30.500 local time.
const FIXED_NOW = new Date(2026, 7, 23, 3, 30, 30, 500);

function makeTime() {
  const time = new (loadExtensionClass('Time'))(makeEmulator());
  time._getCurrentTime = () => new Date(FIXED_NOW.getTime());
  return instrument(time, 'Time');
}

test('Time: calendar and clock components', () => {
  const t = makeTime();
  assert.strictEqual(t.Hours(), 3);
  assert.strictEqual(t.Minutes(), 30);
  assert.strictEqual(t.Seconds(), 30);
  assert.strictEqual(t.Milliseconds(), 500);
  assert.strictEqual(t.Day(), 23);
  assert.strictEqual(t.Month(), 8, 'Month is 1-based, unlike the JS Date it is derived from');
  assert.strictEqual(t.Year(), 2026);
  assert.strictEqual(t.DayOfWeek(), 'Sunday');
});

test('Time: watch hand angles, smooth and stepped', () => {
  const t = makeTime();

  // 3h + 30.508333min of the hour -> 90 + 15.254166 degrees.
  assert.ok(Math.abs(t.HoursToDegrees(true) - 105.25416666666666) < 1e-9);
  assert.strictEqual(t.HoursToDegrees(false), 105, 'stepped mode ignores seconds and floors');

  assert.ok(Math.abs(t.MinutesToDegrees(true) - 183.05) < 1e-9);
  assert.strictEqual(t.MinutesToDegrees(false), 183);

  assert.strictEqual(t.SecondsToDegrees(true), 183);
  assert.strictEqual(t.SecondsToDegrees(false), 180, 'stepped mode drops the millisecond fraction');
});

test('Time: smooth defaults to true when the argument is omitted', () => {
  const t = makeTime();
  assert.strictEqual(t.SecondsToDegrees(), t.SecondsToDegrees(true));
});

test('Time: ToString implements the strftime specifiers it documents', () => {
  const t = makeTime();
  assert.strictEqual(t.ToString('%Y-%m-%d %H:%M:%S'), '2026-08-23 03:30:30');
  assert.strictEqual(t.ToString(), '2026-08-23 03:30:30', 'omitting the format uses the ISO-like default');
  assert.strictEqual(t.ToString('%y'), '26');
  assert.strictEqual(t.ToString('%I %p'), '03 AM');
  assert.strictEqual(t.ToString('%e'), '23');
  assert.strictEqual(t.ToString('literal'), 'literal');
  assert.throws(() => t.ToString(42), /invalid format argument/);
});

/* ── System ─────────────────────────────────────────────────────────── */

test('System: LogLua forwards a message and rejects an empty one', () => {
  const system = instrument(new (loadExtensionClass('System'))(makeEmulator()), 'System');
  assert.doesNotThrow(() => system.LogLua('hello from lua'));
  assert.throws(() => system.LogLua(), /missing required argument: message/);
  assert.throws(() => system.LogLua(''), /missing required argument: message/);
});

test('System: SetClearColor unpacks a 24-bit RGB integer into normalised channels', () => {
  const emulator = makeEmulator();
  const system = instrument(new (loadExtensionClass('System'))(emulator), 'System');

  system.SetClearColor(0x112233);
  assert.deepStrictEqual(emulator.clearColor, {
    r: 0x11 / 255,
    g: 0x22 / 255,
    b: 0x33 / 255,
    a: 1,
  });

  system.SetClearColor(0xFFFFFF);
  assert.deepStrictEqual(emulator.clearColor, { r: 1, g: 1, b: 1, a: 1 });

  assert.throws(() => system.SetClearColor(), /missing required argument: color/);
});

/* ── Battery ────────────────────────────────────────────────────────── */

test('Battery: GetChargeState returns the full firmware charge-state table', () => {
  const battery = instrument(new (loadExtensionClass('Battery'))(makeEmulator()), 'Battery');
  const state = battery.GetChargeState();

  // The firmware Lua engine reads these by name, so the key set is the contract.
  assert.deepStrictEqual(Object.keys(state).sort(), [
    'battery_percent',
    'battery_voltage_mv',
    'charger_die_temp_limit_exceeded',
    'charger_jeita_region',
    'charger_main_fsm',
    'charger_main_fsm_raw',
    'charger_nok_irq_status',
    'charger_ok_irq_status',
    'charger_state',
    'plugged_in',
  ]);
  assert.strictEqual(typeof state.plugged_in, 'boolean');
  assert.strictEqual(typeof state.battery_percent, 'number');
  assert.strictEqual(typeof state.charger_state, 'string');
});

/* ── Input ──────────────────────────────────────────────────────────── */

test('Input: bitfield getters report the raw masks', () => {
  const { input, inputManager } = makeInput();
  inputManager.held = KEY_A | KEY_B;
  inputManager.pressed = KEY_A;
  inputManager.released = KEY_B;

  assert.strictEqual(input.GetKeysHeld(), KEY_A | KEY_B);
  assert.strictEqual(input.GetKeysPressed(), KEY_A);
  assert.strictEqual(input.GetKeysReleased(), KEY_B);
});

test('Input: per-key predicates test a single mask bit', () => {
  const { input, inputManager } = makeInput();
  inputManager.held = KEY_A;
  inputManager.pressed = KEY_A;
  inputManager.released = KEY_B;

  assert.strictEqual(input.IsKeyHeld(KEY_A), true);
  assert.strictEqual(input.IsKeyHeld(KEY_B), false);
  assert.strictEqual(input.IsKeyPressed(KEY_A), true);
  assert.strictEqual(input.IsKeyPressed(KEY_B), false);
  assert.strictEqual(input.IsKeyReleased(KEY_B), true);
  assert.strictEqual(input.IsKeyReleased(KEY_A), false);
});

test('Input: a missing input manager is a clear error rather than a silent false', () => {
  const Input = loadExtensionClass('Input');
  const input = new Input(makeEmulator());
  assert.throws(() => input.GetKeysHeld(), /requires an available input manager/);
  assert.throws(() => input.IsKeyHeld(KEY_A), /requires an available input manager/);
});

test('Input: a missing key mask is an error', () => {
  const { input } = makeInput();
  assert.throws(() => input.IsKeyPressed(), /missing required argument: keyMask/);
});

/* ── Sprite ─────────────────────────────────────────────────────────── */

test('Sprite: Create returns a handle, selects the first animation and centres the pivot', () => {
  const sprite = makeSprite();
  const handle = sprite.Create('hero');

  assert.strictEqual(handle, 1);
  assert.strictEqual(sprite.sprites.get(handle)._animName, 'idle', 'the first animation becomes current');

  // Display is 448x368, so the centre is (224, 184). The stub frame pivot is
  // (8, 12), which is where the sprite should land.
  assert.deepStrictEqual(sprite.GetXY(handle), [224 - 8, 184 - 12]);
  assert.throws(() => sprite.Create('nope'), /asset not found/);
});

test('Sprite: position accessors', () => {
  const sprite = makeSprite();
  const h = sprite.Create('hero');

  sprite.SetX(h, 12.5);
  sprite.SetY(h, -4);
  assert.strictEqual(sprite.GetX(h), 12.5);
  assert.strictEqual(sprite.GetY(h), -4);

  sprite.SetXY(h, 100, 200);
  assert.deepStrictEqual(sprite.GetXY(h), [100, 200]);

  assert.strictEqual(sprite.GetZ(h), 0, 'an unset Z reports 0 rather than null');
  sprite.SetZ(h, 7.5);
  assert.strictEqual(sprite.GetZ(h), 7.5);

  sprite.SetXYZ(h, 1, 2, 3);
  assert.deepStrictEqual(sprite.GetXY(h), [1, 2]);
  assert.strictEqual(sprite.GetZ(h), 3);
});

test('Sprite: size falls back to the current frame until SetSize overrides it', () => {
  const sprite = makeSprite();
  const h = sprite.Create('hero');

  assert.deepStrictEqual(sprite.GetSize(h), [16, 24], 'a new sprite reports its real frame size');
  sprite.SetSize(h, 64, 48);
  assert.deepStrictEqual(sprite.GetSize(h), [64, 48]);
});

test('Sprite: centre, angle and scale', () => {
  const sprite = makeSprite();
  const h = sprite.Create('hero');

  assert.deepStrictEqual(sprite.GetCenter(h), [0, 0]);
  sprite.SetCenter(h, 4, 6);
  assert.deepStrictEqual(sprite.GetCenter(h), [4, 6]);

  assert.strictEqual(sprite.GetAngle(h), 0);
  sprite.SetAngle(h, 90);
  assert.strictEqual(sprite.GetAngle(h), 90);

  assert.deepStrictEqual(sprite.GetScale(h), [1, 1], 'scale defaults to 1, not 0');
  sprite.SetScale(h, 2, 3);
  assert.deepStrictEqual(sprite.GetScale(h), [2, 3]);
});

test('Sprite: colour, palette slot, visibility and attributes', () => {
  const sprite = makeSprite();
  const h = sprite.Create('hero');

  assert.strictEqual(sprite.GetColor(h), 0x00FFFFFF, 'the default colour is fully transparent white');
  sprite.SetColor(h, 0xFF0000);
  assert.strictEqual(sprite.GetColor(h), 0xFF0000);

  assert.strictEqual(sprite.GetPaletteSlot(h), 0);
  sprite.SetPaletteSlot(h, 3);
  assert.strictEqual(sprite.GetPaletteSlot(h), 3);

  assert.strictEqual(sprite.GetVisible(h), true, 'a new sprite is visible');
  sprite.SetVisible(h, false);
  assert.strictEqual(sprite.GetVisible(h), false);

  assert.strictEqual(sprite.GetAttributes(h), 0);
  sprite.SetAttributes(h, 0x0C);
  assert.strictEqual(sprite.GetAttributes(h), 0x0C);
});

test('Sprite: animation selection, playback and manual ticking', () => {
  const sprite = makeSprite();
  const h = sprite.Create('hero');

  sprite.SetAnimation(h, 'run');
  assert.strictEqual(sprite.sprites.get(h)._animName, 'run');
  assert.strictEqual(sprite.animating.has(h), false, 'SetAnimation does not start playback');

  sprite.Play(h, 'idle');
  assert.strictEqual(sprite.sprites.get(h)._animName, 'idle');
  assert.strictEqual(sprite.animating.has(h), true);

  sprite.Stop(h);
  assert.strictEqual(sprite.animating.has(h), false);

  // Lua passes seconds; D2Sprite is driven in milliseconds.
  sprite.UpdateAnimation(h, 0.5);
  assert.strictEqual(sprite.sprites.get(h).elapsed, 500);
});

test('Sprite: Clone produces an independent handle', () => {
  const sprite = makeSprite();
  const h = sprite.Create('hero');
  sprite.SetXY(h, 40, 50);

  const clone = sprite.Clone(h);
  assert.notStrictEqual(clone, h);
  assert.deepStrictEqual(sprite.GetXY(clone), [40, 50], 'a clone starts where its source is');

  sprite.SetXY(clone, 0, 0);
  assert.deepStrictEqual(sprite.GetXY(h), [40, 50], 'moving the clone must not move the original');
});

test('Sprite: Destroy retires the handle and stops its animation', () => {
  const sprite = makeSprite();
  const h = sprite.Create('hero');
  sprite.Play(h);
  sprite.Destroy(h);

  assert.strictEqual(sprite.sprites.has(h), false);
  assert.strictEqual(sprite.animating.has(h), false);
  assert.throws(() => sprite.GetX(h), /unknown sprite handle/);
});

test('Sprite: an unknown handle is rejected rather than silently ignored', () => {
  const sprite = makeSprite();
  assert.throws(() => sprite.GetXY(999), /unknown sprite handle/);
  assert.throws(() => sprite.SetX('not-a-handle', 1), /valid sprite handle expected/);
});

/* ── Image ──────────────────────────────────────────────────────────── */

test('Image: Create returns a handle and centres the image on the display', () => {
  const image = makeImage();
  const h = image.Create('logo');

  assert.strictEqual(h, 1);
  // Frame is 64x32 with no explicit pivot, so the fallback pivot is (32, 16).
  assert.deepStrictEqual(image.GetXY(h), [224 - 32, 184 - 16]);
  assert.throws(() => image.Create('missing'), /asset not found/);
});

test('Image: position accessors', () => {
  const image = makeImage();
  const h = image.Create('logo');

  image.SetX(h, 8);
  image.SetY(h, 9);
  assert.strictEqual(image.GetX(h), 8);
  assert.strictEqual(image.GetY(h), 9);

  image.SetXY(h, 30, 40);
  assert.deepStrictEqual(image.GetXY(h), [30, 40]);

  assert.strictEqual(image.GetZ(h), 0);
  image.SetZ(h, 2.5);
  assert.strictEqual(image.GetZ(h), 2.5);

  image.SetXYZ(h, 5, 6, 7);
  assert.deepStrictEqual(image.GetXY(h), [5, 6]);
  assert.strictEqual(image.GetZ(h), 7);
});

test('Image: size falls back to the current frame until SetSize overrides it', () => {
  const image = makeImage();
  const h = image.Create('logo');

  assert.deepStrictEqual(image.GetSize(h), [64, 32]);
  image.SetSize(h, 10, 20);
  assert.deepStrictEqual(image.GetSize(h), [10, 20]);
});

test('Image: centre, angle and scale', () => {
  const image = makeImage();
  const h = image.Create('logo');

  assert.deepStrictEqual(image.GetCenter(h), [0, 0]);
  image.SetCenter(h, 11, 12);
  assert.deepStrictEqual(image.GetCenter(h), [11, 12]);

  assert.strictEqual(image.GetAngle(h), 0);
  image.SetAngle(h, 45);
  assert.strictEqual(image.GetAngle(h), 45);

  assert.deepStrictEqual(image.GetScale(h), [1, 1]);
  image.SetScale(h, 0.5, 0.25);
  assert.deepStrictEqual(image.GetScale(h), [0.5, 0.25]);
});

test('Image: colour, palette slot, visibility and attributes', () => {
  const image = makeImage();
  const h = image.Create('logo');

  assert.strictEqual(image.GetColor(h), 0x00FFFFFF);
  image.SetColor(h, 0x00FF00);
  assert.strictEqual(image.GetColor(h), 0x00FF00);

  assert.strictEqual(image.GetPaletteSlot(h), 0);
  image.SetPaletteSlot(h, 2);
  assert.strictEqual(image.GetPaletteSlot(h), 2);

  assert.strictEqual(image.GetVisible(h), true);
  image.SetVisible(h, false);
  assert.strictEqual(image.GetVisible(h), false);

  assert.strictEqual(image.GetAttributes(h), 0);
  image.SetAttributes(h, 5);
  assert.strictEqual(image.GetAttributes(h), 5);
});

test('Image: frame selection is clamped to the asset frame count', () => {
  const image = makeImage();
  const h = image.Create('logo');

  assert.strictEqual(image.GetFrameCount(h), 3);
  assert.strictEqual(image.GetFrame(h), 0);

  image.SetFrame(h, 2);
  assert.strictEqual(image.GetFrame(h), 2);

  image.SetFrame(h, 99);
  assert.strictEqual(image.GetFrame(h), 2, 'an out-of-range frame clamps to the last frame');

  image.SetFrame(h, -5);
  assert.strictEqual(image.GetFrame(h), 0, 'a negative frame clamps to the first frame');
});

test('Image: Clone and Destroy manage handles independently', () => {
  const image = makeImage();
  const h = image.Create('logo');
  image.SetXY(h, 12, 34);

  const clone = image.Clone(h);
  assert.notStrictEqual(clone, h);
  assert.deepStrictEqual(image.GetXY(clone), [12, 34]);

  image.Destroy(h);
  assert.throws(() => image.GetXY(h), /unknown image handle/);
  assert.deepStrictEqual(image.GetXY(clone), [12, 34], 'destroying the source leaves the clone alive');
});

/* ── TextBox ────────────────────────────────────────────────────────── */

test('TextBox: Create stores every constructor argument', () => {
  const textbox = makeTextBox();
  const h = textbox.Create('DefaultFont', 10, 20, 5, 0xFF0000, 'hello');

  assert.strictEqual(h, 1);
  assert.strictEqual(textbox.GetText(h), 'hello');
  assert.deepStrictEqual(textbox.GetXY(h), [10, 20]);
  assert.strictEqual(textbox.GetZ(h), 5);
  assert.strictEqual(textbox.GetColor(h), 0xFF0000);
  assert.throws(() => textbox.Create('NoSuchFont', 0, 0, 0, 0, ''), /font asset not found/);
});

test('TextBox: SetText replaces the string and rejects a non-string', () => {
  const textbox = makeTextBox();
  const h = textbox.Create('DefaultFont', 0, 0, 0, 0xFFFFFF, 'before');

  textbox.SetText(h, 'after');
  assert.strictEqual(textbox.GetText(h), 'after');

  textbox.SetText(h, '');
  assert.strictEqual(textbox.GetText(h), '', 'an empty string is a legal caption');

  assert.throws(() => textbox.SetText(h, 123), /string expected/);
});

test('TextBox: position accessors', () => {
  const textbox = makeTextBox();
  const h = textbox.Create('DefaultFont', 0, 0, 0, 0xFFFFFF, 'x');

  textbox.SetX(h, 3);
  textbox.SetY(h, 4);
  assert.strictEqual(textbox.GetX(h), 3);
  assert.strictEqual(textbox.GetY(h), 4);

  textbox.SetXY(h, 55, 66);
  assert.deepStrictEqual(textbox.GetXY(h), [55, 66]);

  textbox.SetZ(h, 9);
  assert.strictEqual(textbox.GetZ(h), 9);

  textbox.SetXYZ(h, 1, 2, 3);
  assert.deepStrictEqual(textbox.GetXY(h), [1, 2]);
  assert.strictEqual(textbox.GetZ(h), 3);
});

test('TextBox: box geometry defaults to the full display', () => {
  const textbox = makeTextBox();
  const h = textbox.Create('DefaultFont', 0, 0, 0, 0xFFFFFF, 'x');

  assert.deepStrictEqual(textbox.GetSize(h), [448, 368]);
  textbox.SetSize(h, 100, 50);
  assert.deepStrictEqual(textbox.GetSize(h), [100, 50]);

  assert.deepStrictEqual(textbox.GetCenter(h), [0, 0]);
  textbox.SetCenter(h, 20, 10);
  assert.deepStrictEqual(textbox.GetCenter(h), [20, 10]);
});

test('TextBox: angle, scale, colour, palette slot, visibility and attributes', () => {
  const textbox = makeTextBox();
  const h = textbox.Create('DefaultFont', 0, 0, 0, 0xFFFFFF, 'x');

  assert.strictEqual(textbox.GetAngle(h), 0);
  textbox.SetAngle(h, 15);
  assert.strictEqual(textbox.GetAngle(h), 15);

  assert.deepStrictEqual(textbox.GetScale(h), [1, 1]);
  textbox.SetScale(h, 2, 2);
  assert.deepStrictEqual(textbox.GetScale(h), [2, 2]);

  textbox.SetColor(h, 0x00FF00);
  assert.strictEqual(textbox.GetColor(h), 0x00FF00);

  assert.strictEqual(textbox.GetPaletteSlot(h), 0);
  textbox.SetPaletteSlot(h, 4);
  assert.strictEqual(textbox.GetPaletteSlot(h), 4);

  assert.strictEqual(textbox.GetVisible(h), true);
  textbox.SetVisible(h, false);
  assert.strictEqual(textbox.GetVisible(h), false);

  assert.strictEqual(textbox.GetAttributes(h), 0);
  textbox.SetAttributes(h, 7);
  assert.strictEqual(textbox.GetAttributes(h), 7);
});

test('TextBox: Destroy retires the handle', () => {
  const textbox = makeTextBox();
  const h = textbox.Create('DefaultFont', 0, 0, 0, 0xFFFFFF, 'x');
  textbox.Destroy(h);
  assert.throws(() => textbox.GetText(h), /unknown textbox handle/);
});

/* ── TileMap ────────────────────────────────────────────────────────── */

test('TileMap: Load returns a handle and exposes map geometry', () => {
  const tilemap = makeTileMap();
  const h = tilemap.Load(MAP_PATH);

  assert.strictEqual(h, 1);
  assert.deepStrictEqual(tilemap.GetDimensions(h), [40, 30]);
  assert.deepStrictEqual(tilemap.GetTileSize(h), [16, 16]);
  assert.strictEqual(tilemap.GetLayerCount(h), 2);
  assert.throws(() => tilemap.Load(), /missing required argument/);
});

test('TileMap: tile reads and writes round-trip through layer cell data', () => {
  const tilemap = makeTileMap();
  const h = tilemap.Load(MAP_PATH);

  assert.strictEqual(tilemap.GetTile(h, 0, 3, 4), 0);
  tilemap.SetTile(h, 0, 3, 4, 42);
  assert.strictEqual(tilemap.GetTile(h, 0, 3, 4), 42);

  // Layers are independent surfaces.
  assert.strictEqual(tilemap.GetTile(h, 1, 3, 4), 0);

  // Out-of-range reads report empty rather than throwing, matching firmware.
  assert.strictEqual(tilemap.GetTile(h, 0, 9999, 9999), 0);
  assert.strictEqual(tilemap.GetTile(h, 99, 0, 0), 0, 'an unknown layer reads as empty');
  assert.doesNotThrow(() => tilemap.SetTile(h, 99, 0, 0, 1), 'writing to an unknown layer is a no-op');
});

test('TileMap: layer visibility is a flag bit', () => {
  const tilemap = makeTileMap();
  const h = tilemap.Load(MAP_PATH);

  assert.strictEqual(tilemap.GetLayerVisibility(h, 0), true);
  assert.strictEqual(tilemap.GetLayerVisibility(h, 1), false);

  tilemap.SetLayerVisibility(h, 1, true);
  assert.strictEqual(tilemap.GetLayerVisibility(h, 1), true);

  tilemap.SetLayerVisibility(h, 1, false);
  assert.strictEqual(tilemap.GetLayerVisibility(h, 1), false);

  assert.strictEqual(tilemap.GetLayerVisibility(h, 99), false, 'an unknown layer is not visible');
});

test('TileMap: GetWangData serialises terrain metadata as JSON', () => {
  const tilemap = makeTileMap();
  const h = tilemap.Load(MAP_PATH);

  const wang = tilemap.GetWangData(h);
  assert.strictEqual(typeof wang, 'string', 'Wang data crosses to Lua as a JSON string');
  assert.deepStrictEqual(JSON.parse(wang), { terrains: [{ name: 'grass' }] });
});

test('TileMap: DrawLayer stages a draw call for the render pass', () => {
  const tilemap = makeTileMap();
  const h = tilemap.Load(MAP_PATH);

  tilemap.DrawLayer(h, 0, -32, -64, 1.5);
  assert.strictEqual(tilemap.pendingDrawCalls.length, 1);
  assert.strictEqual(tilemap.pendingDrawCalls[0].layerIndex, 0);
  assert.strictEqual(tilemap.pendingDrawCalls[0].cameraX, -32);
  assert.strictEqual(tilemap.pendingDrawCalls[0].cameraY, -64);
  assert.strictEqual(tilemap.pendingDrawCalls[0].z, 1.5);

  tilemap.DrawLayer(h, 99, 0, 0, 0);
  assert.strictEqual(tilemap.pendingDrawCalls.length, 1, 'an unknown layer stages nothing');
});

test('TileMap: ScreenClamp keeps the camera inside the map', () => {
  const tilemap = makeTileMap();

  assert.deepStrictEqual(tilemap.ScreenClamp(100, 50, 1000, 800, 368, 448), [100, 50],
    'a camera already inside the map is untouched');
  assert.deepStrictEqual(tilemap.ScreenClamp(9999, 9999, 1000, 800, 368, 448), [632, 352],
    'the camera stops when the map edge reaches the screen edge');
  assert.deepStrictEqual(tilemap.ScreenClamp(-10, -10, 1000, 800, 368, 448), [0, 0],
    'the camera cannot scroll past the origin');
  assert.deepStrictEqual(tilemap.ScreenClamp(50, 50, 100, 100, 368, 448), [0, 0],
    'a map smaller than the screen pins the camera at the origin');
});

test('TileMap: Unload frees the handle', () => {
  const tilemap = makeTileMap();
  const h = tilemap.Load(MAP_PATH);

  tilemap.Unload(h);
  assert.throws(() => tilemap.GetDimensions(h), /invalid tilemap handle/);
  assert.doesNotThrow(() => tilemap.Unload(h), 'unloading twice is harmless');
});

test('TileMap: an unknown handle is rejected', () => {
  const tilemap = makeTileMap();
  assert.throws(() => tilemap.GetTile(404, 0, 0, 0), /invalid tilemap handle/);
  assert.throws(() => tilemap.GetLayerCount(404), /invalid tilemap handle/);
  assert.throws(() => tilemap.GetWangData(404), /invalid tilemap handle/);
  assert.throws(() => tilemap.SetTile(404, 0, 0, 0, 1), /invalid tilemap handle/);
  assert.throws(() => tilemap.SetLayerVisibility(404, 0, true), /invalid tilemap handle/);
  assert.throws(() => tilemap.DrawLayer(404, 0, 0, 0, 0), /invalid tilemap handle/);
  assert.throws(() => tilemap.GetTileSize(404), /invalid tilemap handle/);
  assert.throws(() => tilemap.GetLayerVisibility(404, 0), /invalid tilemap handle/);
});

/* ── SFX ────────────────────────────────────────────────────────────── */

test('SFX: Create resolves a preloaded WAV resource into a handle', () => {
  const { sfx } = makeSfx();
  const h = sfx.Create('shoot');

  assert.strictEqual(h, 1);
  assert.strictEqual(sfx.sfxHandles.get(h).resourceName, 'shoot');
  assert.throws(() => sfx.Create('missing'), /SFX asset not found/);
  assert.throws(() => sfx.Create(), /missing required string argument/);
});

test('SFX: Play starts the sound and IsPlaying tracks it', async () => {
  const { sfx, audioEngine } = makeSfx();
  const h = sfx.Create('shoot');

  assert.strictEqual(sfx.IsPlaying(h), false, 'a fresh handle is not playing');
  assert.strictEqual(sfx.Play(h), true);

  await flushAsync();
  assert.ok(audioEngine.calls.some((c) => c.fn === 'startSound'));
  assert.strictEqual(sfx.IsPlaying(h), true);

  assert.strictEqual(sfx.Stop(h), true);
  assert.strictEqual(sfx.IsPlaying(h), false);
});

test('SFX: repeating playback is refused rather than silently ignored', () => {
  const { sfx } = makeSfx();
  const h = sfx.Create('shoot');
  assert.throws(() => sfx.Play(h, true), /does not support repeating/);
});

test('SFX: SetVolume clamps into 0..1', () => {
  const { sfx } = makeSfx();
  const h = sfx.Create('shoot');

  assert.strictEqual(sfx.SetVolume(h, 0.5), true);
  assert.strictEqual(sfx.sfxHandles.get(h).volume, 0.5);

  sfx.SetVolume(h, 5);
  assert.strictEqual(sfx.sfxHandles.get(h).volume, 1, 'volume above 1 clamps down');

  sfx.SetVolume(h, -5);
  assert.strictEqual(sfx.sfxHandles.get(h).volume, 0, 'negative volume clamps up');
});

test('SFX: Destroy releases the handle and List counts available assets', async () => {
  const { sfx, audioEngine } = makeSfx();
  const h = sfx.Create('shoot');

  sfx.Play(h);
  await flushAsync();

  assert.strictEqual(sfx.Destroy(h), true);
  assert.ok(audioEngine.calls.some((c) => c.fn === 'stopSound'), 'destroying a playing sound stops it');
  assert.throws(() => sfx.IsPlaying(h), /unknown handle/);

  assert.strictEqual(sfx.List(), 2);
});

/* ── Music ──────────────────────────────────────────────────────────── */

test('Music: Create resolves a preloaded MOD resource into a handle', () => {
  const { music } = makeMusic();
  const h = music.Create('theme');

  assert.strictEqual(h, 1);
  assert.strictEqual(music.musicHandles.get(h).resourceName, 'theme');
  assert.throws(() => music.Create('missing'), /Music asset not found/);
});

test('Music: Play forwards volume and loop, and IsPlaying tracks the song', async () => {
  const { music, audioEngine } = makeMusic();
  const h = music.Create('theme');

  assert.strictEqual(music.IsPlaying(h), false);
  assert.strictEqual(music.Play(h, 0.75, false), true);
  await flushAsync();

  const started = audioEngine.calls.find((c) => c.fn === 'startSong');
  assert.ok(started, 'Play must reach audioEngine.startSong');
  assert.strictEqual(started.volume, 0.75);
  assert.strictEqual(started.loop, false);
  assert.strictEqual(music.IsPlaying(h), true);
});

test('Music: loop defaults to true when the argument is omitted', async () => {
  const { music, audioEngine } = makeMusic();
  const h = music.Create('theme');

  music.Play(h);
  await flushAsync();

  const started = audioEngine.calls.find((c) => c.fn === 'startSong');
  assert.strictEqual(started.loop, true, 'music loops by default');
  assert.strictEqual(started.volume, 1, 'volume defaults to full');
});

test('Music: Stop halts playback and Destroy releases the handle', async () => {
  const { music, audioEngine } = makeMusic();
  const h = music.Create('theme');

  music.Play(h);
  await flushAsync();

  assert.strictEqual(music.Stop(h), true);
  assert.strictEqual(music.IsPlaying(h), false);
  assert.ok(audioEngine.calls.some((c) => c.fn === 'stopSong'));

  assert.strictEqual(music.Destroy(h), true);
  assert.throws(() => music.Stop(h), /unknown handle/);
});

/* ══════════════════════════════════════════════════════════════════════
   Coverage gate
   ══════════════════════════════════════════════════════════════════════ */

test('Coverage: every declared API in these categories was exercised', () => {
  const missing = [];
  for (const categoryName of COVERED_CATEGORIES) {
    for (const fnName of declaredFunctionNames(categoryName)) {
      if (!covered.has(`${categoryName}.${fnName}`)) {
        missing.push(`${categoryName}.${fnName}`);
      }
    }
  }

  assert.deepStrictEqual(
    missing,
    [],
    `${missing.length} API function(s) declared in api.json have no unit test:\n  ${missing.join('\n  ')}`,
  );
});

test('Coverage: every category with functions is claimed by a test file', () => {
  const populated = (API.categories || [])
    .filter((c) => Array.isArray(c.functions) && c.functions.length > 0)
    .map((c) => c.name);

  const unclaimed = populated.filter((name) => name !== 'Pico8' && !COVERED_CATEGORIES.includes(name));

  assert.deepStrictEqual(
    unclaimed,
    [],
    `New API categories exist with no test coverage: ${unclaimed.join(', ')}. `
    + 'Add tests here and list them in COVERED_CATEGORIES.',
  );
});

/* ══════════════════════════════════════════════════════════════════════
   Runner
   ══════════════════════════════════════════════════════════════════════ */

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function run() {
  setupGlobals();
  installD2SpriteStub();

  realLog('Running Lua API contract tests (all categories except Pico8)...\n');

  // The extensions log heavily on every call. Silence them so the test report
  // is readable; failures still surface through console.error.
  const noisyLog = console.log;
  console.log = () => {};

  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    try {
      await t.fn();
      passed += 1;
      realLog(`PASS ${t.name}`);
    } catch (error) {
      failed += 1;
      realLog(`FAIL ${t.name}`);
      realLog(`  ${error.message}`);
    }
  }

  console.log = noisyLog;

  const totalDeclared = COVERED_CATEGORIES
    .reduce((sum, name) => sum + declaredFunctionNames(name).length, 0);

  realLog(`\nAPIs covered: ${covered.size}/${totalDeclared} across ${COVERED_CATEGORIES.length} categories`);
  realLog(`${passed} passed, ${failed} failed, ${tests.length} total`);

  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { run };
