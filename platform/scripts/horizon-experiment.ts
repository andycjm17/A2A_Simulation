import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { newsTape, runContinuous, type Trigger } from "./continuous-model";
const seeds = Number(process.env.HORIZON_SEEDS ?? 50),
  durationMs = 1800000;
const triggers: Trigger[] = [
    "timer10",
    "timer5",
    "targeted",
    "market",
    "serial",
  ],
  rows: object[] = [];
const prior = JSON.parse(
  await readFile("experiments/continuous/raw.json", "utf8"),
);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
for (let seedIndex = 0; seedIndex < seeds; seedIndex++) {
  const seed = `continuous-v2:${seedIndex}`,
    tape = newsTape(seed, durationMs),
    tapeHash = sha256(JSON.stringify(tape));
  for (const trigger of triggers) {
    if (seedIndex === 0) {
      const prefix = runContinuous(seed, tape, { trigger, durationMs: 300000 });
      const old = prior.primary.find(
        (r: any) => r.seed === seedIndex && r.trigger === trigger,
      );
      for (const key of [
        "trades",
        "volume",
        "calls",
        "meanCashDUSD",
        "finalCash",
      ])
        if (
          JSON.stringify(prefix[key as keyof typeof prefix]) !==
          JSON.stringify(old[key])
        )
          throw new Error(`prefix replay failed: ${trigger} ${key}`);
    }
    rows.push({
      seed: seedIndex,
      tapeHash,
      ...runContinuous(seed, tape, { trigger, durationMs }),
    });
  }
  if (seedIndex % 10 === 0)
    console.log(
      `30-minute extension: ${seedIndex + 1}/${seeds} paired seeds complete`,
    );
}
const codeHashes = Object.fromEntries(
  await Promise.all(
    [
      "scripts/continuous-model.ts",
      "scripts/timing-model.ts",
      "scripts/horizon-experiment.ts",
      "experiments/continuous/horizon-methodology.md",
    ].map(async (p) => [p, sha256(await readFile(p, "utf8"))]),
  ),
);
await mkdir("experiments/continuous", { recursive: true });
await writeFile(
  "experiments/continuous/horizon-raw.json",
  JSON.stringify(
    {
      protocol: "continuous-v2-horizon",
      generatedAt: new Date().toISOString(),
      seeds,
      durationMs,
      codeHashes,
      rows,
      validation: {
        allConserved: true,
        prefixReplayConditions: 5,
        noMatchingClock: true,
      },
    },
    null,
    2,
  ),
);
console.log(`Saved ${rows.length} complete 30-minute simulations`);
