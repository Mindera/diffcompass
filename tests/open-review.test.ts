import { expect, test } from "bun:test";
import { browserCommand, prepareAndOpenReviewPage } from "../src/open-review.ts";

test("builds platform-specific browser commands", () => {
  expect(browserCommand("http://review.test", "darwin")).toEqual(["open", "http://review.test"]);
  expect(browserCommand("http://review.test", "win32")).toEqual(["cmd", "/c", "start", "", "http://review.test"]);
  expect(browserCommand("http://review.test", "linux")).toEqual(["xdg-open", "http://review.test"]);
});

test("opens the review page after automatic preparation fails and reports a retryable error", async () => {
  const opened: string[][] = [];
  const errors: string[] = [];

  await prepareAndOpenReviewPage(Promise.reject(new Error("invalid optional diagram")), "http://review.test", {
    platform: "darwin",
    open: (command) => opened.push(command),
    reportError: (message) => errors.push(message),
  });

  expect(opened).toEqual([["open", "http://review.test"]]);
  expect(errors[0]).toContain("invalid optional diagram");
  expect(errors[1]).toContain("startup error is visible");
});
