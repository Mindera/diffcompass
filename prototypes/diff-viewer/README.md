# Side-by-side diff viewer lab

For current fixture testing, use the per-file production preview instead:
`DIFF_VIEWER_PR_EXAMPLE=1 DIFF_VIEWER_PORT=47684 bun scripts/monaco-fixture.ts`
(from the repository root). It includes read-only sample PR threads and the
context-expansion example without the old grouped iframe or nested file-list
scrollbar. The older integration and side-by-side harnesses below remain for
historical comparisons, not current scrolling/layout acceptance testing.

An isolated evaluation, **not a production renderer replacement**. Left: the
real DiffCompass renderer from this worktree, with visible changed-file headers.
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

For an isolated **synthetic pull request** example, launch a separate fixture:

```sh
DIFF_VIEWER_PR_EXAMPLE=1 DIFF_VIEWER_PORT=47650 bun start
```

Both panes show the same three sample threads: open on Before L18, open on
After L19, and resolved on After L104, each with two authors/replies. They are
read-only and separate from local editable comments. All identities are labelled
fixtures, URLs use `example.invalid`, and Reply in GitHub is disabled in Monaco.
Refresh/publication endpoints remain blocked; no GitHub data is fetched or changed.
This launches a new disposable session, leaving previously running fixtures intact.

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

### Full DiffCompass integration fixture

From the repository root, with the prototype's pinned dependencies installed:

```sh
DIFF_VIEWER_PORT=47660 bun run prototypes/diff-viewer/integration-server.ts
```

For interactive Archify maps, also set `DIFFCOMPASS_ARCHIFY_DIR` to an existing
renderer checkout/bundle; the fixture does not install one. Each start creates
a **new** disposable repository and review, prints their path and an authenticated
local URL, and leaves existing fixtures intact. Do not use the mutating browser
test against a fixture somebody is reviewing.

This uses the normal full UI: tour and phase navigation, file tree/filtering,
findings, conversations, maps/caller graph, saved dry runs, media, PR criteria,
comments, settings and exports. The text diff is the same Monaco adapter in an
isolated same-origin frame. The banner's **Diff renderer** select switches back
to the existing renderer without disposing Monaco's models. Markdown, images,
unchanged repository source and proposal previews retain the current renderer.
The normal layout/wrap and light/dark controls reach Monaco; the application's
additional syntax-theme palettes are not adapted. Find references deliberately
reuses the existing resolver/viewer, with usages first and explicit workspace
scope; Monaco retains its native definition commands. Exports use the existing static renderer,
not a bundled Monaco editor.
Maps now uses peer destinations: **Understand the change**, **Blast radius**,
**Call flows**, **Sequence diagrams**, and **Data & lifecycle**. The category
dropdown is removed. Component/behaviour/domain maps stay under Understand;
interactive and fallback sequences share Sequence diagrams, and interactive
data/lifecycle maps share their destination with native fallbacks. Optional
categories appear only when there is saved content or a renderer diagnostic.
Each interactive category retains its own selection and mounted camera.

The rich fixture includes four captured text files, native Markdown/image
samples, four authored tour stops, a same-line local comment + question + finding,
and one clearly synthetic read-only PR thread. Comments, review flags and
questions use the real persisted session/API. Mark reviewed collapses only
that file (the normal Unreviewed filter can then remove it from the list).
`src/context-example.ts` is included in the first tour phase: two separated
edits leave three unchanged gaps. Use their centred expansion icons, local
re-collapse buttons, or **Show all context** / **Collapse unchanged**. Toolbar
actions appear only when they can change the diff: Show all for hidden context,
Collapse for expanded context, both for partial expansion, neither for short
files without foldable sections. The toolbar keeps its height. Wheel input
scrolls long code normally, then continues through the file list/page at an
editor edge; short diffs and View source do not trap the surrounding scroll.
Sidebar comment edits open the same Monaco inline composer. Tour stops and
source links use the existing navigation; caller graph return remains native.
Source models read exact captured Before/After Git trees, not live files.

This is still a **local integration preview, not a migration or merge**.
It contains this branch's full application, now including the sequence/code
walkthrough merged into main in PR #3. Decision-log and syntax-diff research
branches remain separate. The harness authors attached-fixture metadata and explanations
before loading through the normal persistence/session APIs. Real agent execution,
GitHub publication, source edits, comparison refresh/switching, updates and review
closure are disabled. Questions receive explicitly labelled fixture replies.
Generation/edit operations outside the route allowlist return a clear error;
their presence in the original UI is not a claim that they work in this preview.

2026-10-05 checks: `bun run verify` passed **641 tests / 4,900 assertions / 75 files**;
the new contract tests cover route boundaries and captured-source independence.
The separate harness typecheck (including JS imports) and syntax checks passed.
`integration-browser.mjs` passed 14 isolated Chrome groups: tour/phase navigation,
Markdown fallback, controls, sidebar editing, question/finding handoffs, labelled
replies, graph return, dry-run links, tabs, reviewed-file isolation, renderer
switch, source/Peek, exports/auth/blocked operations, and 390px overflow. No page
errors in this run. This is not exhaustive cross-browser/accessibility, real
GitHub, real agent, or production language-provider validation. Prior prototype
lifecycle/maintenance caveats still apply. The standalone independent-files,
comment-editing and reviewed browser regressions also passed with no page errors.

Reproduce against a fresh disposable integration server using an **existing**
Playwright module (no install performed by the script):

```sh
node prototypes/diff-viewer/integration-browser.mjs /absolute/path/to/playwright/index.mjs 'http://127.0.0.1:PORT/#token=TOKEN'
```

### Side-by-side lab

1. In **Unified**, click a gap's upper/lower edge to reveal ten lines from that
   side. Double-click its line count to show the whole interval. Use the native
   gutter fold icon or the explicit **Collapse unchanged lines…** button inside
   expanded context to collapse that interval.
   The other gap remains unchanged. **Collapse unchanged** resets all gaps.
   The native expansion icon/count group is horizontally centered across the
   gap row in both layouts; local re-collapse buttons are centered too.
2. Select added code → **Comment** or **Ask agent**. Comments can be edited or
   deleted. They use the same API as the current pane, not mock browser storage.
   A text selection creates a **Quote comment** with a visible, verbatim
   **Quoted code** block (also in Review activity). A caret creates a **Line
   comment**, without mislabelling full-line validation context as a quotation.
   Multiline quotes scroll within a bounded block; cards resize to their content.
   Questions appear in **Review activity** with their exact source anchor.
   Click a speech-bubble badge to open the conversations for that line; a count
   indicates multiple threads. The labelled P2 badge opens its finding details.
3. In **Unified**, click or select red/deleted code, then right-click for
   **Comment**, **Ask agent**, **View source**, **Find references** or **Copy**.
   A caret creates a Before line comment; selected text creates a Before quote.
   Removed blocks also accept keyboard focus and **Shift+F10**. Split's left
   editor still works. A range must stay within one Before block: mixed
   Before/After ranges and whitespace-only quotations are explicitly rejected.
   Before comment cards now sit immediately below their deleted source (below
   the last wrapped fragment / final selected line), before replacement code.
   Comments, conversations and findings sit immediately before code, after the
   line-number columns, in both layouts. Try Before 18 and After 18 together.
4. **Reveal hidden source** targets line 55 inside an unchanged interval.
   **View source** opens that exact revision, with function-folding chevrons.
   **Back to diff** restores the selection and scroll position.
5. Try the finding, added/deleted files, plain text, and the 2,729-line fixture.
   **Expand** gives either renderer the full available width.
6. All five fixture files have visible, clickable headers in the prototype.
   **Mark as reviewed** is on each file header. It uses the
   existing authenticated `/api/files/reviewed` endpoint and real session file,
   not browser-only state. **✓ Reviewed** toggles it back; the file picker also
   shows a checkmark. Both panes share the state, including after reload. The
   prototype now collapses that file's code, leaving its header and other files
   accessible. Reopening a reviewed file does not unmark it. An unfinished
   comment stays mounted while collapsed and reappears unchanged on reopening.
   Switching files also preserves it: each file owns its editor and draft.
   Pending saves block repeat clicks; failed saves retain the confirmed state.
   All unreviewed files start expanded; reviewed files start collapsed.
   File expansion is independent, including when reopening reviewed files.
   Short files shrink to their content; long files retain a scrollable viewport.
   The dropdown selects/reveals a file without closing others. The five-file
   fixture keeps five diff editors (ten source models) mounted for the page's
   lifetime; this is not a production-scale virtualization/performance claim.
   Global layout switches are blocked while any file has an unfinished draft.
7. After L18 in `checkout.ts` includes a labelled **Same-line fixture** comment
   alongside the two existing questions. Its dot and speech bubble occupy
   separate clickable slots before the code in Unified and Split.

## What the experiment establishes

- Local unchanged-context expansion, full reveal and local re-collapse work.
- A real API accepts before/after source ranges, partial quotations, and exact
  complete-line validation context. Rendered row indexes are never anchors.
- Monaco view zones can host review forms, but need explicit accessibility and
  stacking adjustments; Unified Before cards use the pinned native deleted-row
  layout plus external cards, while Split retains native editor view zones.
- Source navigation can reveal a hidden target, then return without changing
  the camera/selection. Temporary View source models are disposed on return;
  each file's diff models remain mounted across file navigation/collapse.
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
is custom work, not something this library supplies out of the box. Structural
fold chevrons in the diff were explicitly dropped from this evaluation's
requirements; inline unchanged-context expansion/re-collapse is retained.

**Unified deleted text is a separate DOM selection surface.** It is not an
original-editor selection. `deleted-selection.mjs` now translates that native
DOM range using Monaco's own rendered-character mapping, checks the exact
original model and bounds, and sends the existing review API a Before anchor.
It handles token spans, wrapped fragments, tabs, Unicode, reverse selections,
CRLF evidence and entirely deleted files without searching for matching text.
Mixed blocks/sides, stale models and whitespace-only quotes fail clearly.
Switching file/layout or focusing the After editor releases the cached range;
source return and wrap changes retain its original coordinates.

**This requires a version-pinned prototype compatibility seam.** Monaco does
not expose this mapping as a public diff-selection API. The fixture server
transforms the exact Monaco 0.55.1 minified asset **in memory**, guarded by a
SHA-256 check and unique insertion points (`deleted-source-bridge.mjs`). It
exposes the existing `RenderLinesResult.getModelPositionAt` used by Monaco's
deleted-text copy handler; it does not duplicate its mapping algorithm or
change native Copy. `node_modules`, lockfiles and production assets are untouched.
The same seam now reserves card spacing among deleted rows using native
wrapped-line counts, with matching original-editor spacing for line numbers.
`deleted-annotations.mjs` places cards/badges beside those actual rendered rows;
it does not derive source anchors from screen coordinates. During native zone
replacement it retains the last measured card position, adjusted for scrolling,
so drafts do not disappear or lose keyboard focus. Native deleted-gutter
lightbulbs are hidden on spaced blocks because their hit testing assumes
equal-height rows; the source-aware review context menu remains available.
An unfamiliar bundle fails at startup, not with guessed review anchors. This
must be revalidated or replaced by a maintained integration before upgrading
Monaco or adopting the prototype. It is not a stable upstream API contract.

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
| Line/range comments, quotation, edit/delete | Real API; old and new in Split and Unified; Before selections stay within one deleted block |
| Comment editing state | Edits replace the saved card in place, with an explicit Editing heading, unsaved notice, Save changes and Cancel; failure retains the draft |
| Existing GitHub review threads | Opt-in synthetic examples in both panes with authors, replies and open/resolved state; Monaco reuses the existing annotation positions. No live GitHub synchronization, reply/resolve, remote-edit or Markdown-thread parity claim |
| Selected-code agent questions | Real API and exact anchor; deterministic test responder; activity drawer |
| Conversation badges | Clickable speech bubbles, grouped by root thread and exact source line in both layouts; Before/After kept separate; stale anchors not pinned. Comment dots, conversations and findings occupy the post-number strip immediately beside code, not an outer gutter |
| Thread followups, queued/draft state, extra context files | Not ported; new question draft survives annotation polling, but switching files requires discard confirmation |
| View source and return | Exact old/new fixture source; restores view; function folding in source |
| Find references (formerly Symbol Peek) | Existing resolver/panel/history reused; usages first, definitions secondary, current-workspace source links; name matches labelled possible references |
| Native language-service hover/Peek | TS/JS providers are bundled; native inline Peek verified on fixture definitions. Other languages require providers, and cross-file/revision-aware workspace integration is not implemented |
| Finding pins and reveal | Labelled P0–P3 badges (fixture P2), priority colours and click-through details; co-located findings/conversations use separate lanes. Dispositions, validation and notes not adapted |
| Selection Copy | Implemented; clipboard permission remains browser-controlled |
| Request edit / suggested changes / proposal preview / Apply / Reject / Undo | Deliberately disabled, not reimplemented |
| Tour stops, phase filters, focus, briefing and return-to-diagram/caller-graph | Existing shell hidden for comparison; integration not ported |
| Repo tree, unchanged-file browsing, source paging and search | Not ported; fixture file headers and optional picker only |
| Whitespace UI, Markdown/image previews and media comments | Not ported; do not substitute generic text for these renderers |
| Reviewed-file status | Per-file header toggles/checkmarks use existing API/session persistence; shared with current pane, reversible; marking reviewed collapses code, reopening preserves status and drafts; all file headers remain accessible |
| Persisted responsive preferences | Not ported; prototype theme/layout controls are session-local |
| Refresh/checkpoints, stale comments/source fingerprints | Fixed immutable fixture only; not a live-refresh implementation |
| Export, offline HTML, saved reviews and GitHub publication | Not ported; global mutations disabled |
| Reusable sequence cards, shared folds and scroll synchronization | Not implemented in this experiment |
| Keyboard/screen-reader support | Read-only editor plus labelled review forms; no complete accessibility audit |
| Virtualization / performance / bundle size | Larger-file smoke case and model-disposal checks only; no benchmark or production delivery budget established |

The left pane retains the existing diff renderer and its inline actions. Its
surrounding navigation/sidebar chrome is hidden for comparison, so it is not a
complete production-screen usability test. Both panes now expose file headers;
the comparison bridge no longer hides non-selected files. Use the shared activity drawer for
question replies. Some underlying production actions are intentionally rejected
by the harness API allowlist.

## Verification

2026-10-05 independent-file follow-up supersedes the singleton/accordion below.
`independent-files.playwright.js` first failed because unreviewed `large.ts`
started collapsed. Each file now has a stable editor, model pair, selection,
context state and draft; only its own header/review transition changes its
visibility. Reopening does not recreate or move Monaco. Five browser groups
verify initial states, the reported checkout/large toggle sequence, retained
editor/model/scroll/height, no empty or height-oscillating sampled reopen frames,
and drafts surviving other-file navigation. Reviewed state remains persisted;
manual expansion state is page-local. Source selection listeners are scoped to
the active file; Split/Unified and wrap controls apply to all file views.

The existing PR fixture received only a labelled After L18 comment (no reset);
new fixture launches seed it too. Four same-line checks at 1920px/1100px in both
layouts verify separate comment/question click targets, clear numbers/code and
correct actions. Fresh screenshot: `/tmp/dc-same-line-fixture.png`.

Full isolated-branch `bun run verify`: **638 pass / 0 fail / 4,873 assertions /
74 files**, 64.95s, plus type/syntax checks; log
`/tmp/dc-multifile-verify.log`. Prototype-only checks: **53 pass / 104 assertions**;
separate prototype server typecheck, JS syntax and diff checks pass.
Final Chrome runs pass eight scripts without page errors: badges, independent
files, smoke (including exact source return and ten retained models), gutter,
reviewed-state, same-line fixture, bottom-scroll and PR threads. Logs:
`/tmp/dc-multifile-browser.log`, `/tmp/dc-multifile-pr-browser.log`.
Additional file-list, deleted-card, gap-centering, editing and quote scripts
passed during this turn. The broader deleted-selection script completed all
11 functional groups but still emitted the previously recorded Monaco
`Canceled` page error; it is not an all-browser-clean result.
Single-editor test assumptions were scoped to their own file; the badge test
waits for pending zone anchoring before scrolling to its top collapse control.
No production-scale/memory benchmark, other-browser claim, merge or release.

Earlier 2026-10-05 visible file-list/collapse follow-up (the singleton-editor
behavior below is superseded by independent file views) supersedes the keep-open
reviewed-button behavior. Five file headers remain available; one live editor
moves between them. Reviewed status collapses only the relevant file; manual
reopen preserves status and drafts, and reload starts reviewed files collapsed.
Marker lanes retain co-located entries and reserve 8px after numbers without
adding empty marker slots. Short file sections size to content.
New file-list browser checks first reproduced the missing headers, then passed
six groups. Reviewed-state, gutter, deleted-card, gap-centering, PR-thread,
bottom-scroll and smoke checks pass in isolated Chrome without page errors.
Gutter tests now wait for section resizing to settle; the source-return check
captures actual click-time departure (the earlier sample preceded a 10px layout
adjustment). Exact return remains asserted, not relaxed. Prototype unit checks:
**53 pass / 104 assertions**, plus server typecheck, JS syntax and diff checks.
No whole-repository verification or production migration is claimed.

2026-10-05 bottom-scroll alignment follow-up (prototype branch only): scrolling
over the Before gutter at EOF reproduced a **12px** drift (scroll offsets 351
and 339). Monaco's horizontal-scrollbar allowance extended only that editor's
scroll range. Both editors now exclude that automatic allowance and reserve
the same 12px bottom padding through public options, preserving room for the
horizontal scrollbar without a custom scroll synchronizer or anchor changes.
`bottom-scroll.playwright.js` first failed on real wheel input, then passed five
groups in isolated Chrome: Unified/Split × wrapped/unwrapped, plus expanded
narrow layout after card reflow. No page errors; final screenshot visually
checked. Deleted-card placement, centered-gap and smoke browser regressions
also pass without page errors; **53 prototype unit tests / 104 assertions**,
JS syntax and diff checks pass. No fresh whole-repository verification claimed.

2026-10-05 reviewed/context-control follow-up (prototype branch only):
`reviewed.playwright.js` passes four groups: keyboard mark/unmark, shared state,
file/layout switches, reload and disk persistence; current-to-prototype polling;
draft retention and save failure; captured-path correctness during an in-flight
file switch. `gap-centering.playwright.js` passes five groups: horizontal geometry
at 1920px/1100px in Unified/Split, native expansion/local re-collapse, light theme.
Both checks first reproduced the missing button/left-aligned controls, then
passed in isolated Chrome with no page errors. The comparison-only bridge now
disables its hidden unreviewed filter so the selected file remains available.
Targeted prototype and existing reviewed-state/scroll checks: **53 tests,
114 assertions**, plus separate prototype-server typecheck. These are not a
fresh whole-repository verification or a production migration claim.

```sh
bun test prototypes/diff-viewer/fixtures.test.mjs prototypes/diff-viewer/annotations.test.mjs prototypes/diff-viewer/deleted-selection.test.mjs prototypes/diff-viewer/deleted-annotations.test.mjs
bunx tsc --ignoreConfig --noEmit --allowJs --checkJs false --moduleResolution Bundler --module ESNext --target ES2022 --strict --allowImportingTsExtensions --types bun prototypes/diff-viewer/server.ts
node --check prototypes/diff-viewer/app.mjs
```

`smoke.playwright.js` is an async function accepting a Playwright `page`, also
loadable through `browser_run_code_unsafe`'s `filename` parameter after navigating
to the printed URL. It tests local gaps, source folding/return, Before
deleted-line selection, comment CRUD through the real API, anchored questions,
file/model lifecycle, themes, wrapping, finding reveal, and read-only behaviour.
It adds a labelled synthetic question to the disposable session.

The unit tests cover old/new identities, partial/multiline selections, Monaco's
next-line-column-one convention, CRLF, Unicode, missing sides, invalid bounds,
100-line limits, EOF and stable fixture anchors.

2026-10-04 Before annotation placement follow-up (local, uncommitted):
**48 prototype tests / 85 assertions pass**; final full `bun run verify` passes
**633 tests / 4,854 assertions / 73 files** (53.92s), including type/syntax
checks. The prototype server's separate typecheck and JS/diff checks pass.
`deleted-annotations.playwright.js` passes **7 groups with no page errors**:
exact red-row card/badge placement before replacement code; separate Before/After
question badges and keyboard access; multiple cards/editing/layout switches;
reload; draft typing through native redraw and wheel scrolling; fully deleted
files/multiline endpoints/wrapping; and deletion restoring native spacing.
An intermediate redraw focus loss was fixed and is explicitly regression-tested.
Existing deleted-selection (11 groups), smoke, badge, quote and gutter scripts
also complete all functional checks on the final code. The strict combined
browser run still exits nonzero for the previously observed Monaco `Canceled`
word-highlight disposal errors in deleted-selection and badge scripts; these
are not suppressed or labelled fixed. The remaining production gates below
are unchanged. Final evidence: `/tmp/dc-before-final-verify.log`,
`/tmp/dc-before-final-browser.log`, `/tmp/dc-before-placement-final.png`.
A fresh user preview uses port 47649; the previous user fixture/data is preserved.

2026-10-04 gutter density follow-up: Unified now reserves only the widest
actual badge row in the file (stable while scrolling), followed by one shared
sign lane. Both number columns use their actual digit budget; Split retains its
existing per-editor gutters. The supplied preview's total gutter shrank from
186px to 138px. The compactness regression failed on 186px before the change.
Full verify: 633 pass / 4,854 assertions / 73 files (72.89s). After the final CSS
sign-position synchronization fix, gutter → badge → gutter browser checks pass
without page errors, including file switches, both layouts and four-digit lines;
JS syntax and diff checks pass. Before-card and smoke checks also pass; broader
deleted-selection checks retain the known Monaco cancellation error above.
Keyboard tests wait for a rendered visible badge before focusing it. Evidence:
`/tmp/dc-gutter-tight-verify.log`, `/tmp/dc-gutter-tight-final-browser.log`,
`/tmp/dc-gutter-tight-browser.log`, `/tmp/dc-gutter-tight-regressions.log` and
`/tmp/dc-gutter-tight-preview.png`. Same preview URL; no saved-data changes.

2026-10-04 beside-code follow-up supersedes the outer-badge-gutter design above:
review markers use Monaco's post-number decoration strip in both layouts, with
each row's final marker 4px before code. Only the 16px Unified sign lane remains
outside the native numbers. Split cards remain native view zones; its markers
now use the same source-aware overlay. Distinct Before/After markers on the
same unchanged row receive separate visual slots without merging their anchors.
Native context-fold controls remain available. Supplied preview: 128px total
number/sign/marker area. The fixture and its saved comments are unchanged.
Full verify: **635 pass / 4,864 assertions / 73 files**, 54.99s; prototype server
typecheck, JS syntax and diff checks pass. Updated gutter checks require markers
after numbers in both layouts. All eight placement groups pass without page
errors, including three marker kinds on one line and Before/After markers on
one unchanged row. Existing smoke, deleted-selection, badge and quote functional
checks pass; the broader deleted-selection/badge runs still report the existing
Monaco cancellation error. Logs: `/tmp/dc-markers-beside-verify.log`,
`/tmp/dc-markers-beside-final-browser.log`, `/tmp/dc-markers-collocation-browser.log`.

2026-10-04 Unified Before follow-up (local, uncommitted): **43 prototype unit
tests / 75 assertions pass**; full branch `bun run verify` passes **628 tests /
4,844 assertions / 72 files**, including type/syntax checks. The prototype server
typecheck also passes. `deleted.playwright.js` completes **11 functional groups**:
real pointer line/quote comments and right-click actions, keyboard focus transfer,
questions, source/return, Copy and existing Peek routing, mixed/whitespace rejection,
deleted-file repeated Unicode/CRLF, wrapped fragments, EOF/keyboard menus,
Split CRLF compatibility and selection reset. Boundary tests construct DOM Ranges;
caret/double-click/menu checks use actual pointer events. No server validation is
relaxed. The menu and Before quote form were also visually inspected.

The existing smoke, quote, badge and gutter scripts complete their functional
checks on rerun. **This is not a zero-error browser result:** deleted-selection
and badge runs still emit the previously observed Monaco `Canceled` page error
during word-highlight disposal; the strict error-checking runner fails those
runs. An earlier combined gutter run also briefly lost its removed sign between
render samples; separate and later combined reruns passed without changing its
test or gutter implementation. Both limitations are retained, not suppressed.
No Firefox/Safari/touch or complete assistive-technology verification is claimed.
Evidence: `/tmp/dc-unified-final-verify.log`, `/tmp/dc-unified-final-browser.log`,
`/tmp/dc-unified-final-regressions.log`, and the earlier
`/tmp/dc-unified-regression.log`. Screenshots:
`/tmp/dc-unified-before-menu.png` and `/tmp/dc-unified-before-composer.png`.
The prototype branch alone is changed; no merge, release or production migration.

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
are not a hidden CSS setting and are now explicitly out of scope by user choice.
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

2026-10-05 comment-card follow-up: saved comments and composers use a distinct
theme-aware background. Editing reuses the saved card's source position and
content observer instead of adding a second card. Cancel restores the original;
Save changes updates the same local comment, not a GitHub thread.
`comment-editing.playwright.js` passed five groups covering Before/After in
Unified/Split, refresh during an edit, cancel/save and failed-save retry.
`deleted-annotations.playwright.js` (nine groups), `quotes.playwright.js` and
`smoke.playwright.js` also passed in isolated Chrome with no page errors in this
run. The three annotation/selection unit files passed 27 tests / 66 assertions;
app syntax and diff whitespace checks passed. Before/After editing screenshots
were visually inspected. This does not supersede earlier lifecycle errors or
claim a new whole-repository, cross-browser or PR integration verification.
Local PR drafts are still published only via the current app's separate review
confirmation; Monaco has no GitHub inclusion/publication controls yet.

2026-10-05 PR-example follow-up: `pull-request-fixture.ts` seeds the existing
session thread model only when explicitly enabled. The saved fixture passes the
production session loader, including canonical workspace-path consistency.
`pr-threads.playwright.js` passed five Chrome groups comparing both renderers,
Split/Unified, light/dark, narrower width, reload/file changes, and blocked
external operations (zero page errors or external requests). It also reproduced
and now guards a removed-card scrolling bug: the DOM can lag Monaco's new scroll
offset. The existing adapter now associates measured rows with their rendered
scroll offset, preventing an offscreen Before card from covering an After thread.
The nine Before-layout and five comment-editing groups passed again; 43 targeted
unit tests / 81 assertions, prototype-server typecheck, syntax and whitespace
checks passed. Fresh screenshots were visually checked. No production PR
integration, whole-suite, cross-browser, or publication support is claimed.

## Decision gate

2026-10-05 full-fixture tour follow-up: the earlier toolbar-only label and
programmatic code selection did not reproduce the existing inline stop UX.
The adapter now renders the current phase's Current/Next/other stop cards
immediately before their source, with an objective, explicit side/range and
bounded highlight. Tour navigation scrolls without creating a code quotation;
real selections and comment drafts survive tour updates. Cards use independent
view zones, resize with wrapping, and clear on phase change/exit. In Unified,
a phase containing Before-side anchors deliberately uses the existing renderer;
Split supports these anchors in Monaco. This avoids projecting a Before stop
onto After code while the deleted-fragment tour layout remains unverified.

Tests first reproduced missing inline cards. `tour-browser.mjs` then passed
exact card/source placement, Current/Next state, Split/Unified transitions,
selection independence, phase cleanup, draft retention and exit cleanup in
isolated Chrome. The 14 full-integration groups and standalone independent-file
and comment-editing regressions passed again with no page errors in these runs.
Three new range/phase-order unit tests passed; fresh `bun run verify` passed
644 tests / 4,905 assertions / 76 files. No production merge, release or change
to the user's running review data. Refresh the existing fixture to load the
updated assets (save any in-page draft first).

2026-10-05 comment visibility / tour presentation follow-up:

- The prototype's **Hide comments / Show comments** control covers local cards
  and sample PR threads across files. It removes their view-zone space, while
  retaining comment/question/finding markers and tour banners. Clicking a
  comment marker or editing/adding a comment reveals the cards again. PR-only
  rows also have a reveal marker; a colocated local/PR row shares that lane.
- Visibility is a browser-origin preference, not saved review data. It survives
  file/layout/renderer switches and reload; unavailable storage falls back to
  this page's state. Any open inline draft, including in another file, disables
  hiding. Native-renderer fallback is unchanged and hides the prototype control.
- Local comments use amber borders/tint, sample PR threads blue, and tour stops
  purple. Stop banners now span the entire diff (including both Split columns),
  using source-relative spacers plus a full-width overlay. Source highlighting
  remains on its own revision. Labels say **Updated code · lines 3–5** or
  **Original code**, rather than the ambiguous **After · L3–5**.

Verification: `bun run verify` passed 644 tests / 4,905 assertions / 76 files
(56.60s), including typecheck and production syntax checks. The 14 integration
browser groups passed with zero page errors. `comments-browser.mjs` passed
hide/show, actual removal of vertical space, retained markers, no review
mutation, reload/layout persistence, reveal, draft guards and native fallback.
The standalone `comments-visibility.playwright.js` and
`pr-visibility.playwright.js` passed removed-line reveal in both layouts,
offscreen-draft protection and PR-only marker recovery. Split retains Monaco's
normal alignment spacers; exact deleted-row adjacency is asserted in Unified.
Independent-file, comment-editing and deleted-annotation regressions also passed.
`tour-browser.mjs` additionally checks full-width placement and explicit labels.

Visual checks covered both layouts × both themes × comments shown/hidden
(eight cases), plus 600px banner wrapping; no page errors. Screenshots were
inspected for Split dark, Unified hidden and narrow light. Evidence:
`/tmp/dc-comments-{verify,integration,final,standalone,before-edges-final,pr-edges,visual-final}.log`.
Initial additional harness failures (missing same-origin mutation context,
an over-strict Split adjacency assertion, and reading the host token after it
was removed from the URL) are preserved in their earlier logs; those harnesses
were corrected before rerunning. No new production renderer, commit, merge,
release, or reset of the user's running fixture.

2026-10-05 compact-frame / file identity / gutter follow-up:

- The embedded frame now measures visible file sections and the status footer,
  rather than always reserving a viewport-sized rectangle. Reviewed/manual
  collapse shrinks to the headers; short expanded diffs fit their content.
  Large editors and the overall frame remain viewport-capped. Their limits use
  the outer window, not the auto-sized iframe, to avoid resize feedback loops.
  The collapsed footer remains an accessible offscreen status announcement.
- File headers restore Added/Modified/Deleted/Renamed badges from the existing
  session's Git metadata. Empty source is not used to infer file identity.
  Added-file tour stops say “New file”; deleted-file stops say “Deleted file”.
  Existing-file anchors retain their Original/Updated revision labels.
- Native Monaco margin decorations extend the active source-range highlight
  across its line numbers and review markers, without intercepting clicks.
  A 6px source-relative spacer separates the full-width banner from the range.

`integration-sizing-browser.mjs` reproduced the original 788px frame for
350.5px content, then passed compact sizing, header-only reviewed collapse,
per-file review state, reopening a reviewed file, Split/Unified, composer
growth/shrink, stable frame samples and narrow wrapping. Final measurements
were 337px for the short fixture and 44px collapsed. A temporary 1,800px native
view zone (no source or persisted review edit) verified bounded scrolling:
759px at an 1,100px outer viewport and 509px after resizing it to 850px.
An initial cap assertion incorrectly expected a single editor to fill the
entire frame budget; the corrected check allows its reserved header/tool space.
The earlier failed log remains `/tmp/dc-sizing-final.log`; passing evidence is
`/tmp/dc-sizing-bounded-final.log`.

`tour-browser.mjs` passed full-gutter geometry and hit-testing all three
colocated review controls in both layouts, the 6px gap, Added/Modified headers,
“New file” wording, phase cleanup and existing selection/draft protections.
Fresh `bun run verify`: **645 pass / 0 fail, 4,911 assertions, 76 files**, 64.56s,
with typecheck and syntax checks. All 14 full-product browser groups, comment
visibility, standalone independent-files, reviewed-state and comment-editing
regressions passed with zero page errors. Logs:
`/tmp/dc-compact-{verify,integration,comments,standalone}.log` and
`/tmp/dc-tour-gutter-final.log`. Screenshots of the short and collapsed panels
were inspected. The user's running fixture was not reset; changes remain
uncommitted in `review/diff-viewer-prototype`, with no main/release changes.

2026-10-05 Find references follow-up:

- The custom **Peek symbol** action is now **Find references** in the Monaco
  context menu, Unified removed-row menu, View source and the reused parent
  panel. Shift+F12 runs it in Monaco editors. Internal action/DOM IDs and
  `/api/symbol-peek` stay compatible; there is no new resolver or search API.
- Usages appear first. Definitions remain available in a collapsed secondary
  section. Existing history, suggestions, escaped excerpts, syntax highlighting,
  source controls, loading/error handling and request-generation checks are reused.
- **Possible references — name matches** labels repository-search results;
  index output remains **Indexed reference candidates**. Language-server output
  is labelled **References**. Unknown providers degrade to candidates. Limits,
  provider notices and truncation stay visible; no completeness claim is made.
- The existing resolver searches the **current workspace**, not captured
  revisions. Searches launched from Before explicitly say this is not the
  original revision. All result links now reuse the workspace source viewer at
  the returned line, including changed files and Markdown (source, not preview).
  They must not silently reinterpret workspace coordinates as captured After
  diff lines. Files may still move/change between search and opening.
- Prototype-only TS/JS public provider configuration disables the two native
  references menu entries in favour of the single repository action. This
  deliberately trades loaded-model-only native reference precision for the
  existing repository resolver's coverage/fallbacks. Native Go to Definition,
  Peek Definition and hover remain enabled. Future language-provider integration
  must revisit reference routing; this is not project-wide IDE intelligence.

Tests were added first (missing helper exports reproduced the initial gap).
The focused four tests cover provenance, provider confidence and preservation
of non-reference language settings. Final `bun run verify` exited 0:
**649 pass / 0 fail, 4,927 assertions, 77 files, 56.75s**, plus typecheck and
production syntax checks. Prototype module syntax and diff whitespace checks
also passed. All 14 full-product browser groups passed with zero page errors.
`references-browser.mjs` passed **11 groups with zero page errors**, covering
the real repository resolver, one menu action, Shift+F12, native Go to/Peek
Definition, usages-first/secondary definitions, workspace line navigation,
history, Before scope, truncation, escaping, simulated provider/empty/error/retry
states, late-response suppression, Markdown source, View source, and 390px
overflow. Desktop and settled narrow screenshots were visually checked.
Provider-specific cases are response stubs, not live CodeGraph/LSP validation.

Evidence: `/tmp/dc-references-{verify-final,integration,browser-final2}.log`,
`/tmp/dc-references-{panel,narrow}.png`.
The removed-line regression passed all 11 functional checks but reported a
Monaco word-highlighter disposal `Canceled` page error. A browser-route-only
reconstruction of the pre-change runtime reproduced the same error and passed
the same checks: `/tmp/dc-references-deleted{,-before}.log` and
`/tmp/dc-references-before-check.mjs`. It remains unresolved, not suppressed
or claimed fixed. An earlier focused run also hit it; another had a test-only
attempt to click an already closed mobile drawer. The final check waits for
the drawer transition and retains strict page-error checks. This does not
establish cancellation immunity, mobile drawer stacking or assistive-tech parity.
Only the prototype worktree changed; the user's running fixtures and drafts
were not reset, and no commit, merge, release or dependency change was made.

2026-10-05 file totals / gutter tint / scrollbar follow-up:

- Headers show green `+N` and red `−N` before the Added/Modified/Deleted/Renamed
  badge and path. Counts come from existing Git comparison metadata, not Monaco's
  visual rows (wrapping, empty-file placeholders and context are not additions).
  Missing/invalid totals are omitted rather than invented. Counts remain visible
  on collapsed files and have an accessible description.
- Added/removed line backgrounds now extend through both number columns and
  review-marker space in Unified, and each source-side margin in Split. The
  existing sign adapter projects native rendered source rectangles into margin
  background gradients, behind numbers and tour decorations. No second diff
  algorithm, source anchor, click layer or new source-row mapping was added.
  Native alignment spacers, comment-card gaps and folded gaps are not tinted.
  This uses the line tint, not the stronger word-change highlight; nested Peek
  editors are excluded. Wrapped rows and theme/layout changes are included.
- The full-product iframe matches the native diff's 14px side inset instead of
  touching the outer scrolling pane's edge. The internal file list reserves
  14px at its scrolling edge plus a stable native gutter, keeping file controls
  and the diff out from underneath the browser-level scrollbar. Monaco's own
  editor scrollbar implementation is unchanged.

Five tests were added first and failed before implementation. Final
`bun run verify`: **654 pass / 0 fail, 4,940 assertions, 78 files, 56.12s**,
exit 0, including typecheck and production syntax checks.
`row-presentation-browser.mjs` passed all **15 groups**, zero page errors:
dark/light × Split/Unified × wrap/scroll, totals order, tint geometry,
untinted comment gaps, badge hit targets, no mutation feedback loop, added and
wrapped deleted files, outer/inner browser-scrollbar clearance, 390px overflow,
and an explicit 18px reserved scrollbar with measured 32px outer clearance.
The first harness incorrectly assumed styling scrollbar width alone switched
Chrome out of overlay mode; the final version requests a stable gutter and
checks actual native width. Original/final logs:
`/tmp/dc-row-browser{,-final}.log`; no runtime workaround was added for that
test assumption. Desktop light/dark, Split/Unified and tour screenshots were
visually inspected.

Tour placement/full-gutter highlight/marker tests passed, as did compact sizing,
reviewed header-only collapse, reopening, composer growth, viewport caps and
the existing four-digit number/sign/badge regression. Logs:
`/tmp/dc-row-{verify,tour,sizing,gutter-regression}.log`.
All 14 full-product integration interaction groups passed, but the first strict
run failed on a separate `renderScreenshots` page error: overlapping asynchronous
media renders can remove a `.screenshot-loading` node before a completion/catch
handler writes to it. That code in `public/app.js` is unchanged. One bounded,
unchanged-test rerun passed all 14 groups with zero page errors; the initial
error is retained, not claimed fixed or dismissed as impossible.
Evidence: `/tmp/dc-row-integration{,-rerun}.log`.
The earlier Monaco cancellation limitation also remains.
No production/runtime bundle edits outside the prototype, schema/dependency
changes, user-fixture resets, commits, merges or releases. Changes remain local
to `review/diff-viewer-prototype`.

2026-10-05 Unified tour-gutter / banner-spacing follow-up:

- Corrected the earlier full-gutter test's blind spot: it checked only the
  modified editor's margin, not Unified's external sign lane and original
  line-number column. The regression now fails on that missing prefix before
  the fix (`/tmp/dc-tour-prefix-gutter-red.log`). A separate initial check
  reproduced zero spacing above the banner (`/tmp/dc-tour-prefix-red.log`).
- Unified's current-stop frame now extends to the diff's left edge, including
  both number columns and +/- signs. A pointer-inert, aria-hidden projection
  uses the native rendered tour-margin rectangles, including wrapped rows;
  no original-model decorations, source anchors or second range mapping are
  invented. The old inner left border is removed. Split remains source-sided;
  card gaps and removed-source rows are not painted as After-stop source.
- All stop banners reserve 6px above and 6px below in their native view zones,
  retaining full width, source-relative placement and content-sized file height.
- The idle check exposed a feedback cycle: overlay child-list updates cause
  the existing Before-action accessibility adapter to redecorate native rows.
  Geometry observers now watch only style/class/hidden attributes, not those
  accessibility writes, and unchanged tour projections are not rebuilt.
  Initial evidence: `/tmp/dc-tour-prefix-repaint-debug.log` (30 repaints/500ms,
  one geometry). Final tour check observed zero idle projection repaints.

Final `bun run verify`: **654 pass / 0 fail, 4,940 assertions, 78 files,
58.27s**, exit 0 including typecheck and production syntax. Expanded
`tour-browser.mjs` passed Split/Unified full-edge geometry, border continuity,
added-file stops, resize/wrap, scroll and annotation gaps, colocated marker hits,
selection/draft retention, phase changes and exit cleanup, with zero page errors.
Compact sizing also passed: small diff 343px including the extra gap, reviewed
header 44px, oversized content 759px shrinking to 509px with the viewport.
Logs: `/tmp/dc-tour-prefix-{verify-final,final-idle,sizing}.log`.
Desktop, narrow and wrapped receipt screenshots were visually inspected:
`/tmp/dc-tour-prefix-receipt-{unified,narrow,wrapped}.png`.

The 15-group row presentation regression passed with zero page errors:
`/tmp/dc-tour-prefix-rows-final.log`. Its first run required both change types
while revealing comment-heavy new line 17, which can scroll the only removed
row out of view. The harness now explicitly reveals old line 6; the two-sided
assertion is unchanged. Initial evidence remains `/tmp/dc-tour-prefix-rows.log`.
Syntax and whitespace checks pass. User fixtures and main remain untouched;
no commits/merges/releases. Earlier unrelated browser limitations above remain.

2026-10-05 full-column comment-card follow-up:

- Local comments, quote/edit/new-comment forms and sample PR threads use the
  gutter as well as the code viewport. Split retains each card's source column;
  Unified uses the whole row. Ordinary cards leave Monaco's vertical scrollbar
  lane accessible; removed-row cards retain their existing full-right-edge fit.
- Reused the existing annotation overlay with native source-relative spacer
  zones, existing height observers and the existing Before-row adapter. No
  comment/PR data, anchors, persistence, renderer preference or provider behavior
  changed. Content actually gains width rather than merely painting the gap.
- The overlay uses non-scrolling clipping: browser focus/scroll-into-view must
  not scroll cards separately from source. Card wheel events respect nested
  text/body scrolling, forward to the owning editor, and allow browser chaining
  at its edge. Keyboard focus reveals clipped form controls via the same editor.
  Draft DOM stays mounted through native zone replacement and wrapping.

A browser test first reproduced the missing gutter width in both local/PR cards
(`/tmp/dc-comment-width-red.log`). Final dedicated browser check covers both
layouts, PR/local separation, width/hit targets, narrow resize, wrap, retained
draft/focus and keyboard access to Cancel: `/tmp/dc-comment-width-final-browser.log`.
Separate standalone checks pass editing on both revisions/layouts, failed-save
retry, hide/reveal and offscreen draft protection; removed-row placement, full
width, multiline/wrapped/deleted files, keyboard badges, scroll, redraw focus,
multiple cards, persistence and deletion cleanup:
`/tmp/dc-comment-width-final-before.log`. Full-product tour and compact sizing
checks pass separately: `/tmp/dc-comment-width-{tour-rendered,final-sizing}.log`.
All final browser runs report no page errors. Dark Split/Unified screenshots
were visually inspected (`/tmp/dc-comment-width-{split,unified}.png`).

Intermediate tests caught the independently scrolling overlay (fixed), a
partially clipped textarea that cannot be hovered without revealing it (the
final check exercises keyboard reveal), and native row-render timing. The
visibility test now waits for the actual visible Before row and checks source
column geometry instead of obsolete DOM containment. Tour spacing now compares
rendered row rectangles with rendered banners, not a newer model scroll offset.
Initial evidence is retained in `/tmp/dc-comment-width-{final,scroll,before,final-tour}.log`.

Final `bun run verify`: **654 pass / 0 fail, 4,940 assertions, 78 files,
55.50s**, exit 0 (`/tmp/dc-comment-width-final-verify.log`); syntax and whitespace
checks pass. Work remains uncommitted on `review/diff-viewer-prototype`; no main,
user-fixture state, production bundle, dependency, schema or release changes.
Earlier unrelated browser limitations remain as documented above.

2026-10-05 comment right-edge follow-up:

- The reserved native scrollbar strip now continues each ordinary card's
  computed background and bottom border to the column edge. The card's actual
  width, controls, wrapping, source anchor and vertical slot are unchanged.
  The existing row-gradient helper paints a pointer-inert native-viewport
  pseudo-element below Monaco 0.55.1's scrollbar thumb. It remains visible
  when that thumb fades and clears when its cards are hidden/removed.
- Browser assertions first reproduced the unpainted strip:
  `/tmp/dc-comment-edge-red.log`. Final checks include Split/Unified local and
  PR cards, real pointer dragging of the native thumb, normal scrollbar fade,
  narrow resize/wrap, editing/focus, hide/show paint cleanup and tour geometry,
  with zero page errors. Logs: `/tmp/dc-comment-edge-{fade-browser,tour}.log`.
  Both final faded-scrollbar screenshots were visually inspected:
  `/tmp/dc-comment-width-{split,unified}.png`.
- `bun run verify`: **654 pass / 0 fail, 4,940 assertions, 78 files, 55.38s**,
  exit 0 (`/tmp/dc-comment-edge-verify.log`), plus prototype syntax and whitespace
  checks. Prototype branch only; no user-fixture resets, main writes, new
  dependencies, commits or releases. Previous unrelated limits still apply.

2026-10-05 continuous current-stop right edge:

- The current source range's purple right border now continues through interior
  local-comment and PR-thread zones. It reuses the pointer-inert scrollbar-strip
  layer; no new hit target, source selection, card sizing or anchor mapping.
  The edge uses native source offsets and rendered scroll translation, including
  wrapped rows and intervening zones. It starts below the banner, stops at the
  final source row, and excludes zones appended after that row. The other
  revision is not outlined; tour exit/disposal clears the edge.
- Browser assertions first reproduced the missing border:
  `/tmp/dc-tour-right-red.log`. Final Split/Unified checks cover actual source
  boundaries, narrow/wrapped views, tall interior zones with no visible source
  rows, an excluded after-range zone, draft retention and exit cleanup:
  `/tmp/dc-tour-right-final-browser.log`. Card controls, native pointer scrollbar
  dragging/fade, resize/wrap, editing and hide/show also pass separately:
  `/tmp/dc-tour-right-scrollbar.log`. Both runs report zero page errors; final
  Split/Unified screenshots `/tmp/dc-comment-width-{split,unified}.png` were
  visually inspected. These browser cases use After-side stops; the existing
  native fallback for Before-side stops in Unified is unchanged.
- Intermediate checks caught a start offset including the banner spacer (fixed)
  and test assumptions about repeated wrapped-line decorations and an offscreen
  test zone (corrected to measure rendered geometry). Logs retained under
  `/tmp/dc-tour-right-{green,diagnostic,green2,boundaries}.log`.
- `bun run verify`: **654 pass / 0 fail, 4,940 assertions, 78 files, 54.25s**,
  exit 0 (`/tmp/dc-tour-right-verify.log`), plus prototype syntax/whitespace
  checks. Only the prototype worktree changed, uncommitted. The user fixture's
  review state and main remain untouched; previous unrelated limits still apply.

2026-10-05 file-toolbar actions:

- Reproduced both buttons appearing inert without a selection: View source
  returned early and Copy rejected, reporting only in the distant footer
  (`/tmp/dc-file-tools-{diagnostic,red}.log`). View source now opens the file's
  captured After source immediately, or Before for a deleted file. An existing
  valid selection still chooses its own revision/line. Whole-file source return
  does not invent a review selection; exact selected-source return is retained.
- Copy is explicitly labelled Copy code / Copy line / Copy selection. With no
  selection it copies that file's captured revision, including its saved EOLs;
  a caret copies its line, and a range copies its exact selected text. Mixed,
  invalid or oversized review selections never silently become whole-file
  copies. Each file owns its toolbar state. Copy success/denial is announced
  beside its button, and a denied request remains retryable. No source edits,
  review persistence changes, new dependency or workspace-source lookup.
- New full-fixture browser test `file-tools-browser.mjs` passed all action
  assertions: no-selection opening, real clipboard writes (explicit ephemeral
  Chrome permissions), Split/Unified source/selection return, line/selection
  copying, stubbed clipboard denial and retry. Both strict runs nevertheless
  exit nonzero for two known Monaco word-highlighter disposal `Canceled` page
  errors: `/tmp/dc-file-tools-{green,recheck}.log`. No suppression or all-green
  browser claim. The prior independently reproduced cancellation evidence above
  remains applicable; this follow-up does not fix that lifecycle issue.
- Standalone `file-tools.playwright.js` passed added/deleted/modified files,
  cross-file toolbar ownership, CRLF preservation, invalid-selection refusal
  and temporary model cleanup with no page errors. Existing `deleted` script
  passed all 11 functional groups, including Before source/return and exact
  clipboard text, but retained one `Canceled` page error. Combined evidence:
  `/tmp/dc-file-tools-before-regressions.log`. Final standalone recheck also
  passes without page errors: `/tmp/dc-file-tools-standalone-final.log`.
  Adjacent error feedback screenshot
  `/tmp/dc-file-tools-clipboard-error.png` visually inspected.
- Full verification and final syntax/whitespace evidence are retained at
  `/tmp/dc-file-tools-verify.log` and `/tmp/dc-file-tools-final-verify.log`:
  final `bun run verify` exit 0, **654 pass / 0 fail, 4,940 assertions,
  78 files, 54.72s**. Prototype JS syntax and diff whitespace checks pass.
  Work remains local/uncommitted on the prototype branch; no main edits,
  user-fixture resets, commits, merge, push, install or release.

2026-10-05 rebase and appearance-settings audit:

- Rebasing `review/diff-viewer-prototype` onto fetched `origin/main` at
  `73f9247` (sequence/code walkthrough PR #3) succeeded without conflicts.
  The prototype commit is now `44a282f`; range-diff confirms the same patch.
  All 13 modified tracked files and 37 untracked files were restored exactly
  before this documentation update. Recovery branch:
  `safety/prototype-before-sequence-rebase-20261005`; retained recovery stash:
  `039fcb92d4c79b0a11bd1a21134a2d10c88149eb`. No push, merge or update of the
  separate local main worktree; current prototype edits remain uncommitted.
- Rebased `bun run verify`: **709 pass / 0 fail, 5,586 assertions, 84 files,
  56.58s**, exit 0. All 14 full-app integration groups pass with no page errors.
  A separate smoke check confirms all four sequence excerpts preload, and
  sequence steps 1/2 open captured receipt lines 3/4 in Monaco, then restore
  the exact sequence selection/camera on return. Evidence:
  `/tmp/dc-prototype-rebase-{verify,integration,sequence}.log`. These bounded
  checks do not erase previously documented lifecycle/portability issues.
- Live appearance audit on the fresh rebased fixture:
  `/tmp/dc-prototype-settings-audit.log`, zero page errors. Light/Dark/System
  reaches Monaco, including an emulated OS colour-scheme change. Changed paths
  versus Full repository works; the latter includes unchanged `CONTEXT.md`.
  File tree is intentionally disabled in tour mode, but lacks an explanatory
  title in Settings. Two actual integration gaps remain: Syntax changes leave
  Monaco's palette unchanged, and Show +/− line markers does not hide Monaco's
  projected signs (8 visible in both checkbox states). This was an audit only;
  no settings behavior was modified or claimed fixed.

2026-10-05 context controls and wheel-scrolling follow-up:

- The short full-product files had no foldable unchanged intervals. Controls
  now reflect actual native collapsed-region state: Show all disables when all
  context is visible; Collapse disables when already collapsed or inapplicable,
  with explanatory titles. Native commands, gap arrows and local re-collapse
  remain the existing pinned Monaco implementation.
- `src/context-example.ts` has two real committed edits and three unchanged
  intervals, included alongside cart in phase one. The fixture builder accepts
  optional extra Before/After files, validates their relative paths, and commits
  them normally. Baseline fixture contents and default behavior are unchanged.
- The real wheel reproduction initially left editor, file-list and parent
  positions unchanged. Setting Monaco's construction-time
  `scrollbar.alwaysConsumeMouseWheel` to false lets native scrolling continue
  outward at an edge, including View source. No synthetic wheel forwarding or
  scroll interception was introduced.
- Final `bun run verify`: **712 pass / 0 fail, 5,607 assertions, 84 files,
  55.92s**, exit 0 (`/tmp/dc-context-final-verify.log`). Context expansion/local
  collapse/all-context controls and real wheel input pass in Split and Unified;
  short diffs/source also hand off scrolling, with zero page errors
  (`/tmp/dc-context-scroll-final-browser.log`). Full integration: 14 groups,
  zero page errors (`/tmp/dc-context-integration-browser.log`). Standalone
  centred-gap controls pass. The bottom alignment test first timed out because
  its PR-card prerequisite was absent from the chosen fixture; a separate new
  PR fixture passes all five checks with zero errors
  (`/tmp/dc-context-pr-bottom-scroll.log`). Original logs are retained.
- Fresh user fixture: port 47666; test fixtures 47665/47667. Earlier user
  fixtures remain intact. Changes stay uncommitted on the isolated prototype
  branch, HEAD `44a282f`; no main/commit/push/release change. Appearance audit
  gaps and other previously documented limitations are not claimed fixed.

2026-10-05 context-action visibility refinement:

- Supersedes the disabled-button presentation above: unavailable context
  actions are now hidden, including during initial loading. Partially expanded
  files show both actions; short files show neither. The toolbar retains a
  31px minimum height even when narrow layouts hide the helper text.
- Tests first reproduced the old visible-disabled state. All five scoped
  browser groups now pass, with zero page errors, covering Split/Unified,
  partial/full/local expansion, keyboard focus, stable desktop/narrow toolbar
  height, and wheel handoff (`/tmp/dc-context-visibility-browser.log`). The
  11 annotation tests / 31 assertions, JS syntax and whitespace checks pass.
  The full-suite result above predates this presentation-only refinement.
- Reload the existing port-47666 fixture to see it; no fixture review state,
  main branch, commit, dependencies or release changed.

2026-10-05 flat Maps navigation:

- Application navigation on this review branch now groups maps by subject,
  not by renderer success. No second sequence entry remains under Understand.
  Existing native call flows, blast-radius evidence, fallback diagrams,
  source navigation and map renderer remain in use. The static export heading
  also says Blast radius; export structure and saved schema are unchanged.
- Interactive frames mount on first category visit and retain their cameras
  across peer switches. Previously visited frames still revalidate on review
  changes while hidden. Sequence source return now targets the Sequence view.
- A delayed Monaco mount exposed a separate preview-host startup race: its
  ready callback always focused the current diff stop. It now focuses only
  when the reviewer is still on Diff. A deterministic delayed-mount browser
  regression covers two normal startups plus a failed-session/recovery case.
- Final `bun run verify`: **717 pass / 0 fail, 5,644 assertions, 85 files,
  56.25s**, exit 0 (`/tmp/dc-map-navigation-final-tree-verify.log`). Initial
  full verification exposed three old call-flow category expectations, updated
  without changing their completeness checks. Earlier evidence is retained.
- Five Maps browser groups pass with zero page errors, including actual
  390px pointer navigation, picker bounds, independent categories, preserved
  iframe/camera/selection, Monaco source/return, and fallback-only rendering
  with category-scoped failure diagnostics. Logs:
  `/tmp/dc-map-navigation-responsive-browser.log` and
  `/tmp/dc-map-navigation-startup-final-browser.log`. Existing combined-product
  browser checks also pass all 14 groups with zero page errors
  (`/tmp/dc-map-navigation-integration-browser.log`). Desktop/narrow screenshots
  `/tmp/dc-map-navigation-{desktop,narrow}.png` were visually inspected.
- New user preview is port 47669; disposable test preview is 47668. Earlier
  user fixtures and their saved review state remain intact. Uncommitted on
  `review/diff-viewer-prototype`, HEAD `44a282f`; no main/merge/push/release.
  Previous settings, renderer-seam and cross-platform limitations remain.

2026-10-05 branching state-machine fixture:

- The full-product fixture now captures a real before/after change in
  `src/receipt-job.ts`: Pending → Formatting, success → Ready, failure → Failed,
  retry → Formatting, and cancellation → Cancelled. Ready and Cancelled are
  terminal; unsupported events leave the state unchanged. This is an explicitly
  synthetic standalone controller, not a runtime trace of `receipt()`.
- Maps → Data & lifecycle includes **Receipt job: retry or cancel** as a native
  Mermaid state-machine card, alongside the existing interactive data model.
  The fixture replaces the old linear receipt lifecycle and removes its stale
  pre-rendered artifact/diagnostic. Production renderer selection is unchanged.
  Existing tour steps, saved sequence excerpts and other map artifacts remain.
- Tests execute all 25 state/event combinations, compare every diagram arrow
  with the code, validate the saved diagram, round-trip persistence, and verify
  both captured source trees. `bun run verify`: **719 pass / 0 fail, 5,681
  assertions, 86 files**, exit 0 (`/tmp/dc-state-machine-verify.log`). Four new
  browser groups and the five existing Maps groups pass with zero page errors
  (`/tmp/dc-state-machine-browser.log`, `/tmp/dc-state-machine-maps-browser.log`).
  The new checks cover native/interactive coexistence, evidence, move/zoom/reset,
  expansion, Monaco source navigation, and 390px reachability.
- Suggested edits remain a confirmed parity gap: Monaco is read-only, lacks
  the native replacement-draft → proposal preview → Apply/Reject/Undo adapter,
  and this harness blocks edit/activity mutation routes. Making its text model
  writable alone would not restore that workflow or its stale-content guards.
  The regeneration button is unchanged pending the product decision; it retries
  agent generation, not rendering, and generation remains blocked in the fixture.
- A fresh user fixture is served on port 47671; earlier user fixtures and their
  review state are untouched. All work remains isolated and uncommitted.

2026-10-05 failure-only Retry, full-file copy and mixed diagram picker:

- Sequence diagrams no longer offer an always-visible regeneration button or
  per-card Regenerate action. **Retry** appears only for a saved sequence-render
  failure or a failed native sequence render. It is disabled while retrying,
  remains after failure and disappears on success. Empty results are not errors.
  Native retries rerender saved Mermaid locally. Authenticated
  `POST /api/diagrams/retry` with `{type:"sequence"}` retries only failed saved
  sequence artifacts, preserves last-valid and unrelated artifacts, checks the
  comparison/revision before committing results, and never invokes the agent.
  Call-flow generation controls and initial tour generation are unchanged.
- The file-toolbar button is always **Copy contents** and copies the entire
  captured file for the anchored side (otherwise After, or Before for deleted
  files), including original EOLs. Selections/carets never narrow that action;
  oversized selections do not block it. Native Cmd/Ctrl+C still copies selected
  text. View source, comment and question range validation are unchanged.
- The Data & lifecycle picker now includes native fallbacks alongside interactive
  diagrams and renders only the selected diagram. The branching receipt state
  machine is labelled **State machine (fallback)**, rather than stacked beneath
  the data-flow diagram. Its original transitions and source evidence remain.
  A direct conversion attempt with the installed interactive renderer failed
  collision validation. Matching the interactive style needs a lifecycle layout
  fix; no states/edges were removed and no failed rendering was published.
- Full verification: **726 pass / 0 fail, 5,728 assertions, 87 files**, exit 0
  (`/tmp/dc-retry-picker-final-verify.log`). An initial run exposed one obsolete
  expectation suggesting regeneration when saved file evidence is absent; that
  expectation and the unhelpful hint were removed together.
- Retry browser checks pass three groups with zero page errors and zero agent
  generation requests (`/tmp/dc-diagram-retry-browser.log`). State-picker checks
  pass four groups (`/tmp/dc-state-picker-browser.log`); existing Maps checks
  pass five (`/tmp/dc-retry-picker-maps-browser.log`), both zero page errors.
  Standalone full-file tests pass for added/deleted/modified and Before files,
  oversized selections, EOLs and file ownership (`/tmp/dc-copy-contents-standalone.log`).
  All four full-product copy/source/keyboard/clipboard-denial groups pass, but
  both runs retain the previously observed Monaco source-editor disposal
  `Canceled` page errors. They are not filtered or claimed fixed:
  `/tmp/dc-copy-contents-browser.log`, `/tmp/dc-copy-contents-browser-recheck.log`.
- Suggested edits are still not implemented in Monaco. The intended next adapter
  is an explicit After-side line/range **Suggest edit** draft using the existing
  proposal preview and Apply/Reject/Undo pipeline, with stale-source guards. The
  reviewed model should remain read-only; this change does not enable edits.
- Fresh user fixture: port 47673; test fixture: 47672. Earlier fixtures, main,
  commits, publishing and release state are unchanged. Work is uncommitted.

2026-10-05 copy feedback, tour scrolling and diagram labels:

- Successful **Copy contents** feedback clears after two seconds, including its
  shared footer announcement. Repeated copying restarts the timer; timers are
  file-scoped and cannot clear a newer message. Clipboard failures remain visible
  and retryable. Selection changes and editor disposal clear pending feedback.
- Previous/Next and Return to current stop now reveal the target file in the
  outer file list as well as its banner/code in Monaco. Navigation reopens a
  collapsed target; ordinary snapshot sync does not scroll or change selection.
- The main **Maps** tab is now **Diagrams**; **Understand the change** is now
  **Architecture & design**, including its heading and accessible navigation.
  Internal view IDs, saved selections and category behavior are unchanged.
- Tests first reproduced persistent copy feedback and offscreen tour targets.
  Four copy-feedback browser groups and four tour-scroll groups pass; the
  existing tour annotation suite and five diagram-navigation groups also pass,
  including 390px navigation. These runs report zero page errors. Logs:
  `/tmp/dc-copy-feedback-{red,green}.log`, `/tmp/dc-tour-scroll-{red,green}.log`,
  `/tmp/dc-tour-scroll-regression.log`, `/tmp/dc-diagram-label-browser.log`.
  Full verification: 728 pass, 7 renderer-gated skips, 0 fail, 5,745 assertions
  (`/tmp/dc-copy-tour-label-verify.log`). The lifecycle agent's concurrent tests
  account for the renderer-gated skips; its layout work remains separately owned.
- Fresh user fixture: port 47677. Test fixtures: 47675 (tour navigation) and
  47676 (fresh application bundle/diagram navigation). Earlier user fixtures and
  saved review state are untouched. Still uncommitted at HEAD `44a282f`.
  Suggested edits, settings parity and the known View source disposal error
  remain outside this change.

2026-10-06 stable tour navigation and smooth scrolling:

- Tour-only revision changes no longer rebuild unchanged per-file comments,
  PR threads, badges or their measured Monaco zones. Changing the current stop
  updates existing banners/decorations in place; structural stop changes still
  rebuild their zones. Composer close explicitly invalidates the saved-card
  presentation, so edit/save/cancel and real annotation updates still work.
- Offscreen source cards remain measurable at their actual column width while
  visually hidden and non-interactive. Their first reveal no longer resizes
  comment zones during a scroll. Current/next banners use equal border widths.
- Previous/Next smoothly scroll Monaco, the file list and the outer host without
  competing ancestor scrollIntoView calls. Reduced-motion preference uses
  immediate movement. Already expanded files do not get redundant layout calls.
- A new frame-by-frame browser test first reproduced replaced cards and a
  56px height jump. Six final motion checks pass in Split/Unified, including
  stable node/model identities and content height, actual intermediate scroll
  positions, rapid reversal and reduced motion (`/tmp/dc-tour-motion-green.log`).
  Four target-scroll checks, the existing tour geometry/draft suite, all 14
  integration workflow groups, and comment visibility/editing checks pass with
  zero page errors (`/tmp/dc-tour-motion-{scroll-regression,tour-regression,
  integration,comments}.log`). Screenshot `/tmp/dc-tour-motion.png` inspected.
- Full verification: 728 pass, 7 renderer-gated skips, 0 fail, 5,745 assertions
  (`/tmp/dc-tour-motion-final-verify.log`). No production renderer migration or
  lifecycle-layout ownership change. Refresh the existing user fixture on
  port 47677; its review state is unchanged. Tests used only disposable fixtures
  47675/47676. Work remains uncommitted on `review/diff-viewer-prototype`.

2026-10-06 all-text full-product fixture:

- All eight captured text files now have Monaco diffs, including `README.md`,
  `docs/checkout-guide.md` and the added `docs/preview.md`. Unknown text formats
  use plaintext; media remains a dedicated preview. Immutable captured-tree,
  authentication, regular-file, binary and size checks are retained.
- Every fixture tour stop stays in the same Monaco file list. Moving from the
  receipt to the reviewed README reopens its card without changing its reviewed
  state, recreating editors or triggering the previous whole-view fallback.
  Newly visible phase editors are laid out before scrolling; the outer smooth
  reveal waits for two stable geometry frames (bounded to 12). New navigation,
  tour exit and manual iframe interaction cancel stale pending reveals.
- Markdown has a local **Preview** / **Back to diff** view using the existing
  escaped Markdown renderer and captured content. Before/After changed blocks,
  inline changes, tables, lists and code fences are retained. Added/deleted
  sides come from Git status. Short previews fit their content; narrow previews
  stack. Diff models, selections and review anchors survive preview/return.
  Preview cannot hide an unfinished comment draft; touring back reveals code.
- Rapid source open/close reproduced the previously noted Monaco `Canceled`
  errors. The cause is 0.55.1's occurrence-highlighter Delayer rejecting during
  disposal. The transient read-only source inspector now opts out of automatic
  occurrence highlighting; persistent diff highlighting, folding and explicit
  reference/navigation actions remain. No dependency edits or error suppression.
  Repeated same-tick open/close tests verify no editor/model leak or page errors.
- Contract tests first failed for Markdown/extensionless text and now pass.
  Browser checks pass 11 Markdown groups in light and dark themes, including
  actual onscreen tour targets, draft protection, persisted comments, per-file
  review state, captured copy/source, safe rendering and image navigation.
  Existing 14 integration groups, six motion checks, four target-scroll checks
  and four copy/source groups pass with zero page errors. Logs:
  `/tmp/dc-monaco-markdown-{browser-final,dark}.log`,
  `/tmp/dc-monaco-all-text-{integration-final,motion-final,scroll-final,
  source-regression}.log`. Desktop/narrow screenshots inspected.
- Final verification: **729 pass, 7 renderer-gated skips, 0 fail, 5,751
  assertions, 87 files** (`/tmp/dc-monaco-all-text-complete-verify.log`).
  Fresh user fixture: port **47679**; mutating tests used disposable 47678 and
  older test fixture 47675. Existing user fixtures/review state are untouched.
  Branch remains `review/diff-viewer-prototype`, uncommitted at `44a282f`.
- This ports fixture text coverage, not the production renderer. Suggested edits,
  syntax/line-marker setting parity, workspace/proposal integration and the
  Unified Before-stop fallback still need production decisions and validation.
  Nothing was merged, published or installed; lifecycle layout remains separately
  owned. The transient-source cancellation mitigation supersedes the earlier
  unresolved-error notes above.

This is useful for comparing unchanged-context UX and annotation feasibility.
It is **not replacement-ready**. Unified Before actions are implemented in this
lab, with a version-sensitive seam that still needs a production maintenance
decision. Unified Before cards and badges are now implemented in the lab.
Hidden-annotation indicators and full-context review validation remain gaps. Structural scope folding is no
longer a requirement. The inventory above remains the production integration
checklist; this change does not complete a renderer migration.

Any production adapter needs immutable comparison identity plus old/new paths
and contents; `reveal(anchor)`, `captureSelection()`, annotation and source-return
hooks; and model disposal. Consumers must stop depending on HTML `.diff-row`
selectors. Share fold choices only when comparison/file/region identities match;
keep viewport/selection surface-local for future sequence cards.

### Context-menu stacking regression (2026-10-06)

- Per-file editor isolation trapped native context menus beneath the next file's
  sticky heading, toolbar and code. Diff editors and transient source inspectors
  now use Monaco's public `overflowWidgetsDomNode`/`fixedOverflowWidgets` options
  with zero-size document-level hosts. Review decoration isolation is unchanged;
  each overflow host is removed with its owning editor.
- `context-menu-browser.mjs` checks real hit targets across the next file, native
  pointer actions, Escape focus, Before-side source identity and inspector-layer
  cleanup in Split/Unified. Passed in light and dark Chrome with no page errors;
  disabling the overflow-host option in a browser-only negative control restores
  the original occlusion. Screenshots: `/tmp/dc-context-menu-{split,unified}-{dark,light}.png`.
- Existing references/definition-navigation browser checks also passed. Prototype
  unit tests: 76 passed, one renderer-gated lifecycle skip, no failures. JavaScript
  syntax checks passed. Tests used disposable port 47678, not the user's fixture.
- Mobile browser support remains a separate upstream limitation, not the cause
  of this stacking bug. These desktop checks do not qualify touch interactions.

### Lifecycle pointer verification (2026-10-06)

- The missed iframe clicks were reproduced in Chrome **154.0.8037.98** with
  Playwright **1.63.0**, including a plain sandboxed iframe containing one button
  and no DiffCompass/Archify code. Playwright resized the headless outer window
  to the emulated viewport dimensions. Chrome's actual content area was shorter
  (963px for a 1050px outer window); some clicks reached only the parent iframe
  element. Resizing the native headless window did not show that dead region.
- The browser-only `archify-browser-viewport.mjs` helper now sets Chrome's content
  size as well as Playwright's emulated viewport. The functional check also waits
  for two child-frame paint opportunities after automated scrolling before
  clicking. No runtime, renderer package, dependency, sandbox, or input-handler
  workaround was added.
- `state-machine-pointer-browser.mjs` uses actual mouse input and asserts trusted
  click delivery. Its independent plain-button control and lifecycle checks pass
  at 1500px and 390px, covering node inspection, zoom/Fit, canvas dragging,
  repeated inline/expanded resizing, close, and retained iframe identity.
  `state-machine-browser.mjs` now exercises pointer controls plus explicit
  keyboard selection, source → Back to diagram, centered headings, collision
  geometry, and the browser-local Mermaid failure fallback. The full functional
  flow passed three consecutive runs; all passing browser runs had zero page
  errors. These are headless Chrome checks, not Safari/Firefox or touch coverage.
- Focused lifecycle/rendering/camera/presentation/source-return tests: **58 pass,
  0 fail, 455 assertions**. Syntax and whitespace checks pass. Logs:
  `/tmp/dc-lifecycle-pointer-regression.log`,
  `/tmp/dc-lifecycle-pointer-functional-{1,2,3}.log`, and
  `/tmp/dc-lifecycle-pointer-focused.log`. The explicit uncorrected-viewport
  negative control fails on the plain iframe as expected, recorded in
  `/tmp/dc-lifecycle-pointer-negative.log`.

Run against a **new disposable** full integration fixture with Archify enabled,
using an already installed Playwright module:

```sh
node prototypes/diff-viewer/state-machine-pointer-browser.mjs /absolute/path/to/playwright/index.mjs 'http://127.0.0.1:PORT/#token=TOKEN'
node prototypes/diff-viewer/state-machine-browser.mjs /absolute/path/to/playwright/index.mjs 'http://127.0.0.1:PORT/#token=TOKEN'
# Diagnostic negative control: expected to exit nonzero on the affected setup.
DIAGRAM_RAW_VIEWPORT=1 node prototypes/diff-viewer/state-machine-pointer-browser.mjs /absolute/path/to/playwright/index.mjs 'http://127.0.0.1:PORT/#token=TOKEN'
```
