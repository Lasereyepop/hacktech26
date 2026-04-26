# IronSite — Spatial Intelligence for Construction Analytics

```bash
cd ironsite && python3 -m http.server 8080
# Open http://localhost:8080
```

## Key Findings

From predicted gaze heatmaps alone — no manual labeling, no object detection — we extract four actionable insights:

### 1. Activity Classification from Gaze Speed
How fast a worker's predicted gaze moves cleanly separates what they're doing. Active production workers scan quickly between work, tools, and materials (speed 0.43). Idle workers drift slowly (0.34). Transit workers barely move their eyes — just looking ahead (0.30). One metric, instant activity label.

### 2. Engagement Detection from Center Bias
Engaged workers look all around their workspace — their attention is spread across the full field of view (46% center). Disengaged workers stare mostly straight ahead (73% center). This single percentage separates "actively working" from "standing around" without any task-specific knowledge.

### 3. Work Output Counting from Attention Cycles
Repetitive tasks create repeating eye patterns. A mason laying blocks follows the same visual loop: block pile → mortar → wall → repeat. Each loop is one block laid. We detected 74 cycles in 20 minutes for the fastest worker (one block every 14.9s) and 45 for the slowest (every 24.2s). Productivity counting from gaze alone.

### 4. Task Complexity from Cycle Duration
Masonry has many short cycles (21s each) — repetitive, one motion per cycle. Mechanical/plumbing has few long cycles (79s each) — complex multi-step work. The attention pattern alone distinguishes simple repetitive tasks from complex multi-step tasks, and quantifies the difference.

## Pages

- **Cameras** — 6-camera CCTV grid. Press `A` to toggle analytics overlay (heatmaps, status indicators, cycle counters, engagement rings). Click any camera to expand fullscreen with detailed sidebar analytics.
- **Site View** — 3D half-built skyscraper with animated workers. Click a worker to see their heatmap feed and stats.

## Stack

- Frontend: vanilla HTML/JS, Three.js for 3D
- Model: UNet saliency encoder (ResNet-50 backbone), trained on 42 egocentric video segments
- Analysis: per-frame heatmap inference → gaze speed, center bias, cycle detection
- Videos: pre-rendered 45s clips with heatmap overlay at source resolution
