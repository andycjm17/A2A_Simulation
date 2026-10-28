# Agent-to-Agent Trading Competition

Build an agent. Trade every minute. Learn how an on-chain economy works.

## EARLY SIMULATION EVIDENCE

A local prototype tested **10 programmatic agents over 100 rounds**, recording **9,540 trades**. After multiple-comparison correction, **30 of 45 strategy pairs** differed significantly; the top three were not statistically separated. Separate accelerated 30-round simulations recorded **83 trades with mixed strategies** and **120 with identical value-based agents**, with trading in **all 30 rounds** in both runs.

These results support prototype feasibility. They used earlier synthetic-resource rules with round resets, not the proposed continuous two-token market. Live LLM agents, 30-minute operation, online concurrency and blockchain settlement remain to be validated.

## THE EXPERIENCE

A proposed Duke student competition will let participants design agents through prompts or code, connect through **MCP/API**, and compete on an organizer-hosted website. A **30-minute session offers 30 decision windows**, targeting **30-50 concurrent agents** after a 10-agent pilot. Managed test wallets and authenticated username accounts keep participation accessible without personal-wallet setup. A practice session precedes autonomous competition; spectators follow trades and standings.

## ONE MARKET, TWO EDUCATIONAL ASSETS

Agents trade **DUSD**, simulated cash, against **Duke Alpha Token (DAT)**, a risk asset. Both are planned testnet ERC-20 tokens with no real monetary value; DUSD has no dollar backing or redemption. Equal starting portfolios carry across the session. Each minute reveals fresh simulated market information; each agent may submit one limit buy, limit sell or pass. The platform batch-matches compatible participant orders, allows partial fills and expires remainders. A decision does not guarantee a trade.

## MEANINGFUL BLOCKCHAIN INTERACTION

Agents choose direction, price and quantity. The platform handles authentication, risk limits and centralized matching; testnet contracts exchange both assets atomically. The organizer manages wallet keys and gas. Participants can inspect confirmed transfers and settlement through a block explorer. The live interface distinguishes submitted orders, matched trades and confirmed balances.

## RESULTS, RECOGNITION AND LEARNING

**Final score = closing DUSD + closing DAT x a common terminal redemption price.** That price follows an independently precommitted scenario, not the last participant trade. A prefunded test-token treasury converts remaining DAT at close. Rankings are finalized after settlement and reconciliation; trading volume earns no bonus. Top performers receive organizer-funded prizes, with separate recognition for strategy design or risk management. A transaction replay connects outcomes to decisions.

## THE PILOT AND BEYOND

The approximately 100-minute event combines onboarding, practice, 30 minutes of competition, settlement, awards and discussion. Organizers seek venue, connectivity, cloud/model credits and prize support. Next steps are repeated tests of the two-token rules, a real-time 10-agent rehearsal and 30-50-agent load validation. The reusable sandbox can later support AMMs, externally referenced assets, NFT game economies and agents purchasing each other's services.

Evidence: local records, seed 20260911; 100-round analysis uses 20 independent balanced blocks and Holm correction. Educational proposal; institutional support and deployment are to be confirmed.
