# Minders team membership sync

The [Sync Minders team workflow](https://github.com/Mindera/diffcompass/actions/workflows/sync-minders.yml)
runs every night at **02:17 UTC** from `main`. GitHub can delay scheduled runs.
It adds active members of the `Mindera` organization who are missing from the
`minders` team. This team has read access to DiffCompass.

The sync paginates both member lists, preserves existing roles (including
maintainers), and rechecks organization and team membership before each addition.
It never removes members. Writes are serialized and paced; transient API failures
and rate limits receive bounded retries. The final check reports any members
still missing. A failed run can be rerun: completed additions are preserved.

## Credentials

The repository Actions secret **`MINDERS_SYNC_TOKEN`** holds the authenticated
team-maintainer token supplied for this automation. The token is never committed
or printed. GitHub's built-in `GITHUB_TOKEN` cannot manage organization teams.

If the token is revoked, expires, or its owner loses the team-maintainer role,
replace the secret in [repository Actions settings](https://github.com/Mindera/diffcompass/settings/secrets/actions).
A replacement credential must be able to list all organization members and
write team memberships. Fine-grained tokens need Mindera organization
**Members: read and write** permission, and their user must have the appropriate
team-maintainer or organization-owner role. Mindera may require token approval.

See GitHub's [team membership API](https://docs.github.com/en/rest/teams/members#add-or-update-team-membership-for-a-user)
and [workflow authentication guidance](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token#granting-additional-permissions).

## Manual runs

Open the workflow and select **Run workflow** on `main`. Enable **dry_run** to
report missing members without adding them. Normal manual runs perform the same
sync as the nightly schedule. Only one run executes at a time; forks and other
branches are excluded. Results appear in the run summary.

For a local preview using an authenticated GitHub CLI and Bun:

```sh
bun scripts/sync-minders.ts --dry-run
```

Omit `--dry-run` to add the missing members. Run regression tests with
`bun test tests/sync-minders.test.ts`.
