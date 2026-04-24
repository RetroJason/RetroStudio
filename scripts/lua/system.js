// system.js - System Extensions for Lua
// Provides system-related functions accessible from Lua scripts

class LuaSystemExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
  }

  _buildChargeState() {
    return {
      plugged_in: false,
      battery_voltage_mv: 4200,
      charger_state: 'off',
      battery_percent: 100,
      charger_main_fsm: 'charger_disabled',
      charger_main_fsm_raw: 0,
      charger_jeita_region: 'charger_disabled',
      charger_die_temp_limit_exceeded: false,
      charger_ok_irq_status: 0,
      charger_nok_irq_status: 0,
    };
  }

  _resolveGameEmulator() {
    const emulator = this.gameEmulator || this._getService('gameEmulator') || window.gameEmulator;

    if (!emulator) {
      throw new Error('[System] SetClearColor emulator backend unavailable');
    }

    return emulator;
  }

  _requireNumericArg(args, stackIndex, methodName, argName) {
    const raw = args[0] ?? this.luaState?.raw_tostring?.(stackIndex);
    if (raw === undefined || raw === null || raw === '') {
      throw new Error(`[System] ${methodName} missing required argument: ${argName}`);
    }

    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`[System] ${methodName} invalid numeric argument ${argName}: ${raw}`);
    }

    return value;
  }

  /**
   * Log a message from Lua to the console
   * Lua usage: System.LogLua("Hello World")
   */
  LogLua() {
    const message = arguments[0] ?? this.luaState?.raw_tostring?.(2);
    if (message === undefined || message === null || message === '') {
      throw new Error('[System] LogLua missing required argument: message');
    }
    console.log('[Lua System]', message);
  }

  /**
   * Set the emulator clear color using a 24-bit RGB integer.
   * Lua usage: System.SetClearColor(0x112233)
   */
  SetClearColor() {
    const color = this._requireNumericArg(arguments, 2, 'SetClearColor', 'color');
    const emulator = this._resolveGameEmulator();
    const rgb = Number(color) >>> 0;
    emulator.clearColor = {
      r: ((rgb >> 16) & 0xFF) / 255,
      g: ((rgb >> 8) & 0xFF) / 255,
      b: (rgb & 0xFF) / 255,
      a: 1,
    };
  }

  /**
   * Return the simulated battery/charger state table.
   * Lua usage: System.GetChargeState()
   */
  GetChargeState() {
    return this._buildChargeState();
  }
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LuaSystemExtensions;
} else {
  window.LuaSystemExtensions = LuaSystemExtensions;
}
