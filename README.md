# DiffCompass

A local, agent-led walkthrough for Git changes. Follow a guided tour, explore the
diff, ask questions, and review a branch or GitHub pull request in your browser.

[Install](#install) · [Update](#update) · [Run](#run) ·
[Feature catalogue](docs/feature-showcase.html) · [Development](#development)

![Current DiffCompass interface showing a demo review with changed files and a split diff](docs/images/overview.png)

Explore the **[interactive feature catalogue](docs/feature-showcase.html)** for
illustrated features and examples. On GitHub, use **Download raw file**, then open
the downloaded HTML in your browser; it includes its own images and works offline.

## Install

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

### macOS and Linux

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

### Windows PowerShell

```powershell
$Installer = gh api -H "Accept: application/vnd.github.raw+json" repos/Mindera/diffcompass/contents/scripts/install.ps1
if ($LASTEXITCODE -ne 0) { throw "Could not download the DiffCompass installer." }
& ([scriptblock]::Create(($Installer | Out-String)))
```

The installer adds its command directory to your user PATH. Open a new terminal
after installation.

### Check the installation

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
