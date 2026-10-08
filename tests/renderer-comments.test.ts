import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const controller = await readFile(new URL("../public/monaco-controller.mjs", import.meta.url), "utf8");
const controls = controller.slice(controller.indexOf("  function commentControls()"), controller.indexOf("  function updateHeader("));
function harness({ draft = false, visible = true, storageFails = false } = {}) {
  const classes = new Map(), attributes = new Map(), stored = new Map();
  const comments = { textContent: "", disabled: false, title: "", setAttribute: (key: string, value: string) => attributes.set(key, value) };
  const calls: boolean[] = [];
  let childVisible = visible, viewportUpdates = 0;
  const entries = new Map([["cart.ts", { child: {
    commentVisibilityState: () => ({ visible: childVisible }),
    setCommentsVisible: (value: boolean) => { calls.push(value); childVisible = value; },
  } }], ["not-mounted.ts", { child: undefined }]]);
  const setVisible = new Function("container", "comments", "entries", "hasDraft", "actions", "localStorage", "initial", `
    let commentsVisible = initial;
    const commentPreference = "diffcompass-monaco-inline-comments";
    ${controls}
    return setCommentsVisible;
  `)(
    { classList: { toggle: (name: string, value: boolean) => classes.set(name, value) } }, comments, entries,
    () => draft, { viewportChanged: () => viewportUpdates++ },
    { setItem: (key: string, value: string) => { if (storageFails) throw Error("Unavailable"); stored.set(key, value); } }, visible,
  ) as (visible: boolean) => boolean;
  return { setVisible, classes, attributes, stored, comments, calls, viewportUpdates: () => viewportUpdates };
}

test("shared comments toggle controls native cards and mounted Monaco editors without a diff re-render", () => {
  const h = harness();
  expect(h.setVisible(false)).toBe(true);
  expect(h.classes.get("comments-hidden")).toBe(true);
  expect(h.comments.textContent).toBe("Show comments");
  expect(h.attributes.get("aria-pressed")).toBe("false");
  expect(h.stored.get("diffcompass-monaco-inline-comments")).toBe("hidden");
  expect(h.calls).toEqual([false]);
  h.setVisible(false);
  expect(h.calls).toEqual([false]);
  h.setVisible(true);
  expect(h.classes.get("comments-hidden")).toBe(false);
  expect(h.comments.textContent).toBe("Hide comments");
  expect(h.attributes.get("aria-pressed")).toBe("true");
  expect(h.calls).toEqual([false, true]);
  expect(h.viewportUpdates()).toBe(3);
});

test("a Monaco draft cannot be hidden and does not lose shared visibility", () => {
  const h = harness({ draft: true });
  expect(h.setVisible(false)).toBe(false);
  expect(h.calls).toEqual([]);
  expect(h.classes.size).toBe(0);
  expect(h.stored.size).toBe(0);
  expect(h.viewportUpdates()).toBe(0);
  expect(h.setVisible(true)).toBe(true);
  expect(h.comments.disabled).toBe(true);
});

test("comment visibility still works when browser storage is unavailable", () => {
  const h = harness({ storageFails: true });
  expect(h.setVisible(false)).toBe(true);
  expect(h.classes.get("comments-hidden")).toBe(true);
  expect(h.calls).toEqual([false]);
});
