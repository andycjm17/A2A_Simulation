import { t, rich, useLocale, localizedLabels, localeTag, message, displayName } from "./i18n";
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
  useLocale();
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
  useLocale();
  function update(index: number, patch: Partial<InstrumentConfig>) {
    change(
      value.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }
  return (
    <fieldset className="instrument-settings" disabled={disabled}>
      <legend>{rich("m6168399785")}</legend>
      {value.map((item, index) => (
        <div className="instrument-settings-card" key={index}>
          <div className="row between">
            <strong>{rich("mc06b0f0f21", [<InstrumentIcon icon={item.icon} name={item.name} />, index + 1])}</strong>
            <button
              type="button"
              className="textbutton"
              disabled={value.length <= 1}
              onClick={() => change(value.filter((_, i) => i !== index))}
              aria-label={t("m8a22ab15fa", [index + 1])}
            >{rich("mb5e1bb61b3")}</button>
          </div>
          <label className="field">{rich("m3979893ba1", [<input
              required
              maxLength={40}
              value={item.name}
              onChange={(e) => update(index, { name: e.target.value })}
            />])}</label>
          <label className="field">{rich("mb58a0a33ef", [<input
              required
              pattern="[A-Z][A-Z0-9_]{0,15}"
              maxLength={16}
              value={item.symbol}
              onChange={(e) =>
                update(index, { symbol: e.target.value.toUpperCase() })
              }
            />])}</label>
          <label className="field">{rich("m619bde6a85", [<input
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
            />])}</label>
          <label className="field">{rich("ma19c18af94", [<input
              required
              maxLength={512}
              value={item.icon}
              onChange={(e) => update(index, { icon: e.target.value })}
            />])}</label>
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
              name: t("m4244b5a0fc", [n]),
              initialPrice: 10000,
              icon: "◈",
            },
          ]);
        }}
      >{rich("m2966478e8c")}</button>
      <p className="hint">{rich("mddaf12b520")}</p>
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
  useLocale();
  const source = s.instruments.map((i) => ({
    symbol: i.symbol,
    name: displayName(i.name),
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
      aria-label={t("m7a713d3d06")}
      className="stack initial-balances-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        await save(value, () => setSaved(true));
      }}
    >
      <h3>{rich("md45e3031cb")}</h3>
      <InstrumentFields
        value={value}
        change={(v) => {
          setValue(v);
          setSaved(false);
        }}
        disabled={busy || locked}
      />
      <p className="hint">{rich("mc6229da24a", [locked ? t("mb94c24babb") : ""])}</p>
      <button className="secondary" disabled={busy || locked}>{rich("ma19933fd36")}</button>
      {saved && (
        <span role="status" className="hint">{rich("m031ed6dae2")}</span>
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
  useLocale();
  const factor = (count * share) / (1 - share),
    makerCash = Math.round(balances.cash * factor);
  const rows = instruments.map((i) => ({
    ...i,
    ordinary: (balances[i.symbol] ?? 100) * count,
    maker: Math.floor((balances[i.symbol] ?? 100) * factor),
  }));
  return (
    <div className="capital-preview">
      <strong>{rich("m2c9c03b994")}</strong>
      <p className="hint">{rich("m711816d14e", [count, money(balances.cash * count + makerCash), money(makerCash), (share * 100).toFixed(0)])}</p>
      {rows.map((i) => (
        <p className="hint" key={i.symbol}>{rich("m0f9d8c75fb", [displayName(i.name), i.ordinary, i.maker, i.ordinary + i.maker, money((i.ordinary + i.maker) * i.initialPrice)])}</p>
      ))}
      <p className="hint">{rich("m85c86b1e3d")}</p>
    </div>
  );
}
