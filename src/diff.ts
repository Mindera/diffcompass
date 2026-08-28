import type { DiffFile, DiffHunk, DiffRow } from "./types.ts";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

function cleanPath(value: string): string | null {
  const path = value.trim().split("\t", 1)[0];
  if (path === "/dev/null") return null;
  return path.replace(/^[ab]\//, "");
}

function createFile(oldPath: string | null, newPath: string | null): DiffFile {
  return {
    oldPath,
    newPath,
    path: newPath ?? oldPath ?? "unknown",
    status: oldPath === null ? "added" : newPath === null ? "deleted" : "modified",
    metadata: [],
    hunks: [],
    additions: 0,
    deletions: 0,
  };
}

export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      file = createFile(match?.[1] ?? null, match?.[2] ?? null);
      files.push(file);
      hunk = null;
      continue;
    }

    if (!file) continue;

    // Binary diffs have mode headers but no ---/+++ text headers.
    if (!hunk && line.startsWith("new file mode ")) {
      file.oldPath = null;
      file.status = "added";
    } else if (!hunk && line.startsWith("deleted file mode ")) {
      file.newPath = null;
      file.status = "deleted";
    }

    if (!hunk && line.startsWith("--- ")) {
      file.oldPath = cleanPath(line.slice(4));
      file.metadata.push(line);
      continue;
    }

    if (!hunk && line.startsWith("+++ ")) {
      file.newPath = cleanPath(line.slice(4));
      file.path = file.newPath ?? file.oldPath ?? file.path;
      file.status = file.oldPath === null ? "added" : file.newPath === null ? "deleted" : file.status;
      file.metadata.push(line);
      continue;
    }

    if (!hunk && line.startsWith("rename from ")) {
      file.oldPath = line.slice("rename from ".length);
      file.status = "renamed";
      file.metadata.push(line);
      continue;
    }

    if (!hunk && line.startsWith("rename to ")) {
      file.newPath = line.slice("rename to ".length);
      file.path = file.newPath;
      file.status = "renamed";
      file.metadata.push(line);
      continue;
    }

    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      hunk = {
        header: line,
        oldStart: oldLine,
        oldCount: Number(header[2] ?? 1),
        newStart: newLine,
        newCount: Number(header[4] ?? 1),
        rows: [],
      };
      file.hunks.push(hunk);
      continue;
    }

    if (!hunk) {
      if (line.length > 0) file.metadata.push(line);
      continue;
    }

    let row: DiffRow;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      row = { kind: "addition", content: line.slice(1), oldLine: null, newLine };
      newLine += 1;
      file.additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      row = { kind: "deletion", content: line.slice(1), oldLine, newLine: null };
      oldLine += 1;
      file.deletions += 1;
    } else if (line.startsWith(" ")) {
      row = { kind: "context", content: line.slice(1), oldLine, newLine };
      oldLine += 1;
      newLine += 1;
    } else if (line.length > 0) {
      row = { kind: "meta", content: line, oldLine: null, newLine: null };
    } else {
      continue;
    }
    hunk.rows.push(row);
  }

  return files;
}
