import { NextResponse } from "next/server";
import { getModelJob } from "@/lib/server/project-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; jobId: string }> },
) {
  const { slug, jobId } = await params;
  const job = getModelJob(jobId, slug);

  if (!job) {
    return NextResponse.json(
      { error: "Model job not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ job });
}
