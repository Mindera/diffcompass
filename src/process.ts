export class ProcessError extends Error {
  constructor(
    readonly command: string[],
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super(`${command.join(" ")} exited with ${exitCode}: ${stderr.trim()}`);
  }
}

export async function runProcess(
  command: string[],
  cwd: string,
  acceptedExitCodes: number[] = [0],
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    input?: string;
    env?: Record<string, string | undefined>;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (options.signal?.aborted) throw new Error("The command was cancelled.");
  const process = Bun.spawn(command, {
    cwd,
    stdin: options.input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: options.env ? { ...globalThis.process.env, ...options.env } : undefined,
  });
  if (options.input !== undefined) {
    const stdin = process.stdin;
    if (!stdin) throw new Error("The command input pipe is unavailable.");
    stdin.write(options.input);
    stdin.end();
  }

  let timedOut = false;
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const stop = () => {
    process.kill();
    void process.exited.then(() => {
      for (const reader of readers) void reader.cancel().catch(() => {});
    });
  };
  const timer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        stop();
      }, options.timeoutMs)
    : undefined;
  options.signal?.addEventListener("abort", stop, { once: true });

  let stdout: string;
  let stderr: string;
  let exitCode: number;
  try {
    const read = async (stream: ReadableStream<Uint8Array>, onChunk?: (chunk: string) => void) => {
      const reader = stream.getReader();
      readers.push(reader);
      const decoder = new TextDecoder();
      let output = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        output += chunk;
        if (chunk) onChunk?.(chunk);
      }
      const tail = decoder.decode();
      output += tail;
      if (tail) onChunk?.(tail);
      return output;
    };
    [stdout, stderr, exitCode] = await Promise.all([
      read(process.stdout, options.onStdout),
      read(process.stderr, options.onStderr),
      process.exited,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", stop);
  }

  if (timedOut) throw new Error(`The command timed out after ${options.timeoutMs}ms.`);
  if (options.signal?.aborted) throw new Error("The command was cancelled.");

  if (!acceptedExitCodes.includes(exitCode)) {
    throw new ProcessError(command, exitCode, stderr);
  }

  return { stdout, stderr, exitCode };
}
