# Strategy: cbBTC two-rung dip ladder (round 5)

## Idea

cbBTC mean-reverts after sharp slides on the one-to-two-hour scale, but a
slide that is still falling eats a full-size dip buy alive. This bot buys in
two rungs and scales out in two steps, so a shallow dip costs little and a
deep dip gets the full size near the bottom:

- **Rung 1:** trailing 60-minute return at or below -100 bps: buy 60% of
  cash.
- **Rung 2:** trailing 120-minute return at or below -210 bps: top the
  position up to 100% of cash (either as the first buy, or as an add-on
  while rung 1 is held).
- **Scale out:** sell half the position at +180 bps over the average cost
  (fees included), the rest at +200 bps.
- **Safety nets:** trailing stop 150 bps below the peak close since entry,
  hard stop 200 bps below the average cost, max hold 480 bars.
- **Guardrail:** if no buy has ever filled by bar 1425, buy 25% of cash,
  so the entry still clears the >= 1 trade bar on a quiet day.
- A buy the market refuses is retried while its signal holds; a sell the
  market refuses is retried while its exit holds. Max slippage 300 bps on
  every order (never binds on 1-minute data; it only guards a gap open).

## Why these numbers

Swept with a local fill-model simulator (4 bps fee, 2 bps slippage,
constant-product impact against each bar's open depth) on THREE frozen
24-hour windows and picked the config by its worst window, not its best:

| config | window 22-23 Nov (this round) | window 17-18 Nov | window 16-17 Nov |
|--------|------------------------------:|-----------------:|-----------------:|
| round-4 config as-is (dip -110, rung 40%) | -$0.20 (FAILS dev gate) | +$17.70 | +$13.83* |
| dip -100, rung 40% | +$7.49 | +$17.70 | +$13.83 |
| dip -100, rung 50% | +$9.16 | +$17.61 | +$17.00 |
| **dip -100, rung 60% (this bot)** | **+$11.33** | **+$13.91** | **+$20.44** |

\* round-4 config on the 16-17 Nov window from sweep 3 candidate E's r3 value
is +$13.83 with dip -100; the as-is -110 config was not re-run on r3.

The new dev window rose all day (buy-and-hold +$30.86, max drawdown 2.1%),
so its dips were shallow: the round-4 -110 bps trigger fired only twice
and the bot finished -$0.20. The shallower -100 bps trigger fires 5 times
and the 60% first rung sizes those trades up. The plateau around the chosen
point is wide: dip -95 to -105, first take 150-180 bps, trail 150-180 bps
all stay above +$9 on the worst window. The hard stop never triggers on any
window; it is a safety net for the race window, not fitted to it.

Final confirmation with the kit's own `grade-local` harness (exact replay,
deterministic: L1 regrade reproduced byte for byte): net PnL **+$11.33**,
5 trades, max drawdown 0.76%, fees $0.96, guardrails met — dev gate
(net PnL > $0) passed.

## Risks

- Three windows are three samples. A race day with no -100 bps 60-minute
  slide trades only the guardrail; a slide that keeps falling past the
  top-up hits the -200 bps stop.
- Max drawdown is small on all windows (<= 1.0%) because positions are
  short-lived and the stop caps the loss per trade at ~200 bps plus costs.
- Deterministic: integer arithmetic only, no randomness, no clock.
