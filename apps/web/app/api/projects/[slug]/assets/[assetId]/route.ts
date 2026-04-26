import { NextResponse } from "next/server";

import {
  deleteProjectAsset,
  renameProjectAsset,
} from "@/lib/server/asset-store";
import { getProject } from "@/lib/server/project-store";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; assetId: string }> },
) {
  const { slug, assetId } = await params;
  const project = getProject(slug);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  let body: { name?: string };
  try {
    body = (await request.json()) as { name?: string };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (typeof body.name !== "string") {
    return NextResponse.json(
      { error: "Missing 'name' field." },
      { status: 400 },
    );
  }

  const next = renameProjectAsset(slug, assetId, body.name);
  if (!next) {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }
  return NextResponse.json({ asset: next });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string; assetId: string }> },
) {
  const { slug, assetId } = await params;
  const project = getProject(slug);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const ok = deleteProjectAsset(slug, assetId);
  if (!ok) {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
