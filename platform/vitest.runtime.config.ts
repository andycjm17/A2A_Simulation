import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { ADMIN_TOKEN: "runtime-test-admin" } },
    }),
  ],
  test: {
    include: ["tests/runtime.test.ts", "tests/reliability.test.ts"],
    testTimeout: 30000,
    reporters: ["default", "json"],
    outputFile: { json: "reports/runtime.json" },
  },
});
