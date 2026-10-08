import { gutterRowGradient, reviewMarkers } from "./annotations.mjs";
import { badgeDisplayRow } from "./source-anchor.mjs";
export { badgeDisplayRow } from "./source-anchor.mjs";

// Source rows, wrapped fragments and review cards share one vertical layout.
// Only the pinned renderer hook applies it; no source/anchor is inferred from y.
export function deletedRowLayout(start, counts, lineHeight, cards) {
  const rowTops = [], cardTops = new Map();
  let top = 0, extra = 0;
  const place = card => {
    if (!Number.isFinite(card.height) || card.height < 0) throw new Error("Invalid review-card height");
    cardTops.set(card, top); top += card.height; extra += card.height;
  };
  for (const [index, count] of counts.entries()) {
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("Invalid deleted-line wrapping");
    const attached = cards.filter(card => card.line === start + index);
    attached.filter(card => card.placement === "before").forEach(place);
    for (let fragment = 0; fragment < count; fragment++) rowTops.push(top + fragment * lineHeight);
    top += count * lineHeight;
    attached.filter(card => card.placement !== "before").forEach(place);
  }
  return { rowTops, cardTops, extra };
}

// Monaco serializes collapsed intervals in After coordinates, with an
// exclusive end. Deleted Before rows cannot belong to an unchanged interval.
export function sourceLineHidden(side, line, state, changes) {
  const row = badgeDisplayRow({ side, line }, true, changes);
  if (!row.startsWith("new:")) return false;
  const mappedLine = Number(row.slice(4));
  return Boolean(state?.modelState?.collapsedRegions?.some(({ range }) => mappedLine >= range[0] && mappedLine < range[1]));
}

export function hiddenCommentCounts(file, session, side, range, changes) {
  const state = { modelState: { collapsedRegions: [{ range }] } };
  const hidden = (entry, line) => entry.path === file.path && (side === "both" || entry.side === side)
    && sourceLineHidden(entry.side, line, state, changes);
  // A quote is one card, anchored after its final line, not one per quoted row.
  const comments = (session.comments || []).filter(entry => hidden(entry, entry.endLine || entry.line)).length;
  const threads = (session.pullRequest?.threads || []).filter(thread => {
    if (thread.outdated || !Number.isSafeInteger(thread.line) || thread.line < 1 || !hidden(thread, thread.line)) return false;
    const source = file[thread.side];
    const lineCount = source ? source.split("\n").length - (source.endsWith("\n") ? 1 : 0) : 0;
    return thread.line <= lineCount;
  }).length;
  return { comments, threads };
}

export function hiddenQuestions(file, session, side, range, changes) {
  const state = { modelState: { collapsedRegions: [{ range }] } };
  // Reuse the gutter's source validation and thread grouping. Count roots,
  // not answers/follow-ups, and never attach stale questions to new code.
  return reviewMarkers(file, session).filter(group => (side === "both" || group.side === side)
    && sourceLineHidden(group.side, group.line, state, changes)).flatMap(group => group.conversations);
}

export function installDeletedAnnotations({ root, diff, monaco, unified }) {
  const old = diff.getOriginalEditor(), current = diff.getModifiedEditor();
  const cards = new Set(), sourceCards = new Set(), badges = new Set(), edgeHosts = new Set(), subscriptions = [];
  const layer = document.createElement("div"); layer.className = "review-unified-overlay"; root.append(layer);
  const numberLayer = document.createElement("div"); numberLayer.setAttribute("aria-hidden", "true"); layer.append(numberLayer);
  const replacedNumbers = new Set();
  let numberSignature = "";
  let frame = null, model = null;
  const schedule = () => { if (frame === null) frame = requestAnimationFrame(layout); };
  function layout() {
    frame = null;
    // Pack only badges that coexist on a source row. Reserve the widest row
    // across the file (not just the viewport), so scrolling cannot shift code.
    const groups = new Map(), badgeOffset = new Map(), changes = diff.getLineChanges();
    for (const badge of badges) {
      const key = badgeDisplayRow(badge, unified(), changes);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(badge);
    }
    let slots = 0;
    for (const group of groups.values()) {
      slots = Math.max(slots, group.length);
      group.sort((a, b) => a.lane - b.lane).forEach((badge, index) => badgeOffset.set(badge, 24 + (group.length - index - 1) * 22));
    }
    // Use Monaco's post-number decoration strip, not an extra outer gutter.
    // Right-align each row's markers so the final marker sits beside its code.
    // Eight pixels before the first marker, four before code. All markers on
    // a row keep their own slots; lone badges must not touch the line number.
    const width = Math.max(10, 10 + slots * 22);
    if (current.getOption(monaco.editor.EditorOption.lineDecorationsWidth) !== width) diff.updateOptions({ lineDecorationsWidth: width });
    const bounds = root.getBoundingClientRect();
    const rendered = new Map();
    for (const zone of root.querySelectorAll(".line-delete-selectable")) {
      if (zone.diffCompassDeletedSource?.model !== model || !zone.getClientRects().length) continue;
      // A scroll event can precede Monaco's DOM translation. Associate the
      // measured row with the rendered scroll offset, not the newer model
      // offset; otherwise a row that gets virtualized next frame leaves its
      // card stranded at the old screen position.
      const lines = zone.closest(".lines-content"), viewport = zone.closest(".monaco-scrollable-element");
      if (!lines || !viewport) continue;
      const renderedScroll = viewport.getBoundingClientRect().top - lines.getBoundingClientRect().top;
      for (const row of zone.querySelectorAll(":scope > [data-review-old-line]")) {
        const line = Number(row.dataset.reviewOldLine), rect = row.getBoundingClientRect();
        if (!rect.height) continue;
        if (!rendered.has(line)) rendered.set(line, { first: rect, last: rect, scroll: renderedScroll });
        else rendered.get(line).last = rect;
      }
    }
    const preceding = new Map(), beforeHeights = new Map();
    for (const card of cards) if (card.placement === "before" && card.model === model) beforeHeights.set(card.line, (beforeHeights.get(card.line) || 0) + card.height);
    // The original editor reserves these slots AFTER its model line so native
    // alignment doesn't also insert them before the entire deletion block.
    // Consequently its number stays above a Before tour banner. Mirror only
    // affected numbers at the renderer's actual source row (including wrap),
    // just as review markers already use that source mapping. Never move a
    // model line or change a click/quotation anchor to fix presentation.
    const originalDom = old.getDomNode(), numberNodes = [...(originalDom?.querySelectorAll(".line-numbers") || [])]
      .filter(node => node.closest(".monaco-editor") === originalDom);
    for (const node of numberNodes) {
      const replace = unified() && beforeHeights.has(Number(node.textContent));
      if (node.classList.contains("review-number-relocated") !== replace) node.classList.toggle("review-number-relocated", replace);
      if (replace) replacedNumbers.add(node); else replacedNumbers.delete(node);
    }
    for (const node of replacedNumbers) if (!node.isConnected) replacedNumbers.delete(node);
    const numbers = document.createDocumentFragment();
    if (unified() && originalDom) {
      const info = old.getLayoutInfo(), font = old.getOption(monaco.editor.EditorOption.fontInfo);
      const left = originalDom.getBoundingClientRect().left - bounds.left + info.lineNumbersLeft;
      for (const line of beforeHeights.keys()) {
        const row = rendered.get(line)?.first;
        if (!row) continue;
        const node = document.createElement("div"); node.className = "review-unified-source-number";
        node.dataset.sourceLine = String(line); node.textContent = String(line);
        const native = numberNodes.find(node => Number(node.textContent) === line) || numberNodes[0];
        node.style.cssText = `top:${row.top - bounds.top}px;left:${left}px;width:${info.lineNumbersWidth}px;height:${row.height}px;line-height:${row.height}px;font-size:${font.fontSize}px;font-weight:${font.fontWeight};color:${native ? getComputedStyle(native).color : "var(--muted)"}`;
        node.style.fontFamily = font.fontFamily;
        numbers.append(node);
      }
    }
    const nextNumbers = [...numbers.children].map(node => `${node.textContent}:${node.style.cssText}`).join(";");
    if (nextNumbers !== numberSignature) { numberSignature = nextNumbers; numberLayer.replaceChildren(numbers); }
    const scroll = current.getScrollTop();
    for (const card of cards) {
      const row = rendered.get(card.line);
      // Native zones briefly have display:none while Monaco replaces them.
      // Hiding our form during that render drops keyboard focus/typed input.
      // Retain its last measured geometry, adjusted for scrolling, until the
      // replacement row is ready. This never changes the saved source anchor.
      const key = `${card.line}:${card.placement || "after"}`;
      const sourceTop = row && (card.placement === "before" ? row.first.top - beforeHeights.get(card.line) : row.last.bottom);
      const top = row ? sourceTop - bounds.top - (scroll - row.scroll) + (preceding.get(key) || 0) : card.top - (scroll - card.scroll);
      card.top = top; card.scroll = scroll;
      preceding.set(key, (preceding.get(key) || 0) + card.height);
      const visible = unified() && card.model === model && top + card.height > 0 && top < bounds.height;
      card.node.hidden = !visible;
      card.node.style.left = "0px"; card.node.style.top = `${top}px`;
      card.node.style.width = `${bounds.width}px`;
    }
    const edgeRows = new Map();
    for (const card of sourceCards) {
      const editorBounds = card.editor.getDomNode()?.getBoundingClientRect();
      if (!editorBounds) continue;
      const rect = card.spacer.getBoundingClientRect(), scroll = card.editor.getScrollTop();
      // Monaco owns the source-relative vertical slot. Keep the real form
      // outside its clipped code viewport so it can also use the gutter.
      // Retain placement during temporary native-zone replacement (e.g. wrap)
      // instead of detaching the form and dropping an active draft's focus.
      const top = rect.height && card.spacer.getClientRects().length ? rect.top - bounds.top : card.top - (scroll - card.scroll);
      card.top = top; card.scroll = scroll;
      const height = card.height();
      const left = unified() ? 0 : editorBounds.left - bounds.left;
      const right = editorBounds.right - bounds.left - card.editor.getLayoutInfo().verticalScrollbarWidth;
      card.node.hidden = !card.isVisible() || top + height <= 0 || top >= bounds.height;
      card.node.style.cssText = `left:${left}px;top:${top}px;width:${Math.max(0, right - left)}px;height:${height}px`;
      if (!card.node.hidden) {
        const style = getComputedStyle(card.node), bottom = bounds.top + top + height;
        const border = Math.min(height, parseFloat(style.borderBottomWidth) || 0);
        if (!edgeRows.has(card.editor)) edgeRows.set(card.editor, []);
        edgeRows.get(card.editor).push(
          { top: bounds.top + top, bottom: bottom - border, color: style.backgroundColor },
          { top: bottom - border, bottom, color: style.borderBottomColor },
        );
      }
    }
    // Paint the reserved strip inside the native viewport, below its scrollbar
    // thumb. Cards keep their existing width and hit targets; only their surface
    // continues to the column edge. Reuse the existing hard-stop row painter.
    for (const editor of [old, current]) {
      const viewport = editor.getDomNode()?.querySelector(":scope > .overflow-guard > .monaco-scrollable-element");
      if (!viewport) continue;
      const rect = viewport.getBoundingClientRect();
      const fill = gutterRowGradient(edgeRows.get(editor) || [], rect.top, rect.height);
      const width = `${editor.getLayoutInfo().verticalScrollbarWidth}px`;
      if (!viewport.classList.contains("review-card-edge-host")) viewport.classList.add("review-card-edge-host");
      if (viewport.style.getPropertyValue("--review-card-edge-fill") !== fill) viewport.style.setProperty("--review-card-edge-fill", fill);
      if (viewport.style.getPropertyValue("--review-card-edge-width") !== width) viewport.style.setProperty("--review-card-edge-width", width);
      edgeHosts.add(viewport);
    }
    for (const badge of badges) {
      const editor = badge.side === "old" ? old : current;
      const visible = editor.getVisibleRanges().some(range => range.startLineNumber <= badge.line && range.endLineNumber >= badge.line);
      const position = visible ? editor.getScrolledVisiblePosition({ lineNumber: badge.line, column: 1 }) : null;
      const row = unified() && badge.side === "old" ? rendered.get(badge.line)?.first : null;
      const top = row ? row.top - bounds.top : position ? editor.getDomNode().getBoundingClientRect().top - bounds.top + position.top : -100000;
      badge.node.hidden = !(row || position) || top < 0 || top + (row?.height || position?.height || 0) > bounds.height;
      const host = unified() ? current : editor;
      const codeLeft = host.getDomNode().getBoundingClientRect().left - bounds.left + host.getLayoutInfo().contentLeft;
      badge.node.style.left = `${codeLeft - badgeOffset.get(badge)}px`; badge.node.style.top = `${top}px`;
    }
  }
  const hook = ({ node, margin, counts, start, lineHeight }) => {
    const relevant = [...cards].filter(card => card.model === model);
    const plan = deletedRowLayout(start, counts, lineHeight, relevant);
    const rows = [...node.querySelectorAll(":scope > .view-line")];
    if (rows.length !== plan.rowTops.length) throw new Error("Unsupported deleted-row renderer");
    let index = 0;
    counts.forEach((count, line) => {
      for (let fragment = 0; fragment < count; fragment++, index++) {
        rows[index].style.top = `${plan.rowTops[index]}px`; rows[index].dataset.reviewOldLine = String(start + line);
      }
    });
    [...margin.querySelectorAll(".delete-sign")].forEach((sign, index) => { sign.style.top = `${plan.rowTops[index]}px`; });
    for (const card of plan.cardTops.keys()) card.wrapLines = counts[card.line - start];
    // Native lightbulb hit-testing assumes equal-height rows. Our existing
    // source-aware context menu remains available on the actual code instead.
    if (plan.extra) margin.classList.add("review-spaced-deletion");
    schedule(); return plan.extra;
  };
  const attach = () => {
    if (model?.diffCompassLayoutDeleted === hook) delete model.diffCompassLayoutDeleted;
    model = old.getModel(); if (model) model.diffCompassLayoutDeleted = hook;
    schedule();
  };
  subscriptions.push(old.onDidChangeModel(attach), diff.onDidUpdateDiff(schedule)); attach();
  for (const editor of [old, current]) subscriptions.push(editor.onDidScrollChange(schedule), editor.onDidLayoutChange(schedule), editor.onDidChangeHiddenAreas(schedule));
  const observer = new MutationObserver(schedule);
  observer.observe(root.querySelector(".monaco-diff-editor"), { childList: true, subtree: true, attributes: true });
  const resize = new ResizeObserver(schedule); resize.observe(root);
  function scrollCard(node, editor) {
    const wheel = event => {
      if (event.ctrlKey || event.metaKey) return;
      for (let element = event.target; element; element = element.parentElement) {
        if (event.deltaY && element.scrollHeight > element.clientHeight && (event.deltaY < 0 ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight)) return;
        if (event.deltaX && element.scrollWidth > element.clientWidth && (event.deltaX < 0 ? element.scrollLeft > 0 : element.scrollLeft + element.clientWidth < element.scrollWidth)) return;
        if (element === node) break;
      }
      const factor = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? root.clientHeight : 1;
      const top = editor.getScrollTop(), left = editor.getScrollLeft();
      editor.setScrollTop(top + event.deltaY * factor);
      editor.setScrollLeft(left + event.deltaX * factor);
      // At the editor's edge, leave ordinary browser scroll chaining intact.
      if (editor.getScrollTop() !== top || editor.getScrollLeft() !== left) event.preventDefault();
    };
    node.addEventListener("wheel", wheel, { passive: false });
    const focus = event => {
      const rect = event.target.getBoundingClientRect(), viewport = root.getBoundingClientRect();
      const delta = rect.bottom > viewport.bottom ? rect.bottom - viewport.bottom + 8 : rect.top < viewport.top ? rect.top - viewport.top - 8 : 0;
      if (delta) editor.setScrollTop(editor.getScrollTop() + delta);
    };
    node.addEventListener("focusin", focus);
    return () => { node.removeEventListener("wheel", wheel); node.removeEventListener("focusin", focus); };
  }
  return {
    addSourceCard(editor, node, spacer, height, isVisible) {
      const card = { editor, node, spacer, height, isVisible, top: -100000, scroll: editor.getScrollTop() };
      sourceCards.add(card); node.classList.add("review-source-card"); node.hidden = true; layer.append(node);
      const unscroll = scrollCard(node, editor); schedule();
      return () => { unscroll(); sourceCards.delete(card); node.remove(); };
    },
    addBadge(node, side, line, lane) {
      const badge = { node, side, line, lane }; badges.add(badge);
      node.classList.add("review-unified-badge"); node.hidden = true; layer.append(node); schedule();
      return () => { badges.delete(badge); node.remove(); };
    },
    addBeforeSpace(line, node, height, ordinal) {
      node.classList.add("review-before-tour-space");
      node.style.height = `${height}px`;
      return this.addCard(line, node, height, null, { placement: "before", ordinal });
    },
    addCard(line, node, height, content, options = {}) {
      const card = { model: old.getModel(), node, line, height, placement: options.placement, top: -100000, scroll: current.getScrollTop(), wrapLines: 1 };
      cards.add(card); node.classList.add("review-before-card"); node.dataset.sourceLine = String(line);
      node.hidden = true; layer.append(node);
      const placeholder = document.createElement("div"); placeholder.setAttribute("aria-hidden", "true");
      // Keep the reservation inside the deletion's original range. The pinned
      // row renderer places Before tour space above the row; native alignment
      // only needs the matching total height (also for the block's first line).
      const descriptor = { afterLineNumber: line, heightInPx: height, ordinal: options.ordinal || 100001, domNode: placeholder,
        onDomNodeTop() { schedule(); } };
      let id; old.changeViewZones(accessor => { id = accessor.addZone(descriptor); });
      const size = new ResizeObserver(() => {
        if (!content || !content.isConnected || !content.getBoundingClientRect().width) return;
        const next = Math.ceil(content.getBoundingClientRect().height) + 18;
        if (card.height === next) return;
        card.height = next; descriptor.heightInPx = next;
        old.changeViewZones(accessor => accessor.layoutZone(id)); schedule();
      });
      if (content) size.observe(content);
      const unscroll = scrollCard(node, current);
      let removed = false;
      const remove = () => {
        if (removed) return; removed = true;
        size.disconnect(); unscroll(); cards.delete(card); node.remove();
        old.changeViewZones(accessor => accessor.removeZone(id)); schedule();
      };
      remove.resize = height => {
        if (removed || height === card.height) return;
        card.height = height; descriptor.heightInPx = height; node.style.height = `${height}px`;
        old.changeViewZones(accessor => accessor.layoutZone(id)); schedule();
      };
      remove.reveal = () => {
        const before = [...cards].slice(0, [...cards].indexOf(card)).filter(c => c.line === line).reduce((sum, c) => sum + c.height, 0);
        current.setScrollTop(Math.max(0, old.getTopForLineNumber(line, true) + card.wrapLines * old.getOption(monaco.editor.EditorOption.lineHeight) + before - 60));
        schedule();
      };
      schedule(); return remove;
    },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect(); resize.disconnect(); subscriptions.forEach(subscription => subscription.dispose());
      if (model?.diffCompassLayoutDeleted === hook) delete model.diffCompassLayoutDeleted;
      for (const node of replacedNumbers) node.classList.remove("review-number-relocated");
      for (const viewport of edgeHosts) {
        viewport.classList.remove("review-card-edge-host");
        viewport.style.removeProperty("--review-card-edge-fill"); viewport.style.removeProperty("--review-card-edge-width");
      }
      layer.remove();
    },
  };
}
