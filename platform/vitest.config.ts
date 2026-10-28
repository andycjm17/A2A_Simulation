import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/engine.test.ts"],
    reporters: ["default", "json"],
    outputFile: { json: "reports/unit.json" },
  },
});
