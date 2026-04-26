import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const toolPath = join(
  root,
  "apps/web/lib/server/agent-tools/design-document-tools.ts",
);
const skillPath = join(
  root,
  "apps/web/skills/targeted-canvas-edit/SKILL.md",
);
const toolSource = readFileSync(toolPath, "utf8");
const skillSource = readFileSync(skillPath, "utf8");
const runnerSource = readFileSync(
  join(root, "apps/web/lib/server/agent-runner/taste-agent-runner.ts"),
  "utf8",
);

const checks = [
  {
    label: "edit contexts use targeted patch path",
    source: toolSource,
    needle: 'if (intent === "edit" && editContext)',
  },
  {
    label: "unresolved targets preserve the canvas",
    source: toolSource,
    needle: "No resolved target nodes; preserved the canvas.",
  },
  {
    label: "view node membership is guarded",
    source: toolSource,
    needle: "Scoped edit attempted to change view membership.",
  },
  {
    label: "unrelated nodes are guarded",
    source: toolSource,
    needle: "Scoped edit attempted to change an unrelated node.",
  },
  {
    label: "image artifact keys are guarded",
    source: toolSource,
    needle: "Scoped edit attempted to change or clear an image artifact.",
  },
  {
    label: "skill documents image artifact preservation",
    source: skillSource,
    needle: "Preserve every image node's `artifactKey`.",
  },
  {
    label: "edit runs use the pre-draft design as patch base",
    source: runnerSource,
    needle: 'request.intent === "edit"',
  },
  {
    label: "edit runs do not create seed design documents",
    source: runnerSource,
    needle: 'createDesignVersion: request.intent !== "edit"',
  },
];

const failed = checks.filter((check) => !check.source.includes(check.needle));

if (failed.length) {
  for (const check of failed) {
    console.error(`targeted edit guard check failed: ${check.label}`);
  }
  process.exit(1);
}

console.log(`targeted edit guard checks passed (${checks.length})`);
