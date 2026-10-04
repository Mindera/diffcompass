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
  { path: "removed.ts", language: "typescript", old: 'export function legacyDiscount(value: number): number {\n  return value - 10;\n}\n', new: "" },
  { path: "notes.txt", language: "plaintext", old: 'Shipping policy\nLocal delivery\nInternational delivery\n', new: 'Shipping policy\nFree local delivery\nInternational delivery\n' },
];
export function locate(text, needle) {
  const index = text.split("\n").findIndex(line => line.includes(needle));
  if (index < 0) throw new Error(`Missing fixture anchor: ${needle}`);
  return index + 1;
}

// The source identity is independent of DOM rows, folding, and editor layout.
export function sourceAnchor(file, side, selection) {
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
  const context = lines.slice(start - 1, end).join("\n");
  const lastColumn = end < selection.endLineNumber ? lines[end - 1].length + 1 : selection.endColumn;
  const selectedText = start === end
    ? lines[start - 1].slice(firstColumn - 1, lastColumn - 1)
    : lines.slice(start - 1, end).map((line, index) => index === 0 ? line.slice(firstColumn - 1) : index === end - start ? line.slice(0, lastColumn - 1) : line).join("\n");
  return { path: file.path, side, line: start, endLine: end, content: lines[start - 1], selectedText: selectedText.trim() ? selectedText : context, context };
}
