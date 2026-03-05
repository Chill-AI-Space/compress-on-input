from PIL import Image, ImageDraw
img = Image.new("RGB", (400, 200), "white")
d = ImageDraw.Draw(img)
d.text((50, 80), "Hello Context Trash MCP!", fill="black")
d.text((50, 120), "This is a test screenshot.", fill="black")
img.save("test/fixtures/screenshot.png")
print("Created test/fixtures/screenshot.png")
