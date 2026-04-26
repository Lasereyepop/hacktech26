import { randomUUID } from "node:crypto";
import { componentBuilderAgent } from "@/lib/server/agents/component-builder";
import {
  getLatestDesignDocument,
  getProject,
  patchDesignDocument,
  setProjectDraft,
  updateProjectRun,
} from "@/lib/server/project-store";
import { applyDesignDocumentTool } from "@/lib/server/agent-tools/design-document-tools";
import {
  enrichReferenceImageArtifact,
  generateReferenceImageTool,
  type ReferenceImageArtifact,
} from "@/lib/server/agent-tools/image-tools";
import {
  inferArtboardSettings,
  normalizeArtboardFillOpacity,
  readArtboardSettingsFromDocument,
  type AgentArtboardSettings,
} from "@/lib/server/agent-tools/artboard-settings";
import {
  GAZE_GUIDED_IMPROVEMENT_DIRECTION,
  TASTE_LAB_TASTE_CONTRACT,
} from "@/lib/server/agent-runner/skill-prompts";
import type { DesignDocumentJson } from "@/lib/types";
import type {
  TasteAgentSubagentName,
  TasteAgentSubagent,
  TasteAgentSubagentRun,
  TasteAgentPlan,
  TasteAgentRequest,
  TasteAgentRunEvent,
  TasteAgentRunSummary,
  TasteAgentResult,
} from "@/lib/server/agent-runner/types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = "gpt-5.5";

export async function runTasteLabAgent(
  request: TasteAgentRequest,
): Promise<TasteAgentResult | null> {
  const project = getProject(request.slug);

  if (!project) {
    return null;
  }

  updateProjectRun(request.slug, "building", getRunMessage(request.intent));

  try {
    const runId = `agent-run-${randomUUID()}`;
    await emitAgentEvent(request, {
      phase: "queued",
      title: "Agent run accepted",
      detail: `Starting a ${request.intent} run for "${request.prompt}".`,
      status: "running",
    });
    await emitAgentEvent(request, {
      phase: "planning",
      title: "Loading design context",
      detail:
        "Reading the latest design document before planning the next move.",
      status: "running",
    });
    if (request.gazeContext) {
      await emitAgentEvent(request, {
        phase: "planning",
        title: "Gaze context attached",
        detail: `Using ${request.gazeContext.topFixations.length} ordered fixations from a ${request.gazeContext.width}x${request.gazeContext.height} artboard capture.`,
        status: "complete",
      });
    }
    const beforeDesign = getLatestDesignDocument(request.slug);
    const subagentRuns: TasteAgentSubagentRun[] = [];
    const isGazeGuidedRun = Boolean(request.gazeContext);
    const planPromise =
      request.intent === "edit"
        ? createAgentPlan(request, beforeDesign)
        : createFastCreationPlan(request);
    const referenceImagePromise =
      request.intent !== "edit" && !isGazeGuidedRun
        ? runTasteSubagent(request, "image-director", async () => {
            const artifact = await generateReferenceImageTool({
              slug: request.slug,
              prompt: request.prompt,
            });

            return {
              summary:
                artifact.model === "local-mock"
                  ? "Created a local reference placeholder for the design direction."
                  : `Generated a ${artifact.model} visual reference artifact.`,
              output: {
                kind: "reference-image" as const,
                artifactKey: artifact.artifactKey,
                metadataKey: artifact.metadataKey,
                model: artifact.model,
                referenceAssetCount: artifact.referenceAssets?.length ?? 0,
                enrichmentStatus: artifact.enrichmentStatus,
              },
              referenceAssets: artifact.referenceAssets,
              value: artifact,
            };
          }).then((result) => {
            subagentRuns.push(result.run);
            return result.value;
          })
        : Promise.resolve(null);

    const planningResults = await Promise.allSettled([
      planPromise,
      referenceImagePromise,
    ]);
    const rejectedPlanningResult = planningResults.find(
      (result) => result.status === "rejected",
    );

    if (rejectedPlanningResult?.status === "rejected") {
      throw rejectedPlanningResult.reason;
    }

    const [planResult, referenceImageResult] = planningResults;
    if (
      planResult.status !== "fulfilled" ||
      referenceImageResult.status !== "fulfilled"
    ) {
      throw new Error("Agent planning failed.");
    }
    const plan = planResult.value;
    const referenceImage = referenceImageResult.value;
    await emitAgentEvent(request, {
      phase: "thinking",
      title: "Planning result",
      detail: `${plan.summary} Draft request: ${plan.draftRequest}`,
      status: "complete",
    });
    const builderProject =
      request.intent === "edit" || isGazeGuidedRun
        ? project
        : getIsolatedProjectContext(project, request.prompt);
    const builderRequest = [
      request.intent === "edit" || isGazeGuidedRun
        ? null
        : [
            "Fresh creation context: the active user request below is the only product/domain source.",
            "Do not reuse prior project names, briefs, drafts, reference artifacts, or visual themes.",
          ].join(" "),
      plan.draftRequest,
      plan.pageArchitecture
        ? `Page architecture: ${plan.pageArchitecture}`
        : null,
      plan.visualDirection ? `Visual direction: ${plan.visualDirection}` : null,
      plan.qualityTarget ? `Quality target: ${plan.qualityTarget}` : null,
      request.editContext
        ? formatEditContextForPrompt(request.editContext)
        : null,
      request.gazeContext
        ? formatGazeContextForPrompt(request.gazeContext)
        : null,
      referenceImage
        ? `Reference image artifact: ${referenceImage.artifactKey}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
    const builderName =
      request.intent === "edit" ? "design-editor" : "design-builder";
    const builderResult = await runTasteSubagent(
      request,
      builderName,
      async () => {
        const draft = await componentBuilderAgent({
          project: builderProject,
          request:
            request.intent === "edit"
              ? [
                  "Act as a scoped design editor. Preserve the existing visual system unless the user explicitly asks for a rebuild.",
                  request.editContext
                    ? "Use targeted-canvas-edit rules. The edit context is authoritative, and the server will only mutate allowed target nodes. Prefer text/button nodes for text, spacing, nav, copy, or top-bar requests. Do not edit image/media nodes unless imageEditIntent is true and they are direct targets. Never insert screenshots or reference artifacts as website content for comment edits."
                    : null,
                  project.currentDraft
                    ? `Current draft headline: ${project.currentDraft.headline}`
                    : null,
                  request.gazeContext
                    ? [
                        GAZE_GUIDED_IMPROVEMENT_DIRECTION,
                        "Use the attached gaze context as the primary evidence for this broad improvement pass.",
                      ].join("\n")
                    : null,
                  builderRequest,
                ]
                  .filter(Boolean)
                  .join("\n")
              : builderRequest,
        });

        return {
          summary: `${draft.title}: ${draft.summary}`,
          output: {
            kind:
              request.intent === "edit"
                ? ("design-edit" as const)
                : ("component-draft" as const),
            draftId: draft.id,
            title: draft.title,
            headline: draft.headline,
          },
          value: draft,
        };
      },
    );
    subagentRuns.push(builderResult.run);
    const draftBase = builderResult.value;
    const draft = referenceImage
      ? {
          ...draftBase,
          referenceImage: {
            artifactKey: referenceImage.artifactKey,
            model: referenceImage.model,
            prompt: referenceImage.prompt,
            enrichmentStatus: referenceImage.enrichmentStatus,
            referenceAssetCount: referenceImage.referenceAssets?.length ?? 0,
          },
        }
      : draftBase;
    await emitAgentEvent(request, {
      phase: "building",
      title: "Draft built",
      detail: `${draft.title}: ${draft.summary}`,
      status: "complete",
    });
    await emitAgentEvent(request, {
      phase: "persisting",
      title: "Persisting draft",
      detail:
        "Saving the generated draft and creating the next design document version.",
      status: "running",
    });
    const designBase =
      request.intent === "edit"
        ? beforeDesign
        : (getLatestDesignDocument(request.slug) ?? beforeDesign);
    const updatedProject = setProjectDraft(request.slug, draft, {
      createDesignVersion: request.intent !== "edit",
    });
    const artboardSettings = resolveArtboardSettings({
      intent: request.intent,
      prompt: request.prompt,
      plan,
      draft,
      designBase,
    });

    if (artboardSettings && request.intent !== "edit") {
      await emitAgentEvent(request, {
        phase: "tool-call",
        title: "apply-artboard-settings",
        detail: formatArtboardEvent(artboardSettings, plan.artboard?.reasoning),
        status: "complete",
      });
    }

    await emitAgentEvent(request, {
      phase: "tool-call",
      title: "apply-design-document",
      detail: `Applying document action "${plan.documentAction}".`,
      status: "running",
    });
    const updatedDesign = applyDesignDocumentTool({
      slug: request.slug,
      intent: request.intent,
      prompt: request.prompt,
      plan,
      draft,
      referenceImage,
      subagentRuns,
      document: designBase,
      editContext: request.editContext,
      artboard: artboardSettings,
    });
    const targetedEdit = getTargetedEditRunMetadata(
      updatedDesign ?? designBase,
    );
    if (updatedDesign && referenceImage?.enrichmentStatus === "pending") {
      scheduleReferenceImageEnrichment({
        slug: request.slug,
        referenceImage,
      });
    }
    if (targetedEdit) {
      await emitAgentEvent(request, {
        phase: "tool-call",
        title: `targeted-edit-${targetedEdit.status}`,
        detail: `${targetedEdit.reason} Changed nodes: ${
          targetedEdit.changedNodeIds.length
            ? targetedEdit.changedNodeIds.join(", ")
            : "none"
        }.`,
        status: targetedEdit.status === "rejected" ? "error" : "complete",
      });
    }
    const finalProject =
      updateProjectRun(request.slug, "idle", plan.summary) ?? updatedProject;

    if (!finalProject) {
      return null;
    }

    await emitAgentEvent(request, {
      phase: "complete",
      title: "Agent run complete",
      detail: plan.summary,
      status: "complete",
    });

    return {
      project: finalProject,
      design: updatedDesign ?? designBase,
      draft,
      run: {
        id: runId,
        intent: request.intent,
        prompt: request.prompt,
        modelMode: process.env.OPENAI_API_KEY ? "openai" : "local",
        model: OPENAI_MODEL,
        reasoningEffort: "low",
        subagents: getSubagents(request.intent, Boolean(referenceImage)),
        subagentRuns,
        summary: plan.summary,
        steps: getRunSteps(request.intent, referenceImage?.model ?? null),
        draftUpdated: Boolean(updatedProject?.currentDraft),
        designUpdated: Boolean(
          updatedDesign && updatedDesign.id !== designBase?.id,
        ),
        targetedEdit,
        referenceImage: referenceImage
          ? {
              artifactKey: referenceImage.artifactKey,
              model: referenceImage.model,
              prompt: referenceImage.prompt,
              enrichmentStatus: referenceImage.enrichmentStatus,
              referenceAssetCount: referenceImage.referenceAssets?.length ?? 0,
            }
          : undefined,
      },
    };
  } catch (error) {
    await emitAgentEvent(request, {
      phase: "error",
      title: "Agent run failed",
      detail: error instanceof Error ? error.message : "Agent run failed",
      status: "error",
    });
    updateProjectRun(
      request.slug,
      "idle",
      error instanceof Error ? error.message : "Agent run failed",
    );
    throw error;
  }
}

function scheduleReferenceImageEnrichment(input: {
  slug: string;
  referenceImage: ReferenceImageArtifact;
}) {
  void enrichReferenceImageArtifact(input.referenceImage)
    .then((enrichedReferenceImage) => {
      const latestDesign = getLatestDesignDocument(input.slug);

      if (!latestDesign) {
        return;
      }

      const agentRunner = latestDesign.documentJson.styles.agentRunner;

      if (!agentRunner || typeof agentRunner !== "object") {
        return;
      }

      const currentReferenceImage = (
        agentRunner as { referenceImage?: unknown }
      ).referenceImage;

      if (
        !currentReferenceImage ||
        typeof currentReferenceImage !== "object" ||
        (currentReferenceImage as { artifactKey?: unknown }).artifactKey !==
          input.referenceImage.artifactKey
      ) {
        return;
      }

      patchDesignDocument(
        input.slug,
        latestDesign.version,
        patchReferenceImageEnrichmentMetadata(
          latestDesign.documentJson,
          enrichedReferenceImage,
        ),
      );
    })
    .catch((error: unknown) => {
      console.error(
        "Reference image enrichment failed",
        error instanceof Error ? error.message : error,
      );
    });
}

function patchReferenceImageEnrichmentMetadata(
  document: DesignDocumentJson,
  referenceImage: ReferenceImageArtifact,
): DesignDocumentJson {
  const previousAgentRunner =
    typeof document.styles.agentRunner === "object" &&
    document.styles.agentRunner
      ? document.styles.agentRunner
      : {};
  const previousReferenceImage =
    typeof (previousAgentRunner as { referenceImage?: unknown })
      .referenceImage === "object" &&
    (previousAgentRunner as { referenceImage?: unknown }).referenceImage
      ? ((previousAgentRunner as { referenceImage?: unknown })
          .referenceImage as Record<string, unknown>)
      : {};

  return {
    ...document,
    styles: {
      ...document.styles,
      agentRunner: {
        ...previousAgentRunner,
        referenceImage: {
          ...previousReferenceImage,
          ...referenceImage,
          role: "reference-guide",
          exportable: false,
          locked: true,
          enrichmentStatus: referenceImage.enrichmentStatus ?? "failed",
          referenceAssetCount: referenceImage.referenceAssets?.length ?? 0,
        },
        referenceAssets: referenceImage.referenceAssets ?? [],
        updatedAt: new Date().toISOString(),
      },
    },
    metadata: {
      ...document.metadata,
      generatedAt: new Date().toISOString(),
    },
  };
}

// Choose the final artboard settings the apply-design tool will write.
// Priority: plan.artboard fields (when valid) > previously saved artboard on
// the design doc (so manual user resizes survive) > heuristics from the
// prompt + draft. We never resize during scoped edits — the user just asked
// us to tweak nodes, not the canvas itself.
function resolveArtboardSettings(input: {
  intent: TasteAgentRequest["intent"];
  prompt: string;
  plan: TasteAgentPlan;
  draft: import("@/lib/types").ComponentDraft | null;
  designBase: ReturnType<typeof getLatestDesignDocument>;
}): AgentArtboardSettings | null {
  if (input.intent === "edit") {
    return input.designBase
      ? readArtboardSettingsFromDocument(input.designBase.documentJson)
      : null;
  }

  const existing = input.designBase
    ? readArtboardSettingsFromDocument(input.designBase.documentJson)
    : null;
  const inferred = inferArtboardSettings({
    prompt: input.prompt,
    draft: input.draft,
    existing,
  });

  const planArtboard = input.plan.artboard;
  if (!planArtboard) {
    return inferred;
  }

  return {
    name: planArtboard.name?.trim() || inferred.name,
    width:
      typeof planArtboard.width === "number" && planArtboard.width >= 64
        ? Math.round(planArtboard.width)
        : inferred.width,
    height:
      typeof planArtboard.height === "number" && planArtboard.height >= 64
        ? Math.round(planArtboard.height)
        : inferred.height,
    presetId:
      typeof planArtboard.presetId === "string" && planArtboard.presetId
        ? planArtboard.presetId
        : (inferred.presetId ?? null),
    fill:
      typeof planArtboard.fill === "string" &&
      /^#[0-9a-f]{3,8}$/i.test(planArtboard.fill)
        ? planArtboard.fill
        : inferred.fill,
    fillOpacity:
      typeof planArtboard.fillOpacity === "number"
        ? normalizeArtboardFillOpacity(planArtboard.fillOpacity)
        : inferred.fillOpacity,
    cornerRadius:
      typeof planArtboard.cornerRadius === "number"
        ? Math.max(0, Math.round(planArtboard.cornerRadius))
        : inferred.cornerRadius,
    elevation:
      typeof planArtboard.elevation === "boolean"
        ? planArtboard.elevation
        : inferred.elevation,
  };
}

function formatArtboardEvent(
  settings: AgentArtboardSettings,
  reasoning: string | undefined,
) {
  const detail = `Resized canvas to ${settings.width}\u00d7${settings.height}, fill ${settings.fill}.`;
  return reasoning ? `${detail} ${reasoning}` : detail;
}

function getIsolatedProjectContext(
  project: NonNullable<ReturnType<typeof getProject>>,
  prompt: string,
) {
  const activeBrief =
    cleanText(prompt) ||
    "Build a fresh Taste Lab design from the active prompt.";

  return {
    ...project,
    name: inferWorkingProjectName(activeBrief, project.name),
    brief: activeBrief,
    currentDraft: null,
  };
}

function getTargetedEditRunMetadata(
  design: ReturnType<typeof getLatestDesignDocument>,
): TasteAgentRunSummary["targetedEdit"] | undefined {
  const agentRunner = design?.documentJson.styles.agentRunner;
  if (!agentRunner || typeof agentRunner !== "object") {
    return undefined;
  }

  const targetedEdit = (agentRunner as { targetedEdit?: unknown }).targetedEdit;
  if (!targetedEdit || typeof targetedEdit !== "object") {
    return undefined;
  }

  const value = targetedEdit as {
    status?: unknown;
    reason?: unknown;
    targetNodeIds?: unknown;
    changedNodeIds?: unknown;
  };

  return {
    status: typeof value.status === "string" ? value.status : "unknown",
    reason: typeof value.reason === "string" ? value.reason : "",
    targetNodeIds: Array.isArray(value.targetNodeIds)
      ? value.targetNodeIds.filter((id): id is string => typeof id === "string")
      : [],
    changedNodeIds: Array.isArray(value.changedNodeIds)
      ? value.changedNodeIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
  };
}

function inferWorkingProjectName(prompt: string, fallback: string) {
  const quotedName = prompt.match(/["“]([^"”]{2,60})["”]/)?.[1];
  if (quotedName) {
    return quotedName.trim();
  }

  const cleaned = prompt
    .replace(/\b(?:please\s+)?(?:make|create|generate|build|design)\b/gi, " ")
    .replace(/\b(?:a|an|the)\b/gi, " ")
    .replace(
      /\b(?:website|site|landing\s+page|homepage|page|app|for|about|of)\b/gi,
      " ",
    )
    .replace(/[^a-z0-9&' -]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 4);

  if (!words.length) {
    return cleanText(fallback) || "Fresh Concept";
  }

  return words
    .map((word) =>
      word.length <= 2
        ? word.toUpperCase()
        : `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`,
    )
    .join(" ");
}

async function createAgentPlan(
  request: TasteAgentRequest,
  document: ReturnType<typeof getLatestDesignDocument>,
): Promise<TasteAgentPlan> {
  if (!process.env.OPENAI_API_KEY) {
    await emitAgentEvent(request, {
      phase: "thinking",
      title: "Local planning fallback",
      detail:
        "OPENAI_API_KEY is not set, so the runner is using the local planning path.",
      status: "complete",
    });
    return createLocalPlan(request);
  }

  await emitAgentEvent(request, {
    phase: "planning",
    title: "OpenAI Responses API",
    detail:
      "Asking GPT-5.5 for a compact plan, draft request, and design-document action.",
    status: "running",
  });

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: { effort: "low", summary: "auto" },
      stream: true,
      input: [
        {
          role: "system",
          content: [
            "You plan Taste Lab design-agent runs. Return only compact JSON.",
            TASTE_LAB_TASTE_CONTRACT,
            request.gazeContext ? GAZE_GUIDED_IMPROVEMENT_DIRECTION : "",
            "Choose a page architecture, visual direction, quality target, draft request, and document action.",
            "The draft request must be specific enough for a builder to create non-generic copy, media direction, typography, palette, and attention priority.",
            'You also control the user\'s artboard. Pick artboard.width/height (and an optional preset id like "website", "desktop-hd", "macos", "ipad", or "iphone-15") that fits the experience you are designing, plus a hex fill color so the surface feels native. Use desktop/website dimensions (1440x900) for landing pages and websites, iPhone (393x852) for mobile app screens, and macOS (1200x760) for desktop apps.',
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            intent: request.intent,
            prompt: request.prompt,
            editContext: request.editContext ?? null,
            gazeContext: request.gazeContext ?? null,
            hasDocument: Boolean(document),
            latestVersion: document?.version ?? null,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "taste_agent_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "summary",
              "draftRequest",
              "documentAction",
              "pageArchitecture",
              "visualDirection",
              "qualityTarget",
              "artboard",
            ],
            properties: {
              summary: { type: "string" },
              draftRequest: { type: "string" },
              documentAction: {
                type: "string",
                enum: ["patch", "append-node", "none"],
              },
              pageArchitecture: { type: "string" },
              visualDirection: { type: "string" },
              qualityTarget: { type: "string" },
              artboard: {
                type: "object",
                additionalProperties: false,
                // OpenAI structured outputs run in strict mode, so every
                // property must appear in `required`. Use nullable unions
                // for fields the model is allowed to leave unspecified.
                required: [
                  "presetId",
                  "width",
                  "height",
                  "fill",
                  "fillOpacity",
                  "cornerRadius",
                  "elevation",
                  "name",
                  "reasoning",
                ],
                properties: {
                  presetId: {
                    type: ["string", "null"],
                    description:
                      "Optional preset id: 'website', 'desktop-hd', 'macos', 'ipad', 'iphone-15'.",
                  },
                  width: { type: "number" },
                  height: { type: "number" },
                  fill: {
                    type: "string",
                    description:
                      "Hex color for the artboard fill, e.g. '#ffffff' or '#f5f1e6'.",
                  },
                  fillOpacity: {
                    type: ["number", "null"],
                    description:
                      "Artboard fill opacity as a percent from 0 to 100. Use 100 for fully opaque.",
                  },
                  cornerRadius: { type: ["number", "null"] },
                  elevation: { type: ["boolean", "null"] },
                  name: { type: ["string", "null"] },
                  reasoning: { type: ["string", "null"] },
                },
              },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(await formatOpenAIError(response, "OpenAI agent plan"));
  }

  const planResponse = await readOpenAIPlanStream(response, request);
  const plan = normalizePlan(planResponse, request);
  await emitAgentEvent(request, {
    phase: "planning",
    title: "OpenAI plan received",
    detail: `${plan.summary} Document action: ${plan.documentAction}.`,
    status: "complete",
  });

  return plan;
}

async function createFastCreationPlan(
  request: TasteAgentRequest,
): Promise<TasteAgentPlan> {
  await emitAgentEvent(request, {
    phase: "planning",
    title: "Fast creation plan",
    detail:
      "Using the builder-owned planning path so the create run does not wait on a separate GPT planner.",
    status: "complete",
  });

  return createLocalPlan(request);
}

async function formatOpenAIError(response: Response, label: string) {
  const fallback = `${label} failed with ${response.status}`;

  try {
    const body = (await response.json()) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const message =
      typeof body.error?.message === "string"
        ? body.error.message
        : typeof body.message === "string"
          ? body.message
          : "";

    return message ? `${fallback}: ${message}` : fallback;
  } catch {
    return fallback;
  }
}

async function runTasteSubagent<T>(
  request: TasteAgentRequest,
  name: TasteAgentSubagentName,
  run: () => Promise<{
    summary: string;
    output: TasteAgentSubagentRun["output"];
    referenceAssets?: TasteAgentSubagentRun["referenceAssets"];
    value: T;
  }>,
): Promise<{ run: TasteAgentSubagentRun; value: T }> {
  const startedAt = new Date().toISOString();
  await emitAgentEvent(request, {
    phase: "subagent",
    title: `${name} started`,
    detail: getSubagentStartDetail(name),
    status: "running",
  });

  try {
    const result = await run();
    const completedAt = new Date().toISOString();
    await emitAgentEvent(request, {
      phase: "subagent",
      title: `${name} complete`,
      detail: result.summary,
      status: "complete",
    });

    return {
      value: result.value,
      run: {
        ...getSubagentConfig(name),
        id: `subagent-run-${randomUUID()}`,
        status: "succeeded",
        startedAt,
        completedAt,
        summary: result.summary,
        output: result.output,
        referenceAssets: result.referenceAssets,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `${name} subagent failed.`;
    const completedAt = new Date().toISOString();
    await emitAgentEvent(request, {
      phase: "subagent",
      title: `${name} failed`,
      detail: message,
      status: "error",
    });

    throw Object.assign(error instanceof Error ? error : new Error(message), {
      subagentRun: {
        ...getSubagentConfig(name),
        id: `subagent-run-${randomUUID()}`,
        status: "failed" as const,
        startedAt,
        completedAt,
        summary: message,
        output: {
          kind: "error" as const,
          message,
        },
      } satisfies TasteAgentSubagentRun,
    });
  }
}

async function emitAgentEvent(
  request: TasteAgentRequest,
  event: Omit<TasteAgentRunEvent, "id" | "createdAt"> & { id?: string },
) {
  if (!request.onEvent) {
    return;
  }

  await request.onEvent({
    ...event,
    id: event.id ?? `agent-event-${randomUUID()}`,
    createdAt: new Date().toISOString(),
  });
}

async function readOpenAIPlanStream(
  response: Response,
  request: TasteAgentRequest,
) {
  if (!response.body) {
    return response.json();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputText = "";
  let reasoningSummary = "";
  let completedResponse: unknown = null;
  let lastReasoningEmit = 0;
  let lastTextEmit = 0;

  const emitReasoning = async (status: TasteAgentRunEvent["status"]) => {
    const now = Date.now();
    if (status === "running" && now - lastReasoningEmit < 250) {
      return;
    }
    lastReasoningEmit = now;

    await emitAgentEvent(request, {
      id: "agent-reasoning-summary",
      phase: "reasoning",
      title: "Reasoning summary",
      detail:
        cleanText(reasoningSummary) ||
        "Waiting for the model to publish its planning summary.",
      status,
    });
  };

  const emitOutput = async () => {
    const now = Date.now();
    if (now - lastTextEmit < 350) {
      return;
    }
    lastTextEmit = now;

    await emitAgentEvent(request, {
      id: "agent-planning-output",
      phase: "planning",
      title: "Structured plan stream",
      detail: outputText.trim()
        ? truncateAgentDetail(outputText.trim())
        : "Receiving structured planning output.",
      status: "running",
    });
  };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const event = parseOpenAIStreamBlock(block);

      if (!event) {
        continue;
      }

      if (event.type === "response.reasoning_summary_text.delta") {
        reasoningSummary += typeof event.delta === "string" ? event.delta : "";
        await emitReasoning("running");
      }

      if (event.type === "response.reasoning_summary_text.done") {
        reasoningSummary =
          typeof event.text === "string" ? event.text : reasoningSummary;
        await emitReasoning("complete");
      }

      if (event.type === "response.output_text.delta") {
        outputText += typeof event.delta === "string" ? event.delta : "";
        await emitOutput();
      }

      if (event.type === "response.output_text.done") {
        outputText = typeof event.text === "string" ? event.text : outputText;
      }

      if (event.type === "response.completed") {
        completedResponse = event.response ?? null;
      }
    }
  }

  const trailingEvent = parseOpenAIStreamBlock(buffer);

  if (trailingEvent?.type === "response.completed") {
    completedResponse = trailingEvent.response ?? null;
  }

  if (reasoningSummary) {
    await emitReasoning("complete");
  }

  return outputText ? { output_text: outputText } : completedResponse;
}

function parseOpenAIStreamBlock(block: string) {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n")
    .trim();

  if (!data || data === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(data) as {
      type?: string;
      delta?: unknown;
      text?: unknown;
      response?: unknown;
    };
  } catch {
    return null;
  }
}

function truncateAgentDetail(value: string) {
  return value.length > 420 ? `${value.slice(0, 417).trimEnd()}...` : value;
}

function normalizePlan(
  body: unknown,
  request: TasteAgentRequest,
): TasteAgentPlan {
  const rawText = getResponseText(body);

  if (!rawText) {
    return createLocalPlan(request);
  }

  try {
    const parsed = JSON.parse(rawText) as Partial<TasteAgentPlan>;
    const fallback = createLocalPlan(request);
    return {
      summary: cleanText(parsed.summary) || fallback.summary,
      draftRequest: cleanText(parsed.draftRequest) || fallback.draftRequest,
      documentAction: isDocumentAction(parsed.documentAction)
        ? parsed.documentAction
        : fallback.documentAction,
      pageArchitecture:
        cleanText(parsed.pageArchitecture) || fallback.pageArchitecture,
      visualDirection:
        cleanText(parsed.visualDirection) || fallback.visualDirection,
      qualityTarget: cleanText(parsed.qualityTarget) || fallback.qualityTarget,
      artboard: normalizePlanArtboard(parsed.artboard) ?? fallback.artboard,
    };
  } catch {
    return createLocalPlan(request);
  }
}

function normalizePlanArtboard(
  value: unknown,
): TasteAgentPlan["artboard"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<NonNullable<TasteAgentPlan["artboard"]>>;
  const width =
    typeof candidate.width === "number" ? candidate.width : undefined;
  const height =
    typeof candidate.height === "number" ? candidate.height : undefined;

  if (!width || !height || width < 64 || height < 64) {
    return undefined;
  }

  return {
    presetId:
      typeof candidate.presetId === "string" ? candidate.presetId : null,
    width: Math.round(width),
    height: Math.round(height),
    fill: typeof candidate.fill === "string" ? candidate.fill : undefined,
    fillOpacity:
      typeof candidate.fillOpacity === "number"
        ? candidate.fillOpacity
        : undefined,
    cornerRadius:
      typeof candidate.cornerRadius === "number"
        ? candidate.cornerRadius
        : undefined,
    elevation:
      typeof candidate.elevation === "boolean"
        ? candidate.elevation
        : undefined,
    name: typeof candidate.name === "string" ? candidate.name : undefined,
    reasoning:
      typeof candidate.reasoning === "string" ? candidate.reasoning : undefined,
  };
}

function getResponseText(body: unknown) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const outputText = (body as { output_text?: unknown }).output_text;
  if (typeof outputText === "string") {
    return outputText;
  }

  const output = (body as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return null;
  }

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
  }

  return null;
}

function createLocalPlan(request: TasteAgentRequest): TasteAgentPlan {
  const prompt =
    cleanText(request.prompt) || "Build the strongest Taste Lab demo.";
  const artboard = inferLocalPlanArtboard(prompt);

  if (request.intent === "create") {
    return {
      summary: "Created a fresh local draft from the top-level prompt.",
      draftRequest: [
        prompt,
        "Use a premium image-led first viewport, concrete product copy, a clear CTA, proof details, and editable canvas sections.",
      ].join(" "),
      documentAction: "patch",
      pageArchitecture: "Image-first hero with proof and feature rhythm",
      visualDirection:
        "Specific product-led composition with controlled palette, structural media, and generous spacing.",
      qualityTarget:
        "Non-generic, attention-clear, implementation-ready frontend reference.",
      artboard,
    };
  }

  if (request.intent === "edit") {
    return {
      summary: "Applied the edit request to the current local design state.",
      draftRequest: [
        `Edit the current design while preserving its visual system: ${prompt}`,
        request.editContext
          ? formatEditContextForPrompt(request.editContext)
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
      documentAction: "append-node",
      pageArchitecture: "Preserve current architecture",
      visualDirection:
        "Keep palette, type, and media direction coherent while applying the requested edit.",
      qualityTarget: "Scoped edit with no unrelated node churn.",
    };
  }

  return {
    summary: request.gazeContext
      ? "Built a gaze-guided improvement draft for the current project."
      : "Built the next local draft for the current project.",
    draftRequest: [
      `Build the current project with a specific, premium frontend direction: ${prompt}`,
      request.gazeContext ? GAZE_GUIDED_IMPROVEMENT_DIRECTION : null,
      request.gazeContext
        ? formatGazeContextForPrompt(request.gazeContext)
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
    documentAction: "patch",
    pageArchitecture: "Structured landing-page composition",
    visualDirection:
      "Readable hierarchy, product-specific content, and one coherent component system.",
    qualityTarget: "Premium, editable, and attention-aware.",
    artboard,
  };
}

function inferLocalPlanArtboard(prompt: string): TasteAgentPlan["artboard"] {
  if (
    /\b(iphone|phone|mobile|android(\s+phone)?|ios(\s+app)?|app\s+screen|portrait\s+screen)\b/i.test(
      prompt,
    )
  ) {
    return {
      presetId: "iphone-15",
      width: 393,
      height: 852,
      cornerRadius: 36,
      reasoning: "Mobile cues in prompt; using iPhone 15 dimensions.",
    };
  }
  if (/\b(ipad|tablet|kindle)\b/i.test(prompt)) {
    return {
      presetId: "ipad",
      width: 1024,
      height: 1366,
      cornerRadius: 28,
      reasoning: "Tablet cues in prompt; using iPad dimensions.",
    };
  }
  if (/\b(macos|mac\s+app|desktop\s+app|window|sidebar)\b/i.test(prompt)) {
    return {
      presetId: "macos",
      width: 1200,
      height: 760,
      cornerRadius: 18,
      reasoning: "Desktop-app cues in prompt; using macOS window dimensions.",
    };
  }
  if (/\b(1080p|hd|full\s*hd|cinema|widescreen|kiosk)\b/i.test(prompt)) {
    return {
      presetId: "desktop-hd",
      width: 1920,
      height: 1080,
      cornerRadius: 18,
      reasoning: "HD cues in prompt; using full HD desktop dimensions.",
    };
  }
  return {
    presetId: "website",
    width: 1440,
    height: 900,
    cornerRadius: 18,
    reasoning: "No device cues; defaulting to a website-sized desktop frame.",
  };
}

function formatEditContextForPrompt(
  editContext: NonNullable<TasteAgentRequest["editContext"]>,
) {
  return [
    "Scoped edit context:",
    JSON.stringify({
      source: editContext.source,
      viewId: editContext.viewId,
      targetResolution: editContext.targetResolution,
      targetConfidence: editContext.targetConfidence ?? null,
      imageEditIntent: editContext.imageEditIntent ?? null,
      commentBounds: editContext.commentBounds ?? null,
      selectedNodeIds: editContext.selectedNodeIds,
      directNodeIds: editContext.directNodeIds,
      inferredNodeIds: editContext.inferredNodeIds,
      targetNodeIds: editContext.targetNodeIds,
      nodes: editContext.nodes,
      rules: [
        "Use the targeted-canvas-edit skill rules for scoped edit behavior.",
        "Treat targetNodeIds as the edit boundary when present.",
        "The server enforces targetNodeIds as a hard mutation boundary.",
        "If targetResolution is unresolved, infer from nearby context conservatively.",
        "Prefer text/button nodes for text, spacing, nav, copy, or top-bar requests.",
        "Do not edit image/media nodes unless imageEditIntent is true and the image is a direct target.",
        "Never clear, replace, or drop an image node's artifactKey during a scoped edit.",
        "Do not add screenshots, reference images, or artifact labels as website content.",
      ],
    }),
  ].join("\n");
}

function formatGazeContextForPrompt(
  gazeContext: NonNullable<TasteAgentRequest["gazeContext"]>,
) {
  return [
    GAZE_GUIDED_IMPROVEMENT_DIRECTION,
    "Gaze prediction context:",
    JSON.stringify({
      width: gazeContext.width,
      height: gazeContext.height,
      fps: gazeContext.fps,
      nFrames: gazeContext.nFrames,
      fixationCount: gazeContext.fixationCount,
      additionalInfo: gazeContext.additionalInfo ?? null,
      firstFixation: gazeContext.firstFixation ?? null,
      strongestFixation: gazeContext.strongestFixation ?? null,
      topFixations: gazeContext.topFixations,
      attentionNotes: gazeContext.attentionNotes,
      rules: [
        "Coordinates are normalized from 0 to 1 against the captured artboard.",
        "Use fixation order to identify the initial read path.",
        "Use dwell time to identify over-attended or confusing regions.",
        "Use additionalInfo as user intent for what the gaze agent should analyze or prioritize.",
        "Propose concrete changes in the draft summary, layout notes, and suggested implementation, then make those changes in the generated design document.",
        "Do not render gaze markers, coordinates, heatmap labels, or analysis metadata as visible design content.",
      ],
    }),
  ].join("\n");
}

function getRunMessage(intent: TasteAgentRequest["intent"]) {
  if (intent === "create") {
    return "Creating with GPT-5.5 agents";
  }

  if (intent === "edit") {
    return "Editing with GPT-5.5 agents";
  }

  return "Building with GPT-5.5 agents";
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isDocumentAction(
  value: unknown,
): value is TasteAgentPlan["documentAction"] {
  return value === "patch" || value === "append-node" || value === "none";
}

function getSubagents(
  intent: TasteAgentRequest["intent"],
  includeReferenceImage: boolean,
): TasteAgentSubagent[] {
  const designBuilder = getSubagentConfig("design-builder");

  if ((intent === "create" || intent === "build") && includeReferenceImage) {
    return [getSubagentConfig("image-director"), designBuilder];
  }

  if (intent === "build") {
    return [designBuilder];
  }

  if (intent === "edit") {
    return [getSubagentConfig("design-editor")];
  }

  return [designBuilder];
}

function getSubagentConfig(name: TasteAgentSubagentName): TasteAgentSubagent {
  return {
    name,
    model: OPENAI_MODEL,
    reasoningEffort: "low",
  };
}

function getSubagentStartDetail(name: TasteAgentSubagentName) {
  if (name === "image-director") {
    return "Generating the reference artifact and extractable visual assets.";
  }

  if (name === "design-editor") {
    return "Applying the request as a scoped edit against the current design world.";
  }

  return "Building the component draft from the plan and visual direction.";
}

function getRunSteps(
  intent: TasteAgentRequest["intent"],
  referenceImageModel: string | "local-mock" | null,
) {
  return [
    ...(referenceImageModel && referenceImageModel !== "local-mock"
      ? [`Generated ${referenceImageModel} reference artifact`]
      : referenceImageModel === "local-mock"
        ? [
            "Created local mock reference artifact because OPENAI_API_KEY is not set",
          ]
        : []),
    intent === "edit"
      ? "Classified request as design edit"
      : "Classified request as design build",
    "Orchestrated role-specific design subagents",
    "Applied Taste Lab skill contract to each subagent output and persistence",
    "Built component draft",
    "Persisted design document update",
  ];
}
