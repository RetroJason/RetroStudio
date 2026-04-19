local face
local hand_hour
local hand_minute
local hand_seconds

function Update(delta_t)
  Image.SetAngle(hand_hour, Time.HoursToDegrees())
  Image.SetAngle(hand_minute, Time.MinutesToDegrees())
  Image.SetAngle(hand_seconds, Time.SecondsToDegrees())

end


function Setup()
  face = Image.Create("face")
  hand_hour = Image.Create("hand_01_h")
  hand_minute = Image.Create("hand_01_m")
  hand_seconds = Image.Create("hand_01_s")
end