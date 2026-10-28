import random
import unittest

from agents import Agent, STRATEGIES, View
from market import Market


class MarketTests(unittest.TestCase):
    def setUp(self):
        self.m = Market(['a', 'b', 'c'])

    def test_partial_fill_price_and_reservations(self):
        self.m.submit('b', 'sell', 9, 3, '1')
        buy = self.m.submit('a', 'buy', 10, 5, '1')
        self.assertEqual(self.m.trades[0]['price'], 9)
        self.assertEqual(self.m.accounts['a'].cash, 973)
        self.assertEqual(self.m.available('a'), (953, 13))
        self.assertEqual(self.m.orders[buy].remaining, 2)
        self.m.cancel('a', buy)
        self.assertEqual(self.m.available('a'), (973, 13))

    def test_price_then_time(self):
        self.m.submit('b', 'sell', 10, 2, '1')
        self.m.submit('c', 'sell', 9, 2, '1')
        self.m.submit('b', 'sell', 9, 2, '2')
        self.m.submit('a', 'buy', 10, 5, '1')
        self.assertEqual([(t['seller'], t['price'], t['quantity']) for t in self.m.trades],
                         [('c', 9, 2), ('b', 9, 2), ('b', 10, 1)])

    def test_maker_buy_price(self):
        self.m.submit('a', 'buy', 11, 2, '1')
        self.m.submit('b', 'sell', 9, 2, '1')
        self.assertEqual(self.m.trades[0]['price'], 11)

    def test_idempotency_and_payload_conflict(self):
        oid = self.m.submit('a', 'buy', 8, 2, '1')
        self.assertEqual(oid, self.m.submit('a', 'buy', 8, 2, '1'))
        with self.assertRaises(ValueError):
            self.m.submit('a', 'buy', 8, 3, '1')
        self.m.cancel('a', oid)
        self.assertEqual(oid, self.m.submit('a', 'buy', 8, 2, '1'))
        self.assertEqual(len(self.m.orders), 0)

    def test_no_oversell_and_cancel_permissions(self):
        oid = self.m.submit('a', 'sell', 10, 10, '1')
        with self.assertRaises(ValueError):
            self.m.submit('a', 'sell', 11, 1, '2')
        with self.assertRaises(ValueError):
            self.m.cancel('b', oid)
        self.m.cancel('a', oid)
        self.m.submit('a', 'sell', 11, 10, '2')

    def test_competing_buyers_no_double_fill(self):
        self.m.submit('a', 'sell', 9, 3, '1')
        self.m.submit('b', 'buy', 9, 3, '1')
        self.m.submit('c', 'buy', 9, 3, '1')
        self.assertEqual(sum(t['quantity'] for t in self.m.trades), 3)
        self.assertEqual(self.m.accounts['a'].inventory, 7)

    def test_self_cross_and_close(self):
        self.m.submit('a', 'sell', 9, 3, '1')
        with self.assertRaises(ValueError):
            self.m.submit('a', 'buy', 9, 3, '2')
        self.m.close()
        self.assertFalse(self.m.orders)
        with self.assertRaises(ValueError):
            self.m.submit('b', 'buy', 9, 3, '1')

    def test_insufficient_cash(self):
        for i in range(5):
            self.m.submit('a', 'buy', 20, 10, str(i))
        with self.assertRaises(ValueError):
            self.m.submit('a', 'buy', 1, 1, 'extra')

    def test_hold_and_agent_capabilities(self):
        view = View(10, 1000, 10, ((9, 3),), ((11, 3),), (10,), .5)
        self.assertEqual(Agent('hold', random.Random(1)).decide(view), [])
        for strategy in STRATEGIES:
            orders = Agent(strategy, random.Random(1)).decide(view)
            self.assertLessEqual(len(orders), 2)
            self.assertTrue(all(1 <= p <= 20 and 1 <= q <= 10 for _, p, q in orders))


if __name__ == '__main__':
    unittest.main()
