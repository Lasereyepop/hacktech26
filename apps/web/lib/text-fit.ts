import type { DesignNode, TextFitAudit as DesignTextFitAudit } from "@/lib/types";

export type TextFitStyle = {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  letterSpacing?: number;
  lineHeight?: number;
};

export type TextFitBounds = {
  width?: number;
  height?: number;
};

export type TextFitAudit = {
  clipped: boolean;
  requiredWidth: number;
  requiredHeight: number;
  widthOverflow: number;
  heightOverflow: number;
};

const MIN_TEXT_WIDTH = 40;
const MIN_TEXT_HEIGHT = 24;
const TEXT_HORIZONTAL_PADDING = 12;
const TEXT_VERTICAL_PADDING = 10;

export function auditTextFit(input: {
  text: string;
  bounds: TextFitBounds;
  style?: TextFitStyle;
}): TextFitAudit {
  const required = measureTextBounds(
    input.text,
    input.style,
    input.bounds.width,
  );
  const currentWidth = input.bounds.width ?? required.width;
  const currentHeight = input.bounds.height ?? required.height;
  const widthOverflow = Math.max(0, required.width - currentWidth);
  const heightOverflow = Math.max(0, required.height - currentHeight);

  return {
    clipped: widthOverflow > 0 || heightOverflow > 0,
    requiredWidth: required.width,
    requiredHeight: required.height,
    widthOverflow,
    heightOverflow,
  };
}

export function fitTextBounds(input: {
  text: string;
  bounds: TextFitBounds;
  style?: TextFitStyle;
}): { width: number; height: number; audit: TextFitAudit } {
  const audit = auditTextFit(input);

  return {
    width: Math.ceil(Math.max(input.bounds.width ?? 0, audit.requiredWidth)),
    height: Math.ceil(Math.max(input.bounds.height ?? 0, audit.requiredHeight)),
    audit,
  };
}

export function auditDesignTextNodes(
  nodes: DesignNode[],
  viewId?: string,
): DesignTextFitAudit[] {
  return nodes
    .filter(
      (node) =>
        node.type === "text" &&
        (!viewId || node.viewId === viewId) &&
        typeof node.props.text === "string",
    )
    .map((node) => {
      const style =
        node.props.style && typeof node.props.style === "object"
          ? (node.props.style as TextFitStyle)
          : undefined;
      const audit = auditTextFit({
        text: node.props.text as string,
        bounds: node.bounds,
        style,
      });
      const requiredHeight = Math.ceil(audit.requiredHeight);
      const actualHeight = Math.max(1, node.bounds.height);

      return {
        nodeId: node.id,
        fits: !audit.clipped,
        requiredHeight,
        actualHeight,
        overflowRatio: audit.clipped
          ? Number((requiredHeight / actualHeight).toFixed(3))
          : 0,
        recommendedBounds: {
          ...node.bounds,
          width: Math.max(node.bounds.width, Math.ceil(audit.requiredWidth)),
          height: Math.max(node.bounds.height, requiredHeight),
        },
      };
    });
}

function measureTextBounds(
  text: string,
  style: TextFitStyle | undefined,
  targetWidth: number | undefined,
) {
  const fontSize = clampNumber(style?.fontSize, 8, 200, 16);
  const lineHeight = clampNumber(style?.lineHeight, 0.8, 3, 1.5);
  const letterSpacing = clampNumber(style?.letterSpacing, -4, 24, 0);
  const weightFactor = getWeightFactor(style?.fontWeight);
  const averageCharWidth = fontSize * 0.56 * weightFactor + letterSpacing;
  const maxContentWidth = targetWidth
    ? Math.max(MIN_TEXT_WIDTH, targetWidth - TEXT_HORIZONTAL_PADDING)
    : undefined;
  const rawLines = (text || " ").split("\n");
  const measuredLines = rawLines.flatMap((line) =>
    wrapLine(line || " ", averageCharWidth, maxContentWidth),
  );
  const longestLineWidth = measuredLines.reduce(
    (max, line) => Math.max(max, measureLineWidth(line, averageCharWidth)),
    0,
  );

  return {
    width: Math.ceil(
      Math.max(MIN_TEXT_WIDTH, longestLineWidth + TEXT_HORIZONTAL_PADDING),
    ),
    height: Math.ceil(
      Math.max(
        MIN_TEXT_HEIGHT,
        measuredLines.length * fontSize * lineHeight + TEXT_VERTICAL_PADDING,
      ),
    ),
  };
}

function wrapLine(
  line: string,
  averageCharWidth: number,
  maxContentWidth: number | undefined,
) {
  if (!maxContentWidth) return [line];

  const maxChars = Math.max(1, Math.floor(maxContentWidth / averageCharWidth));
  if (line.length <= maxChars) return [line];

  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += maxChars) {
    chunks.push(line.slice(index, index + maxChars));
  }
  return chunks;
}

function measureLineWidth(line: string, averageCharWidth: number) {
  return Math.max(1, line.length) * averageCharWidth;
}

function getWeightFactor(fontWeight: string | undefined) {
  if (!fontWeight || fontWeight === "normal") return 1;
  if (fontWeight === "bold") return 1.08;
  const numeric = Number(fontWeight);
  if (!Number.isFinite(numeric)) return 1;
  return numeric >= 700 ? 1.08 : numeric >= 500 ? 1.04 : 1;
}

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value as number));
}
