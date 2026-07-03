# MOMENTUM-CRYPTO — Crypto Coins Screener

**Type:** Crypto Coins Screener  
**Used by:** `morning_brief instrument_type="crypto"`  
**rules.json key:** `"crypto": "MOMENTUM-CRYPTO"`

## Filters

| Filter | Condition | Value |
|--------|-----------|-------|
| Market Cap | > | 5B USD |
| Volume (24H) | > | 100M USD |
| Category | 49 selected | Excludes wrapped-token and most stablecoin categories (see Notes) |

## Sort

**Chg % 1W — descending** (confirmed 2026-07-03; verified monotonic)

## Notes

- Must be open in a **separate TradingView window** from the main chart
- **This screener type (Crypto Coins Screener) has no Exchange filter at all** — unlike the CEX Screener used for `MOMENTUM-PERPS`, coin-level data here is aggregated across exchanges, so "Coinbase only" can't be enforced at the TradingView UI level. This was previously (incorrectly) documented as an active `Exchange = Coinbase` filter — it never existed as an enforceable setting for this screener type. Coinbase-scoping happens entirely in code via the blocklist below.
- >$5B mcap + >$100M vol eliminates illiquid alts. (100M chosen over a looser 50M specifically because the missing exchange filter means more marginal names get through — a tighter volume floor is a cheap partial mitigant.)
- **Category narrowed to 49 (from a default/all of 68)** on 2026-07-03 — confirmed by result comparison that this excludes WETH/WBTC/CBBTC (wrapped-token categories) and most stablecoins (USDT/USDC/USDS). DAI still passes this filter but is separately caught by the code blocklist below.
- Blocklist applied in code (`CRYPTO_BLOCKLIST` in `src/core/screener.js`):
  removes stablecoins (USDT/USDC/DAI), wrapped tokens (WBTC/WETH), tokenized gold (XAUT/PAXG), BNB, XMR, TRX
- **Known gap (as of 2026-07-03):** HYPE (Hyperliquid) currently passes both the screener filters and the code blocklist despite not being part of the intended ~9-coin universe — it's simply a newer coin that predates the blocklist's last update. This is the general failure mode of a deny-list (only catches *known* unwanted names) and is the reason an allowlist conversion is planned for `CRYPTO_BLOCKLIST` (not yet implemented — deferred per user request on 2026-07-03).
- Universe after blocklist: BTC, ETH, SOL, XRP, DOGE, ZEC, ADA, LINK, XLM (~9 coins), plus any not-yet-blocklisted newcomers like HYPE until the allowlist fix lands
