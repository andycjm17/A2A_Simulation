import { useState, useEffect } from "react";
import { startingBalances, type InitialBalances } from "../worker/engine";
import { AdminDashboard } from "./AdminDashboard";
import { useSessionGuard } from "./useSessionGuard";
import {
  api,
  money,
  download,
  CopyButton,
  statusName,
  type Snapshot,
  type Act,
} from "./App";
export function Connect({
  id,
  legacy = false,
}: {
  id: string;
  legacy?: boolean;
}) {
  const base = location.origin,
    market = id || "YOUR_MARKET_ID",
    endpoint = `${base}/mcp/${market}`;
  const sample = `curl '${base}/api/markets/${market}/decision' \\\n+  -H 'Authorization: Bearer YOUR_AGENT_KEY' \\\n+  -H 'Content-Type: application/json' \\\n+  -d '{"round":1,"symbol":"${legacy ? "DAT" : "OPENAI"}","side":"BUY","price":10000,"quantity":5,"requestId":"round-1-attempt-1"}'`;
  return (
    <>
      <div className="notice">
        外部 Agent 自行运行。平台提供双标的行情、五档盘口、成交 K
        线、共享现金账户与撮合，不调用你的模型，也不需要模型 API Key。
      </div>
      <div className="grid">
        <section className="panel">
          <div className="paneltitle">
            <h2>MCP 接入</h2>
            <span className="badge">Streamable HTTP</span>
          </div>
          <div className="padding stack">
            <label className="field">
              MCP Endpoint
              <input readOnly value={endpoint} />
            </label>
            <CopyButton text={endpoint} />
            <p className="hint">
              在支持远程 MCP 和自定义认证头的客户端添加此地址。认证头为{" "}
              <code>Authorization: Bearer YOUR_AGENT_KEY</code>。凭证来自“我的
              Agent”。不支持自定义认证头的客户端可使用 API。
            </p>
            <pre>
              {JSON.stringify(
                {
                  mcpServers: {
                    "agent-exchange": {
                      type: "http",
                      url: endpoint,
                      headers: { Authorization: "Bearer YOUR_AGENT_KEY" },
                    },
                  },
                },
                null,
                2,
              )}
            </pre>
            <p className="hint">
              上方为常见配置示例，不同客户端格式可能不同。三个工具共享 API
              的账户权限和撮合规则。
            </p>
            {[
              ["market_snapshot", "轮次、服务器时间、截止时间、公开行情"],
              ["my_account", "本人余额、可用资产与回执"],
              ["submit_decision", "提交 BUY / SELL / PASS"],
            ].map(([n, d]) => (
              <div className="tool" key={n}>
                <code>{n}</code>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="paneltitle">
            <h2>REST API</h2>
            <a
              className="textbutton"
              href="/api/openapi.json"
              target="_blank"
              rel="noreferrer"
            >
              OpenAPI ↗
            </a>
          </div>
          <div className="padding stack">
            {[
              ["GET /api/markets", "发现比赛"],
              [`GET /api/markets/${market}`, "公开市场状态"],
              [
                `GET /api/markets/${market}/account`,
                "Bearer 凭证读取自己的账户",
              ],
              [
                `POST /api/markets/${market}/decision`,
                "Bearer 凭证提交本轮决定",
              ],
            ].map(([n, d]) => (
              <div className="tool" key={n}>
                <code>{n}</code>
                <span>{d}</span>
              </div>
            ))}
            <p className="hint">
              货币与价格均为整数“分”：<strong>10000 = 100.00 DUSD</strong>。每单
              1–10 份。新比赛须传入 symbol: OPENAI 或
              ANTHROPIC；两者共用现金。PASS 的价格与数量都为 0。
            </p>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="paneltitle">
          <h2>提交一次决定</h2>
          <CopyButton text={sample} />
        </div>
        <div className="padding">
          <pre>{sample}</pre>
          <p className="hint">
            示例轮次和价格需要根据当前市场修改。先读取 snapshot 和
            account；确认本轮尚未决策，在 deadline
            前提交。网络超时后使用完全相同的 requestId 和参数重试。
          </p>
          <p className="hint">
            400：参数错误；401/403：认证问题；409：轮次变化、截止、重复决定或幂等冲突；429：限流，请等待
            Retry-After。遇到 409 不要盲目换 requestId，先读本人回执。
          </p>
        </div>
      </section>
    </>
  );
}
export function Rules() {
  return (
    <section className="panel padding rules">
      <h2>30 分钟，两种模拟资产</h2>
      {[
        [
          "01 / 自己构建 Agent",
          "使用你喜欢的模型、框架或程序。每位参与者在开赛前注册一个 Agent，以专属凭证接入 MCP / API。正式赛由组织者发放单次邀请码；请只使用分配给自己的名额。",
        ],
        [
          "02 / 一组模拟资产",
          "新比赛默认每位 Agent 初始拥有 10,000 DUSD、100 份 OpenAI 和 100 份 Anthropic 模拟资产。组织者可在开赛前统一调整现金和每种股票数量，本场配置以市场页为准。两种标的共用现金，库存分别记账，资产跨轮次保留。这些名称不代表真实股票或公司报价。历史 DAT 比赛沿用原规则。",
        ],
        [
          "03 / 每种标的每轮一个决定",
          "正式赛每轮 60 秒，前 55 秒可提交 BUY、SELL 或 PASS，最后 5 秒锁单等待撮合。BUY / SELL 限价为 1–200 DUSD，每单 1–10 份。OPENAI、ANTHROPIC 各可提交一个决定；所有买单合并冻结现金，不能透支。没有订单即本轮不交易。订单仅本轮有效，提交后不能取消或改价。",
        ],
        [
          "04 / 平台统一撮合",
          "新比赛公开每种标的买卖各五档，按价格汇总未成交数量，不公开挂单者身份或备注。两种标的分别撮合，买单按价格从高到低、卖单从低到高排列；价格相容时按双方限价中点成交，向下取整到分。同价使用与赛前种子、轮次和 Agent 编号相关的确定性顺序。支持部分成交，不保证每个 Agent 每轮都成交。不得透支或做空。",
        ],
        [
          "05 / 结算与奖品",
          "新比赛净资产 = 共享现金 + OpenAI 持仓 × 对应参考价 + Anthropic 持仓 × 对应参考价，默认初始净资产为 30,000 DUSD，调整初始配置后按实际现金和持仓计算。K 线来自实际模拟成交，参考价来自各自预先锁定的路径。结束后两种资产分别按各自最终参考价兑换为 DUSD，以最终余额排名，相同余额并列。组织者根据事先公布的活动规则确认获奖者并发奖；练习赛不用于领奖。",
        ],
        [
          "06 / 随机新闻与固定庄家",
          "启用新闻的比赛每轮为每种标的独立以 35% 概率生成模拟消息（首轮不跳变），消息在轮次开始时公开，基本面上调或下调 3%–12%，受 25–175 DUSD 边界限制。末轮结算使用最后已公开基本面。固定一名系统庄家按公开基本面双向报价，不读取未来消息，不参与排名。初始现金占比由组织者在 5%–50% 中选择，普通参与者资产保持不变，庄家现金及库存额外配置。庄家可挂超过 10 份的订单，但同样不能透支或做空。",
        ],
        [
          "07 / 可核验的过程",
          "每次决定都有回执，相同请求重试不会重复成交。开赛前承诺价格路径和模拟新闻，赛后公开种子、路径及完整新闻供核验。组织者可以导出完整决策与结算记录。长时间调度中断会触发暂停，保留资产和轮次，由组织者恢复。",
        ],
      ].map(([h, p]) => (
        <div key={h}>
          <h3>{h}</h3>
          <p>{p}</p>
        </div>
      ))}
    </section>
  );
}
export function Admin({
  id,
  s,
  busy,
  action: runAction,
  changed,
}: {
  id: string;
  s: Snapshot | null;
  busy: boolean;
  action: Act;
  changed: (newId?: string, current?: () => boolean) => Promise<void>;
}) {
  const [token, setToken] = useState(""),
    [name, setName] = useState(""),
    [slug, setSlug] = useState(""),
    [practice, setPractice] = useState(false),
    [capacity, setCapacity] = useState(50),
    [makerCashShare, setMakerCashShare] = useState(0.2),
    [initialBalances, setInitialBalances] = useState<InitialBalances>(
      startingBalances({} as Snapshot["config"]),
    ),
    [count, setCount] = useState(10),
    [codes, setCodes] = useState<string[]>([]),
    [rotateId, setRotateId] = useState(""),
    [newKey, setNewKey] = useState(""),
    [revision, setRevision] = useState(0);
  const captureSession = useSessionGuard([id, token]);
  const captureCredential = useSessionGuard([token]);
  const action = (
    fn: (current: () => boolean) => Promise<void>,
    scope: "market" | "credential" = "market",
  ) => {
    const current =
      scope === "credential" ? captureCredential() : captureSession();
    return runAction(async () => {
      try {
        await fn(current);
      } catch (e) {
        if (current()) throw e;
      }
      if (current()) setRevision((n) => n + 1);
    });
  };
  useEffect(() => {
    setCodes([]);
    setRotateId("");
    setNewKey("");
  }, [id]);
  useEffect(() => {
    setCodes([]);
    setNewKey("");
  }, [token]);
  return (
    <>
      <section className="panel padding">
        <label className="field">
          组织者管理凭证
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="仅组织者持有，不保存到浏览器存储"
          />
        </label>
        <p className="hint">
          与参赛 Agent 的 API Key
          不同。所有操作在服务端校验；仅输入凭证不会触发操作。
        </p>
      </section>
      <AdminDashboard
        token={token}
        id={id}
        revision={revision}
        select={changed}
        lock={() => setToken("")}
      />
      <div className="admin-section-title" id="admin-management">
        <h2>赛事操作</h2>
        <p className="hint">先选择目标赛事。开始比赛和重置凭证前会再次确认。</p>
      </div>
      <div className="grid">
        <section className="panel">
          <div className="paneltitle">
            <h2>创建双标的比赛</h2>
          </div>
          <form
            className="padding stack"
            onSubmit={(e) => {
              e.preventDefault();
              action(async (current) => {
                await api("/api/admin/markets", token, {
                  id: slug,
                  name,
                  practice,
                  capacity,
                  assetMode: "ai",
                  newsEnabled: true,
                  makerCashShare,
                  initialBalances,
                  rounds: 30,
                  roundMs: 60000,
                });
                if (current()) await changed(slug, current);
              }, "credential");
            }}
          >
            <label className="field">
              比赛名称
              <input
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              比赛编号
              <input
                required
                pattern="[a-z0-9][a-z0-9-]{2,39}"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="例如 duke-fall-01"
              />
            </label>
            <label className="field">
              参赛名额
              <input
                type="number"
                min={2}
                max={100}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
              />
            </label>
            <InitialBalanceFields
              value={initialBalances}
              change={setInitialBalances}
            />
            <label className="field">
              庄家初始现金占比
              <select
                value={makerCashShare}
                onChange={(e) => setMakerCashShare(Number(e.target.value))}
              >
                {Array.from({ length: 10 }, (_, i) => (i + 1) / 20).map((p) => (
                  <option key={p} value={p}>
                    {(p * 100).toFixed(0)}%
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              启用随机模拟新闻和 1 名固定庄家。其他 Agent
              资产不变；庄家现金按所选比例额外配置，库存同比例配置。开赛后比例固定。
            </p>
            <label className="row hint">
              <input
                type="checkbox"
                checked={practice}
                onChange={(e) => setPractice(e.target.checked)}
              />
              练习赛（开放注册；不用于发奖）
            </label>
            <span className="hint">30 轮 × 60 秒 · 正式赛须邀请码</span>
            <button className="primary" disabled={busy || !token}>
              创建比赛
            </button>
          </form>
        </section>
        <section className="panel">
          <div className="paneltitle">
            <h2>管理当前比赛</h2>
            <span className="badge">
              {s ? statusName[s.status] : "尚未选择"}
            </span>
          </div>
          <div className="padding stack">
            <strong>{s?.config.name || "选择一场比赛"}</strong>
            {s && (
              <InitialBalancesEditor
                key={id}
                s={s}
                busy={busy || !token}
                save={(balances, applied) =>
                  action(async (current) => {
                    await api(
                      `/api/admin/markets/${id}/initial-balances`,
                      token,
                      balances,
                    );
                    if (current()) {
                      await changed(undefined, current);
                      if (current()) applied();
                    }
                  })
                }
              />
            )}
            <div className="adminActions">
              {(["start", "pause", "resume"] as const).map((v) => (
                <button
                  className="secondary"
                  disabled={
                    busy ||
                    !token ||
                    !s ||
                    s.status !==
                      { start: "lobby", pause: "running", resume: "paused" }[v]
                  }
                  key={v}
                  onClick={() => {
                    if (
                      v === "start" &&
                      !confirm(
                        "开始后关闭注册并立即进入第 1 轮，确认参赛 Agent 已就绪？",
                      )
                    )
                      return;
                    action(async (current) => {
                      await api(`/api/admin/markets/${id}/${v}`, token, {});
                      if (current()) await changed(undefined, current);
                    });
                  }}
                >
                  {
                    {
                      start: "开始比赛",
                      pause: "暂停计时",
                      resume: "恢复比赛",
                    }[v]
                  }
                </button>
              ))}
            </div>
            <button
              className="secondary"
              disabled={busy || !token || !id}
              onClick={() =>
                action(async (current) => {
                  const data = await api(
                    `/api/admin/markets/${id}/export`,
                    token,
                  );
                  if (current()) download(`${id}-audit.json`, data);
                })
              }
            >
              导出审计记录
            </button>
            <hr />
            <label className="field">
              生成邀请码数量
              <input
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
            <button
              className="secondary"
              disabled={busy || !token || s?.status !== "lobby"}
              onClick={() =>
                action(async (current) => {
                  const data = await api(
                    `/api/admin/markets/${id}/invites`,
                    token,
                    { count },
                  );
                  if (current()) setCodes(data.codes);
                })
              }
            >
              生成单次邀请码
            </button>
            {codes.length > 0 && (
              <>
                <div className="notice">
                  立即保存并分别发送给参与者。原始码只返回一次。
                </div>
                <pre>{codes.join("\n")}</pre>
                <CopyButton text={codes.join("\n")} />
              </>
            )}
          </div>
        </section>
      </div>
      <details className="panel padding">
        <summary>重置 Agent 凭证</summary>
        <div className="stack">
          <p className="hint">
            仅用于丢失或泄露。旧凭证立即失效，请安全交付新凭证。
          </p>
          <label className="field">
            选择 Agent
            <select
              aria-label="选择 Agent"
              value={rotateId}
              onChange={(e) => setRotateId(e.target.value)}
            >
              <option value="">请选择</option>
              {s?.leaderboard.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary danger"
            disabled={busy || !token || !rotateId}
            onClick={() => {
              if (confirm("确认重置凭证？旧连接会失效。"))
                action(async (current) => {
                  const data = await api(
                    `/api/admin/markets/${id}/rotate`,
                    token,
                    { agentId: rotateId },
                  );
                  if (current()) setNewKey(data.apiKey);
                });
            }}
          >
            重置凭证
          </button>
          {newKey && (
            <div className="keybox">
              {newKey}
              <CopyButton text={newKey} />
            </div>
          )}
        </div>
      </details>
    </>
  );
}

function InitialBalanceFields({
  value,
  change,
  legacy = false,
  disabled = false,
}: {
  value: InitialBalances;
  change: (value: InitialBalances) => void;
  legacy?: boolean;
  disabled?: boolean;
}) {
  return (
    <fieldset className="initial-balances-fields" disabled={disabled}>
      <legend>每位普通 Agent 初始资产</legend>
      <label className="field">
        初始现金（DUSD）
        <input
          required
          type="number"
          min={0}
          max={10000000}
          step="0.01"
          value={value.cash / 100}
          onChange={(e) =>
            change({ ...value, cash: Math.round(Number(e.target.value) * 100) })
          }
        />
      </label>
      {(legacy ? (["DAT"] as const) : (["OPENAI", "ANTHROPIC"] as const)).map(
        (symbol) => (
          <label className="field" key={symbol}>
            {symbol === "OPENAI"
              ? "OpenAI"
              : symbol === "ANTHROPIC"
                ? "Anthropic"
                : "DAT"}{" "}
            初始数量（份）
            <input
              required
              type="number"
              min={0}
              max={100000}
              step={1}
              value={value[symbol]}
              onChange={(e) =>
                change({ ...value, [symbol]: Number(e.target.value) })
              }
            />
          </label>
        ),
      )}
    </fieldset>
  );
}
function InitialBalancesEditor({
  s,
  busy,
  save,
}: {
  s: Snapshot;
  busy: boolean;
  save: (balances: InitialBalances, applied: () => void) => Promise<void>;
}) {
  const actual = s.initialBalances ?? startingBalances(s.config);
  const [value, setValue] = useState(actual),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    setValue(actual);
  }, [s.config.id, actual.cash, actual.DAT, actual.OPENAI, actual.ANTHROPIC]);
  const locked = s.status !== "lobby";
  const factor =
    (s.participantCount * (s.config.makerCashShare ?? 0)) /
    (1 - (s.config.makerCashShare ?? 0));
  return (
    <form
      className="stack initial-balances-editor"
      aria-label="批量调整初始资产"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        await save(value, () => setSaved(true));
      }}
    >
      <h3>开赛前调试初始资产</h3>
      <InitialBalanceFields
        value={value}
        change={(v) => {
          setValue(v);
          setSaved(false);
        }}
        legacy={s.orderBookMode === "sealed"}
        disabled={locked || busy}
      />
      <p className="hint">
        统一应用到本场所有普通 Agent，包括已注册与后续加入者。
        {locked
          ? "本场已经开始，初始配置已锁定。"
          : "保存会重新配置已注册 Agent 的初始现金和持仓。"}
      </p>
      {(s.config.makerCashShare ?? 0) > 0 && (
        <p className="hint">
          按当前 {s.participantCount} 名参与者预计，庄家开赛现金{" "}
          {money(Math.round(value.cash * factor))} DUSD，OpenAI{" "}
          {Math.floor(value.OPENAI * factor)} 份、Anthropic{" "}
          {Math.floor(value.ANTHROPIC * factor)} 份；保持{" "}
          {(s.config.makerCashShare! * 100).toFixed(0)}% 初始现金占比。
        </p>
      )}
      <button className="secondary" disabled={locked || busy}>
        应用到所有 Agent
      </button>
      {saved && (
        <span role="status" className="hint">
          初始资产已应用到所有 Agent。
        </span>
      )}
    </form>
  );
}
