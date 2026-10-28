import { useEffect, useState } from "react";
import { type InstrumentConfig, type InitialBalances } from "../worker/engine";
import { type Snapshot, money } from "./App";
export function InstrumentIcon({
  icon = "◈",
  name,
}: {
  icon?: string;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [icon]);
  return (
    <span className="asset-icon" aria-hidden="true">
      {icon.startsWith("https://") && !failed ? (
        <img
          src={icon}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : failed ? (
        (Array.from(name)[0] ?? "◈")
      ) : (
        icon
      )}
    </span>
  );
}
export function InstrumentFields({
  value,
  change,
  disabled = false,
}: {
  value: InstrumentConfig[];
  change: (v: InstrumentConfig[]) => void;
  disabled?: boolean;
}) {
  function update(index: number, patch: Partial<InstrumentConfig>) {
    change(
      value.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }
  return (
    <fieldset className="instrument-settings" disabled={disabled}>
      <legend>交易标的设置</legend>
      {value.map((item, index) => (
        <div className="instrument-settings-card" key={index}>
          <div className="row between">
            <strong>
              <InstrumentIcon icon={item.icon} name={item.name} /> 标的{" "}
              {index + 1}
            </strong>
            <button
              type="button"
              className="textbutton"
              disabled={value.length <= 1}
              onClick={() => change(value.filter((_, i) => i !== index))}
              aria-label={`删除标的 ${index + 1}`}
            >
              删除
            </button>
          </div>
          <label className="field">
            标的名称
            <input
              required
              maxLength={40}
              value={item.name}
              onChange={(e) => update(index, { name: e.target.value })}
            />
          </label>
          <label className="field">
            交易代码
            <input
              required
              pattern="[A-Z][A-Z0-9_]{0,15}"
              maxLength={16}
              value={item.symbol}
              onChange={(e) =>
                update(index, { symbol: e.target.value.toUpperCase() })
              }
            />
          </label>
          <label className="field">
            初始价格（DUSD）
            <input
              required
              type="number"
              min={1}
              max={200}
              step="0.01"
              value={item.initialPrice / 100}
              onChange={(e) =>
                update(index, {
                  initialPrice: Math.round(Number(e.target.value) * 100),
                })
              }
            />
          </label>
          <label className="field">
            图标（emoji 或 HTTPS 图片地址）
            <input
              required
              maxLength={512}
              value={item.icon}
              onChange={(e) => update(index, { icon: e.target.value })}
            />
          </label>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        disabled={value.length >= 8}
        onClick={() => {
          let n = value.length + 1;
          while (value.some((i) => i.symbol === `ASSET${n}`)) n++;
          change([
            ...value,
            {
              symbol: `ASSET${n}`,
              name: `标的 ${n}`,
              initialPrice: 10000,
              icon: "◈",
            },
          ]);
        }}
      >
        添加标的
      </button>
      <p className="hint">
        支持 1–8
        个标的。初始价格用于开赛估值，后续由新闻和交易推动变化。交易代码用于
        Agent 下单，不可重复；新增标的初始持仓默认 100
        份，可在初始资产设置中调整。
      </p>
    </fieldset>
  );
}
export function InstrumentsEditor({
  s,
  busy,
  save,
}: {
  s: Snapshot;
  busy: boolean;
  save: (items: InstrumentConfig[], applied: () => void) => Promise<void>;
}) {
  const source = s.instruments.map((i) => ({
    symbol: i.symbol,
    name: i.name,
    initialPrice: i.initialPrice,
    icon: i.icon,
  }));
  const signature = JSON.stringify(source);
  const [value, setValue] = useState(source),
    [saved, setSaved] = useState(false);
  useEffect(() => setValue(source), [signature]);
  if (s.orderBookMode === "sealed") return null;
  const locked = s.status !== "lobby";
  return (
    <form
      aria-label="配置本场交易标的"
      className="stack initial-balances-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        await save(value, () => setSaved(true));
      }}
    >
      <h3>本场交易标的</h3>
      <InstrumentFields
        value={value}
        change={(v) => {
          setValue(v);
          setSaved(false);
        }}
        disabled={busy || locked}
      />
      <p className="hint">
        开赛前可调整名称、初始价格和图标，也可增删标的。保存后会更新初始估值、新闻与价格承诺。
        {locked ? "本场已开始，标的配置已锁定。" : ""}
      </p>
      <button className="secondary" disabled={busy || locked}>
        保存标的设置
      </button>
      {saved && (
        <span role="status" className="hint">
          标的设置已保存。
        </span>
      )}
    </form>
  );
}
export function CapitalPreview({
  instruments,
  balances,
  count,
  share,
}: {
  instruments: Pick<InstrumentConfig, "symbol" | "name" | "initialPrice">[];
  balances: InitialBalances;
  count: number;
  share: number;
}) {
  const factor = (count * share) / (1 - share),
    makerCash = Math.round(balances.cash * factor);
  const rows = instruments.map((i) => ({
    ...i,
    ordinary: (balances[i.symbol] ?? 100) * count,
    maker: Math.floor((balances[i.symbol] ?? 100) * factor),
  }));
  return (
    <div className="capital-preview">
      <strong>开赛资金与流通量预览</strong>
      <p className="hint">
        按当前 {count} 名普通 Agent 计算：可交易现金总额{" "}
        {money(balances.cash * count + makerCash)} DUSD，其中庄家{" "}
        {money(makerCash)} DUSD；初始现金占比 {(share * 100).toFixed(0)}%。
      </p>
      {rows.map((i) => (
        <p className="hint" key={i.symbol}>
          {i.name}：普通 Agent {i.ordinary} 份 + 庄家 {i.maker} 份 = 流通量{" "}
          {i.ordinary + i.maker} 份；初始市值{" "}
          {money((i.ordinary + i.maker) * i.initialPrice)} DUSD。
        </p>
      ))}
      <p className="hint">
        市值按初始价格 × 流通量计算，和可交易现金分别统计。
      </p>
    </div>
  );
}
