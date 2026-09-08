import type { DiffFile, GitComparison, PullRequestContext, ReviewBriefing, ReviewBriefingSignal, TourOutline } from "./types.ts";

export interface BriefingOptions {
  includeFindings?: boolean;
  includeCallFlows?: boolean;
}

const TEST_PATH = /(^|\/)(?:test|tests|spec|specs|__tests__)(\/|$)|(?:^|[._-])(?:test|spec)(?:[._-]|$)|Tests?\.(?:swift|kt|java)$/i;
const SOURCE_EXTENSION = /\.(?:c|cc|cpp|cs|go|java|js|jsx|kt|kts|mjs|php|py|rb|rs|swift|ts|tsx|vue)$/i;
const PUBLIC_DECLARATION = /^\s*(?:export\s+(?:(?:declare|abstract|async)\s+)*(?:default\s+)?(?:function|class|interface|type|enum|const|let|var)\b|export\s*\{|public\s+(?:(?:abstract|static|final|async)\s+)*(?:class|interface|enum|fun|function|[A-Za-z_$][\w$<>[\], ]*\s+[A-Za-z_$][\w$]*\s*\()\b|module\.exports\b|exports\.[A-Za-z_$][\w$]*\s*=)/;
const FAILING_CHECK = /^(?:failure|failed|error|cancelled|canceled|timed[_ -]?out|startup[_ -]?failure|action[_ -]?required|blocked)$/i;

function changedRows(file: DiffFile) {
  return file.hunks.flatMap((hunk) => hunk.rows).filter((row) => row.kind === "addition" || row.kind === "deletion");
}

function changedTestFile(file: DiffFile): boolean {
  return TEST_PATH.test(file.path);
}

function changedSourceFile(file: DiffFile): boolean {
  return SOURCE_EXTENSION.test(file.path) && !changedTestFile(file);
}

function firstChangedRow(file: DiffFile) {
  return changedRows(file).find((row) => PUBLIC_DECLARATION.test(row.content));
}

function publicContractSignals(comparison: GitComparison): ReviewBriefingSignal[] {
  return comparison.files.flatMap((file) => {
    const row = firstChangedRow(file);
    if (!row) return [];
    const line = row.kind === "deletion" ? row.oldLine : row.newLine;
    if (!line) return [];
    return [{
      id: `public-contract:${file.path}:${row.kind}:${line}`,
      kind: "public-contract",
      title: "Public contract changed",
      detail: `${file.path}:${line} changes an exported or public declaration.`,
      evidence: row.content.trim(),
      basis: "bounded-heuristic",
      target: { kind: "file", path: file.path, side: row.kind === "deletion" ? "old" : "new", line },
    } satisfies ReviewBriefingSignal];
  });
}

function findingSignals(outline: TourOutline | undefined, includeFindings: boolean): ReviewBriefingSignal[] {
  if (!includeFindings) return [];
  return (outline?.findings ?? []).filter((finding) => finding.status === "open" && (finding.priority === "P0" || finding.priority === "P1")).map((finding) => ({
    id: `finding:${finding.id}`,
    kind: "finding" as const,
    title: `${finding.priority} finding remains unresolved`,
    detail: `${finding.path}:${finding.line} · ${finding.category}${finding.outdated ? " · saved anchor is stale" : ""}`,
    evidence: finding.evidence,
    basis: "repository-evidence" as const,
    target: { kind: "finding" as const, findingId: finding.id },
  }));
}

function callFlowSignals(outline: TourOutline | undefined, includeCallFlows: boolean): ReviewBriefingSignal[] {
  if (!includeCallFlows) return [];
  return (outline?.callFlows ?? []).filter((flow) => flow.affectedFiles.length >= 4).map((flow) => ({
    id: `call-flow:${flow.id}`,
    kind: "call-flow" as const,
    title: "Broad call-flow impact",
    detail: `${flow.title} reaches ${flow.affectedFiles.length} changed files.`,
    evidence: `${flow.provenance} call flow; affected files: ${flow.affectedFiles.join(", ")}.`,
    basis: flow.provenance === "verified" ? "repository-evidence" as const : "bounded-heuristic" as const,
    target: { kind: "call-flow" as const, callFlowId: flow.id },
  }));
}

function testSignals(comparison: GitComparison): ReviewBriefingSignal[] {
  const changedTests = comparison.files.filter(changedTestFile);
  const changedSources = comparison.files.filter(changedSourceFile);
  const signals: ReviewBriefingSignal[] = [];
  if (changedTests.length > 0) {
    const file = changedTests[0]!;
    signals.push({
      id: "tests:changed",
      kind: "tests",
      title: "Tests changed",
      detail: `${changedTests.length} changed test ${changedTests.length === 1 ? "file" : "files"} are part of this comparison.`,
      evidence: changedTests.map((candidate) => candidate.path).join(", "),
      basis: "repository-evidence",
      target: { kind: "file", path: file.path, side: file.status === "deleted" ? "old" : "new", line: changedRows(file)[0]?.newLine ?? changedRows(file)[0]?.oldLine ?? 1 },
    });
  } else if (changedSources.length > 0) {
    const file = changedSources[0]!;
    signals.push({
      id: "tests:missing",
      kind: "tests",
      title: "No changed tests found",
      detail: `No changed test file accompanies ${changedSources.length} changed source ${changedSources.length === 1 ? "file" : "files"}.`,
      evidence: `${changedSources.map((candidate) => candidate.path).join(", ")}; test paths are identified by conventional test/spec names.`,
      basis: "bounded-heuristic",
      target: { kind: "file", path: file.path, side: file.status === "deleted" ? "old" : "new", line: changedRows(file)[0]?.newLine ?? changedRows(file)[0]?.oldLine ?? 1 },
    });
  }
  return signals;
}

function staleSignals(outline: TourOutline | undefined, includeFindings: boolean): ReviewBriefingSignal[] {
  const steps = (outline?.phases ?? []).flatMap((phase) => phase.steps);
  const staleSteps = steps.filter((step) => step.outdated);
  const staleFindings = includeFindings ? (outline?.findings ?? []).filter((finding) => finding.outdated) : [];
  return [
    ...staleSteps.map((step) => ({
      id: `stale-step:${step.id}`,
      kind: "stale-analysis" as const,
      title: "Tour explanation is stale",
      detail: `${step.anchor.path}:${step.anchor.startLine} no longer matches the saved stop anchor.`,
      evidence: "The existing stale marker was set after the comparison changed.",
      basis: "repository-evidence" as const,
      target: { kind: "file" as const, path: step.anchor.path, side: step.anchor.side, line: step.anchor.startLine },
    })),
    ...staleFindings.map((finding) => ({
      id: `stale-finding:${finding.id}`,
      kind: "stale-analysis" as const,
      title: "Finding analysis is stale",
      detail: `${finding.path}:${finding.line} no longer matches the saved finding evidence.`,
      evidence: "The existing stale marker was set after the comparison changed.",
      basis: "repository-evidence" as const,
      target: { kind: "finding" as const, findingId: finding.id },
    })),
  ];
}

function githubSignals(pullRequest: PullRequestContext | undefined): ReviewBriefingSignal[] {
  if (!pullRequest) return [];
  const checks = pullRequest.checks.filter((check) => FAILING_CHECK.test(check.state.trim()));
  const signals: ReviewBriefingSignal[] = checks.map((check) => ({
    id: `github-check:${check.name}`,
    kind: "github-check" as const,
    title: "GitHub check is failing",
    detail: `${check.name} reports ${check.state}.`,
    evidence: `GitHub status check ${check.name}: ${check.state}.`,
    basis: "repository-evidence" as const,
    target: { kind: "review-section" as const, section: "pull-request" as const },
  }));
  const conflict = pullRequest.mergeable === "CONFLICTING" || pullRequest.mergeStateStatus?.toUpperCase() === "DIRTY";
  if (conflict) signals.push({
    id: "github:merge-conflict",
    kind: "merge-conflict",
    title: "GitHub reports merge conflicts",
    detail: "The pull request is not currently mergeable because its branches conflict.",
    evidence: `mergeable=${pullRequest.mergeable ?? "unknown"}; mergeStateStatus=${pullRequest.mergeStateStatus ?? "unknown"}.`,
    basis: "repository-evidence",
    target: { kind: "review-section", section: "pull-request" },
  });
  return signals;
}

function estimate(comparison: GitComparison, signals: ReviewBriefingSignal[]): ReviewBriefing["estimate"] {
  const factors: ReviewBriefing["estimate"]["factors"] = [
    { label: "Baseline", minutes: 3, detail: "A short orientation pass for any review.", basis: "bounded-heuristic" },
  ];
  if (comparison.files.length > 0) factors.push({ label: "Changed files", minutes: Math.min(12, Math.ceil(comparison.files.length / 4)), detail: `${comparison.files.length} changed files`, basis: "repository-evidence" });
  const rows = comparison.files.reduce((total, file) => total + changedRows(file).length, 0);
  if (rows > 0) factors.push({ label: "Diff size", minutes: Math.min(20, Math.max(1, Math.ceil(rows / 120))), detail: `${rows} changed diff rows`, basis: "repository-evidence" });
  const count = (kind: ReviewBriefingSignal["kind"]) => signals.filter((signal) => signal.kind === kind).length;
  if (count("finding") > 0) factors.push({ label: "P0/P1 findings", minutes: count("finding") * 3, detail: `${count("finding")} unresolved high-priority finding${count("finding") === 1 ? "" : "s"}`, basis: "repository-evidence" });
  if (count("public-contract") > 0) factors.push({ label: "Public contracts", minutes: count("public-contract") * 2, detail: `${count("public-contract")} changed exported/public declaration${count("public-contract") === 1 ? "" : "s"}`, basis: "bounded-heuristic" });
  if (count("call-flow") > 0) factors.push({ label: "Call-flow breadth", minutes: count("call-flow") * 3, detail: `${count("call-flow")} broad call flow${count("call-flow") === 1 ? "" : "s"}`, basis: "repository-evidence" });
  if (count("tests") > 0) factors.push({ label: "Test surface", minutes: count("tests") * 2, detail: "Changed or missing tests need a focused pass", basis: "bounded-heuristic" });
  if (count("stale-analysis") > 0) factors.push({ label: "Stale analysis", minutes: count("stale-analysis"), detail: `${count("stale-analysis")} saved explanation or finding needs re-checking`, basis: "repository-evidence" });
  const githubRisk = count("github-check") + count("merge-conflict");
  if (githubRisk > 0) factors.push({ label: "GitHub status", minutes: githubRisk * 2, detail: `${githubRisk} failing check or merge conflict${githubRisk === 1 ? "" : "s"}`, basis: "repository-evidence" });
  return { minutes: factors.reduce((total, factor) => total + factor.minutes, 0), factors };
}

export function buildNeedsAttention(comparison: GitComparison, outline?: TourOutline, pullRequest?: PullRequestContext, options: BriefingOptions = {}): ReviewBriefing {
  const includeFindings = options.includeFindings !== false;
  const includeCallFlows = options.includeCallFlows !== false;
  const signals = [
    ...findingSignals(outline, includeFindings),
    ...publicContractSignals(comparison),
    ...callFlowSignals(outline, includeCallFlows),
    ...testSignals(comparison),
    ...staleSignals(outline, includeFindings),
    ...githubSignals(pullRequest),
  ];
  return { signals, estimate: estimate(comparison, signals) };
}
