import { expect, test } from "bun:test";
import { createUpdateService, isNewerVersion, type ReleaseFetch } from "../src/update.ts";

test("compares stable release versions numerically", () => {
  expect(isNewerVersion("v1.0.10", "1.0.9")).toBe(true);
  expect(isNewerVersion("1.1.0", "1.0.99")).toBe(true);
  expect(isNewerVersion("2.0.0", "2.0.0")).toBe(false);
  expect(isNewerVersion("1.9.9", "2.0.0")).toBe(false);
});

test("caches update discovery and installs an available release once", async () => {
  let checks = 0;
  let installs = 0;
  const service = createUpdateService({
    currentVersion: "1.0.6",
    now: () => 100,
    latestVersion: async () => { checks += 1; return "v1.0.7"; },
    update: async () => { installs += 1; },
  });

  expect(await service.status()).toEqual({ currentVersion: "1.0.6", latestVersion: "1.0.7", updateAvailable: true });
  expect((await service.status()).updateAvailable).toBe(true);
  expect(checks).toBe(1);
  expect(await service.install()).toEqual({ currentVersion: "1.0.6", latestVersion: "1.0.7", updateAvailable: false, updated: true });
  expect(installs).toBe(1);
});

test("does not invoke the installer when already current", async () => {
  let installs = 0;
  const service = createUpdateService({
    currentVersion: "1.0.6",
    latestVersion: async () => "v1.0.6",
    update: async () => { installs += 1; },
  });
  expect((await service.install()).updateAvailable).toBe(false);
  expect(installs).toBe(0);
});

test("turns discovery failures into a bounded user-facing error", async () => {
  const service = createUpdateService({ latestVersion: async () => { throw new Error("sensitive command output"); } });
  await expect(service.status()).rejects.toThrow("Could not check for DiffCompass updates.");
  await expect(service.status()).rejects.not.toThrow("sensitive command output");
});

test("reads the latest release tag from the releases/latest redirect", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: ReleaseFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, url: "https://github.com/Mindera/diffcompass/releases/tag/v2.3.0" };
  };
  const service = createUpdateService({ currentVersion: "2.2.4", fetch });

  expect(await service.status()).toEqual({ currentVersion: "2.2.4", latestVersion: "2.3.0", updateAvailable: true });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("https://github.com/Mindera/diffcompass/releases/latest");
  expect(calls[0]!.init.method).toBe("HEAD");
  expect(calls[0]!.init.redirect).toBe("follow");
});

test("rejects a release check that does not land on a tag page or is not ok", async () => {
  for (const response of [
    { ok: true, url: "https://github.com/Mindera/diffcompass/releases" },
    { ok: false, url: "https://github.com/Mindera/diffcompass/releases/tag/v2.3.0" },
  ]) {
    const service = createUpdateService({ currentVersion: "2.2.4", fetch: async () => response });
    await expect(service.status()).rejects.toThrow("Could not check for DiffCompass updates.");
  }
});
