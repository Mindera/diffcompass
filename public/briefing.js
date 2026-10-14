/* Saved narrative reader. Evidence selection never changes tour/review progress. */
function createBriefingReader(options) {
  const { view, outline, pane, chips } = options;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const syntaxCache = new Map();
  let document = null, session = null, rendered = null, active = false, inspection = null, selected = null, attachments = [], generation = 0, anchor = null;
  const scroll = view.parentElement;
  const blocks = () => document?.sections.flatMap(s => s.blocks) ?? [];
  const blockFor = id => blocks().find(b => b.id === id);
  const diagramFor = block => document?.diagrams.find(d => d.id === block?.diagramId);
  const action = (label, attrs) => `<button type="button" class="text-button" ${attrs}>${esc(label)}</button>`;
  function rememberAnchor() {
    if (!active) return;
    const top = scroll.getBoundingClientRect().top;
    const block = [...view.querySelectorAll("[data-briefing-block]")].find(el => el.getBoundingClientRect().bottom > top + 12);
    if (block) anchor = { id: block.dataset.briefingBlock, offset: block.getBoundingClientRect().top - top };
  }
  function restoreAnchor() {
    const block = anchor && view.querySelector(`[data-briefing-block="${CSS.escape(anchor.id)}"]`);
    if (active && block) scroll.scrollTop += block.getBoundingClientRect().top - scroll.getBoundingClientRect().top - anchor.offset;
  }
  scroll.addEventListener("scroll", rememberAnchor, { passive: true });
  let width = scroll.clientWidth;
  new ResizeObserver(() => { if (scroll.clientWidth !== width) { width = scroll.clientWidth; restoreAnchor(); } }).observe(scroll);
  function render(value) {
    session = value; document = value?.outline?.briefing ?? null;
    const identity = document ? `${document.id}:${Boolean(document.outdated)}` : value?.outline ? "legacy" : "empty";
    if (identity === rendered) { renderChips(); return; }
    rememberAnchor(); rendered = identity; const ticket = ++generation;
    const repository = value?.pullRequest?.repository ?? value?.comparison.repositoryName ?? "";
    const branch = value?.pullRequest?.headRefName ?? value?.comparison.branch ?? "detached";
    const heading = `<header class="briefing-heading"><div class="eyebrow">${esc(repository)} · ${esc(branch)} · Briefing</div><h1>${esc(document?.title ?? value?.outline?.title ?? "Understand this change")}</h1></header>`;
    if (!document) {
      view.innerHTML = heading + `<p>${esc(value?.outline?.summary ?? "Prepare a walkthrough to explore the intent, behavior, and design of this change.")}</p><button type="button" class="button primary" data-briefing-generate>${value?.outline ? "Generate Briefing" : "Prepare walkthrough"}</button>`;
      outline.innerHTML = '<p class="muted">Briefing</p>'; renderInspector(); return;
    }
    outline.innerHTML = `<div class="eyebrow">In this change</div><nav aria-label="Briefing sections">${document.sections.map(s => action(s.title, `data-briefing-section="${esc(s.id)}"`)).join("")}</nav><p class="briefing-version">${document.mode === "overview" ? "Basic overview · from saved tour" : "Authored walkthrough"}</p><button type="button" class="text-button" data-briefing-generate>Regenerate Briefing</button>${document.outdated ? '<p role="status" class="briefing-stale">Source or intent changed. This is the saved snapshot.</p>' : ''}`;
    view.innerHTML = heading + document.sections.map(s => `<section id="briefing-section-${esc(s.id)}" class="briefing-section"><h2>${esc(s.title)}</h2>${s.blocks.map(blockHtml).join("")}</section>`).join("");
    renderInspector(); renderChips(); restoreAnchor(); void renderDiagrams(ticket);
  }
  function blockHtml(b) {
    const attrs = `data-briefing-block="${esc(b.id)}"`;
    const ask = action("Ask", `data-briefing-ask="${esc(b.id)}"`);
    if (b.kind === "prose") return `<article class="briefing-block briefing-prose" ${attrs}>${b.basis ? `<span class="briefing-basis">${esc({ stated: "Stated intent", observed: "Observed behavior", inferred: "Inference" }[b.basis])}</span>` : ""}<p data-briefing-text>${esc(b.text)}</p><div class="briefing-block-actions">${ask}</div></article>`;
    if (b.kind === "example") return `<article class="briefing-block" ${attrs}><span class="briefing-basis">Illustrative example${b.language ? ` · ${esc(b.language)}` : ""}</span><pre data-briefing-text><code>${esc(b.text)}</code></pre><div class="briefing-block-actions">${ask}</div></article>`;
    if (b.kind === "source") { const e = document.evidence.find(e => e.id === b.evidenceId); return `<article class="briefing-block briefing-citation" ${attrs}>${action(e ? `${e.path}:${e.startLine}–${e.endLine} · ${e.side}` : "Source unavailable", `data-briefing-inspect="${esc(b.id)}"`)}${ask}</article>`; }
    const d = diagramFor(b);
    return `<figure class="briefing-block briefing-diagram" ${attrs}><figcaption><div><span class="eyebrow">${esc(d?.family)}${d?.outdated ? " · saved diagram, source changed" : ""}</span><strong>${esc(d?.title)}</strong></div>${action("Inspect", `data-briefing-inspect="${esc(b.id)}"`)}${ask}</figcaption><div class="briefing-canvas ${["architecture", "domain", "call-flow"].includes(d?.family) ? "architecture-node-skin" : ""}" aria-label="${esc(d?.title)}">Rendering diagram…</div><details class="briefing-elements"><summary>Explore ${d?.elements.length ?? 0} ${d?.family === "sequence" ? "messages" : "elements"}</summary><div>${(d?.elements ?? []).map(e => `<button type="button" data-briefing-element="${esc(e.id)}" data-block-id="${esc(b.id)}">${esc(e.label)}</button>`).join("")}</div></details></figure>`;
  }
  async function renderDiagrams(ticket) {
    for (const b of blocks().filter(b => b.kind === "diagram")) {
      if (generation !== ticket) return;
      const d = diagramFor(b), box = view.querySelector(`[data-briefing-block="${CSS.escape(b.id)}"] .briefing-canvas`);
      if (!box || !d) continue;
      try {
        if (d.family === "call-flow" && options.callFlowHtml) {
          box.innerHTML = options.callFlowHtml(d.ir);
          // The native map exposes exact node/edge IDs; no label matching.
          for (const el of box.querySelectorAll("[data-node-id], [data-edge-id]")) bindElement(el, b.id, el.dataset.nodeId ?? el.dataset.edgeId);
        } else {
          let mermaid = d.mermaid;
          if (!mermaid && ["domain", "call-flow"].includes(d.family)) {
            // Domain IDs are native authored identifiers. Labels are escaped for Mermaid.
            const label = s => String(s).replace(/["<>\n]/g, " ");
            const nodes = d.ir.components ?? d.ir.nodes, edges = d.ir.connections ?? d.ir.edges;
            const ids = new Map(nodes.map((c, i) => [c.id, `item${i}`]));
            mermaid = `flowchart LR\n${nodes.map(c => `${ids.get(c.id)}["${label(c.label)}${c.change ? ` (${label(c.change)})` : ""}"]`).join("\n")}\n${edges.map(c => `${ids.get(c.from)} -->|"${label(c.label ?? "calls")}"| ${ids.get(c.to)}`).join("\n")}`;
          }
          if (!mermaid || !window.mermaid) throw new Error("Use the element list to explore this diagram.");
          const renderId = `briefing-${ticket}-${b.id.replace(/[^a-zA-Z0-9]/g, "-")}`;
          const result = await window.mermaid.render(renderId, mermaid);
          if (generation !== ticket) return;
          if (window.ReviewDiagramLabels) window.ReviewDiagramLabels.mount(box, result.svg);
          else box.innerHTML = result.svg;
          if (d.family === "sequence") {
            const messages = box.querySelectorAll(".messageText");
            if (messages.length === d.elements.length) messages.forEach((el, i) => bindElement(el, b.id, d.elements[i].id));
          } else if (["domain", "call-flow"].includes(d.family)) {
            const nodes = d.ir.components ?? d.ir.nodes;
            for (const el of box.querySelectorAll("g.node")) {
              const native = el.dataset.id ?? (el.id.startsWith(`${renderId}-flowchart-`) ? /^(.+)-\d+$/.exec(el.id.slice(`${renderId}-flowchart-`.length))?.[1] : undefined);
              const index = /^item(\d+)$/.exec(native ?? "")?.[1];
              if (index !== undefined && nodes[Number(index)]) bindElement(el, b.id, nodes[Number(index)].id);
            }
          } else if (d.family === "architecture") {
            // Mermaid retains the declared node ID in data-id or flowchart-{ID}-{ordinal}.
            for (const el of box.querySelectorAll("g.node")) {
              const native = el.dataset.id ?? (el.id.startsWith(`${renderId}-flowchart-`) ? /^(.+)-\d+$/.exec(el.id.slice(`${renderId}-flowchart-`.length))?.[1] : undefined);
              const exact = d.elements.find(e => e.id === native);
              if (exact) bindElement(el, b.id, exact.id);
            }
          }
          // Other renderers keep an accessible exact-ID element list. No guessed SVG links.
        }
      } catch { box.textContent = "Diagram preview unavailable. Explore its saved elements below."; }
    }
    highlight(); restoreAnchor();
  }
  function bindElement(el, blockId, elementId) {
    if (!diagramFor(blockFor(blockId))?.elements.some(e => e.id === elementId)) return;
    el.closest("svg")?.removeAttribute("aria-hidden");
    el.dataset.briefingElement = elementId; el.dataset.blockId = blockId;
    el.setAttribute("tabindex", "0"); el.setAttribute("role", "button");
    el.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); event.stopPropagation(); inspect(blockId, elementId); } });
  }
  function evidenceHtml(e) {
    if (!e) return '<p class="muted">No verified source binding is available for this element.</p>';
    return `<div class="briefing-source" data-evidence-id="${esc(e.id)}"><div class="briefing-source-label">${esc(e.kind === "document" ? "Documentary evidence · " : "")}${esc(e.path)}:${e.startLine}–${e.endLine} · ${e.side}</div>${e.available ? `<pre><code>${e.quote.split("\n").map((line, i) => `<span class="briefing-code-line"><span class="briefing-line-number">${e.startLine + i}</span>${esc(line)}</span>`).join("")}</code></pre>${action("Open in Changes", `data-briefing-source="${esc(e.id)}"`)}` : `<p class="muted">${esc(e.reason ?? "Source unavailable")}</p>`}</div>`;
  }
  function renderInspector() {
    if (!inspection) { pane.innerHTML = '<header><span class="eyebrow">Evidence</span><h2>Explore this change</h2></header><div class="briefing-evidence-scroll"><p class="muted">Inspect a passage, diagram, or source citation. Evidence stays here while you read.</p></div>'; return; }
    if (inspection.frozen) {
      const i = inspection.frozen;
      pane.innerHTML = `<header><span class="eyebrow">Saved question context</span><h2>${esc(i.label)}</h2></header><div class="briefing-evidence-scroll"><p class="briefing-quotation">${esc(i.text)}</p>${i.evidence.map(evidenceHtml).join("")}</div>`; void highlightEvidence(); return;
    }
    const b = blockFor(inspection.blockId), d = diagramFor(b);
    if (!b) { pane.innerHTML = '<p>This inspected item belongs to an earlier Briefing. Attached question context is retained.</p>'; return; }
    const title = d?.title ?? (b.kind === "source" ? "Source citation" : "Selected passage");
    let content;
    if (d) content = d.elements.map((e, index) => `<article class="briefing-evidence-card" data-evidence-element="${esc(e.id)}"><button class="briefing-card-title" type="button" data-briefing-element="${esc(e.id)}" data-block-id="${esc(b.id)}">${d.family === "sequence" ? `${index + 1}. ` : ""}${esc(e.label)}</button>${e.evidenceIds.length ? e.evidenceIds.map(id => evidenceHtml(document.evidence.find(e => e.id === id))).join("") : evidenceHtml(null)}${action(`Ask about ${d.family === "sequence" ? "message" : e.kind === "components" ? "component" : "element"}`, `data-briefing-ask="${esc(b.id)}" data-element-id="${esc(e.id)}"`)}</article>`).join("");
    else content = b.kind === "source" ? evidenceHtml(document.evidence.find(e => e.id === b.evidenceId)) : `<p class="briefing-quotation">${esc(inspection.quote ?? b.text)}</p>${action("Ask about passage", `data-briefing-ask="${esc(b.id)}"` )}`;
    pane.innerHTML = `<header><span class="eyebrow">${esc(d?.family ?? "Evidence")}</span><h2>${esc(title)}</h2></header><div class="briefing-evidence-scroll">${content}<details class="briefing-review-details"><summary>Review details</summary><p>${esc(session.comparison.repositoryName)} · ${esc(session.comparison.branch)}<br>Saved ${esc(document.createdAt)}${document.outdated ? " · outdated source or intent" : ""}</p></details></div>`;
    highlight(); void highlightEvidence();
  }
  async function highlightEvidence() {
    if (!options.highlight) return;
    const captured = document;
    const sources = (inspection?.frozen?.evidence ?? document?.evidence ?? []).filter(e => e.available);
    const needed = sources.filter(e => pane.querySelector(`[data-evidence-id="${CSS.escape(e.id)}"]`) && !syntaxCache.has(`${e.blob}:${e.startLine}:${e.endLine}`));
    if (needed.length) {
      try { const groups = await options.highlight(needed.map(e => ({ id: e.id, path: e.path, lines: e.quote.split("\n") })));
        for (const group of groups) { const source = needed.find(e => e.id === group.id); if (source) syntaxCache.set(`${source.blob}:${source.startLine}:${source.endLine}`, group.lines); }
      } catch { return; }
    }
    if (captured !== document) return;
    for (const e of sources) {
      const tokens = syntaxCache.get(`${e.blob}:${e.startLine}:${e.endLine}`); if (!tokens) continue;
      for (const code of pane.querySelectorAll(`[data-evidence-id="${CSS.escape(e.id)}"] code`)) code.innerHTML = tokens.map((line, i) => `<span class="briefing-code-line"><span class="briefing-line-number">${e.startLine + i}</span>${line.map(token => options.tokenHtml(token)).join("")}</span>`).join("");
    }
  }
  function inspect(blockId, elementId, quote) {
    const same = inspection?.blockId === blockId && !inspection.frozen;
    inspection = { blockId, elementId, quote }; selected = elementId ? { blockId, elementId } : null;
    if (!same || !elementId) renderInspector();
    highlight(); options.openTools?.();
    if (elementId) {
      const card = pane.querySelector(`[data-evidence-element="${CSS.escape(elementId)}"]`), container = pane.querySelector(".briefing-evidence-scroll");
      if (card && container) container.scrollTop += card.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
    }
  }
  function highlight() {
    for (const el of view.querySelectorAll("[data-briefing-element]")) { const current = el.dataset.blockId === selected?.blockId && el.dataset.briefingElement === selected?.elementId; el.classList.toggle("briefing-selected", current); el.setAttribute("aria-pressed", String(current)); }
    for (const el of pane.querySelectorAll("[data-evidence-element]")) el.classList.toggle("briefing-selected", el.dataset.evidenceElement === selected?.elementId);
  }
  function attach(blockId, elementId, quote) {
    const b = blockFor(blockId), d = diagramFor(b), e = d?.elements.find(e => e.id === elementId);
    if (!b) return;
    const key = JSON.stringify([document.id, blockId, elementId, quote]);
    if (!attachments.some(a => a.key === key)) {
      if (attachments.length >= 8) return options.notify?.("Attach at most eight items to a question.");
      attachments.push({ key, documentId: document.id, blockId, ...(elementId ? { elementId } : {}), ...(quote ? { quote } : {}), label: e?.label ?? d?.title ?? quote?.slice(0, 80) ?? b.text?.slice(0, 80) ?? "Source citation", snapshot: { label: e?.label ?? d?.title ?? "Passage", text: quote ?? b.text ?? e?.label ?? d?.title ?? "", evidence: document.evidence.filter(source => (e?.evidenceIds ?? (b.kind === "source" ? [b.evidenceId] : [])).includes(source.id)) } });
    }
    inspect(blockId, elementId, quote); options.onAsk?.(); renderChips();
  }
  function renderChips() {
    const frozen = options.getThreadContext?.();
    if (options.hasThread?.() && !frozen) { chips.innerHTML = '<span class="muted">This conversation keeps its original context. Start a new question to attach Briefing items.</span>'; return; }
    const items = frozen?.items ?? attachments;
    chips.innerHTML = items.length ? `<span class="eyebrow">Question context${frozen ? " · saved" : ""}</span><div class="briefing-chip-list">${items.map((a, i) => `<span class="briefing-chip">${action(a.label, `data-briefing-chip="${i}"`)}${!frozen ? `<button type="button" data-briefing-remove="${i}" aria-label="Remove ${esc(a.label)}">×</button>` : ""}</span>`).join("")}</div>` : '<span class="muted">No Briefing items attached. Use Ask beside a passage or element.</span>';
  }
  function click(event) {
    const el = event.target.closest("[data-briefing-element]") ?? event.target.closest("button"); if (!el) return;
    if (el.hasAttribute("data-briefing-generate")) return void options.onGenerate?.();
    if (el.dataset.briefingSection) { const target = view.querySelector(`#briefing-section-${CSS.escape(el.dataset.briefingSection)}`); if (target) scroll.scrollTop += target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 24; return; }
    if (el.dataset.briefingElement) { event.stopPropagation(); return inspect(el.dataset.blockId, el.dataset.briefingElement); }
    if (el.dataset.briefingInspect) return inspect(el.dataset.briefingInspect);
    if (el.dataset.briefingAsk) {
      const selection = window.getSelection(), text = selection?.toString();
      const block = view.querySelector(`[data-briefing-block="${CSS.escape(el.dataset.briefingAsk)}"]`);
      const quote = text && block?.contains(selection.anchorNode) && block?.contains(selection.focusNode) && (blockFor(el.dataset.briefingAsk)?.text ?? "").includes(text) ? text : undefined;
      return attach(el.dataset.briefingAsk, el.dataset.elementId, quote);
    }
    if (el.dataset.briefingSource) {
      const e = document?.evidence.find(e => e.id === el.dataset.briefingSource) ?? inspection?.frozen?.evidence.find(e => e.id === el.dataset.briefingSource);
      if (e) Promise.resolve(options.onChanges?.(e, document?.comparisonId)).catch(error => options.notify?.(error.message)); return;
    }
    if (el.hasAttribute("data-briefing-remove")) { attachments.splice(Number(el.dataset.briefingRemove), 1); renderChips(); return; }
    if (el.hasAttribute("data-briefing-chip")) {
      const i = Number(el.dataset.briefingChip), frozen = options.getThreadContext?.();
      inspection = { frozen: frozen?.items[i] ?? attachments[i]?.snapshot }; renderInspector(); options.openTools?.();
    }
  }
  [view, outline, pane, chips].forEach(el => el.addEventListener("click", click));
  return {
    render, renderChips, rememberAnchor, restoreAnchor,
    setActive(value) { active = value; if (active) restoreAnchor(); },
    context() {
      if (!attachments.length || !document) return undefined;
      if (attachments.some(a => a.documentId !== document.id)) throw new Error("Attached context belongs to an earlier Briefing. Remove it before starting a new question; existing conversations retain their saved context.");
      return { documentId: document.id, items: attachments.map(({ blockId, elementId, quote }) => ({ blockId, ...(elementId ? { elementId } : {}), ...(quote ? { quote } : {}) })) };
    },
  };
}
