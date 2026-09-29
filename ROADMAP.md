# Roadmap

This is the canonical roadmap. The [README](README.md#capabilities) documents
current capabilities; [release history](docs/roadmap-history.md) preserves the
earlier milestone record. In progress means implementation has started on an
isolated branch, not that the feature has shipped.

## In progress

| Feature | Branch | Outcome |
| --- | --- | --- |
| Structural blast radius | `feat/structural-blast-radius` | Inspect callers, structural reach, affected files, and test gaps per changed symbol. |
| Dry run | `feat/review-dry-run` | Step through reviewed code with editable sample inputs, simulated values, and independent navigation. |
| Skill extraction | `feat/skill-extraction` | Turn reusable review lessons into appropriate skill improvements during feedback handoff. |
| Archify integration | `feat/archify-integration` | Optional validated interactive diagrams, with the local Mermaid renderer retained. |

### Structural blast radius

Add a per-changed-symbol view of what the change can structurally reach: direct callers, transitive impacted nodes, affected files, and nearby test gaps. Follow the `mobile-code-review` model by recording the structural provider, confidence, and provenance with every result; pin findings to changed or impacted symbols and use broad, untested reach as a review-prioritization signal.

Keep the claim precise: graph reach is an authored or statically discovered dependency path, not proof of runtime impact. Show both the bounded graph rendered in the UI and the larger reported radius when the provider truncates visible nodes. Let reviewers select a changed symbol and inspect its isolated subgraph rather than collapsing same-named symbols into one node.

### Dry run

Provide a dedicated Dry runs tab for agent-simulated execution of the reviewed code. Share flow identities with call flows and sequence diagrams, suggest relevant scenarios, and let reviewers customize sample inputs and mocked responses. Show active code, value changes, branch decisions, and outputs with navigation independent of the tour.

Enabled by default, with an option to skip generation entirely. Prepare detailed walkthroughs on demand, persist them for resume and offline exports, and invalidate them when inputs or source change. Archify may provide a synchronized visual map; actual code execution is outside this feature's scope. See the [agreed implementation specification](docs/dry-run-walkthrough-spec.md).

### Archify integration

Support [Archify](https://github.com/tt-a1i/archify) as an optional diagram renderer for architecture, workflow, sequence, data-flow, and lifecycle views. Generate typed JSON IR from the same bounded repository evidence used by the tour, run Archify validation before displaying an artifact, and preserve the last valid diagram when a generated revision fails validation.

Embed the resulting self-contained interactive HTML in the briefing and exported review where practical, including search, authored upstream/downstream reach, exact routes, and Before / Delta / After architecture views. Keep DiffCompass's current validated Mermaid path as the built-in fallback; integration must not require network access or imply runtime impact from authored topology.

### Skill extraction

Add a feedback-handoff step that asks the receiving agent to assess whether reviewer comments, clarifications, requested changes, or corrected assumptions reveal a reusable lesson. When they do, the agent should propose or apply the lesson to the most relevant existing skill—or create a narrowly scoped skill when no suitable one exists—so the same class of mistake is less likely to recur.

Implement this by extending the DiffCompass skill or introducing a companion feedback-processing skill. Extraction should require evidence from the completed review, distinguish general guidance from repository-specific convention and one-off preference, avoid duplicating existing instructions, and report what was extracted and where. Do not turn every comment into a rule or silently modify unrelated skills.

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
