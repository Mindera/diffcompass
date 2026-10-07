// Prototype-only presentation over the existing resolver, panel and history.
// Keep the old API/DOM identities so existing callers and Before anchors survive.
export function referencePresentation(result, context = {}) {
  const names = result.source === "repository-search";
  const indexed = result.source === "codegraph";
  const semantic = result.source === "language-server";
  return {
    heading: names ? "Possible references — name matches" : indexed ? "Indexed reference candidates" : result.source === "language-server" ? "References" : "Reference candidates",
    definitions: semantic ? "Definitions" : "Possible definitions",
    kind: names ? "name match" : indexed ? "indexed candidate" : semantic ? "reference" : "candidate",
    status: [
      "Current workspace",
      context.side === "old" ? "Search started from original code; results are not the original revision." : "Results are not tied to the reviewed revision.",
      `${result.sourceLabel}: ${result.notice}`,
      names ? "Name matches can include unrelated symbols, comments and strings." : "",
      result.truncated ? "Results were truncated; this is not a complete reference list." : "",
    ].filter(Boolean).join(" · "),
  };
}

export function configureReferenceActions(monaco) {
  // These bundled providers only know loaded models, not the repository search.
  // Replace their two references menu entries with our single repository action.
  // Public configuration leaves Go to/Peek Definition and hover untouched.
  for (const defaults of [monaco.languages.typescript.typescriptDefaults, monaco.languages.typescript.javascriptDefaults]) {
    defaults.setModeConfiguration({ ...defaults.modeConfiguration, references: false });
  }
}

export function installReferencesPanel({ elements, state, render, updateToolbar, showRepositoryFile, renderRepositoryFile, compact }) {
  const panel = elements["symbol-peek-panel"];
  const labelActions = () => {
    const action = elements["symbol-peek-open"];
    if (action) action.textContent = "Find references";
    const selectionAction = elements["code-selection-toolbar"]?.querySelector('[data-selection-tool="peek"]');
    if (selectionAction) selectionAction.textContent = "Find references";
  };
  function renderReferences() {
    render();
    labelActions();
    panel.querySelector(".eyebrow").textContent = "Find references";
    panel.querySelector('button[type="submit"]').textContent = "Find references";
    elements["symbol-peek-trail"].setAttribute("aria-label", "Reference search history");
    const trail = panel.querySelector(".symbol-peek-trail-label");
    if (trail) trail.textContent = "Search history";
    const peek = state.symbolPeek, result = peek.result;
    elements["symbol-peek-title"].textContent = peek.current?.symbol || "Find references";
    elements["symbol-peek-close"].setAttribute("aria-label", peek.compact ? "Close references" : "Back to code");
    if (!peek.open) return;
    if (!peek.current) {
      elements["symbol-peek-status"].textContent = "Find references in the current workspace. Choose a symbol or enter its name.";
      return;
    }
    if (peek.loading) {
      elements["symbol-peek-status"].textContent = `Searching current workspace for ${peek.current.symbol}…`;
      return;
    }
    if (!result) {
      elements["symbol-peek-status"].textContent = "Reference search failed. Try Find references again.";
      return;
    }
    const view = referencePresentation(result, peek.current);
    elements["symbol-peek-status"].textContent = view.status;
    const target = elements["symbol-peek-result"];
    // Native renderer already escapes, creates source controls and schedules
    // highlighting. Move its nodes without replacing identities or handlers.
    const [definitions, usages] = target.children;
    if (usages) {
      usages.dataset.referenceSection = "usages";
      const heading = usages.querySelector("h3");
      if (heading) heading.textContent = `${view.heading} (${result.usages.length})`;
      else usages.textContent = "No reference locations returned by this search.";
      for (const kind of usages.querySelectorAll(".symbol-peek-kind")) kind.textContent = view.kind;
      target.prepend(usages);
    }
    if (definitions) {
      const details = document.createElement("details");
      details.className = "symbol-peek-raw";
      details.dataset.referenceSection = "definitions";
      const summary = document.createElement("summary");
      summary.textContent = `${view.definitions} (${result.definitions.length}) · secondary context`;
      definitions.querySelector("h3")?.remove();
      for (const kind of definitions.querySelectorAll(".symbol-peek-kind")) kind.textContent = view.definitions === "Possible definitions" ? "possible definition" : "definition";
      definitions.replaceWith(details);
      details.append(summary, definitions);
    }
    for (const button of target.querySelectorAll("[data-symbol-location]")) {
      button.textContent = "Open workspace source";
      button.title = "Open the current workspace file, not a captured diff revision";
    }
  }
  function renderSource(...args) {
    const result = renderRepositoryFile(...args);
    const label = elements.diff.querySelector(".source-file .file-stats .muted");
    if (label) label.textContent = "Current workspace";
    return result;
  }
  async function openLocation(path, line) {
    // The resolver searches the workspace, including when invoked from Before.
    // Do not redirect changed-file results into captured After diff coordinates.
    if (!await showRepositoryFile(path, line)) return;
    if (state.repositoryFileView === "preview") {
      state.repositoryFileView = "source";
      renderSource(path, state.repositoryFileContent);
    }
    const source = elements.diff.querySelector(".source-code");
    if (source && Number.isSafeInteger(line) && line > 0) {
      source.dataset.selectedLine = String(line);
      const row = source.querySelector(`[data-source-line="${line}"]`);
      row?.classList.add("sequence-source-highlight");
      row?.scrollIntoView({ block: "center" });
    }
    compact();
  }
  return {
    render: renderReferences, openLocation, renderSource,
    updateToolbar(...args) { const result = updateToolbar(...args); labelActions(); return result; },
  };
}

// Review identities stay independent of Monaco's screen rows and gutter lanes.
export function commentDescription(comment) {
  const quote = typeof comment.selectedText === "string" && comment.selectedText.trim() ? comment.selectedText : null;
  const end = comment.endLine || comment.line;
  return {
    kind: quote ? "Quote comment" : end > comment.line ? "Line range comment" : "Line comment",
    location: `${comment.side === "old" ? "Before" : "After"} · L${comment.line}${end > comment.line ? `–${end}` : ""}`,
    quote,
    quoteLines: quote ? quote.replaceAll("\r\n", "\n").split("\n").length : 0,
  };
}

export function commentSubmission(anchor, body, quoted) {
  return {
    scope: quoted || anchor.endLine > anchor.line ? "range" : "line",
    path: anchor.path, side: anchor.side, line: anchor.line, endLine: anchor.endLine,
    ...(quoted ? { selectedText: anchor.selectedText } : {}), context: anchor.context, body,
  };
}

export function reviewMarkers(file, session) {
  const groups = new Map();
  const source = Object.fromEntries(["old", "new"].map(side => [side, file[side].split("\n")]));
  const matches = anchor => anchor?.path === file.path && ["old", "new"].includes(anchor.side)
    && Number.isInteger(anchor.line) && anchor.line > 0 && anchor.line <= source[anchor.side].length
    && file[anchor.side] !== "" && source[anchor.side][anchor.line - 1] === anchor.content
    && (anchor.context === undefined || source[anchor.side].slice(anchor.line - 1, anchor.endLine || anchor.line).join("\n") === anchor.context);
  const group = anchor => {
    const key = `${anchor.side}:${anchor.line}`;
    if (!groups.has(key)) groups.set(key, { side: anchor.side, line: anchor.line, conversations: [], findings: [] });
    return groups.get(key);
  };
  const threads = new Map();
  let legacyRoot = null;
  for (const message of session.messages || []) {
    if (message.role === "user" && !message.threadId) legacyRoot = message.id;
    const id = message.threadId || legacyRoot || message.id;
    if (!threads.has(id)) threads.set(id, { id, root: message, messages: [] });
    threads.get(id).messages.push(message);
  }
  for (const thread of threads.values()) if (thread.root.role === "user" && matches(thread.root.anchor)) group(thread.root.anchor).conversations.push(thread);
  for (const finding of session.outline?.findings || []) {
    const anchor = { ...finding, content: finding.lineContent };
    if (!finding.outdated && matches(anchor)) group(anchor).findings.push(finding);
  }
  return [...groups.values()];
}

export function highestPriority(findings) {
  return ["P0", "P1", "P2", "P3"].find(priority => findings.some(finding => finding.priority === priority)) || "?";
}

// Tour state is presentation, not an editor selection or a reviewer quotation.
export function fileChangeCounts(file) {
  if (![file?.additions, file?.deletions].every(value => Number.isSafeInteger(value) && value >= 0)) return null;
  return { added: `+${file.additions}`, removed: `−${file.deletions}`, label: `${file.additions} added lines, ${file.deletions} removed lines` };
}

// Paint only native visible source rectangles, never model-line arithmetic:
// wrapped lines, removed-row cards, alignment zones and hidden gaps differ.
export function gutterRowGradient(rows, origin, height) {
  const ranges = rows.map(row => ({ top: Math.max(0, row.top - origin), bottom: Math.min(height, row.bottom - origin), color: row.color }))
    .filter(row => Number.isFinite(row.top) && Number.isFinite(row.bottom) && row.bottom > row.top)
    .sort((a, b) => a.top - b.top);
  const merged = [];
  for (const row of ranges) {
    const last = merged.at(-1);
    if (last && row.top < last.bottom && row.color !== last.color) return "none";
    if (last && row.top <= last.bottom && row.color === last.color) last.bottom = Math.max(last.bottom, row.bottom);
    else merged.push({ ...row });
  }
  return merged.length ? `linear-gradient(to bottom, ${merged.map(({ top, bottom, color }) => `transparent ${top}px, ${color} ${top}px, ${color} ${bottom}px, transparent ${bottom}px`).join(", ")})` : "none";
}

export function fileStatusLabel(status) {
  return ({ added: "Added", modified: "Modified", deleted: "Deleted", renamed: "Renamed" })[status] || "Changed";
}
export function tourSourceLabel(file, side) {
  if (file.status === "added" && side === "new") return "New file";
  if (file.status === "deleted" && side === "old") return "Deleted file";
  return side === "old" ? "Original code" : "Updated code";
}
export function tourStopsForFile(file, steps, currentId) {
  const currentIndex = steps.findIndex(step => step.id === currentId);
  return steps.flatMap((step, index) => {
    const anchor = step.anchor;
    if (!anchor || anchor.path !== file.path || !["old", "new"].includes(anchor.side)) return [];
    const count = file[anchor.side] ? file[anchor.side].split("\n").length : 0;
    if (![anchor.startLine, anchor.endLine].every(Number.isSafeInteger) || anchor.startLine < 1 || anchor.endLine < anchor.startLine || anchor.endLine > count) return [];
    const state = step.id === currentId ? "current" : currentIndex >= 0 && index === currentIndex + 1 ? "next" : "other";
    return [{ ...step, state, label: state === "current" ? "Current stop" : state === "next" ? "Next stop" : `Stop ${index + 1}` }];
  });
}

export function installTourAnnotations({ file, editors, monaco, unified, root, onLayout }) {
  const decorations = Object.fromEntries(Object.entries(editors).map(([side, editor]) => [side, editor.createDecorationsCollection()]));
  // Reserve space in Monaco, but draw the banner across the entire diff rather
  // than clipping it to one revision's code viewport. Source ranges stay sided.
  const layer = document.createElement("div"); layer.className = "review-tour-layer"; root.append(layer);
  // Unified's original number column and external +/- lane sit outside the
  // modified editor. Extend only its rendered margin rows into that prefix;
  // never assign an After anchor to the original model or span card/deletion gaps.
  const gutter = document.createElement("div"); gutter.className = "review-tour-gutter-layer";
  gutter.setAttribute("aria-hidden", "true"); root.append(gutter);
  const bannerGap = 6;
  const edgeHosts = new Set();
  let frame = null;
  let signature = "", structureSignature = "", gutterSignature = "", records = [];
  function layout() {
    frame = null;
    const bounds = root.getBoundingClientRect();
    for (const { node, spacer } of records) {
      const rect = spacer.getBoundingClientRect();
      node.hidden = !spacer.getClientRects().length || !rect.height;
      node.style.top = `${rect.top - bounds.top + bannerGap}px`;
    }
    const isUnified = unified();
    root.classList.toggle("review-tour-unified", isUnified);
    const fragment = document.createDocumentFragment();
    if (isUnified && records.some(record => record.stop.state === "current" && record.stop.anchor.side === "new")) {
      const dom = editors.new.getDomNode();
      const native = selector => [...(dom?.querySelectorAll(selector) || [])].filter(node => node.closest(".monaco-editor") === dom).map(node => node.getBoundingClientRect()).filter(rect => rect.width && rect.height);
      const starts = native(".review-tour-margin-start"), ends = native(".review-tour-margin-end");
      for (const rect of native(".review-tour-margin")) {
        const width = rect.left - bounds.left;
        if (width <= 0 || rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue;
        const row = document.createElement("div"); row.className = "review-tour-gutter-row";
        if (starts.some(start => Math.abs(start.top - rect.top) < 1)) row.classList.add("review-tour-gutter-start");
        if (ends.some(end => Math.abs(end.bottom - rect.bottom) < 1)) row.classList.add("review-tour-gutter-end");
        row.style.cssText = `top:${rect.top - bounds.top}px;height:${rect.height}px;width:${width}px`;
        fragment.append(row);
      }
    }
    const nextGutter = [...fragment.children].map(node => `${node.className}:${node.style.cssText}`).join(";");
    if (nextGutter !== gutterSignature) { gutterSignature = nextGutter; gutter.replaceChildren(fragment); }
    const current = records.find(record => record.stop.state === "current");
    for (const editor of Object.values(editors)) {
      const dom = editor.getDomNode(), viewport = dom?.querySelector(":scope > .overflow-guard > .monaco-scrollable-element");
      if (!viewport) continue;
      let fill = "none";
      const lines = viewport.querySelector(":scope > .lines-content"), rect = viewport.getBoundingClientRect();
      if (current?.editor === editor && lines && rect.height) {
        // Use Monaco's source offsets, including wrapped lines and intervening
        // view zones, but excluding zones AFTER the final source line. Subtract
        // its rendered scroll translation so the edge stays aligned mid-scroll
        // and continues even when only a tall comment is visible.
        const scroll = rect.top - lines.getBoundingClientRect().top;
        const origin = dom.getBoundingClientRect().top - scroll;
        const top = origin + editor.getTopForLineNumber(current.stop.anchor.startLine);
        const bottom = origin + editor.getBottomForLineNumber(current.stop.anchor.endLine);
        fill = gutterRowGradient([{ top, bottom, color: "var(--accent)" }], rect.top, rect.height);
      }
      if (viewport.style.getPropertyValue("--review-tour-edge-fill") !== fill) viewport.style.setProperty("--review-tour-edge-fill", fill);
      edgeHosts.add(viewport);
    }
    onLayout?.();
  }
  function schedule() { if (frame === null) frame = requestAnimationFrame(layout); }
  const subscriptions = Object.values(editors).flatMap(editor => [editor.onDidScrollChange(schedule), editor.onDidLayoutChange(schedule)]);
  const resize = new ResizeObserver(schedule); resize.observe(root);
  // Monaco renders decorations after its model/layout notifications. Observe
  // only native editor DOM; our overlays stay outside it to avoid feedback.
  const nativeChanges = new MutationObserver(schedule);
  // Accessibility decoration writes do not change geometry. Watching them
  // would feed our child-list updates back through the Before-action adapter.
  nativeChanges.observe(root.querySelector(".monaco-diff-editor"), { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
  function clear() {
    for (const viewport of edgeHosts) viewport.style.setProperty("--review-tour-edge-fill", "none");
    gutterSignature = ""; gutter.replaceChildren();
    for (const record of records) {
      record.observer.disconnect();
      record.editor.changeViewZones(accessor => accessor.removeZone(record.id));
      record.node.remove();
    }
    records = [];
    for (const decoration of Object.values(decorations)) decoration.clear();
  }
  function updateStop(record, stop) {
    record.stop = stop;
    record.node.dataset.tourState = stop.state;
    record.node.setAttribute("aria-label", `${stop.label}: ${stop.title}`);
    if (stop.state === "current") record.node.setAttribute("aria-current", "step");
    else record.node.removeAttribute("aria-current");
    const { side, startLine, endLine } = stop.anchor;
    record.node.querySelector("span").textContent = `${stop.label} · ${tourSourceLabel(file, side)} · ${endLine === startLine ? "line" : "lines"} ${startLine}${endLine === startLine ? "" : `–${endLine}`}`;
  }
  function updateHighlight() {
    for (const decoration of Object.values(decorations)) decoration.clear();
    const record = records.find(record => record.stop.state === "current");
    if (!record) return;
    const { side, startLine, endLine } = record.stop.anchor;
    decorations[side].set([
      { range: new monaco.Range(startLine, 1, endLine, record.editor.getModel().getLineMaxColumn(endLine)), options: { isWholeLine: true, className: "review-tour-highlight", marginClassName: "review-tour-margin" } },
      { range: new monaco.Range(startLine, 1, startLine, 1), options: { isWholeLine: true, className: "review-tour-start", marginClassName: "review-tour-margin-start" } },
      { range: new monaco.Range(endLine, 1, endLine, 1), options: { isWholeLine: true, className: "review-tour-end", marginClassName: "review-tour-margin-end" } },
    ]);
  }
  return {
    update(steps = [], currentId) {
      const stops = tourStopsForFile(file, steps, currentId);
      const key = JSON.stringify([unified(), stops]);
      if (key === signature) return;
      signature = key;
      const structure = JSON.stringify([unified(), stops.map(({ id, title, objective, anchor }) => ({ id, title, objective, anchor }))]);
      if (structure === structureSignature) {
        for (const record of records) updateStop(record, stops.find(stop => stop.id === record.stop.id));
        updateHighlight(); schedule(); return;
      }
      structureSignature = structure; clear();
      for (const stop of stops) {
        // The integration host falls back to native for a phase containing
        // Before-side stops in Unified; never place them on an After row.
        if (unified() && stop.anchor.side === "old") continue;
        const { side, startLine, endLine } = stop.anchor, editor = editors[side];
        const node = document.createElement("aside"); node.className = "review-tour-stop";
        node.dataset.tourStop = stop.id; node.dataset.tourState = stop.state;
        node.dataset.side = side; node.dataset.line = String(startLine);
        node.setAttribute("aria-label", `${stop.label}: ${stop.title}`); node.tabIndex = -1;
        if (stop.state === "current") node.setAttribute("aria-current", "step");
        const content = document.createElement("div"), label = document.createElement("span"), title = document.createElement("strong"), objective = document.createElement("p");
        label.textContent = `${stop.label} · ${tourSourceLabel(file, side)} · ${endLine === startLine ? "line" : "lines"} ${startLine}${endLine === startLine ? "" : `–${endLine}`}`;
        title.textContent = stop.title; objective.textContent = stop.objective;
        content.append(label, title, objective); node.append(content);
        const spacer = document.createElement("div"); spacer.setAttribute("aria-hidden", "true");
        const descriptor = { afterLineNumber: startLine - 1, heightInPx: 50, domNode: spacer, suppressMouseDown: false, showInHiddenAreas: true, ordinal: 100010 + records.length, onDomNodeTop: schedule };
        const record = { stop, node, spacer, editor, descriptor, id: null, observer: null };
        layer.append(node);
        editor.changeViewZones(accessor => { record.id = accessor.addZone(descriptor); });
        record.observer = new ResizeObserver(() => {
          if (!content.isConnected || !content.getBoundingClientRect().width) return;
          const style = getComputedStyle(node);
          const inset = [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth].reduce((sum, value) => sum + parseFloat(value), 0);
          // Reserve breathing room on both sides in Monaco's row layout, so
          // neither the preceding code nor this stop's source touches the banner.
          const height = Math.ceil(content.getBoundingClientRect().height + inset) + bannerGap * 2;
          if (height === descriptor.heightInPx) return;
          descriptor.heightInPx = height;
          editor.changeViewZones(accessor => accessor.layoutZone(record.id));
        });
        record.observer.observe(content); records.push(record); schedule();
      }
      updateHighlight();
    },
    focus(id) {
      const record = records.find(record => record.stop.id === id);
      if (!record) return false;
      const { editor, stop, descriptor, node } = record;
      const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
      editor.updateOptions({ smoothScrolling: smooth });
      const scrollType = smooth ? monaco.editor.ScrollType.Smooth : monaco.editor.ScrollType.Immediate;
      editor.revealLinesInCenter(stop.anchor.startLine, stop.anchor.endLine, scrollType);
      // Include the inline heading, even for a stop hidden inside a folded gap.
      editor.setScrollTop(Math.max(0, editor.getTopForLineNumber(stop.anchor.startLine, true) - descriptor.heightInPx - 12), scrollType);
      node.focus({ preventScroll: true });
      return true;
    },
    dispose() { clear(); resize.disconnect(); nativeChanges.disconnect(); for (const subscription of subscriptions) subscription.dispose(); if (frame !== null) cancelAnimationFrame(frame); layer.remove(); gutter.remove(); for (const viewport of edgeHosts) viewport.style.removeProperty("--review-tour-edge-fill"); root.classList.remove("review-tour-unified"); },
  };
}

// Pinned Monaco 0.55.1 serialized view state; reject unfamiliar shapes instead
// of applying a range to the wrong region. Other regions/viewport stay intact.
export function unchangedContextState(state, defaults) {
  const regions = state?.modelState?.collapsedRegions;
  const ranges = Array.isArray(regions) ? regions.map(region => region?.range) : null;
  const empty = {canExpand:false, canCollapse:false, expanded:[]};
  if (!Array.isArray(ranges) || !Array.isArray(defaults) || ranges.length !== defaults.length ||
      ![...ranges, ...defaults].every(r => Array.isArray(r) && r.length === 2 && r.every(Number.isSafeInteger) && r[0] >= 1 && r[1] >= r[0])) return empty;
  const expanded = ranges.flatMap((range, i) => range[1] - range[0] < defaults[i][1] - defaults[i][0] ? [i] : []);
  return {canExpand:ranges.some(([start, end]) => end > start), canCollapse:expanded.length > 0, expanded};
}

export function collapsedRegionState(state, defaults, index) {
  const regions = state?.modelState?.collapsedRegions;
  if (!Array.isArray(regions) || !Array.isArray(defaults) || regions.length !== defaults.length || !defaults[index] || regions.some(r => !r || typeof r !== "object")) return null;
  if (![...regions.map(r => r.range), ...defaults].every(r => Array.isArray(r) && r.length === 2 && r.every(Number.isSafeInteger) && r[0] >= 1 && r[1] >= r[0])) return null;
  return { ...state, modelState: { ...state.modelState, collapsedRegions: regions.map((region, i) => i === index ? { ...region, range: [...defaults[i]] } : region) } };
}

export function expandedRegionState(state, index) {
  const regions = state?.modelState?.collapsedRegions;
  if (!Number.isSafeInteger(index) || index < 0 || !Array.isArray(regions) || !regions[index] ||
      !regions.every(region => Array.isArray(region?.range) && region.range.length === 2 && region.range.every(Number.isSafeInteger) && region.range[0] >= 1 && region.range[1] >= region.range[0])) return null;
  const end = regions[index].range[1], range = [end, end];
  return { ...state, modelState: { ...state.modelState, collapsedRegions: regions.map((region, i) => i === index ? { ...region, range } : region) } };
}
