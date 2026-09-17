import { expect, test } from "bun:test";

const app = await Bun.file(new URL("../public/app.js", import.meta.url)).text();

test.each(["request-changes", "approve-with-comments"])("%s submits the modal text as the overall note", (decision) => {
  const source = app.slice(app.indexOf('elements["review-decision-form"].addEventListener'), app.indexOf('elements["symbol-peek-open"]?.addEventListener'));
  let submit!: (event: { preventDefault(): void }) => void;
  let closed = false;
  let submitted: unknown[] = [];
  new Function("elements", "close", "updateGitHubReviewConfirmation", source)({
    "review-decision-form": { addEventListener: (_: string, handler: typeof submit) => { submit = handler; } },
    "review-decision-dialog": { dataset: { decision }, close() { closed = true; } },
    "review-decision-note": { value: "  Preserve selection.\nKeep scroll position.  " },
    "cancel-github-review-confirmation": { addEventListener() {} },
    "github-review-confirmation-dialog": { addEventListener() {} },
    "github-review-confirmation-local-only": { addEventListener() {} },
    "github-review-confirmation-form": { addEventListener() {} },
  }, (...args: unknown[]) => { submitted = args; }, () => {});
  submit({ preventDefault() {} });
  expect(closed).toBe(true);
  expect(submitted).toEqual([decision === "request-changes" ? "feedback" : "accepted", decision, "Preserve selection.\nKeep scroll position."]);
});

test("GitHub publication confirmation names the action, pull request revision, and selected comments", () => {
  const source = app.slice(app.indexOf("let pendingGitHubReview = null;"), app.indexOf("async function close("));
  const classStates = new Map<string, boolean>();
  let opened = false;
  let focused = false;
  const elements = {
    "github-review-confirmation-title": { textContent: "" },
    "github-review-confirmation-description": { textContent: "" },
    "github-review-confirmation-action": { textContent: "" },
    "github-review-confirmation-pull-request": { textContent: "" },
    "github-review-confirmation-revision": { textContent: "" },
    "github-review-confirmation-comments": { textContent: "" },
    "github-review-confirmation-local-only-option": { hidden: false },
    "github-review-confirmation-local-only": { checked: false, disabled: false },
    "github-review-confirmation-note": { textContent: "" },
    "submit-github-review-confirmation": {
      textContent: "",
      classList: { toggle: (name: string, enabled: boolean) => classStates.set(name, enabled) },
      focus: () => { focused = true; },
    },
    "github-review-confirmation-dialog": { showModal: () => { opened = true; } },
  };
  const open = new Function("state", "elements", `${source}; return openGitHubReviewConfirmation;`)({
    session: {
      pullRequest: { repository: "acme/widgets", number: 42, headRefOid: "1234567890abcdef" },
      comments: [{ publishToGitHub: true }, { publishToGitHub: false }, { publishToGitHub: true }],
    },
  }, elements) as (outcome: string, decision: string, note?: string) => void;

  open("accepted", "approve");

  expect(elements["github-review-confirmation-title"].textContent).toBe("Approve this pull request?");
  expect(elements["github-review-confirmation-pull-request"].textContent).toBe("acme/widgets#42");
  expect(elements["github-review-confirmation-revision"].textContent).toBe("12345678");
  expect(elements["github-review-confirmation-comments"].textContent).toBe("2 selected inline comments");
  expect(elements["submit-github-review-confirmation"].textContent).toBe("Publish approval");
  expect(elements["github-review-confirmation-local-only-option"].hidden).toBe(false);
  expect(classStates).toEqual(new Map([["danger", false], ["primary", true]]));
  expect(opened).toBe(true);
  expect(focused).toBe(true);
});

test("approval with comments also offers local-only tour approval", () => {
  const source = app.slice(app.indexOf("let pendingGitHubReview = null;"), app.indexOf("async function close("));
  const elements = {
    "github-review-confirmation-title": { textContent: "" },
    "github-review-confirmation-description": { textContent: "" },
    "github-review-confirmation-action": { textContent: "" },
    "github-review-confirmation-pull-request": { textContent: "" },
    "github-review-confirmation-revision": { textContent: "" },
    "github-review-confirmation-comments": { textContent: "" },
    "github-review-confirmation-local-only-option": { hidden: true },
    "github-review-confirmation-local-only": { checked: false, disabled: true },
    "github-review-confirmation-note": { textContent: "" },
    "submit-github-review-confirmation": { textContent: "", classList: { toggle() {} }, focus() {} },
    "github-review-confirmation-dialog": { showModal() {} },
  };
  const open = new Function("state", "elements", `${source}; return openGitHubReviewConfirmation;`)({
    session: { pullRequest: { repository: "acme/widgets", number: 42, headRefOid: "1234567890abcdef" }, comments: [] },
  }, elements) as (outcome: string, decision: string, note?: string) => void;

  open("accepted", "approve-with-comments", "Looks good.");

  expect(elements["github-review-confirmation-local-only-option"].hidden).toBe(false);
  expect(elements["github-review-confirmation-local-only"].disabled).toBe(false);
});

test("approval confirmation can close the tour without publishing a GitHub review", () => {
  const source = app.slice(app.indexOf('elements["cancel-github-review-confirmation"].addEventListener'), app.indexOf('elements["symbol-peek-open"]?.addEventListener'));
  let submit!: (event: { preventDefault(): void }) => void;
  let closeArgs: unknown[] = [];
  let dialogClosed = false;
  new Function("elements", "close", "updateGitHubReviewConfirmation", `let pendingGitHubReview = { outcome: "accepted", decision: "approve" }; ${source}`)({
    "cancel-github-review-confirmation": { addEventListener() {} },
    "github-review-confirmation-dialog": { addEventListener() {}, close: () => { dialogClosed = true; } },
    "github-review-confirmation-local-only": { checked: true, addEventListener() {} },
    "github-review-confirmation-form": { addEventListener: (_: string, handler: typeof submit) => { submit = handler; } },
  }, (...args: unknown[]) => { closeArgs = args; }, () => {});

  submit({ preventDefault() {} });

  expect(dialogClosed).toBe(true);
  expect(closeArgs).toEqual(["accepted", "approve", undefined, true, false]);
});

test("feedback confirmation counts the overall note alongside inline comments", () => {
  const source = app.slice(app.indexOf("function beginCloseCountdownForTransition("), app.indexOf("async function checkForUpdate("));
  let message = "";
  const begin = new Function("state", "beginCloseCountdown", `${source}; return beginCloseCountdownForTransition;`)(
    { session: { status: "feedback" }, closeCountdownMessage: null },
    (value: string) => { message = value; },
  );
  begin("open", { comments: [], note: "Please fix this." });
  expect(message).toBe("1 feedback item(s) submitted.");
  begin("open", { comments: [{ body: "Inline feedback" }], note: "Please fix this." });
  expect(message).toBe("2 feedback item(s) submitted.");
  begin("open", { comments: [{ body: "Inline feedback" }] });
  expect(message).toBe("1 feedback item(s) submitted.");
});

test("close review requires confirmation and closes without a decision", () => {
  const source = app.slice(app.indexOf("function requestCloseReview()"), app.indexOf("function openReviewDecision("));
  const outcomes: unknown[][] = [];
  let confirmed = false;
  const requestCloseReview = new Function("reviewIsOpen", "window", "close", `${source}; return requestCloseReview;`)(
    () => true,
    { confirm: () => confirmed },
    (...args: unknown[]) => { outcomes.push(args); },
  );
  requestCloseReview();
  expect(outcomes).toEqual([]);
  confirmed = true;
  requestCloseReview();
  expect(outcomes).toEqual([["cancelled", "cancel"]]);
});

test("cancelled reviews use neutral closed-state language", () => {
  const source = app.slice(app.indexOf("function beginCloseCountdownForTransition("), app.indexOf("async function checkForUpdate("));
  let message = "";
  const begin = new Function("state", "beginCloseCountdown", `${source}; return beginCloseCountdownForTransition;`)(
    { session: { status: "cancelled" }, closeCountdownMessage: null },
    (value: string) => { message = value; },
  );
  begin("open", {});
  expect(message).toBe("This review was closed without a decision.");
});
