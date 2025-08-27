/**
 * Progress Reporter Interface
 * Provides a standardized way for builders and other long-running operations 
 * to report progress to the UI using ModalUtils progress system
 */

console.log('[ProgressReporter] Loading progress interface...');

if (typeof window.IProgressReporter === 'undefined') {

/**
 * Progress Reporter Interface
 * Builders can implement this interface to provide progress feedback
 */
class IProgressReporter {
  constructor() {
    this.progressController = null;
    this.currentProgress = 0;
    this.isProgressActive = false;
  }

  /**
   * Start progress reporting with initial message
   * @param {string} title - Progress dialog title
   * @param {string} message - Initial progress message
   * @returns {Promise<void>}
   */
  async startProgress(title, message = 'Starting...') {
    if (this.isProgressActive) {
      console.warn('[ProgressReporter] Progress already active, ignoring startProgress');
      return;
    }

    try {
      // Load ModalUtils if not available
      if (!window.ModalUtils) {
        console.log('[ProgressReporter] Loading ModalUtils for progress reporting...');
        await this.loadModalUtils();
      }

      if (window.ModalUtils && typeof window.ModalUtils.showProgress === 'function') {
        console.log(`[ProgressReporter] Starting progress: ${title}`);
        this.progressController = window.ModalUtils.showProgress(title, message);
        this.currentProgress = 0;
        this.isProgressActive = true;
      } else {
        console.warn('[ProgressReporter] ModalUtils.showProgress not available, progress will be logged only');
      }
    } catch (error) {
      console.error('[ProgressReporter] Failed to start progress:', error);
    }
  }

  /**
   * Update progress percentage and message
   * @param {number} progress - Progress percentage (0-100)
   * @param {string} message - Progress message
   */
  updateProgress(progress, message) {
    this.currentProgress = Math.max(0, Math.min(100, progress));
    
    if (this.progressController && typeof this.progressController.update === 'function') {
      this.progressController.update(this.currentProgress, message);
    }
    
    // Always log progress for debugging
    console.log(`[ProgressReporter] ${this.currentProgress}% - ${message}`);
  }

  /**
   * Complete progress and close dialog
   * @param {string} finalMessage - Final completion message
   */
  completeProgress(finalMessage = 'Complete') {
    if (!this.isProgressActive) {
      return;
    }

    this.updateProgress(100, finalMessage);
    
    // Close progress dialog after a brief delay to show completion
    setTimeout(() => {
      if (this.progressController && typeof this.progressController.close === 'function') {
        this.progressController.close();
      }
      this.progressController = null;
      this.isProgressActive = false;
      console.log('[ProgressReporter] Progress completed and closed');
    }, 500);
  }

  /**
   * Cancel/abort progress
   * @param {string} reason - Cancellation reason
   */
  cancelProgress(reason = 'Cancelled') {
    if (!this.isProgressActive) {
      return;
    }

    console.log(`[ProgressReporter] Progress cancelled: ${reason}`);
    
    if (this.progressController && typeof this.progressController.close === 'function') {
      this.progressController.close();
    }
    
    this.progressController = null;
    this.isProgressActive = false;
  }

  /**
   * Load ModalUtils script if not already loaded
   * @returns {Promise<void>}
   */
  async loadModalUtils() {
    if (window.ModalUtils) {
      return;
    }

    try {
      const script = document.createElement('script');
      script.src = 'scripts/utils/modal-utils.js';
      script.async = true;
      
      return new Promise((resolve, reject) => {
        script.onload = () => {
          console.log('[ProgressReporter] ModalUtils loaded successfully');
          resolve();
        };
        script.onerror = () => {
          console.error('[ProgressReporter] Failed to load ModalUtils');
          reject(new Error('Failed to load ModalUtils'));
        };
        document.head.appendChild(script);
      });
    } catch (error) {
      console.error('[ProgressReporter] Error loading ModalUtils:', error);
      throw error;
    }
  }

  /**
   * Helper method to run an operation with automatic progress reporting
   * @param {string} title - Progress title
   * @param {Function} operation - Async operation to run
   * @param {Object} options - Options { stages?: Array<{progress: number, message: string}> }
   * @returns {Promise<any>} Operation result
   */
  async withProgress(title, operation, options = {}) {
    await this.startProgress(title, 'Initializing...');
    
    try {
      const result = await operation(this);
      this.completeProgress('Success');
      return result;
    } catch (error) {
      this.cancelProgress(`Error: ${error.message}`);
      throw error;
    }
  }
}

// Export to global scope
window.IProgressReporter = IProgressReporter;
console.log('[ProgressReporter] Progress interface loaded');

} // End guard clause
