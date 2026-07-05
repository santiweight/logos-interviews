import { randomUUID } from "node:crypto";
import { rm, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { CodeCache, SnippetHash } from "../domain/codeSheet";
import { createObjectStorageClient, objectStorageConfig } from "./objectStorage";

type CodeCacheRecord = {
  hash: SnippetHash;
  implementation: string;
  writtenAt: string;
};

type CodeCacheStore = {
  read: (hash: SnippetHash) => Promise<string>;
  write: (hash: SnippetHash, implementation: string) => Promise<void>;
  clear: () => Promise<void>;
};

export function createGlobalCodeCache(): CodeCache {
  return new PersistentCodeCache(codeCacheStore());
}

class PersistentCodeCache extends Map<SnippetHash, string> implements CodeCache {
  private readonly hydrations = new Map<SnippetHash, Promise<void>>();

  constructor(private readonly store: CodeCacheStore) {
    super();
  }

  async hydrate(hash: SnippetHash): Promise<void> {
    if (this.has(hash)) {
      return;
    }

    const existing = this.hydrations.get(hash);
    if (existing) {
      await existing;
      return;
    }

    const hydration = this.hydrateOnce(hash);
    this.hydrations.set(hash, hydration);
    try {
      await hydration;
    } finally {
      this.hydrations.delete(hash);
    }
  }

  async persist(hash: SnippetHash, implementation: string): Promise<void> {
    await this.store.write(hash, implementation);
  }

  async clearRemote(): Promise<void> {
    await this.store.clear();
  }

  private async hydrateOnce(hash: SnippetHash): Promise<void> {
    try {
      const implementation = await this.store.read(hash);
      this.set(hash, implementation);
    } catch (error) {
      if (!isMissingCacheEntryError(error)) {
        throw error;
      }
    }
  }
}

function codeCacheStore(): CodeCacheStore {
  const storageConfig = objectStorageConfig();
  if (storageConfig) {
    return s3CodeCacheStore(storageConfig);
  }

  return fileCodeCacheStore();
}

function fileCodeCacheStore(): CodeCacheStore {
  return {
    async read(hash) {
      const raw = await readFile(codeCachePath(hash), "utf8");
      return parseRecord(raw, hash);
    },
    async write(hash, implementation) {
      const dir = codeCacheDir();
      const path = codeCachePath(hash);
      const tempPath = resolve(dir, `${safeCacheKey(hash)}.${randomUUID()}.tmp`);
      await mkdir(dir, { recursive: true });
      await writeFile(tempPath, JSON.stringify(record(hash, implementation)), "utf8");
      await rename(tempPath, path);
    },
    async clear() {
      await rm(codeCacheDir(), { recursive: true, force: true });
    },
  };
}

function s3CodeCacheStore(config: NonNullable<ReturnType<typeof objectStorageConfig>>): CodeCacheStore {
  const client = createObjectStorageClient(config);

  return {
    async read(hash) {
      const response = await client.send(new GetObjectCommand({
        Bucket: config.bucket,
        Key: codeCacheObjectKey(hash),
      }));
      return parseRecord(await bodyToString(response.Body), hash);
    },
    async write(hash, implementation) {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: codeCacheObjectKey(hash),
        Body: JSON.stringify(record(hash, implementation)),
        ContentType: "application/json",
      }));
    },
    async clear() {
      let continuationToken: string | undefined;
      do {
        const listed = await client.send(new ListObjectsV2Command({
          Bucket: config.bucket,
          Prefix: codeCacheObjectPrefix(),
          ContinuationToken: continuationToken,
        }));
        const objects = (listed.Contents ?? [])
          .flatMap((item) => item.Key ? [{ Key: item.Key }] : []);

        if (objects.length > 0) {
          await client.send(new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: { Objects: objects },
          }));
        }

        continuationToken = listed.NextContinuationToken;
      } while (continuationToken !== undefined);
    },
  };
}

function record(hash: SnippetHash, implementation: string): CodeCacheRecord {
  return {
    hash,
    implementation,
    writtenAt: new Date().toISOString(),
  };
}

function parseRecord(raw: string, hash: SnippetHash): string {
  const parsed = JSON.parse(raw) as {
    hash?: unknown;
    implementation?: unknown;
  };

  if (parsed.hash !== hash || typeof parsed.implementation !== "string") {
    throw new Error(`Invalid code cache entry for ${hash}`);
  }

  return parsed.implementation;
}

function codeCachePath(hash: SnippetHash): string {
  return resolve(codeCacheDir(), `${safeCacheKey(hash)}.json`);
}

function codeCacheDir(): string {
  return resolve(
    process.env.CODE_CACHE_DIR ??
      "logs/code-cache",
  );
}

function codeCacheObjectKey(hash: SnippetHash): string {
  return `${codeCacheObjectPrefix()}${safeCacheKey(hash)}.json`;
}

function codeCacheObjectPrefix(): string {
  return "code-cache/";
}

function safeCacheKey(hash: SnippetHash): string {
  return hash.replace(/[^A-Za-z0-9_.-]/g, "_");
}

async function bodyToString(body: unknown): Promise<string> {
  if (
    typeof body === "object" &&
    body !== null &&
    "transformToString" in body &&
    typeof body.transformToString === "function"
  ) {
    return await body.transformToString();
  }

  throw new Error("Code cache response body is unreadable");
}

function isMissingCacheEntryError(error: unknown): boolean {
  if (error instanceof NoSuchKey) {
    return true;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = "code" in error ? (error as { code?: unknown }).code : null;
  const name = "name" in error ? (error as { name?: unknown }).name : null;
  return code === "ENOENT" || name === "NoSuchKey" || name === "NotFound";
}
