# Coinbase Weekly Evidence / Ingestion Contract

This repository copy is the Phase 1 implementation baseline. Coinbase Weekly is a longitudinal provider evidence source, not a current-state overwrite and not a strategy specification.

The pipeline preserves exact email identity and raw provenance, uses `report_date` as the observation date, and stores immutable issue records under `evidence/coinbase-weekly/issues/`. `latest.json` and `transitions.json` are rebuildable views. Missing values remain missing or `UNKNOWN`; chart/image-only values are references requiring review and are never inferred numerically.

The operational backbone is Market View → Trade Scenarios → Flows → Derivatives (conditional) → Financing Rates (conditional) → Week Ahead. BTC and ETH support/resistance zones and conditional scenarios retain exact as-reported text and source locations. Coinbase zones remain provider-specific and never overwrite TradingView S/R. Funding, OI, DVOL, realized volatility, VRP, skew, expiry, gamma, ETF flows/AUM, and stablecoin observations are populated only when explicitly printed in email text/HTML. Interpretations retain source text and cannot become decision inputs.

Research Intelligence is stored separately with `operational_decision_effect: prohibited`; it has no operational consumer. Gmail may later call the same raw-ingestion interface, but local `.eml` ingestion is the deterministic test and production base path. Conflicting content hashes for an existing report date fail for review; identical re-ingestion is a duplicate/no-op.
