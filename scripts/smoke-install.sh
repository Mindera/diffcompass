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
