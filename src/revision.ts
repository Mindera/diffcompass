import type { DiffFile, RevisionFileClassification, RevisionSummary } from "./types.ts";

/** Classify the relationship between the last reviewed source and the current full change. */
export function classifyRevisionFiles(
  checkpointFiles: DiffFile[],
  currentFiles: DiffFile[],
  sinceCheckpointFiles: DiffFile[],
): Map<string, RevisionFileClassification> {
  const previous = new Set(checkpointFiles.map((file) => file.path));
  const current = new Set(currentFiles.map((file) => file.path));
  const delta = new Set(sinceCheckpointFiles.map((file) => file.path));
  const paths = [...new Set([...previous, ...current, ...delta])].sort((left, right) => left.localeCompare(right));
  return new Map(paths.map((path) => [path, !current.has(path) && previous.has(path)
    ? "resolved"
    : delta.has(path)
      ? previous.has(path) ? "changed-again" : "new"
      : "unchanged"]));
}

export function revisionSummary(
  checkpointId: string | undefined,
  checkpointCreatedAt: string | undefined,
  checkpointFiles: DiffFile[],
  currentFiles: DiffFile[],
  sinceCheckpointFiles: DiffFile[],
): RevisionSummary {
  const classifications = classifyRevisionFiles(checkpointFiles, currentFiles, sinceCheckpointFiles);
  const groups: Record<RevisionFileClassification, string[]> = { new: [], "changed-again": [], resolved: [], unchanged: [] };
  for (const [path, classification] of classifications) groups[classification].push(path);
  const changedFiles = sinceCheckpointFiles.length;
  const additions = sinceCheckpointFiles.reduce((sum, file) => sum + file.additions, 0);
  const deletions = sinceCheckpointFiles.reduce((sum, file) => sum + file.deletions, 0);
  const details = [
    groups.new.length ? `${groups.new.length} new` : "",
    groups["changed-again"].length ? `${groups["changed-again"].length} changed again` : "",
    groups.resolved.length ? `${groups.resolved.length} resolved` : "",
    groups.unchanged.length ? `${groups.unchanged.length} unchanged` : "",
  ].filter(Boolean);
  return {
    ...(checkpointId ? { checkpointId } : {}),
    ...(checkpointCreatedAt ? { checkpointCreatedAt } : {}),
    changedFiles,
    additions,
    deletions,
    newFiles: groups.new,
    changedAgainFiles: groups["changed-again"],
    resolvedFiles: groups.resolved,
    unchangedFiles: groups.unchanged,
    text: checkpointId
      ? `${changedFiles} file${changedFiles === 1 ? "" : "s"} changed since last review${details.length ? ` · ${details.join(", ")}` : ""}`
      : "No review checkpoint yet. Create one before refreshing to preserve reviewed files.",
  };
}
