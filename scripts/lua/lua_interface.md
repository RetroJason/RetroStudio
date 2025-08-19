Font
Info
Void Info.SetTitle(String title)

Sets the game title, this will be persisted on save

Void Info.SetAuthor(String author)

Sets the author of the file. This is persisted but when published your retrowatch user name will be listed as the author

Void Info.SetVersion(String version)

Sets version string, persisted on save

Void Info.SetDescription(String description)

Sets the game description, persisted on save

Input
UInt16 Input.GetKeysHeld()

Returns a bit array of keys currently held

UInt16 Input.GetKeysPressed()

Returns the keys pressed since last update

UInt16 Input.GetKeysReleased()

Retuns the keys released since last update

Boolean Input.IsKeyHeld(Keys key)

Returns true if the key is held

Boolean Input.IsKeyPressed(Keys key)

Returns true if the key is pressed

Boolean Input.IsKeyReleased(Keys key)

Returns true if the key is up

Int32 Input.GetKeysDownRepeat()

Returns a bit array of keys held for longer than the key repeat interval

Mask
Void Mask.New(String name, Int16 positionX, Int16 positionY, float positionZ, Int16 width, Int16 height)

Create a mask object

Void Mask.Delete(String name)

Delete a mask object

Boolean Mask.IsHit(Int32 x, Int32 y)

Returns true if the point x and y is inside the object bounding box

Void Mask.SetName(String name, String newName)

Renames an object

Void Mask.SetPosition(String name, Int32 positionX, Int32 positionY, float positionZ)

Set the position of the object (screen relative)

(Int x, Int y, Single z) Mask.GetPosition(String name)

Returns the x y position in pixels (screen relative) of the object

Void Mask.SetPositionX(String name, Int32 positionX)

Set the X position of the object

Int Mask.GetPositionX(String name)

Get the X position of the object

Void Mask.SetPositionY(String name, Int32 positionY)

Set the Y position of the object

Int Mask.GetPositionY(String name)

Get the Y position of the object

Void Mask.SetPositionZ(String name, Int32 positionZ)

Set the Z position of the object

Single Mask.GetPositionZ(String name)

Get the Z position of the object

Void Mask.SetCenter(String name, Int32 centerX, Int32 centerY)

Set the rotation center of the object

(Int centerX, Int centerY) Mask.GetCenter(String name)

Get the rotation center of the object

Void Mask.SetSize(String name, Int32 width, Int32 height)

Set the size of the object

(Int width, Int height) Mask.GetSize(String name)

Gets the size of the object

Void Mask.SetWidth(String name, Int32 width)

Set the width of the object

Int Mask.GetWidth(String name)

Get the width of the object

Void Mask.SetHeight(String name, Int32 height)

Set the height of the object

Int16 Mask.GetHeight(String name)

Get the height of the object

Void Mask.SetRect(String name, Int32 x, Int32 y, Int32 width, Int32 height)

Set the position and size of the object

(Int x, Int y, Int width, Int height) Mask.GetRect(String name)

Gets the position and size of the object

Void Mask.SetRotation(String name, Int32 angle)

Set the rotation angle (degrees)

Int Mask.GetRotation(String name)

Get the rotation angle (degrees)

Void Mask.SetScale(String name, float scaleX, float scaleY)

Set the x and y scale of the object

(Single scaleX, Single scaleY) Mask.GetScale(String name)

Get the x and y scale of the object

Void Mask.SetColor(String name, UInt32 color)

Set the color tint of the object

UInt Mask.GetColor(String name)

Gets the tint color on the object

Void Mask.SetPaletteSlot(String name, Byte paletteSlot)

Set the palette slot for the current frame of animation

Int Mask.GetPaletteSlot(String name)

Get palettel slot of the current frame

Void Mask.SetVisible(String name, Boolean visible)

Set visibility of the object

Boolean Mask.GetVisible(String name)

Get visibility of the object

Void Mask.SetTextureU0(String name, Int32 u0)

Set the texture U0 on the object

Int Mask.GetTextureU0(String name)

Get the texture U0 on the object

Void Mask.SetTextureV0(String name, Int32 v0)

Set the texture V0

Int Mask.GetTextureV0(String name)

Get the texture V0

Void Mask.SetTextureU1(String name, Int32 u1)

Set the texture U1

Int Mask.GetTextureU1(String name)

Get the texture U1

Void Mask.SetTextureV1(String name, Int32 v1)

Set the texture V1

Int Mask.GetTextureV1(String name)

Get the texture V1

Void Mask.SetTextureUV(String name, Int32 u0, Int32 v0, Int32 u1, Int32 v1)

Set the texture cordinates for the object

(Int u0, Int v0, Int u1, Int u2) Mask.GetTextureUV(String name)

Returns the texture coordinates for the object

Void Mask.SetAttributes(String name, UInt16 attributes)

Sets the sprite attributes

UInt16 Mask.GetAttributes(String name)

Get the sprite attributes

Math
Single Math.Sin(float x)

Single Math.Cos(float x)

Single Math.Sqrt(float x)

Single Math.Pow(float x, float y)

Rais X to the power of Y

Single Math.Atan2(float y, float x)

Single Math.Min(float x, float y)

Returns the min of x and y

Single Math.Max(float x, float y)

Returns the max of x and y

Single Math.Clamp(float x, float min, float max)

Clamps x to min and max inclusive

Single Math.Ceil(float x)

Rounds up

Single Math.Floor(float x)

Rounds down

Single Math.Round(float x)

Rounds to nearest integer

Single Math.Abs(float x)

Absoulte value

Int32 Math.And(Int32 x, Int32 y)

Binary AND of x and y

Int32 Math.Not(Int32 x)

Binary inversion of bits in x

Int32 Math.Or(Int32 x, Int32 y)

Binary OR of bits in x and y

Int32 Math.Xor(Int32 x, Int32 y)

Binary xor of bits in x and y

Int32 Math.LShift(Int32 x, Int32 y)

Left shift x by y bits

Int32 Math.RShift(Int32 x, Int32 y)

Right shift x by y bits

Int32 Math.Random(Int32 x, Int32 y)

Produce a random integer greater than or equal to x, less than y

Single Math.RadiansToDegrees(float radians)

Conver Radians to degrees

Single Math.DegreesToRadians(float degrees)

Convert degress to radians

Sfx
Void Sfx.Play(Int32 index)

Plays the specified sound fx.

Song
Void Song.Play(String name)

Plays the specified song, interrupts any previously playing song

Void Song.Stop()

Stops the currently playing song

Sprite
Void Sprite.SetAnimation(String name, String label)

Set the animation, interrupt the current animation

Void Sprite.SetFrameIndex(String name, Int32 frameIndex)

Set the frame index of the current animation

Void Sprite.UpdateAnimation(String name, float deltaTime)

Call this once per update loop to update animations

Void Sprite.Clone(String name, String newName)

Clone this sprite into another sprite

Boolean Sprite.IsHit(Int32 x, Int32 y)

Returns true if the point x and y is inside the object bounding box

Void Sprite.SetName(String name, String newName)

Renames an object

Void Sprite.SetPosition(String name, Int32 positionX, Int32 positionY, float positionZ)

Set the position of the object (screen relative)

(Int x, Int y, Single z) Sprite.GetPosition(String name)

Returns the x y position in pixels (screen relative) of the object

Void Sprite.SetPositionX(String name, Int32 positionX)

Set the X position of the object

Int Sprite.GetPositionX(String name)

Get the X position of the object

Void Sprite.SetPositionY(String name, Int32 positionY)

Set the Y position of the object

Int Sprite.GetPositionY(String name)

Get the Y position of the object

Void Sprite.SetPositionZ(String name, Int32 positionZ)

Set the Z position of the object

Single Sprite.GetPositionZ(String name)

Get the Z position of the object

Void Sprite.SetCenter(String name, Int32 centerX, Int32 centerY)

Set the rotation center of the object

(Int centerX, Int centerY) Sprite.GetCenter(String name)

Get the rotation center of the object

Void Sprite.SetSize(String name, Int32 width, Int32 height)

Set the size of the object

(Int width, Int height) Sprite.GetSize(String name)

Gets the size of the object

Void Sprite.SetWidth(String name, Int32 width)

Set the width of the object

Int Sprite.GetWidth(String name)

Get the width of the object

Void Sprite.SetHeight(String name, Int32 height)

Set the height of the object

Int16 Sprite.GetHeight(String name)

Get the height of the object

Void Sprite.SetRect(String name, Int32 x, Int32 y, Int32 width, Int32 height)

Set the position and size of the object

(Int x, Int y, Int width, Int height) Sprite.GetRect(String name)

Gets the position and size of the object

Void Sprite.SetRotation(String name, Int32 angle)

Set the rotation angle (degrees)

Int Sprite.GetRotation(String name)

Get the rotation angle (degrees)

Void Sprite.SetScale(String name, float scaleX, float scaleY)

Set the x and y scale of the object

(Single scaleX, Single scaleY) Sprite.GetScale(String name)

Get the x and y scale of the object

Void Sprite.SetColor(String name, UInt32 color)

Set the color tint of the object

UInt Sprite.GetColor(String name)

Gets the tint color on the object

Void Sprite.SetPaletteSlot(String name, Byte paletteSlot)

Set the palette slot for the current frame of animation

Int Sprite.GetPaletteSlot(String name)

Get palettel slot of the current frame

Void Sprite.SetVisible(String name, Boolean visible)

Set visibility of the object

Boolean Sprite.GetVisible(String name)

Get visibility of the object

Void Sprite.SetTextureU0(String name, Int32 u0)

Set the texture U0 on the object

Int Sprite.GetTextureU0(String name)

Get the texture U0 on the object

Void Sprite.SetTextureV0(String name, Int32 v0)

Set the texture V0

Int Sprite.GetTextureV0(String name)

Get the texture V0

Void Sprite.SetTextureU1(String name, Int32 u1)

Set the texture U1

Int Sprite.GetTextureU1(String name)

Get the texture U1

Void Sprite.SetTextureV1(String name, Int32 v1)

Set the texture V1

Int Sprite.GetTextureV1(String name)

Get the texture V1

Void Sprite.SetTextureUV(String name, Int32 u0, Int32 v0, Int32 u1, Int32 v1)

Set the texture cordinates for the object

(Int u0, Int v0, Int u1, Int u2) Sprite.GetTextureUV(String name)

Returns the texture coordinates for the object

Void Sprite.SetAttributes(String name, UInt16 attributes)

Sets the sprite attributes

UInt16 Sprite.GetAttributes(String name)

Get the sprite attributes

System
(Int width, Int height) System.GetScreenSize()

Get the screen size

Void System.SetFrameRate(Int32 frameRate)

Set the desired frame rate (frames per second)

Int32 System.GetFrameRate()

return the current target frame rate (not the actual rendered framerate)

Int32 System.ScreenWidth()

Return the screen width in pixels

Int32 System.ScreenHeight()

Return the screen height in pixels

TextBox
Void TextBox.AddText(String name, String font, Int16 positionX, Int16 positionY, float positionZ, UInt32 color, String text)

Create a text box at location specified

Void TextBox.SetText(String name, String text)

Update the text for the specified text box

Boolean TextBox.IsHit(Int32 x, Int32 y)

Returns true if the point x and y is inside the object bounding box

Void TextBox.SetName(String name, String newName)

Renames an object

Void TextBox.SetPosition(String name, Int32 positionX, Int32 positionY, float positionZ)

Set the position of the object (screen relative)

(Int x, Int y, Single z) TextBox.GetPosition(String name)

Returns the x y position in pixels (screen relative) of the object

Void TextBox.SetPositionX(String name, Int32 positionX)

Set the X position of the object

Int TextBox.GetPositionX(String name)

Get the X position of the object

Void TextBox.SetPositionY(String name, Int32 positionY)

Set the Y position of the object

Int TextBox.GetPositionY(String name)

Get the Y position of the object

Void TextBox.SetPositionZ(String name, Int32 positionZ)

Set the Z position of the object

Single TextBox.GetPositionZ(String name)

Get the Z position of the object

Void TextBox.SetCenter(String name, Int32 centerX, Int32 centerY)

Set the rotation center of the object

(Int centerX, Int centerY) TextBox.GetCenter(String name)

Get the rotation center of the object

Void TextBox.SetSize(String name, Int32 width, Int32 height)

Set the size of the object

(Int width, Int height) TextBox.GetSize(String name)

Gets the size of the object

Void TextBox.SetWidth(String name, Int32 width)

Set the width of the object

Int TextBox.GetWidth(String name)

Get the width of the object

Void TextBox.SetHeight(String name, Int32 height)

Set the height of the object

Int16 TextBox.GetHeight(String name)

Get the height of the object

Void TextBox.SetRect(String name, Int32 x, Int32 y, Int32 width, Int32 height)

Set the position and size of the object

(Int x, Int y, Int width, Int height) TextBox.GetRect(String name)

Gets the position and size of the object

Void TextBox.SetRotation(String name, Int32 angle)

Set the rotation angle (degrees)

Int TextBox.GetRotation(String name)

Get the rotation angle (degrees)

Void TextBox.SetScale(String name, float scaleX, float scaleY)

Set the x and y scale of the object

(Single scaleX, Single scaleY) TextBox.GetScale(String name)

Get the x and y scale of the object

Void TextBox.SetColor(String name, UInt32 color)

Set the color tint of the object

UInt TextBox.GetColor(String name)

Gets the tint color on the object

Void TextBox.SetPaletteSlot(String name, Byte paletteSlot)

Set the palette slot for the current frame of animation

Int TextBox.GetPaletteSlot(String name)

Get palettel slot of the current frame

Void TextBox.SetVisible(String name, Boolean visible)

Set visibility of the object

Boolean TextBox.GetVisible(String name)

Get visibility of the object

Void TextBox.SetTextureU0(String name, Int32 u0)

Set the texture U0 on the object

Int TextBox.GetTextureU0(String name)

Get the texture U0 on the object

Void TextBox.SetTextureV0(String name, Int32 v0)

Set the texture V0

Int TextBox.GetTextureV0(String name)

Get the texture V0

Void TextBox.SetTextureU1(String name, Int32 u1)

Set the texture U1

Int TextBox.GetTextureU1(String name)

Get the texture U1

Void TextBox.SetTextureV1(String name, Int32 v1)

Set the texture V1

Int TextBox.GetTextureV1(String name)

Get the texture V1

Void TextBox.SetTextureUV(String name, Int32 u0, Int32 v0, Int32 u1, Int32 v1)

Set the texture cordinates for the object

(Int u0, Int v0, Int u1, Int u2) TextBox.GetTextureUV(String name)

Returns the texture coordinates for the object

Void TextBox.SetAttributes(String name, UInt16 attributes)

Sets the sprite attributes

UInt16 TextBox.GetAttributes(String name)

Get the sprite attributes

TileMap
Void TileMap.CopyTiles(String name, Int16 srcX, Int16 srcY, Int16 srcWidth, Int16 srcHeight, Int16 destX, Int16 destY)

Copies tiles from one area of the tile map to another

Void TileMap.SetTileData(String name, Int16 x, Int16 y, UInt16 value)

Void TileMap.ScreenClamp(String name)

Clamps the tilemap to the screen (prevent scrolling past the edge of the tile map)

Boolean TileMap.IsHit(Int32 x, Int32 y)

Returns true if the point x and y is inside the object bounding box

Void TileMap.SetName(String name, String newName)

Renames an object

Void TileMap.SetPosition(String name, Int32 positionX, Int32 positionY, float positionZ)

Set the position of the object (screen relative)

(Int x, Int y, Single z) TileMap.GetPosition(String name)

Returns the x y position in pixels (screen relative) of the object

Void TileMap.SetPositionX(String name, Int32 positionX)

Set the X position of the object

Int TileMap.GetPositionX(String name)

Get the X position of the object

Void TileMap.SetPositionY(String name, Int32 positionY)

Set the Y position of the object

Int TileMap.GetPositionY(String name)

Get the Y position of the object

Void TileMap.SetPositionZ(String name, Int32 positionZ)

Set the Z position of the object

Single TileMap.GetPositionZ(String name)

Get the Z position of the object

Void TileMap.SetCenter(String name, Int32 centerX, Int32 centerY)

Set the rotation center of the object

(Int centerX, Int centerY) TileMap.GetCenter(String name)

Get the rotation center of the object

Void TileMap.SetSize(String name, Int32 width, Int32 height)

Set the size of the object

(Int width, Int height) TileMap.GetSize(String name)

Gets the size of the object

Void TileMap.SetWidth(String name, Int32 width)

Set the width of the object

Int TileMap.GetWidth(String name)

Get the width of the object

Void TileMap.SetHeight(String name, Int32 height)

Set the height of the object

Int16 TileMap.GetHeight(String name)

Get the height of the object

Void TileMap.SetRect(String name, Int32 x, Int32 y, Int32 width, Int32 height)

Set the position and size of the object

(Int x, Int y, Int width, Int height) TileMap.GetRect(String name)

Gets the position and size of the object

Void TileMap.SetRotation(String name, Int32 angle)

Set the rotation angle (degrees)

Int TileMap.GetRotation(String name)

Get the rotation angle (degrees)

Void TileMap.SetScale(String name, float scaleX, float scaleY)

Set the x and y scale of the object

(Single scaleX, Single scaleY) TileMap.GetScale(String name)

Get the x and y scale of the object

Void TileMap.SetColor(String name, UInt32 color)

Set the color tint of the object

UInt TileMap.GetColor(String name)

Gets the tint color on the object

Void TileMap.SetPaletteSlot(String name, Byte paletteSlot)

Set the palette slot for the current frame of animation

Int TileMap.GetPaletteSlot(String name)

Get palettel slot of the current frame

Void TileMap.SetVisible(String name, Boolean visible)

Set visibility of the object

Boolean TileMap.GetVisible(String name)

Get visibility of the object

Void TileMap.SetTextureU0(String name, Int32 u0)

Set the texture U0 on the object

Int TileMap.GetTextureU0(String name)

Get the texture U0 on the object

Void TileMap.SetTextureV0(String name, Int32 v0)

Set the texture V0

Int TileMap.GetTextureV0(String name)

Get the texture V0

Void TileMap.SetTextureU1(String name, Int32 u1)

Set the texture U1

Int TileMap.GetTextureU1(String name)

Get the texture U1

Void TileMap.SetTextureV1(String name, Int32 v1)

Set the texture V1

Int TileMap.GetTextureV1(String name)

Get the texture V1

Void TileMap.SetTextureUV(String name, Int32 u0, Int32 v0, Int32 u1, Int32 v1)

Set the texture cordinates for the object

(Int u0, Int v0, Int u1, Int u2) TileMap.GetTextureUV(String name)

Returns the texture coordinates for the object

Void TileMap.SetAttributes(String name, UInt16 attributes)

Sets the sprite attributes

UInt16 TileMap.GetAttributes(String name)

Get the sprite attributes

Time
Int32 Time.HoursToDegrees()

Returns the angle corresponding to the current time for positioning a watch hand

Int32 Time.Hours()

Returns the angle corresponding to the current time for positioning a watch hand

Int32 Time.Minutes()

Returns the current minutes

Int32 Time.Seconds()

Returns the current seconds

Int32 Time.Day()

Returns the day of the month (1-31)

Int32 Time.Month()

Returns the month (1-12)

Int32 Time.Year()

Returns the 4 digit year

String Time.DayOfWeek()

Gets the string representation of the day of the week

String Time.ToString(String format)

Uses the standard C time library format string
https://en.cppreference.com/w/c/chrono/strftime