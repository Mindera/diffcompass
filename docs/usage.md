# Usage and configuration

[Back to the README](../README.md)

## Sessions and retention

Manage saved tours in `Settings → Manage sessions` or from the CLI:

```sh
diffcompass sessions
diffcompass sessions --all
diffcompass sessions resume 169dedd6 --open
diffcompass sessions rename 169dedd6 "Push notification review"
diffcompass sessions archive 169dedd6
diffcompass sessions unarchive 169dedd6
diffcompass sessions delete 169dedd6 --yes
diffcompass sessions prune --repo . --days 30 --max 50 [--yes]
```

Sessions live under `${XDG_STATE_HOME:-~/.local/state}/diffcompass/sessions`
and are written atomically. Pruning previews by default, honors repository
retention defaults, preserves archived sessions unless requested, and can remove
stale tool-owned temporary directories with `--temp-hours N`. Process locks
protect active sessions and proposal/bridge workspaces; paths and freshness are
rechecked before deletion. PR worktrees are removed only from the tool-owned
state directory and only when clean.

## Comparison base

When `--base` is omitted, resolution uses:

1. `branch.<current>.reviewTourBase` from local Git config;
2. `origin/HEAD`;
3. `origin/main`, `origin/master`, `main`, or `master`.

For a stacked branch:

```sh
git config branch.my-feature.reviewTourBase parent-feature
```

## Repository defaults

Add `.diffcompass.json` at the repository root:

```json
{
  "base": "origin/main",
  "agent": "codex",
  "model": "gpt-5.6",
  "reasoning": "high",
  "diff": {
    "layout": "split",
    "changedFilesOnly": true,
    "contextLines": 25
  },
  "review": {
    "requireAllFilesReviewed": true,
    "closeOutcome": "accepted"
  },
  "analysis": {
    "instructions": [
      "Treat authentication and persisted-session changes as high risk."
    ],
    "findings": {
      "enabled": true,
      "categories": ["correctness", "security", "testing"],
      "minimumSeverity": "medium"
    }
  },
  "retention": {
    "maxAgeDays": 30,
    "maxSessions": 50,
    "includeArchived": false
  }
}
```

| Setting | Bounds and precedence |
| --- | --- |
| `diff.contextLines` | 3–200 |
| `review.closeOutcome` | `accepted` or `cancelled`; cancelled exposes only Cancel review |
| `analysis.instructions` | Up to 32 distinct instructions, 2,000 characters each |
| Finding categories | Up to 32 names |
| Minimum severity | `low`, `medium`, `high`, or `critical` |
| Precedence | Explicit CLI values → repository defaults → built-in/Git-inferred defaults |

Unknown settings fail closed. Resumed sessions retain their original settings.
Repository instructions cannot override read-only execution, evidence rules, or
the response contract. Component maps, call flows, sequence diagrams, adaptive
diagrams, and findings start enabled; disabling one skips its generation work.

## Attached-agent protocol

The launching agent must keep serving authenticated bridge events; invoking the
CLI alone does not provide a responder. The bundled skill documents the
long-lived watcher, bounded polling fallback, and response schemas.

- `--attached --open` implies `--start-tour`, preparing the outline and first
  explanation before opening one user-facing page.
- Future stops prepare concurrently inside the configured window; questions
  bypass that queue.
- Browser and bridge tokens are separate. Browser mutations require same-origin
  requests; the bridge token uses an owner-only temporary file.
- Closing sends the outcome, overall note, and feedback to the same agent.
- Feedback includes the reviewed Git tree. Passing it back through `--base`
  scopes a follow-up tour to feedback-induced changes.
- A lost attached heartbeat may use the local fallback, but edits remain
  request-gated and isolated.

Standalone agents remain read-only, although reviewers can still author edit
suggestions.


## Upgrading from version 1

Version 2 uses the `diffcompass` command and skill, `.diffcompass.json`, and
`DIFFCOMPASS_*` environment variables. Installations and saved sessions now live
under the `diffcompass` directories. Previous installations and saved data are
not deleted or automatically migrated.
