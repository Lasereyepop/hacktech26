import { NextResponse } from "next/server";
import { createComment, listComments } from "@/lib/server/project-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const comments = listComments(slug);

  if (!comments) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  return NextResponse.json({ comments });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    documentVersionId?: string;
    viewId?: string;
    nodeId?: string | null;
    x?: number;
    y?: number;
    body?: string;
    authorId?: string;
  };

  if (
    !body.viewId ||
    typeof body.x !== "number" ||
    typeof body.y !== "number"
  ) {
    return NextResponse.json(
      { error: "viewId, x, and y are required." },
      { status: 400 },
    );
  }

  if (!body.body?.trim()) {
    return NextResponse.json(
      { error: "Comment body is required." },
      { status: 400 },
    );
  }

  const comment = createComment(slug, {
    documentVersionId: body.documentVersionId,
    viewId: body.viewId,
    nodeId: body.nodeId,
    x: body.x,
    y: body.y,
    body: body.body.trim(),
    authorId: body.authorId,
  });

  if (!comment) {
    return NextResponse.json(
      { error: "Project or design document not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ comment }, { status: 201 });
}
