# DiffCompass

A local, agent-led walkthrough for Git changes. Follow a guided tour, explore the
diff, ask questions, and review a branch or GitHub pull request in your browser.

Pull request integration is officially supported and tested only with GitHub.
GitLab, Bitbucket, and other hosting providers have not been tested and are not
officially supported.

[Install](#install) · [Update](#update) · [Run](#run) ·
[Feature catalogue](docs/features.md) · [Development](#development)

![Current DiffCompass interface showing a demo review with changed files and a split diff](docs/images/overview.png)

Explore the **[feature catalogue](docs/features.md)** directly on GitHub for
features, entry points, and screenshots. Prefer the interactive version? Open the
[HTML catalogue file](docs/feature-showcase.html), click **Download raw file**,
then open the downloaded `.html` file in your browser. GitHub displays its source;
the downloaded catalogue includes its images and works offline.

## Install

Release binaries support macOS, Linux and Windows on Intel/AMD and ARM; Bun is not
required. The installer downloads the
[latest release](https://github.com/Mindera/diffcompass/releases/latest), verifies
its checksum, and installs the bundled skill for Codex, Claude Code, Gemini CLI and
GitHub Copilot CLI. Restart your agent afterwards so it discovers the skill.

### macOS and Linux

```sh
curl -fsSL https://github.com/Mindera/diffcompass/releases/latest/download/install.sh | bash
```

The command is installed to `~/.local/bin` by default. If that directory is not
already on your PATH, add this to your shell startup file (`~/.zshrc` or
`~/.bashrc`) and run it in your current terminal:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

### Windows PowerShell

```powershell
irm https://github.com/Mindera/diffcompass/releases/latest/download/install.ps1 | iex
```

### Windows Command Prompt

```bat
powershell -c "irm https://github.com/Mindera/diffcompass/releases/latest/download/install.ps1 | iex"
```

On Windows the installer adds its command directory to your user PATH. Open a new
terminal after installation.

### Check the installation

```sh
diffcompass --version
diffcompass doctor
```

### Install a specific version or the binary only

Write the version with or without the leading `v`. On macOS and Linux:

```sh
curl -fsSL https://github.com/Mindera/diffcompass/releases/latest/download/install.sh | bash -s -- --version vX.Y.Z
curl -fsSL https://github.com/Mindera/diffcompass/releases/latest/download/install.sh | bash -s -- --minimal
```

In PowerShell:

```powershell
& ([scriptblock]::Create((irm https://github.com/Mindera/diffcompass/releases/latest/download/install.ps1))) -Version vX.Y.Z
& ([scriptblock]::Create((irm https://github.com/Mindera/diffcompass/releases/latest/download/install.ps1))) -Minimal
```

`--minimal` and `-Minimal` install the command without the agent skills. Each
release also lists `install.sh` and `install.ps1` in its `checksums.txt`, so you
can verify a downloaded script before running it.

### Requirements

| Requirement | Needed for |
| --- | --- |
| Git | Every review. |
| [GitHub CLI (`gh`)](https://cli.github.com/) | Optional. Needed only to review GitHub pull requests. |
| Codex, Claude Code, Gemini CLI or GitHub Copilot CLI | Agent-led reviews: install and sign in to one of them. |

### Install with your agent

Copy this prompt into your coding agent:

```text
Install the latest DiffCompass release on this machine.

1. Detect my OS and shell, then run the matching command:
   macOS or Linux:
   curl -fsSL https://github.com/Mindera/diffcompass/releases/latest/download/install.sh | bash
   Windows PowerShell:
   irm https://github.com/Mindera/diffcompass/releases/latest/download/install.ps1 | iex
   Windows Command Prompt:
   powershell -c "irm https://github.com/Mindera/diffcompass/releases/latest/download/install.ps1 | iex"
2. Make sure diffcompass is on PATH in this terminal and future terminals. Change
   only the shell configuration that needs it, without duplicating entries.
3. Run diffcompass --version and diffcompass doctor, and fix any setup problem
   they report. Tell me the installed version and whether I need a new terminal
   or to restart my agent to load the skill.
```

## Update

Once installed with the release installer above, run this from any directory:

```sh
diffcompass update
diffcompass --version
```

Use the lowercase command **`diffcompass`**. Updates reuse the bundled installer to
download the latest release and verify its checksum. No clone, Bun installation or
GitHub CLI is needed. Saved reviews are preserved, and binary-only installs stay
binary-only.

Installs at v2.2.4 or earlier need a signed-in GitHub CLI (`gh`) for one last
`diffcompass update`; without it, re-run the install command above, or run
`diffcompass update --version vX.Y.Z` with the latest version.

If the command is missing, check PATH or run the installer above. If a download
fails, check that this machine can reach `https://github.com`. Development installs
made with Bun should use the release installer once to get this setup.

| Task | Command |
| --- | --- |
| Install a specific release | `diffcompass update --version vX.Y.Z` |
| Return to the previously installed version | `diffcompass rollback` |
| Preview removal | `diffcompass uninstall --dry-run` |
| Uninstall and keep saved reviews | `diffcompass uninstall --yes` |

## Run

From the repository you want to review:

```sh
diffcompass --base origin/main --open
```

Use `--repo /path/to/repository` to review another checkout. The setup screen lets
you choose your agent and model. For a GitHub pull request, use its number in that
repository or its full URL:

```sh
diffcompass pr 123 --open
diffcompass pr https://github.com/OWNER/REPOSITORY/pull/123 --open
```

To use the agent you are already chatting with, ask it:

> Use the diffcompass skill to walk me through the changes in this repository.

The [bundled skill](skills/diffcompass/SKILL.md) starts the review and keeps the
agent connected for explanations and questions.

![Current guided tour highlighting a demo change with its explanation and tour navigation](docs/images/guided-tour.png)

*Screenshots show the current UI with the disposable checkout demo; its sample
review content is prewritten.*

The browser runs locally on `127.0.0.1`. Keep the tokenized review URL private.
See `diffcompass --help` for launch options and the
[usage and configuration guide](docs/usage.md) for saved sessions, comparison
bases, and repository defaults.

## Development

```sh
bun install --frozen-lockfile
bun run fixture --open
bun run verify
```

See the [development guide](docs/development.md) for running from source,
browser fixtures, verification, and release builds. The [roadmap](ROADMAP.md)
tracks delivery status; [research notes](RESEARCH.md) retain detailed evidence
and historical decisions.

### Narrative Briefing

The **Briefing** tab starts with the outcome: its title states the concrete change, and its opening explains what becomes possible and how that differs from before. The story then follows how the implementation achieves it, connecting intent, behavior, design decisions, and boundaries. Internal changes describe their technical outcome without inventing a user-facing benefit. Author intent and observed behavior ground the explanation; inferred rationale is labelled.

Code appears as focused before-and-after diffs alongside the prose it supports, starting in the opening section for code changes. Diagrams explain a particular relationship or step in the story. Additions, deletions, and both line numbers come from the captured Git comparison. The same diffs appear in diagram evidence and exports; unchanged context is labelled explicitly. The left outline follows the section in view as you scroll. Drag either side pane's inner edge to resize it. The code workspace is labelled **Changes**; reading or inspecting a Briefing does not advance the tour or mark files reviewed.

Inspect a diagram to open its complete evidence stack in the right pane. Sequence messages, architecture components and relationships, lifecycle states and transitions, data-model entities and relationships, call-flow nodes and edges, and domain concepts share the same inspector. Select a diagram element or its evidence card to highlight both, using the mouse or keyboard. Exact source bindings are validated against the captured old/new Git trees. Domain glossary passages are labelled documentary evidence. Unlinked elements remain visible with an explicit unavailable state; every diagram has an accessible element list when canvas identities cannot be matched safely.

New and regenerated Briefings include a source-linking pass for missing bindings in the diagrams used by the story. The agent receives the finished diagram's exact element IDs and endpoints, then inspects captured source for the call sites, declarations, or documents that establish each relationship, including unchanged supporting files. Every returned quote must match the captured Git tree; invalid IDs or quotes trigger up to two repair attempts before generation fails. External elements and relationships that cannot be established retain a specific explanation in the inspector and exports. If the 40-citation limit prevents another excerpt from being saved, the inspector explains that limit. Source matching verifies the citation's location; its relevance remains an agent assessment. Existing saved Briefings gain this inspection when explicitly regenerated.

Use **Ask** to attach a passage, exact quotation, diagram, or element to a question. Passage controls appear on hover or keyboard focus and stay visible on touch screens. Inspecting something else does not replace those attachments. Conversations retain their original saved context across regeneration. The reader and question draft remain in place when switching to Changes and back. Reading position and inspected evidence are remembered in this browser when reopening the same saved document; a different snapshot starts without that selection. On mobile, evidence and questions open in a dismissible sheet.

**Open in Changes** pauses an active tour and reveals the cited source, including files in another phase. **Back to Briefing** restores the reader and its selected evidence. Resuming the tour clears that return button and keeps the tour's saved stop.

Briefing uses the same Archify viewers as Diagrams for sequences, architecture, lifecycle, data models and domain maps. Each starts with the whole diagram visible. Inspection preserves the camera; clicking an evidence card also preserves its position in the pane. Selecting an element in the diagram reveals its evidence. Call flows use the shared native call tree. These renderers and captured code bindings also work in offline HTML exports. If a saved viewer cannot be rendered, the element list and its evidence remain available; Briefing does not substitute a different diagram renderer.

Briefing shares the **Shiki/Monaco**, **Split/Unified**, and **Scroll/Wrap** preferences with Changes. Drag the inward-facing edges of the side panes to resize them, or use the evidence pane’s arrow to collapse and expand it. **Wide briefing** expands the reading column while keeping margins. Inline code remains in the story; selecting it does not duplicate it in the evidence pane.

“Open reviews in Briefing” controls the opening view; the tab remains available when disabled. New tours draft the document with the outline request. When a draft uses sequences, a separate review traces their causal steps against captured source before saving. Regeneration uses the same review. This complements source validation; it does not establish runtime behavior or guarantee the coherence of the whole narrative. Saved documents retain their text until explicitly regenerated; older tours without a document receive a basic overview following the saved tour order, with captured excerpts from current stops. **Regenerate Briefing** uses the current outcome-first guidance, replaces only the document, and validates its source excerpts again. Changed source or author/reviewer intent marks an existing document outdated. HTML exports include an offline reader and inspector; Markdown exports keep source excerpts in the narrative and include a linked evidence appendix.

The document contract is bounded to 12 sections, 60 blocks, 24,000 prose characters, and 40 source citations (30 lines/8,000 characters each). A code citation captures the corresponding replacement and nearby context, capped at 120 diff rows/24,000 source characters with explicit omission markers. Existing documents gain diffs on resume only when their captured comparison still matches; unavailable diffs never fall back to a standalone code snippet. Questions accept up to eight selected items and 8,000 characters of selected context. See `src/briefing.ts` for the versioned contract and validation rules.

## License

[Sustainable Use License 1.0](LICENSE.md). Free to use and modify for your own internal business,
non-commercial or personal purposes, and to share free of charge for non-commercial purposes. You may
not sell it or offer it as a paid service, and modified copies must say they were modified.
