(function () {
  const nativeConsole = window.console || {};
  let enabled = (function () {
    try {
      const stored = window.localStorage && window.localStorage.getItem('retrostudio.logging');
      if (stored === 'true') { return true; }
      if (stored === 'false') { return false; }
    } catch (_) {}
    const host = (window.location && window.location.hostname) || '';
    return host === 'localhost' || host === '127.0.0.1' || host === '';
  })();

  function emit(level, args) {
    if (!enabled) {
      return;
    }

    const sink = typeof nativeConsole[level] === 'function'
      ? nativeConsole[level]
      : nativeConsole.log;

    if (typeof sink === 'function') {
      sink.apply(nativeConsole, args);
    }
  }

  function prefixedArgs(scope, argsLike) {
    const args = Array.from(argsLike);
    return scope ? [`[${scope}]`, ...args] : args;
  }

  function createConsole(scope) {
    return {
      log: function () { emit('log', prefixedArgs(scope, arguments)); },
      info: function () { emit('info', prefixedArgs(scope, arguments)); },
      debug: function () { emit('debug', prefixedArgs(scope, arguments)); },
      warn: function () { emit('warn', prefixedArgs(scope, arguments)); },
      error: function () { emit('error', prefixedArgs(scope, arguments)); },
    };
  }

  window.RetroStudioLogger = {
    isEnabled: function () {
      return enabled;
    },
    setEnabled: function (value) {
      enabled = Boolean(value);
      try {
        window.localStorage && window.localStorage.setItem('retrostudio.logging', String(enabled));
      } catch (_) {}
      return enabled;
    },
    createConsole: createConsole,
    nativeConsole: nativeConsole,
  };
})();