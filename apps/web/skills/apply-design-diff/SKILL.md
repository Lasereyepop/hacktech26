---
name: apply-design-diff
description: Use this when an agent needs to batch several taste-preserving design-document edits into one versioned mutation.
---

# Apply Design Diff

Use this for multi-node edits such as changing copy, fills, opacity, layout, hierarchy, and design metadata in one versioned design pass.

Diff shape:
- `baseVersion`
- `operations`
- `summary`

Supported operation categories:
- append visible nodes
- update node text
- update node style
- update document metadata

Constraints:
- Reject stale `baseVersion` values.
- Keep unrelated nodes untouched.
- Return the new design version and a short mutation summary.

## Taste-Preserving Mutation Rules

- Patch the smallest set of nodes that completes the request.
- Preserve palette, typography, radius, spacing, and image treatment unless the user asks for a redesign.
- When changing one visual system decision, update related nodes so the design remains coherent.
- Typography changes should use a named catalog system: Taste Sans, Product Sans, Neo Grotesk, Humanist, Soft Geometric, Rounded System, Editorial Serif, Luxury Serif, News Serif, Classical Book, Condensed Poster, Display Condensed, Mono UI, Technical Mono, or Casual Humanist.
- Do not mix arbitrary one-off font families into a batch diff; if the design direction changes, apply the chosen catalog system consistently to related text roles.
- Do not leave agent-only helper text, prompt traces, mock artifact labels, or backend metadata visible on the canvas.
- Prefer a single `patch` for coordinated updates over separate mutations that leave the document half-updated.
- Apply overlap checks before persisting: text boxes must not cover other text, CTAs, metrics, image labels, or important media subjects.
- Check contrast against the actual background behind each visible text node. Do not keep dark text on dark hero imagery or dark page backgrounds just because it matches the palette.
- When using reference crops, avoid source regions with readable embedded text unless the crop is used as a full composition reference or the editable text is placed away from it.

## Batch Edit Checklist

Before applying:

1. Confirm the latest design version.
2. Identify the target view and affected nodes.
3. Decide whether the change is copy, style, layout, structure, or metadata.
4. Confirm headline, subheadline, nav, metrics, CTA labels, and card titles have non-overlapping bounds with padding.
5. Confirm foreground/background contrast is readable for required content.
6. Preserve unrelated node IDs and properties.
7. Summarize the user-visible design outcome, not internal mechanics.

## Geometry Guardrails

- Treat any visible text/text collision as a blocking issue, even if the overlap is subtle.
- Text can overlay images only when there is an intentional scrim, shadow, or high-contrast region behind it.
- CTA labels must remain centered with enough horizontal padding after text fitting.
- Metrics should use wider bounds or shorter labels instead of wrapping into tall, crowded stacks.
- Card titles and details should not share the same vertical band; reserve title height first, then place body copy below.

Read `references/taste-principles.md` when the diff touches visual style, and `references/attention-evaluation.md` when the edit comes from critique or heatmap feedback.
