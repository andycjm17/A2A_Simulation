import {test,expect, type Page} from '@playwright/test';
import {createState,addAgent,publicState,start,submit,clearRound,pause,accountState} from '../../worker/engine';
import {adminStatus} from '../../worker/admin-status';
test.use({locale:'zh-CN'});
async function fixture(page:Page,active=false){
 const s=await createState({id:'english-fixture',name:'用户命名的比赛',rounds:30,roundMs:60000,capacity:50,practice:true,assetMode:'ai',newsEnabled:true,makerCashShare:0.2},'language-seed',Date.now());
 addAgent(s,{id:'user-a',name:'用户自己的Agent',description:'用户自定义策略',keyHash:'hash'},Date.now());
 if(active){
  addAgent(s,{id:'user-b',name:'Counterparty',description:'',keyHash:'hash-b'},Date.now());
  start(s,Date.now()-180000);
  for(let i=1;i<=3;i++){
   submit(s,'user-a',{round:i,symbol:'OPENAI',side:'BUY',price:11000,quantity:2,requestId:`buy-${i}`},s.openedAt+1);
   submit(s,'user-b',{round:i,symbol:'OPENAI',side:'SELL',price:9000,quantity:2,requestId:`sell-${i}`},s.openedAt+1);
   clearRound(s,s.openedAt+60000);
  }
  pause(s,s.openedAt+1000);
 }
 const snapshot=publicState(s,Date.now());
 await page.route('**/api/markets',r=>r.fulfill({json:{markets:[{id:s.config.id,name:s.config.name,practice:true}]}}));
 await page.route('**/api/markets/english-fixture',r=>r.fulfill({json:snapshot}));
 await page.route('**/api/markets/english-fixture/account',r=>r.fulfill({status:401,json:{error:{code:'UNAUTHORIZED',message:'无效的 API Key'}}}));
 const status=adminStatus(s,Date.now());
 // An unknown audit event must retain its stable type without crashing localization.
 status.events.unshift({seq:999,at:Date.now(),type:'future_event'});
 await page.route('**/api/admin/dashboard?*',r=>r.fulfill({json:{markets:[status],failures:[],offset:0,nextOffset:null,catalogCount:1,serverTime:Date.now()}}));
 await page.route('**/api/admin/markets/english-fixture/status',r=>r.fulfill({json:status}));
 if(active)await page.route('**/api/markets/english-fixture/account',r=>r.fulfill({json:accountState(s,s.agents.find(a=>a.id==='user-a')!)}));
 return snapshot;
}
async function cleanEnglish(page:Page){
 await expect(page.locator('.language-switch')).toHaveCount(0);
 await expect(page.getByRole('button',{name:/^(English|中文)$/})).toHaveCount(0);
 await expect(page.locator('a[href*="andycui.com"]')).toHaveCount(0);
 await expect(page.locator('html')).toHaveAttribute('lang','en-US');
 const text=await page.locator('body').innerText();
 expect(text).not.toMatch(/m[0-9a-f]{10}/);
 const remaining=text.replaceAll('中文','').replaceAll('用户命名的比赛','').replaceAll('用户自己的Agent','').replaceAll('用户自定义策略','');
 expect(remaining.match(/[^\n]*[\p{Script=Han}][^\n]*/gu)||[]).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
}
test('English market, rules and API docs; English-only UI despite old Chinese preferences',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await fixture(page);await page.addInitScript(()=>localStorage.setItem('a2a-language','zh'));await page.goto('/?market=english-fixture&lang=zh');
 await expect(page.getByRole('heading',{name:'Leaderboard'})).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('lang','en-US');
 await cleanEnglish(page);
 await page.evaluate(()=>document.fonts.ready);
 expect(await page.locator('h1').evaluate(e=>getComputedStyle(e).fontFamily)).toContain('Tektur');
 expect(await page.locator(':root').evaluate(e=>getComputedStyle(e).getPropertyValue('--navy').trim())).toBe('#012169');
 const maker=await page.locator('.maker-card').boundingBox();const panel=await page.locator('.news-panel').boundingBox();
 expect(maker!.x).toBeGreaterThanOrEqual(panel!.x);expect(maker!.y+maker!.height).toBeLessThanOrEqual(panel!.y+panel!.height+1);
 await page.screenshot({path:`reports/dbc-market-${info.project.name}.png`,fullPage:true});
 await page.getByRole('button',{name:'My Agent',exact:true}).click();
 await page.getByRole('button',{name:'View MCP / API documentation',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Connect & API',exact:true})).toBeVisible();
 await cleanEnglish(page);
 await page.getByRole('button',{name:'Competition rules',exact:true}).click();
 await cleanEnglish(page);
 await expect(page.locator('body')).toContainText('not automatically');
 await page.goto('/?market=english-fixture');
 await expect(page.locator('html')).toHaveAttribute('lang','en-US');
 expect(errors).toEqual([]);
});
test('participant input remains usable and renders English API errors',async({page})=>{
 await fixture(page);await page.addInitScript(()=>localStorage.setItem('a2a-language','zh'));await page.goto('/?market=english-fixture&lang=zh');
 await page.getByRole('button',{name:'My Agent',exact:true}).click();
 await expect(page.getByLabel(/invite code/i)).toHaveCount(0);
 await page.getByLabel('Agent name',{exact:true}).fill('用户自己的Agent');
 await page.getByLabel('Capabilities and strategy').fill('Keep my unsaved strategy');
 await expect(page.getByLabel('Agent name',{exact:true})).toHaveValue('用户自己的Agent');
 await expect(page.getByRole('alert')).toHaveText('This Agent name is already registered.');
 await page.getByLabel('Agent name',{exact:true}).fill('Fresh Agent');
 await expect(page.getByRole('alert')).toHaveCount(0);
 await page.route('**/api/markets/english-fixture/join',r=>r.fulfill({
  status:409,json:{error:{code:'NAME_TAKEN'}},
 }));
 await page.getByRole('button',{name:'Register and get credentials',exact:true}).click();
 await expect(page.getByRole('alert')).toHaveText('This Agent name is already registered.');
 await page.getByLabel('Agent name',{exact:true}).fill('Another Agent');
 await page.getByRole('button',{name:'View MCP / API documentation',exact:true}).click();
 await expect(page.getByLabel('MCP Endpoint')).toBeVisible();
 await page.getByRole('button',{name:/Back to My Agent/}).click();
 await expect(page.getByLabel('Agent name',{exact:true})).toHaveValue('Another Agent');
 await expect(page.getByLabel('Capabilities and strategy')).toHaveValue('Keep my unsaved strategy');
 await page.getByLabel('API Key',{exact:true}).fill('invalid-key');
 await page.getByRole('button',{name:'Verify and connect',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('credential');
 await cleanEnglish(page);
});
test('admin keeps credential, form and dashboard open',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await fixture(page);await page.goto('/?market=english-fixture&view=admin&lang=en');
 await page.getByLabel('Organizer admin credential').fill('fixture-key-not-a-secret');
 await page.getByRole('button',{name:'Open admin dashboard',exact:true}).click();
 await expect(page.getByRole('button',{name:'Lock dashboard',exact:true})).toBeVisible();
 await cleanEnglish(page);
 await expect(page.getByRole('button',{name:'Lock dashboard',exact:true})).toBeVisible();
 await expect(page).toHaveURL(/view=admin/);
 await page.screenshot({path:`reports/dbc-admin-${info.project.name}.png`,fullPage:true});
 expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('fixture-key-not-a-secret');
 expect(errors).toEqual([]);
});

test('executed charts, news, connected account and leaderboard remain localized',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await fixture(page,true);await page.goto('/?market=english-fixture&lang=en');
 const chart=page.getByRole('img',{name:/OpenAI.*DUSD/});await expect(chart).toBeVisible();
 expect(await chart.locator('g[role="button"]').count()).toBeGreaterThan(0);
 await cleanEnglish(page);
 await page.getByRole('button',{name:'My Agent',exact:true}).click();
 await page.getByLabel('API Key',{exact:true}).fill('fixture-account-key');
 await page.getByRole('button',{name:'Verify and connect',exact:true}).click();
 await expect(page.getByRole('heading',{name:'用户自己的Agent',exact:true})).toBeVisible();
 await expect(page.getByText('用户自定义策略',{exact:true})).toHaveCount(0);
 await expect(page.getByText('My strategy',{exact:true})).toHaveCount(0);
 await cleanEnglish(page);
 await expect(page.getByRole('heading',{name:'用户自己的Agent',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'用户自己的Agent',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Market overview',exact:true}).click();
 await page.screenshot({path:`reports/dbc-active-${info.project.name}.png`,fullPage:true});
 expect(errors).toEqual([]);
});

test('Desktop layout remains usable at supported desktop widths',async({page},info)=>{
 test.skip(info.project.name!=='desktop','Viewport sweep runs once');
 await fixture(page,true);await page.goto('/?market=english-fixture');
 await expect(page.getByRole('heading',{name:/^Leaderboard/})).toBeVisible();
 for(const width of [1280,1440,1920]){
  await page.setViewportSize({width,height:1000});await cleanEnglish(page);
  const cta=page.getByRole('button',{name:'Connect my Agent',exact:true});
  await expect(cta).toBeVisible();const box=await cta.boundingBox();expect(box!.x+box!.width).toBeLessThanOrEqual(width);
 }
});
