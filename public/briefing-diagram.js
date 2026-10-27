/* Connect the native Archify node/relationship focus to the saved Briefing.
   IDs come from captured IR, never captions or renderer-generated DOM IDs. */
window.installBriefingDiagram = function (elements) {
  function install() {
    const svg = document.querySelector('.diagram-container > svg');
    const focus = window.Archify?.focus;
    if (!svg || !focus) return;
    const nodes = new Set(elements.filter(e => ['components', 'states', 'nodes'].includes(e.kind)).map(e => e.id));
    const edges = new Set(elements.filter(e => !nodes.has(e.id)).map(e => e.id));
    let selected = null;
    function publish(id) {
      if (id !== null && !nodes.has(id) && !edges.has(id)) return;
      if (selected === id) return;
      selected = id;
      window.parent.postMessage({ type: 'diffcompass-briefing-diagram-select', elementId: id }, '*');
    }
    function select(id) {
      if (nodes.has(id)) focus.set(id, { toggle: false, updateUrl: false });
      else if (edges.has(id)) focus.inspectRelationshipById(id, { toggle: false, updateUrl: false });
      else return;
      publish(id);
    }
    function sync() {
      const relationship = focus.relationship()?.id;
      const node = focus.active();
      publish(relationship ?? (typeof node === 'string' ? node : null));
    }
    // Covers native search, keyboard navigation, relationship selection and clear.
    const observer = new MutationObserver(sync);
    observer.observe(svg, { attributes: true, attributeFilter: ['data-focus-active', 'data-relationship-pin-active'] });
    function directSelection(event) {
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      const target = event.target.closest?.('[data-relationship-id], [data-node-id]');
      const id = target?.getAttribute('data-relationship-id') ?? target?.getAttribute('data-node-id');
      if (id) queueMicrotask(() => select(id));
    }
    function receive(event) {
      if (event.source !== window.parent || event.data?.type !== 'diffcompass-briefing-diagram-select') return;
      const id = event.data.elementId;
      if (id === selected) return;
      if (id === null) { focus.clear({ updateUrl: false }); publish(null); }
      else select(id);
    }
    svg.addEventListener('click', directSelection);
    svg.addEventListener('keydown', directSelection);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'diffcompass-briefing-diagram-ready' }, '*');
    window.addEventListener('pagehide', () => { observer.disconnect(); window.removeEventListener('message', receive); }, { once: true });
  }
  if (document.readyState === 'loading') window.addEventListener('load', install, { once: true });
  else install();
};
