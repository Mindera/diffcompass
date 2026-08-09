# Code Review Tour

A local, agent-led walkthrough for Git changes. The browser keeps the repository tree, full diff, ordered tour, review comments, and a resumable agent conversation in one place.

![Code Review Tour diff with repository tree and agent setup](docs/images/overview.jpg)

The selected agent plans an ordered route through the change, anchors every stop
to the relevant code, and stays available for follow-up questions.

![Guided review with an anchored diff and live agent explanation](docs/images/guided-tour.jpg)

## Features

- compares the merge base of a parent branch with the current working tree;
- includes committed, staged, unstaged, and untracked changes;
- renders the complete repository tree, unchanged source files, and the branch diff;
- detects installed Codex and Claude Code CLIs;
- lets the reviewer choose an available agent, model, and reasoning effort;
- asks the selected agent to create a logically ordered tour;
- generates each explanation as the reviewer moves forward;
- keeps follow-up questions in the same agent conversation;
- anchors tour stops, editable review comments, and evidence-backed P0–P3 findings to diff lines;
- generates provenance-labelled sequence views for goal-critical, high-blast flows;
- refreshes when repository files change and marks stale annotations as outdated;
- records agent-authored file changes, their triggering request, and verification in an Activity timeline;
- prepares attached-agent edits in isolated worktrees with explicit Apply, Reject, and conflict-safe Undo controls;
- persists review state atomically so the server can resume it after restart;
- provides a session library to reopen, rename, archive, and delete saved tours;
- follows the system light or dark appearance by default, with a persistent manual override;
- renders very large diffs one file at a time in bounded 1,000-row chunks;
- searches changed paths and code, filters by file or review status, and can hide unchanged repository files;
- switches between unified and split diffs, expands hunk context on demand, and persists per-file reviewed state;
- opens GitHub pull requests in isolated worktrees, shows their metadata, checks, commits, and review threads, and publishes an explicitly confirmed review;
- exposes `Close` and `Send feedback & close` outcomes.

Standalone Codex and Claude sessions are read-only. In attached mode, the triggering agent may edit only when the reviewer explicitly requests a concrete change. Those edits are prepared in an isolated proposal worktree: the reviewed working tree remains untouched until the reviewer presses `Apply`.

## Attached-agent mode

An agent can launch the page and remain its conversation backend:

```sh
code-review-tour --attached --open --repo /path/to/repository
```

In this mode, tour planning, step explanations, and reviewer questions are sent
to the triggering agent through an authenticated loopback event bridge. Browser
and bridge capability tokens are separate, browser mutations require same-origin
requests, and the bridge token is passed through an owner-only temporary file.
Closing with feedback emits the collected line comments back to that same agent. The
bundled skill at `skills/code-review-tour` contains the complete polling and
response workflow; Codex and Claude adapters remain available as standalone
fallbacks in the picker.

## Install

Release archives contain self-contained macOS and Linux executables for Intel
and Apple/ARM processors. Bun is not required after installation. While this
repository is private, collaborators should authenticate GitHub CLI, clone the
repository, and run the installer:

```sh
gh auth login
gh repo clone rcosteira79/code-review-tour
cd code-review-tour
./scripts/install.sh
code-review-tour doctor
```

The installer verifies the release checksum, installs commands under
`${XDG_BIN_HOME:-~/.local/bin}`, and links the bundled skill into both
`${CODEX_HOME:-~/.codex}/skills` and `~/.claude/skills`. Re-run it to update to
the latest release. Override those locations with
`CODE_REVIEW_TOUR_BIN_ROOT`, `CODE_REVIEW_TOUR_INSTALL_ROOT`,
`CODE_REVIEW_TOUR_CODEX_SKILL_ROOT`, and
`CODE_REVIEW_TOUR_CLAUDE_SKILL_ROOT`.

If either agent already has a real `code-review-tour` skill directory, the
installer preserves it and exits with instructions instead of overwriting user
files. Existing installer-managed symlinks are updated automatically.

Once the repository is public, a versioned installation needs only the checked
out installer and `CODE_REVIEW_TOUR_VERSION=vX.Y.Z ./scripts/install.sh`; GitHub
CLI is not required in that case.

## Run

An installed release requires Git and, for standalone mode, at least one
authenticated Codex or Claude Code CLI. Attached mode does not require a
standalone agent CLI. For development from a checkout, Bun is also required.

```sh
bun install
bun run start -- --repo /path/to/repository --base origin/main
```

For a development-only command installation, run `bun install --global .` from this checkout.
This provides `code-review-tour` and `code-review-tour-bridge` in Bun's global
binary directory (`bun pm bin -g`); ensure that directory is on `PATH`.
Install or symlink `skills/code-review-tour` into the agent's skill directory
to make requests such as “start a code review tour” trigger the attached flow
automatically.

The server binds to `127.0.0.1` on a random port and prints the review URL.
Codex models and reasoning levels are loaded from the installed App Server's live
`model/list` catalog. Claude Code has no model-list command, so its adapter uses
the authenticated CLI default model and exposes the installed command's effort
levels. Optional picker defaults can be supplied with `--agent codex|claude`,
`--model MODEL`, and `--reasoning EFFORT`.

The server prints an owner-only session-state path. Resume it after a restart:

```sh
code-review-tour --resume "/path/printed/by/the/server.json" --open
```

To review a GitHub pull request without checking out its branch, authenticate
GitHub CLI and launch it from a matching repository checkout:

```sh
gh auth login
code-review-tour pr 106 --repo /path/to/repository --open
code-review-tour pr https://github.com/OWNER/REPOSITORY/pull/106 --repo /path/to/repository --attached --open
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

New state files live under `${XDG_STATE_HOME:-~/.local/state}/code-review-tour/sessions` and are written atomically. A standalone server exits after the browser closes the review. An attached server waits until the triggering agent acknowledges that it handled the terminal outcome.

## Navigating the diff

The left panel searches both changed paths and changed code. Combine it with
file-status and reviewed/unreviewed filters, or enable `Changed files only` to
hide the unchanged repository tree. The diff toolbar switches between unified
and side-by-side layouts. Each hunk can progressively load more surrounding
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

Pushing a `v*` tag runs the full verification suite, builds all four release
archives, publishes checksums, and creates a GitHub Release. The package version
and tag must match.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for shipped scope, upcoming milestones, and the
remaining gaps between the current local tool and a complete review workflow.
