import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const origin='https://test.a2asimulation.com';
const token=readFileSync('private/admin-token.txt','utf8').trim();
test.use({trace:'off'});
test('lab page shows local verification and pending public testnet honestly',async({page})=>{
 await page.goto(origin+'/lab');await expect(page.getByRole('heading',{name:'每笔订单，都有可验证的记录。'})).toBeVisible();
 await expect(page.getByText('公开测试网待测试币。',{exact:false})).toBeVisible();
 await expect(page.getByRole('link',{name:'下载完整测试结果 ↗'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('participant creates and binds a locally generated signer',async({page,request},info)=>{
 const id=`browser-signed-${info.project.name}-${Date.now()}`;
 const response=await request.post(origin+'/api/admin/markets',{headers:{Authorization:`Bearer ${token}`},data:{id,name:'Browser identity check',practice:true,capacity:2,rounds:1,roundMs:60000,auditEnabled:true}});expect(response.status()).toBe(201);
 await page.goto(origin+'/?market='+id);await page.getByRole('button',{name:'我的 Agent',exact:true}).click();
 await page.getByLabel('Agent 名称',{exact:true}).fill('Browser signing agent');
 await page.getByRole('button',{name:'创建并获取连接凭证'}).click();
 await expect(page.getByText('本场需要 Agent 签名')).toBeVisible();
 await page.getByRole('button',{name:'生成本地密钥'}).click();
 await page.getByRole('button',{name:'绑定签名身份'}).click();
 await expect(page.getByRole('status').filter({hasText:'已绑定'})).toBeVisible();
 await expect(page.getByRole('button',{name:'导出 Agent 私密配置'})).toBeEnabled();
});
test('new production domain retains the selected historical market',async({page})=>{
 await page.goto('https://a2asimulation.com/?market=browser-mobile-1789189053494');
 await expect(page.getByText('比赛已暂停',{exact:false}).first()).toBeVisible();
 const result=await page.request.get('https://a2asimulation.com/api/markets/browser-mobile-1789189053494');
 expect((await result.json()).participantCount).toBe(2);
});
