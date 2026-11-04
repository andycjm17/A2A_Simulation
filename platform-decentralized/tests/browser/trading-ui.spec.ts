import { test, expect } from "@playwright/test";
import {
  createState,
  addAgent,
  start,
  submit,
  clearRound,
  pause,
  publicState,
} from "../../worker/engine";

async function fixture(empty = false) {
  const s = await createState(
    {
      id: "chart-fixture",
      name: "OpenAI × Anthropic 模拟交易",
      assetMode: "ai",
      rounds: 30,
      roundMs: 60000,
      capacity: 50,
      practice: true,
    },
    "browser-chart-seed",
    Date.now() - 1200000,
  );
  for (let i = 0; i < 12; i++)
    addAgent(
      s,
      {
        id: `a${i}`,
        name: `Agent ${i + 1}`,
        keyHash: `key${i}`,
        description: "",
      },
      s.createdAt,
    );
  if (empty) return publicState(s, Date.now());
  start(s, s.createdAt);
  for (let round = 1; round <= 20; round++) {
    for (const symbol of ["OPENAI", "ANTHROPIC"] as const) {
      const center =
        10000 +
        Math.round(Math.sin(round / 3 + (symbol === "OPENAI" ? 0 : 2)) * 1000);
      const legs =
        round % 2
          ? ([
              ["a0", "BUY", center + 1000, 4],
              ["a1", "SELL", center - 500, 2],
              ["a2", "SELL", center, 2],
            ] as const)
          : ([
              ["a0", "BUY", center + 500, 2],
              ["a1", "BUY", center, 2],
              ["a2", "SELL", center - 1000, 4],
            ] as const);
      for (const [agent, side, price, quantity] of legs)
        submit(
          s,
          `a${(Number(agent.slice(1)) + 3 * (round % 4)) % 12}`,
          {
            round,
            symbol,
            side,
            price,
            quantity,
            requestId: `${agent}-${symbol}-${round}`,
          },
          s.openedAt + 1,
        );
    }
    clearRound(s, s.openedAt + 60000);
  }
  for (let i = 0; i < 12; i++)
    for (const symbol of ["OPENAI", "ANTHROPIC"] as const)
      submit(
        s,
        `a${i}`,
        {
          round: s.round,
          symbol,
          side: i < 6 ? "BUY" : "SELL",
          price:
            (i < 6 ? 9900 - i * 100 : 10100 + (i - 6) * 100) +
            (symbol === "ANTHROPIC" ? 1000 : 0),
          quantity: (i % 5) + 1,
          requestId: `depth-${i}-${symbol}`,
        },
        s.openedAt + 1,
      );
  pause(s, s.openedAt + 1000);
  return publicState(s, Date.now());
}
test("two asset tabs show executed candles, five levels and keyboard inspection without overflow", async ({
  page,
}, info) => {
  const snapshot = await fixture();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/markets", (r) =>
    r.fulfill({
      json: {
        markets: [
          { id: snapshot.config.id, name: snapshot.config.name, practice: 1 },
        ],
      },
    }),
  );
  await page.route(`**/api/markets/${snapshot.config.id}`, (r) =>
    r.fulfill({ json: snapshot }),
  );
  await page.goto(`/?market=${snapshot.config.id}`);
  const chart = page.getByRole("img", {
    name: "OpenAI 成交 K 线图；价格单位 DUSD",
  });
  await expect(chart).toBeVisible();
  await expect(chart.locator('g[role="button"]')).toHaveCount(20);
  await page.getByRole("button", { name: "15 轮", exact: true }).click();
  await expect(chart.locator('g[role="button"]')).toHaveCount(15);
  const first = chart.locator('g[role="button"]').first();
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".ohlc")).toContainText("R6");
  const bids = page.getByRole("table", { name: "OpenAI 买盘" });
  await expect(bids.locator("tbody tr")).toHaveCount(5);
  await expect(bids.locator("tbody tr").first()).toContainText("99.00");
  await page
    .getByRole("button", { name: /Anthropic 暂无成交|Anthropic [0-9]/ })
    .click();
  await expect(
    page.getByRole("img", { name: "Anthropic 成交 K 线图；价格单位 DUSD" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("table", { name: "Anthropic 买盘" })
      .locator("tbody tr")
      .first(),
  ).toContainText("109.00");
  await page.getByRole("button", { name: /OpenAI [0-9]/ }).click();
  await expect(page.getByRole("heading", { name: "Agent 账户" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `reports/dual-asset-${info.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("a fresh market does not fabricate candles or order-book quantities", async ({
  page,
}) => {
  const snapshot = await fixture(true);
  await page.route("**/api/markets", (r) =>
    r.fulfill({
      json: {
        markets: [
          { id: snapshot.config.id, name: snapshot.config.name, practice: 1 },
        ],
      },
    }),
  );
  await page.route(`**/api/markets/${snapshot.config.id}`, (r) =>
    r.fulfill({ json: snapshot }),
  );
  await page.goto(`/?market=${snapshot.config.id}`);
  await expect(page.getByText("尚无成交 K 线", { exact: true })).toBeVisible();
  await expect(page.locator(".candle-chart")).toHaveCount(0);
  await expect(
    page.getByRole("table", { name: "OpenAI 买盘" }).locator("tbody tr"),
  ).toHaveCount(5);
  await expect(
    page
      .getByRole("table", { name: "OpenAI 买盘" })
      .locator("tbody tr")
      .first(),
  ).toHaveText("买1——");
});

test("published simulated news and separate maker statistics render without leaking future events", async ({
  page,
}, info) => {
  const s = await createState(
    {
      id: "news-ui",
      name: "新闻与庄家演示",
      assetMode: "ai",
      newsEnabled: true,
      makerCashShare: 0.2,
      rounds: 30,
      roundMs: 60000,
      capacity: 20,
      practice: true,
    },
    "news-ui-seed",
    Date.now() - 600000,
  );
  for (let i = 0; i < 4; i++)
    addAgent(
      s,
      {
        id: `a${i}`,
        name: `News Agent ${i}`,
        description: "",
        keyHash: `key${i}`,
      },
      s.createdAt,
    );
  start(s, s.createdAt);
  for (let r = 0; r < 8; r++) clearRound(s, s.openedAt + 60000);
  pause(s, s.openedAt + 1000);
  const snapshot = publicState(s, Date.now());
  expect(snapshot.news.length).toBeGreaterThan(0);
  await page.route("**/api/markets", (r) =>
    r.fulfill({
      json: {
        markets: [{ id: s.config.id, name: s.config.name, practice: 1 }],
      },
    }),
  );
  await page.route("**/api/markets/news-ui", (r) =>
    r.fulfill({ json: snapshot }),
  );
  await page.goto("/?market=news-ui");
  await expect(
    page.getByRole("heading", { name: "市场新闻", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: snapshot.news[0].headline, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".maker-card")).toContainText("20%");
  await expect(page.locator(".maker-card")).toContainText("尚无成交");
  await expect(page.locator(".maker-card")).toContainText("不参与排名");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `reports/news-maker-${info.project.name}.png`,
    fullPage: true,
  });
});

test('cash leaderboard shows cash-only scores and ignores higher inventory valuation',async({page})=>{
 const s=await createState({id:'cash-board',name:'现金排名测试',rounds:3,roundMs:60000,capacity:10,practice:true,assetMode:'legacy'},'cash-board',0);
 for(let i=0;i<2;i++)addAgent(s,{id:`c${i}`,name:i?'现金更多':'持仓更多',description:'',keyHash:`key${i}`},0);
 s.agents[0].cash=900000;s.agents[1].cash=1100000;s.agents[0].dat=150;s.agents[1].dat=50;
 start(s,Date.now());const snapshot=publicState(s,Date.now());
 await page.route('**/api/markets',r=>r.fulfill({json:{markets:[{id:s.config.id,name:s.config.name,practice:1}]}}));
 await page.route('**/api/markets/cash-board',r=>r.fulfill({json:snapshot}));
 await page.goto('/?market=cash-board');
 const table=page.getByRole('table',{name:'现金排行榜'});
 await expect(table.getByRole('columnheader',{name:'现金余额 / DUSD',exact:true})).toBeVisible();
 await expect(table.getByRole('columnheader',{name:'净资产 / DUSD',exact:true})).toHaveCount(0);
 await expect(table.locator('tbody tr').first()).toContainText('现金更多');
 await expect(table.locator('tbody tr').first().locator('td').nth(2)).toHaveText('11,000.00');
 await expect(table.locator('tbody tr').nth(1).locator('td').nth(2)).toHaveText('9,000.00');
 await expect(table.locator('caption')).toContainText('持仓估值不计分');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出排名',exact:true}).click();
 const exported=await download;const stream=await exported.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(chunk as Buffer);
 const result=JSON.parse(Buffer.concat(chunks).toString());expect(result.rankingBasis).toBe('cash');expect(result.leaderboard[0].cash).toBe(1100000);
});
