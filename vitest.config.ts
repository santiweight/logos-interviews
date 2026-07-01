import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/typescriptBaseline.test.ts",
      "src/typescriptMigrationBacklog.test.ts",
      "src/typescriptApi.test.ts",
    ],
    exclude: ["src/**/*.e2e.ts"],
  },
});
