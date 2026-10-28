import { installSyntaxThemes } from "./themes.mjs";
import { syntaxThemes } from "./theme-data.mjs";

const id = new URLSearchParams(location.search).get("id");
const host = parent !== window && parent.location.origin === location.origin ? parent.diffCompassBriefingCodeHost?.forFrame(id, window) : null;
const models = [], editors = [];
let disposed = false, resize, paint;
function dispose() {
  disposed = true; resize?.disconnect(); cancelAnimationFrame(paint);
  for (const editor of editors) editor.dispose();
  for (const model of models) model.dispose();
}

async function start() {
  if (!host) return;
  const payload = host.payload();
  window.require.config({ paths: { vs: "/vendor/vs" } });
  await new Promise((resolve, reject) => window.require(["vs/editor/editor.main"], resolve, reject));
  if (disposed) return;
  const monaco = window.monaco;
  const applyTheme = installSyntaxThemes(monaco, syntaxThemes, document.documentElement);
  applyTheme(payload.theme.syntax, payload.theme.light);
  const language = monaco.languages.getLanguages().find(item => item.extensions?.some(extension => payload.path.endsWith(extension)) || item.filenames?.includes(payload.path.split("/").at(-1)))?.id || "plaintext";
  const root = document.getElementById("excerpts");
  let currentView = payload.view;
  function viewOptions() {
    const wrap = currentView.wrap === "wrap" ? "on" : "off";
    return { renderSideBySide: currentView.layout === "split", wordWrap: wrap, diffWordWrap: wrap };
  }
  let rows = [];
  function layout() {
    cancelAnimationFrame(paint);
    paint = requestAnimationFrame(() => {
      if (disposed) return;
      for (const editor of editors) {
        const height = Math.max(32, editor.getModifiedEditor().getContentHeight(), editor.getOriginalEditor().getContentHeight());
        editor.getContainerDomNode().style.height = `${height}px`;
        editor.layout({ width: root.clientWidth, height });
      }
      host.height(root.getBoundingClientRect().height);
    });
  }
  function segment() {
    if (!rows.length) return;
    const before = rows.filter(row => row.kind !== "addition"), after = rows.filter(row => row.kind !== "deletion");
    const numberWidth = Math.max(3, ...rows.flatMap(row => [String(row.oldLine ?? "").length + 1, String(row.newLine ?? "").length + 1]));
    const container = document.createElement("div"); container.className = "excerpt-editor";
    container.style.height = `${Math.max(1, rows.length) * 20 + 16}px`; root.append(container);
    const index = editors.length;
    const original = monaco.editor.createModel(before.map(row => row.content).join("\n"), language, monaco.Uri.parse(`inmemory://briefing/${id}/${index}/before`));
    const modified = monaco.editor.createModel(after.map(row => row.content).join("\n"), language, monaco.Uri.parse(`inmemory://briefing/${id}/${index}/after`));
    models.push(original, modified);
    const editor = monaco.editor.createDiffEditor(container, {
      readOnly: true, domReadOnly: true, editContext: false, originalEditable: false, ...viewOptions(),
      ignoreTrimWhitespace: false, useInlineViewWhenSpaceIsLimited: false, renderSideBySideInlineBreakpoint: 0,
      originalAriaLabel: "Before source", modifiedAriaLabel: "After source",
      fontSize: 12, lineHeight: 20, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      minimap: { enabled: false }, renderOverviewRuler: false, overviewRulerLanes: 0,
      scrollBeyondLastLine: false, folding: false,
      glyphMargin: false, lineDecorationsWidth: 24, lineNumbersMinChars: numberWidth, renderLineHighlight: "none",
      hideUnchangedRegions: { enabled: false }, renderIndicators: true, renderMarginRevertIcon: false,
      scrollbar: { vertical: "hidden", horizontal: "auto", alwaysConsumeMouseWheel: false },
      contextmenu: false, padding: { top: 8, bottom: 8 }, automaticLayout: false,
    });
    editor.getOriginalEditor().updateOptions({ lineNumbers: line => String(before[line - 1]?.oldLine ?? "") });
    editor.getModifiedEditor().updateOptions({ lineNumbers: line => String(after[line - 1]?.newLine ?? "") });
    editor.setModel({ original, modified });
    editor.onDidUpdateDiff(layout);
    editor.getModifiedEditor().onDidContentSizeChange(layout);
    editor.getOriginalEditor().onDidContentSizeChange(layout);
    editors.push(editor); rows = [];
  }
  for (const row of payload.rows) {
    if (row.kind !== "meta") { rows.push(row); continue; }
    segment();
    const gap = document.createElement("div"); gap.className = "excerpt-gap"; gap.textContent = row.content; root.append(gap);
  }
  segment();
  resize = new ResizeObserver(layout); resize.observe(root);
  host.ready({ dispose, theme(value) { applyTheme(value.syntax, value.light); }, view(value) {
    if (value.layout === currentView.layout && value.wrap === currentView.wrap) return;
    currentView = value;
    for (const editor of editors) editor.updateOptions(viewOptions());
    layout();
  } });
  layout();
}
start().catch(() => { dispose(); host?.failed(); });
window.addEventListener("pagehide", dispose, { once: true });
