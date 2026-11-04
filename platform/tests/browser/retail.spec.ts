import { test, expect } from "@playwright/test";
import {
  createState,
  addAgent,
  start,
  publicState,
  clearRound,
  settlementAt,
  DEFAULT_INSTRUMENTS,
} from "../../worker/engine";
for (const finished of [false, true])
  test(`retail scores stay separate from participant cash rankings (${finished ? "finished" : "running"})`, async ({
    page,
  }, info) => {
    const state = await createState(
      {
        id: "retail-ui",
        name: "Twenty-minute competition",
        rounds: 240,
        roundMs: 5000,
        capacity: 50,
        practice: true,
        assetMode: "ai",
        instruments: DEFAULT_INSTRUMENTS,
        newsEnabled: true,
        makerCashShare: 0.2,
        retailAgents: true,
      },
      "ui-retail-seed",
      Date.now(),
    );
    addAgent(
      state,
      {
        id: "human",
        name: "Human participant",
        keyHash: "unused",
        description: "",
      },
      Date.now(),
    );
    start(state, Date.now());
    if (finished)
      while (state.status === "running") clearRound(state, settlementAt(state));
    const snapshot = publicState(state, Date.now());
    await page.route("**/api/markets", (r) =>
      r.fulfill({
        json: {
          markets: [
            { id: state.config.id, name: state.config.name, practice: true },
          ],
        },
      }),
    );
    await page.route("**/api/markets/retail-ui", (r) =>
      r.fulfill({ json: snapshot }),
    );
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/?market=retail-ui");
    const panel = page.getByRole("region", {
      name: "Simulated retail traders",
    });
    await expect(panel).toBeVisible();
    await expect(panel.locator("tbody tr")).toHaveCount(5);
    await expect(panel).toContainText("Momentum");
    await expect(panel).toContainText("Traders assume the market continues indefinitely");
    await expect(panel).toContainText(finished ? "240 / 240" : "1 / 240");
    if (finished) await expect(panel).toContainText("Final scores");
    const human = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: /^Leaderboard/ }) });
    await expect(human.locator("tbody tr")).toHaveCount(1);
    await expect(human).not.toContainText("Retail 1");
    await expect(page.locator(".language-switch")).toHaveCount(0);
    await expect(page.locator('a[href*="andycui.com"]')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `reports/retail-${finished ? "final" : "running"}-${info.project.name}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
