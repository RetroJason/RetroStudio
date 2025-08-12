// service-container.js
// Centralized dependency injection container

class ServiceContainer {
  constructor() {
    this.services = new Map();
    this.singletons = new Map();
    this.factories = new Map();
  }

  // Register a singleton service
  registerSingleton(name, instance) {
    this.singletons.set(name, instance);
    console.log(`[ServiceContainer] Registered singleton: ${name}`);
  }

  // Register a service factory
  registerFactory(name, factory) {
    this.factories.set(name, factory);
    console.log(`[ServiceContainer] Registered factory: ${name}`);
  }

  // Register a service class
  registerService(name, serviceClass, dependencies = []) {
    this.services.set(name, { serviceClass, dependencies });
    console.log(`[ServiceContainer] Registered service: ${name}`);
  }

  // Get a service instance
  get(name) {
    // Check singletons first
    if (this.singletons.has(name)) {
      return this.singletons.get(name);
    }

    // Check factories
    if (this.factories.has(name)) {
      const factory = this.factories.get(name);
      return factory();
    }

    // Check registered services
    if (this.services.has(name)) {
      const { serviceClass, dependencies } = this.services.get(name);
      const resolvedDeps = dependencies.map(dep => this.get(dep));
      const instance = new serviceClass(...resolvedDeps);
      
      // Cache as singleton after creation
      this.singletons.set(name, instance);
      return instance;
    }

    throw new Error(`Service not found: ${name}`);
  }

  // Check if service exists
  has(name) {
    return this.singletons.has(name) || 
           this.factories.has(name) || 
           this.services.has(name);
  }

  // Get all registered service names
  getServiceNames() {
    return [
      ...this.singletons.keys(),
      ...this.factories.keys(),
      ...this.services.keys()
    ];
  }
}

// Global instance
window.serviceContainer = new ServiceContainer();
window.ServiceContainer = ServiceContainer;
