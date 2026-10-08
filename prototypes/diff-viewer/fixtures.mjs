const helpers = (count) => Array.from({ length: count }, (_, i) => `/** Format a display-only receipt field. */
export function receiptField${i + 1}(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "—";
  }
  return trimmed.slice(0, 80);
}
`).join("\n");
const start = `export interface Item {
  name: string;
  price: number;
  quantity: number;
}

export interface Discount {
  percentage: number;
}

export function subtotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function total(items: Item[], discount?: Discount): number {
  const amount = subtotal(items);
  if (!discount) return amount;
  return amount - discount.percentage;
}

`;
const end = `export function receipt(items: Item[], discount?: Discount): string {
  const amount = total(items, discount);
  return "Total: " + amount;
}

export function receiptHeading(customer: string): string {
  return "Receipt for " + customer;
}
`;
const old = start + helpers(9) + end;
const current = old.replace('  return amount - discount.percentage;', '  const percentage = Math.max(0, Math.min(100, discount.percentage));\n  return amount * (1 - percentage / 100);')
  .replace('  return "Total: " + amount;', '  return `Total: ${amount.toFixed(2)}`;');
export const files = [
  { path: "checkout.ts", language: "typescript", old, new: current },
  { path: "large.ts", language: "typescript", old: start + helpers(300) + end, new: current.replace(helpers(9), helpers(300)) },
  { path: "added.ts", language: "typescript", old: "", new: 'export function formatCurrency(value: number): string {\n  return value.toFixed(2);\n}\n' },
  { path: "removed.ts", language: "typescript", old: [
    'export function legacyDiscount(value: number): number {',
    '\treturn value - 10;',
    '}',
    '',
    '\tconst repeated = "café😀";',
    '\tconst repeated = "café😀";',
    `// Wrapped deleted source: ${'padding '.repeat(45)}WRAPPED_TARGET end`,
    '// last line without final newline',
  ].join('\r\n'), new: "" },
  { path: "notes.txt", language: "plaintext", old: 'Shipping policy\nLocal delivery\nInternational delivery\n', new: 'Shipping policy\nFree local delivery\nInternational delivery\n' },
];
// Two real edits separated by unchanged source. Unique names keep the existing
// receipt sequence's current-workspace name lookup unambiguous.
const contextBefore = Array.from({length:24}, (_, i) => `/** Normalize optional display field ${i + 1}. */
export function contextField${i + 1}(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "—";
  }
  return trimmed;
}
`).join("\n");
export const contextFixtureFile = {
  path: "src/context-example.ts",
  before: contextBefore,
  after: contextBefore.replace(/(export function contextField5\([\s\S]*?)return trimmed;/, '$1return trimmed.slice(0, 80);').replace(/(export function contextField20\([\s\S]*?)return trimmed;/, '$1return trimmed.toUpperCase();'),
};

export function locate(text, needle) {
  const index = text.split("\n").findIndex(line => line.includes(needle));
  if (index < 0) throw new Error(`Missing fixture anchor: ${needle}`);
  return index + 1;
}

export { sourceAnchor } from "../../public/monaco/source-anchor.mjs";
