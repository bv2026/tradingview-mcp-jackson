# All-strategies LLM decision contract

The canonical input is `evidence/latest/all-strategies-llm-input.json`. It is evidence-only: deterministic `score`, `rank_score`, `score_version`, eligibility, and evidence state are authoritative and must not be overwritten by the LLM. Scores are strategy-local and are never re-ranked across strategies.

The LLM must use evidence rather than score alone, distinguish UNKNOWN from negative, explain provider conflicts without averaging them away, and surface manual location/R:R and live funding checks. Coinbase Weekly is contextual and cannot independently create direction/setup/eligibility. Spot crypto is long-only; futures and perps may be bidirectional. No order execution is implied.

> **2026-08-30:** CannonEdge / CT was removed from tradingview-mcp-jackson (signal being rebuilt). Futures and crypto/perps evidence is now TradingView-only. Any `cannon*` fields in an older `all-strategies-llm-input.json` snapshot are stale; the current pipeline produces none.

Each candidate response must be JSON matching `docs/llm-decision-response.schema.json` with decision `ACTIONABLE_REVIEW`, `WATCH`, `AVOID`, or `INSUFFICIENT` and concise rationale, evidence, conflicts, unknowns, and checks.
