import {chromium} from 'playwright';
const browser=await chromium.launch();
const market=process.env.MARKET_ID||'acceptance-1789186009126';
try{for(const [name,width,height]of [['desktop',1440,1000],['mobile',390,844]]){const page=await browser.newPage({viewport:{width,height}});await page.goto(`https://a2a.andycui.com/?market=${encodeURIComponent(market)}`);await page.getByRole('heading',{name:'Leaderboard'}).waitFor();await page.getByText('已完成结算',{exact:true}).waitFor();await page.screenshot({path:`reports/release-${name}.png`,fullPage:true});await page.close();}}finally{await browser.close();}
