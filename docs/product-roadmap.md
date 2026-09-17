# Product refinement roadmap

This roadmap captures the review-workflow improvements selected after comparing Code Review Tour with CodeRabbit Change Stack, Graphite, Qodo, and GitHub Copilot.

## 1. Revision-aware re-review

Treat a completed review pass as an immutable source checkpoint. Keep source revisions separate from the existing session `revision`, which also changes for comments, navigation, and preparation state.

Offer **Full change**, **Since last review**, and **Revision history** views. On refresh, preserve reviewed state for unchanged files, return changed files to unreviewed, and classify work as new, changed again, resolved, or unchanged since the checkpoint. Preserve unaffected tour stops while refreshing only stale explanations, diagrams, and findings.

Automatically create checkpoints for approve, approve-with-comments, and request-changes outcomes; support a manual checkpoint for local reviews. A GitHub PR with a new head should be reviewable as a new pass while preserving earlier passes.

Implementation order:

1. Persist source checkpoints independently from session mutations.
2. Compare the current source snapshot with a selected checkpoint.
3. Reset review status only for files changed since that checkpoint.
4. Add Full change / Since last review switching.
5. Add a concrete revision summary and history.
6. Reconcile tour stops and findings across revisions.
7. Support starting a new pass for an updated, previously reviewed PR.

## 2. Needs your attention

Add a compact pre-tour briefing derived from evidence rather than an opaque score: unresolved P0/P1 findings, changed public contracts, broad call-flow impact, missing or changed tests, stale explanations, and—during GitHub reviews—failing checks or merge conflicts. Include a reasoned review-time estimate.

## 3. Finding lifecycle

Replace the single generic dismissal state with explicit dispositions: accepted, false positive, intentional, deferred, fixed, and obsolete after refresh. Preserve the disposition and an optional reviewer note across checkpoints so the same issue does not repeatedly return without context.

## 4. Symbol Peek

Open a symbol's definition and usages without abandoning the current stop. Preserve a back trail. Prefer CodeGraph when the repository is indexed, then an available language server, then bounded repository search.

## 5. Review navigation and scoped discussion

Add keyboard navigation (`J`/`K` for stops, `Z` for focus mode, `?` for help), range- and stop-level comments, and Questions that open already scoped to the current stop and selection.

## 6. Adaptive diagrams

Keep component and sequence diagrams, and add state-machine or data-model views only when repository evidence supports them and the visual materially improves understanding.

## 7. Issue-to-implementation assessment

For GitHub pull requests, ingest a linked issue and map its acceptance criteria to implemented, missing, or unclear evidence. Optionally surface related issues and earlier pull requests touching the same area, with explicit provider-access and privacy boundaries.

## Follow-up features

### 8. Structural blast radius

Add a per-changed-symbol view of what the change can structurally reach: direct callers, transitive impacted nodes, affected files, and nearby test gaps. Follow the `mobile-code-review` model by recording the structural provider, confidence, and provenance with every result; pin findings to changed or impacted symbols and use broad, untested reach as a review-prioritization signal.

Keep the claim precise: graph reach is an authored or statically discovered dependency path, not proof of runtime impact. Show both the bounded graph rendered in the UI and the larger reported radius when the provider truncates visible nodes. Let reviewers select a changed symbol and inspect its isolated subgraph rather than collapsing same-named symbols into one node.

### 9. Dry run

Add a no-side-effect preflight for starting or regenerating a review. Resolve the comparison, configuration, provider availability, expected agent requests, optional artifacts, and bounded review scope, then report what would happen without creating a durable session, opening a browser, modifying the repository, publishing provider data, or invoking an agent.

The dry run should use the same validation and selection path as the real command so a successful preflight is meaningful. Its machine-readable output should be stable enough for scripts and CI.

### 10. Archify integration

Support [Archify](https://github.com/tt-a1i/archify) as an optional diagram renderer for architecture, workflow, sequence, data-flow, and lifecycle views. Generate typed JSON IR from the same bounded repository evidence used by the tour, run Archify validation before displaying an artifact, and preserve the last valid diagram when a generated revision fails validation.

Embed the resulting self-contained interactive HTML in the briefing and exported review where practical, including search, authored upstream/downstream reach, exact routes, and Before / Delta / After architecture views. Keep Code Review Tour's current validated Mermaid path as the built-in fallback; integration must not require network access or imply runtime impact from authored topology.

### 11. Skill extraction

Add a feedback-handoff step that asks the receiving agent to assess whether reviewer comments, clarifications, requested changes, or corrected assumptions reveal a reusable lesson. When they do, the agent should propose or apply the lesson to the most relevant existing skill—or create a narrowly scoped skill when no suitable one exists—so the same class of mistake is less likely to recur.

Implement this by extending the Code Review Tour skill or introducing a companion feedback-processing skill. Extraction should require evidence from the completed review, distinguish general guidance from repository-specific convention and one-off preference, avoid duplicating existing instructions, and report what was extracted and where. Do not turn every comment into a rule or silently modify unrelated skills.
