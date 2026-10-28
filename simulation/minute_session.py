"""30 one-minute call auctions. Explicit clock; no network/LLM implementation."""
from dataclasses import asdict, dataclass
import argparse
import hashlib
import json
from pathlib import Path
import random
import time

from agents import Agent, STRATEGIES, DESCRIPTIONS, View
from run import seed_for


@dataclass(frozen=True)
class Decision:
    round_id: int
    side: str  # buy, sell, or pass
    price: int = 0
    quantity: int = 0


class MinuteSession:
    def __init__(self, seed=20260911, minutes=30, started_at=0.0):
        if type(minutes) is not int or minutes < 30 or minutes % 5:
            raise ValueError('Use at least 30 rounds, divisible by 5')
        self.seed, self.minutes, self.started_at = seed, minutes, started_at
        self.round_id = 1
        self.decisions = {}
        self.requests = {}
        self.rounds = []
        self.trades = []
        self.scores = {agent: 0 for agent in STRATEGIES}
        self.valuations = []
        self.priority = []
        for block in range(minutes // 5):
            rng = random.Random(seed_for(seed, 'minute-roles', block))
            seats = list(range(10))
            phases = list(range(5))
            rng.shuffle(seats)
            rng.shuffle(phases)
            for phase in phases:
                self.valuations.append({agent: [8, 8, 10, 12, 12][(seats[i] + phase) % 5]
                                        for i, agent in enumerate(STRATEGIES)})
        for minute in range(minutes):
            agents = list(STRATEGIES)
            random.Random(seed_for(seed, 'batch-priority', minute)).shuffle(agents)
            self.priority.append({a: i for i, a in enumerate(agents)})

    @property
    def finished(self):
        return self.round_id > self.minutes

    def window(self):
        start = self.started_at + (self.round_id - 1) * 60
        return start, start + 60

    def snapshot(self, agent, now):
        if agent not in self.scores or self.finished:
            raise ValueError('Unknown agent or session finished')
        start, deadline = self.window()
        if not start <= now < deadline:
            raise ValueError('Outside decision window')
        return dict(round_id=self.round_id, opens_at=start, deadline=deadline,
                    value=self.valuations[self.round_id - 1][agent], cash=1000, inventory=10,
                    score=self.scores[agent], recent_prices=[t['price'] for t in self.trades[-20:]],
                    decision_submitted=agent in self.decisions)

    def submit(self, agent, decision, request_id, now):
        if agent not in self.scores or not isinstance(decision, Decision):
            raise ValueError('Unknown agent or invalid decision')
        key = (agent, request_id)
        if key in self.requests:
            if self.requests[key] != decision:
                raise ValueError('Idempotency conflict')
            return 'accepted'
        if self.finished or decision.round_id != self.round_id:
            raise ValueError('Wrong round')
        start, deadline = self.window()
        if not start <= now < deadline:
            raise ValueError('Outside decision window')
        if agent in self.decisions:
            raise ValueError('One decision per agent per minute')
        if decision.side == 'pass':
            if decision.price or decision.quantity:
                raise ValueError('Pass must have zero price and quantity')
        elif decision.side in ('buy', 'sell'):
            if type(decision.price) is not int or type(decision.quantity) is not int:
                raise ValueError('Integer orders required')
            if not (1 <= decision.price <= 20 and 1 <= decision.quantity <= 10):
                raise ValueError('Invalid order bounds')
            if decision.side == 'buy' and decision.price * decision.quantity > 1000:
                raise ValueError('Insufficient cash')
        else:
            raise ValueError('Invalid side')
        self.decisions[agent] = decision
        self.requests[key] = decision
        return 'accepted'

    def settle(self, now):
        if self.finished:
            raise ValueError('Session finished')
        start, deadline = self.window()
        if now < deadline:
            raise ValueError('Cannot clear before deadline')
        values = self.valuations[self.round_id - 1]
        priority = self.priority[self.round_id - 1]
        balances = {a: [1000, 10] for a in STRATEGIES}
        orders = [dict(agent=a, side=d.side, price=d.price, remaining=d.quantity)
                  for a, d in self.decisions.items() if d.side != 'pass']
        buys = sorted([o for o in orders if o['side'] == 'buy'], key=lambda o: (-o['price'], priority[o['agent']]))
        sells = sorted([o for o in orders if o['side'] == 'sell'], key=lambda o: (o['price'], priority[o['agent']]))
        i = j = 0
        fills = []
        while i < len(buys) and j < len(sells) and buys[i]['price'] >= sells[j]['price']:
            buy, sell = buys[i], sells[j]
            qty = min(buy['remaining'], sell['remaining'])
            price = (buy['price'] + sell['price']) // 2
            buyer, seller = buy['agent'], sell['agent']
            assert buyer != seller and sell['price'] <= price <= buy['price']
            balances[buyer][0] -= price * qty
            balances[buyer][1] += qty
            balances[seller][0] += price * qty
            balances[seller][1] -= qty
            buy['remaining'] -= qty
            sell['remaining'] -= qty
            fills.append(dict(id=len(self.trades) + len(fills) + 1, round_id=self.round_id,
                              buyer=buyer, seller=seller, price=price, quantity=qty))
            i += buy['remaining'] == 0
            j += sell['remaining'] == 0
        gains = {a: cash + inventory * values[a] - (1000 + 10 * values[a])
                 for a, (cash, inventory) in balances.items()}
        # Independent score decomposition from fills and conservation before task settlement.
        from_fills = {a: 0 for a in STRATEGIES}
        for t in fills:
            from_fills[t['buyer']] += (values[t['buyer']] - t['price']) * t['quantity']
            from_fills[t['seller']] += (t['price'] - values[t['seller']]) * t['quantity']
        assert from_fills == gains
        assert sum(b[0] for b in balances.values()) == 10000
        assert sum(b[1] for b in balances.values()) == 100
        assert all(min(b) >= 0 for b in balances.values())
        for a, gain in gains.items():
            self.scores[a] += gain
        participants = {t[side] for t in fills for side in ('buyer', 'seller')}
        record = dict(round_id=self.round_id, scheduled_start_seconds=start-self.started_at,
                      scheduled_close_seconds=deadline-self.started_at,
                      settled_at_seconds=now-self.started_at, decisions=len(self.decisions),
                      orders=len(orders), passes=sum(d.side == 'pass' for d in self.decisions.values()),
                      missed=[a for a in STRATEGIES if a not in self.decisions],
                      trades=len(fills), volume=sum(t['quantity'] for t in fills),
                      traded_agents=len(participants), participating_agents=sorted(participants),
                      values=values, gains=gains, cumulative_scores=dict(self.scores),
                      end_balances=balances,
                      submitted={a: asdict(d) for a, d in self.decisions.items()},
                      expired_quantity=sum(o['remaining'] for o in orders))
        self.rounds.append(record)
        self.trades.extend(fills)
        self.decisions = {}
        self.round_id += 1
        return record


def decide_once(snapshot, strategy, rng, total_minutes):
    """Adapt old two-sided policies into one role-directed decision per minute.

    Low value sells; high value buys; neutral value chooses a side at random.
    All agents see the same previous-minute public prices, not current submissions.
    """
    v = snapshot['value']
    view = View(v, snapshot['cash'], snapshot['inventory'], (), (),
                tuple(snapshot['recent_prices']), (snapshot['round_id'] - 1) / (total_minutes - 1))
    proposals = Agent(strategy, rng).decide(view)
    if not proposals:
        return Decision(snapshot['round_id'], 'pass')
    side = 'sell' if v < 10 else 'buy' if v > 10 else rng.choice(['buy', 'sell'])
    action = next((o for o in proposals if o[0] == side), None)
    return Decision(snapshot['round_id'], *action) if action else Decision(snapshot['round_id'], 'pass')


def run_session(seed=20260911, minutes=30, mode='mixed', realtime=False):
    origin = time.monotonic() if realtime else 0.0
    session = MinuteSession(seed, minutes, origin)
    rngs = {a: random.Random(seed_for(seed, 'minute-agent', a)) for a in STRATEGIES}
    while not session.finished:
        start, deadline = session.window()
        now = time.monotonic() if realtime else start
        # This runner hosts local synchronous policies; remote timeouts are not implemented.
        for a in STRATEGIES:
            snapshot = session.snapshot(a, time.monotonic() if realtime else now)
            policy = 'value_taker' if mode == 'rational' else 'hold' if mode == 'idle' else a
            decision = decide_once(snapshot, policy, rngs[a], minutes)
            session.submit(a, decision, f'{session.round_id}:decision', time.monotonic() if realtime else now)
        if realtime:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                time.sleep(min(.25, remaining))
        session.settle(time.monotonic() if realtime else deadline)
    summary = dict(mode=mode, seed=seed, accelerated=not realtime, rounds=minutes,
                   scheduled_duration_seconds=minutes*60, decision_interval_seconds=60,
                   actual_wall_seconds=time.monotonic()-origin if realtime else None,
                   active_rounds=sum(r['trades'] > 0 for r in session.rounds),
                   total_decisions=sum(r['decisions'] for r in session.rounds),
                   total_orders=sum(r['orders'] for r in session.rounds),
                   total_trades=len(session.trades),
                   min_trades_per_round=min(r['trades'] for r in session.rounds),
                   min_traded_agents_per_round=min(r['traded_agents'] for r in session.rounds),
                   participant_active_rounds={a: sum(a in r['participating_agents'] for r in session.rounds) for a in STRATEGIES},
                   leaderboard=[dict(agent=a, name=DESCRIPTIONS[a][0] if mode=='mixed' else a,
                                     score=session.scores[a]) for a in sorted(STRATEGIES, key=lambda a:-session.scores[a])])
    return session, summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--minutes', type=int, default=30)
    parser.add_argument('--seed', type=int, default=20260911)
    parser.add_argument('--mode', choices=['mixed', 'rational', 'idle'], default='mixed')
    parser.add_argument('--realtime', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() and any(args.output.iterdir()):
        parser.error('Use a new output directory')
    args.output.mkdir(parents=True, exist_ok=True)
    session, summary = run_session(args.seed, args.minutes, args.mode, args.realtime)
    for name, data in [('summary.json', summary), ('rounds.json', session.rounds), ('trades.json', session.trades)]:
        (args.output / name).write_text(json.dumps(data, ensure_ascii=False, indent=2))
    source_hashes = {name: hashlib.sha256((Path(__file__).parent/name).read_bytes()).hexdigest()
                     for name in ['minute_session.py', 'agents.py', 'run.py', 'market.py']}
    (args.output / 'manifest.json').write_text(json.dumps(dict(source_hashes=source_hashes,
        output_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in args.output.glob('*.json')}), indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
