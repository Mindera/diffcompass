import { highlightGroups, knownLanguageForPath, type HighlightGroup, type HighlightToken } from "./highlight.ts";
import { sequenceAnchorEvidence } from "./sequence-sources.ts";
import type { GitComparison, SequenceSourceAnchor } from "./types.ts";

type Sources = Record<string, SequenceSourceAnchor[]>;
type Highlighted = Array<{ id: string; lines: HighlightToken[][] }>;
const excerptLines = (anchor: SequenceSourceAnchor) => anchor.quote.slice(0, 8000).split("\n").slice(0, 20);
const groupId = (prefix: string, edge: string, index: number) => JSON.stringify(["sequence", prefix, edge, index]);

/** Feed the existing highlighter; every excerpt is an independent syntax unit. */
export function sequencePreviewGroups(sources: Sources, prefix = ""): HighlightGroup[] {
  let remaining = 200_000;
  return Object.entries(sources).slice(0, 40).flatMap(([edge, anchors]) => anchors.slice(0, 8).flatMap((anchor, index) => {
    const lines = excerptLines(anchor), size = lines.join("\n").length;
    if (!knownLanguageForPath(anchor.path) || size > remaining) return [];
    remaining -= size;
    return [{ id: groupId(prefix, edge, index), path: anchor.path, lines }];
  }));
}

/** Derive presentation from captured rows, without changing source identities. */
export function sequenceSourcePreviews(sources: Sources, comparison: GitComparison, highlighted: Highlighted = [], prefix = ""): Sources {
  const tokens = new Map(highlighted.map(group => [group.id, group.lines]));
  return Object.fromEntries(Object.entries(sources).slice(0, 40).map(([edge, anchors]) => [edge, anchors.slice(0, 8).map((anchor, index) => {
    const lines = excerptLines(anchor);
    const rows = anchor.definition && !anchor.comparisonMatch ? undefined : sequenceAnchorEvidence(anchor, comparison).rows;
    const kinds = lines.map((_, index): NonNullable<SequenceSourceAnchor["preview"]>["kinds"][number] => {
      const kind = rows?.[index]?.kind;
      return kind === "addition" || kind === "deletion" || kind === "context" ? kind : "unknown";
    });
    const language = knownLanguageForPath(anchor.path);
    const candidate = tokens.get(groupId(prefix, edge, index));
    // Reject stale/misaligned token groups; plain source remains authoritative.
    const matched = language && candidate?.length === lines.length && candidate.every((row, index) => row.map(token => token.content).join("") === lines[index]);
    return { ...anchor, preview: { language: language ?? "text", kinds, ...(matched ? { tokens: candidate } : {}) } };
  })]));
}

export async function highlightedSequenceSources(sources: Sources, comparison: GitComparison, highlight = highlightGroups): Promise<Sources> {
  const groups = sequencePreviewGroups(sources);
  try {
    return sequenceSourcePreviews(sources, comparison, groups.length ? await highlight(groups, "diffcompass") : []);
  } catch {
    // A highlighting failure must not break source navigation or plain previews.
    return sequenceSourcePreviews(sources, comparison);
  }
}
