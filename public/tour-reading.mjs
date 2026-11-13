import { createBriefingCodeRenderer } from "./briefing-code.mjs";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const labels = { decision: "Decision", upkeep: "Upkeep", limitation: "Limitation", divergence: "Divergence", "test-gap": "Test evidence gap" };
const anchorLabel = a => `${a.path}:${a.startLine}–${a.endLine} · ${a.side === "old" ? "Before" : "After"}`;

export function tourRowsHtml(rows, layout, tokens, tokenHtml = esc) {
  const content = i => tokens?.[i] ? tokens[i].map(token => tokenHtml(token)).join("") : esc(rows[i].content);
  const cell = (i, side) => {
    if (i === undefined) return '<span class="briefing-split-empty" aria-hidden="true"></span>';
    const row = rows[i];
    if (row.kind === "meta") return `<span class="briefing-diff-note">${esc(row.content)}</span>`;
    const numbers = side ? [row[side === "old" ? "oldLine" : "newLine"]] : [row.oldLine, row.newLine];
    return `<span class="briefing-code-line briefing-${esc(row.kind)}">${numbers.map(n => `<span class="briefing-diff-number">${n ?? ""}</span>`).join("")}<span class="briefing-diff-sign">${row.kind === "addition" ? "+" : row.kind === "deletion" ? "−" : " "}</span><span class="briefing-line-content">${content(i)}</span></span>`;
  };
  if (layout !== "split") return rows.map((_, i) => cell(i)).join("");
  const pairs = [];
  for (let i = 0; i < rows.length;) {
    if (["context", "meta"].includes(rows[i].kind)) { pairs.push([i, i]); i++; continue; }
    const old = [], next = [];
    while (i < rows.length && !["context", "meta"].includes(rows[i].kind)) (rows[i].kind === "deletion" ? old : next).push(i++);
    for (let n = 0; n < Math.max(old.length, next.length); n++) pairs.push([old[n], next[n]]);
  }
  return `<span class="briefing-split-columns" style="--briefing-row-count:${pairs.length}">${["old", "new"].map((side, i) => `<span class="briefing-diff-column" data-diff-side="${side}" aria-label="${side === "old" ? "Before" : "After"} code">${pairs.map(pair => cell(pair[i], side)).join("")}</span>`).join("")}</span>`;
}

export function createTourReading(options) {
  const el = id => document.getElementById(id);
  const root = el("tour-code-view"), groups = el("tour-code-groups"), renderer = createBriefingCodeRenderer();
  let snapshot, step, mode = false, request = 0, key = "", data, tokens = {}, renderKey = "", contentKey = "", coverageKey = "";
  const view = () => options.view();
  const active = () => mode && view().tourMode && view().activeTab === "diff";
  function closeCode() { mode = false; sync(); }
  function sync() {
    const shown = active();
    root.classList.toggle("hidden", !shown);
    el("diff").classList.toggle("tour-code-hidden", shown);
    el("tour-step-code").setAttribute("aria-pressed", String(shown));
    el("tour-step-code").textContent = shown ? "Showing step code" : "Read this step’s code";
    el("tour-step-code").disabled = !view().tourMode;
    if (shown) el("empty-diff").classList.add("hidden");
    renderer.setActive(shown); renderer.setView(view());
    if (shown) void load();
  }
  function paint() {
    const { layout, wrap } = view();
    const nextKey = JSON.stringify([data, layout, wrap, tokens]);
    if (nextKey === renderKey) return;
    renderKey = nextKey;
    renderer.clear(groups);
    root.dataset.codeLayout = layout; root.dataset.codeWrap = wrap;
    root.classList.toggle("briefing-wrap", wrap === "wrap");
    el("tour-code-title").textContent = step.title;
    el("tour-code-status").textContent = data.freshness === "outdated"
      ? "This stop’s code changed or could not be matched uniquely. Its explanation is out of date. Open the current file to inspect it."
      : data.freshness === "unverified" ? "This saved tour has no content fingerprints. These ranges use its original line numbers; freshness cannot be verified."
      : "Related code for this stop. Open a full file to explore or leave line comments.";
    groups.innerHTML = data.groups.map((g, i) => `<article class="briefing-source tour-code-group" data-evidence-id="${esc(g.id)}"><header><button type="button" class="text-button" data-tour-code-file="${i}">${esc(g.path)}</button><span>${esc(anchorLabel(g.anchor).slice(g.path.length + 1))}</span><button type="button" class="button secondary" data-tour-code-file="${i}">Open full file</button></header><pre class="briefing-diff">${tourRowsHtml(g.rows, layout, tokens[g.id], options.tokenHtml)}</pre>${g.limited ? '<p class="muted">Excerpt limited for readability. Open the full file for all context.</p>' : ""}</article>`).join("");
    if (!data.groups.length) groups.innerHTML = `<button class="button secondary" type="button" data-tour-code-current>Open current file</button>`;
    if (data.limited) groups.insertAdjacentHTML("beforeend", '<p class="muted">Some related code exceeds the excerpt limit. Use the source links in this stop to inspect every range.</p>');
    renderer.sync(groups, data.groups.map(g => ({ id: g.id, path: g.path, diff: { available: true, rows: g.rows } })));
  }
  async function load() {
    if (!step) return;
    const nextKey = JSON.stringify([step.id, step.anchor, step.relatedAnchors, step.freshness, step.evidence, snapshot.comparison.sourceTree, snapshot.comparison.mergeBase, view().syntaxTheme]);
    if (key === nextKey) { if (data) paint(); return; }
    key = nextKey; data = null; tokens = {}; renderKey = "";
    const serial = ++request;
    renderer.clear(groups); groups.textContent = "Loading related code…";
    el("tour-code-title").textContent = step.title; el("tour-code-status").textContent = "";
    try {
      const result = await options.api(`/api/tour/code?stepId=${encodeURIComponent(step.id)}`);
      if (serial !== request) return;
      data = result; paint();
      try {
        const highlighted = await options.highlight(data.groups.map(g => ({ id: g.id, path: g.path, lines: g.rows.map(r => r.content) })));
        if (serial !== request) return;
        tokens = Object.fromEntries(highlighted.map(g => [g.id, g.lines])); paint();
      } catch { /* Plain escaped code remains available if highlighting fails. */ }
    } catch (error) {
      if (serial !== request) return;
      key = ""; groups.textContent = error.message;
    }
  }
  function render(session, current) {
    snapshot = session; step = current;
    if (!step) { closeCode(); return; }
    const nextContent = JSON.stringify([step.id, step.explanation, step.explanationDetail, step.notes, step.freshness, step.importance, step.relatedAnchors]);
    if (contentKey !== nextContent) {
      contentKey = nextContent;
      el("step-importance").textContent = ({ key: "Key stop", normal: "Normal stop", context: "Supporting context" })[step.importance ?? "normal"];
      const freshness = el("step-freshness");
      freshness.textContent = step.freshness === "outdated" ? "Out of date — code changed, disappeared, or could not be matched uniquely. Recheck this explanation against the current source."
        : step.freshness === "unverified" ? "Saved tour: content freshness is unverified." : "";
      freshness.classList.toggle("hidden", !freshness.textContent);
      const detail = el("step-detail");
      if (detail.dataset.step !== step.id) { detail.open = false; el("tour-coverage").open = false; }
      detail.dataset.step = step.id; detail.classList.toggle("hidden", !step.explanationDetail);
      el("step-detail-body").innerHTML = options.markdown(step.explanationDetail ?? "");
      el("step-related").innerHTML = (step.relatedAnchors ?? []).map((a, i) => `<button type="button" class="text-button" data-tour-related="${i}">${esc(anchorLabel(a))}</button>`).join("");
      el("step-notes").innerHTML = (step.notes ?? []).map(note => `<section class="tour-reading-note"><strong>${esc(labels[note.kind] ?? "Note")}${note.outdated ? " · Out of date" : ""}</strong>${options.markdown(note.text)}${note.scope ? `<p><strong>Inspected scope:</strong> ${esc(note.scope)}</p>` : ""}<details><summary>Source evidence${note.outdated ? " (saved)" : ""}</summary>${note.sources.map(source => `<p class="anchor">${esc(anchorLabel(source.anchor))}</p><pre>${esc(source.quote)}</pre>`).join("")}</details></section>`).join("");
    }
    const coverage = session.tourCoverage;
    el("tour-coverage").classList.toggle("hidden", !coverage);
    if (coverage && coverageKey !== JSON.stringify(coverage)) {
      coverageKey = JSON.stringify(coverage);
      el("tour-coverage-count").textContent = String(coverage.total - coverage.covered);
      el("tour-coverage-summary").textContent = `${coverage.covered} of ${coverage.total} changed blocks fully covered by current tour anchors. ${coverage.partial} partly covered.${coverage.unverifiedSteps ? ` ${coverage.unverifiedSteps} saved stops have unverified freshness.` : ""} Coverage describes the tour, not whether you have reviewed a file.`;
      el("tour-coverage-list").innerHTML = coverage.uncovered.map((block, i) => `<li><button class="text-button" type="button" data-tour-uncovered="${i}">${esc(block.path)}${block.anchor ? `:${block.anchor.startLine}–${block.anchor.endLine}` : ""}</button><p>${esc(block.reason)}</p></li>`).join("") || "<li>Every changed block is covered by a current tour anchor.</li>";
      if (coverage.omitted) el("tour-coverage-list").insertAdjacentHTML("beforeend", `<li>${coverage.omitted} more blocks. Exit the tour to browse all changed files.</li>`);
    }
    sync();
  }
  async function open(anchor) {
    if (!anchor || !options.canOpen()) return;
    closeCode(); await options.openFile(anchor);
  }
  el("tour-step-code").addEventListener("click", () => {
    if (!options.canOpen()) return;
    mode = !active(); sync(); if (active()) options.scrollTop();
  });
  el("tour-code-close").addEventListener("click", () => { closeCode(); options.returnToDiff(); });
  groups.addEventListener("click", event => {
    const target = event.target.closest("[data-tour-code-file], [data-tour-code-current]");
    if (target) void open(target.hasAttribute("data-tour-code-current") ? step.anchor : data.groups[Number(target.dataset.tourCodeFile)]?.anchor);
  });
  el("step-related").addEventListener("click", event => {
    const target = event.target.closest("[data-tour-related]");
    if (target) void open(step.relatedAnchors[Number(target.dataset.tourRelated)]);
  });
  el("tour-coverage-list").addEventListener("click", event => {
    const target = event.target.closest("[data-tour-uncovered]");
    const block = target && snapshot.tourCoverage.uncovered[Number(target.dataset.tourUncovered)];
    if (block) void open(block.anchor ?? { path: block.path });
  });
  return { render, sync, active, closeCode, showCode() { mode = true; sync(); options.scrollTop(); } };
}
