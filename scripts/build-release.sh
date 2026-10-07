#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

version="$(bun -e 'console.log((await Bun.file("package.json").json()).version)')"
release_root="dist/release"
rm -rf "$release_root"
mkdir -p "$release_root"
archify_stage="$release_root/archify"
bun scripts/package-archify.ts "$archify_stage"

targets=(
  "darwin-arm64:bun-darwin-arm64"
  "darwin-x64:bun-darwin-x64"
  "linux-arm64:bun-linux-arm64"
  "linux-x64:bun-linux-x64"
  "windows-arm64:bun-windows-arm64"
  "windows-x64:bun-windows-x64"
)

for entry in "${targets[@]}"; do
  platform="${entry%%:*}"
  bun_target="${entry##*:}"
  package_root="$release_root/diffcompass-v${version}-${platform}"
  mkdir -p "$package_root/bin" "$package_root/share/diffcompass/skills"
  executable="diffcompass"
  [[ "$platform" == windows-* ]] && executable="diffcompass.exe"
  bun build --compile --minify --target="$bun_target" src/cli.ts --outfile "$package_root/bin/$executable"
  cp -R skills/diffcompass "$package_root/share/diffcompass/skills/diffcompass"
  cp -R "$archify_stage" "$package_root/share/diffcompass/archify"
  bun scripts/package-monaco.ts "$package_root/share/diffcompass/monaco"
  cp scripts/install.sh scripts/install.ps1 "$package_root/share/diffcompass/"
  cp README.md "$package_root/README.md"
  if [[ "$platform" == windows-* ]]; then
    (cd "$release_root" && zip -qr "diffcompass-v${version}-${platform}.zip" "$(basename "$package_root")")
  else
    tar -C "$release_root" -czf "$release_root/diffcompass-v${version}-${platform}.tar.gz" "$(basename "$package_root")"
  fi
  rm -rf "$package_root"
done
rm -rf "$archify_stage"

(
  cd "$release_root"
  shasum -a 256 ./*.tar.gz ./*.zip > checksums.txt
)
echo "Release artifacts are in $release_root"
