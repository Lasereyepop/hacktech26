# Attention Evaluation

Use this when converting gaze, heatmap, or critique output into design edits.

## Priority Order

1. Brand or product signal.
2. Headline.
3. Primary CTA.
4. Proof or concrete details.
5. Supporting features.
6. Secondary action.

The exact order can change by product type, but the design should not send first fixation to decoration, metadata, or low-value chrome.

## Common Problems

- CTA has low contrast or weak size.
- Headline wraps awkwardly or competes with imagery.
- Headline, subheadline, nav, metrics, CTA labels, or card titles subtly overlap another component.
- Required text uses a foreground color too close to the background or image behind it.
- Imagery attracts attention but does not explain the product.
- Reference imagery is cropped so small that it no longer carries the page.
- Source-image text appears inside a crop and competes with generated editable text.
- Metrics look important but are fake or unrelated.
- Cards are evenly weighted, so nothing leads.
- Section spacing is too tight to scan.
- Decorative surfaces take more attention than content.

## Patch Patterns

- Increase CTA contrast, size, or position.
- Shorten headline and strengthen line breaks.
- Move overlapping text into reserved bounds with padding.
- Change foreground color, add a scrim, or move text away from low-contrast image regions.
- Move proof closer to first viewport.
- Increase hero/media crop scale when the reference uses imagery as the main page structure.
- Reduce decorative opacity or remove filler nodes.
- Use one accent consistently for the primary action.
- Rebalance cards so the most important item has more scale or contrast.
