// Monaco receives only the saved excerpt. It never loads current repository files.
let nextFrame = 0;
const hosts = new Map();
window.diffCompassBriefingCodeHost = {
  forFrame(id, child) {
    const entry = hosts.get(id);
    return entry?.frame?.contentWindow === child ? entry.host : null;
  },
};

export function preferredBriefingRenderer() {
  try { return localStorage.getItem("diffcompass-diff-renderer") === "monaco" ? "monaco" : "current"; }
  catch { return "current"; }
}

export function createBriefingCodeRenderer() {
  const entries = new Map();
  const offscreen = new Set();
  const offscreenLimit = 6;
  let active = false;
  let view = { layout: "unified", wrap: "scroll" };
  const theme = () => ({ syntax: document.documentElement.dataset.syntaxTheme || "diffcompass", light: document.documentElement.dataset.theme === "light" });
  const wantsMonaco = () => (document.getElementById("diff-renderer")?.value || preferredBriefingRenderer()) === "monaco";
  function present(entry) {
    const monaco = wantsMonaco() && !entry.failed;
    if (monaco && !entry.height) entry.height = Math.ceil(entry.pre.getBoundingClientRect().height) || Math.max(32, entry.evidence.diff.rows.length * 20 + 16);
    entry.pre.hidden = monaco;
    entry.loading.hidden = !monaco || Boolean(entry.child);
    entry.slot.setAttribute("aria-busy", String(monaco && !entry.child));
    entry.slot.style.height = monaco ? `${entry.height}px` : "";
    if (entry.frame) entry.frame.hidden = !entry.child;
  }
  function unload(entry) {
    offscreen.delete(entry);
    clearTimeout(entry.timer);
    hosts.delete(entry.id);
    entry.child?.dispose(); entry.child = null;
    entry.frame?.remove(); entry.frame = null;
    // Eviction reserves the measured Monaco height, never swaps back to Shiki.
    present(entry);
  }
  function fallback(entry) {
    entry.failed = true;
    unload(entry);
    if (!entry.notice) {
      entry.notice = document.createElement("div");
      entry.notice.className = "briefing-code-notice";
      entry.notice.textContent = "Monaco is unavailable. Showing the saved diff with Shiki.";
      entry.slot.before(entry.notice);
    }
  }
  function mount(entry) {
    if (!active || !entry.visible || entry.failed || entry.frame || !wantsMonaco() || !entry.slot.isConnected) return;
    const frame = document.createElement("iframe");
    entry.frame = frame;
    frame.className = "briefing-code-frame";
    frame.title = `Saved diff: ${entry.evidence.path}`;
    frame.hidden = true;
    entry.host = {
      payload: () => ({ path: entry.evidence.path, rows: structuredClone(entry.evidence.diff.rows), theme: theme(), view }),
      ready(child) {
        if (entry.frame !== frame || !frame.isConnected) { child.dispose(); return; }
        clearTimeout(entry.timer);
        entry.child = child;
        present(entry);
        child.theme(theme());
        child.view(view);
      },
      height(value) {
        if (entry.frame !== frame || !Number.isFinite(value) || value <= 0 || value > 30000) return;
        entry.height = Math.ceil(value);
        entry.slot.style.height = `${entry.height}px`;
      },
      failed() { if (entry.frame === frame) fallback(entry); },
    };
    hosts.set(entry.id, entry);
    frame.src = `/monaco/briefing.html?id=${encodeURIComponent(entry.id)}`;
    frame.addEventListener("error", () => { if (entry.frame === frame) fallback(entry); });
    entry.slot.append(frame);
    entry.timer = setTimeout(() => { if (entry.frame === frame) fallback(entry); }, 20000);
  }
  const visibility = new IntersectionObserver(changes => {
    for (const change of changes) {
      const entry = entries.get(change.target);
      if (!entry) continue;
      entry.visible = change.isIntersecting;
      if (entry.visible) { offscreen.delete(entry); mount(entry); }
      else if (entry.frame) { offscreen.delete(entry); offscreen.add(entry); }
    }
    // Keep a small working set ready for rapid scroll reversals in either pane.
    while (offscreen.size > offscreenLimit) unload(offscreen.values().next().value);
  }, { rootMargin: "300px" });
  function refreshPreference() {
    for (const entry of entries.values()) {
      entry.failed = false; entry.notice?.remove(); entry.notice = null;
      present(entry);
      if (wantsMonaco()) mount(entry); else unload(entry);
    }
  }
  document.addEventListener("change", event => { if (event.target.id === "diff-renderer") refreshPreference(); });
  window.addEventListener("storage", event => { if (event.key === "diffcompass-diff-renderer") refreshPreference(); });
  const themes = new MutationObserver(() => { for (const entry of entries.values()) entry.child?.theme(theme()); });
  themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-syntax-theme"] });
  return {
    sync(root, evidence) {
      for (const source of root.querySelectorAll(".briefing-source[data-evidence-id]")) {
        const pre = source.querySelector("pre.briefing-diff");
        const captured = evidence.find(item => item.id === source.dataset.evidenceId);
        if (!pre || !captured?.diff?.available || pre.closest(".briefing-code-slot")) continue;
        const slot = document.createElement("div"); slot.className = "briefing-code-slot";
        pre.before(slot); slot.append(pre);
        const loading = document.createElement("div"); loading.className = "briefing-code-loading";
        loading.textContent = "Loading code…"; slot.append(loading);
        const entry = { id: `briefing-code-${++nextFrame}`, slot, pre, loading, evidence: captured, visible: false };
        present(entry);
        entries.set(slot, entry); visibility.observe(slot);
      }
    },
    clear(root) {
      for (const [slot, entry] of entries) {
        if (!root.contains(slot)) continue;
        visibility.unobserve(slot); unload(entry); entry.notice?.remove(); entries.delete(slot);
      }
    },
    setActive(value) {
      active = value;
      for (const entry of entries.values()) {
        if (active) mount(entry); else unload(entry);
      }
    },
    setView(value) {
      view = value;
      for (const entry of entries.values()) entry.child?.view(view);
    },
  };
}
