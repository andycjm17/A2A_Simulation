"""Descriptive match-level trade counts; scenario ranges are not forecast intervals."""
import json,hashlib
from pathlib import Path
import numpy as np
root=Path(__file__).resolve().parents[1];folder=root/'experiments/continuous'
raw=json.loads((folder/'horizon-raw.json').read_text());old=json.loads((folder/'raw.json').read_text());n=raw['seeds']
for p,h in raw['codeHashes'].items():assert hashlib.sha256((root/p).read_bytes()).hexdigest()==h,p
assert len(raw['rows'])==n*5
assert len({(r['seed'],r['trigger']) for r in raw['rows']})==n*5
for r in raw['rows']:
    assert r['durationMs']==1800000 and r['conservation'] and r['artificialMatchingWaitMs']==0
    assert r['volume']>=r['trades']>=0 and r['trades']<=r['orders']
for seed in range(n):
    a=[r for r in raw['rows'] if r['seed']==seed]
    assert len({tuple(r['terminal']) for r in a})==1
    assert len({r['tapeHash'] for r in a})==1
groups=[]
for trigger in ['timer10','timer5','targeted','market','serial']:
    a=[r for r in raw['rows'] if r['trigger']==trigger];v=np.array([r['trades'] for r in a]);prior=[r for r in old['primary'] if r['trigger']==trigger and r['seed']<n]
    assert len(prior)==n
    linear=np.mean([r['trades'] for r in prior])*6
    groups.append({'trigger':trigger,'seeds':n,'meanTrades':float(v.mean()),'medianTrades':float(np.median(v)),'p10':float(np.quantile(v,.1)),'p90':float(np.quantile(v,.9)),'minTrades':int(v.min()),'maxTrades':int(v.max()),'meanTradesPerMinute':float(v.mean()/30),'meanUnits':float(np.mean([r['volume'] for r in a])),'meanCalls':float(np.mean([r['calls'] for r in a])),'fiveMinuteMeanSameSeeds':float(linear/6),'linearSixTimes':float(linear),'differenceFromLinearPct':float((v.mean()/linear-1)*100)})
summary={'protocol':raw['protocol'],'generatedAt':raw['generatedAt'],'matches':len(raw['rows']),'durationMinutes':30,'unit':'one executed counterparty fill; counted once','rangeDefinition':'P10-P90 across 50 scripted-match scenarios, not a real-world prediction or confidence interval','groups':groups,'validation':raw['validation']}
(folder/'horizon-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
names={'timer10':'Agent 每 10 秒决策','timer5':'Agent 每 5 秒决策','targeted':'新闻或自身成交触发','market':'全盘口及成交事件触发','serial':'返回后立即继续决策'}
lines=['# 连续撮合下的 30 分钟成交笔数','',f"另跑 {len(raw['rows'])} 场完整模拟，每种策略 {n} 个相同随机种子，观察窗口为 30 分钟。20 个普通 Agent、1 名庄家、两个标的合计。庄家占初始可交易现金 20%，无撮合轮次。普通脚本推理时间假设为 0.8-1.2 秒加提交延迟，其他参数沿用 continuous-v2。",'',
       '| Agent 决策方式 | 平均成交笔数 | P10-P90 情景范围 | 每分钟平均笔数 | 平均成交份数 |','|---|---:|---:|---:|---:|']
for g in groups:lines.append(f"| {names[g['trigger']]} | {g['meanTrades']:.1f} | {g['p10']:.0f}-{g['p90']:.0f} | {g['meanTradesPerMinute']:.1f} | {g['meanUnits']:.1f} |")
lines+=['', '成交笔数与数量不同。一笔主动订单若依次吃掉三个对手挂单，计三笔成交；每笔成交不再把买方和卖方各算一次。情景范围是 50 个脚本种子结果的第 10 至 90 百分位，不是真实市场预测区间，也不是均值的置信区间。',
        '', '完整延长资金、库存、订单和新闻路径，不把短期结果直接乘六。相对同一前 50 个种子的五分钟均值乘六，各组偏差如下：','']
for g in groups:lines.append(f"- {names[g['trigger']]}：{g['differenceFromLinearPct']:+.2f}%。")
lines+=['', '这只是现有脚本行为和假设延迟下的成交规模，不是真实 LLM Agent 的承诺成交量或线上吞吐量证明。仅收到新闻和自身成交也可能因成交后重新下单形成反馈；全盘口和持续循环组会产生更多重复决策。',
        '', '全部模拟逐事件通过资金和库存守恒检查；延长新闻路径的前五分钟，对种子 0 的全部五种条件复现了之前的成交笔数、数量、调用数和最终现金。',
        '', '复现：node scripts/run-horizon.mjs；python scripts/analyze-horizon.py。输入设计 horizon-methodology.md；逐场结果 horizon-raw.json；统计结果 horizon-summary.json。此次没有改变生产 Worker。']
(folder/'horizon-results.md').write_text('\n'.join(lines)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
