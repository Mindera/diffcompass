---
module: ":"
date: 2026-10-29
problem_type: best_practice
component: worker
applies_when:
  - "calling an external tool through runProcess with timeoutMs or an abort signal"
  - "the tool is launched through a shim or wrapper script that starts the real program as its own child"
  - "a timeout is expected to stop the tool's work, not only to end the call"
tags: [process, timeout, bun-spawn, codegraph, orphan]
---
# Context
`runProcess` (`src/process.ts`) kills only the process it spawned. Many CLIs start
their real program as a child: the npm-installed `codegraph` (CodeGraph 1.6.2) is
`npm-shim.js`, which runs the bundled CLI through
`child_process.spawnSync(..., { stdio: "inherit" })`, and any `sh -c` command does the
same. The child inherits stdout and stderr.

Measured on 2026-10-29: before the fix, a 200 ms timeout on
`sh -c "sleep 2; echo late"` returned after 2,016 ms, because `runProcess` killed `sh`
and then kept awaiting EOF on pipes that the surviving `sleep` still held. Since the
fix, once the direct child exits after a timeout or abort, `runProcess` cancels its
stdout and stderr readers and throws at once (`tests/process.test.ts` pins the
prompt return).

# Guidance
A `runProcess` timeout bounds how long the caller waits. It does not stop the work:
the grandchild keeps running, orphaned, until it finishes on its own. Do not rely on
`timeoutMs` to free a tool's CPU, memory, locks or files.

Killing the whole process tree was considered and dropped. Bun.spawn (1.4.x) offers no
option to start a child in its own process group or session, so there is no group to
signal, and the repository has no process-tree kill. Adding one means extra machinery,
such as walking descendants with `pgrep -P` or launching through a wrapper that calls
`setsid`. Weigh that against how long the tool can run after a timeout.

# When to Apply
- A new caller of `runProcess` whose tool may hang or run long after the caller gives up.
- Investigating stray `codegraph` (or other shimmed CLI) processes left after a timed-out
  query from `src/change-callers.ts`.
- Changing `runProcess`'s kill path: the reader cancellation is what keeps a timeout
  prompt when a grandchild holds the pipes.

# Examples
`codeGraphCallers` in `src/change-callers.ts` runs each `codegraph callers` query with
`timeoutMs: 5_000`. A stuck query now returns after about 5 s, and the bundled CodeGraph
process it started keeps running in the background until it ends.
