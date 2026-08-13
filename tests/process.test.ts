import { expect, test } from "bun:test";
import { runProcess } from "../src/process.ts";

test("process output can be observed without changing the captured result", async () => {
  const chunks: string[] = [];
  const result = await runProcess([Bun.which("bun")!, "-e", 'console.log("first"); console.log("second")'], process.cwd(), [0], {
    onStdout: (chunk) => chunks.push(chunk),
  });
  expect(chunks.join("")).toBe("first\nsecond\n");
  expect(result.stdout).toBe("first\nsecond\n");
});
