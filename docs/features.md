# Feature catalogue

[Back to the README](../README.md) · [Usage and configuration](usage.md)

DiffCompass connects changed code, diagrams, questions, and review evidence in a
local browser workspace. This catalogue covers the Briefing and shared-renderer
updates through v2.2.2, the 16 features from the interactive guide available in
v2.1.0 and later, and one clearly marked research prototype. See the
[roadmap](../ROADMAP.md) for release history and delivery details.

## Open the interactive HTML catalogue

GitHub renders this Markdown page directly, but displays HTML files as source code.
To use the illustrated, searchable version:

1. Open the [HTML catalogue file](feature-showcase.html).
2. Click **Download raw file** in GitHub's file toolbar.
3. Open the downloaded `.html` file in your browser.

The HTML includes its images and works offline; no server is needed. If you have
cloned the repository, open `docs/feature-showcase.html` from your file manager
(or run `open docs/feature-showcase.html` on macOS from the repository root).
Its concept illustrations use sample code, and its archived screenshots show
earlier branding. The [screenshots below](#screenshots) show the current interface.

## Browse the features

| Review task | Features |
| --- | --- |
| Understand the change | [Narrative Briefing](#narrative-briefing), [guided walkthrough](#guided-walkthrough), [architecture maps](#architecture-maps), [sequence diagrams and code steps](#sequence-diagrams-and-code-steps), [call flows](#call-flows), [explore impact](#explore-impact), [lifecycle diagrams](#lifecycle-diagrams), [dry runs](#dry-runs) |
| Inspect the source | [Diff and source navigation](#diff-and-source-navigation), [Symbol Peek](#symbol-peek), [What changed](#what-changed), [optional Monaco renderer](#optional-monaco-renderer) |
| Discuss and decide | [Contextual conversations](#contextual-conversations), [findings and dispositions](#findings-and-dispositions) |
| Revisit and share | [Revision-aware review](#revision-aware-review), [offline review exports](#offline-review-exports), [GitHub suggestions](#github-suggestions) |
| Research | [Language assistance](#language-assistance-research) |

## Understand the change

### Narrative Briefing

Understand the outcome, intent, and design through prose, focused diffs, and diagrams.

**Where:** Briefing.

- Start with a title that explains the concrete change, then follow how it works.
- Inspect diagram elements and their captured evidence without advancing the tour.
- Use the same Archify map viewers as Diagrams, including in offline HTML exports.
- Share Shiki/Monaco, split/unified and scroll/wrap preferences with Changes.
- Resize the side panes, collapse or expand evidence, and choose a wider reading column.
- Return to the same saved reading position and inspect evidence without moving a clicked card.
- Attach passages or diagram elements to questions and export the saved story.

Inferred rationale is labelled. Saved documents retain their text until regenerated.
See the [Briefing guide](briefing.md) for evidence and snapshot limits.

### Guided walkthrough

Turn a long diff into an ordered explanation, one source-backed stop at a time.

**Where:** Start tour → phases → stops.

- Follow an agent-organized route through related changes.
- See current and upcoming stops alongside their source anchors.
- Explore freely, then return to your current stop.

Source anchors help you check the explanation; they do not prove it is correct.

### Architecture maps

Connect a changed component to the larger system around it.

**Where:** Diagrams → Architecture & design.

- Inspect components and relationships in an interactive diagram.
- Compare Before, Delta, and After when saved evidence supports them.
- Follow source links, zoom, pan, or use the Mermaid fallback.

Maps model the source; they are not execution traces. An incomplete Before view
does not establish that a relationship never existed.

### Sequence diagrams and code steps

Select an interaction and read its code evidence beside the diagram.

**Where:** Diagrams → Sequence diagrams → an existing map → Code steps.

- Select an arrow or a code step to follow the same path.
- Read saved source excerpts immediately; resize or collapse the code pane.
- Return from source with the path and camera intact.

Saved evidence is bounded to 40 valid messages, eight anchors per step, and
20 lines or 8,000 characters per excerpt. Live definition lookups are candidates;
offline exports include saved evidence only.

### Call flows

Compare calls before and after a change in one view.

**Where:** Diagrams → Call flows.

- Inspect Changes, Before, and After, including branches and recursion.
- Follow source evidence and linked simulation scenarios.
- Browse saved call flows together in the native category.

Static call relationships do not prove what happens at runtime.

### Explore impact

Inspect what depends on a changed symbol and the evidence behind those links.

**Where:** Diagrams → Blast radius → select a symbol.

- Browse callers, references, involved files, and related test evidence.
- Follow source links and return to the selected impact view.
- Check provider, confidence, completeness, and result-limit labels.

Structural relationships do not prove runtime impact or test sufficiency.
Overall repair warnings and omission reasons are not yet fully represented in
Markdown and HTML exports.

### Lifecycle diagrams

Follow retries, cancellation, and terminal states through a change.

**Where:** Diagrams → Data & lifecycle → an existing artifact.

- Inspect branching transitions, initial states, and terminal states.
- Follow source and return to the diagram's camera and inspection context.
- Use the Mermaid fallback if native rendering fails.

A lifecycle diagram is a model of the source, not an executed state machine.

### Dry runs

Try an input and inspect a proposed path through the change.

**Where:** Dry runs tab, or a linked Simulate action.

- Edit scenario inputs, mocks, and assumptions before preparing a walkthrough.
- Step through source excerpts, values, branch choices, and outcomes.
- Cancel preparation, retain independent traces, and export prepared results.

Dry runs are agent-produced simulations. They do not execute the reviewed
application, and changed inputs or source can make a trace stale.

## Inspect the source

### Diff and source navigation

Read what changed with enough surrounding code to judge it.

**Where:** Diff → changed file → expand context / full file.

- Switch between split and unified layouts, wrapping, and syntax themes.
- Inspect word-level changes, whitespace, and Before/After source.
- Expand unchanged context and browse the repository without losing your review.

Large diffs use bounded paging. Captured historical source and the current
workspace remain distinct.

### Symbol Peek

Follow a definition or usage without losing your place.

**Where:** Select code → Peek symbol.

- Inspect definition and usage results within the tool's limits.
- Use partial-name suggestions and a navigation trail.
- Use available providers, with repository search as a fallback.

Provider coverage varies. Search matches are candidates, not guaranteed call
targets or project-aware IntelliSense.

### What changed

Read an explanation of a file's changes, then expand the supporting code evidence.

**Where:** Diff mode → changed file header → What changed, in Shiki or Monaco.

- Read the tour agent's explanation for the selected comparison.
- Expand TS/TSX/Kotlin parser details and navigate captured Before/After source.
- Follow related tour stops or prepare a follow-up in the existing composer.

New tours require explanations for every changed file; older tours are not
backfilled. Explanations persist with the tour, while parser summaries and ASTs
do not. Coverage does not prove prose correctness, author intent, or runtime
behavior; unsupported grammar, stale source, and export limits stay explicit.

### Optional Monaco renderer

Choose an editor-style diff while keeping the same review and discussions.

**Where:** Diff toolbar → Diff renderer → Monaco. Shiki remains the default.

- Read captured Before/After code with lazy editors and locally bundled assets.
- Use inline comments, review actions, suggestion drafts, and What changed.
- Retain unsaved drafts and their original source through refresh or failures.

Saving a draft against changed source stays blocked. Images, unsupported or large
files, workspace views, and full proposal previews retain Shiki; sequence snippets
are separate. Device and performance limits remain documented in the
[roadmap](../ROADMAP.md).

## Discuss and decide

### Contextual conversations

Keep a question attached to the code that prompted it.

**Where:** Click or select source → Comment / Ask agent; Conversations.

- Discuss a line, range, stop, or the whole review.
- Quote exact source and add repository context within the tool's limits.
- Reopen threads from source badges and retain them with the session.

Agent replies are review assistance, not the original author's recorded rationale.
A proposed edit requires **Apply** before it changes the reviewed workspace.

### Findings and dispositions

Inspect and resolve review concerns with their supporting evidence.

**Where:** Findings → finding → source / disposition.

- Inspect P0–P3 findings with observations, causal paths, impact, and coverage.
- Accept, dismiss, defer, or mark findings fixed with reviewer notes.
- Reassess evidence after refresh and optionally publish selected review comments.

With the bundled skill, ordinary branch or working-tree tours skip findings by
default, including tours of code you wrote or had an agent write for you. Ask for
a PR tour to include findings by default, or explicitly ask the agent to enable
or skip them for either kind of tour.

The skill uses `--no-findings` to skip analysis for a session. Direct CLI launches
default to findings enabled, subject to [repository configuration](usage.md#repository-defaults)
for branch tours. New `diffcompass pr` reviews enable findings even when that
configuration disables them, unless you pass `--no-findings`. Resumed sessions
retain their saved setting. A finding is a review claim, not proof; publishing
to GitHub is a separate explicit action.

## Revisit and share

### Revision-aware review

Return after another commit and focus on what needs a second look.

**Where:** Review checkpoints → Full change / Since last review.

- Name checkpoints and browse comparison history.
- Reopen changed files while retaining review state for unchanged files.
- Identify stale annotations and reconcile findings after refresh.

Old evidence remains tied to its original revision; refreshing does not silently
retarget it to newer source. See [sessions and retention](usage.md#sessions-and-retention)
for managing saved reviews.

### Offline review exports

Take the explanation and its evidence into a portable review artifact.

**Where:** Review export → Markdown / HTML.

- Share a readable review with selected supported sections.
- Include prepared dry-run traces and saved source evidence where supported.
- Use an offline HTML view with saved sequence Code steps.

An export is a snapshot, not a live repository or resolver. Coverage varies by
feature: impact diagnostics are incomplete, and saved explanations and requested
parser details report separate coverage.

### GitHub suggestions

Offer an exact code replacement in a GitHub review.

**Where:** Saved reviewer edit → Add to GitHub review → Submit suggestions → confirmation.

- Queue or return an eligible saved edit while keeping its replacement intact.
- Confirm selected suggestions and the PR head before publishing a COMMENT review.
- Keep ordinary comments drafted and the tour open; apply locally as a separate choice.

Suggestions require unchanged captured PR source and at most 100 contiguous After
lines within one diff hunk. Unsupported or older proposals stay local. Publication
receipts make retries safe; published suggestions cannot be returned or republished.

## Research

### Language-assistance research

**Status: research prototype, not a production feature.**

The [language-support probe](../prototypes/language-support/README.md) explores a
provider protocol, source-only Kotlin fixtures, and definition/reference results
with explicit source identities. It has no production provider control.

No project-aware Kotlin/Android/KMP provider is bundled. Syntax highlighting and
hover do not establish IntelliSense; source-only fixtures do not verify a real
Android/KMP build. Project import, compiler checking, and provider packaging remain
separate work.

## Screenshots

These captures show the current interface with a disposable checkout demo and
prewritten sample review content.

![DiffCompass showing changed files, a split diff, and a contextual conversation](images/overview.png)

![A guided tour highlighting a change with its explanation and tour navigation](images/guided-tour.png)
