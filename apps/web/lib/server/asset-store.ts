import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { ProjectAsset } from "@/lib/types";

// We mirror the convention used by project-store.ts so user uploads end up
// in the same artifacts tree the existing /api/collect/file route already
// serves. Keeping a per-project subdirectory means we can list, locate, and
// clean up assets without scanning unrelated files.
const DATA_DIR = path.resolve(
  process.cwd(),
  process.env.DATA_DIR ?? ".local-data",
);
const ARTIFACT_DIR = path.join(DATA_DIR, "artifacts");

const SUPPORTED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

const MAX_ASSET_BYTES = 12 * 1024 * 1024;

export const ASSET_LIMITS = {
  maxBytes: MAX_ASSET_BYTES,
  supportedMimeTypes: Array.from(SUPPORTED_MIME_TYPES),
};

function projectAssetsDir(slug: string) {
  // Slugs are validated by Next.js routing; still sanitize defensively to
  // make absolutely sure we never traverse out of the artifacts directory.
  const safeSlug = slug.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeSlug) {
    throw new Error("Invalid project slug");
  }
  return path.join(ARTIFACT_DIR, "projects", safeSlug, "assets");
}

function assetIndexPath(slug: string) {
  return path.join(projectAssetsDir(slug), "index.json");
}

function ensureAssetsDir(slug: string) {
  const dir = projectAssetsDir(slug);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function readIndex(slug: string): ProjectAsset[] {
  const indexPath = assetIndexPath(slug);
  if (!existsSync(indexPath)) {
    return [];
  }
  try {
    const raw = readFileSync(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isProjectAsset);
  } catch {
    return [];
  }
}

function writeIndex(slug: string, entries: ProjectAsset[]) {
  ensureAssetsDir(slug);
  const indexPath = assetIndexPath(slug);
  writeFileSync(indexPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

function isProjectAsset(value: unknown): value is ProjectAsset {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProjectAsset>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.projectSlug === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.artifactKey === "string" &&
    typeof candidate.mime === "string" &&
    typeof candidate.size === "number" &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number" &&
    typeof candidate.addedAt === "string"
  );
}

export function listProjectAssets(slug: string): ProjectAsset[] {
  return readIndex(slug).sort((a, b) => {
    // Newest first so freshly uploaded assets show up at the top of the panel.
    if (a.addedAt === b.addedAt) {
      return a.name.localeCompare(b.name);
    }
    return a.addedAt < b.addedAt ? 1 : -1;
  });
}

export type AddProjectAssetInput = {
  slug: string;
  name: string;
  mime: string;
  bytes: Buffer;
  width: number;
  height: number;
};

export function addProjectAsset(
  input: AddProjectAssetInput,
): ProjectAsset {
  const { slug, mime, bytes } = input;

  if (!SUPPORTED_MIME_TYPES.has(mime)) {
    throw new Error(`Unsupported image type: ${mime}`);
  }
  if (bytes.byteLength === 0) {
    throw new Error("Empty file");
  }
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error(
      `File too large (max ${Math.round(MAX_ASSET_BYTES / (1024 * 1024))} MB)`,
    );
  }

  const assetsDir = ensureAssetsDir(slug);
  const id = randomUUID();
  const ext = MIME_EXTENSIONS[mime] ?? "bin";
  const filename = `${id}.${ext}`;
  const filePath = path.join(assetsDir, filename);
  writeFileSync(filePath, bytes);

  const cleanedName = sanitizeAssetName(input.name) || `Asset ${id.slice(0, 6)}`;

  const asset: ProjectAsset = {
    id,
    projectSlug: slug,
    name: cleanedName,
    artifactKey: `projects/${slug}/assets/${filename}`,
    mime,
    size: bytes.byteLength,
    width: Math.max(1, Math.round(Number.isFinite(input.width) ? input.width : 0)),
    height: Math.max(
      1,
      Math.round(Number.isFinite(input.height) ? input.height : 0),
    ),
    addedAt: new Date().toISOString(),
  };

  const entries = readIndex(slug);
  entries.push(asset);
  writeIndex(slug, entries);
  return asset;
}

export function renameProjectAsset(
  slug: string,
  assetId: string,
  nextName: string,
): ProjectAsset | null {
  const entries = readIndex(slug);
  const idx = entries.findIndex((entry) => entry.id === assetId);
  if (idx === -1) return null;
  entries[idx] = {
    ...entries[idx],
    name: sanitizeAssetName(nextName) || entries[idx].name,
  };
  writeIndex(slug, entries);
  return entries[idx];
}

export function deleteProjectAsset(slug: string, assetId: string): boolean {
  const entries = readIndex(slug);
  const idx = entries.findIndex((entry) => entry.id === assetId);
  if (idx === -1) return false;
  const asset = entries[idx];
  // Remove the underlying file before mutating the index so a partial
  // failure leaves the index pointing at a still-present file rather than
  // orphaning a metadata entry whose blob is already gone.
  const filePath = path.join(
    DATA_DIR,
    "artifacts",
    asset.artifactKey,
  );
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Swallow filesystem errors; we still want to drop the index entry so
    // the panel doesn't keep showing a broken thumbnail.
  }
  entries.splice(idx, 1);
  writeIndex(slug, entries);
  return true;
}

function sanitizeAssetName(name: string) {
  if (typeof name !== "string") return "";
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 120);
}
