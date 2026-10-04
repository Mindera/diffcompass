/** Dedicated semantic review fixture; never uses the coordinator's live lab. */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareTestFixture } from "../src/test-fixture.ts";
import { ReviewSession } from "../src/session.ts";
import { startServer } from "../src/server.ts";
const fixture = await prepareTestFixture({ root: "/tmp/diffcompass-semantic-fixture-47633", reset: true });
await writeFile(join(fixture.repository, "Sample.kt"), "class Sample {\n val count = 1\n fun total(x: Int): Int = x + count\n}\n");
await writeFile(join(fixture.repository, "broken.ts"), "function invalid( {\n");
await writeFile(join(fixture.repository, "unsupported.py"), "def greet():\n    return 'hello'\n");
const session = await ReviewSession.create(fixture.repository, undefined, { resume: true, stateFile: fixture.stateFile, agentAdapters: [], attached: true });
startServer(session, 47633, fixture.root, true);
console.log("Semantic fixture ready: http://127.0.0.1:47633");
