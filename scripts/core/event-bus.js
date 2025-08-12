// event-bus.js
// Enhanced event system for decoupled communication

class EventBus {
  constructor() {
    this.listeners = new Map();
    this.middlewares = [];
    this.debugMode = false;
  }

  // Enable debug logging
  enableDebug() {
    this.debugMode = true;
  }

  // Add middleware to process events
  use(middleware) {
    this.middlewares.push(middleware);
  }

  // Subscribe to events
  on(eventName, callback, options = {}) {
    const { once = false, priority = 10, filter = null } = options;
    
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }

    const listener = {
      callback,
      once,
      priority,
      filter,
      id: Math.random().toString(36).substr(2, 9)
    };

    this.listeners.get(eventName).push(listener);
    this.listeners.get(eventName).sort((a, b) => a.priority - b.priority);

    if (this.debugMode) {
      console.log(`[EventBus] Subscribed to ${eventName} (priority: ${priority})`);
    }

    // Return unsubscribe function
    return () => this.off(eventName, listener.id);
  }

  // Subscribe once
  once(eventName, callback, options = {}) {
    return this.on(eventName, callback, { ...options, once: true });
  }

  // Unsubscribe from events
  off(eventName, listenerId) {
    if (this.listeners.has(eventName)) {
      const listeners = this.listeners.get(eventName);
      const index = listeners.findIndex(l => l.id === listenerId);
      if (index !== -1) {
        listeners.splice(index, 1);
        if (this.debugMode) {
          console.log(`[EventBus] Unsubscribed from ${eventName}`);
        }
      }
    }
  }

  // Emit events
  async emit(eventName, data = {}) {
    if (this.debugMode) {
      console.log(`[EventBus] Emitting ${eventName}:`, data);
    }

    // Process through middlewares
    let processedData = data;
    for (const middleware of this.middlewares) {
      try {
        processedData = await middleware(eventName, processedData);
      } catch (error) {
        console.error(`[EventBus] Middleware error for ${eventName}:`, error);
      }
    }

    // Get listeners
    const listeners = this.listeners.get(eventName) || [];
    const results = [];

    // Execute listeners
    for (const listener of listeners) {
      try {
        // Apply filter if specified
        if (listener.filter && !listener.filter(processedData)) {
          continue;
        }

        const result = await listener.callback(processedData);
        results.push(result);

        // Remove once listeners
        if (listener.once) {
          this.off(eventName, listener.id);
        }
      } catch (error) {
        console.error(`[EventBus] Listener error for ${eventName}:`, error);
      }
    }

    return results;
  }

  // Emit and wait for all listeners to complete
  async emitAndWait(eventName, data = {}) {
    const results = await this.emit(eventName, data);
    return results;
  }

  // Get listener count for an event
  getListenerCount(eventName) {
    return this.listeners.get(eventName)?.length || 0;
  }

  // Get all event names
  getEventNames() {
    return Array.from(this.listeners.keys());
  }

  // Clear all listeners
  clear() {
    this.listeners.clear();
    if (this.debugMode) {
      console.log('[EventBus] Cleared all listeners');
    }
  }
}

// Typed event system for better development experience
class TypedEventBus extends EventBus {
  constructor() {
    super();
    this.eventTypes = new Map();
  }

  // Register event type with schema
  registerEventType(eventName, schema) {
    this.eventTypes.set(eventName, schema);
    console.log(`[TypedEventBus] Registered event type: ${eventName}`);
  }

  // Validate event data against schema
  validateEvent(eventName, data) {
    const schema = this.eventTypes.get(eventName);
    if (!schema) return true;

    // Simple validation - could be enhanced with a proper schema library
    for (const [key, type] of Object.entries(schema)) {
      if (data[key] === undefined) {
        if (schema.required && schema.required.includes(key)) {
          throw new Error(`Missing required field: ${key}`);
        }
      } else if (typeof data[key] !== type) {
        throw new Error(`Invalid type for ${key}: expected ${type}, got ${typeof data[key]}`);
      }
    }
    return true;
  }

  // Override emit to add validation
  async emit(eventName, data = {}) {
    try {
      this.validateEvent(eventName, data);
      return await super.emit(eventName, data);
    } catch (error) {
      console.error(`[TypedEventBus] Event validation failed for ${eventName}:`, error);
      throw error;
    }
  }
}

// Global instance
window.eventBus = new TypedEventBus();
window.EventBus = EventBus;
window.TypedEventBus = TypedEventBus;
