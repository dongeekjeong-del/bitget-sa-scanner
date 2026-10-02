# Swing paper trading and journal

Open paper.html on the scanner's static host. New paper entries default OFF. There are no API secrets, authenticated calls, or live order functions. Actual trading requires a separate implementation and user confirmation before sending any real order.

Enter only A+/S + ENTRY WATCH/TRIGGERED. Simulate one current-price entry with adverse slippage; recheck TP1 R:R from the entry price (A+ >= 2.1, S >= 2.4). Freeze the stop, target, configuration and full analysis snapshot. Close all quantity at the first observed quote reaching stop or TP1. Block duplicate symbol positions and reentry on the same symbol/direction/signal bar. Cap aggregate reserved margin at the configured percentage. The configured account value is a fixed sizing base, not a compounding balance.

Journal includes entry rationale, score, timeframe alignment, grade/status, prices, timestamps, quantity, gross profit/loss, estimated fees and net profit/loss. JSON export contains full snapshots. Assumptions: 0.06% fee per side, 0.05% adverse slippage per side. These are not verified account fee rates. Funding is unknown and excluded.

Quotes are sampled every five seconds. Between-sample crossings may be missed; this is not an exchange fill emulator. Long observation gaps are flagged. Keep the page open and active; browser suspension stops monitoring. Use only one tab. LocalStorage persists on this browser only; clearing browser data removes the journal. Export JSON regularly. Storage failures disable entries. Quote API failures disable new entries while monitoring retries.

Run `node paper-engine.test.js`. Tests cover eligible and excluded states, long/short exits, fees, duplicate prevention, frozen snapshots, reload persistence, actual-entry R:R and observation gaps. Hosted visual and public API integration verification remains outstanding. No live exchange order was submitted.
