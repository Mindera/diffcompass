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

test.skipIf(process.platform === "win32")("a timeout returns promptly when a child outlives the killed command", async () => {
  const started = performance.now();
  await expect(runProcess(["sh", "-c", "sleep 3; echo late"], process.cwd(), [0], { timeoutMs: 200 })).rejects.toThrow(
    "The command timed out after 200ms.",
  );
  expect(performance.now() - started).toBeLessThan(1_500);
});

test.skipIf(process.platform === "win32")("an abort returns promptly when a child outlives the killed command", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  const started = performance.now();
  await expect(
    runProcess(["sh", "-c", "sleep 3; echo late"], process.cwd(), [0], { signal: controller.signal }),
  ).rejects.toThrow("The command was cancelled.");
  expect(performance.now() - started).toBeLessThan(1_500);
});
