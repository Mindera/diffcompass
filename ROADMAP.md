# Roadmap

This is the canonical delivery roadmap, refreshed on **2026-10-07**. The
[README](README.md#capabilities) describes entry points, [Review branches](REVIEW_BRANCHES.md)
identifies current review targets, and [RESEARCH](RESEARCH.md) preserves dated
implementation evidence, verification and every recorded assumption.
[Release history](docs/roadmap-history.md) retains earlier milestones.

States distinguish **released**, **merged but unreleased**, **unmerged review
branch**, **prototype** and **research-only**. A passing test or merge does not
establish release delivery or coverage beyond the reported checks.

## Released baseline

The latest published release is
[v2.0.0](https://github.com/rcosteira79/diffcompass/releases/tag/v2.0.0), published
2026-09-29 at peeled tag commit `ec3c045`. Authenticated release metadata was
checked on 2026-10-07. Freshly fetched `origin/main` is `e19cd7e`, ahead of that
release. The installed command was last observed as 2.0.0 on 2026-10-04; it was
not queried, updated or installed during this documentation refresh.

| Feature already delivered by v2.0.0 | Reachable scope and boundary |
| --- | --- |
| Structural blast radius | Maps → Explore impact: per-symbol callers/references, files, test evidence, source/return navigation, provider/confidence/completeness and bounded counts. Static relationships are not runtime impact. |
| Dry runs | Dry runs tab and linked Simulate actions: editable scenarios, on-demand preparation/cancellation, independent steps, persisted traces and offline export. These are simulations, not application execution. See the [specification](docs/dry-run-walkthrough-spec.md). |
| Archify maps | Maps → Understand the change: bundled local validated interactive architecture/sequence and supported data/lifecycle maps, inspection/routes, evidenced Before/Delta/After and last-good artifacts. Mermaid remains the fallback. |
| Native call flows | Changes/Before/After, branches, recursion and source evidence already exist. v2.0.0 routes converted simple flows to Workflow maps, leaving only unconverted flows in the native category; the merged consolidation below fixes that exposure. |

## Merged on main, not yet released

| Change | Delivery evidence | Scope and remaining qualification |
| --- | --- | --- |
| Sequence source navigation and Code steps | [PR #3](https://github.com/rcosteira79/diffcompass/pull/3), merged 2026-10-05 as `73f9247`; includes `716edb8`, `0d22cbe` and `cc6f99b`. | Resizable/collapsible pane, eager saved excerpts, grouped anchors, source-side markers, sequential live definition candidates, exact Paths selection and source return. Scrolling now preserves selection. Offline lookup remains unavailable. |
| Native Call flows and earlier fixes | `8262d97` is included in PR #3. | Native Call-flow consolidation, browser-origin map preferences/tooltips/motion, bounded impact repair and final-commentary filtering are merged. The optional-guidedViews guard is present on main; the old isolated-base guard warning is historical. Overall impact warnings/omission reasons still lack export parity. |
| Lifecycle layout and map source return | [PR #4](https://github.com/rcosteira79/diffcompass/pull/4), merged 2026-10-06 as `e19cd7e`. | Branching/looping lifecycle layout preserves initial/terminal semantics, validates collisions and retains Mermaid fallback. Source return preserves camera/inspection/scroll; visible sections use consecutive numbering. |

The old three-file eager-excerpt follow-up is included in the later merged
sequence work; it is no longer an uncommitted feature. PR #3 reports a 636-test
verify pass plus separate browser/renderer checks. PR #4 reports a 652-test verify
pass plus captured fixture and Chrome checks. These are **PR-reported results**,
not fresh runtime/browser runs by this documentation agent; full details and the
earlier failed runs remain separately attributed in RESEARCH.

The original app 15/16 and plain-iframe 14/16 pointer matrices and setup
null-`outline` error/timeout remain historical evidence. Later work added startup
guards and diagnosed a Chrome test-viewport sizing issue, with native-content
sizing and raw negative controls. Do not promote historical failures to passes
or generalize the later Chrome checks to Safari, Firefox, physical touch,
assistive technology or actual OS background visibility.

## Still on separate review branches

| Review unit | Observed local tip / base | Verification boundary |
| --- | --- | --- |
| Decision log | `review/decision-log`: `e0157cf` / `e19cd7e` | Unmerged reviewer-curated evidence index in Conversations. Original `d5b8bd3` isolated run: 597 tests and 18 Chrome checks passed. Those counts are not a fresh run of this rebased tip; all 17 product assumptions and process clarifications are retained. |
| Syntax diff | `review/syntax-diff`: `cf6b2a6` / `73f9247` | Unmerged bounded TS/TSX/Kotlin summaries, captured-source navigation and requested-cache exports. Original `886e173` isolated run: 602 tests, 11 Chrome checks and host compiled smoke passed. All original 30 plus isolated 32 assumptions remain; current-tip/release/platform validation is separate. |
| Viewer/provider prototype | `review/diff-viewer-prototype`: `72449d6` / `e19cd7e` | Unmerged experiment, no production migration. Original `2676dea` run passed 618 tests but its badges keyboard browser check timed out; diagnostic/retry passes did not establish a clean browser result. No newer browser result was verified here. |
| Documentation | `review/research-docs`, rebased on `e19cd7e` | Documentation-only changes over merged main. Current statuses and historical records are separate; link/consistency/preservation checks do not substitute for runtime verification. |

These branches originally shared `8262d97`; their current bases now differ.
Shared app/export/server/session integration changes still need review when
combining unmerged features. The `39206b4` safety snapshot and earlier combined
668-test pass are historical evidence, not an integration or release candidate.
The old extraction audit remains recorded without asserting current merge safety.

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
