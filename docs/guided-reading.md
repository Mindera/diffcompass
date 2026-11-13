# Guided reading

Each tour stop explains one behavior. The summary stands alone; **More detail**
opens additional mechanics. Key, normal, and supporting-context labels indicate
reading priority, without imposing quotas on the route.

**Read this step’s code** groups related before/after excerpts in Changes. A stop
can reference up to eight changed ranges across files. The view follows the same
renderer, Split/Unified, and Scroll/Wrap preferences as the rest of the review.
**Open full file** suspends the tour so you can explore or comment; **Back to tour
code** returns to its current stop. Existing question and comment drafts retain
their original context. Source excerpts are read-only; line comments use the full
file view.

## Coverage

**Not covered** lists changed diff blocks not fully addressed by current tour
anchors. Partial blocks remain listed. Generated files, binary changes, empty
files, renames, and metadata-only changes also appear when not represented by
textual tour evidence. A before/after replacement can be covered from either
side; separate edits in the same block need their own coverage. Coverage is
computed against the full comparison even when Changes displays a checkpoint
filter. It describes the tour's scope, not review completion or correctness.

The list displays at most 100 uncovered entries and reports additional entries.
Grouped code displays up to 160 rows per excerpt and 600 rows / 100,000 source
characters per stop, with visible limits and links to full files. Oversized lines
are omitted rather than silently truncated.

## Evidence and freshness

New tours store content fingerprints of the diff blocks behind each anchor.
Line numbers are excluded from the fingerprint. Unchanged blocks can move without
invalidating the stop; changed, missing, or ambiguous blocks mark it **Out of
date**. Stale explanations remain readable with a warning, but the focused view
does not silently substitute different code at the old line numbers. Supporting
notes also become stale when any cited source file changes.

Fingerprints include the surrounding diff context. A context change or a different
diff boundary can conservatively mark a stop stale even if its central statement
survives. Older sessions have no original fingerprints and display **unverified**;
their original ranges remain accessible without claiming current coverage. A tour
prepared against a checkpoint comparison may be stale against the full comparison
when the before-side content differs. Saving or resuming never invents provenance.

## Optional notes

An agent can include at most two notes per stop: decision, upkeep, limitation,
divergence, or test evidence gap. Each needs exact complete-line quotes checked
against captured Git objects. A divergence needs both sources; a test gap needs
the inspected test scope. Quotes establish provenance, not semantic correctness.
The agent must still inspect callers, guards, state writers, consumers, and tests
before making claims or asking review questions. Unsupported notes are repaired
or omitted, rather than displayed as verified observations.

Markdown and offline HTML exports retain summary, detail, priority, freshness,
related ranges, note evidence, and coverage. HTML also includes bounded grouped
code excerpts and full-file navigation. Existing plain-text attached-agent
responses remain readable: their first paragraph is the summary and subsequent
paragraphs appear under More detail.
