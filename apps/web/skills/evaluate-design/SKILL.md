---
name: evaluate-design
description: Use this when an agent needs to run the Taste Lab attention, heatmap, scanpath, and critique workflow for a persisted design.
---

# Evaluate Design

Use the existing heatmap/evaluation backend path. The critique should explain whether the design guides attention to the right thing, then convert that into concrete edits.

Flow:
1. Create or reuse a render artifact for the target view.
2. Create a model job.
3. Run the foundation-model adapter or local mock fallback.
4. Persist the heatmap result.
5. Update project evaluation when requested.

Constraints:
- Do not create a parallel evaluation store.
- Preserve `FOUNDATION_MODEL_URL` and mock fallback behavior.
- Do not add a separate visual QA loop for this skill. When evaluation already runs, use it to flag concrete layout and readability issues.

## Evaluation Questions

- What does the viewer see first?
- Does the headline register before decorative detail?
- Is the primary CTA visible and visually prioritized?
- Does the scanpath move through proof, features, and action in a believable order?
- Are important elements too low contrast, too small, or too isolated?
- Is attention wasted on decorative surfaces or agent artifacts?
- Does any visible text subtly overlap another text node, CTA, metric, image label, or important media subject?
- Do foreground colors contrast with the actual background or image region behind them?
- Does the persisted page preserve the reference image's region choice, crop scale, CTA placement, and section order?
- Are crops large enough to communicate the subject without creating unreadable embedded text or awkward cutoffs?

## Critique Output

For each issue, include:

- Target element or region.
- Attention problem.
- Why it matters.
- Concrete edit: copy, style, layout, hierarchy, or removal.
- Priority.

Do not give generic design advice. Every critique should map to a patchable design-document change.

## Lightweight Quality Flags

Flag these as high priority when present:

- Dark required text on a dark hero background.
- Headline, subheadline, nav, metrics, or card text overlapping another component.
- A full-bleed or dominant reference hero reduced to a small decorative crop.
- Cropped reference text competing with generated editable text.
- Feature cards that should be image-led but persist as plain text blocks.

Read `references/attention-evaluation.md` for the attention-specific checklist.
