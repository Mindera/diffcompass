#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

version="$(bun -e 'console.log((await Bun.file("package.json").json()).version)')"
release_root="dist/release"
rm -rf "$release_root"
mkdir -p "$release_root"

targets=(
  "darwin-arm64:bun-darwin-arm64"
  "darwin-x64:bun-darwin-x64"
  "linux-arm64:bun-linux-arm64"
  "linux-x64:bun-linux-x64"
)

for entry in "${targets[@]}"; do
  platform="${entry%%:*}"
  bun_target="${entry##*:}"
  package_root="$release_root/code-review-tour-v${version}-${platform}"
  mkdir -p "$package_root/bin" "$package_root/share/code-review-tour/skills"
  bun build --compile --minify --target="$bun_target" src/cli.ts --outfile "$package_root/bin/code-review-tour"
  cp -R skills/code-review-tour "$package_root/share/code-review-tour/skills/code-review-tour"
  cp README.md "$package_root/README.md"
  tar -C "$release_root" -czf "$release_root/code-review-tour-v${version}-${platform}.tar.gz" "$(basename "$package_root")"
  rm -rf "$package_root"
done

(
  cd "$release_root"
  shasum -a 256 ./*.tar.gz > checksums.txt
)
echo "Release artifacts are in $release_root"
