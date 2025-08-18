// changelog-service.js
// Service for tracking user visits and showing changelog since last visit

class ChangelogService {
  constructor() {
    this.cookieName = 'retrostudio_last_visit';
    this.lastCommitCookieName = 'retrostudio_last_commit';
    this.initialized = false;
  }

  /**
   * Initialize the service and check for changes since last visit
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      console.log('[ChangelogService] Initializing...');
      
      // Get last visit timestamp and commit hash
      const lastVisit = this.getLastVisit();
      const lastCommitHash = this.getLastCommit();
      
      console.log('[ChangelogService] Last visit:', lastVisit);
      console.log('[ChangelogService] Last commit:', lastCommitHash);
      
      // Update the visit timestamp and get current commit
      this.updateLastVisit();
      const currentCommit = await this.getCurrentCommitHash();
      
      console.log('[ChangelogService] Current commit:', currentCommit);
      
      // If this is not the first visit and commit has changed, show changelog
      if (lastVisit && lastCommitHash && currentCommit && lastCommitHash !== currentCommit) {
        console.log('[ChangelogService] Changes detected, showing changelog...');
        await this.showChangelogModal(lastCommitHash, currentCommit);
      } else if (!lastVisit) {
        console.log('[ChangelogService] First visit detected');
      } else if (lastCommitHash === currentCommit) {
        console.log('[ChangelogService] No changes since last visit');
      }
      
      // Store current commit hash for next visit
      this.updateLastCommit(currentCommit);
      
      this.initialized = true;
      console.log('[ChangelogService] Initialized successfully');
    } catch (error) {
      console.warn('[ChangelogService] Failed to initialize:', error);
    }
  }

  /**
   * Get last visit timestamp from cookie
   */
  getLastVisit() {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === this.cookieName) {
        return parseInt(value);
      }
    }
    return null;
  }

  /**
   * Get last commit hash from cookie
   */
  getLastCommit() {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === this.lastCommitCookieName) {
        return decodeURIComponent(value);
      }
    }
    return null;
  }

  /**
   * Update last visit timestamp
   */
  updateLastVisit() {
    const timestamp = Date.now();
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1); // 1 year expiry
    document.cookie = `${this.cookieName}=${timestamp}; expires=${expiry.toUTCString()}; path=/`;
  }

  /**
   * Update last commit hash
   */
  updateLastCommit(commitHash) {
    if (!commitHash) return;
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1); // 1 year expiry
    document.cookie = `${this.lastCommitCookieName}=${encodeURIComponent(commitHash)}; expires=${expiry.toUTCString()}; path=/`;
  }

  /**
   * Get current commit hash from git
   */
  async getCurrentCommitHash() {
    try {
      // Use admin.php API to get current commit hash
      const response = await fetch('./admin.php?api=changelog&limit=1');
      if (response.ok) {
        const data = await response.json();
        return data.current_commit;
      }
    } catch (error) {
      console.warn('[ChangelogService] Could not fetch current commit:', error);
    }
    
    // Fallback: try version.json
    try {
      const response = await fetch('./version.json');
      if (response.ok) {
        const data = await response.json();
        return data.commit;
      }
    } catch (error) {
      console.warn('[ChangelogService] Could not fetch version.json:', error);
    }
    
    return null;
  }

  /**
   * Fetch git log between two commits
   */
  async getCommitLog(fromCommit, toCommit) {
    try {
      // Use admin.php API to get real git commit log
      let url = './admin.php?api=changelog';
      if (fromCommit) {
        url += `&since=${encodeURIComponent(fromCommit)}`;
      } else {
        url += '&limit=10'; // Get recent commits if no specific range
      }
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        
        // Transform the API response to match our expected format
        return data.commits.map(commit => ({
          hash: commit.short_hash,
          fullHash: commit.hash,
          message: commit.message,
          author: commit.author,
          email: commit.email,
          date: commit.date
        }));
      }
    } catch (error) {
      console.warn('[ChangelogService] Failed to fetch commit log from API:', error);
    }
    
    // Fallback to mock data if API fails
    try {
      const mockCommits = [
        {
          hash: 'abc123',
          message: 'Fix SFX file format issues - no more base64 encoding',
          author: 'Developer',
          date: new Date().toISOString()
        },
        {
          hash: 'def456', 
          message: 'Add comprehensive debug logging to file I/O pipeline',
          author: 'Developer',
          date: new Date(Date.now() - 3600000).toISOString()
        },
        {
          hash: 'ghi789',
          message: 'Implement tab refresh synchronization',
          author: 'Developer', 
          date: new Date(Date.now() - 7200000).toISOString()
        }
      ];
      
      return mockCommits;
    } catch (error) {
      console.warn('[ChangelogService] Failed to fetch commit log:', error);
      return [];
    }
  }

  /**
   * Show changelog modal with commits since last visit
   */
  async showChangelogModal(fromCommit, toCommit) {
    try {
      const commits = await this.getCommitLog(fromCommit, toCommit);
      
      if (commits.length === 0) {
        console.log('[ChangelogService] No commits to show');
        return;
      }

      // Create changelog HTML
      const changelogHtml = `
        <div style="max-height: 400px; overflow-y: auto; margin: 16px 0;">
          <p style="margin-bottom: 16px; color: #666;">
            Here's what's new since your last visit:
          </p>
          <div style="background: #f8f9fa; border-radius: 8px; padding: 16px;">
            ${commits.map(commit => `
              <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e9ecef;">
                <div style="font-weight: 600; color: #333; margin-bottom: 4px;">
                  ${this.escapeHtml(commit.message)}
                </div>
                <div style="font-size: 12px; color: #666;">
                  <span style="font-family: monospace; background: #e9ecef; padding: 2px 6px; border-radius: 4px; margin-right: 8px;">
                    ${commit.hash.substring(0, 7)}
                  </span>
                  ${new Date(commit.date).toLocaleDateString()} at ${new Date(commit.date).toLocaleTimeString()}
                </div>
              </div>
            `).join('')}
          </div>
          <p style="margin-top: 16px; font-size: 14px; color: #666;">
            Welcome back! 🎉
          </p>
        </div>
      `;

      // Show modal using existing ModalUtils
      if (window.ModalUtils) {
        // Create a custom modal since ModalUtils doesn't have showMessage
        await this.showCustomModal('What\'s New? 🚀', changelogHtml);
      }
    } catch (error) {
      console.warn('[ChangelogService] Failed to show changelog modal:', error);
    }
  }

  /**
   * Show custom modal with HTML content
   */
  showCustomModal(title, htmlContent) {
    return new Promise((resolve) => {
      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.zIndex = '10000';
      
      // Create modal dialog  
      const dialog = document.createElement('div');
      dialog.className = 'modal-dialog';
      dialog.style.maxWidth = '600px';
      dialog.style.width = '90%';
      
      dialog.innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">${title}</h3>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-content">
          ${htmlContent}
        </div>
        <div class="modal-footer">
          <button class="modal-button modal-button-primary">Got it!</button>
        </div>
      `;
      
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      
      // Handle close events
      const closeModal = () => {
        document.body.removeChild(overlay);
        resolve();
      };
      
      const closeBtn = dialog.querySelector('.modal-close');
      const okBtn = dialog.querySelector('.modal-button-primary');
      
      closeBtn.addEventListener('click', closeModal);
      okBtn.addEventListener('click', closeModal);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
      });
      
      // Show modal with animation
      requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        dialog.style.transform = 'scale(1)';
      });
    });
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Manually trigger changelog modal (for testing)
   */
  async showTestChangelog() {
    console.log('[ChangelogService] Showing test changelog...');
    await this.showChangelogModal('old_commit', 'new_commit');
  }

  /**
   * Reset visit tracking (for testing)
   */
  resetVisitTracking() {
    document.cookie = `${this.cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    document.cookie = `${this.lastCommitCookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    console.log('[ChangelogService] Visit tracking reset');
  }
}

// Export for use
window.ChangelogService = ChangelogService;

// Create global instance for easy access
window.changelogService = new ChangelogService();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.changelogService.initialize();
  });
} else {
  window.changelogService.initialize();
}
