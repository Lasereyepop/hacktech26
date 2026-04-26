---
name: update-style
description: Use this when an agent needs to change fill, stroke, opacity, contrast, or visual treatment while preserving the design system.
---

# Update Style

Use this for color, fill, stroke, opacity, and visual emphasis changes.

Inputs:
- `nodeId`
- optional `fill`
- optional `stroke`
- optional `strokeWidth`
- optional `opacity`

Constraints:
- Use hex or rgba colors.
- Keep opacity in the `0..1` range.
- Keep edits scoped to the requested node unless the user asks for a broader design pass.

## Palette Rules

- Keep one controlled palette with one or two accents.
- Reserve the strongest accent for the primary action or most important attention target.
- Do not default to purple/blue gradients unless the product specifically calls for that world.
- Keep contrast readable and intentional.
- Avoid changing only one node if nearby related nodes must change to keep the system coherent.

## Surface Rules

- Use stroke, opacity, and fill to clarify grouping and hierarchy.
- Avoid stacked glassmorphism, random glow, decorative blobs, and noisy surfaces.
- Make secondary elements quieter instead of making everything loud.
- App chrome can follow theme, but designed artifacts should stay visually stable across light/dark app shell changes.

Read `references/taste-principles.md` before broad palette or material changes.
