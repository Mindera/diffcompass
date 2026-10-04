# Side-by-side diff viewer lab

An isolated evaluation, **not a production renderer replacement**. Left: the
real DiffCompass renderer from this worktree, framed to show the selected file.
Right: Monaco 0.55.1 plus a small review adapter. Both use identical source
revisions and the same real review session/API.

## Run

From the repository root (with its existing dependencies installed):

```sh
cd prototypes/diff-viewer
bun install --frozen-lockfile --ignore-scripts
bun start
```

Open the URL printed by the process. Port defaults to `47620`; override with
`DIFF_VIEWER_PORT`. Each launch creates a fresh Git fixture under the OS temporary
directory and prints its path. Comments and messages are saved **only there**.
Stopping the process leaves that disposable directory available for inspection.
The browser needs no CDN; all Monaco assets/workers are served locally.

The server invokes no real agent, edits no real source and disables installation,
publication, global-session management and other unrelated API operations.
Questions traverse the real attached-agent pipeline but receive a plainly
labelled deterministic fixture response. It initializes a pre-authored tour via
the public session API. No historical/private `selection` fields are patched.

Production dependencies and files are not modified by this experiment. Monaco
has its own pinned package and lockfile here. The server can also use an already
installed root Monaco package for developer convenience; use the local pinned
installation for repeatability. Production exports do not embed this lab.

## Try these first

1. In **Unified**, click a gap's upper/lower edge to reveal ten lines from that
   side. Double-click its line count to show the whole interval. Use the native
   gutter fold icon or the explicit **Collapse unchanged lines…** button inside
   expanded context to collapse that interval.
   The other gap remains unchanged. **Collapse unchanged** resets all gaps.
2. Select added code → **Comment** or **Ask agent**. Comments can be edited or
   deleted. They use the same API as the current pane, not mock browser storage.
   A text selection creates a **Quote comment** with a visible, verbatim
   **Quoted code** block (also in Review activity). A caret creates a **Line
   comment**, without mislabelling full-line validation context as a quotation.
   Multiline quotes scroll within a bounded block; cards resize to their content.
   Questions appear in **Review activity** with their exact source anchor.
   Click a speech-bubble badge to open the conversations for that line; a count
   indicates multiple threads. The labelled P2 badge opens its finding details.
3. For deleted code, switch to **Split** and select the left editor. Unified
   deleted-line selection is intentionally blocked pending a proper adapter.
4. **Reveal hidden source** targets line 55 inside an unchanged interval.
   **View source** opens that exact revision, with function-folding chevrons.
   **Back to diff** restores the selection and scroll position.
5. Try the finding, added/deleted files, plain text, and the 2,729-line fixture.
   **Expand** gives either renderer the full available width.

## What the experiment establishes

- Local unchanged-context expansion, full reveal and local re-collapse work.
- A real API accepts before/after source ranges, partial quotations, and exact
  complete-line validation context. Rendered row indexes are never anchors.
- Monaco view zones can host review forms, but need explicit accessibility and
  stacking adjustments; before-side annotations in unified mode need mapping.
- Source navigation can reveal a hidden target, then return without changing
  the camera/selection. Source models and file models are disposed on exit.
- Added, deleted, plain-text and larger files render read-only with local workers.
- Change signs (`+`/`−`) have a separate lane **before** the line numbers in
  unified/split views, clear of review badges. A Monaco-0.55.1-specific DOM adapter
  mirrors native indicator geometry, including deleted/wrapped view zones; it
  does not remap source anchors or consume mouse input. `gutter.playwright.js`
  checks number/badge separation, four-digit lines, and added/deleted files.
  Revalidate this adapter on a Monaco upgrade.

### Important limitations discovered, not swept under the rug

**Monaco does not natively provide function folding inside a diff editor.** Its
`esm/vs/editor/browser/widget/diffEditor/components/diffEditorEditors.js`
explicitly sets `folding = false` on its child editors. It does provide
unchanged-interval folding; ordinary source editors provide function folding.
Forcing folding on the children would interfere with the diff's hidden-line
alignment, so this prototype does not do that. Whiteboard's structural fold model
is custom work, not something this library supplies out of the box.

**Unified deleted text is a separate DOM selection surface.** It is not an
original-editor selection. Clicking it clears any previous after-side anchor
and asks for Split mode. Existing before-side comments can still be displayed
and edited in unified mode. Do not claim unified selection parity yet.

**Folded annotations have no per-gap badges yet.** Review activity remains
available, but the fold controls must indicate hidden comments, questions and
findings before adoption. This is a release blocker, not acceptable data loss.

**Comment ranges still require consecutive lines in the server's current diff.**
Monaco can display full-file context that this API has not admitted as reviewable
context. A large selection across an omitted interval is rejected by the server;
the draft is retained with the error. Full-file comment parity needs a server
context integration, not relaxed validation or silently moving the anchor.

## Current-feature inventory and parity

Inventory evidence: `public/app.js` (`renderDiff`, `renderSplitSide`,
`renderUnifiedRow`, `showChangedFile`, `openInlineCommentEditor`,
`submitInlineAsk`, `renderConversationBadges`, `resolvePeekSymbol`,
`renderTourAnnotation`, proposal-preview handlers), `public/index.html`,
`src/git.ts`, `src/session.ts`, `src/types.ts`, and the root `RESEARCH.md`.

| Existing feature / integration | Prototype status |
| --- | --- |
| Split/unified, word highlighting, wrapping, light/dark | Present; Monaco computes its own diff so hunk/alignment parity is not guaranteed |
| Larger/full-file context | Full revision models; native interval controls replace whole-file context growth on the right |
| Changed-file selection, added/deleted/text files | Included fixtures; rename/binary/missing/truncated source not covered |
| Line/range comments, quotation, edit/delete | Real API; old and new in Split, new in Unified |
| Selected-code agent questions | Real API and exact anchor; deterministic test responder; activity drawer |
| Conversation badges | Clickable speech bubbles, grouped by root thread and source line; old/new kept separate; stale anchors not pinned. Unified old-side badges await the deleted-line adapter |
| Thread followups, queued/draft state, extra context files | Not ported; new question draft survives annotation polling, but switching files requires discard confirmation |
| View source and return | Exact old/new fixture source; restores view; function folding in source |
| Symbol Peek definitions/usages/navigation | Bridged to the existing left pane/resolver; not a Monaco widget migration |
| Native language-service hover/Peek | TS/JS providers are bundled; native inline Peek verified on fixture definitions. Other languages require providers, and cross-file/revision-aware workspace integration is not implemented |
| Finding pins and reveal | Labelled P0–P3 badges (fixture P2), priority colours and click-through details; co-located findings/conversations use separate lanes. Dispositions, validation and notes not adapted |
| Selection Copy | Implemented; clipboard permission remains browser-controlled |
| Request edit / suggested changes / proposal preview / Apply / Reject / Undo | Deliberately disabled, not reimplemented |
| Tour stops, phase filters, focus, briefing and return-to-diagram/caller-graph | Existing shell hidden for comparison; integration not ported |
| Repo tree, unchanged-file browsing, source paging and search | Not ported; fixed fixture picker only |
| Whitespace UI, Markdown/image previews and media comments | Not ported; do not substitute generic text for these renderers |
| Reviewed-file status, persisted responsive preferences | Not ported to Monaco; prototype theme/layout controls are session-local |
| Refresh/checkpoints, stale comments/source fingerprints | Fixed immutable fixture only; not a live-refresh implementation |
| Export, offline HTML, saved reviews and GitHub publication | Not ported; global mutations disabled |
| Reusable sequence cards, shared folds and scroll synchronization | Not implemented in this experiment |
| Keyboard/screen-reader support | Read-only editor plus labelled review forms; no complete accessibility audit |
| Virtualization / performance / bundle size | Larger-file smoke case and model-disposal checks only; no benchmark or production delivery budget established |

The left pane retains the existing diff renderer and its inline actions. Its
surrounding navigation/sidebar chrome is hidden for comparison, so it is not a
complete production-screen usability test. Use the shared activity drawer for
question replies. Some underlying production actions are intentionally rejected
by the harness API allowlist.

## Verification

```sh
bun test prototypes/diff-viewer/fixtures.test.mjs prototypes/diff-viewer/annotations.test.mjs
bunx tsc --ignoreConfig --noEmit --allowJs --checkJs false --moduleResolution Bundler --module ESNext --target ES2022 --strict --allowImportingTsExtensions --types bun prototypes/diff-viewer/server.ts
node --check prototypes/diff-viewer/app.mjs
```

`smoke.playwright.js` is an async function accepting a Playwright `page`, also
loadable through `browser_run_code_unsafe`'s `filename` parameter after navigating
to the printed URL. It tests local gaps, source folding/return, fail-closed
deleted-line selection, comment CRUD through the real API, anchored questions,
file/model lifecycle, themes, wrapping, finding reveal, and read-only behaviour.
It adds a labelled synthetic question to the disposable session.

The unit tests cover old/new identities, partial/multiline selections, Monaco's
next-line-column-one convention, CRLF, Unicode, missing sides, invalid bounds,
100-line limits, EOF and stable fixture anchors.

2026-10-04 quotation follow-up: **33 unit tests pass**. `quotes.playwright.js`
checks visible exact partial quotations, edit preservation, activity cards,
ordinary caret comments, multiline before-side quotes, card sizing and themes.
It removes only its own test comments from the disposable review.

Language-service scope: syntax colourization does not imply hover, definitions,
references or structural folding. The pinned build has hover providers for
TypeScript/JavaScript, HTML, CSS-family languages and JSON; Kotlin and other
basic grammars need an additional provider. The fixture only loads its current
old/new files, not a complete project/dependency workspace. Native inline Peek
was verified with `editor.trigger(..., 'editor.action.peekDefinition', {})`;
the command is globally registered and is not returned by `getAction` in this
build. The toolbar still deliberately uses the existing resolver bridge until
source revisions, cross-file model loading and unsupported providers are adapted.

2026-10-04 follow-up: conversation/finding badge identity tests and per-interval
collapse-state tests bring the unit suite to 30 tests. Explicit inline collapse
uses a small, shape-checked adapter for the pinned Monaco version's serialized
view state; this is version-sensitive and covered by browser regression checks,
not a claim of a stable structural-folding API. Method chevrons inside the diff
remain a separate, unresolved integration—not a hidden CSS setting.
`badges.playwright.js` adds keyboard/click opening, co-located conversation and
finding badges in both layouts, per-interval collapse isolation and file-switch
disposal checks; both browser scripts passed after this follow-up. A rapid file
switch also emitted a Monaco `Canceled` console exception; retain that lifecycle
case for investigation rather than treating this as production-ready.

Verified locally on 2026-10-03: **23 unit tests passed**, prototype/server and
repository typechecks passed, and the saved browser smoke script completed.
It measured one gap changing from 78 to 68 hidden lines while the separate
14-line gap stayed unchanged; source return preserved the exact selection and
scroll; each file switch left two models. The final browser pass had no console
errors. These are functional checks, not a performance or accessibility audit.

## Decision gate

This is useful for comparing unchanged-context UX and annotation feasibility.
It is **not replacement-ready**. Before selecting an engine, resolve in-diff
structural folding and unified old-side selection, then hidden-annotation
indicators. Those are core requirements, not later cosmetic polish. Compare a
CodeMirror/custom region-model spike if those costs outweigh Monaco's benefits.

Any production adapter needs immutable comparison identity plus old/new paths
and contents; `reveal(anchor)`, `captureSelection()`, annotation and source-return
hooks; and model disposal. Consumers must stop depending on HTML `.diff-row`
selectors. Share fold choices only when comparison/file/region identities match;
keep viewport/selection surface-local for future sequence cards.
