import { expect, test } from "bun:test";
import { highlightedSequenceSources, sequencePreviewGroups, sequenceSourcePreviews } from "../src/sequence-walkthrough-preview.ts";
import { validateSequenceSources } from "../src/sequence-sources.ts";
import type { GitComparison, SequenceSourceAnchor } from "../src/types.ts";

const comparison = { files: [{ path: "after.ts", oldPath: "before.ts", hunks: [{ rows: [
  { kind: "context", oldLine: 10, newLine: 10, content: "const shared = 1;" },
  { kind: "deletion", oldLine: 11, newLine: null, content: "return '<old>';" },
  { kind: "addition", oldLine: null, newLine: 11, content: "return '<new>';" },
] }] }] } as GitComparison;
const before: SequenceSourceAnchor = { path: "before.ts", side: "old", startLine: 10, endLine: 11, quote: "const shared = 1;\nreturn '<old>';" };
const after: SequenceSourceAnchor = { ...before, path: "after.ts", side: "new", quote: "const shared = 1;\nreturn '<new>';" };

test('previews reuse captured old/new rows and the existing dual-theme syntax highlighter', async () => {
  const result = await highlightedSequenceSources({ repeat: [before, after] }, comparison);
  expect(result.repeat!.map(anchor => anchor.preview!.kinds)).toEqual([['context', 'deletion'], ['context', 'addition']]);
  expect(result.repeat!.map(({ preview, ...anchor }) => anchor)).toEqual([before, after]);
  for (const anchor of result.repeat!) {
    expect(anchor.preview!.language).toBe('typescript');
    expect(anchor.preview!.tokens!.map(line => line.map(token => token.content).join('')).join('\n')).toBe(anchor.quote);
    expect(new Set(anchor.preview!.tokens!.flat().map(token => token.dark)).size).toBeGreaterThan(1);
  }
});

test('unmatched current candidates, stale quotes and wrong source identities cannot gain change markers', () => {
  const result = sequenceSourcePreviews({ candidates: [
    { ...after, definition: true }, { ...after, quote: 'stale source' }, { ...after, path: 'before.ts' },
    { ...after, definition: true, comparisonMatch: true },
  ] }, comparison);
  expect(result.candidates!.slice(0, 3).every(anchor => anchor.preview!.kinds.every(kind => kind === 'unknown'))).toBe(true);
  expect(result.candidates![3]!.preview!.kinds).toEqual(['context', 'addition']);
});

test('unknown languages, failed highlighting and stale token groups preserve readable plain source', async () => {
  const unknown = { ...after, path: 'data.unknown-extension' };
  expect(sequencePreviewGroups({ unknown: [unknown] })).toEqual([]);
  const plain = await highlightedSequenceSources({ unknown: [unknown], after: [after] }, comparison, async () => { throw new Error('unavailable'); });
  expect(plain.unknown![0]!.preview!.language).toBe('text');
  expect(plain.after![0]!.preview!.tokens).toBeUndefined();
  expect(plain.after![0]!.preview!.kinds).toEqual(['context', 'addition']);
  const group = sequencePreviewGroups({ after: [after] }, 'artifact')[0]!;
  const stale = sequenceSourcePreviews({ after: [after] }, comparison, [{ id: group.id, lines: [[{ content: 'wrong', light: 'ffffff', dark: '000000', fontStyle: 0 }]] }], 'artifact');
  expect(stale.after![0]!.preview!.tokens).toBeUndefined();
  expect(stale.after![0]!.quote).toBe(after.quote);
});

test('preview and token work stays bounded independently of oversize input', () => {
  const huge = { ...after, startLine: 1, endLine: 30, quote: 'x'.repeat(9000) + '\n' + Array(29).fill('line').join('\n') };
  const sources = Object.fromEntries(Array.from({ length: 41 }, (_, index) => ['m' + index, Array(9).fill(huge)]));
  const groups = sequencePreviewGroups(sources);
  expect(groups.reduce((sum, group) => sum + group.lines.join('\n').length, 0)).toBeLessThanOrEqual(200_000);
  expect(groups.every(group => group.lines.length <= 20 && group.lines.join('\n').length <= 8000)).toBe(true);
  const previews = sequenceSourcePreviews(sources, comparison);
  expect(Object.keys(previews)).toHaveLength(40); expect(previews.m39).toHaveLength(8);
  expect(sequenceSourcePreviews({}, comparison)).toEqual({});
});

test('display metadata cannot persist as authored message evidence', () => {
  const preview = sequenceSourcePreviews({ edge: [after] }, comparison).edge![0]!;
  expect(validateSequenceSources([{ message: 1, label: 'run()', anchors: [preview] }], 'sequenceDiagram\nA->>B: run()')![0]!.anchors).toEqual([after]);
});
