import { expect, test } from "bun:test";

const runtime = await Bun.file(new URL('../public/sequence-walkthrough.js', import.meta.url)).text();
const window: any = {};
new Function('window', runtime)(window);
const group = window.DiffCompassSequenceWalkthrough.excerptGroups;
const token = (content: string) => ({ content, light: '123456', dark: 'abcdef', fontStyle: 0 });
const anchor = (startLine: number, text: string, extra: any = {}) => ({
  path: 'src/cart.ts', side: 'new', startLine, endLine: startLine + text.split('\n').length - 1, quote: text,
  preview: { language: 'typescript', kinds: text.split('\n').map(() => 'addition'), tokens: text.split('\n').map(line => [token(line)]) }, ...extra,
});

test('adjacent captured excerpts form one listing with original tokens, line kinds and navigation index', () => {
  const before = anchor(15, 'old', { side: 'old' });
  const input = [before, anchor(17, 'return amount - discount;'), anchor(16, 'if (!discount) return amount;')];
  const saved = structuredClone(input), groups = group(input);
  expect(groups).toHaveLength(2);
  expect(groups[0].anchor).toBe(before);
  expect(groups[1].anchorIndex).toBe(2); // Lowest source line, not display/group index.
  expect(groups[1].anchorIndices).toEqual([1, 2]);
  expect(groups[1].anchor.startLine).toBe(16); expect(groups[1].anchor.endLine).toBe(17);
  expect(groups[1].anchor.quote).toBe('if (!discount) return amount;\nreturn amount - discount;');
  expect(groups[1].anchor.preview.kinds).toEqual(['addition', 'addition']);
  expect(groups[1].anchor.preview.tokens).toEqual([input[2]!.preview.tokens[0], input[1]!.preview.tokens[0]]);
  expect(input).toEqual(saved); // Display grouping must never rewrite saved evidence.
});

test('identical overlaps, duplicates and bridging ranges coalesce without repeating or inventing source lines', () => {
  const inputs = [anchor(16, 'a\nb'), anchor(17, 'b\nc'), anchor(16, 'a'), anchor(20, 'e'), anchor(19, 'd')];
  const groups = group(inputs);
  expect(groups).toHaveLength(1); expect(groups[0].anchor.quote).toBe('a\nb\nc\nd\ne');
  expect(groups[0].anchor.preview.kinds).toHaveLength(5); expect(groups[0].anchorIndex).toBe(0);
  expect(groups[0].anchorIndices).toEqual([0, 1, 2, 3, 4]);
  expect(group([anchor(16, 'a'), anchor(18, 'c')])).toHaveLength(2);
  expect(group([anchor(16, 'a\nb'), anchor(17, 'conflict')])).toHaveLength(2);
});

test('different files, source sides, languages and definition candidates remain distinct', () => {
  const first = anchor(16, 'a');
  for (const next of [
    anchor(17, 'b', { path: 'src/other.ts' }),
    anchor(17, 'b', { side: 'old' }),
    anchor(17, 'b', { preview: { language: 'text', kinds: ['unknown'] } }),
    anchor(17, 'b', { definition: true }),
    anchor(17, 'b', { definition: true, comparisonMatch: true }),
  ]) expect(group([first, next])).toHaveLength(2);
  for (const comparisonMatch of [false, true]) {
    expect(group([anchor(16, 'a', { definition: true, comparisonMatch }), anchor(17, 'b', { definition: true, comparisonMatch })])).toHaveLength(2);
  }
  const old = group([anchor(16, 'a', { side: 'old' }), anchor(17, 'b', { side: 'old' })]);
  expect(old).toHaveLength(1); expect(old[0].anchor.side).toBe('old');
});

test('grouping retains plain-text fallback and literal markup, including unknown change kinds', () => {
  const groups = group([anchor(16, '<script>', { preview: undefined }), anchor(17, '</script>', { preview: undefined })]);
  expect(groups).toHaveLength(1); expect(groups[0].anchor.quote).toBe('<script>\n</script>');
  expect(groups[0].anchor.preview.kinds).toEqual(['unknown', 'unknown']);
  expect(groups[0].anchor.preview.tokens).toEqual([undefined, undefined]);
});

test('group bounds retain all source data in separate listings instead of silently truncating the union', () => {
  const twenty = anchor(1, Array(20).fill('line').join('\n'));
  expect(group([twenty, anchor(21, 'next')])).toHaveLength(2);
  expect(group([anchor(1, 'x'.repeat(4000)), anchor(2, 'y'.repeat(4000))])).toHaveLength(2);
  const groups = group(Array.from({ length: 9 }, (_, index) => anchor(index + 1, String(index))));
  expect(groups).toHaveLength(1); expect(groups[0].anchor.quote.split('\n')).toHaveLength(8);
  expect(groups[0].anchor.endLine).toBe(8); expect(group([])).toEqual([]);
});

test('invalid or incomplete line ranges cannot gain a merged range', () => {
  for (const extra of [{ startLine: 0 }, { startLine: 1.5 }, { endLine: 19 }, { endLine: 15 }, { side: 'current' }, { quote: undefined }]) {
    expect(group([anchor(16, 'a', extra), anchor(17, 'b')])).toHaveLength(2);
  }
});
