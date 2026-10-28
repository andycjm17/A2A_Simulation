# continuous-v2: event-driven, no periodic matching

Protocol fixed before the main sweep. Offline scripted-agent experiment. No LLM, API/network load benchmark or production rule change.

## Question

Remove exchange matching rounds/frequency entirely. Every accepted incoming order immediately runs price-time-priority matching against resting orders, at resting-order prices; unmatched quantities remain GTC until cancellation or the 300-second experiment close. There is no auction, final auction, matching timer, 250ms global tick or mandatory 10s maker refresh. A maximum elapsed match duration is an experimental observation boundary, not a matching interval.

## Common conditions

20 ordinary agents, initial 10000 DUSD and 100 units of each of two simulated assets, initial prices 100 DUSD. A single system maker owns 20% of initial tradable cash (excluding redemption treasury), with proportional inventories. Shared cash, integer cents and stock quantities, no borrowing, shorting, fees or real assets. Ordinary strategy families remain 40% fundamental, 40% noise, 20% momentum with the prior timing-v1 keyed policy; every decision can produce orders for both assets, size 1-10 per asset subject to free collateral. PASS cancels the participant's prior order for that asset. One active ordinary order per asset. Replace on new intent, preserving a truly identical order's arrival priority. Policy sees only the current and previous released fundamental, never future news.

News arrivals are independent exponential waiting times per asset, mean 1/0.035 seconds. Impact magnitude 3-12%, equiprobable sign, fundamentals bounded 25-175 DUSD. Generate and hash each full news tape before treatments; all paired cases share that tape and terminal redemption at the last public fundamentals. No regular news epochs or new closing shock.

Events have exact integer-millisecond timestamps and a stable event queue; ordering by timestamp then event insertion sequence. This is simulation precision, not measured engine latency. Decision latency = base x uniform[0.8,1.2] plus 20-100ms submission delay per call; market notification delay = 20-100ms per recipient. Responses consume a snapshot taken at request start and may be stale on arrival. Agent calls never overlap; repeated events while busy coalesce into one pending wake. A periodic Agent's initial phase is independently uniform within its own period. There is no deadline except match close; late responses are recorded, not silently rolled into another round.

The system maker is reactive: initialization, released news and its own fills schedule a requote after 100-125ms (coalesced). Old quotes stay live until the replacement arrives. At that time the maker reads the latest PUBLIC fundamental and inventory, cancels prior quotes, and quotes fundamental +/-1%, with inventory skew capped +/-2%. Each bid uses up to 10% current cash per asset and asks up to 10% inventory, as before. The maker does not refill at a fixed clock. Price limits, reservations and self-trade prevention apply. Thus fast maker response is an explicitly modeled capability, not evidence about human/LLM skill.

## Primary treatments (200 paired seeds)

1. `timer10`: Agents decide asynchronously every 10s, skipping a scheduled call if another is running.
2. `timer5`: Same, every 5s.
3. `targeted`: Only startup, released-news notifications and the Agent's own fills trigger decisions. No heartbeat or mandatory cooldown.
4. `market`: Same plus best-five book changes and all trades; ignore own quote-only notifications to avoid direct self-notification loops. No mandatory cooldown; inference still limits the speed.
5. `serial`: Immediately start the next decision when the previous response arrives, regardless of whether information changed. This is an uncapped decision loop, not a zero-compute or zero-network scenario.

No matching-frequency setting exists in any treatment. Common base ordinary decision latency = 1000ms. All calls produce a causal snapshot and are serial per Agent.

## Prespecified sensitivity (first 50 seeds)

- All five policies with 3000ms ordinary base latency.
- All five with heterogeneous latency: two equally sized groups at 250ms and 3000ms; balanced within strategy family, rotated by seed.
- All five with 30s order TTL instead of GTC (expiry is order lifetime, not a matching schedule).
- All five with slower maker requotes at 1000-1250ms.
- `market` with 1000ms per-Agent minimum time between decision starts (decision throttling only).
- `targeted` with immediate cancellation of old orders when a news notification is delivered, before starting a new inference (no new order until inference returns).

Total = 1000 primary + 1100 sensitivity = 2100 completed matches. No outcome exclusions or adaptive selection of seeds.

## Metrics, inference and checks

Primary metrics: executed units counted once, ordinary mean terminal redeemed cash in DUSD, and exact time-weighted absolute last-trade deviation from contemporaneous public fundamental (%). Last price persists through no-trade intervals. Track decision calls, submitted orders, cancellations, maker requotes/volume, order-arrival-to-fill passive waiting, and terminal cash differences between fast/slow groups. There is zero artificial matching scheduling delay by construction; passive order waiting is distinct from that delay. Calls are a cost proxy, not measured paid model calls.

Planned contrasts: timer5 minus timer10; targeted minus timer10; market minus targeted; serial minus targeted. Paired bootstrap 95% pointwise CIs (10000 resamples), two-sided paired sign-flip p (19999 draws; symmetric-null approximation), Holm over 12 primary tests (4 contrasts x 3 metrics). Other metrics/sensitivity descriptive. Uncertainty is across complete seeded matches, not individual trades. News tape/duration/funding are identical within each seed. Findings concern these scripted policies only.

Audit conservation, nonnegative balances, shared cash/stock reservations after EVERY processed event. Assert every fill occurs at the exact arrival timestamp of a new order and inside both limit prices; disable the batch-auction method. Reconcile terminal trading transfers against common buy-and-hold. Unit tests: price-time priority, partial/GTC fills at irregular timestamps, no auction at close, no future-news access via prefix replay, deterministic replay, cancel collateral release, slow-response acceptance and event coalescing. Full seed-0 replay for every primary condition; retain raw rows and code hashes.
