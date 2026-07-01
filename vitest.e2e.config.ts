import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/typescriptBaseline.browser.e2e.ts"],
    testTimeout: 120_000,
  },
});
