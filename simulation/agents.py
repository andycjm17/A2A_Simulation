"""Ten fixed strategies. Agents see only public market and their own state."""
from dataclasses import dataclass
import math


DESCRIPTIONS = {
    'value_taker': ('价值捕捉', '先吃掉至少赚1的对手报价，否则按自身估值±1挂单；单笔3单位'),
    'patient': ('耐心高利润', '始终按自身估值±3挂单；单笔3单位'),
    'concession': ('逐步让价', '利润要求由3逐步降至1；单笔3单位'),
    'urgent': ('大单快成交', '前75%时间要求利润1，最后25%接受零利润；单笔6单位'),
    'book_improver': ('盘口抢价', '优先成交正收益机会，否则在不亏损前提下改善最优报价1；单笔3单位'),
    'market_maker': ('库存做市', '结合盘口与自身估值报价，并随库存调整价格；单笔3单位'),
    'momentum': ('趋势追随', '跟随最近成交价方向，允许偏离自身估值；单笔3单位'),
    'mean_reverter': ('均值回归', '围绕近10笔均价低买高卖；无历史时参考10；单笔3单位'),
    'random': ('随机交易', '随机选择价格中心6–14及买卖数量；不使用自身估值'),
    'hold': ('不交易', '保持初始资产，零收益控制基线'),
}
STRATEGIES = list(DESCRIPTIONS)


@dataclass(frozen=True)
class View:
    value: int
    cash: int
    inventory: int
    bids: tuple
    asks: tuple
    history: tuple
    progress: float


class Agent:
    def __init__(self, strategy, rng):
        self.strategy, self.rng = strategy, rng

    def decide(self, view):
        v, strategy = view.value, self.strategy
        bid = view.bids[0][0] if view.bids else None
        ask = view.asks[0][0] if view.asks else None
        midpoint = (bid + ask) / 2 if bid is not None and ask is not None else (
            view.history[-1] if view.history else 10)
        if strategy == 'hold':
            return []
        qty = 3
        buy, sell = v - 1, v + 1
        if strategy == 'patient':
            buy, sell = v - 3, v + 3
        elif strategy == 'concession':
            margin = max(1, math.ceil(3 * (1 - view.progress)))
            buy, sell = v - margin, v + margin
        elif strategy == 'urgent':
            margin = 1 if view.progress < .75 else 0
            qty = 6
            buy, sell = v - margin, v + margin
            # Zero-margin buy and sell at the same price would self-cross.
            if margin == 0:
                if v > 10:
                    sell = v + 1
                else:
                    buy = v - 1
        elif strategy == 'book_improver':
            buy = min(v - 1, bid + 1) if bid is not None else v - 2
            sell = max(v + 1, ask - 1) if ask is not None else v + 2
        elif strategy == 'market_maker':
            center = .5 * v + .5 * midpoint - max(-2, min(2, (view.inventory - 10) / 8))
            buy, sell = math.floor(center - 1), math.ceil(center + 1)
        elif strategy == 'momentum':
            h = view.history
            trend = 0
            if len(h) >= 6:
                trend = sum(h[-3:]) / 3 - sum(h[-6:-3]) / 3
            center = (h[-1] if h else 10) + (1 if trend > 0 else -1 if trend < 0 else 0)
            buy, sell = math.floor(center - 1), math.ceil(center + 1)
            if trend > 0:
                buy = math.floor(center)
            elif trend < 0:
                sell = math.ceil(center)
        elif strategy == 'mean_reverter':
            h = view.history[-10:]
            center = sum(h) / len(h) if h else 10
            buy, sell = math.floor(center - 1), math.ceil(center + 1)
        elif strategy == 'random':
            center = self.rng.randint(6, 14)
            buy, sell = center - 1, center + 1
            qty = self.rng.randint(1, 4)

        # Same two-order opportunity for everyone. Takers use best acceptable price.
        if strategy in ('value_taker', 'book_improver', 'urgent'):
            margin = 0 if strategy == 'urgent' and view.progress >= .75 else 1
            if ask is not None and ask <= v - margin:
                buy = ask
            if bid is not None and bid >= v + margin:
                sell = bid
        buy, sell = max(1, min(20, buy)), max(1, min(20, sell))
        if buy >= sell:
            sell = min(20, buy + 1)
            if buy >= sell:
                buy = sell - 1
        orders = [('buy', buy, min(qty, view.cash // buy)),
                  ('sell', sell, min(qty, view.inventory))]
        # Avoid fixed buy-first priority; RNG independent of the platform schedule.
        self.rng.shuffle(orders)
        return [order for order in orders if order[2] > 0]
