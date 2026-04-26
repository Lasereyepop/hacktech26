---
name: gaze-guided-improvement
description: Use this when a Taste Lab agent receives predicted gaze or scanpath data and needs to improve the persisted design.
---

# Gaze-Guided Improvement

Use gaze prediction as evidence about visual hierarchy. The goal is to improve the design so attention moves through the intended product story, not to display or explain the model output.

## Inputs

- Captured artboard size.
- Ordered top fixations with normalized `(x, y)`.
- Dwell time per fixation.
- First fixation and strongest dwell hotspot.
- Short attention notes derived from the scanpath.
- Optional user instruction describing what the gaze agent should analyze or prioritize.

## Interpretation

- First fixation: what registers before the viewer understands the page.
- Long dwell: what is dominant, confusing, or visually sticky.
- Missing or late fixations: important content that lacks enough visual priority.
- Clustered fixations on decoration: wasted attention that should be simplified or moved behind useful content.
- Fast movement across text/CTA: possible readability, contrast, or hierarchy failure.

## Improvement Rules

- Prioritize the intended sequence: brand/product signal, headline, primary CTA, proof, feature content, then secondary actions.
- Convert each gaze issue into a concrete design-document edit: layout, scale, contrast, copy, crop, spacing, or visual weight.
- Use the component-builder schema shape: proposed changes should appear in `summary`, `attentionGoal`, `layoutNotes`, `suggestedImplementation`, and the generated editable nodes.
- Use an apply-design-diff style broad coordinated pass for gaze improvement. Do not route this through targeted-canvas-edit unless a specific node target exists.
- Preserve the project brief and the strongest parts of the existing visual system.
- Make a broad improvement pass when the user explicitly passes gaze into the agent.
- Do not create visible heatmap labels, gaze markers, coordinates, or analysis metadata.
- Do not leave agent-only critique text on the canvas.

## Output

Return an improved design draft or patch-ready design direction. The summary should describe the user-visible hierarchy improvement, not the raw gaze mechanics.
