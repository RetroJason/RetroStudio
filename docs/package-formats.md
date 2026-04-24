# RetroStudio Package Formats

This document defines RetroWatch package file types and how RetroStudio currently handles them.

## Summary

- `.rwp`: Studio project archive (source of truth for editing)
- `.rwa`: Lua runtime app package for normal firmware context
- `.rwn`: Native app package (binary/native runtime, reserved/not exported by RetroStudio yet)

All package types are ZIP-based containers with different intent and runtime handling.

## 1) `.rwp` (Retro Watch Project)

Purpose:
- Authoring/editing archive used by RetroStudio.

Contents:
- Full project source tree (under `Sources/...`)
- `package.ini` manifest at archive root
- `rwp.json` manifest
- Embedded deployable runtime package under `runtime/`:
  - `runtime/<project>.rwa`

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

### `.rwa` Runtime File Layout

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

### `package.ini` Contract

RetroStudio emits `package.ini` at the `.rwp` root from package settings (`Sources/Package/app.package`).

This file is the cloud ingest contract and must match the Retrowww schema.

Required data now includes:

- `unique_id`
- `category`
- `target_device_slug`
- `version_code`
- `short_description`
- `long_description`
- `icon_path`
- `runtime_package`

Additional packaging rule:

- `[display].videos` must contain supported YouTube URLs only. Local uploaded video files may remain in the project for preview, but RetroStudio should not emit archive-relative video paths into `package.ini` because Retrowww rejects them.

`app.ini` remains a runtime package concern for `.rwa` export.

### Runtime `app.ini` Contract

RetroStudio still emits `app.ini` into `.rwa` when runtime build output does not provide one.

Default sections/keys:

```ini
[app]
title = <project or configured title>
author = <configured author>
version = <configured version>
description = <configured description>
type = <configured category>
runtime = rwa

[display]
fps = 30
orientation = auto

[media]
screenshots = <comma-separated>
videos = <comma-separated>
```

`type` is emitted from package settings `category` (for example `watch`, `low_power_watch`, `lua_app`, or `lua_game`). RetroStudio now fails export if it has to synthesize `app.ini` and no category is configured. Watch-face runtime packages (`watch`, `low_power_watch`) omit runtime icon fields entirely, because device install should not consume the package icon from `.rwa` metadata.

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

## 3) `.rwn` (Retro Watch Native)

Purpose:
- Deployable native app package.

Runtime characteristics:
- Native/binary payload, not Lua script runtime.
- Firmware itself is effectively an `.rwn`-class artifact.
- RetroStudio does not currently export `.rwn` packages.

## Shared Packaging Concept

All package types are ZIP containers. RetroStudio assembles runtime packages from build outputs (`build/...`), writes runtime metadata to `app.ini`, and writes cloud ingest metadata to `.rwp/package.ini`.

## Package Settings in RetroStudio

RetroStudio stores package settings in:
- `Sources/Package/app.package`

Settings include:
- `packageKind`: `rwa`
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
  - Exports runtime package as `.rwa`.
  - Does not show the Build-button summary popup.
- `Export RWP` button:
  - Exports source project archive.
  - Writes root `package.ini` for Retrowww ingest.
  - Also embeds generated runtime package inside `runtime/`.

- `Publish` button:
  - Builds a `.rwp` package.
  - Wraps it into a `.rws` workspace package.
  - Sends `.rws` to Retrowww project storage and `.rwp` to the publish hook.
  - Retrowww does not accept direct `.rwa` or `.rwb` website uploads.

## Notes for Firmware/Launcher

- `.rwn` handling is runtime-specific to native app loader policy and is not currently emitted by RetroStudio.
- Metadata fields in `.rwp/package.ini` are the Retrowww cloud contract and should be kept aligned with `Docs/package-ini-spec.md` in the host repository.
