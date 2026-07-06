import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.e2e.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
