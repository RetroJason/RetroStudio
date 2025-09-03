// graphics.js - Lua Graphics Extensions
// Provides graphics functions for Lua scripts

class LuaGraphicsExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
    this.d2Graphics = null;
  }

  /**
   * Initialize the graphics extension
   * @param {Object} luaState - The Lua execution state
   */
  async initialize(luaState) {
    this.setLuaState(luaState);
    
    // Get the D2 Graphics API instance from game emulator
    if (this.gameEmulator && this.gameEmulator.d2Graphics) {
      this.d2Graphics = this.gameEmulator.d2Graphics;
      console.log('[LuaGraphicsExtensions] D2 Graphics API connected successfully');
    } else {
      console.warn('[LuaGraphicsExtensions] D2 Graphics API not available in game emulator');
      throw new Error('D2 Graphics API not available');
    }
    
    console.log('[LuaGraphicsExtensions] Graphics extension initialized');
  }

  /**
   * Clear the screen with specified color
   * @param {number} r - Red component (0-255)
   * @param {number} g - Green component (0-255)
   * @param {number} b - Blue component (0-255)
   * @param {number} a - Alpha component (0-255)
   */
  clearScreen(r = 0, g = 0, b = 0, a = 255) {
    if (!this.d2Graphics) {
      console.warn('[LuaGraphicsExtensions] D2 Graphics API not available');
      return false;
    }

    try {
      this.d2Graphics.clearScreen(r / 255, g / 255, b / 255, a / 255);
      return true;
    } catch (error) {
      console.error('[LuaGraphicsExtensions] Error clearing screen:', error);
      return false;
    }
  }

  /**
   * Blit current active texture to screen
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} width - Width (optional, uses texture width if not specified)
   * @param {number} height - Height (optional, uses texture height if not specified)
   */
  blitTexture(x, y, width = null, height = null) {
    if (!this.d2Graphics) {
      console.warn('[LuaGraphicsExtensions] D2 Graphics API not available');
      return false;
    }

    try {
      // Use current active texture dimensions if width/height not specified
      if (width === null || height === null) {
        const textureInfo = this.d2Graphics.getActiveTextureInfo();
        if (textureInfo) {
          width = width || textureInfo.width;
          height = height || textureInfo.height;
        } else {
          console.warn('[LuaGraphicsExtensions] No active texture for blitTexture');
          return false;
        }
      }

      this.d2Graphics.blitTexturedQuad(x, y, width, height);
      return true;
    } catch (error) {
      console.error('[LuaGraphicsExtensions] Error in blitTexture:', error);
      return false;
    }
  }

  /**
   * Blit a textured quad with specified UV coordinates
   * @param {number} x - X coordinate  
   * @param {number} y - Y coordinate  
   * @param {number} width - Width
   * @param {number} height - Height
   * @param {number} u1 - Source U1 coordinate (optional)
   * @param {number} v1 - Source V1 coordinate (optional)
   * @param {number} u2 - Source U2 coordinate (optional)
   * @param {number} v2 - Source V2 coordinate (optional)
   */
  blitTexturedQuad(x, y, width, height, u1 = 0, v1 = 0, u2 = null, v2 = null) {
    if (!this.d2Graphics) {
      console.warn('[LuaGraphicsExtensions] D2 Graphics API not available');
      return false;
    }

    try {
      // If u2/v2 not specified, use full texture coordinates
      if (u2 === null || v2 === null) {
        const textureInfo = this.d2Graphics.getActiveTextureInfo();
        if (textureInfo) {
          u2 = u2 || textureInfo.width;
          v2 = v2 || textureInfo.height;
        } else {
          u2 = u2 || width;
          v2 = v2 || height;
        }
      }

      this.d2Graphics.blitTexturedQuad(x, y, width, height, u1, v1, u2, v2);
      return true;
    } catch (error) {
      console.error('[LuaGraphicsExtensions] Error in blitTexturedQuad:', error);
      return false;
    }
  }

  /**
   * Load a D2 texture from file path
   * @param {string} filePath - Path to D2 texture file
   * @param {string} textureName - Name to assign to loaded texture (optional)
   */
  async loadTexture(filePath, textureName = null) {
    if (!this.d2Graphics) {
      console.warn('[LuaGraphicsExtensions] D2 Graphics API not available');
      return false;
    }

    try {
      const textureId = await this.d2Graphics.loadD2Texture(filePath, textureName);
      return textureId !== null;
    } catch (error) {
      console.error('[LuaGraphicsExtensions] Error loading texture:', error);
      return false;
    }
  }

  /**
   * Set the active texture for rendering
   * @param {string} textureNameOrId - Texture name or ID to make active
   */
  setActiveTexture(textureNameOrId) {
    if (!this.d2Graphics) {
      console.warn('[LuaGraphicsExtensions] D2 Graphics API not available');
      return false;
    }

    try {
      return this.d2Graphics.setActiveTexture(textureNameOrId);
    } catch (error) {
      console.error('[LuaGraphicsExtensions] Error setting active texture:', error);
      return false;
    }
  }

  /**
   * Get information about current active texture
   * @returns {Object|null} Texture info object or null
   */
  getTextureInfo() {
    if (!this.d2Graphics) {
      console.warn('[LuaGraphicsExtensions] D2 Graphics API not available');
      return null;
    }

    try {
      return this.d2Graphics.getActiveTextureInfo();
    } catch (error) {
      console.error('[LuaGraphicsExtensions] Error getting texture info:', error);
      return null;
    }
  }

  /**
   * Load a palette from file path
   * @param {string} filePath - Path to palette file
   * @param {string} paletteName - Name to assign to loaded palette (optional)
   */
  async loadPalette(filePath, paletteName = null) {
    if (!this.d2Graphics) {
      console.warn('[LuaGraphicsExtensions] D2 Graphics API not available');
      return false;
    }

    try {
      const success = await this.d2Graphics.loadActivePalette(filePath, paletteName);
      return success;
    } catch (error) {
      console.error('[LuaGraphicsExtensions] Error loading palette:', error);
      return false;
    }
  }

  /**
   * Set palette offset for color cycling
   * @param {number} offset - Palette offset value
   */
  setPaletteOffset(offset) {
    if (!this.d2Graphics) {
      console.warn('[LuaGraphicsExtensions] D2 Graphics API not available');
      return false;
    }

    try {
      this.d2Graphics.setPaletteOffset(offset);
      return true;
    } catch (error) {
      console.error('[LuaGraphicsExtensions] Error setting palette offset:', error);
      return false;
    }
  }

  /**
   * Get information about current active palette
   * @returns {Object|null} Palette info object or null
   */
  getPaletteInfo() {
    if (!this.d2Graphics) {
      console.warn('[LuaGraphicsExtensions] D2 Graphics API not available');
      return null;
    }

    try {
      return this.d2Graphics.getActivePaletteInfo();
    } catch (error) {
      console.error('[LuaGraphicsExtensions] Error getting palette info:', error);
      return null;
    }
  }

  /**
   * Set color key for transparency
   * @param {number} r - Red component (0-255)
   * @param {number} g - Green component (0-255)
   * @param {number} b - Blue component (0-255)
   */
  setColorKey(r, g, b) {
    if (!this.d2Graphics) {
      console.warn('[LuaGraphicsExtensions] D2 Graphics API not available');
      return false;
    }

    try {
      this.d2Graphics.setColorKey(r, g, b);
      return true;
    } catch (error) {
      console.error('[LuaGraphicsExtensions] Error setting color key:', error);
      return false;
    }
  }

  /**
   * Set texture filtering mode
   * @param {boolean} enabled - True for linear filtering, false for nearest
   */
  setTextureFiltering(enabled) {
    if (!this.d2Graphics) {
      console.warn('[LuaGraphicsExtensions] D2 Graphics API not available');
      return false;
    }

    try {
      this.d2Graphics.setTextureFiltering(enabled);
      return true;
    } catch (error) {
      console.error('[LuaGraphicsExtensions] Error setting texture filtering:', error);
      return false;
    }
  }

  /**
   * Set rendering viewport
   * @param {number} x - X offset
   * @param {number} y - Y offset
   * @param {number} width - Viewport width
   * @param {number} height - Viewport height
   */
  setViewport(x, y, width, height) {
    if (!this.d2Graphics) {
      console.warn('[LuaGraphicsExtensions] D2 Graphics API not available');
      return false;
    }

    try {
      this.d2Graphics.setViewport(x, y, width, height);
      return true;
    } catch (error) {
      console.error('[LuaGraphicsExtensions] Error setting viewport:', error);
      return false;
    }
  }

  /**
   * Set Dave2D-style texture mapping parameters
   * @param {number} dxu - Delta X U mapping
   * @param {number} dxv - Delta X V mapping
   * @param {number} dyu - Delta Y U mapping
   * @param {number} dyv - Delta Y V mapping
   */
  setTextureMapping(dxu, dxv, dyu, dyv) {
    if (!this.d2Graphics) {
      console.warn('[LuaGraphicsExtensions] D2 Graphics API not available');
      return false;
    }

    try {
      this.d2Graphics.setTextureMapping(dxu, dxv, dyu, dyv);
      return true;
    } catch (error) {
      console.error('[LuaGraphicsExtensions] Error setting texture mapping:', error);
      return false;
    }
  }

  /**
   * Enable/disable Dave2D-style texture mapping
   * @param {boolean} enabled - True to enable Dave2D mapping
   */
  enableDave2DMapping(enabled) {
    if (!this.d2Graphics) {
      console.warn('[LuaGraphicsExtensions] D2 Graphics API not available');
      return false;
    }

    try {
      this.d2Graphics.enableDave2DMapping(enabled);
      return true;
    } catch (error) {
      console.error('[LuaGraphicsExtensions] Error enabling Dave2D mapping:', error);
      return false;
    }
  }

  /**
   * Called when the extension is being reset or unloaded
   */
  reset() {
    // Clear any graphics-specific state if needed
    console.log('[LuaGraphicsExtensions] Graphics extension reset');
  }
}

// Export for loading by the extension system
window.LuaGraphicsExtensions = LuaGraphicsExtensions;
