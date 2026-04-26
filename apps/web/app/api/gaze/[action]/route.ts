import { NextRequest, NextResponse } from "next/server";

// Proxy to the FastAPI gaze backend. We forward the multipart body unchanged.
// Configure with GAZE_API_URL (defaults to http://127.0.0.1:8000).
//
// Supported actions:
//   - heatmap   → POST /predict/heatmap
//   - scanpath  → POST /predict/scanpath
//   - decoder   → POST /predict/decoder
//
// Why proxy instead of calling the FastAPI directly from the browser?
//   1. Avoids CORS configuration drift between dev/prod.
//   2. Keeps the API URL secret if we deploy the model behind a private network.
//   3. Lets us stamp telemetry / auth / rate limiting on the way through.

const ALLOWED_ACTIONS = new Set(["heatmap", "scanpath", "decoder"]);
const ACTION_TO_PATH: Record<string, string> = {
  heatmap: "/predict/heatmap",
  scanpath: "/predict/scanpath",
  decoder: "/predict/decoder",
};

function backendBaseUrl() {
  return (
    process.env.GAZE_API_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8000"
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: `Unknown gaze action: ${action}` },
      { status: 404 },
    );
  }

  const upstreamUrl = `${backendBaseUrl()}${ACTION_TO_PATH[action]}`;

  // Forward the body and headers (Content-Type with multipart boundary is
  // critical — letting fetch re-derive it would lose the boundary).
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data upload." },
      { status: 415 },
    );
  }

  const body = await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      body,
      headers: {
        "content-type": contentType,
      },
      // The model can take a few seconds for the first run if backbone
      // weights need to be cached on disk. Keep the connection open.
      // Next.js / undici uses keep-alive by default.
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "Could not reach gaze API. Is the FastAPI backend running on " +
          backendBaseUrl() +
          "? Start it with: `PYTHON=/opt/anaconda3/envs/hacktech26/bin/python ./apps/api/run_dev.sh`",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  // Pass the upstream JSON straight through (preserve status code).
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

// Health probe so the dashboard can show "Gaze ready / offline".
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (action !== "health") {
    return NextResponse.json(
      { error: `Use POST for ${action}.` },
      { status: 405 },
    );
  }

  try {
    const upstream = await fetch(`${backendBaseUrl()}/health`, {
      cache: "no-store",
    });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "offline",
        detail: err instanceof Error ? err.message : String(err),
        backend: backendBaseUrl(),
      },
      { status: 503 },
    );
  }
}
