import type { TypographyRole, TypographySystem } from "@/lib/types";
import { FONT_PRESETS } from "@/lib/typography-catalog";

const font = (id: (typeof FONT_PRESETS)[number]["id"]) =>
  FONT_PRESETS.find((preset) => preset.id === id)?.value ??
  FONT_PRESETS[0].value;

const TASTE_SANS = font("tasteSans");
const PRODUCT_SANS = font("productSans");
const NEO_GROTESK = font("neoGrotesk");
const HUMANIST = font("humanist");
const SOFT_GEOMETRIC = font("softGeometric");
const ROUNDED_SYSTEM = font("roundedSystem");
const EDITORIAL_SERIF = font("editorialSerif");
const LUXURY_SERIF = font("luxurySerif");
const NEWS_SERIF = font("newsSerif");
const CLASSICAL_BOOK = font("classicalBook");
const CONDENSED_POSTER = font("condensedPoster");
const DISPLAY_CONDENSED = font("displayCondensed");
const MONO_UI = font("monoUi");
const TECHNICAL_MONO = font("technicalMono");
const CASUAL_HUMANIST = font("casualHumanist");

const role = (
  fontFamily: string,
  fontSize: number,
  fontWeight: string,
  lineHeight: number,
  letterSpacing = 0,
): TypographyRole => ({
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  letterSpacing,
});

export const TYPOGRAPHY_SYSTEMS = {
  tasteSans: {
    systemId: "tasteSans",
    displayFont: TASTE_SANS,
    bodyFont: TASTE_SANS,
    labelFont: PRODUCT_SANS,
    roles: {
      brand: role(TASTE_SANS, 24, "780", 0.98, 0),
      nav: role(PRODUCT_SANS, 11, "750", 1.2, 0.9),
      hero: role(TASTE_SANS, 62, "820", 0.98, 0),
      body: role(TASTE_SANS, 16, "500", 1.5, 0),
      label: role(PRODUCT_SANS, 11, "800", 1.2, 1.2),
      cardTitle: role(TASTE_SANS, 18, "780", 1.1, 0),
      cardBody: role(TASTE_SANS, 13, "500", 1.34, 0),
      metric: role(TASTE_SANS, 21, "820", 1.1, 0),
      cta: role(PRODUCT_SANS, 15, "800", 1.1, 0),
    },
  },
  productSans: {
    systemId: "productSans",
    displayFont: PRODUCT_SANS,
    bodyFont: PRODUCT_SANS,
    labelFont: PRODUCT_SANS,
    roles: {
      brand: role(PRODUCT_SANS, 24, "800", 0.98, 0),
      nav: role(PRODUCT_SANS, 11, "750", 1.2, 0.9),
      hero: role(PRODUCT_SANS, 62, "850", 0.98, 0),
      body: role(PRODUCT_SANS, 16, "500", 1.5, 0),
      label: role(PRODUCT_SANS, 11, "800", 1.2, 1.2),
      cardTitle: role(PRODUCT_SANS, 18, "850", 1.1, 0),
      cardBody: role(PRODUCT_SANS, 13, "500", 1.34, 0),
      metric: role(PRODUCT_SANS, 21, "850", 1.1, 0),
      cta: role(PRODUCT_SANS, 15, "850", 1.1, 0),
    },
  },
  neoGrotesk: {
    systemId: "neoGrotesk",
    displayFont: NEO_GROTESK,
    bodyFont: NEO_GROTESK,
    labelFont: PRODUCT_SANS,
    roles: {
      brand: role(NEO_GROTESK, 24, "760", 0.96, 0),
      nav: role(PRODUCT_SANS, 11, "760", 1.2, 0.8),
      hero: role(NEO_GROTESK, 64, "800", 0.96, -0.2),
      body: role(NEO_GROTESK, 16, "450", 1.5, 0),
      label: role(PRODUCT_SANS, 11, "780", 1.2, 1.1),
      cardTitle: role(NEO_GROTESK, 18, "760", 1.08, 0),
      cardBody: role(NEO_GROTESK, 13, "450", 1.35, 0),
      metric: role(NEO_GROTESK, 22, "800", 1.05, -0.1),
      cta: role(PRODUCT_SANS, 15, "800", 1.1, 0),
    },
  },
  humanist: {
    systemId: "humanist",
    displayFont: HUMANIST,
    bodyFont: HUMANIST,
    labelFont: PRODUCT_SANS,
    roles: {
      brand: role(HUMANIST, 25, "700", 1, 0),
      nav: role(PRODUCT_SANS, 11, "720", 1.2, 0.8),
      hero: role(HUMANIST, 61, "760", 1, 0),
      body: role(HUMANIST, 16, "500", 1.52, 0),
      label: role(PRODUCT_SANS, 11, "760", 1.2, 1.1),
      cardTitle: role(HUMANIST, 18, "740", 1.12, 0),
      cardBody: role(HUMANIST, 13, "500", 1.36, 0),
      metric: role(HUMANIST, 21, "760", 1.1, 0),
      cta: role(PRODUCT_SANS, 15, "790", 1.1, 0),
    },
  },
  softGeometric: {
    systemId: "softGeometric",
    displayFont: SOFT_GEOMETRIC,
    bodyFont: SOFT_GEOMETRIC,
    labelFont: PRODUCT_SANS,
    roles: {
      brand: role(SOFT_GEOMETRIC, 24, "760", 1, 0),
      nav: role(PRODUCT_SANS, 11, "730", 1.2, 0.8),
      hero: role(SOFT_GEOMETRIC, 60, "800", 1, 0),
      body: role(SOFT_GEOMETRIC, 16, "500", 1.52, 0),
      label: role(PRODUCT_SANS, 11, "760", 1.2, 1.1),
      cardTitle: role(SOFT_GEOMETRIC, 18, "780", 1.12, 0),
      cardBody: role(SOFT_GEOMETRIC, 13, "500", 1.36, 0),
      metric: role(SOFT_GEOMETRIC, 21, "800", 1.1, 0),
      cta: role(PRODUCT_SANS, 15, "800", 1.1, 0),
    },
  },
  roundedSystem: {
    systemId: "roundedSystem",
    displayFont: ROUNDED_SYSTEM,
    bodyFont: TASTE_SANS,
    labelFont: PRODUCT_SANS,
    roles: {
      brand: role(ROUNDED_SYSTEM, 24, "800", 1, 0),
      nav: role(PRODUCT_SANS, 11, "740", 1.2, 0.8),
      hero: role(ROUNDED_SYSTEM, 58, "850", 1, 0),
      body: role(TASTE_SANS, 16, "500", 1.5, 0),
      label: role(PRODUCT_SANS, 11, "780", 1.2, 1),
      cardTitle: role(ROUNDED_SYSTEM, 18, "800", 1.12, 0),
      cardBody: role(TASTE_SANS, 13, "500", 1.36, 0),
      metric: role(ROUNDED_SYSTEM, 21, "850", 1.1, 0),
      cta: role(PRODUCT_SANS, 15, "820", 1.1, 0),
    },
  },
  editorialSerif: {
    systemId: "editorialSerif",
    displayFont: EDITORIAL_SERIF,
    bodyFont: PRODUCT_SANS,
    labelFont: PRODUCT_SANS,
    roles: {
      brand: role(EDITORIAL_SERIF, 28, "500", 0.98, 0),
      nav: role(PRODUCT_SANS, 11, "750", 1.2, 1),
      hero: role(EDITORIAL_SERIF, 62, "500", 1.02, 0),
      body: role(PRODUCT_SANS, 16, "450", 1.55, 0),
      label: role(PRODUCT_SANS, 11, "800", 1.2, 1.5),
      cardTitle: role(EDITORIAL_SERIF, 19, "600", 1.1, 0),
      cardBody: role(PRODUCT_SANS, 13, "450", 1.35, 0),
      metric: role(EDITORIAL_SERIF, 22, "600", 1.1, 0),
      cta: role(PRODUCT_SANS, 15, "850", 1.1, 0),
    },
  },
  luxurySerif: {
    systemId: "luxurySerif",
    displayFont: LUXURY_SERIF,
    bodyFont: PRODUCT_SANS,
    labelFont: PRODUCT_SANS,
    roles: {
      brand: role(LUXURY_SERIF, 27, "500", 0.96, 0.2),
      nav: role(PRODUCT_SANS, 11, "700", 1.2, 1.2),
      hero: role(LUXURY_SERIF, 62, "500", 0.98, 0),
      body: role(PRODUCT_SANS, 16, "430", 1.58, 0),
      label: role(PRODUCT_SANS, 11, "760", 1.2, 1.6),
      cardTitle: role(LUXURY_SERIF, 19, "500", 1.08, 0),
      cardBody: role(PRODUCT_SANS, 13, "430", 1.38, 0),
      metric: role(LUXURY_SERIF, 23, "500", 1.05, 0),
      cta: role(PRODUCT_SANS, 15, "780", 1.1, 0.1),
    },
  },
  newsSerif: {
    systemId: "newsSerif",
    displayFont: NEWS_SERIF,
    bodyFont: NEWS_SERIF,
    labelFont: PRODUCT_SANS,
    roles: {
      brand: role(NEWS_SERIF, 27, "700", 1, 0),
      nav: role(PRODUCT_SANS, 11, "740", 1.2, 1),
      hero: role(NEWS_SERIF, 60, "700", 1.03, 0),
      body: role(NEWS_SERIF, 16, "450", 1.56, 0),
      label: role(PRODUCT_SANS, 11, "800", 1.2, 1.4),
      cardTitle: role(NEWS_SERIF, 19, "700", 1.12, 0),
      cardBody: role(NEWS_SERIF, 13, "450", 1.38, 0),
      metric: role(NEWS_SERIF, 22, "700", 1.08, 0),
      cta: role(PRODUCT_SANS, 15, "820", 1.1, 0),
    },
  },
  classicalBook: {
    systemId: "classicalBook",
    displayFont: CLASSICAL_BOOK,
    bodyFont: CLASSICAL_BOOK,
    labelFont: PRODUCT_SANS,
    roles: {
      brand: role(CLASSICAL_BOOK, 28, "500", 1, 0),
      nav: role(PRODUCT_SANS, 11, "720", 1.2, 0.9),
      hero: role(CLASSICAL_BOOK, 62, "500", 1.05, 0),
      body: role(CLASSICAL_BOOK, 17, "400", 1.55, 0),
      label: role(PRODUCT_SANS, 11, "760", 1.2, 1.2),
      cardTitle: role(CLASSICAL_BOOK, 20, "500", 1.12, 0),
      cardBody: role(CLASSICAL_BOOK, 14, "400", 1.38, 0),
      metric: role(CLASSICAL_BOOK, 23, "500", 1.1, 0),
      cta: role(PRODUCT_SANS, 15, "780", 1.1, 0),
    },
  },
  condensedPoster: {
    systemId: "condensedPoster",
    displayFont: CONDENSED_POSTER,
    bodyFont: HUMANIST,
    labelFont: PRODUCT_SANS,
    roles: {
      brand: role(CONDENSED_POSTER, 28, "900", 0.95, 0.2),
      nav: role(PRODUCT_SANS, 11, "800", 1.2, 1.1),
      hero: role(CONDENSED_POSTER, 68, "900", 0.9, 0),
      body: role(HUMANIST, 16, "500", 1.48, 0),
      label: role(PRODUCT_SANS, 11, "800", 1.15, 1.4),
      cardTitle: role(CONDENSED_POSTER, 19, "900", 1.05, 0),
      cardBody: role(HUMANIST, 13, "500", 1.3, 0),
      metric: role(CONDENSED_POSTER, 22, "900", 1.05, 0),
      cta: role(PRODUCT_SANS, 15, "900", 1.1, 0.2),
    },
  },
  displayCondensed: {
    systemId: "displayCondensed",
    displayFont: DISPLAY_CONDENSED,
    bodyFont: NEO_GROTESK,
    labelFont: PRODUCT_SANS,
    roles: {
      brand: role(DISPLAY_CONDENSED, 27, "800", 0.92, 0.1),
      nav: role(PRODUCT_SANS, 11, "780", 1.2, 1),
      hero: role(DISPLAY_CONDENSED, 66, "800", 0.88, 0),
      body: role(NEO_GROTESK, 16, "450", 1.45, 0),
      label: role(PRODUCT_SANS, 11, "800", 1.15, 1.3),
      cardTitle: role(DISPLAY_CONDENSED, 19, "800", 1, 0),
      cardBody: role(NEO_GROTESK, 13, "450", 1.32, 0),
      metric: role(DISPLAY_CONDENSED, 23, "800", 1, 0),
      cta: role(PRODUCT_SANS, 15, "850", 1.1, 0.1),
    },
  },
  monoUi: {
    systemId: "monoUi",
    displayFont: MONO_UI,
    bodyFont: PRODUCT_SANS,
    labelFont: MONO_UI,
    roles: {
      brand: role(MONO_UI, 22, "700", 1.05, 0),
      nav: role(MONO_UI, 11, "700", 1.2, 0.6),
      hero: role(MONO_UI, 50, "800", 1, -0.2),
      body: role(PRODUCT_SANS, 16, "450", 1.52, 0),
      label: role(MONO_UI, 11, "700", 1.2, 0.7),
      cardTitle: role(MONO_UI, 17, "750", 1.12, 0),
      cardBody: role(PRODUCT_SANS, 13, "450", 1.36, 0),
      metric: role(MONO_UI, 20, "800", 1.1, 0),
      cta: role(MONO_UI, 14, "800", 1.1, 0),
    },
  },
  technicalMono: {
    systemId: "technicalMono",
    displayFont: TECHNICAL_MONO,
    bodyFont: PRODUCT_SANS,
    labelFont: TECHNICAL_MONO,
    roles: {
      brand: role(TECHNICAL_MONO, 22, "700", 1.05, 0),
      nav: role(TECHNICAL_MONO, 11, "700", 1.2, 0.6),
      hero: role(TECHNICAL_MONO, 49, "800", 1, -0.2),
      body: role(PRODUCT_SANS, 16, "450", 1.52, 0),
      label: role(TECHNICAL_MONO, 11, "700", 1.2, 0.7),
      cardTitle: role(TECHNICAL_MONO, 17, "760", 1.12, 0),
      cardBody: role(PRODUCT_SANS, 13, "450", 1.36, 0),
      metric: role(TECHNICAL_MONO, 20, "800", 1.1, 0),
      cta: role(TECHNICAL_MONO, 14, "800", 1.1, 0),
    },
  },
  casualHumanist: {
    systemId: "casualHumanist",
    displayFont: CASUAL_HUMANIST,
    bodyFont: CASUAL_HUMANIST,
    labelFont: PRODUCT_SANS,
    roles: {
      brand: role(CASUAL_HUMANIST, 25, "720", 1, 0),
      nav: role(PRODUCT_SANS, 11, "720", 1.2, 0.7),
      hero: role(CASUAL_HUMANIST, 59, "760", 1, 0),
      body: role(CASUAL_HUMANIST, 16, "500", 1.52, 0),
      label: role(PRODUCT_SANS, 11, "760", 1.2, 1),
      cardTitle: role(CASUAL_HUMANIST, 18, "740", 1.12, 0),
      cardBody: role(CASUAL_HUMANIST, 13, "500", 1.36, 0),
      metric: role(CASUAL_HUMANIST, 21, "760", 1.1, 0),
      cta: role(PRODUCT_SANS, 15, "790", 1.1, 0),
    },
  },
} satisfies Record<string, TypographySystem>;

export const TYPOGRAPHY_SYSTEM_IDS = Object.keys(TYPOGRAPHY_SYSTEMS) as Array<
  keyof typeof TYPOGRAPHY_SYSTEMS
>;

export const TYPOGRAPHY_SYSTEM_LABELS = [
  "Taste Sans",
  "Product Sans",
  "Neo Grotesk",
  "Humanist",
  "Soft Geometric",
  "Rounded System",
  "Editorial Serif",
  "Luxury Serif",
  "News Serif",
  "Classical Book",
  "Condensed Poster",
  "Display Condensed",
  "Mono UI",
  "Technical Mono",
  "Casual Humanist",
] as const;

export const DEFAULT_TYPOGRAPHY_SYSTEM = TYPOGRAPHY_SYSTEMS.productSans;

export function chooseTypographySystem(text: string): TypographySystem {
  const normalized = text.toLowerCase();

  if (
    /\b(dev|developer|terminal|code|api|infra|ops|console|technical|engineering|data|security|cyber)\b/.test(
      normalized,
    )
  ) {
    return TYPOGRAPHY_SYSTEMS.technicalMono;
  }

  if (/\b(mono|monospace|command|cli|log|database|admin)\b/.test(normalized)) {
    return TYPOGRAPHY_SYSTEMS.monoUi;
  }

  if (
    /\b(luxury|fashion|jewelry|hotel|spa|gallery|ceremony)\b/.test(normalized)
  ) {
    return TYPOGRAPHY_SYSTEMS.luxurySerif;
  }

  if (
    /\b(news|magazine|journal|publication|media|dispatch)\b/.test(normalized)
  ) {
    return TYPOGRAPHY_SYSTEMS.newsSerif;
  }

  if (
    /\b(book|library|archive|heritage|classical|literary)\b/.test(normalized)
  ) {
    return TYPOGRAPHY_SYSTEMS.classicalBook;
  }

  if (
    /\b(editorial|museum|serif|essay|curated|exhibition)\b/.test(normalized)
  ) {
    return TYPOGRAPHY_SYSTEMS.editorialSerif;
  }

  if (
    /\b(festival|concert|music|poster|campaign|bold|sports|rides)\b/.test(
      normalized,
    )
  ) {
    return TYPOGRAPHY_SYSTEMS.condensedPoster;
  }

  if (/\b(event|launch|drop|immersive|showcase|venue)\b/.test(normalized)) {
    return TYPOGRAPHY_SYSTEMS.displayCondensed;
  }

  if (
    /\b(playful|kid|kids|toy|game|friendly|rounded|soft)\b/.test(normalized)
  ) {
    return TYPOGRAPHY_SYSTEMS.roundedSystem;
  }

  if (
    /\b(wellness|food|cafe|coffee|tea|matcha|community|personal)\b/.test(
      normalized,
    )
  ) {
    return TYPOGRAPHY_SYSTEMS.humanist;
  }

  if (
    /\b(startup|saas|product|app|dashboard|workflow|platform)\b/.test(
      normalized,
    )
  ) {
    return TYPOGRAPHY_SYSTEMS.productSans;
  }

  if (/\b(studio|creative|portfolio|agency|brand)\b/.test(normalized)) {
    return TYPOGRAPHY_SYSTEMS.neoGrotesk;
  }

  return DEFAULT_TYPOGRAPHY_SYSTEM;
}

export function normalizeTypographySystem(
  value: unknown,
  fallback: TypographySystem = DEFAULT_TYPOGRAPHY_SYSTEM,
): TypographySystem {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const candidate = value as Partial<TypographySystem>;
  const base =
    typeof candidate.systemId === "string" &&
    candidate.systemId in TYPOGRAPHY_SYSTEMS
      ? TYPOGRAPHY_SYSTEMS[
          candidate.systemId as keyof typeof TYPOGRAPHY_SYSTEMS
        ]
      : fallback;

  return {
    systemId:
      typeof candidate.systemId === "string" && candidate.systemId.trim()
        ? candidate.systemId.trim()
        : base.systemId,
    displayFont: base.displayFont,
    bodyFont: base.bodyFont,
    labelFont: base.labelFont,
    roles: {
      brand: normalizeRole(candidate.roles?.brand, base.roles.brand),
      nav: normalizeRole(candidate.roles?.nav, base.roles.nav),
      hero: normalizeRole(candidate.roles?.hero, base.roles.hero),
      body: normalizeRole(candidate.roles?.body, base.roles.body),
      label: normalizeRole(candidate.roles?.label, base.roles.label),
      cardTitle: normalizeRole(
        candidate.roles?.cardTitle,
        base.roles.cardTitle,
      ),
      cardBody: normalizeRole(candidate.roles?.cardBody, base.roles.cardBody),
      metric: normalizeRole(candidate.roles?.metric, base.roles.metric),
      cta: normalizeRole(candidate.roles?.cta, base.roles.cta),
    },
  };
}

function normalizeRole(
  value: unknown,
  fallback: TypographyRole,
): TypographyRole {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const roleValue = value as Partial<TypographyRole>;
  return {
    fontFamily: fallback.fontFamily,
    fontSize: clampNumber(roleValue.fontSize, 8, 96, fallback.fontSize),
    fontWeight:
      typeof roleValue.fontWeight === "string" && roleValue.fontWeight.trim()
        ? roleValue.fontWeight.trim()
        : fallback.fontWeight,
    lineHeight: clampNumber(
      roleValue.lineHeight,
      0.85,
      2.4,
      fallback.lineHeight,
    ),
    letterSpacing: clampNumber(
      roleValue.letterSpacing,
      -1,
      4,
      fallback.letterSpacing,
    ),
  };
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}
