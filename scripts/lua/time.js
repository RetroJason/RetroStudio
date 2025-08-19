// time.js - Time Extensions for Lua
// Provides time and date functions accessible from Lua scripts

class LuaTimeExtensions extends BaseLuaExtension {
  constructor(gameEmulator) {
    super();
    this.gameEmulator = gameEmulator;
  }

  /**
   * Get current hours as degrees for watch hand positioning
   * Lua usage: Time.HoursToDegrees()
   */
  HoursToDegrees() {
    const now = new Date();
    const hours = now.getHours() % 12; // Convert to 12-hour format
    const minutes = now.getMinutes();
    // Calculate degrees: 30 degrees per hour + 0.5 degrees per minute
    const degrees = (hours * 30) + (minutes * 0.5);
    console.log(`[Lua Time] HoursToDegrees() = ${degrees}`);
    return Math.floor(degrees);
  }

  /**
   * Get current minutes as degrees for watch hand positioning
   * Lua usage: Time.MinutesToDegrees()
   */
  MinutesToDegrees() {
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    // Calculate degrees: 6 degrees per minute + 0.1 degrees per second
    const degrees = (minutes * 6) + (seconds * 0.1);
    console.log(`[Lua Time] MinutesToDegrees() = ${degrees}`);
    return Math.floor(degrees);
  }

  /**
   * Get current seconds as degrees for watch hand positioning
   * Lua usage: Time.SecondsToDegrees()
   */
  SecondsToDegrees() {
    const now = new Date();
    const seconds = now.getSeconds();
    // Calculate degrees: 6 degrees per second
    const degrees = seconds * 6;
    console.log(`[Lua Time] SecondsToDegrees() = ${degrees}`);
    return degrees;
  }

  /**
   * Get current hours (24-hour format)
   * Lua usage: Time.Hours()
   */
  Hours() {
    const now = new Date();
    const hours = now.getHours();
    console.log(`[Lua Time] Hours() = ${hours}`);
    return hours;
  }

  /**
   * Get current minutes
   * Lua usage: Time.Minutes()
   */
  Minutes() {
    const now = new Date();
    const minutes = now.getMinutes();
    console.log(`[Lua Time] Minutes() = ${minutes}`);
    return minutes;
  }

  /**
   * Get current seconds
   * Lua usage: Time.Seconds()
   */
  Seconds() {
    const now = new Date();
    const seconds = now.getSeconds();
    console.log(`[Lua Time] Seconds() = ${seconds}`);
    return seconds;
  }

  /**
   * Get current day of month (1-31)
   * Lua usage: Time.Day()
   */
  Day() {
    const now = new Date();
    const day = now.getDate();
    console.log(`[Lua Time] Day() = ${day}`);
    return day;
  }

  /**
   * Get current month (1-12)
   * Lua usage: Time.Month()
   */
  Month() {
    const now = new Date();
    const month = now.getMonth() + 1; // JavaScript months are 0-based
    console.log(`[Lua Time] Month() = ${month}`);
    return month;
  }

  /**
   * Get current year (4-digit)
   * Lua usage: Time.Year()
   */
  Year() {
    const now = new Date();
    const year = now.getFullYear();
    console.log(`[Lua Time] Year() = ${year}`);
    return year;
  }

  /**
   * Get day of week as string
   * Lua usage: Time.DayOfWeek()
   */
  DayOfWeek() {
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = days[now.getDay()];
    console.log(`[Lua Time] DayOfWeek() = ${dayOfWeek}`);
    return dayOfWeek;
  }

  /**
   * Format time using standard C time library format string
   * Lua usage: Time.ToString(format)
   * See: https://en.cppreference.com/w/c/chrono/strftime
   */
  ToString() {
    const format = arguments[0] || '%Y-%m-%d %H:%M:%S';
    const now = new Date();
    
    // Simple implementation of common format specifiers
    let result = format;
    
    // Year formats
    result = result.replace(/%Y/g, now.getFullYear().toString());
    result = result.replace(/%y/g, (now.getFullYear() % 100).toString().padStart(2, '0'));
    
    // Month formats
    result = result.replace(/%m/g, (now.getMonth() + 1).toString().padStart(2, '0'));
    result = result.replace(/%B/g, now.toLocaleString('default', { month: 'long' }));
    result = result.replace(/%b/g, now.toLocaleString('default', { month: 'short' }));
    
    // Day formats
    result = result.replace(/%d/g, now.getDate().toString().padStart(2, '0'));
    result = result.replace(/%e/g, now.getDate().toString());
    result = result.replace(/%A/g, now.toLocaleString('default', { weekday: 'long' }));
    result = result.replace(/%a/g, now.toLocaleString('default', { weekday: 'short' }));
    
    // Time formats
    result = result.replace(/%H/g, now.getHours().toString().padStart(2, '0'));
    result = result.replace(/%I/g, (now.getHours() % 12 || 12).toString().padStart(2, '0'));
    result = result.replace(/%M/g, now.getMinutes().toString().padStart(2, '0'));
    result = result.replace(/%S/g, now.getSeconds().toString().padStart(2, '0'));
    result = result.replace(/%p/g, now.getHours() >= 12 ? 'PM' : 'AM');
    
    // Common combinations
    result = result.replace(/%c/g, now.toLocaleString());
    result = result.replace(/%x/g, now.toLocaleDateString());
    result = result.replace(/%X/g, now.toLocaleTimeString());
    
    console.log(`[Lua Time] ToString("${format}") = "${result}"`);
    return result;
  }
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LuaTimeExtensions;
} else {
  window.LuaTimeExtensions = LuaTimeExtensions;
}
