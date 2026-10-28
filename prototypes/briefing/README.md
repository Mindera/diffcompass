# Briefing preview

Run `bun run fixture:briefing-experiments` and open the printed URL. The default
port is 47561; pass `--port 0` for an available port. The preview displays the
chosen outcome-first narrative for each example, using the production reader,
code diff controls and evidence inspector. There is no reading-variant switcher.
Each code citation shows the captured change, including additions, deletions
and unchanged context.

To use examples from other local repositories, create
`prototypes/briefing/local/cases.ts` exporting
`buildReadingCases(root: string): Promise<ReadingCase[]>`. The server loads it
automatically when present. The `local/` directory is Git-ignored so repository
specific narratives and captured source can stay on the local machine. Use the
helpers in `capture.ts` to read pinned Git trees and validate excerpts and diagram
bindings through the production reader. Include `repositoryName` and an optional
GitHub `repositoryUrl` on each case so the heading and comparison link identify
the source repository.

Use `--cases /absolute/path/cases.ts` to load a different trusted local module,
or `--builtin` to explicitly load the portable DiffCompass examples. These are
TypeScript modules executed by Bun, not untrusted data uploads. The browser test
accepts the same flags. The default local module can contain the familiar examples
without making CI or another contributor depend on those checkouts.

Without a local module, the portable comparison uses two historical changes:

| Change | Pinned range | Complexity to explain |
| --- | --- | --- |
| GitHub suggestion publication | `57bf907` → `27b7e44` | Selected drafts, neutral review semantics, durable intent, remote head checks, lost-response recovery. |
| Revision-aware review checkpoints | `8f84166` → `740bada` | Captured Git trees, full versus checkpoint comparisons, retained review state, outdated explanations. |

The historical Git objects must be present locally. A shallow checkout without
these commits cannot load the examples. The server reads those trees directly;
it does not change the working tree, create checkpoints, invoke an agent, or
call GitHub. Source quotes are validated through the production Briefing builder,
and highlighting and diagrams use the existing local dependencies.

Sequences, architecture, lifecycle, data-model and domain maps use the shared
Archify viewers; call flows use the native call tree. To render Archify diagrams
from a source checkout, package the pinned renderer and set its path:

```sh
bun scripts/package-archify.ts /tmp/diffcompass-preview-archify
DIFFCOMPASS_ARCHIFY_DIR=/tmp/diffcompass-preview-archify bun run fixture:briefing-experiments --builtin
```

A missing renderer leaves an explicit element list with the saved evidence.
There is no Mermaid fallback in Briefing. Saved viewers and their code bindings
are also included in offline HTML exports.

The prose covers these particular revisions. It does not claim to describe the
latest behavior. In particular, marker reconciliation is not an unconditional
exactly-once guarantee, and a checkpoint's “resolved” classification is not proof
that a finding was fixed. Historical test excerpts are evidence of the committed
regressions, not a claim that those historical suites were executed by this lab.

Drag either side pane's inner edge to resize it; double-click the edge to reset
that pane. Focus an edge and use the arrow keys, Home, or End to resize by keyboard.
Widths are shared across examples and remembered in this browser. Smaller windows
temporarily limit them to keep the story readable; mobile uses the evidence sheet.

The example picker retains each reading position. URLs use `#case=<id>` and work
with Back/Forward. **Reading notes** saves text per example in this browser;
download the notes to share them. The preview focuses on reading and source
inspection, so agent-question and publication actions are omitted.

Use the shared Shiki/Monaco selector and Split/Unified, Scroll/Wrap and Wide
briefing controls to inspect the story. Evidence cards preserve their position
when clicked; the pane's arrow collapses and expands it. New tours and explicit
regeneration request outcome titles and an early supporting diff. Saved documents
retain their prose until regenerated. Legacy case modules may still contain
other drafts; the preview displays only `documents.outcome`.

Judge comprehension before visual preference: can a reader explain the intended
outcome, trace the important behavior, locate its implementation evidence, and
describe where the guarantee stops? The portable examples are authored fixtures;
passing their browser checks is not an evaluation of agent-generated narratives.

Validation:

```sh
bunx tsc --noEmit -p prototypes/briefing/tsconfig.json
DIFFCOMPASS_ARCHIFY_DIR=/tmp/diffcompass-preview-archify bun run test:briefing-experiments --builtin
```

The browser check uses Chrome locally or Playwright Chromium in CI. It exercises
each selected outcome-first story, exact diagram/code bindings, renderer controls,
scrolling, pane resizing, local notes, keyboard navigation, and mobile evidence
sheets without external requests. Pass `--cases /absolute/path/cases.ts` instead
of `--builtin` to check a trusted local case module.
