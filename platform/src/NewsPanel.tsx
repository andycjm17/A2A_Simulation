import { t, rich, useLocale, localizedLabels, localeTag, message, displayName, newsHeadline } from "./i18n";
import type { Snapshot } from "./App";
import { money } from "./App";
export function NewsPanel({ s }: { s: Snapshot }) {
  useLocale();
  if (!s.config.newsEnabled) return null;
  const maker = s.maker;
  return (
    <section className="panel news-panel" aria-label={t("mfd84b94893")}>
      <div className="paneltitle">
        <h2>{rich("mb3ca28406f")}</h2>
        <span className="badge">{rich("m411ddf36a3")}</span>
      </div>
      <div className="news-layout">
        <div className="news-feed" aria-live="polite">
          {s.news.length ? (
            s.news.slice(0, 8).map((n) => (
              <article className="news-item" key={n.id}>
                <div className="row between">
                  <span className="hint">{rich("m78199b6ba8", [n.round, displayName(s.instruments.find((i) => i.symbol === n.symbol)?.name ?? n.symbol)])}</span>
                  <strong
                    className={n.after >= n.before ? "positive" : "negative"}
                  >
                    {n.after >= n.before ? "+" : ""}
                    {((n.after / n.before - 1) * 100).toFixed(1)}%
                  </strong>
                </div>
                <h3>{newsHeadline(n.headline)}</h3>
                <p className="hint">{rich("mdf317a4fcd", [money(n.before), money(n.after)])}</p>
              </article>
            ))
          ) : (
            <div className="empty">
              {s.status === "lobby"
                ? t("m3c8cc1d627")
                : t("meb8a1aca0f")}
            </div>
          )}
          <p className="hint news-explainer">{rich("ma26719c5c8")}</p>
        </div>
        {(s.config.makerCashShare ?? 0) > 0 ? (
          <aside className="maker-card">
            <span className="instrument-symbol">SYSTEM MARKET MAKER</span>
            <h3>{rich("mb9de636315")}</h3>
            <p>{s.config.makerPolicy ? "Goal: provide liquidity while protecting capital, and trade on public market information." : rich("ma25a2d4f9b")}</p>
            <dl>
              <div>
                <dt>{rich("mcc32345d56")}</dt>
                <dd>
                  {(
                    (maker?.cashShare ?? s.config.makerCashShare ?? 0) * 100
                  ).toFixed(0)}
                  %
                </dd>
              </div>
              <div>
                <dt>{rich("m06a738c30c")}</dt>
                <dd>
                  {maker?.volumeShare == null
                    ? t("md106e16768")
                    : `${(maker.volumeShare * 100).toFixed(1)}%`}
                </dd>
              </div>
              <div>
                <dt>{rich("m49500adac7")}</dt>
                <dd>{maker ? money(maker.profit) : t("m626c8ed764")}</dd>
              </div>
            </dl>
            <p className="hint">{s.config.makerPolicy ? "Quotes respond to published fundamentals, news and completed trades. Sell quotes stay at or above average acquisition cost. Buying shrinks during losses and stops at a 10% portfolio loss. Cash is reserved, with no borrowing or top-ups. These controls target capital preservation; price moves can still cause losses or leave quotes unfilled." : rich("mbca153665a")}</p>
          </aside>
        ) : (
          <aside className="maker-card">
            <h3>{rich("m50d5e3b2c9")}</h3>
            <p>{rich("mb66c2e4455")}</p>
          </aside>
        )}
      </div>
    </section>
  );
}
