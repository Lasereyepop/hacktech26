import assert from "node:assert/strict";
import {
  normalizeTextStyleRuns,
  splitTextIntoStyledSegments,
  toggleTextStyleRun,
} from "../lib/text-style-runs.ts";

let runs = toggleTextStyleRun({
  runs: [],
  textLength: 11,
  selection: { start: 0, end: 5 },
  style: { fontWeight: "bold" },
});
assert.deepEqual(runs, [{ start: 0, end: 5, fontWeight: "bold" }]);

runs = toggleTextStyleRun({
  runs,
  textLength: 11,
  selection: { start: 6, end: 11 },
  style: { fontStyle: "italic" },
});
assert.deepEqual(runs, [
  { start: 0, end: 5, fontWeight: "bold" },
  { start: 6, end: 11, fontStyle: "italic" },
]);

runs = toggleTextStyleRun({
  runs,
  textLength: 11,
  selection: { start: 0, end: 5 },
  style: { fontWeight: "bold" },
});
assert.deepEqual(runs, [{ start: 6, end: 11, fontStyle: "italic" }]);

const mergedRuns = normalizeTextStyleRuns(
  [
    { start: 0, end: 2, fontWeight: "bold" },
    { start: 2, end: 5, fontWeight: "bold" },
    { start: 20, end: 30, fontStyle: "italic" },
  ],
  8,
);
assert.deepEqual(mergedRuns, [{ start: 0, end: 5, fontWeight: "bold" }]);

const segments = splitTextIntoStyledSegments("Hello world", [
  { start: 0, end: 5, fontWeight: "bold" },
  { start: 6, end: 11, fontStyle: "italic" },
]);
assert.deepEqual(segments, [
  { text: "Hello", fontWeight: "bold" },
  { text: " " },
  { text: "world", fontStyle: "italic" },
]);

console.log("text style run checks passed");
