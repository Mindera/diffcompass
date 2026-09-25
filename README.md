# Code Review Tour

A local, agent-led walkthrough for Git changes. Understand the change in an
ordered tour, inspect the full diff, ask contextual questions, propose edits,
and complete a local or GitHub review without leaving the browser.

![Code Review Tour with changed files, a split diff, conversations, and explicit review decisions](docs/images/overview.png)

[Install](#install) · [Run](#run) · [Capabilities](#capabilities) ·
[GitHub PRs](#github-pull-requests) · [Configuration](#repository-defaults) ·
[Development](#development)

## Install

Releases contain self-contained binaries for macOS, Linux, and Windows on Intel
and ARM. Bun is not required. This repository is private, so installation uses
an authenticated GitHub account with repository access:

```sh
gh auth login
gh api -H "Accept: application/vnd.github.raw+json" repos/rcosteira79/code-review-tour/contents/scripts/install.sh | bash
code-review-tour doctor
```

Windows PowerShell:

```powershell
gh auth login
& ([scriptblock]::Create((gh api -H "Accept: application/vnd.github.raw+json" repos/rcosteira79/code-review-tour/contents/scripts/install.ps1 | Out-String)))
code-review-tour doctor
```

The installer downloads private release assets through authenticated `gh`,
verifies their checksum, installs the command, and links the bundled skill into
Codex, Claude Code, Gemini CLI, and GitHub Copilot CLI. It never prints or embeds
your token. Users without repository access cannot install private releases.

| Need | Command or option |
| --- | --- |
| Binary only; do not install skills | Append `--minimal` or `--binary-only` (`-Minimal` on Windows) |
| Pin a release | `CODE_REVIEW_TOUR_VERSION=v1.1.25` before `bash` |
| Update | `code-review-tour update [--version vX.Y.Z]` |
| Roll back | `code-review-tour rollback [--to X.Y.Z]` |
| Preview uninstall | `code-review-tour uninstall --dry-run` |
| Uninstall | `code-review-tour uninstall --yes` |
| Also remove saved reviews | `code-review-tour uninstall --yes --purge` |
| Custom install locations | `CODE_REVIEW_TOUR_BIN_ROOT`, `CODE_REVIEW_TOUR_INSTALL_ROOT`, and per-agent `*_SKILL_ROOT` variables |

Updates preserve minimal installations unless `--no-minimal` is explicit.
Uninstall preserves review sessions unless `--purge` is explicit and never
removes unrelated commands or unmarked skill directories. Contributors can
instead clone the repository and run `./scripts/install.sh` or
`.\scripts\install.ps1`.

## Run

Review a branch or working tree against its merge base:

```sh
code-review-tour --repo /path/to/repository --base origin/main --open
```

Ask an agent with the bundled [code-review-tour skill](skills/code-review-tour/SKILL.md)
to start an attached review, or launch one directly while the agent serves the
bridge:

```sh
code-review-tour --attached --start-tour --open --preview-redirect \
  --repo /path/to/repository
```

Attached mode uses the launching agent for planning, explanations, questions,
and explicitly requested edits. Standalone mode discovers authenticated Codex,
Claude Code, Gemini CLI, and GitHub Copilot CLI installations. The setup screen
selects the agent, model, reasoning effort, and optional analysis outputs.

Useful launch options:

| Option | Purpose |
| --- | --- |
| `--base REF` | Compare against a branch, commit, or captured Git tree |
| `--agent`, `--model`, `--reasoning` | Set standalone-agent defaults |
| `--caller-model`, `--caller-reasoning` | Label an attached session without switching models |
| `--no-findings` | Disable findings for this session |
| `--media PATH` | Attach repeatable screenshot or video evidence |
| `--port PORT` | Select the loopback port |
| `--preview-redirect` | Redirect bare `/` to the tokenized page for trusted preview tools |
| `--resume STATE.json --open` | Resume from the state path printed by the server |

The server binds to `127.0.0.1`, normally on ports 47550–47599, and prints a
tokenized URL. Keep that URL private. `--preview-redirect` exposes the browser
token to anyone who can reach the loopback server, so use it only with trusted
local preview tooling.

![Guided review with an inline stop annotation, highlighted code, phase context, and live agent explanation](docs/images/guided-tour.png)

## Capabilities

### Review workflow

| Area | What it provides |
| --- | --- |
| Comparison | Merge-base comparison covering committed, staged, unstaged, and untracked changes; explicit parent support for stacked branches. |
| Guided route | Agent-organized `Tour → Phases → Stops`, precise old/new anchors, inline stop cards, plain-language explanations, Previous/Next navigation, and configurable preparation of 0–5 upcoming stops. |
| Briefing | Configurable and reorderable pre-tour summary with review cues, effort estimate, component diagrams, call flows, and sequence diagrams; expandable previews and `View briefing` after starting. |
| Free navigation | Browse the repository and diff at any time; `Current step` returns to an off-screen stop. Finishing the tour leaves the review and questions open. |
| Review state | Per-file reviewed status, test-only and status filters, `All files in this tour`, automatic stale-annotation detection, atomic persistence, and restart/resume. |
| Checkpoints | Named snapshots, revision history, `Full change` / `Since last review`, reopened files that changed again, and preserved state for unchanged files. |
| Workspace | Persistent repository/branch identity, independently resizable Files and agent panes, state-preserving refresh, and an About view with runtime/session details. |
| Lifecycle | Saved-session library plus a non-blocking release check and one-click update control shown only when an update exists. |
| Completion | Approve, Approve with comments, Request changes, or neutral Close review; optional policy requiring every changed file to be reviewed. |

During an active tour, the file tree and diff show the changed files declared by
the current phase. `Exit tour` restores the full comparison; `Resume tour`
returns to the active stop.

### Diff and navigation

| Area | What it provides |
| --- | --- |
| Files | Search changed paths and code; flat changed-path or full repository tree; compact folders; unchanged source navigation; bounded 1,000-row rendering for large diffs. |
| Presentation | Split or unified layout, scroll or wrap, local syntax highlighting, light/dark themes, optional `+`/`−` markers, and word-level changed-text highlighting. Desktop and mobile choices persist separately across sessions. |
| Context | Progressive hunk expansion or full-file expansion while preserving the visible line, drafts, and reading position. |
| Whitespace | Labels whitespace-only pairs, shows spaces and tabs without changing copied text, and summarizes affected pairs. |
| Symbols | Bounded definition/usage Peek with partial-name suggestions, syntax-highlighted results, and a navigation back trail. |
| Shortcuts | J/K stops, `?` help, Escape to cancel drafts, Z Focus mode, and Command+Enter on macOS or Ctrl+Enter elsewhere to submit multiline forms. |
| Responsive UI | Files drawer, horizontally scrolling tabs, unified mobile default, touch-sized line actions, keyboard-aware forms, stacked image previews, and separate Tour/Questions controls. |

Application appearance (`System`, `Light`, `Dark`) is independent of syntax
themes (`GitHub`, `Vitesse`, `Review Tour`, and Catppuccin Frappé, Macchiato,
or Mocha).

### Questions, comments, and edits

| Action | Scope and behavior |
| --- | --- |
| Click a line | Open an inline composer and choose Comment or Ask agent. |
| Select lines | Copy, Edit, Comment, Ask agent, or Peek symbol; comments/questions quote the exact range. |
| Add context | Remove selected code or attach up to eight repository text files (32 KiB each) to a new question. |
| Conversations | Preserve editable line-, range-, stop-, and review-scoped threads; reopen or delete them from code badges or the Conversations tab without moving the tour. |
| Reviewer edit | Create a syntax-highlighted, multiline replacement suggestion without changing the working tree. |
| Agent edit | In attached mode, prepare explicitly requested changes in an isolated worktree for Apply, Reject, or conflict-safe Undo. |
| Activity | Group proposed repository changes by request, affected files, diff totals, and agent-reported verification. |

Suggestion bundles retain text, binary, added, deleted, and renamed files. They
never commit or push automatically, and the review cannot be completed while a
proposal is pending. The reviewed working tree stays untouched until `Apply`.

### Findings and evidence

| Capability | Behavior |
| --- | --- |
| Scope | Collapsible stop-, phase-, and review-level P0–P3 findings with code pins, summaries, selected highlighting, back-to-code navigation, and a complete Findings view. |
| Validation | A separate repository-aware pass traces runtime, build, signing, CI, and delivery consumers, then performs a focused recall audit. Unsupported findings are removed; a malformed audit fails closed. |
| Evidence | Labelled Observation, Causal path, Impact, and Coverage facts. |
| Decisions | Accepted, False positive, Intentional, Deferred, Fixed, or Obsolete after refresh, with persistent reviewer notes. |
| Policy | Repository instructions, category allowlists, and minimum severity enforced by the server as well as the prompt. |
| GitHub | Queue selected findings as inline pull-request review comments. |

### Architecture and analysis

The **Maps** tab has two modes: **Understand the change** for component, call,
sequence, and data/lifecycle diagrams; **Explore impact** for the selected
symbol's blast radius, source links, and related tests. When a local Archify
renderer is configured, supported diagrams gain interactive node inspection and
Fit/zoom/pan controls. Other diagrams remain available through Mermaid.

Architecture comparisons show Before, Delta, and After when the saved evidence
supports them. Delta includes additions and removals as well as modifications;
an incomplete Before view does not imply that missing connections never existed.

| View | What it shows |
| --- | --- |
| Domain model | Business concepts and documented relationships from scoped `CONTEXT.md` glossaries and `CONTEXT-MAP.md`. Click a concept for its definition and source; matched code components show the same domain vocabulary. Missing or ambiguous glossary matches keep code-derived names. |
| Component maps | Implemented behavior and implementation journey using plain-language components, labelled relationships, dependency changes, and new/touched/removed/external status. |
| Call flows | Concrete changed entrypoints, Before/After/Changes call trees, added/removed edge counts, exact diff evidence, affected files, honest labels for dynamic dispatch, and single/all regeneration. |
| Sequence diagrams | Goal-critical runtime interactions rendered locally from a validated Mermaid subset, with affected files, provenance, editable source, single/all regeneration, and source fallback. |
| Adaptive diagrams | Evidence-gated state machines and data-model/ER views, repository observations, changed-file support, notation legends, and honest empty results when no extra diagram is justified. |

Every diagram supports expansion; applicable views also support independent pan,
zoom, keyboard/pinch movement, reset, and full-screen inspection. Mermaid is
bundled locally and runs in strict mode—no CDN is loaded. Invalid component
diagrams receive two bounded correction attempts; startup reports failure rather
than silently dropping required architecture.

### Markdown, images, and supplied media

| Content | Support |
| --- | --- |
| Markdown diffs | Rendered Before/After documents with addition/deletion and exact changed-word highlights, syntax-highlighted fenced code, tables, and line-anchored tour stops. |
| Changed PNGs | Before/After previews, Added/Removed captions, full-size viewing, and image-level Comment / Ask agent actions; up to 20 MiB per image in live review. |
| Supplied evidence | Repeatable `--media` imports for PNG, JPEG, GIF, WebP, and MP4; up to 12 files, 15 MiB per image, or 100 MiB per video. |

Supplied media is copied into session state, survives resume, and never modifies
the reviewed repository. MP4 playback depends on browser codec support. PNG diff
previews are not included in exports or pending-suggestion previews.

### Exports

`Settings → Export` downloads Markdown or a self-contained HTML review at any
time, including after closure.

| Included | Export behavior |
| --- | --- |
| Tour and diff | Complete route, changed-file state, stop markers, syntax-highlighted code, and selected wrap/scroll presentation. |
| Rich views | Markdown previews plus component, call-flow, sequence, and adaptive diagrams with interactive navigation and inspection controls. |
| Review record | Structured findings, reviewer feedback, comments, and questions. |
| Privacy | No remote assets, session tokens, or repository filesystem paths. |
| Safety | Agent, editing, commenting, and regeneration controls are omitted. |

## GitHub pull requests

Authenticate GitHub CLI and launch from a checkout of the same repository:

```sh
gh auth login
code-review-tour pr 106 --repo /path/to/repository --open
code-review-tour pr https://github.com/OWNER/REPOSITORY/pull/106 \
  --repo /path/to/repository --attached --start-tour --open
```

The source checkout stays on its branch. The PR is fetched into a persistent,
isolated worktree and compared using GitHub's exact base and head commits.

| PR capability | Behavior |
| --- | --- |
| Context | Collapsible rendered/raw description, metadata, checks with explanations and refresh, linked commits, the first 100 review threads, and an optional full-width view. |
| Issue assessment | Bounded assessment of explicit top-level acceptance criteria from one trusted, same-repository closing issue—or a reviewer-supplied local Markdown task—with Satisfied, Partial, Missing, or Unclear status. |
| Review comments | Include or exclude line comments and finding-derived comments before publishing. |
| Decisions | Explicit confirmation for Approve, Approve with comments, or Request changes, bound to a rechecked head SHA. |
| Retry safety | A durable marker reuses a remote review instead of duplicating it after an interrupted response. |
| Local-only exit | `Approve tour without approving the pull request` closes the local tour without publishing a GitHub review. |

Suggestions modify only the isolated PR worktree and are never pushed to the PR
branch. Remote refreshes require a clean isolated worktree and mark stale local
annotations for reassessment. Issue assessment retains bounded metadata and
criteria, not unrelated issues, old PRs, or unstructured checklist prose.

## Completing a review

| Action | Result |
| --- | --- |
| Finish tour | Ends guided navigation while leaving the review and questions open. |
| Approve | Closes as approved without an overall note; remove comments or use Approve with comments. |
| Approve with comments | Adds an overall non-blocking note and selected inline comments. |
| Request changes | Adds the required-change note and selected inline comments. |
| Close review | Closes locally without a verdict or GitHub publication. |

After completion, the page attempts to close after five seconds. If blocked by
the browser, it remains read-only with manual-close guidance. Attached decisions
return to the launching agent; GitHub publication always requires confirmation.

## Sessions and retention

Manage saved tours in `Settings → Manage sessions` or from the CLI:

```sh
code-review-tour sessions
code-review-tour sessions --all
code-review-tour sessions resume 169dedd6 --open
code-review-tour sessions rename 169dedd6 "Push notification review"
code-review-tour sessions archive 169dedd6
code-review-tour sessions unarchive 169dedd6
code-review-tour sessions delete 169dedd6 --yes
code-review-tour sessions prune --repo . --days 30 --max 50 [--yes]
```

Sessions live under `${XDG_STATE_HOME:-~/.local/state}/code-review-tour/sessions`
and are written atomically. Pruning previews by default, honors repository
retention defaults, preserves archived sessions unless requested, and can remove
stale tool-owned temporary directories with `--temp-hours N`. Process locks
protect active sessions and proposal/bridge workspaces; paths and freshness are
rechecked before deletion. PR worktrees are removed only from the tool-owned
state directory and only when clean.

## Comparison base

When `--base` is omitted, resolution uses:

1. `branch.<current>.reviewTourBase` from local Git config;
2. `origin/HEAD`;
3. `origin/main`, `origin/master`, `main`, or `master`.

For a stacked branch:

```sh
git config branch.my-feature.reviewTourBase parent-feature
```

## Repository defaults

Add `.code-review-tour.json` at the repository root:

```json
{
  "base": "origin/main",
  "agent": "codex",
  "model": "gpt-5.6",
  "reasoning": "high",
  "diff": {
    "layout": "split",
    "changedFilesOnly": true,
    "contextLines": 25
  },
  "review": {
    "requireAllFilesReviewed": true,
    "closeOutcome": "accepted"
  },
  "analysis": {
    "instructions": [
      "Treat authentication and persisted-session changes as high risk."
    ],
    "findings": {
      "enabled": true,
      "categories": ["correctness", "security", "testing"],
      "minimumSeverity": "medium"
    }
  },
  "retention": {
    "maxAgeDays": 30,
    "maxSessions": 50,
    "includeArchived": false
  }
}
```

| Setting | Bounds and precedence |
| --- | --- |
| `diff.contextLines` | 3–200 |
| `review.closeOutcome` | `accepted` or `cancelled`; cancelled exposes only Cancel review |
| `analysis.instructions` | Up to 32 distinct instructions, 2,000 characters each |
| Finding categories | Up to 32 names |
| Minimum severity | `low`, `medium`, `high`, or `critical` |
| Precedence | Explicit CLI values → repository defaults → built-in/Git-inferred defaults |

Unknown settings fail closed. Resumed sessions retain their original settings.
Repository instructions cannot override read-only execution, evidence rules, or
the response contract. Component maps, call flows, sequence diagrams, adaptive
diagrams, and findings start enabled; disabling one skips its generation work.

## Attached-agent protocol

The launching agent must keep serving authenticated bridge events; invoking the
CLI alone does not provide a responder. The bundled skill documents the
long-lived watcher, bounded polling fallback, and response schemas.

- `--attached --open` implies `--start-tour`, preparing the outline and first
  explanation before opening one user-facing page.
- Future stops prepare concurrently inside the configured window; questions
  bypass that queue.
- Browser and bridge tokens are separate. Browser mutations require same-origin
  requests; the bridge token uses an owner-only temporary file.
- Closing sends the outcome, overall note, and feedback to the same agent.
- Feedback includes the reviewed Git tree. Passing it back through `--base`
  scopes a follow-up tour to feedback-induced changes.
- A lost attached heartbeat may use the local fallback, but edits remain
  request-gated and isolated.

Standalone agents remain read-only, although reviewers can still author edit
suggestions.

## Development

```sh
bun install --frozen-lockfile
bun run src/cli.ts --repo /path/to/repository --base origin/main --open
```

For a development-only global command, run `bun install --global .` and ensure
`bun pm bin -g` is on `PATH`. Internal attached operations use
`code-review-tour bridge`. See [docs/agent-adapters.md](docs/agent-adapters.md)
for standalone discovery, continuation, and read-only execution contracts.

### Reusable test fixture

```sh
bun run fixture --open
```

Each run recreates a disposable Git repository and canonical persisted session
under the system temporary directory. The fixture covers two phases, four stops,
inline feedback, structured findings, component/sequence/adaptive diagrams, a
checkpoint, conversations, activity, changed PNGs, modified and added Markdown,
and simulated PR/issue context without calling GitHub. Later explanations begin
unprepared so prepare-ahead behavior can be tested. Use
`bun run fixture --prepare-only` when only the files and state are needed.

### Verify and release

```sh
bun run verify
bun run build:release
```

Pushing a matching `v*` tag runs the full suite, builds all six platform
archives, publishes checksums, and creates a GitHub Release.

See [ROADMAP.md](ROADMAP.md) for shipped scope, upcoming work, and remaining
review-workflow gaps.
