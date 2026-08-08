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

## v0.2 — Daily review workflow

- Session library: list, reopen, rename, archive, and delete tours without copying
  state-file paths.
- Retention controls for old sessions and temporary data.
- Agent change activity: show files changed after a request, the triggering
  conversation turn, verification results, and before/after state.
- Explicit apply, reject, and undo controls for agent-authored changes.
- Diff search and filters, changed-files-only mode, context expansion, unified or
  split view, and per-file reviewed state.
- Repository-level defaults for parent branch, preferred agent/model, and review
  behavior.

## v0.3 — Pull request workflow

- Open a tour from a GitHub pull request URL or number without manually preparing
  the checkout and base reference.
- Display pull request metadata, commits, existing review threads, and checks.
- Publish selected comments and final review outcomes back to GitHub only after
  explicit confirmation.
- Track remote updates and reconcile comments when the pull request changes.

## v0.4 — Extensibility and richer analysis

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
