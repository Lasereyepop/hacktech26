import type {
  ComponentDraft,
  DesignDocumentJson,
  DesignView,
} from "@/lib/types";

// Settings the agent can change on the user's design frame (the artboard the
// designer actually sees in the workspace). These map 1:1 to the React state
// in the dashboard's `FigmaWorkspacePage`, so the frontend can hydrate
// artboard size + fill + corner radius directly from a saved design doc.
export type AgentArtboardSettings = {
  name?: string;
  width: number;
  height: number;
  presetId: string | null;
  fill: string;
  // Percent opacity in the workspace UI. Agent plans sometimes use CSS alpha
  // values (0..1), so reads normalize those to this 0..100 contract.
  fillOpacity: number;
  cornerRadius: number;
  elevation: boolean;
};

// Reference dimensions used by the legacy hardcoded layout. We use these to
// derive a scale factor so the agent's generated coordinates fit the chosen
// artboard size instead of always painting against a 1200x760 canvas.
export const REFERENCE_ARTBOARD_WIDTH = 1200;
export const REFERENCE_ARTBOARD_HEIGHT = 760;

const ARTBOARD_PRESETS: Array<
  AgentArtboardSettings & { aliases: RegExp[]; defaultFill: string }
> = [
  {
    name: "Desktop",
    presetId: "website",
    width: 1440,
    height: 900,
    fill: "#ffffff",
    fillOpacity: 100,
    cornerRadius: 18,
    elevation: true,
    defaultFill: "#ffffff",
    aliases: [
      /\b(desktop|laptop|computer|website|landing(\s+page)?|web\s+app|web\s+page|hero(\s+section)?)\b/i,
    ],
  },
  {
    name: "Desktop HD",
    presetId: "desktop-hd",
    width: 1920,
    height: 1080,
    fill: "#ffffff",
    fillOpacity: 100,
    cornerRadius: 18,
    elevation: true,
    defaultFill: "#ffffff",
    aliases: [/\b(1080p|hd|full\s*hd|cinema|widescreen|kiosk)\b/i],
  },
  {
    name: "macOS Window",
    presetId: "macos",
    width: 1200,
    height: 760,
    fill: "#ffffff",
    fillOpacity: 100,
    cornerRadius: 18,
    elevation: true,
    defaultFill: "#ffffff",
    aliases: [/\b(macos|mac(\s+app)?|desktop\s+app|window|sidebar)\b/i],
  },
  {
    name: "iPad",
    presetId: "ipad",
    width: 1024,
    height: 1366,
    fill: "#ffffff",
    fillOpacity: 100,
    cornerRadius: 28,
    elevation: true,
    defaultFill: "#ffffff",
    aliases: [/\b(ipad|tablet|kindle)\b/i],
  },
  {
    name: "iPhone 15",
    presetId: "iphone-15",
    width: 393,
    height: 852,
    fill: "#ffffff",
    fillOpacity: 100,
    cornerRadius: 36,
    elevation: true,
    defaultFill: "#ffffff",
    aliases: [
      /\b(iphone|phone|mobile|android(\s+phone)?|ios(\s+app)?|app\s+screen|portrait\s+screen)\b/i,
    ],
  },
];

const DEFAULT_ARTBOARD_PRESET = ARTBOARD_PRESETS[0];

// Pick artboard dimensions and a fill from the prompt + agent draft. We
// favour explicit cues in the prompt ("mobile", "desktop"...) and otherwise
// fall back to the desktop preset, which matches the legacy 1440x900 design
// the canvas was tuned for.
export function inferArtboardSettings(input: {
  prompt: string;
  draft?: ComponentDraft | null;
  existing?: AgentArtboardSettings | null;
}): AgentArtboardSettings {
  const haystack = [
    input.prompt,
    input.draft?.title,
    input.draft?.summary,
    input.draft?.headline,
    input.draft?.subheadline,
    input.draft?.visualDirection,
    input.draft?.compositionSystem,
  ]
    .filter(
      (value): value is string => typeof value === "string" && Boolean(value),
    )
    .join(" ");

  const matchedPreset =
    ARTBOARD_PRESETS.find((preset) =>
      preset.aliases.some((pattern) => pattern.test(haystack)),
    ) ?? DEFAULT_ARTBOARD_PRESET;

  const fill = pickFillColor({
    prompt: haystack,
    paletteBackground: input.draft?.palette?.background,
    fallback:
      input.existing?.fill && input.existing.fill !== "#ffffff"
        ? input.existing.fill
        : matchedPreset.defaultFill,
  });

  return {
    name:
      input.draft?.title?.trim() || input.existing?.name || matchedPreset.name,
    width: matchedPreset.width,
    height: matchedPreset.height,
    presetId: matchedPreset.presetId,
    fill,
    fillOpacity: 100,
    cornerRadius: matchedPreset.cornerRadius,
    elevation: matchedPreset.elevation,
  };
}

// Read whatever the agent (or a previous run) saved on the design doc so
// follow-up runs can preserve user-tweaked dimensions.
export function readArtboardSettingsFromDocument(
  documentJson: DesignDocumentJson,
): AgentArtboardSettings | null {
  const candidate = (documentJson.styles as Record<string, unknown>).artboard;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const value = candidate as Partial<AgentArtboardSettings>;
  if (
    typeof value.width !== "number" ||
    typeof value.height !== "number" ||
    value.width < 1 ||
    value.height < 1
  ) {
    return null;
  }

  return {
    name: typeof value.name === "string" ? value.name : undefined,
    width: Math.round(value.width),
    height: Math.round(value.height),
    presetId: typeof value.presetId === "string" ? value.presetId : null,
    fill: typeof value.fill === "string" && value.fill ? value.fill : "#ffffff",
    fillOpacity:
      typeof value.fillOpacity === "number"
        ? normalizeArtboardFillOpacity(value.fillOpacity)
        : 100,
    cornerRadius:
      typeof value.cornerRadius === "number"
        ? Math.max(0, Math.round(value.cornerRadius))
        : 18,
    elevation: typeof value.elevation === "boolean" ? value.elevation : true,
  };
}

export function normalizeArtboardFillOpacity(value: number) {
  if (!Number.isFinite(value)) {
    return 100;
  }
  if (value > 0 && value <= 1) {
    return clamp(value * 100, 0, 100);
  }
  return clamp(value, 0, 100);
}

// Produce the next document: the targeted view's width/height match the
// artboard, and `styles.artboard` gets a sanitised copy the frontend can
// hydrate from. Other styles are preserved.
export function applyArtboardSettingsToDocument(input: {
  document: DesignDocumentJson;
  viewId: string;
  settings: AgentArtboardSettings;
}): DesignDocumentJson {
  const { document, viewId, settings } = input;
  const matchedView = document.views.find((view) => view.id === viewId);
  const width = Math.max(1, Math.round(settings.width));
  const height = Math.max(1, Math.round(settings.height));
  const nextView: DesignView | undefined = matchedView
    ? { ...matchedView, width, height }
    : undefined;
  const nextViews = nextView
    ? document.views.map((view) => (view.id === viewId ? nextView : view))
    : document.views;

  return {
    ...document,
    views: nextViews,
    styles: {
      ...document.styles,
      artboard: {
        name: settings.name,
        width,
        height,
        presetId: settings.presetId ?? null,
        fill: settings.fill,
        fillOpacity: settings.fillOpacity,
        cornerRadius: settings.cornerRadius,
        elevation: settings.elevation,
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

// Compute scale factors from the legacy 1200x760 reference frame to the
// chosen artboard size. Used by the agent layout so generated coords fit the
// artboard rather than overflowing it.
export function getArtboardScale(settings: AgentArtboardSettings) {
  return {
    x: settings.width / REFERENCE_ARTBOARD_WIDTH,
    y: settings.height / REFERENCE_ARTBOARD_HEIGHT,
  };
}

function pickFillColor(input: {
  prompt: string;
  paletteBackground?: string;
  fallback: string;
}) {
  const explicit = matchExplicitColor(input.prompt);
  if (explicit) {
    return explicit;
  }

  if (
    typeof input.paletteBackground === "string" &&
    /^#?[0-9a-f]{3,8}$/i.test(input.paletteBackground.trim())
  ) {
    const candidate = input.paletteBackground.trim();
    return candidate.startsWith("#") ? candidate : `#${candidate}`;
  }

  if (/\b(matcha|tea|forest|emerald)\b/i.test(input.prompt)) {
    return "#f5f1e6";
  }
  if (/\b(ocean|navy|deep\s+blue|midnight|night)\b/i.test(input.prompt)) {
    return "#0b1320";
  }
  if (/\b(dark|black|charcoal|noir)\b/i.test(input.prompt)) {
    return "#0f1115";
  }
  if (/\b(warm|sunset|peach|terra(cotta)?|amber)\b/i.test(input.prompt)) {
    return "#fdf2e9";
  }

  return input.fallback;
}

const HEX_COLOR_PATTERN = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i;
const NAMED_COLOR_PROMPT_PATTERN =
  /\b(?:bg|background|backdrop|fill|color|colour)[^.\n]{0,40}?(?:is|=|:)\s*(#?[0-9a-f]{3,6}|white|black|cream|ivory|off-?white|matcha\s+green|sage|olive|navy|midnight|charcoal|peach|terracotta|amber|sand|stone)/i;

function matchExplicitColor(prompt: string) {
  const hexMatch = HEX_COLOR_PATTERN.exec(prompt);
  if (hexMatch) {
    const value = hexMatch[0];
    return value.startsWith("#") ? value : `#${value}`;
  }

  const namedMatch = NAMED_COLOR_PROMPT_PATTERN.exec(prompt);
  if (namedMatch) {
    const raw = namedMatch[1].toLowerCase().trim();
    if (raw.startsWith("#")) {
      return raw;
    }
    const aliases: Record<string, string> = {
      white: "#ffffff",
      black: "#0f1115",
      cream: "#faf6ec",
      ivory: "#fbf7ee",
      "off-white": "#f7f4ec",
      offwhite: "#f7f4ec",
      "matcha green": "#3a5a40",
      sage: "#cad5c2",
      olive: "#7a8450",
      navy: "#0b1c3a",
      midnight: "#0d1431",
      charcoal: "#1f2227",
      peach: "#fde2cf",
      terracotta: "#c97b63",
      amber: "#f5b942",
      sand: "#e6dccb",
      stone: "#dad4c8",
    };
    return aliases[raw] ?? null;
  }

  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
