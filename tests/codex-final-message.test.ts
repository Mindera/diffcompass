import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test.skipIf(process.platform === "win32")("Codex transport uses final output for fresh and resumed turns, fails closed, and cleans up", async () => {
  const directory = await mkdtemp(join(tmpdir(), "diffcompass-final-test-"));
  try {
    const executable = join(directory, "codex");
    await writeFile(executable, `#!${process.execPath}
const args = process.argv.slice(2);
const output = args[args.indexOf('--output-last-message') + 1];
if (!output || !args.includes('--output-last-message')) process.exit(2);
await Bun.write(process.env.CAPTURE_PATH, output);
console.log(JSON.stringify({type:'thread.started',thread_id:'test-thread'}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'I will inspect the graph.'}}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Streamed explanation must not be used.'}}));
const resumed = args[1] === 'resume';
if (resumed && !args.includes('test-thread')) process.exit(3);
await Bun.write(output, await Bun.file(process.env.EMPTY_FLAG).exists() ? '' : resumed ? 'Resumed final explanation.' : 'Final explanation.');
`);
    await chmod(executable, 0o700);
    const runner = join(directory, "runner.ts");
    await writeFile(runner, `
import { TourAgent } from ${JSON.stringify(new URL("../src/agent.ts", import.meta.url).pathname)};
const agent = new TourAgent(${JSON.stringify(directory)}, {adapterId:'codex',modelId:'default'});
const first = await agent.answer('Explain the graph');
const path = await Bun.file(process.env.CAPTURE_PATH).text();
if (await Bun.file(path).exists()) throw new Error('Final file leaked');
const second = await agent.answer('Explain storage');
await Bun.write(process.env.EMPTY_FLAG, 'empty');
let error = '';
try { await agent.answer('Explain more'); } catch (e) { error = e.message; }
console.log(JSON.stringify({first:first.value,second:second.value,error}));
`);
    const capture = join(directory, "capture");
    const child = Bun.spawn([process.execPath, runner], {
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, CAPTURE_PATH: capture, EMPTY_FLAG: join(directory, "empty") },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ first: "Final explanation.", second: "Resumed final explanation.", error: "The tour agent returned no final message." });
    expect(await Bun.file(await readFile(capture, "utf8")).exists()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
