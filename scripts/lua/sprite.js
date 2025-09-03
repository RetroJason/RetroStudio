// sprite.js
// Lua Sprite extension for the game emulator

class LuaSpriteExtensions extends BaseLuaExtension {
    constructor(gameEmulator) {
        super();
        this.gameEmulator = gameEmulator;
        this.spriteManager = null;
        this.initialized = false;
    }

    async initialize(luaState) {
        console.log('[LuaSpriteExtensions] Initializing Sprite extension...');
        
        this.setLuaState(luaState);
        
        // Get required services
        if (!this.gameEmulator.d2Graphics) {
            throw new Error('D2Graphics API not available');
        }
        
        if (!this.gameEmulator.resourceManager) {
            throw new Error('Resource manager not available');
        }
        
        // Create sprite manager
        this.spriteManager = new SpriteManager(
            this.gameEmulator.d2Graphics,
            this.gameEmulator
        );
        
        // Store reference in game emulator for rendering
        this.gameEmulator.spriteManager = this.spriteManager;
        
        this.initialized = true;
        console.log('[LuaSpriteExtensions] Sprite extension initialized successfully');
    }

    reset() {
        if (this.spriteManager) {
            this.spriteManager.destroyAll();
        }
        console.log('[LuaSpriteExtensions] Reset complete');
    }

    // Lua function implementations
    Create() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return -1;
        }
        
        // Get the resource ID from Lua stack (index 2 is first parameter)
        const resourceId = this.luaState.raw_tostring(2) || '';
        
        if (!resourceId) {
            console.warn('[LuaSpriteExtensions] Create called with empty resource ID');
            return -1;
        }
        
        try {
            const spriteId = this.spriteManager.create(resourceId);
            console.log(`[LuaSpriteExtensions] Created sprite ${spriteId} from resource ${resourceId}`);
            return spriteId;
        } catch (error) {
            console.error('[LuaSpriteExtensions] Error creating sprite:', error);
            return -1;
        }
    }

    Destroy() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get the sprite ID from Lua stack (index 2 is first parameter)
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        try {
            this.spriteManager.destroy(spriteId);
        } catch (error) {
            console.error('[LuaSpriteExtensions] Error destroying sprite:', error);
        }
    }

    SetAnimation(spriteId, label) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setAnimation(label);
        }
    }

    SetFrameIndex(spriteId, frameIndex) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setFrameIndex(frameIndex);
        }
    }

    UpdateAnimation(spriteId, deltaTime) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.updateAnimation(deltaTime);
        }
    }

    IsHit(spriteId, x, y) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.isHit(x, y) : false;
    }

    SetPosition(spriteId, x, y, z) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setPosition(x, y, z);
        }
    }

    GetPosition(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            const pos = sprite.getPosition();
            return [pos.x, pos.y, pos.z];
        }
        return [0, 0, 0];
    }

    SetPositionX(spriteId, x) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setPositionX(x);
        }
    }

    GetPositionX(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getPositionX() : 0;
    }

    SetPositionY(spriteId, y) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setPositionY(y);
        }
    }

    GetPositionY(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getPositionY() : 0;
    }

    SetPositionZ(spriteId, z) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setPositionZ(z);
        }
    }

    GetPositionZ(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getPositionZ() : 0;
    }

    SetCenter(spriteId, x, y) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setCenter(x, y);
        }
    }

    GetCenter(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            const center = sprite.getCenter();
            return [center.x, center.y];
        }
        return [0, 0];
    }

    SetSize(spriteId, width, height) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setSize(width, height);
        }
    }

    GetSize(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            const size = sprite.getSize();
            return [size.width, size.height];
        }
        return [0, 0];
    }

    SetWidth(spriteId, width) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setWidth(width);
        }
    }

    GetWidth(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getWidth() : 0;
    }

    SetHeight(spriteId, height) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setHeight(height);
        }
    }

    GetHeight(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getHeight() : 0;
    }

    SetRect(spriteId, x, y, width, height) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setRect(x, y, width, height);
        }
    }

    GetRect(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            const rect = sprite.getRect();
            return [rect.x, rect.y, rect.width, rect.height];
        }
        return [0, 0, 0, 0];
    }

    SetRotation(spriteId, angle) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setRotation(angle);
        }
    }

    GetRotation(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getRotation() : 0;
    }

    SetScale(spriteId, scaleX, scaleY) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setScale(scaleX, scaleY);
        }
    }

    GetScale(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            const scale = sprite.getScale();
            return [scale.x, scale.y];
        }
        return [1.0, 1.0];
    }

    SetColor(spriteId, color) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setColor(color);
        }
    }

    GetColor(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getColor() : 0xFFFFFFFF;
    }

    SetPaletteSlot(spriteId, slot) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setPaletteSlot(slot);
        }
    }

    GetPaletteSlot(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getPaletteSlot() : 0;
    }

    SetVisible(spriteId, visible) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setVisible(visible);
        }
    }

    GetVisible(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getVisible() : false;
    }

    SetTextureU0(spriteId, u0) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setTextureU0(u0);
        }
    }

    GetTextureU0(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getTextureU0() : 0;
    }

    SetTextureV0(spriteId, v0) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setTextureV0(v0);
        }
    }

    GetTextureV0(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getTextureV0() : 0;
    }

    SetTextureU1(spriteId, u1) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setTextureU1(u1);
        }
    }

    GetTextureU1(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getTextureU1() : 1;
    }

    SetTextureV1(spriteId, v1) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setTextureV1(v1);
        }
    }

    GetTextureV1(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getTextureV1() : 1;
    }

    SetTextureUV(spriteId, u0, v0, u1, v1) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setTextureUV(u0, v0, u1, v1);
        }
    }

    GetTextureUV(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            const uv = sprite.getTextureUV();
            return [uv.u0, uv.v0, uv.u1, uv.v1];
        }
        return [0, 0, 1, 1];
    }

    SetAttributes(spriteId, attributes) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setAttributes(attributes);
        }
    }

    GetAttributes(spriteId) {
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getAttributes() : 0;
    }
}

// Export for module system and global access
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LuaSpriteExtensions;
} else {
    window.LuaSpriteExtensions = LuaSpriteExtensions;
}
