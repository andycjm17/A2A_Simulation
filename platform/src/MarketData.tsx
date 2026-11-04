import { t, rich, useLocale, localizedLabels, localeTag, message, displayName } from "./i18n";
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
  useLocale();
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
      aria-label={t("m14d8aee602", [displayName(instrument.name)])}
    >
      <div className="row between candle-heading">
        <h3>{rich("mda98e645e0")}</h3>
        <span className="hint">{rich("m1d21eeff81", [roundMs / 1000])}</span>
      </div>
      <div className="ohlc" aria-live="polite">
        {selected ? (
          <>
            <span>R{selected.round}</span>
            {(
              [
                [t("m39eae64cfc"), selected.open],
                [t("mb1c27820fe"), selected.high],
                [t("maa9e366f68"), selected.low],
                [t("m339bacf403"), selected.close],
              ] as const
            ).map(([label, value]) => (
              <span key={label}>
                {label} <b>{value === null ? "—" : money(value)}</b>
              </span>
            ))}
            <span>{rich("m3d785d4480", [<b>{selected.volume}</b>])}</span>
          </>
        ) : (
          <span>{rich("mc665b31b8f")}</span>
        )}
      </div>
      {traded.length ? (
        <svg
          className="candle-chart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={t("mfa10286d30", [displayName(instrument.name)])}
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
              aria-label={t("m7624a3beef", [c.round, c.close === null ? t("m25ea58282e") : t("m111b7ff770", [money(c.open!), money(c.high!), money(c.low!), money(c.close), c.volume])])}
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
                  ? t("ma42f10a227", [c.round])
                  : t("m1229d1ccec", [c.round, money(c.open!), money(c.high!), money(c.low!), money(c.close), c.volume])}
              </title>
            </g>
          ))}
        </svg>
      ) : (
        <div className="candle-empty">
          <span className="empty-candle-icon">▥</span>
          <strong>{rich("mca615a872b")}</strong>
          <span>{rich("mf8bb263b61")}</span>
        </div>
      )}
      <div className="row between candle-controls">
        <div className="chart-ranges" role="group" aria-label={t("md9de9efdc6")}>
          {[
            [15, t("m3f7a6dedd8")],
            [30, t("m40a2de30f9")],
            [0, t("m5c55a67935")],
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
        <span className="hint">{rich("m6e18f88518")}</span>
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
  useLocale();
  return (
    <section
      className="panel order-book"
      aria-label={t("m721e9c9b88", [displayName(instrument.name)])}
    >
      <div className="paneltitle">
        <h2>{rich("m8d2403220d", [<span className="subtle">{displayName(instrument.name)}</span>])}</h2>
        <span className="hint">{rich("m08739d6d60")}</span>
      </div>
      {sealed ? (
        <div className="empty">{rich("m8f28be5508")}</div>
      ) : (
        <>
          {paused && (
            <p className="hint padding">{rich("ma78e0832d7")}</p>
          )}
          <div className="depth-grid">
            {(
              [
                ["bids", t("m381ba9a55f"), "bid"],
                ["asks", t("md416fc2cdd"), "ask"],
              ] as const
            ).map(([side, title, color]) => (
              <div key={side}>
                <table aria-label={`${displayName(instrument.name)} ${title}`}>
                  <thead>
                    <tr>
                      <th>{title}</th>
                      <th>{rich("m1d83c362e2")}</th>
                      <th>{rich("m5e29d121dd")}</th>
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
                            {side === "bids" ? t("m2cd2507d65") : t("md998fc91a1")}
                            {" "}{i + 1}
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
          <p className="hint depth-note">{rich("m017f7d0653")}</p>
        </>
      )}
    </section>
  );
}
