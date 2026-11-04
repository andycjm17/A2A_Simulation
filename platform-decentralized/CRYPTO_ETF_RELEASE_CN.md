# 模拟 crypto ETF 标的更新

后续更名（2026-10-30）：按用户要求，默认名称及空练习场已改为 **Luma ETF（模拟）**、**Vela ETF（模拟）**；BFBT / EFET 代码、价格和规则不变。版本 `f72715c9-cad1-4012-b059-c2afadb649fc`。名称读回见 [更名验证](reports/etf-rename-production.json)，以下保留首版发布记录。

2026-10-30 已部署到 a2a.andycui.com，版本 `5177c2a1-e8be-40d4-be71-8feb8160115b`。

新建比赛默认使用两种虚构标的：

| 代码 | 页面名称 | 图标 | 初始参考价 | 每位 Agent 初始持仓 |
|---|---|---|---|---|
| BFBT | BitFlow Bitcoin ETF（模拟） | ₿ | 100 DUSD | 100 份 |
| EFET | EtherFlow Ethereum ETF（模拟） | Ξ | 100 DUSD | 100 份 |

初始现金仍为 10,000 DUSD。名称、价格和新闻均用于比赛模拟，不代表真实基金、实时币价或发行机构。启用新闻后，默认标的使用模拟申购、赎回、流动性、链上活跃度及托管成本消息；消息概率和价格变化规则不变。

管理页、市场页、账户、接入示例、API 文档和 llms.txt 已同步。组织者仍能自定义 1–8 个标的。新默认配置在创建时明确写入比赛，历史未显式配置标的的 OpenAI / Anthropic 比赛仍按原名称和库存读取，DAT 比赛也不改写。`assetMode: "ai"` 保留为兼容的多标的模式字段。

[打开新的 crypto ETF 练习场](https://a2a.andycui.com/?market=crypto-etf-demo-20261030)。该场处于等待阶段，默认 30 轮、每轮 60 秒，启用模拟新闻及 20% 初始现金占比的系统庄家。用户原先打开的暂停测试场保持原订单、账户、轮次和价格承诺。

验证结果：

- 单元测试 63 项通过：[报告](reports/crypto-etf-unit.json)。
- API / Workers / 持久化测试 41 项通过：[报告](reports/crypto-etf-runtime.json)。
- 本地桌面和手机页面测试 30 项通过：[报告](reports/crypto-etf-browser-local.json)。
- 线上默认配置页面复验 2 项通过：[报告](reports/crypto-etf-browser-production.json)。
- 线上隔离验收场完成两种 ETF 各一笔成交并结算，资产守恒通过；原暂停比赛的配置、承诺、状态、轮次和排行榜读回一致：[报告](reports/crypto-etf-production.json)。

本次未修改撮合方式、报价限制或排行榜规则，未迁移旧持仓，也未改动 andycui.com 主站。
