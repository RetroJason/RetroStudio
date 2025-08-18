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
    print("Initializing game systems...")
    
    -- Initialize some example systems
    InitializeGraphics()
    InitializeAudio()
    InitializeInput()
    
    print("Setup complete! Game is ready to run.")
end

-- Example system initialization functions
function InitializeGraphics()
    print("Graphics system initialized")
end

function InitializeAudio()
    print("Audio system initialized")
end

function InitializeInput()
    print("Input system initialized")
end

print("Test project loaded successfully!")
