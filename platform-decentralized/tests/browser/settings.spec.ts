import {test,expect} from '@playwright/test';
import {createState,addAgent,publicState,DEFAULT_INSTRUMENTS} from '../../worker/engine';
import {adminStatus} from '../../worker/admin-status';

test('participant names and history stay clean; admin edits duration and interval',async({page},info)=>{
 const s=await createState({id:'settings-ui',name:'Current event',rounds:240,roundMs:5000,capacity:50,practice:false,assetMode:'ai',instruments:DEFAULT_INSTRUMENTS,newsEnabled:true,makerCashShare:0.2,makerPolicy:'capital-preserving-v1',autoRedeem:false},'settings-seed',Date.now());
 addAgent(s,{id:'one',name:'Participant One',keyHash:'unused',description:''},Date.now());
 await page.route('**/api/markets',r=>r.fulfill({json:{markets:[{id:s.config.id,name:s.config.name,practice:false},{id:'old-event',name:'Old event',practice:true}]}}));
 await page.route('**/api/markets/settings-ui',r=>r.fulfill({json:publicState(s,Date.now())}));
 await page.route('**/api/admin/dashboard?*',r=>r.fulfill({json:{markets:[adminStatus(s,Date.now())],failures:[],offset:0,nextOffset:null,catalogCount:1,serverTime:Date.now()}}));
 await page.route('**/api/admin/markets/settings-ui/status',r=>r.fulfill({json:adminStatus(s,Date.now())}));
 await page.goto('/?market=settings-ui');
 // Production preserves the collaborator's onboarding dialog; the lab has its own entry flow.
 const dialog=page.getByRole('dialog',{name:'Connect your Agent'});
 if(await dialog.count())await dialog.getByRole('button',{name:'Browse market'}).click();
 await expect(page.getByRole('combobox',{name:'Current competition'})).toHaveCount(0);
 await expect(page.locator('body')).not.toContainText('(simulated)');
 await expect(page.locator('body')).not.toContainText('Old event');
 await expect(page.locator('body')).toContainText('Luma ETF');
 await expect(page.locator('body')).toContainText('Goal: provide liquidity while protecting capital');
 await page.goto('/?market=settings-ui&view=admin');
 await page.getByLabel('Organizer admin credential').fill('fixture-admin');
 const editor=page.getByRole('form',{name:'Edit trading schedule'});
 await editor.getByLabel('Total duration (minutes)').fill('30');
 await editor.getByLabel('Seconds per round').fill('4');
 let saved:any;
 await page.route('**/api/admin/markets/settings-ui/schedule',async r=>{
  saved=r.request().postDataJSON();s.config.rounds=saved.rounds;s.config.roundMs=saved.roundMs;
  await r.fulfill({json:publicState(s,Date.now())});
 });
 await editor.getByRole('button',{name:'Save trading schedule'}).click();
 await expect.poll(()=>saved).toEqual({rounds:450,roundMs:4000});
 await expect(editor).toContainText('450 rounds');
 const create=page.locator('form').filter({has:page.getByRole('button',{name:'Create competition',exact:true})});
 await create.getByLabel('Competition name',{exact:true}).fill('New scheduled event');
 await create.getByLabel('Competition ID',{exact:true}).fill('new-scheduled');
 await create.getByLabel('Total duration (minutes)').fill('10');
 await create.getByLabel('Seconds per round').fill('3');
 let created:any;
 await page.route('**/api/admin/markets',async r=>{created=r.request().postDataJSON();await r.fulfill({status:400,json:{error:{code:'VALIDATION_ERROR'}}});});
 await create.getByRole('button',{name:'Create competition',exact:true}).click();
 await expect.poll(()=>created?.rounds).toBe(200);expect(created.roundMs).toBe(3000);
 await page.screenshot({path:`reports/admin-settings-${info.project.name}.png`,fullPage:true});
});
