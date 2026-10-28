// Read-only remote verification; never prints the organizer credential or response bodies.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const token = (await readFile('private/admin-token.txt', 'utf8')).trim();
assert.ok(token.length >= 32);
const findings = [], scanned = [];
async function scan(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await scan(path);
    else if (entry.isFile()) {
      scanned.push(path);
      if ((await readFile(path)).includes(Buffer.from(token))) findings.push(path);
    }
  }
}
for (const dir of ['reports', 'test-results', 'dist']) await scan(dir);
let auditOutput;
try { auditOutput = (await promisify(execFile)('npm', ['audit', '--json'], { maxBuffer: 10 * 1024 * 1024 })).stdout; }
catch (e) { auditOutput = e.stdout; }
const audit = JSON.parse(auditOutput || '{}');
assert.ok(audit.metadata?.vulnerabilities, 'Dependency audit unavailable; do not report zero');
const checks = [];
if (process.argv.includes('--live')) {
  const base = 'https://a2a.andycui.com';
  for (const [path, headers, expected] of [
    ['/api/health', {}, 200],
    ['/api/admin/dashboard', {}, 401],
    ['/api/admin/dashboard', { Authorization: 'Bearer incorrect-test-key' }, 403],
    ['/api/health', { Origin: 'https://untrusted.example' }, 403],
    ['/api/admin/dashboard', { Authorization: `Bearer ${token}` }, 200],
  ]) {
    const response = await fetch(base + path, { headers });
    const text = await response.text();
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.ok(!text.includes(token));
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    checks.push({ path, expected, passed: true });
  }
}
const report = { at: new Date().toISOString(), scope: 'Raw secret byte scan of generated artifacts; no OCR or claim of external audit', scannedFiles: scanned.length, credentialLeaks: findings.length, leakPaths: findings, vulnerabilities: audit.metadata.vulnerabilities, liveChecks: checks };
await writeFile('reports/security-artifact-check.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
assert.equal(findings.length, 0, 'Credential found in generated artifact');
assert.equal(audit.metadata.vulnerabilities.total, 0, 'Review dependency vulnerabilities before release');
