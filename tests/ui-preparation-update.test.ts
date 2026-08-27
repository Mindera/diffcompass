import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const app = await readFile(join(import.meta.dir, "..", "public", "app.js"), "utf8");
const helpers = app.slice(app.indexOf("function isInPlaceSessionUpdate("), app.indexOf("function renderSession()"));
const poll = app.slice(app.indexOf("window.setInterval(async () => {"), app.indexOf("window.setInterval(checkForUpdate"));

function snapshot(mode = "file") {
  return {
    revision: 4, status: "open", tourState: "active", currentStepIndex: 0,
    comparison: { diffMode: mode, files: [{ path: "cart.ts", hunks: [] }], head: "abc" },
    outline: { phases: [{ id: "p1", title: "Cart", steps: [
      { id: "s1", anchor: { path: "cart.ts", startLine: 10, endLine: 14 }, explanation: "Current explanation" },
      { id: "s2", anchor: { path: "cart.ts", startLine: 20, endLine: 24 }, explanation: "" },
    ] }] },
    messages: [] as object[], comments: [] as object[], reviewedFiles: [] as string[],
    agentActivity: { id: "a1", kind: "tour.explanation" },
  };
}

function harness(previous = snapshot()) {
  let next = structuredClone(previous);
  let tick: () => Promise<void>;
  let renders = 0;
  let explanationWrites = 0;
  let renderedExplanation = "";
  let commentRenders = 0;
  let tourRenders = 0;
  let focusCalls = 0;
  let editorClosed = false;
  let anchorPosition = 2000;
  let commentHeightChange = 0;
  const diffNode = { scrollTop: 1700, innerHTML: "Loaded expanded diff and comments", getBoundingClientRect: () => ({ top: 0 }) };
  const anchor = { getBoundingClientRect: () => ({ top: anchorPosition - diffNode.scrollTop, bottom: anchorPosition - diffNode.scrollTop + 20 }) };
  const tourScroll = { scrollTop: 430 };
  const cachedFile = { path: "cart.ts", _full: true, hunks: ["expanded"] };
  const state = {
    session: previous, diffCacheRevision: previous.revision,
    diffCache: new Map([["cart.ts", cachedFile]]), pollInFlight: false,
    pollGeneration: 0, expectedAgentActivity: null,
    activeTab: "diff", proposalPreview: false,
  };
  const elements = {
    "connection-banner": { classList: { add() {}, remove() {} } },
    "diff-panel": diffNode,
    diff: { querySelectorAll: () => [anchor] },
    "feedback-button": { classList: { toggle() {} } },
    "tour-scroll": tourScroll,
    "step-explanation": { set innerHTML(value: string) {
      explanationWrites += 1;
      renderedExplanation = value;
      tourScroll.scrollTop = 0; // Simulate a DOM replacement losing scroll.
    } },
  };
  const commentActions = app.slice(app.indexOf("async function saveInlineComment("), app.indexOf("async function askAgent("));
  const run = new Function("state", "elements", "window", "api", "reviewIsOpen", "currentStep", "renderMarkdown", "renderAgentActivity", "renderSession", "beginCloseCountdownForTransition", "renderComments", "closeInlineCommentEditor", "toast", "renderFindings", "renderTour", "focusCurrentStep", `${helpers}\n${commentActions}\n${poll}\nreturn { classify: isInPlaceSessionUpdate, classifyNavigation: isSamePhaseNavigationUpdate, saveInlineComment, deleteReviewComment };`);
  const actions = run(state, elements, { setInterval(fn: () => Promise<void>) { tick = fn; } },
    async () => structuredClone(next), () => state.session.status === "open",
    () => state.session.outline.phases.flatMap((phase) => phase.steps)[state.session.currentStepIndex],
    (text: string) => `<p>${text}</p>`, () => {},
    () => { renders += 1; diffNode.scrollTop = 0; state.diffCache.clear(); }, () => {},
    () => { commentRenders += 1; anchorPosition += commentHeightChange; }, () => { editorClosed = true; }, () => {},
    () => {}, () => { tourRenders += 1; }, () => { focusCalls += 1; }) as {
      classify: (a: unknown, b: unknown) => boolean;
      classifyNavigation: (a: unknown, b: unknown) => boolean;
      saveInlineComment: (form: unknown) => Promise<void>;
      deleteReviewComment: (comment: unknown) => Promise<void>;
    };
  return {
    state, diffNode, tourScroll, cachedFile, ...actions,
    respondWith(value: typeof next) { next = value; },
    changeCommentHeight(value: number) { commentHeightChange = value; },
    get anchorTop() { return anchor.getBoundingClientRect().top; },
    async poll(value: typeof next) { next = value; await tick!(); },
    get commentRenders() { return commentRenders; },
    get editorClosed() { return editorClosed; },
    get renders() { return renders; },
    get tourRenders() { return tourRenders; },
    get focusCalls() { return focusCalls; },
    get explanationWrites() { return explanationWrites; },
    get renderedExplanation() { return renderedExplanation; },
  };
}

for (const mode of ["full", "file"]) {
  test(`background preparation keeps ${mode} diff DOM, scroll, and expanded cache intact`, async () => {
    const h = harness(snapshot(mode));
    for (let revision = 5; revision <= 7; revision += 1) {
      const next = structuredClone(h.state.session);
      next.revision = revision;
      next.outline.phases[0]!.steps[1]!.explanation = `Prepared explanation ${revision}`;
      next.agentActivity.id = `a${revision}`;
      await h.poll(next);
      expect(h.state.session.revision).toBe(revision);
      expect(h.state.diffCacheRevision).toBe(revision);
      expect(h.state.diffCache.get("cart.ts")).toBe(h.cachedFile);
      expect(h.diffNode.scrollTop).toBe(1700);
      expect(h.diffNode.innerHTML).toBe("Loaded expanded diff and comments");
      expect(h.tourScroll.scrollTop).toBe(430);
      expect(h.renders).toBe(0);
      expect(h.explanationWrites).toBe(0);
    }
  });
}

test("the current explanation appears immediately without moving either pane", async () => {
  const previous = snapshot();
  previous.outline.phases[0]!.steps[0]!.explanation = "";
  const h = harness(previous);
  const next = structuredClone(previous);
  next.revision += 1;
  next.outline.phases[0]!.steps[0]!.explanation = "Ready now";
  await h.poll(next);
  expect(h.renderedExplanation).toBe("<p>Ready now</p>");
  expect(h.tourScroll.scrollTop).toBe(430);
  expect(h.diffNode.scrollTop).toBe(1700);
  expect(h.renders).toBe(0);
});

test("structural updates, answers, and terminal state still render normally", async () => {
  const mutations = [
    (s: ReturnType<typeof snapshot>) => { s.comparison.head = "def"; },
    (s: ReturnType<typeof snapshot>) => { s.outline.phases[0]!.steps[0]!.anchor.startLine = 11; },
    (s: ReturnType<typeof snapshot>) => { s.outline.phases[0]!.title = "New route"; },
    (s: ReturnType<typeof snapshot>) => { s.messages.push({ role: "agent", content: "Answer" }); },
    (s: ReturnType<typeof snapshot>) => { s.reviewedFiles.push("cart.ts"); },
    (s: ReturnType<typeof snapshot>) => { s.status = "accepted"; },
  ];
  for (const mutate of mutations) {
    const h = harness();
    const next = structuredClone(h.state.session);
    next.revision += 1;
    mutate(next);
    await h.poll(next);
    expect(h.renders).toBe(1);
  }
  const h = harness();
  expect(h.classify(null, snapshot())).toBe(false);
  expect(h.classify({ ...snapshot(), outline: null }, snapshot())).toBe(false);
});

test("same-phase navigation keeps the diff mounted and focuses the new stop directly", async () => {
  const h = harness();
  const next = structuredClone(h.state.session);
  next.revision += 1;
  next.currentStepIndex = 1;
  await h.poll(next);
  expect(h.classifyNavigation(snapshot(), next)).toBe(true);
  expect(h.renders).toBe(0);
  expect(h.diffNode.scrollTop).toBe(1700);
  expect(h.diffNode.innerHTML).toBe("Loaded expanded diff and comments");
  expect(h.tourRenders).toBe(1);
  expect(h.focusCalls).toBe(1);
});

test("adding, editing, and deleting inline comments never rebuilds the diff", async () => {
  const h = harness();
  const form = { elements: { body: { value: "Feedback" } }, dataset: { commentPath: "cart.ts", commentSide: "new", commentLine: "10", commentId: "" }, querySelector: () => ({ disabled: false }) };
  const next = structuredClone(h.state.session);
  next.comments = [{ id: "c1", body: "Feedback" }];
  next.revision += 1;
  h.respondWith(next);
  await h.saveInlineComment(form);
  expect(h.editorClosed).toBe(true);
  form.dataset.commentId = "c1";
  next.comments = [{ id: "c1", body: "Edited feedback" }];
  next.revision += 1;
  h.respondWith(next);
  await h.saveInlineComment(form);
  next.comments = [];
  next.revision += 1;
  h.respondWith(next);
  await h.deleteReviewComment({ id: "c1" });
  expect(h.commentRenders).toBe(3);
  expect(h.renders).toBe(0);
  expect(h.state.diffCache.get("cart.ts")).toBe(h.cachedFile);
  expect(h.state.diffCacheRevision).toBe(next.revision);
  expect(h.diffNode.scrollTop).toBe(1700);
  expect(h.tourScroll.scrollTop).toBe(430);
});

test("comments received by polling update in place too", async () => {
  const h = harness();
  const next = structuredClone(h.state.session);
  next.comments = [{ id: "c1", body: "Feedback" }];
  next.revision += 1;
  await h.poll(next);
  expect(h.commentRenders).toBe(1);
  expect(h.editorClosed).toBe(false);
  expect(h.renders).toBe(0);
  expect(h.diffNode.scrollTop).toBe(1700);
});

test("a resized comment above the viewport retains the visible code line", async () => {
  const h = harness();
  const top = h.anchorTop;
  h.changeCommentHeight(-120);
  const next = structuredClone(h.state.session);
  next.comments = [{ id: "c1", body: "Shortened comment" }];
  next.revision += 1;
  await h.poll(next);
  expect(h.anchorTop).toBe(top);
  expect(h.diffNode.scrollTop).toBe(1580);
  expect(h.renders).toBe(0);
});

test("metadata updates never validate an already stale diff cache", async () => {
  const h = harness();
  h.state.diffCacheRevision = 1;
  const next = structuredClone(h.state.session);
  next.revision += 1;
  next.outline.phases[0]!.steps[1]!.explanation = "Ready";
  await h.poll(next);
  expect(h.state.diffCacheRevision).toBe(1);
});

test("preparation preserves other tabs and an open proposal preview", async () => {
  const h = harness();
  h.state.activeTab = "sequence";
  h.state.proposalPreview = true;
  const next = structuredClone(h.state.session);
  next.revision += 1;
  next.outline.phases[0]!.steps[1]!.explanation = "Ready";
  await h.poll(next);
  expect(h.state.activeTab).toBe("sequence");
  expect(h.state.proposalPreview).toBe(true);
  expect(h.renders).toBe(0);
});
