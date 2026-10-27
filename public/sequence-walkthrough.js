// Read-only sequence excerpts. The host owns identities, evidence and navigation;
// mountPreview is the embedding boundary for a future shared editor host.
(function (root) {
  function selectionController(ids, effects) {
    const allowed = new Set(ids);
    let selected = null;
    return {
      get selected() { return selected; },
      clear() { if (selected !== null) { selected = null; effects.mark(null); } },
      select(id, origin) {
        if (!allowed.has(id)) return false;
        const fromDiagram = origin === 'diagram' || origin === 'route';
        // Reject unavailable/off-route targets before changing the local
        // selection. A code click must never replace an active path with a pin.
        if (!fromDiagram && effects.selectDiagram(id) === false) return false;
        if (id === selected) {
          if (origin === 'keyboard' || origin === 'diagram-click') {
            // The renderer clears its pin on an outside click in capture
            // phase. Re-activating the selected code heading must restore it.
            effects.reveal(id);
          }
          return false;
        }
        selected = id;
        effects.mark(id);
        // The diagram observer echoes programmatic selection asynchronously.
        // Equality above absorbs that echo without another reveal.
        if (fromDiagram || origin === 'diagram-click' || origin === 'keyboard') effects.reveal(id);
        return true;
      },
    };
  }

  // Read the renderer's exact current edge, never infer a message from a
  // caption or participant pair (both can repeat, including self/return calls).
  function routeMessage(svg, steps) {
    const current = [...svg.querySelectorAll('[data-edge-from][data-edge-to][data-route-journey-current]')];
    if (!current.length) return null;
    const ids = current.map(edge => {
      const id = edge.getAttribute('data-edge-id');
      return steps.some(step => step.id === id && step.from === edge.getAttribute('data-edge-from') && step.to === edge.getAttribute('data-edge-to')) ? id : null;
    });
    return ids[0] && ids.every(id => id === ids[0]) ? ids[0] : null;
  }

  // Reuse the chosen route's exact edge/order. Participant names and captions
  // cannot identify a hop, especially with returns or repeated participants.
  function routeStep(svg, steps, result, id) {
    const step = steps.find(step => step.id === id);
    if (!step || !result || !Number.isInteger(result.hops) || result.hops < 1 || !Array.isArray(result.nodes) || result.nodes.length !== result.hops + 1) return null;
    const edges = [...svg.querySelectorAll('[data-edge-id][data-route-step]')].filter(edge => edge.getAttribute('data-edge-id') === id);
    if (!edges.length) return null;
    const indices = edges.map(edge => {
      const raw = edge.getAttribute('data-route-step');
      const index = /^\d+$/.test(raw) ? Number(raw) : -1;
      return index >= 0 && index < result.hops && result.nodes[index] === step.from && result.nodes[index + 1] === step.to && edge.getAttribute('data-edge-from') === step.from && edge.getAttribute('data-edge-to') === step.to ? index + 1 : null;
    });
    return indices[0] && indices.every(index => index === indices[0]) ? indices[0] : null;
  }

  function selectMessage(svg, steps, archify, id) {
    const route = archify.routeProbe;
    if (route?.active?.()) {
      const index = routeStep(svg, steps, route.result?.(), id);
      if (index === null || typeof route.selectJourneyIndex !== 'function') return false;
      // Native explicit journey navigation pauses playback and preserves the
      // chosen route. The existing embed adapter preserves its camera.
      return route.selectJourneyIndex(index) === true;
    }
    if (archify.focus.relationship()?.id !== id) archify.focus.inspectRelationshipById(id, { toggle: false, updateUrl: false });
    return true;
  }

  function routeEmphasis(svg, steps) {
    const id = svg.hasAttribute('data-route-journey') ? routeMessage(svg, steps) : null;
    const step = steps.find(step => step.id === id);
    // Some renderers split one message into several SVG fragments. Project
    // only the validated current identity; never give each fragment a hop.
    svg.querySelectorAll('[data-edge-from][data-edge-to]').forEach(edge => {
      if (step && edge.getAttribute('data-edge-id') === id && edge.getAttribute('data-edge-from') === step.from && edge.getAttribute('data-edge-to') === step.to) edge.setAttribute('data-sequence-route-current', '');
      else edge.removeAttribute('data-sequence-route-current');
    });
  }

  // Reuse the source-action bridge, one request at a time. This does not
  // select a message or turn a current-workspace candidate into saved evidence.
  function preloadDefinitions(steps, bridge) {
    const attempted = new Set();
    let stopped = false, scheduled = false;
    function pump() {
      if (scheduled || stopped || bridge.offline) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (stopped || bridge.offline || bridge.busy() || !bridge.ready()) return;
        const step = steps.slice(0, 40).find(step => step.callShaped && !attempted.has(step.id) && !bridge.anchors(step.id).length);
        if (!step) return;
        attempted.add(step.id);
        bridge.lookup(step.id);
      });
    }
    return { pump, reset() { attempted.clear(); stopped = false; pump(); }, stop() { stopped = true; } };
  }

  // Presentation only: retain original anchor indices for source navigation.
  // Never fill gaps, mix sides, or turn separate name-match candidates into
  // one authoritative source location. All inputs belong to this message's
  // currently validated evidence revision, already bounded by the bridge.
  function excerptGroups(anchors) {
    const groups = [];
    function lines(anchor) {
      if (anchor.definition || !['old', 'new'].includes(anchor.side) || !Number.isSafeInteger(anchor.startLine) || !Number.isSafeInteger(anchor.endLine) || anchor.startLine < 1 || anchor.endLine < anchor.startLine || anchor.endLine - anchor.startLine >= 20 || typeof anchor.quote !== 'string' || anchor.quote.length > 8000) return null;
      const result = anchor.quote.split('\n');
      return result.length === anchor.endLine - anchor.startLine + 1 ? result : null;
    }
    function join(left, right) {
      const a = left.anchor, b = right.anchor;
      const aLines = lines(a), bLines = lines(b);
      if (!aLines || !bLines || a.path !== b.path || a.side !== b.side || a.preview?.language !== b.preview?.language) return null;
      const startLine = Math.min(a.startLine, b.startLine), endLine = Math.max(a.endLine, b.endLine);
      if (endLine - startLine >= 20 || a.endLine + 1 < b.startLine || b.endLine + 1 < a.startLine) return null;
      const quote = [], kinds = [], tokens = [];
      for (let line = startLine; line <= endLine; line++) {
        const ai = line - a.startLine, bi = line - b.startLine;
        if (ai >= 0 && ai < aLines.length && bi >= 0 && bi < bLines.length && aLines[ai] !== bLines[bi]) return null;
        const inA = ai >= 0 && ai < aLines.length;
        const anchor = inA ? a : b, index = inA ? ai : bi;
        quote.push(inA ? aLines[ai] : bLines[bi]);
        kinds.push(anchor.preview?.kinds?.[index] || 'unknown');
        tokens.push(anchor.preview?.tokens?.[index]);
      }
      const text = quote.join('\n');
      if (text.length > 8000) return null;
      const first = a.startLine <= b.startLine ? left : right;
      return { anchorIndex: first.anchorIndex, anchorIndices: [...left.anchorIndices, ...right.anchorIndices].sort((a, b) => a - b), anchor: { ...first.anchor, startLine, endLine, quote: text,
        preview: { language: a.preview?.language, kinds, tokens } } };
    }
    anchors.slice(0, 8).forEach((anchor, anchorIndex) => {
      groups.push({ anchor, anchorIndex, anchorIndices: [anchorIndex] });
      // At most eight anchors; coalesce bridging ranges too (e.g. 16,18,17),
      // retaining the first listing's position and every original input.
      let merged = true;
      while (merged) {
        merged = false;
        outer: for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
          const combined = join(groups[i], groups[j]);
          if (combined) { groups[i] = combined; groups.splice(j, 1); merged = true; break outer; }
        }
      }
    });
    return groups;
  }

  function mountExcerpt(host, anchor) {
    const pre = document.createElement('pre');
    pre.className = 'sequence-step-code';
    pre.tabIndex = 0;
    pre.setAttribute('aria-label', `${anchor.path}, ${anchor.definition ? anchor.comparisonMatch ? 'after, name-match candidate' : 'current workspace candidate' : anchor.side === 'old' ? 'before' : 'after'}, lines ${anchor.startLine}–${anchor.endLine}`);
    // Saved quotes and matched candidates were checked against captured rows.
    // Other candidates remain explicitly current-workspace source.
    const quote = anchor.quote.slice(0, 8000);
    const lines = quote.split('\n').slice(0, 20);
    const kinds = lines.map((_, index) => ['addition', 'deletion', 'context'].includes(anchor.preview?.kinds?.[index]) ? anchor.preview.kinds[index] : 'unknown');
    const header = document.createElement('div');
    header.className = 'sequence-code-header';
    const language = document.createElement('span');
    language.className = 'sequence-code-language';
    language.textContent = anchor.preview?.language === 'text' ? 'Plain text' : anchor.preview?.language || 'Code';
    const counts = document.createElement('span');
    counts.className = 'sequence-code-counts';
    const additions = kinds.filter(kind => kind === 'addition').length, deletions = kinds.filter(kind => kind === 'deletion').length;
    if (kinds.includes('unknown')) counts.textContent = 'Changes unavailable';
    else {
      counts.setAttribute('aria-label', `${additions} added and ${deletions} removed lines in this excerpt`);
      counts.title = 'Counts for the displayed excerpt only';
      const added = document.createElement('span'), removed = document.createElement('span');
      added.className = 'sequence-added-count'; added.textContent = `+${additions}`;
      removed.className = 'sequence-removed-count'; removed.textContent = `−${deletions}`;
      counts.append(added, document.createTextNode(' '), removed);
    }
    header.append(language, counts);
    lines.forEach((text, index) => {
      const row = document.createElement('span');
      row.className = `sequence-code-row ${kinds[index]}`;
      const marker = document.createElement('span');
      marker.className = 'sequence-step-marker';
      marker.textContent = kinds[index] === 'addition' ? '+' : kinds[index] === 'deletion' ? '−' : ' ';
      marker.setAttribute('aria-label', kinds[index] === 'addition' ? 'Added line' : kinds[index] === 'deletion' ? 'Removed line' : '');
      const number = document.createElement('span');
      number.className = 'sequence-step-line';
      number.textContent = String(anchor.startLine + index);
      number.setAttribute('aria-hidden', 'true');
      const code = document.createElement('span');
      code.className = 'sequence-step-source-text';
      const tokens = anchor.preview?.tokens?.[index];
      if (Array.isArray(tokens) && tokens.map(token => token.content).join('') === text) {
        tokens.forEach(token => {
          const span = document.createElement('span');
          span.className = 'syntax-token' + (token.fontStyle & 1 ? ' syntax-italic' : '') + (token.fontStyle & 2 ? ' syntax-bold' : '') + (token.fontStyle & 4 ? ' syntax-underline' : '');
          if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(token.light) && /^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(token.dark)) span.setAttribute('style', `--syntax-light:#${token.light};--syntax-dark:#${token.dark}`);
          span.textContent = token.content;
          code.append(span);
        });
      } else code.textContent = text;
      code.append(document.createTextNode('\n'));
      row.append(marker, number, code);
      pre.append(row);
    });
    host.append(header, pre);
    if (quote.length < anchor.quote.length || quote.split('\n').length > 20) {
      const notice = document.createElement('p'); notice.textContent = 'Excerpt truncated. View code for full source.'; host.append(notice);
    }
  }

  function mount(host, steps, bridge) {
    const entries = new Map();
    host.classList.add('sequence-code-pane');
    host.setAttribute('aria-label', 'Sequence code steps');
    host.tabIndex = 0;
    const heading = document.createElement('h2');
    heading.textContent = 'Code steps';
    const note = document.createElement('p');
    note.className = 'sequence-step-note';
    note.textContent = 'Authored message order · source evidence, not a runtime trace. Scroll freely; click a step or arrow to select it. The diagram starts at a readable zoom: drag to pan, or use Fit for an overview.';
    host.append(heading, note);

    function materialize(id) {
      const entry = entries.get(id);
      if (!entry || entry.loaded) return;
      entry.loaded = true;
      entry.cleanups.forEach(cleanup => cleanup()); entry.cleanups = [];
      entry.body.replaceChildren();
      const anchors = bridge.anchors(id).slice(0, 8);
      if (!anchors.length) {
        const notice = document.createElement('p');
        notice.textContent = bridge.notice?.(id) || (bridge.offline ? 'No saved source evidence. Definition lookup needs a live review.' : 'No validated source anchor; evidence may be absent or stale. A name lookup returns candidates, not call evidence.');
        entry.body.append(notice);
        if (!bridge.offline && entry.step.callShaped) {
          const lookup = document.createElement('button');
          lookup.type = 'button';
          lookup.textContent = bridge.pending?.(id) ? 'Looking up definition…' : 'Find definition';
          lookup.disabled = Boolean(bridge.pending?.(id));
          lookup.addEventListener('click', () => { selectSourceAction(id); bridge.lookup(id); });
          entry.body.append(lookup);
        }
      }
      excerptGroups(anchors).forEach(({ anchor, anchorIndex, anchorIndices }) => {
        const section = document.createElement('section');
        const label = document.createElement('p');
        label.className = 'sequence-step-source';
        label.textContent = `${anchor.definition ? `${anchor.comparisonMatch ? 'After · name match in captured source' : 'Current workspace · name match'}, not a verified call target` : anchor.side === 'old' ? 'Before · captured comparison evidence' : 'After · captured comparison evidence'} · ${anchor.path}:${anchor.startLine}–${anchor.endLine}`;
        section.append(label);
        const cleanup = (bridge.mountPreview || mountExcerpt)(section, anchor);
        if (typeof cleanup === 'function') entry.cleanups.push(cleanup);
        if (!bridge.offline) {
          const open = document.createElement('button');
          open.type = 'button';
          open.textContent = 'View code';
          open.addEventListener('click', () => {
            selectSourceAction(id);
            if (anchorIndices.length > 1) bridge.open(id, anchorIndex, anchorIndices);
            else bridge.open(id, anchorIndex);
          });
          section.append(open);
        }
        entry.body.append(section);
      });
    }

    function clearSelectionNotices() {
      entries.forEach(entry => { entry.selectionNotice.hidden = true; });
    }
    const controller = selectionController(steps.map(step => step.id), {
      mark(id) {
        entries.forEach((entry, key) => {
          entry.node.classList.toggle('selected', key === id);
          entry.button.setAttribute('aria-pressed', String(key === id));
          entry.selectionNotice.hidden = true;
        });
        if (id !== null) materialize(id);
      },
      selectDiagram(id) {
        const accepted = bridge.selectDiagram(id) !== false;
        clearSelectionNotices();
        if (!accepted) {
          const notice = entries.get(id).selectionNotice;
          notice.textContent = 'This step is not available in the current path. Choose a route containing it, or clear Paths to select it.';
          notice.hidden = false;
        }
        return accepted;
      },
      reveal(id) {
        if (host.hidden) return;
        const node = entries.get(id).node;
        // Scroll only this pane: scrollIntoView would also move the page/frame.
        host.scrollTop += node.getBoundingClientRect().top - host.getBoundingClientRect().top - 12;
      },
    });

    steps.forEach((step, index) => {
      const node = document.createElement('article');
      node.className = 'sequence-code-step';
      node.dataset.sequenceMessageId = step.id;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sequence-step-select';
      const progress = document.createElement('span');
      progress.className = 'sequence-step-progress';
      progress.textContent = `Step ${index + 1} of ${steps.length}`;
      const title = document.createElement('span');
      title.className = 'sequence-step-title';
      title.textContent = `${step.label}${step.variant === 'return' ? ' · return' : ''}${step.from === step.to ? ' · self call' : ''}`;
      button.append(progress, title);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => controller.select(step.id, 'keyboard'));
      const body = document.createElement('div');
      body.className = 'sequence-step-preview';
      const selectionNotice = document.createElement('p');
      selectionNotice.className = 'sequence-step-selection-notice';
      selectionNotice.setAttribute('role', 'status');
      selectionNotice.hidden = true;
      node.append(button, body, selectionNotice);
      node.addEventListener('click', event => {
        // Buttons keep their keyboard/action handlers. Background, labels and
        // read-only code select without moving the reader's scroll position.
        if (event.defaultPrevented || event.target.closest?.('button, a, input, select, textarea')) return;
        const selection = root.getSelection?.();
        if (selection && !selection.isCollapsed && (node.contains(selection.anchorNode) || node.contains(selection.focusNode))) return;
        controller.select(step.id, 'card');
      });
      host.append(node);
      entries.set(step.id, { node, button, body, selectionNotice, step, loaded: false, cleanups: [] });
    });
    if (!steps.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No supported message identities are available for this diagram.';
      host.append(empty);
    }

    // Saved quotes already arrived with the diagram. Populate every bounded
    // excerpt now, including offscreen steps, without selecting or scrolling.
    steps.forEach(step => materialize(step.id));

    function selectSourceAction(id) {
      // Select within the existing path before the source bridge pauses and
      // opens the exact anchor. Off-route source inspection remains available.
      controller.select(id, 'action');
    }
    function preserveSelection() {
      // Native outside-click handling can clear the relationship when the
      // scrollbar or pane padding is clicked. Retain it without revealing.
      if (controller.selected && !bridge.pathActive?.()) controller.select(controller.selected, 'action');
    }
    function key(event) {
      if (event.target === host) {
        // Let browser scrolling work without handing these keys to diagram
        // shortcuts. Explicit step navigation belongs to the step headings.
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp', ' '].includes(event.key)) event.stopPropagation();
        return;
      }
      if (!event.target.classList?.contains('sequence-step-select')) return;
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const index = Math.max(0, steps.findIndex(step => step.id === controller.selected));
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1 : Math.max(0, Math.min(steps.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
        if (steps[next]) { event.preventDefault(); event.stopPropagation(); controller.select(steps[next].id, 'keyboard'); entries.get(steps[next].id).button.focus({ preventScroll: true }); }
      }
    }
    host.addEventListener('click', preserveSelection);
    host.addEventListener('keydown', key);
    return {
      get selected() { return controller.selected; },
      select: controller.select,
      show(id) {
        if (!entries.has(id)) return;
        controller.select(id, 'keyboard');
        if (controller.selected === id) entries.get(id).button.focus({ preventScroll: true });
      },
      clear: controller.clear,
      clearSelectionNotices,
      refresh(id) { const entry = entries.get(id); if (entry) { entry.loaded = false; materialize(id); } },
      reset() { entries.forEach((entry, id) => { if (entry.loaded) { entry.loaded = false; materialize(id); } }); },
      dispose() {
        host.removeEventListener('click', preserveSelection); host.removeEventListener('keydown', key);
        entries.forEach(entry => entry.cleanups.forEach(cleanup => cleanup()));
      },
    };
  }

  function boundPathPanel(diagram, panel) {
    if (!panel || panel.hidden || !panel.hasAttribute('data-review-panel-moved') || !panel.offsetWidth || !panel.offsetHeight || !diagram.clientWidth || !diagram.clientHeight) return;
    const nav = diagram.querySelector('.diagram-nav');
    const x = Math.max(12, Math.min(diagram.clientWidth - panel.offsetWidth - 12, panel.offsetLeft));
    const y = Math.max(12, Math.min((nav ? nav.offsetTop : diagram.clientHeight) - panel.offsetHeight - 12, panel.offsetTop));
    // Retain user placement wherever it still fits. Only the existing panel
    // moves after layout changes; its route and the diagram camera stay put.
    if (x !== panel.offsetLeft) { panel.style.left = x + 'px'; panel.style.setProperty('--review-panel-x', x + 'px'); }
    if (y !== panel.offsetTop) { panel.style.top = y + 'px'; panel.style.setProperty('--review-panel-y', y + 'px'); }
  }

  // Both the Diagrams code pane and the Briefing inspector follow the same
  // native relationship IDs, route state, and keyboard/click behavior.
  function connectArchifySelection(svg, steps, controller) {
    let routeOwned = false;
    const sync = () => {
      routeEmphasis(svg, steps);
      if (svg.hasAttribute('data-route-active') || svg.hasAttribute('data-route-picking')) {
        routeOwned = true;
        const id = routeMessage(svg, steps);
        if (id) controller.select(id, 'route'); else controller.clear();
        return;
      }
      // A rejected click may show a notice while no message is selected.
      // Ending Paths must dismiss it even when selection itself is unchanged.
      if (routeOwned) controller.clearSelectionNotices();
      const id = root.Archify.focus.relationship()?.id;
      if (id) controller.select(id, 'diagram'); else if (routeOwned) controller.clear();
      routeOwned = false;
    };
    const observer = new MutationObserver(sync);
    observer.observe(svg, { attributes: true, attributeFilter: ['data-relationship-pin-active', 'data-route-active', 'data-route-picking', 'data-route-journey'] });
    function directSelection(event) {
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      const id = event.target.closest?.('[data-relationship-id]')?.getAttribute('data-relationship-id');
      if (!id) return;
      // Archify toggles an already pinned arrow off. A walkthrough activation
      // selects/reveals it instead, using the same public relationship API.
      queueMicrotask(() => {
        controller.select(id, 'diagram-click');
      });
    }
    svg.addEventListener('click', directSelection);
    svg.addEventListener('keydown', directSelection);
    sync();
    return () => { observer.disconnect(); svg.removeEventListener('click', directSelection); svg.removeEventListener('keydown', directSelection); };
  }

  function installExternalInspector(svg, steps) {
    const controller = selectionController(steps.map(step => step.id), {
      selectDiagram: id => selectMessage(svg, steps, root.Archify, id),
      mark: id => root.parent.postMessage({ type: 'diffcompass-briefing-diagram-select', elementId: id }, '*'),
      reveal() {},
    });
    const disconnect = connectArchifySelection(svg, steps, { ...controller, clearSelectionNotices() {} });
    function receive(event) {
      if (event.source !== root.parent || event.data?.type !== 'diffcompass-briefing-diagram-select') return;
      if (event.data.elementId === controller.selected) return;
      if (event.data.elementId === null) { controller.clear(); root.Archify.focus.clear({ updateUrl: false }); }
      else controller.select(event.data.elementId, 'host');
    }
    root.addEventListener('message', receive);
    root.parent.postMessage({ type: 'diffcompass-briefing-diagram-ready' }, '*');
    root.addEventListener('pagehide', () => { disconnect(); root.removeEventListener('message', receive); }, { once: true });
  }

  function installArchify(steps, offline, externalInspector = false) {
    const diagram = document.querySelector('.diagram-container');
    const svg = diagram?.querySelector('svg');
    const actions = root.diffcompassSequenceSourceActions;
    if (!diagram || !svg || !root.Archify?.focus?.inspectRelationshipById) return;
    if (externalInspector) {
      document.documentElement.setAttribute('data-sequence-external-inspector', '');
      installExternalInspector(svg, steps);
      return;
    }
    if (!actions) return;
    const layout = document.createElement('div');
    layout.className = 'sequence-walkthrough';
    diagram.parentNode.insertBefore(layout, diagram);
    layout.append(diagram);
    const sidebar = document.createElement('section');
    sidebar.className = 'sequence-code-sidebar';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'sequence-code-toggle';
    toggle.textContent = 'Hide code';
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-controls', 'sequence-code-steps');
    const pane = document.createElement('aside');
    pane.id = 'sequence-code-steps';
    const separator = document.createElement('div');
    separator.className = 'sequence-code-resizer';
    separator.tabIndex = 0;
    separator.setAttribute('role', 'separator');
    separator.setAttribute('aria-controls', pane.id);
    sidebar.append(toggle, pane);
    layout.append(separator, sidebar);
    const controller = mount(pane, steps, {
      ...actions, offline,
      selectDiagram(id) {
        return selectMessage(svg, steps, root.Archify, id);
      },
    });
    const restoreSelection = () => {
      // Inspecting a relationship exits Paths; resizing/collapsing must not.
      if (controller.selected && !root.Archify.routeProbe?.active?.()) controller.select(controller.selected, 'action');
    };
    const sizing = root.DiffCompassSequenceResize.mount(layout, separator, pane, restoreSelection);
    const pathPanel = diagram.querySelector('#route-probe');
    const panelSize = typeof ResizeObserver === 'function' && pathPanel ? new ResizeObserver(() => boundPathPanel(diagram, pathPanel)) : null;
    panelSize?.observe(diagram); if (pathPanel) panelSize?.observe(pathPanel);
    const panelState = new MutationObserver(() => boundPathPanel(diagram, pathPanel));
    if (pathPanel) panelState.observe(pathPanel, { attributes: true, attributeFilter: ['hidden', 'data-review-panel-moved'] });
    let savedScroll = 0;
    let sourceCard;
    function setCollapsed(collapsed) {
      if (pane.hidden === collapsed) return;
      if (collapsed) savedScroll = pane.scrollTop;
      pane.hidden = collapsed;
      layout.classList.toggle('sequence-code-collapsed', collapsed);
      toggle.textContent = collapsed ? 'Show code' : 'Hide code';
      toggle.setAttribute('aria-expanded', String(!collapsed));
      if (!collapsed) pane.scrollTop = savedScroll;
      // Native outside-click handling can clear the pin before this handler.
      // Restore the retained selection without requesting a reveal or refit.
      restoreSelection(); sizing.sync();
      sourceCard?.refresh();
    }
    toggle.addEventListener('click', () => setCollapsed(!pane.hidden));
    sourceCard = actions.registerCodePane?.({
      has: id => steps.some(step => step.id === id),
      collapsed: () => pane.hidden,
      show(id) { setCollapsed(false); controller.show(id); },
    });
    const disconnect = connectArchifySelection(svg, steps, controller);
    const preload = preloadDefinitions(steps, { ...actions, offline });
    actions.onChange = (id, stopPreload) => { controller.refresh(id); if (stopPreload) preload.stop(); else preload.pump(); };
    actions.onReset = () => { controller.reset(); preload.reset(); };
    preload.pump();
    root.addEventListener('pagehide', () => { sourceCard?.dispose(); preload.stop(); disconnect(); panelSize?.disconnect(); panelState.disconnect(); sizing.dispose(); controller.dispose(); }, { once: true });
  }
  root.DiffCompassSequenceWalkthrough = { selectionController, routeMessage, routeStep, selectMessage, routeEmphasis, preloadDefinitions, excerptGroups, boundPathPanel, mount, mountExcerpt, installArchify };
})(typeof window === 'undefined' ? globalThis : window);
