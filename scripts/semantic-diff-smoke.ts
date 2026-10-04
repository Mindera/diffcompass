/** Compile and run from outside the checkout to verify embedded WASM availability. */
import { analyseSemanticSources } from "../src/semantic-diff.ts";
for (const [path, before, after] of [
  ["sample.ts", "export const value = 1;", "export const value = 2;"],
  ["sample.tsx", "const Page = () => <p>old</p>;", "const Page = () => <p>new</p>;"],
  ["Sample.kt", "fun value(): Int = 1\n", "fun value(): Int = 2\n"],
]) {
  const result = await analyseSemanticSources({ path: path!, oldPath: path!, newPath: path!, status: "modified", metadata: [], hunks: [], additions: 1, deletions: 1 }, before!, after!, { beforeTree: "a".repeat(40), afterTree: "b".repeat(40) });
  if (result.status !== "analysed" || !result.changes.some((change) => change.categories.includes("body"))) throw new Error(`${path}: ${result.status}: ${result.message}`);
  console.log(`${path}: parser-backed body change; ${result.engine}`);
}
