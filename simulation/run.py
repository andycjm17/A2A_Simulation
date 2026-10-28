"""Run 100 reset rounds in 20 independent, valuation-balanced blocks."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import random
import sys

from agents import Agent, DESCRIPTIONS, STRATEGIES, View
from market import Market


def seed_for(*parts):
    return int.from_bytes(hashlib.sha256('|'.join(map(str, parts)).encode()).digest()[:8], 'big')


def run(seed=20260911, rounds=100, ticks=80, homogeneous=False):
    if rounds % 5:
        raise ValueError('Rounds must be divisible by 5 for balanced valuations')
    ids = STRATEGIES
    records, trade_rows, event_rows, diagnostics = [], [], [], []
    for block in range(rounds // 5):
        rng = random.Random(seed_for(seed, 'block', block))
        seats = list(range(10))
        rng.shuffle(seats)
        phases = list(range(5))
        rng.shuffle(phases)
        for offset, phase in enumerate(phases):
            round_id = block * 5 + offset + 1
            values = {agent: [8, 8, 10, 12, 12][(seats[i] + phase) % 5] for i, agent in enumerate(ids)}
            market = Market(ids)
            agents = {a: Agent('value_taker' if homogeneous else a,
                               random.Random(seed_for(seed, round_id, a))) for a in ids}
            schedule_rng = random.Random(seed_for(seed, 'schedule', round_id))
            rejections = Counter()
            for tick in range(ticks):
                market.tick = tick
                schedule = list(ids)
                schedule_rng.shuffle(schedule)
                for agent_id in schedule:
                    market.cancel_all(agent_id)
                    account = market.accounts[agent_id]
                    bids = tuple(sorted(((o.price, o.remaining) for o in market.orders.values()
                                         if o.side == 'buy'), reverse=True))
                    asks = tuple(sorted((o.price, o.remaining) for o in market.orders.values() if o.side == 'sell'))
                    view = View(values[agent_id], account.cash, account.inventory, bids, asks,
                                tuple(t['price'] for t in market.trades[-20:]), tick / (ticks - 1))
                    for index, (side, price, quantity) in enumerate(agents[agent_id].decide(view)):
                        try:
                            market.submit(agent_id, side, price, quantity, f'{tick}:{index}')
                        except ValueError as exc:
                            rejections[str(exc)] += 1
            market.close()
            # Independent replay from executions, not engine balance-update helpers.
            replay = {a: [1000, 10] for a in ids}
            score_from_trades = Counter()
            bought, sold, counts = Counter(), Counter(), Counter()
            for trade in market.trades:
                buyer, seller, qty, price = trade['buyer'], trade['seller'], trade['quantity'], trade['price']
                assert buyer != seller
                replay[buyer][0] -= price * qty
                replay[buyer][1] += qty
                replay[seller][0] += price * qty
                replay[seller][1] -= qty
                score_from_trades[buyer] += (values[buyer] - price) * qty
                score_from_trades[seller] += (price - values[seller]) * qty
                bought[buyer] += qty
                sold[seller] += qty
                counts[buyer] += 1
                counts[seller] += 1
                trade_rows.append(dict(round=round_id, block=block + 1, **trade))
            scores = {}
            for agent_id, account in market.accounts.items():
                value = values[agent_id]
                score = account.cash + account.inventory * value - (1000 + 10 * value)
                assert [account.cash, account.inventory] == replay[agent_id]
                assert score == score_from_trades[agent_id]
                scores[agent_id] = score
                records.append(dict(round=round_id, block=block + 1, agent=agent_id, value=value,
                                    score=score, end_cash=account.cash, end_inventory=account.inventory,
                                    bought=bought[agent_id], sold=sold[agent_id], trades=counts[agent_id]))
            surplus = sum((values[t['buyer']] - values[t['seller']]) * t['quantity'] for t in market.trades)
            assert surplus == sum(scores.values())
            # Upper bound: allocate all inventory to agents with highest value, ignoring financing.
            upper_bound = 100 * max(values.values()) - sum(10 * v for v in values.values())
            assert surplus <= upper_bound
            diagnostics.append(dict(round=round_id, trades=len(market.trades),
                                    volume=sum(t['quantity'] for t in market.trades),
                                    surplus=surplus, upper_bound=upper_bound,
                                    last_trade_tick=market.trades[-1]['tick'] if market.trades else None,
                                    late_trade_share=sum(t['tick'] >= ticks * .75 for t in market.trades)
                                       / max(1, len(market.trades)), rejections=dict(rejections)))
            event_rows.extend(dict(round=round_id, **event) for event in market.events)
        print(f'Completed {5 * (block + 1)}/{rounds} rounds', flush=True)
    for agent_id in ids:
        assert Counter(r['value'] for r in records if r['agent'] == agent_id) == {
            8: rounds * 2 // 5, 10: rounds // 5, 12: rounds * 2 // 5}
    return records, trade_rows, event_rows, diagnostics


def write_jsonl(path, rows):
    with path.open('w') as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False) + '\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--seed', type=int, default=20260911)
    parser.add_argument('--rounds', type=int, default=100)
    parser.add_argument('--ticks', type=int, default=80)
    parser.add_argument('--homogeneous', action='store_true')
    parser.add_argument('--output', type=Path, default=Path('results/main'))
    args = parser.parse_args()
    if args.ticks < 2:
        parser.error('ticks must be at least 2')
    args.output.mkdir(parents=True, exist_ok=True)
    if (args.output / 'manifest.json').exists():
        parser.error('Output already exists; choose a new directory to preserve prior evidence')
    records, trades, events, diagnostics = run(args.seed, args.rounds, args.ticks, args.homogeneous)
    files = {'rounds.jsonl': records, 'trades.jsonl': trades, 'events.jsonl': events,
             'market_diagnostics.jsonl': diagnostics}
    for name, rows in files.items():
        write_jsonl(args.output / name, rows)
    manifest = dict(seed=args.seed, rounds=args.rounds, ticks=args.ticks, block_size=5,
                    homogeneous=args.homogeneous, python=sys.version, strategies=DESCRIPTIONS,
                    source_hashes={p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                                   for p in Path(__file__).parent.glob('*.py')},
                    output_hashes={name: hashlib.sha256((args.output / name).read_bytes()).hexdigest()
                                   for name in files},
                    checks='Every operation: cash/inventory conservation and reservations. Every round: independent trade replay, score reconciliation, surplus bound. Balanced valuations verified.')
    (args.output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps(dict(output=str(args.output), rounds=len(diagnostics), records=len(records),
                          trades=len(trades), events=len(events)), ensure_ascii=False))


if __name__ == '__main__':
    main()
