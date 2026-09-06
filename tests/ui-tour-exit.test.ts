import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const visibleSource = app.slice(app.indexOf("function filteredChangedFiles()"), app.indexOf("async function ensureTourPhaseDiffs()"));
const reviewLoaderSource = app.slice(app.indexOf("async function ensureReviewDiffs()"), app.indexOf("function captureFileViewport("));

function reviewState() {
  const files = ["one.ts", "two.ts", "three.ts"].map((path) => ({ path, status: "modified" }));
  return {
    session: { revision: 4, reviewedFiles: [], comparison: { diffMode: "file", files } },
    tourMode: false,
    searchQuery: "",
    searchMatches: null,
    statusFilter: "",
    reviewFilter: "",
    testFilesOnly: false,
    diffCache: new Map<string, object>(),
    reviewDiffLoadKey: null as string | null,
    reviewDiffLoadPromise: null as Promise<void> | null,
    reviewDiffLoadGeneration: 0,
  };
}

test("leaving a paged tour renders every cached changed file", () => {
  const state = reviewState();
  for (const file of state.session.comparison.files) state.diffCache.set(file.path, { ...file, hunks: [file.path] });
  const { visibleDiffFiles } = new Function("state", "isTestFile", "currentPhase", `${visibleSource}; return { visibleDiffFiles };`)(
    state,
    () => false,
    () => null,
  ) as { visibleDiffFiles: () => Array<{ path: string }> };

  expect(visibleDiffFiles().map((file) => file.path)).toEqual(["one.ts", "two.ts", "three.ts"]);
});

test("leaving a paged tour fetches missing diffs and restores the complete review", async () => {
  const state = reviewState();
  state.diffCache.set("one.ts", { path: "one.ts", hunks: ["cached"] });
  const requested: string[] = [];
  let rendered: string[] = [];
  const elements = { diff: { innerHTML: "" } };
  const filteredChangedFiles = () => state.session.comparison.files;
  const visibleDiffFiles = () => filteredChangedFiles().map((file) => state.diffCache.get(file.path)).filter(Boolean);
  const ensureReviewDiffs = new Function(
    "state", "elements", "filteredChangedFiles", "visibleDiffFiles", "api", "renderDiff", "renderComments", "renderFindings", "renderTourAnnotation", "toast",
    `${reviewLoaderSource}; return ensureReviewDiffs;`,
  )(
    state,
    elements,
    filteredChangedFiles,
    visibleDiffFiles,
    async (url: string) => {
      const path = new URL(url, "http://review.local").searchParams.get("path")!;
      requested.push(path);
      return { file: { path, hunks: [path] }, context: 3, full: false, offset: 0, limit: 1, totalRows: 1 };
    },
    (files: Array<{ path: string }>) => { rendered = files.map((file) => file.path); },
    () => {},
    () => {},
    () => {},
    () => {},
  ) as () => Promise<void>;

  await ensureReviewDiffs();

  expect(requested).toEqual(["two.ts", "three.ts"]);
  expect(rendered).toEqual(["one.ts", "two.ts", "three.ts"]);
  expect(state.reviewDiffLoadPromise).toBeNull();
});

test("tour exit waits for the paged review before claiming all files are visible", () => {
  const toggle = app.slice(app.indexOf("async function toggleTourMode()"), app.indexOf("async function showAnalysisFile("));
  expect(toggle).toContain("await ensureReviewDiffs();");
  expect(toggle.indexOf("await ensureReviewDiffs();")).toBeLessThan(toggle.indexOf('toast("Tour exited. All changed files are visible.")'));
  expect(app).toContain("files = visibleDiffFiles();");
  expect(app).not.toContain("? visibleDiffFiles() : [file]");
});
