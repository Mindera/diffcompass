import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const helpers = app.slice(app.indexOf("function diffLayoutPreferenceKey("), app.indexOf("const FILE_PANEL_MIN"));

function preferences(mobile: boolean, saved: Record<string, string> = {}, serverDefault = "split") {
  const storage = new Map(Object.entries(saved));
  const window = { localStorage: { getItem: (key: string) => storage.get(key) ?? null } };
  const state = { session: { preferences: { diffLayout: serverDefault } } };
  return new Function("window", "state", "narrowFilePanelLayout", "preferenceKey", `${helpers}; return { preferredDiffLayout, diffLayoutPreferenceKey };`)(window, state, () => mobile, (key: string) => key);
}

test("mobile starts unified regardless of desktop or server split preference", () => {
  expect(preferences(true).preferredDiffLayout()).toBe("unified");
  expect(preferences(true, { "diff-layout": "split" }).preferredDiffLayout()).toBe("unified");
  expect(preferences(true, { "mobile-diff-layout": "invalid" }).preferredDiffLayout()).toBe("unified");
});

test("explicit layouts persist independently for mobile and desktop", () => {
  expect(preferences(true, { "mobile-diff-layout": "split" }).preferredDiffLayout()).toBe("split");
  expect(preferences(false, { "mobile-diff-layout": "unified" }).preferredDiffLayout()).toBe("split");
  expect(preferences(false, { "diff-layout": "unified" }).preferredDiffLayout()).toBe("unified");
  expect(preferences(false, {}, "unified").preferredDiffLayout()).toBe("unified");
  expect(preferences(true).diffLayoutPreferenceKey()).toBe("mobile-diff-layout");
  expect(preferences(false).diffLayoutPreferenceKey()).toBe("diff-layout");
  expect(app).toContain('window.localStorage.setItem(diffLayoutPreferenceKey(), state.diffLayout)');
});

test("mobile layout gives paths their own wrapping row and leaves code at its normal size", () => {
  expect(styles).toContain(".diff-file-title { min-width: 0; overflow-wrap: anywhere;");
  expect(styles).toContain('grid-template-areas: "status actions" "path path"');
  expect(styles).toContain(".diff-file-header > .file-stats { grid-area: actions; min-width: 0; text-align: right;");
  expect(styles).toContain(".mobile-file-status { display: none; }");
  expect(styles).toContain(".diff-file-toggle .status { display: none; }");
  expect(styles).toContain(".diff-file-toggle .collapse-caret { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); }");
  expect(styles).toContain(".diff-file.collapsed .collapse-caret { transform: translateY(-50%) rotate(-90deg); }");
  expect(app).toContain('class="status mobile-file-status"');
  expect(styles).toContain("height: calc(var(--mobile-viewport-height, 100dvh) - var(--mobile-topbar-height, 100px))");
  expect(styles).toContain("grid-template-columns: 34px 18px max-content minmax(max-content, 1fr)");
  expect(styles).toContain(".tab { flex: 0 0 auto; min-height: 44px;");
  expect(styles).toContain(".settings-menu { position: static; }");
  expect(styles).toContain("html, body { scroll-padding-top: var(--mobile-topbar-height, 100px); }");
  expect(html).toContain('aria-controls="review-options"');
  expect(app).toContain('if (!reviewActions.contains(event.target)) setReviewActionsOpen(false)');
});

test("inline forms and line actions fit the visible mobile code pane", () => {
  expect(styles).toContain(".diff-file-scroll { container-type: inline-size; }");
  expect(styles).toContain(".inline-edit-form, .inline-comment-form { position: sticky; left: 4px; width: calc(100cqw - 8px)");
  expect(styles).toContain(".code-selection-toolbar button { min-height: 38px;");
  expect(styles).toContain(".inline-edit-form textarea, .inline-edit-highlight { min-width: 0; min-height: 84px; font-size: 16px;");
  expect(styles).toContain(".inline-edit-form footer .button, .inline-comment-form footer .button { min-height: 44px;");
  expect(app.match(/revealInlineForm\(form\);/g)?.length).toBe(2);
});

test("visible viewport height follows keyboard resizing but not pinch zoom", () => {
  const source = app.slice(app.indexOf("function updateMobileViewportHeight("), app.indexOf('window.visualViewport?.addEventListener'));
  const values: string[] = [];
  const viewport = { height: 390, scale: 1 };
  const update = new Function("window", "document", `${source}; return updateMobileViewportHeight;`)({ visualViewport: viewport }, { documentElement: { style: { setProperty: (_key: string, value: string) => values.push(value) } } });
  update();
  viewport.height = 844;
  update();
  viewport.scale = 2;
  update();
  expect(values).toEqual(["390px", "844px"]);
});
