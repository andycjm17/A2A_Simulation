import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["scripts/timing-experiment.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "reports/timing-experiment.mjs",
});
const result = spawnSync(
  process.execPath,
  ["reports/timing-experiment.mjs", ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
