import { NextResponse } from "next/server";

import {
  addProjectAsset,
  ASSET_LIMITS,
  listProjectAssets,
} from "@/lib/server/asset-store";
import { getProject } from "@/lib/server/project-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const assets = listProjectAssets(slug);
  return NextResponse.json({ assets });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Upload must use multipart/form-data." },
      { status: 415 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Could not parse upload payload." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing 'file' field." },
      { status: 400 },
    );
  }

  if (!ASSET_LIMITS.supportedMimeTypes.includes(file.type)) {
    return NextResponse.json(
      {
        error: `Unsupported image type: ${file.type || "unknown"}`,
        supportedMimeTypes: ASSET_LIMITS.supportedMimeTypes,
      },
      { status: 415 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > ASSET_LIMITS.maxBytes) {
    return NextResponse.json(
      {
        error: `File too large (max ${Math.round(
          ASSET_LIMITS.maxBytes / (1024 * 1024),
        )} MB)`,
      },
      { status: 413 },
    );
  }

  const widthRaw = formData.get("width");
  const heightRaw = formData.get("height");
  const width = typeof widthRaw === "string" ? Number(widthRaw) : 0;
  const height = typeof heightRaw === "string" ? Number(heightRaw) : 0;

  const nameField = formData.get("name");
  const fallbackName = file.name?.replace(/\.[^.]+$/, "") || "Untitled asset";
  const name =
    typeof nameField === "string" && nameField.trim().length > 0
      ? nameField
      : fallbackName;

  try {
    const asset = addProjectAsset({
      slug,
      name,
      mime: file.type,
      bytes: buffer,
      width: width || 1,
      height: height || 1,
    });
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save asset.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
