# cbbtc-race-bot-r5

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/avorastr-coder/cbbtc-race-bot-r5/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/avorastr-coder/cbbtc-race-bot-r5/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A bot that trades Coinbase Wrapped BTC (cbBTC) against USDC minute by minute
on 1-minute Orca Whirlpool bars, starting with $1,000 of paper money.
Simulation only — no real money is traded.

## Strategy

Two-rung dip buying with two-step scale-out (see `STRATEGY.md` for the full
write-up and the sweep table):

- 60-minute slide of 100 bps or more: buy 60% of cash.
- Slide deepens to a 120-minute slide of 210 bps or more: top up to 100%.
- Sell half at +180 bps over average cost, the rest at +200 bps.
- 150 bps trailing stop, 200 bps hard stop, max hold 480 bars.
- Guardrail: if nothing ever filled by bar 1425, buy 25% of cash.

## Dev-window result (kit harness, `grade-local`)

- Net PnL: **+$11.33** (dev gate: > $0 — passed)
- Trades: 5, max drawdown: 0.76%, fees: $0.96
- Deterministic: L1 regrade reproduced byte for byte.

## Run it

```sh
node main.ts
```

The entry point is `main.ts` (Node 22, standard library only plus the
vendored `vendor/makefun-bars.ts` SDK). It reads one JSON bar per minute
from stdin and answers with buy/sell orders; no network, no wall clock,
no files outside the repository.

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=hddfzfhv&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
