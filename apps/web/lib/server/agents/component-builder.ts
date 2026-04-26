import type { ComponentDraft, TasteProject } from "@/lib/types";
import {
  COMPONENT_DRAFT_DIRECTION,
  TASTE_LAB_TASTE_CONTRACT,
} from "@/lib/server/agent-runner/skill-prompts";
import {
  chooseTypographySystem,
  normalizeTypographySystem,
  TYPOGRAPHY_SYSTEM_IDS,
} from "@/lib/server/agent-typography";

type ComponentBuilderInput = {
  project: TasteProject;
  request: string;
};

const commandCopy: Record<string, string> = {
  hierarchy: "Make the primary action impossible to miss",
  cta: "Start with the strongest next step",
  noise: "Strip the layout back to the essential decision",
  spacing: "Give each section a clearer rhythm",
  trust: "Lead with proof, clarity, and confidence",
  polished: "Tighten the surface until it feels launch-ready",
};

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = "gpt-5.5";
export async function componentBuilderAgent({
  project,
  request,
}: ComponentBuilderInput): Promise<ComponentDraft> {
  const normalizedRequest =
    request.trim() || "Generate the strongest demo-ready component.";

  if (process.env.OPENAI_API_KEY) {
    const draft = await buildDraftWithOpenAI(project, normalizedRequest);

    if (draft) {
      return draft;
    }
  }

  return buildLocalDraft(project, normalizedRequest);
}

async function buildDraftWithOpenAI(
  project: TasteProject,
  request: string,
): Promise<ComponentDraft | null> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: { effort: "low" },
      input: [
        {
          role: "system",
          content: [
            "You are the Taste Lab design partner. Return only JSON for a custom, non-generic website design.",
            TASTE_LAB_TASTE_CONTRACT,
            COMPONENT_DRAFT_DIRECTION,
            "For typographySystem, return only the best catalog systemId; the server derives concrete role tokens locally.",
            "The design must be specific to the user's prompt and ready to persist as editable canvas nodes.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            projectName: project.name,
            projectType: project.type,
            projectBrief: project.brief,
            request,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "taste_lab_custom_site_draft",
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "title",
              "summary",
              "eyebrow",
              "headline",
              "subheadline",
              "primaryAction",
              "secondaryAction",
              "navigation",
              "visualDirection",
              "compositionSystem",
              "imageDirection",
              "typographyDirection",
              "typographySystem",
              "attentionGoal",
              "qualityChecklist",
              "featureCards",
              "metrics",
              "layoutNotes",
              "suggestedImplementation",
              "palette",
            ],
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              eyebrow: { type: "string" },
              headline: { type: "string" },
              subheadline: { type: "string" },
              primaryAction: { type: "string" },
              secondaryAction: { type: "string" },
              navigation: {
                type: "array",
                minItems: 3,
                maxItems: 5,
                items: { type: "string" },
              },
              visualDirection: { type: "string" },
              compositionSystem: { type: "string" },
              imageDirection: { type: "string" },
              typographyDirection: { type: "string" },
              typographySystem: {
                type: "object",
                additionalProperties: false,
                required: ["systemId"],
                properties: {
                  systemId: {
                    type: "string",
                    enum: TYPOGRAPHY_SYSTEM_IDS,
                  },
                },
              },
              attentionGoal: { type: "string" },
              qualityChecklist: {
                type: "array",
                minItems: 3,
                maxItems: 6,
                items: { type: "string" },
              },
              featureCards: {
                type: "array",
                minItems: 3,
                maxItems: 4,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["title", "detail"],
                  properties: {
                    title: { type: "string" },
                    detail: { type: "string" },
                  },
                },
              },
              metrics: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["value", "label"],
                  properties: {
                    value: { type: "string" },
                    label: { type: "string" },
                  },
                },
              },
              layoutNotes: {
                type: "array",
                minItems: 3,
                maxItems: 5,
                items: { type: "string" },
              },
              suggestedImplementation: { type: "string" },
              palette: {
                type: "object",
                additionalProperties: false,
                required: ["background", "surface", "accent", "ink"],
                properties: {
                  background: { type: "string" },
                  surface: { type: "string" },
                  accent: { type: "string" },
                  ink: { type: "string" },
                },
              },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    return null;
  }

  const rawText = getResponseText(await response.json());

  if (!rawText) {
    return null;
  }

  try {
    const draft = JSON.parse(rawText) as Partial<ComponentDraft>;
    return normalizeComponentDraft(project, request, draft);
  } catch {
    return null;
  }
}

function buildLocalDraft(
  project: TasteProject,
  request: string,
): ComponentDraft {
  const lowerRequest = request.toLowerCase();
  const intent =
    Object.entries(commandCopy).find(([key]) =>
      lowerRequest.includes(key),
    )?.[1] ?? getSpecificIntent(project, lowerRequest);
  const createdAt = new Date().toISOString();
  const action = project.currentDraft ? "Refined" : "Generated";
  const theme = inferTheme(project, request);
  const typographySystem = chooseTypographySystem(
    `${project.name} ${project.type} ${project.brief} ${request} ${theme.visualDirection}`,
  );

  return {
    id: `draft-${Date.now()}`,
    title: `${action} ${project.type}`,
    summary: `${intent} for ${project.name}.`,
    eyebrow: theme.eyebrow,
    headline: getHeadline(project, lowerRequest),
    subheadline: getSubheadline(project, request),
    primaryAction: theme.primaryAction,
    secondaryAction: theme.secondaryAction,
    navigation: theme.navigation,
    visualDirection: theme.visualDirection,
    compositionSystem: theme.compositionSystem,
    imageDirection: theme.imageDirection,
    typographyDirection: theme.typographyDirection,
    typographySystem,
    attentionGoal: theme.attentionGoal,
    qualityChecklist: theme.qualityChecklist,
    featureCards: theme.featureCards,
    metrics: theme.metrics,
    layoutNotes: [
      `The first viewport is built around ${theme.visualFocus}.`,
      "Navigation, CTA, and content modules are persisted as design nodes so they can be selected and edited.",
      "Primary actions use real button surfaces with hover and active states in the canvas preview.",
    ],
    suggestedImplementation: [
      "Use a complete website hero with navigation, CTA controls, product visual, and supporting content.",
      "Reserve the strongest accent color for the primary action and active metric.",
      "Keep every module addressable in the design-document layer instead of relying on a static preview.",
    ].join(" "),
    palette: theme.palette,
    createdAt,
  };
}

export function normalizeComponentDraft(
  project: TasteProject,
  request: string,
  draft: Partial<ComponentDraft>,
): ComponentDraft {
  const fallback = buildLocalDraft(project, request);

  return {
    ...fallback,
    ...draft,
    id: `draft-${Date.now()}`,
    title: sanitizeVisibleText(draft.title) || fallback.title,
    eyebrow: sanitizeVisibleText(draft.eyebrow) || fallback.eyebrow,
    headline: sanitizeVisibleText(draft.headline) || fallback.headline,
    subheadline: sanitizeVisibleText(draft.subheadline) || fallback.subheadline,
    primaryAction:
      sanitizeVisibleText(draft.primaryAction) || fallback.primaryAction,
    secondaryAction:
      sanitizeVisibleText(draft.secondaryAction) || fallback.secondaryAction,
    navigation:
      normalizeVisibleStringList(draft.navigation) ?? fallback.navigation,
    visualDirection:
      cleanText(draft.visualDirection) || fallback.visualDirection,
    compositionSystem:
      cleanText(draft.compositionSystem) || fallback.compositionSystem,
    imageDirection: cleanText(draft.imageDirection) || fallback.imageDirection,
    typographyDirection:
      cleanText(draft.typographyDirection) || fallback.typographyDirection,
    typographySystem: normalizeTypographySystem(
      draft.typographySystem,
      fallback.typographySystem ??
        chooseTypographySystem(`${project.name} ${project.brief} ${request}`),
    ),
    attentionGoal: cleanText(draft.attentionGoal) || fallback.attentionGoal,
    qualityChecklist:
      normalizeStringList(draft.qualityChecklist) ?? fallback.qualityChecklist,
    featureCards:
      normalizeFeatureCards(draft.featureCards) ?? fallback.featureCards,
    metrics: normalizeMetrics(draft.metrics) ?? fallback.metrics,
    palette: normalizePalette(draft.palette) ?? fallback.palette,
    createdAt: new Date().toISOString(),
  };
}

function getResponseText(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const outputText = (body as { output_text?: unknown }).output_text;
  if (typeof outputText === "string") return outputText;
  const output = (body as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
  }

  return null;
}

function getHeadline(project: TasteProject, request: string) {
  if (request.includes("cta")) {
    return `Turn ${project.name} visitors into action`;
  }

  if (request.includes("trust")) {
    return `${project.name} users can see why it works`;
  }

  if (request.includes("polished")) {
    return `${project.name}, ready for the main stage`;
  }

  return project.name;
}

function getSubheadline(project: TasteProject, request: string) {
  if (request.includes("spacing")) {
    return "A calmer layout with clearer scan paths, stronger rhythm, and fewer competing blocks.";
  }

  if (request.includes("noise")) {
    return "The interface keeps only the message, evidence, and action that matter for the first impression.";
  }

  return project.brief;
}

function getSpecificIntent(project: TasteProject, request: string) {
  if (
    request.includes("popup") ||
    project.brief.toLowerCase().includes("popup")
  ) {
    return "Turn a popup concept into a specific event landing page";
  }

  return "Build a custom website surface from the user's brief";
}

function inferTheme(project: TasteProject, request: string) {
  return {
    eyebrow: "Launch-ready website",
    primaryAction: "Start now",
    secondaryAction: "See details",
    navigation: ["Overview", "Features", "Proof", "Contact"],
    visualDirection:
      "Custom landing page with strong product hierarchy, active CTA controls, and modular supporting content.",
    compositionSystem:
      "Image-led hero with navigation, product visual stack, proof metrics, and three differentiated feature cards.",
    imageDirection:
      "Use a structural product/media panel rather than decorative abstraction, with surfaces that imply the actual offer.",
    typographyDirection:
      "Clean grotesk hierarchy with a short display headline, readable support copy, and compact proof labels.",
    attentionGoal:
      "First fixation should read the product promise, then move to primary CTA, product visual, and proof points.",
    qualityChecklist: [
      "The offer is clear inside one scan.",
      "Primary CTA is visually dominant.",
      "Supporting modules are concrete and editable.",
    ],
    visualFocus: "the core product promise",
    featureCards: [
      {
        title: "Clear offer",
        detail: "A first screen that explains the value immediately.",
      },
      {
        title: "Fast action",
        detail: "Primary and secondary CTAs are easy to identify and press.",
      },
      {
        title: "Proof points",
        detail: "Supporting cards add trust without stealing focus.",
      },
    ],
    metrics: [
      { value: "01", label: "primary workflow" },
      { value: "3", label: "proof modules" },
      { value: "v1", label: "editable draft" },
    ],
    palette: {
      background: "#f7f9fc",
      surface: "#ffffff",
      accent: "#1478f2",
      ink: "#071120",
    },
  };
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeVisibleText(value: unknown) {
  const text = cleanText(value);
  return text && !hasInstructionText(text) ? text : "";
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const items = value
    .map((item) => cleanText(item))
    .filter((item) => item.length > 0);

  return items.length ? items : null;
}

function normalizeVisibleStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const items = value
    .map((item) => sanitizeVisibleText(item))
    .filter((item) => item.length > 0);

  return items.length ? items : null;
}

function normalizeFeatureCards(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const cards = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const feature = item as { title?: unknown; detail?: unknown };
      const title = sanitizeVisibleText(feature.title);
      const detail = sanitizeVisibleText(feature.detail);

      return title && detail ? { title, detail } : null;
    })
    .filter((item): item is { title: string; detail: string } => Boolean(item))
    .slice(0, 4);

  return cards.length ? cards : null;
}

function normalizeMetrics(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const metrics = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const metric = item as { value?: unknown; label?: unknown };
      const metricValue = sanitizeVisibleText(metric.value);
      const label = sanitizeVisibleText(metric.label);

      return metricValue && label
        ? {
            value: compactText(metricValue, 12),
            label: compactText(label, 22),
          }
        : null;
    })
    .filter((item): item is { value: string; label: string } => Boolean(item))
    .slice(0, 3);

  return metrics.length ? metrics : null;
}

function compactText(value: string, maxLength: number) {
  return value.length <= maxLength
    ? value
    : value.split(/\s+/).slice(0, 4).join(" ").slice(0, maxLength).trim();
}

function hasInstructionText(value: string) {
  return [
    /\bno\s+hover\s+overlap\b/i,
    /\bhover\s+overlap\b/i,
    /\bcrop\s+each\s+card\b/i,
    /\btop\s*45%?\b/i,
    /\bwhite\s+card\s+base\b/i,
    /\biconography\s+only\b/i,
    /\bkeep\s+text\s+in\b/i,
    /\bimplementation\s+(note|instruction|constraint)s?\b/i,
  ].some((pattern) => pattern.test(value));
}

function normalizePalette(value: unknown): ComponentDraft["palette"] | null {
  if (!value || typeof value !== "object") return null;
  const palette = value as Partial<ComponentDraft["palette"]>;
  if (
    !cleanText(palette.background) ||
    !cleanText(palette.surface) ||
    !cleanText(palette.accent) ||
    !cleanText(palette.ink)
  ) {
    return null;
  }

  return {
    background: palette.background!,
    surface: palette.surface!,
    accent: palette.accent!,
    ink: palette.ink!,
  };
}
