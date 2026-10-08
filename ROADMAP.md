# Roadmap

Canonical delivery state, checked **2026-10-08** against fetched main `607e18b`.
[README](README.md#capabilities) gives entry points,
[the feature guide](docs/feature-showcase.html) illustrates them, and
[RESEARCH](RESEARCH.md#current-delivery-and-verification-2026-10-08) preserves
dated checks, failures and assumptions. [Review branches](REVIEW_BRANCHES.md)
identifies the remaining scope; [release history](docs/roadmap-history.md)
retains earlier milestones.

## Released baseline

Latest release: [v2.0.0](https://github.com/rcosteira79/diffcompass/releases/tag/v2.0.0),
2026-09-29, peeled commit `ec3c045`. Installed version was last observed as 2.0.0
on 2026-10-04, not freshly queried. Tours, text/word diffs, Symbol Peek,
conversations, findings, checkpoints, exports, dry runs, Archify maps and blast
radius are already released. Static maps are not execution traces; dry runs
are simulations.

## Merged on main, not yet released

| Change | Delivery | Scope and boundary |
| --- | --- | --- |
| Sequence Code steps and earlier fixes | [PR #3](https://github.com/rcosteira79/diffcompass/pull/3), `73f9247` | Resizable/collapsible pane, eager saved excerpts, candidate lookup and source return; native Call-flow consolidation, map preferences, optional-guidedViews guard, impact recovery and final-commentary filtering. Overall impact diagnostics still lack export parity. |
| Lifecycle layout and source return | [PR #4](https://github.com/rcosteira79/diffcompass/pull/4), `e19cd7e` | Branching/looping state maps, collision checks and source-return context with Mermaid fallback. |
| Opt-in Monaco and review interactions | [PR #5](https://github.com/rcosteira79/diffcompass/pull/5), `57bf907` | Normal Diff renderer selector, Shiki default. Captured source, lazy editors, inline edit drafts and comments/PR threads reuse the session. This is merged app code, beyond the original isolated prototype. |
| GitHub-native suggestions | [PR #7](https://github.com/rcosteira79/diffcompass/pull/7), `13951a2` | Queue/return saved edits; confirm selected suggestions and head for neutral COMMENT publication. Apply locally remains separate. Exact ranges and durable receipts bound publication/retries. |
| What changed and parser evidence | [PR #6](https://github.com/rcosteira79/diffcompass/pull/6), `ffc7bf4` | Tour-agent explanations plus collapsed TS/TSX/Kotlin details, source links, tour evidence and separately disclosed explanation/parser export coverage. |
| Phase-anchoring regression checks | [PR #8](https://github.com/rcosteira79/diffcompass/pull/8), `af709b1` | Tests for existing same-turn geometry correction during delayed image decoding; no production changes. |
| Monaco What changed and draft recovery | [PR #9](https://github.com/rcosteira79/diffcompass/pull/9), `607e18b` | Same panel in both renderers. New tours require all-file explanation coverage, with at most two repairs; old tours are not backfilled. Refresh/failure retains drafts and old models; stale saves remain blocked. |

Current navigation is **Diagrams → Architecture & design / Blast radius /
Call flows / Sequence diagrams / Data & lifecycle**. v2.0.0 uses Maps.
The per-file **What changed** panel appears in Diff mode outside the guided tour
and proposal previews, in both renderers.

Latest PR #9 reports 962 passing tests, browser/package checks and seven passing
CI checks; it also retains a macOS explorer-height failure reproduced on base.
These are attributed reports, not fresh app tests by the docs agent. Earlier
pointer matrices, badge timeout, socket and navigation failures remain dated
evidence; later successes do not erase them or certify every browser/device.

## Unmerged work

Decision log is absent from main. Last recorded implementation: `e0157cf`
(original extraction `d5b8bd3`); its former branch/worktree is no longer listed
locally. The 597-test/18-Chrome-check handoff and all 17 product assumptions
remain preserved without implying current checkout availability or approval.

`review/research-docs` contains only documentation and the offline feature guide.
The safety snapshot `39206b4` and 668-test combined run are historical, not a
merge/release candidate. Syntax and Monaco are now merged; their old isolated
counts do not validate their later expanded implementations.

## In progress

| Workstream | Extension of existing features | Status boundary |
| --- | --- | --- |
| Skill extraction | Evidence-backed reusable lessons during feedback handoff, extending suitable existing skills rather than turning every comment into a rule. | Separate agent/workstream; not audited or completed by this research delegation. |

## Prototypes and research

- The [viewer lab](prototypes/diff-viewer/README.md) and
  [language-support probe](prototypes/language-support/README.md) are now in main.
  Monaco's optional app renderer is separate from the lab's historical rollout
  state. The language probe remains research, not a bundled project-aware
  Kotlin/Android/KMP provider.
- A curated provider layer remains incomplete. Highlighting, hover and source-only
  fixtures do not establish compiler-grade IDE support.
- Specialized Shiki fallbacks and device/performance limits remain. Scope-fold
  arrows were dropped; inline context controls remain. See
  [Monaco behavior](README.md#monaco-preview) and the attributed evidence.
- React Flow, CodeMirror and further provider candidates remain research-only
  alternatives; no new dependency or replacement is promised by this docs work.

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
