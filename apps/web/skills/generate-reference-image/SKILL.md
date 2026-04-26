---
name: generate-reference-image
description: Use this when a Taste Lab agent needs an image-led visual direction artifact before building or rebuilding a premium frontend design.
---

# Generate Reference Image

Use `generateReferenceImageTool` before every new creation run that needs a visual target. The artifact is not mood art; it is a buildable frontend reference that should make layout, hierarchy, spacing, typography, imagery, CTA priority, and component styling obvious.

The upgraded prompt must also describe a buildable composition spec so the preserved metadata can guide the document builder. Treat the reference as a layout source, not just visual inspiration.

## Baseline Dials

Default to these values unless the user asks for a different direction:

- `DESIGN_VARIANCE: 8` - distinctive, not template-safe.
- `IMPLEMENTATION_CLARITY: 9` - a developer should be able to build from it.
- `IMAGE_USAGE: 8` - imagery, product visuals, or concrete media treatments are structural.
- `SPACING_GENEROSITY: 8` - sections breathe and scan cleanly.
- `ATTENTION_CLARITY: 9` - first fixation, headline, and CTA priority are deliberate.
- `NON_GENERICITY: 10` - no default SaaS slop, fake dashboards, or vague startup filler.

## Variation Engine

Before generating, choose one coherent option from each group and commit to it:

- Product category: commerce, event, portfolio, SaaS, editorial, tool, community, food/beverage, creative studio.
- Page architecture: image-first hero, editorial offset, split product story, Swiss grid, immersive campaign, compact tool surface.
- Visual material: product photography, UI crops, tactile texture, campaign imagery, structured abstract forms, real object still life.
- Typography system: choose one named catalog direction from Taste Sans, Product Sans, Neo Grotesk, Humanist, Soft Geometric, Rounded System, Editorial Serif, Luxury Serif, News Serif, Classical Book, Condensed Poster, Display Condensed, Mono UI, Technical Mono, or Casual Humanist.
- Signature component set: choose 3-4, such as product panel stack, staggered gallery, metrics strip, testimonial block, timeline, pricing/action band, comparison cards, feature grid.
- Attention intent: what should the viewer see first, second, and third.

Do not combine everything. A strong single design world beats a crowded collection of effects.

## Required Output Behavior

The generated image prompt must ask for:

- A real frontend composition, not a loose poster.
- Clear navigation or app chrome when appropriate.
- A short high-impact headline and a visible primary CTA.
- Several concrete components or sections that match the user prompt.
- Strong image/media direction that supports the page structure.
- Enough whitespace for scanning, not empty decorative dead space.
- A coherent palette with one or two accents.
- Copy that sounds specific to the product, not "elevate your workflow" filler.
- Text that looks realistically fit to its containers, with no clipped headlines, crowded chips, or unreadable microcopy.
- Media regions that can be extracted as usable reference assets for the generated document.

## Composition Spec

The upgraded prompt should encode these choices explicitly enough for the builder to reuse from metadata:

- Structured regions: hero, nav, primary media, CTA group, proof strip, feature cards, supporting sections, and final action.
- Palette: page background, surface, primary foreground, muted foreground, accent, and any image-overlay color.
- Typography: named catalog system, display style, body style, label style, hierarchy scale, and intended line breaks for the hero.
- Component inventory: nav items, CTA pair, media slots, metric/proof items, card count, and any editorial bands.
- Section order: first viewport, immediate proof, feature/media section, conversion section, and footer or close.
- Intended bounding boxes: approximate normalized positions for headline, subheadline, CTA group, media, proof strip, and cards.

Use normalized positions or plain-language geometry such as "hero image spans the right 60% and full hero height" when exact coordinates are not available. The goal is to prevent the builder from falling back to a generic fixed template.

## Crop Guidance

- Prefer crops that contain real product/place/media content, not tiny UI text or decorative chrome.
- Do not crop important reference text into media slots when generated editable text will sit on top of or near that crop.
- Keep enough visual context around hero media so it can anchor the page; avoid shrinking a full-bleed reference into a small decorative card.
- When extracting card imagery, choose crops that can survive `object-fit: cover` without cutting off the subject.
- If a crop contains readable text in the source image, either reserve it as a full-composition reference or avoid using it behind editable text.

## Output Count

- One section or hero request: generate exactly one image.
- Full landing page with 3-4 sections: one tall page slice or one broad reference that clearly shows the section rhythm.
- Multi-state or multi-page product request: generate enough separate references to keep text readable and states distinct.
- If multiple images are generated, keep palette, named typography system, image treatment, button style, and spacing logic consistent.

## Anti-Slop Rules

Avoid:

- purple/blue AI glow as the default premium move.
- generic dashboard card piles.
- endless centered sections.
- cloned card rows and repeated left-text/right-image blocks.
- random blobs, orbs, or decorative shapes with no layout role.
- fake brand names like Acme, Quantumly, NovaCore, or Flowbit.
- tiny unreadable UI labels.
- clipped text, awkward wraps, and labels touching their container edges.
- placeholder gray image boxes when a real object, product, venue, or generated media crop should drive the composition.
- overpacked first viewports.
- beige luxury by default.
- dark foreground text on dark hero backgrounds unless it is nonessential decorative texture.
- text regions that overlap image labels, metrics, buttons, or other text.

## Tool Contract

Inputs:
- `slug`: project slug.
- `prompt`: the user's design request.

Model:
- Use `OPENAI_IMAGE_MODEL` when `OPENAI_API_KEY` is set.
- Default to `gpt-image-2` when `OPENAI_IMAGE_MODEL` is absent.
- Use the local mock artifact path when the API key is absent.

Output:
- `artifactKey`
- `metadataKey`
- `model`
- `prompt`

Metadata expectations:
- Preserve the full upgraded prompt.
- Include enough composition-spec language in the prompt for later agents to recover regions, palette, named typography system, component inventory, section order, and intended bounding boxes.

Constraints:
- Store generated artifacts under `.local-data/artifacts/agent-images`.
- Do not block the rest of the workflow if a local mock artifact is used.
- Metadata should preserve the full upgraded prompt so the builder can reuse the art direction.

## Self-Check

Before finalizing the image prompt, verify:

1. Is the design specific to the user's product?
2. Is the first viewport visually memorable without being cluttered?
3. Are hierarchy, CTA priority, and section rhythm clear?
4. Is imagery structural instead of decorative?
5. Are structured regions, crop targets, and bounding boxes obvious enough to rebuild?
6. Does text have reserved space with no subtle overlaps?
7. Do foreground colors contrast with the actual background or image area?
8. Does it avoid obvious AI-generated visual habits?

Read `references/taste-principles.md` and `references/frontend-composition.md` when the request is broad, visually sensitive, or likely to become generic.
