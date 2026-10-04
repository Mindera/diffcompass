# DiffCompass feature inventory and research

Inventory started 2026-10-03; delivery and documentation audit updated
2026-10-04. This preserves the earlier shared-worktree evidence and records the
subsequent isolated-branch review separately from the published baseline. The
[roadmap](ROADMAP.md) is the delivery-status index and the
[README](README.md#capabilities) describes user entry points. A code symbol,
passing test, local commit and published release are different kinds of evidence.

## Current review topology: isolated branches (2026-10-04)

This update supersedes the earlier all-uncommitted/shared-worktree status below.
The preserved descriptions, peer checks and **all 65 peer plus 17 documentation
assumptions** remain historical evidence; their commit/workflow statements refer
to the original handoffs. They do not authorize using the frozen snapshot as a
merge candidate. [Review branches](REVIEW_BRANCHES.md) is the short reviewer
entry point, not a second feature roadmap.

- Local `main` remains `716edb8` in the clean checkout
  `/Users/ricardo.costeira/.herdr/worktrees/diffcompass/main`.
- The original `/Users/ricardo.costeira/Documents/diffcompass` checkout is frozen
  on `wip/research-snapshot-20261004` at `39206b4`. It preserves the combined
  evidence and running fixtures; **do not edit or merge it**.
- `review/pre-research-fixes` at `8262d97` is the **unreviewed** common base. It
  contains only the earlier map preferences/tooltips/motion, native Call-flow
  consolidation, impact repair and final-commentary fixes beyond `716edb8`.
- `review/sequence-code`, `review/decision-log` and `review/syntax-diff` are
  mutually independent feature review branches sharing only that base. No
  feature branch imports another research feature. **Baseline compatibility
  caveat:** the optional-`guidedViews` `isPlaying`/`pause` guard lives in
  sequence/code, not in the earlier map-motion-on baseline. Before merging that
  baseline without sequence/code, review/extract the guard separately for
  bundled zero-guided-view maps; earlier browser work observed an exception.
  The baseline's 581 passing tests do not establish browser safety.
- `review/research-docs` contains these four extracted documents and the new
  reviewer entry point; it does not contain the three feature implementations.
  `review/diff-viewer-prototype` separately owns the viewer/language experiments.
  No production Monaco migration is approved; scope-folding arrows remain
  dropped and inline unchanged-region controls retained.
- Worktrees are under `/Users/ricardo.costeira/.herdr/worktrees/diffcompass/`,
  with suffixes `pre-research-fixes`, `sequence-code`, `decision-log`,
  `syntax-diff`, `research-docs` and `diff-viewer-prototype`. Each agent writes
  only its own worktree. No push, merge, release or DiffCompass installation is
  part of this review preparation.

### Snapshot and extraction provenance

The coordinator reports archive
`/tmp/diffcompass-isolation-20261004.JeXYQv/worktree-before-separation.tar.gz`,
SHA256 `e0e6375f9b9d68e434630f86b01216d879c34af8282583f82f47387f738e084b`.
It contains 240 tracked/untracked entries including browser captures; ignored
dependencies remain in place. The documentation agent has not independently
rehash-verified this archive. The snapshot commit is `39206b4`; it is a recovery
and evidence artifact, not a proposed integration branch.

Before reconciliation, the documentation agent compared all four extracted
files byte-for-byte with `39206b4`: `README.md`, `ROADMAP.md`,
`docs/product-roadmap.md` and `RESEARCH.md` matched exactly. Extraction and narrow
edits used `apply_patch` only in the dedicated docs worktree. Runtime files,
other worktrees and the frozen root were not modified.

The coordinator's `/tmp/diffcompass-isolation-20261004.JeXYQv/extraction-audit.json`
confirms all four feature/prototype commits have parent `8262d97`, with **69
single-owner files byte-identical to the snapshot** and no missing/extra non-doc
paths. The documentation agent read this audit, not a new independent runtime
audit. `public/app.js`, `src/export.ts`, `src/server.ts` and `src/session.ts`
contain shared integration edits and require integration review. Isolated
extraction does not promise conflict-free merging or a verified combined result.

### Branch-isolated verification ledger

These independently reported branch results are separate from the earlier
combined 668-test pass and the original peer checks later in this document. Passing
checks establish only the tested branch/fixtures, **not merge approval**.

| Branch | Independent verification currently reported | Remaining status |
| --- | --- | --- |
| `review/pre-research-fixes` (`8262d97`) | `bun run verify` exit 0: 581 passed, 0 failed, 4,760 assertions, 68 files, 55.39s. | Base still unreviewed. Log `baseline-verify.log` in the evidence directory below. |
| `review/diff-viewer-prototype` (`2676dea`) | `bun run verify` exit 0: 618 passed, 0 failed, 4,821 assertions, 71 files, 56.55s. | Exact 31-file extraction from `39206b4`, all under `prototypes/`; no runtime changes. Fresh browser run exit 1: smoke, quotes and gutter passed; badges timed out. **Review blocker remains.** |
| `review/decision-log` (`d5b8bd3`) | Independent verify: 597 passed, 0 failed, 4,873 assertions, 69 files; 18 isolated Chrome checks passed, zero page errors. | Coordinator inspected logs/shared hunks: 12 scoped files, no foreign feature imports; accepted for extraction only, not merge approval. |
| `review/sequence-code` (`0d22cbe`) | Independent `bun run verify`: 594 passed, 0 failed, 4,844 assertions, 69 files; 8 interaction groups and 4/4 framing scenarios passed. | 15 sequence-only files, 8 dedicated files exact to snapshot. App pointer recheck 15/16, plain iframe 14/16; first setup timeout plus null-`outline` page error retained. Genuine hidden-tab behavior unverified. |
| `review/syntax-diff` (`886e173`) | Independent `bun run verify`: 602 passed, 0 failed, 4,958 assertions, 71 files, 60.58s; 11/11 Chrome checks and outside-checkout compiled TS/TSX/Kotlin smoke passed. | 22 semantic-only files: 18 exact snapshot files and 4 narrow integrations. Kotlin grammar, platform/accessibility and cache/export limits retained. |
| `review/research-docs` | Four-file extraction matched `39206b4`; original 65 peer + 17 audit assumptions preserved verbatim; full isolated handoffs reconciled. | Documentation only. Local link/whitespace and preservation checks are recorded below; no runtime/browser rerun or merge approval. |

Evidence directory: `/tmp/diffcompass-isolation-20261004.JeXYQv/`.
No new runtime suite or browser check is attributed to the documentation agent.
The historical **668/0** combined pass does not validate branch isolation,
resolve browser gaps or justify merging `39206b4`.

**Documentation checks on this isolated branch:**
`python3 /tmp/diffcompass-docs-isolation-checks.py` passed: exactly the five owned
documentation files changed; all **43 local links/anchors** resolve; whitespace
is clean; all original 65 peer + 17 audit assumptions match `39206b4` verbatim;
isolated sequence 18/18, semantic 32/32 and decision-log clarifications A–F match
their handoffs verbatim; all 11 documentation isolation decisions are present.
The four feature/prototype commit IDs and common parents match local Git refs;
main and safety-snapshot refs remain unchanged. `git diff --check` passed.
Log: `/tmp/diffcompass-docs-isolation-checks.log`. These are documentation checks,
not a runtime suite, browser test, external-link recheck or merge approval.

**Prototype browser blocker:** the fresh four-script Chrome run on fixture 47640
exited 1. `smoke.playwright.js`, `quotes.playwright.js` and `gutter.playwright.js`
passed; `badges.playwright.js` waited 30 seconds for keyboard activation to show
“Selected-code conversations” and timed out. The 31 source files are byte-identical
to `39206b4`, so this is not an extraction change. A focused keyboard diagnostic
and settled retry passed, but the cause/intermittency remains unresolved: no
source workaround or clean browser-pass claim. Logs in the evidence directory:
`prototype-verify.log`, `prototype-browser.log` and
`prototype-badge-diagnostic.log`; capture `prototype-browser.png`. Commit
`2676dea` has parent `8262d97`. These facts are coordinator-reported, not a new
documentation-agent browser run.

### Isolated decision-log final handoff

Peer handoff `/tmp/diffcompass-decision-log-isolation/handoff.txt` records
`d5b8bd3d979109b17f80a5771d01079219e58683`, parent `8262d97`, on
`review/decision-log`, with a clean worktree. Five topic files are exact snapshot
copies: `src/decision-log.ts`, `public/decision-log.js`, `public/decision-log.css`,
`tests/decision-log.test.ts`, `scripts/check-decision-log-browser.mjs`. Seven
shared files contain only decision-log integrations: `public/app.js`,
`public/index.html`, `src/export.ts`, `src/server.ts`, `src/session.ts`,
`src/store.ts`, `src/types.ts`. Total 12 files, 824 insertions, 3 deletions; no
other research feature or product improvement. No new production dependency;
manifest/lock unchanged. Original entry points, session/source/navigation/export
helpers, persistence and all 17 product assumptions remain unchanged below.

The documentation agent read this report. The coordinator separately inspected
logs and shared hunks and accepted extraction only. Peer commands ran in the
exclusive worktree on the exact subsequently committed content; logs show the
pre-commit base HEAD and `commit.log` identifies the final extraction.

- `bun install --frozen-lockfile --ignore-scripts`: 164 baseline packages,
  manifest/lock unchanged (`install.log`).
- `bun run verify`: approved local-listen run, typecheck, **597 passed / 0 failed /
  4,873 assertions / 69 files**, configured syntax checks (`verify.log`). No socket
  failure/subset rerun was needed for this isolated run; the earlier shared-tree
  socket failures remain historical evidence.
- `node --check public/decision-log.js`,
  `node --check scripts/check-decision-log-browser.mjs`, `git diff --check`,
  `git diff --cached --check`: passed.
- `node /tmp/diffcompass-decision-log-isolation/browser-check.mjs /Users/ricardo.costeira/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs /tmp/diffcompass-decision-log-fixture-isolated-20261004/session.json`:
  **18 checks passed, zero page errors**, fresh ephemeral Chrome (`browser.log`).
  Coverage includes empty/create/correct/remove, keyboard/cancel/focus, source
  navigation, reload/disk/other-client persistence, retained/replaced evidence,
  escaping, failed-network draft/Retry, refresh/deleted evidence, MD/offline HTML
  and 390px bounds. **Click-time freshness race is simulated**; comparison
  refresh and source edits/deletion use real fixture APIs.

All logs above are under `/tmp/diffcompass-decision-log-isolation/`, with
`identity.log`, `fixture.log`, `commit.log`, `mobile.png` and `export.html`.
Fresh fixture command:
`bun run scripts/test-fixture.ts --fixture-root /tmp/diffcompass-decision-log-fixture-isolated-20261004 --port 47652`.
Port 47652 remains running with exercised QA state; old 47632 was untouched.
The token remains in the local handoff, not this repository document. Committed
browser defaults still use 47632; the temporary execution harness changes only
origin to 47652 and artifact destinations, with unchanged assertions/behavior.

#### All isolated decision-log process clarifications

The original 17 product assumptions remain verbatim. These six peer process
clarifications supersede only the earlier execution/verification statements:

A. Exclusive branch/worktree isolation replaces the former shared dirty worktree
   and mutex process. The frozen root is not an implementation destination.
B. The user explicitly authorized this extraction commit on review/decision-log.
   That supersedes the former no-commit restriction for this commit only; no push,
   merge, release, or DiffCompass installation was authorized or performed.
C. New topic files remain exact snapshot copies. The browser script in the commit
   still defaults to port 47632. Its uncommitted /tmp execution copy changes only
   the origin to 47652 and export/screenshot destinations to the isolation log
   directory; no browser assertion or feature behavior was changed.
D. Verification applies independently to common base 8262d97 plus this feature,
   not the combined snapshot or other feature branches. The smaller test count
   reflects excluded peer features, not skipped failures.
E. The running fixture contains the exercised QA state: the browser checks edit
   and delete sample evidence, refresh a fixture-only file, and remove their
   decision at completion. It is not a pristine demonstration snapshot.
F. Handoff, logs, screenshot, and temporary browser harness live under /tmp and
   are transient evidence. Production code and the original test script are
   durable in commit d5b8bd3.

### Isolated sequence/code final handoff

Peer handoff `/tmp/dc-sequence-isolated-review.md` records commit
`0d22cbece560eebdec63c944971b73aa784b05ed`, parent `8262d97`, on
`review/sequence-code`. The documentation agent read it and verified the commit
and parent locally. All eight dedicated files match `39206b4`; seven shared
files contain only sequence hunks, for 15 files total (998 insertions, 22
deletions). No product improvement, new dependency or other research feature
was introduced during extraction. The peer reports a clean committed worktree.

Entry/reuse/persistence/provenance remain as described in the historical handoff:
Maps → existing sequence artifact → Code steps, stable authored IR IDs, captured
old/new quotes, explicit current-workspace candidates, existing source/return
and camera routes, a read-only preview host and offline HTML excerpts. The
optional-guidedViews guard stays in this branch, with the baseline caveat above.

Exact changed files: `public/app.js`, `public/sequence-walkthrough-host.js`,
`public/sequence-walkthrough.css`, `public/sequence-walkthrough.js`,
`public/styles.css`, `scripts/sequence-framing-browser.mjs`,
`scripts/sequence-pointer-browser.mjs`, `scripts/sequence-walkthrough-browser.mjs`,
`src/archify-embed.ts`, `src/export.ts`, `src/sequence-source-embed.ts`,
`src/sequence-walkthrough.ts`, `src/server.ts`, `tests/sequence-sources.test.ts`,
`tests/sequence-walkthrough.test.ts`. Manifest/lockfile unchanged.

The peer's branch checks used its exclusive worktree and the exact subsequently
committed content. Logs identify the pre-commit base HEAD plus extracted changes;
that label does not imply checks ran on an empty base.

- `bun install --frozen-lockfile --ignore-scripts`: 164 baseline packages;
  manifest/lock unchanged. Log `/tmp/dc-sequence-isolated-install.log`.
- `bun run verify`: exit 0, typecheck, **594/0**, **4,844 assertions / 69 files**,
  and required theme/app/diagram-label syntax checks.
  `/tmp/dc-sequence-isolated-verify.log`.
- Additional `node --check` for walkthrough runtime/host and all three browser
  scripts, `git diff --check` and staged diff check passed.
- `scripts/sequence-walkthrough-browser.mjs`: **8 groups passed, zero page
  errors**, including real arrow/wheel/keyboard, same-frame source/Present return,
  current-source lookup Retry, motion/reduced motion, simulated visibility,
  responsive pane and ordinary offline pointer/repeated-heading activation.
  `/tmp/dc-sequence-isolated-browser.log`.
- `scripts/sequence-framing-browser.mjs`: **4/4** fresh desktop 1440×1000 / narrow
  600×900 × workspace/Present; readable initial captions, stacking, bounds,
  unchanged SVG/viewBox, explicit Fit and camera invariance.
  `/tmp/dc-sequence-isolated-framing.log` and
  `/tmp/dc-sequence-isolated-evidence/sequence-framing-results.json`.
- `scripts/sequence-pointer-browser.mjs`: first attempt **14 delivered clicks,
  1 known routing failure, 1 setup timeout before artifact selection**. The
  coordinator inspected the raw matrix: the setup-timeout case also records
  page error `Cannot read properties of null (reading outline)`, before artifact
  selection. Its cause is undiagnosed; the later rerun does not erase it.
  `/tmp/dc-sequence-isolated-pointer.log` and top-level evidence JSON preserve
  that run. A sequential recheck completed **15/16**, with the desktop Present
  after-resize failure retained; all headed and camera-invariance checks passed.
  `/tmp/dc-sequence-isolated-pointer-recheck.log` and
  `/tmp/dc-sequence-isolated-evidence/pointer-recheck/sequence-pointer-results.json`.
- With `SEQUENCE_POINTER_PLAIN=1`: **14/16**, desktop/narrow resized-Present
  failures; all headed/fresh/normal cases passed.
  `/tmp/dc-sequence-isolated-pointer-plain.log` and
  `/tmp/dc-sequence-isolated-evidence/sequence-pointer-plain-results.json`.

The plain reproduction has no walkthrough/renderer/controllers, retaining parent
DOM/CSS nesting and one ordinary button. Parent iframe-targeted input without
child events and no detected overlay/capture does not identify an exact cause,
prove headless-only behavior or establish production immunity. No speculative
workaround was added. Genuine background visibility remains unverified.

Fresh fixture: `http://127.0.0.1:47641`, root
`/tmp/dc-sequence-isolated-fixture-20261004`; its token remains in the local peer
handoff, not this repository document. Installed Archify 2.0.0 assets were read
only; Playwright 1.63.0 / Chrome 154.0.8037.97 used ephemeral profiles. Fresh
initial/Fit images for desktop/narrow workspace/Present are in
`/tmp/dc-sequence-isolated-evidence/`. Logs include
`/tmp/dc-sequence-isolated-fixture-prepare.log`,
`/tmp/dc-sequence-isolated-server.log`, `/tmp/dc-sequence-isolated-final-audit.log`;
extraction manifest `/tmp/dc-sequence-extraction-manifest.json`. Old fixtures,
main and frozen root were unchanged. These are peer-attributed results, not
new documentation-agent browser checks or a new coordinator visual sign-off.

#### All 18 isolated sequence assumptions

1. Scope is read-only authored sequence/source evidence, not a runtime trace, new resolver/viewer, duplicated Call-flow workflow or production editor migration.
2. Existing stable IDs remain authoritative. Duplicate captions, self calls and returns retain identity; malformed/duplicate identities disable projection rather than renumbering a partial story.
3. Branches/loops/parallel semantics keep native Mermaid fallback; they are not flattened into a claimed equivalent linear walkthrough.
4. Historical excerpts require matching captured-row quotes and retain before/after side, exact comparison and renamed old-path identity. Missing history never falls back to live workspace source.
5. Explicit definition lookup is current workspace/name-based and may be ambiguous or stale. Candidates are not verified call targets. Existing language/resolver limits remain.
6. Missing/stale/unsupported evidence is labelled; refreshed comparison state invalidates candidates and stale responses. Before/delta artifacts without matching anchors remain unlinked.
7. Preview DOM is lazy but finitely bounded, not unlimited virtualization:40 steps,8 anchors per step,20 lines/8000 characters per excerpt. No indexing/provider startup or new parser dependency is added.
8. Standard View code/full-source Comment/Question routes remain existing infrastructure. The preview seam is mountPreview plus cleanup, with no second editor/comment system.
9. Selection, scroll and camera are per-frame UI state; source return and ordinary rerenders preserve them. Native toolbar/background clicks can clear the diagram pin, while explicit code activation re-pins. No new durable cross-reload camera/selection format is claimed.
10. Existing messageSources persist. Offline HTML saves safely escaped validated excerpts with side/provenance, without live lookup/source-opening controls or transient current candidates. Markdown behavior is unchanged.
11. Manual scroll intent/RAF selection is distinct from arrow/keyboard reveal; observer echoes, initial/async layout, preview loading and resize must not initiate feedback scrolling.
12. Stacking below1040px of actual map width, iframe height680–900px, stacked code minimum180px/35% and wide code280–420px are accepted sizing tradeoffs.
13. Initial133.333% assumes bundled9px captions/natural SVG dimensions, giving12px in tested fixtures. It may clip participants/messages from the viewport and requires existing pan/zoom or explicit Fit. No font inflation or authored SVG/viewBox deletion occurs.
14. Fit is a complete overview and can be too small for reading. Resizing/Present preserve absolute x/y/scale; content can leave a reduced viewport deliberately rather than auto-refitting.
15. Archify and existing APIs remain the renderer/integration dependencies; optional guided-view methods are guarded at their actual call. Installed assets are read-only. No manifest/lockfile changes or beyond-baseline dependencies were required.
16. Browser verification covers Chrome154/Playwright1.63 with synthetic fixtures, desktop pointer/keyboard, desktop/narrow dimensions, headed/headless runs. Real touch/pen, assistive technology, other browsers and broad repository coverage remain unverified.
17. Genuine background visibility is unverified; visibilitychange was simulated when headless did not hide. Resized-Present real-pointer portability remains incomplete. Exact cause is unknown; headed passes do not prove production immunity or a headless-only cause. The initial setup timeout and both pointer attempts remain recorded.
18. The immutable snapshot is the sole feature-code source. Exact topic files and selected integration hunks were extracted onto the approved base and committed only on review/sequence-code after checks. Frozen root/main, docs/other features, prototypes, installed assets and existing fixtures were not changed. No merge/push/release occurred. New47641 fixture and this pane remain open.

### Isolated syntax-diff final handoff

Peer handoff `/tmp/diffcompass-syntax-isolated-checks/completion.md` records
commit `886e1739ee1c128f2bf5c468ebdd644977170003`, parent `8262d97`, on
`review/syntax-diff`. The documentation agent read it and verified that commit
and parent locally. The 22-file extraction contains 18 snapshot-identical files
(13 topic files, manifest/lock, `src/git.ts`, two coordinator bundle-test repairs)
and four mixed files with semantic-only hunks: `public/app.js`, `src/server.ts`,
`src/session.ts`, `src/export.ts`. No decision-log, synchronized-sequence,
prototype, docs or unrelated fixes were imported; no feature improvement added.

Entry/reuse remain Diff → changed-file header → Syntax changes, existing
`DiffFile`/`GitComparison`/`TourAnchor`, Git/parser helpers, authenticated routes,
`pageDiffFile`, `showChangedFile`/`diffViewRow` and existing exports. Captured
mergeBase/sourceTree identity, full-change coherence checks, fail-closed fallback,
32-file/4-request cache and requested-cached-summary export limits are unchanged.
ASTs/results are not persisted. The two parser dependencies stay exactly pinned
to `web-tree-sitter@0.25.10` and `tree-sitter-wasms@0.1.13`.

Exact files: `bun.lock`, `package.json`, `public/app.js`,
`public/semantic-diff.css`, `public/semantic-diff.js`,
`scripts/semantic-diff-browser.mjs`, `scripts/semantic-diff-fixture.ts`,
`scripts/semantic-diff-smoke.ts`, `src/comparison-source.ts`, `src/export.ts`,
`src/git.ts`, `src/semantic-diff-export.ts`, `src/semantic-diff-notices.txt`,
`src/semantic-diff.ts`, `src/server.ts`, `src/session.ts`,
`src/tree-sitter-runtime.d.ts`, `tests/diagram-labels.test.ts`,
`tests/semantic-diff-source.test.ts`, `tests/semantic-diff.test.ts`,
`tests/server-handler.test.ts`, `tests/ui-semantic-diff.test.ts`.

Peer checks used the exclusive syntax worktree, Darwin arm64 / Bun 1.4.2, and
exact subsequently committed content. Logs show cwd, branch and pre-commit HEAD.
Artifacts below are under `/tmp/diffcompass-syntax-isolated-checks/`:

- `bun install --frozen-lockfile --ignore-scripts`: 166 packages, snapshot lock
  unchanged (`install.log`).
- `bun run verify`: exit 0; typecheck, **602/0**, **4,958 assertions / 71 files /
  60.58s**, configured theme/app/diagram-label syntax checks (`verify.log`).
- `node --check public/semantic-diff.js`,
  `node --check scripts/semantic-diff-browser.mjs`, `git diff --check`: passed.
- `bun run /tmp/diffcompass-syntax-isolated-checks/fixture.ts`: new fixture 47643,
  root `/tmp/diffcompass-syntax-isolated-fixture-47643`; old 47633 unchanged.
- `PLAYWRIGHT_MODULE=file:///Users/ricardo.costeira/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs node /tmp/diffcompass-syntax-isolated-checks/browser.mjs`:
  **11/11** isolated Chrome checks passed, including keyboard, retained text diff,
  captured Before/After, unified old identity, Kotlin, Retry, parse/unsupported
  fallback, 390px bounds and no page errors (`browser.log`). Peer inspected
  `desktop.png` and `mobile.png`.
- `bun build --compile --minify scripts/semantic-diff-smoke.ts --outfile /tmp/diffcompass-syntax-isolated-checks/semantic-smoke`
  and `bun build --compile --minify src/cli.ts --outfile /tmp/diffcompass-syntax-isolated-checks/diffcompass-cli`:
  passed (`compiled-build.log`). Running both from `/private/tmp`, with `--version`
  for the CLI, passed TS/TSX/Kotlin embedded-WASM body-change checks and printed
  version 2.0.0 (`compiled-outside.log`); no installed binary was replaced.
- Exact 22-file allowlist, 18 blob comparisons, four mixed diffs, temporary
  harness parity and clean committed worktree passed (`extraction.log`,
  `final-audit.log`, `commit.log`). Preparation artifacts:
  `/tmp/diffcompass-syntax-extract.py`, `/tmp/diffcompass-syntax-extraction.patch`.

**Fixture reuse caveat:** committed browser/fixture scripts remain exact snapshot
copies and default to old port 47633. Fresh verification used external copies
with only port/root, absolute imports to this worktree and capture destinations
changed; parity was checked. Use the new 47643 harness for this branch, not the
old defaults. The remaining artifacts include `fixture.ts`, `fixture.log`,
`browser.mjs`, `semantic-smoke` and `diffcompass-cli`. New fixture and peer pane
remain open. These are peer-attributed local host results, not a release,
all-platform test or new combined-feature integration run.

#### All 32 isolated semantic assumptions

1. Scope: per-file syntax summaries are the bounded addition; no review-wide semantic analysis.
2. Meaning: changed or unchanged AST syntax proves neither behavioural change nor equivalence nor runtime impact.
3. Languages: .ts/.mts/.cts/.tsx/.kt/.kts only. JavaScript and other extensions remain unsupported even if a related grammar could parse them.
4. Kotlin: review assistance only, no Android/KMP project import/compiler/IntelliSense. Older grammar can reject valid/newer/compact syntax, requiring fallback.
5. Categories: supported named declarations added/removed/signature/body-initializer. Imports, expressions, computed/destructured names and unsupported constructs require text inspection.
6. Nesting: enclosing and nested declarations can both appear; counts are declaration changes, not independent behaviour changes.
7. Matching: within file/scope; exact syntax and unique signatures preferred. Ambiguous overloads stay explicitly unpaired, never paired by ordinal.
8. Symbol identity: parent signature changes can invalidate nested matches. Symbol moves/renames are conservative removed/added; no cross-file tracking.
9. File renames: use Git-recorded old/new identities. Different before/after language classifications, including TS-to-TSX, fall back.
10. Provenance: immutable mergeBase/sourceTree only, including working-tree reviews; live workspace never substitutes for captured evidence.
11. Coherence: saved source rows and complete normalized captured-file change identity are both checked, including EOF/rename. Missing-hunk capture races fail closed.
12. Capture boundary: broader capture pipeline is not made atomic; semantic analysis refuses inconsistent per-file evidence.
13. Navigation: existing context/full diff prioritizes sourceTree; missing objects fail with no live fallback. Full-file paging respects old/new anchors.
14. Legacy: no captured source means unavailable analysis, including deleted-file reviews.
15. Unsupported data: non-regular blobs, binary/unsupported UTF-8, generated files and excessive size/complexity retain ordinary diff. Generated detection is a conservative path/header heuristic, not AST evidence.
16. Recovery: any parser error suppresses whole-file structural claims; no partial parse passed off as complete. Unavailable/request failures permit retry; parser/source failures do not poison cache.
17. Comments/format: parsed comments/format ignored; token content and structure retained, including strings and ASI. Compiler directives/tool behaviour may still differ.
18. UX: optional file-header control, native keyboard buttons, ordinary diff preserved; unrelated proposal previews excluded. 390px smoke is not comprehensive mobile/touch/accessibility certification.
19. Labels: display names/signatures shortened to 400 characters, signature whitespace normalized. Matching uses full fingerprints; captured source provides exact text.
20. Persistence: ASTs/summaries derived, not authored/persisted review evidence. No schema migration. Restart/reopen may recompute; missing Git objects remain unavailable.
21. Cache: exact before/after identities, repository root, complete file model and parser/schema version govern reuse. Changed identities cannot cache old results; UI discards refresh races; identical in-flight requests deduplicate.
22. Export: requested results still in bounded server cache only, with X/Y coverage and explicit non-review-wide wording. Missing summary is not no change. Offline evidence carries identities/hashes/labels, not a second viewer.
23. Bounds: four concurrent requests, 32 cached files; per version 256,000 bytes, 10,000 lines, 1,000 declarations, 100,000 nodes, depth 200; 200 displayed changes.
24. Latency: cooperative 150ms parse deadline/version, 5-second Git-call timeouts and traversal bounds are not whole-request latency guarantees or broad benchmarks.
25. Dependencies: exact web-tree-sitter0.25.10/tree-sitter-wasms0.1.13 accepted. Real TS/TSX/Kotlin execution checks ABI and host compiled assets. Frozen install disables lifecycle scripts. No JVM/LSP/build import/runtime download.
26. Footprint/provenance: installed grammar pack about49MB; selected runtime/TS/TSX/Kotlin WASM about8.6MB. Pinned published artifacts/integrity used; all grammar source rebuilds and release platforms not verified.
27. Licensing: runtime/TS/Kotlin MIT and wrapper Unlicense notices embedded at /semantic-diff-notices.txt. Host smoke is not complete release-packaging verification.
28. Compatibility/reuse: existing Peek, call flows, impact analysis, sequence navigation and schemas remain authoritative. No competing resolver/model/viewer, provider integration, Monaco migration or scope folding.
29. Validation boundary: full verify passed for this isolated semantic branch, plus Chrome/host compiled smoke. Combined-feature integration, all release targets, assistive tech, touch/pen and other browsers remain separate.
30. Workflow: latest isolation/commit authorization supersedes earlier shared-worktree/no-commit instructions. Only assigned branch/worktree modified; main and frozen checkout preserved; no push/merge/release/global install. Prior mutex incident was reported and coordinator confirmed no lost content; old mutex not used here.
31. Exact extraction: no improvements or unrelated snapshot fixes included. 13 topic files and5 whole-owned/test files are exact;4 integration files contain only semantic hunks. Coordinator bundle-test repair included as explicitly requested.
32. Fixture compatibility: committed original fixture/browser scripts still default to47633. This run used parity-checked temporary harness copies for47643/new root/imports/artifacts, preserving old fixture and snapshot file identity. Reusing old defaults would target old fixture, so use provided new harness for this branch review.

### Additional isolation assumptions and decisions

1. The original 65 peer and 17 documentation assumptions are retained verbatim;
   the new checkout topology supersedes only their historical workflow/status
   statements, not their product, provenance, support or export limitations.
2. The baseline must be reviewed explicitly against local `main`; sharing it
   does not make it reviewed or shipped. Feature reviews compare against that
   base so unrelated features are not bundled into each diff.
3. Branch names identify review units, not successful extraction, approval or
   release. Final exact commits and branch-specific evidence must come from the
   responsible agents/coordinator before the docs commit.
4. The clean main checkout is a reviewer starting point. The frozen root and
   snapshot archive are preserved evidence, not working locations for this task.
5. `REVIEW_BRANCHES.md` is a concise navigation/handoff document. ROADMAP remains
   the canonical delivery index, and RESEARCH remains the full evidence ledger.
6. Results are attributed to their observed tree, command and reporter. A passing
   combined run, source test or headless fixture is not proof of an independently
   extracted branch, all browser routing, accessibility or release readiness.
7. Prototype source links are qualified by their separate branch; those files
   are intentionally absent from the documentation branch. No runtime dependency
   or production migration follows from documenting that experiment.
8. Historical `/tmp` logs, captures and fixture ports remain local evidence with
   no durability or continued-server-availability promise. This task does not
   stop or mutate those fixtures or reinstall ignored dependencies.
9. Only the docs agent's own branch may be committed, after final reconciliation;
   no push, merge, release, install, other-branch edit or frozen-root mutation is
   authorized by that commit permission.
10. Feature extraction is independent, but the unreviewed baseline has a known
    browser compatibility caveat: its map-motion-on change lacks the guard now
    placed in sequence/code. That guard needs separate review/extraction if the
    baseline is considered without sequence/code; no runtime relocation or rebase
    is part of this documentation task.
11. Snapshot fidelity and independent feature checks do not guarantee clean
    integration: shared app/export/server/session edits require a separate
    integration review and checks on any future combined tree. No merge approval
    is inferred from the coordinator's extraction audit.

### Historical decision update: parallel implementation (2026-10-04)

The user has now authorised one Astra/xhigh Herdr agent per remaining research
topic: synchronized sequence/code view, design decision log, semantic diff, and
documentation alignment. This supersedes the discussion-only gating below for
those four topics. Agents may resolve product questions themselves or with the
coordinator, but must report **all assumptions**, edge-case decisions, reused
features, verification results, and remaining gaps for the user's next review.
An existing-feature audit is mandatory before implementing: extend current
models, helpers, UI and tests rather than introduce parallel implementations.

The coordinator retains the isolated Monaco/language-support prototypes. There
is still no approval to replace the production diff engine. The user explicitly
dropped scope-folding arrows from this migration; inline unchanged-context
expansion/re-collapse remains required. Older references to scope folding as a
migration gate below are superseded. Native call-flow consolidation is already
implemented locally and must not be reimplemented. No release, installation or
commit is part of this parallel implementation request.

### Decision update: shared language support and bundled defaults

Approved on 2026-10-04: a curated provider manager, not an extension marketplace,
with **TypeScript and Kotlin included by default**. Use one language-provider
layer for Monaco hover/native inline Peek and DiffCompass symbol lookup; do not
create separate resolvers for each UI. This approves the direction, not a claim
that either provider has already been packaged or the production renderer changed.

Production interaction decision: **Comment, Ask agent and Peek belong in the
code context menu, with keyboard access—not duplicated in the page's top
toolbar.** The current comparison lab's buttons are evaluation controls, not a
production layout commitment. Connect Peek to Monaco's native inline viewer
instead of retaining a second, competing presentation. Preserve discoverability
and a usable non-mouse path when adapting the menu; mobile remains unverified.

Expected Settings controls: capability/status reporting, enable/disable,
install/update/uninstall for managed providers, and detection of externally
installed providers. Never uninstall external development tools. Preserve
before/after revision identity; never resolve historical source silently against
the current workspace. Provider startup/project import requires a trust boundary;
merely opening a review must not authorize build scripts or optional data sharing.

Existing integration: `src/symbol-peek.ts` detects installed servers for TS/JS,
Python, Rust, Go, Swift and Java. It launches a short-lived process for definition
and reference requests, then stops it. There is no Kotlin selection, persistent
LSP connection, hover/folding bridge, managed provider installer, or historical
workspace isolation. Reuse/refactor this entry point rather than duplicating it.

Bundling feasibility recorded by the coordinator from upstream documentation on
2026-10-04; these provider capability/version claims were not independently
rechecked by the documentation agent:

- TypeScript: Monaco already includes a browser language service. Project-aware
  server support is a separate integration; pin a compatible server/compiler/
  runtime combination rather than assuming the repository's TypeScript version
  is automatically compatible. The current TypeScript language server lists
  Node >=22.22.2 and uses TypeScript 6 in its package metadata.
- Official Kotlin LSP: still alpha; JVM build imports supported, Android import
  experimental, **KMP support still forthcoming**. Current standalone releases
  include platform-specific runtimes and require additional first-start choices
  around region/data sharing. Do not equate bundling it with reliable support for
  the user's KMP projects. Verify binary redistribution terms before packaging;
  the repository license alone does not establish every bundled binary's terms.
- Community `kmp-lsp`: a candidate for lightweight KMP navigation, not a chosen
  dependency. It documents tree-sitter-based navigation, no semantic type
  checking, and name-based reference limitations. Validate same-name symbols,
  expect/actual, overloads, extension functions, Compose, source sets and library
  targets before treating its output as authoritative.

Scope clarification: **DiffCompass is a change-understanding tool, not an IDE.**
Kotlin files from Android/KMP projects should have useful review assistance,
without promising fully functioning IntelliSense or requiring a full build
import. Prioritise syntax, folding, signature/documentation hovers when available,
and inline Peek. Show ambiguous definitions as labelled candidates rather than
silently selecting a platform or overload. Do not imply compiler verification.
The user is open to Kotlin-only support; a JVM-only project provider is one
possible optional capability, not a reason to make Android/KMP diffs unreadable.

The isolated provider probe (`prototypes/language-support/README.md` on the
[prototype branch](REVIEW_BRANCHES.md)) found real
ambiguity in kmp-lsp v0.26.0: wrong-platform and wrong-receiver targets, missed
overloads, and a prose reference. Final fixture: 9 passes / 7 failures across two
cold runs. This does not rule out lightweight Kotlin support; it rules out
presenting this configuration's single target as authoritative. No provider has
been installed or bundled. Scope-fold chevrons were dropped from migration
requirements; local unchanged-context expansion/re-collapse remains required.

Sources: [Monaco provider model](https://github.com/microsoft/monaco-editor#providers),
[TypeScript server package](https://github.com/typescript-language-server/typescript-language-server/blob/master/package.json),
[Kotlin LSP capabilities](https://github.com/Kotlin/kotlin-lsp#supported-features),
[Kotlin LSP release](https://github.com/Kotlin/kotlin-lsp/releases/tag/kotlin-lsp/v263.4702.0),
[kmp-lsp limitations](https://github.com/Hessesian/kmp-lsp#limitations).

### Decision update: one call-flow presentation

Approved after the inventory: use the complete native Call flows view only,
not an Archify companion. Implemented locally: all saved call flows remain under
Maps → Understand the change → Call flows; no new workflow duplicates are
generated, and old duplicates are hidden in Maps and diagram exports. Original
saved data is not deleted. Architecture and sequence maps remain unchanged.
Changes / Before / After, source links, regeneration, and dry-run controls stay
in the native view. Briefing targets route to the requested native flow.

The entry-point inventory below describes this local implementation and labels
the released v2.0.0 behavior separately. The optional-companion proposal is
superseded by this single-view decision.

## How we will use this

For the four authorized parallel topics:

1. State the exact behaviour proposed and the user problem it solves.
2. Check existing implementations so we extend rather than duplicate them.
3. Resolve product choices with the coordinator or within the assigned scope,
   and agree shared contracts before changing integrations.
4. Preserve other agents' changes and obey the shared integration mutex.
5. Record verification, unresolved gaps and all assumptions for review.

The earlier discussion-only approval gate is superseded for these topics. This
does not authorize production viewer migration, scope-folding arrows, commits,
pushes, releases or installation.

## Quick index

- [Where call flows appear](#where-call-flows-appear)
- [Existing features](#existing-features)
- [Local work and release status](#local-work-and-release-status)
- [Whiteboard-inspired ideas](#whiteboard-inspired-ideas)
- [Follow-up discussion queue](#follow-up-discussion-queue)
- [Evidence and documentation caveats](#evidence-and-documentation-caveats)
- [All documentation-audit assumptions](#all-documentation-audit-assumptions)

## Where call flows appear

**Pre-isolation implementation, now in unreviewed base `8262d97`:** open **Maps → Understand the
change → Call flows**. `savedCallFlows` feeds every saved call flow to the native
renderer, with Changes / Before / After, branches, recursion markers, exact
source evidence, regeneration and linked Simulate controls. No second call-flow
model or renderer was introduced.

The standalone Call flows tab remains hidden. The category selector is hidden
when only one Understand-the-change view is available, and Call flows is omitted
when no saved flows exist. Stale saved flows are not silently removed. A missing
briefing target produces a notice; a valid target opens and scrolls to that native
flow. Dedicated briefing call-flow and sequence sections remain hidden.

`archifyArtifacts` hides saved workflow duplicates, `archifyCandidates` no
longer creates them, and Markdown/HTML exports filter them. Original saved
artifacts are not deleted. Architecture and sequence maps retain their existing
paths. Tests cover all-converted, mixed, empty and stale reviews; those tests are
not browser verification.

**Released v2.0.0:** simple linear call paths could become Archify Workflow maps
(2–6 nodes, no branches, merges, cycles or disconnected nodes). Only unconverted
flows appeared in the native category, so that option could disappear. The
existing native capabilities were present but conditionally exposed; the local
change repairs this gap rather than inventing Before/After call paths.

Evidence: `public/app.js` (`savedCallFlows`, `archifyArtifacts`, `openCallFlow`,
`understandMapViews`, `renderMapsNavigation`), `src/archify.ts`, `src/export.ts`,
`tests/call-flow-navigation.test.ts`, and the corresponding v2.0.0 source.

## Existing features

### 1. Review and walkthrough

- Branch and working-tree comparisons, including committed, staged, unstaged,
  and untracked changes.
- Isolated GitHub pull-request reviews.
- Tour → phases → stops, with old/new source anchors.
- Previous/Next navigation and prefetched explanations.
- Configurable briefing, review cues, effort estimates, and diagrams.
- Free browsing, Focus mode, keyboard shortcuts, and return to the current stop.
- Per-file reviewed state, filtering, and review completion.
- Checkpoints/history, full-change and since-last-review comparisons.
- Stale annotations when the reviewed code changes.

### 2. Code and diff browsing

- Split/unified diffs, wrapping, themes, and word-level highlighting.
- Whitespace visualization and whitespace-only-change detection.
- Context expansion and full-file expansion.
- Changed-file and full-repository browsing, including unchanged files.
- Symbol Peek: definitions, usages, code previews, partial-name suggestions,
  source navigation, and return navigation.
- Markdown comparisons and PNG previews.
- Responsive layouts and persisted display preferences.

### 3. Maps and diagrams

- Component maps for behaviour and implementation journeys, relationship
  captions, and change statuses.
- Architecture Before / Delta / After views when supported by evidence.
- Native **call flows** with Changes / Before / After, stable identities,
  branching, recursion markers, call-site evidence, and source links.
- Sequence diagrams, editable Mermaid, provenance, and regeneration.
- Domain context from `CONTEXT.md` and `CONTEXT-MAP.md`.
- Adaptive state-machine and data-model/entity-relationship diagrams.
- Released v2.0.0 converted simple call flows to Archify workflows; the local
  consolidation removes new conversions and hides saved duplicates.
- Validated local Archify artifacts and Mermaid fallback views.
- Pan, zoom, Fit, expand/presentation controls.
- Node and relationship inspection, search, semantic types, and
  upstream/downstream exploration.
- Alternate route selection and journey playback.
- Sequence routes that return to the same start/destination participant.
- Draggable overlay cards, themes, visual presets, and motion controls.
- Caption placement and collision-reduction work; this does not guarantee that
  every generated diagram is crossing-free.
- Diagram validation and bounded repair.
- Sequence semantics-card source links, definition lookup, and a floating
  return-to-diagram action that preserves the camera (newly committed locally).

### 4. Explore impact

- Per-symbol caller/reference graphs with direct and indirect callers.
- Involved files and related tests.
- Provider, confidence, provenance, and completeness information.
- Bounded displayed results distinguished from provider-reported counts.
- Open source from a graph node and return to the caller graph.
- Structural evidence can inform finding priorities.
- Explicit boundary: static/authored relationships are not proof of runtime
  impact.

### 5. Dry runs

- Agent-produced simulations, **not execution of the application**.
- Suggested/editable inputs, mocks, and assumptions.
- Steps, source references, values, branches, and expected outputs.
- Navigation independent of tour stops.
- Correlation with call flows and sequence diagrams.
- On-demand preparation, cancellation, persistence, and stale-state handling.

### 6. Questions, feedback, and edits

- Line/range, stop, and review-level conversations with quoted context.
- Reviewer suggestions and explicitly requested agent edits in isolated
  worktrees.
- Apply / Reject and conflict-safe Undo.
- Activity grouped by request, files, and verification.

### 7. Findings and requirements

- Priorities, scopes, pins, and structured evidence.
- Finding validation/recall checks, dispositions, notes, and review policies.
- Acceptance criteria from linked same-repository issues or local tasks.
- Supporting code excerpts.
- Queued GitHub comments and explicitly confirmed review submission.

### 8. Operation and session management

- Saved-review library: resume, rename, archive, delete, and prune.
- Screenshot/video media.
- Markdown and self-contained HTML exports.
- Attached-agent and standalone-agent operation.
- Loopback authentication and sandboxed diagram frames.
- Doctor, update, rollback, and uninstall commands.

## Local work and release status

### Published and installed baseline

Fresh documentation-audit checks on 2026-10-04:

- `gh release view --repo rcosteira79/diffcompass --json tagName,isDraft,isPrerelease,publishedAt,url`
  reports [v2.0.0](https://github.com/rcosteira79/diffcompass/releases/tag/v2.0.0),
  published `2026-09-29T11:09:45Z`, neither draft nor prerelease. Querying its
  assets returned six platform archives plus checksums.
- `git rev-parse 'v2.0.0^{commit}'` resolves the annotated tag to
  `ec3c045d3c6628508a3a679890805f1c422ad1c8`.
- `gh api repos/rcosteira79/diffcompass/branches/main --jq '.commit.sha'`
  independently returns the same remote commit. This is stronger evidence than
  the cached `origin/main` ref; no fetch or branch operation was performed.
- `diffcompass --version` freshly reports `2.0.0`. This does not identify every
  byte in the installation or constitute a full installed-binary test.
- Impact analysis (`98950f1`), dry runs (`8b2ddd2`) and interactive maps
  (`cf9e80c`, bundled renderer `70bdbfd`) are ancestors of v2.0.0 with reachable
  controls in its source. They are no longer future-only roadmap entries.

### Committed locally

`716edb8` — `Add source navigation from sequence semantics cards`.

- Validated message-source anchors.
- Explicit View code actions in the semantics card.
- Definition lookup for call-shaped captions when no validated anchor exists.
- Matching definitions are labelled as name matches, not verified call targets.
- Multiple source anchors supported.
- Floating return action and diagram camera restoration.
- Test fixture coverage. The earlier inventory recorded 561 passing tests on
  the staged tree; that historical count is not a fresh run in this audit.

At the original audit this was local `HEAD`, one commit beyond the freshly
queried remote main. It remains local `main`, absent from v2.0.0; the docs branch
now starts from `8262d97`. No commit, push, release or installation was performed
in this documentation assignment.

### Earlier fixes: preserved in unreviewed base `8262d97`

These are earlier requested changes, not Whiteboard-inspired additions:

1. **Interactive-map preferences:** persist theme/preset/motion across maps,
   motion on by default while respecting reduced motion, and remove native
   node tooltips without dropping accessible labels.
2. **Impact-analysis recovery:** retain valid entries, perform bounded repairs,
   and expose honest warnings or omission reasons instead of silently ending
   with an unexplained empty result.
3. **Final-answer handling:** Codex transport reads `--output-last-message` for
   fresh and resumed turns and fails if the final file is empty. JSONL parsing
   excludes explicit commentary/analysis, prefers an explicit final phase, and
   uses the last unphased message for older streams; that parser fallback is not
   permission to accept an empty canonical final file.
4. **Call-flow exposure:** the single native presentation described above,
   including filtering saved workflow duplicates in exports.

Map preferences use validated browser `localStorage` under
`diffcompass-map-preferences`; they are shared by live and export frames at the
same origin, not written into saved sessions or guaranteed to follow exported
files or a new server port. Reduced-motion handling is retained and native node
tooltips are removed without dropping accessible labels.

Impact warnings and omission reasons are validated by `src/store.ts` and shown
in Explore impact. **Export gap:** `src/export.ts` includes per-result structural
evidence and provider limits but does not render the new overall
`structuralAnalysisWarnings` or `structuralAnalysisOmissionReason`. Do not claim
complete export parity or interpret an omitted result as zero impact.

These were uncommitted at the original audit and are now preserved in
`review/pre-research-fixes` at `8262d97`, still unreviewed and unreleased.
Historical targeted verification is listed below; no all-browser or all-platform
completion claim is made.

### Decision log: preserved pre-isolation implementation handoff

The decision-log peer reports a reachable **Conversations → Decision log → Add
decision** workflow, with **Correct decision** and **Remove** on cards. This is
local work that was uncommitted at this handoff, absent from v2.0.0 and the
sequence-navigation commit `716edb8`. Its isolated review branch is now
`review/decision-log`; branch-specific verification is recorded separately above. It is a reviewer-curated index of existing
evidence, not a second conversation system or generated rationale.

- Entries are manually classified as **recorded** or **hypothesis**, defaulting
  to hypothesis, and cite 1–8 existing message/comment/finding/activity records.
  “Recorded” is a reviewer assertion, not verified author intent.
- Reuses session IDs, `TourAnchor`, `comparisonFingerprint`, authentication,
  `serializeMutation`, session revision polling, atomic store,
  `showAnalysisFile`, `markdownFence`, HTML escaping and existing export tabs.
- `decisionLog` is optional in schema 4; absence means an empty log. Corrections
  retain snapshots unless the reviewer explicitly replaces the evidence.
  Missing, edited, ambiguous or stale source references are never retargeted.
- A captured comparison is the context when evidence was captured, not proof
  of the original message's authorship revision. There is no historical source
  resolver, immutable history audit or GitHub decision publication.
- Bounds: 100 entries; summary 500, rationale 4,000 and alternatives 2,000
  characters; evidence 2,400 and code 8,000 characters per reference; total
  2 MiB; the evidence picker returns at most 100 search results.

Dedicated files: `src/decision-log.ts`, `public/decision-log.js`,
`public/decision-log.css`, `tests/decision-log.test.ts`, and
`scripts/check-decision-log-browser.mjs`. Narrow integrations use existing types,
store, session, server, export, app and index files. The peer reports no new
production dependencies or edits to docs/prototypes. No competing conversation,
comment stream, viewer, resolver or agent call was added.

Final focused/browser results and the separate socket-suite rerun are recorded
below. They are peer-reported verified outcomes, not a fresh implementation audit
by the documentation agent or a full-suite pass on the later moving worktree.

#### All decision-log peer assumptions and tradeoffs

1. **Scope:** a local reviewer-curated index over this session's messages,
   comments, findings and activity. No separate comment stream, inferred author
   intent, arbitrary URL/code evidence, agent generation or review-outcome meaning.
2. **Meaning:** hypothesis is the default; recorded is a reviewer assertion.
   Freshness is independent. Agent prose remains attributed as agent prose.
   Rationale/alternatives are optional manual plain text; blank fields are omitted.
3. **Attribution:** existing single-reviewer local authentication is sufficient;
   there is no identity verification, signing, author approval or multiuser audit
   trail. Hashes detect changes only.
4. **References:** require 1–8 owned session references per record, identified by
   kind plus ID. Repeated references deduplicate; duplicate entity IDs are
   ambiguous, never selected by order. Different decisions may share sources.
5. **Capture:** the server saves IDs, attribution, bounded excerpts, source
   fingerprint, time, comparison fingerprint/base/head/tree and available old/new
   anchors/code. Capture context does not prove the original authorship revision.
6. **Freshness:** source changes (including metadata/status), missing/ambiguous
   sources and comparison changes are separate states. Any comparison/tree change
   conservatively makes evidence stale, including unrelated edits or view switches.
7. **Source identity:** same-comparison rename aliases only canonicalize a unique
   validated file; later rename/refresh never relocates saved references. Code
   links require an exact saved quote/current diff match plus unchanged source and
   comparison. There is no workspace/historical fallback. Unavailable, image,
   out-of-hunk, mismatched or oversized context stays inspectable as text with
   code navigation disabled.
8. **Navigation:** rechecks the fresh session and record version at click time.
   Original-source links require unchanged identities; unchanged message/comment
   text may still open after a comparison change while code links remain disabled.
9. **Correction:** preserves evidence by default. **Replace saved evidence**
   recaptures all retained selected references; new references capture current
   evidence. Missing/ambiguous sources cannot be recaptured. Versions reject
   concurrent edits; source navigation never silently adopts another record version.
10. **Mutation/recovery:** correct/remove is available only while review is open.
    Removal requires confirmation and has no undo or version-history archive.
    Drafts survive failed requests and in-page refresh, not browser reload. An
    ambiguous network failure after server commit may require inspecting the log
    before retrying creation; no new idempotency protocol was introduced.
11. **Persistence:** optional absent/empty `decisionLog` means no records; schema
    stays 4 and older sessions load. Reverse compatibility is not guaranteed:
    older binaries may drop optional data when saving. Existing security, size
    limits and atomic store are reused; persistence failure rolls back record and
    revision together.
12. **Integration:** ordinary revision polling propagates changes between views.
    Decisions do not alter findings, comment publication, activity, prompts or
    approval status.
13. **Exports:** existing Markdown/HTML include a nonempty log, saved snippets,
    provenance and freshness; HTML has a reachable static Decision log tab.
    Empty logs are omitted. There are no offline live links, edits or source
    fetches, no separate export toggle, and evidence remains included regardless
    of other optional section filters.
14. **Bounds:** 100 records; 500 summary, 4,000 rationale and 2,000 alternatives
    characters; 8 references; 2,400 excerpt and 8,000 code characters per reference
    with explicit truncation; 2 MiB total serialized log; first 100 picker search
    matches; source anchor matching spans at most 200 lines. No production-scale
    benchmark claim is made.
15. **Dependencies:** no production dependency added; existing Bun/Node helpers
    and browser ES modules suffice. Browser checks use an explicitly supplied
    existing Playwright path and Chrome, without installation.
16. **Verified scope/exclusions:** Chrome desktop interactions and 390px overflow
    plus a visually inspected mobile screenshot were checked. Safari, Firefox,
    touch-device and assistive-technology audits were not. Historical full-source
    browsing, automatic inference, audit history, export filtering and external
    evidence import remain outside the completed local scope. This is not a release.
17. **Worktree/ownership:** dirty changes were preserved; no branch/worktree,
    commit, push, release or global install. Docs/prototypes remained with their
    owners. The reported mutex incident did not overlap this peer's writes; the
    old lock was retired and no shared edits or held lock remain.

### Semantic diff: preserved pre-isolation implementation handoff

The semantic peer reported completed local implementation, then uncommitted and
unreleased. It is now isolated on `review/syntax-diff`; the following original
handoff does not establish extracted-branch verification.
Open **Diff → changed file header → Syntax changes**. Keyboard buttons and
Before/After links reuse `showChangedFile` and `diffViewRow`, supporting existing
split/unified views and full-file paging. Reuses `GitComparison`, `DiffFile`,
`TourAnchor`, `parseUnifiedDiff`, `runProcess`, captured Git identities, route
authentication, `pageDiffFile` and `exportReview`; no viewer, resolver, call-flow,
impact model or provider workflow is duplicated. The complete handoff and all
30 assumptions are recorded here.

- Supported extensions: TypeScript/TSX `.ts`, `.mts`, `.cts`, `.tsx` and Kotlin
  `.kt`, `.kts`. Categories cover declaration additions/removals, signature and
  body/initializer changes, with nested owners and conservative overload matching.
  These are bounded syntax observations, not inferred behavior or compiler truth.
- Source expansion prioritizes the captured `sourceTree`; source navigation
  pages to anchors beyond the initial 1,000 rows. Full-file normalized Git-change
  identity and row validation catch capture races in omitted hunks. Missing
  old/new objects or a legacy comparison without a captured tree report unavailable source rather
  than substituting current workspace content for historical evidence.
- Parser failures (including newer Kotlin syntax), unsupported/mixed languages,
  generated/large/complex files, absent snapshots, symlinks, binary and invalid
  UTF-8 inputs have explicit text-diff fallback. The older Kotlin grammar remains
  a compatibility limit, not a claim of general Kotlin project support.
- No AST is persisted. Requested results use a recomputed request cache bounded
  to 32 files and 4 concurrent requests, keyed by exact trees, file model and
  parser version. There is no schema change or promise of analysis persistence
  across session reloads.
- Exports include only requested cached summaries, label X/Y coverage, and
  explicitly state that the analysis does not cover the whole review. Absence
  of a summary must not be read as absence of syntax changes.
- Two pinned dependencies: `web-tree-sitter` 0.25.10 and `tree-sitter-wasms` 0.1.13.
  Selected WASM assets are approximately 8.6 MB; the installed grammar pack is
  49 MB. These are asset/package measurements, not a release-binary size claim.
  The peer reports upstream MIT runtime/TypeScript/Kotlin and Unlicense wrapper
  checks, with embedded notices served at `/semantic-diff-notices.txt`.
- Compiled/minified host CLI and outside-checkout TS/TSX/Kotlin embedded-WASM
  smoke checks passed. They establish the tested host/fixtures, not cross-platform
  builds, a release or Android/KMP project-aware language services.

After fixing the initial reachability bug, the peer reports isolated Chrome
checks passed for keyboard, old/new navigation, unified layout, Kotlin,
parse/unsupported fallback, request failure/Retry and 390px fallback, with no page
errors. Screenshots were supplied at `/tmp/diffcompass-semantic-desktop.png` and
`/tmp/diffcompass-semantic-mobile.png`. The coordinator subsequently inspected
both screenshots and the captured-change coherence implementation; no
documentation-agent visual inspection is implied. The coordinator accepted the
scoped local implementation with Kotlin grammar/review-assistance limits; all
final assumptions are now recorded below. The peer left fixture port 47633
running and reports no further planned edits unless tests expose a real issue.

#### All semantic peer assumptions and tradeoffs

1. **Scope:** per-file syntax summaries are the useful bounded addition;
   review-wide semantic analysis is outside this implementation.
2. **Meaning:** changed or unchanged parsed syntax proves neither behavioral
   change nor equivalence nor runtime impact.
3. **Languages:** `.ts`, `.mts`, `.cts`, `.tsx`, `.kt` and `.kts` use bundled
   grammars. JavaScript and other extensions remain unsupported even where a
   related grammar could parse them.
4. **Kotlin:** syntax assistance is sufficient initially; no Android/KMP project
   import, compiler checking or IntelliSense is implied. Some valid/newer/compact
   syntax is rejected by the older grammar and must fall back.
5. **Categories:** supported named declarations report added, removed, signature
   and body/initializer changes. Imports, expressions, computed/destructured names
   and other unsupported constructs may require text inspection.
6. **Nested declarations:** enclosing and nested declarations may both appear.
   Counts are declaration changes, not independent behavioral changes.
7. **Matching:** matching is within one file/declaration scope. Exact syntax and
   unique signatures are preferred; ambiguous overloads remain explicitly unpaired,
   never paired by ordinal.
8. **Identity:** parent signature changes can invalidate nested matching. Symbol
   moves/renames are conservatively removed/added; there is no cross-file tracking.
9. **File renames:** reuse Git's recorded rename identity. Different before/after
   language classifications fall back, including TS-to-TSX changes.
10. **Provenance:** immutable `mergeBase`/`sourceTree` objects are the only analysis
    source, including working-tree reviews. Live workspace contents never substitute.
11. **Coherence:** validate saved source rows and complete normalized captured-file
    change identity, including EOF markers and rename identities. Missing-hunk
    capture races fail closed.
12. **Capture boundary:** the broader capture pipeline is not made atomic;
    semantic analysis refuses inconsistent file evidence instead.
13. **Navigation:** existing diff expansion prefers `sourceTree` whenever present.
    Missing objects fail instead of falling back to live files. Full-file paging
    respects requested old/new anchors.
14. **Legacy reviews:** missing captured source means unavailable analysis,
    including deleted-file reviews.
15. **Unsupported data:** non-regular Git blobs (symlinks/submodules), binary or
    unsupported UTF-8, generated markers and excessive size/complexity retain
    ordinary text diff. Generated detection is a conservative path/header heuristic,
    not parser evidence.
16. **Parse recovery:** any parser error suppresses structural claims for the
    entire file; partial parse output is not presented as complete evidence.
    Unavailable/request failures expose Retry; parser/source initialization failures
    do not poison the cache.
17. **Comments/formatting:** comparison ignores parsed comments/formatting but
    retains token content/structure, including string whitespace and automatic
    semicolon-insertion effects. Compiler directives/tool behavior may still change.
18. **UX:** an optional file-header control preserves the normal diff and uses
    native keyboard-operable buttons. Unrelated proposal previews do not show the
    summaries. Mobile verification is a basic 390px layout check, not comprehensive
    accessibility/touch certification.
19. **Display labels:** names/signatures are shortened to 400 characters and
    signature whitespace normalized for display; captured source links provide
    exact text. Matching uses full fingerprints, not shortened labels.
20. **Persistence:** summaries and ASTs are derived, not saved as authored review
    evidence; there is no persisted schema migration. Reopen/restart may require
    recomputation, and unavailable Git objects remain unavailable.
21. **Cache identity:** exact before/after identities, repository root, complete
    file model and parser schema/version govern reuse. Results from changed request
    identities are not cached; the UI discards refresh races; identical in-flight
    requests share work.
22. **Export:** only requested results still in the bounded server cache are
    exported, with X/Y changed-file coverage and an explicit not-review-wide note.
    Missing summaries never mean no syntax change. Offline summaries keep
    identities/hashes/labels as static evidence without a second source viewer.
23. **Limits:** four concurrent requests, 32 cached files, 256,000 bytes and 10,000
    lines per version, 1,000 declarations, 100,000 tree nodes, depth 200 and 200
    displayed changes are accepted initial bounds.
24. **Latency:** a cooperative 150ms parse deadline per version, 5-second Git-call
    timeouts and traversal bounds are not end-to-end latency guarantees or a broad
    performance benchmark.
25. **Dependencies:** pinned `web-tree-sitter@0.25.10` and
    `tree-sitter-wasms@0.1.13` are accepted for the initial implementation. Actual
    ABI compatibility and host compiled asset availability were tested. There are
    no project build imports, LSP/JVM startup or runtime downloads; installation
    used `bun install --ignore-scripts`.
26. **Footprint/provenance:** the installed grammar pack is about 49 MB; selected
    runtime/TS/TSX/Kotlin WASM assets are about 8.6 MB. Pinned published artifacts
    and integrity are used; reproducible source rebuilds of every grammar and all
    release platforms were not verified.
27. **Licensing:** runtime and TS/Kotlin upstream MIT notices plus the wrapper's
    Unlicense are embedded at `/semantic-diff-notices.txt`. This does not establish
    full release packaging verification.
28. **Compatibility:** existing Peek, call flows, impact analysis, sequence
    navigation and review schemas remain authoritative. No provider integration,
    Monaco migration or scope folding was added.
29. **Validation boundary:** scoped tests/browser checks and a host compiled smoke
    establish local implementation only. Full integrated-tree, cross-platform,
    comprehensive accessibility and release verification remain separate.
30. **Workflow:** shared dirty changes are preserved; no commits, pushes, releases,
    global installs or worktrees. One mutex violation during comment-only cleanup
    was reported; coordinator/prior owner confirmed no overlap or lost content.
    No further shared write is planned; the replacement owner-marked mutex applies
    if one becomes necessary.

#### Semantic peer file ownership and artifacts

Topic files reported by the peer are listed below. Other dirty edits in shared
files remain owned by their peers or earlier work; this list does not claim each
whole-file diff belongs to semantic work.

- Dependencies: `package.json`, `bun.lock`.
- UI: `public/app.js`, `public/semantic-diff.js`, `public/semantic-diff.css`.
- Source/backend/export: `src/git.ts`, `src/server.ts`, `src/session.ts`,
  `src/export.ts`, `src/comparison-source.ts`, `src/semantic-diff.ts`,
  `src/semantic-diff-export.ts`, `src/semantic-diff-notices.txt`,
  `src/tree-sitter-runtime.d.ts`.
- Tests: `tests/semantic-diff.test.ts`, `tests/semantic-diff-source.test.ts`,
  `tests/ui-semantic-diff.test.ts`.
- Fixture/check scripts: `scripts/semantic-diff-fixture.ts`,
  `scripts/semantic-diff-smoke.ts`, `scripts/semantic-diff-browser.mjs`.

Temporary artifacts: `/tmp/diffcompass-semantic-dedicated-tests.log`,
`/tmp/diffcompass-semantic-tests.log`, `/tmp/diffcompass-semantic-desktop.png`,
`/tmp/diffcompass-semantic-mobile.png`, `/tmp/diffcompass-semantic-smoke`,
`/tmp/diffcompass-semantic-cli`, and owned disposable fixture
`/tmp/diffcompass-semantic-fixture-47633/`. These are local evidence artifacts,
not release assets or durable repository fixtures.

### Known committed-sequence limitations and active follow-ups

- Saved message anchors are quote-checked against old/new diff rows and the
  exact rendered artifact; stale or mismatched diagrams yield no bindings.
- Definition lookup reuses `resolveSymbolPeek` and `loadRepositoryFile`. The
  latter reads the workspace, not an isolated historical revision. Its results
  are name candidates, never validated old-side or runtime call targets.
- Opening a definition outside the visible changed-file diff may need full-file
  expansion. Do not claim all hidden/outside-diff targets work from source tests.
- Unit/integration verification is not a substitute for browser UX validation.
- Same-frame source changes and stale source selections merit a dedicated test.
- Source anchors persist; live lookup/return actions depend on authenticated
  routes. Existing diagram export does not establish offline lookup parity.
- The sequence/code peer's extension is described below. The points above record
  the committed baseline; they do not establish every new excerpt/source route.

### Synchronized sequence/code: final local handoff, bounded routing gap retained

The sequence peer reports **Maps → existing Sequence map artifact → Code steps**,
including existing navigation from consolidated Call flows to the Sequence map.
Supported Archify sequences now
show a scrollable code pane beside the existing canvas. Coordinator inspection
found a real initial-fit/readability defect after the first checks. The narrow
correction has visual sign-off: actual map width below 1040px stacks the pane,
and 133.333% initial scale makes the bundled 9px captions 12px. The viewport can
clip participants, lifelines or messages; no SVG content or viewBox is removed or
cropped. Users pan/zoom or explicitly Fit for an overview. Selection, resize and
Present preserve absolute x/y/scale rather than automatically refitting. App and
plain-iframe pointer matrices remain incomplete with an unknown cause. The final
handoff, exact checks and all 18 assumptions are now recorded. This
was uncommitted at the handoff and remains unreleased; it is not part of
`716edb8` or v2.0.0. It is now isolated on `review/sequence-code`; branch-specific
verification is recorded separately above.

Initial framing runs once per iframe. Explicit Fit uses the actual padded diagram
bounds, excluding the code pane and unrelated outer frame. Live/export sequence
height is `clamp(680px, 80vh, 900px)`; stacked code receives 35% with a 180px
minimum, while wide code uses `clamp(280px, 34%, 420px)`.

- Arrow/caption selection selects and reveals a step. User scrolling changes
  selection only, preventing a reciprocal scroll loop. Home/End/Up/Down provide
  keyboard selection.
- Reuses `sequenceCandidate` IR/IDs, `groundedSequenceSources`,
  `sequenceArtifactSources`, exact captured-row validation,
  `lookupSequenceDefinition`, existing symbol lookup/current repository reading,
  `sequenceSourceScript`, Archify relationship inspection, and existing
  source/return/camera/presentation routes. The read-only host has a
  `mountPreview`/disposer seam, not a second sequence model, resolver, viewer,
  call-flow workflow, diff engine or Monaco implementation.
- Captured old/new quotes remain distinct from explicitly labelled
  current-workspace name candidates. Candidates are not persisted or exported;
  saved anchor persistence is unchanged. Same-frame refresh revalidates captured
  evidence, clears candidates and superseded replies, and exposes recoverable
  failures. An unchanged `sourceTree` preserves focus across unrelated comment
  revisions; legacy sessions use conservative revision invalidation. Renamed old
  paths navigate via the existing canonical comparison file while retaining side.
- HTML exports embed the same offline walkthrough and captured excerpts,
  without live definition lookup or source-navigation actions. Markdown export
  is unchanged. This is specific offline walkthrough support, not full live-UI
  or cross-file source-navigation parity.
- Branches and loops remain intact in native Mermaid without the synchronized
  pane. A pane is not manufactured by flattening unsupported diagram structure.
- A separate bundled-renderer guard for optional `isPlaying`/`pause` calls when
  no guided view exists reportedly fixes a motion exception. Real reduced-motion
  and motion off/on checks passed; hidden/return behavior was simulated. Headless
  tabs stayed visible, so real browser-background visibility remains unverified.

Final focused tests and isolated Chrome checks are attributed to the peer below.
No general performance, complete accessibility or all-browser claim follows from
these fixture checks.

#### All sequence peer assumptions and tradeoffs

The final report in `/tmp/dc-sequence-completion.md` supersedes the initial
14-item handoff and earlier 640px/resize-Fit assumptions. All 18 final entries:

1. **Scope:** synchronized read-only evidence for the existing supported sequence
   IR, not runtime tracing, a new resolver/viewer, a new call-flow workflow or
   production editor migration.
2. **Identity:** existing message IDs are authoritative within their artifact.
   Repeated captions, self calls and returns keep those IDs; text is never identity.
   Invalid/duplicate identity disables projection rather than partially renumbering
   the story.
3. **Order/structure:** authored order is not execution-order evidence. Branches,
   loops and parallel constructs retain the native Mermaid fallback; no linearized
   walkthrough claims parity for unsupported semantics.
4. **Captured evidence:** existing bounded captured-row quote validation is the
   evidence boundary. Before/after side, old-path identity and exact comparison
   remain significant; missing historical context stays missing.
5. **Lookup:** explicit definition lookup is live current workspace and may be
   ambiguous, stale or name-only. A candidate is not an authoritative call target
   or historical source. Existing resolver/language limitations remain.
6. **Recovery:** missing/stale/unsupported evidence is visible and recoverable
   through existing actions. Comparison changes invalidate candidates; another
   lookup is explicit. Before/delta artifacts without matching anchors stay unlinked.
7. **Bounds:** read-only excerpts use lazy DOM materialization with at most 40
   steps, 8 anchors per step, 20 lines and 8,000 characters per excerpt. This is
   bounded, not unbounded virtualization; no background project indexing, parser
   or provider startup is added.
8. **Existing actions:** semantics-card View code and full source/diff
   Comment/Question actions retain existing routes. The excerpt adds no
   editing/comment subsystem. A future editor seam is only `mountPreview` plus
   cleanup.
9. **Per-frame state:** selection/scroll/camera are preserved while the same iframe
   survives, including source return and ordinary rerenders. No new durable
   cross-reload camera/selection format is claimed; a new frame gets the initial view.
10. **Persistence/export:** existing anchors persist; there is no new session/schema
    field. HTML exports save only validated excerpts with side/provenance and safe
    escaping, without live source/lookup controls or transient candidates. Markdown
    is unchanged.
11. **Synchronization:** manual scroll intent, animation-frame selection and
    equality handling separate select-only from reveal. Async observer echoes,
    preview loads and resize/restoration must not initiate another scroll. Repeated
    explicit heading activation can restore a renderer pin cleared in capture phase.
12. **Layout:** stacking below 1040px uses actual embedded map width, not browser
    width. The 680–900px frame and minimum 180px stacked code pane are chosen
    workspace tradeoffs, not universally ideal dimensions.
13. **Initial framing:** 133.333% assumes bundled v2.0.0 9px captions and SVG natural
    dimensions, yielding 12px in the verified fixture. The viewport may clip
    participants/lifelines/messages and require pan/zoom or explicit Fit. There is
    no font inflation, authored-content deletion or viewBox mutation.
14. **Fit/resize:** Fit is a complete overview and can be too small for reading in
    constrained panes. Resize/Present retain absolute x/y/scale rather than
    auto-refitting; a message may move outside a smaller viewport. Preserving user
    camera control is deliberate.
15. **Renderer/dependencies:** reuse the installed supported Archify interaction
    API and native Mermaid fallback. No renderer dependency or production Monaco
    integration was added. Optional guided-view compatibility is guarded narrowly
    at the actual API call.
16. **Verification limits:** Chrome 154/Playwright 1.63, the recorded fixture sizes,
    synthetic comparison data, desktop keyboard and pointer were tested. Real
    touch/pen, assistive technology, other browsers, broad repositories and genuine
    OS/background visibility were not verified.
17. **Pointer gap:** resized-Present routing remains app 15/16 and plain iframe
    14/16. Reproduced failures have no proven exact cause. Headed passes do not
    establish a headless-only defect or production immunity; no failed case is
    counted as successful.
18. **Delivery/ownership:** the shared dirty worktree stays uncommitted/unreleased.
    Other changes were preserved; docs remain documentation-agent-owned. The
    installed renderer and coordinator/peer fixtures were untouched. Fixture 47631
    remains for review.

#### Sequence peer file ownership

New topic files: `public/sequence-walkthrough.js`,
`public/sequence-walkthrough.css`, `public/sequence-walkthrough-host.js`,
`src/sequence-walkthrough.ts`, `tests/sequence-walkthrough.test.ts`,
`scripts/sequence-walkthrough-browser.mjs`, `scripts/sequence-framing-browser.mjs`,
and `scripts/sequence-pointer-browser.mjs`.

Narrow integrations: `src/sequence-source-embed.ts`, `src/archify-embed.ts`,
`src/server.ts`, `src/export.ts`, `public/app.js`, `public/styles.css`, and
`tests/sequence-sources.test.ts`. These contain other agents' changes too; the
peer does not own their entire diff. The peer reports compliance with the
replacement v2 mutex after the old protocol was retired, with no lock held.

## Whiteboard-inspired ideas

### Shared diff viewer investigation (2026-10-03)

Updated user direction: synchronized scrolling is desirable when it keeps the
selected sequence arrow and code step visible. Mermaid is not a product
requirement; React Flow or another renderer is acceptable if it serves the
interaction better. Investigate the shared code/diff surface first, then build
the sequence walkthrough around it. No viewer migration is approved yet.

#### What Whiteboard actually does

- Sequence messages and code-tour stops share a message identity. Arrow clicks
  request selection plus reveal; scrolling the code pane changes selection
  without requesting another code-pane scroll. This prevents feedback loops.
- Its React Flow sequence canvas and resizable guided-tour panel are separate
  from its code viewer. Choosing React Flow does not choose a diff engine.
- CodePeek/DocumentCodeView delegates rendering to an inline-editor host bridge.
  The desktop implementation uses vendored Code OSS editor infrastructure.
- Ordinary file diffs enable unchanged-region hiding. Structural/lens views
  instead use a custom diffr region model: native folding is disabled and shared
  per-file region state determines what is hidden. Consequently, stock Monaco
  alone will not reproduce every Whiteboard folding behaviour.
- Fold state is shared by views of the review comparison; it is not merely DOM
  visibility local to each code card.

Sources:

- [Sequence and selection](https://github.com/devdotfast/whiteboard/blob/main/packages/review/app/src/diagrams.tsx)
- [Tour-panel scroll synchronization](https://github.com/devdotfast/whiteboard/blob/main/packages/review/app/src/review-components.tsx)
- [Embedded code host](https://github.com/devdotfast/whiteboard/blob/main/packages/review/app/src/DocumentCodeView.tsx)
- [Desktop diff options and structural folding](https://github.com/devdotfast/whiteboard/blob/main/apps/review-desktop/code-oss/src/vs/review/services/reviewFilesDiffView.ts)
- [Shared fold state](https://github.com/devdotfast/whiteboard/blob/main/apps/review-desktop/code-oss/src/vs/review/services/reviewStructuralDiffSession.ts)

#### DiffCompass integration findings

Our current UI builds rows from parsed Git hunks in `renderDiff` and
`renderSplitSide`/`renderUnifiedRow` (`public/app.js`). It supports source-side
line identities, finding pins, conversation badges, range selection, word and
whitespace highlighting, split alignment, and proposal preview actions.
Several consumers locate source rows with DOM selectors; a viewer replacement
must move them behind a shared source-location interface, not silently break
them by replacing the HTML.

The current Expand context action requests a larger context for the entire file
(3 → 10 → 25 → 100 → 200), rather than expanding one hidden interval.
`loadDiffFileWithContext` in `src/git.ts` reruns Git with the requested context;
`expandedDiffFile` in `src/session.ts` pages the resulting rows (default 1,000,
maximum 2,000). True inline gaps require a stable comparison-backed range model,
not merely a different button. Never substitute live worktree contents for old
or captured comparison text.

#### Candidate approaches

| Approach | Useful existing capabilities | Remaining cost/risk |
| --- | --- | --- |
| Extend our HTML renderer | Existing review interactions and Git row alignment | Own local gap state, large-file rendering, keyboard behaviour, and reusable embedding |
| CodeMirror 6 + merge | Split and unified merge views; syntax folding; clickable unchanged-line widgets | Review annotations and navigation adapter; language support; stock widget expands a whole region and does not establish local incremental expand/re-collapse parity |
| Monaco diff editor | VS Code-family interaction model; unchanged-region controls and diff UI | Browser bundling/workers, model lifecycle, annotation adapter, embedded-card sizing and offline exports |

Primary references:

- [CodeMirror merge configuration](https://github.com/codemirror/merge/blob/main/src/mergeview.ts)
- [CodeMirror unchanged-region implementation](https://github.com/codemirror/merge/blob/main/src/deco.ts)
- [CodeMirror unified merge](https://github.com/codemirror/merge/blob/main/src/unified.ts)
- [CodeMirror folding services and gutter](https://github.com/codemirror/language/blob/main/src/fold.ts)
- [VS Code diff-editor unchanged-region defaults](https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/config/diffEditor.ts)

No production bundle-size/performance budget or complete visual parity has been
established. The fixture checks below do not establish those broader claims.

#### Recommendation and proposed next gate

Prototype **Monaco first**, in an isolated test fixture, because the desired UX
is closest to its editor family. This is an evaluation, not a decision to replace
the application or adopt Whiteboard's Code OSS fork. Compare against CodeMirror
if Monaco's embedding or delivery costs prove unsuitable. Do not change the
production renderer until the prototype demonstrates:

1. Inline unchanged-line gaps with local expansion and re-collapse. Scope-folding
   arrows were dropped on 2026-10-04 and are not a migration gate. Do not
   automatically hide changed code by a relevance heuristic.
2. Both split and unified presentation, correct old/new anchors, and navigation
   that reveals a folded target without losing its source version.
3. A finding marker, a range comment, selection actions, and return navigation.
   Folded regions must indicate hidden review annotations rather than imply none.
4. One shared viewer interface usable as a main diff or a sequence-step card.
   Source/model data can be shared; viewport and selection remain surface-local.
5. Stable scroll position through expand/collapse, wrapping, and asynchronous
   sizing; no feedback loop with diagram selection.
6. Bounded handling of large files, lazy card mounting, read-only operation,
   locally bundled assets, keyboard accessibility, and a viable offline-export
   strategy. Unsupported syntax should retain honest text-context controls.
7. Snapshot-aware state: refresh invalidates obsolete ranges; file renames,
   additions/deletions, CRLF, and missing source cannot corrupt anchors.

Prototype behaviour discussed before implementation:

- Unchanged context starts collapsed; changed code stays visible by default.
- Navigation automatically reveals its target. Other collapsed context
  intervals stay collapsed.
- Share manual context choices between views of the same comparison/file where
  region identities match, but never share scroll position between cards.
- Use local reveal-above/reveal-below/reveal-all controls where supported; exact
  interaction and re-collapse placement must be visually checked in the fixture.

#### Prototype outcome: comparison available, migration not approved

User approved an isolated Monaco prototype and requested the current renderer
beside it. Implemented under `prototypes/diff-viewer` on the separate
[prototype branch](REVIEW_BRANCHES.md),
with a dedicated pinned dependency, disposable Git review, the actual current
renderer in one pane, and identical before/after source models in the other.
Comments and questions use the real API; only agent answers are explicitly
synthetic. Production renderer files/dependencies were not changed by this spike.

The linked README records the full feature-parity matrix and reproducible tests.
Key findings:

- Native local unchanged-context reveal/re-collapse works. Review forms can use
  view zones, with accessibility, stacking and source-side mapping adjustments.
- **Stock Monaco disables function folding in diff editors**, even when the
  outer options request it. It works in ordinary View source. This is a recorded
  limitation, not a remaining requirement: scope-folding arrows were dropped.
- Deleted-line selection in unified mode is browser DOM selection, not an
  original-editor range. The prototype blocks ambiguous review actions there
  and asks for Split mode. A production adapter must support it correctly.
- Hidden-annotation badges, full conversation/proposal workflows, snapshot
  refresh, exports, and reusable synchronized sequence cards remain unported.

2026-10-04 prototype follow-up: source-linked speech bubbles and labelled
priority badges are now present, with separate lanes for co-located discussions
and findings. Expanded unchanged sections also expose explicit local collapse
buttons. A dedicated sign lane places `+`/`−` before line numbers without
overlapping review badges. The ordinary toolbar still uses the existing resolver
bridge; native TypeScript inline Peek was verified only on fixture definitions.

Recommendation: use this side-by-side comparison to evaluate the interaction,
but do not migrate yet. Unified deleted-line actions, per-gap hidden-annotation
badges, full comment/question/proposal parity, snapshot refresh, exports,
cross-file version-aware integration, performance and accessibility remain open.
One earlier rapid-switch run emitted Monaco `Canceled`; retain model-lifecycle
stress testing as a gap. Syntax/hover is not project-aware IntelliSense.

The authorized sequence item is **a diagram plus synchronized, scrollable code
pane**, extending the existing sequence/source workflow. Its peer implementation
is in progress independently of the unapproved production Monaco migration.
React Flow remains an optional research candidate; it is not required to replace
the existing diagram. Preserve source identities, branch/loop information and
saved-review compatibility.

Reference project: <https://github.com/devdotfast/whiteboard>.
The current decisions below supersede the initial discussion-only queue. They
are not claims of Whiteboard parity or completed implementation.

| Idea | Existing overlap | Current decision |
| --- | --- | --- |
| Synchronized sequence/code | Symbol Peek and sequence source links already exist | Final local implementation/readability handoff recorded with all 18 assumptions; main checks pass, but app 15/16 and plain-iframe 14/16 pointer matrices retain unknown-cause failures |
| Before/after call paths | Native Changes / Before / After, branches, recursion and evidence already exist | Exposure repaired locally through one native view; no new call-flow implementation |
| Design decision log | Conversations, findings and activity already capture evidence | Completed local reviewer-curated index; final focused/browser checks, separate socket rerun and all 17 assumptions recorded; uncommitted/unreleased |
| Semantic diff | Text/word diffs and structural evidence already exist | Accepted scoped local Syntax changes; all 30 assumptions, exact peer checks/files, separate coordinator rerun and limitations recorded; uncommitted/unreleased |

The prematurely implemented Whiteboard-inspired card previews were reverted at
the user's request. That includes preview rendering, preview/navigation
fingerprints, and the associated full-file-opening follow-up. Sequence-arrow
source navigation was retained and committed separately. No replacement
call-flow implementation was made.

Skill extraction is separate in-progress work, not part of this proposal.

## Follow-up discussion queue

Implementation for the four assigned topics is authorized. Status below is an
evidence checkpoint, not a reason to wait for another product approval.

- [x] **Call-flow discoverability and parity:** agreed on a single native view.
  Implemented locally; Archify workflow generation removed and saved duplicates
  hidden. Navigation covers all-converted, mixed, empty, and stale saved reviews;
  briefing links, regeneration, and exports use the complete call-flow view.
  Release and browser visual verification remain separate steps.
- [ ] **Synchronized sequence/code:** implementation/readability handoff and all
  18 assumptions complete, with accepted visuals and passing main groups. Validation
  remains bounded: app pointer matrix 15/16 and plain iframe 14/16 retain failures
  without a proven cause. Genuine background visibility is unverified. Native
  Mermaid branch/loop fallback and HTML/Markdown limits remain explicit.
- [x] **Design decision log:** completed local scope, final focused/browser checks,
  all 17 assumptions and a separate successful socket-suite rerun recorded.
  Original full-suite failures remain historical; the later coordinator integrated
  pass is recorded separately. No release claim is made.
- [x] **Semantic diff:** accepted scoped local implementation. All 30 assumptions,
  focused/overlap tests, browser/compiled smoke, separate coordinator rerun, files,
  pinned dependencies and embedded notices recorded. Exports cover only requested
  cached summaries; grammar/fallback and coverage limits remain explicit. The
  integrated verification below is separate from the peer's scoped checks; none
  of these is a release claim.
- [x] **Documentation alignment:** four docs now distinguish released, local,
  in-progress, prototype and unsupported scope. Peer outcomes may require a
  later reconciliation; unfinished features are not marked done here.

Skill extraction remains outside this delegation; its agent is not interrupted.

## Evidence and documentation caveats

Inventory sources include:

- `README.md`, `ROADMAP.md`, and `docs/product-roadmap.md`.
- `public/app.js` and `public/index.html` for current UI exposure.
- `src/call-flows.ts`, `src/flows.ts`, and `src/archify.ts` for diagram models,
  validation, and conversion boundaries.
- `src/sequence-sources.ts` and `src/sequence-source-embed.ts` for sequence
  source navigation.
- `src/dry-runs.ts`, `src/session.ts`, and corresponding UI code for simulations.
- `src/map-routes.ts` for bounded route enumeration and chronological sequence
  routes.
- `src/domain-context.ts` and `src/cli.ts` for context and operational features.

The roadmap's stale future-only labels for Archify, structural impact and dry
runs have been reconciled against their tagged implementations. It must not be
used alone as proof that a feature is absent. Code existing does not establish
that it is reachable, enabled for every session, browser-verified or released.

### End-to-end audit evidence

| Area | Data/backend | UI exposure inspected | Persistence/export and test evidence |
| --- | --- | --- | --- |
| Call flows | `CallFlow`, `src/call-flows.ts`, outline generation and regeneration; existing native model reused | `savedCallFlows`, `openCallFlow`, native card modes and Maps navigation; no workflow companion | Existing outline store; workflow filtering in both exports; `call-flow-navigation`, `call-flows`, `archify`, `export` tests |
| Sequence links | `SequenceMessageSource`/`SequenceSourceAnchor`, `src/sequence-sources.ts`, authenticated `/api/sequence-sources/:id`; existing Symbol Peek reused | `src/sequence-source-embed.ts` semantics card, trusted iframe messages, source/return controls | Anchors validated in store; live lookup is not offline export parity; `sequence-sources`, `store`, `archify-embed`, `server` tests |
| Impact | `StructuralBlastRadius`, validators, bounded generation repair and optional diagnostics | Maps → Explore impact, symbol picker, graph/source return, escaped warning and empty-state text | Stored diagnostics; per-result exports exist but overall diagnostic export gap remains; `structural-blast-radius`, `impact-repair`, `store`, `export` tests |
| Dry runs | `DryRunPlan`/`DryRunTrace`, `src/dry-runs.ts`, session lifecycle and `/api/dry-runs/*` routes | Dry runs tab, linked Simulate, draft inputs, preparation/cancel, independent trace navigation | Persisted traces, stale checks and optional prepared-trace exports; `dry-runs`, `store`, `export` tests |
| Map preferences | Existing Archify adapter and `public/map-presentation.js` frame protocol | Current-frame sender validation and viewer preference controls | Origin-local browser storage; no new session model; `map-presentation`, `archify-embed` tests |
| Finished explanations | Existing `src/agent.ts` Codex transport and final-message file | Finished tour explanation consumes the final response | Existing explanation/session path; `codex-final-message` transport and parser tests |

### Verification ledger (2026-10-04)

**Documentation agent, fresh automated run:**

```sh
bun test tests/call-flow-navigation.test.ts tests/sequence-sources.test.ts tests/structural-blast-radius.test.ts tests/dry-runs.test.ts tests/impact-repair.test.ts tests/codex-final-message.test.ts tests/map-presentation.test.ts tests/archify-embed.test.ts tests/archify.test.ts tests/export.test.ts tests/store.test.ts
```

Result: **114 passed, 0 failed, 713 assertions across 11 files**. These are
unit/integration, generated-script/VM and source-contract checks. They ran on
the shared worktree before later peer integrations, not an immutable release
candidate. This was not `bun run verify`, and it was not a browser run.

**Coordinator, separately reported fresh automated run:**

```sh
bun test prototypes/diff-viewer/fixtures.test.mjs prototypes/diff-viewer/annotations.test.mjs prototypes/language-support/protocol.test.mjs
```

Result: **37 passed, 0 failed, 61 assertions across 3 files** (33 diff-viewer and
4 protocol tests). This is independent of the documentation agent's 114 checks.

**Previously recorded browser verification, not rerun in this audit:** the
coordinator reports `smoke.playwright.js` (independent context gaps, exact-source
return, comments/questions, read-only modes/model disposal), `badges.playwright.js`
(keyboard/click bubbles and P2, co-location, local context collapse),
`quotes.playwright.js` (exact quote/edit/activity/caret/before-side cases), and
`gutter.playwright.js` (unified/split signs before numbers, badge separation,
four-digit/2,729-line and added/deleted/text fixtures, P2 click). The rapid-switch
`Canceled` observation remains unresolved. These prototype results do not verify
the new peer features or the local Call-flow consolidation in a browser.

**Current browser gap:** the documentation agent's UI tool reported no available
browser. A separate disposable review fixture was prepared on port 47624, but
fixture preparation and source inspection are not visual or keyboard UX checks.
No coordinator fixture server was stopped. Mobile, screen-reader, performance
and cross-platform release-binary validation were not performed by this audit.

**Documentation checks:** `git diff --check` passed. An inline Python checker
resolved all 35 relative Markdown links and heading anchors across the four docs
with zero errors. Read-only HTTP checks returned 200 for all 15 public reference
URLs. The private v2.0.0 release URL returned unauthenticated 404 as expected;
authenticated `gh release view` verified it separately. HTTP success does not
revalidate the linked technical claims or fragment targets.

**Recorded Kotlin probe:** kmp-lsp v0.26.0 had 9/16 passing checks and 7 failures
in each of two cold runs. The source-only fixture uses a Compose annotation stub;
it is not a real Android/KMP build or proof of compiler/dependency correctness.
No provider was installed or bundled by this work.

**Decision-log peer, earlier interim outcome (superseded by final counts below):**
reported 15 dedicated tests and
**160 targeted tests passed**. An isolated Chrome run passed **16 checks**, with
no page errors: create/correct/remove, keyboard/cancel/focus, disk and reload
persistence, actual comparison refresh with deleted/edited references, escaped
hostile text, network failure/retry, offline HTML/Markdown, and 390px overflow.
These browser checks belong to the decision-log peer, not the earlier prototype
runs or the documentation agent. Exact commands were not supplied in this report.

The peer's original full-suite attempt recorded **636 passes, 24 listen/EADDRINUSE
socket failures, 4,988 assertions across 76 files**. Original evidence is retained
at `/tmp/diffcompass-decision-log-suite.log`. This remains a failed historical
run, not rewritten as green by the confirming subset rerun below.

**Decision-log peer, final focused verification:**

```sh
bun test tests/decision-log.test.ts tests/export.test.ts tests/store.test.ts tests/server-handler.test.ts tests/ui.test.ts
bun run typecheck
node --check public/decision-log.js
node --check public/app.js
node --check scripts/check-decision-log-browser.mjs
git diff --check
```

Reported result: **161 passed, 0 failed, 1,792 assertions**, including 16 dedicated
decision-log tests; typecheck, syntax and whitespace checks passed.

**Separate approved local-listen rerun of the affected suites:**

```sh
bun test tests/server.test.ts tests/remediations.test.ts tests/bridge-command.test.ts
```

Reported result: **35 passed, 0 failed, 173 assertions**; evidence at
`/tmp/diffcompass-decision-log-network-tests.log`. No unresolved failures remain
in those rerun suites. This does not mean the entire later moving worktree was
rerun, and the documentation agent did not rerun either test command.

**Decision-log peer, final isolated Chrome run:**

```sh
node scripts/check-decision-log-browser.mjs /Users/ricardo.costeira/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs /tmp/diffcompass-decision-log-fixture/session.json
```

Reported result: **18 checks passed, zero page errors**. Coverage includes
empty/create/correct/remove, keyboard/cancel/focus, reload/disk persistence,
other-client polling, click-time freshness recheck, actual edited/deleted sources
and comparison refresh, hostile-text escaping, failed-request draft retention and
retry, Markdown endpoint, offline HTML tab reachability and 390px overflow.
Evidence: `/tmp/diffcompass-decision-log-browser.log`; the peer visually inspected
`/tmp/diffcompass-decision-log-mobile.png`. An independent ephemeral Chrome profile
was used, without installation or stopping other browsers/servers. The peer left
fixture port 47632 running. These are peer results, not documentation-agent browser
checks or a Safari/Firefox/touch/assistive-technology audit.

**Semantic peer, earlier interim outcome (superseded by later counts below):**
reported **16 dedicated tests and 131
assertions passed**, including captured-source expansion and anchor paging beyond
1,000 rows. A compiled/minified smoke binary run from `/private/tmp` passed
TS/TSX/Kotlin fixtures using embedded WASM. These results are separate from the
earlier audit and prototype counts, and were not rerun by the documentation
agent; exact commands were not supplied in that interim report. Browser checks
and notices were still pending at that checkpoint; the later report follows.

**Semantic peer, completed-implementation report:** **20 dedicated tests/194
assertions passed** and a separate overlapping selection of **94 tests across
10 files/743 assertions passed**. Counts must not be added as disjoint coverage.
Typecheck, JavaScript syntax and diff checks passed. Isolated Chrome passed
keyboard interaction, old/new navigation, unified layout, Kotlin, parse and
unsupported fallbacks, failed request/Retry and 390px fallback, with no page
errors. Compiled/minified host CLI and outside-checkout TS/TSX/Kotlin embedded
WASM smoke passed. Notices are embedded at `/semantic-diff-notices.txt`. The
complete assumptions and file/artifact inventory are recorded above; exact peer
commands follow. These remain peer-attributed results, not a documentation-agent
rerun or a full-repository, cross-platform or release check.

**Semantic peer, exact final commands** (repository commands run from
`/Users/ricardo.costeira/Documents/diffcompass`):

```sh
bun test tests/semantic-diff.test.ts tests/semantic-diff-source.test.ts tests/ui-semantic-diff.test.ts > /tmp/diffcompass-semantic-dedicated-tests.log 2>&1
```

**20 passed, 0 failed, 194 assertions**; rerun after the final internal identity
change. The following overlapping selection passed **94 tests, 0 failed, 743
assertions across 10 files**; it is not a full integrated-repository suite:

```sh
bun test tests/semantic-diff.test.ts tests/semantic-diff-source.test.ts tests/ui-semantic-diff.test.ts tests/git.test.ts tests/server-handler.test.ts tests/export.test.ts tests/ui-diff-presentation.test.ts tests/ui-inline-diff.test.ts tests/call-flow-navigation.test.ts tests/sequence-walkthrough.test.ts > /tmp/diffcompass-semantic-tests.log 2>&1
bun run typecheck
git diff --check
node --check public/semantic-diff.js
node --check public/app.js
node --check scripts/semantic-diff-browser.mjs
```

Typecheck, syntax and diff checks passed; typecheck and diff-check were also
rerun after the final type-only `TourAnchor` reuse. Host compilation checks:

```sh
bun build --compile --minify scripts/semantic-diff-smoke.ts --outfile /tmp/diffcompass-semantic-smoke
bun build --compile --minify src/cli.ts --outfile /tmp/diffcompass-semantic-cli
```

The peer then ran `/tmp/diffcompass-semantic-smoke` with cwd `/private/tmp`:
TS/TSX/Kotlin parser-backed body-change checks passed using embedded WASM. Running
`/tmp/diffcompass-semantic-cli --version` from `/private/tmp` succeeded and printed
the existing `2.0.0` version; this was a temporary compiled binary, not a release
or installation.

Fixture and isolated-browser commands:

```sh
bun run scripts/semantic-diff-fixture.ts
PLAYWRIGHT_MODULE=file:///Users/ricardo.costeira/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs node scripts/semantic-diff-browser.mjs
```

The fixture remains on loopback port 47633; no other fixture was stopped. The
browser used isolated headless Chrome, not the shared MCP profile. **Eleven PASS
checks:** keyboard TS summary, original diff retained, Before old-side, After
new-side, unified old-line identity, Kotlin result, transport failure/Retry,
parse-error fallback, unsupported fallback, 390px bounds and zero page errors.
This is a basic responsive fixture check, not a touch/accessibility certification.

**Coordinator semantic checkpoint, separately reported:** inspected the semantic
desktop/mobile screenshots and full captured-change coherence implementation.
A fresh core/source rerun passed **18 tests/180 assertions**; typecheck and
diff-check passed. At that checkpoint the complete three-file dedicated set was
still running; its completed result is recorded separately below. These are
overlapping checks, not additional disjoint coverage. Browser and compiled
outside-checkout TS/TSX/Kotlin evidence remains attributed to the semantic peer.
Scoped local acceptance was conditional on the peer's complete final assumptions;
all 30 are now recorded above.

**Coordinator semantic three-file rerun, independently completed later:**

```sh
bun test tests/semantic-diff.test.ts tests/semantic-diff-source.test.ts tests/ui-semantic-diff.test.ts
bun run typecheck
git diff --check
```

Result: **20 passed, 0 failed, 194 assertions across 3 files**; fresh typecheck
and diff-check passed. This coordinator run is separate from the peer's matching
dedicated count, 94-test overlap selection, Chrome and compiled-binary evidence.
It is not a full-repository test run. The later semantic handoff repeated an older
“three-file rerun pending” observation; this completed coordinator result
supersedes that stale note. Semantic assumptions, file inventory and exact peer
commands are now recorded. Sequence visual sign-off and final handoff are
recorded below, with incomplete resized-Present pointer validation retained.

**Sequence peer, pre-correction verification:** **159 tests across 8 focused suites passed,
1,816 assertions**. The peer reports typecheck, `node --check` for `public/app.js`,
`public/sequence-walkthrough.js` and `public/sequence-walkthrough-host.js`, and
`git diff --check` passed. Exact focused-suite invocation was not supplied.

The isolated Chrome script `scripts/sequence-walkthrough-browser.mjs` passed
**8 groups with zero page errors**: real mouse arrow selection; real wheel
selection without feedback/camera movement; keyboard; same-frame presentation
and source return; lookup abort/retry with current-source labelling; motion
off/on/reduced motion; 600px stacked layout; and offline HTML with all network
blocked. The peer visually inspected `/tmp/sequence-desktop.png` and
`/tmp/sequence-narrow.png`. **Coordinator inspection subsequently confirmed a real
initial-fit defect.** A narrow readable-framing/stacking correction followed,
with coordinator visual acceptance recorded below. The results above describe
the earlier implementation and must not be presented as post-correction results.

Headless tabs did not become `document.hidden`; hidden/return was explicitly
tested with simulated `visibilitychange`. Genuine background-tab behavior, real
touch and assistive technology remain unverified. The optional guided-API motion
guard has absent/partial/playing/not-playing/no-pause, paused-edge and idempotent
replacement coverage; the installed renderer was not modified. These are
peer-reported checks, not documentation-agent reruns or a green full-suite claim.

**Coordinator post-correction sequence visual sign-off: accepted.** The
coordinator inspected all four images:

- `/tmp/sequence-desktop-workspace-initial.png`
- `/tmp/sequence-desktop-present-initial.png`
- `/tmp/sequence-narrow-workspace-initial.png`
- `/tmp/sequence-narrow-present-initial.png`

Accepted tradeoff: 133.333% initial scale makes bundled 9px captions 12px and can
clip content in the viewport, with pan/zoom and explicit Fit available. Stacking
uses actual embedded map width strictly below 1040px; selection, resize and
Present do not automatically refit. The older `/tmp/sequence-fit-*`,
`/tmp/sequence-desktop.png` and `/tmp/sequence-narrow.png` images are pre-fix and
must not be used as evidence of the corrected layout.

**Sequence peer, final post-correction focused checks:**

```sh
bun test tests/sequence-walkthrough.test.ts tests/sequence-sources.test.ts tests/archify-embed.test.ts tests/export.test.ts tests/ui.test.ts tests/call-flow-navigation.test.ts tests/map-presentation.test.ts tests/archify-camera.test.ts
bun run typecheck
node --check public/app.js
node --check public/sequence-walkthrough.js
node --check public/sequence-walkthrough-host.js
node --check scripts/sequence-walkthrough-browser.mjs
node --check scripts/sequence-framing-browser.mjs
node --check scripts/sequence-pointer-browser.mjs
git diff --check
```

**160 passed, 0 failed, 1,824 assertions across 8 files**; typecheck, all listed
syntax checks and diff-check passed. Log: `/tmp/dc-sequence-test-results.txt`.
This supersedes the peer's 159-test pre-correction count, without implying a full
integrated-tree rerun.

**Final browser environment and commands:** peer used Playwright 1.63.0 and
Chrome 154.0.8037.97 with ephemeral isolated profiles, without installation.
The fixture on port 47631 reads the installed renderer from
`/Users/ricardo.costeira/.local/share/diffcompass/2.0.0/share/diffcompass/archify`
through `DIFFCOMPASS_ARCHIFY_DIR`; installed files were not edited. The commands
below use the existing Playwright module. `<authenticated-fixture-url>` means
the fixture's printed tokenized URL; its token is deliberately not copied here.

```sh
PLAYWRIGHT_MODULE=file:///Users/ricardo.costeira/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs node scripts/sequence-walkthrough-browser.mjs '<authenticated-fixture-url>'
PLAYWRIGHT_MODULE=file:///Users/ricardo.costeira/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs node scripts/sequence-framing-browser.mjs '<authenticated-fixture-url>'
PLAYWRIGHT_MODULE=file:///Users/ricardo.costeira/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs node scripts/sequence-pointer-browser.mjs '<authenticated-fixture-url>'
SEQUENCE_POINTER_PLAIN=1 PLAYWRIGHT_MODULE=file:///Users/ricardo.costeira/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs node scripts/sequence-pointer-browser.mjs '<authenticated-fixture-url>'
```

The main walkthrough run passed **8 groups with zero page errors**: real arrow
click; real wheel/select-only with delayed-echo check; keyboard; source/return
with the same iframe, camera, Present and source step; failed lookup/retry/current
label; motion/reduced motion/simulated visibility; narrow pane; and fully visible
ordinary offline pointer activation, including repeated selected headings. Child
pointerdown/up/click traces were captured for both offline activations, with an
empty parent trace. No forced click or JavaScript activation counted as a pass.
Log: `/tmp/dc-sequence-browser-results.txt`.

The framing run passed **4 fresh contexts**: 1440×1000 desktop and 600×900 narrow,
each in workspace and Present. It checked 12px initial labels, actual-width
stacking, code overflow/minimum height, no horizontal document overflow,
3 participants/4 arrows/unchanged viewBox, real explicit Fit to diagram bounds,
and camera invariance after resize/host rendering. Fit scales were .697826
(desktop workspace), 1 (desktop Present), .528261 (narrow workspace), and .597826
(narrow Present). Those are overview tradeoffs, not guaranteed reading sizes.
Logs: `/tmp/sequence-framing-run.txt`, `/tmp/sequence-framing-results.json`.

In addition to the four accepted initial screenshots above, the peer supplied
post-correction explicit-Fit views: `/tmp/sequence-desktop-workspace-fit.png`,
`/tmp/sequence-desktop-present-fit.png`, `/tmp/sequence-narrow-workspace-fit.png`,
and `/tmp/sequence-narrow-present-fit.png`. These differ from the older stale
`/tmp/sequence-fit-*` files.

**Remaining pointer-routing gap — failures retained:** the app matrix passed
**15/16** real-pointer cases (desktop/narrow × normal/Present × fresh/resized ×
headed/headless). The failing row was headless desktop Present after
1440→1420→1440 viewport resize; the headed equivalent passed. All **16 camera
invariance checks** passed independently, not as replacements for pointer tests.
Evidence: `/tmp/sequence-pointer-results.json`, `/tmp/sequence-pointer-run.txt`.

The separate plain-button reproduction passed **14/16**: resized-Present desktop
and narrow rows failed in the headless runs of this matrix. All headed and all
fresh/normal cases passed. It retains app DOM/CSS nesting, removes every script,
and replaces the renderer with one fixed button, using the same popover/fixed
geometry. It contains no camera, walkthrough, selection, drag or presentation
controller; the diagnostic harness performs expansion/resizing. Evidence:
`/tmp/sequence-pointer-plain-results.json`, `/tmp/sequence-pointer-plain-run.txt`,
`/tmp/sequence-pointer-plain-desktop.html`,
`/tmp/sequence-pointer-plain-narrow.html` (using the fixture stylesheet).

Failure traces show parent pointerdown/up/click targeted the iframe but no child
events. The top-level hit stack lists the iframe first, without an overlay. The
failed desktop frame and visual viewport were 1440×1000, offsets zero, scale 1;
no pointer capture, is-panning or just-panned state was active. The app failure
point `(942.42, 963.61)` was inside the visible frame. This establishes a
reproduction without the controller, **not** the exact browser/compositor/CSS
cause or immunity in other environments. It must not be labelled a proven
headless-only defect. DOM hit tests/JavaScript activation were diagnostic only,
not pointer successes. No speculative production routing fix was added.

The final handoff is `/tmp/dc-sequence-completion.md`. The local implementation
and accepted readability correction are complete with this bounded unresolved
gap. These results are not a single all-checks-green result; genuine background
visibility, touch/pen, assistive technology and other browsers remain unverified.
Fixture 47631 and the peer pane remain available. All sequence results above are
peer-reported; the four initial-view acceptances are coordinator-attributed.

### Coordinator final integrated verification

The coordinator reports the following sequence after runtime work finished.
These are distinct runs, not summed coverage or retroactively corrected results:

1. **Initial integrated `bun run verify`: 666 passed, 1 failed, 5,206 assertions
   across 76 files.** The sole failure in `tests/diagram-labels.test.ts` expected
   an exact server source concatenation string. `semanticDiffScript` legitimately
   sits between the caption helper and application script. The actual caption
   geometry/render checks passed. The original failed run remains recorded here.
2. **Test-only correction:** the coordinator changed only
   `tests/diagram-labels.test.ts` and `tests/server-handler.test.ts`, replacing the
   brittle source-order assertion with a served `/app.js` integration check for
   exact helper/application content and dependency order. No runtime behavior was
   changed. The coordinator reports acquiring/releasing the v2 mutex correctly.
3. **Targeted rerun:** `tests/diagram-labels.test.ts` and
   `tests/server-handler.test.ts` passed **28 tests, 0 failures, 567 assertions**;
   `git diff --check` passed.
4. **Fresh full `bun run verify`: exited 0.** Typecheck passed, then **668 tests,
   0 failures, 5,216 assertions across 76 files in 54.40s**, followed by successful
   `node --check` for `public/theme.js`, `public/app.js` and
   `public/diagram-labels.js`. Complete log:
   `/tmp/diffcompass-integrated-verify-final.log`.

The documentation agent inspected that final log's invocation and summary; it
did not rerun the integrated suite. The earlier decision-log **636-pass/24-socket-
failure** run and its separate approved rerun remain historical evidence. The
final integrated pass supersedes neither browser evidence nor open gaps: sequence
pointer matrices remain **app 15/16, plain iframe 14/16**, with no proven cause or
production-immunity claim. Genuine background visibility, touch/assistive and
cross-platform/release verification remain outside this automated pass. The
research implementation was local and uncommitted/unreleased at that verification
checkpoint; no commit or release was performed in that run. Later preservation
and branch-isolation commits do not turn this result into extraction validation.

**Final documentation reconciliation checks:** tracked-doc `git diff --check`
and whitespace checks across all four docs passed; all 35 local Markdown links
and heading anchors resolved. Completeness checks confirmed every numbered peer
assumption: decision log 17/17, semantic 30/30 and sequence 18/18. No runtime
changes or new runtime test execution were performed by this reconciliation.

## All documentation-audit assumptions

1. **Scope/ownership:** only README, ROADMAP, this inventory and the product-roadmap
   pointer are documentation-agent deliverables. Runtime fixes, tests, prototype
   code/docs, skill extraction and integration contracts remain with their owners.
2. **Release evidence:** authenticated latest-release metadata and remote main
   queries establish the observed delivery baseline. A peeled tag, package
   version, local branch name or test count alone is not a published-release claim.
3. **Installation:** the fresh `2.0.0` version output is sufficient to label the
   observed installation version, not to prove binary identity or every feature
   works on that installation. No update/release/install was requested or done.
4. **Moving worktree:** observations are a dated checkpoint in a shared dirty
   worktree. Later peer edits can invalidate source locations, counts and gaps;
   only verified peer outcomes should change an in-progress status.
5. **Information architecture:** README is the usage guide, ROADMAP the canonical
   delivery index, RESEARCH the evidence/decision record, and product-roadmap a
   pointer. No fifth feature-status system is needed.
6. **UX/reachability:** inspected controls and handlers establish a code path, not
   visual usability. Conditional categories, hidden briefing sections, empty
   sessions, disabled generation and stale data must remain explicit.
7. **Existing behavior:** call flows, impact, dry runs, Archify and sequence source
   navigation are extensions/reuse targets. Old roadmap wording is not authority
   to rebuild them, and saved duplicates may be hidden without deletion.
8. **Provenance:** authored/static maps and simulated traces are not runtime truth;
   name matches are candidates; an agent's inferred rationale is not a recorded
   decision. Peer decision-log claims require explicit evidence and curation.
9. **Source versions:** validated old/new anchors and current-workspace lookup
   are distinct. The committed definition fallback does not prove historical
   source correctness; live files must never silently stand in for old evidence.
10. **Fallback/support:** missing evidence, unsupported syntax, ambiguity, stale
    selections, parser/provider failures and limits are honest outcomes. Mermaid
    and the text diff remain existing fallbacks; absence is not zero impact.
11. **Compatibility:** existing saved sessions/artifacts remain inputs; no schema
    migration, data deletion, production Monaco migration or external-tool
    replacement is part of this documentation assignment.
12. **Persistence/export:** session persistence, browser-origin preferences and
    portable offline export are separate capabilities. Overall impact diagnostics
    have an explicit export gap; live source lookup is not guaranteed offline.
13. **Performance:** existing bounded models and fixture checks justify only their
    documented limits. No production performance budget, worst-case latency or
    all-large-file claim was measured; the 2,729-line prototype is one fixture.
14. **Dependencies:** the audit adds none. Monaco/provider versions and Kotlin
    probe outcomes are attributed to the coordinator's isolated labs; approved
    TS/Kotlin direction is not shipped provider support or compiler-grade analysis.
15. **Verification:** the 114 audit checks, 37 coordinator checks, historical 561
    count and all peer/browser/probe results stay separately attributed. The later
    coordinator integrated 668-test pass is explicitly recorded as a separate run;
    it does not establish missing browser/mobile/accessibility or six-platform
    validation, or erase the unresolved pointer matrices.
16. **Tradeoffs:** retain inline unchanged-context controls, drop scope-folding
    arrows, and defer migration until the remaining real parity gaps are solved.
    Research alternatives are options, not new commitments.
17. **Links/history:** local documentation links should resolve within the current
    checkout; GitHub links may require repository access. Historical roadmap
    entries and upstream URLs are reference material, not freshly reverified
    product status unless an evidence check is recorded above.
