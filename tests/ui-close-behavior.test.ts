import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("mobile approval notices sit below the measured toolbar and wrap inside the viewport", async () => {
  const styles = await readFile(join(import.meta.dir, "..", "public", "styles.css"), "utf8");
  const mobile = styles.slice(styles.indexOf("@media (max-width: 900px)", styles.indexOf("@media (max-width: 1050px)")));
  expect(mobile).toContain(".closed-banner { top: calc(var(--mobile-topbar-height, 100px) + 8px); z-index: 30;");
  expect(mobile).toContain("width: calc(100% - 24px); max-width: 680px;");
  expect(mobile).toContain("overflow: auto; overflow-wrap: anywhere;");
});

async function createCloseHarness() {
  const app = await readFile(join(import.meta.dir, "..", "public", "app.js"), "utf8");
  const start = app.indexOf("function renderClosedBanner()");
  const end = app.indexOf("async function checkForUpdate()", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const closeFunctions = app.slice(start, end);

  const intervals = new Map<number, () => void>();
  let timeout: (() => void) | undefined;
  let closeCalls = 0;
  const state = {
    session: { status: "accepted" },
    closeCountdownTimer: null as number | null,
    closeCountdownSeconds: null as number | null,
    closeCountdownMessage: null as string | null,
  };
  const banner = {
    classList: { toggle: () => undefined },
  };
  const message = { textContent: "" };
  const action = {
    hidden: true,
    classList: {
      add(name: string) { if (name === "hidden") action.hidden = true; },
      toggle(name: string, force: boolean) { if (name === "hidden") action.hidden = force; },
    },
  };
  const windowMock = {
    closed: false,
    setInterval(callback: () => void) { intervals.set(1, callback); return 1; },
    clearInterval(id: number) { intervals.delete(id); },
    setTimeout(callback: () => void) { timeout = callback; return 2; },
    close() { closeCalls += 1; },
  };
  const createHarness = new Function("state", "elements", "window", "reviewIsOpen", `${closeFunctions}; return { renderClosedBanner, cancelCloseCountdown, beginCloseCountdownForTransition };`);
  const harness = createHarness(state, {
    "closed-banner": banner,
    "closed-banner-message": message,
    "cancel-auto-close": action,
  }, windowMock, () => state.session.status === "open") as {
    renderClosedBanner: () => void;
    cancelCloseCountdown: () => void;
    beginCloseCountdownForTransition: (previousStatus: string, result: unknown) => void;
  };
  return {
    action,
    closeCalls: () => closeCalls,
    flushTimeout: () => timeout?.(),
    harness,
    message,
    state,
    tick: () => intervals.get(1)?.(),
  };
}

test("close transitions count down and preserve manual-close guidance when the browser blocks closing", async () => {
  const { closeCalls, flushTimeout, harness, message, state, tick } = await createCloseHarness();

  harness.beginCloseCountdownForTransition("open", { status: "accepted", comments: [] });
  expect(state.closeCountdownSeconds).toBe(5);
  expect(message.textContent).toContain("close in 5 seconds");
  for (let count = 0; count < 5; count += 1) tick();
  expect(closeCalls()).toBe(1);
  flushTimeout();
  expect(state.closeCountdownSeconds).toBeNull();
  expect(message.textContent).toContain("You can close this window.");

  harness.renderClosedBanner();
  expect(message.textContent).toContain("You can close this window.");
  expect(message.textContent).not.toContain("It is now read-only.");
});

test("cancelling auto-close keeps the submitted review open for inspection", async () => {
  const { action, closeCalls, harness, message, state, tick } = await createCloseHarness();

  harness.beginCloseCountdownForTransition("open", { status: "accepted", comments: [] });
  expect(action.hidden).toBeFalse();
  harness.cancelCloseCountdown();
  tick();

  expect(closeCalls()).toBe(0);
  expect(state.session.status).toBe("accepted");
  expect(state.closeCountdownTimer).toBeNull();
  expect(state.closeCountdownSeconds).toBeNull();
  expect(message.textContent).toContain("This review is closed as accepted.");
  expect(message.textContent).toContain("You can close this window.");
  expect(action.hidden).toBeTrue();
});
