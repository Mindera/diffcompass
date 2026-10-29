# Briefing guide

[Back to the README](../README.md#narrative-briefing)

The **Briefing** tab starts with the outcome: its title states the concrete change, and
its opening explains what becomes possible and how that differs from before. The story
then follows how the implementation achieves it, connecting intent, behavior, design
decisions, and boundaries. Internal changes describe their technical outcome without
inventing a user-facing benefit. Author intent and observed behavior ground the
explanation; inferred rationale is labelled.

Code appears as focused before-and-after diffs alongside the prose it supports, starting
in the opening section for code changes. Diagrams explain a particular relationship or
step in the story. Additions, deletions, and both line numbers come from the captured
Git comparison. The same diffs appear in diagram evidence and exports; unchanged context
is labelled explicitly. The left outline follows the section in view as you scroll. Drag
either side pane's inner edge to resize it. The code workspace is labelled **Changes**;
reading or inspecting a Briefing does not advance the tour or mark files reviewed.

Inspect a diagram to open its complete evidence stack in the right pane. Sequence
messages, architecture components and relationships, lifecycle states and transitions,
data-model entities and relationships, call-flow nodes and edges, and domain concepts
share the same inspector. Select a diagram element or its evidence card to highlight
both, using the mouse or keyboard. Exact source bindings are validated against the
captured old/new Git trees. Domain glossary passages are labelled documentary evidence.
Unlinked elements remain visible with an explicit unavailable state; every diagram has
an accessible element list when canvas identities cannot be matched safely.

Use **Present** to expand a diagram. Selecting a component or relationship keeps the
diagram expanded and opens its code evidence beside it. On narrow screens, the evidence
sits below the diagram. Collapse or expand the evidence pane without leaving Present;
exit presentation to return to the story.

New and regenerated Briefings include a source-linking pass for missing bindings in the
diagrams used by the story. The agent receives the finished diagram's exact element IDs
and endpoints, then inspects captured source for the call sites, declarations, or
documents that establish each relationship, including unchanged supporting files. Every
returned quote must match the captured Git tree; invalid IDs or quotes trigger up to two
repair attempts before generation fails. External elements and relationships that cannot
be established retain a specific explanation in the inspector and exports. If the
40-citation limit prevents another excerpt from being saved, the inspector explains that
limit. Source matching verifies the citation's location; its relevance remains an agent
assessment. Existing saved Briefings gain this inspection when explicitly regenerated.

Use **Ask** to attach a passage, exact quotation, diagram, or element to a question.
Passage controls appear on hover or keyboard focus and stay visible on touch screens.
Inspecting something else does not replace those attachments. Conversations retain their
original saved context across regeneration. The reader and question draft remain in
place when switching to Changes and back. Reading position and inspected evidence are
remembered in this browser when reopening the same saved document; a different snapshot
starts without that selection. On mobile, evidence and questions open in a dismissible
sheet.

**Open in Changes** pauses an active tour and reveals the cited source, including files
in another phase. **Back to Briefing** restores the reader and its selected evidence.
Resuming the tour clears that return button and keeps the tour's saved stop.

Briefing uses the same Archify viewers as Diagrams for sequences, architecture,
lifecycle, data models and domain maps. Each starts with the whole diagram visible.
Inspection preserves the camera; clicking an evidence card also preserves its position
in the pane. Selecting an element in the diagram reveals its evidence. Call flows use
the shared native call tree. These renderers and captured code bindings also work in
offline HTML exports. If a saved viewer cannot be rendered, the element list and its
evidence remain available; Briefing does not substitute a different diagram renderer.

Briefing shares the **Shiki/Monaco**, **Split/Unified**, and **Scroll/Wrap** preferences
with Changes. Drag the inward-facing edges of the side panes to resize them, or use the
evidence pane’s arrow to collapse and expand it. **Wide briefing** expands the reading
column while keeping margins. Inline code remains in the story; selecting it does not
duplicate it in the evidence pane.

“Open reviews in Briefing” controls the opening view; the tab remains available when
disabled. New tours draft the document with the outline request. When a draft uses
sequences, a separate review traces their causal steps against captured source before
saving. Regeneration uses the same review. This complements source validation; it does
not establish runtime behavior or guarantee the coherence of the whole narrative. Saved
documents retain their text until explicitly regenerated; older tours without a document
receive a basic overview following the saved tour order, with captured excerpts from
current stops. **Regenerate Briefing** uses the current outcome-first guidance, replaces
only the document, and validates its source excerpts again. Changed source or
author/reviewer intent marks an existing document outdated. HTML exports include an
offline reader and inspector; Markdown exports keep source excerpts in the narrative and
include a linked evidence appendix.

The document contract is bounded to 12 sections, 60 blocks, 24,000 prose characters, and
40 source citations (30 lines/8,000 characters each). A code citation captures the
corresponding replacement and nearby context, capped at 120 diff rows/24,000 source
characters with explicit omission markers. Existing documents gain diffs on resume only
when their captured comparison still matches; unavailable diffs never fall back to a
standalone code snippet. Questions accept up to eight selected items and 8,000
characters of selected context. See `src/briefing.ts` for the versioned contract and
validation rules.
