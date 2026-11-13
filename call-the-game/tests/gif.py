"""Turn captured frames (<dir>/<name>-NNN.png) into animated previews: python3 gif.py <dir> <name> [width] [fps]"""
import glob, sys
from PIL import Image

d, name = sys.argv[1], sys.argv[2]
width = int(sys.argv[3]) if len(sys.argv) > 3 else 640
fps = int(sys.argv[4]) if len(sys.argv) > 4 else 20
files = sorted(glob.glob(f"{d}/{name}-[0-9][0-9][0-9].png"))
frames = []
for f in files:
    im = Image.open(f).convert("RGB")
    h = round(im.height * width / im.width)
    frames.append(im.resize((width, h), Image.LANCZOS).quantize(colors=200, method=Image.MEDIANCUT, dither=Image.NONE))
frames += [frames[-1]] * (fps // 2)          # hold the last frame half a second
frames[0].save(f"{d}/{name}.gif", save_all=True, append_images=frames[1:], duration=int(1000 / fps), loop=0, optimize=True)
print(f"{d}/{name}.gif", len(frames), "frames")
