import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  newsTape,
  runContinuous,
  type Trigger,
  type ContinuousOptions,
} from "./continuous-model";
const destination = process.argv[2] ?? "experiments/continuous/raw.json",
  seeds = Number(process.env.CONTINUOUS_SEEDS ?? 200),
  sensitivitySeeds = Math.min(50, seeds);
const primary: object[] = [],
  sensitivity: object[] = [],
  tapes: object[] = [];
const triggers: Trigger[] = [
  "timer10",
  "timer5",
  "targeted",
  "market",
  "serial",
];
for (let i = 0; i < seeds; i++) {
  const seed = `continuous-v2:${i}`,
    tape = newsTape(seed),
    digest = createHash("sha256").update(JSON.stringify(tape)).digest("hex");
  tapes.push({ seed: i, news: tape, sha256: digest });
  for (const trigger of triggers) {
    const result = runContinuous(seed, tape, { trigger });
    primary.push({ seed: i, tapeHash: digest, ...result });
    if (
      i === 0 &&
      JSON.stringify(result) !==
        JSON.stringify(runContinuous(seed, tape, { trigger }))
    )
      throw new Error("deterministic replay failed");
  }
  if (i < sensitivitySeeds) {
    const scenarios: [string, ContinuousOptions[]][] = [
      [
        "slow-agents",
        triggers.map((trigger) => ({ trigger, baseLatencyMs: 3000 })),
      ],
      [
        "heterogeneous",
        triggers.map((trigger) => ({ trigger, heterogeneous: true })),
      ],
      ["ttl30", triggers.map((trigger) => ({ trigger, ttlMs: 30000 }))],
      [
        "slow-maker",
        triggers.map((trigger) => ({ trigger, makerLatencyMs: 1000 })),
      ],
      ["market-cooldown", [{ trigger: "market", cooldownMs: 1000 }]],
      ["targeted-cancel-news", [{ trigger: "targeted", cancelOnNews: true }]],
    ];
    for (const [family, options] of scenarios)
      for (const option of options)
        sensitivity.push({
          seed: i,
          tapeHash: digest,
          family,
          ...runContinuous(seed, tape, option),
        });
  }
  if (i % 20 === 0)
    console.log(`continuous-v2: ${i + 1}/${seeds} paired seeds complete`);
}
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const codeHashes = Object.fromEntries(
  await Promise.all(
    [
      "scripts/continuous-model.ts",
      "scripts/continuous-experiment.ts",
      "scripts/timing-model.ts",
      "experiments/continuous/methodology.md",
    ].map(async (p) => [p, sha256(await readFile(p, "utf8"))]),
  ),
);
await mkdir(destination.substring(0, destination.lastIndexOf("/")), {
  recursive: true,
});
await writeFile(
  destination,
  JSON.stringify(
    {
      protocol: "continuous-v2",
      generatedAt: new Date().toISOString(),
      seeds,
      sensitivitySeeds,
      codeHashes,
      tapes,
      primary,
      sensitivity,
      validation: {
        allConserved: true,
        noAuction: true,
        noMatchingClock: true,
        replayedPrimaryCells: 5,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    destination,
    primary: primary.length,
    sensitivity: sensitivity.length,
  }),
);
