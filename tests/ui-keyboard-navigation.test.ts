import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("shortcut eligibility treats form controls and content-editable regions as typing contexts", async () => {
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
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
