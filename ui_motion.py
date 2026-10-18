"""Qt motion model based on the supplied PCL source's timing and geometry.

Reference: Controls/MyPageRight.vb, Controls/MyPageLeft.vb,
Modules/Base/ModAnimation.vb. This module is independent Python code.
All dimensions are logical pixels and times are milliseconds.
"""
from math import cos, pi, sin

TITLE_HEIGHT = 56
TAB_HEIGHT = 38
TAB_ICON = 20
TAB_GAP = 8
TAB_PADDING = 20
CAPTION_SIZE = 28
CARD_RADIUS = 5
BUTTON_RADIUS = 10
PAGE_SWAP = 140  # FormMain.PageChangeAnim: 110 ms + 30 ms layout wait.
STARTUP_DURATION = 560


def startup_pose(t):
    """Damped tilt, lateral sway and soft motion trail for the launch frame."""
    t = clamp(t)
    envelope = (1 - t) ** 3
    return (2.2 * envelope * cos(5 * pi * t),
            10 * envelope * sin(5 * pi * t),
            0.7 * envelope)


def startup_offset(t):
    """Small vertical spring that starts and settles at the resting position."""
    t = clamp(t)
    return 18 * (1 - t) ** 3 * sin(5 * pi * t)


def clamp(t):
    return max(0.0, min(1.0, t))


def fluent(t, power=3):
    return 1 - (1 - clamp(t)) ** power


def back(t, power=3):
    t = clamp(t)
    return 1 - (1 - t) ** (3 - power * .5) * cos(1.5 * pi * t)


def delay(index, axis):
    if axis == 'right':
        return index * 25
    return sum(max(15 - n, 7) * 2 for n in range(index))


def duration(count, axis):
    return PAGE_SWAP + delay(max(0, count - 1), axis) + (350 if axis == 'right' else 300)


def entrance(ms, index, axis):
    elapsed = ms - PAGE_SWAP - delay(index, axis)
    opacity = fluent(elapsed / 100, 2)
    if axis == 'left':
        x = -25 + 5 * fluent(elapsed / 200) + 20 * back(elapsed / 300, 2)
        return x, 0.0, opacity
    y = -16 + 5 * fluent(elapsed / 250) + 11 * back(elapsed / 350)
    return 0.0, y, opacity


def exit_state(ms, index, count, axis):
    if ms >= 110:
        return 0.0, 0.0, 0.0
    elapsed = ms - (index * 15 if axis == 'right' else 70 / max(1, count) * index)
    progress = clamp(elapsed / (70 if axis == 'right' else 50))
    return ((0.0, -6 * progress, 1 - progress) if axis == 'right'
            else (-6 * progress, 0.0, 1 - progress))
