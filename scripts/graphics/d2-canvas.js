/**
 * D2Canvas — WebGL 2 renderer for all DA1470x D2 texture formats.
 *
 * Architecture
 * ────────────
 *  • The GPU holds textures in their NATIVE binary format (Uint8 data textures).
 *  • A fragment shader performs the format decode per-pixel, so sub-byte indexed
 *    formats (i1 / i2 / i4) and packed 16-bit formats are all handled on the GPU.
 *  • Palette lookup is done via a 256×1 RGBA texture (the "palette texture").
 *  • A color-key (RGB-565 value) can be set; any pixel matching the key
 *    is discarded (alpha → 0). Works for all formats including indexed.
 *  • Pre-rotated textures (90° CW) are automatically un-rotated during blit.
 *  • Blit supports translate / scale / rotate with nearest or bilinear filtering
 *    and optional 4× MSAA-style anti-aliasing (super-sample).
 *
 * Public API
 * ──────────
 *  const gpu = new D2Canvas(canvas);       // canvas = existing <canvas> element
 *  gpu.resize(w, h);                       // set output resolution
 *  gpu.clear(r, g, b, a);                  // clear framebuffer
 *
 *  // Palette
 *  gpu.setPalette(rgba8Array);             // Uint8Array 256×4 = 1024 bytes
 *  gpu.setPaletteOffset(offset);           // sub-palette start for sub-8-bit modes
 *
 *  // Texture upload
 *  const tex = gpu.createTexture(d2Bytes); // raw .d2 file bytes (with 32-byte header)
 *  gpu.deleteTexture(tex);
 *
 *  // Color key — global override (per-texture key is read from D2TX header)
 *  gpu.setColorKey(rgb565);                // 0x0000 – 0xFFFF, or -1 to disable
 *
 *  // Blit
 *  gpu.blit(tex, {
 *    x, y,                                 // destination position (px)
 *    scaleX, scaleY,                       // default 1.0
 *    rotation,                             // degrees, CW
 *    pivotX, pivotY,                       // rotation centre in tex coords (default 0.5)
 *    srcX, srcY, srcW, srcH,              // source rect (default full)
 *    filter: 'nearest' | 'bilinear',       // default 'nearest'
 *    aa: false,                            // 4× supersampled AA
 *  });
 *
 *  gpu.present();                          // flush to screen (swaps frame if needed)
 *  gpu.destroy();
 *
 * Format enum → decode strategy (matches D2TX header byte 5):
 *  0x01  i1          1 bpp indexed   → unpack bit, palette lookup
 *  0x02  i2          2 bpp indexed   → unpack 2-bit, palette lookup
 *  0x04  i4          4 bpp indexed   → unpack nibble, palette lookup
 *  0x08  i8          8 bpp indexed   → direct palette lookup
 *  0x09  ai44        4+4 bpp         → lo-nibble palette + hi-nibble alpha
 *  0x10  rgb565      16 bpp          → 5-6-5 unpack
 *  0x11  argb1555    16 bpp          → 1-5-5-5 unpack
 *  0x12  rgba5551    16 bpp          → 5-5-5-1 unpack
 *  0x13  rgb555      16 bpp          → 5-5-5 unpack (A=1)
 *  0x14  argb4444    16 bpp          → 4-4-4-4 unpack
 *  0x15  rgba4444    16 bpp          → 4-4-4-4 unpack
 *  0x16  rgb444      16 bpp          → 4-4-4 unpack (A=1)
 *  0x20  rgb888      24 bpp          → direct
 *  0x21  rgba8888    32 bpp          → direct
 *  0x22  argb8888    32 bpp          → swizzle
 *  0x30  alpha1      1 bpp alpha     → unpack bit, white + alpha
 *  0x31  alpha2      2 bpp alpha     → unpack 2-bit, white + alpha
 *  0x32  alpha4      4 bpp alpha     → unpack nibble, white + alpha
 *  0x33  alpha8      8 bpp alpha     → white + alpha
 */

/* ═══════════════════════════════════════════════════════════════════════
   D2TX Header Constants
   ═══════════════════════════════════════════════════════════════════════ */
const D2TX_HEADER_SIZE = 32;
const D2TX_MAGIC       = 0x58543244; // "D2TX" read as LE uint32

const D2_FORMAT = {
  I1:       0x01,
  I2:       0x02,
  I4:       0x04,
  I8:       0x08,
  AI44:     0x09,
  RGB565:   0x10,
  ARGB1555: 0x11,
  RGBA5551: 0x12,
  RGB555:   0x13,
  ARGB4444: 0x14,
  RGBA4444: 0x15,
  RGB444:   0x16,
  RGB888:   0x20,
  RGBA8888: 0x21,
  ARGB8888: 0x22,
  ALPHA1:   0x30,
  ALPHA2:   0x31,
  ALPHA4:   0x32,
  ALPHA8:   0x33,
};

const BITS_PER_PIXEL = {
  [D2_FORMAT.I1]:       1,
  [D2_FORMAT.I2]:       2,
  [D2_FORMAT.I4]:       4,
  [D2_FORMAT.I8]:       8,
  [D2_FORMAT.AI44]:     8,
  [D2_FORMAT.RGB565]:   16,
  [D2_FORMAT.ARGB1555]: 16,
  [D2_FORMAT.RGBA5551]: 16,
  [D2_FORMAT.RGB555]:   16,
  [D2_FORMAT.ARGB4444]: 16,
  [D2_FORMAT.RGBA4444]: 16,
  [D2_FORMAT.RGB444]:   16,
  [D2_FORMAT.RGB888]:   24,
  [D2_FORMAT.RGBA8888]: 32,
  [D2_FORMAT.ARGB8888]: 32,
  [D2_FORMAT.ALPHA1]:   1,
  [D2_FORMAT.ALPHA2]:   2,
  [D2_FORMAT.ALPHA4]:   4,
  [D2_FORMAT.ALPHA8]:   8,
};

/* ═══════════════════════════════════════════════════════════════════════
   Shader source
   ═══════════════════════════════════════════════════════════════════════ */

const VERT_SRC = `#version 300 es
precision highp float;

// Per-blit uniforms
uniform vec2  u_dstPos;      // dest top-left in pixels
uniform vec2  u_dstSize;     // dest size in pixels (after scale)
uniform vec2  u_canvasSize;  // output canvas size in pixels
uniform float u_rotation;    // radians CW
uniform vec2  u_pivot;       // rotation pivot in [0..1] of dst rect

// Fullscreen quad: 4 verts, no VBO needed
// gl_VertexID: 0=TL, 1=TR, 2=BL, 3=BR
void main() {
  // Quad corner in [0..1]
  vec2 corner = vec2(
    (gl_VertexID & 1) == 1 ? 1.0 : 0.0,
    (gl_VertexID & 2) == 2 ? 1.0 : 0.0
  );

  // Position in dest pixel coords
  vec2 pos = u_dstPos + corner * u_dstSize;

  // Apply rotation around pivot
  if (u_rotation != 0.0) {
    vec2 pivotPx = u_dstPos + u_pivot * u_dstSize;
    vec2 d = pos - pivotPx;
    float c = cos(u_rotation);
    float s = sin(u_rotation);
    pos = pivotPx + vec2(d.x * c - d.y * s, d.x * s + d.y * c);
  }

  // Convert to clip space [-1..+1], Y flipped for canvas
  gl_Position = vec4(
    (pos / u_canvasSize) * 2.0 - 1.0,
    0.0, 1.0
  );
  // Flip Y so (0,0) is top-left
  gl_Position.y = -gl_Position.y;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

// ── Blit uniforms ───────────────────────────────────────────────
uniform vec2  u_dstPos;
uniform vec2  u_dstSize;
uniform vec2  u_canvasSize;
uniform vec2  u_srcUV0;
uniform vec2  u_srcUV1;
uniform float u_rotation;
uniform vec2  u_pivot;

// ── Texture uniforms ────────────────────────────────────────────
uniform usampler2D u_texData;   // raw pixel data as R8UI (1-component unsigned)
uniform sampler2D  u_palette;   // 256×1 RGBA8 palette texture
uniform int   u_format;         // D2TX format enum
uniform int   u_texWidth;       // texture width in pixels
uniform int   u_texHeight;      // texture height in pixels
uniform int   u_texStride;      // bytes per row (for sub-byte formats, ceil)
uniform int   u_palOffset;      // palette offset for sub-8-bit indexed modes
uniform int   u_colorKey;       // RGB565 color key (-1 = disabled)
uniform bool  u_filter;         // true = bilinear, false = nearest
uniform bool  u_aa;             // true = 4× SSAA
uniform bool  u_preRotated;     // true = texture stored rotated 90° CW

out vec4 fragColor;

// ── Helpers ─────────────────────────────────────────────────────

// Fetch a single byte from the data texture.
// The texture is uploaded as R8UI with width = stride, height = texHeight.
// So (byteX, byteY) maps to texelFetch(u_texData, ivec2(byteX, byteY), 0).r
uint fetchByte(int byteOffset) {
  int y = byteOffset / u_texStride;
  int x = byteOffset - y * u_texStride;
  return texelFetch(u_texData, ivec2(x, y), 0).r;
}

// Decode a single pixel at (px, py) → RGBA [0..1]
vec4 decodePixel(int px, int py) {
  int pixelIndex = py * u_texWidth + px;

  // ── Indexed 1-bit ──
  if (u_format == 0x01) {
    int byteOff = pixelIndex / 8;
    int bitIdx  = 7 - (pixelIndex & 7);
    uint b = fetchByte(byteOff);
    int idx = int((b >> uint(bitIdx)) & 1u) + u_palOffset;
    return texelFetch(u_palette, ivec2(idx, 0), 0);
  }
  // ── Indexed 2-bit ──
  if (u_format == 0x02) {
    int byteOff = pixelIndex / 4;
    int shift   = 6 - (pixelIndex & 3) * 2;
    uint b = fetchByte(byteOff);
    int idx = int((b >> uint(shift)) & 3u) + u_palOffset;
    return texelFetch(u_palette, ivec2(idx, 0), 0);
  }
  // ── Indexed 4-bit ──
  if (u_format == 0x04) {
    int byteOff = pixelIndex / 2;
    uint b = fetchByte(byteOff);
    int idx;
    if ((pixelIndex & 1) == 0) {
      idx = int((b >> 4u) & 0xFu);
    } else {
      idx = int(b & 0xFu);
    }
    idx += u_palOffset;
    return texelFetch(u_palette, ivec2(idx, 0), 0);
  }
  // ── Indexed 8-bit ──
  if (u_format == 0x08) {
    int byteOff = pixelIndex;
    uint b = fetchByte(byteOff);
    int idx = int(b);  // i8 uses full palette, no offset
    return texelFetch(u_palette, ivec2(idx, 0), 0);
  }
  // ── AI44 (alpha + index 4+4) ──
  if (u_format == 0x09) {
    int byteOff = pixelIndex;
    uint b = fetchByte(byteOff);
    float alpha = float((b >> 4u) & 0xFu) / 15.0;
    int idx = int(b & 0xFu) + u_palOffset;
    vec4 c = texelFetch(u_palette, ivec2(idx, 0), 0);
    return vec4(c.rgb, alpha);
  }

  // ── RGB565 ──
  if (u_format == 0x10) {
    int byteOff = pixelIndex * 2;
    uint lo = fetchByte(byteOff);
    uint hi = fetchByte(byteOff + 1);
    uint v = lo | (hi << 8u);
    float r = float((v >> 11u) & 0x1Fu) / 31.0;
    float g = float((v >>  5u) & 0x3Fu) / 63.0;
    float b = float( v         & 0x1Fu) / 31.0;
    return vec4(r, g, b, 1.0);
  }
  // ── ARGB1555 ──
  if (u_format == 0x11) {
    int byteOff = pixelIndex * 2;
    uint lo = fetchByte(byteOff);
    uint hi = fetchByte(byteOff + 1);
    uint v = lo | (hi << 8u);
    float a = float(v >> 15u);
    float r = float((v >> 10u) & 0x1Fu) / 31.0;
    float g = float((v >>  5u) & 0x1Fu) / 31.0;
    float b = float( v         & 0x1Fu) / 31.0;
    return vec4(r, g, b, a);
  }
  // ── RGBA5551 ──
  if (u_format == 0x12) {
    int byteOff = pixelIndex * 2;
    uint lo = fetchByte(byteOff);
    uint hi = fetchByte(byteOff + 1);
    uint v = lo | (hi << 8u);
    float r = float((v >> 11u) & 0x1Fu) / 31.0;
    float g = float((v >>  6u) & 0x1Fu) / 31.0;
    float b = float((v >>  1u) & 0x1Fu) / 31.0;
    float a = float(v & 1u);
    return vec4(r, g, b, a);
  }
  // ── RGB555 ──
  if (u_format == 0x13) {
    int byteOff = pixelIndex * 2;
    uint lo = fetchByte(byteOff);
    uint hi = fetchByte(byteOff + 1);
    uint v = lo | (hi << 8u);
    float r = float((v >> 10u) & 0x1Fu) / 31.0;
    float g = float((v >>  5u) & 0x1Fu) / 31.0;
    float b = float( v         & 0x1Fu) / 31.0;
    return vec4(r, g, b, 1.0);
  }
  // ── ARGB4444 ──
  if (u_format == 0x14) {
    int byteOff = pixelIndex * 2;
    uint lo = fetchByte(byteOff);
    uint hi = fetchByte(byteOff + 1);
    uint v = lo | (hi << 8u);
    float a = float((v >> 12u) & 0xFu) / 15.0;
    float r = float((v >>  8u) & 0xFu) / 15.0;
    float g = float((v >>  4u) & 0xFu) / 15.0;
    float b = float( v         & 0xFu) / 15.0;
    return vec4(r, g, b, a);
  }
  // ── RGBA4444 ──
  if (u_format == 0x15) {
    int byteOff = pixelIndex * 2;
    uint lo = fetchByte(byteOff);
    uint hi = fetchByte(byteOff + 1);
    uint v = lo | (hi << 8u);
    float r = float((v >> 12u) & 0xFu) / 15.0;
    float g = float((v >>  8u) & 0xFu) / 15.0;
    float b = float((v >>  4u) & 0xFu) / 15.0;
    float a = float( v         & 0xFu) / 15.0;
    return vec4(r, g, b, a);
  }
  // ── RGB444 ──
  if (u_format == 0x16) {
    int byteOff = pixelIndex * 2;
    uint lo = fetchByte(byteOff);
    uint hi = fetchByte(byteOff + 1);
    uint v = lo | (hi << 8u);
    float r = float((v >>  8u) & 0xFu) / 15.0;
    float g = float((v >>  4u) & 0xFu) / 15.0;
    float b = float( v         & 0xFu) / 15.0;
    return vec4(r, g, b, 1.0);
  }

  // ── RGB888 ──
  if (u_format == 0x20) {
    int byteOff = pixelIndex * 3;
    float r = float(fetchByte(byteOff))     / 255.0;
    float g = float(fetchByte(byteOff + 1)) / 255.0;
    float b = float(fetchByte(byteOff + 2)) / 255.0;
    return vec4(r, g, b, 1.0);
  }
  // ── RGBA8888 ──
  if (u_format == 0x21) {
    int byteOff = pixelIndex * 4;
    float r = float(fetchByte(byteOff))     / 255.0;
    float g = float(fetchByte(byteOff + 1)) / 255.0;
    float b = float(fetchByte(byteOff + 2)) / 255.0;
    float a = float(fetchByte(byteOff + 3)) / 255.0;
    return vec4(r, g, b, a);
  }
  // ── ARGB8888 ──
  if (u_format == 0x22) {
    int byteOff = pixelIndex * 4;
    float a = float(fetchByte(byteOff))     / 255.0;
    float r = float(fetchByte(byteOff + 1)) / 255.0;
    float g = float(fetchByte(byteOff + 2)) / 255.0;
    float b = float(fetchByte(byteOff + 3)) / 255.0;
    return vec4(r, g, b, a);
  }

  // ── Alpha 1-bit ──
  if (u_format == 0x30) {
    int byteOff = pixelIndex / 8;
    int bitIdx  = 7 - (pixelIndex & 7);
    uint bb = fetchByte(byteOff);
    float a = float((bb >> uint(bitIdx)) & 1u);
    return vec4(1.0, 1.0, 1.0, a);
  }
  // ── Alpha 2-bit ──
  if (u_format == 0x31) {
    int byteOff = pixelIndex / 4;
    int shift   = 6 - (pixelIndex & 3) * 2;
    uint bb = fetchByte(byteOff);
    float a = float((bb >> uint(shift)) & 3u) / 3.0;
    return vec4(1.0, 1.0, 1.0, a);
  }
  // ── Alpha 4-bit ──
  if (u_format == 0x32) {
    int byteOff = pixelIndex / 2;
    uint bb = fetchByte(byteOff);
    float a;
    if ((pixelIndex & 1) == 0) {
      a = float((bb >> 4u) & 0xFu) / 15.0;
    } else {
      a = float(bb & 0xFu) / 15.0;
    }
    return vec4(1.0, 1.0, 1.0, a);
  }
  // ── Alpha 8-bit ──
  if (u_format == 0x33) {
    int byteOff = pixelIndex;
    float a = float(fetchByte(byteOff)) / 255.0;
    return vec4(1.0, 1.0, 1.0, a);
  }

  // Fallback — show magenta
  return vec4(1.0, 0.0, 1.0, 1.0);
}

// Convert RGBA [0..1] to RGB565 as int for comparison
int toRGB565(vec4 c) {
  int r5 = int(c.r * 31.0 + 0.5);
  int g6 = int(c.g * 63.0 + 0.5);
  int b5 = int(c.b * 31.0 + 0.5);
  return (r5 << 11) | (g6 << 5) | b5;
}

// Sample at a given UV in [0..1] of the LOGICAL texture.
// When the texture is pre-rotated 90° CW, we remap the UV from logical
// space to stored space so that decodePixel works with stored coordinates.
//   stored_uv = vec2(1.0 - uv.y, uv.x)
// This avoids wrapping decodePixel (which would double shader size).
vec4 sampleTexture(vec2 uv) {
  // Clamp
  uv = clamp(uv, vec2(0.0), vec2(1.0));

  // Remap UV from logical to stored space for pre-rotated textures
  if (u_preRotated) {
    uv = vec2(1.0 - uv.y, uv.x);
  }

  // Sample in stored texture dimensions
  float fx = uv.x * float(u_texWidth)  - 0.5;
  float fy = uv.y * float(u_texHeight) - 0.5;

  if (!u_filter) {
    // Nearest
    int px = clamp(int(fx + 0.5), 0, u_texWidth  - 1);
    int py = clamp(int(fy + 0.5), 0, u_texHeight - 1);
    return decodePixel(px, py);
  }

  // Bilinear
  int x0 = int(floor(fx));
  int y0 = int(floor(fy));
  int x1 = x0 + 1;
  int y1 = y0 + 1;
  float sx = fx - float(x0);
  float sy = fy - float(y0);
  x0 = clamp(x0, 0, u_texWidth  - 1);
  x1 = clamp(x1, 0, u_texWidth  - 1);
  y0 = clamp(y0, 0, u_texHeight - 1);
  y1 = clamp(y1, 0, u_texHeight - 1);

  vec4 c00 = decodePixel(x0, y0);
  vec4 c10 = decodePixel(x1, y0);
  vec4 c01 = decodePixel(x0, y1);
  vec4 c11 = decodePixel(x1, y1);

  return mix(mix(c00, c10, sx), mix(c01, c11, sx), sy);
}

void main() {
  // Compute UV of this fragment within the destination rect
  // We need to invert the vertex transform to find the source UV

  // Fragment coord in pixels (top-left origin, already flipped by viewport)
  vec2 frag = gl_FragCoord.xy;
  frag.y = u_canvasSize.y - frag.y; // to top-left origin

  // Undo rotation
  vec2 pivotPx = u_dstPos + u_pivot * u_dstSize;
  vec2 d = frag - pivotPx;
  float c = cos(-u_rotation);
  float s = sin(-u_rotation);
  vec2 local = pivotPx + vec2(d.x * c - d.y * s, d.x * s + d.y * c);

  // Normalised [0..1] within dest rect
  vec2 uv01 = (local - u_dstPos) / u_dstSize;

  // Map [0..1] → source UV sub-rect
  vec2 uv = u_srcUV0 + uv01 * (u_srcUV1 - u_srcUV0);

  // Discard if outside source
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    discard;
  }

  if (u_aa) {
    // 4× rotated-grid SSAA
    vec2 dx = dFdx(uv) * 0.25;
    vec2 dy = dFdy(uv) * 0.25;
    vec4 acc = vec4(0.0);
    acc += sampleTexture(uv + dx - dy);
    acc += sampleTexture(uv - dx + dy);
    acc += sampleTexture(uv + dx + dy);
    acc += sampleTexture(uv - dx - dy);
    fragColor = acc * 0.25;
  } else {
    fragColor = sampleTexture(uv);
  }

  // Color key check — done once in main() to avoid per-sample overhead
  if (u_colorKey >= 0) {
    if (toRGB565(fragColor) == u_colorKey) fragColor.a = 0.0;
  }

  if (fragColor.a <= 0.0) discard;
}
`;


/* ═══════════════════════════════════════════════════════════════════════
   RLE decoder (matches firmware TGA-style RLE)
   ═══════════════════════════════════════════════════════════════════════ */
function rleDecode(data, expectedLength) {
  const out = new Uint8Array(expectedLength);
  let si = 0, di = 0;
  while (si < data.length && di < expectedLength) {
    const header = data[si++];
    const count = (header & 0x7F) + 1;
    if (header & 0x80) {
      const value = data[si++];
      for (let j = 0; j < count && di < expectedLength; j++) out[di++] = value;
    } else {
      for (let j = 0; j < count && di < expectedLength; j++) out[di++] = data[si++];
    }
  }
  return out;
}


/* ═══════════════════════════════════════════════════════════════════════
   D2Canvas class
   ═══════════════════════════════════════════════════════════════════════ */
class D2Canvas {

  /**
   * @param {HTMLCanvasElement} canvas  An existing canvas element.
   * @param {object} [opts]
   * @param {boolean} [opts.alpha=true]        Canvas has alpha.
   * @param {boolean} [opts.premultiplied=true] Use premultiplied alpha compositing.
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const glOpts = {
      alpha:              opts.alpha !== false,
      premultipliedAlpha: opts.premultiplied !== false,
      antialias:          false,        // we handle AA ourselves
      preserveDrawingBuffer: true,      // let caller read back pixels
    };
    const gl = canvas.getContext('webgl2', glOpts);
    if (!gl) throw new Error('D2Canvas: WebGL 2 not available');
    this.gl = gl;

    // Compile program
    this._program = this._buildProgram(gl, VERT_SRC, FRAG_SRC);

    // Cache uniform locations
    this._uloc = {};
    const names = [
      'u_dstPos', 'u_dstSize', 'u_canvasSize', 'u_srcUV0', 'u_srcUV1',
      'u_rotation', 'u_pivot',
      'u_texData', 'u_palette', 'u_format', 'u_texWidth', 'u_texHeight',
      'u_texStride', 'u_palOffset', 'u_colorKey', 'u_filter', 'u_aa',
      'u_preRotated',
    ];
    for (const n of names) this._uloc[n] = gl.getUniformLocation(this._program, n);

    // Create empty VAO (vertex-less rendering)
    this._vao = gl.createVertexArray();

    // Byte-aligned uploads (sub-byte textures may have non-power-of-2 row strides)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);

    // Create palette texture (256×1 RGBA8)
    this._paletteTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._paletteTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Initialize with zeroes
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(1024));

    // State
    this._paletteOffset = 0;
    this._colorKey = -1;

    // Enable blending (straight alpha — matches how textures are authored)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /* ──────────────────────────────────────────────────────────────── */
  /*  Canvas management                                               */
  /* ──────────────────────────────────────────────────────────────── */

  /** Enable or disable alpha blending. Disable for pixel-accurate readback. */
  setBlending(enabled) {
    const gl = this.gl;
    if (enabled) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }
  }

  /** Set the output resolution (CSS pixels are separate). */
  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  /** Clear the framebuffer. RGB values in [0..1]. */
  clear(r = 0, g = 0, b = 0, a = 1) {
    const gl = this.gl;
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /* ──────────────────────────────────────────────────────────────── */
  /*  Palette                                                         */
  /* ──────────────────────────────────────────────────────────────── */

  /**
   * Upload a 256-entry RGBA8 palette.
   * @param {Uint8Array} rgba8  1024 bytes (256 × 4).
   *                            Shorter arrays are OK — remaining entries stay black/transparent.
   */
  setPalette(rgba8) {
    const gl = this.gl;
    const full = new Uint8Array(1024);
    full.set(rgba8.subarray(0, Math.min(rgba8.length, 1024)));
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._paletteTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, full);
  }

  /** Set palette offset for sub-8-bit indexed modes. */
  setPaletteOffset(offset) {
    this._paletteOffset = offset | 0;
  }

  /* ──────────────────────────────────────────────────────────────── */
  /*  Texture management                                              */
  /* ──────────────────────────────────────────────────────────────── */

  /**
   * Upload a .d2 file (complete, with 32-byte D2TX header) as a GPU texture.
   * @param {Uint8Array} d2Bytes  Complete .d2 file data.
   * @returns {{ id: WebGLTexture, width: number, height: number, format: number,
   *             flags: number, paletteIndex: number, paletteOffset: number,
   *             stride: number, preRotated: boolean }}
   */
  createTexture(d2Bytes) {
    const gl = this.gl;
    const view = new DataView(d2Bytes.buffer, d2Bytes.byteOffset, d2Bytes.byteLength);

    // Parse header
    const magic = view.getUint32(0, true);
    if (magic !== D2TX_MAGIC) throw new Error('D2Canvas.createTexture: bad D2TX magic');

    const format      = view.getUint8(5);
    const width       = view.getUint16(6, true);
    const height      = view.getUint16(8, true);
    const paletteIdx  = view.getUint16(10, true);
    const palOffset   = view.getUint8(12);
    const flags       = view.getUint8(13);
    const isRLE       = !!(flags & 0x01);
    const preRotated  = !!(flags & 0x02);
    const hasColorKey = !!(flags & 0x04);
    const colorKey    = hasColorKey ? view.getUint16(14, true) : -1;

    const bpp = BITS_PER_PIXEL[format] || 8;

    // Calculate expected decompressed size
    const totalPixels = width * height;
    const expectedBytes = Math.ceil(totalPixels * bpp / 8);

    // Extract pixel data
    let pixelData = d2Bytes.subarray(D2TX_HEADER_SIZE);
    if (isRLE) {
      pixelData = rleDecode(pixelData, expectedBytes);
    }

    // Compute row stride in bytes (for sub-byte we need to ceil each row)
    const stride = Math.ceil(width * bpp / 8);

    // Upload as R8UI texture: width = stride bytes, height = texture height
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Ensure pixel data fills the texture (pad if needed)
    const texDataBytes = stride * height;
    let uploadData;
    if (pixelData.length >= texDataBytes) {
      uploadData = pixelData.subarray(0, texDataBytes);
    } else {
      uploadData = new Uint8Array(texDataBytes);
      uploadData.set(pixelData);
    }

    gl.texImage2D(
      gl.TEXTURE_2D, 0,
      gl.R8UI,
      stride, height, 0,
      gl.RED_INTEGER, gl.UNSIGNED_BYTE,
      uploadData
    );

    return {
      id: tex,
      width,
      height,
      format,
      flags,
      paletteIndex: paletteIdx,
      paletteOffset: palOffset,
      stride,
      preRotated,
      bpp,
      colorKey,
    };
  }

  /**
   * Create a texture from raw pixel bytes (no D2TX header).
   * @param {Uint8Array} pixels  Raw pixel data.
   * @param {number} width       Texture width in pixels.
   * @param {number} height      Texture height in pixels.
   * @param {number} format      D2 format enum (e.g., D2_FORMAT.I8).
   * @returns {object} Same shape as createTexture().
   */
  createTextureRaw(pixels, width, height, format) {
    const gl = this.gl;
    const bpp = BITS_PER_PIXEL[format] || 8;
    const stride = Math.ceil(width * bpp / 8);
    const texDataBytes = stride * height;

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    let uploadData;
    if (pixels.length >= texDataBytes) {
      uploadData = pixels.subarray(0, texDataBytes);
    } else {
      uploadData = new Uint8Array(texDataBytes);
      uploadData.set(pixels);
    }

    gl.texImage2D(
      gl.TEXTURE_2D, 0,
      gl.R8UI,
      stride, height, 0,
      gl.RED_INTEGER, gl.UNSIGNED_BYTE,
      uploadData
    );

    return {
      id: tex,
      width,
      height,
      format,
      flags: 0,
      paletteIndex: 0,
      paletteOffset: 0,
      stride,
      preRotated: false,
      bpp,
    };
  }

  /** Free a texture previously created with createTexture(). */
  deleteTexture(tex) {
    this.gl.deleteTexture(tex.id);
    tex.id = null;
  }

  /* ──────────────────────────────────────────────────────────────── */
  /*  Color key                                                       */
  /* ──────────────────────────────────────────────────────────────── */

  /**
   * Set the color key. Pixels matching this RGB-565 value will be
   * rendered transparent. Works for all formats including indexed.
   * @param {number} rgb565  0x0000–0xFFFF, or -1 to disable.
   */
  setColorKey(rgb565) {
    this._colorKey = rgb565 | 0;
  }

  /* ──────────────────────────────────────────────────────────────── */
  /*  Blit                                                            */
  /* ──────────────────────────────────────────────────────────────── */

  /**
   * Draw a (region of a) texture to the canvas.
   * @param {object} tex  Handle returned by createTexture().
   * @param {object} [opts]
   */
  blit(tex, opts = {}) {
    const gl = this.gl;
    const prog = this._program;
    gl.useProgram(prog);
    gl.bindVertexArray(this._vao);

    const x      = opts.x ?? 0;
    const y      = opts.y ?? 0;
    const scaleX = opts.scaleX ?? 1;
    const scaleY = opts.scaleY ?? 1;
    const rot    = (opts.rotation ?? 0) * Math.PI / 180;
    const pivotX = opts.pivotX ?? 0.5;
    const pivotY = opts.pivotY ?? 0.5;
    const filter = opts.filter === 'bilinear';
    const aa     = !!opts.aa;

    // Logical dimensions (for pre-rotated textures, display is swapped)
    const logW = tex.preRotated ? tex.height : tex.width;
    const logH = tex.preRotated ? tex.width  : tex.height;

    // Source rect in logical texel coords → UV [0..1]
    const srcX = opts.srcX ?? 0;
    const srcY = opts.srcY ?? 0;
    const srcW = opts.srcW ?? logW;
    const srcH = opts.srcH ?? logH;
    const u0 = srcX / logW;
    const v0 = srcY / logH;
    const u1 = (srcX + srcW) / logW;
    const v1 = (srcY + srcH) / logH;

    const dstW = srcW * scaleX;
    const dstH = srcH * scaleY;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // Set uniforms
    const u = this._uloc;
    gl.uniform2f(u.u_dstPos, x, y);
    gl.uniform2f(u.u_dstSize, dstW, dstH);
    gl.uniform2f(u.u_canvasSize, cw, ch);
    gl.uniform2f(u.u_srcUV0, u0, v0);
    gl.uniform2f(u.u_srcUV1, u1, v1);
    gl.uniform1f(u.u_rotation, rot);
    gl.uniform2f(u.u_pivot, pivotX, pivotY);

    // Texture data
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.id);
    gl.uniform1i(u.u_texData, 0);

    // Palette
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._paletteTex);
    gl.uniform1i(u.u_palette, 1);

    gl.uniform1i(u.u_format, tex.format);
    gl.uniform1i(u.u_texWidth, tex.width);
    gl.uniform1i(u.u_texHeight, tex.height);
    gl.uniform1i(u.u_texStride, tex.stride);
    gl.uniform1i(u.u_palOffset, this._paletteOffset);
    gl.uniform1i(u.u_colorKey, tex.colorKey ?? this._colorKey);
    gl.uniform1i(u.u_filter, filter ? 1 : 0);
    gl.uniform1i(u.u_aa, aa ? 1 : 0);
    gl.uniform1i(u.u_preRotated, tex.preRotated ? 1 : 0);

    // Draw fullscreen quad (4 vertices, triangle strip)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** No-op for now; WebGL presents automatically. */
  present() {
    this.gl.flush();
  }

  /* ──────────────────────────────────────────────────────────────── */
  /*  Readback                                                        */
  /* ──────────────────────────────────────────────────────────────── */

  /**
   * Read back the canvas as an RGBA Uint8Array.
   * @returns {Uint8Array}
   */
  readPixels() {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  }

  /* ──────────────────────────────────────────────────────────────── */
  /*  Cleanup                                                         */
  /* ──────────────────────────────────────────────────────────────── */

  destroy() {
    const gl = this.gl;
    if (this._program) { gl.deleteProgram(this._program); this._program = null; }
    if (this._vao) { gl.deleteVertexArray(this._vao); this._vao = null; }
    if (this._paletteTex) { gl.deleteTexture(this._paletteTex); this._paletteTex = null; }
    // Note: caller should delete any textures they created.
  }

  /* ──────────────────────────────────────────────────────────────── */
  /*  Internal: shader compilation                                    */
  /* ──────────────────────────────────────────────────────────────── */

  _buildProgram(gl, vSrc, fSrc) {
    const vs = this._compile(gl, gl.VERTEX_SHADER, vSrc);
    const fs = this._compile(gl, gl.FRAGMENT_SHADER, fSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const linkLog = gl.getProgramInfoLog(prog);
      const vsLog = gl.getShaderInfoLog(vs);
      const fsLog = gl.getShaderInfoLog(fs);
      console.error('[D2Canvas] Link failed. Program log:', linkLog || '(empty)');
      console.error('[D2Canvas] Vertex shader log:', vsLog || '(empty)');
      console.error('[D2Canvas] Fragment shader log:', fsLog || '(empty)');
      console.error('[D2Canvas] GL error:', gl.getError());
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error('D2Canvas: Shader link failed:\n' + (linkLog || vsLog || fsLog || 'no details'));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
  }

  _compile(gl, type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      const label = type === gl.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT';
      throw new Error(`D2Canvas: ${label} shader compile failed:\n${log}`);
    }
    return shader;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   Static helpers
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Pack per-pixel 8-bit palette indices into the target indexed format.
 * Input:  Uint8Array where each byte is a palette index (0-255).
 * Output: Uint8Array packed according to the D2 format.
 *
 * @param {Uint8Array} indexedData  One byte per pixel (palette indices).
 * @param {number} formatEnum      D2_FORMAT enum (I1, I2, I4, I8).
 * @returns {Uint8Array}           Packed binary data.
 */
function packIndexedPixels(indexedData, formatEnum) {
  const count = indexedData.length;

  switch (formatEnum) {
    case D2_FORMAT.I8:
      return new Uint8Array(indexedData); // 1:1 copy

    case D2_FORMAT.I4: {
      const out = new Uint8Array(Math.ceil(count / 2));
      for (let i = 0; i < count; i++) {
        const byteIdx = i >> 1;
        if ((i & 1) === 0) {
          out[byteIdx] = (indexedData[i] & 0xF) << 4;
        } else {
          out[byteIdx] |= indexedData[i] & 0xF;
        }
      }
      return out;
    }

    case D2_FORMAT.I2: {
      const out = new Uint8Array(Math.ceil(count / 4));
      for (let i = 0; i < count; i++) {
        const byteIdx = i >> 2;
        const shift = 6 - ((i & 3) * 2);
        out[byteIdx] |= (indexedData[i] & 3) << shift;
      }
      return out;
    }

    case D2_FORMAT.I1: {
      const out = new Uint8Array(Math.ceil(count / 8));
      for (let i = 0; i < count; i++) {
        const byteIdx = i >> 3;
        const bitIdx = 7 - (i & 7);
        if (indexedData[i] & 1) {
          out[byteIdx] |= 1 << bitIdx;
        }
      }
      return out;
    }

    default:
      // Non-indexed format — return as-is
      return new Uint8Array(indexedData);
  }
}

/**
 * Map format string (e.g. "d2_mode_i8") → numeric enum (0x08).
 */
const FORMAT_STRING_TO_ENUM = {
  'd2_mode_i1':       D2_FORMAT.I1,
  'd2_mode_i2':       D2_FORMAT.I2,
  'd2_mode_i4':       D2_FORMAT.I4,
  'd2_mode_i8':       D2_FORMAT.I8,
  'd2_mode_ai44':     D2_FORMAT.AI44,
  'd2_mode_rgb565':   D2_FORMAT.RGB565,
  'd2_mode_argb1555': D2_FORMAT.ARGB1555,
  'd2_mode_rgba5551': D2_FORMAT.RGBA5551,
  'd2_mode_rgb555':   D2_FORMAT.RGB555,
  'd2_mode_argb4444': D2_FORMAT.ARGB4444,
  'd2_mode_rgba4444': D2_FORMAT.RGBA4444,
  'd2_mode_rgb444':   D2_FORMAT.RGB444,
  'd2_mode_rgb888':   D2_FORMAT.RGB888,
  'd2_mode_rgba8888': D2_FORMAT.RGBA8888,
  'd2_mode_argb8888': D2_FORMAT.ARGB8888,
  'd2_mode_alpha1':   D2_FORMAT.ALPHA1,
  'd2_mode_alpha2':   D2_FORMAT.ALPHA2,
  'd2_mode_alpha4':   D2_FORMAT.ALPHA4,
  'd2_mode_alpha8':   D2_FORMAT.ALPHA8,
};

/**
 * Build a complete D2TX file from raw pixel data.
 * @param {number} width
 * @param {number} height
 * @param {number|string} format  Enum (0x08) or string ('d2_mode_i8').
 * @param {Uint8Array} pixelData  Raw format-encoded pixel bytes.
 * @param {object} [opts]
 * @param {number} [opts.paletteIndex=0]  1-based PMAP palette index.
 * @param {number} [opts.paletteOffset=0] Palette offset for sub-8-bit modes.
 * @param {boolean} [opts.rle=false]      Data is RLE-compressed.
 * @param {boolean} [opts.preRotated=false] Content is pre-rotated 90° CW.
 * @param {number}  [opts.colorKey=-1]     RGB565 color key (-1 = disabled).
 * @returns {Uint8Array} Complete .d2 file bytes.
 */
function buildD2TX(width, height, format, pixelData, opts = {}) {
  const fmt = typeof format === 'string' ? (FORMAT_STRING_TO_ENUM[format] || D2_FORMAT.I8) : format;
  const colorKey = opts.colorKey ?? -1;
  const flags = (opts.rle ? 0x01 : 0) | (opts.preRotated ? 0x02 : 0) | (colorKey >= 0 ? 0x04 : 0);
  const paletteIndex = opts.paletteIndex || 0;
  const paletteOffset = opts.paletteOffset || 0;

  const header = new Uint8Array(D2TX_HEADER_SIZE);
  const view = new DataView(header.buffer);
  header[0] = 0x44; header[1] = 0x32; header[2] = 0x54; header[3] = 0x58; // "D2TX"
  view.setUint8(4, 2);                         // version
  view.setUint8(5, fmt);                        // format
  view.setUint16(6, width, true);               // width LE
  view.setUint16(8, height, true);              // height LE
  view.setUint16(10, paletteIndex, true);       // palette index LE
  view.setUint8(12, paletteOffset & 0xFF);
  view.setUint8(13, flags & 0xFF);
  if (colorKey >= 0) {
    view.setUint16(14, colorKey & 0xFFFF, true); // RGB565 color key LE
  }

  const result = new Uint8Array(D2TX_HEADER_SIZE + pixelData.length);
  result.set(header);
  result.set(pixelData instanceof Uint8Array ? pixelData : new Uint8Array(pixelData), D2TX_HEADER_SIZE);
  return result;
}

/* ═══════════════════════════════════════════════════════════════════════
   Exports
   ═══════════════════════════════════════════════════════════════════════ */
if (typeof window !== 'undefined') {
  window.D2Canvas              = D2Canvas;
  window.D2_FORMAT             = D2_FORMAT;
  window.D2TX_HEADER_SIZE      = D2TX_HEADER_SIZE;
  window.BITS_PER_PIXEL        = BITS_PER_PIXEL;
  window.FORMAT_STRING_TO_ENUM = FORMAT_STRING_TO_ENUM;
  window.buildD2TX             = buildD2TX;
  window.packIndexedPixels     = packIndexedPixels;
}

console.log('[D2Canvas] WebGL 2 renderer library loaded');
