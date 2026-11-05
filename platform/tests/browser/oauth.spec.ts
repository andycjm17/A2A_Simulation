import { test, expect, type Page } from "@playwright/test";
import { createState, addAgent, publicState, accountState, DEFAULT_INSTRUMENTS } from "../../worker/engine";

test.use({ locale: "en-US" });
const market = "oauth-browser-fixture";
const key = "a".repeat(64);
const callback = "https://chatgpt.com/connector_platform/oauth/callback";

async function fixture(page: Page, overrides: Record<string, unknown> = {}) {
  const state = await createState({
    id: market, name: "Browser OAuth practice", practice: true,
    assetMode: "ai", instruments: DEFAULT_INSTRUMENTS,
    rounds: 240, roundMs: 5000, capacity: 50, retailAgents: false,
  }, "oauth-browser-fixture-seed", Date.now());
  const agent = addAgent(state, { id: "oauth-browser-agent", name: "Browser OAuth Agent", keyHash: "fixture-hash", description: "" }, Date.now());
  const account = accountState(state, agent);
  const posts: any[] = [];
  let redirectTo = `${callback}?code=fixture-code&state=fixture-state`;
  await page.route("**/oauth/authorize/info?*", route => route.fulfill({ json: {
    requestId: "fixture-request", csrfToken: "fixture-csrf",
    client: { name: "ChatGPT fixture", redirectUri: callback },
    scopes: ["market:read", "account:read", "trade:write"],
    expiresAt: Date.now() + 600000,
    ...overrides,
  } }));
  await page.route("**/api/markets", route => route.fulfill({ json: { markets: [{ id: market, name: state.config.name, practice: true }] } }));
  await page.route(`**/api/markets/${market}`, route => route.fulfill({ json: publicState(state, Date.now()) }));
  await page.route(`**/api/markets/${market}/account`, route => {
    if (route.request().headers().authorization !== `Bearer ${key}`) return route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED", message: "Invalid Agent credential" } } });
    return route.fulfill({ json: account });
  });
  await page.route("**/oauth/authorize", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    posts.push(body);
    await route.fulfill({ json: { redirectTo: body.approve ? redirectTo : `${callback}?error=access_denied&state=fixture-state` } });
  });
  await page.route(`${callback}**`, route => route.fulfill({ contentType: "text/plain", body: "Isolated OAuth callback fixture" }));
  return { posts, account, setRedirect(value: string) { redirectTo = value; } };
}

async function openConsent(page: Page) {
  await page.goto("/oauth/authorize?client_id=fixture-client&response_type=code&state=fixture-state");
  await expect(page.getByRole("heading", { name: "Connect your Agent.", exact: true })).toBeVisible();
  await expect(page.getByText("ChatGPT fixture", { exact: true })).toBeVisible();
}

async function verify(page: Page) {
  await page.getByLabel("Competition ID", { exact: true }).fill(market);
  await page.getByLabel("Agent API key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Verify Agent", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Browser OAuth Agent");
}

test("OAuth requires verified identity and a separate unchecked approval before redirecting", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const f = await fixture(page);
  await openConsent(page);
  const approve = page.getByRole("button", { name: "Authorize connection" });
  await expect(approve).toBeDisabled();
  await expect(page.getByRole("dialog", { name: "Connect your Agent" })).toHaveCount(0);
  await verify(page);
  await expect(page.getByLabel("Agent API key", { exact: true })).toHaveAttribute("type", "password");
  const check = page.getByRole("checkbox", { name: /I authorize the requested permissions/ });
  await expect(check).not.toBeChecked();
  await expect(approve).toBeDisabled();
  await check.check();
  await expect(approve).toBeEnabled();
  expect(f.posts).toHaveLength(0);
  await approve.click();
  await expect(page).toHaveURL(`${callback}?code=fixture-code&state=fixture-state`);
  expect(f.posts).toEqual([{ requestId: "fixture-request", csrfToken: "fixture-csrf", marketId: market, apiKey: key, approve: true }]);
  expect(page.url()).not.toContain(key);
  expect(errors).toEqual([]);
});

test("changing credentials or competition clears approval and blocks stale verified identity", async ({ page }) => {
  const f = await fixture(page);
  await openConsent(page);
  await verify(page);
  await page.getByRole("checkbox", { name: /I authorize the requested permissions/ }).check();
  await page.getByLabel("Agent API key", { exact: true }).fill("b".repeat(64));
  await expect(page.getByRole("button", { name: "Authorize connection" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /I authorize the requested permissions/ })).toHaveCount(0);
  await page.getByLabel("Agent API key", { exact: true }).fill(key);
  await expect(page.getByRole("checkbox", { name: /I authorize the requested permissions/ })).not.toBeChecked();
  await page.getByRole("checkbox", { name: /I authorize the requested permissions/ }).check();
  await page.getByLabel("Competition ID", { exact: true }).fill("another-competition");
  await expect(page.getByRole("button", { name: "Authorize connection" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /I authorize the requested permissions/ })).toHaveCount(0);
  expect(f.posts).toHaveLength(0);
});

test("cancel works before credential entry and sends no Agent secret", async ({ page }) => {
  const f = await fixture(page);
  await openConsent(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(`${callback}?error=access_denied&state=fixture-state`);
  expect(f.posts).toEqual([{ requestId: "fixture-request", csrfToken: "fixture-csrf", marketId: "", apiKey: "", approve: false }]);
});

test("a failed Agent credential verification never enables consent", async ({ page }) => {
  const f = await fixture(page);
  await openConsent(page);
  await page.getByLabel("Competition ID", { exact: true }).fill(market);
  await page.getByLabel("Agent API key", { exact: true }).fill("incorrect-credential");
  await page.getByRole("button", { name: "Verify Agent", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Authorize connection" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /I authorize/ })).toHaveCount(0);
  expect(f.posts).toHaveLength(0);
});

test("client-controlled markup renders as text and unexpected callback responses are rejected", async ({ page }) => {
  const malicious = '<img src=x onerror="window.__oauthInjected=true">';
  const f = await fixture(page, { client: { name: malicious, redirectUri: callback } });
  f.setRedirect("https://attacker.invalid/collect?code=fixture-code");
  let unexpectedRequest = false;
  await page.route("https://attacker.invalid/**", route => { unexpectedRequest = true; return route.abort(); });
  await page.goto("/oauth/authorize?client_id=fixture-client&response_type=code");
  await expect(page.getByText(malicious, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__oauthInjected)).toBeUndefined();
  await expect(page.locator(".oauth-details img")).toHaveCount(0);
  await verify(page);
  await page.getByRole("checkbox", { name: /I authorize/ }).check();
  await page.getByRole("button", { name: "Authorize connection" }).click();
  await expect(page.getByRole("alert")).toContainText("unexpected return address");
  expect(new URL(page.url()).pathname).toBe("/oauth/authorize");
  expect(unexpectedRequest).toBe(false);
});

test("expired consent requests and unsupported permission requests cannot be approved", async ({ page }) => {
  await fixture(page, { expiresAt: Date.now() - 1000 });
  await openConsent(page);
  await expect(page.getByRole("alert")).toContainText("expired");
  await expect(page.getByRole("button", { name: "Verify Agent", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Authorize connection" })).toBeDisabled();
  await page.unroute("**/oauth/authorize/info?*");
  await page.route("**/oauth/authorize/info?*", route => route.fulfill({ json: {
    requestId: "fixture-request", csrfToken: "fixture-csrf", client: { name: "ChatGPT fixture", redirectUri: callback },
    scopes: ["admin:write"], expiresAt: Date.now() + 600000,
  } }));
  await openConsent(page);
  await verify(page);
  await page.getByRole("checkbox", { name: /I authorize/ }).check();
  await expect(page.getByRole("alert")).toContainText("unsupported permissions");
  await expect(page.getByRole("button", { name: "Authorize connection" })).toBeDisabled();
});

test("saved participant credentials are convenient but never count as approval", async ({ page }) => {
  const f = await fixture(page);
  await page.addInitScript(({ market, key }) => {
    sessionStorage.setItem("agent-exchange:last-market", market);
    sessionStorage.setItem(`agent-key:${market}`, key);
  }, { market, key });
  await openConsent(page);
  await expect(page.getByLabel("Competition ID", { exact: true })).toHaveValue(market);
  await expect(page.getByLabel("Agent API key", { exact: true })).toHaveValue(key);
  await expect(page.getByRole("button", { name: "Authorize connection" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /I authorize/ })).toHaveCount(0);
  expect(f.posts).toHaveLength(0);
});

test("registered Agent credentials expose distinct copyable OAuth and API-key MCP endpoints", async ({ page, context, baseURL }) => {
  await fixture(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(({ market, key }) => sessionStorage.setItem(`agent-key:${market}`, key), { market, key });
  await page.goto(`/?market=${market}&view=agent`);
  await expect(page.getByRole("heading", { name: "Browser OAuth Agent", exact: true })).toBeVisible();
  const appOrigin = new URL(baseURL!).origin;
  await expect(page.getByLabel("ChatGPT MCP endpoint", { exact: true })).toHaveValue(`${appOrigin}/mcp`);
  await expect(page.getByLabel("MCP endpoint", { exact: true })).toHaveValue(`${appOrigin}/mcp/${market}`);
  await page.getByRole("button", { name: "Copy ChatGPT MCP link", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${appOrigin}/mcp`);
  await page.getByRole("button", { name: "Copy MCP link", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${appOrigin}/mcp/${market}`);
  await expect(page.getByRole("button", { name: "View MCP / API documentation", exact: true })).toBeVisible();
});
