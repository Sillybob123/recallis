"""Builds the link preview card — the image that shows when someone pastes
recallis.org into iMessage, WhatsApp, Slack or a tweet.

Regenerate with:  python3 scripts/make-og-card.py

It is committed as a PNG rather than generated at build time because the
preview has to be a plain static file that a crawler can fetch, and because
nobody should need a Python toolchain to build the site.
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
NAVY = (0, 40, 113)
INK = (15, 23, 42)
MUTED = (100, 116, 139)
CARD = (255, 255, 255)
WASH = (241, 245, 249)

AV = "/System/Library/Fonts/Avenir Next.ttc"


# Face indices inside the .ttc, which are not in weight order: 0 is Bold and
# 7 is Regular. Getting this wrong renders the body copy heavier than the
# headline, which is exactly how a card stops looking designed.
FACES = {"regular": 7, "medium": 5, "bold": 0}


def font(size, weight="regular"):
    try:
        return ImageFont.truetype(AV, size, index=FACES[weight])
    except Exception:
        name = "Arial Bold.ttf" if weight == "bold" else "Arial.ttf"
        return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)


img = Image.new("RGB", (W, H), WASH)
d = ImageDraw.Draw(img)

# A single navy band down the left edge: enough brand colour to be
# recognisable in a chat thread at thumbnail size, without a dark card that
# fights every messenger's own background.
d.rectangle([0, 0, 18, H], fill=NAVY)
d.rounded_rectangle([54, 48, W - 54, H - 48], radius=28, fill=CARD)

logo = Image.open("public/logo.png").convert("RGBA")
logo = logo.resize((132, 132), Image.LANCZOS)
img.paste(logo, (104, 104), logo)

d.text((262, 112), "Recallis", font=font(80, "bold"), fill=NAVY)
d.text((268, 208), "recallis.org", font=font(27, "medium"), fill=MUTED)

d.text(
    (104, 296),
    "Everything you study, in one place.",
    font=font(48, "bold"),
    fill=INK,
)
for i, line in enumerate(
    [
        "Spaced repetition, cloze deletion and image occlusion,",
        "lecture notes, and a planner built from your own timetable.",
    ]
):
    d.text((104, 368 + i * 44), line, font=font(30, "regular"), fill=MUTED)

# Feature pills along the bottom.
x = 104
for label in ["Anki import", "Image occlusion", "Cram mode", "Academic planner"]:
    f = font(24, "medium")
    w = d.textlength(label, font=f)
    d.rounded_rectangle([x, 494, x + w + 40, 542], radius=24, fill=WASH)
    d.text((x + 20, 505), label, font=f, fill=NAVY)
    x += w + 56

img.save("public/og-card.png", optimize=True)
print(f"wrote public/og-card.png ({W}x{H})")
