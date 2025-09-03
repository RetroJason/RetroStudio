// d2-graphics-api.js
// Standalone D2 Graphics API for Dave2D-style texture rendering
// Extracted from test-d2-graphics-api.html for use in game emulator

class D2GraphicsAPI {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.vertexBuffer = null;
        this.indexBuffer = null;
        this.attribLocations = {};
        this.uniformLocations = {};
        
        // Texture management
        this.textures = new Map();
        this.textureCounter = 0;
        this.activeTexture = null;
        
        // Palette management
        this.paletteTexture = null;
        this.paletteData = null;
        this.paletteOffset = 0;
        
        // Rendering settings
        this.uFilter = 'nearest';
        this.vFilter = 'nearest';
        this.antiAlias = false;
        this.bilinearFilter = false;
        this.colorKeyEnabled = false;
        this.colorKey = { r: 255, g: 0, b: 255 }; // Default magenta
        
        this.init();
    }
    
    init() {
        // Get WebGL context
        this.gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
        if (!this.gl) {
            throw new Error('WebGL not supported');
        }
        
        // Create shader program
        this.createShaderProgram();
        
        // Setup geometry for quad rendering
        this.setupGeometry();
        
        // Enable blending for transparency
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        
        console.log('[D2Graphics] D2 Graphics API initialized');
    }
    
    createShaderProgram() {
        // Simple vertex shader - just converts screen coordinates to clip space
        const vertexShaderSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            
            uniform vec2 u_resolution;
            
            varying vec2 v_texCoord;
            
            void main() {
                // Convert from pixels to clip space (simple passthrough)
                vec2 clipSpace = ((a_position / u_resolution) * 2.0) - 1.0;
                gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
                
                // Pass texture coordinates directly (already calculated by Dave2D mapping)
                v_texCoord = a_texCoord;
            }
        `;
        
        // Fragment shader with D2 format support
        const fragmentShaderSource = `
            precision mediump float;
            
            uniform sampler2D u_texture;
            uniform sampler2D u_paletteTexture;
            uniform float u_textureFormat;
            uniform float u_paletteOffset;
            uniform float u_colorKeyEnabled;
            uniform vec3 u_colorKey;
            uniform float u_hasActivePalette;
            
            varying vec2 v_texCoord;
            
            vec4 decodeIndexed(float index) {
                float paletteIndex = index * 255.0;
                vec2 paletteCoord = vec2(paletteIndex / 256.0, 0.5);
                return texture2D(u_paletteTexture, paletteCoord);
            }
            
            void main() {
                vec4 texel = texture2D(u_texture, v_texCoord);
                vec4 color;
                
                // Use the exact same logic as the working WebGL render page
                if (abs(u_textureFormat - 5.0) < 0.5) { // AI44 - Alpha + Index
                    // For AI44: red channel = palette index, alpha channel = alpha value
                    color = decodeIndexed(texel.r);
                    color.a = texel.a; // Alpha is already normalized (0-1)
                } else if (u_textureFormat >= 8.5) { // Other indexed formats (I8, I4, I2, I1)
                    color = decodeIndexed(texel.r);
                } else {
                    // For RGB565, ARGB8888, etc. - already converted to RGBA
                    color = texel;
                }
                
                // Apply color key transparency (but not for AI44 since it has its own alpha)
                if (u_colorKeyEnabled > 0.5 && abs(u_textureFormat - 5.0) >= 0.5) {
                    vec3 colorKey = u_colorKey / 255.0;
                    if (distance(color.rgb, colorKey) < 0.01) {
                        discard;
                    }
                }
                
                gl_FragColor = color;
            }
        `;
        
        const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);
        
        this.program = this.gl.createProgram();
        this.gl.attachShader(this.program, vertexShader);
        this.gl.attachShader(this.program, fragmentShader);
        this.gl.linkProgram(this.program);
        
        if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
            throw new Error('Shader program failed to link: ' + this.gl.getProgramInfoLog(this.program));
        }
        
        // Get attribute locations
        this.attribLocations = {
            position: this.gl.getAttribLocation(this.program, 'a_position'),
            texCoord: this.gl.getAttribLocation(this.program, 'a_texCoord')
        };
        
        // Get uniform locations
        this.uniformLocations = {
            resolution: this.gl.getUniformLocation(this.program, 'u_resolution'),
            texture: this.gl.getUniformLocation(this.program, 'u_texture'),
            paletteTexture: this.gl.getUniformLocation(this.program, 'u_paletteTexture'),
            textureFormat: this.gl.getUniformLocation(this.program, 'u_textureFormat'),
            colorKeyEnabled: this.gl.getUniformLocation(this.program, 'u_colorKeyEnabled'),
            colorKey: this.gl.getUniformLocation(this.program, 'u_colorKey'),
            paletteOffset: this.gl.getUniformLocation(this.program, 'u_paletteOffset'),
            hasActivePalette: this.gl.getUniformLocation(this.program, 'u_hasActivePalette')
        };
    }
    
    createShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const error = this.gl.getShaderInfoLog(shader);
            this.gl.deleteShader(shader);
            throw new Error('Shader compilation failed: ' + error);
        }
        
        return shader;
    }
    
    setupGeometry() {
        // Create vertex buffer for a unit quad
        this.vertexBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        
        // Initial vertex data (will be updated per blit)
        const vertices = new Float32Array([
            // Position  TexCoord
            0, 0,        0, 0,
            1, 0,        1, 0,
            0, 1,        0, 1,
            1, 1,        1, 1
        ]);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
        
        // Create index buffer for the quad
        this.indexBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        const indices = new Uint16Array([0, 1, 2, 1, 3, 2]);
        this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, indices, this.gl.STATIC_DRAW);
    }
    
    // Load a texture from data (width, height, textureData, format)
    loadTexture(textureData, name, format) {
        const textureId = `texture_${this.textureCounter++}`;
        
        // Create WebGL texture
        const glTexture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, glTexture);
        
        // Upload texture data
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA,
                         textureData.width, textureData.height, 0,
                         this.gl.RGBA, this.gl.UNSIGNED_BYTE, textureData.textureData);
        
        // Set texture parameters
        this.updateTextureFiltering(glTexture);
        
        const texture = {
            id: textureId,
            name: name || textureId,
            glTexture: glTexture,
            width: textureData.width,
            height: textureData.height,
            format: format || 0
        };
        
        this.textures.set(textureId, texture);
        console.log(`[D2Graphics] Loaded texture: ${texture.name} (${texture.width}x${texture.height})`);
        
        return textureId;
    }
    
    // Load a D2 texture from binary data
    loadD2Texture(d2Buffer, name) {
        const handler = new D2FormatHandler();
        const d2Result = handler.loadFromD2Binary(d2Buffer);
        
        // For indexed formats, convert to texture format (not RGBA colors)
        let textureData;
        const format = d2Result.baseFormat;
        const frameData = d2Result.frames[0].data;
        
        if (format >= 9 || format === 5) { // Indexed formats
            textureData = this.convertIndexedToTexture(frameData, d2Result.width, d2Result.height, format);
        } else {
            // For non-indexed formats, use D2FormatHandler conversion
            textureData = handler.convertD2ToRGBA(frameData, format, d2Result.palette);
        }
        
        const textureDataObj = {
            width: d2Result.width,
            height: d2Result.height,
            textureData: textureData
        };
        
        const textureId = this.loadTexture(textureDataObj, name, format);
        
        // Load palette if available
        if (d2Result.palette) {
            this.loadActivePalette(d2Result.palette);
        }
        
        return textureId;
    }
    
    // Load palette data
    loadActivePalette(paletteData) {
        if (!paletteData || paletteData.length === 0) {
            console.warn('[D2Graphics] No palette data provided');
            return;
        }
        
        this.paletteData = paletteData;
        
        // Create palette texture (256x1 RGBA)
        const paletteTexData = new Uint8Array(256 * 4);
        for (let i = 0; i < 256; i++) {
            const color = paletteData[i] || { r: 0, g: 0, b: 0 };
            paletteTexData[i * 4] = color.r;
            paletteTexData[i * 4 + 1] = color.g;
            paletteTexData[i * 4 + 2] = color.b;
            paletteTexData[i * 4 + 3] = 255;
        }
        
        if (this.paletteTexture) {
            this.gl.deleteTexture(this.paletteTexture);
        }
        
        this.paletteTexture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.paletteTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 256, 1, 0,
                         this.gl.RGBA, this.gl.UNSIGNED_BYTE, paletteTexData);
        
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        
        console.log(`[D2Graphics] Loaded palette with ${paletteData.length} colors`);
    }
    
    // Set active texture by ID
    setActiveTexture(textureId) {
        const texture = this.textures.get(textureId);
        if (texture) {
            this.activeTexture = texture;
            // console.log(`[D2Graphics] Set active texture: ${texture.name}`);
        } else {
            console.warn(`[D2Graphics] Texture not found: ${textureId}`);
        }
    }
    
    // Dave2D-style texture mapping calculation
    calculateTextureMapping(screenX, screenY, screenW, screenH, u1, v1, u2, v2, rotation, scale) {
        const rotRad = rotation * Math.PI / 180.0;
        const cosR = Math.cos(rotRad);
        const sinR = Math.sin(rotRad);
        
        // Calculate scaled dimensions
        const scaledW = screenW * scale;
        const scaledH = screenH * scale;
        
        // Calculate texture coordinate range
        const uRange = u2 - u1;
        const vRange = v2 - v1;
        
        // Dave2D texture mapping parameters
        const dxu = (uRange / scaledW) * cosR;  // U increment per X step
        const dxv = (vRange / scaledH) * sinR;  // V increment per X step  
        const dyu = -(uRange / scaledW) * sinR; // U increment per Y step
        const dyv = (vRange / scaledH) * cosR;  // V increment per Y step
        
        // Calculate center offset for rotation around center
        const centerX = scaledW / 2;
        const centerY = scaledH / 2;
        const offsetX = screenW / 2 - centerX;
        const offsetY = screenH / 2 - centerY;
        
        // Calculate UV coordinates for each corner using Dave2D mapping
        const centerU = u1 + uRange / 2;
        const centerV = v1 + vRange / 2;
        
        // Top-left corner (0, 0)
        const u1_calc = centerU + dxu * (-centerX + offsetX) + dyu * (-centerY + offsetY);
        const v1_calc = centerV + dxv * (-centerX + offsetX) + dyv * (-centerY + offsetY);
        
        // Top-right corner (screenW, 0)
        const u2_calc = centerU + dxu * (scaledW - centerX + offsetX) + dyu * (-centerY + offsetY);
        const v2_calc = centerV + dxv * (scaledW - centerX + offsetX) + dyv * (-centerY + offsetY);
        
        // Bottom-left corner (0, screenH)
        const u3_calc = centerU + dxu * (-centerX + offsetX) + dyu * (scaledH - centerY + offsetY);
        const v3_calc = centerV + dxv * (-centerX + offsetX) + dyv * (scaledH - centerY + offsetY);
        
        // Bottom-right corner (screenW, screenH)
        const u4_calc = centerU + dxu * (scaledW - centerX + offsetX) + dyu * (scaledH - centerY + offsetY);
        const v4_calc = centerV + dxv * (scaledW - centerX + offsetX) + dyv * (scaledH - centerY + offsetY);
        
        return {
            screenX: screenX + offsetX,
            screenY: screenY + offsetY,
            screenW: scaledW,
            screenH: scaledH,
            u1: u1_calc, v1: v1_calc,
            u2: u2_calc, v2: v2_calc,
            u3: u3_calc, v3: v3_calc,
            u4: u4_calc, v4: v4_calc,
            // Also store the Dave2D parameters for debugging
            dxu: dxu, dxv: dxv, dyu: dyu, dyv: dyv
        };
    }
    
    // Main blit function - Dave2D style texture rendering
    blitTexturedQuad(screenX, screenY, screenW, screenH, u1, v1, u2, v2, rotation = 0, scale = 1.0) {
        if (!this.activeTexture) {
            console.warn('[D2Graphics] No active texture set');
            return;
        }
        
        // Calculate texture mapping parameters like Dave2D
        const mapping = this.calculateTextureMapping(screenX, screenY, screenW, screenH, u1, v1, u2, v2, rotation, scale);
        
        this.gl.useProgram(this.program);
        
        // Set up vertex attributes
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        
        // Position attribute
        this.gl.enableVertexAttribArray(this.attribLocations.position);
        this.gl.vertexAttribPointer(this.attribLocations.position, 2, this.gl.FLOAT, false, 16, 0);
        
        // Texture coordinate attribute
        this.gl.enableVertexAttribArray(this.attribLocations.texCoord);
        this.gl.vertexAttribPointer(this.attribLocations.texCoord, 2, this.gl.FLOAT, false, 16, 8);
        
        // Set uniforms
        this.gl.uniform2f(this.uniformLocations.resolution, this.canvas.width, this.canvas.height);
        
        // Update vertex buffer with calculated UV coordinates (Dave2D style)
        const vertices = new Float32Array([
            // Position (screen space)     // UV coordinates (calculated)
            mapping.screenX, mapping.screenY,                           mapping.u1, mapping.v1,
            mapping.screenX + mapping.screenW, mapping.screenY,         mapping.u2, mapping.v2,
            mapping.screenX, mapping.screenY + mapping.screenH,         mapping.u3, mapping.v3,
            mapping.screenX + mapping.screenW, mapping.screenY + mapping.screenH, mapping.u4, mapping.v4
        ]);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.DYNAMIC_DRAW);
        
        // Bind textures
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.activeTexture.glTexture);
        this.gl.uniform1i(this.uniformLocations.texture, 0);
        
        if (this.paletteTexture) {
            this.gl.activeTexture(this.gl.TEXTURE1);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.paletteTexture);
            this.gl.uniform1i(this.uniformLocations.paletteTexture, 1);
        }
        
        // Set rendering parameters
        this.gl.uniform1f(this.uniformLocations.textureFormat, this.activeTexture.format);
        this.gl.uniform1f(this.uniformLocations.paletteOffset, this.paletteOffset);
        this.gl.uniform1f(this.uniformLocations.colorKeyEnabled, this.colorKeyEnabled ? 1.0 : 0.0);
        this.gl.uniform3f(this.uniformLocations.colorKey, this.colorKey.r, this.colorKey.g, this.colorKey.b);
        this.gl.uniform1f(this.uniformLocations.hasActivePalette, this.paletteTexture ? 1.0 : 0.0);
        
        // Draw the quad
        this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);
    }
    
    // Clear the screen
    clearScreen() {
        this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
    
    // Set palette offset
    setPaletteOffset(offset) {
        this.paletteOffset = Math.max(0, Math.min(240, offset));
    }
    
    // Set color key
    setColorKey(enabled, color) {
        this.colorKeyEnabled = enabled;
        if (color) {
            this.colorKey = color;
        }
    }
    
    // Set texture filtering
    setTextureFiltering(uLinear, vLinear, antiAlias, bilinear) {
        this.uFilter = uLinear ? 'linear' : 'nearest';
        this.vFilter = vLinear ? 'linear' : 'nearest';
        this.antiAlias = antiAlias;
        this.bilinearFilter = bilinear;
        
        // Update all loaded textures
        for (const texture of this.textures.values()) {
            this.updateTextureFiltering(texture.glTexture);
        }
    }
    
    updateTextureFiltering(glTexture) {
        this.gl.bindTexture(this.gl.TEXTURE_2D, glTexture);
        
        const uLinear = this.uFilter === 'linear';
        const vLinear = this.vFilter === 'linear';
        
        const minFilter = (uLinear || vLinear) ? this.gl.LINEAR : this.gl.NEAREST;
        const magFilter = (uLinear || vLinear) ? this.gl.LINEAR : this.gl.NEAREST;
        
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, minFilter);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, magFilter);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    }
    
    // Convert indexed data to texture format (for I8, I4, I2, I1, AI44)
    convertIndexedToTexture(data, width, height, format) {
        // For indexed formats, we store the palette index in the red channel
        // This matches the working WebGL render page approach
        
        if (format === 5) { // AI44 - 4-bit alpha + 4-bit index
            const rgbaData = new Uint8Array(width * height * 4);
            for (let i = 0; i < data.length; i++) {
                const byte = data[i];
                const alpha = (byte >> 4) & 0x0F;
                const index = byte & 0x0F;
                
                const pixelIndex = i * 4;
                rgbaData[pixelIndex] = index;           // Store palette index in red channel
                rgbaData[pixelIndex + 1] = 0;           // Green
                rgbaData[pixelIndex + 2] = 0;           // Blue
                rgbaData[pixelIndex + 3] = alpha * 17;  // Convert 4-bit alpha to 8-bit (0-15 → 0-255)
            }
            return rgbaData;
        } else if (format === 9) { // I8 - 1 byte per pixel
            const rgbaData = new Uint8Array(width * height * 4);
            for (let i = 0; i < data.length; i++) {
                const pixelIndex = i * 4;
                rgbaData[pixelIndex] = data[i];     // Store palette index in red channel
                rgbaData[pixelIndex + 1] = 0;       // Green
                rgbaData[pixelIndex + 2] = 0;       // Blue
                rgbaData[pixelIndex + 3] = 255;     // Alpha
            }
            return rgbaData;
        } else if (format === 10) { // I4 - 2 pixels per byte
            const rgbaData = new Uint8Array(width * height * 4);
            for (let i = 0; i < data.length; i++) {
                const byte = data[i];
                const pixel1 = (byte >> 4) & 0x0F;
                const pixel2 = byte & 0x0F;
                
                // First pixel
                const pixelIndex1 = (i * 2) * 4;
                rgbaData[pixelIndex1] = pixel1;
                rgbaData[pixelIndex1 + 1] = 0;
                rgbaData[pixelIndex1 + 2] = 0;
                rgbaData[pixelIndex1 + 3] = 255;
                
                // Second pixel (if it exists)
                if (i * 2 + 1 < width * height) {
                    const pixelIndex2 = (i * 2 + 1) * 4;
                    rgbaData[pixelIndex2] = pixel2;
                    rgbaData[pixelIndex2 + 1] = 0;
                    rgbaData[pixelIndex2 + 2] = 0;
                    rgbaData[pixelIndex2 + 3] = 255;
                }
            }
            return rgbaData;
        } else if (format === 11) { // I2 - 4 pixels per byte
            const rgbaData = new Uint8Array(width * height * 4);
            for (let i = 0; i < data.length; i++) {
                const byte = data[i];
                for (let j = 0; j < 4; j++) {
                    const pixelNum = i * 4 + j;
                    if (pixelNum >= width * height) break;
                    
                    const shift = (3 - j) * 2;
                    const index = (byte >> shift) & 0x03;
                    
                    const pixelIndex = pixelNum * 4;
                    rgbaData[pixelIndex] = index;
                    rgbaData[pixelIndex + 1] = 0;
                    rgbaData[pixelIndex + 2] = 0;
                    rgbaData[pixelIndex + 3] = 255;
                }
            }
            return rgbaData;
        } else if (format === 12) { // I1 - 8 pixels per byte
            const rgbaData = new Uint8Array(width * height * 4);
            for (let i = 0; i < data.length; i++) {
                const byte = data[i];
                for (let j = 0; j < 8; j++) {
                    const pixelNum = i * 8 + j;
                    if (pixelNum >= width * height) break;
                    
                    const shift = 7 - j;
                    const index = (byte >> shift) & 0x01;
                    
                    const pixelIndex = pixelNum * 4;
                    rgbaData[pixelIndex] = index;
                    rgbaData[pixelIndex + 1] = 0;
                    rgbaData[pixelIndex + 2] = 0;
                    rgbaData[pixelIndex + 3] = 255;
                }
            }
            return rgbaData;
        } else {
            throw new Error(`Unsupported indexed format: ${format}`);
        }
    }
    
    // Cleanup
    destroy() {
        if (this.vertexBuffer) this.gl.deleteBuffer(this.vertexBuffer);
        if (this.indexBuffer) this.gl.deleteBuffer(this.indexBuffer);
        if (this.program) this.gl.deleteProgram(this.program);
        if (this.paletteTexture) this.gl.deleteTexture(this.paletteTexture);
        
        for (const texture of this.textures.values()) {
            this.gl.deleteTexture(texture.glTexture);
        }
        this.textures.clear();
    }
}

// Export for module system and global access
if (typeof module !== 'undefined' && module.exports) {
    module.exports = D2GraphicsAPI;
} else {
    window.D2GraphicsAPI = D2GraphicsAPI;
}
