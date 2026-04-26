import { tasteEvaluatorAgent } from "@/lib/server/agents/taste-evaluator";
import {
  createHeatmapResult,
  createModelJob,
  createRenderArtifact,
  getLatestDesignDocument,
  getModelJob,
  getProject,
  getRenderArtifact,
  setProjectEvaluation,
  updateModelJob,
} from "@/lib/server/project-store";

export async function runHeatmapJobForView(
  slug: string,
  viewId: string,
  options: {
    renderArtifactId?: string;
    width?: number;
    height?: number;
    deviceScale?: number;
    theme?: string;
    updateProjectEvaluation?: boolean;
  } = {},
) {
  const project = getProject(slug);

  if (!project) {
    return { error: "Project not found.", status: 404 as const };
  }

  if (!project.currentDraft) {
    return {
      error: "Build a component draft before evaluating.",
      status: 400 as const,
    };
  }

  const renderArtifact = options.renderArtifactId
    ? getRenderArtifact(options.renderArtifactId)
    : createRenderArtifact(slug, {
        viewId,
        width: options.width,
        height: options.height,
        deviceScale: options.deviceScale,
        theme: options.theme,
      });

  if (!renderArtifact || renderArtifact.projectId !== project.id) {
    return { error: "Render artifact not found.", status: 404 as const };
  }

  const queuedJob = createModelJob(slug, {
    renderArtifactId: renderArtifact.id,
    status: "queued",
  });

  if (!queuedJob) {
    return { error: "Could not create model job.", status: 500 as const };
  }

  updateModelJob(queuedJob.id, { status: "running" });

  try {
    const document = getLatestDesignDocument(slug) ?? undefined;
    const evaluation = await tasteEvaluatorAgent(project, {
      document,
      renderArtifact,
      viewId,
    });

    const result = createHeatmapResult({
      modelJobId: queuedJob.id,
      renderArtifactId: renderArtifact.id,
      regions: evaluation.attentionRegions,
      metrics: {
        score: evaluation.score,
        criteriaScores: evaluation.criteriaScores,
      },
      modelVersion: evaluation.modelMode,
    });
    const job = updateModelJob(queuedJob.id, { status: "succeeded" });
    const updatedProject = options.updateProjectEvaluation
      ? setProjectEvaluation(slug, evaluation)
      : getProject(slug);

    return {
      project: updatedProject,
      evaluation,
      renderArtifact,
      job: job ?? getModelJob(queuedJob.id),
      heatmap: result,
      status: 200 as const,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Evaluation failed unexpectedly.";
    const job = updateModelJob(queuedJob.id, {
      status: "failed",
      error: message,
    });

    return {
      error: message,
      renderArtifact,
      job,
      status: 502 as const,
    };
  }
}
