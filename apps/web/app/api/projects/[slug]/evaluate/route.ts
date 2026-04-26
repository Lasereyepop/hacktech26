import { NextResponse } from "next/server";
import { runHeatmapJobForView } from "@/lib/server/heatmap-service";
import { getProject, updateProjectRun } from "@/lib/server/project-store";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const project = getProject(slug);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  if (!project.currentDraft) {
    return NextResponse.json(
      { error: "Build a component draft before evaluating." },
      { status: 400 },
    );
  }

  updateProjectRun(slug, "evaluating", "Running attention evaluation");

  const result = await runHeatmapJobForView(slug, "draft", {
    updateProjectEvaluation: true,
  });

  if ("error" in result) {
    updateProjectRun(slug, "idle", "Evaluation failed");

    return NextResponse.json(
      {
        error: result.error,
        job: result.job,
      },
      { status: result.status },
    );
  }

  return NextResponse.json({
    project: result.project,
    evaluation: result.evaluation,
    renderArtifact: result.renderArtifact,
    job: result.job,
    heatmap: result.heatmap,
  });
}
