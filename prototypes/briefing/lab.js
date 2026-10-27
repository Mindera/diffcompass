/* Read-only previews of captured changes using the production outcome-first reader. */
import { createBriefingCodeRenderer, preferredBriefingRenderer } from "/briefing-code.mjs";
(async () => {
  const get = id => document.getElementById(id);
  get("diff-renderer").value = preferredBriefingRenderer();
  get("diff-renderer").addEventListener("change", event => {
    try { localStorage.setItem("diffcompass-diff-renderer", event.target.value); } catch { /* This page still applies the selection. */ }
  });
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const stage = get("lab-stage"), sheet = get("evidence-sheet"), notesDialog = get("notes-dialog");
  const paneResizers = createReadingPaneResizers(stage);
  let current, sheetOwner;
  const evidenceClosedKey = "diffcompass-briefing-evidence-closed";
  try { stage.classList.toggle("lab-evidence-closed", localStorage.getItem(evidenceClosedKey) === "true"); } catch { /* Keep the default layout. */ }
  function setEvidenceClosed(closed) {
    stage.classList.toggle("lab-evidence-closed", closed);
    for (const instance of instances.values()) instance.reader.syncTools();
    try { localStorage.setItem(evidenceClosedKey, String(closed)); } catch { /* Keep the choice for this tab. */ }
  }
  const instances = new Map();
  const notesKey = "diffcompass-reading-experiment-notes-v1";
  let notes = {};
  try { const saved = JSON.parse(localStorage.getItem(notesKey) ?? "{}"); if (saved && typeof saved === "object" && !Array.isArray(saved)) notes = saved; } catch { /* Notes remain usable in memory. */ }
  function restoreEvidence() {
    if (sheetOwner) sheetOwner.workspace.appendChild(sheetOwner.pane);
    sheetOwner = null;
  }
  function closeEvidence() { if (sheet.open) sheet.close(); restoreEvidence(); }
  function openEvidence() {
    if (!matchMedia("(max-width: 900px)").matches) { setEvidenceClosed(false); return; }
    if (sheet.open) return;
    sheetOwner = current;
    current.reader.syncTools();
    sheet.appendChild(sheetOwner.pane); sheet.showModal();
  }
  sheet.addEventListener("close", () => { if (!sheet.open) restoreEvidence(); });
  get("evidence-close").addEventListener("click", closeEvidence);
  get("mobile-evidence").addEventListener("click", openEvidence);
  matchMedia("(max-width: 900px)").addEventListener("change", event => { if (!event.matches) closeEvidence(); });
  try {
    const response = await fetch("/cases.json"); if (!response.ok) throw new Error("Captured changes could not be loaded.");
    const data = await response.json();
    const mapStyle = getComputedStyle(document.documentElement);
    window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: "dark", maxTextSize: 12000, sequence: { useMaxWidth: true, wrap: true },
      themeCSS: `.nodeLabel, .nodeLabel p { font-family: ${mapStyle.getPropertyValue("--map-node-font")}; font-size: ${mapStyle.getPropertyValue("--map-node-title-size")}; font-weight: 600; }`,
    });
    get("case-picker").innerHTML = data.cases.map(c => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join("");
    stage.innerHTML = "";
    function mount(item) {
      const key = `${item.id}/outcome`, workspace = document.createElement("div");
      workspace.id = `lab-${item.id}`; workspace.className = "lab-workspace";
      workspace.setAttribute("role", "region"); workspace.setAttribute("aria-label", item.title);
      workspace.innerHTML = '<aside class="briefing-outline lab-outline"></aside><div class="lab-scroll"><article class="briefing-view"></article></div><aside class="briefing-inspector lab-evidence"></aside><div class="lab-chips" hidden></div>';
      stage.appendChild(workspace);
      paneResizers.mount(workspace);
      const instance = { key, item, workspace, view: workspace.querySelector(".briefing-view"), pane: workspace.querySelector(".lab-evidence"), scroll: workspace.querySelector(".lab-scroll") };
      instance.reader = createBriefingReader({
        createCodeRenderer: createBriefingCodeRenderer,
        outcomeFirst: true,
        view: instance.view, outline: workspace.querySelector(".lab-outline"), pane: instance.pane, chips: workspace.querySelector(".lab-chips"),
        highlight: async groups => groups.map(g => ({ id: g.id, lines: data.highlighted[JSON.stringify([g.path, g.lines])] })),
        tokenHtml: token => `<span style="color:#${esc(token.dark)};${token.fontStyle & 1 ? "font-style:italic;" : ""}${token.fontStyle & 2 ? "font-weight:600;" : ""}">${esc(token.content)}</span>`,
        openTools: openEvidence,
        closeTools: () => {
          if (matchMedia("(max-width: 900px)").matches) closeEvidence();
          else setEvidenceClosed(true);
        },
        toolsCollapsed: () => !matchMedia("(max-width: 900px)").matches && stage.classList.contains("lab-evidence-closed"),
        diagramUrl: async (document, diagram) => {
          const url = `/briefing-diagram/${encodeURIComponent(document.id)}/${encodeURIComponent(diagram.id)}`;
          const response = await fetch(url, { method: 'HEAD' });
          if (!response.ok) throw new Error('Saved diagram viewer unavailable.');
          return url;
        },
      });
      instance.reader.render({ outline: { briefing: item.document }, comparison: { repositoryName: item.repositoryName, branch: item.head.slice(0, 7) } });
      instances.set(key, instance); return instance;
    }
    function show(caseId, updateUrl = true) {
      const item = data.cases.find(c => c.id === caseId) ?? data.cases[0];
      const key = `${item.id}/outcome`;
      if (current?.key === key) return;
      closeEvidence();
      if (current) { current.reader.rememberAnchor(); current.reader.setActive(false); current.workspace.hidden = true; }
      current = instances.get(key) ?? mount(item);
      current.workspace.hidden = false; current.reader.setActive(true);
      get("case-picker").value = item.id;
      const revisions = `${item.base.slice(0, 7)} → ${item.head.slice(0, 7)}`;
      const repositoryUrl = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(item.repositoryUrl ?? "") ? item.repositoryUrl : null;
      const revisionLabel = repositoryUrl
        ? `<a href="${esc(repositoryUrl)}/compare/${esc(item.base)}...${esc(item.head)}" target="_blank" rel="noopener noreferrer">${esc(revisions)} ↗</a>`
        : `<span>${esc(revisions)}</span>`;
      get("case-source").innerHTML = `<span>${esc(item.repositoryName)} · ${item.files} changed files</span>${revisionLabel}`;
      document.title = `${item.title} · Briefing · DiffCompass`;
      if (updateUrl) history.pushState(null, "", `#case=${encodeURIComponent(item.id)}`);
    }
    function showHash() {
      const params = new URLSearchParams(location.hash.slice(1));
      show(params.get("case"), false);
      // Old experiment bookmarks now open the chosen outcome-first view.
      history.replaceState(null, "", `#case=${encodeURIComponent(current.item.id)}`);
    }
    get("case-picker").addEventListener("change", event => show(event.target.value));
    addEventListener("popstate", showHash); addEventListener("hashchange", showHash);
    get("notes-open").addEventListener("click", () => {
      get("notes-title").textContent = current.item.title;
      get("notes-text").value = typeof notes[current.key] === "string" ? notes[current.key] : "";
      get("notes-status").textContent = ""; notesDialog.showModal();
    });
    get("notes-close").addEventListener("click", () => notesDialog.close());
    get("notes-text").addEventListener("input", event => {
      notes[current.key] = event.target.value;
      try { localStorage.setItem(notesKey, JSON.stringify(notes)); get("notes-status").textContent = "Saved locally"; }
      catch { get("notes-status").textContent = "Kept in this tab. Download to save."; }
    });
    get("notes-download").addEventListener("click", () => {
      const report = ["# Briefing reading notes", "", ...data.cases.flatMap(item => [
        `## ${item.title}`, `Repository: ${item.repositoryName}`, `Source: ${item.base} → ${item.head}`, "",
        notes[`${item.id}/outcome`] || "No notes yet.", "",
      ])].join("\n");
      const url = URL.createObjectURL(new Blob([report], { type: "text/markdown" }));
      const link = document.createElement("a"); link.href = url; link.download = "briefing-reading-notes.md"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    showHash();
  } catch (error) { stage.textContent = `Unable to open the briefing: ${error.message}`; console.error(error); }
})();
