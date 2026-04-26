export type AttentionRegion = {
  id: string;
  label: string;
  rationale: string;
  intensity: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GazeAgentFixation = {
  x: number;
  y: number;
  dwellMs: number;
  fixationIndex: number;
  startFrame: number;
  endFrame: number;
};

export type GazeAgentContext = {
  width: number;
  height: number;
  fps: number;
  nFrames: number;
  generatedAt: number;
  fixationCount: number;
  additionalInfo?: string;
  firstFixation?: GazeAgentFixation | null;
  strongestFixation?: GazeAgentFixation | null;
  topFixations: GazeAgentFixation[];
  attentionNotes: string[];
};

export type ReferenceAsset = {
  id: string;
  label: string;
  role: "hero" | "product" | "supporting" | "texture" | "reference" | string;
  source:
    | "reference-crop"
    | "reference-full"
    | "generated"
    | "fallback"
    | "metadata";
  kind?: "image-region" | "metadata";
  sourceArtifactKey?: string;
  artifactKey?: string | null;
  metadataKey?: string | null;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  prompt?: string;
  confidence: number;
  objectFit: "cover" | "contain" | "fill";
  componentHint: string;
  imageSize?: {
    width: number;
    height: number;
  } | null;
  extractionStatus: "extracted" | "metadata-only" | "failed";
  extractionError?: string | null;
  createdAt: string;
};

export type TextFitAudit = {
  nodeId: string;
  fits: boolean;
  requiredHeight: number;
  actualHeight: number;
  overflowRatio: number;
  recommendedBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type TypographyRole = {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
  letterSpacing: number;
};

export type TypographySystem = {
  systemId: string;
  displayFont: string;
  bodyFont: string;
  labelFont: string;
  roles: {
    brand: TypographyRole;
    nav: TypographyRole;
    hero: TypographyRole;
    body: TypographyRole;
    label: TypographyRole;
    cardTitle: TypographyRole;
    cardBody: TypographyRole;
    metric: TypographyRole;
    cta: TypographyRole;
  };
};

export type ComponentDraft = {
  id: string;
  title: string;
  summary: string;
  headline: string;
  subheadline: string;
  primaryAction: string;
  secondaryAction: string;
  eyebrow?: string;
  navigation?: string[];
  visualDirection?: string;
  compositionSystem?: string;
  imageDirection?: string;
  typographyDirection?: string;
  typographySystem?: TypographySystem;
  attentionGoal?: string;
  qualityChecklist?: string[];
  featureCards?: Array<{
    title: string;
    detail: string;
  }>;
  metrics?: Array<{
    value: string;
    label: string;
  }>;
  referenceImage?: {
    artifactKey: string;
    model: string | "local-mock";
    prompt: string;
    enrichmentStatus?: "pending" | "complete" | "failed";
    referenceAssetCount?: number;
  };
  referenceAssets?: ReferenceAsset[];
  textFitAudits?: TextFitAudit[];
  layoutNotes: string[];
  suggestedImplementation: string;
  palette: {
    background: string;
    surface: string;
    accent: string;
    ink: string;
  };
  createdAt: string;
};

export type TasteEvaluation = {
  id: string;
  score: number;
  summary: string;
  criteriaScores: Array<{
    label: string;
    score: number;
  }>;
  notes: Array<{
    title: string;
    detail: string;
    priority: string;
  }>;
  attentionRegions: AttentionRegion[];
  suggestedEdits: string[];
  modelMode: "http" | "mock";
  createdAt: string;
};

export type DesignView = {
  id: string;
  name: string;
  width: number;
  height: number;
  nodeIds: string[];
};

export type TextStyleRun = {
  start: number;
  end: number;
  fontWeight?: string;
  fontStyle?: string;
};

export type DesignDocumentJson = {
  pages: Array<{
    id: string;
    name: string;
    viewIds: string[];
  }>;
  views: DesignView[];
  nodes: Array<{
    id: string;
    type: string;
    viewId: string;
    name: string;
    props: Record<string, unknown>;
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>;
  styles: Record<string, unknown>;
  metadata: {
    projectName: string;
    projectType: string;
    generatedAt: string;
  };
};

export type DesignNode = DesignDocumentJson["nodes"][number];

export type EditContextTargetResolution =
  | "direct"
  | "selected"
  | "inferred"
  | "unresolved";

export type EditContextBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type EditContextNodeSummary = {
  id: string;
  type: string;
  name: string;
  bounds: EditContextBounds;
  text?: string;
  textStyleRuns?: TextStyleRun[];
  artifactKey?: string;
  role?: string;
  targetSource?: "target" | "direct" | "selected" | "inferred" | "nearby";
  canMutate?: boolean;
  imageLocked?: boolean;
};

export type EditContext = {
  source: "comment" | "inspector";
  viewId: string;
  commentBounds?: EditContextBounds | null;
  selectedNodeIds: string[];
  directNodeIds: string[];
  inferredNodeIds: string[];
  targetNodeIds: string[];
  targetResolution: EditContextTargetResolution;
  targetConfidence?: "high" | "medium" | "low" | "none";
  imageEditIntent?: boolean;
  nodes: EditContextNodeSummary[];
};

export type DesignDocument = {
  id: string;
  projectId: string;
  version: number;
  sourceType: "internal" | "fig-import" | "fig-like";
  schemaVersion: number;
  documentJson: DesignDocumentJson;
  sourceArtifactKey?: string | null;
  createdAt: string;
};

export type DesignComment = {
  id: string;
  projectId: string;
  documentVersionId: string;
  viewId: string;
  nodeId?: string | null;
  x: number;
  y: number;
  body: string;
  authorId: string;
  status: "open" | "resolved";
  createdAt: string;
};

export type RenderArtifact = {
  id: string;
  projectId: string;
  documentVersionId: string;
  viewId: string;
  width: number;
  height: number;
  deviceScale: number;
  theme: string;
  imageKey: string;
  createdAt: string;
};

export type ModelJob = {
  id: string;
  projectId: string;
  renderArtifactId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HeatmapResult = {
  id: string;
  modelJobId: string;
  renderArtifactId: string;
  heatmapImageKey?: string | null;
  regions?: AttentionRegion[] | null;
  metrics?: Record<string, unknown> | null;
  modelVersion: string;
  createdAt: string;
  stale?: boolean;
};

export type ProjectRunStatus = {
  action: "idle" | "building" | "evaluating";
  message: string;
  updatedAt: string;
};

export type TasteProject = {
  id: string;
  slug: string;
  name: string;
  type: string;
  brief: string;
  score: number;
  status: string;
  updated: string;
  currentDraft: ComponentDraft | null;
  latestEvaluation: TasteEvaluation | null;
  runStatus: ProjectRunStatus;
};

// User-uploaded asset (image) attached to a project. The artifactKey is a
// path under the workspace .local-data/artifacts/ directory, served by the
// /api/collect/file route. The asset metadata is persisted in a per-project
// JSON index so it survives page reloads and process restarts.
export type ProjectAsset = {
  id: string;
  projectSlug: string;
  name: string;
  artifactKey: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  addedAt: string;
};
