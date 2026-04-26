import type { TextStyleRun } from "@/lib/types";

export type { TextStyleRun };

type TextStyleKey = "fontWeight" | "fontStyle";

export type StyledTextSegment = {
  text: string;
  fontWeight?: string;
  fontStyle?: string;
};

type CharStyle = {
  fontWeight?: string;
  fontStyle?: string;
};

export function normalizeTextStyleRuns(
  runs: unknown,
  textLength: number,
): TextStyleRun[] {
  const length = getSafeTextLength(textLength);
  if (!Array.isArray(runs) || length === 0) {
    return [];
  }

  return stylesToRuns(runsToStyles(runs, length));
}

export function toggleTextStyleRun(input: {
  runs: unknown;
  textLength: number;
  selection: { start: number; end: number };
  style: Pick<TextStyleRun, "fontWeight" | "fontStyle">;
}): TextStyleRun[] {
  const length = getSafeTextLength(input.textLength);
  if (length === 0) {
    return [];
  }

  const start = clampIndex(input.selection.start, length);
  const end = clampIndex(input.selection.end, length);
  const rangeStart = Math.min(start, end);
  const rangeEnd = Math.max(start, end);
  if (rangeStart === rangeEnd) {
    return normalizeTextStyleRuns(input.runs, length);
  }

  const styleEntries = getStyleEntries(input.style);
  if (styleEntries.length === 0) {
    return normalizeTextStyleRuns(input.runs, length);
  }

  const charStyles = runsToStyles(input.runs, length);

  for (const [key, value] of styleEntries) {
    const selectedAlreadyMatches = charStyles
      .slice(rangeStart, rangeEnd)
      .every((charStyle) => charStyle[key] === value);

    for (let index = rangeStart; index < rangeEnd; index += 1) {
      if (selectedAlreadyMatches) {
        delete charStyles[index][key];
      } else {
        charStyles[index][key] = value;
      }
    }
  }

  return stylesToRuns(charStyles);
}

export function splitTextIntoStyledSegments(
  text: string,
  runs: unknown,
): StyledTextSegment[] {
  const content = text || "";
  if (content.length === 0) {
    return [{ text: "" }];
  }

  const normalizedRuns = normalizeTextStyleRuns(runs, content.length);
  if (normalizedRuns.length === 0) {
    return [{ text: content }];
  }

  const charStyles = runsToStyles(normalizedRuns, content.length);
  const segments: StyledTextSegment[] = [];
  let segmentStart = 0;
  let currentStyle = charStyles[0] ?? {};

  for (let index = 1; index < content.length; index += 1) {
    const nextStyle = charStyles[index] ?? {};
    if (!sameStyle(currentStyle, nextStyle)) {
      segments.push({
        text: content.slice(segmentStart, index),
        ...currentStyle,
      });
      segmentStart = index;
      currentStyle = nextStyle;
    }
  }

  segments.push({
    text: content.slice(segmentStart),
    ...currentStyle,
  });

  return segments;
}

function runsToStyles(runs: unknown, textLength: number): CharStyle[] {
  const length = getSafeTextLength(textLength);
  const charStyles: CharStyle[] = Array.from({ length }, () => ({}));
  if (!Array.isArray(runs)) {
    return charStyles;
  }

  for (const run of runs) {
    if (!isRunLike(run)) continue;
    const start = clampIndex(run.start, length);
    const end = clampIndex(run.end, length);
    if (start >= end) continue;

    const style = getRunStyle(run);
    if (!style.fontWeight && !style.fontStyle) continue;

    for (let index = start; index < end; index += 1) {
      charStyles[index] = {
        ...charStyles[index],
        ...style,
      };
    }
  }

  return charStyles;
}

function stylesToRuns(charStyles: CharStyle[]): TextStyleRun[] {
  const runs: TextStyleRun[] = [];
  let activeStart: number | null = null;
  let activeStyle: CharStyle = {};

  for (let index = 0; index <= charStyles.length; index += 1) {
    const nextStyle = charStyles[index] ?? {};
    const hasNextStyle = Boolean(nextStyle.fontWeight || nextStyle.fontStyle);

    if (activeStart === null) {
      if (hasNextStyle) {
        activeStart = index;
        activeStyle = nextStyle;
      }
      continue;
    }

    if (index === charStyles.length || !sameStyle(activeStyle, nextStyle)) {
      runs.push({
        start: activeStart,
        end: index,
        ...activeStyle,
      });
      activeStart = hasNextStyle ? index : null;
      activeStyle = hasNextStyle ? nextStyle : {};
    }
  }

  return runs;
}

function isRunLike(value: unknown): value is TextStyleRun {
  if (!value || typeof value !== "object") {
    return false;
  }

  const run = value as Partial<TextStyleRun>;
  return Number.isFinite(run.start) && Number.isFinite(run.end);
}

function getRunStyle(run: TextStyleRun): CharStyle {
  return {
    ...(typeof run.fontWeight === "string" && run.fontWeight.trim()
      ? { fontWeight: run.fontWeight }
      : {}),
    ...(run.fontStyle === "italic" ? { fontStyle: "italic" } : {}),
  };
}

function getStyleEntries(style: Pick<TextStyleRun, "fontWeight" | "fontStyle">) {
  const entries: Array<[TextStyleKey, string]> = [];
  if (typeof style.fontWeight === "string" && style.fontWeight.trim()) {
    entries.push(["fontWeight", style.fontWeight]);
  }
  if (style.fontStyle === "italic") {
    entries.push(["fontStyle", "italic"]);
  }
  return entries;
}

function sameStyle(a: CharStyle, b: CharStyle) {
  return a.fontWeight === b.fontWeight && a.fontStyle === b.fontStyle;
}

function clampIndex(value: number, textLength: number) {
  const next = Number.isFinite(value) ? Math.round(value) : 0;
  return Math.max(0, Math.min(textLength, next));
}

function getSafeTextLength(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}
