# Briefing reading experiments

Run `bun run fixture:briefing-experiments` and open the printed URL. The default
port is 47561; pass `--port 0` for an available port. These experiments live on
`experiment/briefing-reading-paths`, based on the accepted reader at `76a45d6`.
The narrative experiments live here; code diff rendering is shared with the
production reader, inspector, and exports. Each code citation shows the captured
before-and-after change, with additions, deletions, and unchanged context.

The comparison uses two real historical changes, rather than the checkout sample:

| Change | Pinned range | Complexity to explain |
| --- | --- | --- |
| GitHub suggestion publication | `57bf907` → `27b7e44` | Selected drafts, neutral review semantics, durable intent, remote head checks, lost-response recovery. |
| Revision-aware review checkpoints | `8f84166` → `740bada` | Captured Git trees, full versus checkpoint comparisons, retained review state, outdated explanations. |

The historical Git objects must be present locally. A shallow checkout without
these commits cannot load the examples. The server reads those trees directly;
it does not change the working tree, create checkpoints, invoke an agent, or
call GitHub. Source quotes are validated through the production Briefing builder,
and highlighting and diagrams use the existing local dependencies.

Each change has four reading approaches:

- **Current approach:** the accepted reader layout with an implementation-ordered
  narrative for this historical change. This is the control, not a claim that its
  newly written prose was part of the earlier accepted checkout example.
- **Outcome first:** begin with the human need and observable result, then explain
  the architecture and code that support it. Test whether readers retain the
  purpose while moving into implementation detail.
- **Follow a scenario:** show a concrete path and its failure branches. Selecting
  a stage opens its captured code in the evidence pane. Scenarios are authored
  illustrations derived from source, not recorded runtime executions.
- **Design decisions:** organize around responsibility, identity, and confidence.
  Optional disclosures explain tradeoffs as explicit inference, separate from
  documented intent and observed implementation.

The prose covers these particular revisions. It does not claim to describe the
latest behavior. In particular, marker reconciliation is not an unconditional
exactly-once guarantee, and a checkpoint's “resolved” classification is not proof
that a finding was fixed. Historical test excerpts are evidence of the committed
regressions, not a claim that those historical suites were executed by this lab.

The version switcher retains each reading position. URLs identify the example
and approach and work with Back/Forward. **Comparison notes** saves text per
example and approach in this browser; download the notes to share them. This
prototype focuses on reading and source inspection, so agent-question and
publication actions are omitted.

Judge comprehension before visual preference: can a reader explain the intended
outcome, trace the important behavior, locate the implementation evidence, and
describe where the guarantee stops? Compare one approach across both examples
before choosing a direction. The next step is to fold the strongest ideas into
the shared reader and authoring guidance after feedback.

Validation:

```sh
bunx tsc --noEmit -p prototypes/briefing/tsconfig.json
bun run test:briefing-experiments
```

The browser check uses Chrome locally or Playwright Chromium in CI. It exercises
all eight stories, each scenario's source bindings, scrolling, local notes,
keyboard navigation, and mobile evidence sheets without external requests.
