# Dry runs: simulated execution walkthroughs

## Agreed product scope

A dry run walks the reviewer through execution of the code being reviewed using
concrete sample inputs. The agent simulates the execution from inspected source.
This replaces the previous review-startup preflight specification entirely.
It is not a CLI launch rehearsal, static risk summary, or actual runtime tracer.
Agent generation is expected and allowed; reviewed code is not executed.

## Flow and scenario selection

During tour planning identify affected behaviors with an entrypoint/trigger,
path and observable outcome. Share stable flow identities between dry runs,
call flows and sequence diagrams instead of selecting unrelated flows for each.
Allow computational flows without a useful sequence diagram, and allow dry runs
when other diagram generation is disabled. Include relevant unchanged code to
explain execution, marking changed code distinctly.

Suggest two or three scenarios per flow, each with a short reason: the principal
changed behavior, relevant alternate branches and meaningful boundaries.
Prefer existing tests/examples for input shapes; label invented sample data.
Findings can suggest cases, but derive outcomes independently from actual code.

Users can select a suggested scenario, edit its sample inputs and mocked
dependency responses, or describe their own scenario. Show assumptions explicitly.
Never silently correct an input or implementation bug to fit intended behavior.

## Independent experience

Provide a dedicated Dry runs tab with a flow/scenario picker, editable inputs,
Prepare walkthrough, preparation progress/cancellation, a step counter,
Previous step / Next step and restart controls. A step shows:

- Source location and active code, including changed-code indication.
- Current function, arguments, relevant local values and changes.
- The calculation, branch decision, call or return and its explanation.
- Explicit mock responses, assumptions or unresolved behavior where needed.

Dry-run navigation must not mutate the tour stop or reuse the tour's Previous/
Next handlers. Returning to Diff preserves the tour position and reading state.
An entry action on a sequence diagram or call flow opens this tab with the
corresponding flow selected. Questions carry the selected scenario and step.

## Generation and persistence

Dry runs are enabled by default alongside Findings and diagram options.
Disabling Dry runs skips scenario and trace generation. Users can enable it later
in the current review. Planning only suggests flows/scenarios; detailed traces
are prepared on demand, not for every scenario at startup.

Use a structured trace: comparison identity, flow, scenario, inputs/mock responses,
assumptions, ordered steps with source anchors and value changes, and outcome.
Label the result Simulated from code, not executed or runtime-verified.
Validate bounded responses and source references before displaying them.
Prepared Previous/Next navigation requires no agent calls. Changing inputs or
source makes the old trace stale; do not present it as a result for new inputs.
Cancellation or late responses must not overwrite a newer scenario/request.
Persist prepared traces for resume and export, keeping offline navigation.
Input edits should be explicit and discoverable; a bounded JSON editor is a
reasonable first implementation for structured data, with scenario text as needed.

## Diagram integration

Archify can optionally synchronize node/edge highlighting with execution steps.
The code/value walkthrough works without Archify. Keep trace identity and
step-to-flow references renderer-independent; coordinate with the Archify agent
on integration rather than making this branch depend on unmerged renderer code.
A diagram renderer never computes or verifies the trace's values.

## Fixture acceptance example

Flow: Calculate and format a receipt.
Inputs: items = [{ price: 10, quantity: 2 }, { price: 5, quantity: 1 }];
discount = { percentage: 0.20 }.

1. receipt receives inputs and calls total.
2. subtotal accumulates 0 -> 20 -> 25.
3. !discount is false, so execution continues to the discount calculation.
4. 25 - 25 * 0.20 returns 20.
5. receipt formats 20 as "20.00".
6. receipt returns "Total: 20.00".

Alternative scenarios: no discount returns "Total: 25.00"; percentage 20
produces "Total: -475.00", faithfully exposing the implementation's unit ambiguity.
An empty cart is another optional boundary. Test custom inputs, mock assumptions,
independent navigation, disabled generation, cancellation/staleness, persisted
traces, exports and existing attached/standalone review behavior.
