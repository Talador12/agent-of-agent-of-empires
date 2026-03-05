#!/usr/bin/env python3
"""Generate the GitHub social preview image for aoaoe.
Concept: nested terminal windows receding into depth -- agents all the way down.
1280x640, no copyrighted material."""

from PIL import Image, ImageDraw, ImageFont
import math

W, H = 1280, 640
BG = (13, 17, 23)  # github dark bg
TERM_BG = (22, 27, 34)  # terminal bg
TERM_BORDER = (48, 54, 61)  # terminal border
GREEN = (63, 185, 80)  # green accent
CYAN = (121, 192, 255)  # blue accent
DIM = (125, 133, 144)  # dimmed text
WHITE = (230, 237, 243)
ORANGE = (210, 153, 34)

img = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img)

# try to load a monospace font, fall back to default
try:
    font_lg = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 28)
    font_md = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 20)
    font_sm = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 15)
    font_xs = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 11)
    font_title = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 36)
except:
    font_lg = ImageFont.load_default()
    font_md = font_lg
    font_sm = font_lg
    font_xs = font_lg
    font_title = font_lg


def draw_terminal(x, y, w, h, title, lines, depth, alpha=255):
    """Draw a terminal window with title bar and content lines."""
    # darken based on depth for perspective effect
    fade = max(0.3, 1.0 - depth * 0.12)

    def c(color):
        return tuple(int(ch * fade) for ch in color)

    # terminal shadow
    shadow_off = max(2, 6 - depth)
    draw.rounded_rectangle(
        [x + shadow_off, y + shadow_off, x + w + shadow_off, y + h + shadow_off],
        radius=8,
        fill=(0, 0, 0),
    )

    # terminal body
    draw.rounded_rectangle(
        [x, y, x + w, y + h], radius=8, fill=c(TERM_BG), outline=c(TERM_BORDER), width=1
    )

    # title bar
    draw.rounded_rectangle([x, y, x + w, y + 28], radius=8, fill=c(TERM_BORDER))
    draw.rectangle([x, y + 20, x + w, y + 28], fill=c(TERM_BORDER))

    # traffic lights
    colors = [(255, 95, 86), (255, 189, 46), (39, 201, 63)]
    for i, col in enumerate(colors):
        cx = x + 16 + i * 18
        cy = y + 14
        r = 5
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c(col))

    # title text
    font = font_sm if depth < 3 else font_xs
    draw.text((x + 80, y + 5), title, fill=c(DIM), font=font)

    # content lines
    line_y = y + 36
    line_font = font_md if depth == 0 else (font_sm if depth < 3 else font_xs)
    line_h = 24 if depth == 0 else (18 if depth < 3 else 14)
    for text, color in lines:
        if line_y + line_h > y + h - 4:
            break
        draw.text((x + 12, line_y), text, fill=c(color), font=line_font)
        line_y += line_h


# Layer 0: outermost terminal (the aoaoe daemon)
draw_terminal(
    30,
    50,
    580,
    540,
    "aoaoe -- supervisor daemon",
    [
        ("$ aoaoe --reasoner opencode", GREEN),
        ("", WHITE),
        ("[poll] 6 sessions active", CYAN),
        ("[poll] capturing tmux output...", DIM),
        ("", WHITE),
        ("[reason] agent-3 idle 2m, nudging", ORANGE),
        ("[exec] send_input -> agent-3", GREEN),
        ("[reason] agent-5 completed task", CYAN),
        ("[exec] wait (no action needed)", DIM),
        ("", WHITE),
        ("[poll] scanning sessions...", DIM),
        ("[reason] all agents progressing", GREEN),
        ("[exec] wait", DIM),
        ("", WHITE),
        ("[poll] agent-1 asking question", ORANGE),
        ("[reason] answering agent-1", CYAN),
        ("[exec] send_input -> agent-1", GREEN),
    ],
    depth=0,
)

# Layer 1: AoE TUI (inside the supervisor's view)
draw_terminal(
    640,
    40,
    520,
    280,
    "aoe -- session manager",
    [
        ("  # | title         | tool     | status", DIM),
        ("  1 | api-refactor  | claude   | working", GREEN),
        ("  2 | auth-fix      | opencode | working", GREEN),
        ("  3 | db-migration  | claude   | idle", ORANGE),
        ("  4 | tests         | gemini   | working", GREEN),
        ("  5 | docs-update   | claude   | done", CYAN),
        ("  6 | lint-cleanup  | codex    | working", GREEN),
    ],
    depth=1,
)

# Layer 2: an individual agent session
draw_terminal(
    700,
    340,
    440,
    250,
    "agent-3: claude -- db-migration",
    [
        ("claude> I'll create the migration", WHITE),
        ("  for the users table schema", WHITE),
        ("  change. Let me check the", WHITE),
        ("  existing migrations first...", WHITE),
        ("", WHITE),
        ("? waiting for confirmation", ORANGE),
        ("", WHITE),
        ("> go ahead, apply to staging", GREEN),
        ("  ^^ injected by aoaoe", DIM),
    ],
    depth=2,
)


# Draw recursive arrow indicators between layers
# Arrow from layer 0 to layer 1
def draw_arrow(x1, y1, x2, y2, color):
    draw.line([(x1, y1), (x2, y2)], fill=color, width=2)
    # arrowhead
    angle = math.atan2(y2 - y1, x2 - x1)
    al = 10
    draw.polygon(
        [
            (x2, y2),
            (x2 - al * math.cos(angle - 0.4), y2 - al * math.sin(angle - 0.4)),
            (x2 - al * math.cos(angle + 0.4), y2 - al * math.sin(angle + 0.4)),
        ],
        fill=color,
    )


draw_arrow(612, 140, 638, 140, CYAN)
draw_arrow(612, 420, 698, 420, GREEN)

# Title overlay at bottom
draw.text((40, 598), "agents all the way down", fill=DIM, font=font_md)

out = "/Users/kadler/Documents/repos/github/agent-of-agent-of-empires/assets/social-preview.png"
import os

os.makedirs(os.path.dirname(out), exist_ok=True)
img.save(out, "PNG")
print(f"Saved {out}")
print(f"Size: {img.size}")
