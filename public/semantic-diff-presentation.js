/* Shared presentation only: the parser and captured-source model remain authoritative.
 * Keep the factory self-contained: the server embeds its source in the browser module. */
export function createSemanticPresentation() {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const htmlCode = (value) => `<code>${esc(value)}</code>`;
  function kindLabel(change) {
    if (change.kind === "property declaration") return change.scope === "local" ? "variable" : "property";
    if (/function|method/.test(change.kind)) return "function";
    if (/interface/.test(change.kind)) return "interface";
    if (/class/.test(change.kind)) return "class";
    if (/property|field/.test(change.kind)) return "field";
    return ({ "variable declarator": "variable", "type alias declaration": "type", "type alias": "type", "enum declaration": "enum", "object declaration": "object", "internal module": "namespace" })[change.kind] ?? "declaration";
  }
  const categoryLabel = (category) => ({ added: "Added", removed: "Removed", signature: "Declaration changed", body: "Code or value changed" })[category] ?? category;
  const scope = "Based on the saved before and after code. Review the diff to assess behaviour.";
  function explanationHtml(path, explanation, { offline = false } = {}) {
    const entries = explanation?.entries ?? [];
    const message = explanation?.message ?? "No explanation for this file yet. Start a tour or ask the agent about this change.";
    return `<div class="semantic-intro"><h3>What changed</h3></div>${entries.map((entry, entryIndex) => `<section class="semantic-narrative">${entries.length > 1 ? `<p class="muted">${esc(entry.phase)}</p>` : ""}<p>${esc(entry.summary)}</p>${entry.steps.length ? `<details><summary>Related tour stops</summary><ul>${entry.steps.map((step, stepIndex) => `<li>${offline ? `<span>${esc(step.title)} — ${esc(step.anchor.side === "old" ? "Before" : "After")} ${esc(step.anchor.path)}:${step.anchor.startLine}–${step.anchor.endLine}</span>` : `<button type="button" class="text-button" data-semantic-explanation-anchor="${entryIndex}:${stepIndex}">View code: ${esc(step.title)}</button>`}</li>`).join("")}</ul></details>` : ""}</section>`).join("")}<p class="semantic-scope muted" role="status">${esc(message)}</p>${explanation?.omitted ? `<p class="muted">${explanation.omitted} additional tour notes are not shown here.</p>` : ""}${explanation?.source ? `<details class="semantic-explanation-evidence"><summary>Explanation source</summary><p>Before tree: <code>${esc(explanation.source.beforeTree)}</code><br>After tree: <code>${esc(explanation.source.afterTree)}</code><br>Comparison identity: <code>${esc(explanation.source.identity)}</code></p></details>` : ""}${offline ? "" : `<button type="button" class="text-button" data-semantic-explain="${esc(path)}">${entries.length ? "Ask a follow-up about this file" : "Ask agent about this file"}</button>`}`;
  }
  function summaryHtml(summary, { offline = false, explanation = summary.explanation } = {}) {
    const code = htmlCode;
    const changes = summary.changes;
    const anchor = (value, index) => value ? offline ? `<span>${esc(`${value.side === "old" ? "Before" : "After"} ${value.path}:${value.startLine}–${value.endLine}`)}</span>` : `<button type="button" class="text-button" data-semantic-anchor="${index}" data-semantic-side="${value.side}" aria-label="${value.side === "old" ? "Before" : "After"}: ${esc(value.path)}:${value.startLine}" title="${esc(value.path)}:${value.startLine}">${value.side === "old" ? "View before" : "View after"}</button>` : "";
    const links = (change, index) => `<div class="semantic-source-links">${anchor(change.before, index)}${anchor(change.after, index)}</div>`;
    const status = summaryStatus(summary);
    return `${explanationHtml(summary.path, explanation, { offline })}
      ${summary.status !== "analysed" || !changes.length ? `<p class="semantic-scope muted">Code details: ${esc(status[0])}${status[1] ? `. ${esc(status[1])}` : ""}</p>` : ""}
      ${summary.status === "unavailable" && !offline ? `<button type="button" data-semantic-retry="${esc(summary.path)}">Try again</button>` : ""}
      ${summary.renamed ? '<p class="muted">This file was renamed. Its before and after paths are preserved.</p>' : ""}
      ${summary.totalChanges > changes.length ? `<p class="semantic-caution">Showing ${changes.length} of ${summary.totalChanges} code changes. Use the diff for the rest.</p>` : ""}
      ${changes.length ? `<details class="semantic-code-details"><summary>All code details (${changes.length} items)</summary><p class="muted">Parsed declarations, including properties and local variables. ${scope}</p><ol>${changes.map((change, index) => `<li><strong>${code(change.name)}</strong> <span class="muted">· ${esc(kindLabel(change))}</span><p>${change.categories.map((category) => esc(categoryLabel(category))).join(" · ")}</p>${change.ambiguous ? '<p class="semantic-caution">Ambiguous overload match; these versions were not paired.</p>' : ""}${links(change, index)}${[change.before, change.after].filter(Boolean).map((value) => `<div class="semantic-code-version"><span class="muted">${value.side === "old" ? "Before" : "After"}</span><pre>${esc(value.signature)}</pre></div>`).join("")}</li>`).join("")}</ol></details>` : ""}
      <details class="semantic-evidence"><summary>How this summary was made</summary><p>${esc(summary.message)}</p><p>${esc(summary.notice)}</p><p>${esc(summary.engine)} · ${esc(summary.language ?? "unsupported language")} · ${offline ? "Parser licences are included with DiffCompass." : '<a href="/semantic-diff-notices.txt" target="_blank" rel="noopener">Parser licences</a>'}</p><p>Before tree: ${code(summary.beforeTree)}<br>After tree: ${code(summary.afterTree ?? "not captured")}</p><p>SHA-256 before: ${code(summary.beforeHash ?? "unavailable")}<br>SHA-256 after: ${code(summary.afterHash ?? "unavailable")}</p><p>Computed on request or during tour preparation; the parser summary is not saved in the review. Exports include requested summaries still in the server cache (up to 32 files), labelled with coverage.</p></details>`;
  }
  function summaryStatus(summary) {
    const states = {
      unsupported: ["This file type isn’t supported", "Parser details support TypeScript, TSX and Kotlin. Other languages, or a rename between different languages, need the text diff."],
      "parse-error": ["Couldn’t read all of this code", "The file may contain invalid code or syntax the parser doesn’t support. Use the text diff; no partial summary is shown."],
      unavailable: ["Summary unavailable", "The saved code couldn’t be summarized. Check the details, or try again in the live review. The text diff is still available."],
      limited: ["This file exceeds the summary limits", "The file is too large, complex or slow to summarize within the analysis limits. Use the text diff."],
      generated: ["Generated code — summary skipped", "This file is marked as generated. Review the text diff or the generator source."],
    };
    return summary.status === "analysed" ? [summary.changes.length ? "What changed" : "No declaration changes found", summary.changes.length ? "" : summary.message] : states[summary.status] ?? states.unavailable;
  }
  return { escape: esc, kindLabel, summaryStatus, categoryLabel, scope, explanationHtml, summaryHtml };
}
export const semanticPresentation = createSemanticPresentation();
