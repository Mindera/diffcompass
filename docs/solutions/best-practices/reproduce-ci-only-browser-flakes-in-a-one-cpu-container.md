---
module: "scripts/check-monaco.ts"
date: 2026-10-28
problem_type: best_practice
component: testing
applies_when:
  - "a Monaco or Briefing browser check fails in CI but passes locally"
  - "deciding whether a browser-check failure is a timing race or a real regression"
related_components:
  - "scripts/monaco-fixture.ts"
  - ".github/workflows/ci.yml"
tags: [ci, flaky-tests, playwright, monaco, docker]
---
# Context
The browser checks run by `bun run test:monaco` fail intermittently in CI while
passing on a developer Mac. On 2026-10-28 a gutter-check race failed in CI and could
not be reproduced locally, under CDP CPU throttling (4x and 6x), with every
`requestAnimationFrame` delayed by 150 ms, or in a 2-CPU Linux container (0 of 10
runs). It reproduced only in a 1-CPU Linux container: 2 of 10 runs, at the same step
CI failed. Throttling and slowed frames stretch every step equally, so the race
window does not widen; only CPU contention between Monaco's render work and the
check's reads does.

The same suite had also failed, in earlier CI runs, in the Briefing diagram-click,
GitHub-suggestions click, semantic `waitFor`, edits screenshot and reviewed-scroll
position checks.

# Guidance
Start from CI's own evidence. When a `monaco` matrix job fails, the workflow uploads
the `monaco-browser-failure-<group>` artifact, and a check that screenshots on
failure leaves a `dc-<check>-failure.png` in it. Download it with
`gh run download <run id> -n monaco-browser-failure-<group>`; the screenshot shows
the layout, wrap and theme the failing step was in.

Then reproduce in a 1-CPU container from the Playwright image whose tag matches the
installed `playwright` package (1.63.0 on 2026-10-28), with the Bun version CI pins:

```sh
docker run --rm --cpus=1 --memory=7g -v "$PWD":/src:ro mcr.microsoft.com/playwright:v1.63.0-noble bash -lc '
  mkdir /work && cd /src && tar --exclude=./node_modules --exclude=./dist --exclude=./.git -cf - . | tar -xf - -C /work
  cd /work && git init -q && git add -A && git -c user.name=ci -c user.email=ci@example.com commit -qm snapshot
  npm i -g bun@1.3.14 >/dev/null && bun install --frozen-lockfile >/dev/null
  # run the check N times here, each against a fresh fixture (see below)
'
```

`.git` is excluded because a worktree's `.git` file points outside the container.
Run each attempt the way `checkFixture` in `scripts/check-monaco.ts` does: start
`bun scripts/monaco-fixture.ts` with `DIFF_VIEWER_PORT=0`, an empty
`DIFF_VIEWER_STATE` and the group's `DIFF_VIEWER_PR_EXAMPLE` /
`DIFF_VIEWER_BEFORE_TOUR`, read the `Production fixture:` and `Repository:` lines
from its stdout, then run `CI=1 bun scripts/<check>-browser.mjs
node_modules/playwright/index.mjs <url> <repository>` and kill the fixture. A fresh
fixture per run matters: each check mutates review state and preferences.

Run at least 10 attempts to see the failure rate, and 30 after a fix: 30 clean runs
against a 20% baseline happen by chance about 0.1% of the time.

# When to Apply
Any browser check that fails in CI and not locally, before changing the check or
the app.

# Examples
On 2026-10-28 the gutter check failed 2 of 10 runs this way and 0 of 30 once it
waited for the review badge to re-measure (`scripts/monaco-gutter-browser.mjs`).
