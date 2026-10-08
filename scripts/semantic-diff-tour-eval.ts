/** Opt-in real-model evaluation; fixture repositories and raw evidence remain outside the checkout. */
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { TourAgent } from "../src/agent.ts";
import { loadComparison } from "../src/git.ts";
import { runProcess } from "../src/process.ts";
import { SEMANTIC_ENGINE } from "../src/semantic-diff.ts";
import { syntaxContextForTourStep } from "../src/semantic-diff-tour.ts";
import type { AgentRunActivity, AgentSelection, GitComparison, TourOutline, TourStep } from "../src/types.ts";

interface Case {
  id: string;
  path: string;
  oldPath?: string;
  before: string;
  after: string;
  live?: string;
  side?: "old" | "new";
  start?: number;
  end?: number;
  previous?: { title: string; objective: string };
  expectedStatus: string;
  review: string[];
}
const source = (lines: string[]) => lines.join("\n") + "\n";
const cases: Case[] = [
  {
    id: "typescript-optional-discount", path: "cart.ts", expectedStatus: "analysed", start: 10, end: 13,
    before: source(["export interface Item { price: number; quantity: number; }", "", "export function total(items: Item[]): number {", "  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);", "}"]),
    after: source(["export interface Item { price: number; quantity: number; }", "export interface Discount { percentage: number; }", "", "export function subtotal(items: Item[]): number {", "  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);", "}", "", "// Discount values are supplied by callers.", "", "export function total(items: Item[], discount?: Discount): number {", "  const amount = subtotal(items);", "  return amount * (1 - (discount?.percentage ?? 0));", "}"]),
    review: ["discount can be omitted", "percentage is used directly as a fraction, with zero fallback", "range validation is absent; question the caller contract without inventing it", "qualify claims about a negative total: a zero or negative subtotal is a counterexample", "focus on total, not the declaration inventory"],
  },
  {
    id: "kotlin-default-input", path: "Price.kt", expectedStatus: "analysed",
    before: source(["fun payable(amount: Int): Int {", "    return amount", "}"]),
    after: source(["fun payable(amount: Int, discount: Int = 0): Int {", "    return amount - discount", "}"]),
    previous: { title: "Establish the amount", objective: "The caller supplies the amount to charge as an integer." },
    review: ["discount has a default of zero", "subtract a flat amount, not a percentage", "consider discount greater than amount; do not claim validation", "connect to previous stop without inventing a next stop"],
  },
  {
    id: "kotlin-nullable-required", path: "Label.kt", expectedStatus: "analysed",
    before: source(["fun label(value: String): String {", "    return value", "}"]),
    after: source(["fun label(value: String, prefix: String?): String {", "    return (prefix ?: \"\") + value", "}"]),
    review: ["prefix accepts null but has no default", "callers must pass the new input, possibly null", "null gives an empty prefix", "do not call the input optional"],
  },
  {
    id: "typescript-live-drift", path: "price.ts", expectedStatus: "analysed",
    before: source(["export function price(amount: number): number {", "  return amount;", "}"]),
    after: source(["export function price(amount: number, discount = 0): number {", "  return amount - discount;", "}"]),
    live: source(["export function price(amount: number, surcharge = 99): number {", "  return amount + surcharge;", "}"]),
    review: ["captured change subtracts discount, whose default is zero", "live surcharge/addition/99 must not become historical claims", "no claim of executed test results"],
  },
  {
    id: "typescript-renamed-overloads-old-side", path: "new-format.ts", oldPath: "old-format.ts", side: "old", start: 1, end: 5, expectedStatus: "analysed",
    before: source(["export function format(value: string): string;", "export function format(value: number): string;", "export function format(value: string | number): string {", "  return String(value);", "}", "", "export const label = \"Formatted value\";", "export const separator = \": \";", "export const emptyLabel = \"No value\";", "export const exampleLabel = \"Example value\";", "export const displayPrefix = \"Result\";", "export const displaySuffix = \"End\";"]),
    after: source(["export function format(value: bigint): string;", "export function format(value: boolean): string;", "export function format(value: bigint | boolean): string {", "  return String(value);", "}", "", "export const label = \"Formatted value\";", "export const separator = \": \";", "export const emptyLabel = \"No value\";", "export const exampleLabel = \"Example value\";", "export const displayPrefix = \"Result\";", "export const displaySuffix = \"End\";"]),
    review: ["anchor is old path/old source even though canonical comparison path is new-format.ts", "old overload set accepts string and number; new set bigint and boolean", "do not pair individual ambiguous overloads", "String(value) expression remains; no global equivalence guarantee"],
  },
  {
    id: "typescript-comment-only", path: "cache.ts", expectedStatus: "analysed",
    before: source(["// Cache values for later.", "export function keep(value: string): string {", "  return value;", "}"]),
    after: source(["// This function returns its input; it does not store a value.", "export function keep(value: string): string {", "  return value;", "}"]),
    review: ["comment corrected; function returns input on both sides", "no invented new caching behavior or runtime change", "no declaration changes does not prove global equivalence", "review question can concern misleading naming/documentation"],
  },
  {
    id: "unsupported-python", path: "price.py", expectedStatus: "unsupported",
    before: source(["def price(amount):", "    return amount"]),
    after: source(["def price(amount, discount=0):", "    return max(0, amount - discount)"]),
    review: ["use saved text diff without parser facts", "subtract discount and clamp result to zero", "do not confuse clamp with validating the discount", "avoid irrelevant parser implementation details"],
  },
  {
    id: "typescript-parse-failure", path: "amount.ts", expectedStatus: "parse-error",
    before: source(["export function amount(value: number): number {", "  return value;", "}"]),
    after: source(["export function amount(value: number, adjustment = 0): number {", "  return value + ;", "}"]),
    review: ["incomplete return expression is a syntax error", "do not claim adjustment is applied or code runs", "new default parameter is visible in text", "question missing operand without asserting author intent"],
  },
];

const argv = process.argv.slice(2);
const mode = argv[0];
if (!["--prepare", "--run"].includes(mode ?? "") || !argv[1]) throw new Error("Usage: bun scripts/semantic-diff-tour-eval.ts --prepare|--run /absolute/artifact-directory [case-id ...]");
const artifactRoot = resolve(argv[1]!);
const selected = argv.length > 2 ? cases.filter((value) => argv.slice(2).includes(value.id)) : cases;
if (!selected.length) throw new Error("No matching evaluation cases.");
await mkdir(artifactRoot, { recursive: true });
const git = async (root: string, ...args: string[]) => (await runProcess(["git", ...args], root)).stdout.trim();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const writeJSON = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + "\n");
const evidenceFrom = (prompt: string) => JSON.parse(prompt.split("<tour-syntax-evidence>\n")[1]!.split("\n</tour-syntax-evidence>")[0]!);
const selection: AgentSelection = { adapterId: "codex", modelId: "default", reasoningEffort: "medium" };
const checkout = resolve(import.meta.dir, "..");
await writeJSON(join(artifactRoot, `${mode.slice(2)}-environment.json`), {
  startedAt: new Date().toISOString(), cwd: process.cwd(), checkout,
  branch: await git(checkout, "branch", "--show-current"), head: await git(checkout, "rev-parse", "HEAD"),
  dirtyFiles: await git(checkout, "status", "--short"), engine: SEMANTIC_ENGINE,
  selection, modelNote: "Configured CLI default; resolved model must be verified separately, not inferred.",
  cliVersion: (await runProcess(["codex", "--version"], checkout)).stdout.trim(),
  harnessHash: digest(await readFile(import.meta.filename, "utf8")),
  sourceHashes: Object.fromEntries(await Promise.all(["src/agent.ts", "src/semantic-diff-tour.ts", "src/semantic-diff.ts", "src/comparison-source.ts", "src/git.ts"].map(async (path) => [path, digest(await readFile(join(checkout, path), "utf8"))]))),
  scope: "Human-authored fixed tour stops; real production explanation calls. No planner, browser, statistical A/B or compiler evaluation.",
});
let failures = 0;
for (const fixture of selected) {
  const directory = join(artifactRoot, fixture.id);
  await mkdir(directory, { recursive: true });
  let comparison: GitComparison, step: TourStep, outline: TourOutline, repositoryRoot: string;
  if (mode === "--prepare") {
    repositoryRoot = join(directory, "repository");
    // Exclusive creation prevents an accidental rerun from resetting a previous fixture.
    await mkdir(repositoryRoot);
    repositoryRoot = await realpath(repositoryRoot);
    await git(repositoryRoot, "init", "-b", "main");
    await git(repositoryRoot, "config", "user.name", "DiffCompass evaluation");
    await git(repositoryRoot, "config", "user.email", "evaluation@example.test");
    await git(repositoryRoot, "config", "core.hooksPath", "/dev/null");
    await writeFile(join(repositoryRoot, fixture.oldPath ?? fixture.path), fixture.before);
    await git(repositoryRoot, "add", ".");
    await git(repositoryRoot, "-c", "commit.gpgsign=false", "commit", "-m", "Controlled before source");
    if (fixture.oldPath) await rm(join(repositoryRoot, fixture.oldPath));
    await writeFile(join(repositoryRoot, fixture.path), fixture.after);
    if (fixture.oldPath) await git(repositoryRoot, "add", "-A");
    comparison = await loadComparison(repositoryRoot, "HEAD", 200);
    const file = comparison.files.find((file) => file.path === fixture.path);
    if (!file) throw new Error(`Missing diff for ${fixture.id}`);
    if (fixture.oldPath && (file.status !== "renamed" || file.oldPath !== fixture.oldPath)) throw new Error("Rename fixture did not preserve source identities");
    const side = fixture.side ?? "new";
    step = { id: fixture.id, title: "Review the changed contract", objective: "Explain the selected code change and identify a useful review check.", anchor: { path: fixture.path, side, startLine: fixture.start ?? 1, endLine: fixture.end ?? (side === "old" ? fixture.before : fixture.after).trimEnd().split("\n").length } };
    const previous = fixture.previous ? [{ id: `${fixture.id}-previous`, ...fixture.previous, anchor: { ...step.anchor } }] : [];
    outline = { title: "Review this change", summary: "Understand the selected source change.", phases: [{ id: "change", title: "Review the calculation or contract", summary: "Follow the changed code and its inputs.", fileChanges: [{ path: fixture.path, summary: "Review the selected changes." }], steps: [...previous, step] }], callFlows: [], flows: [], findings: [] };
    if (fixture.live) await writeFile(join(repositoryRoot, fixture.path), fixture.live);
    const evidence = evidenceFrom(await syntaxContextForTourStep(comparison, step));
    if (evidence.status !== fixture.expectedStatus) throw new Error(`${fixture.id}: expected ${fixture.expectedStatus}, got ${evidence.status}`);
    await writeJSON(join(directory, "input.json"), { fixture, repositoryRoot, comparison, step, outline });
    await writeJSON(join(directory, "prepared-evidence.json"), evidence);
    await writeFile(join(directory, "comparison.diff"), comparison.patch);
    console.log(`PREPARED ${fixture.id}: ${evidence.status}, ${evidence.changes.length} overlapping declarations`);
    continue;
  }
  ({ comparison, step, outline, repositoryRoot } = JSON.parse(await readFile(join(directory, "input.json"), "utf8")));
  // An explicit run never overwrites a prior reply; reruns need a separate artifact directory.
  await writeFile(join(directory, "started.json"), JSON.stringify({ startedAt: new Date().toISOString(), selection }), { flag: "wx" });
  const beforeLiveHash = digest(await readFile(join(repositoryRoot, fixture.path), "utf8"));
  const beforeStatus = await git(repositoryRoot, "status", "--porcelain=v1", "--untracked-files=all");
  let activity: AgentRunActivity | undefined;
  const agent = new TourAgent(repositoryRoot, selection, undefined, undefined, (event) => { activity = event; });
  agent.useComparison(comparison);
  console.log(`RUNNING ${fixture.id}`);
  const started = Date.now();
  try {
    const ordered = outline.phases.flatMap((phase) => phase.steps);
    const reply = await agent.explainStep(step, ordered.length - 1, ordered.length, outline);
    if (!activity || activity.promptTruncated) throw new Error("Evaluation did not capture the full production prompt");
    const evidence = evidenceFrom(activity.prompt);
    const afterLiveHash = digest(await readFile(join(repositoryRoot, fixture.path), "utf8"));
    const afterStatus = await git(repositoryRoot, "status", "--porcelain=v1", "--untracked-files=all");
    await writeFile(join(directory, "response.md"), reply.value + "\n");
    await writeFile(join(directory, "prompt.txt"), activity.prompt);
    await writeJSON(join(directory, "result.json"), {
      completedAt: new Date().toISOString(), durationMs: Date.now() - started,
      selection, continuation: agent.continuation(), evidence, activity,
      checks: {
        expectedEvidenceStatus: evidence.status === fixture.expectedStatus,
        capturedPatchIncluded: activity.prompt.includes(comparison.patch),
        liveFileUnchanged: beforeLiveHash === afterLiveHash,
        repositoryStatusUnchanged: beforeStatus === afterStatus,
        words: reply.value.trim().split(/\s+/).length,
        paragraphs: reply.value.trim().split(/\n\s*\n/).length,
        endsWithNext: /select next when ready[.!]?$/i.test(reply.value.trim()),
      },
      beforeLiveHash, afterLiveHash, review: fixture.review,
      note: "Checks are mechanics/format only. Accuracy and clarity require human review against input.json and comparison.diff.",
    });
    if (evidence.status !== fixture.expectedStatus || beforeLiveHash !== afterLiveHash || beforeStatus !== afterStatus) throw new Error("Evidence or fixture integrity check failed; inspect result.json");
    console.log(`COMPLETED ${fixture.id}: ${Math.round((Date.now() - started) / 1000)}s, ${reply.value.trim().split(/\s+/).length} words`);
  } catch (error) {
    failures++;
    await writeJSON(join(directory, "error.json"), { message: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started, activity });
    console.log(`FAILED ${fixture.id}; inspect error.json`);
  } finally { agent.cancel(); }
}
if (failures) process.exitCode = 1;
