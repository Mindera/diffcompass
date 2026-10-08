// Layout only: unchanged Before/After anchors can occupy one visual row.
// Never rewrite the source identity using this display coordinate.
export function badgeDisplayRow(anchor, unified, changes) {
  const original = `${anchor.side}:${anchor.line}`;
  if (!unified || anchor.side !== "old" || !changes) return original;
  let delta = 0;
  for (const change of changes) {
    const start = change.originalStartLineNumber, end = change.originalEndLineNumber;
    if (end === 0 ? anchor.line <= start : anchor.line < start) break;
    if (end && anchor.line <= end) return original;
    delta = (change.modifiedEndLineNumber || change.modifiedStartLineNumber) - (end || start);
  }
  return `new:${anchor.line + delta}`;
}

// A Before range can cross deleted blocks and unchanged rows, separated by
// inserted After code. Project each contiguous piece, never highlight those
// insertions or substitute After coordinates in the saved tour anchor.
export function tourDisplaySegments(anchor, unified, changes) {
  if (unified && anchor.side === "old" && changes === null) return [];
  const segments = [];
  for (let line = anchor.startLine; line <= anchor.endLine; line++) {
    const [side, value] = badgeDisplayRow({ side: anchor.side, line }, unified, changes).split(":");
    const displayLine = Number(value), deleted = unified && side === "old";
    const previous = segments.at(-1);
    if (previous?.side === side && previous.deleted === deleted && previous.endLine + 1 === displayLine) {
      previous.endLine = displayLine; previous.sourceEndLine = line;
    } else segments.push({ side, deleted, startLine: displayLine, endLine: displayLine, sourceStartLine: line, sourceEndLine: line });
  }
  return segments;
}

// Pointer coordinates come from Monaco's source mapping, not pixel/character
// arithmetic: tabs, Unicode and wrapped lines must keep their real columns.
export function freeTextRange(model, first, last, { tap = false } = {}) {
  const compare = (a, b) => a.lineNumber - b.lineNumber || a.column - b.column;
  for (const point of [first, last]) {
    if (!point || !Number.isSafeInteger(point.lineNumber) || !Number.isSafeInteger(point.column)
      || point.lineNumber < 1 || point.lineNumber > model.getLineCount()
      || point.column < 1 || point.column > model.getLineMaxColumn(point.lineNumber)) throw Error("Select text within the same source pane.");
  }
  if (tap) {
    const word = model.getWordAtPosition(first);
    last = { ...first, column: word?.endColumn ?? first.column };
    first = { ...first, column: word?.startColumn ?? first.column };
  }
  const [start, end] = [first, last].sort(compare);
  if (end.lineNumber - start.lineNumber - (end.column === 1 ? 1 : 0) >= 100) throw Error("Select up to 100 source lines.");
  return { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
}

// The source identity is independent of DOM rows, folding, and editor layout.
export function sourceAnchor(file, side, selection, { preserveEol = false } = {}) {
  if (!["old", "new"].includes(side)) throw new Error("Invalid source side");
  if (!file[side]) throw new Error("This side has no source");
  const lines = file[side].split(/\r?\n/);
  const start = selection.startLineNumber;
  const rawEnd = selection.endLineNumber;
  const firstColumn = selection.startColumn;
  const endColumn = selection.endColumn;
  if (![start, rawEnd, firstColumn, endColumn].every(Number.isSafeInteger) || start < 1 || rawEnd < start || rawEnd > lines.length || firstColumn < 1 || endColumn < 1 || firstColumn > lines[start - 1].length + 1 || endColumn > lines[rawEnd - 1].length + 1 || (start === rawEnd && endColumn < firstColumn)) throw new Error("Invalid source selection");
  const end = selection.endLineNumber > start && selection.endColumn === 1 ? selection.endLineNumber - 1 : selection.endLineNumber;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > lines.length || end - start > 99) throw new Error("Select 1–100 source lines");
  const evidenceLines = preserveEol ? file[side].split("\n") : lines;
  const context = evidenceLines.slice(start - 1, end).join("\n");
  const lastColumn = end < selection.endLineNumber ? lines[end - 1].length + 1 : selection.endColumn;
  const selectedText = start === end
    ? evidenceLines[start - 1].slice(firstColumn - 1, lastColumn - 1)
    : evidenceLines.slice(start - 1, end).map((line, index) => index === 0 ? line.slice(firstColumn - 1) : index === end - start ? line.slice(0, lastColumn - 1) : line).join("\n");
  return { path: file.path, side, line: start, endLine: end, content: evidenceLines[start - 1], selectedText: (preserveEol ? selectedText.length : selectedText.trim()) ? selectedText : context, context };
}

// Suggestions replace complete source lines, even when the selected quote is
// only part of a line. Never edit an empty Before/After placeholder or EOF row.
export function suggestedEditTarget(file, anchor) {
  if (!anchor || anchor.path !== file.path || anchor.side !== "new" || file.status === "deleted") throw new Error("Select a line or range on the After side to suggest an edit.");
  const content = file.new.replaceAll("\r\n", "\n"), lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  const { line, endLine = line } = anchor;
  if (!content || !Number.isSafeInteger(line) || !Number.isSafeInteger(endLine) || line < 1 || endLine < line || endLine > lines.length || endLine - line >= 100) throw new Error("Select 1–100 existing After source lines.");
  return { path: file.path, side: "new", line, endLine, expectedContent: lines.slice(line - 1, endLine).join("\n") };
}

// A fragment lifted out of Markdown loses the fence that selects its embedded
// tokenizer. Use that language only when all selected lines are inside one
// fenced block; prose and selections containing fence markers stay Markdown.
export function suggestedEditLanguage(file, target, languages) {
  if (file.language !== "markdown") return file.language;
  const lines = file.new.split(/\r?\n/), endLine = target.endLine ?? target.line;
  const resolve = hint => languages.find(language =>
    [language.id, ...(language.aliases || []), ...(language.extensions || []).map(extension => extension.slice(1))]
      .some(name => name.toLowerCase() === hint.toLowerCase()))?.id || file.language;
  let fence = null;
  for (let index = 0; index < lines.length; index++) {
    const line = index + 1;
    if (!fence) {
      const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[index]);
      if (!opening || (opening[1][0] === "`" && opening[2].includes("`"))) continue;
      fence = { marker: opening[1][0], length: opening[1].length, line, hint: opening[2].trim().split(/\s+/)[0] };
    } else {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[index]);
      if (!closing || closing[1][0] !== fence.marker || closing[1].length < fence.length) continue;
      if (target.line > fence.line && endLine < line) return resolve(fence.hint);
      fence = null;
    }
  }
  // Markdown permits an unclosed fence to continue to the end of the file.
  return fence && target.line > fence.line ? resolve(fence.hint) : file.language;
}

// Patch coordinates are relative to the captured After file, not the main
// comparison's Before side. Never attach an old proposal to unrelated lines.
export function suggestionMatchesSource(file, suggestion) {
  if (suggestion.path !== file.path || file.status === "deleted") return false;
  const lines = file.new.replaceAll("\r\n", "\n").split("\n");
  if (file.new.endsWith("\n")) lines.pop();
  const context = suggestion.context, expected = context.content.split("\n");
  return Number.isSafeInteger(suggestion.afterLine) && suggestion.afterLine >= 0 && suggestion.afterLine <= lines.length &&
    Number.isSafeInteger(context.line) && context.line >= 1 &&
    lines.slice(context.line - 1, context.line - 1 + expected.length).join("\n") === context.content;
}
