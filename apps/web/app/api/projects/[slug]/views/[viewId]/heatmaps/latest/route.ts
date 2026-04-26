import { NextResponse } from "next/server";
import { getLatestHeatmapResult, getProject } from "@/lib/server/project-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; viewId: string }> },
) {
  const { slug, viewId } = await params;
  const project = getProject(slug);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const heatmap = getLatestHeatmapResult(slug, viewId);

  return NextResponse.json({ heatmap });
}
