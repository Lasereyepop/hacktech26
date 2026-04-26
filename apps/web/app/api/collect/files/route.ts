import { NextRequest, NextResponse } from "next/server";
import { readdirSync } from "fs";
import { join, extname } from "path";

import { resolveWorkspacePath } from "@/lib/server/collect-paths";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif"]);
const VIDEO_EXTS = new Set([".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"]);

interface FileEntry {
  path: string;
  relativePath: string;
  type: "image" | "video";
}

function walkDir(base: string, current: string, results: FileEntry[]) {
  const entries = readdirSync(current, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      walkDir(base, full, results);
    } else {
      const ext = extname(entry.name).toLowerCase();
      if (IMAGE_EXTS.has(ext)) {
        results.push({ path: full, relativePath: full.slice(base.length + 1), type: "image" });
      } else if (VIDEO_EXTS.has(ext)) {
        results.push({ path: full, relativePath: full.slice(base.length + 1), type: "video" });
      }
    }
  }
}

export async function GET(req: NextRequest) {
  const dir = req.nextUrl.searchParams.get("dir");
  if (!dir) return NextResponse.json({ error: "dir required" }, { status: 400 });

  try {
    const resolvedDir = resolveWorkspacePath(dir);
    const files: FileEntry[] = [];
    walkDir(resolvedDir, resolvedDir, files);
    return NextResponse.json({ files });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
