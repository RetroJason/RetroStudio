// sprite-manager.js
// Manages sprite instances and provides the interface between Lua and D2Graphics

class SpriteManager {
    constructor(d2Graphics, resourceManager) {
        this.d2Graphics = d2Graphics;
        this.resourceManager = resourceManager;
        this.sprites = new Map();
        this.nextSpriteId = 1;
        
        console.log('[SpriteManager] Initialized');
    }
    
    // Create a new sprite from a resource
    create(resourceId) {
        const spriteId = this.nextSpriteId++;
        
        // Validate resource exists
        const resource = this.resourceManager.getResource(resourceId);
        if (!resource) {
            console.error(`[SpriteManager] Resource not found: ${resourceId}`);
            return -1;
        }
        
        // Create sprite instance
        const sprite = new Sprite(spriteId, resourceId, this.d2Graphics, this.resourceManager);
        this.sprites.set(spriteId, sprite);
        
        console.log(`[SpriteManager] Created sprite ${spriteId} from resource ${resourceId}`);
        return spriteId;
    }
    
    // Destroy a sprite
    destroy(spriteId) {
        const sprite = this.sprites.get(spriteId);
        if (sprite) {
            sprite.destroy();
            this.sprites.delete(spriteId);
            console.log(`[SpriteManager] Destroyed sprite ${spriteId}`);
            return true;
        } else {
            console.warn(`[SpriteManager] Sprite not found: ${spriteId}`);
            return false;
        }
    }
    
    // Get a sprite by ID
    getSprite(spriteId) {
        const sprite = this.sprites.get(spriteId);
        if (!sprite) {
            console.warn(`[SpriteManager] Sprite not found: ${spriteId}`);
        }
        return sprite;
    }
    
    // Check if sprite exists
    exists(spriteId) {
        return this.sprites.has(spriteId);
    }
    
    // Get all sprites (for rendering)
    getAllSprites() {
        return Array.from(this.sprites.values());
    }
    
    // Render all visible sprites (sorted by Z order)
    renderAll() {
        const sprites = this.getAllSprites();
        
        // Sort by Z position (back to front)
        sprites.sort((a, b) => a.position.z - b.position.z);
        
        // Render each sprite
        for (const sprite of sprites) {
            sprite.render();
        }
    }
    
    // Update animations for all sprites
    updateAnimations(deltaTime) {
        for (const sprite of this.sprites.values()) {
            sprite.updateAnimation(deltaTime);
        }
    }
    
    // Cleanup all sprites
    destroyAll() {
        console.log(`[SpriteManager] Destroying all ${this.sprites.size} sprites`);
        for (const sprite of this.sprites.values()) {
            sprite.destroy();
        }
        this.sprites.clear();
    }
    
    // Get sprite count
    getCount() {
        return this.sprites.size;
    }
}

// Export for module system and global access
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SpriteManager;
} else {
    window.SpriteManager = SpriteManager;
}
