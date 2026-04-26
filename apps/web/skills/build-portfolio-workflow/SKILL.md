---
name: build-portfolio-workflow
description: Use this for the end-to-end Taste Lab creation workflow from dashboard prompt to reference image, plan, component draft, and persisted design document.
---

# Build Portfolio Workflow

Use this when the top dashboard prompt starts or restarts a creation run. The workflow should turn a loose user prompt into a specific, premium, editable frontend design.

## Operating Standard

Every run must produce:

- A clear product interpretation, not a generic website shell.
- A visual direction with palette, typography, image/media direction, and layout rhythm.
- A concrete typography catalog choice: Taste Sans, Product Sans, Neo Grotesk, Humanist, Soft Geometric, Rounded System, Editorial Serif, Luxury Serif, News Serif, Classical Book, Condensed Poster, Display Condensed, Mono UI, Technical Mono, or Casual Humanist.
- A reference artifact when the run is a new create flow.
- A reference-derived composition spec covering structured regions, palette, typography, component inventory, section order, and intended bounding boxes.
- A component draft with concrete copy, navigation, CTAs, feature cards, metrics, and implementation notes.
- Optional reference assets when usable image regions exist; these should become real image nodes, not decorative placeholder rectangles.
- Optional text-fit audits for generated text nodes that are at risk of clipping.
- Persisted design-document nodes that can be selected, edited, and evaluated.

Steps:
1. Create or load the project.
2. Generate a reference artifact with `generate-reference-image`.
3. Plan page architecture, attention target, visual direction, reference-derived regions, and document action.
4. Build the component draft with non-generic copy and concrete media direction.
5. Persist design-document changes without leaving agent-only artifacts visible.
6. Return the updated project, design, draft, and run summary.

Routing:
- Dashboard prompt uses intent `create`.
- Right inspector uses intent `auto`.
- `auto` becomes `build` when no draft exists or the prompt asks for a new design.
- `auto` becomes `edit` for change/tweak/refinement requests against an existing draft.

## Quality Gates

- The hero should communicate brand/product, promise, and primary action inside one scan.
- The layout should vary rhythm across hero, proof, features, and action areas.
- Typography must use a named catalog system. Match product intent first: luxury/editorial work should not default to Product Sans, developer/tool surfaces should consider Technical Mono or Mono UI, and event/poster prompts should consider Condensed Poster or Display Condensed.
- The reference image should drive region choice, media scale, CTA placement, section order, and crop choices; it should not sit unused or be reduced to a small decorative card.
- Persisted text must fit its bounds. Shorten copy or adjust hierarchy before accepting clipped text, cramped labels, or awkward line breaks.
- Persisted text must not subtly overlap other text, CTAs, metrics, image labels, or media unless it is an intentional overlay with sufficient contrast and padding.
- Foreground color must contrast against the actual background behind it. Matching the generated palette is secondary to readability.
- Keep hero, proof, media, and card spacing on a clear rhythm; avoid both crowded stacks and unexplained dead gaps.
- Edits should preserve the current design world unless the user asks for a new direction.
- Local fallback behavior must still complete the run when OpenAI credentials are absent.

## Reference Translation Rules

- Spec-guided layout comes first: choose structured regions and approximate bounds from the reference before placing generic sections.
- Use the reference's first-viewport rhythm: preserve relative dominance between hero text, media, CTA group, and proof strip.
- Preserve the reference's named typography catalog intent in the component draft and design metadata; do not translate it into vague prose only.
- Reserve text boxes before adding adjacent media or metrics. Headline, subheadline, nav, metrics, and card titles need explicit non-overlapping bounds.
- Crops must protect text. Do not place editable text over a crop that already contains readable text unless the overlay is intentional, padded, and contrast-safe.
- Palette should follow the image-generated design's intent, but readable foreground colors override exact palette reuse.

Read `references/taste-principles.md` for the shared anti-slop checklist and `references/frontend-composition.md` for section/page decomposition.
