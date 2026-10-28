"""Deterministic, integer-valued single-asset continuous double auction."""
from dataclasses import asdict, dataclass


@dataclass
class Account:
    cash: int = 1000
    inventory: int = 10


@dataclass
class Order:
    id: int
    agent: str
    side: str
    price: int
    remaining: int


class Market:
    def __init__(self, agents):
        self.accounts = {a: Account() for a in agents}
        self.orders = {}
        self.requests = {}
        self.trades = []
        self.events = []
        self.sequence = 0
        self.tick = 0
        self.closed = False
        self.initial_cash = 1000 * len(self.accounts)
        self.initial_inventory = 10 * len(self.accounts)

    def available(self, agent):
        account = self.accounts[agent]
        cash, inventory = account.cash, account.inventory
        for order in self.orders.values():
            if order.agent == agent:
                if order.side == 'buy':
                    cash -= order.price * order.remaining
                else:
                    inventory -= order.remaining
        return cash, inventory

    def cancel(self, agent, order_id):
        order = self.orders.get(order_id)
        if order is None:
            return False
        if order.agent != agent:
            raise ValueError('Not your order')
        del self.orders[order_id]
        self.events.append(dict(type='cancel', tick=self.tick, agent=agent, order_id=order_id))
        self.check()
        return True

    def cancel_all(self, agent):
        for order in list(self.orders.values()):
            if order.agent == agent:
                self.cancel(agent, order.id)

    def submit(self, agent, side, price, quantity, request_id):
        if agent not in self.accounts:
            raise ValueError('Unknown agent')
        key = (agent, request_id)
        payload = (side, price, quantity)
        if key in self.requests:
            previous_payload, oid = self.requests[key]
            if previous_payload != payload:
                raise ValueError('Idempotency key reused with different payload')
            return oid
        if self.closed:
            raise ValueError('Market closed')
        if side not in ('buy', 'sell') or type(price) is not int or type(quantity) is not int:
            raise ValueError('Invalid order')
        if not (1 <= price <= 20 and 1 <= quantity <= 10):
            raise ValueError('Order outside limits')
        cash, inventory = self.available(agent)
        if (side == 'buy' and price * quantity > cash) or (side == 'sell' and quantity > inventory):
            raise ValueError('Insufficient available assets')
        def crosses(order):
            return order.price <= price if side == 'buy' else order.price >= price
        if any(o.agent == agent and o.side != side and crosses(o) for o in self.orders.values()):
            raise ValueError('Self-cross prohibited')
        self.sequence += 1
        oid = self.sequence
        self.requests[key] = (payload, oid)
        self.events.append(dict(type='submit', tick=self.tick, agent=agent, order_id=oid,
                                side=side, price=price, quantity=quantity, request_id=request_id))
        opposite = [o for o in self.orders.values() if o.side != side and o.agent != agent and crosses(o)]
        opposite.sort(key=lambda o: (o.price if side == 'buy' else -o.price, o.id))
        remaining = quantity
        for resting in opposite:
            if not remaining:
                break
            qty = min(remaining, resting.remaining)
            buyer, seller = (agent, resting.agent) if side == 'buy' else (resting.agent, agent)
            value = resting.price * qty
            self.accounts[buyer].cash -= value
            self.accounts[buyer].inventory += qty
            self.accounts[seller].cash += value
            self.accounts[seller].inventory -= qty
            trade = dict(id=len(self.trades) + 1, tick=self.tick, buyer=buyer, seller=seller,
                         price=resting.price, quantity=qty, maker_order=resting.id, taker_order=oid)
            self.trades.append(trade)
            self.events.append(dict(type='trade', **trade))
            resting.remaining -= qty
            remaining -= qty
            if not resting.remaining:
                del self.orders[resting.id]
        if remaining:
            self.orders[oid] = Order(oid, agent, side, price, remaining)
        self.check()
        return oid

    def close(self):
        self.closed = True
        for agent in self.accounts:
            self.cancel_all(agent)
        self.check()

    def check(self):
        assert sum(a.cash for a in self.accounts.values()) == self.initial_cash
        assert sum(a.inventory for a in self.accounts.values()) == self.initial_inventory
        assert all(a.cash >= 0 and a.inventory >= 0 for a in self.accounts.values())
        assert all(min(self.available(a)) >= 0 for a in self.accounts)
        assert all(o.remaining > 0 for o in self.orders.values())

    def balances(self):
        return {a: asdict(account) for a, account in self.accounts.items()}
