import { existsSync } from "fs";
import { isAbsolute, join, resolve, sep } from "path";

function getWorkspaceRoot() {
  const cwd = process.cwd();
  const webAppSuffix = `${sep}apps${sep}web`;
  return cwd.endsWith(webAppSuffix) ? resolve(cwd, "..", "..") : cwd;
}

export const WORKSPACE_ROOT = getWorkspaceRoot();

const DATA_DIR = resolve(process.cwd(), process.env.DATA_DIR ?? ".local-data");
const ARTIFACT_DIR = join(DATA_DIR, "artifacts");

export function resolveWorkspacePath(inputPath: string) {
  const trimmedPath = inputPath.trim();

  if (!trimmedPath) {
    throw new Error("Path is required");
  }

  if (isAbsolute(trimmedPath)) {
    return resolve(trimmedPath);
  }

  const resolvedPath = resolve(WORKSPACE_ROOT, trimmedPath);
  const workspacePrefix = `${WORKSPACE_ROOT}${sep}`;

  if (
    resolvedPath !== WORKSPACE_ROOT &&
    !resolvedPath.startsWith(workspacePrefix)
  ) {
    throw new Error(`Path must stay within workspace root: ${trimmedPath}`);
  }

  if (trimmedPath.startsWith(".local-data/") && !existsSync(resolvedPath)) {
    const webWorkspacePath = resolve(
      WORKSPACE_ROOT,
      "apps",
      "web",
      trimmedPath,
    );
    const webWorkspacePrefix = `${WORKSPACE_ROOT}${sep}apps${sep}web${sep}`;

    if (
      webWorkspacePath.startsWith(webWorkspacePrefix) &&
      existsSync(webWorkspacePath)
    ) {
      return webWorkspacePath;
    }
  }

  return resolvedPath;
}

export function resolveArtifactPath(artifactKey: string) {
  const trimmedKey = artifactKey.trim();

  if (!trimmedKey) {
    throw new Error("Artifact key is required");
  }

  if (isAbsolute(trimmedKey)) {
    throw new Error("Artifact key must be relative");
  }

  const resolvedPath = resolve(ARTIFACT_DIR, trimmedKey);
  const artifactPrefix = `${ARTIFACT_DIR}${sep}`;

  if (
    resolvedPath !== ARTIFACT_DIR &&
    !resolvedPath.startsWith(artifactPrefix)
  ) {
    throw new Error(
      `Artifact key must stay within artifact root: ${trimmedKey}`,
    );
  }

  return resolvedPath;
}
