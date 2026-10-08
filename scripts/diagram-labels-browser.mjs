// Isolated browser regression: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
// Optional CAPTION_EXPORT_HTML checks an actual offline HTML export too.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = process.env.CAPTION_ARTIFACTS || "/tmp/diffcompass-caption-browser";
await mkdir(artifacts, { recursive: true });
const source = await readFile(root + "tests/fixtures/modal-caption-map.mmd", "utf8");
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const errors = [];
// Check measured SVG geometry after placement; don't trust the solver's score.
const measure = (svg) => {
  const inverse = svg.getScreenCTM().inverse();
  const matrix = (e) => inverse.multiply(e.getScreenCTM());
  const point = (p, m) => { const q = new DOMPoint(p.x, p.y).matrixTransform(m); return { x: q.x, y: q.y }; };
  const bounds = (points) => { const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y)); return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y }; };
  const rectangle = (e) => { const b = e.getBBox(), m = matrix(e); return bounds([{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x, y: b.y + b.height }, { x: b.x + b.width, y: b.y + b.height }].map(p => point(p, m))); };
  const labels = [...svg.querySelectorAll("g.edgeLabel")].flatMap(e => { const id = e.querySelector("g.label[data-id]")?.dataset.id; return id ? [{ id, text: e.textContent.trim(), box: rectangle(e.querySelector("[data-caption-mask]") || e) }] : []; });
  const nodes = [...svg.querySelectorAll("g.node")].map(rectangle);
  const paths = [...svg.querySelectorAll("path.flowchart-link[data-id]")].map(e => { const n = Math.max(1, Math.ceil(e.getTotalLength() / 2)), m = matrix(e); return { id: e.dataset.id, rerouted: e.dataset.captionRerouted === "true", points: Array.from({ length: n + 1 }, (_, i) => point(e.getPointAtLength(e.getTotalLength() * i / n), m)) }; });
  const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const collisions = [];
  for (const label of labels) {
    for (const other of labels) if (other !== label && intersects(label.box, other.box)) collisions.push([label.id, other.id]);
    for (const node of nodes) if (intersects(label.box, node)) collisions.push([label.id, "node"]);
    for (const path of paths) if (path.id !== label.id && path.points.some((p, i) => i && window.ReviewDiagramLabels.segmentHits(path.points[i - 1], p, label.box))) collisions.push([label.id, path.id]);
  }
  return { collisions, paths: paths.map(({ id, rerouted }) => ({ id, rerouted })), labels: labels.map(({ id, text, box }) => ({ id, text, box })), nodes };
};
const pass = (label) => console.log(`PASS ${label}`);
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on("pageerror", e => errors.push(e.message));
  await page.setContent('<html data-theme="dark"><body><div id="diagram" class="architecture-diagram architecture-node-skin"></div></body></html>');
  await page.addStyleTag({ content: await readFile(root + "public/styles.css", "utf8") });
  await page.addStyleTag({ content: await readFile(root + "public/map-nodes.css", "utf8") });
  await page.addStyleTag({ content: 'body{display:block;overflow:auto}#diagram{width:1450px;height:900px}#diagram>svg{width:100%;height:100%;max-width:none}' });
  await page.addScriptTag({ path: root + "node_modules/mermaid/dist/mermaid.min.js" });
  await page.addScriptTag({ path: root + "public/diagram-labels.js" });
  for (const [theme, hidden] of [["dark", false], ["light", false], ["dark", true]]) {
    const result = await page.evaluate(async ({ source, theme, hidden }) => {
      document.documentElement.dataset.theme = theme;
      const target = document.getElementById("diagram"), style = getComputedStyle(document.documentElement);
      target.style.display = hidden ? "none" : "block";
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: theme === "light" ? "default" : "dark", themeCSS: `.nodeLabel, .nodeLabel p { font-family:${style.getPropertyValue("--map-node-font")}; font-size:${style.getPropertyValue("--map-node-title-size")}; font-weight:600; }`, deterministicIds: true, deterministicIDSeed: "caption-regression" });
      const { svg: markup } = await mermaid.render(`caption-${theme}-${hidden}`, source);
      target.innerHTML = markup;
      const before = [...target.querySelectorAll("g.node")].map(e => e.getAttribute("transform"));
      const start = performance.now();
      const svg = ReviewDiagramLabels.mount(target, markup);
      const elapsed = performance.now() - start;
      target.style.display = "block";
      return { before, after: [...svg.querySelectorAll("g.node")].map(e => e.getAttribute("transform")), elapsed, ready: svg.dataset.captionLayout };
    }, { source, theme, hidden });
    assert.deepEqual(result.before, result.after, "node positions are preserved");
    assert.equal(result.ready, "true");
    const layout = await page.locator("#diagram svg").evaluate(measure);
    assert.deepEqual(layout.collisions, [], `${theme}, hidden=${hidden}`);
    assert.equal(layout.paths.length, 9); assert.equal(layout.labels.length, 9);
    assert.deepEqual(layout.paths.filter(p => p.rerouted).map(p => p.id), ["L_component4_component3_2"]);
    assert(layout.labels.some(p => p.text.includes("reads entries and transitions from")));
    assert(layout.labels.some(p => p.text.includes("releases entries through")));
    pass(`${theme}, initially hidden=${hidden}: all nine captions clear, both relationships kept, nodes unchanged (${Math.round(result.elapsed)}ms)`);
    if (!hidden && theme === "dark") await page.screenshot({ path: `${artifacts}/modal-dark.png` });
    if (!hidden && theme === "light") await page.screenshot({ path: `${artifacts}/modal-light.png` });
    for (const scale of [0.55, 2.5]) {
      await page.locator("#diagram svg").evaluate((e, scale) => { e.style.transformOrigin = "0 0"; e.style.transform = `translate(41px,23px) scale(${scale})`; }, scale);
      assert.deepEqual((await page.locator("#diagram svg").evaluate(measure)).collisions, []);
    }
    pass(`${theme}, initially hidden=${hidden}: caption clearance survives pan/zoom`);
  }
  await page.evaluate(async () => {
    const { svg } = await mermaid.render("unaffected-sequence", "sequenceDiagram\n  A->>B: Existing message");
    ReviewDiagramLabels.mount(document.getElementById("diagram"), svg);
  });
  assert.equal(await page.locator("#diagram svg").getAttribute("data-caption-layout"), null);
  pass("sequence diagram geometry bypasses the flowchart caption pass");
  if (process.env.CAPTION_NATIVE_URL) {
    const live = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    live.on("pageerror", e => errors.push(e.message));
    await live.goto(process.env.CAPTION_NATIVE_URL, { waitUntil: "networkidle" });
    await live.locator('#tour-intro-return').click();
    const diagram = live.locator('[data-tour-intro-architecture-diagram="behavior"] svg');
    await diagram.waitFor({ state: "visible" });
    assert.deepEqual((await diagram.evaluate(measure)).collisions, []);
    const expand = live.locator('#tour-intro-architecture [data-diagram-expand="behavior"]');
    await expand.focus(); await live.keyboard.press("Enter");
    const viewer = live.locator('#architecture-viewer-diagram svg');
    await viewer.waitFor({ state: "visible" });
    const layout = await viewer.evaluate(measure);
    assert.deepEqual(layout.collisions, []);
    assert.equal(layout.paths.length, 9);
    await live.locator('#architecture-viewer-controls [data-diagram-action="zoom-in"]').click();
    assert.deepEqual((await viewer.evaluate(measure)).collisions, []);
    await live.screenshot({ path: `${artifacts}/modal-native-viewer.png` });
    pass("compiled native app briefing, keyboard-opened expanded viewer and zoom all retain clear captions");
  }
  if (process.env.CAPTION_EXPORT_HTML) {
    const exported = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    exported.on("pageerror", e => errors.push(e.message));
    let network = 0;
    await exported.route(/^https?:/, route => { network++; return route.abort(); });
    await exported.goto(pathToFileURL(process.env.CAPTION_EXPORT_HTML).href, { waitUntil: "networkidle" });
    await exported.waitForFunction(() => [...document.querySelectorAll("svg[data-caption-layout]")].some(e => e.textContent.includes("releases entries through")));
    const diagram = exported.locator("svg[data-caption-layout]").filter({ hasText: "releases entries through" }).first();
    await exported.locator("details.architecture > summary").click();
    const layout = await diagram.evaluate(measure);
    assert.deepEqual(layout.collisions, []);
    assert.equal(layout.paths.length, 9); assert.equal(layout.labels.length, 9);
    assert.equal(network, 0);
    await exported.screenshot({ path: `${artifacts}/modal-export.png` });
    pass("actual HTML export measures a hidden diagram, preserves both relationships, and needs no network");
  }
  assert.deepEqual(errors, []);
  pass("no browser runtime errors");
} finally { await browser.close(); }
