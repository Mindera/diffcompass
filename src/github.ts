import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { ReviewError } from "./errors.ts";
import { runProcess } from "./process.ts";
import { githubSuggestionBody } from "./github-suggestions.ts";
import type { LinkedIssueContext, PullRequestContext, ReviewComment, ReviewOutcome } from "./types.ts";

export type GitHubRunner = typeof runProcess;
type Runner = GitHubRunner;

interface PullRequestIdentifier { repository?: string; number: number }

const ISSUE_BODY_LIMIT = 100_000;

function isCanonicalIssueUrl(value: unknown, repository: string, number: number): boolean {
  if (typeof value !== "string" || !value || value.length > 4_096) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.host === "github.com" && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname.toLocaleLowerCase() === `/${repository}/issues/${number}`.toLocaleLowerCase();
  } catch {
    return false;
  }
}

/** Extract only explicit, checklist-like acceptance criteria from an issue body. */
export function extractAcceptanceCriteria(body: string): LinkedIssueContext["acceptanceCriteria"] {
  if (body.length > ISSUE_BODY_LIMIT || body.includes("\u0000")) return [];
  const lines = body.split(/\r?\n/);
  const criteria: Array<{ id: string; text: string }> = [];
  const section = lines.findIndex((line) => /^\s*(?:#{1,6}\s*)?(?:acceptance criteria|ac)\s*:?\s*$/i.test(line));
  const candidates = section >= 0
    ? (() => {
      const result: string[] = [];
      let started = false;
      let listIndent: number | undefined;
      for (const line of lines.slice(section + 1)) {
        if (/^\s*#{1,6}\s+/.test(line)) break;
        if (!line.trim()) continue;
        const match = /^(\s*)(?:[-*+]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s*)?(.+)$/.exec(line) ?? /^(\s*)\[[ xX]\]\s+(.+)$/.exec(line);
        if (!match) {
          if (started) break;
          continue;
        }
        const indent = match[1]!.length;
        if (listIndent === undefined) listIndent = indent;
        if (indent !== listIndent) {
          if (indent < listIndent) break;
          continue;
        }
        result.push(match[2]!);
        started = true;
      }
      return result;
    })()
    : lines.map((line) => /^(?:AC|criterion)\s*\d+\s*[:.)-]\s*(.+)$/i.exec(line.trim())?.[1]).filter((line): line is string => Boolean(line));
  for (const text of candidates) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length > 4_000 || criteria.some((candidate) => candidate.text === normalized)) continue;
    criteria.push({ id: `criterion-${criteria.length + 1}`, text: normalized });
    if (criteria.length >= 20) break;
  }
  return criteria;
}

function issueAccessError(error: unknown): "inaccessible" | "unavailable" {
  const message = error instanceof Error ? error.message.toLocaleLowerCase() : String(error).toLocaleLowerCase();
  return /not found|could not resolve|permission|forbidden|authentication|unauthorized|resource not accessible/.test(message) ? "inaccessible" : "unavailable";
}

function issueFallback(repository: string, number: number, title: string, access: LinkedIssueContext["access"]): LinkedIssueContext {
  return {
    repository,
    number,
    url: `https://github.com/${repository}/issues/${number}`,
    title: title || `Linked issue #${number}`,
    access,
    criteriaStatus: "unavailable",
    acceptanceCriteria: [],
  };
}

async function loadLinkedIssue(
  runner: Runner,
  cwd: string,
  repository: string,
  reference: Record<string, unknown>,
): Promise<LinkedIssueContext> {
  const number = typeof reference.number === "number" ? reference.number : 0;
  const title = typeof reference.title === "string" && reference.title.length <= 8_000 ? reference.title : "";
  if (!Number.isInteger(number) || Number(number) <= 0) return issueFallback(repository, 1, title, "unavailable");
  try {
    const raw = await jsonCommand(runner, ["gh", "issue", "view", String(number), "--repo", repository, "--json", "number,title,body,url,state,author"], cwd);
    if (raw.number !== number || !isCanonicalIssueUrl(raw.url, repository, number)) {
      return issueFallback(repository, number, title, "unavailable");
    }
    const body = raw.body;
    const bodyMalformed = typeof body !== "string" || body.length > ISSUE_BODY_LIMIT || body.includes("\u0000");
    const acceptanceCriteria = bodyMalformed ? [] : extractAcceptanceCriteria(body);
    const issueTitle = typeof raw.title === "string" && raw.title.length > 0 && raw.title.length <= 8_000 ? raw.title : title || `Linked issue #${number}`;
    const author = raw.author && typeof raw.author === "object" && !Array.isArray(raw.author) && typeof (raw.author as Record<string, unknown>).login === "string"
      ? (raw.author as Record<string, unknown>).login as string : undefined;
    const state = typeof raw.state === "string" && raw.state.length <= 500 ? raw.state : undefined;
    return {
      repository,
      number,
      url: `https://github.com/${repository}/issues/${number}`,
      title: issueTitle,
      ...(author ? { author } : {}),
      ...(state ? { state } : {}),
      access: "available",
      criteriaStatus: bodyMalformed ? "malformed" : acceptanceCriteria.length ? "found" : "not-found",
      acceptanceCriteria,
    };
  } catch (error) {
    return issueFallback(repository, number, title, issueAccessError(error));
  }
}

export function parsePullRequestIdentifier(value: string): PullRequestIdentifier {
  if (/^[1-9]\d{0,9}$/.test(value)) return { number: Number(value) };
  let url: URL;
  try { url = new URL(value); } catch { throw new ReviewError("Pull request must be a positive number or a github.com pull request URL."); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash) {
    throw new ReviewError("Only canonical https://github.com/OWNER/REPOSITORY/pull/NUMBER URLs are supported.");
  }
  const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d{0,9})\/?$/.exec(url.pathname);
  if (!match) throw new ReviewError("Pull request URL must match https://github.com/OWNER/REPOSITORY/pull/NUMBER.");
  return { repository: `${match[1]}/${match[2]}`, number: Number(match[3]) };
}

async function jsonValue(runner: Runner, command: string[], cwd: string, input?: string): Promise<unknown> {
  const result = await runner(command, cwd, [0], input === undefined ? {} : { input });
  try {
    const value = JSON.parse(result.stdout) as unknown;
    return value;
  } catch {
    throw new ReviewError(`GitHub CLI returned invalid JSON for ${command.slice(0, 3).join(" ")}.`);
  }
}

async function jsonCommand(runner: Runner, command: string[], cwd: string, input?: string): Promise<Record<string, unknown>> {
  const value = await jsonValue(runner, command, cwd, input);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReviewError(`GitHub CLI returned an unexpected JSON value for ${command.slice(0, 3).join(" ")}.`);
  }
  return value as Record<string, unknown>;
}

const THREAD_QUERY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage}nodes{id isResolved path line startLine diffSide originalLine originalStartLine comments(first:50){nodes{id body url author{login}}}}}}}}`;

export async function loadPullRequestContext(
  sourceRepositoryRoot: string,
  identifier: string,
  refNamespace = `refs/diffcompass/${crypto.randomUUID()}`,
  runner: Runner = runProcess,
): Promise<PullRequestContext> {
  const parsed = parsePullRequestIdentifier(identifier);
  const localRepository = String((await jsonCommand(runner, ["gh", "repo", "view", "--json", "nameWithOwner"], sourceRepositoryRoot)).nameWithOwner ?? "");
  const repository = parsed.repository ?? localRepository;
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) throw new ReviewError("Could not resolve the GitHub repository for this checkout.");
  if (repository.toLocaleLowerCase() !== localRepository.toLocaleLowerCase()) {
    throw new ReviewError(`The pull request belongs to ${repository}, but this checkout belongs to ${localRepository || "an unknown repository"}.`);
  }
  const fields = "number,title,body,url,author,baseRefName,baseRefOid,headRefName,headRefOid,commits,statusCheckRollup,reviewDecision,state,mergeable,mergeStateStatus,closingIssuesReferences";
  const raw = await jsonCommand(runner, ["gh", "pr", "view", String(parsed.number), "--repo", repository, "--json", fields], sourceRepositoryRoot);
  const [owner, name] = repository.split("/");
  const threadRaw = await jsonCommand(runner, [
    "gh", "api", "graphql", "-f", `query=${THREAD_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${parsed.number}`,
  ], sourceRepositoryRoot);
  const data = threadRaw.data;
  const repositoryData = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>).repository : undefined;
  const pullRequestData = repositoryData && typeof repositoryData === "object" && !Array.isArray(repositoryData) ? (repositoryData as Record<string, unknown>).pullRequest : undefined;
  const prThreads = pullRequestData && typeof pullRequestData === "object" && !Array.isArray(pullRequestData) ? (pullRequestData as Record<string, unknown>).reviewThreads : undefined;
  if (!prThreads || typeof prThreads !== "object" || Array.isArray(prThreads) || !Array.isArray((prThreads as Record<string, unknown>).nodes)) {
    throw new ReviewError("GitHub returned invalid pull request review threads.");
  }
  const pageInfo = (prThreads as Record<string, unknown>).pageInfo;
  if (!pageInfo || typeof pageInfo !== "object" || Array.isArray(pageInfo) || typeof (pageInfo as Record<string, unknown>).hasNextPage !== "boolean") {
    throw new ReviewError("GitHub returned invalid review thread pagination.");
  }
  const nodes = (prThreads as Record<string, unknown>).nodes as unknown[];
  const required = (key: string, max = 100_000) => {
    const value = raw[key];
    if (typeof value !== "string" || !value || value.length > max) throw new ReviewError(`GitHub pull request metadata is missing ${key}.`);
    return value;
  };
  const oid = (key: string) => {
    const value = required(key, 64);
    if (!/^[0-9a-f]{40,64}$/.test(value)) throw new ReviewError(`GitHub pull request metadata has an invalid ${key}.`);
    return value;
  };
  const author = raw.author as Record<string, unknown> | undefined;
  if (!author || typeof author.login !== "string" || !author.login || author.login.length > 500) throw new ReviewError("GitHub pull request metadata has an invalid author.");
  if (raw.number !== parsed.number) throw new ReviewError("GitHub pull request metadata returned a different pull request number.");
  const canonicalUrl = `https://github.com/${repository}/pull/${parsed.number}`;
  if (required("url", 4_096).replace(/\/$/, "").toLocaleLowerCase() !== canonicalUrl.toLocaleLowerCase()) {
    throw new ReviewError("GitHub pull request metadata returned an unexpected URL.");
  }
  if (!Array.isArray(raw.commits) || !Array.isArray(raw.statusCheckRollup)) throw new ReviewError("GitHub pull request metadata is missing commits or checks.");
  const commits = raw.commits.slice(0, 500).map((commit) => {
    if (!commit || typeof commit !== "object" || Array.isArray(commit)) throw new ReviewError("GitHub returned an invalid pull request commit.");
    const item = commit as Record<string, unknown>;
    if (typeof item.oid !== "string" || !/^[0-9a-f]{40,64}$/.test(item.oid) || typeof item.messageHeadline !== "string" || item.messageHeadline.length > 8_000) throw new ReviewError("GitHub returned an invalid pull request commit.");
    const authors = Array.isArray(item.authors) ? item.authors.slice(0, 20).flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
      const author = candidate as Record<string, unknown>;
      const value = [author.login, author.name].find((name): name is string => typeof name === "string" && Boolean(name.trim()) && name.trim().length <= 500);
      return value ? [value.trim()] : [];
    }) : [];
    return { oid: item.oid, headline: item.messageHeadline, authors };
  });
  const checks = raw.statusCheckRollup.slice(0, 500).map((check) => {
    if (!check || typeof check !== "object" || Array.isArray(check)) throw new ReviewError("GitHub returned an invalid status check.");
    const item = check as Record<string, unknown>;
    const nameValue = [item.name, item.context].find((value): value is string => typeof value === "string" && value.length > 0);
    const stateValue = [item.conclusion, item.state, item.status].find((value): value is string => typeof value === "string" && value.length > 0);
    if (typeof nameValue !== "string" || !nameValue || nameValue.length > 8_000 || typeof stateValue !== "string" || !stateValue || stateValue.length > 500) throw new ReviewError("GitHub returned an invalid status check.");
    const urlValue = item.detailsUrl ?? item.targetUrl;
    if (urlValue !== undefined && (typeof urlValue !== "string" || urlValue.length > 4_096)) throw new ReviewError("GitHub returned an invalid status check URL.");
    return {
      name: nameValue,
      state: stateValue,
      url: urlValue as string | undefined,
    };
  });
  const threads = nodes.slice(0, 100).map((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) throw new ReviewError("GitHub returned an invalid review thread.");
    const item = node as Record<string, unknown>;
    const comments = (item.comments as Record<string, unknown> | undefined)?.nodes;
    if (typeof item.id !== "string" || !item.id || item.id.length > 500 || typeof item.path !== "string" || !item.path || item.path.length > 4_096 ||
      typeof item.isResolved !== "boolean" || !Array.isArray(comments)) throw new ReviewError("GitHub returned an invalid review thread.");
    const originalLocation = [item.line, item.startLine, item.originalLine, item.originalStartLine]
      .find((line) => Number.isInteger(line) && Number(line) > 0);
    const diffSide = item.diffSide;
    return {
      id: item.id,
      path: item.path,
      line: originalLocation === undefined ? undefined : Number(originalLocation),
      side: diffSide === "LEFT" ? "old" as const : diffSide === "RIGHT" ? "new" as const : undefined,
      resolved: Boolean(item.isResolved),
      outdated: ![item.line, item.startLine].some(line => Number.isInteger(line) && Number(line) > 0),
      comments: Array.isArray(comments) ? comments.slice(0, 50).map((comment) => {
        if (!comment || typeof comment !== "object" || Array.isArray(comment)) throw new ReviewError("GitHub returned an invalid review thread comment.");
        const entry = comment as Record<string, unknown>;
        const login = (entry.author as Record<string, unknown> | undefined)?.login;
        if (typeof entry.id !== "string" || !entry.id || entry.id.length > 500 || typeof login !== "string" || !login || login.length > 500 ||
          typeof entry.body !== "string" || entry.body.length > 100_000 || typeof entry.url !== "string" || !entry.url || entry.url.length > 4_096) {
          throw new ReviewError("GitHub returned an invalid review thread comment.");
        }
        return { id: entry.id, author: login, body: entry.body, url: entry.url };
      }) : [],
    };
  });
  const issueReferences = raw.closingIssuesReferences;
  let linkedIssue: LinkedIssueContext | undefined;
  let linkedIssueScope: NonNullable<PullRequestContext["providerScope"]>["linkedIssue"] = "none";
  if (issueReferences !== undefined) {
    const references = Array.isArray(issueReferences)
      ? issueReferences.slice(0, 20)
      : issueReferences && typeof issueReferences === "object" && !Array.isArray(issueReferences) && Array.isArray((issueReferences as Record<string, unknown>).nodes)
        ? ((issueReferences as Record<string, unknown>).nodes as unknown[]).slice(0, 20)
        : [];
    const reference = references.find((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
      const item = candidate as Record<string, unknown>;
      const referenceRepository = item.repository && typeof item.repository === "object" && !Array.isArray(item.repository)
        ? (item.repository as Record<string, unknown>).nameWithOwner : undefined;
      return Number.isInteger(item.number) && Number(item.number) > 0 &&
        isCanonicalIssueUrl(item.url, repository, Number(item.number)) &&
        (referenceRepository === undefined || (typeof referenceRepository === "string" && referenceRepository.toLocaleLowerCase() === repository.toLocaleLowerCase()));
    }) as Record<string, unknown> | undefined;
    if (reference) {
      linkedIssueScope = "same-repository-closing-issue";
      linkedIssue = await loadLinkedIssue(runner, sourceRepositoryRoot, repository, reference);
      if (linkedIssue.access !== "available") linkedIssueScope = linkedIssue.access;
    }
  }
  return {
    repository,
    number: Number(raw.number ?? parsed.number),
    url: required("url", 4_096),
    title: required("title", 8_000),
    body: typeof raw.body === "string" ? raw.body.slice(0, 100_000) : "",
    author: author.login,
    baseRefName: required("baseRefName", 4_096),
    baseRefOid: oid("baseRefOid"),
    headRefName: required("headRefName", 4_096),
    headRefOid: oid("headRefOid"),
    sourceRepositoryRoot,
    workspaceRoot: "",
    refNamespace,
    reviewDecision: typeof raw.reviewDecision === "string" && raw.reviewDecision ? raw.reviewDecision : undefined,
    state: raw.state === "OPEN" || raw.state === "CLOSED" || raw.state === "MERGED" ? raw.state : undefined,
    mergeable: raw.mergeable === "MERGEABLE" || raw.mergeable === "CONFLICTING" || raw.mergeable === "UNKNOWN" ? raw.mergeable : undefined,
    mergeStateStatus: typeof raw.mergeStateStatus === "string" && raw.mergeStateStatus ? raw.mergeStateStatus : undefined,
    commits,
    checks,
    threads,
    threadsTruncated: (pageInfo as Record<string, unknown>).hasNextPage as boolean,
    ...(linkedIssue ? { linkedIssue } : {}),
    providerScope: { linkedIssue: linkedIssueScope, relatedResources: "not-requested" },
    updatedAt: new Date().toISOString(),
  };
}

async function git(runner: Runner, cwd: string, args: string[], accepted = [0]) {
  return runner(["git", ...args], cwd, accepted);
}

async function ensurePullRequestCommits(context: PullRequestContext, runner: Runner): Promise<void> {
  const hasCommit = async (oid: string) => git(runner, context.sourceRepositoryRoot, ["cat-file", "-e", `${oid}^{commit}`]).then(() => true, () => false);
  if (!(await hasCommit(context.baseRefOid))) {
    await git(runner, context.sourceRepositoryRoot, ["check-ref-format", "--branch", context.baseRefName]);
    await git(runner, context.sourceRepositoryRoot, ["fetch", "--no-tags", "origin", `+refs/heads/${context.baseRefName}:${context.refNamespace}/base`]);
  }
  if (!(await hasCommit(context.headRefOid))) {
    await git(runner, context.sourceRepositoryRoot, ["fetch", "--no-tags", "origin", `+refs/pull/${context.number}/head:${context.refNamespace}/head`]);
  }
  if (!(await hasCommit(context.baseRefOid)) || !(await hasCommit(context.headRefOid))) {
    throw new ReviewError("Fetched pull request commits do not match GitHub metadata. Retry after the remote update settles.");
  }
}

export async function createPullRequestWorkspace(
  context: PullRequestContext,
  containerRoot: string,
  runner: Runner = runProcess,
): Promise<string> {
  try { await lstat(containerRoot); throw new ReviewError(`Pull request workspace already exists: ${containerRoot}`); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await ensurePullRequestCommits(context, runner);
  await mkdir(containerRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(containerRoot, ".active.json"), `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  const workspace = join(containerRoot, "workspace");
  try {
    await git(runner, context.sourceRepositoryRoot, ["worktree", "add", "--detach", workspace, context.headRefOid]);
    context.workspaceRoot = workspace;
    return workspace;
  } catch (error) {
    await git(runner, context.sourceRepositoryRoot, ["worktree", "remove", "--force", workspace]).catch(() => undefined);
    await rm(containerRoot, { recursive: true, force: true });
    throw new ReviewError("Could not create the isolated pull request workspace.", { cause: error });
  }
}

export async function removePullRequestWorkspace(context: PullRequestContext, runner: Runner = runProcess): Promise<void> {
  if (!context.workspaceRoot) return;
  const workspace = resolve(context.workspaceRoot);
  const container = dirname(workspace);
  if (basename(workspace) !== "workspace") throw new ReviewError("The pull request workspace path is not owned by DiffCompass.");
  const [workspaceMetadata, containerMetadata] = await Promise.all([lstat(workspace), lstat(container)]);
  if (!workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink() || !containerMetadata.isDirectory() || containerMetadata.isSymbolicLink()) {
    throw new ReviewError("The pull request workspace path is not a safe directory.");
  }
  const status = await git(runner, workspace, ["status", "--porcelain"]);
  if (status.stdout.trim()) throw new ReviewError("The isolated pull request workspace has local changes and was retained.");
  await git(runner, context.sourceRepositoryRoot, ["worktree", "remove", workspace]);
  await rm(container, { recursive: true, force: true });
}

export async function updatePullRequestWorkspace(
  current: PullRequestContext,
  runner: Runner = runProcess,
): Promise<PullRequestContext> {
  const latest = await loadPullRequestContext(current.sourceRepositoryRoot, String(current.number), current.refNamespace, runner);
  latest.workspaceRoot = current.workspaceRoot;
  latest.publication = structuredClone(current.publication);
  await ensurePullRequestCommits(latest, runner);
  if (latest.headRefOid !== current.headRefOid || latest.baseRefOid !== current.baseRefOid) {
    const status = await git(runner, current.workspaceRoot, ["status", "--porcelain"]);
    if (status.stdout.trim()) throw new ReviewError("The isolated pull request workspace has local changes. Resolve them before refreshing from GitHub.");
    await git(runner, current.workspaceRoot, ["switch", "--detach", latest.headRefOid]);
  }
  return latest;
}

export async function publishPullRequestReview(
  context: PullRequestContext,
  comments: ReviewComment[],
  outcome: Extract<ReviewOutcome, "accepted" | "feedback"> | "comment",
  intentId: string,
  runner: Runner = runProcess,
  note?: string,
): Promise<{ id: string; url?: string }> {
  const latest = await loadPullRequestContext(context.sourceRepositoryRoot, String(context.number), context.refNamespace, runner);
  if (latest.headRefOid !== context.headRefOid) throw new ReviewError("The pull request changed on GitHub. Refresh it before publishing this review.");
  if (comments.some((comment) => comment.status !== "active")) throw new ReviewError("Outdated comments cannot be published to GitHub.");
  if (comments.some(comment => comment.suggestion && (comment.suggestion.headOid !== context.headRefOid || comment.side !== "new" ||
    comment.body !== githubSuggestionBody(comment.suggestion.replacement)))) throw new ReviewError("This GitHub suggestion no longer matches its saved source or replacement.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(intentId)) throw new ReviewError("The GitHub publication intent is invalid.");
  const marker = `<!-- diffcompass:${intentId} -->`;
  const existing = await jsonValue(runner, ["gh", "api", `repos/${context.repository}/pulls/${context.number}/reviews?per_page=100`], context.sourceRepositoryRoot);
  if (!Array.isArray(existing)) throw new ReviewError("GitHub CLI returned an unexpected review list.");
  const prior = existing.find((review) => review && typeof review === "object" && typeof (review as Record<string, unknown>).body === "string" && ((review as Record<string, unknown>).body as string).includes(marker)) as Record<string, unknown> | undefined;
  if (prior) {
    if ((typeof prior.id !== "number" && typeof prior.id !== "string") || (prior.html_url !== undefined && (typeof prior.html_url !== "string" || prior.html_url.length > 4_096))) {
      throw new ReviewError("GitHub returned an invalid matching review.");
    }
    return { id: String(prior.id), url: prior.html_url as string | undefined };
  }
  const body = {
    commit_id: context.headRefOid,
    event: outcome === "comment" ? "COMMENT" : outcome === "accepted" ? "APPROVE" : "REQUEST_CHANGES",
    body: `${note?.trim() ? `${note.trim()}\n\n` : ""}Submitted from DiffCompass.\n\n${marker}`,
    comments: comments.map((comment) => ({ path: comment.path, line: comment.suggestion ? comment.endLine ?? comment.line : comment.line,
      side: comment.side === "old" ? "LEFT" : "RIGHT", body: comment.body,
      ...(comment.suggestion && comment.endLine !== undefined && comment.endLine > comment.line ? { start_line: comment.line, start_side: "RIGHT" } : {}),
    })),
  };
  const response = await jsonCommand(runner, ["gh", "api", `repos/${context.repository}/pulls/${context.number}/reviews`, "--method", "POST", "--input", "-"], context.sourceRepositoryRoot, JSON.stringify(body));
  if (typeof response.id !== "number" && typeof response.id !== "string") throw new ReviewError("GitHub did not return a review identifier after publication.");
  return { id: String(response.id), url: typeof response.html_url === "string" ? response.html_url : undefined };
}
