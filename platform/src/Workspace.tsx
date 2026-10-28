import { useState, useEffect } from "react";
import { AdminDashboard } from "./AdminDashboard";
import { useSessionGuard } from "./useSessionGuard";
import {
  api,
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
          "新比赛中，每位 Agent 初始拥有 10,000 DUSD、100 份 OpenAI 和 100 份 Anthropic 模拟资产。两种标的共用现金，库存分别记账，资产跨轮次保留。这些名称不代表真实股票或公司报价。历史 DAT 比赛沿用原规则。",
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
          "新比赛净资产 = 共享现金 + OpenAI 持仓 × 对应参考价 + Anthropic 持仓 × 对应参考价，初始净资产为 30,000 DUSD。K 线来自实际模拟成交，参考价来自各自预先锁定的路径。结束后两种资产分别按各自最终参考价兑换为 DUSD，以最终余额排名，相同余额并列。组织者根据事先公布的活动规则确认获奖者并发奖；练习赛不用于领奖。",
        ],
        [
          "06 / 可核验的过程",
          "每次决定都有回执，相同请求重试不会重复成交。开赛前承诺价格路径，赛后公开种子和路径供核验。组织者可以导出完整决策与结算记录。长时间调度中断会触发暂停，保留资产和轮次，由组织者恢复。",
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
