import { createServer, type IncomingMessage } from "node:http";
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

  it("uses Fly/Tigris bucket environment as S3-compatible storage", async () => {
    const previousEnv = snapshotEnv([
      "CODE_CACHE_S3_BUCKET",
      "CODE_CACHE_S3_REGION",
      "CODE_CACHE_S3_ENDPOINT",
      "CODE_CACHE_S3_FORCE_PATH_STYLE",
      "CODE_CACHE_S3_PREFIX",
      "SHARED_SESSION_S3_BUCKET",
      "SHARED_SESSION_S3_REGION",
      "SHARED_SESSION_S3_ENDPOINT",
      "SHARED_SESSION_S3_FORCE_PATH_STYLE",
      "BUCKET_NAME",
      "AWS_REGION",
      "AWS_ENDPOINT_URL_S3",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
    ]);
    const objects = new Map<string, string>();
    const requests: CapturedRequest[] = [];
    const s3Server = createServer(async (req, res) => {
      const body = await readBody(req);
      const objectPath = new URL(req.url ?? "/", "http://s3.test").pathname;
      requests.push({ method: req.method ?? "", url: objectPath, body });

      if (req.method === "PUT") {
        objects.set(objectPath, body);
        res.statusCode = 200;
        res.end();
        return;
      }

      if (req.method === "GET") {
        const stored = objects.get(objectPath);
        if (stored === undefined) {
          res.statusCode = 404;
          res.end();
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(stored);
        return;
      }

      res.statusCode = 200;
      res.end();
    });

    try {
      const s3BaseUrl = await listen(s3Server);
      clearEnv(previousEnv);
      process.env.BUCKET_NAME = "fly-cache-bucket";
      process.env.AWS_REGION = "us-east-1";
      process.env.AWS_ENDPOINT_URL_S3 = s3BaseUrl;
      process.env.CODE_CACHE_S3_FORCE_PATH_STYLE = "true";
      process.env.AWS_ACCESS_KEY_ID = "test-access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";

      const first = createGlobalCodeCache();
      const second = createGlobalCodeCache();
      await cacheImplementation(first, "completion:fly", "print('fly cache')");

      expect(second.has("completion:fly")).toBe(false);
      await expect(cachedImplementation(second, "completion:fly")).resolves.toBe("print('fly cache')");
      expect(requests.map((request) => request.method)).toEqual(["PUT", "GET"]);
      expect(requests.map((request) => request.url)).toEqual([
        "/fly-cache-bucket/code-cache/completion_fly.json",
        "/fly-cache-bucket/code-cache/completion_fly.json",
      ]);
    } finally {
      await closeServer(s3Server);
      restoreEnv(previousEnv);
    }
  });

  async function useTempCodeCacheDir(): Promise<void> {
    previousCodeCacheDir = process.env.CODE_CACHE_DIR;
    codeCacheDir = await mkdtemp(join(tmpdir(), "logos-code-cache-"));
    process.env.CODE_CACHE_DIR = codeCacheDir;
  }
});

type CapturedRequest = {
  method: string;
  url: string;
  body: string;
};

function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not listen on test server");
      }

      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function snapshotEnv(keys: string[]): Map<string, string | undefined> {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(previous: Map<string, string | undefined>): void {
  for (const [key, value] of previous) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearEnv(previous: Map<string, string | undefined>): void {
  for (const key of previous.keys()) {
    delete process.env[key];
  }
}
