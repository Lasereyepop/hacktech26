"use client";

import type { ComponentType, CSSProperties, FormEvent } from "react";
import { useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/brand";
import {
  ArrowIcon,
  CheckIcon,
  OverviewIcon,
  SettingsIcon,
  SparkIcon,
  MonitorIcon,
  PhoneIcon,
  HandIcon,
  PenIcon,
  EraserIcon,
  CommentIcon,
  ResourcesIcon,
  RedoIcon,
  SunIcon,
  MoonIcon,
  UndoIcon,
} from "@/components/icons";
import type {
  AttentionRegion,
  ComponentDraft,
  DesignDocument,
  DesignDocumentJson,
  DesignNode,
  EditContext,
  EditContextBounds,
  EditContextNodeSummary,
  GazeAgentContext,
  ProjectAsset,
  ReferenceAsset,
  TasteProject,
  TextStyleRun,
} from "@/lib/types";
import { auditTextFit, fitTextBounds, type TextFitAudit } from "@/lib/text-fit";
import {
  normalizeTextStyleRuns,
  splitTextIntoStyledSegments,
  toggleTextStyleRun,
} from "@/lib/text-style-runs";
import { DEFAULT_CANVAS_FONT, FONT_PRESETS } from "@/lib/typography-catalog";

// Canvas element types
type CanvasElement = {
  id: string;
  type:
    | "frame"
    | "section"
    | "slice"
    | "rectangle"
    | "line"
    | "arrow"
    | "ellipse"
    | "polygon"
    | "star"
    | "boundary"
    | "rounded-boundary"
    | "text"
    | "button"
    | "image"
    | "path"
    | "comment"
    // Folders are organizational containers shown in the layer panel.
    // They are not rendered on the canvas; their children (linked via
    // parentId) render normally and keep their own coordinates.
    | "folder";
  viewId?: string;
  // Id of the parent folder (CanvasElement of type "folder") this element
  // is nested inside. Undefined for elements at the root of a view.
  parentId?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  name?: string;
  content?: string;
  textStyleRuns?: TextStyleRun[];
  artifactKey?: string;
  prompt?: string;
  role?: "reference-guide" | string;
  exportable?: boolean;
  locked?: boolean;
  objectFit?: "cover" | "contain" | "fill";
  objectPosition?: string;
  alt?: string;
  points?: { x: number; y: number }[];
  style?: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    fontSize?: number;
    fontFamily?: string;
    opacity?: number;
    fontWeight?: string;
    fontStyle?: string;
    color?: string;
    textAlign?: "left" | "center" | "right";
    letterSpacing?: number;
    lineHeight?: number;
    // Frame / shape extras. Stored on `style` so existing serialization
    // and dragging logic keeps working without schema changes elsewhere.
    cornerRadius?: number;
    cornerScale?: number;
    fillOpacity?: number;
    elevation?: boolean;
    presetId?: string | null;
  };
  selected?: boolean;
};

type NavId = "dashboard" | "settings";
type FrameMode = "before" | "after";
type LoadState = "idle" | "loading" | "error";
type CanvasTool =
  | "move"
  | "hand"
  | "frame"
  | "shape"
  | "pen"
  | "eraser"
  | "text"
  | "resources"
  | "comment";
type FrameToolKind = "frame" | "section" | "slice";
type ShapeToolKind =
  | "rectangle"
  | "line"
  | "arrow"
  | "ellipse"
  | "polygon"
  | "star"
  | "boundary"
  | "rounded-boundary";

type FramePreset = {
  id: string;
  label: string;
  group: string;
  width: number;
  height: number;
};

// Result returned by the gaze prediction backend (FastAPI in apps/api/).
// All coordinates are normalized [0, 1] relative to the captured artboard
// image. `width` / `height` are the captured PNG dimensions in CSS pixels.
type GazeFixation = {
  x: number;
  y: number;
  dwell_ms: number;
  fixation_index: number;
  start_frame: number;
  end_frame: number;
};

type GazeAnalysis = {
  width: number;
  height: number;
  fps: number;
  n_frames: number;
  gaze_sequence: { frame: number; x: number; y: number }[];
  fixations: GazeFixation[];
  heatmap_b64: string;
  overlay_b64: string;
  elapsed_ms?: number;
  generatedAt: number;
};

function createGazeAgentContext(
  analysis: GazeAnalysis,
  additionalInfo?: string,
): GazeAgentContext {
  const orderedFixations = analysis.fixations
    .slice()
    .sort((a, b) => a.fixation_index - b.fixation_index);
  const strongest = analysis.fixations
    .slice()
    .sort((a, b) => b.dwell_ms - a.dwell_ms)[0];
  const toAgentFixation = (fixation: GazeFixation) => ({
    x: Number(fixation.x.toFixed(4)),
    y: Number(fixation.y.toFixed(4)),
    dwellMs: Math.round(fixation.dwell_ms),
    fixationIndex: fixation.fixation_index,
    startFrame: fixation.start_frame,
    endFrame: fixation.end_frame,
  });
  const firstFixation = orderedFixations[0]
    ? toAgentFixation(orderedFixations[0])
    : null;
  const strongestFixation = strongest ? toAgentFixation(strongest) : null;
  const topFixations = orderedFixations.slice(0, 8).map(toAgentFixation);
  const attentionNotes = [
    firstFixation
      ? `First fixation landed at normalized (${firstFixation.x}, ${firstFixation.y}).`
      : "No first fixation was available.",
    strongestFixation
      ? `Longest dwell was fixation ${strongestFixation.fixationIndex} at normalized (${strongestFixation.x}, ${strongestFixation.y}) for ${strongestFixation.dwellMs}ms.`
      : "No dwell hotspot was available.",
    `Use the first ${topFixations.length} ordered fixations to infer the scanpath before changing hierarchy.`,
  ];

  return {
    width: analysis.width,
    height: analysis.height,
    fps: analysis.fps,
    nFrames: analysis.n_frames,
    generatedAt: analysis.generatedAt,
    fixationCount: analysis.fixations.length,
    ...(additionalInfo?.trim()
      ? { additionalInfo: additionalInfo.trim().slice(0, 1200) }
      : {}),
    firstFixation,
    strongestFixation,
    topFixations,
    attentionNotes,
  };
}

type CanvasBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PenSettings = {
  color: string;
  size: number;
  opacity: number;
};

type CanvasFrameSelection = {
  kind: FrameToolKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  cornerRadius: number;
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeOpacity: number;
  strokeWeight: number;
  strokePosition: "Inside" | "Center" | "Outside";
  visible: boolean;
};

type Session = {
  email: string;
  role: string;
};

type Settings = {
  critiqueDepth: number;
  tasteProfile: string;
  compactMode: boolean;
  modelNotes: boolean;
  theme: "light" | "dark" | "system";
  nudgeAmount: number;
  snapping: boolean;
  multiplayerCursors: boolean;
};

type AgentRunIntent = "create" | "build" | "edit" | "auto";

type AgentRunResponse = {
  project?: TasteProject;
  design?: DesignDocument | null;
  run?: {
    id: string;
    intent: string;
    model: string;
    reasoningEffort: string;
    summary: string;
    steps: string[];
  };
  error?: string;
};

type AgentActivityEvent = {
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

type AgentStreamMessage =
  | { type: "event"; event: AgentActivityEvent }
  | { type: "result"; result: AgentRunResponse | null }
  | { type: "error"; error: string };

const SESSION_KEY = "taste-lab-session";
const SETTINGS_KEY = "taste-lab-settings";
const PENDING_AGENT_RUN_PREFIX = "taste-lab-pending-agent-run:";
const defaultSettings: Settings = {
  critiqueDepth: 68,
  tasteProfile: "Product SaaS",
  compactMode: false,
  modelNotes: true,
  theme: "system",
  nudgeAmount: 8,
  snapping: true,
  multiplayerCursors: true,
};

const navItems: Array<{ id: NavId; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "settings", label: "Settings" },
];

const projectPromptQuips = [
  "What are you building today?",
  "Sketch the product you wish existed.",
  "Turn a rough idea into a design brief.",
  "What should this interface help people do?",
  "Describe the dashboard you want to see.",
  "Start with the user, then the screen.",
];

const framePresets: FramePreset[] = [
  {
    id: "website",
    label: "Website",
    group: "Desktop",
    width: 1440,
    height: 900,
  },
  {
    id: "macos",
    label: "macOS Window",
    group: "Desktop",
    width: 1200,
    height: 760,
  },
  {
    id: "iphone-15",
    label: "iPhone 15",
    group: "Phone",
    width: 393,
    height: 852,
  },
  {
    id: "iphone-se",
    label: "iPhone SE",
    group: "Phone",
    width: 375,
    height: 667,
  },
  {
    id: "iphone-max",
    label: "iPhone Pro Max",
    group: "Phone",
    width: 430,
    height: 932,
  },
];

// Presets used to resize the design artboard itself (Brief / Draft canvas
// frame). Grouped by device class so the picker can show them as sections.
type ArtboardPreset = {
  id: string;
  label: string;
  group: "Desktop" | "Tablet" | "Phone" | "Social" | "Print";
  width: number;
  height: number;
};

const artboardPresets: ArtboardPreset[] = [
  {
    id: "desktop",
    label: "Desktop (1440 × 1024)",
    group: "Desktop",
    width: 1440,
    height: 1024,
  },
  {
    id: "desktop-hd",
    label: "Desktop HD (1920 × 1080)",
    group: "Desktop",
    width: 1920,
    height: 1080,
  },
  {
    id: "macbook-air",
    label: "MacBook Air (1280 × 832)",
    group: "Desktop",
    width: 1280,
    height: 832,
  },
  {
    id: "macbook-pro",
    label: 'MacBook Pro 16" (1728 × 1117)',
    group: "Desktop",
    width: 1728,
    height: 1117,
  },
  {
    id: "ipad",
    label: "iPad (1024 × 768)",
    group: "Tablet",
    width: 1024,
    height: 768,
  },
  {
    id: "ipad-pro",
    label: 'iPad Pro 12.9" (1366 × 1024)',
    group: "Tablet",
    width: 1366,
    height: 1024,
  },
  {
    id: "iphone-16-pro",
    label: "iPhone 16 Pro (402 × 874)",
    group: "Phone",
    width: 402,
    height: 874,
  },
  {
    id: "iphone-16-pro-max",
    label: "iPhone 16 Pro Max (440 × 956)",
    group: "Phone",
    width: 440,
    height: 956,
  },
  {
    id: "iphone-se-3",
    label: "iPhone SE (375 × 667)",
    group: "Phone",
    width: 375,
    height: 667,
  },
  {
    id: "android",
    label: "Android (412 × 915)",
    group: "Phone",
    width: 412,
    height: 915,
  },
  {
    id: "social-square",
    label: "Square Post (1080 × 1080)",
    group: "Social",
    width: 1080,
    height: 1080,
  },
  {
    id: "social-story",
    label: "Story (1080 × 1920)",
    group: "Social",
    width: 1080,
    height: 1920,
  },
  {
    id: "social-banner",
    label: "Wide Banner (1500 × 500)",
    group: "Social",
    width: 1500,
    height: 500,
  },
  {
    id: "letter",
    label: "US Letter (816 × 1056)",
    group: "Print",
    width: 816,
    height: 1056,
  },
  {
    id: "a4",
    label: "A4 (794 × 1123)",
    group: "Print",
    width: 794,
    height: 1123,
  },
];

// Default artboard size — matches the previous CSS-driven appearance
// (width: min(100%, 58rem) ~ 928px; min-height: 31rem ~ 496px) at a slightly
// taller default to give designers vertical room to work in.
const defaultArtboardSize = { width: 928, height: 720 };

const shapeToolOptions: Array<{
  kind: ShapeToolKind;
  label: string;
  shortcut: string;
}> = [
  { kind: "rectangle", label: "Rectangle", shortcut: "R" },
  { kind: "line", label: "Line", shortcut: "L" },
  { kind: "arrow", label: "Arrow", shortcut: "" },
  { kind: "ellipse", label: "Ellipse", shortcut: "O" },
  { kind: "polygon", label: "Polygon", shortcut: "" },
  { kind: "star", label: "Star", shortcut: "" },
  { kind: "boundary", label: "Boundary", shortcut: "" },
  { kind: "rounded-boundary", label: "Rounded boundary", shortcut: "" },
];

const defaultFrameSelection: CanvasFrameSelection = {
  kind: "frame",
  name: "Actual element",
  x: 120,
  y: 80,
  width: 368,
  height: 568,
  opacity: 100,
  cornerRadius: 8,
  fill: "#ffffff",
  fillOpacity: 100,
  stroke: "#000000",
  strokeOpacity: 10,
  strokeWeight: 1,
  strokePosition: "Inside",
  visible: true,
};

const iconByNav: Record<NavId, ComponentType> = {
  dashboard: OverviewIcon,
  settings: SettingsIcon,
};

export function DashboardExperience({ projectSlug }: { projectSlug?: string }) {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [session, setSession] = useState<Session>({
    email: "demo@tastelab.local",
    role: "Founder",
  });
  const [activeNav, setActiveNav] = useState<NavId>("dashboard");
  const [projects, setProjects] = useState<TasteProject[]>([]);
  const [activeProject, setActiveProject] = useState<TasteProject | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [activeFrame, setActiveFrame] = useState<FrameMode>("after");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [agentActivity, setAgentActivity] = useState<AgentActivityEvent[]>([]);
  const activeAgentRunRef = useRef<string | null>(null);

  useEffect(() => {
    const rawSession = window.localStorage.getItem(SESSION_KEY);
    if (!rawSession) {
      router.replace("/login");
      return;
    }

    try {
      setSession(JSON.parse(rawSession) as Session);
      setSettings(readPersistedSettings());
      setSettingsLoaded(true);
      setIsReady(true);
    } catch {
      window.localStorage.removeItem(SESSION_KEY);
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    void loadProjects();
  }, [isReady]);

  useEffect(() => {
    if (!isReady || !projectSlug) {
      return;
    }

    void loadProject(projectSlug);
  }, [isReady, projectSlug]);

  useEffect(() => {
    if (!isReady || !projectSlug || !activeProject) {
      return;
    }

    const pendingKey = `${PENDING_AGENT_RUN_PREFIX}${projectSlug}`;
    const rawPendingRun = window.sessionStorage.getItem(pendingKey);

    if (!rawPendingRun || activeAgentRunRef.current === projectSlug) {
      return;
    }

    window.sessionStorage.removeItem(pendingKey);

    let pendingRun: {
      intent: AgentRunIntent;
      request: string;
      source: "dashboard-prompt" | "right-inspector";
    };

    try {
      pendingRun = JSON.parse(rawPendingRun) as {
        intent: AgentRunIntent;
        request: string;
        source: "dashboard-prompt" | "right-inspector";
      };
    } catch {
      return;
    }

    void runProjectAgent(projectSlug, pendingRun).catch((error) => {
      activeAgentRunRef.current = null;
      setAgentActivity((current) => [
        ...current,
        createClientAgentEvent(
          "error",
          "Agent run failed",
          error instanceof Error ? error.message : "Agent run failed.",
          "error",
        ),
      ]);
    });
  }, [activeProject, isReady, projectSlug]);

  const averageScore = useMemo(() => {
    if (projects.length === 0) {
      return 0;
    }

    const total = projects.reduce((sum, project) => sum + project.score, 0);
    return Math.round(total / projects.length);
  }, [projects]);

  async function loadProjects() {
    setLoadState("loading");

    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const data = (await response.json()) as { projects: TasteProject[] };

      if (!response.ok) {
        throw new Error("Failed to load projects.");
      }

      setProjects(data.projects);
      setLoadState("idle");
    } catch {
      setLoadState("error");
    }
  }

  async function loadProject(slug: string) {
    setLoadState("loading");

    try {
      const response = await fetch(`/api/projects/${slug}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        project?: TasteProject;
        error?: string;
      };

      if (!response.ok || !data.project) {
        throw new Error(data.error ?? "Project not found.");
      }

      const nextProject = data.project;

      setActiveProject(nextProject);
      setProjects((current) => mergeProject(current, nextProject));
      setLoadState("idle");
    } catch {
      setActiveProject(null);
      setLoadState("error");
    }
  }

  async function createProject(input: {
    name: string;
    type?: string;
    brief?: string;
  }) {
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, agentic: true }),
    });
    const data = (await response.json()) as {
      project?: TasteProject;
      error?: string;
    };

    if (!response.ok || !data.project) {
      throw new Error(data.error ?? "Could not create project.");
    }

    const nextProject = data.project;
    const pendingRun = {
      intent: "create",
      request: input.brief ?? input.name,
      source: "dashboard-prompt",
    } satisfies {
      intent: AgentRunIntent;
      request: string;
      source: "dashboard-prompt" | "right-inspector";
    };

    window.sessionStorage.setItem(
      `${PENDING_AGENT_RUN_PREFIX}${nextProject.slug}`,
      JSON.stringify(pendingRun),
    );
    setAgentActivity([
      createClientAgentEvent(
        "queued",
        "Project workspace created",
        "Opening the canvas while the agent prepares the first draft.",
        "running",
      ),
    ]);
    setActiveProject(nextProject);
    setProjects((current) => mergeProject(current, nextProject));
    router.push(`/project/${nextProject.slug}`);
  }

  async function buildProject(
    request: string,
    editContext?: EditContext,
    gazeContext?: GazeAgentContext,
    intentOverride?: Exclude<AgentRunIntent, "auto">,
  ) {
    if (!activeProject) {
      return;
    }

    const data = await runProjectAgent(activeProject.slug, {
      intent: intentOverride ?? (editContext ? "edit" : "auto"),
      request,
      source: "right-inspector",
      editContext,
      gazeContext,
    });
    const nextProject = data.project;

    if (!nextProject) {
      throw new Error("Agent run did not return an updated project.");
    }

    setActiveProject(nextProject);
    setProjects((current) => mergeProject(current, nextProject));
    setActiveFrame("after");
  }

  async function evaluateProject() {
    if (!activeProject) {
      return;
    }

    const response = await fetch(
      `/api/projects/${activeProject.slug}/evaluate`,
      {
        method: "POST",
      },
    );
    const data = (await response.json()) as {
      project?: TasteProject;
      error?: string;
    };

    if (!response.ok || !data.project) {
      throw new Error(data.error ?? "Could not evaluate component.");
    }

    const nextProject = data.project;

    setActiveProject(nextProject);
    setProjects((current) => mergeProject(current, nextProject));
  }

  function changeSection(nextSection: NavId) {
    setActiveNav(nextSection);
    if (nextSection === "dashboard") {
      router.push("/dashboard");
    }
  }

  function signOut() {
    window.localStorage.removeItem(SESSION_KEY);
    router.push("/login");
  }

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function runProjectAgent(
    slug: string,
    input: {
      intent: AgentRunIntent;
      request: string;
      source: "dashboard-prompt" | "right-inspector";
      editContext?: EditContext;
      gazeContext?: GazeAgentContext;
    },
  ) {
    activeAgentRunRef.current = slug;
    setAgentActivity([
      createClientAgentEvent(
        "queued",
        "Connecting to agent stream",
        "Waiting for the server to start reporting planning and tool calls.",
        "running",
      ),
    ]);
    setActiveProject((current) =>
      current?.slug === slug
        ? {
            ...current,
            runStatus: {
              action: "building",
              message:
                input.intent === "create"
                  ? "Creating with GPT-5.5 agents"
                  : "Running design agent",
              updatedAt: new Date().toISOString(),
            },
          }
        : current,
    );

    const response = await fetch(`/api/projects/${slug}/agent-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, stream: true }),
    });

    if (!response.ok || !response.body) {
      const data = (await response
        .json()
        .catch(() => ({}))) as AgentRunResponse;
      activeAgentRunRef.current = null;
      throw new Error(data.error ?? "Agent run failed.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: AgentRunResponse | null = null;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const message = parseAgentStreamMessage(line);

        if (!message) {
          continue;
        }

        if (message.type === "event") {
          setAgentActivity((current) =>
            upsertAgentActivity(current, message.event),
          );
        }

        if (message.type === "result") {
          result = message.result;
        }

        if (message.type === "error") {
          activeAgentRunRef.current = null;
          throw new Error(message.error);
        }
      }
    }

    const trailingMessage = parseAgentStreamMessage(buffer);

    if (trailingMessage?.type === "event") {
      setAgentActivity((current) =>
        upsertAgentActivity(current, trailingMessage.event),
      );
    }

    if (trailingMessage?.type === "result") {
      result = trailingMessage.result;
    }

    activeAgentRunRef.current = null;

    if (!result || result.error) {
      activeAgentRunRef.current = null;
      throw new Error(result?.error ?? "Agent run failed.");
    }

    if (result.project) {
      setActiveProject(result.project);
      setProjects((current) => mergeProject(current, result.project!));
      setActiveFrame("after");
    }

    return result;
  }

  useEffect(() => {
    if (!isReady || !settingsLoaded) {
      return;
    }

    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [isReady, settings, settingsLoaded]);

  useEffect(() => {
    const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const shouldUseDark =
        settings.theme === "dark" ||
        (settings.theme === "system" && systemTheme?.matches);

      document.documentElement.classList.toggle("dark", Boolean(shouldUseDark));
    };

    applyTheme();

    if (settings.theme !== "system" || !systemTheme) {
      return;
    }

    systemTheme.addEventListener("change", applyTheme);

    return () => {
      systemTheme.removeEventListener("change", applyTheme);
    };
  }, [settings.theme]);

  if (!isReady) {
    return (
      <main className="auth-check">
        <Brand />
        <span className="status-pill">
          <SparkIcon /> Checking workspace
        </span>
      </main>
    );
  }

  if (projectSlug && activeProject) {
    return (
      <FigmaWorkspacePage
        activeFrame={activeFrame}
        agentActivity={agentActivity}
        buildProject={buildProject}
        evaluateProject={evaluateProject}
        loadState={loadState}
        project={activeProject}
        setActiveFrame={setActiveFrame}
        onBack={() => {
          setActiveProject(null);
          router.push("/dashboard");
        }}
      />
    );
  }

  return (
    <main className="dashboard-shell">
      <aside aria-label="Primary navigation" className="sidebar">
        <Brand />
        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = iconByNav[item.id];
            const isActive = activeNav === item.id;

            return (
              <button
                aria-current={isActive ? "page" : undefined}
                className={`nav-item ${isActive ? "is-active" : ""}`}
                key={item.id}
                onClick={() => changeSection(item.id)}
                type="button"
              >
                <Icon />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="mini-profile">
            <span>{getInitials(session.email)}</span>
            <div>
              <strong>{session.email}</strong>
              <small>{session.role}</small>
            </div>
          </div>
          <button className="ghost-button" onClick={signOut} type="button">
            Sign out
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">TASTE LAB</p>
            <h1>{activeNav === "dashboard" ? "Dashboard" : "Settings"}</h1>
          </div>
          <div className="topbar-actions">
            <span className="status-pill">
              <CheckIcon /> In-memory backend
            </span>
            <span className="status-pill">
              <SparkIcon /> {averageScore || "Mock"} taste score
            </span>
          </div>
        </header>

        {activeNav === "dashboard" && (
          <DashboardPage
            createProject={createProject}
            loadState={loadState}
            projects={projects}
          />
        )}
        {activeNav === "settings" && (
          <SettingsPage
            session={session}
            settings={settings}
            updateSetting={updateSetting}
          />
        )}
      </section>
    </main>
  );
}

function DashboardPage({
  createProject,
  loadState,
  projects,
}: {
  createProject: (input: {
    name: string;
    type?: string;
    brief?: string;
  }) => Promise<void>;
  loadState: LoadState;
  projects: TasteProject[];
}) {
  return (
    <section className="project-index-grid">
      <ProjectPromptBar createProject={createProject} />

      <article className="project-workspace-panel">
        <header className="project-workspace-header">
          <h2>Your workspace</h2>
          <span className="soft-badge">Process memory only</span>
        </header>

        {loadState === "loading" && (
          <div className="empty-state">
            <strong>Loading projects</strong>
            <span>Fetching the backend project store.</span>
          </div>
        )}

        {loadState === "error" && (
          <div className="empty-state">
            <strong>Backend unavailable</strong>
            <span>Refresh once the Next API routes are running.</span>
          </div>
        )}

        {loadState === "idle" && (
          <div className="project-selector-grid">
            {projects.map((project, index) => (
              <Link
                className="project-selector-card"
                href={`/project/${project.slug}`}
                key={project.slug}
              >
                <div className="project-selector-preview">
                  <ProjectPreview index={index} project={project} />
                </div>
                <div className="project-selector-meta">
                  <div>
                    <strong>{project.name}</strong>
                    <small>{project.status}</small>
                  </div>
                  <span>{project.score}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}

function ProjectPromptBar({
  createProject,
}: {
  createProject: (input: {
    name: string;
    type?: string;
    brief?: string;
  }) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [quipIndex, setQuipIndex] = useState(0);
  const [visibleLength, setVisibleLength] = useState(0);
  const [phase, setPhase] = useState<"typing" | "holding" | "deleting">(
    "typing",
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const quip = projectPromptQuips[quipIndex];
  const animatedQuip = quip.slice(0, visibleLength);
  const isEmpty = value.trim().length === 0;

  useEffect(() => {
    if (!isEmpty) {
      return;
    }

    if (phase === "typing" && visibleLength < quip.length) {
      const timeout = window.setTimeout(
        () => setVisibleLength((current) => current + 1),
        42,
      );

      return () => window.clearTimeout(timeout);
    }

    if (phase === "typing") {
      const timeout = window.setTimeout(() => setPhase("holding"), 1300);

      return () => window.clearTimeout(timeout);
    }

    if (phase === "holding") {
      const timeout = window.setTimeout(() => setPhase("deleting"), 850);

      return () => window.clearTimeout(timeout);
    }

    if (phase === "deleting" && visibleLength > 0) {
      const timeout = window.setTimeout(
        () => setVisibleLength((current) => current - 1),
        24,
      );

      return () => window.clearTimeout(timeout);
    }

    const timeout = window.setTimeout(() => {
      setQuipIndex((current) => {
        const options = projectPromptQuips
          .map((_, index) => index)
          .filter((index) => index !== current);
        const nextOption =
          options[Math.floor(Math.random() * options.length)] ?? 0;

        return nextOption;
      });
      setPhase("typing");
    }, 260);

    return () => window.clearTimeout(timeout);
  }, [isEmpty, phase, quip.length, visibleLength]);

  async function generateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const brief = value.trim();

    if (!brief) {
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      await createProject({
        name: inferProjectName(brief),
        type: "Web app",
        brief,
      });
      setValue("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not create project.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="project-prompt-bar" onSubmit={generateProject}>
      <label className="project-prompt-field">
        <span className="sr-only">Describe a new project</span>
        <input
          aria-label="Describe a new project"
          onChange={(event) => setValue(event.target.value)}
          value={value}
        />
        {isEmpty && (
          <span aria-hidden="true" className="project-prompt-quips">
            {animatedQuip}
            <i />
          </span>
        )}
        {error && <span className="inline-error">{error}</span>}
      </label>
      <button
        aria-label="Generate project"
        disabled={isSubmitting}
        type="submit"
      >
        <ArrowIcon />
      </button>
    </form>
  );
}

function FigmaWorkspacePage({
  activeFrame,
  agentActivity,
  buildProject,
  evaluateProject,
  loadState,
  project,
  setActiveFrame,
  onBack,
}: {
  activeFrame: FrameMode;
  agentActivity: AgentActivityEvent[];
  buildProject: (
    request: string,
    editContext?: EditContext,
    gazeContext?: GazeAgentContext,
    intentOverride?: Exclude<AgentRunIntent, "auto">,
  ) => Promise<void>;
  evaluateProject: () => Promise<void>;
  loadState: LoadState;
  project: TasteProject | null;
  setActiveFrame: (frame: FrameMode) => void;
  onBack: () => void;
}) {
  const [request, setRequest] = useState("");
  const [error, setError] = useState("");
  const [isBuilding, setIsBuilding] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  const [selectedTool, setSelectedTool] = useState<CanvasTool>("move");
  // Camera state for infinite canvas
  const [camera, setCamera] = useState({ x: 0, y: 0, z: 1 }); // x,y = pan, z = zoom
  // True while a continuous camera gesture (wheel zoom, two-finger pan)
  // is happening — used to suppress the camera CSS transition so rapid
  // wheel events don't queue against the ease-out animation.
  const [isCameraInteracting, setIsCameraInteracting] = useState(false);
  const cameraInteractingTimeoutRef = useRef<number | null>(null);
  const markCameraInteracting = () => {
    setIsCameraInteracting(true);
    if (cameraInteractingTimeoutRef.current !== null) {
      window.clearTimeout(cameraInteractingTimeoutRef.current);
    }
    cameraInteractingTimeoutRef.current = window.setTimeout(() => {
      setIsCameraInteracting(false);
      cameraInteractingTimeoutRef.current = null;
    }, 120);
  };
  useEffect(() => {
    return () => {
      if (cameraInteractingTimeoutRef.current !== null) {
        window.clearTimeout(cameraInteractingTimeoutRef.current);
      }
    };
  }, []);
  const [penSettings, setPenSettings] = useState<PenSettings>({
    color: "#333333",
    size: 2,
    opacity: 100,
  });
  const [frameToolKind, setFrameToolKind] = useState<FrameToolKind>("frame");
  const [shapeToolKind, setShapeToolKind] =
    useState<ShapeToolKind>("rectangle");
  const [showFrameToolMenu, setShowFrameToolMenu] = useState(false);
  const [showShapeToolMenu, setShowShapeToolMenu] = useState(false);
  const [selectedFramePresetId, setSelectedFramePresetId] =
    useState("actual-element");
  const [canvasFrame, setCanvasFrame] = useState<CanvasFrameSelection>(
    defaultFrameSelection,
  );
  const [designFrameElement, setDesignFrameElement] =
    useState<HTMLDivElement | null>(null);
  const [actualDesignFrame, setActualDesignFrame] =
    useState<CanvasBounds | null>(null);
  // Authoritative artboard size, in canvas units. The frame element honors
  // these values via inline style; `actualDesignFrame` is then re-measured
  // from the DOM so all coordinate-aware tools stay in sync.
  const [artboardSize, setArtboardSize] = useState<{
    width: number;
    height: number;
    presetId: string | null;
  }>({
    width: defaultArtboardSize.width,
    height: defaultArtboardSize.height,
    presetId: null,
  });
  // Visual properties of the artboard. Together with `artboardSize` these
  // drive the frame DOM element via inline styles and the inspector panel.
  const [artboardName, setArtboardName] = useState<string>("Untitled");
  const [artboardFill, setArtboardFill] = useState<string>("#ffffff");
  const [artboardLockAspect, setArtboardLockAspect] = useState<boolean>(false);
  const [artboardElevation, setArtboardElevation] = useState<boolean>(true);

  // Gaze prediction (UI-only state; the result is rendered as an overlay on
  // the artboard and surfaced in the right inspector panel). Calls go through
  // /api/gaze/* which proxies to the FastAPI backend in apps/api/.
  const [gazeAnalysis, setGazeAnalysis] = useState<GazeAnalysis | null>(null);
  const [gazeBusy, setGazeBusy] = useState<boolean>(false);
  const [gazeError, setGazeError] = useState<string>("");
  const [gazeShowOverlay, setGazeShowOverlay] = useState<boolean>(true);
  const [gazeShowFixations, setGazeShowFixations] = useState<boolean>(true);
  const [gazeApiStatus, setGazeApiStatus] = useState<
    "idle" | "online" | "offline"
  >("idle");

  // Active drag-to-resize gesture on the artboard. Mirrors the element
  // resize state but for the outer frame.
  const [artboardResize, setArtboardResize] = useState<{
    handle: string;
    pointerStart: { x: number; y: number };
    sizeStart: { width: number; height: number };
  } | null>(null);
  const [artboardPresetMenuOpen, setArtboardPresetMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [design, setDesign] = useState<DesignDocument | null>(null);
  const [isPersistingElement, setIsPersistingElement] = useState(false);
  const [isMovingHistory, setIsMovingHistory] = useState(false);

  // Canvas elements state
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null,
  );
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [isLayerSelecting, setIsLayerSelecting] = useState(false);
  const [layerDragSelectedIds, setLayerDragSelectedIds] = useState<string[]>(
    [],
  );
  // Drag-and-drop reorder state for the layer panel.
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [layerDropIndicator, setLayerDropIndicator] = useState<{
    id: string;
    // "above" / "below" reorder as siblings of the target row.
    // "into" reparents the dragged element to be a child of the target
    // (only valid when the target is a folder or virtual view folder).
    position: "above" | "below" | "into";
  } | null>(null);
  // Set of folder ids whose children are visible in the layer panel.
  // Virtual view folders use ids like "view:brief" / "view:draft".
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set<string>(["view:brief", "view:draft"]),
  );

  const toggleFolderExpanded = (folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingStart, setDrawingStart] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [drawingPreviewPoint, setDrawingPreviewPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [currentPath, setCurrentPath] = useState<{ x: number; y: number }[]>(
    [],
  );
  // Active marquee (rubber-band) selection rectangle in canvas-camera
  // coords. Set when the user mousedowns on an empty area with the move
  // tool active; updated on mousemove; cleared (and committed to a
  // selection) on mouseup.
  const [marqueeBox, setMarqueeBox] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    additive: boolean;
    initialIds: string[];
  } | null>(null);
  // Ids that were participating in a multi-element drag, captured at
  // drag start. We persist these on mouseup so the move actually
  // sticks to the design document.
  const [draggingElementIds, setDraggingElementIds] = useState<string[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const frameToolPickerRef = useRef<HTMLDivElement>(null);
  const shapeToolPickerRef = useRef<HTMLDivElement>(null);
  const suppressNextLayerClickRef = useRef(false);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [resizingElementId, setResizingElementId] = useState<string | null>(
    null,
  );
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState<{
    pointerX: number;
    pointerY: number;
    elementX: number;
    elementY: number;
    width: number;
    height: number;
    fontSize?: number;
  } | null>(null);

  const [leftTab, setLeftTab] = useState<"layers" | "assets">("layers");
  const [rightTab, setRightTab] = useState<
    "design" | "agentic" | "prototype" | "inspect"
  >("design");

  // Asset library state. Assets are stored server-side under
  // .local-data/artifacts/projects/{slug}/assets, with metadata in an
  // index.json. We mirror that index here for fast rendering and update
  // it optimistically as the user uploads / renames / deletes.
  const [projectAssets, setProjectAssets] = useState<ProjectAsset[]>([]);
  const [assetsLoadState, setAssetsLoadState] = useState<LoadState>("idle");
  const [assetsError, setAssetsError] = useState<string>("");
  const [assetSearch, setAssetSearch] = useState<string>("");
  const [uploadingAssetCount, setUploadingAssetCount] = useState<number>(0);
  const [renamingAssetId, setRenamingAssetId] = useState<string | null>(null);
  const [renamingAssetName, setRenamingAssetName] = useState<string>("");
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const [isAssetDropTarget, setIsAssetDropTarget] = useState<boolean>(false);
  const [isCanvasAssetTarget, setIsCanvasAssetTarget] =
    useState<boolean>(false);
  const assetFileInputRef = useRef<HTMLInputElement>(null);

  // Which comment is "stickily" open. Hover-opens are tracked in
  // ElementsLayer locally; this one persists until something dismisses it.
  const [openCommentId, setOpenCommentId] = useState<string | null>(null);
  const activeViewId = activeFrame === "before" ? "brief" : "draft";
  const activeDesignView = design?.documentJson.views.find(
    (view) => view.id === activeViewId,
  );
  const designHistory = readDesignHistory(design);
  const canUndoDesign = Boolean(design && design.version > 1);
  const canRedoDesign = designHistory.redoStack.length > 0;
  const agentReferenceImage = getAgentReferenceImage(design);
  const agentReferenceAssets = getAgentReferenceAssets(design);
  const hasDraftReferenceBackground =
    activeFrame === "after" && Boolean(agentReferenceImage);
  const [isCanvasLayerVisible, setIsCanvasLayerVisible] = useState(true);
  const isAgentRunning = project?.runStatus.action === "building";

  useEffect(() => {
    if (!project) {
      return;
    }

    if (isAgentRunning || agentActivity.length > 0) {
      setRightTab("agentic");
    }
  }, [agentActivity.length, isAgentRunning]);

  useEffect(() => {
    setIsCanvasLayerVisible(!hasDraftReferenceBackground);
  }, [
    activeFrame,
    agentReferenceImage?.artifactKey,
    hasDraftReferenceBackground,
    project?.slug,
  ]);

  useEffect(() => {
    if (!designFrameElement || !canvasRef.current) {
      setActualDesignFrame(null);
      return;
    }

    const measureActualDesignFrame = () => {
      if (!canvasRef.current) return;

      const frameRect = designFrameElement.getBoundingClientRect();
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const nextFrame = {
        x: (frameRect.left - canvasRect.left) / camera.z - camera.x,
        y: (frameRect.top - canvasRect.top) / camera.z - camera.y,
        width: frameRect.width / camera.z,
        height: frameRect.height / camera.z,
      };

      setActualDesignFrame((current) =>
        current &&
        Math.round(current.x) === Math.round(nextFrame.x) &&
        Math.round(current.y) === Math.round(nextFrame.y) &&
        Math.round(current.width) === Math.round(nextFrame.width) &&
        Math.round(current.height) === Math.round(nextFrame.height)
          ? current
          : nextFrame,
      );
    };

    measureActualDesignFrame();

    const resizeObserver = new ResizeObserver(measureActualDesignFrame);
    resizeObserver.observe(designFrameElement);
    resizeObserver.observe(canvasRef.current);
    window.addEventListener("resize", measureActualDesignFrame);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measureActualDesignFrame);
    };
  }, [camera.x, camera.y, camera.z, designFrameElement]);

  useEffect(() => {
    if (
      frameToolKind !== "frame" ||
      selectedFramePresetId !== "actual-element" ||
      !actualDesignFrame
    ) {
      return;
    }

    const nextFrame = {
      x: 0,
      y: 0,
      width: Math.round(actualDesignFrame.width),
      height: Math.round(actualDesignFrame.height),
    };

    setCanvasFrame((current) =>
      current.name === "Actual element" &&
      current.x === nextFrame.x &&
      current.y === nextFrame.y &&
      current.width === nextFrame.width &&
      current.height === nextFrame.height
        ? current
        : {
            ...current,
            kind: "frame",
            name: "Actual element",
            ...nextFrame,
          },
    );
  }, [actualDesignFrame, frameToolKind, selectedFramePresetId]);

  const framePresetOptions = useMemo<FramePreset[]>(() => {
    if (!actualDesignFrame) {
      return framePresets;
    }

    return [
      {
        id: "actual-element",
        label: "Actual element",
        group: "Canvas",
        width: Math.round(actualDesignFrame.width),
        height: Math.round(actualDesignFrame.height),
      },
      ...framePresets,
    ];
  }, [actualDesignFrame]);

  const selectElementIds = (elementIds: string[]) => {
    const nextSelectedIds = Array.from(new Set(elementIds));

    setSelectedElementId(nextSelectedIds[0] ?? null);
    setSelectedElementIds(nextSelectedIds);
    setElements((current) =>
      current.map((candidate) => ({
        ...candidate,
        selected: nextSelectedIds.includes(candidate.id),
      })),
    );
  };

  // True when loadDesign has run and resulted in zero elements, so the
  // dashboard preview should be seeded as canvas components once we know
  // where the artboard sits in canvas coordinates.
  const [pendingSeed, setPendingSeed] = useState(false);

  useEffect(() => {
    if (!project) {
      setDesign(null);
      setElements([]);
      setPendingSeed(false);
      return;
    }

    const projectSlug = project.slug;
    let cancelled = false;
    setPendingSeed(false);

    async function loadDesign() {
      try {
        const response = await fetch(
          `/api/projects/${projectSlug}/designs/latest`,
          {
            cache: "no-store",
          },
        );
        const data = (await response.json()) as {
          design?: DesignDocument | null;
        };

        if (cancelled) {
          return;
        }

        if (!response.ok || !data.design) {
          setPendingSeed(true);
          return;
        }

        setDesign(data.design);
        const loaded = elementsFromDocument(data.design.documentJson);
        setElements(loaded);
        setPendingSeed(loaded.length === 0);
      } catch {
        if (!cancelled) {
          setDesign(null);
          setPendingSeed(true);
        }
      }
    }

    void loadDesign();

    return () => {
      cancelled = true;
    };
  }, [project]);

  // Hydrate artboard state (size, fill, corner radius, ...) from
  // `design.documentJson.styles.artboard` whenever the design loads or the
  // agent saves a new version. The agent uses this same field to "set" the
  // artboard via its apply-artboard-settings tool, so the canvas the user
  // sees always tracks what the agent generated against.
  useEffect(() => {
    if (!design) {
      return;
    }
    const settings = readArtboardFromDesign(design);
    if (!settings) {
      return;
    }
    setArtboardSize((current) =>
      current.width === settings.width &&
      current.height === settings.height &&
      current.presetId === settings.presetId
        ? current
        : {
            width: settings.width,
            height: settings.height,
            presetId: settings.presetId,
          },
    );
    setArtboardName((current) =>
      settings.name && settings.name !== current ? settings.name : current,
    );
    setArtboardFill((current) =>
      settings.fill && settings.fill !== current ? settings.fill : current,
    );
    // Note: we deliberately ignore `settings.fillOpacity` and
    // `settings.cornerRadius` from the design doc — the artboard is
    // always 100% opaque with square corners. Those values are still
    // available for elements *on* the canvas via their own styles.
    setArtboardElevation((current) =>
      typeof settings.elevation === "boolean" && settings.elevation !== current
        ? settings.elevation
        : current,
    );
  }, [design]);

  // Load the asset library whenever the active project changes. Assets are
  // independent of the design document, so we fetch them in their own
  // effect and let the panel render placeholders/errors as needed.
  useEffect(() => {
    if (!project) {
      setProjectAssets([]);
      setAssetsLoadState("idle");
      return;
    }
    void refreshProjectAssets(project.slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.slug]);

  // Probe the gaze backend so the inspector can label itself as online /
  // offline before the user clicks "Predict gaze". This is best-effort —
  // we silently fall through if the backend isn't running.
  useEffect(() => {
    void pingGazeApi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed the canvas with decomposed dashboard elements (text boxes for
  // headings/labels, rectangles for buttons and proof cards) once we know
  // where the artboard lands in canvas space and there's nothing already
  // loaded from the design document.
  useEffect(() => {
    if (!pendingSeed) return;
    if (!project) return;
    if (!actualDesignFrame) return;

    const seed = buildDashboardSeedElements(project, {
      x: 0,
      y: 0,
      width: actualDesignFrame.width,
      height: actualDesignFrame.height,
    });
    setPendingSeed(false);
    if (seed.length > 0) {
      setElements(seed);
    }
  }, [pendingSeed, project, actualDesignFrame]);

  useEffect(() => {
    if (!showFrameToolMenu) {
      return;
    }

    const closeFrameToolMenu = (event: PointerEvent) => {
      if (
        frameToolPickerRef.current &&
        event.target instanceof Node &&
        frameToolPickerRef.current.contains(event.target)
      ) {
        return;
      }

      setShowFrameToolMenu(false);
    };

    document.addEventListener("pointerdown", closeFrameToolMenu);
    return () =>
      document.removeEventListener("pointerdown", closeFrameToolMenu);
  }, [showFrameToolMenu]);

  useEffect(() => {
    if (!showShapeToolMenu) {
      return;
    }

    const closeShapeToolMenu = (event: PointerEvent) => {
      if (
        shapeToolPickerRef.current &&
        event.target instanceof Node &&
        shapeToolPickerRef.current.contains(event.target)
      ) {
        return;
      }

      setShowShapeToolMenu(false);
    };

    document.addEventListener("pointerdown", closeShapeToolMenu);
    return () =>
      document.removeEventListener("pointerdown", closeShapeToolMenu);
  }, [showShapeToolMenu]);

  useEffect(() => {
    if (!isLayerSelecting) {
      return;
    }

    const endLayerSelection = () => {
      setIsLayerSelecting(false);
      setLayerDragSelectedIds([]);
    };

    window.addEventListener("pointerup", endLayerSelection);
    window.addEventListener("blur", endLayerSelection);

    return () => {
      window.removeEventListener("pointerup", endLayerSelection);
      window.removeEventListener("blur", endLayerSelection);
    };
  }, [isLayerSelecting]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent shortcuts when typing
      if (
        editingElementId ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Delete selected elements
      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        (selectedElementIds.length > 0 || selectedElementId)
      ) {
        e.preventDefault();
        const idsToDelete =
          selectedElementIds.length > 0
            ? selectedElementIds
            : selectedElementId
              ? [selectedElementId]
              : [];
        void deleteDesignElements(idsToDelete);
        return;
      }

      // Deselect
      if (
        e.key === "Escape" &&
        (selectedElementIds.length > 0 ||
          selectedElementId ||
          marqueeBox ||
          isDragging)
      ) {
        e.preventDefault();
        setSelectedElementId(null);
        setSelectedElementIds([]);
        setElements((current) =>
          current.map((el) => ({ ...el, selected: false })),
        );
        // Cancel any in-flight rubber-band or multi-element drag.
        setMarqueeBox(null);
        setDraggingElementIds([]);
        setIsDragging(false);
        setDrawingStart(null);
        return;
      }

      // Tool shortcuts
      if (!e.metaKey && !e.ctrlKey) {
        switch (e.key.toLowerCase()) {
          case "v": // Move tool
          case "1":
            setSelectedTool("move");
            break;
          case "h": // Hand tool
          case " ": // Spacebar
            setSelectedTool("hand");
            break;
          case "f": // Frame tool
            setSelectedTool("frame");
            break;
          case "r": // Rectangle/shape tool
            setSelectedTool("shape");
            setShapeToolKind("rectangle");
            break;
          case "l": // Line tool
            setSelectedTool("shape");
            setShapeToolKind("line");
            break;
          case "o": // Ellipse tool
            setSelectedTool("shape");
            setShapeToolKind("ellipse");
            break;
          case "p": // Pen tool
            setSelectedTool("pen");
            break;
          case "e": // Eraser tool
            setSelectedTool("eraser");
            break;
          case "t": // Text tool
            setSelectedTool("text");
            break;
          case "c": // Comment tool
            setSelectedTool("comment");
            break;
        }
      }

      // Zoom shortcuts
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        switch (e.key) {
          case "0": // Reset zoom
            e.preventDefault();
            setCamera({ x: 0, y: 0, z: 1 });
            break;
          case "=":
          case "+":
            e.preventDefault();
            setCamera((prev) => ({ ...prev, z: Math.min(5, prev.z + 0.1) }));
            break;
          case "-":
            e.preventDefault();
            setCamera((prev) => ({ ...prev, z: Math.max(0.1, prev.z - 0.1) }));
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    design,
    editingElementId,
    elements,
    project,
    selectedElementId,
    selectedElementIds,
  ]);

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = (screenX: number, screenY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (screenX - rect.left) / camera.z - camera.x,
      y: (screenY - rect.top) / camera.z - camera.y,
    };
  };

  const screenToArtboard = (
    screenX: number,
    screenY: number,
    options: { clamp?: boolean } = {},
  ) => {
    const canvasPoint = screenToCanvas(screenX, screenY);
    if (!actualDesignFrame) {
      return { ...canvasPoint, inside: true };
    }

    const localPoint = {
      x: canvasPoint.x - actualDesignFrame.x,
      y: canvasPoint.y - actualDesignFrame.y,
    };
    const inside =
      localPoint.x >= 0 &&
      localPoint.y >= 0 &&
      localPoint.x <= actualDesignFrame.width &&
      localPoint.y <= actualDesignFrame.height;

    if (!options.clamp) {
      return { ...localPoint, inside };
    }

    return {
      x: Math.max(0, Math.min(actualDesignFrame.width, localPoint.x)),
      y: Math.max(0, Math.min(actualDesignFrame.height, localPoint.y)),
      inside,
    };
  };

  // Convert canvas coordinates to screen coordinates
  const canvasToScreen = (canvasX: number, canvasY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (canvasX + camera.x) * camera.z + rect.left,
      y: (canvasY + camera.y) * camera.z + rect.top,
    };
  };

  const constrainElementToArtboard = (
    element: CanvasElement,
  ): CanvasElement => {
    if (
      !actualDesignFrame ||
      element.type === "line" ||
      element.type === "arrow" ||
      element.type === "path"
    ) {
      return element;
    }

    const width = Math.min(element.width ?? 100, actualDesignFrame.width);
    const height = Math.min(element.height ?? 100, actualDesignFrame.height);

    return {
      ...element,
      x: Math.max(0, Math.min(actualDesignFrame.width - width, element.x)),
      y: Math.max(0, Math.min(actualDesignFrame.height - height, element.y)),
      width,
      height,
    };
  };

  const resizeSelectedElementAt = (x: number, y: number) => {
    if (!resizingElementId || !resizeStart || !resizeHandle) {
      return;
    }

    const resizeDirection = getResizeDirection(resizeHandle);

    setElements((currentElements) => {
      const element = currentElements.find((el) => el.id === resizingElementId);

      if (!element) {
        return currentElements;
      }

      if (!isResizableCanvasElementType(element.type)) {
        return currentElements;
      }

      const updates = getResizedElementGeometry(element, resizeDirection, {
        pointerX: x,
        pointerY: y,
        start: resizeStart,
      });

      return currentElements.map((el) =>
        el.id === resizingElementId
          ? constrainElementToArtboard({ ...el, ...updates })
          : el,
      );
    });
  };

  const endResize = () => {
    if (resizingElementId) {
      const resizedElement = elements.find(
        (element) => element.id === resizingElementId,
      );
      if (resizedElement) {
        void updateDesignElement(resizedElement);
      }
    }
    setResizingElementId(null);
    setResizeHandle(null);
    setResizeStart(null);
  };

  // Artboard resize: the frame is laid out CSS-centered inside its column,
  // so growing width/height grows the frame symmetrically (half on each
  // side). To make the dragged edge follow the cursor exactly, we apply a
  // 2x amplification: dragging an edge by ∆ canvas-units increases the
  // matching dimension by 2∆ so the new edge lands under the cursor.
  const ARTBOARD_MIN_WIDTH = 200;
  const ARTBOARD_MIN_HEIGHT = 200;

  const startArtboardResize = (
    handle: string,
    clientX: number,
    clientY: number,
  ) => {
    const pointer = screenToCanvas(clientX, clientY);
    setArtboardResize({
      handle,
      pointerStart: pointer,
      sizeStart: { width: artboardSize.width, height: artboardSize.height },
    });
  };

  const resizeArtboardAt = (clientX: number, clientY: number) => {
    setArtboardResize((current) => {
      if (!current) return current;
      const pointer = screenToCanvas(clientX, clientY);
      const dx = pointer.x - current.pointerStart.x;
      const dy = pointer.y - current.pointerStart.y;
      const handle = current.handle;

      let nextWidth = current.sizeStart.width;
      let nextHeight = current.sizeStart.height;

      if (handle.includes("e")) nextWidth = current.sizeStart.width + 2 * dx;
      if (handle.includes("w")) nextWidth = current.sizeStart.width - 2 * dx;
      if (handle.includes("s")) nextHeight = current.sizeStart.height + 2 * dy;
      if (handle.includes("n")) nextHeight = current.sizeStart.height - 2 * dy;

      // Aspect lock: keep width / height ratio fixed during the gesture.
      // We use the dimension whose change is larger relative to the start
      // size as the "driver" so corner / side handles behave naturally.
      if (artboardLockAspect && current.sizeStart.height > 0) {
        const ratio = current.sizeStart.width / current.sizeStart.height;
        const widthDelta = Math.abs(nextWidth - current.sizeStart.width);
        const heightDelta = Math.abs(nextHeight - current.sizeStart.height);
        const widthIsDriver =
          handle === "e-resize" ||
          handle === "w-resize" ||
          (handle.length === 9 && widthDelta >= heightDelta * ratio);
        if (widthIsDriver) {
          nextHeight = nextWidth / ratio;
        } else {
          nextWidth = nextHeight * ratio;
        }
      }

      nextWidth = Math.max(ARTBOARD_MIN_WIDTH, Math.round(nextWidth));
      nextHeight = Math.max(ARTBOARD_MIN_HEIGHT, Math.round(nextHeight));

      setArtboardSize((prev) =>
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight, presetId: null },
      );

      return current;
    });
  };

  const endArtboardResize = () => {
    setArtboardResize(null);
  };

  // Window-level listeners while a resize gesture is active, so the user
  // can drag past the handle / outside the canvas without losing the grip.
  useEffect(() => {
    if (!artboardResize) return;
    const handleMove = (event: MouseEvent) => {
      event.preventDefault();
      resizeArtboardAt(event.clientX, event.clientY);
    };
    const handleUp = () => {
      endArtboardResize();
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  });

  // Apply a preset by id. The match looks the preset up in the table; an
  // unknown id is treated as a custom size (the picker closes regardless).
  const applyArtboardPreset = (preset: ArtboardPreset) => {
    setArtboardSize({
      width: preset.width,
      height: preset.height,
      presetId: preset.id,
    });
    setArtboardPresetMenuOpen(false);
  };

  const deletePathElementAt = (x: number, y: number) => {
    const visiblePaths = elements.filter(
      (element) =>
        element.type === "path" &&
        element.points &&
        element.points.length > 1 &&
        (!element.viewId || element.viewId === activeViewId),
    );
    const hitPath = [...visiblePaths]
      .reverse()
      .find((element) => isPointNearPath({ x, y }, element));

    if (!hitPath) {
      return;
    }

    void deleteDesignElements([hitPath.id]);
  };

  useEffect(() => {
    if (!resizingElementId || !resizeStart || !resizeHandle) {
      return;
    }

    const handleWindowMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      const { x, y } = screenToArtboard(event.clientX, event.clientY, {
        clamp: true,
      });
      resizeSelectedElementAt(x, y);
    };

    const handleWindowMouseUp = () => {
      endResize();
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    // Only react to primary button to avoid right-click weirdness.
    if (e.button !== 0) return;
    const { x, y, inside } = screenToArtboard(e.clientX, e.clientY);

    // Any mousedown that reaches the canvas (i.e. wasn't stopped by a
    // comment pin or popover) dismisses any sticky-open comment.
    if (openCommentId) {
      setOpenCommentId(null);
    }

    if (selectedTool === "hand") {
      setIsDragging(true);
    } else if (selectedTool === "eraser") {
      if (!inside) return;
      setIsDragging(true);
      deletePathElementAt(x, y);
    } else if (selectedTool === "move") {
      if (!inside) {
        setSelectedElementId(null);
        setSelectedElementIds([]);
        setElements(elements.map((el) => ({ ...el, selected: false })));
        return;
      }
      // Topmost element first (last drawn is rendered on top). Comments
      // are not part of the regular selection model — they have their own
      // pin/popover interaction surface in ElementsLayer.
      const visibleElements = elements.filter(
        (element) =>
          element.type !== "comment" &&
          element.type !== "folder" &&
          !element.locked &&
          (!element.viewId || element.viewId === activeViewId),
      );
      const clickedElement = [...visibleElements].reverse().find((el) => {
        const b = getElementBounds(el);
        return (
          x >= b.x && y >= b.y && x <= b.x + b.width && y <= b.y + b.height
        );
      });

      const isAdditive = e.shiftKey;

      if (clickedElement) {
        let nextIds: string[];
        if (isAdditive) {
          // Shift-click toggles the clicked element in/out of the
          // selection without disturbing the rest. We don't start a
          // drag in this case — the user is curating selection.
          nextIds = selectedElementIds.includes(clickedElement.id)
            ? selectedElementIds.filter((id) => id !== clickedElement.id)
            : [...selectedElementIds, clickedElement.id];
          selectElementIds(nextIds);
          // No drag setup; user is still building the selection.
          return;
        } else if (selectedElementIds.includes(clickedElement.id)) {
          // Clicking an already-selected element preserves the
          // multi-selection so the user can drag the whole group.
          nextIds = selectedElementIds;
        } else {
          // Replace selection with just this element.
          nextIds = [clickedElement.id];
          selectElementIds(nextIds);
        }
        setDraggingElementIds(nextIds);
        setIsDragging(true);
        setDrawingStart({ x, y });
      } else {
        // Empty canvas — start a marquee. Holding shift extends the
        // current selection instead of replacing it.
        if (!isAdditive) {
          selectElementIds([]);
        }
        setMarqueeBox({
          startX: x,
          startY: y,
          endX: x,
          endY: y,
          additive: isAdditive,
          initialIds: isAdditive ? selectedElementIds : [],
        });
        setIsDragging(true);
        setDrawingStart({ x, y });
      }
    } else if (selectedTool === "frame" || selectedTool === "shape") {
      if (!inside) return;
      if (selectedTool === "shape") {
        const visibleElements = elements.filter(
          (element) =>
            isShapeElementType(element.type) &&
            (!element.viewId || element.viewId === activeViewId),
        );
        const clickedShape = [...visibleElements].reverse().find((element) => {
          const bounds = getElementBounds(element);
          return (
            x >= bounds.x &&
            y >= bounds.y &&
            x <= bounds.x + bounds.width &&
            y <= bounds.y + bounds.height
          );
        });

        if (clickedShape) {
          selectElementIds([clickedShape.id]);
          return;
        }
      }

      setIsDrawing(true);
      setDrawingStart({ x, y });
    } else if (selectedTool === "text") {
      if (!inside) return;
      setIsDrawing(true);
      setDrawingStart({ x, y });
    } else if (selectedTool === "pen") {
      if (!inside) return;
      setIsDrawing(true);
      setDrawingStart({ x, y });
      setCurrentPath([{ x, y }]);
    } else if (selectedTool === "comment") {
      if (!inside) return;
      // Click-to-pin or drag-to-region. We finalize on mouseup so a
      // single click yields a point comment and a drag yields a region
      // comment, just like Figma's commenting tool.
      setIsDrawing(true);
      setDrawingStart({ x, y });
      setDrawingPreviewPoint({ x, y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const shouldClampToArtboard =
      Boolean(resizingElementId) ||
      isDrawing ||
      (selectedTool !== "hand" && isDragging);
    const { x, y, inside } = screenToArtboard(e.clientX, e.clientY, {
      clamp: shouldClampToArtboard,
    });

    if (resizingElementId && resizeStart && resizeHandle) {
      resizeSelectedElementAt(x, y);
    } else if (selectedTool === "eraser" && isDragging) {
      if (!inside) return;
      deletePathElementAt(x, y);
    } else if (selectedTool === "hand" && isDragging) {
      // "Grab the page": the canvas follows the cursor, so dragging
      // right physically moves the page right on screen. Because the
      // camera transform is scale(z) * translate(camera.x, camera.y),
      // increasing camera.x shifts the content right.
      setCamera((prev) => ({
        ...prev,
        x: prev.x + e.movementX / prev.z,
        y: prev.y + e.movementY / prev.z,
      }));
    } else if (selectedTool === "move" && isDragging && marqueeBox) {
      // Active rubber-band selection — just update the trailing corner.
      // Final selection is committed on mouseup.
      setMarqueeBox((current) =>
        current
          ? {
              ...current,
              endX: x,
              endY: y,
            }
          : current,
      );
    } else if (
      selectedTool === "move" &&
      isDragging &&
      draggingElementIds.length > 0 &&
      drawingStart
    ) {
      const dx = x - drawingStart.x;
      const dy = y - drawingStart.y;
      const movingIds = new Set(draggingElementIds);
      setElements(
        elements.map((el) =>
          movingIds.has(el.id)
            ? constrainElementToArtboard({ ...el, x: el.x + dx, y: el.y + dy })
            : el,
        ),
      );
      setDrawingStart({ x, y });
    } else if (isDrawing && drawingStart) {
      setDrawingPreviewPoint({ x, y });
      if (selectedTool === "frame" || selectedTool === "shape") {
        // Preview logic could be added here
      } else if (selectedTool === "pen") {
        setCurrentPath((path) => [...path, { x, y }]);
      }
    }
  };

  // Handle wheel events for zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!canvasRef.current) return;

    // Mark that the user is actively manipulating the camera so the
    // canvas-camera CSS transition can be suppressed for the duration
    // of the gesture (otherwise the 100ms ease-out queues up against
    // 60Hz wheel events and feels stuttery).
    markCameraInteracting();

    if (e.ctrlKey || e.metaKey) {
      // Zoom toward the cursor: keep the canvas point currently under
      // the cursor pinned to the same screen position after zooming.
      const rect = canvasRef.current.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      setCamera((prev) => {
        // Exponential zoom — multiplicative, so each "tick" of wheel
        // scroll changes zoom by a fixed proportion regardless of the
        // current zoom level. Tuned so a typical mouse-wheel tick
        // (deltaY ≈ 100) zooms by ~18% and trackpad pinches feel
        // continuous.
        const zoomFactor = Math.exp(-e.deltaY / 500);
        const newZoom = Math.max(0.1, Math.min(5, prev.z * zoomFactor));
        // Canvas point under the cursor before zoom.
        const canvasX = cursorX / prev.z - prev.x;
        const canvasY = cursorY / prev.z - prev.y;
        // Solve for new camera so that point is still at (cursorX, cursorY)
        // under the screenToCanvas / canvas-camera transform.
        return {
          z: newZoom,
          x: cursorX / newZoom - canvasX,
          y: cursorY / newZoom - canvasY,
        };
      });
    } else {
      // Two-finger pan.
      setCamera((prev) => ({
        ...prev,
        x: prev.x - e.deltaX / prev.z,
        y: prev.y - e.deltaY / prev.z,
      }));
    }
  };

  async function createDesignElement(element: CanvasElement) {
    if (!design || !project) {
      setError("Design document is still loading.");
      return;
    }

    const projectSlug = project.slug;
    const node = canvasElementToNode(element, activeViewId);

    setIsPersistingElement(true);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectSlug}/designs/${design.version}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation: "append-node", node }),
        },
      );
      const data = (await response.json()) as {
        design?: DesignDocument;
        error?: string;
      };

      if (!response.ok || !data.design) {
        throw new Error(data.error ?? "Could not create canvas element.");
      }

      setDesign(data.design);
      setElements(
        elementsFromDocument(data.design.documentJson).map((current) => ({
          ...current,
          selected: current.id === element.id,
        })),
      );
      setSelectedElementId(element.id);
      setSelectedElementIds([element.id]);
      setSelectedTool("move");
      setShowFrameToolMenu(false);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not create canvas element.",
      );
    } finally {
      setIsPersistingElement(false);
    }
  }

  async function updateDesignElement(element: CanvasElement) {
    if (!design || !project) {
      return;
    }

    if (!design.documentJson.nodes.some((node) => node.id === element.id)) {
      return;
    }

    const node = canvasElementToNode(element, element.viewId ?? activeViewId);

    try {
      const response = await fetch(
        `/api/projects/${project.slug}/designs/${design.version}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "update-node",
            nodeId: element.id,
            bounds: node.bounds,
            props: node.props,
            name: node.name,
          }),
        },
      );
      const data = (await response.json()) as {
        design?: DesignDocument;
        error?: string;
      };

      if (!response.ok || !data.design) {
        throw new Error(data.error ?? "Could not update canvas element.");
      }

      setDesign(data.design);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not update canvas element.",
      );
    }
  }

  async function deleteDesignElements(elementIds: string[]) {
    const idsToDelete = Array.from(new Set(elementIds)).filter(Boolean);
    if (idsToDelete.length === 0) return;

    const idSet = new Set(idsToDelete);
    const previousElements = elements;
    // When folders are deleted, detach their children up one level so they
    // aren't orphaned (parentId pointing at a missing folder hides the row).
    // Children inherit the deleted folder's parent so the hierarchy is
    // preserved minus the deleted node.
    const parentRedirect = new Map<string, string | undefined>();
    for (const el of elements) {
      if (idSet.has(el.id) && el.type === "folder") {
        parentRedirect.set(el.id, el.parentId);
      }
    }
    const nextElements = elements
      .filter((element) => !idSet.has(element.id))
      .map((element) => {
        if (element.parentId && parentRedirect.has(element.parentId)) {
          let newParent: string | undefined = parentRedirect.get(
            element.parentId,
          );
          // Walk up if multiple ancestors are being deleted.
          while (newParent && parentRedirect.has(newParent)) {
            newParent = parentRedirect.get(newParent);
          }
          return { ...element, parentId: newParent };
        }
        return element;
      });

    setElements(nextElements);
    setSelectedElementId(null);
    setSelectedElementIds([]);
    setEditingElementId((current) =>
      current && idSet.has(current) ? null : current,
    );

    const persistedIds = idsToDelete.filter((elementId) =>
      design?.documentJson.nodes.some((node) => node.id === elementId),
    );

    if (!project || !design || persistedIds.length === 0) {
      return;
    }

    try {
      const response = await fetch(
        `/api/projects/${project.slug}/designs/${design.version}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "remove-nodes",
            nodeIds: persistedIds,
          }),
        },
      );
      const data = (await response.json()) as {
        design?: DesignDocument;
        error?: string;
      };

      if (!response.ok || !data.design) {
        throw new Error(data.error ?? "Could not delete canvas elements.");
      }

      setDesign(data.design);
      setElements(elementsFromDocument(data.design.documentJson));
    } catch (nextError) {
      setElements(previousElements);
      setSelectedElementId(idsToDelete[0] ?? null);
      setSelectedElementIds(idsToDelete);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not delete canvas elements.",
      );
    }
  }

  async function moveDesignHistory(direction: "undo" | "redo") {
    if (!project || !design || isMovingHistory) {
      return;
    }

    setIsMovingHistory(true);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${project.slug}/designs/history`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ direction }),
        },
      );
      const data = (await response.json()) as {
        design?: DesignDocument;
        error?: string;
      };

      if (!response.ok || !data.design) {
        throw new Error(data.error ?? `Could not ${direction}.`);
      }

      setDesign(data.design);
      setElements(elementsFromDocument(data.design.documentJson));
      setSelectedElementId(null);
      setSelectedElementIds([]);
      setEditingElementId(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : `Could not ${direction}.`,
      );
    } finally {
      setIsMovingHistory(false);
    }
  }

  // -- Gaze prediction --------------------------------------------------
  //
  // Capture the artboard region (background + every overlapping canvas
  // element) into a PNG blob suitable for posting to the model.
  //
  // The artboard `<div>` is a sibling of <ElementsLayer>, so we have to
  // capture the whole `.canvas-camera` and crop down. We override the
  // camera's CSS transform during the html-to-image render so the captured
  // pixels are at the design's natural resolution regardless of zoom.
  async function captureArtboardPng(): Promise<{
    blob: Blob;
    width: number;
    height: number;
  } | null> {
    const cameraEl = canvasRef.current?.querySelector(
      ".canvas-camera",
    ) as HTMLDivElement | null;
    if (!cameraEl || !designFrameElement) {
      return null;
    }

    // Find where the artboard sits inside the camera at scale 1. Because the
    // camera's only transform is scale(z) translate(x, y), dividing the
    // current screen-space rect by z recovers the natural-space rect.
    const cameraRect = cameraEl.getBoundingClientRect();
    const artRect = designFrameElement.getBoundingClientRect();
    const z = camera.z || 1;
    const nx = (artRect.left - cameraRect.left) / z;
    const ny = (artRect.top - cameraRect.top) / z;
    const nw = Math.max(1, Math.round(artRect.width / z));
    const nh = Math.max(1, Math.round(artRect.height / z));

    const { toCanvas } = await import("html-to-image");
    const rasterized = await toCanvas(cameraEl, {
      pixelRatio: 1,
      cacheBust: true,
      // Force the cloned camera to render at scale 1, untranslated. The
      // children layouts don't depend on the transform so their offsets
      // align with our nx/ny/nw/nh.
      style: { transform: "none" },
    });

    const cropped = document.createElement("canvas");
    cropped.width = nw;
    cropped.height = nh;
    const ctx = cropped.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(
      rasterized,
      Math.round(nx),
      Math.round(ny),
      nw,
      nh,
      0,
      0,
      nw,
      nh,
    );

    const blob = await new Promise<Blob | null>((resolve) =>
      cropped.toBlob(resolve, "image/png"),
    );
    if (!blob) return null;
    return { blob, width: nw, height: nh };
  }

  async function pingGazeApi(): Promise<"online" | "offline"> {
    try {
      const res = await fetch("/api/gaze/health", { cache: "no-store" });
      const next: "online" | "offline" = res.ok ? "online" : "offline";
      setGazeApiStatus(next);
      return next;
    } catch {
      setGazeApiStatus("offline");
      return "offline";
    }
  }

  async function runGazePrediction() {
    setGazeError("");
    setGazeBusy(true);
    try {
      const captured = await captureArtboardPng();
      if (!captured) {
        throw new Error(
          "Could not capture the artboard. Make sure a frame is visible.",
        );
      }
      const form = new FormData();
      form.append("image", captured.blob, "artboard.png");
      form.append("n_frames", "90");
      form.append("fps", "30");
      form.append("max_fixations", "32");

      const response = await fetch("/api/gaze/scanpath", {
        method: "POST",
        body: form,
      });
      const text = await response.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // Non-JSON error responses (e.g., HTML error pages) fall through.
      }
      if (!response.ok) {
        const detail =
          (data && (data.detail || data.error)) || `HTTP ${response.status}`;
        throw new Error(String(detail));
      }
      if (!data) {
        throw new Error("Gaze API returned no JSON.");
      }

      const next: GazeAnalysis = {
        width: Number(data.width ?? captured.width),
        height: Number(data.height ?? captured.height),
        fps: Number(data.fps ?? 30),
        n_frames: Number(data.n_frames ?? 0),
        gaze_sequence:
          (data.gaze_sequence as GazeAnalysis["gaze_sequence"]) ?? [],
        fixations: (data.fixations as GazeFixation[]) ?? [],
        heatmap_b64: String(data.heatmap_b64 ?? ""),
        overlay_b64: String(data.overlay_b64 ?? ""),
        elapsed_ms:
          typeof data.elapsed_ms === "number" ? data.elapsed_ms : undefined,
        generatedAt: Date.now(),
      };

      setGazeAnalysis(next);
      setGazeShowOverlay(true);
      setGazeShowFixations(true);
      setGazeApiStatus("online");
    } catch (nextError) {
      setGazeError(
        nextError instanceof Error
          ? nextError.message
          : "Gaze prediction failed.",
      );
      // If the proxy bubbled a connection refused, mark offline so the UI
      // can show "start the backend" guidance.
      if (
        nextError instanceof Error &&
        /reach gaze API|fetch failed|ECONNREFUSED/i.test(nextError.message)
      ) {
        setGazeApiStatus("offline");
      }
    } finally {
      setGazeBusy(false);
    }
  }

  function clearGazeAnalysis() {
    setGazeAnalysis(null);
    setGazeError("");
  }

  async function passGazeIntoAgent(additionalInfo?: string) {
    if (!gazeAnalysis) {
      return;
    }

    setError("");
    setIsBuilding(true);

    try {
      await buildProject(
        [
          "Improve the current design using the attached gaze prediction.",
          "Make a broad pass that clarifies the first read, strengthens the primary action path, reduces wasted attention, and preserves the core brief and visual system.",
          additionalInfo?.trim()
            ? `User priority for this gaze pass: ${additionalInfo.trim()}`
            : "Propose and apply concrete hierarchy, contrast, spacing, copy, and layout changes based on the gaze evidence.",
        ].join(" "),
        undefined,
        createGazeAgentContext(gazeAnalysis, additionalInfo),
        "build",
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Gaze-guided agent run failed.",
      );
    } finally {
      setIsBuilding(false);
    }
  }

  async function refreshProjectAssets(slug: string) {
    setAssetsLoadState("loading");
    setAssetsError("");
    try {
      const response = await fetch(`/api/projects/${slug}/assets`);
      const data = (await response.json()) as {
        assets?: ProjectAsset[];
        error?: string;
      };
      if (!response.ok || !data.assets) {
        throw new Error(data.error ?? "Could not load assets.");
      }
      setProjectAssets(data.assets);
      setAssetsLoadState("idle");
    } catch (nextError) {
      setAssetsLoadState("error");
      setAssetsError(
        nextError instanceof Error
          ? nextError.message
          : "Could not load assets.",
      );
    }
  }

  // Read a File and resolve with its natural width/height. We do this in
  // the browser so the server doesn't need an image-decoding dependency.
  function readImageDimensions(file: File) {
    return new Promise<{ width: number; height: number }>((resolve) => {
      if (!file.type.startsWith("image/")) {
        resolve({ width: 1, height: 1 });
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        // SVGs may not expose intrinsic size; fall back to a reasonable
        // default so downstream layout always has something to work with.
        resolve({
          width: img.naturalWidth || img.width || 320,
          height: img.naturalHeight || img.height || 240,
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ width: 320, height: 240 });
      };
      img.src = url;
    });
  }

  async function uploadAssetFiles(files: File[]) {
    if (!project || files.length === 0) return;
    const slug = project.slug;
    setUploadingAssetCount((count) => count + files.length);
    setAssetsError("");
    try {
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          setAssetsError(`Skipped non-image file: ${file.name}`);
          continue;
        }
        try {
          const { width, height } = await readImageDimensions(file);
          const form = new FormData();
          form.append("file", file);
          form.append(
            "name",
            file.name.replace(/\.[^.]+$/, "") || "Untitled asset",
          );
          form.append("width", String(width));
          form.append("height", String(height));
          const response = await fetch(`/api/projects/${slug}/assets`, {
            method: "POST",
            body: form,
          });
          const data = (await response.json()) as {
            asset?: ProjectAsset;
            error?: string;
          };
          if (!response.ok || !data.asset) {
            throw new Error(data.error ?? "Upload failed.");
          }
          setProjectAssets((current) => [data.asset!, ...current]);
        } catch (nextError) {
          setAssetsError(
            nextError instanceof Error ? nextError.message : "Upload failed.",
          );
        }
      }
    } finally {
      setUploadingAssetCount((count) => Math.max(0, count - files.length));
    }
  }

  async function deleteProjectAsset(assetId: string) {
    if (!project) return;
    const slug = project.slug;
    const previous = projectAssets;
    setProjectAssets((current) => current.filter((a) => a.id !== assetId));
    try {
      const response = await fetch(`/api/projects/${slug}/assets/${assetId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Could not delete asset.");
      }
    } catch (nextError) {
      setProjectAssets(previous);
      setAssetsError(
        nextError instanceof Error
          ? nextError.message
          : "Could not delete asset.",
      );
    }
  }

  async function commitAssetRename(assetId: string, nextName: string) {
    if (!project) return;
    const trimmed = nextName.trim();
    if (!trimmed) {
      setRenamingAssetId(null);
      return;
    }
    const slug = project.slug;
    const previous = projectAssets;
    setProjectAssets((current) =>
      current.map((a) => (a.id === assetId ? { ...a, name: trimmed } : a)),
    );
    setRenamingAssetId(null);
    try {
      const response = await fetch(`/api/projects/${slug}/assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Could not rename asset.");
      }
    } catch (nextError) {
      setProjectAssets(previous);
      setAssetsError(
        nextError instanceof Error
          ? nextError.message
          : "Could not rename asset.",
      );
    }
  }

  // Drop an asset onto the artboard (or click-to-place). The image is sized
  // to fit a 480px box while preserving aspect ratio so that big images
  // don't immediately blow past the artboard. Coordinates are expressed
  // in artboard-local units after running through screenToArtboard, so the new
  // element appears under the user's cursor regardless of zoom/pan.
  function placeAssetAtArtboardPoint(
    asset: ProjectAsset,
    artboardX: number,
    artboardY: number,
  ) {
    const maxDimension = 480;
    const aspect =
      asset.height > 0 && asset.width > 0 ? asset.height / asset.width : 1;
    const width =
      asset.width > maxDimension
        ? maxDimension
        : asset.width > 0
          ? asset.width
          : 320;
    const height = Math.max(1, Math.round(width * aspect));

    const newImage: CanvasElement = constrainElementToArtboard({
      id: `image-${Date.now()}`,
      type: "image",
      viewId: activeViewId,
      name: asset.name,
      artifactKey: asset.artifactKey,
      objectFit: "contain",
      alt: asset.name,
      x: Math.round(artboardX - width / 2),
      y: Math.round(artboardY - height / 2),
      width,
      height,
      style: {
        fill: "transparent",
        stroke: "transparent",
        strokeWidth: 0,
        opacity: 1,
      },
    });
    setElements([
      ...elements.map((el) => ({ ...el, selected: false })),
      newImage,
    ]);
    setSelectedElementId(newImage.id);
    setSelectedElementIds([newImage.id]);
    void createDesignElement(newImage);
  }

  function placeReferenceAsset(asset: ReferenceAsset) {
    if (!asset.artifactKey) {
      setError(
        asset.extractionError ?? "This reference asset has metadata only.",
      );
      return;
    }

    const fallbackWidth = Math.min(activeDesignView?.width ?? 1200, 360);
    const aspect =
      asset.bounds.width > 0 && asset.bounds.height > 0
        ? asset.bounds.height / asset.bounds.width
        : 0.66;
    const width = Math.max(120, Math.min(420, fallbackWidth));
    const height = Math.max(90, Math.round(width * aspect));
    const element: CanvasElement = {
      id: `reference-asset-${Date.now()}`,
      type: "image",
      viewId: activeViewId,
      name: asset.label || "Reference asset",
      artifactKey: asset.artifactKey,
      prompt: asset.prompt,
      role: "reference-asset",
      exportable: true,
      locked: false,
      objectFit: asset.objectFit ?? "cover",
      alt: asset.label || "Extracted reference asset",
      x: Math.max(24, ((activeDesignView?.width ?? 1200) - width) / 2),
      y: Math.max(24, ((activeDesignView?.height ?? 760) - height) / 2),
      width,
      height,
      style: {
        fill: "transparent",
        stroke: "transparent",
        strokeWidth: 0,
        opacity: 1,
      },
    };

    void createDesignElement(element);
  }

  // Place an asset at the visual center of the current viewport. Used when
  // the user clicks an asset thumbnail without dragging it onto the canvas.
  function placeAssetAtViewportCenter(asset: ProjectAsset) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = screenToArtboard(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      { clamp: true },
    );
    placeAssetAtArtboardPoint(asset, point.x, point.y);
  }

  const startLayerSelection = (
    event: React.PointerEvent<HTMLElement>,
    elementId: string,
  ) => {
    if (event.button !== 0 || event.shiftKey) {
      return;
    }

    setIsLayerSelecting(true);
    setLayerDragSelectedIds([elementId]);
    suppressNextLayerClickRef.current = false;
    selectElementIds([elementId]);
  };

  const extendLayerSelection = (elementId: string) => {
    if (!isLayerSelecting) {
      return;
    }

    setLayerDragSelectedIds((current) => {
      if (current.includes(elementId)) {
        return current;
      }

      const nextSelectedIds = [...current, elementId];
      suppressNextLayerClickRef.current = nextSelectedIds.length > 1;
      selectElementIds(nextSelectedIds);
      return nextSelectedIds;
    });
  };

  // Move a layer in the panel tree. Handles three drop targets:
  // - "above"/"below": reorder relative to a sibling row, inheriting that
  //   target's parentId / viewId so the dragged element becomes a peer.
  // - "into": reparent to a folder (folderId of an element-folder, or
  //   undefined for the root of a view).
  // Because the panel displays the array reversed (top of panel = front of
  // canvas), "above" maps to AFTER in the array, "below" to BEFORE.
  type LayerDropSpec =
    | { kind: "near"; targetId: string; position: "above" | "below" }
    | {
        kind: "into";
        folderId: string | undefined;
        viewId: string;
      };

  const moveLayer = (draggedId: string, spec: LayerDropSpec) => {
    setElements((current) => {
      const fromIndex = current.findIndex((el) => el.id === draggedId);
      if (fromIndex === -1) return current;

      // Walk up the parent chain in the current snapshot to detect cycles.
      const wouldCreateCycle = (newParentId: string | undefined) => {
        let cursor: string | undefined = newParentId;
        while (cursor) {
          if (cursor === draggedId) return true;
          const node: CanvasElement | undefined = current.find(
            (el) => el.id === cursor,
          );
          cursor = node?.parentId;
        }
        return false;
      };

      if (spec.kind === "into") {
        if (spec.folderId === draggedId) return current;
        if (wouldCreateCycle(spec.folderId)) return current;

        const dragged = current[fromIndex];
        const updated: CanvasElement = {
          ...dragged,
          parentId: spec.folderId,
          viewId: spec.viewId,
        };
        const next = [...current];
        next.splice(fromIndex, 1);
        next.push(updated);
        return next;
      }

      if (spec.targetId === draggedId) return current;
      const targetIndexInOriginal = current.findIndex(
        (el) => el.id === spec.targetId,
      );
      if (targetIndexInOriginal === -1) return current;
      const targetEl = current[targetIndexInOriginal];
      if (wouldCreateCycle(targetEl.parentId)) return current;

      const dragged = current[fromIndex];
      const updated: CanvasElement = {
        ...dragged,
        parentId: targetEl.parentId,
        viewId: targetEl.viewId,
      };

      const next = [...current];
      next.splice(fromIndex, 1);
      const newTargetIndex = next.findIndex((el) => el.id === spec.targetId);
      let insertIndex =
        spec.position === "above" ? newTargetIndex + 1 : newTargetIndex;
      insertIndex = Math.max(0, Math.min(insertIndex, next.length));
      next.splice(insertIndex, 0, updated);
      return next;
    });
  };

  // Create a new folder at the root of the active view.
  const createNewFolder = () => {
    const id = `folder-${Date.now()}`;
    // If a single folder is selected, nest the new folder inside it for a
    // more natural "create within" gesture. Otherwise the folder is created
    // at the root of the active view.
    let parentId: string | undefined = undefined;
    let viewIdForNew: string = activeViewId;
    if (selectedElementIds.length === 1) {
      const selected = elements.find((el) => el.id === selectedElementIds[0]);
      if (selected?.type === "folder") {
        parentId = selected.id;
        viewIdForNew = selected.viewId ?? activeViewId;
      }
    }

    const newFolder: CanvasElement = {
      id,
      type: "folder",
      viewId: viewIdForNew,
      parentId,
      name: "New folder",
      x: 0,
      y: 0,
    };
    setElements((current) => [...current, newFolder]);
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      if (parentId) next.add(parentId);
      return next;
    });
    // Select the new folder so the user can immediately rename or nest into it.
    setSelectedElementId(id);
    setSelectedElementIds([id]);
  };

  // Reset the live drop indicator when a drag finishes anywhere.
  const clearDragState = () => {
    setDraggingLayerId(null);
    setLayerDropIndicator(null);
  };

  // Compute the position (above / below / into) for the cursor over a row.
  // Folders / view folders accept an "into" zone in their middle; leaf rows
  // only accept above / below.
  const computeDropPosition = (
    event: React.DragEvent<HTMLElement>,
    canDropInto: boolean,
  ): "above" | "below" | "into" => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
    if (!canDropInto) {
      return ratio < 0.5 ? "above" : "below";
    }
    if (ratio < 0.3) return "above";
    if (ratio > 0.7) return "below";
    return "into";
  };

  // Render a single element row. Folders recursively render their children
  // when expanded.
  const renderLayerRow = (
    element: CanvasElement,
    depth: number,
  ): React.ReactNode => {
    const isFolder = element.type === "folder";
    const isExpanded = isFolder && expandedFolderIds.has(element.id);
    const isDragging = draggingLayerId === element.id;
    const dropPos =
      layerDropIndicator?.id === element.id
        ? layerDropIndicator.position
        : null;
    const childrenOfThis = isFolder
      ? elements.filter((el) => el.parentId === element.id)
      : [];
    const isSelected = selectedElementIds.includes(element.id);

    const className = [
      "layer-item",
      isFolder ? "is-folder" : null,
      isSelected ? "is-active" : null,
      isDragging ? "is-dragging" : null,
      dropPos === "above" ? "is-drop-above" : null,
      dropPos === "below" ? "is-drop-below" : null,
      dropPos === "into" ? "is-drop-into" : null,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div key={element.id}>
        <div
          className={className}
          role="button"
          tabIndex={0}
          style={{ paddingLeft: `${0.5 + depth * 0.85}rem` }}
          onPointerDown={(event) => startLayerSelection(event, element.id)}
          onPointerEnter={() => extendLayerSelection(element.id)}
          onClick={(event) => {
            if (suppressNextLayerClickRef.current) {
              suppressNextLayerClickRef.current = false;
              return;
            }
            const nextSelectedIds = event.shiftKey
              ? selectedElementIds.includes(element.id)
                ? selectedElementIds.filter(
                    (selectedId) => selectedId !== element.id,
                  )
                : [...selectedElementIds, element.id]
              : [element.id];
            setIsCanvasLayerVisible(true);
            selectElementIds(nextSelectedIds);
            if (!isFolder) {
              setSelectedTool("move");
            }
          }}
          onDragOver={(event) => {
            if (!draggingLayerId || draggingLayerId === element.id) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const nextPosition = computeDropPosition(event, isFolder);
            setLayerDropIndicator((prev) =>
              prev?.id === element.id && prev.position === nextPosition
                ? prev
                : { id: element.id, position: nextPosition },
            );
          }}
          onDragLeave={(event) => {
            if (
              event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              return;
            }
            setLayerDropIndicator((prev) =>
              prev?.id === element.id ? null : prev,
            );
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (draggingLayerId && draggingLayerId !== element.id) {
              const position = computeDropPosition(event, isFolder);
              if (position === "into" && isFolder) {
                moveLayer(draggingLayerId, {
                  kind: "into",
                  folderId: element.id,
                  viewId: element.viewId ?? activeViewId,
                });
              } else if (position === "above" || position === "below") {
                moveLayer(draggingLayerId, {
                  kind: "near",
                  targetId: element.id,
                  position,
                });
              }
            }
            clearDragState();
          }}
        >
          {isFolder ? (
            <button
              type="button"
              className="layer-folder-toggle"
              aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
              onClick={(event) => {
                event.stopPropagation();
                toggleFolderExpanded(element.id);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <ChevronGlyph open={isExpanded} />
            </button>
          ) : (
            <span
              className="layer-folder-toggle is-spacer"
              aria-hidden="true"
            />
          )}
          <span className="layer-icon">{isFolder ? "▸" : "▢"}</span>
          <span className="layer-name">
            {element.name ?? titleCase(element.type)}
          </span>
          <span
            className="layer-drag-handle"
            aria-label="Drag to reorder"
            title="Drag to reorder"
            draggable
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onDragStart={(event) => {
              setDraggingLayerId(element.id);
              setIsLayerSelecting(false);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", element.id);
            }}
            onDragEnd={clearDragState}
          >
            <svg
              width="10"
              height="14"
              viewBox="0 0 10 14"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="3" cy="2" r="1" fill="currentColor" />
              <circle cx="7" cy="2" r="1" fill="currentColor" />
              <circle cx="3" cy="7" r="1" fill="currentColor" />
              <circle cx="7" cy="7" r="1" fill="currentColor" />
              <circle cx="3" cy="12" r="1" fill="currentColor" />
              <circle cx="7" cy="12" r="1" fill="currentColor" />
            </svg>
          </span>
        </div>
        {isFolder && isExpanded && childrenOfThis.length > 0 && (
          <div className="layer-children">
            {childrenOfThis
              .slice()
              .reverse()
              .map((child) => renderLayerRow(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Render the virtual "Brief" / "Draft" view folders. Their direct children
  // are root-level elements within the matching viewId.
  const renderViewFolder = (
    frameMode: FrameMode,
    label: string,
  ): React.ReactNode => {
    const viewId = frameMode === "before" ? "brief" : "draft";
    const folderKey = `view:${viewId}`;
    const isExpanded = expandedFolderIds.has(folderKey);
    const isActiveView = activeFrame === frameMode;
    const rootChildren = elements.filter(
      (el) => el.viewId === viewId && !el.parentId,
    );
    const dropPos =
      layerDropIndicator?.id === folderKey ? layerDropIndicator.position : null;

    return (
      <div key={folderKey}>
        <div
          className={[
            "layer-item",
            "is-folder",
            "is-view-folder",
            isActiveView ? "is-active" : null,
            dropPos === "into" ? "is-drop-into" : null,
          ]
            .filter(Boolean)
            .join(" ")}
          role="button"
          tabIndex={0}
          onClick={() => {
            setActiveFrame(frameMode);
            if (frameMode === "after") {
              setIsCanvasLayerVisible(true);
            }
          }}
          onDragOver={(event) => {
            if (!draggingLayerId) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setLayerDropIndicator((prev) =>
              prev?.id === folderKey && prev.position === "into"
                ? prev
                : { id: folderKey, position: "into" },
            );
          }}
          onDragLeave={(event) => {
            if (
              event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              return;
            }
            setLayerDropIndicator((prev) =>
              prev?.id === folderKey ? null : prev,
            );
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (draggingLayerId) {
              moveLayer(draggingLayerId, {
                kind: "into",
                folderId: undefined,
                viewId,
              });
            }
            clearDragState();
          }}
        >
          <button
            type="button"
            className="layer-folder-toggle"
            aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
            onClick={(event) => {
              event.stopPropagation();
              toggleFolderExpanded(folderKey);
            }}
          >
            <ChevronGlyph open={isExpanded} />
          </button>
          <span className="layer-icon">#</span>
          <span className="layer-name">{label}</span>
        </div>
        {isExpanded && rootChildren.length > 0 && (
          <div className="layer-children">
            {rootChildren
              .slice()
              .reverse()
              .map((child) => renderLayerRow(child, 1))}
          </div>
        )}
      </div>
    );
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const { x, y } = screenToArtboard(e.clientX, e.clientY, {
      clamp: Boolean(isDrawing),
    });

    if (isDrawing && drawingStart) {
      if (selectedTool === "frame" || selectedTool === "shape") {
        const dragWidth = Math.abs(x - drawingStart.x);
        const dragHeight = Math.abs(y - drawingStart.y);
        const isDefaultFrameClick =
          selectedTool === "frame" && dragWidth <= 5 && dragHeight <= 5;
        const defaultFrameBounds =
          isDefaultFrameClick &&
          frameToolKind === "frame" &&
          selectedFramePresetId === "actual-element" &&
          actualDesignFrame
            ? {
                x: 0,
                y: 0,
                width: Math.round(actualDesignFrame.width),
                height: Math.round(actualDesignFrame.height),
              }
            : null;
        const width = isDefaultFrameClick
          ? (defaultFrameBounds?.width ?? canvasFrame.width)
          : dragWidth;
        const height = isDefaultFrameClick
          ? (defaultFrameBounds?.height ?? canvasFrame.height)
          : dragHeight;
        const isDefaultShapeClick =
          selectedTool === "shape" && dragWidth <= 5 && dragHeight <= 5;
        const shapeBounds = getShapeElementBounds(
          shapeToolKind,
          drawingStart,
          { x, y },
          isDefaultShapeClick,
        );

        if (
          (isDefaultFrameClick ||
            isDefaultShapeClick ||
            width > 5 ||
            height > 5) &&
          !(selectedTool === "frame" && isPersistingElement)
        ) {
          const frameConfig =
            selectedTool === "frame"
              ? getFrameElementConfig(frameToolKind, canvasFrame)
              : null;
          const isLineShape =
            shapeToolKind === "line" || shapeToolKind === "arrow";
          const isBoundaryShape =
            shapeToolKind === "boundary" ||
            shapeToolKind === "rounded-boundary";
          const newElement: CanvasElement = constrainElementToArtboard({
            id: `${selectedTool === "frame" ? frameToolKind : shapeToolKind}-${Date.now()}`,
            type: frameConfig?.type ?? shapeToolKind,
            viewId: activeViewId,
            name: frameConfig?.name ?? titleCase(shapeToolKind),
            selected: selectedTool === "shape",
            x:
              selectedTool === "shape"
                ? shapeBounds.x
                : isDefaultFrameClick
                  ? (defaultFrameBounds?.x ?? drawingStart.x)
                  : Math.min(drawingStart.x, x),
            y:
              selectedTool === "shape"
                ? shapeBounds.y
                : isDefaultFrameClick
                  ? (defaultFrameBounds?.y ?? drawingStart.y)
                  : Math.min(drawingStart.y, y),
            width: selectedTool === "shape" ? shapeBounds.width : width,
            height: selectedTool === "shape" ? shapeBounds.height : height,
            style: {
              fill:
                frameConfig?.fill ??
                (isLineShape
                  ? "none"
                  : isBoundaryShape
                    ? "rgba(20, 120, 242, 0.08)"
                    : "#E5E5E5"),
              stroke:
                frameConfig?.stroke ?? (isBoundaryShape ? "#1478f2" : "#999"),
              strokeWidth:
                frameConfig?.strokeWidth ??
                (isLineShape ? 2 : isBoundaryShape ? 2 : 1),
              opacity: frameConfig?.opacity ?? 1,
              cornerRadius:
                frameConfig?.cornerRadius ??
                (shapeToolKind === "boundary" ? 0 : undefined),
              cornerScale:
                selectedTool === "shape" && shapeToolKind === "rounded-boundary"
                  ? 0.18
                  : selectedTool === "shape" && shapeToolKind === "boundary"
                    ? 0
                    : undefined,
              fillOpacity: frameConfig?.fillOpacity,
              elevation: frameConfig?.elevation,
            },
          });
          if (selectedTool === "frame" || selectedTool === "shape") {
            void createDesignElement(newElement);
          } else {
            setElements([
              ...elements.map((element) => ({ ...element, selected: false })),
              newElement,
            ]);
            setSelectedElementId(newElement.id);
            setSelectedElementIds([newElement.id]);
          }
        }
      } else if (selectedTool === "text") {
        const dragWidth = Math.abs(x - drawingStart.x);
        const dragHeight = Math.abs(y - drawingStart.y);
        const isClick = dragWidth < 6 && dragHeight < 6;
        const newText = fitCanvasTextElement(
          constrainElementToArtboard({
            id: `text-${Date.now()}`,
            type: "text",
            viewId: activeViewId,
            name: "Text box",
            x: isClick ? drawingStart.x : Math.min(drawingStart.x, x),
            y: isClick ? drawingStart.y : Math.min(drawingStart.y, y),
            width: isClick ? 280 : Math.max(60, dragWidth),
            height: isClick ? 72 : Math.max(32, dragHeight),
            content: "Type something",
            selected: true,
            style: {
              fontSize: 16,
              fontFamily: DEFAULT_CANVAS_FONT,
              fill: "var(--ink)",
              opacity: 1,
              fontWeight: "normal",
              fontStyle: "normal",
              textAlign: "left",
              letterSpacing: 0,
              lineHeight: 1.5,
            },
          }),
        );
        setElements([
          ...elements.map((element) => ({ ...element, selected: false })),
          newText,
        ]);
        setSelectedElementId(newText.id);
        setSelectedElementIds([newText.id]);
        setEditingElementId(newText.id);
        setSelectedTool("move");
        void createDesignElement(newText);
      } else if (selectedTool === "pen" && currentPath.length > 1) {
        const finalPath = [...currentPath, { x, y }];
        const newPath: CanvasElement = {
          id: `path-${Date.now()}`,
          type: "path",
          viewId: activeViewId,
          x: finalPath[0].x,
          y: finalPath[0].y,
          name: "Pen stroke",
          points: finalPath,
          style: {
            stroke: penSettings.color,
            strokeWidth: penSettings.size,
            opacity: penSettings.opacity / 100,
            fill: "none",
          },
        };
        setElements([...elements, newPath]);
        setCurrentPath([]);
      } else if (selectedTool === "comment") {
        const dx = x - drawingStart.x;
        const dy = y - drawingStart.y;
        const dragDistance = Math.hypot(dx, dy);
        const isPoint = dragDistance < 6;

        const newComment: CanvasElement = {
          id: `comment-${Date.now()}`,
          type: "comment",
          viewId: activeViewId,
          x: isPoint ? drawingStart.x : Math.min(drawingStart.x, x),
          y: isPoint ? drawingStart.y : Math.min(drawingStart.y, y),
          width: isPoint ? 0 : Math.abs(dx),
          height: isPoint ? 0 : Math.abs(dy),
          content: "",
        };

        setElements([
          ...elements.map((el) => ({ ...el, selected: false })),
          newComment,
        ]);
        setSelectedElementId(newComment.id);
        setSelectedElementIds([newComment.id]);
        setEditingElementId(newComment.id);
        setOpenCommentId(newComment.id);
        setSelectedTool("move");
      }
    }

    // Commit marquee selection or persist a finished multi-element drag.
    // These are mutually exclusive in handleMouseDown for the move tool.
    if (selectedTool === "move") {
      if (marqueeBox) {
        const minX = Math.min(marqueeBox.startX, marqueeBox.endX);
        const maxX = Math.max(marqueeBox.startX, marqueeBox.endX);
        const minY = Math.min(marqueeBox.startY, marqueeBox.endY);
        const maxY = Math.max(marqueeBox.startY, marqueeBox.endY);
        // Treat <4px boxes as a "click on empty canvas" — just clear
        // (or keep, if shift was held) the selection.
        const hasMeaningfulArea = maxX - minX > 3 || maxY - minY > 3;
        if (hasMeaningfulArea) {
          const candidates = elements.filter(
            (element) =>
              element.type !== "comment" &&
              element.type !== "folder" &&
              !element.locked &&
              (!element.viewId || element.viewId === activeViewId),
          );
          // Intersect-mode (Figma-style) — any element whose bounding
          // box overlaps the marquee at all is selected.
          const hitIds = candidates
            .filter((element) => {
              const b = getElementBounds(element);
              return (
                b.x + b.width >= minX &&
                b.x <= maxX &&
                b.y + b.height >= minY &&
                b.y <= maxY
              );
            })
            .map((element) => element.id);

          const nextIds = marqueeBox.additive
            ? Array.from(new Set([...marqueeBox.initialIds, ...hitIds]))
            : hitIds;
          selectElementIds(nextIds);
        } else if (!marqueeBox.additive) {
          // Tiny / zero-area marquee on empty canvas: deselect.
          selectElementIds([]);
        }
        setMarqueeBox(null);
      } else if (draggingElementIds.length > 0) {
        // Persist every element that participated in the drag so the
        // move sticks across reloads / agent runs.
        const movedIds = new Set(draggingElementIds);
        const moved = elements.filter((el) => movedIds.has(el.id));
        for (const el of moved) {
          void updateDesignElement(el);
        }
      }
    }

    setIsDragging(false);
    setIsDrawing(false);
    setDrawingStart(null);
    setDrawingPreviewPoint(null);
    setDraggingElementIds([]);
    endResize();
  };

  const selectFramePreset = (preset: FramePreset) => {
    setSelectedFramePresetId(preset.id);
    setCanvasFrame((prev) => ({
      ...prev,
      kind: "frame",
      name: preset.label,
      width: preset.width,
      height: preset.height,
    }));
  };

  const selectFrameToolKind = (kind: FrameToolKind) => {
    setSelectedTool("frame");
    setFrameToolKind(kind);
    setShowFrameToolMenu(false);
    setCanvasFrame((prev) => ({
      ...prev,
      kind,
      name:
        kind === "section"
          ? "Section"
          : kind === "slice"
            ? "Slice"
            : (framePresetOptions.find(
                (preset) => preset.id === selectedFramePresetId,
              )?.label ?? "Website"),
      width: kind === "section" ? 496 : kind === "slice" ? 320 : prev.width,
      height: kind === "section" ? 496 : kind === "slice" ? 180 : prev.height,
      fillOpacity: kind === "slice" ? 0 : prev.fillOpacity,
      strokeOpacity: kind === "slice" ? 36 : prev.strokeOpacity,
    }));
  };

  const selectShapeToolKind = (kind: ShapeToolKind) => {
    setSelectedTool("shape");
    setShapeToolKind(kind);
    setShowShapeToolMenu(false);
  };

  if (loadState === "loading") {
    return (
      <main className="figma-shell">
        <div className="empty-state" style={{ height: "100vh" }}>
          <strong>Loading workspace</strong>
          <span>Fetching the backend project store.</span>
        </div>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="figma-shell">
        <div className="empty-state" style={{ height: "100vh" }}>
          <strong>Project not found</strong>
          <span>This project slug is not in the in-memory project store.</span>
          <button className="primary-action" onClick={onBack} type="button">
            Back to dashboard
          </button>
        </div>
      </main>
    );
  }

  async function runBuild(nextRequest: string) {
    setError("");

    const currentProject = project;
    if (!currentProject) {
      return;
    }

    const editContext = currentProject.currentDraft
      ? createInspectorEditContext({
          activeViewId,
          elements,
          prompt: nextRequest,
          selectedElementIds:
            selectedElementIds.length > 0
              ? selectedElementIds
              : selectedElementId
                ? [selectedElementId]
                : [],
        })
      : undefined;

    if (currentProject.currentDraft && !editContext) {
      setError(
        "Select one or more canvas elements before running a targeted edit.",
      );
      return;
    }

    setIsBuilding(true);

    try {
      await buildProject(nextRequest, editContext);
      setRequest("");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Build failed.",
      );
    } finally {
      setIsBuilding(false);
    }
  }

  async function runEvaluation() {
    setError("");
    setIsEvaluating(true);

    try {
      await evaluateProject();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Evaluation failed.",
      );
    } finally {
      setIsEvaluating(false);
    }
  }

  const selectedTextElement = elements.find(
    (element) => element.id === selectedElementId && element.type === "text",
  );
  const selectedPathElement = elements.find(
    (element) => element.id === selectedElementId && element.type === "path",
  );
  // When exactly one frame is selected we surface a frame-specific
  // inspector in the right panel — Figma-style. Multi-select keeps the
  // generic fallback so we don't pretend to edit many frames at once.
  const selectedFrameElement =
    selectedElementIds.length === 1
      ? elements.find(
          (element) =>
            element.id === selectedElementIds[0] && element.type === "frame",
        )
      : undefined;
  const activePenSettings: PenSettings = selectedPathElement
    ? {
        color: selectedPathElement.style?.stroke ?? penSettings.color,
        size: selectedPathElement.style?.strokeWidth ?? penSettings.size,
        opacity: Math.round((selectedPathElement.style?.opacity ?? 1) * 100),
      }
    : penSettings;
  const updatePenSettings = (updates: Partial<PenSettings>) => {
    const nextSettings = normalizePenSettings({
      ...activePenSettings,
      ...updates,
    });

    setPenSettings(nextSettings);

    if (!selectedPathElement) {
      return;
    }

    setElements((current) =>
      current.map((element) =>
        element.id === selectedPathElement.id
          ? {
              ...element,
              style: {
                ...element.style,
                fill: "none",
                stroke: nextSettings.color,
                strokeWidth: nextSettings.size,
                opacity: nextSettings.opacity / 100,
              },
            }
          : element,
      ),
    );
  };

  return (
    <main
      className={`figma-shell ${isAgentRunning ? "is-agent-running" : ""}`}
      style={{
        gridTemplateColumns: `${leftPanelOpen ? "16rem" : "2.5rem"} 1fr ${rightPanelOpen ? "20rem" : "2.5rem"}`,
      }}
    >
      <header className="figma-header">
        <div className="figma-header-left">
          <button
            className="figma-home-button"
            onClick={onBack}
            title="Back to Dashboard"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>
          <button
            className="icon-button history-button"
            disabled={!canUndoDesign || isMovingHistory}
            onClick={() => void moveDesignHistory("undo")}
            title="Undo"
            type="button"
          >
            <UndoIcon />
          </button>
          <button
            className="icon-button history-button"
            disabled={!canRedoDesign || isMovingHistory}
            onClick={() => void moveDesignHistory("redo")}
            title="Redo"
            type="button"
          >
            <RedoIcon />
          </button>
        </div>
        <div className="figma-header-center">
          <span className="project-name">{project.name}</span>
        </div>
        <div className="figma-header-right" />
      </header>

      <aside className={`figma-left-panel ${leftPanelOpen ? "" : "is-closed"}`}>
        {leftPanelOpen ? (
          <>
            <div
              style={{ display: "flex", borderBottom: "1px solid var(--line)" }}
            >
              <div
                className="panel-tabs"
                style={{ flex: 1, borderBottom: "none" }}
              >
                {leftTab === "layers" ? (
                  <strong style={{ cursor: "pointer" }}>Layers</strong>
                ) : (
                  <span
                    style={{ cursor: "pointer" }}
                    onClick={() => setLeftTab("layers")}
                  >
                    Layers
                  </span>
                )}
                {leftTab === "assets" ? (
                  <strong style={{ cursor: "pointer" }}>Assets</strong>
                ) : (
                  <span
                    style={{ cursor: "pointer" }}
                    onClick={() => setLeftTab("assets")}
                  >
                    Assets
                  </span>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "0 0.5rem",
                }}
              >
                <button
                  className="panel-toggle-btn"
                  onClick={() => setLeftPanelOpen(false)}
                  title="Close Sidebar"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
              </div>
            </div>
            {leftTab === "layers" ? (
              <div className="layer-list">
                <div className="layer-section layer-section-row">
                  <span>Page 1</span>
                  <div className="layer-section-actions">
                    <button
                      type="button"
                      className="layer-section-btn"
                      onClick={createNewFolder}
                      title="New folder"
                      aria-label="New folder"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M1.5 4 L6 4 L7 5.5 L12.5 5.5 L12.5 11 L1.5 11 Z" />
                        <path d="M7 7.5 L7 10" />
                        <path d="M5.5 8.75 L8.5 8.75" />
                      </svg>
                    </button>
                    {selectedElementIds.length > 0 && (
                      <button
                        onClick={() =>
                          void deleteDesignElements(selectedElementIds)
                        }
                        type="button"
                        className="layer-section-btn"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                {renderViewFolder("before", "Brief")}
                {renderViewFolder("after", "Draft")}
              </div>
            ) : (
              <AssetsPanel
                assets={projectAssets}
                loadState={assetsLoadState}
                error={assetsError}
                search={assetSearch}
                onSearchChange={setAssetSearch}
                uploading={uploadingAssetCount > 0}
                isDropTarget={isAssetDropTarget}
                fileInputRef={assetFileInputRef}
                renamingAssetId={renamingAssetId}
                renamingAssetName={renamingAssetName}
                draggingAssetId={draggingAssetId}
                onPickFiles={() => assetFileInputRef.current?.click()}
                onFilesSelected={(files) => {
                  if (files.length === 0) return;
                  void uploadAssetFiles(Array.from(files));
                }}
                onDropFiles={(files) => {
                  setIsAssetDropTarget(false);
                  if (files.length === 0) return;
                  void uploadAssetFiles(Array.from(files));
                }}
                onSetIsDropTarget={setIsAssetDropTarget}
                onClickAsset={(asset) => placeAssetAtViewportCenter(asset)}
                onStartDrag={(asset) => setDraggingAssetId(asset.id)}
                onEndDrag={() => setDraggingAssetId(null)}
                onStartRename={(asset) => {
                  setRenamingAssetId(asset.id);
                  setRenamingAssetName(asset.name);
                }}
                onChangeRenameValue={setRenamingAssetName}
                onCommitRename={(asset) =>
                  void commitAssetRename(asset.id, renamingAssetName)
                }
                onCancelRename={() => setRenamingAssetId(null)}
                onDeleteAsset={(asset) => {
                  if (
                    typeof window !== "undefined" &&
                    !window.confirm(`Delete asset “${asset.name}”?`)
                  ) {
                    return;
                  }
                  void deleteProjectAsset(asset.id);
                }}
                onDismissError={() => setAssetsError("")}
                referenceImage={agentReferenceImage}
                referenceAssets={agentReferenceAssets}
                onPlaceReferenceAsset={placeReferenceAsset}
              />
            )}
          </>
        ) : (
          <div className="panel-closed-state">
            <button
              className="panel-toggle-btn"
              onClick={() => setLeftPanelOpen(true)}
              title="Open Sidebar"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        )}
      </aside>

      <section
        className={`figma-canvas-area${isCanvasAssetTarget ? " is-asset-drop-target" : ""}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onDragEnter={(event) => {
          // Both files (uploads from outside the app) and the in-app asset
          // mime type should activate the canvas drop target. Layer-panel
          // drag/drops use plain text and shouldn't trigger this.
          const types = event.dataTransfer?.types ?? [];
          if (
            types.includes("Files") ||
            types.includes("application/x-tastelab-asset")
          ) {
            event.preventDefault();
            setIsCanvasAssetTarget(true);
          }
        }}
        onDragOver={(event) => {
          const types = event.dataTransfer?.types ?? [];
          if (
            types.includes("Files") ||
            types.includes("application/x-tastelab-asset")
          ) {
            event.preventDefault();
            if (event.dataTransfer) {
              event.dataTransfer.dropEffect = "copy";
            }
          }
        }}
        onDragLeave={(event) => {
          if (
            event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            return;
          }
          setIsCanvasAssetTarget(false);
        }}
        onDrop={(event) => {
          const types = event.dataTransfer?.types ?? [];
          const hasAsset = types.includes("application/x-tastelab-asset");
          const hasFiles = types.includes("Files");
          if (!hasAsset && !hasFiles) return;
          event.preventDefault();
          setIsCanvasAssetTarget(false);
          const point = screenToArtboard(event.clientX, event.clientY);
          if (!point.inside) return;
          if (hasAsset) {
            const json = event.dataTransfer.getData("application/json");
            if (!json) return;
            try {
              const asset = JSON.parse(json) as ProjectAsset;
              placeAssetAtArtboardPoint(asset, point.x, point.y);
            } catch {
              // Drag payload was malformed — ignore.
            }
            return;
          }
          // Falling through means the user dropped raw files onto the canvas.
          // Upload them and place each at the drop point as it lands.
          if (event.dataTransfer.files.length > 0 && project) {
            void (async () => {
              const files = Array.from(event.dataTransfer.files).filter(
                (file) => file.type.startsWith("image/"),
              );
              for (const file of files) {
                const { width, height } = await readImageDimensions(file);
                const form = new FormData();
                form.append("file", file);
                form.append(
                  "name",
                  file.name.replace(/\.[^.]+$/, "") || "Untitled asset",
                );
                form.append("width", String(width));
                form.append("height", String(height));
                try {
                  const response = await fetch(
                    `/api/projects/${project.slug}/assets`,
                    { method: "POST", body: form },
                  );
                  const data = (await response.json()) as {
                    asset?: ProjectAsset;
                    error?: string;
                  };
                  if (!response.ok || !data.asset) {
                    throw new Error(data.error ?? "Upload failed.");
                  }
                  setProjectAssets((current) => [data.asset!, ...current]);
                  placeAssetAtArtboardPoint(data.asset, point.x, point.y);
                } catch (nextError) {
                  setAssetsError(
                    nextError instanceof Error
                      ? nextError.message
                      : "Upload failed.",
                  );
                }
              }
            })();
          }
        }}
        style={{
          cursor:
            selectedTool === "hand"
              ? isDragging
                ? "grabbing"
                : "grab"
              : selectedTool === "pen"
                ? "crosshair"
                : selectedTool === "eraser"
                  ? "cell"
                  : "default",
          userSelect: isDragging ? "none" : "auto",
        }}
      >
        <ArtboardSizeBadge
          size={artboardSize}
          isMenuOpen={artboardPresetMenuOpen}
          onToggleMenu={() => setArtboardPresetMenuOpen((prev) => !prev)}
          onCloseMenu={() => setArtboardPresetMenuOpen(false)}
          onSelectPreset={applyArtboardPreset}
          onSetCustomSize={(width, height) =>
            setArtboardSize({
              width: Math.max(ARTBOARD_MIN_WIDTH, Math.round(width)),
              height: Math.max(ARTBOARD_MIN_HEIGHT, Math.round(height)),
              presetId: null,
            })
          }
        />
        {isAgentRunning && (
          <div className="canvas-build-status" role="status">
            <SparkIcon />
            <span>Design under construction</span>
            <i aria-hidden="true" />
          </div>
        )}
        <div ref={canvasRef} className="canvas-wrapper">
          <InfiniteGrid camera={camera} />

          <div
            className="canvas-camera"
            style={{
              transform: `scale(${camera.z}) translate(${camera.x}px, ${camera.y}px)`,
              transition:
                isDragging || isCameraInteracting
                  ? "none"
                  : "transform 0.1s ease-out",
            }}
          >
            <DesignCanvas
              activeFrame={activeFrame}
              onFrameElementChange={setDesignFrameElement}
              project={project}
              artboardSize={artboardSize}
              artboardName={artboardName}
              artboardFill={artboardFill}
              artboardElevation={artboardElevation}
              isVisible={isCanvasLayerVisible}
            />
            <ElementsLayer
              elements={elements}
              activeViewId={activeViewId}
              zoom={camera.z}
              isVisible={isCanvasLayerVisible}
              currentPath={
                selectedTool === "pen" && isDrawing ? currentPath : null
              }
              commentPreviewBounds={
                selectedTool === "comment" &&
                isDrawing &&
                drawingStart &&
                drawingPreviewPoint
                  ? getCommentPreviewBounds(drawingStart, drawingPreviewPoint)
                  : null
              }
              marqueeBox={marqueeBox}
              penPreviewStyle={penSettings}
              editingElementId={editingElementId}
              openCommentId={openCommentId}
              onSetOpenComment={setOpenCommentId}
              onResolveCommentWithAgent={async (comment) => {
                const editContext = createCommentEditContext({
                  comment,
                  elements,
                  activeViewId,
                  selectedElementIds,
                });
                await buildProject(comment.content ?? "", editContext);
              }}
              onStartEdit={(elementId) => setEditingElementId(elementId)}
              onEndEdit={() => setEditingElementId(null)}
              onUpdateElement={(elementId, updates) => {
                const currentElement = elements.find(
                  (element) => element.id === elementId,
                );
                const nextElement = currentElement
                  ? fitCanvasTextElement({ ...currentElement, ...updates })
                  : null;
                setElements(
                  elements.map((element) =>
                    element.id === elementId
                      ? fitCanvasTextElement({ ...element, ...updates })
                      : element,
                  ),
                );
                if (nextElement) {
                  void updateDesignElement(nextElement);
                }
              }}
              onRemoveElement={(elementId) =>
                void deleteDesignElements([elementId])
              }
              onStartResize={(elementId, handle, clientX, clientY) => {
                setResizingElementId(elementId);
                setResizeHandle(handle);
                setIsDragging(false);
                setIsDrawing(false);
                setDrawingStart(null);
                const element = elements.find((el) => el.id === elementId);
                if (element) {
                  const pointer = screenToArtboard(clientX, clientY, {
                    clamp: true,
                  });
                  setResizeStart({
                    pointerX: pointer.x,
                    pointerY: pointer.y,
                    elementX: element.x,
                    elementY: element.y,
                    width: element.width ?? getElementBounds(element).width,
                    height: element.height ?? getElementBounds(element).height,
                    fontSize: element.style?.fontSize,
                  });
                }
              }}
              artboardBounds={actualDesignFrame}
              onStartArtboardResize={(handle, clientX, clientY) => {
                setIsDragging(false);
                setIsDrawing(false);
                setDrawingStart(null);
                startArtboardResize(handle, clientX, clientY);
              }}
            />
            {gazeAnalysis && actualDesignFrame ? (
              <PositionedGazeArtboardOverlay
                analysis={gazeAnalysis}
                bounds={actualDesignFrame}
                showOverlay={gazeShowOverlay}
                showFixations={gazeShowFixations}
                cornerRadius={ARTBOARD_CORNER_RADIUS}
              />
            ) : null}
            <GeneratedReferenceImageLayer
              bounds={actualDesignFrame}
              fallbackFill={artboardFill}
              image={agentReferenceImage}
              isVisible={hasDraftReferenceBackground && !isCanvasLayerVisible}
            />
          </div>
        </div>
      </section>

      <aside
        className={`figma-right-panel ${rightPanelOpen ? "" : "is-closed"}`}
      >
        {rightPanelOpen ? (
          <>
            <div className="right-panel-tabbar">
              <div
                className="panel-tabs"
                style={{ flex: 1, borderBottom: "none" }}
              >
                {rightTab === "design" ? (
                  <strong style={{ cursor: "pointer" }}>Design</strong>
                ) : (
                  <span
                    style={{ cursor: "pointer" }}
                    onClick={() => setRightTab("design")}
                  >
                    Design
                  </span>
                )}
                {rightTab === "agentic" ? (
                  <strong style={{ cursor: "pointer" }}>Agentic</strong>
                ) : (
                  <span
                    style={{ cursor: "pointer" }}
                    onClick={() => setRightTab("agentic")}
                  >
                    Agentic
                  </span>
                )}
                {rightTab === "prototype" ? (
                  <strong style={{ cursor: "pointer" }}>Prototype</strong>
                ) : (
                  <span
                    style={{ cursor: "pointer" }}
                    onClick={() => setRightTab("prototype")}
                  >
                    Prototype
                  </span>
                )}
                {rightTab === "inspect" ? (
                  <strong style={{ cursor: "pointer" }}>Inspect</strong>
                ) : (
                  <span
                    style={{ cursor: "pointer" }}
                    onClick={() => setRightTab("inspect")}
                  >
                    Inspect
                  </span>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "0 0.5rem",
                }}
              >
                <button
                  className="panel-toggle-btn"
                  onClick={() => setRightPanelOpen(false)}
                  title="Close Sidebar"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </div>
            </div>
            {rightTab === "design" && selectedTool === "frame" && (
              <>
                <FrameInspectorPanel
                  frameSelection={canvasFrame}
                  frameToolKind={frameToolKind}
                  presets={framePresetOptions}
                  selectedPresetId={selectedFramePresetId}
                  onFrameChange={setCanvasFrame}
                  onKindChange={selectFrameToolKind}
                  onPresetSelect={selectFramePreset}
                />
                {error && (
                  <p className="inline-error side-inspector-note">{error}</p>
                )}
              </>
            )}
            {rightTab === "design" && selectedTool !== "frame" && (
              <div className="properties-section feedback-panel side-inspector-panel">
                {selectedTextElement ? (
                  <TextPropertiesPanel
                    element={selectedTextElement}
                    onUpdate={(updates) => {
                      const nextElement = fitCanvasTextElement({
                        ...selectedTextElement,
                        ...updates,
                      });
                      setElements(
                        elements.map((element) =>
                          element.id === selectedTextElement.id
                            ? nextElement
                            : element,
                        ),
                      );
                      void updateDesignElement(nextElement);
                    }}
                    onFitBounds={() => {
                      const nextElement = fitCanvasTextElement(
                        selectedTextElement,
                        { force: true },
                      );
                      setElements(
                        elements.map((element) =>
                          element.id === selectedTextElement.id
                            ? nextElement
                            : element,
                        ),
                      );
                      void updateDesignElement(nextElement);
                    }}
                  />
                ) : selectedTool === "pen" || selectedPathElement ? (
                  <PenPropertiesPanel
                    settings={activePenSettings}
                    selectedPath={selectedPathElement}
                    onUpdate={updatePenSettings}
                  />
                ) : selectedFrameElement ? (
                  <FrameElementInspectorPanel
                    element={selectedFrameElement}
                    onUpdate={(updates) =>
                      setElements(
                        elements.map((element) =>
                          element.id === selectedFrameElement.id
                            ? { ...element, ...updates }
                            : element,
                        ),
                      )
                    }
                    onSelectPreset={(preset) =>
                      setElements(
                        elements.map((element) =>
                          element.id === selectedFrameElement.id
                            ? {
                                ...element,
                                width: preset.width,
                                height: preset.height,
                                style: {
                                  ...element.style,
                                  presetId: preset.id,
                                },
                              }
                            : element,
                        ),
                      )
                    }
                  />
                ) : selectedElementIds.length === 0 ? (
                  <ArtboardInspectorPanel
                    name={artboardName}
                    onNameChange={setArtboardName}
                    size={artboardSize}
                    onSizeChange={(width, height) =>
                      setArtboardSize({
                        width: Math.max(ARTBOARD_MIN_WIDTH, Math.round(width)),
                        height: Math.max(
                          ARTBOARD_MIN_HEIGHT,
                          Math.round(height),
                        ),
                        presetId: null,
                      })
                    }
                    onSelectPreset={applyArtboardPreset}
                    fill={artboardFill}
                    onFillChange={setArtboardFill}
                    lockAspect={artboardLockAspect}
                    onLockAspectChange={setArtboardLockAspect}
                    elevation={artboardElevation}
                    onElevationChange={setArtboardElevation}
                    project={project}
                    gazeAnalysis={gazeAnalysis}
                    gazeBusy={gazeBusy}
                    gazeError={gazeError}
                    gazeShowOverlay={gazeShowOverlay}
                    onGazeToggleOverlay={() =>
                      setGazeShowOverlay((prev) => !prev)
                    }
                    gazeShowFixations={gazeShowFixations}
                    onGazeToggleFixations={() =>
                      setGazeShowFixations((prev) => !prev)
                    }
                    gazeApiStatus={gazeApiStatus}
                    onGazePredict={() => void runGazePrediction()}
                    onGazePassToAgent={(additionalInfo) =>
                      void passGazeIntoAgent(additionalInfo)
                    }
                    gazeAgentBusy={isBuilding || isAgentRunning}
                    onGazeClear={clearGazeAnalysis}
                    onGazeRetryConnection={() => void pingGazeApi()}
                  />
                ) : (
                  <div
                    className="project-brief-card side-inspector-card"
                    style={{
                      border: "none",
                      padding: "0",
                      background: "transparent",
                    }}
                  >
                    <p className="panel-kicker">Brief</p>
                    <strong className="side-inspector-title">
                      {project.type}
                    </strong>
                    <p className="side-inspector-copy">{project.brief}</p>
                  </div>
                )}
              </div>
            )}
            {rightTab === "agentic" && (
              <AgenticRunPanel
                error={error}
                events={agentActivity}
                isBuilding={isBuilding}
                isRunning={isAgentRunning}
                message={project.runStatus.message}
                project={project}
                request={request}
                runBuild={runBuild}
                selectedTargetCount={
                  selectedElementIds.length > 0
                    ? selectedElementIds.length
                    : selectedElementId
                      ? 1
                      : 0
                }
                setRequest={setRequest}
              />
            )}
            {rightTab === "prototype" && (
              <div className="properties-section side-inspector-panel">
                <p className="panel-kicker">Interactions</p>
                <div className="empty-state side-inspector-empty">
                  <span>No interactions defined for this component yet.</span>
                  <button className="secondary-action" type="button">
                    Add interaction
                  </button>
                </div>
                <label className="side-inspector-field">
                  <span className="panel-kicker">Flow starting point</span>
                  <select className="side-inspector-select">
                    <option>Page 1 - Brief</option>
                    <option>Page 1 - Draft</option>
                  </select>
                </label>
              </div>
            )}
            {rightTab === "inspect" && (
              <div className="properties-section side-inspector-panel">
                <p className="panel-kicker">CSS Properties</p>
                <div
                  className="side-code-block"
                  style={{
                    fontFamily: "monospace",
                  }}
                >
                  <div style={{ color: "#c678dd" }}>
                    display<span style={{ color: "var(--ink)" }}>: flex;</span>
                  </div>
                  <div style={{ color: "#c678dd" }}>
                    flex-direction
                    <span style={{ color: "var(--ink)" }}>: column;</span>
                  </div>
                  <div style={{ color: "#c678dd" }}>
                    align-items
                    <span style={{ color: "var(--ink)" }}>: center;</span>
                  </div>
                  <div style={{ color: "#c678dd" }}>
                    gap<span style={{ color: "var(--ink)" }}>: 24px;</span>
                  </div>
                  <div style={{ color: "#c678dd" }}>
                    padding<span style={{ color: "var(--ink)" }}>: 48px;</span>
                  </div>
                </div>
                <p className="panel-kicker">Code snippet</p>
                <div
                  className="side-code-block"
                  style={{
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  <span style={{ color: "#e06c75" }}>&lt;div</span>{" "}
                  <span style={{ color: "#d19a66" }}>className</span>=
                  <span style={{ color: "#98c379" }}>"hero-section"</span>
                  <span style={{ color: "#e06c75" }}>&gt;</span>
                  {`\n  `}
                  <span style={{ color: "#e06c75" }}>&lt;h1&gt;</span>Build
                  better product taste...
                  <span style={{ color: "#e06c75" }}>&lt;/h1&gt;</span>
                  {`\n`}
                  <span style={{ color: "#e06c75" }}>&lt;/div&gt;</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="panel-closed-state">
            <button
              className="panel-toggle-btn"
              onClick={() => setRightPanelOpen(true)}
              title="Open Sidebar"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          </div>
        )}
      </aside>

      <div className="figma-floating-toolbar">
        <div className="figma-tools">
          <button
            className={selectedTool === "move" ? "is-selected" : ""}
            onClick={() => setSelectedTool("move")}
            data-tooltip="Move Tool"
          >
            <ArrowIcon />
          </button>
          <button
            className={selectedTool === "hand" ? "is-selected" : ""}
            onClick={() => setSelectedTool("hand")}
            data-tooltip="Hand Tool"
          >
            <HandIcon />
          </button>
          <div className="frame-tool-picker" ref={frameToolPickerRef}>
            <button
              className={selectedTool === "frame" ? "is-selected" : ""}
              onClick={() => {
                setSelectedTool("frame");
                setShowFrameToolMenu((isOpen) => !isOpen);
              }}
              data-tooltip="Frame Tool"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
            </button>
            {showFrameToolMenu && (
              <div className="frame-tool-menu">
                <button
                  className={frameToolKind === "frame" ? "is-active" : ""}
                  onClick={() => selectFrameToolKind("frame")}
                  type="button"
                >
                  <span className="frame-tool-check">
                    {frameToolKind === "frame" ? <CheckIcon /> : null}
                  </span>
                  <span className="frame-tool-glyph">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <rect x="5" y="5" width="14" height="14" rx="1.5" />
                      <path d="M5 10h14M10 19v-9" />
                    </svg>
                  </span>
                  <strong>Frame</strong>
                  <kbd>F</kbd>
                </button>
                <button
                  className={frameToolKind === "section" ? "is-active" : ""}
                  onClick={() => selectFrameToolKind("section")}
                  type="button"
                >
                  <span className="frame-tool-check">
                    {frameToolKind === "section" ? <CheckIcon /> : null}
                  </span>
                  <span className="frame-tool-glyph">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <rect x="4" y="4" width="16" height="16" rx="2" />
                    </svg>
                  </span>
                  <strong>Section</strong>
                  <kbd>S</kbd>
                </button>
                <button
                  className={frameToolKind === "slice" ? "is-active" : ""}
                  onClick={() => selectFrameToolKind("slice")}
                  type="button"
                >
                  <span className="frame-tool-check">
                    {frameToolKind === "slice" ? <CheckIcon /> : null}
                  </span>
                  <span className="frame-tool-glyph">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path d="M4 20 20 4M8 20l12-12M4 16 16 4" />
                    </svg>
                  </span>
                  <strong>Slice</strong>
                  <kbd>S</kbd>
                </button>
              </div>
            )}
          </div>
          <div className="frame-tool-picker" ref={shapeToolPickerRef}>
            <button
              className={selectedTool === "shape" ? "is-selected" : ""}
              onClick={() => {
                setSelectedTool("shape");
                setShowShapeToolMenu((isOpen) => !isOpen);
              }}
              data-tooltip="Shape Tool"
            >
              <ShapeToolIcon kind={shapeToolKind} />
            </button>
            {showShapeToolMenu && (
              <div className="frame-tool-menu shape-tool-menu">
                {shapeToolOptions.map((option) => (
                  <button
                    className={shapeToolKind === option.kind ? "is-active" : ""}
                    key={option.kind}
                    onClick={() => selectShapeToolKind(option.kind)}
                    type="button"
                  >
                    <span className="frame-tool-check">
                      {shapeToolKind === option.kind ? <CheckIcon /> : null}
                    </span>
                    <span className="frame-tool-glyph">
                      <ShapeToolIcon kind={option.kind} />
                    </span>
                    <strong>{option.label}</strong>
                    <kbd>{option.shortcut}</kbd>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className={selectedTool === "pen" ? "is-selected" : ""}
            onClick={() => setSelectedTool("pen")}
            data-tooltip="Pen Tool"
          >
            <PenIcon />
          </button>
          <button
            className={selectedTool === "eraser" ? "is-selected" : ""}
            onClick={() => setSelectedTool("eraser")}
            data-tooltip="Eraser Tool"
          >
            <EraserIcon />
          </button>
          <button
            className={selectedTool === "text" ? "is-selected" : ""}
            onClick={() => setSelectedTool("text")}
            data-tooltip="Text Tool"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="4 7 4 4 20 4 20 7" />
              <line x1="9" y1="20" x2="15" y2="20" />
              <line x1="12" y1="4" x2="12" y2="20" />
            </svg>
          </button>
          <div
            style={{
              width: "1px",
              height: "1.5rem",
              background: "var(--line)",
              margin: "0 0.25rem",
            }}
          />
          <button
            className={selectedTool === "resources" ? "is-selected" : ""}
            onClick={() => setSelectedTool("resources")}
            data-tooltip="Resources Tool"
          >
            <ResourcesIcon />
          </button>
          <button
            className={selectedTool === "comment" ? "is-selected" : ""}
            onClick={() => setSelectedTool("comment")}
            data-tooltip="Comment Tool"
          >
            <CommentIcon />
          </button>
        </div>

        {/* Zoom indicator */}
        <div
          className="figma-zoom-indicator"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginLeft: "1rem",
            padding: "0.5rem 1rem",
            background: "var(--surface-raised)",
            borderRadius: "8px",
            fontSize: "0.85rem",
            fontWeight: 500,
          }}
        >
          <button
            className="icon-button"
            onClick={() => setCamera({ x: 0, y: 0, z: 1 })}
            style={{
              width: "28px",
              height: "28px",
              padding: "4px",
              background: "transparent",
              border: "none",
            }}
            title="Reset view (100%)"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M8 12h8" />
            </svg>
          </button>
          <span style={{ minWidth: "50px", textAlign: "center" }}>
            {Math.round(camera.z * 100)}%
          </span>
          <button
            className="icon-button"
            onClick={() =>
              setCamera((prev) => ({ ...prev, z: Math.max(0.1, prev.z - 0.1) }))
            }
            style={{
              width: "28px",
              height: "28px",
              padding: "4px",
              background: "transparent",
              border: "none",
            }}
            title="Zoom out"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12h8" />
            </svg>
          </button>
          <button
            className="icon-button"
            onClick={() =>
              setCamera((prev) => ({ ...prev, z: Math.min(5, prev.z + 0.1) }))
            }
            style={{
              width: "28px",
              height: "28px",
              padding: "4px",
              background: "transparent",
              border: "none",
            }}
            title="Zoom in"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v8M8 12h8" />
            </svg>
          </button>
        </div>
      </div>
    </main>
  );
}

function ArtboardSizeBadge({
  size,
  isMenuOpen,
  onToggleMenu,
  onCloseMenu,
  onSelectPreset,
  onSetCustomSize,
}: {
  size: { width: number; height: number; presetId: string | null };
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onSelectPreset: (preset: ArtboardPreset) => void;
  onSetCustomSize: (width: number, height: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [customWidth, setCustomWidth] = useState(String(size.width));
  const [customHeight, setCustomHeight] = useState(String(size.height));

  useEffect(() => {
    setCustomWidth(String(size.width));
    setCustomHeight(String(size.height));
  }, [size.width, size.height]);

  // Click outside the popover to dismiss it.
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onCloseMenu();
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [isMenuOpen, onCloseMenu]);

  const matchedPreset = artboardPresets.find((p) => p.id === size.presetId);
  const label = matchedPreset
    ? matchedPreset.label
    : `${Math.round(size.width)} × ${Math.round(size.height)}`;

  // Group presets by their `group` field for the menu.
  const groupOrder: ArtboardPreset["group"][] = [
    "Desktop",
    "Tablet",
    "Phone",
    "Social",
    "Print",
  ];
  const grouped = groupOrder.map((group) => ({
    group,
    presets: artboardPresets.filter((p) => p.group === group),
  }));

  const commitCustom = () => {
    const w = Number.parseInt(customWidth, 10);
    const h = Number.parseInt(customHeight, 10);
    if (Number.isFinite(w) && Number.isFinite(h)) {
      onSetCustomSize(w, h);
    }
  };

  return (
    <div
      className="artboard-size-badge"
      ref={containerRef}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="artboard-size-pill"
        onClick={onToggleMenu}
        title="Artboard size"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="1.5" y="2.5" width="10" height="8" rx="1" />
          <path d="M3.5 13h6" />
        </svg>
        <span className="artboard-size-label">{label}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            transform: isMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 120ms ease",
          }}
        >
          <path d="M2 4 L5 7 L8 4" />
        </svg>
      </button>
      {isMenuOpen && (
        <div className="artboard-size-menu" role="menu">
          <div className="artboard-size-menu-custom">
            <span className="artboard-size-menu-heading">Custom</span>
            <div className="artboard-size-menu-inputs">
              <label>
                <span>W</span>
                <input
                  type="number"
                  min={1}
                  value={customWidth}
                  onChange={(e) => setCustomWidth(e.target.value)}
                  onBlur={commitCustom}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitCustom();
                      onCloseMenu();
                    }
                  }}
                />
              </label>
              <label>
                <span>H</span>
                <input
                  type="number"
                  min={1}
                  value={customHeight}
                  onChange={(e) => setCustomHeight(e.target.value)}
                  onBlur={commitCustom}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitCustom();
                      onCloseMenu();
                    }
                  }}
                />
              </label>
            </div>
          </div>
          {grouped.map(({ group, presets }) =>
            presets.length === 0 ? null : (
              <div key={group} className="artboard-size-menu-group">
                <span className="artboard-size-menu-heading">{group}</span>
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`artboard-size-menu-item ${
                      preset.id === size.presetId ? "is-active" : ""
                    }`}
                    onClick={() => onSelectPreset(preset)}
                  >
                    <span className="artboard-size-menu-item-label">
                      {preset.label}
                    </span>
                    {preset.id === size.presetId ? (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M2.5 6.5 L5 9 L9.5 3.5" />
                      </svg>
                    ) : null}
                  </button>
                ))}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 120ms ease",
      }}
    >
      <path d="M3 2 L7 5 L3 8" />
    </svg>
  );
}

function InfiniteGrid({
  camera,
}: {
  camera: { x: number; y: number; z: number };
}) {
  // Grid dot spacing in design (canvas) coordinates.
  const baseSize = 24;

  // Adaptive density: keep dots between ~12 and ~48 px on screen at any zoom.
  // This is what creates the "infinite" feeling when zooming in/out — the grid
  // never disappears nor becomes a solid wash.
  let gridSize = baseSize * camera.z;
  while (gridSize < 12) {
    gridSize *= 2;
  }
  while (gridSize > 48) {
    gridSize /= 2;
  }

  // Anchor the pattern to canvas (0, 0) so the grid pans with content.
  const offsetX = (((camera.x * camera.z) % gridSize) + gridSize) % gridSize;
  const offsetY = (((camera.y * camera.z) % gridSize) + gridSize) % gridSize;

  // Slight major/minor split: every 4th cell gets a stronger dot for readability.
  const majorSize = gridSize * 4;
  const majorOffsetX =
    (((camera.x * camera.z) % majorSize) + majorSize) % majorSize;
  const majorOffsetY =
    (((camera.y * camera.z) % majorSize) + majorSize) % majorSize;

  return (
    <svg
      aria-hidden="true"
      className="infinite-grid"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    >
      <defs>
        <pattern
          id="canvas-grid-minor"
          width={gridSize}
          height={gridSize}
          x={offsetX}
          y={offsetY}
          patternUnits="userSpaceOnUse"
        >
          <circle
            cx={gridSize / 2}
            cy={gridSize / 2}
            r={1}
            className="infinite-grid-dot"
          />
        </pattern>
        <pattern
          id="canvas-grid-major"
          width={majorSize}
          height={majorSize}
          x={majorOffsetX}
          y={majorOffsetY}
          patternUnits="userSpaceOnUse"
        >
          <circle
            cx={majorSize / 2}
            cy={majorSize / 2}
            r={1.6}
            className="infinite-grid-dot infinite-grid-dot-strong"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#canvas-grid-minor)" />
      <rect width="100%" height="100%" fill="url(#canvas-grid-major)" />
    </svg>
  );
}

// The canvas/artboard itself is intentionally always 100% opaque with
// square corners — those are properties of *elements* on the canvas,
// not the canvas itself. Anything that needs to know "what does the
// artboard look like" should use these constants.
const ARTBOARD_FILL_OPACITY = 100;
const ARTBOARD_CORNER_RADIUS = 0;

function DesignCanvas({
  activeFrame,
  onFrameElementChange,
  project,
  artboardSize,
  artboardName,
  artboardFill,
  artboardElevation,
  isVisible,
}: {
  activeFrame: FrameMode;
  onFrameElementChange: (element: HTMLDivElement | null) => void;
  project: TasteProject;
  artboardSize: { width: number; height: number };
  artboardName: string;
  artboardFill: string;
  artboardElevation: boolean;
  isVisible: boolean;
}) {
  const draft = project.currentDraft;
  const showDraft = activeFrame === "after" && draft;
  const regions = project.latestEvaluation?.attentionRegions ?? [];

  // The canvas itself is always fully opaque and square-cornered. Element-
  // level fills/radii still apply to children, but the artboard background
  // is never see-through and never has rounded corners.
  const background = artboardFill.startsWith("#")
    ? hexToRgba(artboardFill, ARTBOARD_FILL_OPACITY)
    : artboardFill;

  // The artboard remains in the scene for measurement even when hidden behind
  // the generated scratch image.
  return (
    <div
      className={`canvas-comparison single-frame is-${activeFrame}`}
      style={{ opacity: isVisible ? 1 : 0 }}
    >
      <div className="comparison-column after-column">
        <strong>
          {artboardName || (showDraft && draft ? draft.title : "Project brief")}
        </strong>
        <div
          className="attention-preview-frame"
          ref={onFrameElementChange}
          style={{
            position: "relative",
            width: `${artboardSize.width}px`,
            height: `${artboardSize.height}px`,
            // Override the prior CSS-driven max width / min height so the
            // state-driven values always win.
            maxWidth: "none",
            minHeight: 0,
            background,
            borderRadius: `${ARTBOARD_CORNER_RADIUS}px`,
            boxShadow: artboardElevation ? "var(--shadow-soft)" : "none",
          }}
        >
          {showDraft && <AttentionOverlay regions={regions} />}
        </div>
      </div>
    </div>
  );
}

function PositionedGazeArtboardOverlay({
  analysis,
  bounds,
  showOverlay,
  showFixations,
  cornerRadius,
}: {
  analysis: GazeAnalysis;
  bounds: CanvasBounds;
  showOverlay: boolean;
  showFixations: boolean;
  cornerRadius: number;
}) {
  return (
    <div
      className="gaze-artboard-positioner"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }}
    >
      <GazeArtboardOverlay
        analysis={analysis}
        showOverlay={showOverlay}
        showFixations={showFixations}
        cornerRadius={cornerRadius}
      />
    </div>
  );
}

// Heatmap overlay + numbered fixation pins drawn on top of the artboard.
// Sized to fill its parent (.attention-preview-frame). Coordinates from the
// model are normalized [0, 1] so we don't need the artboard's pixel size.
function GazeArtboardOverlay({
  analysis,
  showOverlay,
  showFixations,
  cornerRadius,
}: {
  analysis: GazeAnalysis;
  showOverlay: boolean;
  showFixations: boolean;
  cornerRadius: number;
}) {
  return (
    <div
      className="gaze-artboard-overlay"
      style={{ borderRadius: `${Math.max(0, cornerRadius)}px` }}
      aria-label="Gaze prediction overlay"
    >
      {showOverlay && analysis.heatmap_b64 ? (
        <div
          aria-hidden="true"
          className="gaze-artboard-heatmap"
          style={{
            borderRadius: `${Math.max(0, cornerRadius)}px`,
            WebkitMaskImage: `url(data:image/png;base64,${analysis.heatmap_b64})`,
            maskImage: `url(data:image/png;base64,${analysis.heatmap_b64})`,
          }}
        />
      ) : null}

      {showFixations && analysis.fixations.length > 0 ? (
        <svg
          className="gaze-artboard-pins"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* Saccade path between consecutive fixations. */}
          {analysis.fixations.length > 1 ? (
            <polyline
              className="gaze-artboard-saccade"
              fill="none"
              points={analysis.fixations
                .map((f) => `${f.x * 100},${f.y * 100}`)
                .join(" ")}
            />
          ) : null}
        </svg>
      ) : null}

      {showFixations &&
        analysis.fixations.map((fix) => {
          // Bigger circle = longer dwell. Clamp to a reasonable visual range.
          const ms = Math.max(50, Math.min(2000, fix.dwell_ms));
          const radiusPct = 1.4 + (ms / 2000) * 1.6; // 1.4% – 3.0% of frame
          return (
            <span
              key={fix.fixation_index}
              className="gaze-fixation-pin"
              style={{
                left: `${fix.x * 100}%`,
                top: `${fix.y * 100}%`,
                width: `calc(${radiusPct * 2}% + 22px)`,
                height: `calc(${radiusPct * 2}% + 22px)`,
              }}
            >
              <span className="gaze-fixation-pin-label">
                {fix.fixation_index}
              </span>
            </span>
          );
        })}
    </div>
  );
}

function GeneratedReferenceImageLayer({
  bounds,
  fallbackFill,
  image,
  isVisible,
}: {
  bounds: CanvasBounds | null;
  fallbackFill: string;
  image: AgentReferenceImage;
  isVisible: boolean;
}) {
  const imageSrc = getArtifactImageSrc(image?.artifactKey);

  if (!bounds || !imageSrc || !isVisible) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        background: fallbackFill,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <img
        alt=""
        src={imageSrc}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "contain",
          objectPosition: "center",
        }}
      />
    </div>
  );
}

function getShapeElementBounds(
  kind: ShapeToolKind,
  start: { x: number; y: number },
  end: { x: number; y: number },
  useDefaultSize: boolean,
) {
  if (useDefaultSize) {
    if (kind === "line" || kind === "arrow") {
      return { x: start.x, y: start.y, width: 128, height: 0 };
    }

    if (kind === "boundary" || kind === "rounded-boundary") {
      return { x: start.x, y: start.y, width: 160, height: 96 };
    }

    return {
      x: start.x,
      y: start.y,
      width: kind === "ellipse" ? 96 : 112,
      height: kind === "ellipse" ? 96 : 88,
    };
  }

  if (kind === "line" || kind === "arrow") {
    return {
      x: start.x,
      y: start.y,
      width: end.x - start.x,
      height: end.y - start.y,
    };
  }

  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function getCanvasElementCornerRadius(element: CanvasElement) {
  const width = Math.abs(element.width ?? 100);
  const height = Math.abs(element.height ?? 100);
  const maxRadius = Math.min(width, height) / 2;

  if (typeof element.style?.cornerScale === "number") {
    return Math.max(
      0,
      Math.min(maxRadius, Math.min(width, height) * element.style.cornerScale),
    );
  }

  return Math.max(0, Math.min(maxRadius, element.style?.cornerRadius ?? 0));
}

function isShapeElementType(type: CanvasElement["type"]) {
  return (
    type === "rectangle" ||
    type === "line" ||
    type === "arrow" ||
    type === "ellipse" ||
    type === "polygon" ||
    type === "star" ||
    type === "boundary" ||
    type === "rounded-boundary"
  );
}

function isResizableCanvasElementType(type: CanvasElement["type"]) {
  return (
    type === "frame" ||
    type === "section" ||
    type === "slice" ||
    type === "text" ||
    type === "button" ||
    type === "image" ||
    isShapeElementType(type) ||
    type === "comment"
  );
}

function getResizeDirection(handle: string) {
  return handle.replace("-resize", "");
}

function getResizedElementGeometry(
  element: CanvasElement,
  direction: string,
  resize: {
    pointerX: number;
    pointerY: number;
    start: {
      pointerX: number;
      pointerY: number;
      elementX: number;
      elementY: number;
      width: number;
      height: number;
    };
  },
): Pick<CanvasElement, "x" | "y" | "width" | "height"> {
  const dx = resize.pointerX - resize.start.pointerX;
  const dy = resize.pointerY - resize.start.pointerY;

  if (element.type === "line" || element.type === "arrow") {
    const startX = resize.start.elementX;
    const startY = resize.start.elementY;
    const endX = resize.start.elementX + resize.start.width;
    const endY = resize.start.elementY + resize.start.height;
    const nextStartX = direction.includes("w") ? startX + dx : startX;
    const nextStartY = direction.includes("n") ? startY + dy : startY;
    const nextEndX = direction.includes("e") ? endX + dx : endX;
    const nextEndY = direction.includes("s") ? endY + dy : endY;

    return {
      x: nextStartX,
      y: nextStartY,
      width: nextEndX - nextStartX,
      height: nextEndY - nextStartY,
    };
  }

  const minSize = element.type === "slice" ? 1 : 8;
  let left = resize.start.elementX;
  let top = resize.start.elementY;
  let right = resize.start.elementX + resize.start.width;
  let bottom = resize.start.elementY + resize.start.height;

  if (direction.includes("w")) left += dx;
  if (direction.includes("e")) right += dx;
  if (direction.includes("n")) top += dy;
  if (direction.includes("s")) bottom += dy;

  if (right < left) {
    [left, right] = [right, left];
  }

  if (bottom < top) {
    [top, bottom] = [bottom, top];
  }

  return {
    x: left,
    y: top,
    width: Math.max(minSize, right - left),
    height: Math.max(minSize, bottom - top),
  };
}

// Approximate axis-aligned bounding box for an element in canvas
// coordinates. Used for hit-testing and selection bounds.
function fitCanvasTextElement(
  element: CanvasElement,
  options: { force?: boolean } = {},
): CanvasElement {
  if (element.type !== "text") return element;

  const fit = fitTextBounds({
    text: element.content ?? "",
    bounds: { width: element.width, height: element.height },
    style: element.style,
  });

  if (
    !options.force &&
    element.width === fit.width &&
    element.height === fit.height
  ) {
    return element;
  }

  return {
    ...element,
    width: fit.width,
    height: fit.height,
  };
}

function getCanvasTextFitAudit(element: CanvasElement): TextFitAudit {
  return auditTextFit({
    text: element.content ?? "",
    bounds: { width: element.width, height: element.height },
    style: element.style,
  });
}

function getElementBounds(element: CanvasElement) {
  if (element.type === "text") {
    const fontSize = element.style?.fontSize ?? 16;
    const content = element.content ?? "";
    const lineHeight = element.style?.lineHeight ?? 1.5;
    const longestLine = Math.max(
      1,
      ...content.split("\n").map((line) => line.length),
    );
    // Empirical fallback for old nodes that do not yet have bounds.
    const width = element.width ?? Math.max(40, longestLine * fontSize * 0.6);
    const estimatedLines = Math.max(
      1,
      content.split("\n").reduce((count, line) => {
        const charsPerLine = Math.max(1, Math.floor(width / (fontSize * 0.56)));
        return count + Math.max(1, Math.ceil(line.length / charsPerLine));
      }, 0),
    );
    const height =
      element.height ??
      Math.max(fontSize * lineHeight, estimatedLines * fontSize * lineHeight);
    return { x: element.x, y: element.y, width, height };
  }

  if (element.type === "path" && element.points && element.points.length > 0) {
    const xs = element.points.map((p) => p.x);
    const ys = element.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const padding = Math.max(4, (element.style?.strokeWidth ?? 2) / 2 + 4);
    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    };
  }

  if (element.type === "line" || element.type === "arrow") {
    const x2 = element.x + (element.width ?? 100);
    const y2 = element.y + (element.height ?? 0);
    const minX = Math.min(element.x, x2);
    const minY = Math.min(element.y, y2);
    const maxX = Math.max(element.x, x2);
    const maxY = Math.max(element.y, y2);
    return {
      x: minX - 4,
      y: minY - 4,
      width: Math.max(8, maxX - minX + 8),
      height: Math.max(8, maxY - minY + 8),
    };
  }

  if (element.type === "comment") {
    // The interactive surface is just the pin. The region (if any) is a
    // visual overlay only — clicks on the transparent region should fall
    // through to the artboard underneath.
    const pinX = element.x + (element.width ?? 0);
    const pinY = element.y;
    return { x: pinX - 14, y: pinY - 28, width: 28, height: 28 };
  }

  return {
    x: element.x,
    y: element.y,
    width: element.width ?? 100,
    height: element.height ?? 100,
  };
}

function createCommentEditContext(input: {
  comment: CanvasElement;
  elements: CanvasElement[];
  activeViewId: string;
  selectedElementIds: string[];
}): EditContext {
  const commentBounds = getCommentRegionBounds(input.comment);
  const commentText = (input.comment.content ?? "").toLowerCase();
  const imageEditIntent = mentionsImageEdit(commentText);
  const visibleNodes = input.elements.filter(
    (element) =>
      element.type !== "comment" &&
      element.type !== "folder" &&
      (!element.viewId || element.viewId === input.activeViewId) &&
      element.role !== "reference-guide",
  );
  const directNodeIds = visibleNodes
    .filter((element) =>
      boundsIntersect(getElementBounds(element), commentBounds),
    )
    .map((element) => element.id);
  const selectedNodeIds = input.selectedElementIds.filter((id) =>
    visibleNodes.some((element) => element.id === id),
  );
  const inferredNodeIds =
    directNodeIds.length === 0 && selectedNodeIds.length === 0
      ? inferCommentTargetNodeIds({
          comment: input.comment,
          commentBounds,
          nodes: visibleNodes,
        })
      : [];
  const targetNodeIds =
    directNodeIds.length > 0
      ? directNodeIds
      : selectedNodeIds.length > 0
        ? selectedNodeIds
        : inferredNodeIds;
  const targetResolution =
    directNodeIds.length > 0
      ? "direct"
      : selectedNodeIds.length > 0
        ? "selected"
        : inferredNodeIds.length > 0
          ? "inferred"
          : "unresolved";
  const targetConfidence =
    targetResolution === "direct"
      ? "high"
      : targetResolution === "selected"
        ? "high"
        : targetResolution === "inferred"
          ? "medium"
          : "none";
  const contextNodeIds = new Set([
    ...targetNodeIds,
    ...directNodeIds,
    ...selectedNodeIds,
    ...inferredNodeIds,
  ]);

  if (contextNodeIds.size === 0) {
    inferNearbyContextNodes({
      comment: input.comment,
      commentBounds,
      nodes: visibleNodes,
    }).forEach((element) => contextNodeIds.add(element.id));
  }

  return {
    source: "comment",
    viewId: input.activeViewId,
    commentBounds,
    selectedNodeIds,
    directNodeIds,
    inferredNodeIds,
    targetNodeIds,
    targetResolution,
    targetConfidence,
    imageEditIntent,
    nodes: visibleNodes
      .filter((element) => contextNodeIds.has(element.id))
      .map((element) =>
        canvasElementToEditSummary(element, {
          directNodeIds,
          inferredNodeIds,
          imageEditIntent,
          selectedNodeIds,
          targetNodeIds,
        }),
      ),
  };
}

function createInspectorEditContext(input: {
  activeViewId: string;
  elements: CanvasElement[];
  prompt: string;
  selectedElementIds: string[];
}): EditContext | undefined {
  const imageEditIntent = mentionsImageEdit(input.prompt.toLowerCase());
  const visibleNodes = input.elements.filter(
    (element) =>
      element.type !== "comment" &&
      element.type !== "folder" &&
      (!element.viewId || element.viewId === input.activeViewId) &&
      element.role !== "reference-guide",
  );
  const selectedNodeIds = input.selectedElementIds.filter((id) =>
    visibleNodes.some((element) => element.id === id),
  );

  if (selectedNodeIds.length === 0) {
    return undefined;
  }

  return {
    source: "inspector",
    viewId: input.activeViewId,
    commentBounds: null,
    selectedNodeIds,
    directNodeIds: selectedNodeIds,
    inferredNodeIds: [],
    targetNodeIds: selectedNodeIds,
    targetResolution: "selected",
    targetConfidence: "high",
    imageEditIntent,
    nodes: visibleNodes
      .filter((element) => selectedNodeIds.includes(element.id))
      .map((element) =>
        canvasElementToEditSummary(element, {
          directNodeIds: selectedNodeIds,
          inferredNodeIds: [],
          imageEditIntent,
          selectedNodeIds,
          targetNodeIds: selectedNodeIds,
        }),
      ),
  };
}

function getCommentRegionBounds(comment: CanvasElement): EditContextBounds {
  const width = Math.max(0, comment.width ?? 0);
  const height = Math.max(0, comment.height ?? 0);

  if (width > 0 && height > 0) {
    return { x: comment.x, y: comment.y, width, height };
  }

  return { x: comment.x - 24, y: comment.y - 24, width: 48, height: 48 };
}

function getCommentPreviewBounds(
  start: { x: number; y: number },
  end: { x: number; y: number },
): EditContextBounds | null {
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  if (Math.hypot(width, height) < 6) {
    return null;
  }

  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width,
    height,
  };
}

function inferCommentTargetNodeIds(input: {
  comment: CanvasElement;
  commentBounds: EditContextBounds;
  nodes: CanvasElement[];
}) {
  const text = (input.comment.content ?? "").toLowerCase();

  return inferNearbyContextNodes(input)
    .filter((element) => {
      if (isImageLikeElement(element) && !mentionsImageEdit(text)) return false;
      if (mentionsTextEdit(text)) {
        return element.type === "text" || element.type === "button";
      }
      if (mentionsNavEdit(text)) {
        return (
          element.type === "text" ||
          element.type === "button" ||
          element.type === "rectangle"
        );
      }
      return true;
    })
    .slice(0, 5)
    .map((element) => element.id);
}

function inferNearbyContextNodes(input: {
  comment: CanvasElement;
  commentBounds: EditContextBounds;
  nodes: CanvasElement[];
}) {
  const text = (input.comment.content ?? "").toLowerCase();

  return input.nodes
    .map((element) => ({
      element,
      score: scoreCommentTargetCandidate({
        element,
        region: input.commentBounds,
        commentText: text,
      }),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.element);
}

function scoreCommentTargetCandidate(input: {
  element: CanvasElement;
  region: EditContextBounds;
  commentText: string;
}) {
  const bounds = getElementBounds(input.element);
  const distance = boundsDistance(bounds, input.region);
  if (distance > 260) return 0;

  let score = Math.max(0, 260 - distance);
  if (mentionsTextEdit(input.commentText)) {
    score += input.element.type === "text" ? 160 : 0;
    score += input.element.type === "button" ? 80 : 0;
    score -= isImageLikeElement(input.element) ? 240 : 0;
  }
  if (mentionsNavEdit(input.commentText)) {
    const name = (input.element.name ?? "").toLowerCase();
    score += name.includes("nav") || bounds.y < 140 ? 140 : 0;
    score += input.element.type === "button" ? 60 : 0;
  }
  if (mentionsImageEdit(input.commentText)) {
    score += isImageLikeElement(input.element) ? 160 : 0;
  } else if (isImageLikeElement(input.element)) {
    score -= 80;
  }
  if (input.element.locked || input.element.exportable === false) {
    score -= 180;
  }

  return score;
}

function canvasElementToEditSummary(
  element: CanvasElement,
  context?: {
    selectedNodeIds: string[];
    directNodeIds: string[];
    inferredNodeIds: string[];
    targetNodeIds: string[];
    imageEditIntent: boolean;
  },
): EditContextNodeSummary {
  const isTarget = Boolean(context?.targetNodeIds.includes(element.id));
  const isDirect = Boolean(context?.directNodeIds.includes(element.id));
  const isSelected = Boolean(context?.selectedNodeIds.includes(element.id));
  const isInferred = Boolean(context?.inferredNodeIds.includes(element.id));
  const isImage = isImageLikeElement(element);
  const canMutate =
    isTarget && (!isImage || Boolean(context?.imageEditIntent && isDirect));
  const targetSource = isTarget
    ? "target"
    : isDirect
      ? "direct"
      : isSelected
        ? "selected"
        : isInferred
          ? "inferred"
          : "nearby";
  const textStyleRuns = element.content
    ? normalizeTextStyleRuns(element.textStyleRuns, element.content.length)
    : [];

  return {
    id: element.id,
    type: element.type,
    name: element.name ?? titleCase(element.type),
    bounds: getElementBounds(element),
    ...(element.content ? { text: element.content } : {}),
    ...(textStyleRuns.length > 0 ? { textStyleRuns } : {}),
    ...(element.artifactKey ? { artifactKey: element.artifactKey } : {}),
    ...(element.role ? { role: element.role } : {}),
    targetSource,
    canMutate,
    ...(isImage ? { imageLocked: !canMutate } : {}),
  };
}

function boundsIntersect(a: EditContextBounds, b: EditContextBounds) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function boundsDistance(a: EditContextBounds, b: EditContextBounds) {
  const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0);
  const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0);
  return Math.hypot(dx, dy);
}

function mentionsTextEdit(text: string) {
  return /\b(text|copy|spacing|line|letter|font|type|label|word|headline|nav|bar)\b/.test(
    text,
  );
}

function mentionsNavEdit(text: string) {
  return /\b(nav|navigation|top\s*bar|header|menu)\b/.test(text);
}

function mentionsImageEdit(text: string) {
  return /\b(image|photo|picture|crop|media|screenshot)\b/.test(text);
}

function isImageLikeElement(element: CanvasElement) {
  return element.type === "image";
}

function StyledTextRuns({
  text,
  runs,
}: {
  text: string;
  runs?: TextStyleRun[];
}) {
  const segments = splitTextIntoStyledSegments(text, runs);

  return (
    <>
      {segments.map((segment, index) => (
        <span
          key={`${index}-${segment.text}`}
          style={{
            fontWeight: segment.fontWeight,
            fontStyle: segment.fontStyle,
          }}
        >
          {segment.text}
        </span>
      ))}
    </>
  );
}

function CanvasRichTextEditor({
  element,
  zoom,
  textAlign,
  onUpdateElement,
  onRemoveElement,
  onEndEdit,
}: {
  element: CanvasElement;
  zoom: number;
  textAlign: "left" | "center" | "right";
  onUpdateElement: (elementId: string, updates: Partial<CanvasElement>) => void;
  onRemoveElement: (elementId: string) => void;
  onEndEdit: () => void;
}) {
  const initialText = element.content ?? "";
  const [text, setText] = useState(initialText);
  const [runs, setRuns] = useState<TextStyleRun[]>(
    normalizeTextStyleRuns(element.textStyleRuns, initialText.length),
  );
  const editorRef = useRef<HTMLDivElement>(null);
  const lastSelectionRef = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    const node = editorRef.current;
    if (!node) return;
    node.focus();
    placeCaretAtEnd(node);
    lastSelectionRef.current = { start: text.length, end: text.length };
  }, []);

  const commit = (nextText = text, nextRuns = runs) => {
    if (nextText.trim().length === 0) {
      onRemoveElement(element.id);
    } else {
      onUpdateElement(element.id, {
        content: nextText,
        textStyleRuns: normalizeTextStyleRuns(nextRuns, nextText.length),
      });
    }
    onEndEdit();
  };

  const saveSelection = () => {
    const node = editorRef.current;
    if (!node) return;
    const range = getEditableSelectionRange(node);
    if (range) {
      lastSelectionRef.current = range;
    }
  };

  const toggleInlineStyle = (
    style: Pick<TextStyleRun, "fontWeight" | "fontStyle">,
  ) => {
    const node = editorRef.current;
    if (!node) return;

    const currentText = getEditablePlainText(node);
    const selection =
      getEditableSelectionRange(node) ?? lastSelectionRef.current;
    if (!selection || selection.start === selection.end) {
      node.focus();
      return;
    }

    const nextRuns = toggleTextStyleRun({
      runs,
      textLength: currentText.length,
      selection,
      style,
    });

    setText(currentText);
    setRuns(nextRuns);
    lastSelectionRef.current = selection;
    requestAnimationFrame(() => node.focus());
  };

  return (
    <div
      className="canvas-rich-text-editor-shell"
      onBlur={(event) => {
        const nextFocusedNode = event.relatedTarget;
        if (
          nextFocusedNode instanceof Node &&
          event.currentTarget.contains(nextFocusedNode)
        ) {
          return;
        }
        commit();
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="canvas-rich-text-toolbar" aria-label="Text formatting">
        <button
          type="button"
          className="canvas-rich-text-button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggleInlineStyle({ fontWeight: "bold" })}
          title="Bold selected text"
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className="canvas-rich-text-button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggleInlineStyle({ fontStyle: "italic" })}
          title="Italicize selected text"
        >
          <em>I</em>
        </button>
      </div>
      <div
        ref={editorRef}
        className="canvas-text-editor"
        contentEditable
        suppressContentEditableWarning
        onInput={(event) => {
          const nextText = getEditablePlainText(event.currentTarget);
          setText(nextText);
          setRuns((current) =>
            normalizeTextStyleRuns(current, nextText.length),
          );
        }}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onPaste={(event) => {
          event.preventDefault();
          insertPlainTextAtSelection(event.clipboardData.getData("text/plain"));
          requestAnimationFrame(() => {
            const node = editorRef.current;
            if (!node) return;
            const nextText = getEditablePlainText(node);
            setText(nextText);
            setRuns((current) =>
              normalizeTextStyleRuns(current, nextText.length),
            );
            saveSelection();
          });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            commit(getEditablePlainText(event.currentTarget), runs);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onEndEdit();
          }
        }}
        style={{
          width: "100%",
          height: "100%",
          padding: "4px 6px",
          border: `${2 / Math.max(zoom, 0.001)}px solid var(--blue)`,
          borderRadius: 4 / Math.max(zoom, 0.001),
          background: "transparent",
          color: element.style?.fill || "var(--ink)",
          fontSize: element.style?.fontSize ?? 16,
          fontFamily: element.style?.fontFamily || DEFAULT_CANVAS_FONT,
          fontWeight: element.style?.fontWeight || "normal",
          fontStyle: element.style?.fontStyle || "normal",
          letterSpacing: element.style?.letterSpacing ?? 0,
          lineHeight: element.style?.lineHeight ?? 1.5,
          textAlign,
          outline: "none",
          boxSizing: "border-box",
        }}
      >
        <StyledTextRuns text={text} runs={runs} />
      </div>
    </div>
  );
}

function getEditablePlainText(node: HTMLElement) {
  return node.innerText.replace(/\u00a0/g, " ").replace(/\n$/, "");
}

function getEditableSelectionRange(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return null;
  }

  const beforeStart = range.cloneRange();
  beforeStart.selectNodeContents(root);
  beforeStart.setEnd(range.startContainer, range.startOffset);

  const beforeEnd = range.cloneRange();
  beforeEnd.selectNodeContents(root);
  beforeEnd.setEnd(range.endContainer, range.endOffset);

  const length = getEditablePlainText(root).length;
  const start = Math.max(0, Math.min(length, beforeStart.toString().length));
  const end = Math.max(0, Math.min(length, beforeEnd.toString().length));

  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

function placeCaretAtEnd(root: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function insertPlainTextAtSelection(text: string) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.setEndAfter(textNode);
  selection.removeAllRanges();
  selection.addRange(range);
}

// Inline editor for the canvas comment popover. Owns its draft state
// locally so the Post button can react to whether the textarea has any
// content, and so the textarea auto-grows as the user types.
function CanvasCommentEditor({
  initialValue,
  onCancel,
  onSubmit,
}: {
  initialValue: string;
  onCancel: () => void;
  onSubmit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea so single-line drafts feel snug while longer
  // ones expand to roughly six lines before scrolling. Capped so the
  // popover doesn't run off the viewport.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    const next = Math.min(180, Math.max(44, node.scrollHeight));
    node.style.height = `${next}px`;
  }, [draft]);

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(draft);
  };

  return (
    <div className="canvas-comment-editor-shell">
      <header className="canvas-comment-header">
        <div className="canvas-comment-avatar" aria-hidden>
          Y
        </div>
        <div className="canvas-comment-meta">
          <strong>You</strong>
          <span>Drafting…</span>
        </div>
      </header>
      <textarea
        ref={textareaRef}
        autoFocus
        className="canvas-comment-editor"
        value={draft}
        placeholder="Add a comment…"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            handleSubmit();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <footer className="canvas-comment-editor-footer">
        <span className="canvas-comment-editor-hint" aria-hidden>
          {/* On macOS the meta key is ⌘; we keep a generic glyph for
              cross-platform readability. The shortcut works on both. */}
          ⌘↵ to post
        </span>
        <div className="canvas-comment-editor-buttons">
          <button
            type="button"
            className="canvas-comment-editor-btn is-ghost"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="canvas-comment-editor-btn is-primary"
            disabled={!canSubmit}
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleSubmit}
          >
            Post
          </button>
        </div>
      </footer>
    </div>
  );
}

function ElementsLayer({
  elements,
  activeViewId,
  zoom,
  isVisible,
  currentPath,
  commentPreviewBounds,
  marqueeBox,
  penPreviewStyle,
  editingElementId,
  openCommentId,
  onSetOpenComment,
  onStartEdit,
  onEndEdit,
  onUpdateElement,
  onRemoveElement,
  onStartResize,
  artboardBounds,
  onStartArtboardResize,
  onResolveCommentWithAgent,
}: {
  elements: CanvasElement[];
  activeViewId: string;
  zoom: number;
  isVisible: boolean;
  currentPath: { x: number; y: number }[] | null;
  commentPreviewBounds: EditContextBounds | null;
  marqueeBox: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null;
  penPreviewStyle: PenSettings;
  editingElementId: string | null;
  openCommentId: string | null;
  onSetOpenComment: (elementId: string | null) => void;
  onStartEdit: (elementId: string) => void;
  onEndEdit: () => void;
  onUpdateElement: (elementId: string, updates: Partial<CanvasElement>) => void;
  onRemoveElement: (elementId: string) => void;
  onStartResize: (
    elementId: string,
    handle: string,
    clientX: number,
    clientY: number,
  ) => void;
  artboardBounds: CanvasBounds | null;
  onStartArtboardResize: (
    handle: string,
    clientX: number,
    clientY: number,
  ) => void;
  onResolveCommentWithAgent?: (comment: CanvasElement) => Promise<void>;
}) {
  // Keep selection chrome a constant pixel size on screen, regardless of
  // how zoomed in/out the camera is.
  const handleSize = 8 / Math.max(zoom, 0.001);
  const handleHitSize = 20 / Math.max(zoom, 0.001);
  const selectionStroke = 1 / Math.max(zoom, 0.001);
  const selectionInset = 4 / Math.max(zoom, 0.001);

  // Local hover state — persists only while the mouse is over the pin
  // or popover. Sticky-open is owned by the parent via openCommentId.
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const safeZoom = Math.max(zoom, 0.001);
  const artboardLayerTransform = artboardBounds
    ? `translate(${artboardBounds.x} ${artboardBounds.y})`
    : undefined;

  return (
    <svg
      className="elements-layer"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        opacity: isVisible ? 1 : 0,
        pointerEvents: "none",
        visibility: isVisible ? "visible" : "hidden",
      }}
    >
      <defs>
        {/* Soft drop shadow used by Figma-like frame elements. Defined once
            so every frame can reference it via filter="url(#frame-shadow)". */}
        <filter id="frame-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="0"
            dy="6"
            stdDeviation="8"
            floodColor="#000"
            floodOpacity="0.18"
          />
        </filter>
      </defs>
      <g transform={artboardLayerTransform}>
        {elements
          .filter(
            (element) =>
              element.type !== "folder" &&
              (!element.viewId || element.viewId === activeViewId),
          )
          .map((element) => {
            if (element.type === "frame") {
              const w = element.width ?? 100;
              const h = element.height ?? 100;
              const cornerRadius = element.style?.cornerRadius ?? 0;
              const elevation = element.style?.elevation ?? false;
              // Title label sits above the frame and scales inversely with
              // zoom so it always reads at a constant size on screen — like
              // Figma's frame labels.
              const titleFontSize = 12 / Math.max(zoom, 0.001);
              const titleOffset = 6 / Math.max(zoom, 0.001);
              return (
                <g key={element.id} className="canvas-frame-group">
                  <text
                    className="canvas-frame-title"
                    x={element.x}
                    y={element.y - titleOffset}
                    style={{
                      fontSize: titleFontSize,
                      fontFamily: "var(--font-sans, system-ui)",
                      fontWeight: 500,
                      fill: "var(--ink-faint, #6b7280)",
                      userSelect: "none",
                      pointerEvents: "none",
                    }}
                  >
                    {element.name ?? "Frame"}
                  </text>
                  <rect
                    x={element.x}
                    y={element.y}
                    width={w}
                    height={h}
                    rx={cornerRadius}
                    ry={cornerRadius}
                    fill={element.style?.fill || "#ffffff"}
                    stroke={element.style?.stroke || "transparent"}
                    strokeWidth={element.style?.strokeWidth ?? 0}
                    opacity={element.style?.opacity ?? 1}
                    filter={elevation ? "url(#frame-shadow)" : undefined}
                  />
                </g>
              );
            }
            if (
              element.type === "section" ||
              element.type === "slice" ||
              element.type === "rectangle" ||
              element.type === "boundary" ||
              element.type === "rounded-boundary"
            ) {
              const cornerRadius = getCanvasElementCornerRadius(element);
              return (
                <rect
                  key={element.id}
                  x={element.x}
                  y={element.y}
                  width={element.width ?? 100}
                  height={element.height ?? 100}
                  rx={cornerRadius}
                  ry={cornerRadius}
                  fill={element.style?.fill || "transparent"}
                  stroke={element.style?.stroke || "#333"}
                  strokeWidth={element.style?.strokeWidth ?? 1}
                  strokeDasharray={element.type === "slice" ? "6,6" : "none"}
                  opacity={element.style?.opacity ?? 1}
                />
              );
            }

            if (element.type === "button") {
              return (
                <foreignObject
                  key={element.id}
                  x={element.x}
                  y={element.y}
                  width={element.width ?? 180}
                  height={element.height ?? 56}
                  style={{ overflow: "visible", pointerEvents: "auto" }}
                >
                  <button
                    className="canvas-agent-button"
                    type="button"
                    onMouseDown={(event) => event.stopPropagation()}
                    style={{
                      background: element.style?.fill ?? "#1478f2",
                      borderColor: element.style?.stroke ?? "transparent",
                      color:
                        element.style?.color ??
                        element.style?.fill ??
                        "var(--ink)",
                      fontSize: element.style?.fontSize ?? 16,
                      fontFamily: element.style?.fontFamily,
                      fontWeight: element.style?.fontWeight ?? "800",
                      lineHeight: element.style?.lineHeight,
                      letterSpacing: element.style?.letterSpacing,
                    }}
                  >
                    {element.content}
                  </button>
                </foreignObject>
              );
            }

            if (element.type === "image") {
              return (
                <foreignObject
                  key={element.id}
                  x={element.x}
                  y={element.y}
                  width={element.width ?? 320}
                  height={element.height ?? 240}
                  style={{
                    overflow: "hidden",
                    pointerEvents: element.locked ? "none" : "auto",
                  }}
                >
                  <ImageNodePreview element={element} />
                </foreignObject>
              );
            }

            if (element.type === "ellipse") {
              const width = element.width ?? 100;
              const height = element.height ?? 100;
              return (
                <ellipse
                  key={element.id}
                  cx={element.x + width / 2}
                  cy={element.y + height / 2}
                  rx={Math.abs(width) / 2}
                  ry={Math.abs(height) / 2}
                  fill={element.style?.fill || "transparent"}
                  stroke={element.style?.stroke || "#333"}
                  strokeWidth={element.style?.strokeWidth ?? 1}
                  opacity={element.style?.opacity ?? 1}
                />
              );
            }

            if (element.type === "line" || element.type === "arrow") {
              const markerId = `arrowhead-${element.id}`;
              return (
                <g key={element.id}>
                  {element.type === "arrow" && (
                    <defs>
                      <marker
                        id={markerId}
                        markerHeight="8"
                        markerWidth="8"
                        orient="auto"
                        refX="7"
                        refY="4"
                        viewBox="0 0 8 8"
                      >
                        <path
                          d="M0 0 L8 4 L0 8"
                          fill="none"
                          stroke={element.style?.stroke || "#333"}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </marker>
                    </defs>
                  )}
                  <line
                    x1={element.x}
                    y1={element.y}
                    x2={element.x + (element.width ?? 100)}
                    y2={element.y + (element.height ?? 0)}
                    fill="none"
                    stroke={element.style?.stroke || "#333"}
                    strokeWidth={element.style?.strokeWidth ?? 2}
                    strokeLinecap="round"
                    markerEnd={
                      element.type === "arrow" ? `url(#${markerId})` : undefined
                    }
                    opacity={element.style?.opacity ?? 1}
                  />
                </g>
              );
            }

            if (element.type === "polygon" || element.type === "star") {
              const points =
                element.type === "polygon"
                  ? getPolygonPoints(element, 3)
                  : getStarPoints(element);
              return (
                <polygon
                  key={element.id}
                  points={points}
                  fill={element.style?.fill || "transparent"}
                  stroke={element.style?.stroke || "#333"}
                  strokeWidth={element.style?.strokeWidth ?? 1}
                  strokeLinejoin="round"
                  opacity={element.style?.opacity ?? 1}
                />
              );
            }

            if (element.type === "text") {
              const textAlign = element.style?.textAlign || "left";
              const bounds = getElementBounds(element);

              if (editingElementId === element.id) {
                const editorWidth = Math.max(bounds.width + 12, 72);
                const editorHeight = Math.max(bounds.height + 12, 36);

                return (
                  <foreignObject
                    key={element.id}
                    x={element.x - 6}
                    y={element.y - 6}
                    width={editorWidth}
                    height={editorHeight}
                    style={{ overflow: "visible", pointerEvents: "auto" }}
                  >
                    <CanvasRichTextEditor
                      element={element}
                      zoom={zoom}
                      textAlign={textAlign}
                      onUpdateElement={onUpdateElement}
                      onRemoveElement={onRemoveElement}
                      onEndEdit={onEndEdit}
                    />
                  </foreignObject>
                );
              }

              return (
                <foreignObject
                  key={element.id}
                  x={element.x}
                  y={element.y}
                  width={bounds.width}
                  height={bounds.height}
                  style={{ overflow: "visible", pointerEvents: "auto" }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onStartEdit(element.id);
                  }}
                >
                  <div
                    className="canvas-text-node"
                    style={{
                      width: "100%",
                      height: "100%",
                      color: element.style?.fill || "var(--ink)",
                      fontSize: element.style?.fontSize ?? 16,
                      fontFamily:
                        element.style?.fontFamily || DEFAULT_CANVAS_FONT,
                      opacity: element.style?.opacity ?? 1,
                      fontWeight: element.style?.fontWeight || "normal",
                      fontStyle: element.style?.fontStyle || "normal",
                      letterSpacing: element.style?.letterSpacing ?? 0,
                      lineHeight: element.style?.lineHeight ?? 1.5,
                      textAlign,
                      cursor: element.selected ? "move" : "text",
                    }}
                  >
                    <StyledTextRuns
                      text={element.content || ""}
                      runs={element.textStyleRuns}
                    />
                  </div>
                </foreignObject>
              );
            }

            if (element.type === "path" && element.points) {
              const pathData = `M ${element.points
                .map((p) => `${p.x} ${p.y}`)
                .join(" L ")}`;
              return (
                <path
                  key={element.id}
                  d={pathData}
                  fill={element.style?.fill || "none"}
                  stroke={element.style?.stroke || "#333"}
                  strokeWidth={element.style?.strokeWidth ?? 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={element.style?.opacity ?? 1}
                />
              );
            }

            if (element.type === "comment") {
              const regionWidth = element.width ?? 0;
              const regionHeight = element.height ?? 0;
              const hasRegion = regionWidth > 0 && regionHeight > 0;
              const pinX = element.x + regionWidth;
              const pinY = element.y;
              const isEditing = element.id === editingElementId;
              const isStickyOpen = element.id === openCommentId;
              const isHovered = element.id === hoveredCommentId;
              const isExpanded = isEditing || isStickyOpen || isHovered;

              return (
                <g key={element.id} className="comment-marker">
                  {/* Region overlay only shown while the comment is
                    expanded so the rest of the design stays readable. */}
                  {hasRegion && isExpanded && (
                    <rect
                      x={element.x}
                      y={element.y}
                      width={regionWidth}
                      height={regionHeight}
                      fill="rgba(20, 120, 242, 0.08)"
                      stroke="rgba(20, 120, 242, 0.55)"
                      strokeWidth={1.5 / safeZoom}
                      strokeDasharray={`${6 / safeZoom},${4 / safeZoom}`}
                      rx={4 / safeZoom}
                      pointerEvents="none"
                    />
                  )}

                  {/* The pin and popover are rendered at constant on-screen
                    size by inverse-scaling against the camera zoom. After
                    this transform the inner coordinates are in CSS pixels.
                    Both live inside one foreignObject so hover transitions
                    between pin and popover don't flicker. */}
                  <g
                    transform={`translate(${pinX} ${pinY}) scale(${1 / safeZoom})`}
                  >
                    <foreignObject
                      x={-2}
                      y={-32}
                      width={340}
                      height={240}
                      style={{ overflow: "visible", pointerEvents: "auto" }}
                    >
                      <div
                        className="canvas-comment-bubble-host"
                        data-open={isExpanded ? "true" : "false"}
                        data-sticky-open={isStickyOpen ? "true" : "false"}
                        data-editing={isEditing ? "true" : "false"}
                        onMouseOver={() => setHoveredCommentId(element.id)}
                        onMouseOut={(e) => {
                          // Only clear when truly leaving the wrapper, not
                          // when moving between the pin and the popover.
                          const next = e.relatedTarget;
                          if (
                            next instanceof Node &&
                            e.currentTarget.contains(next)
                          ) {
                            return;
                          }
                          setHoveredCommentId((current) =>
                            current === element.id ? null : current,
                          );
                        }}
                      >
                        <div
                          className="canvas-comment-pin"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isEditing) return;
                            onSetOpenComment(isStickyOpen ? null : element.id);
                          }}
                          title={element.content || "Comment"}
                        >
                          <CommentIcon />
                        </div>

                        <div
                          className="canvas-comment-popover"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isEditing ? (
                            <CanvasCommentEditor
                              initialValue={element.content ?? ""}
                              onCancel={() => {
                                if (
                                  (element.content ?? "").trim().length === 0
                                ) {
                                  onRemoveElement(element.id);
                                  onSetOpenComment(null);
                                }
                                onEndEdit();
                              }}
                              onSubmit={(next) => {
                                const trimmed = next.trim();
                                if (trimmed.length === 0) {
                                  onRemoveElement(element.id);
                                  onSetOpenComment(null);
                                } else {
                                  onUpdateElement(element.id, {
                                    content: next,
                                  });
                                  onSetOpenComment(element.id);
                                }
                                onEndEdit();
                              }}
                            />
                          ) : (
                            <>
                              <header className="canvas-comment-header">
                                <div
                                  className="canvas-comment-avatar"
                                  aria-hidden
                                >
                                  Y
                                </div>
                                <div className="canvas-comment-meta">
                                  <strong>You</strong>
                                  <span>just now</span>
                                </div>
                                <button
                                  type="button"
                                  className="canvas-comment-close"
                                  aria-label="Close"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSetOpenComment(null);
                                  }}
                                >
                                  ×
                                </button>
                              </header>
                              <p className="canvas-comment-body">
                                {element.content?.trim().length
                                  ? element.content
                                  : "(no comment yet)"}
                              </p>
                              <footer className="canvas-comment-actions">
                                <button
                                  type="button"
                                  className="canvas-comment-action"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (
                                      onResolveCommentWithAgent &&
                                      element.content
                                    ) {
                                      onResolveCommentWithAgent(element);
                                      onRemoveElement(element.id);
                                      onSetOpenComment(null);
                                    }
                                  }}
                                >
                                  Resolve with AI
                                </button>
                                <button
                                  type="button"
                                  className="canvas-comment-action"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onStartEdit(element.id);
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="canvas-comment-action is-danger"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onRemoveElement(element.id);
                                    onSetOpenComment(null);
                                  }}
                                >
                                  Delete
                                </button>
                              </footer>
                            </>
                          )}
                        </div>
                      </div>
                    </foreignObject>
                  </g>
                </g>
              );
            }

            return null;
          })}

        {/* Artboard resize chrome — eight handles around the design frame.
          Drawn beneath element selection chrome so a selected element's
          handles always win when they overlap the frame edges. */}
        {artboardBounds &&
          (() => {
            const x = 0;
            const y = 0;
            const w = artboardBounds.width;
            const h = artboardBounds.height;
            const handles: Array<{ x: number; y: number; cursor: string }> = [
              { x: x, y: y, cursor: "nw-resize" },
              { x: x + w, y: y, cursor: "ne-resize" },
              { x: x, y: y + h, cursor: "sw-resize" },
              { x: x + w, y: y + h, cursor: "se-resize" },
              { x: x + w / 2, y: y, cursor: "n-resize" },
              { x: x + w / 2, y: y + h, cursor: "s-resize" },
              { x: x, y: y + h / 2, cursor: "w-resize" },
              { x: x + w, y: y + h / 2, cursor: "e-resize" },
            ];
            return (
              <g className="artboard-frame-handles">
                {handles.map((handle, idx) => (
                  <g
                    key={`artboard-handle-${idx}`}
                    style={{ cursor: handle.cursor, pointerEvents: "auto" }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onStartArtboardResize(
                        handle.cursor,
                        event.clientX,
                        event.clientY,
                      );
                    }}
                  >
                    <rect
                      x={handle.x - handleHitSize / 2}
                      y={handle.y - handleHitSize / 2}
                      width={handleHitSize}
                      height={handleHitSize}
                      fill="transparent"
                      pointerEvents="all"
                    />
                    <rect
                      x={handle.x - handleSize / 2}
                      y={handle.y - handleSize / 2}
                      width={handleSize}
                      height={handleSize}
                      fill="var(--panel)"
                      stroke="var(--ink-faint)"
                      strokeWidth={selectionStroke}
                      pointerEvents="none"
                    />
                  </g>
                ))}
              </g>
            );
          })()}

        {/* Live preview while drawing a comment region. */}
        {commentPreviewBounds && (
          <rect
            x={commentPreviewBounds.x}
            y={commentPreviewBounds.y}
            width={commentPreviewBounds.width}
            height={commentPreviewBounds.height}
            fill="rgba(20, 120, 242, 0.08)"
            stroke="rgba(20, 120, 242, 0.72)"
            strokeWidth={1.5 / safeZoom}
            strokeDasharray={`${6 / safeZoom},${4 / safeZoom}`}
            rx={4 / safeZoom}
            pointerEvents="none"
          />
        )}

        {/* Live preview while drawing with the pen tool. */}
        {currentPath && currentPath.length > 1 && (
          <path
            d={`M ${currentPath.map((p) => `${p.x} ${p.y}`).join(" L ")}`}
            fill="none"
            stroke={penPreviewStyle.color}
            strokeWidth={penPreviewStyle.size}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={penPreviewStyle.opacity / 100}
          />
        )}

        {/* Selection chrome — drawn on top so handles are clickable.
          Comments have their own pin/popover chrome and opt out. Folders
          are organizational only and have no canvas bounds. */}
        {elements
          .filter(
            (el) =>
              el.selected &&
              el.type !== "comment" &&
              el.type !== "folder" &&
              !el.locked &&
              el.id !== editingElementId &&
              (!el.viewId || el.viewId === activeViewId),
          )
          .map((element) => {
            const bounds = getElementBounds(element);
            const x = bounds.x - selectionInset;
            const y = bounds.y - selectionInset;
            const w = bounds.width + selectionInset * 2;
            const h = bounds.height + selectionInset * 2;
            const handles = [
              { x: x, y: y, cursor: "nw-resize" },
              { x: x + w, y: y, cursor: "ne-resize" },
              { x: x, y: y + h, cursor: "sw-resize" },
              { x: x + w, y: y + h, cursor: "se-resize" },
              { x: x + w / 2, y: y, cursor: "n-resize" },
              { x: x + w / 2, y: y + h, cursor: "s-resize" },
              { x: x, y: y + h / 2, cursor: "w-resize" },
              { x: x + w, y: y + h / 2, cursor: "e-resize" },
            ];

            return (
              <g key={`bbox-${element.id}`} className="selection-frame">
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill="none"
                  stroke="var(--blue)"
                  strokeWidth={selectionStroke}
                />
                {handles.map((handle, idx) => (
                  <g
                    key={`handle-${idx}`}
                    style={{ cursor: handle.cursor, pointerEvents: "auto" }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onStartResize(
                        element.id,
                        handle.cursor,
                        e.clientX,
                        e.clientY,
                      );
                    }}
                  >
                    <rect
                      x={handle.x - handleHitSize / 2}
                      y={handle.y - handleHitSize / 2}
                      width={handleHitSize}
                      height={handleHitSize}
                      fill="transparent"
                      pointerEvents="all"
                    />
                    <rect
                      x={handle.x - handleSize / 2}
                      y={handle.y - handleSize / 2}
                      width={handleSize}
                      height={handleSize}
                      fill="var(--panel)"
                      stroke="var(--blue)"
                      strokeWidth={selectionStroke}
                      pointerEvents="none"
                    />
                  </g>
                ))}
              </g>
            );
          })}
      </g>

      {/* Rubber-band selection rectangle. Drawn last so it sits above
          everything else, including selection chrome, while the user is
          actively dragging out a selection. */}
      {marqueeBox &&
        (() => {
          const x = Math.min(marqueeBox.startX, marqueeBox.endX);
          const y = Math.min(marqueeBox.startY, marqueeBox.endY);
          const w = Math.abs(marqueeBox.endX - marqueeBox.startX);
          const h = Math.abs(marqueeBox.endY - marqueeBox.startY);
          if (w < 1 && h < 1) return null;
          return (
            <rect
              className="canvas-marquee"
              x={x}
              y={y}
              width={w}
              height={h}
              fill="rgba(20, 120, 242, 0.08)"
              stroke="var(--blue)"
              strokeWidth={1 / safeZoom}
              strokeDasharray={`${4 / safeZoom},${3 / safeZoom}`}
              pointerEvents="none"
            />
          );
        })()}
    </svg>
  );
}

// Inspector for the artboard / design frame itself. Shown in the right
// panel when no element is selected. Mirrors the structure of Figma's
// page properties: rename, dimensions with optional aspect lock, screen
// size templates, fill, corner radius, elevation, and quick actions.
function ArtboardInspectorPanel({
  name,
  onNameChange,
  size,
  onSizeChange,
  onSelectPreset,
  fill,
  onFillChange,
  lockAspect,
  onLockAspectChange,
  elevation,
  onElevationChange,
  project,
  gazeAnalysis,
  gazeBusy,
  gazeError,
  gazeShowOverlay,
  onGazeToggleOverlay,
  gazeShowFixations,
  onGazeToggleFixations,
  gazeApiStatus,
  onGazePredict,
  onGazePassToAgent,
  gazeAgentBusy,
  onGazeClear,
  onGazeRetryConnection,
}: {
  name: string;
  onNameChange: (next: string) => void;
  size: { width: number; height: number; presetId: string | null };
  onSizeChange: (width: number, height: number) => void;
  onSelectPreset: (preset: ArtboardPreset) => void;
  fill: string;
  onFillChange: (next: string) => void;
  lockAspect: boolean;
  onLockAspectChange: (next: boolean) => void;
  elevation: boolean;
  onElevationChange: (next: boolean) => void;
  project: TasteProject;
  gazeAnalysis: GazeAnalysis | null;
  gazeBusy: boolean;
  gazeError: string;
  gazeShowOverlay: boolean;
  onGazeToggleOverlay: () => void;
  gazeShowFixations: boolean;
  onGazeToggleFixations: () => void;
  gazeApiStatus: "idle" | "online" | "offline";
  onGazePredict: () => void;
  onGazePassToAgent: (additionalInfo?: string) => void;
  gazeAgentBusy: boolean;
  onGazeClear: () => void;
  onGazeRetryConnection: () => void;
}) {
  // Locally edited values for width / height so the user can finish typing
  // before we commit. We commit on blur / Enter.
  const [widthDraft, setWidthDraft] = useState(String(size.width));
  const [heightDraft, setHeightDraft] = useState(String(size.height));
  const [nameDraft, setNameDraft] = useState(name);

  useEffect(() => {
    setWidthDraft(String(size.width));
  }, [size.width]);
  useEffect(() => {
    setHeightDraft(String(size.height));
  }, [size.height]);
  useEffect(() => {
    setNameDraft(name);
  }, [name]);

  const commitDimensions = (
    nextWidthRaw: string,
    nextHeightRaw: string,
    driver: "width" | "height" | "both",
  ) => {
    let nextWidth = Number(nextWidthRaw);
    let nextHeight = Number(nextHeightRaw);
    if (!Number.isFinite(nextWidth) || nextWidth <= 0) nextWidth = size.width;
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
      nextHeight = size.height;
    }
    if (lockAspect && size.height > 0) {
      const ratio = size.width / size.height;
      if (driver === "width") {
        nextHeight = nextWidth / ratio;
      } else if (driver === "height") {
        nextWidth = nextHeight * ratio;
      }
    }
    onSizeChange(nextWidth, nextHeight);
  };

  const presetGroups: ArtboardPreset["group"][] = [
    "Desktop",
    "Tablet",
    "Phone",
    "Social",
    "Print",
  ];

  const matchedPreset = artboardPresets.find((p) => p.id === size.presetId);

  return (
    <div className="frame-inspector artboard-inspector">
      <section className="frame-inspector-section frame-kind-row">
        <input
          aria-label="Frame name"
          className="frame-kind-select artboard-name-input"
          onBlur={() => onNameChange(nameDraft.trim() || "Untitled")}
          onChange={(event) => setNameDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              (event.target as HTMLInputElement).blur();
            }
          }}
          value={nameDraft}
        />
        <span
          className="artboard-kind-pill"
          title="Selected screen size template"
        >
          {matchedPreset ? matchedPreset.group : "Custom"}
        </span>
      </section>

      <section className="frame-inspector-section">
        <div className="section-heading">
          <h3>Layout</h3>
          <button
            aria-label={
              lockAspect ? "Unlock aspect ratio" : "Lock aspect ratio"
            }
            aria-pressed={lockAspect}
            className={`visibility-btn ${lockAspect ? "is-on" : ""}`}
            onClick={() => onLockAspectChange(!lockAspect)}
            type="button"
          >
            {lockAspect ? "🔒" : "🔓"}
          </button>
        </div>
        <p className="property-label">Dimensions</p>
        <div className="property-grid two">
          <label className="mini-input">
            <span>W</span>
            <input
              inputMode="numeric"
              onBlur={() => commitDimensions(widthDraft, heightDraft, "width")}
              onChange={(event) => setWidthDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  (event.target as HTMLInputElement).blur();
                }
              }}
              value={widthDraft}
            />
          </label>
          <label className="mini-input">
            <span>H</span>
            <input
              inputMode="numeric"
              onBlur={() => commitDimensions(widthDraft, heightDraft, "height")}
              onChange={(event) => setHeightDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  (event.target as HTMLInputElement).blur();
                }
              }}
              value={heightDraft}
            />
          </label>
        </div>
        <div className="artboard-orientation-row">
          <button
            className={`artboard-orient-btn ${size.width >= size.height ? "is-on" : ""}`}
            onClick={() => {
              if (size.width < size.height) {
                onSizeChange(size.height, size.width);
              }
            }}
            type="button"
          >
            <span
              className="orient-glyph orient-landscape"
              aria-hidden="true"
            />
            Landscape
          </button>
          <button
            className={`artboard-orient-btn ${size.height > size.width ? "is-on" : ""}`}
            onClick={() => {
              if (size.height <= size.width) {
                onSizeChange(size.height, size.width);
              }
            }}
            type="button"
          >
            <span className="orient-glyph orient-portrait" aria-hidden="true" />
            Portrait
          </button>
        </div>
      </section>

      <section className="frame-inspector-section">
        <div className="section-heading">
          <h3>Templates</h3>
        </div>
        {presetGroups.map((group) => {
          const groupPresets = artboardPresets.filter((p) => p.group === group);
          if (groupPresets.length === 0) return null;
          return (
            <div className="artboard-preset-group" key={group}>
              <p className="property-label artboard-preset-group-label">
                {group}
              </p>
              <div className="preset-list">
                {groupPresets.map((preset) => (
                  <button
                    className={`preset-row ${
                      size.presetId === preset.id ? "is-active" : ""
                    }`}
                    key={preset.id}
                    onClick={() => onSelectPreset(preset)}
                    type="button"
                  >
                    <span>
                      <strong>{preset.label.replace(/\s*\(.*\)$/, "")}</strong>
                      <em>{preset.group}</em>
                    </span>
                    <span>
                      {preset.width} × {preset.height}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className="frame-inspector-section">
        <div className="section-heading">
          <h3>Appearance</h3>
          <button
            aria-label={elevation ? "Hide elevation" : "Show elevation"}
            aria-pressed={elevation}
            className={`visibility-btn ${elevation ? "is-on" : ""}`}
            onClick={() => onElevationChange(!elevation)}
            type="button"
            title="Toggle frame drop shadow"
          >
            ◌
          </button>
        </div>
      </section>

      <section className="frame-inspector-section">
        <div className="section-heading">
          <h3>Fill</h3>
        </div>
        {/* The artboard is intentionally always 100% opaque and square-
            cornered, so we only expose the color here — opacity and corner
            radius are properties of elements *on* the canvas, not the
            canvas itself. */}
        <div className="paint-row">
          <input
            aria-label="Frame fill color"
            onChange={(event) => onFillChange(event.target.value)}
            type="color"
            value={fill}
          />
          <input
            aria-label="Frame fill hex"
            onChange={(event) => onFillChange(event.target.value)}
            value={fill}
          />
        </div>
      </section>

      <section className="frame-inspector-section">
        <div className="section-heading">
          <h3>Brief</h3>
        </div>
        <p className="property-label artboard-brief-copy">{project.brief}</p>
      </section>

      <GazePredictionSection
        analysis={gazeAnalysis}
        busy={gazeBusy}
        error={gazeError}
        showOverlay={gazeShowOverlay}
        onToggleOverlay={onGazeToggleOverlay}
        showFixations={gazeShowFixations}
        onToggleFixations={onGazeToggleFixations}
        apiStatus={gazeApiStatus}
        onPredict={onGazePredict}
        onPassToAgent={onGazePassToAgent}
        agentBusy={gazeAgentBusy}
        onClear={onGazeClear}
        onRetryConnection={onGazeRetryConnection}
      />
    </div>
  );
}

function GazePredictionSection({
  analysis,
  busy,
  error,
  showOverlay,
  onToggleOverlay,
  showFixations,
  onToggleFixations,
  apiStatus,
  onPredict,
  onPassToAgent,
  agentBusy,
  onClear,
  onRetryConnection,
}: {
  analysis: GazeAnalysis | null;
  busy: boolean;
  error: string;
  showOverlay: boolean;
  onToggleOverlay: () => void;
  showFixations: boolean;
  onToggleFixations: () => void;
  apiStatus: "idle" | "online" | "offline";
  onPredict: () => void;
  onPassToAgent: (additionalInfo?: string) => void;
  agentBusy: boolean;
  onClear: () => void;
  onRetryConnection: () => void;
}) {
  const [agentNote, setAgentNote] = useState("");
  const statusLabel =
    apiStatus === "online"
      ? "Backend ready"
      : apiStatus === "offline"
        ? "Backend offline"
        : "Checking…";

  // Max dwell time for relative bar sizing
  const maxDwell = analysis
    ? Math.max(...analysis.fixations.map((f) => f.dwell_ms), 1)
    : 1;

  return (
    <section className="frame-inspector-section gaze-section">
      {/* ── Header ── */}
      <div className="gaze-header">
        <div className="gaze-header-left">
          <div className="gaze-icon-badge" aria-hidden="true">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            </svg>
          </div>
          <h3 className="gaze-title">Gaze Prediction</h3>
        </div>
        <button
          type="button"
          className={`gaze-status-pill is-${apiStatus}`}
          onClick={onRetryConnection}
          title="Click to re-check the gaze backend"
        >
          <span className="gaze-status-dot" aria-hidden="true" />
          {statusLabel}
        </button>
      </div>

      {/* ── Description ── */}
      <p className="gaze-blurb">
        Renders the artboard, runs a trained gaze model, and overlays the
        predicted scanpath and fixation points.
      </p>

      {/* ── Actions ── */}
      <div className="gaze-action-row">
        <button
          type="button"
          className="gaze-predict-btn"
          disabled={busy}
          onClick={onPredict}
        >
          {busy ? (
            <>
              <span className="gaze-spinner" aria-hidden="true" />
              Analyzing…
            </>
          ) : analysis ? (
            <>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 .49-3.51" />
              </svg>
              Re-run
            </>
          ) : (
            <>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              </svg>
              Predict gaze
            </>
          )}
        </button>
        {analysis ? (
          <button
            type="button"
            className="gaze-clear-btn"
            onClick={onClear}
            disabled={busy}
          >
            Clear
          </button>
        ) : null}
      </div>
      {analysis ? (
        <div className="gaze-agent-compose">
          <textarea
            aria-label="Additional gaze agent instructions"
            className="gaze-agent-input"
            disabled={busy || agentBusy}
            onChange={(event) => setAgentNote(event.target.value)}
            placeholder="Optional: tell the agent what to prioritize from this gaze map"
            rows={2}
            value={agentNote}
          />
          <button
            type="button"
            className="gaze-predict-btn gaze-agent-btn"
            disabled={busy || agentBusy}
            onClick={() => onPassToAgent(agentNote)}
          >
            {agentBusy ? (
              <>
                <span className="gaze-spinner" aria-hidden="true" />
                Passing…
              </>
            ) : (
              <>
                <SparkIcon />
                Pass into agent
              </>
            )}
          </button>
        </div>
      ) : null}

      {/* ── Offline help ── */}
      {apiStatus === "offline" ? (
        <div className="gaze-help-banner">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>
            Start the backend: <code>./apps/api/run_dev.sh</code>
          </span>
        </div>
      ) : null}

      {/* ── Error ── */}
      {error ? <p className="gaze-error-line">{error}</p> : null}

      {/* ── Results ── */}
      {analysis ? (
        <div className="gaze-results">
          {/* Stats row */}
          <div className="gaze-stats-row">
            <div className="gaze-stat-chip">
              <span className="gaze-stat-value">
                {analysis.fixations.length}
              </span>
              <span className="gaze-stat-label">Fixations</span>
            </div>
            <div className="gaze-stat-chip">
              <span className="gaze-stat-value">{analysis.n_frames}</span>
              <span className="gaze-stat-label">Frames</span>
            </div>
            {typeof analysis.elapsed_ms === "number" ? (
              <div className="gaze-stat-chip">
                <span className="gaze-stat-value">
                  {(analysis.elapsed_ms / 1000).toFixed(1)}s
                </span>
                <span className="gaze-stat-label">Runtime</span>
              </div>
            ) : null}
          </div>

          {/* Toggle switches */}
          <div className="gaze-toggles">
            <button
              type="button"
              role="switch"
              aria-checked={showOverlay}
              className={`gaze-toggle-btn${showOverlay ? " is-on" : ""}`}
              onClick={onToggleOverlay}
            >
              <span className="gaze-toggle-track">
                <span className="gaze-toggle-thumb" />
              </span>
              <span className="gaze-toggle-label">Heatmap</span>
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={showFixations}
              className={`gaze-toggle-btn${showFixations ? " is-on" : ""}`}
              onClick={onToggleFixations}
            >
              <span className="gaze-toggle-track">
                <span className="gaze-toggle-thumb" />
              </span>
              <span className="gaze-toggle-label">Fixations</span>
            </button>
          </div>

          {/* Fixation list */}
          {analysis.fixations.length > 0 ? (
            <div className="gaze-fixation-section">
              <p className="gaze-fixation-heading">Top fixations</p>
              <ol className="gaze-fixation-list">
                {analysis.fixations.slice(0, 8).map((fix) => {
                  const pct = Math.round((fix.dwell_ms / maxDwell) * 100);
                  return (
                    <li key={fix.fixation_index} className="gaze-fix-row">
                      <span className="gaze-fix-index">
                        {fix.fixation_index}
                      </span>
                      <div className="gaze-fix-body">
                        <div className="gaze-fix-top-row">
                          <span className="gaze-fix-coord">
                            {fix.x.toFixed(0)}, {fix.y.toFixed(0)}
                          </span>
                          <span className="gaze-fix-dwell">
                            {Math.round(fix.dwell_ms)} ms
                          </span>
                        </div>
                        <div className="gaze-fix-bar-track">
                          <div
                            className="gaze-fix-bar-fill"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
                {analysis.fixations.length > 8 ? (
                  <li className="gaze-fix-more">
                    +{analysis.fixations.length - 8} more fixations
                  </li>
                ) : null}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// Inspector for an individual frame element on the canvas (created via the
// Frame tool). Mirrors the artboard inspector but writes to element state so
// users can manage many independent frames in the same project, similar to
// how Figma allows multiple top-level frames per page.
function FrameElementInspectorPanel({
  element,
  onUpdate,
  onSelectPreset,
}: {
  element: CanvasElement;
  onUpdate: (updates: Partial<CanvasElement>) => void;
  onSelectPreset: (preset: ArtboardPreset) => void;
}) {
  const width = Math.round(element.width ?? 0);
  const height = Math.round(element.height ?? 0);
  const xPos = Math.round(element.x);
  const yPos = Math.round(element.y);
  const fill = element.style?.fill ?? "#ffffff";
  const fillIsHex = typeof fill === "string" && fill.startsWith("#");
  const fillHex = fillIsHex ? fill.slice(0, 7) : "#ffffff";
  const fillOpacity = element.style?.fillOpacity ?? 100;
  const cornerRadius = element.style?.cornerRadius ?? 0;
  const elevation = element.style?.elevation ?? false;
  const opacity = Math.round((element.style?.opacity ?? 1) * 100);

  const [nameDraft, setNameDraft] = useState(element.name ?? "Frame");
  const [widthDraft, setWidthDraft] = useState(String(width));
  const [heightDraft, setHeightDraft] = useState(String(height));
  const [xDraft, setXDraft] = useState(String(xPos));
  const [yDraft, setYDraft] = useState(String(yPos));
  const [lockAspect, setLockAspect] = useState(false);

  useEffect(() => {
    setNameDraft(element.name ?? "Frame");
  }, [element.name]);
  useEffect(() => {
    setWidthDraft(String(width));
  }, [width]);
  useEffect(() => {
    setHeightDraft(String(height));
  }, [height]);
  useEffect(() => {
    setXDraft(String(xPos));
  }, [xPos]);
  useEffect(() => {
    setYDraft(String(yPos));
  }, [yPos]);

  const commitName = () => {
    const next = nameDraft.trim() || "Frame";
    if (next !== element.name) onUpdate({ name: next });
  };

  const commitNumeric = (
    key: "x" | "y" | "width" | "height",
    raw: string,
    options?: { driver?: "width" | "height" },
  ) => {
    const next = Number(raw);
    if (!Number.isFinite(next)) return;
    if (key === "width" || key === "height") {
      let nextWidth = key === "width" ? next : (element.width ?? 0);
      let nextHeight = key === "height" ? next : (element.height ?? 0);
      if (lockAspect && (element.height ?? 0) > 0) {
        const ratio = (element.width ?? 0) / (element.height ?? 1);
        if (options?.driver === "width") {
          nextHeight = nextWidth / ratio;
        } else if (options?.driver === "height") {
          nextWidth = nextHeight * ratio;
        }
      }
      onUpdate({
        width: Math.max(1, Math.round(nextWidth)),
        height: Math.max(1, Math.round(nextHeight)),
        style: { ...element.style, presetId: null },
      });
    } else {
      onUpdate({ [key]: Math.round(next) } as Partial<CanvasElement>);
    }
  };

  const updateStyle = (patch: Partial<NonNullable<CanvasElement["style"]>>) => {
    onUpdate({ style: { ...element.style, ...patch } });
  };

  const presetGroups: ArtboardPreset["group"][] = [
    "Desktop",
    "Tablet",
    "Phone",
    "Social",
    "Print",
  ];

  return (
    <div className="frame-inspector artboard-inspector">
      <section className="frame-inspector-section frame-kind-row">
        <input
          aria-label="Frame name"
          className="frame-kind-select artboard-name-input"
          onBlur={commitName}
          onChange={(event) => setNameDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              (event.target as HTMLInputElement).blur();
            }
          }}
          value={nameDraft}
        />
        <span className="artboard-kind-pill">Frame</span>
      </section>

      <section className="frame-inspector-section">
        <div className="section-heading">
          <h3>Position</h3>
        </div>
        <div className="property-grid two">
          <label className="mini-input">
            <span>X</span>
            <input
              inputMode="numeric"
              onBlur={() => commitNumeric("x", xDraft)}
              onChange={(event) => setXDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  (event.target as HTMLInputElement).blur();
                }
              }}
              value={xDraft}
            />
          </label>
          <label className="mini-input">
            <span>Y</span>
            <input
              inputMode="numeric"
              onBlur={() => commitNumeric("y", yDraft)}
              onChange={(event) => setYDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  (event.target as HTMLInputElement).blur();
                }
              }}
              value={yDraft}
            />
          </label>
        </div>
      </section>

      <section className="frame-inspector-section">
        <div className="section-heading">
          <h3>Layout</h3>
          <button
            aria-label={
              lockAspect ? "Unlock aspect ratio" : "Lock aspect ratio"
            }
            aria-pressed={lockAspect}
            className={`visibility-btn ${lockAspect ? "is-on" : ""}`}
            onClick={() => setLockAspect(!lockAspect)}
            type="button"
          >
            {lockAspect ? "🔒" : "🔓"}
          </button>
        </div>
        <p className="property-label">Dimensions</p>
        <div className="property-grid two">
          <label className="mini-input">
            <span>W</span>
            <input
              inputMode="numeric"
              onBlur={() =>
                commitNumeric("width", widthDraft, { driver: "width" })
              }
              onChange={(event) => setWidthDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  (event.target as HTMLInputElement).blur();
                }
              }}
              value={widthDraft}
            />
          </label>
          <label className="mini-input">
            <span>H</span>
            <input
              inputMode="numeric"
              onBlur={() =>
                commitNumeric("height", heightDraft, { driver: "height" })
              }
              onChange={(event) => setHeightDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  (event.target as HTMLInputElement).blur();
                }
              }}
              value={heightDraft}
            />
          </label>
        </div>
        <div className="artboard-orientation-row">
          <button
            className={`artboard-orient-btn ${width >= height ? "is-on" : ""}`}
            onClick={() => {
              if (width < height) {
                onUpdate({
                  width: height,
                  height: width,
                  style: { ...element.style, presetId: null },
                });
              }
            }}
            type="button"
          >
            <span
              className="orient-glyph orient-landscape"
              aria-hidden="true"
            />
            Landscape
          </button>
          <button
            className={`artboard-orient-btn ${height > width ? "is-on" : ""}`}
            onClick={() => {
              if (height <= width) {
                onUpdate({
                  width: height,
                  height: width,
                  style: { ...element.style, presetId: null },
                });
              }
            }}
            type="button"
          >
            <span className="orient-glyph orient-portrait" aria-hidden="true" />
            Portrait
          </button>
        </div>
      </section>

      <section className="frame-inspector-section">
        <div className="section-heading">
          <h3>Templates</h3>
        </div>
        {presetGroups.map((group) => {
          const groupPresets = artboardPresets.filter((p) => p.group === group);
          if (groupPresets.length === 0) return null;
          return (
            <div className="artboard-preset-group" key={group}>
              <p className="property-label artboard-preset-group-label">
                {group}
              </p>
              <div className="preset-list">
                {groupPresets.map((preset) => (
                  <button
                    className={`preset-row ${
                      element.style?.presetId === preset.id ? "is-active" : ""
                    }`}
                    key={preset.id}
                    onClick={() => onSelectPreset(preset)}
                    type="button"
                  >
                    <span>
                      <strong>{preset.label.replace(/\s*\(.*\)$/, "")}</strong>
                      <em>{preset.group}</em>
                    </span>
                    <span>
                      {preset.width} × {preset.height}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className="frame-inspector-section">
        <div className="section-heading">
          <h3>Appearance</h3>
          <button
            aria-label={elevation ? "Hide elevation" : "Show elevation"}
            aria-pressed={elevation}
            className={`visibility-btn ${elevation ? "is-on" : ""}`}
            onClick={() => updateStyle({ elevation: !elevation })}
            type="button"
            title="Toggle frame drop shadow"
          >
            ◌
          </button>
        </div>
        <div className="property-grid two">
          <label>
            <span className="property-label">Opacity</span>
            <span className="mini-input">
              <input
                inputMode="numeric"
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next)) {
                    updateStyle({
                      opacity: Math.max(0, Math.min(100, next)) / 100,
                    });
                  }
                }}
                value={opacity}
              />
              <span>%</span>
            </span>
          </label>
          <label>
            <span className="property-label">Corner radius</span>
            <span className="mini-input">
              <input
                inputMode="numeric"
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next)) {
                    updateStyle({ cornerRadius: Math.max(0, next) });
                  }
                }}
                value={cornerRadius}
              />
            </span>
          </label>
        </div>
      </section>

      <section className="frame-inspector-section">
        <div className="section-heading">
          <h3>Fill</h3>
        </div>
        <div className="paint-row">
          <input
            aria-label="Frame fill color"
            onChange={(event) => updateStyle({ fill: event.target.value })}
            type="color"
            value={fillHex}
          />
          <input
            aria-label="Frame fill hex"
            onChange={(event) => updateStyle({ fill: event.target.value })}
            value={fill}
          />
          <input
            aria-label="Frame fill opacity"
            inputMode="numeric"
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) {
                updateStyle({
                  fillOpacity: Math.max(0, Math.min(100, next)),
                });
              }
            }}
            value={fillOpacity}
          />
        </div>
      </section>
    </div>
  );
}

type AgentReferenceImage = ReturnType<typeof getAgentReferenceImage>;

type AssetsPanelProps = {
  assets: ProjectAsset[];
  loadState: LoadState;
  error: string;
  search: string;
  onSearchChange: (value: string) => void;
  uploading: boolean;
  isDropTarget: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  renamingAssetId: string | null;
  renamingAssetName: string;
  draggingAssetId: string | null;
  onPickFiles: () => void;
  onFilesSelected: (files: FileList) => void;
  onDropFiles: (files: FileList) => void;
  onSetIsDropTarget: (next: boolean) => void;
  onClickAsset: (asset: ProjectAsset) => void;
  onStartDrag: (asset: ProjectAsset) => void;
  onEndDrag: () => void;
  onStartRename: (asset: ProjectAsset) => void;
  onChangeRenameValue: (value: string) => void;
  onCommitRename: (asset: ProjectAsset) => void;
  onCancelRename: () => void;
  onDeleteAsset: (asset: ProjectAsset) => void;
  onDismissError: () => void;
  referenceImage: AgentReferenceImage;
  referenceAssets: ReferenceAsset[];
  onPlaceReferenceAsset: (asset: ReferenceAsset) => void;
};

function AssetsPanel({
  assets,
  loadState,
  error,
  search,
  onSearchChange,
  uploading,
  isDropTarget,
  fileInputRef,
  renamingAssetId,
  renamingAssetName,
  draggingAssetId,
  onPickFiles,
  onFilesSelected,
  onDropFiles,
  onSetIsDropTarget,
  onClickAsset,
  onStartDrag,
  onEndDrag,
  onStartRename,
  onChangeRenameValue,
  onCommitRename,
  onCancelRename,
  onDeleteAsset,
  onDismissError,
  referenceImage,
  referenceAssets,
  onPlaceReferenceAsset,
}: AssetsPanelProps) {
  const filtered = useMemo(() => {
    const trimmed = search.trim().toLowerCase();
    if (!trimmed) return assets;
    return assets.filter((asset) => asset.name.toLowerCase().includes(trimmed));
  }, [assets, search]);

  return (
    <div
      className={`assets-panel${isDropTarget ? " is-drop-target" : ""}`}
      onDragEnter={(event) => {
        if (event.dataTransfer?.types?.includes("Files")) {
          event.preventDefault();
          onSetIsDropTarget(true);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer?.types?.includes("Files")) {
          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
          }
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        onSetIsDropTarget(false);
      }}
      onDrop={(event) => {
        if (event.dataTransfer?.files?.length) {
          event.preventDefault();
          onDropFiles(event.dataTransfer.files);
        }
      }}
    >
      <div className="assets-panel-header">
        <input
          type="search"
          className="assets-panel-search"
          placeholder="Search assets..."
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <button
          type="button"
          className="assets-panel-upload-btn"
          onClick={onPickFiles}
          disabled={uploading}
          title="Upload images"
        >
          {uploading ? "Uploading..." : "Upload"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(event) => {
            if (event.target.files && event.target.files.length > 0) {
              onFilesSelected(event.target.files);
            }
            event.target.value = "";
          }}
        />
      </div>

      {error && (
        <div className="assets-panel-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="assets-panel-error-dismiss"
            onClick={onDismissError}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {referenceImage && (
        <div className="asset-reference-card">
          <p className="panel-kicker">Reference</p>
          <strong>Canvas background</strong>
          <span>{referenceImage.model}</span>
          <span>Applied to the draft artboard</span>
        </div>
      )}

      {referenceAssets.length > 0 && (
        <div className="asset-reference-card">
          <p className="panel-kicker">Extracted assets</p>
          {referenceAssets.map((asset) => (
            <button
              key={asset.id}
              className="secondary-action"
              disabled={!asset.artifactKey}
              onClick={() => onPlaceReferenceAsset(asset)}
              title={
                asset.artifactKey
                  ? `Place ${asset.label}`
                  : (asset.extractionError ?? "Metadata only")
              }
              type="button"
            >
              {asset.label}
            </button>
          ))}
        </div>
      )}

      <div className="assets-panel-body">
        <p className="panel-kicker">Your uploads</p>
        {loadState === "loading" && assets.length === 0 ? (
          <p className="assets-panel-empty">Loading assets…</p>
        ) : filtered.length === 0 ? (
          <div className="assets-panel-empty-state">
            {assets.length === 0 ? (
              <>
                <p className="assets-panel-empty-title">No assets yet</p>
                <p className="assets-panel-empty-copy">
                  Drop image files anywhere in this panel, or click Upload to
                  add reference images, logos, photos, or icons.
                </p>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={onPickFiles}
                >
                  Choose files
                </button>
              </>
            ) : (
              <p className="assets-panel-empty">No assets match your search.</p>
            )}
          </div>
        ) : (
          <div className="assets-panel-grid">
            {filtered.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                isRenaming={renamingAssetId === asset.id}
                renamingValue={renamingAssetName}
                isDragging={draggingAssetId === asset.id}
                onClick={() => {
                  if (renamingAssetId === asset.id) return;
                  onClickAsset(asset);
                }}
                onDragStart={(event) => {
                  // Setting plain-text data is enough for the canvas drop
                  // handler to identify the asset; we keep both an asset id
                  // and a JSON snapshot to avoid an extra lookup.
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData(
                    "application/x-tastelab-asset",
                    asset.id,
                  );
                  event.dataTransfer.setData(
                    "application/json",
                    JSON.stringify(asset),
                  );
                  onStartDrag(asset);
                }}
                onDragEnd={onEndDrag}
                onStartRename={() => onStartRename(asset)}
                onChangeRename={onChangeRenameValue}
                onCommitRename={() => onCommitRename(asset)}
                onCancelRename={onCancelRename}
                onDelete={() => onDeleteAsset(asset)}
              />
            ))}
          </div>
        )}
      </div>

      {isDropTarget && (
        <div className="assets-panel-drop-overlay" aria-hidden="true">
          <div>Drop images to upload</div>
        </div>
      )}
    </div>
  );
}

function AssetCard({
  asset,
  isRenaming,
  renamingValue,
  isDragging,
  onClick,
  onDragStart,
  onDragEnd,
  onStartRename,
  onChangeRename,
  onCommitRename,
  onCancelRename,
  onDelete,
}: {
  asset: ProjectAsset;
  isRenaming: boolean;
  renamingValue: string;
  isDragging: boolean;
  onClick: () => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onStartRename: () => void;
  onChangeRename: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
}) {
  const [didFail, setDidFail] = useState(false);
  const src = getArtifactImageSrc(asset.artifactKey);

  useEffect(() => {
    setDidFail(false);
  }, [asset.artifactKey]);

  return (
    <div
      className={`asset-card${isDragging ? " is-dragging" : ""}`}
      draggable={!isRenaming}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      title={`${asset.name} • ${asset.width}×${asset.height}`}
    >
      <div className="asset-card-thumb">
        {src && !didFail ? (
          <img
            src={src}
            alt={asset.name}
            draggable={false}
            onError={() => setDidFail(true)}
          />
        ) : (
          <div className="asset-card-placeholder">!</div>
        )}
      </div>
      <div className="asset-card-meta">
        {isRenaming ? (
          <input
            autoFocus
            className="asset-card-rename"
            value={renamingValue}
            onChange={(event) => onChangeRename(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onCommitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onCancelRename();
              }
            }}
            onBlur={onCommitRename}
          />
        ) : (
          <span className="asset-card-name">{asset.name}</span>
        )}
        <span className="asset-card-dimensions">
          {asset.width}×{asset.height}
        </span>
      </div>
      <div className="asset-card-actions">
        <button
          type="button"
          className="asset-card-action"
          aria-label="Rename asset"
          title="Rename"
          onClick={(event) => {
            event.stopPropagation();
            onStartRename();
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
        <button
          type="button"
          className="asset-card-action asset-card-action-danger"
          aria-label="Delete asset"
          title="Delete"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function ImageNodePreview({ element }: { element: CanvasElement }) {
  const [didFail, setDidFail] = useState(false);
  const imageSrc = getArtifactImageSrc(element.artifactKey);

  useEffect(() => {
    setDidFail(false);
  }, [element.artifactKey]);

  return (
    <div
      className={`canvas-agent-image ${
        element.role === "reference-guide" ? "is-reference-guide" : ""
      }`}
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        background: element.style?.fill ?? "var(--panel)",
        borderColor: element.style?.stroke ?? "var(--line)",
        opacity:
          element.role === "reference-guide"
            ? (element.style?.opacity ?? 0.28)
            : (element.style?.opacity ?? 1),
        borderRadius:
          typeof element.style?.cornerRadius === "number"
            ? element.style.cornerRadius
            : undefined,
      }}
    >
      {imageSrc && !didFail ? (
        <img
          alt={element.alt ?? element.name ?? "Canvas image"}
          onError={() => setDidFail(true)}
          src={imageSrc}
          style={{
            objectFit: element.objectFit ?? "cover",
            objectPosition: element.objectPosition ?? "center center",
          }}
        />
      ) : (
        <span>
          {element.artifactKey
            ? `Missing image asset: ${element.artifactKey}`
            : "No image asset selected"}
        </span>
      )}
    </div>
  );
}

function FrameInspectorPanel({
  frameSelection,
  frameToolKind,
  presets,
  selectedPresetId,
  onFrameChange,
  onKindChange,
  onPresetSelect,
}: {
  frameSelection: CanvasFrameSelection;
  frameToolKind: FrameToolKind;
  presets: FramePreset[];
  selectedPresetId: string;
  onFrameChange: (frame: CanvasFrameSelection) => void;
  onKindChange: (kind: FrameToolKind) => void;
  onPresetSelect: (preset: FramePreset) => void;
}) {
  const updateFrame = <Key extends keyof CanvasFrameSelection>(
    key: Key,
    value: CanvasFrameSelection[Key],
  ) => {
    onFrameChange({ ...frameSelection, [key]: value });
  };

  const updateNumber = (
    key: keyof Pick<
      CanvasFrameSelection,
      | "x"
      | "y"
      | "width"
      | "height"
      | "opacity"
      | "cornerRadius"
      | "fillOpacity"
      | "strokeOpacity"
      | "strokeWeight"
    >,
    value: string,
  ) => {
    const next = Number(value);
    if (Number.isFinite(next)) {
      updateFrame(key, next);
    }
  };

  return (
    <div className="frame-inspector">
      <section className="frame-inspector-section frame-kind-row">
        <button className="frame-kind-select" type="button">
          <span>{titleCase(frameToolKind)}</span>
          <span aria-hidden="true">⌄</span>
        </button>
        <button
          className="code-toggle"
          aria-label="View generated markup"
          type="button"
        >
          &lt;/&gt;
        </button>
      </section>

      {frameToolKind === "frame" && (
        <section className="frame-inspector-section">
          <div className="section-heading">
            <h3>Frame</h3>
          </div>
          <div className="preset-list">
            {presets.map((preset) => (
              <button
                className={`preset-row ${
                  selectedPresetId === preset.id ? "is-active" : ""
                }`}
                key={preset.id}
                onClick={() => onPresetSelect(preset)}
                type="button"
              >
                <span>
                  <strong>{preset.label}</strong>
                  <em>{preset.group}</em>
                </span>
                <span>
                  {preset.width} × {preset.height}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="frame-inspector-section">
        <div className="section-heading">
          <h3>Position</h3>
        </div>
        <p className="property-label">Alignment</p>
        <div className="alignment-grid">
          {[
            ["left", "center-x", "right"],
            ["top", "center-y", "bottom"],
          ].map((group) => (
            <div className="alignment-segment" key={group.join("-")}>
              {group.map((alignment) => (
                <button
                  aria-label={`Align ${alignment}`}
                  key={alignment}
                  type="button"
                >
                  <span className={`align-icon align-${alignment}`} />
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="property-grid two">
          <label className="mini-input">
            <span>X</span>
            <input
              inputMode="numeric"
              onChange={(event) => updateNumber("x", event.target.value)}
              value={frameSelection.x}
            />
          </label>
          <label className="mini-input">
            <span>Y</span>
            <input
              inputMode="numeric"
              onChange={(event) => updateNumber("y", event.target.value)}
              value={frameSelection.y}
            />
          </label>
        </div>
      </section>

      <section className="frame-inspector-section">
        <div className="section-heading">
          <h3>Layout</h3>
          <span className="corner-glyph" aria-hidden="true">
            ↗↙
          </span>
        </div>
        <p className="property-label">Dimensions</p>
        <div className="property-grid two">
          <label className="mini-input">
            <span>W</span>
            <input
              inputMode="numeric"
              onChange={(event) => updateNumber("width", event.target.value)}
              value={frameSelection.width}
            />
          </label>
          <label className="mini-input">
            <span>H</span>
            <input
              inputMode="numeric"
              onChange={(event) => updateNumber("height", event.target.value)}
              value={frameSelection.height}
            />
          </label>
        </div>
      </section>

      <section className="frame-inspector-section">
        <div className="section-heading">
          <h3>Appearance</h3>
          <button
            className={`visibility-btn ${frameSelection.visible ? "is-on" : ""}`}
            onClick={() => updateFrame("visible", !frameSelection.visible)}
            type="button"
          >
            ◌
          </button>
        </div>
        <div className="property-grid two">
          <label>
            <span className="property-label">Opacity</span>
            <span className="mini-input">
              <input
                inputMode="numeric"
                onChange={(event) =>
                  updateNumber("opacity", event.target.value)
                }
                value={frameSelection.opacity}
              />
              <span>%</span>
            </span>
          </label>
          <label>
            <span className="property-label">Corner radius</span>
            <span className="mini-input">
              <input
                inputMode="numeric"
                onChange={(event) =>
                  updateNumber("cornerRadius", event.target.value)
                }
                value={frameSelection.cornerRadius}
              />
            </span>
          </label>
        </div>
      </section>

      <section className="frame-inspector-section">
        <div className="section-heading">
          <h3>Fill</h3>
          <button type="button">+</button>
        </div>
        <div className="paint-row">
          <input
            aria-label="Fill color"
            onChange={(event) => updateFrame("fill", event.target.value)}
            type="color"
            value={frameSelection.fill}
          />
          <input
            aria-label="Fill hex"
            onChange={(event) => updateFrame("fill", event.target.value)}
            value={frameSelection.fill}
          />
          <input
            aria-label="Fill opacity"
            inputMode="numeric"
            onChange={(event) =>
              updateNumber("fillOpacity", event.target.value)
            }
            value={frameSelection.fillOpacity}
          />
          <span>%</span>
          <button type="button">−</button>
        </div>
      </section>

      <section className="frame-inspector-section">
        <div className="section-heading">
          <h3>Stroke</h3>
          <button type="button">+</button>
        </div>
        <div className="paint-row">
          <input
            aria-label="Stroke color"
            onChange={(event) => updateFrame("stroke", event.target.value)}
            type="color"
            value={frameSelection.stroke}
          />
          <input
            aria-label="Stroke hex"
            onChange={(event) => updateFrame("stroke", event.target.value)}
            value={frameSelection.stroke}
          />
          <input
            aria-label="Stroke opacity"
            inputMode="numeric"
            onChange={(event) =>
              updateNumber("strokeOpacity", event.target.value)
            }
            value={frameSelection.strokeOpacity}
          />
          <span>%</span>
          <button type="button">−</button>
        </div>
        <div className="property-grid two stroke-controls">
          <label>
            <span className="property-label">Position</span>
            <select
              onChange={(event) =>
                updateFrame(
                  "strokePosition",
                  event.target.value as CanvasFrameSelection["strokePosition"],
                )
              }
              value={frameSelection.strokePosition}
            >
              <option>Inside</option>
              <option>Center</option>
              <option>Outside</option>
            </select>
          </label>
          <label>
            <span className="property-label">Weight</span>
            <span className="mini-input">
              <input
                inputMode="numeric"
                onChange={(event) =>
                  updateNumber("strokeWeight", event.target.value)
                }
                value={frameSelection.strokeWeight}
              />
            </span>
          </label>
        </div>
      </section>

      <section className="frame-inspector-section export-row">
        <h3>Export</h3>
        <button type="button">+</button>
      </section>
    </div>
  );
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizePenSettings(settings: PenSettings): PenSettings {
  return {
    color: /^#[\da-f]{6}$/i.test(settings.color) ? settings.color : "#333333",
    size: Math.max(1, Math.min(48, Math.round(settings.size))),
    opacity: Math.max(0, Math.min(100, Math.round(settings.opacity))),
  };
}

function isPointNearPath(
  point: { x: number; y: number },
  element: CanvasElement,
) {
  const points = element.points ?? [];
  const strokeWidth = element.style?.strokeWidth ?? 2;
  const hitTolerance = Math.max(8, strokeWidth + 6);

  for (let index = 1; index < points.length; index += 1) {
    if (
      distanceToSegment(point, points[index - 1], points[index]) <= hitTolerance
    ) {
      return true;
    }
  }

  return false;
}

function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    ),
  );
  const closestX = start.x + projection * dx;
  const closestY = start.y + projection * dy;

  return Math.hypot(point.x - closestX, point.y - closestY);
}

function getPolygonPoints(element: CanvasElement, sides: number) {
  const width = element.width ?? 100;
  const height = element.height ?? 100;
  const cx = element.x + width / 2;
  const cy = element.y + height / 2;
  const radius = Math.min(Math.abs(width), Math.abs(height)) / 2;

  return Array.from({ length: sides }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / sides;
    return `${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`;
  }).join(" ");
}

function getStarPoints(element: CanvasElement) {
  const width = element.width ?? 100;
  const height = element.height ?? 100;
  const cx = element.x + width / 2;
  const cy = element.y + height / 2;
  const outerRadius = Math.min(Math.abs(width), Math.abs(height)) / 2;
  const innerRadius = outerRadius * 0.45;

  return Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    return `${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`;
  }).join(" ");
}

function ShapeToolIcon({ kind }: { kind: ShapeToolKind }) {
  if (kind === "line") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <path d="M5 19 19 5" />
      </svg>
    );
  }

  if (kind === "arrow") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <path d="M5 19 19 5" />
        <path d="M10 5h9v9" />
      </svg>
    );
  }

  if (kind === "ellipse") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="8" />
      </svg>
    );
  }

  if (kind === "polygon") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <path d="M12 4 21 20H3L12 4Z" />
      </svg>
    );
  }

  if (kind === "star") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
      </svg>
    );
  }

  if (kind === "boundary" || kind === "rounded-boundary") {
    const radius = kind === "rounded-boundary" ? "5" : "0";
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <rect x="4" y="6" width="16" height="12" rx={radius} />
        <path d="M7 9h10" opacity="0.35" />
        <path d="M7 12h7" opacity="0.35" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <rect x="5" y="5" width="14" height="14" rx="1.5" />
    </svg>
  );
}

function hexToRgba(hex: string, alphaPercent: number) {
  const sanitized = hex.replace("#", "");
  if (!/^[\da-f]{6}$/i.test(sanitized)) {
    return hex;
  }

  const red = parseInt(sanitized.slice(0, 2), 16);
  const green = parseInt(sanitized.slice(2, 4), 16);
  const blue = parseInt(sanitized.slice(4, 6), 16);
  const alpha = Math.max(0, Math.min(100, alphaPercent)) / 100;

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function elementsFromDocument(
  documentJson: DesignDocumentJson,
): CanvasElement[] {
  return documentJson.nodes
    .filter((node) => isCanvasElementNode(node))
    .filter((node) => node.props.role !== "reference-guide")
    .map((node) => ({
      id: node.id,
      type: node.type as CanvasElement["type"],
      viewId: node.viewId,
      name: node.name,
      x: node.bounds.x,
      y: node.bounds.y,
      width: node.bounds.width,
      height: node.bounds.height,
      content:
        typeof node.props.text === "string" ? node.props.text : undefined,
      textStyleRuns: normalizeTextStyleRuns(
        node.props.textStyleRuns,
        typeof node.props.text === "string" ? node.props.text.length : 0,
      ),
      artifactKey:
        typeof node.props.artifactKey === "string"
          ? node.props.artifactKey
          : undefined,
      prompt:
        typeof node.props.prompt === "string" ? node.props.prompt : undefined,
      role: typeof node.props.role === "string" ? node.props.role : undefined,
      exportable:
        typeof node.props.exportable === "boolean"
          ? node.props.exportable
          : undefined,
      locked:
        typeof node.props.locked === "boolean" ? node.props.locked : undefined,
      objectFit:
        node.props.objectFit === "cover" ||
        node.props.objectFit === "contain" ||
        node.props.objectFit === "fill"
          ? node.props.objectFit
          : undefined,
      objectPosition:
        typeof node.props.objectPosition === "string"
          ? node.props.objectPosition
          : undefined,
      alt: typeof node.props.alt === "string" ? node.props.alt : undefined,
      style: normalizeCanvasStyle(node.props.style),
    }));
}

// Read the artboard config the agent (or a previous run) saved into
// `documentJson.styles.artboard`. Used to hydrate the workspace's
// authoritative artboardSize / fill / corner radius state from a design.
function readArtboardFromDesign(design: DesignDocument | null): {
  width: number;
  height: number;
  presetId: string | null;
  name?: string;
  fill?: string;
  fillOpacity?: number;
  cornerRadius?: number;
  elevation?: boolean;
} | null {
  const candidate = (design?.documentJson.styles ?? {}) as Record<
    string,
    unknown
  >;
  const artboard = candidate.artboard;
  if (!artboard || typeof artboard !== "object") {
    return null;
  }

  const value = artboard as Record<string, unknown>;
  const width =
    typeof value.width === "number" ? Math.round(value.width) : null;
  const height =
    typeof value.height === "number" ? Math.round(value.height) : null;
  if (!width || !height || width < 1 || height < 1) {
    return null;
  }

  return {
    width,
    height,
    presetId:
      typeof value.presetId === "string" && value.presetId
        ? value.presetId
        : null,
    name: typeof value.name === "string" ? value.name : undefined,
    fill: typeof value.fill === "string" ? value.fill : undefined,
    fillOpacity:
      typeof value.fillOpacity === "number"
        ? normalizeArtboardFillOpacity(value.fillOpacity)
        : undefined,
    cornerRadius:
      typeof value.cornerRadius === "number"
        ? Math.max(0, Math.round(value.cornerRadius))
        : undefined,
    elevation:
      typeof value.elevation === "boolean" ? value.elevation : undefined,
  };
}

function normalizeArtboardFillOpacity(value: number) {
  if (!Number.isFinite(value)) {
    return 100;
  }
  if (value > 0 && value <= 1) {
    return Math.max(0, Math.min(100, value * 100));
  }
  return Math.max(0, Math.min(100, value));
}

function readDesignHistory(design: DesignDocument | null) {
  const history = design?.documentJson.styles.history;

  if (!history || typeof history !== "object") {
    return { redoStack: [] as number[] };
  }

  const value = history as { redoStack?: unknown };

  return {
    redoStack: Array.isArray(value.redoStack)
      ? value.redoStack.filter((version): version is number =>
          Number.isInteger(version),
        )
      : [],
  };
}

function getAgentReferenceImage(design: DesignDocument | null) {
  const agentRunner = design?.documentJson.styles.agentRunner;
  if (!agentRunner || typeof agentRunner !== "object") {
    return null;
  }

  const referenceImage = (agentRunner as { referenceImage?: unknown })
    .referenceImage;
  if (!referenceImage || typeof referenceImage !== "object") {
    return null;
  }

  const artifactKey = (referenceImage as { artifactKey?: unknown }).artifactKey;
  if (typeof artifactKey !== "string" || !artifactKey.endsWith(".png")) {
    return null;
  }

  const model = (referenceImage as { model?: unknown }).model;
  const prompt = (referenceImage as { prompt?: unknown }).prompt;

  return {
    artifactKey,
    model: typeof model === "string" ? model : "reference image",
    prompt: typeof prompt === "string" ? prompt : undefined,
  };
}

function getAgentReferenceAssets(
  design: DesignDocument | null,
): ReferenceAsset[] {
  const agentRunner = design?.documentJson.styles.agentRunner;
  if (!agentRunner || typeof agentRunner !== "object") {
    return [];
  }

  const referenceAssets = (agentRunner as { referenceAssets?: unknown })
    .referenceAssets;
  if (!Array.isArray(referenceAssets)) {
    return [];
  }

  return referenceAssets.filter(isReferenceAsset);
}

function isReferenceAsset(asset: unknown): asset is ReferenceAsset {
  if (!asset || typeof asset !== "object") {
    return false;
  }

  const candidate = asset as Partial<ReferenceAsset>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.sourceArtifactKey === "string" &&
    typeof candidate.confidence === "number" &&
    Boolean(candidate.bounds) &&
    typeof candidate.bounds?.x === "number" &&
    typeof candidate.bounds?.y === "number" &&
    typeof candidate.bounds?.width === "number" &&
    typeof candidate.bounds?.height === "number" &&
    typeof candidate.createdAt === "string"
  );
}

function isCanvasElementNode(node: DesignNode) {
  return (
    node.type === "frame" ||
    node.type === "section" ||
    node.type === "slice" ||
    node.type === "rectangle" ||
    node.type === "line" ||
    node.type === "arrow" ||
    node.type === "ellipse" ||
    node.type === "polygon" ||
    node.type === "star" ||
    node.type === "boundary" ||
    node.type === "rounded-boundary" ||
    node.type === "button" ||
    node.type === "image" ||
    (node.type === "text" && Boolean(node.props.style))
  );
}

function normalizeCanvasStyle(style: unknown): CanvasElement["style"] {
  if (!style || typeof style !== "object") {
    return undefined;
  }

  return style as CanvasElement["style"];
}

function canvasElementToNode(
  element: CanvasElement,
  viewId: string,
): DesignNode {
  const textStyleRuns = element.content
    ? normalizeTextStyleRuns(element.textStyleRuns, element.content.length)
    : [];
  const name =
    element.name ??
    (element.type === "section"
      ? "Section"
      : element.type === "slice"
        ? "Slice"
        : element.type === "frame"
          ? "Frame"
          : titleCase(element.type));

  return {
    id: element.id,
    type: element.type,
    viewId,
    name,
    props: {
      style: element.style ?? {},
      ...(element.content ? { text: element.content, textStyleRuns } : {}),
      ...(element.artifactKey ? { artifactKey: element.artifactKey } : {}),
      ...(element.prompt ? { prompt: element.prompt } : {}),
      ...(element.role ? { role: element.role } : {}),
      ...(typeof element.exportable === "boolean"
        ? { exportable: element.exportable }
        : {}),
      ...(typeof element.locked === "boolean"
        ? { locked: element.locked }
        : {}),
      ...(element.objectFit ? { objectFit: element.objectFit } : {}),
      ...(element.objectPosition
        ? { objectPosition: element.objectPosition }
        : {}),
      ...(element.alt ? { alt: element.alt } : {}),
    },
    bounds: {
      x: element.x,
      y: element.y,
      width: element.width ?? 100,
      height: element.height ?? 100,
    },
  };
}

function getArtifactImageSrc(artifactKey: string | undefined) {
  if (!artifactKey || !/\.(png|jpe?g|webp|gif|svg)$/i.test(artifactKey)) {
    return null;
  }

  return `/api/collect/file?artifactKey=${encodeURIComponent(artifactKey)}`;
}

function getFrameElementConfig(
  kind: FrameToolKind,
  frameSelection: CanvasFrameSelection,
): {
  type: CanvasElement["type"];
  name: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  cornerRadius: number;
  fillOpacity: number;
  elevation: boolean;
} {
  if (kind === "section") {
    return {
      type: "section",
      name: "Section",
      fill: hexToRgba(frameSelection.fill, frameSelection.fillOpacity),
      stroke: "rgba(132, 204, 22, 0.75)",
      strokeWidth: Math.max(2, frameSelection.strokeWeight),
      opacity: frameSelection.opacity / 100,
      cornerRadius: 4,
      fillOpacity: frameSelection.fillOpacity,
      elevation: false,
    };
  }

  if (kind === "slice") {
    return {
      type: "slice",
      name: "Slice",
      fill: "transparent",
      stroke: hexToRgba(frameSelection.stroke, 36),
      strokeWidth: Math.max(1, frameSelection.strokeWeight),
      opacity: frameSelection.opacity / 100,
      cornerRadius: 0,
      fillOpacity: 0,
      elevation: false,
    };
  }

  // Figma-style frame: solid white fill, rounded corners, soft drop shadow,
  // and a default name. Users can override every property in the inspector.
  return {
    type: "frame",
    name:
      frameSelection.name && frameSelection.name !== "Actual element"
        ? frameSelection.name
        : "Frame",
    fill: "#ffffff",
    stroke: hexToRgba(frameSelection.stroke, frameSelection.strokeOpacity),
    strokeWidth: frameSelection.strokeWeight,
    opacity: frameSelection.opacity / 100,
    cornerRadius: 18,
    fillOpacity: frameSelection.fillOpacity,
    elevation: true,
  };
}

// Builds a list of canvas elements that visually approximate the project
// brief preview. Each piece (kicker, heading, body, buttons) is its own
// canvas element so users can move, edit, and delete them individually.
function buildBriefSeedElements(
  project: TasteProject,
  artboard: { x: number; y: number; width: number; height: number },
): CanvasElement[] {
  const padX = 80;
  const padY = 88;
  const x0 = artboard.x + padX;
  const y0 = artboard.y + padY;
  const headingY = y0 + 28;
  const bodyY = headingY + 78;
  const actionsY = bodyY + 64;

  return [
    {
      id: "preview-brief-kicker",
      type: "text",
      viewId: "brief",
      name: "Kicker",
      x: x0,
      y: y0,
      content: project.type.toUpperCase(),
      style: {
        fontSize: 12,
        fontFamily: DEFAULT_CANVAS_FONT,
        fill: "#8b96a8",
        fontWeight: "600",
        letterSpacing: 1.5,
      },
    },
    {
      id: "preview-brief-heading",
      type: "text",
      viewId: "brief",
      name: "Heading",
      x: x0,
      y: headingY,
      content: project.name,
      style: {
        fontSize: 56,
        fontFamily: DEFAULT_CANVAS_FONT,
        fill: "#071120",
        fontWeight: "700",
        lineHeight: 1.0,
      },
    },
    {
      id: "preview-brief-body",
      type: "text",
      viewId: "brief",
      name: "Body",
      x: x0,
      y: bodyY,
      content: project.brief,
      style: {
        fontSize: 14,
        fontFamily: DEFAULT_CANVAS_FONT,
        fill: "#5f6b7c",
        lineHeight: 1.6,
      },
    },
    {
      id: "preview-brief-btn-primary-rect",
      type: "rectangle",
      viewId: "brief",
      name: "Primary button",
      x: x0,
      y: actionsY,
      width: 188,
      height: 42,
      style: {
        fill: "#1478f2",
        stroke: "#1478f2",
        strokeWidth: 0,
        opacity: 1,
      },
    },
    {
      id: "preview-brief-btn-primary-text",
      type: "text",
      viewId: "brief",
      name: "Primary button label",
      x: x0 + 28,
      y: actionsY + 13,
      content: "Generate component",
      style: {
        fontSize: 14,
        fontFamily: DEFAULT_CANVAS_FONT,
        fill: "#ffffff",
        fontWeight: "600",
      },
    },
    {
      id: "preview-brief-btn-secondary-rect",
      type: "rectangle",
      viewId: "brief",
      name: "Secondary button",
      x: x0 + 200,
      y: actionsY,
      width: 196,
      height: 42,
      style: {
        fill: "#ffffff",
        stroke: "#e5eaf1",
        strokeWidth: 1,
        opacity: 1,
      },
    },
    {
      id: "preview-brief-btn-secondary-text",
      type: "text",
      viewId: "brief",
      name: "Secondary button label",
      x: x0 + 200 + 24,
      y: actionsY + 13,
      content: "Run model attention",
      style: {
        fontSize: 14,
        fontFamily: DEFAULT_CANVAS_FONT,
        fill: "#071120",
        fontWeight: "600",
      },
    },
  ];
}

// Builds canvas elements that approximate the generated draft preview:
// the hero section (kicker, headline, subheadline, two buttons) and the
// proof stack on the right (three rectangle cards with stat text inside).
function buildDraftSeedElements(
  draft: ComponentDraft,
  artboard: { x: number; y: number; width: number; height: number },
): CanvasElement[] {
  const padX = 80;
  const padY = 88;
  const x0 = artboard.x + padX;
  const y0 = artboard.y + padY;
  const heroWidth = Math.max(artboard.width * 0.55 - padX, 320);
  const headingY = y0 + 28;
  const subheadlineY = headingY + 78;
  const actionsY = subheadlineY + 64;

  const accent = draft.palette.accent;
  const ink = draft.palette.ink;
  const surface = draft.palette.surface;

  const heroElements: CanvasElement[] = [
    {
      id: "preview-draft-kicker",
      type: "text",
      viewId: "draft",
      name: "Kicker",
      x: x0,
      y: y0,
      content: "GENERATED COMPONENT",
      style: {
        fontSize: 12,
        fontFamily: DEFAULT_CANVAS_FONT,
        fill: "#8b96a8",
        fontWeight: "600",
        letterSpacing: 1.5,
      },
    },
    {
      id: "preview-draft-headline",
      type: "text",
      viewId: "draft",
      name: "Headline",
      x: x0,
      y: headingY,
      content: draft.headline,
      style: {
        fontSize: 56,
        fontFamily: DEFAULT_CANVAS_FONT,
        fill: ink,
        fontWeight: "700",
        lineHeight: 1.0,
      },
    },
    {
      id: "preview-draft-subheadline",
      type: "text",
      viewId: "draft",
      name: "Subheadline",
      x: x0,
      y: subheadlineY,
      content: draft.subheadline,
      style: {
        fontSize: 14,
        fontFamily: DEFAULT_CANVAS_FONT,
        fill: "#5f6b7c",
        lineHeight: 1.6,
      },
    },
    {
      id: "preview-draft-btn-primary-rect",
      type: "rectangle",
      viewId: "draft",
      name: "Primary button",
      x: x0,
      y: actionsY,
      width: 188,
      height: 42,
      style: { fill: accent, stroke: accent, strokeWidth: 0, opacity: 1 },
    },
    {
      id: "preview-draft-btn-primary-text",
      type: "text",
      viewId: "draft",
      name: "Primary button label",
      x: x0 + 28,
      y: actionsY + 13,
      content: draft.primaryAction,
      style: {
        fontSize: 14,
        fontFamily: DEFAULT_CANVAS_FONT,
        fill: "#ffffff",
        fontWeight: "600",
      },
    },
    {
      id: "preview-draft-btn-secondary-rect",
      type: "rectangle",
      viewId: "draft",
      name: "Secondary button",
      x: x0 + 200,
      y: actionsY,
      width: 196,
      height: 42,
      style: { fill: surface, stroke: "#e5eaf1", strokeWidth: 1, opacity: 1 },
    },
    {
      id: "preview-draft-btn-secondary-text",
      type: "text",
      viewId: "draft",
      name: "Secondary button label",
      x: x0 + 200 + 24,
      y: actionsY + 13,
      content: draft.secondaryAction,
      style: {
        fontSize: 14,
        fontFamily: DEFAULT_CANVAS_FONT,
        fill: ink,
        fontWeight: "600",
      },
    },
  ];

  const proofX = x0 + heroWidth + 32;
  const proofWidth = 240;
  const proofItemHeight = 90;
  const proofGap = 14;

  const proofs: Array<{ key: string; big: string; small: string }> = [
    { key: "1", big: "92%", small: "attention confidence" },
    { key: "2", big: "3", small: "priority regions" },
    { key: "3", big: "v1", small: "demo-ready draft" },
  ];

  const proofElements: CanvasElement[] = proofs.flatMap((proof, index) => {
    const py = y0 + index * (proofItemHeight + proofGap);
    return [
      {
        id: `preview-draft-proof-${proof.key}-rect`,
        type: "rectangle",
        viewId: "draft",
        name: `Proof card ${proof.key}`,
        x: proofX,
        y: py,
        width: proofWidth,
        height: proofItemHeight,
        style: {
          fill: "#ffffff",
          stroke: "#e5eaf1",
          strokeWidth: 1,
          opacity: 1,
        },
      },
      {
        id: `preview-draft-proof-${proof.key}-strong`,
        type: "text",
        viewId: "draft",
        name: `Proof number ${proof.key}`,
        x: proofX + 18,
        y: py + 18,
        content: proof.big,
        style: {
          fontSize: 26,
          fontFamily: DEFAULT_CANVAS_FONT,
          fill: accent,
          fontWeight: "700",
        },
      },
      {
        id: `preview-draft-proof-${proof.key}-small`,
        type: "text",
        viewId: "draft",
        name: `Proof label ${proof.key}`,
        x: proofX + 18,
        y: py + 56,
        content: proof.small,
        style: {
          fontSize: 13,
          fontFamily: DEFAULT_CANVAS_FONT,
          fill: "#5f6b7c",
        },
      },
    ];
  });

  return [...heroElements, ...proofElements];
}

function buildDashboardSeedElements(
  project: TasteProject,
  artboard: { x: number; y: number; width: number; height: number },
): CanvasElement[] {
  const briefElements = buildBriefSeedElements(project, artboard);
  const draftElements = project.currentDraft
    ? buildDraftSeedElements(project.currentDraft, artboard)
    : [];
  return [...briefElements, ...draftElements];
}

function AgenticRunPanel({
  error,
  events,
  isBuilding,
  isRunning,
  message,
  project,
  request,
  runBuild,
  selectedTargetCount,
  setRequest,
}: {
  error: string;
  events: AgentActivityEvent[];
  isBuilding: boolean;
  isRunning: boolean;
  message: string;
  project: TasteProject;
  request: string;
  runBuild: (request: string) => void;
  selectedTargetCount: number;
  setRequest: (request: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(
    () => new Set(),
  );
  const latestEventId = events[events.length - 1]?.id ?? null;
  const latestRunningEventId = useMemo(() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index]?.status === "running") {
        return events[index].id;
      }
    }

    return null;
  }, [events]);
  const eventScrollSignature = useMemo(
    () =>
      events
        .map(
          (event) =>
            `${event.id}:${event.status}:${event.phase}:${event.detail.length}`,
        )
        .join("|"),
    [events],
  );

  useEffect(() => {
    setExpandedEventIds((current) => {
      const validIds = new Set(events.map((event) => event.id));
      const next = new Set(
        Array.from(current).filter((eventId) => validIds.has(eventId)),
      );

      for (const event of events) {
        if (event.status === "error") {
          next.add(event.id);
          continue;
        }

        if (event.id === latestEventId || event.id === latestRunningEventId) {
          next.add(event.id);
          continue;
        }

        if (event.status === "complete") {
          next.delete(event.id);
        }
      }

      return next;
    });
  }, [events, latestEventId, latestRunningEventId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      block: "end",
      behavior: isRunning && !shouldReduceMotion() ? "smooth" : "auto",
    });
  }, [eventScrollSignature, isRunning]);

  function toggleEvent(eventId: string) {
    setExpandedEventIds((current) => {
      const next = new Set(current);

      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }

      return next;
    });
  }

  return (
    <div className="properties-section side-inspector-panel agentic-panel">
      <label className="field side-inspector-field">
        <span>Build or edit request</span>
        <textarea
          onChange={(event) => setRequest(event.target.value)}
          placeholder={
            project.currentDraft
              ? "Select canvas elements, then describe the targeted edit."
              : "Prompt the design agent to build a component."
          }
          rows={4}
          value={request}
        />
      </label>

      <button
        className="primary-action"
        disabled={isBuilding}
        onClick={() => runBuild(request || "Generate a polished component")}
        type="button"
        style={{ width: "100%" }}
      >
        <span>
          {isBuilding
            ? "Running agent"
            : project.currentDraft
              ? "Run design edit"
              : "Build component"}
        </span>
        <SparkIcon />
      </button>

      {project.currentDraft && selectedTargetCount === 0 && !error && (
        <p className="side-inspector-note">
          Select one or more canvas elements before running a targeted edit.
        </p>
      )}

      {error && <p className="inline-error side-inspector-note">{error}</p>}

      <div className="agentic-panel-header">
        <p className="panel-kicker">Agent activity</p>
        <span className={`agentic-status ${isRunning ? "is-running" : ""}`}>
          {isRunning ? "Running" : "Idle"}
        </span>
      </div>
      <strong className="side-inspector-title">{message}</strong>
      <div className="agentic-event-list">
        {events.length === 0 ? (
          <div className="empty-state side-inspector-empty">
            <span>Agent events will stream here during the next run.</span>
          </div>
        ) : (
          events.map((event) => {
            const isExpanded = expandedEventIds.has(event.id);
            const isActive = event.id === latestRunningEventId;
            const detailText = formatAgentEventDetail(event);

            return (
              <article
                className={`agentic-event is-${event.status} ${
                  isExpanded ? "is-expanded" : "is-collapsed"
                }`}
                key={event.id}
              >
                <button
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} ${event.title}`}
                  className="agentic-event-toggle"
                  onClick={() => toggleEvent(event.id)}
                  type="button"
                >
                  <span className="agentic-event-chevron" />
                </button>
                <span className="agentic-event-dot" aria-hidden="true" />
                <div className="agentic-event-main">
                  <div className="agentic-event-summary">
                    <span className="agentic-event-phase">
                      {formatAgentPhase(event.phase)}
                    </span>
                    <strong>{event.title}</strong>
                    <time dateTime={event.createdAt}>
                      {new Date(event.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </time>
                  </div>
                  <div className="agentic-event-detail-wrap">
                    <p className="agentic-event-detail">
                      {isThinkingAgentEvent(event) && isActive ? (
                        <ThinkingLoopText isActive={isExpanded} />
                      ) : (
                        <StreamingText
                          isActive={isActive && isExpanded}
                          text={detailText}
                        />
                      )}
                    </p>
                  </div>
                </div>
              </article>
            );
          })
        )}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </div>
  );
}

function formatAgentEventDetail(event: AgentActivityEvent) {
  if (event.id !== "agent-planning-output") {
    return event.detail;
  }

  return extractSummaryFromJsonText(event.detail) ?? event.detail;
}

function extractSummaryFromJsonText(value: string) {
  const text = value.trim();

  if (!text.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as { summary?: unknown };
    return typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : null;
  } catch {
    const match = text.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)/);
    if (!match?.[1]) {
      return null;
    }

    try {
      return JSON.parse(`"${match[1]}"`).trim();
    } catch {
      return match[1].replace(/\\"/g, '"').trim();
    }
  }
}

function StreamingText({
  isActive,
  text,
}: {
  isActive: boolean;
  text: string;
}) {
  const [visibleCount, setVisibleCount] = useState(text.length);

  useEffect(() => {
    if (!isActive || shouldReduceMotion()) {
      setVisibleCount(text.length);
      return;
    }

    setVisibleCount(0);
    const step = Math.max(1, Math.ceil(text.length / 72));
    const interval = window.setInterval(() => {
      setVisibleCount((current) => Math.min(text.length, current + step));
    }, 18);

    return () => window.clearInterval(interval);
  }, [isActive, text]);

  return (
    <>
      {text.slice(0, visibleCount)}
      {isActive && visibleCount < text.length ? (
        <span className="agentic-stream-caret" aria-hidden="true" />
      ) : null}
    </>
  );
}

function ThinkingLoopText({ isActive }: { isActive: boolean }) {
  const label = "Thinking...";
  const [cursorIndex, setCursorIndex] = useState(label.length);

  useEffect(() => {
    if (!isActive || shouldReduceMotion()) {
      setCursorIndex(label.length);
      return;
    }

    setCursorIndex(0);
    const interval = window.setInterval(() => {
      setCursorIndex((current) => (current + 1) % (label.length + 5));
    }, 92);

    return () => window.clearInterval(interval);
  }, [isActive]);

  return (
    <span className="agentic-thinking-loop">
      {label.slice(0, Math.min(cursorIndex, label.length))}
      {isActive ? (
        <span className="agentic-stream-caret" aria-hidden="true" />
      ) : null}
    </span>
  );
}

function isThinkingAgentEvent(event: AgentActivityEvent) {
  return event.phase === "thinking" || event.phase === "reasoning";
}

function formatAgentPhase(phase: AgentActivityEvent["phase"]) {
  return phase.replace(/-/g, " ");
}

function shouldReduceMotion() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function AttentionOverlay({ regions }: { regions: AttentionRegion[] }) {
  if (regions.length === 0) {
    return null;
  }

  return (
    <div className="attention-overlay" aria-label="Predicted attention regions">
      {regions.map((region) => (
        <span
          className="attention-region"
          key={region.id}
          style={
            {
              "--x": `${region.x}%`,
              "--y": `${region.y}%`,
              "--w": `${region.width}%`,
              "--h": `${region.height}%`,
              "--heat": region.intensity / 100,
            } as CSSProperties
          }
        >
          <b>{region.label}</b>
        </span>
      ))}
    </div>
  );
}

function ProjectPreview({
  index,
  project,
}: {
  index: number;
  project: TasteProject;
}) {
  if (project.currentDraft) {
    return (
      <div className="homepage-preview" aria-hidden="true">
        <section>
          <strong>{project.currentDraft.headline}</strong>
          <i />
          <b />
        </section>
        <aside />
      </div>
    );
  }

  if (index % 3 === 1) {
    return (
      <div className="pricing-preview" aria-hidden="true">
        <strong>{project.name}</strong>
        <div>
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-preview" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, columnIndex) => (
        <span key={columnIndex}>
          <i />
          <i />
          <i />
          <b />
        </span>
      ))}
    </div>
  );
}

function SettingsPage({
  session,
  settings,
  updateSetting,
}: {
  session: Session;
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const [activeTab, setActiveTab] = useState<"account" | "security">("account");
  const [passwordStep, setPasswordStep] = useState<"idle" | "verify" | "new">(
    "idle",
  );

  return (
    <section className="settings-modal-layout">
      <header className="settings-modal-header">
        <nav className="settings-tabs">
          <button
            className={activeTab === "account" ? "is-active" : ""}
            onClick={() => setActiveTab("account")}
            type="button"
          >
            Account
          </button>
          <button
            className={activeTab === "security" ? "is-active" : ""}
            onClick={() => setActiveTab("security")}
            type="button"
          >
            Security
          </button>
        </nav>
      </header>

      {activeTab === "account" && (
        <div className="settings-scroll-area">
          <div className="settings-section">
            <h3>Profile</h3>
            <div className="settings-row">
              <div className="settings-col">
                <strong>Email</strong>
                <input disabled type="email" value={session.email} />
              </div>
              <div className="settings-col">
                <strong>Role</strong>
                <input disabled type="text" value={session.role} />
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h3>Appearance</h3>
            <div className="settings-row">
              <div className="settings-col">
                <strong>Theme</strong>
                <select
                  onChange={(event) =>
                    updateSetting(
                      "theme",
                      event.target.value as Settings["theme"],
                    )
                  }
                  value={settings.theme}
                >
                  <option value="light">Light theme</option>
                  <option value="dark">Dark theme</option>
                  <option value="system">System theme</option>
                </select>
              </div>
              <label
                className="settings-toggle-row"
                style={{ marginTop: "1.5rem" }}
              >
                <input type="checkbox" defaultChecked />
                <span>
                  <strong>Enhance contrast</strong>
                  <small>
                    When enabled, contrast between text and controls will be
                    increased.
                  </small>
                </span>
              </label>
            </div>
          </div>

          <div className="settings-section">
            <h3>Canvas & Interaction</h3>
            <div className="settings-row">
              <div className="settings-col">
                <strong>Nudge amount</strong>
                <input
                  type="number"
                  value={settings.nudgeAmount}
                  onChange={(event) =>
                    updateSetting("nudgeAmount", Number(event.target.value))
                  }
                />
              </div>
              <label
                className="settings-toggle-row"
                style={{ marginTop: "1.5rem" }}
              >
                <input
                  checked={settings.snapping}
                  onChange={(event) =>
                    updateSetting("snapping", event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <strong>Snapping</strong>
                  <small>Snap to geometry and objects.</small>
                </span>
              </label>
              <label className="settings-toggle-row">
                <input
                  checked={settings.multiplayerCursors}
                  onChange={(event) =>
                    updateSetting("multiplayerCursors", event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <strong>Multiplayer cursors</strong>
                  <small>Show others' cursors on the canvas.</small>
                </span>
              </label>
            </div>
          </div>
        </div>
      )}

      {activeTab === "security" && (
        <div className="settings-scroll-area">
          <div className="settings-section">
            <button
              className="text-button"
              type="button"
              style={{ fontWeight: 500 }}
            >
              Enable two-factor authentication
            </button>
          </div>

          <div className="settings-section">
            <h3>Password</h3>
            {passwordStep === "idle" ? (
              <button
                className="text-button"
                onClick={() => setPasswordStep("verify")}
                type="button"
                style={{ fontWeight: 500 }}
              >
                Change password
              </button>
            ) : passwordStep === "verify" ? (
              <div className="settings-row">
                <p className="muted small" style={{ marginBottom: "0.5rem" }}>
                  A verification code has been sent to{" "}
                  <strong>{session.email}</strong>. Please enter it below.
                </p>
                <div className="settings-col">
                  <strong>Verification code</strong>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.8rem",
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="text"
                      placeholder="6-digit code"
                      maxLength={6}
                      style={{ maxWidth: "10rem" }}
                    />
                    <button
                      className="primary-action"
                      onClick={() => setPasswordStep("new")}
                      type="button"
                    >
                      Verify
                    </button>
                    <button
                      className="secondary-action"
                      onClick={() => setPasswordStep("idle")}
                      type="button"
                      style={{ border: "none", background: "transparent" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="settings-row">
                <div className="settings-col">
                  <strong>New password</strong>
                  <input type="password" placeholder="Enter new password" />
                </div>
                <div className="settings-col">
                  <strong>Confirm new password</strong>
                  <input type="password" placeholder="Confirm new password" />
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "0.8rem",
                    marginTop: "0.5rem",
                  }}
                >
                  <button
                    className="primary-action"
                    onClick={() => {
                      setPasswordStep("idle");
                      alert("Password updated successfully!");
                    }}
                    type="button"
                  >
                    Update password
                  </button>
                  <button
                    className="secondary-action"
                    onClick={() => setPasswordStep("idle")}
                    type="button"
                    style={{ border: "none", background: "transparent" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="settings-section">
            <h3>Sessions</h3>
            <p className="muted small" style={{ marginBottom: "1.5rem" }}>
              All of your active sessions are listed below. End any sessions you
              don't recognize or trust.
            </p>
            <div className="security-table">
              <div className="security-row header">
                <div className="security-cell">Location</div>
                <div className="security-cell">Device</div>
                <div className="security-cell">Date</div>
                <div className="security-cell" />
              </div>

              <div className="security-row">
                <div className="security-cell">San Francisco, CA, US</div>
                <div className="security-cell-icon">
                  <MonitorIcon />
                  <div>
                    <strong>Mac OS X · Chrome</strong>
                    <small>192.168.1.1 (Current)</small>
                  </div>
                </div>
                <div className="security-cell">
                  <strong>Today</strong>
                  <small>10:24 AM</small>
                </div>
                <div className="security-cell actions">
                  <span className="soft-badge">Active</span>
                </div>
              </div>

              <div className="security-row">
                <div className="security-cell">Los Angeles, CA, US</div>
                <div className="security-cell-icon">
                  <PhoneIcon />
                  <div>
                    <strong>iOS · Safari</strong>
                    <small>10.0.0.45</small>
                  </div>
                </div>
                <div className="security-cell">
                  <strong>Yesterday</strong>
                  <small>8:15 PM</small>
                </div>
                <div className="security-cell actions">
                  <button className="text-button">Sign out</button>
                </div>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h3>Personal access tokens</h3>
            <p className="muted small" style={{ marginBottom: "1.5rem" }}>
              Tokens you have generated that can be used to access the Taste Lab
              API.
            </p>
            <button
              className="text-button"
              type="button"
              style={{ fontWeight: 500 }}
            >
              Generate new token
            </button>
          </div>

          <div className="settings-section">
            <h3>Connected apps</h3>
            <p className="muted small">
              You haven't authorized any applications to access your Taste Lab
              account.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function mergeProject(projects: TasteProject[], project: TasteProject) {
  const index = projects.findIndex((current) => current.slug === project.slug);

  if (index < 0) {
    return [project, ...projects];
  }

  return [...projects.slice(0, index), project, ...projects.slice(index + 1)];
}

function createClientAgentEvent(
  phase: AgentActivityEvent["phase"],
  title: string,
  detail: string,
  status: AgentActivityEvent["status"],
): AgentActivityEvent {
  return {
    id: `client-agent-event-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`,
    phase,
    title,
    detail,
    status,
    createdAt: new Date().toISOString(),
  };
}

function upsertAgentActivity(
  events: AgentActivityEvent[],
  nextEvent: AgentActivityEvent,
) {
  const existingIndex = events.findIndex((event) => event.id === nextEvent.id);

  if (existingIndex === -1) {
    return [...events, nextEvent];
  }

  return events.map((event, index) =>
    index === existingIndex ? nextEvent : event,
  );
}

function parseAgentStreamMessage(line: string): AgentStreamMessage | null {
  const trimmed = line.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as AgentStreamMessage;
  } catch {
    return null;
  }
}

function readPersistedSettings() {
  const rawSettings = window.localStorage.getItem(SETTINGS_KEY);

  if (!rawSettings) {
    return defaultSettings;
  }

  try {
    const persisted = JSON.parse(rawSettings) as Partial<Settings>;

    return {
      ...defaultSettings,
      ...persisted,
      theme: isTheme(persisted.theme) ? persisted.theme : defaultSettings.theme,
    };
  } catch {
    window.localStorage.removeItem(SETTINGS_KEY);
    return defaultSettings;
  }
}

function isTheme(value: unknown): value is Settings["theme"] {
  return value === "light" || value === "dark" || value === "system";
}

function PenPropertiesPanel({
  settings,
  selectedPath,
  onUpdate,
}: {
  settings: PenSettings;
  selectedPath?: CanvasElement;
  onUpdate: (updates: Partial<PenSettings>) => void;
}) {
  const normalizedSettings = normalizePenSettings(settings);

  return (
    <div style={{ padding: "1rem" }}>
      <p className="panel-kicker">
        {selectedPath ? "Stroke Properties" : "Pen Properties"}
      </p>

      <label className="field" style={{ marginTop: "1rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Color</span>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="color"
            value={normalizedSettings.color}
            onChange={(event) => onUpdate({ color: event.target.value })}
            style={{ width: "50px", height: "30px", cursor: "pointer" }}
          />
          <input
            type="text"
            value={normalizedSettings.color}
            onChange={(event) => onUpdate({ color: event.target.value })}
            style={{ fontSize: "0.85rem", flex: 1 }}
          />
        </div>
      </label>

      <label className="field" style={{ marginTop: "1rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Size</span>
        <input
          type="range"
          min="1"
          max="48"
          value={normalizedSettings.size}
          onChange={(event) => onUpdate({ size: Number(event.target.value) })}
          style={{ width: "100%" }}
        />
        <span style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>
          {normalizedSettings.size}px
        </span>
      </label>

      <label className="field" style={{ marginTop: "1rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Opacity</span>
        <input
          type="range"
          min="0"
          max="100"
          value={normalizedSettings.opacity}
          onChange={(event) =>
            onUpdate({ opacity: Number(event.target.value) })
          }
          style={{ width: "100%" }}
        />
        <span style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>
          {normalizedSettings.opacity}%
        </span>
      </label>
    </div>
  );
}

function TextPropertiesPanel({
  element,
  onUpdate,
  onFitBounds,
}: {
  element: CanvasElement;
  onUpdate: (updates: Partial<CanvasElement>) => void;
  onFitBounds: () => void;
}) {
  const textFitAudit = getCanvasTextFitAudit(element);

  return (
    <div style={{ padding: "1rem" }}>
      <p className="panel-kicker">Text Properties</p>

      {textFitAudit.clipped ? (
        <div
          style={{
            marginTop: "0.5rem",
            padding: "0.75rem",
            background: "var(--warning-soft, #fff7d6)",
            borderRadius: "6px",
            fontSize: "0.8rem",
            color: "var(--warning, #8a5a00)",
          }}
        >
          <strong>Text is clipped.</strong>
          <div style={{ marginTop: "0.25rem" }}>
            Needs {Math.ceil(textFitAudit.requiredWidth)} ×{" "}
            {Math.ceil(textFitAudit.requiredHeight)}.
          </div>
          <button
            className="secondary-action"
            onClick={onFitBounds}
            style={{ marginTop: "0.5rem", width: "100%" }}
            type="button"
          >
            Fit bounds
          </button>
        </div>
      ) : (
        <div
          style={{
            marginTop: "0.5rem",
            padding: "0.75rem",
            background: "var(--blue-soft)",
            borderRadius: "6px",
            fontSize: "0.8rem",
            color: "var(--blue)",
          }}
        >
          <strong>Tip:</strong> Click the text to edit inline
        </div>
      )}

      {/* Text Content */}
      <label className="field" style={{ marginTop: "1rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Content</span>
        <textarea
          value={element.content || ""}
          onChange={(e) =>
            onUpdate({
              content: e.target.value,
              textStyleRuns: normalizeTextStyleRuns(
                element.textStyleRuns,
                e.target.value.length,
              ),
            })
          }
          rows={3}
          style={{ fontSize: "0.85rem" }}
        />
      </label>

      {/* Font Family */}
      <label className="field" style={{ marginTop: "1rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Font</span>
        <select
          value={element.style?.fontFamily || DEFAULT_CANVAS_FONT}
          onChange={(e) =>
            onUpdate({
              style: { ...element.style, fontFamily: e.target.value },
            })
          }
          style={{ fontSize: "0.85rem" }}
        >
          {FONT_PRESETS.map((font) => (
            <option key={font.label} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>
      </label>

      {/* Font Size */}
      <label className="field" style={{ marginTop: "1rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Size</span>
        <input
          type="range"
          min="8"
          max="72"
          value={element.style?.fontSize || 16}
          onChange={(e) =>
            onUpdate({
              style: { ...element.style, fontSize: parseInt(e.target.value) },
            })
          }
          style={{ width: "100%" }}
        />
        <span style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>
          {element.style?.fontSize || 16}px
        </span>
      </label>

      {/* Color */}
      <label className="field" style={{ marginTop: "1rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Color</span>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="color"
            value={element.style?.fill || "#000000"}
            onChange={(e) =>
              onUpdate({
                style: { ...element.style, fill: e.target.value },
              })
            }
            style={{ width: "50px", height: "30px", cursor: "pointer" }}
          />
          <input
            type="text"
            value={element.style?.fill || "#000000"}
            onChange={(e) =>
              onUpdate({
                style: { ...element.style, fill: e.target.value },
              })
            }
            style={{ fontSize: "0.85rem", flex: 1 }}
          />
        </div>
      </label>

      {/* Opacity */}
      <label className="field" style={{ marginTop: "1rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Opacity</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={element.style?.opacity || 1}
          onChange={(e) =>
            onUpdate({
              style: { ...element.style, opacity: parseFloat(e.target.value) },
            })
          }
          style={{ width: "100%" }}
        />
        <span style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>
          {((element.style?.opacity || 1) * 100).toFixed(0)}%
        </span>
      </label>

      {/* Font Weight */}
      <label className="field" style={{ marginTop: "1rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Weight</span>
        <select
          value={element.style?.fontWeight || "normal"}
          onChange={(e) =>
            onUpdate({
              style: { ...element.style, fontWeight: e.target.value },
            })
          }
          style={{ fontSize: "0.85rem" }}
        >
          <option value="normal">Normal</option>
          <option value="bold">Bold</option>
          <option value="100">Thin (100)</option>
          <option value="200">Extra Light (200)</option>
          <option value="300">Light (300)</option>
          <option value="400">Regular (400)</option>
          <option value="500">Medium (500)</option>
          <option value="600">Semi Bold (600)</option>
          <option value="700">Bold (700)</option>
          <option value="800">Extra Bold (800)</option>
          <option value="900">Black (900)</option>
        </select>
      </label>

      {/* Font Style */}
      <label className="field" style={{ marginTop: "1rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Style</span>
        <select
          value={element.style?.fontStyle || "normal"}
          onChange={(e) =>
            onUpdate({
              style: { ...element.style, fontStyle: e.target.value },
            })
          }
          style={{ fontSize: "0.85rem" }}
        >
          <option value="normal">Normal</option>
          <option value="italic">Italic</option>
        </select>
      </label>

      {/* Text Align */}
      <label className="field" style={{ marginTop: "1rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Align</span>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {["left", "center", "right"].map((align) => (
            <button
              key={align}
              className={`secondary-action ${element.style?.textAlign === align ? "is-selected" : ""}`}
              onClick={() =>
                onUpdate({
                  style: {
                    ...element.style,
                    textAlign: align as "left" | "center" | "right",
                  },
                })
              }
              style={{
                flex: 1,
                padding: "0.4rem",
                fontSize: "0.8rem",
                background:
                  element.style?.textAlign === align
                    ? "var(--blue-soft)"
                    : "transparent",
                color:
                  element.style?.textAlign === align
                    ? "var(--blue)"
                    : "var(--ink)",
              }}
            >
              {align.charAt(0).toUpperCase() + align.slice(1)}
            </button>
          ))}
        </div>
      </label>

      {/* Letter Spacing */}
      <label className="field" style={{ marginTop: "1rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
          Letter Spacing
        </span>
        <input
          type="range"
          min="-2"
          max="10"
          step="0.5"
          value={element.style?.letterSpacing || 0}
          onChange={(e) =>
            onUpdate({
              style: {
                ...element.style,
                letterSpacing: parseFloat(e.target.value),
              },
            })
          }
          style={{ width: "100%" }}
        />
        <span style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>
          {element.style?.letterSpacing || 0}px
        </span>
      </label>

      {/* Line Height */}
      <label className="field" style={{ marginTop: "1rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Line Height</span>
        <input
          type="range"
          min="0.5"
          max="3"
          step="0.1"
          value={element.style?.lineHeight || 1.5}
          onChange={(e) =>
            onUpdate({
              style: {
                ...element.style,
                lineHeight: parseFloat(e.target.value),
              },
            })
          }
          style={{ width: "100%" }}
        />
        <span style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>
          {element.style?.lineHeight || 1.5}
        </span>
      </label>
    </div>
  );
}

function inferProjectName(brief: string) {
  return brief
    .replace(/[^\w\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(" ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getInitials(value: string) {
  return value
    .split(/[.\s@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
