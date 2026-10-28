import { test, expect } from "@playwright/test";
test.use({ trace: "off", screenshot: "off" });
const backend = process.env.TEST_API_URL || "http://127.0.0.1:8787";
const admin = process.env.ADMIN_TOKEN || "local-test-admin-not-for-production";
test("organizer dashboard manages a real match, protects credentials and locks cleanly", async ({
  page,
  request,
}, info) => {
  const id = `admin-ui-${info.project.name}-${Date.now()}`,
    name = `Admin dashboard ${info.project.name}`;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?view=admin");
  await expect(
    page.getByRole("heading", { name: "管理控制台", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "赛事总览", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("组织者管理凭证").fill(admin);
  await page.getByLabel("比赛名称", { exact: true }).fill(name);
  await page.getByLabel("比赛编号").fill(id);
  await page.getByRole("button", { name: "创建比赛", exact: true }).click();
  await expect(page.getByLabel("当前比赛")).toHaveValue(id);
  await page.getByRole("button", { name: "进入管理后台" }).click();
  await expect(
    page.getByRole("heading", { name: "赛事总览", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("管理员已验证", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "交易公平性复核" }),
  ).toBeVisible();
  await expect(page.getByText("未触发规则", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain(admin);
  expect(page.url()).not.toContain(admin);
  await page.getByLabel("生成邀请码数量").fill("2");
  await page.getByRole("button", { name: "生成单次邀请码" }).click();
  const inviteText = await page
    .locator("pre")
    .filter({ hasText: /^[a-f0-9]{64}\n[a-f0-9]{64}$/ })
    .innerText();
  const keys: string[] = [];
  for (const [i, invite] of inviteText.split("\n").entries()) {
    const r = await request.post(`${backend}/api/markets/${id}/join`, {
      data: {
        name: `Organizer test agent ${i}`,
        description: "External test client",
        invite,
      },
    });
    expect(r.status()).toBe(201);
    keys.push((await r.json()).apiKey);
  }
  await page.getByRole("button", { name: "刷新数据", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: /^Organizer test agent 0/ }),
  ).toBeVisible();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "开始比赛", exact: true }).click();
  await expect(page.getByRole("button", { name: "暂停计时" })).toBeEnabled();
  const order = await request.post(`${backend}/api/markets/${id}/decision`, {
    headers: { Authorization: `Bearer ${keys[0]}` },
    data: {
      round: 1,
      side: "PASS",
      price: 0,
      quantity: 0,
      requestId: "admin-ui-round-1",
    },
  });
  expect(order.status()).toBe(200);
  await page.getByRole("button", { name: "刷新数据", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "已提交", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "暂停计时" }).click();
  await expect(page.getByRole("button", { name: "恢复比赛" })).toBeEnabled();
  await page.getByRole("button", { name: "恢复比赛" }).click();
  await expect(page.getByRole("button", { name: "暂停计时" })).toBeEnabled();
  await page.getByRole("button", { name: "暂停计时" }).click();
  await expect(page.getByRole("button", { name: "恢复比赛" })).toBeEnabled();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出审计记录" }).click();
  expect((await download).suggestedFilename()).toBe(`${id}-audit.json`);
  await page.getByText("重置 Agent 凭证", { exact: true }).click();
  await page
    .getByLabel("选择 Agent", { exact: true })
    .selectOption({ label: "Organizer test agent 0" });
  await page.getByRole("button", { name: "重置凭证", exact: true }).click();
  await expect(page.locator(".keybox")).toBeVisible();
  const rotated = (await page.locator(".keybox").innerText()).match(
    /[a-f0-9]{64}/,
  )![0];
  expect(
    (
      await request.get(`${backend}/api/markets/${id}/account`, {
        headers: { Authorization: `Bearer ${keys[0]}` },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.get(`${backend}/api/markets/${id}/account`, {
        headers: { Authorization: `Bearer ${rotated}` },
      })
    ).status(),
  ).toBe(200);
  await page.getByLabel("组织者管理凭证").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `reports/admin-dashboard-${info.project.name}.png`,
    fullPage: true,
    style:
      'input[type="password"], pre, .keybox { visibility: hidden !important; }',
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "锁定后台" }).click();
  await expect(page.getByLabel("组织者管理凭证")).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "赛事总览", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".keybox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "进入管理后台" }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});
test("editing credentials discards an in-flight dashboard response", async ({
  page,
}) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/admin/dashboard?offset=0", async (r) => {
    await gate;
    await r.fulfill({
      json: {
        markets: [],
        failures: [],
        offset: 0,
        nextOffset: null,
        catalogCount: 0,
        serverTime: Date.now(),
      },
    });
  });
  await page.goto("/?view=admin");
  await page.getByLabel("组织者管理凭证").fill("test-credential-not-real");
  const started = page.waitForRequest((r) =>
    r.url().includes("/api/admin/dashboard"),
  );
  await page.getByRole("button", { name: "进入管理后台" }).click();
  await started;
  await page.getByLabel("组织者管理凭证").fill("");
  release();
  await expect(
    page.getByRole("button", { name: "进入管理后台" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "赛事总览", exact: true }),
  ).toHaveCount(0);
});
