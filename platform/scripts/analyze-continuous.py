"""Paired, complete-match analysis for continuous-v2; requires numpy only."""
import json,hashlib
from pathlib import Path
import numpy as np

root=Path(__file__).resolve().parents[1];folder=root/'experiments/continuous'
raw=json.loads((folder/'raw.json').read_text());n=raw['seeds']
for file,sha in raw['codeHashes'].items():assert hashlib.sha256((root/file).read_bytes()).hexdigest()==sha,file
metrics=['volume','meanCashDUSD','excessReturnPp','gapPct','calls','arrivedCalls','closePendingCalls','orders','cancelled','makerUpdates','makerVolumeShare','passiveWaitSeconds','processedEvents','fastMeanCashDUSD','slowMeanCashDUSD']
triggers=['timer10','timer5','targeted','market','serial']
lookup={(r['seed'],r['trigger']):r for r in raw['primary']}
assert len(lookup)==len(raw['primary'])==n*len(triggers)
for seed in range(n):
    cells=[lookup[seed,t] for t in triggers]
    assert len({tuple(r['terminal']) for r in cells})==1
    assert len({r['newsCount'] for r in cells})==1
    assert len({r['tapeHash'] for r in cells})==1
for r in raw['primary']+raw['sensitivity']:
    assert r['conservation'] and r['artificialMatchingWaitMs']==0
    assert r['calls']-r['arrivedCalls']==r['closePendingCalls']<=20
    assert abs(np.mean(r['finalCash'])/100-r['meanCashDUSD'])<1e-8
    assert abs((r['meanCashDUSD']-30000)/30000*100-r['returnPp'])<1e-9
    if r['ttlMs'] is None:assert r['expired']==0
def avg(rows):return {metric:float(np.mean([r[metric] for r in rows])) for metric in metrics}
groups=[{'trigger':t,**avg([lookup[i,t] for i in range(n)])} for t in triggers]
comparisons=[('timer5-v-timer10','timer5','timer10'),('targeted-v-timer10','targeted','timer10'),('market-v-targeted','market','targeted'),('serial-v-targeted','serial','targeted')]
rng=np.random.default_rng(2026102803);boot=rng.integers(0,n,size=(10000,n));signs=rng.choice([-1,1],size=(19999,n))
contrasts=[];tests=[]
for label,treatment,baseline in comparisons:
    row={'id':label,'treatment':treatment,'baseline':baseline,'metrics':{}}
    for metric in metrics:
        a=np.array([lookup[i,treatment][metric] for i in range(n)]);b=np.array([lookup[i,baseline][metric] for i in range(n)]);delta=a-b
        cell={'treatment':float(a.mean()),'baseline':float(b.mean()),'delta':float(delta.mean())}
        if metric in ['volume','meanCashDUSD','gapPct']:
            cell['ci95']=np.quantile(delta[boot].mean(axis=1),[.025,.975]).tolist()
            cell['p']=float((1+np.count_nonzero(np.abs(signs@delta/n)>=abs(delta.mean())-1e-12))/20000)
            tests.append(cell)
        row['metrics'][metric]=cell
    contrasts.append(row)
running=0
for rank,cell in enumerate(sorted(tests,key=lambda c:c['p'])):
    running=max(running,min(1,cell['p']*(len(tests)-rank)));cell['holmP']=running
sensitivity=[]
for family in sorted({r['family'] for r in raw['sensitivity']}):
    for trigger in triggers:
        rows=[r for r in raw['sensitivity'] if r['family']==family and r['trigger']==trigger]
        if rows:sensitivity.append({'family':family,'trigger':trigger,'seeds':len(rows),**avg(rows)})
result={'protocol':raw['protocol'],'generatedAt':raw['generatedAt'],'seeds':n,'sensitivitySeeds':raw['sensitivitySeeds'],'totalMatches':len(raw['primary'])+len(raw['sensitivity']),'groups':groups,'contrasts':contrasts,'sensitivity':sensitivity,'validation':raw['validation']}
(folder/'summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
names={'timer10':'每 10 秒自行决策','timer5':'每 5 秒自行决策','targeted':'新闻或自身成交触发','market':'新闻、成交和盘口变化触发','serial':'返回后立即再次决策'}
lines=['# 无撮合周期的连续交易实验','',f"continuous-v2：{result['totalMatches']:,} 场离线脚本模拟，主实验 {n} 个配对种子，敏感性 {raw['sensitivitySeeds']} 个种子。不是实际 LLM、网络延迟或线上吞吐量实测。",'',
       '## 实验中的“无撮合时间”','',
       '取消集中撮合时刻、固定撮合频率与交易轮次。新订单到达即检查对手盘，按价格优先、同价时间优先成交，使用被吃掉的挂单价格。不能成交的部分继续挂单，直至成交、撤单或实验结束。即时撮合不保证即时成交，也不表示计算和通信没有延迟。',
       '', '本次也去掉上一版实时原型中的 250ms 全局步长、10 秒定期庄家刷新与默认 10 秒订单过期。新闻随机异步到达，庄家在新闻或自身成交后反应；时间队列仅推进至下一事件，不定时扫描盘口来撮合。所有成交均断言与触发订单到达的时间戳一致，收盘也不额外集中撮合。',
       '', '共同条件：每场 300 秒、20 个普通 Agent、两个标的、庄家初始可交易现金占比 20%。普通 Agent 开始持有 10000 DUSD 与两标的各 100 份；末期按最后公开基本面兑付。主实验每次响应假设 0.8-1.2 秒推理加 20-100ms 提交，庄家反应 100-125ms。这些是输入假设，不是观测延迟。',
       '', '## 主实验结果','',
       '| Agent 决策方式（撮合均即时） | 成交份数 | 普通 Agent 平均期末现金 DUSD | 相对不交易收益差，百分点 | 价格偏离 | 决策调用数 | 订单数 |',
       '|---|---:|---:|---:|---:|---:|---:|']
for g in groups:lines.append(f"| {names[g['trigger']]} | {g['volume']:.1f} | {g['meanCashDUSD']:.2f} | {g['excessReturnPp']:+.4f} | {g['gapPct']:.3f}% | {g['calls']:.1f} | {g['orders']:.1f} |")
lines+=['', '成交量每份只计一次；价格偏离为最后成交价对当前公开基本面的绝对相对差，按真实事件间隔做时间加权；无成交时保留旧价。相对不交易收益使用相同新闻和初始持仓的买入持有基准，分母是 30000 DUSD 初始资产。决策调用数是脚本计数，不能当作实测 API 费用。',
        '', '“事件触发”也可能产生高频反馈：成交后再决策、形成新订单、再次成交。全盘口通知尤其可能接近持续循环，因此“取消定时撮合”不等于“让每条行情都触发一次大模型”。这是本脚本的行为机制，需要结合下表量化，不能推广为所有真实 Agent 的必然结果。',
        '', '## 配对效应与区间','',
        '| 处理减对照 | 成交份数差 [95% CI] | 平均现金差 DUSD [95% CI] | 价格偏离差，百分点 [95% CI] |',
        '|---|---:|---:|---:|']
for c in contrasts:
    cells=[]
    for metric in ['volume','meanCashDUSD','gapPct']:
        x=c['metrics'][metric];d=3 if metric=='gapPct' else 2;cells.append(f"{x['delta']:+.{d}f} [{x['ci95'][0]:+.{d}f}, {x['ci95'][1]:+.{d}f}]")
    lines.append('| '+c['id']+' | '+' | '.join(cells)+' |')
lines+=['', '区间为 10000 次完整比赛配对 bootstrap 的逐项 95% 区间。双侧配对 sign-flip（19999 次）依赖对称零假设近似，四个对比乘三项主指标统一做 12 项 Holm 校正；完整 p 值在 summary.json，区间不是同时区间。敏感性只作描述。',
        '', '## 敏感性','',
        '| 情景 | Agent 决策方式 | 成交份数 | 平均期末现金 DUSD | 价格偏离 | 调用数 | 快组减慢组现金 DUSD |',
        '|---|---|---:|---:|---:|---:|---:|']
families={'slow-agents':'推理基准 3 秒','heterogeneous':'快组 0.25 秒、慢组 3 秒','ttl30':'订单 30 秒过期','slow-maker':'庄家反应 1-1.25 秒','market-cooldown':'盘口事件决策最小间隔 1 秒','targeted-cancel-news':'收到新闻先撤单、再推理'}
for g in sensitivity:lines.append(f"| {families[g['family']]} | {names[g['trigger']]} | {g['volume']:.1f} | {g['meanCashDUSD']:.2f} | {g['gapPct']:.3f}% | {g['calls']:.1f} | {g['fastMeanCashDUSD']-g['slowMeanCashDUSD']:+.2f} |")
lines+=['', '快慢组现金差仅在 heterogeneous 行有速度处理含义；其余行分组只是相同预先分配，不能解释为速度效应。快慢组在五种策略内平衡，配对新闻相同。',
        '', '## 设计边界与后续','',
        '可取消每轮只能提交一次的产品规则，将订单接收和逐笔撮合放在同一个串行状态变更中，继续保留现金与股票预占、防自成交、撤单、订单编号和重试幂等。交易轮次可退为展示与统计窗口；比赛结束时间、排名和最终兑付仍需明确。',
        '', '主实验只比较无撮合周期下的 Agent 行动策略，不再证明上一版批量撮合与连续撮合孰优。新版本改变新闻时钟、报价响应、订单有效期和定价，不能将新旧实验的绝对成交量直接拼接比较。',
        '', '普通策略的买卖方向和报价扰动仍是脚本，并没有优化收益；高速策略可能增加交易和资金转移，却不能证明真实聪明 Agent 会这样行动。庄家比普通 Agent 更快是一项明确假设，慢庄家敏感性用于检查这个依赖。真实 LLM 推理、消息吞吐、断线恢复、市场化策略和真实费用尚未测量。',
        '', '参考：[Coinbase 官方撮合机制](https://docs.cdp.coinbase.com/exchange/concepts/matching-engine)说明连续订单簿、价格时间优先、挂单价格成交和未成交订单保留。本原型采用这些核心原则，不是完整交易所实现。',
        '', '## 复现与状态','',
        'node scripts/run-continuous.mjs', '', 'python scripts/analyze-continuous.py', '', 'npx vitest run --config vitest.continuous.config.ts', '',
        '代码：scripts/continuous-model.ts 与 continuous-experiment.ts。原始逐场数据及新闻承诺：raw.json；统计汇总：summary.json；运行前设计：methodology.md。生产 Worker 未导入该原型；此次实验没有上线切换交易机制。']
(folder/'results.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'matches':result['totalMatches'],'groups':groups,'contrasts':contrasts,'sensitivity':sensitivity},ensure_ascii=False,indent=2))
