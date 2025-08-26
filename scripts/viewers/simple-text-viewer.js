/**
 * Simple Text Viewer - Monaco Editor in read-only mode
 * A lightweight text viewer for displaying text files using Monaco Editor
 */

class SimpleTextViewer extends ViewerBase {
  constructor(pathOrFileObj, fullPath = null) {
    // Handle different constructor signatures:
    // 1. SimpleTextViewer(path) - for preview tabs
    // 2. SimpleTextViewer(fileObj, fullPath) - for dedicated tabs from TabManager
    let actualPath;
    let fileData = null;
    
    if (typeof pathOrFileObj === 'string') {
      // Called with just path (preview tabs)
      actualPath = pathOrFileObj;
      console.log('[SimpleTextViewer] Constructor called with path:', actualPath);
    } else if (pathOrFileObj && typeof pathOrFileObj === 'object' && fullPath) {
      // Called with fileObj and fullPath (dedicated tabs)
      actualPath = fullPath;
      fileData = pathOrFileObj;
      console.log('[SimpleTextViewer] Constructor called with fileObj and fullPath:', fullPath);
    } else {
      console.warn('[SimpleTextViewer] Constructor called with unexpected parameters:', pathOrFileObj, fullPath);
      actualPath = pathOrFileObj || 'unknown';
    }
    
    super(actualPath);
    
    this.fileData = fileData;
    this.isReadOnly = true;
    this.editor = null;
    this.container = null;
    this.language = 'plaintext'; // Default language
    
    // Detect language from file path
    if (actualPath) {
      this.language = this.detectLanguage(actualPath);
    }
    
    // Set up event listener for file content updates
    this.boundUpdateHandler = this.handleFileUpdate.bind(this);
    document.addEventListener('file-content-updated', this.boundUpdateHandler);
    
    console.log('[SimpleTextViewer] Detected language:', this.language);
  }

  /**
   * Detect Monaco language from file extension
   */
  detectLanguage(filePath) {
    const filename = filePath.split('/').pop() || filePath;
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    
    const languageMap = {
      '.js': 'javascript',
      '.json': 'json',
      '.html': 'html',
      '.htm': 'html',
      '.css': 'css',
      '.xml': 'xml',
      '.md': 'markdown',
      '.markdown': 'markdown',
      '.lua': 'lua',
      '.py': 'python',
      '.txt': 'plaintext',
      '.log': 'plaintext',
      '.cfg': 'ini',
      '.config': 'xml',
      '.ini': 'ini',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.sql': 'sql',
      '.sh': 'shell',
      '.bat': 'bat',
      '.ps1': 'powershell',
      '.texture': 'json', // Texture files are JSON
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.cs': 'csharp',
      '.java': 'java',
      '.php': 'php',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.jsx': 'javascript'
    };

    return languageMap[ext] || 'plaintext';
  }

  /**
   * Create the viewer element
   */
  createElement() {
    console.log('[SimpleTextViewer] createElement() called');
    
    // Call parent createElement first to get the base structure
    super.createElement();
    
    // Now modify the element to be our container
    this.element.className = 'simple-text-viewer';
    this.element.style.cssText = `
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      position: relative;
    `;

    // Set container to the element for consistency
    this.container = this.element;

    console.log('[SimpleTextViewer] Container created:', this.container);
    console.log('[SimpleTextViewer] createElement() returning element');
    console.log('[SimpleTextViewer] Element type check:', this.element instanceof Node);
    
    return this.element;
  }

  /**
   * Create the main editor body (called by ViewerBase)
   */
  createBody(bodyContainer) {
    console.log('[SimpleTextViewer] createBody() called with bodyContainer:', bodyContainer);
    
    // Check if we have a container (this should be the bodyContainer from ViewerBase)
    if (!bodyContainer) {
      console.error('[SimpleTextViewer] No bodyContainer provided to createBody()');
      return;
    }
    
    console.log('[SimpleTextViewer] BodyContainer exists, proceeding with editor setup');

    // Style the body container for our needs
    bodyContainer.style.cssText = `
      flex: 1;
      width: 100%;
      height: 100%;
      min-height: 400px;
      display: flex;
      flex-direction: column;
      position: relative;
    `;

    // Clear any existing content and add placeholder
    bodyContainer.innerHTML = '';
    
    // Create a placeholder that will be replaced when the editor is ready
    const placeholder = document.createElement('div');
    placeholder.style.cssText = `
      flex: 1;
      width: 100%;
      height: 100%;
      min-height: 400px;
      background: #1e1e1e;
      color: #d4d4d4;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Courier New', monospace;
    `;
    placeholder.textContent = 'Loading text viewer...';
    bodyContainer.appendChild(placeholder);

    // Store reference to body container
    this.bodyContainer = bodyContainer;

    // Initialize the editor asynchronously after the element is added to DOM
    setTimeout(() => {
      this.initializeEditorInBody();
    }, 10);
  }

  /**
   * Initialize the editor in the body container
   */
  initializeEditorInBody() {
    console.log('[SimpleTextViewer] initializeEditorInBody() called');
    
    if (!this.bodyContainer) {
      console.error('[SimpleTextViewer] No bodyContainer available');
      return;
    }

    // Clear the placeholder
    this.bodyContainer.innerHTML = '';

    // Create editor container
    const editorContainer = document.createElement('div');
    editorContainer.style.cssText = `
      flex: 1;
      width: 100%;
      height: 100%;
      min-height: 400px;
      position: relative;
    `;
    console.log('[SimpleTextViewer] Created editor container:', editorContainer);
    this.bodyContainer.appendChild(editorContainer);
    console.log('[SimpleTextViewer] Appended editor container to body container');

    // Wait for container to be in DOM and have dimensions
    const checkAndInitialize = () => {
      if (editorContainer.offsetWidth > 0 && editorContainer.offsetHeight > 0) {
        console.log('[SimpleTextViewer] Container has dimensions, initializing Monaco Editor');
        this.initializeEditor(editorContainer);
      } else {
        console.log('[SimpleTextViewer] Container dimensions still 0, waiting...');
        setTimeout(checkAndInitialize, 50);
      }
    };

    // Start checking for dimensions
    setTimeout(checkAndInitialize, 10);
  }

  /**
   * Initialize Monaco Editor
   */
  async initializeEditor(container) {
    console.log('[SimpleTextViewer] Initializing Monaco Editor...');

    // Wait for Monaco to be available
    if (typeof monaco === 'undefined') {
      console.warn('[SimpleTextViewer] Monaco Editor not available, waiting...');
      // Try again after a short delay
      setTimeout(() => this.initializeEditor(container), 100);
      return;
    }

    try {
      // Get file content
      let content = '';
      
      if (this.fileData && this.fileData.fileContent) {
        // Use preloaded file data
        content = this.fileData.fileContent;
        console.log('[SimpleTextViewer] Using preloaded file content');
      } else if (this.path) {
        // Load file content from storage
        console.log('[SimpleTextViewer] Loading file content from storage:', this.path);
        try {
          const fileManager = window.serviceContainer?.get?.('fileManager') || window.fileManager;
          if (fileManager) {
            const loadedFile = await fileManager.loadFile(this.path.replace(/^test\//, ''));
            if (loadedFile && loadedFile.fileContent) {
              content = loadedFile.fileContent;
              console.log('[SimpleTextViewer] Loaded file content from storage');
            }
          }
        } catch (error) {
          console.error('[SimpleTextViewer] Failed to load file content:', error);
          content = '[Error loading file content]';
        }
      }
      
      // Handle binary data gracefully
      if (typeof content !== 'string') {
        content = '[Binary file - cannot display as text]';
      }

      // Create Monaco Editor instance
      console.log('[SimpleTextViewer] Creating Monaco Editor with content length:', content.length);
      console.log('[SimpleTextViewer] Container dimensions:', container.offsetWidth, 'x', container.offsetHeight);
      
      this.editor = monaco.editor.create(container, {
        value: content,
        language: this.language,
        theme: 'vs-dark',
        readOnly: this.isReadOnly,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        minimap: { enabled: false },
        lineNumbers: 'on',
        wordWrap: 'on',
        folding: true,
        lineDecorationsWidth: 10,
        lineNumbersMinChars: 3,
        glyphMargin: false,
        contextmenu: true,
        selectOnLineNumbers: true,
        roundedSelection: false,
        scrollbar: {
          vertical: 'auto',
          horizontal: 'auto',
          verticalScrollbarSize: 14,
          horizontalScrollbarSize: 14
        }
      });

      console.log('[SimpleTextViewer] Monaco Editor created:', this.editor);
      console.log('[SimpleTextViewer] Monaco Editor container:', this.editor.getContainerDomNode());

      console.log('[SimpleTextViewer] Monaco Editor initialized successfully');
      console.log('[SimpleTextViewer] Content length:', content.length);
      console.log('[SimpleTextViewer] Language:', this.language);

    } catch (error) {
      console.error('[SimpleTextViewer] Failed to initialize Monaco Editor:', error);
      
      // Fallback to simple textarea
      container.innerHTML = `
        <textarea 
          readonly 
          style="width: 100%; height: 100%; font-family: 'Courier New', monospace; 
                 background: #1e1e1e; color: #d4d4d4; border: none; 
                 padding: 10px; resize: none;"
        >Failed to load content</textarea>
      `;
    }
  }

  /**
   * Get the display name for this viewer
   */
  getDisplayName() {
    return 'Text Viewer';
  }

  /**
   * Handle file content update events
   */
  handleFileUpdate(event) {
    const { path, content, timestamp } = event.detail;
    
    // Check if this update is for our file
    if (path && this.path && this.path.includes(path.split('/').pop())) {
      console.log('[SimpleTextViewer] File update detected for:', path);
      console.log('[SimpleTextViewer] Refreshing editor content');
      
      // Update the editor content
      if (this.editor && content) {
        this.editor.setValue(content);
        console.log('[SimpleTextViewer] Editor content updated');
      }
    }
  }

  /**
   * Clean up resources
   */
  dispose() {
    console.log('[SimpleTextViewer] Disposing...');
    
    // Remove event listener
    if (this.boundUpdateHandler) {
      document.removeEventListener('file-content-updated', this.boundUpdateHandler);
    }
    
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
  }

  /**
   * Handle focus event
   */
  onFocus() {
    if (this.editor) {
      this.editor.focus();
    }
  }

  /**
   * Handle blur event
   */
  onBlur() {
    // Nothing specific needed for text viewer
  }
}

// Static metadata for auto-registration
SimpleTextViewer.getFileExtensions = () => ['.json', '.texture'];
SimpleTextViewer.getDisplayName = () => 'Text Viewer';
SimpleTextViewer.getIcon = () => '📄';
SimpleTextViewer.getPriority = () => 50; // Medium priority
SimpleTextViewer.getCapabilities = () => ['text-display', 'syntax-highlighting'];

// Export for use
window.SimpleTextViewer = SimpleTextViewer;
console.log('[SimpleTextViewer] Class exported to window.SimpleTextViewer');

// Auto-register the viewer
if (typeof ComponentRegistry !== 'undefined') {
  SimpleTextViewer.registerComponent();
  console.log('[SimpleTextViewer] Registered with ComponentRegistry');
} else {
  console.warn('[SimpleTextViewer] ComponentRegistry not available, will try again later...');
  
  // Try again after a short delay
  setTimeout(() => {
    if (typeof ComponentRegistry !== 'undefined') {
      console.log('[SimpleTextViewer] ComponentRegistry now available, registering...');
      SimpleTextViewer.registerComponent();
      console.log('[SimpleTextViewer] Late registration successful');
    } else {
      console.error('[SimpleTextViewer] ComponentRegistry still not available after delay');
    }
  }, 1000);
}
