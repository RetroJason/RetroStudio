-- test_math_time.lua
-- Test script for Math and Time functions

function Setup()
    print("=== Math and Time Test ===")
    
    -- Test Math functions
    print("Math.Sin(1.57) =", Math.Sin(1.57))
    print("Math.Cos(0) =", Math.Cos(0))
    print("Math.Sqrt(16) =", Math.Sqrt(16))
    print("Math.Pow(2, 3) =", Math.Pow(2, 3))
    print("Math.Min(5, 10) =", Math.Min(5, 10))
    print("Math.Max(5, 10) =", Math.Max(5, 10))
    print("Math.Clamp(15, 0, 10) =", Math.Clamp(15, 0, 10))
    print("Math.Ceil(3.2) =", Math.Ceil(3.2))
    print("Math.Floor(3.8) =", Math.Floor(3.8))
    print("Math.Round(3.5) =", Math.Round(3.5))
    print("Math.Abs(-5) =", Math.Abs(-5))
    print("Math.Random(1, 10) =", Math.Random(1, 10))
    print("Math.DegreesToRadians(180) =", Math.DegreesToRadians(180))
    print("Math.RadiansToDegrees(3.14159) =", Math.RadiansToDegrees(3.14159))
    
    -- Test Time functions
    print("Time.Hours() =", Time.Hours())
    print("Time.Minutes() =", Time.Minutes())
    print("Time.Seconds() =", Time.Seconds())
    print("Time.Day() =", Time.Day())
    print("Time.Month() =", Time.Month())
    print("Time.Year() =", Time.Year())
    print("Time.DayOfWeek() =", Time.DayOfWeek())
    print("Time.HoursToDegrees() =", Time.HoursToDegrees())
    print("Time.MinutesToDegrees() =", Time.MinutesToDegrees())
    print("Time.SecondsToDegrees() =", Time.SecondsToDegrees())
    print("Time.ToString('%Y-%m-%d %H:%M:%S') =", Time.ToString('%Y-%m-%d %H:%M:%S'))
end

function Update(deltaTime)
    -- Simple test that runs each frame
    if Time.Seconds() % 10 == 0 then
        print("Update running... Current time:", Time.ToString('%H:%M:%S'))
    end
end
