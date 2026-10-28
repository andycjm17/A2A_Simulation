import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/timing-model.test.ts"], reporters: ["default"] },
});
