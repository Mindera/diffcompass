import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

test.skipIf(process.platform === "win32")("Copilot reads the complete diff from its allowed directory across turns and cleans up after errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "diffcompass-copilot-input-"));
  try {
    const patch = "diff --git a/app.ts b/app.ts\n" + "+const value = 'large review evidence';\n".repeat(10_000);
    await writeFile(join(directory, "expected.diff"), patch);
    const executable = join(directory, "copilot");
    await writeFile(executable, `#!${process.execPath}
import { appendFile, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const args = process.argv.slice(2);
if (args.includes('--attachment')) { console.error('--attachment file type not supported'); process.exit(2); }
const prompt = args[args.indexOf('--prompt') + 1];
const match = prompt.match(/Read the complete review diff from ("(?:[^"\\\\]|\\\\.)*")/);
const diffPath = match ? JSON.parse(match[1]) : undefined;
if (diffPath) {
  if (args[args.indexOf('--add-dir') + 1] !== dirname(diffPath)) throw Error('Diff directory was not allowed');
  if (!args.includes('--disallow-temp-dir') || args.includes('--allow-all-paths')) throw Error('Temporary access was broadened');
  const content = await readFile(diffPath, 'utf8');
  if (content !== await readFile(join(process.env.FIXTURE_ROOT, 'expected.diff'), 'utf8')) throw Error('Diff evidence was lost');
  if (((await stat(diffPath)).mode & 0o777) !== 0o600) throw Error('Diff is not private');
  if (prompt.includes(content)) throw Error('Large diff was put in argv');
} else if (args.includes('--add-dir')) throw Error('Unneeded directory access');
await appendFile(join(process.env.FIXTURE_ROOT, 'capture.jsonl'), JSON.stringify({ diffPath, sessionId: args[args.indexOf('--session-id') + 1] }) + '\\n');
if (await Bun.file(join(process.env.FIXTURE_ROOT, 'fail')).exists()) { console.error('Fixture Copilot failure'); process.exit(3); }
console.log(diffPath ? '{"dryRunPlans":[]}' : 'Follow-up answer.');
`);
    await chmod(executable, 0o700);
    const runner = join(directory, "runner.ts");
    await writeFile(runner, `
import { TourAgent } from ${JSON.stringify(new URL("../src/agent.ts", import.meta.url).pathname)};
const directory = process.env.FIXTURE_ROOT;
const agent = new TourAgent(directory, { adapterId: 'copilot', modelId: 'auto' });
const comparison = { repositoryRoot: directory, repositoryName: 'fixture', base: 'main', mergeBase: 'base', head: 'head', files: [], patch: await Bun.file(directory + '/expected.diff').text() };
const outline = { callFlows: [], flows: [] };
const first = await agent.generateDryRunPlans(comparison, outline);
const resumed = await agent.generateDryRunPlans(comparison, outline);
const question = await agent.answer('Explain the review');
await Bun.write(directory + '/fail', 'fail');
let failed = false;
try { await agent.generateDryRunPlans(comparison, outline); } catch (error) { failed = error.message.includes('Fixture Copilot failure'); }
console.log(JSON.stringify({ first: first.value, resumed: resumed.value, question: question.value, failed }));
`);
    const child = Bun.spawn([process.execPath, runner], {
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, FIXTURE_ROOT: directory },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ first: [], resumed: [], question: "Follow-up answer.", failed: true });
    const turns = (await readFile(join(directory, "capture.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line) as { diffPath?: string; sessionId: string });
    expect(turns).toHaveLength(4);
    expect(new Set(turns.map(turn => turn.sessionId)).size).toBe(1);
    expect(turns[2]?.diffPath).toBeUndefined();
    const paths = turns.flatMap(turn => turn.diffPath ? [turn.diffPath] : []);
    expect(new Set(paths).size).toBe(3);
    for (const path of paths) {
      expect(await Bun.file(path).exists()).toBe(false);
      await expect(stat(dirname(path))).rejects.toMatchObject({ code: "ENOENT" });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
