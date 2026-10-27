/* A read-only comparison harness. Production rendering and source inspection
   stay shared; all experimental composition lives in this directory. */
(async () => {
  const get = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const stage = get("lab-stage"), sheet = get("evidence-sheet"), notesDialog = get("notes-dialog");
  const paneResizers = createReadingPaneResizers(stage);
  let current, sheetOwner;
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
    if (!matchMedia("(max-width: 900px)").matches || sheet.open) return;
    sheetOwner = current;
    sheet.appendChild(sheetOwner.pane); sheet.showModal();
  }
  sheet.addEventListener("close", () => { if (!sheet.open) restoreEvidence(); });
  get("evidence-close").addEventListener("click", closeEvidence);
  get("mobile-evidence").addEventListener("click", openEvidence);
  matchMedia("(max-width: 900px)").addEventListener("change", event => { if (!event.matches) closeEvidence(); });
  function inspectSource(instance, evidenceId) {
    instance.reader.inspectEvidence(evidenceId);
  }
  function scenarioPanel(instance, item) {
    const panel = document.createElement("section"); panel.className = "lab-scenario";
    panel.setAttribute("aria-label", "Explore a scenario");
    panel.innerHTML = '<header><h2>Follow a scenario</h2><small>Illustrative path · grounded in captured code</small></header><div class="lab-routes" aria-label="Scenario"></div><div class="lab-route-body" aria-live="polite"></div>';
    const routes = panel.querySelector(".lab-routes"), body = panel.querySelector(".lab-route-body");
    routes.innerHTML = item.scenarios.map(s => `<button type="button" data-scenario="${esc(s.id)}" aria-pressed="false">${esc(s.label)}</button>`).join("");
    function choose(id) {
      const selected = item.scenarios.find(s => s.id === id) ?? item.scenarios[0];
      routes.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.scenario === selected.id)));
      body.innerHTML = `<p>${esc(selected.summary)}</p><div class="lab-stages">${selected.steps.map(s => `<button type="button" data-stage-evidence="${esc(s.evidenceId)}"><span>${esc(s.label)}</span><strong>${esc(s.value)}</strong></button>`).join("")}</div><small class="lab-stage-caption">Select a stage to inspect the code behind it.</small><p class="lab-scenario-outcome">${esc(selected.outcome)}</p>`;
    }
    routes.addEventListener("click", event => { const button = event.target.closest("[data-scenario]"); if (button) choose(button.dataset.scenario); });
    body.addEventListener("click", event => { const button = event.target.closest("[data-stage-evidence]"); if (button) inspectSource(instance, button.dataset.stageEvidence); });
    choose(item.scenarios[0].id);
    instance.view.querySelector(".briefing-heading").after(panel);
  }
  function designReadings(instance) {
    for (const block of instance.view.querySelectorAll(".briefing-prose")) {
      if (!block.querySelector(".briefing-basis")) continue;
      const details = document.createElement("details"); details.className = "lab-reasoning";
      const summary = document.createElement("summary"); summary.textContent = "Explore the tradeoff · inference";
      details.append(summary, block.querySelector("p"));
      block.querySelector(".briefing-basis").remove(); block.prepend(details);
    }
  }
  try {
    const response = await fetch("/cases.json"); if (!response.ok) throw new Error("Captured changes could not be loaded.");
    const data = await response.json();
    const mapStyle = getComputedStyle(document.documentElement);
    window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: "dark", maxTextSize: 12000, sequence: { useMaxWidth: true, wrap: true },
      themeCSS: `.nodeLabel, .nodeLabel p { font-family: ${mapStyle.getPropertyValue("--map-node-font")}; font-size: ${mapStyle.getPropertyValue("--map-node-title-size")}; font-weight: 600; }`,
    });
    get("case-picker").innerHTML = data.cases.map(c => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join("");
    get("approaches").innerHTML = data.approaches.map((a, i) => `<button id="approach-${a.id}" type="button" role="tab" aria-selected="false" tabindex="-1" data-approach="${a.id}"><span>${i === 0 ? "BASE" : `0${i}`}</span>${esc(a.label)}</button>`).join("");
    stage.innerHTML = "";
    function mount(item, approach) {
      const key = `${item.id}/${approach.id}`, workspace = document.createElement("div");
      workspace.id = `lab-${item.id}-${approach.id}`; workspace.className = "lab-workspace"; workspace.dataset.approach = approach.id;
      workspace.setAttribute("role", "tabpanel"); workspace.setAttribute("aria-labelledby", `approach-${approach.id}`);
      workspace.innerHTML = '<aside class="briefing-outline lab-outline"></aside><div class="lab-scroll"><article class="briefing-view"></article></div><aside class="briefing-inspector lab-evidence"></aside><div class="lab-chips" hidden></div>';
      stage.appendChild(workspace);
      paneResizers.mount(workspace);
      const instance = { key, item, approach, workspace, view: workspace.querySelector(".briefing-view"), pane: workspace.querySelector(".lab-evidence"), scroll: workspace.querySelector(".lab-scroll") };
      instance.reader = createBriefingReader({
        outcomeFirst: approach.id === "outcome",
        view: instance.view, outline: workspace.querySelector(".lab-outline"), pane: instance.pane, chips: workspace.querySelector(".lab-chips"),
        highlight: async groups => groups.map(g => ({ id: g.id, lines: data.highlighted[JSON.stringify([g.path, g.lines])] })),
        tokenHtml: token => `<span style="color:#${esc(token.dark)};${token.fontStyle & 1 ? "font-style:italic;" : ""}${token.fontStyle & 2 ? "font-weight:600;" : ""}">${esc(token.content)}</span>`,
        openTools: openEvidence,
      });
      instance.reader.render({ outline: { briefing: item.documents[approach.id] }, comparison: { repositoryName: item.repositoryName, branch: item.head.slice(0, 7) } });
      if (approach.id === "trace") scenarioPanel(instance, item);
      if (approach.id === "decisions") designReadings(instance);
      instances.set(key, instance); return instance;
    }
    function show(caseId, approachId, updateUrl = true) {
      const item = data.cases.find(c => c.id === caseId) ?? data.cases[0];
      const approach = data.approaches.find(a => a.id === approachId) ?? data.approaches[1];
      const key = `${item.id}/${approach.id}`;
      if (current?.key === key) return;
      closeEvidence();
      if (current) { current.reader.rememberAnchor(); current.reader.setActive(false); current.workspace.hidden = true; }
      current = instances.get(key) ?? mount(item, approach);
      current.workspace.hidden = false; current.reader.setActive(true);
      get("case-picker").value = item.id;
      const revisions = `${item.base.slice(0, 7)} → ${item.head.slice(0, 7)}`;
      const repositoryUrl = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(item.repositoryUrl ?? "") ? item.repositoryUrl : null;
      const revisionLabel = repositoryUrl
        ? `<a href="${esc(repositoryUrl)}/compare/${esc(item.base)}...${esc(item.head)}" target="_blank" rel="noopener noreferrer">${esc(revisions)} ↗</a>`
        : `<span>${esc(revisions)}</span>`;
      get("case-source").innerHTML = `<span>${esc(item.repositoryName)} · ${item.files} changed files</span>${revisionLabel}`;
      get("approach-description").textContent = approach.description;
      get("case-description").textContent = item.description;
      for (const button of get("approaches").querySelectorAll("button")) {
        const selected = button.dataset.approach === approach.id;
        button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1;
        button.setAttribute("aria-controls", `lab-${item.id}-${button.dataset.approach}`);
      }
      document.title = `${item.title} · ${approach.label} · Briefing experiments`;
      if (updateUrl) history.pushState(null, "", `#case=${item.id}&approach=${approach.id}`);
    }
    function showHash() { const params = new URLSearchParams(location.hash.slice(1)); show(params.get("case"), params.get("approach"), false); }
    get("case-picker").addEventListener("change", event => show(event.target.value, current.approach.id));
    get("approaches").addEventListener("click", event => { const button = event.target.closest("[data-approach]"); if (button) show(current.item.id, button.dataset.approach); });
    get("approaches").addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const buttons = [...get("approaches").querySelectorAll("button")], index = buttons.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].click(); buttons[next].focus();
    });
    addEventListener("popstate", showHash); addEventListener("hashchange", showHash);
    get("notes-open").addEventListener("click", () => {
      get("notes-title").textContent = `${current.item.title} · ${current.approach.label}`;
      get("comparison-question").textContent = current.approach.question;
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
      const report = ["# Briefing experiment notes", "", ...data.cases.flatMap(item => [
        `## ${item.title}`, `Repository: ${item.repositoryName}`, `Source: ${item.base} → ${item.head}`, "",
        ...data.approaches.flatMap(a => [`### ${a.label}`, notes[`${item.id}/${a.id}`] || "No notes yet.", ""]),
      ])].join("\n");
      const url = URL.createObjectURL(new Blob([report], { type: "text/markdown" }));
      const link = document.createElement("a"); link.href = url; link.download = "briefing-experiment-notes.md"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    showHash();
  } catch (error) { stage.textContent = `Unable to open the experiments: ${error.message}`; console.error(error); }
})();
