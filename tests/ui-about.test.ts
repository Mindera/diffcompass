import { expect, test } from "bun:test";

const app = await Bun.file(new URL("../public/app.js", import.meta.url)).text();
const html = await Bun.file(new URL("../public/index.html", import.meta.url)).text();
const styles = await Bun.file(new URL("../public/styles.css", import.meta.url)).text();

test("settings exposes an accessible About dialog with runtime review details", () => {
  expect(html).toContain('id="about-button"');
  expect(html).toContain('id="about-dialog"');
  expect(html).toContain('aria-labelledby="about-title"');
  expect(styles).toContain(".about-details");
  expect(app).toContain('const about = await api("/api/about")');
  expect(app).toContain('["Version", about.version]');
  expect(app).toContain('["Repository", about.repository]');
  expect(app).toContain('["Agent", about.agent]');
  expect(app).toContain('elements["about-dialog"].showModal()');
  expect(app).toContain('elements["about-dialog"].close()');
});

test("About values are escaped before insertion", () => {
  expect(app).toContain("<dd>${escapeHtml(value)}</dd>");
  expect(app).toContain("<dd>${escapeHtml(error.message)}</dd>");
});
