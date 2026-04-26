# Frontend Composition

Use this when a prompt is broad, visually sensitive, or likely to collapse into generic layout.

## Page Architectures

- Image-first hero: one strong media/object visual with restrained copy and clear CTA.
- Editorial offset: asymmetric text and image blocks with strong whitespace.
- Swiss grid: precise alignment, metrics, proof, and modular content.
- Immersive campaign: product/place as first-viewport signal with supporting story below.
- Compact tool surface: dense but calm controls, clear navigation, and no marketing fluff.
- Tactile product story: physical object, material texture, and event/action details.

## Section Rhythm

Vary the page with:

- hero
- proof or trust strip
- feature cards
- product/media showcase
- metrics
- testimonial or quote
- final action band

Do not repeat the same card structure in every section. Alternate dense sections with calmer sections.

## Reference Translation

When a generated reference exists, translate it into layout decisions before inventing a default structure:

- Identify structured regions: nav, hero text, primary media, CTA group, proof strip, feature cards, supporting bands, and final action.
- Preserve relative dominance: a full-bleed or dominant hero image should stay dominant in the editable design.
- Preserve first-viewport rhythm: headline, CTA, media, and proof should appear in roughly the same attention order as the reference.
- Keep section order coherent with the reference unless the prompt asks for a different story.
- Use approximate bounding boxes to reserve space before placing text.

## Bounds And Crops

- Reserve text bounds first for headline, subheadline, nav, metrics, CTA labels, and card titles.
- Avoid text overlap even when the collision is subtle or caused by low opacity.
- Use crops that communicate a subject at their final displayed size.
- Do not put editable text over source-image text unless an intentional scrim or high-contrast treatment makes both readable.
- Prefer shortening copy or widening bounds over shrinking type into unreadable labels.

## Component Patterns

Good reusable patterns:

- Product UI panel stack.
- Staggered gallery.
- Metrics strip.
- CTA/action band.
- Feature cards with varied width.
- Timeline or schedule.
- Comparison row.
- Editorial image crop.

Every component should have a layout role, not just fill space.
