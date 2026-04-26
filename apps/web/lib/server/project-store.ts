import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  appendNodeToDocument,
  removeNodesFromDocument,
  updateNodeInDocument,
} from "@/lib/design-document";
import type {
  AttentionRegion,
  ComponentDraft,
  DesignComment,
  DesignDocument,
  DesignDocumentJson,
  DesignNode,
  HeatmapResult,
  ModelJob,
  RenderArtifact,
  TasteEvaluation,
  TasteProject,
} from "@/lib/types";

type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  type: string;
  brief: string;
  score: number;
  status: string;
  updated_label: string;
  current_draft_json: string | null;
  latest_evaluation_json: string | null;
  run_status_json: string;
};

type DesignDocumentRow = {
  id: string;
  project_id: string;
  version: number;
  source_type: DesignDocument["sourceType"];
  schema_version: number;
  document_json: string;
  source_artifact_key: string | null;
  created_at: string;
};

type CommentRow = {
  id: string;
  project_id: string;
  document_version_id: string;
  view_id: string;
  node_id: string | null;
  x: number;
  y: number;
  body: string;
  author_id: string;
  status: DesignComment["status"];
  created_at: string;
};

type RenderArtifactRow = {
  id: string;
  project_id: string;
  document_version_id: string;
  view_id: string;
  width: number;
  height: number;
  device_scale: number;
  theme: string;
  image_key: string;
  created_at: string;
};

type ModelJobRow = {
  id: string;
  project_id: string;
  render_artifact_id: string;
  status: ModelJob["status"];
  error: string | null;
  created_at: string;
  updated_at: string;
};

type HeatmapResultRow = {
  id: string;
  model_job_id: string;
  render_artifact_id: string;
  heatmap_image_key: string | null;
  regions_json: string | null;
  metrics_json: string | null;
  model_version: string;
  created_at: string;
};

type RunStatus = TasteProject["runStatus"];

const DATA_DIR = path.resolve(
  process.cwd(),
  process.env.DATA_DIR ?? ".local-data",
);
const DB_PATH = path.join(DATA_DIR, "taste-lab.sqlite");
const ARTIFACT_DIR = path.join(DATA_DIR, "artifacts");

let database: Database.Database | null = null;

export function listProjects() {
  const rows = db()
    .prepare("SELECT * FROM projects ORDER BY created_at DESC")
    .all() as ProjectRow[];

  return rows.map(projectFromRow);
}

export function getProject(slug: string) {
  const row = db()
    .prepare("SELECT * FROM projects WHERE slug = ?")
    .get(slug) as ProjectRow | undefined;

  return row ? projectFromRow(row) : null;
}

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const PROJECT_SLUG_MODEL =
  process.env.OPENAI_PROJECT_SLUG_MODEL ?? "gpt-5-nano";

export async function createProject(input: {
  name: string;
  type?: string;
  brief?: string;
  agentic?: boolean;
}) {
  const store = db();
  const now = new Date().toISOString();
  const name = input.name.trim() || "Untitled project";
  const type = input.type?.trim() || "Web app";
  const brief =
    input.brief?.trim() || `Create a clear ${type} concept for ${name}.`;
  const slugBase = await generateProjectSlugBase({ name, type, brief });
  const slug = getUniqueSlug(slugBase || name);
  const id = `project-${randomUUID()}`;
  const runStatus: RunStatus = {
    action: input.agentic ? "building" : "idle",
    message: input.agentic ? "Preparing agent workspace" : "Ready",
    updatedAt: now,
  };

  store
    .prepare(
      `INSERT INTO projects (
        id, slug, name, type, brief, score, status, updated_label,
        current_draft_json, latest_evaluation_json, run_status_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      slug,
      name,
      type,
      brief,
      72,
      "Ready to build",
      "Just now",
      null,
      null,
      JSON.stringify(runStatus),
      now,
      now,
    );

  createDesignVersion({
    projectId: id,
    projectName: name,
    projectType: type,
    brief,
    draft: null,
  });

  return getProject(slug);
}

async function generateProjectSlugBase(input: {
  name: string;
  type: string;
  brief: string;
}) {
  const fallback = getLocalProjectSlugBase(input);

  if (!process.env.OPENAI_API_KEY) {
    return fallback;
  }

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: PROJECT_SLUG_MODEL,
        reasoning: { effort: "minimal" },
        max_output_tokens: 80,
        input: [
          {
            role: "system",
            content: [
              "Generate a short URL slug for a design project.",
              "Return only JSON.",
              "The slug must be lowercase, use only a-z, 0-9, and dashes, and contain two or three words separated by dashes.",
              "Prefer concrete product nouns over generic words like app, project, website, platform, dashboard, tool, or experience.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify(input),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "project_slug",
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["slug"],
              properties: {
                slug: {
                  type: "string",
                  description:
                    "Lowercase project slug, max three dash-separated words.",
                },
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      return fallback;
    }

    const rawText = getResponseText(await response.json());
    const parsed = rawText ? (JSON.parse(rawText) as { slug?: unknown }) : null;
    const normalized = normalizeProjectSlugBase(
      typeof parsed?.slug === "string" ? `${parsed.slug} ${fallback}` : "",
    );

    return normalized || fallback;
  } catch {
    return fallback;
  }
}

export function setProjectDraft(
  slug: string,
  draft: ComponentDraft,
  options: { createDesignVersion?: boolean } = {},
) {
  const project = getProject(slug);

  if (!project) {
    return null;
  }

  if (options.createDesignVersion !== false) {
    createDesignVersion({
      projectId: project.id,
      projectName: project.name,
      projectType: project.type,
      brief: project.brief,
      draft,
    });
  }

  return updateProject(slug, {
    currentDraft: draft,
    latestEvaluation: null,
    score: 76,
    status: "Draft built",
    updated: "Just now",
    runStatus: {
      action: "idle",
      message: "Draft ready for evaluation",
      updatedAt: new Date().toISOString(),
    },
  });
}

export function setProjectEvaluation(
  slug: string,
  evaluation: TasteEvaluation,
) {
  return updateProject(slug, {
    latestEvaluation: evaluation,
    score: evaluation.score,
    status: "Evaluated",
    updated: "Just now",
    runStatus: {
      action: "idle",
      message: "Evaluation complete",
      updatedAt: new Date().toISOString(),
    },
  });
}

export function updateProjectRun(
  slug: string,
  action: TasteProject["runStatus"]["action"],
  message: string,
) {
  return updateProject(slug, {
    runStatus: {
      action,
      message,
      updatedAt: new Date().toISOString(),
    },
  });
}

export function getLatestDesignDocument(slug: string) {
  const project = getProject(slug);

  if (!project) {
    return null;
  }

  return getLatestDesignDocumentForProject(project.id);
}

export function patchDesignDocument(
  slug: string,
  version: number,
  documentJson: DesignDocumentJson,
) {
  const current = getPatchableDesignDocument(slug, version);

  if (!current) {
    return null;
  }

  return insertDesignDocument({
    projectId: current.projectId,
    sourceType: current.sourceType,
    schemaVersion: current.schemaVersion,
    documentJson,
    sourceArtifactKey: current.sourceArtifactKey ?? null,
  });
}

export function moveDesignDocumentHistory(
  slug: string,
  direction: "undo" | "redo",
) {
  const project = getProject(slug);

  if (!project) {
    return null;
  }

  const versions = listDesignDocumentVersions(project.id);
  const latest = versions[versions.length - 1] ?? null;

  if (!latest) {
    return null;
  }

  const history = getDocumentHistory(latest.documentJson, latest.version);
  const targetSourceVersion =
    direction === "undo"
      ? getUndoTargetVersion(versions, history)
      : history.redoStack[0];

  if (!targetSourceVersion) {
    return null;
  }

  const target = versions.find(
    (document) => document.version === targetSourceVersion,
  );

  if (!target) {
    return null;
  }

  const nextHistory =
    direction === "undo"
      ? {
          currentSourceVersion: target.version,
          undoStack: getEarlierSourceVersions(versions, target.version),
          redoStack: [
            history.currentSourceVersion,
            ...history.redoStack.filter(
              (version) => version !== history.currentSourceVersion,
            ),
          ],
        }
      : {
          currentSourceVersion: target.version,
          undoStack: getEarlierSourceVersions(versions, target.version),
          redoStack: history.redoStack.slice(1),
        };

  return insertDesignDocument({
    projectId: target.projectId,
    sourceType: target.sourceType,
    schemaVersion: target.schemaVersion,
    documentJson: withDocumentHistory(target.documentJson, nextHistory),
    sourceArtifactKey: target.sourceArtifactKey ?? null,
  });
}

export function createDesignDocumentNode(
  slug: string,
  version: number,
  node: DesignNode,
) {
  const current = getPatchableDesignDocument(slug, version);

  if (!current) {
    return null;
  }

  return insertDesignDocument({
    projectId: current.projectId,
    sourceType: current.sourceType,
    schemaVersion: current.schemaVersion,
    documentJson: appendNodeToDocument(current.documentJson, node),
    sourceArtifactKey: current.sourceArtifactKey ?? null,
  });
}

export function deleteDesignDocumentNodes(
  slug: string,
  version: number,
  nodeIds: string[],
) {
  const current = getPatchableDesignDocument(slug, version);

  if (!current) {
    return null;
  }

  return insertDesignDocument({
    projectId: current.projectId,
    sourceType: current.sourceType,
    schemaVersion: current.schemaVersion,
    documentJson: removeNodesFromDocument(current.documentJson, nodeIds),
    sourceArtifactKey: current.sourceArtifactKey ?? null,
  });
}

export function updateDesignDocumentNode(
  slug: string,
  version: number,
  input: {
    nodeId: string;
    bounds?: DesignNode["bounds"];
    props?: Record<string, unknown>;
    name?: string;
  },
) {
  const current = getPatchableDesignDocument(slug, version);

  if (!current) {
    return null;
  }

  return insertDesignDocument({
    projectId: current.projectId,
    sourceType: current.sourceType,
    schemaVersion: current.schemaVersion,
    documentJson: updateNodeInDocument(current.documentJson, input),
    sourceArtifactKey: current.sourceArtifactKey ?? null,
  });
}

export function createImportedDesignDocument(
  slug: string,
  input: {
    documentJson: DesignDocumentJson;
    sourceType?: DesignDocument["sourceType"];
    sourceArtifactKey?: string | null;
  },
) {
  const project = getProject(slug);

  if (!project) {
    return null;
  }

  return insertDesignDocument({
    projectId: project.id,
    sourceType: input.sourceType ?? "fig-like",
    schemaVersion: 1,
    documentJson: input.documentJson,
    sourceArtifactKey: input.sourceArtifactKey ?? null,
  });
}

function getPatchableDesignDocument(slug: string, version: number) {
  const project = getProject(slug);

  if (!project) {
    return null;
  }

  return getDesignDocumentByVersion(project.id, version);
}

export function listComments(slug: string) {
  const project = getProject(slug);

  if (!project) {
    return null;
  }

  const rows = db()
    .prepare(
      "SELECT * FROM comments WHERE project_id = ? ORDER BY created_at DESC",
    )
    .all(project.id) as CommentRow[];

  return rows.map(commentFromRow);
}

export function createComment(
  slug: string,
  input: {
    documentVersionId?: string;
    viewId: string;
    nodeId?: string | null;
    x: number;
    y: number;
    body: string;
    authorId?: string;
    status?: DesignComment["status"];
  },
) {
  const project = getProject(slug);

  if (!project) {
    return null;
  }

  const document =
    input.documentVersionId &&
    getDesignDocumentById(input.documentVersionId, project.id);
  const targetDocument =
    document || getLatestDesignDocumentForProject(project.id);

  if (!targetDocument) {
    return null;
  }

  const now = new Date().toISOString();
  const comment: DesignComment = {
    id: `comment-${randomUUID()}`,
    projectId: project.id,
    documentVersionId: targetDocument.id,
    viewId: input.viewId,
    nodeId: input.nodeId ?? null,
    x: input.x,
    y: input.y,
    body: input.body,
    authorId: input.authorId?.trim() || "demo-user",
    status: input.status ?? "open",
    createdAt: now,
  };

  db()
    .prepare(
      `INSERT INTO comments (
        id, project_id, document_version_id, view_id, node_id, x, y,
        body, author_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      comment.id,
      comment.projectId,
      comment.documentVersionId,
      comment.viewId,
      comment.nodeId ?? null,
      comment.x,
      comment.y,
      comment.body,
      comment.authorId,
      comment.status,
      comment.createdAt,
    );

  return comment;
}

export function createRenderArtifact(
  slug: string,
  input: {
    viewId: string;
    width?: number;
    height?: number;
    deviceScale?: number;
    theme?: string;
  },
) {
  const project = getProject(slug);

  if (!project) {
    return null;
  }

  const document = getLatestDesignDocumentForProject(project.id);

  if (!document) {
    return null;
  }

  const view = document.documentJson.views.find(
    (item) => item.id === input.viewId,
  );

  if (!view) {
    return null;
  }

  const now = new Date().toISOString();
  const id = `render-${randomUUID()}`;
  const width = input.width ?? view.width;
  const height = input.height ?? view.height;
  const imageKey = `renders/${id}.json`;
  const artifact: RenderArtifact = {
    id,
    projectId: project.id,
    documentVersionId: document.id,
    viewId: view.id,
    width,
    height,
    deviceScale: input.deviceScale ?? 1,
    theme: input.theme ?? "light",
    imageKey,
    createdAt: now,
  };

  writeArtifact(imageKey, {
    kind: "metadata-render",
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
    },
    documentVersionId: document.id,
    view,
    width,
    height,
    createdAt: now,
  });

  db()
    .prepare(
      `INSERT INTO render_artifacts (
        id, project_id, document_version_id, view_id, width, height,
        device_scale, theme, image_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      artifact.id,
      artifact.projectId,
      artifact.documentVersionId,
      artifact.viewId,
      artifact.width,
      artifact.height,
      artifact.deviceScale,
      artifact.theme,
      artifact.imageKey,
      artifact.createdAt,
    );

  return artifact;
}

export function getRenderArtifact(id: string) {
  const row = db()
    .prepare("SELECT * FROM render_artifacts WHERE id = ?")
    .get(id) as RenderArtifactRow | undefined;

  return row ? renderArtifactFromRow(row) : null;
}

export function createModelJob(
  slug: string,
  input: { renderArtifactId: string; status?: ModelJob["status"] },
) {
  const project = getProject(slug);

  if (!project) {
    return null;
  }

  const renderArtifact = getRenderArtifact(input.renderArtifactId);

  if (!renderArtifact || renderArtifact.projectId !== project.id) {
    return null;
  }

  const now = new Date().toISOString();
  const job: ModelJob = {
    id: `job-${randomUUID()}`,
    projectId: project.id,
    renderArtifactId: renderArtifact.id,
    status: input.status ?? "queued",
    error: null,
    createdAt: now,
    updatedAt: now,
  };

  db()
    .prepare(
      `INSERT INTO model_jobs (
        id, project_id, render_artifact_id, status, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      job.id,
      job.projectId,
      job.renderArtifactId,
      job.status,
      job.error ?? null,
      job.createdAt,
      job.updatedAt,
    );

  return job;
}

export function updateModelJob(
  jobId: string,
  patch: { status: ModelJob["status"]; error?: string | null },
) {
  const now = new Date().toISOString();

  db()
    .prepare(
      "UPDATE model_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?",
    )
    .run(patch.status, patch.error ?? null, now, jobId);

  return getModelJob(jobId);
}

export function getModelJob(jobId: string, slug?: string) {
  const row = db()
    .prepare("SELECT * FROM model_jobs WHERE id = ?")
    .get(jobId) as ModelJobRow | undefined;

  if (!row) {
    return null;
  }

  if (slug) {
    const project = getProject(slug);
    if (!project || project.id !== row.project_id) {
      return null;
    }
  }

  return modelJobFromRow(row);
}

export function createHeatmapResult(input: {
  modelJobId: string;
  renderArtifactId: string;
  heatmapImageKey?: string | null;
  regions?: AttentionRegion[] | null;
  metrics?: Record<string, unknown> | null;
  modelVersion: string;
}) {
  const now = new Date().toISOString();
  const result: HeatmapResult = {
    id: `heatmap-${randomUUID()}`,
    modelJobId: input.modelJobId,
    renderArtifactId: input.renderArtifactId,
    heatmapImageKey: input.heatmapImageKey ?? null,
    regions: input.regions ?? null,
    metrics: input.metrics ?? null,
    modelVersion: input.modelVersion,
    createdAt: now,
  };

  db()
    .prepare(
      `INSERT INTO heatmap_results (
        id, model_job_id, render_artifact_id, heatmap_image_key,
        regions_json, metrics_json, model_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      result.id,
      result.modelJobId,
      result.renderArtifactId,
      result.heatmapImageKey ?? null,
      result.regions ? JSON.stringify(result.regions) : null,
      result.metrics ? JSON.stringify(result.metrics) : null,
      result.modelVersion,
      result.createdAt,
    );

  return result;
}

export function getLatestHeatmapResult(slug: string, viewId: string) {
  const project = getProject(slug);

  if (!project) {
    return null;
  }

  const row = db()
    .prepare(
      `SELECT heatmap_results.*
       FROM heatmap_results
       JOIN render_artifacts ON render_artifacts.id = heatmap_results.render_artifact_id
       WHERE render_artifacts.project_id = ? AND render_artifacts.view_id = ?
       ORDER BY heatmap_results.created_at DESC
       LIMIT 1`,
    )
    .get(project.id, viewId) as HeatmapResultRow | undefined;

  if (!row) {
    return null;
  }

  const latestDocument = getLatestDesignDocumentForProject(project.id);
  const renderArtifact = getRenderArtifact(row.render_artifact_id);
  const result = heatmapResultFromRow(row);

  return {
    ...result,
    stale:
      !latestDocument ||
      !renderArtifact ||
      latestDocument.id !== renderArtifact.documentVersionId,
  };
}

function updateProject(slug: string, patch: Partial<TasteProject>) {
  const current = getProject(slug);

  if (!current) {
    return null;
  }

  const next = {
    ...current,
    ...patch,
  };

  db()
    .prepare(
      `UPDATE projects
       SET score = ?, status = ?, updated_label = ?, current_draft_json = ?,
           latest_evaluation_json = ?, run_status_json = ?, updated_at = ?
       WHERE slug = ?`,
    )
    .run(
      next.score,
      next.status,
      next.updated,
      next.currentDraft ? JSON.stringify(next.currentDraft) : null,
      next.latestEvaluation ? JSON.stringify(next.latestEvaluation) : null,
      JSON.stringify(next.runStatus),
      new Date().toISOString(),
      slug,
    );

  return getProject(slug);
}

function createDesignVersion(input: {
  projectId: string;
  projectName: string;
  projectType: string;
  brief: string;
  draft: ComponentDraft | null;
}) {
  return insertDesignDocument({
    projectId: input.projectId,
    sourceType: "internal",
    schemaVersion: 1,
    documentJson: buildDesignDocumentJson(input),
    sourceArtifactKey: null,
  });
}

function insertDesignDocument(input: {
  projectId: string;
  sourceType: DesignDocument["sourceType"];
  schemaVersion: number;
  documentJson: DesignDocumentJson;
  sourceArtifactKey: string | null;
}) {
  const versionRow = db()
    .prepare(
      "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM design_documents WHERE project_id = ?",
    )
    .get(input.projectId) as { next_version: number };
  const now = new Date().toISOString();
  const document: DesignDocument = {
    id: `doc-${randomUUID()}`,
    projectId: input.projectId,
    version: versionRow.next_version,
    sourceType: input.sourceType,
    schemaVersion: input.schemaVersion,
    documentJson: input.documentJson,
    sourceArtifactKey: input.sourceArtifactKey,
    createdAt: now,
  };

  db()
    .prepare(
      `INSERT INTO design_documents (
        id, project_id, version, source_type, schema_version,
        document_json, source_artifact_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      document.id,
      document.projectId,
      document.version,
      document.sourceType,
      document.schemaVersion,
      JSON.stringify(document.documentJson),
      document.sourceArtifactKey ?? null,
      document.createdAt,
    );

  return document;
}

function getLatestDesignDocumentForProject(projectId: string) {
  const row = db()
    .prepare(
      `SELECT * FROM design_documents
       WHERE project_id = ?
       ORDER BY version DESC
       LIMIT 1`,
    )
    .get(projectId) as DesignDocumentRow | undefined;

  return row ? designDocumentFromRow(row) : null;
}

function listDesignDocumentVersions(projectId: string) {
  const rows = db()
    .prepare(
      `SELECT * FROM design_documents
       WHERE project_id = ?
       ORDER BY version ASC`,
    )
    .all(projectId) as DesignDocumentRow[];

  return rows.map(designDocumentFromRow);
}

function getDesignDocumentByVersion(projectId: string, version: number) {
  const row = db()
    .prepare(
      "SELECT * FROM design_documents WHERE project_id = ? AND version = ?",
    )
    .get(projectId, version) as DesignDocumentRow | undefined;

  return row ? designDocumentFromRow(row) : null;
}

function getDesignDocumentById(id: string, projectId: string) {
  const row = db()
    .prepare("SELECT * FROM design_documents WHERE id = ? AND project_id = ?")
    .get(id, projectId) as DesignDocumentRow | undefined;

  return row ? designDocumentFromRow(row) : null;
}

type DesignDocumentHistory = {
  currentSourceVersion: number;
  undoStack: number[];
  redoStack: number[];
};

function getDocumentHistory(
  documentJson: DesignDocumentJson,
  fallbackVersion: number,
): DesignDocumentHistory {
  const history =
    documentJson.styles.history &&
    typeof documentJson.styles.history === "object"
      ? (documentJson.styles.history as Partial<DesignDocumentHistory>)
      : {};

  return {
    currentSourceVersion:
      typeof history.currentSourceVersion === "number"
        ? history.currentSourceVersion
        : fallbackVersion,
    undoStack: Array.isArray(history.undoStack)
      ? history.undoStack.filter((version) => Number.isInteger(version))
      : [],
    redoStack: Array.isArray(history.redoStack)
      ? history.redoStack.filter((version) => Number.isInteger(version))
      : [],
  };
}

function getUndoTargetVersion(
  versions: DesignDocument[],
  history: DesignDocumentHistory,
) {
  const stackTarget = history.undoStack[history.undoStack.length - 1];

  if (stackTarget) {
    return stackTarget;
  }

  const sourceIndex = versions.findIndex(
    (document) => document.version === history.currentSourceVersion,
  );

  return sourceIndex > 0 ? versions[sourceIndex - 1]?.version : null;
}

function getEarlierSourceVersions(
  versions: DesignDocument[],
  targetVersion: number,
) {
  return versions
    .map((document) => document.version)
    .filter((version) => version < targetVersion);
}

function withDocumentHistory(
  documentJson: DesignDocumentJson,
  history: DesignDocumentHistory,
): DesignDocumentJson {
  return {
    ...documentJson,
    styles: {
      ...documentJson.styles,
      history: {
        ...history,
        updatedAt: new Date().toISOString(),
      },
    },
    metadata: {
      ...documentJson.metadata,
      generatedAt: new Date().toISOString(),
    },
  };
}

function db() {
  if (!database) {
    mkdirSync(DATA_DIR, { recursive: true });
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    database = new Database(DB_PATH);
    database.exec("PRAGMA foreign_keys = ON");
    initializeSchema(database);
    seedDemoProjects(database);
  }

  return database;
}

function initializeSchema(store: Database.Database) {
  store.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      brief TEXT NOT NULL,
      score INTEGER NOT NULL,
      status TEXT NOT NULL,
      updated_label TEXT NOT NULL,
      current_draft_json TEXT,
      latest_evaluation_json TEXT,
      run_status_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS design_documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      document_json TEXT NOT NULL,
      source_artifact_key TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, version)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      document_version_id TEXT NOT NULL REFERENCES design_documents(id) ON DELETE CASCADE,
      view_id TEXT NOT NULL,
      node_id TEXT,
      x REAL NOT NULL,
      y REAL NOT NULL,
      body TEXT NOT NULL,
      author_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS render_artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      document_version_id TEXT NOT NULL REFERENCES design_documents(id) ON DELETE CASCADE,
      view_id TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      device_scale REAL NOT NULL,
      theme TEXT NOT NULL,
      image_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      render_artifact_id TEXT NOT NULL REFERENCES render_artifacts(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS heatmap_results (
      id TEXT PRIMARY KEY,
      model_job_id TEXT NOT NULL REFERENCES model_jobs(id) ON DELETE CASCADE,
      render_artifact_id TEXT NOT NULL REFERENCES render_artifacts(id) ON DELETE CASCADE,
      heatmap_image_key TEXT,
      regions_json TEXT,
      metrics_json TEXT,
      model_version TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function seedDemoProjects(store: Database.Database) {
  const count = store
    .prepare("SELECT COUNT(*) AS count FROM projects")
    .get() as {
    count: number;
  };

  if (count.count > 0) {
    return;
  }

  for (const project of getSeedProjects()) {
    const now = new Date().toISOString();

    store
      .prepare(
        `INSERT INTO projects (
          id, slug, name, type, brief, score, status, updated_label,
          current_draft_json, latest_evaluation_json, run_status_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.slug,
        project.name,
        project.type,
        project.brief,
        project.score,
        project.status,
        project.updated,
        project.currentDraft ? JSON.stringify(project.currentDraft) : null,
        project.latestEvaluation
          ? JSON.stringify(project.latestEvaluation)
          : null,
        JSON.stringify(project.runStatus),
        now,
        now,
      );

    insertDesignDocument({
      projectId: project.id,
      sourceType: "internal",
      schemaVersion: 1,
      documentJson: buildDesignDocumentJson({
        projectId: project.id,
        projectName: project.name,
        projectType: project.type,
        brief: project.brief,
        draft: project.currentDraft,
      }),
      sourceArtifactKey: null,
    });
  }
}

function getSeedProjects(): TasteProject[] {
  const now = new Date().toISOString();

  return [
    {
      id: "project-seed-hackathon-onboarding",
      slug: "hackathon-onboarding",
      name: "Hackathon onboarding",
      type: "Web app",
      brief:
        "A high-conversion onboarding surface for hackers joining a design intelligence workspace.",
      score: 87,
      status: "Ready to evaluate",
      updated: "Today",
      currentDraft: {
        id: "seed-draft-hackathon",
        title: "Onboarding hero",
        summary: "A focused onboarding concept for the hackathon demo.",
        headline: "Build better product taste in minutes",
        subheadline:
          "Generate, critique, and improve design components with attention-aware feedback.",
        primaryAction: "Start evaluation",
        secondaryAction: "View sample",
        layoutNotes: [
          "Primary action sits directly under the core promise.",
          "Proof cards stay secondary to the first user decision.",
        ],
        suggestedImplementation:
          "Render a compact hero, three proof cards, and one dominant CTA.",
        palette: {
          background: "#f7f9fc",
          surface: "#ffffff",
          accent: "#1478f2",
          ink: "#071120",
        },
        createdAt: now,
      },
      latestEvaluation: null,
      runStatus: {
        action: "idle",
        message: "Ready",
        updatedAt: now,
      },
    },
    {
      id: "project-seed-portfolio-case-study",
      slug: "portfolio-case-study",
      name: "Portfolio case study",
      type: "Landing page",
      brief:
        "A portfolio case study page that makes product judgment and craft obvious within the first viewport.",
      score: 74,
      status: "Needs hierarchy pass",
      updated: "Yesterday",
      currentDraft: null,
      latestEvaluation: null,
      runStatus: {
        action: "idle",
        message: "Ready",
        updatedAt: now,
      },
    },
    {
      id: "project-seed-sponsor-dashboard",
      slug: "sponsor-dashboard",
      name: "Sponsor dashboard",
      type: "Dashboard",
      brief:
        "A sponsor analytics dashboard for LA Hacks that highlights traction, check-ins, and engagement quality.",
      score: 81,
      status: "Ready to build",
      updated: "Apr 22",
      currentDraft: null,
      latestEvaluation: null,
      runStatus: {
        action: "idle",
        message: "Ready",
        updatedAt: now,
      },
    },
  ];
}

function buildDesignDocumentJson(input: {
  projectId?: string;
  projectName: string;
  projectType: string;
  brief: string;
  draft: ComponentDraft | null;
}): DesignDocumentJson {
  const generatedAt = new Date().toISOString();
  const nodes: DesignDocumentJson["nodes"] = [
    {
      id: "brief-title",
      type: "text",
      viewId: "brief",
      name: "Project title",
      props: { text: input.projectName },
      bounds: { x: 96, y: 96, width: 620, height: 96 },
    },
    {
      id: "brief-copy",
      type: "text",
      viewId: "brief",
      name: "Project brief",
      props: { text: input.brief },
      bounds: { x: 96, y: 220, width: 680, height: 180 },
    },
  ];

  if (input.draft) {
    nodes.push(
      {
        id: "draft-headline",
        type: "text",
        viewId: "draft",
        name: "Headline",
        props: { text: input.draft.headline },
        bounds: { x: 120, y: 110, width: 560, height: 150 },
      },
      {
        id: "draft-subheadline",
        type: "text",
        viewId: "draft",
        name: "Subheadline",
        props: { text: input.draft.subheadline },
        bounds: { x: 120, y: 280, width: 620, height: 120 },
      },
      {
        id: "draft-primary-action",
        type: "button",
        viewId: "draft",
        name: "Primary action",
        props: { text: input.draft.primaryAction },
        bounds: { x: 120, y: 440, width: 220, height: 64 },
      },
      {
        id: "draft-proof-stack",
        type: "group",
        viewId: "draft",
        name: "Proof stack",
        props: { summary: input.draft.summary },
        bounds: { x: 760, y: 130, width: 300, height: 390 },
      },
    );
  }

  return {
    pages: [{ id: "page-1", name: "Page 1", viewIds: ["brief", "draft"] }],
    views: [
      {
        id: "brief",
        name: "Brief",
        width: 1200,
        height: 760,
        nodeIds: nodes
          .filter((node) => node.viewId === "brief")
          .map((node) => node.id),
      },
      {
        id: "draft",
        name: "Draft",
        width: 1200,
        height: 760,
        nodeIds: nodes
          .filter((node) => node.viewId === "draft")
          .map((node) => node.id),
      },
    ],
    nodes,
    styles: input.draft
      ? {
          palette: input.draft.palette,
        }
      : {},
    metadata: {
      projectName: input.projectName,
      projectType: input.projectType,
      generatedAt,
    },
  };
}

function getUniqueSlug(name: string) {
  const baseSlug = slugify(name) || "project";
  let slug = baseSlug;
  let suffix = 2;

  while (db().prepare("SELECT 1 FROM projects WHERE slug = ?").get(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

function getLocalProjectSlugBase(input: {
  name: string;
  type: string;
  brief: string;
}) {
  const text = `${input.name} ${input.brief}`;
  const stopwords = new Set([
    "a",
    "an",
    "and",
    "app",
    "build",
    "create",
    "dashboard",
    "design",
    "for",
    "in",
    "make",
    "of",
    "platform",
    "project",
    "the",
    "to",
    "tool",
    "web",
    "website",
    input.type.toLowerCase(),
  ]);
  const words = slugify(text)
    .split("-")
    .filter((word) => word.length > 1 && !stopwords.has(word))
    .slice(0, 3);

  return words.join("-") || normalizeProjectSlugBase(input.name);
}

function normalizeProjectSlugBase(value: string) {
  const words: string[] = [];

  for (const word of slugify(value).split("-")) {
    if (!word || words.includes(word)) {
      continue;
    }

    words.push(word);

    if (words.length === 3) {
      break;
    }
  }

  return words.join("-");
}

function writeArtifact(key: string, value: unknown) {
  const fullPath = path.join(ARTIFACT_DIR, key);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function projectFromRow(row: ProjectRow): TasteProject {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    brief: row.brief,
    score: row.score,
    status: row.status,
    updated: row.updated_label,
    currentDraft: parseJson<ComponentDraft | null>(
      row.current_draft_json,
      null,
    ),
    latestEvaluation: parseJson<TasteEvaluation | null>(
      row.latest_evaluation_json,
      null,
    ),
    runStatus: parseJson<RunStatus>(row.run_status_json, {
      action: "idle",
      message: "Ready",
      updatedAt: new Date().toISOString(),
    }),
  };
}

function designDocumentFromRow(row: DesignDocumentRow): DesignDocument {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    sourceType: row.source_type,
    schemaVersion: row.schema_version,
    documentJson: parseJson<DesignDocumentJson>(row.document_json, {
      pages: [],
      views: [],
      nodes: [],
      styles: {},
      metadata: {
        projectName: "",
        projectType: "",
        generatedAt: row.created_at,
      },
    }),
    sourceArtifactKey: row.source_artifact_key,
    createdAt: row.created_at,
  };
}

function commentFromRow(row: CommentRow): DesignComment {
  return {
    id: row.id,
    projectId: row.project_id,
    documentVersionId: row.document_version_id,
    viewId: row.view_id,
    nodeId: row.node_id,
    x: row.x,
    y: row.y,
    body: row.body,
    authorId: row.author_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

function renderArtifactFromRow(row: RenderArtifactRow): RenderArtifact {
  return {
    id: row.id,
    projectId: row.project_id,
    documentVersionId: row.document_version_id,
    viewId: row.view_id,
    width: row.width,
    height: row.height,
    deviceScale: row.device_scale,
    theme: row.theme,
    imageKey: row.image_key,
    createdAt: row.created_at,
  };
}

function modelJobFromRow(row: ModelJobRow): ModelJob {
  return {
    id: row.id,
    projectId: row.project_id,
    renderArtifactId: row.render_artifact_id,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function heatmapResultFromRow(row: HeatmapResultRow): HeatmapResult {
  return {
    id: row.id,
    modelJobId: row.model_job_id,
    renderArtifactId: row.render_artifact_id,
    heatmapImageKey: row.heatmap_image_key,
    regions: parseJson<AttentionRegion[] | null>(row.regions_json, null),
    metrics: parseJson<Record<string, unknown> | null>(row.metrics_json, null),
    modelVersion: row.model_version,
    createdAt: row.created_at,
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getResponseText(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const outputText = (body as { output_text?: unknown }).output_text;
  if (typeof outputText === "string") return outputText;
  const output = (body as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
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
