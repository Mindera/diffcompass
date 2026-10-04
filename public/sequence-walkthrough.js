// Read-only sequence excerpts. The host owns identities, evidence and navigation;
// mountPreview is the embedding boundary for a future shared editor host.
(function (root) {
  function selectionController(ids, effects) {
    const allowed = new Set(ids);
    let selected = null;
    return {
      get selected() { return selected; },
      select(id, origin) {
        if (!allowed.has(id)) return false;
        if (id === selected) {
          if (origin !== 'diagram') effects.selectDiagram(id);
          if (origin === 'keyboard' || origin === 'diagram-click') {
            // The renderer clears its pin on an outside click in capture
            // phase. Re-activating the selected code heading must restore it.
            effects.reveal(id);
          }
          return false;
        }
        selected = id;
        effects.mark(id);
        if (origin !== 'diagram') effects.selectDiagram(id);
        // The diagram observer echoes programmatic selection asynchronously.
        // Equality above absorbs that echo; scrolling never requests reveal.
        if (origin === 'diagram' || origin === 'diagram-click' || origin === 'keyboard') effects.reveal(id);
        return true;
      },
    };
  }

  function closestStep(items, top) {
    return items.reduce((best, item) => !best || Math.abs(item.top - top) < Math.abs(best.top - top) ? item : best, null)?.id;
  }

  function mountExcerpt(host, anchor) {
    const pre = document.createElement('pre');
    pre.className = 'sequence-step-code';
    pre.tabIndex = 0;
    pre.setAttribute('aria-label', `${anchor.path}, ${anchor.definition ? 'current workspace candidate' : anchor.side === 'old' ? 'before' : 'after'}, lines ${anchor.startLine}–${anchor.endLine}`);
    // Quotes were grounded against captured diff rows on the server. Never read
    // the working tree to fill a missing historical excerpt.
    const quote = anchor.quote.slice(0, 8000);
    quote.split('\n').slice(0, 20).forEach((text, index) => {
      const row = document.createElement('span');
      const number = document.createElement('span');
      number.className = 'sequence-step-line';
      number.textContent = String(anchor.startLine + index);
      number.setAttribute('aria-hidden', 'true');
      row.append(number, document.createTextNode(text + '\n'));
      pre.append(row);
    });
    host.append(pre);
    if (quote.length < anchor.quote.length || quote.split('\n').length > 20) {
      const notice = document.createElement('p'); notice.textContent = 'Excerpt truncated. View code for full source.'; host.append(notice);
    }
  }

  function mount(host, steps, bridge) {
    const entries = new Map();
    let userScroll = false, scrollFrame = 0, scrollTimer = 0, disposed = false;
    host.classList.add('sequence-code-pane');
    host.setAttribute('aria-label', 'Sequence code steps');
    host.tabIndex = 0;
    const heading = document.createElement('h2');
    heading.textContent = 'Code steps';
    const note = document.createElement('p');
    note.className = 'sequence-step-note';
    note.textContent = 'Authored message order · source evidence, not a runtime trace. Scroll to select an arrow. The diagram starts at a readable zoom: drag to pan, or use Fit for an overview.';
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
          lookup.addEventListener('click', () => { controller.select(id, 'action'); bridge.lookup(id); });
          entry.body.append(lookup);
        }
      }
      anchors.forEach((anchor, index) => {
        const section = document.createElement('section');
        const label = document.createElement('p');
        label.className = 'sequence-step-source';
        label.textContent = `${anchor.definition ? 'Current workspace · name match, not a verified call target' : anchor.side === 'old' ? 'Before · captured comparison evidence' : 'After · captured comparison evidence'} · ${anchor.path}:${anchor.startLine}–${anchor.endLine}`;
        section.append(label);
        const cleanup = (bridge.mountPreview || mountExcerpt)(section, anchor);
        if (typeof cleanup === 'function') entry.cleanups.push(cleanup);
        if (!bridge.offline) {
          const open = document.createElement('button');
          open.type = 'button';
          open.textContent = anchor.definition ? 'View definition' : 'View code';
          open.addEventListener('click', () => { controller.select(id, 'action'); bridge.open(id, index); });
          section.append(open);
        }
        entry.body.append(section);
      });
    }

    const controller = selectionController(steps.map(step => step.id), {
      mark(id) {
        entries.forEach((entry, key) => {
          entry.node.classList.toggle('selected', key === id);
          entry.button.setAttribute('aria-pressed', String(key === id));
        });
        materialize(id);
      },
      selectDiagram: bridge.selectDiagram,
      reveal(id) {
        userScroll = false;
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
      button.textContent = `${index + 1}. ${step.label}${step.variant === 'return' ? ' · return' : ''}${step.from === step.to ? ' · self call' : ''}`;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => controller.select(step.id, 'keyboard'));
      const body = document.createElement('div');
      body.className = 'sequence-step-preview';
      body.textContent = 'Source preview loads when this step is visible.';
      node.append(button, body);
      host.append(node);
      entries.set(step.id, { node, button, body, step, loaded: false, cleanups: [] });
    });
    if (!steps.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No supported message identities are available for this diagram.';
      host.append(empty);
    }

    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(items => {
      items.forEach(item => { if (item.isIntersecting) materialize(item.target.dataset.sequenceMessageId); });
    }, { root: host, rootMargin: '160px' }) : null;
    entries.forEach(entry => observer?.observe(entry.node));
    if (!observer) steps.slice(0, 3).forEach(step => materialize(step.id));

    function intent() { userScroll = true; clearTimeout(scrollTimer); scrollTimer = setTimeout(() => { userScroll = false; }, 350); }
    function scroll() {
      if (!userScroll || scrollFrame || disposed) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        if (!userScroll || disposed) return;
        const top = host.getBoundingClientRect().top + 24;
        const id = closestStep([...entries].map(([id, entry]) => ({ id, top: entry.node.getBoundingClientRect().top })), top);
        if (id) controller.select(id, 'scroll');
      });
    }
    function key(event) {
      if (event.target !== host && !event.target.classList?.contains('sequence-step-select')) return;
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const index = Math.max(0, steps.findIndex(step => step.id === controller.selected));
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1 : Math.max(0, Math.min(steps.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
        if (steps[next]) { event.preventDefault(); event.stopPropagation(); controller.select(steps[next].id, 'keyboard'); entries.get(steps[next].id).button.focus({ preventScroll: true }); }
      } else if (['PageDown', 'PageUp', ' '].includes(event.key)) intent();
    }
    host.addEventListener('wheel', intent, { passive: true });
    host.addEventListener('touchmove', intent, { passive: true });
    host.addEventListener('pointerdown', intent, { passive: true });
    host.addEventListener('scroll', scroll, { passive: true });
    host.addEventListener('keydown', key);
    // Layout/preview changes are never user scroll intent.
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { userScroll = false; }) : null;
    resize?.observe(host);
    return {
      select: controller.select,
      refresh(id) { const entry = entries.get(id); if (entry) { userScroll = false; entry.loaded = false; materialize(id); } },
      reset() { userScroll = false; entries.forEach((entry, id) => { if (entry.loaded) { entry.loaded = false; materialize(id); } }); },
      dispose() {
        disposed = true; observer?.disconnect(); resize?.disconnect(); cancelAnimationFrame(scrollFrame); clearTimeout(scrollTimer);
        host.removeEventListener('wheel', intent); host.removeEventListener('touchmove', intent); host.removeEventListener('pointerdown', intent); host.removeEventListener('scroll', scroll); host.removeEventListener('keydown', key);
        entries.forEach(entry => entry.cleanups.forEach(cleanup => cleanup()));
      },
    };
  }

  function installArchify(steps, offline) {
    const diagram = document.querySelector('.diagram-container');
    const svg = diagram?.querySelector('svg');
    const actions = root.diffcompassSequenceSourceActions;
    if (!diagram || !svg || !actions || !root.Archify?.focus?.inspectRelationshipById) return;
    const layout = document.createElement('div');
    layout.className = 'sequence-walkthrough';
    diagram.parentNode.insertBefore(layout, diagram);
    layout.append(diagram);
    const pane = document.createElement('aside');
    layout.append(pane);
    // This measures the embedded map itself, including when sidebars reduce
    // the workspace inside a wide browser window.
    const sizeLayout = () => layout.classList.toggle('sequence-walkthrough-stacked', layout.clientWidth < 1040);
    sizeLayout();
    const layoutObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(sizeLayout) : null;
    layoutObserver?.observe(layout);
    const controller = mount(pane, steps, {
      ...actions, offline,
      selectDiagram(id) {
        if (root.Archify.focus.relationship()?.id !== id) root.Archify.focus.inspectRelationshipById(id, { toggle: false, updateUrl: false });
      },
    });
    const sync = () => { const id = root.Archify.focus.relationship()?.id; if (id) controller.select(id, 'diagram'); };
    const observer = new MutationObserver(sync);
    observer.observe(svg, { attributes: true, attributeFilter: ['data-relationship-pin-active'] });
    function directSelection(event) {
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      const id = event.target.closest?.('[data-relationship-id]')?.getAttribute('data-relationship-id');
      if (!id) return;
      // Archify toggles an already pinned arrow off. A walkthrough activation
      // selects/reveals it instead, using the same public relationship API.
      queueMicrotask(() => {
        root.Archify.focus.inspectRelationshipById(id, { toggle: false, updateUrl: false });
        controller.select(id, 'diagram-click');
      });
    }
    svg.addEventListener('click', directSelection);
    svg.addEventListener('keydown', directSelection);
    actions.onChange = id => controller.refresh(id);
    actions.onReset = () => controller.reset();
    // Restore existing selection without selecting/revealing an invented first arrow.
    sync();
    root.addEventListener('pagehide', () => { observer.disconnect(); layoutObserver?.disconnect(); svg.removeEventListener('click', directSelection); svg.removeEventListener('keydown', directSelection); controller.dispose(); }, { once: true });
  }
  root.DiffCompassSequenceWalkthrough = { selectionController, closestStep, mount, mountExcerpt, installArchify };
})(typeof window === 'undefined' ? globalThis : window);
