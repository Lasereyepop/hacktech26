import type {
  AttentionRegion,
  ComponentDraft,
  DesignDocument,
  RenderArtifact,
  TasteProject,
} from "@/lib/types";
import { TASTE_LAB_TASTE_CONTRACT } from "@/lib/server/agent-runner/skill-prompts";
import { auditDesignTextNodes } from "@/lib/text-fit";

export type FoundationModelRequest = {
  project: TasteProject;
  draft: ComponentDraft;
  document?: DesignDocument;
  renderArtifact?: RenderArtifact;
  viewId?: string;
};

export type FoundationModelResponse = {
  score: number;
  summary: string;
  criteriaScores: Array<{
    label: string;
    score: number;
  }>;
  notes: Array<{
    title: string;
    detail: string;
    priority: string;
  }>;
  attentionRegions: AttentionRegion[];
  suggestedEdits: string[];
  mode: "http" | "mock";
};

export async function evaluateWithFoundationModel(
  request: FoundationModelRequest,
): Promise<FoundationModelResponse> {
  const modelUrl = process.env.FOUNDATION_MODEL_URL;
  const textFitAudits = request.document
    ? auditDesignTextNodes(request.document.documentJson.nodes, request.viewId)
    : [];
  const referenceAssets = getReferenceAssets(request.document);
  const typographySystems = getTypographySystems(request.document);
  const imageNodeCount =
    request.document?.documentJson.nodes.filter(
      (node) => node.viewId === request.viewId && node.type === "image",
    ).length ?? 0;

  if (modelUrl) {
    const response = await fetch(modelUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.FOUNDATION_MODEL_API_KEY
          ? { Authorization: `Bearer ${process.env.FOUNDATION_MODEL_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        evaluationGuidance: [
          TASTE_LAB_TASTE_CONTRACT,
          "Evaluate predicted attention order: product signal, headline, primary CTA, proof, feature content, then secondary actions.",
          "Flag any text node whose textFitAudit.fits is false as a high-priority implementation failure.",
          "Evaluate spacing rhythm, typography system coherence, and whether generated assets are structural image components rather than placeholder rectangles.",
          "Return concrete patchable edits, not generic taste advice.",
        ].join("\n"),
        project: {
          id: request.project.id,
          slug: request.project.slug,
          name: request.project.name,
          type: request.project.type,
          brief: request.project.brief,
        },
        document: request.document
          ? {
              id: request.document.id,
              version: request.document.version,
              schemaVersion: request.document.schemaVersion,
            }
          : null,
        artifact: request.draft,
        viewport: {
          width: request.renderArtifact?.width ?? 1200,
          height: request.renderArtifact?.height ?? 760,
        },
        render: request.renderArtifact
          ? {
              id: request.renderArtifact.id,
              imageKey: request.renderArtifact.imageKey,
              viewId: request.renderArtifact.viewId,
              documentVersionId: request.renderArtifact.documentVersionId,
            }
          : null,
        nodeBoxes:
          request.document?.documentJson.nodes
            .filter((node) => node.viewId === request.viewId)
            .map((node) => ({
              id: node.id,
              type: node.type,
              name: node.name,
              bounds: node.bounds,
            })) ?? [],
        implementationAudit: {
          textFitAudits,
          spacing: getSpacingAudit(request.document, request.viewId),
          typographySystems,
          imageNodeCount,
          referenceAssets,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Foundation model failed with ${response.status}`);
    }

    return {
      ...(await response.json()),
      mode: "http",
    } as FoundationModelResponse;
  }

  return getMockFoundationModelResponse(request, {
    textFitAudits,
    imageNodeCount,
    referenceAssetCount: referenceAssets.length,
    typographySystems,
  });
}

function getMockFoundationModelResponse({
  draft,
  project,
}: FoundationModelRequest, audit?: {
  textFitAudits: ReturnType<typeof auditDesignTextNodes>;
  imageNodeCount: number;
  referenceAssetCount: number;
  typographySystems: string[];
}): FoundationModelResponse {
  const textFailures = audit?.textFitAudits.filter((item) => !item.fits) ?? [];
  const score = Math.min(
    94,
    Math.max(
      52,
      78 +
        (draft.headline.length % 8) +
        (project.brief.length % 5) -
        textFailures.length * 8 +
        Math.min(4, audit?.imageNodeCount ?? 0),
    ),
  );

  return {
    score,
    summary:
      "Predicted attention lands on the headline and primary action first, with supporting proof visible but secondary.",
    criteriaScores: [
      { label: "Hierarchy", score: score + 2 },
      { label: "CTA clarity", score: score - 1 },
      { label: "Trust", score: score - 4 },
      { label: "Visual focus", score },
      { label: "Text fit", score: textFailures.length ? 58 : score + 1 },
      {
        label: "Spacing rhythm",
        score: textFailures.length ? score - 8 : score,
      },
      {
        label: "Typography",
        score: audit?.typographySystems.length ? score + 1 : score - 3,
      },
      {
        label: "Asset use",
        score:
          (audit?.imageNodeCount ?? 0) > 0 || (audit?.referenceAssetCount ?? 0) > 0
            ? score + 1
            : score - 6,
      },
    ],
    notes: [
      ...(textFailures.length
        ? [
            {
              title: "Text fit failure",
              detail: `${textFailures.length} text node${
                textFailures.length === 1 ? "" : "s"
              } require larger bounds before this design is acceptable.`,
              priority: "High",
            },
          ]
        : []),
      {
        title: "Primary attention path",
        detail:
          draft.attentionGoal ??
          "The headline and CTA receive the highest predicted attention, which matches the intended first read.",
        priority: "High",
      },
      {
        title: "Evidence density",
        detail:
          "Supporting proof is visible, but the middle card should stay simpler than the primary action path.",
        priority: "Medium",
      },
      {
        title: "Product interpretation",
        detail:
          audit?.imageNodeCount
            ? (draft.imageDirection ??
              "The design uses structural image nodes to explain the product category.")
            : "The design still needs structural image nodes instead of placeholder media surfaces.",
        priority: "Medium",
      },
    ],
    attentionRegions: [
      {
        id: "headline",
        label: "Headline",
        rationale: "Highest predicted first-fixation area.",
        intensity: 92,
        x: 10,
        y: 14,
        width: 48,
        height: 22,
      },
      {
        id: "cta",
        label: "Primary CTA",
        rationale: "Strong action contrast pulls the second attention cluster.",
        intensity: 84,
        x: 12,
        y: 50,
        width: 27,
        height: 11,
      },
      {
        id: "proof",
        label: "Proof cards",
        rationale: "Secondary evidence is noticed after the main action.",
        intensity: 66,
        x: 62,
        y: 20,
        width: 28,
        height: 52,
      },
    ],
    suggestedEdits: [
      ...(textFailures.length ? ["Auto-fit clipped text nodes"] : []),
      "Strengthen CTA contrast",
      "Reduce decorative noise",
      "Move concrete proof closer to first scan",
    ],
    mode: "mock",
  };
}

function getReferenceAssets(document: DesignDocument | undefined) {
  const agentRunner = document?.documentJson.styles.agentRunner;
  if (!agentRunner || typeof agentRunner !== "object") {
    return [];
  }

  const assets = (agentRunner as { referenceAssets?: unknown }).referenceAssets;
  return Array.isArray(assets) ? assets : [];
}

function getTypographySystems(document: DesignDocument | undefined) {
  const agentRunner = document?.documentJson.styles.agentRunner;
  const system =
    agentRunner && typeof agentRunner === "object"
      ? (agentRunner as { typographySystem?: unknown }).typographySystem
      : null;
  const systems = typeof system === "string" && system.trim() ? [system] : [];
  const fontFamilies =
    document?.documentJson.nodes
      .map((node) =>
        node.props.style &&
        typeof node.props.style === "object" &&
        typeof (node.props.style as { fontFamily?: unknown }).fontFamily ===
          "string"
          ? ((node.props.style as { fontFamily: string }).fontFamily)
          : null,
      )
      .filter((font): font is string => Boolean(font)) ?? [];

  return Array.from(new Set([...systems, ...fontFamilies])).slice(0, 8);
}

function getSpacingAudit(document: DesignDocument | undefined, viewId?: string) {
  const nodes =
    document?.documentJson.nodes.filter((node) => !viewId || node.viewId === viewId) ??
    [];
  const sorted = [...nodes].sort((a, b) => a.bounds.y - b.bounds.y);
  const minGap = sorted.reduce<number | null>((smallest, node, index) => {
    const previous = sorted[index - 1];
    if (!previous) return smallest;
    const gap = node.bounds.y - (previous.bounds.y + previous.bounds.height);
    if (gap < 0) return smallest;
    return smallest === null ? gap : Math.min(smallest, gap);
  }, null);

  return {
    nodeCount: nodes.length,
    minVerticalGap: minGap,
    hasTightOverlaps: minGap !== null && minGap < 8,
  };
}
