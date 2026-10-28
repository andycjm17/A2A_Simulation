"""Block-aware inference for a fixed 100-round, ten-strategy tournament."""
import argparse
from collections import Counter
import hashlib
import itertools
import json
from pathlib import Path

import numpy as np

from agents import DESCRIPTIONS, STRATEGIES


def read_jsonl(path):
    with path.open() as stream:
        return [json.loads(line) for line in stream]


def ranks(values):
    order = np.argsort(values, kind='stable')
    result = np.zeros(len(values), dtype=float)
    start = 0
    while start < len(values):
        end = start + 1
        while end < len(values) and values[order[end]] == values[order[start]]:
            end += 1
        result[order[start:end]] = (start + 1 + end) / 2
        start = end
    return result


def friedman_permutation(blocks, rng, n_permutations=20000):
    n, k = blocks.shape
    ranked = np.stack([ranks(row) for row in blocks])
    ties = sum(sum(count ** 3 - count for count in Counter(row).values()) for row in blocks)
    correction = 1 - ties / (n * (k ** 3 - k))
    if correction == 0:
        return dict(statistic=0, p=1, kendall_w=0, permutations=n_permutations)
    def statistic(total_ranks):
        return (12 / (n * k * (k + 1)) * np.sum(total_ranks ** 2, axis=-1)
                - 3 * n * (k + 1)) / correction
    observed = float(statistic(ranked.sum(axis=0)))
    exceed = 0
    for start in range(0, n_permutations, 1000):
        size = min(1000, n_permutations - start)
        indices = rng.random((size, n, k)).argsort(axis=-1)
        permuted = np.take_along_axis(np.broadcast_to(ranked, (size, n, k)), indices, axis=2)
        exceed += int(np.count_nonzero(statistic(permuted.sum(axis=1)) >= observed - 1e-10))
    return dict(statistic=observed, p=(exceed + 1) / (n_permutations + 1),
                kendall_w=observed / (n * (k - 1)), permutations=n_permutations)


def exact_sign_flip(differences):
    # Integer block score sums avoid floating-point ties in the exact null.
    differences = np.asarray(differences, dtype=np.int64)
    sums = np.array([0], dtype=np.int64)
    for difference in differences:
        sums = np.concatenate((sums + difference, sums - difference))
    return float(np.mean(np.abs(sums) >= abs(differences.sum())))


def holm(pvalues):
    order = np.argsort(pvalues)
    adjusted = np.zeros(len(order))
    previous = 0
    for position, index in enumerate(order):
        previous = max(previous, min(1, (len(order) - position) * pvalues[index]))
        adjusted[index] = previous
    return adjusted


def analyze(directory, bootstrap_samples=20000):
    manifest = json.loads((directory / 'manifest.json').read_text())
    for name, expected in manifest['output_hashes'].items():
        assert hashlib.sha256((directory / name).read_bytes()).hexdigest() == expected
    rows = read_jsonl(directory / 'rounds.jsonl')
    market = read_jsonl(directory / 'market_diagnostics.jsonl')
    nrounds = manifest['rounds']
    ids = STRATEGIES
    keyed = {(row['round'], row['agent']): row for row in rows}
    assert len(keyed) == len(rows) == nrounds * len(ids)
    scores = np.array([[keyed[(r, a)]['score'] for a in ids] for r in range(1, nrounds + 1)], dtype=np.int64)
    block_sums = scores.reshape(-1, 5, len(ids)).sum(axis=1)
    block_means = block_sums / 5
    rng = np.random.default_rng(manifest['seed'] + 100)
    indices = rng.integers(0, len(block_sums), (bootstrap_samples, len(block_sums)))
    bootstrap = block_means[indices].mean(axis=1)
    ci = np.quantile(bootstrap, [.025, .975], axis=0)
    top = bootstrap == bootstrap.max(axis=1, keepdims=True)
    top_share = (top / top.sum(axis=1, keepdims=True)).mean(axis=0)
    stats = friedman_permutation(block_sums, np.random.default_rng(manifest['seed'] + 200))
    rational = friedman_permutation(block_sums[:, :8], np.random.default_rng(manifest['seed'] + 300))
    pairs = []
    for i, j in itertools.combinations(range(len(ids)), 2):
        d = block_sums[:, i] - block_sums[:, j]
        interval = np.quantile(bootstrap[:, i] - bootstrap[:, j], [.025, .975])
        sd = float(np.std(d / 5, ddof=1))
        pairs.append(dict(a=ids[i], b=ids[j], mean_difference=float(d.mean() / 5),
                          ci95=[float(x) for x in interval], p=exact_sign_flip(d),
                          dz=float(d.mean() / 5 / sd) if sd else None,
                          block_win_rate=float(np.mean(d > 0))))
    for pair, adjusted in zip(pairs, holm([p['p'] for p in pairs])):
        pair.update(p_holm=float(adjusted), significant=bool(adjusted < .05))
    leaderboard = []
    for index, agent in enumerate(ids):
        agent_rows = [row for row in rows if row['agent'] == agent]
        display_name = f'同策略账户{index + 1:02d}' if manifest['homogeneous'] else DESCRIPTIONS[agent][0]
        description = DESCRIPTIONS['value_taker'][1] if manifest['homogeneous'] else DESCRIPTIONS[agent][1]
        leaderboard.append(dict(agent=agent, name=display_name, strategy=description,
                                total=int(scores[:, index].sum()), mean=float(scores[:, index].mean()),
                                ci95=[float(x) for x in ci[:, index]],
                                positive_rounds=int(np.sum(scores[:, index] > 0)),
                                negative_rounds=int(np.sum(scores[:, index] < 0)),
                                trades=sum(r['trades'] for r in agent_rows),
                                volume=sum(r['bought'] + r['sold'] for r in agent_rows),
                                bootstrap_top_share=float(top_share[index]),
                                by_value={str(v): float(np.mean([r['score'] for r in agent_rows if r['value'] == v]))
                                          for v in (8, 10, 12)}))
    leaderboard.sort(key=lambda row: -row['total'])
    for row in leaderboard:
        row['rank'] = 1 + sum(other['total'] > row['total'] for other in leaderboard)
    split = nrounds // 2
    halves = {label: [ids[i] for i in np.argsort(-matrix.sum(axis=0))]
              for label, matrix in [('first', scores[:split]), ('second', scores[split:])]}
    result = dict(synthetic=True, homogeneous=manifest['homogeneous'], seed=manifest['seed'],
                  rounds=nrounds, independent_blocks=len(block_sums), bootstrap_samples=bootstrap_samples,
                  leaderboard=leaderboard, omnibus=stats, excluding_baselines_exploratory=rational,
                  pairwise=pairs, significant_pairs=sum(p['significant'] for p in pairs),
                  half_rankings=halves, market=dict(trades=sum(r['trades'] for r in market),
                    volume=sum(r['volume'] for r in market),
                    mean_surplus=float(np.mean([r['surplus'] for r in market])),
                    efficiency=float(sum(r['surplus'] for r in market) / sum(r['upper_bound'] for r in market)),
                    late_trade_share=float(sum(r['late_trade_share'] * r['trades'] for r in market)
                                          / max(1, sum(r['trades'] for r in market))),
                    rejections=dict(sum((Counter(r['rejections']) for r in market), Counter()))),
                  analysis_source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  numpy_version=np.__version__,
                  assumptions=['Synthetic fixed opponent pool; no LLMs or network latency.',
                               'Independent unit is a 5-round block, not a trade or an agent-row.',
                               'Permutation tests require exchangeability under the null; sign flips require symmetric/exchangeable paired differences.',
                               '95% bootstrap intervals are pointwise; 45 pairwise p-values are Holm-corrected.',
                               'Bootstrap first-place share is resampling stability, not future winning probability.'])
    (directory / 'analysis.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    lines = ['# 100轮模拟交易结果', '',
             f"合成市场；种子 {manifest['seed']}；{nrounds}轮，{len(block_sums)}个独立均衡区组；同策略对照={manifest['homogeneous']}。", '',
             '| 名次 | 策略 | 总收益 sUSD | 均值/轮 | 均值95%区间 | 正收益轮 | 重采样第一占比 |',
             '|---:|---|---:|---:|---|---:|---:|']
    for row in leaderboard:
        lines.append(f"|{row['rank']}|{row['name']}|{row['total']}|{row['mean']:.2f}|[{row['ci95'][0]:.2f}, {row['ci95'][1]:.2f}]|{row['positive_rounds']}/{nrounds}|{row['bootstrap_top_share']:.1%}|")
    lines += ['', f"全局置换Friedman：Q={stats['statistic']:.3f}，p={stats['p']:.8f}，Kendall W={stats['kendall_w']:.3f}。",
              f"全部45对比较，Holm校正后显著的有 {result['significant_pairs']} 对。",
              f"剔除随机与不交易基线后，8策略探索性全局p={rational['p']:.8f}。", '',
              f"总成交 {result['market']['trades']} 笔；成交量 {result['market']['volume']}；理论盈余上限实现率 {result['market']['efficiency']:.1%}。", '',
              '## 全部两两比较', '', '| A | B | A−B 均值/轮 | 95%区间 | 双侧p | Holm p | 显著 |', '|---|---|---:|---|---:|---:|---|']
    names = {row['agent']: row['name'] for row in leaderboard}
    for pair in pairs:
        lines.append(f"|{names[pair['a']]}|{names[pair['b']]}|{pair['mean_difference']:.2f}|[{pair['ci95'][0]:.2f}, {pair['ci95'][1]:.2f}]|{pair['p']:.8f}|{pair['p_holm']:.8f}|{'是' if pair['significant'] else '否'}|")
    lines += ['', '注意：不显著不等于等效；置信区间未经多重校正。每个策略只有一个实现，结论仅适用于当前规则和对手组合。',
              '同策略对照中的策略名称只是保留的账户标签，实际均执行value_taker。', '',
              '方法与条件见 ../../simulation/EXPERIMENT.md。原始轮次结果、成交、事件和运行hash在本目录。']
    (directory / 'RESULTS.md').write_text('\n'.join(lines) + '\n')
    print(json.dumps({key: result[key] for key in ('homogeneous', 'omnibus', 'significant_pairs', 'half_rankings', 'market', 'leaderboard')}, ensure_ascii=False, indent=2))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    arguments = parser.parse_args()
    analyze(arguments.directory)
