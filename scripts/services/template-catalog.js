// template-catalog.js
// Stubbed template catalog service that would normally fetch from server

class TemplateCatalog {
  constructor() {}

  // In the future, replace with a real fetch('/api/templates') call
  async fetchProjectTemplates() {
    // Return four templates with icon, description, and path to local .rwp files
    return [
      {
        id: 'game',
        name: 'Game',
        description: 'Starter project for a basic game.',
        icon: '🎮',
        path: 'templates/GameTemplate.rwp'
      },
      {
        id: 'digital-watch',
        name: 'Digital Watch',
        description: 'Digital watch UI and logic scaffold.',
        icon: '⏱️',
        path: 'templates/DigitalWatchTemplate.rwp'
      },
      {
        id: 'analog-watch',
        name: 'Analog Watch',
        description: 'Analog watch with hands and dial.',
        icon: '🕰️',
        path: 'templates/AnalogWatchTemplate.rwp'
      },
      {
        id: 'app',
        name: 'App',
        description: 'Generic app starter layout.',
        icon: '📱',
        path: 'templates/AppTemplate.rwp'
      }
    ];
  }
}

// Register in service container if available
(function initTemplateCatalog() {
  try {
    const services = window.serviceContainer;
    const instance = new TemplateCatalog();
    if (services && services.registerSingleton) {
      services.registerSingleton('templateCatalog', instance);
    }
    window.templateCatalog = instance;
  } catch (_) {}
})();

window.TemplateCatalog = TemplateCatalog;
