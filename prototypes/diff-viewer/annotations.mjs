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
  const source = Object.fromEntries(["old", "new"].map(side => [side, file[side].split(/\r?\n/)]));
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

// Pinned Monaco 0.55.1 serialized view state; reject unfamiliar shapes instead
// of applying a range to the wrong region. Other regions/viewport stay intact.
export function collapsedRegionState(state, defaults, index) {
  const regions = state?.modelState?.collapsedRegions;
  if (!Array.isArray(regions) || !Array.isArray(defaults) || regions.length !== defaults.length || !defaults[index] || regions.some(r => !r || typeof r !== "object")) return null;
  if (![...regions.map(r => r.range), ...defaults].every(r => Array.isArray(r) && r.length === 2 && r.every(Number.isSafeInteger) && r[0] >= 1 && r[1] >= r[0])) return null;
  return { ...state, modelState: { ...state.modelState, collapsedRegions: regions.map((region, i) => i === index ? { ...region, range: [...defaults[i]] } : region) } };
}
