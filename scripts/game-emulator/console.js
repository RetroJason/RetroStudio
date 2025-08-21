// console.js
// Modular debug console with filtering, downloading, and real-time output capture

class GameConsole {
  constructor(options = {}) {
    this.containerId = options.containerId || 'console-container';
    this.rawMessages = [];
    this.isInternalWrite = false;
    this.observer = null;
    this.options = {
      showTimestamps: options.showTimestamps || false,
      maxMessages: options.maxMessages || 10000,
      autoScroll: options.autoScroll !== false,
      showLineNumbers: options.showLineNumbers || false,
      ...options
    };
  }

  // Initialize the console and set up monitoring
  initialize(container) {
    this.container = container;
    this.renderContent();
    this.setupEventListeners();
    this.setupMonitoring();
    this.writeToConsole('Console initialized\n', false);
  }

  // Render all console UI elements
  renderContent() {
    if (!this.container) {
      console.error('[GameConsole] No container provided for rendering');
      return;
    }

    this.container.innerHTML = `
      <div class="console-header">
        <span class="console-title">Debug Console</span>
        <div class="console-controls">
          <button class="console-btn clear-btn" title="Clear Console">
            <span class="console-icon">🗑️</span>
          </button>
          <button class="console-btn settings-btn" title="Console Settings">
            <span class="console-icon">⚙️</span>
          </button>
        </div>
      </div>
      
      <div class="console-content">
        <div class="console-output" id="console-output"></div>
      </div>
      
      <div class="console-footer">
        <div class="console-filter-container">
          <input 
            type="text" 
            id="console-filter-input" 
            class="console-filter-input" 
            placeholder="Filter logs... (+required -excluded &quot;exact&quot;)"
            autocomplete="off"
          />
          <button class="console-download-btn" title="Download Console Logs">
            <span class="download-icon">💾</span>
          </button>
        </div>
      </div>
    `;
  }

  // Set up event listeners for console interactions
  setupEventListeners() {
    const filterInput = this.container.querySelector('#console-filter-input');
    const clearBtn = this.container.querySelector('.clear-btn');
    const downloadBtn = this.container.querySelector('.console-download-btn');
    const settingsBtn = this.container.querySelector('.settings-btn');

    if (filterInput) {
      // Real-time filtering as user types
      filterInput.addEventListener('input', (e) => {
        this.applyFilter(e.target.value);
      });

      // Clear filter on Escape key
      filterInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.target.value = '';
          this.applyFilter('');
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearConsole();
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        this.downloadLogs();
      });
    }

    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        this.toggleSettings();
      });
    }
  }

  // Set up DOM mutation monitoring for external changes
  setupMonitoring() {
    const consoleOutput = this.container.querySelector('#console-output');
    if (!consoleOutput) return;

    this.observer = new MutationObserver((mutations) => {
      if (!this.isInternalWrite) {
        console.warn('[GameConsole] External console modification detected - use writeToConsole() instead');
        this.syncBufferFromDOM();
      }
    });

    this.observer.observe(consoleOutput, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  // Central method to write to console - ALL writes should go through this
  writeToConsole(text, append = true) {
    const consoleOutput = this.container?.querySelector('#console-output');
    if (!consoleOutput) return;

    // Initialize buffer if needed
    if (!this.rawMessages) {
      this.rawMessages = [];
    }

    // Set flag to prevent observer triggering
    this.isInternalWrite = true;

    try {
      if (append) {
        // Add single message to buffer
        const textStr = String(text);
        const message = this.formatMessage(textStr);
        this.rawMessages.push(message);

        // Enforce max message limit
        if (this.rawMessages.length > this.options.maxMessages) {
          this.rawMessages = this.rawMessages.slice(-this.options.maxMessages);
        }
      } else {
        // Replace entire buffer (for bulk operations)
        if (typeof text === 'string') {
          const lines = text.split('\n').filter(line => line.trim() || this.rawMessages.length > 0);
          this.rawMessages = lines.map(line => this.formatMessage(line + '\n'));
        } else if (Array.isArray(text)) {
          this.rawMessages = text.map(line => this.formatMessage(String(line)));
        } else {
          this.rawMessages = [this.formatMessage(String(text))];
        }
      }

      // Apply current filter and update display
      this.updateDisplay();

    } finally {
      // Always clear the flag
      this.isInternalWrite = false;
    }
  }

  // Format a message with optional timestamp and line numbers
  formatMessage(text) {
    let formatted = String(text);
    
    // Ensure newline ending
    if (!formatted.endsWith('\n')) {
      formatted += '\n';
    }

    // Add timestamp if enabled
    if (this.options.showTimestamps) {
      const timestamp = new Date().toLocaleTimeString();
      formatted = `[${timestamp}] ${formatted}`;
    }

    return formatted;
  }

  // Apply filter and update console display
  applyFilter(filterStr) {
    // Store current filter for future updates
    this.currentFilter = filterStr;
    this.updateDisplay();
  }

  // Update the console display with current filter
  updateDisplay() {
    const consoleOutput = this.container?.querySelector('#console-output');
    if (!consoleOutput || !this.rawMessages) return;

    const wasInternalWrite = this.isInternalWrite;
    if (!wasInternalWrite) {
      this.isInternalWrite = true;
    }

    try {
      const filterInput = this.container.querySelector('#console-filter-input');
      const filterValue = this.currentFilter || (filterInput ? filterInput.value.trim() : '');

      if (!filterValue) {
        // No filter, show all messages
        consoleOutput.textContent = this.rawMessages.join('');
      } else {
        // Apply filter
        const filter = this.parseFilterString(filterValue);
        const filteredMessages = this.rawMessages.filter(message => this.matchesFilter(message, filter));
        consoleOutput.textContent = filteredMessages.join('');
      }

      // Auto-scroll to bottom if enabled
      if (this.options.autoScroll) {
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
      }

    } finally {
      if (!wasInternalWrite) {
        this.isInternalWrite = false;
      }
    }
  }

  // Parse filter string into structured filter object
  parseFilterString(filterStr) {
    if (!filterStr || !filterStr.trim()) return null;

    const filter = {
      required: [],    // Terms that must be present (+term)
      excluded: [],    // Terms that must be absent (-term)
      exact: [],       // Exact phrases ("phrase")
      optional: []     // Terms that are nice to have (just term)
    };

    // Tokenize the filter string respecting quotes
    const tokens = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < filterStr.length; i++) {
      const char = filterStr[i];
      
      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
        current += char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        current += char;
        tokens.push(current.trim());
        current = '';
        quoteChar = '';
      } else if (char === ' ' && !inQuotes) {
        if (current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      tokens.push(current.trim());
    }

    // Parse tokens into filter categories
    for (const token of tokens) {
      const trimmed = token.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('+')) {
        const term = trimmed.substring(1);
        if (term.startsWith('"') && term.endsWith('"')) {
          filter.exact.push(term.slice(1, -1));
        } else {
          filter.required.push(term.toLowerCase());
        }
      } else if (trimmed.startsWith('-')) {
        const term = trimmed.substring(1);
        if (term.startsWith('"') && term.endsWith('"')) {
          filter.excluded.push(term.slice(1, -1));
        } else {
          filter.excluded.push(term.toLowerCase());
        }
      } else if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        filter.exact.push(trimmed.slice(1, -1));
      } else {
        filter.optional.push(trimmed.toLowerCase());
      }
    }

    return filter;
  }

  // Check if a message matches the filter criteria
  matchesFilter(message, filter) {
    if (!filter) return true;

    const messageLower = message.toLowerCase();

    // Check required terms (must all be present)
    for (const term of filter.required) {
      if (!messageLower.includes(term)) {
        return false;
      }
    }

    // Check excluded terms (none should be present)
    for (const term of filter.excluded) {
      if (messageLower.includes(term)) {
        return false;
      }
    }

    // Check exact phrases (case-sensitive)
    for (const phrase of filter.exact) {
      if (!message.includes(phrase)) {
        return false;
      }
    }

    // If we have optional terms, at least one should match
    if (filter.optional.length > 0) {
      const hasOptional = filter.optional.some(term => messageLower.includes(term));
      if (!hasOptional) {
        return false;
      }
    }

    return true;
  }

  // Sync buffer from DOM content (fallback for external changes)
  syncBufferFromDOM() {
    const consoleOutput = this.container?.querySelector('#console-output');
    if (!consoleOutput) return;

    const content = consoleOutput.textContent || '';
    if (content) {
      const lines = content.split('\n').filter(line => line.trim());
      this.rawMessages = lines.map(line => this.formatMessage(line));
    }
  }

  // Clear all console content
  clearConsole() {
    this.rawMessages = [];
    this.currentFilter = '';
    
    const filterInput = this.container?.querySelector('#console-filter-input');
    if (filterInput) {
      filterInput.value = '';
    }

    this.updateDisplay();
  }

  // Download console logs as text file
  downloadLogs() {
    if (!this.rawMessages || this.rawMessages.length === 0) {
      alert('No console logs to download');
      return;
    }

    try {
      const content = this.rawMessages.join('');
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `console-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      URL.revokeObjectURL(url);
      
      this.writeToConsole(`Downloaded ${this.rawMessages.length} log entries\n`);
    } catch (error) {
      console.error('[GameConsole] Error downloading logs:', error);
      alert('Error downloading console logs');
    }
  }

  // Toggle console settings panel
  toggleSettings() {
    // TODO: Implement settings panel for timestamp, line numbers, etc.
    console.log('[GameConsole] Settings panel not yet implemented');
  }

  // Get current buffer for external access
  getMessages() {
    return [...this.rawMessages];
  }

  // Set messages from external source
  setMessages(messages) {
    this.writeToConsole(messages, false);
  }

  // Cleanup method
  cleanup() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    this.rawMessages = [];
    this.isInternalWrite = false;
    this.currentFilter = '';
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GameConsole;
} else if (typeof window !== 'undefined') {
  window.GameConsole = GameConsole;
}
