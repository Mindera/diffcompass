import { expect, test } from "bun:test";
import { monacoAsset } from "../src/monaco-assets";
// @ts-expect-error Shared browser module.
import { menuOffset } from "../public/monaco/context-menu.mjs";

test("a menu moves above a source card's shrinking lower edge", () => {
  expect(menuOffset({ left: 200, top: 480, width: 250, height: 240 }, { left: 4, top: 4, right: 900, bottom: 550 })).toEqual({ x: 0, y: -170 });
});

test("menus stay inside the visible frame below sticky chrome", () => {
  const bounds = { left: 4, top: 300, right: 700, bottom: 900 };
  expect(menuOffset({ left: 600, top: 200, width: 250, height: 240 }, bounds)).toEqual({ x: -150, y: 100 });
  expect(menuOffset({ left: 100, top: 400, width: 250, height: 240 }, bounds)).toEqual({ x: 0, y: 0 });
});

test("the menu viewport adapter is embedded in packaged releases", async () => {
  expect((await monacoAsset("/monaco/context-menu.mjs"))?.body).toContain("installContextMenuViewport");
});
