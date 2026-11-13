import { loadCapturedSource } from "./diff-sources.ts";
import { ReviewError } from "./errors.ts";
import { tourSteps } from "./tour.ts";
import type { GitComparison, TourAnchor, TourExplanation, TourNote, TourOutline, TourStep } from "./types.ts";

export class TourExplanationError extends ReviewError {}
const text = (value: unknown, max: number): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= max;
const kinds = new Set(["decision", "upkeep", "limitation", "divergence", "test-gap"]);

export const TOUR_READING_PROMPT = `Return JSON with {"summary":"2–4 short sentences, at most 100 words", "detail":"optional additional explanation in Markdown", "notes":[]}.
The summary must stand alone. Put deeper mechanics in detail without repeating the summary. Detail is optional, at most 600 words. Use short active sentences and plain technical language.
Most stops need no notes. At most two notes per stop, only when useful and supported by inspected repository evidence. A note has {"kind":"decision|upkeep|limitation|divergence|test-gap", "text":"concise observation", "scope":"required for test-gap: exact inspected test files and cases", "sources":[{"anchor":{"path":"repo-relative path","side":"new","startLine":1,"endLine":2},"quote":"exact complete source lines"}]}.
Inspect captured source, callers, guards, and tests before making behavioral claims, including questions. A payload-free state does not prove a transition is reachable. Do not invent intent or alternative designs. For divergence cite both implementations. A test-gap is limited to named, inspected cases, never an assertion that no tests exist anywhere. Quotes are checked against captured Git source; they establish provenance, not proof of your inference. Do not pad the tour with notes or questions. Return only the finished reviewer-facing JSON; keep tool/progress commentary separate. Do not predict the next stop or add navigation instructions.`;

/** Plain text remains readable for existing attached agents and saved sessions. */
export async function parseTourExplanation(message: string, comparison?: GitComparison): Promise<TourExplanation> {
  let raw = message.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*)\n```$/.exec(raw);
  if (fenced && /^[{[]/.test(fenced[1]!.trim())) raw = fenced[1]!.trim();
  if (!/^[{[]/.test(raw)) {
    if (!text(raw, 50_000)) throw new TourExplanationError("The explanation is empty or too long.");
    const paragraphs = raw.split(/\n\s*\n/);
    return { summary: paragraphs.shift()!, ...(paragraphs.length ? { detail: paragraphs.join("\n\n") } : {}) };
  }
  let value: TourExplanation;
  try { value = JSON.parse(raw); } catch { throw new TourExplanationError("Return valid explanation JSON."); }
  if (!value || !text(value.summary, 4_000) || value.summary.trim().split(/\s+/).length > 100 || (value.detail !== undefined && (!text(value.detail, 20_000) || value.detail.trim().split(/\s+/).length > 600))) throw new TourExplanationError("Use a summary of at most 100 words and optional detail of at most 600 words.");
  if (value.notes !== undefined && (!Array.isArray(value.notes) || value.notes.length > 2)) throw new TourExplanationError("Supply at most two grounded notes; omit notes when unnecessary.");
  const notes: TourNote[] = [];
  const sources = new Map<string, ReturnType<typeof loadCapturedSource>>();
  for (const note of value.notes ?? []) {
    if (!note || !kinds.has(note.kind) || !text(note.text, 2_000) || (note.scope !== undefined && !text(note.scope, 2_000)) || (note.kind === "test-gap" && !text(note.scope, 2_000)) || !Array.isArray(note.sources) || note.sources.length < (note.kind === "divergence" ? 2 : 1) || note.sources.length > 4) throw new TourExplanationError("Each note needs inspected source quotes; test-gap also needs its inspected scope, divergence needs both sources.");
    const checked: TourNote["sources"] = [];
    for (const source of note.sources) {
      const a = source?.anchor as TourAnchor | undefined;
      if (!comparison || !a || !text(a.path, 4_096) || !["old", "new"].includes(a.side) || !Number.isSafeInteger(a.startLine) || !Number.isSafeInteger(a.endLine) || a.startLine < 1 || a.endLine < a.startLine || a.endLine - a.startLine > 100 || !text(source.quote, 20_000)) throw new TourExplanationError("Use bounded source anchors with exact complete-line quotes.");
      const key = `${a.side}:${a.path}`;
      let captured;
      try {
        if (!sources.has(key)) sources.set(key, loadCapturedSource(comparison, a.side, a.path));
        captured = await sources.get(key)!;
      } catch { throw new TourExplanationError(`Cannot verify note source ${a.path}. Omit the unsupported note or use captured source.`); }
      const lines = captured.text.split("\n");
      if (lines.at(-1) === "") lines.pop();
      if (a.endLine > lines.length) throw new TourExplanationError(`Note range exceeds captured source ${a.path}.`);
      const quote = lines.slice(a.startLine - 1, a.endLine).join("\n");
      if (!quote || quote !== source.quote || !captured.blob) throw new TourExplanationError(`Note quote does not match ${a.path}:${a.startLine}-${a.endLine}. Inspect the captured source; do not invent evidence.`);
      checked.push({ anchor: { path: a.path, side: a.side, startLine: a.startLine, endLine: a.endLine }, quote, blob: captured.blob });
    }
    notes.push({ kind: note.kind, text: note.text.trim(), ...(note.scope ? { scope: note.scope.trim() } : {}), sources: checked });
  }
  return { summary: value.summary.trim(), ...(value.detail ? { detail: value.detail.trim() } : {}), ...(notes.length ? { notes } : {}) };
}

export function explanationFields(value: TourExplanation): Pick<TourStep, "explanation" | "explanationDetail" | "notes"> {
  return { explanation: value.summary, explanationDetail: value.detail, notes: value.notes };
}

/** Changed supporting files invalidate notes too, even when their displayed quote survives. */
export async function reconcileTourNotes(outline: TourOutline | undefined, comparison: GitComparison): Promise<void> {
  const sources = new Map<string, Promise<string | null>>();
  for (const step of tourSteps(outline)) for (const note of step.notes ?? []) {
    note.outdated = Boolean(step.outdated) || !note.sources?.length;
    for (const source of note.sources ?? []) {
      const key = `${source.anchor.side}:${source.anchor.path}`;
      if (!sources.has(key)) sources.set(key, loadCapturedSource(comparison, source.anchor.side, source.anchor.path).then(value => value.blob).catch(() => null));
      if (!source.blob || await sources.get(key) !== source.blob) note.outdated = true;
    }
  }
}
