import { useState } from "react";
import type { Snapshot } from "./App";
import { money } from "./App";
type Instrument = Snapshot["instruments"][number];

export function CandlestickChart({
  instrument,
  roundMs,
}: {
  instrument: Instrument;
  roundMs: number;
}) {
  const [range, setRange] = useState(30);
  const [active, setActive] = useState<number | null>(null);
  const candles = range ? instrument.candles.slice(-range) : instrument.candles;
  const traded = candles.filter((c) => c.close !== null);
  const W = 760,
    H = 300,
    left = 16,
    right = 78,
    top = 18,
    bottom = 240;
  const low = traded.length ? Math.min(...traded.map((c) => c.low!)) : 0;
  const high = traded.length ? Math.max(...traded.map((c) => c.high!)) : 100;
  const padding = Math.max((high - low) * 0.15, 50);
  const min = Math.max(0, low - padding),
    max = high + padding;
  const y = (price: number) =>
    top + ((max - price) / (max - min)) * (bottom - top);
  const step = (W - left - right) / Math.max(candles.length, 1);
  const x = (i: number) => left + step * (i + 0.5);
  const selected = candles.find((c) => c.round === active) ?? candles.at(-1);
  return (
    <section
      className="candle-panel"
      aria-label={`${instrument.name} 成交 K 线`}
    >
      <div className="row between candle-heading">
        <h3>成交 K 线</h3>
        <span className="hint">每根 {roundMs / 1000} 秒 · DUSD</span>
      </div>
      <div className="ohlc" aria-live="polite">
        {selected ? (
          <>
            <span>R{selected.round}</span>
            {(
              [
                ["开", selected.open],
                ["高", selected.high],
                ["低", selected.low],
                ["收", selected.close],
              ] as const
            ).map(([label, value]) => (
              <span key={label}>
                {label} <b>{value === null ? "—" : money(value)}</b>
              </span>
            ))}
            <span>
              量 <b>{selected.volume}</b>
            </span>
          </>
        ) : (
          <span>等待本场首轮成交</span>
        )}
      </div>
      {traded.length ? (
        <svg
          className="candle-chart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${instrument.name} 成交 K 线图；价格单位 DUSD`}
        >
          {[0, 1, 2, 3, 4].map((n) => {
            const price = max - ((max - min) * n) / 4;
            return (
              <g key={n}>
                <line
                  x1={left}
                  x2={W - right}
                  y1={y(price)}
                  y2={y(price)}
                  stroke="var(--border)"
                  strokeDasharray="3 5"
                />
                <text
                  x={W - right + 10}
                  y={y(price) + 4}
                  className="axis-label"
                >
                  {money(price)}
                </text>
              </g>
            );
          })}
          {candles.map((c, i) => (
            <g
              key={c.round}
              tabIndex={0}
              role="button"
              aria-label={`第 ${c.round} 轮${c.close === null ? "无成交" : `，开 ${money(c.open!)}，高 ${money(c.high!)}，低 ${money(c.low!)}，收 ${money(c.close)}，量 ${c.volume}`}`}
              onFocus={() => setActive(c.round)}
              onMouseEnter={() => setActive(c.round)}
              onClick={() => setActive(c.round)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActive(c.round);
                }
              }}
            >
              <rect
                x={left + i * step}
                y={top}
                width={step}
                height={bottom - top}
                fill={
                  selected?.round === c.round
                    ? "rgba(35,110,75,.05)"
                    : "transparent"
                }
              />
              {c.close !== null && (
                <g className={c.close >= c.open! ? "candle-up" : "candle-down"}>
                  <line
                    x1={x(i)}
                    x2={x(i)}
                    y1={y(c.high!)}
                    y2={y(c.low!)}
                    strokeWidth="1.5"
                  />
                  <rect
                    x={x(i) - Math.min(16, step * 0.55) / 2}
                    y={
                      Math.min(y(c.open!), y(c.close)) -
                      (c.open === c.close ? 1 : 0)
                    }
                    width={Math.min(16, step * 0.55)}
                    height={Math.max(2, Math.abs(y(c.open!) - y(c.close)))}
                  />
                </g>
              )}
              {(candles.length < 12 ||
                i % Math.ceil(candles.length / 8) === 0 ||
                i === candles.length - 1) && (
                <text
                  x={x(i)}
                  y={266}
                  textAnchor="middle"
                  className="axis-label"
                >
                  R{c.round}
                </text>
              )}
              <title>
                {c.close === null
                  ? `R${c.round} 无成交`
                  : `R${c.round} 开 ${money(c.open!)} 高 ${money(c.high!)} 低 ${money(c.low!)} 收 ${money(c.close)} 量 ${c.volume}`}
              </title>
            </g>
          ))}
        </svg>
      ) : (
        <div className="candle-empty">
          <span className="empty-candle-icon">▥</span>
          <strong>尚无成交 K 线</strong>
          <span>买卖订单撮合后，按每轮成交生成开、高、低、收。</span>
        </div>
      )}
      <div className="row between candle-controls">
        <div className="chart-ranges" role="group" aria-label="K 线范围">
          {[
            [15, "15 轮"],
            [30, "30 轮"],
            [0, "全部"],
          ].map(([n, label]) => (
            <button
              key={n}
              aria-pressed={range === n}
              onClick={() => {
                setRange(Number(n));
                setActive(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="hint">绿涨 · 红跌 · 无成交轮次留空</span>
      </div>
    </section>
  );
}

export function OrderBook({
  instrument,
  sealed,
  paused,
}: {
  instrument: Instrument;
  sealed: boolean;
  paused: boolean;
}) {
  return (
    <section
      className="panel order-book"
      aria-label={`${instrument.name} 五档盘口`}
    >
      <div className="paneltitle">
        <h2>
          五档盘口 <span className="subtle">{instrument.name}</span>
        </h2>
        <span className="hint">同价合量 · 单位：份</span>
      </div>
      {sealed ? (
        <div className="empty">
          历史 DAT 比赛采用密封订单，不公开未结算挂单。
        </div>
      ) : (
        <>
          {paused && (
            <p className="hint padding">比赛已暂停，以下挂单等待恢复后撮合。</p>
          )}
          <div className="depth-grid">
            {(
              [
                ["bids", "买盘", "bid"],
                ["asks", "卖盘", "ask"],
              ] as const
            ).map(([side, title, color]) => (
              <div key={side}>
                <table aria-label={`${instrument.name} ${title}`}>
                  <thead>
                    <tr>
                      <th>{title}</th>
                      <th>价格 / DUSD</th>
                      <th>数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 5 }, (_, i) => {
                      const level = instrument.orderBook[side][i];
                      const maximum = Math.max(
                        1,
                        ...instrument.orderBook[side].map((l) => l.quantity),
                      );
                      return (
                        <tr
                          key={i}
                          className={`depth-row ${color}`}
                          style={
                            {
                              "--depth": `${level ? (level.quantity / maximum) * 100 : 0}%`,
                            } as React.CSSProperties
                          }
                        >
                          <td>
                            {side === "bids" ? "买" : "卖"}
                            {i + 1}
                          </td>
                          <td>{level ? money(level.price) : "—"}</td>
                          <td>{level ? level.quantity : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <p className="hint depth-note">
            仅显示当前轮次未成交的挂单。每轮结束集中撮合，未成交部分到期；买价与卖价交叉时仍需等待本轮结算。
          </p>
        </>
      )}
    </section>
  );
}
