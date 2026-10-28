"""Project reviewed local outputs into small inline chart/receipt payloads."""
import json
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent.parent
    main_result = json.loads((root / 'results/main/analysis.json').read_text())
    control = json.loads((root / 'results/control/analysis.json').read_text())
    rows = [dict(strategy=r['name'], total=r['total']) for r in main_result['leaderboard']]
    source = dict(label='本地100轮合成市场实验', files=[{'label': 'results/main/analysis.json'},
                    {'label': 'results/main/rounds.jsonl'}, {'label': 'simulation/agents.py'}],
                  caveats=['10个程序化Agent，不使用LLM；仅适用于本次市场规则与对手组合。',
                           '总收益为100轮重置实验的得分之和，不是真实美元或复利。'])
    chart = dict(schemaVersion=1, id='agent-leaderboard', title='10个Agent · 100轮累计收益（模拟数据）',
                 chart=dict(type='horizontalBar', x='strategy', y='total', xLabel='Agent策略',
                            yLabel='累计收益（sUSD）', showValues=True, showLegend=False, startAtZero=True),
                 rows=rows, source=source, height=500, theme='codex-classic')
    rank_sources = dict(schemaVersion=1, items=[dict(id='leaderboard-result', title='100轮策略排行榜',
                         queries=[dict(id='main-leaderboard', source=source, rows=rows,
                                       columns=[{'field': 'strategy', 'label': '策略'}, {'field': 'total', 'label': '累计收益 sUSD'}],
                                       reportingPeriod='主实验第1–100轮')])])
    statistic_rows = [dict(experiment='10种不同策略', p=main_result['omnibus']['p'],
                           significant_pairs=main_result['significant_pairs']),
                      dict(experiment='10个同策略账户', p=control['omnibus']['p'],
                           significant_pairs=control['significant_pairs'])]
    inference = dict(schemaVersion=1, items=[dict(id='statistical-differences', title='策略差异与同策略对照', queries=[
        dict(id='statistical-results', source=dict(label='主实验与独立对照统计',
             files=[{'label': 'results/main/analysis.json'}, {'label': 'results/control/analysis.json'},
                    {'label': 'simulation/analyze.py'}, {'label': 'simulation/EXPERIMENT.md'}],
             caveats=['以20个五轮区组为独立单位；全局检验为20,000次区组内置换。',
                      '45对配对检验采用精确符号翻转和Holm校正；推断依赖零假设下可交换性。',
                      '第一名对第二、第三名均未达到校正后的显著性；不显著不代表等效。']),
             rows=statistic_rows, columns=['experiment', 'p', 'significant_pairs'])]),
        dict(id='static-market-limit', title='静态市场的持续交易限制', queries=[dict(id='market-activity',
             source=dict(label='主实验与对照逐轮市场日志', files=[{'label':'results/main/market_diagnostics.jsonl'},
                 {'label':'results/control/market_diagnostics.jsonl'}],
                 caveats=['离散决策时刻不等于真实秒数；对照是全部使用value_taker的一种对手组成。']),
             rows=[dict(experiment='同策略对照', median_last_tick=6, max_last_tick=7, ticks_per_round=80)],
             columns=['experiment','median_last_tick','max_last_tick','ticks_per_round'])])])
    for filename, payload in [('leaderboard-chart.json', chart), ('leaderboard-sources.json', rank_sources),
                              ('inference-sources.json', inference)]:
        (root / 'results' / filename).write_text(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
