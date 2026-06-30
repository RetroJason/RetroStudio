// frameset-builder.js
// Build-time frameset processor: reads .frameset JSON metadata and emits
// a compact .d2fs binary companion for image runtime frame metadata.

console.log('[FramesetBuilder] Class definition loading');

class FramesetBuilder extends BaseBuilder {
  async build(file) {
    const tag = '[FramesetBuilder]';
    try {
      console.log(`${tag} Processing: ${file.path}`);

      const frameset = this.parseFramesetJson(file.content, file.path);
      const bytes = FramesetBuilder.buildD2FS(frameset, file.path);
      const outputPath = this.toBuildPath(file.path.replace(/\.frameset$/i, '.d2fs'));

      await this.saveBinary(outputPath, bytes);

      console.log(`${tag} Built ${outputPath}: ${bytes.length} bytes (${frameset.frames.length} frame(s))`);

      return {
        success: true,
        inputPath: file.path,
        outputPath,
        outputs: [outputPath],
        builder: 'frameset',
        meta: {
          frameCount: frameset.frames.length,
          imageWidth: frameset.imageWidth || 0,
          imageHeight: frameset.imageHeight || 0,
          d2fsSize: bytes.length,
        },
      };
    } catch (error) {
      console.error(`${tag} Failed ${file.path}: ${error.message}`);
      return {
        success: false,
        inputPath: file.path,
        error: error.message,
        builder: 'frameset',
      };
    }
  }

  parseFramesetJson(content, path) {
    let parsed;
    if (typeof content === 'string') {
      parsed = JSON.parse(content);
    } else if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
      const bytes = content instanceof ArrayBuffer
        ? new Uint8Array(content)
        : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
      parsed = JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } else {
      throw new Error(`Unexpected .frameset content type for ${path}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`Invalid .frameset JSON object: ${path}`);
    }

    if (!Array.isArray(parsed.frames) || parsed.frames.length === 0) {
      throw new Error(`Frameset has no frames: ${path}`);
    }

    return parsed;
  }

  static buildD2FS(frameset, path = 'frameset') {
    const frames = frameset.frames;
    if (frames.length > 0xFFFF) {
      throw new Error(`Too many frames for D2FS in ${path}: ${frames.length}`);
    }

    const headerSize = 16;
    const frameSize = 16;
    const buffer = new ArrayBuffer(headerSize + frames.length * frameSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    bytes[0] = 0x44; // D
    bytes[1] = 0x32; // 2
    bytes[2] = 0x46; // F
    bytes[3] = 0x53; // S
    view.setUint8(4, 1);
    view.setUint8(5, 0);
    view.setUint16(6, frames.length, true);
    this.writeUint16(view, 8, frameset.imageWidth || 0, 'imageWidth', path);
    this.writeUint16(view, 10, frameset.imageHeight || 0, 'imageHeight', path);
    view.setUint16(12, frameSize, true);

    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index] || {};
      const offset = headerSize + index * frameSize;
      const width = this.requirePositiveUint16(frame.w, `frames[${index}].w`, path);
      const height = this.requirePositiveUint16(frame.h, `frames[${index}].h`, path);
      const id = Number.isFinite(Number(frame.id)) ? Number(frame.id) : index;
      const hasCenterX = Number.isFinite(Number(frame.centerX));
      const hasCenterY = Number.isFinite(Number(frame.centerY));
      let flags = 0;

      if (hasCenterX) flags |= 0x01;
      if (hasCenterY) flags |= 0x02;

      this.writeUint16(view, offset + 0, id, `frames[${index}].id`, path);
      this.writeUint16(view, offset + 2, frame.x || 0, `frames[${index}].x`, path);
      this.writeUint16(view, offset + 4, frame.y || 0, `frames[${index}].y`, path);
      view.setUint16(offset + 6, width, true);
      view.setUint16(offset + 8, height, true);
      this.writeInt16(view, offset + 10, hasCenterX ? frame.centerX : 0, `frames[${index}].centerX`, path);
      this.writeInt16(view, offset + 12, hasCenterY ? frame.centerY : 0, `frames[${index}].centerY`, path);
      view.setUint8(offset + 14, flags);
    }

    return new Uint8Array(buffer);
  }

  static requirePositiveUint16(value, field, path) {
    const numberValue = Number(value);
    if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > 0xFFFF) {
      throw new Error(`Invalid ${field} in ${path}: ${value}`);
    }
    return numberValue;
  }

  static writeUint16(view, offset, value, field, path) {
    const numberValue = Number(value);
    if (!Number.isInteger(numberValue) || numberValue < 0 || numberValue > 0xFFFF) {
      throw new Error(`Invalid ${field} in ${path}: ${value}`);
    }
    view.setUint16(offset, numberValue, true);
  }

  static writeInt16(view, offset, value, field, path) {
    const numberValue = Number(value);
    if (!Number.isInteger(numberValue) || numberValue < -0x8000 || numberValue > 0x7FFF) {
      throw new Error(`Invalid ${field} in ${path}: ${value}`);
    }
    view.setInt16(offset, numberValue, true);
  }

  toBuildPath(uiPath) {
    if (window.ProjectPaths && typeof window.ProjectPaths.toBuildOutputPath === 'function') {
      return window.ProjectPaths.toBuildOutputPath(uiPath);
    }
    return uiPath.replace(/^Resources\//, 'build/');
  }

  async saveBinary(outputPath, bytes) {
    const fileManager = window.serviceContainer?.get('fileManager');
    if (fileManager) {
      await fileManager.saveFile(outputPath, bytes.buffer, { binaryData: true });
      return;
    }

    if (window.fileIOService) {
      await window.fileIOService.saveFile(outputPath, bytes.buffer, { binaryData: true });
      return;
    }

    throw new Error('No file service available to save D2FS build output');
  }
}

console.log('[FramesetBuilder] Class defined');

(function registerFramesetBuilder() {
  function tryRegister() {
    try {
      if (!window.serviceContainer || !window.serviceContainer.has('buildSystem')) {
        return false;
      }

      const buildSystem = window.serviceContainer.get('buildSystem');
      const builder = new FramesetBuilder();
      buildSystem.registerBuilder('.frameset', builder);
      buildSystem.builderById.set('frameset', builder);
      console.log('[FramesetBuilder] Registered with BuildSystem');
      return true;
    } catch (error) {
      console.warn(`[FramesetBuilder] BuildSystem registration attempt failed: ${error.message}`);
      return false;
    }
  }

  if (tryRegister()) return;

  if (window.serviceContainer) {
    window.serviceContainer.addEventListener('buildSystemReady', () => {
      tryRegister();
    });
  }

  let attempts = 0;
  const interval = setInterval(() => {
    if (tryRegister()) {
      clearInterval(interval);
      return;
    }

    attempts++;
    if (attempts > 100) {
      clearInterval(interval);
      console.warn('[FramesetBuilder] Gave up waiting for BuildSystem after 20s');
    }
  }, 200);
})();
