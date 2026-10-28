import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["scripts/horizon-experiment.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "reports/horizon-experiment.mjs",
});
const result = spawnSync(process.execPath, ["reports/horizon-experiment.mjs"], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
