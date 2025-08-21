// registerable.js
// Interface for components that can register themselves with the ComponentRegistry

class Registerable {
  // Static method to be called by subclasses to auto-register themselves
  static registerComponent() {
    // This should be called by subclasses after their class definition
    if (typeof ComponentRegistry !== 'undefined') {
      const componentType = this.getComponentType();
      ComponentRegistry.register(componentType, this);
    } else {
      console.warn(`[${this.name}] ComponentRegistry not available for registration`);
    }
  }

  // Abstract method - must be implemented by subclasses
  static getComponentType() {
    throw new Error('getComponentType() must be implemented by subclass');
  }

  // Required metadata methods that subclasses should implement
  static getFileExtensions() {
    throw new Error('getFileExtensions() must be implemented by subclass');
  }

  static getDisplayName() {
    throw new Error('getDisplayName() must be implemented by subclass');
  }

  // Optional metadata methods with defaults
  static getIcon() {
    return '📄';
  }

  static getPriority() {
    return 10;
  }

  static getCapabilities() {
    return [];
  }
}

// Export for use
window.Registerable = Registerable;
