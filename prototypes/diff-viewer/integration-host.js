// Appended only by integration-server.ts; no production bundle changes.
{
  const referencesReady = import("/prototype/annotations.mjs").then(({ installReferencesPanel }) => {
    const references = installReferencesPanel({
      elements, state, render: renderSymbolPeek, updateToolbar: updateCodeSelectionToolbar,
      showRepositoryFile, renderRepositoryFile, compact: compactSymbolPeek,
    });
    renderSymbolPeek = references.render;
    updateCodeSelectionToolbar = references.updateToolbar;
    openSymbolPeekLocation = references.openLocation;
    renderRepositoryFile = references.renderSource;
    renderSymbolPeek();
  });
  const frame = document.createElement("iframe");
  frame.id = "monaco-integration-frame"; frame.title = "Monaco review diff"; frame.hidden = true;
  const bar = document.createElement("div"); bar.className = "monaco-integration-bar";
  const title = document.createElement("strong"); title.textContent = "Full-product fixture · Monaco preview";
  const note = document.createElement("small");
  note.textContent = "Synthetic data · Fixture replies, not AI · No GitHub publishing or source edits";
  const select = document.createElement("select"); select.id = "monaco-renderer"; select.setAttribute("aria-label","Diff renderer");
  select.add(new Option("Monaco prototype","monaco")); select.add(new Option("Current renderer","current"));
  bar.append(title,note,select);
  const commentsToggle = document.createElement("button"); commentsToggle.id = "monaco-comments-toggle";
  commentsToggle.type = "button"; commentsToggle.className = "text-button"; commentsToggle.hidden = true;
  document.querySelector(".diff-view-controls").append(commentsToggle);
  function commentControls(status) {
    commentsToggle.textContent = status.visible ? "Hide comments" : "Show comments";
    commentsToggle.setAttribute("aria-pressed", String(status.visible));
    commentsToggle.disabled = status.hasDraft;
    commentsToggle.title = status.hasDraft ? "Save or cancel the draft before hiding comments" : "Show or hide local comments and pull request threads; gutter markers remain available";
  }
  commentsToggle.addEventListener("click", () => child?.setCommentsVisible(!child.commentVisibilityState().visible));
  document.querySelector(".topbar").insertAdjacentElement("afterend",bar);
  const fallback = document.createElement("p"); fallback.className = "monaco-integration-note";
  elements.diff.before(fallback,frame);
  let child = null, preferred = "monaco", nativeReason = null, pendingFrame = null;
  const frameHeightLimit = () => Math.max(300, window.innerHeight - 310);
  function contentSizeChanged(height) {
    if (frame.hidden || !Number.isFinite(height) || height <= 0) return;
    const size = `${Math.min(frameHeightLimit(), Math.ceil(height)) + 2}px`;
    if (frame.style.height !== size) frame.style.height = size;
  }
  const native = {
    renderDiff, revealCodeLocation, focusCurrentStep, showChangedFile, renderRepositoryFile,
    changeDiffView, renderTourAnnotation, renderActiveTab, renderSessionUpdate,
    updateCurrentStepReturnVisibility, openCommentEditor,
  };
  const available = path => child?.paths.has(path);
  const beforeTourFallback = () => state.tourMode && state.diffLayout === "unified" && currentPhase()?.steps.some(step => step.anchor.side === "old");
  const usingMonaco = () => preferred === "monaco" && child && !nativeReason && !state.proposalPreview && !beforeTourFallback();
  function sync() {
    pendingFrame = null;
    if (!state.session) return;
    const paths = (state.renderedDiffFiles || []).map(file=>file.path);
    const active = usingMonaco() && paths.some(available);
    document.documentElement.classList.toggle("monaco-host-enabled",Boolean(active));
    frame.hidden = !active;
    commentsToggle.hidden = !active;
    if (child) commentControls(child.commentVisibilityState());
    for (const node of elements.diff.querySelectorAll(":scope>.diff-file")) {
      node.toggleAttribute("data-monaco-text",Boolean(available(node.dataset.path)));
    }
    fallback.textContent = preferred === "current" ? "Current renderer selected. Monaco state and drafts are retained."
      : beforeTourFallback() ? "This phase contains Before-side stops: Unified uses the current renderer. Split also supports these stops in Monaco."
      : nativeReason || (child ? "Monaco text diffs, including Markdown · Images use their media preview. Use Current renderer for legacy-only actions." : "Loading Monaco… The current renderer remains available.");
    child?.sync({
      session:state.session, paths, collapsed:[...state.collapsedFiles],
      layout:state.diffLayout, wrap:state.diffWrap==="wrap",
      light:document.documentElement.dataset.theme==="light",
      step:state.tourMode?currentStep():null,
      steps:state.tourMode?(currentPhase()?.steps??[]):[],
    });
    // Clearly synthetic controls: never suggest these could publish to GitHub.
    for (const link of document.querySelectorAll('a[href^="https://github.com/fixture/"]')) link.href="https://example.invalid/fixture";
    for (const button of document.querySelectorAll('#refresh-button,#checkpoint-button,#close-button,#close-review-button,#approve-comments-button,#feedback-button,#sessions-button,input[data-action="github"]')) {
      button.disabled=true;button.title="Disabled in this isolated fixture; no publishing, source refresh or review closure.";
    }
  }
  function schedule() {
    if(pendingFrame===null)pendingFrame=requestAnimationFrame(sync);
  }
  async function reveal(path,side,line,endLine=line) {
    sync();
    if(!usingMonaco()||!available(path))return false;
    const shown=child.reveal(path,side,line,endLine);
    // Child focus/scroll can also move an ancestor scroller. Restore the frame
    // after that so its file header stays below the host's sticky toolbar.
    frame.scrollIntoView({block:"start",behavior:"instant"});
    return shown;
  }
  window.diffCompassMonacoHost = {
    tourShortcut: handleTourShortcut,
    contentSizeChanged,
    renderMarkdownPreview(path, side, content) {
      const file = state.session.comparison.files.find(file => file.path === path);
      if (!file || !["old", "new"].includes(side)) throw Error("Captured Markdown source is unavailable.");
      // Reuse the application's escaped Markdown renderer and diff metadata;
      // the child supplies only its immutable, authenticated captured source.
      return renderMarkdown(content, 0, { path, side, changedLines: markdownChangedLines(file, side), changedRanges: markdownChangedRanges(file, side) });
    },
    // Based on the outer viewport, never the auto-sized iframe. Otherwise
    // shrinking the frame lowers its children's limits on every resize.
    editorHeightLimit: () => Math.max(200, frameHeightLimit() - 100),
    commentsChanged: commentControls,
    ready(view) {
      child=view; sync();
      // A late Monaco mount must not override a view the reviewer already chose.
      if(state.activeTab === "diff" && state.tourMode && currentStep())void focusCurrentStep();
    },
    async refresh() {
      const before=state.session,next=await api("/api/session");
      if(next.revision>=state.session.revision)state.session=next;
      renderSessionUpdate(before);sync();
    },
    async show(path) { await showAnalysisFile(path); },
    async reveal(path,side,line) { await showAnalysisFile(path,line,side); },
    setCollapsed(path,collapsed) {
      if(collapsed)state.collapsedFiles.add(path);else state.collapsedFiles.delete(path);
      native.renderDiff(state.renderedDiffFiles,currentDiffRenderOptions());renderComments();renderFindings();sync();
    },
    options(layout,wrap) { changeDiffView(layout,wrap?"wrap":"scroll"); },
    async peek(symbol,path,line,side) { await referencesReady; return resolvePeekSymbol(symbol,{path,line,side}); },
    theme() { schedule(); },
    conversation(id) { openConversation(id); },
    finding(id) { openFindingFromCode(id); },
    select(anchor) {
      state.selectedLine={...anchor,content:anchor.selectedText};
      renderQuestionScope();
      elements["selection-pill"].textContent=reviewAnchorLabel(anchor);
      elements["selection-pill"].classList.remove("hidden");
    },
    ask(anchor) {
      openConversation(null);
      this.select(anchor);
      elements["chat-input"].focus();
    },
  };
  renderDiff = function(files,options) {
    nativeReason = options?.proposalActivityId ? "Proposal preview uses the current renderer." : null;
    const result=native.renderDiff(files,options);schedule();return result;
  };
  revealCodeLocation = function(path,side,line,options) {
    if(usingMonaco()&&available(path)){void reveal(path,side,line);return true;}
    return native.revealCodeLocation(path,side,line,options);
  };
  showChangedFile = async function(path,line,side,...rest) {
    const result=await native.showChangedFile(path,line,side,...rest);
    if(result && state.visibleFile===path) {
      if(available(path)){nativeReason=null;await reveal(path,side,line);}
      else {nativeReason=null;sync();}
    }
    return result;
  };
  renderRepositoryFile = function(...args) {
    nativeReason="Current workspace source uses the current renderer.";
    const result=native.renderRepositoryFile(...args);sync();return result;
  };
  openCommentEditor = async function(comment) {
    if(preferred==="monaco" && available(comment.path) && (comment.scope??"line")==="line") {
      await showAnalysisFile(comment.path,comment.line,comment.side);
      child.editComment(comment);return;
    }
    return native.openCommentEditor(comment);
  };
  focusCurrentStep = async function() {
    const step=currentStep();
    if(preferred==="monaco" && child && state.tourMode && step && available(step.anchor.path) && !beforeTourFallback()){
      state.focusedStepId=step.id;
      if(state.session.comparison.diffMode==="file")await ensureTourPhaseDiffs();
      state.activeTab="diff";nativeReason=null;state.collapsedFiles.delete(step.anchor.path);
      renderActiveTab();renderTourAnnotation();
      sync();
      const focused = await child.focusTour(step);
      if(focused && state.activeTab === "diff" && state.tourMode && currentStep()?.id === step.id) frame.scrollIntoView({block:"start",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});
      return;
    }
    // A specialized media card does not change the renderer of the other files.
    // Explicit source/proposal fallbacks remain separate from tour navigation.
    if(step&&!available(step.anchor.path))nativeReason=null;
    sync();return native.focusCurrentStep();
  };
  changeDiffView = function(layout,wrap,persist) {
    if(child?.hasDraft() && state.diffLayout!==layout){
      toast("Finish or cancel the Monaco draft before switching layout.");return;
    }
    const result=native.changeDiffView(layout,wrap,persist);schedule();return result;
  };
  renderTourAnnotation = function(...args) { const result=native.renderTourAnnotation(...args);schedule();return result; };
  renderActiveTab = function(...args) { const result=native.renderActiveTab(...args);schedule();return result; };
  renderSessionUpdate = function(...args) { const result=native.renderSessionUpdate(...args);schedule();return result; };
  updateCurrentStepReturnVisibility = function() {
    native.updateCurrentStepReturnVisibility();
    const step=currentStep();
    if(!usingMonaco()||!state.tourMode||state.activeTab!=="diff"||!step||!available(step.anchor.path))return;
    const point=child.geometry(step.anchor.path,step.anchor.side,step.anchor.startLine);
    const bounds=frame.getBoundingClientRect(),panel=elements["diff-panel"].getBoundingClientRect();
    const visible=point&&bounds.top+point.bottom>panel.top&&bounds.top+point.top<Math.min(innerHeight,panel.bottom);
    elements["current-step-return"].classList.toggle("hidden",Boolean(visible));
  };
  select.addEventListener("change",()=>{
    preferred=select.value;nativeReason=null;
    sync();
    if(state.tourMode)void focusCurrentStep();
  });
  new MutationObserver(schedule).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
  window.addEventListener("resize", () => child?.resize());
  frame.addEventListener("load",()=>frame.contentWindow.addEventListener("scroll",scheduleCurrentStepReturnUpdate,true));
  frame.src="/prototype/index.html?embedded=1#token="+encodeURIComponent(state.apiToken);
  window.diffCompassIntegration={sync,reveal,get child(){return child;},get usingMonaco(){return Boolean(usingMonaco());}};
  sync();
}
