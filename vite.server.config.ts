import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist-server",
    emptyOutDir: true,
    ssr: "src/server.ts",
    target: "node22",
    rollupOptions: {
      output: {
        entryFileNames: "server.mjs",
      },
    },
  },
});
