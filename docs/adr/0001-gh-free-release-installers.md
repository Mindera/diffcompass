# Release installers download public release assets, without the GitHub CLI

`scripts/install.sh` and `scripts/install.ps1` download the release archive and `checksums.txt`
only over public HTTPS from GitHub Releases, read the latest tag from the
`github.com/Mindera/diffcompass/releases/latest` redirect, and never call `gh`. Each release
publishes both scripts as assets, so the documented one-liners fetch
`releases/latest/download/install.sh` (or `install.ps1`), not a file on `main`. We chose this when
the repository became public on 2026-10-28: a single download path is the only one tests can cover
on every platform, the redirect has no rate limit and needs no token, and the script users run
comes from a released, tested version rather than from unreleased code on `main`.

## Considered options

- Serving the script from `raw.githubusercontent.com/Mindera/diffcompass/main` — rejected because
  users would run unreleased installer changes against the latest release's archives.
- GitHub Pages or a custom domain — rejected because it needs organisation-level setup outside this
  repository and buys only a shorter URL.
- Querying `api.github.com` first with an optional token, then the redirect — rejected because it
  adds code paths and an anonymous limit of 60 requests an hour per IP for a lookup the redirect
  already answers.
- Keeping `gh release download` when `gh` is signed in — rejected because each machine would
  exercise only one of two download paths.

## Consequences

- `diffcompass update` runs the installer bundled with the installed version, so installs from
  v2.2.4 and earlier still need `gh`, or an explicit version, for the one update that reaches a
  release with this installer.
- The one-liners resolve only once a release carries the script assets, so the release that first
  publishes them is tagged as soon as the README pointing at them merges. After that, every release
  keeps publishing both scripts, even one that reverts the installer logic, so the link never
  returns 404.
- One version's installer routinely unpacks another version's archive: `diffcompass update`,
  `--version` pins and a release landing mid-install all do it. The archive name, its
  `diffcompass-v<ver>-<os>-<arch>/` top folder, its `bin/` and `share/diffcompass/` folders and the
  `checksums.txt` line format therefore change only by addition.
