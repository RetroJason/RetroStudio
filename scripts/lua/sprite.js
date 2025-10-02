// sprite.js
// Lua Sprite extension for the game emulator

class LuaSpriteExtensions extends BaseLuaExtension {
    constructor(gameEmulator) {
        super();
        this.gameEmulator = gameEmulator;
        this.spriteManager = null;
        this.initialized = false;
    }

    initialize(luaState) {
        console.log('[LuaSpriteExtensions] Initializing Sprite extension...');
        
        // Note: luaState is already set by the base class setLuaState() method
        
        // Get required services (if available)
        if (this.gameEmulator && this.gameEmulator.d2Graphics && this.gameEmulator.resourceManager) {
            // Create sprite manager
            this.spriteManager = new SpriteManager(
                this.gameEmulator.d2Graphics,
                this.gameEmulator.resourceManager
            );
        } else {
            console.warn('[LuaSpriteExtensions] Game emulator services not available - using mock sprite manager');
            // Create a simple mock sprite manager for testing
            this.spriteManager = {
                createSprite: () => ({ id: Math.random().toString(36) }),
                destroySprite: () => true,
                setPosition: () => true,
                getPosition: () => [0, 0],
                setScale: () => true,
                getScale: () => [1, 1],
                setRotation: () => true,
                getRotation: () => 0,
                setTexture: () => true,
                getTexture: () => '',
                setVisible: () => true,
                isVisible: () => true,
                draw: () => true
            };
        }
        
        // Store reference in game emulator for rendering (if available)
        if (this.gameEmulator) {
            this.gameEmulator.spriteManager = this.spriteManager;
        }
        
        // Register all methods using the base class approach (now works with stack-based reading)
        this.registerMethod('Create', this.Create.bind(this), 'Sprite');
        this.registerMethod('Destroy', this.Destroy.bind(this), 'Sprite');
        this.registerMethod('SetPosition', this.SetPosition.bind(this), 'Sprite');
        this.registerMethod('GetPosition', this.GetPosition.bind(this), 'Sprite');
        this.registerMethod('SetVisible', this.SetVisible.bind(this), 'Sprite');
        this.registerMethod('GetVisible', this.GetVisible.bind(this), 'Sprite');
        this.registerMethod('SetAnimation', this.SetAnimation.bind(this), 'Sprite');
        this.registerMethod('SetFrameIndex', this.SetFrameIndex.bind(this), 'Sprite');
        this.registerMethod('UpdateAnimation', this.UpdateAnimation.bind(this), 'Sprite');
        this.registerMethod('IsHit', this.IsHit.bind(this), 'Sprite');
        this.registerMethod('SetPositionX', this.SetPositionX.bind(this), 'Sprite');
        this.registerMethod('GetPositionX', this.GetPositionX.bind(this), 'Sprite');
        this.registerMethod('SetPositionY', this.SetPositionY.bind(this), 'Sprite');
        this.registerMethod('GetPositionY', this.GetPositionY.bind(this), 'Sprite');
        this.registerMethod('SetPositionZ', this.SetPositionZ.bind(this), 'Sprite');
        this.registerMethod('GetPositionZ', this.GetPositionZ.bind(this), 'Sprite');
        this.registerMethod('SetCenter', this.SetCenter.bind(this), 'Sprite');
        this.registerMethod('GetCenter', this.GetCenter.bind(this), 'Sprite');
        this.registerMethod('SetSize', this.SetSize.bind(this), 'Sprite');
        this.registerMethod('GetSize', this.GetSize.bind(this), 'Sprite');
        this.registerMethod('SetWidth', this.SetWidth.bind(this), 'Sprite');
        this.registerMethod('GetWidth', this.GetWidth.bind(this), 'Sprite');
        this.registerMethod('SetHeight', this.SetHeight.bind(this), 'Sprite');
        this.registerMethod('GetHeight', this.GetHeight.bind(this), 'Sprite');
        this.registerMethod('SetRect', this.SetRect.bind(this), 'Sprite');
        this.registerMethod('GetRect', this.GetRect.bind(this), 'Sprite');
        this.registerMethod('SetRotation', this.SetRotation.bind(this), 'Sprite');
        this.registerMethod('GetRotation', this.GetRotation.bind(this), 'Sprite');
        this.registerMethod('SetScale', this.SetScale.bind(this), 'Sprite');
        this.registerMethod('GetScale', this.GetScale.bind(this), 'Sprite');
        this.registerMethod('SetColor', this.SetColor.bind(this), 'Sprite');
        this.registerMethod('GetColor', this.GetColor.bind(this), 'Sprite');
        this.registerMethod('SetPaletteSlot', this.SetPaletteSlot.bind(this), 'Sprite');
        this.registerMethod('GetPaletteSlot', this.GetPaletteSlot.bind(this), 'Sprite');
        this.registerMethod('SetTextureU0', this.SetTextureU0.bind(this), 'Sprite');
        this.registerMethod('GetTextureU0', this.GetTextureU0.bind(this), 'Sprite');
        this.registerMethod('SetTextureV0', this.SetTextureV0.bind(this), 'Sprite');
        this.registerMethod('GetTextureV0', this.GetTextureV0.bind(this), 'Sprite');
        this.registerMethod('SetTextureU1', this.SetTextureU1.bind(this), 'Sprite');
        this.registerMethod('GetTextureU1', this.GetTextureU1.bind(this), 'Sprite');
        this.registerMethod('SetTextureV1', this.SetTextureV1.bind(this), 'Sprite');
        this.registerMethod('GetTextureV1', this.GetTextureV1.bind(this), 'Sprite');
        this.registerMethod('SetTextureUV', this.SetTextureUV.bind(this), 'Sprite');
        this.registerMethod('GetTextureUV', this.GetTextureUV.bind(this), 'Sprite');
        this.registerMethod('SetAttributes', this.SetAttributes.bind(this), 'Sprite');
        this.registerMethod('GetAttributes', this.GetAttributes.bind(this), 'Sprite');
        
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
        
        // Get the resource ID from Lua stack (index 2 is first parameter) - same as Math functions
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

    SetAnimation() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const label = this.luaState.raw_tostring(3) || '';
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setAnimation(label);
        }
    }

    SetFrameIndex() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const frameIndex = parseInt(this.luaState.raw_tostring(3)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setFrameIndex(frameIndex);
        }
    }

    UpdateAnimation() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const deltaTime = parseFloat(this.luaState.raw_tostring(3)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.updateAnimation(deltaTime);
        }
    }

    IsHit() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return false;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const x = parseFloat(this.luaState.raw_tostring(3)) || 0;
        const y = parseFloat(this.luaState.raw_tostring(4)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.isHit(x, y) : false;
    }

    SetPosition() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack (index 2 is first parameter, index 3 is second, etc.)
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const x = parseFloat(this.luaState.raw_tostring(3)) || 0;
        const y = parseFloat(this.luaState.raw_tostring(4)) || 0;
        const z = parseFloat(this.luaState.raw_tostring(5)) || 0;
        
        console.log(`[SetPosition] spriteId: ${spriteId}, x: ${x}, y: ${y}, z: ${z}`);
        console.log(`[SetPosition] Raw values: spriteId: "${this.luaState.raw_tostring(2)}", x: "${this.luaState.raw_tostring(3)}", y: "${this.luaState.raw_tostring(4)}", z: "${this.luaState.raw_tostring(5)}"`);
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setPosition(x, y, z);
            console.log(`[SetPosition] Set sprite ${spriteId} position to (${x}, ${y}, ${z})`);
        } else {
            console.log(`[SetPosition] Sprite ${spriteId} not found`);
        }
    }

    GetPosition() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return [0, 0, 0];
        }
        
        // Get parameters from Lua stack (index 2 is first parameter)
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        console.log(`[GetPosition] spriteId: ${spriteId}, raw: "${this.luaState.raw_tostring(2)}"`);
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            const pos = sprite.getPosition();
            console.log(`[GetPosition] Sprite ${spriteId} position: x=${pos.x}, y=${pos.y}, z=${pos.z}`);
            const result = [pos.x, pos.y, pos.z];
            console.log(`[GetPosition] Returning array:`, result);
            return result;
        }
        console.log(`[GetPosition] Sprite ${spriteId} not found, returning [0, 0, 0]`);
        return [0, 0, 0];
    }

    SetPositionX() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const x = parseFloat(this.luaState.raw_tostring(3)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setPositionX(x);
        }
    }

    GetPositionX() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return 0;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getPositionX() : 0;
    }

    SetPositionY() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const y = parseFloat(this.luaState.raw_tostring(3)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setPositionY(y);
        }
    }

    GetPositionY() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return 0;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getPositionY() : 0;
    }

    SetPositionZ() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const z = parseFloat(this.luaState.raw_tostring(3)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setPositionZ(z);
        }
    }

    GetPositionZ() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return 0;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getPositionZ() : 0;
    }

    SetCenter() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const x = parseFloat(this.luaState.raw_tostring(3)) || 0;
        const y = parseFloat(this.luaState.raw_tostring(4)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setCenter(x, y);
        }
    }

    GetCenter() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return [0, 0];
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            const center = sprite.getCenter();
            return [center.x, center.y];
        }
        return [0, 0];
    }

    SetSize() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const width = parseFloat(this.luaState.raw_tostring(3)) || 0;
        const height = parseFloat(this.luaState.raw_tostring(4)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setSize(width, height);
        }
    }

    GetSize() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return [0, 0];
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            const size = sprite.getSize();
            return [size.width, size.height];
        }
        return [0, 0];
    }

    SetWidth() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const width = parseFloat(this.luaState.raw_tostring(3)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setWidth(width);
        }
    }

    GetWidth() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return 0;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getWidth() : 0;
    }

    SetHeight() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const height = parseFloat(this.luaState.raw_tostring(3)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setHeight(height);
        }
    }

    GetHeight() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return 0;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getHeight() : 0;
    }

    SetRect() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const x = parseFloat(this.luaState.raw_tostring(3)) || 0;
        const y = parseFloat(this.luaState.raw_tostring(4)) || 0;
        const width = parseFloat(this.luaState.raw_tostring(5)) || 0;
        const height = parseFloat(this.luaState.raw_tostring(6)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setRect(x, y, width, height);
        }
    }

    GetRect() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return [0, 0, 0, 0];
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            const rect = sprite.getRect();
            return [rect.x, rect.y, rect.width, rect.height];
        }
        return [0, 0, 0, 0];
    }

    SetRotation() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const angle = parseFloat(this.luaState.raw_tostring(3)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setRotation(angle);
        }
    }

    GetRotation() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return 0;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getRotation() : 0;
    }

    SetScale() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const scaleX = parseFloat(this.luaState.raw_tostring(3)) || 1.0;
        const scaleY = parseFloat(this.luaState.raw_tostring(4)) || 1.0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setScale(scaleX, scaleY);
        }
    }

    GetScale() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return [1.0, 1.0];
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            const scale = sprite.getScale();
            return [scale.x, scale.y];
        }
        return [1.0, 1.0];
    }

    SetColor() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const color = parseInt(this.luaState.raw_tostring(3)) || 0xFFFFFFFF;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setColor(color);
        }
    }

    GetColor() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return 0xFFFFFFFF;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getColor() : 0xFFFFFFFF;
    }

    SetPaletteSlot() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const slot = parseInt(this.luaState.raw_tostring(3)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setPaletteSlot(slot);
        }
    }

    GetPaletteSlot() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return 0;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getPaletteSlot() : 0;
    }

    SetVisible() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack (index 2 is first parameter, index 3 is second)
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const visibleStr = this.luaState.raw_tostring(3);
        
        // Handle different boolean representations
        let visible = false;
        if (visibleStr === 'true' || visibleStr === '1') {
            visible = true;
        } else if (visibleStr === 'false' || visibleStr === '0') {
            visible = false;
        } else {
            // Try to get as boolean directly if raw_tostring didn't work
            // Check if there's a raw_toboolean or similar method
            visible = visibleStr !== 'null' && visibleStr !== 'nil' && visibleStr !== '';
        }
        
        console.log(`[SetVisible] spriteId: ${spriteId}, visibleStr: "${visibleStr}", visible: ${visible}`);
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setVisible(visible);
            console.log(`[SetVisible] Set sprite ${spriteId} visibility to ${visible}`);
        } else {
            console.log(`[SetVisible] Sprite ${spriteId} not found`);
        }
    }

    GetVisible() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return false;
        }
        
        // Get parameters from Lua stack (index 2 is first parameter)
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getVisible() : false;
    }

    SetTextureU0() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const u0 = parseFloat(this.luaState.raw_tostring(3)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setTextureU0(u0);
        }
    }

    GetTextureU0() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return 0;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getTextureU0() : 0;
    }

    SetTextureV0() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const v0 = parseFloat(this.luaState.raw_tostring(3)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setTextureV0(v0);
        }
    }

    GetTextureV0() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return 0;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getTextureV0() : 0;
    }

    SetTextureU1() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const u1 = parseFloat(this.luaState.raw_tostring(3)) || 1;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setTextureU1(u1);
        }
    }

    GetTextureU1() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return 1;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getTextureU1() : 1;
    }

    SetTextureV1() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const v1 = parseFloat(this.luaState.raw_tostring(3)) || 1;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setTextureV1(v1);
        }
    }

    GetTextureV1() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return 1;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        return sprite ? sprite.getTextureV1() : 1;
    }

    SetTextureUV() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const u0 = parseFloat(this.luaState.raw_tostring(3)) || 0;
        const v0 = parseFloat(this.luaState.raw_tostring(4)) || 0;
        const u1 = parseFloat(this.luaState.raw_tostring(5)) || 1;
        const v1 = parseFloat(this.luaState.raw_tostring(6)) || 1;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setTextureUV(u0, v0, u1, v1);
        }
    }

    GetTextureUV() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return [0, 0, 1, 1];
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            const uv = sprite.getTextureUV();
            return [uv.u0, uv.v0, uv.u1, uv.v1];
        }
        return [0, 0, 1, 1];
    }

    SetAttributes() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        const attributes = parseInt(this.luaState.raw_tostring(3)) || 0;
        
        const sprite = this.spriteManager?.getSprite(spriteId);
        if (sprite) {
            sprite.setAttributes(attributes);
        }
    }

    GetAttributes() {
        if (!this.initialized) {
            console.error('[LuaSpriteExtensions] Not initialized');
            return 0;
        }
        
        // Get parameters from Lua stack
        const spriteId = parseInt(this.luaState.raw_tostring(2)) || 0;
        
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
