// Explicit wrapper: provides the organizer secret to a bounded test without printing it.
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const [file, ...args] = process.argv.slice(2);
if (
  ![
    "scripts/agent-runner.mjs",
    "scripts/load-test.mjs",
    "scripts/production-smoke.mjs",
    "scripts/verify-release.mjs",
    "node_modules/@playwright/test/cli.js",
  ].includes(file)
)
  throw new Error("Unsupported deployment task");
const token = (await readFile("private/admin-token.txt", "utf8")).trim();
const child = spawn(process.execPath, [file, ...args], {
  stdio: ["inherit", "pipe", "pipe"],
  env: {
    ...process.env,
    ADMIN_TOKEN: token,
    BASE_URL: "https://a2a.andycui.com",
    TEST_API_URL: "https://a2a.andycui.com",
    UI_BASE_URL: "https://a2a.andycui.com",
  },
});
const redact=line=>line.replaceAll(token,'[redacted]').replace(/Bearer [a-f0-9]{64}/g,'Bearer [redacted]');
createInterface({input:child.stdout}).on('line',line=>console.log(redact(line)));
createInterface({input:child.stderr}).on('line',line=>console.error(redact(line)));
child.on("exit", (code) => process.exit(code ?? 1));
