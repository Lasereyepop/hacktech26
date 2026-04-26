# Taste Lab — Web

Next.js 16 + React 19 frontend for the Taste Lab design workspace.

## Dev

```bash
npm install        # from the repo root, npm workspaces installs everything
npm run dev        # http://localhost:3000
npm run lint       # tsc --noEmit
```

The dev server reads from `apps/web/.local-data/` for project state and
artifacts (the directory is created on first run).

## Gaze prediction integration

The "Gaze prediction" section in the Artboard inspector (right-hand panel,
visible when nothing is selected on the canvas) lets a designer run the
trained gaze model on the current artboard and see the predicted scanpath +
fixations as an overlay.

### Architecture

```
[ Artboard DOM ]
    │  html-to-image rasterize + crop to artboard rect
    ▼
[ PNG Blob ]
    │  POST multipart
    ▼
/api/gaze/scanpath           ← apps/web/app/api/gaze/[action]/route.ts
    │  fetch (server-side)
    ▼
http://127.0.0.1:8000/predict/scanpath   (apps/api FastAPI)
    │  model.run_scanpath_gen
    ▼
{ gaze_sequence, fixations, heatmap_b64, overlay_b64 }
```

The proxy is a single dynamic route that supports four upstream paths
(`health`, `heatmap`, `scanpath`, `decoder`). It forwards `multipart/form-data`
verbatim (preserving the boundary) and surfaces a useful error message if the
FastAPI backend is unreachable.

### Configuration

| Env var         | Default                  | Notes                                                                 |
|-----------------|--------------------------|-----------------------------------------------------------------------|
| `GAZE_API_URL`  | `http://127.0.0.1:8000`  | Where the proxy forwards. Set to a remote URL in prod / CI / hosted.  |

### Code map

- `app/api/gaze/[action]/route.ts` — proxy to FastAPI (`POST` for predict
  endpoints, `GET` for `/health`).
- `components/dashboard-experience.tsx`:
  - `type GazeAnalysis` + `type GazeFixation` (top of file)
  - `runGazePrediction`, `captureArtboardPng`, `pingGazeApi` helpers
    (inside `FigmaWorkspacePage`)
  - `<GazeArtboardOverlay>` — heatmap + fixation pins drawn over the
    artboard
  - `<GazePredictionSection>` — the inspector card with predict button,
    status pill, toggles, and fixation list
- `app/globals.css` — `.gaze-*` class definitions (search for "Gaze
  prediction overlay & inspector").

### How to test by hand

1. Start the FastAPI backend (`./apps/api/run_dev.sh`).
2. `npm run dev` and open the dashboard.
3. With nothing selected on the canvas, scroll the right panel to
   **Gaze prediction**.
4. The status pill should read **Backend ready**. Click **Predict gaze**.
   You should see fixation pins and a heatmap on the artboard within a
   few seconds. Toggle off the heatmap or the fixations to verify each
   layer independently. Click **Clear** to remove them.
