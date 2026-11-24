import type { ReviewLaunchMode } from "./types.ts";

export function reviewLaunchMode(options: { mode?: ReviewLaunchMode; startTour: boolean; attached: boolean; open: boolean }, saved?: ReviewLaunchMode): ReviewLaunchMode {
  if (options.mode && options.startTour && options.mode !== "tour") {
    throw new Error("--start-tour cannot be combined with --mode changes or --mode briefing.");
  }
  return options.mode ?? (options.startTour ? "tour" : saved ?? (options.attached && options.open ? "tour" : "changes"));
}
