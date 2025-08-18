-- Test Lua script for RetroStudio
-- This script demonstrates the Setup() function

print("Loading test project...")

-- Define some game variables
local playerName = "Player1"
local gameTitle = "My Awesome Game"
local version = "1.0.0"

-- Setup function - this will be called when the project runs
function Setup()
    print("=== Game Setup ===")
    print("Game Title: " .. gameTitle)
    print("Version: " .. version)
    print("Player Name: " .. playerName)
    
    -- Log to console using the new System class
    System.LogLua("Initializing game systems...")
    
    -- Initialize some example systems
    InitializeGraphics()
    InitializeAudio()
    InitializeInput()
    
    System.LogLua("Setup complete! Game is ready to run.")
end

-- Update function - this will be called every frame
function Update(deltaTime)
    -- This is called every frame at 60fps
    -- deltaTime is the time since last frame in milliseconds
    
    -- Just print occasionally to show it's working
    if math.floor(os.clock()) % 5 == 0 then
        -- Only print every 5 seconds to avoid spam
        System.LogLua("Update running... deltaTime: " .. tostring(deltaTime) .. "ms")
    end
end

-- Example system initialization functions
function InitializeGraphics()
    System.LogLua("Graphics system initialized")
end

function InitializeAudio()
    System.LogLua("Audio system initialized")
end

function InitializeInput()
    System.LogLua("Input system initialized")
end

print("Test project loaded successfully!")
