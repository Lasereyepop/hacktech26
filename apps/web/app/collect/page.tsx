"use client";

import Script from "next/script";
import { useState, useEffect, useRef, useCallback, type MouseEvent } from "react";

declare global {
  interface Window {
    saveDataAcrossSessions?: boolean;
    webgazer: {
      begin(): Promise<unknown>;
      end(): void;
      isReady?(): boolean;
      setRegression(name: string): Window["webgazer"];
      setGazeListener(
        fn: ((data: { x: number; y: number } | null, elapsed: number) => void) | null
      ): Window["webgazer"];
      clearGazeListener(): Window["webgazer"];
      showPredictionPoints(show: boolean): Window["webgazer"];
      showVideoPreview?(show: boolean): Window["webgazer"];
      showVideo(show: boolean): Window["webgazer"];
      showFaceOverlay(show: boolean): Window["webgazer"];
      showFaceFeedbackBox(show: boolean): Window["webgazer"];
      saveDataAcrossSessions(enabled: boolean): Window["webgazer"];
      applyKalmanFilter?(enabled: boolean): Window["webgazer"];
      clearData(): Window["webgazer"];
    };
  }
}

interface FileEntry {
  path: string;
  relativePath: string;
  type: "image" | "video";
}

interface GazePoint {
  x: number;
  y: number;
  rawX: number;
  rawY: number;
  smoothX: number;
  smoothY: number;
  t: number;
  frame?: number;
  wasClamped: boolean;
  trackingQuality: "stable" | "unstable";
  avgJumpPx: number;
}

interface MediaLayout {
  intrinsicW: number;
  intrinsicH: number;
  displayW: number;
  displayH: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

type TrackingState = "idle" | "starting" | "ready" | "tracking" | "no-face";
type TrackingQuality = "unknown" | "stable" | "unstable" | "jump-rejected";

type Phase = "setup" | "calibration" | "collecting" | "done";

const DEBUG_FIRST_MODE = true;
const CAL_CLICKS_NEEDED = 5;
const CAL_COLS = 3;
const CAL_ROWS = 3;
const MARGIN_PCT = 0.1;
const FIRST_DOT_X_OFFSET = 190;
const DISPLAY_EMA_ALPHA = 0.14;
const RECORD_EMA_ALPHA = 0.2;
const DISPLAY_DEADZONE_PX = 12;
const MAX_JUMP_PX = 180;
const STABILITY_WINDOW = 10;
const STABLE_AVG_JUMP_PX = 32;
const STIMULI_DIR = "stimuli";
const GAZE_OUTPUT_DIR = `${STIMULI_DIR}/gaze_output`;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function averageJump(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  return total / (points.length - 1);
}

function getMediaLayout(intrinsicW: number, intrinsicH: number, viewportW: number, viewportH: number): MediaLayout {
  const scale = Math.min(viewportW / intrinsicW, viewportH / intrinsicH);
  const displayW = Math.trunc(intrinsicW * scale);
  const displayH = Math.trunc(intrinsicH * scale);
  return {
    intrinsicW,
    intrinsicH,
    displayW,
    displayH,
    offsetX: Math.floor((viewportW - displayW) / 2),
    offsetY: Math.floor((viewportH - displayH) / 2),
    scale,
  };
}

function getTrackingLabel(status: TrackingState) {
  switch (status) {
    case "starting":
      return "Starting WebGazer…";
    case "ready":
      return "Camera ready — waiting for prediction";
    case "tracking":
      return "Tracking active";
    case "no-face":
      return "No face / eyes detected";
    default:
      return "Idle";
  }
}

function getTrackingColor(status: TrackingState) {
  switch (status) {
    case "starting":
      return "#ffd166";
    case "ready":
      return "#8ecae6";
    case "tracking":
      return "#00dc82";
    case "no-face":
      return "#ff6b6b";
    default:
      return "rgba(255,255,255,0.6)";
  }
}

function getCalDots(w: number, h: number) {
  const mx = w * MARGIN_PCT;
  const my = h * MARGIN_PCT;
  const dots: { x: number; y: number }[] = [];
  for (let r = 0; r < CAL_ROWS; r++) {
    for (let c = 0; c < CAL_COLS; c++) {
      dots.push({
        x: mx + ((w - 2 * mx) * c) / (CAL_COLS - 1),
        y: my + ((h - 2 * my) * r) / (CAL_ROWS - 1),
      });
    }
  }

  if (dots[0]) {
    dots[0] = {
      ...dots[0],
      x: Math.min(dots[0].x + FIRST_DOT_X_OFFSET, w - mx),
    };
  }

  return dots;
}

export default function CollectPage() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loadError, setLoadError] = useState("");
  const [webgazerReady, setWebgazerReady] = useState(false);
  const [startingWebgazer, setStartingWebgazer] = useState(false);
  const [calibrationError, setCalibrationError] = useState("");
  const [trackingState, setTrackingState] = useState<TrackingState>("idle");
  const [debugElapsedMs, setDebugElapsedMs] = useState<number | null>(null);

  // Calibration
  const [calDotIndex, setCalDotIndex] = useState(0);
  const [calClicks, setCalClicks] = useState(0);
  const [calDots, setCalDots] = useState<{ x: number; y: number }[]>([]);

  // Collection
  const [fileIndex, setFileIndex] = useState(0);
  const [gazePoints, setGazePoints] = useState<GazePoint[]>([]);
  const [gHeld, setGHeld] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [gazePos, setGazePos] = useState<{ x: number; y: number } | null>(null);
  const [rawGazePos, setRawGazePos] = useState<{ x: number; y: number } | null>(null);
  const [mediaLayout, setMediaLayout] = useState<MediaLayout | null>(null);
  const [trackingQuality, setTrackingQuality] = useState<TrackingQuality>("unknown");
  const [rollingAvgJumpPx, setRollingAvgJumpPx] = useState(0);
  const [latestJumpPx, setLatestJumpPx] = useState(0);
  const [stableForMs, setStableForMs] = useState(0);
  const [acceptedSamples, setAcceptedSamples] = useState(0);
  const [rejectedSamples, setRejectedSamples] = useState(0);

  const imageRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const gHeldRef = useRef(false);
  const gazePointsRef = useRef<GazePoint[]>([]);
  const webgazerStartedRef = useRef(false);
  const phaseRef = useRef<Phase>("setup");
  const currentFileRef = useRef<FileEntry | null>(null);
  const displaySmoothedRef = useRef<{ x: number; y: number } | null>(null);
  const recordSmoothedRef = useRef<{ x: number; y: number } | null>(null);
  const lastAcceptedRawRef = useRef<{ x: number; y: number } | null>(null);
  const displayGazeRef = useRef<{ x: number; y: number } | null>(null);
  const rollingWindowRef = useRef<Array<{ x: number; y: number }>>([]);
  const stableSinceRef = useRef<number | null>(null);
  const acceptedSamplesRef = useRef(0);
  const rejectedSamplesRef = useRef(0);
  const mediaLayoutRef = useRef<MediaLayout | null>(null);
  const videoFrameIndexRef = useRef<number | null>(null);
  const videoFrameCallbackHandleRef = useRef<number | null>(null);
  const videoFpsRef = useRef<number | null>(null);

  // Keep refs in sync
  useEffect(() => { gHeldRef.current = gHeld; }, [gHeld]);
  useEffect(() => { gazePointsRef.current = gazePoints; }, [gazePoints]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { mediaLayoutRef.current = mediaLayout; }, [mediaLayout]);

  const currentFile = files[fileIndex] ?? null;

  useEffect(() => {
    currentFileRef.current = currentFile;
  }, [currentFile]);

  const dirPath = STIMULI_DIR;
  const outputDir = GAZE_OUTPUT_DIR;

  const updateMediaLayout = useCallback((intrinsicW: number, intrinsicH: number) => {
    if (!intrinsicW || !intrinsicH) return;
    setMediaLayout(getMediaLayout(intrinsicW, intrinsicH, window.innerWidth, window.innerHeight));
  }, []);

  const resetFilterState = useCallback(() => {
    displaySmoothedRef.current = null;
    recordSmoothedRef.current = null;
    lastAcceptedRawRef.current = null;
    displayGazeRef.current = null;
    rollingWindowRef.current = [];
    stableSinceRef.current = null;
    acceptedSamplesRef.current = 0;
    rejectedSamplesRef.current = 0;
    setRawGazePos(null);
    setTrackingQuality("unknown");
    setRollingAvgJumpPx(0);
    setLatestJumpPx(0);
    setStableForMs(0);
    setAcceptedSamples(0);
    setRejectedSamples(0);
  }, []);

  const getCurrentVideoFrameIndex = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return 0;
    }

    if (videoFrameIndexRef.current !== null) {
      return videoFrameIndexRef.current;
    }

    const fps = videoFpsRef.current ?? 30;
    return Math.floor(video.currentTime * fps);
  }, []);

  const attachGazeListener = useCallback(() => {
    window.webgazer.setGazeListener((data, elapsed) => {
      setDebugElapsedMs(elapsed);

      if (!data) {
        resetFilterState();
        setGazePos(null);
        setTrackingState(webgazerStartedRef.current ? "no-face" : "idle");
        return;
      }

      const rawPoint = { x: data.x, y: data.y };
      const clampedPoint = {
        x: clamp(data.x, 0, window.innerWidth),
        y: clamp(data.y, 0, window.innerHeight),
      };
      const wasClamped = rawPoint.x !== clampedPoint.x || rawPoint.y !== clampedPoint.y;
      setRawGazePos(clampedPoint);

      const jumpPx = lastAcceptedRawRef.current ? distance(clampedPoint, lastAcceptedRawRef.current) : 0;
      setLatestJumpPx(jumpPx);

      if (lastAcceptedRawRef.current && jumpPx > MAX_JUMP_PX) {
        setTrackingQuality("jump-rejected");
        setStableForMs(0);
        stableSinceRef.current = null;
        if (phaseRef.current === "collecting" && gHeldRef.current) {
          rejectedSamplesRef.current += 1;
          setRejectedSamples(rejectedSamplesRef.current);
        }
        return;
      }

      lastAcceptedRawRef.current = clampedPoint;
      rollingWindowRef.current = [...rollingWindowRef.current.slice(-(STABILITY_WINDOW - 1)), clampedPoint];
      const avgJumpPx = averageJump(rollingWindowRef.current);
      setRollingAvgJumpPx(avgJumpPx);

      const hasFullWindow = rollingWindowRef.current.length >= STABILITY_WINDOW;
      const quality: TrackingQuality = hasFullWindow && avgJumpPx <= STABLE_AVG_JUMP_PX ? "stable" : "unstable";
      setTrackingQuality(quality);

      if (quality === "stable") {
        if (stableSinceRef.current === null) {
          stableSinceRef.current = performance.now();
        }
        setStableForMs(performance.now() - stableSinceRef.current);
      } else {
        stableSinceRef.current = null;
        setStableForMs(0);
      }

      if (!displaySmoothedRef.current) {
        displaySmoothedRef.current = clampedPoint;
      } else {
        displaySmoothedRef.current = {
          x: displaySmoothedRef.current.x + DISPLAY_EMA_ALPHA * (clampedPoint.x - displaySmoothedRef.current.x),
          y: displaySmoothedRef.current.y + DISPLAY_EMA_ALPHA * (clampedPoint.y - displaySmoothedRef.current.y),
        };
      }

      if (!recordSmoothedRef.current) {
        recordSmoothedRef.current = clampedPoint;
      } else {
        recordSmoothedRef.current = {
          x: recordSmoothedRef.current.x + RECORD_EMA_ALPHA * (clampedPoint.x - recordSmoothedRef.current.x),
          y: recordSmoothedRef.current.y + RECORD_EMA_ALPHA * (clampedPoint.y - recordSmoothedRef.current.y),
        };
      }

      const displayPoint = displaySmoothedRef.current;
      const recordPoint = recordSmoothedRef.current;
      const shouldUpdateDisplay = !displayGazeRef.current || distance(displayPoint, displayGazeRef.current) >= DISPLAY_DEADZONE_PX;
      if (shouldUpdateDisplay) {
        displayGazeRef.current = displayPoint;
      }

      setGazePos(displayGazeRef.current ?? displayPoint);
      setTrackingState("tracking");

      if (phaseRef.current === "collecting" && gHeldRef.current) {
        if (quality !== "stable" || wasClamped) {
          rejectedSamplesRef.current += 1;
          setRejectedSamples(rejectedSamplesRef.current);
          return;
        }

        const activeFile = currentFileRef.current;
        const point: GazePoint = {
          x: recordPoint.x,
          y: recordPoint.y,
          rawX: clampedPoint.x,
          rawY: clampedPoint.y,
          smoothX: recordPoint.x,
          smoothY: recordPoint.y,
          t: performance.now(),
          frame: activeFile?.type === "video" ? getCurrentVideoFrameIndex() : undefined,
          wasClamped,
          trackingQuality: "stable",
          avgJumpPx,
        };
        gazePointsRef.current = [...gazePointsRef.current, point];
        setGazePoints(gazePointsRef.current);
        acceptedSamplesRef.current += 1;
        setAcceptedSamples(acceptedSamplesRef.current);
      }
    });
  }, [getCurrentVideoFrameIndex, resetFilterState]);

  const fileUrl = useCallback((path: string) =>
    `/api/collect/file?path=${encodeURIComponent(path)}`, []);

  // ── Setup ────────────────────────────────────────────────────────────────

  const loadFiles = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch(`/api/collect/files?dir=${encodeURIComponent(dirPath)}`);
      const json = await res.json();
      if (json.error) { setLoadError(json.error); return; }
      if (json.files.length === 0) { setLoadError("No image or video files found."); return; }
      setFiles(json.files);
    } catch (e) {
      setLoadError(String(e));
    }
  }, [dirPath]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  async function startCalibration() {
    if (!webgazerReady || startingWebgazer) return;

    setCalibrationError("");
    setStartingWebgazer(true);
    setTrackingState("starting");
    resetFilterState();

    const dots = getCalDots(window.innerWidth, window.innerHeight);
    setCalDots(dots);
    setCalDotIndex(0);
    setCalClicks(0);

    try {
      attachGazeListener();
      window.webgazer
        .setRegression("ridge")
        .saveDataAcrossSessions(false);
      window.webgazer.applyKalmanFilter?.(true);
      await window.webgazer.clearData();

      if (!webgazerStartedRef.current) {
        webgazerStartedRef.current = true;
        await window.webgazer.begin();
      }

      window.webgazer.showVideoPreview?.(DEBUG_FIRST_MODE);
      window.webgazer.showVideo(DEBUG_FIRST_MODE);
      window.webgazer.showFaceOverlay(DEBUG_FIRST_MODE);
      window.webgazer.showFaceFeedbackBox(true);
      window.webgazer.showPredictionPoints(false);

      setTrackingState("ready");
      setPhase("calibration");
    } catch (error) {
      webgazerStartedRef.current = false;
      setTrackingState("idle");
      setCalibrationError(`Failed to start WebGazer: ${String(error)}`);
    } finally {
      setStartingWebgazer(false);
    }
  }

  // ── Calibration ──────────────────────────────────────────────────────────

  function handleCalClick(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    const dot = calDots[calDotIndex];
    if (!dot) {
      return;
    }

    const next = calClicks + 1;
    if (next >= CAL_CLICKS_NEEDED) {
      const nextDot = calDotIndex + 1;
      if (nextDot >= calDots.length) {
        // All dots done — start collecting
        window.webgazer
          .showVideo(DEBUG_FIRST_MODE)
          .showFaceOverlay(DEBUG_FIRST_MODE)
          .showFaceFeedbackBox(DEBUG_FIRST_MODE)
          .showPredictionPoints(false);
        startCollecting();
      } else {
        setCalDotIndex(nextDot);
        setCalClicks(0);
      }
    } else {
      setCalClicks(next);
    }
  }

  // ── Collection ───────────────────────────────────────────────────────────

  function startCollecting() {
    setFileIndex(0);
    setGazePoints([]);
    gazePointsRef.current = [];
    setMediaLayout(null);
    resetFilterState();
    setPhase("collecting");
  }

  // G key handling
  useEffect(() => {
    if (phase !== "collecting") return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "g" && !e.repeat) {
        setGHeld(true);
        gHeldRef.current = true;
        if (videoRef.current) videoRef.current.play();
      }
      if (e.key === "q" || e.key === "Q") {
        void saveCurrentAndAdvance();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "g") {
        setGHeld(false);
        gHeldRef.current = false;
        if (videoRef.current) videoRef.current.pause();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, fileIndex]);

  // Reset gaze points when file changes
  useEffect(() => {
    if (phase !== "collecting") return;
    gazePointsRef.current = [];
    setGazePoints([]);
    setMediaLayout(null);
    resetFilterState();
    videoFrameIndexRef.current = null;
    videoFpsRef.current = null;
    setGHeld(false);
    gHeldRef.current = false;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [fileIndex, phase]);

  // Track video frame indices directly from the video element.
  useEffect(() => {
    const video = videoRef.current;
    if (phase !== "collecting" || !video) return;

    if (video.requestVideoFrameCallback) {
      const trackFrame = (_now: number, metadata: { mediaTime: number; presentedFrames: number }) => {
        videoFrameIndexRef.current = Math.max(0, metadata.presentedFrames - 1);
        if (metadata.presentedFrames > 0 && metadata.mediaTime > 0) {
          videoFpsRef.current = metadata.presentedFrames / metadata.mediaTime;
        }
        videoFrameCallbackHandleRef.current = video.requestVideoFrameCallback?.(trackFrame) ?? null;
      };

      videoFrameCallbackHandleRef.current = video.requestVideoFrameCallback(trackFrame);

      return () => {
        if (videoFrameCallbackHandleRef.current !== null) {
          video.cancelVideoFrameCallback?.(videoFrameCallbackHandleRef.current);
          videoFrameCallbackHandleRef.current = null;
        }
      };
    }

    const interval = window.setInterval(() => {
      if (gHeldRef.current) {
        videoFrameIndexRef.current = getCurrentVideoFrameIndex();
      }
    }, 16);

    return () => window.clearInterval(interval);
  }, [getCurrentVideoFrameIndex, phase, fileIndex]);

  // Auto-advance when video ends
  useEffect(() => {
    if (phase !== "collecting") return;
    const video = videoRef.current;
    if (!video) return;
    function onEnded() { void saveCurrentAndAdvance(); }
    video.addEventListener("ended", onEnded);
    return () => video.removeEventListener("ended", onEnded);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, fileIndex]);

  async function saveCurrentAndAdvance() {
    const current = files[fileIndex];
    if (!current) return;

    const points = gazePointsRef.current;
    if (points.length > 0) {
      const layout = mediaLayoutRef.current;
      if (!layout) {
        throw new Error("Media layout missing; cannot save gaze data.");
      }

      const t0 = points[0].t;
      const commonData = {
        gaze: points.map((p) => [p.x, p.y]),
        dimensions: [layout.intrinsicW, layout.intrinsicH],
        display_offset: [layout.offsetX, layout.offsetY],
        display_scale: layout.scale,
        source_type: current.type,
      };

      const data = current.type === "video"
        ? {
            ...commonData,
            frame_indices: points.map((p) => p.frame ?? 0),
            fps: videoFpsRef.current,
          }
        : {
            ...commonData,
            timestamps: points.map((p) => (p.t - t0) / 1000),
          };

      const outputPath =
        outputDir + "/" + current.relativePath.replace(/\.[^/.]+$/, "") + ".npz";

      const response = await fetch("/api/collect/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outputPath, sourcePath: current.path, data }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({ error: "Unknown save error" }));
        throw new Error(result.error ?? "Failed to save gaze data");
      }
      setSavedCount((n) => n + 1);
    }

    const next = fileIndex + 1;
    if (next >= files.length) {
      window.webgazer.clearGazeListener();
      setGazePos(null);
      setPhase("done");
    } else {
      setFileIndex(next);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <Script
        src="https://webgazer.cs.brown.edu/webgazer.js"
        strategy="afterInteractive"
        onLoad={() => setWebgazerReady(true)}
      />

      {/* ── Setup ── */}
      {phase === "setup" && (
        <div style={{
          minHeight: "100vh", display: "flex", alignItems: "center",
          justifyContent: "center", background: "var(--paper)",
        }}>
          <div style={{
            width: 480, background: "var(--panel)", borderRadius: "var(--radius)",
            padding: "2.5rem", boxShadow: "var(--shadow-soft)",
            border: "1px solid var(--line)",
          }}>
            <h2 style={{ marginBottom: "0.25rem", fontSize: "1.4rem", fontWeight: 640 }}>
              Gaze Data Collection
            </h2>
            <p style={{ color: "var(--ink-soft)", marginBottom: "2rem", fontSize: "0.9rem" }}>
              WebGazer · follows collect.py pipeline
            </p>

            <div style={{ marginBottom: "1.5rem" }}>
              <div style={{ display: "block", fontSize: "0.85rem", fontWeight: 500,
                color: "var(--ink-soft)", marginBottom: "0.5rem" }}>
                Stimuli directory
              </div>
              <div style={{
                width: "100%", padding: "0.65rem 0.9rem",
                border: "1px solid var(--line-strong)", borderRadius: 8,
                background: "var(--paper)", fontSize: "0.9rem",
                color: "var(--ink)",
              }}>
                <code>{dirPath}</code>
              </div>
              <p style={{ color: "var(--ink-soft)", fontSize: "0.8rem", marginTop: "0.55rem" }}>
                Local-only mode: relative paths resolve from the repository root.
              </p>
            </div>

            {loadError && (
              <p style={{ color: "var(--red)", fontSize: "0.85rem", marginBottom: "1rem" }}>
                {loadError}
              </p>
            )}

            {calibrationError && (
              <p style={{ color: "var(--red)", fontSize: "0.85rem", marginBottom: "1rem" }}>
                {calibrationError}
              </p>
            )}

            {files.length > 0 && (
              <p style={{ color: "var(--green)", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
                Found {files.length} file{files.length !== 1 ? "s" : ""}. Ready to calibrate.
              </p>
            )}

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                onClick={loadFiles}
                style={{
                  flex: 1, padding: "0.7rem", border: "1px solid var(--line-strong)",
                  borderRadius: 8, background: "var(--paper)", fontWeight: 500,
                  fontSize: "0.9rem", color: "var(--ink)",
                }}
              >
                Reload Files
              </button>
              <button
                onClick={startCalibration}
                disabled={files.length === 0 || !webgazerReady || startingWebgazer}
                style={{
                  flex: 1, padding: "0.7rem", border: "none",
                  borderRadius: 8, background: files.length > 0 && webgazerReady && !startingWebgazer
                    ? "var(--blue)" : "var(--line-strong)",
                  color: files.length > 0 && webgazerReady && !startingWebgazer ? "#fff" : "var(--ink-faint)",
                  fontWeight: 500, fontSize: "0.9rem",
                  cursor: files.length > 0 && webgazerReady && !startingWebgazer ? "pointer" : "default",
                }}
              >
                {startingWebgazer
                  ? "Starting camera…"
                  : webgazerReady
                    ? "Start Calibration →"
                    : "Loading WebGazer…"}
              </button>
            </div>

            <p style={{ color: "var(--ink-soft)", fontSize: "0.8rem", marginTop: "1rem" }}>
              Debug-first mode is on: camera, face feedback, prediction points, and live status stay visible.
            </p>
          </div>
        </div>
      )}

      {/* ── Calibration ── */}
      {phase === "calibration" && calDots.length > 0 && (
        <div
          style={{
            position: "fixed", inset: 0, background: "#000",
            cursor: "default",
          }}
        >
          {/* Current dot */}
          <div style={{
            position: "absolute",
            left: calDots[calDotIndex].x,
            top: calDots[calDotIndex].y,
            transform: "translate(-50%, -50%)",
            width: 36, height: 36, borderRadius: "50%",
            background: "#00dc82",
            boxShadow: "0 0 0 4px rgba(0,220,130,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
            zIndex: 3,
          }} onClick={handleCalClick}>
            <div style={{
              width: 10, height: 10, borderRadius: "50%", background: "#fff",
            }} />
          </div>

          {gazePos && (
            <div style={{
              position: "fixed",
              left: gazePos.x,
              top: gazePos.y,
              transform: "translate(-50%, -50%)",
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "rgba(255,50,50,0.72)",
              border: "2px solid rgba(255,255,255,0.75)",
              pointerEvents: "none",
              zIndex: 2,
            }} />
          )}

          {/* Instruction */}
          <div style={{
            position: "absolute", top: 56, right: 20,
            textAlign: "right", color: "#fff",
            maxWidth: 360,
            zIndex: 0,
            pointerEvents: "none",
          }}>
            <p style={{ fontSize: "1rem", marginBottom: 4 }}>
              Click the dot while looking at it
            </p>
            <p style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.5)" }}>
              Dot {calDotIndex + 1} of {calDots.length}
            </p>
          </div>

          <div style={{
            position: "absolute", left: 20, top: 20,
            padding: "0.85rem 1rem", borderRadius: 12,
            background: "rgba(0,0,0,0.72)", color: "#fff",
            minWidth: 280, border: "1px solid rgba(255,255,255,0.12)",
            zIndex: 1,
          }}>
            <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.55)", marginBottom: 6 }}>
              DEBUG-FIRST CALIBRATION
            </div>
            <div style={{ fontSize: "0.95rem", fontWeight: 600, color: getTrackingColor(trackingState) }}>
              {getTrackingLabel(trackingState)}
            </div>
            <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.72)", marginTop: 8, lineHeight: 1.5 }}>
              <div>Raw: {rawGazePos ? `${rawGazePos.x.toFixed(0)}, ${rawGazePos.y.toFixed(0)}` : "none"}</div>
              <div>Smooth: {gazePos ? `${gazePos.x.toFixed(0)}, ${gazePos.y.toFixed(0)}` : "none"}</div>
              <div>Elapsed: {debugElapsedMs !== null ? `${Math.round(debugElapsedMs)} ms` : "n/a"}</div>
              <div>Accepted clicks: {calClicks} / {CAL_CLICKS_NEEDED}</div>
              <div>Quality: {trackingQuality}</div>
              <div>Avg jump: {rollingAvgJumpPx.toFixed(1)} px</div>
              <div>Latest jump: {latestJumpPx.toFixed(1)} px</div>
            </div>
          </div>

          {/* Progress dots */}
          <div style={{
            position: "absolute", top: 20, left: 0, right: 0,
            display: "flex", justifyContent: "center", gap: 8,
            zIndex: 2,
          }}>
            {calDots.map((_, i) => (
              <div key={i} style={{
                width: 8, height: 8, borderRadius: "50%",
                background: i < calDotIndex ? "#00dc82"
                  : i === calDotIndex ? "#fff" : "rgba(255,255,255,0.2)",
              }} />
            ))}
          </div>
        </div>
      )}

      {/* ── Collecting ── */}
      {phase === "collecting" && currentFile && (
        <div style={{ position: "fixed", inset: 0, background: "#000" }}>
          {currentFile.type === "image" ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              ref={imageRef}
              src={fileUrl(currentFile.path)}
              alt=""
              onLoad={(event) => {
                updateMediaLayout(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
              }}
              style={{
                width: "100%", height: "100%", objectFit: "contain",
                display: "block",
              }}
            />
          ) : (
            <video
              ref={videoRef}
              src={fileUrl(currentFile.path)}
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                updateMediaLayout(video.videoWidth, video.videoHeight);
                videoFrameIndexRef.current = 0;
                videoFpsRef.current = null;
              }}
              style={{
                width: "100%", height: "100%", objectFit: "contain",
                display: "block",
              }}
              preload="auto"
            />
          )}

          {/* Gaze dot */}
          {gazePos && (
            <div style={{
              position: "fixed",
              left: gazePos.x,
              top: gazePos.y,
              transform: "translate(-50%, -50%)",
              width: 20, height: 20, borderRadius: "50%",
              background: gHeld ? "rgba(255,50,50,0.7)" : "rgba(255,200,0,0.5)",
              pointerEvents: "none",
              border: "2px solid rgba(255,255,255,0.6)",
            }} />
          )}

          {/* Status bar */}
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0,
            padding: "0.6rem 1.5rem",
            background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            color: "#fff", fontSize: "0.8rem",
          }}>
            <span style={{ color: gHeld ? "#ff5050" : "rgba(255,255,255,0.6)" }}>
              {gHeld ? "● RECORDING" : "Hold G to record"}
            </span>
            <span style={{ color: getTrackingColor(trackingState) }}>
              {getTrackingLabel(trackingState)}
            </span>
            <span style={{ color: "rgba(255,255,255,0.4)" }}>
              Q to skip
            </span>
          </div>

          <div style={{
            position: "fixed", top: 20, left: 20,
            padding: "0.85rem 1rem", borderRadius: 12,
            background: "rgba(0,0,0,0.72)", color: "#fff",
            border: "1px solid rgba(255,255,255,0.12)",
            minWidth: 300,
          }}>
            <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.55)", marginBottom: 6 }}>
              DEBUG-FIRST COLLECTION
            </div>
            <div style={{ fontSize: "0.9rem", fontWeight: 600, color: getTrackingColor(trackingState), marginBottom: 8 }}>
              {getTrackingLabel(trackingState)}
            </div>
            <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.72)", lineHeight: 1.5 }}>
              <div>Raw: {rawGazePos ? `${rawGazePos.x.toFixed(0)}, ${rawGazePos.y.toFixed(0)}` : "none"}</div>
              <div>Smooth: {gazePos ? `${gazePos.x.toFixed(0)}, ${gazePos.y.toFixed(0)}` : "none"}</div>
              <div>Elapsed: {debugElapsedMs !== null ? `${Math.round(debugElapsedMs)} ms` : "n/a"}</div>
              <div>Points: {gazePoints.length}</div>
              <div>Quality: {trackingQuality}</div>
              <div>Avg jump: {rollingAvgJumpPx.toFixed(1)} px</div>
              <div>Latest jump: {latestJumpPx.toFixed(1)} px</div>
              <div>Stable for: {Math.round(stableForMs)} ms</div>
              <div>Accepted / rejected: {acceptedSamples} / {rejectedSamples}</div>
              <div>Training: frozen</div>
              {mediaLayout && (
                <>
                  <div>Media: {mediaLayout.intrinsicW}×{mediaLayout.intrinsicH}</div>
                  <div>Offset: {mediaLayout.offsetX.toFixed(1)}, {mediaLayout.offsetY.toFixed(1)}</div>
                  <div>Scale: {mediaLayout.scale.toFixed(4)}</div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Done ── */}
      {phase === "done" && (
        <div style={{
          minHeight: "100vh", display: "flex", alignItems: "center",
          justifyContent: "center", background: "var(--paper)",
        }}>
          <div style={{
            width: 440, background: "var(--panel)", borderRadius: "var(--radius)",
            padding: "2.5rem", boxShadow: "var(--shadow-soft)",
            border: "1px solid var(--line)", textAlign: "center",
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%",
              background: "var(--green)", margin: "0 auto 1.25rem",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1.5rem",
            }}>✓</div>
            <h2 style={{ marginBottom: "0.5rem", fontSize: "1.3rem" }}>Collection complete</h2>
              <p style={{ color: "var(--ink-soft)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
                Saved {savedCount} file{savedCount !== 1 ? "s" : ""} to{" "}
                <code style={{ fontSize: "0.8rem" }}>{outputDir}</code>
              </p>
            <button
              onClick={() => {
                window.webgazer
                  .showPredictionPoints(false)
                  .showFaceFeedbackBox(false)
                  .showFaceOverlay(false)
                  .showVideo(false);
                window.webgazer.clearGazeListener();
                window.webgazer.end();
                webgazerStartedRef.current = false;
                setGazePos(null);
                setTrackingState("idle");
                setDebugElapsedMs(null);
                setPhase("setup");
                setFiles([]);
                setSavedCount(0);
                void loadFiles();
              }}
              style={{
                padding: "0.65rem 1.5rem", border: "none", borderRadius: 8,
                background: "var(--blue)", color: "#fff",
                fontWeight: 500, fontSize: "0.9rem",
              }}
            >
              Collect again
            </button>
          </div>
        </div>
      )}
    </>
  );
}
