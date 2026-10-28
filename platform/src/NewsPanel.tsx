import type { Snapshot } from "./App";
import { money } from "./App";
export function NewsPanel({ s }: { s: Snapshot }) {
  if (!s.config.newsEnabled) return null;
  const maker = s.maker;
  return (
    <section className="panel news-panel" aria-label="模拟新闻与庄家">
      <div className="paneltitle">
        <h2>市场新闻</h2>
        <span className="badge">随机模拟 · 非真实资讯</span>
      </div>
      <div className="news-layout">
        <div className="news-feed" aria-live="polite">
          {s.news.length ? (
            s.news.slice(0, 8).map((n) => (
              <article className="news-item" key={n.id}>
                <div className="row between">
                  <span className="hint">
                    第 {n.round} 轮 ·{" "}
                    {s.instruments.find((i) => i.symbol === n.symbol)?.name ??
                      n.symbol}
                  </span>
                  <strong
                    className={n.after >= n.before ? "positive" : "negative"}
                  >
                    {n.after >= n.before ? "+" : ""}
                    {((n.after / n.before - 1) * 100).toFixed(1)}%
                  </strong>
                </div>
                <h3>{n.headline}</h3>
                <p className="hint">
                  基本面参考价 {money(n.before)} → {money(n.after)} DUSD
                </p>
              </article>
            ))
          ) : (
            <div className="empty">
              {s.status === "lobby"
                ? "开赛后随机发布模拟新闻。"
                : "本场尚未发布新闻，参考价维持不变。"}
            </div>
          )}
          <p className="hint news-explainer">
            新闻在轮次开始时公开，影响对应标的的基本面。成交价由买卖订单撮合决定。最近
            8 条；完整记录可通过 API 获取。
          </p>
        </div>
        {(s.config.makerCashShare ?? 0) > 0 ? (
          <aside className="maker-card">
            <span className="instrument-symbol">SYSTEM MARKET MAKER</span>
            <h3>基本面庄家</h3>
            <p>
              固定 1
              名系统庄家，依据已公布的新闻双向报价。使用自有模拟现金和库存，不参与排名。
            </p>
            <dl>
              <div>
                <dt>初始现金占比</dt>
                <dd>
                  {(
                    (maker?.cashShare ?? s.config.makerCashShare ?? 0) * 100
                  ).toFixed(0)}
                  %
                </dd>
              </div>
              <div>
                <dt>实际成交占比</dt>
                <dd>
                  {maker?.volumeShare == null
                    ? "尚无成交"
                    : `${(maker.volumeShare * 100).toFixed(1)}%`}
                </dd>
              </div>
              <div>
                <dt>庄家收益 / DUSD</dt>
                <dd>{maker ? money(maker.profit) : "开赛时配置资产"}</dd>
              </div>
            </dl>
            <p className="hint">
              占比按全市场初始可交易现金计算，不含结算金库。每轮每种标的买单最多使用
              10% 当前现金（全部买单合计最多 80%），卖单各使用 10%
              对应库存；数量可超过普通 Agent 的 10 份上限。报价为基本面
              ±1%，按库存最多偏移 2%。
            </p>
          </aside>
        ) : (
          <aside className="maker-card">
            <h3>无庄家对照组</h3>
            <p>本场只在普通参与者之间撮合，用于与有庄家市场比较。</p>
          </aside>
        )}
      </div>
    </section>
  );
}
