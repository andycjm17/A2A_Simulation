import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": "http://127.0.0.1:8788",
      "/mcp": "http://127.0.0.1:8788",
      "/.well-known": "http://127.0.0.1:8788",
      "/oauth": {
        target: "http://127.0.0.1:8788",
        bypass(request) {
          if (request.method === "GET" && new URL(request.url || "/", "http://localhost").pathname === "/oauth/authorize") return "/index.html";
        },
      },
    },
  },
  build: { sourcemap: false },
});
