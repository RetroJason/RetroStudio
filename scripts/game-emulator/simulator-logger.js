(function () {
  const nativeConsole = window.console || {};
  let enabled = (function () {
    try {
      const stored = window.localStorage && window.localStorage.getItem('retrostudio.logging');
      if (stored === 'true') { return true; }
      if (stored === 'false') { return false; }
    } catch (_) {}
    // Debug logging is DISABLED by default to prevent console spam
    // To enable debug logging during development, set in localStorage:
    // window.localStorage.setItem('retrostudio.logging', 'true');
    return false;
  })();

  function emit(level, args, alwaysShow = false) {
    // Errors and warnings always show, regardless of debug logging setting
    const shouldShow = alwaysShow || enabled;
    if (!shouldShow) {
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
      log: function () { emit('log', prefixedArgs(scope, arguments), false); },
      info: function () { emit('info', prefixedArgs(scope, arguments), false); },
      debug: function () { emit('debug', prefixedArgs(scope, arguments), false); },
      warn: function () { emit('warn', prefixedArgs(scope, arguments), true); },
      error: function () { emit('error', prefixedArgs(scope, arguments), true); },
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