// sprite.js
// Sprite class for managing sprite objects with D2Graphics API integration

class Sprite {
    constructor(id, resourceId, d2Graphics, resourceManager) {
        this.id = id;
        this.resourceId = resourceId;
        this.d2Graphics = d2Graphics;
        this.resourceManager = resourceManager;
        
        // Transform properties (will be set by initializeFromResource)
        this.position = { x: 244, y: 184, z: 0 }; // Default to screen center (488/2, 368/2)
        this.size = { width: 0, height: 0 };
        this.center = { x: 0, y: 0 };
        this.rotation = 0; // degrees
        this.scale = { x: 1.0, y: 1.0 };
        
        // Rendering properties
        this.visible = true;
        this.color = 0xFFFFFFFF; // ARGB - fully opaque white (no tint)
        this.paletteSlot = 0;
        
        // Texture properties (single frame defaults)
        this.textureUV = { u0: 0, v0: 0, u1: 1, v1: 1 };
        this.attributes = 0;
        
        // Animation properties
        this.currentAnimation = null;
        this.frameIndex = 0;
        this.animationTime = 0;
        
        // Initialize from resource (this will override defaults with proper values)
        this.initializeFromResource();
        
        console.log(`[Sprite] Created sprite ${this.id} from resource ${this.resourceId}`);
    }
    
    initializeFromResource() {
        // Screen size constants
        const SCREEN_WIDTH = 488;
        const SCREEN_HEIGHT = 368;
        
        // Get resource info from resource manager
        const resource = this.resourceManager.getResource(this.resourceId);
        if (resource && resource.textureId) {
            this.textureId = resource.textureId;
            
            // Get texture info from D2Graphics
            const texture = this.d2Graphics.textures.get(this.textureId);
            if (texture) {
                // Set size to texture size
                this.size.width = texture.width;
                this.size.height = texture.height;
                
                // Set center of rotation to center of texture
                this.center.x = texture.width / 2;
                this.center.y = texture.height / 2;
                
                // Position sprite so its center is at screen center
                this.position.x = SCREEN_WIDTH / 2;
                this.position.y = SCREEN_HEIGHT / 2;
                this.position.z = 0;
                
                // Set defaults
                this.scale.x = 1.0;
                this.scale.y = 1.0;
                this.visible = true;
                this.rotation = 0;
                
                // Set texture UV to full texture (single frame)
                this.textureUV.u0 = 0;
                this.textureUV.v0 = 0;
                this.textureUV.u1 = 1;
                this.textureUV.v1 = 1;
                
                // Disable filtering by default
                this.d2Graphics.setTextureFiltering(false, false, false, false);
                
                console.log(`[Sprite] Initialized sprite ${this.id} with texture ${texture.name} (${texture.width}x${texture.height}) centered at (${this.position.x}, ${this.position.y})`);
            }
        } else {
            console.warn(`[Sprite] Resource ${this.resourceId} not found or has no texture`);
        }
    }
    
    // Animation methods
    setAnimation(label) {
        this.currentAnimation = label;
        this.frameIndex = 0;
        this.animationTime = 0;
        console.log(`[Sprite] Set animation ${label} for sprite ${this.id}`);
    }
    
    setFrameIndex(frameIndex) {
        this.frameIndex = Math.max(0, frameIndex);
        console.log(`[Sprite] Set frame index ${this.frameIndex} for sprite ${this.id}`);
    }
    
    updateAnimation(deltaTime) {
        if (this.currentAnimation) {
            this.animationTime += deltaTime;
            // TODO: Implement actual animation frame progression based on animation data
            // console.log(`[Sprite] Updated animation for sprite ${this.id}, time: ${this.animationTime}`);
        }
    }
    
    // Hit testing
    isHit(x, y) {
        // Simple bounding box hit test
        const left = this.position.x - this.center.x;
        const right = left + this.size.width;
        const top = this.position.y - this.center.y;
        const bottom = top + this.size.height;
        
        const hit = x >= left && x <= right && y >= top && y <= bottom;
        console.log(`[Sprite] Hit test for sprite ${this.id} at (${x}, ${y}): ${hit}`);
        return hit;
    }
    
    // Position methods
    setPosition(x, y, z) {
        this.position.x = x;
        this.position.y = y;
        this.position.z = z;
    }
    
    getPosition() {
        return { x: this.position.x, y: this.position.y, z: this.position.z };
    }
    
    setPositionX(x) { this.position.x = x; }
    getPositionX() { return this.position.x; }
    
    setPositionY(y) { this.position.y = y; }
    getPositionY() { return this.position.y; }
    
    setPositionZ(z) { this.position.z = z; }
    getPositionZ() { return this.position.z; }
    
    // Center methods
    setCenter(x, y) {
        this.center.x = x;
        this.center.y = y;
    }
    
    getCenter() {
        return { x: this.center.x, y: this.center.y };
    }
    
    // Size methods
    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
    }
    
    getSize() {
        return { width: this.size.width, height: this.size.height };
    }
    
    setWidth(width) { this.size.width = width; }
    getWidth() { return this.size.width; }
    
    setHeight(height) { this.size.height = height; }
    getHeight() { return this.size.height; }
    
    // Rectangle methods
    setRect(x, y, width, height) {
        this.position.x = x;
        this.position.y = y;
        this.size.width = width;
        this.size.height = height;
    }
    
    getRect() {
        return {
            x: this.position.x,
            y: this.position.y,
            width: this.size.width,
            height: this.size.height
        };
    }
    
    // Rotation methods
    setRotation(angle) {
        this.rotation = angle % 360;
    }
    
    getRotation() {
        return this.rotation;
    }
    
    // Scale methods
    setScale(scaleX, scaleY) {
        this.scale.x = scaleX;
        this.scale.y = scaleY;
    }
    
    getScale() {
        return { x: this.scale.x, y: this.scale.y };
    }
    
    // Color methods
    setColor(color) {
        this.color = color;
    }
    
    getColor() {
        return this.color;
    }
    
    // Palette methods
    setPaletteSlot(slot) {
        this.paletteSlot = Math.max(0, Math.min(255, slot));
    }
    
    getPaletteSlot() {
        return this.paletteSlot;
    }
    
    // Visibility methods
    setVisible(visible) {
        this.visible = visible;
    }
    
    getVisible() {
        return this.visible;
    }
    
    // Texture UV methods
    setTextureU0(u0) { this.textureUV.u0 = u0; }
    getTextureU0() { return this.textureUV.u0; }
    
    setTextureV0(v0) { this.textureUV.v0 = v0; }
    getTextureV0() { return this.textureUV.v0; }
    
    setTextureU1(u1) { this.textureUV.u1 = u1; }
    getTextureU1() { return this.textureUV.u1; }
    
    setTextureV1(v1) { this.textureUV.v1 = v1; }
    getTextureV1() { return this.textureUV.v1; }
    
    setTextureUV(u0, v0, u1, v1) {
        this.textureUV.u0 = u0;
        this.textureUV.v0 = v0;
        this.textureUV.u1 = u1;
        this.textureUV.v1 = v1;
    }
    
    getTextureUV() {
        return {
            u0: this.textureUV.u0,
            v0: this.textureUV.v0,
            u1: this.textureUV.u1,
            v1: this.textureUV.v1
        };
    }
    
    // Attributes methods
    setAttributes(attributes) {
        this.attributes = attributes;
    }
    
    getAttributes() {
        return this.attributes;
    }
    
    // Rendering method
    render() {
        if (!this.visible || !this.textureId) {
            return;
        }
        
        // Set the active texture
        this.d2Graphics.setActiveTexture(this.textureId);
        
        // Calculate screen position (accounting for center)
        const screenX = this.position.x - this.center.x;
        const screenY = this.position.y - this.center.y;
        
        // Calculate effective scale (combine sprite scale with uniform scale)
        const effectiveScale = Math.sqrt(this.scale.x * this.scale.y);
        
        // Render using D2Graphics API
        this.d2Graphics.blitTexturedQuad(
            screenX,
            screenY,
            this.size.width,
            this.size.height,
            this.textureUV.u0,
            this.textureUV.v0,
            this.textureUV.u1,
            this.textureUV.v1,
            this.rotation,
            effectiveScale
        );
    }
    
    // Cleanup
    destroy() {
        console.log(`[Sprite] Destroying sprite ${this.id}`);
        // Clear references
        this.d2Graphics = null;
        this.resourceManager = null;
    }
}

// Export for module system and global access
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Sprite;
} else {
    window.Sprite = Sprite;
}
