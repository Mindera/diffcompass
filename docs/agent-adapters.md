# Standalone agent adapter contract

DiffCompass supports Codex, Claude Code, Gemini CLI, and GitHub Copilot CLI.
An adapter is eligible for the picker only when its executable is present on
`PATH`. Authentication remains owned by that CLI.

Every standalone adapter must satisfy the following contract:

1. Launch processes with an argument vector, never through a shell.
2. Run with read-only repository access. Disable write, shell, network, MCP,
   extension, or remote capabilities when the CLI exposes those controls.
3. Return only the assistant's final text; tool output, reasoning, diagnostics,
   and reviewer-controlled content must not be promoted to an answer.
4. Preserve a stable conversation identifier and persist it with the review so
   explanations and follow-up questions resume the same session.
5. Respect cancellation and the shared 15-minute turn timeout.
6. Discover models from the installed CLI when a machine-readable or help
   catalog exists. Otherwise expose only documented aliases or the CLI default,
   and say so in the picker.
7. Fail closed on malformed output, unavailable requested models or reasoning
   levels, empty answers, and mismatched persisted continuations.

The tour prompt includes the complete Git patch. This is intentional: an
adapter does not need shell access to reconstruct the comparison, and all
agents receive the same diff evidence.

## Gemini CLI

Gemini runs headlessly with streaming JSON and `--approval-mode plan`. The init
event supplies the resumable session ID; later turns use `--resume`. Gemini does
not expose an authenticated headless model catalog, so the picker offers its
documented `auto`, `pro`, `flash`, and `flash-lite` routing aliases.
See the official [Gemini CLI reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md)
and [headless-mode reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md).

## GitHub Copilot CLI

Copilot uses an exact UUID with `--session-id` for every turn. Its available
tools are restricted to `view`, `glob`, and `grep`, with explicit denials for
writes, shell commands, and URLs. Built-in MCP, repository instructions,
experimental features, automatic updates, and remote export are disabled.
Models are parsed from `copilot help`; failure to parse that catalog leaves only
the `auto` model.
See GitHub's official [Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference).
