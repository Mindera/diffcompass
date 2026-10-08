import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const helper = app.slice(app.indexOf("function confirmActivityAction("), app.indexOf("async function performActivityAction("));
function harness(fixture = false) {
  class Dialog extends EventTarget {
    open = false;
    returnValue = "";
    showModal() { this.open = true; }
    close(value = this.returnValue) { this.returnValue = value; this.open = false; this.dispatchEvent(new Event("close")); }
  }
  const dialog = new Dialog(), elements = new Map<string, any>([["activity-confirmation-dialog", dialog]]);
  const getElementById = (id: string) => {
    if (!elements.has(id)) elements.set(id, { textContent: "", innerHTML: "", classList: { toggle() {} } });
    return elements.get(id);
  };
  const confirm = new Function("document", "state", "escapeHtml", `${helper}; return confirmActivityAction;`)(
    { getElementById }, { session: { fixtureCanApplySuggestions: fixture } },
    (text: string) => text.replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
  ) as (activity: any, action: string) => Promise<boolean>;
  return { confirm, dialog, getElementById };
}

test("themed change confirmations describe writes and resolve only on explicit confirmation", async () => {
  const h = harness();
  const activity = { files: [{ path: "src/<test>.ts" }] };
  const pending = h.confirm(activity, "apply");
  expect(h.dialog.open).toBe(true);
  expect(h.getElementById("activity-confirmation-title").textContent).toBe("Apply this suggested change?");
  expect(h.getElementById("activity-confirmation-description").textContent).toContain("writes the proposed code");
  expect(h.getElementById("activity-confirmation-files").innerHTML).toContain("src/&lt;test&gt;.ts");
  expect(h.getElementById("activity-confirmation-scope").textContent).toContain("Nothing is committed");
  expect(await h.confirm(activity, "reject")).toBe(false); // One modal at a time.
  h.dialog.close("confirm"); expect(await pending).toBe(true);
  const reopened = h.confirm(activity, "undo");
  expect(h.dialog.returnValue).toBe(""); // Escape must not reuse the prior confirmation.
  expect(h.getElementById("activity-confirmation-description").textContent).toContain("later edits overlap");
  h.dialog.close(); expect(await reopened).toBe(false);
});

test("fixture confirmation names its disposable scope and Cancel leaves the proposal alone", async () => {
  const h = harness(true);
  const pending = h.confirm({ files: [{ path: "src/cart.ts" }] }, "reject");
  expect(h.getElementById("activity-confirmation-description").textContent).toContain("your files will not change");
  expect(h.getElementById("activity-confirmation-scope").textContent).toContain("disposable test repository");
  expect(h.getElementById("confirm-activity-action").textContent).toBe("Reject change");
  h.dialog.close("cancel"); expect(await pending).toBe(false);
});
