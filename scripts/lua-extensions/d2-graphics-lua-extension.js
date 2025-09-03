// d2-graphics-lua-extension.js
// Lua extension for D2 Graphics API functionality

class D2GraphicsLuaExtension {
    constructor(gameEmulator) {
        this.gameEmulator = gameEmulator;
        this.name = 'D2Graphics';
    }

    // Register all D2 Graphics functions with Lua
    register(luaState) {
        console.log('[D2GraphicsLuaExtension] Registering D2 Graphics API functions...');
        
        if (!this.gameEmulator.d2Graphics) {
            console.warn('[D2GraphicsLuaExtension] D2 Graphics API not initialized');
            return;
        }

        const L = luaState;
        const d2Graphics = this.gameEmulator.d2Graphics;

        // Graphics namespace
        const graphicsNamespace = {
            // Core rendering functions
            clearScreen: () => {
                d2Graphics.clearScreen();
                return [];
            },

            blitTexture: (textureId, x, y, width, height, u1, v1, u2, v2, rotation, scale) => {
                // Convert Lua parameters to JavaScript
                const screenX = parseInt(x) || 0;
                const screenY = parseInt(y) || 0;
                const screenW = parseInt(width) || 64;
                const screenH = parseInt(height) || 64;
                const uv1 = parseFloat(u1) || 0.0;
                const vv1 = parseFloat(v1) || 0.0;
                const uv2 = parseFloat(u2) || 1.0;
                const vv2 = parseFloat(v2) || 1.0;
                const rot = parseFloat(rotation) || 0.0;
                const scl = parseFloat(scale) || 1.0;

                // Set active texture if provided
                if (textureId && typeof textureId === 'string') {
                    d2Graphics.setActiveTexture(textureId);
                }

                d2Graphics.blitTexturedQuad(screenX, screenY, screenW, screenH, uv1, vv1, uv2, vv2, rot, scl);
                return [];
            },

            // Texture management
            loadTexture: (resourcePath, name) => {
                return new Promise(async (resolve) => {
                    try {
                        const data = await this.gameEmulator.loadResource(resourcePath);
                        if (data) {
                            const textureId = d2Graphics.loadD2Texture(data, name || resourcePath);
                            resolve([textureId]);
                        } else {
                            console.warn(`[D2Graphics] Failed to load texture: ${resourcePath}`);
                            resolve([null]);
                        }
                    } catch (error) {
                        console.error(`[D2Graphics] Error loading texture ${resourcePath}:`, error);
                        resolve([null]);
                    }
                });
            },

            setActiveTexture: (textureId) => {
                d2Graphics.setActiveTexture(textureId);
                return [];
            },

            // Palette management
            loadPalette: (resourcePath) => {
                return new Promise(async (resolve) => {
                    try {
                        const data = await this.gameEmulator.loadResource(resourcePath);
                        if (data) {
                            const palette = this.gameEmulator.parsePaletteData(data);
                            d2Graphics.loadActivePalette(palette);
                            resolve([true]);
                        } else {
                            resolve([false]);
                        }
                    } catch (error) {
                        console.error(`[D2Graphics] Error loading palette ${resourcePath}:`, error);
                        resolve([false]);
                    }
                });
            },

            setPaletteOffset: (offset) => {
                d2Graphics.setPaletteOffset(parseInt(offset) || 0);
                return [];
            },

            // Rendering settings
            setColorKey: (enabled, r, g, b) => {
                const colorKeyEnabled = !!enabled;
                const color = {
                    r: parseInt(r) || 255,
                    g: parseInt(g) || 0,
                    b: parseInt(b) || 255
                };
                d2Graphics.setColorKey(colorKeyEnabled, color);
                return [];
            },

            setTextureFiltering: (uLinear, vLinear, antiAlias, bilinear) => {
                d2Graphics.setTextureFiltering(!!uLinear, !!vLinear, !!antiAlias, !!bilinear);
                return [];
            },

            // Utility functions
            getCanvasSize: () => {
                return [d2Graphics.canvas.width, d2Graphics.canvas.height];
            },

            resizeCanvas: (width, height) => {
                d2Graphics.canvas.width = parseInt(width) || 800;
                d2Graphics.canvas.height = parseInt(height) || 600;
                return [];
            }
        };

        // Register the Graphics namespace
        L.setGlobal('Graphics', graphicsNamespace);

        // Register individual functions for backwards compatibility
        L.setGlobal('ClearScreen', graphicsNamespace.clearScreen);
        L.setGlobal('BlitTexture', graphicsNamespace.blitTexture);
        L.setGlobal('LoadTexture', graphicsNamespace.loadTexture);
        L.setGlobal('SetActiveTexture', graphicsNamespace.setActiveTexture);
        L.setGlobal('LoadPalette', graphicsNamespace.loadPalette);
        L.setGlobal('SetPaletteOffset', graphicsNamespace.setPaletteOffset);
        L.setGlobal('SetColorKey', graphicsNamespace.setColorKey);
        L.setGlobal('SetTextureFiltering', graphicsNamespace.setTextureFiltering);

        console.log('[D2GraphicsLuaExtension] Registered D2 Graphics API functions');
    }

    // Cleanup when resetting
    cleanup() {
        console.log('[D2GraphicsLuaExtension] Cleaning up D2 Graphics extension');
    }
}

// Register the extension with the window object
if (typeof window !== 'undefined') {
    window.D2GraphicsLuaExtension = D2GraphicsLuaExtension;
}
