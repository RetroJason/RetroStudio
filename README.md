# RetroStudio

A retro-style game development IDE with integrated audio synthesis, visual editors, and real-time preview capabilities.

## Features

- **Sound FX Editor**: Create and edit sound effects with real-time waveform preview
- **Lua Script Editor**: Write and execute game logic  
- **MOD File Support**: Load and play MOD, XM, S3M, IT, MPTM tracker files
- **Project Explorer**: Organize and manage project assets
- **Build System**: Convert source files to final game assets with builder pattern
- **Audio Engine**: Real-time audio synthesis, mixing, and playback
- **Real-time Mixing**: Glitch-free audio mixing using Web Audio API
- **Component System**: Reusable UI components like WaveformDisplay and PlayPauseButton

## Getting Started

1. Open `index.html` in a web browser or serve via HTTP server:
   ```bash
   python -m http.server 8000
   ```
2. Open http://localhost:8000
3. Create a new project using the "Create" dropdown
4. Add sound effects, scripts, and other assets
5. Use the Build button to generate final project files

## Architecture

- **Preview vs Build**: Real-time preview for development, separate build process for final output
- **Builder Pattern**: Extensible build system (BaseBuilder, SfxBuilder, CopyBuilder)
- **Component System**: Reusable UI components extracted for modularity
- **Modern Audio**: Uses AudioWorklet and Web Workers for performance

## Dependencies

- **libopenmpt**: For MOD file decoding and playback
- **Web Audio API**: For audio processing and output
- **AudioWorklet**: For low-latency audio mixing

## Browser Compatibility

- Requires a modern browser with Web Audio API and AudioWorklet support
- Chrome 66+, Firefox 76+, Safari 14.1+
