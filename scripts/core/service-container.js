// service-container.js
// Centralized dependency injection container

class ServiceContainer extends EventTarget {
  constructor() {
    super();
    this.services = new Map();
    this.singletons = new Map();
    this.factories = new Map();
    this.readyServices = new Set();
  }

  // Register a singleton service
  registerSingleton(name, instance) {
    this.singletons.set(name, instance);
    this.readyServices.add(name);
    console.log(`[ServiceContainer] Registered singleton: ${name}`);
    
    // Emit service ready event
    this.dispatchEvent(new CustomEvent('serviceReady', { 
      detail: { serviceName: name, instance } 
    }));
    
    // Emit specific service ready event
    this.dispatchEvent(new CustomEvent(`${name}Ready`, { 
      detail: { instance } 
    }));
  }

  // Register a service factory
  registerFactory(name, factory) {
    this.factories.set(name, factory);
    this.readyServices.add(name);
    console.log(`[ServiceContainer] Registered factory: ${name}`);
    
    // Emit service ready event
    this.dispatchEvent(new CustomEvent('serviceReady', { 
      detail: { serviceName: name, factory } 
    }));
    
    // Emit specific service ready event
    this.dispatchEvent(new CustomEvent(`${name}Ready`, { 
      detail: { factory } 
    }));
  }

  // Register a service class
  registerService(name, serviceClass, dependencies = []) {
    this.services.set(name, { serviceClass, dependencies });
    this.readyServices.add(name);
    console.log(`[ServiceContainer] Registered service: ${name}`);
    
    // Emit service ready event
    this.dispatchEvent(new CustomEvent('serviceReady', { 
      detail: { serviceName: name, serviceClass, dependencies } 
    }));
    
    // Emit specific service ready event
    this.dispatchEvent(new CustomEvent(`${name}Ready`, { 
      detail: { serviceClass, dependencies } 
    }));
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
  
  // Wait for a service to be ready (returns a Promise)
  waitForService(name, timeout = 5000) {
    return new Promise((resolve, reject) => {
      // Check if already available
      if (this.has(name)) {
        resolve(this.get(name));
        return;
      }
      
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.removeEventListener(`${name}Ready`, handler);
        reject(new Error(`Timeout waiting for service: ${name}`));
      }, timeout);
      
      // Set up event listener
      const handler = (event) => {
        clearTimeout(timeoutId);
        this.removeEventListener(`${name}Ready`, handler);
        try {
          resolve(this.get(name));
        } catch (error) {
          reject(error);
        }
      };
      
      this.addEventListener(`${name}Ready`, handler);
    });
  }
  
  // Wait for multiple services to be ready
  waitForServices(names, timeout = 5000) {
    const promises = names.map(name => this.waitForService(name, timeout));
    return Promise.all(promises);
  }
  
  // Check if service is ready (available)
  isServiceReady(name) {
    return this.readyServices.has(name);
  }
}

// Global instance
window.serviceContainer = new ServiceContainer();
window.ServiceContainer = ServiceContainer;
