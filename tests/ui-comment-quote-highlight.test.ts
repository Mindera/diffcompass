import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const app = await readFile(join(import.meta.dir, "..", "public", "app.js"), "utf8");
const source = app.slice(app.indexOf("async function highlightCommentQuotes()"), app.indexOf("function commentLocation(comment)"));

test("selected comment quotations request syntax tokens by their anchored file and retain every line", async () => {
  const quote = {
    dataset: { commentQuotePath: "src/cart.ts" },
    textContent: "const total = subtotal(items);\r\nreturn total;",
    isConnected: true,
    innerHTML: "",
  };
  const requests: Array<{ path: string; body: { groups: Array<{ id: string; path: string; lines: string[] }>; theme: string } }> = [];
  const highlightCommentQuotes = new Function("state", "document", "api", "syntaxTokenHtml", `${source}; return highlightCommentQuotes;`)(
    { commentQuoteHighlightRequestId: 0, syntaxTheme: "review-tour" },
    { querySelectorAll: () => [quote] },
    async (path: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      requests.push({ path, body });
      return {
        groups: body.groups.map((group: { id: string; path: string; lines: string[] }) => ({
          id: group.id,
          lines: group.lines.map((line) => [{ content: line, light: "111111", dark: "eeeeee", fontStyle: 0 }]),
        })),
      };
    },
    (token: { content: string }) => `<token>${token.content}</token>`,
  ) as () => Promise<void>;

  await highlightCommentQuotes();

  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    path: "/api/highlight",
    body: { theme: "review-tour", groups: [{ path: "src/cart.ts", lines: ["const total = subtotal(items);", "return total;"] }] },
  });
  expect(quote.innerHTML).toBe("<token>const total = subtotal(items);</token>\n<token>return total;</token>");
});
