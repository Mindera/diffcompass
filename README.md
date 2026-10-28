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

### Install with your agent

Copy this prompt into your coding agent:

```text
Install the latest released DiffCompass for this machine and agent from the
private repository https://github.com/Mindera/diffcompass.

1. Detect my OS and shell. Check for Git and GitHub CLI (gh), and install any
   missing prerequisites using the appropriate package manager.
2. Check gh authentication and access to Mindera/diffcompass. Guide me through
   signing in if needed. If access is denied, tell me to request access from a
   Mindera GitHub administrator before continuing. Never ask me to paste tokens.
3. Read the repository's current README using authenticated gh access and follow
   its release-installer instructions for my platform. Install the binary and
   bundled agent skills, including this agent's skill. Use the full installation,
   not minimal mode; no source build or Bun installation is needed. Preserve
   existing custom skills and explain any installation conflicts.
4. Ensure diffcompass is on PATH in this terminal and future terminals. Make only
   the necessary shell configuration changes, without duplicating entries.
5. Run diffcompass --version and diffcompass doctor. Verify the bundled skill is
   installed and the updater is set up to use Mindera/diffcompass with my gh login.
   Resolve setup problems and report any remaining limitations.
6. Tell me the installed version, how to run diffcompass update, and whether I
   need a new terminal or to restart my agent to load the skill.
```

### Manual installation

You need Git, [GitHub CLI (`gh`)](https://cli.github.com/), and a GitHub account
with access to the private **[Mindera/diffcompass](https://github.com/Mindera/diffcompass)**
repository. For agent-powered reviews, also install and sign in to Codex,
Claude Code, Gemini CLI, or GitHub Copilot CLI. Release binaries support macOS,
Linux, and Windows on Intel/AMD and ARM; Bun is not required.

Authenticate and check repository access first:

```sh
gh auth login
gh repo view Mindera/diffcompass
```

If access is denied, request repository access from a Mindera GitHub administrator
and authorize your GitHub CLI credentials for the organization if prompted.

#### macOS and Linux

```sh
set -o pipefail
gh api -H "Accept: application/vnd.github.raw+json" repos/Mindera/diffcompass/contents/scripts/install.sh | bash
```

The command is installed to `~/.local/bin` by default. If that directory is not
already on your PATH, add this to your shell startup file (`~/.zshrc` or
`~/.bashrc`) and run it in your current terminal:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

#### Windows PowerShell

```powershell
$Installer = gh api -H "Accept: application/vnd.github.raw+json" repos/Mindera/diffcompass/contents/scripts/install.ps1
if ($LASTEXITCODE -ne 0) { throw "Could not download the DiffCompass installer." }
& ([scriptblock]::Create(($Installer | Out-String)))
```

The installer adds its command directory to your user PATH. Open a new terminal
after installation.

#### Check the installation

```sh
diffcompass --version
diffcompass doctor
```

The installer downloads the [latest release](https://github.com/Mindera/diffcompass/releases/latest),
verifies its checksum, and installs the bundled skill for Codex, Claude Code,
Gemini CLI, and GitHub Copilot CLI. Restart your agent to discover the skill.
For a binary-only installation, use `bash -s -- --minimal` in the macOS/Linux
install command, or pass `-Minimal` to the PowerShell script block.

## Update

Once installed with the release installer above, run this from any directory:

```sh
diffcompass update
diffcompass --version
```

Use the lowercase command **`diffcompass`**. Updates reuse the bundled installer
and your authenticated `gh` account to download the latest release. Keep `gh` on
PATH and signed in to an account with access to `Mindera/diffcompass`. No clone or
Bun installation is needed. Saved reviews are preserved, and binary-only installs
stay binary-only.

If the command is missing, check PATH or run the installer above. If a download
fails, check `gh auth status` and `gh repo view Mindera/diffcompass`.
Development installs made with Bun should use the release installer once to get
this setup.

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

Use **Ask** to attach a passage, exact quotation, diagram, or element to a question. Passage controls appear on hover or keyboard focus and stay visible on touch screens. Inspecting something else does not replace those attachments. Conversations retain their original saved context across regeneration. The reader and question draft remain in place when switching to Changes and back. Reading position and inspected evidence are remembered in this browser when reopening the same saved document; a different snapshot starts without that selection. On mobile, evidence and questions open in a dismissible sheet.

Briefing uses the same Archify viewers as Diagrams for sequences, architecture, lifecycle, data models and domain maps. Each starts with the whole diagram visible. Inspection preserves the camera; clicking an evidence card also preserves its position in the pane. Selecting an element in the diagram reveals its evidence. Call flows use the shared native call tree. These renderers and captured code bindings also work in offline HTML exports. If a saved viewer cannot be rendered, the element list and its evidence remain available; Briefing does not substitute a different diagram renderer.

Briefing shares the **Shiki/Monaco**, **Split/Unified**, and **Scroll/Wrap** preferences with Changes. Drag the inward-facing edges of the side panes to resize them, or use the evidence pane’s arrow to collapse and expand it. **Wide briefing** expands the reading column while keeping margins. Inline code remains in the story; selecting it does not duplicate it in the evidence pane.

“Open reviews in Briefing” controls the opening view; the tab remains available when disabled. New tours draft the document with the outline request. When a draft uses sequences, a separate review traces their causal steps against captured source before saving. Regeneration uses the same review. This complements source validation; it does not establish runtime behavior or guarantee the coherence of the whole narrative. Saved documents retain their text until explicitly regenerated; older tours without a document receive a basic overview following the saved tour order, with captured excerpts from current stops. **Regenerate Briefing** uses the current outcome-first guidance, replaces only the document, and validates its source excerpts again. Changed source or author/reviewer intent marks an existing document outdated. HTML exports include an offline reader and inspector; Markdown exports keep source excerpts in the narrative and include a linked evidence appendix.

The document contract is bounded to 12 sections, 60 blocks, 24,000 prose characters, and 40 source citations (30 lines/8,000 characters each). A code citation captures the corresponding replacement and nearby context, capped at 120 diff rows/24,000 source characters with explicit omission markers. Existing documents gain diffs on resume only when their captured comparison still matches; unavailable diffs never fall back to a standalone code snippet. Questions accept up to eight selected items and 8,000 characters of selected context. See `src/briefing.ts` for the versioned contract and validation rules.
