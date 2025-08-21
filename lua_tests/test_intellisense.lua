-- Test Lua script for IntelliSense
-- Try typing the following to test IntelliSense features:

-- 1. Type "Math." and see completion suggestions
-- 2. Type "System." and see completion suggestions
-- 3. Hover over function names to see documentation
-- 4. Type function calls with parameters to see signature help

function _init()
    -- Test Math functions with IntelliSense
    local clampedValue = Math.Clamp(150, 0, 100)
    local interpolated = Math.Lerp(0, 100, 0.5)
    
    -- Test System functions
    System.LogLua("Hello from Lua!")
    System.LogLua("Clamped value: " .. clampedValue)
    System.LogLua("Interpolated value: " .. interpolated)
end

function _update()
    -- Try typing new function calls here:
    -- Math.
    -- System.
end

function _draw()
    -- More testing space
    
end
