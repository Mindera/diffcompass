export function browserCommand(reviewUrl: string, platform = process.platform): string[] {
  return platform === "darwin"
    ? ["open", reviewUrl]
    : platform === "win32"
      ? ["cmd", "/c", "start", "", reviewUrl]
      : ["xdg-open", reviewUrl];
}

export async function prepareAndOpenReviewPage(
  automaticTour: Promise<unknown> | undefined,
  reviewUrl: string,
  dependencies: {
    platform?: NodeJS.Platform;
    open?: (command: string[]) => void;
    reportError?: (message: string) => void;
  } = {},
): Promise<boolean> {
  const reportError = dependencies.reportError ?? console.error;
  try {
    await automaticTour;
  } catch (error) {
    reportError(`Could not prepare the tour: ${error instanceof Error ? error.message : String(error)}`);
    reportError("The browser was not opened because the first tour stop is not ready. Inspect the running review URL or retry the tour after resolving the error.");
    return false;
  }

  try {
    const command = browserCommand(reviewUrl, dependencies.platform);
    (dependencies.open ?? ((argv) => {
      Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    }))(command);
    return true;
  } catch (error) {
    reportError(`Could not open the browser automatically: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
