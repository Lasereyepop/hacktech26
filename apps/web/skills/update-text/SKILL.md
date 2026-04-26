---
name: update-text
description: Use this when an agent needs to change copy, hierarchy, CTA wording, or typography on a persisted text node.
---

# Update Text

Use this for copy changes, headline changes, CTA labels, and typography updates.

Inputs:
- `nodeId`
- `text`
- optional `style.fontSize`
- optional `style.fontWeight`
- optional `style.fontFamily`
- optional `style.fill`
- optional `style.opacity`
- optional `textStyleRuns` for inline bold/italic ranges, stored separately from plain `text`

Constraints:
- Keep opacity in the `0..1` range.
- Keep visible text concise enough to fit the node bounds.
- Do not accept clipped text as a final state.
- Preserve unrelated node properties.
- Preserve existing `textStyleRuns` unless the requested copy change makes their ranges invalid; clamp or clear invalid ranges instead of embedding markup in `text`.

## Copy Standards

- Write specific product copy, not generic startup filler.
- Keep H1 text short enough to read in one scan.
- Make CTAs concrete actions, such as `Reserve a cup`, `Start planning`, or `View menu`.
- Use supporting text to clarify, not to repeat the headline.
- Preserve the product's tone and category.
- Avoid: unleash, elevate, revolutionize, next-gen, seamless, powerful solution, transformative platform.

## Typography Discipline

- Larger size should map to higher hierarchy, not random emphasis.
- Do not shrink text below readability just to fit too much copy.
- If a text node cannot fit the desired copy, shorten the copy before expanding the layout.
- Preserve established font family and weight unless the request is typography-specific.
- For typography-specific edits, use the approved catalog names: Taste Sans, Product Sans, Neo Grotesk, Humanist, Soft Geometric, Rounded System, Editorial Serif, Luxury Serif, News Serif, Classical Book, Condensed Poster, Display Condensed, Mono UI, Technical Mono, or Casual Humanist.
- Do not invent one-off font families; switch to the closest catalog system and keep related roles coherent.
- Keep line-height comfortable enough that multi-line text does not collide with itself or nearby nodes.

Read `references/taste-principles.md` for anti-slop copy rules.
