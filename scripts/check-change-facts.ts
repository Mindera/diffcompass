import { scanCapturedTree } from "../src/change-callers.ts";
import { loadComparisonBetweenTrees } from "../src/git.ts";

const [command, ...rest] = process.argv.slice(2);
if (command !== "time-scan" || !rest.length || rest.length % 2) {
  console.error("Usage: bun scripts/check-change-facts.ts time-scan <repo> <commit> [<repo> <commit> ...]");
  process.exit(2);
}

const unlimited = { files: Infinity, bytes: Infinity, millis: Infinity };
let largestFiles = 0, largestBytes = 0, slowestMs = 0;
for (let index = 0; index < rest.length; index += 2) {
  const repo = rest[index]!, commit = rest[index + 1]!;
  const resolved = Bun.spawnSync(["git", "rev-parse", "--verify", `${commit}^{commit}`], { cwd: repo });
  if (resolved.exitCode) { console.error(`Cannot resolve ${commit} in ${repo}`); process.exit(1); }
  const sha = resolved.stdout.toString().trim();
  const comparison = await loadComparisonBetweenTrees(repo, { base: sha, mergeBase: sha, head: sha, sourceTree: sha });
  const runsMs: number[] = [];
  let coverage;
  for (let run = 0; run < 3; run++) {
    const started = performance.now();
    coverage = (await scanCapturedTree(comparison, "new", { names: new Set(["timingProbe"]), limits: unlimited })).coverage;
    runsMs.push(Math.round(performance.now() - started));
  }
  const { totalFiles, scannedFiles, scannedBytes } = coverage;
  largestFiles = Math.max(largestFiles, totalFiles);
  largestBytes = Math.max(largestBytes, scannedBytes);
  slowestMs = Math.max(slowestMs, ...runsMs);
  console.log(JSON.stringify({ repo, commit, totalFiles, scannedFiles, scannedBytes, runsMs }));
}

const mebibyte = 1_048_576;
console.log(JSON.stringify({
  limits: {
    files: Math.ceil(4 * largestFiles / 1000) * 1000,
    bytes: Math.ceil(4 * largestBytes / mebibyte) * mebibyte,
    millis: Math.max(5000, Math.ceil(4 * slowestMs / 1000) * 1000),
  },
}));
