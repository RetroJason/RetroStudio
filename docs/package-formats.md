# RetroStudio Package Formats

This document defines RetroWatch package file types and how RetroStudio currently handles them.

## Summary

- `.rwp`: Studio project archive (source of truth for editing)
- `.rwa`: Lua runtime app package for normal firmware context
- `.rwg`: Lua runtime app package for launcher game mode (max resources)
- `.rwn`: Native app package (binary/native runtime, reserved/not exported by RetroStudio yet)

All package types are ZIP-based containers with different intent and runtime handling.

## 1) `.rwp` (Retro Watch Project)

Purpose:
- Authoring/editing archive used by RetroStudio.

Contents:
- Full project source tree (under `Sources/...`)
- `rwp.json` manifest
- Embedded deployable runtime package under `runtime/`:
  - `runtime/<project>.rwa` or
  - `runtime/<project>.rwg`

Notes:
- `.rwp` is not directly executed by firmware.
- `.rwp` should be used for backup, sharing, templates, and versioning.

## 2) `.rwa` (Retro Watch App - Lua / Normal Mode)

Purpose:
- Deployable Lua app package for normal firmware runtime context.

Runtime characteristics:
- Runs in regular firmware environment.
- Standard services available (for example BLE/background features, subject to firmware policy).

Container format:
- ZIP archive.
- Created from the in-memory `build/` tree.
- Each file path inside `build/` is added to ZIP after removing the `build/` prefix.
- If `app.ini` is missing from `build/`, RetroStudio injects one.

### `.rwa` / `.rwg` Runtime File Layout

Runtime packages are content-equivalent (`.rwa` vs `.rwg` changes runtime mode, not file structure).

Typical layout:

```text
<package>.rwa
  app.ini
  palette_map.pmap                 (present when indexed palettes were registered)
  config.json                      (optional metadata file if present in Sources)

  Lua/
    *.lua

  Images/
    *.d2                           (textures)
    *.frameset                     (metadata)
    *.d2f                          (sprite frame atlas)
    *.d2s                          (sprite animation data)

  Palettes/
    *.act

  SFX/
    *.wav

  ...                              (other copied build outputs)
```

Notes:
- Directory names depend on where files live under `Sources/`; RetroStudio preserves relative subpaths.
- Unknown/unsupported source file types are copied through by the default copy builder.

### Source To Runtime Mapping

| Source (`Sources/...`) | Build output (`build/...`) | Runtime ZIP path |
|---|---|---|
| `Lua/*.lua` | copied | `Lua/*.lua` |
| `Images/*.texture` | built to `*.d2` | `Images/*.d2` |
| `Images/*.sprite` | built to `*.d2f` and `*.d2s` | `Images/*.d2f`, `Images/*.d2s` |
| `Images/*.frameset` | copied | `Images/*.frameset` |
| `Palettes/*.act` | copied | `Palettes/*.act` |
| `Palettes/*.pal`, `Palettes/*.aco` | converted to `.act` | `Palettes/*.act` |
| `SFX/*.sfx` | synthesized to `.wav` | `SFX/*.wav` |
| other files | copied | same relative path |

### `app.ini` Contract

RetroStudio emits `app.ini` from package settings (`Sources/Package/app.package`) if not already produced by build output.

Default sections/keys:

```ini
[app]
title = <project or configured title>
author = <configured author>
version = <configured version>
description = <configured description>
type = app
runtime = rwa|rwg
icon32 = <path or empty>
icon128 = <path or empty>

[display]
fps = 30
orientation = auto

[media]
screenshots = <comma-separated>
videos = <comma-separated>
```

### `palette_map.pmap` (PMAP) Binary Format

`palette_map.pmap` is generated after build when indexed texture palettes are registered.

Header:

| Offset | Size | Type | Description |
|---|---|---|---|
| 0 | 4 | char[4] | Magic `PMAP` |
| 4 | 1 | uint8 | Version (`1`) |
| 5 | 1 | uint8 | Reserved (`0`) |
| 6 | 2 | uint16 LE | Palette count |

Palette records (repeated `count` times, 1-based index order):

| Relative Offset | Size | Type | Description |
|---|---|---|---|
| +0 | 2 | uint16 LE | Color count |
| +2 | `colorCount * 4` | bytes | RGBA entries (`R`, `G`, `B`, `0xFF`) |

Semantics:
- D2TX header field `paletteIndex` is 1-based into PMAP (`0` means none).
- PMAP record order is the authoritative index mapping.
- This file is expected at package root (`palette_map.pmap`) and referenced by runtime D2 metadata.

### Related Texture Header Fields (D2TX)

For indexed textures, D2TX header fields used with PMAP are:

| Offset | Size | Field |
|---|---|---|
| 10 | 2 | `paletteIndex` (uint16 LE, 1-based PMAP index, `0` = none) |
| 12 | 1 | `paletteOffset` (uint8) |

For full D2TX layout details, see `retrostudio-d2tx-format.md` in repository memory and the texture build pipeline.

## 3) `.rwg` (Retro Watch Game - Lua / Launcher Mode)

Purpose:
- Deployable Lua app package for high-performance launcher mode.

Runtime characteristics:
- Launched through a special launcher app/profile.
- Non-essential services disabled where possible.
- Maximum clock/resources directed to the Lua app.
- Content format is otherwise equivalent to `.rwa`.

## 4) `.rwn` (Retro Watch Native)

Purpose:
- Deployable native app package.

Runtime characteristics:
- Native/binary payload, not Lua script runtime.
- Firmware itself is effectively an `.rwn`-class artifact.
- RetroStudio does not currently export `.rwn` packages.

## Shared Packaging Concept

All package types are ZIP containers. RetroStudio currently assembles runtime packages from build outputs (`build/...`) and writes metadata to `app.ini`.

## Package Settings in RetroStudio

RetroStudio stores package settings in:
- `Sources/Package/app.package`

Settings include:
- `packageKind`: `rwa` | `rwg`
- app metadata: title, author, version, description
- icon references:
  - `icon32` (32x32)
  - `icon128` (128x128)
- screenshots array
- videos array

## Assets and Metadata Requirements

Recommended metadata assets:
- App icon 32x32 (firmware default palette)
- App icon 128x128 (firmware default palette)
- Screenshots (upload or simulator capture)
- Videos (upload or simulator capture)

Suggested project asset location:
- `Sources/Package/icons/...`
- `Sources/Package/screenshots/...`
- `Sources/Package/videos/...`

## Build / Export Behavior

- `Build` button:
  - Builds project outputs.
  - Shows build summary popup.
- `Export Runtime` button:
  - Builds outputs.
  - Exports runtime package according to `packageKind` (`.rwa/.rwg`).
  - Does not show the Build-button summary popup.
- `Export RWP` button:
  - Exports source project archive.
  - Also embeds generated runtime package inside `runtime/`.

## Notes for Firmware/Launcher

- `.rwa` and `.rwg` are both Lua app packages; launcher behavior determines mode.
- `.rwn` handling is runtime-specific to native app loader policy and is not currently emitted by RetroStudio.
- Metadata fields in `app.ini` should be treated as contract points and can be extended in future revisions.
