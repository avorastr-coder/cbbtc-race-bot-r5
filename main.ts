// Round-5 cbBTC ladder bot (btc-race-24h-20261123-0511): two-rung dip buying
// on 1-minute Orca bars.
//
// Idea: cbBTC mean-reverts after sharp hourly slides, but a slide that is
// still falling eats a full-size dip buy alive. So the bot buys in two rungs
// and scales out in two steps:
//   rung 1 — a 60-minute slide of 100 bps or more: risk 60% of cash.
//   rung 2 — the slide deepens to a 120-minute slide of 210 bps or more:
//     top the position up to 100% of cash.
//   scale out — sell half at +180 bps over the average cost, the rest at
//     +200 bps; a 150 bps trailing stop and a 200 bps hard stop cap every
//     trade; nothing is held longer than 480 bars.
//   guardrail — if nothing ever filled by bar 1425, buy 25% of cash so the
//     entry still clears the >= 1 trade bar on a quiet day.
//
// Design carried over from round 4 (20261118-1444), re-tuned on this
// round's own frozen 24-hour dev window (22 Nov 05:11 UTC - 23 Nov 05:11 UTC)
// with a local fill-model simulator (4 bps fee, 2 bps slippage,
// constant-product impact on open depth) and cross-checked on the round-4
// and round-3 dev windows; parameters were picked by the worst of the three
// windows, not the best. Round 4's config as-is FAILS this dev window
// (-$0.20): the new window rose all day (buy-and-hold +$30.86), so its dips
// were shallower and the -110 bps trigger almost never fired. The shallower
// -100 bps trigger with a 60% first rung fixes that: see STRATEGY.md.
//
// All arithmetic is integer (bigint) on the harness's raw units, no clock,
// no randomness, no environment: the same bars always give the same orders.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 300;
const MIN_NOTIONAL = 1_000_000n; // 1 USDC, in quote units

// Rung 1: 60-minute return at or below -100 bps -> buy 60% of cash.
const RUNG1_WINDOW = 60;
const RUNG1_DIP_BPS = -100n;
const RUNG1_FRACTION_NUM = 60n;
const RUNG1_FRACTION_DEN = 100n;

// Rung 2: 120-minute return at or below -210 bps -> top up to all cash.
const RUNG2_WINDOW = 120;
const RUNG2_DIP_BPS = -210n;

// Scale out: half at +180 bps over average cost, the rest at +200 bps.
const FIRST_TAKE_BPS = 180n;
const SECOND_TAKE_BPS = 200n;
const FIRST_TAKE_FRACTION_NUM = 1n;
const FIRST_TAKE_FRACTION_DEN = 2n;

// Safety nets, in bps against the average cost / the peak close since entry.
const TRAIL_BPS = 150n;
const STOP_BPS = 200n;
const MAX_HOLD_BARS = 480;

// Guardrail: first buy ever, at bar 1425, 25% of cash.
const GUARDRAIL_BAR = 1425;
const GUARDRAIL_FRACTION_NUM = 25n;
const GUARDRAIL_FRACTION_DEN = 100n;

// One less than the window length: the harness rejects orders decided on the
// last batch, and the replay flattens everything at the last close anyway.
const LAST_TRADABLE_BAR = 1439;

const closes: bigint[] = [];
let seenBars = 0;
let entryBar = -1;
let peakClose = 0n;
let rung2Taken = false;
let firstTakeDone = false;
let everBought = false;

/** Trailing return over `window` closes ending at the latest close, in bps. */
function trailingReturn(window: number): bigint | null {
  const n = closes.length;
  if (n <= window) return null;
  const now = closes[n - 1]!;
  const then = closes[n - 1 - window]!;
  return ((now - then) * 10_000n) / then;
}

/** Gain of the latest close over the average cost, in bps. */
function gainOverCost(state: BarsState, cost: bigint, qty: bigint): bigint {
  const entryPx = (cost * 10_000_000n) / qty;
  const close = state.close(SYMBOL)!;
  return ((close - entryPx) * 10_000n) / entryPx;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    const close = state.close(SYMBOL);
    if (close === null) return [];
    for (const fill of batch.fills) {
      if (fill.status === 'filled' && fill.side === 'buy') everBought = true;
    }
    closes.push(close);
    seenBars += 1;
    if (seenBars > LAST_TRADABLE_BAR) return [];

    const held = state.positions.get(SYMBOL);
    const qty = held === undefined ? 0n : held.qty;
    const cost = held === undefined ? 0n : held.cost;

    if (qty === 0n) {
      // Flat: reset the per-position flags so the next dip can be traded.
      entryBar = -1;
      peakClose = 0n;
      rung2Taken = false;
      firstTakeDone = false;

      const deep = trailingReturn(RUNG2_WINDOW);
      if (deep !== null && deep <= RUNG2_DIP_BPS && state.cash >= MIN_NOTIONAL) {
        rung2Taken = true;
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      const dip = trailingReturn(RUNG1_WINDOW);
      if (dip !== null && dip <= RUNG1_DIP_BPS) {
        const spend = (state.cash * RUNG1_FRACTION_NUM) / RUNG1_FRACTION_DEN;
        if (spend >= MIN_NOTIONAL) {
          return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      if (!everBought && seenBars - 1 >= GUARDRAIL_BAR) {
        const spend = (state.cash * GUARDRAIL_FRACTION_NUM) / GUARDRAIL_FRACTION_DEN;
        if (spend >= MIN_NOTIONAL) {
          return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      return [];
    }

    // Holding a position.
    if (entryBar < 0) {
      entryBar = seenBars - 1;
      peakClose = close;
    }
    if (close > peakClose) peakClose = close;

    // Rung 2 tops the position up while the slide is still deepening.
    if (!rung2Taken) {
      const deep = trailingReturn(RUNG2_WINDOW);
      if (deep !== null && deep <= RUNG2_DIP_BPS && state.cash >= MIN_NOTIONAL) {
        rung2Taken = true;
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }

    const gain = gainOverCost(state, cost, qty);
    if (!firstTakeDone && gain >= FIRST_TAKE_BPS) {
      firstTakeDone = true;
      const half = (qty * FIRST_TAKE_FRACTION_NUM) / FIRST_TAKE_FRACTION_DEN;
      if (half > 0n) {
        return [{ side: 'sell', symbol: SYMBOL, qty: half, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    const entryPx = (cost * 10_000_000n) / qty;
    const heldBars = seenBars - 1 - entryBar;
    if (
      gain >= SECOND_TAKE_BPS ||
      close <= (peakClose * (10_000n - TRAIL_BPS)) / 10_000n ||
      close <= (entryPx * (10_000n - STOP_BPS)) / 10_000n ||
      heldBars >= MAX_HOLD_BARS
    ) {
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
