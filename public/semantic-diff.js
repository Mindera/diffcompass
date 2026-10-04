/* A bounded syntax summary layered onto the existing diff, never a second viewer. */
globalThis.DiffCompassSemantic = (() => {
  const opened = new Map();
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const identity = () => JSON.stringify([state.session?.comparison?.mergeBase, state.session?.comparison?.sourceTree, state.session?.comparison?.patch]);
  let comparisonIdentity;
  function current() {
    const next = identity();
    if (comparisonIdentity !== next) { opened.clear(); comparisonIdentity = next; }
    return next;
  }
  const panelId = (path) => `syntax-${encodeURIComponent(path)}`;
  function control(file) {
    current();
    if (state.proposalPreview || !state.session?.comparison?.files.some((entry) => entry.path === file.path)) return "";
    return `<button type="button" class="text-button" data-semantic-file="${esc(file.path)}" aria-expanded="${opened.has(file.path)}" aria-controls="${esc(panelId(file.path))}">Syntax changes</button> · `;
  }
  function summaryHtml(summary) {
    const anchor = (value, index) => value ? `<button type="button" class="text-button" data-semantic-anchor="${index}" data-semantic-side="${value.side}">${value.side === "old" ? "Before" : "After"}: ${esc(value.path)}:${value.startLine}</button>` : "";
    return `<p role="status"><strong>${esc(summary.status === "analysed" ? "Parser-backed syntax summary" : summary.status)}</strong> · ${esc(summary.message)}</p>
      <p class="muted">${esc(summary.notice)}</p>
      ${summary.status === "unavailable" ? `<button type="button" data-semantic-retry="${esc(summary.path)}">Retry syntax analysis</button>` : ""}
      ${summary.renamed ? '<p>File renamed. Symbol renames are shown as removed/added declarations.</p>' : ""}
      <ol>${summary.changes.map((change, index) => `<li><strong>${esc(change.name)}</strong> — ${change.categories.map((category) => esc(category === "signature" ? "signature changed" : category === "body" ? "body / initializer changed" : category)).join(", ")} <small>(${esc(change.kind)})</small>${change.ambiguous ? '<p>Ambiguous overload match: these declarations were not paired.</p>' : ""}<p>${anchor(change.before, index)} ${anchor(change.after, index)}</p><pre>${esc(change.before?.signature ?? "")}${change.before && change.after ? "\n→ " : ""}${esc(change.after?.signature ?? "")}</pre></li>`).join("")}</ol>
      <details><summary>Source and parser evidence</summary><p>${esc(summary.engine)} · ${esc(summary.language ?? "unsupported language")} · <a href="/semantic-diff-notices.txt" target="_blank" rel="noopener">Parser licences</a></p><p>Before tree: <code>${esc(summary.beforeTree)}</code><br>After tree: <code>${esc(summary.afterTree ?? "not captured")}</code></p><p>SHA-256 before: <code>${esc(summary.beforeHash ?? "unavailable")}</code><br>SHA-256 after: <code>${esc(summary.afterHash ?? "unavailable")}</code></p></details>
      <p class="muted">Computed on request; not saved in the review. Exports include requested summaries still in the server cache (up to 32 files), labelled with coverage.</p>`;
  }
  function hydrate() {
    current();
    for (const section of elements.diff.querySelectorAll(".diff-file")) {
      const path = section.dataset.path;
      const entry = opened.get(path);
      section.querySelector("[data-semantic-panel]")?.remove();
      section.querySelector("[data-semantic-file]")?.setAttribute("aria-expanded", String(Boolean(entry)));
      if (!entry || state.proposalPreview) continue;
      const panel = document.createElement("section");
      panel.id = panelId(path);
      panel.className = "semantic-summary";
      panel.dataset.semanticPanel = path;
      panel.setAttribute("aria-label", `Syntax changes for ${path}`);
      panel.innerHTML = entry.summary ? summaryHtml(entry.summary) : entry.error ? `<p role="alert">${esc(entry.error)}</p><button type="button" data-semantic-retry="${esc(path)}">Retry syntax analysis</button>` : '<p role="status">Parsing captured before/after source…</p>';
      section.querySelector(".diff-file-scroll")?.prepend(panel);
    }
  }
  async function load(path) {
    const stamp = current();
    if (opened.size >= 32) opened.delete(opened.keys().next().value);
    const entry = {};
    opened.set(path, entry); hydrate();
    try {
      const summary = await api(`/api/diff/semantic?${new URLSearchParams({ path })}`);
      if (stamp !== current() || opened.get(path) !== entry) return;
      entry.summary = summary;
    } catch (error) {
      if (stamp !== current() || opened.get(path) !== entry) return;
      entry.error = `Syntax analysis failed: ${error.message}. The text diff remains available.`;
    }
    hydrate();
  }
  document.getElementById("diff").addEventListener("click", async (event) => {
    const toggle = event.target.closest("[data-semantic-file]");
    if (toggle) {
      const path = toggle.dataset.semanticFile;
      current();
      if (state.collapsedFiles.has(path)) toggle.closest(".diff-file").querySelector("[data-collapse-file]")?.click();
      if (opened.has(path)) { opened.delete(path); hydrate(); } else void load(path);
      return;
    }
    const retry = event.target.closest("[data-semantic-retry]");
    if (retry) { void load(retry.dataset.semanticRetry); return; }
    const button = event.target.closest("[data-semantic-anchor]");
    if (!button) return;
    const path = button.closest("[data-semantic-panel]").dataset.semanticPanel;
    current();
    const summary = opened.get(path)?.summary;
    const change = summary?.changes[Number(button.dataset.semanticAnchor)];
    const anchor = button.dataset.semanticSide === "old" ? change?.before : change?.after;
    if (!anchor) return;
    // Always use the comparison's canonical diff path, including old-side renames.
    const shown = await showChangedFile(path, anchor.startLine, anchor.side, undefined, 200, true);
    if (shown) {
      const row = diffViewRow(path, anchor.side, anchor.startLine);
      if (!row) { toast("This captured source line is not visible in the current diff page."); return; }
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("selected");
      row?.querySelector(".line-action:not(:disabled)")?.focus({ preventScroll: true });
    }
  });
  return { control, hydrate, summaryHtml };
})();
