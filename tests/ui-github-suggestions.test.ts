import { expect, test } from "bun:test";

const app = await Bun.file(new URL("../public/app.js", import.meta.url)).text();
const monaco = await Bun.file(new URL("../public/monaco/app.mjs", import.meta.url)).text();
const escapeHtml = (value: unknown) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

test("Activity distinguishes queueing from local Apply and preserves a return path", () => {
  const source = app.slice(app.indexOf("function renderActivities()"), app.indexOf("function changedImageMedia()"));
  const elements = Object.fromEntries(["activity-empty", "activity-tab-count", "activity-list"].map(id => [id, { classList: { toggle() {} }, textContent: "", innerHTML: "" }]));
  const activity = { id: "draft", source: "reviewer", status: "observed", changeStatus: "pending", request: "Edit file", updatedAt: "2026-01-01", files: [], canQueueGitHubSuggestion: true };
  const state = { session: { pullRequest: {}, activities: [activity] } };
  const render = new Function("state", "elements", "escapeHtml", "reviewIsOpen", `${source}; return renderActivities;`)(state, elements, escapeHtml, () => true);
  render();
  expect(elements["activity-list"]!.innerHTML).toContain(">Apply locally</button>");
  expect(elements["activity-list"]!.innerHTML).toContain('data-activity-action="queue-github">Add to GitHub review');
  expect(elements["activity-list"]!.innerHTML).toContain("publishes only after review confirmation");
  activity.changeStatus = "queued";
  render();
  expect(elements["activity-list"]!.innerHTML).toContain('data-activity-action="return-local">Return to local');
  expect(elements["activity-list"]!.innerHTML).not.toContain('data-activity-action="apply"');
  expect(elements["activity-list"]!.innerHTML).not.toContain('data-activity-action="reject"');
});

test("queue and return buttons only update the local draft API, never publish or apply", async () => {
  const source = app.slice(app.indexOf("async function changeSuggestionPublication("), app.indexOf("function closeInlineCommentEditor()"));
  const state = { busy: false, session: { pullRequest: { headRefOid: "captured-head" } } };
  const requests: any[] = [], notices: string[] = [];
  const action = new Function("state", "reviewIsOpen", "setBusy", "api", "renderSession", "renderSessionUpdate", "toast", `${source}; return changeSuggestionPublication;`)(
    state, () => true, () => {}, async (path: string, init: any) => { requests.push({ path, body: JSON.parse(init.body) }); return state.session; }, () => {}, () => {}, (notice: string) => notices.push(notice),
  );
  await action("a/b", true); await action("a/b", false);
  expect(requests).toEqual([
    { path: "/api/activities/a%2Fb/github", body: { queue: true, headOid: "captured-head" } },
    { path: "/api/activities/a%2Fb/github", body: { queue: false } },
  ]);
  expect(notices[0]).toContain("queued locally");
  expect(notices[1]).toContain("replacement is preserved");
});

test("publication confirmation counts native suggestions and captures the displayed head and selection", () => {
  const source = app.slice(app.indexOf("let pendingGitHubReview = null;"), app.indexOf("async function close("));
  const elements = new Proxy({} as any, { get(target, id) { return target[id] ??= { textContent: "", classList: { toggle() {} }, showModal() {}, focus() {} }; } });
  const state = { session: { pullRequest: { repository: "test/repo", number: 7, headRefOid: "a".repeat(40) }, comments: [
    { id: "native", suggestion: {}, publishToGitHub: true }, { id: "plain", publishToGitHub: true }, { id: "local", publishToGitHub: false },
  ] } };
  const ui = new Function("state", "elements", `${source}; return { open: openGitHubReviewConfirmation, pending: () => pendingGitHubReview };`)(state, elements);
  ui.open("feedback", "request-changes");
  expect(elements["github-review-confirmation-comments"].textContent).toBe("2 selected inline comments, including 1 GitHub suggestion");
  state.session.pullRequest.headRefOid = "b".repeat(40);
  state.session.comments.push({ id: "later", publishToGitHub: true });
  expect(ui.pending()).toMatchObject({ headOid: "a".repeat(40), commentIds: ["native", "plain"] });
});

test("publishing submits the confirmed head and comment selection even after a session update", async () => {
  const source = app.slice(app.indexOf("async function close("), app.indexOf("function requestCloseReview("));
  const state = { session: { comments: [], pullRequest: { headRefOid: "new-head" }, status: "open" } };
  let payload: any;
  const close = new Function("state", "reviewIsOpen", "toast", "openGitHubReviewConfirmation", "api", "beginCloseCountdownForTransition", "renderSession", `${source}; return close;`)(
    state, () => true, () => {}, () => {}, async (_: string, init: any) => { payload = JSON.parse(init.body); return { status: "feedback" }; }, () => {}, () => {},
  );
  await close("feedback", "request-changes", undefined, true, true, { headOid: "confirmed-head", commentIds: ["native"] });
  expect(payload).toMatchObject({ headOid: "confirmed-head", commentIds: ["native"], confirm: true });
});

test("Monaco exposes eligible queue controls separately from Apply and disables unavailable sources", async () => {
  const source = monaco.slice(monaco.indexOf("function drawSuggestions("), monaco.indexOf("function openSuggestedEdit("));
  class Node {
    children: Node[] = []; textContent = ""; disabled = false; dataset = {}; className = ""; isConnected = true;
    onclick?: () => Promise<void>; title = "";
    append(...nodes: Node[]) { this.children.push(...nodes); }
    setAttribute() {}
    all(): Node[] { return [this, ...this.children.flatMap(child => child.all())]; }
  }
  const nodes: Node[] = [], actions: unknown[] = [];
  const activity = { id: "draft", canQueueGitHubSuggestion: true, inlineSuggestions: [{ path: "file.txt", line: 5, endLine: 6, afterLine: 6, replacement: "new", kind: "replace" }] };
  const session = { status: "open", pullRequest: {}, activities: [activity] };
  const render = new Function("production", "session", "selectedFile", "suggestionMatchesSource", "commentsVisible", "document", "button", "host", "suggestedEditLanguage", "monaco", "zone", "commentCards", "markerWidgets", "beforeAnnotations", `${source}; return drawSuggestions;`)(
    true, session, { path: "file.txt" }, () => true, true, { createElement: () => new Node(), activeElement: null },
    (label: string, action: () => Promise<void>) => { const node = new Node(); node.textContent = label; node.onclick = action; return node; },
    { suggestionAction: async (...args: unknown[]) => actions.push(args) }, () => "plaintext",
    { languages: { getLanguages: () => [] }, editor: { colorize: async () => "new" } },
    (_: string, __: number, node: Node) => { nodes.push(node); return { reveal() {} }; }, new Map(), [], { addBadge() {} },
  );
  render({ new: new Set() });
  let controls = nodes[0]!.all();
  expect(controls.find(node => node.textContent === "Apply locally")?.disabled).toBe(false);
  const queue = controls.find(node => node.textContent === "Add to GitHub review")!;
  expect(queue.disabled).toBe(false);
  await queue.onclick!();
  expect(actions).toEqual([["draft", "queue-github"]]);
  activity.canQueueGitHubSuggestion = false; nodes.length = 0;
  render({ new: new Set() }); controls = nodes[0]!.all();
  expect(controls.find(node => node.textContent === "Add to GitHub review")?.disabled).toBe(true);
});

test("queued replacements render as escaped code with deletion wording", () => {
  const source = app.slice(app.indexOf("function suggestionCommentMarkup("), app.indexOf("\n}", app.indexOf("function suggestionCommentMarkup(")) + 2);
  const render = new Function("escapeHtml", `${source}; return suggestionCommentMarkup;`)(escapeHtml);
  expect(render({ suggestion: { replacement: '<script>alert("x")</script>' } })).toContain("&lt;script>");
  expect(render({ suggestion: { replacement: "" } })).toContain("Delete the selected lines");
  expect(render({ suggestion: { replacement: "new" }, githubPublished: true })).toContain("Published in the GitHub review");
});
