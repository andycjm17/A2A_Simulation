import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ADMIN_TOKEN: "runtime-test-admin",
          AUDIT_SIGNING_KEY: "0x" + "11".repeat(32),
        },
      },
    }),
  ],
  test: {
    include: [
      "tests/runtime.test.ts",
      "tests/retail.runtime.test.ts",
      "tests/reliability.test.ts",
      "tests/audit.runtime.test.ts",
    ],
    testTimeout: 30000,
    reporters: ["default", "json"],
    outputFile: { json: "reports/runtime.json" },
  },
});
