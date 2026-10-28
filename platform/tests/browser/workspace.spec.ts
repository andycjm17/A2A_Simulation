import { test, expect } from "@playwright/test";
const backend = process.env.TEST_API_URL || "http://127.0.0.1:8787";
const admin = process.env.ADMIN_TOKEN || "local-test-admin-not-for-production";
test("complete participant workflow, safety and responsive UI", async ({
  page,
  request,
}, info) => {
  const id = `browser-${info.project.name}-${Date.now()}`;
  const create = await request.post(`${backend}/api/admin/markets`, {
    headers: { Authorization: `Bearer ${admin}` },
    data: { id, name: "Browser acceptance", practice: true },
  });
  expect(create.status()).toBe(201);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/?market=${id}`);
  await expect(page.getByRole("heading", { name: "交易市场", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Leaderboard" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "配置我的 Agent", exact: true })
    .click();
  await page
    .getByLabel("Agent 名称", { exact: true })
    .fill("Browser Agent <test>");
  await page
    .getByLabel("能力与策略说明")
    .fill(
      "<script>window.__injected=true</script> Value strategy, externally hosted.",
    );
  await page.getByRole("button", { name: "创建并获取连接凭证" }).click();
  await expect(
    page.getByRole("heading", { name: "Browser Agent <test>" }),
  ).toBeVisible();
  const key = await page.getByLabel("专属 API Key").inputValue();
  expect(key).toHaveLength(64);
  await expect(page.getByLabel("专属 API Key")).toHaveAttribute(
    "type",
    "password",
  );
  expect(await page.evaluate(() => (window as any).__injected)).toBeUndefined();
  await expect(
    page.getByRole("button", { name: /买入|卖出|提交订单/ }),
  ).toHaveCount(0);
  const second = await request.post(`${backend}/api/markets/${id}/join`, {
    data: { name: "Counterparty" },
  });
  expect(second.status()).toBe(201);
  const b = await second.json();
  expect(
    (
      await request.post(`${backend}/api/admin/markets/${id}/start`, {
        headers: { Authorization: `Bearer ${admin}` },
        data: {},
      })
    ).status(),
  ).toBe(200);
  const d = {
    round: 1,
    symbol: "OPENAI",
    side: "BUY",
    price: 11000,
    quantity: 5,
    requestId: "browser-round-one",
  };
  expect(
    (
      await request.post(`${backend}/api/markets/${id}/decision`, {
        headers: { Authorization: `Bearer ${key}` },
        data: d,
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post(`${backend}/api/markets/${id}/decision`, {
        headers: { Authorization: `Bearer ${b.apiKey}` },
        data: { ...d, side: "SELL", price: 9000 },
      })
    ).status(),
  ).toBe(200);
  await expect(
    page.getByRole("cell", { name: "BUY", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("等待撮合", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "断开连接", exact: true }).click();
  await page.getByLabel("API Key", { exact: true }).fill("invalid-key");
  await page.getByRole("button", { name: "验证并连接" }).click();
  await expect(page.getByRole("alert")).toContainText("无效");
  await page.getByLabel("API Key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "验证并连接" }).click();
  await expect(
    page.getByRole("heading", { name: "Browser Agent <test>" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "连接与接口", exact: true }).click();
  await expect(page.getByLabel("MCP Endpoint")).toHaveValue(
    new RegExp(`/mcp/${id}$`),
  );
  await expect(
    page.getByText("submit_decision", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "比赛规则", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "30 分钟，两种模拟资产" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "市场总览", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Leaderboard" }),
  ).toBeVisible();
  await page.screenshot({
    path: `reports/ui-${info.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await request.post(`${backend}/api/admin/markets/${id}/pause`, {
    headers: { Authorization: `Bearer ${admin}` },
    data: {},
  });
});
test("admin rejects invalid credentials and keeps keys out of storage", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "赛事管理", exact: true }).click();
  await page.getByLabel("组织者管理凭证").fill("wrong-token");
  await page.getByLabel("比赛名称", { exact: true }).fill("Unauthorized");
  await page.getByLabel("比赛编号").fill(`denied-${Date.now()}`);
  await page.getByRole("button", { name: "创建比赛", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("管理凭证无效");
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("wrong-token");
});

test('late market discovery does not erase organizer input',async({page})=>{
 let release:()=>void=()=>{};const gate=new Promise<void>(r=>{release=r;});
 await page.route('**/api/markets',async route=>{await gate;await route.continue();});
 await page.goto('/');await page.getByRole('button',{name:'赛事管理',exact:true}).click();
 await page.getByLabel('组织者管理凭证').fill('keep-this-local-input');
 await page.getByLabel('比赛名称',{exact:true}).fill('Do not erase this form');
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/markets');release();await response;
 await expect(page.getByLabel('组织者管理凭证')).toHaveValue('keep-this-local-input');
 await expect(page.getByLabel('比赛名称',{exact:true})).toHaveValue('Do not erase this form');
});
