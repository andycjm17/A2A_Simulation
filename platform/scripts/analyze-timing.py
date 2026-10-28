"""Match-level paired inference for timing-v1. Run after node scripts/run-timing.mjs.
Requires numpy; uses no network or external observations.
"""
import json
from pathlib import Path
import numpy as np

root=Path(__file__).resolve().parents[1]
folder=root/'experiments/timing'
raw=json.loads((folder/'raw.json').read_text())
n=raw['seeds']
metrics=['volume','gapPct','returnPp','excessReturnPp','meanCashDUSD','calls','arrivedCalls','afterCloseCalls','orders','waitSeconds','makerVolumeShare','offFundamentalVolumeShare']
def average(rows):
    return {k:float(np.mean([r[k] for r in rows if r[k] is not None])) for k in metrics if any(k in r and r[k] is not None for r in rows)}
lookup={(r['seed'],r['matching'],r['cadence']):r for r in raw['factorial']}
assert len(lookup)==n*9==len(raw['factorial'])
assert all(r['conservation'] for category in ['production','factorial','sensitivity'] for r in raw[category])
for seed in range(n):
    cells=[r for r in raw['factorial'] if r['seed']==seed]
    assert len({tuple(r['terminal']) for r in cells})==1
    assert len({r['newsChanges'] for r in cells})==1
    for c in ['5s','10s']:
        assert len({lookup[seed,m,c]['calls'] for m in ['batch5','batch10','continuous']})==1
    for r in cells:
        # Independent unit/denominator reconciliation; terminal cash includes redemption.
        assert abs((r['meanCashDUSD']-30000)/30000*100-r['returnPp'])<1e-10
        assert r['arrivedCalls']+r['afterCloseCalls']==r['calls']
groups=[]
for m in ['batch10','batch5','continuous']:
    for c in ['10s','5s','event']:
        groups.append({'matching':m,'cadence':c,**average([lookup[i,m,c] for i in range(n)])})
comparisons=[('batch5-v-batch10-at-5s',('batch5','5s'),('batch10','5s')),
             ('continuous-v-batch10-at-5s',('continuous','5s'),('batch10','5s')),
             ('continuous-5s-v-10s',('continuous','5s'),('continuous','10s')),
             ('continuous-event-v-5s',('continuous','event'),('continuous','5s'))]
rng=np.random.default_rng(2026102802)
bootstrap=rng.integers(0,n,size=(10000,n));signs=rng.choice([-1,1],size=(19999,n))
contrasts=[];primary=[]
for name,treatment,baseline in comparisons:
    row={'id':name,'treatment':treatment,'baseline':baseline,'metrics':{}}
    for metric in metrics:
        a=np.array([lookup[i,*treatment][metric] for i in range(n)],dtype=float)
        b=np.array([lookup[i,*baseline][metric] for i in range(n)],dtype=float)
        delta=a-b
        cell={'treatment':float(a.mean()),'baseline':float(b.mean()),'delta':float(delta.mean())}
        if metric in ['volume','gapPct']:
            cell['ci95']=np.quantile(delta[bootstrap].mean(axis=1),[.025,.975]).tolist()
            cell['p']=float((1+np.count_nonzero(np.abs(signs@delta/n)>=abs(delta.mean())-1e-12))/20000)
            primary.append(cell)
        row['metrics'][metric]=cell
    contrasts.append(row)
running=0
for rank,cell in enumerate(sorted(primary,key=lambda x:x['p'])):
    running=max(running,min(1,cell['p']*(len(primary)-rank)));cell['holmP']=running
prod=[]
for condition in ['fixed-rounds','fixed-duration','deadline-sensitivity']:
    subset=[r for r in raw['production'] if r['condition']==condition]
    for latency in sorted({r['latencyMs'] for r in subset}):
        for period in sorted({r['periodMs'] for r in subset}):
            rows=[r for r in subset if r['latencyMs']==latency and r['periodMs']==period]
            if not rows:continue
            prod.append({'condition':condition,'latencyMs':latency,'periodMs':period,'seeds':len(rows),'rounds':rows[0]['rounds'],'durationSeconds':rows[0]['durationSeconds'],
                         'volume':float(np.mean([r['volume'] for r in rows])),'returnPp':float(np.mean([r['returnPp'] for r in rows])),
                         'missedCallShare':sum(r['missedCalls'] for r in rows)/sum(r['calls'] for r in rows)})
sens=[]
for family in ['latency','resting-price']:
    subset=[r for r in raw['sensitivity'] if r['family']==family]
    for latency in sorted({r['latencyMs'] for r in subset}):
        for m in ['batch10','batch5','continuous']:
            for c in ['10s','5s','event']:
                rows=[r for r in subset if r['latencyMs']==latency and r['matching']==m and r['cadence']==c]
                if rows:sens.append({'family':family,'latencyMs':latency,'matching':m,'cadence':c,'seeds':len(rows),**average(rows)})
result={'protocol':raw['protocol'],'generatedAt':raw['generatedAt'],'seeds':n,'sensitivitySeeds':raw['sensitivitySeeds'],
        'validation':raw['validation'],'totalMatches':sum(len(raw[k]) for k in ['production','factorial','sensitivity']),
        'groups':groups,'contrasts':contrasts,'production':prod,'sensitivity':sens}
(folder/'summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
labels={'batch10':'10 秒批量','batch5':'5 秒批量','continuous':'连续撮合','10s':'每 10 秒','5s':'每 5 秒','event':'事件驱动，最小 1 秒'}
lines=['# 交易轮次与交易频次实验','',f"固定设计 timing-v1，共 {result['totalMatches']:,} 场脚本模拟；主实验 {n} 组配对种子，敏感性 {raw['sensitivitySeeds']} 组。不是实测 LLM 响应速度或网络吞吐量。",'',
       '## 现有引擎：只改秒数与真正改变机会数是两件事','',
       '30 轮不变且订单按时返回时，5 秒、10 秒、60 秒的成交及最终现金在全部主实验种子中逐笔一致；比赛时长分别是 150 秒、300 秒、1800 秒。时间参数本身不改变经济计算。','',
       '固定为 300 秒，并让新闻仍每 10 秒发布后，生产引擎结果如下。此项同时改变决策次数、庄家刷新次数和订单过期次数，不能全归因于撮合速度。','',
       '| 每轮时长 | 轮数 | 平均成交份数 | 普通 Agent 平均最终收益率 |','|---|---:|---:|---:|']
for r in prod:
    if r['condition']=='fixed-duration':lines.append(f"| {r['periodMs']/1000:g} 秒 | {r['rounds']} | {r['volume']:.2f} | {r['returnPp']:.4f}% |")
lines+=['','## 同等新闻、资金、时长下的原型比较','',
        '主实验均为 300 秒、20 个普通 Agent、2 个标的、20% 庄家初始可交易现金；假设每次响应 1 秒加 0-0.5 秒个体偏移，再向上取整到 250ms。新闻与庄家都每 10 秒更新，订单统一 10 秒有效，可撤换。连续组到单即撮合；批量组在边界撮合。保持成交定价为交叉限价的中点，另测挂单价成交。','',
        '| 撮合机制 | 决策频次 | 平均成交份数 | 最后成交价偏离基本面 | 普通 Agent 最终收益率 | 每场决策调用数 | 每 1000 次调用成交份数 | 等待成交秒数 |',
        '|---|---|---:|---:|---:|---:|---:|---:|']
for g in groups:
    lines.append(f"| {labels[g['matching']]} | {labels[g['cadence']]} | {g['volume']:.2f} | {g['gapPct']:.3f}% | {g['returnPp']:.4f}% | {g['calls']:.1f} | {g['volume']/g['calls']*1000:.1f} | {g['waitSeconds']:.3f} |")
lines+=['','偏离为每 250ms 记录的最后成交价相对当时已公开基本面的绝对偏差，再取时间与标的平均；没有成交时沿用旧价，因此包含价格陈旧程度。等待时间为成交双方挂单后等待时间的成交份数加权平均，不包含推理时间。收益率按期末基本面兑付后的现金计算，分母是最初 30,000 DUSD 资产。该策略没有根据资金成本优化。','',
        '## 预设配对比较与不确定性','',
        '| 比较（处理减对照） | 成交份数差 [95% CI] | Holm p | 价格偏离差，百分点 [95% CI] | Holm p |',
        '|---|---:|---:|---:|---:|']
for row in contrasts:
    a=row['metrics']['volume'];b=row['metrics']['gapPct']
    lines.append(f"| {row['id']} | {a['delta']:+.2f} [{a['ci95'][0]:+.2f}, {a['ci95'][1]:+.2f}] | {a['holmP']:.4g} | {b['delta']:+.4f} [{b['ci95'][0]:+.4f}, {b['ci95'][1]:+.4f}] | {b['holmP']:.4g} |")
lines+=['','95% 区间为 10,000 次配对 bootstrap 的逐项区间；双侧配对 sign-flip 检验 19,999 次，依赖零假设下配对差的对称性近似。对四个比较的两项主指标统一做八项 Holm 校正。收益、调用次数和下述敏感性只作描述，不给其套用主检验的显著性。','',
        '## 响应延迟与成交价格规则敏感性','',
        '| 情景 | 撮合 | 决策频次 | 成交份数 | 价格偏离 | 最终收益率 | 调用数 |','|---|---|---|---:|---:|---:|---:|']
for g in sens:
    scenario=f"延迟 {g['latencyMs']/1000:g}s + 个体偏移" if g['family']=='latency' else '连续撮合按挂单价成交'
    lines.append(f"| {scenario} | {labels[g['matching']]} | {labels[g['cadence']]} | {g['volume']:.2f} | {g['gapPct']:.3f}% | {g['returnPp']:.4f}% | {g['calls']:.1f} |")
lines+=['','生产引擎另测 1/3/6 秒响应加个体偏移：6 秒响应时，5 秒轮次的下单全部超时，10 秒和 60 秒轮次没有超时。这里是按当前截止规则推算并跑出的结果，不能当作所有 LLM 的实测延迟。',
        '', '## 解释与实现边界','',
        '连续组是 scripts/timing-model.ts 中的离线候选机制，网站 Worker 没有切换为实时交易。它与生产轮次模式的撤单、有效期、同轮多次决定等规则不同；不能用两个不同层次的结果直接给生产系统排序。',
        '', '本实验的新闻、脚本策略、库存与费用条件固定，只有两个默认标的。真实 Agent 的消息处理、工具调用、推理费用、失败重试和网络抖动尚未实测；事件驱动调用数是成本负担的代理指标，不能换算为已证实的费用节省。真实时钟压缩也没有改变策略的思考能力。',
        '', '若研究目标是跨模型公平比较，建议固定总时长和每个 Agent 的决策预算，将决策、新闻和撮合时钟分开。10 秒决策加 5 秒批量撮合值得优先试点：与 10 秒决策加 10 秒撮合相比，调用数均为每场 600 次，成交量几乎不变，最后成交价偏离由 3.178% 降至 2.044%。这只是脚本原型中的描述性比较；该对比未列入预设显著性检验，10 秒也不是已证实的全局最优。现有生产引擎仍将这些时钟绑定在轮次上，落地需要另行修改。',
        '', '若目标是研究市场微观结构和速度策略，可增加独立连续撮合模式，但仍须有明确结束时间、新闻时钟、订单有效期、撤单规则和最终兑付规则。公平比赛需要预算约束，技术上不必强制所有动作等待同一个轮次边界。',
        '', '成交定价规则会改变价格质量判断。在相同前 50 组种子、每 5 秒决策下，连续撮合按中点成交时的偏离为 2.205%，改为挂单价成交则为 1.196%，对应 5 秒批量为 2.047%；不能据主实验断言批量在所有价格规则下更好。无论采用哪种连续定价，事件驱动调用较多、成交较多的现象均存在。此项为描述性敏感性分析。',
        '', '下一步可在真实 Agent 上验证事件驱动加明确调用预算，并测试更短的 1 秒批次；当前未测 1 秒批次或实际模型延迟。频繁批量拍卖处理微小速度优势的研究动机可参阅 [Budish 的金融市场设计研究](https://ericbudish.org/research/financial-markets/)，其统一价格拍卖与当前中点撮合不是同一种算法。',
        '', '## 复现','', 'node scripts/run-timing.mjs', '', 'python scripts/analyze-timing.py', '', 'npx vitest run --config vitest.timing.config.ts', '', '原始逐场结果 raw.json、汇总 summary.json、固定实验设计 methodology.md 位于同目录。任何正式实时切换都需要单独实现和上线验证。']
(folder/'results.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'matches':result['totalMatches'],'groups':groups,'production':prod,'contrasts':contrasts},ensure_ascii=False,indent=2))
