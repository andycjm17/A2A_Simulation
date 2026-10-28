import { test, expect } from "@playwright/test";
test.use({ trace: "off", screenshot: "off" });
const backend = process.env.TEST_API_URL || "http://127.0.0.1:8787";
const admin = process.env.ADMIN_TOKEN || "local-test-admin-not-for-production";

test("security: late discovery does not invalidate an authenticated create operation", async ({
  page,
  request,
}, info) => {
  const previous = `sec-old-${info.project.name}-${Date.now()}`,
    id = `sec-new-${info.project.name}-${Date.now()}`;
  expect(
    (
      await request.post(`${backend}/api/admin/markets`, {
        headers: { Authorization: `Bearer ${admin}` },
        data: { id: previous, name: "Earlier competition", practice: true },
      })
    ).status(),
  ).toBe(201);
  let discover!: () => void, create!: () => void;
  const discoveryGate = new Promise<void>((r) => (discover = r)),
    createGate = new Promise<void>((r) => (create = r));
  let first = true;
  await page.route("**/api/markets", async (r) => {
    if (!first) return r.continue();
    first = false;
    await discoveryGate;
    await r.fulfill({
      json: {
        markets: [
          { id: previous, name: "Earlier competition", practice: true },
        ],
      },
    });
  });
  await page.route("**/api/admin/markets", async (r) => {
    await createGate;
    await r.continue();
  });
  await page.goto("/?view=admin");
  await page.getByLabel("组织者管理凭证").fill(admin);
  await page
    .getByLabel("比赛名称", { exact: true })
    .fill("Late discovery creation");
  await page.getByLabel("比赛编号").fill(id);
  await page.getByLabel("练习赛（开放注册；不用于发奖）").check();
  const started = page.waitForRequest((r) =>
    r.url().endsWith("/api/admin/markets"),
  );
  await page.getByRole("button", { name: "创建比赛", exact: true }).click();
  await started;
  discover();
  await expect(page.getByLabel("当前比赛")).toHaveValue(previous);
  create();
  await expect(page.getByLabel("当前比赛")).toHaveValue(id);
});

test("security: settled collusion evidence appears in organizer review", async ({
  page,
  request,
}, info) => {
  const id = `sec-review-${info.project.name}-${Date.now()}`;
  expect(
    (
      await request.post(`${backend}/api/admin/markets`, {
        headers: { Authorization: `Bearer ${admin}` },
        data: {
          id,
          name: "Isolated integrity review",
          practice: true,
          rounds: 1,
          roundMs: 10000,
        },
      })
    ).status(),
  ).toBe(201);
  const participants = [];
  for (const name of ["Review buyer", "Review seller"])
    participants.push(
      await (
        await request.post(`${backend}/api/markets/${id}/join`, {
          data: { name },
        })
      ).json(),
    );
  expect(
    (
      await request.post(`${backend}/api/admin/markets/${id}/start`, {
        headers: { Authorization: `Bearer ${admin}` },
        data: {},
      })
    ).status(),
  ).toBe(200);
  for (const [i, a] of participants.entries())
    expect(
      (
        await request.post(`${backend}/api/markets/${id}/decision`, {
          headers: { Authorization: `Bearer ${a.apiKey}` },
          data: {
            round: 1,
            side: i ? "SELL" : "BUY",
            price: 100,
            quantity: 10,
            requestId: "review-test-round-one",
          },
        })
      ).status(),
    ).toBe(200);
  await expect
    .poll(
      async () =>
        (await (await request.get(`${backend}/api/markets/${id}`)).json())
          .status,
      { timeout: 15000, intervals: [1000] },
    )
    .toBe("finished");
  await page.goto(`/?market=${id}&view=admin`);
  await page.getByLabel("组织者管理凭证").fill(admin);
  await page.getByRole("button", { name: "进入管理后台" }).click();
  await expect(
    page.getByRole("heading", { name: "交易公平性复核" }),
  ).toBeVisible();
  await expect(page.getByText("需人工复核", { exact: true })).toBeVisible();
  await expect(
    page
      .getByText("Review buyer ↔ Review seller", { exact: true })
      .or(page.getByText("Review seller ↔ Review buyer", { exact: true })),
  ).toBeVisible();
  await expect(page.getByText("校验通过", { exact: true })).toBeVisible();
});

for (const operation of ["invites", "rotate"]) {
  test(`security: ${operation} response cannot restore secrets after credential change`, async ({
    page,
    request,
  }, info) => {
    const id = `sec-${operation}-${info.project.name}-${Date.now()}`;
    expect(
      (
        await request.post(`${backend}/api/admin/markets`, {
          headers: { Authorization: `Bearer ${admin}` },
          data: { id, name: "Security isolated fixture", practice: true },
        })
      ).status(),
    ).toBe(201);
    const joined = await request.post(`${backend}/api/markets/${id}/join`, {
      data: { name: "Security participant" },
    });
    expect(joined.status()).toBe(201);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const marker = "TEST-ONLY-STALE-SECRET";
    await page.route(`**/api/admin/markets/${id}/${operation}`, async (r) => {
      await gate;
      await r.fulfill({
        json:
          operation === "invites" ? { codes: [marker] } : { apiKey: marker },
      });
    });
    await page.goto(`/?market=${id}&view=admin`);
    await page.getByLabel("组织者管理凭证").fill(admin);
    const started = page.waitForRequest((r) =>
      r.url().endsWith(`/${operation}`),
    );
    if (operation === "rotate") {
      await page.getByText("重置 Agent 凭证", { exact: true }).click();
      await expect(
        page.getByLabel("选择 Agent", { exact: true }).locator("option"),
      ).toHaveCount(2);
      await page
        .getByLabel("选择 Agent", { exact: true })
        .selectOption({ label: "Security participant" });
      page.on("dialog", (d) => d.accept());
      await page.getByRole("button", { name: "重置凭证", exact: true }).click();
    } else await page.getByRole("button", { name: "生成单次邀请码" }).click();
    await started;
    await page.getByLabel("组织者管理凭证").fill("");
    // Re-entering the same credential must not resurrect the previous session.
    await page.getByLabel("组织者管理凭证").fill(admin);
    const finished = page.waitForResponse((r) =>
      r.url().endsWith(`/${operation}`),
    );
    release();
    await finished;
    await page.waitForTimeout(300);
    await expect(
      page.getByRole("button", {
        name: operation === "rotate" ? "重置凭证" : "生成单次邀请码",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(page.locator("body")).not.toContainText(marker);
  });
}

test("security: late participant restore never sends a credential to another match", async ({
  page,
  request,
}, info) => {
  const prefix = `sec-scope-${info.project.name}-${Date.now()}`;
  const ids = [`${prefix}-a`, `${prefix}-b`];
  for (const id of ids)
    expect(
      (
        await request.post(`${backend}/api/admin/markets`, {
          headers: { Authorization: `Bearer ${admin}` },
          data: { id, name: `Scope ${id.slice(-1)}`, practice: true },
        })
      ).status(),
    ).toBe(201);
  const a = await (
    await request.post(`${backend}/api/markets/${ids[0]}/join`, {
      data: { name: "Scope owner" },
    })
  ).json();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(`**/api/markets/${ids[0]}/account`, async (r) => {
    await gate;
    await r.fulfill({ json: a.account });
  });
  const wrongScope: string[] = [];
  page.on("request", (r) => {
    if (
      r.url().includes(`/api/markets/${ids[1]}/`) &&
      r.headers().authorization === `Bearer ${a.apiKey}`
    )
      wrongScope.push(r.url());
  });
  await page.goto(`/?market=${ids[0]}`);
  await page.getByRole("button", { name: "我的 Agent", exact: true }).click();
  await page.getByLabel("API Key", { exact: true }).fill(a.apiKey);
  const started = page.waitForRequest((r) =>
    r.url().endsWith(`/${ids[0]}/account`),
  );
  await page.getByRole("button", { name: "验证并连接" }).click();
  await started;
  await page.getByLabel("当前比赛").selectOption(ids[1]);
  const finished = page.waitForResponse((r) =>
    r.url().endsWith(`/${ids[0]}/account`),
  );
  release();
  await finished;
  await expect(page.getByRole("button", { name: "验证并连接" })).toBeEnabled();
  // Observe one normal account-poll interval after the held response is processed.
  await page.waitForTimeout(4500);
  expect(wrongScope).toEqual([]);
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
});

test("security: a saved participant key stays scoped during normal room switching", async ({
  page,
  request,
}, info) => {
  const ids = [
    `sec-saved-${info.project.name}-${Date.now()}-a`,
    `sec-saved-${info.project.name}-${Date.now()}-b`,
  ];
  for (const id of ids)
    expect(
      (
        await request.post(`${backend}/api/admin/markets`, {
          headers: { Authorization: `Bearer ${admin}` },
          data: { id, name: "Saved key scope test", practice: true },
        })
      ).status(),
    ).toBe(201);
  const a = await (
    await request.post(`${backend}/api/markets/${ids[0]}/join`, {
      data: { name: "Saved scope owner" },
    })
  ).json();
  await page.addInitScript(
    ({ id, key }) => sessionStorage.setItem(`agent-key:${id}`, key),
    { id: ids[0], key: a.apiKey },
  );
  const leaks: string[] = [];
  page.on("request", (r) => {
    if (
      r.url().includes(`/api/markets/${ids[1]}/`) &&
      r.headers().authorization
    )
      leaks.push(r.url());
  });
  await page.goto(`/?market=${ids[0]}`);
  await page.getByRole("button", { name: "我的 Agent", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Saved scope owner" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "显示密钥", exact: true }).click();
  await page.getByLabel("当前比赛").selectOption(ids[1]);
  await expect(
    page.getByRole("heading", { name: "创建参赛 Agent" }),
  ).toBeVisible();
  await page.getByLabel("当前比赛").selectOption(ids[0]);
  await expect(page.getByLabel("专属 API Key")).toHaveAttribute(
    "type",
    "password",
  );
  expect(leaks).toEqual([]);
});
