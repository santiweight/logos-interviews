import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGlobalCodeCache } from "./codeCache";
import { cachedImplementation, cacheImplementation } from "./codeSheet";

describe("global code cache", () => {
  let previousCodeCacheDir: string | undefined;
  let codeCacheDir: string | null = null;

  afterEach(async () => {
    if (codeCacheDir) {
      await rm(codeCacheDir, { recursive: true, force: true });
      codeCacheDir = null;
    }

    if (previousCodeCacheDir === undefined) {
      delete process.env.CODE_CACHE_DIR;
    } else {
      process.env.CODE_CACHE_DIR = previousCodeCacheDir;
    }
  });

  it("hydrates persisted completions across independent cache instances", async () => {
    await useTempCodeCacheDir();
    const first = createGlobalCodeCache();
    const second = createGlobalCodeCache();

    await cacheImplementation(first, "completion:test", "def test():\n  return 1");

    expect(second.has("completion:test")).toBe(false);
    await expect(cachedImplementation(second, "completion:test")).resolves.toBe("def test():\n  return 1");
    expect(second.get("completion:test")).toBe("def test():\n  return 1");
  });

  it("supports concurrent hydration from the same persisted cache entry", async () => {
    await useTempCodeCacheDir();
    const writer = createGlobalCodeCache();
    await cacheImplementation(writer, "completion:concurrent", "print(42)");

    const readers = Array.from({ length: 12 }, () => createGlobalCodeCache());
    await expect(Promise.all(
      readers.map((cache) => cachedImplementation(cache, "completion:concurrent")),
    )).resolves.toEqual(Array.from({ length: 12 }, () => "print(42)"));
  });

  it("clears both memory and the persistent backing store", async () => {
    await useTempCodeCacheDir();
    const first = createGlobalCodeCache();
    await cacheImplementation(first, "completion:clear", "print('clear')");
    first.clear();
    await first.clearRemote?.();

    const second = createGlobalCodeCache();
    await expect(cachedImplementation(second, "completion:clear")).resolves.toBeUndefined();
  });

  async function useTempCodeCacheDir(): Promise<void> {
    previousCodeCacheDir = process.env.CODE_CACHE_DIR;
    codeCacheDir = await mkdtemp(join(tmpdir(), "logos-code-cache-"));
    process.env.CODE_CACHE_DIR = codeCacheDir;
  }
});
