-- Audio Test Script
-- Demonstrates Music and SFX playback capabilities
-- Created: August 18, 2025

-- Global variables for timing
local lastSfxTime = 0
local sfxInterval = 5.0  -- Play SFX every 5 seconds
local gameTime = 0

function Setup()
    -- Initialize audio test
    System.LogLua("=== Audio Test Starting ===")
    
    -- Start background music with looping
    -- Replace "MUSIC.TINYTUNE" with your actual music resource ID
    if Music then
        System.LogLua("Starting background music...")
        Music.Play("MUSIC.TINYTUNE", 80, true)  -- 80% volume, looping enabled
    else
        System.LogLua("Music extension not available")
    end
    
    -- Log available SFX resources
    if SFX then
        System.LogLua("Available SFX resources:")
        local sfxList = SFX.List()
        for i, sfxName in ipairs(sfxList) do
            System.LogLua("  " .. i .. ": " .. sfxName)
        end
    else
        System.LogLua("SFX extension not available")
    end
    
    System.LogLua("Audio test initialized - SFX will play every " .. sfxInterval .. " seconds")
end

function Update()
    -- Track game time (assuming 60 FPS, so increment by ~0.0167 seconds)
    gameTime = gameTime + (1.0 / 60.0)
    
    -- Check if it's time to play a sound effect
    if gameTime - lastSfxTime >= sfxInterval then
        playSoundEffect()
        lastSfxTime = gameTime
    end
end

function playSoundEffect()
    if not SFX then
        System.LogLua("SFX system not available")
        return
    end
    
    -- Get list of available SFX
    local sfxList = SFX.List()
    
    if #sfxList == 0 then
        System.LogLua("No SFX resources available")
        return
    end
    
    -- Play the first available SFX (you can modify this to cycle through different sounds)
    local sfxToPlay = sfxList[1]
    System.LogLua("Playing SFX: " .. sfxToPlay .. " (game time: " .. string.format("%.2f", gameTime) .. "s)")
    
    -- Play at 100% volume, no repeat
    SFX.Play(sfxToPlay, 100, false)
end

-- Optional: Function to stop all audio (call this if needed for testing)
function stopAllAudio()
    if Music then
        Music.Stop()
        System.LogLua("Background music stopped")
    end
    
    if SFX then
        -- Note: Individual SFX stopping would need to be implemented
        -- For now, just log that we would stop SFX
        System.LogLua("Would stop all SFX (if stop function existed)")
    end
end

-- Optional: Function to adjust music volume dynamically
function setMusicVolume(volume)
    if Music then
        -- Note: Volume adjustment during playback would need to be implemented
        System.LogLua("Would set music volume to " .. volume .. "% (if volume control existed)")
    end
end

-- Test different SFX if multiple are available
function cycleSfxTest()
    if not SFX then
        return
    end
    
    local sfxList = SFX.List()
    if #sfxList > 1 then
        -- Play a different SFX each time based on current time
        local sfxIndex = (math.floor(gameTime / sfxInterval) % #sfxList) + 1
        local sfxToPlay = sfxList[sfxIndex]
        System.LogLua("Cycling SFX: " .. sfxToPlay)
        SFX.Play(sfxToPlay, 100, false)
    else
        playSoundEffect()
    end
end
