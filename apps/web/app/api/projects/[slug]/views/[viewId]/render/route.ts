import { NextResponse } from "next/server";
import { createRenderArtifact } from "@/lib/server/project-store";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; viewId: string }> },
) {
  const { slug, viewId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    width?: number;
    height?: number;
    deviceScale?: number;
    theme?: string;
  };
  const renderArtifact = createRenderArtifact(slug, {
    viewId,
    width: body.width,
    height: body.height,
    deviceScale: body.deviceScale,
    theme: body.theme,
  });

  if (!renderArtifact) {
    return NextResponse.json(
      { error: "Project, design document, or view not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ renderArtifact }, { status: 201 });
}
