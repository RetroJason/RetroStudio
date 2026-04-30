(function () {
  const console = window.RetroStudioLogger?.createConsole('RuntimeHost') ?? window.console;

  function getDefaultPathResolver() {
    return {
      getSourcesRootUi: function () { return 'Sources'; },
      getBuildRootUi: function () { return 'Game Objects'; },
      getBuildStoragePrefix: function () { return 'build/'; },
      normalizeStoragePath: function (path) { return path; },
      isBuildArtifact: function (path) {
        return typeof path === 'string' && path.indexOf('build/') === 0;
      },
    };
  }

  function resolveStudioService(name) {
    if (window.serviceContainer?.has?.(name)) {
      return window.serviceContainer.get(name);
    }

    if (name === 'projectPersistence') {
      return window.retrowwwHostedStudio || null;
    }

    return null;
  }

  function registerStudioService(name, instance) {
    window.serviceContainer?.registerSingleton?.(name, instance);
  }

  function createStudioSimulator(config) {
    const runtimeHostElement = config.runtimeHostElement;
    if (!(runtimeHostElement instanceof HTMLElement)) {
      throw new Error('Studio simulator requires a host HTMLElement.');
    }

    const GameEmulatorClass = typeof GameEmulator === 'function'
      ? GameEmulator
      : window.GameEmulator;

    if (typeof GameEmulatorClass !== 'function') {
      throw new Error('GameEmulator did not load.');
    }

    const gameEmulator = new GameEmulatorClass(runtimeHostElement, {
      hostProfile: config.hostProfile || 'studio',
      runtimeOnly: false,
      resolveService: config.resolveService || resolveStudioService,
      registerService: config.registerService || registerStudioService,
      pathResolver: config.pathResolver || window.ProjectPaths || getDefaultPathResolver(),
      ...config.options,
    });

    return {
      gameEmulator,
      runtimePlayer: null,
      setStatus: function (message, type) {
        gameEmulator.updateStatus?.(message, type);
      },
    };
  }

  function getRequiredElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`RuntimeHost missing required element: ${id}`);
    }
    return element;
  }

  function ensureRwaFile(file) {
    if (!(file instanceof File)) {
      throw new Error('Expected a runtime archive file.');
    }

    if (!file.name.toLowerCase().endsWith('.rwa')) {
      throw new Error('Only .rwa files are accepted.');
    }
  }

  function resolveRuntimeUrl(rawValue) {
    if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
      throw new Error('Runtime URL must be a non-empty string.');
    }

    const resolvedUrl = new URL(rawValue.trim(), window.location.href);
    if (resolvedUrl.origin !== window.location.origin) {
      throw new Error('Runtime simulator only accepts same-origin runtime URLs.');
    }

    return resolvedUrl.toString();
  }

  function createRuntimeSimulator(config) {
    if (typeof window.EmbeddedRuntimePlayer !== 'function') {
      throw new Error('EmbeddedRuntimePlayer did not load.');
    }

    const statusElement = getRequiredElement(config.statusId);
    const statusTextElement = getRequiredElement(config.statusTextId);
    const sourceTextElement = getRequiredElement(config.sourceTextId);
    const urlForm = getRequiredElement(config.urlFormId);
    const urlInput = getRequiredElement(config.urlInputId);
    const browseButton = getRequiredElement(config.browseButtonId);
    const fileInput = getRequiredElement(config.fileInputId);
    const overlay = getRequiredElement(config.overlayId);
    const runtimeHostElement = getRequiredElement(config.runtimeHostId);

    const runtimePlayer = new window.EmbeddedRuntimePlayer(runtimeHostElement, {
      hostProfile: config.hostProfile || 'storefront',
      showConsole: false,
      showReload: false,
      showKeyBindings: false,
      showPlaybackControls: config.showPlaybackControls,
      showVolumeControls: config.showVolumeControls,
      initialVolume: config.initialVolume,
      startMuted: config.startMuted,
      autoFocusCanvas: config.autoFocusCanvas,
      overlayImagePath: config.overlayImagePath || 'Resources/Images/cp-overlay.png',
      pathResolver: config.pathResolver || getDefaultPathResolver(),
    });

    function setStatus(state, message, source) {
      statusElement.dataset.state = state;
      statusTextElement.textContent = message;
      sourceTextElement.textContent = source || '';
    }

    async function loadRuntimeFromUrl(rawValue) {
      const resolvedUrl = resolveRuntimeUrl(rawValue);
      setStatus('loading', 'Loading runtime archive...', resolvedUrl);
      await runtimePlayer.loadRwaFromUrl(resolvedUrl, { credentials: 'same-origin' });
      setStatus('success', 'Runtime archive loaded.', resolvedUrl);

      const searchParams = new URLSearchParams(window.location.search);
      searchParams.set(config.queryParam, rawValue.trim());
      const nextUrl = window.location.pathname + '?' + searchParams.toString();
      window.history.replaceState(null, '', nextUrl);
    }

    async function loadRuntimeFromFile(file) {
      ensureRwaFile(file);
      setStatus('loading', 'Loading local runtime archive...', file.name);
      await runtimePlayer.loadRwaFromFile(file);
      setStatus('success', 'Runtime archive loaded.', file.name);

      const searchParams = new URLSearchParams(window.location.search);
      searchParams.delete(config.queryParam);
      const nextUrl = searchParams.size > 0
        ? window.location.pathname + '?' + searchParams.toString()
        : window.location.pathname;
      window.history.replaceState(null, '', nextUrl);
    }

    async function runLoad(action) {
      try {
        if (typeof config.beforeLoad === 'function') {
          await config.beforeLoad();
        }
        await action();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[RuntimeHost] Load failed:', error);
        setStatus('error', message, '');
      }
    }

    urlForm.addEventListener('submit', function (event) {
      event.preventDefault();
      void runLoad(function () { return loadRuntimeFromUrl(urlInput.value); });
    });

    browseButton.addEventListener('click', function () {
      fileInput.click();
    });

    fileInput.addEventListener('change', function () {
      const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
      if (!file) {
        return;
      }

      void runLoad(function () { return loadRuntimeFromFile(file); });
      fileInput.value = '';
    });

    let dragDepth = 0;

    function showOverlay() {
      overlay.classList.add('visible');
    }

    function hideOverlay() {
      overlay.classList.remove('visible');
    }

    document.addEventListener('dragenter', function (event) {
      if (!(event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files'))) {
        return;
      }

      dragDepth += 1;
      showOverlay();
    });

    document.addEventListener('dragleave', function (event) {
      if (!(event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files'))) {
        return;
      }

      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        hideOverlay();
      }
    });

    document.addEventListener('dragover', function (event) {
      if (!(event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files'))) {
        return;
      }

      event.preventDefault();
    });

    document.addEventListener('drop', function (event) {
      if (!(event.dataTransfer && event.dataTransfer.files)) {
        return;
      }

      event.preventDefault();
      dragDepth = 0;
      hideOverlay();

      const file = event.dataTransfer.files[0];
      if (!file) {
        throw new Error('Drop operation did not include a runtime archive.');
      }

      void runLoad(function () { return loadRuntimeFromFile(file); });
    });

    const initialSearchParams = new URLSearchParams(window.location.search);
    const initialRuntimeUrl = initialSearchParams.get(config.queryParam);
    if (initialRuntimeUrl) {
      urlInput.value = initialRuntimeUrl;
      if (config.autoLoadInitialUrl !== false) {
        void runLoad(function () { return loadRuntimeFromUrl(initialRuntimeUrl); });
      }
    }

    return {
      runtimePlayer,
      loadRuntimeFromUrl,
      loadRuntimeFromFile,
      setStatus,
    };
  }

  window.RuntimeSimulatorHost = {
    create: function (config) {
      return createRuntimeSimulator({
        queryParam: 'rwa',
        hostProfile: 'storefront',
        overlayImagePath: 'Resources/Images/cp-overlay.png',
        ...config,
      });
    },
    createRuntimeSimulator: function (config) {
      return createRuntimeSimulator({
        queryParam: 'rwa',
        hostProfile: 'storefront',
        overlayImagePath: 'Resources/Images/cp-overlay.png',
        ...config,
      });
    },
    createStudioSimulator: function (config) {
      return createStudioSimulator(config || {});
    },
  };
})();