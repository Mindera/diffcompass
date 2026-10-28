---
module: ".github/workflows/release.yml"
date: 2026-10-28
problem_type: convention
component: testing
applies_when:
  - "editing the softprops/action-gh-release step in .github/workflows/release.yml"
  - "editing how scripts/build-release.sh stages or checksums dist/release"
status: pending_home
home: "fail_on_unmatched_files: true on the softprops/action-gh-release step in .github/workflows/release.yml, with an assertion in tests/release-workflows.test.ts named for the README's releases/latest/download links needing install.sh and install.ps1 on every release"
related_components:
  - "scripts/build-release.sh"
  - "README.md"
tags: [release, installer, github-actions, assets]
---
# Rule
Every release must publish `install.sh` and `install.ps1` as assets. The README's
one-liners fetch `releases/latest/download/install.sh` (and `install.ps1`), so a release
published without them makes the documented install return 404 for every new user
(ADR 0001, `docs/adr/0001-gh-free-release-installers.md`).
# Until the home lands
The pinned `softprops/action-gh-release` (v2.6.2) only warns when a `files:` entry
matches nothing, because `fail_on_unmatched_files` defaults to false, and it then
publishes the release anyway. Today the only guard is that `scripts/build-release.sh`
names `./install.sh ./install.ps1` explicitly in its `shasum` line, so under `set -e` a
missing copy fails the build before upload. Rewriting that line to a glob removes the
guard silently. The setting and assertion named in `home:` replace this entry; the change
that adds them deletes this file in the same commit.
