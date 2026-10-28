# News and market-maker capital experiment — protocol v1

Protocol fixed before the sweep. This is an artificial market experiment using the deployed matching engine, not historical OpenAI/Anthropic data or live LLM agents.

## Question and treatments

Compare 0% (no maker) and 5%, 10%, …, 50% maker share of total initial **tradable cash**, excluding treasury redemption reserves. Ordinary participants keep 10,000 DUSD and 100 units of each asset. Maker cash = ordinary cash × p/(1−p), rounded to cents; inventory per asset = floor(ordinary inventory × p/(1−p)). Hence this is an additional-capital intervention, not a redistribution of a constant market budget. Actual cash share and trading volume share are distinct.

Primary population: 20 ordinary scripted agents, 30 rounds, 200 paired seeds (`capital-v1:0`…`199`). Sensitivity: 10 and 40 ordinary agents, 100 paired seeds each, same other assumptions. Each seed/condition completes all 30 rounds; no early stopping or post-result exclusion. Both symbols share cash. No fees, borrowing or shorting. Prices/quantities are integers.

## Public information and policies

Each asset independently has a 35% news probability at rounds 2–30. Signed shocks are uniformly chosen from 300–1200 basis points; fundamentals are clamped at 25–175 DUSD. Round 1 starts at 100 DUSD; terminal redemption equals the last public fundamental. SHA-256 of seed, both paths and full news schedule is committed before the game. Only released news is exposed until finish.

The single maker quotes at round opening, before ordinary orders. It sees only current public fundamentals and its own inventory. Bid/ask = fundamental adjusted for inventory skew, ±1% half-spread. Skew = 2% × relative inventory deviation from initial, capped ±2%. Each symbol's bid uses at most 10% current maker cash and each ask offers floor(10% current inventory). Quotes do not change intra-round, cannot overspend/short, and expire at settlement. Maker quantities can exceed the ordinary 10-unit limit. Quote size is NOT tuned after seeing results.

Ordinary agents: 40% fundamental, 40% noise, 20% momentum. Each asset/round uses pre-generated draws shared across treatments: 8% chance PASS, otherwise equiprobable BUY/SELL, 1–10 units subject to available funds/inventory. Fundamental traders center valuations at current fundamental with ±2% uniform noise; noise traders use ±10% uniform noise; momentum traders extrapolate half of the most recent public fundamental change and add ±4% noise. BUY/SELL limits add/subtract an independent aggression draw up to 2% of fundamental. Agent order arrival is fixed by ID in every condition; matching retains the engine's deterministic seed/round tie-break. No agent receives future fundamentals, news, holdings or orders. Across treatments, affordability constraints may alter submitted quantities. Policies use no LLM API.

## Outcomes and inference

Unit of replication = one completed match/seed (not an individual trade).

Primary outcomes: (1) total executed units across both assets, each matched unit counted once; (2) mean ordinary-agent final net return, (final redeemed cash − 30,000 DUSD) / 30,000 DUSD, expressed in percentage points. Participant count is fixed per scenario. Also report median agent return, buy-and-hold adjusted return, total notional, non-maker-only volume, maker-involved volume share and maker profit.

Use paired per-seed differences vs 0%. Report two-sided paired sign-flip randomization tests (19,999 draws, fixed analysis RNG seed) and paired bootstrap 95% confidence intervals (10,000 resamples). Holm correction over all 20 primary comparisons (10 shares × 2 outcomes) within the primary population. Sensitivity scenarios are reported separately and labeled exploratory; apply their own 20-test family. Intervals are pointwise, not simultaneous. Report effects and uncertainty rather than ranking p-values. A positive outcome is statistically supported when its Holm p < .05 and direction is positive. Both primary outcomes must improve to call a ratio jointly beneficial. If none meets both, explicitly say so. No claim of a uniquely optimal ratio without direct between-ratio tests. Interpret practical tradeoffs and diminishing returns descriptively.

Validation: exact treatment count, deterministic replay, no negative balances, conservation after every round, no future news leak, all seeds complete; recompute aggregate PnL transfers against the common buy-and-hold benchmark. Retain raw match rows and analysis code. Results are conditional on these behavioral and funding assumptions, not a real-market forecast.
