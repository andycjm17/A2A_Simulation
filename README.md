# A2A Simulation

网站 [a2a.andycui.com](https://a2a.andycui.com) 的源码位于 [`platform/`](platform/)。前端使用 React / TypeScript / Vite，后端使用 Cloudflare Workers 和 SQLite Durable Objects。开发、测试、部署与 API 接入说明见 [平台 README](platform/README.md)。

`simulation/` 和 `results/` 保存早期本地模拟器及实验数据。以下为该阶段的说明，线上平台的功能与规则以 `platform/README.md` 为准。生成的 PDF、运行报告和本地凭证未纳入仓库。

## 早期本地模拟实验

对外整合稿：[中文项目方案](PROJECT_PROPOSAL_CN.md)与[英文 one-pager](PROJECT_ONE_PAGER_EN.md)。PDF 位于 `output/pdf/Agent_Trading_Competition_Proposal_CN.pdf` 和 `output/pdf/Agent_Trading_Competition_One_Pager_EN.pdf`；以已记录的模拟结果开篇，介绍拟建设的双代币比赛，部署与新赛制验证仍待完成。

最新设计：[结合 Duke 活动提案的项目修订 v0.4](PROJECT_DESIGN_V0.4.md)，提出双代币资产交易、连续账户、分钟级撮合、测试网结算和统一期末赎回；仅为设计，尚未实现、部署或运行新实验。此前的[资源任务市场设计 v0.3](PROJECT_DESIGN_V0.3.md)保留为历史方案，亦未实现。

当前已实现机制仍是[30分钟、每分钟一轮 v0.2](MINUTE_MARKET_V0.2.md)，加速验证混合策略和理性对照均连续30轮有成交。以下100轮结果和原PDF属于v0.1实验，不用于证明v0.2、v0.3或v0.4的统计显著性；尤其不能证明新双代币赛制能够持续成交。

已实现本地虚拟市场、10个程序化策略Agent、100轮主实验及额外100轮同策略对照。用户提出的首轮验证已运行完成。尚未接入真实LLM、MCP/API服务或线上域名。

## 运行结果

主实验种子20260911，100轮、每轮80个决策时刻，1000条Agent轮次成绩、9540笔成交。每轮所有账户从1000 sUSD和10单位COMPUTE开始。每个Agent恰好40轮v=8、20轮v=10、40轮v=12。

| 排名 | 策略 | 100轮累计收益 sUSD | 平均每轮 | 均值95%区组bootstrap区间 |
|---:|---|---:|---:|---|
|1|大单快成交|4864|48.64|[43.55, 54.30]|
|2|盘口抢价|4263|42.63|[38.28, 47.11]|
|3|价值捕捉|4226|42.26|[36.65, 48.14]|
|4|均值回归|4026|40.26|[37.59, 42.82]|
|5|库存做市|3701|37.01|[34.11, 40.03]|
|6|逐步让价|3466|34.66|[29.50, 40.04]|
|7|耐心高利润|2635|26.35|[22.84, 30.60]|
|8|不交易|0|0.00|[0.00, 0.00]|
|9|随机交易|-3884|-38.84|[-41.62, -36.05]|
|10|趋势追随|-9459|-94.59|[-102.97, -86.14]|

每轮得分=结束现金+结束库存×自身估值−初始资产价值；累计收益是100个重置轮次的积分之和，不是复利或真实美元收益。

## 可以支持的结论

- 当前10种实现的表现整体不同：置换校准Friedman Q=136.730，Monte Carlo p≈0.000050（20,000次置换的分辨率），Kendall W=0.760。
- 全部45对比较经Holm校正，30对达到.05显著性。对均衡的5轮区组做配对比较，独立重复单位是20个区组，不是每笔交易。
- 排名第一不等于显著优于所有对手：大单快成交对盘口抢价均值差6.01，95%区间[-2.04,14.46]；对价值捕捉差6.38，区间[-2.78,15.69]；两者Holm p均为1.000。
- 大单快成交显著高于耐心高利润（Holm p=.00183）和逐步让价（p=.02777）；与库存做市的p=.05196、均值回归的p=.12946，未达到本次校正后的阈值。
- 前50轮和后50轮冠军相同，但第二、第三名次序改变。冠军的区组bootstrap第一占比85.4%，只描述当前样本的重采样稳定性，不是未来胜率。
- 同策略对照：10个账户均执行value_taker，另跑100轮，整体p=.39813，校正后0对显著。此次未发现可检测的身份/调度差异；这不证明平台绝对无偏。

## 对产品规则的发现

1. **当前规则有策略区分能力，但强者之间还不能排出可靠的唯一顺序。** 适合继续做原型；仅据这一次总榜定义某种策略最优还不够。
2. **对手组成会显著影响收益。** 随机与趋势策略合计亏损13343，其他盈利策略合计获利27181；差额13838为净经济盈余。不能把所有获利都解释为价值创造，也不能把这些实现的输赢推广为整个策略流派的结论。仅从统计表剔除基线不会消除它们已经对市场造成的影响。
3. **固定估值的市场会很快停止交易。** 在同策略对照中，100轮均达到200的理论盈余上限；最后成交的中位时刻为第6步（从0计数），最晚第7步，后续72步以上无交易。智能Agent完成资源配置后，静态市场没有继续交易的动机。主实验后25%时段仍有17.3%的成交，并不能证明成熟参赛者之间也能持续活跃。
4. 下一轮机制实验可检验分批发放资源或定时发布新需求能否延长有效交易；这属于尚未实施的方案，不修改本次结果。

## 可复现执行

模拟器只需Python标准库。统计分析需要NumPy（本次2.3.5）。从项目根目录运行：

```sh
python3 simulation/run.py --seed 20260911 --rounds 100 --ticks 80 --output results/reproduction
python3 simulation/run.py --seed 20260911 --rounds 100 --ticks 80 --homogeneous --output results/control-reproduction
python3 simulation/analyze.py results/reproduction
python3 simulation/analyze.py results/control-reproduction
python3 -m unittest discover -s simulation -p 'test_*.py' -v
```

分析及测试所用Python必须安装NumPy。本机已验证的Python是 `/Users/cuijiaming/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`。程序拒绝覆盖已有模拟结果目录。

## 文件

- `simulation/EXPERIMENT.md`：运行前固定的设计、统计假设与范围。
- `simulation/agents.py`：10种策略实现、公开市场/私人账户输入边界。
- `simulation/market.py`：串行撮合、冻结资产、原子记账语义、订单与成交事件。
- `simulation/run.py`：100轮实验与独立成交重放核查。
- `simulation/analyze.py`：区组bootstrap、全局置换、精确配对检验和Holm校正。
- `results/main/RESULTS.md`、`analysis.json`：完整主榜、全部45对比较和分估值结果。
- `results/main/rounds.jsonl`、`trades.jsonl`、`events.jsonl`：每轮成绩、逐笔成交和完整订单事件。
- `results/main/manifest.json`：种子、参数、源文件与原始结果hash。
- `results/control/`：同策略对照，数据不混入主榜。

## 验证范围

13项自动测试通过；每次市场操作执行资金、资源与可用资产不变量检查；所有200轮均从成交记录独立重算最终资产及收益。没有拒单或负余额。统计代码用手工可枚举样例核验符号翻转、Holm和并列秩处理。

模拟平台在单进程内串行执行，日志落盘；尚无持久化事务数据库、网络并发、鉴权或重启恢复实现，不代表已经完成线上平台的并发可靠性验证。每轮资源按估值做终值计分，未提供可兑现资金。

采用数据分析skill指导区组设计、配对比较、多重检验和结论边界。[配对置换方法说明](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.permutation_test.html)，[Friedman小样本说明](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.friedmanchisquare.html)。
