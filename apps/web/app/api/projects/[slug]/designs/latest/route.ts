import { NextResponse } from "next/server";
import {
  getLatestDesignDocument,
  getProject,
} from "@/lib/server/project-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const project = getProject(slug);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const design = getLatestDesignDocument(slug);

  return NextResponse.json({ design });
}
