import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

async function sourceFiles() {
  return Promise.all([
    readFile(join(root, "public", "app.js"), "utf8"),
    readFile(join(root, "public", "index.html"), "utf8"),
    readFile(join(root, "public", "styles.css"), "utf8"),
    readFile(join(root, "src", "export.ts"), "utf8"),
  ]);
}

test("review navigation exposes discoverable, accessible shortcut help", async () => {
  const [app, html] = await sourceFiles();

  expect(html).toContain('id="shortcuts-button"');
  expect(html).toContain('title="Keyboard shortcuts (?)"');
  expect(html).toContain('<dialog id="shortcut-help-dialog"');
  expect(html).toContain('aria-labelledby="shortcut-help-title"');
  expect(html).toContain('aria-describedby="shortcut-help-description"');
  expect(html).toContain("<kbd>J</kbd>");
  expect(html).toContain("<kbd>K</kbd>");
  expect(html).toContain("<kbd>Z</kbd>");
  expect(html).toContain("<kbd>?</kbd>");
  expect(app).toContain('elements["shortcuts-button"].addEventListener("click", openShortcutHelp)');
  expect(app).toContain('elements["shortcut-help-dialog"].addEventListener("close", restoreShortcutHelpFocus)');
  expect(app).toContain('elements["close-shortcut-help"].focus()');
});

test("J and K share the existing tour navigation behavior and avoid accidental repeats", async () => {
  const [app] = await sourceFiles();

  expect(app).toContain('elements["next-step"].addEventListener("click", () => void handleNextStep())');
  expect(app).toContain('void handleNextStep();');
  expect(app).toContain('void navigate("previous");');
  expect(app).toContain("event.defaultPrevented || event.repeat");
  expect(app).toContain('shortcutTargetIsEditable(event.target)');
  expect(app).toContain('modalDialogIsOpen()');
  expect(app).toContain("event.ctrlKey || event.metaKey || event.altKey");
  expect(app).toContain("if (systemModifier || event.shiftKey) return;");
});

test("shortcut eligibility treats form controls and content-editable regions as typing contexts", async () => {
  const [app] = await sourceFiles();
  const start = app.indexOf("function shortcutTargetIsEditable");
  const end = app.indexOf("function modalDialogIsOpen", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const helper = new Function(`${app.slice(start, end)}; return shortcutTargetIsEditable;`)() as (target: { closest: (selector: string) => unknown }) => boolean;
  const target = (...matches: string[]) => ({ closest: (selector: string) => matches.some((match) => selector.includes(match)) ? {} : null });

  expect(helper(target("textarea"))).toBeTrue();
  expect(helper(target("[contenteditable='true']"))).toBeTrue();
  expect(helper(target("[role='textbox']"))).toBeTrue();
  expect(helper(target())).toBeFalse();
});

test("focus mode widens the diff while retaining an obvious keyboard and button exit", async () => {
  const [app, html, styles] = await sourceFiles();

  expect(html).toContain('id="focus-mode-toggle"');
  expect(html).toContain('aria-pressed="false"');
  expect(app).toContain('document.body.classList.toggle("focus-mode", state.focusMode)');
  expect(app).toContain('button.textContent = state.focusMode ? "Exit focus" : "Focus mode"');
  expect(app).toContain('button.title = state.focusMode ? "Exit focus mode (Z)" : "Enter focus mode (Z)"');
  expect(styles).toContain(".focus-mode .file-panel { display: none; }");
  expect(styles).toContain(".focus-mode .workspace { grid-template-columns: minmax(420px, 1fr) var(--agent-panel-width); }");
  expect(styles).toContain(".focus-mode .questions-pane, .focus-mode .persistent-comment-drawer { display: none; }");
  expect(styles).toContain(".focus-mode .topbar .tabs");
});

test("self-contained HTML export carries the navigation and focus-mode contract", async () => {
  const source = await readFile(join(root, "src", "export.ts"), "utf8");

  expect(source).toContain('id="focus-mode-toggle"');
  expect(source).toContain('id="shortcuts-button"');
  expect(source).toContain('id="shortcut-help-dialog"');
  expect(source).toContain("DOMContentLoaded");
  expect(source).toContain("event.repeat");
  expect(source).toContain("event.ctrlKey||event.metaKey||event.altKey");
  expect(source).toContain("next().click()");
  expect(source).toContain("previous().click()");
  expect(source).toContain("focus-mode");
  expect(source).toContain("exportReview");
});
