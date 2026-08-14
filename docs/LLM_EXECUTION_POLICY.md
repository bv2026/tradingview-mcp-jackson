# LLM decision execution policy

The canonical package is one transport artifact containing ten independent strategy contexts. Each request contains exactly one strategy context and that strategy's candidates. The default WATCH policy includes every REVIEW row and the top five WATCH rows by descending `rank_score`; every omitted WATCH row remains retrievable through `watch_references_by_strategy` and `hydrate:llm-watch`. `LLM_WATCH_LIMIT` configures the limit.

Source file age is checked against `LLM_FRESHNESS_HOURS` (default 48 hours). The package records per-strategy age/status and warnings. The execution wrapper marks stale strategies `PENDING_STALE`; it never changes deterministic scores.

`run:llm-decisions` produces ten request artifacts and a manifest. No provider is bundled or inferred: without `LLM_DECISION_ADAPTER`, these remain `PENDING_PROVIDER`. A future adapter must validate each response against `docs/llm-decision-response.schema.json`, preserve strategy/context version, and reject global, best-overall, or cross-strategy constructs. No order execution is reachable from this layer.
