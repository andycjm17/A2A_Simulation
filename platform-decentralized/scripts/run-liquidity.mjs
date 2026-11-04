import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["scripts/liquidity-experiment.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "reports/liquidity-experiment.mjs",
});
const result = spawnSync(
  process.execPath,
  ["reports/liquidity-experiment.mjs"],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
