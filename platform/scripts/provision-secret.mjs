// Generate a deployment credential without placing it in shell history, logs or source.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { spawnSync } from "node:child_process";
await mkdir("private", { recursive: true, mode: 0o700 });
await chmod("private", 0o700);
const path = "private/admin-token.txt";
let token;
try {
  token = (await readFile(path, "utf8")).trim();
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  token = randomBytes(32).toString("hex");
  await writeFile(path, token + "\n", { flag: "wx", mode: 0o600 });
}
if (!/^[a-f0-9]{64}$/.test(token))
  throw new Error("Unexpected credential format; will not overwrite.");
await chmod(path, 0o600);
const result = spawnSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "secret", "put", "ADMIN_TOKEN"],
  { input: token + "\n", encoding: "utf8" },
);
// Wrangler prints deployment metadata only; redact defensively if that ever changes.
process.stdout.write((result.stdout || "").replaceAll(token, "[redacted]"));
process.stderr.write((result.stderr || "").replaceAll(token, "[redacted]"));
if (result.status !== 0) process.exit(result.status || 1);
console.log(
  "Organizer credential is stored locally in private/admin-token.txt (0600), excluded from version control.",
);
