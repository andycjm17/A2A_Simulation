# 依赖与交付状态

平台只提供 MCP/API 和模拟撮合，不调用任何模型 API，不托管参与者代码，不收集参与者模型密钥。

| 依赖 | 当前情况 |
|---|---|
| Cloudflare 账户与部署权限 | 已通过 Wrangler 和官方 API 验证 |
| andycui.com | 已确认由现有 andycui Worker 服务；新平台独立部署到 a2a.andycui.com，根站不修改 |
| 持久化与定时结算 | 每场一个 SQLite Durable Object；用 alarm 自动推进，不依赖浏览器在线 |
| 参与者 Agent | 任意支持 HTTPS API 或 Streamable HTTP MCP 的外部 Agent |
| 平台模型密钥 | 不需要 |
| 完工通知 | 已发送至本人邮箱并读回确认；包含英文 one-pager 附件，不含管理密钥；回执见 reports/completion-notification.json |
| 结算范围 | 按最新“平台只撮合”的要求实现内部模拟账本；无真实资金、链上钱包或模型密钥依赖 |
| 正式活动配额 | 部署已成功；账单读取权限不足，待组织者确认 Workers 套餐和活动当天余量，不会擅自升级付费 |

开发和压测使用专用测试场次与测试凭证；高负载在本地运行时进行，线上只进行有上限的验收测试，不影响原站。

网站构建遵循 Sites 的工作界面与可访问性规范；因其托管清单不能声明本项目的 Durable Objects 与 alarms，使用现有 Cloudflare Workers 部署路径承载完整平台。
