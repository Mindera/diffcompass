# Review branches — 2026-10-07

**Remote main is `e19cd7e`; the latest release is still v2.0.0 (`ec3c045`).**
Sequence/code and its earlier prerequisites merged in
[PR #3](https://github.com/rcosteira79/diffcompass/pull/3) on 2026-10-05; lifecycle
layout/source-return fixes merged in [PR #4](https://github.com/rcosteira79/diffcompass/pull/4)
on 2026-10-06. These changes are merged but unreleased.

For this documentation review, use
`/Users/ricardo.costeira/.herdr/worktrees/diffcompass/research-docs` and compare
`origin/main...review/research-docs`. Its own diff contains documentation only;
it inherits the merged runtime. The separate `main` checkout under the same root
is still at local `73f9247`, behind fetched remote main; do not mistake that cached
checkout for the latest remote state.

| Remaining review unit | Branch / worktree suffix | Observed tip / parent |
| --- | --- | --- |
| Documentation | `review/research-docs` / `research-docs` | Rebased on `e19cd7e`; current-status refresh plus preserved historical evidence. |
| Decision log | `review/decision-log` / `decision-log` | `e0157cf` / `e19cd7e`; unmerged. |
| Syntax diff | `review/syntax-diff` / `syntax-diff` | `cf6b2a6` / `73f9247`; unmerged and based before PR #4. |
| Viewer/provider prototype | `review/diff-viewer-prototype` / `diff-viewer-prototype` | `72449d6` / `e19cd7e`; unmerged experiment. |

Worktrees above are under `/Users/ricardo.costeira/.herdr/worktrees/diffcompass/`.
The original `8262d97` base and `0d22cbe` sequence extraction are now ancestors of
remote main; the eager-excerpt follow-up is included in merged `cc6f99b`, not
pending as three uncommitted files. Main also includes the optional-guidedViews
guard. The historical warning about extracting the old base alone still explains
that checkpoint, but is not a missing-guard warning about today's main.

Review limits to retain:

- PR #3 reports 636 passing automated tests and separate browser/renderer checks;
  PR #4 reports 652 and separate lifecycle/Chrome checks. Original isolated and
  combined counts are preserved, not carried forward as fresh current-tip tests.
- The earlier app 15/16, plain-iframe 14/16 and setup `outline` error/timeout are
  historical failures. Later startup guards and Chrome native-content viewport
  sizing/negative controls are separate evidence, not retroactive passes. Actual
  OS background visibility, other browsers, touch and screen readers remain
  unverified by the recorded work.
- The prototype's last recorded full browser run failed badges keyboard activation;
  successful retries did not establish its cause or a clean result. No new
  prototype validation is claimed here, and no production Monaco migration is
  approved. Scope-fold arrows remain dropped; inline context controls remain.
- Overall impact repair warnings/omission reasons still lack export parity.
  Decision-log provenance and syntax grammar/cache/export limits remain as
  documented. Combining their shared integration edits needs its own review.

The frozen original checkout at `/Users/ricardo.costeira/Documents/diffcompass`
and safety snapshot `39206b4` remain preservation artifacts, not merge targets.
The historical 69-file extraction audit and 668-test combined pass do not approve
integration. No push, merge, release, installation or fixture shutdown is part
of this documentation refresh. Local `/tmp` logs and fixture URLs are historical,
transient evidence; this refresh does not assert they still exist or serve the
current branch.

Use [README](README.md) for behavior and [ROADMAP](ROADMAP.md) for delivery.
[RESEARCH](RESEARCH.md#current-delivery-and-verification-2026-10-07) has the latest
fact checks, the full chronological evidence, all 65 original peer + 17 audit
assumptions, isolated handoff assumptions and explicitly superseded decisions.
