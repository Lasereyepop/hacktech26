import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const webRequire = createRequire(join(root, "apps/web/package.json"));
const ts = webRequire("typescript");
const toolPath = join(
  root,
  "apps/web/lib/server/agent-tools/design-document-tools.ts",
);
const source = readFileSync(toolPath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

let lastPatchedDocument = null;
const realRequire = createRequire(toolPath);
const mockedRequire = (specifier) => {
  if (specifier === "@/lib/server/project-store") {
    return {
      createDesignDocumentNode: () => {
        throw new Error("createDesignDocumentNode should not run in this check");
      },
      patchDesignDocument: (_slug, _version, documentJson) => {
        lastPatchedDocument = documentJson;
        return {
          id: "patched-design",
          projectId: "project-1",
          version: 2,
          sourceType: "fig-like",
          schemaVersion: 1,
          documentJson,
          createdAt: new Date(0).toISOString(),
        };
      },
    };
  }

  if (specifier === "@/lib/text-fit") {
    return {
      auditDesignTextNodes: () => [],
      fitTextBounds: ({ text, bounds, style }) => ({
        width: Math.max(bounds.width, Math.ceil(String(text).length * 7)),
        height: Math.max(bounds.height, Number(style?.fontSize ?? 16) * 1.4),
      }),
    };
  }

  if (specifier === "@/lib/text-style-runs") {
    return {
      normalizeTextStyleRuns: (runs) => (Array.isArray(runs) ? runs : []),
    };
  }

  if (specifier === "@/lib/server/agent-runner/skill-prompts") {
    return { DOCUMENT_DESIGN_DIRECTION: "targeted-edit-test-contract" };
  }

  if (specifier === "@/lib/server/agent-typography") {
    return {
      chooseTypographySystem: () => ({ fontFamily: "Inter" }),
      normalizeTypographySystem: (value) => value,
    };
  }

  if (specifier === "@/lib/server/agent-tools/artboard-settings") {
    return {
      applyArtboardSettingsToDocument: ({ document }) => document,
      REFERENCE_ARTBOARD_HEIGHT: 900,
      REFERENCE_ARTBOARD_WIDTH: 1440,
    };
  }

  return realRequire(specifier);
};

const module = { exports: {} };
const execute = new Function(
  "require",
  "exports",
  "module",
  "__filename",
  "__dirname",
  compiled,
);
execute(mockedRequire, module.exports, module, toolPath, dirname(toolPath));

const { applyDesignDocumentTool, __targetedEditBehaviorTestHooks } =
  module.exports;
const { patchTargetedEdit } = __targetedEditBehaviorTestHooks;

const routePath = join(
  root,
  "apps/web/app/api/projects/[slug]/agent-runs/route.ts",
);
const routeSource = readFileSync(routePath, "utf8");
const routeCompiled = ts.transpileModule(routeSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const routeMockedRequire = (specifier) => {
  if (specifier === "next/server") {
    return {
      NextResponse: {
        json: (body, init) => ({ body, init }),
      },
    };
  }

  if (specifier === "@/lib/server/agent-runner") {
    return {
      runTasteLabAgent: () => {
        throw new Error("runTasteLabAgent should not run in this check");
      },
    };
  }

  if (specifier === "@/lib/server/project-store") {
    return {
      getProject: () => null,
    };
  }

  return realRequire(specifier);
};
const routeModule = { exports: {} };
const executeRoute = new Function(
  "require",
  "exports",
  "module",
  "__filename",
  "__dirname",
  routeCompiled,
);
executeRoute(
  routeMockedRequire,
  routeModule.exports,
  routeModule,
  routePath,
  dirname(routePath),
);
const { normalizeEditContext, MAX_EDIT_CONTEXT_NODES } =
  routeModule.exports.__agentRunsRouteTestHooks;

function createDocument() {
  return {
    pages: [{ id: "page-1", name: "Page", viewIds: ["draft"] }],
    views: [
      {
        id: "draft",
        name: "Draft",
        width: 1440,
        height: 900,
        nodeIds: ["headline", "cta", "hero-image", "decor"],
      },
    ],
    nodes: [
      {
        id: "headline",
        type: "text",
        viewId: "draft",
        name: "Hero headline",
        props: {
          text: "Old headline",
          style: { fontSize: 44, lineHeight: 1.1 },
        },
        bounds: { x: 80, y: 180, width: 420, height: 96 },
      },
      {
        id: "cta",
        type: "button",
        viewId: "draft",
        name: "Primary CTA",
        props: {
          text: "Start",
          style: { fontSize: 16, lineHeight: 1.2 },
        },
        bounds: { x: 80, y: 260, width: 140, height: 48 },
      },
      {
        id: "hero-image",
        type: "image",
        viewId: "draft",
        name: "Hero image",
        props: {
          artifactKey: "artifact/hero.png",
          objectFit: "cover",
          alt: "Hero",
        },
        bounds: { x: 700, y: 120, width: 420, height: 300 },
      },
      {
        id: "decor",
        type: "rectangle",
        viewId: "draft",
        name: "Decor",
        props: { style: { fill: "#eee" } },
        bounds: { x: 64, y: 84, width: 20, height: 20 },
      },
    ],
    styles: {},
    metadata: {
      projectName: "Taste test",
      projectType: "website",
      generatedAt: new Date(0).toISOString(),
    },
  };
}

const draft = {
  id: "draft-1",
  title: "Draft",
  summary: "Updated copy",
  headline: "New targeted headline",
  subheadline: "New subheadline",
  eyebrow: "New eyebrow",
  primaryAction: "Join now",
  navigation: ["Home", "Proof", "Contact"],
  sections: [],
  palette: [],
};

const documentBefore = createDocument();
const editContext = {
  source: "inspector",
  viewId: "draft",
  commentBounds: null,
  selectedNodeIds: ["headline"],
  directNodeIds: ["headline"],
  inferredNodeIds: [],
  targetNodeIds: ["headline"],
  targetResolution: "selected",
  targetConfidence: "high",
  imageEditIntent: false,
  nodes: [
    {
      id: "headline",
      type: "text",
      name: "Hero headline",
      bounds: { x: 80, y: 180, width: 420, height: 96 },
      text: "Old headline",
      targetSource: "target",
      canMutate: true,
    },
  ],
};
const patched = patchTargetedEdit({
  document: documentBefore,
  prompt: "Update the headline copy",
  draft,
  editContext,
  summary: "Scoped headline edit",
});

assert.equal(patched.nodes.length, documentBefore.nodes.length);
assert.deepEqual(patched.views, documentBefore.views);
assert.equal(
  patched.nodes.find((node) => node.id === "headline")?.props.text,
  "New targeted headline",
);
for (const id of ["cta", "hero-image", "decor"]) {
  assert.deepEqual(
    patched.nodes.find((node) => node.id === id),
    documentBefore.nodes.find((node) => node.id === id),
    `${id} should not change during a scoped edit`,
  );
}
assert.equal(
  patched.nodes.find((node) => node.id === "hero-image")?.props.artifactKey,
  "artifact/hero.png",
);
assert.equal(patched.styles.agentRunner.targetedEdit.status, "scoped");
assert.deepEqual(patched.styles.agentRunner.targetedEdit.changedNodeIds, [
  "headline",
]);

const typographyPatched = patchTargetedEdit({
  document: documentBefore,
  prompt: "Make the selected font thinner and more premium",
  draft,
  editContext,
  summary: "Scoped typography edit",
});

assert.equal(
  typographyPatched.nodes.find((node) => node.id === "headline")?.props.style
    .fontWeight,
  300,
);
assert.deepEqual(
  typographyPatched.nodes.find((node) => node.id === "cta"),
  documentBefore.nodes.find((node) => node.id === "cta"),
  "typography edit should not touch unselected CTA",
);
assert.equal(
  "textStyleRuns" in typographyPatched.nodes.find((node) => node.id === "headline")
    .props,
  false,
  "style-only edits should not add empty textStyleRuns",
);
assert.equal(typographyPatched.styles.agentRunner.targetedEdit.status, "scoped");

const spacingPatched = patchTargetedEdit({
  document: documentBefore,
  prompt: "Tighten the broad spacing on the selected elements",
  draft,
  editContext,
  summary: "Scoped spacing edit",
});

assert.notEqual(
  spacingPatched.styles.agentRunner.targetedEdit.status,
  "rejected",
);
assert.equal(
  "textStyleRuns" in spacingPatched.nodes.find((node) => node.id === "headline")
    .props,
  false,
  "spacing edits should not add empty textStyleRuns",
);

const broadNodeIds = Array.from({ length: 20 }, (_, index) => `node-${index}`);
const broadContext = normalizeEditContext({
  source: "comment",
  viewId: "draft",
  selectedNodeIds: broadNodeIds,
  directNodeIds: broadNodeIds,
  inferredNodeIds: [],
  targetNodeIds: broadNodeIds,
  targetResolution: "direct",
  targetConfidence: "high",
  imageEditIntent: false,
  nodes: broadNodeIds.map((id, index) => ({
    id,
    type: "text",
    name: `Node ${index}`,
    bounds: { x: index * 10, y: 0, width: 10, height: 10 },
    text: `Node ${index}`,
  })),
});

assert.equal(MAX_EDIT_CONTEXT_NODES, 64);
assert.equal(broadContext.targetNodeIds.length, broadNodeIds.length);
assert.equal(broadContext.directNodeIds.length, broadNodeIds.length);
assert.equal(broadContext.nodes.length, broadNodeIds.length);

lastPatchedDocument = null;
applyDesignDocumentTool({
  slug: "project",
  intent: "edit",
  prompt: "Replace the whole thing",
  plan: {
    summary: "Attempted unscoped edit",
    draftRequest: "Replace the whole thing",
    documentAction: "patch",
  },
  draft,
  document: {
    id: "design-1",
    projectId: "project-1",
    version: 1,
    sourceType: "fig-like",
    schemaVersion: 1,
    documentJson: createDocument(),
    createdAt: new Date(0).toISOString(),
  },
});

assert.ok(lastPatchedDocument, "missing edit target should still persist metadata");
assert.deepEqual(lastPatchedDocument.nodes, createDocument().nodes);
assert.equal(
  lastPatchedDocument.styles.agentRunner.targetedEdit.reason,
  "No edit target selected; preserved the canvas.",
);
assert.equal(
  lastPatchedDocument.styles.agentRunner.targetedEdit.status,
  "rejected",
);

console.log("targeted edit behavior checks passed");
