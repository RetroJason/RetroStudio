// create-dropdown.js
// Manages the Create dropdown menu

class CreateDropdown {
  constructor() {
    this.dropdown = null;
    this.menu = null;
    this.isOpen = false;
    
    this.initialize();
  }
  
  initialize() {
    this.dropdown = document.getElementById('createDropdown');
    this.menu = document.getElementById('createDropdownMenu');
    const button = document.getElementById('createProjectBtn');
    
    if (!this.dropdown || !this.menu || !button) {
      console.error('[CreateDropdown] Required elements not found');
      return;
    }
    
    // Setup event listeners
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.dropdown.contains(e.target)) {
        this.close();
      }
    });
    
    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
    
    // Populate menu items
    this.populateMenu();
    
    console.log('[CreateDropdown] Initialized');
  }
  
  populateMenu() {
    if (!window.editorRegistry) {
      console.warn('[CreateDropdown] Editor registry not available, retrying in 100ms...');
      // Retry after a short delay in case the registry is still loading
      setTimeout(() => this.populateMenu(), 100);
      return;
    }
    
    const editors = window.editorRegistry.getAllEditors();
    
    // Clear existing menu items
    this.menu.innerHTML = '';
    
    if (editors.length === 0) {
      const noEditorsItem = document.createElement('div');
      noEditorsItem.className = 'dropdown-item disabled';
      noEditorsItem.innerHTML = `
        <span class="dropdown-item-icon">📄</span>
        <span class="dropdown-item-text">No editors available</span>
      `;
      this.menu.appendChild(noEditorsItem);
      console.warn('[CreateDropdown] No editors found in registry');
      return;
    }
    
    // Add menu items for each editor
    editors.forEach(editor => {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.innerHTML = `
        <span class="dropdown-item-icon">${editor.icon}</span>
        <span class="dropdown-item-text">${editor.displayName}</span>
        <span class="dropdown-item-ext">${editor.extension}</span>
      `;
      
      item.addEventListener('click', async () => {
        await this.createNewResource(editor.editorClass);
        this.close();
      });
      
      this.menu.appendChild(item);
    });
    
    console.log(`[CreateDropdown] Populated menu with ${editors.length} editors`);
  }
  
  async createNewResource(editorClass) {
    if (!window.tabManager) {
      console.error('[CreateDropdown] Tab manager not available');
      return;
    }

    try {
      await window.tabManager.createNewResource(editorClass);
    } catch (error) {
      console.error('[CreateDropdown] Failed to create new resource:', error);
      await ModalUtils.showConfirm(
        'Error',
        `Failed to create new resource: ${error.message}`,
        { okText: 'OK', cancelText: null }
      );
    }
  }  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
  
  open() {
    this.dropdown.classList.add('open');
    this.isOpen = true;
    
    // Refresh menu items in case editors were added
    this.populateMenu();
  }
  
  close() {
    this.dropdown.classList.remove('open');
    this.isOpen = false;
  }
}

// Create global instance
window.createDropdown = new CreateDropdown();

// Export for use
window.CreateDropdown = CreateDropdown;
