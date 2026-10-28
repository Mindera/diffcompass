# Development

[Back to the README](../README.md)

For repository administration, see the [nightly Minders team sync](minders-team-sync.md).

```sh
bun install --frozen-lockfile
bun run src/cli.ts --repo /path/to/repository --base origin/main --open
```

For a development-only global command, run `bun install --global .` and ensure
`bun pm bin -g` is on `PATH`. Internal attached operations use
`diffcompass bridge`. See [Agent adapters](agent-adapters.md)
for standalone discovery, continuation, and read-only execution contracts.

## Reusable test fixture

```sh
bun run fixture --open
```

Each run recreates a disposable Git repository and canonical persisted session
under the system temporary directory. The fixture covers two phases, four stops,
inline feedback, structured findings, component/sequence/adaptive diagrams, a
checkpoint, conversations, activity, changed PNGs, modified and added Markdown,
and simulated PR/issue context without calling GitHub. Later explanations begin
unprepared so prepare-ahead behavior can be tested. Use
`bun run fixture --prepare-only` when only the files and state are needed.

For outcome-first Briefings over larger historical changes, run
`bun run fixture:briefing-experiments`. The preview uses the production reader
and displays the chosen outcome-first story for each example. It can load
portable DiffCompass history or private cases from a Git-ignored local module.
See the [preview guide](../prototypes/briefing/README.md) for pinned revisions,
reading notes, renderer setup, and browser validation.

## Verify and release

The Briefing browser group checks all five Archify diagram families and the
shared native call tree in both the production reader and offline HTML. It covers
initial fit, exact node and relationship bindings, repeated labels, two-way
evidence selection, and preservation of camera and pane scroll position.
Run `MONACO_CHECK_GROUP=briefing bun run test:monaco` with
`DIFFCOMPASS_ARCHIFY_DIR` pointing to the pinned packaged renderer (created by
`bun scripts/package-archify.ts /absolute/output/directory`). A development
checkout without that renderer shows the saved element list instead.

### Monaco preview

The normal review UI includes **Shiki** and **Monaco** renderer choices. Monaco
is opt-in; Shiki remains the default and can be restored without changing the review. Monaco
loads captured Before/After blobs through the authenticated `/api/diff/sources`
endpoint, not the live workspace. Files load on demand; offscreen editors and
models are released while their view state and measured card height are retained.
Reloading waits for computed diffs and settled layout before reporting a new
height; measurements above the viewport preserve the reading position.
Text, image and fallback
cards share one ordered page-level list, without a nested scrolling file group.
Source refreshes cannot
silently save a draft against a different comparison.

Monaco tour stops retain their Before/After source identities in Split and
Unified views. Original ranges can span removed and unchanged code; inserted
After lines are not included in a Before highlight. Navigation reveals folded
context without selecting text and scrolls to the stop's banner, not merely the
file header. Before-side tours no longer switch the file to Shiki.

Select a line or range on the After side and choose **Suggest edit** from the
toolbar or context menu. Its separate editable Monaco draft replaces full lines;
**Propose edit** saves a syntax-highlighted inline card beside the code, like a
comment, without changing the source or leaving the current tour position.
Cards survive navigation and reloads and follow Show/Hide comments. Apply and
Reject are available on the card; Apply, Reject and Undo use themed confirmations
that describe their scope. Activity retains the audit trail, full patch
inspection and Undo. Cancel discards only the draft, and failed saves retain its
text. The captured diff remains read-only. Outdated suggestions are labelled
rather than attached to unrelated source lines.
Drafts retain syntax highlighting, including the fence's language when editing
code inside a Markdown fenced block.

For GitHub PR reviews, **Add to GitHub review** converts an eligible saved edit
into a native suggestion in the local review draft. **Return to local** restores
the pending proposal and preserves its replacement. **Apply locally** writes only
to the isolated PR workspace. Queueing, returning, and publishing a suggestion
do not apply the replacement, commit it, or push it.

The final GitHub review confirmation names the number of selected suggestions
and the PR head. **Submit suggestions** publishes only selected queued suggestions
as a neutral GitHub `COMMENT` review, without approving or requesting changes,
including when you own the PR. Other review comments remain in the draft and the
local tour stays open. Published suggestions retain a receipt, cannot be returned
to local or republished, and are excluded from later submissions. You can submit
another suggestion batch or finish with a separate review decision. Suggestions
can also be included in the existing approval/request-changes review.
Selected suggestions become GitHub suggestion blocks that the PR author can
apply on GitHub. The saved source,
replacement, selected comment IDs, and PR head are checked before publication;
retries reuse the durable review intent to avoid duplicating a submitted review.

Native suggestions require a captured regular text file from the unmodified PR
head and at most 100 contiguous After lines within one PR diff hunk (three lines
of context). Expanded context outside those hunks, ranges spanning hunks, old
saved proposals without exact selection metadata, binary files, symlinks, and
local-only changes cannot be queued. The generated comment must fit the existing
8,000-character review-comment limit; selected source context is capped at 32,000
characters. Multiline replacements, empty replacements (deletions), and literal
backticks are supported; longer Markdown fences preserve embedded fences.
GitHub remains the final authority on diff anchors and suggestion applicability.

To try the entire suggestion flow without contacting GitHub, run
`bun run fixture:github-suggestions` and open the printed localhost URL. Each
launch creates a fresh disposable repository on an unused port. In `src/cart.ts`,
select After lines, choose **Suggest edit**, save a proposal, then use **Add to
GitHub review**, **Return to local**, or **Submit suggestions**. Use **Include in
GitHub review** in the comment sidebar to select a batch. In this offline fixture,
**Publish suggestions** records a simulated `COMMENT` payload in the printed
`simulated-reviews.json` file; it never sends a real GitHub request. The tour stays
open and the ordinary sample comment stays drafted. **Apply locally** still edits
only the disposable repository. Run `bun run test:github-suggestions-browser` for
the automated browser regression (Chrome locally, Playwright Chromium in CI).

Implementation references: [GitHub review API](https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request),
[ranged review comments](https://docs.github.com/en/rest/pulls/comments#create-a-review-comment-for-a-pull-request),
[suggesting changes](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/commenting-on-a-pull-request),
and [nested code fences](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-and-highlighting-code-blocks).

Comments and questions can also target expanded unchanged context. Anchors are
validated against captured Before/After source, including multiline selections,
and rechecked after refresh. Line comments outside the original GitHub diff stay
local and are labelled **Local only**; they cannot be included in a GitHub review.
Quote comments retain their existing local-only behavior.

Live PR threads appear beside the code with Markdown, replies and resolved state.
**Reply in GitHub** opens the existing GitHub thread; refresh the pull request to
load replies and resolution changes. Threads with only historical or missing
line positions remain at file level instead of being attached to unrelated code.
Thread-only updates preserve the editor, scroll position and open drafts.
Both renderers offer **Show/Hide comments** for local comments and PR threads.
The visibility preference survives renderer switches and reloads; gutter markers
remain available while inline comments are hidden.

Run `bun scripts/monaco-fixture.ts` for a disposable normal-server fixture, or
`bun run test:monaco` for its browser regression suite (Chrome locally; install
Playwright Chromium in CI). It covers focused J/K navigation, editable-input
guards, stale drafts, lazy loading/disposal, whitespace changes, mixed-file order,
page scrolling and stable lazy remounts, reviewed-card collapse, per-file fallback,
suggested-edit drafts/proposals/apply/undo, expanded-context comments/questions,
PR-thread rendering and refresh, local workers and CSP. PR-thread browser tests
use intercepted provider-shaped data and never publish to GitHub.
`bun run verify` includes source API tests.
Set `DIFF_VIEWER_STATE` to a fixture's saved session path when restarting it to
keep its review state and URL; `DIFF_VIEWER_PORT` selects its port.

The browser implementation lives in `public/monaco/`; prototype fixtures reuse
it. Releases package the pinned Monaco 0.55.1 editor, workers, fonts and licenses
under `share/diffcompass/monaco`. The hash-guarded compatibility adapter exposes
removed-line source positions and binds Monaco's global hover/Markdown helpers
to its root service instead of an evictable editor. Revalidate this adapter and
the browser suite before upgrading Monaco; do not patch `node_modules`.

All six syntax palettes (GitHub, Vitesse, DiffCompass and the three Catppuccin
variants) apply to Monaco diffs, source/peek views and suggestion editors. Theme
changes recolor open editors without replacing their models or drafts. Monaco
keeps its native tokenization, so individual syntax scopes can differ from Shiki.
Catppuccin retains its dark code surface even with light application chrome.
Unified Before-side tour anchors are supported natively; real-PR end-to-end,
actual-device validation and green browser CI remain rollout gates.
Images, unsupported/large
files (over 256 KB per side), workspace views and proposal previews retain the
Shiki renderer. Sequence-diagram code snippets are a separate surface.

### General checks

Map types describe evidenced roles (for example Agent skill, Script, ViewModel,
Use case, Repository, or Domain model), independently of a node's name and
its domain vocabulary from `CONTEXT.md`. Architecture and sequence generation
can supply `nodeRoles` keyed by Mermaid node id, each with a `type` and a
source-grounded `evidence` explanation. The Types filter groups these roles;
component details include “Why this type”. Names and suffixes alone do not
establish a role. Older saved maps without role evidence remain usable, show
“Type unspecified” in the filter, and omit the type badge. Regenerate those
maps to obtain classifications; existing labels are not silently reinterpreted.

```sh
bun run verify
bun run build:release
```

Pushing a matching `v*` tag runs the full suite, builds all six platform
archives, and creates a GitHub Release carrying them with `install.sh`,
`install.ps1` and `checksums.txt`. A final job then installs that release on
Linux, macOS and Windows, once from the tag's own scripts and once from the
`releases/latest` link.

See [ROADMAP.md](../ROADMAP.md) for released scope, cancelled work,
prototypes and remaining gaps. Automated unit/integration and
source/DOM-contract tests do not establish browser usability; browser checks and
their limits are recorded separately in [RESEARCH.md](../RESEARCH.md).

## Monaco PR-comment fixture

For sample PR comments in the current per-file Monaco renderer (without a
GitHub connection), run `DIFF_VIEWER_PR_EXAMPLE=1 DIFF_VIEWER_PORT=47684 bun scripts/monaco-fixture.ts`.
Select **Monaco**, then check `src/cart.ts:17` and expand gaps in
`src/context-example.ts`. Each gap has one **Expand all** button; revealing
the whole gap grows the file card with the page. PR threads are
read-only; local comments and reviewed flags remain editable. Suggested edits
can be proposed, previewed, applied, undone and rejected. Apply/Undo use the real
local edit pipeline, restricted to the owned temporary fixture repository (no
shared Git worktree or remotes). Their confirmation explicitly identifies this
disposable scope. External GitHub operations, generation and refresh stay blocked.
Resume that same fixture with `DIFF_VIEWER_STATE=/absolute/path/to/session.json`;
keep `DIFF_VIEWER_PR_EXAMPLE=1` set. The printed session path contains its review state.

For a **fresh** fixture with Before-side tour examples, also set
`DIFF_VIEWER_BEFORE_TOUR=1` (omit `DIFF_VIEWER_STATE`). Its first five stops cover
removed, mixed removed/unchanged, unchanged, and folded original source, followed
by the usual After stops. Choose Monaco and Unified, then test Next/Previous,
Split, Wrap, comments, and returning to Current step. This flag never replaces
the tour in a resumed session.

## Lifecycle layout fixture

With dependencies already present and `DIFFCOMPASS_ARCHIFY_DIR` pointing to an
existing renderer bundle, launch a fresh captured-code example:

```sh
DIFFCOMPASS_FIXTURE_PORT=47786 bun run scripts/lifecycle-fixture.ts
```

Open the printed URL, then select **Receipt job: retry or cancel** in the
diagram picker under **Diagrams → Data & lifecycle**. The five states, retry loop, cancellation
branches, and terminal exits match the captured `src/receipt-job.ts` code.
Sources open the captured diff; **Back to diagram** restores the map, selection,
camera, and scroll position. A rendering failure retains the native Mermaid
source. The fixture uses a new temporary repository and does not invoke an agent.

For browser verification, pass an existing Playwright module and that fixture URL:

```sh
node scripts/lifecycle-browser.mjs /absolute/path/to/playwright/index.mjs 'http://127.0.0.1:PORT/#token=TOKEN'
node scripts/lifecycle-pointer-browser.mjs /absolute/path/to/playwright/index.mjs 'http://127.0.0.1:PORT/#token=TOKEN'
```

These checks cover headless Chrome at desktop and 390px widths, actual mouse
input, source return, consecutive visible lane headings, geometry, and native
fallback. They do not establish Safari, Firefox, or touch-device coverage.
The Chrome viewport helper synchronizes native content size with emulated size:
Playwright 1.63 / Chrome 154 otherwise loses iframe clicks near the viewport's
bottom edge, also reproducible with a plain sandboxed button. Setting
`DIAGRAM_RAW_VIEWPORT=1` runs that negative control without the sizing correction;
it exits nonzero when the pointer environment is affected.
