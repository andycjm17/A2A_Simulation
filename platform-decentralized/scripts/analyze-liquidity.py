"""Reproduce the predeclared match-level paired analysis. Requires numpy/scipy/matplotlib."""
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root = Path(__file__).resolve().parents[1]
source = root / 'experiments/raw.json'
raw = json.loads(source.read_text())
rows = raw['rows']
result = {'protocol': raw['protocol'], 'generatedAt': raw['generatedAt'], 'replication': 'complete match / paired seed', 'interval': 'pointwise paired bootstrap 95%; 10000 resamples', 'test': 'two-sided paired sign-flip; 19999 random draws; Holm family of 20 within population', 'scenarios': []}
rng = np.random.default_rng(20261028)
for population in [20, 10, 40]:
    subset = [r for r in rows if r['population'] == population]
    seeds = sorted({r['seed'] for r in subset})
    assert len(subset) == len(seeds) * 11
    lookup = {(r['seed'], round(r['share'], 2)): r for r in subset}
    assert len(lookup) == len(subset)
    for seed in seeds:
        assert len({lookup[seed, round(step/20,2)]['commitment'] for step in range(11)}) == 1
        for step in range(11):
            r=lookup[seed,round(step/20,2)]
            assert r['conservation'] and abs(r['actualCashShare']-r['share'])<1e-7
            # Independently reconcile ordinary excess return and maker transfer (DUSD).
            assert abs(r['excessReturnPp']/100*30000*population+r['makerExcessProfitDUSD']) < 1e-7
    bootstrap = rng.integers(0,len(seeds),size=(10000,len(seeds)))
    signs = rng.choice(np.array([-1,1],dtype=np.int8),size=(19999,len(seeds)))
    scenario={'population':population,'seeds':len(seeds),'exploratory':population!=20,'groups':[]}
    tests=[]
    for step in range(11):
        share=round(step/20,2)
        group={'share':share}
        for metric in ['volume','returnPp','excessReturnPp','medianReturnPp','notionalDUSD','makerVolumeShare','peerVolume','makerProfitDUSD']:
            values=np.array([lookup[seed,share][metric] for seed in seeds])
            baseline=np.array([lookup[seed,0][metric] for seed in seeds])
            delta=values-baseline
            group[metric]={'mean':float(values.mean()),'delta':float(delta.mean())}
            if metric in ['volume','returnPp']:
                ci=np.quantile(delta[bootstrap].mean(axis=1),[.025,.975])
                p=(1+np.count_nonzero(np.abs(signs@delta/len(seeds))>=abs(delta.mean())-1e-12))/20000 if step else 1.0
                group[metric].update(ci=[float(x) for x in ci],p=float(p))
                if step: tests.append((p,group[metric]))
        scenario['groups'].append(group)
    running=0
    for rank,(p,cell) in enumerate(sorted(tests,key=lambda x:x[0])):
        running=max(running,min(1,p*(len(tests)-rank)))
        cell['holmP']=running
    result['scenarios'].append(scenario)
(root/'experiments/summary.json').write_text(json.dumps(result,indent=2)+'\n')
primary=result['scenarios'][0]; groups=primary['groups']
lines=['# 庄家初始现金比例实验结果','',f"同一生产撮合引擎；主实验 {primary['seeds']} 组配对种子、20 名普通 Agent、30 轮、2 种资产。另做 10/40 人市场各 100 组配对种子。共 {len(rows):,} 场完整模拟。",'', '资金比例为庄家占全市场初始可交易现金的比例。其他参与者资产不变，庄家资金和库存额外配置。收益为普通 Agent 平均最终净资产收益率；下表收益差单位为百分点。','', '| 庄家现金占比 | 平均成交份数 | 比无庄家增加 | 普通 Agent 收益差 [95% CI] | 庄家实际成交占比 |', '|---:|---:|---:|---:|---:|']
for g in groups:
    v=g['volume']; r=g['returnPp']; ci=r['ci']
    lines.append(f"| {g['share']:.0%} | {v['mean']:.1f} | {v['delta']:+.1f} | {r['delta']:+.4f} [{ci[0]:+.4f}, {ci[1]:+.4f}] | {g['makerVolumeShare']['mean']:.1%} |")
lines += ['', f"10 个比例中，成交量显著增加的有 {sum(g['volume']['delta']>0 and g['volume']['holmP']<.05 for g in groups[1:])} 个，普通参与者收益显著降低的有 {sum(g['returnPp']['delta']<0 and g['returnPp']['holmP']<.05 for g in groups[1:])} 个，同时显著改善两项指标的有 {sum(g['volume']['delta']>0 and g['volume']['holmP']<.05 and g['returnPp']['delta']>0 and g['returnPp']['holmP']<.05 for g in groups[1:])} 个。20% 配置成交量比无庄家增加 {groups[4]['volume']['delta']/groups[0]['volume']['mean']*100:.2f}%，普通参与者平均收益变化 {groups[4]['returnPp']['delta']:+.4f} 个百分点，95% CI [{groups[4]['returnPp']['ci'][0]:+.4f}, {groups[4]['returnPp']['ci'][1]:+.4f}]；两项比较校正后 p 值分别为 {groups[4]['volume']['holmP']:.4g}、{groups[4]['returnPp']['holmP']:.4g}。比例之间没有做最优性检验，均值趋势不能证明某个比例唯一最优。", '', '主实验的 20 个比较统一做 Holm 多重检验校正；95% 区间为逐项配对 bootstrap 区间，不是同时置信区间。测试单位为整场比赛。显著性检验为双侧配对 sign-flip（19,999 次随机符号翻转），依赖零假设下配对差的对称性近似。固定种子可复现，p 值分辨率为 0.00005。', '', '## 解释范围', '', '普通参与者没有使用真实 LLM，而是固定比例的基本面、噪声和动量脚本。结果仅代表这些行为、新闻和报价参数下的模拟。新闻涨跌造成的持仓收益在配对比较中抵消；庄家与普通参与者相对同一买入持有基准的超额收益之和严格为零。成交量增加不意味着普通参与者收益增加，也不等同于真实市场流动性改善。', '', '完整预先固定的方法见 [methodology.md](methodology.md)，逐场结果见 [raw.json](raw.json)，全部效应、区间、校正后 p 值及 10/40 人敏感性结果见 [summary.json](summary.json)。分析脚本为 `scripts/analyze-liquidity.py`；模拟脚本为 `scripts/liquidity-experiment.ts`。']
(root/'experiments/results.md').write_text('\n'.join(lines)+'\n')
fig,axes=plt.subplots(1,2,figsize=(11.5,4.4),layout='constrained')
x=np.array([g['share']*100 for g in groups])
for ax,metric,title,color in zip(axes,['volume','returnPp'],['Executed volume change vs no maker','Ordinary-agent return change vs no maker'],['#24745b','#a44e37']):
    y=np.array([g[metric]['delta'] for g in groups]); ci=np.array([g[metric]['ci'] for g in groups])
    ax.errorbar(x,y,yerr=[y-ci[:,0],ci[:,1]-y],color=color,marker='o',capsize=3,lw=1.6)
    ax.axhline(0,color='#888',lw=.8); ax.set_title(title,fontsize=11,loc='left',pad=14)
    ax.set_xlabel('Maker share of initial tradable cash (%)'); ax.set_xticks(x); ax.grid(axis='y',alpha=.18)
    ax.spines[['top','right']].set_visible(False)
axes[0].set_ylabel('Units per match (both assets; counted once)');axes[1].set_ylabel('Percentage points of initial equity')
fig.suptitle('20 ordinary agents · 200 paired seeds · 30 rounds · pointwise 95% bootstrap CI',fontsize=11)
fig.savefig(root/'experiments/capital-effects.png',dpi=180)
print(json.dumps({'matches':len(rows),'primary':[{k:g[k] for k in ['share','volume','returnPp','makerVolumeShare']} for g in groups]},indent=2))
