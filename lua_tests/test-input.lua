-- Input Test Script
-- Tests keyboard input functionality with debug output

-- Game state variables
local frameCount = 0
local lastPressedKeys = 0
local lastHeldKeys = 0

-- Track key repeat detection
local keyRepeatCounters = {}
local keyRepeatThreshold = 30 -- frames before considering a key "repeating"

-- Button name lookup for debugging
local buttonNames = {
    [0x0001] = "B (Z key)",
    [0x0002] = "Y (A key)", 
    [0x0004] = "Select (Space)",
    [0x0008] = "Start (Enter)",
    [0x0010] = "Up (↑)",
    [0x0020] = "Down (↓)",
    [0x0040] = "Left (←)",
    [0x0080] = "Right (→)",
    [0x0100] = "A (X key)",
    [0x0200] = "X (S key)",
    [0x0400] = "L (Left Shift)",
    [0x0800] = "R (Right Shift)"
}

function Setup()
    print("=== Input Test Script Started ===")
    print("Press keys to test input system:")
    print("- Arrow keys for D-pad")
    print("- Z/X for B/A buttons")
    print("- A/S for Y/X buttons") 
    print("- Space for Select")
    print("- Enter for Start")
    print("- Shift keys for L/R shoulders")
    print("Focus the game canvas and press keys!")
    print("=====================================")
end

function Update(deltaTime)
    frameCount = frameCount + 1
    
    -- Debug: Print every 60 frames to see if Update is running
    if frameCount % 60 == 0 then
        print("Update() running - frame " .. frameCount)
    end
    
    -- Get current input state
    local currentHeld = Input.GetKeysHeld()
    local currentPressed = Input.GetKeysPressed()
    local currentReleased = Input.GetKeysReleased()
    
    -- Debug: Print input values every 60 frames
    if frameCount % 60 == 0 then
        print("Input values - Held: " .. tostring(currentHeld) .. ", Pressed: " .. tostring(currentPressed) .. ", Released: " .. tostring(currentReleased))
    end
    
    -- Check for newly pressed keys
    if currentPressed ~= 0 then
        print("About to call printPressedKeys with: " .. tostring(currentPressed))
        printPressedKeys(currentPressed)
    end
    
    -- Check for newly released keys
    if currentReleased ~= 0 then
        print("About to call printReleasedKeys with: " .. tostring(currentReleased))
        printReleasedKeys(currentReleased)
    end
    
    -- Check for key repeats (keys held for multiple frames)
    checkKeyRepeats(currentHeld)
    
    -- Test button combinations every frame
    testButtonCombinations()
    
    -- Test individual key checks every 60 frames (once per second)
    if frameCount % 60 == 0 then
        testIndividualKeyChecks()
    end
    
    -- Update previous frame state
    lastPressedKeys = currentPressed
    lastHeldKeys = currentHeld
end

function printPressedKeys(pressedMask)
    print("🔽 KEYS PRESSED:")
    printKeyMask(pressedMask, "  Pressed")
end

function printReleasedKeys(releasedMask)
    print("🔼 KEYS RELEASED:")
    printKeyMask(releasedMask, "  Released")
end

function printKeyMask(keyMask, prefix)
    -- Check each possible button bit
    for buttonMask, buttonName in pairs(buttonNames) do
        if Math.And(keyMask, buttonMask) ~= 0 then
            print(prefix .. ": " .. buttonName .. " (0x" .. string.format("%04X", buttonMask) .. ")")
        end
    end
    print(prefix .. " mask: 0x" .. string.format("%04X", keyMask))
end

function checkKeyRepeats(currentHeld)
    -- Update repeat counters for held keys
    for buttonMask, buttonName in pairs(buttonNames) do
        if Math.And(currentHeld, buttonMask) ~= 0 then
            -- Key is held, increment counter
            if keyRepeatCounters[buttonMask] == nil then
                keyRepeatCounters[buttonMask] = 0
            end
            keyRepeatCounters[buttonMask] = keyRepeatCounters[buttonMask] + 1
            
            -- Check if this key is now repeating
            if keyRepeatCounters[buttonMask] == keyRepeatThreshold then
                print("🔁 KEY REPEAT: " .. buttonName .. " held for " .. keyRepeatThreshold .. " frames")
            elseif keyRepeatCounters[buttonMask] > keyRepeatThreshold and keyRepeatCounters[buttonMask] % 15 == 0 then
                -- Print repeat message every 15 frames after threshold
                print("🔁 KEY REPEAT: " .. buttonName .. " still held (" .. keyRepeatCounters[buttonMask] .. " frames)")
            end
        else
            -- Key is not held, reset counter
            keyRepeatCounters[buttonMask] = nil
        end
    end
end

function testIndividualKeyChecks()
    -- Test the individual key check functions
    local anyKeyHeld = false
    local heldKeys = {}
    
    for buttonMask, buttonName in pairs(buttonNames) do
        if Input.IsKeyHeld(buttonMask) then
            table.insert(heldKeys, buttonName)
            anyKeyHeld = true
        end
    end
    
    if anyKeyHeld then
        print("📊 STATUS UPDATE (Frame " .. frameCount .. "):")
        print("  Currently held keys:")
        for i, keyName in ipairs(heldKeys) do
            print("    - " .. keyName)
        end
    end
end

-- Test specific button combinations
function testButtonCombinations()
    -- Test common gaming combinations
    if Input.IsKeyHeld(Keys.Up) and Input.IsKeyHeld(Keys.A) then
        print("🎮 COMBO: Jump while moving up!")
    end
    
    if Input.IsKeyHeld(Keys.Left) and Input.IsKeyHeld(Keys.Right) then
        print("🎮 CONFLICT: Left and Right pressed simultaneously!")
    end
    
    if Input.IsKeyPressed(Keys.Start) and Input.IsKeyHeld(Keys.Select) then
        print("🎮 COMBO: Start+Select pressed (classic reset combo)!")
    end
end
