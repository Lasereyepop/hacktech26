import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ReferenceAsset } from "@/lib/types";
import {
  REFERENCE_IMAGE_DIRECTION,
  TASTE_LAB_TASTE_CONTRACT,
} from "@/lib/server/agent-runner/skill-prompts";

const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_SIZE = "1536x1024";
const DEFAULT_IMAGE_QUALITY = "medium";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";
const DATA_DIR = path.resolve(
  process.cwd(),
  process.env.DATA_DIR ?? ".local-data",
);
const ARTIFACT_DIR = path.join(DATA_DIR, "artifacts");

export type ReferenceImageArtifact = {
  artifactKey: string;
  metadataKey: string;
  model: string | "local-mock";
  prompt: string;
  createdAt: string;
  enrichmentStatus?: "pending" | "complete" | "failed";
  referenceAssets?: ReferenceAsset[];
};

export async function generateReferenceImageTool(input: {
  prompt: string;
  slug: string;
}): Promise<ReferenceImageArtifact> {
  const createdAt = new Date().toISOString();
  const prompt = buildImagePrompt(input.prompt);
  const id = `reference-${randomUUID()}`;
  const model = getImageModel();

  if (!process.env.OPENAI_API_KEY) {
    return writeMockReferenceImage({
      slug: input.slug,
      id,
      prompt,
      createdAt,
    });
  }

  const response = await fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: getImageSize(),
      quality: getImageQuality(),
      output_format: "png",
    }),
  });

  if (!response.ok) {
    return writeMockReferenceImage({
      slug: input.slug,
      id,
      prompt,
      createdAt,
      error: await getImageGenerationError(response),
    });
  }

  const body = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  };
  const image = body.data?.[0];
  const metadataKey = `agent-images/${input.slug}/${id}.json`;

  if (image?.b64_json) {
    const imageKey = `agent-images/${input.slug}/${id}.png`;
    writeBinaryArtifact(imageKey, Buffer.from(image.b64_json, "base64"));
    const referenceAssets = createImmediateReferenceAssets({
      sourceArtifactKey: imageKey,
      prompt,
      createdAt,
    });
    writeArtifact(metadataKey, {
      kind: "reference-image",
      model,
      prompt,
      revisedPrompt: image.revised_prompt ?? null,
      imageKey,
      referenceAssets,
      enrichmentStatus: "pending",
      createdAt,
    });

    return {
      artifactKey: imageKey,
      metadataKey,
      model,
      prompt,
      createdAt,
      enrichmentStatus: "pending",
      referenceAssets,
    };
  }

  writeArtifact(metadataKey, {
    kind: "reference-image",
    model,
    prompt,
    url: image?.url ?? null,
    revisedPrompt: image?.revised_prompt ?? null,
    enrichmentStatus: "failed",
    createdAt,
  });

  return {
    artifactKey: metadataKey,
    metadataKey,
    model,
    prompt,
    createdAt,
    enrichmentStatus: "failed",
    referenceAssets: [
      createMetadataOnlyAsset({
        sourceArtifactKey: metadataKey,
        prompt,
        createdAt,
        error: "Image API returned metadata without an inline image payload.",
      }),
    ],
  };
}

function getImageModel() {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
}

function getImageSize() {
  return process.env.OPENAI_IMAGE_SIZE?.trim() || DEFAULT_IMAGE_SIZE;
}

function getImageQuality() {
  return process.env.OPENAI_IMAGE_QUALITY?.trim() || DEFAULT_IMAGE_QUALITY;
}

async function getImageGenerationError(response: Response) {
  const fallback = `GPT image generation failed with ${response.status}`;

  try {
    const body = (await response.json()) as {
      error?: { message?: unknown };
    };
    const message = body.error?.message;

    return typeof message === "string" && message.trim()
      ? `${fallback}: ${message.trim()}`
      : fallback;
  } catch {
    return fallback;
  }
}

function buildImagePrompt(prompt: string) {
  return [
    TASTE_LAB_TASTE_CONTRACT,
    REFERENCE_IMAGE_DIRECTION,
    "Output target: one high-fidelity product design reference image for a portfolio-worthy frontend interface.",
    "Make hierarchy, section rhythm, typography scale, CTA priority, media treatment, and component styling legible enough to build from.",
    "Avoid generic startup copy, fake dashboards, decorative blobs, and overpacked first viewports.",
    `Project request: ${prompt.trim() || "Build a Taste Lab design portfolio screen."}`,
  ].join("\n");
}

function writeMockReferenceImage(input: {
  slug: string;
  id: string;
  prompt: string;
  createdAt: string;
  error?: string;
}): ReferenceImageArtifact {
  const referenceAssets = [
    createMetadataOnlyAsset({
      sourceArtifactKey: `agent-images/${input.slug}/${input.id}.json`,
      prompt: input.prompt,
      createdAt: input.createdAt,
      error: input.error ?? "No OPENAI_API_KEY configured.",
    }),
  ];
  const metadataKey = writeArtifact(
    `agent-images/${input.slug}/${input.id}.json`,
    {
      kind: "mock-reference-image",
      model: "local-mock",
      prompt: input.prompt,
      error: input.error ?? null,
      referenceAssets,
      createdAt: input.createdAt,
    },
  );

  return {
    artifactKey: metadataKey,
    metadataKey,
    model: "local-mock",
    prompt: input.prompt,
    createdAt: input.createdAt,
    enrichmentStatus: "failed",
    referenceAssets,
  };
}

function createImmediateReferenceAssets(input: {
  sourceArtifactKey: string;
  prompt: string;
  createdAt: string;
}): ReferenceAsset[] {
  return [
    {
      id: `asset-${randomUUID()}`,
      label: "Full reference image",
      role: "hero",
      source: "reference-full",
      kind: "image-region",
      sourceArtifactKey: input.sourceArtifactKey,
      artifactKey: input.sourceArtifactKey,
      metadataKey: null,
      prompt: input.prompt,
      confidence: 0.72,
      objectFit: "cover",
      componentHint:
        "Use the full generated reference image as the initial hero/product media while crop enrichment runs.",
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      imageSize: null,
      extractionStatus: "extracted",
      extractionError: null,
      createdAt: input.createdAt,
    },
  ];
}

export async function enrichReferenceImageArtifact(
  artifact: ReferenceImageArtifact,
): Promise<ReferenceImageArtifact> {
  if (
    artifact.model === "local-mock" ||
    !artifact.artifactKey.endsWith(".png")
  ) {
    return {
      ...artifact,
      enrichmentStatus: "failed",
    };
  }

  const slug = getSlugFromArtifactKey(artifact.artifactKey);

  if (!slug) {
    return {
      ...artifact,
      enrichmentStatus: "failed",
    };
  }

  const initialAssets = artifact.referenceAssets ?? [];

  try {
    const extractedAssets = await extractReferenceAssets({
      slug,
      sourceArtifactKey: artifact.artifactKey,
      prompt: artifact.prompt,
      createdAt: artifact.createdAt,
    });
    const referenceAssets = mergeReferenceAssets(
      initialAssets,
      extractedAssets,
    );
    writeArtifact(artifact.metadataKey, {
      kind: "reference-image",
      model: artifact.model,
      prompt: artifact.prompt,
      imageKey: artifact.artifactKey,
      referenceAssets,
      enrichmentStatus: "complete",
      createdAt: artifact.createdAt,
      enrichedAt: new Date().toISOString(),
    });

    return {
      ...artifact,
      enrichmentStatus: "complete",
      referenceAssets,
    };
  } catch (error) {
    writeArtifact(artifact.metadataKey, {
      kind: "reference-image",
      model: artifact.model,
      prompt: artifact.prompt,
      imageKey: artifact.artifactKey,
      referenceAssets: initialAssets,
      enrichmentStatus: "failed",
      enrichmentError:
        error instanceof Error ? error.message : "Reference enrichment failed.",
      createdAt: artifact.createdAt,
      enrichedAt: new Date().toISOString(),
    });

    return {
      ...artifact,
      enrichmentStatus: "failed",
      referenceAssets: initialAssets,
    };
  }
}

function getSlugFromArtifactKey(artifactKey: string) {
  const match = /^agent-images\/([^/]+)\//.exec(artifactKey);
  return match?.[1] ?? null;
}

function mergeReferenceAssets(
  initialAssets: ReferenceAsset[],
  extractedAssets: ReferenceAsset[],
) {
  const seen = new Set<string>();
  return [...initialAssets, ...extractedAssets].filter((asset) => {
    const key = asset.artifactKey ?? asset.metadataKey ?? asset.id;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function extractReferenceAssets(input: {
  slug: string;
  sourceArtifactKey: string;
  prompt: string;
  createdAt: string;
}): Promise<ReferenceAsset[]> {
  try {
    const sharp = (await import("sharp")).default;
    const sourcePath = path.join(ARTIFACT_DIR, input.sourceArtifactKey);
    const source = sharp(readFileSync(sourcePath));
    const metadata = await source.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    if (width <= 0 || height <= 0) {
      return [
        createMetadataOnlyAsset({
          sourceArtifactKey: input.sourceArtifactKey,
          prompt: input.prompt,
          createdAt: input.createdAt,
          error: "Generated image dimensions could not be read.",
        }),
      ];
    }

    const regions = getReferenceAssetRegions(width, height);
    const assets: ReferenceAsset[] = [];

    for (const region of regions) {
      const assetId = `asset-${randomUUID()}`;
      const artifactKey = `agent-images/${input.slug}/${assetId}.png`;
      const metadataKey = `agent-images/${input.slug}/${assetId}.json`;
      const bounds = clampRegion(region.bounds, width, height);

      await sharp(sourcePath)
        .extract({
          left: Math.round(bounds.x),
          top: Math.round(bounds.y),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        })
        .png()
        .toFile(path.join(ARTIFACT_DIR, artifactKey));

      const asset: ReferenceAsset = {
        id: assetId,
        label: region.label,
        role: region.role,
        source: "reference-crop",
        kind: "image-region",
        sourceArtifactKey: input.sourceArtifactKey,
        artifactKey,
        metadataKey,
        prompt: input.prompt,
        confidence: region.confidence,
        objectFit: "cover",
        componentHint: region.componentHint,
        bounds,
        imageSize: { width, height },
        extractionStatus: "extracted",
        extractionError: null,
        createdAt: input.createdAt,
      };
      writeArtifact(metadataKey, {
        kind: "reference-asset",
        ...asset,
      });
      assets.push(asset);
    }

    return assets;
  } catch (error) {
    return [
      createMetadataOnlyAsset({
        sourceArtifactKey: input.sourceArtifactKey,
        prompt: input.prompt,
        createdAt: input.createdAt,
        error:
          error instanceof Error
            ? error.message
            : "Reference asset extraction failed.",
      }),
    ];
  }
}

function getReferenceAssetRegions(width: number, height: number) {
  const isWide = width >= height;
  return [
    {
      label: "Primary visual region",
      role: "hero",
      confidence: 0.88,
      componentHint: "Use as the editable hero or product media image.",
      bounds: isWide
        ? {
            x: width * 0.48,
            y: height * 0.12,
            width: width * 0.42,
            height: height * 0.52,
          }
        : {
            x: width * 0.12,
            y: height * 0.1,
            width: width * 0.76,
            height: height * 0.38,
          },
    },
    {
      label: "Hero composition",
      role: "reference",
      confidence: 0.82,
      componentHint: "Use as a full composition reference image.",
      bounds: {
        x: width * 0.08,
        y: height * 0.08,
        width: width * 0.84,
        height: height * 0.44,
      },
    },
    {
      label: "Detail component",
      role: "supporting",
      confidence: 0.76,
      componentHint: "Use as an editable supporting image component.",
      bounds: isWide
        ? {
            x: width * 0.12,
            y: height * 0.58,
            width: width * 0.36,
            height: height * 0.28,
          }
        : {
            x: width * 0.14,
            y: height * 0.56,
            width: width * 0.72,
            height: height * 0.3,
          },
    },
  ];
}

function clampRegion(
  bounds: ReferenceAsset["bounds"],
  imageWidth: number,
  imageHeight: number,
): ReferenceAsset["bounds"] {
  const x = Math.max(0, Math.min(imageWidth - 1, bounds.x));
  const y = Math.max(0, Math.min(imageHeight - 1, bounds.y));
  return {
    x,
    y,
    width: Math.max(1, Math.min(imageWidth - x, bounds.width)),
    height: Math.max(1, Math.min(imageHeight - y, bounds.height)),
  };
}

function createMetadataOnlyAsset(input: {
  sourceArtifactKey: string;
  prompt: string;
  createdAt: string;
  error: string;
}): ReferenceAsset {
  return {
    id: `asset-${randomUUID()}`,
    label: "Reference metadata",
    role: "reference",
    source: "metadata",
    kind: "metadata",
    sourceArtifactKey: input.sourceArtifactKey,
    artifactKey: null,
    metadataKey: null,
    prompt: input.prompt,
    confidence: 0,
    objectFit: "contain",
    componentHint: "Reference metadata only; no cropped image is available.",
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    imageSize: null,
    extractionStatus: "metadata-only",
    extractionError: input.error,
    createdAt: input.createdAt,
  };
}

function writeArtifact(key: string, value: unknown) {
  const fullPath = path.join(ARTIFACT_DIR, key);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return key;
}

function writeBinaryArtifact(key: string, value: Buffer) {
  const fullPath = path.join(ARTIFACT_DIR, key);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, value);
  return key;
}
