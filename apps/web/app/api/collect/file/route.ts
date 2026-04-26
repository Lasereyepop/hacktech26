import { NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import { extname } from "path";
import { Readable } from "stream";

import {
  resolveArtifactPath,
  resolveWorkspacePath,
} from "@/lib/server/collect-paths";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  bmp: "image/bmp",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
  m4v: "video/x-m4v",
};

function mime(filePath: string) {
  return (
    MIME[extname(filePath).slice(1).toLowerCase()] ?? "application/octet-stream"
  );
}

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  const artifactKey = req.nextUrl.searchParams.get("artifactKey");
  if (!filePath && !artifactKey) {
    return new NextResponse("path or artifactKey required", { status: 400 });
  }

  let resolvedPath: string;
  try {
    resolvedPath = artifactKey
      ? resolveArtifactPath(artifactKey)
      : resolveWorkspacePath(filePath ?? "");
  } catch {
    return new NextResponse("invalid path", { status: 400 });
  }

  let stat;
  try {
    stat = statSync(resolvedPath);
  } catch {
    return new NextResponse("not found", { status: 404 });
  }

  const contentType = mime(resolvedPath);
  const rangeHeader = req.headers.get("range");

  if (rangeHeader) {
    const [startStr, endStr] = rangeHeader.replace(/bytes=/, "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
    const stream = createReadStream(resolvedPath, { start, end });
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const stream = createReadStream(resolvedPath);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
    },
  });
}
