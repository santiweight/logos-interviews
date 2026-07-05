import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist-server",
    emptyOutDir: true,
    ssr: "src/server/index.ts",
    target: "node22",
    rollupOptions: {
      output: {
        entryFileNames: "server.mjs",
      },
    },
  },
});
