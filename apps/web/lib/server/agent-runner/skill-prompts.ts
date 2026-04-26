import { TYPOGRAPHY_SYSTEM_LABELS } from "@/lib/server/agent-typography";

const TYPOGRAPHY_CATALOG_DIRECTION = `Approved typography catalog: ${TYPOGRAPHY_SYSTEM_LABELS.join(", ")}. Choose the closest named system and use its systemId; do not invent font families outside this catalog.`;

export const TASTE_LAB_TASTE_CONTRACT = [
  "Taste Lab design standard:",
  "- Make the result specific to the user's product, place, event, or tool.",
  "- Build a premium frontend composition with clear hierarchy, readable type, generous spacing, and concrete CTAs.",
  "- Use imagery, object/media treatment, or product visuals as structural design material when the prompt supports it.",
  "- Visible text must fit its node bounds. Shorten copy, increase bounds, or lower hierarchy before allowing clipped labels, crowded headlines, or awkward wraps.",
  "- Visible text must not overlap other text, CTAs, metrics, image labels, or important media subjects unless it is an intentional high-contrast overlay with padding.",
  "- Foreground colors must contrast against the actual background or image region behind them; readable text overrides exact palette reuse.",
  "- Use a consistent spacing rhythm between navigation, hero, proof, media, and cards; avoid cramped stacks and accidental gaps.",
  `- Typography must be concrete: choose actual font stacks, sizes, weights, line heights, and letter spacing for each UI role before persistence. ${TYPOGRAPHY_CATALOG_DIRECTION}`,
  "- Choose one coherent page architecture and visual world; do not mash together unrelated styles.",
  "- Avoid generic SaaS card piles, purple/blue AI glow defaults, fake dashboard spam, random decorative blobs, placeholder brand names, and vague startup copy.",
  "- The first viewport must clarify brand/product signal, headline, primary action, and the next proof point.",
  "- Persisted canvas nodes should reflect the chosen design direction and remain editable after reload.",
].join("\n");

export const REFERENCE_IMAGE_DIRECTION = [
  "Generate a buildable frontend reference image, not loose mood art.",
  TYPOGRAPHY_CATALOG_DIRECTION,
  "Active dials: DESIGN_VARIANCE 8, IMPLEMENTATION_CLARITY 9, IMAGE_USAGE 8, SPACING_GENEROSITY 8, ATTENTION_CLARITY 9, NON_GENERICITY 10.",
  "Internally choose and commit to one product category, page architecture, visual material, typography mood, signature component set, and attention intent.",
  "The image must clearly communicate layout, section rhythm, typography scale, media treatment, CTA priority, and component styling.",
  "Make structured regions obvious: nav, hero text, primary media, CTA group, proof strip, cards, supporting bands, and final action should have clear relative positions.",
  "Make the palette, typography mood, component inventory, section order, crop targets, and approximate bounding boxes recoverable from the prompt metadata.",
  "Prefer a memorable image-led or object-led first viewport when appropriate, with restrained copy and concrete product details.",
  "Do not depict clipped text, overlapping text, collision-prone labels, tiny unreadable paragraphs, dark required text on dark backgrounds, or uneven accidental spacing.",
].join("\n");

export const COMPONENT_DRAFT_DIRECTION = [
  "Return a custom website draft that a canvas builder can persist as selectable design nodes.",
  "Include concrete navigation, believable CTAs, feature cards, metrics, visual direction, image/media direction, typography direction, and attention goal.",
  `Return typographySystem as a concrete object with one approved systemId from ${TYPOGRAPHY_SYSTEM_LABELS.join(", ")}; the server derives actual CSS font stacks and role tokens from the catalog.`,
  "Include reference-derived layout notes: structured regions, section order, media scale, CTA placement, crop intent, and approximate bounds for headline, subheadline, CTA group, proof, media, and cards.",
  "Keep implementation constraints such as hover behavior, crop percentages, fit rules, and card-base instructions in layoutNotes or suggestedImplementation only; never use them as visible metric labels, card titles, or body copy.",
  "Do not use placeholder metrics or fake copy. If details are missing, infer realistic product-specific details from the prompt.",
  "Keep every text field concise enough to fit realistic canvas bounds; prefer shorter copy over tiny type or clipped text.",
  "Reserve non-overlapping space for headline, subheadline, nav, metrics, CTA labels, and card titles before adding adjacent media or proof content.",
  "When referenceAssets are available, map real image artifacts into structural media slots instead of drawing placeholder media rectangles.",
  "Choose foreground colors that remain readable on the actual background even when this requires deviating from the generated palette.",
  "Use layoutNotes to describe buildable structure, not generic design advice.",
].join("\n");

export const DOCUMENT_DESIGN_DIRECTION = [
  "When persisting the draft, preserve the chosen visual direction in metadata and node choices.",
  "Use the draft's composition, reference-derived regions, image direction, typography direction, and attention goal to shape the canvas.",
  "Use the draft typographySystem role tokens directly for persisted text nodes.",
  "Spec-guided layout comes first: place regions and bounding boxes from the reference composition before falling back to generic section templates.",
  "Persist fitted text nodes with comfortable line-height and bounds; no generated text node should require clipping to look correct.",
  "Persist text with non-overlapping bounds; required text must not cover other text, CTAs, metrics, image labels, or important media subjects.",
  "Persist readable foreground colors against the actual background or crop behind the text; avoid dark-on-dark hero and card text.",
  "Use extracted/generated image assets for hero or product media nodes when present, with artifactKey/objectFit/alt metadata as optional props.",
  "Protect crops from text conflicts: do not place editable text over source-image text unless there is an intentional high-contrast overlay treatment.",
  "Do not persist hover, crop, fit, or construction instructions as visible text.",
  "Do not leave reference artifact labels, prompt traces, or agent-only metadata as visible design content.",
].join("\n");

export const GAZE_GUIDED_IMPROVEMENT_DIRECTION = [
  "Gaze-guided improvement:",
  "- Treat gaze prediction as evidence about the current visual hierarchy, not as decoration.",
  "- Use fixation order and dwell time to decide what the viewer sees first, what is over-attended, and what important content is missed.",
  "- Improve the design so the first read moves through brand/product signal, headline, primary CTA, proof, and feature content in that order unless the prompt states a different priority.",
  "- Convert gaze issues into concrete layout, contrast, copy, media placement, hierarchy, or spacing changes.",
  "- Use any user-provided extra instruction as the priority lens for what to analyze and improve.",
  "- Reference the existing component-draft schema: proposed changes should show up in summary, attentionGoal, layoutNotes, suggestedImplementation, and the generated editable nodes.",
  "- For broad gaze passes, use apply-design-diff style coordinated changes rather than targeted-canvas-edit fail-closed behavior.",
  "- Preserve the product brief and strongest parts of the existing visual system while making a broad improvement pass.",
  "- Do not place gaze markers, heatmap labels, raw coordinates, or analysis metadata as visible page content.",
].join("\n");
