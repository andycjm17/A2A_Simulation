import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/continuous-model.test.ts"], reporters: ["default"] },
});
