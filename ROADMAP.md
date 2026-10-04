# Roadmap

This is the canonical delivery roadmap, audited on 2026-10-04. The
[README](README.md#capabilities) describes entry points and behavior;
[RESEARCH](RESEARCH.md) records implementation evidence, verification and limits;
[release history](docs/roadmap-history.md) preserves earlier milestones.

Status terms distinguish **released**, **local review branch**, **unreviewed
base**, **in progress**, **prototype**, and **research-only**. Code or a passing
test alone does not prove UI reachability, browser usability, merge approval or
release delivery. Work is isolated into independent branches; start with
[Review branches](REVIEW_BRANCHES.md). Historical uncommitted states and all
assumptions remain preserved in RESEARCH.

## Released baseline

The latest published release is
[v2.0.0](https://github.com/rcosteira79/diffcompass/releases/tag/v2.0.0), published
2026-09-29. Authenticated GitHub metadata checked on 2026-10-04 reports a normal
release with six platform archives and checksums. Its annotated tag peels to
`ec3c045`, also the freshly queried remote `main` commit. The installed command
reports `2.0.0`; binaries were not replaced or exhaustively retested here.

| Feature already delivered by v2.0.0 | Reachable scope and boundary |
| --- | --- |
| Structural blast radius | Maps → Explore impact: per-symbol callers/references, files, test evidence, source/return navigation, provider/confidence/completeness and bounded counts. Static relationships are not runtime impact. |
| Dry runs | Dry runs tab and linked Simulate actions: editable scenarios, on-demand preparation/cancellation, independent steps, persisted traces and offline export. These are simulations, not application execution. See the [specification](docs/dry-run-walkthrough-spec.md). |
| Archify maps | Maps → Understand the change: bundled local validated interactive architecture/sequence and supported data/lifecycle maps, inspection/routes, evidenced Before/Delta/After and last-good artifacts. Mermaid remains the fallback. |
| Native call flows | Changes/Before/After, branches, recursion and source evidence already exist. v2.0.0 routes converted simple flows to Workflow maps, leaving only unconverted flows in the native category; the local consolidation below fixes that exposure. |

## Unreleased work under separate review

| State | Change | Remaining qualification |
| --- | --- | --- |
| Locally committed | `716edb8`: sequence semantics-card source navigation, definition candidates and return/camera restoration. | Not on remote main or in v2.0.0. Definition name matches use available workspace source; they are not historical call evidence. |
| Unreviewed base `8262d97` | One native Call flows view for all saved flows; stop generating Archify workflow duplicates and hide old duplicates in UI/exports without deleting saved data. | Retains native modes, source links, regeneration and linked dry runs; no replacement call-flow model. |
| Unreviewed base `8262d97` | Shared interactive-map theme/preset/motion preferences and tooltip cleanup. | Browser storage is origin-local. Map-motion-on lacks the optional-guidedViews guard currently in sequence/code; review/extract that guard before considering this baseline without sequence. Passing unit tests do not establish browser safety. |
| Unreviewed base `8262d97` | Bounded impact repair retains valid results and displays/persists diagnostics. | Overall repair warnings/omission reasons are not yet included in exports. Missing results are not zero impact. |
| Unreviewed base `8262d97` | Codex final-output handling separates finished explanations from progress commentary. | Tested transport behavior is not a new guarantee for every external agent version. |
| `review/decision-log` | Reviewer-curated Decision log inside Conversations, citing existing messages/comments/findings/activity; correction, persistence and Markdown/HTML export. | Final peer report: 161 focused tests and 18 Chrome checks passed; the 35-test approved socket-suite rerun remains separate from the historical 636-pass/24-failure run and later integrated verification below. “Recorded” remains a reviewer assertion, not proven intent. |
| `review/sequence-code` | Code steps beside supported Archify sequences, captured excerpts, existing source/return routes and offline HTML walkthrough. | Final 160 tests/1,824 assertions, 8 main browser groups and 4 fresh framing scenarios passed; corrected visuals accepted. All 18 assumptions recorded, including readable 133.333% initial scale, actual-map-width stacking below 1040px and explicit Fit/no auto-refit. Pointer matrices remain app 15/16 and plain iframe 14/16 with unknown cause. Native Mermaid fallback, export limits and touch/assistive/background gaps remain. |
| `review/syntax-diff` | Accepted scoped Syntax changes for TS/TSX and Kotlin, captured-tree old/new anchors, existing source navigation and explicit text-diff fallback. | All 30 assumptions, files and exact peer commands are recorded in RESEARCH. Peer focused/overlap, 11 Chrome checks and compiled smoke passed; coordinator independently passed the 20-test/194-assertion set. On-demand cache and requested-result exports only. Older Kotlin grammar limits remain; no cross-platform or release claim. |
| `review/research-docs` | Documentation alignment across README, ROADMAP, product-roadmap and RESEARCH. | Final peer handoffs, integrated verification and all assumptions reconciled with attribution; unresolved pointer/visibility and export gaps retained. No release claim. |

The three feature branches share only `8262d97` as their common base; they do
not depend on one another. Documentation and the prototype are separate. The
base itself remains unreviewed. The preceding feature check counts describe
the preserved combined-tree evidence; fresh extracted-branch outcomes are
recorded separately below and in RESEARCH.
No push, merge, release or DiffCompass installation is part of this work.

**Historical combined-tree verification:** coordinator `bun run verify` exited 0: typecheck, **668 tests / 0 failures /
5,216 assertions across 76 files**, then JavaScript syntax checks passed. A prior
666-pass/1-failure run exposed a brittle bundle-source assertion; the coordinator
changed only two test files, then passed a 28-test targeted rerun and the fresh
full run. This automated pass does not resolve the sequence app 15/16 and plain
iframe 14/16 pointer matrices, validate extraction, or approve merging the
safety snapshot `39206b4`. The full evidence sequence is retained in RESEARCH.
Coordinator-reported independent baseline verification passed 581 tests; the
prototype branch passed 618; decision log `d5b8bd3` passed 597 plus 18 Chrome
checks and was accepted for extraction only. Prototype `2676dea` has 31 exact
snapshot files but its fresh browser run failed the badges keyboard check;
focused/settled retries passed without establishing cause or a fix. This remains
a review blocker. Sequence `0d22cbe` independently passed 594 tests, 8 browser
groups and 4 framing scenarios; the original setup timeout with an undiagnosed
null-`outline` page error and app 15/16 / plain 14/16 pointer gaps remain. Syntax `886e173` independently passed 602 tests,
11 Chrome checks and host compiled smoke. No branch result approves a merge;
see the current ledger and complete isolated handoff assumptions in RESEARCH.
The coordinator confirmed 69 snapshot-identical single-owner files and no
missing/extra non-doc paths; shared app/export/server/session edits still need
integration review, without a conflict-free merge promise.

## In progress

| Workstream | Extension of existing features | Status boundary |
| --- | --- | --- |
| Skill extraction | Evidence-backed reusable lessons during feedback handoff, extending suitable existing skills rather than turning every comment into a rule. | Separate agent/workstream; not audited or completed by this research delegation. |

## Prototypes and research

- **Isolated prototypes:** the Monaco comparison lab and language-support probe
  live in `review/diff-viewer-prototype`, at `prototypes/diff-viewer/README.md`
  and `prototypes/language-support/README.md`; see [branch locations](REVIEW_BRANCHES.md).
  Neither is a production viewer migration or a bundled language provider.
- **Approved direction, incomplete delivery:** a curated shared provider layer
  with TypeScript/Kotlin defaults, native inline Peek and keyboard-accessible
  code-context-menu actions. This is review assistance, not compiler-grade IDE
  support. Historical source identity and project-import trust remain constraints.
- **Viewer gate still open:** unified deleted-line actions, hidden-annotation
  indicators, full review workflow parity, version-aware refresh/navigation,
  exports, accessibility and performance. Scope-folding arrows were explicitly
  dropped; local unchanged-context expansion/re-collapse remains required.
- **Research-only alternatives:** React Flow, CodeMirror and provider candidates
  may be evaluated where useful; no new dependency or replacement is promised.
- **Unsupported claims:** static maps and dry runs are not execution traces;
  syntax/hover does not establish project-aware IntelliSense; the Kotlin probe
  does not establish real Android/KMP or compiler correctness.

## Delivered product refinements

The initial seven workstreams are available in v1.1.25. This records the shipped
scope, rather than treating every aspiration in the original proposals as done.

| Workstream | Delivered scope |
| --- | --- |
| Revision-aware re-review | Source checkpoints, revision history, Full change / Since last review, and review-state reconciliation. |
| Needs your attention | Configurable evidence briefing, review cues, effort estimate, and expandable diagrams. |
| Finding lifecycle | Explicit dispositions, reviewer notes, structured evidence, and reassessment after refresh. |
| Symbol Peek | Definitions/usages, navigation trail, and bounded provider discovery with repository-search fallback. |
| Navigation and scoped discussion | Keyboard shortcuts, focus mode, and line/range/stop/review conversations. |
| Adaptive diagrams | Evidence-gated state-machine and data-model views. |
| Issue assessment | Explicit acceptance criteria from one trusted closing issue or a local task, with cited implementation evidence. |

Fetching related issues and older PRs remains outside the current issue-assessment
scope. Revisit it only with an explicit product decision about provider access
and privacy.

## Release hardening backlog

| Item | Remaining work |
| --- | --- |
| Native platform CI | Execute verification on macOS and ARM runners, beyond the current Ubuntu/Windows jobs and cross-compilation. |
| macOS distribution | Sign and notarize binaries. |
| Public installation | Decide repository visibility and licensing, then add a public channel such as Homebrew. |

Binary-only installation, Windows packages and native Windows CI, versioned
updates, rollback, and preview-first uninstall are already shipped.

## Out of scope

- Hosting repositories or source code on a remote DiffCompass service.
- Multi-user review rooms and real-time reviewer collaboration.
- Autonomous code changes that the reviewer did not request.
