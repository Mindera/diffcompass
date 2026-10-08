# DiffCompass

DiffCompass helps you understand a change and how it affects an existing codebase.

Version 2 is a breaking rename: use the `diffcompass` command and skill,
`.diffcompass.json` configuration, and `DIFFCOMPASS_*` environment variables.
Installations and saved sessions now live under the `diffcompass` directories.
Previous installations and saved data are not deleted or automatically migrated.

A local, agent-led walkthrough for Git changes. Understand the change in an
ordered tour, inspect the full diff, ask contextual questions, propose edits,
and complete a local or GitHub review without leaving the browser.

![DiffCompass with changed files, a split diff, conversations, and explicit review decisions](docs/images/overview.png)

[Install](#install) · [Run](#run) · [Capabilities](#capabilities) ·
[GitHub PRs](#github-pull-requests) · [Configuration](#repository-defaults) ·
[Development](#development)

## Install

Releases contain self-contained binaries for macOS, Linux, and Windows on Intel
and ARM. Bun is not required. This repository is private, so installation uses
an authenticated GitHub account with repository access:

```sh
gh auth login
gh api -H "Accept: application/vnd.github.raw+json" repos/rcosteira79/diffcompass/contents/scripts/install.sh | bash
diffcompass doctor
```

Windows PowerShell:

```powershell
gh auth login
& ([scriptblock]::Create((gh api -H "Accept: application/vnd.github.raw+json" repos/rcosteira79/diffcompass/contents/scripts/install.ps1 | Out-String)))
diffcompass doctor
```

The installer downloads private release assets through authenticated `gh`,
verifies their checksum, installs the command, and links the bundled skill into
Codex, Claude Code, Gemini CLI, and GitHub Copilot CLI. It never prints or embeds
your token. Users without repository access cannot install private releases.

| Need | Command or option |
| --- | --- |
| Binary only; do not install skills | Append `--minimal` or `--binary-only` (`-Minimal` on Windows) |
| Pin a release | `DIFFCOMPASS_VERSION=v1.2.0` before `bash` |
| Update | `diffcompass update [--version vX.Y.Z]` |
| Roll back | `diffcompass rollback [--to X.Y.Z]` |
| Preview uninstall | `diffcompass uninstall --dry-run` |
| Uninstall | `diffcompass uninstall --yes` |
| Also remove saved reviews | `diffcompass uninstall --yes --purge` |
| Custom install locations | `DIFFCOMPASS_BIN_ROOT`, `DIFFCOMPASS_INSTALL_ROOT`, and per-agent `*_SKILL_ROOT` variables |

Updates preserve minimal installations unless `--no-minimal` is explicit.
Uninstall preserves review sessions unless `--purge` is explicit and never
removes unrelated commands or unmarked skill directories. Contributors can
instead clone the repository and run `./scripts/install.sh` or
`.\scripts\install.ps1`.

## Run

Review a branch or working tree against its merge base:

```sh
diffcompass --repo /path/to/repository --base origin/main --open
```

Ask an agent with the bundled [diffcompass skill](skills/diffcompass/SKILL.md)
to start an attached review, or launch one directly while the agent serves the
bridge:

```sh
diffcompass --attached --start-tour --open --preview-redirect \
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
themes (`GitHub`, `Vitesse`, `DiffCompass`, and Catppuccin Frappé, Macchiato,
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
symbol's blast radius, source links, and related tests. Release packages include
a pinned Archify renderer, run with the executable's embedded runtime—no Node
installation or separate checkout is required. Supported diagrams gain interactive
node inspection and Fit/zoom/pan controls. Other diagrams remain available through
Mermaid. Developers can override the bundled renderer with
`DIFFCOMPASS_ARCHIFY_DIR`. Archify's MIT license, font license, upstream notices,
and pinned revision are included in `share/diffcompass/archify`; optional
third-party brand logos are excluded.

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

Native Mermaid component diagrams automatically adjust arrow captions after every
render, including regeneration, briefing previews, and HTML exports. Caption
placement preserves Mermaid's original node positions, uses compact
background-matched masks, and seeks clearance from other arrows, captions, and
nodes. Original curves are retained when caption placement succeeds. If a caption
still intersects another arrow, a bounded smooth-detour search can reroute that
arrow; a candidate is accepted only when it clears nodes and all captions. This
is a renderer rule, not something diagram authors need to prompt for.
New native render paths must use `ReviewDiagramLabels.mount`; regression tests
protect that boundary and the dense-diagram fixture. Extremely crowded diagrams
can still exceed the available caption space; placement is best-effort rather
than a guarantee for arbitrary graphs.

Every diagram supports expansion; applicable views also support independent pan,
zoom, keyboard/pinch movement, reset, and full-screen inspection. Mermaid is
bundled locally and runs in strict mode—no CDN is loaded. Invalid component
diagrams receive two bounded correction attempts; startup reports failure rather
than silently dropping required architecture.

Invalid optional call flows and missing dry-run diagram links also receive up to
two correction attempts, including the rejected outline and validation details.
If repair fails, the tour keeps valid content and reports omitted diagrams or
links in its planning notes. Dry-run scenarios retain their independent source
validation. Unchanged calls may anchor unchanged source lines; added and removed
calls still require matching changed diff rows.

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
diffcompass pr 106 --repo /path/to/repository --open
diffcompass pr https://github.com/OWNER/REPOSITORY/pull/106 \
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
diffcompass sessions
diffcompass sessions --all
diffcompass sessions resume 169dedd6 --open
diffcompass sessions rename 169dedd6 "Push notification review"
diffcompass sessions archive 169dedd6
diffcompass sessions unarchive 169dedd6
diffcompass sessions delete 169dedd6 --yes
diffcompass sessions prune --repo . --days 30 --max 50 [--yes]
```

Sessions live under `${XDG_STATE_HOME:-~/.local/state}/diffcompass/sessions`
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

Add `.diffcompass.json` at the repository root:

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
`diffcompass bridge`. See [docs/agent-adapters.md](docs/agent-adapters.md)
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

#### Monaco preview

The normal review UI includes **Shiki** and **Monaco** renderer choices. Monaco
is opt-in; Shiki remains the default and can be restored without changing the review. Monaco
loads captured Before/After blobs through the authenticated `/api/diff/sources`
endpoint, not the live workspace. Files load on demand; offscreen editors and
models are released while their view state and measured card height are retained.
Reloading waits for computed diffs and settled layout before reporting a new
height; measurements above the viewport preserve the reading position.
Text, image and fallback
cards share one ordered page-level list, without a nested scrolling file group.
Source refreshes cannot
silently save a draft against a different comparison.

Monaco tour stops retain their Before/After source identities in Split and
Unified views. Original ranges can span removed and unchanged code; inserted
After lines are not included in a Before highlight. Navigation reveals folded
context without selecting text and scrolls to the stop's banner, not merely the
file header. Before-side tours no longer switch the file to Shiki.

Select a line or range on the After side and choose **Suggest edit** from the
toolbar or context menu. Its separate editable Monaco draft replaces full lines;
**Propose edit** saves a syntax-highlighted inline card beside the code, like a
comment, without changing the source or leaving the current tour position.
Cards survive navigation and reloads and follow Show/Hide comments. Apply and
Reject are available on the card; Apply, Reject and Undo use themed confirmations
that describe their scope. Activity retains the audit trail, full patch
inspection and Undo. Cancel discards only the draft, and failed saves retain its
text. The captured diff remains read-only. Outdated suggestions are labelled
rather than attached to unrelated source lines.
Drafts retain syntax highlighting, including the fence's language when editing
code inside a Markdown fenced block.

For GitHub PR reviews, **Add to GitHub review** converts an eligible saved edit
into a native suggestion in the local review draft. **Return to local** restores
the pending proposal and preserves its replacement. **Apply locally** writes only
to the isolated PR workspace. Queueing, returning, and publishing a suggestion
do not apply the replacement, commit it, or push it.

The final GitHub review confirmation names the number of selected suggestions
and the PR head. **Submit suggestions** publishes only selected queued suggestions
as a neutral GitHub `COMMENT` review, without approving or requesting changes,
including when you own the PR. Other review comments remain in the draft and the
local tour stays open. Published suggestions retain a receipt, cannot be returned
to local or republished, and are excluded from later submissions. You can submit
another suggestion batch or finish with a separate review decision. Suggestions
can also be included in the existing approval/request-changes review.
Selected suggestions become GitHub suggestion blocks that the PR author can
apply on GitHub. The saved source,
replacement, selected comment IDs, and PR head are checked before publication;
retries reuse the durable review intent to avoid duplicating a submitted review.

Native suggestions require a captured regular text file from the unmodified PR
head and at most 100 contiguous After lines within one PR diff hunk (three lines
of context). Expanded context outside those hunks, ranges spanning hunks, old
saved proposals without exact selection metadata, binary files, symlinks, and
local-only changes cannot be queued. The generated comment must fit the existing
8,000-character review-comment limit; selected source context is capped at 32,000
characters. Multiline replacements, empty replacements (deletions), and literal
backticks are supported; longer Markdown fences preserve embedded fences.
GitHub remains the final authority on diff anchors and suggestion applicability.

Implementation references: [GitHub review API](https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request),
[ranged review comments](https://docs.github.com/en/rest/pulls/comments#create-a-review-comment-for-a-pull-request),
[suggesting changes](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/commenting-on-a-pull-request),
and [nested code fences](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-and-highlighting-code-blocks).

Comments and questions can also target expanded unchanged context. Anchors are
validated against captured Before/After source, including multiline selections,
and rechecked after refresh. Line comments outside the original GitHub diff stay
local and are labelled **Local only**; they cannot be included in a GitHub review.
Quote comments retain their existing local-only behavior.

Live PR threads appear beside the code with Markdown, replies and resolved state.
**Reply in GitHub** opens the existing GitHub thread; refresh the pull request to
load replies and resolution changes. Threads with only historical or missing
line positions remain at file level instead of being attached to unrelated code.
Thread-only updates preserve the editor, scroll position and open drafts.
Both renderers offer **Show/Hide comments** for local comments and PR threads.
The visibility preference survives renderer switches and reloads; gutter markers
remain available while inline comments are hidden.

Run `bun scripts/monaco-fixture.ts` for a disposable normal-server fixture, or
`bun run test:monaco` for its browser regression suite (Chrome locally; install
Playwright Chromium in CI). It covers focused J/K navigation, editable-input
guards, stale drafts, lazy loading/disposal, whitespace changes, mixed-file order,
page scrolling and stable lazy remounts, reviewed-card collapse, per-file fallback,
suggested-edit drafts/proposals/apply/undo, expanded-context comments/questions,
PR-thread rendering and refresh, local workers and CSP. PR-thread browser tests
use intercepted provider-shaped data and never publish to GitHub.
`bun run verify` includes source API tests.
Set `DIFF_VIEWER_STATE` to a fixture's saved session path when restarting it to
keep its review state and URL; `DIFF_VIEWER_PORT` selects its port.

The browser implementation lives in `public/monaco/`; prototype fixtures reuse
it. Releases package the pinned Monaco 0.55.1 editor, workers, fonts and licenses
under `share/diffcompass/monaco`. The hash-guarded compatibility adapter exposes
removed-line source positions and binds Monaco's global hover/Markdown helpers
to its root service instead of an evictable editor. Revalidate this adapter and
the browser suite before upgrading Monaco; do not patch `node_modules`.

All six syntax palettes (GitHub, Vitesse, DiffCompass and the three Catppuccin
variants) apply to Monaco diffs, source/peek views and suggestion editors. Theme
changes recolor open editors without replacing their models or drafts. Monaco
keeps its native tokenization, so individual syntax scopes can differ from Shiki.
Catppuccin retains its dark code surface even with light application chrome.
Unified Before-side tour anchors are supported natively; real-PR end-to-end,
actual-device validation and green browser CI remain rollout gates.
Images, unsupported/large
files (over 256 KB per side), workspace views and proposal previews retain the
Shiki renderer. Sequence-diagram code snippets are a separate surface.

#### General checks

Map types describe evidenced roles (for example Agent skill, Script, ViewModel,
Use case, Repository, or Domain model), independently of a node's name and
its domain vocabulary from `CONTEXT.md`. Architecture and sequence generation
can supply `nodeRoles` keyed by Mermaid node id, each with a `type` and a
source-grounded `evidence` explanation. The Types filter groups these roles;
component details include “Why this type”. Names and suffixes alone do not
establish a role. Older saved maps without role evidence remain usable, show
“Type unspecified” in the filter, and omit the type badge. Regenerate those
maps to obtain classifications; existing labels are not silently reinterpreted.

```sh
bun run verify
bun run build:release
```

Pushing a matching `v*` tag runs the full suite, builds all six platform
archives, publishes checksums, and creates a GitHub Release.

See [ROADMAP.md](ROADMAP.md) for shipped scope, upcoming work, and remaining
review-workflow gaps.

### Monaco PR-comment fixture

For sample PR comments in the current per-file Monaco renderer (without a
GitHub connection), run `DIFF_VIEWER_PR_EXAMPLE=1 DIFF_VIEWER_PORT=47684 bun scripts/monaco-fixture.ts`.
Select **Monaco**, then check `src/cart.ts:17` and expand gaps in
`src/context-example.ts`. Each gap has one **Expand all** button; revealing
the whole gap grows the file card with the page. PR threads are
read-only; local comments and reviewed flags remain editable. Suggested edits
can be proposed, previewed, applied, undone and rejected. Apply/Undo use the real
local edit pipeline, restricted to the owned temporary fixture repository (no
shared Git worktree or remotes). Their confirmation explicitly identifies this
disposable scope. External GitHub operations, generation and refresh stay blocked.
Resume that same fixture with `DIFF_VIEWER_STATE=/absolute/path/to/session.json`;
keep `DIFF_VIEWER_PR_EXAMPLE=1` set. The printed session path contains its review state.

For a **fresh** fixture with Before-side tour examples, also set
`DIFF_VIEWER_BEFORE_TOUR=1` (omit `DIFF_VIEWER_STATE`). Its first five stops cover
removed, mixed removed/unchanged, unchanged, and folded original source, followed
by the usual After stops. Choose Monaco and Unified, then test Next/Previous,
Split, Wrap, comments, and returning to Current step. This flag never replaces
the tour in a resumed session.

### Lifecycle layout fixture

With dependencies already present and `DIFFCOMPASS_ARCHIFY_DIR` pointing to an
existing renderer bundle, launch a fresh captured-code example:

```sh
DIFFCOMPASS_FIXTURE_PORT=47786 bun run scripts/lifecycle-fixture.ts
```

Open the printed URL, then select **Receipt job: retry or cancel** in the
diagram picker under **Diagrams → Data & lifecycle**. The five states, retry loop, cancellation
branches, and terminal exits match the captured `src/receipt-job.ts` code.
Sources open the captured diff; **Back to diagram** restores the map, selection,
camera, and scroll position. A rendering failure retains the native Mermaid
source. The fixture uses a new temporary repository and does not invoke an agent.

For browser verification, pass an existing Playwright module and that fixture URL:

```sh
node scripts/lifecycle-browser.mjs /absolute/path/to/playwright/index.mjs 'http://127.0.0.1:PORT/#token=TOKEN'
node scripts/lifecycle-pointer-browser.mjs /absolute/path/to/playwright/index.mjs 'http://127.0.0.1:PORT/#token=TOKEN'
```

These checks cover headless Chrome at desktop and 390px widths, actual mouse
input, source return, consecutive visible lane headings, geometry, and native
fallback. They do not establish Safari, Firefox, or touch-device coverage.
The Chrome viewport helper synchronizes native content size with emulated size:
Playwright 1.63 / Chrome 154 otherwise loses iframe clicks near the viewport's
bottom edge, also reproducible with a plain sandboxed button. Setting
`DIAGRAM_RAW_VIEWPORT=1` runs that negative control without the sizing correction;
it exits nonzero when the pointer environment is affected.
