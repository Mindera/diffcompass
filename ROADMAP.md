# Roadmap

The roadmap is organized around usable outcomes rather than speculative dates.
Items move into a release only when their interaction and verification scope are
clear.

## Shipped in v0.1

- Local branch-to-parent comparison, including committed and working-tree changes.
- Repository tree, paged diffs, line comments, P0-P3 findings, and sequence flows.
- Ordered tours with previous/next navigation and live follow-up questions.
- Attached-agent bridge plus standalone Codex and Claude adapters.
- Durable resumable sessions, repository refresh, cancellation, and safe close outcomes.
- Self-contained macOS and Linux releases, checksum verification, diagnostics,
  CI, and automatic Codex and Claude skill installation.

## Shipped in v0.2

- Session library in the browser and CLI: list, reopen by short ID, rename,
  archive, restore, and explicitly delete saved tours.
- Durable agent change activity grouped by the triggering request, including
  affected files, before/after diff totals, and reported verification.
- Compatibility migration for early v0.1 session files that predate findings
  and flow metadata.
- System-aware light and dark themes with a persistent per-browser override.

## Daily review backlog

- Retention controls for old sessions and temporary data.

## In progress for v0.5

- Strict repository-level defaults for parent branch, preferred agent/model,
  diff layout and context, changed-file navigation, and successful-close policy.

## Shipped in v0.3

- Attached-agent edits run in an isolated proposal worktree, leaving the reviewed
  working tree unchanged until explicit approval.
- Activity patch previews plus Apply, Reject, and conflict-safe Undo controls for
  text, binary, added, deleted, and renamed files.
- Pending proposals block successful review closure, and later overlapping edits
  fail closed instead of being overwritten.

## Shipped in v0.4

- Search across changed paths and code plus file-status and reviewed-state filters.
- Changed-files-only repository navigation and persistent per-file reviewed state.
- Progressive hunk context expansion with bounded responses.
- Unified and side-by-side diff layouts with comments, findings, and tour anchors
  preserved on both sides.

## v0.6 — Pull request workflow

- Open a tour from a GitHub pull request URL or number without manually preparing
  the checkout and base reference.
- Display pull request metadata, commits, existing review threads, and checks.
- Publish selected comments and final review outcomes back to GitHub only after
  explicit confirmation.
- Track remote updates and reconcile comments when the pull request changes.

## v0.7 — Extensibility and richer analysis

- A documented adapter contract for additional local agents such as Gemini,
  Aider, and OpenCode.
- Repository-specific finding policies and review instructions.
- Regenerate and edit flow diagrams, with broader Mermaid sequence syntax.
- Export a completed tour as a durable Markdown or HTML review artifact.

## Release hardening

- Native CI execution on macOS and ARM runners, not only cross-compilation.
- Windows packaging and installer support.
- Signed and notarized macOS binaries.
- A public installation path such as Homebrew once repository visibility and
  licensing are decided.
- Versioned upgrade, rollback, and uninstall commands.

## Explicitly out of scope for now

- Hosting repositories or source code on a remote Code Review Tour service.
- Multi-user review rooms and real-time reviewer collaboration.
- Autonomous code changes that were not explicitly requested by the reviewer.
