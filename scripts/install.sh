#!/usr/bin/env bash
set -euo pipefail

repository="Mindera/diffcompass"
version="${DIFFCOMPASS_VERSION:-latest}"
install_root="${DIFFCOMPASS_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/diffcompass}"
bin_root="${DIFFCOMPASS_BIN_ROOT:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
codex_skill_root="${DIFFCOMPASS_CODEX_SKILL_ROOT:-${CODEX_HOME:-$HOME/.codex}/skills}"
claude_skill_root="${DIFFCOMPASS_CLAUDE_SKILL_ROOT:-$HOME/.claude/skills}"
gemini_skill_root="${DIFFCOMPASS_GEMINI_SKILL_ROOT:-$HOME/.gemini/skills}"
copilot_skill_root="${DIFFCOMPASS_COPILOT_SKILL_ROOT:-${COPILOT_HOME:-$HOME/.copilot}/skills}"
minimal="${DIFFCOMPASS_MINIMAL:-0}"

for argument in "$@"; do
  case "$argument" in
    --minimal|--binary-only) minimal=1 ;;
    --no-minimal) minimal=0 ;;
    *) echo "Unknown installer option: $argument" >&2; exit 1 ;;
  esac
done

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) echo "Unsupported operating system: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
pattern="diffcompass-v*-${os}-${arch}.tar.gz"

if [[ -n "${DIFFCOMPASS_ARCHIVE:-}" ]]; then
  [[ -f "$DIFFCOMPASS_ARCHIVE" ]] || { echo "Local release archive not found: $DIFFCOMPASS_ARCHIVE" >&2; exit 1; }
  cp "$DIFFCOMPASS_ARCHIVE" "$temporary/"
  checksum_source="$(dirname "$DIFFCOMPASS_ARCHIVE")/checksums.txt"
  [[ -f "$checksum_source" ]] || { echo "checksums.txt must be beside the local release archive." >&2; exit 1; }
  cp "$checksum_source" "$temporary/checksums.txt"
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if [[ "$version" == "latest" ]]; then
    gh release download --repo "$repository" --pattern "$pattern" --pattern checksums.txt --dir "$temporary"
  else
    gh release download "$version" --repo "$repository" --pattern "$pattern" --pattern checksums.txt --dir "$temporary"
  fi
else
  if [[ "$version" == "latest" ]]; then
    echo "Installing the latest release without GitHub CLI requires an explicit version." >&2
    echo "Install and authenticate gh, or run DIFFCOMPASS_VERSION=vX.Y.Z $0" >&2
    exit 1
  fi
  release_url="https://github.com/$repository/releases/download/$version"
  archive_name="diffcompass-${version}-${os}-${arch}.tar.gz"
  curl --fail --location --silent --show-error "$release_url/$archive_name" --output "$temporary/$archive_name"
  curl --fail --location --silent --show-error "$release_url/checksums.txt" --output "$temporary/checksums.txt"
fi

archive="$(find "$temporary" -maxdepth 1 -name "$pattern" -print -quit)"
[[ -n "$archive" ]] || { echo "No release archive found for ${os}-${arch}." >&2; exit 1; }
archive_name="$(basename "$archive")"
expected="$(awk -v name="$archive_name" '$2 == name || $2 == "./" name { print $1 }' "$temporary/checksums.txt")"
[[ -n "$expected" ]] || { echo "No checksum found for $archive_name." >&2; exit 1; }
actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
[[ "$actual" == "$expected" ]] || { echo "Checksum verification failed for $archive_name." >&2; exit 1; }

tar -xzf "$archive" -C "$temporary"
package_root="$(find "$temporary" -maxdepth 1 -type d -name 'diffcompass-v*' -print -quit)"
[[ -n "$package_root" ]] || { echo "The release archive has an unexpected layout." >&2; exit 1; }
release_version="$(basename "$package_root" | sed -E "s/^diffcompass-v(.+)-${os}-${arch}$/\1/")"
version_root="$install_root/$release_version"
mkdir -p "$version_root/bin" "$version_root/share" "$bin_root"
if [[ ! -x "$version_root/bin/diffcompass" ]]; then cp -R "$package_root/bin/." "$version_root/bin/"; fi
if [[ ! -f "$version_root/share/diffcompass/install.sh" ]]; then cp -R "$package_root/share/." "$version_root/share/"; fi
history_file="$install_root/history"
if [[ -f "$history_file" ]]; then grep -Fvx "$release_version" "$history_file" > "$history_file.tmp" || true; else : > "$history_file.tmp"; fi
printf '%s\n' "$release_version" >> "$history_file.tmp"
mv "$history_file.tmp" "$history_file"
if [[ "$minimal" == "1" || "$minimal" == "true" ]]; then printf 'minimal\n' > "$install_root/install-mode"; else printf 'full\n' > "$install_root/install-mode"; fi
ln -sfn "$version_root" "$install_root/current"
ln -sfn "$install_root/current/bin/diffcompass" "$bin_root/diffcompass"

install_skill() {
  local target="$1/diffcompass"
  local source="$install_root/current/share/diffcompass/skills/diffcompass"
  if [[ -L "$target" ]]; then
    ln -sfn "$source" "$target"
  elif [[ -e "$target" ]]; then
    echo "Existing skill was preserved instead of overwritten: $target" >&2
    return 1
  else
    ln -s "$source" "$target"
  fi
}

skill_error=0
if [[ "$minimal" != "1" && "$minimal" != "true" ]]; then
  mkdir -p "$codex_skill_root" "$claude_skill_root" "$gemini_skill_root" "$copilot_skill_root"
  install_skill "$codex_skill_root" || skill_error=1
  install_skill "$claude_skill_root" || skill_error=1
  install_skill "$gemini_skill_root" || skill_error=1
  install_skill "$copilot_skill_root" || skill_error=1
fi

echo "Installed DiffCompass $release_version"
echo "Command: $bin_root/diffcompass"
if [[ "$minimal" == "1" || "$minimal" == "true" ]]; then
  echo "Skills: skipped (--minimal)"
else
  echo "Codex skill: $codex_skill_root/diffcompass"
  echo "Claude skill: $claude_skill_root/diffcompass"
  echo "Gemini skill: $gemini_skill_root/diffcompass"
  echo "Copilot skill: $copilot_skill_root/diffcompass"
fi
case ":$PATH:" in
  *":$bin_root:"*) ;;
  *) echo "Add $bin_root to PATH to invoke diffcompass directly." ;;
esac
if [[ "$skill_error" -ne 0 ]]; then
  echo "One or more agent skills already existed. Remove or relocate them, then run the installer again." >&2
  exit 2
fi
