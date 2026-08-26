import { expect, test } from "bun:test";
import { browserCommand, prepareAndOpenReviewPage } from "../src/open-review.ts";

test("builds platform-specific browser commands", () => {
  expect(browserCommand("http://review.test", "darwin")).toEqual(["open", "http://review.test"]);
  expect(browserCommand("http://review.test", "win32")).toEqual(["cmd", "/c", "start", "", "http://review.test"]);
  expect(browserCommand("http://review.test", "linux")).toEqual(["xdg-open", "http://review.test"]);
});

test("does not open the review page when automatic preparation has no ready first stop", async () => {
  const opened: string[][] = [];
  const errors: string[] = [];

  const openedReady = await prepareAndOpenReviewPage(Promise.reject(new Error("invalid optional diagram")), "http://review.test", {
    platform: "darwin",
    open: (command) => opened.push(command),
    reportError: (message) => errors.push(message),
  });

  expect(opened).toEqual([]);
  expect(openedReady).toBe(false);
  expect(errors[0]).toContain("invalid optional diagram");
  expect(errors[1]).toContain("first tour stop is not ready");
});

test("opens only after automatic preparation resolves", async () => {
  const opened: string[][] = [];
  let release!: () => void;
  const preparation = new Promise<void>((resolve) => { release = resolve; });
  const opening = prepareAndOpenReviewPage(preparation, "http://review.test", {
    platform: "darwin",
    open: (command) => opened.push(command),
  });

  await Promise.resolve();
  expect(opened).toEqual([]);
  release();
  expect(await opening).toBe(true);
  expect(opened).toEqual([["open", "http://review.test"]]);
});

test("still opens an ordinary diff review when no automatic tour was requested", async () => {
  const opened: string[][] = [];
  expect(await prepareAndOpenReviewPage(undefined, "http://review.test", {
    platform: "darwin",
    open: (command) => opened.push(command),
  })).toBe(true);
  expect(opened).toEqual([["open", "http://review.test"]]);
});
