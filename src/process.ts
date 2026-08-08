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
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (options.signal?.aborted) throw new Error("The command was cancelled.");
  const process = Bun.spawn(command, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const stop = () => process.kill();
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
    [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
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
