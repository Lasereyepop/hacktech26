import type {
  ComponentDraft,
  DesignDocument,
  EditContext,
  GazeAgentContext,
  ReferenceAsset,
  TasteProject,
} from "@/lib/types";

export type TasteAgentIntent = "create" | "build" | "edit";

export type TasteAgentSubagentName =
  | "image-director"
  | "design-builder"
  | "design-editor";

export type TasteAgentSubagent = {
  name: TasteAgentSubagentName;
  model: "gpt-5.5";
  reasoningEffort: "low";
};

export type TasteAgentSubagentRun = TasteAgentSubagent & {
  id: string;
  status: "succeeded" | "failed";
  startedAt: string;
  completedAt: string;
  summary: string;
  output:
    | {
        kind: "reference-image";
        artifactKey: string;
        metadataKey: string;
        model: string | "local-mock";
        referenceAssetCount: number;
        enrichmentStatus?: "pending" | "complete" | "failed";
      }
    | {
        kind: "component-draft";
        draftId: string;
        title: string;
        headline: string;
      }
    | {
        kind: "design-edit";
        draftId: string;
        title: string;
        headline: string;
      }
    | {
        kind: "error";
        message: string;
      };
  referenceAssets?: ReferenceAsset[];
};

export type TasteAgentRequest = {
  slug: string;
  intent: TasteAgentIntent;
  prompt: string;
  editContext?: EditContext;
  gazeContext?: GazeAgentContext;
  onEvent?: (event: TasteAgentRunEvent) => void | Promise<void>;
};

export type TasteAgentModelMode = "openai" | "local";

export type TasteAgentPlan = {
  summary: string;
  draftRequest: string;
  documentAction: "patch" | "append-node" | "none";
  pageArchitecture?: string;
  visualDirection?: string;
  qualityTarget?: string;
  // Optional artboard sizing intent. When the agent fills this in, the
  // runner uses it to resize the user's design frame so the generated
  // layout fits the canvas they actually see.
  artboard?: TasteAgentPlanArtboard;
};

export type TasteAgentPlanArtboard = {
  // One of "desktop", "desktop-hd", "macos", "ipad", "iphone-15", or null
  // for a custom size. Mirrors the artboard preset ids in the workspace.
  presetId?: string | null;
  width?: number;
  height?: number;
  // Hex color (e.g. "#f5f1e6") used as the artboard fill so the generated
  // design feels native to the chosen surface.
  fill?: string;
  fillOpacity?: number;
  cornerRadius?: number;
  elevation?: boolean;
  name?: string;
  reasoning?: string;
};

export type TasteAgentRunSummary = {
  id: string;
  intent: TasteAgentIntent;
  prompt: string;
  modelMode: TasteAgentModelMode;
  model: "gpt-5.5";
  reasoningEffort: "low";
  subagents: TasteAgentSubagent[];
  subagentRuns: TasteAgentSubagentRun[];
  summary: string;
  steps: string[];
  draftUpdated: boolean;
  designUpdated: boolean;
  targetedEdit?: {
    status: string;
    reason: string;
    targetNodeIds: string[];
    changedNodeIds: string[];
  };
  referenceImage?: {
    artifactKey: string;
    model: string | "local-mock";
    prompt: string;
    enrichmentStatus?: "pending" | "complete" | "failed";
    referenceAssetCount?: number;
  };
};

export type TasteAgentResult = {
  project: TasteProject;
  design: DesignDocument | null;
  draft: ComponentDraft | null;
  run: TasteAgentRunSummary;
};

export type TasteAgentRunEvent = {
  id: string;
  phase:
    | "queued"
    | "tool-call"
    | "planning"
    | "reasoning"
    | "thinking"
    | "subagent"
    | "building"
    | "persisting"
    | "complete"
    | "error";
  title: string;
  detail: string;
  status: "running" | "complete" | "error";
  createdAt: string;
};
