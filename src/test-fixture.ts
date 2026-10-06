import { domainFixtureModel, domainFixtureText } from "./domain-fixture.ts";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { runProcess } from "./process.ts";
import { loadPersistedSession, savePersistedSession } from "./store.ts";
import { loadComparison } from "./git.ts";
import { comparisonFingerprint, dryRunFlowFingerprint } from "./dry-runs.ts";
import { ArchifyRenderer } from "./archify.ts";
import type { GitComparison, PersistedReviewSession } from "./types.ts";

const FIXTURE_SCHEMA = 5;
const FIXTURE_DIRECTORY = "diffcompass-test-fixture-v2";
const FIXTURE_TIME = "2026-08-13T10:00:00.000Z";

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(pngCrc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function receiptPng(accent: [number, number, number]): Buffer {
  const width = 480;
  const height = 240;
  const stride = width * 4 + 1;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    pixels[y * stride] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = y * stride + 1 + x * 4;
      const receipt = x >= 105 && x < 375 && y >= 14 && y < 226;
      const shadow = x >= 111 && x < 381 && y >= 20 && y < 232;
      const heading = x >= 143 && x < 337 && y >= 38 && y < 52;
      const item = x >= 135 && x < 345 && ((y >= 78 && y < 86) || (y >= 105 && y < 113) || (y >= 132 && y < 140));
      const rule = x >= 130 && x < 350 && y >= 166 && y < 169;
      const total = x >= 130 && x < 350 && y >= 184 && y < 204;
      const color = total ? accent : heading ? [30, 41, 59] : item ? [123, 137, 155] : rule ? [203, 213, 225] : receipt ? [248, 250, 252] : shadow ? [15, 23, 42] : [0, 0, 0];
      pixels[offset] = color[0]!;
      pixels[offset + 1] = color[1]!;
      pixels[offset + 2] = color[2]!;
      pixels[offset + 3] = receipt || shadow ? 255 : 0;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const baseFiles = {
  "CONTEXT.md": domainFixtureText,
  "screens/receipt.png": receiptPng([100, 116, 139]),
  "README.md": "# Checkout\n\nThe checkout returns a numeric total.\n",
  "docs/checkout-guide.md": `# Checkout guide

The checkout calculates a numeric total for the supplied items.

## Supported inputs

| Input | Required |
| --- | --- |
| Items | Yes |
`,
  "src/cart.ts": `export interface Item {
  price: number;
  quantity: number;
}

export function total(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
`,
};

const workingFiles = {
  "screens/receipt.png": receiptPng([22, 163, 74]),
  "README.md": "# Checkout fixture\n\nThis fixture exercises guided tours, findings, comments, flows, and activity.\n",
  "docs/checkout-guide.md": `# Checkout guide

The checkout calculates a discount-aware total and formats it for a receipt.

## Supported inputs

| Input | Required | Behaviour |
| --- | --- | --- |
| Items | Yes | Their prices and quantities form the subtotal. |
| Discount | No | A fractional percentage reduces the subtotal. |

## Result

The receipt presents the resulting amount with two decimal places.
`,
  "docs/preview.md": `# Markdown preview

This document exercises the rendered **Markdown preview** in the review UI.

## Review surfaces

- Headings and paragraphs
- Ordered and unordered content
- Inline \`code\` and **strong text**

1. Open this file from the changed paths.
2. Select **Preview** in its file header.
3. Select **Changes** to return to the diff.

## Example

\`\`\`kotlin
sealed interface SessionRestoration

data class Restored(val session: Session) : SessionRestoration
data object Missing : SessionRestoration
\`\`\`
`,
  "src/cart.ts": `export interface Item {
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
  return amount - amount * discount.percentage;
}
`,
  "src/receipt.ts": `import { total, type Discount, type Item } from "./cart.ts";

export function receipt(items: Item[], discount?: Discount): string {
  const amount = total(items, discount);
  return \`Total: \${amount.toFixed(2)}\`;
}
`,
  "tests/cart.test.ts": `import { expect, test } from "bun:test";
import { receipt } from "../src/receipt.ts";

test("formats a discounted receipt", () => {
  expect(receipt([{ price: 10, quantity: 2 }], { percentage: 0.1 })).toBe("Total: 18.00");
});
`,
};

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function writeFiles(repository: string, files: Record<string, string | Uint8Array>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const destination = join(repository, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
}

async function git(repository: string, ...args: string[]): Promise<string> {
  return (await runProcess(["git", ...args], repository)).stdout.trim();
}

function persistedFixture(repositoryRoot: string, browserToken: string, baseOid: string, headOid: string, comparison: GitComparison): PersistedReviewSession {
  const fixture: PersistedReviewSession = {
    schemaVersion: 4,
    name: "Complete product tour fixture",
    repositoryRoot,
    base: baseOid,
    browserToken,
    outline: {
      domainModels: [structuredClone(domainFixtureModel)],
      title: "Discounted checkout and receipt output",
      summary: "A compact, deterministic change that exercises the complete review interface without asking an agent to generate a tour.",
      planningNotes: [
        "Start with the calculation because the receipt depends on it.",
        "Finish with the user-visible output and supporting documentation.",
      ],
      behaviorArchitectureStatus: "implemented",
      behaviorArchitecture: {
        title: "How checkout produces a receipt",
        summary: "Checkout asks the new receipt formatter to calculate and present totals from the existing cart model.",
        mermaid: "flowchart LR\n  checkout[\"Checkout\"]:::touched\n  receipt[\"Receipt formatter\"]:::new\n  cart[\"Cart totals\"]:::touched\n  checkout -->|requests receipt from| receipt\n  receipt -->|calculates amount with| cart\n  classDef new stroke:#2e7d32,stroke-width:3px\n  classDef touched stroke:#f9a825,stroke-width:3px\n  classDef removed stroke:#c62828,stroke-width:3px,stroke-dasharray:4 3\n  classDef external stroke:#888888,stroke-dasharray:3 3",
        dependencyChanges: ["Added Checkout → Receipt formatter: requests receipt from", "Added Receipt formatter → Cart totals: calculates amount with"],
        affectedFiles: ["src/cart.ts", "src/receipt.ts"],
      },
      callFlows: [{
        id: "receipt-calls",
        title: "Receipt calculation call changes",
        summary: "A new receipt entrypoint calls the discount-aware total, which now delegates the original arithmetic to subtotal.",
        entrypointNodeId: "receipt",
        provenance: "verified",
        nodes: [{
          id: "receipt", label: "receipt", kind: "function", change: "added",
          newLocation: { path: "src/receipt.ts", side: "new", line: 3 },
        }, {
          id: "total", label: "total", kind: "function", change: "modified",
          oldLocation: { path: "src/cart.ts", side: "old", line: 6 },
          newLocation: { path: "src/cart.ts", side: "new", line: 14 },
        }, {
          id: "subtotal", label: "subtotal", kind: "function", change: "added",
          newLocation: { path: "src/cart.ts", side: "new", line: 10 },
        }],
        edges: [{
          id: "receipt-total", from: "receipt", to: "total", label: "calculates", change: "added",
          newCallSite: { path: "src/receipt.ts", side: "new", line: 4 },
        }, {
          id: "total-subtotal", from: "total", to: "subtotal", label: "reuses", change: "added",
          newCallSite: { path: "src/cart.ts", side: "new", line: 15 },
        }],
        affectedFiles: ["src/receipt.ts", "src/cart.ts"],
      }],
      architecture: {
        title: "How checkout components fit together",
        summary: "The receipt formatter is new, while the cart calculation is extended and the caller remains outside this fixture.",
        mermaid: "flowchart LR\n  caller[\"Checkout caller\"]:::external\n  receipt[\"Receipt formatter\"]:::new\n  cart[\"Cart totals\"]:::touched\n  caller -->|requests receipt from| receipt\n  receipt -->|calculates amount with| cart\n  classDef new stroke:#2e7d32,stroke-width:3px\n  classDef touched stroke:#f9a825,stroke-width:3px\n  classDef removed stroke:#c62828,stroke-width:3px,stroke-dasharray:4 3\n  classDef external stroke:#888888,stroke-dasharray:3 3",
        dependencyChanges: ["Added Checkout caller → Receipt formatter: requests receipt from", "Added Receipt formatter → Cart totals: calculates amount with"],
        affectedFiles: ["src/cart.ts", "src/receipt.ts"],
      },
      stateDiagram: {
        kind: "state-machine",
        title: "Receipt lifecycle",
        summary: "The new receipt path moves from a requested calculation to a formatted result.",
        mermaid: "stateDiagram-v2\n  [*] --> requested\n  requested --> calculated : total computed\n  calculated --> formatted : receipt rendered\n  formatted --> [*]",
        evidence: ["src/receipt.ts adds the receipt entrypoint.", "src/cart.ts calculates the amount consumed by the formatter."],
        materiallyImprovesUnderstanding: "The lifecycle makes the observable receipt progression clearer than a component wiring map.",
        affectedFiles: ["src/cart.ts", "src/receipt.ts"],
      },
      dataModel: {
        kind: "data-model",
        title: "Checkout value model",
        summary: "Receipt formatting consumes cart items and an optional discount to produce a total.",
        mermaid: "erDiagram\n  CART {\n    string id PK\n  }\n  ITEM {\n    number price\n    number quantity\n  }\n  DISCOUNT {\n    number percentage\n  }\n  CART ||--|{ ITEM : contains\n  CART ||--o| DISCOUNT : applies",
        evidence: ["src/cart.ts defines Item and Discount inputs.", "src/receipt.ts consumes both inputs through total."],
        materiallyImprovesUnderstanding: "The relationships expose the domain inputs that the sequence and component views leave implicit.",
        affectedFiles: ["src/cart.ts", "src/receipt.ts"],
      },
      phases: [{
        id: "calculation",
        title: "Calculate a discounted total",
        summary: "The original total function is split into a reusable subtotal and a discount-aware total.",
        fileChanges: [{ path: "src/cart.ts", summary: "Adds the discount contract, subtotal helper, and discount calculation." }],
        steps: [{
          id: "extract-subtotal",
          title: "Keep the original calculation reusable",
          objective: "See how the original item reduction becomes a named subtotal.",
          anchor: { path: "src/cart.ts", side: "new", startLine: 10, endLine: 12 },
          explanation: "The old total calculation is unchanged; it now has its own name so both full-price and discounted totals use the same arithmetic.",
        }, {
          id: "apply-discount",
          title: "Apply the optional discount",
          objective: "Check the units used by the new percentage field.",
          anchor: { path: "src/cart.ts", side: "new", startLine: 14, endLine: 18 },
        }],
      }, {
        id: "presentation",
        title: "Present and document the result",
        summary: "A small formatter turns the numeric total into receipt text and the README explains the fixture's purpose.",
        fileChanges: [
          { path: "src/receipt.ts", summary: "Adds a user-visible receipt string." },
          { path: "README.md", summary: "Documents what this reusable fixture covers." },
          { path: "docs/checkout-guide.md", summary: "Updates an existing Markdown guide with the discount-aware receipt behaviour." },
          { path: "docs/preview.md", summary: "Provides rich Markdown content for the rendered preview." },
          { path: "screens/receipt.png", summary: "Exercises before/after PNG previews with a deterministic receipt mockup." },
        ],
        steps: [{
          id: "format-receipt",
          title: "Format the receipt",
          objective: "Follow the calculated amount into the user-visible string.",
          anchor: { path: "src/receipt.ts", side: "new", startLine: 3, endLine: 5 },
        }, {
          id: "document-fixture",
          title: "Document the reusable fixture",
          objective: "Confirm the fixture advertises the UI surfaces it is meant to exercise.",
          anchor: { path: "README.md", side: "new", startLine: 1, endLine: 3 },
        }],
      }],
      structuralBlastRadii: [{
        id: "fixture-total-static-reach",
        symbol: { id: "src/cart.ts:new:14:total", symbol: "total", kind: "function", location: { path: "src/cart.ts", side: "new", line: 14 } },
        provider: "repository-search",
        confidence: "medium",
        provenance: "partial",
        summary: "The saved graph follows upstream static callers into total; it does not model downstream callees or runtime execution.",
        nodes: [
          { id: "src/cart.ts:new:14:total", symbol: "total", kind: "function", location: { path: "src/cart.ts", side: "new", line: 14 } },
          { id: "src/receipt.ts:new:3:receipt", symbol: "receipt", kind: "function", location: { path: "src/receipt.ts", side: "new", line: 3 } },
          { id: "fixture:external:checkout", symbol: "checkout caller", kind: "external" },
        ],
        edges: [
          { id: "fixture-receipt-to-total", from: "src/receipt.ts:new:3:receipt", to: "src/cart.ts:new:14:total", relationship: "calls" },
          { id: "fixture-checkout-to-receipt", from: "fixture:external:checkout", to: "src/receipt.ts:new:3:receipt", relationship: "calls" },
        ],
        directCallerIds: ["src/receipt.ts:new:3:receipt"],
        reportedDirectCallerCount: 1,
        reportedReachableNodeCount: 2,
        reportedImpactedFileCount: 2,
        coverage: { state: "complete", reportedCounts: "exact" },
        impactedFiles: ["src/cart.ts", "src/receipt.ts"],
        testEvidence: {
          state: "relevant-tests-found",
          searchScope: "Inspected tests/cart.test.ts for receipt, total, subtotal, and Discount references.",
          checkedSources: [{ path: "tests/cart.test.ts", side: "new", line: 5, detail: "Checks the formatted receipt amount when a discount is supplied." }],
          relevantTests: [{ path: "tests/cart.test.ts", side: "new", line: 5, detail: "The receipt calls total." }],
          remainingUncertainty: "This source does not establish behavior for zero, negative, or out-of-range percentages.",
        },
        nearbyTestGaps: [],
      }, {
        id: "fixture-subtotal-static-reach",
        symbol: { id: "src/cart.ts:new:10:subtotal", symbol: "subtotal", kind: "function", location: { path: "src/cart.ts", side: "new", line: 10 } },
        provider: "repository-search",
        confidence: "medium",
        provenance: "partial",
        summary: "The saved graph follows upstream static callers into subtotal through total and receipt; it does not model runtime execution.",
        nodes: [
          { id: "src/cart.ts:new:10:subtotal", symbol: "subtotal", kind: "function", location: { path: "src/cart.ts", side: "new", line: 10 } },
          { id: "src/cart.ts:new:14:total", symbol: "total", kind: "function", location: { path: "src/cart.ts", side: "new", line: 14 } },
          { id: "src/receipt.ts:new:3:receipt", symbol: "receipt", kind: "function", location: { path: "src/receipt.ts", side: "new", line: 3 } },
          { id: "fixture:external:checkout", symbol: "checkout caller", kind: "external" },
        ],
        edges: [
          { id: "fixture-total-to-subtotal", from: "src/cart.ts:new:14:total", to: "src/cart.ts:new:10:subtotal", relationship: "calls" },
          { id: "fixture-receipt-to-total-for-subtotal", from: "src/receipt.ts:new:3:receipt", to: "src/cart.ts:new:14:total", relationship: "calls" },
          { id: "fixture-checkout-to-receipt-for-subtotal", from: "fixture:external:checkout", to: "src/receipt.ts:new:3:receipt", relationship: "calls" },
        ],
        directCallerIds: ["src/cart.ts:new:14:total"],
        reportedDirectCallerCount: 1,
        reportedReachableNodeCount: 3,
        reportedImpactedFileCount: 2,
        coverage: { state: "complete", reportedCounts: "exact" },
        impactedFiles: ["src/cart.ts", "src/receipt.ts"],
        testEvidence: {
          state: "relevant-tests-found",
          searchScope: "Inspected tests/cart.test.ts for receipt, total, and subtotal calls.",
          checkedSources: [{ path: "tests/cart.test.ts", side: "new", line: 5, detail: "The test calls receipt with a discount-shaped input." }],
          relevantTests: [{ path: "tests/cart.test.ts", side: "new", line: 5, detail: "Its receipt call reaches total, whose source calls subtotal." }],
          remainingUncertainty: "This source only shows the discounted path; it does not establish other subtotal input cases.",
        },
        nearbyTestGaps: [],
      }, {
        id: "fixture-discount-partial-static-reach",
        symbol: { id: "src/cart.ts:new:6:Discount", symbol: "Discount", kind: "type", location: { path: "src/cart.ts", side: "new", line: 6 } },
        provider: "repository-search",
        confidence: "low",
        provenance: "partial",
        summary: "The provider returned aggregate upstream-reference totals for Discount without every caller identity; this is not runtime evidence.",
        nodes: [{ id: "src/cart.ts:new:6:Discount", symbol: "Discount", kind: "type", location: { path: "src/cart.ts", side: "new", line: 6 } }],
        edges: [],
        directCallerIds: [],
        reportedDirectCallerCount: 2,
        reportedReachableNodeCount: 4,
        reportedImpactedFileCount: 1,
        coverage: { state: "partial", reportedCounts: "exact", omissionReason: "The provider returned aggregate totals but did not supply the omitted reference identities." },
        impactedFiles: ["src/cart.ts"],
        testEvidence: {
          state: "limited",
          searchScope: "Inspected tests/cart.test.ts for Discount or percentage use.",
          checkedSources: [{ path: "tests/cart.test.ts", side: "new", line: 5, detail: "The test passes a percentage object to receipt." }],
          relevantTests: [],
          remainingUncertainty: "The test source does not name Discount directly, and the partial provider omitted reference identities.",
        },
        nearbyTestGaps: [],
      }, {
        id: "fixture-receipt-unavailable-static-reach",
        symbol: { id: "src/receipt.ts:new:3:receipt", symbol: "receipt", kind: "function", location: { path: "src/receipt.ts", side: "new", line: 3 } },
        provider: "unavailable",
        confidence: "unresolved",
        provenance: "unverified",
        summary: "No structural provider was available for receipt, so this is not evidence that receipt has no callers or runtime impact.",
        nodes: [{ id: "src/receipt.ts:new:3:receipt", symbol: "receipt", kind: "function", location: { path: "src/receipt.ts", side: "new", line: 3 } }],
        edges: [],
        directCallerIds: [],
        reportedDirectCallerCount: 0,
        reportedReachableNodeCount: 0,
        reportedImpactedFileCount: 1,
        coverage: { state: "unavailable", reportedCounts: "not-reported" },
        impactedFiles: ["src/receipt.ts"],
        testEvidence: { state: "not-assessed", checkedSources: [], relevantTests: [] },
        nearbyTestGaps: [],
      }],
      flows: [{
        id: "checkout-flow",
        title: "Calculate and format a receipt",
        summary: "The receipt formatter asks the cart module for a total and renders the returned amount.",
        mermaid: "sequenceDiagram\n  participant UI as Checkout UI\n  participant R as Receipt formatter\n  participant C as Cart totals\n  UI->>R: receipt(items, discount)\n  R->>C: total(items, discount)\n  C-->>R: discounted amount\n  R-->>UI: formatted total",
        provenance: "verified",
        blastRadiusSize: 2,
        affectedFiles: ["src/cart.ts", "src/receipt.ts"],
        messageSources: [
          { message: 2, label: "total(items, discount)", anchors: [
            { path: "src/receipt.ts", side: "new", startLine: 4, endLine: 4, quote: "  const amount = total(items, discount);" },
          ] },
          { message: 3, label: "discounted amount", anchors: [
            { path: "src/cart.ts", side: "new", startLine: 16, endLine: 16, quote: "  if (!discount) return amount;" },
            { path: "src/cart.ts", side: "new", startLine: 17, endLine: 17, quote: "  return amount - amount * discount.percentage;" },
          ] },
          { message: 4, label: "formatted total", anchors: [
            { path: "src/receipt.ts", side: "new", startLine: 5, endLine: 5, quote: "  return `Total: ${amount.toFixed(2)}`;" },
          ] },
        ],
      }],
      dryRunPlans: [{
        flowId: "receipt-total-behavior",
        flowKind: "behavior",
        title: "Calculate and format a receipt",
        summary: "Follow receipt input through subtotal, the optional discount branch, and fixed-decimal output.",
        source: { anchors: [
          { path: "src/receipt.ts", side: "new", startLine: 3, endLine: 5, changed: true },
          { path: "src/cart.ts", side: "new", startLine: 10, endLine: 18, changed: true },
        ] },
        callFlowId: "receipt-calls",
        sequenceFlowId: "checkout-flow",
        scenarios: [{
          id: "fractional-discount",
          title: "Fractional 20% discount",
          reason: "Primary changed behavior: two line items and a fractional discount reach formatted receipt output.",
          source: "example",
          inputs: { items: [{ price: 10, quantity: 2 }, { price: 5, quantity: 1 }], discount: { percentage: 0.2 } },
          mocks: {},
          assumptions: ["The input percentage is fractional, so 0.2 represents 20%."],
        }, {
          id: "no-discount",
          title: "No discount supplied",
          reason: "Alternate branch: the early return preserves the subtotal when discount is absent.",
          source: "invented",
          inputs: { items: [{ price: 10, quantity: 2 }, { price: 5, quantity: 1 }] },
          mocks: {},
          assumptions: ["An omitted discount is represented by undefined."],
        }, {
          id: "ambiguous-percentage",
          title: "Percentage supplied as 20",
          reason: "Boundary contract check: the code faithfully multiplies by 20 rather than normalizing a percentage-like value.",
          source: "invented",
          inputs: { items: [{ price: 10, quantity: 2 }, { price: 5, quantity: 1 }], discount: { percentage: 20 } },
          mocks: {},
          assumptions: ["No validation or percentage normalization is present in the reviewed code."],
        }, {
          id: "empty-cart",
          title: "Empty cart boundary",
          reason: "Boundary behavior: reduction begins at zero and the receipt still formats a number.",
          source: "invented",
          inputs: { items: [], discount: { percentage: 0.2 } },
          mocks: {},
          assumptions: ["The built-in array reduction receives the explicit zero initial value shown in source."],
        }],
      }],
      findings: [{
        id: "percentage-units",
        phaseId: "calculation",
        stepId: "apply-discount",
        path: "src/cart.ts",
        side: "new",
        line: 17,
        lineContent: "  return amount - amount * discount.percentage;",
        message: "A value named percentage normally uses 0–100, but the calculation treats it as 0–1. A 20% discount would subtract twenty times the subtotal unless the contract is clarified or the value is divided by 100.",
        category: "correctness",
        severity: "high",
        confidence: "high",
        evidence: "Observation: `Discount.percentage` has no fractional-unit name or validation.\nCausal path: `total` multiplies the subtotal by that value without normalization.\nImpact: Passing `20` for twenty percent subtracts twenty times the subtotal.\nCoverage: No changed test defines whether callers use `20` or `0.20`.",
        priority: "P1",
        introduced: true,
        recallGuard: true,
        blastRadiusSize: 5,
        tested: false,
        pinScope: "symbol",
        pinnedSymbolIds: ["src/cart.ts:new:14:total"],
        status: "open",
      }, {
        id: "rounding-contract",
        phaseId: "presentation",
        stepId: "format-receipt",
        path: "src/receipt.ts",
        side: "new",
        line: 5,
        lineContent: "  return `Total: ${amount.toFixed(2)}`;",
        message: "The receipt fixes the display to two decimals but does not declare a currency or rounding policy.",
        category: "maintainability",
        severity: "low",
        confidence: "high",
        evidence: "Observation: `receipt` formats the amount with `toFixed(2)`.\nImpact: The displayed number has no declared currency or rounding policy.\nCoverage: No changed test covers rounding boundaries.",
        priority: "P3",
        introduced: true,
        recallGuard: false,
        blastRadiusSize: 1,
        tested: false,
        pinScope: "symbol",
        status: "open",
      }],
      issueAssessment: {
        issueNumber: 24,
        issueUrl: "https://github.com/fixture/checkout/issues/24",
        items: [{
          criterionId: "criterion-1",
          criterion: "Discounts use a fractional percentage.",
          status: "implemented",
          evidence: "The changed discount calculation multiplies the amount by the supplied fractional percentage.",
          evidencePaths: ["src/cart.ts"],
          pathExplanations: [{ path: "src/cart.ts", explanation: "The changed calculation applies the supplied fractional percentage to the amount." }],
          basis: "model-assessment",
        }, {
          criterionId: "criterion-2",
          criterion: "Receipt output shows totals with two decimal places.",
          status: "implemented",
          evidence: "The changed receipt formatter renders the amount with toFixed(2).",
          evidencePaths: ["src/receipt.ts"],
          pathExplanations: [{ path: "src/receipt.ts", explanation: "The formatter renders the calculated amount with two decimal places." }],
          basis: "model-assessment",
        }, {
          criterionId: "criterion-3",
          criterion: "Reject discounts outside the supported fractional range.",
          status: "missing",
          evidence: "The changed discount contract accepts a number but does not add range validation.",
          evidencePaths: ["src/cart.ts"],
          pathExplanations: [{ path: "src/cart.ts", explanation: "The changed input path accepts the discount value without a range guard." }],
          basis: "model-assessment",
        }, {
          criterionId: "criterion-4",
          criterion: "Localize receipt output for the shopper's currency.",
          status: "unclear",
          evidence: "The changed paths do not establish a currency or localization contract.",
          evidencePaths: [],
          pathExplanations: [],
          basis: "model-assessment",
        }],
      },
    },
    currentStepIndex: 0,
    comments: [{
      id: "fixture-comment",
      path: "README.md",
      side: "new",
      line: 3,
      body: "Keep this list current when another major test surface is added.",
      lineContent: "This fixture exercises guided tours, findings, comments, flows, and activity.",
      status: "active",
      createdAt: FIXTURE_TIME,
      updatedAt: FIXTURE_TIME,
    }],
    checkpoints: [],
    checkpointRefNamespace: "refs/diffcompass/checkpoints/fixture",
    messages: [{
      id: "fixture-question",
      threadId: "fixture-question",
      anchor: { path: "src/cart.ts", side: "new", line: 17, content: "  return amount - amount * discount.percentage;" },
      role: "user",
      body: "Why is the percentage finding high priority?",
      stepId: "apply-discount",
      createdAt: FIXTURE_TIME,
    }, {
      id: "fixture-answer",
      threadId: "fixture-question",
      role: "agent",
      body: "Because a common input such as 20 changes a €100 subtotal into −€1,900. The ambiguity affects the core result, not only its presentation.",
      stepId: "apply-discount",
      createdAt: FIXTURE_TIME,
    }],
    activities: [{
      id: "fixture-activity",
      requestMessageId: "fixture-question",
      request: "Add a receipt formatter that reuses the cart total.",
      stepId: "format-receipt",
      adapterId: "codex",
      modelId: "fixture-model",
      files: [{
        path: "src/receipt.ts",
        change: "added",
        after: { status: "added", additions: 6, deletions: 0 },
      }],
      verification: "Fixture verification: receipt output is represented in the diff and sequence diagram.",
      status: "verified",
      changeStatus: "applied",
      createdAt: FIXTURE_TIME,
      updatedAt: FIXTURE_TIME,
    }],
    reviewedFiles: ["README.md"],
    preferences: {
      diffLayout: "split",
      changedFilesOnly: true,
      contextLines: 3,
      prefetchSteps: 5,
      requireAllFilesReviewed: false,
      closeOutcome: "accepted",
      showBriefing: true,
      briefingArchitecture: true,
      briefingSequenceDiagrams: false,
      briefingCallFlows: false,
      briefingNeedsAttention: true,
      briefingReviewEffort: true,
      briefingOrder: ["architecture", "sequence-diagrams", "call-flows", "needs-attention", "review-effort"],
    },
    reviewPolicy: {
      instructions: ["Treat percentage units as part of the public contract."],
      findings: {
        enabled: true,
        categories: ["correctness", "security", "performance", "maintainability", "testing"],
        minimumSeverity: "low",
      },
    },
    findingGenerationEnabled: true,
    pullRequest: {
      repository: "fixture/checkout",
      number: 42,
      url: "https://github.com/fixture/checkout/pull/42",
      title: "Add discounted receipt output",
      body: "Fixes #24\n\nAdds a discount-aware receipt formatter.",
      author: "fixture-author",
      baseRefName: "main",
      baseRefOid: baseOid,
      headRefName: "fixture-tour",
      headRefOid: headOid,
      sourceRepositoryRoot: repositoryRoot,
      workspaceRoot: repositoryRoot,
      refNamespace: "refs/diffcompass/fixture",
      reviewDecision: "REVIEW_REQUIRED",
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      commits: [{ oid: headOid, headline: "Add discounted receipt output", authors: ["fixture-author"] }],
      checks: [{ name: "fixture tests", state: "SUCCESS" }],
      threads: [],
      threadsTruncated: false,
      linkedIssue: {
        repository: "fixture/checkout",
        number: 24,
        url: "https://github.com/fixture/checkout/issues/24",
        title: "Support discounted receipt output",
        author: "fixture-author",
        state: "OPEN",
        access: "available",
        criteriaStatus: "found",
        acceptanceCriteria: [
          { id: "criterion-1", text: "Discounts use a fractional percentage." },
          { id: "criterion-2", text: "Receipt output shows totals with two decimal places." },
          { id: "criterion-3", text: "Reject discounts outside the supported fractional range." },
          { id: "criterion-4", text: "Localize receipt output for the shopper's currency." },
        ],
      },
      providerScope: { linkedIssue: "same-repository-closing-issue", relatedResources: "not-requested" },
      updatedAt: FIXTURE_TIME,
    },
    revision: 4,
    status: "open",
    selection: {
      adapterId: "codex",
      modelId: "default",
      reasoningEffort: "medium",
      includeArchitecture: true,
      includeCallFlows: true,
      includeFlows: true,
      includeFindings: true,
      includeDryRuns: true,
    },
    updatedAt: FIXTURE_TIME,
  };
  const plan = fixture.outline!.dryRunPlans![0]!;
  const scenario = plan.scenarios[0]!;
  fixture.dryRuns = [{
    id: "fixture-fractional-discount-trace",
    comparison: { base: comparison.base, mergeBase: comparison.mergeBase, head: comparison.head, fingerprint: comparisonFingerprint(comparison) },
    flowId: plan.flowId,
    flowKind: plan.flowKind,
    flowFingerprint: dryRunFlowFingerprint(fixture.outline!, plan.flowKind, plan.flowId),
    detail: "compact",
    scenario,
    assumptions: ["The walkthrough derives values from the reviewed source and does not execute this fixture."],
    steps: [{
      id: "receipt-calls-total", order: 1, kind: "call", title: "Receipt calls total", explanation: "The receipt passes both supplied arguments to the cart total function.",
      source: { path: "src/receipt.ts", side: "new", startLine: 4, endLine: 4, changed: true }, function: "receipt", arguments: scenario.inputs, locals: {}, valueChanges: [], mapLink: { callFlowId: "receipt-calls", edgeId: "receipt-total" },
    }, {
      id: "subtotal-reduces-items", order: 2, kind: "calculation", title: "Subtotal accumulates the items", explanation: "The reduction starts at zero, adds 20 for the first item, then adds 5 for the second item.",
      source: { path: "src/cart.ts", side: "new", startLine: 10, endLine: 11, changed: true }, function: "subtotal", arguments: { items: scenario.inputs.items }, locals: { sum: 25 }, valueChanges: [{ name: "subtotal", before: 0, after: 25, note: "0 → 20 → 25" }], mapLink: { callFlowId: "receipt-calls", nodeId: "subtotal" },
    }, {
      id: "discount-branch", order: 3, kind: "branch", title: "Discount branch is taken", explanation: "A discount object is present, so !discount is false and total continues to the discount calculation.",
      source: { path: "src/cart.ts", side: "new", startLine: 16, endLine: 16, changed: true }, function: "total", arguments: { discount: scenario.inputs.discount }, locals: { amount: 25 }, valueChanges: [], mapLink: { callFlowId: "receipt-calls", nodeId: "total" },
    }, {
      id: "apply-fractional-discount", order: 4, kind: "calculation", title: "Apply the fractional discount", explanation: "The source subtracts 25 multiplied by 0.2, producing 20 without normalizing or rounding the number.",
      source: { path: "src/cart.ts", side: "new", startLine: 17, endLine: 17, changed: true }, function: "total", arguments: { amount: 25, percentage: 0.2 }, locals: { amount: 25 }, valueChanges: [{ name: "amount", before: 25, after: 20, note: "25 - 25 * 0.2" }], mapLink: { callFlowId: "receipt-calls", nodeId: "total" },
    }, {
      id: "format-fixed-decimals", order: 5, kind: "calculation", title: "Format two decimal places", explanation: "The receipt formatter converts the simulated numeric amount to the string 20.00.",
      source: { path: "src/receipt.ts", side: "new", startLine: 5, endLine: 5, changed: true }, function: "receipt", arguments: { amount: 20 }, locals: { formatted: "20.00" }, valueChanges: [{ name: "formatted", before: 20, after: "20.00", note: "toFixed(2)" }], mapLink: { callFlowId: "receipt-calls", nodeId: "receipt" },
    }, {
      id: "return-receipt", order: 6, kind: "return", title: "Return the receipt text", explanation: "The formatter returns the exact text built from the fixed-decimal amount.",
      source: { path: "src/receipt.ts", side: "new", startLine: 5, endLine: 5, changed: true }, function: "receipt", arguments: { amount: 20 }, locals: { formatted: "20.00" }, valueChanges: [{ name: "receipt", after: "Total: 20.00" }], mapLink: { callFlowId: "receipt-calls", nodeId: "receipt" },
    }],
    outcome: { summary: "Simulated receipt output is Total: 20.00.", value: "Total: 20.00" },
    preparedAt: FIXTURE_TIME,
  }];
  return fixture;
}

export interface TestFixture {
  root: string;
  repository: string;
  stateFile: string;
  created: boolean;
}

export async function prepareTestFixture(options: { root?: string; reset?: boolean; extraFiles?: Record<string, { before: string; after: string }> } = {}): Promise<TestFixture> {
  // Optional examples are committed into both real fixture revisions. Never
  // let an extension replace baseline examples or write outside the repository.
  const before: Record<string, string> = {}, after: Record<string, string> = {};
  for (const [path, contents] of Object.entries(options.extraFiles ?? {})) {
    if (path.includes("\\") || path.includes("\0") || path.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git") || Object.hasOwn(baseFiles, path) || Object.hasOwn(workingFiles, path)) {
      throw new Error(`Invalid extra fixture path: ${path}`);
    }
    before[path] = contents.before; after[path] = contents.after;
  }
  const root = resolve(options.root ?? join(tmpdir(), FIXTURE_DIRECTORY));
  const marker = join(root, ".diffcompass-fixture.json");
  const repository = join(root, "repository");
  const stateFile = join(root, "session.json");
  const exists = await pathExists(root);
  if (exists) {
    const metadata = await lstat(root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`Fixture root is not a safe directory: ${root}`);
    let ownership: { schemaVersion?: unknown };
    try { ownership = JSON.parse(await readFile(marker, "utf8")); } catch {
      throw new Error(`Refusing to use an unowned fixture directory: ${root}`);
    }
    if (ownership.schemaVersion !== FIXTURE_SCHEMA) throw new Error(`Fixture directory has an unsupported schema: ${root}`);
    if (!options.reset) {
      await loadPersistedSession(stateFile);
      return { root, repository: await realpath(repository), stateFile: await realpath(stateFile), created: false };
    }
    await rm(root, { recursive: true });
  }

  await mkdir(repository, { recursive: true, mode: 0o700 });
  await writeFile(marker, `${JSON.stringify({ schemaVersion: FIXTURE_SCHEMA })}\n`, { mode: 0o600 });
  await git(repository, "init", "-b", "main");
  await git(repository, "config", "user.name", "DiffCompass Fixture");
  await git(repository, "config", "user.email", "fixture@diffcompass.test");
  await writeFiles(repository, { ...baseFiles, ...before });
  await git(repository, "add", ".");
  await git(repository, "commit", "-m", "fixture base");
  const baseOid = await git(repository, "rev-parse", "HEAD");
  await git(repository, "update-ref", "refs/remotes/origin/main", baseOid);
  await git(repository, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  await git(repository, "switch", "-c", "fixture-tour");
  await writeFiles(repository, { ...workingFiles, ...after });
  await git(repository, "add", ".");
  await git(repository, "commit", "-m", "fixture pull request");
  const headOid = await git(repository, "rev-parse", "HEAD");
  const canonicalRepository = await realpath(repository);
  const comparison = await loadComparison(canonicalRepository, baseOid);
  const persisted = persistedFixture(canonicalRepository, crypto.randomUUID(), baseOid, headOid, comparison);
  // A resumed fixture normally skips the agent generation path that refreshes
  // optional diagrams. When a local Archify skill is deliberately configured,
  // pre-render it here so the manual fixture exercises the same saved artifact
  // and fallback behavior as a generated tour. No renderer means no extra
  // dependency or network work for the ordinary deterministic fixture.
  const archify = ArchifyRenderer.fromEnvironment();
  if (archify && persisted.outline) {
    const rendered = await archify.render(persisted.outline);
    persisted.outline.archifyArtifacts = rendered.artifacts;
    persisted.outline.archifyFailures = rendered.failures;
  }
  await savePersistedSession(stateFile, persisted);
  return { root, repository: canonicalRepository, stateFile: await realpath(stateFile), created: true };
}
