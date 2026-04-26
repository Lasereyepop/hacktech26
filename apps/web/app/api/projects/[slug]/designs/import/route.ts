import { NextResponse } from "next/server";
import type { DesignDocumentJson } from "@/lib/types";
import { createImportedDesignDocument } from "@/lib/server/project-store";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    documentJson?: DesignDocumentJson;
    sourceArtifactKey?: string;
    sourceType?: "fig-import" | "fig-like" | "internal";
  };

  if (!body.documentJson || !Array.isArray(body.documentJson.views)) {
    return NextResponse.json(
      {
        error:
          "JSON import requires documentJson in the internal scene graph format.",
      },
      { status: 400 },
    );
  }

  const design = createImportedDesignDocument(slug, {
    documentJson: body.documentJson,
    sourceArtifactKey: body.sourceArtifactKey,
    sourceType: body.sourceType ?? "fig-like",
  });

  if (!design) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  return NextResponse.json({ design }, { status: 201 });
}
