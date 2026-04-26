---
name: create-element
description: Use this when an agent needs to create persisted, taste-aligned canvas nodes in the active design document, including transparent boundary shapes.
---

# Create Element

Create design nodes through the design-document API or server helpers, not client-only state. New elements should feel like part of the current design system, not dropped-on annotations.

Allowed element types:
- `frame`
- `section`
- `slice`
- `rectangle`
- `ellipse`
- `line`
- `arrow`
- `polygon`
- `star`
- `boundary`
- `rounded-boundary`
- `text`
- `button`
- `image`

Required fields:
- `id`
- `type`
- `viewId`
- `name`
- `bounds`
- `props.style`

Constraints:
- Always write against the latest known design version.
- Every mutation should create a new design version.
- Prefer visible `text` nodes for agent notes and edits.

## Creation Rules

- Use measured or user-intended bounds; do not create arbitrary tiny placeholders.
- Name nodes by visible role, such as `Hero CTA`, `Feature card`, or `Pricing section`.
- Match the current palette, typography, radius, opacity, and stroke logic.
- For see-through boundaries, use `boundary` for square corners or `rounded-boundary` with `props.style.cornerScale` so corners scale with the node size. Keep the fill translucent and the stroke opaque.
- Typography should preserve the active catalog system unless the new element intentionally starts a new named system: Taste Sans, Product Sans, Neo Grotesk, Humanist, Soft Geometric, Rounded System, Editorial Serif, Luxury Serif, News Serif, Classical Book, Condensed Poster, Display Condensed, Mono UI, Technical Mono, or Casual Humanist.
- Keep hierarchy obvious: primary elements should be larger, clearer, or higher contrast than support elements.
- For `frame`, `section`, and `slice`, create real persisted nodes with useful bounds.
- For text, make copy concise enough to fit the node, preserve line-height discipline, and never rely on clipping.
- For images, include optional artifact or prompt metadata when available and keep the visual structural.
- When a reference asset has an image artifact, create an `image` node with `artifactKey`, `objectFit`, and `alt` instead of drawing a placeholder media rectangle.

## Visual Fit Check

Before returning:

1. Does the new element align with nearby rhythm and spacing?
2. Does it compete with the primary CTA or headline?
3. Does every text node fit within its bounds without awkward wrapping?
4. Is its role clear from the node name and visible design?
5. Will it survive reload because it was persisted through the document API?

Read `references/frontend-composition.md` for layout placement patterns.
