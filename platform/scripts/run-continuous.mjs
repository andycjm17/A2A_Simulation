import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["scripts/continuous-experiment.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "reports/continuous-experiment.mjs",
});
const result = spawnSync(
  process.execPath,
  ["reports/continuous-experiment.mjs", ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
