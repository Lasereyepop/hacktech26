import type {
  DesignDocument,
  RenderArtifact,
  TasteEvaluation,
  TasteProject,
} from "@/lib/types";
import { evaluateWithFoundationModel } from "@/lib/server/model-client";

export async function tasteEvaluatorAgent(
  project: TasteProject,
  context: {
    document?: DesignDocument;
    renderArtifact?: RenderArtifact;
    viewId?: string;
  } = {},
): Promise<TasteEvaluation> {
  if (!project.currentDraft) {
    throw new Error("A component draft is required before evaluation.");
  }

  const response = await evaluateWithFoundationModel({
    project,
    draft: project.currentDraft,
    document: context.document,
    renderArtifact: context.renderArtifact,
    viewId: context.viewId,
  });

  return {
    id: `evaluation-${Date.now()}`,
    score: response.score,
    summary: response.summary,
    criteriaScores: response.criteriaScores,
    notes: response.notes,
    attentionRegions: response.attentionRegions,
    suggestedEdits: response.suggestedEdits,
    modelMode: response.mode,
    createdAt: new Date().toISOString(),
  };
}
