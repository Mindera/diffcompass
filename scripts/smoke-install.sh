#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform="darwin-arm64" ;;
  Darwin-x86_64) platform="darwin-x64" ;;
  Linux-aarch64) platform="linux-arm64" ;;
  Linux-x86_64) platform="linux-x64" ;;
  *) echo "Unsupported smoke-test platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

archive="$(find dist/release -maxdepth 1 -name "code-review-tour-v*-${platform}.tar.gz" -print -quit)"
[[ -n "$archive" ]] || { echo "Build release archives before running the installer smoke test." >&2; exit 1; }
package_version="$(bun -e 'console.log((await Bun.file("package.json").json()).version)')"

CODE_REVIEW_TOUR_ARCHIVE="$archive" \
CODE_REVIEW_TOUR_INSTALL_ROOT="$test_root/install" \
CODE_REVIEW_TOUR_BIN_ROOT="$test_root/bin" \
CODE_REVIEW_TOUR_CODEX_SKILL_ROOT="$test_root/codex/skills" \
CODE_REVIEW_TOUR_CLAUDE_SKILL_ROOT="$test_root/claude/skills" \
CODE_REVIEW_TOUR_GEMINI_SKILL_ROOT="$test_root/gemini/skills" \
CODE_REVIEW_TOUR_COPILOT_SKILL_ROOT="$test_root/copilot/skills" \
  ./scripts/install.sh

"$test_root/bin/code-review-tour" --version
"$test_root/bin/code-review-tour" bridge >/dev/null
BUN_BE_BUN=1 "$test_root/bin/code-review-tour" scripts/smoke-archify.ts
[[ -L "$test_root/codex/skills/code-review-tour" ]]
[[ -L "$test_root/claude/skills/code-review-tour" ]]
[[ -L "$test_root/gemini/skills/code-review-tour" ]]
[[ -L "$test_root/copilot/skills/code-review-tour" ]]

# Reinstalling the same release must update in place without nesting directories.
CODE_REVIEW_TOUR_ARCHIVE="$archive" \
CODE_REVIEW_TOUR_INSTALL_ROOT="$test_root/install" \
CODE_REVIEW_TOUR_BIN_ROOT="$test_root/bin" \
CODE_REVIEW_TOUR_CODEX_SKILL_ROOT="$test_root/codex/skills" \
CODE_REVIEW_TOUR_CLAUDE_SKILL_ROOT="$test_root/claude/skills" \
CODE_REVIEW_TOUR_GEMINI_SKILL_ROOT="$test_root/gemini/skills" \
CODE_REVIEW_TOUR_COPILOT_SKILL_ROOT="$test_root/copilot/skills" \
  ./scripts/install.sh >/dev/null
[[ ! -d "$test_root/install/$package_version/bin/bin" ]]

# The installed command must be able to reuse its bundled installer.
CODE_REVIEW_TOUR_ARCHIVE="$archive" \
CODE_REVIEW_TOUR_INSTALL_ROOT="$test_root/install" \
CODE_REVIEW_TOUR_BIN_ROOT="$test_root/bin" \
CODE_REVIEW_TOUR_CODEX_SKILL_ROOT="$test_root/codex/skills" \
CODE_REVIEW_TOUR_CLAUDE_SKILL_ROOT="$test_root/claude/skills" \
CODE_REVIEW_TOUR_GEMINI_SKILL_ROOT="$test_root/gemini/skills" \
CODE_REVIEW_TOUR_COPILOT_SKILL_ROOT="$test_root/copilot/skills" \
  "$test_root/bin/code-review-tour" update --minimal >/dev/null
"$test_root/bin/code-review-tour" uninstall --dry-run | grep -q "Review sessions are preserved"

minimal_root="$test_root/minimal"
CODE_REVIEW_TOUR_ARCHIVE="$archive" \
CODE_REVIEW_TOUR_INSTALL_ROOT="$minimal_root/install" \
CODE_REVIEW_TOUR_BIN_ROOT="$minimal_root/bin" \
CODE_REVIEW_TOUR_CODEX_SKILL_ROOT="$minimal_root/codex/skills" \
CODE_REVIEW_TOUR_CLAUDE_SKILL_ROOT="$minimal_root/claude/skills" \
CODE_REVIEW_TOUR_GEMINI_SKILL_ROOT="$minimal_root/gemini/skills" \
CODE_REVIEW_TOUR_COPILOT_SKILL_ROOT="$minimal_root/copilot/skills" \
  ./scripts/install.sh --minimal >/dev/null
"$minimal_root/bin/code-review-tour" bridge >/dev/null
[[ ! -e "$minimal_root/codex/skills/code-review-tour" ]]

# Exercise local rollback without fetching another release.
cp -R "$test_root/install/$package_version" "$test_root/install/0.0.0"
printf '0.0.0\n%s\n' "$package_version" > "$test_root/install/history"
CODE_REVIEW_TOUR_INSTALL_ROOT="$test_root/install" CODE_REVIEW_TOUR_BIN_ROOT="$test_root/bin" \
  "$test_root/bin/code-review-tour" rollback --to 0.0.0 >/dev/null
[[ "$(readlink "$test_root/install/current")" == "$test_root/install/0.0.0" ]]

CODE_REVIEW_TOUR_INSTALL_ROOT="$minimal_root/install" \
CODE_REVIEW_TOUR_BIN_ROOT="$minimal_root/bin" \
CODE_REVIEW_TOUR_CODEX_SKILL_ROOT="$minimal_root/codex/skills" \
CODE_REVIEW_TOUR_CLAUDE_SKILL_ROOT="$minimal_root/claude/skills" \
CODE_REVIEW_TOUR_GEMINI_SKILL_ROOT="$minimal_root/gemini/skills" \
CODE_REVIEW_TOUR_COPILOT_SKILL_ROOT="$minimal_root/copilot/skills" \
  "$minimal_root/bin/code-review-tour" uninstall --yes >/dev/null
[[ ! -e "$minimal_root/install" ]]
[[ ! -e "$minimal_root/bin/code-review-tour" ]]
