import { randomUUID } from "node:crypto";
import type {
  ComponentDraft,
  DesignDocument,
  DesignDocumentJson,
  DesignNode,
  EditContext,
  TypographySystem,
} from "@/lib/types";
import {
  createDesignDocumentNode,
  patchDesignDocument,
} from "@/lib/server/project-store";
import { auditDesignTextNodes, fitTextBounds } from "@/lib/text-fit";
import type {
  TasteAgentIntent,
  TasteAgentPlan,
  TasteAgentSubagentRun,
} from "@/lib/server/agent-runner/types";
import { DOCUMENT_DESIGN_DIRECTION } from "@/lib/server/agent-runner/skill-prompts";
import type { ReferenceImageArtifact } from "@/lib/server/agent-tools/image-tools";
import {
  chooseTypographySystem,
  normalizeTypographySystem,
} from "@/lib/server/agent-typography";
import {
  applyArtboardSettingsToDocument,
  REFERENCE_ARTBOARD_HEIGHT,
  REFERENCE_ARTBOARD_WIDTH,
  type AgentArtboardSettings,
} from "@/lib/server/agent-tools/artboard-settings";
import { normalizeTextStyleRuns } from "@/lib/text-style-runs";

type ApplyDesignToolInput = {
  slug: string;
  intent: TasteAgentIntent;
  prompt: string;
  plan: TasteAgentPlan;
  draft: ComponentDraft | null;
  referenceImage?: ReferenceImageArtifact | null;
  subagentRuns?: TasteAgentSubagentRun[];
  document: DesignDocument | null;
  editContext?: EditContext;
  // Artboard size + fill the agent decided on for this run. When provided
  // for create/build runs, the tool resizes the draft view to match and
  // saves the settings on `styles.artboard` so the frontend can hydrate.
  artboard?: AgentArtboardSettings | null;
};

const LAYOUT = {
  pageX: 56,
  contentX: 128,
  navY: 36,
  navHeight: 82,
  heroTop: 166,
  heroMediaX: 690,
  heroMediaY: 166,
  heroMediaWidth: 360,
  heroMediaHeight: 268,
  gutter: 32,
  cardWidth: 286,
  cardGap: 34,
} as const;

type GeneratedReferenceAsset = {
  id?: string;
  label?: string;
  artifactKey?: string | null;
  sourceArtifactKey?: string;
  prompt?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  objectFit?: "cover" | "contain" | "fill";
  objectPosition?: string;
  componentHint?: string;
};

export function applyDesignDocumentTool({
  slug,
  intent,
  prompt,
  plan,
  draft,
  referenceImage,
  subagentRuns,
  document,
  editContext,
  artboard,
}: ApplyDesignToolInput) {
  if (!document) {
    return null;
  }

  if (intent === "edit" && editContext) {
    return patchDesignDocument(
      slug,
      document.version,
      patchTargetedEdit({
        document: document.documentJson,
        prompt,
        draft,
        editContext,
        summary: plan.summary,
      }),
    );
  }

  if (intent === "edit") {
    return patchDesignDocument(
      slug,
      document.version,
      patchMissingEditTargetMetadata(
        document.documentJson,
        prompt,
        plan.summary,
      ),
    );
  }

  if (draft) {
    return patchDesignDocument(
      slug,
      document.version,
      buildAgentDesignedDocument({
        document: document.documentJson,
        draft,
        prompt,
        summary: plan.summary,
        referenceImage,
        subagentRuns,
        artboard: artboard ?? null,
      }),
    );
  }

  if (plan.documentAction === "append-node") {
    return createDesignDocumentNode(
      slug,
      document.version,
      createAgentNoteNode(document, prompt),
    );
  }

  if (plan.documentAction === "patch") {
    return patchDesignDocument(
      slug,
      document.version,
      patchDocumentMetadata(document.documentJson, prompt, plan.summary),
    );
  }

  return document;
}

function patchMissingEditTargetMetadata(
  document: DesignDocumentJson,
  prompt: string,
  summary: string,
): DesignDocumentJson {
  const previousAgentRunner =
    typeof document.styles.agentRunner === "object" &&
    document.styles.agentRunner
      ? document.styles.agentRunner
      : {};

  return {
    ...document,
    styles: {
      ...document.styles,
      agentRunner: {
        ...previousAgentRunner,
        prompt,
        summary,
        skillContract: DOCUMENT_DESIGN_DIRECTION,
        targetedEdit: {
          status: "rejected",
          reason: "No edit target selected; preserved the canvas.",
          source: "inspector",
          viewId: null,
          targetResolution: "unresolved",
          targetConfidence: "none",
          imageEditIntent: mentionsImageEdit(prompt),
          targetNodeIds: [],
          directNodeIds: [],
          inferredNodeIds: [],
          changedNodeIds: [],
          guardedImageNodeIds: [],
          updatedAt: new Date().toISOString(),
        },
      },
    },
    metadata: {
      ...document.metadata,
      generatedAt: new Date().toISOString(),
    },
  };
}

function patchTargetedEdit(input: {
  document: DesignDocumentJson;
  prompt: string;
  draft: ComponentDraft | null;
  editContext: EditContext;
  summary: string;
}): DesignDocumentJson {
  const targetIds = new Set(input.editContext.targetNodeIds);

  if (
    targetIds.size === 0 ||
    input.editContext.targetResolution === "unresolved"
  ) {
    return patchTargetedEditMetadata({
      document: input.document,
      prompt: input.prompt,
      summary: input.summary,
      editContext: input.editContext,
      status: "rejected",
      reason: "No resolved target nodes; preserved the canvas.",
      changedNodeIds: [],
    });
  }

  const proposed = patchScopedCommentEdit(input);
  const guard = validateTargetedEdit({
    before: input.document,
    after: proposed,
    prompt: input.prompt,
    editContext: input.editContext,
  });

  if (!guard.ok) {
    return patchTargetedEditMetadata({
      document: input.document,
      prompt: input.prompt,
      summary: input.summary,
      editContext: input.editContext,
      status: "rejected",
      reason: guard.reason,
      changedNodeIds: guard.changedNodeIds,
    });
  }

  return patchTargetedEditMetadata({
    document: proposed,
    prompt: input.prompt,
    summary: input.summary,
    editContext: input.editContext,
    status: guard.changedNodeIds.length > 0 ? "scoped" : "guarded",
    reason:
      guard.changedNodeIds.length > 0
        ? "Patched only allowed target nodes."
        : "No safe node mutation was needed; preserved the canvas.",
    changedNodeIds: guard.changedNodeIds,
  });
}

function patchScopedCommentEdit(input: {
  document: DesignDocumentJson;
  prompt: string;
  draft: ComponentDraft | null;
  editContext: EditContext;
  summary: string;
}): DesignDocumentJson {
  const targetIds = new Set(input.editContext.targetNodeIds);
  const directTargetIds = new Set(input.editContext.directNodeIds);
  const imageEditIntent =
    input.editContext.imageEditIntent ?? mentionsImageEdit(input.prompt);
  const navLabels = input.draft?.navigation?.length
    ? input.draft.navigation
    : ["Overview", "Work", "Proof", "Contact"];
  let navIndex = 0;
  let bodyIndex = 0;

  const nodes = input.document.nodes.map((node) => {
    if (!targetIds.has(node.id)) {
      return node;
    }

    if (node.type === "image") {
      if (!imageEditIntent || !directTargetIds.has(node.id)) {
        return node;
      }

      return patchTargetedImageNode(node, input.prompt, input.draft);
    }

    if (isShapeNode(node) && mentionsVisualStyleEdit(input.prompt)) {
      return patchTargetedShapeNode(node, input.prompt);
    }

    if (node.type !== "text" && node.type !== "button") {
      return node;
    }

    const text = getScopedReplacementText({
      node,
      prompt: input.prompt,
      draft: input.draft,
      navLabels,
      navIndex,
      bodyIndex,
      isNavTarget: isNavLikeNode(node, input.prompt),
    });
    if (isNavLikeNode(node, input.prompt)) {
      navIndex += 1;
    } else {
      bodyIndex += 1;
    }

    const style = normalizeNodeStyle(node.props.style);
    const nextStyle = adjustScopedEditStyle(style, node, input.prompt);
    const textChanged = text !== cleanVisibleText(node.props.text, "");
    const textStyleRuns = getScopedTextStyleRuns(node, text, textChanged);
    const nextBounds = adjustScopedEditBounds(
      node,
      nextStyle,
      text,
      input.prompt,
    );

    return {
      ...node,
      props: {
        ...node.props,
        text,
        ...(textStyleRuns ? { textStyleRuns } : {}),
        style: nextStyle,
      },
      bounds: nextBounds,
    };
  });

  return {
    ...input.document,
    nodes,
    styles: {
      ...input.document.styles,
      agentRunner: {
        ...(typeof input.document.styles.agentRunner === "object" &&
        input.document.styles.agentRunner
          ? input.document.styles.agentRunner
          : {}),
        prompt: input.prompt,
        summary: input.summary,
        scopedEdit: {
          source: input.editContext.source,
          viewId: input.editContext.viewId,
          targetResolution: input.editContext.targetResolution,
          targetNodeIds: input.editContext.targetNodeIds,
          directNodeIds: input.editContext.directNodeIds,
          inferredNodeIds: input.editContext.inferredNodeIds,
          commentBounds: input.editContext.commentBounds ?? null,
          updatedAt: new Date().toISOString(),
        },
      },
    },
    metadata: {
      ...input.document.metadata,
      generatedAt: new Date().toISOString(),
    },
  };
}

function patchTargetedEditMetadata(input: {
  document: DesignDocumentJson;
  prompt: string;
  summary: string;
  editContext: EditContext;
  status: "scoped" | "guarded" | "rejected";
  reason: string;
  changedNodeIds: string[];
}): DesignDocumentJson {
  const previousAgentRunner =
    typeof input.document.styles.agentRunner === "object" &&
    input.document.styles.agentRunner
      ? input.document.styles.agentRunner
      : {};

  return {
    ...input.document,
    styles: {
      ...input.document.styles,
      agentRunner: {
        ...previousAgentRunner,
        prompt: input.prompt,
        summary: input.summary,
        skillContract: DOCUMENT_DESIGN_DIRECTION,
        targetedEdit: {
          status: input.status,
          reason: input.reason,
          source: input.editContext.source,
          viewId: input.editContext.viewId,
          targetResolution: input.editContext.targetResolution,
          targetConfidence: input.editContext.targetConfidence ?? null,
          imageEditIntent:
            input.editContext.imageEditIntent ??
            mentionsImageEdit(input.prompt),
          targetNodeIds: input.editContext.targetNodeIds,
          directNodeIds: input.editContext.directNodeIds,
          inferredNodeIds: input.editContext.inferredNodeIds,
          changedNodeIds: input.changedNodeIds,
          guardedImageNodeIds: input.editContext.nodes
            .filter((node) => node.type === "image" && node.imageLocked)
            .map((node) => node.id),
          updatedAt: new Date().toISOString(),
        },
      },
    },
    metadata: {
      ...input.document.metadata,
      generatedAt: new Date().toISOString(),
    },
  };
}

function patchTargetedImageNode(
  node: DesignNode,
  prompt: string,
  draft: ComponentDraft | null,
): DesignNode {
  const props = { ...node.props };
  const lowerPrompt = prompt.toLowerCase();
  const objectFit =
    /\b(contain|fit|full|entire)\b/.test(lowerPrompt) &&
    !/\b(cover|crop|fill)\b/.test(lowerPrompt)
      ? "contain"
      : /\b(stretch|fill)\b/.test(lowerPrompt)
        ? "fill"
        : "cover";

  return {
    ...node,
    props: {
      ...props,
      objectFit,
      objectPosition: getTargetedImageObjectPosition(prompt),
      alt: cleanVisibleText(
        draft?.imageDirection,
        cleanVisibleText(props.alt, node.name || "Canvas image"),
      ),
      prompt,
    },
  };
}

function getTargetedImageObjectPosition(prompt: string) {
  const lowerPrompt = prompt.toLowerCase();

  if (/\b(top|header|upper)\b/.test(lowerPrompt)) return "center top";
  if (/\b(bottom|lower|footer)\b/.test(lowerPrompt)) return "center bottom";
  if (/\b(left)\b/.test(lowerPrompt)) return "left center";
  if (/\b(right)\b/.test(lowerPrompt)) return "right center";

  return "center center";
}

function patchTargetedShapeNode(node: DesignNode, prompt: string): DesignNode {
  const style = normalizeNodeStyle(node.props.style);
  const lowerPrompt = prompt.toLowerCase();
  const nextStyle = { ...style };

  if (/\b(subtle|lighter|softer|quiet)\b/.test(lowerPrompt)) {
    nextStyle.opacity = Math.min(
      0.9,
      Math.max(
        0.35,
        Number(nextStyle.opacity ?? node.props.opacity ?? 1) - 0.15,
      ),
    );
  }
  if (/\b(stronger|darker|bolder|emphasis|highlight)\b/.test(lowerPrompt)) {
    nextStyle.opacity = Math.min(
      1,
      Math.max(
        0.5,
        Number(nextStyle.opacity ?? node.props.opacity ?? 0.85) + 0.15,
      ),
    );
  }
  if (/\b(round|rounded|radius)\b/.test(lowerPrompt)) {
    nextStyle.borderRadius = Math.max(6, Number(nextStyle.borderRadius ?? 0));
  }

  return {
    ...node,
    props: {
      ...node.props,
      style: nextStyle,
    },
  };
}

function validateTargetedEdit(input: {
  before: DesignDocumentJson;
  after: DesignDocumentJson;
  prompt: string;
  editContext: EditContext;
}):
  | { ok: true; changedNodeIds: string[] }
  | {
      ok: false;
      reason: string;
      changedNodeIds: string[];
    } {
  const targetIds = new Set(input.editContext.targetNodeIds);
  const changedNodeIds = getChangedNodeIds(
    input.before.nodes,
    input.after.nodes,
  );

  if (input.before.nodes.length !== input.after.nodes.length) {
    return {
      ok: false,
      reason: "Scoped edit attempted to add or remove nodes.",
      changedNodeIds,
    };
  }

  if (
    JSON.stringify(input.before.views) !== JSON.stringify(input.after.views)
  ) {
    return {
      ok: false,
      reason: "Scoped edit attempted to change view membership.",
      changedNodeIds,
    };
  }

  const beforeById = new Map(input.before.nodes.map((node) => [node.id, node]));

  for (const afterNode of input.after.nodes) {
    const beforeNode = beforeById.get(afterNode.id);

    if (!beforeNode) {
      return {
        ok: false,
        reason: "Scoped edit attempted to introduce an unknown node.",
        changedNodeIds,
      };
    }

    if (getImageArtifactKey(beforeNode) !== getImageArtifactKey(afterNode)) {
      return {
        ok: false,
        reason: "Scoped edit attempted to change or clear an image artifact.",
        changedNodeIds,
      };
    }

    if (!targetIds.has(afterNode.id)) {
      if (!sameJson(beforeNode, afterNode)) {
        return {
          ok: false,
          reason: "Scoped edit attempted to change an unrelated node.",
          changedNodeIds,
        };
      }
      continue;
    }

    if (
      !isAllowedTargetNodeChange({
        before: beforeNode,
        after: afterNode,
        prompt: input.prompt,
        editContext: input.editContext,
      })
    ) {
      return {
        ok: false,
        reason: `Scoped edit attempted an unsafe change to ${afterNode.id}.`,
        changedNodeIds,
      };
    }
  }

  return { ok: true, changedNodeIds };
}

export const __targetedEditBehaviorTestHooks = {
  patchMissingEditTargetMetadata,
  patchTargetedEdit,
  validateTargetedEdit,
};

function getChangedNodeIds(before: DesignNode[], after: DesignNode[]) {
  const beforeById = new Map(before.map((node) => [node.id, node]));

  return after
    .filter((node) => {
      const beforeNode = beforeById.get(node.id);
      return beforeNode ? !sameJson(beforeNode, node) : true;
    })
    .map((node) => node.id);
}

function isAllowedTargetNodeChange(input: {
  before: DesignNode;
  after: DesignNode;
  prompt: string;
  editContext: EditContext;
}) {
  const { before, after, prompt, editContext } = input;
  if (
    before.id !== after.id ||
    before.type !== after.type ||
    before.viewId !== after.viewId ||
    before.name !== after.name
  ) {
    return false;
  }

  const changedTopLevelKeys = getChangedObjectKeys(before, after);
  const canChangeBounds =
    (before.type === "text" || before.type === "button") &&
    (mentionsTextEdit(prompt) || mentionsSpacingEdit(prompt));
  const canChangeShapeStyle =
    isShapeNode(before) && mentionsVisualStyleEdit(prompt);
  const canChangeImage =
    before.type === "image" &&
    (editContext.imageEditIntent ?? mentionsImageEdit(prompt)) &&
    editContext.directNodeIds.includes(before.id);

  for (const key of changedTopLevelKeys) {
    if (key === "props") continue;
    if (key === "bounds" && (canChangeBounds || canChangeShapeStyle)) continue;
    return false;
  }

  return propsChangeIsAllowed({
    before,
    after,
    prompt,
    canChangeImage,
    canChangeShapeStyle,
  });
}

function propsChangeIsAllowed(input: {
  before: DesignNode;
  after: DesignNode;
  prompt: string;
  canChangeImage: boolean;
  canChangeShapeStyle: boolean;
}) {
  const changedPropKeys = getChangedObjectKeys(
    input.before.props,
    input.after.props,
  );
  const canChangeText =
    (input.before.type === "text" || input.before.type === "button") &&
    mentionsCopyEdit(input.prompt);
  const canChangeTextStyle =
    (input.before.type === "text" || input.before.type === "button") &&
    (mentionsTextEdit(input.prompt) || mentionsSpacingEdit(input.prompt));

  for (const key of changedPropKeys) {
    if (key === "text" && canChangeText) continue;
    if (
      key === "textStyleRuns" &&
      (canChangeText || canChangeTextStyle) &&
      textStyleRunsChangeIsHarmless(input.before.props, input.after.props)
    ) {
      continue;
    }
    if (key === "style" && (canChangeTextStyle || input.canChangeShapeStyle)) {
      continue;
    }
    if (
      input.canChangeImage &&
      ["objectFit", "objectPosition", "alt", "prompt", "style"].includes(key)
    ) {
      continue;
    }
    return false;
  }

  return true;
}

function getScopedTextStyleRuns(
  node: DesignNode,
  text: string,
  textChanged: boolean,
) {
  if (textChanged) {
    return normalizeTextStyleRuns(node.props.textStyleRuns, text.length);
  }

  if ("textStyleRuns" in node.props) {
    return node.props.textStyleRuns;
  }

  return undefined;
}

function textStyleRunsChangeIsHarmless(
  beforeProps: DesignNode["props"],
  afterProps: DesignNode["props"],
) {
  const beforeHasRuns = "textStyleRuns" in beforeProps;
  const afterHasRuns = "textStyleRuns" in afterProps;

  if (!beforeHasRuns && !afterHasRuns) {
    return true;
  }

  const textLength =
    typeof afterProps.text === "string"
      ? afterProps.text.length
      : typeof beforeProps.text === "string"
        ? beforeProps.text.length
        : 0;

  return sameJson(
    normalizeTextStyleRuns(beforeProps.textStyleRuns, textLength),
    normalizeTextStyleRuns(afterProps.textStyleRuns, textLength),
  );
}

function getChangedObjectKeys(before: object, after: object) {
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const keys = new Set([
    ...Object.keys(beforeRecord),
    ...Object.keys(afterRecord),
  ]);
  return [...keys].filter(
    (key) => !sameJson(beforeRecord[key], afterRecord[key]),
  );
}

function getImageArtifactKey(node: DesignNode) {
  return node.type === "image" && typeof node.props.artifactKey === "string"
    ? node.props.artifactKey
    : null;
}

function isShapeNode(node: DesignNode) {
  return [
    "frame",
    "section",
    "slice",
    "rectangle",
    "line",
    "arrow",
    "ellipse",
    "polygon",
    "star",
    "boundary",
    "rounded-boundary",
    "path",
  ].includes(node.type);
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function getScopedReplacementText(input: {
  node: DesignNode;
  prompt: string;
  draft: ComponentDraft | null;
  navLabels: string[];
  navIndex: number;
  bodyIndex: number;
  isNavTarget: boolean;
}) {
  const current = cleanVisibleText(input.node.props.text, "");
  if (!mentionsCopyEdit(input.prompt) || !input.draft) {
    return current;
  }
  if (input.node.type === "button") {
    return cleanVisibleText(input.draft.primaryAction, current || "Start now");
  }
  if (input.isNavTarget) {
    return cleanVisibleText(
      input.navLabels[input.navIndex % input.navLabels.length],
      current || "Overview",
    );
  }

  const replacements = [
    input.draft.headline,
    input.draft.subheadline,
    input.draft.eyebrow,
  ];
  return cleanVisibleText(
    replacements[input.bodyIndex % replacements.length],
    current || "Website copy",
  );
}

function adjustScopedEditStyle(
  style: Record<string, unknown>,
  node: DesignNode,
  prompt: string,
) {
  const next = { ...style };
  const fontSize = typeof next.fontSize === "number" ? next.fontSize : 16;

  if (mentionsSpacingEdit(prompt)) {
    next.letterSpacing = 0;
    next.lineHeight =
      fontSize >= 32
        ? Math.min(1.08, Number(next.lineHeight ?? 1.05))
        : Math.max(1.18, Number(next.lineHeight ?? 1.25));
  }
  if (
    mentionsTypographyWeightEdit(prompt) &&
    (node.type === "text" || node.type === "button")
  ) {
    next.fontWeight = getAdjustedFontWeight(next.fontWeight, prompt);
  }
  if (mentionsTextEdit(prompt) && node.type === "text") {
    next.textFit = {
      ...(typeof next.textFit === "object" && next.textFit ? next.textFit : {}),
      strategy: "scoped-comment-edit",
    };
  }

  return next;
}

function adjustScopedEditBounds(
  node: DesignNode,
  style: Record<string, unknown>,
  text: string,
  prompt: string,
) {
  if (!mentionsSpacingEdit(prompt) && !mentionsTextEdit(prompt)) {
    return node.bounds;
  }

  if (node.type !== "text" && node.type !== "button") {
    return node.bounds;
  }

  const fitted = fitTextBounds({
    text,
    bounds: node.bounds,
    style: {
      fontSize: typeof style.fontSize === "number" ? style.fontSize : 16,
      fontFamily:
        typeof style.fontFamily === "string" ? style.fontFamily : undefined,
      fontWeight:
        typeof style.fontWeight === "string" ? style.fontWeight : undefined,
      letterSpacing:
        typeof style.letterSpacing === "number"
          ? style.letterSpacing
          : undefined,
      lineHeight: typeof style.lineHeight === "number" ? style.lineHeight : 1.2,
    },
  });

  return {
    ...node.bounds,
    width: Math.max(node.bounds.width, fitted.width),
    height: Math.max(node.bounds.height, fitted.height),
  };
}

function normalizeNodeStyle(style: unknown) {
  return style && typeof style === "object"
    ? ({ ...(style as Record<string, unknown>) } as Record<string, unknown>)
    : {};
}

function isNavLikeNode(node: DesignNode, prompt: string) {
  const name = node.name.toLowerCase();
  return mentionsNavEdit(prompt) || name.includes("nav") || node.bounds.y < 130;
}

function mentionsCopyEdit(prompt: string) {
  return /\b(copy|text|word|label|proper|website|headline|subheadline|body|cta|button|nav|navigation|top\s*bar|header|menu)\b/i.test(
    prompt,
  );
}

function mentionsSpacingEdit(prompt: string) {
  return /\b(spacing|line|letter|leading|kerning|gap|cramped|tight|loose)\b/i.test(
    prompt,
  );
}

function mentionsTextEdit(prompt: string) {
  return /\b(text|copy|spacing|line|letter|font|type|label|word|headline|nav|bar)\b/i.test(
    prompt,
  );
}

function mentionsTypographyWeightEdit(prompt: string) {
  return /\b(font|type|typography|weight|thin|light|lighter|heavier|bold|bolder|stronger|premium|refined|elegant)\b/i.test(
    prompt,
  );
}

function getAdjustedFontWeight(current: unknown, prompt: string) {
  const lowerPrompt = prompt.toLowerCase();
  const currentWeight =
    typeof current === "number"
      ? current
      : typeof current === "string" && /^\d+$/.test(current)
        ? Number(current)
        : typeof current === "string" &&
            /\b(bold|semibold|semi-bold|heavy|black)\b/i.test(current)
          ? 700
          : typeof current === "string" && /\b(light|thin)\b/i.test(current)
            ? 300
            : 400;

  if (/\b(thin|light|lighter|refined|elegant|premium)\b/.test(lowerPrompt)) {
    return Math.max(300, currentWeight - 200);
  }

  if (/\b(bold|bolder|heavier|stronger)\b/.test(lowerPrompt)) {
    return Math.min(800, currentWeight + 200);
  }

  return currentWeight;
}

function mentionsNavEdit(prompt: string) {
  return /\b(nav|navigation|top\s*bar|header|menu)\b/i.test(prompt);
}

function mentionsImageEdit(prompt: string) {
  return /\b(image|photo|picture|crop|media|screenshot)\b/i.test(prompt);
}

function mentionsVisualStyleEdit(prompt: string) {
  return /\b(style|fill|stroke|color|colour|opacity|transparent|subtle|lighter|softer|quiet|stronger|darker|bolder|emphasis|highlight|round|rounded|radius|spacing|gap|size|resize)\b/i.test(
    prompt,
  );
}

function buildAgentDesignedDocument(input: {
  document: DesignDocumentJson;
  draft: ComponentDraft;
  prompt: string;
  summary: string;
  referenceImage?: ReferenceImageArtifact | null;
  subagentRuns?: TasteAgentSubagentRun[];
  artboard?: AgentArtboardSettings | null;
}): DesignDocumentJson {
  const draftView =
    input.document.views.find((candidate) => candidate.id === "draft") ??
    input.document.views[0];
  // The agent's hardcoded layout is tuned for a 1200x760 reference canvas.
  // We build all nodes against that reference frame and then scale them
  // into the actual artboard at the end so the design fits whatever
  // dimensions the agent (or the user) chose.
  const referenceWidth = REFERENCE_ARTBOARD_WIDTH;
  const referenceHeight = REFERENCE_ARTBOARD_HEIGHT;
  const targetWidth = Math.max(
    64,
    Math.round(input.artboard?.width ?? draftView.width),
  );
  const targetHeight = Math.max(
    64,
    Math.round(input.artboard?.height ?? draftView.height),
  );
  const palette = input.draft.palette;
  const profile = getPageProfile(input);
  const features = getFeatureCards(input.draft);
  const metrics = getMetrics(input.draft);
  const nav = getNavigation(input.draft);
  const referenceAssets = getReferenceAssets(input.draft, input.referenceImage);
  const featureCardY = 590;
  const featureCardHeight = 150;
  const baseNodes = stripAgentOnlyNodes([
    rectangleNode(
      "agent-nav-bar",
      "Navigation surface",
      LAYOUT.pageX,
      LAYOUT.navY,
      referenceWidth - 112,
      LAYOUT.navHeight,
      {
        fill: profile.surface,
        stroke: "rgba(26, 42, 28, 0.12)",
        strokeWidth: 1,
        opacity: 0.98,
      },
    ),
    fittedTextNode(
      "agent-brand",
      "Brand",
      profile.brand,
      LAYOUT.contentX,
      50,
      220,
      54,
      {
        fill: profile.ink,
        ...roleStyle(profile.typographySystem.roles.brand),
      },
    ),
    ...nav.map((label, index) =>
      fittedTextNode(
        `agent-nav-${index}`,
        `Navigation ${label}`,
        label,
        430 + index * 132,
        64,
        112,
        22,
        {
          fill: profile.ink,
          ...roleStyle(profile.typographySystem.roles.nav),
          opacity: 0.72,
        },
      ),
    ),
    buttonNode(
      "agent-nav-cta",
      "Navigation CTA",
      profile.primaryAction,
      referenceWidth - 300,
      50,
      140,
      42,
      {
        fill: profile.accent,
        stroke: profile.accent,
        textFill: "#fffdf5",
        ...roleStyle(profile.typographySystem.roles.cta),
      },
    ),
    fittedTextNode(
      "agent-eyebrow",
      "Hero eyebrow",
      profile.eyebrow,
      LAYOUT.contentX,
      172,
      330,
      24,
      {
        fill: profile.ink,
        ...roleStyle(profile.typographySystem.roles.label),
        opacity: 0.82,
      },
    ),
    rectangleNode("agent-eyebrow-rule", "Eyebrow rule", 302, 181, 54, 1, {
      fill: "transparent",
      stroke: profile.ink,
      strokeWidth: 1,
      opacity: 0.45,
    }),
    fittedTextNode(
      "agent-headline",
      "Hero headline",
      profile.headline,
      LAYOUT.contentX,
      218,
      500,
      154,
      {
        fill: profile.ink,
        ...roleStyle(profile.typographySystem.roles.hero),
      },
    ),
    fittedTextNode(
      "agent-subheadline",
      "Hero subheadline",
      profile.subheadline,
      130,
      390,
      440,
      70,
      {
        fill: profile.ink,
        ...roleStyle(profile.typographySystem.roles.body),
        opacity: 0.72,
      },
    ),
    ...detailNodes(profile),
    buttonNode(
      "agent-primary-cta",
      "Primary CTA",
      profile.primaryAction,
      130,
      516,
      220,
      52,
      {
        fill: profile.accent,
        stroke: profile.accent,
        textFill: "#ffffff",
        ...roleStyle(profile.typographySystem.roles.cta),
      },
    ),
    buttonNode(
      "agent-secondary-cta",
      "Secondary CTA",
      profile.secondaryAction,
      395,
      528,
      118,
      30,
      {
        fill: "transparent",
        stroke: "transparent",
        textFill: profile.ink,
        ...roleStyle(profile.typographySystem.roles.cta),
      },
    ),
    ...productVisualNodes(profile, referenceAssets),
    ...benefitBandNodes(profile, referenceWidth),
    ...features.flatMap((feature, index) =>
      cardNodes({
        id: `agent-feature-${index}`,
        title: feature.title,
        detail: feature.detail,
        x: LAYOUT.contentX + index * (LAYOUT.cardWidth + LAYOUT.cardGap),
        y: featureCardY,
        width: LAYOUT.cardWidth,
        height: featureCardHeight,
        asset:
          referenceAssets[(index + 1) % Math.max(1, referenceAssets.length)] ??
          referenceAssets[0],
        profile,
      }),
    ),
    ...metrics.map((metric, index) =>
      metricNode({
        id: `agent-metric-${index}`,
        value: metric.value,
        label: metric.label,
        x: 726 + index * 142,
        y: 472,
        profile,
      }),
    ),
  ]);
  // Scale every node from the 1200x760 reference frame onto the chosen
  // artboard. Font sizes are left alone (re-fit by `fittedTextNode`); only
  // bounds get scaled, so the same hero/proof layout stretches naturally to
  // a desktop, macOS window, or phone-shaped surface.
  const scaleX = targetWidth / referenceWidth;
  const scaleY = targetHeight / referenceHeight;
  const nodes = baseNodes.map((node) => ({
    ...node,
    bounds: {
      x: Math.round(node.bounds.x * scaleX),
      y: Math.round(node.bounds.y * scaleY),
      width: Math.max(1, Math.round(node.bounds.width * scaleX)),
      height: Math.max(1, Math.round(node.bounds.height * scaleY)),
    },
  }));
  const textFitAudits = auditDesignTextNodes(nodes, draftView.id);
  const typographySystem = profile.typographySystem;

  const baseDocument: DesignDocumentJson = {
    ...input.document,
    views: input.document.views.map((view) =>
      view.id === draftView.id
        ? {
            ...view,
            width: targetWidth,
            height: targetHeight,
            nodeIds: nodes.map((node) => node.id),
          }
        : view,
    ),
    nodes: [
      ...input.document.nodes.filter((node) => node.viewId !== draftView.id),
      ...nodes.map((node) => ({ ...node, viewId: draftView.id })),
    ],
    styles: {
      ...input.document.styles,
      palette,
      agentRunner: {
        prompt: input.prompt,
        summary: input.summary,
        skillContract: DOCUMENT_DESIGN_DIRECTION,
        visualDirection: input.draft.visualDirection ?? null,
        compositionSystem: input.draft.compositionSystem ?? null,
        imageDirection: input.draft.imageDirection ?? null,
        typographyDirection: input.draft.typographyDirection ?? null,
        typographySystem,
        attentionGoal: input.draft.attentionGoal ?? null,
        qualityChecklist: input.draft.qualityChecklist ?? null,
        referenceImage: input.referenceImage
          ? {
              ...input.referenceImage,
              role: "reference-guide",
              exportable: false,
              locked: true,
              enrichmentStatus:
                input.referenceImage.enrichmentStatus ?? "pending",
              referenceAssetCount: referenceAssets.length,
            }
          : null,
        referenceAssets,
        subagentRuns: input.subagentRuns ?? [],
        textFitAudits,
        updatedAt: new Date().toISOString(),
      },
    },
    metadata: {
      ...input.document.metadata,
      generatedAt: new Date().toISOString(),
    },
  };

  // Persist the artboard config so the workspace can hydrate size, fill,
  // and corner radius the next time it loads (or after the agent run).
  if (input.artboard) {
    return applyArtboardSettingsToDocument({
      document: baseDocument,
      viewId: draftView.id,
      settings: input.artboard,
    });
  }

  return baseDocument;
}

type PageProfile = {
  brand: string;
  eyebrow: string;
  headline: string;
  subheadline: string;
  primaryAction: string;
  secondaryAction: string;
  background: string;
  surface: string;
  accent: string;
  ink: string;
  muted: string;
  displayFont: string;
  bodyFont: string;
  typographySystem: TypographySystem;
  compositionSystem: string;
  imageDirection: string;
  typographyDirection: string;
  attentionGoal: string;
  qualityChecklist: string[];
};

function getPageProfile(input: {
  draft: ComponentDraft;
  prompt: string;
}): PageProfile {
  const palette = input.draft.palette;
  const text = [
    input.prompt,
    input.draft.title,
    input.draft.summary,
    input.draft.headline,
    input.draft.visualDirection,
    input.draft.compositionSystem,
    input.draft.imageDirection,
    input.draft.typographyDirection,
  ]
    .join(" ")
    .toLowerCase();
  const typographySystem = normalizeTypographySystem(
    input.draft.typographySystem,
    chooseTypographySystem(text),
  );
  const fittedTypographySystem =
    fitTypographySystemToArtboard(typographySystem);

  return {
    brand: cleanVisibleText(input.draft.title, "Product Studio"),
    eyebrow: cleanVisibleText(input.draft.eyebrow, "FEATURED EXPERIENCE"),
    headline: cleanVisibleText(
      input.draft.headline,
      "A sharper product experience",
    ),
    subheadline: cleanVisibleText(
      input.draft.subheadline,
      "A polished first screen with a clear story, action, and proof.",
    ),
    primaryAction: cleanVisibleText(input.draft.primaryAction, "Start now"),
    secondaryAction: cleanVisibleText(
      input.draft.secondaryAction,
      "See details",
    ),
    background: palette.background,
    surface: palette.surface,
    accent: palette.accent,
    ink: palette.ink,
    muted: palette.ink,
    displayFont: fittedTypographySystem.displayFont,
    bodyFont: fittedTypographySystem.bodyFont,
    typographySystem: fittedTypographySystem,
    compositionSystem: cleanVisibleText(
      input.draft.compositionSystem,
      "Image-led hero with product proof and feature rhythm",
    ),
    imageDirection: cleanVisibleText(
      input.draft.imageDirection,
      "Structural product media panel with concrete offer details",
    ),
    typographyDirection: cleanVisibleText(
      input.draft.typographyDirection,
      "Clean grotesk hierarchy with compact proof labels",
    ),
    attentionGoal: cleanVisibleText(
      input.draft.attentionGoal,
      "Headline, primary CTA, product visual, then proof points.",
    ),
    qualityChecklist: input.draft.qualityChecklist?.length
      ? input.draft.qualityChecklist
      : [
          "First viewport explains the offer.",
          "Primary CTA is visible.",
          "Supporting modules stay editable.",
        ],
  };
}

function getNavigation(draft: ComponentDraft) {
  return (
    draft.navigation?.length
      ? draft.navigation
      : ["Overview", "Work", "Proof", "Contact"]
  )
    .map((label) => cleanVisibleText(label, "Page"))
    .filter((label) => label !== "Page")
    .slice(0, 5);
}

function getFeatureCards(draft: ComponentDraft) {
  const fallback = [
    {
      title: "Clear offer",
      detail: "The page explains the product quickly.",
    },
    {
      title: "Focused action",
      detail: "Primary and secondary actions are easy to scan.",
    },
    { title: "Proof points", detail: "Supporting modules add confidence." },
  ];

  const source = draft.featureCards?.length ? draft.featureCards : fallback;

  return source.slice(0, 3).map((feature, index) => ({
    title: cleanVisibleText(feature.title, fallback[index]?.title ?? "Feature"),
    detail: cleanVisibleText(
      feature.detail,
      fallback[index]?.detail ?? "Supporting detail.",
    ),
  }));
}

function getMetrics(draft: ComponentDraft) {
  const fallback = [
    { value: "01", label: "primary workflow" },
    { value: "3", label: "proof modules" },
    { value: "v1", label: "editable draft" },
  ];
  const source = draft.metrics?.length ? draft.metrics : fallback;

  return source.slice(0, 3).map((metric, index) => ({
    value: compactVisibleText(metric.value, fallback[index]?.value ?? "1", 12),
    label: compactVisibleText(
      metric.label,
      fallback[index]?.label ?? "metric",
      22,
    ),
  }));
}

function detailNodes(_profile: PageProfile): DesignNode[] {
  return [];
}

function productVisualNodes(
  profile: PageProfile,
  referenceAssets: GeneratedReferenceAsset[],
): DesignNode[] {
  const heroAsset = referenceAssets[0];
  if (heroAsset?.artifactKey) {
    return [
      imageNode(
        "agent-product-image",
        heroAsset.label ?? "Product visual",
        heroAsset.artifactKey,
        LAYOUT.heroMediaX,
        LAYOUT.heroMediaY,
        LAYOUT.heroMediaWidth,
        LAYOUT.heroMediaHeight,
        {
          prompt: heroAsset.prompt,
          objectFit: heroAsset.objectFit ?? "cover",
          objectPosition: heroAsset.objectPosition ?? "center center",
          alt: cleanVisibleText(heroAsset.label, profile.imageDirection),
          style: {
            fill: profile.surface,
            stroke: "rgba(23, 33, 18, 0.12)",
            strokeWidth: 1,
          },
        },
      ),
    ];
  }

  return [
    rectangleNode(
      "agent-product-panel",
      "Product visual",
      LAYOUT.heroMediaX,
      LAYOUT.heroMediaY,
      LAYOUT.heroMediaWidth,
      LAYOUT.heroMediaHeight,
      {
        fill: profile.surface,
        stroke: "rgba(23, 33, 18, 0.1)",
        strokeWidth: 1,
      },
    ),
    rectangleNode(
      "agent-product-window",
      "Product media surface",
      718,
      194,
      304,
      74,
      {
        fill: withOpacity(profile.accent, 0.12),
        stroke: withOpacity(profile.accent, 0.3),
        strokeWidth: 1,
      },
    ),
    rectangleNode(
      "agent-product-row-one",
      "Primary product detail",
      718,
      294,
      208,
      18,
      {
        fill: profile.ink,
        stroke: "transparent",
        strokeWidth: 0,
        opacity: 0.82,
      },
    ),
    rectangleNode(
      "agent-product-row-two",
      "Secondary product detail",
      718,
      326,
      260,
      12,
      {
        fill: profile.ink,
        stroke: "transparent",
        strokeWidth: 0,
        opacity: 0.34,
      },
    ),
    rectangleNode(
      "agent-product-row-three",
      "Tertiary product detail",
      718,
      354,
      176,
      12,
      {
        fill: profile.ink,
        stroke: "transparent",
        strokeWidth: 0,
        opacity: 0.24,
      },
    ),
    rectangleNode(
      "agent-product-action",
      "Product visual action",
      928,
      378,
      92,
      28,
      {
        fill: profile.accent,
        stroke: profile.accent,
        strokeWidth: 1,
      },
    ),
  ];
}

function benefitBandNodes(
  _profile: PageProfile,
  _viewWidth: number,
): DesignNode[] {
  return [];
}

function rectangleNode(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Record<string, unknown>,
): DesignNode {
  return {
    id,
    type: "rectangle",
    viewId: "draft",
    name,
    props: { style },
    bounds: { x, y, width, height },
  };
}

function textNode(
  id: string,
  name: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Record<string, unknown>,
): DesignNode {
  return {
    id,
    type: "text",
    viewId: "draft",
    name,
    props: { text, style },
    bounds: { x, y, width, height },
  };
}

function fittedTextNode(
  id: string,
  name: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Record<string, unknown>,
): DesignNode {
  const fitted = fitTextBounds({
    text,
    bounds: { width, height },
    style: {
      fontSize: typeof style.fontSize === "number" ? style.fontSize : 16,
      fontFamily:
        typeof style.fontFamily === "string" ? style.fontFamily : undefined,
      fontWeight:
        typeof style.fontWeight === "string" ? style.fontWeight : undefined,
      letterSpacing:
        typeof style.letterSpacing === "number"
          ? style.letterSpacing
          : undefined,
      lineHeight:
        typeof style.lineHeight === "number" ? style.lineHeight : 1.25,
    },
  });

  return textNode(id, name, text, x, y, fitted.width, fitted.height, {
    ...style,
    textFit: {
      strategy: fitted.audit.clipped ? "expanded" : "fits",
      requiredWidth: fitted.audit.requiredWidth,
      requiredHeight: fitted.audit.requiredHeight,
    },
  });
}

function imageNode(
  id: string,
  name: string,
  artifactKey: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    prompt?: string;
    objectFit?: "cover" | "contain" | "fill";
    objectPosition?: string;
    alt?: string;
    style?: Record<string, unknown>;
  },
): DesignNode {
  return {
    id,
    type: "image",
    viewId: "draft",
    name,
    props: {
      artifactKey,
      ...(options.prompt ? { prompt: options.prompt } : {}),
      ...(options.objectFit ? { objectFit: options.objectFit } : {}),
      ...(options.objectPosition
        ? { objectPosition: options.objectPosition }
        : {}),
      ...(options.alt ? { alt: options.alt } : {}),
      ...(options.style ? { style: options.style } : {}),
    },
    bounds: { x, y, width, height },
  };
}

function buttonNode(
  id: string,
  name: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: {
    fill: string;
    stroke: string;
    textFill: string;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: string;
    lineHeight?: number;
    letterSpacing?: number;
  },
): DesignNode {
  return {
    id,
    type: "button",
    viewId: "draft",
    name,
    props: {
      text,
      style: {
        fill: style.fill,
        stroke: style.stroke,
        strokeWidth: 1,
        color: style.textFill,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize ?? 16,
        fontWeight: style.fontWeight ?? "800",
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
      },
    },
    bounds: { x, y, width, height },
  };
}

function cardNodes(input: {
  id: string;
  title: string;
  detail: string;
  x: number;
  y: number;
  width: number;
  height: number;
  asset?: GeneratedReferenceAsset;
  profile: PageProfile;
}) {
  const hasMedia = Boolean(input.asset?.artifactKey);
  const imageHeight = hasMedia ? Math.round(input.height * 0.45) : 0;
  const baseY = input.y + imageHeight;
  const baseHeight = input.height - imageHeight;

  return [
    rectangleNode(
      input.id,
      input.title,
      input.x,
      input.y,
      input.width,
      input.height,
      {
        fill: input.profile.surface,
        stroke: "rgba(23, 33, 18, 0.12)",
        strokeWidth: 1,
        cornerRadius: hasMedia ? 16 : 0,
      },
    ),
    ...(hasMedia && input.asset?.artifactKey
      ? [
          imageNode(
            `${input.id}-image`,
            `${input.title} image`,
            input.asset.artifactKey,
            input.x,
            input.y,
            input.width,
            imageHeight,
            {
              prompt: input.asset.prompt,
              objectFit: input.asset.objectFit ?? "cover",
              objectPosition: input.asset.objectPosition ?? "center top",
              alt: cleanVisibleText(input.asset.label, input.title),
              style: {
                fill: input.profile.surface,
                stroke: "transparent",
                strokeWidth: 0,
                cornerRadius: 16,
              },
            },
          ),
          rectangleNode(
            `${input.id}-base`,
            `${input.title} text base`,
            input.x,
            baseY,
            input.width,
            baseHeight,
            {
              fill: input.profile.surface,
              stroke: "transparent",
              strokeWidth: 0,
            },
          ),
        ]
      : []),
    fittedTextNode(
      `${input.id}-title`,
      `${input.title} title`,
      input.title,
      input.x + 22,
      (hasMedia ? baseY : input.y) + 14,
      input.width - 44,
      26,
      {
        fill: input.profile.ink,
        ...roleStyle(input.profile.typographySystem.roles.cardTitle),
      },
    ),
    fittedTextNode(
      `${input.id}-detail`,
      `${input.title} detail`,
      input.detail,
      input.x + 22,
      (hasMedia ? baseY : input.y) + 46,
      input.width - 44,
      hasMedia ? Math.max(36, baseHeight - 50) : 48,
      {
        fill: input.profile.ink,
        ...roleStyle(input.profile.typographySystem.roles.cardBody),
        opacity: 0.68,
      },
    ),
  ];
}

function metricNode(input: {
  id: string;
  value: string;
  label: string;
  x: number;
  y: number;
  profile: PageProfile;
}) {
  return fittedTextNode(
    input.id,
    input.label,
    `${input.value}\n${input.label}`,
    input.x,
    input.y,
    104,
    66,
    {
      fill: input.profile.ink,
      ...roleStyle(input.profile.typographySystem.roles.metric),
    },
  );
}

function getReferenceAssets(
  draft: ComponentDraft,
  referenceImage?: ReferenceImageArtifact | null,
): GeneratedReferenceAsset[] {
  const source = (
    draft as ComponentDraft & {
      referenceAssets?: GeneratedReferenceAsset[];
    }
  ).referenceAssets?.length
    ? (
        draft as ComponentDraft & {
          referenceAssets?: GeneratedReferenceAsset[];
        }
      ).referenceAssets
    : referenceImage?.referenceAssets;

  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .filter((asset) => {
      const key = asset.artifactKey ?? asset.sourceArtifactKey;
      return typeof key === "string" && /\.(png|jpe?g|webp|gif)$/i.test(key);
    })
    .map((asset) => ({
      ...asset,
      artifactKey: asset.artifactKey ?? asset.sourceArtifactKey,
      objectPosition:
        asset.role === "supporting" || asset.role === "hero"
          ? "center top"
          : "center center",
    }));
}

function stripAgentOnlyNodes(nodes: DesignNode[]) {
  return nodes.filter((node) => {
    const visibleText =
      typeof node.props.text === "string" ? node.props.text : node.name;
    return !hasAgentOnlyText(visibleText);
  });
}

function cleanVisibleText(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const text = value.trim();
  if (!text || hasAgentOnlyText(text)) {
    return fallback;
  }

  return text;
}

function compactVisibleText(
  value: unknown,
  fallback: string,
  maxLength: number,
) {
  const text = cleanVisibleText(value, fallback).replace(/\s+/g, " ").trim();

  if (text.length <= maxLength) {
    return text;
  }

  const words = text.split(" ");
  const compact = words.slice(0, 4).join(" ").slice(0, maxLength).trim();

  return compact || fallback;
}

function fitTypographySystemToArtboard(
  typographySystem: TypographySystem,
): TypographySystem {
  return {
    ...typographySystem,
    roles: {
      ...typographySystem.roles,
      brand: {
        ...typographySystem.roles.brand,
        fontSize: Math.min(typographySystem.roles.brand.fontSize, 22),
        lineHeight: Math.max(0.95, typographySystem.roles.brand.lineHeight),
      },
      nav: {
        ...typographySystem.roles.nav,
        fontSize: Math.min(typographySystem.roles.nav.fontSize, 11),
      },
      hero: {
        ...typographySystem.roles.hero,
        fontSize: Math.min(typographySystem.roles.hero.fontSize, 54),
        lineHeight: Math.max(0.96, typographySystem.roles.hero.lineHeight),
      },
      body: {
        ...typographySystem.roles.body,
        fontSize: Math.min(typographySystem.roles.body.fontSize, 16),
      },
      label: {
        ...typographySystem.roles.label,
        fontSize: Math.min(typographySystem.roles.label.fontSize, 11),
      },
      cardTitle: {
        ...typographySystem.roles.cardTitle,
        fontSize: Math.min(typographySystem.roles.cardTitle.fontSize, 18),
      },
      cardBody: {
        ...typographySystem.roles.cardBody,
        fontSize: Math.min(typographySystem.roles.cardBody.fontSize, 13),
      },
      metric: {
        ...typographySystem.roles.metric,
        fontSize: Math.min(typographySystem.roles.metric.fontSize, 20),
      },
      cta: {
        ...typographySystem.roles.cta,
        fontSize: Math.min(typographySystem.roles.cta.fontSize, 15),
      },
    },
  };
}

function roleStyle(
  role: TypographySystem["roles"][keyof TypographySystem["roles"]],
) {
  return {
    fontFamily: role.fontFamily,
    fontSize: role.fontSize,
    fontWeight: role.fontWeight,
    lineHeight: role.lineHeight,
    letterSpacing: role.letterSpacing,
  };
}

function withOpacity(color: string, opacity: number) {
  if (!color.startsWith("#") || color.length !== 7) {
    return color;
  }

  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);

  if ([red, green, blue].some((value) => Number.isNaN(value))) {
    return color;
  }

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function hasAgentOnlyText(value: string) {
  return [
    /workflow\s+gpt\s+trace/i,
    /generated\s+reference\s+visual/i,
    /reference\s+image\s+artifact/i,
    /generated\s+image\s+artifact/i,
    /local\s+mock/i,
    /agent-smoke/i,
    /backend-trace-smoke/i,
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

function createAgentNoteNode(
  document: DesignDocument,
  prompt: string,
): DesignNode {
  const view =
    document.documentJson.views.find((candidate) => candidate.id === "draft") ??
    document.documentJson.views[0];
  const nodeCount = document.documentJson.nodes.length;
  const width = Math.min(360, Math.max(240, view.width - 80));
  const x = Math.max(32, view.width - width - 40);
  const y = 40 + (nodeCount % 4) * 88;

  return {
    id: `agent-note-${randomUUID()}`,
    type: "text",
    viewId: view.id,
    name: "Agent edit note",
    props: {
      text: prompt,
      style: {
        fill: "#1478f2",
        fontSize: 16,
        fontWeight: "600",
        opacity: 0.9,
      },
    },
    bounds: {
      x,
      y,
      width,
      height: 72,
    },
  };
}

function patchDocumentMetadata(
  documentJson: DesignDocumentJson,
  prompt: string,
  summary: string,
): DesignDocumentJson {
  return {
    ...documentJson,
    styles: {
      ...documentJson.styles,
      agentRunner: {
        prompt,
        summary,
        skillContract: DOCUMENT_DESIGN_DIRECTION,
        updatedAt: new Date().toISOString(),
      },
    },
    metadata: {
      ...documentJson.metadata,
      generatedAt: new Date().toISOString(),
    },
  };
}
