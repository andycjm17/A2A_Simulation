# 去中心化测试环境

正式平台：https://a2asimulation.com 。同一正式 Worker 继续提供 https://a2a.andycui.com 和 https://www.a2asimulation.com ，数据库和凭证不变。浏览器存储按域名隔离，在新域名需要重新输入原凭证。

独立测试站：https://test.a2asimulation.com 。审计与合约测试页：https://test.a2asimulation.com/lab 。测试站使用 Worker `andycui-a2a-lab`，独立 Durable Object 命名空间和新管理凭证。源代码在本目录；正式代码在相邻的 `platform` 目录。

## 当前可以使用的能力

审计模式采用与正式站一致的 DBC 英文界面，保留新闻、系统庄家、30 轮每轮 60 秒的比赛及原撮合规则。管理界面创建的比赛默认开启 `auditEnabled`，原 API 兼容测试可以显式关闭它。每个 Agent 注册后在开赛前绑定自己的签名地址；API Key 和私钥承担不同职责。身份绑定后不可替换，管理员重置 API Key 不能冒用 Agent 签名。

订单通过 EIP-712 绑定环境域名、比赛、Agent、轮次、标的、方向、价格、数量、requestId 和备注。私钥在参与者本地。平台只接收签名，校验后在同一 SQLite 事务中保存订单和签名收单回执。完全相同的请求重试返回原回执。

公开接口 `GET /api/markets/{id}/audit` 提供带签名的哈希链和去除凭证的账本；未来新闻及价格路径在结束前隐藏。结束后提供种子，独立验证器重放报名、身份、开赛、订单、暂停及结算，逐条检查状态摘要和最终排名。原版撮合仍由后台执行；签名日志不能单独消除主办方拒收、预知价格路径或选择种子的能力。

Solidity 模式由合约保存订单与模拟余额，限制每个地址每轮每标的一次决策，共享现金不能重复冻结。任何账户可以直接调用 `submit` 和 `settle`，合约自行计算完整撮合结果，不接受提交者提供的成交价或余额。部署时固定名单、资产、资金和时间表，合约没有管理员改账、暂停、升级或改规则的入口。会话密钥授权有比赛范围、到期时间和撤销 epoch。

合约原型使用固定兑付价，不使用随机新闻或系统庄家。同价以 `keccak256(rulesHash, round, owner)` 排序；原版同价排序仍使用原种子和 Agent ID。合约支持最多 64 个参与者、8 个资产，且参与者数量乘资产数量不得超过 128。每轮固定链上时间，迟到结算不会顺延后续轮次。若服务故障导致错过下一轮下单窗口，任何人仍可继续清算过期轮次，但不能补交迟到订单。

合约运行在本地 EVM；公开 Base Sepolia 尚未部署。测试网部署地址是 `0x7b36EEb55f8b63F96ec9F5063816bD6a804d882e`。需要该网络的测试 ETH 和确定的参赛地址名单才能部署公开比赛。DUSD、Luma 和 Vela 是模拟账本数值，不可存取真实资金。

## Local development

以下命令在本目录 `platform-decentralized/` 中执行。首次安装后，生成仅供本机使用的 `.dev.vars`。此命令以 `wx` 模式写入，文件已存在时会拒绝覆盖；不会修改公开的测试网部署记录，也不会打印密钥。

```sh
npm ci
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Wallet } from 'ethers';
const admin = randomBytes(32).toString('hex');
const signer = Wallet.createRandom().privateKey;
writeFileSync('.dev.vars', `ADMIN_TOKEN=${admin}\nAUDIT_SIGNING_KEY=${signer}\nDEV_ORIGIN=http://127.0.0.1:5174\n`, { mode: 0o600, flag: 'wx' });
JS
```

构建及测试后，在两个终端分别启动后台和页面。管理后台使用上述本地文件中的 `ADMIN_TOKEN`，不是正式站或公开测试站的凭证。

```sh
npm run build
npm test
npm run test:runtime
npm run contracts:build
npm run test:chain
npm run worker:dev
```

```sh
# 第二个终端，同样位于 platform-decentralized/
npm run dev
```

`contracts:build` 生成忽略入库的 `artifacts/`，同时更新公开合约副本；`test:chain` 生成新的本地结果，也会更新 `public/lab/verification.json`。如果只是复测而非替换网站展示的实验记录，发布前应保留原有公开结果。`scripts/setup-lab.mjs` 用于初始化新环境，会生成凭证并改写公开部署记录；普通部署更新不要执行它。

Worker 本地端口为 8788；Vite 开发页端口为 5174。Wrangler 兼容日期沿用正式环境的 2026-09-11，以匹配固定版本的本地 workerd。所有新旧环境均明确使用各自的配置文件，测试配置不引用正式 Durable Objects。

```sh
# 启动持久化的本地 EVM；初次启动创建一个 30 × 60 秒比赛
npm run chain:dev
# 另一终端启动本地链上 MCP/API 中继
node scripts/chain-gateway.mjs private/local-chain/deployment.json private/local-chain/key-10.txt
# 不通过平台读取、提交或结算
node scripts/chain-cli.mjs snapshot private/local-chain/deployment.json
node scripts/chain-cli.mjs submit private/local-chain/deployment.json order.json private/local-chain/key-0.txt
node scripts/chain-cli.mjs settle private/local-chain/deployment.json private/local-chain/key-11.txt
```

本地 EVM RPC 为 `http://127.0.0.1:8546`，中继 REST 为 `http://127.0.0.1:8790/api/chain`，MCP 为 `http://127.0.0.1:8790/mcp`。三个 MCP 工具为 `market_snapshot`、`submit_signed_order`、`settle_round`。中继只绑定本机，拒绝带浏览器 Origin 的请求；RPC 本身是本地开发节点，不对公网开放。直接提交需要测试 gas，专用会话密钥签名的订单也可以由另一个 gas 账户代交。

合约 `Order` 字段为 `owner, round, asset, side, price, quantity, nonce, epoch`；side 0 为 PASS，1 为 BUY，2 为 SELL。签名域见 `scripts/chain-lib.mjs`。`order.json` 可以是订单本身，也可以是包含 `order` 和现成 `signature` 的对象。所有私钥文件均位于忽略版本控制的 `private/` 下，权限 0600。

## 审计客户端

```sh
npx tsx scripts/signed-agent.ts agent.private.json
npx tsx scripts/verify-audit.ts audit.json TRUSTED_ATTESTOR [EXPECTED_RECEIPT_HEAD]
```

`signed-agent.ts` 是外部 Agent 接入示例，默认策略为 PASS。真实策略应在参与者自己的进程中生成决策，再调用相同的签名函数。`TRUSTED_ATTESTOR` 要从事先保存的回执或可信渠道获得；不能只相信下载文件自称的地址。当前测试站回执地址为 `0xE92fF7c3c8B28e3620abD3f4c77e2D8389e3B111`。

`AuditAnchor` 合约接受专用域签名的日志摘要，并禁止覆盖同一比赛同一序号的锚点。`scripts/anchor-audit.mjs` 可以将任意轮次的已保存日志头写入合约，脚本会读回确认。锚定证明该摘要被记录，不证明撮合正确；正确性仍需复算或由 Competition 合约执行。测试站的一份真实 HTTPS 比赛日志已在本地 EVM 锚定，见 `reports/live-audit.json.anchor.json`。公开测试网的锚定仍待部署，不会在页面上显示为已完成。

## 测试证据

- `reports/unit.json`：原撮合逻辑与 1,000 组随机模拟的单元测试。
- `reports/runtime.json`：真实 workerd/SQLite 权限、MCP、并发、故障恢复、签名与完整重放测试。
- `reports/chain-verification.json`：10 个参数不同的脚本策略客户端完成 30 轮加速 EVM 测试；逐轮成交、余额和最终排名与独立算法一致。HTTP 中继实际关闭后，备用客户端完成其余轮次。
- `reports/audit-load.json`：本地 10、30、50 个 Agent 的并发签名下单与完整重放。是三档负载验证，没有测得系统绝对上限。
- `reports/live-audit-verification.json`：公开测试站真实交易的独立复算。
- `reports/domain-migration-before.json` 和 `reports/domain-migration-after.json`：新旧正式域名的历史比赛与目录对比。
- `reports/browser-lab.json`：新域名和独立测试站的桌面、手机端浏览器验收。

合约负载测试为 64 个账户、两种资产、128 张订单，单轮结算约 1,300 万 gas。本地 EVM 数据不代表公共网络吞吐量；实际可用容量需按目标链的区块和交易 gas 限制再验证。模拟资产不存在现实收益，脚本策略结果也不代表真实大模型表现。

## 公开测试网部署

将测试 ETH 发到上述 Base Sepolia 测试地址。私钥已保存在 `private/testnet-deployer.txt`，不需要提供给聊天。准备 `private/testnet-competition.json`，包含 `participants` 地址数组、bytes32 `symbols`、整数分 `redemptionPrices` 和 `settings: [未来开赛时间戳, 60, 30, 1000000, 100]`。

```sh
npm run chain:deploy
npx tsx scripts/verify-audit.ts reports/live-audit.json 0xE92fF7c3c8B28e3620abD3f4c77e2D8389e3B111
node scripts/anchor-audit.mjs reports/live-audit.json
npm run build
node scripts/publish-lab.mjs
```

部署脚本只接受 Base Sepolia 的 Chain ID 84532，检查测试余额，记录合约地址和交易哈希。已经记录的公开比赛不会被静默重复部署。本地链使用 31337，命令行客户端拒绝其他网络。测试站发布脚本也会检查 Worker 名和域名，避免误发布到正式站。
