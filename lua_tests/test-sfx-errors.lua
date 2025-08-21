-- Test SFX error handling - this will demonstrate JavaScript errors propagating to Lua
function Setup()
    System.LogLua("SFX Error Handling Test Started")
    
    -- Test 1: Try to play a non-existent sound effect
    System.LogLua("=== Test 1: Playing non-existent SFX ===")
    local success, error = pcall(function()
        SFX.Play("SFX.NONEXISTENT", false)
    end)
    
    if not success then
        System.LogLua("ERROR CAUGHT: " .. tostring(error))
    else
        System.LogLua("No error occurred (unexpected)")
    end
    
    -- Test 2: Try to stop a non-existent sound effect
    System.LogLua("=== Test 2: Stopping non-existent SFX ===")
    local success2, error2 = pcall(function()
        SFX.Stop("SFX.NONEXISTENT")
    end)
    
    if not success2 then
        System.LogLua("ERROR CAUGHT: " .. tostring(error2))
    else
        System.LogLua("No error occurred (unexpected)")
    end
    
    -- Test 3: Try to check playing status of non-existent sound
    System.LogLua("=== Test 3: Checking non-existent SFX playing status ===")
    local success3, error3 = pcall(function()
        local isPlaying = SFX.IsPlaying("SFX.NONEXISTENT")
        System.LogLua("IsPlaying result: " .. tostring(isPlaying))
    end)
    
    if not success3 then
        System.LogLua("ERROR CAUGHT: " .. tostring(error3))
    else
        System.LogLua("No error occurred (unexpected)")
    end
    
    -- Test 4: Try to set volume for non-existent sound
    System.LogLua("=== Test 4: Setting volume for non-existent SFX ===")
    local success4, error4 = pcall(function()
        SFX.SetVolume("SFX.NONEXISTENT", 0.5)
    end)
    
    if not success4 then
        System.LogLua("ERROR CAUGHT: " .. tostring(error4))
    else
        System.LogLua("No error occurred (unexpected)")
    end
    
    -- Test 5: List resources (should work)
    System.LogLua("=== Test 5: Listing SFX resources (should work) ===")
    local success5, result5 = pcall(function()
        return SFX.List()
    end)
    
    if success5 then
        System.LogLua("List succeeded, found " .. tostring(result5) .. " resources")
    else
        System.LogLua("ERROR CAUGHT: " .. tostring(result5))
    end
    
    System.LogLua("=== Error handling tests completed ===")
end

function Update(deltaTime)
    -- Nothing to do in update for this test
end
