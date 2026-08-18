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
): Promise<void> {
  const reportError = dependencies.reportError ?? console.error;
  let preparationFailed = false;
  try {
    await automaticTour;
  } catch (error) {
    preparationFailed = true;
    reportError(`Could not prepare the tour: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const command = browserCommand(reviewUrl, dependencies.platform);
    (dependencies.open ?? ((argv) => {
      Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    }))(command);
    if (preparationFailed) reportError("The review page was opened so the startup error is visible and the tour can be retried.");
  } catch (error) {
    reportError(`Could not open the browser automatically: ${error instanceof Error ? error.message : String(error)}`);
  }
}
