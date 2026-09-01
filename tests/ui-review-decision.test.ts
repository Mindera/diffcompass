import { expect, test } from "bun:test";

const app = await Bun.file(new URL("../public/app.js", import.meta.url)).text();

test.each(["request-changes", "approve-with-comments"])("%s submits the modal text as the overall note", (decision) => {
  const source = app.slice(app.indexOf('elements["review-decision-form"].addEventListener'), app.indexOf('elements["refresh-button"].addEventListener'));
  let submit!: (event: { preventDefault(): void }) => void;
  let closed = false;
  let submitted: unknown[] = [];
  new Function("elements", "close", source)({
    "review-decision-form": { addEventListener: (_: string, handler: typeof submit) => { submit = handler; } },
    "review-decision-dialog": { dataset: { decision }, close() { closed = true; } },
    "review-decision-note": { value: "  Preserve selection.\nKeep scroll position.  " },
  }, (...args: unknown[]) => { submitted = args; });
  submit({ preventDefault() {} });
  expect(closed).toBe(true);
  expect(submitted).toEqual([decision === "request-changes" ? "feedback" : "accepted", decision, "Preserve selection.\nKeep scroll position."]);
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
