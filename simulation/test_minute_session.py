import unittest
from unittest.mock import patch
from minute_session import Decision, MinuteSession, run_session
from agents import STRATEGIES


class MinuteSessionTests(unittest.TestCase):
    def test_one_decision_idempotence_and_deadline(self):
        s = MinuteSession()
        a = STRATEGIES[0]
        d = Decision(1, 'buy', 11, 3)
        self.assertEqual(s.submit(a, d, 'one', 0), 'accepted')
        self.assertEqual(s.submit(a, d, 'one', 59), 'accepted')
        with self.assertRaises(ValueError):
            s.submit(a, d, 'two', 59)
        with self.assertRaises(ValueError):
            s.submit(STRATEGIES[1], Decision(1, 'sell', 9, 3), 'late', 60)
        with self.assertRaises(ValueError):
            s.settle(59.999)
        s.settle(60)
        self.assertEqual(s.submit(a, d, 'one', 60), 'accepted')
        self.assertFalse(s.decisions)

    def test_price_and_single_order_partial_fills(self):
        s = MinuteSession()
        a, b, c = STRATEGIES[:3]
        s.submit(a, Decision(1, 'buy', 12, 6), 'a', 0)
        s.submit(b, Decision(1, 'sell', 8, 3), 'b', 0)
        s.submit(c, Decision(1, 'sell', 10, 3), 'c', 0)
        r = s.settle(60)
        self.assertEqual([(t['price'], t['quantity']) for t in s.trades], [(10,3), (11,3)])
        self.assertEqual(r['end_balances'][a], [937, 16])
        self.assertEqual(r['trades'], 2)
        self.assertEqual(r['expired_quantity'], 0)

    def test_equal_snapshot_and_submission_order_invariance(self):
        summaries = []
        for reverse in [False, True]:
            s = MinuteSession()
            before = s.snapshot(STRATEGIES[-1], 0)
            actions = [(STRATEGIES[i], Decision(1, 'buy' if i < 5 else 'sell', 11 if i < 5 else 9, 3)) for i in range(10)]
            for a, d in reversed(actions) if reverse else actions:
                s.submit(a, d, a, 0)
            after = s.snapshot(STRATEGIES[-1], 0)
            self.assertEqual(before['recent_prices'], after['recent_prices'])
            self.assertNotIn('values', before)
            s.settle(60)
            summaries.append(s.trades)
        self.assertEqual(summaries[0], summaries[1])

    def test_complete_clock_and_balanced_roles(self):
        s, result = run_session(mode='rational')
        self.assertEqual(result['active_rounds'], 30)
        self.assertEqual(result['total_decisions'], 300)
        self.assertEqual(s.rounds[0]['scheduled_close_seconds'], 60)
        self.assertEqual(s.rounds[-1]['scheduled_close_seconds'], 1800)
        for a in STRATEGIES:
            vals = [r['values'][a] for r in s.rounds]
            self.assertEqual([vals.count(v) for v in [8,10,12]], [12,6,12])
        with self.assertRaises(ValueError):
            s.settle(1800)

    def test_no_forced_trades_and_missed_decisions(self):
        _, result = run_session(mode='idle')
        self.assertEqual(result['active_rounds'], 0)
        self.assertEqual(result['total_orders'], 0)
        s = MinuteSession()
        r = s.settle(60)
        self.assertEqual(len(r['missed']), 10)
        self.assertEqual(r['trades'], 0)

    def test_no_cross_round_orders(self):
        s = MinuteSession()
        s.submit(STRATEGIES[0], Decision(1, 'buy', 11, 3), 'a', 0)
        self.assertEqual(s.settle(60)['expired_quantity'], 3)
        s.submit(STRATEGIES[1], Decision(2, 'sell', 9, 3), 'b', 60)
        self.assertEqual(s.settle(120)['trades'], 0)

    def test_realtime_driver_with_injected_clock(self):
        clock = [100.0]
        def sleep(seconds):
            self.assertGreaterEqual(seconds, 0)
            clock[0] += seconds
        with patch('minute_session.time.monotonic', side_effect=lambda: clock[0]), patch('minute_session.time.sleep', side_effect=sleep):
            s, result = run_session(mode='rational', realtime=True)
        self.assertEqual(result['actual_wall_seconds'], 1800)
        self.assertEqual([r['settled_at_seconds'] for r in s.rounds], list(range(60,1801,60)))


if __name__ == '__main__':
    unittest.main()
