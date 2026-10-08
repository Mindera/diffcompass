import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const source = app.slice(app.indexOf("async function navigate(direction)"), app.indexOf("async function toggleTourMode()"));

test("tour navigation stays busy until the destination has finished mounting and scrolling", async () => {
  const state = { tourMode: true, busy: false, navigationDirection: null as string | null, navigationGeneration: 0,
    session: {}, diffCache: new Map(), monacoRenderer: { hasDraft: () => false, cancelPhase() {} } };
  let release!: () => void, started!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const focusing = new Promise<void>(resolve => { started = resolve; });
  const errors: string[] = [];
  const navigate = new Function("state", "reviewIsOpen", "setBusy", "api", "preparePhaseNavigation", "renderSessionUpdate", "ensureTourPhaseDiffs", "focusCurrentStep", "renderTour", "toast", `${source}; return navigate;`)(
    state, () => true, (value: boolean) => { state.busy = value; }, async () => ({}), async () => [], () => {}, async () => {},
    async () => { started(); await held; }, () => {}, (error: string) => errors.push(error),
  ) as (direction: string) => Promise<void>;
  const pending = navigate("next");
  await focusing;
  expect(state.busy).toBe(true);
  expect(state.navigationDirection).toBe("next");
  const generation = state.navigationGeneration;
  await navigate("next");
  expect(state.navigationGeneration).toBe(generation);
  release(); await pending;
  expect(state.busy).toBe(false);
  expect(state.navigationDirection).toBeNull();
  expect(errors).toEqual([]);
});
