import {test,expect} from '@playwright/test';
test.use({locale:'zh-CN'});
test.skip(!process.env.UI_BASE_URL?.startsWith('https:'),'Read-only deployed-site check');
test('deployed English UI, live market data and English-only branding',async({page,request},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const r=await request.get('/api/markets');expect(r.ok()).toBe(true);
 const {markets}=await r.json();expect(markets.length).toBeGreaterThan(0);
 const preferred=process.env.UI_BASE_URL?.includes('test.')?'signed-demo-20261030':'crypto-etf-demo-20261030';
 const id=markets.find((m:any)=>m.id===preferred)?.id||markets[0].id;
 const data=await request.get(`/api/markets/${id}`);expect(data.ok()).toBe(true);
 await page.goto(`/?market=${id}&lang=zh`);
 await expect(page.getByRole('heading',{name:'Trading market',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:/^Leaderboard/})).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('lang','en-US');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:`reports/dbc-live-${info.project.name}.png`,fullPage:true});
 await page.getByRole('button',{name:'Competition admin',exact:true}).click();
 await expect(page.getByLabel('Organizer admin credential')).toBeVisible();
 await expect(page.getByLabel('Organizer admin credential')).toBeVisible();
 if(process.env.UI_BASE_URL?.includes('test.')){
  await page.goto('/lab?lang=en');
  await expect(page.getByRole('heading',{name:'A verifiable record for every order.'})).toBeVisible();
  await expect(page.locator('.lab-results span')).toHaveCount(32);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
 await expect(page.locator('.language-switch')).toHaveCount(0);
 await expect(page.locator('a[href*="andycui.com"]')).toHaveCount(0);
 await expect(page.locator('html')).toHaveAttribute('lang','en-US');
 expect(errors).toEqual([]);
});
