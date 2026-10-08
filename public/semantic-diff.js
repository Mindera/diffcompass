/* A bounded syntax summary layered onto the existing diff, never a second viewer. */
globalThis.DiffCompassSemantic = (() => {
  const opened = new Map();
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const identity = () => JSON.stringify([state.session?.comparison?.base, state.session?.comparison?.head, state.session?.comparison?.mergeBase, state.session?.comparison?.sourceTree, state.session?.comparison?.patch,
    state.session?.outline?.phases.map((phase) => [phase.title, phase.fileChanges, phase.steps.map((step) => [step.title, step.anchor, step.outdated])])]);
  let comparisonIdentity;
  function current() {
    const next = identity();
    if (comparisonIdentity !== next) { opened.clear(); comparisonIdentity = next; }
    return next;
  }
  const panelId = (path) => `syntax-${encodeURIComponent(path)}`;
  function control(file) {
    current();
    if (state.tourMode || state.proposalPreview || !state.session?.comparison?.files.some((entry) => entry.path === file.path)) return "";
    return `<button type="button" class="text-button" data-semantic-file="${esc(file.path)}" aria-expanded="${opened.has(file.path)}" aria-controls="${esc(panelId(file.path))}">What changed</button> · `;
  }
  const summaryHtml = (summary) => semanticPresentation.summaryHtml(summary);
  function hydrate() {
    current();
    for (const section of elements.diff.querySelectorAll(".diff-file")) {
      const path = section.dataset.path;
      const entry = opened.get(path);
      section.querySelector("[data-semantic-panel]")?.remove();
      section.querySelector("[data-semantic-file]")?.setAttribute("aria-expanded", String(Boolean(entry)));
      if (!entry || state.tourMode || state.proposalPreview) continue;
      const panel = document.createElement("section");
      panel.id = panelId(path);
      panel.className = "semantic-summary";
      panel.dataset.semanticPanel = path;
      panel.setAttribute("aria-label", `What changed in ${path}`);
      panel.innerHTML = entry.summary ? summaryHtml(entry.summary) : entry.error ? `<p role="alert">${esc(entry.error)}</p><button type="button" data-semantic-retry="${esc(path)}">Try again</button>` : '<p role="status">Comparing the saved before and after code…</p>';
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
      entry.error = `Couldn’t load the change summary: ${error.message}. Your text diff is still available.`;
    }
    hydrate();
  }
  document.getElementById("diff").addEventListener("click", async (event) => {
    if (state.tourMode || state.proposalPreview) return;
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
    const ask = event.target.closest("[data-semantic-explain]");
    if (ask) {
      const path = ask.dataset.semanticExplain;
      current();
      if (!opened.get(path)?.summary) return;
      openConversation(null);
      if (elements["chat-input"].value.trim()) {
        toast("Your existing question draft is still here. Send or clear it before asking about this file.");
        elements["chat-input"].focus(); return;
      }
      clearSelectedLine();
      state.questionContextPaths.clear();
      state.dryRunQuestionContext = null;
      const file = state.diffCache.get(path);
      const rows = file?.hunks.flatMap((hunk) => hunk.rows) ?? [];
      const row = rows.find((row) => row.kind === "addition") ?? rows.find((row) => row.kind === "deletion") ?? rows.find((row) => row.kind !== "meta");
      if (row) {
        const side = row.newLine !== null ? "new" : "old";
        state.selectedLine = { path, side, line: side === "new" ? row.newLine : row.oldLine, content: row.content };
      }
      elements["chat-input"].value = `Explain what changed in ${JSON.stringify(path)} in this captured comparison: the before/after mechanism, why it matters, and one specific thing to review. Use the saved before and after source; distinguish code evidence from assumptions and runtime guarantees.`;
      renderQuestionScope();
      elements["chat-input"].focus();
      return;
    }
    const button = event.target.closest("[data-semantic-anchor], [data-semantic-explanation-anchor]");
    if (!button) return;
    const path = button.closest("[data-semantic-panel]").dataset.semanticPanel;
    current();
    const summary = opened.get(path)?.summary;
    const change = summary?.changes[Number(button.dataset.semanticAnchor)];
    const indexes = button.dataset.semanticExplanationAnchor?.split(":").map(Number);
    const anchor = indexes ? summary?.explanation?.entries[indexes[0]]?.steps[indexes[1]]?.anchor : button.dataset.semanticSide === "old" ? change?.before : change?.after;
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
