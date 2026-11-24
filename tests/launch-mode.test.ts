import { expect, test } from "bun:test";
import { reviewLaunchMode } from "../src/launch-mode.ts";

const attached = { attached: true, open: true, startTour: false };

test("explicit modes override automatic attached tours and saved launch modes", () => {
  for (const mode of ["changes", "briefing", "tour"] as const) {
    expect(reviewLaunchMode({ ...attached, mode })).toBe(mode);
    expect(reviewLaunchMode({ ...attached, mode }, "tour")).toBe(mode);
    expect(reviewLaunchMode({ ...attached, mode }, "briefing")).toBe(mode);
  }
});

test("legacy launches keep their defaults, while resume remembers its mode", () => {
  expect(reviewLaunchMode(attached)).toBe("tour");
  expect(reviewLaunchMode({ ...attached, open: false })).toBe("changes");
  expect(reviewLaunchMode({ ...attached, attached: false })).toBe("changes");
  expect(reviewLaunchMode({ ...attached, open: false, startTour: true })).toBe("tour");
  for (const saved of ["changes", "briefing", "tour"] as const) expect(reviewLaunchMode(attached, saved)).toBe(saved);
  expect(reviewLaunchMode({ ...attached, startTour: true }, "briefing")).toBe("tour");
});

test("conflicting legacy and explicit launch modes fail instead of silently generating a tour", () => {
  for (const mode of ["changes", "briefing"] as const) {
    expect(() => reviewLaunchMode({ ...attached, mode, startTour: true })).toThrow("cannot be combined");
  }
  expect(reviewLaunchMode({ ...attached, mode: "tour", startTour: true })).toBe("tour");
});
