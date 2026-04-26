import { NextResponse } from "next/server";
import { runHeatmapJobForView } from "@/lib/server/heatmap-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; viewId: string }> },
) {
  const { slug, viewId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    renderArtifactId?: string;
    width?: number;
    height?: number;
    deviceScale?: number;
    theme?: string;
  };
  const result = await runHeatmapJobForView(slug, viewId, {
    renderArtifactId: body.renderArtifactId,
    width: body.width,
    height: body.height,
    deviceScale: body.deviceScale,
    theme: body.theme,
    updateProjectEvaluation: false,
  });

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error, job: result.job },
      { status: result.status },
    );
  }

  return NextResponse.json(
    {
      job: result.job,
      renderArtifact: result.renderArtifact,
      heatmap: result.heatmap,
      evaluation: result.evaluation,
    },
    { status: 201 },
  );
}
