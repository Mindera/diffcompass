# Code Review Tour

A local, agent-led walkthrough for Git changes. The browser keeps the repository tree, full diff, ordered tour, call-flow changes, sequence diagrams, findings, review comments, and a resumable agent conversation in one place. The persistent header names the repository and branch being reviewed, so parallel review sessions remain easy to distinguish.

![Code Review Tour showing the repository tree, split diff, repository and branch identity, and tour options](docs/images/overview.png)

Before the tour starts, choose the attached or installed agent, its model and
reasoning level, and whether this run should include the component map, changed
call flows, sequence diagrams, and findings. All optional outputs are enabled by
default; disabling one skips that generation work.

The selected agent plans an ordered route through the change, anchors every stop
to the relevant code, and stays available for follow-up questions.

![Guided review with an inline stop annotation, highlighted code, phase context, and live agent explanation](docs/images/guided-tour.png)

During the tour, the active stop is highlighted and summarized directly in the
diff. The agent pane shows the current phase and a short explanation, while the
file tree and code remain freely navigable. `Previous` and `Next` return the
reviewer to the ordered route without locking ordinary browsing.

## Features

- compares the merge base of a parent branch with the current working tree;
- includes committed, staged, unstaged, and untracked changes;
- identifies the active repository and branch in the persistent top bar, using pull-request metadata when reviewing an isolated GitHub PR workspace;
- renders the complete repository tree, unchanged source files, and the branch diff between independently resizable file and agent panes;
- detects installed Codex, Claude Code, Gemini CLI, and GitHub Copilot CLI agents;
- lets the reviewer choose an available agent, model, and reasoning effort, plus whether to generate the component map, call-flow changes, sequence diagrams, and findings;
- asks the selected agent to organize the change into logical phases and precise code stops;
- preloads the next explanation while the reviewer reads the current stop;
- keeps follow-up questions in the same agent conversation;
- places a prominent tour annotation immediately before the active code while the agent gives a short, plain-language explanation in a separately scrollable panel;
- keeps the diff and file navigation reviewer-controlled; only Start, Previous, and Next jump to a tour anchor;
- declares each phase's changed files and their role in a collapsed-on-entry section, with Git-derived additions and deletions;
- separates stop-scoped and phase-scoped P0–P3 findings, with collapsed phase summaries matching the in-code pin tooltips, selected-finding highlighting, back-to-code navigation, and a complete Findings view for global and migrated analysis;
- syntax-highlights loaded diffs locally in both light and dark themes;
- traces changed caller-to-callee edges from concrete entrypoints, compares their Before and After trees, and links every added or removed call back to its diff evidence;
- renders Mermaid sequence diagrams as strict local SVG for goal-critical flows, with exact expandable affected-file lists, explicit fully traced, partly inferred, or unverified provenance wording, validated editing, source fallback, and agent regeneration;
- applies bounded repository review instructions, finding categories, and a minimum finding severity;
- validates findings in a separate repository-aware pass that traces consequential candidates through their actual runtime, build, signing, CI, and delivery consumers and performs a focused recall audit before results are shown;
- exports the complete tour, call flows, sequence diagrams, findings, reviewer feedback, changed-file state, and diff as Markdown or self-contained HTML;
- refreshes when repository files change and marks stale annotations as outdated;
- records agent-authored file changes, their triggering request, and verification in an Activity timeline;
- prepares attached-agent edits in isolated worktrees with explicit Apply, Reject, and conflict-safe Undo controls;
- persists review state atomically so the server can resume it after restart;
- provides a session library to reopen, rename, archive, and delete saved tours;
- follows the system light or dark appearance by default, with a persistent manual override;
- checks for new releases without interrupting the review and shows an animated, one-click update control only when one is available;
- renders very large diffs one file at a time in bounded 1,000-row chunks;
- searches changed paths and code, filters by file or review status, and switches between a flat Git-style changed-path list and the full repository tree;
- starts with a dense split diff by default, also supports unified diffs, expands hunk context on demand, and persists per-file reviewed state;
- opens GitHub pull requests in isolated worktrees, shows their collapsible description above the diff plus metadata, checks, commits, and review threads, and publishes an explicitly confirmed review;
- exposes `Close` and `Send feedback & close` outcomes.

All standalone agent sessions are read-only. In attached mode, the triggering agent—or its local fallback after a lost heartbeat—may edit only when the reviewer explicitly requests a concrete change. Those edits are prepared in an isolated proposal worktree: the reviewed working tree remains untouched until the reviewer presses `Apply`.

## Attached-agent mode

An agent can launch the page and remain its conversation backend:

```sh
code-review-tour --attached --start-tour --open --repo /path/to/repository
```

If the change produced screenshots worth reviewing, add the repeatable
`--screenshot` option. The files are copied into the persisted session and a
Screenshots tab appears only when at least one image was supplied:

```bash
code-review-tour --attached --start-tour --open --repo /path/to/repository \
  --screenshot /tmp/android-home.png \
  --screenshot /tmp/ios-home.png
```

PNG, JPEG, GIF, and WebP are supported. Imported screenshots never modify the
reviewed repository and survive session resume.

Agents may optionally identify their current model and effort so the page starts
with matching attached-session metadata:

```sh
code-review-tour --attached --start-tour --open --repo /path/to/repository \
  --caller-model gpt-5.6-codex \
  --caller-reasoning high
```

Both caller flags are optional and independent. They label the triggering
session; they do not start or switch to another model. If omitted, the picker
continues to show `Current agent session` and the CLI default effort.

Finding generation can be disabled for a session without adding configuration
to the reviewed repository:

```sh
code-review-tour --attached --start-tour --open --no-findings \
  --repo /path/to/repository
```

Without `--no-findings`, findings remain enabled by default. The flag is a
session-only override and does not create or modify `.code-review-tour.json`.

`--start-tour` completes the outline and first explanation before the single
user-facing page opens, so an agent-triggered launch appears ready at stop one
and never needs to drive a second browser or press the setup button. In this
mode, `--attached --open` implies `--start-tour`; omitting the explicit flag
cannot open an empty tour. A preparation failure leaves the server available
for diagnosis but does not open the browser.
In this mode, tour planning, step explanations, and reviewer questions are sent
to the triggering agent through an authenticated loopback event bridge. Future
stops are prepared concurrently within the configured prepare-ahead window (five by default), and
a reviewer question is issued immediately without waiting for that background
work. Attached-agent skills coordinate independent workers when the host supports
them; every response is committed against its own bridge event. Browser and
bridge capability tokens are separate, browser mutations require same-origin
requests, and the bridge token is passed through an owner-only temporary file.
Closing with feedback emits the collected line comments back to that same agent. The
bundled skill at `skills/code-review-tour` contains the complete polling and
response workflow; Codex, Claude, Gemini, and Copilot adapters remain available as standalone
fallbacks in the picker.

Feedback events also carry the exact Git tree that was reviewed. Workflows that
apply the comments and immediately tour again pass that tree back through
`--base`, which scopes the follow-up tour to the feedback-induced changes instead
of showing the original diff a second time. `--base` therefore accepts a branch,
commit, or captured Git tree without writing review metadata into the repository.

## Install

Release archives contain self-contained macOS, Linux, and Windows executables
for Intel and ARM processors. Bun is not required after installation. Because
the repository is private, authenticate GitHub CLI once with `gh auth login`.
After that, installation on macOS, Linux, or WSL is one command:

```sh
gh api -H "Accept: application/vnd.github.raw+json" repos/rcosteira79/code-review-tour/contents/scripts/install.sh | bash
```

On Windows, run the equivalent command in PowerShell:

```powershell
& ([scriptblock]::Create((gh api -H "Accept: application/vnd.github.raw+json" repos/rcosteira79/code-review-tour/contents/scripts/install.ps1 | Out-String)))
```

Then verify the installation with `code-review-tour doctor`. Both commands use
your existing GitHub CLI authentication; no token is printed or embedded in
shell history. Cloning the repository and running `./scripts/install.sh` or
`.\scripts\install.ps1` remains supported for contributors who want to inspect
the installer first.

The installer verifies the release checksum, installs the self-contained command under
`${XDG_BIN_HOME:-~/.local/bin}`, and links the bundled skill into
`${CODEX_HOME:-~/.codex}/skills`, `~/.claude/skills`, `~/.gemini/skills`, and
`${COPILOT_HOME:-~/.copilot}/skills`. Re-run it to update to
the latest release. Override those locations with
`CODE_REVIEW_TOUR_BIN_ROOT`, `CODE_REVIEW_TOUR_INSTALL_ROOT`,
`CODE_REVIEW_TOUR_CODEX_SKILL_ROOT`, `CODE_REVIEW_TOUR_CLAUDE_SKILL_ROOT`,
`CODE_REVIEW_TOUR_GEMINI_SKILL_ROOT`, and
`CODE_REVIEW_TOUR_COPILOT_SKILL_ROOT`.

If an agent already has a real `code-review-tour` skill directory, the
installer preserves it and exits with instructions instead of overwriting user
files. Existing installer-managed symlinks are updated automatically.

For a binary-only installation that leaves every agent skill untouched, pass
`--minimal` (or `--binary-only`):

```sh
gh api -H "Accept: application/vnd.github.raw+json" repos/rcosteira79/code-review-tour/contents/scripts/install.sh | bash -s -- --minimal
```

The PowerShell installer accepts the equivalent `-Minimal` or `-BinaryOnly`
switch. It installs a small version-selecting command under
`%LOCALAPPDATA%\code-review-tour\bin`,
adds that directory to the user `PATH`, and uses explicitly marked skill copies
because Windows symlinks can require elevated privileges.

Installed releases manage their own lifecycle:

```sh
code-review-tour update
code-review-tour update --version v1.0.0
code-review-tour rollback
code-review-tour rollback --to 0.8.0
code-review-tour uninstall --dry-run
code-review-tour uninstall --yes
code-review-tour uninstall --yes --purge
```

Rollback only selects versions already present in the managed install root.
Updates preserve a minimal installation unless `--no-minimal` is explicit.
Uninstall preserves review sessions unless `--purge` is explicit, and it never
removes an unmarked skill directory or an unrelated command.

Pin a particular release by setting the version for the installer process:

```sh
gh api -H "Accept: application/vnd.github.raw+json" repos/rcosteira79/code-review-tour/contents/scripts/install.sh | CODE_REVIEW_TOUR_VERSION=v1.0.0 bash
```

Once the repository is public, this bootstrap can switch from authenticated
`gh api` to a conventional unauthenticated `curl` command.

## Run

An installed release requires Git and, for standalone mode, at least one
authenticated Codex, Claude Code, Gemini, or GitHub Copilot CLI. Attached mode
does not require a standalone agent CLI. For development from a checkout, Bun
is also required.

```sh
bun install
bun run start -- --repo /path/to/repository --base origin/main
```

For a development-only command installation, run `bun install --global .` from this checkout.
This provides `code-review-tour` in Bun's global binary directory (`bun pm bin
-g`); ensure that directory is on `PATH`. Attached-agent protocol operations
use the internal `code-review-tour bridge` subcommand.
Install or symlink `skills/code-review-tour` into the agent's skill directory
to make requests such as “start a code review tour” trigger the attached flow
automatically.

The server binds to `127.0.0.1` on a random port and prints the review URL.
Codex models and reasoning levels are loaded from the installed App Server's live
`model/list` catalog. Claude Code has no model-list command, so its adapter uses
the authenticated CLI default model and exposes the installed command's effort
levels. Gemini exposes its documented `auto`, `pro`, `flash`, and `flash-lite`
routing aliases. Copilot models are read from the installed CLI's help catalog,
with `auto` as a safe fallback. Optional picker defaults can be supplied with
`--agent codex|claude|gemini|copilot`,
`--model MODEL`, and `--reasoning EFFORT`.
See the [standalone adapter contract](docs/agent-adapters.md) for discovery,
read-only execution, continuation, and output requirements.

The server prints an owner-only session-state path. Resume it after a restart:

```sh
code-review-tour --resume "/path/printed/by/the/server.json" --open
```

## Reusable test fixture

Development builds include a deterministic persisted tour outline with its first stop ready:

```bash
bun run fixture --open
```

Every run recreates the owned disposable Git repository and canonical session
under the system temporary directory. Stops after the first deliberately start
without explanations, so the configured prepare-ahead window and agent progress
UI can be tested without inheriting work from an earlier run. Preparing those
later stops invokes the selected local agent and may use tokens.

The fixture contains two phases, four stops, inline feedback, findings, a
component diagram, a sequence diagram, chat history, and an agent activity
entry. Sending a new chat message still invokes the installed Codex default
model. Use `bun run fixture --prepare-only` when a test only needs fresh
repository and session files.

To review a GitHub pull request without checking out its branch, authenticate
GitHub CLI and launch it from a matching repository checkout:

```sh
gh auth login
code-review-tour pr 106 --repo /path/to/repository --open
code-review-tour pr https://github.com/OWNER/REPOSITORY/pull/106 --repo /path/to/repository --attached --start-tour --open
```

The source checkout stays on its current branch. Code Review Tour fetches the
pull request into a persistent isolated worktree, compares the exact base and
head commits reported by GitHub, and retains that workspace for session resume.
The Pull request tab shows metadata, checks, commits, and the first 100 existing
review threads. Each local line comment can be included in or excluded from the
GitHub review. Approving or requesting changes shows a final confirmation bound
to the current head SHA; the server rechecks that SHA before publishing. A
durable hidden marker makes a retry reuse the remote review instead of submitting
a duplicate if the first response was interrupted. Remote updates apply only to
a clean isolated worktree and stale local annotations are marked outdated.

Saved tours can also be managed without handling state-file paths. Open the
`Sessions` dialog in the browser, or use a session's displayed short ID:

```sh
code-review-tour sessions
code-review-tour sessions --all
code-review-tour sessions resume 169dedd6 --open
code-review-tour sessions rename 169dedd6 "Push notification review"
code-review-tour sessions archive 169dedd6
code-review-tour sessions unarchive 169dedd6
code-review-tour sessions delete 169dedd6 --yes
code-review-tour sessions prune --repo . --days 30 --max 50
code-review-tour sessions prune --repo . --days 30 --max 50 --yes
```

The `Activity` tab groups repository changes by attached-agent request. It shows
the affected files, before/after diff totals, and the verification reported by
the agent. Select a file to preview the proposed patch, then explicitly `Apply`
or `Reject` it. Applied bundles can be undone while their captured context
still matches; overlapping later edits stop the operation instead of being
overwritten. Text, binary, added, deleted, and renamed files are retained in the
bundle. A review cannot be accepted or closed with feedback while proposals are
pending. Manual and background refreshes outside an active attached request are
not attributed to the agent.

Reviewers can also select `Edit` on a new-side diff line and type a replacement
directly below the code. The edit becomes an isolated reviewer suggestion in
the same Activity timeline; it never touches the reviewed tree until `Apply` is
selected, and it can be rejected or conflict-safe undone like an agent proposal.
Line comments are composed and edited inline as well, with an in-page deletion
confirmation instead of a browser dialog.

New state files live under `${XDG_STATE_HOME:-~/.local/state}/code-review-tour/sessions` and are written atomically. A standalone server exits after the browser closes the review. An attached server waits until the triggering agent acknowledges that it handled the terminal outcome.

## Navigating the diff

The left panel searches both changed paths and changed code. Combine it with
file-status and reviewed/unreviewed filters. `Changed paths` shows a flat,
Git-style list of changed files; `Full repository` restores the hierarchical
tree and unchanged source navigation. The diff toolbar switches between dense
side-by-side and unified layouts. Each hunk can progressively load more surrounding
context without making the initial session snapshot unbounded. Marking a file
reviewed is stored with the session and survives server and browser restarts.

Base resolution order when `--base` is omitted:

1. `branch.<current>.reviewTourBase` from local Git config;
2. `origin/HEAD`;
3. `origin/main`, `origin/master`, `main`, or `master`.

For a stacked branch, set the parent explicitly or configure it:

```sh
git config branch.my-feature.reviewTourBase parent-feature
```

## Repository defaults

Add `.code-review-tour.json` at the repository root to share review defaults:

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

`contextLines` accepts 3–200. `closeOutcome` accepts `accepted` or
`cancelled`; feedback remains an explicit separate action. A resumed session
retains the settings it started with. For a new session, explicit CLI agent,
model, reasoning, and base flags override repository defaults, which in turn
override built-in and Git-inferred defaults. Unknown or mistyped settings fail
closed so a misspelled policy cannot silently be ignored.

`analysis.instructions` accepts at most 32 distinct instructions of up to 2,000
characters each. Finding analysis can be disabled, restricted to at most 32
distinct category names, or filtered to `low`, `medium`, `high`, or `critical`
minimum severity. The server enforces the category and severity policy on agent
output in addition to including it in the planning prompt. Repository
instructions cannot override read-only execution, evidence requirements, or the
tour response contract.

The tour start panel includes a Component diagram, Call flows, Sequence
diagrams, and Findings by default. Turning any of them off skips that analysis
instead of merely hiding its output.
When findings are enabled, broad tour planning produces candidates and a second,
authoritative audit validates their causal chain, removes unsupported guesses,
and searches high-impact boundaries for omissions. A malformed audit fails the
tour rather than presenting unvalidated findings.

The Call flows tab starts with a left-to-right component diagram modeled after ACE's
implementation-plan architecture view. It uses plain-language component names,
labels every relationship, and distinguishes new, touched, removed, and
external components. A Dependency changes list makes added, removed, or reversed
relationships explicit. Below it, each changed entrypoint expands into a
caller-to-callee tree. `Changes`, `Before`, and `After` make rewired calls easy
to compare, while call-site links return to the exact old or new diff line.
Only added and removed calls with changed-file evidence are accepted; dynamic
dispatch is labelled partly verified or unverified rather than presented as
certain.

The Sequence diagrams tab renders the documented Mermaid sequence subset as
SVG using the locally bundled Mermaid runtime in strict mode; it never loads a CDN. The
validated source stays available in a collapsed disclosure and opens
automatically if rendering fails. Supported syntax includes participants and
actors, standard message and destruction arrows, notes, activation, autonumber,
and `alt`, `loop`, `opt`, `par`, `critical`, `break`, `rect`, and `box` blocks.
Edits are validated and bounded before persistence. Use `Regenerate` on one
sequence diagram or `Regenerate diagrams` to ask the active tour agent to
re-inspect the current diff. Call flows can likewise be regenerated individually
or as a complete set.

Guided reviews are organized as `Tour → Phases → Stops`. A phase represents one
coherent behavioral or architectural change and declares the changed files that
participate in it. A stop is an exact old/new diff anchor with a short inline
annotation and a deeper agent explanation. Previous and Next traverse the
flattened stop route across phase boundaries, while the next explanation is
prepared in advance. While tour mode is active, the file tree and diff show all
and only the changed files declared by the current phase; moving across a phase
boundary swaps that scope. `Exit tour` restores the baseline all-changes review,
and `Resume tour` returns to the current stop. Findings shown below a stop are
limited to that exact anchor, phase findings sit with the phase overview, and
the Findings tab contains the complete set. Sessions created before v0.9 are
migrated into a legacy phase without guessing finding scope.

Use the header's Export control at any point—including after closure—to download
Markdown or a self-contained HTML artifact. Exports contain no scripts, remote
assets, session tokens, or repository filesystem paths.

Retention is always explicit. `sessions prune` previews its targets; add
`--yes` to delete them. `--repo PATH` loads that repository's retention
defaults and limits pruning to its sessions. CLI `--days` and `--max` override
the file. Archived sessions are preserved unless `--include-archived` (or the
matching repository setting) is enabled. `--temp-hours N` also targets stale
tool-owned temporary directories. Active sessions and live proposal/bridge
workspaces are process-locked and cannot be pruned; session files are rechecked
immediately before deletion so concurrent changes fail safely.
An expired pull-request session removes its associated worktree only when the
path is inside the tool-owned state directory and the worktree is clean.

## Verify

```sh
bun run verify
bun run build:release
```

Pushing a `v*` tag runs the full verification suite, builds all six release
archives, publishes checksums, and creates a GitHub Release. The package version
and tag must match.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for shipped scope, upcoming milestones, and the
remaining gaps between the current local tool and a complete review workflow.
