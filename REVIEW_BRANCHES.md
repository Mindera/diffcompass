# Review branches — 2026-10-04

Start in the clean main checkout:
`/Users/ricardo.costeira/.herdr/worktrees/diffcompass/main`.
Local `main` is unchanged at `716edb8`; released v2.0.0 is `ec3c045`.
Nothing below is merged, released or approved to merge.

All review worktrees live under
`/Users/ricardo.costeira/.herdr/worktrees/diffcompass/`:

| Review unit | Branch / worktree suffix | Compare against | Status |
| --- | --- | --- | --- |
| Earlier fixes | `review/pre-research-fixes` / `pre-research-fixes` | `716edb8` | **Unreviewed** base `8262d97`: map preferences/tooltips/motion, native Call-flow consolidation, impact repair, final-commentary fixes. |
| Sequence/code | `review/sequence-code` / `sequence-code` | `8262d97` | `0d22cbe`: 15 files; 594 tests, 8 interaction groups and 4 framing scenarios pass. Pointer gaps/setup timeout retained below. |
| Decision log | `review/decision-log` / `decision-log` | `8262d97` | `d5b8bd3`: 12 scoped files; independent 597 tests and 18 Chrome checks pass. Extraction accepted, not merge approval. |
| Syntax diff | `review/syntax-diff` / `syntax-diff` | `8262d97` | `886e173`: 22 files; 602 tests, 11 Chrome checks and host compiled smoke pass. Captured-source/cache/Kotlin limits retained. |
| Documentation | `review/research-docs` / `research-docs` | `8262d97` | Four snapshot docs reconciled plus this entry point; no runtime files. All original assumptions retained. |
| Viewer/provider prototype | `review/diff-viewer-prototype` / `diff-viewer-prototype` | `8262d97` | `2676dea`: 31 snapshot-identical prototype files; 618 tests pass. Fresh browser run failed badges keyboard activation; review blocker remains. |

The three feature branches are mutually independent and share only the
unreviewed base; no feature imports another research feature. **Review the base
separately:** its map-motion-on change lacks the optional-`guidedViews` guard,
which lives in sequence/code. Before considering the baseline without sequence,
review/extract that guard separately for bundled zero-guided-view maps (a known
browser exception). The baseline's 581 tests do not establish browser safety.
The docs branch describes these features but contains none of their runtime
implementations or the prototypes. Coordinator extraction audit: 69 single-owner
files match the snapshot, no missing/extra non-doc paths; shared app/export/server/
session edits still need integration review. No conflict-free merge promise.
Do not use the safety snapshot as an integration/merge candidate.

Coordinator-reported independent `bun run verify`: base **581 passed / 0 failed**;
prototype **618 / 0**, decision log **597 / 0**, sequence/code **594 / 0** and
syntax diff **602 / 0**. The prototype browser run exited 1: smoke, quotes and
gutter passed;
badges timed out waiting for keyboard activation. Focused/settled retries passed,
but the cause/intermittency remains unresolved, with no fix or clean-pass claim.
The old combined **668 / 0** run is historical evidence, **not extraction
validation or merge approval**. Exact counts, commands and attribution are in
[RESEARCH](RESEARCH.md#branch-isolated-verification-ledger).

Keep these review limits visible: sequence pointer matrices **app 15/16, plain
iframe 14/16**, unknown cause; the first isolated app run also had a setup
timeout and `Cannot read properties of null (reading outline)` page error before
artifact selection (14 delivered, 1 routing failure, 1 setup timeout), retained
separately from its 15/16 recheck. That error's cause is undiagnosed. Genuine
hidden-tab behavior remains unverified. Overall
impact repair warnings/omission reasons still missing from exports. Kotlin syntax
support is bounded by its grammar, not compiler-grade project support. Scope-fold
arrows remain dropped; inline unchanged-context controls remain required.

The original `/Users/ricardo.costeira/Documents/diffcompass` is frozen at
`39206b4` on `wip/research-snapshot-20261004`, preserving combined evidence and
running fixtures. Do not write there. Archive and checksum are recorded in
[RESEARCH](RESEARCH.md#snapshot-and-extraction-provenance). No fixture shutdown,
push, merge, release or DiffCompass installation is part of this handoff.

Use [README](README.md) for feature entry points, [ROADMAP](ROADMAP.md) for delivery
status, and [RESEARCH](RESEARCH.md) for all **65 peer + 17 original documentation
assumptions**, the full isolated handoff assumptions and additional isolation
decisions. Syntax's fresh harness targets 47643; committed fixture defaults still
target old 47633; decision-log's isolated harness targets 47652 while committed
browser defaults remain 47632. Do not substitute old-fixture results for a branch.
