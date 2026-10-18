# PCL source reference

The public PCL source was read as a design reference. The application remains a Qt course manager. Its 1280 × 880 initial size, 1020 × 720 minimum, course table, forms, account storage and browser services are retained.

## Source-backed parameters

| Source | Observed behaviour | Local implementation |
| --- | --- | --- |
| `FormMain.xaml`, `PanTitle` | Title bar height 48; window radius 6 | Adapted to height 56 for larger type; platform-native round corners |
| `Controls/MyRadioButton.xaml` | Tab height 27; radius 13.5; icon 16; icon/text gap 8 | `TopTab` adapted to height 38, icon 20 and 20 px side padding for the larger course-manager window |
| `Controls/MyButton.xaml` | Border radius 3; one-pixel outline | Adapted to radius 10 for the requested softer controls |
| `Controls/MyButton.xaml.vb` | Press scale towards .955 over 80 ms; release over 300 ms | `PclButton`; stable hit area and layout |
| `Controls/MyCard.vb` | Card radius 5 | Card styles; expensive live blur omitted |
| `Controls/MyPageRight.vb`, `TriggerEnterAnimation` | Start at Y=-16; opacity 100 ms; 5 px/250 ms Fluent plus 11 px/350 ms Back; 25 ms stagger | `ui_motion.entrance`, right profile |
| `Controls/MyPageLeft.vb`, `TriggerShowAnimation` | Start at X=-25; opacity 100 ms; 5 px/200 ms Fluent plus 20 px/300 ms weak Back; shrinking stagger from 30 ms to 14 ms | `ui_motion.entrance`, left profile |
| `Controls/MyPageRight.vb`, `TriggerExitAnimation` | Y=-6, 70 ms fade, 15 ms stagger | `ui_motion.exit_state` |
| `Controls/MyPageLeft.vb`, `TriggerHideAnimation` | X=-6, 50 ms fade, stagger across 70 ms | `ui_motion.exit_state` |
| `FormMain.xaml.vb`, `PageChangeAnim` | Swap after 110 ms; start entrance after a further 30 ms | 140 ms entrance start |
| `Modules/Base/ModAnimation.vb` | Fluent powers and cosine-based Back easing | Independent Python functions in `ui_motion.py` |

The rendering implementation and product layout are independent. PCL game-launching code, branding and assets are not included. Caption controls keep this application's larger hit areas and maximize action. Reduced motion disables page and press transitions.

## Rendering safeguards

Each application launch plays a 560 ms damped rotation (up to 2.2 degrees) with lateral sway and a soft motion trail. A transparent temporary window paints a cached, rounded window image, allowing the outer silhouette to tilt; a prefiltered image provides blur that fades to sharp. The live window resumes at its original opacity and position. It runs once per window instance; restoring or showing the same window does not replay it. Reduced motion skips it, and interaction, resizing or window-state changes interrupt it immediately. This is an independent PCL-inspired adaptation, not a source-matched startup curve.

Animated frames capture an opaque parent surface at the current device pixel ratio, with separate left/right profiles. The live page does not move. Background table refresh waits for animation completion. Rapid navigation and window closure cancel transient frames. System dark palettes, transparent label backgrounds and scaled displays are covered by UI checks.

