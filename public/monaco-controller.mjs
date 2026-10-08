// One ordered, page-level file list. Each visible text file owns an isolated
// editor; image/fallback cards stay in their original positions in that list.
import { fileChangeCounts, fileStatusLabel } from "./monaco/annotations.mjs";
import { createMobileActions } from "./monaco/mobile-actions.mjs";
import { panReviewScroll } from "./monaco/pen-scroll.mjs";

export function createMonacoRenderer({ container, controls, token, snapshot, render, actions }) {
  const preferenceKey = "diffcompass-diff-renderer";
  let preferred = "current";
  try { if (localStorage.getItem(preferenceKey) === "monaco") preferred = "monaco"; } catch {}
  const label = document.createElement("label"); label.textContent = "Renderer ";
  const select = document.createElement("select"); select.id = "diff-renderer"; select.setAttribute("aria-label", "Diff renderer");
  // Keep the persisted value "current" compatible with existing installations.
  select.add(new Option("Shiki", "current")); select.add(new Option("Monaco", "monaco")); select.value = preferred;
  label.append(select); controls.append(label);
  const region = document.createElement("section"); region.className = "monaco-review-region"; region.hidden = true;
  const notice = document.createElement("p"); notice.className = "monaco-review-notice"; notice.setAttribute("role", "status");
  const comments = document.createElement("button"); comments.type = "button"; comments.className = "text-button"; comments.hidden = true;
  controls.append(comments); container.before(region); region.append(notice);
  let latestFiles = [], active = false, failed = false, mountKey = null, commentsVisible = true, disposed = false;
  const commentPreference = "diffcompass-monaco-inline-comments";
  try { commentsVisible = localStorage.getItem(commentPreference) !== "hidden"; } catch {}
  const entries = new Map(), fallbacks = new Set(), viewStates = new Map();
  const keyOf = session => JSON.stringify([session.comparison.mergeBase, session.comparison.sourceTree, session.comparison.files.map(file => [file.path, file.oldPath, file.newPath, file.status])]);
  const hasDraft = () => mobileActions.hasDraft || [...entries.values()].some(entry => entry.child?.hasDraft());
  const heightLimit = () => Math.max(240, innerHeight - 230);
  const reservedHeight = entry => (entry.height || Math.min(heightLimit(), 400)) + entry.header.offsetHeight + 2;
  const scrollRoot = container.closest("#diff-panel");
  const mobileActions = createMobileActions({ panel: scrollRoot, enabled: () => active && snapshot().activeTab === "diff", notify: actions.notify, onClear: actions.clearSelection });
  let phasePreparation = null, phaseFocusId = null;
  let phaseAnchor = null, phaseAnchorScrollTop = null, tourFocusGeneration = 0;
  let cancelFileScroll = null, cancelTourScroll = null;
  const phaseGeometry = new ResizeObserver(() => {
    if (phasePositionUnchanged() && phaseAnchor.slot.isConnected && owns(phaseAnchor.path) && !snapshot().collapsed.includes(phaseAnchor.path)) {
      revealPreparedEntry(phaseAnchor);
      phaseAnchorScrollTop = scrollRoot.scrollTop;
    }
  });
  function releasePhaseAnchor() { phaseAnchor = null; phaseAnchorScrollTop = null; phaseGeometry.disconnect(); }
  function onUserInteraction() { tourFocusGeneration++; cancelFileScroll?.(); cancelTourScroll?.(); releasePhaseAnchor(); }
  function phasePositionUnchanged() {
    if (!phaseAnchor) return false;
    // Scrollbar/accessibility scrolling and an already-running touchpad
    // gesture need not deliver a new wheel/pointer event to this document.
    // Check the actual position BEFORE a late layout correction can undo it.
    if (Math.abs(scrollRoot.scrollTop - phaseAnchorScrollTop) > 1) {
      onUserInteraction(); return false;
    }
    return true;
  }
  scrollRoot.addEventListener("scroll", phasePositionUnchanged, { passive: true });
  for (const type of ["wheel", "pointerdown", "keydown"]) window.addEventListener(type, onUserInteraction, { capture: true, passive: true });
  const isCurrent = entry => entry.key === keyOf(snapshot().session) && entry.key === mountKey;
  function saveState(entry) {
    if (!entry.child) return;
    if (!viewStates.has(entry.key)) viewStates.set(entry.key, new Map());
    viewStates.get(entry.key).set(entry.path, entry.child.captureViewState());
    if (viewStates.size > 3) viewStates.delete(viewStates.keys().next().value);
  }
  function closeEntry(entry) {
    mobileActions.clearPath(entry.path);
    entry.generation++; clearTimeout(entry.timer); entry.settle?.(null); entry.settle = null;
    entry.paintSettle?.(false); entry.paintSettle = null;
    // Reserve flow space BEFORE removing the iframe. Measuring the header
    // after removal forces a layout with a briefly shorter page, clamping
    // scrollTop near the bottom and making downward scrolling jump upward.
    entry.slot.style.minHeight = snapshot().collapsed.includes(entry.path) ? "44px" : reservedHeight(entry) + "px";
    saveState(entry); entry.child?.dispose(); entry.child = null;
    entry.frame?.remove(); entry.frame = null; entry.host = null;
    actions.viewportChanged();
  }
  function closeAll() { for (const entry of entries.values()) closeEntry(entry); }
  function commentControls() {
    container.classList.toggle("comments-hidden", !commentsVisible);
    comments.textContent = commentsVisible ? "Hide comments" : "Show comments";
    comments.setAttribute("aria-pressed", String(commentsVisible)); comments.disabled = hasDraft();
    comments.title = "Show or hide local comments and pull request threads; gutter markers remain available";
  }
  function setCommentsVisible(visible) {
    if (!visible && hasDraft()) return false;
    commentsVisible = visible;
    try { localStorage.setItem(commentPreference, visible ? "shown" : "hidden"); } catch {}
    commentControls();
    for (const entry of entries.values()) {
      if (entry.child && entry.child.commentVisibilityState().visible !== visible) entry.child.setCommentsVisible(visible);
    }
    actions.viewportChanged();
    return true;
  }
  function updateHeader(entry) {
    const current = entry.preparing || snapshot(), collapsed = current.collapsed.includes(entry.path);
    const reviewed = current.session.reviewedFiles.includes(entry.path);
    const counts = fileChangeCounts(entry.file);
    const totals = document.createElement("span"); totals.className = "monaco-file-counts";
    if (counts) {
      for (const [className, text] of [["plus", counts.added], ["minus", counts.removed]]) {
        const value = document.createElement("span"); value.className = className; value.textContent = text; totals.append(value);
      }
      totals.setAttribute("aria-label", counts.label);
    }
    const badge = document.createElement("span"); badge.className = "monaco-file-status"; badge.textContent = fileStatusLabel(entry.file.status);
    entry.toggle.replaceChildren(document.createTextNode(collapsed ? "▸ " : "▾ "), totals, badge, document.createTextNode(entry.path));
    entry.toggle.setAttribute("aria-expanded", String(!collapsed));
    entry.toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${entry.path}`);
    entry.review.textContent = entry.reviewPending ? "Saving…" : reviewed ? "✓ Reviewed" : "Mark as reviewed";
    entry.review.setAttribute("aria-pressed", String(reviewed));
    entry.review.disabled = entry.reviewPending || current.session.status !== "open";
    if (collapsed) entry.slot.style.minHeight = "44px";
    else if (!entry.frame) entry.slot.style.minHeight = reservedHeight(entry) + "px";
  }
  function makeEntry(file) {
    const slot = document.createElement("section"); slot.className = "monaco-file-slot"; slot.dataset.path = file.path;
    // The actual header belongs to the outer scroll container, not the iframe.
    // It stays sticky and usable even while its editor is loading or evicted.
    const header = document.createElement("header"); header.className = "monaco-file-header";
    const toggle = document.createElement("button"), review = document.createElement("button");
    toggle.type = review.type = "button";
    const entry = { path: file.path, file, slot, header, toggle, review, generation: 0, visible: false, height: null };
    toggle.onclick = () => {
      if (entry.child?.hasDraft()) return actions.notify("Save or cancel the open draft before collapsing this file.");
      actions.setCollapsed(file.path, !snapshot().collapsed.includes(file.path));
    };
    review.onclick = async () => {
      if (entry.reviewPending) return;
      if (entry.child?.hasDraft()) return actions.notify("Save or cancel the open draft before marking this file reviewed.");
      entry.reviewPending = true; updateHeader(entry);
      try { await actions.review(file.path, !snapshot().session.reviewedFiles.includes(file.path)); }
      finally { entry.reviewPending = false; updateHeader(entry); }
    };
    header.append(toggle, review); slot.append(header); entries.set(file.path, entry);
    updateHeader(entry); visibility.observe(slot); return entry;
  }
  function supports(file, current) {
    return file && !fallbacks.has(file.path) && !/\.png$/i.test(file.path)
      && !file.metadata?.some(line => /^(Binary files |GIT binary patch)/.test(line));
  }
  function owns(path) {
    return active && Boolean(supports(latestFiles.find(file => file.path === path), snapshot()));
  }
  function syncEntry(entry) {
    if (!entry.child || !isCurrent(entry)) return;
    entry.child.sync({ ...(entry.preparing || snapshot()), paths: [entry.path] });
  }
  async function mount(entry) {
    if (disposed || (!owns(entry.path) && !entry.preparing) || !entry.slot.isConnected) return null;
    if (entry.child) return entry.child;
    if (entry.frame) return entry.ready;
    const ticket = ++entry.generation;
    entry.key = mountKey;
    entry.ready = new Promise(resolve => { entry.settle = resolve; });
    entry.paint = new Promise(resolve => { entry.paintSettle = resolve; });
    const frame = document.createElement("iframe"); entry.frame = frame;
    frame.title = "Monaco review: " + entry.path; frame.className = "monaco-review-frame"; frame.dataset.monacoPath = entry.path;
    frame.style.height = (entry.height || Math.min(heightLimit(), 400)) + "px";
    const valid = () => entry.generation === ticket && entry.frame === frame;
    const mobileItem = item => ({
      ...item,
      valid: () => valid() && isCurrent(entry) && owns(entry.path) && item.valid(),
      retain() {
        const hold = {}; (entry.navigationHolds ||= new Set()).add(hold);
        return () => {
          entry.navigationHolds.delete(hold);
          queueMicrotask(() => {
            if (valid() && !entry.visible && !entry.preparing && !entry.targeted && !entry.navigationHolds.size && !entry.child?.hasDraft()) closeEntry(entry);
          });
        };
      },
    });
    const fail = message => {
      if (!valid()) return;
      failed = true; closeAll(); notice.textContent = message + " The Shiki renderer is available."; render();
    };
    entry.host = {
      ...actions,
      singleFile: true,
      retainViewport() { actions.reserveScroll(scrollRoot.scrollTop); },
      userInteraction: onUserInteraction,
      holdPenScroll() {
        if (!valid()) return;
        onUserInteraction();
        const hold = {}; (entry.navigationHolds ||= new Set()).add(hold);
        return () => {
          entry.navigationHolds.delete(hold);
          // Release after pointerup/tap dispatch has finished. Never evict the
          // iframe holding pointer capture in the middle of a drag.
          queueMicrotask(() => {
            if (valid() && !entry.preparing && !entry.visible && !entry.targeted && !entry.navigationHolds.size && !entry.child?.hasDraft()) closeEntry(entry);
          });
        };
      },
      panBy(deltaY) {
        if (valid()) panReviewScroll(scrollRoot, deltaY, matchMedia("(max-width: 900px)").matches ? document.scrollingElement : null);
      },
      select(anchor) { if (valid() && isCurrent(entry)) actions.select(anchor); },
      mobileSelect(item, pointerType) { if (valid() && isCurrent(entry)) mobileActions.select(mobileItem(item), pointerType); },
      clearMobileSelection() { mobileActions.clearPath(entry.path); },
      revealMobile(side, line, endLine) { return controller.reveal(entry.path, side, line, endLine); },
      ask(anchor) {
        if (!valid() || !isCurrent(entry)) return actions.notify("The source changed. Finish or cancel the retained draft before selecting new code.");
        actions.ask(anchor);
      },
      setCollapsed(path, collapsed) { if (valid() && isCurrent(entry)) actions.setCollapsed(path, collapsed); },
      acceptComparison(session) { return valid() && isCurrent(entry) && keyOf(session) === entry.key; },
      failed: fail,
      ready(child) {
        if (!valid()) { child.dispose(); return; }
        clearTimeout(entry.timer); entry.child = child;
        child.restoreViewState(viewStates.get(entry.key)?.get(entry.path));
        child.setCommentsVisible(commentsVisible);
        entry.slot.style.minHeight = "0px";
        syncEntry(entry); entry.settle?.(child); entry.settle = null;
        actions.viewportChanged();
      },
      commentsChanged(status) {
        // A newly loading editor must inherit the shared setting, not replace
        // it with its own initial preference before ready() synchronizes it.
        if (!valid() || !entry.child) return;
        if (commentsVisible !== status.visible) setCommentsVisible(status.visible);
        else commentControls();
        // Saving/cancelling a retained draft may unblock a newer comparison.
        queueMicrotask(sync);
      },
      contentSizeChanged(height) {
        if (!valid() || !Number.isFinite(height) || height <= 0) return;
        actions.viewportChanged();
        const nextHeight = Math.ceil(height) + 2;
        entry.paintSettle?.(true); entry.paintSettle = null;
        if (entry.height === nextHeight) return;
        // Only an individual editor can have a bounded viewport. There is no
        // second scrolling file list, nor a viewport-height cap on the card.
        const before = entry.slot.getBoundingClientRect();
        const readingTop = scrollRoot.getBoundingClientRect().top + (parseFloat(getComputedStyle(scrollRoot).getPropertyValue("--diff-toolbar-height")) || 0);
        entry.height = nextHeight; frame.style.height = entry.height + "px";
        // First-time measurements or changed wrapping above the reading area
        // must not move the visible content. Native anchoring is disabled on
        // this panel, so compensate only for cards wholly above that area.
        const delta = entry.slot.getBoundingClientRect().height - before.height;
        if (!entry.preparing && before.bottom <= readingTop && delta) {
          const anchored = phasePositionUnchanged();
          scrollRoot.scrollTop += delta;
          if (anchored) phaseAnchorScrollTop = scrollRoot.scrollTop;
        }
      },
      editorHeightLimit: heightLimit,
      fallback(path) { if (hasDraft()) return; fallbacks.add(path); render(); },
    };
    frame.src = "/monaco/index.html?embedded=1&production=1&file=" + encodeURIComponent(entry.path) + "#token=" + encodeURIComponent(token);
    entry.slot.style.minHeight = "0px"; entry.slot.append(frame);
    entry.timer = setTimeout(() => fail("Monaco did not finish loading."), 20_000);
    return entry.ready;
  }
  const visibility = new IntersectionObserver(events => {
    for (const event of events) {
      const entry = entries.get(event.target.dataset.path);
      if (!entry) continue;
      if (entry.preparing) continue;
      entry.visible = event.isIntersecting;
      if (entry.visible && owns(entry.path) && !snapshot().collapsed.includes(entry.path)) void mount(entry);
      else if (!entry.child?.hasDraft() && !entry.targeted && !entry.navigationHolds?.size) closeEntry(entry);
    }
  }, { root: container.closest("#diff-panel"), rootMargin: "200px" });
  function sync() {
    mobileActions.update();
    if (!active || disposed) return;
    if (phasePreparation) return;
    const key = keyOf(snapshot().session);
    if (key !== mountKey) {
      if (hasDraft()) {
        notice.textContent = "The comparison changed. Your draft is retained with the previous source; copy or cancel it to load the new comparison. Saving stale source is blocked.";
        return;
      }
      closeAll(); mountKey = key; fallbacks.clear();
    }
    for (const entry of entries.values()) {
      updateHeader(entry);
      if (!owns(entry.path)) { if (!entry.child?.hasDraft()) closeEntry(entry); continue; }
      if (snapshot().collapsed.includes(entry.path) && !entry.child?.hasDraft() && !entry.targeted) {
        closeEntry(entry); continue;
      }
      syncEntry(entry);
      if (entry.visible && !snapshot().collapsed.includes(entry.path)) void mount(entry);
    }
    commentControls();
  }
  // Each iframe resolves a scoped host; no last-mounted-file global callbacks.
  const host = {
    ...actions,
    forFile(path) { return entries.get(path)?.host; },
    failed(message, path) { entries.get(path)?.host?.failed(message); },
  };
  window.diffCompassProductionHost = host;
  comments.onclick = () => {
    setCommentsVisible(!commentsVisible);
  };
  select.onchange = () => {
    if (hasDraft()) { select.value = preferred; actions.notify("Save or cancel the Monaco draft before changing renderer."); return; }
    cancelPhase();
    preferred = select.value; failed = false;
    try { localStorage.setItem(preferenceKey, preferred); } catch {}
    if (preferred === "current") closeAll();
    render();
  };
  const theme = new MutationObserver(sync);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-syntax-theme"] });
  const stageWidth = () => {
    const style = getComputedStyle(container);
    return container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  };
  function revealPreparedEntry(entry) {
    const toolbarHeight = parseFloat(getComputedStyle(scrollRoot).getPropertyValue("--diff-toolbar-height")) || 0;
    const step = snapshot().step;
    const target = step?.anchor.path === entry.path && entry.child?.tourTarget(step);
    const destination = target ? entry.frame.getBoundingClientRect().top + target.top - entry.header.offsetHeight : entry.slot.getBoundingClientRect().top;
    const top = Math.max(0, scrollRoot.scrollTop + destination - scrollRoot.getBoundingClientRect().top - toolbarHeight - 12);
    // A short final file also needs room below it, otherwise the browser
    // clamps this reveal and briefly exposes unprepared files above it.
    if (Math.abs(top - scrollRoot.scrollTop) > 1) {
      actions.reserveScroll(top);
      scrollRoot.scrollTo({ top, behavior: "instant" });
    }
    if (phaseAnchor) phaseAnchorScrollTop = scrollRoot.scrollTop;
  }
  function cancelPhase() {
    const pending = phasePreparation; phasePreparation = null;
    if (!pending) return;
    for (const entry of pending.staged) {
      closeEntry(entry); entry.preparing = null;
      entry.slot.remove(); entry.slot.classList.remove("monaco-phase-staging"); entry.slot.style.width = "";
      entry.slot.inert = false; entry.slot.removeAttribute("aria-hidden");
    }
    for (const entry of pending.held) entry.targeted = false;
  }
  const resize = () => { for (const entry of entries.values()) { if (entry.preparing) entry.slot.style.width = stageWidth() + "px"; entry.child?.resize(); } };
  window.addEventListener("resize", resize);
  async function revealFile(path) {
    cancelFileScroll?.(); cancelTourScroll?.(); releasePhaseAnchor();
    if (!active || !latestFiles.some(file => file.path === path)) return false;
    const generation = ++tourFocusGeneration, hold = {}, warmed = [];
    actions.expand(path); sync();
    const bounds = scrollRoot.getBoundingClientRect();
    const slots = latestFiles.map(file => container.querySelector(`:scope > [data-path="${CSS.escape(file.path)}"]`));
    const target = latestFiles.findIndex(file => file.path === path);
    const visible = slots.flatMap((slot, index) => {
      const rect = slot?.getBoundingClientRect();
      return rect && rect.bottom > bounds.top && rect.top < bounds.bottom ? [index] : [];
    });
    const start = Math.min(target, ...visible), end = Math.max(target, ...visible);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Warm short journeys before moving, but never instantiate an entire
    // large PR just because the reviewer selected a distant file.
    const corridor = latestFiles.filter((file, index) => reduced ? index === target : end - start <= 12
      ? index >= start && index <= end : visible.includes(index) || Math.abs(index - target) <= 2);
    try {
      await Promise.all(corridor.filter(file => owns(file.path) && !snapshot().collapsed.includes(file.path)).map(async file => {
        const entry = entries.get(file.path);
        (entry.navigationHolds ||= new Set()).add(hold); warmed.push(entry);
        if (await mount(entry)) await entry.paint;
      }));
      const slot = container.querySelector(`:scope > [data-path="${CSS.escape(path)}"]`);
      if (!active || !slot || generation !== tourFocusGeneration) return false;
      const toolbarHeight = parseFloat(getComputedStyle(scrollRoot).getPropertyValue("--diff-toolbar-height")) || 0;
      const top = Math.max(0, Math.min(scrollRoot.scrollHeight - scrollRoot.clientHeight,
        scrollRoot.scrollTop + slot.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top - toolbarHeight - 12));
      if (reduced || Math.abs(top - scrollRoot.scrollTop) < 1) {
        scrollRoot.scrollTo({ top, behavior: "instant" }); return true;
      }
      return await new Promise(resolve => {
        let frame, timer;
        const finish = completed => {
          cancelAnimationFrame(frame); clearTimeout(timer); cancelFileScroll = null;
          if (!completed) scrollRoot.scrollTo({ top: scrollRoot.scrollTop, behavior: "instant" });
          resolve(completed);
        };
        cancelFileScroll = () => finish(false);
        const settled = () => {
          if (Math.abs(scrollRoot.scrollTop - top) < 1) finish(true);
          else frame = requestAnimationFrame(settled);
        };
        timer = setTimeout(() => finish(false), 2000);
        scrollRoot.scrollTo({ top, behavior: "smooth" }); frame = requestAnimationFrame(settled);
      });
    } finally {
      for (const entry of warmed) {
        entry.navigationHolds.delete(hold);
        if (!entry.preparing && !entry.visible && !entry.targeted && !entry.navigationHolds.size && !entry.child?.hasDraft()) {
          const rect = entry.slot.getBoundingClientRect(), viewport = scrollRoot.getBoundingClientRect();
          if (rect.bottom < viewport.top - 200 || rect.top > viewport.bottom + 200) closeEntry(entry);
        }
      }
    }
  }
  const controller = {
    owns, sync, hasDraft, setCommentsVisible,
    updateMobileActions: mobileActions.update,
    cancelPhase,
    async preparePhase(session) {
      cancelPhase();
      releasePhaseAnchor();
      const current = snapshot(), step = session.outline?.phases.flatMap(phase => phase.steps)[session.currentStepIndex];
      if (!active || hasDraft() || !step || current.steps.some(stop => stop.id === step.id) || keyOf(session) !== mountKey) return false;
      const phase = session.outline.phases.find(phase => phase.steps.some(stop => stop.id === step.id));
      const paths = new Set(phase.fileChanges.map(file => file.path));
      const files = session.comparison.files.filter(file => paths.has(file.path));
      const next = { ...current, session, step, steps: phase.steps, collapsed: current.collapsed.filter(path => path !== step.anchor.path) };
      const targetIndex = files.findIndex(file => file.path === step.anchor.path);
      if (targetIndex < 0 || !supports(files[targetIndex], next)) return false;
      const pending = { staged: [], held: new Set(), stepId: step.id }; phasePreparation = pending;
      // Prepare only the destination viewport, not every source in a phase.
      // Staged slots already occupy their final DOM order, but not flow space:
      // reparenting a ready iframe would reset its browsing context.
      let height = 0;
      for (const file of files.slice(targetIndex)) {
        if (phasePreparation !== pending || disposed) return false;
        if (!supports(file, next)) { height += 300; continue; }
        const entry = entries.get(file.path) || makeEntry(file);
        entry.targeted = true; pending.held.add(entry);
        if (!entry.slot.isConnected) {
          entry.file = file; entry.preparing = next; pending.staged.push(entry);
          entry.slot.classList.add("monaco-phase-staging"); entry.slot.style.width = stageWidth() + "px";
          entry.slot.inert = true; entry.slot.setAttribute("aria-hidden", "true");
          const order = session.comparison.files.map(file => file.path), index = order.indexOf(file.path);
          const following = [...container.children].find(node => order.indexOf(node.dataset.path) > index);
          container.insertBefore(entry.slot, following || null);
          updateHeader(entry);
        }
        if (!next.collapsed.includes(file.path)) {
          const child = await mount(entry);
          if (!child || !await entry.paint) { if (phasePreparation === pending) cancelPhase(); return false; }
          if (file.path === step.anchor.path) await child.focusTour(step);
        }
        height += entry.slot.getBoundingClientRect().height;
        if (height >= scrollRoot.clientHeight + 200) break;
      }
      return phasePreparation === pending;
    },
    isStepVisible(step) {
      const entry = entries.get(step.anchor.path);
      if (!owns(step.anchor.path) || !entry?.frame?.isConnected || !entry.child || snapshot().collapsed.includes(entry.path)) return false;
      const frame = entry.frame.getBoundingClientRect(), panel = scrollRoot.getBoundingClientRect();
      const toolbar = scrollRoot.querySelector(".diff-toolbar").getBoundingClientRect();
      const header = entry.header.getBoundingClientRect();
      const top = Math.max(0, panel.top, toolbar.bottom, header.bottom, frame.top);
      const bottom = Math.min(innerHeight, panel.bottom, frame.bottom);
      return bottom > top && entry.child.tourGeometry(step).some(rect =>
        frame.top + rect.bottom > top + 4 && frame.top + rect.top < bottom - 4);
    },
    get active() { return active; },
    render(files, { proposalActivityId = null } = {}) {
      latestFiles = files; active = preferred === "monaco" && !proposalActivityId && !failed;
      region.hidden = preferred !== "monaco"; comments.hidden = files.length === 0;
      commentControls();
      if (!active) { cancelFileScroll?.(); cancelPhase(); releasePhaseAnchor(); closeAll(); if (proposalActivityId) notice.textContent = "Suggested edit previews use the Shiki renderer."; return files; }
      notice.textContent = "Monaco preview · Images, unsupported files and full proposal previews keep their existing renderer.";
      if (!mountKey) mountKey = keyOf(snapshot().session);
      for (const file of files) if (owns(file.path)) { const entry = entries.get(file.path) || makeEntry(file); entry.file = file; }
      sync();
      return files.filter(file => !owns(file.path));
    },
    commit(html) {
      if (!active) return false;
      if (phasePreparation && snapshot().step?.id !== phasePreparation.stepId) cancelPhase();
      const template = document.createElement("template"); template.innerHTML = html;
      const native = new Map([...template.content.children].map(node => [node.dataset.path, node]));
      const ordered = latestFiles.map(file => owns(file.path) ? entries.get(file.path).slot : native.get(file.path)).filter(Boolean);
      const retained = new Set(ordered);
      for (const node of [...container.children]) if (!retained.has(node)) node.remove();
      // Do not detach/reappend live iframes on a review update: moving one
      // resets its browsing context and destroys selection, models and drafts.
      let cursor = container.firstChild;
      for (const node of ordered) {
        if (node !== cursor) container.insertBefore(node, cursor);
        cursor = node.nextSibling;
      }
      if (phasePreparation) {
        const pending = phasePreparation; phasePreparation = null;
        actions.expand(snapshot().step.anchor.path);
        for (const entry of pending.staged) {
          entry.preparing = null; entry.slot.classList.remove("monaco-phase-staging"); entry.slot.style.width = "";
          entry.slot.inert = false; entry.slot.removeAttribute("aria-hidden");
        }
        phaseFocusId = pending.stepId;
        // The new phase is a different list. Reveal its ready destination in
        // this same paint; don't animate through unrelated loading cards.
        const target = entries.get(snapshot().step?.anchor.path);
        if (target) {
          revealPreparedEntry(target); phaseAnchor = target; phaseAnchorScrollTop = scrollRoot.scrollTop;
          // Native image cards and lazily measured files above the target may
          // settle after the swap. Keep the reading position until the next
          // user gesture, including gestures forwarded from inside an iframe.
          for (const node of ordered) phaseGeometry.observe(node);
          phaseGeometry.observe(scrollRoot);
        }
        requestAnimationFrame(() => { for (const entry of pending.held) entry.targeted = false; });
      }
      sync(); return true;
    },
    deactivate() { releasePhaseAnchor(); cancelPhase(); active = false; closeAll(); region.hidden = true; comments.hidden = true; },
    async reveal(path, side, line, endLine = line) {
      if (line === undefined) return revealFile(path);
      cancelFileScroll?.();
      releasePhaseAnchor();
      if (!owns(path)) return false;
      const focusGeneration = ++tourFocusGeneration;
      actions.expand(path); sync(); const entry = entries.get(path);
      const hold = {}; (entry.navigationHolds ||= new Set()).add(hold);
      entry.slot.scrollIntoView({ block: "start" });
      try {
        const child = await mount(entry);
        if (!child || !await entry.paint || !owns(path) || focusGeneration !== tourFocusGeneration) return false;
        const shown = await child.reveal(path, side, line, endLine);
        if (shown) {
          // A full-height editor cannot scroll internally. Wait for expanding
          // context to settle, then reveal the source row in the outer page,
          // not merely its file header (which can be thousands of pixels away).
          let previous = "", stable = 0, geometry;
          for (let frame = 0; frame < 16 && stable < 2; frame++) {
            await new Promise(requestAnimationFrame);
            if (!owns(path) || focusGeneration !== tourFocusGeneration || entry.child !== child) return false;
            geometry = child.geometry(path, side, line);
            const value = JSON.stringify([entry.height, geometry]);
            stable = geometry && value === previous ? stable + 1 : 0; previous = value;
          }
          if (geometry) {
            const toolbar = parseFloat(getComputedStyle(scrollRoot).getPropertyValue("--diff-toolbar-height")) || 0;
            const offset = toolbar + entry.header.offsetHeight + Math.max(12, (scrollRoot.clientHeight - toolbar - entry.header.offsetHeight) / 3);
            scrollRoot.scrollTo({ top: Math.max(0, scrollRoot.scrollTop + entry.frame.getBoundingClientRect().top + geometry.top - scrollRoot.getBoundingClientRect().top - offset), behavior: "instant" });
          } else entry.slot.scrollIntoView({ block: "start", behavior: "instant" });
        }
        return shown;
      } finally {
        entry.navigationHolds.delete(hold);
        if (!entry.visible && !entry.targeted && !entry.navigationHolds.size && !entry.child?.hasDraft()) {
          const rect = entry.slot.getBoundingClientRect(), viewport = scrollRoot.getBoundingClientRect();
          if (rect.bottom < viewport.top - 200 || rect.top > viewport.bottom + 200) closeEntry(entry);
        }
      }
    },
    async focusTour(step) {
      cancelFileScroll?.(); cancelTourScroll?.();
      const path = step.anchor.path;
      if (!owns(path) || hasDraft()) return false;
      actions.expand(path); sync(); const entry = entries.get(path); entry.targeted = true;
      const focusGeneration = ++tourFocusGeneration;
      const hold = {}, warmed = [];
      try {
        // A smooth scroll must not travel through editors still showing their
        // initial blank/full-context layout. Warm a bounded travel corridor;
        // longer jumps reveal directly instead of loading an entire phase.
        const bounds = scrollRoot.getBoundingClientRect();
        const visible = latestFiles.map((file, index) => {
          const node = [...container.children].find(node => node.dataset.path === file.path);
          const rect = node?.getBoundingClientRect();
          return rect && rect.bottom > bounds.top && rect.top < bounds.bottom ? index : -1;
        }).filter(index => index >= 0);
        const targetIndex = latestFiles.findIndex(file => file.path === path);
        const start = Math.min(targetIndex, ...visible), end = Math.max(targetIndex, ...visible);
        const direct = phaseFocusId === step.id || end - start > 12 || matchMedia("(prefers-reduced-motion: reduce)").matches;
        const corridor = direct ? [latestFiles[targetIndex]] : latestFiles.slice(start, end + 1);
        // A stop near a file's end reveals following files too. Warm that
        // destination viewport before scrolling, not only the files between
        // the starting viewport and the target's file header.
        let followingHeight = 0;
        for (let index = targetIndex + 1; index < latestFiles.length && followingHeight < scrollRoot.clientHeight; index++) {
          const file = latestFiles[index];
          if (!corridor.includes(file)) corridor.push(file);
          const slot = container.querySelector(`:scope > [data-path="${CSS.escape(file.path)}"]`);
          followingHeight += slot?.getBoundingClientRect().height || 400;
        }
        await Promise.all(corridor.filter(file => owns(file.path) && !snapshot().collapsed.includes(file.path)).map(async file => {
          const candidate = entries.get(file.path);
          (candidate.navigationHolds ||= new Set()).add(hold); warmed.push(candidate);
          await mount(candidate); await candidate.paint;
        }));
        if (focusGeneration !== tourFocusGeneration || snapshot().step?.id !== step.id || !owns(path) || hasDraft()) return false;
        const child = await mount(entry);
        if (!child || !owns(path) || hasDraft()) return false;
        const focused = await child.focusTour(step);
        if (focused && focusGeneration === tourFocusGeneration && snapshot().step?.id === step.id && !hasDraft()) {
          const target = child.tourTarget(step);
          if (phaseFocusId === step.id && !target) revealPreparedEntry(entry);
          else {
            let finish;
            const settled = new Promise(resolve => { finish = resolve; });
            scrollRoot.addEventListener("scrollend", finish, { once: true });
            const timer = setTimeout(finish, 1200);
            // Invalidating a pending focus is not enough once the browser has
            // started native smooth scrolling. Wheel/pen/keyboard input must
            // stop that animation as well, not fight its remaining frames.
            const cancel = () => {
              scrollRoot.scrollTo({ top: scrollRoot.scrollTop, behavior: "instant" });
              finish();
              if (cancelTourScroll === cancel) cancelTourScroll = null;
            };
            if (!direct) cancelTourScroll = cancel;
            if (target) {
              const toolbar = parseFloat(getComputedStyle(scrollRoot).getPropertyValue("--diff-toolbar-height")) || 0;
              const top = Math.max(0, scrollRoot.scrollTop + entry.frame.getBoundingClientRect().top + target.top - scrollRoot.getBoundingClientRect().top - toolbar - entry.header.offsetHeight - 12);
              actions.reserveScroll(top);
              scrollRoot.scrollTo({ top, behavior: direct ? "instant" : "smooth" });
              if (phaseAnchor) phaseAnchorScrollTop = scrollRoot.scrollTop;
            } else entry.slot.scrollIntoView({ block: "start", behavior: direct ? "instant" : "smooth" });
            if (!direct) await settled;
            clearTimeout(timer); scrollRoot.removeEventListener("scrollend", finish);
            if (cancelTourScroll === cancel) cancelTourScroll = null;
          }
          phaseFocusId = null;
        }
        return focused;
      } finally {
        entry.targeted = false;
        for (const candidate of warmed) {
          candidate.navigationHolds.delete(hold);
          if (!candidate.preparing && !candidate.visible && !candidate.targeted && !candidate.navigationHolds.size && !candidate.child?.hasDraft()) {
            const rect = candidate.slot.getBoundingClientRect(), viewport = scrollRoot.getBoundingClientRect();
            if (rect.bottom < viewport.top - 200 || rect.top > viewport.bottom + 200) closeEntry(candidate);
          }
        }
      }
    },
    async editComment(comment) {
      if (!await this.reveal(comment.path, comment.side, comment.line, comment.endLine || comment.line)) return false;
      await entries.get(comment.path)?.child?.editComment(comment); return true;
    },
    dispose() {
      if (disposed) return; disposed = true; cancelFileScroll?.(); cancelTourScroll?.(); releasePhaseAnchor(); cancelPhase(); closeAll(); visibility.disconnect(); theme.disconnect(); window.removeEventListener("resize", resize);
      mobileActions.dispose();
      for (const type of ["wheel", "pointerdown", "keydown"]) window.removeEventListener(type, onUserInteraction, true);
      scrollRoot.removeEventListener("scroll", phasePositionUnchanged);
      region.remove(); label.remove(); comments.remove();
      container.classList.remove("comments-hidden");
      if (window.diffCompassProductionHost === host) delete window.diffCompassProductionHost;
    },
  };
  window.addEventListener("pagehide", () => controller.dispose(), { once: true });
  return controller;
}
