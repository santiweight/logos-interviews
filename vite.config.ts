import { defineConfig } from "vite";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import {
  createApiRoutes,
  handleApiNotFound,
  handleApiRoute,
} from "./src/apiRoutes";

const devHost = "127.0.0.1";

export default defineConfig(async ({ command }) => {
  const devPort =
    command === "serve" ? await availablePort(devHost) : undefined;

  return {
    build: {
      rollupOptions: {
        input: {
          main: "index.html",
        },
      },
    },
    plugins: [articleMarkdownHmrPlugin(), anthropicCompletionPlugin()],
    server: {
      host: devHost,
      ...(devPort === undefined ? {} : { port: devPort, strictPort: true }),
    },
  };
});

function articleMarkdownHmrPlugin() {
  return {
    name: "article-markdown-hmr",
    configureServer(server) {
      server.watcher.add(resolve(server.config.root, "public/articles/*.md"));
      server.watcher.on("change", (filePath) => {
        const normalized = filePath.replaceAll("\\", "/");
        if (
          normalized.includes("/public/articles/") &&
          normalized.endsWith(".md")
        ) {
          server.ws.send({ type: "full-reload", path: "*" });
        }
      });
    },
  };
}

function availablePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() =>
          reject(new Error("Could not allocate a dev server port")),
        );
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

function anthropicCompletionPlugin() {
  const apiRoutes = createApiRoutes();

  return {
    name: "anthropic-completion-api",
    configureServer(server) {
      for (const apiRoute of apiRoutes) {
        server.middlewares.use(apiRoute.path, async (req, res) => {
          await handleApiRoute(apiRoute, req, res);
        });
      }

      server.middlewares.use("/api", (req, res) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        handleApiNotFound(res, `/api${url.pathname === "/" ? "" : url.pathname}`);
      });
    },
  };
}
