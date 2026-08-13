import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runProcess } from "./process.ts";
import { loadPersistedSession, savePersistedSession } from "./store.ts";
import type { PersistedReviewSession } from "./types.ts";

const FIXTURE_SCHEMA = 1;
const FIXTURE_DIRECTORY = "code-review-tour-test-fixture-v1";
const FIXTURE_TIME = "2026-08-13T10:00:00.000Z";

const baseFiles = {
  "README.md": "# Checkout\n\nThe checkout returns a numeric total.\n",
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
  "README.md": "# Checkout fixture\n\nThis fixture exercises guided tours, findings, comments, flows, and activity.\n",
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
};

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function writeFiles(repository: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const destination = join(repository, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
}

async function git(repository: string, ...args: string[]): Promise<string> {
  return (await runProcess(["git", ...args], repository)).stdout.trim();
}

function persistedFixture(repositoryRoot: string, browserToken: string): PersistedReviewSession {
  return {
    schemaVersion: 2,
    name: "Complete product tour fixture",
    repositoryRoot,
    base: "origin/main",
    browserToken,
    outline: {
      title: "Discounted checkout and receipt output",
      summary: "A compact, deterministic change that exercises the complete review interface without asking an agent to generate a tour.",
      planningNotes: [
        "Start with the calculation because the receipt depends on it.",
        "Finish with the user-visible output and supporting documentation.",
      ],
      architecture: {
        title: "How checkout components fit together",
        summary: "The receipt formatter is new, while the cart calculation is extended and the caller remains outside this fixture.",
        mermaid: "flowchart LR\n  caller[\"Checkout caller\"]:::external\n  receipt[\"Receipt formatter\"]:::new\n  cart[\"Cart totals\"]:::touched\n  caller -->|requests receipt from| receipt\n  receipt -->|calculates amount with| cart\n  classDef new stroke:#2e7d32,stroke-width:3px\n  classDef touched stroke:#f9a825,stroke-width:3px\n  classDef removed stroke:#c62828,stroke-width:3px,stroke-dasharray:4 3\n  classDef external stroke:#888888,stroke-dasharray:3 3",
        dependencyChanges: ["Added Checkout caller → Receipt formatter: requests receipt from", "Added Receipt formatter → Cart totals: calculates amount with"],
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
          explanation: "The function returns the subtotal when there is no discount. The discounted branch currently treats the percentage as a fraction, which is why the finding on the return line matters.",
        }],
      }, {
        id: "presentation",
        title: "Present and document the result",
        summary: "A small formatter turns the numeric total into receipt text and the README explains the fixture's purpose.",
        fileChanges: [
          { path: "src/receipt.ts", summary: "Adds a user-visible receipt string." },
          { path: "README.md", summary: "Documents what this reusable fixture covers." },
        ],
        steps: [{
          id: "format-receipt",
          title: "Format the receipt",
          objective: "Follow the calculated amount into the user-visible string.",
          anchor: { path: "src/receipt.ts", side: "new", startLine: 3, endLine: 5 },
          explanation: "The formatter delegates all arithmetic to total(), then limits the displayed result to two decimal places.",
        }, {
          id: "document-fixture",
          title: "Document the reusable fixture",
          objective: "Confirm the fixture advertises the UI surfaces it is meant to exercise.",
          anchor: { path: "README.md", side: "new", startLine: 1, endLine: 3 },
          explanation: "This short README makes the repository recognizable when it appears in the file tree and diff header.",
        }],
      }],
      flows: [{
        id: "checkout-flow",
        title: "Calculate and format a receipt",
        summary: "The receipt formatter asks the cart module for a total and renders the returned amount.",
        mermaid: "sequenceDiagram\n  participant UI as Checkout UI\n  participant R as Receipt formatter\n  participant C as Cart totals\n  UI->>R: receipt(items, discount)\n  R->>C: total(items, discount)\n  C-->>R: discounted amount\n  R-->>UI: formatted total",
        provenance: "verified",
        blastRadiusSize: 2,
        affectedFiles: ["src/cart.ts", "src/receipt.ts"],
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
        evidence: "The field has no fractional-unit name or validation, and the multiplication uses it directly.",
        priority: "P1",
        introduced: true,
        recallGuard: true,
        blastRadiusSize: 2,
        tested: false,
        pinScope: "line",
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
        evidence: "toFixed(2) is the only formatting rule in the new presentation path.",
        priority: "P3",
        introduced: true,
        recallGuard: false,
        blastRadiusSize: 1,
        tested: false,
        pinScope: "symbol",
        status: "open",
      }],
    },
    currentStepIndex: 1,
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
    messages: [{
      id: "fixture-question",
      role: "user",
      body: "Why is the percentage finding high priority?",
      stepId: "apply-discount",
      createdAt: FIXTURE_TIME,
    }, {
      id: "fixture-answer",
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
      requireAllFilesReviewed: false,
      closeOutcome: "accepted",
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
    revision: 4,
    status: "open",
    selection: {
      adapterId: "codex",
      modelId: "default",
      reasoningEffort: "medium",
      includeArchitecture: true,
      includeFlows: true,
      includeFindings: true,
    },
    updatedAt: FIXTURE_TIME,
  };
}

export interface TestFixture {
  root: string;
  repository: string;
  stateFile: string;
  created: boolean;
}

export async function prepareTestFixture(options: { root?: string; reset?: boolean } = {}): Promise<TestFixture> {
  const root = resolve(options.root ?? join(tmpdir(), FIXTURE_DIRECTORY));
  const marker = join(root, ".code-review-tour-fixture.json");
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
  await git(repository, "config", "user.name", "Code Review Tour Fixture");
  await git(repository, "config", "user.email", "fixture@code-review-tour.test");
  await writeFiles(repository, baseFiles);
  await git(repository, "add", ".");
  await git(repository, "commit", "-m", "fixture base");
  const baseOid = await git(repository, "rev-parse", "HEAD");
  await git(repository, "update-ref", "refs/remotes/origin/main", baseOid);
  await git(repository, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  await git(repository, "switch", "-c", "fixture-tour");
  await writeFiles(repository, workingFiles);
  const canonicalRepository = await realpath(repository);
  await savePersistedSession(stateFile, persistedFixture(canonicalRepository, crypto.randomUUID()));
  return { root, repository: canonicalRepository, stateFile: await realpath(stateFile), created: true };
}
