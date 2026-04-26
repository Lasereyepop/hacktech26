import { NextResponse } from "next/server";
import {
  runTasteLabAgent,
  type TasteAgentRunEvent,
  type TasteAgentIntent,
} from "@/lib/server/agent-runner";
import { getProject } from "@/lib/server/project-store";
import type { EditContext, GazeAgentContext } from "@/lib/types";

export const runtime = "nodejs";

const MAX_EDIT_CONTEXT_NODES = 64;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const project = getProject(slug);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    intent?: string;
    request?: string;
    source?: "dashboard-prompt" | "right-inspector";
    stream?: boolean;
    editContext?: EditContext;
    gazeContext?: GazeAgentContext;
  };
  const prompt = body.request?.trim() || project.brief;
  const editContext = normalizeEditContext(body.editContext);
  const gazeContext = normalizeGazeContext(body.gazeContext);
  const intent = editContext
    ? "edit"
    : resolveAgentIntent({
        requestedIntent: body.intent,
        prompt,
        hasDraft: Boolean(project.currentDraft),
        source: body.source,
      });
  if (body.stream) {
    return streamAgentRun({
      slug,
      intent,
      prompt,
      editContext,
      gazeContext,
    });
  }

  const result = await runTasteLabAgent({
    slug,
    intent,
    prompt,
    editContext,
    gazeContext,
  }).catch((error: unknown) => ({
    error: error instanceof Error ? error.message : "Agent run failed.",
  }));

  if (!result || "error" in result) {
    const errorMessage =
      result && "error" in result ? result.error : "Agent run failed.";

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }

  return NextResponse.json(result, { status: 201 });
}

function streamAgentRun(input: {
  slug: string;
  intent: TasteAgentIntent;
  prompt: string;
  editContext?: EditContext;
  gazeContext?: GazeAgentContext;
}) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const result = await runTasteLabAgent({
          ...input,
          onEvent: (event: TasteAgentRunEvent) =>
            send({ type: "event", event }),
        });

        send({ type: "result", result });
      } catch (error) {
        send({
          type: "error",
          error: error instanceof Error ? error.message : "Agent run failed.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 201,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeEditContext(value: unknown): EditContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const context = value as Partial<EditContext>;
  if (context.source !== "comment" && context.source !== "inspector") {
    return undefined;
  }
  if (typeof context.viewId !== "string" || !context.viewId.trim()) {
    return undefined;
  }

  const targetResolution = isTargetResolution(context.targetResolution)
    ? context.targetResolution
    : "unresolved";
  const targetConfidence = isTargetConfidence(context.targetConfidence)
    ? context.targetConfidence
    : getTargetConfidence(targetResolution);
  const nodes = Array.isArray(context.nodes)
    ? context.nodes
        .filter(
          (node) =>
            node &&
            typeof node.id === "string" &&
            typeof node.type === "string" &&
            node.bounds &&
            typeof node.bounds.x === "number" &&
            typeof node.bounds.y === "number" &&
            typeof node.bounds.width === "number" &&
            typeof node.bounds.height === "number",
        )
        .map((node) => ({
          ...node,
          ...(isTargetSource(node.targetSource)
            ? { targetSource: node.targetSource }
            : {}),
          ...(typeof node.canMutate === "boolean"
            ? { canMutate: node.canMutate }
            : {}),
          ...(typeof node.imageLocked === "boolean"
            ? { imageLocked: node.imageLocked }
            : {}),
        }))
        .slice(0, MAX_EDIT_CONTEXT_NODES)
    : [];

  return {
    source: context.source,
    viewId: context.viewId,
    commentBounds: isBounds(context.commentBounds)
      ? context.commentBounds
      : null,
    selectedNodeIds: normalizeIds(context.selectedNodeIds),
    directNodeIds: normalizeIds(context.directNodeIds),
    inferredNodeIds: normalizeIds(context.inferredNodeIds),
    targetNodeIds: normalizeIds(context.targetNodeIds),
    targetResolution,
    targetConfidence,
    imageEditIntent:
      typeof context.imageEditIntent === "boolean"
        ? context.imageEditIntent
        : undefined,
    nodes,
  };
}

function normalizeGazeContext(value: unknown): GazeAgentContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const context = value as Partial<GazeAgentContext>;
  const width = clampNumber(context.width, 1, 10000);
  const height = clampNumber(context.height, 1, 10000);
  const fps = clampNumber(context.fps, 1, 240);
  const nFrames = clampNumber(context.nFrames, 1, 10000);
  const generatedAt = clampNumber(
    context.generatedAt,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  if (!width || !height || !fps || !nFrames || !generatedAt) {
    return undefined;
  }

  const topFixations = Array.isArray(context.topFixations)
    ? context.topFixations
        .map(normalizeGazeFixation)
        .filter(
          (fixation): fixation is GazeAgentContext["topFixations"][number] =>
            Boolean(fixation),
        )
        .slice(0, 8)
    : [];
  const firstFixation = normalizeGazeFixation(context.firstFixation);
  const strongestFixation = normalizeGazeFixation(context.strongestFixation);
  const attentionNotes = Array.isArray(context.attentionNotes)
    ? context.attentionNotes
        .filter((note): note is string => typeof note === "string")
        .map((note) => note.trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const additionalInfo =
    typeof context.additionalInfo === "string"
      ? context.additionalInfo.trim().slice(0, 1200)
      : "";

  return {
    width,
    height,
    fps,
    nFrames,
    generatedAt,
    fixationCount:
      clampNumber(context.fixationCount, 0, 200) ?? topFixations.length,
    ...(additionalInfo ? { additionalInfo } : {}),
    firstFixation: firstFixation ?? null,
    strongestFixation: strongestFixation ?? null,
    topFixations,
    attentionNotes,
  };
}

function normalizeGazeFixation(
  value: unknown,
): GazeAgentContext["topFixations"][number] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const fixation = value as Partial<GazeAgentContext["topFixations"][number]>;
  const x = clampNumber(fixation.x, 0, 1);
  const y = clampNumber(fixation.y, 0, 1);
  const dwellMs = clampNumber(fixation.dwellMs, 0, 60000);
  const fixationIndex = clampNumber(fixation.fixationIndex, 0, 10000);
  const startFrame = clampNumber(fixation.startFrame, 0, 10000);
  const endFrame = clampNumber(fixation.endFrame, 0, 10000);

  if (
    x === undefined ||
    y === undefined ||
    dwellMs === undefined ||
    fixationIndex === undefined ||
    startFrame === undefined ||
    endFrame === undefined
  ) {
    return null;
  }

  return { x, y, dwellMs, fixationIndex, startFrame, endFrame };
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizeIds(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((id): id is string => typeof id === "string")
        .slice(0, MAX_EDIT_CONTEXT_NODES)
    : [];
}

export const __agentRunsRouteTestHooks = {
  MAX_EDIT_CONTEXT_NODES,
  normalizeEditContext,
};

function isBounds(value: unknown): value is EditContext["commentBounds"] {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { x?: unknown }).x === "number" &&
    typeof (value as { y?: unknown }).y === "number" &&
    typeof (value as { width?: unknown }).width === "number" &&
    typeof (value as { height?: unknown }).height === "number"
  );
}

function isTargetResolution(
  value: unknown,
): value is EditContext["targetResolution"] {
  return (
    value === "direct" ||
    value === "selected" ||
    value === "inferred" ||
    value === "unresolved"
  );
}

function isTargetConfidence(
  value: unknown,
): value is NonNullable<EditContext["targetConfidence"]> {
  return (
    value === "high" ||
    value === "medium" ||
    value === "low" ||
    value === "none"
  );
}

function isTargetSource(
  value: unknown,
): value is NonNullable<EditContext["nodes"][number]["targetSource"]> {
  return (
    value === "target" ||
    value === "direct" ||
    value === "selected" ||
    value === "inferred" ||
    value === "nearby"
  );
}

function getTargetConfidence(
  targetResolution: EditContext["targetResolution"],
): NonNullable<EditContext["targetConfidence"]> {
  if (targetResolution === "direct" || targetResolution === "selected") {
    return "high";
  }

  if (targetResolution === "inferred") {
    return "medium";
  }

  return "none";
}

function resolveAgentIntent(input: {
  requestedIntent?: string;
  prompt: string;
  hasDraft: boolean;
  source?: "dashboard-prompt" | "right-inspector";
}): TasteAgentIntent {
  if (isAgentIntent(input.requestedIntent)) {
    return input.requestedIntent;
  }

  if (input.source === "dashboard-prompt") {
    return "create";
  }

  if (!input.hasDraft) {
    return "build";
  }

  const normalizedPrompt = input.prompt.toLowerCase();
  if (
    /\b(create|generate|build|new|start over|from scratch)\b/.test(
      normalizedPrompt,
    )
  ) {
    return "build";
  }

  return "edit";
}

function isAgentIntent(value: unknown): value is TasteAgentIntent {
  return value === "create" || value === "build" || value === "edit";
}
