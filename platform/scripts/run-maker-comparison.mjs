import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const engine = resolve("worker/engine.ts");
await build({
  entryPoints: ["scripts/maker-comparison.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "reports/maker-comparison.mjs",
  plugins: [{
    name: "hard-stop-comparison-only",
    setup(builder) {
      builder.onResolve({ filter: /^maker-hard-stop$/ }, () => ({
        path: engine, namespace: "hard-stop",
      }));
      builder.onLoad({ filter: /.*/, namespace: "hard-stop" }, async () => {
        const source = await readFile(engine, "utf8");
        const pattern = /export function makerBuyScale\(equity: number, initialEquity: number\) \{[\s\S]*?\n\}/g;
        if ([...source.matchAll(pattern)].length !== 1)
          throw new Error("Expected one makerBuyScale definition for the hard-stop control");
        return {
          contents: source.replace(pattern,
            "export function makerBuyScale(equity: number, initialEquity: number) {\n" +
            "  return equity <= Math.ceil(initialEquity * 0.95) ? 0 : 1;\n}"),
          loader: "ts",
          resolveDir: resolve("worker"),
        };
      });
    },
  }],
});
if (process.argv.includes("--build-only")) process.exit(0);
const result = spawnSync(process.execPath, [
  "reports/maker-comparison.mjs", ...process.argv.slice(2),
], { stdio: "inherit", windowsHide: true });
process.exit(result.status ?? 1);
