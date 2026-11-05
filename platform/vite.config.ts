import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/mcp": "http://127.0.0.1:8787",
      "/.well-known": "http://127.0.0.1:8787",
      "/oauth": {
        target: "http://127.0.0.1:8787",
        bypass(request) {
          if (request.method === "GET" && new URL(request.url || "/", "http://localhost").pathname === "/oauth/authorize") return "/index.html";
        },
      },
    },
  },
  build: { sourcemap: false },
});
