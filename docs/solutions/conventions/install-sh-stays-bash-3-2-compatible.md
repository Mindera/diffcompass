---
module: "scripts/install.sh"
date: 2026-10-28
problem_type: convention
component: testing
applies_when:
  - "editing scripts/install.sh"
  - "adding shell syntax to the installer that macOS users run with curl | bash"
status: pending_home
home: "a test in tests/install-script.test.ts, named for macOS running curl | bash under /bin/bash 3.2, that fails when scripts/install.sh uses a bash-4-only construct (declare -A, mapfile or readarray, ${var,,} or ${var^^}, [[ -v, &>>, |&)"
tags: [installer, bash, macos, portability]
---
# Rule
`scripts/install.sh` must run under bash 3.2. The README's macOS one-liner pipes the
script into `bash`, and on a stock Mac that is `/bin/bash` 3.2. `diffcompass update`
runs the bundled copy the same way. So no associative arrays, `mapfile`/`readarray`,
`${var,,}`/`${var^^}`, `[[ -v`, `&>>` or `|&`.
# Until the home lands
CI runs `bun test` on `ubuntu-latest`, whose bash is 5, so CI never catches a bash-4-only
construct. The Bun install-script tests spawn `bash` from `PATH`, which on a stock Mac is
`/bin/bash` 3.2, so a local run on macOS does exercise 3.2 — a Linux run does not. This
entry is the only written record of the rule; the test named in `home:` replaces it, and
the change that adds that test deletes this file in the same commit.
