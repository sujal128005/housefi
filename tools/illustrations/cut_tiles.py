# Cuts the generated illustration sheets into one rounded-square WebP per app image name (assets/illustrations).
# Usage: python tools/illustrations/cut_tiles.py <folder with the sheets> assets/illustrations <preview.jpg>
# Needs Pillow and numpy. MAP below says which tile of which sheet becomes which name; Art3D.tsx lists the names.
import sys, json, os
import numpy as np
from PIL import Image, ImageDraw
SRC, OUT, PREVIEW = sys.argv[1], sys.argv[2], sys.argv[3]
boxes = json.load(open(os.path.join(os.path.dirname(__file__), 'boxes.json')))
F = {'A': '3D Home Services App Icon Grid.png', 'B': 'Glossy 3D Fintech Payment Icon Grid.png', 'C': 'Glossy 3D Service App Icon Grid.png',
     'D': 'Glossy Home Services Icon Grid.png', 'E': 'Glossy Home Utility Icon Grid.png', 'F': 'Home Services Icon Grid.png',
     'G': 'Home Services Workflow Icon Grid.png', 'H': 'Modern Home Services Icon Grid.png', 'I': 'Pastel App Status Icon Grid.png',
     'J': 'Pastel Home Services Icon Grid.png', 'K': 'Technician App Workflow Icon Grid.png', 'L': 'Friendly Home Services Character Set.png',
     'M': 'Pastel 3D UI Illustration Tile Set.png'}
COLS5 = [(26, 305), (325, 606), (626, 911), (930, 1212), (1232, 1514)]
FIX = {
  'G': [(x0, y0, x1, y1) for (y0, y1) in [(135, 500), (512, 874)] for (x0, x1) in COLS5],
  'H': [(x0, y0, x1, y1) for (y0, y1) in [(139, 512), (523, 904)] for (x0, x1) in COLS5],
  'J': [(x0, y0, x1, y1) for (y0, y1) in [(72, 510), (548, 986)] for (x0, x1) in [(80, 510), (563, 986), (1039, 1490)]],
}
# name: (sheet, index, vertical bias: -1 top .. 1 bottom of the spare height)
MAP = {
  # categories
  'tap': ('J', 0, 0), 'bulb': ('J', 1, 0), 'snowflake': ('J', 2, 0), 'tv': ('J', 3, 0), 'sponge': ('J', 4, 0), 'saw': ('J', 5, 0),
  # services
  'svc_tap': ('E', 0, 0), 'svc_leak': ('E', 1, 0), 'svc_drain': ('E', 2, 0), 'svc_tank': ('E', 3, 0), 'svc_fan': ('E', 4, 0),
  'svc_switch': ('E', 5, 0), 'svc_wiring': ('E', 6, 0), 'svc_light': ('E', 7, 0), 'svc_ac': ('E', 8, 0), 'svc_ac_repair': ('E', 9, 0),
  'svc_fridge': ('H', 0, 0), 'svc_washer': ('H', 1, 0), 'svc_ro': ('H', 2, 0), 'svc_geyser': ('H', 3, 0), 'svc_kitchen': ('H', 5, 0),
  'svc_bath': ('H', 6, 0), 'svc_sofa': ('H', 7, 0), 'svc_door': ('H', 8, 0), 'svc_furniture': ('H', 9, 0), 'svc_carpentry': ('F', 2, 0),
  # things, states, people
  'alarm': ('I', 8, 0), 'bell': ('M', 2, 0), 'calendar': ('C', 9, 0), 'call': ('M', 0, 0), 'camera': ('C', 3, 0), 'card': ('B', 0, 0),
  'check': ('G', 9, 0), 'clipboard': ('G', 5, 0), 'globe': ('C', 1, 0), 'handshake': ('G', 3, -0.3), 'hourglass': ('I', 8, 0),
  'house': ('A', 9, 0), 'house_garden': ('C', 0, -0.2), 'key': ('C', 2, 0), 'magnifier': ('C', 4, 0), 'memo': ('G', 7, 0),
  'mic': ('C', 5, 0), 'money': ('B', 6, 0), 'package': ('M', 3, 0), 'party': ('G', 9, 0), 'pin': ('D', 0, 0), 'receipt': ('B', 5, 0),
  'rocket': ('I', 4, 0), 'scooter': ('G', 2, 0), 'shield': ('M', 5, 0), 'spiral_calendar': ('C', 7, 0), 'star': ('M', 1, 0),
  'tech_man': ('L', 1, 0.2), 'tech_woman': ('L', 3, 0.2), 'toolbox': ('D', 1, 0), 'tools': ('G', 6, 0), 'wave': ('L', 7, -0.2),
  'woman': ('L', 3, 0.2), 'world_map': ('C', 6, 0),
  'customer': ('L', 4, 0), 'tech_hero': ('D', 8, -0.1), 'pay_success': ('B', 1, 0), 'pay_pending': ('B', 2, 0), 'card_failed': ('B', 3, 0),
  'cash': ('B', 4, 0), 'earnings': ('B', 7, 0), 'pay_due': ('G', 8, 0), 'trophy': ('B', 9, 0), 'refund': ('M', 9, 0),
  'verify_pending': ('K', 0, -0.2), 'verify_ok': ('K', 1, -0.2), 'verify_fix': ('K', 2, -0.2), 'start_code': ('K', 6, 0),
  # stopgaps from tiles already generated, until dedicated art arrives: AI assistant = chat bubbles, SOS = warning
  'robot': ('A', 4, 0), 'sos': ('M', 8, 0),
  'job_offer': ('K', 4, -0.2), 'finding': ('G', 0, 0), 'inspecting': ('G', 4, 0), 'no_results': ('I', 6, 0), 'tech_done': ('I', 9, 0),
}
SIZE = 360
def rounded_mask(n, r, ss=4):
    m = Image.new('L', (n * ss, n * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, n * ss - 1, n * ss - 1), radius=r * ss, fill=255)
    return m.resize((n, n), Image.LANCZOS)
cache = {}
os.makedirs(OUT, exist_ok=True)
thumbs = []
for name, (sheet, idx, bias) in MAP.items():
    if sheet not in cache: cache[sheet] = Image.open(os.path.join(SRC, F[sheet])).convert('RGB')
    im = cache[sheet]
    bx = FIX.get(sheet) or boxes[F[sheet]]
    x0, y0, x1, y1 = bx[idx]
    inset = max(5, round((x1 - x0) * 0.025))
    w, h = x1 - x0 - 2 * inset, y1 - y0 - 2 * inset
    side = min(w, h)
    cx = x0 + inset + (w - side) // 2
    spare = h - side
    cy = y0 + inset + round(spare / 2 * (1 + bias))
    tile = im.crop((cx, cy, cx + side, cy + side)).resize((SIZE, SIZE), Image.LANCZOS)
    rgba = tile.convert('RGBA'); rgba.putalpha(rounded_mask(SIZE, round(SIZE * 0.24)))
    rgba.save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=88, method=6)
    thumbs.append((name, rgba))
# preview sheet
cols = 10; t = 150; rows = (len(thumbs) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (t + 8), rows * (t + 24)), (250, 249, 245))
d = ImageDraw.Draw(sheet)
for i, (n, im) in enumerate(thumbs):
    x, y = (i % cols) * (t + 8), (i // cols) * (t + 24)
    sheet.paste(im.resize((t, t)), (x, y), im.resize((t, t)))
    d.text((x + 2, y + t + 4), n, fill=(11, 27, 63))
sheet.save(PREVIEW, quality=85)
print(len(thumbs), 'tiles')
