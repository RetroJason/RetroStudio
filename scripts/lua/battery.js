// battery.js - Battery Extensions for Lua
// Provides a simulator battery surface that matches the firmware charge-state table.

class LuaBatteryExtensions extends BaseLuaExtension {
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
      charger_nok_irq_status: 0
    };
  }

  /**
   * Get the current simulator battery charge state.
   * Lua usage: Battery.GetChargeState()
   */
  GetChargeState() {
    const chargeState = this._buildChargeState();
    console.log('[Lua Battery] GetChargeState() =', chargeState);
    return chargeState;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LuaBatteryExtensions;
} else {
  window.LuaBatteryExtensions = LuaBatteryExtensions;
}