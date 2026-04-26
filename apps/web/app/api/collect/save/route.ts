import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { spawn } from "child_process";

import { resolveWorkspacePath } from "@/lib/server/collect-paths";

export const runtime = "nodejs";

interface SaveBody {
  outputPath: string;
  sourcePath?: string;
  data: unknown;
}

async function runPythonSaveScript(scriptPath: string, payload: SaveBody): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("python3", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `save_gaze_npz.py exited with code ${code}`));
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { outputPath, sourcePath, data } = body as SaveBody;

  if (!outputPath) return NextResponse.json({ error: "outputPath required" }, { status: 400 });

  try {
    const resolvedOutputPath = resolveWorkspacePath(outputPath);
    const resolvedSourcePath = sourcePath ? resolveWorkspacePath(sourcePath) : undefined;

    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    const localScriptPath = join(process.cwd(), "scripts", "save_gaze_npz.py");
    const workspaceScriptPath = join(process.cwd(), "apps", "web", "scripts", "save_gaze_npz.py");
    const scriptPath = existsSync(localScriptPath) ? localScriptPath : workspaceScriptPath;
    await runPythonSaveScript(scriptPath, {
      outputPath: resolvedOutputPath,
      sourcePath: resolvedSourcePath,
      data,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const error = e as Error;
    const message = error.message || String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
