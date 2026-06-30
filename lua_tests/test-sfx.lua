-- Test SFX system with centralized resource management and preloading
local cool_sfx = nil

function Setup()
    System.LogLua("SFX Test Started - Using Centralized Resource System with Preloading")
    
    -- List available SFX resources
    local count = SFX.List()
    System.LogLua("Found " .. count .. " SFX resources in centralized system")
    
    -- Test if we have the COOL sound effect (if built)
    if SFX.COOL then
        System.LogLua("COOL sound effect available: " .. SFX.COOL)
        cool_sfx = SFX.Create("cool")
        
        -- Try to play it (this will use preloaded resources - no loading delay!)
        local success = SFX.Play(cool_sfx, false)
        if success then
            System.LogLua("Successfully started playing COOL sound effect (preloaded)")
        else
            System.LogLua("Failed to play COOL sound effect")
        end
    else
        System.LogLua("COOL sound effect not found - make sure cool.sfx is built to cool.wav")
    end
    
    System.LogLua("All resources were preloaded during game initialization")
end

function Update(deltaTime)
    -- Example: Could check if sound is still playing
    if cool_sfx and SFX.IsPlaying(cool_sfx) then
        -- Sound is playing from preloaded resource
    end
end
