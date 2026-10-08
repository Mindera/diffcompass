# Review branches — 2026-10-08

**Latest published release is v2.1.0 (`d889a0b`).** It includes the previously
inspected main `607e18b`: sequence/code, lifecycle improvements, optional Monaco,
GitHub-native suggestions and What changed in both renderers are released
(PRs #3–#9). This documentation branch remains based on `607e18b`.
See [ROADMAP](ROADMAP.md) for exact PR links and scope.

Review this branch at
`/Users/ricardo.costeira/.herdr/worktrees/diffcompass/research-docs` with
`git diff origin/main...review/research-docs`. It contains six documentation
paths, including the standalone [feature guide](docs/feature-showcase.html).
Both requested rebases preserved the showcase and replayed only docs commits.

| Review item | Current observation |
| --- | --- |
| Documentation/showcase | `review/research-docs`, rebased on `607e18b`. |
| Syntax diff | Released in v2.1.0 and expanded into What changed; original `886e173` extraction is historical. |
| Viewer prototype | Optional Monaco released in v2.1.0; original `2676dea` extraction is historical. The language probe still does not supply a production provider. |

Decision log was scrapped by the user and is not a remaining review candidate.
Its implementation handoff is archived in RESEARCH only.

The separate local main checkout was observed at `57bf907`; the original
Documents checkout remains frozen snapshot `39206b4`. Neither was switched or
edited by this task. Machine-local paths and temporary logs are not portable
deliverables. The snapshot and original 69-file extraction audit/668-test run
do not validate later implementations or form a merge target.

Current main includes the optional-guidedViews guard; its earlier baseline-only
warning remains archived. Original pointer matrices, outline-error/setup timeout
and prototype badge timeout remain historical failures. Later PR-specific
browser/CI reports are separate, including PR #9's reported passing CI and
base-reproduced local explorer-height failure. Only the standalone guide gets
fresh browser validation here, not the application.

[RESEARCH](RESEARCH.md#current-delivery-and-verification-2026-10-08) retains
every historical assumption, with later source behavior explicitly superseding
old delivery/prototype/Shiki-only labels. [README](README.md) explains usage.
No push, merge, release, installation or fixture mutation is part of this work.
