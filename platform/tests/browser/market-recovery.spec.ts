import { test, expect, type Page } from '@playwright/test';
import { createState, publicState, DEFAULT_INSTRUMENTS } from '../../worker/engine';

test.beforeEach(async ({ baseURL }) => {
  expect(new URL(baseURL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
});

async function fixture(page: Page) {
  const state = await createState({ id: 'qa-navigation', name: 'Navigation QA', practice: true,
    capacity: 10, rounds: 30, roundMs: 60000, assetMode: 'ai', instruments: DEFAULT_INSTRUMENTS,
    retailAgents: false, newsEnabled: false }, 'navigation-qa-seed', Date.now());
  await page.route('**/api/markets', r => r.fulfill({ json: { markets: [
    { id: state.config.id, name: state.config.name, practice: true },
  ] } }));
  await page.route('**/api/markets/qa-navigation', r => r.fulfill({ json: publicState(state, Date.now()) }));
  await page.route('**/api/markets/qa-nonexistent', r => r.fulfill({ status: 404,
    json: { error: { code: 'NOT_FOUND', message: 'Competition not found' } } }));
}

test('NAV-04 a known 404 exits the loading state', async ({ page }) => {
  await fixture(page);
  await page.goto('/?market=qa-nonexistent');
  await expect(page.getByRole('alert')).toContainText('not found');
  await expect(page.getByText('Loading market state…', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Loading competition…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Competition not found', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open current competition', exact: true }).click();
  await page.getByRole('button', { name: 'Browse market', exact: true }).click();
  await expect(page).toHaveURL(/market=qa-navigation/);
  await expect(page.locator('body')).toContainText('Navigation QA');
  await expect(page.getByRole('alert')).toHaveCount(0);
});


test('NAV-06 missing competition without alternatives explains how to recover', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/markets', r => r.fulfill({ json: { markets: [] } }));
  await page.goto('/?market=qa-nonexistent');
  await expect(page.getByRole('heading', { name: 'Competition not found', exact: true })).toBeVisible();
  await expect(page.getByText('Loading market state…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open current competition', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).toContainText('Please ask the organizer for a valid link.');
});


test('NAV-07 missing account does not hide a valid competition', async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => sessionStorage.setItem('agent-key:qa-navigation', 'qa-dummy-key'));
  await page.route('**/api/markets/qa-navigation/account', r => r.fulfill({ status: 404,
    json: { error: { code: 'NOT_FOUND', message: 'Account not found' } } }));
  await page.goto('/?market=qa-navigation');
  await expect(page.getByRole('alert')).toContainText('not found');
  await expect(page.getByRole('heading', { name: 'Competition not found', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).toContainText('Navigation QA');
  await expect(page.getByRole('heading', { name: /^Leaderboard/ })).toBeVisible();
});
