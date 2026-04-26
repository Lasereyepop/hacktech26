import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/server/project-store";

export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    type?: string;
    brief?: string;
    agentic?: boolean;
  };

  if (!body.name?.trim()) {
    return NextResponse.json(
      { error: "Project name is required." },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      project: await createProject({
        name: body.name,
        type: body.type,
        brief: body.brief,
        agentic: body.agentic,
      }),
    },
    { status: 201 },
  );
}
