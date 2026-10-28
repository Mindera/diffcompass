#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
[[ $# -ge 1 && -f "$1" ]] || { echo "Usage: scripts/smoke-old-installer.sh <old install.sh>" >&2; exit 1; }
old_installer="$1"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform="darwin-arm64" ;;
  Darwin-x86_64) platform="darwin-x64" ;;
  Linux-aarch64) platform="linux-arm64" ;;
  Linux-x86_64) platform="linux-x64" ;;
  *) echo "Unsupported smoke-test platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

archive="$(find dist/release -maxdepth 1 -name "diffcompass-v*-${platform}.tar.gz" -print -quit)"
[[ -n "$archive" ]] || { echo "Build release archives before running the old-installer smoke test." >&2; exit 1; }
package_version="$(bun -e 'console.log((await Bun.file("package.json").json()).version)')"

DIFFCOMPASS_ARCHIVE="$archive" \
DIFFCOMPASS_INSTALL_ROOT="$test_root/install" \
DIFFCOMPASS_BIN_ROOT="$test_root/bin" \
DIFFCOMPASS_CODEX_SKILL_ROOT="$test_root/codex/skills" \
DIFFCOMPASS_CLAUDE_SKILL_ROOT="$test_root/claude/skills" \
DIFFCOMPASS_GEMINI_SKILL_ROOT="$test_root/gemini/skills" \
DIFFCOMPASS_COPILOT_SKILL_ROOT="$test_root/copilot/skills" \
  bash "$old_installer" >/dev/null

[[ "$("$test_root/bin/diffcompass" --version)" == "$package_version" ]] || { echo "The old installer did not install version $package_version." >&2; exit 1; }
cmp scripts/install.sh "$test_root/install/current/share/diffcompass/install.sh"
