# RetroStudio — Codebase Analysis & Improvement Plan

*Audit date: 2 March 2026*

---

## 1. What RetroStudio Is

RetroStudio is a **browser-based IDE** for authoring Lua applications that run on
the RetroWatch DA1470x smartwatch (Cortex-M33, 368×448 LCD, Dave2D GPU).
It ships as a single `index.html` with ~50 `<script>` tags — no bundler, no
framework, no node/npm dependency chain.

### High-Level Block Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  index.html  (entry point, DOM layout, script tags)         │
├──────────────┬──────────────┬───────────────────────────────┤
│  Core Layer  │  UI Layer    │  Runtime Layer                │
│              │              │                               │
│ ServiceCont. │ ProjectExpl. │ GameEmulator                  │
│ EventBus     │ TabManager   │   ├─ lua.vm.js (Lua 5.3 VM)  │
│ ConfigMgr    │ RibbonBar    │   ├─ LuaExtensionLoader       │
│ PluginSys    │ Editors/     │   ├─ GameInputManager          │
│ CompRegistry │  Viewers     │   └─ GameConsole               │
│ ProjectPaths │              │                               │
├──────────────┴──────────────┤  AudioEngine                  │
│  Persistence                │   ├─ MixerWorklet (AudioWorklet)│
│  FileIOService (IndexedDB)  │   └─ OpenMPT Worker (WASM)    │
│  RwpService (JSZip)         │                               │
├─────────────────────────────┼───────────────────────────────┤
│  Build Pipeline             │  Graphics / Asset Pipeline     │
│  BuildSystem                │  ImageData (color reduction,   │
│  CopyBuilder                │    Dave2D binary generation)  │
│  SfxBuilder (jsfxr→WAV)    │  Palette (ACT/PAL/ACO I/O)   │
│  PalBuilder                 │  TextureEditor / TextureData  │
└─────────────────────────────┴───────────────────────────────┘
```

---

## 2. Architecture

### 2.1 Bootstrap Sequence

`RetroStudioApplication` (core/application.js) orchestrates startup:

1. **initializeCore()** — ServiceContainer + EventBus (global singletons)
2. **loadConfiguration()** — ConfigManager loads schemas
3. **initializeServices()** — Registers AudioEngine, ResourceManager,
   BuildSystem, ProjectExplorer, TabManager, RwpService,
   MonacoIntelliSenseService as singletons
4. **registerComponents()** — Dynamically loads editor + viewer scripts
5. **initializePlugins()** — PluginSystem runs hooks
6. **setupUI()** — RibbonToolbar creation
7. **startSystems()** — Creates GameEmulator instance

### 2.2 Core Infrastructure

| Module | File | Role |
|--------|------|------|
| ServiceContainer | `core/service-container.js` | DI container with singleton/factory registration, `waitForService()` |
| EventBus | `core/event-bus.js` | `TypedEventBus` with priority, middleware, schema validation |
| ConfigManager | `core/config-manager.js` | Schema-validated config with watchers & persistence |
| PluginSystem | `core/plugin-system.js` | Hook-based plugin architecture |
| ComponentRegistry | `core/component-registry.js` | Maps file extensions → editor/viewer classes |
| ProjectPaths | `core/project-paths.js` | Path normalization (`Sources/` ↔ storage, `build/` prefix) |

### 2.3 Persistence

**FileIOService** (`file-io-service.js`) wraps IndexedDB. Single object store
`'files'` with `keyPath: 'path'`. All binary content stored as **base64 strings**.
Initialized with `clearOnStartup: true`. Helper methods filter by category:
`getSourceScripts()`, `getSourcePalettes()`, `getSourceAudio()`,
`getSourceImages()`, `getGameObjectSfx()`, `getBuildFiles()`.

### 2.4 Project Structure

ProjectExplorer (`project-explorer.js`, 3187 lines) manages a tree:

```
{ProjectName}/
├── Sources/
│   ├── Music/     (.mod, .xm, .s3m, .it, .mptm)
│   ├── SFX/       (.sfx, .wav)
│   ├── Images/    (.png, .jpg, .bmp, .gif)
│   ├── Palettes/  (.pal, .act, .aco)
│   ├── Lua/       (.lua)
│   └── Binary/    (anything)
└── Game Objects/  (build output → maps to build/ prefix in IndexedDB)
```

---

## 3. Build Pipeline

### 3.1 Build System

`BuildSystem` (`build-system.js`, 966 lines) runs three registered builders:

| Builder | Trigger Extensions | Output |
|---------|-------------------|--------|
| `CopyBuilder` | `*` (default) | Copies source → `build/` prefix. Auto-detects text vs binary. |
| `SfxBuilder` | `.sfx` | Parses jsfxr JSON params → generates **16-bit PCM WAV** |
| `PalBuilder` | `.pal`, `.act`, `.aco` | Copies palette files to `build/` |

**Flow**: `buildProject()` → save dirty editors → clear `build/` → walk
ProjectExplorer tree → run matching builder per file → store output with
`build/` prefix in IndexedDB.

### 3.2 .rwp Format (Project Archive)

`RwpService` (`services/rwp-service.js`) uses JSZip + DEFLATE-6 for
import/export of full project snapshots.

Manifest (`rwp.json`):
```json
{
  "format": "retro-watch-project",
  "version": 2,
  "projectName": "...",
  "sourcesRoot": "Sources",
  "createdAt": "ISO-8601",
  "files": [
    { "path": "relative/path", "builderId": "copy|sfx|pal", "binary": true|false }
  ]
}
```

### 3.3 .rwa Format — DOES NOT EXIST YET

**There is no .rwa packaging step.** The build pipeline produces individual
files in the IndexedDB `build/` namespace but never bundles them into a
deployable archive. This is the critical missing piece for firmware deployment.

---

## 4. Game Emulator / Runtime

### 4.1 Emulator Core

`GameEmulator` (`game-emulator/game-emulator.js`, 2551 lines)

**Launch flow** (`playProject()`):
1. `BuildSystem.buildProject()` — compile all assets
2. Concatenate all `.lua` from `build/` (alphabetical, `main.lua` prepended)
3. Load `lua.vm.js` dynamically → `new window.Lua.State()`
4. Override Lua `print()` → GameConsole
5. Scan build files → create resource ID constants
   (e.g., `build/SFX/cool.wav` → global `SFX.COOL`)
6. Preload all audio into AudioEngine
7. Load Lua extensions via `LuaExtensionLoader`
8. Execute concatenated Lua
9. Call Lua `Setup()`, validate `Update()` exists
10. Start game loop (~60 fps via `requestAnimationFrame` + `setTimeout`)

**Game loop**: Each frame calls `GameInputManager.updateFrame()` then
Lua `Update(deltaTime)`.

### 4.2 Input System

`GameInputManager` (`input/game-input-manager.js`, 435 lines)

Keyboard → button bitmask mapping matching firmware:

| Keyboard | Button | Bit |
|----------|--------|-----|
| Z | B | 0x0001 |
| X | A | 0x0100 |
| A | Y | 0x0002 |
| S | X | 0x0200 |
| Arrows | D-pad | 0x0010–0x0080 |
| Enter | Start | 0x0008 |
| Space | Select | 0x0004 |
| L/R Shift | L/R | 0x0400/0x0800 |

Per-frame state: `held`, `pressed` (edge), `released` (edge).

### 4.3 Lua VM & Extensions

Uses `lua.vm.js` (NOT Fengari). JS↔Lua bridge via `js.global`.

`LuaExtensionLoader` reads `extensions.json` → loads each extension JS →
calls `registerMethod()` which creates:
1. A global JS function: `window[ClassName_MethodName_Impl]`
2. A Lua wrapper: `function ClassName.MethodName(...)`

**Implemented extensions:**

| Extension | Firmware Equivalent | Functions |
|-----------|-------------------|-----------|
| SFX | `Sfx` | Play, Stop, IsPlaying, SetVolume, List |
| Music | `Song` | Play, Stop |
| Input | `Button` | GetKeysHeld/Pressed/Released, IsKeyHeld/Pressed/Released |
| Math | (Lua stdlib) | Sin, Cos, Sqrt, Clamp, Bitwise ops, Random, etc. |
| Time | (RTC) | Hours/Minutes/Seconds/Day/Month/Year, ToDegrees |
| System | `System` | LogLua (print) |
| UI | — | **Empty — no implementation** |
| Graphics | — | **Empty — no implementation** |

### 4.4 Canonical Firmware Lua API

Defined in `lua/lua_interface.md` (930 lines). **Much larger** than JS:

- **Info**: SetTitle, SetAuthor, SetVersion, SetDescription
- **Sprite**: New, Delete, Clone, SetAnimation, UpdateAnimation + full
  transform API (Position, Size, Rotation, Scale, Color, PaletteSlot,
  Visible, TextureUV, Attributes)
- **Mask**: New, Delete, IsHit + transform API
- **TextBox**: AddText, SetText + transform API
- **TileMap**: CopyTiles, SetTileData, ScreenClamp + transform API
- **System**: GetScreenSize, SetFrameRate, GetFrameRate, ScreenWidth, ScreenHeight
- **Sfx**: Play(index)
- **Song**: Play(name), Stop()
- **Button**: Bitmask enum (B=0x0001 .. R=0x0800)

---

## 5. Audio System

### 5.1 Architecture

```
Lua SFX.Play(id) / Music.Play(id)
        ↓
   AudioEngine (audio-api.js, 659 lines)
        ├─ WAV path:   decodeAudioData() → Float32 → AudioWorklet
        └─ MOD path:   Data → Web Worker (OpenMPT WASM) → PCM Float32 → AudioWorklet
                            ↓
                    MixerWorklet (mixer-worklet.js)
                            ↓
                    AudioContext.destination
```

**Formats**: WAV, MOD, XM, S3M, IT, MPTM

**Controls**: `setMasterVolume()`, `setSongVolume()`, `startSong()`,
`stopSong()`, `pauseSong()`, `startSound()`, `stopSound()`,
`stopAllAudio()`, `emergencyAudioStop()` (disconnects AudioWorklet as
last resort).

### 5.2 SFX Builder

`.sfx` files are jsfxr parameter JSON → `SfxBuilder` generates 16-bit PCM
WAV at build time. On firmware, the WAV is what gets loaded.

---

## 6. Graphics & Asset Pipeline

### 6.1 Palette System

`Palette` class (`graphics/palette.js`, 528 lines):
- **Import**: `.pal` (GIMP/JASC text), `.act` (Adobe Color Table — 768 bytes
  RGB + 2-byte count + 2-byte transparency = 772 bytes), `.aco` (text)
- **Export**: Always `.act` for firmware. PAL also available.
- **Ops**: get/set/add/remove, sortByHue/Brightness, clone, extractFromImage

### 6.2 Image Processing

`ImageData` class (`graphics/image.js`, 1993 lines):
- Multi-frame support (sprite sheets / animations)
- **Color reduction**: Median-cut (async with progress UI) or simple-sample
- **Palette matching**: Map image colors to existing palette with offset
- **Binary output**: `getBinaryData(format, palette)` generates raw bytes
  in Dave2D GPU pixel format

### 6.3 Dave2D GPU Pixel Formats

19 supported output formats:

| Category | Formats |
|----------|---------|
| **Indexed** | i1 (1bpp), i2 (2bpp), i4 (4bpp), i8 (8bpp), ai44 |
| **Direct RGB** | rgb565, argb1555, rgba5551, rgb555, argb4444, rgba4444, rgb444, rgb888, rgba8888, argb8888 |
| **Alpha** | alpha1, alpha2, alpha4, alpha8 |

Binary generation implemented for: i8, i4, i2, i1, rgb565, argb1555,
rgba8888. Others fall back to RGBA8888.

### 6.4 Texture Editor

`TextureEditor` (`editors/texture-editor.js`, 3642 lines):
- `TextureData` model: sourceImagePath, palettePath, outputPixelFormat
  (default `d2_mode_i8`), scale, paletteOffset, animation frames
- Loads source PNG → color reduction → palette matching → binary output
- Auto-populates palette from project
- Live preview with Dave2D format output

---

## 7. Critical Gaps

### 7.1 No .rwa Format

The IDE builds assets into IndexedDB files. There is no step that packages
them into a deployable `.rwa` archive for the watch. This must be added to
both RetroStudio (export) and the firmware (import/load).

### 7.2 No Emulator Rendering

The emulator **cannot render anything**. Sprite, TileMap, TextBox, and Mask
are all defined in the firmware Lua API doc but have zero JS implementation.
The game canvas shows placeholder text "Game running... (simulated)".

### 7.3 Lua API Coverage

Only 6 of ~12 API categories are implemented in JS:

| Category | JS | Firmware | Gap |
|----------|----|----------|-----|
| SFX | ✅ | ✅ | Minor differences (JS has more params) |
| Music/Song | ✅ | ✅ | OK |
| Input/Button | ✅ | ✅ | OK |
| Math | ✅ | ✅ | OK (JS provides more functions) |
| Time | ✅ | ✅ | OK |
| System | ✅ | ✅ | Partial — JS only has Log |
| Sprite | ❌ | ✅ | **Entire subsystem missing** |
| Mask | ❌ | ✅ | **Entire subsystem missing** |
| TileMap | ❌ | ✅ | **Entire subsystem missing** |
| TextBox | ❌ | ✅ | **Entire subsystem missing** |
| Info | ❌ | ✅ | **Missing** |
| UI | ❌ | ❌ | Empty on both sides |

### 7.4 Build Output Does Not Include Textures

The `TextureEditor` can produce Dave2D binary data, but no builder
automatically processes `.texture` metadata files during a full project build.
Textures are edited interactively but their binary output isn't piped into
the build artifacts.

---

## 8. Improvement Recommendations

### P0 — Blocking (needed for firmware .rwa loading)

**8.1 Define and implement the .rwa format**

Add an `RwaBuilder` (or extend `BuildSystem`) that, after `buildProject()`:
1. Walks the `build/` namespace
2. Packs all files into a **ZIP** (consistent with .rwp, using JSZip)
3. Includes a `manifest.json` with:
   - format version
   - entry script name (`main.lua`)
   - resource table mapping resource IDs → paths + types + sizes
   - palette assignments per texture
   - target screen dimensions
4. Triggers download as `{projectName}.rwa`

On the firmware side, the loader would:
1. Open .rwa from SD card via FatFS
2. Use miniz/unzip to enumerate entries
3. Load `manifest.json` → parse with a tiny JSON parser or fixed-field binary header
4. Load `main.lua` (and any additional .lua files) into the Lua VM
5. Register resource file offsets for lazy loading of textures/audio

**8.2 Add a `TextureBuilder`**

Register a builder for `.texture` metadata files that:
1. Reads the TextureData JSON
2. Loads the referenced source image
3. Applies palette matching + color reduction
4. Outputs the Dave2D binary (`build/{name}.bin`) + metadata
This completes the asset pipeline so textures reach `.rwa`.

### P1 — High Value

**8.3 Implement Canvas Rendering in Emulator**

Even a basic 2D Canvas implementation of Sprite/TileMap/TextBox would let
developers preview their apps without deploying to hardware. Approach:
- Create a `RenderEngine` class with a sorted display list
- Sprites: draw indexed-color images to `<canvas>` via `putImageData()`
  or pre-rendered `OffscreenCanvas` textures
- TileMaps: render visible tile range with camera offset
- TextBox: use `ctx.fillText()` with bitmap font rendering
- Mask: invisible collision rectangles, implement `IsHit()` with
  point-in-rect/point-in-rotated-rect

**8.4 Unify the Two Extension Systems**

`scripts/lua/` and `scripts/lua-extensions/` both have `extensions.json`
and a `ui.js`. The second one appears orphaned. Merge or delete.

**8.5 Replace Base64 Storage with ArrayBuffer/Blob**

FileIOService stores all binary data as base64 strings in IndexedDB.
IndexedDB natively supports `ArrayBuffer` and `Blob`. Switching would:
- Reduce storage size by ~33%
- Eliminate encode/decode overhead
- Simplify the binary detection heuristics in CopyBuilder

### P2 — Code Quality

**8.6 ProjectExplorer is too large (3187 lines)**

Split into:
- `ProjectTree` — pure data model (nodes, add/remove/move)
- `ProjectTreeView` — DOM rendering, drag-drop, context menus
- `ProjectFileOps` — file upload, rename, delete with storage coordination

**8.7 GameEmulator is too large (2551 lines)**

Split into:
- `GameRuntime` — Lua VM lifecycle, script concatenation, resource mapping
- `GameLoop` — frame timing, pause/resume, FPS tracking
- `GameUI` — emulator panel DOM, toolbar, canvas management

**8.8 TextureEditor is too large (3642 lines)**

Split into:
- `TextureData` model (already partially extracted)
- `TextureProcessingPipeline` — color reduction, palette matching, binary gen
- `TextureEditorUI` — preview panels, controls, toolbar

**8.9 build-system.js is too large (966 lines)**

Extract builders into their own files:
- `builders/copy-builder.js`
- `builders/sfx-builder.js`
- `builders/pal-builder.js`
- (future) `builders/texture-builder.js`
- (future) `builders/rwa-builder.js`

**8.10 Global `window.*` pollution**

services-container, event-bus, etc. all attach to `window`. The DI
container exists specifically to avoid this. Migrate remaining consumers
to use `serviceContainer.get()` and remove global exports.

**8.11 No error boundaries**

The game loop has a try/catch around `Update()` but many async operations
(file I/O, audio loading, build steps) do not have consistent error
handling. Add error boundaries at:
- Build pipeline (per-file with continue-on-error + error summary)
- Audio preloading (skip bad files with warning)
- Lua execution (Show error in GameConsole with file:line)

**8.12 No unit tests**

Zero test files. Priority targets:
- Palette import/export (ACT binary format correctness)
- ImageData color reduction and binary output
- SfxBuilder WAV generation
- BuildSystem file routing
- Path normalization (ProjectPaths)

### P3 — Nice to Have

**8.13 Add ESLint + Prettier**

No linter config exists. The codebase mixes formatting styles. Add
`.eslintrc.json` + `.prettierrc` with a standard config.

**8.14 Consider a module bundler**

50+ `<script>` tags with implicit load ordering is fragile. Even a
minimal bundler (esbuild, Vite) would add:
- Import/export instead of globals
- Tree-shaking of dead code
- Source maps for debugging
- Hot module reload for development

**8.15 Monaco IntelliSense for Firmware API**

`MonacoIntelliSenseService` is registered but its implementation should
auto-generate completion data from `lua_interface.md` so that
Sprite.New(), TileMap.SetTileData(), etc. auto-complete in the Lua editor.

**8.16 Add a .rwa "Run on Device" button**

After building .rwa, use WebSerial or WebUSB to push it to the watch
over USB CDC. The firmware already has a CDC interface — this would
enable one-click deploy from the IDE.

---

## 9. .rwa Format Proposal (for firmware discussion)

Given that `.rwp` already uses JSZip/DEFLATE, the `.rwa` should follow
the same convention for tooling consistency:

```
app.rwa (ZIP archive)
├── manifest.json          ← app metadata + resource table
├── main.lua               ← entry script (always present)
├── [*.lua]                ← additional scripts (optional)
├── Palettes/
│   └── *.act              ← 772-byte Adobe Color Tables
├── Textures/
│   └── *.bin              ← raw Dave2D pixel data (format in manifest)
├── SFX/
│   └── *.wav              ← 16-bit PCM WAV
├── Music/
│   └── *.mod|.xm|.it     ← tracker music
└── Binary/
    └── *                  ← arbitrary data files
```

`manifest.json`:
```json
{
  "format": "retro-watch-app",
  "version": 1,
  "name": "My Game",
  "author": "...",
  "description": "...",
  "targetVersion": "0.2.0",
  "screenWidth": 368,
  "screenHeight": 448,
  "entryScript": "main.lua",
  "scripts": ["main.lua", "enemies.lua", "ui.lua"],
  "resources": [
    {
      "id": "SFX.JUMP",
      "type": "sfx",
      "path": "SFX/jump.wav"
    },
    {
      "id": "MUSIC.LEVEL1",
      "type": "music",
      "path": "Music/level1.mod"
    },
    {
      "id": "IMAGES.PLAYER",
      "type": "texture",
      "path": "Textures/player.bin",
      "format": "d2_mode_i8",
      "width": 32,
      "height": 32,
      "palette": "Palettes/main.act",
      "paletteOffset": 0,
      "frames": 4,
      "frameWidth": 32,
      "frameHeight": 32
    }
  ]
}
```

This format is:
- **Simple to parse on firmware** — miniz extracts files, cJSON parses manifest
- **Toolchain agnostic** — ZIP is universal
- **Consistent** with the existing .rwp project format
- **Extensible** — new resource types just add manifest entries
