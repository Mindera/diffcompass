import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("close transitions count down and preserve manual-close guidance when the browser blocks closing", async () => {
  const app = await readFile(join(import.meta.dir, "..", "public", "app.js"), "utf8");
  const start = app.indexOf("function renderClosedBanner()");
  const end = app.indexOf("async function checkForUpdate()", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const closeFunctions = app.slice(start, end);

  let interval: (() => void) | undefined;
  let timeout: (() => void) | undefined;
  let closeCalls = 0;
  const state = {
    session: { status: "accepted" },
    closeCountdownTimer: null as number | null,
    closeCountdownSeconds: null as number | null,
    closeCountdownMessage: null as string | null,
  };
  const banner = {
    textContent: "",
    classList: { toggle: () => undefined },
  };
  const windowMock = {
    closed: false,
    setInterval(callback: () => void) { interval = callback; return 1; },
    clearInterval() {},
    setTimeout(callback: () => void) { timeout = callback; return 2; },
    close() { closeCalls += 1; },
  };
  const createHarness = new Function("state", "elements", "window", "reviewIsOpen", `${closeFunctions}; return { renderClosedBanner, beginCloseCountdownForTransition };`);
  const harness = createHarness(state, { "closed-banner": banner }, windowMock, () => state.session.status === "open") as {
    renderClosedBanner: () => void;
    beginCloseCountdownForTransition: (previousStatus: string, result: unknown) => void;
  };

  harness.beginCloseCountdownForTransition("open", { status: "accepted", comments: [] });
  expect(state.closeCountdownSeconds).toBe(5);
  expect(banner.textContent).toContain("close in 5 seconds");
  for (let tick = 0; tick < 5; tick += 1) interval!();
  expect(closeCalls).toBe(1);
  timeout!();
  expect(state.closeCountdownSeconds).toBeNull();
  expect(banner.textContent).toContain("You can close this window.");

  harness.renderClosedBanner();
  expect(banner.textContent).toContain("You can close this window.");
  expect(banner.textContent).not.toContain("It is now read-only.");
});
