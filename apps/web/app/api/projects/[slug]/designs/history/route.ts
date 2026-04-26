import { NextResponse } from "next/server";
import { moveDesignDocumentHistory } from "@/lib/server/project-store";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    direction?: "undo" | "redo";
  };

  if (body.direction !== "undo" && body.direction !== "redo") {
    return NextResponse.json(
      { error: "direction must be undo or redo." },
      { status: 400 },
    );
  }

  const design = moveDesignDocumentHistory(slug, body.direction);

  if (!design) {
    return NextResponse.json(
      { error: `Nothing to ${body.direction}.` },
      { status: 409 },
    );
  }

  return NextResponse.json({ design }, { status: 201 });
}
