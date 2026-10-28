import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const read=async f=>JSON.parse(await readFile(`reports/${f}`,'utf8'));
const release=await read('release-verification.json'),deployment=await read('release-deployment.json');
if(!release.allBalancesReconstructed||!release.allFillsReconciled||!release.treasuryConserved)throw new Error('Full audit reconciliation incomplete');
const [unit,runtime,browser,productionBrowser,real,production,large,smoke]=await Promise.all([
 'unit.json','runtime.json','browser.json','browser-production.json','run-acceptance-1789186009126.json','run-acceptance-1789185138604.json','run-acceptance-1789185337815.json','production-smoke.json'].map(read));
if(!unit.success||!runtime.success||browser.stats.unexpected||productionBrowser.stats.unexpected||real.errors.length||production.errors.length||large.errors.length)throw new Error('Required evidence has not passed. Report not marked complete.');
if(browser.stats.expected!==6||productionBrowser.stats.expected!==6||real.elapsedSeconds<1800||real.summary.results.length!==30||real.summary.leaderboard.length!==50||real.summary.leaderboard.some(a=>a.decisions!==30))throw new Error('Endurance or browser evidence is incomplete.');
const files=await readdir('reports'),localFile=files.filter(f=>f.startsWith('load-local-')).sort().at(-1),remoteFile=files.filter(f=>f.startsWith('load-remote-')).sort().at(-1);
const local=await read(localFile),remote=await read(remoteFile);
const link=f=>`[${f}](${resolve('reports',f)})`;
const round=(x,d=1)=>Number(x).toFixed(d);
const table=[...local.metrics.filter(m=>[50,100].includes(m.writeStats?.participants)).map(m=>['本地',m]),...remote.metrics.map(m=>['线上',m])].map(([where,m])=>`| ${where} | ${m.writeStats.participants} | ${round(m.writeStats.p95Ms)} ms | ${round(m.writeStats.requestsPerSecond)} | ${round(m.readStats.p95Ms)} ms | ${m.writeStats.errors.length+m.readStats.errors.length+m.retryStats.errors.length} |`).join('\n');
const delay=r=>Math.max(...r.summary.results.map(x=>x.clearedAt-x.scheduledAt));
const retries=large.retries.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{});
const text=`# Agent Exchange · 开发与测试验收报告

完成时间：${new Date().toISOString()}。线上地址：[a2a.andycui.com](https://a2a.andycui.com)。[50-Agent 真实 30 分钟线上结果](https://a2a.andycui.com/?market=acceptance-1789186009126)。

## 交付结果

已实现并部署参与者自带 Agent 的模拟撮合平台：真实 REST API 与 Streamable HTTP MCP、比赛创建、单次邀请码、Agent 凭证与重置、私有账户回执、密封批量撮合、持续资产账本、服务器定时结算、暂停恢复、最终兑换、排行榜、价格承诺核验和审计导出。浅色绿色界面覆盖桌面与手机视口。没有平台模型调用、真实稳定币、充值提现或链上转账。

正式赛固定 30 轮 × 60 秒；默认 50 人，发布配置的单场硬上限 100 人。奖品按组织者赛前公布规则人工确认发放，平台不转移真实资金。

## 自动化验证

| 测试层 | 通过结果 | 覆盖 |
|---|---:|---|
| 纯撮合引擎 | ${unit.numPassedTests} / ${unit.numTotalTests} | 限价、中点、部分成交、资金/DAT 约束、无对手不成交、时间边界、生命周期、重试、终值兑换、承诺与隐私 |
| 真实 workerd / SQLite | ${runtime.numPassedTests} / ${runtime.numTotalTests} | 认证隔离、20 并发订单、邀请码竞争与回滚、重启恢复、alarm 幂等、官方 MCP SDK、数据库故障注入、超过 2 MB 的中文订单历史、限流 |
| 桌面 + 手机浏览器 | ${browser.stats.expected} / ${browser.stats.expected+browser.stats.unexpected} | 注册、恢复、XSS 文本、真实 API 下单回执、文档、权限与异步页面状态回归 |
| 同一浏览器套件线上重复验收 | ${productionBrowser.stats.expected} / ${productionBrowser.stats.expected+productionBrowser.stats.unexpected} | 生产域名、HTTPS、真实后端和桌面/手机流程 |
| 线上 MCP / API 烟雾测试 | ${smoke.checks.length} 项检查通过 | 初始化、工具发现、跨接口幂等、越权拒绝、按时撮合、兑换、守恒与承诺 |

合计 ${unit.numPassedTests+runtime.numPassedTests+browser.stats.expected} 项不同配置下的自动化用例通过（线上浏览器为重复执行，不重复计数）。其中一个属性测试另覆盖 **1,000 组随机种子 × 10 个账户 × 30 轮**，每轮检查非负余额和总量守恒。依赖全量 npm audit 与生产依赖审查均未报告已知漏洞；这不等于独立安全审计。

## 持续交易验证

| 场景 | 实际耗时（含注册） | 决策确认 | 成交笔数 | 最大结算延迟 | 结果 |
|---|---:|---:|---:|---:|---|
| 线上：50 Agent，30 轮 × 60 秒 | ${round(real.elapsedSeconds,3)} 秒 | 1,500 / 1,500 | ${real.summary.tradeCount} | ${delay(real)} ms | 无永久失败，真实 30 分钟（重试 ${real.retries?.length||0} 次） |
| 线上：50 Agent，30 轮 × 10 秒 | ${round(production.elapsedSeconds,3)} 秒 | 1,500 / 1,500 | ${production.summary.tradeCount} | ${delay(production)} ms | 无失败，加速完整比赛 |
| 本地：100 Agent，30 轮 × 5 秒 | ${round(large.elapsedSeconds,3)} 秒 | 3,000 / 3,000 | ${large.summary.tradeCount} | ${delay(large)} ms | ${large.retries.length} 次重试后无永久失败 |

100-Agent 本地回归保留全部异常证据：HTTP 503（开发 Worker 在请求中重启）${retries[503]||0} 次，HTTP 500（开发代理连接丢失）${retries[500]||0} 次。相同 requestId 重试后，最终每个账户恰好 30 个决定，没有重复交易；不把它报告成“零网络错误”。服务器重启与开发并发活动在部分测试期间发生。

三类实验均完成终值兑换并验证价格承诺。真实 30 分钟线上试验累计成交 ${real.summary.volume} DAT；加速线上试验累计成交 ${production.summary.volume} DAT。策略来自 10 类程序化外部客户端，不是 50 个平台托管的大模型。不同策略存在排名差异；本次为平台验收，不据此声称策略表现具有统计显著性。

## 压力测试与发布边界

以下为同一比赛的同步请求突发。下单速率按本批请求总量 / 批次耗时计算，不是持续吞吐承诺。读取组合为账户与公开快照；重试检查同一回执只出现一次。

| 环境 | 参与者 / 同时请求数 | 下单 P95 | 本批下单 req/s | 读取 P95 | 本批错误 |
|---|---:|---:|---:|---:|---:|
${table}

本地客户端硬件：Apple M4、10 CPU cores、24 GiB 内存；Node 22.17.1，Wrangler 4.131.1。线上数据是从此客户端到 Cloudflare 的端到端短时测量，包含网络延迟。线上只做 50 / 100 人两档有上限的探测，没有对原个人网站压测。

早期版本还探测过 250 / 500 人：250 人突发无错误；500 人下单和重试合计出现 69 个失败响应，日志指向本地开发代理的 Network connection lost。该结果来自优化前版本，不能反推 Cloudflare 的绝对承载上限。之后已优化读取与增量写入，发布单场上限收紧为 100，活动默认建议 50。

较早的 100 人加速试验未开启客户端重试，出现 14 次与 9 次错误，原始记录保留。最终回归明确验证了恢复路径，而非删除失败实验。

最初的本地 10-Agent 30 分钟试验中，旧客户端在开发配置变化期间于第 26 轮退出，仅确认 260 / 300 个决定；即使服务器继续完成了定时结算，也不计作完整参与者验收。最终采用冻结的生产版本重新执行上表中的 50-Agent 真实 30 分钟验收。该失败试验的恢复记录为 ${link('aborted-local-30min.json')}。

## 生产部署与依赖

- Worker：andycui-a2a；最终发布版本：${deployment.version}。
- 30 分钟连续运行使用冻结版本 d878f74a-ee65-4664-90bf-89d8f2abcf99。结束后仅修正管理导出由最近 100 笔改为完整成交列表，撮合引擎、定时与账本格式未改变；再次通过运行时与生产烟雾验收，并逐笔重建本次 50 个账户的最终余额。
- HTTPS 200；HTTP 自动 308 跳转 HTTPS；官方域名绑定读回确认 a2a.andycui.com 指向新 Worker。
- 原 andycui.com 仍绑定 andycui，根站 HTTP 状态正常，原站仓库未修改。
- 管理密钥通过 Cloudflare Secret 设置；本机 private/admin-token.txt 权限 0600，目录 0700，排除版本控制。生产 secret 列表只有 ADMIN_TOKEN，DEV_ORIGIN 仅用于本地。
- 浏览器跨域来源严格校验；认证标识 3,000 请求/分钟，来源 IP 合计 6,000 请求/分钟；限流由 Cloudflare 实现，不能替代身份审核与活动配额规划。
- Workers 套餐与账户剩余额度因账单权限不足未核实，已向组织者询问；没有擅自开通付费。正式活动前需确认配额、参赛名单与奖品安排。

## 问题修复与证据

已修复：开发域名映射后的本地 Origin 配置、异步市场列表加载导致管理表单被清空、订单历史单行存储大小风险、重复回执不必要写入、排行榜重复扫描、SQL 失败后的缓存一致性与凭证/IP 双重限流。SQLite 单行大小约束参照 [Cloudflare 官方限制](https://developers.cloudflare.com/durable-objects/platform/limits/)；实际通过超过 2 MB 多字节历史的冷启动测试。

额外修复管理审计导出的成交记录截断：公开页面仍展示最近 100 笔，但管理导出现在返回全部成交。冷启动回归同时核验完整导出的 1,200 笔成交与 2,400 个订单。真实 30 分钟比赛的完整成交已独立重放，50 个账户的资金、持仓及终值兑换全部匹配。证据：${link('endurance-full-audit.json')}，${link('release-verification.json')}。

原始证据：${link('unit.json')}，${link('runtime.json')}，${link('browser.json')}，${link('browser-production.json')}，${link('production-smoke.json')}，${link(localFile)}，${link(remoteFile)}。

连续运行：${link('run-acceptance-1789186009126.json')}，${link('run-acceptance-1789185138604.json')}，${link('run-acceptance-1789185337815.json')}。

早期失败试验：${link('load-local-1789184654817.json')}，${link('run-acceptance-1789184795775.json')}，${link('run-acceptance-1789184958031.json')}。
`;
await writeFile('TEST_REPORT_CN.md',text);console.log('TEST_REPORT_CN.md generated from verified reports.');
